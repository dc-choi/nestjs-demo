import { NestFactory } from '@nestjs/core';
import { GraphQLSchemaBuilderModule, GraphQLSchemaFactory } from '@nestjs/graphql';

import { GraphQLObjectType } from 'graphql';
import { describe, expect, it } from 'vitest';
import { ProductResolver } from '~/api/catalog/presentation/product.resolver';
import { DecimalScalar } from '~/api/catalog/search/presentation/decimal.scalar';
import { ProductSearchResolver } from '~/api/catalog/search/presentation/product-search.resolver';
import { FulfillmentResolver } from '~/api/fulfillment/presentation/fulfillment.resolver';
import { InventoryResolver } from '~/api/inventory/presentation/inventory.resolver';
import { OrderResolver } from '~/api/order/presentation/place-order.resolver';
import { PaymentResolver } from '~/api/payment/presentation/payment.resolver';

describe('commerce GraphQL schema', () => {
    it('재고, 주문 취소, 결제와 배송 mutation 계약을 생성한다', async () => {
        const context = await NestFactory.createApplicationContext(GraphQLSchemaBuilderModule, { logger: false });

        try {
            const factory = context.get(GraphQLSchemaFactory);
            const schema = await factory.create(
                [
                    ProductResolver,
                    ProductSearchResolver,
                    OrderResolver,
                    InventoryResolver,
                    PaymentResolver,
                    FulfillmentResolver,
                ],
                [DecimalScalar],
                { skipCheck: false }
            );
            const queries = Object.keys(schema.getQueryType()!.getFields());
            const mutations = Object.keys(schema.getMutationType()!.getFields());
            const thumbnail = schema.getType('ProductSearchThumbnail') as GraphQLObjectType;
            const pageInfo = schema.getType('ProductSearchPageInfo') as GraphQLObjectType;

            expect(queries).toContain('searchProducts');
            expect(thumbnail.getFields().altText.type.toString()).toBe('String');
            expect(pageInfo.getFields().endCursor.type.toString()).toBe('String');
            expect(mutations).toEqual(
                expect.arrayContaining([
                    'adjustInventory',
                    'cancelOrder',
                    'capturePayment',
                    'consumeInventoryReservation',
                    'createFulfillment',
                    'createPaymentAttempt',
                    'deliverFulfillment',
                    'expireInventoryReservation',
                    'failPayment',
                    'failPaymentWebhook',
                    'packFulfillment',
                    'processPaymentWebhook',
                    'receivePaymentWebhook',
                    'refundPayment',
                    'releaseInventoryReservation',
                    'shipFulfillment',
                ])
            );
        } finally {
            await context.close();
        }
    });
});
