# nestjs-prisma-demo

NestJS, Prisma, MySQL, Redis를 사용한 데모 API 서버입니다.
여러 데이터 접근 방식과 주문 처리 흐름을 비교하기 위한 실험용 프로젝트입니다.

## 요구 사항

- Node.js 26.7.0
- pnpm
- MySQL
- Redis

## 실행

```sh
nvm use
pnpm install
pnpm dev
```

실행 전 [환경 변수 타입](src/global/config/env/env.config.ts)과 [시작 시 검증 스키마](src/app.module.ts)를 충족하는 `.env`가 필요합니다.

## 검증

```sh
pnpm lint
pnpm unit
pnpm stage:build
pnpm prod:build
```

## 주요 진입점

- [Prisma 클라이언트와 Read Replica](prisma/repository.ts)
- [애플리케이션 구성과 요청 컨텍스트](src/app.module.ts)
- [주문 처리 v1](src/api/v1/order/application/order.service.ts)
- [주문 처리 v2](src/api/v2/order/application/orderV2.service.ts)
- [주문 처리 v3](src/api/v3/order/application/orderV3.service.ts)
