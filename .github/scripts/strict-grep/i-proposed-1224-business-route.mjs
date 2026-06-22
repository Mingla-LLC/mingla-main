#!/usr/bin/env node
/**
 * ORCH-1224 [business route rename] — the marketing business surface moved
 * /organisers → /business (Seth 2026-06-22). This gate locks the rename:
 *
 * Invariant I-PROPOSED-1224-BUSINESS-ROUTE (DRAFT until ORCH-1224 CLOSE):
 *   (a) NO `/organisers` HREF survives in mingla-marketing component/lib source.
 *       Every navigable link (Link href, anchor href, SITE_CHIPS/SEGMENTS entry,
 *       BUSINESS_PATH constant, surface-detection `pathname.startsWith('/...')`)
 *       must point at /business. The ONLY tolerated `/organisers` strings are:
 *         - inside the redirect rule + comments in next.config.ts, and
 *         - bare historical code comments (comment-stripped before matching).
 *   (b) the PERMANENT /organisers → /business redirect EXISTS in next.config.ts
 *       (both the bare path and the `/organisers/:path*` sub-path form), so
 *       existing links / the business app / campaigns keep resolving.
 *
 * Scope: mingla-marketing/{components,lib} *.ts/*.tsx (the navigable source),
 * comment-stripped so a historical `// ... /organisers ...` note never trips it.
 * next.config.ts is intentionally EXCLUDED from the (a) scan (it OWNS the
 * redirect string) and is the sole target of the (b) check.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const MARKETING = "mingla-marketing";
const SCAN_DIRS = ["components", "lib", "app"];
const NEXT_CONFIG = join(MARKETING, "next.config.ts");

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// Match a navigable /organisers reference: `'/organisers'`, `"/organisers"`,
// `/organisers/...`, or `startsWith('/organisers')`. We match the literal path
// token bounded by a quote or `/` so `/organisers-foo` won't false-positive but
// `/organisers` and `/organisers/case-studies/x` both trip.
const ORGANISERS_HREF_RE = /\/organisers(?=['"`/])/;

const walk = (dir, acc) => {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      walk(abs, acc);
    } else if ([".ts", ".tsx"].includes(extname(entry))) {
      acc.push(abs);
    }
  }
  return acc;
};

const scanSourceForOrganisersHref = (absDirRoot) => {
  const failures = [];
  for (const sub of SCAN_DIRS) {
    const dir = join(absDirRoot, sub);
    if (!existsSync(dir)) continue;
    for (const file of walk(dir, [])) {
      const src = stripComments(readFileSync(file, "utf8"));
      if (ORGANISERS_HREF_RE.test(src)) {
        failures.push(
          `${file.slice(absDirRoot.length - MARKETING.length)}: a navigable \`/organisers\` href survived — must point at /business (ORCH-1224). I-PROPOSED-1224-BUSINESS-ROUTE.`,
        );
      }
    }
  }
  return failures;
};

// (b) the redirect must exist in next.config.ts. Require BOTH the bare path and
// the sub-path form, both mapping to /business, and `permanent: true`.
const checkRedirect = (configSrc) => {
  const failures = [];
  const src = stripComments(configSrc);
  const hasRedirectsBlock = /async\s+redirects\s*\(/.test(src) || /\bredirects\s*[:(]/.test(src);
  if (!hasRedirectsBlock) {
    failures.push("next.config.ts: missing an `async redirects()` block — ORCH-1224 needs the /organisers → /business 301. I-PROPOSED-1224-BUSINESS-ROUTE.");
  }
  // bare: source '/organisers' -> destination '/business', permanent
  const bareRe = /source:\s*(['"`])\/organisers\1[\s\S]{0,80}?destination:\s*(['"`])\/business\2[\s\S]{0,80}?permanent:\s*true/;
  if (!bareRe.test(src)) {
    failures.push("next.config.ts: missing the PERMANENT `/organisers` → `/business` redirect rule. I-PROPOSED-1224-BUSINESS-ROUTE.");
  }
  // sub-path: '/organisers/:path*' -> '/business/:path*', permanent
  const subRe = /source:\s*(['"`])\/organisers\/:path\*\1[\s\S]{0,80}?destination:\s*(['"`])\/business\/:path\*\2[\s\S]{0,80}?permanent:\s*true/;
  if (!subRe.test(src)) {
    failures.push("next.config.ts: missing the PERMANENT `/organisers/:path*` → `/business/:path*` sub-path redirect. I-PROPOSED-1224-BUSINESS-ROUTE.");
  }
  return failures;
};

// --- self-test ------------------------------------------------------------
const SELF_TEST = process.argv.includes("--self-test");

if (SELF_TEST) {
  // (a) source scan
  const GOOD_SOURCE = `
    const SEGMENTS = [{ surface: 'organiser', label: 'Business', href: '/business' }]
    const active = pathname.startsWith('/business') ? 'organiser' : 'explorer'
    // historical: this used to live at /organisers (comment only — tolerated)
  `;
  const BAD_HREF = `const x = [{ href: '/organisers', label: 'Organiser' }]`;
  const BAD_STARTSWITH = `const a = pathname.startsWith('/organisers') ? 'organiser' : 'explorer'`;
  const BAD_SUBPATH = `const c = { href: '/organisers/case-studies/x' }`;
  const COMMENT_ONLY = `// see the /organisers premium redesign\nconst y = '/business'`;

  const scanStr = (s) => (ORGANISERS_HREF_RE.test(stripComments(s)) ? ["hit"] : []);

  // (b) redirect check
  const GOOD_CONFIG = `
    const config = {
      async redirects() {
        return [
          { source: '/organisers', destination: '/business', permanent: true },
          { source: '/organisers/:path*', destination: '/business/:path*', permanent: true },
        ]
      },
    }
  `;
  const BAD_NO_REDIRECTS = `const config = { async headers() { return [] } }`;
  const BAD_TEMP = `const config = { async redirects() { return [{ source: '/organisers', destination: '/business', permanent: false }] } }`;
  const BAD_NO_SUBPATH = `const config = { async redirects() { return [{ source: '/organisers', destination: '/business', permanent: true }] } }`;

  const ok =
    scanStr(GOOD_SOURCE).length === 0 &&
    scanStr(COMMENT_ONLY).length === 0 &&
    scanStr(BAD_HREF).length >= 1 &&
    scanStr(BAD_STARTSWITH).length >= 1 &&
    scanStr(BAD_SUBPATH).length >= 1 &&
    checkRedirect(GOOD_CONFIG).length === 0 &&
    checkRedirect(BAD_NO_REDIRECTS).length >= 1 &&
    checkRedirect(BAD_TEMP).length >= 1 &&
    checkRedirect(BAD_NO_SUBPATH).length >= 1;

  if (!ok) {
    console.error("ORCH-1224 business-route SELF-TEST failed:", {
      goodSource: scanStr(GOOD_SOURCE),
      commentOnly: scanStr(COMMENT_ONLY),
      badHref: scanStr(BAD_HREF),
      badStartsWith: scanStr(BAD_STARTSWITH),
      badSubpath: scanStr(BAD_SUBPATH),
      goodConfig: checkRedirect(GOOD_CONFIG),
      badNoRedirects: checkRedirect(BAD_NO_REDIRECTS),
      badTemp: checkRedirect(BAD_TEMP),
      badNoSubpath: checkRedirect(BAD_NO_SUBPATH),
    });
    process.exit(1);
  }
  console.log("ORCH-1224 business-route gate self-test passed.");
  process.exit(0);
}

const failures = [];

const marketingAbs = join(root, MARKETING);
if (!existsSync(marketingAbs)) {
  failures.push(`${MARKETING}: marketing app not found — cannot verify the /organisers → /business rename.`);
} else {
  failures.push(...scanSourceForOrganisersHref(marketingAbs));
}

const configAbs = join(root, NEXT_CONFIG);
if (!existsSync(configAbs)) {
  failures.push(`${NEXT_CONFIG}: next.config.ts not found — cannot verify the /organisers → /business redirect.`);
} else {
  failures.push(...checkRedirect(readFileSync(configAbs, "utf8")));
}

if (failures.length > 0) {
  console.error("ORCH-1224 business-route gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-1224 business-route gate passed.");
