import { NestFactory } from '@nestjs/core';
import { GraphQLSchemaBuilderModule, GraphQLSchemaFactory } from '@nestjs/graphql';

import { GraphQLInputObjectType, GraphQLObjectType } from 'graphql';
import { ProductCommandResolver } from '~/api/catalog/presentation/product-command.resolver';
import { ProductSnapshotResolver } from '~/api/catalog/presentation/product-snapshot.resolver';

describe('catalog command GraphQL schema', () => {
    it('상품, Item, aggregate mutation과 bounded Snapshot query를 노출한다', async () => {
        const context = await NestFactory.createApplicationContext(GraphQLSchemaBuilderModule, { logger: false });

        try {
            const factory = context.get(GraphQLSchemaFactory);
            const schema = await factory.create([ProductCommandResolver, ProductSnapshotResolver], {
                skipCheck: false,
            });
            const mutations = Object.keys(schema.getMutationType()!.getFields());
            const queries = Object.keys(schema.getQueryType()!.getFields());
            const itemInput = schema.getType('ReplaceProductItemInput') as GraphQLInputObjectType;
            const snapshot = schema.getType('ProductSnapshot') as GraphQLObjectType;

            expect(mutations).toEqual(
                expect.arrayContaining([
                    'createProduct',
                    'updateProduct',
                    'deleteProduct',
                    'restoreProduct',
                    'replaceProductCatalog',
                    'createProductItem',
                    'updateProductItem',
                    'deleteProductItem',
                ])
            );
            expect(queries).toContain('productSnapshots');
            expect(Object.keys(itemInput.getFields())).not.toContain('stock');
            expect(Object.keys(snapshot.getFields())).toEqual(
                expect.arrayContaining(['revision', 'changeType', 'reason', 'createdAt'])
            );
            expect(Object.keys(snapshot.getFields())).not.toContain('payload');
        } finally {
            await context.close();
        }
    });
});
