import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class RefreshTokenPayload {
    @Field()
    accessToken!: string;

    @Field()
    refreshToken!: string;
}
