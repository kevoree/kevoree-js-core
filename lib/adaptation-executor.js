var promisify = require('./promisify');

module.exports = function adaptationExecutor(core, model, adaptations, callback) {
	var start = new Date().getTime();
	var executedCmds = [];

	return promisify(adaptations)
		.reduce(function (previousCmd, next, index, adaptations) {
			return previousCmd.then(function () {
				if (index > 0) {
					executedCmds.unshift(adaptations[index - 1]);
				}
				return next.execute();
			}).catch(function (err) {
				if (core.stopping) {
					// if core is stopping, just log error and keep on adapting
					core.log.error(core.toString(), 'Adaptation error while stopping core...\n' + err.stack);
				} else {
					throw err;
				}
			});
		}, Promise.resolve())
		.then(function () {
			// === All adaptations executed successfully :)
			// set current model
			core.currentModel = model;
			// reset deployModel
			core.deployModel = null;
			// adaptations succeed : woot
			core.log.info(core.toString(), (core.stopping ? 'Stop model' : 'Model') + ' deployed successfully: ' + adaptations.length + ' adaptations (' + (new Date().getTime() - start) + 'ms)');
			// all good :)
			// process script queue if any
			core.processScriptQueue();
			core.firstBoot = false;
			try {
				core.emit('deployed');
				callback();
			} catch (err) {
				core.log.error(core.toString(), 'Error catched\n' + err.stack);
			}
		})
		.catch(function (err) {
			// === At least one adaptation failed
			err.message = 'Something went wrong while executing adaptations.\n' + err.message;
			core.log.error(core.toString(), err.stack);

			if (core.firstBoot) {
				// === If adaptations failed on startup then it is bad => exit
				core.log.warn(core.toString(), 'Shutting down Kevoree because bootstrap failed...');
				core.deployModel = null;
				core.stop();
				process.nextTick(function () {
					callback(err);
				});
			} else {
				// === If not firstBoot => try to rollback...
				executedCmds
					.reduce(function (previous, next) {
						return previous.then(function () {
							return next.undo();
						});
					}, Promise.resolve())
					.then(function () {
						// === Rollback success :)
						core.log.info(core.toString(), 'Rollback succeed: ' + executedCmds.length + ' adaptations (' + (new Date().getTime() - start) + 'ms)');
						core.deployModel = null;
						core.emit('rollbackSucceed');
						callback();
					})
					.catch(function (err) {
						// === Rollback failed => cannot recover from this...
						err.message = 'Something went wrong while rollbacking. Process will exit.\n' + err.message;
						core.log.error(core.toString(), err.stack);
						// stop everything :(
						core.deployModel = null;
						core.stop();
						callback(err);
						core.emit('error', err);
					});
			}
		});
};
