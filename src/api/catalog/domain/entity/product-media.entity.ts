import { type Opt, type Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { MediaAssetEntity } from './media-asset.entity';
import { ProductMediaRole } from './product-media-role';
import { ProductEntity } from './product.entity';

/**
 * live Product에 공유 MediaAsset의 역할, 대체 문구와 노출 순서를 부여하는 연결 모델이다.
 * 자산의 불변 생명주기와 상품별 표현 변경을 분리하며 역할별 배치 중복을 막는다.
 */
@Entity({ tableName: 'product_media' })
@Unique({ name: 'product_media_product_id_role_sequence_key', properties: ['product', 'role', 'sequence'] })
@Unique({ name: 'product_media_product_id_media_asset_id_role_key', properties: ['product', 'asset', 'role'] })
@Index({ name: 'product_media_media_asset_id_idx', properties: ['asset'] })
export class ProductMediaEntity {
    @PrimaryKey({ fieldName: 'id', columnType: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    @Enum({ fieldName: 'role', items: () => ProductMediaRole, default: ProductMediaRole.GALLERY })
    role: ProductMediaRole & Opt = ProductMediaRole.GALLERY;

    @Property({ fieldName: 'alt_text', columnType: 'varchar(255)', nullable: true })
    altText!: string | null;

    @Property({ fieldName: 'sequence', type: 'integer', unsigned: true })
    sequence!: number;

    @ManyToOne({
        entity: () => ProductEntity,
        fieldName: 'product_id',
        updateRule: 'cascade',
        deleteRule: 'restrict',
        foreignKeyName: 'product_media_product_id_fkey',
        unsigned: false,
        index: false,
    })
    product!: Rel<ProductEntity>;

    @ManyToOne({
        entity: () => MediaAssetEntity,
        fieldName: 'media_asset_id',
        updateRule: 'cascade',
        deleteRule: 'restrict',
        foreignKeyName: 'product_media_media_asset_id_fkey',
        unsigned: false,
        index: false,
    })
    asset!: Rel<MediaAssetEntity>;
}
