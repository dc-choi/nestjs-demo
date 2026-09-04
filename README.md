# demo-nest

NestJS, MikroORM, MySQL, Redis를 사용한 데모 GraphQL 서버입니다.
상품 변경 이력, 주문 시점 Snapshot과 동시성 제어를 실습하기 위한 프로젝트입니다.

## 요구 사항

- Node.js 26.7.0 이상 27 미만
- pnpm 11.21.0
- MySQL
- Redis

## 실행

```sh
nvm use
pnpm install
pnpm dev
```

실행 전 [환경 변수 타입](src/global/config/env/env.config.ts)과
[시작 시 검증 스키마](src/global/config/env/env.validation.ts)를 충족하는 `.env`가 필요합니다.

`pnpm dev`는 DB 테이블을 생성하거나 변경하지 않습니다. 기존 로컬 MySQL/Redis를 `.env`의 접속값으로
사용하며, MySQL이 이미 3306에서 실행 중이면 Docker의 `db` 서비스를 시작하지 않습니다. Redis만 필요한
경우에는 선택적으로 다음 명령을 사용합니다.

```sh
docker compose -f deployment/compose/docker-compose.yaml up -d cache
```

Entity metadata와 로컬 DB의 차이는 다음 읽기 전용 명령으로 먼저 확인합니다.

```sh
pnpm database:schema:dump
```

Schema 변경은 검토 가능한 MikroORM migration으로 생성하고 적용합니다. 배포 산출물은
`pnpm database:migrate:prod`로 이미 생성된 migration만 적용합니다.

```sh
pnpm database:migration:create --name add-example
pnpm database:migration:check
pnpm database:migrate
pnpm database:migration:pending
```

환경 준비, seed, OpenSearch와 Webhook을 포함한 전체 절차는
[로컬 실행과 운영 Runbook](docs/operations/local-runtime-runbook.md)을 따릅니다.

## 검증

```sh
pnpm lint
pnpm unit
pnpm stage:build
pnpm prod:build
```

전용 `_integration` suffix MySQL DB와 로컬 OpenSearch를 준비한 경우에는 실제 인프라 통합 suite도 실행합니다.

```sh
pnpm integration:mysql
pnpm integration:opensearch
pnpm integration:search-pipeline
```

GraphQL e2e는 실행 중인 애플리케이션의 `/graphql`로 실제 요청을 보냅니다.

```sh
# terminal 1
pnpm dev

# terminal 2
pnpm e2e
```

다른 endpoint를 검증하려면 `GRAPHQL_URL` 환경 변수로 지정합니다.

## 설계 문서

- [데이터베이스 스키마 안내서](docs/database/schema.md)
- [애플리케이션 레이어 원칙](docs/architecture/layering.md)
- [GraphQL, Entity와 도메인 모델 경계](docs/architecture/model-boundaries.md)
- [MikroORM Entity 등록 목록](src/infra/database/entities.ts)
- [상품 변경 이력과 주문 Snapshot 설계](docs/database/catalog-snapshots.md)
- [GraphQL API 전환 설계](docs/graphql-api-migration.md)
- [MikroORM 전환 계획과 진행 기록](docs/database/mikroorm-migration-plan.md)
- [OpenSearch 상품 검색과 동기화](docs/search/opensearch-product-search.md)
- [로컬 실행과 운영 Runbook](docs/operations/local-runtime-runbook.md)

구현 구조를 변경하기 전에는 레이어 원칙과 모델 경계 문서를 먼저 확인합니다.

상품 도메인을 처음 본다면 `Product`, `Item`, `ProductSnapshot`, `OrderItemSnapshot`
순서로 읽는 것이 가장 빠릅니다. `Product`/`Item`과 하위 관계가 현재 판매 상태의
권위 있는 모델이고, `ProductSnapshot`은 일반 조회와 주문에 사용하지 않는 추가 전용 JSON
변경 이력입니다. `OrderItemSnapshot`은 이와 별개로 주문 접수 시점의 증거를 보존합니다.

## 구현 범위

- 공개 주문 API는 `OrderService`를 사용하며, 회원별 멱등성 키와 Item별 Redlock으로 경합을 줄입니다.
  Primary transaction에서는 Product와 Item을 ID 순서로 잠그고 Item별 요청 수량을 합산 검증한 뒤,
  15분 재고 예약, 재고 원장과 주문 Snapshot을 함께 저장합니다.
- 공개 주문은 live Product/Item에서 주문 가능 상태와 가격을 확정하고 별도
  `OrderItemSnapshot`을 저장합니다. 변경 이력 `ProductSnapshot`을 조회하거나 참조하지 않습니다.
- `Query.product`는 MySQL의 live `Product.revision`과 Item, 옵션, 분류, 태그를 GraphQL 그래프로
  반환합니다.
- Catalog GraphQL command는 Product/Item/옵션/분류/태그 변경, soft delete와 복원을 지원합니다.
  expected revision을 검사하고 live graph, revision, append-only `ProductSnapshot`, 검색 Outbox를 같은
  MySQL transaction에 저장합니다.
- 재고 조정/예약/소비/해제, 주문 단위 예약 만료와 bounded 만료 CLI, 주문 취소,
  결제 시도/매입/실패/환불/Webhook, 멱등 분할 배송의 포장/발송/완료/취소 lifecycle을 GraphQL과 HTTP
  경계에서 제공합니다. 전액 환불된 주문은 배송을 더 진행할 수 없습니다.
- `Query.searchProducts`는 OpenSearch의 strict Mapping, nested Item filter, PIT와 `search_after` 기반
  서명 cursor를 사용합니다. 애플리케이션 실행 중 Outbox worker가 증분 변경을 계속 전달하고,
  전체 rebuild, 수동 drain, reconciliation과 관련도 비교는 CLI로 실행합니다. 활성 rebuild는 Catalog
  쓰기를 차단한 유지보수 구간에서만 수행합니다.
- 미디어 이력은 DB에 보존하지만 전달 URL을 발급하는 계층이 아직 없으므로 공개 GraphQL 계약에서는
  제외합니다. 과거 revision 복원도 현재 live media 연결은 바꾸지 않습니다.
- 결제와 배송 구현은 provider 중립적인 상태/원장과 관리 command까지입니다. 실제 PG 승인 API,
  provider별 Webhook adapter, 택배사 송장 구매/추적 API는 연결하지 않습니다.

## 주요 진입점

- [MikroORM 연결, RequestContext와 Read Replica](src/infra/database/database.module.ts)
- [MikroORM 연결 설정과 라우팅 정책](src/infra/database/mikro-orm.config.ts)
- [애플리케이션 구성과 요청 컨텍스트](src/app.module.ts)
- [공개 주문 처리](src/api/order/application/order.service.ts)
- [canonical 상품 조회](src/api/catalog/application/product.service.ts)
- [Catalog 변경 command](src/api/catalog/application/product-command.service.ts)
- [검색 runtime 구성](src/infra/search/search.module.ts)
