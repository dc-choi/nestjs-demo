import { Module } from '@nestjs/common';

import { PasswordKdfAdmission } from './application/password-kdf.admission';
import { PasswordService } from './application/password.service';

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
