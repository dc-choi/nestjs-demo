import { Point } from '@influxdata/influxdb3-client';
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
        const influxQL = `
            SELECT time AS createdAt, memberId, role, email, isFirstLogin
            FROM login_events
            WHERE time > now() - 1h
        `;

        return await this.influxDBService.query<{
            createdAt: string;
            memberId: string;
            role: string;
            email: string;
            isFirstLogin: boolean;
        }>(influxQL, 'influxql');
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

        // InfluxDB 3 Line Protocol format or Point
        const point = Point.measurement('login_events')
            .setTag('memberId', id.toString())
            .setField('role', role, 'string')
            .setStringField('email', email)
            .setUintegerField('lastLoginAt', lastLoginAt ? new Date(lastLoginAt).getTime() : 0)
            .setBooleanField('isFirstLogin', isFirstLogin);

        await this.influxDBService.write(point);

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
