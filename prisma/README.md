# Prisma 스키마 안내

이 프로젝트는 Prisma의 다중 파일 스키마를 사용합니다. 전역 설정은 `schema.prisma`, 도메인 모델은
`models` 아래에 있습니다. 상품 변경 이력의 목적과 전체 흐름은
[상품 변경 이력과 주문 Snapshot 설계](../docs/database/catalog-snapshots.md)를 먼저 읽으세요.

## 처음 읽는 순서

1. [`catalog.prisma`](models/catalog.prisma): 안정적인 상품 식별자, 분류, 미디어 자산
2. [`item.prisma`](models/item.prisma): 실제 SKU와 현재 재고
3. [`catalog-snapshot.prisma`](models/catalog-snapshot.prisma): 상품 변경 버전과 현재 발행 포인터
4. [`catalog-option.prisma`](models/catalog-option.prisma): 버전별 옵션과 SKU 조합
5. [`order.prisma`](models/order.prisma): 주문과 주문 시점 Snapshot
6. [`inventory.prisma`](models/inventory.prisma): 재고 예약과 변경 원장
7. [`payment.prisma`](models/payment.prisma): 결제 시도, 거래, Webhook
8. [`fulfillment.prisma`](models/fulfillment.prisma): 분할 배송
9. [`member.prisma`](models/member.prisma): 회원과 판매자

핵심 상품 흐름만 이해하려면 1번부터 5번까지만 읽어도 됩니다.

## 생성 파일

다음 파일은 Prisma generator 결과이므로 직접 수정하지 않습니다.

- `generated/client`: Prisma Client
- `generated/enums.ts`: Kysely에서 사용하는 enum
- `generated/types.ts`: Kysely DB 타입

스키마를 변경한 뒤에는 아래 명령으로 다시 생성합니다.

```sh
pnpm exec prisma format
pnpm exec prisma validate
pnpm exec prisma generate
```

이 저장소는 운영 migration 예제가 아니라 로컬 데모이므로 DB 반영에는 `prisma db push`를 사용합니다.
`db push`가 컬럼이나 테이블 삭제를 경고하면 대상이 로컬 개발 DB인지 확인하고, 필요한 데이터를 먼저
backfill한 다음 실행해야 합니다.

## 스키마 주석의 역할

스키마 주석은 해당 모델이나 제약이 필요한 이유만 설명합니다. 여러 모델에 걸친 흐름, 예시 데이터,
DB가 보장하지 못하는 서비스 규칙은 별도 설계 문서를 기준으로 합니다. 같은 내용을 여러 모델에
복사하지 않는 이유는 설명이 서로 다르게 낡는 것을 막기 위해서입니다.
