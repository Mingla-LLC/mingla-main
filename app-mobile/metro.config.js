const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const path = require("node:path");

const config = getSentryExpoConfig(__dirname);

// META-ORCH-0827 Pass 2 — workspace-root packages/ folder for shared
// rendering + payments code. Metro must watch the packages directory,
// resolve modules from both app and workspace-root node_modules, AND
// map the @mingla/* import namespace to the packages/ paths
// (Metro does NOT honor tsconfig paths; it uses Node module resolution).
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
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  "@mingla/event-rendering": path.join(
    WORKSPACE_ROOT,
    "packages",
    "event-rendering",
  ),
  "@mingla/payments-native": path.join(
    WORKSPACE_ROOT,
    "packages",
    "payments-native",
  ),
  // ORCH-0847 Phase A — shared country-picker phone input. Used by
  // app-mobile auth onboarding (via thin re-export wrappers at
  // components/onboarding/) and by mingla-business public buyer form.
  "@mingla/phone-input": path.join(WORKSPACE_ROOT, "packages", "phone-input"),
  // CRITICAL — force single React + RN instance across app + packages.
  // The packages have their own node_modules/react (for type-checking
  // only) which at runtime would create a DUPLICATE React instance and
  // trigger "Invalid hook call. Hooks can only be called inside of the
  // body of a function component" errors. By redirecting `react` and
  // `react-native` to the APP's copies, Metro always bundles a single
  // React instance regardless of which file does the import.
  react: path.join(__dirname, "node_modules", "react"),
  "react-native": path.join(__dirname, "node_modules", "react-native"),
};
// Hierarchical lookup stays ENABLED — Metro needs it to find RN's nested
// dependencies (e.g. @react-native/virtualized-lists inside
// node_modules/react-native/node_modules/). The single-React-instance
// guarantee comes from packages/*/ having NO node_modules at all (their
// package.json declares peerDependencies only, no devDeps that would
// pull react/react-native into the packages' own node_modules). That
// rule is enforced socially via the package.json; a future CI gate
// could check `! -d packages/*/node_modules/react` to lock it in.
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
