/*
  MIT License http://www.opensource.org/licenses/mit-license.php
  Author Tobias Koppers @sokra
*/
"use strict";

const Template = require("webpack/lib/Template");

class JsonpMainTemplatePlugin {

  apply(mainTemplate) {
    mainTemplate.plugin("local-vars", function (source, chunk) {
      return JsonpMainTemplatePlugin.prototype.localVars.call(this, source, chunk);
    });
    mainTemplate.plugin("jsonp-script", function (source, chunk, hash) {
      return JsonpMainTemplatePlugin.prototype.jsonpScript.call(this, source, chunk, hash);
    });
    mainTemplate.plugin("require-ensure", function (source, chunk, hash) {
      return JsonpMainTemplatePlugin.prototype.requireEnsure.call(this, source, chunk, hash);
    });
    mainTemplate.plugin("require-extensions", function (source, chunk) {
      return JsonpMainTemplatePlugin.prototype.requireExtensions.call(this, source, chunk);
    });
    mainTemplate.plugin("bootstrap", function (source, chunk) {
      return JsonpMainTemplatePlugin.prototype.bootstrap.call(this, source, chunk);
    });
    mainTemplate.plugin("hot-bootstrap", function (source) {
      return JsonpMainTemplatePlugin.prototype.hotBootstrap.call(this, source);
    });
  }

  localVars(source, chunk) {
    if(chunk.chunks.length > 0) {
      return this.asString([
        source,
        "",
        "// objects to store loaded and loading chunks",
        "var installedChunks = {",
        this.indent(
            chunk.ids.map(id => `${JSON.stringify(id)}: 0`).join(",\n")
        ),
        "};"
      ]);
    }
    return source;
  }

  jsonpScript(source, chunk, hash) {
    const chunkFilename = this.outputOptions.chunkFilename;
    const chunkMaps = chunk.getChunkMaps();
    const crossOriginLoading = this.outputOptions.crossOriginLoading;
    const chunkLoadTimeout = this.outputOptions.chunkLoadTimeout;
    const scriptSrcPath = this.applyPluginsWaterfall("asset-path", JSON.stringify(chunkFilename), {
      hash: `" + ${this.renderCurrentHashCode(hash)} + "`,
      hashWithLength: length => `" + ${this.renderCurrentHashCode(hash, length)} + "`,
      chunk: {
        id: "\" + chunkId + \"",
        hash: `" + ${JSON.stringify(chunkMaps.hash)}[chunkId] + "`,
        hashWithLength(length) {
          const shortChunkHashMap = Object.create(null);
          Object.keys(chunkMaps.hash).forEach(chunkId => {
            if(typeof chunkMaps.hash[chunkId] === "string")
              shortChunkHashMap[chunkId] = chunkMaps.hash[chunkId].substr(0, length);
          });
          return `" + ${JSON.stringify(shortChunkHashMap)}[chunkId] + "`;
        },
        name: `" + (${JSON.stringify(chunkMaps.name)}[chunkId]||chunkId) + "`
      }
    });
    return this.asString([
      "var script = document.createElement('script');",
      "script.type = 'text/javascript';",
      "script.charset = 'utf-8';",
      "script.async = true;",
      `script.timeout = ${chunkLoadTimeout};`,
      crossOriginLoading ? `script.crossOrigin = ${JSON.stringify(crossOriginLoading)};` : "",
      `if (__WEBPACK_NONCE__) {`,
      this.indent(`script.setAttribute("nonce", __WEBPACK_NONCE__);`),
      "}",
      `script.src = __WEBPACK_OUTPUT_PATH__ + ${scriptSrcPath};`,
      `var timeout = setTimeout(onScriptComplete, ${chunkLoadTimeout});`,
      "script.onerror = script.onload = onScriptComplete;",
      "function onScriptComplete() {",
      this.indent([
        "// avoid mem leaks in IE.",
        "script.onerror = script.onload = null;",
        "clearTimeout(timeout);",
        "var chunk = installedChunks[chunkId];",
        "if(chunk !== 0) {",
        this.indent([
          "if(chunk) {",
          this.indent("chunk[1](new Error('Loading chunk ' + chunkId + ' failed.'));"),
          "}",
          "installedChunks[chunkId] = undefined;"
        ]),
        "}"
      ]),
      "};",
    ]);
  }

  requireEnsure(source, chunk, hash) {
    return this.asString([
      "var installedChunkData = installedChunks[chunkId];",
      "if(installedChunkData === 0) {",
      this.indent([
        "return Promise.resolve();"
      ]),
      "}",
      "",
      "// a Promise means \"currently loading\".",
      "if(installedChunkData) {",
      this.indent([
        "return installedChunkData[2];"
      ]),
      "}",
      "",
      "// setup Promise in chunk cache",
      "var promise = new Promise(function(resolve, reject) {",
      this.indent([
        "installedChunkData = installedChunks[chunkId] = [resolve, reject];"
      ]),
      "});",
      "installedChunkData[2] = promise;",
      "",
      "// start chunk loading",
      "var refScript = document.getElementsByTagName('script')[0];",
      this.applyPluginsWaterfall("jsonp-script", "", chunk, hash),
      "refScript.parentNode.appendChild(script, refScript);",
      "",
      "return promise;"
    ]);
  }

  requireExtensions(source, chunk) {
    if(chunk.chunks.length === 0) return source;

    return this.asString([
      source,
      "",
      "// on error function for async loading",
      "__wpcc.onError = __wpcc.onError || function(err) { console.error(err); throw err; };"
    ]);
  }

  bootstrap(source, chunk) {
    if(chunk.chunks.length > 0) {
      var jsonpFunction = this.outputOptions.jsonpFunction;
      return this.asString([
        source,
        "",
        "// install a JSONP callback for chunk loading",
        `var parentJsonpFunction = window[${JSON.stringify(jsonpFunction)}];`,
        `window[${JSON.stringify(jsonpFunction)}] = function webpackJsonpCallback(chunkIds) {`,
        this.indent([
          "// flag all \"chunkIds\" as loaded and fire callback",
          "var chunkId, i = 0, resolves = []",
          "for(;i < chunkIds.length; i++) {",
          this.indent([
            "chunkId = chunkIds[i];",
            "if(installedChunks[chunkId]) {",
            this.indent("resolves.push(installedChunks[chunkId][0]);"),
            "}",
            "installedChunks[chunkId] = 0;"
          ]),
          "}",
          "if(parentJsonpFunction) parentJsonpFunction(chunkIds);",
          "while(resolves.length) {",
          this.indent("resolves.shift()();"),
          "}"
        ]),
        "};"
      ]);
    }
    return source;
  }

  hotBootstrap(source) {
    return source;
  }
}
module.exports = JsonpMainTemplatePlugin;
