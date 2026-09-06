import { Migration } from '@mikro-orm/migrations';

export class Migration20260905000200_webhook_recovery extends Migration {
    override name = 'Migration20260905000200_webhook_recovery';

    override up(): void | Promise<void> {
        this.addSql(
            `alter table \`payment_webhook_events\` add \`provider_payment_id\` varchar(255) null, add \`outcome\` varchar(16) null, add \`provider_transaction_id\` varchar(255) null, add \`amount\` varchar(32) null, add \`failure_error_code\` varchar(128) null, add \`failure_error_message\` varchar(1000) null, add \`retry_count\` int unsigned not null default 0, add \`next_retry_at\` datetime(3) not null default current_timestamp(3), add \`lease_token\` char(36) null, add \`lease_until\` datetime(3) null;`
        );
        this.addSql(
            `alter table \`payment_webhook_events\` add index \`payment_webhook_events_recovery_idx\` (\`status\`, \`outcome\`, \`next_retry_at\`, \`lease_until\`);`
        );
    }

    override down(): void | Promise<void> {
        this.addSql(`alter table \`payment_webhook_events\` drop index \`payment_webhook_events_recovery_idx\`;`);
        this.addSql(
            `alter table \`payment_webhook_events\` drop column \`provider_payment_id\`, drop column \`outcome\`, drop column \`provider_transaction_id\`, drop column \`amount\`, drop column \`failure_error_code\`, drop column \`failure_error_message\`, drop column \`retry_count\`, drop column \`next_retry_at\`, drop column \`lease_token\`, drop column \`lease_until\`;`
        );
    }
}
