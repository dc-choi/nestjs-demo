import { Collection, type Opt } from '@mikro-orm/core';
import { Entity, Enum, OneToMany, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { MemberRole } from './member-role';

import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';

/**
 * 인증 주체이자 판매자와 구매자의 현재 계정 상태를 보존하는 도메인 모델이다.
 * soft delete 후에도 상품과 주문의 소유 관계가 사라지지 않도록 연결의 기준이 된다.
 */
@Entity({ tableName: 'members' })
export class MemberEntity {
    @PrimaryKey({ fieldName: 'id', columnType: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    @Property({ fieldName: 'name', columnType: 'varchar(255)' })
    name!: string;

    /** 동시 가입에서도 DB unique 제약이 중복 계정을 막는 최종 경계다. */
    @Property({ fieldName: 'email', columnType: 'varchar(255)', unique: 'members_email_key' })
    email!: string;

    @Property({ fieldName: 'hashed_password', columnType: 'varchar(128)', nullable: true })
    hashedPassword!: string | null;

    @Property({ fieldName: 'phone', columnType: 'varchar(255)' })
    phone!: string;

    @Enum({ fieldName: 'role', items: () => MemberRole, default: MemberRole.GUEST })
    role: MemberRole & Opt = MemberRole.GUEST;

    @Property({ fieldName: 'last_login_at', columnType: 'datetime', nullable: true })
    lastLoginAt!: Date | null;

    @Property({ fieldName: 'membership_at', columnType: 'datetime', nullable: true })
    membershipAt!: Date | null;

    @Property({ fieldName: 'created_at', columnType: 'datetime', defaultRaw: 'CURRENT_TIMESTAMP' })
    createdAt!: Date & Opt;

    @Property({
        fieldName: 'updated_at',
        columnType: 'datetime',
        defaultRaw: 'CURRENT_TIMESTAMP',
        onUpdate: () => new Date(),
    })
    updatedAt!: Date & Opt;

    @Property({ fieldName: 'deleted_at', columnType: 'datetime', nullable: true })
    deletedAt!: Date | null;

    @OneToMany({ entity: () => ProductEntity, mappedBy: 'seller' })
    products = new Collection<ProductEntity>(this);

    @OneToMany({ entity: () => OrderEntity, mappedBy: 'member' })
    orders = new Collection<OrderEntity>(this);
}
