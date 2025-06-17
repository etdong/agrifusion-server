"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initPassport = initPassport;
const passport_1 = __importDefault(require("passport"));
const db_1 = __importDefault(require("./db"));
const passportStrategy = __importStar(require("passport-local"));
const crypto_1 = __importDefault(require("crypto"));
const cookieParser = require('cookie-parser');
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
function initPassport(app) {
    app.use(passport_1.default.initialize());
    app.use(passport_1.default.session());
    app.use(passport_1.default.authenticate('session'));
    app.use(cookieParser());
    passport_1.default.use(new passportStrategy.Strategy({ usernameField: "username" }, (username, password, cb) => {
        if (!username || !password) {
            return cb(null, false, { message: 'Username and password are required' });
        }
        username = username.trim();
        // input checking for username
        if (username.length < 3 || username.length > 20) {
            return cb(null, false, { message: 'Username must be between 3 and 20 characters' });
        }
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            return cb(null, false, { message: 'Username can only contain letters, numbers, and underscores' });
        }
        db_1.default.connect().then(() => {
            const collection = db_1.default.db('agrifusion').collection('users');
            collection.findOne({ username: username }).then((user) => {
                if (!user) {
                    console.log('User does not exist: ', username);
                    return cb(null, false, { message: 'User does not exist! Please sign up' });
                }
                crypto_1.default.pbkdf2(password, user.salt.buffer, 310000, 32, 'sha256', (err, hashedPassword) => {
                    if (err) {
                        return cb(err);
                    }
                    if (!crypto_1.default.timingSafeEqual(user.hashed_password.buffer, hashedPassword)) {
                        console.log(user.hashed_password.buffer);
                        console.log(hashedPassword);
                        console.log('Incorrect username or password.', username);
                        return cb(null, false, { message: 'Incorrect password. Please try again' });
                    }
                    console.log('User authenticated successfully:', username);
                    return cb(null, user);
                });
            }).catch((err) => {
                console.error('Error finding user:', err);
                return cb(err);
            });
        });
    }));
    passport_1.default.serializeUser((user, cb) => {
        process.nextTick(() => {
            cb(null, { id: user._id, username: user.username });
        });
    });
    passport_1.default.deserializeUser((user, cb) => {
        process.nextTick(() => {
            return cb(null, user);
        });
    });
    app.post('/api/signup', (req, res, next) => {
        const username = req.body.username;
        if (username.length < 3 || username.length > 20) {
            const err = 'Username must be between 3 and 20 characters';
            res.cookie('error', err);
            res.redirect(CLIENT_URL + '/#/signup');
            return;
        }
        if (!/^[a-zA-Z0-9_]+$/.test(username) || username.includes(' ')) {
            const err = 'Username can only contain letters, numbers, and underscores';
            res.cookie('error', err);
            res.redirect(CLIENT_URL + '/#/signup');
            return;
        }
        const password = req.body.password;
        if (!password || password.length < 6) {
            const err = 'Password must be at least 6 characters long';
            res.cookie('error', err);
            res.redirect(CLIENT_URL + '/#/signup');
            return;
        }
        if (password.includes(' ')) {
            const err = 'Password cannot contain spaces';
            res.cookie('error', err);
            res.redirect(CLIENT_URL + '/#/signup');
            return;
        }
        var salt = crypto_1.default.randomBytes(16);
        crypto_1.default.pbkdf2(req.body.password, salt, 310000, 32, 'sha256', (err, hashedPassword) => {
            if (err) {
                return next(err);
            }
            const collection = db_1.default.db('agrifusion').collection('users');
            collection.findOne({ username: req.body.username }).then((user) => {
                if (user) {
                    console.log('Username taken!');
                    const err = 'Username already taken. Please choose another one.';
                    res.cookie('error', err);
                    res.redirect(CLIENT_URL + '/#/signup');
                    return;
                }
                collection.insertOne({
                    username: req.body.username,
                    hashed_password: hashedPassword,
                    salt: salt,
                }).catch((err) => {
                    console.error('Error creating user:', err);
                    res.cookie('error', err);
                    res.redirect(CLIENT_URL + '/#/signup');
                }).then(() => {
                    console.log('User created successfully:', req.body.username);
                    const user = {
                        username: req.body.username
                    };
                    req.login(user, (err) => {
                        if (err) {
                            return next(err);
                        }
                        res.redirect(CLIENT_URL);
                    });
                });
            });
        });
    });
    app.post('/api/login', (req, res, next) => {
        console.log('Login attempt:', req.body.username);
        passport_1.default.authenticate('local', {
            session: true,
            successRedirect: CLIENT_URL + '/#/play',
            failureRedirect: CLIENT_URL
        }, (err, user, info) => {
            if (err) {
                console.log(err);
                return next(err);
            }
            if (!user) {
                console.log(info.message);
                res.cookie('error', info.message);
                res.redirect(CLIENT_URL);
                return;
            }
            req.logIn(user, (err) => {
                if (err) {
                    return next(err);
                }
                res.redirect(CLIENT_URL + '/#/play');
            });
        })(req, res, next);
    });
    app.get('/api/user', isAuthenticated, (req, res) => {
        res.send({ id: req.user._id, username: req.user.username, loggedIn: true });
    });
}
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated())
        next();
    else
        res.json({
            status: 400,
            loggedIn: false,
            message: "Player is not authenticated. Please log in."
        });
}
//# sourceMappingURL=auth.js.map