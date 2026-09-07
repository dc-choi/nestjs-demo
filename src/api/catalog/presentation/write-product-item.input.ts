import { Field, ID, InputType, Int, OmitType } from '@nestjs/graphql';

import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { PRODUCT_REASON_MAX_LENGTH } from '~/api/catalog/domain/product.rules';
import { DECIMAL_PRODUCT_ID_PATTERN, PRODUCT_ID_MAX_LENGTH } from '~/api/catalog/presentation/product-id.parser';
import { ReplaceProductItemInput } from '~/api/catalog/presentation/replace-product-catalog.input';
import { invalidMax, invalidMin, invalidValue } from '~/global/common/message/error.message';

@InputType({ isAbstract: true })
abstract class ProductItemWriteInput {
    @Field(() => ID)
    @Matches(DECIMAL_PRODUCT_ID_PATTERN, { message: invalidValue('상품 ID') })
    @MaxLength(PRODUCT_ID_MAX_LENGTH, { message: invalidValue('상품 ID') })
    productId!: string;

    @Field(() => Int)
    @IsInt({ message: invalidValue('기대 revision') })
    @Min(1, { message: invalidMin('기대 revision', 1) })
    expectedRevision!: number;

    @Field(() => String, { nullable: true })
    @IsOptional()
    @IsString({ message: invalidValue('변경 사유') })
    @MaxLength(PRODUCT_REASON_MAX_LENGTH, { message: invalidMax('변경 사유', PRODUCT_REASON_MAX_LENGTH) })
    reason?: string | null;
}

@InputType()
export class CreateProductItemDataInput extends OmitType(ReplaceProductItemInput, ['id'] as const) {}

@InputType()
export class UpdateProductItemDataInput extends CreateProductItemDataInput {
    @Field(() => ID)
    @Matches(DECIMAL_PRODUCT_ID_PATTERN, { message: invalidValue('Item ID') })
    @MaxLength(PRODUCT_ID_MAX_LENGTH, { message: invalidValue('Item ID') })
    id!: string;
}

@InputType()
export class CreateProductItemInput extends ProductItemWriteInput {
    @Field(() => CreateProductItemDataInput)
    @Type(() => CreateProductItemDataInput)
    @ValidateNested()
    item!: CreateProductItemDataInput;
}

@InputType()
export class UpdateProductItemInput extends ProductItemWriteInput {
    @Field(() => UpdateProductItemDataInput)
    @Type(() => UpdateProductItemDataInput)
    @ValidateNested()
    item!: UpdateProductItemDataInput;
}
