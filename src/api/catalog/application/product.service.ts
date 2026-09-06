import { type EntityRepository, IsolationLevel, LoadStrategy, type Loaded, PopulateHint } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Injectable } from '@nestjs/common';

import { ItemSaleStatus } from '../domain/entity/item-sale-status';
import { ProductStatus } from '../domain/entity/product-status';
import { ProductEntity } from '../domain/entity/product.entity';
import { ProductReadResult } from './product-read.result';

const currentProductPopulate = [
    'items',
    'items.optionValues',
    'items.optionValues.option',
    'items.optionValues.value',
    'options',
    'options.values',
    'categories',
    'categories.category',
    'tags',
] as const;

type CurrentProductRecord = Loaded<ProductEntity, (typeof currentProductPopulate)[number]>;

@Injectable()
export class ProductService {
    constructor(
        @InjectRepository(ProductEntity)
        private readonly repository: EntityRepository<ProductEntity>
    ) {}

    async findCurrentById(productId: bigint): Promise<ProductReadResult | null> {
        // Split collections without mixing catalog revisions between their reads.
        return this.repository.getEntityManager().transactional(
            async (em) => {
                const product = await em.findOne(
                    ProductEntity,
                    {
                        id: productId,
                        status: ProductStatus.ACTIVE,
                        deletedAt: null,
                        items: {
                            saleStatus: ItemSaleStatus.ALLOW,
                            deletedAt: null,
                        },
                    },
                    {
                        populate: currentProductPopulate,
                        populateWhere: PopulateHint.INFER,
                        strategy: LoadStrategy.BALANCED,
                        connectionType: 'write',
                        disableIdentityMap: true,
                        loggerContext: { label: 'catalog.current-product' },
                    }
                );

                return product ? toProductReadResult(product) : null;
            },
            { isolationLevel: IsolationLevel.REPEATABLE_READ, readOnly: true }
        );
    }
}

function toProductReadResult(product: CurrentProductRecord): ProductReadResult {
    const items = product.items
        .getItems()
        .toSorted((left, right) => left.sequence - right.sequence || compareBigInt(left.id, right.id));
    const options = product.options
        .getItems()
        .toSorted((left, right) => left.sequence - right.sequence || compareBigInt(left.id, right.id));
    const categories = product.categories
        .getItems()
        .toSorted(
            (left, right) => left.sequence - right.sequence || compareBigInt(left.category.id, right.category.id)
        );
    const tags = product.tags
        .getItems()
        .toSorted((left, right) => left.sequence - right.sequence || left.value.localeCompare(right.value));

    return {
        id: product.id,
        slug: product.slug,
        revision: product.revision,
        name: product.name,
        description: product.description,
        returnPolicy: product.returnPolicy,
        updatedAt: product.updatedAt,
        items: items.map((item) => ({
            id: item.id,
            sku: item.sku,
            name: item.name,
            price: {
                amount: normalizeDecimal(item.totalPrice),
                currencyCode: 'KRW',
            },
            isTaxFree: item.isTaxFree,
            sequence: item.sequence,
            selectedOptions: item.optionValues
                .getItems()
                .toSorted((left, right) => left.option.sequence - right.option.sequence)
                .map(({ option, value }) => ({
                    optionCode: option.code,
                    optionName: option.name,
                    valueCode: value.code,
                    valueName: value.name,
                })),
        })),
        options: options.map((option) => ({
            id: option.id,
            code: option.code,
            name: option.name,
            isRequired: option.isRequired,
            sequence: option.sequence,
            values: option.values
                .getItems()
                .toSorted((left, right) => left.sequence - right.sequence || compareBigInt(left.id, right.id))
                .map(({ id, code, name, sequence }) => ({ id, code, name, sequence })),
        })),
        categories: categories.map(({ category, sequence }) => ({
            id: category.id,
            name: category.name,
            slug: category.slug,
            sequence,
        })),
        tags: tags.map(({ value }) => value),
    };
}

function compareBigInt(left: bigint, right: bigint): number {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}

function normalizeDecimal(value: string): string {
    const [integer, fraction] = value.split('.');
    if (fraction === undefined) return value;

    const normalizedFraction = fraction.replace(/0+$/, '');
    return normalizedFraction ? `${integer}.${normalizedFraction}` : integer;
}
