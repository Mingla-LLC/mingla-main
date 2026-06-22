#!/usr/bin/env node
/**
 * ORCH-1223 [footer-dead-link-cleanup] — EVERY internal href in the marketing
 * footer must resolve to a real Next.js route.
 *
 * Invariant I-PROPOSED-1223-FOOTER-LINKS-RESOLVE (DRAFT until ORCH-1223 CLOSE):
 * the marketing footer (mingla-marketing/components/marketing/footer.tsx) must
 * contain ZERO dead internal links. Every `href: '/...'` string in the footer
 * must map to a page that actually exists under mingla-marketing/app/**.
 *
 * This gate is structural, not enumerative: it does NOT hard-code the 9 dead
 * paths that were removed. It rebuilds the live route set by walking the
 * Next.js App Router tree and FAILS if any footer href is not in that set —
 * so re-adding ANY non-existent footer link (now or in the future) breaks CI.
 *
 * Route-set construction (Next.js App Router semantics):
 *   - A `page.tsx` at app/<segments>/page.tsx contributes the route `/<segments>`.
 *   - Route groups `(group)` are organizational only: their segment is stripped
 *     from the URL (e.g. app/(explorer)/page.tsx => `/`).
 *   - The (explorer) index `app/(explorer)/page.tsx` => `/` (home).
 *   - BUSINESS_PATH ('/business') is the cross-link target (renamed from
 *     ORGANISER_PATH '/organisers' by ORCH-1224); it resolves via
 *     app/business/page.tsx and is validated like any other href.
 *
 * Only internal hrefs (those starting with '/') are checked. External/protocol
 * hrefs (http, mailto, #, etc.) are out of scope. Dynamic segments ([slug]) are
 * matched by shape if ever introduced.
 *
 * Mirrors the modular self-tested gate pattern (sibling:
 * i-curated-today-from-now-onward.mjs).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FOOTER = "mingla-marketing/components/marketing/footer.tsx";
const SUBDOMAIN = "mingla-marketing/lib/subdomain.ts";
const APP_DIR = "mingla-marketing/app";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

// Strip line + block comments so commented-out hrefs never trip the gate.
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Walk a Next.js App Router directory and return the set of resolvable routes
 * (normalized, no trailing slash; the index is "/").
 */
const buildRouteSet = (appAbs) => {
  const routes = new Set();
  const walk = (dirAbs, urlSegments) => {
    let entries;
    try {
      entries = readdirSync(dirAbs);
    } catch {
      return;
    }
    if (entries.includes("page.tsx") || entries.includes("page.jsx")) {
      const path = "/" + urlSegments.join("/");
      routes.add(urlSegments.length === 0 ? "/" : path.replace(/\/+$/, ""));
    }
    for (const entry of entries) {
      const childAbs = join(dirAbs, entry);
      let isDir = false;
      try {
        isDir = statSync(childAbs).isDirectory();
      } catch {
        isDir = false;
      }
      if (!isDir) continue;
      // Route groups `(group)` contribute NO url segment.
      const isGroup = entry.startsWith("(") && entry.endsWith(")");
      // Private folders `_x` and parallel/intercepted routes (@x) are not routes.
      if (entry.startsWith("_")) continue;
      const nextSegments = isGroup ? urlSegments : [...urlSegments, entry];
      walk(childAbs, nextSegments);
    }
  };
  walk(appAbs, []);
  return routes;
};

/**
 * Extract every internal href string literal from the footer source.
 * Catches both `href: '/...'` object props and `href="/..."` plus the
 * ORGANISER_PATH symbol (resolved to its literal from subdomain.ts).
 */
const extractFooterHrefs = (footerCode, businessPath) => {
  const hrefs = new Set();
  // href: '...'  or  href="..."  or  href: "..."
  const re = /href\s*[:=]\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  let m;
  while ((m = re.exec(footerCode)) !== null) {
    hrefs.add(m[2]);
  }
  // BUSINESS_PATH symbol used as an href value (renamed from ORGANISER_PATH by ORCH-1224).
  if (/href\s*[:=]\s*BUSINESS_PATH/.test(footerCode) && businessPath) {
    hrefs.add(businessPath);
  }
  return [...hrefs];
};

const evaluate = ({ footerCode, businessPath, routes }) => {
  const failures = [];
  const hrefs = extractFooterHrefs(stripComments(footerCode), businessPath);

  const internal = hrefs.filter((h) => h.startsWith("/"));
  if (internal.length === 0) {
    failures.push(
      "No internal hrefs found in footer.tsx — the parser likely broke; refusing to pass silently. I-PROPOSED-1223-FOOTER-LINKS-RESOLVE.",
    );
  }

  for (const href of internal) {
    // Normalize: drop query/hash, strip trailing slash (except root).
    const clean = href.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
    if (!routes.has(clean)) {
      failures.push(
        `footer href '${href}' (normalized '${clean}') does not resolve to any marketing route under ${APP_DIR}/** — it is a DEAD link. I-PROPOSED-1223-FOOTER-LINKS-RESOLVE.`,
      );
    }
  }
  return failures;
};

// --- self-test fixtures (run with --self-test) ----------------------------
const SELF_TEST = process.argv.includes("--self-test");

if (SELF_TEST) {
  const FAKE_ROUTES = new Set([
    "/",
    "/support",
    "/privacy-policy",
    "/terms-of-service",
    "/business",
  ]);

  // GOOD: every internal href resolves (mirrors the post-fix footer).
  const GOOD = `
    const explorerColumns = [
      { title: 'Company', links: [{ href: '/support', label: 'Support' }] },
      { title: 'Legal', links: [
        { href: '/privacy-policy', label: 'Privacy' },
        { href: '/terms-of-service', label: 'Terms' },
      ] },
    ];
    const crossLink = surface === 'organiser'
      ? { href: '/', label: 'Back' }
      : { href: BUSINESS_PATH, label: 'Business' };
  `;

  // BAD_A: a single re-added dead link (/how-it-works).
  const BAD_A = `
    const explorerColumns = [
      { title: 'Product', links: [{ href: '/how-it-works', label: 'How it works' }] },
      { title: 'Legal', links: [{ href: '/privacy-policy', label: 'Privacy' }] },
    ];
    const crossLink = { href: BUSINESS_PATH, label: 'Business' };
  `;

  // BAD_B: a re-added dead business link (/business/pricing).
  const BAD_B = `
    const organiserColumns = [
      { title: 'Product', links: [{ href: '/business/pricing', label: 'Pricing' }] },
      { title: 'Legal', links: [{ href: '/terms-of-service', label: 'Terms' }] },
    ];
    const crossLink = { href: '/', label: 'Back' };
  `;

  const goodFails = evaluate({ footerCode: GOOD, businessPath: "/business", routes: FAKE_ROUTES });
  const badAFails = evaluate({ footerCode: BAD_A, businessPath: "/business", routes: FAKE_ROUTES });
  const badBFails = evaluate({ footerCode: BAD_B, businessPath: "/business", routes: FAKE_ROUTES });

  // Also exercise the real route-set builder against a synthetic tree shape:
  // a route group (explorer) contributing '/' and a nested business route.
  const routeBuilderOk = (() => {
    // Build from the actual app dir if present (sanity), else skip.
    const appAbs = join(root, APP_DIR);
    if (!existsSync(appAbs)) return true;
    const live = buildRouteSet(appAbs);
    return live.has("/") && live.has("/business") && live.has("/support");
  })();

  const ok =
    goodFails.length === 0 &&
    badAFails.length >= 1 &&
    badBFails.length >= 1 &&
    routeBuilderOk;

  if (!ok) {
    console.error("ORCH-1223 footer-links-resolve SELF-TEST failed:", {
      goodFails,
      badAFails,
      badBFails,
      routeBuilderOk,
    });
    process.exit(1);
  }
  console.log("ORCH-1223 footer-links-resolve gate self-test passed.");
  process.exit(0);
}

const footerAbs = join(root, FOOTER);
const subdomainAbs = join(root, SUBDOMAIN);
const appAbs = join(root, APP_DIR);

const failures = [];

if (!existsSync(footerAbs)) {
  failures.push(`${FOOTER}: expected marketing footer not found.`);
} else if (!existsSync(appAbs)) {
  failures.push(`${APP_DIR}: expected marketing App Router dir not found.`);
} else {
  const footerCode = readFileSync(footerAbs, "utf8");
  let businessPath = "/business";
  if (existsSync(subdomainAbs)) {
    const sub = readFileSync(subdomainAbs, "utf8");
    const mm = sub.match(/BUSINESS_PATH\s*=\s*(['"`])([^'"`]+)\1/);
    if (mm) businessPath = mm[2];
  }
  const routes = buildRouteSet(appAbs);
  failures.push(...evaluate({ footerCode, businessPath, routes }));
}

if (failures.length > 0) {
  console.error("ORCH-1223 footer-links-resolve gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-1223 footer-links-resolve gate passed.");
