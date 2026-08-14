#!/usr/bin/env node
/**
 * ORCH-1399 [links-src-tracking-getapp-stack].
 * Invariant: I-PROPOSED-1399-LINKS-SRC-BIO-PID-NEVER-CROSSED (DRAFT until CLOSE).
 *
 * WHAT THIS PROTECTS. usemingla.com/links is the single link in Seth's social bios.
 * `?src=youtube` now rides into the AppsFlyer OneLink as `pid=bio_youtube`, so an
 * install from a given bio is finally attributable. Two things can silently destroy
 * that, and neither produces an error, a crash, or a visibly broken page:
 *
 *   (1) A MALFORMED pid. `src` is UNTRUSTED INPUT that lands inside an OUTBOUND URL.
 *       An unanchored sanitisation regex, or a pid built by bare interpolation, emits
 *       junk that still "works" — the link resolves, the store opens, and the
 *       reporting is silently poisoned. Worse, a BARE platform name (`pid=facebook`)
 *       mints a custom media source sitting one row from the real `Facebook Ads` SRN
 *       in every dashboard: organic bio traffic gets read as PAID SOCIAL.
 *   (2) A CROSSED base. `go.usemingla.com/w36m` (consumer) and `biz.usemingla.com/
 *       ZSCW` (business) differ by a handful of characters and are declared four
 *       lines apart. Swap them and every CTA still works, every link still 301s, a
 *       store still opens — it is simply the WRONG APP, and BOTH apps' attribution is
 *       poisoned. Nothing to eyeball, nothing to crash.
 *
 * Over mingla-marketing/lib/store-links.ts + lib/links-src.ts + app/links/page.tsx +
 * the 4 CTA surfaces (comment-stripped) REQUIRE:
 *   R1. EXPLORER_ONELINK_URL's value carries go.usemingla.com AND w36m, and NEITHER
 *       biz. / minglabiz / ZSCW.
 *   R2. BUSINESS_ONELINK_URL's value carries biz.usemingla.com AND ZSCW, and NEITHER
 *       go.usemingla.com / w36m / a raw *.onelink.me domain.
 *   R3. links-src.ts defines LINKS_PID_PREFIX = 'bio_' and toBioPid is the ONLY
 *       writer of that prefix (H-1 is structural, not remembered).
 *   R4. the sanitisation regex is ANCHORED (^…$).            ⭐ non-decorative tooth
 *   R5. toBioPid returns a template ROOTED at LINKS_PID_PREFIX. ⭐ non-decorative tooth
 *   R6. no CTA surface carries a go.usemingla.com / biz.usemingla.com / *.onelink.me
 *       LITERAL (the bases live in store-links.ts; a surface literal is SSOT drift).
 *   R7. app/links/page.tsx calls sanitizeLinksSrc( and never passes searchParams
 *       straight into a href (untrusted input reaching an external URL).
 *
 * WHY R4 AND R5 ARE THE TEETH. Every other check here is a token-presence check, and
 * a token-presence check CANNOT see either of the two defects that actually matter:
 *   - R4: `/[a-z0-9_]{1,32}/` without anchors finds a PARTIAL match inside
 *     `<script>alert(1)</script>` and emits it. The token LINKS_SRC_PATTERN is still
 *     present; the regex is still "there"; the sanitiser is simply bypassed. This is
 *     the single most likely sanitisation bug and the cheapest to ship by accident.
 *   - R5: a pid built as `${src}` instead of `${LINKS_PID_PREFIX}${src}` passes every
 *     presence check in this file — LINKS_PID_PREFIX is still declared, still
 *     exported, still imported — while violating H-1 on every single request.
 * Both are verified STRUCTURALLY, against the declaration itself.
 *
 * --self-test injects fixtures (compliant → pass; each violation → fire; a banned
 * token inside a COMMENT is stripped and still passes).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const STORE_LINKS = "mingla-marketing/lib/store-links.ts";
const LINKS_SRC = "mingla-marketing/lib/links-src.ts";
const LINKS_PAGE = "mingla-marketing/app/links/page.tsx";
const SURFACES = [
  "mingla-marketing/components/marketing/links-experience.tsx",
  "mingla-marketing/components/marketing/glass-nav.tsx",
  "mingla-marketing/components/sections/organiser-home/hero.tsx",
  "mingla-marketing/app/host/download/page.tsx",
];

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Read a `export const NAME = '...'` string value. */
function constValue(src, name) {
  const re = new RegExp(`export const ${name}\\s*(?::\\s*[^=]+)?=\\s*['"\`]([^'"\`]+)['"\`]`);
  const m = re.exec(src);
  return m ? m[1] : null;
}

function checkStoreLinks(rawSrc, failures) {
  const src = stripComments(rawSrc);

  // R1 — the CONSUMER base.
  const explorer = constValue(src, "EXPLORER_ONELINK_URL");
  if (explorer === null) {
    failures.push(`${STORE_LINKS}: EXPLORER_ONELINK_URL is not declared as a string literal (R1).`);
  } else {
    if (!explorer.includes("go.usemingla.com")) {
      failures.push(`${STORE_LINKS}: EXPLORER_ONELINK_URL "${explorer}" is not on the CONSUMER branded domain go.usemingla.com (R1).`);
    }
    if (!explorer.includes("w36m")) {
      failures.push(`${STORE_LINKS}: EXPLORER_ONELINK_URL "${explorer}" does not carry the CONSUMER template id w36m (R1).`);
    }
    for (const bad of ["biz.usemingla.com", "minglabiz", "ZSCW"]) {
      if (explorer.includes(bad)) {
        failures.push(
          `${STORE_LINKS}: EXPLORER_ONELINK_URL "${explorer}" carries the BUSINESS token "${bad}" — CROSSED. ` +
            `Consumers would install the BUSINESS app and both apps' attribution is poisoned (R1, H-2).`,
        );
      }
    }
  }

  // R2 — the BUSINESS base.
  const business = constValue(src, "BUSINESS_ONELINK_URL");
  if (business === null) {
    failures.push(`${STORE_LINKS}: BUSINESS_ONELINK_URL is not declared as a string literal (R2).`);
  } else {
    if (!business.includes("biz.usemingla.com")) {
      failures.push(`${STORE_LINKS}: BUSINESS_ONELINK_URL "${business}" is not on the BUSINESS branded domain biz.usemingla.com (R2).`);
    }
    if (!business.includes("ZSCW")) {
      failures.push(`${STORE_LINKS}: BUSINESS_ONELINK_URL "${business}" does not carry the BUSINESS template id ZSCW (R2).`);
    }
    for (const bad of ["go.usemingla.com", "w36m"]) {
      if (business.includes(bad)) {
        failures.push(
          `${STORE_LINKS}: BUSINESS_ONELINK_URL "${business}" carries the CONSUMER token "${bad}" — CROSSED. ` +
            `Business owners would install the Explorer app and both apps' attribution is poisoned (R2, H-2).`,
        );
      }
    }
    if (/onelink\.me/.test(business)) {
      failures.push(
        `${STORE_LINKS}: BUSINESS_ONELINK_URL "${business}" uses a RAW *.onelink.me domain — business traffic ` +
          `uses the BRANDED biz.usemingla.com (ORCH-1346: one branded domain = one template) (R2, H-3).`,
      );
    }
  }
  if (explorer !== null && business !== null && explorer === business) {
    failures.push(`${STORE_LINKS}: the EXPLORER and BUSINESS OneLink bases are BYTE-IDENTICAL — one app is unreachable (R1/R2).`);
  }
}

function checkLinksSrc(rawSrc, failures) {
  const src = stripComments(rawSrc);

  // R3 — the prefix constant exists and is exactly 'bio_'.
  const prefix = constValue(src, "LINKS_PID_PREFIX");
  if (prefix === null) {
    failures.push(`${LINKS_SRC}: LINKS_PID_PREFIX is not declared as a string literal (R3).`);
  } else if (prefix !== "bio_") {
    failures.push(
      `${LINKS_SRC}: LINKS_PID_PREFIX is "${prefix}", must be "bio_". A bare platform pid (e.g. "facebook") ` +
        `mints a custom media source one row from the real "Facebook Ads" SRN, so organic bio traffic reads ` +
        `as PAID SOCIAL in every dashboard (R3, H-1).`,
    );
  }

  // R3b — STRUCTURAL: 'bio_' is written in exactly ONE place, so toBioPid is the only
  // writer and H-1 cannot be bypassed by a second literal somewhere else.
  const literals = src.match(/['"`]bio_['"`]/g) ?? [];
  if (literals.length !== 1) {
    failures.push(
      `${LINKS_SRC}: the 'bio_' literal appears ${literals.length}× — it must exist in EXACTLY ONE place ` +
        `(the LINKS_PID_PREFIX declaration) so toBioPid stays the single writer of the prefix (R3, H-1 structural).`,
    );
  }

  // R4 ⭐ — the sanitisation regex must be ANCHORED. THE tooth.
  const decl = /LINKS_SRC_PATTERN\s*(?::\s*RegExp\s*)?=\s*(\/[^\n]+?\/[gimsuy]*)/.exec(src);
  if (decl === null) {
    failures.push(`${LINKS_SRC}: LINKS_SRC_PATTERN is not declared as a regex literal — gate parse out of sync (R4).`);
  } else {
    const literal = decl[1];
    if (!literal.startsWith("/^") || !/\$\/[gimsuy]*$/.test(literal)) {
      failures.push(
        `${LINKS_SRC}: LINKS_SRC_PATTERN ${literal} is NOT ANCHORED (^…$). An unanchored charset finds a ` +
          `PARTIAL match inside hostile input — "<script>alert(1)</script>" would MATCH and be emitted into ` +
          `the outbound OneLink as pid=bio_<script>alert(1)</script>. The token is still present and the ` +
          `regex still "exists": only the anchors make the sanitiser actually sanitise (R4).`,
      );
    }
  }

  // R5 ⭐ — toBioPid must be ROOTED at the prefix constant. THE other tooth.
  const body = /export function toBioPid\([^)]*\)\s*:\s*string\s*\{([\s\S]*?)\n\}/.exec(src);
  if (body === null) {
    failures.push(`${LINKS_SRC}: toBioPid is not declared with the expected shape — gate parse out of sync (R5).`);
  } else {
    const rooted = /return\s+`\$\{LINKS_PID_PREFIX\}\$\{[A-Za-z_][A-Za-z0-9_]*\}`/.test(body[1]) ||
      /return\s+LINKS_PID_PREFIX\s*\+/.test(body[1]);
    if (!rooted) {
      failures.push(
        `${LINKS_SRC}: toBioPid does not return a template/concat ROOTED at LINKS_PID_PREFIX (R5). A bare ` +
          `\`\${src}\` interpolation passes EVERY presence check in this gate — LINKS_PID_PREFIX is still ` +
          `declared, exported and imported — while violating H-1 on every request.`,
      );
    }
  }

  // R5b — the builder must encode, not concatenate.
  if (!/new URLSearchParams\(/.test(src)) {
    failures.push(
      `${LINKS_SRC}: buildOneLinkHref must compose its query with URLSearchParams — manual concat is a ` +
        `silent injection hole the moment the charset widens (R5).`,
    );
  }

  // R5c — the fail-safe must exist and be non-empty.
  const fallback = constValue(src, "LINKS_SRC_FALLBACK");
  if (fallback === null || fallback.length === 0) {
    failures.push(
      `${LINKS_SRC}: LINKS_SRC_FALLBACK must be a non-empty literal. Omitting the pid lets the install fall to ` +
        `the OneLink template default — indistinguishable from organic, which re-creates the exact anonymity ` +
        `this ORCH exists to kill; an EMPTY one emits the valid-looking but meaningless pid "bio_" (R5).`,
    );
  }
}

function checkLinksPage(rawSrc, failures) {
  const src = stripComments(rawSrc);
  // R7 — the untrusted input is sanitised at the boundary.
  if (!/sanitizeLinksSrc\(/.test(src)) {
    failures.push(
      `${LINKS_PAGE}: must call sanitizeLinksSrc( on searchParams.src — \`src\` is UNTRUSTED INPUT that ` +
        `reaches an OUTBOUND URL and must be sanitised at the boundary, once (R7, H-4).`,
    );
  }
  // R7b — and never handed to a component raw.
  if (/src=\{\s*(?:await\s+)?searchParams/.test(src) || /src=\{\s*src\s*\}/.test(src) === false && /searchParams\.src\s*\}/.test(src)) {
    failures.push(
      `${LINKS_PAGE}: passes searchParams straight through — the raw, unsanitised value must never reach a ` +
        `component or an href (R7, H-4).`,
    );
  }
}

function checkSurface(label, rawSrc, failures) {
  const src = stripComments(rawSrc);
  // R6 — SSOT: the bases live in store-links.ts; a surface literal is drift.
  const BANNED = [
    { re: /['"`]https:\/\/go\.usemingla\.com/, why: "hardcodes the go.usemingla.com OneLink LITERAL — the base lives in lib/store-links.ts (EXPLORER_ONELINK_URL); reference the identifier (R6, SSOT)" },
    { re: /['"`]https:\/\/biz\.usemingla\.com/, why: "hardcodes the biz.usemingla.com OneLink LITERAL — the base lives in lib/store-links.ts (BUSINESS_ONELINK_URL); reference the identifier (R6, SSOT)" },
    { re: /onelink\.me/, why: "references a RAW *.onelink.me domain — branded domains only (ORCH-1346: one branded domain = one template) (R6, H-3)" },
  ];
  for (const { re, why } of BANNED) {
    if (re.test(src)) failures.push(`${label}: ${why}.`);
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const runStore = (s) => { const f = []; checkStoreLinks(s, f); return f; };
  const runSrc = (s) => { const f = []; checkLinksSrc(s, f); return f; };
  const runPage = (s) => { const f = []; checkLinksPage(s, f); return f; };
  const runSurface = (s) => { const f = []; checkSurface("fixture", s, f); return f; };

  const goodStore = `
export const EXPLORER_ONELINK_URL = 'https://go.usemingla.com/w36m'
export const BUSINESS_ONELINK_URL = 'https://biz.usemingla.com/ZSCW'
`;
  if (runStore(goodStore).length !== 0) selfFailures.push("compliant store-links wrongly flagged: " + JSON.stringify(runStore(goodStore)));

  const goodSrc = `
export const LINKS_SRC_PATTERN = /^[a-z0-9_]{1,32}$/
export const LINKS_SRC_FALLBACK = 'direct'
export const LINKS_PID_PREFIX = 'bio_'
export function sanitizeLinksSrc(raw) {
  if (typeof raw !== 'string') return LINKS_SRC_FALLBACK
  const normalised = raw.trim().toLowerCase()
  if (!LINKS_SRC_PATTERN.test(normalised)) return LINKS_SRC_FALLBACK
  return normalised
}
export function toBioPid(src: string): string {
  return \`\${LINKS_PID_PREFIX}\${src}\`
}
export function buildOneLinkHref(base, attribution) {
  const params = new URLSearchParams({ pid: attribution.pid, c: attribution.campaign })
  return \`\${base}?\${params.toString()}\`
}
`;
  if (runSrc(goodSrc).length !== 0) selfFailures.push("compliant links-src wrongly flagged: " + JSON.stringify(runSrc(goodSrc)));

  const goodPage = `
import { sanitizeLinksSrc } from '@/lib/links-src'
export default async function LinksPage({ searchParams }) {
  const { src } = await searchParams
  return <LinksExperience tagline={LINKS_TAGLINE} src={sanitizeLinksSrc(src)} />
}
`;
  if (runPage(goodPage).length !== 0) selfFailures.push("compliant page wrongly flagged: " + JSON.stringify(runPage(goodPage)));

  const goodSurface = `
import { BUSINESS_ONELINK_URL } from '@/lib/store-links'
const cta = (<a href={target.installHref} target="_blank" rel="noopener">Get the app</a>)
`;
  if (runSurface(goodSurface).length !== 0) selfFailures.push("compliant surface wrongly flagged: " + JSON.stringify(runSurface(goodSurface)));

  // R1/R2 — the bases SWAPPED (the silent cross-app bug).
  const swapped = `
export const EXPLORER_ONELINK_URL = 'https://biz.usemingla.com/ZSCW'
export const BUSINESS_ONELINK_URL = 'https://go.usemingla.com/w36m'
`;
  if (runStore(swapped).length === 0) selfFailures.push("R1/R2: swapped OneLink bases not flagged");

  // R2 — the business base pointing at the RAW onelink.me domain.
  const rawBiz = goodStore.replace("https://biz.usemingla.com/ZSCW", "https://minglabiz.onelink.me/ZSCW");
  if (runStore(rawBiz).length === 0) selfFailures.push("R2: raw minglabiz.onelink.me business base not flagged");

  // R1/R2 — domain/template MISMATCH (biz domain + consumer template). ORCH-1346:
  // one branded domain = one template, so this resolves to the WRONG app while
  // looking entirely plausible.
  const mismatched = goodStore.replace("https://biz.usemingla.com/ZSCW", "https://biz.usemingla.com/w36m");
  if (runStore(mismatched).length === 0) selfFailures.push("R1/R2: business domain + CONSUMER template mismatch not flagged");

  // R3 — the prefix emptied (pid=youtube → collides with the SRN namespace).
  const noPrefix = goodSrc.replace("export const LINKS_PID_PREFIX = 'bio_'", "export const LINKS_PID_PREFIX = ''");
  if (runSrc(noPrefix).length === 0) selfFailures.push("R3: LINKS_PID_PREFIX emptied not flagged");

  // R4 ⭐ — the regex UNANCHORED. The defect a token check can never see.
  const unanchored = goodSrc.replace("/^[a-z0-9_]{1,32}$/", "/[a-z0-9_]{1,32}/");
  if (runSrc(unanchored).length === 0) selfFailures.push("R4: UNANCHORED sanitisation regex not flagged (the tooth is dead)");

  // R4 — half-anchored (start only) must ALSO fire.
  const halfAnchored = goodSrc.replace("/^[a-z0-9_]{1,32}$/", "/^[a-z0-9_]{1,32}/");
  if (runSrc(halfAnchored).length === 0) selfFailures.push("R4: HALF-anchored (^ only) regex not flagged");

  // R5 ⭐ — toBioPid returning a bare interpolation.
  const bareInterp = goodSrc.replace("return `${LINKS_PID_PREFIX}${src}`", "return `${src}`");
  if (runSrc(bareInterp).length === 0) selfFailures.push("R5: toBioPid bare `${src}` interpolation not flagged (the tooth is dead)");

  // R5b — the builder hand-concatenating.
  const concat = goodSrc.replace(
    "  const params = new URLSearchParams({ pid: attribution.pid, c: attribution.campaign })\n  return `${base}?${params.toString()}`",
    "  return `${base}?pid=${attribution.pid}&c=${attribution.campaign}`",
  );
  if (runSrc(concat).length === 0) selfFailures.push("R5b: manual query concat (no URLSearchParams) not flagged");

  // R5c — the fail-safe emptied (→ the meaningless pid "bio_").
  const emptyFallback = goodSrc.replace("export const LINKS_SRC_FALLBACK = 'direct'", "export const LINKS_SRC_FALLBACK = ''");
  if (runSrc(emptyFallback).length === 0) selfFailures.push("R5c: empty LINKS_SRC_FALLBACK not flagged");

  // R7 — the page passing searchParams straight through.
  const rawPage = `
export default async function LinksPage({ searchParams }) {
  const { src } = await searchParams
  return <LinksExperience tagline={LINKS_TAGLINE} src={src} />
}
`;
  if (runPage(rawPage).length === 0) selfFailures.push("R7: page passing raw searchParams.src not flagged");

  // R6 — a surface hardcoding a branded-domain literal.
  const literalSurface = goodSurface + "\nconst u = 'https://go.usemingla.com/w36m?pid=bio_x'\n";
  if (runSurface(literalSurface).length === 0) selfFailures.push("R6: surface hardcoding a go.usemingla.com literal not flagged");

  // R6 — a surface using a raw onelink.me domain.
  const rawSurface = goodSurface + "\nconst u = 'https://minglabiz.onelink.me/ZSCW'\n";
  if (runSurface(rawSurface).length === 0) selfFailures.push("R6: surface using a raw *.onelink.me domain not flagged");

  // Banned tokens inside COMMENTS are stripped → compliant still passes.
  const commented = goodSurface +
    "\n// never hardcode https://go.usemingla.com/w36m or https://biz.usemingla.com/ZSCW here\n" +
    "/* the raw minglabiz.onelink.me domain is banned on routing policy */\n";
  if (runSurface(commented).length !== 0) {
    selfFailures.push("commented banned tokens wrongly flagged (comment-strip broken): " + JSON.stringify(runSurface(commented)));
  }
  const commentedSrc = goodSrc + "\n// pid must never be bare 'bio_' or an unanchored /[a-z0-9_]{1,32}/ match\n";
  if (runSrc(commentedSrc).length !== 0) {
    selfFailures.push("commented tokens in links-src wrongly flagged: " + JSON.stringify(runSrc(commentedSrc)));
  }

  if (selfFailures.length) {
    console.error("ORCH-1399 links-src-onelink-attribution self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1399 links-src-onelink-attribution self-test PASS (18/18 cases, incl. the R4 unanchored-regex + R5 bare-interpolation teeth).");
  process.exit(0);
}

// ---- Live mode
const failures = [];

const read = (rel) => {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    console.error(`ORCH-1399 FAIL — target not found at ${rel} (gate path out of sync).`);
    process.exit(1);
  }
  return fs.readFileSync(abs, "utf8");
};

checkStoreLinks(read(STORE_LINKS), failures);
checkLinksSrc(read(LINKS_SRC), failures);
checkLinksPage(read(LINKS_PAGE), failures);
for (const rel of SURFACES) checkSurface(rel, read(rel), failures);

if (failures.length > 0) {
  console.error(
    "ORCH-1399 (I-PROPOSED-1399-LINKS-SRC-BIO-PID-NEVER-CROSSED) FAIL — every OneLink emitted\n" +
      "by mingla-marketing must carry a pid matching /^bio_[a-z0-9_]{1,32}$/ (bio surfaces) or a\n" +
      "non-reserved owned-media pid (site surfaces); `src` must be sanitised against an ANCHORED\n" +
      "charset and fail safe to bio_direct — never empty, never reflected; and the Explorer\n" +
      "(go.usemingla.com/w36m) and Business (biz.usemingla.com/ZSCW) bases must NEVER be crossed\n" +
      "nor be a raw *.onelink.me domain.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1399 PASS — the OneLink bases are correctly owned and never crossed (go.*/w36m =\n" +
    "consumer, biz.*/ZSCW = business, no raw *.onelink.me, no surface literals); links-src.ts\n" +
    "sanitises `src` against an ANCHORED charset with a non-empty fail-safe, composes the query\n" +
    "with URLSearchParams, and roots every pid at LINKS_PID_PREFIX via the single writer\n" +
    "toBioPid; and /links sanitises searchParams.src at the boundary.",
);
