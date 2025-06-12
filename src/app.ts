import express from 'express';
import cors from 'cors'
import http from 'http'
import { Server } from 'socket.io'
import passport from 'passport';
import session from 'express-session';
import client from './db'
import { Crop, CropSize } from './models/crop';
import { Collection } from 'mongodb';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const app = express();

app.use(cors({
    origin: CLIENT_URL,
    credentials: true,
}));

app.set('trust proxy', 1)

// using noleak memorystore
const MemoryStore = require('memorystore')(session);
app.use(session({ 
    secret: "secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: true,
        sameSite: 'none',
        maxAge: 1000 * 60 * 60 * 24
    },
    proxy: true,
    store: new MemoryStore({
        checkPeriod: 86400000 // prune expired entries every 24h
    })
}))

app.use(passport.initialize());
app.use(passport.session());
app.use(passport.authenticate('session'))

app.get('/', (req, res) => {
  res.send('<h1>Agrifusion Backend</h1>');
});

// google auth page
app.get(
    "/auth/google", 
    passport.authenticate('google', { 
        scope: ['profile'] 
    })
);

// google callback page
app.get(
    "/google/callback", 
    passport.authenticate('google', { 
        session: true,
        successRedirect: CLIENT_URL,
        failureRedirect: CLIENT_URL
    })
);

// auth middleware
function isAuthenticated(req: any, res: any, next: any) {
    if (req.user) next();
    else res.json({ loggedIn: false});
}

// get user login information
// app.get(
//     "/account",
//     isAuthenticated,
//     (req, res) => {
//         const user = {
//             ...req.user,
//             loggedIn: true
//         }
//         res.json(user);
//     }
// )

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
let playerList: { [key: string]: any } = {};

const GameGrid: { [key: number]: { [key: number]: Crop | null } } = Array.from({ length: MAP_SIZE }, () =>
    Array.from({ length: MAP_SIZE }, () => null))

const ClaimGrid: { [key: number]: { [key: number]: boolean } } = Array.from({ length: MAP_SIZE }, () =>
    Array.from({ length: MAP_SIZE }, () => null))

io.sockets.on('connection', (socket: any) => {

    socket.pos = { x: -1, y: -1 };
    socket.playerId = '-1'
    socket.coins = 0,
    socket.farmSize = 3; // default farm size
    socket.farmOrigin = { x: -1, y: -1 }; // default farm origin
    socket.farmPlaced = false;
    playerList[socket.id] = socket;

    // remove player from player list on disconnection
    socket.on('disconnect', () => {
        console.log('socket disconnection %s', socket.id)
        const player = playerList[socket.id];
        client.connect().then(() => {
            const db = client.db('agrifusion');
            const collection = db.collection('farms');
            const playerId = player.playerId;
            if (player.farmPlaced) {
                const playerFarm: { [key: number]: { [key: number]: Crop | null } } = Array.from({ length: player.farmSize }, () => Array.from({ length: player.farmSize }, () => null))
                for (let x = 0; x < player.farmSize; x++) {
                    for (let y = 0; y < player.farmSize; y++) {
                        const gridX = player.farmOrigin.x + x;
                        const gridY = player.farmOrigin.y + y;
                        if (GameGrid[gridX][gridY]) playerFarm[x][y] = GameGrid[gridX][gridY];
                    }
                }
                collection.updateOne(
                    { playerId: playerId },
                    {$set: {
                            farm: playerFarm,
                            size: player.farmSize, // save farm size to database
                            coins: player.coins,
                        },
                    }, { upsert: true }
                ).catch((err) => {
                    console.error('Error updating farm:', err);
                }).then(() => {
                    console.log('POST player/farm', playerId, playerFarm);
                    for (let x = 0; x < player.farmSize; x++) {
                        for (let y = 0; y < player.farmSize; y++) {
                            const gridX = player.farmOrigin.x + x;
                            const gridY = player.farmOrigin.y + y;
                            GameGrid[gridX][gridY] = null;
                        }
                    }
                    updateGameGrid();
                })
            } else {
                collection.updateOne(
                    { playerId: playerId },
                    {$set: {
                            coins: player.coins,
                        },
                    }, { upsert: true }
                ).catch((err) => {
                    console.error('Error updating farm:', err);
                }).then(() => {
                    console.log('POST player/coins', playerId, player.coins);
                    updateGameGrid();
                })
            }
        })
        delete playerList[socket.id];
        io.emit('UPDATE player/disconnect', { playerId: socket.playerId });
    })

    socket.on('GET player/data', (data: { playerId: string }, callback: (arg0: { status: string; data: any; }) => void) => {
        console.log('RECV: GET player/data', data);
        console.log('\nplayer connection %s', socket.id);
        console.log('players: %s', playerList)
        const player = playerList[socket.id];
        player.playerId = data.playerId;
        client.connect().then(() => {
            const db = client.db('agrifusion');
            const collection = db.collection('farms');
            const playerId = data.playerId;
            collection.findOne({ playerId: playerId }).then((result) => {
                if (result) {
                    console.log('GET player/data', playerId, result);
                    player.coins = result.coins; // set coins from database
                    player.emit('UPDATE player/coins', { coins: player.coins });
                    callback({ status: 'ok', data: 'Player loaded' });
                    updateGameGrid();
                } else {
                    const farm = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => null))
                    collection.insertOne({ 
                        playerId: playerId, 
                        farm: farm,
                        size: 3,
                        coins: 0,
                    }).catch((err) => {
                        console.error('Error creating player:', err);
                        callback({ status: 'err', data: err });
                        updateGameGrid();
                    }).then(() => {
                        console.log('GET player/data', data.playerId, 'CREATED');
                        callback({ status: 'ok', data: 'Player created' });
                        updateGameGrid();
                    });
                    
                }
            }).catch((err) => {
                console.error('Error fetching player data:', err);
                callback({ status: 'err', data: err });
                updateGameGrid();
            });
        });
    })

    socket.on('GET player/farm', (callback: (arg0: { status: string; data: any; }) => void) => {
        console.log('RECV: GET player/farm');
        const playerId = playerList[socket.id].playerId;
        const player = playerList[socket.id];
        const playerGridPos = { x: Math.round(player.pos.x / GRID_SIZE), y: Math.round(player.pos.y / GRID_SIZE) };
        if (playerGridPos.x < 0 || playerGridPos.x >= MAP_SIZE || playerGridPos.y < 0 || playerGridPos.y >= MAP_SIZE) {
            console.error('Player position out of bounds:', playerGridPos);
            callback({ status: 'err', data: 'Player position out of bounds' });
            return;
        }
        client.connect().then(() => {
            const db = client.db('agrifusion');
            const collection = db.collection('farms');
            collection.findOne({ playerId: playerId }).then((result) => {
                if (result) {
                    console.log('GET player/farm', playerId, result.farm);
                    player.farmSize = result.size; // set farm size from database
                    player.farmOrigin = playerGridPos;
                    for (let x = 0; x < player.farmSize; x++) {
                        for (let y = 0; y < player.farmSize; y++) {
                            if (result.farm[x][y] === null) {
                                GameGrid[playerGridPos.x + x][playerGridPos.y + y] = null;
                            } else {
                                GameGrid[playerGridPos.x + x][playerGridPos.y + y] = {
                                    id: result.farm[x][y].id,
                                    pos: { x: playerGridPos.x + x, y: playerGridPos.y + y },
                                    type: result.farm[x][y].type,
                                    size: result.farm[x][y].size
                                }
                            }
                        }
                    }
                    player.farmPlaced = true; // set farm placed to true
                    callback({ status: 'ok', data: result.farm });
                    updateGameGrid();
                }
            }).catch((err) => {
                console.error('Error fetching farm:', err);
                callback({ status: 'err', data: err });
                updateGameGrid();
            });
        })
    })

    socket.on('POST player/farm', (callback: (arg0: { status: string; data: any; }) => void) => {
        console.log('RECV: POST player/farm');
        const player = playerList[socket.id];
        if (!player.farmPlaced) {
            console.error('Player has not placed a farm yet');
            callback({ status: 'err', data: 'Farm not placed' });
            return;
        }
        const playerId = player.playerId;
        const playerFarm: { 
                [key: number]: { [key: number]: Crop | null } 
            } = Array.from({ length: player.farmSize }, () =>
                Array.from({ length: player.farmSize }, () => null))
        for (let x = 0; x < player.farmSize; x++) {
            for (let y = 0; y < player.farmSize; y++) {
                const gridX = player.farmOrigin.x + x;
                const gridY = player.farmOrigin.y + y;
                playerFarm[x][y] = GameGrid[gridX][gridY];
            }
        }
        client.connect().then(() => {
            const db = client.db('agrifusion');
            const collection = db.collection('farms');
            collection.updateOne(
                { playerId: playerId },
                {$set: {
                        farm: playerFarm,
                        size: player.farmSize, // save farm size to database
                        coins: player.coins, // save coins to database
                    },
                }, { upsert: true }
            ).catch((err) => {
                console.error('Error updating farm:', err);
                callback({ status: 'err', data: err });
                updateGameGrid();
            }).then(() => {
                console.log('POST player/farm', playerId, playerFarm);
                for (let x = 0; x < player.farmSize; x++) {
                    for (let y = 0; y < player.farmSize; y++) {
                        const gridX = player.farmOrigin.x + x;
                        const gridY = player.farmOrigin.y + y;
                        GameGrid[gridX][gridY] = null;
                    }
                }
                player.farmPlaced = false; // reset farm placed to false
                player.farmOrigin = { x: -1, y: -1 }; // reset farm origin
                callback({ status: 'ok', data: null });
                updateGameGrid();
            })
        })
    });

    socket.on('POST player/pos', (data: any, callback: any) => {
        const playerPos = data.pos;
        playerList[socket.id].pos = playerPos;
    })

    socket.on('POST game/crop/spawn', (data: { newCrop: Crop }, callback: (arg0: { status: string; data: any; }) => void) => {
        console.log('RECV: POST game/crop/spawn', data);
        const newCrop = data.newCrop;
        GameGrid[newCrop.pos.x][newCrop.pos.y] = newCrop;
        callback({ status: 'ok', data: newCrop });
        updateGameGrid();
    })

    socket.on('POST game/crop/move', (data: { oldPos, newPos }, callback: (arg0: { status: string; data: any; }) => void) => {
        console.log('RECV: POST game/cropMove', data);
        const oldPos = data.oldPos;
        const newPos = data.newPos;

        // Check if the dropped crop is in a new grid position and if the new position is occupied
        if (GameGrid[oldPos.x][oldPos.y]
            && (oldPos.x !== newPos.x || oldPos.y !== newPos.y) 
            && GameGrid[newPos.x][newPos.y] !== null) {
            
            const crop = GameGrid[oldPos.x][oldPos.y];
            const coll = GameGrid[newPos.x][newPos.y];

            // Is the colliding object a crop of the same type and size?
            if (coll && coll.type === crop.type
            && coll.size === crop.size
            && crop.size < CropSize.XLARGE) { // Prevent merging if already at max size
                // Merge logic: DFS the game grid to find all connected crops of the same type and size
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

                const newSize = crop.size + 5;
                switch (true) {
                    case mergeGroup.length < 3:
                        // Not enough crops to merge, do nothing
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
                        callback({ status: 'ok', data: 'merged 5' });
                        break; 
                    }
                }
            }
        }

        // If the grid square is empty, move the clicked crop to the new position
        if (GameGrid[newPos.x][newPos.y] === null && GameGrid[oldPos.x][oldPos.y]) {
            if (oldPos.x == newPos.x && oldPos.y == newPos.y) {
                callback({ status: 'ok', data: null });
            }
            const tempCrop = GameGrid[oldPos.x][oldPos.y];
            tempCrop.pos = newPos; // Update the position of the crop
            GameGrid[newPos.x][newPos.y] = tempCrop; // Mark new position as occupied
            GameGrid[oldPos.x][oldPos.y] = null; // Set old position to unoccupied
            callback({ status: 'ok', data: `moved: (${oldPos.x}, ${oldPos.y}) to (${newPos.x}, ${newPos.y})` });
        } else {
            console.error('Cannot move crop to occupied position or no crop at old position');
            callback({ status: 'err', data: 'Cannot move crop to occupied position or no crop at old position' });
        }

        updateGameGrid();
    })
})

setInterval(() => {
    let data: { [key: string]: any } = {};
    for (let i in playerList) {
        let socket = playerList[i]
        data[socket.id] = {
            playerId: socket.playerId,
            pos: socket.pos,
        }
    }
    io.emit('UPDATE player/pos', data)
}, 1000/10)

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
    // Send the crop information to the clients
    io.emit('UPDATE game/grid', { grid: cropInfo });
}
