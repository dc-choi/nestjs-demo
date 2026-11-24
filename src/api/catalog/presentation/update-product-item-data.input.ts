import { Field, ID, InputType } from '@nestjs/graphql';

import { CreateProductItemDataInput } from './create-product-item-data.input.js';

import { Matches, MaxLength } from 'class-validator';
import { invalidValue } from '~/global/common/message/error.message.js';
import { GRAPHQL_ID_MAX_LENGTH, GRAPHQL_ID_PATTERN } from '~/global/graphql/graphql-id.parser.js';

@InputType()
export class UpdateProductItemDataInput extends CreateProductItemDataInput {
    @Field(() => ID)
    @Matches(GRAPHQL_ID_PATTERN, { message: invalidValue('Item ID') })
    @MaxLength(GRAPHQL_ID_MAX_LENGTH, { message: invalidValue('Item ID') })
    id!: string;
}
