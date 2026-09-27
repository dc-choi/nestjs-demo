export const OrderActorType = {
    MEMBER: 'MEMBER',
    SYSTEM: 'SYSTEM',
    PROVIDER: 'PROVIDER',
} as const;

export type OrderActorType = (typeof OrderActorType)[keyof typeof OrderActorType];
