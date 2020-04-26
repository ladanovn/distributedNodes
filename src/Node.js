const uniqid = require('uniqid');
const logUpdate = require('log-update');

const redisPromisify = require('./helpers/redisPromisify');
const { difference } = require('./helpers/sets');
const { client } = require('./db/redis');

const get = redisPromisify.get(client);
const set = redisPromisify.set(client);
const keys = redisPromisify.keys(client);
const del = redisPromisify.del(client);

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

        /**
         * Store dublicated client for subscription
         * if current node is handler 
         */
        this.subscription = {
            isEnabled: false,
            subscriber: null,
        };

        /**
         * Used for visualisazion node work
         */
        this.analytics = {
            countSendedMsg: 0,
            countRecievedMsg: 0
        };
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

        // confirm online status
        await set(`node:${this.id}:timestamp`, now);

        const { disconnectedNodes } = await this._syncOnlineNodeState();

        await this._handleDisconnectNode(disconnectedNodes);
        await this._handleConnectNode();

        this._consoleState();
    }

    /**
     * Publish message if current node is generator
     */
    async _publishMsg() {
        if (this.state.generator === this.id) {
            const message = `Message, ${new Date()}`;
            client.publish('message', message);
            this.analytics.countSendedMsg++;
        }
    }

    /**
     * Handle message if current node is handler
     */
    async _receiveMsg(channel, message) {
        if (this.state.handler === this.id) {
            this.analytics.countRecievedMsg++;
        } else {
            // Unsubcribe if current node is not handler now 
            if (this.subscription.isEnabled) {
                this.subscription.subscriber.unsubscribe();
                this.subscription = {
                    isEnabled: false,
                    subscriber: null,
                }
            }
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
                        await this._setGlobalHandler(node);
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
                    if (this.state.handler !== node) {
                        await this._setGlobalGenerator(node)
                        break;
                    }
                }

            } else if (orderedNodes.length === 1) {
                await this._setGlobalGenerator(orderedNodes[0]);
                await this._setGlobalHandler(null);
            }
        }

        // reselect handler if current disconnected
        if (disconnectedNodes.has(this.state.handler)) {
            const orderedNodes = [...this.state.onlineNodes].sort();
            if (orderedNodes.length > 1) {
                for (const node of orderedNodes) {
                    if (this.state.generator !== node) {
                        await this._setGlobalHandler(node);
                        break;
                    }
                };
            } else {
                await this._setGlobalHandler(null);
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
            await this._setGlobalGenerator(orderedNodes[0]);

        } else {
            this.state.generator = generator;
        }

        if (!onlineNodeIds.has(handler)) {
            if (onlineNodeIds.size > 1) {
                const orderedNodes = [...onlineNodeIds].sort();
                await this._setGlobalHandler(orderedNodes[1]);

            } else {
                await this._setGlobalHandler(null);
            }        
        } else {
            this.state.handler = handler;
        }

        this.state.onlineNodes = new Set(onlineNodeIds);
    }

    /**
     * Console current state
     */
    async _consoleState() {
        logUpdate(
`Current node: ${this.id}
State:
    generator: ${this.state.generator},
    handler: ${this.state.handler},
    onlineNode (${this.state.onlineNodes.size}): ${[...this.state.onlineNodes]}    

Sended messaged: ${this.analytics.countSendedMsg}
Recieved messaged: ${this.analytics.countRecievedMsg}
`       );
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

    /**
     * Set generator in local and origin states
     * @param {string|null} newGenerator 
     */
    async _setGlobalGenerator(newGenerator) {
        this.state.generator = newGenerator;
        await newGenerator !== null ?
            set('generator', newGenerator ) :
            del('generator');
    }

    /**
     * Set handler in local and origin states
     * @param {string|null} newHandler 
     */
    async _setGlobalHandler(newHandler) {
        this.state.handler = newHandler;
        await newHandler !== null ?
            set('handler', newHandler) :
            del('handler');

        if (this.id === newHandler) {
            this.subscription = {
                isEnabled: true,
                subscriber: client.duplicate(),
            }
            this.subscription.subscriber.on('message', this._receiveMsg.bind(this));
            this.subscription.subscriber.subscribe('message');
        }
    }
}

module.exports = {
    Node,
}