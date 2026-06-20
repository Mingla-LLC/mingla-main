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
  "@mingla/brand-rendering": path.join(
    WORKSPACE_ROOT,
    "packages",
    "brand-rendering",
  ),
  // ORCH-1138 — shared Direction-A offering layout primitives (parallax cover
  // shell, chrome, count-aware gallery, chip group). Used by the public trip
  // page (Leg 1) and later event/experience/brand legs.
  "@mingla/offering-rendering": path.join(
    WORKSPACE_ROOT,
    "packages",
    "offering-rendering",
  ),
  "@mingla/theme-animations": path.join(
    WORKSPACE_ROOT,
    "packages",
    "theme-animations",
  ),
  // ORCH-0849 (2026-05-15): @mingla/payments-native alias RE-ADDED.
  // ORCH-0839-B's hosted-checkout pivot was reversed by ORCH-0849
  // [Stripe payment-method parity — mingla-business PaymentSheet re-pivot].
  // mingla-business once again ships the native StripeProvider (via
  // StripeProviderWrapper.native.tsx) for iOS/Android parity with consumer.
  // The ORCH-0849 close commit (328cbe2b) re-added the dep to package.json
  // and the StripeProviderWrapper variants, but the Metro alias re-add
  // was missed — restoring it here so `npx expo start` resolves the import.
  "@mingla/payments-native": path.join(
    WORKSPACE_ROOT,
    "packages",
    "payments-native",
  ),
  // ORCH-0847 Phase A1 — shared country-picker phone input. Used by app-mobile
  // auth onboarding (via thin re-export wrappers at components/onboarding/) and
  // by mingla-business public buyer form (direct import).
  "@mingla/phone-input": path.join(WORKSPACE_ROOT, "packages", "phone-input"),
  // META-ORCH-1060 — shared Mapbox address/city picker (service + field).
  // Business app injects its own (business) tokens for the experience picker;
  // consumer app injects consumer tokens (light/dark variant).
  "@mingla/location-input": path.join(
    WORKSPACE_ROOT,
    "packages",
    "location-input",
  ),
  //
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
const STRIPE_CONNECT_NATIVE_STUB = path.join(
  __dirname,
  "src",
  "shims",
  "stripeConnectNativeStub.js",
);
const LOTTIE_WEB_STUB = path.join(
  __dirname,
  "src",
  "shims",
  "lottieReactNativeWebStub.js",
);
const REACT_NATIVE_COMPRESSOR_WEB_STUB = path.join(
  __dirname,
  "src",
  "shims",
  "reactNativeCompressorWebStub.js",
);
const LUCIDE_REACT_NATIVE_WEB_STUB = path.join(
  __dirname,
  "src",
  "shims",
  "lucideReactNativeWebStub.js",
);
const REACT_NATIVE_REANIMATED_WEB_STUB = path.join(
  __dirname,
  "src",
  "shims",
  "reactNativeReanimatedWebStub.js",
);

const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Stripe embedded components are a web-only Connect surface opened via
  // Expo WebBrowser. Expo Router still evaluates route modules while building
  // the Android graph, so keep the DOM SDK out of native startup entirely.
  if (
    platform !== "web" &&
    (moduleName === "@stripe/connect-js" ||
      moduleName === "@stripe/react-connect-js")
  ) {
    return {
      filePath: STRIPE_CONNECT_NATIVE_STUB,
      type: "sourceFile",
    };
  }

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
    if (moduleName === "lottie-react-native") {
      return {
        filePath: LOTTIE_WEB_STUB,
        type: "sourceFile",
      };
    }
    if (moduleName === "react-native-compressor") {
      return {
        filePath: REACT_NATIVE_COMPRESSOR_WEB_STUB,
        type: "sourceFile",
      };
    }
    // ORCH-1137: on web ONLY, route lucide-react-native -> the web shim. As of
    // ORCH-1137 that shim renders REAL lucide icons (backed by `lucide-react`,
    // the pure-DOM SVG sibling) via a total Proxy resolver — it is NO LONGER a
    // `() => null` null-stub. Do not "restore" the null-stub: it blanked every
    // web glyph (Ari + chrome) and crashed any web Ari conversation that mounted
    // an icon outside its 12-entry list. Native (ios/android) is unaffected —
    // this branch only fires under `platform === "web"`. See SPEC_ORCH-1137 §4.3
    // + I-PROPOSED-1137-BIZ-WEB-LUCIDE-REAL. (Mapping unchanged; comment-only.)
    if (moduleName === "lucide-react-native") {
      return {
        filePath: LUCIDE_REACT_NATIVE_WEB_STUB,
        type: "sourceFile",
      };
    }
    if (moduleName === "react-native-reanimated") {
      return {
        filePath: REACT_NATIVE_REANIMATED_WEB_STUB,
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
