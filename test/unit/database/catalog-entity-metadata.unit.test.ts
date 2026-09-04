import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MikroORM, MySqlDriver } from '@mikro-orm/mysql';

import { ItemOptionValueEntity } from '~/api/catalog/domain/entity/item-option-value.entity';
import { databaseEntities } from '~/infra/database/entities';

describe('Catalog entity metadata', () => {
    const orm = new MikroORM({
        driver: MySqlDriver,
        entities: [...databaseEntities],
        metadataProvider: ReflectMetadataProvider,
        dbName: 'metadata-validation',
    });

    it('Item, Option, Value를 안정적인 단일 FK와 선택 unique로 묶는다', () => {
        const metadata = orm.getMetadata(ItemOptionValueEntity);

        expect(metadata.primaryKeys).toEqual(['id']);
        expect(metadata.properties.item).toMatchObject({
            fieldNames: ['item_id'],
            referencedColumnNames: ['id'],
        });
        expect(metadata.properties.option).toMatchObject({
            fieldNames: ['product_option_id'],
            referencedColumnNames: ['id'],
        });
        expect(metadata.properties.productId).toMatchObject({ fieldNames: ['product_id'] });
        expect(metadata.properties.productId.persist).not.toBe(false);
        expect(metadata.properties.value).toMatchObject({
            fieldNames: ['product_option_value_id'],
            referencedColumnNames: ['id'],
        });
    });

    it('현재 카탈로그 테이블과 audit Snapshot 테이블만 생성한다', async () => {
        const sql = await orm.schema.getCreateSchemaSQL();
        const selectionTable = sql
            .split('\n')
            .find((statement) => statement.startsWith('create table `item_option_values`'))!;

        expect(sql).toContain('create table `product_options`');
        expect(sql).toContain('create table `item_option_values`');
        expect(sql).toContain('create table `product_snapshots`');
        expect(selectionTable.match(/`product_id`/g)).toHaveLength(1);
        expect(sql).toContain('`id` bigint not null auto_increment primary key');
        expect(sql).toContain('unique `item_option_values_item_id_product_option_id_key`');
        expect(sql).toContain('foreign key (`item_id`) references `items` (`id`)');
        expect(sql).toContain('foreign key (`product_option_id`) references `product_options` (`id`)');
        expect(sql).toContain('foreign key (`product_option_value_id`) references `product_option_values` (`id`)');
        expect(sql).not.toContain('product_publications');
        expect(sql).not.toContain('product_snapshot_items');
    });
});
