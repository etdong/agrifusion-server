"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const db_1 = __importDefault(require("./db"));
const crop_1 = require("./models/crop");
const auth_1 = require("./auth");
const express_session_1 = __importDefault(require("express-session"));
const bag_1 = require("./models/bag");
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, cors_1.default)({
    origin: CLIENT_URL,
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
        secure: true,
        sameSite: 'none',
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
    console.log(`server running at ${SERVER_URL}`);
    console.log(`CORS enabled for ${CLIENT_URL}`);
});
const GRID_SIZE = 72;
const MAP_SIZE = 50;
// player list for tracking sockets
// key is the socket id, value is the socket object
let playerList = {};
const GameGrid = Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, () => null));
const ClaimGrid = Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, () => ''));
const DEF_FARMSIZE = 3;
const DEF_COINS = 0;
const DEF_FARM = Array.from({ length: DEF_FARMSIZE }, () => Array.from({ length: DEF_FARMSIZE }, () => null));
io.sockets.on('connection', (socket) => {
    console.log('socket connection %s', socket.id);
    playerList[socket.id] = socket;
    socket.loggedIn = false;
    socket.username = '-1';
    socket.pos = { x: -1, y: -1 };
    socket.coins = DEF_COINS,
        socket.bag = [];
    socket.farmSize = DEF_FARMSIZE; // default farm size
    socket.farmOrigin = { x: -1, y: -1 };
    socket.farmPlaced = false;
    console.log('players: %s', playerList);
    // remove player from player list on disconnection
    socket.on('disconnect', () => {
        console.log('socket disconnection %s', socket.id);
        const player = playerList[socket.id];
        if (!player.loggedIn) {
            delete playerList[socket.id];
            io.emit('UPDATE player/disconnect', { username: socket.username });
            return;
        }
        db_1.default.connect().then(() => {
            const db = db_1.default.db('agrifusion');
            const farmColl = db.collection('farms');
            const bagColl = db.collection('bags');
            const username = player.username;
            if (player.farmPlaced) {
                const playerFarm = Array.from({ length: player.farmSize }, () => Array.from({ length: player.farmSize }, () => null));
                for (let x = 0; x < player.farmSize; x++) {
                    for (let y = 0; y < player.farmSize; y++) {
                        const gridX = player.farmOrigin.x + x;
                        const gridY = player.farmOrigin.y + y;
                        if (GameGrid[gridX][gridY])
                            playerFarm[x][y] = GameGrid[gridX][gridY];
                    }
                }
                farmColl.updateOne({ username: username }, { $set: {
                        farm: playerFarm,
                        size: player.farmSize, // save farm size to database
                    },
                }).catch((err) => {
                    console.error('Error updating farm:', err);
                }).then(() => {
                    console.log('POST player/farm', username);
                    for (let x = 0; x < player.farmSize; x++) {
                        for (let y = 0; y < player.farmSize; y++) {
                            const gridX = player.farmOrigin.x + x;
                            const gridY = player.farmOrigin.y + y;
                            GameGrid[gridX][gridY] = null;
                            ClaimGrid[gridX][gridY] = ''; // mark claim grid as clear
                        }
                    }
                    updateGameGrid();
                });
            }
            bagColl.updateOne({ username: username }, { $set: {
                    bag: player.bag,
                    coins: player.coins,
                }
            }).catch((err) => {
                console.error('Error updating farm:', err);
            }).then(() => {
                console.log('POST player/bag', username);
                updateGameGrid();
            });
        });
        delete playerList[socket.id];
        io.emit('UPDATE player/disconnect', { username: socket.username });
    });
    // GET methods
    socket.on('GET player/data', (callback) => {
        const player = playerList[socket.id];
        console.log('RECV: GET player/data', player.username);
        if (!player.loggedIn) {
            callback({ status: 'err', data: 'Player not logged in' });
            return;
        }
        db_1.default.connect().then(() => {
            const db = db_1.default.db('agrifusion');
            const farmColl = db.collection('farms');
            const bagColl = db.collection('bags');
            farmColl.findOne({ username: player.username }).then((result) => {
                console.log('GET player/data/farm', player.username);
                if (result) {
                    player.farmSize = result.size; // set farm size from database
                    bagColl.findOne({ username: player.username }).then((result) => {
                        console.log('GET player/data/bag', player.username);
                        if (result) {
                            player.bag = result.bag; // set bag from database
                            player.coins = result.coins; // set coins from database
                            player.emit('UPDATE player/coins', { coins: player.coins });
                            callback({ status: 'ok', data: { username: player.username, bag: [], coins: DEF_COINS } });
                            return;
                        }
                    }).catch((err) => {
                        console.error('Error fetching player bag:', err);
                        callback({ status: 'err', data: err });
                    });
                }
                else {
                    farmColl.insertOne({
                        username: player.username,
                        farm: DEF_FARM,
                        size: player.farmSize, // save farm size to database
                    }).then(() => {
                        console.log('New farm created for player:', player.username);
                        bagColl.insertOne({
                            username: player.username,
                            bag: [],
                            coins: DEF_COINS,
                        }).then(() => {
                            console.log('New bag created for player:', player.username);
                            player.emit('UPDATE player/coins', { coins: player.coins });
                            callback({ status: 'ok', data: { username: player.username, bag: [], coins: DEF_COINS } });
                            return;
                        }).catch((err) => {
                            console.error('Error creating new bag:', err);
                            callback({ status: 'err', data: err });
                        });
                        player.bag = [];
                    }).catch((err) => {
                        console.error('Error creating new farm:', err);
                        callback({ status: 'err', data: err });
                    });
                    updateGameGrid();
                }
            }).catch((err) => {
                console.error('Error fetching player data:', err);
                callback({ status: 'err', data: err });
            });
        });
    });
    socket.on('GET player/farm', (callback) => {
        const player = playerList[socket.id];
        const username = player.username;
        console.log('RECV: GET player/farm', username);
        const playerGridPos = { x: Math.round(player.pos.x / GRID_SIZE), y: Math.round(player.pos.y / GRID_SIZE) };
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
        db_1.default.connect().then(() => {
            const db = db_1.default.db('agrifusion');
            const collection = db.collection('farms');
            collection.findOne({ username: username }).then((result) => {
                if (result) {
                    console.log('GET player/farm', username);
                    player.farmSize = result.size; // set farm size from database
                    player.farmOrigin = playerGridPos;
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
                    // if it gets here, it's clear to go
                    for (let x = 0; x < player.farmSize; x++) {
                        for (let y = 0; y < player.farmSize; y++) {
                            const gridX = player.farmOrigin.x + x;
                            const gridY = player.farmOrigin.y + y;
                            ClaimGrid[gridX][gridY] = username; // mark claim grid as occupied
                            if (result.farm[x][y] === null) {
                                GameGrid[gridX][gridY] = null;
                            }
                            else {
                                GameGrid[gridX][gridY] = {
                                    id: result.farm[x][y].id,
                                    pos: { x: gridX, y: gridY },
                                    type: result.farm[x][y].type,
                                    size: result.farm[x][y].size
                                };
                            }
                        }
                    }
                    player.farmPlaced = true; // set farm placed to true
                    callback({ status: 'ok', data: result.farm });
                }
                else {
                    console.log('No farm found for player:', username);
                    callback({ status: 'err', data: `No farm found for player: ${username}` });
                }
                updateGameGrid();
            }).catch((err) => {
                console.error('Error fetching farm:', err);
                callback({ status: 'err', data: err });
                updateGameGrid();
            });
        });
    });
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
                    callback({ status: 'err', data: 'Player already logged in' });
                    return;
                }
            }
            const player = playerList[socket.id];
            player.loggedIn = true;
            player.username = data.username;
            console.log('Player logged in:', data.username);
            callback({ status: 'ok', data: 'Player login successful' });
        }
        else {
            console.error('Socket not found for ID:', socket.id);
            callback({ status: 'err', data: `Socket not found for ID:${socket.id}` });
        }
    });
    socket.on('POST player/farm', (callback) => {
        const player = playerList[socket.id];
        console.log('RECV: POST player/farm', player.username);
        if (!player.farmPlaced) {
            console.error('Player has not placed a farm yet');
            callback({ status: 'err', data: 'Farm not placed' });
            return;
        }
        const username = player.username;
        const playerFarm = Array.from({ length: player.farmSize }, () => Array.from({ length: player.farmSize }, () => null));
        for (let x = 0; x < player.farmSize; x++) {
            for (let y = 0; y < player.farmSize; y++) {
                const gridX = player.farmOrigin.x + x;
                const gridY = player.farmOrigin.y + y;
                playerFarm[x][y] = GameGrid[gridX][gridY];
            }
        }
        db_1.default.connect().then(() => {
            const db = db_1.default.db('agrifusion');
            const collection = db.collection('farms');
            collection.updateOne({ username: username }, { $set: {
                    farm: playerFarm,
                    size: player.farmSize, // save farm size to database
                },
            }, { upsert: true }).catch((err) => {
                console.error('Error updating farm:', err);
                callback({ status: 'err', data: err });
                updateGameGrid();
            }).then(() => {
                console.log('POST player/farm', username);
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
                updateGameGrid();
            });
        });
    });
    socket.on('POST player/pos', (data, callback) => {
        const playerPos = data.pos;
        playerList[socket.id].pos = playerPos;
    });
    socket.on('POST player/sell', (data, callback) => {
        const player = playerList[socket.id];
        console.log('RECV: POST player/sell', player.username);
        const itemSlot = player.bag.find(item => item.id === data.crop);
        if (itemSlot && itemSlot.amount > 0) {
            itemSlot.amount -= 1; // Decrement the item amount
            player.coins += data.price; // Add the price to player's coins
            if (itemSlot.amount === 0) {
                player.bag = player.bag.filter(item => item.id !== data.crop); // Remove item if amount is 0
            }
            console.log(`Sold ${data.crop} for $${data.price}. New balance: $${player.coins}`);
            callback({ status: 'ok', data: `Sold ${data.crop} for $${data.price}` });
        }
        saveBag(player); // Save the bag after selling
        socket.emit('UPDATE player/coins', { coins: player.coins });
    });
    socket.on('POST game/crop/spawn', (data, callback) => {
        console.log('RECV: POST game/crop/spawn', data.newCrop);
        const newCrop = data.newCrop;
        GameGrid[newCrop.pos.x][newCrop.pos.y] = newCrop;
        callback({ status: 'ok', data: newCrop });
        updateGameGrid();
    });
    socket.on('POST game/crop/move', (data, callback) => {
        const oldPos = data.oldPos;
        const newPos = data.newPos;
        if (!GameGrid[oldPos.x][oldPos.y]) {
            console.error('No crop at old position:', oldPos);
            callback({ status: 'err', data: 'No crop at old position' });
            return;
        }
        const crop = GameGrid[oldPos.x][oldPos.y];
        if (oldPos.x === newPos.x && oldPos.y === newPos.y) {
            if (crop.size === crop_1.CropSize.XLARGE) {
                console.log('RECV: POST game/crop/harvest', data);
                const player = playerList[socket.id];
                switch (crop.type) {
                    case 'wheat':
                        player.coins += 10; // Give 10 coins for harvesting wheat
                        updateOrAddItem(player, crop_1.CropType.WHEAT);
                        break;
                    case 'corn':
                        playerList[socket.id].coins += 15; // Give 15 coins for harvesting corn
                        updateOrAddItem(player, crop_1.CropType.CORN);
                        break;
                    case 'carrot':
                        playerList[socket.id].coins += 20; // Give 20 coins for harvesting carrots
                        updateOrAddItem(player, crop_1.CropType.CARROT);
                        break;
                    case 'cabbage':
                        playerList[socket.id].coins += 30; // Give 20 coins for harvesting cabbage
                        updateOrAddItem(player, crop_1.CropType.CABBAGE);
                        break;
                    default:
                        console.error('Unknown crop type:', crop.type);
                }
                GameGrid[oldPos.x][oldPos.y] = null; // Remove the crop from the grid
                callback({ status: 'ok', data: 'Crop harvested' });
            }
            else {
                callback({ status: 'ok', data: null });
            }
            updateGameGrid();
            socket.emit('UPDATE player/coins', { coins: playerList[socket.id].coins });
            return;
        }
        // Check if the dropped crop is in a new grid position and if the new position is occupied
        if (GameGrid[newPos.x][newPos.y] !== null) {
            const coll = GameGrid[newPos.x][newPos.y];
            // Is the colliding object a crop of the same type and size?
            if (coll && coll.type === crop.type
                && coll.size === crop.size
                && crop.size < crop_1.CropSize.XLARGE) { // Prevent merging if already at max size
                // Merge logic: DFS the game grid to find all connected crops of the same type and size
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
                            callback({ status: 'ok', data: 'merged 5' });
                            break;
                        }
                }
            }
            else {
                callback({ status: 'err', data: 'Cannot move crop onto occupied position without merge' });
            }
        }
        else {
            const tempCrop = GameGrid[oldPos.x][oldPos.y];
            tempCrop.pos = newPos; // Update the position of the crop
            GameGrid[newPos.x][newPos.y] = tempCrop; // Mark new position as occupied
            GameGrid[oldPos.x][oldPos.y] = null; // Set old position to unoccupied
            callback({ status: 'ok', data: `moved: (${oldPos.x}, ${oldPos.y}) to (${newPos.x}, ${newPos.y})` });
        }
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
function updateOrAddItem(player, cropType) {
    const itemSlot = player.bag.find(item => item.id === cropType);
    if (itemSlot) {
        itemSlot.amount += 1; // Increment cabbage count in bag
    }
    else {
        player.bag.push({ id: cropType, name: bag_1.ItemName[cropType], amount: 1 }); // Add new cabbage item to bag
    }
    saveBag(player); // Save the bag after updating
}
setInterval(() => {
    let data = {};
    for (let i in playerList) {
        let socket = playerList[i];
        data[socket.id] = {
            username: socket.username,
            pos: socket.pos,
        };
    }
    io.emit('UPDATE player/pos', data);
}, 1000 / 10);
// save player farm and bag data periodically
setInterval(() => {
    console.log('autosaving...');
    saveFarms();
    saveBags();
}, 1000 * 60 * 5);
function saveFarms() {
    db_1.default.connect().then(() => {
        const db = db_1.default.db('agrifusion');
        const farmColl = db.collection('farms');
        for (const socketId in playerList) {
            const player = playerList[socketId];
            if (player.loggedIn) {
                const username = player.username;
                if (player.farmPlaced) {
                    const playerFarm = Array.from({ length: player.farmSize }, () => Array.from({ length: player.farmSize }, () => null));
                    for (let x = 0; x < player.farmSize; x++) {
                        for (let y = 0; y < player.farmSize; y++) {
                            const gridX = player.farmOrigin.x + x;
                            const gridY = player.farmOrigin.y + y;
                            if (GameGrid[gridX][gridY])
                                playerFarm[x][y] = GameGrid[gridX][gridY];
                        }
                    }
                    farmColl.updateOne({ username: username }, { $set: {
                            farm: playerFarm,
                            size: player.farmSize, // save farm size to database
                        },
                    }).catch((err) => {
                        console.error('Error updating farm:', err);
                    });
                }
            }
        }
    }).catch((err) => {
        console.error('Error connecting to database for periodic save:', err);
    });
}
function saveFarm(player) {
    db_1.default.connect().then(() => {
        const db = db_1.default.db('agrifusion');
        const farmColl = db.collection('farms');
        if (player.farmPlaced) {
            const playerFarm = Array.from({ length: player.farmSize }, () => Array.from({ length: player.farmSize }, () => null));
            for (let x = 0; x < player.farmSize; x++) {
                for (let y = 0; y < player.farmSize; y++) {
                    const gridX = player.farmOrigin.x + x;
                    const gridY = player.farmOrigin.y + y;
                    if (GameGrid[gridX][gridY])
                        playerFarm[x][y] = GameGrid[gridX][gridY];
                }
            }
            farmColl.updateOne({ username: player.username }, { $set: {
                    farm: playerFarm,
                    size: player.farmSize, // save farm size to database
                },
            }).catch((err) => {
                console.error('Error updating farm:', err);
            });
        }
    }).catch((err) => {
        console.error('Error connecting to database for periodic save:', err);
    });
}
function saveBags() {
    db_1.default.connect().then(() => {
        const db = db_1.default.db('agrifusion');
        const bagColl = db.collection('bags');
        for (const socketId in playerList) {
            const player = playerList[socketId];
            if (player.loggedIn) {
                const username = player.username;
                bagColl.updateOne({ username: username }, { $set: {
                        bag: player.bag,
                        coins: player.coins,
                    }
                }).catch((err) => {
                    console.error('Error updating bag:', err);
                });
            }
        }
    }).catch((err) => {
        console.error('Error connecting to database for periodic save:', err);
    });
}
function saveBag(player) {
    db_1.default.connect().then(() => {
        const db = db_1.default.db('agrifusion');
        const bagColl = db.collection('bags');
        bagColl.updateOne({ username: player.username }, { $set: {
                bag: player.bag,
                coins: player.coins,
            }
        }).catch((err) => {
            console.error('Error updating bag:', err);
        });
    }).catch((err) => {
        console.error('Error connecting to database for periodic save:', err);
    });
}
//# sourceMappingURL=app.js.map