import { Prisma } from 'prisma/generated/client/client';
import { Repository } from 'prisma/repository';
import { PrismaProductReader } from '~/api/catalog/infrastructure/prisma-product.reader';

describe('PrismaProductReader', () => {
    const findFirst = jest.fn();
    const repository = {
        $primary: () => ({
            productPublication: {
                findFirst,
            },
        }),
    } as unknown as Repository;
    const reader = new PrismaProductReader(repository);

    beforeEach(() => {
        findFirst.mockReset();
    });

    it('현재 발행 포인터가 선택한 상품 버전을 API read result로 변환한다', async () => {
        findFirst.mockResolvedValue({
            publishedAt: new Date('2026-08-13T00:00:00.000Z'),
            product: {
                id: 1n,
                slug: 'basic-tshirt',
            },
            snapshot: {
                id: 10n,
                version: 2,
                name: '기본 티셔츠',
                description: '상품 설명',
                returnPolicy: null,
                createdAt: new Date('2026-08-12T00:00:00.000Z'),
                firstPublishedAt: new Date('2026-08-13T00:00:00.000Z'),
                items: [
                    {
                        itemId: 100n,
                        itemSku: '019c-sku',
                        name: '검정 / L',
                        totalPrice: new Prisma.Decimal('12000.500'),
                        isTaxFree: false,
                        sequence: 0,
                        optionValues: [
                            {
                                option: { code: 'size', name: '크기', sequence: 1 },
                                value: { code: 'large', name: 'L' },
                            },
                            {
                                option: { code: 'color', name: '색상', sequence: 0 },
                                value: { code: 'black', name: '검정' },
                            },
                        ],
                    },
                ],
                options: [
                    {
                        id: 20n,
                        code: 'color',
                        name: '색상',
                        isRequired: true,
                        sequence: 0,
                        values: [{ id: 21n, code: 'black', name: '검정', sequence: 0 }],
                    },
                ],
                categories: [
                    {
                        categoryId: 30n,
                        categoryName: '상의',
                        categorySlug: 'tops',
                        categoryPath: [
                            { id: '3', name: '의류', slug: 'clothing' },
                            { id: '30', name: '상의', slug: 'tops' },
                        ],
                        sequence: 0,
                    },
                ],
                tags: [{ value: '티셔츠' }],
            },
        });

        const product = await reader.findCurrentById(1n);

        expect(findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    productId: 1n,
                    product: {
                        status: 'ACTIVE',
                        deletedAt: null,
                    },
                    snapshot: expect.objectContaining({ status: 'PUBLISHED' }),
                }),
            })
        );
        expect(findFirst.mock.calls[0][0].select.snapshot.select).not.toHaveProperty('media');
        expect(product).toMatchObject({
            id: 1n,
            slug: 'basic-tshirt',
            currentRevision: {
                id: 10n,
                version: 2,
                items: [
                    {
                        id: 100n,
                        price: {
                            amount: '12000.5',
                            currencyCode: 'KRW',
                        },
                        selectedOptions: [
                            { optionCode: 'color', valueCode: 'black' },
                            { optionCode: 'size', valueCode: 'large' },
                        ],
                    },
                ],
                categories: [
                    {
                        id: 30n,
                        path: [
                            { id: '3', name: '의류', slug: 'clothing' },
                            { id: '30', name: '상의', slug: 'tops' },
                        ],
                    },
                ],
                tags: ['티셔츠'],
            },
        });
    });

    it('공개 조건을 만족하는 발행본이 없으면 null을 반환한다', async () => {
        findFirst.mockResolvedValue(null);

        await expect(reader.findCurrentById(1n)).resolves.toBeNull();
    });
});
