# 애플리케이션 레이어 원칙

이 프로젝트는 필요한 계층만 둡니다. 프레임워크가 이미 제공하는 추상화를 같은 역할의 자체
interface나 wrapper로 다시 감싸지 않습니다.

## 기본 흐름

```text
HTTP Controller 또는 GraphQL Resolver
  -> Service
  -> MikroORM EntityRepository<Entity> 또는 EntityManager
  -> MySQL
```

GraphQL ObjectType과 MikroORM Entity는 외부 계약과 영속성 모델의 변경 이유가 다르므로 분리합니다.
상태 전이와 불변식은 필요할 때 MikroORM Entity가 직접 소유합니다. 타입과 도메인 행동의 상세 기준은
[GraphQL, Entity와 도메인 모델 경계](model-boundaries.md)를 따릅니다. 반면 Service와
`EntityRepository<Entity>` 사이에는 기본적으로 별도 repository 계층을 만들지 않습니다.

## 진입 계층

- Controller와 Resolver는 Service만 주입받습니다.
- Controller와 Resolver는 `EntityRepository`, `EntityManager`, MikroORM Entity를 직접 사용하지 않습니다.
- 입력 검증과 GraphQL ID 문자열 변환, Service 호출, 응답 변환만 담당합니다.
- DB 조회, 트랜잭션, 상태 변경 규칙을 진입 계층에 작성하지 않습니다.

## Service와 Repository

- Service는 `@InjectRepository(Entity)`로 MikroORM의 `EntityRepository<Entity>`를 직접 주입받습니다.
- 여러 Entity를 함께 조회하거나 새 aggregate를 등록하는 Service는 MikroORM `EntityManager`를 직접
  주입받을 수 있습니다. `EntityManager`를 숨기기 위한 전달용 repository는 만들지 않습니다.
- 조회 조건, writer/replica 선택, 상태 변경과 트랜잭션 조율은 해당 유스케이스의 Service가 담당합니다.
- MikroORM의 `EntityRepository`가 이미 repository이므로 같은 메서드를 전달만 하는 custom repository,
  interface, DI Symbol과 provider alias를 만들지 않습니다.
- 테스트 대역이 필요하다는 이유만으로 repository interface를 추가하지 않습니다. Service 테스트에서는
  필요한 `EntityRepository` 메서드만 mock합니다.

예시:

```ts
@Injectable()
export class MemberService {
    constructor(
        @InjectRepository(MemberEntity)
        private readonly repository: EntityRepository<MemberEntity>
    ) {}
}
```

## 트랜잭션

- 여러 Entity를 한 원자 작업으로 변경하는 Service는 주입받은 `EntityManager`에서 `transactional()`을
  시작하거나 MikroORM RequestContext 안에서 `@Transactional()`을 사용합니다.
- 명시적 트랜잭션 callback 안에서는 callback으로 받은 EntityManager만 사용합니다.
- GraphQL 요청은 MikroORM middleware가 RequestContext를 만들며, 단위 테스트는 `RequestContext.create()`로
  같은 실행 경계를 명시합니다.
- RequestContext 안에서 주입된 `EntityManager`와 `EntityRepository`는 현재 transaction fork를 함께
  사용합니다. 새 aggregate는 `persist()`로 Unit of Work에 등록하고, `@Transactional()`의 commit 전
  자동 flush에 맡깁니다.
- 분산락처럼 DB 바깥의 동시성 제어와 DB transaction의 순서는 Service에 명시합니다.
- 공통 조회 조건이나 Entity graph 변환이 실제로 중복될 때는 순수 함수로 추출할 수 있습니다. 함수 추출을
  별도 repository 계층으로 간주하지 않습니다.

## Custom repository 허용 조건

다음 조건을 모두 만족할 때만 custom repository를 검토합니다.

1. 동일한 영속성 로직이 두 개 이상의 Service에서 실제로 중복됩니다.
2. 추출하면 transaction, 조회 정책 또는 불변식이 한곳에서 일관되게 보호됩니다.
3. 단순 메서드 전달이 아니라 의미 있는 중복이 제거됩니다.
4. 구체 구현이 하나뿐인데도 미래의 교체 가능성만을 위해 만든 계층이 아닙니다.

조건을 만족하지 않으면 Service가 MikroORM repository를 직접 사용합니다. OpenSearch처럼 MySQL과 다른
저장소를 사용하는 기능은 해당 검색 Service와 client를 별도로 구성하며, 기존 MySQL 조회를 미리 port로
감싸지 않습니다.

## 현재 적용 형태

```text
MemberResolver -> MemberService -> EntityRepository<MemberEntity>
AuthResolver   -> AuthService   -> EntityRepository<MemberEntity>
ProductResolver -> ProductService -> EntityRepository<ProductEntity>
OrderResolver  -> OrderService  -> EntityManager + EntityRepository<ItemEntity/MemberEntity>
                                -> @Transactional RequestContext transaction
```

Catalog의 일반 조회와 주문은 live `ProductEntity`/`ItemEntity` graph를 사용합니다.
`ProductSnapshotEntity`는 감사와 복원을 위한 추가 전용 변경 이력이므로, 해당 기능을 구현하는
전용 Service 이외의 일반 Query/Mutation Service가 조회하거나 FK로 참조하지 않습니다.

이 원칙은 계층 수를 최소화하기 위한 기본값입니다. 중복과 불변식이라는 실제 근거가 생기면 그때 구조를
추가합니다.
