#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * META-ORCH-1002 Sub-1 (Android glass first strike) — consumer-side regression check.
 *
 * Pixel rendering cannot be unit-asserted in this repo (these "tests" are
 * source-pattern node scripts, matching the established app-mobile CI pattern).
 * On-device pixel verification is the tester's live-fire job (SPEC §8.3).
 *
 * Asserts the consumer-side contract of SPEC_META-ORCH-1002_ANDROID_GLASS_FIRST_STRIKE.md:
 *   T-01  S2 shared gate exists      (designSystem.ts exports the opaque-fallback boolean)
 *   T-02  S2 gate adopted            (8 chrome files import it; NO live Platform.Version<31 gate)
 *   T-03  S1 clip + opaque unread    (NotificationsSheet clipped; cardUnreadBg Android #FFFAF4)
 *   T-04  S3 chat capsule guarded    (MessageInterface routes Android to opaque fallback)
 *   T-07  iOS frozen (consumer)      (every Platform.select kept its ios/default original value)
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

// Strip line + block comments so we never match the literal version-gate string
// that appears in our own explanatory comments.
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

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

const design = readMaybe(path.join(root, "src/constants/designSystem.ts"));
const designCode = design ? stripComments(design) : "";

// ─── T-01: S2 shared gate exists ────────────────────────────────────────────
check(
  "T-01 designSystem.ts exports ANDROID_GLASS_USES_OPAQUE_FALLBACK = Platform.OS === 'android'",
  design !== null &&
    /export\s+const\s+ANDROID_GLASS_USES_OPAQUE_FALLBACK\s*=\s*Platform\.OS\s*===\s*['"]android['"]/.test(
      designCode,
    ),
  "The shared Android-opaque-fallback gate must be a single exported boolean.",
);
check(
  "T-01 designSystem.ts imports Platform from react-native",
  design !== null &&
    /import\s+\{[^}]*\bPlatform\b[^}]*\}\s+from\s+['"]react-native['"]/.test(
      designCode,
    ),
  "Platform must be imported for the gate + cardUnreadBg Platform.select.",
);

// ─── T-02: S2 gate adopted in all 8 chrome files ────────────────────────────
for (const rel of CHROME_FILES) {
  const src = readMaybe(path.join(root, rel));
  const code = src ? stripComments(src) : "";
  check(
    `T-02 ${rel} imports ANDROID_GLASS_USES_OPAQUE_FALLBACK`,
    src !== null &&
      /ANDROID_GLASS_USES_OPAQUE_FALLBACK/.test(code) &&
      new RegExp(
        "import\\s+\\{[^}]*ANDROID_GLASS_USES_OPAQUE_FALLBACK[^}]*\\}\\s+from\\s+['\"][^'\"]*constants/designSystem['\"]",
      ).test(code),
    "Each chrome file must import the shared gate.",
  );
  check(
    `T-02 ${rel} retains NO live Platform.Version < 31 glass gate`,
    src !== null && !/Platform\.Version\s*<\s*31/.test(code),
    "No file may keep the per-component Android-11 version gate after the strike.",
  );
}

// ─── T-03: S1 clip + opaque unread ──────────────────────────────────────────
const notif = readMaybe(path.join(root, "src/components/NotificationsSheet.tsx"));
const notifCode = notif ? stripComments(notif) : "";
check(
  "T-03 NotificationsSheet notificationCard has overflow: 'hidden'",
  notif !== null &&
    /notificationCard:\s*\{[\s\S]*?overflow:\s*['"]hidden['"][\s\S]*?\},/.test(
      notifCode,
    ),
  "notificationCard must clip fill+border to the radius (kills the corner ring).",
);
check(
  "T-03 NotificationsSheet skeletonCard has overflow: 'hidden'",
  notif !== null &&
    /skeletonCard:\s*\{[\s\S]*?overflow:\s*['"]hidden['"][\s\S]*?\},/.test(
      notifCode,
    ),
  "skeletonCard must clip to the radius (mirror notificationCard).",
);
check(
  "T-03 designSystem cardUnreadBg is a Platform.select with android: '#FFFAF4'",
  design !== null &&
    /cardUnreadBg:\s*Platform\.select\(\{[\s\S]*?android:\s*['"]#FFFAF4['"][\s\S]*?\}\)/.test(
      designCode,
    ),
  "Unread fill must be opaque #FFFAF4 on Android via Platform.select.",
);

// ─── T-04: S3 chat capsule guarded ──────────────────────────────────────────
const msg = readMaybe(path.join(root, "src/components/MessageInterface.tsx"));
const msgCode = msg ? stripComments(msg) : "";
check(
  "T-04 MessageInterface imports ANDROID_GLASS_USES_OPAQUE_FALLBACK",
  msg !== null && /ANDROID_GLASS_USES_OPAQUE_FALLBACK/.test(msgCode),
  "The chat capsule must read the shared gate.",
);
check(
  "T-04 MessageInterface capsule renders the opaque fallback branch keyed on the gate",
  msg !== null &&
    /ANDROID_GLASS_USES_OPAQUE_FALLBACK\s*\?\s*\([\s\S]*?glass\.chrome\.fallback\.solid/.test(
      msgCode,
    ),
  "On Android the capsule must paint glass.chrome.fallback.solid, not the BlurView.",
);
check(
  "T-04 MessageInterface BlurView is no longer the unconditional first child of the capsule",
  msg !== null &&
    !/inputCapsule\}\s*>\s*<BlurView/.test(msgCode.replace(/\s+/g, " ").replace(/\] >/g, "]>")),
  "The BlurView must now live behind the iOS branch of the gate, not unconditionally.",
);

// ─── T-07: iOS frozen (consumer) ────────────────────────────────────────────
check(
  "T-07 cardUnreadBg keeps the original iOS/default translucent cream",
  design !== null &&
    /cardUnreadBg:\s*Platform\.select\(\{[\s\S]*?ios:\s*['"]rgba\(255,\s*247,\s*237,\s*0\.6\)['"][\s\S]*?default:\s*['"]rgba\(255,\s*247,\s*237,\s*0\.6\)['"]/.test(
      designCode,
    ),
  "iOS must render the exact pre-change translucent cream (byte-identical).",
);
check(
  "T-07 MessageInterface keeps the BlurView + tint floor on the iOS branch",
  msg !== null &&
    /<BlurView[\s\S]*?glass\.chrome\.blur\.intensity[\s\S]*?glass\.chrome\.tint\.floor/.test(
      msgCode,
    ),
  "iOS must still render the BlurView + 0.48 tint floor exactly as today.",
);

// ─── Report ──────────────────────────────────────────────────────────────────
console.log("\nMETA-ORCH-1002 Sub-1 — consumer Android glass check\n");
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
