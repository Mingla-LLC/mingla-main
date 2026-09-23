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
 * ─── THE RULE, RESTATED AT #3524's FOLLOW-UP ────────────────────────────────
 *
 * The CTA's href used to be `MINGLA_APP_LINK_URL`, full stop. It is now EITHER
 * the per-order attendance claim URL the caller threaded in, OR that constant as
 * the fallback — because the confirmation email carries ONE call to action now
 * instead of two, and the one it carries has to be the useful link when there is
 * one. (Before: "Open in Mingla" went to the download page while a separate
 * "Connect your attendance" block, concatenated onto the body by
 * `ticket-confirmation-dispatch`, carried the real claim URL below it.)
 *
 * That widens the destination from one constant to two arms, so sole-ownership
 * has to be enforced one level up: appLink.ts still owns the DECISION. Rule 6
 * below is the restatement — exactly one function chooses between the two arms,
 * and the HTML button and its plain-text twin both go through it and may name no
 * URL of their own. #2240's lockstep requirement ("the text body carries the SAME
 * link as the HTML") therefore holds by construction on both arms, which is the
 * property the old byte-identical-constant check was really buying.
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
 *   6. In appLink.ts, ONE resolver decides the CTA destination:
 *        a. `resolveAppCtaUrl` is exported;
 *        b. its body names `MINGLA_APP_LINK_URL` — the fallback arm exists, so a
 *           missing or malformed claim URL still yields a working button and a
 *           confirmation email can never lose its route into the app;
 *        c. `renderAppCtaHtml` and `appCtaTextLine` each call
 *           `resolveAppCtaUrl(`, and NEITHER names `MINGLA_APP_LINK_URL`
 *           itself. A body that reads the constant directly has opted out of the
 *           claim-URL arm, which is how the HTML and the text would silently come
 *           to carry different links;
 *        d. none of those three bodies contains a hosted URL literal of its own
 *           (a bare `"https://"` scheme test is fine — it names no host).
 *      Bodies are read by slice, and a body this gate cannot find is a LOUD
 *      failure, never a silent pass.
 * BAN (comment-stripped, `__tests__` excluded — tests quote fixtures):
 *   3. any `usemingla.com/orders` literal in supabase/functions, mingla-business
 *      src/app, mingla-marketing or app-mobile. The dead path, killed as a class.
 *   4. in `supabase/functions/_shared/email/**` outside appLink.ts: any app
 *      destination literal (usemingla.com/download, apps.apple.com,
 *      play.google.com/store, go.usemingla.com) — a second hand-written
 *      destination is the whole recurrence.
 *   5. the string `Open in Mingla` anywhere under `supabase/functions/**`
 *      outside appLink.ts. WIDENED at #3524's follow-up from the email directory
 *      to the whole edge runtime: the second CTA this change removes was not
 *      written in a template at all, it was assembled by
 *      `ticket-confirmation-dispatch` from its own markup, one directory outside
 *      the old scope. The CTA markup lives in appLink.ts, so any other edge file
 *      that renders that button fails here.
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
/** Rule 5's scope. WIDER than EMAIL_DIR — see the docblock. */
const EDGE_DIR = "supabase/functions/";
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

/**
 * A HOSTED URL literal. Deliberately requires a character after `//`, so the
 * scheme test inside `resolveAppCtaUrl` (`startsWith("https://")`) does not read
 * as a second destination — it names no host and can reach no buyer.
 */
const HOSTED_URL_LITERAL = /https?:\/\/[A-Za-z0-9]/i;

/**
 * The source of `function NAME(...)` including its body, by BRACE COUNTING from
 * the body's opening `{`.
 *
 * Not "slice to the next `\n}`": that over-reads a one-line function straight into
 * its neighbour, and an over-read body can borrow the neighbour's compliance and
 * report green. Counting is exact for balanced code and returns null when it is
 * not — including for a brace inside a string literal, which fails in the SAFE
 * direction because rule 6 turns null into a LOUD failure. A gate that cannot
 * read the thing it checks must never report compliant (#2113).
 */
function sliceFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return null;
  const open = src.indexOf("{", start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
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

/**
 * Rule 5, on its own because its scope is now the whole edge runtime rather than
 * the email directory. WIDENED at #3524's follow-up: the second CTA that change
 * removed was assembled by `ticket-confirmation-dispatch`, one directory outside
 * EMAIL_DIR, so the old scope could not see it.
 */
const CTA_BAN = {
  id: "cta",
  re: /Open in Mingla/,
  why:
    "renders its own 'Open in Mingla' button. The CTA markup AND its destination live in appLink.ts (renderAppCtaHtml / appCtaTextLine) so nothing else in the edge runtime may ship a private copy — that is how a confirmation email came to carry TWO competing calls to action",
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

  // ── 6 — ONE resolver decides the CTA destination ─────────────────────────
  // The href is now either the per-order claim URL the caller threaded in or
  // MINGLA_APP_LINK_URL as the fallback, so sole-ownership means owning the
  // CHOICE. This is also what keeps the plain-text twin in lockstep with the
  // HTML on BOTH arms — the property #2240's constant check used to buy for free.
  if (owner !== undefined) {
    const ownerSrc = stripComments(owner);

    if (!/export\s+function\s+resolveAppCtaUrl\s*\(/.test(ownerSrc)) {
      failures.push(
        `${OWNER}: missing "export function resolveAppCtaUrl(" — the CTA's destination is EITHER the caller's per-order claim URL or MINGLA_APP_LINK_URL, and exactly one exported function must make that choice for both the HTML button and its plain-text twin.`,
      );
    }

    const RESOLVER = "resolveAppCtaUrl";
    const EMITTERS = ["renderAppCtaHtml", "appCtaTextLine"];
    for (const name of [RESOLVER, ...EMITTERS]) {
      const body = sliceFunction(ownerSrc, name);
      if (body === null) {
        failures.push(
          `${OWNER}: could not read the body of ${name}() — this gate will not report compliant on a file it cannot parse. Keep it a top-level \`function ${name}(\` declaration.`,
        );
        continue;
      }
      if (HOSTED_URL_LITERAL.test(body)) {
        failures.push(
          `${OWNER}: ${name}() contains a hosted URL literal of its own. Every destination this module can emit comes from MINGLA_APP_LINK_URL or from the claim URL the caller passes — a third one written inline is the #2240 recurrence, inside the owner module this time.`,
        );
      }
      if (name === RESOLVER) {
        if (!body.includes("MINGLA_APP_LINK_URL")) {
          failures.push(
            `${OWNER}: ${RESOLVER}() never names MINGLA_APP_LINK_URL, so it has no fallback arm. An order with no claim URL (already connected, or the confirm screen armed the proof first) would then get a CTA with no destination — a confirmation email must never lose its route into the app.`,
          );
        }
        continue;
      }
      if (!body.includes(`${RESOLVER}(`)) {
        failures.push(
          `${OWNER}: ${name}() does not call ${RESOLVER}(...). Both bodies must route through the one resolver, or the HTML button and the plain-text line can carry DIFFERENT links (#2240 requires them identical).`,
        );
      }
      if (body.includes("MINGLA_APP_LINK_URL")) {
        failures.push(
          `${OWNER}: ${name}() reads MINGLA_APP_LINK_URL directly instead of going through ${RESOLVER}(...). That is how one body silently opts out of the per-order claim URL while the other keeps it — exactly the HTML/text divergence #2240 forbids.`,
        );
      }
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

    if (rel === OWNER) continue;

    // 5 — a private "Open in Mingla" button, anywhere in the edge runtime.
    if (
      rel.startsWith(EDGE_DIR) &&
      !(grandfathered !== undefined && grandfathered.has(CTA_BAN.id)) &&
      CTA_BAN.re.test(src)
    ) {
      failures.push(`${rel}: ${CTA_BAN.why} (banned by #2240).`);
    }

    // 4 — second destinations, only inside the email templates.
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
  // Shaped like the real module: top-level `function` declarations whose closing
  // brace is at column 0, which is what sliceFunction reads. A one-line function
  // is deliberately UNREADABLE to it and is exercised as its own case below.
  const ownerFix = `
import { escapeHtml } from "./escape.ts";
import { SHELL_TOKENS } from "./shell.ts";
export const MINGLA_APP_LINK_URL = "https://usemingla.com/download";
export function resolveAppCtaUrl(claimUrl) {
  if (typeof claimUrl === "string" && claimUrl.trim().startsWith("https://")) {
    return claimUrl.trim();
  }
  return MINGLA_APP_LINK_URL;
}
export function renderAppCtaHtml(h, claimUrl) {
  return \`<a href="\${escapeHtml(resolveAppCtaUrl(claimUrl))}">Open in Mingla</a>\`;
}
export function appCtaTextLine(h, claimUrl) {
  return \`\${h}: \${resolveAppCtaUrl(claimUrl)}\`;
}
`;
  const cleanTemplate = `
import { appCtaTextLine, renderAppCtaHtml } from "./appLink.ts";
export function render(claimUrl) {
  return renderAppCtaHtml("Your ticket, the event chat, and who's going — all in the app", claimUrl);
}
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

  // ── #3524 FOLLOW-UP: rule 6, the one-resolver restatement ────────────────

  // 17. No resolver at all → fire. Without it there is no single place that
  // chooses between the claim URL and the fallback.
  const noResolver = {
    ...good,
    [OWNER]: ownerFix
      .replace("export function resolveAppCtaUrl", "function privateResolve")
      .replaceAll("resolveAppCtaUrl(claimUrl)", "privateResolve(claimUrl)"),
  };
  if (run(noResolver).length === 0) {
    selfFailures.push("a missing exported resolveAppCtaUrl was not flagged");
  }

  // 18. The HTML button reads the CONSTANT directly, bypassing the resolver →
  // fire. That is the shape where the button silently loses the per-order link
  // while the text line keeps it.
  const htmlBypassesResolver = {
    ...good,
    [OWNER]: ownerFix.replace(
      "escapeHtml(resolveAppCtaUrl(claimUrl))",
      "escapeHtml(MINGLA_APP_LINK_URL)",
    ),
  };
  if (run(htmlBypassesResolver).length === 0) {
    selfFailures.push(
      "renderAppCtaHtml reading MINGLA_APP_LINK_URL directly (bypassing the resolver) was not flagged",
    );
  }

  // 19. THE #2240 LOCKSTEP FAILURE, in its new form: the plain-text twin pinned
  // to the constant while the HTML carries the claim URL → fire.
  const textTwinDiverges = {
    ...good,
    [OWNER]: ownerFix.replace(
      "${h}: ${resolveAppCtaUrl(claimUrl)}",
      "${h}: ${MINGLA_APP_LINK_URL}",
    ),
  };
  if (run(textTwinDiverges).length === 0) {
    selfFailures.push(
      "appCtaTextLine pinned to MINGLA_APP_LINK_URL while the HTML resolves a claim URL was not flagged — the text twin may diverge",
    );
  }

  // 20. The resolver with NO fallback arm → fire. An order with no claim URL
  // must still get a working button, which is Seth's #3524 decision.
  const noFallbackArm = {
    ...good,
    [OWNER]: ownerFix.replace("  return MINGLA_APP_LINK_URL;\n", "  return \"\";\n"),
  };
  if (run(noFallbackArm).length === 0) {
    selfFailures.push(
      "resolveAppCtaUrl with no MINGLA_APP_LINK_URL fallback arm was not flagged",
    );
  }

  // 21. A THIRD destination written inline in the owner module itself → fire.
  // The email-scoped ban (rule 4) skips the owner, so rule 6 has to catch this.
  const ownerInlineDestination = {
    ...good,
    [OWNER]: ownerFix.replace(
      "  return MINGLA_APP_LINK_URL;\n",
      '  return "https://usemingla.com/get-the-app";\n',
    ),
  };
  if (run(ownerInlineDestination).length === 0) {
    selfFailures.push(
      "a hosted URL literal written inline inside the owner module's resolver was not flagged",
    );
  }

  // 22. THE #3524 DEFECT ITSELF. `ticket-confirmation-dispatch` appended its own
  // second CTA to the finished body — one directory OUTSIDE the old rule-5 scope,
  // which is why the gate could not see it. It must fire now.
  const dispatchOwnCta = {
    ...good,
    "supabase/functions/ticket-confirmation-dispatch/index.ts":
      'const extra = `<a href="${claimUrl}">Open in Mingla</a>`;\n',
  };
  if (run(dispatchOwnCta).length === 0) {
    selfFailures.push(
      "an edge function outside the email dir rendering its own 'Open in Mingla' button was NOT flagged — this is the #3524 two-CTA defect and rule 5's whole reason for widening",
    );
  }

  // 23. An emitter this gate cannot FIND must fail loudly, never pass. A check
  // that cannot fail carries no information (#2113).
  const emitterMissing = {
    ...good,
    [OWNER]: ownerFix.replaceAll("function appCtaTextLine", "function ctaText"),
  };
  if (run(emitterMissing).length === 0) {
    selfFailures.push(
      "an owner module with no readable appCtaTextLine was silently treated as compliant",
    );
  }

  // 24. …but the gate checks CODE, not formatting: a compliant body written on
  // one line must still pass, or the rule above is really a style rule and the
  // next person routes around it by reformatting.
  const compliantOneLiner = {
    ...good,
    [OWNER]: ownerFix.replace(
      /export function appCtaTextLine[\s\S]*?\n}\n/,
      "export function appCtaTextLine(h, c) { return h + \": \" + resolveAppCtaUrl(c); }\n",
    ),
  };
  if (run(compliantOneLiner).length !== 0) {
    selfFailures.push(
      "a compliant one-line appCtaTextLine was wrongly flagged (the body slicer over-reads into its neighbour): " +
        JSON.stringify(run(compliantOneLiner)),
    );
  }

  if (selfFailures.length) {
    console.error("#2240 email-app-link-sole-owner self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "#2240 email-app-link-sole-owner self-test PASS (24/24 cases, incl. the dead\n" +
      "  usemingla.com/orders route in both runtimes, its uppercase form, a second\n" +
      "  hand-written destination, a template rendering its own CTA, DARK drift, the\n" +
      "  guest-funnel GO-LIVE flip forcing the email to follow the page, an\n" +
      "  unparseable flip constant failing loudly instead of passing, and — since\n" +
      "  #3524's follow-up — a missing CTA resolver, either body bypassing it, the\n" +
      "  plain-text twin pinned to the constant while the HTML resolves a claim URL,\n" +
      "  a resolver with no fallback arm, a third destination inline in the owner,\n" +
      "  an edge function outside the email dir shipping its own button, an owner\n" +
      "  module whose emitter cannot be found, and a compliant one-line body that\n" +
      "  must still pass so the rule is about code and not formatting.",
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
