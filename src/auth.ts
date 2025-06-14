import passport from "passport";
import client from "./db";
import * as passportStrategy from "passport-local";
import crypto from "crypto";

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

export function initPassport(app: any) {
    app.use(passport.initialize());
    app.use(passport.session());
    app.use(passport.authenticate('session'));

    passport.use(new passportStrategy.Strategy({ usernameField: "username"}, (username, password, cb) => {
        if (!username || !password) {
            return cb(null, false, { message: 'Username and password are required.' });
        }
        client.connect().then(() => {
            const collection = client.db('agrifusion').collection('farms');
            collection.findOne({ username: username }).then((user: any) => {
                if (!user) { 
                    console.log('User does not exist: ', username);
                    return cb(null, false, { message: 'User does not exist! Please sign up.' }) 
                }

                crypto.pbkdf2(password, user.salt.buffer, 310000, 32, 'sha256', (err, hashedPassword) => {
                    if (err) { return cb(err); }
                    if (!crypto.timingSafeEqual(user.hashed_password.buffer, hashedPassword)) {
                        console.log(user.hashed_password.buffer);
                        console.log(hashedPassword)
                        console.log('Incorrect username or password.', username);
                        return cb(null, false, { message: 'Incorrect username or password.' });
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

    app.post('/api/signup', (req, res, next) => {
        var salt = crypto.randomBytes(16);
        crypto.pbkdf2(req.body.password, salt, 310000, 32, 'sha256', (err, hashedPassword) => {
            if (err) { return next(err); }
            const collection = client.db('agrifusion').collection('farms');
            const farm = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => null))
            collection.insertOne({ 
                username: req.body.username,
                hashed_password: hashedPassword,
                salt: salt,
                farm: farm,
                size: 3,
                coins: 0,
            }).catch((err) => {
                console.error('Error creating player:', err);
                return next(err);
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
                return next(err);
            }
            if (!user) {
                console.log(info.message)
                return res
            } else {
                req.logIn(user, (err: any) => {
                    if (err) { return next(err); }
                    res.redirect(CLIENT_URL + '/#/play');
                });
            }
        })(req, res, next)
    });
    
    app.get('/api/user', isAuthenticated, (req, res) => {
        res.send({ id: req.user.id, username: req.user.username, loggedIn: true });
    });
}

export function isAuthenticated(req: any, res: any, next: any) {
    if (req.isAuthenticated()) next();
    else res.json({ 
        loggedIn: false,
        message: null
    });
}

