import { Migration } from '@mikro-orm/migrations';

export class Migration20260904140344_initial_schema extends Migration {
    override name = 'Migration20260904140344_initial_schema';

    override up(): void | Promise<void> {
        this.addSql(
            `create table \`categories\` (\`id\` bigint not null auto_increment primary key, \`name\` varchar(255) not null, \`slug\` varchar(255) not null, \`sequence\` int unsigned not null default 0, \`is_active\` tinyint(1) not null default true, \`created_at\` datetime(3) not null default current_timestamp(3), \`updated_at\` datetime(3) not null default current_timestamp(3), \`deleted_at\` datetime(3) null, \`parent_id\` bigint null) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(`alter table \`categories\` add unique \`categories_slug_key\` (\`slug\`);`);
        this.addSql(
            `alter table \`categories\` add index \`categories_parent_id_is_active_sequence_idx\` (\`parent_id\`, \`is_active\`, \`sequence\`);`
        );
        this.addSql(
            `alter table \`categories\` add unique \`categories_parent_id_name_key\` (\`parent_id\`, \`name\`);`
        );

        this.addSql(
            `create table \`media_assets\` (\`id\` bigint not null auto_increment primary key, \`storage_key\` varchar(512) not null, \`original_name\` varchar(255) null, \`mime_type\` varchar(127) not null, \`byte_size\` bigint unsigned not null, \`checksum\` char(64) not null, \`width\` int unsigned null, \`height\` int unsigned null, \`created_at\` datetime(3) not null default current_timestamp(3)) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(`alter table \`media_assets\` add unique \`media_assets_storage_key_key\` (\`storage_key\`);`);
        this.addSql(`alter table \`media_assets\` add index \`media_assets_checksum_idx\` (\`checksum\`);`);

        this.addSql(
            `create table \`members\` (\`id\` bigint not null auto_increment primary key, \`name\` varchar(255) not null, \`email\` varchar(255) not null, \`hashed_password\` varchar(128) null, \`phone\` varchar(255) not null, \`role\` enum('ADMIN','SELLER','CUSTOMER','GUEST') not null default 'GUEST', \`last_login_at\` datetime null, \`membership_at\` datetime null, \`created_at\` datetime not null default CURRENT_TIMESTAMP, \`updated_at\` datetime not null default CURRENT_TIMESTAMP, \`deleted_at\` datetime null) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(`alter table \`members\` add unique \`members_email_key\` (\`email\`);`);

        this.addSql(
            `create table \`orders\` (\`id\` bigint not null auto_increment primary key, \`order_number\` varchar(255) not null, \`idempotency_key\` varchar(128) not null, \`request_fingerprint\` char(64) not null, \`status\` enum('PENDING','CONFIRMED','CANCELLED','COMPLETED') not null default 'PENDING', \`currency_code\` char(3) not null default 'KRW', \`total_price\` numeric(19,3) not null, \`placed_at\` datetime(3) null, \`cancelled_at\` datetime(3) null, \`completed_at\` datetime(3) null, \`created_at\` datetime not null default CURRENT_TIMESTAMP, \`updated_at\` datetime not null default CURRENT_TIMESTAMP, \`deleted_at\` datetime null, \`member_id\` bigint not null) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(`alter table \`orders\` add unique \`orders_order_number_key\` (\`order_number\`);`);
        this.addSql(`alter table \`orders\` add index \`orders_status_created_at_idx\` (\`status\`, \`created_at\`);`);
        this.addSql(
            `alter table \`orders\` add index \`orders_member_id_created_at_idx\` (\`member_id\`, \`created_at\`);`
        );
        this.addSql(
            `alter table \`orders\` add unique \`orders_member_id_idempotency_key_key\` (\`member_id\`, \`idempotency_key\`);`
        );

        this.addSql(
            `create table \`order_addresses\` (\`id\` bigint not null auto_increment primary key, \`type\` enum('BILLING','SHIPPING') not null, \`recipient_name\` varchar(255) not null, \`phone\` varchar(32) not null, \`postal_code\` varchar(32) not null, \`country_code\` char(2) not null, \`province\` varchar(255) null, \`city\` varchar(255) not null, \`line1\` varchar(255) not null, \`line2\` varchar(255) null, \`created_at\` datetime(3) not null default current_timestamp(3), \`order_id\` bigint not null) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(
            `alter table \`order_addresses\` add unique \`order_addresses_order_id_type_key\` (\`order_id\`, \`type\`);`
        );

        this.addSql(
            `create table \`fulfillments\` (\`id\` bigint not null auto_increment primary key, \`idempotency_key\` varchar(128) not null, \`status\` enum('PENDING','PACKED','SHIPPED','DELIVERED','CANCELLED') not null default 'PENDING', \`carrier\` varchar(128) null, \`tracking_number\` varchar(255) null, \`packed_at\` datetime(3) null, \`shipped_at\` datetime(3) null, \`delivered_at\` datetime(3) null, \`cancelled_at\` datetime(3) null, \`created_at\` datetime(3) not null default current_timestamp(3), \`updated_at\` datetime(3) not null default current_timestamp(3), \`order_id\` bigint not null) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(
            `alter table \`fulfillments\` add index \`fulfillments_carrier_tracking_number_idx\` (\`carrier\`, \`tracking_number\`);`
        );
        this.addSql(
            `alter table \`fulfillments\` add index \`fulfillments_order_id_status_idx\` (\`order_id\`, \`status\`);`
        );
        this.addSql(
            `alter table \`fulfillments\` add unique \`fulfillments_order_id_idempotency_key_key\` (\`order_id\`, \`idempotency_key\`);`
        );

        this.addSql(
            `create table \`order_status_histories\` (\`id\` bigint not null auto_increment primary key, \`from_status\` enum('PENDING','CONFIRMED','CANCELLED','COMPLETED') null, \`to_status\` enum('PENDING','CONFIRMED','CANCELLED','COMPLETED') not null, \`reason\` varchar(255) null, \`actor_type\` enum('MEMBER','SYSTEM','PROVIDER') not null default 'SYSTEM', \`actor_id\` varchar(255) null, \`request_id\` varchar(255) null, \`metadata\` json null, \`created_at\` datetime(3) not null default current_timestamp(3), \`order_id\` bigint not null) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(
            `alter table \`order_status_histories\` add index \`order_status_histories_request_id_idx\` (\`request_id\`);`
        );
        this.addSql(
            `alter table \`order_status_histories\` add index \`order_status_histories_order_id_created_at_idx\` (\`order_id\`, \`created_at\`);`
        );

        this.addSql(
            `create table \`payment_attempts\` (\`id\` bigint not null auto_increment primary key, \`provider\` varchar(64) not null, \`method\` varchar(64) null, \`status\` enum('PENDING','REQUIRES_ACTION','AUTHORIZED','CAPTURED','PARTIALLY_REFUNDED','REFUNDED','CANCELLED','FAILED') not null default 'PENDING', \`requested_amount\` numeric(19,3) not null, \`currency_code\` char(3) not null, \`idempotency_key\` varchar(128) not null, \`provider_payment_id\` varchar(255) null, \`error_code\` varchar(128) null, \`error_message\` text null, \`authorized_at\` datetime(3) null, \`captured_at\` datetime(3) null, \`cancelled_at\` datetime(3) null, \`created_at\` datetime(3) not null default current_timestamp(3), \`updated_at\` datetime(3) not null default current_timestamp(3), \`order_id\` bigint not null) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(
            `alter table \`payment_attempts\` add index \`payment_attempts_order_id_status_idx\` (\`order_id\`, \`status\`);`
        );
        this.addSql(
            `alter table \`payment_attempts\` add unique \`payment_attempts_provider_provider_payment_id_key\` (\`provider\`, \`provider_payment_id\`);`
        );
        this.addSql(
            `alter table \`payment_attempts\` add unique \`payment_attempts_provider_idempotency_key_key\` (\`provider\`, \`idempotency_key\`);`
        );

        this.addSql(
            `create table \`payment_transactions\` (\`id\` bigint not null auto_increment primary key, \`type\` enum('AUTHORIZE','CAPTURE','REFUND','VOID') not null, \`status\` enum('PENDING','SUCCEEDED','FAILED') not null default 'PENDING', \`amount\` numeric(19,3) not null, \`idempotency_key\` varchar(128) not null, \`provider_transaction_id\` varchar(255) null, \`error_code\` varchar(128) null, \`error_message\` text null, \`processed_at\` datetime(3) null, \`created_at\` datetime(3) not null default current_timestamp(3), \`payment_attempt_id\` bigint not null) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(
            `alter table \`payment_transactions\` add index \`payment_transactions_payment_attempt_id_status_idx\` (\`payment_attempt_id\`, \`status\`);`
        );
        this.addSql(
            `alter table \`payment_transactions\` add unique \`payment_transactions_payment_attempt_id_provider_transaction_key\` (\`payment_attempt_id\`, \`provider_transaction_id\`);`
        );
        this.addSql(
            `alter table \`payment_transactions\` add unique \`payment_transactions_payment_attempt_id_idempotency_key_key\` (\`payment_attempt_id\`, \`idempotency_key\`);`
        );

        this.addSql(
            `create table \`payment_webhook_events\` (\`id\` bigint not null auto_increment primary key, \`provider\` varchar(64) not null, \`provider_event_id\` varchar(255) not null, \`payload_hash\` char(64) not null, \`status\` enum('RECEIVED','PROCESSED','FAILED') not null default 'RECEIVED', \`received_at\` datetime(3) not null default current_timestamp(3), \`processed_at\` datetime(3) null, \`error_message\` text null, \`payment_attempt_id\` bigint null) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(
            `alter table \`payment_webhook_events\` add index \`payment_webhook_events_payment_attempt_id_fkey\` (\`payment_attempt_id\`);`
        );
        this.addSql(
            `alter table \`payment_webhook_events\` add index \`payment_webhook_events_status_received_at_idx\` (\`status\`, \`received_at\`);`
        );
        this.addSql(
            `alter table \`payment_webhook_events\` add unique \`payment_webhook_events_provider_provider_event_id_key\` (\`provider\`, \`provider_event_id\`);`
        );

        this.addSql(
            `create table \`products\` (\`id\` bigint not null auto_increment primary key, \`slug\` varchar(255) not null, \`name\` varchar(255) not null, \`description\` longtext null, \`return_policy\` text null, \`status\` enum('DRAFT','ACTIVE','PAUSED','SUSPENDED','CLOSED') not null default 'DRAFT', \`revision\` int not null default 1, \`created_at\` datetime(3) not null default current_timestamp(3), \`updated_at\` datetime(3) not null default current_timestamp(3), \`deleted_at\` datetime(3) null, \`seller_id\` bigint not null) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(`alter table \`products\` add unique \`products_slug_key\` (\`slug\`);`);
        this.addSql(
            `alter table \`products\` add index \`products_status_created_at_idx\` (\`status\`, \`created_at\`);`
        );
        this.addSql(
            `alter table \`products\` add index \`products_seller_id_status_idx\` (\`seller_id\`, \`status\`);`
        );

        this.addSql(
            `create table \`product_categories\` (\`product_id\` bigint not null, \`category_id\` bigint not null, \`sequence\` int unsigned not null, primary key (\`product_id\`, \`category_id\`)) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(
            `alter table \`product_categories\` add index \`product_categories_category_id_sequence_idx\` (\`category_id\`, \`sequence\`);`
        );
        this.addSql(
            `alter table \`product_categories\` add unique \`product_categories_product_id_sequence_key\` (\`product_id\`, \`sequence\`);`
        );

        this.addSql(
            `create table \`items\` (\`id\` bigint not null auto_increment primary key, \`sku\` varchar(255) not null, \`name\` varchar(255) not null, \`supply_price\` decimal(10,3) not null, \`vat\` decimal(10,3) not null, \`total_price\` decimal(10,3) not null, \`is_tax_free\` tinyint(1) not null default false, \`sale_status\` enum('ALLOW','DENY') not null default 'DENY', \`stock\` int not null default 0, \`sequence\` int unsigned not null, \`option_signature\` char(64) not null, \`created_at\` datetime not null default CURRENT_TIMESTAMP, \`updated_at\` datetime not null default CURRENT_TIMESTAMP, \`deleted_at\` datetime null, \`product_id\` bigint not null) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(`alter table \`items\` add unique \`items_sku_key\` (\`sku\`);`);
        this.addSql(
            `alter table \`items\` add index \`items_product_id_deleted_at_idx\` (\`product_id\`, \`deleted_at\`);`
        );
        this.addSql(
            `alter table \`items\` add unique \`items_product_id_option_signature_key\` (\`product_id\`, \`option_signature\`);`
        );
        this.addSql(
            `alter table \`items\` add unique \`items_product_id_sequence_key\` (\`product_id\`, \`sequence\`);`
        );
        this.addSql(
            `create table \`order_items\` (\`id\` bigint not null auto_increment primary key, \`price\` numeric(19,3) not null, \`quantity\` int not null, \`created_at\` datetime not null default CURRENT_TIMESTAMP, \`item_id\` bigint not null, \`order_id\` bigint not null) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(`alter table \`order_items\` add index \`order_items_item_id_idx\` (\`item_id\`);`);
        this.addSql(`alter table \`order_items\` add index \`order_items_order_id_idx\` (\`order_id\`);`);

        this.addSql(
            `create table \`order_item_snapshots\` (\`order_item_id\` bigint not null, \`product_name\` varchar(255) not null, \`item_name\` varchar(255) not null, \`item_sku\` varchar(255) not null, \`product_description\` longtext null, \`product_return_policy\` text null, \`unit_supply_price\` numeric(10,3) not null, \`unit_vat\` numeric(10,3) not null, \`unit_total_price\` numeric(10,3) not null, \`is_tax_free\` tinyint(1) not null default false, \`selected_options\` json not null, \`source_product_id\` bigint not null, \`source_item_id\` bigint not null, \`source_product_revision\` int not null, \`created_at\` datetime(3) not null default current_timestamp(3), primary key (\`order_item_id\`)) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(
            `alter table \`order_item_snapshots\` add index \`order_item_snapshots_source_product_item_revision_idx\` (\`source_product_id\`, \`source_item_id\`, \`source_product_revision\`);`
        );

        this.addSql(
            `create table \`inventory_reservations\` (\`id\` bigint not null auto_increment primary key, \`quantity\` int not null, \`status\` enum('RESERVED','CONSUMED','RELEASED','EXPIRED') not null default 'RESERVED', \`expires_at\` datetime(3) not null, \`consumed_at\` datetime(3) null, \`released_at\` datetime(3) null, \`created_at\` datetime(3) not null default current_timestamp(3), \`updated_at\` datetime(3) not null default current_timestamp(3), \`order_item_id\` bigint not null) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(
            `alter table \`inventory_reservations\` add unique \`inventory_reservations_order_item_id_key\` (\`order_item_id\`);`
        );
        this.addSql(
            `alter table \`inventory_reservations\` add index \`inventory_reservations_status_expires_at_idx\` (\`status\`, \`expires_at\`);`
        );

        this.addSql(
            `create table \`fulfillment_items\` (\`id\` bigint not null auto_increment primary key, \`quantity\` int not null, \`fulfillment_id\` bigint not null, \`order_item_id\` bigint not null) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(
            `alter table \`fulfillment_items\` add index \`fulfillment_items_order_item_id_idx\` (\`order_item_id\`);`
        );
        this.addSql(
            `alter table \`fulfillment_items\` add unique \`fulfillment_items_fulfillment_id_order_item_id_key\` (\`fulfillment_id\`, \`order_item_id\`);`
        );

        this.addSql(
            `create table \`inventory_movements\` (\`id\` bigint not null auto_increment primary key, \`type\` enum('RECEIPT','ADJUSTMENT','RESERVATION','RELEASE','SALE','RETURN') not null, \`quantity_delta\` int not null, \`stock_after\` int not null, \`item_sku\` varchar(255) not null, \`idempotency_key\` varchar(128) not null, \`reference_type\` varchar(64) null, \`reference_id\` varchar(128) null, \`reason\` varchar(255) null, \`created_at\` datetime(3) not null default current_timestamp(3), \`item_id\` bigint not null) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(
            `alter table \`inventory_movements\` add index \`inventory_movements_reference_type_reference_id_idx\` (\`reference_type\`, \`reference_id\`);`
        );
        this.addSql(
            `alter table \`inventory_movements\` add index \`inventory_movements_item_sku_created_at_idx\` (\`item_sku\`, \`created_at\`);`
        );
        this.addSql(
            `alter table \`inventory_movements\` add index \`inventory_movements_item_id_created_at_idx\` (\`item_id\`, \`created_at\`);`
        );
        this.addSql(
            `alter table \`inventory_movements\` add unique \`inventory_movements_item_id_idempotency_key_key\` (\`item_id\`, \`idempotency_key\`);`
        );

        this.addSql(
            `create table \`product_media\` (\`id\` bigint not null auto_increment primary key, \`role\` enum('THUMBNAIL','GALLERY','DETAIL','ATTACHMENT') not null default 'GALLERY', \`alt_text\` varchar(255) null, \`sequence\` int unsigned not null, \`product_id\` bigint not null, \`media_asset_id\` bigint not null) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(
            `alter table \`product_media\` add index \`product_media_media_asset_id_idx\` (\`media_asset_id\`);`
        );
        this.addSql(
            `alter table \`product_media\` add unique \`product_media_product_id_media_asset_id_role_key\` (\`product_id\`, \`media_asset_id\`, \`role\`);`
        );
        this.addSql(
            `alter table \`product_media\` add unique \`product_media_product_id_role_sequence_key\` (\`product_id\`, \`role\`, \`sequence\`);`
        );

        this.addSql(
            `create table \`product_options\` (\`id\` bigint not null auto_increment primary key, \`code\` varchar(64) not null, \`name\` varchar(255) not null, \`is_required\` tinyint(1) not null default true, \`sequence\` int unsigned not null, \`product_id\` bigint not null) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(
            `alter table \`product_options\` add unique \`product_options_product_id_sequence_key\` (\`product_id\`, \`sequence\`);`
        );
        this.addSql(
            `alter table \`product_options\` add unique \`product_options_product_id_name_key\` (\`product_id\`, \`name\`);`
        );
        this.addSql(
            `alter table \`product_options\` add unique \`product_options_product_id_code_key\` (\`product_id\`, \`code\`);`
        );
        this.addSql(
            `create table \`product_option_values\` (\`id\` bigint not null auto_increment primary key, \`code\` varchar(64) not null, \`name\` varchar(255) not null, \`sequence\` int unsigned not null, \`product_option_id\` bigint not null) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(
            `alter table \`product_option_values\` add unique \`product_option_values_option_id_sequence_key\` (\`product_option_id\`, \`sequence\`);`
        );
        this.addSql(
            `alter table \`product_option_values\` add unique \`product_option_values_option_id_name_key\` (\`product_option_id\`, \`name\`);`
        );
        this.addSql(
            `alter table \`product_option_values\` add unique \`product_option_values_option_id_code_key\` (\`product_option_id\`, \`code\`);`
        );
        this.addSql(
            `create table \`item_option_values\` (\`id\` bigint not null auto_increment primary key, \`product_id\` bigint not null, \`item_id\` bigint not null, \`product_option_id\` bigint not null, \`product_option_value_id\` bigint not null) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(
            `alter table \`item_option_values\` add index \`item_option_values_value_idx\` (\`product_option_value_id\`);`
        );
        this.addSql(
            `alter table \`item_option_values\` add index \`item_option_values_option_idx\` (\`product_option_id\`);`
        );
        this.addSql(
            `alter table \`item_option_values\` add index \`item_option_values_item_id_product_id_idx\` (\`item_id\`, \`product_id\`);`
        );
        this.addSql(
            `alter table \`item_option_values\` add unique \`item_option_values_item_id_product_option_id_key\` (\`item_id\`, \`product_option_id\`);`
        );

        this.addSql(
            `create table \`product_snapshots\` (\`id\` bigint not null auto_increment primary key, \`revision\` int not null, \`schema_version\` int unsigned not null, \`change_type\` enum('CREATE','UPDATE','RESTORE','DELETE') not null, \`payload\` json not null, \`reason\` varchar(500) null, \`created_at\` datetime(3) not null default current_timestamp(3), \`product_id\` bigint not null, \`changed_by_member_id\` bigint null) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(
            `alter table \`product_snapshots\` add index \`product_snapshots_changed_by_member_id_idx\` (\`changed_by_member_id\`);`
        );
        this.addSql(
            `alter table \`product_snapshots\` add index \`product_snapshots_product_id_created_at_idx\` (\`product_id\`, \`created_at\`);`
        );
        this.addSql(
            `alter table \`product_snapshots\` add unique \`product_snapshots_product_id_revision_key\` (\`product_id\`, \`revision\`);`
        );

        this.addSql(
            `create table \`product_tags\` (\`product_id\` bigint not null, \`value\` varchar(64) not null, \`sequence\` int unsigned not null, primary key (\`product_id\`, \`value\`)) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(`alter table \`product_tags\` add index \`product_tags_value_idx\` (\`value\`);`);
        this.addSql(
            `alter table \`product_tags\` add unique \`product_tags_product_id_sequence_key\` (\`product_id\`, \`sequence\`);`
        );

        this.addSql(
            `create table \`search_projection_outbox\` (\`id\` bigint not null auto_increment primary key, \`product_id\` bigint not null, \`product_revision\` int not null, \`status\` enum('PENDING','PROCESSING','PROCESSED','DEAD_LETTER') not null default 'PENDING', \`attempts\` int unsigned not null default 0, \`available_at\` datetime(3) not null default current_timestamp(3), \`lease_token\` char(36) null, \`leased_until\` datetime(3) null, \`last_error\` varchar(1000) null, \`created_at\` datetime(3) not null default current_timestamp(3), \`processed_at\` datetime(3) null) default character set utf8mb4 engine = InnoDB;`
        );
        this.addSql(
            `alter table \`search_projection_outbox\` add index \`search_projection_outbox_lease_idx\` (\`status\`, \`leased_until\`);`
        );
        this.addSql(
            `alter table \`search_projection_outbox\` add index \`search_projection_outbox_status_available_id_idx\` (\`status\`, \`available_at\`, \`id\`);`
        );
        this.addSql(
            `alter table \`search_projection_outbox\` add unique \`search_projection_outbox_product_revision_key\` (\`product_id\`, \`product_revision\`);`
        );

        this.addSql(
            `alter table \`categories\` add constraint \`categories_parent_id_fkey\` foreign key (\`parent_id\`) references \`categories\` (\`id\`) on update cascade on delete restrict;`
        );

        this.addSql(
            `alter table \`orders\` add constraint \`orders_member_id_fkey\` foreign key (\`member_id\`) references \`members\` (\`id\`) on update cascade on delete restrict;`
        );

        this.addSql(
            `alter table \`order_addresses\` add constraint \`order_addresses_order_id_fkey\` foreign key (\`order_id\`) references \`orders\` (\`id\`) on update cascade on delete restrict;`
        );

        this.addSql(
            `alter table \`fulfillments\` add constraint \`fulfillments_order_id_fkey\` foreign key (\`order_id\`) references \`orders\` (\`id\`) on update cascade on delete restrict;`
        );

        this.addSql(
            `alter table \`order_status_histories\` add constraint \`order_status_histories_order_id_fkey\` foreign key (\`order_id\`) references \`orders\` (\`id\`) on update cascade on delete restrict;`
        );

        this.addSql(
            `alter table \`payment_attempts\` add constraint \`payment_attempts_order_id_fkey\` foreign key (\`order_id\`) references \`orders\` (\`id\`) on update cascade on delete restrict;`
        );

        this.addSql(
            `alter table \`payment_transactions\` add constraint \`payment_transactions_payment_attempt_id_fkey\` foreign key (\`payment_attempt_id\`) references \`payment_attempts\` (\`id\`) on update cascade on delete restrict;`
        );

        this.addSql(
            `alter table \`payment_webhook_events\` add constraint \`payment_webhook_events_payment_attempt_id_fkey\` foreign key (\`payment_attempt_id\`) references \`payment_attempts\` (\`id\`) on update cascade on delete set null;`
        );

        this.addSql(
            `alter table \`products\` add constraint \`products_seller_id_fkey\` foreign key (\`seller_id\`) references \`members\` (\`id\`) on update cascade on delete restrict;`
        );

        this.addSql(
            `alter table \`product_categories\` add constraint \`product_categories_product_id_fkey\` foreign key (\`product_id\`) references \`products\` (\`id\`) on update cascade on delete restrict;`
        );
        this.addSql(
            `alter table \`product_categories\` add constraint \`product_categories_category_id_fkey\` foreign key (\`category_id\`) references \`categories\` (\`id\`) on update cascade on delete restrict;`
        );

        this.addSql(
            `alter table \`items\` add constraint \`items_product_id_fkey\` foreign key (\`product_id\`) references \`products\` (\`id\`) on update cascade on delete restrict;`
        );

        this.addSql(
            `alter table \`order_items\` add constraint \`order_items_item_id_fkey\` foreign key (\`item_id\`) references \`items\` (\`id\`) on update cascade on delete restrict;`
        );
        this.addSql(
            `alter table \`order_items\` add constraint \`order_items_order_id_fkey\` foreign key (\`order_id\`) references \`orders\` (\`id\`) on update cascade on delete restrict;`
        );

        this.addSql(
            `alter table \`order_item_snapshots\` add constraint \`order_item_snapshots_order_item_id_fkey\` foreign key (\`order_item_id\`) references \`order_items\` (\`id\`) on update cascade on delete restrict;`
        );

        this.addSql(
            `alter table \`inventory_reservations\` add constraint \`inventory_reservations_order_item_id_fkey\` foreign key (\`order_item_id\`) references \`order_items\` (\`id\`) on update cascade on delete restrict;`
        );

        this.addSql(
            `alter table \`fulfillment_items\` add constraint \`fulfillment_items_fulfillment_id_fkey\` foreign key (\`fulfillment_id\`) references \`fulfillments\` (\`id\`) on update cascade on delete restrict;`
        );
        this.addSql(
            `alter table \`fulfillment_items\` add constraint \`fulfillment_items_order_item_id_fkey\` foreign key (\`order_item_id\`) references \`order_items\` (\`id\`) on update cascade on delete restrict;`
        );

        this.addSql(
            `alter table \`inventory_movements\` add constraint \`inventory_movements_item_id_fkey\` foreign key (\`item_id\`) references \`items\` (\`id\`) on update cascade on delete restrict;`
        );

        this.addSql(
            `alter table \`product_media\` add constraint \`product_media_product_id_fkey\` foreign key (\`product_id\`) references \`products\` (\`id\`) on update cascade on delete restrict;`
        );
        this.addSql(
            `alter table \`product_media\` add constraint \`product_media_media_asset_id_fkey\` foreign key (\`media_asset_id\`) references \`media_assets\` (\`id\`) on update cascade on delete restrict;`
        );

        this.addSql(
            `alter table \`product_options\` add constraint \`product_options_product_id_fkey\` foreign key (\`product_id\`) references \`products\` (\`id\`) on update cascade on delete restrict;`
        );

        this.addSql(
            `alter table \`product_option_values\` add constraint \`product_option_values_product_option_id_fkey\` foreign key (\`product_option_id\`) references \`product_options\` (\`id\`) on update cascade on delete restrict;`
        );

        this.addSql(
            `alter table \`item_option_values\` add constraint \`item_option_values_item_id_fkey\` foreign key (\`item_id\`) references \`items\` (\`id\`) on update cascade on delete restrict;`
        );
        this.addSql(
            `alter table \`item_option_values\` add constraint \`item_option_values_product_option_id_fkey\` foreign key (\`product_option_id\`) references \`product_options\` (\`id\`) on update cascade on delete restrict;`
        );
        this.addSql(
            `alter table \`item_option_values\` add constraint \`item_option_values_value_id_fkey\` foreign key (\`product_option_value_id\`) references \`product_option_values\` (\`id\`) on update cascade on delete restrict;`
        );

        this.addSql(
            `alter table \`product_snapshots\` add constraint \`product_snapshots_product_id_fkey\` foreign key (\`product_id\`) references \`products\` (\`id\`) on update cascade on delete restrict;`
        );
        this.addSql(
            `alter table \`product_snapshots\` add constraint \`product_snapshots_changed_by_member_id_fkey\` foreign key (\`changed_by_member_id\`) references \`members\` (\`id\`) on update cascade on delete restrict;`
        );

        this.addSql(
            `alter table \`product_tags\` add constraint \`product_tags_product_id_fkey\` foreign key (\`product_id\`) references \`products\` (\`id\`) on update cascade on delete restrict;`
        );

        this.addSql(
            `alter table \`search_projection_outbox\` add constraint \`search_projection_outbox_product_id_fkey\` foreign key (\`product_id\`) references \`products\` (\`id\`) on update cascade on delete restrict;`
        );
    }

    override down(): void | Promise<void> {
        this.addSql('drop table if exists `search_projection_outbox`;');
        this.addSql('drop table if exists `product_tags`;');
        this.addSql('drop table if exists `product_snapshots`;');
        this.addSql('drop table if exists `item_option_values`;');
        this.addSql('drop table if exists `product_option_values`;');
        this.addSql('drop table if exists `product_options`;');
        this.addSql('drop table if exists `product_media`;');
        this.addSql('drop table if exists `inventory_movements`;');
        this.addSql('drop table if exists `fulfillment_items`;');
        this.addSql('drop table if exists `inventory_reservations`;');
        this.addSql('drop table if exists `order_item_snapshots`;');
        this.addSql('drop table if exists `order_items`;');
        this.addSql('drop table if exists `items`;');
        this.addSql('drop table if exists `product_categories`;');
        this.addSql('drop table if exists `products`;');
        this.addSql('drop table if exists `payment_webhook_events`;');
        this.addSql('drop table if exists `payment_transactions`;');
        this.addSql('drop table if exists `payment_attempts`;');
        this.addSql('drop table if exists `order_status_histories`;');
        this.addSql('drop table if exists `fulfillments`;');
        this.addSql('drop table if exists `order_addresses`;');
        this.addSql('drop table if exists `orders`;');
        this.addSql('drop table if exists `members`;');
        this.addSql('drop table if exists `media_assets`;');
        this.addSql('drop table if exists `categories`;');
    }
}
