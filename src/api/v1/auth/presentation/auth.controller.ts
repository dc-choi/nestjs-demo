import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiExtraModels, ApiOperation, ApiResponse, ApiTags, getSchemaPath } from '@nestjs/swagger';

import { AuthService } from '../application/auth.service';
import { LoginRequestDto, LoginResponseDto } from '../domain/dto/login.dto';
import { TokenRequestDto, TokenResponseDto } from '../domain/dto/token.dto';

import { InvalidIdOrPassword, InvalidRefreshToken, NotExpiredAccessToken } from '~/global/common/error/auth.error';
import { NotExistingMember } from '~/global/common/error/member.error';

@ApiTags("Auth API's")
@Controller('v1/auth')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Post('login')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: '사용자 로그인' })
    @ApiResponse({ status: HttpStatus.OK, type: LoginResponseDto })
    @ApiResponse({ status: HttpStatus.BAD_REQUEST, type: InvalidIdOrPassword })
    async login(@Body() loginRequestDto: LoginRequestDto): Promise<LoginResponseDto> {
        return await this.authService.login(loginRequestDto);
    }

    @Post('token')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: '토큰 재발급' })
    @ApiExtraModels(NotExpiredAccessToken, InvalidRefreshToken)
    @ApiResponse({ status: HttpStatus.OK, type: TokenResponseDto })
    @ApiResponse({ status: HttpStatus.BAD_REQUEST, type: NotExistingMember })
    @ApiResponse({
        status: HttpStatus.UNAUTHORIZED,
        schema: {
            oneOf: [{ $ref: getSchemaPath(NotExpiredAccessToken) }, { $ref: getSchemaPath(InvalidRefreshToken) }],
        },
    })
    async token(@Body() authTokenRequestDto: TokenRequestDto): Promise<TokenResponseDto> {
        return await this.authService.token(authTokenRequestDto);
    }
}
