# nestjs-prisma-demo
NestJS와 Prisma를 사용해서 Demo Server를 제작합니다.

프로덕션에 적용 가능한 수준의 설정을 포함합니다.

## 사용 기술
- NestJS
- Prisma
- MySQL
- Docker
- Redis
- Redlock
- BullMQ

## Prisma Read Replicas 설정

### 왜 Read Replicas를 사용하는가?

**성능과 확장성**
- 대부분의 애플리케이션에서 읽기(SELECT) 비율이 쓰기(INSERT/UPDATE/DELETE)보다 훨씬 높음
- 읽기 부하를 별도의 replica 서버로 분산하여 primary DB의 부담 감소
- Primary는 쓰기에만 집중하고, Replica는 읽기만 처리하여 전체 처리량 향상

**가용성**
- Primary DB 장애 시 Replica를 승격시켜 빠른 복구 가능
- 백업, 분석 등의 무거운 쿼리를 replica에서 실행하여 운영 DB에 영향 최소화

### 동작 방식
- **읽기 쿼리** (SELECT): 자동으로 read replica로 라우팅
- **쓰기 쿼리** (INSERT, UPDATE, DELETE): primary로 라우팅
- **트랜잭션**: 항상 primary에서 실행

### 로그 구분
쿼리 로그에서 primary와 replica를 구분할 수 있습니다:
- Primary: `type: 'PRISMA QUERY'`
- Replica: `type: 'PRISMA REPLICA QUERY'`

### 주의사항
- **복제 지연(Replication Lag)**: Replica는 primary의 변경사항을 비동기로 복제하므로 짧은 지연 발생 가능
  - 방금 쓴 데이터를 즉시 읽어야 하는 경우 주의 필요
  - 최신 데이터가 중요한 경우 명시적으로 primary 사용 고려

## 동시성 제어와 락 전략

### 멀티 인스턴스 환경에서의 락 전략

**상황**: 멀티 인스턴스(Node.js) + 단일 DB(Primary + Replica) + 한 품목에 동시 다수 요청

**결론**: 멀티 인스턴스에서 프로세스(노드) 레벨 락은 무의미하며, **공통 자원(DB or Redis) 기준으로 락을 잡아야 함**

### 1. 통하지 않는 방법들

❌ **Node.js 인스턴스 내부의 Mutex/Lock**
- `const lock = new Mutex()` 같은 방식
- 인스턴스 A에서만 동작하고 B, C는 모름
- 동일한 품목을 여러 인스턴스가 동시에 갱신 가능

❌ **싱글 스레드라서 안전하다는 착각**
- 한 프로세스 내에서는 JS 코드가 싱글 스레드지만
- 인스턴스가 여러 개면 결국 DB로 동시에 요청

✅ **해결책**: 공유 자원 기준 락
- DB 트랜잭션 / 행 락
- Redis 분산락
- 메시지 브로커(큐) 기반 직렬화

### 2. DB 행 락 (SELECT ... FOR UPDATE) - 기본 전략

**가장 기본적이고 권장되는 방법**

#### 개념
- 모든 갱신 로직을 트랜잭션 안에서 처리
- 해당 품목 row를 `SELECT ... FOR UPDATE`로 읽어서 행 단위 락 획득
- 연산/검증 후 UPDATE하고 COMMIT
- 동시에 다른 인스턴스에서 같은 row를 FOR UPDATE 시도 → DB가 알아서 대기/순차 처리

#### SQL 흐름
```mysql-sql
-- 1) 트랜잭션 시작
START TRANSACTION;

-- 2) 해당 품목 row 락 잡기
SELECT *
FROM item
WHERE id = 123
FOR UPDATE;

-- 3) 재고 검증 후
-- 4) UPDATE
UPDATE item
SET quantity = quantity - 10
WHERE id = 123;

-- 5) 커밋
COMMIT;
```

✅ **멀티 인스턴스 환경에서도 문제없음** - DB 한 곳에서 락을 잡아 일관성 보장

### 3. Primary + Read Replica 환경 주의사항

**락은 무조건 Primary에서만 의미 있음**

- 쓰기/갱신/락 관련 쿼리는 전부 Primary로 전송
- `SELECT ... FOR UPDATE`는 반드시 Primary
- Replica는 조회 전용, 심지어 "바로 직후 읽어야 하는 값"도 Primary 사용 권장
  - 이유: 복제 지연(Replication Lag)

### 4. 낙관적 락 (Optimistic Lock)

**충돌 재시도를 허용할 수 있는 경우 사용**

#### 개념
- 테이블에 `version` 컬럼 추가
- 읽을 때 `id, quantity, version` 함께 조회
- 업데이트 시 `WHERE id = ? AND version = ?` 조건
- `affectedRows === 0`이면 다른 트랜잭션이 먼저 수정 → 재시도 or 실패 처리

#### SQL 예시
```sql
UPDATE item
SET quantity = quantity - 10,
    version = version + 1
WHERE id = 123
  AND version = 5;
```

업데이트 결과 `affectedRows`가 0이면 다른 트랜잭션이 먼저 수정한 것이므로 재시도 또는 실패 처리합니다.

**장점**: DB 락으로 인한 wait/timeout 감소
**단점**: 충돌 시 재시도 로직 필요

### 5. Redis 분산 락

**DB 락 외에 전역 락이 필요한 경우**

#### 개념
- `item:123:lock` 같은 키에 SET NX + expire로 락 설정
- 품목 단위로 전역 락 관리

#### 코드 예시 (ioredis)
```ts
import Redis from 'ioredis';
const redis = new Redis();

async function withItemLock<T>(
  itemId: number,
  fn: () => Promise<T>,
): Promise<T> {
  const lockKey = `lock:item:${itemId}`;
  const lockValue = `${Date.now()}-${Math.random()}`;
  const ttlMs = 5000; // 5초

  // SET NX PX
  const acquired = await redis.set(lockKey, lockValue, 'PX', ttlMs, 'NX');

  if (!acquired) {
    throw new Error('Lock not acquired');
  }

  try {
    return await fn();
  } finally {
    // value 체크 후 삭제
    const current = await redis.get(lockKey);
    if (current === lockValue) {
      await redis.del(lockKey);
    }
  }
}

// 사용 예시
async function decreaseStockWithRedisLock(itemId: number, amount: number) {
  return withItemLock(itemId, async () => {
    await decreaseStock(itemId, amount);
  });
}
```

⚠️ **주의**: Redis 분산락은 네트워크 파티션/Redis 장애/클럭 드리프트에 민감
→ DB 트랜잭션 + 제약조건이 여전히 마지막 방어선이어야 함

**권장 패턴**:
- 1차 보호: DB unique constraint, check constraint, foreign key
- 추가 최적화/순서 제어용: Redis 락 or 큐잉

### 6. 같은 품목에 대한 대량 요청 처리

**7000 요청이 전부 같은 item_id를 갱신하는 상황**

어떤 락이든 결국 직렬화는 피할 수 없음 → 아키텍처적 대응 필요

#### 옵션 1: 큐 기반 직렬화
- BullMQ, Kafka(partition by itemId), SQS FIFO, Redis Stream 등
- **같은 itemId는 같은 파티션/그룹으로 보내 한 워커가 순차 처리**
- 예: BullMQ의 경우 `jobId`를 itemId로 설정하거나, Kafka는 partition key로 itemId 사용

#### 옵션 2: 배치 처리
- 요청을 바로 DB 반영하지 않고 delta를 쌓아두었다가
- 특정 주기마다 합산해서 한 번에 처리

### 7. 전략 선택 가이드

**기본값: DB 행 단위 락 (Pessimistic Locking)**
- 모든 갱신 로직을 트랜잭션으로 감싸기
- `SELECT ... FOR UPDATE` (Kysely: `.forUpdate()`)
- 해당 쿼리는 무조건 Primary로 전송

**Read Replica 사용 규칙**
- 쓰기/락/강한 일관성 조회: Primary
- 통계/목록/캐시성 조회: Replica

**충돌 재시도 허용 가능 시: 낙관적 락**
- `version` 컬럼 + `WHERE id=? AND version=?`
- 실패 시 재시도/실패 처리

**추가 직렬화/성능 필요 시**
- Redis 분산락 or BullMQ/Kafka/SQS FIFO
- **같은 itemId는 같은 워커에서 순차 처리** 구조 설계

## Redis & Redlock 설정 가이드

### Redis Cluster vs Redlock의 차이

#### 1. Redis Cluster (`type: 'cluster'`)
- **데이터를 키 해싱 기반으로 여러 노드에 파티셔닝**
- 같은 키는 항상 같은 노드로 라우팅됨
- **주 목적**: 데이터 분산과 고가용성

#### 2. Redlock (여러 독립 Redis 인스턴스)
- **N개의 완전히 독립적인 Redis 마스터 필요**
- 각 인스턴스는 서로 복제되지 않고 독립적
- N개 인스턴스에서 순차적으로 락 획득 시도
- **과반수((N+1)/2) 이상에서 획득해야 성공**
- **주 목적**: 분산 락의 안정성과 내결함성

### 주의사항: Redis Cluster는 Redlock과 호환되지 않음

Redis Cluster를 사용하면 Redlock의 분산 락 목적을 달성할 수 없습니다:

```typescript
// ❌ 잘못된 방법 - 이렇게 하면 안됨
RedisModule.forRootAsync({
    inject: [ConfigService],
    useFactory: (configService: ConfigService<EnvConfig, true>) => ({
        type: 'cluster',  // ❌ 모든 락 키가 같은 노드로 라우팅됨
        nodes: [
            { url: configService.get<string>('REDIS_URL_1') },
            { url: configService.get<string>('REDIS_URL_2') },
            { url: configService.get<string>('REDIS_URL_3') },
        ],
    }),
})
```

**문제점**:
- 모든 락 키가 클러스터 내 같은 노드로 라우팅됨
- Redlock의 분산 락 목적을 달성할 수 없음
- 단일 실패점(Single Point of Failure) 문제 발생

### 올바른 Redlock 설정 방법

3개의 독립적인 Redis 인스턴스를 사용하는 경우:

```typescript
import Redis from 'ioredis';

// 환경변수에 3개의 Redis URL 추가
// REDIS_URL_1=redis://localhost:6379
// REDIS_URL_2=redis://localhost:6380
// REDIS_URL_3=redis://localhost:6381

// 1. 독립적인 Redis 인스턴스 생성을 위한 Provider들
const REDIS_CLIENT_1 = 'REDIS_CLIENT_1';
const REDIS_CLIENT_2 = 'REDIS_CLIENT_2';
const REDIS_CLIENT_3 = 'REDIS_CLIENT_3';

// providers 배열에 추가:
{
    provide: REDIS_CLIENT_1,
    inject: [ConfigService],
    useFactory: (configService: ConfigService<EnvConfig, true>) => {
        return new Redis(configService.get<string>('REDIS_URL_1'));
    },
},
{
    provide: REDIS_CLIENT_2,
    inject: [ConfigService],
    useFactory: (configService: ConfigService<EnvConfig, true>) => {
        return new Redis(configService.get<string>('REDIS_URL_2'));
    },
},
{
    provide: REDIS_CLIENT_3,
    inject: [ConfigService],
    useFactory: (configService: ConfigService<EnvConfig, true>) => {
        return new Redis(configService.get<string>('REDIS_URL_3'));
    },
},

// 2. Redlock provider - 3개 모두 주입
{
    provide: RED_LOCK,
    inject: [REDIS_CLIENT_1, REDIS_CLIENT_2, REDIS_CLIENT_3],
    useFactory: (redis1: Redis, redis2: Redis, redis3: Redis) => {
        return new Redlock([redis1, redis2, redis3], {
            retryCount: DEFAULT_LOCK_MAX_RETRIES,
            retryDelay: DEFAULT_LOCK_BASE_DELAY,
        });
    },
}
```

### 단일 Redis 인스턴스 사용 (현재 설정)

단순히 효율성 목적으로만 락을 사용하는 경우:

```typescript
// ✅ 현재 프로젝트 설정
RedisModule.forRootAsync({
    inject: [ConfigService],
    useFactory: (configService: ConfigService<EnvConfig, true>) => ({
        type: 'single',  // 단일 Redis 인스턴스
        url: configService.get<string>('REDIS_URL'),
    }),
}),

// Redlock provider
{
    provide: RED_LOCK,
    inject: [getRedisConnectionToken()],  // 기본 Redis 인스턴스 주입
    useFactory: (redis: Redis) => {
        return new Redlock([redis], {
            retryCount: DEFAULT_LOCK_MAX_RETRIES,
            retryDelay: DEFAULT_LOCK_BASE_DELAY,
        });
    },
},
```

**단일 인스턴스가 적절한 경우**:
- 효율성 목적으로만 락을 사용
- Redlock의 복잡성과 비용이 불필요
- 필요시 비동기 복제를 통한 백업으로 충분

### 결론

- **Redis Cluster**로 변경하면 Redlock이 제대로 작동하지 않음
- **독립적인 여러 Redis 인스턴스**를 따로 설정해야 Redlock의 분산 락 목적 달성 가능
- 단순한 사용 사례에서는 **단일 인스턴스**가 더 효율적

## 요청 단위 추적 (Request Tracing)

### ClsModule 기반 요청 컨텍스트 관리 (nestjs-cls)
AsyncLocalStorage 기반으로 요청별 컨텍스트 자동 관리

파일: src/app.module.ts:133 (ClsModule.forRoot 설정)

### 트랜잭션 컨텍스트와 requestId 관리 통합 
- Middleware로 자동 추적
- ClsModule의 middleware.mount: true 설정으로 자동 활성화
- AppModule에서 전역 적용 (별도 미들웨어 불필요)

### x-request-id 헤더 처리
- 요청 헤더에 x-request-id가 있으면 해당 값 사용
- 없으면 Node.js `crypto.randomUUIDv7()`로 새로 생성

### 응답 헤더에 x-request-id 자동 추가
- requestId 자동 포함
- Winston 설정에서 ClsServiceManager.getClsService().getId() 사용
- 모든 로그 라인에 requestId 필드 자동 추가
- HTTP 요청 생명주기 동안 자동 전파

### 비동기 컨텍스트 주의사항
- HTTP 요청: ClsModule Middleware에 의해 자동으로 컨텍스트 생성 및 전파
- 워커/크론/비동기 작업: 컨텍스트가 자동 전파되지 않음
- 수동 설정 방법 (두 가지 방식):
    ```ts
    import { ClsService } from "nestjs-cls";
    import { randomUUIDv7 } from "node:crypto";
    
    constructor(private readonly cls: ClsService) {}
    
    // 방법 1: enterWith() - 현재 컨텍스트에 즉시 진입 (동기/비동기 모두 사용 가능)
    async someJob() {
      this.cls.enterWith({ CLS_ID: randomUUIDv7() }); // requestId 설정
      // 이후 모든 로그에 requestId가 자동 포함됨
      await this.doWork();
      // 작업 완료 후에도 requestId 유지됨
    }
    
    // 방법 2: run() - 콜백 범위 내에서만 컨텍스트 격리
    async anotherJob() {
      await this.cls.run(async () => {
        this.cls.set("CLS_ID", randomUUIDv7()); // requestId 설정
        // 이 콜백 내에서만 requestId가 유효
        await this.doWork();
      });
      // 콜백 외부에서는 requestId 접근 불가
    }
    ```

## tips
- app도 컨테이너, db도 컨테이너로 실행하면 다음 설정처럼 해야함.
- host.docker.internal

```dotenv
DATABASE_URL={db}://{id}:{password}@host.docker.internal:{port}/{schema}
```
