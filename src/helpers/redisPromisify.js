const util = require('util');
const { client } = require('../db/redis');

const get = util.promisify(client.get).bind(client);
const keys = util.promisify(client.keys).bind(client);
const set = util.promisify(client.set).bind(client);
const del = util.promisify(client.del).bind(client);

module.exports = {
    get,
    keys,
    set,
    del,
}