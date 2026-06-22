#!/usr/bin/env node
/**
 * ORCH-1225 [careers pill + footer link] — TESTER ADVERSARIAL RUNTIME GATE.
 *
 * Different angle than the implementor's source-grep gate
 * (i-proposed-1225-careers-links.mjs): that one reads the .tsx SOURCE. This one
 * asserts the RENDERED DOM of the built marketing site against a running
 * `next start`, so it would catch a regression that source-grep cannot —
 * e.g. a careers chip whose href is correct in source but rewritten/stripped
 * at render, a duplicate anchor, the explorer footer leaking back on, or the
 * apex `/careers` route accidentally serving a real 200 careers page (the
 * single load-bearing correctness fact: a relative `/careers` from the apex
 * MUST NOT resolve to a careers page — it 404s behind the META-ORCH-1222
 * middleware apex guard, which is exactly why both links MUST be absolute).
 *
 * Assertions (against http://localhost:${PORT}, default 3457):
 *   1. GET /          renders EXACTLY ONE  <a href="https://career.usemingla.com">Career</a>
 *   2. GET /          renders NO relative   href="/careers"  anchor
 *   3. GET /          renders NO <footer>   (explorer is footer-less, ORCH-1224)
 *   4. GET /business  renders EXACTLY ONE  <a href="https://career.usemingla.com">Careers</a> inside <footer>
 *   5. GET /business  renders NO relative   href="/careers"  anchor
 *   6. apex GET /careers (no career. host)  is NOT a 200 careers page (404 / not-found)
 *   7. subdomain GET /careers (Host: career.usemingla.com) IS a 200 careers page
 *      (proves the apex 404 in #6 is the guard, not a build break)
 *
 * Usage:
 *   node orch-1225-careers-runtime-dom.test.mjs            # live, needs server on $PORT
 *   node orch-1225-careers-runtime-dom.test.mjs --self-test # pure-string fixtures, no server
 *
 * Exit 0 = PASS, 1 = FAIL. Fails-on-revert is proven against the SAME running
 * server by reverting the fix commit and re-running (see TEST report).
 */

const PORT = process.env.ORCH1225_PORT || "3457";
const BASE = `http://localhost:${PORT}`;
const CAREERS_URL = "https://career.usemingla.com";

// --- pure DOM assertions over an HTML string (shared by live + self-test) ---

/** Count distinct <a ...> elements whose href is the absolute careers URL and
 *  whose visible text matches `label` exactly. RSC flight-payload copies of the
 *  same href (which are NOT <a ...> tags) are ignored by the anchor-tag regex. */
const countCareersAnchors = (html, label) => {
  const re = new RegExp(
    `<a\\b[^>]*\\bhref="${CAREERS_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>\\s*${label}\\s*</a>`,
    "g",
  );
  const m = html.match(re);
  return m ? m.length : 0;
};

/** Any relative `/careers` anchor (the broken form that would 404 on the apex). */
const hasRelativeCareersAnchor = (html) =>
  /<a\b[^>]*\bhref="\/careers"/.test(html);

const hasFooter = (html) => /<footer\b/.test(html);

/** Extract the <footer>…</footer> slice (best-effort). */
const footerSlice = (html) => {
  const m = html.match(/<footer\b[\s\S]*?<\/footer>/);
  return m ? m[0] : "";
};

const assertHomeHtml = (html, failures) => {
  const n = countCareersAnchors(html, "Career");
  if (n !== 1)
    failures.push(`/ : expected EXACTLY ONE "Career" anchor at ${CAREERS_URL}, found ${n}.`);
  if (hasRelativeCareersAnchor(html))
    failures.push(`/ : found a relative href="/careers" anchor (would 404 on apex).`);
  if (hasFooter(html))
    failures.push(`/ : explorer must have NO <footer> (ORCH-1224) — one was rendered.`);
};

const assertBusinessHtml = (html, failures) => {
  const n = countCareersAnchors(html, "Careers");
  if (n !== 1)
    failures.push(`/business : expected EXACTLY ONE "Careers" anchor at ${CAREERS_URL}, found ${n}.`);
  if (hasRelativeCareersAnchor(html))
    failures.push(`/business : found a relative href="/careers" anchor (would 404 on apex).`);
  const foot = footerSlice(html);
  if (!foot) {
    failures.push(`/business : expected a <footer> — none found.`);
  } else if (countCareersAnchors(foot, "Careers") !== 1) {
    failures.push(`/business : the "Careers" anchor must live INSIDE <footer>.`);
  }
};

// --- self-test fixtures -----------------------------------------------------

const SELF_TEST = process.argv.includes("--self-test");
if (SELF_TEST) {
  const GOOD_HOME = `<nav><a href="/business">Business</a><a href="${CAREERS_URL}">Career</a><button>Support</button></nav>`;
  const GOOD_BIZ = `<main></main><footer><h3>Company</h3><a href="${CAREERS_URL}">Careers</a><a href="/privacy-policy">Privacy</a></footer>`;

  const BAD_HOME_RELATIVE = `<nav><a href="/careers">Career</a></nav>`;
  const BAD_HOME_MISSING = `<nav><button>Support</button></nav>`;
  const BAD_HOME_FOOTER = `<nav><a href="${CAREERS_URL}">Career</a></nav><footer>oops</footer>`;
  const BAD_HOME_DUP = `<nav><a href="${CAREERS_URL}">Career</a><a href="${CAREERS_URL}">Career</a></nav>`;
  const BAD_BIZ_RELATIVE = `<footer><a href="/careers">Careers</a></footer>`;
  const BAD_BIZ_MISSING = `<footer><a href="/privacy-policy">Privacy</a></footer>`;
  const BAD_BIZ_OUTSIDE = `<a href="${CAREERS_URL}">Careers</a><footer><a href="/privacy-policy">Privacy</a></footer>`;

  const run = (fn, html) => { const f = []; fn(html, f); return f; };

  const checks = [
    ["GOOD_HOME passes", run(assertHomeHtml, GOOD_HOME).length === 0],
    ["GOOD_BIZ passes", run(assertBusinessHtml, GOOD_BIZ).length === 0],
    ["BAD_HOME_RELATIVE fails", run(assertHomeHtml, BAD_HOME_RELATIVE).length >= 1],
    ["BAD_HOME_MISSING fails", run(assertHomeHtml, BAD_HOME_MISSING).length >= 1],
    ["BAD_HOME_FOOTER fails", run(assertHomeHtml, BAD_HOME_FOOTER).length >= 1],
    ["BAD_HOME_DUP fails", run(assertHomeHtml, BAD_HOME_DUP).length >= 1],
    ["BAD_BIZ_RELATIVE fails", run(assertBusinessHtml, BAD_BIZ_RELATIVE).length >= 1],
    ["BAD_BIZ_MISSING fails", run(assertBusinessHtml, BAD_BIZ_MISSING).length >= 1],
    ["BAD_BIZ_OUTSIDE fails", run(assertBusinessHtml, BAD_BIZ_OUTSIDE).length >= 1],
  ];
  const bad = checks.filter(([, ok]) => !ok);
  if (bad.length) {
    console.error("ORCH-1225 runtime-DOM SELF-TEST failed:", bad.map(([n]) => n));
    process.exit(1);
  }
  console.log("ORCH-1225 runtime-DOM gate self-test passed (9 fixtures).");
  process.exit(0);
}

// --- live mode --------------------------------------------------------------

import http from "node:http";

/**
 * Raw HTTP GET. We deliberately use node:http (NOT global fetch): `Host` is a
 * forbidden request header for fetch() and is silently dropped, which would
 * make the subdomain probe wrongly hit the apex. node:http honours an explicit
 * Host header, which is exactly what the middleware (req.headers.get('host'))
 * inspects to decide apex-vs-subdomain.
 */
const fetchText = (path, headers = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: "localhost", port: Number(PORT), path, method: "GET", headers },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });

const main = async () => {
  const failures = [];

  const home = await fetchText("/");
  if (home.status !== 200) failures.push(`/ returned ${home.status} (expected 200).`);
  assertHomeHtml(home.body, failures);

  const biz = await fetchText("/business");
  if (biz.status !== 200) failures.push(`/business returned ${biz.status} (expected 200).`);
  assertBusinessHtml(biz.body, failures);

  // load-bearing: apex /careers must NOT serve a real 200 careers page.
  const apexCareers = await fetchText("/careers");
  if (apexCareers.status === 200 && !/not.?found|careers-not-found/i.test(apexCareers.body)) {
    failures.push(
      `apex GET /careers returned a 200 careers page — the apex guard is GONE; ` +
        `a relative /careers link would now (wrongly) resolve, undermining the absolute-URL contract.`,
    );
  }

  // sanity: the careers page IS reachable on the subdomain host (proves the
  // apex 404 above is the guard, not a build break).
  const subCareers = await fetchText("/careers", { Host: "career.usemingla.com" });
  if (subCareers.status !== 200) {
    failures.push(
      `GET /careers with Host: career.usemingla.com returned ${subCareers.status} (expected 200) — ` +
        `the careers subdomain itself is broken.`,
    );
  }

  if (failures.length) {
    console.error("ORCH-1225 careers runtime-DOM gate FAILED:");
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
  }
  console.log("ORCH-1225 careers runtime-DOM gate PASSED (live DOM + apex-guard).");
  process.exit(0);
};

main().catch((e) => {
  console.error("ORCH-1225 runtime-DOM gate ERROR (is the server up on " + BASE + "?):", e.message);
  process.exit(2);
});
