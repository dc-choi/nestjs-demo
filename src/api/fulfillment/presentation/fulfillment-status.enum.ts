import { registerEnumType } from '@nestjs/graphql';

import { FulfillmentStatus } from '~/api/fulfillment/domain/fulfillment.enum';

registerEnumType(FulfillmentStatus, { name: 'FulfillmentStatus' });

export { FulfillmentStatus };
