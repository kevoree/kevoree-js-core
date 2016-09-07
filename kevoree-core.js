'use strict';

var kevoree = require('kevoree-library'),
  async = require('async'),
  util = require('util'),
  EventEmitter = require('events').EventEmitter;

var NAME_PATTERN = /^[\w]+$/;

/**
 *
 * @param modulesPath
 * @param logger
 * @constructor
 */
function KevoreeCore(kevscript, modulesPath, logger) {
  if (!kevscript || !modulesPath || !logger) {
    throw new Error('KevoreeCore constructor needs a KevScript engine, modulesPath and a KevoreeLogger');
  }
  this.log = logger;
  this.kevs = kevscript;
  this.stopping = false;
  this.currentModel = null;
  this.deployModel = null;
  this.nodeName = null;
  this.nodeInstance = null;
  this.modulesPath = modulesPath;
  this.bootstrapper = null;
  this.firstBoot = true;
  this.scriptQueue = [];

  this.emitter = new EventEmitter();
}

util.inherits(KevoreeCore, EventEmitter);

/**
 *
 * @param nodeName
 */
KevoreeCore.prototype.start = function (nodeName) {
  if (!nodeName || nodeName.length === 0) {
    nodeName = 'node0';
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

    this.log.info(this.toString(), 'Platform node name: ' + nodeName);
  } else {
    throw new Error('Platform node name must match this regex ' + NAME_PATTERN.toString());
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
      this.log.info(this.toString(), 'Platform stopped: ' + this.nodeInstance.getName());
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
      callback(new Error('Deploy model failure: unable to find ' + this.nodeName + ' in given model'));
    } else {
      this.log.debug(this.toString(), 'Deploy process started...');
      var start = new Date().getTime();
      if (model) {
        // check if there is an instance currently running
        // if not, it will try to run it
        var core = this;
        this.checkBootstrapNode(model, function (err) {
          if (err) {
            core.emit('error', err);
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
                var executeCommand = function (cmd, cb) {
                  // save the cmd to be processed in a stack using unshift
                  // in order to add the last processed cmd at the beginning of the array
                  // => cmdStack[0] = more recently executed cmd
                  cmdStack.unshift(cmd);

                  var exception;
                  var done = false;

                  // execute cmd
                  try {
                    cmd.execute(function (err) {
                      if (!exception) {
                        if (err) {
                          if (core.stopping) {
                            // log error
                            core.log.error(cmd.toString(), 'Fail adaptation skipped: ' + err.message);
                            // but continue adaptation because we are stopping runtime anyway
                            err = null;
                          }
                        }
                        cb(err);
                        done = true;
                      }
                    });
                  } catch (err) {
                    if (!done) {
                      exception = err;
                      cb(err);
                    } else {
                      core.log.error(core.toString(), 'The execution of ' + cmd.toString() + ' threw an exception\n' + err.stack);
                    }
                  }
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
                    err.message = 'Something went wrong while processing adaptations.\n' + err.message;
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
                          err.message = 'Something went wrong while rollbacking. Process will exit.\n' + err.message;
                          core.log.error(core.toString(), err.stack);
                          // stop everything :/
                          core.deployModel = null;
                          core.stop();
                          callback(err);
                        } else {
                          // rollback succeed
                          core.log.info(core.toString(), 'Rollback succeed: ' + cmdStack.length + ' adaptations (' + (new Date().getTime() - start) + 'ms)');
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
                    core.log.info(core.toString(), 'Model deployed successfully: ' + adaptations.length + ' adaptations (' + (new Date().getTime() - start) + 'ms)');
                    // all good :)
                    // process script queue if anyway
                    core.processScriptQueue();

                    core.emit('deployed');
                    core.firstBoot = false;
                    callback();
                  }
                });
              } catch (e) {
                core.log.error(core.toString(), 'Deployment failed.\n' + e.stack);
                core.deployModel = null;
                callback(e);
              }

            } else {
              callback(new Error('There is no instance to bootstrap on'));
            }
          }
        });
      } else {
        callback(new Error('Model is not defined or null. Deploy aborted.'));
      }
    }
  } else {
    // TODO add the possibility to put new deployment in pending queue
    this.log.warn(this.toString(), 'New deploy process requested: aborted because another one is in process (retry later?)');
    callback(new Error('New deploy process requested: aborted because another one is in process (retry later?)'));
  }
};

KevoreeCore.prototype.submitScript = function (script, callback) {
  if (typeof callback !== 'function') {
    callback = function (err) {
      if (err) {
        // even if the user did not register any callback to submitScript()
        // display the error so that he gets notified in case of error
        this.log.error(this.toString(), err.message);
      }
    }.bind(this);
  }

  if (this.deployModel === null) {
    // not in "deploying state"
    this.kevs.parse(script, this.currentModel, function (err, model) {
      if (err) {
        var e = new Error('KevScript submission failed (' + err.message + ')');
        callback(e);
        return;
      }

      var deployHandler, errHandler, adaptHandler;
      deployHandler = function () {
        this.off('error', errHandler);
        this.off('adaptationError', adaptHandler);
        callback();
      }.bind(this);
      errHandler = function (err) {
        this.off('deployed', deployHandler);
        this.off('adaptationError', adaptHandler);
        var e = new Error('KevScript submission failed (' + err.message + ')');
        callback(e);
      }.bind(this);
      adaptHandler = function (err) {
        this.off('error', errHandler);
        this.off('deployed', deployHandler);
        var e = new Error('KevScript submission failed (' + err.message + ')');
        callback(e);
      }.bind(this);

      this.once('deployed', deployHandler);
      this.once('error', errHandler);
      this.once('adaptationError', adaptHandler);

      this.deploy(model);
    }.bind(this));
  } else {
    // in "deploying state" => need to queue request to process it afterwards
    this.scriptQueue.push({
      script: script,
      callback: callback
    });
    this.log.debug(this.toString(), 'Script added to queue at position ' + this.scriptQueue.length - 1);
  }
};

KevoreeCore.prototype.processScriptQueue = function () {
  if (this.scriptQueue.length > 0) {
    // retrieve first queued script
    var item = this.scriptQueue[0];
    // remove first queued script from the queue
    this.scriptQueue.splice(0, 1);
    // execute first queued script
    this.log.debug(this.toString(), 'Core.processScriptQueue parsing ' + item.script);
    this.kevs.parse(item.script, this.currentModel, function (err, model) {
      if (err) {
        // queued script submission failed
        var e = new Error('KevScript submission failed (' + err.message + ')');
        item.callback(e);

      } else {
        // queued script submission succeed
        var deployHandler, errHandler, adaptHandler;
        deployHandler = function () {
          this.off('error', errHandler);
          this.off('adaptationError', adaptHandler);
          item.callback();
        }.bind(this);
        errHandler = function (err) {
          this.off('deployed', deployHandler);
          this.off('adaptationError', adaptHandler);
          var e = new Error('KevScript submission failed (' + err.message + ')');
          item.callback(e);
        }.bind(this);
        adaptHandler = function (err) {
          this.off('error', errHandler);
          this.off('deployed', deployHandler);
          var e = new Error('KevScript submission failed (' + err.message + ')');
          item.callback(e);
        }.bind(this);

        this.once('deployed', deployHandler);
        this.once('error', errHandler);
        this.once('adaptationError', adaptHandler);

        this.deploy(model);
      }
    }.bind(this));
  }
};

/**
 *
 * @param model
 * @param callback
 */
KevoreeCore.prototype.checkBootstrapNode = function (deployModel, callback) {
  callback = callback || function () {
    console.warn('No callback defined for checkBootstrapNode(model, cb) in KevoreeCore');
  };

  if (typeof (this.nodeInstance) === 'undefined' || this.nodeInstance === null) {
    this.log.debug(this.toString(), 'Start \'' + this.nodeName + '\' bootstrapping...');
    try {
      this.bootstrapper.bootstrapNodeType(this.nodeName, deployModel, function (err, AbstractNode) {
        if (err) {
          callback(err);
          return;
        }

        var deployNode = deployModel.findNodesByID(this.nodeName);
        var currentNode = this.currentModel.findNodesByID(this.nodeName);

        // create node instance
        this.nodeInstance = new AbstractNode(this, deployNode, this.nodeName);

        // bootstrap node dictionary
        var factory = new kevoree.factory.DefaultKevoreeFactory();
        currentNode.dictionary = factory.createDictionary().withGenerated_KMF_ID('0');
        if (deployNode.typeDefinition.dictionaryType) {
          deployNode.typeDefinition.dictionaryType.attributes.array.forEach(function (attr) {
            if (!attr.fragmentDependant) {
              var param = factory.createValue();
              param.name = attr.name;
              param.value = attr.defaultValue;
              currentNode.dictionary.addValues(param);
              this.log.debug(this.toString(), 'Set default node param: '+param.name+'='+param.value);
            }
          }.bind(this));
        }

        callback();
      }.bind(this));
    } catch (err) {
      callback(err);
    }
  } else {
    callback();
  }
};

/**
 *
 * @returns {string}
 */
KevoreeCore.prototype.toString = function () {
  return 'Core';
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
