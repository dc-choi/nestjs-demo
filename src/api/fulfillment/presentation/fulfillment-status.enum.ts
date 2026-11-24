import { registerEnumType } from '@nestjs/graphql';

import { FulfillmentStatus } from '~/api/fulfillment/domain/entity/fulfillment-status.js';

registerEnumType(FulfillmentStatus, { name: 'FulfillmentStatus' });

export { FulfillmentStatus };
