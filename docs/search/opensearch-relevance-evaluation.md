# OpenSearch 한국어 검색 품질 평가

상태: 3단계 계획, 구현 전

이 문서는 [상품 검색 구현 계획](opensearch-product-search.md)의 전체 재색인과 GraphQL 상품 검색 Query가 완성된
뒤 `standard` Analyzer와 Nori 후보를 같은 조건에서 비교하는 방법을 정합니다. Nori를 설치했다는 사실이
개선을 의미하지 않으며, 관련도 judgment와 회귀 수치로 채택 여부를 결정합니다.

## 선행 조건

- v001 전체 rebuild와 `searchProducts` Query가 동작함
- 검색 문서와 Query Builder 계약이 테스트로 고정됨
- `_analyze`로 실제 token을 확인할 수 있음
- 평가 실행마다 사용할 index build ID, image digest와 설정 commit을 기록할 수 있음

## 평가 자료

- 한국어 상품 문서 50개 이상
- 대표 query 20개 이상
- 각 query와 Product의 관련도 judgment
- exact 이름, 띄어쓰기, 조사, 복합어와 영문 혼용 query
- 결과가 없어야 하는 no-match query

50개 문서와 20개 query는 학습용 관련도 회귀 fixture이지 운영 latency 표본이 아닙니다. 이 fixture의
p95도 warm-up, 반복 횟수, cache 상태와 동시성을 고정한 로컬 비교값으로만 기록하고 운영 SLO로
확대하지 않습니다.

## 비교 절차

1. `catalog-products-v001-*`에 `catalog_text_index`와 `catalog_text_search`를 명시하고 두 구현 모두
   `standard`로 구성합니다.
2. 전체 문서를 새 v001 build에 색인하고 모든 평가 query의 결과를 저장합니다.
3. `_analyze`로 문서와 query token을 기록합니다.
4. `catalog-products-v002-*`에는 같은 Analyzer 이름으로 Nori 후보 설정을 적용합니다.
5. 같은 문서, query, judgment와 Query Builder로 v002 결과를 저장합니다.
6. 한 번에 하나의 Analyzer 또는 Query 변수만 바꿉니다.
7. 품질과 비용 기준을 통과한 경우에만 read/write Alias를 검증된 v002 build로 전환합니다.

Nori tokenizer, 사용자 사전처럼 index-time 분석을 바꾸면 기존 term은 변하지 않습니다. 설정을 바꿀
때마다 새 물리 인덱스를 만들고 전체 문서를 다시 색인하며, image digest, plugin과 사용자 사전 버전을
평가 결과에 함께 기록합니다.

## 측정값

| 지표                         | 확인하려는 것                                    |
| ---------------------------- | ------------------------------------------------ |
| fixed-K nDCG@10              | 상위 10개 결과의 관련도와 순서가 좋아졌는가      |
| Recall@10                    | 찾아야 할 관련 문서를 상위 10개에서 찾았는가     |
| underfill query rate@10      | 관련 문서가 충분한데 결과를 10개 채우지 못했는가 |
| zero-result rate             | 결과가 하나도 없는 query가 늘지 않았는가         |
| no-match false-positive rate | 없어야 할 결과를 억지로 만들지 않았는가          |
| query별 회귀                 | 평균 향상 뒤에 숨은 악화 query가 있는가          |
| 로컬 p95 latency             | 같은 조건에서 상대적인 응답 비용이 커졌는가      |
| 색인 시간/크기               | Analyzer 변경의 저장과 구축 비용이 얼마인가      |

## 통과 기준

- 같은 평가 bundle로 v001/v002 결과를 반복 재현할 수 있음
- 평균값뿐 아니라 좋아진 query와 악화된 query 목록이 남음
- Nori 채택 또는 기각 이유가 품질과 비용 수치로 설명됨
- Alias 전환 전후 GraphQL Query input/connection/error 계약이 바뀌지 않음
- 선택하지 않은 후보 설정과 실패 결과도 다음 비교를 위해 보존함

## 첫 단계에서 보류하는 실험

사용자 사전, 동의어, 품사 제거, edge n-gram과 Query boost 조정은 Nori 비교와 동시에 넣지 않습니다.
기준선이 생긴 뒤 각각 독립된 후보 인덱스로 비교해야 어떤 변경이 결과에 영향을 주었는지 알 수
있습니다.

## 참고 자료

- [Analyze API](https://docs.opensearch.org/latest/api-reference/indices-apis/perform-analyze/)
- [Nori 분석 플러그인](https://docs.opensearch.org/latest/analyzers/language-analyzers/korean/)
- [Nori plugin 설치](https://docs.opensearch.org/latest/install-and-configure/plugins/)
- [Alias API](https://docs.opensearch.org/latest/api-reference/alias/aliases-api/)
