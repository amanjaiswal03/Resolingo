const fs = require("fs");
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...new Set([...(config.watchFolders ?? []), workspaceRoot])];
config.resolver.nodeModulesPaths = [
  ...new Set([
    path.resolve(projectRoot, "node_modules"),
    path.resolve(workspaceRoot, "node_modules"),
    ...(config.resolver.nodeModulesPaths ?? []),
  ]),
];

// Shared sources use NodeNext `.js` specifiers that point at `.ts` files.
// Metro only resolves the specifier as written, so retry the TypeScript file
// when the `.js` file is not on disk. Leave real `.js` files alone.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    const originDir = path.dirname(context.originModulePath);
    const jsFile = path.resolve(originDir, moduleName);
    if (!fs.existsSync(jsFile)) {
      const stem = moduleName.slice(0, -".js".length);
      for (const extension of [".ts", ".tsx"]) {
        if (fs.existsSync(path.resolve(originDir, `${stem}${extension}`))) {
          return context.resolveRequest(context, `${stem}${extension}`, platform);
        }
      }
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
