const uniqid = require('uniqid');
const {
    get,
    set,
    keys,
    del,
} = require('./helpers/redisPromisify');
const { difference } = require('./helpers/sets');

const FREQUENCY_SYNC = 250;
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

    /**
     * Local and remote state synchronization
     */
    async _syncLoop() {
        const now = Date.now();

        // FIXME: remove after test
        console.log(this.id, this.state);

        // confirm online status
        await set(`node:${this.id}:timestamp`, now);

        const { disconnectedNodes } = await this._syncOnlineNodeState();

        await this._handleDisconnectNode(disconnectedNodes);
        await this._handleConnectNode();
    }

    /**
     * Publish message if current node is generator
     */
    async _publishMsg() {
        if (this.state.generator === this.id) {
            // console.log(this.id, 'publish message');
        }
    }

    /**
     * If the current node is running,
     * then new one can only become handler,
     * if it still doesn't exist
     */
    async _handleConnectNode() {
        if (this.state.onlineNodes.size > 1) {  
            if (!this.state.handler) {
                const orderedNodes = [...this.state.onlineNodes].sort();
                for (const node of orderedNodes) {
                    if (this.state.generator !== node) {
                        await set('handler', node);
                        this.state.handler = node;
                        break;
                    }
                };
            }
        }
    }
    
    /**
     * If the disconnectedNodes includes generator or
     * handler, then necessary reselect them 
     */
    async _handleDisconnectNode(disconnectedNodes) {

        // reselect generator if current disconnected
        if (disconnectedNodes.has(this.state.generator)) {
            const orderedNodes = [...this.state.onlineNodes].sort();

            if (orderedNodes.length > 1) {
                for (const node of orderedNodes) {
                    if (this.state.handler !== node) 
                        this.state.generator = node;{
                        await set('generator', node);
                        break;
                    }
                };

            } else if (orderedNodes.length === 1) {
                this.state.generator = orderedNodes[0];
                this.state.handler = null;
                await set('generator', orderedNodes[0]);
                await del('handler');

            } else {
                await del('generator');
                await del('handler');
            }
        }

        // reselect handler if current disconnected
        if (disconnectedNodes.has(this.state.handler)) {
            const orderedNodes = [...this.state.onlineNodes].sort();
            if (orderedNodes.length > 1) {
                for (const node of orderedNodes) {
                    if (this.state.generator !== node) {
                        await set('handler', node);
                        this.state.handler = node;
                        break;
                    }
                };
            } else {
                this.state.handler = null;
                await del('handler');
            }
        }
    }

    /**
     * Synchronizes previous and new state of nodes
     */
    async _syncOnlineNodeState() {
        const onlineNodeIds = await this._getOnlineNodeIds();

        const connectedNodes = difference(onlineNodeIds, this.state.onlineNodes);
        connectedNodes.forEach(node => {
            this.state.onlineNodes.add(node);
        });

        const disconnectedNodes = difference(this.state.onlineNodes, onlineNodeIds);
        disconnectedNodes.forEach(node => {
            this.state.onlineNodes.delete(node);
        });

        return {
            connectedNodes,
            disconnectedNodes,
        }
    }

    /**
     * Initialization local state
     */
    async _initState() {
        const now = Date.now();
        await set(`node:${this.id}:timestamp`, now);

        const generator = await get('generator');
        const handler = await get('handler');
        const onlineNodeIds = await this._getOnlineNodeIds();

        if (!onlineNodeIds.has(generator)) {
            const orderedNodes = [...onlineNodeIds].sort();
            this.state.generator = orderedNodes[0];
            await set('generator', orderedNodes[0]);

        } else {
            this.state.generator = generator;
        }

        if (!onlineNodeIds.has(handler)) {
            if (onlineNodeIds.size > 1) {
                const orderedNodes = [...onlineNodeIds].sort();
                this.state.handler = orderedNodes[1];
                await set('handler', orderedNodes[1]);

            } else {
                await del('handler');
                this.state.handler = null;
            }        
        } else {
            this.state.handler = handler;
        }

        this.state.onlineNodes = new Set(onlineNodeIds);
    }

    /**
     * Return online nodes
     * @returns {Set<string>} Set of online nodes
     */
    async _getOnlineNodeIds() {
        const now = Date.now();
        const onlineNodeIds = new Set();
        const onlineNodes = await keys('node:*:timestamp');

        for (const node of onlineNodes) {
            const timestamp = await get(node);

            if (timestamp && (now - timestamp < ONLINE_STATUS_EXPIRE)) {
                const nodeId = node.split(':')[1];
                onlineNodeIds.add(nodeId);

            } else {
                await del(node);
            }
        }

        return onlineNodeIds;
    }
}

module.exports = {
    Node,
}