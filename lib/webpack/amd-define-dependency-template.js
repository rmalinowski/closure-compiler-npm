const AMDDefineDependency = require("webpack/lib/dependencies/AMDDefineDependency");

class AMDDefineDependencyTemplate extends AMDDefineDependency.Template {
  get definitions() {
    let defs = super.definitions;
    Object.values(defs).forEach(value => {
      value.forEach((line, index) => {
        if (!/^var/.test(line)) {
          return;
        }
        value[index] = line.replace(/(var )__WEBPACK_AMD/g, '$1/** @suppress {duplicate} */__WEBPACK_AMD');
      });
    });
    return defs;
  }
}

module.exports = AMDDefineDependencyTemplate;
