import { WithId } from "mongodb";
import client from "../db";
import { ItemName } from "./bag";
import { Crop } from "./crop";

export class Player {
    socket: any;
    loggedIn: boolean = false;
    username: string = '';
    pos: { x: number, y: number } = { x: -1, y: -1 };
    coins: number = 0;
    bag: any[] = [];
    farmSize: number = 3;
    farmOrigin: { x: number, y: number } = { x: -1, y: -1 };
    farmPlaced: boolean = false;
    level: number = 1;
    exp: number = 0;

    constructor(socket: any) {
        this.socket = socket;
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
                    }
                }
            );
            console.log(this.username + 'bag updated successfully');
        } catch (err) {
            throw new Error(this.username + 'error updating farm: ' + err);
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
                    farm: Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => null)),
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
                }
                await bagColl.insertOne(bagData)
                console.log('New bag created for player:', this.username);
            }
            return bagData;
        } catch (err) {
            throw new Error(this.username + 'error retrieving bag: ' + err);
        }
    }
}

const levels = {
    1: { levelUp: 100, farmSize: 3 },
    2: { levelUp: 200, farmSize: 4 },
    3: { levelUp: 400, farmSize: 5 },
    4: { levelUp: 800, farmSize: 6 },
    5: { levelUp: 1600, farmSize: 7 },
}
