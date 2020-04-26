require('dotenv').config()

const { Node } = require('./Node');

const init = async () => {
    const node = new Node();
    node.start();
}

// subscriber.on('message', (channel, msg) => {

// });

init();