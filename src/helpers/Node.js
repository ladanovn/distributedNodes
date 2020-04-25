const uniqid = require('uniqid');
const {
    get,
    set,
    keys,
    del,
} = require('./redisPromisify');

const FREQUENCY_SYNC = 1000;
const FREQUENCY_MESSAGE_PUBLISH = 500;
const ONLINE_STATUS_EXPIRE = FREQUENCY_SYNC * 1.5;

class Node {

    constructor() {

        /**
         * Serves for identification
         * among other running nodes
         */
        this.id = uniqid();

        /**
         * Stores state with previous 
         * synchronization
         */
        this.state = {
            generator: null,
            handler: null,
            onlineNodes: new Set(),
        };

        /**
         * Link to synchronization loop
         */
        this.syncLoop = null;
        
        /**
         * Link to generator loop
         */
        this.publishLoop = null;
    }
    
    async start() {
        await this._initState();
        this.syncLoop = setInterval(this._syncLoop.bind(this), FREQUENCY_SYNC);
        this.publishLoop = setInterval(this._publishMsg.bind(this), FREQUENCY_MESSAGE_PUBLISH);
    }

    async _syncLoop() {
        console.log(this.id);
        console.log(this.state);
        const now = Date.now();

        // confirmation online status
        await set(`node:${this.id}:timestamp`, now);

        try {
            const { disconnectedNodes } = await this._syncOnlineNodeState();
            await this._handleDisconnectNode(disconnectedNodes);
            await this._handleConnectNode();

        } catch (err) {
            console.log(err)
        }
    }

    async _publishMsg() {
        if (this.state.generator === this.id) {
            // publish message
            console.log(this.id, 'publish message');
        }
    }

    async _handleConnectNode() {
        if (this.state.onlineNodes === 1) {
            await set('generator', this.state.onlineNodes[0]);
            await del('handler');

        } else {
            await del('generator');
            await del('handler');
        }
    }
    
    async _handleDisconnectNode(disconnectedNodes) {

        // Replacing a generator if current disconnected
        if (disconnectedNodes.has(this.state.generator)) {
            const orderedNodes = [...this.state.onlineNodes].sort();

            if (orderedNodes.length > 1) {
                for (const node of orderedNodes) {
                    if (this.state.handler !== node) {
                        await set('generator', node);
                        this.state.generator = node;
                        break;
                    }
                };

            } else if (orderedNodes === 1) {
                await set('generator', orderedNodes[0]);
                await del('handler');

            } else {
                await del('generator');
                await del('handler');
            }
        }

        // Replacing a handler if current disconnected
        if (disconnectedNodes.has(this.state.handler)) {
            const orderedNodes = [...this.state.connectedNodes].sort();
            for (const node of orderedNodes) {
                if (this.state.generator !== node) {
                    await set('handler', node);
                    this.state.handler = node;
                    break;
                }
            };
        }
    }

    async _syncOnlineNodeState() {
        const now = Date.now();
        const onlineNodes = await keys('node:*:timestamp');
        const onlineNodeIds = new Set();

        for (const node of onlineNodes) {
            const timestamp = await get(node);

            if (timestamp && (now - timestamp < ONLINE_STATUS_EXPIRE)) {
                const nodeId = node.split(':')[1];
                onlineNodeIds.add(nodeId);

            } else {
                await del(node);
            }
        }

        const connectedNodes = new Set(onlineNodeIds);
        for (const node of this.state.onlineNodes) {
            connectedNodes.delete(node);
        }
        connectedNodes.forEach(node => {
            this.state.onlineNodes.add(node);
        });

        const disconnectedNodes = new Set(this.state.onlineNodes);
        for (const node of onlineNodeIds) {
            disconnectedNodes.delete(node);
        }
        disconnectedNodes.forEach(node => {
            this.state.onlineNodes.delete(node);
        });

        return {
            connectedNodes,
            disconnectedNodes,
        }
    }

    async _initState() {
        const now = Date.now();
        await set(`node:${this.id}:timestamp`, now);

        this.state.generator = await get('generator');
        this.state.handler = await get('handler');

        const onlineNodes = await keys('node:*:timestamp');
        const onlineNodeIds = onlineNodes.map(node => node.split(':')[1]);
        this.state.onlineNodes = new Set(onlineNodeIds);
    }
}

module.exports = {
    Node,
}