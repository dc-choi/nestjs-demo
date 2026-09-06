# 로컬 실행과 운영 Runbook

이 문서는 로컬 MySQL/Redis, MikroORM migration과 seed, OpenSearch 검색 runtime, 결제 Webhook을
재현 가능한 순서로 실행하는 절차를 정리합니다. 환경 변수의 기준은
[`.env.example`](../../.env.example), 실제 명령의 기준은 [`package.json`](../../package.json)입니다.

## 1. 환경 준비

요구 버전은 Node.js 26.7 이상 27 미만, pnpm 11.21.0입니다.

```sh
nvm use
corepack enable
pnpm install
```

이미 사용 중인 `.env`가 있으면 그대로 유지합니다. 새 checkout처럼 파일이 없는 경우에만
`cp .env.example .env`로 시작한 뒤 로컬 서비스의 실제 접속값을 입력합니다.

`.env`의 `SECRET`, `OPENSEARCH_CURSOR_SECRET`, `DEMO_SEED_PASSWORD`는 예시 문자열을 그대로 사용하지 말고
로컬 전용 임의 값으로 바꿉니다. Cursor secret은 32자 이상이어야 하며 `DEMO_SEED_PASSWORD`는 8자
이상이어야 합니다. 결제 Webhook에 별도 키를 쓰려는 환경에서만 선택 항목인
`PAYMENT_WEBHOOK_SECRET`을 32자 이상으로 지정합니다. 지정하지 않으면 기존 `SECRET`을 HMAC key로
사용합니다. `.env`는 커밋하지 않습니다.

## 2. MySQL과 Redis

로컬 개발은 host에 설치된 기존 MySQL을 우선 사용합니다. `.env`의 `MYSQL_*`와
`MYSQL_READ_REPLICA_*`를 같은 로컬 서버에 맞추면 별도의 Docker MySQL은 필요하지 않습니다. 서버가 켜져
있는지와 TCP 접속이 되는지 먼저 확인합니다.

```sh
/usr/local/mysql/support-files/mysql.server status
lsof -nP -iTCP:3306 -sTCP:LISTEN
```

Redis도 이미 실행 중인 host 또는 기존 컨테이너가 있으면 `.env`의 `REDIS_URL`로 그대로 사용합니다.

`deployment/compose/docker-compose.yaml`의 MySQL/Redis는 로컬 서비스가 없는 환경을 위한 선택 항목입니다.
이미 3306에서 MySQL이 실행 중일 때는 `db` 서비스를 시작하지 않습니다. 선택적으로 Compose를 사용할
때만 충돌하지 않는 포트를 명시합니다.

```sh
COMPOSE_MYSQL_PORT=3307 docker compose \
  -f deployment/compose/docker-compose.yaml up -d db

MYSQL_PORT=3307 MYSQL_READ_REPLICA_PORT=3307 pnpm dev
```

Compose Redis만 필요하면 다음처럼 `cache` 서비스만 시작할 수 있습니다.

```sh
docker compose -f deployment/compose/docker-compose.yaml up -d cache
```

Compose 리소스를 사용한 경우 데이터를 보존한 채 컨테이너만 내릴 수 있습니다.

```sh
docker compose -f deployment/compose/docker-compose.yaml down
```

`down -v`는 MySQL volume을 삭제하므로 초기화가 명시적으로 필요한 경우에만 사용합니다.

## 3. MikroORM migration

애플리케이션 시작은 schema를 자동 변경하지 않습니다. Entity 변경은 migration 파일로 검토하고 적용합니다.
새 버전 기동 전 `20260905000200`, `20260905000300`, `20260905000400` 마이그레이션으로 웹훅 복구 필드,
검색 재처리 감사 이력과 유지보수 singleton을 먼저 적용합니다. 현재 fresh DB의 초기 기준은
[`Migration20260904140344_initial_schema.ts`](../../src/infra/database/migrations/Migration20260904140344_initial_schema.ts)입니다.

### 변경 SQL 확인과 migration 생성

```sh
pnpm database:schema:dump
pnpm database:migration:create --name add-example
git status --short src/infra/database/migrations
git diff -- src/infra/database/migrations
```

`database:schema:dump`는 대상 DB와 metadata의 차이를 출력하는 읽기 전용 점검입니다. 생성된 migration에서
테이블 삭제, 컬럼 축소, nullable 변경과 대량 rewrite 가능성을 먼저 검토합니다. 운영 환경에서 migration을
즉석 생성하지 않습니다.

### 적용 전후 검사

```sh
pnpm database:migration:check
pnpm database:migration:pending
pnpm database:migrate
pnpm database:migration:pending
pnpm database:schema:dump
pnpm database:migration:check
```

`database:migration:check`는 Entity metadata와 migration snapshot 사이에 새 migration이 필요한지 검사하고,
`database:migration:pending`은 대상 DB의 미적용 목록을 보여줍니다. 적용 후 `database:schema:dump` 출력이
추가 스키마 변경 SQL을 포함하지 않아야 실제 DB와 metadata가 일치합니다.

배포 산출물에서는 TypeScript CLI 대신 빌드된 실행기를 사용합니다.

```sh
pnpm prod:build
pnpm database:migrate:prod
```

`database:migrate:down`은 데이터를 되돌리거나 잃을 수 있습니다. 대상 migration과 `down` SQL을 확인하고
복구 가능한 백업이 있을 때만 한 단계씩 실행합니다. 새 배포를 자동 복구하는 기본 수단으로 사용하지
않습니다.

## 4. 멱등 seed

seed는 `DEMO_SEED_PASSWORD`를 8자 이상으로 필수 입력받고, 고정 비밀번호를 소스에
저장하지 않습니다. Admin/Seller/Customer 회원, 카테고리, 활성 상품과 두 Item, revision별 Snapshot,
초기 입고 원장과 검색 Outbox를 만듭니다. 비밀번호는 사용자별 salt를 가진 scrypt 해시로 저장합니다.
기존 HMAC 계정은 기존 `SECRET`으로 로그인 검증한 뒤 자동 이관하므로 이관 전 키를 바꾸지 않습니다.

```sh
pnpm database:seed
pnpm database:seed
```

두 번째 실행은 같은 자연 키를 기준으로 기존 demo 데이터를 재사용해야 합니다. 실행 뒤에는 회원, 상품,
상품 Snapshot, 재고 원장과 검색 Outbox의 중복이 생기지 않았는지 확인합니다. seed는 개발/검증용이며 운영
사용자나 실제 결제 정보를 만들기 위한 도구가 아닙니다.

## 5. 애플리케이션

OpenSearch 없이 기존 API만 실행하려면 `.env`에서 `OPENSEARCH_ENABLED=false`를 유지합니다.

```sh
pnpm dev
```

기본 GraphQL endpoint는 `http://127.0.0.1:3000/graphql`입니다. 별도 terminal에서 다음 gate를 실행합니다.

```sh
pnpm lint
pnpm unit
pnpm stage:build
pnpm prod:build
pnpm e2e
```

실제 MySQL 통합 suite는 기존 `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`,
`MYSQL_DATABASE` 설정을 그대로 읽습니다. 데이터 보호를 위해 `MYSQL_DATABASE`가 `_integration`으로 끝나는
전용 DB에서만 실행하고, 실제 서비스 DB에서는 실행하지 않습니다.

```sh
pnpm integration:mysql
```

### 만료된 주문 재고 예약 정리

만료 작업은 빌드 산출물의 bounded CLI로 실행합니다. 한 번에 선택할 예약 후보 수는 기본 100개이며
1 이상 500 이하로 제한됩니다.

```sh
pnpm prod:build
pnpm inventory:expire --limit 100
```

CLI는 만료 시각이 지난 `RESERVED` 예약을 가진 `PENDING` 주문을 찾습니다. 주문 행을 먼저 잠그고 그 주문의
모든 `RESERVED` 예약이 만료됐는지 확인합니다. 아직 유효한 예약이나 `CONSUMED` 또는 `RELEASED` 예약이
섞여 있으면 해당 주문을 실패로 기록합니다. 검사를 통과하면 남은 `RESERVED` 예약을 함께 `EXPIRED`로
바꾸고 재고/원장을 복구하며, 취소 가능한 결제 시도와 주문 상태 이력을 같은 transaction에서 정리합니다.
결과 JSON의 `selectedOrders`, `expiredOrders`, `failures`를 확인합니다.
`failures`가 하나라도 있으면 종료 코드는 1입니다. backlog가 남을 수 있으므로 배포 환경의 scheduler나
운영 job에서 제한된 배치를 반복 실행하고, 실패 원인을 확인한 뒤 재실행합니다.

## 6. OpenSearch 로컬 runtime

OpenSearch는 애플리케이션과 별도 Compose project로 실행합니다. 이미지는 OpenSearch 3.8.0에
`analysis-nori`를 설치하며 host의 `127.0.0.1:9200`에만 공개합니다. Security plugin을 끈 단일 노드이므로
로컬 실습 전용입니다.

```sh
docker compose -f deployment/opensearch/docker-compose.yaml build
docker compose -f deployment/opensearch/docker-compose.yaml up -d
docker compose -f deployment/opensearch/docker-compose.yaml ps
```

Cluster와 Nori 설치를 확인합니다.

```sh
curl --fail --silent --show-error 'http://127.0.0.1:9200/_cluster/health?pretty'
curl --fail --silent --show-error 'http://127.0.0.1:9200/_cat/plugins?v'
curl --fail --silent --show-error \
  -H 'content-type: application/json' \
  -X POST 'http://127.0.0.1:9200/_analyze' \
  --data '{"tokenizer":"nori_tokenizer","text":"무선 기계식 키보드"}'

pnpm integration:opensearch
```

애플리케이션에서는 `GET /health/search`로 같은 연결 상태를 확인할 수 있습니다. 검색이 활성화됐지만
OpenSearch에 연결할 수 없으면 이 endpoint는 503을 반환합니다. 검색이 비활성화된 경우에는 외부 연결을
시도하지 않고 비활성 상태를 200으로 반환합니다.

전용 `_integration` MySQL DB와 OpenSearch를 함께 준비한 뒤에는 실제 전체 경로도 검증합니다.

```sh
pnpm integration:search-pipeline
```

이 suite는 migration으로 만든 스키마를 유지한 채 전용 DB 데이터만 정리하고, Catalog 변경을 commit한 뒤
rebuild, background relay와 동일한 lease 처리, 최종 reconciliation 0건까지 확인합니다.

애플리케이션과 CLI에서 검색을 사용할 때는 다음 값을 설정합니다.

```dotenv
OPENSEARCH_ENABLED=true
OPENSEARCH_NODE_URL=http://127.0.0.1:9200
OPENSEARCH_READ_ALIAS=catalog-products-read
OPENSEARCH_WRITE_ALIAS=catalog-products-write
OPENSEARCH_CURSOR_SECRET=replace-with-a-long-random-cursor-secret
```

## 7. 전체 rebuild와 Alias 전환

CLI는 Nest application context를 사용하므로 MySQL, Redis와 OpenSearch 환경 변수가 모두 필요합니다.
먼저 migration을 적용하고 production 산출물을 만듭니다. 활성 rebuild는 DB의 유지보수 상태를 통해
모든 서버의 Catalog command와 검색 projection 진입을 자동 차단합니다.

```sh
pnpm prod:build
pnpm search:rebuild --analyzer standard
```

Rebuild는 새 물리 인덱스를 생성하고 MySQL의 검색 노출 대상 Product를 bounded batch로 읽습니다. Bulk 각
항목, root document 수, 표본 문서, 기본 query와 전체 source를 검증한 뒤 한 Alias 요청으로 read/write Alias를
전환합니다. 검증 전에 Alias를 옮기지 않습니다.

옵션:

```sh
pnpm search:rebuild \
  --build-id local-standard-001 \
  --batch-size 100 \
  --analyzer standard

pnpm search:rebuild \
  --build-id local-nori-001 \
  --analyzer nori \
  --no-activate \
  --evaluation-alias catalog-products-nori-candidate
```

후보 인덱스는 `--no-activate`로 만들고 별도 evaluation Alias에 연결합니다. 이 경로는 쓰기를 차단하지
않으므로 고정 fixture로 비교합니다. 활성 rebuild의 절차는 다음과 같습니다.

1. 모든 Catalog writer를 유지보수 barrier가 포함된 버전으로 배포합니다.
2. `search:rebuild`를 실행합니다. 진행 중인 command/projection 때문에 잠금을 얻지 못하면 재시도합니다.
3. 검증과 Alias 전환이 성공하면 차단이 자동 해제됩니다.
4. `search:outbox:drain`, `search:reconcile`로 남은 event와 최종 차이를 확인합니다.

실패하면 DB의 차단 상태가 남아 상품 변경이 일시적으로 거절됩니다. 원인을 고친 뒤 새 build ID로 복구합니다.

```sh
pnpm search:rebuild --resume-maintenance --build-id recovered-001
```

재개도 전체 build와 검증을 성공해야 차단을 해제합니다. 실행 중인 rebuild가 잠금을 보유하면 다른 재개는
거절됩니다. 직접 SQL 변경과 이전 버전 writer는 이 제한을 따르지 않으므로 함께 실행하지 않습니다.

Alias 대상이 바뀌어 조건부 전환이 거절되면 이전 rebuild 프로세스를 종료하고 새 build ID로 다시 재개합니다.
차단 상태만 해제하거나 Alias를 수동으로 과거 인덱스에 되돌리지 않습니다. 다른 재개가 이미 성공한 뒤
이전 실행만 실패했다면 현재 유지보수 상태와 Alias를 확인하며, 실패 메시지만으로 재개를 반복하지 않습니다.

## 8. Outbox relay와 reconciliation

Catalog command는 live graph, `Product.revision`, 감사 Snapshot과 검색 Outbox를 같은 MySQL transaction에
저장합니다. OpenSearch 장애는 이 DB transaction을 되돌리지 않습니다. 별도 message broker는 사용하지
않습니다. 검색을 활성화한 애플리케이션의 background worker가 1초 간격으로 Outbox를 lease해 전달하며,
여러 인스턴스가 실행돼도 DB lease가 같은 행의 동시 처리를 막습니다. CLI drain은 초기 rebuild 전후와
장애 복구 때 backlog를 즉시 비우는 운영 명령입니다.

write Alias가 아직 없는 최초 bootstrap에서는 background worker가 Outbox를 claim하지 않고 기다립니다.
`search:rebuild`가 Alias를 만든 뒤 다음 poll부터 자동으로 전달합니다.

```sh
pnpm search:outbox:drain
pnpm search:reconcile
```

Relay는 작업 직전 한 행씩 claim하고 batch당 최대 50행, 최대 100 batch를 처리합니다. 처리 가능한 행이
없어지면 일찍 종료한 뒤 JSON 합계를 출력합니다. 한 실행에서 5,000행을 claim했다면 남은 행을 위해
다시 실행합니다. 실패 행은 backoff 뒤
재시도하며 실제 실패 10회에 `DEAD_LETTER`로 남깁니다. Lease 회수와 유지보수 차단은 횟수를 늘리지 않습니다.
원인을 고친 뒤 명시 ID 또는 product 범위와 한도, 사유를 지정해 재처리합니다. 이전 오류/횟수는 감사 이력에 남습니다.

```sh
pnpm search:outbox:inspect --limit 50
pnpm search:outbox:retry --id 123 --id 124 --reason "연결 설정 복구"
pnpm search:outbox:retry --product-id 42 --limit 10 --reason "매핑 복구"
pnpm search:outbox:drain
```

Reconciliation은 기본적으로 읽기 전용입니다. MySQL과 read Alias의 누락, 오래된 문서, 초과 문서를
확인한 뒤 차이를 실제로 고칠 때만 다음 명령을 사용합니다.

```sh
pnpm search:reconcile --repair
pnpm search:reconcile
```

증분 upsert/delete는 `Product.revision`을 OpenSearch external version으로 사용하고 write Alias가 없으면
실패합니다. 오래된 event가 최신 문서를 덮지 못하지만, delete version 보존 기간을 넘긴 장기 지연에는
reconciliation이 최종 수렴 경계입니다.

## 9. 검색 품질 비교

평가 fixture는 query, 검색 input, Product별 관련도 judgment를 JSON으로 기록합니다.

```json
{
    "name": "local-korean-catalog-v1",
    "queries": [
        {
            "id": "wireless-keyboard",
            "input": { "query": "무선 키보드", "first": 10 },
            "judgments": { "1": 3, "2": 1 }
        }
    ]
}
```

위 예시를 `/tmp/demo-nest-search-judgments.json`에 저장한 뒤 동일 fixture로 현재 read Alias와 후보
Alias를 비교합니다.

```sh
pnpm search:evaluate \
  --fixture /tmp/demo-nest-search-judgments.json \
  --baseline catalog-products-read \
  --candidate catalog-products-nori-candidate
```

출력에는 nDCG@10, Recall@10, underfill/zero-result 비율, no-match false-positive 비율, p95 latency와
query별 결과가 포함됩니다. 로컬 p95는 같은 환경의 상대 비교값이며 운영 SLO가 아닙니다.

## 10. 결제 Webhook 계약

HTTP 진입점은 `POST /webhooks/payments/:provider`입니다. 다음 header가 필요합니다.

- `x-payment-event-id`: provider 안에서 유일한 event ID
- `x-payment-signature`: 64자리 HMAC-SHA256 hex, 선택적으로 `sha256=` prefix 사용
- `content-type: application/json`

서명 입력은 구분점까지 포함한 다음 byte sequence입니다.

```text
<provider>.<event-id>.<raw-request-body>
```

`PAYMENT_WEBHOOK_SECRET`이 있으면 이를 HMAC key로 사용하고, 없으면 기존 `SECRET`을 사용합니다. JSON을
parse한 뒤 다시 직렬화하면 byte가 달라져 서명이 실패하므로 전송할 raw body 그대로 서명합니다.

아래 예시는 실행 중인 애플리케이션과 같은 secret을 shell에 주입하고, 앞서 `createPaymentAttempt`로
`provider=demo`, `providerPaymentId=pay-local-001`인 결제 시도를 만든 경우에 성공합니다. 일치하는 결제
시도가 없으면 검증된 최소 명령을 inbox에 보존하고 HTTP background worker가 재시도합니다.

```sh
webhook_signing_secret='same-secret-used-by-the-running-app'
provider='demo'
event_id='evt-local-001'
payload='{"providerPaymentId":"pay-local-001","outcome":"CAPTURED","providerTransactionId":"tx-local-001"}'
signature=$(printf %s "${provider}.${event_id}.${payload}" | \
  openssl dgst -sha256 -hmac "$webhook_signing_secret" -hex | awk '{print $2}')

curl --fail --silent --show-error \
  -H 'content-type: application/json' \
  -H "x-payment-event-id: ${event_id}" \
  -H "x-payment-signature: sha256=${signature}" \
  -X POST "http://127.0.0.1:3000/webhooks/payments/${provider}" \
  --data-binary "$payload"
```

`outcome`은 `CAPTURED`, `FAILED`, `REFUNDED` 중 하나입니다. 매입에는 provider transaction ID, 실패에는
error code, 환불에는 provider transaction ID와 금액이 추가로 필요합니다. 같은 provider/event ID에 같은
payload가 다시 오면 기존 결과로 수렴하고, 다른 payload가 오면 충돌로 거절합니다.

현재 구현은 provider 중립적인 결제 상태/원장과 HMAC 수신 adapter입니다. 실제 PG의 승인 API 호출,
provider별 secret/서명 규격 변환과 정산은 포함하지 않습니다. HTTP worker는 서명 검증된 `RECEIVED` 행을
lease와 backoff로 처리 실패를 최대 10회 재시도합니다. 결제 시도가 아직 없는 경우에는 예산을 소모하지 않고
60초 뒤 다시 확인합니다. 환불이 매입보다 먼저 도착한 경우도 선행 매입을 기다립니다. 관리 API는
저장된 서명 검증 명령의 내용을 바꿔 처리할 수 없습니다. 원문 body 대신 hash와 최소 처리 필드, 최대 1,000자의 실패 진단을 저장합니다. 검증 필드가
없는 과거 이벤트는 원본을 복원할 수 없으므로 provider의 재전송이 필요합니다. 배송도 관리자 GraphQL
command로 포장/발송/배송완료 상태와 수량을 기록하지만 실제 택배사 API, 송장 구매와 배송 추적 연동은
포함하지 않습니다.

## 11. 종료

```sh
docker compose -f deployment/opensearch/docker-compose.yaml down
docker compose -f deployment/compose/docker-compose.yaml down
```

volume은 유지됩니다. 데이터 초기화가 목적이 아니라면 `-v`를 추가하지 않습니다.
