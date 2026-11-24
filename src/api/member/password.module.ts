import { Module } from '@nestjs/common';

import { PasswordKdfAdmission } from './application/password-kdf.admission.js';
import { PasswordService } from './application/password.service.js';

@Module({
    providers: [
        {
            provide: PasswordKdfAdmission,
            useFactory: () => new PasswordKdfAdmission(),
        },
        PasswordService,
    ],
    exports: [PasswordService],
})
export class PasswordModule {}
