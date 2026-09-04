import { CatalogProjectionError, projectCatalogProduct } from '~/api/catalog/search/domain/catalog-projector';
import { CatalogProductProjectionSource } from '~/api/catalog/search/domain/product-search.document';

describe('Catalog projector', () => {
    it('projects only live sellable items and deterministic catalog relations', () => {
        const source = createSource();
        source.items.push({ ...source.items[0], id: 12n, saleStatus: 'DENY', totalPrice: '1.000' });
        source.categories.push({
            id: 21n,
            name: '키보드',
            slug: 'keyboards',
            sequence: 0,
            ancestorSlugs: ['electronics', 'keyboards'],
            isActive: true,
            deletedAt: null,
        });
        source.tags.push({ value: '무선', sequence: 0 }, { value: '키보드', sequence: 1 });
        source.media.push(
            {
                id: 32n,
                role: 'THUMBNAIL',
                storageKey: 'later.webp',
                altText: null,
                sequence: 1,
            },
            {
                id: 31n,
                role: 'THUMBNAIL',
                storageKey: 'first.webp',
                altText: '대표 이미지',
                sequence: 0,
            }
        );

        expect(projectCatalogProduct(source)).toEqual({
            schemaVersion: 1,
            productId: '1',
            productRevision: 7,
            sellerId: '2',
            slug: 'wireless-keyboard',
            updatedAt: '2026-08-12T10:00:00.000Z',
            name: '무선 키보드',
            description: '저소음 키보드',
            tags: ['무선', '키보드'],
            categoryIds: ['21'],
            categorySlugs: ['keyboards'],
            categoryNames: ['키보드'],
            categoryAncestorSlugs: ['electronics', 'keyboards'],
            thumbnail: { storageKey: 'first.webp', altText: '대표 이미지' },
            minPrice: 89000,
            maxPrice: 89000,
            items: [
                {
                    itemId: '11',
                    sku: 'sku-1',
                    name: '검정, 적축',
                    sequence: 0,
                    totalPrice: 89000,
                    isTaxFree: false,
                    optionTokens: ['color:black', 'switch:red'],
                },
            ],
        });
    });

    it('returns null for a product without a live sellable item', () => {
        const source = createSource();
        source.items[0].deletedAt = new Date();
        expect(projectCatalogProduct(source)).toBeNull();
    });

    it('rejects more than 100 searchable items instead of truncating', () => {
        const source = createSource();
        source.items = Array.from({ length: 101 }, (_, index) => ({
            ...source.items[0],
            id: BigInt(index + 1),
            sequence: index,
        }));
        expect(() => projectCatalogProduct(source)).toThrow(CatalogProjectionError);
    });

    it('rejects option codes that cannot form an unambiguous token', () => {
        const source = createSource();
        source.items[0].options[0].optionCode = 'Color';
        expect(() => projectCatalogProduct(source)).toThrow('invalid option code');
    });
});

function createSource(): CatalogProductProjectionSource {
    return {
        id: 1n,
        revision: 7,
        sellerId: 2n,
        slug: 'wireless-keyboard',
        name: '무선 키보드',
        description: '저소음 키보드',
        status: 'ACTIVE',
        updatedAt: new Date('2026-08-12T10:00:00.000Z'),
        deletedAt: null,
        items: [
            {
                id: 11n,
                sku: 'sku-1',
                name: '검정, 적축',
                totalPrice: '89000.000',
                isTaxFree: false,
                saleStatus: 'ALLOW',
                sequence: 0,
                deletedAt: null,
                options: [
                    { optionCode: 'color', valueCode: 'black', sequence: 0 },
                    { optionCode: 'switch', valueCode: 'red', sequence: 1 },
                ],
            },
        ],
        categories: [],
        tags: [],
        media: [],
    };
}
