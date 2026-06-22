#!/usr/bin/env node
/**
 * META-ORCH-1222 [Careers site] — TESTER ADVERSARIAL GUARD.
 * I-PROPOSED-1222-CAREERS-ROUTES-ROUTABLE  (different angle than the
 * implementor happy-path edge-fn test AND the 6 implementor gates).
 *
 * WHY THIS EXISTS (the P0 this guards):
 *   The careers public site is served by a host-based middleware rewrite that
 *   sends `career.usemingla.com/<x>` to an INTERNAL Next.js segment. For the
 *   site to render at all, that segment MUST be a REAL, ROUTABLE App-Router
 *   segment. In Next.js App Router, a folder whose name STARTS WITH AN
 *   UNDERSCORE (`_careers`) is a "private folder" — Next.js DELIBERATELY
 *   EXCLUDES it from routing and does NOT compile its page.tsx into a route.
 *   The QA live-fire build proved that with `app/_careers/**`, `next build`
 *   emits ZERO careers routes (app-paths-manifest has no careers entry) and the
 *   production server returns 404 for `career.usemingla.com/` and every JD/apply
 *   URL — the ENTIRE public site is dead. Renaming the segment to a
 *   non-underscore folder (e.g. `app/careers/**`) makes Next compile
 *   `/careers`, `/careers/roles/[slug]`, `/careers/roles/[slug]/apply`.
 *
 * ASSERTS (mingla-marketing):
 *   (1) The careers route folder under app/ is ROUTABLE: it exists, it is NOT
 *       underscore-prefixed (private folder), and it is NOT a bare parenthesized
 *       route group serving "/" (which would collide with (explorer)/page.tsx).
 *   (2) It carries the three required entry points: <seg>/page.tsx,
 *       <seg>/roles/[slug]/page.tsx, <seg>/roles/[slug]/apply/page.tsx.
 *   (3) middleware.ts rewrites the `career.` host to a prefix that MATCHES the
 *       on-disk routable segment (the rewrite target is reachable).
 *
 * `--self-test` proves FAIL-on-revert: simulating the regression (the careers
 * segment renamed back to an underscore-private folder, or the three pages
 * missing, or the middleware target diverging from the on-disk segment) MUST
 * make the assertion FAIL; the fixed shape MUST PASS.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const APP_DIR = path.join(root, "mingla-marketing/app");
const MIDDLEWARE = path.join(root, "mingla-marketing/middleware.ts");

/**
 * Find the careers route segment under app/.
 * Returns { segment, dir } for the directory that contains a careers page +
 * a roles/[slug] subtree, or null if none found.
 */
function findCareersSegment(appDir) {
  if (!fs.existsSync(appDir)) return null;
  for (const entry of fs.readdirSync(appDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    // A careers segment is identified by containing roles/[slug]/page.tsx +
    // a page.tsx at its root (the index). We look at every top-level app child.
    const dir = path.join(appDir, name);
    const hasIndex = fs.existsSync(path.join(dir, "page.tsx"));
    const hasRoleJd = fs.existsSync(
      path.join(dir, "roles", "[slug]", "page.tsx"),
    );
    const looksCareers = /careers/i.test(name);
    if (looksCareers && (hasIndex || hasRoleJd)) {
      return { segment: name, dir };
    }
  }
  return null;
}

/**
 * Core check. `opts` lets --self-test inject simulated regressions without
 * touching disk. Returns an array of failure strings (empty = PASS).
 */
function check(opts = {}) {
  const failures = [];

  // Allow self-test to override the discovered segment + middleware src.
  const seg = opts.overrideSegment !== undefined
    ? opts.overrideSegment
    : (findCareersSegment(APP_DIR)?.segment ?? null);

  const dir = opts.overrideDir !== undefined
    ? opts.overrideDir
    : (seg ? path.join(APP_DIR, seg) : null);

  const pagesExist = opts.overridePagesExist !== undefined
    ? opts.overridePagesExist
    : (dir
      ? [
        path.join(dir, "page.tsx"),
        path.join(dir, "roles", "[slug]", "page.tsx"),
        path.join(dir, "roles", "[slug]", "apply", "page.tsx"),
      ].every((p) => fs.existsSync(p))
      : false);

  const mwSrc = opts.overrideMiddleware !== undefined
    ? opts.overrideMiddleware
    : (fs.existsSync(MIDDLEWARE) ? fs.readFileSync(MIDDLEWARE, "utf8") : "");

  // (0) The segment must be discoverable at all.
  if (!seg) {
    failures.push(
      "no careers route segment found under mingla-marketing/app/ — the public " +
        "careers site has no routable entry point.",
    );
    return failures; // nothing else is checkable
  }

  // (1a) NOT an underscore-prefixed private folder (the P0).
  if (seg.startsWith("_")) {
    failures.push(
      `careers route segment "app/${seg}/" is an underscore-prefixed PRIVATE ` +
        "folder — Next.js App Router excludes it from routing, so every careers " +
        "URL 404s. Rename to a non-underscore segment (e.g. app/careers/).",
    );
  }

  // (1b) NOT a bare parenthesized route group serving "/" (collides with the
  //      existing (explorer)/page.tsx at the apex root).
  if (seg.startsWith("(") && seg.endsWith(")")) {
    failures.push(
      `careers route segment "app/${seg}/" is a parenthesized route group, which ` +
        "adds no URL segment — its page.tsx would serve `/` and collide with the " +
        "existing (explorer) root route. Use a real named segment instead.",
    );
  }

  // (2) The three required entry points exist.
  if (!pagesExist) {
    failures.push(
      `careers segment "app/${seg}/" is missing one of the required routable ` +
        "pages: page.tsx, roles/[slug]/page.tsx, roles/[slug]/apply/page.tsx.",
    );
  }

  // (3) The middleware rewrite target matches the on-disk routable segment.
  //     We look for `/<seg>` (the rewrite prefix) appearing in middleware.ts.
  //     If the middleware rewrites to a DIFFERENT prefix than the on-disk
  //     segment, the rewrite lands on a non-existent route → 404.
  if (mwSrc) {
    const targetRe = new RegExp(
      "['\"`]/" + seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    if (!targetRe.test(mwSrc)) {
      failures.push(
        `middleware.ts does not rewrite the career. host to "/${seg}" — the ` +
          "rewrite target must match the on-disk routable segment, or every " +
          "careers URL lands on a non-existent route (404).",
      );
    }
  } else {
    failures.push("mingla-marketing/middleware.ts is missing or empty.");
  }

  return failures;
}

function runRealFile() {
  const failures = check();
  if (failures.length > 0) {
    console.error(
      "ORCH-1222 I-PROPOSED-1222-CAREERS-ROUTES-ROUTABLE FAIL:\n  - " +
        failures.join("\n  - "),
    );
    process.exit(1);
  }
  console.log(
    "ORCH-1222 I-PROPOSED-1222-CAREERS-ROUTES-ROUTABLE PASS — careers segment is " +
      "a routable (non-underscore, non-group) Next.js segment with all three " +
      "pages, and middleware rewrites to it.",
  );
}

function runSelfTest() {
  let allOk = true;
  const cases = [
    {
      name: "FIXED shape (non-underscore segment, 3 pages, matching middleware) → PASS",
      opts: {
        overrideSegment: "careers",
        overrideDir: "/nonexistent",
        overridePagesExist: true,
        overrideMiddleware:
          "const P='/careers'; if(host.startsWith('career.')) rewrite('/careers'+pathname)",
      },
      expectFail: false,
    },
    {
      name: "REGRESSION: underscore-private segment `_careers` → FAIL",
      opts: {
        overrideSegment: "_careers",
        overrideDir: "/nonexistent",
        overridePagesExist: true,
        overrideMiddleware:
          "const P='/_careers'; if(host.startsWith('career.')) rewrite('/_careers'+pathname)",
      },
      expectFail: true,
    },
    {
      name: "REGRESSION: parenthesized route group `(careers)` → FAIL",
      opts: {
        overrideSegment: "(careers)",
        overrideDir: "/nonexistent",
        overridePagesExist: true,
        overrideMiddleware: "rewrite('/(careers)'+pathname)",
      },
      expectFail: true,
    },
    {
      name: "REGRESSION: missing one of the three pages → FAIL",
      opts: {
        overrideSegment: "careers",
        overrideDir: "/nonexistent",
        overridePagesExist: false,
        overrideMiddleware: "rewrite('/careers'+pathname)",
      },
      expectFail: true,
    },
    {
      name: "REGRESSION: middleware target diverges from on-disk segment → FAIL",
      opts: {
        overrideSegment: "careers",
        overrideDir: "/nonexistent",
        overridePagesExist: true,
        overrideMiddleware:
          "rewrite('/_careers'+pathname) // stale target after rename",
      },
      expectFail: true,
    },
  ];

  for (const c of cases) {
    const failures = check(c.opts);
    const didFail = failures.length > 0;
    const ok = didFail === c.expectFail;
    if (!ok) allOk = false;
    console.log(
      `[${ok ? "OK" : "BAD"}] ${c.name}${
        didFail ? " :: " + failures[0] : ""
      }`,
    );
  }

  if (!allOk) {
    console.error(
      "ORCH-1222 careers-routes-routable self-test FAILED (a case did not behave as expected).",
    );
    process.exit(1);
  }
  console.log(
    `ORCH-1222 careers-routes-routable self-test PASS (${cases.length}/${cases.length} cases).`,
  );
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  runRealFile();
}
