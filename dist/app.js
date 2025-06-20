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
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const crop_1 = require("./models/crop");
const auth_1 = require("./auth");
const express_session_1 = __importDefault(require("express-session"));
const player_1 = require("./models/player");
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, cors_1.default)({
    origin: true,
    credentials: true,
    exposedHeaders: ['set-cookie'],
}));
app.set('trust proxy', true);
const MongoDBStore = require('connect-mongodb-session')(express_session_1.default);
const user = process.env.DB_USER;
const pass = process.env.DB_PASS;
const uri = `mongodb+srv://${user}:${pass}@agrifusion-data.ocljyi7.mongodb.net/?retryWrites=true&w=majority&appName=agrifusion-data`;
const store = new MongoDBStore({
    uri: uri,
    databaseName: 'agrifusion',
    collection: 'sessions',
    clear_interval: 3600 * 24
});
app.use((0, express_session_1.default)({
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
}));
(0, auth_1.initPassport)(app);
app.get('/', (_, res) => {
    res.send('<h1>Agrifusion Backend</h1>');
});
const serv = http_1.default.createServer(app);
// setting up socket.io
const io = new socket_io_1.Server(serv, {
    cors: {
        origin: CLIENT_URL,
        credentials: true,
        methods: ["GET", "POST"],
    },
});
serv.listen(3000, () => {
    console.log(`server running at ${process.env.SERVER_URL}`);
});
const GRID_SIZE = 72;
const MAP_SIZE = 50;
// player list for tracking sockets
// key is the socket id, value is the socket object
let playerList = {};
const GameGrid = Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, () => null));
const ClaimGrid = Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, () => ''));
const MAX_FARMSIZE = 13;
autoSave(); // start autosave interval
updatePlayerPositions(); // start updating player positions
io.sockets.on('connection', (socket) => {
    console.log('socket connection %s', socket.id);
    const newPlayer = new player_1.Player(socket);
    playerList[socket.id] = newPlayer;
    console.log('players: %s', playerList);
    // remove player from player list on disconnection
    socket.on('disconnect', () => __awaiter(void 0, void 0, void 0, function* () {
        console.log('socket disconnection %s', socket.id);
        const player = playerList[socket.id];
        if (!player.loggedIn) {
            delete playerList[socket.id];
            io.emit('UPDATE player/disconnect', { username: socket.username });
            return;
        }
        try {
            if (player.farmPlaced) {
                const playerFarm = Array.from({ length: MAX_FARMSIZE }, () => Array.from({ length: MAX_FARMSIZE }, () => null));
                for (let x = 0; x < player.farmSize; x++) {
                    for (let y = 0; y < player.farmSize; y++) {
                        const gridX = player.farmOrigin.x + x;
                        const gridY = player.farmOrigin.y + y;
                        if (GameGrid[gridX][gridY])
                            playerFarm[x][y] = GameGrid[gridX][gridY];
                    }
                }
                yield player.saveFarm(playerFarm);
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
            yield player.saveBag();
        }
        catch (err) {
            console.error('Error updating farm:', err);
        }
        updateGameGrid();
        player.logout();
        delete playerList[socket.id];
        io.emit('UPDATE player/disconnect', { username: socket.username });
    }));
    // GET methods
    socket.on('GET player/data', (callback) => __awaiter(void 0, void 0, void 0, function* () {
        const player = playerList[socket.id];
        console.log('RECV: GET player/data', player.username);
        if (!player.loggedIn) {
            callback({ status: 'err', data: 'Player not logged in' });
            return;
        }
        try {
            const farmData = yield player.getFarm();
            const bagData = yield player.getBag();
            const offlineTime = yield player.getOfflineTime();
            player.farmSize = farmData.size; // set farm size from database
            player.level = farmData.level; // set player level from database
            player.exp = farmData.exp; // set player exp from database
            player.bag = bagData.bag; // set bag from database
            player.coins = bagData.coins; // set coins from database
            player.crates = bagData.crates; // set crates from database
            player.crates += Math.floor(offlineTime / 60); // add crates based on offline time, 1 crate per minute
            startCrateTimer(player); // start crate timer for the player
            updatePlayer(player); // update player data in the game
            console.log('GET player/data', player.username, '| offline time:', offlineTime);
            callback({ status: 'ok', data: '' });
        }
        catch (err) {
            console.error('Error fetching player data:', err);
            callback({ status: 'err', data: err });
        }
        updateGameGrid();
    }));
    socket.on('GET player/farm', (callback) => __awaiter(void 0, void 0, void 0, function* () {
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
            const farmData = yield player.getFarm();
            console.log('GET player/farm', username);
            player.farmSize = farmData.size; // set farm size from database
            for (let x = 0; x < player.farmSize; x++) {
                for (let y = 0; y < player.farmSize; y++) {
                    const gridX = player.farmOrigin.x + x;
                    const gridY = player.farmOrigin.y + y;
                    ClaimGrid[gridX][gridY] = username; // mark claim grid as occupied
                    if (farmData.farm[x][y] === null) {
                        GameGrid[gridX][gridY] = null;
                    }
                    else {
                        GameGrid[gridX][gridY] = {
                            id: farmData.farm[x][y].id,
                            pos: { x: gridX, y: gridY },
                            type: farmData.farm[x][y].type,
                            size: farmData.farm[x][y].size
                        };
                    }
                }
            }
            player.farmPlaced = true; // set farm placed to true
            callback({ status: 'ok', data: '' });
        }
        catch (err) {
            console.error(err);
            callback({ status: 'err', data: err });
        }
        updateGameGrid();
    }));
    socket.on('GET player/bag', (callback) => {
        const player = playerList[socket.id];
        console.log('RECV: GET player/bag', player.username);
        callback({ status: 'ok', data: player.bag });
    });
    // POST methods
    socket.on('POST player/login', (data, callback) => {
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
        }
        else {
            console.error('Socket not found for ID:', socket.id);
            callback({ status: 'err', response: `Socket not found for ID:${socket.id}` });
        }
    });
    socket.on('POST player/farm', (callback) => __awaiter(void 0, void 0, void 0, function* () {
        const player = playerList[socket.id];
        console.log('RECV: POST player/farm', player.username);
        if (!player.farmPlaced) {
            console.error('Player has not placed a farm yet');
            callback({ status: 'err', data: 'Farm not placed' });
            return;
        }
        const playerFarm = Array.from({ length: MAX_FARMSIZE }, () => Array.from({ length: MAX_FARMSIZE }, () => null));
        for (let x = 0; x < player.farmSize; x++) {
            for (let y = 0; y < player.farmSize; y++) {
                const gridX = player.farmOrigin.x + x;
                const gridY = player.farmOrigin.y + y;
                playerFarm[x][y] = GameGrid[gridX][gridY];
            }
        }
        try {
            yield player.saveFarm(playerFarm);
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
        }
        catch (err) {
            console.error('Error updating farm:', err);
            callback({ status: 'err', data: err });
        }
        updateGameGrid();
    }));
    socket.on('POST player/pos', (data, callback) => {
        const playerPos = data.pos;
        playerList[socket.id].pos = playerPos;
    });
    socket.on('POST player/sell', (data, callback) => {
        const player = playerList[socket.id];
        console.log('RECV: POST player/sell', player.username);
        if (player.removeItem(data.crop)) {
            player.addCoins(data.price);
            console.log(`Player ${player.username} sold ${data.crop} for $${data.price}`);
            callback({ status: 'ok', data: `Sold ${data.crop} for $${data.price}.` });
        }
        else {
            callback({ status: 'err', data: `Not enough items!` });
        }
        player.saveBag(); // Save the bag after selling
        updatePlayer(player);
    });
    socket.on('POST game/crop/spawn', (callback) => {
        console.log('RECV: POST game/crop/spawn');
        const player = playerList[socket.id];
        const possibleCrops = player_1.levels[player.level].crops;
        const randomCropType = possibleCrops[Math.floor(Math.random() * possibleCrops.length)];
        // find the nearest empty position to the player in the game grid
        const origin = { x: Math.round(player.pos.x / GRID_SIZE), y: Math.round(player.pos.y / GRID_SIZE) };
        let emptyPosFound = false;
        let searchRadius = 0;
        let newPos = { x: -1, y: -1 };
        while (!emptyPosFound && searchRadius < 5) {
            for (let x = origin.x - searchRadius; x <= origin.x + searchRadius; x++) {
                for (let y = origin.y - searchRadius; y <= origin.y + searchRadius; y++) {
                    if (x < 0 || x >= MAP_SIZE || y < 0 || y >= MAP_SIZE)
                        continue; // Skip out of bounds
                    if (GameGrid[x][y] === null) {
                        newPos = { x, y };
                        emptyPosFound = true;
                        break;
                    }
                }
                if (emptyPosFound)
                    break;
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
            size: crop_1.CropSize.SMALL
        };
        GameGrid[newPos.x][newPos.y] = newCrop; // Place the new crop in the game grid
        console.log(`Spawned new crop of type ${randomCropType} at position (${newPos.x}, ${newPos.y})`);
        updateGameGrid();
        updatePlayer(player);
    });
    socket.on('POST game/crop/move', (data, callback) => {
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
            if (crop.size === crop_1.CropSize.XLARGE) {
                console.log('RECV: POST game/crop/harvest', data);
                (0, crop_1.harvestCrop)(player, crop);
                GameGrid[crop.pos.x][crop.pos.y] = null; // Remove the crop from the grid
                callback({ status: 'ok', data: 'Crop harvested' });
            }
            else {
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
            && crop.size < crop_1.CropSize.XLARGE)) { // Prevent merging if already at max size
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
                    if (crop)
                        GameGrid[crop.pos.x][crop.pos.y] = null; // Remove crop from grid
                }
                // Spawn one new crop of the next size
                const newCrop = { id: Math.random(), pos: newPos, type: crop.type, size: newSize };
                GameGrid[newPos.x][newPos.y] = newCrop;
                GameGrid[oldPos.x][oldPos.y] = null; // Reset old position
                player.addExp(10); // Add experience for merging
                player.addCoins(3);
                callback({ status: 'ok', data: 'merged 3' });
                break;
            case mergeGroup.length >= 5:
                // Bonus merge: Merge up to 5 crops into two new crops of the next size
                {
                    for (let i = 0; i < 5; i++) {
                        const crop = mergeGroup[i];
                        if (crop)
                            GameGrid[crop.pos.x][crop.pos.y] = null; // Remove crop from grid
                    }
                    const newCrop = { id: Math.random(), pos: newPos, type: crop.type, size: newSize };
                    GameGrid[newPos.x][newPos.y] = newCrop;
                    // Spawn the second crop at nearest position to the first
                    const bonusCropGridPos = mergeGroup[2].pos;
                    const bonusCrop = { id: Math.random(), pos: bonusCropGridPos, type: crop.type, size: newSize };
                    GameGrid[bonusCropGridPos.x][bonusCropGridPos.y] = bonusCrop;
                    GameGrid[oldPos.x][oldPos.y] = null;
                    player.addExp(20); // Add experience for merging
                    player.addCoins(6);
                    callback({ status: 'ok', data: 'merged 5' });
                    break;
                }
        }
        updatePlayer(player);
        updateGameGrid();
    });
});
function updateGameGrid() {
    // Check for crops in the game grid and update their positions
    const cropInfo = {};
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
                };
            }
        }
    }
    const claimInfo = {};
    for (const socket in playerList) {
        const player = playerList[socket];
        claimInfo[player.username] = {
            origin: player.farmOrigin,
            size: player.farmSize,
            username: player.username,
        };
    }
    // Send the crop information to the clients
    io.emit('UPDATE game/grid', { grid: cropInfo, claim: claimInfo });
}
function updatePlayerPositions() {
    const playerPositions = {};
    for (const socketId in playerList) {
        const player = playerList[socketId];
        playerPositions[socketId] = {
            pos: player.pos,
            username: player.username,
        };
    }
    io.emit('UPDATE player/pos', playerPositions);
    setTimeout(updatePlayerPositions, 1000 / 10); // Update every 100ms
}
// save player farm and bag data periodically
function autoSave() {
    return __awaiter(this, void 0, void 0, function* () {
        if (Object.keys(playerList).length === 0) {
            console.log('No players online, skipping autosave');
            setTimeout(autoSave, 1000 * 60 * 5); // reschedule autosave every 5 minutes
            return;
        }
        console.log('Autosaving...');
        yield saveFarms();
        yield saveBags();
        setTimeout(autoSave, 1000 * 60 * 5); // reschedule autosave every 5 minutes
    });
}
function saveFarms() {
    return __awaiter(this, void 0, void 0, function* () {
        for (const socketId in playerList) {
            const player = playerList[socketId];
            if (player.loggedIn && player.farmPlaced) {
                const playerFarm = Array.from({ length: MAX_FARMSIZE }, () => Array.from({ length: MAX_FARMSIZE }, () => null));
                for (let x = 0; x < player.farmSize; x++) {
                    for (let y = 0; y < player.farmSize; y++) {
                        const gridX = player.farmOrigin.x + x;
                        const gridY = player.farmOrigin.y + y;
                        if (GameGrid[gridX][gridY])
                            playerFarm[x][y] = GameGrid[gridX][gridY];
                    }
                }
                yield player.saveFarm(playerFarm);
            }
        }
    });
}
function saveBags() {
    return __awaiter(this, void 0, void 0, function* () {
        for (const socketId in playerList) {
            const player = playerList[socketId];
            if (player.loggedIn) {
                yield player.saveBag();
            }
        }
    });
}
function dfs(crop, coll) {
    const mergeGroup = [crop, coll];
    const stack = [coll];
    const visited = new Set();
    visited.add(coll.id);
    visited.add(crop.id);
    while (stack.length > 0 && mergeGroup.length < 5) {
        const current = stack.pop();
        const currentGridX = current === null || current === void 0 ? void 0 : current.pos.x;
        const currentGridY = current === null || current === void 0 ? void 0 : current.pos.y;
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
    return mergeGroup;
}
function updatePlayer(player) {
    player.socket.emit('UPDATE player/level', { level: player.level, exp: player.exp });
    player.socket.emit('UPDATE player/coins', { coins: player.coins });
    player.socket.emit('UPDATE player/crates', { crates: player.crates });
}
function startCrateTimer(player) {
    player.addCrate(1); // Add a crate immediately
    player.socket.emit('UPDATE player/crates', { crates: player.crates });
    setTimeout(startCrateTimer, 1000 * 30, player); // Add a crate every 30 seconds
}
//# sourceMappingURL=app.js.map