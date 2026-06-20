#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * META-ORCH-1002 Sub-C (shared-package Android glass) — regression check.
 *
 * Pixel rendering cannot be unit-asserted in this repo (these "tests" are
 * source-pattern node scripts, matching the established first-strike pattern at
 * app-mobile/scripts/ci/meta-orch-1002-android-glass-check.mjs). On-device pixel
 * verification of the public event/brand pages is the tester's live-fire job.
 *
 * Asserts the shared-package contract of SPEC_META-ORCH-1002_SUB-C_SHARED_GLASS.md:
 *   T-01  GlassBlur takes an OPAQUE Android branch (Platform.OS === 'android')
 *         that renders a <View> with an opaque (>= 0.92) backgroundColor, NOT a BlurView.
 *   T-02  The dark/light opaque fills are >= 0.92 alpha and tint-keyed.
 *   T-03  iOS keeps the real BlurView (the final return is <BlurView {...props} />),
 *         and the web mobile branch is unchanged.
 *   T-04  Symptom-A mitigation preserved: EventCoverMedia + EventCover keep overflow:'hidden'.
 *   T-05  Package isolation: GlassBlur does NOT import from either app's designSystem.
 *
 * Exit 1 on any FAIL.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/scripts/ci -> packages/
const packagesRoot = path.resolve(__dirname, "../..");

const readMaybe = (absRel) => {
  try {
    return fs.readFileSync(absRel, "utf8");
  } catch {
    return null;
  }
};

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

const glassBlurPath = path.join(
  packagesRoot,
  "offering-rendering/GlassBlur.tsx",
);
const glassBlurRaw = readMaybe(glassBlurPath);
const glassBlur = glassBlurRaw ? stripComments(glassBlurRaw) : "";

// ─── T-01: opaque Android branch exists ──────────────────────────────────────
check(
  "T-01 GlassBlur has a Platform.OS === 'android' branch returning a <View> (not BlurView)",
  glassBlurRaw !== null &&
    /if\s*\(\s*Platform\.OS\s*===\s*['"]android['"]\s*\)\s*\{[\s\S]*?<View[\s\S]*?backgroundColor:\s*androidOpaqueFillForTint\(/.test(
      glassBlur,
    ),
  "On Android the shared primitive must paint an opaque fill View, not the BlurView.",
);
check(
  "T-01 GlassBlur defines androidOpaqueFillForTint that keys off the tint",
  glassBlurRaw !== null &&
    /androidOpaqueFillForTint\s*=\s*\([\s\S]*?\)\s*:\s*string\s*=>[\s\S]*?\/light\/i\.test\(tint\)/.test(
      glassBlur,
    ),
  "The opaque fill must be chosen from the BlurView tint (light vs dark).",
);

// ─── T-02: opaque fills are >= 0.92 alpha ────────────────────────────────────
const darkFill = glassBlur.match(
  /ANDROID_OPAQUE_DARK_FILL\s*=\s*['"]([^'"]+)['"]/,
);
const lightFill = glassBlur.match(
  /ANDROID_OPAQUE_LIGHT_FILL\s*=\s*['"]([^'"]+)['"]/,
);
const alphaOf = (rgba) => {
  if (rgba === null) return 0;
  const m = rgba.match(/rgba?\([^)]*?,\s*([\d.]+)\s*\)/);
  return m ? parseFloat(m[1]) : 1; // hex/opaque => 1
};
check(
  "T-02 dark opaque fill is >= 0.92 alpha",
  darkFill !== null && alphaOf(darkFill[1]) >= 0.92,
  `Dark Android glass fill must be >= 0.92 opaque (got: ${darkFill ? darkFill[1] : "MISSING"}).`,
);
check(
  "T-02 light opaque fill is >= 0.92 alpha",
  lightFill !== null && alphaOf(lightFill[1]) >= 0.92,
  `Light Android glass fill must be >= 0.92 opaque (got: ${lightFill ? lightFill[1] : "MISSING"}).`,
);

// ─── T-03: iOS keeps the real BlurView; web branch unchanged ─────────────────
check(
  "T-03 GlassBlur still returns <BlurView {...props} /> for the non-android, non-mobile-web path (iOS)",
  glassBlurRaw !== null &&
    /return\s*<BlurView\s*\{\s*\.\.\.props\s*\}\s*\/>;/.test(glassBlur),
  "iOS must keep the real BlurView — the android branch must be guarded above it.",
);
check(
  "T-03 GlassBlur keeps the mobile-web blur-skip branch (width < MOBILE_WEB_MAX_WIDTH)",
  glassBlurRaw !== null &&
    /Platform\.OS\s*===\s*['"]web['"]\s*&&\s*width\s*<\s*MOBILE_WEB_MAX_WIDTH/.test(
      glassBlur,
    ),
  "The web mobile-crash safety branch must be preserved byte-for-byte.",
);

// ─── T-04: Symptom-A mitigation preserved in shared cards ────────────────────
for (const rel of [
  "offering-rendering/EventCoverMedia.tsx",
  "offering-rendering/EventCover.tsx",
]) {
  const src = readMaybe(path.join(packagesRoot, rel));
  check(
    `T-04 ${rel} retains overflow: 'hidden' (Symptom-A mitigation)`,
    src !== null && /overflow:\s*['"]hidden['"]/.test(src),
    "Shared cover cards must keep overflow:'hidden' so no corner ring appears.",
  );
}

// ─── T-05: package isolation (no app imports in GlassBlur) ───────────────────
check(
  "T-05 GlassBlur does NOT import from app-mobile or mingla-business designSystem (I-MOR-0827)",
  glassBlurRaw !== null &&
    !/from\s+['"][^'"]*(app-mobile|mingla-business)[^'"]*['"]/.test(glassBlur),
  "The package must stay pure-presentational — no app imports.",
);

// ─── Report ──────────────────────────────────────────────────────────────────
console.log("\nMETA-ORCH-1002 Sub-C — shared-package Android glass check\n");
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
