export const ProductMediaRole = {
    THUMBNAIL: 'THUMBNAIL',
    GALLERY: 'GALLERY',
    DETAIL: 'DETAIL',
    ATTACHMENT: 'ATTACHMENT',
} as const;

export type ProductMediaRole = (typeof ProductMediaRole)[keyof typeof ProductMediaRole];
