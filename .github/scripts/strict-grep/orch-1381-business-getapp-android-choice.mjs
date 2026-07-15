#!/usr/bin/env node
/**
 * ORCH-1381 [business-getapp-android-choice].
 * Invariant: I-PROPOSED-1381-BUSINESS-GETAPP-ANDROID-CHOICE (DRAFT until CLOSE).
 *
 * THE BUG THIS GATE KILLS. Business "Get the app" sent EVERY Android owner to the
 * web app and never offered the Play listing. That was correct when it shipped
 * (ORCH-1324, 2026-07-09: business Play was still in review). It became WRONG on
 * 2026-07-15, when the business Play listing went live (production versionCode 33 /
 * 1.1.2, status=completed, HTTP 200 — API-verified, COMMS-0101). The decision was
 * copy-pasted across FIVE call sites, which is why one store going live left four
 * surfaces stale at once.
 *
 * THE CONTRACT. Every business get-app surface presents an explicit inline choice:
 * an intelligent "Download the app" (iOS → BUSINESS_APP_STORE_URL, Android →
 * BUSINESS_PLAY_STORE_URL) AND "Use on web" (→ BUSINESS_WEB_URL), plus an
 * app-does-more note; desktop/unknown renders web-only. The platform→destination
 * decision exists ONLY in lib/business-app-target.ts.
 *
 * Over mingla-marketing/lib/business-app-target.ts (comment-stripped) REQUIRE:
 *   1. all three destination consts referenced: BUSINESS_APP_STORE_URL,
 *      BUSINESS_PLAY_STORE_URL, BUSINESS_WEB_URL.
 *   2. BOTH branches explicit: `platform === 'ios'` AND `platform === 'android'`.
 *   3. `canInstall` (desktop has no install action).
 *
 * Over the helper AND all 4 CTA surfaces BAN:
 *   4. the ORCH-1324 collapsed ternary
 *      `platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL` — THE BUG.
 *   5. minglabiz.onelink.me — DEAD on Android (AppsFlyer app status Pending,
 *      COMMS-0101). Routing Android through it ships a broken install path. Lifting
 *      this ban is the FUTURE upgrade, gated on an operator dashboard action
 *      (AppsFlyer → My Apps → Refresh Status) + an Android curl returning the 301.
 *   6. go.usemingla.com — consumer-owned (1 branded domain = 1 template, ORCH-1346).
 *
 * Over each of the 4 CTA surfaces REQUIRE: resolveBusinessAppTarget( AND
 * BUSINESS_APP_CHOICE_COPY (the note is a CLAIM pinned to the shared constant — a
 * hand-written variant is how a verified claim silently becomes an invented one).
 *
 * G-b (adversarial): FAIL if business-app-target.ts maps android → BUSINESS_WEB_URL.
 * That is the exact revert this ORCH exists to prevent, and it is what the T-1
 * regression test asserts at runtime. TWO complementary checks are needed:
 *   (i)  a same-line regex — catches a one-liner `android ? BUSINESS_WEB_URL : …`.
 *   (ii) a STRUCTURAL read of the android branch's own `installHref:`, pinned to
 *        BUSINESS_PLAY_STORE_URL.
 * (ii) is load-bearing: the android branch is a multi-line block, so 'android' and
 * BUSINESS_WEB_URL never share a line in the real code shape and a same-line-only
 * guard would be DECORATIVE — it would pass on the very revert it claims to catch.
 * Both forms are pinned by self-test cases 4 and 4b.
 *
 * --self-test injects fixtures (compliant → pass; each violation → fire; a banned
 * token inside a COMMENT is stripped and still passes).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const HELPER = "mingla-marketing/lib/business-app-target.ts";
const SURFACES = [
  "mingla-marketing/app/business/download/page.tsx",
  "mingla-marketing/components/marketing/glass-nav.tsx",
  "mingla-marketing/components/sections/organiser-home/hero.tsx",
  "mingla-marketing/components/marketing/links-experience.tsx",
];

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// Banned everywhere (helper + all 4 CTA surfaces).
const BANNED = [
  {
    re: /platform === 'ios' \? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL/,
    why: "carries the ORCH-1324 collapsed ternary — sends every Android owner to the web app instead of the LIVE business Play listing (THE bug ORCH-1381 kills)",
  },
  {
    re: /minglabiz\.onelink\.me/,
    why: "routes through the business OneLink — DEAD on Android (AppsFlyer app status Pending, COMMS-0101); it would ship a broken install path",
  },
  {
    re: /go\.usemingla\.com/,
    why: "references the CONSUMER-owned branded OneLink domain (ORCH-1346: one branded domain = one template) — the business surface must never use it",
  },
];

function checkHelper(rawSrc, failures) {
  const src = stripComments(rawSrc);

  // 1. all three destination consts referenced.
  for (const c of ["BUSINESS_APP_STORE_URL", "BUSINESS_PLAY_STORE_URL", "BUSINESS_WEB_URL"]) {
    if (!new RegExp(`\\b${c}\\b`).test(src)) {
      failures.push(`${HELPER}: must reference ${c} (the business destinations come from lib/store-links).`);
    }
  }

  // 2. both phone branches explicit.
  if (!/platform === 'ios'/.test(src)) {
    failures.push(`${HELPER}: must branch explicitly on \`platform === 'ios'\`.`);
  }
  if (!/platform === 'android'/.test(src)) {
    failures.push(
      `${HELPER}: must branch explicitly on \`platform === 'android'\` — Android is a ` +
        `first-class install target now that the business Play listing is LIVE (COMMS-0101).`,
    );
  }

  // 3. desktop has no install action.
  if (!/canInstall/.test(src)) {
    failures.push(`${HELPER}: must expose canInstall — desktop/unknown has nothing to install (no dead button).`);
  }

  // G-b adversarial — android must NEVER resolve to the web app as its install
  // target. TWO complementary checks, because the android branch is a multi-line
  // block: a same-line regex alone would be DECORATIVE (it can never fire against
  // the real block form, only against a one-liner/ternary).
  //
  //   (i) same-line form  — catches `android ? BUSINESS_WEB_URL : …` one-liners.
  //   (ii) STRUCTURAL     — reads the android branch's own installHref and pins it
  //                         to BUSINESS_PLAY_STORE_URL. This is the check that
  //                         actually fires on the real revert.
  if (/'android'[^\n]*\?[^\n]*BUSINESS_WEB_URL/.test(src)) {
    failures.push(
      `${HELPER}: maps 'android' → BUSINESS_WEB_URL on one line — every Android owner ` +
        `would be denied the app. Android must resolve to BUSINESS_PLAY_STORE_URL (G-b).`,
    );
  }
  const androidAt = src.indexOf("platform === 'android'");
  if (androidAt !== -1) {
    // The android branch body, up to the start of the next branch/return-block.
    const body = src.slice(androidAt, androidAt + 400);
    const install = /installHref:\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(body);
    if (install === null) {
      failures.push(
        `${HELPER}: the 'android' branch does not assign an installHref — gate parse out ` +
          `of sync with the helper's shape (G-b).`,
      );
    } else if (install[1] !== "BUSINESS_PLAY_STORE_URL") {
      failures.push(
        `${HELPER}: the 'android' branch resolves installHref to ${install[1]} — it MUST be ` +
          `BUSINESS_PLAY_STORE_URL. Android resolving to the web app is the exact bug ` +
          `ORCH-1381 killed: every Android owner is silently denied the LIVE Play listing ` +
          `(G-b).`,
      );
    }
  }

  for (const { re, why } of BANNED) {
    if (re.test(src)) failures.push(`${HELPER}: ${why}.`);
  }
}

function checkSurface(label, rawSrc, failures) {
  const src = stripComments(rawSrc);

  if (!/resolveBusinessAppTarget\(/.test(src)) {
    failures.push(
      `${label}: must resolve its destinations via resolveBusinessAppTarget( — the ` +
        `platform→destination decision lives in exactly ONE module (ORCH-1381).`,
    );
  }
  if (!/BUSINESS_APP_CHOICE_COPY/.test(src)) {
    failures.push(
      `${label}: must render labels/note from BUSINESS_APP_CHOICE_COPY — the note is a ` +
        `code-verified CLAIM; a hand-written variant is how a verified claim silently ` +
        `becomes an invented one.`,
    );
  }

  for (const { re, why } of BANNED) {
    if (re.test(src)) failures.push(`${label}: ${why}.`);
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const runHelper = (s) => { const f = []; checkHelper(s, f); return f; };
  const runSurface = (s) => { const f = []; checkSurface("fixture", s, f); return f; };

  const goodHelper = `
import type { Platform } from './device-platform'
import { BUSINESS_APP_STORE_URL, BUSINESS_PLAY_STORE_URL, BUSINESS_WEB_URL } from './store-links'
export function resolveBusinessAppTarget(platform) {
  if (platform === 'ios') {
    return { installHref: BUSINESS_APP_STORE_URL, installStore: 'app_store', webHref: BUSINESS_WEB_URL, canInstall: true }
  }
  if (platform === 'android') {
    return { installHref: BUSINESS_PLAY_STORE_URL, installStore: 'play', webHref: BUSINESS_WEB_URL, canInstall: true }
  }
  return { installHref: null, installStore: null, webHref: BUSINESS_WEB_URL, canInstall: false }
}
export const BUSINESS_APP_CHOICE_COPY = { download: 'Download the app', useWeb: 'Use on web' }
`;
  if (runHelper(goodHelper).length !== 0) {
    selfFailures.push("compliant helper wrongly flagged: " + JSON.stringify(runHelper(goodHelper)));
  }

  const goodSurface = `
import { BUSINESS_APP_CHOICE_COPY, resolveBusinessAppTarget } from '@/lib/business-app-target'
const target = resolveBusinessAppTarget(platform)
const jsx = <>{BUSINESS_APP_CHOICE_COPY.download}{BUSINESS_APP_CHOICE_COPY.useWeb}</>
`;
  if (runSurface(goodSurface).length !== 0) {
    selfFailures.push("compliant surface wrongly flagged: " + JSON.stringify(runSurface(goodSurface)));
  }

  // 1. Helper missing BUSINESS_PLAY_STORE_URL → fire.
  const noPlay = goodHelper.replace(/BUSINESS_PLAY_STORE_URL/g, "BUSINESS_WEB_URL");
  if (runHelper(noPlay).length === 0) selfFailures.push("helper missing BUSINESS_PLAY_STORE_URL not flagged");

  // 2. Helper lost the explicit android branch → fire.
  const noAndroid = goodHelper.replace("platform === 'android'", "platform === 'unknown'");
  if (runHelper(noAndroid).length === 0) selfFailures.push("helper missing `platform === 'android'` not flagged");

  // 3. Helper lost canInstall → fire.
  const noCanInstall = goodHelper.replace(/canInstall/g, "somethingElse");
  if (runHelper(noCanInstall).length === 0) selfFailures.push("helper missing canInstall not flagged");

  // 4. G-b (structural) — helper maps android → the web app (THE revert) → fire.
  // NB: 'android' and BUSINESS_WEB_URL land on DIFFERENT lines in the real block
  // form, so a same-line-only regex would never catch this. That is why the
  // structural installHref check exists.
  const androidToWeb = goodHelper.replace(
    "return { installHref: BUSINESS_PLAY_STORE_URL, installStore: 'play',",
    "return { installHref: BUSINESS_WEB_URL, installStore: 'play',",
  );
  if (androidToWeb === goodHelper) selfFailures.push("G-b fixture is a NO-OP (the replace matched nothing) — the case would pass vacuously");
  if (runHelper(androidToWeb).length === 0) selfFailures.push("G-b: android branch → BUSINESS_WEB_URL not flagged (structural check dead)");

  // 4b. G-b (same-line) — a one-liner android → web ternary → fire.
  const androidTernary = goodHelper + "\nconst d = platform === 'android' ? BUSINESS_WEB_URL : BUSINESS_PLAY_STORE_URL\n";
  if (runHelper(androidTernary).length === 0) selfFailures.push("G-b: same-line android → BUSINESS_WEB_URL ternary not flagged");

  // 5. Helper carries the ORCH-1324 collapsed ternary → fire.
  const ternary = goodHelper + "\nconst dest = platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL\n";
  if (runHelper(ternary).length === 0) selfFailures.push("collapsed ternary in helper not flagged");

  // 6. Helper routes through the DEAD business OneLink → fire.
  const oneLink = goodHelper + "\nconst u = 'https://minglabiz.onelink.me/ZSCW'\n";
  if (runHelper(oneLink).length === 0) selfFailures.push("minglabiz.onelink.me not flagged");

  // 7. Helper routes through the CONSUMER branded domain → fire.
  const consumerDomain = goodHelper + "\nconst u = 'https://go.usemingla.com/w36m'\n";
  if (runHelper(consumerDomain).length === 0) selfFailures.push("go.usemingla.com not flagged");

  // 8. Surface stopped delegating to the helper → fire.
  const noHelperCall = goodSurface.replace(/resolveBusinessAppTarget/g, "someLocalGuess");
  if (runSurface(noHelperCall).length === 0) selfFailures.push("surface missing resolveBusinessAppTarget not flagged");

  // 9. Surface hand-wrote the note instead of using the shared constant → fire.
  const handWritten = goodSurface.replace(/BUSINESS_APP_CHOICE_COPY/g, "'The app does more, probably'");
  if (runSurface(handWritten).length === 0) selfFailures.push("surface missing BUSINESS_APP_CHOICE_COPY not flagged");

  // 10. Surface carries the collapsed ternary → fire.
  const surfaceTernary = goodSurface + "\nconst dest = platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL\n";
  if (runSurface(surfaceTernary).length === 0) selfFailures.push("collapsed ternary on a surface not flagged");

  // 11. Banned tokens inside COMMENTS are stripped → compliant still passes.
  const commented = goodHelper +
    "\n// NEVER minglabiz.onelink.me (dead on Android) and never go.usemingla.com (consumer-owned)\n" +
    "/* the old platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL ternary is gone */\n";
  if (runHelper(commented).length !== 0) {
    selfFailures.push("commented banned tokens wrongly flagged (comment-strip broken): " + JSON.stringify(runHelper(commented)));
  }

  if (selfFailures.length) {
    console.error("ORCH-1381 business-getapp-android-choice self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1381 business-getapp-android-choice self-test PASS (14/14 cases).");
  process.exit(0);
}

// ---- Live mode
const failures = [];

const helperAbs = path.join(root, HELPER);
if (!fs.existsSync(helperAbs)) {
  console.error(`ORCH-1381 FAIL — target not found at ${HELPER} (the shared business get-app decision module is missing).`);
  process.exit(1);
}
checkHelper(fs.readFileSync(helperAbs, "utf8"), failures);

for (const rel of SURFACES) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    console.error(`ORCH-1381 FAIL — target not found at ${rel} (gate path out of sync).`);
    process.exit(1);
  }
  checkSurface(rel, fs.readFileSync(abs, "utf8"), failures);
}

if (failures.length > 0) {
  console.error(
    "ORCH-1381 (I-PROPOSED-1381-BUSINESS-GETAPP-ANDROID-CHOICE) FAIL — every business\n" +
      "get-app surface must present an explicit inline choice — an intelligent \"Download\n" +
      "the app\" (iOS → BUSINESS_APP_STORE_URL, Android → BUSINESS_PLAY_STORE_URL) AND\n" +
      "\"Use on web\" (→ BUSINESS_WEB_URL) + the app-does-more note — with the\n" +
      "platform→destination decision living ONLY in lib/business-app-target.ts. Business\n" +
      "Android must NEVER resolve to BUSINESS_WEB_URL as its install target, and never\n" +
      "route through minglabiz.onelink.me (dead on Android) or go.usemingla.com\n" +
      "(consumer-owned).\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1381 PASS — the business get-app decision lives in ONE module\n" +
    "(lib/business-app-target.ts: iOS → business App Store, Android → the LIVE business\n" +
    "Play listing, desktop → web only, canInstall-gated), all 4 CTA surfaces delegate to\n" +
    "it and render BUSINESS_APP_CHOICE_COPY, and no surface carries the ORCH-1324\n" +
    "collapsed ternary, the dead minglabiz OneLink, or the consumer go.usemingla.com\n" +
    "domain.",
);
