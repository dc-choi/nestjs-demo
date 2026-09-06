import { describe, expect, it } from 'vitest';
import { PasswordKdfAdmission, PasswordKdfSaturatedError } from '~/api/member/domain/password-kdf.admission';

describe('PasswordKdfAdmission', () => {
    it('fails immediately when full and admits work after the running KDF completes', async () => {
        const admission = new PasswordKdfAdmission(1);
        let release!: () => void;
        const running = admission.run(
            () =>
                new Promise<void>((resolve) => {
                    release = resolve;
                })
        );

        await expect(admission.run(async () => undefined)).rejects.toBeInstanceOf(PasswordKdfSaturatedError);

        release();
        await running;

        await expect(admission.run(async () => 'available')).resolves.toBe('available');
    });

    it('releases a slot when a KDF fails', async () => {
        const admission = new PasswordKdfAdmission(1);

        await expect(
            admission.run(async () => {
                throw new Error('KDF failed');
            })
        ).rejects.toThrow('KDF failed');

        await expect(admission.run(async () => 'available')).resolves.toBe('available');
    });
});
