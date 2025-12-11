import { InfluxDBClient } from '@influxdata/influxdb3-client';
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
                const host = configService.get<string>('INFLUX_URL');
                const token = configService.get<string>('INFLUX_TOKEN');

                if (!host || !token) {
                    throw new Error('INFLUX_URL / INFLUX_TOKEN is not set');
                }

                return new InfluxDBClient({ host, token });
            },
            inject: [ConfigService],
        },
        InfluxDBService,
    ],
    exports: [InfluxDBService],
})
export class InfluxDBModule {}
