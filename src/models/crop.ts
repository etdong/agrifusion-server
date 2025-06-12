const CropType = {
    CARROT: 'carrot',
    POTATO: 'potato',
    TOMATO: 'tomato',
    CABBAGE: 'cabbage',
    WHEAT: 'wheat',
    CORN: 'corn',
    RICE: 'rice',
    BEAN: 'bean',
    ONION: 'onion',
    GARLIC: 'garlic'
} as const;

const CropSize = {
    SMALL: 20,
    MEDIUM: 25,
    LARGE: 30,
    XLARGE: 35
} as const;

export type Crop = {
    type: (typeof CropType)[keyof typeof CropType];
    size: (typeof CropSize)[keyof typeof CropSize];
};