import { registerEnumType } from '@nestjs/graphql';

import { FulfillmentStatus } from '~/api/fulfillment/domain/fulfillment-status';

registerEnumType(FulfillmentStatus, { name: 'FulfillmentStatus' });

export { FulfillmentStatus };
