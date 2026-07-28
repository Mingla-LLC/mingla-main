/**
 * ISSUE-1322 [admin Sentry] — happy-path regression test for mingla-admin crash
 * reporting (implementor-owned; the tester owns the adversarial suite — a
 * different angle: it attacks the build-time DSN guard as a spawned subprocess).
 *
 * Proves (against src/diagnostics/sentry.js + the entry/boundary wiring):
 *   T-1  initSentry delegates to the injected sdk when a DSN is present —
 *        sdk.init called ONCE with the dsn + environment; a second call is an
 *        idempotent no-op (the `started` guard).
 *   T-2  no-DSN init is a safe no-op — sdk.init is NEVER called, returns false,
 *        no throw (dev / preview without a DSN behaves exactly as before #1322).
 *   T-3  captureException returns "" before any successful init, and delegates
 *        to sdk.captureException after init.
 *   T-4  the entry (main.jsx) imports + calls initSentry with
 *        import.meta.env.VITE_SENTRY_DSN and the admin-* environment scheme
 *        BEFORE createRoot; ErrorBoundary.componentDidCatch forwards to
 *        captureException with a react.componentStack context.
 *
 * Fails-on-revert: deleting the initSentry(...) call from main.jsx (T-4),
 * reverting componentDidCatch to console.error-only (T-4), or making initSentry
 * call sdk.init without a DSN (T-2) all break this suite.
 *
 * Each state-sensitive case imports a FRESH module instance (?fresh=N) so the
 * module-level `started` singleton resets between cases.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SENTRY_SPEC = "../diagnostics/sentry.js";

let freshCounter = 0;
async function freshSentry() {
  // A distinct query string yields a fresh ESM module instance in Node, so the
  // module-level `started` flag resets — lets us test pre-init and post-init
  // states independently.
  return import(`${SENTRY_SPEC}?fresh=${freshCounter++}`);
}

function makeFakeSdk() {
  const calls = { init: [], capture: [] };
  return {
    calls,
    init(opts) {
      calls.init.push(opts);
    },
    captureException(err, ctx) {
      calls.capture.push([err, ctx]);
      return `evt_${calls.capture.length}`;
    },
  };
}

const VALID_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0";

describe("ISSUE-1322 admin Sentry — runtime shim", () => {
  it("T-1 initSentry delegates to the sdk with dsn + environment; second call is a no-op", async () => {
    const { initSentry } = await freshSentry();
    const sdk = makeFakeSdk();

    const ret = initSentry({ dsn: VALID_DSN, environment: "admin-production" }, sdk);
    assert.equal(ret, true, "first init with a DSN returns true");
    assert.equal(sdk.calls.init.length, 1, "sdk.init called exactly once");
    assert.equal(sdk.calls.init[0].dsn, VALID_DSN, "dsn forwarded verbatim");
    assert.equal(sdk.calls.init[0].environment, "admin-production", "environment forwarded");
    assert.equal(sdk.calls.init[0].tracesSampleRate, 0, "tracing off in v1");

    // Idempotent — the `started` guard prevents a second init.
    const ret2 = initSentry({ dsn: "https://other@o9.ingest.sentry.io/9" }, sdk);
    assert.equal(ret2, false, "second init returns false");
    assert.equal(sdk.calls.init.length, 1, "sdk.init not called again");
  });

  it("T-1b initSentry defaults environment to admin-production when omitted, and trims the DSN", async () => {
    const { initSentry } = await freshSentry();
    const sdk = makeFakeSdk();

    const ret = initSentry({ dsn: `  ${VALID_DSN}  ` }, sdk);
    assert.equal(ret, true);
    assert.equal(sdk.calls.init[0].environment, "admin-production", "defaults to admin-production");
    assert.equal(sdk.calls.init[0].dsn, VALID_DSN, "surrounding whitespace trimmed");
  });

  it("T-2 no-DSN init is a safe no-op — sdk.init never called", async () => {
    const { initSentry } = await freshSentry();
    const sdk = makeFakeSdk();

    assert.equal(initSentry({ dsn: "" }, sdk), false, "empty string DSN => no-op");
    assert.equal(initSentry({}, sdk), false, "missing dsn key => no-op");
    assert.equal(initSentry({ dsn: undefined }, sdk), false, "undefined DSN => no-op");
    assert.equal(initSentry({ dsn: "   " }, sdk), false, "whitespace-only DSN => no-op");
    assert.equal(initSentry(undefined, sdk), false, "no options at all => no-op (no throw)");
    assert.equal(sdk.calls.init.length, 0, "sdk.init NEVER called without a DSN");
  });

  it("T-3 captureException returns '' before init, delegates to sdk after init", async () => {
    const { initSentry, captureException } = await freshSentry();
    const sdk = makeFakeSdk();

    // Before init: no-op, empty event id, no delegation.
    assert.equal(captureException(new Error("pre-init"), undefined, sdk), "", "empty id before init");
    assert.equal(sdk.calls.capture.length, 0, "no delegation before init");

    initSentry({ dsn: VALID_DSN, environment: "admin-production" }, sdk);

    const ctx = { contexts: { react: { componentStack: "\n  at Thing" } } };
    const id = captureException(new Error("post-init"), ctx, sdk);
    assert.equal(sdk.calls.capture.length, 1, "delegates to sdk after init");
    assert.deepEqual(sdk.calls.capture[0][1], ctx, "context forwarded verbatim");
    assert.equal(id, "evt_1", "returns the sdk event id");
  });

  it("T-4 main.jsx + ErrorBoundary.jsx are wired to the shim (source proof)", () => {
    const mainSrc = fs.readFileSync(path.join(__dirname, "../main.jsx"), "utf8");

    assert.match(
      mainSrc,
      /import\s*\{\s*initSentry\s*\}\s*from\s*["']\.\/diagnostics\/sentry["']/,
      "main.jsx imports initSentry from ./diagnostics/sentry",
    );
    assert.match(
      mainSrc,
      /initSentry\(\s*\{[\s\S]*?dsn:\s*import\.meta\.env\.VITE_SENTRY_DSN/,
      "main.jsx calls initSentry reading import.meta.env.VITE_SENTRY_DSN",
    );
    assert.match(mainSrc, /["']admin-production["']/, "prod environment tag is admin-production");
    assert.match(
      mainSrc,
      /admin-\$\{import\.meta\.env\.MODE\}/,
      "non-prod environment tag is admin-<mode>",
    );

    const initIdx = mainSrc.indexOf("initSentry(");
    const rootIdx = mainSrc.indexOf("createRoot(");
    assert.ok(initIdx !== -1, "initSentry is called in main.jsx");
    assert.ok(rootIdx !== -1, "createRoot is present in main.jsx");
    assert.ok(initIdx < rootIdx, "initSentry runs BEFORE createRoot (render)");

    const ebSrc = fs.readFileSync(path.join(__dirname, "../components/ErrorBoundary.jsx"), "utf8");

    assert.match(
      ebSrc,
      /import\s*\{\s*captureException\s*\}\s*from\s*["']\.\.\/diagnostics\/sentry["']/,
      "ErrorBoundary imports captureException from ../diagnostics/sentry",
    );
    assert.match(
      ebSrc,
      /componentDidCatch\s*\([\s\S]*?captureException\(/,
      "componentDidCatch forwards to captureException",
    );
    assert.match(ebSrc, /componentStack/, "componentStack context is passed to Sentry");
  });
});
