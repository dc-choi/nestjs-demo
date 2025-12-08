import { Module } from '@nestjs/common';

import { AuthService } from './application/auth.service';
import { AuthController } from './presentation/auth.controller';

import { TokenModule } from '~/global/jwt/token.module';
import { InfluxDBModule } from '~/infra/influxdb/influxdb.module';

@Module({
    imports: [TokenModule, InfluxDBModule],
    controllers: [AuthController],
    providers: [AuthService],
})
export class AuthModule {}
