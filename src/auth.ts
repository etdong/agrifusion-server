import passport from "passport";
import client from "./db";
import * as passportStrategy from "passport-local";
import crypto from "crypto";
const cookieParser = require('cookie-parser');


const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

export function initPassport(app: any) {
    app.use(passport.initialize());
    app.use(passport.session());
    app.use(passport.authenticate('session'));
    app.use(cookieParser());

    passport.use(new passportStrategy.Strategy({ usernameField: "username"}, (username, password, cb) => {
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
        client.connect().then(() => {
            const collection = client.db('agrifusion').collection('users');
            collection.findOne({ username: username }).then((user: any) => {
                if (!user) { 
                    console.log('User does not exist: ', username);
                    return cb(null, false, { message: 'User does not exist! Please sign up' }) 
                }

                crypto.pbkdf2(password, user.salt.buffer, 310000, 32, 'sha256', (err, hashedPassword) => {
                    if (err) { return cb(err); }
                    if (!crypto.timingSafeEqual(user.hashed_password.buffer, hashedPassword)) {
                        console.log(user.hashed_password.buffer);
                        console.log(hashedPassword)
                        console.log('Incorrect username or password.', username);
                        return cb(null, false, { message: 'Incorrect password. Please try again' });
                    }
                    console.log('User authenticated successfully:', username);
                    return cb(null, user);
                });
            }).catch((err) => {
                console.error('Error finding user:', err);
                return cb(err);
            })
        })
    }));

    passport.serializeUser((user: any, cb) => {
        process.nextTick(() => {
            cb(null, { id: user._id, username: user.username });
        });
    });

    passport.deserializeUser((user, cb) => {
        process.nextTick(() => {
            return cb(null, user);
        });
    });

    app.post('/api/signup', (req: any, res: any, next: any) => {
        const username = req.body.username;
        if (username.length < 3 || username.length > 20) {
            const err = 'Username must be between 3 and 20 characters';
            res.cookie('error', err);
            res.redirect(CLIENT_URL + '/#/signup');
            return
        }
        if (!/^[a-zA-Z0-9_]+$/.test(username) || username.includes(' ')) {
            const err = 'Username can only contain letters, numbers, and underscores';
            res.cookie('error', err);
            res.redirect(CLIENT_URL + '/#/signup');
            return
        }

        const password = req.body.password;
        if (!password || password.length < 6) {
            const err = 'Password must be at least 6 characters long';
            res.cookie('error', err);
            res.redirect(CLIENT_URL + '/#/signup');
            return
        }
        if (password.includes(' ')) {
            const err = 'Password cannot contain spaces';
            res.cookie('error', err);
            res.redirect(CLIENT_URL + '/#/signup');
            return
        }

        var salt = crypto.randomBytes(16);
        crypto.pbkdf2(req.body.password, salt, 310000, 32, 'sha256', (err, hashedPassword) => {
            if (err) { return next(err); }
            const collection = client.db('agrifusion').collection('users');
            collection.findOne({ username: req.body.username }).then((user: any) => {
                if (user) {
                    console.log('Username taken!')
                    const err = 'Username already taken. Please choose another one.';
                    res.cookie('error', err);
                    res.redirect(CLIENT_URL + '/#/signup');
                    return
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
                        if (err) { return next(err); }
                        res.redirect(CLIENT_URL);
                    })
                });
            })
        });
    });

    app.post('/api/login', (req: any, res: any, next: any) => {
        console.log('Login attempt:', req.body.username);
        passport.authenticate('local', {
            session: true,
            successRedirect: CLIENT_URL + '/#/play',
            failureRedirect: CLIENT_URL
        }, (err, user, info) => {
            if (err) {
                console.log(err)
                return next(err)
            }
            if (!user) {
                console.log(info.message)
                res.cookie('error', info.message);
                res.redirect(CLIENT_URL);
                return
            }
            req.logIn(user, (err: any) => {
                if (err) { return next(err); }
                res.redirect(CLIENT_URL + '/#/play');
            });
        })(req, res, next)
    });
    
    app.get('/api/user', isAuthenticated, (req: any, res: any) => {
        res.send({ id: req.user._id, username: req.user.username, loggedIn: true });
    });
}

function isAuthenticated(req: any, res: any, next: any) {
    if (req.isAuthenticated()) next();
    else res.json({
        status: 400,
        loggedIn: false,
        message: "Player is not authenticated. Please log in."
    });
}
