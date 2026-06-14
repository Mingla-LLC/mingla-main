#!/usr/bin/env node

/**
 * I-PROPOSED-TOPSHEET-WEB-VIEWPORT-ANCHOR  (ORCH-1136 Batch B / F-3)
 *
 * THE BUG (forensics-proven, deterministic CSS harness): TopSheet's root overlay
 * was a bare `StyleSheet.absoluteFill` (`position:absolute; top:0`), which on web
 * anchors to the nearest positioned ancestor — the scrollable route host. When the
 * Hub host was document-scrolled, the panel's `top: insets.top + 76` landed ABOVE
 * the browser viewport (panel top measured −524px scrolled-600 vs the correct 76px
 * unscrolled), so only the bottom row peeked. Home's host is viewport-bound, so it
 * was always correct.
 *
 * THE FIX: on web ONLY, the root overlay gets `position: 'fixed'` so it anchors to
 * the browser VIEWPORT, not the scrollable host — making the anchor scroll-
 * independent at 76px. `position:'fixed'` is a valid react-native-web value but NOT
 * a valid RN native value, hence the Platform gate; native keeps bare
 * `StyleSheet.absoluteFill` UNCHANGED.
 *
 * THE RULE: TopSheet.tsx MUST apply `position: 'fixed'` to the overlay root only
 * behind a `Platform.OS === 'web'` guard, and the native path MUST still use
 * `StyleSheet.absoluteFill`. FAILS on a revert to a bare `absoluteFill` root (the
 * Hub-offset regression) or on a `position:'fixed'` that is NOT web-gated (would
 * crash/no-op on native).
 *
 * Scope: the single shared primitive mingla-business/src/components/ui/TopSheet.tsx.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const REL = "mingla-business/src/components/ui/TopSheet.tsx";
const filePath = path.join(repoRoot, REL);

let src;
try {
  src = fs.readFileSync(filePath, "utf8");
} catch {
  console.error(
    `\nFAIL [I-PROPOSED-TOPSHEET-WEB-VIEWPORT-ANCHOR]: cannot read ${REL}\n`,
  );
  process.exit(1);
}

const violations = [];

// (1) A web-gated position:'fixed' must exist. Match `Platform.OS === "web"`
// (single or double quotes) on the same construct that yields `position: "fixed"`.
const hasWebGate = /Platform\.OS\s*===\s*["']web["']/.test(src);
const hasFixed = /position:\s*["']fixed["']/.test(src);
if (!hasWebGate) {
  violations.push(
    "no `Platform.OS === \"web\"` gate found — the viewport anchor must be web-gated.",
  );
}
if (!hasFixed) {
  violations.push(
    "no `position: \"fixed\"` found — the web overlay must anchor to the viewport (reverted to bare absoluteFill = the Hub-offset regression).",
  );
}

// (2) The position:'fixed' must be co-located with the web gate (same expression),
// not an un-gated native crash. Isolate the rootOverlayStyle ternary region.
if (hasFixed && hasWebGate) {
  const rootIdx = src.indexOf("rootOverlayStyle");
  if (rootIdx < 0) {
    violations.push(
      "expected a `rootOverlayStyle` web-gated style variable carrying the position:'fixed' anchor.",
    );
  } else {
    // Take a window around the rootOverlayStyle definition and assert BOTH the
    // web gate and position:'fixed' co-occur there.
    const region = src.slice(rootIdx, rootIdx + 400);
    const gatedFixed =
      /Platform\.OS\s*===\s*["']web["']/.test(region) &&
      /position:\s*["']fixed["']/.test(region);
    if (!gatedFixed) {
      violations.push(
        "`rootOverlayStyle` does not co-locate the `Platform.OS === \"web\"` gate with `position: \"fixed\"` — the fixed anchor must be applied ONLY on web.",
      );
    }
  }
}

// (3) Native path must still reference StyleSheet.absoluteFill (unchanged).
if (!/StyleSheet\.absoluteFill/.test(src)) {
  violations.push(
    "`StyleSheet.absoluteFill` missing — the native overlay path must still use absoluteFill (no position:'fixed' on native).",
  );
}

if (violations.length > 0) {
  console.error("\nFAIL [I-PROPOSED-TOPSHEET-WEB-VIEWPORT-ANCHOR]:");
  console.error(
    "  TopSheet must anchor its web overlay to the viewport via a web-gated position:'fixed';",
  );
  console.error("  native must keep bare StyleSheet.absoluteFill (ORCH-1136 F-3).");
  for (const v of violations) console.error(`  ✗ ${v}`);
  console.error("");
  process.exit(1);
}

console.log(
  "OK [I-PROPOSED-TOPSHEET-WEB-VIEWPORT-ANCHOR]: TopSheet web overlay is viewport-anchored via web-gated position:'fixed'; native keeps absoluteFill.",
);
