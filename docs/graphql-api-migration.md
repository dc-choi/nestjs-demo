# GraphQL API 전환 설계

상태: 도메인 GraphQL 모델과 canonical 상품 조회 구현, OpenSearch 상품 검색 Query는 다음 단계

이 문서는 이 프로젝트가 REST Controller를 제거하고 GraphQL API 하나로 전환한 구조를 설명합니다.
현재 외부 진입점은 `/graphql`입니다. `src/api` 아래는 API 버전이 아니라 `auth`, `member`, `order`
도메인으로 나눕니다. 주문 v1/v2 비교 구현은 `order` 도메인 안에 보존하지만 공개 API에 연결하지 않습니다.

## 한눈에 보는 구조

```text
클라이언트
  |
  | POST /graphql
  v
GraphQL Resolver
  |
| Input/ID를 application Command 또는 Query로 변환
  v
Application use case
  |
  +-- Mutation -> rich domain -> Prisma transaction
  |
  +-- Query -> Prisma/OpenSearch read model

다음 단계의 상품 검색
ProductSearchResolver -> ProductSearchService -> OpenSearch
```

- GraphQL은 클라이언트가 호출하는 API 계약입니다.
- Resolver는 요청을 해석하고 결과를 GraphQL type으로 바꾸는 얇은 presentation 계층입니다.
- Mutation의 application service는 로그인, 회원가입, 주문 흐름을 조율합니다.
- 주문 금액과 품목 합계 같은 변경 불변식은 GraphQL/Prisma를 모르는 domain 객체가 담당합니다.
- 단순 조회는 domain aggregate를 복원하지 않고 application read result로 바로 반환합니다.
- GraphQL ID는 presentation mapper에서 검증한 뒤 application 경계에서 `bigint`로 사용합니다.
- 공개 `OrderService`는 Item별 분산 락으로 경합을 줄이고, primary transaction의 조건부 차감으로 재고
  음수를 막습니다.
- Prisma/MySQL은 상품, 가격, 재고와 주문의 source of truth입니다.
- OpenSearch는 이후 추가할 상품 검색 전용 read model이며 주문의 최종 판정에 사용하지 않습니다.

## GraphQL 용어

| 용어        | 이 프로젝트에서의 의미                                              |
| ----------- | ------------------------------------------------------------------- |
| Schema      | 클라이언트가 호출할 수 있는 field와 입출력 타입의 전체 계약         |
| Query       | 데이터를 바꾸지 않는 조회, 현재 `members`, `product`가 해당         |
| Mutation    | 상태를 바꾸는 명령, 로그인/회원가입/토큰 재발급/주문이 해당         |
| Resolver    | GraphQL field를 application service 호출로 연결하는 adapter         |
| Input type  | Mutation 또는 Query가 받는 구조화된 입력                            |
| Object type | 클라이언트가 selection set으로 필요한 field를 선택하는 결과 타입    |
| Context     | 같은 HTTP 요청의 Express request/response, 인증 사용자와 request ID |
| Scalar      | `String`, `Int`, `ID`, `DateTime`처럼 더 쪼개지지 않는 값           |

GraphQL endpoint는 하나지만 operation과 field 이름이 동작을 구분합니다. REST의 URL 버전인 `v1`, `v2`,
`v3`를 GraphQL field 이름에 넣지 않습니다. 호환되지 않는 변경은 새 field를 추가하고 기존 field를
deprecate한 뒤 제거합니다.

## 현재 공개 Schema

아래 SDL은 이해를 위한 축약본입니다. 실제 schema는 Nest code-first decorator에서 만들어집니다.

```graphql
type Query {
    members: [Member!]!
    product(id: ID!): Product
}

type Mutation {
    login(input: LoginInput!): LoginPayload!
    refreshToken(input: RefreshTokenInput!): RefreshTokenPayload!
    signup(input: SignupInput!): SignupPayload!
    placeOrder(input: PlaceOrderInput!): PlaceOrderPayload!
}
```

| Field          | 인증       | 연결되는 기존 로직                                    |
| -------------- | ---------- | ----------------------------------------------------- |
| `login`        | 불필요     | `AuthService.login`                                   |
| `refreshToken` | 불필요     | `AuthService.token`                                   |
| `signup`       | 불필요     | `MemberService.signup`, 공개 가입은 `CUSTOMER` 고정   |
| `members`      | Admin JWT  | `MemberService.findAll`                               |
| `product`      | 불필요     | 현재 `ProductPublication`을 읽는 canonical MySQL 조회 |
| `placeOrder`   | Bearer JWT | `OrderService.order`, Redlock과 primary transaction   |

`OrderV1Service`와 `OrderV2Service`는 동시성 처리 비교 자료로 `src/api/order/application`에 남아 있지만
module provider로 등록되지 않고 Query/Mutation도 없습니다. 현재 주문의 공개 계약은 `OrderResolver`가
`OrderService`를 호출하는 `placeOrder` 하나입니다.

### 공개 주문의 동시성 경계

`placeOrder`는 BullMQ 같은 비동기 queue를 거치지 않습니다. Mutation은 주문 transaction이 끝날 때까지
기다리고 그 결과를 바로 반환합니다.

1. 요청된 Item ID를 중복 제거하고 정렬한 Redis lock key로 바꿉니다.
2. Redlock으로 모든 Item lock을 획득합니다. 현재 주문 설정은 TTL 30초, 최초 시도 이후 최대 3회 재시도,
   시도 사이 100ms 대기입니다.
3. primary transaction에서 현재 발행 Snapshot과 재고를 다시 읽습니다.
4. `stock >= quantity` 조건부 update와 주문 Snapshot 저장을 같은 transaction에서 수행합니다.
5. transaction 종료 후 lock을 해제합니다.

분산 락은 경합을 줄이는 장치이지 데이터 무결성의 유일한 근거가 아닙니다. TTL 만료나 Redis 장애가 있어도
재고가 음수가 되지 않도록 DB 조건부 update를 최종 경계로 유지합니다. 현재 Redlock은 Redis client 한 개를
사용하므로 여러 독립 Redis 노드의 quorum 장애 내성을 제공하지 않습니다. 이 제한은 로컬 실습 범위에서
의도적으로 받아들입니다.

재시도는 lock 획득 단계에만 적용합니다. 획득에 성공한 뒤 application callback이 실패해도 주문 로직을
자동으로 다시 실행하지 않습니다. 따라서 한 요청에서 business callback은 최대 한 번만 실행됩니다.

분산 락은 같은 Item을 동시에 수정하는 요청을 직렬화하지만 같은 Mutation의 재전송을 식별하지는 않습니다.
현재 `placeOrder`는 멱등성 키를 입력받지 않으므로 순차적으로 같은 요청을 두 번 보내면 서로 다른 주문 두 건으로
처리됩니다. `Order.idempotencyKey`와 `requestFingerprint`는 스키마에만 준비돼 있고 API에는 아직 연결되지 않았습니다.

## 호출 예시

### 로그인

```graphql
mutation Login($input: LoginInput!) {
    login(input: $input) {
        accessToken
        refreshToken
        role
        isFirstLogin
    }
}
```

```json
{
    "input": {
        "email": "user@example.com",
        "password": "helloWorld"
    }
}
```

### 주문 접수

Authorization header에 `Bearer <accessToken>`을 전달합니다.

```graphql
mutation PlaceOrder($input: PlaceOrderInput!) {
    placeOrder(input: $input) {
        order {
            id
            orderNumber
            status
            totalPrice {
                amount
                currencyCode
            }
            items {
                id
                quantity
                lineTotalPrice {
                    amount
                    currencyCode
                }
                snapshot {
                    productName
                    itemName
                    selectedOptions {
                        optionName
                        valueName
                    }
                }
            }
        }
    }
}
```

```json
{
    "input": {
        "items": [
            {
                "itemId": "56",
                "quantity": 1
            }
        ]
    }
}
```

### 현재 공개 상품

`Product`는 안정적인 상품 식별자이고 `currentRevision`은 DB의 `ProductPublication`이 선택한 현재
`ProductSnapshot`입니다. Prisma의 FK와 상태 필드를 그대로 공개하지 않고 구매자가 탐색할 개념으로
이름을 바꿉니다.

```graphql
query Product($id: ID!) {
    product(id: $id) {
        id
        slug
        currentRevision {
            id
            version
            name
            items {
                id
                sku
                name
                price {
                    amount
                    currencyCode
                }
                selectedOptions {
                    optionName
                    valueName
                }
            }
            categories {
                name
                path {
                    name
                    slug
                }
            }
            tags
        }
    }
}
```

`product`는 `ACTIVE`, 미삭제 Product와 `PUBLISHED` 현재 발행본, 판매 가능한 Item이 모두 있을 때만
값을 반환합니다. OpenSearch 검색 결과가 아니라 MySQL의 canonical 현재 상태입니다.

미디어 이력과 내부 `storageKey`는 DB에 보존하지만 현재는 전달 URL 생성기가 없습니다. URL 없이 메타데이터만
공개하면 클라이언트가 사용할 수 없는 계약이 되므로 `ProductMedia`는 공개 GraphQL schema에서 제외합니다.
향후 미디어 전달 포트와 object storage signer 또는 CDN adapter를 구현할 때, 내부 식별자는 숨기고 만료 시간이
짧은 `url`을 포함한 공개 타입을 추가합니다.

## 레이어와 타입 경계

GraphQL 타입을 rich domain 객체로 사용하지 않습니다. GraphQL 타입은 클라이언트가 탐색하는 외부
그래프이고, domain 객체는 주문 계산과 상태 전이를 보호하는 내부 모델입니다.

| 계층           | 이 프로젝트의 타입                                       | 허용되는 의존성                       |
| -------------- | -------------------------------------------------------- | ------------------------------------- |
| presentation   | GraphQL Input/ObjectType/Payload, ID mapper              | Nest GraphQL, application             |
| application    | Command/Query/Result, use case                           | domain, repository/search port        |
| domain         | `Order`, `OrderLine`, 금액 계산                          | TypeScript 표준 기능만                |
| infrastructure | Prisma select/input/mapper, 이후 OpenSearch document/DSL | Prisma/OpenSearch, application/domain |

의존 방향은 `presentation -> application -> domain`이며 infrastructure가 application/domain 계약을
구현합니다. Prisma generated type과 OpenSearch document는 presentation이나 domain으로 전달하지 않습니다.

Mutation과 Query는 같은 경로를 억지로 공유하지 않습니다.

```text
Mutation: GraphQL Input -> Command -> application -> domain -> Prisma -> Result -> GraphQL Object
Query:    GraphQL Args  -> Query   -> Prisma/OpenSearch read adapter -> read result -> GraphQL Object
```

이 방식은 계층마다 의미가 다른 타입은 허용하지만, 모든 Prisma 모델에 entity/repository/DTO를 기계적으로
만들지는 않습니다. 단순 조회는 rich domain을 거치지 않고, 실제 N+1이 확인되기 전에는 field resolver와
DataLoader도 추가하지 않습니다.

## Code-first 선택

현재 코드는 TypeScript class, decorator와 `class-validator`를 사용하므로 Nest code-first 방식을
사용합니다.

- `autoSchemaFile: true`로 runtime schema를 메모리에서 만듭니다.
- `sortSchema: true`로 schema 순서를 결정적으로 유지합니다.
- TypeScript input/object type이 구현의 기준입니다.
- Prisma generated model을 GraphQL 결과로 직접 노출하지 않습니다.
- Resolver는 Prisma/OpenSearch 타입 대신 application service의 명시적 입력과 결과를 사용합니다.

Schema-first는 SDL과 생성 TypeScript 정의를 함께 관리해야 하므로 이번 프로젝트에는 사용하지 않습니다.

## Runtime 버전

2026-08-12 현재 다음 호환 조합을 고정합니다.

| Package                     | Version   | 역할                                                         |
| --------------------------- | --------- | ------------------------------------------------------------ |
| `@nestjs/graphql`           | `13.4.4`  | Nest 11 code-first GraphQL                                   |
| `@nestjs/apollo`            | `13.4.4`  | Nest와 Apollo Server 5 연결                                  |
| `@apollo/server`            | `5.5.1`   | GraphQL HTTP runtime                                         |
| `@as-integrations/express5` | `1.1.2`   | Apollo Server와 현재 Express 5 adapter 연결                  |
| `graphql`                   | `16.14.2` | 위 package들의 peer 범위 `^16.11.0`을 만족하는 GraphQL.js 16 |

전역 최신 `graphql@17`은 현재 Nest/Apollo peer 범위 밖이므로 사용하지 않습니다. Subscription 요구가
없으므로 `graphql-ws`와 `graphql-subscriptions`도 설치하지 않습니다.

## Endpoint와 개발 도구

GraphQL module이 `path: '/graphql'`을 직접 소유합니다. REST route가 없으므로 `main.ts`에는 전역 prefix를
두지 않습니다. 실제 endpoint는 다음과 같습니다.

```text
http://localhost:3000/graphql
```

`.env`의 `ENV=dev`에서만 GraphiQL과 introspection을 활성화합니다. 그 외 환경에서는 둘 다
비활성화합니다. 제거된 Swagger UI는 더 이상 제공하지 않습니다.

Subscription/WebSocket, Federation, 파일 업로드와 GraphQL 관리 명령은 현재 범위가 아닙니다. OpenSearch
rebuild도 GraphQL Mutation으로 노출하지 않고 로컬 CLI로만 실행합니다.

## ID, 수량과 가격

GraphQL `Int`는 signed 32-bit이므로 DB의 `BigInt` ID에 사용할 수 없습니다.

- Member/Product/Item/Order ID는 GraphQL `ID`의 10진 문자열로 전달합니다.
- Resolver는 `ID`를 검증한 뒤 JavaScript `bigint`로 변환합니다.
- JWT payload에도 member ID를 10진 문자열로 저장하고 인증 뒤 내부 `bigint`로 복원합니다.
- 수량은 GraphQL `Int`와 도메인 최소/최대 검증을 모두 통과해야 합니다.
- 금액은 `Money { amount, currencyCode }`로 노출하고 `amount`는 정밀도를 잃지 않는 decimal 문자열입니다.

예를 들어 `9223372036854775807`을 JavaScript `number`로 바꾸지 않으므로 정밀도를 잃지 않습니다.

## 인증과 요청 Context

GraphQL도 Express HTTP 요청 위에서 실행됩니다. Apollo context에 원본 `req`와 `res`를 전달하고 공통
helper가 GraphQL execution context에서 request를 꺼냅니다.

```text
Authorization header
  -> CommonGuard
  -> Passport JWT strategy
  -> JWT memberId 문자열 검증
  -> 내부 JwtPayload.memberId bigint
  -> @Jwt() Resolver parameter
```

GraphQL resolver의 실행 인수는 `root`, `args`, `context`, `info`입니다. 따라서 HTTP Controller처럼
`switchToHttp()`를 호출하면 실제 Express request를 얻지 못합니다. 이 프로젝트는 다음 하나의 경로로
request를 전달합니다.

```text
Apollo context({ req, res })
  -> GqlExecutionContext.getContext()
  -> JwtAuthGuard.getRequest()
  -> Passport가 req.user 설정
  -> @Jwt()가 같은 req.user 반환
```

`x-request-id`는 기존 CLS middleware를 그대로 사용합니다.

- 상위 서비스가 보낸 값을 유지하고, 없으면 UUID v7을 만듭니다.
- 응답 header에 같은 값을 반환합니다.
- CORS `exposedHeaders`에 `x-request-id`가 포함됩니다.
- GraphQL 오류의 `extensions.requestId`와 구조화 로그에도 연결합니다.

## GraphQL 요청과 응답 로깅

Apollo plugin이 operation을 해석하고 실제 Express response의 `finish` 시점에 완료 로그 한 건을 남깁니다.
요청 시작과 응답 완료를 별도 payload로 복제하지 않으므로 같은 요청의 상관관계와 최종 상태를 한 행에서
확인할 수 있습니다. 로그는 `logs_json/graphql`에 저장됩니다.

- 기록: request ID, HTTP method/path/status, operation type/name, 최상위 field, 처리 시간, 성공 여부, 오류 code
- 비기록: 원본 query, variables/argument, header/cookie/authorization, 인증 사용자, response data, 오류 메시지
- GraphQL 실행 오류는 HTTP 200일 수도 있으므로 오류 code가 하나라도 있으면 실패로 기록합니다.
- 클라이언트가 응답 완료 전에 연결을 끊으면 `aborted: true`로 기록합니다.

operation name과 request ID 길이, 최상위 field와 오류 code 개수에는 상한을 둬서 로그 고카디널리티와
단일 요청의 로그 증폭을 제한합니다. 내부 오류의 stack은 별도 error channel에서만 기록합니다.

## Validation

전역 `ValidationPipe`가 GraphQL input class의 `class-validator` decorator를 실행합니다. GraphQL 타입
coercion과 도메인 validation은 역할이 다릅니다.

- GraphQL은 문자열/정수/필수 field 같은 schema 타입을 먼저 검사합니다.
- `class-validator`는 이메일 형식, UUID v7, 수량 범위와 중첩 주문 item을 검사합니다.
- `placeOrder.items`는 비어 있을 수 없고 각 `itemId`는 양수 signed BIGINT 범위의 10진 문자열이어야 합니다.

## 오류 계약

Resolver 오류를 REST status body로 다시 포장하지 않습니다. GraphQL의 `errors`와 안정적인
`extensions.code`를 사용합니다.

```json
{
    "data": {
        "placeOrder": null
    },
    "errors": [
        {
            "message": "인증되지 않았습니다.",
            "path": ["placeOrder"],
            "extensions": {
                "code": "UNAUTHORIZED",
                "requestId": "019ff17e-31f2-7022-b5ea-bce5a339025c"
            }
        }
    ]
}
```

- 문법과 input coercion 실패는 GraphQL 표준 오류입니다.
- 기존 도메인 오류 객체의 `type`을 `extensions.code`로 노출합니다.
- 예상하지 못한 오류는 `INTERNAL_SERVER_ERROR`와 일반 메시지만 노출합니다.
- Stack, Prisma 오류와 인프라 원문은 응답에 포함하지 않습니다.
- 비밀번호/token variable과 전체 응답을 request log에 기록하지 않습니다.

### HTTP exception filter를 제거한 이유

기존 filter는 `switchToHttp()`로 Express response를 얻고 `response.status().json()`을 직접 호출했습니다.
GraphQL에서 이 방식은 Apollo가 `data`, `errors`, `path`, `extensions`를 조합하기 전에 응답을 끝내므로
GraphQL 오류 계약과 충돌합니다. 또한 GraphQL context의 request가 아닌 resolver 인수를 HTTP 인수로
오인할 수 있습니다.

그래서 전역 `APP_FILTER`는 등록하지 않습니다. 예상 가능한 도메인 오류 변환은 `formatError`, 내부 stack
기록은 Apollo plugin이 담당합니다. 두 경계 모두 query variables와 token payload를 로그에 남기지 않습니다.

공개 `signup`에는 role 입력이 없습니다. 관리자와 판매자 권한 부여는 별도의 인증된 관리 기능이 생기기
전까지 GraphQL로 노출하지 않습니다. 이메일과 전화번호를 반환하는 `members`도 Admin JWT만 허용합니다.
이메일은 로그인 식별자이므로 DB unique 제약으로 동시 가입까지 차단하고, 충돌은 `EXISTING_MEMBER`로
변환합니다. 로그인은 `lastLoginAt IS NULL` 조건부 갱신에 성공한 한 요청에만 `isFirstLogin=true`를
반환하고, 이후 로그인도 마지막 로그인 시각은 계속 갱신합니다.

## 제거한 REST 경계와 API 버전 경계

- Auth/Member/Order v1/v2/v3 Controller
- Auth/Member/Order를 감싸던 최상위 API 버전 디렉터리
- 비교용 주문 v1/v2 module 등록
- Swagger setup과 `/api/docs`
- `@nestjs/swagger`, `express-basic-auth`
- HTTP response를 직접 쓰던 전역 exception filter
- 사용되지 않던 REST pagination DTO

API 버전 경계를 없앤 것은 공개 주문 계약이 `placeOrder` 하나이고, 실제 runtime 구현도 하나이기 때문입니다.
버전 이름으로 전체 도메인을 세 번 나누지 않고 `src/api/order` 안에서 관련 코드를 함께 찾을 수 있게 합니다.

`OrderV1Service`와 `OrderV2Service`는 각각 `order-v1.service.ts`, `order-v2.service.ts`라는 비교 학습용
소스로만 남습니다. 다시 공개해야 한다면 Controller를 복구하지 않고 별도 benchmark/test harness에서
호출합니다. 이 이름의 v1/v2는 공개 API 버전이 아니라 주문 동시성 구현을 구분하는 표식입니다.

## 현재 파일 경계

```text
src/global/graphql/
  graphql.module.ts
  graphql-context.ts
  graphql-error.formatter.ts
  graphql-request-logging.plugin.ts
  money.type.ts

src/api/
  auth/
    application/auth.service.ts
    presentation/auth.resolver.ts
    auth.module.ts
  member/
    application/member.service.ts
    presentation/member.resolver.ts
    member.module.ts
  order/
    application/
      order.service.ts       # Redlock과 transaction 조율
      place-order.command.ts
      order.repository.ts    # Prisma를 모르는 transaction port
      order-v1.service.ts    # 비교용, 공개 API에 미연결
      order-v2.service.ts    # 비교용, 공개 API에 미연결
    domain/
      order.ts
      order-line.ts
      decimal.ts
    infrastructure/
      prisma-order.repository.ts
      orderable-snapshot-item.ts
      order.persistence.ts
    presentation/
      place-order-item.input.ts
      place-order.input.ts
      place-order.mapper.ts
      place-order.payload.ts
      place-order.resolver.ts
      order.type.ts
      order-item.type.ts
      ordered-item-snapshot.type.ts
    order.module.ts
  catalog/
    application/
      get-product.query.ts
      product-read.result.ts
      product.reader.ts
    infrastructure/
      prisma-product.reader.ts
    presentation/
      product.resolver.ts
      product.type.ts
      product-revision.type.ts
      product-item.type.ts
    catalog.module.ts
```

## 다음 구현

canonical `Query.product`까지 구현됐으며 다음 공개 field는 `Query.searchProducts`입니다. GraphQL input/connection/cursor와 OpenSearch Mapping,
rebuild, 관련도 평가, Outbox 동기화 계약은
[OpenSearch GraphQL 상품 검색 구현 계획](search/opensearch-product-search.md)을 따릅니다.

첫 검색 구현에서는 OpenSearch 문서 한 건으로 결과를 완성하므로 DataLoader가 필요하지 않습니다. 이후
GraphQL field resolver가 MySQL relation을 개별 조회하게 될 때만 request-scoped DataLoader를 도입합니다.

## 검증 기준

- TypeScript와 Nest build가 성공함
- 생성 schema에 REST 버전명이 없고 예상한 Query/Mutation만 존재함
- `members`와 `placeOrder`가 같은 Bearer JWT 인증을 사용함
- Member/Item ID가 문자열로 왕복하고 내부에서만 `bigint`가 됨
- 중첩 주문 input validation이 동작함
- `x-request-id`가 response header, error extension과 로그에 연결됨
- GraphiQL/introspection이 `ENV=dev`에서만 활성화됨
- repository에 Controller/Swagger import와 이전 REST URL이 남지 않음
- 기존 application unit test와 주문 service build가 통과함

## 공식 자료

- [NestJS GraphQL quick start](https://docs.nestjs.com/graphql/quick-start)
- [NestJS GraphQL resolver](https://docs.nestjs.com/graphql/resolvers)
- [NestJS GraphQL scalar](https://docs.nestjs.com/graphql/scalars)
- [NestJS Passport와 GraphQL](https://docs.nestjs.com/recipes/passport#graphql)
- [NestJS execution context](https://docs.nestjs.com/fundamentals/execution-context)
- [NestJS GraphQL 13.4.4 package](https://github.com/nestjs/graphql/blob/v13.4.4/packages/graphql/package.json)
- [NestJS Apollo 13.4.4 package](https://github.com/nestjs/graphql/blob/v13.4.4/packages/apollo/package.json)
- [Apollo Server 5 migration](https://www.apollographql.com/docs/apollo-server/migration)
- [GraphQL specification](https://spec.graphql.org/)
