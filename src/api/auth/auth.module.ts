import { Module } from '@nestjs/common';

import { AuthService } from './application/auth.service';
import { AuthResolver } from './presentation/auth.resolver';

import { TokenModule } from '~/global/jwt/token.module';

@Module({
    imports: [TokenModule],
    providers: [AuthService, AuthResolver],
})
export class AuthModule {}
