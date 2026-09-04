import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { InventoryService } from '~/api/inventory/application/inventory.service';
import {
    AdjustInventoryInput,
    InventoryReservationInput,
    RestoreInventoryReservationInput,
    parseReservationId,
} from '~/api/inventory/presentation/inventory.input';
import {
    toInventoryAdjustmentPayload,
    toInventoryTransitionPayload,
} from '~/api/inventory/presentation/inventory.mapper';
import { InventoryAdjustmentPayload, InventoryTransitionPayload } from '~/api/inventory/presentation/inventory.type';
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
            itemId: parseReservationId(input.itemId),
        });
        return toInventoryAdjustmentPayload(movement);
    }

    @Mutation(() => InventoryTransitionPayload)
    @UseGuards(AdminGuard)
    async consumeInventoryReservation(
        @Jwt() jwtPayload: JwtPayload,
        @Args('input') input: InventoryReservationInput
    ): Promise<InventoryTransitionPayload> {
        const result = await this.inventoryService.consume(jwtPayload, parseReservationId(input.reservationId));
        return toInventoryTransitionPayload(result);
    }

    @Mutation(() => InventoryTransitionPayload)
    @UseGuards(AdminGuard)
    async releaseInventoryReservation(
        @Jwt() jwtPayload: JwtPayload,
        @Args('input') input: RestoreInventoryReservationInput
    ): Promise<InventoryTransitionPayload> {
        const result = await this.inventoryService.release(
            jwtPayload,
            parseReservationId(input.reservationId),
            input.idempotencyKey
        );
        return toInventoryTransitionPayload(result);
    }

    @Mutation(() => InventoryTransitionPayload)
    @UseGuards(AdminGuard)
    async expireInventoryReservation(
        @Jwt() jwtPayload: JwtPayload,
        @Args('input') input: RestoreInventoryReservationInput
    ): Promise<InventoryTransitionPayload> {
        const result = await this.inventoryService.expire(
            jwtPayload,
            parseReservationId(input.reservationId),
            input.idempotencyKey
        );
        return toInventoryTransitionPayload(result);
    }
}
