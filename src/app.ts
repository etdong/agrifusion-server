import express from 'express';
import cors from 'cors'
import http from 'http'
import { Server } from 'socket.io'
import passport from 'passport';
import session from 'express-session';
import client from './db'
import { Crop } from './models/crop';

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

// player list for tracking sockets
// key is the socket id, value is the socket object
let playerList: { [key: string]: any } = {};

const GRID_SIZE = 72;

const MAP_SIZE = 50

const GameGrid: { [key: number]: { [key: number]: Crop | null } } = Array.from({ length: MAP_SIZE }, () =>
    Array.from({ length: MAP_SIZE }, () => null))

const ClaimGrid: { [key: number]: { [key: number]: boolean } } = Array.from({ length: MAP_SIZE }, () =>
    Array.from({ length: MAP_SIZE }, () => null))

io.sockets.on('connection', (socket: any) => {

    socket.pos = { x: -1, y: -1 };
    socket.playerId = '-1'
    socket.farmSize = 3; // default farm size
    socket.farmOrigin = { x: -1, y: -1 }; // default farm origin
    socket.farmPlaced = false;
    playerList[socket.id] = socket;

    // remove player from player list on disconnection
    socket.on('disconnect', () => {
        console.log('socket disconnection %s', socket.id)
        const player = playerList[socket.id];
        if (player.farmPlaced) {
            const playerId = player.playerId;
            const playerFarm: { [key: number]: { [key: number]: Crop | null } } = Array.from({ length: player.farmSize }, () => Array.from({ length: player.farmSize }, () => null))
            for (let x = 0; x < player.farmSize; x++) {
                for (let y = 0; y < player.farmSize; y++) {
                    const gridX = player.farmOrigin.x;
                    const gridY = player.farmOrigin.y;
                    if (GameGrid[gridX][gridY]) playerFarm[x][y] = GameGrid[gridX][gridY];
                }
            }
            client.connect().then(() => {
                const db = client.db('agrifusion');
                const collection = db.collection('farms');
                collection.updateOne(
                    { playerId: playerId },
                    {$set: {
                            farm: playerFarm,
                        },
                    }, { upsert: true }
                ).catch((err) => {
                    console.error('Error updating farm:', err);
                }).then(() => {
                    console.log('POST player/farm', playerId, playerFarm);
                })
            })
        }
        delete playerList[socket.id]
    })

    socket.on('GET player/data', (data: { playerId: string }, callback: (arg0: { status: string; data: any; }) => void) => {
        console.log('RECV: GET player/data', data);
        playerList[socket.id].playerId = data.playerId;
        console.log('\nplayer connection %s', socket.id);
        console.log('players: %s', playerList)
    });

    socket.on('GET player/farm', (callback: (arg0: { status: string; data: any; }) => void) => {
        console.log('RECV: GET player/farm');
        const playerId = playerList[socket.id].playerId;
        const player = playerList[socket.id];
        const playerGridPos = { x: Math.round(player.pos.x / GRID_SIZE), y: Math.round(player.pos.y / GRID_SIZE) };
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
                                    type: result.farm[x][y].type,
                                    size: result.farm[x][y].size
                                }
                            }
                        }
                    }
                    player.farmPlaced = true; // set farm placed to true
                    callback({ status: 'ok', data: result.farm });
                } else {
                    const farm = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => null))
                    collection.insertOne({ playerId: playerId, farm: farm }).then(() => {
                        console.log('GET player/farm', playerId, 'CREATED');
                        callback({ status: 'ok', data: farm });
                    player.farmOrigin = playerGridPos;
                    player.farmPlaced = true; // set farm placed to true
                    });
                }
            }).catch((err) => {
                console.error('Error fetching farm:', err);
                callback({ status: 'err', data: err });
            });
        })
    })

    socket.on('POST player/farm', (callback: (arg0: { status: string; data: any; }) => void) => {
        console.log('RECV: POST player/farm');
        const player = playerList[socket.id];
        if (!player.farmPlaced) {
            console.error('Player has not placed a farm yet');
            callback({ status: 'err', data: 'Farm not placed' });
        }
        const playerId = player.playerId;
        const playerFarm: { 
                [key: number]: { [key: number]: Crop | null } 
            } = Array.from({ length: player.farmSize }, () =>
                Array.from({ length: player.farmSize }, () => null))
        for (let x = 0; x < player.farmSize; x++) {
            for (let y = 0; y < player.farmSize; y++) {
                const gridX = player.farmOrigin.x;
                const gridY = player.farmOrigin.y;
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
                    },
                }, { upsert: true }
            ).catch((err) => {
                console.error('Error updating farm:', err);
                callback({ status: 'err', data: err });
            }).then(() => {
                console.log('POST player/farm', playerId, playerFarm);
                player.farmPlaced = false; // reset farm placed to false
                player.farmOrigin = { x: -1, y: -1 }; // reset farm origin
                callback({ status: 'ok', data: null });

            })
        })
    });

    socket.on('POST player/pos', (data: any, callback: any) => {
        const playerPos = data.pos;
        playerList[socket.id].pos = playerPos;
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

setInterval(() => {
    // Check for crops in the game grid and update their positions
    const cropInfo: { [key: string]: { crop: Crop }} = {};
    for (let x = 0; x < MAP_SIZE; x++) {
        for (let y = 0; y < MAP_SIZE; y++) {
            const crop = GameGrid[x][y];
            if (crop) {
                cropInfo[`${x},${y}`] = {
                    crop: {
                        type: crop.type,
                        size: crop.size
                    }
                }
            }
        }
    }
    if (cropInfo && Object.keys(cropInfo).length > 0) {
        // Send the crop information to the clients
        io.emit('UPDATE game/grid', { grid: cropInfo });
    }
}, 1000/4)
