import { CategoryEntity } from '~/api/catalog/domain/entity/category.entity';
import { ItemOptionValueEntity } from '~/api/catalog/domain/entity/item-option-value.entity';
import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { MediaAssetEntity } from '~/api/catalog/domain/entity/media-asset.entity';
import { ProductCategoryEntity } from '~/api/catalog/domain/entity/product-category.entity';
import { ProductMediaEntity } from '~/api/catalog/domain/entity/product-media.entity';
import { ProductOptionValueEntity } from '~/api/catalog/domain/entity/product-option-value.entity';
import { ProductOptionEntity } from '~/api/catalog/domain/entity/product-option.entity';
import { ProductSnapshotEntity } from '~/api/catalog/domain/entity/product-snapshot.entity';
import { ProductTagEntity } from '~/api/catalog/domain/entity/product-tag.entity';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';
import { FulfillmentItemEntity } from '~/api/fulfillment/domain/fulfillment-item.entity';
import { FulfillmentEntity } from '~/api/fulfillment/domain/fulfillment.entity';
import { InventoryMovementEntity } from '~/api/inventory/domain/inventory-movement.entity';
import { InventoryReservationEntity } from '~/api/inventory/domain/inventory-reservation.entity';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { OrderAddressEntity } from '~/api/order/domain/entity/order-address.entity';
import { OrderItemSnapshotEntity } from '~/api/order/domain/entity/order-item-snapshot.entity';
import { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';
import { OrderStatusHistoryEntity } from '~/api/order/domain/entity/order-status-history.entity';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { PaymentAttemptEntity } from '~/api/payment/domain/payment-attempt.entity';
import { PaymentTransactionEntity } from '~/api/payment/domain/payment-transaction.entity';
import { PaymentWebhookEventEntity } from '~/api/payment/domain/payment-webhook-event.entity';
import { CatalogMaintenanceEntity } from '~/infra/search/catalog-maintenance.entity';
import { SearchOutboxRetryHistoryEntity } from '~/infra/search/search-outbox-retry-history.entity';
import { SearchProjectionOutboxEntity } from '~/infra/search/search-projection-outbox.entity';

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
