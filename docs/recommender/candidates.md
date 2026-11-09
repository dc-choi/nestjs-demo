# 사용자 이력 집계와 추천 후보 조회

[실습 계획](product-recommender-plan.md)의 2단계 실행 절차와 규칙입니다. 측정값은 [실행 결과](candidates-results.md)에 있습니다.
대상 DB와 OpenSearch Alias는
[추천 실습 상품 색인](search-index.md)과 같습니다. 배치가 cutoff 이전 이력을 버전별 MySQL 테이블로 집계하고,
후보 조회는 그 결과와 OpenSearch만 읽습니다. 요청마다 `rec_events` 1,000만 행을 스캔하지 않습니다.
가중치(조회 1, 장바구니 3, 구매 5)와 정규화 방식은 실제 선호 강도가 아닌 실습용 초기 설정입니다.

## 실행 절차

저장소 루트에서 실행합니다. 집계 테이블은 `CREATE TABLE IF NOT EXISTS`로 만들며 migration이나 앱 테이블 변경은 없습니다.

```sh
MYSQL_BIN=/usr/local/mysql/bin/mysql
MYSQL_USER='로컬_DB_계정'
agg() { "$MYSQL_BIN" --host=127.0.0.1 --user="$MYSQL_USER" -p --default-character-set=utf8mb4 \
  demo_nest_recommender -e "SET $1; \. recommender/aggregate_profiles.sql"; }

# 시연용: 90일 전체를 집계하고 검증을 통과하면 활성화합니다.
agg "@profile_version='demo-20260401', @cutoff='2026-04-01 00:00:00', @activate=1"
# 평가용: 활성화하지 않고, 인기 통계는 학습 기간(2026-03-02 이전)만 씁니다.
agg "@profile_version='eval-validation-20260302', @cutoff='2026-03-02 00:00:00', @popularity_cutoff='2026-03-02 00:00:00'"
agg "@profile_version='eval-test-20260317', @cutoff='2026-03-17 00:00:00', @popularity_cutoff='2026-03-02 00:00:00'"

# 후보 조회. 실습 변수는 subshell 안에서만 설정합니다.
(
export MYSQL_DATABASE=demo_nest_recommender
export MYSQL_READ_REPLICA_DATABASE=demo_nest_recommender
export OPENSEARCH_ENABLED=true
export OPENSEARCH_NODE_URL=http://127.0.0.1:9200
export OPENSEARCH_READ_ALIAS=rec-catalog-products-read
export OPENSEARCH_WRITE_ALIAS=rec-catalog-products-write

pnpm prod:build
pnpm recommend:candidates --user 4                                     # 활성 version
pnpm recommend:candidates --user 4 --version eval-validation-20260302  # 검증된 비활성 version
)
```

- `@cutoff` 이전 이력으로 관심과 구매 제외를, `@popularity_cutoff` 이전의 검증된 구매로 인기를 만듭니다.
  `@popularity_cutoff`의 기본값은 `@cutoff`이며 더 늦으면 version을 만들지 않고 실패합니다.
- `@activate=1`일 때만 검증을 통과한 version을 활성화하고 이전 활성 version을 비활성으로 바꿉니다. 기본은 비활성입니다.
- 실행마다 새 mysql 세션을 씁니다. 같은 세션에서 다시 실행하면 이전에 SET한 `@activate` 같은 값이 남습니다.
- `-e` 안의 `SOURCE`는 줄 맨 앞에서만 인식되므로 `\.`를 씁니다.
- 클라이언트가 오류에서 멈추든 계속 실행하든 SQL 조건이 보호합니다. 검증은 8개 검사가 모두 위반 0건으로 기록된 경우에만
  성립하고, 활성화는 이번 실행이 만들고 검증한 version만 대상으로 합니다. 같은 이름으로 다시 실행하면 version 행 INSERT가
  실패하고 이후 문장은 어떤 version의 행도 쓰지 않습니다. 8.0.31 클라이언트에서 짧은 probe로 본 동작은 `-e`의 `\.`가
  `--force`에도 첫 오류에서 멈추고, 대화형 `source`와 stdin `--force`는 계속 실행하는 것이었습니다.
- 실패한 version은 검증 전 비활성 상태로 남고 후보 조회가 읽지 않습니다. 이름을 다시 쓰려면
  `DELETE FROM rec_profile_versions WHERE version = '<version>' AND NOT is_active;`로 지웁니다(하위 행은 FK cascade).
  요청의 여러 조회는 하나의 snapshot이 아니므로 아직 읽힐 수 있는 version은 지우지 않습니다.
- CLI는 HTTP 서버 없이 설정, 로깅, MySQL, OpenSearch만 띄우고 결과 JSON을 출력합니다.

## 집계 테이블

| 테이블 | 키 | 내용 |
|---|---|---|
| `rec_profile_versions` | `version` | 실행 ID, cutoff, 인기 cutoff, 생성/검증 시각, 활성 여부와 건수. 활성은 최대 1개(unique) |
| `rec_user_category_affinity` | version, user_id, category_id | 분류별 pair 점수 합 |
| `rec_user_tag_affinity` | version, user_id, tag | 태그별 pair 점수 합. OpenSearch keyword처럼 binary 비교 |
| `rec_user_purchased_products` | version, user_id, product_id | cutoff 이전의 검증된 구매. 후보 제외용 |
| `rec_product_popularity` | version, product_id | 인기 cutoff 이전 검증된 고유 구매자 수와 순위. (version, 순위)도 unique |
| `rec_profile_checks` | version, check_name | 통과한 검증 기록. 위반 수가 0이 아니면 CHECK로 INSERT 실패 |

하위 테이블은 모두 `rec_profile_versions`를 FK로 참조합니다. 사용자-상품 pair는 실행 중 임시 테이블로만 만듭니다.
version 이름은 영문 소문자, 숫자, `_`, `-`로 된 64자 이하입니다. CHECK가 인기 cutoff가 cutoff보다 늦은 행과
검증 전 활성화를 막습니다. 두 cutoff는 MySQL DATETIME(UTC)으로 해석합니다.

## 점수와 검증 규칙

- 사용자-상품 pair마다 cutoff 이전 이벤트 유형의 존재 여부로 조회 1, 장바구니 3, 구매 5점을 더합니다(최대 9점).
  같은 유형을 반복해도 점수는 늘지 않고, cutoff 시각과 같거나 늦은 이벤트는 쓰지 않습니다.
- 구매는 `rec_purchase_orders`로 연결된 거래가 `CAPTURE`, `SUCCEEDED`이고 이벤트와 `processed_at`이 모두
  cutoff 이전일 때만 셉니다. 다른 구매 이벤트는 점수에서 빼고 `unverified_purchase_events`에 건수를 남깁니다.
- 분류 관심은 활성이고 삭제되지 않은 분류만 셉니다(검색 Projector와 같은 기준). 태그 관심은 상품 태그 전체입니다.
- 상품 인기는 인기 cutoff 이전 검증된 구매의 고유 구매자 수이며 동점은 Product slug(`productKey`) 오름차순입니다.
  구매자가 없는 상품은 인기 행이 없습니다.

| 검사 | 종류 | 위반으로 세는 것 |
|---|---|---|
| `empty_profile` | 기본 | pair가 0건 |
| `no_popularity` | 기본 | 인기 행이 0건 |
| `purchased_mismatch` | 원본 재계산 | 구매 테이블과 원본 거래 테이블에서 다시 구한 검증된 구매 pair의 차이(양방향) |
| `invalid_pairs` | 내부 일관성 | 점수가 0이거나 마지막 이벤트가 cutoff 이후인 pair |
| `purchased_unscored` | 내부 일관성 | 구매 점수가 반영되지 않은 구매 pair |
| `category_affinity_total` | 내부 일관성 | 분류 관심 합과 상품별 pair 점수 합의 차이 |
| `tag_affinity_total` | 내부 일관성 | 태그 관심 합과 상품별 pair 점수 합의 차이 |
| `popularity_mismatch` | 내부 일관성 | 인기 행/구매자 수와 검증된 구매 이벤트의 차이, 끊긴 순위 |

내부 일관성 검사는 같은 실행의 임시 집계와 비교하므로 규칙 자체의 오류는 잡지 못합니다. 실패했거나 일부만 실행된 문장을
잡는 용도이며, 규칙은 손계산 fixture 테스트로 확인합니다.

## 후보 조회 규칙

구현은 [`RecommendationCandidateService`](../../src/api/recommendation/application/recommendation-candidate.service.ts)와
[`RecommendationProfileReader`](../../src/api/recommendation/infrastructure/recommendation-profile.reader.ts)입니다.
GraphQL/API는 4단계에서 연결하며 아직 앱 모듈에 등록하지 않았습니다.

- 프로필은 활성 또는 지정 version에서 상위 분류 5개, 태그 10개(점수 내림차순)와 구매 상품을 키로 읽습니다.
  version이 없거나 미검증이면 `PROFILE_UNAVAILABLE` 오류이고, 사용자 행이 없으면 오류가 아닌 이력 없음입니다.
- 관심 후보는 read Alias에서 `categoryIds`와 `tags.keyword` 조건 중 하나 이상 맞는 상품을 150개까지 찾습니다.
  각 조건은 `constant_score`이며 boost는 같은 종류의 최고 관심 대비 비율입니다. 따라서 `_score`는 일치한 비율의 합이고
  IDF가 섞이지 않습니다. 구매 상품은 `must_not ids`로 빼고, 정렬은 `_score` 내림차순 후 slug 오름차순입니다.
  `tags`는 분석된 text라 `brand-12` 같은 값이 term 조회로 맞지 않으므로 keyword 하위 필드를 씁니다.
- 인기 후보는 인기 순위대로 구매 상품과 관심 후보를 건너뛰며 전체 200개까지 채웁니다. 한 번에 읽는 행 수는
  남은 자리와 아직 건너뛸 수 있는 구매/관심 상품 수의 합이라 모두 검색 가능하면 한 번에 채워집니다.
  읽은 행은 read Alias ids 조회 한 번으로 존재(검색 노출)를 확인하고, 색인에 없는 상품이 있으면 다음 순위부터 더 읽습니다.
  요청당 인기 읽기는 3회, 1,000행까지입니다. 그래도 부족하면 부족 상태로 반환합니다.
- 확인한 인기 상품 중 색인에 있는 비율이 누적 절반 미만이면 `SEARCH_UNAVAILABLE`입니다. 인기 행은 cutoff 전에 팔린
  상품이라 같은 카탈로그면 거의 모두 검색되므로, 절반 미만이면 Alias가 다른 카탈로그나 빈 인덱스를 가리킨다고 봅니다.
  기준값 0.5는 실습용 판단입니다.
- 요청당 MySQL은 5~8회(version, 프로필 3, 인기 읽기 1~3, 관심 후보가 있으면 그 인기 1), OpenSearch는 최대 4회입니다.
  `allow_partial_search_results=false`이며 연결 실패, timed out, 실패 shard, 문서 계약 위반, 같은 상품이 두 번 나온
  응답(관심과 인기 모두), 구매 상품이 든 관심 응답은 `SEARCH_UNAVAILABLE` 오류입니다. 빈 결과로 바꾸지 않습니다.
- 후보에는 productId, slug, categoryIds, tags, minPrice, source(`INTEREST`/`POPULAR`), 출처 내 순위(`sourceRank`),
  OpenSearch 점수(인기는 relevance가 없어 null), version 인기표의 순위(`popularityRank`)와 구매자 수(`buyerCount`)가
  있습니다. `sourceRank`는 이 결과 안의 순서라 `popularityRank`와 다릅니다. 구매자가 없으면 null과 0입니다.
- 진단 값은 다음과 같습니다.
  - `purchasedExcluded`: 적용한 구매 제외 집합의 크기(관심 `must_not`과 인기 건너뛰기에 같이 씀)
  - `popularPurchasedSkipped`, `popularDuplicatesSkipped`: 인기 후보를 다 채우기 전에 구매/관심 상품이라 건너뛴 행 수
  - `popularNotSearchable`: 다 채우기 전에 만난 read Alias에 없는 인기 상품 수(Alias 비율 검사는 확인한 행 전체로 셈)
  - `popularityReads`, `popularityRowsRead`, `openSearchRequests`, `shortage`(200개 미만), `readAlias`와 프로필의 version, 두 cutoff

## 실행 결과

2026-11-08 측정값은 [실행 결과](candidates-results.md)에 있습니다. 시연 version `demo-20260401`은 109.9초에 만들어져
검증 8종을 통과했고, 사용자 4, 10, 1, 28이 각각 후보 200개를 받았습니다.

## 테스트

- `pnpm unit`: [후보 단위 테스트](../../test/unit/recommendation/recommendation-candidate.unit.test.ts) 26개를 포함해 327개 통과.
  질의 생성, 병합과 구매 제외, 인기 재조회와 읽기/행 상한, 채운 뒤 멈추는 진단, 부족과 빈 결과, 누적 Alias 비율(정확히 절반,
  두 페이지 통과/실패), 검색 오류, 반복 상품과 관심 응답 계약, 활성 version 전달과 프로필 version 처리를 확인합니다.
- `pnpm integration:opensearch`: 임시 인덱스에서 관심 점수, slug 동점, 구매 제외, 인기 존재 확인과 인기 순위를 검사하는
  [통합 테스트](../../test/integration/search/recommendation-candidates.opensearch.integration.test.ts) 포함 3개 통과.
- `MYSQL_INTEGRATION=1 python3 -m unittest recommender.tests.test_aggregate_profiles`: 테스트마다 임시 DB
  `rec_profile_fixture_*`를 만들고 지우는 3개 테스트입니다. 손계산 점수, cutoff 시각과 같은 이벤트, 실패/AUTHORIZE/미연결
  구매 제외, 비활성/삭제 분류 제외, 인기 동점, 인기 cutoff 경계(그 시각의 이벤트와 그 시각의 매입), 같은 이름 거부,
  기본 비활성과 `@activate=1`을 확인합니다. stdin과 `--force`로 실패 실행을 끝까지 돌려도 기존 활성 version이 유지되고,
  같은 이름 재실행은 검증된 version을 활성화하거나 미검증 version을 검증하지 못하며, 중간 실패한 version도 완성되지 않습니다.
  `MYSQL_USER`, `MYSQL_PWD`와 필요하면 `MYSQL_BIN`을 지정합니다. 변수 없이 전체 Python 테스트를 실행하면 건너뜁니다.
- `pnpm typecheck`, `pnpm lint`, `pnpm prod:build` 통과.

## 한계

- 평가용 version 두 개는 명령만 정리했고 본 규모로 만들지 않았습니다. 인기 cutoff와 비활성 기본값은 fixture로만 확인했습니다.
- 모든 상품이 가격대 태그(budget/standard/premium) 중 하나를 가지므로 이 태그 하나가 상품의 약 1/3과 맞습니다.
  이력 있는 사용자 94,458명 중 81,308명의 최상위 태그가 가격대 태그입니다.
  관심 후보가 최상위 분류에 몰리며(사용자 4는 150개 모두 청소용품) 다양성과 최종 순서는 3단계 이후 과제입니다.
- 후보 질의는 상위 분류 5개와 태그 10개만 쓰며 테이블에는 전체 관심이 있습니다. 환불은 인기와 구매에서 빼지 않습니다.
- 관심 질의는 150개를 한 번만 조회합니다. 인기 행이 바닥나 200개를 못 채워도 관심 후보를 더 찾지 않습니다.
- 집계는 실행 시점의 카탈로그(분류, 태그, slug)를 씁니다. 평가용 version은 6단계 카탈로그 변경 전에 만들고,
  평가 중에는 고정한 인덱스를 read Alias로 씁니다.
- Alias 불일치는 인기 상품 확인 비율로만 감지합니다. ID가 겹치는 다른 카탈로그가 절반 넘게 맞으면 찾지 못합니다.
- `rec_users`에 없는 사용자 ID도 이력 없음으로 처리해 인기 후보를 받습니다. 사용자 확인은 4단계 API에서 합니다.
- 집계 테이블이 아직 없으면 MySQL의 테이블 없음 오류가 그대로 납니다. API 오류 코드 연결은 4단계에서 정합니다.
- 재고와 판매 상태는 확인하지 않습니다(3단계). version마다 약 350MB가 늘어나므로 쓰지 않는 version은 지웁니다.
- MySQL을 쓰는 Python fixture 테스트는 CI에 연결하지 않았고 로컬에서 실행합니다.
- 요청 지연 p50/p95, 동시 요청과 후보 Recall@200은 측정하지 않았습니다(5단계).
