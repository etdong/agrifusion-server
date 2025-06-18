import { WithId } from "mongodb";
import client from "../db";
import { ItemName } from "./bag";
import { Crop } from "./crop";

export class Player {
    socket: any;
    loggedIn: boolean;
    username: string;
    pos: { x: number, y: number };
    coins: number;
    bag: any[];
    farmSize: number;
    farmOrigin: { x: number, y: number };
    farmPlaced: boolean;

    constructor(socket: any) {
        this.socket = socket;
        this.loggedIn = false;
        this.username = '';
        this.pos = { x: -1, y: -1 };
        this.coins = 0;
        this.bag = [];
        this.farmSize = 3;
        this.farmOrigin = { x: -1, y: -1 };
        this.farmPlaced = false;
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
                        farmSize: this.farmSize,
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
                    farm: Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => null)),
                    size: this.farmSize,
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
