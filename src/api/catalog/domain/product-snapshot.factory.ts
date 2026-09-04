import { CategoryEntity } from './entity/category.entity';
import type { ProductSnapshotPayload } from './entity/product-snapshot-payload';
import { ProductEntity } from './entity/product.entity';

export const PRODUCT_SNAPSHOT_SCHEMA_VERSION = 1;

export function createProductSnapshotPayload(product: ProductEntity): ProductSnapshotPayload {
    return {
        product: {
            id: product.id.toString(),
            sellerId: product.seller.id.toString(),
            slug: product.slug,
            name: product.name,
            description: product.description,
            returnPolicy: product.returnPolicy,
            status: product.status,
        },
        items: product.items
            .getItems()
            .filter(({ deletedAt }) => deletedAt === null)
            .toSorted((left, right) => compareSequenceAndId(left, right))
            .map((item) => ({
                id: item.id.toString(),
                sku: item.sku,
                name: item.name,
                supplyPrice: item.supplyPrice,
                vat: item.vat,
                totalPrice: item.totalPrice,
                isTaxFree: item.isTaxFree,
                saleStatus: item.saleStatus,
                sequence: item.sequence,
                optionSignature: item.optionSignature,
                selectedOptions: item.optionValues
                    .getItems()
                    .toSorted((left, right) => compareSequenceAndId(left.option, right.option))
                    .map(({ option, value }) => ({
                        optionId: option.id.toString(),
                        optionCode: option.code,
                        optionName: option.name,
                        valueId: value.id.toString(),
                        valueCode: value.code,
                        valueName: value.name,
                    })),
            })),
        options: product.options
            .getItems()
            .toSorted((left, right) => compareSequenceAndId(left, right))
            .map((option) => ({
                id: option.id.toString(),
                code: option.code,
                name: option.name,
                isRequired: option.isRequired,
                sequence: option.sequence,
                values: option.values
                    .getItems()
                    .toSorted((left, right) => compareSequenceAndId(left, right))
                    .map(({ id, code, name, sequence }) => ({ id: id.toString(), code, name, sequence })),
            })),
        categories: product.categories
            .getItems()
            .toSorted(
                (left, right) => left.sequence - right.sequence || compareBigInt(left.category.id, right.category.id)
            )
            .map(({ category, sequence }) => ({
                id: category.id.toString(),
                name: category.name,
                slug: category.slug,
                sequence,
                path: createCategoryPath(category),
            })),
        media: product.media
            .getItems()
            .toSorted(
                (left, right) =>
                    left.role.localeCompare(right.role) ||
                    left.sequence - right.sequence ||
                    compareBigInt(left.id, right.id)
            )
            .map(({ id, role, altText, sequence, asset }) => ({
                id: id.toString(),
                role,
                altText,
                sequence,
                asset: {
                    id: asset.id.toString(),
                    storageKey: asset.storageKey,
                    originalName: asset.originalName,
                    mimeType: asset.mimeType,
                    byteSize: asset.byteSize.toString(),
                    checksum: asset.checksum,
                    width: asset.width,
                    height: asset.height,
                },
            })),
        tags: product.tags
            .getItems()
            .toSorted((left, right) => left.sequence - right.sequence || left.value.localeCompare(right.value))
            .map(({ value, sequence }) => ({ value, sequence })),
    };
}

function createCategoryPath(category: CategoryEntity): Array<{ id: string; name: string; slug: string }> {
    const path: CategoryEntity[] = [];
    const visited = new Set<bigint>();
    let current: CategoryEntity | null = category;

    while (current) {
        if (visited.has(current.id)) throw new Error('카테고리 계층에 순환 참조가 있습니다.');

        visited.add(current.id);
        path.push(current);
        current = current.parent;
    }

    return path.toReversed().map(({ id, name, slug }) => ({ id: id.toString(), name, slug }));
}

function compareSequenceAndId(left: { sequence: number; id: bigint }, right: { sequence: number; id: bigint }): number {
    return left.sequence - right.sequence || compareBigInt(left.id, right.id);
}

function compareBigInt(left: bigint, right: bigint): number {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}
