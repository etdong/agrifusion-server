"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CropSize = exports.CropType = void 0;
exports.harvestCrop = harvestCrop;
exports.CropType = {
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
};
exports.CropSize = {
    SMALL: 20,
    MEDIUM: 25,
    LARGE: 30,
    XLARGE: 35
};
function harvestCrop(player, crop) {
    player.addExp(5); // Add experience for harvesting
    switch (crop.type) {
        case 'wheat':
            player.addCoins(10);
            player.addItem(exports.CropType.WHEAT);
            break;
        case 'corn':
            player.addCoins(15);
            player.addItem(exports.CropType.CORN);
            break;
        case 'carrot':
            player.addCoins(20);
            player.addItem(exports.CropType.CARROT);
            break;
        case 'cabbage':
            player.addCoins(30);
            player.addItem(exports.CropType.CABBAGE);
            break;
        default:
            console.error('Unknown crop type:', crop.type);
    }
}
//# sourceMappingURL=crop.js.map