/**
 * ISSUE-1322 [admin Sentry] — TESTER adversarial regression suite.
 *
 * DIFFERENT ANGLE from the implementor's happy-path (issue1322_admin_sentry.test.js,
 * which exercises the RUNTIME shim: initSentry/captureException delegation + the
 * main.jsx / ErrorBoundary source wiring). THIS suite attacks the BUILD-TIME
 * GUARD — `scripts/ci/require-sentry-dsn-on-prod.mjs` — the thing that stops a
 * keyless production bundle from silently shipping crash reporting DARK.
 *
 * It SPAWNS the real guard as a subprocess (node:child_process) across the full
 * env matrix and asserts BOTH the exit code AND the channel/content of the
 * message. The guard's contract is a two-condition AND:
 *   isProd = (VERCEL === "1") && (VERCEL_ENV === "production")
 *   fail (exit 1, FATAL on STDERR) ONLY when isProd AND the DSN is absent/blank.
 *
 * Cases:
 *   G-1  VERCEL=1 VERCEL_ENV=production, no DSN            -> exit 1, FATAL on stderr
 *   G-2  VERCEL=1 VERCEL_ENV=production, +DSN              -> exit 0, "present" on stdout, NO FATAL
 *   G-3  VERCEL=1 VERCEL_ENV=preview,    no DSN            -> exit 0, warn, NO FATAL
 *   G-4  no VERCEL at all,               no DSN            -> exit 0, warn, NO FATAL
 *   G-5  VERCEL=1 VERCEL_ENV=production, whitespace DSN    -> exit 1, FATAL (trim() => blank == absent)
 *   G-6  VERCEL unset, VERCEL_ENV=production, no DSN       -> exit 0 (AND-gate: needs VERCEL==="1" too)
 *   G-7  VERCEL=1 VERCEL_ENV=production, +DSN, blank overrides never: DSN wins over prod-gate
 *
 * Why these catch a PLAUSIBLE WRONG guard:
 *   - A guard that "passes when the DSN is absent" (e.g. always exit 0) FAILS G-1 and G-5.
 *   - A guard that does NOT gate on VERCEL_ENV==="production" (e.g. isProd = VERCEL==="1")
 *     FAILS G-3 (it would abort a legitimate preview build).
 *   - A guard that gates on VERCEL_ENV alone (ignoring the VERCEL flag) FAILS G-6.
 *   - A guard that prints FATAL to stdout / exits 0 FAILS G-1's channel+code assertions.
 *
 * Fails-on-revert (tester's angle): making the guard unconditionally exit 0
 * breaks G-1/G-5; dropping the VERCEL_ENV clause breaks G-3; dropping the VERCEL
 * clause breaks G-6. (Captured in the QA report by mutating the real guard.)
 *
 * Append-only: NEW file; does not modify or weaken the implementor's suite.
 * Pure Node build-config test — no Vite, no @sentry/react import, no MANIFEST.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// test: mingla-admin/src/__tests__/  ->  guard: mingla-admin/scripts/ci/
const GUARD = path.resolve(__dirname, "../../scripts/ci/require-sentry-dsn-on-prod.mjs");

const VALID_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0";
const FATAL_RE = /FATAL: VITE_SENTRY_DSN is absent on a Vercel PRODUCTION build/;

/**
 * Run the real guard with a FULLY ISOLATED env (we do NOT spread process.env, so
 * an ambient VITE_SENTRY_DSN/VERCEL on the host machine can never leak in and
 * make a "no DSN" case vacuously pass). node is found via the absolute execPath,
 * so an empty PATH is fine.
 */
function runGuard(env) {
  return spawnSync(process.execPath, [GUARD], {
    env: { ...env },
    encoding: "utf8",
  });
}

describe("ISSUE-1322 admin Sentry — TESTER adversarial (build-time DSN guard)", () => {
  it("precondition: the guard file exists at the vercel.json buildCommand path", () => {
    assert.ok(fs.existsSync(GUARD), `guard must exist at ${GUARD}`);
  });

  it("G-1 keyless Vercel PRODUCTION build FAILS LOUD — exit 1, FATAL on STDERR", () => {
    const r = runGuard({ VERCEL: "1", VERCEL_ENV: "production" });
    assert.equal(r.status, 1, "keyless prod build must exit 1 (block the build)");
    assert.match(r.stderr, FATAL_RE, "FATAL diagnostic must be on stderr");
    assert.doesNotMatch(
      r.stdout,
      FATAL_RE,
      "FATAL must NOT be whispered to stdout (a build log may swallow stdout success lines)",
    );
  });

  it("G-2 PRODUCTION build WITH a DSN passes — exit 0, no FATAL, DSN wins over the prod gate", () => {
    const r = runGuard({ VERCEL: "1", VERCEL_ENV: "production", VITE_SENTRY_DSN: VALID_DSN });
    assert.equal(r.status, 0, "prod build with a DSN must exit 0");
    assert.doesNotMatch(r.stderr, FATAL_RE, "no FATAL when the DSN is present");
    assert.match(r.stdout, /present/i, "logs that the DSN is present / will ship live");
  });

  it("G-3 PREVIEW build without a DSN is ALLOWED — exit 0, warn, NO FATAL (VERCEL_ENV gate honored)", () => {
    const r = runGuard({ VERCEL: "1", VERCEL_ENV: "preview" });
    assert.equal(r.status, 0, "a preview build must NOT be blocked (only production is gated)");
    assert.doesNotMatch(r.stderr, FATAL_RE, "preview must never emit the production FATAL");
    assert.match(`${r.stdout}${r.stderr}`, /absent — allowed/i, "warns that the no-op is allowed");
  });

  it("G-4 non-Vercel (local/CI) build without a DSN is ALLOWED — exit 0, warn, NO FATAL", () => {
    const r = runGuard({});
    assert.equal(r.status, 0, "a non-Vercel build must never be blocked");
    assert.doesNotMatch(r.stderr, FATAL_RE, "local build must never emit the production FATAL");
  });

  it("G-5 EDGE: whitespace-only DSN on a PRODUCTION build is treated as absent — exit 1, FATAL", () => {
    // The guard .trim()s the DSN, so "   " is equivalent to unset. A guard that
    // only checked truthiness (no trim) would let a blank DSN ship dark.
    const r = runGuard({ VERCEL: "1", VERCEL_ENV: "production", VITE_SENTRY_DSN: "   " });
    assert.equal(r.status, 1, "whitespace-only DSN must fail a prod build exactly like an absent one");
    assert.match(r.stderr, FATAL_RE, "FATAL on stderr for the blank-DSN prod build");
  });

  it("G-6 AND-gate: VERCEL_ENV=production WITHOUT VERCEL=1 is NOT a prod build — exit 0", () => {
    // Locks the two-condition AND. A guard that gated on VERCEL_ENV alone would
    // wrongly abort this exit 1.
    const r = runGuard({ VERCEL_ENV: "production" });
    assert.equal(r.status, 0, "must require BOTH VERCEL==='1' AND VERCEL_ENV==='production'");
    assert.doesNotMatch(r.stderr, FATAL_RE, "no FATAL without the VERCEL=1 flag");
  });

  it("G-7 AND-gate: VERCEL=1 WITHOUT VERCEL_ENV=production is NOT a prod build — exit 0", () => {
    // The mirror of G-6 — VERCEL flag set but env is not 'production'.
    const r = runGuard({ VERCEL: "1" });
    assert.equal(r.status, 0, "VERCEL=1 alone (no VERCEL_ENV=production) must not block");
    assert.doesNotMatch(r.stderr, FATAL_RE, "no FATAL without VERCEL_ENV==='production'");
  });
});
