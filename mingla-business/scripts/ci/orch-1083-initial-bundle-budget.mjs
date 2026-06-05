#!/usr/bin/env node
/**
 * ORCH-1083 — initial-web-bundle budget guard (M-3 / SC-3 / I-PROPOSED-1083-A).
 *
 * Run AFTER `npm run web:export` (from mingla-business/). Asserts:
 *   1. The initial JS payload (sum of every <script> referenced by
 *      web-build/index.html, RAW bytes) is <= a budget ceiling. This fails CI if
 *      a future eager-import regresses the boot bundle.
 *   2. There are >= 3 chunk files under _expo/static/js/web/ (proves code-split
 *      points still exist — the lazy connect bodies + route chunks).
 *   3. The MAIN entry chunk (the largest index-*.js — the 9 MB app bulk) does
 *      NOT statically reference any of the four deferred specifiers (Stripe
 *      Connect web SDK, the QR renderer, the 14 @expo-google-fonts/* families).
 *      They must live only in split chunks.
 *   4. Metro's eager `__common` shared chunk stays small (<= a tight cap), so it
 *      cannot become a back-door bulk-leak vector. (Metro hoists the small
 *      @stripe/react-connect-js React wrapper — shared by the 5 lazy connect
 *      bodies — into __common; that ~18 KB wrapper is acceptable, but the cap
 *      guarantees the heavy SDK / QR / font bulk never re-enters via __common.)
 *
 * This is the durable guard against organic re-bloat: any of the deferred deps'
 * BULK reappearing in the entry, or the entry growing past the ceiling, fails.
 *
 * Self-test: pass `--self-test`.
 *
 * Refs: SPEC §6 M-3, §8 I-PROPOSED-1083-A.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const WEB_BUILD = process.env.ORCH_1083_WEB_BUILD ?? "web-build";
const JS_DIR = join(WEB_BUILD, "_expo", "static", "js", "web");

// Ceiling = measured AFTER initial payload (9,131,533 bytes) + ~3% headroom.
// If a legitimate future increase is needed, bump this AND record why.
const CEILING_RAW_BYTES = Number(process.env.ORCH_1083_CEILING ?? 9_405_478);

// Eager __common shared-chunk cap. Measured AFTER = 17,651 bytes; cap at 50 KB
// so the heavy deferred bulk can never re-enter the boot path via __common.
const HAS_ORCH_1085_STATIC_HOME = existsSync(join(WEB_BUILD, "home.html"));
const COMMON_CAP_BYTES = Number(
  process.env.ORCH_1083_COMMON_CAP ??
    (HAS_ORCH_1085_STATIC_HOME ? 2_250_000 : 50_000),
);

// The four deferred specifiers (must NOT appear in the initial-payload scripts).
const DEFERRED_SPECIFIERS = [
  "@stripe/connect-js",
  "@stripe/react-connect-js",
  "react-native-qrcode-svg",
  "@expo-google-fonts/",
];

function fail(msg) {
  console.error(`ORCH-1083 bundle-budget FAIL: ${msg}`);
  process.exit(1);
}

if (process.argv.includes("--self-test")) {
  // Self-test: prove the deferred-specifier detection works against a fixture.
  const fixture =
    'import x from "@stripe/connect-js"; const y = "ok";';
  const hit = DEFERRED_SPECIFIERS.find((s) => fixture.includes(s));
  if (hit !== "@stripe/connect-js") {
    console.error("ORCH-1083 bundle-budget self-test FAILED: detector broken.");
    process.exit(1);
  }
  console.log("ORCH-1083 bundle-budget self-test PASS.");
  process.exit(0);
}

// Read index.html and extract the eagerly-loaded <script src> entries.
let html;
try {
  html = readFileSync(join(WEB_BUILD, "index.html"), "utf8");
} catch (err) {
  fail(`cannot read ${WEB_BUILD}/index.html (run "npm run web:export" first): ${err.message}`);
}

const scriptRels = [...html.matchAll(/\/_expo\/static\/js\/web\/[^"']+\.js/g)].map(
  (m) => m[0],
);
if (scriptRels.length === 0) {
  fail("no <script> references found in index.html");
}

// 1 — initial-payload raw bytes <= ceiling.
let initialRaw = 0;
for (const rel of scriptRels) {
  const abs = join(WEB_BUILD, rel.replace(/^\//, ""));
  initialRaw += statSync(abs).size;
}
if (initialRaw > CEILING_RAW_BYTES) {
  fail(
    `initial JS payload ${initialRaw} bytes exceeds ceiling ${CEILING_RAW_BYTES} ` +
      `(an eager-import regression likely re-bloated the boot bundle).`,
  );
}

// 2 — >= 3 chunk files exist.
const allChunks = readdirSync(JS_DIR).filter((n) => n.endsWith(".js"));
if (allChunks.length < 3) {
  fail(
    `expected >= 3 chunk files under ${JS_DIR}, found ${allChunks.length} ` +
      `(code-split points missing).`,
  );
}

// 3 — deferred specifiers must NOT be statically referenced by the MAIN entry
// chunk (the largest index-*.js — the app bulk). The small eager __common
// shared chunk is excluded here and capped separately in check 4.
const mainRel = scriptRels
  .filter((r) => /\/index-[0-9a-f]+\.js$/.test(r))
  .map((r) => ({ rel: r, size: statSync(join(WEB_BUILD, r.replace(/^\//, ""))).size }))
  .sort((a, b) => b.size - a.size)[0];
if (!mainRel) {
  fail("could not identify the main entry chunk (index-*.js) in index.html");
}
const mainSrc = readFileSync(join(WEB_BUILD, mainRel.rel.replace(/^\//, "")), "utf8");
const mainOffenders = DEFERRED_SPECIFIERS.filter((s) => mainSrc.includes(s));
if (mainOffenders.length > 0) {
  fail(
    `deferred specifier(s) leaked back into the MAIN entry chunk ${mainRel.rel}:\n  ` +
      mainOffenders.join("\n  "),
  );
}

// ORCH-1085: async route splitting can legitimately create a larger shared
// runtime chunk, so protect ORCH-1083's original deferrals across every eager
// script instead of relying only on the old tiny __common cap.
const eagerOffenders = [];
for (const rel of scriptRels) {
  const src = readFileSync(join(WEB_BUILD, rel.replace(/^\//, "")), "utf8");
  for (const specifier of DEFERRED_SPECIFIERS) {
    if (src.includes(specifier)) {
      eagerOffenders.push(`${rel}: ${specifier}`);
    }
  }
}
if (eagerOffenders.length > 0) {
  fail(
    `deferred specifier(s) leaked back into eager script(s):\n  ` +
      eagerOffenders.join("\n  "),
  );
}

// 4 — eager __common shared chunk must stay under the cap.
const commonRel = scriptRels.find((r) => r.includes("__common"));
if (commonRel) {
  const commonSize = statSync(join(WEB_BUILD, commonRel.replace(/^\//, ""))).size;
  if (commonSize > COMMON_CAP_BYTES) {
    fail(
      `eager __common chunk is ${commonSize} bytes, over the ${COMMON_CAP_BYTES}-byte cap ` +
        `(heavy deferred bulk may have re-entered the boot path via __common).`,
    );
  }
}

console.log(
  `ORCH-1083 bundle-budget PASS — initial payload ${initialRaw} bytes ` +
    `(ceiling ${CEILING_RAW_BYTES}), ${allChunks.length} chunk files, ` +
    `0 deferred specifiers in the main entry chunk, __common within cap.`,
);
