# OpenSearch GraphQL 상품 검색

상태: 검색 Query, rebuild, Outbox relay, reconciliation과 관련도 평가 구현

이 문서는 상품 카탈로그를 OpenSearch로 검색하는 현재 구조와 검증 기준을 정리합니다. 상품의
변경 이력과 주문 시점 값이 왜 분리되어 있는지는
[상품 변경 이력과 주문 Snapshot 설계](../database/catalog-snapshots.md)를 기준으로 합니다.

## 구현 목표

이 프로젝트는 OpenSearch를 단순 연결 예제로 끝내지 않고 다음 흐름을 구현합니다.

1. MySQL의 현재 검색 노출 대상 상품을 검색 문서로 변환한다.
2. 명시적인 Mapping과 Alias가 있는 인덱스를 만든다.
3. 상품명 전문 검색, 필터, 정렬, 커서 페이지네이션을 GraphQL Query로 제공한다.
4. 명시적인 `standard` Analyzer와 한국어 Nori Analyzer의 품질을 같은 데이터로 비교한다.
5. 상품 변경과 검색 색인을 비동기로 연결한다.
6. 누락, 순서 역전, 부분 실패, 재색인과 Alias 전환을 재현하고 복구한다.

벡터 검색, 하이브리드 검색과 LLM 기능은 이번 학습 범위에서 제외합니다.

## 가장 중요한 경계

```text
MySQL
Product + Item + live catalog relations
  |
  | 현재 상태 조회
  v
Catalog Projector ---> catalog-products-write (write Alias) ---> 물리 인덱스

Query.searchProducts ---> catalog-products-read (read Alias) ---> 같은 물리 인덱스
  |
  +-- itemId 반환
         |
         v
주문 API는 MySQL primary에서 현재 가격, 판매 상태와 재고를 다시 검증
```

- MySQL의 `Product`, `Item`, live 옵션/카테고리/미디어/태그는 현재 카탈로그와 재고의 source of truth입니다.
- `ProductSnapshot`은 append-only 변경 이력입니다. 현재 상품 조회, 검색 projection, 재색인과 주문
  판정의 원본으로 사용하지 않습니다.
- OpenSearch는 MySQL에서 언제든 다시 만들 수 있는 검색 전용 read model입니다.
- 검색 결과는 잠시 늦거나 오래된 값일 수 있습니다.
- OpenSearch 장애가 상품 변경이나 주문의 DB 트랜잭션을 실패시키면 안 됩니다.
- 주문 가능 여부와 결제 금액은 OpenSearch 결과로 확정하지 않습니다.

현재 `/graphql`의 `Mutation.placeOrder`는 `OrderResolver`에서 버전 없는 `OrderService`로 연결됩니다.
`OrderService`도 live `Item`과 그 `Product`를 MySQL primary에서 다시 조회하고 판매 상태와 재고를
검증합니다. 주문이 접수되면 그 시점의 값을 `OrderItemSnapshot`에 복사합니다. 검색 결과가 제공한
`itemId`는 주문 요청의 후보일 뿐 최종 판정이 아닙니다. 현재 주문 요청에는 고객이 본
`Product.revision`이나 예상 가격이 포함되지 않으므로 검색 화면의 가격과 실제 주문 접수 가격이 같다는
보장은 없습니다.

## 용어 먼저 보기

| 용어              | 이 문서에서의 뜻                                                          |
| ----------------- | ------------------------------------------------------------------------- |
| Mapping           | 검색 문서 각 필드의 타입과 분석 방식을 정하는 스키마                      |
| Analyzer          | 문자열을 검색 가능한 token으로 나누고 정규화하는 규칙                     |
| 물리 인덱스       | 문서를 실제로 저장하는 버전별 OpenSearch 인덱스                           |
| Alias             | API가 물리 인덱스 이름을 몰라도 읽고 쓸 수 있게 하는 논리 이름            |
| Projector         | MikroORM/MySQL projection을 OpenSearch 문서 한 건으로 바꾸는 순수 변환기  |
| read model        | 검색에 맞게 복제한 조회 전용 데이터이며 원본 데이터는 아님                |
| nested            | 한 Item 안의 가격과 옵션 관계를 유지하는 배열 필드 타입                   |
| inner_hits        | nested 조건을 실제로 만족한 Item을 결과에서 찾는 기능                     |
| Bulk              | 여러 문서의 upsert/delete를 한 요청으로 처리하는 API                      |
| PIT               | 페이지를 넘기는 동안 같은 검색 시점을 유지하는 Point in Time              |
| search_after      | 이전 결과의 마지막 정렬 값 다음부터 조회하는 페이지네이션                 |
| Outbox            | DB 변경과 같은 transaction에 저장하는 전달 대기 event                     |
| relay             | 미전달 Outbox를 lease하고 검색 worker를 호출하는 background/CLI 구성 요소 |
| reconciliation    | MySQL과 검색 문서를 대조해 누락과 오래된 값을 복구하는 작업               |
| external version  | 늦게 온 과거 작업이 최신 문서를 덮지 못하게 하는 외부 revision            |
| replay sink       | 고급 무중단 rebuild에서 기존/후보 전달 대상을 구분하는 미도입 개념        |
| checkpoint        | 고급 rebuild의 batch 탐색 위치이며 현재 기본 relay에는 사용하지 않음      |
| cutover barrier   | 고급 Alias 전환 직전에 새 쓰기를 잠깐 멈추는 미도입 구간                  |
| nDCG@10           | 상위 10개 결과의 관련도와 순서를 함께 평가하는 검색 품질 지표             |
| underfill rate@10 | 관련 문서가 10개 이상인데 결과 상위 10개를 다 채우지 못한 query 비율      |

## 현재 저장소 상태

| 항목                                         | 현재 상태                                        |
| -------------------------------------------- | ------------------------------------------------ |
| Product, Item, live catalog 관계 Entity      | 구현                                             |
| append-only 감사 이력 `ProductSnapshot`      | command transaction과 지원 필드의 복원까지 구현  |
| live Item을 사용하는 공개 주문               | 재고 예약/원장과 함께 `OrderService`에 구현      |
| canonical `product` GraphQL Query            | 구현                                             |
| 상품 변경 command와 revision/snapshot 불변식 | 검색 Outbox까지 한 transaction으로 구현          |
| OpenSearch `searchProducts` Query            | strict input, nested filter와 서명 cursor로 구현 |
| OpenSearch client, Mapping, Alias            | 제한된 HTTP client와 strict Mapping으로 구현     |
| 전체 재색인과 증분 색인                      | rebuild와 external version worker로 구현         |
| 검색 동기화 Outbox                           | lease/backoff/dead-letter relay로 구현           |
| 로컬 OpenSearch 구성                         | Nori를 포함한 OpenSearch 3.8.0 Compose로 구현    |

초기 구축 순서는 live DB 전체 재색인으로 문서 계약을 고정한 뒤 Catalog command와 Outbox를 연결하는
방식이었습니다. 현재는 두 경로가 모두 구현되어 있습니다.

### 코드를 읽는 순서

검색 문서 경계와 GraphQL 계약을 읽은 뒤 로컬 OpenSearch, Projector, 전체 rebuild, 검색 Query,
Outbox/external version, reconciliation, 관련도 평가 순으로 확인합니다.

구현 구성:

1. OpenSearch 전용 로컬 환경
2. Nest client provider와 feature flag
3. Mapping, read/write Alias 초기화
4. 현재 live catalog 문서 Projector
5. 전체 rebuild CLI
6. 최소 `searchProducts` Query
7. 단위 및 실제 OpenSearch 통합 테스트

Outbox는 별도 MikroORM Entity와 migration으로 관리합니다. Entity를 바꿀 때는
`pnpm database:schema:dump`로 차이를 확인하고 versioned migration을 생성합니다.

## 검색 문서 경계

현재 검색 노출 대상 상품 하나를 OpenSearch 문서 하나로 만듭니다.

```text
인덱스 설정 버전: catalog-products-v001
물리 인덱스: catalog-products-v001-<buildId>
읽기 Alias: catalog-products-read
쓰기 Alias: catalog-products-write
문서 _id: Product.id의 문자열
```

같은 Product의 현재 상태가 바뀌어도 `_id`는 유지하고 문서 전체를 교체합니다. 과거
`ProductSnapshot`은 OpenSearch에 넣지 않습니다. 과거 이력은 MySQL의 감사 테이블에만 있고 검색
인덱스에는 live catalog에서 투영한 현재 상태 하나만 존재합니다.

### 색인 대상 조건

다음 조건을 모두 만족하는 Product만 문서로 만듭니다.

- `Product.status == ACTIVE`
- `Product.deletedAt == null`
- `Item.saleStatus == ALLOW`이고 `Item.deletedAt == null`인 Item이 하나 이상 존재함

Product가 중지 또는 삭제되면 해당 문서를 삭제합니다. 판매 가능한 Item이 없어져도 검색 결과에서
주문 후보를 제공할 수 없으므로 문서를 삭제합니다. 최소/최대 가격은 위 조건을 만족한 live Item만으로
계산합니다.

### 문서 예시

```json
{
    "schemaVersion": 1,
    "productId": "1",
    "productRevision": 42,
    "sellerId": "3",
    "slug": "wireless-keyboard",
    "updatedAt": "2026-08-12T10:00:00.000Z",
    "name": "무선 기계식 키보드",
    "description": "저소음 스위치를 사용한 텐키리스 키보드",
    "tags": ["키보드", "무선", "저소음"],
    "categoryIds": ["12"],
    "categorySlugs": ["keyboards"],
    "categoryNames": ["키보드"],
    "categoryAncestorSlugs": ["electronics", "computer-accessories", "keyboards"],
    "thumbnail": {
        "storageKey": "products/1/thumbnail.webp",
        "altText": "검정 무선 기계식 키보드"
    },
    "minPrice": 89000,
    "maxPrice": 99000,
    "items": [
        {
            "itemId": "101",
            "sku": "019c-example",
            "name": "검정, 적축",
            "sequence": 0,
            "totalPrice": 89000,
            "isTaxFree": false,
            "optionTokens": ["color:black", "switch:red"]
        }
    ]
}
```

BigInt ID는 JSON 정밀도 손실을 피하기 위해 10진 문자열로 보냅니다. `productRevision`은 live
`Product.revision`을 그대로 투영한 값입니다. 별도의 `projectionRevision`을 두지 않습니다. 같은 값을
OpenSearch 외부 version으로 사용해 늦게 도착한 과거 작업을 거절합니다. 현재 DB의
signed 32-bit integer 범위는 JavaScript 안전 정수 안에 들어오며 유효 revision은
`1..2,147,483,647`입니다. serializer는 1 미만, 정수가 아닌 값과 DB 범위를 벗어난 값을 요청 전에
거절해야 합니다. revision 저장 타입을 나중에 `BIGINT`로 넓힌다면
애플리케이션에서는 `bigint`와 10진 문자열로 다루고 외부 version의 non-negative long 경계를 실제 서버
통합 테스트로 다시 확인합니다. MySQL `DECIMAL(10, 3)` 가격은 소수점 셋째 자리까지 허용하므로
OpenSearch에서는 `scaled_float`와 `scaling_factor: 1000`을 사용합니다.

`items`는 `nested`로 매핑합니다. 일반 object 배열로 저장하면 한 Item의 옵션과 다른 Item의 가격이
한 조건처럼 섞여 잘못 매칭될 수 있습니다. Projector는 상품당 검색 Item 수에 애플리케이션 상한을 두고
OpenSearch의 `index.mapping.nested_objects.limit`보다 충분히 낮은지 검증합니다.
첫 버전 상한은 검색 노출 Item 100개이며 초과하면 조용히 자르지 않고 해당 Product projection 전체를
실패시킵니다. 실패한 Product ID와 실제 개수를 남긴 뒤 모델 또는 상한을 의식적으로 다시 설계합니다.

문서의 SKU, 표시명과 가격은 live `Item`에서 읽습니다. 옵션 token은 live option/value code를 소문자
`[a-z0-9][a-z0-9_-]{0,63}`로 제한한 뒤 `option-code:value-code`로 만듭니다. 이렇게 해야 구분자 `:`가
code 안에 들어가 서로 다른 조합이 같은 token이 되는 일을 막을 수 있습니다.

`thumbnail`은 live Product media 중 `role == THUMBNAIL`인 값을 `sequence` 오름차순으로 정렬한 첫
항목입니다. 해당 media가 없으면 `null`로 저장합니다. 여러 thumbnail을 허용하는 DB 구조와 검색 응답의
단일 대표 이미지를 이 결정 규칙으로 연결합니다.

### Mapping 계약

Root와 `items` 모두 `dynamic: strict`를 사용합니다. 문서에 새 필드를 넣으려면 Mapping과
`schemaVersion`을 먼저 바꿔야 하며, 알 수 없는 필드를 OpenSearch가 임의 추론하게 두지 않습니다.

| 필드                           | Mapping                      | 검색 목적                                  |
| ------------------------------ | ---------------------------- | ------------------------------------------ |
| `schemaVersion`                | `integer`                    | Projector와 문서 계약 버전 확인            |
| `productRevision`              | `long`                       | live aggregate revision과 reconciliation   |
| `productId`, `sellerId`        | `keyword`                    | ID 완전 일치와 정렬 동률 해소              |
| `slug`                         | `keyword`                    | URL 식별자 완전 일치                       |
| `updatedAt`                    | `date`                       | live 상품 변경 시각과 최신순 정렬          |
| `name`                         | `text`와 `keyword` 하위 필드 | 전문 검색과 exact 정렬/진단                |
| `description`                  | `text`                       | 낮은 boost의 전문 검색                     |
| `tags`                         | `text`와 `keyword` 하위 필드 | 전문 검색과 exact filter 확장              |
| `categoryIds`, `categorySlugs` | `keyword`                    | 현재 분류 완전 일치 filter                 |
| `categoryNames`                | `keyword`                    | 응답 표시와 진단                           |
| `categoryAncestorSlugs`        | `keyword`                    | 현재 상위 분류까지 포함한 filter           |
| `thumbnail`                    | `object`                     | 응답 표시, 자식 필드는 `index: false`      |
| `minPrice`, `maxPrice`         | `scaled_float`, factor 1000  | 표시와 정렬 보조, SKU 범위 판정에는 미사용 |
| `items`                        | `nested`                     | 같은 SKU의 가격과 옵션 관계 유지           |
| `items.itemId`, `items.sku`    | `keyword`                    | 주문 후보 ID와 SKU exact filter            |
| `items.name`                   | `text`와 `keyword` 하위 필드 | SKU 표시명 검색과 응답                     |
| `items.sequence`               | `integer`                    | 대표 SKU의 결정적 선택                     |
| `items.totalPrice`             | `scaled_float`, factor 1000  | 실제 한 SKU의 가격 filter와 정렬           |
| `items.isTaxFree`              | `boolean`                    | 과세 유형 filter 확장                      |
| `items.optionTokens`           | `keyword`                    | 같은 SKU의 옵션 조합 filter                |

`text` 필드는 모두 이름이 고정된 `catalog_text_index`/`catalog_text_search` Analyzer를 참조합니다.
v001에서는 두 이름의 구현이 `standard`이고, v002에서는 Nori 후보 설정으로 바뀝니다. 이름은 같아도
Analyzer 정의가 달라지므로 새 물리 인덱스와 전체 rebuild가 필요합니다.

전체 재색인과 증분 요청 모두 `_source.productRevision`과 external version에 현재 `Product.revision`을
사용합니다. 기존 인덱스의 version 체계를 중간에 바꾸지 않고, 매 rebuild마다 빈 새 물리 인덱스에 전체
문서를 색인한 뒤 검증과 Alias 전환을 수행합니다.

### 첫 버전에서 색인하지 않는 값

- 정확한 `Item.stock`
- 주문 가능 여부의 최종 판정
- 만료되는 signed URL
- `ProductSnapshot` 감사 이력과 payload
- 주문, 결제와 배송 정보

재고는 live 카탈로그 정보보다 자주 바뀝니다. 첫 버전에서는 검색 결과에 Item 후보만 제공하고
주문 시 MySQL에서 재검증합니다. 재고 유무를 검색 조건으로 제공할 필요가 확인되면 재고 변경 Outbox와
함께 별도 단계로 추가합니다.

## GraphQL 상품 검색 계약

첫 검색 API는 `/graphql`의 `Query.searchProducts`입니다. MySQL canonical 조회인 `Query.product`와
GraphQL 공통 context, 인증, scalar와 오류
정책은 [GraphQL API 전환 설계](../graphql-api-migration.md)를 따릅니다.

```graphql
scalar Decimal

type Query {
    searchProducts(input: ProductSearchInput!): ProductSearchConnection
}

input ProductSearchInput {
    query: String
    categorySlug: String
    minPrice: Decimal
    maxPrice: Decimal
    sku: String
    options: [ProductOptionFilterInput!]
    sort: ProductSearchSort = RELEVANCE
    first: Int = 20
    after: String
}

input ProductOptionFilterInput {
    optionCode: String!
    valueCode: String!
}

enum ProductSearchSort {
    RELEVANCE
    PRICE_ASC
    PRICE_DESC
}

type ProductSearchConnection {
    nodes: [ProductSearchNode!]!
    pageInfo: ProductSearchPageInfo!
}

type ProductSearchNode {
    productId: ID!
    slug: String!
    name: String!
    itemId: ID!
    itemName: String!
    price: Money!
    thumbnail: ProductSearchThumbnail
}

type ProductSearchThumbnail {
    url: String!
    altText: String
}

type ProductSearchPageInfo {
    hasNextPage: Boolean!
    endCursor: String
}
```

Root field는 검색 인프라 오류가 같은 operation의 다른 nullable field까지 지우지 않도록 nullable입니다.
성공한 Connection 내부에는 nullable list나 pageInfo를 만들지 않습니다.

```graphql
query SearchProducts($input: ProductSearchInput!) {
    searchProducts(input: $input) {
        nodes {
            productId
            slug
            name
            itemId
            itemName
            price {
                amount
                currencyCode
            }
            thumbnail {
                url
                altText
            }
        }
        pageInfo {
            hasNextPage
            endCursor
        }
    }
}
```

```json
{
    "input": {
        "query": "무선 키보드",
        "categorySlug": "keyboards",
        "minPrice": "50000.000",
        "maxPrice": "100000.000",
        "sort": "RELEVANCE",
        "first": 20
    }
}
```

허용 input:

- `query`: 상품명, 설명과 태그에 적용할 검색어
- `categorySlug`: 허용된 category slug
- `minPrice`, `maxPrice`: 지수 표기 없는 `Decimal` 문자열 가격 범위
- `sku`: 분석하지 않는 SKU 완전 일치
- `options`: `optionCode`, `valueCode`를 가진 구조화된 SKU 옵션 조건 배열
- `sort`: `RELEVANCE`, `PRICE_ASC`, `PRICE_DESC` 중 하나
- `first`: 기본 20, 최대 50
- `after`: 서버가 만든 불투명 PIT와 정렬 cursor

Product/Item ID는 GraphQL `ID` 10진 문자열로 노출합니다. 가격 출력은 공통
`Money { amount, currencyCode }`를 사용하고 amount는 정밀도를 보존하는 decimal 문자열입니다.
가격 범위 input은 별도의 문자열 기반 `Decimal` scalar를 사용합니다.
옵션 input은 Resolver에서 정규화된 `option-code:value-code` token으로 변환합니다.

Schema coercion 이후의 의미 검증 실패는 `extensions.code=INVALID_SEARCH_INPUT`으로 통일합니다. 예를 들어
`first`가 1에서 50 범위를 벗어나거나, `minPrice > maxPrice`이거나, option/code가 허용 문자 규칙을
어기거나, 같은 optionCode가 두 번 들어오면 이 오류를 반환합니다.

Cursor fingerprint를 만들기 전에 input을 다음 순서로 canonicalize합니다.

1. 누락된 `sort`와 `first`에 각각 `RELEVANCE`, `20`을 적용합니다.
2. `query`는 앞뒤 공백을 제거하고 연속 공백을 하나로 합칩니다. 빈 문자열은 `null`과 동일하게 봅니다.
3. category slug, SKU와 option code/value는 앞뒤 공백을 제거하고 각 필드의 문자 allowlist를
   검증합니다. `keyword` 완전 일치 의미를 바꾸는 임의의 대소문자 변환은 하지 않습니다.
4. Decimal은 지수 표기를 거절하고 소수점 셋째 자리의 부호 없는 10진 문자열로 정규화합니다.
5. options는 `optionCode`, `valueCode` 순으로 정렬합니다. 같은 optionCode의 중복은 정렬 전에 거절합니다.
6. `after`를 제외한 canonical input을 안정적인 key 순서로 직렬화한 뒤 fingerprint를 계산합니다.

첫 요청과 다음 페이지 요청은 이 canonical input이 정확히 같아야 합니다. 표기만 다른 같은 값은 같은
fingerprint가 되고, 의미가 바뀐 요청은 `SEARCH_CURSOR_MISMATCH`로 거절됩니다.

클라이언트가 OpenSearch Query DSL, 필드명, script, 임의 sort를 직접 보내게 하지 않습니다. 서버의 한
Query Builder가 다음 규칙을 적용합니다.

- 상품명에 가장 높은 boost
- 설명과 태그에는 낮은 boost
- 상태, 카테고리와 가격은 score가 필요 없는 filter context
- SKU는 분석하지 않는 exact `keyword` 검색
- 한 SKU가 만족해야 하는 가격과 옵션 조건은 하나의 `nested(path=items)` 내부 bool로 결합
- 깊은 `from/size` 대신 PIT와 `search_after` 기반 커서 페이지네이션

가격 범위는 root의 `minPrice/maxPrice` 겹침만으로 판정하지 않습니다. 예를 들어 10원과 100원 Item만
있는 상품은 40원에서 60원 검색에 매칭되면 안 됩니다. `items.totalPrice`의 nested range로 실제 한 Item이
범위를 만족하는지 확인합니다. 여러 Item 중 응답에 넣을 `itemId`는 같은 nested 조건의 `inner_hits`에서
`size: 1`로 선택합니다. Item 조건이 없다면 관련도 정렬은 `sequence`, `itemId` 순의 첫 값을 사용합니다.
낮은/높은 가격 상품 정렬도 root `minPrice/maxPrice`가 아니라 동일 nested filter가 적용된
`items.totalPrice` nested sort를 각각 `mode: min`/`mode: max`로 사용합니다. `inner_hits`도 같은 filter와
가격 방향을 사용하고 `sequence`, `itemId`로 동률을 해소해야 상품 순서, 응답 가격과 `itemId`가 한
Item을 가리킵니다.

정렬에는 마지막 동률 해소 키로 고유한 `productId`를 항상 포함합니다. Cursor에는 PIT ID, 정렬 값과
첫 요청의 정규화된 `query/categorySlug/minPrice/maxPrice/sku/options/sort/first` fingerprint를 서명된
형태로 담고 PIT keep-alive는 1분으로 시작합니다. `after` 자체는 fingerprint에서 제외합니다. 다음
페이지에서 검색 조건이 달라지면 GraphQL error의 `extensions.code=SEARCH_CURSOR_MISMATCH`로 거절합니다.
PIT 자체는 query에 묶이지 않으므로 이 검증이 없으면 같은 cursor를 다른 filter/sort에 재사용할 수
있습니다. PIT 없이 `search_after`만 사용하면 페이지를 넘기는 동안 색인이 바뀔 때 중복이나 누락이 생길
수 있습니다.

첫 페이지 요청은 read Alias에서 PIT를 만들고, 다음 페이지 요청은 `after` 안의 PIT와 `search_after`를
사용합니다. 마지막 페이지에서는 PIT를 닫고 `pageInfo.hasNextPage=false`, `endCursor=null`을 반환합니다.
클라이언트가 중간에 중단하면 1분 뒤 만료되며 만료된 cursor는 `SEARCH_CURSOR_EXPIRED`, 조작되거나 형식이
잘못된 cursor는 `INVALID_SEARCH_CURSOR` code로 거절합니다. Resolver 실행 오류의 HTTP status를 공개
계약으로 사용하지 않습니다.

검색 응답은 OpenSearch 내부 `_source`, `_score`, sort 배열을 그대로 노출하지 않고 GraphQL type으로
변환합니다. 주문에 필요한 `itemId`는 포함하되 검색 결과의 가격과 상태가 확정값은 아니라는 경계를
유지합니다. 인덱스의 `thumbnailStorageKey`도 공개하지 않고 응답을 조립할 때 미디어 전달 계층에서
URL로 변환합니다. 현재는 그 전달 계층이 없으므로 검색 문서에는 내부 projection용 `storageKey`만
보존하고 공개 검색 응답에는 썸네일을 포함하지 않습니다.

```json
{
    "data": {
        "searchProducts": {
            "nodes": [
                {
                    "productId": "1",
                    "slug": "wireless-keyboard",
                    "name": "무선 기계식 키보드",
                    "itemId": "101",
                    "itemName": "검정, 적축",
                    "price": {
                        "amount": "89000.000",
                        "currencyCode": "KRW"
                    },
                    "thumbnail": null
                }
            ],
            "pageInfo": {
                "hasNextPage": true,
                "endCursor": "opaque-signed-cursor"
            }
        }
    }
}
```

## 구현 구성과 남은 고급 단계

### 1단계. 로컬 환경과 연결, 구현됨

목표는 애플리케이션이 OpenSearch와 독립적으로 시작되고, 활성화했을 때 health와 기본 API를 호출할 수
있게 만드는 것입니다.

구현 범위:

- OpenSearch 3.8.0 단일 노드 전용 Compose
- `127.0.0.1:9200`에만 포트 공개
- 로컬 실습용 Security plugin 비활성화
- Nori 플러그인을 설치한 버전 고정 이미지
- 허용된 method/path/query와 JSON/NDJSON 응답을 검증하는 제한된 `fetch` HTTP client provider
- `OPENSEARCH_ENABLED`, node URL, read/write Alias 환경 변수
- Client provider를 Nest singleton으로 재사용

MySQL과 Redis는 기본 Compose로 관리합니다. OpenSearch는 별도 Compose project와 수명주기로 관리하며,
host에서 실행하는 Nest 애플리케이션은
`127.0.0.1:9200`으로 접속합니다.

로컬 image는 OpenSearch 3.8.0에 Nori plugin을 설치합니다. 사용 API는 실제 OpenSearch 통합 테스트로
호환성을 고정합니다.

애플리케이션 이미지는 `.env`를 포함하지 않습니다. 이후 인증이 있는 OpenSearch를 연결할 때도 자격
증명은 Dockerfile이나 이미지 계층에 넣지 않고 런타임 환경 변수나 secret으로 주입합니다.

Feature flag 동작은 client와 `searchProducts` Query가 함께 따릅니다.

- `OPENSEARCH_ENABLED=false`: 검색 요청을 보내지 않으며, `searchProducts`만 GraphQL error의
  `extensions.code=SEARCH_DISABLED`로 실패합니다. 다른 Query/Mutation과 애플리케이션 부팅에는
  영향을 주지 않습니다.
- `OPENSEARCH_ENABLED=true`: node URL과 Alias 설정을 필수 검증합니다. Cluster 연결은 lazy하게 하며
  시작 시 cluster가 없어도 애플리케이션 전체를 종료하지 않습니다.
- 활성화 상태에서 cluster가 중단되면 `searchProducts`만 `SEARCH_UNAVAILABLE` code로 실패하고
  timeout/error를 request ID와 함께 구조화 로그로 남깁니다.
- 공개 `searchHealth` GraphQL Query는 만들지 않습니다. `GET /health/search`가 실제 client의 `info`와
  `cluster.health`를 호출하고, `_cat/plugins`와 `_analyze`는 통합 테스트와 로컬 확인 명령에서
  검증합니다.

통과 기준:

- OpenSearch 비활성화 상태에서 기존 API와 테스트가 그대로 동작함
- 활성화 상태에서 root endpoint와 cluster health 확인
- `_cat/plugins`와 `_analyze`로 Nori plugin 설치와 실제 분석 확인
- 잘못된 URL과 중단된 cluster의 오류가 명확히 보고됨

### 2단계. 전체 재색인과 검색 Query, 구현됨

DB 스키마 변경 없이 검색의 첫 세로 흐름을 완성합니다.

전체 재색인은 새 물리 인덱스를 만들고 검증 뒤 Alias를 전환합니다. 현재 구현에는 candidate별 delivery와
cutover write barrier가 없으므로, 쓰기가 계속 발생하는 환경에서 CLI 하나만으로 무손실 backfill을
보장하지 않습니다. 활성 Alias 전환은 Catalog 쓰기를 차단한 유지보수 구간에서만 실행하고, 사전에
Outbox를 drain한 뒤 reconciliation으로 차이가 없음을 확인합니다.

구현 범위:

- `ProductEntity`와 live Item/옵션/카테고리/미디어/태그 기반 MikroORM/MySQL projection 조회
- 조회 결과를 검색 문서로 바꾸는 순수 Projector
- 명시적인 `dynamic: strict` Mapping
- 물리 인덱스 생성과 read/write Alias 초기화
- 매 실행마다 빈 새 물리 인덱스를 만드는 bounded batch 기반 전체 재색인
- Bulk 응답의 각 item 성공과 실패 검사
- Nest application context를 사용하는 `pnpm search:rebuild` CLI
- `searchProducts` Resolver, input과 response type

첫 버전에는 rebuild용 관리 Query/Mutation을 만들지 않습니다. CLI는 feature flag와 Alias를 검사하고 새
build ID를 생성한 뒤, 검증이 모두 끝난 경우에만 read/write Alias를 새 인덱스로 옮깁니다.

정확한 실행 순서는 `create new index -> Bulk -> refresh -> count/sample/query 검증 -> _aliases 전환`입니다.
기존 Alias가 이미 있다면 create 직후 후보 인덱스에 붙이지 않습니다. 첫 실행도 검증 전까지 read/write
Alias를 만들지 않아 불완전한 인덱스가 API에 노출되지 않게 합니다.

재색인은 기존 인덱스에 덮어쓰지 않고 매번 새 물리 인덱스에 수행합니다. 그래야 DB에서 사라진 Product가
이전 문서로 남지 않습니다. 전체 데이터를 한 번에 메모리에 올리지 않고 고정 크기 batch로 읽으며 Bulk
요청도 제한된 동시성으로 실행합니다. HTTP 200이어도 Bulk item 일부가 실패할 수 있으므로 `errors`와
모든 item을 검사합니다. Batch마다 `refresh=true`를 사용하지 않고 전체 작업 완료 뒤 한 번 refresh한 후
count와 query를 검증합니다.

Bulk item 오류는 재시도 가능 여부를 분류합니다. `429`와 일시적인 `5xx`는 제한된 backoff로 재시도하고,
Mapping과 validation 오류는 재시도하지 않고 실패 원문과 document ID를 남깁니다. 증분 단계의
version conflict는 일반 입력 오류와 구분해 별도 규칙으로 처리합니다.

통과 기준:

- 같은 rebuild를 여러 번 실행해도 각각 완결된 새 인덱스를 만들고 `_id`가 중복되지 않음
- DB의 현재 검색 노출 대상 Product 수와 OpenSearch root 문서 수가 일치함
- Product, 가격, Item, 옵션, 카테고리, 미디어와 태그 표본이 live DB 상태와 일치함
- 상품명 검색, 카테고리 filter, 가격 range와 정렬이 동작함
- OpenSearch를 중단해도 주문 API가 OpenSearch에 의존하지 않음

`nested` Item은 내부 Lucene 문서를 추가하므로 `_cat/indices`의 `docs.count`를 Product 수로 해석하지
않습니다. Product 대조에는 root document를 세는 Count API 또는 동일 filter의 search count를
사용합니다.

### 3단계. 검색 품질 기준선과 Nori 비교, 평가 도구 구현됨

`standard` Analyzer를 control 기준선으로 삼고 같은 corpus/query/judgment에서 Nori 후보만 바꿔
비교합니다. Nori 설치 자체를 개선으로 판단하지 않으며 nDCG@10, Recall@10, underfill/zero-result와
no-match false-positive, query별 회귀와 비용을 함께 측정합니다.

평가 fixture, 실험 순서, 재현 정보와 통과 기준은
[OpenSearch 한국어 검색 품질 평가](opensearch-relevance-evaluation.md)에 분리해 정리합니다.

### 4단계. 상품 변경과 증분 색인, 구현됨

상품 변경 command는 검색 결과에 영향을 주는 live aggregate 변경과 `Product.revision` 증가,
감사 `ProductSnapshot` 추가, Outbox 기록을 한 transaction에서 처리합니다. Outbox relay/Worker는 event의
Snapshot payload를 사용하지 않고 MySQL primary의 live aggregate를 다시 읽어 증분 색인합니다.
`version_type=external`은 역순 event를 방어하지만 동일 revision도 409로 거절하며, 삭제 version도 영구
보존되지 않는다는 한계가 있습니다.

Worker 재조회, revision 할당, fail-closed Bulk, 중복/역순 처리와 삭제 후 사후 수렴 계약은
[OpenSearch 증분 동기화와 재구축](opensearch-index-synchronization.md)에 정리합니다.

### 5단계. 재구축과 장애 복구, 기본 경로 구현됨

Mapping/Analyzer 변경은 새 물리 인덱스에 MySQL 현재 상태를 backfill하고 검증한 뒤 Alias를 전환합니다.
기본 Outbox relay와 reconciliation은 구현됐습니다. 후보 sink별 delivery와 cutover barrier는 더 강한
무중단 보장이 필요할 때 추가할 고급 단계입니다. 현재 활성 rebuild는 Catalog 쓰기를 차단한 유지보수
구간에서 실행합니다. Alias 요청의 원자성은 이름 전환에만 해당하며 데이터 동등성이나 안전한 rollback을
대신 보장하지 않습니다.

현재 범위와 고급 cutover 한계, reconciliation, 실패 주입과 복구 기준은
[OpenSearch 증분 동기화와 재구축](opensearch-index-synchronization.md)을 따릅니다.

## 현재 파일 구조

인프라 client, GraphQL 검색 adapter와 projection 변환을 다음처럼 분리합니다.

```text
deployment/opensearch/
  Dockerfile
  docker-compose.yaml

src/infra/search/
  search.module.ts
  search-health.controller.ts
  opensearch.client.ts
  catalog-index.definition.ts
  catalog-index.manager.ts
  catalog-projection.reader.ts
  catalog-rebuild.service.ts
  catalog-search.worker.ts
  search-health.service.ts
  search-outbox.relay.ts
  search-outbox.worker.ts
  search-projection-outbox.entity.ts
  search-reconciliation.service.ts
  search-relevance-evaluation.service.ts

src/api/catalog/search/
  application/product-search.service.ts
  domain/catalog-projector.ts
  domain/product-search.document.ts
  domain/product-search.query.ts
  presentation/product-search.resolver.ts
  presentation/product-search.input.ts
  presentation/product-search.type.ts

src/cli/
  search-rebuild.ts
  search-evaluate.ts
  search-outbox-relay.ts
  search-reconcile.ts

test/unit/search/
test/unit/database/search/
test/integration/search/
```

전체 재색인과 Alias 변경은 일반 사용자 GraphQL schema에 넣지 않습니다. 로컬 CLI로만 실행합니다.

## 검증 전략

아래는 현재 구현의 검증 범위입니다. Nori 평가는
[검색 품질 평가 문서](opensearch-relevance-evaluation.md), Outbox/external version/reconciliation은
[증분 동기화 문서](opensearch-index-synchronization.md)의 통과 기준을 따릅니다.

### 단위 테스트

- BigInt ID 문자열 변환
- Decimal 가격 변환과 소수점 셋째 자리 보존
- category ancestor slug, tag와 thumbnail 투영
- Item 옵션을 `option-code:value-code` 형태로 정규화
- option/value code 문자 규칙과 Item 100개 상한 검증
- 판매 불가 또는 soft-deleted Item 제외
- Query Builder의 boost, filter와 sort allowlist
- cursor encode/decode, GraphQL input fingerprint mismatch와 잘못된 cursor 거절

### 통합 테스트

- Mapping과 Alias 생성
- Nori plugin과 `_analyze`
- Bulk 전체 성공과 부분 실패
- `nested` Item 옵션/가격 조건
- PIT와 `search_after` 다음 페이지, 동률 해소와 PIT 만료
- `searchProducts` input/connection/Decimal/ID/error code 직렬화
- 새 인덱스 검증 뒤 Alias 전환

### 기존 기능 회귀

- OpenSearch를 사용하지 않는 unit test
- lint
- stage/prod build
- OpenSearch disabled 상태의 애플리케이션 부팅
- OpenSearch 장애 중 다른 GraphQL Query/Mutation의 독립성
- 공개 `OrderService`가 검색 client를 참조하지 않음

## 의도적으로 보류하는 범위

- 벡터와 하이브리드 검색
- 자동완성과 edge n-gram
- 인기도 기반 `function_score`
- 클릭 로그, UBI, A/B test와 LTR
- 정확한 stock 수량 색인
- Debezium, Kafka와 binlog CDC
- 다중 노드, Dashboards와 고가용성 구성
- Amazon OpenSearch Service 배포

이 항목들은 현재 세로 흐름의 통과 기준이 아닙니다. 기준선에서 확인된 문제나 새로운 학습 목표가 생길
때 별도 단계로 추가합니다.

## 참고 자료

- [OpenSearch 버전 이력](https://docs.opensearch.org/latest/version-history/)
- [OpenSearch 3.8.0 release](https://github.com/opensearch-project/OpenSearch/releases/tag/3.8.0)
- [JavaScript client](https://docs.opensearch.org/latest/clients/javascript/)
- [JavaScript client 호환성 표](https://github.com/opensearch-project/opensearch-js/blob/main/COMPATIBILITY.md)
- [Mapping과 필드 타입](https://docs.opensearch.org/latest/mappings/)
- [Nested field](https://docs.opensearch.org/latest/field-types/supported-field-types/nested/)
- [Mapping limits](https://docs.opensearch.org/latest/mappings/mapping-explosion/)
- [Nori plugin 설치](https://docs.opensearch.org/latest/install-and-configure/plugins/)
- [Custom Docker image](https://docs.opensearch.org/latest/install-and-configure/install-opensearch/docker/)
- [Bulk API](https://docs.opensearch.org/latest/api-reference/document-apis/bulk/)
- [Index document 외부 버전](https://docs.opensearch.org/latest/api-reference/document-apis/index-document/)
- [Delete document와 gc_deletes](https://docs.opensearch.org/latest/api-reference/document-apis/delete-document/)
- [Alias API](https://docs.opensearch.org/latest/api-reference/alias/aliases-api/)
- [PIT와 search_after 페이지네이션](https://docs.opensearch.org/latest/search-plugins/searching-data/paginate/)
- [MySQL InnoDB AUTO_INCREMENT](https://dev.mysql.com/doc/refman/8.0/en/innodb-auto-increment-handling.html)
