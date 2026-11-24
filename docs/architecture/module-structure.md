# 모듈 폴더 구조와 도메인 간 통신 규칙

이 문서는 `src/` 폴더 배치와 도메인 모듈 사이의 의존 규칙을 정합니다. 레이어 안의 호출 관계와
repository 원칙은 [애플리케이션 레이어 원칙](layering.md), 타입과 Entity 경계는
[GraphQL, Entity와 도메인 모델 경계](model-boundaries.md)를 따릅니다.

## 최상위 구조

```text
src/
  api/{domain}/        도메인 모듈. 기능 코드는 모두 여기에 둔다.
  infra/{tech}/        여러 도메인이 공유하는 기술 연결(database, redis, mail, opensearch)
  global/              도메인이 없는 횡단 관심사(config, logger, graphql, jwt, 공통 util)
  cli/                 운영 CLI 진입점. Nest application context만 만들고 로직은 도메인 Service를 호출한다.
  *.module.ts, main.ts 앱 조립(HTTP 앱, maintenance 앱, search maintenance 앱)
```

- 특정 도메인만 쓰는 코드는 `infra/`나 `global/`에 두지 않고 그 도메인 모듈 안에 둡니다.
- `infra/`는 기술 연결, 설정, 외부 발송 handler(mail)만 담고 도메인 규칙과 Entity를 담지 않습니다.
  예외: `infra/database/seeders/`는 개발용 데이터 적재를 위해 도메인 Service를 직접 조립합니다.
- `global/`에는 여러 모듈이 쓰는 횡단 관심사만 둡니다. `global/jwt`는 모든 Resolver가 쓰는 guard,
  decorator, JWT 검증 strategy, 공유 claims 타입(`payload/`)과 `Unauthorized` 에러를 담습니다. 토큰 발급과 갱신(`TokenProvider`)은 `auth`가 소유합니다.

## 도메인 모듈 구조

```text
src/api/{domain}/
  {domain}.module.ts   Nest 모듈. provider 등록, 다른 모듈 import, port 바인딩
  presentation/        Resolver, Controller, GraphQL Input/ObjectType/enum 등록, mapper
  application/         Service, Worker, command/result 타입, port, 유스케이스 에러
  domain/              도메인 규칙, 값 객체, 도메인 에러, factory
    entity/            MikroORM Entity와 Entity column이 쓰는 enum, embedded 타입
  infrastructure/      이 도메인 전용 외부 시스템 adapter, raw SQL reader, 서명 검증기
```

- 필요 없는 레이어 폴더는 만들지 않습니다. 예를 들어 `auth`에는 `domain/`이 없습니다.
- Entity는 항상 `domain/entity/`에 둡니다. Entity가 도메인 행동을 소유하므로 domain 레이어의 일부입니다.
- 에러는 의미로 나눕니다. 도메인 개념에 대한 에러(없음, 중복, 충돌, 권한, 불변식 위반)는 `domain/`에,
  유스케이스와 기술 조건(인증 실패, 요청 제한, KDF 포화, 외부 시스템 불가, cursor 만료)과 port 계약 에러는
  `application/`에 둡니다. 던지는 코드가 Service여도 도메인 개념 에러는 `domain/`에 둡니다.
  `domain/`이 없는 모듈(`auth`)은 `application/`에 둡니다.

현재 도메인 모듈은 다음과 같습니다.

| 모듈             | 역할                                                                   |
| ---------------- | ---------------------------------------------------------------------- |
| `member`         | 회원 계정, 역할, 비밀번호 hash                                         |
| `auth`           | 로그인, 토큰 발급과 갱신(Redis), 로그인 요청 제한                      |
| `catalog`        | 상품, Item, 옵션, 카테고리, 상품 변경 이력                             |
| `inventory`      | 재고 예약과 재고 원장                                                  |
| `order`          | 주문 생성, 취소, 만료                                                  |
| `payment`        | 결제 시도, 매입, 환불, webhook                                         |
| `fulfillment`    | 포장과 배송                                                            |
| `search`         | Catalog의 OpenSearch read model, outbox 동기화, 재색인, 검색 Query     |
| `recommendation` | 집계된 rec_* 테이블과 검색 index로 추천 후보 조회(GraphQL API는 이후) |

## 레이어 의존 방향

```text
presentation -> application -> domain
                application -> infrastructure -> domain
```

`presentation/`은 `infrastructure/`를 쓰지 않습니다. 구현을 주입받아야 하면 `application/*.port.ts`의 interface와
DI 토큰을 씁니다. 예: `payment` webhook Controller는 `PAYMENT_WEBHOOK_SIGNATURE_VERIFIER` port를 주입받습니다.

- `domain/`은 자기 모듈의 `domain/`, 다른 모듈의 `domain/`(Entity, enum, 순수 상수와 규칙),
  `global/common/utils`만 import합니다. Nest provider, ConfigService, client, EntityManager, repository를
  import하지 않습니다. 영속화(`persist`)는 `application/`에서 합니다.
- `application/`은 `presentation/`을 import하지 않습니다.
- `application/`은 같은 모듈의 `infrastructure/` 구체 class를 직접 주입받을 수 있습니다. 구현이 하나뿐인
  기술 의존을 숨기려고 새 port를 만들지 않습니다([layering.md](layering.md)). 기존 `PRODUCT_SEARCH_PORT`는
  구현이 OpenSearch adapter 하나인 예외로 남아 있습니다.
- `infrastructure/`는 같은 모듈의 `application/` port를 구현하고, `application/` 에러와 `domain/` 타입을 사용합니다.

## 자동 검사

`eslint.config.js`의 `no-restricted-imports`가 다음을 `pnpm lint`에서 막습니다. `src/api`의 모듈 목록은 폴더에서
읽으므로 새 모듈도 자동으로 포함됩니다.

- 다른 모듈의 `infrastructure/` import(모든 레이어와 `*.module.ts`)
- `domain/`에서 `application/`, `presentation/`, `infrastructure/`, `global/common/utils` 외의 `global/`, `infra/`,
  `@nestjs/common`, `@nestjs/config`, MikroORM `EntityManager`/`EntityRepository`/`MikroORM` import
- `application/`과 `infrastructure/`에서 `presentation/` import
- `presentation/`에서 `infrastructure/` import

- 레이어 폴더 밖으로 나가는 `../../` 상대 import와 모듈 루트 파일의 `../` import. 규칙은 import 문자열을 경로로
  풀지 않으므로, 레이어 밖은 `~/` alias로 써야 위 검사가 대상을 봅니다.

동적 `import()`, Entity 필드 소유권, port 바인딩 위치, 모듈 순환은 이 규칙으로 판단할 수 없어 리뷰로 확인합니다.

## 도메인 간 통신 규칙

다른 도메인 모듈의 코드는 아래 여섯 경로로만 사용합니다.

1. **Domain 참조**: 다른 모듈의 `domain/`(Entity, enum, 순수 상수)은 ORM relation, 조회 대상, port
   시그니처와 검증에 사용할 수 있습니다. 다른 모듈 Entity의 필드는 그 필드를 소유한 모듈만 바꿉니다.
   예: `ItemEntity.stock`은 `catalog` Entity에 있지만 `inventory`가 소유하고 변경합니다. ORM 양방향
   relation collection 동기화는 예외입니다.
2. **공개 Service 호출(기본)**: 제공 모듈이 `exports`로 공개한 application Service를 소비 모듈이 Nest
   `imports`로 가져와 주입합니다. 그 Service의 result 타입과 에러 class도 import할 수 있습니다.
   예: `auth`가 `member`의 `PasswordService`를 사용합니다.
3. **Port(의존 역전)**: 다음 중 하나일 때 소비 모듈이 `application/*.port.ts`에 필요한 연산만 정의하고,
   소비 모듈의 `*.module.ts`에서 제공 모듈 구현에 바인딩합니다.
   - 직접 의존하면 모듈 순환이 생기거나 의존 방향이 뒤집힐 때.
     예: `catalog`가 `CATALOG_WRITE_EFFECTS`를 정의하고 `search`가 구현합니다. `search`는 `catalog`를 읽는
     하위 read model이므로 `catalog`가 `search` Service를 알면 안 됩니다.
   - 호출자 transaction에 참여하는 계약을 소비자 쪽에서 고정해야 할 때.
     예: `order`와 `payment`의 inventory port가 `InventoryService`에 `useExisting`으로 바인딩됩니다.
4. **도메인 이벤트**: 결과를 기다리지 않는 후속 처리는 발행 모듈의 `application/event/*.event.ts`와
   `@nestjs/cqrs` EventBus를 사용하고, handler는 반응하는 쪽에 둡니다. 예: `member`의 `SignupEvent`를 `infra/mail` handler가 받아 메일을 보냅니다.
5. **GraphQL 타입 재사용**: GraphQL schema는 하나이므로 `presentation/`은 다른 모듈의 GraphQL
   Input/ObjectType/enum과 mapper를 재사용할 수 있습니다. Resolver와 Controller는 재사용하지 않습니다.
6. **Read model 계약**: Read model을 소비하는 모듈은 제공 모듈의 index alias와 document 타입을 읽기
   전용으로 사용합니다. 예: `recommendation`은 `search`가 소유한 catalog read alias를 query하고
   `ProductSearchDocument` field를 사용합니다. 소비 모듈은 field 이름을 제공 모듈의 document 타입으로 고정해
   rename이 typecheck에서 실패하게 합니다. Index alias와 mapping(예: `tags.keyword`)의 의미 변경은 함께 고칩니다.

다음은 금지합니다.

- 다른 모듈의 `infrastructure/` import. 공유가 필요한 기술 연결은 `src/infra/`로 올립니다.
  예: `search`와 `recommendation`이 함께 쓰는 OpenSearch client는 `infra/opensearch/OpenSearchModule`입니다.
- 다른 모듈이 `exports`하지 않은 provider 주입, 다른 모듈의 Worker나 내부 helper 직접 호출.
- 다른 모듈의 `application/` port 구현체를 소비 모듈 코드 안에서 직접 import하는 것. 바인딩은 `*.module.ts`에서만 합니다.
- 모듈 간 순환 의존. 순환이 생기면 port나 이벤트로 끊습니다.

Read model 모듈(`search`, `recommendation`)은 다른 도메인 테이블을 raw SQL이나 EntityManager로 읽을 수
있지만 쓰지 않습니다. Catalog 변경은 Catalog transaction 안에서 port로 outbox에 기록하고, 이후 동기화는
`search`가 소유합니다.

## 현재 모듈 의존 관계

```text
auth           -> member (PasswordService)
order          -> inventory (ORDER_INVENTORY_PORT -> InventoryService)
payment        -> inventory (PAYMENT_INVENTORY_PORT -> InventoryService)
catalog        -> search (CATALOG_WRITE_EFFECTS -> catalogSearchWriteEffects, 바인딩만)
member         ~> infra/mail (SignupEvent)
search         -> infra/opensearch, Catalog 테이블 읽기
recommendation -> infra/opensearch, rec_* 집계 테이블 읽기
recommendation => search (catalog read alias, ProductSearchDocument field)
```

`->`는 Nest 모듈 의존 또는 port 바인딩, `~>`는 이벤트, `=>`는 Nest 모듈 의존 없이 document 타입으로만 묶인 read model 계약입니다.
Entity 참조는 생략했습니다.
