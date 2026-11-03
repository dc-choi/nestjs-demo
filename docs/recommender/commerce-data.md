# 주문과 결제 더미 데이터

기존 `rec_events`의 구매를 실제 애플리케이션 스키마의 주문 품목과 결제 거래에 연결합니다.
모든 회원, 상품과 거래는 합성 자료입니다. PG 요청, 이메일 발송과 실제 금전 이동은 없습니다.
기존 애플리케이션 DB 대신 추천 실습 전용 DB를 사용합니다.

## 생성과 적재

먼저 [기본 SQL](local-sql.md)을 생성하고 새 DB에 적재합니다. 그 다음 같은 생성물을 입력으로 사용합니다.
Python 표준 라이브러리만 필요합니다.

```sh
python3 -m recommender.generate_commerce \
  --dataset recommender/output/main \
  --output recommender/output/commerce-main
```

`commerce.sql.gz`, `manifest.json`, `summary.json`을 출력합니다. 출력 경로가 있으면 덮어쓰지 않습니다.
원본 생성기 버전과 소스, SQL checksum을 확인하고 같은 seed로 행동을 재생합니다.
기존 구매 이벤트의 ID와 시각을 유지하며 `rec_events`를 수정하지 않습니다.

```sh
MYSQL_BIN=/usr/local/mysql/bin/mysql
MYSQL_USER='로컬_DB_계정'
set -o pipefail
gzip -dc recommender/output/commerce-main/commerce.sql.gz | \
  "$MYSQL_BIN" --host=127.0.0.1 --port=3306 --user="$MYSQL_USER" -p \
  --default-character-set=utf8mb4 demo_nest_recommender

"$MYSQL_BIN" --host=127.0.0.1 --port=3306 --user="$MYSQL_USER" -p \
  --default-character-set=utf8mb4 demo_nest_recommender < recommender/inspect_commerce.sql
```

대상은 일치하는 `rec_dataset`, `rec_users`, `rec_products`, `rec_events`만 있는 전용 DB입니다.
원본 데이터 버전과 완료 상태를 검사한 뒤 애플리케이션 테이블을 생성합니다. 기존 테이블은 삭제하거나
덮어쓰지 않습니다. `--force`로 오류를 무시하지 않습니다. 중간 실패 시 앞선 COMMIT은 남을 수 있으므로
기존 DB에 재실행하지 말고 새 DB에 기본 SQL부터 적재합니다.

현재 저장소의 migration `up()` SQL을 사용하므로 애플리케이션과 같은 테이블 구조를 만듭니다.
앱을 이 DB에 연결하거나 migration/schema update를 실행하는 절차는 포함하지 않습니다.
SQL 적재는 서비스 호출을 거치지 않으며 API, 검색 색인과 실제 PG 연동을 검증한 결과가 아닙니다.
주문 품목 snapshot은 생성하지만 카탈로그 복원용 `product_snapshots`와 검색 outbox는 비워 둡니다.

## 연결 구조

| 테이블 | 생성 내용 |
|---|---|
| `members` | 합성 고객과 판매자. 고객 ID는 `rec_users.user_id`와 일치 |
| `products`, `items` | 상품당 기본 SKU 하나. 두 ID 모두 `rec_products.product_id`와 일치 |
| `categories`, `product_categories`, `product_tags` | 원본 상품 분류와 태그 |
| `orders`, `order_items`, `order_item_snapshots` | 주문, 수량과 당시 가격/상품명 증거 |
| `payment_attempts`, `payment_transactions` | 결제 시도, 성공한 매입, 실패와 환불 거래 |
| `order_status_histories` | 주문 생성, 확정 또는 취소 이력 |
| `inventory_reservations`, `inventory_movements` | 재고 예약, 소비, 취소 해제와 변경 원장 |
| `rec_checkout_orders` | 장바구니 이벤트와 주문 연결 |
| `rec_purchase_orders` | 구매 이벤트, 주문 품목과 성공한 매입 거래의 일대일 연결 |
| `rec_commerce_dataset` | 원본 식별 정보, 주문/구매 수와 적재 완료 표시 |

원본 구매 시각을 그대로 보존하기 위해 주문당 한 품목을 생성합니다. 수량과 가격은 달라질 수 있습니다.
여러 품목 주문, 옵션 조합, 배송과 품절 시나리오는 이번 범위에 포함하지 않습니다.

## 시나리오와 상태 규칙

아래 비율은 실습용 난수 확률이며 실제 쇼핑몰 통계가 아닙니다.

- 기존 구매는 전부 성공한 `CAPTURE` 거래와 연결합니다. 일부는 실패한 시도 뒤 새 시도로 결제합니다.
- 구매 주문의 8%는 실패 후 재시도합니다. 구매하지 않은 장바구니의 10%를 추가 주문으로 만들고,
  그 안에서 결제 실패 후 취소와 사용자 취소를 각각 50% 확률로 선택합니다.
- 구매하지 않은 장바구니 일부에는 결제 실패 후 취소 또는 사용자 취소 주문을 추가합니다.
  이 주문은 구매 이벤트를 만들지 않습니다.
- 결제 성공 일부에는 부분 환불 또는 전액 환불 거래를 추가합니다. 환불 시각이 관측 종료 이후라면
  해당 환불은 기록하지 않습니다. 관측 종료까지 환불이 없다는 사실이 영구 미환불을 뜻하지 않습니다.
  부분 환불 4%, 전액 환불 2% 확률이며 지연은 결제 후 1시간부터 7일까지입니다.
- 주문 생성은 장바구니 이후이며 결제는 15분 재고 예약 만료 전에 일어납니다.
  장바구니를 담은 시각과 주문 시각은 서로 다릅니다.
- 주문 총액은 품목 단가와 수량으로 계산하고 결제 요청액/매입액과 일치시킵니다.
  환불 합계는 매입액을 넘지 않습니다.
- 재고는 주문 예약 때 차감합니다. 결제 시 예약을 `CONSUMED`로 바꾸며 재차 차감하지 않습니다.
  미결제 주문을 취소하면 예약을 해제하고 재고를 돌려놓습니다.
- 현재 서비스와 동일하게 환불만으로 주문 취소나 재고 복원을 수행하지 않습니다.
  환불된 주문도 `CONFIRMED`, 예약은 `CONSUMED`로 남습니다.
- 초기 입고량은 전체 생성량을 수용하도록 크게 잡습니다. 실제 수요나 재고 운영을 모사한 값이 아닙니다.

## 추천 학습에서 읽는 방법

`purchase`는 매입 성공 시점의 사실입니다. 나중에 환불돼도 원본 구매 이벤트를 지우지 않습니다.
구매 여부와 순결제 금액은 서로 다른 학습 목표입니다.

기존 평가 계약은 매입 성공한 고유 사용자/상품 쌍을 사용합니다. 환불 제외 실험을 추가한다면 관측 시점과
환불 대기 기간을 따로 정합니다. 과거 학습 자료에서 최종 `payment_attempts.status`를 읽으면 미래 환불을
미리 알게 됩니다. 해당 cutoff 이전의 `payment_transactions.processed_at`만 집계해야 합니다.
[`inspect_commerce.sql`](../../recommender/inspect_commerce.sql)에 cutoff 기준 금액 집계 예제가 있습니다.

## 검증

```sh
python3 -m unittest discover -s recommender/tests -v
```

단위 테스트와 별도로 실제 MySQL에 적재합니다. 완료 표시는 `is_complete=1`이어야 하며
`inspect_commerce.sql`의 모든 `invalid_*` 값은 0이어야 합니다. 구매 누락, 금액, 시각, snapshot,
상태 이력, 재고 최종 수량과 시점별 원장 잔액을 확인합니다.

생성물의 `mysql-verification.json`, `mysql-inspection.tsv`는 로컬 적재 검증 결과입니다.
합성 자료 검증은 실제 고객의 추천 품질이나 매출 개선을 증명하지 않습니다.

## 본 규모 생성 기록

2026-11-03, Python 3.9.6, seed `20261103`, 거래 생성기 버전 1로 생성했습니다.
원본은 행동 생성기 버전 2의 `main` 데이터이며 행동 10,000,040건을 유지합니다.

| 항목 | 건수 |
|---|---:|
| 주문과 주문 품목 | 각각 347,720 |
| 구매 연결과 성공 매입 | 각각 280,267 |
| 결제 시도 | 370,154 |
| 결제 거래 | 352,272 |
| 결제 실패 후 취소 주문 | 33,681 |
| 사용자 취소 주문 | 33,772 |
| 실패 후 재시도하여 구매한 주문 | 22,434 |
| 부분 환불 | 10,613 |
| 전액 환불 | 5,277 |

환불 예정 시각이 관측 종료 이후인 767건은 거래로 기록하지 않았습니다.
생성 시간은 581.180초, 압축 SQL은 100,913,753 bytes입니다.
압축 SQL SHA-256은 `e33ab02724049247511feadae4a3b188504152c0d3f7b0b38c9d4eb3a932048d`입니다.

로컬 MySQL 8.0.31의 `demo_nest_recommender`에 적재를 완료했습니다. 적재와 검사에 137.665초가 걸렸고,
19개 `invalid_*` 검사의 위반 건수는 모두 0입니다. 원본 데이터 메타데이터는 유지됐으며 구매 280,267건이
누락 없이 성공 매입 거래에 연결됐습니다. 자동 커밋을 끈 세션에서도 재접속 뒤 완료 표시와 건수를 확인했습니다.

전체 Python 테스트 17개와 독립 코드 검토를 통과했습니다. 별도 smoke DB에서도 적재를 확인했으며,
원본 완료 표시가 없는 DB에는 CHECK 제약 위반으로 애플리케이션 테이블 생성 전에 적재가 중단됐습니다.
API 실행, 검색 색인, 배송과 실제 PG 호출은 검증하지 않았습니다.
