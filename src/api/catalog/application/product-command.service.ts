import { EntityManager, LockMode, UniqueConstraintViolationException } from '@mikro-orm/core';
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';

import { CATALOG_WRITE_EFFECTS, type CatalogWriteEffects } from './catalog-write-effects.port';
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
import { PRODUCT_REASON_MAX_LENGTH, ProductRuleError } from '~/api/catalog/domain/product.rules';
import { MemberRole } from '~/api/member/domain/member-role';
import { MemberEntity } from '~/api/member/domain/member.entity';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload';

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

@Injectable()
export class ProductCommandService {
    constructor(
        private readonly em: EntityManager,
        @Inject(CATALOG_WRITE_EFFECTS) private readonly writeEffects: CatalogWriteEffects
    ) {}

    async create(actor: JwtPayload, command: CreateProductCommand): Promise<ProductWriteResult> {
        this.assertCatalogActor(actor);

        return this.transaction(async (tx) => {
            const product = ProductEntity.create({
                slug: command.slug,
                name: command.name,
                description: command.description,
                returnPolicy: command.returnPolicy,
                seller: tx.getReference(MemberEntity, actor.memberId),
            });

            tx.persist(product);
            await tx.flush();

            this.persistSnapshot(tx, product, actor.memberId, ProductSnapshotChangeType.CREATE, command.reason);
            this.writeEffects.recordChange(tx, product);
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

            const changed = product.applyChanges({
                slug: command.slug,
                name: command.name,
                description: command.description,
                returnPolicy: command.returnPolicy,
                status: command.status,
            });
            if (!changed) {
                throw invalidChange('변경할 상품 정보가 없습니다.');
            }

            this.assertAllowedStatus(actor, product.status);
            product.assertSaleableWhenActive();
            product.advanceRevision();

            this.persistSnapshot(tx, product, actor.memberId, ProductSnapshotChangeType.UPDATE, command.reason);
            this.writeEffects.recordChange(tx, product);
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

            product.close();
            product.advanceRevision();

            this.persistSnapshot(tx, product, actor.memberId, ProductSnapshotChangeType.DELETE, command.reason);
            this.writeEffects.recordChange(tx, product);
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
            product.assertSaleableWhenActive();
            product.advanceRevision();

            this.persistSnapshot(tx, product, actor.memberId, ProductSnapshotChangeType.UPDATE, command.reason);
            this.writeEffects.recordChange(tx, product);
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
            if (source.schemaVersion !== PRODUCT_SNAPSHOT_SCHEMA_VERSION) {
                throw invalidChange('지원하지 않는 Snapshot schema version입니다.');
            }

            product.restoreFrom(source.payload.product);
            await restoreProductCatalogGraph(tx, product, source.payload);
            this.assertAllowedStatus(actor, product.status);
            product.assertSaleableWhenActive();
            product.advanceRevision();

            this.persistSnapshot(tx, product, actor.memberId, ProductSnapshotChangeType.RESTORE, command.reason);
            this.writeEffects.recordChange(tx, product);
            await tx.flush();

            return toWriteResult(product);
        });
    }

    private async transaction<T>(work: (tx: EntityManager) => Promise<T>): Promise<T> {
        try {
            return await this.em.transactional(
                async (tx) => {
                    await this.writeEffects.assertWritable(tx);
                    return work(tx);
                },
                {
                    clear: true,
                    loggerContext: { label: 'catalog.product-command' },
                }
            );
        } catch (error: unknown) {
            if (error instanceof CatalogGraphError || error instanceof ProductRuleError) {
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
