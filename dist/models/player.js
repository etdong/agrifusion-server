"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Player = exports.levels = void 0;
const db_1 = __importDefault(require("../db"));
const bag_1 = require("./bag");
exports.levels = {
    1: { levelUp: 100, farmSize: 3, crops: ['wheat'] },
    2: { levelUp: 200, farmSize: 4, crops: ['wheat', 'sugarcane'] },
    3: { levelUp: 400, farmSize: 5, crops: ['wheat', 'carrot', 'sugarcane'] },
    4: { levelUp: 800, farmSize: 6, crops: ['wheat', 'carrot', 'sugarcane', 'cabbage'] },
    5: { levelUp: 1500, farmSize: 7, crops: ['wheat', 'carrot', 'sugarcane', 'cabbage', 'potato'] },
    6: { levelUp: 2500, farmSize: 8, crops: ['wheat', 'carrot', 'sugarcane', 'cabbage', 'potato', 'tomato'] },
    7: { levelUp: 4000, farmSize: 9, crops: ['wheat', 'carrot', 'sugarcane', 'cabbage', 'potato', 'tomato', 'pumpkin'] },
    8: { levelUp: 6500, farmSize: 10, crops: ['wheat', 'carrot', 'sugarcane', 'cabbage', 'potato', 'tomato', 'pumpkin', 'corn'] },
    9: { levelUp: 10000, farmSize: 11, crops: ['wheat', 'carrot', 'sugarcane', 'cabbage', 'potato', 'tomato', 'pumpkin', 'corn', 'bean'] },
    10: { levelUp: 50000, farmSize: 12, crops: ['wheat', 'carrot', 'sugarcane', 'cabbage', 'potato', 'tomato', 'pumpkin', 'corn', 'bean', 'onion'] },
    11: { levelUp: 1000000, farmSize: 13, crops: ['wheat', 'carrot', 'sugarcane', 'cabbage', 'potato', 'tomato', 'pumpkin', 'corn', 'bean', 'onion', 'garlic'] },
};
const MAX_FARMSIZE = 13;
class Player {
    constructor(socket) {
        this.loggedIn = false;
        this.username = '';
        this.pos = { x: -1, y: -1 };
        this.coins = 0;
        this.bag = [];
        this.crates = 0;
        this.farmSize = 3;
        this.farmOrigin = { x: -1, y: -1 };
        this.farmPlaced = false;
        this.level = 1;
        this.exp = 0;
        this.socket = socket;
    }
    logout() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield db_1.default.connect();
                const db = db_1.default.db('agrifusion');
                const userColl = db.collection('users');
                yield userColl.updateOne({ username: this.username }, {
                    $set: {
                        lastLogin: new Date()
                    }
                });
            }
            catch (err) {
                throw new Error(this.username + ' error logging out: ' + err);
            }
        });
    }
    addItem(cropType) {
        const itemSlot = this.bag.find(item => item.id === cropType);
        if (itemSlot) {
            itemSlot.amount += 1;
        }
        else {
            this.bag.push({ id: cropType, name: bag_1.ItemName[cropType], amount: 1 }); // Add new cabbage item to bag
        }
        this.saveBag();
    }
    removeItem(cropType) {
        const itemSlot = this.bag.find(item => item.id === cropType);
        if (itemSlot && itemSlot.amount > 0) {
            itemSlot.amount -= 1; // Decrement the item amount
            if (itemSlot.amount === 0) {
                this.bag = this.bag.filter(item => item.id !== cropType); // Remove item if amount is 0
            }
            return true;
        }
        return false;
    }
    addCoins(amount) {
        this.coins += amount;
    }
    removeCoins(amount) {
        if (this.coins >= amount) {
            this.coins -= amount;
            return true;
        }
        return false;
    }
    addCrate(amount) {
        this.crates += amount;
    }
    openCrate() {
        if (this.crates > 0) {
            this.crates -= 1;
            return true;
        }
        return false;
    }
    addExp(amount) {
        this.exp += amount;
        if (this.exp >= exports.levels[this.level].levelUp) {
            this.levelUp();
        }
    }
    levelUp() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.level < Object.keys(exports.levels).length) {
                this.level += 1;
                this.exp = 0; // Reset experience after leveling up
                this.farmSize = exports.levels[this.level].farmSize;
                try {
                    yield db_1.default.connect();
                    const db = db_1.default.db('agrifusion');
                    const farmColl = db.collection('farms');
                    yield farmColl.updateOne({ username: this.username }, {
                        $set: {
                            level: this.level,
                            exp: this.exp,
                            size: this.farmSize,
                        }
                    });
                    console.log(`${this.username} leveled up to level ${this.level}! Farm size is now ${this.farmSize}`);
                }
                catch (err) {
                    throw new Error(this.username + 'error leveling up: ' + err);
                }
            }
            else {
                console.log(`${this.username} is already at max level.`);
            }
        });
    }
    saveBag() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield db_1.default.connect();
                const db = db_1.default.db('agrifusion');
                const bagColl = db.collection('bags');
                yield bagColl.updateOne({ username: this.username }, {
                    $set: {
                        bag: this.bag,
                        coins: this.coins,
                        crates: this.crates,
                    }
                });
                console.log(this.username + ' bag updated successfully');
            }
            catch (err) {
                throw new Error(this.username + ' error updating farm: ' + err);
            }
        });
    }
    saveFarm(farm) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield db_1.default.connect();
                const db = db_1.default.db('agrifusion');
                const farmColl = db.collection('farms');
                yield farmColl.updateOne({ username: this.username }, {
                    $set: {
                        farm: farm,
                        size: this.farmSize,
                        level: this.level,
                        exp: this.exp,
                    }
                });
                console.log(this.username + 'farm updated successfully');
            }
            catch (err) {
                throw new Error(this.username + 'error updating farm: ' + err);
            }
        });
    }
    getFarm() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield db_1.default.connect();
                const db = db_1.default.db('agrifusion');
                const farmColl = db.collection('farms');
                let farmData = yield farmColl.findOne({ username: this.username });
                if (!farmData) {
                    farmData = {
                        username: this.username,
                        farm: Array.from({ length: MAX_FARMSIZE }, () => Array.from({ length: 10 }, () => null)),
                        size: this.farmSize,
                        level: this.level,
                        exp: this.exp,
                    };
                    yield farmColl.insertOne(farmData);
                }
                return farmData;
            }
            catch (err) {
                throw new Error(this.username + 'error retrieving farm: ' + err);
            }
        });
    }
    getBag() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield db_1.default.connect();
                const db = db_1.default.db('agrifusion');
                const bagColl = db.collection('bags');
                let bagData = yield bagColl.findOne({ username: this.username });
                if (!bagData) {
                    bagData = {
                        username: this.username,
                        bag: [],
                        coins: 0,
                        crates: 10,
                    };
                    yield bagColl.insertOne(bagData);
                    console.log('New bag created for player:', this.username);
                }
                return bagData;
            }
            catch (err) {
                throw new Error(this.username + 'error retrieving bag: ' + err);
            }
        });
    }
    getOfflineTime() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield db_1.default.connect();
                const db = db_1.default.db('agrifusion');
                const userColl = db.collection('users');
                let userData = yield userColl.findOne({ username: this.username });
                const lastLogin = (userData === null || userData === void 0 ? void 0 : userData.lastLogin) || new Date();
                const currentTime = new Date();
                const offlineTime = Math.floor((currentTime.getTime() - lastLogin.getTime()) / 1000); // in seconds
                return offlineTime;
            }
            catch (err) {
                throw new Error(this.username + 'error retrieving bag: ' + err);
            }
        });
    }
}
exports.Player = Player;
//# sourceMappingURL=player.js.map