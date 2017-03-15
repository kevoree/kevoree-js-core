// Wraps adaptation commands into Promises
// cmd => { type: string, path: string, execute: Promise, undo: Promise }
module.exports = function promisify(adaptations) {
	return adaptations
		.map(function (cmd) {
			return {
				type: cmd.toString(),
				path: cmd.modelElement.path(),
				execute: function () {
					return new Promise(function (resolve, reject) {
						cmd.execute(function (err) {
							if (err) {
								reject(err);
							} else {
								resolve();
							}
						});
					});
				},
				undo: function () {
					return new Promise(function (resolve, reject) {
						cmd.undo(function (err) {
							if (err) {
								reject(err);
							} else {
								resolve();
							}
						});
					});
				}
			};
		});
};
