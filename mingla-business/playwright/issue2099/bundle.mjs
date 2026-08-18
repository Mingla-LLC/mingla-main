/**
 * #2099 §D6 — bundles the Business browser harness.
 *
 * Adds NO dependency: it loads esbuild's JS API from `mingla-admin`, which the
 * issue workflow already installs (`npm --prefix mingla-admin ci`), so neither
 * `package.json` nor either lockfile is touched — both are do-not-touch.
 *
 * Exactly ONE module is replaced, and it is the network boundary:
 * `pendingVenueIdentityCorrectionService.web` becomes a virtual module whose
 * two functions resolve from `window.__issue2099`. Everything the assertions
 * are about — the real dialog, the real shared `Modal`, the real `Input`, the
 * real design tokens, the real styles — is bundled from source. The virtual
 * module exists only so the harness needs no Supabase client; it changes no
 * layout, no styling and no component identity.
 *
 * The bundle is written under `node_modules/.cache/`, which is build output and
 * already ignored — no generated artefact enters the repository.
 */

import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUSINESS_ROOT = resolve(HERE, "../..");
const REPO_ROOT = resolve(BUSINESS_ROOT, "..");

const require = createRequire(import.meta.url);
const esbuild = require(join(REPO_ROOT, "mingla-admin/node_modules/esbuild"));

/** The service stub. Its shape is the real module's, and nothing else. */
const SERVICE_STUB = `
const bridge = () => globalThis.__issue2099;
export async function previewPendingVenueIdentityCorrection() {
  const state = bridge();
  state.previewCalls += 1;
  if (state.previewError) throw new Error("preview failed");
  return state.preview;
}
export async function correctPendingVenueIdentity() {
  const state = bridge();
  state.correctCalls += 1;
  return state.correctResult ?? { ok: true, audit_id: "harness-audit" };
}
`;

/** react-native -> react-native-web, plus web-first source resolution. */
const webPlatform = {
  name: "issue2099-web-platform",
  setup(build) {
    build.onResolve({ filter: /^react-native$/ }, () => ({
      path: require.resolve("react-native-web", { paths: [BUSINESS_ROOT] }),
    }));
    // `packages/*` has no node_modules of its own; mingla-business owns the one
    // real copy of react. This is RESOLUTION REPAIR, not a mock — the same
    // repair the stock jest config performs for the same reason.
    build.onResolve({ filter: /^react(\/.*)?$|^react-dom(\/.*)?$|^@tanstack\/react-query$/ }, (args) => ({
      path: require.resolve(args.path, { paths: [BUSINESS_ROOT] }),
    }));
    build.onResolve({ filter: /pendingVenueIdentityCorrectionService\.web$/ }, () => ({
      path: "issue2099-service-stub",
      namespace: "issue2099",
    }));
    build.onLoad({ filter: /.*/, namespace: "issue2099" }, () => ({
      contents: SERVICE_STUB,
      loader: "js",
    }));
    // Native-only leaves the web build never executes. Each is a module the
    // shared chrome imports for a NATIVE effect only; stubbing them changes no
    // box on screen, and the spec asserts the real dialog mounted regardless.
    for (const filter of [
      /^expo-blur$/,
      /^expo-haptics$/,
      /^expo-linear-gradient$/,
      /^react-native-reanimated$/,
      /^react-native-svg$/,
      /^expo-constants$/,
      /^expo-video$/,
      /^react-native-qrcode-svg$/,
      /^@mingla\/card-identity\/s6$/,
      // The offering-rendering barrel eagerly re-exports the whole public
      // card/cover surface, which the correction dialog never renders. The
      // stock jest config replaces the same barrel for the same reason.
      /^@mingla\/offering-rendering/,
    ]) {
      build.onResolve({ filter }, (args) => ({
        path: `stub:${args.path}`,
        namespace: "issue2099-native",
      }));
    }
    build.onLoad({ filter: /.*/, namespace: "issue2099-native" }, (args) => {
      if (args.path.includes("reanimated")) {
        // The WEB branch of `Modal` (ModalWeb) uses zero reanimated hooks — it
        // is a compositor CSS transition — but the module still IMPORTS them,
        // so the named exports have to exist for the bundle to link. None of
        // them runs in this harness, and none of them affects layout.
        return {
          contents: `
            import React from "react";
            const View = React.forwardRef((p, ref) => React.createElement("div", { ref }, p && p.children));
            export default { View, createAnimatedComponent: (C) => C };
            export const useAnimatedStyle = () => ({});
            export const useSharedValue = (v) => ({ value: v });
            export const useReducedMotion = () => true;
            export const useDerivedValue = (fn) => ({ value: fn && fn() });
            export const useAnimatedReaction = () => undefined;
            export const withTiming = (v) => v;
            export const withSpring = (v) => v;
            export const withRepeat = (v) => v;
            export const withDelay = (_d, v) => v;
            export const withSequence = (v) => v;
            export const cancelAnimation = () => undefined;
            export const runOnJS = (fn) => fn;
            export const runOnUI = (fn) => fn;
            export const interpolate = () => 0;
            export const Extrapolation = { CLAMP: "clamp" };
            export const Easing = {
              bezier: () => 0, linear: 0, in: () => 0, out: () => 0,
              inOut: () => 0, cubic: 0, ease: 0, quad: 0,
            };
            export const LinearTransition = { duration: () => ({}) };
            export const FadeIn = { duration: () => ({}) };
            export const FadeOut = { duration: () => ({}) };
            export const SlideInDown = { duration: () => ({}) };
            export const SlideOutDown = { duration: () => ({}) };
          `,
          loader: "js",
          resolveDir: BUSINESS_ROOT,
        };
      }
      if (args.path.includes("expo-constants")) {
        return {
          // Harness-local placeholders. The correction RPCs are stubbed, so no
          // request is ever made — this only lets the client MODULE construct,
          // because the §G5 query-key factories the dialog imports pull the
          // shared services in with them.
          contents:
            `module.exports = { __esModule: true, default: { expoConfig: { extra: {\n` +
            `  EXPO_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1/harness",\n` +
            `  EXPO_PUBLIC_SUPABASE_ANON_KEY: "issue-2099-harness-anon-key",\n` +
            `} } } };`,
          loader: "js",
        };
      }
      // Everything else is a NATIVE leaf the web branch never executes: svg
      // primitives, gradients, blur, video, QR, haptics, and the
      // offering-rendering barrel. Each renders a plain passthrough box, so
      // nothing any of them returns can move the geometry this gate measures.
      // The named exports are explicit because esbuild's CJS interop copies own
      // properties — a bare Proxy would satisfy `in` and still hand back
      // `undefined` for a named import, which is React error #130.
      return {
        contents: `
          const React = require(${JSON.stringify(join(BUSINESS_ROOT, "node_modules/react"))});
          // Forward ONLY children: these leaves receive React Native style
          // arrays, and handing one to a DOM node throws on CSSStyleDeclaration.
          const Passthrough = React.forwardRef((p, ref) =>
            React.createElement("div", { ref }, p && p.children));
          const NAMES = [
            "BlurView", "LinearGradient", "RadialGradient", "Svg", "Path", "Circle",
            "Rect", "G", "Defs", "Stop", "ClipPath", "Line", "Polygon", "Polyline",
            "Ellipse", "Text", "TSpan", "Image", "Mask", "Use", "Symbol", "Marker",
            "Pattern", "VideoView", "QRCode", "EventCoverMedia", "ChipGroup",
            "CoverGalleryPager", "CoverGalleryRow", "CountAwareGallery",
            "ParallaxCoverShell", "RsvpSuccessPopup", "EventCover",
          ];
          const target = { __esModule: true, default: Passthrough };
          for (const name of NAMES) target[name] = Passthrough;
          target.useVideoPlayer = () => ({ play: () => {}, pause: () => {} });
          target.impactAsync = () => Promise.resolve();
          target.notificationAsync = () => Promise.resolve();
          target.selectionAsync = () => Promise.resolve();
          target.ImpactFeedbackStyle = { Light: "light", Medium: "medium", Heavy: "heavy" };
          target.NotificationFeedbackType = { Success: "success", Warning: "warning", Error: "error" };
          module.exports = new Proxy(target, {
            get: (obj, key) => (key in obj ? obj[key] : Passthrough),
          });
        `,
        loader: "js",
        resolveDir: BUSINESS_ROOT,
      };
    });
  },
};

// `ISSUE2099_HARNESS_DEV=1` swaps React to its development build so a broken
// harness reports a readable component name instead of a minified error code.
const MODE = process.env.ISSUE2099_HARNESS_DEV === "1" ? "development" : "production";

const result = await esbuild.build({
  entryPoints: [join(HERE, "business-entry.tsx")],
  bundle: true,
  outfile: join(BUSINESS_ROOT, "node_modules/.cache/issue2099-harness/business-entry.js"),
  platform: "browser",
  format: "iife",
  target: ["chrome110"],
  jsx: "automatic",
  loader: { ".js": "jsx", ".ts": "ts", ".tsx": "tsx" },
  resolveExtensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".jsx", ".js", ".json"],
  define: {
    __DEV__: "false",
    "process.env.NODE_ENV": JSON.stringify(MODE),
    "process.env.EXPO_OS": '"web"',
  },
  // RN-web and its dependencies read `process.env` at module scope; a browser
  // has no `process`. This is the standard web shim, nothing behavioural.
  banner: {
    js:
      `globalThis.process = globalThis.process || { env: { NODE_ENV: ${JSON.stringify(MODE)} }, platform: "browser", version: "", nextTick: (fn) => setTimeout(fn, 0) };` +
      'globalThis.global = globalThis.global || globalThis;',
  },
  plugins: [webPlatform],
  logLevel: "warning",
  metafile: true,
});

// Anti-vacuity: the bundle must really contain the dialog's own source, not a
// stub of it. A harness that bundles nothing would otherwise "pass".
const inputs = Object.keys(result.metafile.inputs);
const hasDialog = inputs.some((f) => f.includes("PendingVenueIdentityCorrectionDialog.web"));
const hasModal = inputs.some((f) => f.endsWith("src/components/ui/Modal.tsx"));
if (!hasDialog || !hasModal) {
  console.error(
    `issue-2099 harness FAIL: bundle is missing the real dialog (${hasDialog}) or the real Modal (${hasModal}).`,
  );
  process.exit(1);
}
console.log(`issue-2099 harness bundled: ${inputs.length} modules, real dialog + real Modal present.`);
