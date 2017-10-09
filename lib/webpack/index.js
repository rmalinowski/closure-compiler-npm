'use strict';
const ClosureCompiler = require('../node/closure-compiler');
const stream = require('stream');
const {SourceMapSource} = require('webpack-sources');
const fs = require('fs');
const path = require('path');
const Chunk = require('webpack/lib/Chunk');
const Entrypoint = require("webpack/lib/Entrypoint");
const Module = require('webpack/lib/Module');
const RawSource = require("webpack-sources").RawSource;
const RequestShortener = require('webpack/lib/RequestShortener');
const ParserHelpers = require("webpack/lib/ParserHelpers");
const HarmonyImportDependencyTemplate = require('./harmony-import-dependency-template');
const HarmonyImportSpecifierDependencyTemplate = require('./harmony-import-specifier-dependency-template');
const HarmonyNoopTemplate = require('./harmony-noop-template');
const AMDDefineDependencyTemplate = require('./amd-define-dependency-template');

class ClosureCompilerPlugin {
  constructor(options) {
    this.options = options || {};
  }

  apply(compiler) {
    const requestShortener = new RequestShortener(compiler.context);
    compiler.plugin('compilation', (compilation) => {
      Promise.resolve().then(() => {
        compilation.dependencyTemplates.forEach((val, key) => {
          switch (key.name) {
            case 'HarmonyImportSpecifierDependency':
              compilation.dependencyTemplates.set(key, new HarmonyImportSpecifierDependencyTemplate());
              break;

            case 'HarmonyImportDependency':
              compilation.dependencyTemplates.set(key, new HarmonyImportDependencyTemplate());
              break;

            case 'HarmonyCompatibilityDependency':
            case 'HarmonyExportExpressionDependency':
            case 'HarmonyExportHeaderDependency':
            case 'HarmonyExportImportedSpecifierDependency':
            case 'HarmonyExportSpecifierDependency':
            case 'HarmonyImportDependency':
              compilation.dependencyTemplates.set(key, new HarmonyNoopTemplate());
              break;

            case 'AMDDefineDependency':
              compilation.dependencyTemplates.set(key, new AMDDefineDependencyTemplate());
              break;
          }
        });
      });

      compilation.plugin('optimize-chunk-assets', (originalChunks, cb) => {
        if (compilation.name !== undefined) {
          cb();
          return;
        }

        const  allSources=[{
          path: '__webpack__base_module__',
          src: this.renderRuntime()
        }];

        const BASE_MODULE_NAME = 'required-base';
        const moduleDefs = [`${BASE_MODULE_NAME}:1`];
        let uniqueId = 1;
        const entryPoints = new Set();
        entryPoints.add(allSources[0].path);
        originalChunks.forEach(chunk => {
          if (chunk.hasEntryModule() && chunk.entryModule.fileDependencies) {
            chunk.entryModule.fileDependencies.forEach(filename => entryPoints.add(filename));
          }
          if (chunk.parents.length === 0) {
            uniqueId += ClosureCompilerPlugin.addChunksToCompilation(
                compilation, chunk, allSources, BASE_MODULE_NAME, moduleDefs, uniqueId);
          }
        });

        const externs = [require.resolve('./externs.js')];
        const defines = [`__webpack_require__.p="${compilation.options.publicPath}"`];
        if (this.options.externs) {
          if (typeof this.options.externs === "string") {
            externs.push(this.options.externs);
          } else {
            externs.push(...this.options.externs);
          }
        }
        if (this.options.define) {
          if (typeof this.options.define === "string") {
            defines.push(this.options.define);
          } else {
            defines.push(...this.options.define);
          }
        }

        const filteredEntryPoints = Array.from(entryPoints)
            .filter(entryPoint => allSources.find(source=> source.path === entryPoint));

        const moduleWrappers = moduleDefs.map(moduleDef => {
          const defParts = moduleDef.split(':');
          return `${defParts[0]}:(function(__wpcc){%s}).call(this, (window.__wpcc = window.__wpcc || {}));`;
        });

        const compilationOptions = Object.assign(
            {},
            ClosureCompilerPlugin.DEFAULT_OPTIONS,
            this.options,
            {
              entry_point: filteredEntryPoints,
              module: moduleDefs,
              define: defines,
              externs,
              module_wrapper: moduleWrappers
            });

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

        process.nextTick(() => {
          compilerProcess.stdin.end(JSON.stringify(allSources));
        });
      });
    });
  }

  renderRuntime() {
    return fs.readFileSync(require.resolve('./runtime.js'), 'utf8');
  }

  static addChunksToCompilation(compilation, chunk, sources, baseModule, moduleDefs, nextUniqueId) {
    let chunkSources;
    if (chunk.isEmpty()) {
      chunkSources = [{
        path: `__empty_${nextUniqueId++}__`,
        src: ''
      }];
    } else {
      const chunkModules = chunk.getModules();


      chunkSources = chunk.getModules()
          .map(webpackModule => {
            let path = webpackModule.userRequest;
            if (!path) {
              path = `__unknown_${nextUniqueId++}__`;
            }
            let src = '';
            try {
              src = webpackModule.source().source();
            } catch (e) {}

            return {
              path: path.replace(/[^-a-z0-9_$\/\\.]+/ig, '$'),
              src,
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
  rename_prefix_namespace: '__wpcc',
  process_common_js_modules: true,
  dependency_mode: 'STRICT',
  assume_function_wrapper: true,
  new_type_inf: true,
  jscomp_off: 'newCheckTypesExtraChecks'
};

module.exports = ClosureCompilerPlugin;
