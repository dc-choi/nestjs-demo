import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { RestoreInventoryReservationInput } from '~/api/inventory/presentation/inventory.input';
import { toInventoryTransitionPayload } from '~/api/inventory/presentation/inventory.mapper';
import { InventoryTransitionPayload } from '~/api/inventory/presentation/inventory.type';
import { OrderExpirationService } from '~/api/order/application/order-expiration.service';
import { parseGraphqlId } from '~/global/graphql/graphql-id.parser';
import { Jwt } from '~/global/jwt/decorator/jwt.decorator';
import { AdminGuard } from '~/global/jwt/guard/admin.guard';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload';

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
