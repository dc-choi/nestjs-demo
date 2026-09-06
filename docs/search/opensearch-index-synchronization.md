# OpenSearch 증분 동기화와 재구축

상태: Outbox lease 갱신/재처리 이력, 유지보수 barrier, 전체 rebuild와 reconciliation 구현

이 문서는 [상품 검색 구현](opensearch-product-search.md)의 MySQL/OpenSearch 정합성 경계를 설명합니다.
실행 명령은 [로컬 실행과 운영 Runbook](../operations/local-runtime-runbook.md)을 따릅니다.

## 보장과 허용 범위

- 상품 변경 DB transaction은 OpenSearch 장애와 무관하게 성공할 수 있습니다.
- Commit된 Catalog 변경은 같은 transaction의 Outbox에 남아 재시도할 수 있습니다.
- 늦게 도착한 과거 작업은 최신 검색 문서를 덮지 못합니다.
- OpenSearch는 MySQL의 live Catalog 현재 상태에서 다시 만들 수 있습니다.
- 검색 문서의 짧은 지연과 reconciliation 전의 일시적 불일치는 허용합니다.

MySQL이 source of truth입니다. 감사용 `ProductSnapshot.payload`와 OpenSearch 문서는 현재 상태를
확정하는 원본이 아닙니다.

## 현재 증분 경로

```text
상품 변경 MySQL transaction
  +-- Product/Item/live relation 변경
  +-- Product row lock 아래 Product.revision 증가
  +-- ProductSnapshot append-only 감사 이력 추가
  +-- SearchProjectionOutbox(productId, productRevision) 추가

application background worker 또는 search:outbox:drain
  -> 처리 가능한 Outbox row lease
  -> MySQL primary에서 현재 live Catalog와 revision 재조회
  -> write Alias에 문서 전체 upsert 또는 versioned delete
  -> PROCESSED 또는 backoff/DEAD_LETTER 기록
```

현재 relay는 외부 message broker를 거치지 않습니다. 검색을 활성화한 애플리케이션의 background worker가
1초 간격으로 relay를 호출하고, 수동 CLI도 같은 relay를 사용합니다. `FOR UPDATE SKIP LOCKED`로 처리 직전에
한 행씩 claim합니다. 기본 batch는 최대 50행이며, 5분 lease를 처리 중 2분 30초마다 소유 토큰 조건으로
갱신합니다. 소유권을 잃은 실행은 상태를 덮지 않습니다. Claim과 만료 회수는 시도 예산을 소모하지 않고,
실제 동기화 실패만 누적합니다. 열 번째 실패는 `DEAD_LETTER`로 남으며 명시적 재처리와 이력을 지원합니다.
유지보수 차단은 실패 횟수를 올리지 않고 짧게 지연한 뒤 해당 drain을 종료합니다.

최초 rebuild 전처럼 write Alias가 아직 없으면 background worker는 Outbox를 claim하지 않고 기다립니다.
Alias가 생긴 다음 poll부터 자동으로 전달을 시작하므로 초기화 순서 때문에 정상 event가
`DEAD_LETTER`로 소진되지 않습니다.

`ProductSnapshot.payload`는 감사와 복원용입니다. Outbox에는 Product ID와 trigger revision만 저장하며,
worker는 항상 MySQL primary의 현재 graph를 다시 읽습니다. 검색 문서에 stock을 넣지 않으므로 독립적인
재고 변경은 Catalog revision/검색 Outbox 대상이 아닙니다.

### Worker revision 규칙

Worker가 primary에서 읽은 `currentProductRevision`을 실제 OpenSearch external version으로 사용합니다.

- `eventRevision < currentProductRevision`: 최신 현재본과 현재 revision으로 수렴
- `eventRevision == currentProductRevision`: 해당 현재본으로 수렴
- `eventRevision > currentProductRevision`: DB 불변식 또는 primary read 오류로 실패

별도 `projectionRevision`이나 전역 Outbox ID를 version으로 사용하지 않습니다. 같은 Product row를 잠근
상태에서 증가시킨 `Product.revision`만 Product별 commit 순서를 표현합니다. 유효 범위는
`1..2,147,483,647`입니다.

## External version과 Bulk

증분 upsert/delete는 write Alias의 Bulk API를 사용합니다.

- `version_type=external`
- version은 현재 `Product.revision`
- `require_alias=true`
- NDJSON 마지막 newline 보장
- HTTP 응답뿐 아니라 모든 Bulk item의 status/error 검사
- `429`와 `5xx`만 제한 재시도

동일하거나 오래된 revision은 409가 될 수 있습니다. Worker는 오류 문자열을 정합성 판단 근거로 쓰지
않고 현재 문서를 GET해 external version과 결정적 source가 MySQL desired projection에 이미 수렴했는지
확인합니다. Alias가 없으면 같은 이름의 물리 인덱스를 자동 생성하지 않고 실패합니다.

Delete version 표식은 `index.gc_deletes` 기간 뒤 영구 보장되지 않습니다. 삭제 전 요청이 그보다 오래
멈춘 뒤 재개되는 극단적인 상황에서는 문서가 잠시 되살아날 수 있습니다. 현재 구현은 영속 tombstone이나
Product별 장기 lease 대신 reconciliation으로 이를 다시 삭제하는 사후 수렴 모델을 사용합니다.

## 전체 rebuild와 Alias 전환

Mapping/Analyzer가 바뀌면 기존 인덱스를 제자리 수정하지 않고 새 물리 인덱스를 MySQL에서 만듭니다.

```text
새 strict Mapping 인덱스 생성
  -> MySQL live Catalog를 Product ID batch로 읽음
  -> Product.revision external version으로 Bulk 색인
  -> 한 번 refresh
  -> MySQL/root Count 일치 검사
  -> 표본 document와 기본 query 검사
  -> read/write Alias를 한 _aliases 요청으로 전환
```

Bulk 일부가 실패하거나 count/sample/query 검사가 실패하면 Alias를 전환하지 않습니다. `nested` Item은
내부 Lucene document를 추가하므로 `_cat/indices`의 저수준 `docs.count`가 아니라 root Count API를
Product 수로 사용합니다.

`--no-activate --evaluation-alias <alias>`를 사용하면 read/write Alias는 그대로 두고 평가 후보 Alias만
새 인덱스에 연결할 수 있습니다.

### 활성 rebuild의 유지보수 barrier

활성 rebuild는 `catalog_maintenance` singleton 행에 차단 상태를 먼저 commit합니다. Catalog command와
검색 worker/repair는 공유 잠금을, rebuild는 배타 잠금을 사용하므로 여러 서버에서도 같은 진입 제한을
따릅니다. 진행 중인 작업 때문에 배타 잠금을 얻지 못하면 시작을 거절하므로 잠시 뒤 다시 실행합니다.
차단 중 상품 변경은 일시적 사용 불가 오류를 반환하며, 일반 조회와 독립 재고 변경은 계속됩니다.

1. 차단 상태를 영속화하고 새 Catalog command와 projection 진입을 막습니다.
2. 새 인덱스를 build하고 count/sample/query와 전체 source를 대조합니다.
3. 차이가 없을 때 Alias를 전환하고 유지보수 상태를 해제합니다.
4. 남은 Outbox는 최신 primary 상태로 수렴하므로 drain 후 reconciliation으로 확인합니다.

실패나 process 중단 시 차단 상태가 남습니다. 원인을 고친 뒤 새 build ID로
`search:rebuild --resume-maintenance`를 실행합니다. 별도 해제 명령은 제공하지 않습니다.
잠금 연결이 살아 있는 rebuild는 다른 resume을 거절합니다. 모든 Catalog writer가 이 barrier를 사용하는
버전으로 배포된 뒤 실행해야 하며, 직접 SQL로 Catalog를 변경하는 경로는 보호하지 않습니다.

활성 rebuild는 시작할 때 read/write Alias 대상을 고정하고, 그 직후와 batch 시작, 최종 전환 직전에
원래 잠금 연결로 소유권을 재검증합니다. 전환은 고정 대상에 대한 `remove.must_exist=true`와 새 Alias
추가를 한 요청에 묶습니다. 새 owner가 이미 전환했다면 이전 실행의 지연 요청은 전체가 거절됩니다.
최초 생성의 경합도 `is_write_index=true`의 단일 write index 제약으로 전체가 거절됩니다.

DB 확인과 외부 Alias 요청은 한 transaction이 아닙니다. 연결을 잃은 이전 요청이 먼저 전환하면 새 실행의
조건부 전환이 실패하고 차단 상태가 유지됩니다. 이전 프로세스를 종료하고 새 build ID로 다시 resume합니다.
대상을 자동으로 다시 읽어 전환을 재시도하거나 차단 상태만 해제하지 않습니다. 이 보장은 매번 새 물리
인덱스를 만들고 활성 Alias를 이 rebuild 경로에서만 바꾸는 경우에 적용됩니다. 수동 Alias 변경과 과거
인덱스로의 직접 rollback은 복구 절차에 포함하지 않습니다.

`--no-activate` 평가는 쓰기를 차단하지 않으므로 고정 fixture로 비교합니다. 무중단 backfill을 위한 후보
sink별 delivery는 제공하지 않습니다. Alias API는 Alias membership 변경만 원자적으로 처리합니다.

## Reconciliation

`search:reconcile`은 다음 두 방향을 모두 대조합니다.

- MySQL 검색 노출 Product를 batch로 읽고 read Alias에서 `MISSING`/`STALE` 확인
- PIT와 `search_after`로 read Alias 전체를 scan하고 MySQL에 없는 `EXTRA` 확인

문서 비교는 Product ID/revision만 보지 않고 projection source 전체를 결정적으로 비교합니다. 기본 실행은
차이와 제한된 표본만 출력하는 읽기 전용 검사입니다. `--repair`를 명시하면 같은 worker로 누락/오래된
문서를 upsert하고 초과 문서를 versioned delete합니다. 복구 뒤 읽기 전용 검사를 다시 실행해야 합니다.

감사용 `ProductSnapshot`은 대조 원본에 포함하지 않습니다.

## 실패 주입과 통과 기준

검증할 실패 시나리오:

- live graph/revision/Snapshot/Outbox 중 하나의 저장 실패와 전체 rollback
- Bulk의 일부 item 실패
- 같은 Product event 중복 전달
- 최신 event 뒤 과거 event 도착
- OpenSearch 중단 중 Outbox 누적과 복구 후 drain
- relay process 중단과 lease 만료 뒤 재처리
- Alias 누락 상태의 upsert/delete fail-closed
- read Alias의 누락/오래됨/초과 문서 탐지와 repair
- 새 인덱스 검증 실패 시 기존 Alias 유지
- 잠금 연결 종료 뒤 재개가 먼저 완료돼도 이전 실행의 지연 요청이 Alias를 되돌리지 않음
- 이전 요청이 먼저 전환한 경합에서 차단 유지와 다음 resume 성공

통과 기준:

- Catalog live graph, revision, Snapshot과 Outbox가 함께 commit/rollback됩니다.
- 중복/역순 event가 최신 문서를 덮지 못합니다.
- OpenSearch 장애 중 DB 상품 변경은 성공하고 Outbox가 남습니다.
- Bulk 부분 실패가 성공으로 보고되지 않습니다.
- Alias 전환은 rebuild 검증 뒤 한 요청으로 실행됩니다.
- reconciliation이 세 종류 차이를 탐지하고 repair 뒤 0건으로 수렴합니다.
- `DEAD_LETTER` 원인과 재처리 여부를 운영자가 확인할 수 있습니다.

## 참고 자료

- [Bulk API](https://docs.opensearch.org/latest/api-reference/document-apis/bulk/)
- [Index document 외부 버전](https://docs.opensearch.org/latest/api-reference/document-apis/index-document/)
- [Delete document와 gc_deletes](https://docs.opensearch.org/latest/api-reference/document-apis/delete-document/)
- [Alias API](https://docs.opensearch.org/latest/api-reference/alias/aliases-api/)
- [PIT와 search_after](https://docs.opensearch.org/latest/search-plugins/searching-data/paginate/)
