import { Global, Inject, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { MysqlAdapterProvider, MysqlReadReplicaAdapterProvider } from './mysql.adapter';
import { REPOSITORY, Repository, RepositoryProvider } from './repository';

@Global()
@Module({
    providers: [RepositoryProvider, MysqlAdapterProvider, MysqlReadReplicaAdapterProvider],
    exports: [REPOSITORY],
})
export class DaoModule implements OnModuleInit, OnModuleDestroy {
    constructor(@Inject(REPOSITORY) private readonly repository: Repository) {}

    async onModuleInit() {
        // primary와 모든 replica에 함께 연결하므로 어느 한쪽의 연결 실패도 앱 시작을 막는다.
        await this.repository.$connect();
    }

    async onModuleDestroy() {
        await this.repository.$disconnect();
    }
}
