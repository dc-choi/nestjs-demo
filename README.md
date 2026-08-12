# nestjs-prisma-demo

NestJS, Prisma, MySQL, Redis를 사용한 데모 API 서버입니다.
여러 데이터 접근 방식과 주문 처리 흐름을 비교하기 위한 실험용 프로젝트입니다.

## 요구 사항

- Node.js 26.7.0
- pnpm
- MySQL
- Redis

## 실행

```sh
nvm use
pnpm install
pnpm dev
```

실행 전 [환경 변수 타입](src/global/config/env/env.config.ts)과 [시작 시 검증 스키마](src/app.module.ts)를 충족하는 `.env`가 필요합니다.

`pnpm dev`는 Prisma Client를 생성하지만 DB 테이블을 생성하거나 변경하지 않습니다. MySQL은 별도로
실행되어 있어야 하며, 로컬 데모 DB를 현재 스키마에 맞출 때만 다음 명령을 사용합니다.

```sh
pnpm exec prisma db push
```

데이터 삭제 경고가 나오면 자동으로 진행하지 말고 대상 DB와 backfill 필요 여부를 먼저 확인하세요.

## 검증

```sh
pnpm lint
pnpm unit
pnpm stage:build
pnpm prod:build
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

- [Prisma 스키마 읽는 순서](prisma/README.md)
- [상품 변경 이력과 주문 Snapshot 설계](docs/database/catalog-snapshots.md)
- [GraphQL API 전환 설계](docs/graphql-api-migration.md)

상품 도메인을 처음 본다면 `Product`, `Item`, `ProductSnapshot`, `ProductSnapshotItem`,
`ProductPublication`, `OrderItemSnapshot` 순서로 읽는 것이 가장 빠릅니다. 옵션, 미디어,
카테고리 모델은 이 핵심 흐름을 이해한 다음 확인해도 됩니다.

## 구현 범위

- 공개 주문 API는 `OrderService`를 사용하며, Item별 Redlock과 primary transaction의 조건부 재고
  차감을 함께 적용합니다.
- `OrderV1Service`는 Prisma 트랜잭션과 조건부 재고 차감, `OrderV2Service`는 Kysely의 Item 행 잠금과
  Prisma 쓰기를 비교하기 위한 학습용 구현입니다. 두 서비스는 공개 GraphQL API에 연결하지 않습니다.
- 상품 Snapshot 조회와 주문 Snapshot 저장은 공개 주문과 두 비교용 구현에 모두 반영되어 있습니다.
- `Query.product`는 MySQL에서 현재 공개된 Product Revision과 Item, 옵션, 분류, 태그를 GraphQL 그래프로
  반환합니다.
- 미디어 이력은 DB에 보존하지만 전달 URL을 발급하는 계층이 아직 없으므로 공개 GraphQL 계약에서는
  제외합니다.
- 상품 작성/발행 명령, 결제, 배송, 재고 예약/원장은 스키마가 있지만 전체 흐름은 아직 구현되지 않았습니다.

## 주요 진입점

- [Prisma 클라이언트와 Read Replica](prisma/repository.ts)
- [애플리케이션 구성과 요청 컨텍스트](src/app.module.ts)
- [공개 주문 처리](src/api/order/application/order.service.ts)
- [canonical 상품 조회](src/api/catalog/infrastructure/prisma-product.reader.ts)
- [주문 처리 비교 구현 v1](src/api/order/application/order-v1.service.ts)
- [주문 처리 비교 구현 v2](src/api/order/application/order-v2.service.ts)
