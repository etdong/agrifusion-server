import passport from "passport";
import client from "./db";

// we are using the google oauth strategy
const GoogleStrategy = require('passport-google-oauth20').Strategy;

// setting up passport
passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.SERVER_URL + "/google/callback"
    },
    function(accessToken, refreshToken, profile, done) {
        // check if the user exists in the database
        client.connect().then(() => {
            const collection = client.db('agrifusion').collection('farms');
            collection.findOne({ playerId: profile.id }).then((user: any) => {
                // if the user does not exist, add them to the database
                if (!user) {
                    const farm = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => null))
                    collection.insertOne({ 
                        playerId: profile.id, 
                        name: profile.displayName,
                        farm: farm,
                        size: 3,
                        coins: 0,
                    }).catch((err) => {
                        console.error('Error creating player:', err);
                    }).then(() => {
                        console.log('GET player/data', profile.id, 'CREATED');
                    });
                }
            });
        })
        return done(null, profile)
    }
));

passport.serializeUser((user, done) => {
    return done(null, user);
})

passport.deserializeUser((user: Express.User, done) => {
    return done(null, user);
})