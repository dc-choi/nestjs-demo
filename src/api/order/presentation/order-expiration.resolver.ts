import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { InventoryTransitionPayload } from '~/api/inventory/presentation/inventory-transition.payload.js';
import { toInventoryTransitionPayload } from '~/api/inventory/presentation/inventory.mapper.js';
import { RestoreInventoryReservationInput } from '~/api/inventory/presentation/restore-inventory-reservation.input.js';
import { OrderExpirationService } from '~/api/order/application/order-expiration.service.js';
import { parseGraphqlId } from '~/global/graphql/graphql-id.parser.js';
import { Jwt } from '~/global/jwt/decorator/jwt.decorator.js';
import { AdminGuard } from '~/global/jwt/guard/admin.guard.js';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload.js';

/** Expiring a reservation cancels its whole order, so the mutation lives with the order use case. */
@Resolver()
export class OrderExpirationResolver {
    constructor(private readonly orderExpirationService: OrderExpirationService) {}

    @Mutation(() => InventoryTransitionPayload)
    @UseGuards(AdminGuard)
    async expireInventoryReservation(
        @Jwt() jwtPayload: JwtPayload,
        @Args('input') input: RestoreInventoryReservationInput
    ): Promise<InventoryTransitionPayload> {
        const result = await this.orderExpirationService.expire(
            jwtPayload,
            parseGraphqlId(input.reservationId, '재고 예약 ID'),
            input.idempotencyKey
        );
        return toInventoryTransitionPayload(result);
    }
}
