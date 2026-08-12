import { Prisma } from 'prisma/generated/client/client';
import { toOrderItemCreate } from '~/api/order/infrastructure/order.persistence';
import { toOrderLine } from '~/api/order/infrastructure/orderable-snapshot-item';

describe('ordered item snapshot', () => {
    const source = {
        productSnapshotId: 10n,
        name: '검정 / L',
        itemSku: 'sku-v7',
        supplyPrice: new Prisma.Decimal('1000'),
        vat: new Prisma.Decimal('100'),
        totalPrice: new Prisma.Decimal('1100'),
        isTaxFree: false,
        item: {
            stock: 5,
        },
        snapshot: {
            name: '기본 티셔츠',
            description: '상품 설명',
            returnPolicy: '수령 후 7일 이내',
        },
        optionValues: [
            {
                option: {
                    code: 'color',
                    name: '색상',
                },
                value: {
                    code: 'black',
                    name: '검정',
                },
            },
        ],
    };

    it('현재 상품 버전을 주문 시점 값으로 복사한다', () => {
        const orderedItem = toOrderLine(20n, 2, source);

        expect(orderedItem.lineTotalPrice.toString()).toBe('2200');
        expect(orderedItem.snapshot.productName).toBe('기본 티셔츠');
        expect(orderedItem.snapshot.selectedOptions).toEqual([
            {
                optionCode: 'color',
                optionName: '색상',
                valueCode: 'black',
                valueName: '검정',
            },
        ]);
    });

    it('주문 품목과 원천 snapshot을 같은 Item으로 연결한다', () => {
        const create = toOrderItemCreate(toOrderLine(20n, 2, source));

        expect(create.item).toEqual({ connect: { id: 20n } });
        expect(create.snapshot).toMatchObject({
            create: {
                source: {
                    connect: {
                        productSnapshotId_itemId: {
                            productSnapshotId: 10n,
                            itemId: 20n,
                        },
                    },
                },
            },
        });
    });
});
