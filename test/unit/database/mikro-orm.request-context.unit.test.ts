import { MikroORM, RequestContext } from '@mikro-orm/core';
import { MikroOrmMiddleware } from '@mikro-orm/nestjs';

import { describe, expect, it, vi } from 'vitest';

describe('MikroORM RequestContext', () => {
    it('동시에 실행되는 요청마다 다른 EntityManager fork를 유지한다', async () => {
        const forks = [
            { name: 'default', request: 1 },
            { name: 'default', request: 2 },
        ];
        const em = {
            name: 'default',
            fork: vi.fn().mockReturnValueOnce(forks[0]).mockReturnValueOnce(forks[1]),
        };
        const middleware = new MikroOrmMiddleware({ em } as unknown as MikroORM);

        const observed = await Promise.all(
            forks.map(
                () =>
                    new Promise<unknown>((resolve) => {
                        middleware.use({}, {}, async () => {
                            await Promise.resolve();
                            resolve(RequestContext.getEntityManager());
                        });
                    })
            )
        );

        expect(observed).toEqual(forks);
        expect(em.fork).toHaveBeenCalledTimes(2);
        expect(RequestContext.getEntityManager()).toBeUndefined();
    });
});
