#!/usr/bin/env node
/**
 * issue #2240 — email app-link sole-owner + dead-route gate.
 * Invariant: I-2240-EMAIL-APP-LINK-SOLE-OWNER.
 *
 * WHAT SHIPPED, AND WHY A GATE. Three confirmation-email templates each
 * hand-wrote `https://usemingla.com/orders/{id}/chat` TWICE — six literals for
 * one destination — and that destination has never existed (HTTP 404, measured
 * 2026-08-18; no `orders` route in mingla-marketing/app, no rewrite to one).
 * #2217 fixed the SAME literal on the confirmation PAGE and the three email
 * copies survived, because copies do not know about each other. This gate makes
 * the seventh copy impossible.
 *
 * REQUIRE:
 *   1. `supabase/functions/_shared/email/appLink.ts` exists and exports
 *      `MINGLA_APP_LINK_URL`.
 *   2. That value tracks the #2217 SSOT. `resolveConfirmationAppTarget(e,
 *      'other')` in mingla-business — the arm for a caller that cannot name a
 *      platform, which is exactly an email — returns DOWNLOAD_PAGE_URL while
 *      `GUEST_FUNNEL_ONELINK_URL` is null and the OneLink once it is set. So:
 *        GUEST_FUNNEL_ONELINK_URL === null  ->  must equal DOWNLOAD_PAGE_URL
 *        GUEST_FUNNEL_ONELINK_URL !== null  ->  must start with the OneLink base
 *      This is the part that matters at AppsFlyer go-live (COMMS-0083): the
 *      moment Seth flips that constant, THIS GATE GOES RED until the email
 *      follows the page. One destination, one owner, enforced across two
 *      runtimes that cannot import each other.
 * BAN (comment-stripped, `__tests__` excluded — tests quote fixtures):
 *   3. any `usemingla.com/orders` literal in supabase/functions, mingla-business
 *      src/app, mingla-marketing or app-mobile. The dead path, killed as a class.
 *   4. in `supabase/functions/_shared/email/**` outside appLink.ts: any app
 *      destination literal (usemingla.com/download, apps.apple.com,
 *      play.google.com/store, go.usemingla.com) — a second hand-written
 *      destination is the whole recurrence.
 *   5. in the same scope: the string `Open in Mingla`. The CTA markup lives in
 *      appLink.ts, so a template that renders its own button fails here rather
 *      than shipping a seventh silent copy.
 *
 * All host patterns are case-insensitive: hostnames are case-insensitive to a
 * browser, and a case-sensitive gate reports GREEN while the drift ships.
 *
 * --self-test drives the pure core with fixtures. Exit 0 clean / 1 violation.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const OWNER = "supabase/functions/_shared/email/appLink.ts";
const BIZ_SSOT = "mingla-business/src/constants/storeLinks.ts";
const EMAIL_DIR = "supabase/functions/_shared/email/";
const SCAN_ROOTS = [
  "supabase/functions",
  "mingla-business/src",
  "mingla-business/app",
  "mingla-marketing/app",
  "mingla-marketing/lib",
  "mingla-marketing/components",
  "app-mobile/src",
  "app-mobile/app",
];
const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Parse `export const NAME[: T] = '<value>'` (single/double quotes, multi-line). */
function parseConst(src, name) {
  const re = new RegExp(
    `export\\s+const\\s+${name}\\s*(?::[^=]+)?=\\s*\\n?\\s*['"]([^'"]+)['"]`,
  );
  const m = re.exec(src);
  return m ? m[1] : null;
}

/** True when `export const NAME ... = null` (the DARK flip). */
function parsedAsNull(src, name) {
  const re = new RegExp(`export\\s+const\\s+${name}\\s*(?::[^=]+)?=\\s*null`);
  return re.test(src);
}

/** The dead-path ban — everywhere. This is the recurrence class itself. */
const DEAD_ROUTE = {
  id: "deadroute",
  re: /usemingla\.com\/orders/i,
  why:
    "builds a usemingla.com/orders/... URL. That route has never existed (HTTP 404) — it is the #2240 defect. The app destination lives in supabase/functions/_shared/email/appLink.ts",
};

/** Second-destination bans, scoped to the email templates. */
const EMAIL_BANNED = [
  {
    id: "download",
    re: /usemingla\.com\/download/i,
    why: "hardcodes the smart-download URL (import MINGLA_APP_LINK_URL from ./appLink.ts — #2240 exists because this string was copied)",
  },
  {
    id: "apple",
    re: /apps\.apple\.com/i,
    why: "hardcodes an App Store literal in an email template. Email cannot detect a device; the ONE link in appLink.ts resolves per device at the destination",
  },
  {
    id: "play",
    re: /play\.google\.com\/store/i,
    why: "hardcodes a Play Store literal in an email template. Email cannot detect a device; the ONE link in appLink.ts resolves per device at the destination",
  },
  {
    id: "onelink",
    re: /go\.usemingla\.com/i,
    why: "hardcodes the branded OneLink domain in an email template. It reaches appLink.ts through the storeLinks SSOT flip, never as a literal here",
  },
  {
    id: "cta",
    re: /Open in Mingla/,
    why: "renders its own 'Open in Mingla' button. The CTA markup AND its destination live in appLink.ts (renderAppCtaHtml / appCtaTextLine) so a template cannot ship a private copy",
  },
];

/**
 * GRANDFATHERED pre-existing debt. EMPTY, deliberately: #2240 removed every
 * copy in the same commit that added this gate. A grandfather entry left behind
 * after its debt is paid silently re-authorises the exact class the gate bans.
 */
const GRANDFATHERED = {};

/** Pure core over a {relPath: content} map so --self-test can inject fixtures. */
function checkEmailAppLinkSoleOwner(files, failures) {
  const owner = files[OWNER];
  const biz = files[BIZ_SSOT];

  if (owner === undefined) {
    failures.push(
      `${OWNER}: the email app-link SSOT is MISSING — the three confirmation templates must import their destination from it.`,
    );
  }
  if (biz === undefined) {
    failures.push(`${BIZ_SSOT}: mingla-business store-links SSOT not found (gate path out of sync).`);
  }

  if (owner !== undefined && biz !== undefined) {
    const got = parseConst(owner, "MINGLA_APP_LINK_URL");
    const downloadPage = parseConst(biz, "DOWNLOAD_PAGE_URL");
    const oneLink = parseConst(biz, "GUEST_FUNNEL_ONELINK_URL");
    const oneLinkDark = parsedAsNull(biz, "GUEST_FUNNEL_ONELINK_URL");

    if (got === null) {
      failures.push(`${OWNER}: missing export const MINGLA_APP_LINK_URL.`);
    } else if (downloadPage === null) {
      failures.push(`${BIZ_SSOT}: could not parse DOWNLOAD_PAGE_URL (gate regex out of sync).`);
    } else if (!oneLinkDark && oneLink === null) {
      failures.push(
        `${BIZ_SSOT}: GUEST_FUNNEL_ONELINK_URL is neither null nor a parseable string literal — this gate cannot tell which arm of resolveConfirmationAppTarget the email must mirror, and will not guess.`,
      );
    } else if (oneLinkDark) {
      if (got !== downloadPage) {
        failures.push(
          `${OWNER}: MINGLA_APP_LINK_URL is "${got}" but the guest funnel is DARK, so resolveConfirmationAppTarget(e,'other') — the arm an email is — resolves to DOWNLOAD_PAGE_URL "${downloadPage}". The email and the confirmation page must land a buyer in the SAME place (#2240).`,
        );
      }
    } else if (!got.startsWith(oneLink)) {
      failures.push(
        `${OWNER}: GUEST_FUNNEL_ONELINK_URL has been flipped LIVE to "${oneLink}", so the confirmation page's button now opens the OneLink — but MINGLA_APP_LINK_URL is still "${got}". The email must follow the page (#2240: one destination, one owner).`,
      );
    }
  }

  for (const [rel, raw] of Object.entries(files)) {
    if (rel === BIZ_SSOT) continue;
    if (/\/__tests__\//.test(rel)) continue; // tests may quote literals as fixtures
    const src = stripComments(raw);
    const grandfathered = GRANDFATHERED[rel];

    // 3 — the dead route, banned everywhere including the owner itself.
    if (!(grandfathered !== undefined && grandfathered.has(DEAD_ROUTE.id))) {
      if (DEAD_ROUTE.re.test(src)) {
        failures.push(`${rel}: ${DEAD_ROUTE.why} (banned by #2240).`);
      }
    }

    // 4 + 5 — second destinations, only inside the email templates.
    if (rel === OWNER) continue;
    if (!rel.startsWith(EMAIL_DIR)) continue;
    for (const { id, re, why } of EMAIL_BANNED) {
      if (grandfathered !== undefined && grandfathered.has(id)) continue;
      if (re.test(src)) failures.push(`${rel}: ${why} (banned by #2240).`);
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
    checkEmailAppLinkSoleOwner(files, f);
    return f;
  };

  const bizFix = `
export const APP_STORE_URL = "https://apps.apple.com/app/id6760440898";
export const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.mingla.app.v2";
export const DOWNLOAD_PAGE_URL = "https://usemingla.com/download";
export const GUEST_FUNNEL_ONELINK_URL: string | null = null;
`;
  const ownerFix = `
import { SHELL_TOKENS } from "./shell.ts";
export const MINGLA_APP_LINK_URL = "https://usemingla.com/download";
export function renderAppCtaHtml(h) { return \`<a href="\${MINGLA_APP_LINK_URL}">Open in Mingla</a>\`; }
`;
  const cleanTemplate = `
import { appCtaTextLine, renderAppCtaHtml } from "./appLink.ts";
export function render() { return renderAppCtaHtml("Join your event chat in the Mingla app"); }
`;
  const good = {
    [BIZ_SSOT]: bizFix,
    [OWNER]: ownerFix,
    "supabase/functions/_shared/email/ticketBody.ts": cleanTemplate,
    "supabase/functions/_shared/email/tripConfirmationEmail.ts": cleanTemplate,
    "supabase/functions/_shared/email/experienceConfirmationEmail.ts": cleanTemplate,
  };
  if (run(good).length !== 0) {
    selfFailures.push("compliant fixture wrongly flagged: " + JSON.stringify(run(good)));
  }

  // 1. Missing owner module → fire.
  const noOwner = { ...good };
  delete noOwner[OWNER];
  if (run(noOwner).length === 0) selfFailures.push("missing appLink.ts SSOT not flagged");

  // 2. Missing the exported constant → fire.
  const noConst = { ...good, [OWNER]: ownerFix.replace(/export const MINGLA_APP_LINK_URL[^\n]*\n/, "") };
  if (run(noConst).length === 0) selfFailures.push("missing MINGLA_APP_LINK_URL export not flagged");

  // 3. THE #2240 DEFECT ITSELF, re-introduced in a template → fire.
  const deadRoute = {
    ...good,
    "supabase/functions/_shared/email/ticketBody.ts":
      cleanTemplate + '\nconst u = `https://usemingla.com/orders/${id}/chat`;\n',
  };
  if (run(deadRoute).length === 0) {
    selfFailures.push("the usemingla.com/orders dead route was NOT flagged — this gate is decorative");
  }

  // 4. …and outside the email dir too (it was in mingla-business as well).
  const deadRouteBiz = {
    ...good,
    "mingla-business/src/components/checkout/DownloadMinglaCta.tsx":
      'const universalLink = `https://usemingla.com/orders/${orderId}/chat`;\n',
  };
  if (run(deadRouteBiz).length === 0) selfFailures.push("dead route in mingla-business not flagged");

  // 5. Case-insensitivity — a browser does not care about case.
  const deadUpper = {
    ...good,
    "supabase/functions/_shared/email/ticketBody.ts":
      cleanTemplate + '\nconst u = "https://USEMINGLA.COM/ORDERS/x/chat";\n',
  };
  if (run(deadUpper).length === 0) selfFailures.push("UPPERCASE USEMINGLA.COM/ORDERS not flagged (gate is case-SENSITIVE)");

  // 6. A second hand-written copy of the LIVE destination → fire.
  const secondCopy = {
    ...good,
    "supabase/functions/_shared/email/tripConfirmationEmail.ts":
      cleanTemplate + '\nconst u = "https://usemingla.com/download";\n',
  };
  if (run(secondCopy).length === 0) selfFailures.push("a second usemingla.com/download copy in a template not flagged");

  // 7. A store literal in an email template (email cannot detect a device) → fire.
  for (const [label, literal] of [
    ["apps.apple.com", 'const u = "https://apps.apple.com/app/id6760440898";'],
    ["play.google.com/store", 'const u = "https://play.google.com/store/apps/details?id=com.mingla.app.v2";'],
    ["go.usemingla.com", 'const u = "https://go.usemingla.com/w36m";'],
  ]) {
    const fixture = {
      ...good,
      "supabase/functions/_shared/email/experienceConfirmationEmail.ts": cleanTemplate + "\n" + literal + "\n",
    };
    if (run(fixture).length === 0) selfFailures.push(`${label} literal in an email template not flagged`);
  }

  // 8. A template rendering its own CTA button → fire.
  const ownCta = {
    ...good,
    "supabase/functions/_shared/email/ticketBody.ts":
      cleanTemplate + '\nconst a = `<a href="${x}">Open in Mingla</a>`;\n',
  };
  if (run(ownCta).length === 0) selfFailures.push("a template rendering its own 'Open in Mingla' button not flagged");

  // 9. DRIFT while DARK: the email must land where the page's button lands.
  const drifted = {
    ...good,
    [OWNER]: ownerFix.replace("https://usemingla.com/download", "https://usemingla.com/get-the-app"),
  };
  if (run(drifted).length === 0) selfFailures.push("MINGLA_APP_LINK_URL drifted from DOWNLOAD_PAGE_URL and was not flagged");

  // 10. THE GO-LIVE CASE. Seth flips GUEST_FUNNEL_ONELINK_URL: the page's button
  // becomes the OneLink, so the email must follow or this gate goes red.
  const flippedLive = {
    ...good,
    [BIZ_SSOT]: bizFix.replace(
      'export const GUEST_FUNNEL_ONELINK_URL: string | null = null;',
      'export const GUEST_FUNNEL_ONELINK_URL: string | null = "https://go.usemingla.com/w36m";',
    ),
  };
  if (run(flippedLive).length === 0) {
    selfFailures.push("the guest-funnel go-live flip did NOT force the email app link to follow the page");
  }

  // 11. …and once the email DOES follow the flip, the gate is quiet again.
  const flippedAndFollowed = {
    ...flippedLive,
    [OWNER]: ownerFix.replace(
      "https://usemingla.com/download",
      "https://go.usemingla.com/w36m?pid=email&c=ticket_confirmation",
    ),
  };
  if (run(flippedAndFollowed).length !== 0) {
    selfFailures.push("the email following the go-live flip was wrongly flagged: " + JSON.stringify(run(flippedAndFollowed)));
  }

  // 12. GUEST_FUNNEL_ONELINK_URL in a shape the gate cannot read → fire loudly
  // rather than silently pass (an unreadable SSOT must never read as compliant).
  const unparseable = {
    ...good,
    [BIZ_SSOT]: bizFix.replace(
      'export const GUEST_FUNNEL_ONELINK_URL: string | null = null;',
      'export const GUEST_FUNNEL_ONELINK_URL: string | null = resolveFlip();',
    ),
  };
  if (run(unparseable).length === 0) selfFailures.push("an unparseable GUEST_FUNNEL_ONELINK_URL was silently treated as compliant");

  // 13. Banned tokens inside COMMENTS are stripped → still passes (docblocks
  // must be able to name the dead route in order to explain it).
  const commented = {
    ...good,
    "supabase/functions/_shared/email/ticketBody.ts":
      cleanTemplate +
      "\n// the old usemingla.com/orders/{id}/chat path was a 404 — see appLink.ts\n" +
      "/* it also used apps.apple.com and go.usemingla.com at one point */\n",
  };
  if (run(commented).length !== 0) {
    selfFailures.push("commented banned tokens wrongly flagged (comment-strip broken): " + JSON.stringify(run(commented)));
  }

  // 14. __tests__ fixtures may quote every banned literal (they assert absence).
  const testFixture = {
    ...good,
    "supabase/functions/_shared/email/__tests__/issue_2240_email_app_link.test.ts":
      'const DEAD = "/orders/x/chat"; const D = "https://usemingla.com/download"; // "Open in Mingla"\n',
  };
  if (run(testFixture).length !== 0) {
    selfFailures.push("__tests__ fixture literals wrongly flagged: " + JSON.stringify(run(testFixture)));
  }

  // 15. The owner file may (and must) carry the destination and the CTA copy.
  if (run(good).length !== 0) selfFailures.push("the owner module was wrongly flagged for carrying its own destination");

  // 16. A store literal OUTSIDE the email dir is none of this gate's business —
  // orch-1342 owns that scope. Overlapping bans produce duplicate failures and
  // teach people to ignore gates.
  const outsideScope = {
    ...good,
    "mingla-marketing/lib/store-links.ts": 'export const APP_STORE_URL = "https://apps.apple.com/app/id6760440898"\n',
  };
  if (run(outsideScope).length !== 0) {
    selfFailures.push("a store literal outside the email dir was wrongly flagged: " + JSON.stringify(run(outsideScope)));
  }

  if (selfFailures.length) {
    console.error("#2240 email-app-link-sole-owner self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "#2240 email-app-link-sole-owner self-test PASS (16/16 cases, incl. the dead\n" +
      "  usemingla.com/orders route in both runtimes, its uppercase form, a second\n" +
      "  hand-written destination, a template rendering its own CTA, DARK drift, the\n" +
      "  guest-funnel GO-LIVE flip forcing the email to follow the page, and an\n" +
      "  unparseable flip constant failing loudly instead of passing).",
  );
  process.exit(0);
}

// ---- Live mode
const files = {};
for (const rel of [OWNER, BIZ_SSOT]) {
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
checkEmailAppLinkSoleOwner(files, failures);

if (failures.length > 0) {
  console.error(
    "#2240 (I-2240-EMAIL-APP-LINK-SOLE-OWNER) FAIL — the 'Open in Mingla' destination\n" +
      "lives ONLY in supabase/functions/_shared/email/appLink.ts, tracks the arm of\n" +
      "#2217's resolveConfirmationAppTarget that an email is ('other'), and the dead\n" +
      "usemingla.com/orders route exists nowhere.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "#2240 PASS — one email app-link owner (appLink.ts), in step with the confirmation\n" +
    "page's destination, and no usemingla.com/orders literal anywhere.",
);
