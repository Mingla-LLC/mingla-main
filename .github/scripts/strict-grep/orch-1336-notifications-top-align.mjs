#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — ORCH-1336 [notifications-sheet-gap].
 * Invariant: I-PROPOSED-1336-NOTIFICATIONS-TOP-ALIGN (DRAFT until CLOSE).
 *
 * The consumer NotificationsSheet populated + ONLINE body must contribute NO
 * flex-growing sibling above the section list. Before the fix, the populated
 * branch of renderBody() returned an EMPTY `<View style={styles.notificationsBody}>`
 * where `notificationsBody` was `{ flex: 1, minHeight: 0 }`. BaseBottomSheet
 * (scrollMode="sectionlist") renders `{header}{children}{BottomSheetSectionList
 * (flex:1)}` as sibling children, so two flex:1 siblings (the empty wrapper +
 * the list) split the bounded sheet height ~50/50 — the empty wrapper ate the
 * top half (a large gap under the header) and the list was shoved into the
 * bottom half, floating a lone card mid-sheet.
 *
 * The fix (approach A): the populated branch returns `null` when online, so the
 * section list claims ALL bounded height below the header and the notifications
 * hug the top. The offline banner still renders ABOVE the list, in its own
 * intrinsic-height View (no flex:1), when offline.
 *
 * Over app-mobile/src/components/NotificationsSheet.tsx (COMMENT-STRIPPED) REQUIRE:
 *   C1: the populated branch returns null when online —
 *       `if (!(isOffline && notifications.length > 0)) {` immediately followed by
 *       `return null;`.
 *   C2: the flex:1 gap-wrapper STYLE is gone — no `notificationsBody:` style
 *       block containing `flex: 1`.
 *   C3: no JSX renders the gap wrapper — no `style={styles.notificationsBody}`.
 *   C4: the offline banner is preserved with a stable testable id —
 *       `testID="notifications-offline-banner-wrap"` AND `style={styles.offlineBanner}`
 *       AND the localized `notifications:offline.banner`.
 *   C5: sole-gorhom-consumer invariant echo — NotificationsSheet must NOT import
 *       `@gorhom/bottom-sheet` (BaseBottomSheet is the sole consumer).
 *
 * Comments are stripped first so the fix's own explanatory comment (which
 * mentions `styles.notificationsBody` and `@gorhom/bottom-sheet`) cannot trip
 * C2/C3/C5, mirroring meta-orch-0991-base-bottom-sheet-sole-consumer.mjs.
 *
 * --self-test injects fixtures: the real fix passes; the synthetic pre-fix
 * source (old empty flex:1 wrapper + `notificationsBody: { flex: 1, minHeight: 0 }`)
 * fires; each individual violation fires; a banned token inside a COMMENT is
 * stripped and still passes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const TARGET = "app-mobile/src/components/NotificationsSheet.tsx";

// Strip block + line comments. The `[^:]` before `//` preserves `://` (e.g.
// `mingla://`, `https://`) so real code is never mangled.
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// C1 — populated branch returns null when online (no flex sibling above the list).
const C1_NULL_WHEN_ONLINE =
  /if\s*\(!\(isOffline\s*&&\s*notifications\.length\s*>\s*0\)\)\s*\{\s*return null;/;
// C2 — the flex:1 gap-wrapper style block (the exact bug signature).
const C2_GAP_STYLE = /notificationsBody:\s*\{[\s\S]*?flex:\s*1/;
// C3 — the gap-wrapper JSX above the list.
const C3_GAP_JSX = /style=\{styles\.notificationsBody\}/;
// C4 — offline banner preserved (testable id + style + localized copy).
const C4_TESTID = /testID="notifications-offline-banner-wrap"/;
const C4_STYLE = /style=\{styles\.offlineBanner\}/;
const C4_LOCALE = /notifications:offline\.banner/;
// C5 — no direct gorhom import (sole-consumer echo).
const C5_GORHOM_IMPORT = /import\s+[\s\S]*?from\s+['"]@gorhom\/bottom-sheet['"]/;

/**
 * Returns an array of [check, message] failures for a raw source string.
 * Shared by live mode and --self-test so both exercise identical logic.
 */
function collectFailures(rawSrc) {
  const src = stripComments(rawSrc);
  const out = [];

  if (!C1_NULL_WHEN_ONLINE.test(src)) {
    out.push([
      "C1: null-when-online",
      "the populated branch must return null when online — " +
        "`if (!(isOffline && notifications.length > 0)) { return null; }` — so no " +
        "flex-growing sibling sits above the BottomSheetSectionList.",
    ]);
  }
  if (C2_GAP_STYLE.test(src)) {
    out.push([
      "C2: no-flex-gap-style",
      "the flex:1 `notificationsBody` style block must be deleted (it split the " +
        "bounded sheet height ~50/50 and opened the mid-sheet gap).",
    ]);
  }
  if (C3_GAP_JSX.test(src)) {
    out.push([
      "C3: no-gap-wrapper-jsx",
      "no JSX may render the flex:1 `styles.notificationsBody` wrapper above the " +
        "section list.",
    ]);
  }
  if (!C4_TESTID.test(src)) {
    out.push([
      "C4: offline-banner-preserved",
      'the offline banner wrapper must carry testID="notifications-offline-banner-wrap".',
    ]);
  }
  if (!C4_STYLE.test(src)) {
    out.push([
      "C4: offline-banner-preserved",
      "the offline banner must still render via style={styles.offlineBanner} " +
        "(offline parity — banner above the list).",
    ]);
  }
  if (!C4_LOCALE.test(src)) {
    out.push([
      "C4: offline-banner-preserved",
      "the offline banner must still render its localized copy (notifications:offline.banner).",
    ]);
  }
  if (C5_GORHOM_IMPORT.test(src)) {
    out.push([
      "C5: sole-gorhom-consumer",
      "NotificationsSheet must NOT import @gorhom/bottom-sheet (BaseBottomSheet is " +
        "the sole consumer; I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER).",
    ]);
  }
  return out;
}

// ── Self-test mode ───────────────────────────────────────────────────────────
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (s) => collectFailures(s);

  // Compliant fixture — mirrors the real fix. Must produce ZERO failures.
  const good = `
import React from 'react';
import { BaseBottomSheet } from './ui/BaseBottomSheet';
const renderBody = () => {
    if (!(isOffline && notifications.length > 0)) {
      return null;
    }
    return (
      <View style={styles.offlineBanner} testID="notifications-offline-banner-wrap">
        <Icon name="cloud-offline-outline" size={14} color={colors.gray[500]} />
        <Text style={styles.offlineBannerText}>
          {t('notifications:offline.banner')}
        </Text>
      </View>
    );
  };
const styles = StyleSheet.create({
  offlineBanner: { marginTop: 12, flexDirection: 'row' },
  offlineBannerText: { fontSize: 13 },
});
`;
  if (run(good).length !== 0) {
    selfFailures.push("compliant fix wrongly flagged: " + JSON.stringify(run(good)));
  }

  // Synthetic PRE-FIX source — the exact regression this gate kills. Must FIRE
  // (C1 missing null-return, C2 flex:1 style present, C3 gap-wrapper JSX present).
  const preFix = `
const renderBody = () => {
    return (
      <View style={styles.notificationsBody}>
        {isOffline && notifications.length > 0 && (
          <View style={styles.offlineBanner}>
            <Icon name="cloud-offline-outline" size={14} color={colors.gray[500]} />
            <Text style={styles.offlineBannerText}>
              {t('notifications:offline.banner')}
            </Text>
          </View>
        )}
      </View>
    );
  };
const styles = StyleSheet.create({
  notificationsBody: {
    flex: 1,
    minHeight: 0,
  },
  offlineBanner: { marginTop: 12 },
  offlineBannerText: { fontSize: 13 },
});
`;
  const preFixFound = run(preFix).map(([c]) => c);
  if (run(preFix).length === 0) {
    selfFailures.push("synthetic pre-fix source (the gap wrapper) not flagged");
  }
  for (const expected of ["C1: null-when-online", "C2: no-flex-gap-style", "C3: no-gap-wrapper-jsx"]) {
    if (!preFixFound.includes(expected)) {
      selfFailures.push(`pre-fix source did not fire ${expected}`);
    }
  }

  // C1 removed (null-return deleted) → fire.
  const noNullReturn = good.replace(
    /if \(!\(isOffline && notifications\.length > 0\)\) \{\s*return null;\s*\}/,
    "",
  );
  if (!run(noNullReturn).some(([c]) => c === "C1: null-when-online")) {
    selfFailures.push("removed null-when-online guard not flagged (C1)");
  }

  // C2 re-added (flex:1 notificationsBody style) → fire.
  const gapStyle = good.replace(
    "offlineBanner: { marginTop: 12, flexDirection: 'row' },",
    "notificationsBody: { flex: 1, minHeight: 0 },\n  offlineBanner: { marginTop: 12, flexDirection: 'row' },",
  );
  if (!run(gapStyle).some(([c]) => c === "C2: no-flex-gap-style")) {
    selfFailures.push("re-added flex:1 notificationsBody style not flagged (C2)");
  }

  // C3 re-added (gap-wrapper JSX) → fire.
  const gapJsx = good.replace(
    '<View style={styles.offlineBanner} testID="notifications-offline-banner-wrap">',
    '<View style={styles.notificationsBody}><View style={styles.offlineBanner} testID="notifications-offline-banner-wrap">',
  );
  if (!run(gapJsx).some(([c]) => c === "C3: no-gap-wrapper-jsx")) {
    selfFailures.push("re-added gap-wrapper JSX not flagged (C3)");
  }

  // C4 testID removed → fire.
  const noTestId = good.replace(' testID="notifications-offline-banner-wrap"', "");
  if (!run(noTestId).some(([c]) => c === "C4: offline-banner-preserved")) {
    selfFailures.push("removed offline-banner testID not flagged (C4)");
  }

  // C4 offline-banner style removed → fire.
  const noOfflineStyle = good.replace("style={styles.offlineBanner} ", "");
  if (!run(noOfflineStyle).some(([c]) => c === "C4: offline-banner-preserved")) {
    selfFailures.push("removed offline-banner style not flagged (C4)");
  }

  // C4 localized copy removed → fire.
  const noLocale = good.replace("notifications:offline.banner", "offline.banner.text");
  if (!run(noLocale).some(([c]) => c === "C4: offline-banner-preserved")) {
    selfFailures.push("removed offline banner locale not flagged (C4)");
  }

  // C5 direct gorhom import re-added → fire.
  const gorhom = good + "\nimport { BottomSheetSectionList } from '@gorhom/bottom-sheet';\n";
  if (!run(gorhom).some(([c]) => c === "C5: sole-gorhom-consumer")) {
    selfFailures.push("re-added @gorhom/bottom-sheet import not flagged (C5)");
  }

  // Banned tokens inside COMMENTS must be stripped → compliant still passes.
  const commented =
    good +
    "\n// legacy note: the old <View style={styles.notificationsBody}> gap wrapper is gone\n" +
    "/* the flex:1 notificationsBody: { flex: 1 } style and the @gorhom/bottom-sheet import moved out */\n";
  if (run(commented).length !== 0) {
    selfFailures.push(
      "commented banned tokens wrongly flagged (comment-strip broken): " +
        JSON.stringify(run(commented)),
    );
  }

  if (selfFailures.length) {
    console.error("ORCH-1336 notifications-top-align self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1336 notifications-top-align self-test PASS (10/10 cases).");
  process.exit(0);
}

// ── Live mode ────────────────────────────────────────────────────────────────
let failures = 0;
function fail(check, message) {
  failures += 1;
  console.error(`FAIL [${check}] ${message}`);
}
function ok(check, message) {
  console.log(`OK   [${check}] ${message}`);
}

const abs = path.join(REPO_ROOT, TARGET);
if (!fs.existsSync(abs)) {
  fail("FATAL", `target not found at ${TARGET} (gate path out of sync).`);
  process.exit(1);
}

const found = collectFailures(fs.readFileSync(abs, "utf8"));
if (found.length > 0) {
  for (const [check, message] of found) fail(check, message);
} else {
  ok(
    "C1: null-when-online",
    "populated branch returns null when online — the section list claims all height and notifications hug the top",
  );
  ok("C2: no-flex-gap-style", "the flex:1 notificationsBody gap wrapper style is deleted");
  ok("C3: no-gap-wrapper-jsx", "no JSX renders the flex:1 notificationsBody wrapper above the list");
  ok("C4: offline-banner-preserved", "offline banner still renders above the list (testID + style + localized copy)");
  ok("C5: sole-gorhom-consumer", "NotificationsSheet does not import @gorhom/bottom-sheet directly");
}

if (failures > 0) {
  console.error(
    `\nORCH-1336 (I-PROPOSED-1336-NOTIFICATIONS-TOP-ALIGN) strict-grep failed with ${failures} failure(s).\n` +
      "The consumer NotificationsSheet populated+online body must contribute no flex-growing\n" +
      "sibling above the section list, so notifications hug the top of the sheet.",
  );
  process.exit(1);
}

console.log("\nORCH-1336 notifications-top-align strict-grep passed.");
process.exit(0);
