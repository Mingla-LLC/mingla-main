#!/usr/bin/env node
/**
 * META-ORCH-1222 [Careers site] — I-PROPOSED-1222-CAREERS-SUBDOMAIN-ISOLATED.
 *
 * WHY: career.usemingla.com is served from the SAME Vercel project as
 * usemingla.com via a host-based middleware rewrite. The middleware MUST only
 * rewrite the `career.` host into the `/careers` segment AND guard the
 * apex against `/careers` (so usemingla.com is provably untouched + the
 * careers segment is not crawlable from the apex). Removing the host check or
 * the apex guard would either break isolation or leak careers onto the apex.
 *
 * ASSERTS (mingla-marketing/middleware.ts):
 *   (1) it reads the request host and gates on a `career.` host.
 *   (2) it references the `/careers` prefix (the rewrite target).
 *   (3) it has an apex guard: a NON-careers host hitting `/careers` is blocked
 *       (rewrite away / notFound) rather than served.
 *
 * `--self-test` proves FAIL-on-revert (host check removed / apex guard removed).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const MIDDLEWARE = path.join(root, "mingla-marketing/middleware.ts");

function check(src, failures) {
  const readsHost = /headers\.get\(\s*['"]host['"]\s*\)/i.test(src) ||
    /req\.headers\.get\(['"]host['"]\)/i.test(src);
  const gatesCareerHost = /career\./.test(src);
  if (!readsHost || !gatesCareerHost) {
    failures.push(
      "middleware does not read the host AND gate on a `career.` host (subdomain " +
        "isolation requires a host check).",
    );
  }
  if (!/['"`]\/careers['"`]/.test(src) && !/CAREERS_PREFIX\s*=\s*['"`]\/careers['"`]/.test(src)) {
    failures.push("middleware does not reference the `/careers` segment.");
  }
  // Apex guard: there must be a branch handling a NON-career host that touches
  // /careers (a guard rewriting it away / to a not-found). We detect a guard
  // by the presence of BOTH a `/careers` pathname test (directly or via the
  // CAREERS_PREFIX constant) and a non-`next()` response on that branch.
  const hasApexPathTest = /(pathname[\s\S]{0,40}(CAREERS_PREFIX|['"`]\/careers)|startsWith\(\s*[^)]*(CAREERS_PREFIX|['"`]\/careers))/i.test(src);
  const hasGuardRewrite = /(not[-_]?found|notFound|rewrite)/i.test(src);
  if (!hasApexPathTest || !hasGuardRewrite) {
    failures.push(
      "middleware lacks an apex guard for `/careers` (a non-career host hitting " +
        "/careers must be blocked, not served).",
    );
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const good = `
    const CAREERS_PREFIX = '/careers';
    const host = req.headers.get('host');
    if (host && host.startsWith('career.')) {
      return NextResponse.rewrite(url); // -> /careers
    }
    if (pathname.startsWith('/careers')) {
      return NextResponse.rewrite(notFoundUrl); // apex guard -> not-found
    }
    return NextResponse.next();
  `;
  let f = [];
  check(good, f);
  if (f.length) self.push("good middleware wrongly flagged: " + f.join("; "));

  // Remove the host check → MUST fire.
  const badNoHost = `
    const CAREERS_PREFIX = '/careers';
    if (pathname.startsWith('/careers')) { return NextResponse.rewrite(notFoundUrl); }
    return NextResponse.next();
  `;
  f = [];
  check(badNoHost, f);
  if (f.length === 0) self.push("missing career-host check not flagged");

  // Remove the apex guard → MUST fire.
  const badNoGuard = `
    const host = req.headers.get('host');
    if (host && host.startsWith('career.')) { return NextResponse.next(); }
  `;
  f = [];
  check(badNoGuard, f);
  if (f.length === 0) self.push("missing apex guard not flagged");

  if (self.length) {
    console.error("ORCH-1222 careers-host-isolated self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1222 careers-host-isolated self-test PASS (3/3 cases).");
  process.exit(0);
}

if (!fs.existsSync(MIDDLEWARE)) {
  console.error(`ORCH-1222 gate FAIL — middleware.ts not found at ${MIDDLEWARE}.`);
  process.exit(1);
}
const failures = [];
check(fs.readFileSync(MIDDLEWARE, "utf8"), failures);
if (failures.length > 0) {
  console.error(
    "ORCH-1222 I-PROPOSED-1222-CAREERS-SUBDOMAIN-ISOLATED FAIL:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1222 I-PROPOSED-1222-CAREERS-SUBDOMAIN-ISOLATED PASS — host-gated rewrite " +
    "+ apex guard present.",
);
