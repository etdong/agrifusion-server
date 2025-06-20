import client from "../db";
import { ItemName } from "./bag";
import { Crop } from "./crop";

export const levels = {
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
}

const MAX_FARMSIZE = 13

export class Player {
    socket: any;
    loggedIn: boolean = false;
    username: string = '';
    pos: { x: number, y: number } = { x: -1, y: -1 };

    coins: number = 0;
    bag: any[] = [];
    crates: number = 0;

    farmSize: number = 3;
    farmOrigin: { x: number, y: number } = { x: -1, y: -1 };
    farmPlaced: boolean = false;
    level: number = 1;
    exp: number = 0;

    constructor(socket: any) {
        this.socket = socket;
    }

    async logout(): Promise<void> {
        try {
            await client.connect();
            const db = client.db('agrifusion');
            const userColl = db.collection('users');
            await userColl.updateOne({ username: this.username }, {
            $set: {
                lastLogin: new Date()
            }})
        } catch (err) {
            throw new Error(this.username + ' error logging out: ' + err);
        }   
    }

    addItem(cropType: string): void {
        const itemSlot = this.bag.find(item => item.id === cropType);
        if (itemSlot) {
            itemSlot.amount += 1;
        } else {
            this.bag.push({ id: cropType, name: ItemName[cropType], amount: 1 }); // Add new cabbage item to bag
        }
        this.saveBag();
    }

    removeItem(cropType: string): boolean {
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

    addCoins(amount: number): void {
        this.coins += amount;
    }

    removeCoins(amount: number): boolean {
        if (this.coins >= amount) {
            this.coins -= amount;
            return true;
        }
        return false;
    }

    addCrate(amount: number): void {
        this.crates += amount;
    }

    openCrate(): boolean {
        if (this.crates > 0) {
            this.crates -= 1;
            return true;
        }
        return false;
    }

    addExp(amount: number): void {
        this.exp += amount;
        if (this.exp >= levels[this.level].levelUp) {
            this.levelUp();
        }
    }

    async levelUp(): Promise<void> {
        if (this.level < Object.keys(levels).length) {
            this.level += 1;
            this.exp = 0; // Reset experience after leveling up
            this.farmSize = levels[this.level].farmSize;
            try {
                await client.connect();
                const db = client.db('agrifusion');
                const farmColl = db.collection('farms');
                await farmColl.updateOne(
                    { username: this.username },
                    {
                        $set: {
                            level: this.level,
                            exp: this.exp,
                            size: this.farmSize,
                        }
                    }
                );
                console.log(`${this.username} leveled up to level ${this.level}! Farm size is now ${this.farmSize}`);
            } catch (err) {
                throw new Error(this.username + 'error leveling up: ' + err);
            }
        } else {
            console.log(`${this.username} is already at max level.`);
        }
    }

    async saveBag(): Promise<void> {
        try {
            await client.connect();
            const db = client.db('agrifusion');
            const bagColl = db.collection('bags');
            await bagColl.updateOne(
                { username: this.username },
                {
                    $set: {
                        bag: this.bag,
                        coins: this.coins,
                        crates: this.crates,
                    }
                }
            );
            console.log(this.username + ' bag updated successfully');
        } catch (err) {
            throw new Error(this.username + ' error updating farm: ' + err);
        }
    }

    async saveFarm(farm: { [key: number]: { [key: number]: Crop | null } }): Promise<void> {
        try {
            await client.connect();
            const db = client.db('agrifusion');
            const farmColl = db.collection('farms');
            await farmColl.updateOne(
                { username: this.username },
                {
                    $set: {
                        farm: farm,
                        size: this.farmSize,
                        level: this.level,
                        exp: this.exp,
                    }
                }
            );
            console.log(this.username + 'farm updated successfully');
        } catch (err) {
            throw new Error(this.username + 'error updating farm: ' + err);
        }
    }

    async getFarm(): Promise<any> {
        try {
            await client.connect();
            const db = client.db('agrifusion');
            const farmColl = db.collection('farms');
            let farmData: any = await farmColl.findOne({ username: this.username });
            if (!farmData) {
                farmData = {
                    username: this.username,
                    farm: Array.from({ length: MAX_FARMSIZE }, () => Array.from({ length: 10 }, () => null)),
                    size: this.farmSize,
                    level: this.level,
                    exp: this.exp,
                }
                await farmColl.insertOne(farmData)
            }
            return farmData;
        } catch (err) {
            throw new Error(this.username + 'error retrieving farm: ' + err);
        }
    }

    async getBag(): Promise<any> {
        try {
            await client.connect();
            const db = client.db('agrifusion');
            const bagColl = db.collection('bags');
            let bagData: any = await bagColl.findOne({ username: this.username });
            if (!bagData) {
                bagData = {
                    username: this.username,
                    bag: [],
                    coins: 0,
                    crates: 10,
                }
                await bagColl.insertOne(bagData)
                console.log('New bag created for player:', this.username);
            }
            return bagData;
        } catch (err) {
            throw new Error(this.username + 'error retrieving bag: ' + err);
        }
    }

    async getOfflineTime() {
        try {
            await client.connect();
            const db = client.db('agrifusion');
            const userColl = db.collection('users');
            let userData: any = await userColl.findOne({ username: this.username });
            const lastLogin = userData?.lastLogin || new Date();
            const currentTime = new Date();
            const offlineTime = Math.floor((currentTime.getTime() - lastLogin.getTime()) / 1000); // in seconds
            return offlineTime;
        } catch (err) {
            throw new Error(this.username + 'error retrieving bag: ' + err);
        }
    }
}
