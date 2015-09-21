var kevoree       = require('kevoree-library'),
    KevoreeLogger = require('kevoree-commons').KevoreeLogger,
    async         = require('async'),
    util          = require('util'),
    EventEmitter  = require('events').EventEmitter;

var NAME_PATTERN = /^[\w-]+$/;

/**
 *
 * @param modulesPath
 * @param logger
 * @constructor
 */
function KevoreeCore(modulesPath, logger) {
    this.log = (logger !== undefined) ? logger : new KevoreeLogger(this.toString());

    this.stopping       = false;
    this.currentModel   = null;
    this.deployModel    = null;
    this.nodeName       = null;
    this.nodeInstance   = null;
    this.modulesPath    = modulesPath;
    this.bootstrapper   = null;
    this.firstBoot      = true;

    this.emitter = new EventEmitter();
}

util.inherits(KevoreeCore, EventEmitter);

/**
 *
 * @param nodeName
 */
KevoreeCore.prototype.start = function (nodeName) {
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

        // add platform node
        this.currentModel.addNodes(node);

        var id = setInterval(function () {}, 10e10);
        // hang-on until the core is stopped
        this.emitter.on('stopped', function () {
            clearInterval(id);
            this.emit('stopped');
        }.bind(this));

        this.log.info(this.toString(), "Platform node name: "+nodeName);
    } else {
        throw new Error('Platform node name must match this regex '+NAME_PATTERN.toString());
    }
};

/**
 *
 */
KevoreeCore.prototype.stop = function () {
    var factory = new kevoree.factory.DefaultKevoreeFactory();
    var cloner = factory.createModelCloner();
    var stopModel = cloner.clone(this.currentModel, false);
    var node = stopModel.findNodesByID(this.nodeName);
    node.started = false;
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
        if (binding.port.eContainer() &&
            binding.port.eContainer().eContainer() &&
            binding.port.eContainer().eContainer().name === node.name) {
            if (binding.hub) {
                binding.hub.delete();
            }
        }
    }

    var comps = node.components.iterator();
    while (comps.hasNext()) {
        comps.next().delete();
    }

    this.stopping = true;
    this.deploy(stopModel, function () {
        if (this.nodeInstance === null) {
            this.log.info(this.toString(), 'Platform stopped before bootstrapped');
            this.emitter.emit('stopped');
        } else {
            this.log.info(this.toString(), "Platform stopped: "+this.nodeInstance.getName());
            this.emitter.emit('stopped');
        }
    }.bind(this));
};

/**
 *
 * @param model
 * @param callback
 */
KevoreeCore.prototype.deploy = function (model, callback) {
    callback = callback || function deployNoopCallback() {};
    if (!this.deployModel) {
        this.emit('deploying', model);
        if (model && !model.findNodesByID(this.nodeName)) {
            callback(new Error('Deploy model failure: unable to find '+this.nodeName+' in given model'));
        } else {
            this.log.debug(this.toString(), 'Deploy process started...');
            var start = new Date().getTime();
            if (model) {
                // check if there is an instance currently running
                // if not, it will try to run it
                var core = this;
                this.checkBootstrapNode(model, function (err) {
                    if (err) {
                        callback(err);
                    } else {
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
                                var executeCommand = function (cmd, iteratorCallback) {
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
                                };

                                // rollbackCommand: function that calls undo() on cmds in the stack
                                var rollbackCommand = function (cmd, iteratorCallback) {
                                    try {
                                        cmd.undo(iteratorCallback);
                                    } catch (err) {
                                        iteratorCallback(err);
                                    }
                                };

                                // execute each command synchronously
                                async.eachSeries(adaptations, executeCommand, function (err) {
                                    if (err) {
                                        err.message = "Something went wrong while processing adaptations.\n"+err.message;
                                        core.log.error(core.toString(), err.stack);
                                        if (core.firstBoot) {
                                            core.log.warn(core.toString(), 'Shutting down Kevoree because first deployment failed...');
                                            core.deployModel = null;
                                            core.stop();
                                            callback(err);
                                        } else {
                                            core.log.info(core.toString(), 'Rollbacking to previous model...');

                                            // rollback process
                                            async.eachSeries(cmdStack, rollbackCommand, function (err) {
                                                if (err) {
                                                    // something went wrong while rollbacking
                                                    err.message = "Something went wrong while rollbacking. Process will exit.\n"+err.message;
                                                    core.log.error(core.toString(), err.stack);
                                                    // stop everything :/
                                                    core.deployModel = null;
                                                    core.stop();
                                                    callback(err);
                                                } else {
                                                    // rollback succeed
                                                    core.log.info(core.toString(), 'Rollback succeed: '+cmdStack.length+' adaptations ('+(new Date().getTime() - start)+'ms)');
                                                    core.deployModel = null;
                                                    core.emit('rollbackSucceed');
                                                    callback();
                                                }
                                            });
                                        }

                                    } else {
                                        // set current model
                                        core.currentModel = model;
                                        // reset deployModel
                                        core.deployModel = null;
                                        // adaptations succeed : woot
                                        core.log.info(core.toString(), 'Model deployed successfully: '+adaptations.length+' adaptations ('+(new Date().getTime() - start)+'ms)');
                                        // all good :)
                                        if (typeof (core.nodeInstance.onModelDeployed) === 'function') { // backward compatibility with kevoree-entities < 2.1.0
                                            core.nodeInstance.onModelDeployed();
                                        }
                                        core.emit('deployed');
                                        core.firstBoot = false;
                                        callback();
                                    }
                                });
                            } catch (e) {
                                core.log.error(core.toString(), 'Deployment failed.\n'+e.stack);
                                core.deployModel = null;
                                callback(e);
                            }

                        } else {
                            callback(new Error("There is no instance to bootstrap on"));
                        }
                    }
                });
            } else {
                callback(new Error("Model is not defined or null. Deploy aborted."));
            }
        }
    } else {
        // TODO add the possibility to put new deployment in pending queue
        this.log.warn(this.toString(), 'New deploy process requested: aborted because another one is in process (retry later?)');
        callback(new Error('New deploy process requested: aborted because another one is in process (retry later?)'));
    }
};

/**
 *
 * @param model
 * @param callback
 */
KevoreeCore.prototype.checkBootstrapNode = function (model, callback) {
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
};

/**
 *
 * @returns {string}
 */
KevoreeCore.prototype.toString = function () {
    return 'KevoreeCore';
};

/**
 *
 * @returns {null|*}
 */
KevoreeCore.prototype.getBootstrapper = function () {
    return this.bootstrapper;
};

/**
 *
 * @param bootstrapper
 */
KevoreeCore.prototype.setBootstrapper = function (bootstrapper) {
    this.bootstrapper = bootstrapper;
};

/**
 *
 * @returns {string}
 */
KevoreeCore.prototype.getModulesPath = function () {
    return this.modulesPath;
};

/**
 *
 * @returns {null|*}
 */
KevoreeCore.prototype.getCurrentModel = function () {
    return this.currentModel;
};

/**
 *
 * @returns {null|*}
 */
KevoreeCore.prototype.getLastModel = function () {
    if (typeof this.deployModel !== 'undefined' && this.deployModel !== null) {
        return this.deployModel;
    } else {
        return this.currentModel;
    }
};

/**
 *
 * @returns {null|*}
 */
KevoreeCore.prototype.getDeployModel = function () {
    return this.deployModel;
};

/**
 *
 * @returns {null|*|string}
 */
KevoreeCore.prototype.getNodeName = function () {
    return this.nodeName;
};

/**
 *
 * @returns {*}
 */
KevoreeCore.prototype.getLogger = function () {
    return this.log;
};

KevoreeCore.prototype.off = function (event, listener) {
    this.removeListener(event, listener);
};

/**
 *
 * @type {KevoreeCore}
 */
module.exports = KevoreeCore;
