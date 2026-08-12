const endpoint = process.env.GRAPHQL_URL ?? 'http://127.0.0.1:3000/graphql';

interface GraphqlResponse<T> {
    data?: T;
    errors?: Array<{
        extensions?: { code?: string; requestId?: string };
    }>;
}

const sendGraphqlRequest = async <T>(query: string, requestId: string, variables?: Record<string, unknown>) => {
    const response = await fetch(endpoint, {
        method: 'POST',
        signal: AbortSignal.timeout(5_000),
        headers: {
            'content-type': 'application/json',
            'x-request-id': requestId,
        },
        body: JSON.stringify({ query, variables }),
    });

    return {
        response,
        body: (await response.json()) as GraphqlResponse<T>,
    };
};

describe('GraphQL API', () => {
    it('accepts a GraphQL request and propagates x-request-id', async () => {
        const requestId = 'graphql-e2e-smoke';
        const { response, body } = await sendGraphqlRequest<{ __typename: 'Query' }>(
            'query GraphqlSmoke { __typename }',
            requestId
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('x-request-id')).toBe(requestId);
        expect(body).toEqual({ data: { __typename: 'Query' } });
    });

    it('rejects placeOrder without a bearer token', async () => {
        const requestId = 'graphql-e2e-unauthorized';
        const { response, body } = await sendGraphqlRequest(
            'mutation PlaceOrder($input: PlaceOrderInput!) { placeOrder(input: $input) { order { id } } }',
            requestId,
            { input: { items: [{ itemId: '1', quantity: 1 }] } }
        );

        expect(response.status).toBe(200);
        expect(body.errors?.[0]?.extensions).toMatchObject({ code: 'UNAUTHORIZED', requestId });
    });

    it('exposes the canonical product graph and returns null for an unpublished ID', async () => {
        const requestId = 'graphql-e2e-product-schema';
        const { response, body } = await sendGraphqlRequest<{ product: null }>(
            `query Product($id: ID!) {
                product(id: $id) {
                    id
                    slug
                    currentRevision {
                        id
                        name
                        items {
                            id
                            price { amount currencyCode }
                            selectedOptions { optionCode valueCode }
                        }
                        categories { id path { id slug } }
                        tags
                    }
                }
            }`,
            requestId,
            { id: '9223372036854775807' }
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('x-request-id')).toBe(requestId);
        expect(body).toEqual({ data: { product: null } });
    });
});
