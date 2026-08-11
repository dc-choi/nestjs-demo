import { ApiProperty } from '@nestjs/swagger';

import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { emptyValue, invalidValue } from '~/global/common/message/error.message';

export class TokenRequestDto {
    @ApiProperty({
        description: 'accessToken',
        example:
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJtZW1iZXJJZCI6IjciLCJyb2xlIjoiVVNFUiIsImlhdCI6MTcyNDA3MzI1MSwiZXhwIjoxNzI0MDgwNDUxfQ.33KgiWxeKml1O75L2QxmqFANjxcZRZm3HgHEHLmAIgE',
    })
    @IsString({ message: invalidValue('accessToken') })
    @IsNotEmpty({ message: emptyValue('accessToken') })
    accessToken: string;

    @ApiProperty({ description: 'refreshToken', example: '019ff17e-31f2-7022-b5ea-bce5a339025c' })
    @IsString({ message: invalidValue('refreshToken') })
    @IsUUID(7, { message: invalidValue('refreshToken') })
    @IsNotEmpty({ message: emptyValue('refreshToken') })
    refreshToken: string;
}

export class TokenResponseDto {
    @ApiProperty({ description: 'accessToken 값' })
    accessToken: string;

    @ApiProperty({ description: 'refreshToken 값' })
    refreshToken: string;

    constructor(data?: ITokenProps) {
        if (data) {
            this.accessToken = data.accessToken;
            this.refreshToken = data.refreshToken;
        }
    }

    public static toDto(data: ITokenProps) {
        return new TokenResponseDto(data);
    }
}

interface ITokenProps {
    accessToken: string;
    refreshToken: string;
}
