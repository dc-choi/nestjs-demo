import { InfluxDB, QueryApi, WriteApi } from '@influxdata/influxdb-client';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvConfig } from '~/global/config/env/env.config';
import { INFLUXDB_CLIENT } from '~/infra/influxdb/influxdb.symbol';

@Injectable()
export class InfluxDBService {
    private readonly _writeApi: WriteApi;
    private readonly _queryApi: QueryApi;

    constructor(
        @Inject(INFLUXDB_CLIENT) influxDB: InfluxDB,
        private readonly configService: ConfigService<EnvConfig, true>
    ) {
        const org = this.configService.get<string>('INFLUX_ORG');
        const bucket = this.configService.get<string>('INFLUX_BUCKET');

        // precision: 'ns' or 'ms' etc
        this._writeApi = influxDB.getWriteApi(org, bucket, 'ns');
        this._queryApi = influxDB.getQueryApi(org);
    }

    get write() {
        return this._writeApi;
    }

    get read() {
        return this._queryApi;
    }
}
