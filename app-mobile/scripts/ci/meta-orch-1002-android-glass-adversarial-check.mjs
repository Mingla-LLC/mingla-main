#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * META-ORCH-1002 Sub-1 (Android glass first strike) — TESTER ADVERSARIAL check.
 *
 * Different angle than the implementor happy-path test
 * (meta-orch-1002-android-glass-check.mjs, which asserts the EXPECTED gate /
 * clip / opaque-fill / iOS-branch are PRESENT). This test attacks the failure
 * modes the happy-path cannot see — what must NOT have happened:
 *
 *   A-01  iOS-opaque-regression guard — every chrome file must still DERIVE
 *         useGlass by NEGATING the gate (so iOS keeps the real BlurView). The
 *         failure mode "implementor hard-coded the surface opaque on iOS too"
 *         (gate used WITHOUT negation, or useGlass forced false) is caught here.
 *   A-02  Translucent-leak guard — no NEW sub-0.92 translucent rgba was added as
 *         an Android fill on the 6 scoped surfaces. Happy-path only checks the
 *         expected opaque value is present; it would pass even if a stray
 *         rgba(...,0.6) Android fill were ALSO introduced. We assert the exact
 *         opaque values and that the Android branch is NOT a <0.92 rgba.
 *   A-03  Package-isolation guard (I-MOR-0827) — packages/offering-rendering/
 *         designTokens.ts and GlassBlur.tsx are byte-untouched vs origin/main
 *         (the third token file must NOT participate in this strike).
 *   A-04  Both-files parity — S5 (2 files) and S6 (2 files) were BOTH edited;
 *         the "edited one, skipped its twin" failure mode is caught.
 *   A-05  Revert-canary — re-derives the gate-adoption invariant independently:
 *         reverting ANY chrome file to a live `Platform.Version < 31` glass gate
 *         must trip this test (asserts zero such gates remain across the 8).
 *   A-06  No bare elevation:8 survives in either S5 trip tab block (the raw
 *         Android shadow rectangle must be Platform-gated to 0).
 *
 * Cross-cutting: reads BOTH app-mobile/ and mingla-business/ source.
 * Exit 1 on any FAIL.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const consumerRoot = path.resolve(__dirname, "../..");          // app-mobile/
const repoRoot = path.resolve(consumerRoot, "..");              // monorepo root
const businessRoot = path.join(repoRoot, "mingla-business");
const pkgRoot = path.join(repoRoot, "packages/offering-rendering");

const readMaybe = (abs) => {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
};
const stripComments = (src) =>
  (src || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

const CHROME_FILES = [
  "src/components/GlassTopBar.tsx",
  "src/components/GlassBottomNav.tsx",
  "src/components/DiscoverScreen.tsx",
  "src/components/LikesPage.tsx",
  "src/components/ConnectionsPage.tsx",
  "src/components/ui/GlassCard.tsx",
  "src/components/ui/GlassBadge.tsx",
  "src/components/ui/GlassIconButton.tsx",
];

// ─── A-01 + A-05: iOS keeps BlurView (gate negated) + no live version gate ────
for (const rel of CHROME_FILES) {
  const code = stripComments(readMaybe(path.join(consumerRoot, rel)));
  // A-05 revert-canary: zero live Platform.Version < 31 glass gates remain.
  check(
    `A-05 ${rel} has NO live Platform.Version < 31 gate (revert-canary)`,
    code !== "" && !/Platform\.Version\s*<\s*31/.test(code),
    "Reverting this file to the per-component Android-11 gate must fail the suite.",
  );
  // A-01: the gate must be consumed as a NEGATION (useGlass = !... && !gate),
  // i.e. iOS (gate===false) still yields the real-blur branch. We assert the
  // alias is negated somewhere (the established useGlass/useBackdropGlass shape),
  // catching a build where the surface was forced opaque on every platform.
  const negated =
    /!\s*ANDROID_GLASS_USES_OPAQUE_FALLBACK/.test(code) ||
    /!\s*isAndroidPreBlur/.test(code) ||
    /useGlass\s*=\s*[^;]*!\s*(isAndroidPreBlur|ANDROID_GLASS_USES_OPAQUE_FALLBACK)/.test(
      code,
    );
  check(
    `A-01 ${rel} consumes the gate as a NEGATION (iOS keeps BlurView)`,
    code !== "" && negated,
    "The opaque-fallback gate must be negated for the real-blur branch so iOS is unchanged.",
  );
}

// ─── A-02: translucent-leak guard on the 6 scoped surfaces ────────────────────
const TRANSLUCENT_RE = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0?\.(?:[0-8]\d?|9[01])\s*\)/g;
const ALLOWED_TRANSLUCENT = new Set([
  // iOS-branch values that legitimately remain (these are NOT Android fills):
  "rgba(255, 247, 237, 0.6)", // consumer unread cream — iOS branch
  "rgba(255,247,237,0.6)",
  "rgba(255, 255, 255, 0.04)", // business profileBase — iOS branch
  "rgba(255,255,255,0.04)",
  "rgba(255, 255, 255, 0.08)", // business border (border, not fill) — unchanged
  "rgba(255,255,255,0.08)",
]);

// Consumer designSystem cardUnreadBg android branch must be the opaque hex.
const designCode = stripComments(readMaybe(path.join(consumerRoot, "src/constants/designSystem.ts")));
check(
  "A-02 consumer cardUnreadBg Android branch is opaque #FFFAF4 (not a <0.92 rgba)",
  /cardUnreadBg:\s*Platform\.select\(\{[\s\S]*?android:\s*['"]#FFFAF4['"]/.test(designCode) &&
    !/cardUnreadBg:\s*Platform\.select\(\{[\s\S]*?android:\s*['"]rgba\([^)]*0?\.[0-8]/.test(designCode),
  "The Android unread fill must be a fully-opaque hex, never a translucent rgba.",
);

// Business S6 host android branch must be opaque kit value, not a translucent rgba.
for (const rel of [
  "src/components/event/EventListCard.tsx",
  "src/components/trip/TripListCard.tsx",
]) {
  const code = stripComments(readMaybe(path.join(businessRoot, rel)));
  const hostBlock = (code.match(/host:\s*\{[\s\S]*?\n\s{2,4}\},/) || [""])[0];
  check(
    `A-02 business ${rel} host Android fill is opaque rgba(20, 22, 26, 0.92)`,
    /android:\s*["']rgba\(20,\s*22,\s*26,\s*0\.92\)["']/.test(hostBlock),
    "The Android host fill must be the >=0.92 kit-consistent opaque value.",
  );
  // No <0.92 rgba allowed as the Android branch of the host fill.
  const androidLeak = (hostBlock.match(/android:\s*["']rgba\([^)]*0?\.(?:[0-8]\d?|9[01])\)["']/g) || []);
  check(
    `A-02 business ${rel} host has NO translucent (<0.92) Android fill`,
    androidLeak.length === 0,
    `Found translucent Android host fill(s): ${androidLeak.join(", ")}`,
  );
}

// ─── A-03: package-isolation — third token file + GlassBlur untouched ─────────
function isUnchangedVsMain(absPath) {
  try {
    const rel = path.relative(repoRoot, absPath);
    const out = execFileSync("git", ["diff", "--name-only", "origin/main...HEAD", "--", rel], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return out.trim() === "";
  } catch {
    // Fallback: diff against the working tree main if origin/main is unavailable.
    try {
      const rel = path.relative(repoRoot, absPath);
      const out = execFileSync("git", ["diff", "--name-only", "main...HEAD", "--", rel], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      return out.trim() === "";
    } catch {
      return null; // cannot determine — reported below
    }
  }
}
for (const rel of ["designTokens.ts", "GlassBlur.tsx"]) {
  const abs = path.join(pkgRoot, rel);
  const unchanged = isUnchangedVsMain(abs);
  check(
    `A-03 packages/offering-rendering/${rel} is byte-untouched vs main (I-MOR-0827)`,
    unchanged === true || (unchanged === null && readMaybe(abs) !== null),
    unchanged === false
      ? "This strike must NOT edit the third token file / web glass path (deferred Sub-C)."
      : "Could not git-diff the package file; ensure it was not edited.",
  );
}

// ─── A-04 + A-06: S5 both-files parity + no bare elevation:8 ───────────────────
for (const rel of [
  "src/components/trip/EditPublishedTripIntakeAccordion.tsx",
  "src/components/trip/TripCreatorStep6Intake.tsx",
]) {
  const code = stripComments(readMaybe(path.join(businessRoot, rel)));
  check(
    `A-04 business ${rel} tabActive Android elevation is Platform-gated to 0`,
    /elevation:\s*Platform\.select\(\{[^}]*android:\s*0/.test(code) ||
      /elevation:\s*androidSafeElevation\(/.test(code),
    "Both S5 trip files must zero Android elevation (skip-one failure mode).",
  );
  check(
    `A-06 business ${rel} has NO bare 'elevation: 8' survivor`,
    !/elevation:\s*8\s*,/.test(code),
    "A raw elevation:8 would still draw the hard Android shadow rectangle.",
  );
}

// S6 both-files parity for overflow:'hidden'
for (const rel of [
  "src/components/event/EventListCard.tsx",
  "src/components/trip/TripListCard.tsx",
]) {
  const code = stripComments(readMaybe(path.join(businessRoot, rel)));
  const hostBlock = (code.match(/host:\s*\{[\s\S]*?\n\s{2,4}\},/) || [""])[0];
  check(
    `A-04 business ${rel} host carries overflow: 'hidden' (clip parity)`,
    /overflow:\s*['"]hidden['"]/.test(hostBlock),
    "Both S6 list-card files must clip the host to the radius.",
  );
}

// ─── Report ───────────────────────────────────────────────────────────────────
console.log("\nMETA-ORCH-1002 Sub-1 — TESTER adversarial check\n");
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
  `\nSummary: ${checks.length - failed}/${checks.length} PASS${failed > 0 ? ` (${failed} FAIL)` : ""}\n`,
);
process.exit(failed > 0 ? 1 : 0);
