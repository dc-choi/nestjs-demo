# 추천시스템 더미 SQL 생성과 로컬 적재

Python 표준 라이브러리로 상품, 사용자와 행동 SQL을 생성하고 전용 MySQL DB에서 조회합니다.
Python 3.9 이상과 MySQL 8을 사용합니다. 생성기는 DB에 접속하지 않으며 별도 Python 패키지 설치가 필요하지 않습니다.

## SQL 생성

저장소 루트에서 실행합니다.

```sh
python3 -m recommender.generate_sql --profile smoke
python3 -m recommender.generate_sql --profile dev
python3 -m recommender.generate_sql --profile main
```

| 프로필 | 사용자 | 상품 | 목표 행동 수 |
|---|---:|---:|---:|
| smoke | 100 | 100 | 2,000 |
| dev | 10,000 | 1,000 | 1,000,000 |
| main | 100,000 | 10,000 | 10,000,000 |

기간은 모두 2026-01-01부터 90일이며 실제 이벤트 수는 목표보다 최대 360건 많을 수 있습니다.
기본 seed는 `20261103`입니다. 같은 환경과 소스, seed, 프로필이면 압축 SQL의 SHA-256이 같습니다.

출력 디렉터리가 이미 있으면 덮어쓰지 않고 실패합니다. 다시 생성할 때는 새 경로를 지정합니다.

```sh
python3 -m recommender.generate_sql --profile main --seed 42 \
  --output recommender/output/main-seed42
```

생성이 실패하면 출력 디렉터리와 `.partial` 파일이 남을 수 있습니다. 완료된 `dataset.sql.gz`만 적재합니다.
새 실행은 다른 출력 디렉터리를 사용합니다. 생성물과 Python 캐시는 Git과 Docker build context에서 제외합니다.

## 생성물

`recommender/output/<profile>/`에 다음 파일을 만듭니다.

| 파일 | 용도 |
|---|---|
| `dataset.sql.gz` | CREATE TABLE과 1,000행 단위 INSERT. 날짜별 transaction으로 적재 |
| `manifest.json` | 규모, seed, 시간 경계, Python/생성기 버전, SQL/소스 checksum |
| `summary.json` | 실제 유형별/일별 행 수, 경로별 전환 수, 생성 시간과 최대 메모리 |
| `private/users.jsonl.gz` | 생성기 전용 취향, 활동량과 변화 조건. 모델 입력에서 제외 |
| `private/popularity.json` | 생성기가 사용한 상품 인기 순위. 모델 인기 점수와 구분 |

현재 구현은 요청에 맞춰 SQL을 출력합니다. CSV와 날짜별 압축 CSV 출력은 구현하지 않았습니다.
원본 스키마는 [`recommender/schema.sql`](../../recommender/schema.sql), 실행 진입점은
[`generate_sql.py`](../../recommender/generate_sql.py)입니다.

## 새 로컬 DB에 적재

기존 애플리케이션 DB와 분리된 새 DB를 사용합니다. 아래 계정 값은 로컬 `.env`의 `MYSQL_USER`에 맞춥니다.
기존 `.env`의 `MYSQL_DATABASE`는 바꾸지 않습니다. mysql 명령이 PATH에 있으면 `MYSQL_BIN=mysql`을 사용합니다.

```sh
MYSQL_BIN=/usr/local/mysql/bin/mysql
MYSQL_USER='로컬_DB_계정'

"$MYSQL_BIN" --host=127.0.0.1 --port=3306 --user="$MYSQL_USER" -p \
  -e 'CREATE DATABASE demo_nest_recommender CHARACTER SET utf8mb4;'

set -o pipefail
gzip -dc recommender/output/main/dataset.sql.gz | \
  "$MYSQL_BIN" --host=127.0.0.1 --port=3306 --user="$MYSQL_USER" -p \
  --default-character-set=utf8mb4 demo_nest_recommender
```

생성 시 압축을 사용하므로 SQL 전체를 해제한 파일로 저장할 필요가 없습니다. MySQL이 비밀번호를 물으면 직접
입력합니다. SQL은 UTF-8, UTC와 엄격한 SQL 모드를 사용하고 세션의 기존 SQL 모드는 마지막에 복원합니다.

DB나 테이블이 이미 있으면 생성이 실패합니다. 이 경우 자동 삭제나 중복 무시는 하지 않으며 새로운 DB 이름을
사용합니다. `--force`로 오류를 무시하지 않습니다. 중간 오류가 나면 앞 날짜의 COMMIT은 남을 수 있으므로
불완전한 DB에 SQL 전체를 다시 실행하지 않습니다.

## 적재 테이블과 완료 확인

- `rec_products`: Product 단위 상품과 카테고리, 태그. `product_key`는 향후 Catalog slug 매핑용입니다.
- `rec_users`: 합성 사용자 키와 가입 시각. 실제 회원 인증 정보나 숨은 취향은 포함하지 않습니다.
- `rec_events`: 조회, 장바구니와 구매 이벤트. 사용자/상품 FK와 사용자/상품별 시각 및 경로 인덱스가 있습니다.
- `rec_dataset`: 기대 행 수와 완료 상태. 모든 데이터 적재 후 `is_complete=1`을 명시적으로 COMMIT합니다.

기본 SQL은 NestJS의 `products`, `members`, 주문/결제/재고 테이블을 생성하지 않습니다.
[주문/결제 확장](commerce-data.md)을 이어 적재하면 같은 전용 DB에 애플리케이션 스키마의 합성 거래를 추가합니다.
기존 앱 DB와 `.env`는 변경하지 않으며 이 데이터만으로 기존 GraphQL에 실습 상품이 나타나지는 않습니다.
이 전용 DB에 애플리케이션 migration이나 schema update를 별도로 실행하지 않습니다.

```sh
"$MYSQL_BIN" --host=127.0.0.1 --port=3306 --user="$MYSQL_USER" -p \
  --default-character-set=utf8mb4 demo_nest_recommender < recommender/inspect.sql
```

[`inspect.sql`](../../recommender/inspect.sql)은 읽기 전용입니다. 완료 표시와 실제 행 수, 유형별 고유 쌍,
기간별 이벤트 수, 잘못된 시간/경로 수와 학습 기간 구매 기반 인기 상품을 조회합니다.
실제 행 수가 `rec_dataset`의 값과 같고 `invalid_event_times`, `invalid_journeys`는 각각 0이어야 합니다.
대용량의 DISTINCT와 경로 집계는 시간이 걸릴 수 있습니다.

생성 시 메모리에 전체 고유 쌍 집합을 쌓지 않습니다. 고유 쌍은 적재 후 SQL로 계산합니다.
활동 집단별 고유 쌍과 평가 시작 시점의 신규 사용자 집계는 아직 자동 보고하지 않으며 모델 평가 단계에서
보완합니다. 전체 생성 명세의 모든 분석 항목을 완료한 것으로 보지 않습니다.

## 개발 검증

```sh
python3 -m unittest discover -s recommender/tests -v
```

재현성, 사용자/상품 배정, 시간/가입 경계, 행동 경로, 예산, 취향 변화, SQL 문자열과 출력 덮어쓰기 방지를
검증합니다. CI에도 같은 테스트를 연결합니다. 실제 DB 검증은 smoke SQL 적재와 `inspect.sql`로 수행합니다.

## 생성 검증 기록

2026-11-03, Python 3.9.6, seed `20261103`, 생성기 버전 2로 본 규모의 SQL을 생성했습니다.

- 사용자 100,000명, 상품 10,000개, 행동 10,000,040건.
- 조회 8,764,498건, 장바구니 955,275건, 구매 280,267건.
- 생성 85.806초, 프로세스 최대 메모리 269,942,784 bytes, 압축 SQL 147,702,251 bytes.
- 로컬 MySQL 8.0.31에서 smoke 2,041건 적재와 시간/경로 검사를 통과했습니다.
  자동 커밋을 끈 세션에서도 재접속 뒤 완료 표시와 실제 행 수가 유지됐습니다.
- 전용 로컬 DB `demo_nest_recommender`에 본 데이터 10,000,040건 적재와 검사를 완료했습니다.
  적재/검사 합계 355.949초였으며 `invalid_event_times`, `invalid_journeys`는 모두 0입니다.
  구매 고유 사용자-상품 쌍은 274,853개입니다. 생성된 이벤트 수와 구분합니다.
- unittest 12개와 독립 코드 검토를 통과했습니다. 모델 학습과 GraphQL 연결의 검증 결과는 아닙니다.

상세 생성 가정은 [더미 데이터 생성 명세](synthetic-data-spec.md), 모델 학습 순서는
[상품 추천시스템 실습 계획](product-recommender-plan.md)을 따릅니다.
