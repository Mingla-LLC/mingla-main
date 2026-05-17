#!/usr/bin/env node
/**
 * I-EVENT-DETAIL-CANCEL-NO-NAVIGATION strict-grep gate (ORCH-0862).
 *
 * Asserts that the event-detail screen's `handleCancelConfirm` callback at
 * `mingla-business/app/event/[id]/index.tsx` does NOT call `router.replace`,
 * `router.push`, or `router.back`. Navigating post-cancel races the native
 * iOS Modal exit animation (160ms reanimated + 200ms unmount delay) against
 * the synchronous unmount triggered by Expo Router — UIKit deadlocks and the
 * RN bridge stalls, freezing the entire app. Symptom A in ORCH-0862.
 *
 * The fix is to drop the navigation entirely; the screen re-renders in
 * place via the cache-invalidate refetch (see useCancelBusinessEvent +
 * writePublishedEventCaches). This mirrors the working hub-list flow at
 * `app/(tabs)/hub/events.tsx::handleCancelEventConfirm` which stays
 * mounted and dismisses the Modal cleanly.
 *
 * If a future author re-adds `router.replace` thinking it "feels right",
 * this gate fails the PR. The protective comment at the deleted-call site
 * also documents the why.
 *
 * Exit codes:
 *   0 — clean
 *   1 — router.replace / router.push / router.back present in handler
 *   2 — script error / file read failure
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const SCREEN_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "app",
  "event",
  "[id]",
  "index.tsx",
);

let violations = 0;
const details = [];

function fail(msg) {
  violations += 1;
  details.push(msg);
}

let source;
try {
  source = readFileSync(SCREEN_PATH, "utf8");
} catch (err) {
  console.error(`FATAL: could not read ${SCREEN_PATH}: ${err.message}`);
  process.exit(2);
}

// Locate the handleCancelConfirm useCallback body. The block runs from
// `handleCancelConfirm = useCallback(async (): Promise<void> => {` up to
// the closing `}, [...]);` of the useCallback expression.
const handlerMatch = source.match(
  /handleCancelConfirm\s*=\s*useCallback\(\s*async[\s\S]*?\}\s*,\s*\[[^\]]*\]\s*\)\s*;/,
);

if (handlerMatch === null) {
  fail(
    "could not locate handleCancelConfirm useCallback body — file structure may have changed; update this gate's regex if so",
  );
} else {
  const handler = handlerMatch[0];

  // Strip comments before grepping so the protective comment block (which
  // documents the prior behaviour by name) doesn't trigger the gate.
  const stripped = handler
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  const replaceMatches = stripped.match(/router\.replace\s*\(/g) ?? [];
  if (replaceMatches.length > 0) {
    fail(
      `handleCancelConfirm contains ${replaceMatches.length} \`router.replace(...)\` call(s) — see ORCH-0862 / Symptom A; navigation post-cancel races the iOS Modal exit animation and freezes the app. Drop the navigation; the screen re-renders in place via cache invalidate.`,
    );
  }

  const pushMatches = stripped.match(/router\.push\s*\(/g) ?? [];
  if (pushMatches.length > 0) {
    fail(
      `handleCancelConfirm contains ${pushMatches.length} \`router.push(...)\` call(s) — same race class as router.replace; drop the navigation.`,
    );
  }

  const backMatches = stripped.match(/router\.back\s*\(/g) ?? [];
  if (backMatches.length > 0) {
    fail(
      `handleCancelConfirm contains ${backMatches.length} \`router.back(...)\` call(s) — same race class as router.replace; drop the navigation.`,
    );
  }
}

// Verdict
if (violations === 0) {
  console.log(
    "[i-event-detail-cancel-no-navigation] PASS — handleCancelConfirm does not navigate (ORCH-0862 / Symptom A).",
  );
  process.exit(0);
}

console.error(
  `[i-event-detail-cancel-no-navigation] FAIL — ${violations} violation(s):`,
);
for (const detail of details) {
  console.error(`  - ${detail}`);
}
console.error(
  "\nFix: remove the router navigation from handleCancelConfirm. The screen re-renders in place via the React Query cache-invalidate refetch, mirroring the proven-working hub-list flow at app/(tabs)/hub/events.tsx::handleCancelEventConfirm.",
);
process.exit(1);
