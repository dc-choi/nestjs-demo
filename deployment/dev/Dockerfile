# Build stage
FROM node:26.7.0-alpine AS builder

ARG NODE_ENV

WORKDIR /home/node

ENV NODE_ENV=${NODE_ENV} \
    TZ=Asia/Seoul

RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/$TZ /etc/localtime && \
    echo $TZ > /etc/timezone && \
    npm i -g pnpm@10.11.0

COPY package.json pnpm-lock.yaml prisma tsconfig.json tsconfig.build.json ./

RUN pnpm i;

COPY .. .

RUN pnpm prebuild && \
    pnpm stage:build

# Production stage
FROM node:26.7.0-alpine

ARG NODE_ENV

WORKDIR /home/node

ENV TZ=Asia/Seoul

RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/$TZ /etc/localtime && \
    echo $TZ > /etc/timezone && \
    npm i -g pnpm@10.11.0

COPY --from=builder /home/node/dist ./dist
COPY --from=builder /home/node/node_modules ./node_modules
COPY --from=builder /home/node/.env ./
COPY --from=builder /home/node/package.json ./
COPY --from=builder /home/node/tsconfig.json ./
COPY --from=builder /home/node/tsconfig.build.json ./

CMD ["pnpm", "stage:boot"]
