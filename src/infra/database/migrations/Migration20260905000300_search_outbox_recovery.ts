import { Migration } from '@mikro-orm/migrations';

export class Migration20260905000300_search_outbox_recovery extends Migration {
    override name = 'Migration20260905000300_search_outbox_recovery';

    override up(): void | Promise<void> {
        this.addSql(
            `create table \`search_projection_outbox_retry_history\` (\`id\` bigint not null auto_increment primary key, \`outbox_id\` bigint not null, \`product_id\` bigint not null, \`previous_attempts\` int unsigned not null, \`previous_last_error\` varchar(1000) null, \`action\` varchar(32) not null, \`reason\` varchar(500) not null, \`created_at\` datetime(3) not null default current_timestamp(3)) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(
            `alter table \`search_projection_outbox_retry_history\` add index \`search_projection_outbox_retry_history_outbox_created_idx\` (\`outbox_id\`, \`created_at\`);`
        );
        this.addSql(
            `alter table \`search_projection_outbox_retry_history\` add index \`search_projection_outbox_retry_history_product_created_idx\` (\`product_id\`, \`created_at\`);`
        );
        this.addSql(
            `alter table \`search_projection_outbox_retry_history\` add constraint \`search_projection_outbox_retry_history_outbox_id_fkey\` foreign key (\`outbox_id\`) references \`search_projection_outbox\` (\`id\`) on update cascade on delete restrict;`
        );
        this.addSql(
            `alter table \`search_projection_outbox_retry_history\` add constraint \`search_projection_outbox_retry_history_product_id_fkey\` foreign key (\`product_id\`) references \`products\` (\`id\`) on update cascade on delete restrict;`
        );
    }

    override down(): void | Promise<void> {
        this.addSql('drop table if exists `search_projection_outbox_retry_history`;');
    }
}
