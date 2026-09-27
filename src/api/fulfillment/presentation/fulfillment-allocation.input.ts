import { Field, ID, InputType, Int } from '@nestjs/graphql';

import { IsNumber, Matches, Max, MaxLength, Min } from 'class-validator';
import { MYSQL_SIGNED_INT_MAX } from '~/global/common/utils/mysql-number';
import { GRAPHQL_ID_MAX_LENGTH, GRAPHQL_ID_PATTERN } from '~/global/graphql/graphql-id.parser';

@InputType()
export class FulfillmentAllocationInput {
    @Field(() => ID)
    @Matches(GRAPHQL_ID_PATTERN)
    @MaxLength(GRAPHQL_ID_MAX_LENGTH)
    orderItemId!: string;

    @Field(() => Int)
    @IsNumber()
    @Min(1)
    @Max(MYSQL_SIGNED_INT_MAX)
    quantity!: number;
}
