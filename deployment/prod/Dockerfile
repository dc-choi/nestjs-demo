# Build stage
FROM node:26.7.0-alpine AS builder

ARG NODE_ENV

WORKDIR /home/node

ENV NODE_ENV=${NODE_ENV} \
    TZ=Asia/Seoul

RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/$TZ /etc/localtime && \
    echo $TZ > /etc/timezone && \
    npm i -g pnpm@11.21.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm prebuild && \
    pnpm prod:build && \
    pnpm prune --prod

# Production stage
FROM node:26.7.0-alpine

ARG NODE_ENV

WORKDIR /home/node

ENV NODE_ENV=${NODE_ENV} \
    TZ=Asia/Seoul

RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/$TZ /etc/localtime && \
    echo $TZ > /etc/timezone

COPY --from=builder /home/node/dist ./dist
COPY --from=builder /home/node/node_modules ./node_modules
COPY --from=builder /home/node/package.json ./

CMD ["node", "dist/src/main.js"]
