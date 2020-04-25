require('dotenv').config()

const { Node } = require('./helpers/Node');

const init = async () => {
    const node = new Node();
    node.start();
}

// subscriber.on('message', (channel, msg) => {

// });

init();