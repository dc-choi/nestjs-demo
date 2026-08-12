export const ProductSnapshotStatus = {
    DRAFT: "DRAFT",
    PUBLISHED: "PUBLISHED"
} as const;
export type ProductSnapshotStatus = (typeof ProductSnapshotStatus)[keyof typeof ProductSnapshotStatus];
export const ItemSaleStatus = {
    ALLOW: "ALLOW",
    DENY: "DENY"
} as const;
export type ItemSaleStatus = (typeof ItemSaleStatus)[keyof typeof ItemSaleStatus];
export const ProductStatus = {
    DRAFT: "DRAFT",
    ACTIVE: "ACTIVE",
    PAUSED: "PAUSED",
    SUSPENDED: "SUSPENDED",
    CLOSED: "CLOSED"
} as const;
export type ProductStatus = (typeof ProductStatus)[keyof typeof ProductStatus];
export const ProductMediaRole = {
    THUMBNAIL: "THUMBNAIL",
    GALLERY: "GALLERY",
    DETAIL: "DETAIL",
    ATTACHMENT: "ATTACHMENT"
} as const;
export type ProductMediaRole = (typeof ProductMediaRole)[keyof typeof ProductMediaRole];
export const FulfillmentStatus = {
    PENDING: "PENDING",
    PACKED: "PACKED",
    SHIPPED: "SHIPPED",
    DELIVERED: "DELIVERED",
    CANCELLED: "CANCELLED"
} as const;
export type FulfillmentStatus = (typeof FulfillmentStatus)[keyof typeof FulfillmentStatus];
export const InventoryReservationStatus = {
    RESERVED: "RESERVED",
    CONSUMED: "CONSUMED",
    RELEASED: "RELEASED",
    EXPIRED: "EXPIRED"
} as const;
export type InventoryReservationStatus = (typeof InventoryReservationStatus)[keyof typeof InventoryReservationStatus];
export const InventoryMovementType = {
    RECEIPT: "RECEIPT",
    ADJUSTMENT: "ADJUSTMENT",
    RESERVATION: "RESERVATION",
    RELEASE: "RELEASE",
    SALE: "SALE",
    RETURN: "RETURN"
} as const;
export type InventoryMovementType = (typeof InventoryMovementType)[keyof typeof InventoryMovementType];
export const MemberRole = {
    ADMIN: "ADMIN",
    SELLER: "SELLER",
    CUSTOMER: "CUSTOMER",
    GUEST: "GUEST"
} as const;
export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];
export const OrderStatus = {
    PENDING: "PENDING",
    CONFIRMED: "CONFIRMED",
    CANCELLED: "CANCELLED",
    COMPLETED: "COMPLETED"
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];
export const OrderAddressType = {
    BILLING: "BILLING",
    SHIPPING: "SHIPPING"
} as const;
export type OrderAddressType = (typeof OrderAddressType)[keyof typeof OrderAddressType];
export const OrderActorType = {
    MEMBER: "MEMBER",
    SYSTEM: "SYSTEM",
    PROVIDER: "PROVIDER"
} as const;
export type OrderActorType = (typeof OrderActorType)[keyof typeof OrderActorType];
export const PaymentAttemptStatus = {
    PENDING: "PENDING",
    REQUIRES_ACTION: "REQUIRES_ACTION",
    AUTHORIZED: "AUTHORIZED",
    CAPTURED: "CAPTURED",
    PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
    REFUNDED: "REFUNDED",
    CANCELLED: "CANCELLED",
    FAILED: "FAILED"
} as const;
export type PaymentAttemptStatus = (typeof PaymentAttemptStatus)[keyof typeof PaymentAttemptStatus];
export const PaymentTransactionType = {
    AUTHORIZE: "AUTHORIZE",
    CAPTURE: "CAPTURE",
    REFUND: "REFUND",
    VOID: "VOID"
} as const;
export type PaymentTransactionType = (typeof PaymentTransactionType)[keyof typeof PaymentTransactionType];
export const PaymentTransactionStatus = {
    PENDING: "PENDING",
    SUCCEEDED: "SUCCEEDED",
    FAILED: "FAILED"
} as const;
export type PaymentTransactionStatus = (typeof PaymentTransactionStatus)[keyof typeof PaymentTransactionStatus];
export const PaymentWebhookEventStatus = {
    RECEIVED: "RECEIVED",
    PROCESSED: "PROCESSED",
    FAILED: "FAILED"
} as const;
export type PaymentWebhookEventStatus = (typeof PaymentWebhookEventStatus)[keyof typeof PaymentWebhookEventStatus];
