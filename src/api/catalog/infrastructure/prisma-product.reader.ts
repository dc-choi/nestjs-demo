import { Inject, Injectable } from '@nestjs/common';

import { Prisma } from 'prisma/generated/client/client';
import { REPOSITORY, Repository } from 'prisma/repository';
import { ProductCategoryPathNodeReadResult, ProductReadResult } from '~/api/catalog/application/product-read.result';
import { ProductReader } from '~/api/catalog/application/product.reader';

const publicItemWhere = {
    itemSaleStatus: 'ALLOW',
    item: {
        deletedAt: null,
    },
} as const satisfies Prisma.ProductSnapshotItemWhereInput;

const currentProductSelect = {
    publishedAt: true,
    product: {
        select: {
            id: true,
            slug: true,
        },
    },
    snapshot: {
        select: {
            id: true,
            version: true,
            name: true,
            description: true,
            returnPolicy: true,
            createdAt: true,
            firstPublishedAt: true,
            items: {
                where: publicItemWhere,
                orderBy: [{ sequence: 'asc' }, { itemId: 'asc' }],
                select: {
                    itemId: true,
                    itemSku: true,
                    name: true,
                    totalPrice: true,
                    isTaxFree: true,
                    sequence: true,
                    optionValues: {
                        select: {
                            option: {
                                select: {
                                    code: true,
                                    name: true,
                                    sequence: true,
                                },
                            },
                            value: {
                                select: {
                                    code: true,
                                    name: true,
                                },
                            },
                        },
                    },
                },
            },
            options: {
                orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
                select: {
                    id: true,
                    code: true,
                    name: true,
                    isRequired: true,
                    sequence: true,
                    values: {
                        orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
                        select: {
                            id: true,
                            code: true,
                            name: true,
                            sequence: true,
                        },
                    },
                },
            },
            categories: {
                orderBy: [{ sequence: 'asc' }, { categoryId: 'asc' }],
                select: {
                    categoryId: true,
                    categoryName: true,
                    categorySlug: true,
                    categoryPath: true,
                    sequence: true,
                },
            },
            tags: {
                orderBy: [{ sequence: 'asc' }, { value: 'asc' }],
                select: {
                    value: true,
                },
            },
        },
    },
} as const satisfies Prisma.ProductPublicationSelect;

type CurrentProductRecord = Prisma.ProductPublicationGetPayload<{
    select: typeof currentProductSelect;
}>;

@Injectable()
export class PrismaProductReader implements ProductReader {
    constructor(@Inject(REPOSITORY) private readonly repository: Repository) {}

    async findCurrentById(productId: bigint): Promise<ProductReadResult | null> {
        const publication = await this.repository.$primary().productPublication.findFirst({
            where: {
                productId,
                product: {
                    status: 'ACTIVE',
                    deletedAt: null,
                },
                snapshot: {
                    status: 'PUBLISHED',
                    items: {
                        some: publicItemWhere,
                    },
                },
            },
            select: currentProductSelect,
        });

        return publication ? toProductReadResult(publication) : null;
    }
}

function toProductReadResult(publication: CurrentProductRecord): ProductReadResult {
    const { product, snapshot } = publication;

    return {
        id: product.id,
        slug: product.slug,
        publishedAt: publication.publishedAt,
        currentRevision: {
            id: snapshot.id,
            version: snapshot.version,
            name: snapshot.name,
            description: snapshot.description,
            returnPolicy: snapshot.returnPolicy,
            createdAt: snapshot.createdAt,
            firstPublishedAt: snapshot.firstPublishedAt,
            items: snapshot.items.map((item) => ({
                id: item.itemId,
                sku: item.itemSku,
                name: item.name,
                price: {
                    amount: item.totalPrice.toString(),
                    currencyCode: 'KRW',
                },
                isTaxFree: item.isTaxFree,
                sequence: item.sequence,
                selectedOptions: item.optionValues
                    .toSorted((left, right) => left.option.sequence - right.option.sequence)
                    .map(({ option, value }) => ({
                        optionCode: option.code,
                        optionName: option.name,
                        valueCode: value.code,
                        valueName: value.name,
                    })),
            })),
            options: snapshot.options.map((option) => ({
                id: option.id,
                code: option.code,
                name: option.name,
                isRequired: option.isRequired,
                sequence: option.sequence,
                values: option.values,
            })),
            categories: snapshot.categories.map((category) => ({
                id: category.categoryId,
                name: category.categoryName,
                slug: category.categorySlug,
                sequence: category.sequence,
                path: toCategoryPath(category.categoryPath),
            })),
            tags: snapshot.tags.map(({ value }) => value),
        },
    };
}

function toCategoryPath(value: unknown): ProductCategoryPathNodeReadResult[] {
    if (!Array.isArray(value)) throw new Error('Product category path must be an array.');

    return value.map((node) => {
        if (
            !isRecord(node) ||
            !isCategoryPathId(node.id) ||
            typeof node.name !== 'string' ||
            typeof node.slug !== 'string'
        ) {
            throw new Error('Product category path contains an invalid node.');
        }

        return {
            id: String(node.id),
            name: node.name,
            slug: node.slug,
        };
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isCategoryPathId(value: unknown): value is string | number {
    if (typeof value === 'string') return /^[1-9]\d*$/.test(value);

    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
