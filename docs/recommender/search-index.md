# 추천 실습 상품 색인

[실습 계획](product-recommender-plan.md)의 0~1단계 실행 절차와 결과입니다. 기존 `.env`와 앱 DB(`test`),
앱 기본 Alias(`catalog-products-read/write`)는 바꾸지 않습니다. 실습 값은 셸 환경 변수로만 덮어씁니다.
`@nestjs/config`는 이미 설정된 process 환경 변수를 `.env`보다 우선합니다.

## 대상과 데이터 버전

| 항목 | 값 |
|---|---|
| MySQL DB | `demo_nest_recommender` (host/port는 `.env`의 `localhost:3306`) |
| 기본 데이터 | profile `main`, seed `20261103`, 생성기 v2, SQL sha256 `fc657c20…3d38c1` |
| 거래 데이터 | seed `20261103`, 생성기 v1, SQL sha256 `e33ab027…32048d` |
| OpenSearch | `http://127.0.0.1:9200`, 3.8.0, `analysis-nori`, 단일 노드 |
| read / write Alias | `rec-catalog-products-read` / `rec-catalog-products-write` |
| 평가 Alias | `rec-catalog-products-eval` |

두 데이터의 DB 완료 표시(`rec_dataset`, `rec_commerce_dataset`의 `is_complete`)는 1입니다.
이 DB는 SQL fixture로 만들었고 migration 이력이 없으므로 migration, seed와 schema update를 실행하지 않습니다.
`catalog_maintenance`, `search_projection_outbox` 테이블은 fixture에 포함돼 있습니다.

## 실행 절차

실습 변수는 subshell 안에서만 설정합니다. 같은 셸에 남으면 이후 `pnpm database:migrate`, `database:seed`나
`pnpm dev`가 fixture DB를 대상으로 실행됩니다. 이 DB에는 `database:*` script를 실행하지 않습니다.

```sh
docker compose -f deployment/opensearch/docker-compose.yaml up -d

# 저장소의 .nvmrc(Node 26.7.0)를 사용합니다.
(
export MYSQL_DATABASE=demo_nest_recommender
export MYSQL_READ_REPLICA_DATABASE=demo_nest_recommender
export OPENSEARCH_ENABLED=true
export OPENSEARCH_NODE_URL=http://127.0.0.1:9200
export OPENSEARCH_READ_ALIAS=rec-catalog-products-read
export OPENSEARCH_WRITE_ALIAS=rec-catalog-products-write

pnpm prod:build

# 1) Alias를 바꾸지 않는 평가 build
pnpm search:rebuild --build-id rec-eval-001 --batch-size 500 \
  --no-activate --evaluation-alias rec-catalog-products-eval

# 2) 검사 통과 후 전용 read/write Alias 활성화
pnpm search:rebuild --build-id rec-active-001 --batch-size 500

pnpm search:outbox:drain
pnpm search:reconcile                                          # 보고 전용, --repair 없음
OPENSEARCH_READ_ALIAS=rec-catalog-products-eval pnpm search:reconcile
)
```

같은 build ID와 analyzer의 인덱스가 남아 있으면 생성이 실패하므로 재실행할 때는 새 build ID를 사용합니다.
활성 rebuild가 실패하면 Catalog 유지보수 차단이 남습니다. 이때는 `pnpm search:rebuild --resume-maintenance --build-id <새_ID>`로
재개합니다([Runbook 7절](../operations/local-runtime-runbook.md)).

GraphQL 검색을 확인할 때는 위 환경 변수에 `OPENSEARCH_CURSOR_SECRET`(32자 이상 임의 값)과 겹치지 않는 `SERVER_PORT`를 더해
`node dist/src/main.js`로 앱을 실행합니다.

결과 재확인용 읽기 전용 명령입니다.

```sh
curl -s http://127.0.0.1:9200/rec-catalog-products-read/_count
curl -s 'http://127.0.0.1:9200/_cat/aliases?v'
# .env의 MYSQL_USER와 MYSQL_PWD(MYSQL_PASSWORD 값)를 환경 변수로 지정합니다.
python3 recommender/check_search_index.py rec-catalog-products-read
```

## 2026-11-08 실행 결과

| 검사 | 결과 |
|---|---|
| MySQL 검색 대상(ACTIVE, 미삭제 Product 중 미삭제 ALLOW Item 보유) | 10,000 |
| 평가 build `catalog-products-v001-rec-eval-001` | 10,000건, 내장 count/첫 문서 source/query 검증 통과 |
| 활성 build `catalog-products-v001-rec-active-001` | 10,000건, read/write Alias 전환, 유지보수 잠금 해제 |
| read Alias root `_count` | 10,000 |
| Outbox drain | claimed 0 |
| reconciliation(보고 전용) | 활성 read Alias, 평가 Alias 모두 DB 10,000/인덱스 10,000, differenceCount 0 |
| 표본 201개(ID 1부터 50 간격과 10000) `check_search_index.py` 대조 | slug/이름/분류/태그/최저/최고가/Item ID 불일치 0 (평가, 활성 인덱스 모두) |

기존 GraphQL `searchProducts`는 커서로 끝까지 읽어 중복 없는 Product 수를 MySQL과 비교했습니다.

| 입력 | GraphQL | MySQL |
|---|---:|---:|
| `categorySlug: synth-category-5` | 600 | 600 |
| `categorySlug: synth-group-1` (하위 분류 포함) | 3,000 | 3,000 |
| `query: 키보드` | 600 | 이름 포함 600 |
| `sku: SYNTH-SKU-000001` | 1 | 1 |

`/health/search`는 `reachable: true`, cluster `green`이었습니다. 검색 확인용 앱은 확인 후 종료했습니다.
전체 source 비교는 reconciliation 결과입니다. 평가 build 자체의 내장 검사는 첫 문서만 source를 비교합니다.
분석기는 `standard`만 사용했고 Nori 비교는 하지 않았습니다. OpenSearch 컨테이너는 계속 실행 중인 상태로 두었습니다.
