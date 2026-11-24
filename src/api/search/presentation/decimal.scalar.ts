import { CustomScalar, Scalar } from '@nestjs/graphql';

import { Kind, ValueNode } from 'graphql';

@Scalar('Decimal')
export class DecimalScalar implements CustomScalar<string, string> {
    description = 'A base-10 decimal encoded as a string';

    parseValue(value: unknown): string {
        if (typeof value !== 'string') throw new TypeError('Decimal input must be a string');
        return value;
    }

    serialize(value: unknown): string {
        if (typeof value !== 'string') throw new TypeError('Decimal output must be a string');
        return value;
    }

    parseLiteral(ast: ValueNode): string {
        if (ast.kind !== Kind.STRING) throw new TypeError('Decimal input must be a string');
        return ast.value;
    }
}
