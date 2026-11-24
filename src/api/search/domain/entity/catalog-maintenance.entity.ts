import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'catalog_maintenance' })
export class CatalogMaintenanceEntity {
    @PrimaryKey({ type: 'integer', unsigned: true, autoincrement: false, default: 1 })
    id = 1;

    @Property({ fieldName: 'owner_token', columnType: 'varchar(36)', nullable: true })
    ownerToken: string | null = null;

    @Property({ fieldName: 'started_at', columnType: 'datetime(3)', nullable: true })
    startedAt: Date | null = null;
}
