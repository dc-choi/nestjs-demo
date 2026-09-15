import { BadRequestException } from '@nestjs/common';

import { invalidValue } from '~/global/common/message/error.message';

/** GraphQL `ID` strings that map to signed 64-bit MySQL primary keys: positive decimal, no sign or padding. */
export const GRAPHQL_ID_PATTERN = /^[1-9]\d*$/;
export const GRAPHQL_ID_MAX_LENGTH = 19;
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;

/** Converts a GraphQL `ID` string into a `bigint` primary key, rejecting anything MySQL could not store. */
export function parseGraphqlId(value: string, field: string): bigint {
    if (value.length > GRAPHQL_ID_MAX_LENGTH || !GRAPHQL_ID_PATTERN.test(value)) {
        throw new BadRequestException(invalidValue(field));
    }

    const id = BigInt(value);
    if (id > MAX_SIGNED_BIGINT) throw new BadRequestException(invalidValue(field));

    return id;
}
