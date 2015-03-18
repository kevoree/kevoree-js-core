require=(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (process){
/*!
 * async
 * https://github.com/caolan/async
 *
 * Copyright 2010-2014 Caolan McMahon
 * Released under the MIT license
 */
/*jshint onevar: false, indent:4 */
/*global setImmediate: false, setTimeout: false, console: false */
(function () {

    var async = {};

    // global on the server, window in the browser
    var root, previous_async;

    root = this;
    if (root != null) {
      previous_async = root.async;
    }

    async.noConflict = function () {
        root.async = previous_async;
        return async;
    };

    function only_once(fn) {
        var called = false;
        return function() {
            if (called) throw new Error("Callback was already called.");
            called = true;
            fn.apply(root, arguments);
        }
    }

    //// cross-browser compatiblity functions ////

    var _toString = Object.prototype.toString;

    var _isArray = Array.isArray || function (obj) {
        return _toString.call(obj) === '[object Array]';
    };

    var _each = function (arr, iterator) {
        if (arr.forEach) {
            return arr.forEach(iterator);
        }
        for (var i = 0; i < arr.length; i += 1) {
            iterator(arr[i], i, arr);
        }
    };

    var _map = function (arr, iterator) {
        if (arr.map) {
            return arr.map(iterator);
        }
        var results = [];
        _each(arr, function (x, i, a) {
            results.push(iterator(x, i, a));
        });
        return results;
    };

    var _reduce = function (arr, iterator, memo) {
        if (arr.reduce) {
            return arr.reduce(iterator, memo);
        }
        _each(arr, function (x, i, a) {
            memo = iterator(memo, x, i, a);
        });
        return memo;
    };

    var _keys = function (obj) {
        if (Object.keys) {
            return Object.keys(obj);
        }
        var keys = [];
        for (var k in obj) {
            if (obj.hasOwnProperty(k)) {
                keys.push(k);
            }
        }
        return keys;
    };

    //// exported async module functions ////

    //// nextTick implementation with browser-compatible fallback ////
    if (typeof process === 'undefined' || !(process.nextTick)) {
        if (typeof setImmediate === 'function') {
            async.nextTick = function (fn) {
                // not a direct alias for IE10 compatibility
                setImmediate(fn);
            };
            async.setImmediate = async.nextTick;
        }
        else {
            async.nextTick = function (fn) {
                setTimeout(fn, 0);
            };
            async.setImmediate = async.nextTick;
        }
    }
    else {
        async.nextTick = process.nextTick;
        if (typeof setImmediate !== 'undefined') {
            async.setImmediate = function (fn) {
              // not a direct alias for IE10 compatibility
              setImmediate(fn);
            };
        }
        else {
            async.setImmediate = async.nextTick;
        }
    }

    async.each = function (arr, iterator, callback) {
        callback = callback || function () {};
        if (!arr.length) {
            return callback();
        }
        var completed = 0;
        _each(arr, function (x) {
            iterator(x, only_once(done) );
        });
        function done(err) {
          if (err) {
              callback(err);
              callback = function () {};
          }
          else {
              completed += 1;
              if (completed >= arr.length) {
                  callback();
              }
          }
        }
    };
    async.forEach = async.each;

    async.eachSeries = function (arr, iterator, callback) {
        callback = callback || function () {};
        if (!arr.length) {
            return callback();
        }
        var completed = 0;
        var iterate = function () {
            iterator(arr[completed], function (err) {
                if (err) {
                    callback(err);
                    callback = function () {};
                }
                else {
                    completed += 1;
                    if (completed >= arr.length) {
                        callback();
                    }
                    else {
                        iterate();
                    }
                }
            });
        };
        iterate();
    };
    async.forEachSeries = async.eachSeries;

    async.eachLimit = function (arr, limit, iterator, callback) {
        var fn = _eachLimit(limit);
        fn.apply(null, [arr, iterator, callback]);
    };
    async.forEachLimit = async.eachLimit;

    var _eachLimit = function (limit) {

        return function (arr, iterator, callback) {
            callback = callback || function () {};
            if (!arr.length || limit <= 0) {
                return callback();
            }
            var completed = 0;
            var started = 0;
            var running = 0;

            (function replenish () {
                if (completed >= arr.length) {
                    return callback();
                }

                while (running < limit && started < arr.length) {
                    started += 1;
                    running += 1;
                    iterator(arr[started - 1], function (err) {
                        if (err) {
                            callback(err);
                            callback = function () {};
                        }
                        else {
                            completed += 1;
                            running -= 1;
                            if (completed >= arr.length) {
                                callback();
                            }
                            else {
                                replenish();
                            }
                        }
                    });
                }
            })();
        };
    };


    var doParallel = function (fn) {
        return function () {
            var args = Array.prototype.slice.call(arguments);
            return fn.apply(null, [async.each].concat(args));
        };
    };
    var doParallelLimit = function(limit, fn) {
        return function () {
            var args = Array.prototype.slice.call(arguments);
            return fn.apply(null, [_eachLimit(limit)].concat(args));
        };
    };
    var doSeries = function (fn) {
        return function () {
            var args = Array.prototype.slice.call(arguments);
            return fn.apply(null, [async.eachSeries].concat(args));
        };
    };


    var _asyncMap = function (eachfn, arr, iterator, callback) {
        arr = _map(arr, function (x, i) {
            return {index: i, value: x};
        });
        if (!callback) {
            eachfn(arr, function (x, callback) {
                iterator(x.value, function (err) {
                    callback(err);
                });
            });
        } else {
            var results = [];
            eachfn(arr, function (x, callback) {
                iterator(x.value, function (err, v) {
                    results[x.index] = v;
                    callback(err);
                });
            }, function (err) {
                callback(err, results);
            });
        }
    };
    async.map = doParallel(_asyncMap);
    async.mapSeries = doSeries(_asyncMap);
    async.mapLimit = function (arr, limit, iterator, callback) {
        return _mapLimit(limit)(arr, iterator, callback);
    };

    var _mapLimit = function(limit) {
        return doParallelLimit(limit, _asyncMap);
    };

    // reduce only has a series version, as doing reduce in parallel won't
    // work in many situations.
    async.reduce = function (arr, memo, iterator, callback) {
        async.eachSeries(arr, function (x, callback) {
            iterator(memo, x, function (err, v) {
                memo = v;
                callback(err);
            });
        }, function (err) {
            callback(err, memo);
        });
    };
    // inject alias
    async.inject = async.reduce;
    // foldl alias
    async.foldl = async.reduce;

    async.reduceRight = function (arr, memo, iterator, callback) {
        var reversed = _map(arr, function (x) {
            return x;
        }).reverse();
        async.reduce(reversed, memo, iterator, callback);
    };
    // foldr alias
    async.foldr = async.reduceRight;

    var _filter = function (eachfn, arr, iterator, callback) {
        var results = [];
        arr = _map(arr, function (x, i) {
            return {index: i, value: x};
        });
        eachfn(arr, function (x, callback) {
            iterator(x.value, function (v) {
                if (v) {
                    results.push(x);
                }
                callback();
            });
        }, function (err) {
            callback(_map(results.sort(function (a, b) {
                return a.index - b.index;
            }), function (x) {
                return x.value;
            }));
        });
    };
    async.filter = doParallel(_filter);
    async.filterSeries = doSeries(_filter);
    // select alias
    async.select = async.filter;
    async.selectSeries = async.filterSeries;

    var _reject = function (eachfn, arr, iterator, callback) {
        var results = [];
        arr = _map(arr, function (x, i) {
            return {index: i, value: x};
        });
        eachfn(arr, function (x, callback) {
            iterator(x.value, function (v) {
                if (!v) {
                    results.push(x);
                }
                callback();
            });
        }, function (err) {
            callback(_map(results.sort(function (a, b) {
                return a.index - b.index;
            }), function (x) {
                return x.value;
            }));
        });
    };
    async.reject = doParallel(_reject);
    async.rejectSeries = doSeries(_reject);

    var _detect = function (eachfn, arr, iterator, main_callback) {
        eachfn(arr, function (x, callback) {
            iterator(x, function (result) {
                if (result) {
                    main_callback(x);
                    main_callback = function () {};
                }
                else {
                    callback();
                }
            });
        }, function (err) {
            main_callback();
        });
    };
    async.detect = doParallel(_detect);
    async.detectSeries = doSeries(_detect);

    async.some = function (arr, iterator, main_callback) {
        async.each(arr, function (x, callback) {
            iterator(x, function (v) {
                if (v) {
                    main_callback(true);
                    main_callback = function () {};
                }
                callback();
            });
        }, function (err) {
            main_callback(false);
        });
    };
    // any alias
    async.any = async.some;

    async.every = function (arr, iterator, main_callback) {
        async.each(arr, function (x, callback) {
            iterator(x, function (v) {
                if (!v) {
                    main_callback(false);
                    main_callback = function () {};
                }
                callback();
            });
        }, function (err) {
            main_callback(true);
        });
    };
    // all alias
    async.all = async.every;

    async.sortBy = function (arr, iterator, callback) {
        async.map(arr, function (x, callback) {
            iterator(x, function (err, criteria) {
                if (err) {
                    callback(err);
                }
                else {
                    callback(null, {value: x, criteria: criteria});
                }
            });
        }, function (err, results) {
            if (err) {
                return callback(err);
            }
            else {
                var fn = function (left, right) {
                    var a = left.criteria, b = right.criteria;
                    return a < b ? -1 : a > b ? 1 : 0;
                };
                callback(null, _map(results.sort(fn), function (x) {
                    return x.value;
                }));
            }
        });
    };

    async.auto = function (tasks, callback) {
        callback = callback || function () {};
        var keys = _keys(tasks);
        var remainingTasks = keys.length
        if (!remainingTasks) {
            return callback();
        }

        var results = {};

        var listeners = [];
        var addListener = function (fn) {
            listeners.unshift(fn);
        };
        var removeListener = function (fn) {
            for (var i = 0; i < listeners.length; i += 1) {
                if (listeners[i] === fn) {
                    listeners.splice(i, 1);
                    return;
                }
            }
        };
        var taskComplete = function () {
            remainingTasks--
            _each(listeners.slice(0), function (fn) {
                fn();
            });
        };

        addListener(function () {
            if (!remainingTasks) {
                var theCallback = callback;
                // prevent final callback from calling itself if it errors
                callback = function () {};

                theCallback(null, results);
            }
        });

        _each(keys, function (k) {
            var task = _isArray(tasks[k]) ? tasks[k]: [tasks[k]];
            var taskCallback = function (err) {
                var args = Array.prototype.slice.call(arguments, 1);
                if (args.length <= 1) {
                    args = args[0];
                }
                if (err) {
                    var safeResults = {};
                    _each(_keys(results), function(rkey) {
                        safeResults[rkey] = results[rkey];
                    });
                    safeResults[k] = args;
                    callback(err, safeResults);
                    // stop subsequent errors hitting callback multiple times
                    callback = function () {};
                }
                else {
                    results[k] = args;
                    async.setImmediate(taskComplete);
                }
            };
            var requires = task.slice(0, Math.abs(task.length - 1)) || [];
            var ready = function () {
                return _reduce(requires, function (a, x) {
                    return (a && results.hasOwnProperty(x));
                }, true) && !results.hasOwnProperty(k);
            };
            if (ready()) {
                task[task.length - 1](taskCallback, results);
            }
            else {
                var listener = function () {
                    if (ready()) {
                        removeListener(listener);
                        task[task.length - 1](taskCallback, results);
                    }
                };
                addListener(listener);
            }
        });
    };

    async.retry = function(times, task, callback) {
        var DEFAULT_TIMES = 5;
        var attempts = [];
        // Use defaults if times not passed
        if (typeof times === 'function') {
            callback = task;
            task = times;
            times = DEFAULT_TIMES;
        }
        // Make sure times is a number
        times = parseInt(times, 10) || DEFAULT_TIMES;
        var wrappedTask = function(wrappedCallback, wrappedResults) {
            var retryAttempt = function(task, finalAttempt) {
                return function(seriesCallback) {
                    task(function(err, result){
                        seriesCallback(!err || finalAttempt, {err: err, result: result});
                    }, wrappedResults);
                };
            };
            while (times) {
                attempts.push(retryAttempt(task, !(times-=1)));
            }
            async.series(attempts, function(done, data){
                data = data[data.length - 1];
                (wrappedCallback || callback)(data.err, data.result);
            });
        }
        // If a callback is passed, run this as a controll flow
        return callback ? wrappedTask() : wrappedTask
    };

    async.waterfall = function (tasks, callback) {
        callback = callback || function () {};
        if (!_isArray(tasks)) {
          var err = new Error('First argument to waterfall must be an array of functions');
          return callback(err);
        }
        if (!tasks.length) {
            return callback();
        }
        var wrapIterator = function (iterator) {
            return function (err) {
                if (err) {
                    callback.apply(null, arguments);
                    callback = function () {};
                }
                else {
                    var args = Array.prototype.slice.call(arguments, 1);
                    var next = iterator.next();
                    if (next) {
                        args.push(wrapIterator(next));
                    }
                    else {
                        args.push(callback);
                    }
                    async.setImmediate(function () {
                        iterator.apply(null, args);
                    });
                }
            };
        };
        wrapIterator(async.iterator(tasks))();
    };

    var _parallel = function(eachfn, tasks, callback) {
        callback = callback || function () {};
        if (_isArray(tasks)) {
            eachfn.map(tasks, function (fn, callback) {
                if (fn) {
                    fn(function (err) {
                        var args = Array.prototype.slice.call(arguments, 1);
                        if (args.length <= 1) {
                            args = args[0];
                        }
                        callback.call(null, err, args);
                    });
                }
            }, callback);
        }
        else {
            var results = {};
            eachfn.each(_keys(tasks), function (k, callback) {
                tasks[k](function (err) {
                    var args = Array.prototype.slice.call(arguments, 1);
                    if (args.length <= 1) {
                        args = args[0];
                    }
                    results[k] = args;
                    callback(err);
                });
            }, function (err) {
                callback(err, results);
            });
        }
    };

    async.parallel = function (tasks, callback) {
        _parallel({ map: async.map, each: async.each }, tasks, callback);
    };

    async.parallelLimit = function(tasks, limit, callback) {
        _parallel({ map: _mapLimit(limit), each: _eachLimit(limit) }, tasks, callback);
    };

    async.series = function (tasks, callback) {
        callback = callback || function () {};
        if (_isArray(tasks)) {
            async.mapSeries(tasks, function (fn, callback) {
                if (fn) {
                    fn(function (err) {
                        var args = Array.prototype.slice.call(arguments, 1);
                        if (args.length <= 1) {
                            args = args[0];
                        }
                        callback.call(null, err, args);
                    });
                }
            }, callback);
        }
        else {
            var results = {};
            async.eachSeries(_keys(tasks), function (k, callback) {
                tasks[k](function (err) {
                    var args = Array.prototype.slice.call(arguments, 1);
                    if (args.length <= 1) {
                        args = args[0];
                    }
                    results[k] = args;
                    callback(err);
                });
            }, function (err) {
                callback(err, results);
            });
        }
    };

    async.iterator = function (tasks) {
        var makeCallback = function (index) {
            var fn = function () {
                if (tasks.length) {
                    tasks[index].apply(null, arguments);
                }
                return fn.next();
            };
            fn.next = function () {
                return (index < tasks.length - 1) ? makeCallback(index + 1): null;
            };
            return fn;
        };
        return makeCallback(0);
    };

    async.apply = function (fn) {
        var args = Array.prototype.slice.call(arguments, 1);
        return function () {
            return fn.apply(
                null, args.concat(Array.prototype.slice.call(arguments))
            );
        };
    };

    var _concat = function (eachfn, arr, fn, callback) {
        var r = [];
        eachfn(arr, function (x, cb) {
            fn(x, function (err, y) {
                r = r.concat(y || []);
                cb(err);
            });
        }, function (err) {
            callback(err, r);
        });
    };
    async.concat = doParallel(_concat);
    async.concatSeries = doSeries(_concat);

    async.whilst = function (test, iterator, callback) {
        if (test()) {
            iterator(function (err) {
                if (err) {
                    return callback(err);
                }
                async.whilst(test, iterator, callback);
            });
        }
        else {
            callback();
        }
    };

    async.doWhilst = function (iterator, test, callback) {
        iterator(function (err) {
            if (err) {
                return callback(err);
            }
            var args = Array.prototype.slice.call(arguments, 1);
            if (test.apply(null, args)) {
                async.doWhilst(iterator, test, callback);
            }
            else {
                callback();
            }
        });
    };

    async.until = function (test, iterator, callback) {
        if (!test()) {
            iterator(function (err) {
                if (err) {
                    return callback(err);
                }
                async.until(test, iterator, callback);
            });
        }
        else {
            callback();
        }
    };

    async.doUntil = function (iterator, test, callback) {
        iterator(function (err) {
            if (err) {
                return callback(err);
            }
            var args = Array.prototype.slice.call(arguments, 1);
            if (!test.apply(null, args)) {
                async.doUntil(iterator, test, callback);
            }
            else {
                callback();
            }
        });
    };

    async.queue = function (worker, concurrency) {
        if (concurrency === undefined) {
            concurrency = 1;
        }
        function _insert(q, data, pos, callback) {
          if (!q.started){
            q.started = true;
          }
          if (!_isArray(data)) {
              data = [data];
          }
          if(data.length == 0) {
             // call drain immediately if there are no tasks
             return async.setImmediate(function() {
                 if (q.drain) {
                     q.drain();
                 }
             });
          }
          _each(data, function(task) {
              var item = {
                  data: task,
                  callback: typeof callback === 'function' ? callback : null
              };

              if (pos) {
                q.tasks.unshift(item);
              } else {
                q.tasks.push(item);
              }

              if (q.saturated && q.tasks.length === q.concurrency) {
                  q.saturated();
              }
              async.setImmediate(q.process);
          });
        }

        var workers = 0;
        var q = {
            tasks: [],
            concurrency: concurrency,
            saturated: null,
            empty: null,
            drain: null,
            started: false,
            paused: false,
            push: function (data, callback) {
              _insert(q, data, false, callback);
            },
            kill: function () {
              q.drain = null;
              q.tasks = [];
            },
            unshift: function (data, callback) {
              _insert(q, data, true, callback);
            },
            process: function () {
                if (!q.paused && workers < q.concurrency && q.tasks.length) {
                    var task = q.tasks.shift();
                    if (q.empty && q.tasks.length === 0) {
                        q.empty();
                    }
                    workers += 1;
                    var next = function () {
                        workers -= 1;
                        if (task.callback) {
                            task.callback.apply(task, arguments);
                        }
                        if (q.drain && q.tasks.length + workers === 0) {
                            q.drain();
                        }
                        q.process();
                    };
                    var cb = only_once(next);
                    worker(task.data, cb);
                }
            },
            length: function () {
                return q.tasks.length;
            },
            running: function () {
                return workers;
            },
            idle: function() {
                return q.tasks.length + workers === 0;
            },
            pause: function () {
                if (q.paused === true) { return; }
                q.paused = true;
                q.process();
            },
            resume: function () {
                if (q.paused === false) { return; }
                q.paused = false;
                q.process();
            }
        };
        return q;
    };
    
    async.priorityQueue = function (worker, concurrency) {
        
        function _compareTasks(a, b){
          return a.priority - b.priority;
        };
        
        function _binarySearch(sequence, item, compare) {
          var beg = -1,
              end = sequence.length - 1;
          while (beg < end) {
            var mid = beg + ((end - beg + 1) >>> 1);
            if (compare(item, sequence[mid]) >= 0) {
              beg = mid;
            } else {
              end = mid - 1;
            }
          }
          return beg;
        }
        
        function _insert(q, data, priority, callback) {
          if (!q.started){
            q.started = true;
          }
          if (!_isArray(data)) {
              data = [data];
          }
          if(data.length == 0) {
             // call drain immediately if there are no tasks
             return async.setImmediate(function() {
                 if (q.drain) {
                     q.drain();
                 }
             });
          }
          _each(data, function(task) {
              var item = {
                  data: task,
                  priority: priority,
                  callback: typeof callback === 'function' ? callback : null
              };
              
              q.tasks.splice(_binarySearch(q.tasks, item, _compareTasks) + 1, 0, item);

              if (q.saturated && q.tasks.length === q.concurrency) {
                  q.saturated();
              }
              async.setImmediate(q.process);
          });
        }
        
        // Start with a normal queue
        var q = async.queue(worker, concurrency);
        
        // Override push to accept second parameter representing priority
        q.push = function (data, priority, callback) {
          _insert(q, data, priority, callback);
        };
        
        // Remove unshift function
        delete q.unshift;

        return q;
    };

    async.cargo = function (worker, payload) {
        var working     = false,
            tasks       = [];

        var cargo = {
            tasks: tasks,
            payload: payload,
            saturated: null,
            empty: null,
            drain: null,
            drained: true,
            push: function (data, callback) {
                if (!_isArray(data)) {
                    data = [data];
                }
                _each(data, function(task) {
                    tasks.push({
                        data: task,
                        callback: typeof callback === 'function' ? callback : null
                    });
                    cargo.drained = false;
                    if (cargo.saturated && tasks.length === payload) {
                        cargo.saturated();
                    }
                });
                async.setImmediate(cargo.process);
            },
            process: function process() {
                if (working) return;
                if (tasks.length === 0) {
                    if(cargo.drain && !cargo.drained) cargo.drain();
                    cargo.drained = true;
                    return;
                }

                var ts = typeof payload === 'number'
                            ? tasks.splice(0, payload)
                            : tasks.splice(0, tasks.length);

                var ds = _map(ts, function (task) {
                    return task.data;
                });

                if(cargo.empty) cargo.empty();
                working = true;
                worker(ds, function () {
                    working = false;

                    var args = arguments;
                    _each(ts, function (data) {
                        if (data.callback) {
                            data.callback.apply(null, args);
                        }
                    });

                    process();
                });
            },
            length: function () {
                return tasks.length;
            },
            running: function () {
                return working;
            }
        };
        return cargo;
    };

    var _console_fn = function (name) {
        return function (fn) {
            var args = Array.prototype.slice.call(arguments, 1);
            fn.apply(null, args.concat([function (err) {
                var args = Array.prototype.slice.call(arguments, 1);
                if (typeof console !== 'undefined') {
                    if (err) {
                        if (console.error) {
                            console.error(err);
                        }
                    }
                    else if (console[name]) {
                        _each(args, function (x) {
                            console[name](x);
                        });
                    }
                }
            }]));
        };
    };
    async.log = _console_fn('log');
    async.dir = _console_fn('dir');
    /*async.info = _console_fn('info');
    async.warn = _console_fn('warn');
    async.error = _console_fn('error');*/

    async.memoize = function (fn, hasher) {
        var memo = {};
        var queues = {};
        hasher = hasher || function (x) {
            return x;
        };
        var memoized = function () {
            var args = Array.prototype.slice.call(arguments);
            var callback = args.pop();
            var key = hasher.apply(null, args);
            if (key in memo) {
                async.nextTick(function () {
                    callback.apply(null, memo[key]);
                });
            }
            else if (key in queues) {
                queues[key].push(callback);
            }
            else {
                queues[key] = [callback];
                fn.apply(null, args.concat([function () {
                    memo[key] = arguments;
                    var q = queues[key];
                    delete queues[key];
                    for (var i = 0, l = q.length; i < l; i++) {
                      q[i].apply(null, arguments);
                    }
                }]));
            }
        };
        memoized.memo = memo;
        memoized.unmemoized = fn;
        return memoized;
    };

    async.unmemoize = function (fn) {
      return function () {
        return (fn.unmemoized || fn).apply(null, arguments);
      };
    };

    async.times = function (count, iterator, callback) {
        var counter = [];
        for (var i = 0; i < count; i++) {
            counter.push(i);
        }
        return async.map(counter, iterator, callback);
    };

    async.timesSeries = function (count, iterator, callback) {
        var counter = [];
        for (var i = 0; i < count; i++) {
            counter.push(i);
        }
        return async.mapSeries(counter, iterator, callback);
    };

    async.seq = function (/* functions... */) {
        var fns = arguments;
        return function () {
            var that = this;
            var args = Array.prototype.slice.call(arguments);
            var callback = args.pop();
            async.reduce(fns, args, function (newargs, fn, cb) {
                fn.apply(that, newargs.concat([function () {
                    var err = arguments[0];
                    var nextargs = Array.prototype.slice.call(arguments, 1);
                    cb(err, nextargs);
                }]))
            },
            function (err, results) {
                callback.apply(that, [err].concat(results));
            });
        };
    };

    async.compose = function (/* functions... */) {
      return async.seq.apply(null, Array.prototype.reverse.call(arguments));
    };

    var _applyEach = function (eachfn, fns /*args...*/) {
        var go = function () {
            var that = this;
            var args = Array.prototype.slice.call(arguments);
            var callback = args.pop();
            return eachfn(fns, function (fn, cb) {
                fn.apply(that, args.concat([cb]));
            },
            callback);
        };
        if (arguments.length > 2) {
            var args = Array.prototype.slice.call(arguments, 2);
            return go.apply(this, args);
        }
        else {
            return go;
        }
    };
    async.applyEach = doParallel(_applyEach);
    async.applyEachSeries = doSeries(_applyEach);

    async.forever = function (fn, callback) {
        function next(err) {
            if (err) {
                if (callback) {
                    return callback(err);
                }
                throw err;
            }
            fn(next);
        }
        next();
    };

    // Node.js
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = async;
    }
    // AMD / RequireJS
    else if (typeof define !== 'undefined' && define.amd) {
        define([], function () {
            return async;
        });
    }
    // included directly via <script> tag
    else {
        root.async = async;
    }

}());

}).call(this,require('_process'))
},{"_process":4}],2:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      }
      throw TypeError('Uncaught, unspecified "error" event.');
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],3:[function(require,module,exports){
exports.endianness = function () { return 'LE' };

exports.hostname = function () {
    if (typeof location !== 'undefined') {
        return location.hostname
    }
    else return '';
};

exports.loadavg = function () { return [] };

exports.uptime = function () { return 0 };

exports.freemem = function () {
    return Number.MAX_VALUE;
};

exports.totalmem = function () {
    return Number.MAX_VALUE;
};

exports.cpus = function () { return [] };

exports.type = function () { return 'Browser' };

exports.release = function () {
    if (typeof navigator !== 'undefined') {
        return navigator.appVersion;
    }
    return '';
};

exports.networkInterfaces
= exports.getNetworkInterfaces
= function () { return {} };

exports.arch = function () { return 'javascript' };

exports.platform = function () { return 'browser' };

exports.tmpdir = exports.tmpDir = function () {
    return '/tmp';
};

exports.EOL = '\n';

},{}],4:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;

function drainQueue() {
    if (draining) {
        return;
    }
    draining = true;
    var currentQueue;
    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        var i = -1;
        while (++i < len) {
            currentQueue[i]();
        }
        len = queue.length;
    }
    draining = false;
}
process.nextTick = function (fun) {
    queue.push(fun);
    if (!draining) {
        setTimeout(drainQueue, 0);
    }
};

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],5:[function(require,module,exports){
module.exports.Resolver      = require('./lib/Resolver');
module.exports.Bootstrapper  = require('./lib/Bootstrapper');
module.exports.KevoreeLogger = require('./lib/KevoreeLogger');
module.exports.FileSystem    = require('./lib/FileSystem');
},{"./lib/Bootstrapper":6,"./lib/FileSystem":7,"./lib/KevoreeLogger":8,"./lib/Resolver":9}],6:[function(require,module,exports){
var Class = require('pseudoclass');

/**
 * Bootstrapper API
 * @type {Bootstrapper}
 */
var Bootstrapper = Class({
    toString: 'Bootstrapper',

    /**
     *
     * @param {KevoreeLogger} logger
     * @param {Resolver} resolver
     */
    construct: function (logger, resolver) {
        if (logger) {
            this.log = logger;
            if (resolver) {
                this.resolver = resolver;
            } else {
                throw new Error('No resolver given to '+this.toString()+' (you need to give a proper Resolver to your Bootstrapper)');
            }
        } else {
            throw new Error('No logger given to '+this.toString()+' (you need to give a proper KevoreeLogger to your Bootstrapper)');
        }
    },

    /**
     *
     * @param nodeName
     * @param model
     * @param callback
     */
    bootstrapNodeType: function (nodeName, model, callback) {
        callback = callback || function () {};

        var node = model.findNodesByID(nodeName);
        if (node) {
            var meta = node.typeDefinition.select('deployUnits[name=*]/filters[name=platform,value=javascript]');
            if (meta.size() > 0) {
                this.bootstrap(meta.get(0).eContainer(), false, callback);
            } else {
                callback(new Error("No DeployUnit found for '"+nodeName+"' that matches the 'javascript' platform"));
            }
        } else {
            return callback(new Error("Unable to find '"+nodeName+"' in the given model."));
        }
    },

    /**
     *
     * @param deployUnit
     * @param forceInstall [optional] boolean to indicate whether or not we should force re-installation
     * @param callback                function(Error, Clazz, ContainerRoot)
     */
    bootstrap: function (deployUnit, forceInstall, callback) {
        if (!callback) {
            // "forceInstall" parameter is not specified (optional)
            callback = forceInstall;
            forceInstall = false;
        }

        // --- Resolvers callback
        var bootstrapper = this;
        this.resolver.resolve(deployUnit, forceInstall, function (err, EntityClass, model) {
            if (err) {
                bootstrapper.log.error(bootstrapper.toString(), err.stack);
                return callback(new Error("'"+deployUnit.name+"' bootstrap failed!"));
            }

            // install success
            callback(null, EntityClass, model);
        });
    },

    /**
     *
     * @param deployUnit
     * @param callback
     */
    uninstall: function (deployUnit, callback) {
        var bootstrapper = this;
        this.resolver.uninstall(deployUnit, function (err) {
            if (err) {
                bootstrapper.log.error(bootstrapper.toString(), err.stack);
                callback(new Error("'"+deployUnit.name+"' uninstall failed!"));
                return;
            }

            // uninstall success
            callback(null);
        });
    }
});

module.exports = Bootstrapper;
},{"pseudoclass":14}],7:[function(require,module,exports){
var Class = require('pseudoclass');

var FileSystem = Class({
    toString: 'FileSystem',

    getFileSystem: function (size, callback) {
        if (document) {
            getBrowserFileSystem(this, size, callback);
        } else {
            console.error('Kevoree FileSystem API only handles Browser FS for now.');
        }
    }
});

var getBrowserFileSystem = function getBrowserFileSystem(fsapi, size, callback) {
    window.requestFileSystem = window.requestFileSystem || window.webkitRequestFileSystem;
    navigator.persistentStorage = navigator.persistentStorage || navigator.webkitPersistentStorage;

    if (window.requestFileSystem && navigator.persistentStorage) {

        var successHandler = function successHandler(grantedSize) {
            window.requestFileSystem(window.PERSISTENT, grantedSize, function (fs) {
                callback.call(fsapi, null, fs);
            });
        };

        var errorHandler = function errorHandler(e) {
            callback.call(fsapi, null);
        };

        navigator.persistentStorage.requestQuota(size, successHandler, errorHandler);
    }
};

module.exports = FileSystem;
},{"pseudoclass":14}],8:[function(require,module,exports){
var Class  = require('pseudoclass'),
    chalk  = require('chalk');

var LEVELS = ['all', 'debug', 'info', 'warn', 'error', 'quiet'];

var chalkInfo       = chalk.grey,
    chalkWarn       = chalk.grey.bgYellow,
    chalkWarnMsg    = chalk.yellow,
    chalkError      = chalk.white.bgRed,
    chalkErrorMsg   = chalk.red,
    chalkDebug      = chalk.cyan;

var KevoreeLogger = Class({
    toString: 'KevoreeLogger',

    construct: function (tag) {
        this.tag = tag;
        this.level = 2;
        this.filter = '';
    },

    info: function (tag, msg) {
        if (this.level <= LEVELS.indexOf('info')) {
            if (typeof(msg) === 'undefined') {
                msg = tag;
                tag = this.tag;
            }

            if (this.filter.length === 0 || (this.filter.length > 0 && tag === this.filter)) {
                console.log(getTime()+'  '+chalkInfo('INFO')+'   '+processTag(tag)+'  '+chalkInfo(msg));
            }
        }
    },

    debug: function (tag, msg) {
        if (this.level <= LEVELS.indexOf('debug')) {
            if (typeof(msg) === 'undefined') {
                msg = tag;
                tag = this.tag;
            }

            if (this.filter.length === 0 || (this.filter.length > 0 && tag === this.filter)) {
                console.log(getTime()+'  '+chalkDebug('DEBUG ')+' '+processTag(tag)+'  '+chalkDebug(msg));
            }
        }
    },

    warn: function (tag, msg) {
        if (this.level <= LEVELS.indexOf('warn')) {
            if (typeof(msg) === 'undefined') {
                msg = tag;
                tag = this.tag;
            }

            if (this.filter.length === 0 || (this.filter.length > 0 && tag === this.filter)) {
                console.warn(getTime()+'  '+chalkWarn('WARN')+'   '+processTag(tag)+'  '+chalkWarnMsg(msg));
            }
        }
    },

    error: function (tag, msg) {
        if (this.level <= LEVELS.indexOf('error')) {
            if (typeof(msg) === 'undefined') {
                msg = tag;
                tag = this.tag;
            }

            if (this.filter.length === 0 || (this.filter.length > 0 && tag === this.filter)) {
                console.error(getTime() + '  ' + chalkError('ERROR') + '  ' + processTag(tag) + '  ' + chalkErrorMsg(msg));
            }
        }
    },

    setLevel: function (level) {
        this.level = level;
        console.log(getTime()+'  '+chalkInfo('ALL ')+'   '+processTag(this.toString())+'  '+chalkInfo('Set logLevel= '+LEVELS[this.level]));
    },

    setFilter: function (filter) {
        this.filter = filter;
        console.log(getTime()+'  '+chalkInfo('ALL ')+'   '+processTag(this.toString())+'  '+chalkInfo('Set logFilter= "'+this.filter+'"'));
    }
});

var processTag = function processTag(tag) {
    if (tag.length >= 15) {
        tag = tag.substr(0, 14)+'.';
    } else {
        var spaces = '';
        for (var i=0; i < 15 - tag.length; i++) spaces += ' ';
        tag += spaces;
    }

    return chalk.magenta(tag);
};

var getTime = function getTime() {
    var time = new Date();
    var hours = (time.getHours().toString().length == 1) ? '0'+time.getHours() : time.getHours();
    var mins = (time.getMinutes().toString().length == 1) ? '0'+time.getMinutes() : time.getMinutes();
    var secs = (time.getSeconds().toString().length == 1) ? '0'+time.getSeconds() : time.getSeconds();
    return chalk.grey(hours+':'+mins+':'+secs);
};


KevoreeLogger.ALL   = LEVELS.indexOf('all');
KevoreeLogger.INFO  = LEVELS.indexOf('info');
KevoreeLogger.DEBUG = LEVELS.indexOf('debug');
KevoreeLogger.WARN  = LEVELS.indexOf('warn');
KevoreeLogger.ERROR = LEVELS.indexOf('error');
KevoreeLogger.QUIET = LEVELS.indexOf('quiet');

module.exports = KevoreeLogger;
},{"chalk":10,"pseudoclass":14}],9:[function(require,module,exports){
var Class = require('pseudoclass'),
    KevoreeLogger = require('./KevoreeLogger');

/**
 * Resolver API
 * @type {Resolver}
 */
var Resolver = Class({
    toString: 'Resolver',

    construct: function (modulesPath, logger) {
        this.modulesPath = modulesPath || '';
        this.log = logger || new KevoreeLogger(this.toString());
        this.repositories = [];
    },

    /**
     *
     * @param deployUnit Kevoree DeployUnit
     * @param force [optional] boolean that indicates whether or not we should force re-installation no matter what
     * @param callback function(err, Class, model)
     */
    resolve: function (deployUnit, force, callback) {},

    uninstall: function (deployUnit, force, callback) {},

    addRepository: function (url) {
        if (this.repositories.indexOf(url) === -1) this.repositories.push(url);
    }
});

module.exports = Resolver;
},{"./KevoreeLogger":8,"pseudoclass":14}],10:[function(require,module,exports){
'use strict';
var ansi = require('ansi-styles');
var stripAnsi = require('strip-ansi');
var hasColor = require('has-color');
var defineProps = Object.defineProperties;
var chalk = module.exports;

var styles = (function () {
	var ret = {};

	ansi.grey = ansi.gray;

	Object.keys(ansi).forEach(function (key) {
		ret[key] = {
			get: function () {
				this._styles.push(key);
				return this;
			}
		};
	});

	return ret;
})();

function init() {
	var ret = {};

	Object.keys(styles).forEach(function (name) {
		ret[name] = {
			get: function () {
				var obj = defineProps(function self() {
					var str = [].slice.call(arguments).join(' ');

					if (!chalk.enabled) {
						return str;
					}

					return self._styles.reduce(function (str, name) {
						var code = ansi[name];
						return str ? code.open + str + code.close : '';
					}, str);
				}, styles);

				obj._styles = [];

				return obj[name];
			}
		}
	});

	return ret;
}

defineProps(chalk, init());

chalk.styles = ansi;
chalk.stripColor = stripAnsi;
chalk.supportsColor = hasColor;

// detect mode if not set manually
if (chalk.enabled === undefined) {
	chalk.enabled = chalk.supportsColor;
}

},{"ansi-styles":11,"has-color":12,"strip-ansi":13}],11:[function(require,module,exports){
'use strict';
var styles = module.exports;

var codes = {
	reset: [0, 0],

	bold: [1, 22],
	italic: [3, 23],
	underline: [4, 24],
	inverse: [7, 27],
	strikethrough: [9, 29],

	black: [30, 39],
	red: [31, 39],
	green: [32, 39],
	yellow: [33, 39],
	blue: [34, 39],
	magenta: [35, 39],
	cyan: [36, 39],
	white: [37, 39],
	gray: [90, 39],

	bgBlack: [40, 49],
	bgRed: [41, 49],
	bgGreen: [42, 49],
	bgYellow: [43, 49],
	bgBlue: [44, 49],
	bgMagenta: [45, 49],
	bgCyan: [46, 49],
	bgWhite: [47, 49]
};

Object.keys(codes).forEach(function (key) {
	var val = codes[key];
	var style = styles[key] = {};
	style.open = '\x1b[' + val[0] + 'm';
	style.close = '\x1b[' + val[1] + 'm';
});

},{}],12:[function(require,module,exports){
(function (process){
'use strict';
module.exports = (function () {
	if (process.argv.indexOf('--no-color') !== -1) {
		return false;
	}

	if (process.argv.indexOf('--color') !== -1) {
		return true;
	}

	if (process.stdout && !process.stdout.isTTY) {
		return false;
	}

	if (process.platform === 'win32') {
		return true;
	}

	if ('COLORTERM' in process.env) {
		return true;
	}

	if (process.env.TERM === 'dumb') {
		return false;
	}

	if (/^screen|^xterm|^vt100|color|ansi|cygwin|linux/i.test(process.env.TERM)) {
		return true;
	}

	return false;
})();

}).call(this,require('_process'))
},{"_process":4}],13:[function(require,module,exports){
'use strict';
module.exports = function (str) {
	return typeof str === 'string' ? str.replace(/\x1B\[([0-9]{1,2}(;[0-9]{1,2})?)?[m|K]/g, '') : str;
};

},{}],14:[function(require,module,exports){
/*
	Class - JavaScript inheritance

	Construction:
		Setup and construction should happen in the construct() method.
		The construct() method is automatically chained, so all construct() methods defined by superclass methods will be called first.

	Initialization:
		Initialziation that needs to happen after all construct() methods have been called should be done in the init() method.
		The init() method is not automatically chained, so you must call this._super() if you intend to call the superclass' init method.
		init() is not passed any arguments

	Destruction:
		Teardown and destruction should happen in the destruct() method. The destruct() method is also chained.

	Mixins:
		An array of mixins can be provided with the mixins[] property. An object or the prototype of a class should be provided, not a constructor.
		Mixins can be added at any time by calling this.mixin(properties)

	Usage:
		var MyClass = Class(properties);
		var MyClass = new Class(properties);
		var MyClass = Class.extend(properties);

	Credits:
		Inspired by Simple JavaScript Inheritance by John Resig http://ejohn.org/

	Usage differences:
		construct() is used to setup instances and is chained so superclass construct() methods run automatically
		destruct() is used to tear down instances. destruct() is also chained
		init(), if defined, is called after construction is complete and is not chained
		toString() can be defined as a string or a function
		mixin() is provided to mix properties into an instance
		properties.mixins as an array results in each of the provided objects being mixed in (last object wins)
		this._super() is supported in mixins
		properties, if defined, should be a hash of property descriptors as accepted by Object.defineProperties
*/
(function(global) {
	// Extend the current context by the passed objects
	function extendThis() {
		var i, ni, objects, object, prop;
		objects = arguments;
		for (i = 0, ni = objects.length; i < ni; i++) {
			object = objects[i];
			for (prop in object) {
				this[prop] = object[prop];
			}
		}

		return this;
	}

	// Return a function that calls the specified method, passing arguments
	function makeApplier(method) {
		return function() {
			return this[method].apply(this, arguments);
		};
	}

	// Merge and define properties
	function defineAndInheritProperties(Component, properties) {
		var constructor,
			descriptor,
			property,
			propertyDescriptors,
			propertyDescriptorHash,
			propertyDescriptorQueue;

		// Set properties
		Component.properties = properties;

		// Traverse the chain of constructors and gather all property descriptors
		// Build a queue of property descriptors for combination
		propertyDescriptorHash = {};
		constructor = Component;
		do {
			if (constructor.properties) {
				for (property in constructor.properties) {
					propertyDescriptorQueue = propertyDescriptorHash[property] || (propertyDescriptorHash[property] = []);
					propertyDescriptorQueue.unshift(constructor.properties[property]);
				}
			}
			constructor = constructor.superConstructor;
		}
		while (constructor);

		// Combine property descriptors, allowing overriding of individual properties
		propertyDescriptors = {};
		for (property in propertyDescriptorHash) {
			descriptor = propertyDescriptors[property] = extendThis.apply({}, propertyDescriptorHash[property]);

			// Allow setters to be strings
			// An additional wrapping function is used to allow monkey-patching
			// apply is used to handle cases where the setter is called directly
			if (typeof descriptor.set === 'string') {
				descriptor.set = makeApplier(descriptor.set);
			}
			if (typeof descriptor.get === 'string') {
				descriptor.get = makeApplier(descriptor.get);
			}
		}

		// Store option descriptors on the constructor
		Component.properties = propertyDescriptors;
	}

	// Used for default initialization methods
	var noop = function() {};

	// Given a function, the superTest RE will match if _super is used in the function
	// The function will be serialized, then the serialized string will be searched for _super
	// If the environment isn't capable of function serialization, make it so superTest.test always returns true
	var superTest = /xyz/.test(function(){return 'xyz';}) ? /\._super\b/ : { test: function() { return true; } };

	// Bind an overriding method such that it gets the overridden method as its first argument
	var superifyDynamic = function(name, func, superPrototype) {
		return function PseudoClass_setStaticSuper() {
			// Store the old super
			var previousSuper = this._super;

			// Use the method from the superclass' prototype
			// This strategy allows monkey patching (modification of superclass prototypes)
			this._super = superPrototype[name];

			// Call the actual function
			var ret = func.apply(this, arguments);

			// Restore the previous value of super
			// This is required so that calls to methods that use _super within methods that use _super work
			this._super = previousSuper;

			return ret;
		};
	};

	var superifyStatic = function(name, func, object) {
		// Store a reference to the overridden function
		var _super = object[name];

		return function PseudoClass_setDynamicSuper() {
			// Use the method stored at declaration time
			this._super = _super;

			// Call the actual function
			return func.apply(this, arguments);
		};
	};

	// Mix the provided properties into the current context with the ability to call overridden methods with _super()
	var mixin = function(properties, superPrototype) {
		// Use this instance's prototype if no prototype provided
		superPrototype = superPrototype || this.constructor && this.constructor.prototype;
		
		// Copy the properties onto the new prototype
		for (var name in properties) {
			var value = properties[name];

			// Never mix construct or destruct
			if (name === 'construct' || name === 'destruct')
				continue;

			// Check if the property if a method that makes use of _super:
			// 1. The value should be a function
			// 2. The super prototype should have a function by the same name
			// 3. The function should use this._super somewhere
			var usesSuper = superPrototype && typeof value === 'function' && typeof superPrototype[name] === 'function' && superTest.test(value);

			if (usesSuper) {
				// Wrap the function such that this._super will be available
				if (this.hasOwnProperty(name)) {
					// Properties that exist directly on the object should be superified statically
					this[name] = superifyStatic(name, value, this);
				}
				else {
					// Properties that are part of the superPrototype should be superified dynamically
					this[name] = superifyDynamic(name, value, superPrototype);
				}
			}
			else {
				// Directly assign the property
				this[name] = value;
			}
		}
	};

	// The base Class implementation acts as extend alias, with the exception that it can take properties.extend as the Class to extend
	var Class = function(properties) {
		// If a class-like object is passed as properties.extend, just call extend on it
		if (properties && properties.extend)
			return properties.extend.extend(properties);

		// Otherwise, just create a new class with the passed properties
		return Class.extend(properties);
	};
	
	// Add the mixin method to all classes created with Class
	Class.prototype.mixin = mixin;
	
	// Creates a new Class that inherits from this class
	// Give the function a name so it can refer to itself without arguments.callee
	Class.extend = function extend(properties) {
		// The constructor handles creating an instance of the class, applying mixins, and calling construct() and init() methods
		function Class() {
			// Optimization: Requiring the new keyword and avoiding usage of Object.create() increases performance by 5x
			if (this instanceof Class === false) {
				throw new Error('Cannot create instance without new operator');
			}

			// Set properties
			var propertyDescriptors = Class.properties;
			if (propertyDescriptors) {
				Object.defineProperties(this, propertyDescriptors);
			}

			// Optimization: Avoiding conditionals in constructor increases performance of instantiation by 2x
			this.construct.apply(this, arguments);

			this.init();
		}

		var superConstructor = this;
		var superPrototype = this.prototype;

		// Store the superConstructor
		// It will be accessible on an instance as follows:
		//	instance.constructor.superConstructor
		Class.superConstructor = superConstructor;

		// Add extend() as a static method on the constructor
		Class.extend = extend;

		// Create an object with the prototype of the superclass
		// Store the extended class' prototype as the prototype of the constructor
		var prototype = Class.prototype = Object.create(superPrototype);

		// Assign prototype.constructor to the constructor itself
		// This allows instances to refer to this.constructor.prototype
		// This also allows creation of new instances using instance.constructor()
		prototype.constructor = Class;

		// Store the superPrototype
		// It will be accessible on an instance as follows:
		//	instance.superPrototype
		//	instance.constructor.prototype.superPrototype
		prototype.superPrototype = superPrototype;

		if (properties) {
			// Set property descriptors aside
			// We'll first inherit methods, then we'll apply these
			var propertyDescriptors = properties.properties;
			delete properties.properties;

			// Mix the new properties into the class prototype
			// This does not copy construct and destruct
			mixin.call(prototype, properties, superPrototype);

			// Mix in all the mixins
			// This also does not copy construct and destruct
			if (Array.isArray(properties.mixins)) {
				for (var i = 0, ni = properties.mixins.length; i < ni; i++) {
					// Mixins should be _super enabled, with the methods defined in the prototype as the superclass methods
					mixin.call(prototype, properties.mixins[i], prototype);
				}
			}

			// Define properties from this class and its parent classes
			defineAndInheritProperties(Class, propertyDescriptors);

			// Chain the construct() method (supermost executes first) if necessary
			if (properties.construct) {
				var construct = properties.construct;
				if (superPrototype.construct) {
					prototype.construct = function() {
						superPrototype.construct.apply(this, arguments);
						construct.apply(this, arguments);
					};
				}
				else {
					prototype.construct = construct;
				}
			}
			
			// Chain the destruct() method in reverse order (supermost executes last) if necessary
			if (properties.destruct) {
				var destruct = properties.destruct;
				if (superPrototype.destruct) {
					prototype.destruct = function() {
						destruct.apply(this, arguments);
						superPrototype.destruct.apply(this, arguments);
					};
				}
				else {
					prototype.destruct = destruct;
				}
			}

			// Allow definition of toString as a string (turn it into a function)
			if (typeof properties.toString === 'string') {
				var className = properties.toString;
				prototype.toString = function() { return className; };
			}
		}

		// Define construct and init as noops if undefined
		// This serves to avoid conditionals inside of the constructor
		if (typeof prototype.construct !== 'function')
			prototype.construct = noop;
		if (typeof prototype.init !== 'function')
			prototype.init = noop;

		return Class;
	};
	
	if (typeof module !== 'undefined' && module.exports) {
		// Node.js Support
		module.exports = Class;
	}
	else if (typeof global.define === 'function') {
		(function(define) {
			// AMD Support
			define(function() { return Class; });
		}(global.define));
	}
	else {
		// Browser support
		global.Class = global.PseudoClass = Class;
	}
}(this));

},{}],"kevoree-core":[function(require,module,exports){
(function (process){
var Class         = require('pseudoclass'),
    kevoree       = require('kevoree-model'),
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
        this.uiCommand      = null;

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
                                    core.log.debug(core.toString(), 'Model deployed successfully: '+adaptations.length+' adaptations ('+(new Date().getTime() - start)+'ms)');
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

    setUICommand: function (uiCmd) {
        this.uiCommand = uiCmd;
    },

    getBootstrapper: function () {
        return this.bootstrapper;
    },

    /**
     * Save model to hdd
     */
    saveModel: function () {
        // TODO
        this.log.warn(this.toString(), 'saveModel(): not implemented yet');
    },

    /**
     * Put core in readonly mode
     */
    lock: function() {
        // TODO
        this.log.warn(this.toString(), 'lock(): not implemented yet');
    },

    /**
     * Put core in read/write mode
     */
    unlock: function() {
        // TODO
        this.log.warn(this.toString(), 'unlock(): not implemented yet');
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

    getUICommand: function () {
        return this.uiCommand;
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

}).call(this,require('_process'))
},{"_process":4,"async":1,"events":2,"kevoree-commons":5,"kevoree-model":"kevoree-model","os":3,"pseudoclass":14}]},{},[]);
