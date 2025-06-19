import { type Crop } from "./crop";
import { Player } from "./player";

export class Crate {
    pos: { x: number, y: number };
    contents: Crop; // Array of item names

    constructor(pos: { x: number, y: number }, contents: Crop) {
        this.pos = pos;
        this.contents = contents;
    }

    openCrate(player: Player): void {
        player.addExp(10); // Add experience for opening the crate
    }
}