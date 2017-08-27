'use strict';
const ClosureCompiler = require('../node/closure-compiler');
const stream = require('stream');
const {SourceMapSource} = require('webpack-sources');
const Chunk = require('webpack/lib/Chunk');

class ClosureCompilerPlugin {
  constructor(options) {
    this.options = options || {};
  }

  apply(compiler) {
    compiler.plugin('compilation', (compilation) => {
      compilation.plugin('optimize-chunk-assets', (originalChunks, cb) => {
        const allSources = [{
          path: '__webpack__base_module__',
          src: ''
        }];
        const BASE_MODULE_NAME = 'required-base';
        const moduleDefs = [`${BASE_MODULE_NAME}:1`];
        const assetMap = new Map();
        let chunkNum = 1;

        originalChunks.forEach(chunk => {
          if (!chunk.isInitial()) {
            return;
          }
          chunkNum += ClosureCompilerPlugin.addChunksToCompilation(
              compilation, chunk, allSources, assetMap, BASE_MODULE_NAME, moduleDefs, chunkNum);
        });

        const compilationOptions = Object.assign(
            {},
            {
              module: moduleDefs
            },
            ClosureCompilerPlugin.DEFAULT_OPTIONS);

        // console.log(compilationOptions);

        const compilerRunner = new ClosureCompiler(compilationOptions);
        const compilerProcess = compilerRunner.run((exitCode, stdOutData, stdErrData) => {
          if (exitCode > 0) {
            console.error(stdErrData);
            process.exit(exitCode);
          }

          if ((stdErrData || '').length > 0) {
            console.error(stdErrData);
          }

          let outputFiles = JSON.parse(stdOutData);

          // console.log(outputFiles);

          outputFiles.forEach(outputFile => {
            let chunkIdParts = /chunk-(\d+)\.js/.exec(outputFile.path);
            if (!chunkIdParts) {
              return;
            }
            const assetName = assetMap.get(parseInt(chunkIdParts[1], 10));
            if (!assetName) {
              return;
            }

            const sourceMap = JSON.parse(outputFile.source_map);
            sourceMap.file = assetName;
            const source = `(function(__wpcc){${outputFile.src}}).call(this, {});`;
            const newSource = new SourceMapSource(source, assetName, sourceMap, null, null);
            compilation.assets[assetName] = newSource;
          });

          // console.log(compilation.assets);
          cb();
        });
        // console.log(allSources);
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

  static addChunksToCompilation(compilation, chunk, sources, assetMap, baseModule, moduleDefs, nextModuleNum) {
    const assetName = chunk.files.find(filename => !!compilation.assets[filename]);
    const chunkSources = chunk.getModules().map(webpackModule => {
      return {
        path: webpackModule.userRequest,
        src: webpackModule.source().source(),
        webpackId: webpackModule.id
      };
    });
    sources.push(...chunkSources);
    const chunkName = `chunk-${nextModuleNum}`;
    moduleDefs.push(`${chunkName}:${chunkSources.length}:${baseModule}`);
    assetMap.set(nextModuleNum, assetName);
    nextModuleNum++;
    chunk.chunks.forEach((nestedChunk) => {
      nextModuleNum += ClosureCompilerPlugin.addChunksToCompilation(
          compilation, nestedChunk, sources, assetMap, baseModule, moduleDefs, nextModuleNum);
    });
    return nextModuleNum;
  }
}

/** @const */
ClosureCompilerPlugin.DEFAULT_OPTIONS = {
  language_in: 'ECMASCRIPT_NEXT',
  language_out: 'ECMASCRIPT5_STRICT',
  compilation_level: 'ADVANCED',
  warning_level: 'VERBOSE',
  json_streams: 'BOTH',
  module_resolution: 'WEBPACK',
  process_common_js_modules: true,
  assume_function_wrapper: true,
  rename_prefix_namespace: '__wpcc'
};

module.exports = ClosureCompilerPlugin;
