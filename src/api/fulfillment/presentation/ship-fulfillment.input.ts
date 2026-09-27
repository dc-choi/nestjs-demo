import { Field, InputType } from '@nestjs/graphql';

import { FulfillmentIdInput } from './fulfillment-id.input';

import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

@InputType()
export class ShipFulfillmentInput extends FulfillmentIdInput {
    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    carrier!: string;

    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    trackingNumber!: string;
}
