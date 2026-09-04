import { Collection, EntityManager } from '@mikro-orm/core';
import { BadRequestException } from '@nestjs/common';

import type {
    CreateProductItemCommand,
    DeleteProductItemCommand,
    ReplaceProductCatalogCommand,
    ReplaceProductItemCommand,
    ReplaceProductOptionCommand,
    UpdateProductItemCommand,
} from './product-write.command';

import { createHash } from 'node:crypto';
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
import { InvalidProductChange } from '~/api/catalog/domain/product.error';
import {
    PRODUCT_CATALOG_LIMITS,
    PRODUCT_ITEM_SKU_MAX_LENGTH,
    PRODUCT_NAME_MAX_LENGTH,
    PRODUCT_OPTION_CODE_MAX_LENGTH,
    PRODUCT_OPTION_CODE_PATTERN,
    PRODUCT_PRICE_PATTERN,
    PRODUCT_TAG_MAX_LENGTH,
} from '~/api/catalog/domain/product.rules';

const MAX_UNSIGNED_INTEGER = 4_294_967_295;
const HEX_64_PATTERN = /^[0-9a-f]{64}$/;
const itemSaleStatuses = new Set<ItemSaleStatus>(Object.values(ItemSaleStatus));

interface CatalogGraphInput {
    readonly options: readonly CatalogOptionInput[];
    readonly items: readonly CatalogItemInput[];
    readonly categoryIds: readonly bigint[];
    readonly tags: readonly string[];
    readonly requireExistingItems: boolean;
}

interface CatalogOptionInput extends ReplaceProductOptionCommand {
    readonly id?: bigint;
    readonly values: readonly CatalogOptionValueInput[];
}

interface CatalogOptionValueInput {
    readonly id?: bigint;
    readonly code: string;
    readonly name: string;
}

interface CatalogItemInput extends ReplaceProductItemCommand {
    readonly optionSignature?: string;
    readonly expectedTotalPrice?: string;
}

interface NormalizedCatalogGraph {
    readonly options: readonly NormalizedOption[];
    readonly items: readonly NormalizedItem[];
    readonly categoryIds: readonly bigint[];
    readonly tags: readonly string[];
    readonly requireExistingItems: boolean;
}

interface NormalizedOption {
    readonly id?: bigint;
    readonly code: string;
    readonly name: string;
    readonly isRequired: boolean;
    readonly sequence: number;
    readonly values: readonly NormalizedOptionValue[];
}

interface NormalizedOptionValue {
    readonly id?: bigint;
    readonly code: string;
    readonly name: string;
    readonly sequence: number;
}

interface NormalizedItem {
    readonly id?: bigint;
    readonly sku?: string;
    readonly name: string;
    readonly supplyPrice: string;
    readonly vat: string;
    readonly totalPrice: string;
    readonly isTaxFree: boolean;
    readonly saleStatus: ItemSaleStatus;
    readonly sequence: number;
    readonly optionSignature: string;
    readonly selectedOptions: readonly { optionCode: string; valueCode: string }[];
}

interface ResolvedOption {
    readonly input: NormalizedOption;
    readonly entity: ProductOptionEntity;
    readonly values: readonly { input: NormalizedOptionValue; entity: ProductOptionValueEntity }[];
}

export async function replaceProductCatalogGraph(
    em: EntityManager,
    product: ProductEntity,
    command: ReplaceProductCatalogCommand
): Promise<void> {
    await replaceGraph(em, product, {
        ...command,
        requireExistingItems: false,
    });
}

export async function restoreProductCatalogGraph(
    em: EntityManager,
    product: ProductEntity,
    payload: ProductSnapshotPayload
): Promise<void> {
    await replaceGraph(em, product, {
        options: payload.options.map((option) => ({
            id: parseSnapshotId(option.id),
            code: option.code,
            name: option.name,
            isRequired: option.isRequired,
            values: option.values.map((value) => ({
                id: parseSnapshotId(value.id),
                code: value.code,
                name: value.name,
            })),
        })),
        items: payload.items.map((item) => ({
            id: parseSnapshotId(item.id),
            sku: item.sku,
            name: item.name,
            supplyPrice: item.supplyPrice,
            vat: item.vat,
            isTaxFree: item.isTaxFree,
            saleStatus: item.saleStatus,
            optionSignature: item.optionSignature,
            expectedTotalPrice: item.totalPrice,
            selectedOptions: item.selectedOptions.map(({ optionCode, valueCode }) => ({ optionCode, valueCode })),
        })),
        categoryIds: payload.categories.map(({ id }) => parseSnapshotId(id)),
        tags: payload.tags.map(({ value }) => value),
        requireExistingItems: true,
    });
}

export async function createProductItem(
    em: EntityManager,
    product: ProductEntity,
    command: CreateProductItemCommand
): Promise<void> {
    if (command.item.id !== undefined) throw invalidGraph('새 Item에는 ID를 지정할 수 없습니다.');

    const graph = currentGraphInput(product);
    await replaceGraph(em, product, { ...graph, items: [...graph.items, command.item] });
}

export async function updateProductItem(
    em: EntityManager,
    product: ProductEntity,
    command: UpdateProductItemCommand
): Promise<void> {
    assertCurrentItem(product, command.item.id);
    const graph = currentGraphInput(product);
    await replaceGraph(em, product, {
        ...graph,
        items: graph.items.map((item) => (item.id === command.item.id ? command.item : item)),
    });
}

export async function deleteProductItem(
    em: EntityManager,
    product: ProductEntity,
    command: DeleteProductItemCommand
): Promise<void> {
    assertCurrentItem(product, command.itemId);
    const graph = currentGraphInput(product);
    await replaceGraph(em, product, {
        ...graph,
        items: graph.items.filter(({ id }) => id !== command.itemId),
    });
}

function currentGraphInput(product: ProductEntity): CatalogGraphInput {
    return {
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
                (left, right) => left.sequence - right.sequence || compareBigInt(left.category.id, right.category.id)
            )
            .map(({ category }) => category.id),
        tags: product.tags
            .getItems()
            .toSorted((left, right) => left.sequence - right.sequence || left.value.localeCompare(right.value))
            .map(({ value }) => value),
        requireExistingItems: false,
    };
}

function assertCurrentItem(product: ProductEntity, itemId: bigint): void {
    const item = product.items.getItems().find(({ id }) => id === itemId);
    if (!item || item.deletedAt !== null) throw invalidGraph('이 상품에 속한 현재 Item이 아닙니다.');
}

async function replaceGraph(em: EntityManager, product: ProductEntity, input: CatalogGraphInput): Promise<void> {
    const graph = normalizeGraph(input);
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

function normalizeGraph(input: CatalogGraphInput): NormalizedCatalogGraph {
    assertMaxSize(input.options, PRODUCT_CATALOG_LIMITS.options, '옵션');
    assertMaxSize(input.items, PRODUCT_CATALOG_LIMITS.items, 'Item');
    assertMaxSize(input.categoryIds, PRODUCT_CATALOG_LIMITS.categories, '카테고리');
    assertMaxSize(input.tags, PRODUCT_CATALOG_LIMITS.tags, '태그');
    assertUnique(input.categoryIds.map(String), '카테고리 ID');
    input.categoryIds.forEach((id) => assertPositiveId(id, '카테고리 ID'));

    const options = input.options.map((option, sequence) => normalizeOption(option, sequence));
    assertUnique(
        options.map(({ code }) => code),
        '옵션 code'
    );
    assertUnique(
        options.map(({ name }) => name),
        '옵션 이름'
    );
    assertUnique(
        options.flatMap(({ id }) => (id === undefined ? [] : [id.toString()])),
        '옵션 ID'
    );

    const optionByCode = new Map(options.map((option) => [option.code, option]));
    const items = input.items.map((item, sequence) => normalizeItem(item, sequence, optionByCode));
    assertUnique(
        items.flatMap(({ id }) => (id === undefined ? [] : [id.toString()])),
        'Item ID'
    );
    assertUnique(
        items.flatMap(({ sku }) => (sku === undefined ? [] : [sku])),
        'SKU'
    );
    assertUnique(
        items.map(({ optionSignature }) => optionSignature),
        'Item 옵션 조합'
    );
    assertUnique(
        items.map(({ selectedOptions }) => createOptionSelectionKey(selectedOptions)),
        'Item 옵션 조합'
    );

    const tags = input.tags.map((tag) => normalizeRequiredText(tag, '태그', PRODUCT_TAG_MAX_LENGTH));
    assertUnique(tags, '태그');

    return {
        options,
        items,
        categoryIds: input.categoryIds,
        tags,
        requireExistingItems: input.requireExistingItems,
    };
}

function normalizeOption(input: CatalogOptionInput, sequence: number): NormalizedOption {
    assertPositiveId(input.id, '옵션 ID');
    if (typeof input.isRequired !== 'boolean') throw invalidGraph('필수 옵션 여부가 올바르지 않습니다.');
    assertMaxSize(input.values, PRODUCT_CATALOG_LIMITS.optionValues, '옵션 값');
    if (input.values.length === 0) throw invalidGraph('옵션은 하나 이상의 값이 필요합니다.');

    const values = input.values.map((value, valueSequence) => ({
        id: assertPositiveId(value.id, '옵션 값 ID'),
        code: normalizeCode(value.code, '옵션 값 code'),
        name: normalizeRequiredText(value.name, '옵션 값 이름', PRODUCT_NAME_MAX_LENGTH),
        sequence: valueSequence,
    }));
    assertUnique(
        values.map(({ code }) => code),
        '옵션 값 code'
    );
    assertUnique(
        values.map(({ name }) => name),
        '옵션 값 이름'
    );
    assertUnique(
        values.flatMap(({ id }) => (id === undefined ? [] : [id.toString()])),
        '옵션 값 ID'
    );

    return {
        id: input.id,
        code: normalizeCode(input.code, '옵션 code'),
        name: normalizeRequiredText(input.name, '옵션 이름', PRODUCT_NAME_MAX_LENGTH),
        isRequired: input.isRequired,
        sequence,
        values,
    };
}

function normalizeItem(
    input: CatalogItemInput,
    sequence: number,
    optionByCode: ReadonlyMap<string, NormalizedOption>
): NormalizedItem {
    assertPositiveId(input.id, 'Item ID');
    assertMaxSize(input.selectedOptions, PRODUCT_CATALOG_LIMITS.options, '선택 옵션');
    if (typeof input.isTaxFree !== 'boolean') throw invalidGraph('면세 여부가 올바르지 않습니다.');
    if (!itemSaleStatuses.has(input.saleStatus)) throw invalidGraph('Item 판매 상태가 올바르지 않습니다.');

    const selectedOptions = input.selectedOptions.map(({ optionCode, valueCode }) => ({
        optionCode: normalizeCode(optionCode, '선택 옵션 code'),
        valueCode: normalizeCode(valueCode, '선택 옵션 값 code'),
    }));
    assertUnique(
        selectedOptions.map(({ optionCode }) => optionCode),
        '선택 옵션 code'
    );

    for (const { optionCode, valueCode } of selectedOptions) {
        const option = optionByCode.get(optionCode);
        if (!option || !option.values.some(({ code }) => code === valueCode)) {
            throw invalidGraph(`옵션 선택 ${optionCode}:${valueCode}이(가) 상품 옵션과 일치하지 않습니다.`);
        }
    }
    for (const option of optionByCode.values()) {
        if (option.isRequired && !selectedOptions.some(({ optionCode }) => optionCode === option.code)) {
            throw invalidGraph(`필수 옵션 ${option.code}의 값이 필요합니다.`);
        }
    }

    const supplyPrice = normalizePrice(input.supplyPrice, '공급가');
    const vat = normalizePrice(input.vat, '부가세');
    if (input.isTaxFree && vat !== '0.000') throw invalidGraph('면세 Item의 부가세는 0이어야 합니다.');
    const totalPrice = addPrices(supplyPrice, vat);
    if (input.expectedTotalPrice !== undefined && normalizePrice(input.expectedTotalPrice, '총액') !== totalPrice) {
        throw invalidGraph('Snapshot Item의 가격 합계가 일치하지 않습니다.');
    }

    const calculatedSignature = createOptionSignature(selectedOptions);
    if (input.optionSignature !== undefined && !HEX_64_PATTERN.test(input.optionSignature)) {
        throw invalidGraph('Snapshot Item의 옵션 서명이 올바르지 않습니다.');
    }

    return {
        id: input.id,
        sku: normalizeOptionalSku(input.sku),
        name: normalizeRequiredText(input.name, 'Item 이름', PRODUCT_NAME_MAX_LENGTH),
        supplyPrice,
        vat,
        totalPrice,
        isTaxFree: input.isTaxFree,
        saleStatus: input.saleStatus,
        sequence,
        optionSignature: input.optionSignature ?? calculatedSignature,
        selectedOptions: selectedOptions.toSorted(
            (left, right) => optionByCode.get(left.optionCode)!.sequence - optionByCode.get(right.optionCode)!.sequence
        ),
    };
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

function resolveOptions(product: ProductEntity, inputs: readonly NormalizedOption[]): ResolvedOption[] {
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
    inputs: readonly NormalizedItem[],
    requireExistingItems: boolean
): Array<{ input: NormalizedItem; entity: ItemEntity }> {
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
    resolvedItems: readonly { input: NormalizedItem; entity: ItemEntity }[]
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
    resolvedItems: readonly { input: NormalizedItem; entity: ItemEntity }[],
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

function normalizeCode(value: string, field: string): string {
    const code = normalizeRequiredText(value, field, PRODUCT_OPTION_CODE_MAX_LENGTH);
    if (!PRODUCT_OPTION_CODE_PATTERN.test(code)) throw invalidGraph(`${field}가 올바르지 않습니다.`);
    return code;
}

function normalizeRequiredText(value: string, field: string, maxLength: number): string {
    if (typeof value !== 'string') throw invalidGraph(`${field}이(가) 문자열이어야 합니다.`);
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength) throw invalidGraph(`${field}의 길이가 올바르지 않습니다.`);
    return normalized;
}

function normalizeOptionalSku(value?: string | null): string | undefined {
    if (value === null || value === undefined) return undefined;
    return normalizeRequiredText(value, 'SKU', PRODUCT_ITEM_SKU_MAX_LENGTH);
}

function normalizePrice(value: string, field: string): string {
    if (typeof value !== 'string' || !PRODUCT_PRICE_PATTERN.test(value)) {
        throw invalidGraph(`${field}가 올바르지 않습니다.`);
    }

    const [integer, fraction = ''] = value.split('.');
    return `${integer}.${fraction.padEnd(3, '0')}`;
}

function addPrices(left: string, right: string): string {
    const total = priceToMillis(left) + priceToMillis(right);
    if (total > 9_999_999_999n) throw invalidGraph('총액이 저장 가능한 범위를 넘었습니다.');
    const integer = total / 1000n;
    const fraction = (total % 1000n).toString().padStart(3, '0');
    return `${integer}.${fraction}`;
}

function priceToMillis(value: string): bigint {
    const [integer, fraction] = value.split('.');
    return BigInt(integer) * 1000n + BigInt(fraction);
}

function createOptionSignature(selectedOptions: readonly { optionCode: string; valueCode: string }[]): string {
    return hash(createOptionSelectionKey(selectedOptions));
}

function createOptionSelectionKey(selectedOptions: readonly { optionCode: string; valueCode: string }[]): string {
    return selectedOptions
        .toSorted((left, right) => left.optionCode.localeCompare(right.optionCode))
        .map(({ optionCode, valueCode }) => `${optionCode}:${valueCode}`)
        .join('|');
}

function hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function compareSequenceAndId(left: { sequence: number; id: bigint }, right: { sequence: number; id: bigint }): number {
    return left.sequence - right.sequence || compareBigInt(left.id, right.id);
}

function compareBigInt(left: bigint, right: bigint): number {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}

function assertMaxSize(values: readonly unknown[], max: number, field: string): void {
    if (!Array.isArray(values) || values.length > max) throw invalidGraph(`${field} 수가 올바르지 않습니다.`);
}

function assertUnique(values: readonly string[], field: string): void {
    if (new Set(values).size !== values.length) throw invalidGraph(`${field}이(가) 중복됩니다.`);
}

function assertPositiveId(id: bigint | undefined, field: string): bigint | undefined {
    if (id !== undefined && (typeof id !== 'bigint' || id < 1n)) {
        throw invalidGraph(`${field}가 올바르지 않습니다.`);
    }
    return id;
}

function parseSnapshotId(value: string): bigint {
    if (!/^[1-9]\d{0,18}$/.test(value)) throw invalidGraph('Snapshot ID가 올바르지 않습니다.');
    const id = BigInt(value);
    if (id > 9_223_372_036_854_775_807n) throw invalidGraph('Snapshot ID가 올바르지 않습니다.');
    return id;
}

function invalidGraph(message: string): BadRequestException {
    return new BadRequestException(new InvalidProductChange(message));
}
