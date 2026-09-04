# GraphQL API 전환 설계

상태: 도메인 GraphQL command/query, Commerce lifecycle과 OpenSearch 상품 검색 구현

이 문서는 이 프로젝트의 사용자/관리 API를 GraphQL로 구성한 구조를 설명합니다. 일반 외부 진입점은
`/graphql`이고, raw body 서명이 필요한 결제 provider 수신만
`POST /webhooks/payments/:provider` HTTP Controller로 분리합니다. `src/api` 아래는 API 버전이 아니라
도메인으로 나눕니다.

## 한눈에 보는 구조

```text
클라이언트
  |
  | POST /graphql
  v
GraphQL Resolver
  |
  | Input/ID를 Command 또는 Service 인자로 변환
  v
Application Service
  |
  +-- Mutation -> EntityManager/EntityRepository -> rich domain/MikroORM transaction
  |
  +-- Query -> EntityRepository 또는 OpenSearch client -> read result

ProductSearchResolver -> ProductSearchService -> OpenSearch
```

- GraphQL은 클라이언트가 호출하는 API 계약입니다.
- Resolver는 요청을 해석하고 결과를 GraphQL type으로 바꾸는 얇은 presentation 계층입니다.
- Mutation의 application service는 로그인, 회원가입, Catalog, 주문/재고/결제/배송 흐름을 조율합니다.
- `OrderEntity`/`OrderItemEntity`가 주문 생성, 품목 금액과 합계를 검증합니다.
- `OrderItemSnapshotEntity`가 live Product/Item의 주문 시점 정보를 복사합니다.
- 단순 조회는 domain aggregate를 복원하지 않고 application read result로 바로 반환합니다.
- GraphQL ID는 presentation mapper에서 검증한 뒤 application 경계에서 `bigint`로 사용합니다.
- 공개 `OrderService`는 회원/멱등성 키와 Item별 분산 락으로 경합을 줄입니다. Primary transaction에서는
  Product와 Item을 ID 순서로 잠근 뒤 Item별 요청 수량을 합산 검사하고 재고를 차감합니다.
- MySQL은 상품, 가격, 재고와 주문의 source of truth이며 MikroORM이 현재 영속성 경계를 담당합니다.
- OpenSearch는 MySQL에서 재생성하는 상품 검색 전용 read model이며 주문의 최종 판정에 사용하지 않습니다.

## GraphQL 용어

| 용어        | 이 프로젝트에서의 의미                                                                       |
| ----------- | -------------------------------------------------------------------------------------------- |
| Schema      | 클라이언트가 호출할 수 있는 field와 입출력 타입의 전체 계약                                  |
| Query       | 데이터를 바꾸지 않는 조회, `members`, `product`, `productSnapshots`, `searchProducts`가 해당 |
| Mutation    | 상태를 바꾸는 로그인/회원/Catalog/주문/재고/결제/배송 명령                                   |
| Resolver    | GraphQL field를 application service 호출로 연결하는 adapter                                  |
| Input type  | Mutation 또는 Query가 받는 구조화된 입력                                                     |
| Object type | 클라이언트가 selection set으로 필요한 field를 선택하는 결과 타입                             |
| Context     | 같은 HTTP 요청의 Express request/response, 인증 사용자와 request ID                          |
| Scalar      | `String`, `Int`, `ID`, `DateTime`처럼 더 쪼개지지 않는 값                                    |

GraphQL endpoint는 하나지만 operation과 field 이름이 동작을 구분합니다. REST의 URL 버전인 `v1`, `v2`,
`v3`를 GraphQL field 이름에 넣지 않습니다. 호환되지 않는 변경은 새 field를 추가하고 기존 field를
deprecate한 뒤 제거합니다.

## 현재 공개 Schema

아래 SDL은 이해를 위한 축약본입니다. 실제 schema는 Nest code-first decorator에서 만들어집니다.

```graphql
type Query {
    members: [Member!]!
    product(id: ID!): Product
    productSnapshots(productId: ID!, limit: Int = 20): [ProductSnapshot!]!
    searchProducts(input: ProductSearchInput!): ProductSearchConnection
}

type Mutation {
    login(input: LoginInput!): LoginPayload!
    refreshToken(input: RefreshTokenInput!): RefreshTokenPayload!
    signup(input: SignupInput!): SignupPayload!
    placeOrder(input: PlaceOrderInput!): PlaceOrderPayload!
    cancelOrder(input: CancelOrderInput!): PlaceOrderPayload!
    createProduct(input: CreateProductInput!): ProductMutationPayload!
    replaceProductCatalog(input: ReplaceProductCatalogInput!): ProductMutationPayload!
    createProductItem(input: WriteProductItemInput!): ProductMutationPayload!
    updateProductItem(input: WriteProductItemInput!): ProductMutationPayload!
    deleteProductItem(input: DeleteProductItemInput!): ProductMutationPayload!
    updateProduct(input: UpdateProductInput!): ProductMutationPayload!
    deleteProduct(input: DeleteProductInput!): ProductMutationPayload!
    restoreProduct(input: RestoreProductInput!): ProductMutationPayload!
    adjustInventory(input: AdjustInventoryInput!): InventoryAdjustmentPayload!
    consumeInventoryReservation(input: InventoryReservationInput!): InventoryTransitionPayload!
    releaseInventoryReservation(input: RestoreInventoryReservationInput!): InventoryTransitionPayload!
    expireInventoryReservation(input: RestoreInventoryReservationInput!): InventoryTransitionPayload!
    createPaymentAttempt(input: CreatePaymentAttemptInput!): PaymentPayload!
    capturePayment(input: CapturePaymentInput!): PaymentPayload!
    failPayment(input: FailPaymentInput!): PaymentPayload!
    refundPayment(input: RefundPaymentInput!): PaymentPayload!
    receivePaymentWebhook(input: ReceivePaymentWebhookInput!): PaymentWebhookPayload!
    processPaymentWebhook(input: ProcessPaymentWebhookInput!): PaymentWebhookPayload!
    failPaymentWebhook(input: FailPaymentWebhookInput!): PaymentWebhookPayload!
    createFulfillment(input: CreateFulfillmentInput!): FulfillmentPayload!
    packFulfillment(input: FulfillmentIdInput!): FulfillmentPayload!
    shipFulfillment(input: ShipFulfillmentInput!): FulfillmentPayload!
    deliverFulfillment(input: FulfillmentIdInput!): FulfillmentPayload!
    cancelFulfillment(input: FulfillmentIdInput!): FulfillmentPayload!
}
```

| Field                              | 인증                    | 연결되는 기존 로직                                           |
| ---------------------------------- | ----------------------- | ------------------------------------------------------------ |
| `login`                            | 불필요                  | `AuthService.login`                                          |
| `refreshToken`                     | 불필요                  | `AuthService.token`                                          |
| `signup`                           | 불필요                  | `MemberService.signup`, 공개 가입은 `CUSTOMER` 고정          |
| `members`                          | Admin JWT               | `MemberService.findAll`                                      |
| `product`                          | 불필요                  | live `Product`/`Item` graph을 읽는 canonical MySQL 조회      |
| `placeOrder`                       | Bearer JWT              | `OrderService.order`, Redlock, Product/Item lock과 재고 예약 |
| `cancelOrder`                      | 소유자/Admin JWT        | 예약 해제, 결제/배송 상태 검사와 주문 이력                   |
| Catalog command/`productSnapshots` | Seller/Admin JWT        | 소유권, revision, Snapshot과 Outbox                          |
| `adjustInventory`                  | Seller/Admin JWT        | 판매자 소유권을 검사하는 재고 조정과 원장                    |
| Inventory reservation command      | Admin JWT               | 예약 소비/해제/주문 단위 만료와 복구 원장                    |
| Payment command                    | 동작별 소유자/Admin JWT | 시도, 매입, 실패, 환불, 관리용 Webhook 재처리와 거래 원장    |
| Fulfillment command                | Admin JWT               | 멱등 생성, 분할 수량과 포장/발송/배송완료/취소 전이          |
| `searchProducts`                   | 불필요                  | OpenSearch read Alias의 검색 문서 조회                       |

주문 공개 계약은 멱등 `placeOrder`와 멱등 `cancelOrder`입니다. 결제/재고/배송은 별도 Resolver가 주문
aggregate와 협력합니다.

`createFulfillment`의 `CreateFulfillmentInput`에는 `orderId`, 필수 `idempotencyKey`, 하나 이상의
`items`가 필요합니다. 멱등성 범위는 주문이며 같은 키와 같은 품목/수량 배정은 기존 배송을 반환하고,
같은 키의 다른 배정은 충돌로 거절합니다. 배송 생성과 포장/발송/배송 완료는 주문 행을 먼저 잠그고
매입 금액이 남아 있는지 확인하므로 전액 환불 뒤에는 진행할 수 없습니다.

`expireInventoryReservation`은 전달한 예약만 고립해서 끝내지 않습니다. 해당 예약의 주문 행을 먼저
잠그고 주문의 모든 `RESERVED` 예약이 만료됐는지 확인합니다. 아직 유효한 예약이나 `CONSUMED` 또는
`RELEASED` 예약이 있으면 거절합니다. 검사를 통과하면 남은 `RESERVED` 예약을 함께 `EXPIRED`로 바꾸고
재고와 `RELEASE` 원장을 복구하며, 취소 가능한 결제 시도와 주문을 같은 transaction에서 `CANCELLED`로
전이합니다.

### 공개 주문의 동시성 경계

`placeOrder`는 BullMQ 같은 비동기 queue를 거치지 않습니다. Mutation은 주문 transaction이 끝날 때까지
기다리고 그 결과를 바로 반환합니다.

1. 필수 `idempotencyKey`를 검증하고, Item ID/수량 쌍을 정렬한 요청 fingerprint를 계산합니다. 입력 배열
   순서는 무시하지만 중복 행을 합치지는 않습니다.
2. 같은 회원과 멱등성 키의 주문이 있으면 fingerprint가 같은 요청만 기존 주문으로 replay하고, 다른
   요청이면 충돌로 거절합니다.
3. 회원/멱등성 키 digest와 요청된 Item ID를 Redis lock key로 만들고 Redlock을 획득합니다. 현재 주문
   설정은 TTL 30초, 최초 시도 이후 최대 3회 재시도, 시도 사이 100ms 대기입니다.
4. lock callback 안의 `@Transactional()`이 RequestContext의 primary transaction을 시작합니다. 현재 MySQL
   기본 격리 수준은 `REPEATABLE READ`입니다.
5. transaction에서 멱등 주문을 다시 확인한 뒤 Product ID, Item ID 순서로 각각
   `PESSIMISTIC_WRITE` lock을 획득합니다. 잠근 live Product/Item의 상태와 가격을 검증하고, 중복 Item
   line을 포함한 Item별 요청 수량을 합산해 현재 재고와 비교합니다.
6. 검사를 통과한 managed Item의 재고를 차감하고 15분 재고 예약/원장과 주문 Snapshot을 저장합니다.
7. 새 `OrderEntity` aggregate를 주입된 `EntityManager`에 `persist()`합니다. `@Transactional()`이 commit
   전에 자동 flush한 뒤 lock을 해제합니다. DB unique race가 발생하면 기존 주문을 다시 읽어 같은
   fingerprint에만 수렴합니다.

분산 락은 경합을 줄이는 장치이지 데이터 무결성의 유일한 근거가 아닙니다. TTL 만료나 Redis 장애가 있어도
같은 Product와 Item 쓰기는 MySQL의 row lock으로 직렬화됩니다. 잠금 뒤 Item별 합산 수량과 현재 재고를
비교하고 같은 transaction에서 차감과 원장을 commit하는 경계가 재고 음수를 막습니다. 현재 Redlock은
Redis client 한 개를 사용하므로 여러 독립 Redis 노드의 quorum 장애 내성을 제공하지 않습니다. 이 제한은
로컬 실습 범위에서 의도적으로 받아들입니다.

재시도는 lock 획득 단계에만 적용합니다. 획득에 성공한 뒤 application callback이 실패해도 주문 로직을
자동으로 다시 실행하지 않습니다. 따라서 한 요청에서 business callback은 최대 한 번만 실행됩니다.

멱등 범위는 회원별 `idempotencyKey`입니다. 같은 키와 같은 정규화 품목 요청은 기존 주문을 반환하며,
같은 키를 다른 품목/수량 요청에 재사용하면 충돌로 거절합니다. fingerprint 정렬은 입력 배열 순서만
무시하고 각 Item ID/수량 행의 구성을 그대로 보존합니다.

## 호출 예시

### 로그인

```graphql
mutation Login($input: LoginInput!) {
    login(input: $input) {
        accessToken
        refreshToken
        role
        isFirstLogin
    }
}
```

```json
{
    "input": {
        "email": "user@example.com",
        "password": "helloWorld"
    }
}
```

### 주문 접수

Authorization header에 `Bearer <accessToken>`을 전달합니다.

```graphql
mutation PlaceOrder($input: PlaceOrderInput!) {
    placeOrder(input: $input) {
        order {
            id
            orderNumber
            status
            totalPrice {
                amount
                currencyCode
            }
            items {
                id
                quantity
                lineTotalPrice {
                    amount
                    currencyCode
                }
                snapshot {
                    productId
                    productRevision
                    productName
                    itemName
                    selectedOptions {
                        optionName
                        valueName
                    }
                }
            }
        }
    }
}
```

```json
{
    "input": {
        "idempotencyKey": "order-create-local-001",
        "items": [
            {
                "itemId": "56",
                "quantity": 1
            }
        ]
    }
}
```

### 현재 공개 상품

`Product`와 하위 `Item`, 옵션, 카테고리, 태그 Entity가 MySQL의 현재 상태입니다.
GraphQL의 `revision`은 live `Product.revision`을 노출합니다. 감사용 `ProductSnapshot`은 조회 graph에
참여하지 않으며, MikroORM Entity의 관계와 상태 필드도 그대로 공개하지 않습니다.

```graphql
query Product($id: ID!) {
    product(id: $id) {
        id
        slug
        revision
        name
        description
        returnPolicy
        updatedAt
        items {
            id
            name
            sku
            price {
                amount
                currencyCode
            }
            selectedOptions {
                optionName
                valueName
            }
        }
        options {
            id
            name
            values {
                id
                name
            }
        }
        categories {
            id
            name
            slug
        }
        tags
    }
}
```

`product`는 `ACTIVE`, 미삭제 Product와 판매 허용, 미삭제 Item이 있을 때만
값을 반환합니다. OpenSearch 검색 결과가 아니라 MySQL의 canonical 현재 상태입니다.

`ProductSnapshot`은 Product revision별 append-only JSON 변경 이력입니다. `Query.product`와
`Mutation.placeOrder`는 이 테이블을 조회하거나 FK로 참조하지 않습니다. 변경 command에서 live
graph, `Product.revision`, 같은 revision의 Snapshot과 검색 Outbox는 Catalog command의 한 writer
transaction에서 원자적으로 저장됩니다. `productSnapshots`는 Seller 소유권 또는 Admin 권한을 확인하고
ID/revision/schema version/변경 metadata를 최신순 최대 100건 반환합니다. 내부 payload는 GraphQL에
노출하지 않습니다. 복원은 서버에서 선택한 revision의 payload를 읽고 과거 행을 바꾸지 않은 채 새
revision을 추가합니다.

현재 복원 범위는 Product slug/이름/설명/반품 정책/상태, Item, 옵션, 카테고리와 태그입니다. Snapshot에
남은 과거 media metadata는 감사용이며 복원 시 현재 live media 연결을 그대로 보존합니다. 과거 카테고리
ID 연결은 다시 적용하지만 공유 Category의 이름, slug와 경로는 현재 값을 유지합니다.

미디어 관계와 감사 payload의 내부 `storageKey`는 DB에 보존하지만 현재는 전달 URL 생성기가
없습니다. URL 없이 메타데이터만
공개하면 클라이언트가 사용할 수 없는 계약이 되므로 `ProductMedia`는 공개 GraphQL schema에서 제외합니다.
향후 미디어 전달 포트와 object storage signer 또는 CDN adapter를 구현할 때, 내부 식별자는 숨기고 만료 시간이
짧은 `url`을 포함한 공개 타입을 추가합니다.

## 레이어와 타입 경계

GraphQL 타입을 rich domain 객체로 사용하지 않습니다. GraphQL 타입은 클라이언트가 탐색하는 외부
그래프이고, MikroORM Entity는 필요한 aggregate에서 계산과 상태 전이를 보호하는 rich domain model이
될 수 있습니다.

| 계층           | 이 프로젝트의 타입                           | 책임                               |
| -------------- | -------------------------------------------- | ---------------------------------- |
| presentation   | GraphQL Input/ObjectType/Payload, ID mapper  | 공개 GraphQL 계약과 문자열 ID 변환 |
| application    | Service, Command/Result                      | 유스케이스와 transaction 조율      |
| domain         | 필요한 행동을 가진 MikroORM Entity           | 상태와 계산 불변식                 |
| infrastructure | MikroORM DB, OpenSearch document/DSL과 relay | 외부 기술 설정과 공통 연결 정책    |

GraphQL 타입과 영속성 타입은 계속 분리하지만, Service는 MikroORM이 제공하는 `EntityRepository<Entity>`와
필요한 경우 `EntityManager`를 직접 주입받습니다. 같은 역할의 repository/reader interface, DI Symbol,
전달용 wrapper를 다시 만들지 않습니다.
MikroORM의 `Reference`/`Collection`과 OpenSearch document는 GraphQL 응답으로 직접 전달하지 않습니다.

Mutation과 Query는 같은 경로를 억지로 공유하지 않습니다.

```text
Mutation: GraphQL Input -> Resolver -> Service -> EntityManager/EntityRepository/domain -> Result -> GraphQL Object
Query:    GraphQL Args  -> Resolver -> Service -> EntityRepository 또는 OpenSearch client -> read result -> GraphQL Object
```

이 방식은 계층마다 의미가 다른 타입은 허용하지만, 모든 MikroORM Entity에 custom repository/DTO를
기계적으로 만들지는 않습니다. 단순 조회는 rich domain을 거치지 않고, 실제 N+1이 확인되기 전에는 field
resolver와 DataLoader도 추가하지 않습니다. 의존 방향은 [애플리케이션 레이어 원칙](architecture/layering.md),
타입과 rich Entity 판단은 [GraphQL, Entity와 도메인 모델 경계](architecture/model-boundaries.md)를
기준으로 합니다.

## Code-first 선택

현재 코드는 TypeScript class, decorator와 `class-validator`를 사용하므로 Nest code-first 방식을
사용합니다.

- `autoSchemaFile: true`로 runtime schema를 메모리에서 만듭니다.
- `sortSchema: true`로 schema 순서를 결정적으로 유지합니다.
- TypeScript input/object type이 구현의 기준입니다.
- MikroORM Entity를 GraphQL 결과로 직접 노출하지 않습니다.
- Resolver는 MikroORM/OpenSearch 타입 대신 application service의 명시적 입력과 결과를 사용합니다.

Schema-first는 SDL과 생성 TypeScript 정의를 함께 관리해야 하므로 이번 프로젝트에는 사용하지 않습니다.

## Runtime 버전

2026-08-12 현재 다음 호환 조합을 고정합니다.

| Package                     | Version   | 역할                                                         |
| --------------------------- | --------- | ------------------------------------------------------------ |
| `@nestjs/graphql`           | `13.4.4`  | Nest 11 code-first GraphQL                                   |
| `@nestjs/apollo`            | `13.4.4`  | Nest와 Apollo Server 5 연결                                  |
| `@apollo/server`            | `5.5.1`   | GraphQL HTTP runtime                                         |
| `@as-integrations/express5` | `1.1.2`   | Apollo Server와 현재 Express 5 adapter 연결                  |
| `graphql`                   | `16.14.2` | 위 package들의 peer 범위 `^16.11.0`을 만족하는 GraphQL.js 16 |

전역 최신 `graphql@17`은 현재 Nest/Apollo peer 범위 밖이므로 사용하지 않습니다. Subscription 요구가
없으므로 `graphql-ws`와 `graphql-subscriptions`도 설치하지 않습니다.

## Endpoint와 개발 도구

GraphQL module이 `path: '/graphql'`을 직접 소유합니다. `main.ts`에는 전역 prefix를 두지 않습니다. 실제
endpoint는 다음과 같습니다.

```text
http://localhost:3000/graphql
http://localhost:3000/webhooks/payments/:provider
```

`.env`의 `ENV=dev`에서만 GraphiQL과 introspection을 활성화합니다. 그 외 환경에서는 둘 다
비활성화합니다. 제거된 Swagger UI는 더 이상 제공하지 않습니다.

Subscription/WebSocket, Federation, 파일 업로드와 GraphQL 검색 관리 명령은 현재 범위가 아닙니다.
OpenSearch rebuild/relay/reconciliation/evaluation은 GraphQL Mutation으로 노출하지 않고 CLI로 실행합니다.

## ID, 수량과 가격

GraphQL `Int`는 signed 32-bit이므로 DB의 `BigInt` ID에 사용할 수 없습니다.

- Member/Product/Item/Order ID는 GraphQL `ID`의 10진 문자열로 전달합니다.
- Resolver는 `ID`를 검증한 뒤 JavaScript `bigint`로 변환합니다.
- JWT payload에도 member ID를 10진 문자열로 저장하고 인증 뒤 내부 `bigint`로 복원합니다.
- 수량은 GraphQL `Int`와 도메인 최소/최대 검증을 모두 통과해야 합니다.
- 금액은 `Money { amount, currencyCode }`로 노출하고 `amount`는 정밀도를 잃지 않는 decimal 문자열입니다.

예를 들어 `9223372036854775807`을 JavaScript `number`로 바꾸지 않으므로 정밀도를 잃지 않습니다.

이 보장은 GraphQL 입력, 기존 row 조회와 응답 직렬화 경계에 적용됩니다. MikroORM 7.1.11의 MySQL
auto-increment insert 결과는 내부 `Number` 변환 제약이 있으므로, 신규 AUTO_INCREMENT 값 자체가
`Number.MAX_SAFE_INTEGER`를 넘는 생성 시나리오는 현재 demo의 보장 범위에서 제외합니다.

## 인증과 요청 Context

GraphQL도 Express HTTP 요청 위에서 실행됩니다. Apollo context에 원본 `req`와 `res`를 전달하고 공통
helper가 GraphQL execution context에서 request를 꺼냅니다.

```text
Authorization header
  -> CommonGuard
  -> Passport JWT strategy
  -> JWT memberId 문자열 검증
  -> 내부 JwtPayload.memberId bigint
  -> @Jwt() Resolver parameter
```

GraphQL resolver의 실행 인수는 `root`, `args`, `context`, `info`입니다. 따라서 HTTP Controller처럼
`switchToHttp()`를 호출하면 실제 Express request를 얻지 못합니다. 이 프로젝트는 다음 하나의 경로로
request를 전달합니다.

```text
Apollo context({ req, res })
  -> GqlExecutionContext.getContext()
  -> JwtAuthGuard.getRequest()
  -> Passport가 req.user 설정
  -> @Jwt()가 같은 req.user 반환
```

`x-request-id`는 기존 CLS middleware를 그대로 사용합니다.

- 상위 서비스가 보낸 값을 유지하고, 없으면 UUID v7을 만듭니다.
- 응답 header에 같은 값을 반환합니다.
- CORS `exposedHeaders`에 `x-request-id`가 포함됩니다.
- GraphQL 오류의 `extensions.requestId`와 구조화 로그에도 연결합니다.

## GraphQL 요청과 응답 로깅

Apollo plugin이 operation을 해석하고 실제 Express response의 `finish` 시점에 완료 로그 한 건을 남깁니다.
요청 시작과 응답 완료를 별도 payload로 복제하지 않으므로 같은 요청의 상관관계와 최종 상태를 한 행에서
확인할 수 있습니다. 로그는 `logs_json/graphql`에 저장됩니다.

- 기록: request ID, HTTP method/path/status, operation type/name, 최상위 field, 처리 시간, 성공 여부, 오류 code
- 비기록: 원본 query, variables/argument, header/cookie/authorization, 인증 사용자, response data, 오류 메시지
- GraphQL 실행 오류는 HTTP 200일 수도 있으므로 오류 code가 하나라도 있으면 실패로 기록합니다.
- 클라이언트가 응답 완료 전에 연결을 끊으면 `aborted: true`로 기록합니다.

operation name과 request ID 길이, 최상위 field와 오류 code 개수에는 상한을 둬서 로그 고카디널리티와
단일 요청의 로그 증폭을 제한합니다. 내부 오류의 stack은 별도 error channel에서만 기록합니다.

## Validation

전역 `ValidationPipe`가 GraphQL input class의 `class-validator` decorator를 실행합니다. GraphQL 타입
coercion과 도메인 validation은 역할이 다릅니다.

- GraphQL은 문자열/정수/필수 field 같은 schema 타입을 먼저 검사합니다.
- `class-validator`는 이메일 형식, UUID v7, 수량 범위와 중첩 주문 item을 검사합니다.
- `placeOrder.items`는 비어 있을 수 없고 각 `itemId`는 양수 signed BIGINT 범위의 10진 문자열이어야 합니다.
- `placeOrder.idempotencyKey`는 공백이 아닌 1자 이상 128자 이하 문자열이어야 합니다.

## 오류 계약

Resolver 오류를 REST status body로 다시 포장하지 않습니다. GraphQL의 `errors`와 안정적인
`extensions.code`를 사용합니다.

```json
{
    "data": {
        "placeOrder": null
    },
    "errors": [
        {
            "message": "인증되지 않았습니다.",
            "path": ["placeOrder"],
            "extensions": {
                "code": "UNAUTHORIZED",
                "requestId": "019ff17e-31f2-7022-b5ea-bce5a339025c"
            }
        }
    ]
}
```

- 문법과 input coercion 실패는 GraphQL 표준 오류입니다.
- 기존 도메인 오류 객체의 `type`을 `extensions.code`로 노출합니다.
- 예상하지 못한 오류는 `INTERNAL_SERVER_ERROR`와 일반 메시지만 노출합니다.
- Stack, ORM 오류와 인프라 원문은 응답에 포함하지 않습니다.
- 비밀번호/token variable과 전체 응답을 request log에 기록하지 않습니다.

### HTTP exception filter를 제거한 이유

기존 filter는 `switchToHttp()`로 Express response를 얻고 `response.status().json()`을 직접 호출했습니다.
GraphQL에서 이 방식은 Apollo가 `data`, `errors`, `path`, `extensions`를 조합하기 전에 응답을 끝내므로
GraphQL 오류 계약과 충돌합니다. 또한 GraphQL context의 request가 아닌 resolver 인수를 HTTP 인수로
오인할 수 있습니다.

그래서 전역 `APP_FILTER`는 등록하지 않습니다. 예상 가능한 도메인 오류 변환은 `formatError`, 내부 stack
기록은 Apollo plugin이 담당합니다. 두 경계 모두 query variables와 token payload를 로그에 남기지 않습니다.

공개 `signup`에는 role 입력이 없습니다. 관리자와 판매자 권한 부여는 별도의 인증된 관리 기능이 생기기
전까지 GraphQL로 노출하지 않습니다. 이메일과 전화번호를 반환하는 `members`도 Admin JWT만 허용합니다.
이메일은 로그인 식별자이므로 DB unique 제약으로 동시 가입까지 차단하고, 충돌은 `EXISTING_MEMBER`로
변환합니다. 로그인은 `lastLoginAt IS NULL` 조건부 갱신에 성공한 한 요청에만 `isFirstLogin=true`를
반환하고, 이후 로그인도 마지막 로그인 시각은 계속 갱신합니다.

## 제거한 REST 경계와 API 버전 경계

- Auth/Member/Order v1/v2/v3 Controller
- Auth/Member/Order를 감싸던 최상위 API 버전 디렉터리
- 과거 주문 v1/v2 module과 비교 구현
- Swagger setup과 `/api/docs`
- `@nestjs/swagger`, `express-basic-auth`
- HTTP response를 직접 쓰던 전역 exception filter
- 사용되지 않던 REST pagination DTO

API 버전 경계를 없앤 것은 공개 주문 runtime 구현이 `OrderService` 하나이기 때문입니다.
버전 이름으로 전체 도메인을 세 번 나누지 않고 `src/api/order` 안에서 관련 코드를 함께 찾을 수 있게 합니다.

## 현재 파일 경계

```text
src/global/graphql/
  graphql.module.ts
  graphql-context.ts
  graphql-error.formatter.ts
  graphql-request-logging.plugin.ts
  money.type.ts

src/api/
  auth/
    application/auth.service.ts
    presentation/auth.resolver.ts
    auth.module.ts
  member/
    application/member.service.ts
    domain/member.entity.ts
    presentation/member.resolver.ts
    member.module.ts
  order/
    application/order.service.ts       # 접수/취소와 transaction 조율
    domain/entity/                     # 주문 aggregate와 상태 이력
    presentation/                      # placeOrder/cancelOrder 계약
  catalog/
    application/product-command.service.ts
    application/product-snapshot.service.ts
    application/product.service.ts
    domain/entity/                     # live graph와 감사 Snapshot
    presentation/                      # Catalog command/query 계약
    search/                            # 검색 document/query/presentation
  inventory/                           # 예약/원장 Service와 Resolver
  payment/                             # 결제 Service, Resolver와 HTTP Webhook
  fulfillment/                         # 배송 aggregate, Service와 Resolver

src/infra/
  database/
    database.module.ts
    mikro-orm.config.ts
    migrations/
    seeders/DatabaseSeeder.ts
    mikro-orm.logger.ts
    entities.ts
  search/
    opensearch.client.ts
    catalog-index.manager.ts
    catalog-rebuild.service.ts
    search-outbox.relay.ts
    search-reconciliation.service.ts
```

## 현재 검색 구현과 외부 연동 경계

canonical `Query.product`와 OpenSearch `Query.searchProducts`가 각각 독립된 read path로 구현됐습니다.
GraphQL input/connection, 서명 cursor, Mapping, rebuild, 관련도 평가와 Outbox 동기화 계약은
[OpenSearch GraphQL 상품 검색](search/opensearch-product-search.md)을 따릅니다.

검색은 OpenSearch 문서 한 건으로 결과를 완성하므로 DataLoader가 필요하지 않습니다. 이후
GraphQL field resolver가 MySQL relation을 개별 조회하게 될 때만 request-scoped DataLoader를 도입합니다.

Payment/Fulfillment API는 내부 상태 전이와 provider 중립 원장을 완성한 범위입니다. 실제 PG 승인 요청,
provider별 Webhook 형식, 택배사 송장 구매/추적 adapter는 연결하지 않습니다.

## 검증 기준

- TypeScript와 Nest build가 성공함
- 생성 schema에 REST 버전명이 없고 예상한 Query/Mutation만 존재함
- `members`와 `placeOrder`가 같은 Bearer JWT 인증을 사용함
- Member/Item ID가 문자열로 왕복하고 내부에서만 `bigint`가 됨
- 중첩 주문 input validation이 동작함
- `x-request-id`가 response header, error extension과 로그에 연결됨
- GraphiQL/introspection이 `ENV=dev`에서만 활성화됨
- legacy REST Controller/Swagger import와 이전 REST URL이 남지 않음
- HMAC Webhook Controller만 raw body를 사용하고 GraphQL context와 섞이지 않음
- application unit test, 검색 통합 test와 build가 통과함

## 공식 자료

- [NestJS GraphQL quick start](https://docs.nestjs.com/graphql/quick-start)
- [NestJS GraphQL resolver](https://docs.nestjs.com/graphql/resolvers)
- [NestJS GraphQL scalar](https://docs.nestjs.com/graphql/scalars)
- [NestJS Passport와 GraphQL](https://docs.nestjs.com/recipes/passport#graphql)
- [NestJS execution context](https://docs.nestjs.com/fundamentals/execution-context)
- [NestJS GraphQL 13.4.4 package](https://github.com/nestjs/graphql/blob/v13.4.4/packages/graphql/package.json)
- [NestJS Apollo 13.4.4 package](https://github.com/nestjs/graphql/blob/v13.4.4/packages/apollo/package.json)
- [Apollo Server 5 migration](https://www.apollographql.com/docs/apollo-server/migration)
- [GraphQL specification](https://spec.graphql.org/)
