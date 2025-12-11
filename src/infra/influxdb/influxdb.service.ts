import { InfluxDBClient, QueryType, WritableData } from '@influxdata/influxdb3-client';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvConfig } from '~/global/config/env/env.config';
import { INFLUXDB_CLIENT } from '~/infra/influxdb/influxdb.symbol';

@Injectable()
export class InfluxDBService {
    private readonly _database: string;

    constructor(
        @Inject(INFLUXDB_CLIENT) private readonly _client: InfluxDBClient,
        private readonly configService: ConfigService<EnvConfig, true>
    ) {
        this._database = this.configService.get<string>('INFLUX_DATABASE');
    }

    get client() {
        return this._client;
    }

    get database() {
        return this._database;
    }

    async write(record: WritableData): Promise<void> {
        await this._client.write(record, this._database, undefined, { precision: 'ns' });
    }

    async query<T = Record<string, unknown>>(query: string, queryType: QueryType = 'sql'): Promise<T[]> {
        const rows: T[] = [];
        const reader = this._client.query(query, this._database, { type: queryType });
        for await (const row of reader) {
            rows.push(row as T);
        }
        return rows;
    }
}
