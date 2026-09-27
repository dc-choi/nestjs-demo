import { CatalogGraph, type CatalogGraphInput, type CatalogItemInput, invalidGraph } from './catalog-graph';
import { ProductEntity } from './entity/product.entity';

import { compareBigInt } from '~/global/common/utils/bigint';

/**
 * Mutable-intent operations begin from live ORM state, which may itself need
 * correction. Validation happens only after the intended change is applied.
 */
export class CatalogGraphChange {
    private constructor(private readonly input: CatalogGraphInput) {}

    static fromProduct(product: ProductEntity): CatalogGraphChange {
        return new CatalogGraphChange({
            options: product.options
                .getItems()
                .toSorted(compareSequenceAndId)
                .map((option) => ({
                    id: option.id,
                    code: option.code,
                    name: option.name,
                    isRequired: option.isRequired,
                    values: option.values
                        .getItems()
                        .toSorted(compareSequenceAndId)
                        .map(({ id, code, name }) => ({ id, code, name })),
                })),
            items: product.items
                .getItems()
                .filter(({ deletedAt }) => deletedAt === null)
                .toSorted(compareSequenceAndId)
                .map((item) => ({
                    id: item.id,
                    sku: item.sku,
                    name: item.name,
                    supplyPrice: item.supplyPrice,
                    vat: item.vat,
                    isTaxFree: item.isTaxFree,
                    saleStatus: item.saleStatus,
                    optionSignature: item.optionSignature,
                    expectedTotalPrice: item.totalPrice,
                    selectedOptions: item.optionValues
                        .getItems()
                        .toSorted((left, right) => compareSequenceAndId(left.option, right.option))
                        .map(({ option, value }) => ({ optionCode: option.code, valueCode: value.code })),
                })),
            categoryIds: product.categories
                .getItems()
                .toSorted(
                    (left, right) =>
                        left.sequence - right.sequence || compareBigInt(left.category.id, right.category.id)
                )
                .map(({ category }) => category.id),
            tags: product.tags
                .getItems()
                .toSorted((left, right) => left.sequence - right.sequence || left.value.localeCompare(right.value))
                .map(({ value }) => value),
        });
    }

    withAddedItem(item: CatalogItemInput): CatalogGraph {
        if (item.id !== undefined) throw invalidGraph('새 Item에는 ID를 지정할 수 없습니다.');
        const input = this.input;
        return CatalogGraph.fromInput({ ...input, items: [...input.items, item] });
    }

    withUpdatedItem(item: CatalogItemInput & { readonly id: bigint }): CatalogGraph {
        this.assertCurrentItem(item.id);
        const input = this.input;
        return CatalogGraph.fromInput({
            ...input,
            items: input.items.map((current) => (current.id === item.id ? item : current)),
        });
    }

    withoutItem(itemId: bigint): CatalogGraph {
        this.assertCurrentItem(itemId);
        const input = this.input;
        return CatalogGraph.fromInput({
            ...input,
            items: input.items.filter(({ id }) => id !== itemId),
        });
    }

    private assertCurrentItem(itemId: bigint): void {
        if (!this.input.items.some(({ id }) => id === itemId)) {
            throw invalidGraph('이 상품에 속한 현재 Item이 아닙니다.');
        }
    }
}

function compareSequenceAndId(left: { sequence: number; id: bigint }, right: { sequence: number; id: bigint }): number {
    return left.sequence - right.sequence || compareBigInt(left.id, right.id);
}
