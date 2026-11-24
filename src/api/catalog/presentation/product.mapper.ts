import { ProductReadResult } from '~/api/catalog/application/product-read.result.js';
import { PRODUCT_CURRENCY_CODE } from '~/api/catalog/domain/product.rules.js';
import { ProductType } from '~/api/catalog/presentation/product.type.js';
import { formatMoneyAmount } from '~/global/graphql/money-amount.js';

export function toProductType(product: ProductReadResult): ProductType {
    return {
        id: product.id.toString(),
        slug: product.slug,
        revision: product.revision,
        name: product.name,
        description: product.description,
        returnPolicy: product.returnPolicy,
        updatedAt: product.updatedAt,
        items: product.items.map((item) => ({
            id: item.id.toString(),
            sku: item.sku,
            name: item.name,
            price: { amount: formatMoneyAmount(item.totalPrice), currencyCode: PRODUCT_CURRENCY_CODE },
            isTaxFree: item.isTaxFree,
            sequence: item.sequence,
            selectedOptions: item.selectedOptions,
        })),
        options: product.options.map((option) => ({
            id: option.id.toString(),
            code: option.code,
            name: option.name,
            isRequired: option.isRequired,
            sequence: option.sequence,
            values: option.values.map((value) => ({
                id: value.id.toString(),
                code: value.code,
                name: value.name,
                sequence: value.sequence,
            })),
        })),
        categories: product.categories.map((category) => ({
            id: category.id.toString(),
            name: category.name,
            slug: category.slug,
            sequence: category.sequence,
        })),
        tags: product.tags,
    };
}
