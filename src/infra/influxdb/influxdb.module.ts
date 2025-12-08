import { InfluxDB } from '@influxdata/influxdb-client';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvConfig } from '~/global/config/env/env.config';
import { InfluxDBService } from '~/infra/influxdb/influxdb.service';
import { INFLUXDB_CLIENT } from '~/infra/influxdb/influxdb.symbol';

@Module({
    imports: [],
    providers: [
        {
            provide: INFLUXDB_CLIENT,
            useFactory: (configService: ConfigService<EnvConfig, true>) => {
                const url = configService.get<string>('INFLUX_URL');
                const token = configService.get<string>('INFLUX_TOKEN');

                if (!url || !token) {
                    throw new Error('INFLUX_URL / INFLUX_TOKEN is not set');
                }

                return new InfluxDB({ url, token });
            },
            inject: [ConfigService],
        },
        InfluxDBService,
    ],
    exports: [InfluxDBService],
})
export class InfluxDBModule {}
