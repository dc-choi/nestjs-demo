import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { InventoryService } from '~/api/inventory/application/inventory.service';
import { AdjustInventoryInput, RestoreInventoryReservationInput } from '~/api/inventory/presentation/inventory.input';
import {
    toInventoryAdjustmentPayload,
    toInventoryTransitionPayload,
} from '~/api/inventory/presentation/inventory.mapper';
import { InventoryAdjustmentPayload, InventoryTransitionPayload } from '~/api/inventory/presentation/inventory.type';
import { parseGraphqlId } from '~/global/graphql/graphql-id.parser';
import { Jwt } from '~/global/jwt/decorator/jwt.decorator';
import { AdminGuard } from '~/global/jwt/guard/admin.guard';
import { SellerGuard } from '~/global/jwt/guard/seller.guard';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload';

@Resolver()
export class InventoryResolver {
    constructor(private readonly inventoryService: InventoryService) {}

    @Mutation(() => InventoryAdjustmentPayload)
    @UseGuards(SellerGuard)
    async adjustInventory(
        @Jwt() jwtPayload: JwtPayload,
        @Args('input') input: AdjustInventoryInput
    ): Promise<InventoryAdjustmentPayload> {
        const movement = await this.inventoryService.adjust(jwtPayload, {
            ...input,
            itemId: parseGraphqlId(input.itemId, '품목 ID'),
        });
        return toInventoryAdjustmentPayload(movement);
    }

    @Mutation(() => InventoryTransitionPayload)
    @UseGuards(AdminGuard)
    async releaseInventoryReservation(
        @Jwt() jwtPayload: JwtPayload,
        @Args('input') input: RestoreInventoryReservationInput
    ): Promise<InventoryTransitionPayload> {
        const result = await this.inventoryService.release(
            jwtPayload,
            parseGraphqlId(input.reservationId, '재고 예약 ID'),
            input.idempotencyKey
        );
        return toInventoryTransitionPayload(result);
    }
}
