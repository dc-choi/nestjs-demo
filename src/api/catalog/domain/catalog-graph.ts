import { ItemSaleStatus } from './entity/item-sale-status';
import type { ProductSnapshotPayload } from './entity/product-snapshot-payload';
import { ProductEntity } from './entity/product.entity';
import {
    PRODUCT_CATALOG_LIMITS,
    PRODUCT_ITEM_SKU_MAX_LENGTH,
    PRODUCT_NAME_MAX_LENGTH,
    PRODUCT_OPTION_CODE_MAX_LENGTH,
    PRODUCT_OPTION_CODE_PATTERN,
    PRODUCT_PRICE_PATTERN,
    PRODUCT_TAG_MAX_LENGTH,
} from './product.rules';

import { createHash } from 'node:crypto';

const HEX_64_PATTERN = /^[0-9a-f]{64}$/;
const itemSaleStatuses = new Set<ItemSaleStatus>(Object.values(ItemSaleStatus));

export class CatalogGraphError extends Error {}

export interface CatalogGraphInput {
    readonly options: readonly CatalogOptionInput[];
    readonly items: readonly CatalogItemInput[];
    readonly categoryIds: readonly bigint[];
    readonly tags: readonly string[];
    readonly requireExistingItems?: boolean;
}

export interface CatalogOptionInput {
    readonly id?: bigint;
    readonly code: string;
    readonly name: string;
    readonly isRequired: boolean;
    readonly values: readonly CatalogOptionValueInput[];
}

export interface CatalogOptionValueInput {
    readonly id?: bigint;
    readonly code: string;
    readonly name: string;
}

export interface CatalogItemInput {
    readonly id?: bigint;
    readonly sku?: string | null;
    readonly name: string;
    readonly supplyPrice: string;
    readonly vat: string;
    readonly isTaxFree: boolean;
    readonly saleStatus: ItemSaleStatus;
    readonly selectedOptions: readonly CatalogItemSelectionInput[];
    readonly optionSignature?: string;
    readonly expectedTotalPrice?: string;
}

export interface CatalogItemSelectionInput {
    readonly optionCode: string;
    readonly valueCode: string;
}

export interface CatalogOption {
    readonly id?: bigint;
    readonly code: string;
    readonly name: string;
    readonly isRequired: boolean;
    readonly sequence: number;
    readonly values: readonly CatalogOptionValue[];
}

export interface CatalogOptionValue {
    readonly id?: bigint;
    readonly code: string;
    readonly name: string;
    readonly sequence: number;
}

export interface CatalogItem {
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
    readonly selectedOptions: readonly CatalogItemSelectionInput[];
}

/**
 * Validated product aggregate state. Graph, command, and snapshot construction all
 * pass through this model before the writer mutates ORM entities.
 */
export class CatalogGraph {
    private constructor(
        readonly options: readonly CatalogOption[],
        readonly items: readonly CatalogItem[],
        readonly categoryIds: readonly bigint[],
        readonly tags: readonly string[],
        readonly requireExistingItems: boolean
    ) {}

    static fromInput(input: CatalogGraphInput): CatalogGraph {
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
        assertUnique(existingIds(options), '옵션 ID');

        const optionByCode = new Map(options.map((option) => [option.code, option]));
        const items = input.items.map((item, sequence) => normalizeItem(item, sequence, optionByCode));
        assertUnique(existingIds(items), 'Item ID');
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

        return new CatalogGraph(options, items, [...input.categoryIds], tags, input.requireExistingItems === true);
    }

    static fromSnapshot(payload: ProductSnapshotPayload): CatalogGraph {
        return CatalogGraph.fromInput({
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
}

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

function normalizeOption(input: CatalogOptionInput, sequence: number): CatalogOption {
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
    assertUnique(existingIds(values), '옵션 값 ID');

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
    optionByCode: ReadonlyMap<string, CatalogOption>
): CatalogItem {
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
        optionSignature: input.optionSignature ?? hash(createOptionSelectionKey(selectedOptions)),
        selectedOptions: selectedOptions.toSorted(
            (left, right) => optionByCode.get(left.optionCode)!.sequence - optionByCode.get(right.optionCode)!.sequence
        ),
    };
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
    if (typeof value !== 'string' || !PRODUCT_PRICE_PATTERN.test(value))
        throw invalidGraph(`${field}가 올바르지 않습니다.`);
    const [integer, fraction = ''] = value.split('.');
    return `${integer}.${fraction.padEnd(3, '0')}`;
}

function addPrices(left: string, right: string): string {
    const total = priceToMillis(left) + priceToMillis(right);
    if (total > 9_999_999_999n) throw invalidGraph('총액이 저장 가능한 범위를 넘었습니다.');
    return `${total / 1000n}.${(total % 1000n).toString().padStart(3, '0')}`;
}

function priceToMillis(value: string): bigint {
    const [integer, fraction] = value.split('.');
    return BigInt(integer) * 1000n + BigInt(fraction);
}

function createOptionSelectionKey(selectedOptions: readonly CatalogItemSelectionInput[]): string {
    return selectedOptions
        .toSorted((left, right) => left.optionCode.localeCompare(right.optionCode))
        .map(({ optionCode, valueCode }) => `${optionCode}:${valueCode}`)
        .join('|');
}

function hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function existingIds(values: readonly { id?: bigint }[]): string[] {
    return values.flatMap(({ id }) => (id === undefined ? [] : [id.toString()]));
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
    if (id !== undefined && (typeof id !== 'bigint' || id < 1n)) throw invalidGraph(`${field}가 올바르지 않습니다.`);
    return id;
}

function parseSnapshotId(value: string): bigint {
    if (!/^[1-9]\d{0,18}$/.test(value)) throw invalidGraph('Snapshot ID가 올바르지 않습니다.');
    const id = BigInt(value);
    if (id > 9_223_372_036_854_775_807n) throw invalidGraph('Snapshot ID가 올바르지 않습니다.');
    return id;
}

function invalidGraph(message: string): CatalogGraphError {
    return new CatalogGraphError(message);
}
