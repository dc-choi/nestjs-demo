import { jest } from '@jest/globals';

import { SearchOutboxRelay } from '~/infra/search/search-outbox.relay';

describe('Search outbox relay', () => {
    it('does not claim rows while OpenSearch is disabled', async () => {
        const orm = {
            em: {
                fork: jest.fn(() => {
                    throw new Error('The outbox must not be queried while search is disabled');
                }),
            },
        };
        const worker = { synchronize: jest.fn() };
        const relay = new SearchOutboxRelay(orm as never, worker as never, { enabled: false } as never);

        await expect(relay.drainBatch()).rejects.toThrow('OpenSearch must be enabled');
        expect(orm.em.fork).not.toHaveBeenCalled();
        expect(worker.synchronize).not.toHaveBeenCalled();
    });

    it('does not claim rows after cancellation', async () => {
        const fork = jest.fn(() => {
            throw new Error('The outbox must not be queried after cancellation');
        });
        const relay = new SearchOutboxRelay(
            { em: { fork } } as never,
            { synchronize: jest.fn() } as never,
            { enabled: true } as never
        );

        await expect(relay.drainUntilEmpty({ signal: AbortSignal.abort() })).resolves.toEqual({
            claimed: 0,
            processed: 0,
            failed: 0,
            deadLettered: 0,
        });
        expect(fork).not.toHaveBeenCalled();
    });
});
