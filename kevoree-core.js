'use strict';

var kevoree = require('kevoree-library');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var adaptationsExecutor = require('./lib/adaptation-executor');

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
KevoreeCore.prototype.stop = function (callback) {
	callback = callback || function noop() {};

	this.emitter.once('stopped', callback);

	var factory = new kevoree.factory.DefaultKevoreeFactory();
	var cloner = factory.createModelCloner();
	var stopModel = cloner.clone(this.currentModel, false);
	var node = stopModel.findNodesByID(this.nodeName);
	if (node.started) {
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
	} else {
		this.emitter.emit('stopped');
	}
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
			this.log.debug(this.toString(), (this.stopping ? 'Stopping':'Deploy') + ' process started...');
			//var start = new Date().getTime();
			if (model) {
				// check if there is an instance currently running
				// if not, it will try to run it
				var self = this;
				this.checkBootstrapNode(model)
					.then(function () {
						if (self.nodeInstance) {
							var adaptations;
							try {
								// monkey-patch model because of KMF
								monkeyPatchKMF(model);
								var factory = new kevoree.factory.DefaultKevoreeFactory();
								// clone model so that adaptations won't modify the proposed one
								var cloner = factory.createModelCloner();
								self.deployModel = cloner.clone(model, true);
								// set it read-only to ensure adaptations consistency
								self.deployModel.setRecursiveReadOnly();
								// make a diff between the current model and the model to deploy
								var diffSeq = factory.createModelCompare().diff(self.currentModel, self.deployModel);
								// ask the node platform to create the needed adaptation commands
								adaptations = self.nodeInstance.processTraces(diffSeq, self.deployModel);
								// execute adaptation commands
								adaptationsExecutor(self, model, adaptations, callback);
							} catch (err) {
								self.log.error(self.toString(), err.stack);
								var error = new Error('Something went wrong while creating adaptations (deployment ignored)');
								self.log.warn(self.toString(), error.message);
								self.deployModel = null;
								if (self.firstBoot) {
									// === If firstBoot adaptations creation failed then it is bad => exit
									self.log.warn(self.toString(), 'Shutting down Kevoree because bootstrap failed...');
									callback(error);
									self.emit('error', error);
								} else {
									callback(error);
									self.emit('error', error);
								}
							}
						} else {
							callback(new Error('There is no instance to bootstrap on'));
						}
					})
					.catch(function (err) {
						self.emit('error', err);
						callback(err);
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
	var self = this;
	if (typeof callback !== 'function') {
		callback = function (err) {
			if (err) {
				// even if the user did not register any callback to submitScript()
				// display the error so that he gets notified in case of error
				self.log.error(self.toString(), err.message);
			}
		};
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
				self.off('error', errHandler);
				self.off('adaptationError', adaptHandler);
				callback();
			};
			errHandler = function (err) {
				self.off('deployed', deployHandler);
				self.off('adaptationError', adaptHandler);
				var e = new Error('KevScript submission failed (' + err.message + ')');
				callback(e);
			};
			adaptHandler = function (err) {
				self.off('error', errHandler);
				self.off('deployed', deployHandler);
				var e = new Error('KevScript submission failed (' + err.message + ')');
				callback(e);
			};

			self.once('deployed', deployHandler);
			self.once('error', errHandler);
			self.once('adaptationError', adaptHandler);

			self.deploy(model);
		});
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
	var self = this;
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
					self.off('error', errHandler);
					self.off('adaptationError', adaptHandler);
					item.callback();
				};
				errHandler = function (err) {
					self.off('deployed', deployHandler);
					self.off('adaptationError', adaptHandler);
					var e = new Error('KevScript submission failed (' + err.message + ')');
					item.callback(e);
				};
				adaptHandler = function (err) {
					self.off('error', errHandler);
					self.off('deployed', deployHandler);
					var e = new Error('KevScript submission failed (' + err.message + ')');
					item.callback(e);
				};

				self.once('deployed', deployHandler);
				self.once('error', errHandler);
				self.once('adaptationError', adaptHandler);

				self.deploy(model);
			}
		});
	}
};

/**
 *
 * @param model
 * @param callback
 */
KevoreeCore.prototype.checkBootstrapNode = function (deployModel) {
	var self = this;
	return new Promise(function (resolve, reject) {
		if (self.bootstrapper) {
			if (!self.nodeInstance) {
				self.log.debug(self.toString(), 'Start \'' + self.nodeName + '\' bootstrapping...');
				self.bootstrapper.bootstrapNodeType(self.nodeName, deployModel, function (err, AbstractNode) {
					if (err) {
						reject(err);
					} else {
						try {
							var deployNode = deployModel.findNodesByID(self.nodeName);
							var currentNode = self.currentModel.findNodesByID(self.nodeName);

							// create node instance
							self.nodeInstance = new AbstractNode(self, deployNode, self.nodeName);

							// bootstrap node dictionary
							var factory = new kevoree.factory.DefaultKevoreeFactory();
							currentNode.dictionary = factory.createDictionary().withGenerated_KMF_ID('0');
							if (deployNode.typeDefinition.dictionaryType) {
								deployNode.typeDefinition.dictionaryType.attributes.array.forEach(function (attr) {
									if (!attr.fragmentDependant) {
										var param = factory.createValue();
										param.name = attr.name;
										var currVal = deployNode.dictionary.findValuesByID(param.name);
										if (!currVal) {
											param.value = attr.defaultValue;
											currentNode.dictionary.addValues(param);
											self.log.debug(self.toString(), 'Set default node param: ' + param.name + '=' + param.value);
										}
									}
								});
							}
							resolve();
						} catch (err) {
							reject(err);
						}
					}
				});
			} else {
				// bootstrap already done :)
				resolve();
			}
		} else {
			reject(new Error('No bootstrapper given to this core. Did you set one?'));
		}
	});
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

function hash(str) {
	var val = 0;
	if (str.length === 0) {
		return val + '';
	}
	for (var i = 0; i < str.length; i++) {
		var char = str.charCodeAt(i);
		val = ((val<<5) - val) + char;
		val = val & val; // Convert to 32bit integer
	}
	return (val & 0xfffffff) + '';
}

function bindingHash(binding) {
	var hubPath = binding.hub ? binding.hub.path() : 'UNDEFINED';
	var portPath = binding.port ? binding.port.path() : 'UNDEFINED';
	return hash(hubPath + '_' + portPath);
}

function monkeyPatchKMF(proposedModel) {
	proposedModel.mBindings.array.forEach(function (possibleBinding) {
		possibleBinding.generated_KMF_ID = bindingHash(possibleBinding);
	});
}

/**
 *
 * @type {KevoreeCore}
 */
module.exports = KevoreeCore;
