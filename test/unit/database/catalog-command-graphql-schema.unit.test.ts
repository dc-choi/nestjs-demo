import { NestFactory } from '@nestjs/core';
import { GraphQLSchemaBuilderModule, GraphQLSchemaFactory } from '@nestjs/graphql';

import type { GraphQLInputObjectType, GraphQLObjectType } from 'graphql';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { ProductCommandResolver } from '~/api/catalog/presentation/product-command.resolver';
import { ProductSnapshotResolver } from '~/api/catalog/presentation/product-snapshot.resolver';

// Nest's schema builder loads GraphQL through CommonJS, outside Vitest's module realm.
const { coerceInputValue } = createRequire(`${process.cwd()}/package.json`)('graphql') as typeof import('graphql');

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

            const createItem = schema.getType('CreateProductItemDataInput') as GraphQLInputObjectType;
            const updateItem = schema.getType('UpdateProductItemDataInput') as GraphQLInputObjectType;
            const mutationFields = schema.getMutationType()!.getFields();
            expect(mutationFields.createProductItem.args[0].type.toString()).toBe('CreateProductItemInput!');
            expect(mutationFields.updateProductItem.args[0].type.toString()).toBe('UpdateProductItemInput!');
            expect(createItem.getFields()).not.toHaveProperty('id');
            expect(updateItem.getFields().id.type.toString()).toBe('ID!');
            expect(itemInput.getFields().id.type.toString()).toBe('ID');

            const item = {
                name: '셔츠',
                supplyPrice: '1000.000',
                vat: '100.000',
                isTaxFree: false,
                saleStatus: 'ALLOW',
                selectedOptions: [],
            };
            expect(() => coerceInputValue(item, createItem)).not.toThrow();
            expect(() => coerceInputValue({ ...item, id: '12' }, updateItem)).not.toThrow();
            expect(() => coerceInputValue({ ...item, id: '12' }, createItem)).toThrow('not defined');
            expect(() => coerceInputValue(item, updateItem)).toThrow('was not provided');
            expect(() => coerceInputValue({ ...item, id: null }, updateItem)).toThrow('non-nullable');
        } finally {
            await context.close();
        }
    });
});
