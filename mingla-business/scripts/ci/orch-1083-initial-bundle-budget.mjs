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

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const WEB_BUILD = process.env.ORCH_1083_WEB_BUILD ?? "web-build";
const JS_DIR = join(WEB_BUILD, "_expo", "static", "js", "web");

// Ceiling = measured AFTER initial payload (9,131,533 bytes) + ~3% headroom.
// If a legitimate future increase is needed, bump this AND record why.
const CEILING_RAW_BYTES = Number(process.env.ORCH_1083_CEILING ?? 9_405_478);

// Eager __common shared-chunk cap.
//
// ORCH-1098 Stage 3: the ORCH-1085 static `home.html` stand-in was DELETED (the
// real Expo SPA now boots `/home` on every device, the BottomNav reanimated OOM
// being fixed). The cap was previously relaxed to 2.25 MB ONLY while that static
// home existed (`HAS_ORCH_1085_STATIC_HOME ? 2_250_000 : 50_000`); with the
// stand-in gone, that conditional would snap the cap back to 50 KB and fail the
// CI build even though the real boot `__common` (~1.89 MB) is UNCHANGED by this
// ORCH — it is the SPA's pre-existing eager shared chunk, not new weight. We
// therefore pin the cap to the already-sanctioned 2.25 MB unconditionally so the
// budget reflects the real (and only) boot path. Tightening __common is its own
// future ORCH; this ORCH must not regress an unrelated bundle metric.
//
// ORCH-1373 rebaseline 2026-07-18: __common has organically grown from ~1.89 MB
// (when the 2.25 MB cap was set) to ~2.25 MB across MANY merged ORCHs, so main
// was already AT the cap before this PR. ORCH-1373's NECESSARY boot-path
// correctness additions — the P0 `isSignInRoute("/auth")` fix (coldLoadAuthGates),
// the ORCH-1377 auth-bootstrap diagnostics (AuthContext), and the ORCH-1378
// web-shim exports `_layout` requires — pushed it to 2,254,684 B, ~4.7 KB over.
// VERIFIED this is NOT the regression this guard targets: no deferred heavy dep
// (Stripe web SDK / QR / 14 fonts) re-entered — the deferred-specifier check
// still PASSES; the appsFlyer/oneSignal web shims are pure no-ops. This is
// organic boot growth, not re-bloat. Per the "future ORCH" note above, the real
// __common tightening is tracked as its OWN ORCH (registered from this PR).
// Cap raised to 2.30 MB (~45 KB headroom over current) — the tripwire stays live.
//
// ORCH-1390 rebaseline 2026-07-30: the cross-surface Stay launch adds one shared
// domain contract (exact-currency parsing, Room/Place cart invariants, query
// keys) plus @stripe/stripe-js's small official remote-script loader. Both the
// 930-line booking renderer and the Payment Element implementation are behind
// nested React.lazy boundaries and emit dedicated Stay chunks; the prior
// @stripe/react-stripe-js wrapper was removed after it proved unnecessary.
// Measured __common is 2,309,350 B. Raising the cap by only 20 KB preserves
// ~10 KB of tripwire headroom without duplicating Stay rules between the public
// booking and reservation-management routes.
//
// #1503 rebaseline 2026-08-03 (issue #1503 [stay-date-pickers]): MEASURED, not
// estimated. Baseline export of `origin/main` @ c3cc5e7af gives __common =
// 2,316,499 B (3,501 B of headroom left); this branch gives 2,320,369 B — a
// +3,870 B delta that lands 369 B over the old cap.
//
// WHAT the delta is: exactly one new module, `packages/brand-rendering/
// stayDateRules.ts` — the pure venue-local Stay date rules (parse/format at noon
// anchoring, `venueToday` via Intl, horizon/min-notice/ordering bounds, the
// guest-facing copy). Metro hoists it into __common because TWO async chunks
// import it: the lazy buyer Stay chunk (StayGuestBooking + StayDateRangeField)
// and the business venue chunk (ui/DateField -> VenueBlackoutSheet).
//
// WHY it is NOT the regression this tripwire targets: nothing deferred re-entered
// the boot path — the deferred-specifier check (Stripe web SDK / QR / fonts)
// still PASSES, and `@react-native-community/datetimepicker` internals were
// ALREADY in baseline __common via the six pre-existing #1027 consumers, so the
// new picker adds no native-module weight (verified: the `.native.tsx` half is
// absent from the web export and present in the iOS export). This is ~3.8 KB of
// plain date arithmetic.
//
// WHY the module is not split to dodge the cap: SPEC #1503 §12 makes "all date
// math lives in exactly ONE pure module" the structural safeguard against the
// very drift this issue fixed (three competing definitions of "today" coexisting
// across surfaces). Splitting it to save 3 KB would trade a correctness
// invariant for bundle bytes.
//
// Cap raised by 10 KB to 2,330,000 B, preserving ~9.6 KB of live tripwire
// headroom — the same increment and posture as the ORCH-1390 rebaseline above.
//
// #871 rebaseline 2026-08-10 (see-who's-going attendance handoff): the required
// public-route exemption is the only #871 work left in the eager auth gate. The
// claim service, deep-link parser, app icon, and roster UI all remain in deferred
// route chunks, and the guard below still finds zero deferred specifiers in the
// eager payload. Exact fresh exports of the same source measured __common at
// 2,329,953 B on macOS and 2,330,102 B on GitHub's Linux runner — a 149 B
// platform variance that left the prior cap 102 B below the Linux artifact.
// Raising by the established 10 KB increment restores ~9.9 KB of live headroom
// without relaxing the 9.4 MB total-payload ceiling or any deferred-dependency
// detector.
// #1835 rebaseline 2026-08-11 (brand delete is owner-only + failures say why):
// MEASURED, not estimated. Fresh `expo export -p web --clear` of both source
// states on the same macOS machine:
//   origin/main @ 57cbe2016 ....... __common = 2,338,318 B  (1,682 B headroom)
//   this branch @ 3b9a599fb ....... __common = 2,341,978 B  (1,978 B over cap)
//   delta ......................... +3,660 B
// GitHub's Linux runner measured this branch at 2,341,922 B — a 56 B platform
// variance, consistent with the ±149 B variance recorded in the #871 note above.
//
// WHAT the delta is: the eager brand surfaces now import three small pure
// modules — `utils/brandDeletePermission.ts` (the owner-only predicate),
// `utils/supabaseErrorMessage.ts` (PostgREST error normalisation), and
// `utils/brandDeleteError.ts` (three vetted user-facing strings) — plus the
// owner-only panel in BrandDeleteSheet and two `captureException` call sites.
// Metro hoists the utils into __common because the eager brands service and
// several brand chunks all import them.
//
// WHY it is NOT the regression this tripwire targets: the guard fails fast
// (`fail()` → `process.exit(1)`), so reaching this check proves checks 1–3
// PASSED on the branch build — zero deferred specifiers in the main entry chunk
// (@stripe/connect-js, react-native-qrcode-svg, @expo-google-fonts/* all still
// deferred) and total initial payload 3,346,310 B against the 9,405,478 B
// ceiling. Nothing heavy re-entered the boot path; this is organic growth on a
// cap that main was already sitting 0.07% under.
//
// WHY the modules are not deferred to dodge the cap: TRIED AND MEASURED. Putting
// BrandDeleteSheet behind React.lazy at the two remaining eager call sites
// (app/(tabs)/home.tsx, app/brand/[id]/index.tsx — mirroring account.tsx and
// hub/_layout.tsx) produced a BYTE-IDENTICAL __common of 2,341,978 B. Metro
// hoists modules shared across multiple chunks into __common, so deferring a
// component into a 4th chunk keeps it shared and it lands right back. That
// attempt was reverted rather than kept for zero measured benefit.
//
// Cap raised by the established 10 KB increment to 2,350,000 B, preserving
// ~8 KB of live tripwire headroom. The 9.4 MB total-payload ceiling and every
// deferred-dependency detector are UNCHANGED.
//
// STANDING NOTE for whoever trips this next: main has now arrived at this cap
// within ~1.7 KB on four of the last five rebaselines. A budget with 0.07%
// headroom stops functioning as a budget and becomes a blocker on unrelated
// work. The real fix is the __common tightening tracked as its own ORCH per the
// note above — not a fifth increment.
const COMMON_CAP_BYTES = Number(process.env.ORCH_1083_COMMON_CAP ?? 2_350_000);

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
