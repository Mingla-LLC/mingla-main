#!/usr/bin/env node
/**
 * ORCH-1342 [web-see-whos-going-funnel] — store-links SSOT drift gate.
 * Invariant: I-PROPOSED-1342-STORE-LINKS-SSOT (DRAFT until CLOSE).
 *
 * mingla-business store/download URLs live ONLY in
 * `mingla-business/src/constants/storeLinks.ts`, byte-matched to the marketing
 * SSOT `mingla-marketing/lib/store-links.ts`. This kills the F-12 class
 * forever (a component-local `apps.apple.com/app/mingla` literal shipped a
 * DEAD App Store link on the post-checkout CTA) and enforces the ORCH-1346
 * one-branded-domain-one-template constraint (`go.usemingla.com` is
 * consumer-owned OneLink territory — never scattered as a literal).
 *
 * REQUIRE:
 *   1. `mingla-business/src/constants/storeLinks.ts` exists and exports
 *      APP_STORE_URL / PLAY_STORE_URL whose string values BYTE-EQUAL the ones
 *      in `mingla-marketing/lib/store-links.ts`.
 * BAN (comment-stripped, over mingla-business/src/** + mingla-business/app/**,
 * excluding the SSOT file itself and __tests__ fixtures):
 *   2. any `apps.apple.com` literal outside the SSOT file.
 *   3. any `play.google.com/store` literal outside the SSOT file.
 *   4. any `go.usemingla.com` literal outside the SSOT file (ORCH-1346 A-1:
 *      one branded domain = one template; the flip constant is the only home).
 *
 * --self-test injects fixtures (compliant → pass; each violation → fire; a
 * banned token inside a COMMENT is stripped and still passes).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const SSOT = "mingla-business/src/constants/storeLinks.ts";
const MARKETING_SSOT = "mingla-marketing/lib/store-links.ts";
const SCAN_ROOTS = ["mingla-business/src", "mingla-business/app"];
const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Parse `export const NAME = '<url>'` (single/double quotes, multi-line). */
function parseConst(src, name) {
  const re = new RegExp(
    `export\\s+const\\s+${name}\\s*(?::[^=]+)?=\\s*\\n?\\s*['"]([^'"]+)['"]`,
  );
  const m = re.exec(src);
  return m ? m[1] : null;
}

/**
 * ⚠️ ALL PATTERNS ARE CASE-INSENSITIVE (`/i`) — ORCH-1373 SPEC §9.0.
 * Hostnames are case-insensitive to a browser: `BIZ.USEMINGLA.COM/ZSCW` resolves
 * identically to the lowercase form. A case-sensitive gate would report GREEN on
 * an uppercase literal while the drift it exists to prevent shipped. Every
 * self-test below carries a case case.
 */
const BANNED = [
  { id: "apple", re: /apps\.apple\.com/i, why: "hardcodes an apps.apple.com store literal (import APP_STORE_URL from src/constants/storeLinks — the F-12 class)" },
  { id: "play", re: /play\.google\.com\/store/i, why: "hardcodes a play.google.com/store literal (import PLAY_STORE_URL from src/constants/storeLinks)" },
  { id: "onelink", re: /go\.usemingla\.com/i, why: "hardcodes the go.usemingla.com branded OneLink domain (ORCH-1346: one domain = one template; only the storeLinks SSOT flip constant may carry it)" },
  // ─── ORCH-1378: the business OneLink SSOT rule was previously UNENFORCED ───
  // The gate credited with enforcing "the business OneLink constant must live in
  // storeLinks.ts" did NOT check for it at all: a raw `biz.usemingla.com` literal
  // injected OUTSIDE the SSOT PASSED (proven empirically during the ORCH-1373
  // SPEC). It was a decorative guard. These two entries give it teeth.
  { id: "bizonelink", re: /biz\.usemingla\.com/i, why: "hardcodes the biz.usemingla.com branded BUSINESS OneLink domain (import BUSINESS_INVITE_ONELINK_URL from src/constants/storeLinks — scattering it re-opens the F-12 class on the one link that carries install ATTRIBUTION via af_tranid)" },
  { id: "rawonelink", re: /minglabiz\.onelink\.me/i, why: "hardcodes the raw AppsFlyer vendor OneLink base (minglabiz.onelink.me). The BRANDED domain biz.usemingla.com is the only supported business OneLink host — import BUSINESS_INVITE_ONELINK_URL from src/constants/storeLinks" },
];

/**
 * GRANDFATHERED pre-existing debt. Currently EMPTY — every registered debt has
 * been paid off and its entry deleted in the SAME commit that paid it. The
 * mechanism is retained for a future FILE+PATTERN-narrow exception (any such
 * entry stays narrow, so a NEW literal class in the same file still fires).
 *
 * ─── #1050 — appsFlyerService.ts `onelink` grandfather DELETED ───────────────
 * appsFlyerService.ts (business) previously set `go.usemingla.com` as its
 * branded OneLink domain and was grandfathered for the `onelink` pattern — the
 * ORCH-1346 business host swap was bound to the next business NATIVE build
 * (COMMS-0052/0063: no business OTA). #1050 IS that swap: the service now
 * imports BUSINESS_ONELINK_BRANDED_DOMAIN (`biz.usemingla.com`) from the
 * storeLinks SSOT and carries NO `go.usemingla.com` literal. The debt is PAID,
 * so the exemption is DELETED and the gate now polices that file like any other.
 * #1050 — `biz.` is the Business app's OWN vouching host; `go.` is CONSUMER-only
 * and re-introducing it (here or in mingla-business/app.json) re-breaks
 * host.usemingla.com App Link verification on Android <=11.
 *
 * ─── ORCH-1378 — accept-brand-invitation/success.tsx REMOVED from this map ──
 * Its entry read: "carries the BUSINESS store listing URLs inline — predates
 * this gate; NEEDS BUSINESS_* SSOT ENTRIES IN A FOLLOW-UP ORCH." ORCH-1378 IS
 * that follow-up: the hardcoded, non-attributed, non-device-aware iOS/Android
 * button pair is gone, replaced by the shared BusinessAppDownloadCta which
 * imports BUSINESS_INVITE_ONELINK_URL from the SSOT. The debt is PAID, so the
 * exemption is DELETED and the gate now polices that file like any other.
 *
 * A grandfather entry left behind after its debt is paid is a decorative guard:
 * it silently re-authorises the exact literal class the gate exists to ban. If
 * you pay off a debt here, delete the entry in the same commit.
 */
const GRANDFATHERED = {};

/**
 * Core checker — pure over a {relPath: content} map so --self-test can inject
 * fixtures. `files` MUST include the two SSOT paths when present.
 */
function checkStoreLinksSsot(files, failures) {
  const marketing = files[MARKETING_SSOT];
  const ssot = files[SSOT];

  if (marketing === undefined) {
    failures.push(`${MARKETING_SSOT}: marketing SSOT not found (gate path out of sync).`);
  }
  if (ssot === undefined) {
    failures.push(`${SSOT}: mingla-business store-links SSOT is MISSING — components must import store URLs from it.`);
  }

  if (marketing !== undefined && ssot !== undefined) {
    for (const name of ["APP_STORE_URL", "PLAY_STORE_URL"]) {
      const want = parseConst(marketing, name);
      const got = parseConst(ssot, name);
      if (want === null) {
        failures.push(`${MARKETING_SSOT}: could not parse ${name} (gate regex out of sync).`);
      } else if (got === null) {
        failures.push(`${SSOT}: missing export const ${name}.`);
      } else if (want !== got) {
        failures.push(
          `${SSOT}: ${name} DRIFTED from the marketing SSOT — "${got}" != "${want}" (byte-equality is CI-enforced).`,
        );
      }
    }
  }

  for (const [rel, raw] of Object.entries(files)) {
    if (rel === SSOT || rel === MARKETING_SSOT) continue;
    if (!rel.startsWith("mingla-business/")) continue;
    if (/\/__tests__\//.test(rel)) continue; // tests may quote literals as fixtures
    const src = stripComments(raw);
    const grandfathered = GRANDFATHERED[rel];
    for (const { id, re, why } of BANNED) {
      if (grandfathered !== undefined && grandfathered.has(id)) continue;
      if (re.test(src)) {
        failures.push(`${rel}: ${why} (banned by ORCH-1342).`);
      }
    }
  }
}

function walk(dirAbs, out) {
  if (!fs.existsSync(dirAbs)) return;
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (SCAN_EXT.has(path.extname(entry.name))) out.push(abs);
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (files) => {
    const f = [];
    checkStoreLinksSsot(files, f);
    return f;
  };

  const marketingFix = `
export const APP_STORE_URL = 'https://apps.apple.com/app/id6760440898'
export const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.mingla.app.v2'
`;
  const ssotFix = `
export const APP_STORE_URL = "https://apps.apple.com/app/id6760440898";
export const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.mingla.app.v2";
export const DOWNLOAD_PAGE_URL = "https://usemingla.com/download";
export const GUEST_FUNNEL_ONELINK_URL: string | null = null;
`;
  const cleanComponent = `
import { APP_STORE_URL, PLAY_STORE_URL } from "../../constants/storeLinks";
const open = (u) => u;
open(APP_STORE_URL);
`;
  const good = {
    [MARKETING_SSOT]: marketingFix,
    [SSOT]: ssotFix,
    "mingla-business/src/components/checkout/DownloadMinglaCta.tsx": cleanComponent,
  };
  if (run(good).length !== 0) selfFailures.push("compliant fixture wrongly flagged: " + JSON.stringify(run(good)));

  // 1. Missing SSOT file → fire.
  const noSsot = { ...good };
  delete noSsot[SSOT];
  if (run(noSsot).length === 0) selfFailures.push("missing mingla-business SSOT not flagged");

  // 2. Drifted APP_STORE_URL value → fire.
  const drifted = {
    ...good,
    [SSOT]: ssotFix.replace("id6760440898", "id0000000000"),
  };
  if (run(drifted).length === 0) selfFailures.push("drifted APP_STORE_URL not flagged");

  // 3. Re-hardcoded apps.apple.com in a component (the F-12 class) → fire.
  const f12 = {
    ...good,
    "mingla-business/src/components/checkout/DownloadMinglaCta.tsx":
      cleanComponent + '\nconst STALE = "https://apps.apple.com/app/mingla";\n',
  };
  if (run(f12).length === 0) selfFailures.push("re-hardcoded apps.apple.com literal not flagged");

  // 4. play.google.com/store literal → fire.
  const play = {
    ...good,
    "mingla-business/app/some-route.tsx":
      'const x = "https://play.google.com/store/apps/details?id=com.mingla.app.v2";\n',
  };
  if (run(play).length === 0) selfFailures.push("play.google.com/store literal not flagged");

  // 5. go.usemingla.com literal outside the SSOT (ORCH-1346 A-1) → fire.
  const oneLink = {
    ...good,
    "mingla-business/src/services/someService.ts":
      'const u = "https://go.usemingla.com/w36m";\n',
  };
  if (run(oneLink).length === 0) selfFailures.push("go.usemingla.com literal outside SSOT not flagged");

  // 6. Banned tokens inside COMMENTS are stripped → still passes.
  const commented = {
    ...good,
    "mingla-business/src/services/guestFunnelLink.ts":
      cleanComponent +
      "\n// dark until go-live: apps.apple.com / play.google.com/store / go.usemingla.com live in storeLinks.ts\n" +
      "/* legacy F-12 note: the stale apps.apple.com/app/mingla literal is dead */\n",
  };
  if (run(commented).length !== 0) selfFailures.push("commented banned tokens wrongly flagged (comment-strip broken): " + JSON.stringify(run(commented)));

  // 7. Missing PLAY_STORE_URL export in the SSOT → fire.
  const missingExport = {
    ...good,
    [SSOT]: ssotFix.replace(/export const PLAY_STORE_URL[\s\S]*?;\n/, ""),
  };
  if (run(missingExport).length === 0) selfFailures.push("missing PLAY_STORE_URL export not flagged");

  // 8. Literal inside a __tests__ fixture is ALLOWED (tests quote fixtures).
  const testFixture = {
    ...good,
    "mingla-business/src/components/checkout/__tests__/orch_1342_download_cta_ssot.test.ts":
      'const STALE = "https://apps.apple.com/app/mingla"; // asserted ABSENT from the component\n',
  };
  if (run(testFixture).length !== 0) selfFailures.push("__tests__ fixture literal wrongly flagged: " + JSON.stringify(run(testFixture)));

  // 9. #1050 — appsFlyerService.ts is NO LONGER grandfathered for `onelink`
  // (debt paid: it imports BUSINESS_ONELINK_BRANDED_DOMAIN from the SSOT and
  // carries no go. literal). A RESURRECTED go.usemingla.com literal there MUST
  // now fire like any other file — the deleted grandfather no longer silently
  // re-authorises it (re-adding go. re-breaks Android <=11 verification).
  const appsFlyerGoResurrected = {
    ...good,
    "mingla-business/src/services/appsFlyerService.ts":
      'const ONELINK_BRANDED_DOMAIN = "go.usemingla.com";\n',
  };
  if (run(appsFlyerGoResurrected).length === 0) selfFailures.push("go.usemingla.com literal in appsFlyerService.ts not flagged (the #1050 grandfather deletion is decorative)");

  // 10. …and any OTHER banned class in that same file fires too — no grandfather
  // shields it now.
  const appsFlyerMultiClass = {
    ...good,
    "mingla-business/src/services/appsFlyerService.ts":
      'const ONELINK_BRANDED_DOMAIN = "go.usemingla.com";\nconst STALE = "https://apps.apple.com/app/mingla";\n',
  };
  if (run(appsFlyerMultiClass).length === 0) selfFailures.push("banned classes in appsFlyerService.ts not flagged");

  // 11. ORCH-1381 — BUSINESS_PLAY_STORE_URL in the marketing SSOT must not shadow
  // PLAY_STORE_URL's byte-compare. parseConst needs whitespace + a literal
  // `PLAY_STORE_URL` after `const`; inside `BUSINESS_PLAY_STORE_URL` it gets
  // `BUSINESS_…` → no match, so exec still returns the REAL PLAY_STORE_URL. The
  // marketing SSOT is also skipped by the literal BAN scan (mingla-business/ only),
  // so the new play.google.com literal there is out of scan scope. This gate needs
  // NO amendment for ORCH-1381 — this case pins that and prevents a future footgun.
  const withBusiness = {
    ...good,
    [MARKETING_SSOT]: marketingFix +
      "\nexport const BUSINESS_PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.sethogieva.minglabusiness'\n",
  };
  if (run(withBusiness).length !== 0) {
    selfFailures.push("BUSINESS_PLAY_STORE_URL wrongly broke the PLAY_STORE_URL byte-compare: " + JSON.stringify(run(withBusiness)));
  }

  // ─── ORCH-1378: the bans that make the business-OneLink SSOT rule real ───
  // 12. THE PROVEN-DECORATIVE CASE. Before this PR, this exact fixture PASSED —
  // the gate was credited with enforcing the business-OneLink SSOT and enforced
  // nothing. This case is the regression guard for that hole.
  const bizLiteral = {
    ...good,
    "mingla-business/src/components/invite/BusinessAppDownloadCta.tsx":
      'const CTA = "https://biz.usemingla.com/ZSCW?pid=business_web";\n',
  };
  if (run(bizLiteral).length === 0) {
    selfFailures.push("biz.usemingla.com literal outside the SSOT not flagged (the PROVEN-decorative hole)");
  }

  // 13. Case-insensitivity — hostnames are case-insensitive to a browser.
  const bizUpper = {
    ...good,
    "mingla-business/src/components/invite/BusinessAppDownloadCta.tsx":
      'const CTA = "https://BIZ.USEMINGLA.COM/ZSCW";\n',
  };
  if (run(bizUpper).length === 0) {
    selfFailures.push("UPPERCASE BIZ.USEMINGLA.COM not flagged (gate is case-SENSITIVE — browsers are not)");
  }

  // 14. The raw vendor OneLink base is banned too (branded domain only).
  const rawOneLink = {
    ...good,
    "mingla-business/src/services/someService.ts":
      'const u = "https://minglabiz.onelink.me/ZSCW";\n',
  };
  if (run(rawOneLink).length === 0) selfFailures.push("minglabiz.onelink.me literal not flagged");

  // 15. Case-insensitivity on the existing bans too (they were case-SENSITIVE).
  const appleUpper = {
    ...good,
    "mingla-business/app/some-route.tsx": 'const x = "https://APPS.APPLE.COM/app/id1";\n',
  };
  if (run(appleUpper).length === 0) selfFailures.push("UPPERCASE APPS.APPLE.COM not flagged");

  // 16. The SSOT file itself may (and must) carry the business OneLink.
  const ssotCarriesBiz = {
    ...good,
    [SSOT]: ssotFix + '\nexport const BUSINESS_INVITE_ONELINK_URL = "https://biz.usemingla.com/ZSCW";\n',
  };
  if (run(ssotCarriesBiz).length !== 0) {
    selfFailures.push("the SSOT file was wrongly flagged for carrying the business OneLink: " + JSON.stringify(run(ssotCarriesBiz)));
  }

  // 17. A commented biz.usemingla.com is stripped → passes (docblocks explain it).
  const bizCommented = {
    ...good,
    "mingla-business/src/services/guestFunnelLink.ts":
      cleanComponent + "\n// NEVER biz.usemingla.com outside the SSOT — see storeLinks.ts\n",
  };
  if (run(bizCommented).length !== 0) {
    selfFailures.push("commented biz.usemingla.com wrongly flagged: " + JSON.stringify(run(bizCommented)));
  }

  if (selfFailures.length) {
    console.error("ORCH-1342 store-links-ssot self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1342 store-links-ssot self-test PASS (17/17 cases, incl. the ORCH-1381\n  BUSINESS_PLAY_STORE_URL non-shadow case + the ORCH-1378 business-OneLink bans\n  (biz.usemingla.com / minglabiz.onelink.me) and their case-insensitivity cases —\n  the biz.usemingla.com hole was PROVEN decorative before this PR).");
  process.exit(0);
}

// ---- Live mode
const files = {};
for (const rel of [MARKETING_SSOT, SSOT]) {
  const abs = path.join(root, rel);
  if (fs.existsSync(abs)) files[rel] = fs.readFileSync(abs, "utf8");
}
for (const scanRoot of SCAN_ROOTS) {
  const absFiles = [];
  walk(path.join(root, scanRoot), absFiles);
  for (const abs of absFiles) {
    files[path.relative(root, abs)] = fs.readFileSync(abs, "utf8");
  }
}

const failures = [];
checkStoreLinksSsot(files, failures);

if (failures.length > 0) {
  console.error(
    "ORCH-1342 (I-PROPOSED-1342-STORE-LINKS-SSOT) FAIL — mingla-business store/download\n" +
      "URLs live ONLY in src/constants/storeLinks.ts (byte-matched to\n" +
      "mingla-marketing/lib/store-links.ts); no apps.apple.com / play.google.com/store /\n" +
      "go.usemingla.com literal may exist elsewhere in mingla-business.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1342 PASS — mingla-business store links are SSOT'd in src/constants/storeLinks.ts\n" +
    "(byte-equal to the marketing SSOT) and no store/OneLink-domain literal exists outside it.",
);
