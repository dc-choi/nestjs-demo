import { InputType, OmitType } from '@nestjs/graphql';

import { ReplaceProductItemInput } from './replace-product-item.input.js';

@InputType()
export class CreateProductItemDataInput extends OmitType(ReplaceProductItemInput, ['id'] as const) {}
