#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * META-ORCH-1002 Sub-B (consumer Android glass Symptom-A sweep) — regression check.
 *
 * Pixel rendering cannot be unit-asserted in this repo (these "tests" are source-pattern
 * node scripts, matching the established app-mobile CI pattern + the Sub-1 sibling
 * scripts/ci/meta-orch-1002-android-glass-check.mjs). On-device pixel verification is the
 * tester's live-fire job (SPEC §5).
 *
 * Asserts the contract of SPEC_META-ORCH-1002_SUB-B_CONSUMER_GLASS.md:
 *   T-A  light-canvas (A1-A4)  overflow:'hidden' + Android opaque fill + Android elevation 0
 *   T-B  MED opaque-white (B1-B4)  overflow:'hidden' added
 *   T-C  dark-canvas (C1-C6)  overflow:'hidden'; C4/C6 Android elevation 0; fill PRESERVED
 *   T-iOS  iOS frozen  (A3/A4 keep translucent ios/default; C-bucket fill NOT opaque-ified)
 *
 * Exit 1 on any FAIL.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

const readMaybe = (absRel) => {
  try {
    return fs.readFileSync(absRel, "utf8");
  } catch {
    return null;
  }
};

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

// Pull a named StyleSheet block "<name>: { ... }" (first match), comments stripped.
const block = (code, styleName) => {
  const re = new RegExp(`${styleName}:\\s*\\{`);
  const m = re.exec(code);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  for (; i < code.length && depth > 0; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") depth--;
  }
  return code.slice(m.index, i);
};

const load = (rel) => {
  const src = readMaybe(path.join(root, rel));
  return src ? stripComments(src) : null;
};

const hasOverflowHidden = (b) => !!b && /overflow:\s*['"]hidden['"]/.test(b);
const hasAndroidElevationZero = (b) =>
  !!b && /android:\s*0|android:\s*\{[^}]*elevation:\s*0/.test(b);

// ── T-A: light-canvas (A1-A4) ────────────────────────────────────────────────
const A = [
  { rel: "src/components/IncomingPairRequestCard.tsx", style: "card", id: "A1", opaque: "#FFFFFF" },
  { rel: "src/components/PairingInfoCard.tsx", style: "card", id: "A2", opaque: "#FFFFFF" },
  { rel: "src/components/ui/MultiDayCalendar.tsx", style: "container", id: "A3", opaque: "#FFFFFF" },
  { rel: "src/components/connections/AddFriendView.tsx", style: "glassCard", id: "A4", opaque: "#FFFFFF" },
];
for (const { rel, style, id, opaque } of A) {
  const code = load(rel);
  const b = code ? block(code, style) : null;
  check(`T-A ${id} ${rel} ${style} has overflow:'hidden'`, hasOverflowHidden(b),
    "Light-canvas card must clip fill+border to the radius.");
  check(`T-A ${id} ${rel} ${style} fill is Platform.select with Android ${opaque}`,
    !!b && new RegExp(`backgroundColor:\\s*Platform\\.select\\(\\{[\\s\\S]*?android:\\s*['"]${opaque}['"]`).test(b),
    "Light-canvas fill must be opaque on Android via Platform.select.");
  check(`T-A ${id} ${rel} ${style} Android elevation resolves to 0`, hasAndroidElevationZero(b),
    "No hard Android shadow rectangle under the rounded fill.");
}

// ── T-B: MED opaque-white (B1-B4) — clip only ────────────────────────────────
const B = [
  { rel: "src/components/PairedPeopleRow.tsx", style: "card", id: "B1" },
  { rel: "src/components/profile/AccountSettings.tsx", style: "card", id: "B2" },
  { rel: "src/components/profile/BillingSheet.tsx", style: "currentCard", id: "B3" },
  { rel: "src/components/profile/BillingSheet.tsx", style: "tierCard", id: "B4" },
];
for (const { rel, style, id } of B) {
  const code = load(rel);
  const b = code ? block(code, style) : null;
  check(`T-B ${id} ${rel} ${style} has overflow:'hidden'`, hasOverflowHidden(b),
    "Opaque-white MED card must clip fill+border to the radius.");
}

// ── T-C: dark-canvas (C1-C6) — clip; elevation safety; fill PRESERVED ─────────
const C = [
  { rel: "src/components/onboarding/OnboardingShell.tsx", style: "secondaryCta", id: "C1", keepFill: "rgba(255, 255, 255, 0.45)", elev0: false },
  { rel: "src/components/connections/StartSwipingHeaderButton.tsx", style: "button", id: "C2", keepFill: "rgba(235, 120, 37, 0.18)", elev0: false },
  { rel: "src/components/activity/CalendarTab.tsx", style: "emptyState", id: "C3", keepFill: "rgba(235, 120, 37, 0.08)", elev0: false },
  { rel: "src/components/activity/CalendarTab.tsx", style: "accordionHeader", id: "C4", keepFill: "rgba(255, 255, 255, 0.06)", elev0: true },
  { rel: "src/components/activity/SavedTab.tsx", style: "emptyState", id: "C5", keepFill: "rgba(235, 120, 37, 0.08)", elev0: false },
  { rel: "src/components/connections/ChatListItem.tsx", style: "container", id: "C6", keepFill: "rgba(255, 255, 255, 0.075)", elev0: true },
];
for (const { rel, style, id, keepFill, elev0 } of C) {
  const code = load(rel);
  const b = code ? block(code, style) : null;
  check(`T-C ${id} ${rel} ${style} has overflow:'hidden'`, hasOverflowHidden(b),
    "Dark-canvas glass must clip to the radius.");
  check(`T-C ${id} ${rel} ${style} KEEPS its translucent glass fill (not opaque-ified)`,
    !!b && b.includes(keepFill),
    "Dark-canvas glass fill must be preserved (no opaque-ify).");
  if (elev0) {
    check(`T-C ${id} ${rel} ${style} Android elevation resolves to 0`, hasAndroidElevationZero(b),
      "No hard Android shadow rectangle under the rounded dark-glass surface.");
  }
}

// ── T-iOS: iOS frozen ────────────────────────────────────────────────────────
const mdc = load("src/components/ui/MultiDayCalendar.tsx");
check("T-iOS A3 MultiDayCalendar keeps the original ios/default translucent frost",
  !!mdc && /ios:\s*['"]rgba\(255, 255, 255, 0\.60\)['"][\s\S]*?default:\s*['"]rgba\(255, 255, 255, 0\.60\)['"]/.test(block(mdc, "container") || ""),
  "iOS must render the exact pre-change translucent frost (byte-identical).");
const afv = load("src/components/connections/AddFriendView.tsx");
check("T-iOS A4 AddFriendView keeps the original ios/default translucent frost",
  !!afv && /ios:\s*['"]rgba\(255, 255, 255, 0\.70\)['"][\s\S]*?default:\s*['"]rgba\(255, 255, 255, 0\.70\)['"]/.test(block(afv, "glassCard") || ""),
  "iOS must render the exact pre-change translucent frost (byte-identical).");

// ── Report ───────────────────────────────────────────────────────────────────
console.log("\nMETA-ORCH-1002 Sub-B — consumer Android glass Symptom-A sweep check\n");
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
