import { Player } from "./player";

export const CropType = {
    WHEAT: 'wheat',
    CANE: 'sugarcane',
    CARROT: 'carrot',
    CABBAGE: 'cabbage',
    POTATO: 'potato',
    TOMATO: 'tomato',
    PUMPKIN: 'pumpkin',
    CORN: 'corn',
    BEAN: 'bean',
    ONION: 'onion',
    GARLIC: 'garlic'
} as const;

export const CropSize = {
    SMALL: 20,
    MEDIUM: 25,
    LARGE: 30,
    XLARGE: 35
} as const;

export type Crop = {
    id: number;
    pos: {x: number, y: number},
    type: (typeof CropType)[keyof typeof CropType];
    size: number;
};

export function harvestCrop(player: Player, crop: Crop): void {
    player.addExp(5); // Add experience for harvesting
    switch (crop.type) {
        case 'wheat':
            player.addCoins(10);
            player.addItem(CropType.WHEAT);
            break;
        case 'corn':
            player.addCoins(15);
            player.addItem(CropType.CORN);
            break;
        case 'carrot':
            player.addCoins(20);
            player.addItem(CropType.CARROT);
            break;
        case 'cabbage':
            player.addCoins(30); 
            player.addItem(CropType.CABBAGE);
            break;
        default:
            console.error('Unknown crop type:', crop.type);
    }
}