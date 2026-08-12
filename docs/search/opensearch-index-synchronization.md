# OpenSearch 증분 동기화와 재구축

상태: 4, 5단계 계획, 구현 전

이 문서는 [상품 검색 구현 계획](opensearch-product-search.md)의 고급 단계입니다. 전체 rebuild와 최소
`searchProducts` Query가 동작하고, DRAFT 생성/수정, 발행 검증, `ProductPublication` 교체를 하나의 서비스로 구현해
transaction 계약을 테스트한 뒤에만 시작합니다.

## 보장하려는 것과 허용하는 것

- 상품 발행 DB transaction은 OpenSearch 장애와 무관하게 성공할 수 있음
- Commit된 변경은 Outbox에 남아 재시도할 수 있음
- 늦게 도착한 과거 작업은 최신 검색 문서를 덮지 못함
- OpenSearch는 언제든 MySQL 현재 상태에서 다시 만들 수 있음
- 검색 문서의 짧은 지연과 reconciliation 전의 일시적 불일치는 허용함

이번 실습은 영속 tombstone이나 Product별 장기 worker lease를 만들지 않습니다. 따라서 삭제 전 payload를
읽은 Worker가 아주 오래 멈춘 경우에는 문서가 일시적으로 되살아날 수 있으며, reconciliation으로 다시
수렴시키는 한계를 의도적으로 받아들입니다.

## 상품 발행과 Outbox

```text
상품 발행 MySQL transaction
  +-- Snapshot 검증
  +-- PUBLISHED 전환
  +-- ProductPublication 교체
  +-- Product별 projectionRevision 증가
  +-- SearchProjectionOutbox 기록

Outbox relay
  -> CATALOG_SEARCH_QUEUE
  -> 검색 worker
  -> MySQL primary에서 현재 Publication과 revision 재조회
  -> 문서 전체 upsert 또는 versioned delete
```

DB commit 뒤 바로 BullMQ에 job을 넣는 것만으로는 충분하지 않습니다. Commit은 성공했지만 job 발행이
실패하는 구간이 생기므로 Publication, Product별 revision과 Outbox를 같은 MySQL transaction에
저장합니다. 기존 주문 큐와 검색 색인 큐도 분리합니다.

### Worker 재조회 계약

Worker는 event에 담긴 과거 Snapshot payload를 그대로 색인하지 않습니다. MySQL primary에서 현재
Publication, projection 원본과 `currentProjectionRevision`을 한 consistent read로 가져옵니다.
OpenSearch 요청에는 trigger message의 revision이 아니라 이 조회에서 함께 얻은 현재 revision을
사용합니다.

- `eventRevision < currentProjectionRevision`: 더 최신 상태를 읽은 것이므로 현재 payload/revision으로 처리
- `eventRevision == currentProjectionRevision`: 해당 현재 상태로 처리
- `eventRevision > currentProjectionRevision`: primary read 또는 DB 불변식 오류로 보고 재시도

이 규칙은 오래된 event도 현재본으로 수렴시키며 같은 revision이 서로 다른 payload를 가리키지 않게
합니다. 검색 문서 결과에 영향을 주는 Publication, Product 상태/삭제, Item 노출 상태 변경은 모두 같은
Product row lock 아래에서 revision 증가와 Outbox 기록을 수행해야 합니다.

## Product별 projectionRevision

`ProductSnapshot.version`은 OpenSearch 외부 version으로 사용할 수 없습니다. 과거 Snapshot을 다시
발행하는 정상 롤백에서 값이 작아질 수 있기 때문입니다.

```text
Snapshot v1 발행: projectionRevision 41
Snapshot v2 발행: projectionRevision 42
Snapshot v1 재발행: projectionRevision 43
```

전역 자동 증가 Outbox ID도 그대로 사용하지 않습니다. 동시 transaction에서는 ID 할당 순서와 commit
순서가 다를 수 있습니다. Product별 projection 상태를 같은 Product row lock 아래에서 증가시키고 그
값을 Outbox에 복사합니다. 같은 Product의 revision만 commit 순서대로 단조 증가하면 됩니다.

DB에는 signed `BIGINT`로 저장해 row lock 아래에서 원자적으로 증가시키고 애플리케이션 내부에서는
JavaScript `bigint`로 유지합니다. Queue JSON과 `_source` 경계에서만 10진 문자열로 바꾸며 `number`로
변환하지 않습니다. opensearch-js의 typed version 필드에 unsafe cast하지 않고, 좁은 Bulk NDJSON action
serializer가 문자열을 non-negative long으로 검증한 뒤 따옴표 없는 JSON integer token으로 기록합니다.
`Long.MAX_VALUE` 경계까지 실제 OpenSearch에 전달하는 통합 테스트를 이 adapter의 계약으로 둡니다.

## OpenSearch 외부 version

증분 upsert와 delete는 write Alias를 대상으로 Bulk API로 통일합니다.

- `version_type=external`과 Product별 현재 revision 사용
- `require_alias=true`로 Alias가 없을 때 fail-closed
- 동일 revision 409와 오래된 revision 409를 다른 입력 오류와 구분
- payload 결정성이 증명되기 전에는 `external_gte`를 사용하지 않음

409 응답의 오류 문자열이나 실패 item `_version`을 파싱해 판정하지 않습니다. 현재 문서를 GET한 결과에
따라 다음처럼 처리합니다.

- 문서가 있으면 저장된 `_version`/source와 DB의 현재 desired projection을 비교
- 문서가 404이고 DB desired state가 delete이면 이미 수렴한 no-op
- 문서가 404인데 DB desired state가 upsert이면 invariant 오류 또는 일시 상태로 보고 재조회/재시도

통합 테스트는 `Long.MAX_VALUE` 문자열 version을 실제 서버가 처리하는지, 범위를 벗어나거나 숫자가
아닌 문자열을 serializer가 요청 전에 거절하는지 확인합니다.

단위 테스트는 JavaScript 안전 정수보다 큰 revision의 문자열 보존, Bulk action serializer의 long
경계값과 잘못된 문자열 거절을 먼저 확인합니다.

Bulk 요청의 `require_alias=true`가 Alias 누락 시 자동 인덱스 생성을 막는 correctness 장치입니다.
Worker 활성화 전에 Alias target도 확인하고, 누락 시 요청을 실패시킨 뒤 Alias 복구 후 Outbox를
재처리합니다.

### 내부 version에서 전환

초기 rebuild의 내부 version과 새 Product revision을 같은 물리 인덱스에서 바로 섞지 않습니다. Product별
revision을 DB에 초기화한 뒤 빈 새 물리 인덱스에 모든 문서를 external version으로 다시 색인합니다.
검증과 read/write Alias 전환이 끝난 뒤에만 Outbox relay를 활성화합니다.

### 삭제 version의 한계

삭제의 외부 version 표식은 `index.gc_deletes` 기간 이후 영구히 유지되지 않습니다. 삭제 전 payload를
읽은 Worker가 이 기간보다 오래 멈춘 뒤 더 낮은 external version으로 upsert하면 문서가 일시적으로
되살아날 수 있습니다. Primary DB 재조회는 새 작업의 payload를 올바르게 만들지만 이미 멈춰 있는 요청을
취소하지는 못합니다.

이번 실습에서는 이 일시 부활을 허용하고 reconciliation이 DB 현재 상태와 다른 문서를 탐지해 다시
삭제하는 사후 수렴 모델을 사용합니다. 더 강한 삭제 보장이 필요해지면 영속 tombstone 문서 또는
Product별 worker lease를 별도 단계로 설계합니다.

## 재구축과 후보 인덱스 catch-up

Mapping과 index-time Analyzer는 기존 문서에 소급 적용되지 않습니다. 호환되지 않는 변경은 새 물리
인덱스를 MySQL에서 다시 만들고 Alias로 전환합니다. 기존 OpenSearch 인덱스는 누락되거나 오래된
projection을 이미 포함할 수 있으므로 재구축 원본으로 사용하지 않습니다.

```text
새 물리 인덱스 생성
  -> 후보용 write Alias와 replay sink 등록
  -> DB 현재 Publication 전체 backfill
  -> 후보용 Outbox replay와 sink별 delivery catch-up
  -> root count, revision sample, 핵심 query 검증
  -> 짧은 cutover barrier에서 in-flight 작업 drain
  -> 후보 sink 미전달 Outbox 0건과 DB revision 최종 대조
  -> read/write Alias 원자적 전환
  -> 관찰 기간 후 이전 인덱스 제거
```

Outbox row마다 sink별 delivery 상태를 두고 기존/후보 인덱스에 각각 성공했는지 기록합니다. 정상 Worker가
기존 write Alias만 갱신하는 동안 후보 sink의 미전달 row를 계속 replay합니다. Backfill 문서는 Product별
현재 revision을 사용하며 external version이 replay 순서 역전을 막습니다.

자동 증가 Outbox ID는 처리할 row를 찾는 cursor로만 사용합니다. Commit 순서나 정합성 version으로
해석하지 않습니다. 더 정확히는 후보 sink 등록을 발행과 같은 DB 잠금 경계에서 원자적으로 완료한 뒤,
`Outbox LEFT JOIN Delivery(candidate)` 형태로 delivery가 없거나 성공하지 않은 모든 commit된 row를 반복
재검색합니다. ID는 한 번의 안정된 batch scan 안에서만 페이지 정렬 키로 쓰며 `id > lastCheckpoint`를
영구 완료 기준으로 사용하지 않습니다. 그래야 ID를 먼저 할당받고 늦게 commit된 row를 건너뛰지
않습니다.

마지막에는 짧은 cutover barrier에서 발행 작업과 검색 Worker의 in-flight 요청을 drain합니다. Barrier
아래에서 후보 sink의 missing/unfinished delivery와 in-flight 작업이 모두 0이고 DB 현재 revision 표본이
후보 문서와 일치해야 catch-up 완료입니다. 그다음 read/write Alias의 remove/add와 후보용 임시 Alias
제거를 한 `_aliases` 요청으로 실행합니다.

Alias API의 원자성은 그 한 요청 안의 Alias membership 변경만 보장합니다. Backfill/catch-up 정합성,
이미 실행 중인 query 완료와 안전한 rollback까지 보장하지 않습니다. 이전 인덱스도 변경을 계속 받았거나
원본 Outbox를 replay할 수 있을 때만 Alias rollback을 사용합니다. 그렇지 않으면 새 인덱스를 고치는
forward-fix를 선택합니다.

## Reconciliation

Reconciliation은 주기적으로 MySQL 현재 공개 Product와 OpenSearch root 문서를 범위별로 대조합니다.
단순 total count만 같다고 완료하지 않고 다음 값을 확인합니다.

- Product ID의 누락/초과 집합
- Product별 `projectionRevision`
- 현재 `productSnapshotId`
- 검색 노출 Item 수와 최소/최대 가격 표본

몇 건의 차이는 Product ID별 재색인으로 복구하고, 넓은 범위의 차이나 Mapping 오류는 전체 rebuild로
복구합니다. `nested` Item은 내부 Lucene 문서를 추가하므로 저수준 index `docs.count`가 아니라 root
Count API를 사용합니다.

## 실패 주입 시나리오

- Publication과 Outbox 중 하나만 저장하려다 transaction rollback
- Bulk 요청에서 일부 item만 실패
- 같은 Product event 중복 전달
- 최신 event 뒤에 과거 event 도착
- OpenSearch 중단 중 Outbox 누적과 복구 후 replay
- Alias가 사라진 상태의 upsert/delete fail-closed
- delete 후 `gc_deletes` 기간보다 오래 멈춘 과거 upsert의 일시 부활과 복구
- 새 인덱스 backfill 중 상품 발행
- 후보 sink에 일부 Outbox만 전달된 상태
- Alias 전환 뒤 query 회귀 발견

## 통과 기준

- Publication, Product revision과 Outbox가 함께 commit/rollback됨
- 같은 Product revision이 commit 순서대로 단조 증가함
- 중복/역순 event가 최신 문서를 덮지 못함
- Alias 누락 시 같은 이름의 물리 인덱스를 만들지 않음
- OpenSearch 장애 중 DB 발행은 성공하고 Outbox가 남음
- 후보 sink의 미전달 row가 0인 상태에서만 cutover함
- Alias 전환은 검증 뒤 한 요청으로 실행됨
- 일시 부활/누락을 reconciliation으로 탐지하고 복구함
- rollback 가능한 조건과 forward-fix가 필요한 조건을 설명할 수 있음

## 참고 자료

- [Bulk API](https://docs.opensearch.org/latest/api-reference/document-apis/bulk/)
- [Index document 외부 버전](https://docs.opensearch.org/latest/api-reference/document-apis/index-document/)
- [Delete document와 gc_deletes](https://docs.opensearch.org/latest/api-reference/document-apis/delete-document/)
- [Alias API](https://docs.opensearch.org/latest/api-reference/alias/aliases-api/)
- [MySQL InnoDB AUTO_INCREMENT](https://dev.mysql.com/doc/refman/8.0/en/innodb-auto-increment-handling.html)
