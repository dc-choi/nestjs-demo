import { Point } from '@influxdata/influxdb-client';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { LoginRequestDto, LoginResponseDto } from '../domain/dto/login.dto';
import { TokenRequestDto, TokenResponseDto } from '../domain/dto/token.dto';

import { REPOSITORY, Repository } from 'prisma/repository';
import { MemberDomain } from '~/api/v1/member/domain/member.domain';
import { InvalidIdOrPassword } from '~/global/common/error/auth.error';
import { NotExistingMember } from '~/global/common/error/member.error';
import { EnvConfig } from '~/global/config/env/env.config';
import { TokenProvider } from '~/global/jwt/token.provider';
import { InfluxDBService } from '~/infra/influxdb/influxdb.service';

@Injectable()
export class AuthService {
    constructor(
        @Inject(REPOSITORY) private readonly repository: Repository,
        private readonly config: ConfigService<EnvConfig, true>,
        private readonly tokenProvider: TokenProvider,
        private readonly influxDBService: InfluxDBService
    ) {}

    async loginLog() {
        const bucket = this.config.get<string>('INFLUX_BUCKET');

        const influxQuery = `from(bucket: "${bucket}")
        |> range(start: -1h)
        |> filter(fn: (r) => r._measurement == "login_events")
        |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
        |> map(fn: (r) => ({
            createdAt: r._time,
            memberId: r.memberId,
            role: r.role,
            email: r.email,
            isFirstLogin: r.isFirstLogin
        }))`;

        return await this.influxDBService.read.collectRows<{
            createdAt: string;
            memberId: string;
            role: string;
            email: string;
            isFirstLogin: boolean;
        }>(influxQuery);
    }

    async login(loginRequestDto: LoginRequestDto) {
        const salt = this.config.get<string>('SECRET');
        const { email, password } = loginRequestDto;

        const findMember = await this.repository.$replica().member.findFirst({
            where: {
                email,
                hashedPassword: MemberDomain.generateHashedPassword(password, salt),
            },
        });
        if (!findMember) throw new UnauthorizedException(new InvalidIdOrPassword());

        const { id, role, lastLoginAt } = findMember;
        const isFirstLogin = !lastLoginAt;

        const { accessToken, refreshToken } = await this.tokenProvider.generateToken(id, role);

        // await this.repository.$primary().member.update({
        //     data: { lastLoginAt: dayjs().toDate() },
        //     where: { id },
        // });

        const point = new Point('login_events')
            .tag('memberId', id.toString())
            .stringField('role', role)
            .stringField('email', email)
            .booleanField('isFirstLogin', isFirstLogin);
        this.influxDBService.write.writePoint(point);
        await this.influxDBService.write.flush();

        return LoginResponseDto.toDto({
            accessToken,
            refreshToken,
            role,
            isFirstLogin,
        });
    }

    async token(authTokenRequestDto: TokenRequestDto) {
        const { accessToken, refreshToken } = authTokenRequestDto;

        const { memberId, role } = await this.tokenProvider.verifyToken(accessToken, refreshToken);
        const findMember = await this.repository.member.findFirst({
            where: {
                id: memberId,
            },
        });
        if (!findMember) throw new UnauthorizedException(new NotExistingMember());

        const { accessToken: newAccessToken, refreshToken: newRefreshToken } = await this.tokenProvider.generateToken(
            memberId,
            role
        );

        return TokenResponseDto.toDto({
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
        });
    }
}
