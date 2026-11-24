import { registerEnumType } from '@nestjs/graphql';

import { FulfillmentStatus } from '~/api/fulfillment/domain/fulfillment-status.js';

registerEnumType(FulfillmentStatus, { name: 'FulfillmentStatus' });

export { FulfillmentStatus };
