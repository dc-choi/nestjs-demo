import type { ColumnType } from "kysely";
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

import type { ProductSnapshotStatus, ItemSaleStatus, ProductStatus, ProductMediaRole, FulfillmentStatus, InventoryReservationStatus, InventoryMovementType, MemberRole, OrderStatus, OrderAddressType, OrderActorType, PaymentAttemptStatus, PaymentTransactionType, PaymentTransactionStatus, PaymentWebhookEventStatus } from "./enums";

export type Category = {
    id: Generated<number>;
    name: string;
    /**
     * 이름 변경과 무관하게 URL과 외부 참조에서 사용할 전역 식별자다.
     */
    slug: string;
    sequence: Generated<number>;
    isActive: Generated<number>;
    createdAt: Generated<Timestamp>;
    updatedAt: Generated<Timestamp>;
    deletedAt: Timestamp | null;
    parentId: number | null;
};
export type Fulfillment = {
    id: Generated<number>;
    status: Generated<FulfillmentStatus>;
    carrier: string | null;
    trackingNumber: string | null;
    packedAt: Timestamp | null;
    shippedAt: Timestamp | null;
    deliveredAt: Timestamp | null;
    cancelledAt: Timestamp | null;
    createdAt: Generated<Timestamp>;
    updatedAt: Generated<Timestamp>;
    orderId: number;
};
export type FulfillmentItem = {
    id: Generated<number>;
    quantity: number;
    fulfillmentId: number;
    orderItemId: number;
};
export type InventoryMovement = {
    id: Generated<number>;
    type: InventoryMovementType;
    /**
     * 양수는 입고, 음수는 차감을 뜻하며 0인 변경은 기록하지 않는다.
     */
    quantityDelta: number;
    /**
     * 같은 트랜잭션에서 변경을 반영한 뒤의 Item.stock과 일치해야 한다.
     */
    stockAfter: number;
    /**
     * 원장 생성 시 Item.sku를 복사하며 이후 원장에서는 변경하지 않는다.
     */
    itemSku: string;
    idempotencyKey: string;
    /**
     * 외부 업무 객체를 느슨하게 참조한다. 두 값의 동시 유무와 유효성은 애플리케이션이 보장한다.
     */
    referenceType: string | null;
    referenceId: string | null;
    reason: string | null;
    createdAt: Generated<Timestamp>;
    itemId: number;
};
export type InventoryReservation = {
    id: Generated<number>;
    quantity: number;
    status: Generated<InventoryReservationStatus>;
    expiresAt: Timestamp;
    consumedAt: Timestamp | null;
    releasedAt: Timestamp | null;
    createdAt: Generated<Timestamp>;
    updatedAt: Generated<Timestamp>;
    orderItemId: number;
};
export type Item = {
    id: Generated<number>;
    /**
     * UUID v7 기본값과 DB unique 제약을 함께 사용해 외부 SKU 식별자의 중복을 차단한다.
     * snapshot과 주문이 복사한 SKU의 원본 식별자가 바뀌지 않도록 생성 후에는 변경하지 않는다.
     */
    sku: string;
    /**
     * 주문 가능한 현재 잔액이다. 재고 원장과 같은 주 DB 트랜잭션에서만 변경한다.
     */
    stock: Generated<number>;
    createdAt: Generated<Timestamp>;
    updatedAt: Generated<Timestamp>;
    deletedAt: Timestamp | null;
    productId: number;
};
export type MediaAsset = {
    id: Generated<number>;
    /**
     * 실제 파일을 가리키는 영속 키이며 동일 객체의 중복 등록을 막는다.
     */
    storageKey: string;
    originalName: string | null;
    mimeType: string;
    byteSize: number;
    /**
     * 업로드 무결성 확인과 동일 파일 탐색에 사용하는 SHA-256 값이다.
     */
    checksum: string;
    width: number | null;
    height: number | null;
    createdAt: Generated<Timestamp>;
};
export type Member = {
    id: Generated<number>;
    name: string;
    /**
     * 로그인 식별자는 탈퇴 이력을 포함해 전역에서 하나의 계정만 가리킨다.
     */
    email: string;
    hashedPassword: string | null;
    phone: string;
    role: Generated<MemberRole>;
    lastLoginAt: Timestamp | null;
    membershipAt: Timestamp | null;
    createdAt: Generated<Timestamp>;
    updatedAt: Generated<Timestamp>;
    deletedAt: Timestamp | null;
};
export type Order = {
    id: Generated<number>;
    orderNumber: string;
    idempotencyKey: string | null;
    requestFingerprint: string | null;
    status: Generated<OrderStatus>;
    currencyCode: Generated<string>;
    totalPrice: string;
    placedAt: Timestamp | null;
    cancelledAt: Timestamp | null;
    completedAt: Timestamp | null;
    createdAt: Generated<Timestamp>;
    updatedAt: Generated<Timestamp>;
    deletedAt: Timestamp | null;
    memberId: number;
};
export type OrderAddress = {
    id: Generated<number>;
    type: OrderAddressType;
    recipientName: string;
    phone: string;
    postalCode: string;
    countryCode: string;
    province: string | null;
    city: string;
    line1: string;
    line2: string | null;
    createdAt: Generated<Timestamp>;
    orderId: number;
};
export type OrderItem = {
    id: Generated<number>;
    /**
     * 주문 당시 unitTotalPrice와 quantity를 곱한 품목 합계이며 Order.totalPrice 계산의 근거다.
     */
    price: string;
    quantity: number;
    createdAt: Generated<Timestamp>;
    itemId: number;
    orderId: number;
};
export type OrderItemSnapshot = {
    orderItemId: number;
    sourceProductSnapshotId: number;
    sourceItemId: number;
    productName: string;
    itemName: string;
    itemSku: string;
    productDescription: string | null;
    productReturnPolicy: string | null;
    unitSupplyPrice: string;
    unitVat: string;
    unitTotalPrice: string;
    isTaxFree: Generated<number>;
    /**
     * 선택한 옵션의 optionCode, optionName, valueCode, valueName을 배열로 보존한다.
     * 주문 시점 순서를 유지해 이후 옵션 편집과 무관하게 영수증을 재현한다.
     */
    selectedOptions: unknown;
    createdAt: Generated<Timestamp>;
};
export type OrderStatusHistory = {
    id: Generated<number>;
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    reason: string | null;
    actorType: Generated<OrderActorType>;
    actorId: string | null;
    requestId: string | null;
    metadata: unknown | null;
    createdAt: Generated<Timestamp>;
    orderId: number;
};
export type PaymentAttempt = {
    id: Generated<number>;
    provider: string;
    method: string | null;
    status: Generated<PaymentAttemptStatus>;
    requestedAmount: string;
    currencyCode: string;
    idempotencyKey: string;
    providerPaymentId: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    authorizedAt: Timestamp | null;
    capturedAt: Timestamp | null;
    cancelledAt: Timestamp | null;
    createdAt: Generated<Timestamp>;
    updatedAt: Generated<Timestamp>;
    orderId: number;
};
export type PaymentTransaction = {
    id: Generated<number>;
    type: PaymentTransactionType;
    status: Generated<PaymentTransactionStatus>;
    amount: string;
    idempotencyKey: string;
    providerTransactionId: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    processedAt: Timestamp | null;
    createdAt: Generated<Timestamp>;
    paymentAttemptId: number;
};
export type PaymentWebhookEvent = {
    id: Generated<number>;
    provider: string;
    providerEventId: string;
    payloadHash: string;
    status: Generated<PaymentWebhookEventStatus>;
    receivedAt: Generated<Timestamp>;
    processedAt: Timestamp | null;
    errorMessage: string | null;
    paymentAttemptId: number | null;
};
export type Product = {
    id: Generated<number>;
    /**
     * 상품명이 바뀌어도 URL과 외부 참조가 유지되도록 별도 고유 식별자를 사용한다.
     * snapshot과 주문이 같은 상품을 계속 추적할 수 있도록 생성 후에는 변경하지 않는다.
     */
    slug: string;
    status: Generated<ProductStatus>;
    createdAt: Generated<Timestamp>;
    updatedAt: Generated<Timestamp>;
    deletedAt: Timestamp | null;
    /**
     * 소유권 이전은 별도 이력 모델 없이 과거 책임 주체를 바꾸므로 생성 후에는 변경하지 않는다.
     */
    sellerId: number;
};
export type ProductPublication = {
    productId: number;
    productSnapshotId: number;
    publishedAt: Generated<Timestamp>;
};
export type ProductSnapshot = {
    id: Generated<number>;
    version: number;
    name: string;
    description: string | null;
    returnPolicy: string | null;
    status: Generated<ProductSnapshotStatus>;
    createdAt: Generated<Timestamp>;
    firstPublishedAt: Timestamp | null;
    productId: number;
};
export type ProductSnapshotCategory = {
    productSnapshotId: number;
    /**
     * 원본 분류의 추적과 운영상 영향 범위 조회에만 사용한다. 과거 화면은 아래 복사본 필드를 사용한다.
     */
    categoryId: number;
    /**
     * Category가 나중에 변경되어도 발행 당시의 이름과 URL 식별자를 재현하도록 복사한다.
     */
    categoryName: string;
    categorySlug: string;
    /**
     * 발행 당시 루트부터 현재 분류까지의 계층 정보를 복사한다. 각 원소는 id, name, slug를 가진다.
     * 조회 시 mutable Category 트리를 다시 조합하지 않는다.
     */
    categoryPath: unknown;
    sequence: number;
};
export type ProductSnapshotItem = {
    productSnapshotId: number;
    itemId: number;
    productId: number;
    name: string;
    /**
     * snapshot을 조회할 때 현재 Item 행에 의존하지 않도록 발행 시점의 불변 SKU를 복사한다.
     */
    itemSku: string;
    /**
     * 세 값은 모두 한 개 기준이며 발행 전에 totalPrice가 supplyPrice와 vat의 합인지 검증한다.
     * isTaxFree가 true이면 vat가 0인지도 같은 발행 검증에서 확인한다.
     */
    supplyPrice: string;
    vat: string;
    totalPrice: string;
    isTaxFree: Generated<number>;
    itemSaleStatus: Generated<ItemSaleStatus>;
    sequence: number;
    /**
     * option code 순으로 정렬한 option-code/value-code 쌍의 SHA-256 값이다.
     */
    optionSignature: string;
};
export type ProductSnapshotItemOptionValue = {
    productSnapshotId: number;
    itemId: number;
    productSnapshotOptionId: number;
    productSnapshotOptionValueId: number;
};
export type ProductSnapshotMedia = {
    id: Generated<number>;
    role: Generated<ProductMediaRole>;
    altText: string | null;
    sequence: number;
    productSnapshotId: number;
    mediaAssetId: number;
};
export type ProductSnapshotOption = {
    id: Generated<number>;
    /**
     * 표시명이 바뀌어도 optionSignature 계산에 사용할 snapshot 내부의 안정적인 코드다.
     */
    code: string;
    name: string;
    isRequired: Generated<number>;
    sequence: number;
    productSnapshotId: number;
};
export type ProductSnapshotOptionValue = {
    id: Generated<number>;
    code: string;
    name: string;
    sequence: number;
    productSnapshotOptionId: number;
};
export type ProductSnapshotTag = {
    productSnapshotId: number;
    value: string;
    sequence: number;
};
export type DB = {
    categories: Category;
    fulfillmentItems: FulfillmentItem;
    fulfillments: Fulfillment;
    inventoryMovements: InventoryMovement;
    inventoryReservations: InventoryReservation;
    items: Item;
    mediaAssets: MediaAsset;
    members: Member;
    orderAddresses: OrderAddress;
    orderItemSnapshots: OrderItemSnapshot;
    orderItems: OrderItem;
    orderStatusHistories: OrderStatusHistory;
    orders: Order;
    paymentAttempts: PaymentAttempt;
    paymentTransactions: PaymentTransaction;
    paymentWebhookEvents: PaymentWebhookEvent;
    productPublications: ProductPublication;
    productSnapshotCategories: ProductSnapshotCategory;
    productSnapshotItemOptionValues: ProductSnapshotItemOptionValue;
    productSnapshotItems: ProductSnapshotItem;
    productSnapshotMedia: ProductSnapshotMedia;
    productSnapshotOptionValues: ProductSnapshotOptionValue;
    productSnapshotOptions: ProductSnapshotOption;
    productSnapshotTags: ProductSnapshotTag;
    productSnapshots: ProductSnapshot;
    products: Product;
};
