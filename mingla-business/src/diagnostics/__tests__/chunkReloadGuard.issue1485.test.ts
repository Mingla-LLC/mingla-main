/**
 * Issue #1485 [web-missing-chunk-404] — T3, chunkReloadGuard behaviour.
 *
 * Proves the four properties the widened matcher has to hold simultaneously:
 *   1. it recovers from the 200-HTML signature      (T3.1, T3.2 — SC-7, SC-8)
 *   2. it did not regress the ORCH-0964 404 family  (T3.3, T3.4 — SC-11)
 *   3. it can NEVER reload-loop                     (T3.5, T3.6 — SC-9)
 *   4. a JSON.parse-of-HTML error never reloads     (T3.7, T3.8 — SC-10)
 *
 * Property 4 is the load-bearing one. V8 renders `JSON.parse("<!DOCTYPE html>…")`
 * as `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`, which matches the
 * HTML-as-JS signature exactly. Without `JSON_PARSE_RE` any API returning an HTML
 * error body would hard-reload the user's page.
 *
 * ENVIRONMENT NOTE. `jest-environment-jsdom` is deliberately NOT a dependency of
 * mingla-business (see `src/diagnostics/__tests__/sentry.web.issue890.test.ts`,
 * which states the same constraint), and the #1485 allowlist does not include
 * `package.json`. This suite therefore runs under the repo's DEFAULT node/ts-jest
 * config with a synthetic `window`, exactly like its sibling. It is not a
 * weakening: the REAL module is loaded, the REAL listeners it registers are the
 * ones invoked, and the REAL `reloadOnce()` cooldown arithmetic runs against a
 * controllable clock. Only `ErrorEvent`/`dispatchEvent` plumbing is synthesized.
 *
 * Fails-on-revert: restoring the original one-line `isChunkError` fails T3.1 and
 * T3.2; deleting the cooldown fails T3.5; dropping `JSON_PARSE_RE` fails T3.7.
 */

type Listener = (event: unknown) => void;

type Harness = {
  reload: ReturnType<typeof jest.fn>;
  setItem: ReturnType<typeof jest.fn>;
  fireError: (message: string) => void;
  fireErrorObject: (error: Error) => void;
  fireRejection: (reason: unknown) => void;
};

const GUARD_MODULE = "../chunkReloadGuard";

const realWindow = (global as unknown as { window?: unknown }).window;
let clock = 1_000_000_000;
let dateNowSpy: ReturnType<typeof jest.spyOn> | undefined;

beforeEach(() => {
  clock = 1_000_000_000;
  dateNowSpy = jest.spyOn(Date, "now").mockImplementation(() => clock);
});

afterEach(() => {
  dateNowSpy?.mockRestore();
  (global as unknown as { window?: unknown }).window = realWindow;
  jest.clearAllMocks();
});

/**
 * Installs a fresh synthetic `window`, loads the REAL guard module in isolation
 * so its top-level registration runs against that window, and hands back the
 * captured listeners.
 */
function mountGuard(options: { storageThrows?: boolean } = {}): Harness {
  const listeners = new Map<string, Listener[]>();
  const store = new Map<string, string>();
  const reload = jest.fn();

  const getItem = jest.fn((key: string): string | null => {
    if (options.storageThrows) throw new Error("sessionStorage is blocked");
    return store.get(key) ?? null;
  });
  const setItem = jest.fn((key: string, value: string): void => {
    if (options.storageThrows) throw new Error("sessionStorage is blocked");
    store.set(key, value);
  });

  const fakeWindow = {
    addEventListener: (type: string, listener: Listener): void => {
      const existing = listeners.get(type) ?? [];
      existing.push(listener);
      listeners.set(type, existing);
    },
    sessionStorage: { getItem, setItem },
    location: { reload },
  };

  (global as unknown as { window?: unknown }).window = fakeWindow;

  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require(GUARD_MODULE);
  });

  const dispatch = (type: string, event: unknown): void => {
    const registered = listeners.get(type) ?? [];
    expect(registered.length).toBeGreaterThan(0);
    for (const listener of registered) listener(event);
  };

  return {
    reload,
    setItem,
    fireError: (message: string) => dispatch("error", { message }),
    fireErrorObject: (error: Error) => dispatch("error", { error }),
    fireRejection: (reason: unknown) => dispatch("unhandledrejection", { reason }),
  };
}

describe("#1485 T3 — chunkReloadGuard recognises HTML served as JavaScript", () => {
  it("T3.1 (SC-7) — reloads exactly once on `Unexpected token '<'`", () => {
    const guard = mountGuard();
    guard.fireError("SyntaxError: Unexpected token '<'");
    expect(guard.reload).toHaveBeenCalledTimes(1);
  });

  it("T3.2 (SC-8) — reloads exactly once on `Requiring unknown module`", () => {
    const guard = mountGuard();
    guard.fireError('Requiring unknown module "771"');
    expect(guard.reload).toHaveBeenCalledTimes(1);
  });
});

describe("#1485 T3 — the ORCH-0964 404 family still reloads (no regression)", () => {
  it("T3.3 (SC-11) — a rejected dynamic import still reloads", () => {
    const guard = mountGuard();
    guard.fireRejection(
      new Error(
        "Failed to fetch dynamically imported module: https://host.usemingla.com/_expo/static/js/web/index-abc.js",
      ),
    );
    expect(guard.reload).toHaveBeenCalledTimes(1);
  });

  it("T3.4 (SC-11) — ChunkLoadError still reloads", () => {
    const guard = mountGuard();
    guard.fireError("ChunkLoadError: Loading chunk 771 failed");
    expect(guard.reload).toHaveBeenCalledTimes(1);
  });

  it("T3.4b (SC-11) — every string already in CHUNK_ERROR_RE still reloads", () => {
    const legacy = [
      "ChunkLoadError",
      "Loading chunk 42 failed",
      "Failed to fetch dynamically imported module: /_expo/static/js/web/a.js",
      "error loading dynamically imported module",
      "Importing a module script failed.",
    ];

    for (const message of legacy) {
      const guard = mountGuard();
      guard.fireError(message);
      expect([message, guard.reload.mock.calls.length]).toEqual([message, 1]);
    }
  });

  it("T3.4c — the error object's message is matched, not only event.message", () => {
    const guard = mountGuard();
    guard.fireErrorObject(new Error("SyntaxError: Unexpected token '<'"));
    expect(guard.reload).toHaveBeenCalledTimes(1);
  });
});

describe("#1485 T3 — SC-9 the guard can never reload-loop", () => {
  it("T3.5 — a second matching error inside the cooldown reloads ZERO more times", () => {
    const guard = mountGuard();

    guard.fireError("SyntaxError: Unexpected token '<'");
    expect(guard.reload).toHaveBeenCalledTimes(1);

    clock += 1_000; // 1s later — well inside the 10s cooldown
    guard.fireError("SyntaxError: Unexpected token '<'");
    expect(guard.reload).toHaveBeenCalledTimes(1);

    clock += 8_999; // 9,999ms total — still inside
    guard.fireError("SyntaxError: Unexpected token '<'");
    expect(guard.reload).toHaveBeenCalledTimes(1);
  });

  it("T3.6 — the cooldown is a cooldown: past 10,000ms exactly one more reload", () => {
    const guard = mountGuard();

    guard.fireError("SyntaxError: Unexpected token '<'");
    clock += 1_000;
    guard.fireError("SyntaxError: Unexpected token '<'");
    expect(guard.reload).toHaveBeenCalledTimes(1);

    clock += 10_001; // 11,001ms after the recorded reload
    guard.fireError("SyntaxError: Unexpected token '<'");
    expect(guard.reload).toHaveBeenCalledTimes(2);

    clock += 1; // and it is immediately bounded again
    guard.fireError("SyntaxError: Unexpected token '<'");
    expect(guard.reload).toHaveBeenCalledTimes(2);
  });

  it("T3.6b — the reload timestamp is recorded before reloading (the no-loop seal)", () => {
    const guard = mountGuard();
    guard.fireError("SyntaxError: Unexpected token '<'");
    expect(guard.setItem).toHaveBeenCalledWith(
      "mingla:last-chunk-reload",
      String(clock),
    );
  });
});

describe("#1485 T3 — SC-10 JSON.parse of an HTML error body must NOT reload", () => {
  it("T3.7 — the V8 JSON shape does not reload", () => {
    const guard = mountGuard();
    guard.fireError(
      'SyntaxError: Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON',
    );
    expect(guard.reload).not.toHaveBeenCalled();
  });

  it("T3.7b — the same shape arriving as an unhandled rejection does not reload", () => {
    const guard = mountGuard();
    guard.fireRejection(
      new Error(
        'Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON',
      ),
    );
    expect(guard.reload).not.toHaveBeenCalled();
  });

  it("T3.8 — the JSC JSON shape does not reload", () => {
    const guard = mountGuard();
    guard.fireError('SyntaxError: JSON Parse error: Unexpected identifier "html"');
    expect(guard.reload).not.toHaveBeenCalled();
  });
});

describe("#1485 T3 — the guard stays narrow and safe", () => {
  it("T3.9 — an unrelated error does not reload", () => {
    const guard = mountGuard();
    guard.fireError("TypeError: undefined is not a function");
    expect(guard.reload).not.toHaveBeenCalled();
  });

  it("T3.10 — blocked sessionStorage neither throws nor reloads", () => {
    const guard = mountGuard({ storageThrows: true });
    expect(() => guard.fireError("SyntaxError: Unexpected token '<'")).not.toThrow();
    expect(guard.reload).not.toHaveBeenCalled();
  });

  it("T3.11 — a non-string message is ignored", () => {
    const guard = mountGuard();
    guard.fireRejection({ notAnError: true });
    expect(guard.reload).not.toHaveBeenCalled();
  });
});
