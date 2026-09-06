import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MikroORM } from '@mikro-orm/mysql';

import { readMySqlIntegrationConnection, seedCatalogMaintenance } from './mysql-integration.config';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProductCommandService } from '~/api/catalog/application/product-command.service';
import { MemberRole } from '~/api/member/domain/member-role';
import { databaseEntities } from '~/infra/database/entities';
import { CatalogMaintenanceEntity } from '~/infra/search/catalog-maintenance.entity';
import { CatalogMaintenanceError, CatalogMaintenanceService } from '~/infra/search/catalog-maintenance.service';

const describeMySql = process.env.MYSQL_INTEGRATION === '1' ? describe : describe.skip;

describeMySql('Catalog maintenance MySQL concurrency', () => {
    let orm: MikroORM;
    let maintenance: CatalogMaintenanceService;

    beforeAll(async () => {
        orm = await MikroORM.init({
            entities: [...databaseEntities],
            metadataProvider: ReflectMetadataProvider,
            ...readMySqlIntegrationConnection(),
            ensureDatabase: false,
            forceUtcTimezone: true,
            pool: { min: 0, max: 5 },
        });
        maintenance = new CatalogMaintenanceService(orm);
    });

    beforeEach(async () => seedCatalogMaintenance(orm.em.fork()));
    afterAll(async () => {
        if (orm) {
            await seedCatalogMaintenance(orm.em.fork());
            await orm.close(true);
        }
    });

    it('keeps failed rebuilds closed across service instances and explicitly resumes', async () => {
        await expect(
            maintenance.rebuild(async () => {
                throw new Error('bulk unavailable');
            })
        ).rejects.toThrow('did not release maintenance');
        const otherServer = new CatalogMaintenanceService(orm);
        await expect(otherServer.withProjection(async () => undefined)).rejects.toBeInstanceOf(CatalogMaintenanceError);
        await expect(otherServer.rebuild(async () => undefined)).rejects.toThrow('already active');
        await expect(otherServer.rebuild(async () => 'recovered', true)).resolves.toBe('recovered');
        await expect(otherServer.withProjection(async () => 'open')).resolves.toBe('open');
        expect(await orm.em.fork().findOneOrFail(CatalogMaintenanceEntity, 1)).toMatchObject({
            ownerToken: null,
            startedAt: null,
        });
    });

    it('does not start cutover while an admitted projection is still running', async () => {
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const projection = maintenance.withProjection(async () => {
            entered.resolve();
            await release.promise;
        });
        await entered.promise;
        try {
            await expect(maintenance.rebuild(async () => undefined)).rejects.toThrow();
        } finally {
            release.resolve();
            await projection;
        }
        await expect(maintenance.rebuild(async () => 'cutover')).resolves.toBe('cutover');
    });

    it('blocks catalog writers, projectors and concurrent resume during cutover', async () => {
        await maintenance.rebuild(async () => {
            const commands = new ProductCommandService(orm.em.fork());
            await expect(
                commands.create({ memberId: 1n, role: MemberRole.SELLER }, { slug: 'blocked-product', name: 'Blocked' })
            ).rejects.toBeInstanceOf(CatalogMaintenanceError);
            await expect(maintenance.withProjection(async () => undefined)).rejects.toBeInstanceOf(
                CatalogMaintenanceError
            );
            await expect(maintenance.rebuild(async () => undefined, true)).rejects.toThrow();
        });
        await expect(maintenance.withProjection(async () => 'open')).resolves.toBe('open');
    });
});
