var os = require('os');
var assert = require('assert');
var KevScript = require('kevoree-kevscript');
var Logger = require('kevoree-commons/lib/Logger');
var TinyConf = require('tiny-conf');
var KevoreeCore = require('../../kevoree-core');
var readModel = require('./util/read-model');

function getKLogger() {
	var kLogger = new Logger('CoreTest');
	kLogger.setLevel('DEBUG');
	kLogger.setLevel = function () {};
	return kLogger;
}

describe('Kevoree Core', function () {

	var logger;
	var core;

	before('init', function () {
		function noop() {}
		logger = process.env.DEBUG ? getKLogger() : {
			info: noop,
			debug: noop,
			warn: noop,
			error: noop,
			setLevel: noop,
			setFilter: noop
		};
		TinyConf.set('registry', {
			host: 'registry.kevoree.org',
			port: 443,
			ssl: true
		});
	});

	beforeEach('initialize core', function () {
		core = new KevoreeCore(new KevScript(logger), os.tmpdir(), logger);
		core.setBootstrapper({
			bootstrapNodeType: function (nodeName, model, callback) {
				var node = model.findNodesByID(nodeName);
				if (node) {
					var meta = node.typeDefinition.select('deployUnits[]/filters[name=platform,value=js]');
					if (meta.size() > 0) {
						this.resolve(meta.get(0).eContainer(), false, callback);
					} else {
						callback(new Error('No DeployUnit found for \'' + nodeName + '\' that matches the \'js\' platform'));
					}
				} else {
					callback(new Error('Unable to find \'' + nodeName + '\' in the given model.'));
				}
			},
			bootstrap: function (du, forceInstall, callback) {
				this.resolve(du, forceInstall, callback);
			},
			resolve: function (du, forceInstall, callback) {
				var error;
				var Type;
				try {
					Type = require(du.name);
				} catch (err) {
					error = err;
				}

				if (!error) {
					callback(null, Type);
				} else {
					// try locally (do get module from test folder)
					error = null;
					try {
						Type = require('../fixtures/module/' + du.name);
					} catch (err) {
						error = err;
					}

					if (!error) {
						callback(null, Type);
					} else {
						callback(error);
					}
				}
			},
			uninstall: function (du, callback) {
				callback();
			}
		});

		core.start('node0');
		assert.equal(core.nodeName, 'node0');
		var node = core.currentModel.findNodesByID('node0');
		assert.equal(node.name, 'node0');
		assert.equal(node.started, false);
	});

	it('should start node instance', function (done) {
		this.slow(200);
		var model = readModel('simple.json');
		core.deploy(model, function (err) {
			setTimeout(function () {
				if (err) {
					done(err);
				} else {
					assert.ok(core.nodeInstance);
					assert.equal(core.nodeInstance.name, 'node0');
					assert.equal(core.nodeInstance.started, true);
					done();
				}
			});
		});
	});

	it('should stop when deploying unknown component on firstBoot', function (done) {
		this.slow(200);
		var model = readModel('unknown-comp.json');
		core.deploy(model, function (err) {
			setTimeout(function () {
				if (err) {
					done();
				} else {
					done(new Error('Should have errored'));
				}
			});
		});
	});

	it('should stop when bootstrap failed on firstBoot', function (done) {
		this.slow(300);
		var model = readModel('unknown-du.json');
		core.deploy(model, function (err) {
			setTimeout(function () {
				if (err) {
					done();
				} else {
					done(new Error('Should have errored'));
				}
			});
		});
	});
	
	it('should rollback when deploying erroneous component after firstBoot', function (done) {
		this.slow(400);
		var simpleModel = readModel('simple.json');
		var unknownCompModel = readModel('erroneous-comp.json');
		core.deploy(simpleModel, function (err) {
			if (err) {
				done(err);
			} else {
				core.once('rollbackSucceed', function () {
					setTimeout(function () {
						assert.equal(Object.keys(core.nodeInstance.adaptationEngine.modelObjMapper.map).length, 1);
						done();
					});
				});
				core.deploy(unknownCompModel);
			}
		});
	});

	afterEach('stop core', function (done) {
		core.stop(done);
	});
});
