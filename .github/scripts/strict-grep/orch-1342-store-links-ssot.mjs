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

const BANNED = [
  { id: "apple", re: /apps\.apple\.com/, why: "hardcodes an apps.apple.com store literal (import APP_STORE_URL from src/constants/storeLinks — the F-12 class)" },
  { id: "play", re: /play\.google\.com\/store/, why: "hardcodes a play.google.com/store literal (import PLAY_STORE_URL from src/constants/storeLinks)" },
  { id: "onelink", re: /go\.usemingla\.com/, why: "hardcodes the go.usemingla.com branded OneLink domain (ORCH-1346: one domain = one template; only the storeLinks SSOT flip constant may carry it)" },
];

/**
 * GRANDFATHERED pre-existing debt (registered as ORCH-1342 discoveries — the
 * exceptions are FILE+PATTERN narrow, so any NEW literal class in these files
 * still fires):
 * - accept-brand-invitation/success.tsx carries the BUSINESS store listing
 *   URLs (id6768737367 / com.sethogieva.minglabusiness) inline — predates this
 *   gate; needs BUSINESS_* SSOT entries in a follow-up ORCH.
 * - appsFlyerService.ts (business) still sets go.usemingla.com as its branded
 *   domain — the ORCH-1346 business swap to minglabiz.onelink.me is bound to
 *   the next business NATIVE build (COMMS-0052/0063: no business OTA).
 */
const GRANDFATHERED = {
  "mingla-business/app/accept-brand-invitation/success.tsx": new Set(["apple", "play"]),
  "mingla-business/src/services/appsFlyerService.ts": new Set(["onelink"]),
};

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

  // 9. A grandfathered file passes for ITS registered pattern only…
  const grandfatheredOk = {
    ...good,
    "mingla-business/src/services/appsFlyerService.ts":
      'const ONELINK_BRANDED_DOMAIN = "go.usemingla.com";\n',
  };
  if (run(grandfatheredOk).length !== 0) selfFailures.push("grandfathered onelink literal wrongly flagged: " + JSON.stringify(run(grandfatheredOk)));

  // 10. …but a DIFFERENT banned class in a grandfathered file still fires.
  const grandfatheredNarrow = {
    ...good,
    "mingla-business/src/services/appsFlyerService.ts":
      'const ONELINK_BRANDED_DOMAIN = "go.usemingla.com";\nconst STALE = "https://apps.apple.com/app/mingla";\n',
  };
  if (run(grandfatheredNarrow).length === 0) selfFailures.push("non-grandfathered class in a grandfathered file not flagged");

  if (selfFailures.length) {
    console.error("ORCH-1342 store-links-ssot self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1342 store-links-ssot self-test PASS (10/10 cases).");
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
