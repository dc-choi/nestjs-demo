import { CategoryEntity } from '~/api/catalog/domain/entity/category.entity.js';
import { ItemOptionValueEntity } from '~/api/catalog/domain/entity/item-option-value.entity.js';
import { ItemEntity } from '~/api/catalog/domain/entity/item.entity.js';
import { MediaAssetEntity } from '~/api/catalog/domain/entity/media-asset.entity.js';
import { ProductCategoryEntity } from '~/api/catalog/domain/entity/product-category.entity.js';
import { ProductMediaEntity } from '~/api/catalog/domain/entity/product-media.entity.js';
import { ProductOptionValueEntity } from '~/api/catalog/domain/entity/product-option-value.entity.js';
import { ProductOptionEntity } from '~/api/catalog/domain/entity/product-option.entity.js';
import { ProductSnapshotEntity } from '~/api/catalog/domain/entity/product-snapshot.entity.js';
import { ProductTagEntity } from '~/api/catalog/domain/entity/product-tag.entity.js';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity.js';
import { FulfillmentItemEntity } from '~/api/fulfillment/domain/fulfillment-item.entity.js';
import { FulfillmentEntity } from '~/api/fulfillment/domain/fulfillment.entity.js';
import { InventoryMovementEntity } from '~/api/inventory/domain/inventory-movement.entity.js';
import { InventoryReservationEntity } from '~/api/inventory/domain/inventory-reservation.entity.js';
import { MemberEntity } from '~/api/member/domain/member.entity.js';
import { OrderAddressEntity } from '~/api/order/domain/entity/order-address.entity.js';
import { OrderItemSnapshotEntity } from '~/api/order/domain/entity/order-item-snapshot.entity.js';
import { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity.js';
import { OrderStatusHistoryEntity } from '~/api/order/domain/entity/order-status-history.entity.js';
import { OrderEntity } from '~/api/order/domain/entity/order.entity.js';
import { PaymentAttemptEntity } from '~/api/payment/domain/payment-attempt.entity.js';
import { PaymentTransactionEntity } from '~/api/payment/domain/payment-transaction.entity.js';
import { PaymentWebhookEventEntity } from '~/api/payment/domain/payment-webhook-event.entity.js';
import { CatalogMaintenanceEntity } from '~/infra/search/catalog-maintenance.entity.js';
import { SearchOutboxRetryHistoryEntity } from '~/infra/search/search-outbox-retry-history.entity.js';
import { SearchProjectionOutboxEntity } from '~/infra/search/search-projection-outbox.entity.js';

export const databaseEntities = [
    MemberEntity,
    ProductEntity,
    ItemEntity,
    ProductOptionEntity,
    ProductOptionValueEntity,
    ItemOptionValueEntity,
    CategoryEntity,
    ProductCategoryEntity,
    MediaAssetEntity,
    ProductMediaEntity,
    ProductTagEntity,
    ProductSnapshotEntity,
    OrderEntity,
    OrderItemEntity,
    OrderItemSnapshotEntity,
    OrderAddressEntity,
    OrderStatusHistoryEntity,
    InventoryReservationEntity,
    InventoryMovementEntity,
    PaymentAttemptEntity,
    PaymentTransactionEntity,
    PaymentWebhookEventEntity,
    FulfillmentEntity,
    FulfillmentItemEntity,
    SearchProjectionOutboxEntity,
    SearchOutboxRetryHistoryEntity,
    CatalogMaintenanceEntity,
] as const;
