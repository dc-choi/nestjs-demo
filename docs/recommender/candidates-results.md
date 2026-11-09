# 추천 후보 조회 실행 결과

[사용자 이력 집계와 추천 후보 조회](candidates.md)의 절차로 2026-11-08에 측정한 결과입니다.
MySQL 8.0.31(buffer pool 128MB), OpenSearch 3.8.0에서 실행했습니다. 1차 검토 후 집계 테이블을 지우고 새 스키마로 다시 만들었습니다.

## 집계 `demo-20260401`

| 항목 | 값 |
|---|---:|
| cutoff / 인기 cutoff | 2026-04-01 00:00:00 UTC (90일 전체) / 같음 |
| 실행 시간 | 109.9초 (mysql client 경과, 생성 10:03:59Z, 검증 10:05:49Z) |
| 이력 있는 사용자 / 이벤트 없는 사용자 | 94,458 / 5,542 |
| 사용자-상품 pair | 5,475,304 |
| 검증된 구매 이벤트 / 구매 pair | 280,267 / 274,853 |
| 미검증 구매 이벤트 | 0 |
| 인기 상품(구매자 수 범위) | 10,000 (9~1,801명) |
| 분류 관심 / 태그 관심 행 | 1,098,565 / 4,648,978 |
| 사용한 이벤트 최대 시각 | 2026-03-31 23:49:09 |
| 검증 8종 위반 | 모두 0 |

검증된 구매 이벤트 수는 [거래 데이터](commerce-data.md)의 구매 연결 280,267건과 같습니다. 사용자당 구매 상품은 최대 34개입니다.
테이블 크기는 ANALYZE 후 information_schema 추정치로 태그 관심 238MB, 분류 관심 89MB, 구매 20MB, 인기 2MB입니다.
사전 측정에서 세션 `tmp_table_size` 기본 16MB는 pair 집계 45.6초, 태그 그룹 68.6초, 1GB는 30.6초, 31.7초라 세션 값만 올립니다.
서버 TempTable 최고 사용량은 RAM 1,024MB(상한), 디스크 1,024MB였으나 기동 이후 누적치라 실행 1회의 메모리는 아닙니다.

## 후보 조회 CLI

| 사용자 | 상위 분류(점수) | 관심 후보 | 인기 후보 | 구매 상품 | 인기 행 읽기 | OpenSearch 요청 |
|---|---|---|---|---:|---|---:|
| 4 | 청소용품 77, 침구 26, 신발 5 | 150 (전부 청소용품) | 50 (순위 1~50) | 3 | 1회 203행 | 2 |
| 10 | 마우스 22, 충전기 4, 키보드 2 | 150 (마우스 139, 키보드 11) | 50 (순위 1~50) | 1 | 1회 201행 | 2 |
| 1 | 상의 29, 신발 11, 과자 3 | 150 (상의 142, 신발 8) | 50 (순위 1~51) | 1 | 1회 201행 | 2 |
| 28 | 없음 (이벤트 0건) | 0 | 200 (순위 1~200) | 0 | 1회 200행 | 1 |

네 사용자 모두 후보 200개, 부족 없음, 색인에 없는 인기 상품 0개였습니다. 사용자 4와 10의 공통 후보는 인기 50개뿐입니다.
결과 JSON을 별도 스크립트로 대조했습니다. read Alias ids 조회에서 후보 200개가 모두 존재했고 slug, 분류, 태그, 최저가가
색인 문서와 같았습니다. MySQL에서 직접 읽은 구매 상품은 후보에 없었고, 관심 후보는 모두 상위 분류나 태그와 일치했으며
인기 후보는 순위 순서였습니다. 모든 후보의 `popularityRank`, `buyerCount`가 `rec_product_popularity`와 같았습니다.
활성 version 조회와 `--version demo-20260401` 조회의 출력은 같았습니다. CLI 1회 실행은 Node 기동과 DB 연결을 포함해 0.38~0.44초였습니다.

2차 검토 후 건너뛰기 진단을 인기 후보를 채운 시점까지만 세도록 바꾸고 사용자 4와 28을 다시 실행해 같은 대조를 통과했습니다.
후보 목록은 직전 실행과 같았습니다. 사용자 4의 `popularPurchasedSkipped`, `popularDuplicatesSkipped`는 0과 0이 됐습니다.
직전 값 1과 3은 인기 50개를 채운 뒤에 읽은 행까지 센 값이었습니다.

## 실패 조건

| 조건 | 결과 |
|---|---|
| `--version demo-missing` | exit 1, `Recommendation profile version demo-missing is missing or not validated` |
| OpenSearch 연결 실패(`OPENSEARCH_NODE_URL` 포트 9201) | exit 1, `Recommendation candidate search is unavailable: OpenSearch POST ... failed` |
| read Alias 대신 같은 Mapping의 빈 임시 인덱스(확인 후 삭제) | exit 1, `... returned 0 of 200 popular products ...` (사용자 4는 0 of 202) |
| `--user abc` | exit 1, `Recommendation user ID must be a positive integer` |
