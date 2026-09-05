import { HttpException } from '@nestjs/common';

import { GraphQLFormattedError } from 'graphql';
import { describe, expect, it } from 'vitest';
import { runWithRequestContext } from '~/global/common/context/request-context';
import { formatGraphqlError } from '~/global/graphql/graphql-error.formatter';

describe('formatGraphqlError', () => {
    it('도메인 오류의 코드와 메시지를 사용하고 requestId만 확장 정보에 남긴다', () => {
        const formattedError: GraphQLFormattedError = {
            message: '기존 메시지',
            path: ['placeOrder'],
            extensions: {
                code: 'INTERNAL_SERVER_ERROR',
                originalError: { privateField: '숨겨야 할 값' },
            },
        };
        const domainError = new HttpException(
            {
                type: 'OUT_OF_STOCK',
                message: '상품 재고가 부족합니다.',
            },
            409
        );

        const result = runWithRequestContext('graphql-request-1', () =>
            formatGraphqlError(formattedError, domainError)
        );

        expect(result).toEqual({
            message: '상품 재고가 부족합니다.',
            path: ['placeOrder'],
            extensions: {
                code: 'OUT_OF_STOCK',
                requestId: 'graphql-request-1',
            },
        });
    });

    it('내부 오류의 메시지와 원본 확장 정보를 공개하지 않는다', () => {
        const secret = 'database-password=do-not-expose';
        const formattedError: GraphQLFormattedError = {
            message: secret,
            extensions: {
                code: 'INTERNAL_SERVER_ERROR',
                originalError: { message: secret },
                stacktrace: [secret],
            },
        };

        const result = runWithRequestContext('graphql-request-2', () =>
            formatGraphqlError(formattedError, new Error(secret))
        );

        expect(result).toEqual({
            message: 'Server Error',
            extensions: {
                code: 'INTERNAL_SERVER_ERROR',
                requestId: 'graphql-request-2',
            },
        });
        expect(JSON.stringify(result)).not.toContain(secret);
    });
});
