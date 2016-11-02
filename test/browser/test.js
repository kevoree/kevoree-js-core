'use strict';

angular.module('app', [])
  .controller('Controller', function ($scope, $timeout) {
    $scope.logs = [];

    TinyConf.set('registry', {
      host: 'kevoree.braindead.fr',
      port: 443,
      ssl: true,
      oauth: {
        client_id: 'kevoree_registryapp',
        client_secret: 'kevoree_registryapp_secret'
      }
    });

    var DEFAULT_TAG = 'BrowserTest';
    var kLogger = new KevoreeCommons.Logger(DEFAULT_TAG);
    function log(type) {
      return function (tag, msg) {
        if (!msg) {
          msg = tag;
          tag = DEFAULT_TAG;
        }
        kLogger[type](tag, msg);
        var uiType = '';
        if (type === 'info') {
          uiType = 'default';
        } else if (type === 'debug') {
          uiType = 'info';
        } else if (type === 'warn') {
          uiType = 'warning';
        } else if (type === 'error') {
          uiType = 'danger';
        }
        $timeout(function () {
          if (tag.length > 20) {
            tag = tag.substr(0, 20) + '.';
          }
          $scope.logs.push({ type: uiType, tag: tag, msg: msg });
          setTimeout(function () {
            window.scrollTo(0, document.body.scrollHeight);
          }, 100);
        });
      };
    }
    var logger = {
      info: log('info'),
      error: log('error'),
      warn: log('warn'),
      debug: log('debug'),
      all: log('all'),
      setLevel: function () {},
      setFilter: function () {},
      toString: function () {
        return 'BrowserLogger';
      }
    };

    var KevoreeModuleLoader = {
      modules: {},
      register: function (name, version, module) {
        this.modules[name+'@'+version] = module;
      },
      require: function (name, version) {
        return this.modules[name+'@'+version];
      }
    };

    var kevs = new KevoreeKevscript(logger);
    var core = new KevoreeCore(kevs, '__FAKE_BROWSER_NODE_MODULES', logger);
    core.setBootstrapper(new KevoreeCommons.Bootstrapper(logger, {
      resolve: function (du, forceInstall, callback) {
        logger.debug(this.toString(), 'resolving ' + du.name + '@' + du.version + '...');
        TarGZ.load(
          `http://registry.npmjs.org/${du.name}/-/${du.name}-${du.version}.tgz`,
          function (files) {
            var file;
            for (var i = 0; i < files.length; i++) {
              if (files[i].filename === `package/browser/${du.name}.js`) {
                file = files[i];
                break;
              }
            }
            if (file) {
              eval(`//# sourceURL=${du.name + '@' + du.version}\n${file.data}`);
              callback(null, KevoreeModuleLoader.require(du.name, du.version));
            } else {
              callback(new Error(`Unable to find bundle browser/${du.name}.js in ${du.name}@${du.version}`));
            }
          });
      },
      uninstall: function (du, callback) {
        logger.debug(this.toString(), 'uninstalling ' + du.name + '@' + du.version + '...');
        callback(new Error('Not impletemented yet'));
      },
      toString: function () {
        return 'BrowserResolver';
      }
    }));

    core.start('testNode');

    var script = 'add testNode, node0: JavascriptNode/LATEST/LATEST\n' +
      'add sync: RemoteWSGroup/LATEST/LATEST\n' +
      'set testNode.logLevel = "DEBUG"\n' +
      'set sync.host = "ws.kevoree.org"\n' +
      'set sync.path = "max-test"\n' +
      'attach testNode sync\n' +
      'network node0.ip.lo localhost';
    kevs.parse(script, function (err, model) {
      if (err) {
        log('error')('KevScript', err.message);
      } else {
        core.deploy(model);
      }
    });
  });
