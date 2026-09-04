import { IsolationLevel } from '@mikro-orm/core';
import { EntityManager, MikroORM } from '@mikro-orm/mysql';
import { Injectable } from '@nestjs/common';

import {
    CatalogCategoryProjectionSource,
    CatalogItemProjectionSource,
    CatalogMediaProjectionSource,
    CatalogProductProjectionSource,
} from '~/api/catalog/search/domain/product-search.document';

interface ProductRow {
    product_id: unknown;
    product_revision: unknown;
    seller_id: unknown;
    slug: unknown;
    name: unknown;
    description: unknown;
    status: unknown;
    updated_at: unknown;
    deleted_at: unknown;
}

interface ItemRow {
    product_id: unknown;
    item_id: unknown;
    sku: unknown;
    item_name: unknown;
    total_price: unknown;
    is_tax_free: unknown;
    sale_status: unknown;
    item_sequence: unknown;
    deleted_at: unknown;
    option_code: unknown;
    value_code: unknown;
    option_sequence: unknown;
}

interface CategoryRow {
    product_id: unknown;
    root_category_id: unknown;
    root_name: unknown;
    root_slug: unknown;
    root_sequence: unknown;
    root_is_active: unknown;
    root_deleted_at: unknown;
    ancestor_slug: unknown;
    ancestor_is_active: unknown;
    ancestor_deleted_at: unknown;
    ancestor_parent_id: unknown;
    depth: unknown;
}

interface TagRow {
    product_id: unknown;
    value: unknown;
    sequence: unknown;
}

interface MediaRow {
    product_id: unknown;
    media_id: unknown;
    role: unknown;
    storage_key: unknown;
    alt_text: unknown;
    sequence: unknown;
}

export interface CatalogProjectionBatch {
    sources: CatalogProductProjectionSource[];
    nextCursor: bigint | null;
}

@Injectable()
export class CatalogProjectionReader {
    constructor(private readonly orm: MikroORM) {}

    async fetchSearchableBatch(afterId: bigint | null, limit: number): Promise<CatalogProjectionBatch> {
        validateBatchSize(limit);
        return this.withPrimarySnapshot(async (em) => {
            const rows = await em.execute<ProductRow[]>(
                `SELECT CAST(p.id AS CHAR) AS product_id,
                        p.revision AS product_revision,
                        CAST(p.seller_id AS CHAR) AS seller_id,
                        p.slug,
                        p.name,
                        p.description,
                        p.status,
                        p.updated_at,
                        p.deleted_at
                   FROM products p
                  WHERE p.id > ?
                    AND p.status = 'ACTIVE'
                    AND p.deleted_at IS NULL
                    AND EXISTS (
                        SELECT 1
                          FROM items i
                         WHERE i.product_id = p.id
                           AND i.sale_status = 'ALLOW'
                           AND i.deleted_at IS NULL
                    )
                  ORDER BY p.id
                  LIMIT ?`,
                [(afterId ?? 0n).toString(), limit]
            );
            const sources = await this.hydrate(em, rows);
            return { sources, nextCursor: sources.at(-1)?.id ?? null };
        });
    }

    async findById(productId: bigint): Promise<CatalogProductProjectionSource | null> {
        return this.withPrimarySnapshot(async (em) => {
            const rows = await this.selectProductsByIds(em, [productId]);
            return (await this.hydrate(em, rows))[0] ?? null;
        });
    }

    async findByIds(productIds: readonly bigint[]): Promise<CatalogProductProjectionSource[]> {
        if (productIds.length === 0) return [];
        if (productIds.length > 500) throw new Error('At most 500 product IDs can be loaded at once');
        return this.withPrimarySnapshot(async (em) => this.hydrate(em, await this.selectProductsByIds(em, productIds)));
    }

    async countSearchableProducts(): Promise<number> {
        return this.withPrimarySnapshot(async (em) => {
            const row = await em.execute<{ total: unknown }>(
                `SELECT COUNT(*) AS total
                   FROM products p
                  WHERE p.status = 'ACTIVE'
                    AND p.deleted_at IS NULL
                    AND EXISTS (
                        SELECT 1
                          FROM items i
                         WHERE i.product_id = p.id
                           AND i.sale_status = 'ALLOW'
                           AND i.deleted_at IS NULL
                    )`,
                [],
                'get'
            );
            return toSafeNumber(row.total, 'searchable product count');
        });
    }

    private async withPrimarySnapshot<T>(work: (em: EntityManager) => Promise<T>): Promise<T> {
        const em = this.orm.em.fork({ useContext: false });
        return em.transactional(work, { isolationLevel: IsolationLevel.REPEATABLE_READ, readOnly: true });
    }

    private async selectProductsByIds(em: EntityManager, productIds: readonly bigint[]): Promise<ProductRow[]> {
        const placeholders = productIds.map(() => '?').join(', ');
        return em.execute<ProductRow[]>(
            `SELECT CAST(p.id AS CHAR) AS product_id,
                    p.revision AS product_revision,
                    CAST(p.seller_id AS CHAR) AS seller_id,
                    p.slug,
                    p.name,
                    p.description,
                    p.status,
                    p.updated_at,
                    p.deleted_at
               FROM products p
              WHERE p.id IN (${placeholders})
              ORDER BY p.id`,
            productIds.map(String)
        );
    }

    private async hydrate(em: EntityManager, productRows: ProductRow[]): Promise<CatalogProductProjectionSource[]> {
        if (productRows.length === 0) return [];

        const sources = productRows.map(toProductSource);
        const byId = new Map(sources.map((source) => [source.id.toString(), source]));
        const ids = sources.map(({ id }) => id.toString());
        const placeholders = ids.map(() => '?').join(', ');
        const [items, categories, tags, media] = await Promise.all([
            em.execute<ItemRow[]>(itemSql(placeholders), ids),
            em.execute<CategoryRow[]>(categorySql(placeholders), ids),
            em.execute<TagRow[]>(tagSql(placeholders), ids),
            em.execute<MediaRow[]>(mediaSql(placeholders), ids),
        ]);

        hydrateItems(byId, items);
        hydrateCategories(byId, categories);
        hydrateTags(byId, tags);
        hydrateMedia(byId, media);
        return sources;
    }
}

function toProductSource(row: ProductRow): CatalogProductProjectionSource {
    return {
        id: toBigInt(row.product_id, 'product_id'),
        revision: toSafeNumber(row.product_revision, 'product_revision'),
        sellerId: toBigInt(row.seller_id, 'seller_id'),
        slug: toStringValue(row.slug, 'slug'),
        name: toStringValue(row.name, 'name'),
        description: toNullableString(row.description),
        status: toStringValue(row.status, 'status'),
        updatedAt: toDate(row.updated_at, 'updated_at'),
        deletedAt: toNullableDate(row.deleted_at, 'deleted_at'),
        items: [],
        categories: [],
        tags: [],
        media: [],
    };
}

function hydrateItems(byId: Map<string, CatalogProductProjectionSource>, rows: ItemRow[]): void {
    const itemMaps = new Map<string, Map<string, CatalogItemProjectionSource>>();
    for (const row of rows) {
        const productId = toStringValue(row.product_id, 'product_id');
        const source = requireProduct(byId, productId);
        let itemMap = itemMaps.get(productId);
        if (!itemMap) {
            itemMap = new Map();
            itemMaps.set(productId, itemMap);
        }

        const itemId = toStringValue(row.item_id, 'item_id');
        let item = itemMap.get(itemId);
        if (!item) {
            item = {
                id: toBigInt(itemId, 'item_id'),
                sku: toStringValue(row.sku, 'sku'),
                name: toStringValue(row.item_name, 'item_name'),
                totalPrice: toStringValue(row.total_price, 'total_price'),
                isTaxFree: toBoolean(row.is_tax_free, 'is_tax_free'),
                saleStatus: toStringValue(row.sale_status, 'sale_status'),
                sequence: toSafeNumber(row.item_sequence, 'item_sequence'),
                deletedAt: toNullableDate(row.deleted_at, 'deleted_at'),
                options: [],
            };
            source.items.push(item);
            itemMap.set(itemId, item);
        }

        if (row.option_code !== null && row.option_code !== undefined) {
            item.options.push({
                optionCode: toStringValue(row.option_code, 'option_code'),
                valueCode: toStringValue(row.value_code, 'value_code'),
                sequence: toSafeNumber(row.option_sequence, 'option_sequence'),
            });
        }
    }
}

function hydrateCategories(byId: Map<string, CatalogProductProjectionSource>, rows: CategoryRow[]): void {
    const categories = new Map<string, CatalogCategoryProjectionSource>();
    for (const row of rows) {
        const productId = toStringValue(row.product_id, 'product_id');
        const rootId = toStringValue(row.root_category_id, 'root_category_id');
        const key = `${productId}:${rootId}`;
        let category = categories.get(key);
        if (!category) {
            category = {
                id: toBigInt(rootId, 'root_category_id'),
                name: toStringValue(row.root_name, 'root_name'),
                slug: toStringValue(row.root_slug, 'root_slug'),
                sequence: toSafeNumber(row.root_sequence, 'root_sequence'),
                ancestorSlugs: [],
                isActive: toBoolean(row.root_is_active, 'root_is_active'),
                deletedAt: toNullableDate(row.root_deleted_at, 'root_deleted_at'),
            };
            requireProduct(byId, productId).categories.push(category);
            categories.set(key, category);
        }

        const depth = toSafeNumber(row.depth, 'category depth');
        if (depth >= 31 && row.ancestor_parent_id !== null) {
            throw new Error(`Category hierarchy for product ${productId} exceeds 32 levels`);
        }
        if (toBoolean(row.ancestor_is_active, 'ancestor_is_active') && row.ancestor_deleted_at === null) {
            category.ancestorSlugs.unshift(toStringValue(row.ancestor_slug, 'ancestor_slug'));
        }
    }
}

function hydrateTags(byId: Map<string, CatalogProductProjectionSource>, rows: TagRow[]): void {
    for (const row of rows) {
        requireProduct(byId, toStringValue(row.product_id, 'product_id')).tags.push({
            value: toStringValue(row.value, 'tag value'),
            sequence: toSafeNumber(row.sequence, 'tag sequence'),
        });
    }
}

function hydrateMedia(byId: Map<string, CatalogProductProjectionSource>, rows: MediaRow[]): void {
    for (const row of rows) {
        const media: CatalogMediaProjectionSource = {
            id: toBigInt(row.media_id, 'media_id'),
            role: toStringValue(row.role, 'media role'),
            storageKey: toStringValue(row.storage_key, 'storage_key'),
            altText: toNullableString(row.alt_text),
            sequence: toSafeNumber(row.sequence, 'media sequence'),
        };
        requireProduct(byId, toStringValue(row.product_id, 'product_id')).media.push(media);
    }
}

function requireProduct(
    byId: Map<string, CatalogProductProjectionSource>,
    productId: string
): CatalogProductProjectionSource {
    const product = byId.get(productId);
    if (!product) throw new Error(`Projection row references unknown product ${productId}`);
    return product;
}

function validateBatchSize(limit: number): void {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        throw new Error('Catalog projection batch size must be between 1 and 500');
    }
}

function toStringValue(value: unknown, field: string): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'bigint') return String(value);
    throw new Error(`Invalid ${field} from MySQL`);
}

function toNullableString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    return toStringValue(value, 'nullable string');
}

function toBigInt(value: unknown, field: string): bigint {
    const stringValue = toStringValue(value, field);
    if (!/^-?\d+$/.test(stringValue)) throw new Error(`Invalid ${field} from MySQL`);
    return BigInt(stringValue);
}

function toSafeNumber(value: unknown, field: string): number {
    const numberValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(numberValue)) throw new Error(`Invalid ${field} from MySQL`);
    return numberValue;
}

function toBoolean(value: unknown, field: string): boolean {
    if (value === true || value === 1 || value === '1') return true;
    if (value === false || value === 0 || value === '0') return false;
    throw new Error(`Invalid ${field} from MySQL`);
}

function toDate(value: unknown, field: string): Date {
    const date = value instanceof Date ? value : new Date(toStringValue(value, field));
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${field} from MySQL`);
    return date;
}

function toNullableDate(value: unknown, field: string): Date | null {
    return value === null || value === undefined ? null : toDate(value, field);
}

function itemSql(placeholders: string): string {
    return `SELECT CAST(i.product_id AS CHAR) AS product_id,
                   CAST(i.id AS CHAR) AS item_id,
                   i.sku,
                   i.name AS item_name,
                   CAST(i.total_price AS CHAR) AS total_price,
                   i.is_tax_free,
                   i.sale_status,
                   i.sequence AS item_sequence,
                   i.deleted_at,
                   po.code AS option_code,
                   pov.code AS value_code,
                   po.sequence AS option_sequence
              FROM items i
              LEFT JOIN item_option_values iov ON iov.item_id = i.id
              LEFT JOIN product_options po ON po.id = iov.product_option_id
              LEFT JOIN product_option_values pov
                     ON pov.id = iov.product_option_value_id
                    AND pov.product_option_id = iov.product_option_id
             WHERE i.product_id IN (${placeholders})
             ORDER BY i.product_id, i.sequence, i.id, po.sequence, po.id`;
}

function categorySql(placeholders: string): string {
    return `WITH RECURSIVE category_tree AS (
                SELECT pc.product_id,
                       c.id AS root_category_id,
                       c.name AS root_name,
                       c.slug AS root_slug,
                       pc.sequence AS root_sequence,
                       c.is_active AS root_is_active,
                       c.deleted_at AS root_deleted_at,
                       c.id AS ancestor_id,
                       c.slug AS ancestor_slug,
                       c.is_active AS ancestor_is_active,
                       c.deleted_at AS ancestor_deleted_at,
                       c.parent_id AS ancestor_parent_id,
                       0 AS depth
                  FROM product_categories pc
                  JOIN categories c ON c.id = pc.category_id
                 WHERE pc.product_id IN (${placeholders})
                UNION ALL
                SELECT ct.product_id,
                       ct.root_category_id,
                       ct.root_name,
                       ct.root_slug,
                       ct.root_sequence,
                       ct.root_is_active,
                       ct.root_deleted_at,
                       parent.id,
                       parent.slug,
                       parent.is_active,
                       parent.deleted_at,
                       parent.parent_id,
                       ct.depth + 1
                  FROM category_tree ct
                  JOIN categories parent ON parent.id = ct.ancestor_parent_id
                 WHERE ct.depth < 31
            )
            SELECT CAST(product_id AS CHAR) AS product_id,
                   CAST(root_category_id AS CHAR) AS root_category_id,
                   root_name,
                   root_slug,
                   root_sequence,
                   root_is_active,
                   root_deleted_at,
                   ancestor_slug,
                   ancestor_is_active,
                   ancestor_deleted_at,
                   ancestor_parent_id,
                   depth
              FROM category_tree
             ORDER BY product_id, root_sequence, root_category_id, depth`;
}

function tagSql(placeholders: string): string {
    return `SELECT CAST(product_id AS CHAR) AS product_id, value, sequence
              FROM product_tags
             WHERE product_id IN (${placeholders})
             ORDER BY product_id, sequence, value`;
}

function mediaSql(placeholders: string): string {
    return `SELECT CAST(pm.product_id AS CHAR) AS product_id,
                   CAST(pm.id AS CHAR) AS media_id,
                   pm.role,
                   ma.storage_key,
                   pm.alt_text,
                   pm.sequence
              FROM product_media pm
              JOIN media_assets ma ON ma.id = pm.media_asset_id
             WHERE pm.product_id IN (${placeholders})
             ORDER BY pm.product_id, pm.sequence, pm.id`;
}
