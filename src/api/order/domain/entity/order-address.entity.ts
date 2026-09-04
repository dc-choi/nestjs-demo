import type { Opt, Rel } from '@mikro-orm/core';
import { Entity, Enum, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { OrderAddressType } from '~/api/order/domain/entity/order.enum';

/**
 * 회원 주소록과 분리해 주문 시점의 청구지 또는 배송지를 고정한다.
 * 주문별 주소 유형 제약으로 청구지와 배송지를 각각 하나만 허용한다.
 */
@Entity({ tableName: 'order_addresses' })
@Unique({ name: 'order_addresses_order_id_type_key', properties: ['order', 'type'] })
export class OrderAddressEntity {
    @PrimaryKey({ type: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    @Enum({ items: () => OrderAddressType })
    type!: OrderAddressType;

    @Property({ fieldName: 'recipient_name', columnType: 'varchar(255)' })
    recipientName!: string;

    @Property({ columnType: 'varchar(32)' })
    phone!: string;

    @Property({ fieldName: 'postal_code', columnType: 'varchar(32)' })
    postalCode!: string;

    @Property({ fieldName: 'country_code', columnType: 'char(2)' })
    countryCode!: string;

    @Property({ columnType: 'varchar(255)', nullable: true })
    province: string | null = null;

    @Property({ columnType: 'varchar(255)' })
    city!: string;

    @Property({ columnType: 'varchar(255)' })
    line1!: string;

    @Property({ columnType: 'varchar(255)', nullable: true })
    line2: string | null = null;

    @Property({ fieldName: 'created_at', columnType: 'datetime(3)', defaultRaw: 'CURRENT_TIMESTAMP(3)' })
    createdAt!: Date & Opt;

    @ManyToOne(() => OrderEntity, {
        joinColumn: 'order_id',
        inversedBy: 'addresses',
        deleteRule: 'restrict',
        updateRule: 'cascade',
        foreignKeyName: 'order_addresses_order_id_fkey',
        unsigned: false,
        index: false,
    })
    order!: Rel<OrderEntity>;
}
