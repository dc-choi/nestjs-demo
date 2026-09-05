import { ChangeSetType, Collection, type EntityManager } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/mysql';

import { describe, expect, it } from 'vitest';
import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { createMikroOrmCoreOptions } from '~/infra/database/mikro-orm.config';

describe('order aggregate', () => {
    it('품목과 주문 합계를 정확한 decimal 문자열로 계산한다', () => {
        const first = createOrderItem(1n, 3, '0.1');
        const second = createOrderItem(2n, 2, '1100.250');

        const order = OrderEntity.place({
            member: { id: 10n } as MemberEntity,
            orderNumber: '019c-test',
            idempotencyKey: 'aggregate-total-order',
            requestFingerprint: '0'.repeat(64),
            currencyCode: 'KRW',
            items: [first, second],
        });

        expect(first.lineTotalPrice).toBe('0.3');
        expect(second.lineTotalPrice).toBe('2200.5');
        expect(order.totalPrice).toBe('2200.8');
    });

    it('품목이 없거나 통화 코드 형식이 틀린 주문을 거부한다', () => {
        expect(() =>
            OrderEntity.place({
                member: { id: 10n } as MemberEntity,
                orderNumber: '019c-test',
                idempotencyKey: 'aggregate-empty-order',
                requestFingerprint: '0'.repeat(64),
                currencyCode: 'KRW',
                items: [],
            })
        ).toThrow(RangeError);

        expect(() =>
            OrderEntity.place({
                member: { id: 10n } as MemberEntity,
                orderNumber: '019c-test',
                idempotencyKey: 'aggregate-currency-order',
                requestFingerprint: '0'.repeat(64),
                currencyCode: 'krw',
                items: [createOrderItem(1n, 1, '1000')],
            })
        ).toThrow(TypeError);
    });

    it('요청 품목 순서와 주문 당시 snapshot을 aggregate에 결합한다', () => {
        const first = createOrderItem(20n, 1, '1000');
        const second = createOrderItem(10n, 1, '2000');
        const order = OrderEntity.place({
            member: { id: 10n } as MemberEntity,
            orderNumber: '019c-test',
            idempotencyKey: 'aggregate-snapshot-order',
            requestFingerprint: '0'.repeat(64),
            currencyCode: 'KRW',
            items: [first, second],
        });

        expect(order.items.getItems()).toEqual([first, second]);
        expect(order.items.getItems().map(({ item }) => item.id)).toEqual([20n, 10n]);
        expect(first.order).toBe(order);
        expect(first.snapshot?.orderItem).toBe(first);
        expect(first.snapshot?.sourceItemId).toBe(20n);
        expect(first.snapshot?.sourceProductId).toBe(100n);
        expect(first.snapshot?.sourceProductRevision).toBe(7);
    });

    it('유효하지 않은 수량으로 주문 품목을 만들 수 없다', () => {
        expect(() => createOrderItem(1n, 0, '1000')).toThrow(RangeError);
        expect(() => createOrderItem(1n, 1.5, '1000')).toThrow(RangeError);
        expect(() => createOrderItem(1n, 2_147_483_648, '0.001')).toThrow(RangeError);
    });

    it('주문 품목 금액과 주문 총액이 decimal(19,3) 범위를 넘으면 거부한다', () => {
        expect(createOrderItem(1n, 2_147_483_647, '0.001').lineTotalPrice).toBe('2147483.647');
        expect(() => createOrderItem(1n, 1_000_000_001, '9999999.999')).toThrow(
            '주문 금액이 저장 가능한 범위를 넘었습니다.'
        );

        const first = createOrderItem(1n, 600_000_000, '9999999.999');
        const second = createOrderItem(2n, 600_000_000, '9999999.999');
        expect(() =>
            OrderEntity.place({
                member: { id: 10n } as MemberEntity,
                orderNumber: '019c-test',
                idempotencyKey: 'aggregate-overflow-order',
                requestFingerprint: '0'.repeat(64),
                currencyCode: 'KRW',
                items: [first, second],
            })
        ).toThrow('주문 금액이 저장 가능한 범위를 넘었습니다.');
    });

    it('동일한 품목 ID는 별도 행으로 허용하지만 같은 객체 중복은 거부한다', () => {
        const first = createOrderItem(1n, 1, '1000');
        const second = createOrderItem(1n, 2, '1000');
        const place = (items: OrderItemEntity[]) =>
            OrderEntity.place({
                member: { id: 10n } as MemberEntity,
                orderNumber: '019c-test',
                idempotencyKey: 'aggregate-duplicate-order',
                requestFingerprint: '0'.repeat(64),
                currencyCode: 'KRW',
                items,
            });

        expect(place([first, second]).items.getItems()).toEqual([first, second]);
        expect(() => place([first, first])).toThrow('같은 주문 품목 객체를 중복해서 추가할 수 없습니다.');
        expect(() => place([first])).toThrow('이미 주문에 속한 품목을 다시 추가할 수 없습니다.');
    });

    it('aggregate root 저장을 품목과 주문 snapshot까지 cascade한다', async () => {
        const orm = new MikroORM({
            ...createMikroOrmCoreOptions({
                ENV: 'test',
                MYSQL_HOST: 'unused',
                MYSQL_PORT: 3306,
                MYSQL_USER: 'unused',
                MYSQL_PASSWORD: 'unused',
                MYSQL_DATABASE: 'unused',
                MYSQL_READ_REPLICA_HOST: 'unused',
                MYSQL_READ_REPLICA_PORT: 3306,
                MYSQL_READ_REPLICA_USER: 'unused',
                MYSQL_READ_REPLICA_PASSWORD: 'unused',
                MYSQL_READ_REPLICA_DATABASE: 'unused',
            }),
        });

        try {
            const entityManager = orm.em.fork();
            const order = OrderEntity.place({
                member: entityManager.getReference(MemberEntity, 10n),
                orderNumber: '019c-test',
                idempotencyKey: 'aggregate-managed-order',
                requestFingerprint: '0'.repeat(64),
                currencyCode: 'KRW',
                items: [OrderItemEntity.create({ quantity: 1, item: createManagedItem(entityManager) })],
            });

            entityManager.persist(order);
            entityManager.getUnitOfWork().computeChangeSets();

            expect(entityManager.getUnitOfWork().getChangeSets()).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ entity: order, type: ChangeSetType.CREATE }),
                    expect.objectContaining({ entity: order.items[0], type: ChangeSetType.CREATE }),
                    expect.objectContaining({ entity: order.items[0].snapshot, type: ChangeSetType.CREATE }),
                ])
            );
        } finally {
            await orm.close();
        }
    });
});

function createManagedItem(entityManager: EntityManager): ItemEntity {
    const item = entityManager.getReference(ItemEntity, 1n);
    item.name = '품목';
    item.sku = 'sku-1';
    item.supplyPrice = '1000';
    item.vat = '100';
    item.totalPrice = '1100';
    item.isTaxFree = false;
    item.product = entityManager.getReference(ProductEntity, 100n);
    item.product.revision = 7;
    item.product.name = '상품';
    item.product.description = null;
    item.product.returnPolicy = null;
    item.optionValues = new Collection(item, []);

    return item;
}

function createOrderItem(itemId: bigint, quantity: number, unitTotalPrice: string): OrderItemEntity {
    const item = {
        id: itemId,
        name: '품목',
        sku: `sku-${itemId}`,
        supplyPrice: unitTotalPrice,
        vat: '0',
        totalPrice: unitTotalPrice,
        isTaxFree: true,
        product: {
            id: 100n,
            revision: 7,
            name: '상품',
            description: null,
            returnPolicy: null,
        },
        optionValues: { getItems: () => [] },
    } as unknown as ItemEntity;

    return OrderItemEntity.create({ quantity, item });
}
