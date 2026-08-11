import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventBus } from '@nestjs/cqrs';

import { FindAllMemberResponseDto } from '../domain/dto/findAllMember.dto';
import { SignupRequestDto, SignupResponseDto } from '../domain/dto/signup.dto';
import { SignupEvent } from './event/signup.event';

import { REPOSITORY, Repository } from 'prisma/repository';
import { IdBlackList } from '~/api/v1/member/domain/idBlackList';
import { MemberDomain } from '~/api/v1/member/domain/member.domain';
import { ExistingMember, InvalidMember } from '~/global/common/error/member.error';
import { EnvConfig } from '~/global/config/env/env.config';

@Injectable()
export class MemberService {
    constructor(
        @Inject(REPOSITORY) private readonly repository: Repository,
        private readonly config: ConfigService<EnvConfig, true>,
        private readonly eventBus: EventBus
    ) {}

    async signup(signupRequestDto: SignupRequestDto) {
        const emails = this.config.get<string>('MAIL_SIGNUP_ALERT_USER');
        const salt = this.config.get<string>('SECRET');
        const { name, password, email, phone, role } = signupRequestDto;

        if (IdBlackList.includes(name)) throw new BadRequestException(new InvalidMember());

        // replica의 사전 조회는 최근 또는 동시 가입을 놓칠 수 있으므로 유일성을 보장하지 않는다.
        const findMember = await this.repository.$replica().member.findFirst({
            where: {
                name,
                email,
            },
        });
        if (findMember) throw new ConflictException(new ExistingMember());

        const newMember = await this.repository.$primary().member.create({
            data: {
                name,
                email,
                hashedPassword: MemberDomain.generateHashedPassword(password, salt),
                phone,
                role,
            },
        });

        this.eventBus.publish(new SignupEvent(email, name, phone, emails));

        return SignupResponseDto.toDto(newMember);
    }

    async findAll() {
        // 목록 조회는 복제 지연을 허용하므로 replica를 사용한다.
        return FindAllMemberResponseDto.toDto(
            await this.repository
                .$replica()
                .$kysely.selectFrom('members as m')
                // .leftJoin('items as i', 'm.id', 'i.member_id')
                // .leftJoin('orders as o', 'm.id', 'o.member_id')
                .select([
                    'm.id as id',
                    'm.name as name',
                    'm.email as email',
                    'm.phone as phone',
                    'm.role as role',
                    'm.lastLoginAt as lastLoginAt',
                    'm.createdAt as createdAt',
                ])
                .where('m.deletedAt', 'is', null)
                .execute()
                .then((results) =>
                    results.map((row) => {
                        const { id } = row;

                        return {
                            ...row,
                            id: BigInt(id),
                        };
                    })
                )
        );
    }
}
