'use strict';
const ClosureCompiler = require('../node/closure-compiler');
const stream = require('stream');
const {SourceMapSource} = require('webpack-sources');
const Chunk = require('webpack/lib/Chunk');

// /**
//  * @constructor
//  * @param {Object<string, string>=} options
//  */
// function WebpackPlugin(options) {
//   this.options = options || {};
// }
//
// /** @const */
// WebpackPlugin.DEFAULT_OPTIONS = {
//   language_in: 'ECMASCRIPT_NEXT',
//   language_out: 'ECMASCRIPT5_STRICT',
//   compilation_level: 'SIMPLE',
//   warning_level: 'VERBOSE',
//   json_streams: 'BOTH',
//   module_resolution: 'WEBPACK',
//   process_common_js_modules: true,
//   assume_function_wrapper: true
// };
//
// WebpackPlugin.prototype.apply = function(webpackCompiler) {
//   const self = this;
//   webpackCompiler.plugin('compilation', function() {
//     self.compilation(this);
//   });
// };
//
// WebpackPlugin.prototype.compilation = function(webpackCompilation) {
//   webpackCompilation.plugin('after-emit', this.afterEmit.bind(this));
// };
//
// WebpackPlugin.prototype.afterEmit = function(compilation, cb) {
//   const chunks = compilation.chunks.map(chunk => {
//     return {
//       name: chunk.name,
//       id: chunk.id,
//       sources: chunk.modules.map(webpackModule => {
//         return {
//           path: webpackModule.userRequest,
//           src: webpackModule.source().source(),
//           webpackId: webpackModule.id
//         };
//       })
//     };
//   });
//
//   const moduleDefs = ['required-base:1'];
//   const allSources = [{
//     path: ' [synthetic:base-module]',
//     src: ''
//   }];
//   chunks.forEach(chunk => {
//     // console.log(chunk);
//     const moduleName = chunk.name ? chunk.name.replace(/\.js$/, '') : 'generated-mod-' + chunk.id;
//     moduleDefs.push(moduleName + ':' + chunk.sources.length + ':required-base');
//     allSources.splice.apply(allSources, [allSources.length, 0].concat(chunk.sources));
//   });
//
//   const compilationOptions = Object.assign(
//       {},
//       this.options,
//       {
//         module: moduleDefs
//       },
//       WebpackPlugin.DEFAULT_OPTIONS);
//
//   const compilerRunner = new ClosureCompiler(compilationOptions);
//   const compilerProcess = compilerRunner.run((exitCode, stdOutData, stdErrData) => {
//     if (exitCode > 0) {
//       console.error(stdErrData);
//       process.exit(exitCode);
//     }
//
//     if ((stdErrData || '').length > 0) {
//       console.error(stdErrData);
//     }
//
//     let outputFiles = JSON.parse(stdOutData)
//         .filter(outputFile => !/required-base\.js$/.test(outputFile.path));
//
//     console.log(outputFiles);
//
//     cb();
//   });
//   console.log(allSources);
//   var stdInStream = new stream.Readable({ read: function() {}});
//   stdInStream.pipe(compilerProcess.stdin);
//   stdInStream.push(JSON.stringify(allSources));
//   stdInStream.push(null);
// };

class WebpackPlugin {
  constructor(options) {
    this.options = options || {};
    this.renderedModules = new Set();
  }

  apply(compiler) {
    compiler.plugin('compilation', function onCompilation(compilation) {
      //
      // compilation.moduleTemplate.plugin('module', function onModule(moduleSource, module, chunk, dependencyTemplates) {
      //   debugger;
      // });
      //
      // compilation.moduleTemplate.plugin('render', function onRender(moduleSourcePostModule, module, chunk, dependencyTemplates) {
      //   debugger;
      // });
      //
      // compilation.moduleTemplate.plugin('package', function onPackage(moduleSourcePostRender, module, chunk, dependencyTemplates) {
      //   debugger;
      // });

      compiler.plugin('after-emit', function afterEmit(compilation, cb) {
        const chunks = compilation.chunks.map(chunk => {
          // let runtimeJs = null;
          // if (chunk.hasRuntime()) {
          //   runtimeJs = compilation.mainTemplate.render(
          //       compilation.hash, chunk, compilation.moduleTemplate, compilation.dependencyTemplates);
          // }
          // debugger;
          return {
            name: chunk.name,
            id: chunk.id,
            sources: chunk.getModules().map(webpackModule => {
              return {
                path: webpackModule.userRequest,
                src: webpackModule.source().source(),
                webpackId: webpackModule.id
              };
            })
          };
        });
        //
        // const emptyParentChunk = new Chunk('empty-parent-for-runtime', null, null);
        // emptyParentChunk.entryModule = true;
        // const emptyChildChunk = new Chunk('empty-child-for-runtime', null, null);
        // emptyParentChunk.addChunk(emptyChildChunk);
        // const runtimeJs = compilation.mainTemplate.render(
        //     compilation.hash, emptyParentChunk, compilation.moduleTemplate, compilation.dependencyTemplates);

        const moduleDefs = ['required-base:1'];
        const allSources = [{
          path: '__webpack__base_module__',
          src: ''
        }];
        // source = this.mainTemplate.render(this.hash, chunk, this.moduleTemplate, this.dependencyTemplates);
        chunks.forEach(chunk => {
          moduleDefs.push("chunk-" + chunk.id + ':' + chunk.sources.length + ':required-base');
          allSources.splice.apply(allSources, [allSources.length, 0].concat(chunk.sources));
        });

        const compilationOptions = Object.assign(
            {},
            {
              module: moduleDefs
            },
            WebpackPlugin.DEFAULT_OPTIONS);

        console.log(compilationOptions);
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

          const newSource = new SourceMapSource(
              '!(function(){' + outputFiles[0].src + '}).call(this);',
              outputFiles[0].path,
              JSON.parse(outputFiles[0].source_map),
              null, null);

          compilation.assets[compilation.chunks[0].files[0]] = newSource;

          console.log(compilation.assets);
          // console.log(compilation.assets[compilation.chunks[0].files[0]]);
          cb();
        });
        console.log(allSources);
        var stdInStream = new stream.Readable({
          read: function () {
          }
        });
        stdInStream.pipe(compilerProcess.stdin);
        stdInStream.push(JSON.stringify(allSources));
        stdInStream.push(null);

      });
    });
  }
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

module.exports = WebpackPlugin;
