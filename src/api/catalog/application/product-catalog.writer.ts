import { Collection, EntityManager } from '@mikro-orm/core';

import type {
    CreateProductItemCommand,
    DeleteProductItemCommand,
    ReplaceProductCatalogCommand,
    UpdateProductItemCommand,
} from './product-write.command';

import { createHash } from 'node:crypto';
import {
    CatalogGraph,
    CatalogGraphChange,
    CatalogGraphError,
    type CatalogItem,
    type CatalogOption,
} from '~/api/catalog/domain/catalog-graph';
import { CategoryEntity } from '~/api/catalog/domain/entity/category.entity';
import { ItemOptionValueEntity } from '~/api/catalog/domain/entity/item-option-value.entity';
import { ItemSaleStatus } from '~/api/catalog/domain/entity/item-sale-status';
import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { ProductCategoryEntity } from '~/api/catalog/domain/entity/product-category.entity';
import { ProductOptionValueEntity } from '~/api/catalog/domain/entity/product-option-value.entity';
import { ProductOptionEntity } from '~/api/catalog/domain/entity/product-option.entity';
import type { ProductSnapshotPayload } from '~/api/catalog/domain/entity/product-snapshot-payload';
import { ProductTagEntity } from '~/api/catalog/domain/entity/product-tag.entity';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';

const MAX_UNSIGNED_INTEGER = 4_294_967_295;

interface ResolvedOption {
    readonly input: CatalogOption;
    readonly entity: ProductOptionEntity;
    readonly values: readonly { input: CatalogOption['values'][number]; entity: ProductOptionValueEntity }[];
}

export async function replaceProductCatalogGraph(
    em: EntityManager,
    product: ProductEntity,
    command: ReplaceProductCatalogCommand
): Promise<void> {
    await replaceGraph(em, product, CatalogGraph.fromInput(command));
}

export async function restoreProductCatalogGraph(
    em: EntityManager,
    product: ProductEntity,
    payload: ProductSnapshotPayload
): Promise<void> {
    await replaceGraph(em, product, CatalogGraph.fromSnapshot(payload));
}

export async function createProductItem(
    em: EntityManager,
    product: ProductEntity,
    command: CreateProductItemCommand
): Promise<void> {
    await replaceGraph(em, product, CatalogGraphChange.fromProduct(product).withAddedItem(command.item));
}

export async function updateProductItem(
    em: EntityManager,
    product: ProductEntity,
    command: UpdateProductItemCommand
): Promise<void> {
    await replaceGraph(em, product, CatalogGraphChange.fromProduct(product).withUpdatedItem(command.item));
}

export async function deleteProductItem(
    em: EntityManager,
    product: ProductEntity,
    command: DeleteProductItemCommand
): Promise<void> {
    await replaceGraph(em, product, CatalogGraphChange.fromProduct(product).withoutItem(command.itemId));
}

async function replaceGraph(em: EntityManager, product: ProductEntity, graph: CatalogGraph): Promise<void> {
    const categories = await loadCategories(em, graph.categoryIds);
    const resolvedOptions = resolveOptions(product, graph.options);
    const resolvedItems = resolveItems(product, graph.items, graph.requireExistingItems);
    const resolvedCategories = resolveCategories(product, categories);
    const resolvedTags = resolveTags(product, graph.tags);

    stageItems(product);
    stageOptions(product);
    stageCategories(product);

    const selections = product.items.getItems().flatMap((item) => item.optionValues.getItems());
    product.items.getItems().forEach((item) => (item.optionValues = new Collection(item)));
    if (selections.length > 0) em.remove(selections);
    await em.flush();

    removeUnusedOptions(em, product, resolvedOptions);
    removeUnusedCategoriesAndTags(em, product, resolvedCategories, resolvedTags);
    await em.flush();

    applyOptions(em, product, resolvedOptions);
    applyCategoriesAndTags(em, product, resolvedCategories, resolvedTags);
    await em.flush();

    applyItems(em, product, resolvedItems);
    await em.flush();

    applyItemSelections(em, product, resolvedItems, resolvedOptions);
    await em.flush();
}

async function loadCategories(em: EntityManager, categoryIds: readonly bigint[]): Promise<CategoryEntity[]> {
    if (categoryIds.length === 0) return [];

    const categories = await em.find(CategoryEntity, {
        id: { $in: categoryIds },
        isActive: true,
        deletedAt: null,
    });
    if (categories.length !== categoryIds.length) throw invalidGraph('유효하지 않은 카테고리가 있습니다.');

    await populateCategoryAncestors(em, categories);
    const byId = new Map(categories.map((category) => [category.id, category]));
    return categoryIds.map((id) => byId.get(id)!);
}

function resolveOptions(product: ProductEntity, inputs: readonly CatalogOption[]): ResolvedOption[] {
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

function resolveItems(
    product: ProductEntity,
    inputs: readonly CatalogItem[],
    requireExistingItems: boolean
): Array<{ input: CatalogItem; entity: ItemEntity }> {
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

function resolveCategories(product: ProductEntity, categories: readonly CategoryEntity[]) {
    const currentById = new Map(product.categories.getItems().map((placement) => [placement.category.id, placement]));
    return categories.map((category) => ({
        category,
        entity:
            currentById.get(category.id) ??
            Object.assign(new ProductCategoryEntity(), { product, category, sequence: 0 }),
    }));
}

function resolveTags(product: ProductEntity, tags: readonly string[]) {
    const currentByValue = new Map(product.tags.getItems().map((tag) => [tag.value, tag]));
    return tags.map((value) => ({
        value,
        entity: currentByValue.get(value) ?? Object.assign(new ProductTagEntity(), { product, value, sequence: 0 }),
    }));
}

function stageItems(product: ProductEntity): void {
    const usedSequences = new Set(product.items.getItems().map(({ sequence }) => sequence));
    const usedSignatures = new Set(product.items.getItems().map(({ optionSignature }) => optionSignature));
    let sequence = MAX_UNSIGNED_INTEGER;

    for (const item of product.items.getItems()) {
        while (usedSequences.has(sequence)) sequence -= 1;
        item.sequence = sequence;
        usedSequences.add(sequence);
        sequence -= 1;

        let nonce = 0;
        do {
            item.optionSignature = hash(`staging:${product.id}:${item.id}:${product.revision}:${nonce}`);
            nonce += 1;
        } while (usedSignatures.has(item.optionSignature));
        usedSignatures.add(item.optionSignature);
    }
}

function stageOptions(product: ProductEntity): void {
    product.options.getItems().forEach((option, optionIndex) => {
        option.code = `staging-${option.id}`;
        option.name = `staging-${option.id}`;
        option.sequence = MAX_UNSIGNED_INTEGER - optionIndex;
        option.values.getItems().forEach((value, valueIndex) => {
            value.code = `staging-${value.id}`;
            value.name = `staging-${value.id}`;
            value.sequence = MAX_UNSIGNED_INTEGER - valueIndex;
        });
    });
}

function stageCategories(product: ProductEntity): void {
    product.categories.getItems().forEach((placement, index) => {
        placement.sequence = MAX_UNSIGNED_INTEGER - index;
    });
    product.tags.getItems().forEach((tag, index) => {
        tag.sequence = MAX_UNSIGNED_INTEGER - index;
    });
}

function removeUnusedOptions(em: EntityManager, product: ProductEntity, resolved: readonly ResolvedOption[]): void {
    const retainedOptions = new Set(resolved.map(({ entity }) => entity));
    const retainedValues = new Set(resolved.flatMap(({ values }) => values.map(({ entity }) => entity)));
    const removedValues = product.options
        .getItems()
        .flatMap((option) => option.values.getItems())
        .filter((value) => !retainedValues.has(value));
    const removedOptions = product.options.getItems().filter((option) => !retainedOptions.has(option));

    if (removedValues.length > 0) em.remove(removedValues);
    if (removedOptions.length > 0) em.remove(removedOptions);
}

function removeUnusedCategoriesAndTags(
    em: EntityManager,
    product: ProductEntity,
    categories: readonly { entity: ProductCategoryEntity }[],
    tags: readonly { entity: ProductTagEntity }[]
): void {
    const retainedCategories = new Set(categories.map(({ entity }) => entity));
    const retainedTags = new Set(tags.map(({ entity }) => entity));
    const removedCategories = product.categories.getItems().filter((entity) => !retainedCategories.has(entity));
    const removedTags = product.tags.getItems().filter((entity) => !retainedTags.has(entity));

    if (removedCategories.length > 0) em.remove(removedCategories);
    if (removedTags.length > 0) em.remove(removedTags);
}

function applyOptions(em: EntityManager, product: ProductEntity, resolved: readonly ResolvedOption[]): void {
    for (const { input, entity: option, values } of resolved) {
        Object.assign(option, {
            product,
            code: input.code,
            name: input.name,
            isRequired: input.isRequired,
            sequence: input.sequence,
        });
        for (const { input: valueInput, entity: value } of values) {
            Object.assign(value, {
                option,
                code: valueInput.code,
                name: valueInput.name,
                sequence: valueInput.sequence,
            });
        }
        option.values = new Collection(
            option,
            values.map(({ entity }) => entity)
        );
        em.persist([option, ...values.map(({ entity }) => entity)]);
    }
    product.options = new Collection(
        product,
        resolved.map(({ entity }) => entity)
    );
}

function applyCategoriesAndTags(
    em: EntityManager,
    product: ProductEntity,
    categories: readonly { category: CategoryEntity; entity: ProductCategoryEntity }[],
    tags: readonly { value: string; entity: ProductTagEntity }[]
): void {
    categories.forEach(({ category, entity }, sequence) => {
        Object.assign(entity, { product, category, sequence });
        em.persist(entity);
    });
    tags.forEach(({ value, entity }, sequence) => {
        Object.assign(entity, { product, value, sequence });
        em.persist(entity);
    });
    product.categories = new Collection(
        product,
        categories.map(({ entity }) => entity)
    );
    product.tags = new Collection(
        product,
        tags.map(({ entity }) => entity)
    );
}

function applyItems(
    em: EntityManager,
    product: ProductEntity,
    resolvedItems: readonly { input: CatalogItem; entity: ItemEntity }[]
): void {
    const allItems = product.items.getItems();
    const retainedItems = new Set(resolvedItems.map(({ entity }) => entity));
    const now = new Date();
    allItems
        .filter((item) => !retainedItems.has(item))
        .forEach((item) => {
            item.saleStatus = ItemSaleStatus.DENY;
            item.deletedAt ??= now;
        });

    for (const { input, entity: item } of resolvedItems) {
        Object.assign(item, {
            product,
            name: input.name,
            supplyPrice: input.supplyPrice,
            vat: input.vat,
            totalPrice: input.totalPrice,
            isTaxFree: input.isTaxFree,
            saleStatus: input.saleStatus,
            sequence: input.sequence,
            optionSignature: input.optionSignature,
            deletedAt: null,
        });
        if (input.sku !== undefined && item.sku === undefined) item.sku = input.sku;
        em.persist(item);
    }
    product.items = new Collection(product, [...new Set([...allItems, ...retainedItems])]);
}

function applyItemSelections(
    em: EntityManager,
    product: ProductEntity,
    resolvedItems: readonly { input: CatalogItem; entity: ItemEntity }[],
    resolvedOptions: readonly ResolvedOption[]
): void {
    const optionByCode = new Map(resolvedOptions.map((option) => [option.input.code, option]));

    for (const { input, entity: item } of resolvedItems) {
        const selections = input.selectedOptions.map(({ optionCode, valueCode }) => {
            const resolvedOption = optionByCode.get(optionCode)!;
            const option = resolvedOption.entity;
            const value = resolvedOption.values.find(({ input: candidate }) => candidate.code === valueCode)!.entity;

            return Object.assign(new ItemOptionValueEntity(), {
                productId: product.id,
                item,
                option,
                value,
            });
        });
        item.optionValues = new Collection(item, selections);
        if (selections.length > 0) em.persist(selections);
    }
}

export async function populateCategoryAncestors(em: EntityManager, categories: CategoryEntity[]): Promise<void> {
    const populatedIds = new Set<bigint>();
    let level = categories;

    while (level.length > 0) {
        const unpopulated = level.filter(({ id }) => !populatedIds.has(id));
        if (unpopulated.length === 0) return;

        unpopulated.forEach(({ id }) => populatedIds.add(id));
        await em.populate(unpopulated, ['parent'], { refresh: true });
        level = unpopulated.flatMap(({ parent }) => (parent ? [parent] : []));
    }
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
    const item = Object.assign(new ItemEntity(), { product, stock: 0, deletedAt: null });
    if (sku !== undefined) item.sku = sku;
    return item;
}

function hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function invalidGraph(message: string): CatalogGraphError {
    return new CatalogGraphError(message);
}
