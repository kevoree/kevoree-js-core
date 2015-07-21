var Class         = require('pseudoclass'),
    kevoree       = require('kevoree-library'),
    KevoreeLogger = require('kevoree-commons').KevoreeLogger,
    async         = require('async'),
    os            = require('os'),
    EventEmitter  = require('events').EventEmitter;

var NAME_PATTERN = /^[\w-]+$/;

/**
 * Kevoree Core
 *
 * @type {Object}
 */
var Core = Class({
    toString: 'KevoreeCore',

    /**
     * Core constructor
     */
    construct: function(modulesPath, logger) {
        this.log = (logger != undefined) ? logger : new KevoreeLogger(this.toString());

        this.stopping       = false;
        this.currentModel   = null;
        this.deployModel    = null;
        this.models         = [];
        this.nodeName       = null;
        this.nodeInstance   = null;
        this.modulesPath    = modulesPath;
        this.bootstrapper   = null;
        this.intervalId     = null;

        this.emitter = new EventEmitter();
        var defaultEmit = this.emitter.emit;
        this.emitter.emit = function () {
            // emit event on process.nextTick to let a chance of catching it when registered after method call
            // eg: var c = new KevoreeCore('/tmp');
            // c.start('foo');
            // c.on('started', function () { /* this wouldn't have been called without process.nextTick */ });
            var args = arguments;
            process.nextTick(function () {
                defaultEmit.apply(this, args);
            }.bind(this));
        }.bind(this.emitter);
    },

    /**
     * Starts Kevoree Core
     * @param nodeName
     */
    start: function (nodeName) {
        if (!nodeName || nodeName.length === 0) {
            nodeName = "node0";
        }

        if (nodeName.match(NAME_PATTERN)) {
            this.nodeName = nodeName;
            var factory = new kevoree.factory.DefaultKevoreeFactory();
            this.currentModel = factory.createContainerRoot();
            factory.root(this.currentModel);

            // create platform node
            var node = factory.createContainerNode();
            node.name = this.nodeName;
            node.started = false;

            // create node network interfaces
            var net = factory.createNetworkInfo();
            net.name = 'ip';
            var ifaces = os.networkInterfaces();
            for (var iface in ifaces) {
                if (ifaces.hasOwnProperty(iface)) {
                    var val = factory.createValue();
                    val.name = iface+'_'+ifaces[iface][0].family;
                    val.value = ifaces[iface][0].address;
                    net.addValues(val);
                }
            }
            // add net ifaces to node if any
            if (net.values.size() > 0) {
                node.addNetworkInformation(net);
            }

            // add platform node
            this.currentModel.addNodes(node);

            // starting loop function
            this.intervalId = setInterval(function () {}, 1e8);

            this.log.info(this.toString(), "Platform node name: "+nodeName);

            this.emitter.emit('started');
        } else {
            this.emitter.emit('error', new Error('Platform node name must match this regex '+NAME_PATTERN.toString()));
        }
    },

    /**
     * Compare current with model
     * Get traces and call command (that can be redefined)
     *
     * @param model ContainerRoot model
     * @emit error
     * @emit deploying
     * @emit deployed
     * @emit adaptationError
     * @emit rollbackError
     * @emit rollbackSucceed
     */
    deploy: function (model) {
        if (!this.deployModel) {
            this.emitter.emit('deploying', model);
            if (model && !model.findNodesByID(this.nodeName)) {
                this.emitter.emit('error', new Error('Deploy model failure: unable to find '+this.nodeName+' in given model'));

            } else {
                this.log.debug(this.toString(), 'Deploy process started...');
                var start = new Date().getTime();
                if (model) {
                    // check if there is an instance currently running
                    // if not, it will try to run it
                    var core = this;
                    this.checkBootstrapNode(model, function (err) {
                        if (err) {
                            core.emitter.emit('error', err);
                            return;
                        }

                        if (core.nodeInstance) {
                            try {
                                // given model is defined and not null
                                var factory = new kevoree.factory.DefaultKevoreeFactory();
                                // clone model so that adaptations won't modify the current one
                                var cloner = factory.createModelCloner();
                                core.deployModel = cloner.clone(model, true);
                                // set it read-only to ensure adaptations consistency
                                core.deployModel.setRecursiveReadOnly();
                                // make a diff between the current model and the model to deploy
                                var diffSeq = factory.createModelCompare().diff(core.currentModel, core.deployModel);
                                // ask the node platform to create the needed adaptation primitives
                                var adaptations = core.nodeInstance.processTraces(diffSeq, core.deployModel);
                                var cmdStack = [];

                                // executeCommand: function that save cmd to stack and executes it
                                function executeCommand(cmd, iteratorCallback) {
                                    // save the cmd to be processed in a stack using unshift
                                    // in order to add the last processed cmd at the beginning of the array
                                    // => cmdStack[0] = more recently executed cmd
                                    cmdStack.unshift(cmd);

                                    // execute cmd
                                    cmd.execute(function (err) {
                                        if (err) {
                                            if (core.stopping) {
                                                // log error
                                                core.log.error(cmd.toString(), 'Fail adaptation skipped: '+err.message);
                                                // but continue adaptation because we are stopping runtime anyway
                                                err = null;
                                            }
                                        }
                                        iteratorCallback(err);
                                    });
                                }

                                // rollbackCommand: function that calls undo() on cmds in the stack
                                function rollbackCommand(cmd, iteratorCallback) {
                                    try {
                                        cmd.undo(iteratorCallback);
                                    } catch (err) {
                                        iteratorCallback(err);
                                    }
                                }

                                // execute each command synchronously
                                async.eachSeries(adaptations, executeCommand, function (err) {
                                    if (err) {
                                        err.message = "Something went wrong while processing adaptations.\n"+err.message;
                                        core.log.error(core.toString(), err.stack);
                                        core.emitter.emit('adaptationError', err);
                                        core.log.info(core.toString(), 'Rollbacking to previous model...');

                                        // rollback process
                                        async.eachSeries(cmdStack, rollbackCommand, function (er) {
                                            if (er) {
                                                // something went wrong while rollbacking
                                                er.message = "Something went wrong while rollbacking. Process will exit.\n"+er.message;
                                                core.log.error(core.toString(), er.stack);
                                                // stop everything :/
                                                core.stop();
                                                core.emitter.emit('rollbackError', er);
                                                // rollback succeed
                                                core.emitter.emit('rollbackSucceed');
                                            }
                                        });

                                    } else {
                                        // save old model
                                        pushInArray(core.models, core.currentModel);
                                        // set current model
                                        core.currentModel = cloner.clone(model, false);
                                        // reset deployModel
                                        core.deployModel = null;
                                        // adaptations succeed : woot
                                        core.log.info(core.toString(), 'Model deployed successfully: '+adaptations.length+' adaptations ('+(new Date().getTime() - start)+'ms)');
                                        // all good :)
                                        if (typeof (core.nodeInstance.onModelDeployed) === 'function') { // backward compatibility with kevoree-entities < 2.1.0
                                            core.nodeInstance.onModelDeployed();
                                        }
                                        core.emitter.emit('deployed', core.currentModel);
                                    }
                                });
                            } catch (err) {
                                core.log.error(core.toString(), 'Deployment failed.\n'+err.stack);
                                core.emitter.emit('deployError');
                            }

                        } else {
                            core.emitter.emit('error', new Error("There is no instance to bootstrap on"));
                        }
                    });
                } else {
                    this.emitter.emit('error', new Error("Model is not defined or null. Deploy aborted."));
                }
            }
        } else {
            // TODO add the possibility to put new deployment in pending queue
            this.log.warn(this.toString(), 'New deploy process requested: aborted because another one is in process (retry later?)');
            this.emitter.emit('deployError', 'New deploy process requested: aborted because another one is in process (retry later?)');
        }
    },

    /**
     * Stops Kevoree Core
     */
    stop: function () {
        var stopRuntime = function () {
            // prevent event emitter leaks by unregister them
            this.off('deployed', deployHandler);
            this.off('adaptationError', stopRuntime);
            this.off('error', stopRuntime);

            clearInterval(this.intervalId);
            if (this.nodeInstance === null) {
                this.log.info(this.toString(), 'Platform stopped before bootstrapped');
            } else {
                this.log.info(this.toString(), "Platform stopped: "+this.nodeInstance.getName());
            }

            this.currentModel   = null;
            this.deployModel    = null;
            this.models         = [];
            this.nodeName       = null;
            this.nodeInstance   = null;
            this.intervalId     = null;

            this.emitter.emit('stopped');
        }.bind(this);

        var deployHandler = function () {
            // prevent event emitter leaks by unregister them
            this.off('adaptationError', stopRuntime);
            this.off('error', stopRuntime);

            // stop node
            this.nodeInstance.stop(function (err) {
                if (err) {
                    this.emitter.emit('error', new Error(err.message));
                }

                stopRuntime();
            }.bind(this));
        }.bind(this);

        if (typeof (this.intervalId) !== 'undefined' && this.intervalId !== null) {
            var factory = new kevoree.factory.DefaultKevoreeFactory();
            var cloner = factory.createModelCloner();
            var stopModel = cloner.clone(this.currentModel, false);
            var node = stopModel.findNodesByID(this.nodeName);
            var subNodes = node.hosts.iterator();
            while (subNodes.hasNext()) {
                subNodes.next().delete();
            }

            var groups = node.groups.iterator();
            while (groups.hasNext()) {
                groups.next().delete();
            }

            var bindings = stopModel.mBindings.iterator();
            while (bindings.hasNext()) {
                var binding = bindings.next();
                if (binding.port.eContainer()
                    && binding.port.eContainer().eContainer()
                    && binding.port.eContainer().eContainer().name === node.name) {
                    if (binding.hub) {
                        binding.hub.delete();
                    }
                }
            }

            var comps = node.components.iterator();
            while (comps.hasNext()) {
                comps.next().delete();
            }

            this.once('deployed', deployHandler);
            this.once('adaptationError', stopRuntime);
            this.once('error', stopRuntime);

            this.stopping = true;
            this.deploy(stopModel);
        } else {
            stopRuntime();
            this.emitter.emit('stopped');
        }
    },

    checkBootstrapNode: function (model, callback) {
        callback = callback || function () { console.warn('No callback defined for checkBootstrapNode(model, cb) in KevoreeCore'); };

        if (typeof (this.nodeInstance) === 'undefined' || this.nodeInstance === null) {
            this.log.debug(this.toString(), "Start '"+this.nodeName+"' bootstrapping...");
            this.bootstrapper.bootstrapNodeType(this.nodeName, model, function (err, AbstractNode) {
                if (err) {
                    callback(err);
                    return;
                }

                var node = model.findNodesByID(this.nodeName);

                this.nodeInstance = new AbstractNode();
                this.nodeInstance.setKevoreeCore(this);
                this.nodeInstance.setName(this.nodeName);
                this.nodeInstance.setPath(node.path());

                callback();
            }.bind(this));

        } else {
            callback();
        }
    },

    setBootstrapper: function (bootstrapper) {
        this.bootstrapper = bootstrapper;
    },

    getBootstrapper: function () {
        return this.bootstrapper;
    },

    getCurrentModel: function () {
        return this.currentModel;
    },

    /**
     * Returns deployModel or currentModel if not deploying
     * @returns {Object}
     */
    getLastModel: function () {
        if (typeof this.deployModel !== 'undefined' && this.deployModel !== null) {
            return this.deployModel;
        } else {
            return this.currentModel;
        }
    },

    getPreviousModel: function () {
        var model = null;
        if (this.models.length > 0) model = this.models[this.models.length-1];
        return model;
    },

    getPreviousModels: function () {
        return this.models;
    },

    getModulesPath: function () {
        return this.modulesPath;
    },

    getDeployModel: function () {
        return this.deployModel;
    },

    getNodeName: function () {
        return this.nodeName;
    },

    getLogger: function () {
        return this.log;
    },

    on: function (event, callback) {
        this.emitter.addListener(event, callback);
    },

    off: function (event, callback) {
        this.emitter.removeListener(event, callback);
    },

    once: function (event, callback) {
        this.emitter.once(event, callback);
    }
});

// utility function to ensure cached model list won't go over 10 models
var pushInArray = function pushInArray(array, model) {
    if (array.length === 10) {
        array.shift();
    }
    array.push(model);
};

// Exports
module.exports = Core;
