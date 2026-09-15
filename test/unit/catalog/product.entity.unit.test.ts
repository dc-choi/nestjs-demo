import { Collection } from '@mikro-orm/core';

import { describe, expect, it } from 'vitest';
import { ItemSaleStatus } from '~/api/catalog/domain/entity/item-sale-status';
import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { ProductStatus } from '~/api/catalog/domain/entity/product-status';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';
import { ProductRuleError } from '~/api/catalog/domain/product.rules';
import { MemberEntity } from '~/api/member/domain/member.entity';

const seller = Object.assign(new MemberEntity(), { id: 7n });

describe('ProductEntity', () => {
    it('create는 scalar 필드를 정규화한 DRAFT revision 1 상품을 만든다', () => {
        const product = ProductEntity.create({
            slug: 'basic-shirt',
            name: '  기본 셔츠  ',
            description: '  상품 설명  ',
            returnPolicy: '   ',
            seller,
        });

        expect(product).toMatchObject({
            slug: 'basic-shirt',
            name: '기본 셔츠',
            description: '상품 설명',
            returnPolicy: null,
            status: ProductStatus.DRAFT,
            revision: 1,
            deletedAt: null,
        });
        expect(product.seller).toBe(seller);
    });

    it.each([
        ['slug 형식', { slug: 'Bad Slug' }, '상품 slug가 올바르지 않습니다.'],
        ['긴 slug', { slug: 'a'.repeat(256) }, '상품 slug의 길이가 올바르지 않습니다.'],
        ['빈 상품명', { name: '   ' }, '상품명의 길이가 올바르지 않습니다.'],
        ['긴 상품명', { name: 'x'.repeat(256) }, '상품명의 길이가 올바르지 않습니다.'],
        ['긴 설명', { description: 'x'.repeat(65_536) }, '상품 설명이(가) 너무 깁니다.'],
        ['긴 반품 정책', { returnPolicy: 'x'.repeat(65_536) }, '반품 정책이(가) 너무 깁니다.'],
    ] as const)('create는 %s 규칙 위반을 도메인 오류로 거절한다', (_label, override, message) => {
        const create = () => ProductEntity.create({ slug: 'basic-shirt', name: '기본 셔츠', seller, ...override });

        expect(create).toThrow(ProductRuleError);
        expect(create).toThrow(message);
    });

    it('applyChanges는 정규화한 값이 현재와 같으면 변경 없음을 보고하고 바뀐 값만 반영한다', () => {
        const product = createProduct();

        expect(product.applyChanges({ name: '  기본 셔츠  ', description: null })).toBe(false);
        expect(product.applyChanges({ slug: 'new-shirt', returnPolicy: ' 7일 이내 ' })).toBe(true);
        expect(product).toMatchObject({ slug: 'new-shirt', returnPolicy: '7일 이내', revision: 1 });
        expect(product.applyChanges({ description: '  새 설명  ', name: ' 새 이름 ' })).toBe(true);
        expect(product).toMatchObject({ description: '새 설명', name: '새 이름' });
        expect(product.applyChanges({ description: '   ' })).toBe(true);
        expect(product.description).toBeNull();
    });

    it('applyChanges는 규칙 위반 시 아무 필드도 바꾸지 않고 도메인 오류를 던진다', () => {
        const product = createProduct();

        expect(() => product.applyChanges({ slug: 'Bad Slug' })).toThrow(ProductRuleError);
        expect(() => product.applyChanges({ name: '   ' })).toThrow('상품명의 길이가 올바르지 않습니다.');
        const invalidStatus = () => product.applyChanges({ status: 'UNKNOWN' as ProductStatus });
        expect(invalidStatus).toThrow(ProductRuleError);
        expect(invalidStatus).toThrow('상품 상태가 올바르지 않습니다.');
        expect(product).toMatchObject({ slug: 'basic-shirt', name: '기본 셔츠', status: ProductStatus.DRAFT });
    });

    it('applyChanges는 합법적인 상태만 반영한다', () => {
        const product = createProduct();

        expect(product.applyChanges({ status: ProductStatus.DRAFT })).toBe(false);
        expect(product.applyChanges({ status: ProductStatus.SUSPENDED })).toBe(true);
        expect(product.status).toBe(ProductStatus.SUSPENDED);
    });

    it('ACTIVE 상품은 판매 가능한 Item이 하나 이상 있어야 한다', () => {
        const product = createProduct();
        product.applyChanges({ status: ProductStatus.ACTIVE });

        expect(() => product.assertSaleableWhenActive()).toThrow('판매 가능한 Item');

        const denied = Object.assign(new ItemEntity(), { product, saleStatus: ItemSaleStatus.DENY, deletedAt: null });
        const deleted = Object.assign(new ItemEntity(), {
            product,
            saleStatus: ItemSaleStatus.ALLOW,
            deletedAt: new Date(),
        });
        product.items = new Collection(product, [denied, deleted]);
        expect(() => product.assertSaleableWhenActive()).toThrow(ProductRuleError);

        const saleable = Object.assign(new ItemEntity(), {
            product,
            saleStatus: ItemSaleStatus.ALLOW,
            deletedAt: null,
        });
        product.items = new Collection(product, [denied, deleted, saleable]);
        expect(() => product.assertSaleableWhenActive()).not.toThrow();

        product.applyChanges({ status: ProductStatus.DRAFT });
        product.items = new Collection(product, []);
        expect(() => product.assertSaleableWhenActive()).not.toThrow();
    });

    it('restoreFrom은 같은 상품과 판매자의 Snapshot만 적용하고 삭제 상태를 되돌린다', () => {
        const product = createProduct();
        product.close(new Date('2026-09-04T00:00:00.000Z'));
        const snapshot = {
            id: '42',
            sellerId: '7',
            slug: 'original-shirt',
            name: ' 원본 셔츠 ',
            description: null,
            returnPolicy: null,
            status: ProductStatus.DRAFT,
        };

        expect(() => product.restoreFrom({ ...snapshot, id: '43' })).toThrow(ProductRuleError);
        expect(() => product.restoreFrom({ ...snapshot, id: '43' })).toThrow('Snapshot의 상품 식별 정보');
        expect(() => product.restoreFrom({ ...snapshot, sellerId: '8' })).toThrow('Snapshot의 상품 식별 정보');
        expect(() => product.restoreFrom({ ...snapshot, status: 'UNKNOWN' as ProductStatus })).toThrow(
            'Snapshot의 상품 상태'
        );
        expect(() => product.restoreFrom({ ...snapshot, slug: 'Bad Slug' })).toThrow('상품 slug가 올바르지 않습니다.');
        expect(() => product.restoreFrom({ ...snapshot, name: ' ' })).toThrow(ProductRuleError);
        expect(product).toMatchObject({ status: ProductStatus.CLOSED, slug: 'basic-shirt', name: '기본 셔츠' });

        product.restoreFrom(snapshot);

        expect(product).toMatchObject({
            slug: 'original-shirt',
            name: '원본 셔츠',
            status: ProductStatus.DRAFT,
            deletedAt: null,
        });
    });

    it('close는 CLOSED 상태와 삭제 시각을 함께 기록하고 advanceRevision은 revision을 하나 올린다', () => {
        const product = createProduct();
        const now = new Date('2026-09-04T00:00:00.000Z');

        product.close(now);

        expect(product).toMatchObject({ status: ProductStatus.CLOSED, deletedAt: now });
        expect(product.advanceRevision()).toBe(2);
        expect(product.revision).toBe(2);
    });
});

function createProduct(): ProductEntity {
    return Object.assign(new ProductEntity(), {
        id: 42n,
        slug: 'basic-shirt',
        name: '기본 셔츠',
        description: null,
        returnPolicy: null,
        status: ProductStatus.DRAFT,
        revision: 1,
        deletedAt: null,
        seller,
    });
}
