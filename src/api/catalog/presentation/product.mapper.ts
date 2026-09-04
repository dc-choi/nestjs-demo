import { ProductReadResult } from '~/api/catalog/application/product-read.result';
import { ProductType } from '~/api/catalog/presentation/product.type';

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
            price: item.price,
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
