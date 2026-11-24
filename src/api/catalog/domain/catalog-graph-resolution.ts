import { type CatalogItem, type CatalogOption, invalidGraph } from './catalog-graph.js';
import { ItemEntity } from './entity/item.entity.js';
import { ProductOptionValueEntity } from './entity/product-option-value.entity.js';
import { ProductOptionEntity } from './entity/product-option.entity.js';
import type { ProductEntity } from './entity/product.entity.js';

export interface ResolvedOption {
    readonly input: CatalogOption;
    readonly entity: ProductOptionEntity;
    readonly values: readonly { input: CatalogOption['values'][number]; entity: ProductOptionValueEntity }[];
}

export interface ResolvedItem {
    readonly input: CatalogItem;
    readonly entity: ItemEntity;
}

/**
 * Pairs each validated option and value with the product's live row, by ID when given and by code otherwise,
 * or a new row. One live row may back only one input. Requires `options.values` to be populated.
 */
export function resolveOptions(product: ProductEntity, inputs: readonly CatalogOption[]): ResolvedOption[] {
    const currentById = new Map(product.options.getItems().map((option) => [option.id, option]));
    const currentByCode = new Map(product.options.getItems().map((option) => [option.code, option]));
    const usedOptions = new Set<ProductOptionEntity>();

    return inputs.map((input) => {
        const current = input.id === undefined ? currentByCode.get(input.code) : currentById.get(input.id);
        const option = current ?? createOption(input.id, product);
        if (usedOptions.has(option)) throw invalidGraph('하나의 옵션을 중복해서 사용할 수 없습니다.');
        usedOptions.add(option);

        const currentValuesById = new Map(option.values.getItems().map((value) => [value.id, value]));
        const currentValuesByCode = new Map(option.values.getItems().map((value) => [value.code, value]));
        const usedValues = new Set<ProductOptionValueEntity>();
        const values = input.values.map((valueInput) => {
            const currentValue =
                valueInput.id === undefined
                    ? currentValuesByCode.get(valueInput.code)
                    : currentValuesById.get(valueInput.id);
            const value = currentValue ?? createOptionValue(valueInput.id, option);
            if (usedValues.has(value)) throw invalidGraph('하나의 옵션 값을 중복해서 사용할 수 없습니다.');
            usedValues.add(value);
            return { input: valueInput, entity: value };
        });

        return { input, entity: option, values };
    });
}

/**
 * Pairs each validated item with the product's item of the same ID, soft-deleted ones included so the caller
 * can revive them, or a new row. An existing item keeps its SKU. Requires `items` to be populated.
 */
export function resolveItems(
    product: ProductEntity,
    inputs: readonly CatalogItem[],
    requireExistingItems: boolean
): ResolvedItem[] {
    const currentById = new Map(product.items.getItems().map((item) => [item.id, item]));

    return inputs.map((input) => {
        const current = input.id === undefined ? undefined : currentById.get(input.id);
        if (input.id !== undefined && !current) throw invalidGraph('이 상품에 속하지 않는 Item이 있습니다.');
        if (requireExistingItems && !current) {
            throw invalidGraph('재고를 확인할 수 없는 과거 Item은 복원할 수 없습니다.');
        }
        if (current && input.sku !== undefined && current.sku !== input.sku) {
            throw invalidGraph('기존 Item의 SKU는 변경할 수 없습니다.');
        }

        return { input, entity: current ?? createItem(product, input.sku) };
    });
}

function createOption(id: bigint | undefined, product: ProductEntity): ProductOptionEntity {
    const option = Object.assign(new ProductOptionEntity(), { product });
    if (id !== undefined) option.id = id;
    return option;
}

function createOptionValue(id: bigint | undefined, option: ProductOptionEntity): ProductOptionValueEntity {
    const value = Object.assign(new ProductOptionValueEntity(), { option });
    if (id !== undefined) value.id = id;
    return value;
}

function createItem(product: ProductEntity, sku?: string): ItemEntity {
    const item = Object.assign(new ItemEntity(), { product });
    if (sku !== undefined) item.sku = sku;
    return item;
}
