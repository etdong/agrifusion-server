"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Crate = void 0;
class Crate {
    constructor(pos, contents) {
        this.pos = pos;
        this.contents = contents;
    }
    openCrate(player) {
        player.addExp(10); // Add experience for opening the crate
    }
}
exports.Crate = Crate;
//# sourceMappingURL=crate.js.map