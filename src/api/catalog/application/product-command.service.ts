import { EntityManager, LockMode, UniqueConstraintViolationException } from '@mikro-orm/core';
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';

import {
    createProductItem,
    deleteProductItem,
    populateCategoryAncestors,
    replaceProductCatalogGraph,
    restoreProductCatalogGraph,
    updateProductItem,
} from './product-catalog.writer';
import type {
    CreateProductCommand,
    CreateProductItemCommand,
    DeleteProductCommand,
    DeleteProductItemCommand,
    ProductWriteResult,
    ReplaceProductCatalogCommand,
    RestoreProductCommand,
    UpdateProductCommand,
    UpdateProductItemCommand,
} from './product-write.command';

import { CatalogGraphError } from '~/api/catalog/domain/catalog-graph';
import { ItemSaleStatus } from '~/api/catalog/domain/entity/item-sale-status';
import { ProductSnapshotChangeType } from '~/api/catalog/domain/entity/product-snapshot-change-type';
import { ProductSnapshotEntity } from '~/api/catalog/domain/entity/product-snapshot.entity';
import { ProductStatus } from '~/api/catalog/domain/entity/product-status';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';
import {
    PRODUCT_SNAPSHOT_SCHEMA_VERSION,
    createProductSnapshotPayload,
} from '~/api/catalog/domain/product-snapshot.factory';
import {
    InvalidProductChange,
    NotExistingProduct,
    ProductAccessDenied,
    ProductRevisionConflict,
    ProductWriteConflict,
} from '~/api/catalog/domain/product.error';
import {
    PRODUCT_NAME_MAX_LENGTH,
    PRODUCT_REASON_MAX_LENGTH,
    PRODUCT_SLUG_MAX_LENGTH,
    PRODUCT_SLUG_PATTERN,
    PRODUCT_TEXT_MAX_LENGTH,
} from '~/api/catalog/domain/product.rules';
import { MemberRole } from '~/api/member/domain/member-role';
import { MemberEntity } from '~/api/member/domain/member.entity';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload';
import { enqueueSearchProjection } from '~/infra/search/search-projection-outbox.entity';

const snapshotPopulate = [
    'seller',
    'items',
    'items.optionValues.option',
    'items.optionValues.value',
    'options',
    'options.values',
    'categories',
    'categories.category',
    'media',
    'media.asset',
    'tags',
] as const;

const productStatuses = new Set<ProductStatus>(Object.values(ProductStatus));

@Injectable()
export class ProductCommandService {
    constructor(private readonly em: EntityManager) {}

    async create(actor: JwtPayload, command: CreateProductCommand): Promise<ProductWriteResult> {
        this.assertCatalogActor(actor);

        return this.transaction(async (tx) => {
            const product = Object.assign(new ProductEntity(), {
                slug: normalizeSlug(command.slug),
                name: normalizeRequiredText(command.name, '상품명', PRODUCT_NAME_MAX_LENGTH),
                description: normalizeNullableText(command.description, '상품 설명'),
                returnPolicy: normalizeNullableText(command.returnPolicy, '반품 정책'),
                status: ProductStatus.DRAFT,
                revision: 1,
                seller: tx.getReference(MemberEntity, actor.memberId),
            });

            tx.persist(product);
            await tx.flush();

            this.persistSnapshot(tx, product, actor.memberId, ProductSnapshotChangeType.CREATE, command.reason);
            enqueueSearchProjection(tx, product, product.revision);
            await tx.flush();

            return toWriteResult(product);
        });
    }

    async update(actor: JwtPayload, command: UpdateProductCommand): Promise<ProductWriteResult> {
        assertPositiveRevision(command.expectedRevision, '기대 revision');

        return this.transaction(async (tx) => {
            const product = await this.lockProduct(tx, command.productId);
            this.assertCanChange(actor, product);
            this.assertExpectedRevision(product, command.expectedRevision);
            this.assertNotDeleted(product);

            const changed = this.applyUpdate(product, command);
            if (!changed) {
                throw invalidChange('변경할 상품 정보가 없습니다.');
            }

            this.assertAllowedStatus(actor, product.status);
            this.assertSaleableWhenActive(product);
            product.revision += 1;

            this.persistSnapshot(tx, product, actor.memberId, ProductSnapshotChangeType.UPDATE, command.reason);
            enqueueSearchProjection(tx, product, product.revision);
            await tx.flush();

            return toWriteResult(product);
        });
    }

    async delete(actor: JwtPayload, command: DeleteProductCommand): Promise<ProductWriteResult> {
        assertPositiveRevision(command.expectedRevision, '기대 revision');

        return this.transaction(async (tx) => {
            const product = await this.lockProduct(tx, command.productId);
            this.assertCanChange(actor, product);
            this.assertExpectedRevision(product, command.expectedRevision);
            this.assertNotDeleted(product);

            product.status = ProductStatus.CLOSED;
            product.deletedAt = new Date();
            product.revision += 1;

            this.persistSnapshot(tx, product, actor.memberId, ProductSnapshotChangeType.DELETE, command.reason);
            enqueueSearchProjection(tx, product, product.revision);
            await tx.flush();

            return toWriteResult(product);
        });
    }

    async replaceCatalog(actor: JwtPayload, command: ReplaceProductCatalogCommand): Promise<ProductWriteResult> {
        return this.changeCatalog(actor, command, (tx, product) => replaceProductCatalogGraph(tx, product, command));
    }

    async createItem(actor: JwtPayload, command: CreateProductItemCommand): Promise<ProductWriteResult> {
        return this.changeCatalog(actor, command, (tx, product) => createProductItem(tx, product, command));
    }

    async updateItem(actor: JwtPayload, command: UpdateProductItemCommand): Promise<ProductWriteResult> {
        return this.changeCatalog(actor, command, (tx, product) => updateProductItem(tx, product, command));
    }

    async deleteItem(actor: JwtPayload, command: DeleteProductItemCommand): Promise<ProductWriteResult> {
        return this.changeCatalog(actor, command, (tx, product) => deleteProductItem(tx, product, command));
    }

    private async changeCatalog(
        actor: JwtPayload,
        command: DeleteProductCommand,
        change: (tx: EntityManager, product: ProductEntity) => Promise<void>
    ): Promise<ProductWriteResult> {
        assertPositiveRevision(command.expectedRevision, '기대 revision');

        return this.transaction(async (tx) => {
            const product = await this.lockProduct(tx, command.productId);
            this.assertCanChange(actor, product);
            this.assertExpectedRevision(product, command.expectedRevision);
            this.assertNotDeleted(product);

            await change(tx, product);
            this.assertSaleableWhenActive(product);
            product.revision += 1;

            this.persistSnapshot(tx, product, actor.memberId, ProductSnapshotChangeType.UPDATE, command.reason);
            enqueueSearchProjection(tx, product, product.revision);
            await tx.flush();

            return toWriteResult(product);
        });
    }

    async restore(actor: JwtPayload, command: RestoreProductCommand): Promise<ProductWriteResult> {
        assertPositiveRevision(command.expectedRevision, '기대 revision');
        assertPositiveRevision(command.sourceRevision, '복원 revision');

        return this.transaction(async (tx) => {
            const product = await this.lockProduct(tx, command.productId);
            this.assertCanChange(actor, product);
            this.assertExpectedRevision(product, command.expectedRevision);

            if (command.sourceRevision >= product.revision) {
                throw invalidChange('복원 revision은 현재 revision보다 작아야 합니다.');
            }

            const source = await tx.findOne(ProductSnapshotEntity, {
                product: product.id,
                revision: command.sourceRevision,
            });
            if (!source) throw invalidChange('복원할 상품 revision이 없습니다.');

            this.applyRestoredProduct(product, source);
            await restoreProductCatalogGraph(tx, product, source.payload);
            this.assertAllowedStatus(actor, product.status);
            this.assertSaleableWhenActive(product);
            product.deletedAt = null;
            product.revision += 1;

            this.persistSnapshot(tx, product, actor.memberId, ProductSnapshotChangeType.RESTORE, command.reason);
            enqueueSearchProjection(tx, product, product.revision);
            await tx.flush();

            return toWriteResult(product);
        });
    }

    private async transaction<T>(work: (tx: EntityManager) => Promise<T>): Promise<T> {
        try {
            return await this.em.transactional(work, {
                clear: true,
                loggerContext: { label: 'catalog.product-command' },
            });
        } catch (error: unknown) {
            if (error instanceof CatalogGraphError) {
                throw invalidChange(error.message);
            }

            if (error instanceof UniqueConstraintViolationException) {
                throw new ConflictException(new ProductWriteConflict());
            }

            throw error;
        }
    }

    private async lockProduct(tx: EntityManager, productId: bigint): Promise<ProductEntity> {
        const product = await tx.findOne(ProductEntity, { id: productId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
        if (!product) throw new NotFoundException(new NotExistingProduct());

        await tx.populate(product, snapshotPopulate, { refresh: true });
        await populateCategoryAncestors(
            tx,
            product.categories.getItems().map(({ category }) => category)
        );

        return product;
    }

    private assertCatalogActor(actor: JwtPayload): void {
        if (actor.role !== MemberRole.ADMIN && actor.role !== MemberRole.SELLER) {
            throw new ForbiddenException(new ProductAccessDenied());
        }
    }

    private assertCanChange(actor: JwtPayload, product: ProductEntity): void {
        this.assertCatalogActor(actor);
        if (actor.role === MemberRole.ADMIN) return;

        if (product.seller.id !== actor.memberId || product.status === ProductStatus.SUSPENDED) {
            throw new ForbiddenException(new ProductAccessDenied());
        }
    }

    private assertExpectedRevision(product: ProductEntity, expectedRevision: number): void {
        if (product.revision !== expectedRevision) {
            throw new ConflictException(new ProductRevisionConflict(expectedRevision, product.revision));
        }
    }

    private assertNotDeleted(product: ProductEntity): void {
        if (product.deletedAt !== null) throw new NotFoundException(new NotExistingProduct());
    }

    private assertAllowedStatus(actor: JwtPayload, status: ProductStatus): void {
        if (actor.role !== MemberRole.ADMIN && status === ProductStatus.SUSPENDED) {
            throw new ForbiddenException(new ProductAccessDenied());
        }
    }

    private assertSaleableWhenActive(product: ProductEntity): void {
        if (product.status !== ProductStatus.ACTIVE) return;

        const hasSaleableItem = product.items
            .getItems()
            .some(({ saleStatus, deletedAt }) => saleStatus === ItemSaleStatus.ALLOW && deletedAt === null);
        if (!hasSaleableItem) {
            throw invalidChange('ACTIVE 상품은 판매 가능한 Item이 하나 이상 필요합니다.');
        }
    }

    private applyUpdate(product: ProductEntity, command: UpdateProductCommand): boolean {
        let changed = false;

        if (command.slug !== undefined) {
            const slug = normalizeSlug(command.slug);
            if (product.slug !== slug) {
                product.slug = slug;
                changed = true;
            }
        }
        if (command.name !== undefined) {
            const name = normalizeRequiredText(command.name, '상품명', PRODUCT_NAME_MAX_LENGTH);
            if (product.name !== name) {
                product.name = name;
                changed = true;
            }
        }
        if (command.description !== undefined) {
            const description = normalizeNullableText(command.description, '상품 설명');
            if (product.description !== description) {
                product.description = description;
                changed = true;
            }
        }
        if (command.returnPolicy !== undefined) {
            const returnPolicy = normalizeNullableText(command.returnPolicy, '반품 정책');
            if (product.returnPolicy !== returnPolicy) {
                product.returnPolicy = returnPolicy;
                changed = true;
            }
        }
        if (command.status !== undefined) {
            if (!productStatuses.has(command.status)) throw invalidChange('상품 상태가 올바르지 않습니다.');
            if (product.status !== command.status) {
                product.status = command.status;
                changed = true;
            }
        }

        return changed;
    }

    private applyRestoredProduct(product: ProductEntity, source: ProductSnapshotEntity): void {
        if (source.schemaVersion !== PRODUCT_SNAPSHOT_SCHEMA_VERSION) {
            throw invalidChange('지원하지 않는 Snapshot schema version입니다.');
        }

        const restored = source.payload.product;
        if (restored.id !== product.id.toString() || restored.sellerId !== product.seller.id.toString()) {
            throw invalidChange('Snapshot의 상품 식별 정보가 일치하지 않습니다.');
        }
        if (!productStatuses.has(restored.status)) throw invalidChange('Snapshot의 상품 상태가 올바르지 않습니다.');

        product.slug = normalizeSlug(restored.slug);
        product.name = normalizeRequiredText(restored.name, '상품명', PRODUCT_NAME_MAX_LENGTH);
        product.description = normalizeNullableText(restored.description, '상품 설명');
        product.returnPolicy = normalizeNullableText(restored.returnPolicy, '반품 정책');
        product.status = restored.status;
    }

    private persistSnapshot(
        tx: EntityManager,
        product: ProductEntity,
        changedByMemberId: bigint,
        changeType: ProductSnapshotChangeType,
        reason?: string | null
    ): void {
        const snapshot = Object.assign(new ProductSnapshotEntity(), {
            product,
            revision: product.revision,
            schemaVersion: PRODUCT_SNAPSHOT_SCHEMA_VERSION,
            changeType,
            payload: createProductSnapshotPayload(product),
            reason: normalizeReason(reason),
            changedBy: tx.getReference(MemberEntity, changedByMemberId),
        });

        tx.persist(snapshot);
    }
}

function normalizeSlug(value: string): string {
    const slug = normalizeRequiredText(value, '상품 slug', PRODUCT_SLUG_MAX_LENGTH);
    if (!PRODUCT_SLUG_PATTERN.test(slug)) throw invalidChange('상품 slug가 올바르지 않습니다.');
    return slug;
}

function normalizeRequiredText(value: string, field: string, maxLength: number): string {
    if (typeof value !== 'string') throw invalidChange(`${field}이(가) 문자열이어야 합니다.`);

    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength) {
        throw invalidChange(`${field}의 길이가 올바르지 않습니다.`);
    }

    return normalized;
}

function normalizeNullableText(value: string | null | undefined, field: string): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') throw invalidChange(`${field}이(가) 문자열이어야 합니다.`);

    const normalized = value.trim();
    if (normalized.length > PRODUCT_TEXT_MAX_LENGTH) {
        throw invalidChange(`${field}이(가) 너무 깁니다.`);
    }

    return normalized || null;
}

function normalizeReason(reason?: string | null): string | null {
    if (reason === null || reason === undefined) return null;
    if (typeof reason !== 'string') throw invalidChange('변경 사유가 문자열이어야 합니다.');

    const normalized = reason.trim();
    if (normalized.length > PRODUCT_REASON_MAX_LENGTH) throw invalidChange('변경 사유가 너무 깁니다.');
    return normalized || null;
}

function assertPositiveRevision(revision: number, field: string): void {
    if (!Number.isSafeInteger(revision) || revision < 1) {
        throw invalidChange(`${field}이(가) 양의 정수여야 합니다.`);
    }
}

function invalidChange(message: string): BadRequestException {
    return new BadRequestException(new InvalidProductChange(message));
}

function toWriteResult(product: ProductEntity): ProductWriteResult {
    return {
        productId: product.id,
        revision: product.revision,
        status: product.status,
        deletedAt: product.deletedAt,
    };
}
