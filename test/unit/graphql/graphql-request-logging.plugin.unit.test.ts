import { Request, Response } from 'express';
import { GraphQLError, getOperationAST, parse } from 'graphql';
import { EventEmitter } from 'node:events';
import { graphqlLog } from '~/global/common/logger/channel.logger';
import { createGraphqlRequestLoggingPlugin } from '~/global/graphql/graphql-request-logging.plugin';

jest.mock('~/global/common/logger/channel.logger', () => ({
    graphqlLog: { log: jest.fn() },
}));

describe('createGraphqlRequestLoggingPlugin', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('허용된 요청 메타데이터만 기록하고 query, variables, response를 남기지 않는다', async () => {
        const query = `
            # sensitive-query-marker
            query Catalog($token: String!) {
                product(id: "1") { id }
            }
        `;
        const document = parse(query);
        const operation = getOperationAST(document, 'Catalog');
        if (!operation) throw new Error('테스트용 operation을 찾을 수 없습니다.');

        const responseEvents = new EventEmitter();
        Object.assign(responseEvents, {
            statusCode: 200,
            writableFinished: true,
            getHeader: jest.fn().mockReturnValue('graphql-request-3'),
        });
        const req = {
            method: 'POST',
            originalUrl: '/graphql?debug=true',
        } as Request;
        const res = responseEvents as unknown as Response;
        const plugin = createGraphqlRequestLoggingPlugin('test');
        const listener = await plugin.requestDidStart?.({ contextValue: { req, res } } as never);

        await listener?.didResolveOperation?.({
            document,
            operation,
            operationName: 'Catalog',
            request: {
                query,
                variables: { token: 'sensitive-variable-marker' },
            },
        } as never);
        await listener?.willSendResponse?.({
            response: {
                body: {
                    kind: 'single',
                    singleResult: {
                        data: { value: 'sensitive-response-marker' },
                        errors: [
                            new GraphQLError('sensitive-error-marker', {
                                extensions: { code: 'INTERNAL_SERVER_ERROR' },
                            }),
                        ],
                    },
                },
            },
        } as never);
        responseEvents.emit('finish');

        expect(graphqlLog.log).toHaveBeenCalledTimes(1);
        const [entry] = jest.mocked(graphqlLog.log).mock.calls[0];
        expect(Object.keys(entry)).toEqual([
            'type',
            'env',
            'requestId',
            'method',
            'path',
            'operationType',
            'operationName',
            'topLevelFields',
            'durationMs',
            'httpStatus',
            'success',
            'aborted',
            'errorCount',
            'errorCodes',
        ]);
        expect(entry).toEqual({
            type: 'GRAPHQL OPERATION',
            env: 'test',
            requestId: 'graphql-request-3',
            method: 'POST',
            path: '/graphql',
            operationType: 'query',
            operationName: 'Catalog',
            topLevelFields: ['product'],
            durationMs: expect.any(Number),
            httpStatus: 200,
            success: false,
            aborted: false,
            errorCount: 1,
            errorCodes: ['INTERNAL_SERVER_ERROR'],
        });
        const serializedEntry = JSON.stringify(entry);
        expect(serializedEntry).not.toContain('sensitive-query-marker');
        expect(serializedEntry).not.toContain('sensitive-variable-marker');
        expect(serializedEntry).not.toContain('sensitive-response-marker');
        expect(serializedEntry).not.toContain('sensitive-error-marker');
    });
});
