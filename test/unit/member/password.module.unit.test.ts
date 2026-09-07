import { Injectable, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { describe, expect, it } from 'vitest';
import { PasswordKdfSaturatedError } from '~/api/member/application/password-kdf.admission';
import { PasswordService } from '~/api/member/application/password.service';
import { PasswordModule } from '~/api/member/password.module';

@Injectable()
class SignupPasswordConsumer {
    constructor(readonly passwordService: PasswordService) {}
}

@Injectable()
class LoginPasswordConsumer {
    constructor(readonly passwordService: PasswordService) {}
}

@Module({
    imports: [PasswordModule],
    providers: [SignupPasswordConsumer],
})
class SignupConsumerModule {}

@Module({
    imports: [PasswordModule],
    providers: [LoginPasswordConsumer],
})
class LoginConsumerModule {}

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [() => ({ SECRET: 'test-secret' })],
        }),
        SignupConsumerModule,
        LoginConsumerModule,
    ],
})
class PasswordConsumersModule {}

describe('PasswordModule', () => {
    it('creates one shared password service and KDF admission for signup and login consumers', async () => {
        const context = await NestFactory.createApplicationContext(PasswordConsumersModule, { logger: false });
        try {
            const signupPasswordService = context.get(SignupPasswordConsumer).passwordService;
            const loginPasswordService = context.get(LoginPasswordConsumer).passwordService;

            expect(signupPasswordService).toBe(loginPasswordService);

            const hashing = signupPasswordService.hash('password');
            await expect(loginPasswordService.verify('password', null)).rejects.toBeInstanceOf(
                PasswordKdfSaturatedError
            );
            await hashing;
        } finally {
            await context.close();
        }
    });
});
