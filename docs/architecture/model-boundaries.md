# GraphQL, Entity와 도메인 모델 경계

상태: 설계 원칙 확정, Catalog/Commerce/Search runtime 적용

이 문서는 GraphQL 타입, MikroORM Entity와 도메인 모델을 언제 합치고 언제 분리하는지 정합니다.
레이어 간 호출 관계와 repository 원칙은 [애플리케이션 레이어 원칙](layering.md)을 따릅니다.

## 결론

이 프로젝트의 기본값은 다음과 같습니다.

```text
GraphQL Type != MikroORM Entity
Domain Model == MikroORM Entity, aggregate로 모델링할 가치가 있을 때
```

- GraphQL Input/ObjectType은 외부 API 계약이므로 MikroORM Entity와 분리합니다.
- 상태와 불변식을 가진 aggregate는 별도 순수 domain class와 Entity를 이중으로 만들지 않고,
  MikroORM Entity가 도메인 행동을 갖게 합니다.
- 단순 이력, 연결 테이블과 조회 전용 데이터까지 억지로 rich model로 만들지 않습니다.
- 여러 Entity나 다른 데이터 원천을 조합한 Query는 명시적인 read result를 사용할 수 있습니다.

GraphQL decorator와 MikroORM decorator를 한 class에 함께 붙이는 것만으로는 rich domain model이 되지
않습니다. Rich model의 기준은 class가 자신의 생성 규칙, 상태 전이와 불변식을 보호하는지입니다.

## 모델 조합의 기본 결정

| 조합                                  | 기본 결정          | 판단 이유                                                           |
| ------------------------------------- | ------------------ | ------------------------------------------------------------------- |
| GraphQL ObjectType / MikroORM Entity  | 분리               | 공개 필드, scalar, relation과 변경 주기가 다릅니다.                 |
| GraphQL Input / MikroORM Entity       | 분리               | 외부 입력을 persistence shape로 직접 사용하지 않습니다.             |
| GraphQL Input / Command               | 조건부             | ID 변환, 정규화나 재사용이 없으면 1대1 Command를 강제하지 않습니다. |
| 순수 domain class / MikroORM Entity   | 조건부 통합        | 같은 aggregate와 생명주기를 중복 표현하면 rich Entity로 합칩니다.   |
| Read result / GraphQL ObjectType      | 조건부 분리        | 조합 조회, 보안 또는 표현 변환이 있을 때만 둡니다.                  |
| OpenSearch document / MikroORM Entity | 분리               | 검색 문서는 MySQL에서 다시 만들 수 있는 read model입니다.           |
| Domain enum / GraphQL enum            | 의미가 같으면 공유 | enum 정의는 domain에 두고 GraphQL 등록은 presentation에서 합니다.   |

## 기본 흐름

Mutation은 상태 변경과 불변식을 중심으로 구성합니다.

```text
GraphQL Input
  -> Resolver
  -> Service
  -> EntityRepository<Rich Entity>
  -> Entity factory/state transition
  -> MySQL

Rich Entity
  -> presentation mapper
  -> GraphQL ObjectType
```

Query는 aggregate를 항상 복원하지 않습니다.

```text
GraphQL Args
  -> Resolver
  -> Service
  -> EntityRepository 또는 OpenSearch client
  -> Entity graph 또는 read result
  -> presentation mapper
  -> GraphQL ObjectType
```

## 책임 구분

| 위치                     | 담당하는 것                                                           | 담당하지 않는 것                                       |
| ------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------ |
| GraphQL Input/ObjectType | 공개 field, nullability, 문자열 ID, Money 구조, validation decorator  | DB column, ORM relation, 상태 전이                     |
| Resolver                 | 입력 변환, Service 호출, 응답 변환                                    | repository 조회, transaction, 도메인 규칙              |
| Service                  | 유스케이스 조율, repository, transaction, 분산락, 여러 aggregate 연결 | aggregate 내부 계산을 대신하는 setter 모음             |
| MikroORM rich Entity     | factory, 자기 상태의 검증과 전이, 금액 계산, aggregate 내부 불변식    | Redis, token, ConfigService, repository, 외부 API 호출 |
| persistence-only Entity  | 이력, 연결, 외래 키와 DB metadata                                     | 필요하지 않은 행위와 추상화                            |
| Read result              | 여러 Entity 또는 데이터 원천을 공개 Query 형태로 조합                 | 상태 변경과 도메인 불변식                              |
| Presentation mapper      | `bigint`을 ID 문자열로 변환, Money 조합, 비공개 필드 제거             | 재고 판정, 상태 전이, DB 조회                          |

## Entity에 행동을 둘 기준

다음을 모두 만족하면 Entity 메서드로 둡니다.

1. 규칙이 해당 Entity 또는 aggregate의 상태에 관한 것입니다.
2. 판단에 repository, transaction이나 외부 시스템이 필요하지 않습니다.
3. 어느 API에서 호출하더라도 같은 규칙이어야 합니다.
4. 메서드가 유효하지 않은 상태 생성을 막거나 합법적인 상태 전이만 허용합니다.

현재 적용된 예:

```ts
OrderEntity.place(...)
OrderEntity.transition(...)
OrderItemEntity.create(...)
OrderItemSnapshotEntity.capture(...)
InventoryReservationEntity.reserve(...)
PaymentAttemptEntity.create(...)
FulfillmentEntity.create(...)
```

Aggregate 내부의 합법적 상태 전이와 계산은 Entity 행동으로 두고, 여러 aggregate와 외부 저장소를
조율하는 Catalog/Order/Inventory/Payment/Fulfillment/Search 유스케이스는 Service에 둡니다.

Entity에 두지 않는 예:

```text
Redlock 획득과 해제
transaction 시작과 rollback
Product/Item의 고정 순서 pessimistic lock과 재고 합산 검사
writer/replica 선택
JWT 발급과 검증
비밀번호 hashing에 필요한 secret 조회
메일, Redis, OpenSearch 호출
```

이 작업은 Service가 repository와 외부 기술을 조율하며 수행합니다.

## GraphQL 타입을 분리하는 기준

다음 중 하나라도 해당하면 GraphQL 타입을 Entity와 분리합니다.

| 확인 질문                                               | 이 프로젝트의 사례                               |
| ------------------------------------------------------- | ------------------------------------------------ |
| DB와 API의 scalar 표현이 다른가                         | DB `bigint` ID와 GraphQL 문자열 `ID`             |
| 외부에 숨겨야 하는 필드가 있는가                        | `hashedPassword`, `deletedAt`, 내부 storage key  |
| 하나의 응답이 여러 Entity를 조합하는가                  | live Product/Item/옵션/카테고리 그래프           |
| ORM relation의 초기화 여부가 API 계약과 다른가          | MikroORM `Collection`/`Reference`와 GraphQL 배열 |
| DB column과 공개 값의 구조가 다른가                     | Decimal 문자열과 통화를 조합한 `Money`           |
| MySQL 이외의 데이터 원천에서도 같은 API 타입을 만드는가 | OpenSearch `searchProducts`                      |
| DB와 API가 서로 다른 시점에 변경될 가능성이 있는가      | Snapshot 내부 구조와 공개 Product schema         |

현재 주요 aggregate는 이 조건에 해당하므로 MikroORM Entity를 GraphQL ObjectType으로 직접 노출하지
않습니다. 입력 타입도 Entity constructor나 persistence shape로 사용하지 않습니다.

## Mapper는 허용되는 경계다

Mapper가 존재한다는 사실만으로 과한 계층은 아닙니다. 다음과 같은 실제 표현 차이가 있을 때만 둡니다.

- `bigint` ID를 문자열로 바꿉니다.
- Decimal 금액과 통화를 `Money`로 조합합니다.
- 내부 필드를 제외합니다.
- 여러 Entity의 결과를 공개 GraphQL 이름으로 바꿉니다.

Mapper는 순수 변환만 해야 합니다. DB를 조회하거나, 상태를 변경하거나, 도메인 판정을 수행하면 안 됩니다.
표현 차이가 없는 중간 DTO와 전달만 하는 mapper는 만들지 않습니다.

## 도메인별 결정

### Order

Order는 첫 rich Entity 적용 대상이며 현재 전환이 완료됐습니다.

현재 구조는 다음과 같습니다.

```text
OrderEntity                  # aggregate root, 주문 생성과 합계
OrderItemEntity              # 수량과 품목 금액
OrderItemSnapshotEntity      # 주문 시점 증거 복사
```

`OrderEntity.place()`가 주문 품목 존재, ISO 통화 코드와 합계를 검증합니다.
`OrderItemEntity.create()`는 1 이상의 안전한 정수 수량과 품목 금액을 검증하고,
`OrderItemSnapshotEntity.capture()`가 live Product/Item의 이름, SKU, 가격, 세금, 옵션을 주문 시점
증거로 복사합니다. 별도 순수 `Order`/`OrderLine`과 Entity graph 변환기는 제거했습니다.

다음 책임은 `OrderService`와 협력 Service에 남깁니다.

- 회원/멱등성 키와 Item별 Redlock
- 회원별 주문 멱등성 키와 요청 fingerprint
- DB transaction
- live Product/Item의 고정 순서 pessimistic lock, 판매 상태, 가격과 재고 조회
- Item별 요청 수량 합산 검사, 재고 예약 차감과 원장 기록
- 회원과 Item reference 연결, 주문 Snapshot 저장
- 결제 매입 시 예약 소비, 취소/만료 시 재고 복구

GraphQL `OrderType`과 presentation mapper는 유지합니다. Entity의 `Collection`, relation과 `bigint`를 외부
계약으로 직접 노출하지 않기 위해서입니다. 주문 상태 전이는 `OrderEntity.transition()`이 보호하고,
취소/결제/배송 Service가 이력과 함께 호출합니다.

### Catalog

공개 Product는 live `ProductEntity`와 `ItemEntity`, 옵션, 카테고리, 태그를 조합한 Query입니다.
`ProductReadResult`와 GraphQL Product 타입은 이 Entity graph를 외부 계약으로 바꾸기 위해 유지합니다.
조회는 writer의 `REPEATABLE READ` transaction에서 `BALANCED` 전략으로 collection을 나눠 읽어,
관계 수의 곱만큼 행이 늘어나는 문제를 피하면서 같은 DB snapshot을 유지합니다.

`ProductSnapshotEntity`는 현재본이 아니라 `Product.revision`별 전체 판매 상태를 JSON으로 보존하는
append-only 감사 이력입니다. 이 경계는 다음과 같이 고정합니다.

- 일반 상품 조회와 주문은 `ProductSnapshotEntity`를 읽지 않습니다.
- 주문, Product, Item은 감사 Snapshot에 FK를 두지 않습니다.
- 재고는 변경 이력 payload에 복사하지 않고 live `Item.stock`과 재고 원장에서 관리합니다.
- 복원은 과거 이력을 수정하지 않고, 과거 payload의 Product slug/이름/설명/반품 정책/상태, Item, 옵션,
  카테고리와 태그를 live graph에 적용한 뒤 새 revision 이력을 추가합니다.
- payload의 과거 media metadata는 감사용입니다. 현재 복원 command는 live media 연결을 그대로
  보존합니다.

`ProductCommandService`는 Product와 Item 작성/수정/삭제, 전체 graph 교체와 과거 revision 복원을
제공합니다. 하나의 writer transaction에서 live graph 변경, `Product.revision` 증가, 같은 revision의
`ProductSnapshotEntity`와 검색 Outbox 삽입을 함께 완료합니다. Seller는 자기 상품만 변경할 수 있고
Admin은 전체 상품을 관리할 수 있습니다.

### Member/Auth

`MemberType`은 `hashedPassword`, soft delete와 내부 relation을 공개하지 않기 위해 분리합니다.
비밀번호 hashing, token 발급과 최초 로그인 조건부 갱신은 설정, repository와 DB 원자 연산이 필요하므로
Service 책임입니다. 새 비밀번호는 사용자별 salt를 가진 비동기 scrypt로 저장하고, 기존 HMAC은
로그인 성공 시 조건부 갱신으로 이관합니다. Refresh token은 해시로 저장하며 Redis Lua가 소비/회전과
재사용 차단을 원자적으로 처리합니다. Member 상태 전이가 실제로 추가되기 전에는 억지로 rich Entity 메서드를 만들지
않습니다.

### OpenSearch

OpenSearch document는 MySQL Entity의 복사본이나 GraphQL 타입이 아닙니다. 재생성 가능한 검색 read
model이며 별도 projection mapper가 생성합니다. 검색 GraphQL 타입도 Entity를 직접 반환하지 않습니다.
전체 rebuild는 MySQL live Catalog를 batch로 읽고 검증 뒤 Alias를 전환합니다. 증분 경로는 Catalog
transaction의 Outbox를 relay해 external version으로 쓰며, reconciliation이 누락/오래됨/초과 문서를
대조합니다.

## 피해야 할 구조

- 파일 수를 줄이기 위해 Entity에 GraphQL decorator를 함께 붙입니다.
- Resolver가 managed Entity나 MikroORM `Collection`을 그대로 반환합니다.
- GraphQL Input을 `em.create()`에 그대로 전달합니다.
- Entity 메서드가 repository, EntityManager, Redis나 외부 API를 호출합니다.
- 상태와 행동이 같은 순수 domain class와 ORM Entity를 계속 나란히 유지합니다.
- 향후 필요할 수 있다는 이유만으로 모든 테이블에 rich behavior를 만듭니다.
- Mapper나 read result를 모든 Entity에 기계적으로 하나씩 만듭니다.
- 감사용 `ProductSnapshot` JSON을 현재 Product 조회의 read model로 사용합니다.
- 일반 도메인 행에서 감사 Snapshot을 FK로 참조해 추가 전용 정책을 해칩니다.

## 예외적으로 합칠 수 있는 경우

GraphQL 타입과 persistence 타입을 합치는 것은 기본값이 아닙니다. 다음 조건을 모두 만족하고 별도 설계
검토로 승인한 작은 타입만 예외가 될 수 있습니다.

1. DB와 GraphQL의 scalar 표현이 같습니다.
2. 숨겨야 할 필드가 없습니다.
3. 관계 로딩이나 여러 Entity 조합이 없습니다.
4. MySQL 외의 데이터 원천에서 만들지 않습니다.
5. DB와 API가 함께 변경되어도 문제가 없습니다.

이 예외는 aggregate Entity에 GraphQL decorator를 추가하라는 권장이 아닙니다. 단순하고 불변인 value
object의 중복을 줄일 때만 검토합니다.

## 적용 순서

1. 이 문서와 [애플리케이션 레이어 원칙](layering.md)을 설계 정본으로 사용합니다.
2. Order를 rich MikroORM aggregate로 전환하고 중복 `Order`/`OrderLine`을 제거했습니다.
3. Catalog 작성/변경/복원에 필요한 규칙은 command Service와 Entity에 역할별로 배치했습니다.
4. OpenSearch document와 검색 GraphQL 타입은 별도 read model로 구현했습니다.

새 계층이나 타입을 추가할 때는 먼저 다음을 확인합니다.

```text
이 타입은 외부 계약인가, 도메인 상태인가, 영속성 구조인가, 조회 결과인가?
현재 다른 타입과 표현 또는 변경 이유가 실제로 다른가?
중복을 없애는가, 아니면 이름만 다른 전달 계층을 추가하는가?
```
