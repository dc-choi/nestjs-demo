import { describe, expect, it } from 'vitest';
import { CatalogGraph } from '~/api/catalog/domain/catalog-graph';
import { ItemSaleStatus } from '~/api/catalog/domain/entity/item-sale-status';
import { ProductSearchContractError } from '~/api/catalog/search/domain/product-search-contract.error';
import { ProductSearchSort } from '~/api/catalog/search/domain/product-search-sort';
import {
    assertSearchCursorFingerprint,
    canonicalizeProductSearchInput,
    decodeSearchCursor,
    encodeSearchCursor,
    fingerprintProductSearchInput,
} from '~/api/catalog/search/domain/product-search.query';
import { buildOpenSearchProductRequest } from '~/infra/search/product-search-query.compiler';

describe('Product search query contract', () => {
    it('canonicalizes whitespace, decimals and option order before fingerprinting', () => {
        const first = canonicalizeProductSearchInput({
            query: '  무선   키보드 ',
            minPrice: '1.2',
            options: [
                { optionCode: 'switch', valueCode: 'red' },
                { optionCode: 'color', valueCode: 'black' },
            ],
        });
        const second = canonicalizeProductSearchInput({
            query: '무선 키보드',
            minPrice: '1.200',
            options: [
                { optionCode: 'color', valueCode: 'black' },
                { optionCode: 'switch', valueCode: 'red' },
            ],
            sort: ProductSearchSort.RELEVANCE,
            first: 20,
        });

        expect(first.minPrice).toBe('1.200');
        expect(first.options[0].optionCode).toBe('color');
        expect(fingerprintProductSearchInput(first)).toBe(fingerprintProductSearchInput(second));
    });

    it('rejects invalid semantic input', () => {
        expect(() => canonicalizeProductSearchInput({ minPrice: '2', maxPrice: '1' })).toThrow(
            ProductSearchContractError
        );
        expect(() =>
            canonicalizeProductSearchInput({
                options: [
                    { optionCode: 'color', valueCode: 'black' },
                    { optionCode: 'color', valueCode: 'white' },
                ],
            })
        ).toThrow('Duplicate optionCode');
    });

    it.each(['SKU/BLACK', '한글-001', 'SKU BLACK'])('searches SKU %s accepted by catalog writes', (sku) => {
        const graph = CatalogGraph.fromInput({
            options: [],
            items: [
                {
                    sku,
                    name: 'Item',
                    supplyPrice: '1000',
                    vat: '0',
                    isTaxFree: true,
                    saleStatus: ItemSaleStatus.ALLOW,
                    selectedOptions: [],
                },
            ],
            categoryIds: [],
            tags: [],
        });
        expect(canonicalizeProductSearchInput({ sku: ` ${sku} ` }).sku).toBe(graph.items[0].sku);
    });

    it('rejects blank, oversized and non-string SKU search input', () => {
        for (const sku of [' ', 'x'.repeat(256), 1 as unknown as string]) {
            expect(() => canonicalizeProductSearchInput({ sku })).toThrow(ProductSearchContractError);
        }
    });

    it('keeps price and option constraints inside one nested item query and sort', () => {
        const input = canonicalizeProductSearchInput({
            categorySlug: 'keyboards',
            minPrice: '10',
            maxPrice: '20',
            options: [{ optionCode: 'color', valueCode: 'black' }],
            sort: ProductSearchSort.PRICE_ASC,
            first: 5,
        });
        const request = buildOpenSearchProductRequest(input, 'pit-1');
        const serialized = JSON.stringify(request);

        expect(request.size).toBe(6);
        expect(serialized).toContain('categoryAncestorSlugs');
        expect(serialized).toContain('items.totalPrice');
        expect(serialized).toContain('color:black');
        expect(serialized).toContain('inner_hits');
        expect(serialized).toContain('"mode":"min"');
    });

    it('signs cursors, rejects tampering and enforces expiry and fingerprints', () => {
        const cursor = encodeSearchCursor('pit-1', [1.5, '2'], 'fingerprint', 'secret', 1_000);
        const decoded = decodeSearchCursor(cursor, 'secret', 2_000);
        expect(decoded).toEqual({ pitId: 'pit-1', sortValues: [1.5, '2'], fingerprint: 'fingerprint' });
        expect(() => decodeSearchCursor(`${cursor}x`, 'secret', 2_000)).toThrow('invalid');
        expect(() => decodeSearchCursor(cursor, 'secret', 62_000)).toThrow('expired');
        expect(() => assertSearchCursorFingerprint(decoded, 'different')).toThrow('does not match');
    });
});
