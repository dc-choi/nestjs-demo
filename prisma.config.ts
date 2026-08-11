import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
    },
    // Prisma CLI와 migration은 DATABASE_URL, 앱 런타임은 MYSQL_* adapter 설정을 사용한다.
    datasource: {
        url: env('DATABASE_URL'),
    },
});
