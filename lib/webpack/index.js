'use strict';
const ClosureCompiler = require('../node/closure-compiler');
const stream = require('stream');
const {SourceMapSource} = require('webpack-sources');
const Chunk = require('webpack/lib/Chunk');
const RequestShortener = require('webpack/lib/RequestShortener');

class ClosureCompilerPlugin {
  constructor(options) {
    this.options = options || {};
  }

  apply(compiler) {
    const requestShortener = new RequestShortener(compiler.context);
    compiler.plugin('compilation', (compilation, params) => {
      compilation.plugin('optimize-chunk-assets', (originalChunks, cb) => {
        if (compilation.name !== undefined) {
          cb();
          return;
        }

        const allSources = [];
        const BASE_MODULE_NAME = 'required-base';
        const moduleDefs = [`${BASE_MODULE_NAME}:1`];
        let uniqueId = 1;
        const entryPoints = new Set();
        originalChunks.forEach(chunk => {
          if (chunk.hasEntryModule()) {
            chunk.entryModule.fileDependencies.forEach(filename => entryPoints.add(filename));
          }
          if (chunk.parents.length === 0) {
            uniqueId += ClosureCompilerPlugin.addChunksToCompilation(
                compilation, chunk, allSources, BASE_MODULE_NAME, moduleDefs, uniqueId);
          }
        });

        allSources.unshift({
          path: '__webpack__base_module__',
          src: '' // runtime source code should be here. It should be global (not in an IIFE)
        });
        
        const compilationOptions = Object.assign(
            {},
            ClosureCompilerPlugin.DEFAULT_OPTIONS,
            this.options,
            {
              entry_point: Array.from(entryPoints),
              module: moduleDefs
            });

        // console.log(compilationOptions);
        //
        // const buffer = allSources.filter(source => /buffer\/index\.js$/.test(source.path));
        // if (buffer.length > 0) {
        //   require('fs').writeFileSync('buffer.js', buffer[0].src, 'utf8');
        // }
        // require('fs').writeFileSync('all_sources.json', JSON.stringify(allSources, null, 2), 'utf8');
        // const buffer = allSources.filter(source => /buffer\/index\.js$/.test(source.path));
        // if (buffer.length > 0) {
        //   require('fs').writeFileSync('buffer.js', buffer[0].src, 'utf8');
        // }

        const compilerRunner = new ClosureCompiler(compilationOptions);
        compilerRunner.spawnOptions = { stdio: 'pipe' };
        const compilerProcess = compilerRunner.run();

        let stdOutData = '';
        let stdErrData = '';
        compilerProcess.stdout.on('data', (data) => {
          stdOutData += data;
        });

        compilerProcess.stderr.on('data', (data) => {
          stdErrData += data;
        });

        compilerProcess.on('error', (err) => {
          compilation.errors.push(
              new Error('Closure-compiler. Could not be launched. Is java in the path?\n' +
                  compilerRunner.prependFullCommand(err.message)));
          cb();
        });

        compilerProcess.on('close', (exitCode) => {
          if (stdErrData.length > 0) {
            const errors = ClosureCompilerPlugin.parseClosureCompilerErrorData(stdErrData, requestShortener);
            // const fs = require('fs');
            // const path = require('path');
            // fs.writeFileSync(path.resolve(process.cwd(), './errors.txt'), stdErrData, 'utf8');
            // fs.writeFileSync(path.resolve(process.cwd(), './formattedErrors.json'), JSON.stringify(errors, null, 2), 'utf8');

            ClosureCompilerPlugin.reportErrors(compilation, errors);
          }

          if (exitCode > 0) {
            cb();
            return;
          }

          let outputFiles = JSON.parse(stdOutData);

          const baseFile = outputFiles.find(file => /required-base/.test(file.path));
          let baseSrc = baseFile.src + '\n';
          if (/^['"]use strict['"];\s*$/.test(baseFile.src)) {
            baseSrc = '';
          }
          outputFiles.forEach(outputFile => {
            let chunkIdParts = /chunk-(\d+)\.js/.exec(outputFile.path);
            if (!chunkIdParts) {
              return;
            }
            let chunkId = parseInt(parseInt(chunkIdParts[1], 10));
            let chunk = compilation.chunks.find(chunk => chunk.id === chunkId);
            if (!chunk || (chunk.isEmpty() && chunk.files.length === 0)) {
              return;
            }
            const assetName = chunk.files[0];
            const sourceMap = JSON.parse(outputFile.source_map);
            sourceMap.file = assetName;
            let source = outputFile.src;
            if (chunk.hasRuntime()) {
              source = baseSrc + source;
            }
            const newSource = new SourceMapSource(source, assetName, sourceMap, null, null);
            compilation.assets[assetName] = newSource;
          });

          // console.log(compilation.assets);
          cb();
        });

        try {
          compilerProcess.stdin.end(JSON.stringify(allSources));
        } catch (e) {}
      });
    });
  }

  static addChunksToCompilation(compilation, chunk, sources, baseModule, moduleDefs, nextUniqueId) {
    let chunkSources;
    if (chunk.isEmpty()) {
      chunkSources = [{
        path: `__empty_${nextUniqueId++}__`,
        src: ''
      }];
    } else {
      chunkSources = chunk.getModules()
          .map(webpackModule => {
            let path = webpackModule.userRequest;
            if (!path) {
              path = `__unknown_${nextUniqueId++}__`;
            }
            return {
              path: path.replace(/[^-a-z0-9_$\/\\.]+/ig, '$'),
              src: webpackModule.source().source(),
              webpackId: webpackModule.id
            };
          })
          .filter(moduleJson => !(moduleJson.path === '__unknown__' && moduleJson.src === '/* (ignored) */'));
    }
    sources.push(...chunkSources);
    const chunkName = `chunk-${chunk.id}`;
    moduleDefs.push(`${chunkName}:${chunkSources.length}:${baseModule}`);
    chunk.chunks.forEach((nestedChunk) => {
      nextUniqueId += ClosureCompilerPlugin.addChunksToCompilation(
          compilation, nestedChunk, sources, chunkName, moduleDefs, nextUniqueId);
    });
    return nextUniqueId;
  }

  static parseClosureCompilerErrorData(errData, requestShortener) {
    const parsedErrors = [];
    const errors = errData.split('\n\n');
    for (let i = 0; i < errors.length; i++) {
      let error = errors[i];

      if (/^\d+ error\(s\),/.test(error)) {
        break;
      }

      if (error.indexOf('java.lang.RuntimeException: INTERNAL COMPILER ERROR') >= 0) {
        parsedErrors.push({
          type: 'ERROR',
          message: error
        });
        continue;
      }

      const fileLineExpr = /^([^:]+):(\d+):\s*/;
      const errorLines = error.split('\n');
      if (errorLines.length > 0) {
        let nextLine = 1;
        let fileParts = fileLineExpr.exec(errorLines[0]);
        const errorParts = {};
        let warning = errorLines[0];
        if (fileParts) {
          warning = errorLines[0].substr(fileParts[0].length);
          errorParts.file = requestShortener.shorten(fileParts[1]);
          errorParts.line = parseInt(fileParts[2], 10);

          if (errorLines.length > nextLine + 1 && /^Originally at:\s*/.test(errorLines[nextLine])) {
            fileParts = fileLineExpr.exec(errorLines[nextLine + 1]);
            if (fileParts) {
              errorParts.originalFile = requestShortener.shorten(fileParts[1]);
              errorParts.originalLine = parseInt(fileParts[2], 10);
              warning = errorLines[nextLine + 1].substr(fileParts[0].length);
              nextLine += 2;
            } else {
              nextLine += 1;
              warning = errorLines[nextLine + 1];
            }
          }
        }

        const warningParts = /^(\S+) - (.*)/.exec(warning)
        if (warningParts) {
          errorParts.type = warningParts[1];
          errorParts.message = warningParts[2];
        } else {
          errorParts.type = 'ERROR';
          errorParts.message = warning;
        }

        let context = [];
        if (errorLines.length > nextLine) {
          context.push(...errorLines.slice(nextLine));
        }

        if (errors.length > i + 1 && !fileLineExpr.test(errors[i + 1])) {
          if (!errors[i + 1].indexOf('java.lang.RuntimeException: INTERNAL COMPILER ERROR') >= 0) {
            context.push('', errors[i + 1]);
            i++;
          }
        }

        if (context.length > 0) {
          errorParts.context = context.join('\n');
        }

        parsedErrors.push(errorParts);
      } else {
        parsedErrors.push({
          type: 'ERROR',
          message: error
        });
      }
    }

    return parsedErrors;
  }

  static reportErrors(compilation, errors) {
    errors.forEach(error => {
      let formattedMsg;
      if (error.file) {
        formattedMsg = error.file;
        if (error.line !== undefined) {
          formattedMsg += `:${error.line}`;
        }
        if (error.originalFile) {
          formattedMsg += ` (originally at ${error.originalFile}`;
          if (error.originalLine) {
            formattedMsg += `:${error.originalLine}`;
          }
          formattedMsg += ')';
        }

        formattedMsg += ` from closure-compiler: ${error.message}`;
        if (error.context) {
          formattedMsg += `\n${error.context}`;
        }
      } else {
        formattedMsg = `closure-compiler: ${error.message.trim()}`;
      }
      if (error.type === 'WARNING') {
        compilation.warnings.push(new Error(formattedMsg));
      } else {
        compilation.errors.push(new Error(formattedMsg));
      }
    });
  }
}

/** @const */
ClosureCompilerPlugin.DEFAULT_OPTIONS = {
  language_in: 'ECMASCRIPT_NEXT',
  language_out: 'ECMASCRIPT5_STRICT',
  json_streams: 'BOTH',
  module_resolution: 'WEBPACK',
  rename_prefix_namespace: '__wpcc'
};

module.exports = ClosureCompilerPlugin;
