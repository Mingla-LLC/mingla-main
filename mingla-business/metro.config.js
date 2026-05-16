// Copyright Mingla. Bundler config.
//
// Cycle 0b WEB3 fix (per Mingla_Artifacts/specs/SPEC_WEB3_IMPORT_META_FIX.md):
// Force Metro Web to resolve `zustand` to the CJS build instead of the ESM
// build. The ESM file `node_modules/zustand/esm/middleware.mjs` uses
// `import.meta.env.MODE` for Vite-style env detection (Zustand devtools
// middleware, lines 62 and 124). Metro Web does not transform `import.meta`,
// so the bundle fails to parse with `SyntaxError: Cannot use 'import.meta'
// outside a module` at runtime.
//
// Native iOS/Android resolve via the `react-native` exports condition →
// CJS path, no `import.meta`. This override only kicks in for the web
// platform, leaves native resolution untouched.
//
// Reversible: when Metro adds a built-in `import.meta` transform, OR when
// Zustand stops shipping `import.meta.env` in its ESM build, this override
// can be removed.

const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const config = getDefaultConfig(__dirname);

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
  // ORCH-0847 Phase A — shared country-picker phone input for the public
  // buyer form (replaces the prior single-text-field phone input).
  "@mingla/phone-input": path.join(WORKSPACE_ROOT, "packages", "phone-input"),
  // ORCH-0839-B (2026-05-14): @mingla/payments-native alias removed.
  // mingla-business pivoted from native PaymentSheet to hosted Stripe
  // Checkout. app-mobile still consumes the shared package — its own
  // metro.config.js retains the alias independently.
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

const ZUSTAND_CJS_ROOT = path.join(__dirname, "node_modules", "zustand");

const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Only intervene on the web platform. Native (ios/android) keeps the
  // default resolution which picks the `react-native` exports condition.
  if (platform === "web") {
    if (moduleName === "zustand") {
      return {
        filePath: path.join(ZUSTAND_CJS_ROOT, "index.js"),
        type: "sourceFile",
      };
    }
    if (moduleName === "zustand/middleware") {
      return {
        filePath: path.join(ZUSTAND_CJS_ROOT, "middleware.js"),
        type: "sourceFile",
      };
    }
    if (moduleName.startsWith("zustand/middleware/")) {
      const subpath = moduleName.slice("zustand/middleware/".length);
      return {
        filePath: path.join(ZUSTAND_CJS_ROOT, "middleware", `${subpath}.js`),
        type: "sourceFile",
      };
    }
    if (moduleName.startsWith("zustand/")) {
      const subpath = moduleName.slice("zustand/".length);
      return {
        filePath: path.join(ZUSTAND_CJS_ROOT, `${subpath}.js`),
        type: "sourceFile",
      };
    }
  }

  // Fall through to default Metro resolution for everything else (and for
  // non-web platforms).
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
