import { Migration } from '@mikro-orm/migrations';

export class Migration20260905000400_catalog_maintenance extends Migration {
    override async up(): Promise<void> {
        this.addSql(
            'create table `catalog_maintenance` (`id` int unsigned not null default 1, `owner_token` varchar(36) null, `started_at` datetime(3) null, primary key (`id`)) default character set utf8mb4 engine = InnoDB;'
        );
        this.addSql('insert into `catalog_maintenance` (`id`) values (1);');
    }

    override async down(): Promise<void> {
        this.addSql('drop table if exists `catalog_maintenance`;');
    }
}
