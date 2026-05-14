const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const path = require("node:path");

const config = getSentryExpoConfig(__dirname);

// META-ORCH-0827 Pass 2 — workspace-root packages/ folder for shared
// rendering + payments code. Metro must watch the packages directory and
// resolve modules from both app and workspace-root node_modules. This is
// the lightweight alternative to pnpm workspaces.
const WORKSPACE_ROOT = path.resolve(__dirname, "..");
config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.join(WORKSPACE_ROOT, "packages"),
];
config.resolver.nodeModulesPaths = [
  ...(config.resolver.nodeModulesPaths ?? []),
  path.join(__dirname, "node_modules"),
  path.join(WORKSPACE_ROOT, "node_modules"),
];
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
