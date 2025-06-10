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

client.connect()
    .then(() => {
        console.log('Connected to MongoDB');
    })
    .catch((err: any) => {
        console.error('Error connecting to MongoDB:', err);
    });

app.use(cors({
    origin: CLIENT_URL,
    credentials: true,            //access-control-allow-credentials:true
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

io.sockets.on('connection', (socket: any) => {
    // create a new player object and add it to the player list on connection
    player_list[socket.id] = socket;

    console.log('\nplayer connection %s', socket.id)
    console.log('players: %s', player_list)

    // remove player from player list on disconnection
    socket.on('disconnect', () => {
        console.log('socket disconnection %s', socket.id)
        delete player_list[socket.id]
    })
});