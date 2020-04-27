const redis = require('redis');

const {
    REDIS_HOST,
    REDIS_PORT,
} = process.env;

const client = redis.createClient({
    host: REDIS_HOST,
    PORT: REDIS_PORT,
});

module.exports = {
    client,
}