import { Collection, type Opt } from '@mikro-orm/core';
import { Entity, Index, OneToMany, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { ProductMediaEntity } from './product-media.entity';

/**
 * 객체 스토리지 파일을 식별하는 공유 자산과 업로드 당시 metadata를 보존한다.
 * 생성 후 파일과 metadata는 수정하지 않고, 내용이 달라지면 새 자산을 만든다.
 * 상품별 역할과 노출 순서는 ProductMedia가 별도 생명주기로 관리한다.
 */
@Entity({ tableName: 'media_assets' })
@Index({ name: 'media_assets_checksum_idx', properties: ['checksum'] })
export class MediaAssetEntity {
    @PrimaryKey({ fieldName: 'id', columnType: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    /** 객체 스토리지의 영속 키이며 같은 객체를 중복 자산으로 등록하지 못하게 한다. */
    @Property({ fieldName: 'storage_key', columnType: 'varchar(512)', unique: 'media_assets_storage_key_key' })
    storageKey!: string;

    @Property({ fieldName: 'original_name', columnType: 'varchar(255)', nullable: true })
    originalName!: string | null;

    @Property({ fieldName: 'mime_type', columnType: 'varchar(127)' })
    mimeType!: string;

    @Property({ fieldName: 'byte_size', type: 'bigint', unsigned: true })
    byteSize!: bigint;

    /** 업로드 무결성 확인과 동일 내용 탐색에 사용하는 SHA-256 값이다. */
    @Property({ fieldName: 'checksum', columnType: 'char(64)' })
    checksum!: string;

    @Property({ fieldName: 'width', type: 'integer', unsigned: true, nullable: true })
    width!: number | null;

    @Property({ fieldName: 'height', type: 'integer', unsigned: true, nullable: true })
    height!: number | null;

    @Property({ fieldName: 'created_at', type: 'datetime', length: 3, defaultRaw: 'CURRENT_TIMESTAMP(3)' })
    createdAt!: Date & Opt;

    @OneToMany({ entity: () => ProductMediaEntity, mappedBy: 'asset' })
    productMedia = new Collection<ProductMediaEntity>(this);
}
