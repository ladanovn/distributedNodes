const util = require('util');

const get = client => util.promisify(client.get).bind(client);
const keys = client => util.promisify(client.keys).bind(client);
const set = client => util.promisify(client.set).bind(client);
const del = client => util.promisify(client.del).bind(client);
const rpush = client => util.promisify(client.rpush).bind(client);
const llen = client => util.promisify(client.llen).bind(client);
const lrange = client => util.promisify(client.lrange).bind(client);

module.exports = {
    get,
    keys,
    set,
    del,
    rpush,
    llen,
    lrange,
}
