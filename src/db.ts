import { MongoClient, ServerApiVersion } from "mongodb";

// setting up mongodb
const user = process.env.DB_USER;
const pass = process.env.DB_PASS;
const uri = `mongodb+srv://${user}:${pass}@agrifusion-data.ocljyi7.mongodb.net/?retryWrites=true&w=majority&appName=agrifusion-data`
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

export default client;