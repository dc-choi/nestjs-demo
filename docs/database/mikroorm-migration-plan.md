# MikroORM 전환과 운영 migration 기록

작성일: 2026-08-13

최종 갱신: 2026-09-05

상태: Phase 0-5와 운영 migration/seed 도입 완료

이 문서는 Prisma 기반 영속성 계층을 MikroORM으로 교체한 기준, 영향 범위, 구현 순서와 현재 진행
상태를 기록한다. 목표는 GraphQL 타입과 ORM 타입을 합치는 것이 아니라, GraphQL 경계는 명시적으로
유지하면서 영속성 코드와 중복 domain model을 필요한 aggregate의 rich Entity로 합치는 것이다.

타입과 도메인 행동의 정본은 [GraphQL, Entity와 도메인 모델 경계](../architecture/model-boundaries.md)다.

## 결론

- 로컬 `main`을 Prisma/GraphQL 완성 기준점 `ce144cc`로 fast-forward한 뒤 `feat/mikroorm`에서 전환했다.
- ORM 전환 직후에는 당시 26개 모델과 15개 enum을 매핑해 schema 차이가 없음을
  확인했다. 이후 live Catalog/감사 전용 Snapshot과 검색 Outbox로 재설계한 현재 metadata는 25개
  Entity와 16개 enum이며, 아래 과거 검증 결과와 구분한다.
- Member/Auth, Catalog 조회, 공개 Order 쓰기는 MikroORM 구현으로 전환했다.
- 공개 주문 구현을 `OrderService` 하나로 단일화하고 비교 학습용 `OrderV1Service`와 `OrderV2Service`는 삭제했다.
- GraphQL ObjectType과 MikroORM Entity는 분리한다. ORM Entity를 Resolver에서 직접 반환하지 않는다.
- 장기적인 Prisma/MikroORM 병행, 이중 쓰기, 런타임 ORM 토글은 만들지 않는다.
- Phase 5에서 Prisma 의존성, 생성물과 설정을 제거하고 문서 정합성과 전체 검증을 완료했다.
- Schema 변경은 versioned MikroORM migration으로 생성/검사/적용하며 production 산출물에도 migration
  실행기를 포함한다. 로컬 demo 데이터는 멱등 Seeder로 만든다.

## 현재 기준점

전환 작업을 시작한 기준점은 다음과 같다. 아래 표는 원격에 push했다는 뜻이 아니다.

| 기준                      | 커밋      | 상태                                      |
| ------------------------- | --------- | ----------------------------------------- |
| `origin/main`             | `b489349` | 작업 시작 시 원격 기준                    |
| `main`                    | `ce144cc` | GraphQL 스냅샷으로 로컬 fast-forward 완료 |
| `snapshot/prisma-graphql` | `ce144cc` | Prisma 최종 구현의 고정 비교/복구 지점    |
| `feat/mikroorm`           | `ce144cc` | 이 기준점에서 생성, 전환 변경은 작업 중   |

`snapshot/prisma-graphql`에는 다음 작업이 포함되어 있다.

- REST, Swagger, BullMQ 제거와 GraphQL 공개 API 전환
- GraphQL context, 오류 처리, 요청 로깅
- Rich Order 도메인과 주문 영속성 구현
- Catalog 조회와 명시적 GraphQL mapper
- 당시 Prisma 기반 최종 구현과 29개 단위 테스트
- Prisma와 GraphQL 구조 문서

실제 작업은 README와 계획 초안을 stash로 보호하고 로컬 `main`을 `ce144cc`로 fast-forward한 뒤,
`feat/mikroorm` 브랜치를 만드는 순서로 진행했다. `snapshot/prisma-graphql`은 수정하지 않았고 Prisma
구현의 비교 기준과 rollback 지점으로 보존한다. 전환 변경은 아직 커밋하거나 원격에 push하지 않았다.

현재 작업 디렉터리의 `.pnpm-store/`는 로컬 캐시이므로 전환 커밋에 포함하지 않는다.

## 기준점 승격으로 해결한 선행 결함

fast-forward 전 로컬 `main` `86d0035`에서는 다음 검증 결과가 확인되었다.

- Prisma schema validation 통과
- 단위 테스트 2 suites, 4 tests 통과
- TypeScript compile 실패

컴파일 실패 원인은 당시 v1 주문 모듈이 존재하지 않는 `presentation/order.controller`를 import한
것이었다. GraphQL 스냅샷으로 fast-forward하면서 이 이전 구조가 제거됐으므로 별도 임시 수정 커밋은
만들지 않았다. 이 절은 현재 source의 결함 목록이 아니라 기준 브랜치 선택 이유를 남긴 기록이다.

## 왜 MikroORM인가

Prisma와 GraphQL이 기술적으로 호환되지 않는 것은 아니다. 현재 코드가 복잡해진 핵심 원인은
다음 세 타입 체계를 매 요청마다 변환하고 있기 때문이다.

1. Prisma가 생성한 모델과 입력 타입
2. application/domain 타입
3. GraphQL Input/ObjectType

MikroORM은 동작을 가진 Entity, Identity Map, Unit of Work를 제공한다. 이 프로젝트에서는 다음
부분을 단순화할 수 있다.

- 상품, 주문, 재고 상태 변경 규칙을 Entity 메서드로 모을 수 있다.
- Prisma 생성 입력 타입을 조립하는 persistence mapper를 줄일 수 있다.
- 같은 EntityManager 트랜잭션 안에서 조회, 잠금, 조건부 갱신, 저장을 표현할 수 있다.
- Read Replica와 Kysely escape hatch를 ORM 자체 기능으로 통합할 수 있다.
- Prisma Client 생성과 관련된 build, Docker, alias 설정을 제거할 수 있다.

그러나 MikroORM도 다음 문제를 자동으로 해결하지 않는다.

- GraphQL 공개 계약과 DB 스키마의 결합
- BigInt와 Decimal의 wire serialization
- 복잡한 GraphQL 관계 조회의 N+1
- 주문 재고 동시성
- 공개 가능한 필드와 내부 필드의 구분

따라서 Entity를 GraphQL ObjectType으로 겸용하지 않는다. 계층은 줄이되 외부 계약 경계는
유지한다.

## 목표 구조

```text
GraphQL Input
  -> Resolver
  -> Service
  -> MikroORM EntityRepository<Entity> 또는 EntityManager
  -> Rich Entity / transactional EntityManager

MikroORM Entity / Domain result
  -> Application result
  -> GraphQL mapper
  -> GraphQL ObjectType
```

### 적용 원칙

- `presentation`은 GraphQL decorator, ID 문자열 변환, 공개 필드만 담당한다.
- `application`의 Service는 유스케이스를 담당하고 MikroORM 기본 `EntityRepository`를 직접 사용한다.
- `domain` Entity는 생성과 상태 변경 불변식을 담당한다.
- `infrastructure`는 공통 DB 연결 설정과 실제로 중복되는 영속성 helper를 담당한다.
- 구현이 하나뿐인 repository/reader에 별도 interface, Symbol, wrapper를 만들지 않는다.
- 여러 Entity를 조율하거나 새 aggregate를 등록할 때는 Service에 `EntityManager`를 직접 주입할 수 있다.
- transaction은 주입받은 `EntityManager`에서 시작하거나 RequestContext 안에서 `@Transactional()`을
  사용한다. 명시적 callback 방식이면 callback으로 받은 EntityManager만 사용한다.

### 단순화할 부분

- Auth/Member는 `EntityRepository<MemberEntity>`를 각 Service에 직접 주입한다.
- Prisma 입력 타입 전용 mapper는 제거한다.
- 단순 관계 저장은 Entity graph와 Unit of Work를 사용한다.
- 복잡한 projection 조회만 QueryBuilder 또는 `EntityManager.getKysely()`를 사용한다.

## 패키지와 런타임 결정

2026-09-05 기준 안정 버전을 exact pin한다.

| 용도              | 패키지                        |     버전 |
| ----------------- | ----------------------------- | -------: |
| ORM core          | `@mikro-orm/core`             | `7.1.11` |
| MySQL driver      | `@mikro-orm/mysql`            | `7.1.11` |
| legacy decorator  | `@mikro-orm/decorators`       | `7.1.11` |
| Nest integration  | `@mikro-orm/nestjs`           |  `7.1.0` |
| CLI               | `@mikro-orm/cli`              | `7.1.11` |
| Entity 초안 생성  | `@mikro-orm/entity-generator` | `7.1.11` |
| Migration runtime | `@mikro-orm/migrations`       | `7.1.11` |
| Seeder            | `@mikro-orm/seeder`           | `7.1.11` |

`@mikro-orm/migrations`는 production runtime dependency이며, `@mikro-orm/seeder`와 CLI는 개발 도구입니다.
배포에서는 생성된 migration만 적용하고 migration 생성과 seed를 애플리케이션 boot에 묶지 않습니다.

MikroORM 7과 `@mikro-orm/nestjs@7.1.0`은 Node 22.17 이상과 Nest 11 또는 12를 지원하므로 현재
Node 26.7, Nest 12 환경과 호환된다.
MikroORM 7의 native ESM package export를 해석하기 위해 다음 TypeScript 설정을 적용했다.

```json
{
    "compilerOptions": {
        "module": "NodeNext",
        "moduleResolution": "NodeNext"
    }
}
```

애플리케이션 build는 NodeNext를 사용한다. 테스트는 Vitest와 SWC의 ESM 변환을 사용하며,
일반 단위 테스트와 MikroORM 테스트를 `pnpm unit`에서 함께 실행한다. SWC 변환은 legacy decorator와
metadata를 보존하고, 타입 검사는 `pnpm typecheck`로 별도 실행한다. 아래 ORM 전환 당시의 Jest 검증
기록은 현재 runner 설정과 구분한다.

- Nest development compile과 module loading
- Vitest와 SWC의 ESM 테스트 변환
- SWC production build
- path alias
- production build
- MikroORM CLI의 TypeScript config 로딩

MikroORM CLI의 TypeScript config loader는 `@swc-node/register`를 사용한다. Docker build와 production
boot도 Phase 5 최종 gate에서 확인했다.

Entity는 `@mikro-orm/decorators/legacy`와 `ReflectMetadataProvider`를 사용한다. 현재 SWC의
`legacyDecorator`, `decoratorMetadata`, `keepClassNames` 설정과 맞으며, production 배포에
TypeScript source나 별도 metadata cache를 요구하지 않는다.

## 스키마 영향

현재 MikroORM metadata는 25개 Entity로 구성된다. ORM 전환 당시의
Prisma 대조 스키마와 이후 Catalog 재설계는 별개 변경이다.

| 도메인          | 모델 수 | 핵심 구조                                  |
| --------------- | ------: | ------------------------------------------ |
| Member          |       1 | 회원 role, email unique                    |
| Catalog live    |      10 | Product/Item, 옵션, 카테고리, 미디어, 태그 |
| Catalog history |       1 | append-only JSON ProductSnapshot           |
| Order           |       5 | 주문, 주문 품목, 주문 시점 snapshot        |
| Inventory       |       2 | 예약, 원장                                 |
| Payment         |       3 | 결제 시도, 거래, webhook                   |
| Fulfillment     |       2 | 배송과 배송 품목                           |
| Search          |       1 | Product revision 기반 projection Outbox    |

Entity 초안은 실제 DB metadata, GraphQL 스냅샷의 과거 Prisma schema와 이 문서를 함께 대조했다.
fast-forward 전 `main`에는 없었던 `Member.email` unique도 GraphQL 스냅샷과 로컬 test DB를 기준으로
보존했다. 당시 ORM 전환 metadata의 schema dump가 비어 있음을 확인했다. 현재 25개 Entity
재설계는 별도 schema 변경이므로 이 과거 확인으로 검증됐다고 간주하지 않는다.

### 반드시 동일하게 보존할 DB 계약

- 테이블명과 snake_case 컬럼명
- signed `BIGINT` PK/FK와 JavaScript `bigint`
- `DECIMAL(10, 3)`, `DECIMAL(19, 3)` 정밀도
- JSON category path, selected options, metadata
- `DateTime(0)`, `DateTime(3)` 정밀도
- `Item.sku` varchar/unique 계약
- `createdAt`, `updatedAt`, `deletedAt` 의미
- 모든 unique/index 이름과 컬럼 순서
- `Restrict`, `Cascade`, `SetNull` 삭제 정책
- 복합 PK와 복합 FK
- Category 자기 참조
- `ItemOptionValue`의 surrogate PK, 단일 FK, `(item, option)` unique와 `product_id` scalar
- Product당 감사 Snapshot revision unique와 JSON payload 타입
- OrderItemSnapshot의 주문 당시 값 보존

### Entity 작성 방식

1. 실제 로컬 MySQL에서 Entity Generator로 초안을 생성했다.
2. 과거 Prisma schema와 [카탈로그 Snapshot 문서](catalog-snapshots.md)를 대조했다.
3. 필드 타입, 관계, 인덱스, 삭제 정책과 주석을 사람이 검토했다.
4. 전체 Entity가 모두 discovery된 뒤 schema diff를 확인했다.
5. ORM 교체 단계의 DDL 차이가 0임을 확인했다.

Entity Generator의 출력 정책은 실행 전에 고정한다.

```ts
entityGenerator: {
    entityDefinition: 'decorators',
    enumMode: 'ts-enum',
    bidirectionalRelations: false,
    identifiedReferences: false,
    scalarTypeInDecorator: true,
    scalarPropertiesForRelations: 'never',
    outputPurePivotTables: true,
    onlyPurePivotTables: true,
    forceUndefined: false,
}
```

- legacy decorator class를 생성한다.
- enum은 TypeScript enum 초안으로 생성한 뒤 domain enum과 대조한다.
- DB에 존재하지 않는 inverse relation은 자동 생성하지 않고 실제 탐색에 필요한 것만 추가한다.
- `Reference` wrapper를 일괄 도입하지 않고 공개 조회는 명시적 projection으로 처리한다.
- scalar DB 타입을 decorator에 기록해 SWC/ReflectMetadata 추론 의존을 줄인다.
- 복합 PK relation의 별도 scalar FK가 PK metadata를 깨뜨리지 않도록 생성하지 않는다.
- 명시적인 연결 테이블을 자동 Many-to-Many로 접지 않고 독립 Entity로 유지한다.
- nullable 필드는 전환 전 Prisma 계약과 현재 DB 계약처럼 `null`을 사용한다.
- `ItemEntity.sku`는 `onCreate: randomUUIDv7()`로 애플리케이션에서 UUID v7을 만든다.

Entity는 도메인별로 다음 위치에 둔다.

```text
src/api/member/domain/member.entity.ts
src/api/catalog/domain/entity/*.entity.ts
src/api/order/domain/entity/*.entity.ts
src/api/inventory/domain/entity/*.entity.ts
src/api/payment/domain/entity/*.entity.ts
src/api/fulfillment/domain/entity/*.entity.ts

src/infra/database/
  database.module.ts
  mikro-orm.config.ts
  entities.ts
  mikro-orm.logger.ts
```

DB 연결, MikroORM 설정, Entity 등록 목록과 SQL logger는 외부 기술 경계이므로 `src/infra/database`에
둔다. 각 Entity는 해당 도메인의 개념과 상태 규칙을 표현하므로 도메인별 디렉터리에 유지한다.

MikroORM decorator가 domain Entity에 존재하는 결합은 의도적으로 허용한다. 이 프로젝트에서는
domain model과 persistence model을 계속 복제하는 것보다 aggregate Entity에 영속성 metadata와 도메인
메서드를 함께 두는 편이 단순하다. 단 GraphQL decorator는 Entity에 추가하지 않는다.

모든 테이블을 억지로 Rich Entity로 만들지는 않는다. 주문과 재고처럼 상태 전이가 있는 aggregate에
메서드를 두고, 이력과 연결 테이블은 명시적인 persistence Entity로 유지한다. Order는 순수 domain
class를 제거하고 `OrderEntity`/`OrderItemEntity`에 생성 규칙과 계산을 통합했다.

## 타입 정책

### BigInt

- DB와 domain/application에서는 `bigint`를 사용한다.
- GraphQL `ID`는 10진 문자열로 유지한다.
- `Number`로 변환하지 않는다.
- `BigInt.prototype.toJSON` 같은 전역 monkey patch를 만들지 않는다.
- `2^53`보다 큰 ID의 조회, application 입력과 GraphQL 왕복 테스트를 둔다.

MikroORM 7.1.11의 MySQL connection은 auto-increment insert 결과를 내부에서 `Number`로 변환한다. 따라서 신규
AUTO_INCREMENT 값 자체가 `Number.MAX_SAFE_INTEGER`를 넘는 생성 경로는 현재 보장 범위가 아니다. 이 demo의
테이블이 해당 범위에 도달하기 전에 application-assigned ID로 전환하거나 upstream의 bigint insert ID 지원을
확인해야 한다. 기존 큰 ID를 조회하고 GraphQL `ID` 문자열로 내보내는 경로는 `bigint`를 유지한다.

### Decimal

MikroORM의 Decimal은 기본적으로 정밀도 보존을 위해 문자열로 다룬다.

- 기존 GraphQL 스냅샷의 exact decimal helper를 유지한다.
- 가격 계산에 JavaScript floating point를 사용하지 않는다.
- DB Decimal, domain amount, GraphQL decimal string 왕복을 검증한다.

### Enum

- `MemberRole` 등 비즈니스 enum은 ORM 생성 타입에서 독립시킨다.
- domain enum을 MikroORM Entity와 GraphQL enum이 공유한다.
- DB enum 이름과 문자열 값은 현재 schema와 동일하게 유지한다.

### JSON

- `unknown`이나 무제한 object로 노출하지 않는다.
- Entity property에는 명시적인 TypeScript 타입을 둔다.
- GraphQL에는 application result를 통해 필요한 구조만 노출한다.

## GraphQL 영향

순수 ORM 전환 단계에서는 GraphQL 공개 스키마를 바꾸지 않았다. 이후 live Catalog/감사
Snapshot 도메인 재설계에서는 외부 개념도 의도적으로 바꾸었다.

- Product의 과거 중첩 revision 객체를 제거하고 live `revision`, 이름, Item, 옵션을 Product에
  배치했다.
- 주문 Snapshot은 과거 Catalog Snapshot ID 대신 `productId`/`productRevision`을 노출한다.
- Query/Mutation 이름, ID/Decimal 문자열, 오류, 인증과 context 계약은 유지한다.

MikroORM의 `Reference`와 `Collection`은 Resolver 반환값으로 직접 내보내지 않는다. Nest serializer에
의존하지 않고 명시적 application result와 GraphQL mapper를 사용한다.

Catalog는 relation을 field resolver에서 하나씩 lazy load하지 않는다. 초기 구현에서는 한 번의
명시적 QueryBuilder 또는 populate 계획으로 공개 product graph를 조회한다. N+1이 실제로 생기는
관계 필드를 추가할 때만 `dataloader@2.2.3` 도입을 검토한다.

## RequestContext와 EntityManager

MikroORM은 Identity Map과 Unit of Work를 가진 stateful ORM이다. 전역 EntityManager를 요청 간에
공유하면 안 된다.

`@mikro-orm/nestjs`의 RequestContext middleware를 사용한다. Apollo Server 5와 Express 5 요청에서
서로 다른 EntityManager가 만들어지고 transaction callback이 별도 fork를 사용하는 것을 테스트로
검증했다.

필수 테스트는 다음과 같다.

- 동시에 실행한 두 GraphQL 요청이 서로 다른 EntityManager를 사용한다.
- 같은 요청에서 같은 PK를 조회하면 같은 managed entity를 사용한다.
- Resolver에서 application service까지 RequestContext가 유지된다.
- transaction callback은 transaction fork를 사용한다.
- 앱 종료 시 DB 연결이 정상 종료된다.

## Transaction과 분산락

현재 공개 주문 흐름의 안전 규칙은 다음과 같다.

```text
회원별 멱등성 키와 요청 fingerprint 사전 확인
  -> 회원/멱등성 키와 Item별 Redlock 획득
  -> MikroORM transaction 시작
  -> 회원별 멱등성 키와 요청 fingerprint 재확인
  -> Product와 Item을 ID 순서로 pessimistic lock
  -> live Product/Item의 주문 가능 상태와 가격 조회
  -> Item별 요청 수량 합산 검사와 managed stock 감소
  -> 주문과 주문 시점 Snapshot 저장
  -> commit
  -> Redlock 해제
```

- Redlock은 DB transaction 바깥에서 유지한다.
- 같은 회원/멱등성 키와 같은 정규화 품목 요청은 기존 주문으로 replay하고, 다른 요청은 거절한다.
- 공개 주문은 Redlock callback 안의 private 메서드에 `@Transactional()`을 적용한다.
- GraphQL runtime은 RequestContext를 만들고, 단위 테스트는 `RequestContext.create()`로 같은 경계를 만든다.
- 주입된 `EntityManager`와 Item/Member `EntityRepository`는 decorator가 만든 같은 transaction context를
  사용한다.
- 별도 격리 수준은 지정하지 않으며 현재 MySQL 기본값인 `REPEATABLE READ`를 사용한다.
- 잠금 없이 수행하는 Unit of Work의 일반적인 entity update만으로 oversell을 방지하지 않는다.
- 직접 생성한 `OrderEntity` aggregate는 `persist()`로 Unit of Work에 등록해야 한다. `@Transactional()`이
  commit 전에 자동 flush하므로 주문 Service에서 `flush()`를 다시 호출하지 않는다.
- Product와 Item을 ID 순서로 `PESSIMISTIC_WRITE` 잠그고, 잠금 뒤 Item별 합산 수량과 현재 재고를
  비교한 다음 같은 transaction에서 재고와 원장을 갱신한다.
- 로그인 시각의 `nativeUpdate`는 `onUpdate` hook을 실행하지 않으므로 `updatedAt`을 함께 쓴다.
- 주문 일부가 실패하면 재고 감소와 주문 저장이 모두 rollback되어야 한다.
- 현재 공개 주문은 MikroORM pessimistic row lock을 사용하며 application에서 직접 Kysely 쿼리를 쓰지 않는다.

## Primary와 Read Replica

전환 전 Prisma read-replica extension의 자동 라우팅을 그대로 흉내 내지 않았다. MikroORM은 다음
정책을 사용한다.

- `preferReadReplicas: false`
- Auth, token 검증, 주문, 재고, Catalog 변경은 writer
- transaction 내부 쿼리는 모두 writer
- eventual consistency를 허용하는 목록/검색 조회만 `connectionType: 'read'`
- writer와 모든 replica 연결을 boot 단계에서 확인

명시적인 writer 기본값은 read-after-write 오류를 줄이고 각 조회의 일관성 의도를 코드에 남긴다.

## SQL 로깅

전환 전 Prisma QueryEvent 기반 logger는 MikroORM logger로 교체했다.

기록하는 값:

- query template
- 실행 시간
- writer/replica connection 이름과 유형
- slow query 여부

기록하지 않는 값:

- SQL parameter 원문
- email, phone, password hash, token
- GraphQL variables와 response data

slow query 기준은 우선 500ms로 두고 실제 실습 결과에 따라 조정한다.

## 단계별 구현 계획

### Phase 0. 기준 브랜치와 빌드 스파이크

상태: 완료

작업:

1. `main`을 `snapshot/prisma-graphql`로 fast-forward한다.
2. 갱신된 `main`에서 `feat/mikroorm`을 만든다.
3. 기존 typecheck, lint, unit, build, GraphQL e2e를 다시 통과시킨다.
4. MikroORM core/Nest/MySQL/CLI 패키지를 exact pin한다.
5. NodeNext module resolution을 적용한다.
6. Nest, Jest, SWC와 production module resolution을 검증한다.

통과 조건:

- source 동작 변경 없음
- MikroORM config import 가능
- GraphQL schema 변화 없음
- 개발/production build와 boot 성공

권장 커밋:

```text
chore(mikroorm): verify runtime and module resolution
```

### Phase 1. DB 기반과 전체 Entity metadata

상태: 완료

작업:

1. `DatabaseModule`, MikroORM config, Entity 목록, 안전한 logger를 추가한다.
2. 실제 로컬 MySQL에서 당시 26개 Entity 초안을 생성한다.
3. 도메인별로 파일을 나누고 이름, 타입, 관계, index를 검토한다.
4. GraphQL 요청별 RequestContext를 검증한다.
5. primary/replica 연결과 shutdown hook을 구성한다.
6. schema update는 실행하지 않고 diff만 출력한다.
7. 새 aggregate의 명시적 `persist`와 transaction의 자동 flush 동작을 테스트로 고정한다.

이 단계 동안에는 application provider를 교체하지 않고 Prisma를 schema owner와 런타임 ORM으로
유지했다. 전체 metadata와 빈 schema diff를 확인한 뒤 수직 슬라이스 전환을 시작했다.

통과 조건:

- 당시 26개 모델과 15개 enum discovery 성공
- 기존 테이블을 drop하려는 diff 없음
- 의도하지 않은 컬럼/제약 변경 없음
- RequestContext 동시성 테스트 통과

권장 커밋:

```text
chore(mikroorm): bootstrap database metadata
```

### Phase 2. Member와 Auth 수직 슬라이스

상태: 완료

작업:

1. `Member` Entity와 domain enum을 기준으로 전환한다.
2. signup, login, refresh token, members 조회를 MikroORM 기본 `EntityRepository`로 옮긴다.
3. 이메일 unique violation을 application 오류로 변환한다.
4. `lastLoginAt` 최초 로그인 갱신의 원자성을 유지한다.
5. Auth 읽기는 writer, eventual consistency 목록만 replica를 사용한다.

통과 조건:

- signup/login/refresh/members GraphQL 계약 변화 없음
- 동시 가입 중 이메일 중복 방지
- 연속/동시 로그인에서 최초 로그인 판정 정확
- BigInt 회원 ID 왕복 정확

권장 커밋:

```text
refactor(member): migrate persistence to MikroORM
```

### Phase 3. Catalog 조회 수직 슬라이스

상태: 완료

이 Phase의 초기 구현은 당시의 versioned Catalog 조회 스키마를 대상으로 했다. 이후
live Product/Item과 감사 전용 JSON Snapshot으로 재설계했으며, 아래는 현재 구현 결과를
기준으로 적는다.

작업:

1. `PrismaProductReader`를 제거하고 `ProductService`가 MikroORM 기본 `EntityRepository`로 조회한다.
2. Resolver는 `ProductService`만 주입받고 `ProductReadResult`, GraphQL mapper는 유지한다.
3. live Product, Item, option, category, tag 관계를 명시적으로 조회한다.
4. Product/Item 상태와 soft delete 조건을 보존한다.
5. 쿼리 수와 실행 계획을 기록해 N+1이 없는지 확인한다.

통과 조건:

- 기존 GraphQL product fixture와 결과 동일
- ACTIVE, 미삭제 live Product만 노출
- ALLOW 상태이며 삭제되지 않은 live Item만 노출
- 옵션, 카테고리, 태그 순서와 live 값 보존
- 감사용 `ProductSnapshot` 미조회
- writer/replica 정책 테스트 통과

권장 커밋:

```text
refactor(catalog): migrate product reader to MikroORM
```

### Phase 4. Order 쓰기 수직 슬라이스

상태: 완료

작업:

1. Prisma 영속성 구현을 제거하고 `OrderService`의 lock 내부 메서드에 `@Transactional()`을 적용한다.
2. exact decimal 로직과 주문 생성 규칙을 `OrderEntity`/`OrderItemEntity`에 통합한다.
3. Redlock과 DB transaction 경계를 유지한다.
4. 주문 가능한 live Product/Item 조회와 별도 주문 Snapshot 복사를 전환한다.
5. Product와 Item 행을 고정 순서로 잠그고 중복 Item 라인의 합산 수량을 검증한 뒤 재고를 차감한다.
6. `OrderEntity` aggregate root를 `persist` 하여 품목과 snapshot을 같은 transaction에서 cascade 저장한다.
7. `@Transactional()`의 자동 flush 후 생성 ID와 `createdAt`이 반영된 aggregate를 반환한다.

통과 조건:

- 현재 주문 GraphQL 계약에 맞는 정상 응답
- 재고 부족 시 주문과 재고 모두 불변
- persistence 중간 실패 시 전체 rollback
- 동일 item 동시 주문 시 stock 음수 없음
- 주문 snapshot이 catalog 변경 뒤에도 불변
- 중복 item 입력 정책 테스트 통과

권장 커밋:

```text
refactor(order): migrate transaction to MikroORM
```

### Phase 5. Prisma와 직접 Kysely 의존성 제거

상태: 완료

모든 수직 슬라이스와 전체 Entity metadata가 통과한 뒤에만 정리한다.

현재 공개 runtime의 Member/Auth, Catalog, Order provider는 MikroORM으로 전환했고, 비교용 주문 v1/v2
소스와 테스트도 제거했다. Prisma 직접 패키지와 직접 Kysely 패키지, `prisma/` 생성물, application binding,
build/Jest/SWC/ESLint/Docker/CI 설정도 제거했다. 문서 정합성 정리와 전체
typecheck/lint/unit/coverage/build/boot/e2e/Docker 검증도 완료했다.

제거한 대상:

- `@prisma/client`, `prisma`, MariaDB adapter
- Prisma read-replica extension
- Prisma CLS transactional adapter
- `prisma-kysely`, `prisma-extension-kysely`
- 직접 `kysely` 의존성
- `DaoModule`, Prisma repository/adapter/config
- generated Prisma Client와 Kysely 타입
- `prisma generate` script
- Docker의 Prisma generate와 dummy URL
- Jest/SWC/ESLint의 Prisma alias와 ignore
- CI의 Prisma generate 단계

의도적으로 남을 수 있는 `Prisma` 문자열은 application 의존성이 아니다. `snapshot/prisma-graphql`
브랜치 이름과 이 문서의 전환 이력은 복구/설명 기준으로 유지한다. `sonar.projectKey`와
`sonar.projectName`은 외부 Sonar 프로젝트 식별자이므로 이 전환에서 임의로 바꾸지 않는다. lockfile에
다른 패키지의 optional peer metadata로 나타나는 `@prisma/client`도 설치된 직접 의존성을 뜻하지 않는다.

MikroORM v7이 내부적으로 사용하는 Kysely는 MySQL driver의 구현 세부다. 애플리케이션의 직접
Kysely 의존성은 제거하며, 정말 필요한 복잡한 쿼리만 `EntityManager.getKysely()`로 접근한다.

통과 조건:

- source, test, config, package에 Prisma application 참조 없음
- GraphQL schema와 주요 operation 계약 변화 없음
- 전체 unit/e2e 통과, 당시 별도 integration suite가 없음을 확인
- production build/boot와 Docker build 통과
- schema diff에 의도하지 않은 DDL 없음

권장 커밋:

```text
refactor(database)!: remove Prisma persistence
```

## Order 구현 단일화

비교 학습용 `OrderV1Service`, `OrderV2Service`, 공통 transaction options helper와 비교 테스트는 삭제했다.
공개 주문은 `OrderResolver`가 호출하는 `OrderService` 하나만 유지한다.

- 회원/멱등성 키와 Item별 Redlock을 DB transaction 바깥에서 획득한다.
- private 주문 메서드의 `@Transactional()`이 RequestContext의 primary transaction을 연다.
- 주입된 Item `EntityRepository`로 live Product/Item, 옵션을 writer에서 조회하고 Product 다음 Item 순서의
  pessimistic lock 아래 재고를 차감한다.
- 주입된 `EntityManager`로 새 주문 aggregate를 등록하고, Member repository로 회원
  reference를 생성한다.
- 감사용 `ProductSnapshot`은 주문 조회와 FK에 사용하지 않는다.
- application에서 직접 Kysely를 사용하지 않으며, 동시 쓰기 직렬화가 필요한 command만 MikroORM의
  pessimistic lock을 명시적으로 사용한다.

## 운영 migration과 seed 정책

MikroORM 전환 당시의 직접 schema push는 초기 metadata 대조에만 사용했습니다. 현재 Schema 변경은 다음
versioned migration 흐름을 사용합니다.

```text
1. 대상 host/database 확인
2. `pnpm database:schema:dump`로 metadata 차이 확인
3. `pnpm database:migration:create --name <name>`으로 migration 생성
4. 생성된 up/down SQL과 snapshot 검토
5. `pnpm database:migration:check`와 `pnpm database:migration:pending` 실행
6. `pnpm database:migrate` 적용
7. schema diff와 pending migration이 없는지 재확인
```

Production에서는 `pnpm prod:build` 후 `pnpm database:migrate:prod`가 compiled migration runner를
실행합니다. 애플리케이션 boot는 자동 DDL을 수행하지 않습니다. `database:migrate:down`은 대상 SQL과
백업을 확인한 수동 복구에만 사용합니다.

`DatabaseSeeder`는 환경 변수로 받은 비밀번호와 secret으로 demo 회원/상품/재고를 만들며 자연 키와
재고 idempotency key로 반복 실행을 수렴시킵니다. 전체 실행 순서와 OpenSearch 후속 작업은
[로컬 실행과 운영 Runbook](../operations/local-runtime-runbook.md)을 따릅니다.

## 테스트 계획

### Characterization test

ORM 교체 전에 현재 동작을 고정한다.

- GraphQL schema와 주요 operation
- 인증과 request context
- Member email unique와 최초 로그인
- live Product/Item projection과 Product revision
- Order snapshot과 금액 계산
- Product/Item 고정 순서 잠금, Item별 합산 재고 차감과 rollback
- Redlock 획득/재시도/해제 설정
- primary/replica 선택

### Entity/DB integration test

SQLite 대체 DB를 사용하지 않고 실제 MySQL test DB에서 검증한다.

- metadata discovery
- BigInt `2^53` 초과 조회, application 입력과 GraphQL wire 왕복
- Decimal precision/scale 왕복
- JSON nullable/array 왕복
- enum 값
- 복합 PK/FK와 삭제 정책
- unique/index
- `updatedAt` 동작
- 새 aggregate의 명시적 `persist`와 transaction 자동 flush
- transaction rollback
- 고정 순서 pessimistic lock과 잠금 뒤 재고 검사
- RequestContext 격리
- replica 라우팅

### 각 Phase 공통 gate

```sh
pnpm exec tsc --noEmit --incremental false
pnpm lint
pnpm unit
pnpm stage:build
pnpm prod:build
pnpm e2e
```

마지막 Phase에서는 production boot와 Docker build도 필수다. 외부 서버를 전제로 하는 e2e는 앱을
실제로 띄운 상태에서 별도로 실행하고, 기본 unit/coverage suite에는 섞지 않는다.

## OpenSearch 구현과의 관계

OpenSearch 구현은 MikroORM 전환 이후 별도 read model로 추가했습니다.

- MySQL은 계속 source of truth다.
- live Product 변경, 동일 revision의 감사 Snapshot과 Outbox를 같은 MikroORM transaction으로 저장합니다.
- Worker는 Snapshot payload가 아니라 MySQL primary의 현재 live graph를 재조회합니다.
- 기존 `Query.product`의 MySQL 조회와 `Query.searchProducts`의 OpenSearch 조회는 서로 다른 구체 클래스로 둔다.
- index projection은 MikroORM Entity를 직접 serialize하지 않고 별도 projection mapper를 사용합니다.

관련 문서:

- [OpenSearch 상품 검색 설계](../search/opensearch-product-search.md)
- [OpenSearch 인덱스 동기화](../search/opensearch-index-synchronization.md)

## Rollback

- 각 수직 슬라이스는 독립적으로 검증한다.
- 한 시점에 한 도메인의 DI binding만 바꿨다.
- write를 Prisma와 MikroORM에 동시에 수행하지 않는다.
- DDL을 섞지 않았으므로 전환 실패 시 작업 브랜치 변경을 되돌릴 수 있다.
- Prisma schema는 Phase 1-4의 대조 기준으로 유지했고, 빈 schema diff 확인 뒤 Phase 5에서 제거한다.
- `snapshot/prisma-graphql`은 최종 Prisma 구현의 복구 지점으로 유지한다.

## 완료 기준

다음 조건을 모두 만족해야 MikroORM 전환이 완료된 것으로 본다.

Phase 0-4의 기능 전환 조건과 Prisma/direct Kysely package 제거를 충족했고 아래 최종 gate도 모두
확인했다.

- GraphQL 공개 schema와 오류 계약이 유지된다.
- 현재 25개 Entity와 migration snapshot이 실제 DB 구조와 일치한다.
- BigInt, Decimal, JSON, 복합 관계 회귀 테스트가 통과한다.
- Member/Auth, Catalog, Order가 Prisma 없이 MikroORM 구현만 사용한다.
- 주문 동시성과 rollback 불변식이 유지된다.
- RequestContext가 GraphQL 요청별로 격리된다.
- writer/replica 정책이 테스트로 고정된다.
- Prisma package, 직접 Kysely package와 생성물이 제거된다.
- versioned migration 생성/검사/적용과 빈 최종 schema diff가 확인된다.
- typecheck, lint, unit, e2e, production build/boot, Docker build가 통과한다.
- 문서와 실제 디렉터리/스크립트가 일치한다.

## ORM 전환 당시 검증 기록

2026-08-13에 Node 26.7.0, 로컬 pnpm 11.21.0과 로컬 MySQL/Redis를 기준으로 다음 gate를
통과했다. 이 기록은 live Catalog/감사 전용 Snapshot 스키마로 바꾸기 전 ORM 전환
검증이다. 현재 25개 Entity 스키마의 최종 gate로 재사용하지 않는다.

- TypeScript no-emit compile과 전체 `src/test` ESLint
- 일반 unit 7 suites, 17 tests
- MikroORM native ESM unit 9 suites, 23 tests
- 두 unit suite의 별도 LCOV 생성과 Sonar 경로 등록
- Nest stage build와 SWC production build
- SWC production 산출물의 MySQL/Redis 연결 및 `/graphql` 부팅
- 실행 중인 서버 대상 GraphQL e2e 1 suite, 3 tests
- 당시 MikroORM Entity 등록 목록 기준 schema dump `Schema is up-to-date`
- development/production Docker image build
- source, test, package, build 설정에서 Prisma 직접 참조와 직접 Kysely import 부재

당시 `test/integration`에는 테스트 파일이 없어 별도 integration suite를 실행하지 않았습니다. 현재는
실제 OpenSearch integration suite가 추가되어 별도 환경에서 실행합니다.

schema dump는 SQL을 출력하는 읽기 전용 확인만 실행했다. ORM 전환으로 적용할 DDL이 없었으므로
`schema:update --run`은 실행하지 않았다.

## Live Catalog 재설계 검증 기록

2026-08-14에는 사용자의 로컬 데이터 삭제 승인에 따라 MySQL `test` DB를
`schema:fresh --run --drop-db`로 다시 만들었다. 이는 위의 무DDL ORM 전환 기록과 별개의
의도적인 파괴적 Catalog 재설계다.

- 당시 MikroORM metadata 기준 24개 테이블 생성
- 기존 `ProductPublication`과 Snapshot 하위 테이블 제거 확인
- 당시 `item_option_values`의 2컬럼 PK와 소속 검증용 복합 FK 3개 확인
- 일반 unit 7 suites, 17 tests 통과
- MikroORM native ESM unit 10 suites, 24 tests 통과
- TypeScript no-emit compile과 변경 범위 ESLint 통과
- 재생성 직후 `schema:update --dump` 결과 `Schema is up-to-date`
- 전체 테이블이 빈 상태임을 확인

이 초기화 당시에는 seed, Product 변경 command, 감사 Snapshot 자동 생성, Outbox와 OpenSearch
동기화가 구현 범위 밖이었습니다. 이후 현재 구현에는 모두 포함됐으며 검증 결과는 이 과거 기록과
구분합니다.

이후 실제 MySQL hydration 검증에서 겹친 복합 FK 구조의 결함을 확인해 현재 `item_option_values`는
surrogate `BIGINT` PK, 단일 Item/옵션/값 FK, `(item_id, product_option_id)` unique와 `product_id` scalar로
바꿨습니다. Product/옵션 소속 일치는 Catalog writer validation이 보장합니다.

## 현재 운영 확장

현재 metadata는 검색 projection Outbox를 포함한 25개 Entity입니다. 초기 schema는
[`Migration20260904140344_initial_schema.ts`](../../src/infra/database/migrations/Migration20260904140344_initial_schema.ts)와
MikroORM snapshot으로 version 관리합니다. [`DatabaseSeeder`](../../src/infra/database/seeders/DatabaseSeeder.ts)는
환경 변수로 받은 자격 정보로 demo 회원, Catalog, revision별 Snapshot, 초기 재고 원장과 검색 Outbox를
멱등 생성합니다.

Catalog/Commerce/Search 확장은 ORM 전환 당시의 무DDL 검증과 별개입니다. 현재 gate는 migration 적용/검사,
seed 두 번 실행, 전체 unit/build, 실제 MySQL/OpenSearch integration과 reconciliation을 포함합니다. 실행
명령은 [로컬 실행과 운영 Runbook](../operations/local-runtime-runbook.md)에 고정합니다.

## 공식 참고 자료

- [MikroORM v7.1.11 release](https://github.com/mikro-orm/mikro-orm/releases/tag/v7.1.11)
- [v6에서 v7로 전환](https://mikro-orm.io/docs/upgrading-v6-to-v7)
- [NestJS integration](https://mikro-orm.io/docs/usage-with-nestjs)
- [Metadata providers](https://mikro-orm.io/docs/metadata-providers)
- [Decorators](https://mikro-orm.io/docs/using-decorators)
- [SWC integration](https://mikro-orm.io/docs/usage-with-transpilers)
- [RequestContext와 Identity Map](https://mikro-orm.io/docs/identity-map)
- [Transactions와 locking](https://mikro-orm.io/docs/transactions)
- [Read replicas](https://mikro-orm.io/docs/read-connections)
- [Kysely integration](https://mikro-orm.io/docs/kysely)
- [SchemaGenerator](https://mikro-orm.io/docs/schema-generator)
- [Migrations](https://mikro-orm.io/docs/migrations)
- [Seeding](https://mikro-orm.io/docs/seeding)
- [Logging](https://mikro-orm.io/docs/logging)
- [Dataloader](https://mikro-orm.io/docs/dataloaders)
