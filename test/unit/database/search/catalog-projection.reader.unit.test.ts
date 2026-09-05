import { MikroORM } from '@mikro-orm/mysql';

import { describe, expect, it, vi } from 'vitest';
import { CatalogProjectionReader } from '~/infra/search/catalog-projection.reader';

describe('Catalog projection reader', () => {
    it('hydrates a bounded live catalog batch from the primary snapshot', async () => {
        const execute = vi.fn(async (query: string) => {
            if (query.includes('FROM products p')) {
                expect(query).toContain("p.status = 'ACTIVE'");
                expect(query).toContain("i.sale_status = 'ALLOW'");
                return [
                    {
                        product_id: '1',
                        product_revision: 3,
                        seller_id: '2',
                        slug: 'keyboard',
                        name: '키보드',
                        description: null,
                        status: 'ACTIVE',
                        updated_at: new Date('2026-08-12T10:00:00.000Z'),
                        deleted_at: null,
                    },
                ];
            }
            if (query.includes('FROM items i')) {
                return [
                    {
                        product_id: '1',
                        item_id: '11',
                        sku: 'sku-1',
                        item_name: '검정',
                        total_price: '1000.000',
                        is_tax_free: 0,
                        sale_status: 'ALLOW',
                        item_sequence: 0,
                        deleted_at: null,
                        option_code: 'color',
                        value_code: 'black',
                        option_sequence: 0,
                    },
                ];
            }
            if (query.includes('WITH RECURSIVE category_tree')) {
                return [
                    {
                        product_id: '1',
                        root_category_id: '3',
                        root_name: '키보드',
                        root_slug: 'keyboards',
                        root_sequence: 0,
                        root_is_active: 1,
                        root_deleted_at: null,
                        ancestor_slug: 'keyboards',
                        ancestor_is_active: 1,
                        ancestor_deleted_at: null,
                        ancestor_parent_id: '4',
                        depth: 0,
                    },
                    {
                        product_id: '1',
                        root_category_id: '3',
                        root_name: '키보드',
                        root_slug: 'keyboards',
                        root_sequence: 0,
                        root_is_active: 1,
                        root_deleted_at: null,
                        ancestor_slug: 'electronics',
                        ancestor_is_active: 1,
                        ancestor_deleted_at: null,
                        ancestor_parent_id: null,
                        depth: 1,
                    },
                ];
            }
            if (query.includes('FROM product_tags')) return [{ product_id: '1', value: '무선', sequence: 0 }];
            if (query.includes('FROM product_media pm')) {
                return [
                    {
                        product_id: '1',
                        media_id: '5',
                        role: 'THUMBNAIL',
                        storage_key: 'keyboard.webp',
                        alt_text: null,
                        sequence: 0,
                    },
                ];
            }
            throw new Error(`Unexpected SQL: ${query}`);
        });
        const em: any = { execute };
        em.transactional = async (work: (transaction: unknown) => Promise<unknown>) => work(em);
        const orm = { em: { fork: () => em } } as unknown as MikroORM;
        const reader = new CatalogProjectionReader(orm);

        await expect(reader.fetchSearchableBatch(null, 100)).resolves.toMatchObject({
            nextCursor: 1n,
            sources: [
                {
                    id: 1n,
                    sellerId: 2n,
                    items: [{ id: 11n, options: [{ optionCode: 'color', valueCode: 'black' }] }],
                    categories: [{ id: 3n, ancestorSlugs: ['electronics', 'keyboards'] }],
                    tags: [{ value: '무선' }],
                    media: [{ id: 5n, storageKey: 'keyboard.webp' }],
                },
            ],
        });
    });
});
