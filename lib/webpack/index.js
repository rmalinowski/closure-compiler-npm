'use strict';
const ClosureCompiler = require('../node/closure-compiler');
const stream = require('stream');

/**
 * @constructor
 * @param {Object<string, string>=} options
 */
function WebpackPlugin(options) {
  this.options = options || {};
}

/** @const */
WebpackPlugin.DEFAULT_OPTIONS = {
  language_in: 'ECMASCRIPT_NEXT',
  language_out: 'ECMASCRIPT5_STRICT',
  compilation_level: 'SIMPLE',
  warning_level: 'VERBOSE',
  json_streams: 'BOTH',
  module_resolution: 'WEBPACK',
  process_common_js_modules: true,
  assume_function_wrapper: true
};

WebpackPlugin.prototype.apply = function(webpackCompiler) {
  const self = this;
  webpackCompiler.plugin('compilation', function() {
    self.compilation(this);
  });
};

WebpackPlugin.prototype.compilation = function(webpackCompilation) {
  webpackCompilation.plugin('after-emit', this.afterEmit.bind(this));
};

WebpackPlugin.prototype.afterEmit = function(compilation, cb) {
  const chunks = compilation.chunks.map(chunk => {
    return {
      name: chunk.name,
      id: chunk.id,
      sources: chunk.modules.map(webpackModule => {
        return {
          path: webpackModule.userRequest,
          src: webpackModule.source().source(),
          webpackId: webpackModule.id
        };
      })
    };
  });

  const moduleDefs = ['required-base:1'];
  const allSources = [{
    path: ' [synthetic:base-module]',
    src: ''
  }];
  chunks.forEach(chunk => {
    // console.log(chunk);
    const moduleName = chunk.name ? chunk.name.replace(/\.js$/, '') : 'generated-mod-' + chunk.id;
    moduleDefs.push(moduleName + ':' + chunk.sources.length + ':required-base');
    allSources.splice.apply(allSources, [allSources.length, 0].concat(chunk.sources));
  });

  const compilationOptions = Object.assign(
      {},
      this.options,
      {
        module: moduleDefs
      },
      WebpackPlugin.DEFAULT_OPTIONS);

  const compilerRunner = new ClosureCompiler(compilationOptions);
  const compilerProcess = compilerRunner.run((exitCode, stdOutData, stdErrData) => {
    if (exitCode > 0) {
      console.error(stdErrData);
      process.exit(exitCode);
    }

    if ((stdErrData || '').length > 0) {
      console.error(stdErrData);
    }

    let outputFiles = JSON.parse(stdOutData)
        .filter(outputFile => !/required-base\.js$/.test(outputFile.path));

    console.log(outputFiles);

    cb();
  });
  console.log(allSources);
  var stdInStream = new stream.Readable({ read: function() {}});
  stdInStream.pipe(compilerProcess.stdin);
  stdInStream.push(JSON.stringify(allSources));
  stdInStream.push(null);
};

module.exports = WebpackPlugin;
