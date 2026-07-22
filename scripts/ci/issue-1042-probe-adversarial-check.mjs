#!/usr/bin/env node
/**
 * #1042 [android-signing-fingerprint-audit] — TESTER ADVERSARIAL regression check.
 *
 * ── A DIFFERENT ANGLE FROM THE IMPLEMENTOR'S GATE, ON PURPOSE ───────────────────
 *
 * `issue-1042-assetlinks-parity-check.mjs` (the implementor's gate) attacks the REPO:
 * it proves our two `assetlinks.json` copies agree with each other and that no
 * fingerprint was deleted. Every one of its assertions is about files in this tree.
 *
 * This check attacks the PROBE. `scripts/probe-android-applinks.mjs` is the only
 * thing in this repository that can detect a #1038-class drift, because it is the
 * only thing that asks an authority outside the repo. A probe that cannot FAIL is
 * strictly worse than no probe: it converts "we are not looking" into "we looked and
 * it was fine". So the question this file answers is not "is the repo consistent" but:
 *
 *     Does the probe actually go red when the outside world is wrong, and green only
 *     when it is right — and can it be made to pass VACUOUSLY?
 *
 * It answers that by running the real, unmodified probe against a synthetic repo
 * fixture with `globalThis.fetch` stubbed to a scripted hostile resolver. No network
 * call is made, so the check is deterministic and safe to run in CI.
 *
 * ── WHY VACUITY IS THE THREAT MODEL ────────────────────────────────────────────
 * The realistic ways a health probe rots into decoration are all "passes when it
 * should not": an empty statement list read as success; a failed fetch swallowed; a
 * body with no `statements` key; a subset / no-certificate drift read as health.
 * Each of those is a scenario below, and each must produce a NON-zero exit.
 *
 * #1050 — the KNOWN_FAILURES-suppression scenarios (S9/S10/S13, which policed a
 * suppression that quietly widens, or that keeps firing after the world is fixed) are
 * RETIRED: #1050 emptied KNOWN_FAILURES entirely (the Business app stopped declaring
 * `go.`, so the F-4 go.×business suppression is gone). If a suppression is ever added
 * back, restore those scenarios alongside it.
 *
 * Usage:  node scripts/ci/issue-1042-probe-adversarial-check.mjs
 * Exit:   0 = the probe behaved correctly in every scenario · 1 = it did not.
 * CI:     .github/workflows/issue-1042-assetlinks-tests.yml
 * Docs:   docs/runbooks/ANDROID_SIGNING_AND_DEEP_LINK_REGISTRY.md
 *
 * FAILS-ON-REVERT: deleting the `if (pairs.length === 0) throw` guard or the
 * `obs.error !== null` branch in `scripts/probe-android-applinks.mjs` turns S1/S5
 * red. Verified by hand. (#1050 retired the KNOWN_FAILURES-suppression scenarios
 * S9/S10/S13 — the suppression list is now empty.)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const PROBE_REL = "scripts/probe-android-applinks.mjs";

const CONSUMER_PKG = "com.mingla.app.v2";
const BUSINESS_PKG = "com.sethogieva.minglabusiness";

/** Read the REAL fingerprint sets so this check tracks the files, never a copy. */
function realFingerprints(rel) {
  const map = new Map();
  for (const e of JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"))) {
    map.set(e.target.package_name, e.target.sha256_cert_fingerprints);
  }
  return map;
}

const MARKETING_REL = "mingla-marketing/public/.well-known/assetlinks.json";
const BUSINESS_REL = "mingla-business/public/.well-known/assetlinks.json";

/** Build a throwaway repo the probe can be pointed at. */
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue-1042-probe-"));
  for (const sub of ["scripts", "app-mobile", "mingla-business/public/.well-known", "mingla-marketing/public/.well-known"]) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  // The probe under test is copied BYTE-FOR-BYTE. Nothing about it is stubbed.
  fs.copyFileSync(path.join(REPO_ROOT, PROBE_REL), path.join(dir, PROBE_REL));
  fs.copyFileSync(path.join(REPO_ROOT, MARKETING_REL), path.join(dir, MARKETING_REL));
  fs.copyFileSync(path.join(REPO_ROOT, BUSINESS_REL), path.join(dir, BUSINESS_REL));

  const filters = (pkg, hosts) => ({
    expo: {
      android: {
        package: pkg,
        intentFilters: hosts.map((h) => ({
          action: "VIEW",
          autoVerify: true,
          data: [{ scheme: "https", host: h }],
          category: ["BROWSABLE", "DEFAULT"],
        })),
      },
    },
  });
  fs.writeFileSync(
    path.join(dir, "app-mobile/app.json"),
    JSON.stringify(filters(CONSUMER_PKG, ["usemingla.com", "business.usemingla.com", "go.usemingla.com"]), null, 2),
  );
  fs.writeFileSync(
    path.join(dir, "mingla-business/app.json"),
    // #1050 — the Business app now declares its OWN vouching branded domain
    // `biz.usemingla.com`, not the consumer domain `go.usemingla.com`.
    JSON.stringify(filters(BUSINESS_PKG, ["business.usemingla.com", "biz.usemingla.com"]), null, 2),
  );
  return dir;
}

/**
 * The runner is written into the fixture next to the probe so that the probe's own
 * `REPO_ROOT = resolve(HERE, "..")` lands on the fixture. It stubs fetch, collapses
 * the backoff sleeps (retry COUNT is untouched), then imports the probe.
 */
const RUNNER = String.raw`
const scenario = process.argv[2];
const _st = globalThis.setTimeout;
globalThis.setTimeout = (fn) => _st(fn, 0);

const MKT = ${JSON.stringify("__MKT__")};
const BIZ = ${JSON.stringify("__BIZ__")};
const FIX = JSON.parse(process.env.ISSUE_1042_FIXTURE_SETS);
const CONSUMER_PKG = ${JSON.stringify(CONSUMER_PKG)};
const BUSINESS_PKG = ${JSON.stringify(BUSINESS_PKG)};

const stmt = (pkg, fp) => ({
  source: { web: { site: "https://fixture/" } },
  relation: "delegate_permission/common.handle_all_urls",
  target: { androidApp: { packageName: pkg, certificate: { sha256Fingerprint: fp } } },
});
const consumer = () => FIX.consumer.map((fp) => stmt(CONSUMER_PKG, fp));
const business = () => FIX.business.map((fp) => stmt(BUSINESS_PKG, fp));

// The world exactly as it must look AFTER this PR deploys.
// #1050 — the branded OneLink domain is now per-app: biz. vouches for business,
// go. vouches for consumer. Both are healthy; there is no suppressed pair left.
const HEALTHY = {
  "usemingla.com": consumer(),
  "www.usemingla.com": consumer(),
  "business.usemingla.com": [...business(), ...consumer()],
  "biz.usemingla.com": business(), // #1050 — business now declares biz.; biz. vouches for the business pkg
  "go.usemingla.com": consumer(), // #1050 — go. is consumer-only now; it vouches for the consumer pkg
};

const ok = (obj) => ({ ok: true, status: 200, json: async () => obj });
let n = 0;

function respond(host) {
  n++;
  switch (scenario) {
    case "S0-healthy":            return ok({ statements: HEALTHY[host] ?? [] });
    case "S1-empty-list":         return ok({ statements: [] });
    case "S2-no-statements-key":  return ok({ maxAge: "3600s" });
    case "S3-wrong-package":      return ok({ statements: [stmt("com.someone.else", FIX.consumer[0])] });
    case "S4-subset":
      if (host === "go.usemingla.com") return ok({ statements: HEALTHY[host] });
      return ok({ statements: (HEALTHY[host] ?? []).filter((s) => s.target.androidApp.certificate.sha256Fingerprint !== FIX.consumer[1]) });
    case "S5-http-404":           return { ok: false, status: 404, json: async () => ({}) };
    case "S6-malformed-json":     return { ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected end of JSON input"); } };
    case "S7-timeout":            return Promise.reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
    case "S8-resolver-errorcode": return ok({ errorCode: ["ERROR_CODE_FETCH_ERROR"], statements: [] });
    // #1050 — S9/S10/S13 retired: they existed solely to police the F-4
    // KNOWN_FAILURES suppression, which #1050 emptied (the Business app no longer
    // declares go., so there is no suppressed go.×business pair to abuse or fix).
    case "S11-lowercase-live":
      return ok({ statements: (HEALTHY[host] ?? []).map((s) => ({ ...s, target: { androidApp: { packageName: s.target.androidApp.packageName, certificate: { sha256Fingerprint: s.target.androidApp.certificate.sha256Fingerprint.toLowerCase() } } } })) });
    case "S12-no-certificate":
      return ok({ statements: (HEALTHY[host] ?? []).map((s) => ({ ...s, target: { androidApp: { packageName: s.target.androidApp.packageName } } })) });
    default: throw new Error("unknown scenario " + scenario);
  }
}

globalThis.fetch = async (url) => {
  const site = decodeURIComponent(new URL(url).searchParams.get("source.web.site") || "");
  return respond(site.replace(/^https?:\/\//, "").replace(/\/$/, ""));
};

await import("./probe-android-applinks.mjs");
`;

/**
 * Each row: what the outside world looks like, and what the probe MUST do about it.
 * `exit` is the contract; `expect` / `forbid` are substrings of the probe's output.
 */
const SCENARIOS = [
  // #1050 — S0 no longer expects a "KNOWN-FAIL" line: the go.×business
  // suppression is gone, so the steady state is fully GREEN with no suppressed
  // pair. S9/S10/S13 are retired (they only policed that now-empty suppression).
  { id: "S0-healthy", why: "post-deploy steady state — the daily schedule must be born GREEN, no suppression", exit: 0, expect: ["ALL DECLARED APP LINKS HOSTS HEALTHY"], forbid: ["KNOWN-FAIL"] },
  { id: "S1-empty-list", why: "HTTP 200 with an EMPTY statement list must never read as success", exit: 1, expect: ["NO_STATEMENT"] },
  { id: "S2-no-statements-key", why: "a body with no `statements` key at all must not pass vacuously", exit: 1, expect: ["NO_STATEMENT"] },
  { id: "S3-wrong-package", why: "a host vouching for SOMEBODY ELSE'S package is not a pass", exit: 1, expect: ["NO_STATEMENT"] },
  { id: "S4-subset", why: "the drift case — host serves a SUBSET of what the repo declares", exit: 1, expect: ["DRIFT"] },
  { id: "S5-http-404", why: "a failed fetch must fail the run, never be swallowed", exit: 1, expect: ["RESOLVER_ERROR"] },
  { id: "S6-malformed-json", why: "a truncated/malformed resolver body must fail the run", exit: 1, expect: ["RESOLVER_ERROR"] },
  { id: "S7-timeout", why: "a network timeout on all attempts must fail the run", exit: 1, expect: ["RESOLVER_ERROR"] },
  { id: "S8-resolver-errorcode", why: "an errorCode alongside HTTP 200 must fail the run", exit: 1, expect: ["RESOLVER_ERROR"] },
  { id: "S11-lowercase-live", why: "case-insensitive comparison — lowercase live fingerprints are still a match", exit: 0, expect: ["ALL DECLARED APP LINKS HOSTS HEALTHY"] },
  { id: "S12-no-certificate", why: "a statement naming the package but carrying no certificate is drift, not health", exit: 1, expect: ["DRIFT"] },
];

// ── run ────────────────────────────────────────────────────────────────────────

const fixture = makeFixture();
const sets = {
  consumer: realFingerprints(MARKETING_REL).get(CONSUMER_PKG),
  business: realFingerprints(BUSINESS_REL).get(BUSINESS_PKG),
};
if (!sets.consumer?.length || !sets.business?.length) {
  console.error("SETUP FAIL — could not read the real fingerprint sets; refusing to run vacuously.");
  process.exit(1);
}
fs.writeFileSync(path.join(fixture, "scripts/runner.mjs"), RUNNER);

console.log("#1042 TESTER adversarial probe check — hostile resolver responses, no network.\n");
console.log(`  probe under test : ${PROBE_REL} (byte-copy)`);
console.log(`  fixture          : ${fixture}`);
console.log(`  consumer set     : ${sets.consumer.length} fingerprint(s) read from ${MARKETING_REL}\n`);

const failures = [];
for (const s of SCENARIOS) {
  const res = spawnSync(process.execPath, [path.join(fixture, "scripts/runner.mjs"), s.id], {
    encoding: "utf8",
    env: { ...process.env, ISSUE_1042_FIXTURE_SETS: JSON.stringify(sets) },
    timeout: 120000,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const code = res.status;
  const problems = [];
  if (code !== s.exit) problems.push(`expected exit ${s.exit}, got ${code}`);
  for (const want of s.expect ?? []) if (!out.includes(want)) problems.push(`output missing ${JSON.stringify(want)}`);
  for (const nope of s.forbid ?? []) if (out.includes(nope)) problems.push(`output must NOT contain ${JSON.stringify(nope)}`);

  if (problems.length) {
    failures.push({ s, problems, out });
    console.log(`  FAIL  ${s.id.padEnd(30)} ${s.why}`);
  } else {
    console.log(`  ok    ${s.id.padEnd(30)} exit ${code} — ${s.why}`);
  }
}

fs.rmSync(fixture, { recursive: true, force: true });

if (failures.length) {
  console.error(`\n#1042 PROBE ADVERSARIAL CHECK FAIL — ${failures.length} scenario(s):\n`);
  for (const f of failures) {
    console.error(`### ${f.s.id} — ${f.s.why}`);
    for (const p of f.problems) console.error(`  - ${p}`);
    console.error(`  --- probe output ---\n${f.out.split("\n").map((l) => `  | ${l}`).join("\n")}\n`);
  }
  console.error(
    "A probe that cannot fail is worse than no probe: it converts 'we are not looking' into\n" +
      "'we looked and it was fine'. See docs/runbooks/ANDROID_SIGNING_AND_DEEP_LINK_REGISTRY.md.",
  );
  process.exit(1);
}

console.log(
  `\nPASS — the probe went red in every scenario where the outside world was wrong, green only\n` +
    `where it was right, and refused to pass on an empty or failed resolver response. (#1050\n` +
    `emptied KNOWN_FAILURES, so the suppression-abuse scenarios S9/S10/S13 were retired.)`,
);
process.exit(0);
