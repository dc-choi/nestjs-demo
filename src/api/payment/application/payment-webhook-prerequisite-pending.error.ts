import { ConflictException } from '@nestjs/common';

export class PaymentWebhookPrerequisitePending extends ConflictException {}
