import { ProductReadResult } from '~/api/catalog/application/product-read.result';
import { ProductType } from '~/api/catalog/presentation/product.type';

export function toProductType(product: ProductReadResult): ProductType {
    const { currentRevision } = product;

    return {
        id: product.id.toString(),
        slug: product.slug,
        publishedAt: product.publishedAt,
        currentRevision: {
            id: currentRevision.id.toString(),
            version: currentRevision.version,
            name: currentRevision.name,
            description: currentRevision.description,
            returnPolicy: currentRevision.returnPolicy,
            createdAt: currentRevision.createdAt,
            firstPublishedAt: currentRevision.firstPublishedAt,
            items: currentRevision.items.map((item) => ({
                id: item.id.toString(),
                sku: item.sku,
                name: item.name,
                price: item.price,
                isTaxFree: item.isTaxFree,
                sequence: item.sequence,
                selectedOptions: item.selectedOptions,
            })),
            options: currentRevision.options.map((option) => ({
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
            categories: currentRevision.categories.map((category) => ({
                id: category.id.toString(),
                name: category.name,
                slug: category.slug,
                sequence: category.sequence,
                path: category.path,
            })),
            tags: currentRevision.tags,
        },
    };
}
