/**
 * #890 ADVERSARIAL (tester) — SSR / static-export no-window invariant + runtime
 * DSN gating for the web Sentry shim (`src/diagnostics/sentry.ts`).
 *
 * DIFFERENT ANGLE from the implementor happy-path
 * (`sentry.web.issue890.test.ts`, which stubs `window` true + a present DSN and
 * asserts the SDK IS loaded and `captureException` returns the event id). This
 * suite attacks the OPPOSITE, load-bearing invariants — the exact ORCH-0886
 * regression #890 guards:
 *
 *   1. Importing `sentry.ts` while `window` is undefined (the Expo Router
 *      static-export pass runs in Node, no `window`) must NOT throw at
 *      module-load, and must NOT evaluate `@sentry/browser`.
 *   2. `init({dsn})` with NO window is a safe no-op — the SDK is never loaded.
 *   3. `init({})` with a window but NO DSN loads no SDK; `captureException`
 *      returns "" (matches the native graceful-uninit contract).
 *   4. `captureException` before any successful init returns "" and never throws.
 *
 * How this fails against a WRONG fix (the whole point of the different angle):
 * the `@sentry/browser` mock factory THROWS a `window is not defined`
 * ReferenceError if it is EVER evaluated while `window` is undefined — a faithful
 * simulation of the real ORCH-0886 export crash (`@sentry/browser`'s deep
 * integrations touch `window` at module-load). With the correct LAZY fix the
 * factory is only reachable AFTER a `typeof window` guard + a present DSN, so it
 * never runs in these no-window / no-DSN cases and the suite is GREEN. A naive
 * module-top `import ... from "@sentry/browser"` (the wrong fix that re-breaks the
 * export) evaluates the factory during `sentry.ts` module-load while `window` is
 * undefined → this whole suite goes RED. A wrong fix that drops the DSN guard
 * makes case 3 call the mock → RED. (Reverting to the no-op stub is the
 * implementor happy-path's job, not this one — this suite guards the export.)
 *
 * Runs under the repo DEFAULT node/ts-jest config (no jsdom dep, per the #890
 * build contract — the package-lock diff stays the single @sentry/browser
 * promotion). `window` starts undefined (node env); each case sets/clears it.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { init, captureException } from "../sentry";

const mockInit = jest.fn();
const mockCaptureException = jest.fn((): string => "evt_adv");
const mockAddBreadcrumb = jest.fn();

jest.mock("@sentry/browser", () => {
  // Faithful ORCH-0886 simulation: the real @sentry/browser module body touches
  // `window` at module-load. If this factory is ever evaluated with no window,
  // that reproduces the export crash — turning any static-import wrong fix RED.
  if (typeof (globalThis as any).window === "undefined") {
    throw new ReferenceError(
      "window is not defined (@sentry/browser evaluated in Node with no window — ORCH-0886 regression)",
    );
  }
  return {
    __esModule: true,
    init: mockInit,
    captureException: mockCaptureException,
    addBreadcrumb: mockAddBreadcrumb,
  };
});

// Flush the dynamic-import().then() chain (two turns) so any erroneously-reached
// SDK load settles before we assert it did NOT happen.
const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

const DSN = "https://x@o1.ingest.sentry.io/2";

describe("#890 adversarial — web Sentry SSR/no-window invariant + DSN gating", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete (globalThis as any).window; // node/export baseline: no window
  });
  afterEach(() => {
    delete (globalThis as any).window;
  });

  it("importing sentry.ts with window undefined does NOT throw at module-load (ORCH-0886 export invariant)", () => {
    expect((globalThis as any).window).toBeUndefined();
    expect(() => {
      jest.isolateModules(() => {
        // A static top-level import of @sentry/browser here would evaluate the
        // throwing mock factory during this require → this assertion fails RED.
        require("../sentry");
      });
    }).not.toThrow();
  });

  it("init({dsn}) with NO window is a safe no-op — the web SDK is never loaded", async () => {
    expect((globalThis as any).window).toBeUndefined();
    expect(() => init({ dsn: DSN })).not.toThrow();
    await flush();
    expect(mockInit).not.toHaveBeenCalled();
  });

  it("init({}) with a window but NO DSN loads no SDK; captureException returns ''", async () => {
    (globalThis as any).window = {};
    init({}); // no dsn => must not reach the dynamic import
    await flush();
    expect(mockInit).not.toHaveBeenCalled();
    expect(captureException(new Error("boom"))).toBe("");
  });

  it("captureException before any successful init returns '' and never throws (graceful uninit)", () => {
    (globalThis as any).window = {};
    let result: string | undefined;
    expect(() => {
      result = captureException(new Error("boom"));
    }).not.toThrow();
    expect(result).toBe("");
  });
});
