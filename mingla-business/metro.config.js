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
