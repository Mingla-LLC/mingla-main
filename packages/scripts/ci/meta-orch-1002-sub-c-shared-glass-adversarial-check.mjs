#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * META-ORCH-1002 Sub-C (shared-package Android glass) — TESTER ADVERSARIAL check.
 *
 * Distinct from the implementor happy-path
 * (meta-orch-1002-sub-c-shared-glass-check.mjs), which REGEX-MATCHES the source
 * text to prove the Android opaque branch exists. That proves a *pattern is
 * present*; it does NOT prove the component actually *behaves* correctly when
 * rendered, and it cannot catch a tint silently routed to the wrong fill.
 *
 * This test attacks a DIFFERENT property: BEHAVIOR. It transpiles the real
 * GlassBlur.tsx (sucrase, in-process — no jest/babel-config dependency), mocks
 * react / react-native / expo-blur, then RENDERS the actual component under each
 * Platform.OS + tint and asserts the produced element tree:
 *
 *   A-01  iOS-FREEZE   — Platform.OS='ios' renders the REAL <BlurView>, with the
 *                        full props forwarded (no accidental opaque-ification of iOS).
 *   A-02  WEB-PRESERVED — Platform.OS='web' @ width<768 renders a plain <View>
 *                        wrapping children (the blur-skip branch), NOT a BlurView
 *                        and NOT the Android opaque fill; width>=768 keeps BlurView.
 *   A-03  TINT-MAPPING  — Android: every '*Light' tint (incl. 'systemMaterialLight',
 *                        'extraLight') resolves to the LIGHT fill; 'dark' / 'default' /
 *                        undefined / unknown ('prominent') resolve to the DARK fill.
 *                        No tint silently routed to the wrong fill, none throws.
 *   A-04  NO-BLUR-LEAK  — Android NEVER renders a BlurView for any tint/intensity;
 *                        the rendered element is a View whose resolved
 *                        backgroundColor is an opaque (>=0.92) fill, and blur-only
 *                        props (intensity/experimentalBlurMethod/blurReductionFactor)
 *                        do NOT leak onto the View.
 *   A-05  PKG-ISOLATION — designTokens.ts was NOT edited on this branch, and
 *                        GlassBlur introduces no app-mobile/mingla-business import.
 *
 * REVERT CANARY: with the Android branch removed, Android falls through to the
 * iOS `return <BlurView {...props} />` — A-01..A-04 then observe a BlurView (or
 * leaked blur props) on Android and FAIL. Proven on revert; see QA report.
 *
 * Exit 1 on any FAIL.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/scripts/ci -> packages/
const packagesRoot = path.resolve(__dirname, "../..");
// packages/ -> repo root
const repoRoot = path.resolve(packagesRoot, "..");

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

// ── Locate sucrase (transpiler) across the monorepo's node_modules ────────────
const require = createRequire(import.meta.url);
const sucraseCandidates = [
  path.join(repoRoot, "mingla-business/node_modules/sucrase"),
  path.join(repoRoot, "app-mobile/node_modules/sucrase"),
  path.join(repoRoot, "node_modules/sucrase"),
  "sucrase",
];
let sucrase = null;
for (const c of sucraseCandidates) {
  try {
    sucrase = require(c);
    break;
  } catch {
    /* try next */
  }
}
if (!sucrase) {
  console.error(
    "FATAL: could not resolve `sucrase` to transpile GlassBlur.tsx. " +
      "Run from a checkout with mingla-business/app-mobile node_modules installed.",
  );
  process.exit(2);
}

// ── Transpile + evaluate GlassBlur.tsx with mocked module deps ────────────────
const glassBlurPath = path.join(packagesRoot, "event-rendering/GlassBlur.tsx");
const tsxSource = fs.readFileSync(glassBlurPath, "utf8");

const transpiled = sucrase.transform(tsxSource, {
  transforms: ["typescript", "jsx", "imports"],
  jsxRuntime: "classic",
  jsxPragma: "React.createElement",
  jsxFragmentPragma: "React.Fragment",
  production: true,
}).code;

// Sentinels so we can identify which "component" each element rendered as.
const BLUR_VIEW = function BlurView() {};
const RN_VIEW = function View() {};

// Mock React: createElement records {type, props, children}.
const React = {
  createElement: (type, props, ...children) => ({
    type,
    props: props || {},
    children: children.flat().filter((c) => c !== undefined && c !== null),
  }),
  Fragment: function Fragment() {},
};

// Window-dimensions hook is driven per-scenario via a mutable closure.
let mockWidth = 1024;
const reactNative = {
  Platform: { OS: "ios" }, // mutated per scenario
  View: RN_VIEW,
  useWindowDimensions: () => ({ width: mockWidth, height: 800 }),
};
const expoBlur = { BlurView: BLUR_VIEW };

// Evaluate the transpiled CJS module against our mocked requires.
const moduleExports = {};
const fakeRequire = (id) => {
  if (id === "react") return React;
  if (id === "react-native") return reactNative;
  if (id === "expo-blur") return expoBlur;
  throw new Error(`Unexpected require('${id}') in GlassBlur under test`);
};
// eslint-disable-next-line no-new-func
const factory = new Function(
  "require",
  "module",
  "exports",
  "React",
  transpiled,
);
factory(fakeRequire, { exports: moduleExports }, moduleExports, React);
const GlassBlur = moduleExports.GlassBlur || moduleExports.default;
if (typeof GlassBlur !== "function") {
  console.error("FATAL: GlassBlur did not export a component function.");
  process.exit(2);
}

// ── Render helpers ────────────────────────────────────────────────────────────
const render = (os, props, width = 1024) => {
  reactNative.Platform.OS = os;
  mockWidth = width;
  return GlassBlur({ children: "CONTENT", ...props });
};
const alphaOf = (rgba) => {
  if (typeof rgba !== "string") return null;
  const m = rgba.match(/rgba?\([^)]*?,\s*([\d.]+)\s*\)/);
  return m ? parseFloat(m[1]) : 1; // bare hex/opaque => 1
};
const flatStyle = (style) => {
  // GlassBlur passes style as `[style, {backgroundColor}]` on Android.
  const arr = Array.isArray(style) ? style : [style];
  return Object.assign({}, ...arr.filter((s) => s && typeof s === "object"));
};

// ── A-01: iOS-FREEZE — real BlurView, full props forwarded, no opaque fill ────
{
  const el = render("ios", {
    tint: "dark",
    intensity: 40,
    experimentalBlurMethod: "dimezisBlurView",
    style: { borderRadius: 12 },
  });
  const isBlur = el && el.type === BLUR_VIEW;
  const forwardsBlurProps =
    isBlur &&
    el.props.tint === "dark" &&
    el.props.intensity === 40 &&
    el.props.experimentalBlurMethod === "dimezisBlurView";
  const noOpaqueOnIos =
    isBlur && flatStyle(el.props.style).backgroundColor === undefined;
  check(
    "A-01 iOS renders the REAL BlurView with blur props forwarded and NO opaque fill",
    isBlur && forwardsBlurProps && noOpaqueOnIos,
    `Expected a <BlurView {...props}/> on iOS; got type=${
      el && el.type && el.type.name
    }, tint=${el && el.props.tint}, intensity=${
      el && el.props.intensity
    }, bg=${el && flatStyle(el.props.style).backgroundColor}. ` +
      "iOS must NOT be opaque-ified and must forward the blur props.",
  );
}

// ── A-02: WEB-PRESERVED — mobile-web=plain View (no blur, no opaque); desktop=BlurView
{
  const mobileWeb = render(
    "web",
    { tint: "dark", style: { padding: 4 } },
    500,
  );
  const isPlainView = mobileWeb && mobileWeb.type === RN_VIEW;
  const noBlurOnMobileWeb = !(mobileWeb && mobileWeb.type === BLUR_VIEW);
  const noAndroidFillOnWeb =
    isPlainView && flatStyle(mobileWeb.props.style).backgroundColor === undefined;
  const wrapsChildren =
    isPlainView &&
    mobileWeb.children.length === 1 &&
    mobileWeb.children[0] === "CONTENT";

  const desktopWeb = render("web", { tint: "dark" }, 1200);
  const desktopKeepsBlur = desktopWeb && desktopWeb.type === BLUR_VIEW;

  check(
    "A-02 mobile-web renders a plain <View> (blur skipped, no Android opaque fill); desktop-web keeps BlurView",
    isPlainView &&
      noBlurOnMobileWeb &&
      noAndroidFillOnWeb &&
      wrapsChildren &&
      desktopKeepsBlur,
    `mobile-web type=${mobileWeb && mobileWeb.type && mobileWeb.type.name} ` +
      `bg=${mobileWeb && flatStyle(mobileWeb.props.style).backgroundColor}; ` +
      `desktop-web type=${
        desktopWeb && desktopWeb.type && desktopWeb.type.name
      }. Web branch must be unchanged — no opaque-fill regression on web.`,
  );
}

// ── A-03: TINT-MAPPING — execute the REAL code for every tint class ───────────
{
  const DARK = "rgba(20, 22, 26, 0.92)";
  const LIGHT = "rgba(248, 249, 251, 0.94)";

  const fillFor = (tint) => {
    const el = render("android", { tint });
    return flatStyle(el.props.style).backgroundColor;
  };

  // Light family — must ALL map to the light fill.
  const lightTints = ["light", "systemMaterialLight", "extraLight", "systemThinMaterialLight"];
  // Dark / default / unknown family — must ALL map to the dark fill.
  const darkTints = ["dark", "default", undefined, "prominent", "systemUltraThinMaterialDark", "regular"];

  const lightMisses = lightTints.filter((t) => fillFor(t) !== LIGHT);
  const darkMisses = darkTints.filter((t) => fillFor(t) !== DARK);

  let threw = false;
  try {
    for (const t of [...lightTints, ...darkTints]) fillFor(t);
  } catch {
    threw = true;
  }

  check(
    "A-03 every '*Light' tint -> light fill; dark/default/undefined/unknown -> dark fill (no silent mis-route, no throw)",
    lightMisses.length === 0 && darkMisses.length === 0 && !threw,
    `light-family routed wrong: [${lightMisses.join(", ")}]; ` +
      `dark/default/unknown routed wrong: [${darkMisses
        .map((t) => String(t))
        .join(", ")}]; threw=${threw}. ` +
      "A tint silently falling to the wrong fill is the failure under test.",
  );
}

// ── A-04: NO-BLUR-LEAK on Android — never a BlurView; opaque>=0.92; props stripped
{
  const tints = ["dark", "light", "default", undefined, "systemMaterialLight", "prominent"];
  let anyBlur = false;
  let anyBelowFloor = false;
  let anyLeakedProp = false;
  for (const tint of tints) {
    const el = render("android", {
      tint,
      intensity: 80,
      experimentalBlurMethod: "dimezisBlurView",
      blurReductionFactor: 4,
      style: { borderRadius: 16 },
    });
    if (!el || el.type !== RN_VIEW) anyBlur = true; // anything not a plain View == leak
    if (el && el.type === BLUR_VIEW) anyBlur = true;
    const bg = el && flatStyle(el.props.style).backgroundColor;
    const a = alphaOf(bg);
    if (a === null || a < 0.92) anyBelowFloor = true;
    // blur-only props must be destructured OUT, not forwarded to the View.
    const p = (el && el.props) || {};
    if (
      "intensity" in p ||
      "experimentalBlurMethod" in p ||
      "blurReductionFactor" in p ||
      "tint" in p
    ) {
      anyLeakedProp = true;
    }
    // children must be preserved on the View.
    if (!el || el.children.length !== 1 || el.children[0] !== "CONTENT") {
      anyBlur = true;
    }
  }
  check(
    "A-04 Android NEVER renders a BlurView; opaque fill >=0.92; blur-only props not leaked onto the View; children preserved",
    !anyBlur && !anyBelowFloor && !anyLeakedProp,
    `blurLeak=${anyBlur} belowAlphaFloor=${anyBelowFloor} leakedBlurProps=${anyLeakedProp}. ` +
      "Android panels must be solid frosted Views, never expo-blur film, with blur props stripped.",
  );
}

// ── A-05: PKG-ISOLATION — designTokens untouched on branch + no app imports ───
{
  let tokensUnchanged = true;
  let isolationDetail = "designTokens.ts not in branch diff (untouched)";
  try {
    const changed = execSync("git diff origin/main...HEAD --name-only", {
      cwd: repoRoot,
      encoding: "utf8",
    })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const tokenEdits = changed.filter((f) => /designTokens\.ts$/.test(f));
    tokensUnchanged = tokenEdits.length === 0;
    if (!tokensUnchanged) {
      isolationDetail = `designTokens.ts edited on branch: ${tokenEdits.join(", ")}`;
    }
  } catch (e) {
    isolationDetail = `git diff unavailable (${e.message}); falling back to import-only check`;
  }
  const noAppImport = !/from\s+['"][^'"]*(app-mobile|mingla-business)[^'"]*['"]/.test(
    tsxSource,
  );
  check(
    "A-05 designTokens.ts NOT edited on this branch AND GlassBlur introduces no app import (I-MOR-0827)",
    tokensUnchanged && noAppImport,
    `${isolationDetail}; noAppImport=${noAppImport}.`,
  );
}

// ── Report ────────────────────────────────────────────────────────────────────
console.log(
  "\nMETA-ORCH-1002 Sub-C — TESTER ADVERSARIAL behavioral check (rendered output)\n",
);
let failed = 0;
for (const c of checks) {
  const tag = c.pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${c.name}`);
  if (!c.pass) {
    console.log(`         ${c.detail}`);
    failed += 1;
  }
}
console.log(
  `\nSummary: ${checks.length - failed}/${checks.length} PASS${
    failed > 0 ? ` (${failed} FAIL)` : ""
  }\n`,
);
process.exit(failed > 0 ? 1 : 0);
