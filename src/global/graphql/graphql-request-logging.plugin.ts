import {
    ApolloServerPlugin,
    GraphQLRequestContextDidResolveOperation,
    GraphQLRequestContextWillSendResponse,
} from '@apollo/server';

import { FragmentDefinitionNode, Kind, SelectionSetNode } from 'graphql';
import { ClsServiceManager } from 'nestjs-cls';
import { performance } from 'node:perf_hooks';
import { graphqlLog } from '~/global/common/logger/channel.logger';
import { GraphqlHttpContext } from '~/global/graphql/graphql-context';

const INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR';
const MAX_OPERATION_NAME_LENGTH = 128;
const MAX_TOP_LEVEL_FIELDS = 20;
const MAX_ERROR_CODES = 20;

interface OperationState {
    operationType: 'query' | 'mutation' | 'subscription' | 'unknown';
    operationName: string;
    topLevelFields: string[];
    errorCount: number;
    errorCodes: string[];
}

export const createGraphqlRequestLoggingPlugin = (env: string): ApolloServerPlugin<GraphqlHttpContext> => ({
    async requestDidStart({ contextValue }) {
        const startedAt = performance.now();
        const { req, res } = contextValue;
        const requestId = getRequestId(contextValue);
        const state: OperationState = {
            operationType: 'unknown',
            operationName: 'anonymous',
            topLevelFields: [],
            errorCount: 0,
            errorCodes: [],
        };
        let logged = false;

        const finish = (aborted: boolean) => {
            if (logged) return;
            logged = true;

            const httpStatus = res.statusCode || 200;
            graphqlLog.log({
                type: 'GRAPHQL OPERATION',
                env,
                requestId,
                method: req.method,
                path: req.originalUrl.split('?')[0] || '/graphql',
                operationType: state.operationType,
                operationName: state.operationName,
                topLevelFields: state.topLevelFields,
                durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
                httpStatus,
                success: !aborted && httpStatus < 400 && state.errorCount === 0,
                aborted,
                errorCount: state.errorCount,
                errorCodes: state.errorCodes,
            });
        };

        res.once('finish', () => finish(false));
        res.once('close', () => {
            if (!res.writableFinished) finish(true);
        });

        return {
            async didResolveOperation(requestContext) {
                setOperationState(state, requestContext);
            },
            async willSendResponse(requestContext) {
                setErrorState(state, requestContext);
            },
        };
    },
});

const getRequestId = ({ res }: GraphqlHttpContext): string => {
    const header = res.getHeader('x-request-id');
    const value = typeof header === 'string' ? header : ClsServiceManager.getClsService().getId();

    return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : 'unknown';
};

const setOperationState = (
    state: OperationState,
    { document, operation, operationName }: GraphQLRequestContextDidResolveOperation<GraphqlHttpContext>
) => {
    state.operationType = operation?.operation ?? 'unknown';
    state.operationName = operationName?.slice(0, MAX_OPERATION_NAME_LENGTH) || 'anonymous';
    if (!operation) return;

    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const definition of document.definitions) {
        if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments.set(definition.name.value, definition);
    }
    state.topLevelFields = collectTopLevelFields(operation.selectionSet, fragments);
};

const collectTopLevelFields = (
    selectionSet: SelectionSetNode,
    fragments: ReadonlyMap<string, FragmentDefinitionNode>
): string[] => {
    const fields = new Set<string>();
    const visitedFragments = new Set<string>();

    const collect = (current: SelectionSetNode) => {
        for (const selection of current.selections) {
            if (selection.kind === Kind.FIELD) fields.add(selection.name.value);
            if (selection.kind === Kind.INLINE_FRAGMENT) collect(selection.selectionSet);
            if (selection.kind !== Kind.FRAGMENT_SPREAD || visitedFragments.has(selection.name.value)) continue;

            visitedFragments.add(selection.name.value);
            const fragment = fragments.get(selection.name.value);
            if (fragment) collect(fragment.selectionSet);
        }
    };

    collect(selectionSet);
    return [...fields].sort().slice(0, MAX_TOP_LEVEL_FIELDS);
};

const setErrorState = (
    state: OperationState,
    { response }: GraphQLRequestContextWillSendResponse<GraphqlHttpContext>
) => {
    const result = response.body.kind === 'single' ? response.body.singleResult : response.body.initialResult;
    const errors = result.errors ?? [];
    const codes = new Set<string>();

    for (const error of errors) {
        const code = error.extensions?.code;
        codes.add(typeof code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(code) ? code : INTERNAL_SERVER_ERROR);
    }

    state.errorCount = errors.length;
    state.errorCodes = [...codes].sort().slice(0, MAX_ERROR_CODES);
};
