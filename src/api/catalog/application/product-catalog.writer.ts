import { Collection, EntityManager, LockMode } from '@mikro-orm/core';

import type {
    CreateProductItemCommand,
    DeleteProductItemCommand,
    ReplaceProductCatalogCommand,
    UpdateProductItemCommand,
} from './product-write.command.js';

import { createHash } from 'node:crypto';
import { CatalogGraphChange } from '~/api/catalog/domain/catalog-graph-change.js';
import {
    type ResolvedItem,
    type ResolvedOption,
    resolveItems,
    resolveOptions,
} from '~/api/catalog/domain/catalog-graph-resolution.js';
import { CatalogGraph, invalidGraph } from '~/api/catalog/domain/catalog-graph.js';
import { CategoryEntity } from '~/api/catalog/domain/entity/category.entity.js';
import { ItemOptionValueEntity } from '~/api/catalog/domain/entity/item-option-value.entity.js';
import { ProductCategoryEntity } from '~/api/catalog/domain/entity/product-category.entity.js';
import { ProductOptionValueEntity } from '~/api/catalog/domain/entity/product-option-value.entity.js';
import { ProductOptionEntity } from '~/api/catalog/domain/entity/product-option.entity.js';
import type { ProductSnapshotPayload } from '~/api/catalog/domain/entity/product-snapshot-payload.js';
import { ProductTagEntity } from '~/api/catalog/domain/entity/product-tag.entity.js';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity.js';

const MAX_UNSIGNED_INTEGER = 4_294_967_295;

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

    await stageOptions(em, product, resolvedOptions);
    stageItems(product);
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

async function stageOptions(
    em: EntityManager,
    product: ProductEntity,
    resolved: readonly ResolvedOption[]
): Promise<void> {
    const options = product.options.getItems();
    const incomingKeys = resolved.flatMap(({ input }) => [input.code, input.name]);
    const optionKeys = await unusedStagingKeys(
        options.length,
        async (keys) =>
            (await collidesWithIncoming(em, 'product_options', incomingKeys, keys)) ||
            (
                await em.find(
                    ProductOptionEntity,
                    {
                        product: product.id,
                        $or: [{ code: { $in: keys } }, { name: { $in: keys } }],
                    },
                    { limit: 1, lockMode: LockMode.PESSIMISTIC_READ }
                )
            ).length > 0
    );
    const valueKeys: string[][] = [];
    for (const option of options) {
        const incomingValueKeys =
            resolved.find(({ entity }) => entity === option)?.values.flatMap(({ input }) => [input.code, input.name]) ??
            [];
        valueKeys.push(
            await unusedStagingKeys(
                option.values.length,
                async (keys) =>
                    (await collidesWithIncoming(em, 'product_option_values', incomingValueKeys, keys)) ||
                    (
                        await em.find(
                            ProductOptionValueEntity,
                            {
                                option: option.id,
                                $or: [{ code: { $in: keys } }, { name: { $in: keys } }],
                            },
                            { limit: 1, lockMode: LockMode.PESSIMISTIC_READ }
                        )
                    ).length > 0
            )
        );
    }

    options.forEach((option, optionIndex) => {
        option.code = optionKeys[optionIndex];
        option.name = optionKeys[optionIndex];
        option.sequence = MAX_UNSIGNED_INTEGER - optionIndex;
        option.values.getItems().forEach((value, valueIndex) => {
            value.code = valueKeys[optionIndex][valueIndex];
            value.name = valueKeys[optionIndex][valueIndex];
            value.sequence = MAX_UNSIGNED_INTEGER - valueIndex;
        });
    });
}

async function collidesWithIncoming(
    em: EntityManager,
    table: 'product_options' | 'product_option_values',
    incoming: readonly string[],
    keys: readonly string[]
): Promise<boolean> {
    if (incoming.length === 0) return false;
    // The empty table arm gives bound incoming names the column's MySQL collation.
    const rows: unknown[] = await em
        .getConnection('write')
        .execute(
            `SELECT 1 FROM (SELECT name FROM ${table} WHERE 1 = 0${incoming.map(() => ' UNION ALL SELECT ?').join('')}) incoming WHERE name IN (${keys.map(() => '?').join(', ')}) LIMIT 1`,
            [...incoming, ...keys],
            'all',
            em.getTransactionContext()
        );
    return rows.length > 0;
}

async function unusedStagingKeys(count: number, exists: (keys: string[]) => Promise<boolean>): Promise<string[]> {
    if (count === 0) return [];
    let start = 0;
    while (true) {
        const keys = Array.from({ length: count }, (_, index) => `!${start + index}`);
        if (!(await exists(keys))) return keys;
        start += count;
    }
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

function applyItems(em: EntityManager, product: ProductEntity, resolvedItems: readonly ResolvedItem[]): void {
    const allItems = product.items.getItems();
    const retainedItems = new Set(resolvedItems.map(({ entity }) => entity));
    const now = new Date();
    allItems.filter((item) => !retainedItems.has(item)).forEach((item) => item.retire(now));

    for (const { input, entity: item } of resolvedItems) {
        // A retained ID may point at a soft-deleted row of this product; it comes back with its SKU and stock.
        item.revive();
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
        });
        if (input.sku !== undefined && item.sku === undefined) item.sku = input.sku;
        em.persist(item);
    }
    product.items = new Collection(product, [...new Set([...allItems, ...retainedItems])]);
}

function applyItemSelections(
    em: EntityManager,
    product: ProductEntity,
    resolvedItems: readonly ResolvedItem[],
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

function hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}
