'use strict';
var Compiler = require('../node/closure-compiler');
var spawnSync = require('child_process').spawnSync;

/**
 * @constructor
 * @param {Object<string, string>=} options
 */
function WebpackPlugin(options) {
  this.options = options || {};
}

/** @const */
WebpackPlugin.prototype.DEFAULT_OPTIONS = {
  language_in: 'ECMASCRIPT_NEXT',
  language_out: 'ECMASCRIPT5_STRICT',
  compilation_level: 'SIMPLE',
  warning_level: 'VERBOSE',
  json_streams: 'BOTH',
  module_resolution: 'NODE',
  process_common_js_modules: true,
  assume_function_wrapper: true
};

WebpackPlugin.prototype.apply = function(webpackCompiler) {
  var webpackPlugin = this;
  webpackCompiler.plugin("compilation", function(webpackCompilation) {
    webpackCompilation.plugin("before-module-assets", function() {
      const chunks = webpackCompilation.chunks.map(chunk => {
        return {
          name: chunk.name,
          id: chunk.id,
          sources: chunk.modules.map(module => {
            return {
              path: module._source._name,
              src: module._source._value
            };
          })
        };
      });

      var moduleDefs = ['required-base:1'];
      var allSources = [{
        path: ' [synthetic:base-module]',
        src: ''
      }];
      chunks.forEach(chunk => {
        console.log(chunk);
        const moduleName = chunk.name ? chunk.name.replace(/\.js$/, '') : 'generated-mod-' + chunk.id;
        moduleDefs.push(moduleName + ':' + chunk.sources.length + ':required-base');
        allSources.splice.apply(allSources, [allSources.length, 0].concat(chunk.sources));
      });

      var compilationOptions = Object.assign({}, webpackPlugin.DEFAULT_OPTIONS, webpackPlugin.options, {module: moduleDefs});
      console.log(compilationOptions);
      var compilerRunner = new Compiler(compilationOptions);
      var compilationOutput = webpackPlugin._runCompiler.call(compilerRunner, JSON.stringify(allSources, null, 0));
      if ((compilationOutput.stderr || '').length > 0) {
        console.error(compilationOutput.stderr);
      }

      if (compilationOutput.error) {
        throw compilationOutput.error;
      }

      if (compilationOutput.status !== 0) {
        process.exit(compilationOutput.signal);
      }

      var outputFiles = JSON.parse(compilationOutput.stdout);
      outputFiles = outputFiles.filter(function(outputFile ) {
        return !/required-base\.js$/.test(outputFile.path);
      });

      outputFiles.forEach(outputFile =>  {
        // Insert this list into the Webpack build as a new file asset:
        webpackCompilation.assets[outputFile.path] = {
          source: function() {
            return outputFile.src;
          },
          size: function() {
            return outputFile.src.length;
          }
        };

        console.log(outputFile.src)
      });
    });
  });
};

/**
 * @param {string} input
 * @return {{
 *     pid: number,
 *     output: !Array<string>,
 *     stout: string,
 *     stderr: string,
 *     status: number,
 *     signal: string,
 *     error: ?Error
 *   }}
 * @this {Compiler}
 */
WebpackPlugin.prototype._runCompiler = function(input) {
  if (this.logger) {
    this.logger(this.getFullCommand() + '\n');
  }

  var spawnOptions = {
    input: input,
    maxBuffer: Math.max(2097152, input.length),
    encoding: 'utf8'
  };

  return spawnSync(this.javaPath, this.commandArguments, spawnOptions);
};

module.exports = WebpackPlugin;
