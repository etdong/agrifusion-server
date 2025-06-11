import express from 'express';
import cors from 'cors'
import http from 'http'
import { Server } from 'socket.io'
import passport from 'passport';
import session from 'express-session';
import client from './db'

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
// key is the socket id, value is the player object
let player_list: { [key: string]: any } = {};

const GRID_SIZE = 72;

const MAP_SIZE = 50

const GameGrid: { [key: number]: { [key: number]: any | null } } = Array.from({ length: MAP_SIZE }, () =>
    Array.from({ length: MAP_SIZE }, () => null))

const ClaimGrid: { [key: number]: { [key: number]: any | null } } = Array.from({ length: MAP_SIZE }, () =>
    Array.from({ length: MAP_SIZE }, () => null))

io.sockets.on('connection', (socket: any) => {

    socket.pos = { x: 0, y: 0 };
    socket.playerId = -1
    player_list[socket.id] = socket;

    // remove player from player list on disconnection
    socket.on('disconnect', () => {
        console.log('socket disconnection %s', socket.id)

        delete player_list[socket.id]
    })

    socket.on('GET player/data', (data: { playerId: string }, callback: (arg0: { status: string; data: any; }) => void) => {
        console.log('RECV: GET player/data', data);
        const playerId = data.playerId
        player_list[socket.id].playerId = playerId;
        console.log('\nplayer connection %s', socket.id);
        console.log('players: %s', player_list)
    });

    socket.on('GET player/farm', (data: { id: any; }, callback: (arg0: { status: string; data: any; }) => void) => {
        console.log('RECV: GET player/farm', data);
        const playerId = data.id;
        client.connect().then(() => {
            const db = client.db('agrifusion');
            const collection = db.collection('farms');
            collection.findOne({ playerId: playerId }).then((result) => {
                if (result) {
                    console.log('GET player/farm', playerId, result.farm);
                    callback({ status: 'ok', data: result.farm });
                } else {
                    const farm = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => null))
                    collection.insertOne({ playerId: playerId, farm: farm }).then(() => {
                        console.log('GET player/farm', playerId, 'CREATED');
                        callback({ status: 'ok', data: farm });
                    });
                }
            }).catch((err) => {
                console.error('Error fetching farm:', err);
                callback({ status: 'err', data: err });
            });
        })
    })

    socket.on('POST player/farm', (data: any, callback: any) => {
        console.log('RECV: POST player/farm', data);
        const playerId = data.id;
        const playerFarm = data.farm;
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
                callback({ status: 'err', data: err });
            }).then(() => {
                console.log('POST player/farm', playerId, playerFarm);
                callback({ status: 'ok', data: null });
            })
        })
    });

    socket.on('POST player/pos', (data: any, callback: any) => {
        const playerPos = data.pos;
        player_list[socket.id].pos = playerPos;
    })
})

setInterval(() => {
    let data: { [key: string]: any } = {};
    for (let i in player_list) {
        let socket = player_list[i]
        data[socket.id] = {
            playerId: socket.playerId,
            pos: socket.pos,
        }
    }
    for (let i in player_list) {
        let socket = player_list[i]
        socket.emit('UPDATE player/pos', data)
    }
}, 1000/10)