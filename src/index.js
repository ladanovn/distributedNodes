require('dotenv').config()

const { Node } = require('./Node');

const init = async () => {
    const arg = process.argv.slice(2);

    if (arg && arg[0] === 'getErrors') {
        await Node.getErrorMessages();
        process.exit();

    } else {
        const node = new Node();
        node.start();    
    }
}

init();