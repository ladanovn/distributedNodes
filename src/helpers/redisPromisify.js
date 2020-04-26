const util = require('util');

const get = client => util.promisify(client.get).bind(client);
const keys = client => util.promisify(client.keys).bind(client);
const set = client => util.promisify(client.set).bind(client);
const del = client => util.promisify(client.del).bind(client);

module.exports = {
    get,
    keys,
    set,
    del,
}