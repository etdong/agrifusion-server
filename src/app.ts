import express from 'express';
import cors from 'cors'
import http from 'http'
import { Server } from 'socket.io'
import { Crop, CropSize, CropType, harvestCrop } from './models/crop';
import { initPassport } from './auth';
import session from 'express-session';
import { levels, Player } from './models/player';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cors({
    origin: true,
    credentials: true,
    exposedHeaders: ['set-cookie'],
}));

app.set('trust proxy', true)

const MongoDBStore = require('connect-mongodb-session')(session);
const user = process.env.DB_USER;
const pass = process.env.DB_PASS;
const uri = `mongodb+srv://${user}:${pass}@agrifusion-data.ocljyi7.mongodb.net/?retryWrites=true&w=majority&appName=agrifusion-data`
const store = new MongoDBStore({
  uri: uri,
  databaseName: 'agrifusion',
  collection: 'sessions',
  clear_interval: 3600 * 24
});

app.use(session({ 
    secret: "secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24
    },
    proxy: true,
    store: store
}))
initPassport(app);

app.get('/', (_, res) => {
  res.send('<h1>Agrifusion Backend</h1>');
});

const serv = http.createServer(app)

// setting up socket.io
const io = new Server(serv, {
    cors: {
        origin: CLIENT_URL,
        credentials: true,
        methods: ["GET", "POST"],
    },
})


serv.listen(3000, () => {
  console.log(`server running at ${process.env.SERVER_URL}`);
});

const GRID_SIZE = 72;
const MAP_SIZE = 50

// player list for tracking sockets
// key is the socket id, value is the socket object
let playerList: { [key: string]: Player } = {};

const GameGrid: { [key: number]: { [key: number]: Crop | null } } = Array.from({ length: MAP_SIZE }, () =>
    Array.from({ length: MAP_SIZE }, () => null))

const ClaimGrid: { [key: number]: { [key: number]: string } } = Array.from({ length: MAP_SIZE }, () =>
    Array.from({ length: MAP_SIZE }, () => '' ))

const MAX_FARMSIZE = 13

autoSave(); // start autosave interval
updatePlayerPositions(); // start updating player positions

io.sockets.on('connection', (socket: any) => {
    console.log('socket connection %s', socket.id);
    const newPlayer = new Player(socket);
    playerList[socket.id] = newPlayer;
    console.log('players: %s', playerList)

    // remove player from player list on disconnection
    socket.on('disconnect', async () => {
        console.log('socket disconnection %s', socket.id)
        const player = playerList[socket.id];
        if (!player.loggedIn) {
            delete playerList[socket.id];
            io.emit('UPDATE player/disconnect', { username: socket.username });
            return;
        }
        try {
            if (player.farmPlaced) {
                const playerFarm: { [key: number]: { [key: number]: Crop | null } } = Array.from({ length: MAX_FARMSIZE }, () => Array.from({ length: MAX_FARMSIZE }, () => null))
                for (let x = 0; x < player.farmSize; x++) {
                    for (let y = 0; y < player.farmSize; y++) {
                        const gridX = player.farmOrigin.x + x;
                        const gridY = player.farmOrigin.y + y;
                        if (GameGrid[gridX][gridY]) playerFarm[x][y] = GameGrid[gridX][gridY];
                    }
                }

                await player.saveFarm(playerFarm);
                console.log('POST player/farm', player.username);
                for (let x = 0; x < player.farmSize; x++) {
                    for (let y = 0; y < player.farmSize; y++) {
                        const gridX = player.farmOrigin.x + x;
                        const gridY = player.farmOrigin.y + y;
                        ClaimGrid[gridX][gridY] = ''; // mark claim grid as clear
                        GameGrid[gridX][gridY] = null;
                    }
                }
            }
            await player.saveBag();
        } catch (err) {
            console.error('Error updating farm:', err);
        }
        updateGameGrid();
        player.logout()
        delete playerList[socket.id];
        io.emit('UPDATE player/disconnect', { username: socket.username });
    })


    // GET methods

    socket.on('GET player/data', async (callback: (arg0: { status: string; data: any; }) => void) => {
        const player = playerList[socket.id];
        console.log('RECV: GET player/data', player.username);
        if (!player.loggedIn) {
            callback({ status: 'err', data: 'Player not logged in' });
            return;
        }

        try {
            const farmData = await player.getFarm();
            const bagData = await player.getBag();
            const offlineTime = await player.getOfflineTime();

            player.farmSize = farmData.size; // set farm size from database
            player.level = farmData.level; // set player level from database
            player.exp = farmData.exp; // set player exp from database
            player.bag = bagData.bag; // set bag from database
            player.coins = bagData.coins; // set coins from database
            player.crates = bagData.crates; // set crates from database
            player.crates += Math.floor(offlineTime / 60) ; // add crates based on offline time, 1 crate per minute
            startCrateTimer(player); // start crate timer for the player
            updatePlayer(player); // update player data in the game
            console.log('GET player/data', player.username, '| offline time:', offlineTime);
            callback({ status: 'ok', data: '' });
        } catch (err) {
            console.error('Error fetching player data:', err);
            callback({ status: 'err', data: err });
        }
        updateGameGrid();
    })

    socket.on('GET player/farm', async (callback: (arg0: { status: string; data: any; }) => void) => {
        const player = playerList[socket.id];
        const username = player.username;
        console.log('RECV: GET player/farm', username);
        const playerGridPos = { x: Math.round(player.pos.x / GRID_SIZE), y: Math.round(player.pos.y / GRID_SIZE) };
        player.farmOrigin = playerGridPos;

        if (playerGridPos.x < 0 || playerGridPos.x >= MAP_SIZE || playerGridPos.y < 0 || playerGridPos.y >= MAP_SIZE) {
            console.error('Player position out of bounds:', playerGridPos);
            callback({ status: 'err', data: 'Player position out of bounds' });
            return;
        }

        if (player.farmPlaced) {
            console.error('Player already has a farm placed:', username);
            callback({ status: 'err', data: 'Farm already placed' });
            return;
        }

        for (let x = 0; x < player.farmSize; x++) {
            for (let y = 0; y < player.farmSize; y++) {
                const gridX = player.farmOrigin.x + x;
                const gridY = player.farmOrigin.y + y;
                // check for out of bounds
                if (gridX < 0 || gridX >= MAP_SIZE || gridY < 0 || gridY >= MAP_SIZE) {
                    console.error('Farm position out of bounds:', { x: gridX, y: gridY });
                    callback({ status: 'err', data: 'Farm position out of bounds' });
                    return;
                }
                // check the claimgrid for intersections
                if (ClaimGrid[gridX][gridY] !== '') {
                    console.error('Farm position already claimed:', { x: gridX, y: gridY, username: ClaimGrid[gridX][gridY] });
                    callback({ status: 'err', data: 'Farm position already claimed' });
                    return;
                }
            }
        }

        try {
            const farmData = await player.getFarm();
            console.log('GET player/farm', username);
            player.farmSize = farmData.size; // set farm size from database
            
            for (let x = 0; x < player.farmSize; x++) {
                for (let y = 0; y < player.farmSize; y++) {
                    const gridX = player.farmOrigin.x + x;
                    const gridY = player.farmOrigin.y + y;
                    ClaimGrid[gridX][gridY] = username; // mark claim grid as occupied
                    if (farmData.farm[x][y] === null) {
                        GameGrid[gridX][gridY] = null;
                    } else {
                        GameGrid[gridX][gridY] = {
                            id: farmData.farm[x][y].id,
                            pos: { x: gridX, y: gridY },
                            type: farmData.farm[x][y].type,
                            size: farmData.farm[x][y].size
                        }
                    }
                }
            }
            player.farmPlaced = true; // set farm placed to true
            callback({ status: 'ok', data: '' });
        } catch (err) {
            console.error(err);
            callback({ status: 'err', data: err });
        }
        updateGameGrid();
    })

    socket.on('GET player/bag', (callback: (arg0: { status: string; data: any; }) => void) => {
        const player = playerList[socket.id];
        console.log('RECV: GET player/bag', player.username);
        callback({ status: 'ok', data: player.bag });
    })

    // POST methods

    socket.on('POST player/login', ( data: { username: string, lastLogin: Date }, callback: (arg0: { status: string; response: any; }) => void) => {
        console.log('RECV: login', data.username);
        if (playerList[socket.id]) {
            for (const player of Object.values(playerList)) {
                if (player.username === data.username && player.loggedIn) {
                    console.error('Player already logged in:', data.username);
                    callback({ status: 'err', response: 'Player already logged in' });
                    return;
                }
            }
            const player = playerList[socket.id];
            player.loggedIn = true;
            player.username = data.username;
            callback({ status: 'ok', response: 'Player login successful' });
        } else {
            console.error('Socket not found for ID:', socket.id);
            callback({ status: 'err', response: `Socket not found for ID:${socket.id}` });
        }
    })

    socket.on('POST player/farm', async (callback: (arg0: { status: string; data: any; }) => void) => {
        const player = playerList[socket.id];
        console.log('RECV: POST player/farm', player.username);

        if (!player.farmPlaced) {
            console.error('Player has not placed a farm yet');
            callback({ status: 'err', data: 'Farm not placed' });
            return;
        }

        const playerFarm: { 
                [key: number]: { [key: number]: Crop | null } 
            } = Array.from({ length: MAX_FARMSIZE }, () =>
                Array.from({ length: MAX_FARMSIZE }, () => null))
        for (let x = 0; x < player.farmSize; x++) {
            for (let y = 0; y < player.farmSize; y++) {
                const gridX = player.farmOrigin.x + x;
                const gridY = player.farmOrigin.y + y;
                playerFarm[x][y] = GameGrid[gridX][gridY];
            }
        }

        try {
            await player.saveFarm(playerFarm);
            console.log('POST player/farm', player.username);
            for (let x = 0; x < player.farmSize; x++) {
                for (let y = 0; y < player.farmSize; y++) {
                    const gridX = player.farmOrigin.x + x;
                    const gridY = player.farmOrigin.y + y;
                    ClaimGrid[gridX][gridY] = ''; // mark claim grid as clear
                    GameGrid[gridX][gridY] = null;
                }
            }
            player.farmPlaced = false; // reset farm placed to false
            player.farmOrigin = { x: -1, y: -1 }; // reset farm origin
            callback({ status: 'ok', data: null });
        } catch (err) {
            console.error('Error updating farm:', err);
            callback({ status: 'err', data: err });
        }
        updateGameGrid();
    });

    socket.on('POST player/pos', (data: any, callback: any) => {
        const playerPos = data.pos;
        playerList[socket.id].pos = playerPos;
    })

    socket.on('POST player/sell', (data: { price: number, crop: string }, callback: (arg0: { status: string; data: any; }) => void) => {
        const player = playerList[socket.id];
        console.log('RECV: POST player/sell', player.username);
        if (player.removeItem(data.crop)) {
            player.addCoins(data.price);
            console.log(`Player ${player.username} sold ${data.crop} for $${data.price}`);
            callback({ status: 'ok', data: `Sold ${data.crop} for $${data.price}.` });
        } else {
            callback({ status: 'err', data: `Not enough items!` });
        }
        player.saveBag(); // Save the bag after selling
        updatePlayer(player);
    })

    socket.on('POST game/crop/spawn', (callback: (arg0: { status: string; data: any; }) => void) => {
        console.log('RECV: POST game/crop/spawn');
        const player = playerList[socket.id];
        const possibleCrops = levels[player.level].crops;
        const randomCropType = possibleCrops[Math.floor(Math.random() * possibleCrops.length)];
        // find the nearest empty position to the player in the game grid
        const origin = { x: Math.round(player.pos.x / GRID_SIZE), y: Math.round(player.pos.y / GRID_SIZE) };
        let emptyPosFound = false;
        let searchRadius = 0;
        let newPos = { x: -1, y: -1 };
        while (!emptyPosFound && searchRadius < 5) {
            for (let x = origin.x - searchRadius; x <= origin.x + searchRadius; x++) {
                for (let y = origin.y - searchRadius; y <= origin.y + searchRadius; y++) {
                    if (x < 0 || x >= MAP_SIZE || y < 0 || y >= MAP_SIZE) continue; // Skip out of bounds
                    if (GameGrid[x][y] === null) {
                        newPos = { x, y };
                        emptyPosFound = true;
                        break;
                    }
                }
                if (emptyPosFound) break;
            }
            searchRadius++;
        }

        if (!emptyPosFound) {
            console.error('No empty position found for new crop');
            callback({ status: 'err', data: 'No empty position found for new crop' });
            return;
        }

        if (!player.openCrate()) {
            console.error('Player does not have enough crates to spawn a crop');
            callback({ status: 'err', data: 'Not enough crates to spawn a crop' });
            return;
        }

        const newCrop = {
            id: Math.random(),
            pos: newPos,
            type: randomCropType,
            size: CropSize.SMALL
        }

        GameGrid[newPos.x][newPos.y] = newCrop; // Place the new crop in the game grid
        console.log(`Spawned new crop of type ${randomCropType} at position (${newPos.x}, ${newPos.y})`);

        updateGameGrid();
        updatePlayer(player);
    })

    socket.on('POST game/crop/move', (data: { oldPos: any, newPos: any }, callback: (arg0: { status: string; data: any; }) => void) => {
        const player = playerList[socket.id];
        const oldPos = data.oldPos;
        const newPos = data.newPos;

        if (!GameGrid[oldPos.x][oldPos.y]) {
            console.error('No crop at old position:', oldPos);
            callback({ status: 'err', data: 'No crop at old position' });
            updateGameGrid();
            return;
        }

        const crop = GameGrid[oldPos.x][oldPos.y];

        if (oldPos.x === newPos.x && oldPos.y === newPos.y) {
            if (crop.size === CropSize.XLARGE) {
                console.log('RECV: POST game/crop/harvest', data)
                harvestCrop(player, crop);
                GameGrid[crop.pos.x][crop.pos.y] = null; // Remove the crop from the grid
                callback({ status: 'ok', data: 'Crop harvested' });
            } else {
                callback({ status: 'ok', data: null });
            }
            updatePlayer(player);
            updateGameGrid();
            return;
        }

        // If the new position is not occupied, move the crop
        if (GameGrid[newPos.x][newPos.y] === null) {
            const tempCrop = GameGrid[oldPos.x][oldPos.y];
            tempCrop.pos = newPos; // Update the position of the crop
            GameGrid[newPos.x][newPos.y] = tempCrop; // Mark new position as occupied
            GameGrid[oldPos.x][oldPos.y] = null; // Set old position to unoccupied
            callback({ status: 'ok', data: `moved: (${oldPos.x}, ${oldPos.y}) to (${newPos.x}, ${newPos.y})` });
            updateGameGrid();
            return;
        }

        // Crop is trying to move onto an occupied position
        const coll = GameGrid[newPos.x][newPos.y];
        // If the colliding crop is not the same type or size, prevent merging
        if (!(coll && coll.type === crop.type
        && coll.size === crop.size
        && crop.size < CropSize.XLARGE)) { // Prevent merging if already at max size
            callback({ status: 'err', data: 'Cannot move crop onto occupied position without merge' });
            updateGameGrid();
            return;
        }

        // Merge logic: DFS the game grid to find and merge connected crops of the same type and size
        const mergeGroup = dfs(crop, coll);

        const newSize = crop.size + 5;
        switch (true) {
            case mergeGroup.length < 3:
                callback({ status: 'err', data: 'Cannot move crop onto occupied position without merge' });
                break;
            case mergeGroup.length < 5:
                // Only merge up to 3 crops if there are less than 5
                for (let i = 0; i < 3; i++) {
                    const crop = mergeGroup[i];
                    if (crop) GameGrid[crop.pos.x][crop.pos.y] = null; // Remove crop from grid
                }
                // Spawn one new crop of the next size
                const newCrop: Crop = { id: Math.random(), pos: newPos, type: crop.type, size: newSize};
                GameGrid[newPos.x][newPos.y] = newCrop;
                GameGrid[oldPos.x][oldPos.y] = null; // Reset old position
                player.addExp(10); // Add experience for merging
                player.addCoins(3)
                callback({ status: 'ok', data: 'merged 3' });
                break;
            case mergeGroup.length >= 5:
                // Bonus merge: Merge up to 5 crops into two new crops of the next size
                { for (let i = 0; i < 5; i++) {
                    const crop = mergeGroup[i];
                    if (crop) GameGrid[crop.pos.x][crop.pos.y] = null; // Remove crop from grid
                }

                const newCrop: Crop = { id: Math.random(), pos: newPos, type: crop.type, size: newSize};
                GameGrid[newPos.x][newPos.y] = newCrop;
                // Spawn the second crop at nearest position to the first
                const bonusCropGridPos = mergeGroup[2].pos;
                const bonusCrop: Crop = { id: Math.random(), pos: bonusCropGridPos, type: crop.type, size: newSize};
                GameGrid[bonusCropGridPos.x][bonusCropGridPos.y] = bonusCrop
                GameGrid[oldPos.x][oldPos.y] = null;
                player.addExp(20); // Add experience for merging
                player.addCoins(6)
                callback({ status: 'ok', data: 'merged 5' });
                break; 
            }
        }
        updatePlayer(player);
        updateGameGrid();
    })
})

function updateGameGrid() {
    // Check for crops in the game grid and update their positions
    const cropInfo: { [key: string]: { crop: Crop }} = {};
    for (let x = 0; x < MAP_SIZE; x++) {
        for (let y = 0; y < MAP_SIZE; y++) {
            const crop = GameGrid[x][y];
            if (crop) {
                cropInfo[`${x},${y}`] = {
                    crop: {
                        id: crop.id,
                        pos: { x, y },
                        type: crop.type,
                        size: crop.size
                    }
                }
            }
        }
    }

    const claimInfo: { [key: string]: { origin: { x: number, y: number }, size: number, username: string }} = {}
    for (const socket in playerList) {
        const player = playerList[socket];
        claimInfo[player.username] = {
            origin: player.farmOrigin,
            size: player.farmSize,
            username: player.username,
        }
    }
    // Send the crop information to the clients
    io.emit('UPDATE game/grid', { grid: cropInfo, claim: claimInfo });
}

function updatePlayerPositions() {
    const playerPositions: { [key: string]: { pos: { x: number, y: number }, username: string }} = {};
    for (const socketId in playerList) {
        const player = playerList[socketId];
        playerPositions[socketId] = {
            pos: player.pos,
            username: player.username,
        }
    }
    io.emit('UPDATE player/pos', playerPositions);
    setTimeout(updatePlayerPositions, 1000 / 10); // Update every 100ms
}

// save player farm and bag data periodically
async function autoSave() {
    if (Object.keys(playerList).length === 0) {
        console.log('No players online, skipping autosave');
        setTimeout(autoSave, 1000 * 60 * 5); // reschedule autosave every 5 minutes
        return;
    }
    console.log('Autosaving...')
    await saveFarms();
    await saveBags();
    setTimeout(autoSave, 1000 * 60 * 5); // reschedule autosave every 5 minutes
}

async function saveFarms() {
    for (const socketId in playerList) {
        const player = playerList[socketId];
        if (player.loggedIn && player.farmPlaced) {
            const playerFarm: { [key: number]: { [key: number]: Crop | null } } = Array.from({ length: MAX_FARMSIZE }, () => Array.from({ length: MAX_FARMSIZE }, () => null))
            for (let x = 0; x < player.farmSize; x++) {
                for (let y = 0; y < player.farmSize; y++) {
                    const gridX = player.farmOrigin.x + x;
                    const gridY = player.farmOrigin.y + y;
                    if (GameGrid[gridX][gridY]) playerFarm[x][y] = GameGrid[gridX][gridY];
                }
            }
            await player.saveFarm(playerFarm);
        }
    }
}

async function saveBags() {
    for (const socketId in playerList) {
        const player = playerList[socketId];
        if (player.loggedIn) {
            await player.saveBag();
        }
    }
}

function dfs(crop: Crop, coll: Crop): Crop[] {
    const mergeGroup = [crop, coll];
    const stack = [coll];
    const visited = new Set();
    visited.add(coll.id);
    visited.add(crop.id);

    while (stack.length > 0 && mergeGroup.length < 5) { 
        const current = stack.pop();
        const currentGridX = current?.pos.x;
        const currentGridY = current?.pos.y;
        
        // Check all 4 directions for connected crops
        const directions = [
            { x: 1, y: 0 }, // Right
            { x: -1, y: 0 }, // Left
            { x: 0, y: 1 }, // Down
            { x: 0, y: -1 } // Up
        ];
        
        for (const dir of directions) {
            const neighborX = currentGridX + dir.x;
            const neighborY = currentGridY + dir.y;
            
            if (GameGrid[neighborX] && GameGrid[neighborY]) {
                const neighbor = GameGrid[neighborX][neighborY];
                if (neighbor 
                    && neighbor.type === crop.type 
                    && neighbor.size === crop.size 
                    && !visited.has(neighbor.id)) {
                    mergeGroup.push(neighbor);
                    stack.push(neighbor);
                    visited.add(neighbor.id);
                }
            }
        }
    }
    return mergeGroup
}

function updatePlayer(player: Player) {
    player.socket.emit('UPDATE player/level', { level: player.level, exp: player.exp });
    player.socket.emit('UPDATE player/coins', { coins: player.coins });
    player.socket.emit('UPDATE player/crates', { crates: player.crates });
}

function startCrateTimer(player: Player) {
    player.addCrate(1); // Add a crate immediately
    player.socket.emit('UPDATE player/crates', { crates: player.crates });
    setTimeout(startCrateTimer, 1000 * 30, player); // Add a crate every 30 seconds
}
