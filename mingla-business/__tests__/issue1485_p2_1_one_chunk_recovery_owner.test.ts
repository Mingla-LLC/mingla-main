/**
 * Issue #1485 [web-missing-chunk-404] — P2-1: ONE chunk-recovery decision.
 *
 * WHY THIS FILE EXISTS. `scripts/inject-mobile-blur-css.mjs` injects an inline
 * `<head>` script into `dist/index.html` at build time. Until #1485 P2-1 it was
 * a SECOND, uncoordinated recovery owner alongside
 * `src/diagnostics/chunkReloadGuard.ts`, and a strictly worse behaved one:
 *
 *   * its `sessionStorage` key was set once and NEVER expired — "already
 *     attempted at any point this tab session", not a time window;
 *   * on the second trigger it ran `location.replace("/home?recovered=chunk")`,
 *     navigating the user off their page and ERASING the original URL from
 *     history — an anonymous buyer on `/checkout/<eventId>` lands on the
 *     AUTHENTICATED brand dashboard with no way back;
 *   * its `catch` fallback did the same `/home` redirect whenever
 *     `sessionStorage` threw, so private / blocked-storage browsers were
 *     ejected on the FIRST failure.
 *
 * All of it was unreachable while a missing chunk returned `200 text/html`.
 * #1485 part (a) makes that a real 404 and ACTIVATES it. This suite pins the
 * contract that replaced it:
 *
 *   1. ONE owner of the decision — the head script and `chunkReloadGuard` share
 *      one `sessionStorage` record, so one failure can only produce one reload.
 *   2. Recovery NEVER changes the URL. There is no `location.replace`, no
 *      `assign`, no `href` write, on any branch.
 *   3. The cooldown is TIME-based and SHARED — `chunkReloadGuard`'s
 *      `RELOAD_TS_KEY` / `RELOAD_COOLDOWN_MS`, pinned equal here (group F).
 *   4. The head script's ONE real capability is preserved: it is the only owner
 *      that can see a resource `error` (a `<script src>` that 404s, including
 *      the ENTRY bundle). Group E proves the guard cannot cover that class, so
 *      deleting the head script would silently drop coverage.
 *   5. Blocked / absent `sessionStorage` fails safe — no reload, no navigation.
 *
 * HOW IT TESTS. Not a source grep. The `CHUNK_RECOVERY_SCRIPT` template literal
 * is read out of the build script, evaluated with the real constants to produce
 * the EXACT bytes that ship in `<head>`, and then executed against a synthetic
 * window — so the assertions run the shipped script, not a copy of it. The
 * cross-owner cases load the REAL `chunkReloadGuard` module against the SAME
 * synthetic window and the SAME storage, which is the only way to prove the
 * two cannot double-reload.
 *
 * ENVIRONMENT NOTE. `jest-environment-jsdom` is deliberately not a dependency
 * of `mingla-business` (see `src/diagnostics/__tests__/chunkReloadGuard.issue1485.test.ts`
 * and `src/diagnostics/__tests__/sentry.web.issue890.test.ts`, which state the
 * same constraint). This suite runs under the default node/ts-jest config with
 * a synthetic `window`, exactly like its siblings.
 *
 * Fails-on-revert: restoring `location.replace("/home?recovered=chunk")` fails
 * A.1/A.2/A.3 and B.1/B.2; restoring the presence-only key fails B.3/F.1;
 * restoring the `catch` redirect fails C.1/C.2/C.3.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const BUSINESS_ROOT = join(__dirname, "..");
const INJECT_PATH = join(BUSINESS_ROOT, "scripts", "inject-mobile-blur-css.mjs");
const GUARD_PATH = join(BUSINESS_ROOT, "src", "diagnostics", "chunkReloadGuard.ts");
const GUARD_MODULE = "../src/diagnostics/chunkReloadGuard";

const injectSource = readFileSync(INJECT_PATH, "utf8");
const guardSource = readFileSync(GUARD_PATH, "utf8");

/** Reads a `const NAME = "value";` string literal out of a source file. */
function stringConst(source: string, name: string): string {
  const match = source.match(new RegExp(`const ${name} = "([^"]*)";`));
  if (match === null) throw new Error(`could not find string const ${name}`);
  return match[1];
}

/** Reads a `const NAME = 10_000;` numeric literal (underscore separators ok). */
function numberConst(source: string, name: string): number {
  const match = source.match(new RegExp(`const ${name} = ([0-9_]+);`));
  if (match === null) throw new Error(`could not find numeric const ${name}`);
  return Number(match[1].replace(/_/g, ""));
}

const LEGACY_KEY = stringConst(injectSource, "CHUNK_RECOVERY_MARKER");
const HEAD_KEY = stringConst(injectSource, "CHUNK_RECOVERY_KEY");
const HEAD_COOLDOWN_MS = numberConst(injectSource, "CHUNK_RECOVERY_COOLDOWN_MS");
const GUARD_KEY = stringConst(guardSource, "RELOAD_TS_KEY");
const GUARD_COOLDOWN_MS = numberConst(guardSource, "RELOAD_COOLDOWN_MS");

/**
 * Materialises the EXACT `<script>…</script>` string the build injects, by
 * evaluating the real template literal with the real constants.
 */
function injectedScriptTag(): string {
  const match = injectSource.match(/const CHUNK_RECOVERY_SCRIPT =\s*(`[^`]*`);/);
  if (match === null) throw new Error("could not find the CHUNK_RECOVERY_SCRIPT template literal");
  const build = new Function(
    "CHUNK_RECOVERY_MARKER",
    "CHUNK_RECOVERY_KEY",
    "CHUNK_RECOVERY_COOLDOWN_MS",
    `return ${match[1]};`,
  ) as (marker: string, key: string, cooldown: number) => string;
  return build(LEGACY_KEY, HEAD_KEY, HEAD_COOLDOWN_MS);
}

const SCRIPT_TAG = injectedScriptTag();
const SCRIPT_BODY = SCRIPT_TAG.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");

const CHUNK_URL = "/_expo/static/js/web/index-c71bd65d4564bece548e38b8d5512d1e.js";
const ENTRY_URL = "/_expo/static/js/web/index-0824756ecd6ed350ea9937412e972c32.js?v=orch1091";
const BUYER_URL = "https://business.usemingla.com/checkout/48db05a9-2b78-4af5-ada4-485b53aa26d1";

type Listener = (event: unknown) => void;

type Harness = {
  reload: jest.Mock;
  navigations: string[];
  store: Map<string, string>;
  setItem: jest.Mock;
  removeItem: jest.Mock;
  fireResourceError: (src: string) => void;
  fireMessageError: (message: string) => void;
  fireRejection: (reason: unknown) => void;
};

type MountOptions = {
  /** Pre-seeded sessionStorage for the tab (survives a reload in a real tab). */
  seed?: Record<string, string>;
  /** Every sessionStorage read throws — blocked / partitioned storage. */
  getItemThrows?: boolean;
  /** Reads work, writes throw — quota / Safari private mode. */
  setItemThrows?: boolean;
  /** `window.sessionStorage` is absent entirely. */
  noStorage?: boolean;
  /** Also load the REAL chunkReloadGuard against the same window + storage. */
  withGuard?: boolean;
  /** Load ONLY the guard (group E: prove what the head script uniquely covers). */
  guardOnly?: boolean;
};

let clock = 1_700_000_000_000;
let dateNowSpy: jest.SpyInstance<number, []> | undefined;
const realWindow = (global as unknown as { window?: unknown }).window;

beforeEach(() => {
  clock = 1_700_000_000_000;
  dateNowSpy = jest.spyOn(Date, "now").mockImplementation(() => clock);
});

afterEach(() => {
  dateNowSpy?.mockRestore();
  (global as unknown as { window?: unknown }).window = realWindow;
  jest.clearAllMocks();
});

function mount(options: MountOptions = {}): Harness {
  const listeners = new Map<string, Listener[]>();
  const store = new Map<string, string>(Object.entries(options.seed ?? {}));
  const navigations: string[] = [];
  const reload = jest.fn();

  const getItem = jest.fn((key: string): string | null => {
    if (options.getItemThrows) throw new Error("sessionStorage is blocked");
    return store.get(key) ?? null;
  });
  const setItem = jest.fn((key: string, value: string): void => {
    if (options.getItemThrows || options.setItemThrows) {
      throw new Error("sessionStorage is blocked");
    }
    store.set(key, value);
  });
  const removeItem = jest.fn((key: string): void => {
    if (options.getItemThrows || options.setItemThrows) {
      throw new Error("sessionStorage is blocked");
    }
    store.delete(key);
  });

  const location: Record<string, unknown> = {
    reload,
    replace: jest.fn((url: string) => navigations.push(`replace:${url}`)),
    assign: jest.fn((url: string) => navigations.push(`assign:${url}`)),
  };
  Object.defineProperty(location, "href", {
    configurable: true,
    get: () => BUYER_URL,
    set: (value: string) => {
      navigations.push(`href:${String(value)}`);
    },
  });

  const fakeWindow: Record<string, unknown> = {
    addEventListener: (type: string, listener: Listener): void => {
      const existing = listeners.get(type) ?? [];
      existing.push(listener);
      listeners.set(type, existing);
    },
    location,
  };
  if (!options.noStorage) {
    fakeWindow.sessionStorage = { getItem, setItem, removeItem };
  }

  (global as unknown as { window?: unknown }).window = fakeWindow;

  const quietConsole = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };

  if (!options.guardOnly) {
    // Run the REAL injected bytes. `<head>` order: this script first, always.
    new Function("window", "console", SCRIPT_BODY)(fakeWindow, quietConsole);
  }
  if (options.withGuard || options.guardOnly) {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(GUARD_MODULE);
    });
  }

  const dispatch = (type: string, event: unknown): void => {
    const registered = listeners.get(type) ?? [];
    expect(registered.length).toBeGreaterThan(0);
    for (const listener of registered) listener(event);
  };

  return {
    reload,
    navigations,
    store,
    setItem,
    removeItem,
    // A resource error: `event.target.src` is set, `event.message` is NOT.
    fireResourceError: (src: string) => dispatch("error", { target: { src } }),
    fireMessageError: (message: string) => dispatch("error", { message }),
    fireRejection: (reason: unknown) => dispatch("unhandledrejection", { reason }),
  };
}

describe("#1485 P2-1 A — the /home redirect is gone from the shipped bytes", () => {
  it("A.1 — the injected script performs no location.replace on any branch", () => {
    expect(SCRIPT_TAG).not.toContain("location.replace");
  });

  it("A.2 — the injected script never references /home", () => {
    expect(SCRIPT_TAG).not.toContain("/home");
  });

  it("A.3 — the `recovered=chunk` redirect target no longer exists", () => {
    expect(SCRIPT_TAG).not.toContain("recovered=chunk");
    expect(injectSource).not.toContain("/home?recovered=chunk");
  });

  it("A.4 — the only recovery action left is a reload of the current URL", () => {
    expect(SCRIPT_TAG).toContain("window.location.reload()");
    expect(SCRIPT_TAG).not.toContain(".assign(");
    expect(SCRIPT_TAG).not.toMatch(/location\.href\s*=/);
  });
});

describe("#1485 P2-1 B — a second failure never navigates the buyer off their URL", () => {
  it("B.1 — two resource failures in one session: exactly ONE reload, ZERO navigations", () => {
    const head = mount();

    head.fireResourceError(CHUNK_URL);
    expect(head.reload).toHaveBeenCalledTimes(1);

    clock += 1_000; // second failure, same tab, inside the cooldown
    head.fireResourceError(CHUNK_URL);

    expect(head.reload).toHaveBeenCalledTimes(1);
    expect(head.navigations).toEqual([]);
  });

  it("B.2 — two rejected dynamic imports: exactly ONE reload, ZERO navigations", () => {
    const head = mount();

    head.fireRejection(new Error(`Failed to fetch dynamically imported module: ${CHUNK_URL}`));
    expect(head.reload).toHaveBeenCalledTimes(1);

    clock += 2_500;
    head.fireRejection(new Error("ChunkLoadError: Loading chunk 771 failed"));

    expect(head.reload).toHaveBeenCalledTimes(1);
    expect(head.navigations).toEqual([]);
  });

  it("B.3 — the cooldown is a COOLDOWN, not a one-shot latch", () => {
    const head = mount();

    head.fireResourceError(CHUNK_URL);
    expect(head.reload).toHaveBeenCalledTimes(1);

    clock += HEAD_COOLDOWN_MS + 1; // a genuine later failure still recovers
    head.fireResourceError(CHUNK_URL);

    expect(head.reload).toHaveBeenCalledTimes(2);
    expect(head.navigations).toEqual([]);
  });

  it("B.4 — the cooldown boundary is exact (suppressed at -1ms, allowed at +0ms)", () => {
    const justInside = mount({ seed: { [HEAD_KEY]: String(clock - (HEAD_COOLDOWN_MS - 1)) } });
    justInside.fireResourceError(CHUNK_URL);
    expect(justInside.reload).not.toHaveBeenCalled();
    expect(justInside.navigations).toEqual([]);

    const justOutside = mount({ seed: { [HEAD_KEY]: String(clock - HEAD_COOLDOWN_MS) } });
    justOutside.fireResourceError(CHUNK_URL);
    expect(justOutside.reload).toHaveBeenCalledTimes(1);
  });

  it("B.5 — a burst of ten failures cannot escalate into a navigation", () => {
    const head = mount();
    for (let i = 0; i < 10; i += 1) {
      clock += 250;
      head.fireResourceError(CHUNK_URL);
      head.fireRejection(new Error("ChunkLoadError"));
    }
    expect(head.reload).toHaveBeenCalledTimes(1);
    expect(head.navigations).toEqual([]);
  });
});

describe("#1485 P2-1 C — blocked or absent sessionStorage fails safe", () => {
  it("C.1 — reads that throw: no reload, no navigation, nothing escapes", () => {
    const head = mount({ getItemThrows: true });
    expect(() => head.fireResourceError(CHUNK_URL)).not.toThrow();
    expect(head.reload).not.toHaveBeenCalled();
    expect(head.navigations).toEqual([]);
  });

  it("C.2 — writes that throw: no reload, no navigation, nothing escapes", () => {
    const head = mount({ setItemThrows: true });
    expect(() => head.fireResourceError(CHUNK_URL)).not.toThrow();
    expect(head.reload).not.toHaveBeenCalled();
    expect(head.navigations).toEqual([]);
  });

  it("C.3 — window.sessionStorage absent entirely: mounts, then fails safe", () => {
    expect(() => mount({ noStorage: true })).not.toThrow();
    const head = mount({ noStorage: true });
    expect(() => head.fireRejection(new Error("ChunkLoadError"))).not.toThrow();
    expect(head.reload).not.toHaveBeenCalled();
    expect(head.navigations).toEqual([]);
  });

  it("C.4 — blocked storage stays safe across repeated failures", () => {
    const head = mount({ getItemThrows: true });
    for (let i = 0; i < 5; i += 1) {
      clock += 5_000;
      head.fireResourceError(CHUNK_URL);
    }
    expect(head.reload).not.toHaveBeenCalled();
    expect(head.navigations).toEqual([]);
  });
});

describe("#1485 P2-1 D — one decision: the two owners can never double-reload", () => {
  it("D.1 — a failure BOTH owners match produces exactly one reload", () => {
    const both = mount({ withGuard: true });
    both.fireRejection(
      new Error(`Failed to fetch dynamically imported module: ${CHUNK_URL}`),
    );
    expect(both.reload).toHaveBeenCalledTimes(1);
    expect(both.navigations).toEqual([]);
  });

  it("D.2 — head script acts first; the guard then stands down inside the window", () => {
    const both = mount({ withGuard: true });

    both.fireResourceError(CHUNK_URL); // only the head script can see this
    expect(both.reload).toHaveBeenCalledTimes(1);

    clock += 1_000;
    both.fireMessageError("SyntaxError: Unexpected token '<'"); // only the guard sees this
    expect(both.reload).toHaveBeenCalledTimes(1);
    expect(both.navigations).toEqual([]);
  });

  it("D.3 — guard acts first; the head script then stands down inside the window", () => {
    const both = mount({ withGuard: true });

    both.fireMessageError('Requiring unknown module "771"');
    expect(both.reload).toHaveBeenCalledTimes(1);

    clock += 1_000;
    both.fireResourceError(CHUNK_URL);
    expect(both.reload).toHaveBeenCalledTimes(1);
    expect(both.navigations).toEqual([]);
  });

  it("D.4 — the head script stamps the SHARED key, never a private one", () => {
    const head = mount();
    head.fireResourceError(CHUNK_URL);

    expect(head.setItem).toHaveBeenCalledWith(HEAD_KEY, String(clock));
    expect(head.store.get(GUARD_KEY)).toBe(String(clock));
    expect(head.store.has(LEGACY_KEY)).toBe(false);
  });
});

describe("#1485 P2-1 E — the head script's unique capability, proved not asserted", () => {
  it("E.1 — it recovers from an ENTRY-bundle <script src> 404 (a resource error)", () => {
    const head = mount();
    head.fireResourceError(ENTRY_URL);
    expect(head.reload).toHaveBeenCalledTimes(1);
    expect(head.navigations).toEqual([]);
  });

  it("E.2 — chunkReloadGuard ALONE cannot see that event: deleting the head script would drop coverage", () => {
    const guardOnly = mount({ guardOnly: true });
    expect(() => guardOnly.fireResourceError(ENTRY_URL)).not.toThrow();
    expect(guardOnly.reload).not.toHaveBeenCalled();
  });

  it("E.3 — it stays narrow: a non-chunk resource failure never reloads", () => {
    const head = mount();
    head.fireResourceError("/assets/assets/google_icon.abc123.png");
    head.fireResourceError("/_expo/static/media/font-abc.ttf");
    expect(head.reload).not.toHaveBeenCalled();
    expect(head.navigations).toEqual([]);
  });
});

describe("#1485 P2-1 F — the shared cooldown is one record, pinned across both owners", () => {
  it("F.1 — the head script's key is chunkReloadGuard's RELOAD_TS_KEY", () => {
    expect(HEAD_KEY).toBe(GUARD_KEY);
    expect(HEAD_KEY).toBe("mingla:last-chunk-reload");
  });

  it("F.2 — the head script's cooldown is chunkReloadGuard's RELOAD_COOLDOWN_MS", () => {
    expect(HEAD_COOLDOWN_MS).toBe(GUARD_COOLDOWN_MS);
    expect(HEAD_COOLDOWN_MS).toBe(10_000);
  });

  it("F.3 — the pin is on the SHIPPED bytes, not just the build-script constants", () => {
    expect(SCRIPT_TAG).toContain(`var KEY="${GUARD_KEY}"`);
    expect(SCRIPT_TAG).toContain(`var COOLDOWN_MS=${GUARD_COOLDOWN_MS}`);
  });

  it("F.4 — the retired presence-only key survives only as the migration source", () => {
    expect(LEGACY_KEY).toBe("mingla-mobile-web-chunk-recovery");
    expect(SCRIPT_TAG).toContain(`var LEGACY_KEY="${LEGACY_KEY}"`);
    // it is read and removed, never written as a recovery record
    expect(SCRIPT_TAG).toContain("removeItem(LEGACY_KEY)");
    expect(SCRIPT_TAG).not.toContain("setItem(LEGACY_KEY");
  });
});

describe("#1485 P2-1 G — sessions already carrying the retired key are migrated, not re-broken", () => {
  it("G.1 — a legacy stamp inside the window is honoured as a cooldown, not a latch", () => {
    const head = mount({ seed: { [LEGACY_KEY]: String(clock - 2_000) } });

    expect(head.store.get(HEAD_KEY)).toBe(String(clock - 2_000));
    expect(head.store.has(LEGACY_KEY)).toBe(false);

    head.fireResourceError(CHUNK_URL);
    expect(head.reload).not.toHaveBeenCalled();
    expect(head.navigations).toEqual([]);
  });

  it("G.2 — a legacy stamp OUTSIDE the window still allows a genuine recovery", () => {
    const head = mount({ seed: { [LEGACY_KEY]: String(clock - 20_000) } });

    expect(head.store.has(LEGACY_KEY)).toBe(false);
    head.fireResourceError(CHUNK_URL);
    expect(head.reload).toHaveBeenCalledTimes(1);
    expect(head.navigations).toEqual([]);
  });

  it("G.3 — migration never clobbers an existing shared record", () => {
    const head = mount({
      seed: {
        [LEGACY_KEY]: String(clock - 90_000),
        [HEAD_KEY]: String(clock - 1_000),
      },
    });

    expect(head.store.get(HEAD_KEY)).toBe(String(clock - 1_000));
    expect(head.store.has(LEGACY_KEY)).toBe(false);
    head.fireResourceError(CHUNK_URL);
    expect(head.reload).not.toHaveBeenCalled();
  });

  it("G.4 — the migration is one-way: the legacy key is never resurrected", () => {
    const head = mount({ seed: { [LEGACY_KEY]: String(clock - 60_000) } });

    head.fireResourceError(CHUNK_URL);
    clock += HEAD_COOLDOWN_MS + 1;
    head.fireResourceError(CHUNK_URL);

    expect(head.reload).toHaveBeenCalledTimes(2);
    expect(head.store.has(LEGACY_KEY)).toBe(false);
    expect(head.removeItem).toHaveBeenCalledWith(LEGACY_KEY);
  });

  it("G.5 — a garbage legacy value cannot wedge recovery shut", () => {
    const head = mount({ seed: { [LEGACY_KEY]: "not-a-timestamp" } });
    head.fireResourceError(CHUNK_URL);
    expect(head.reload).toHaveBeenCalledTimes(1);
    expect(head.navigations).toEqual([]);
  });

  it("G.6 — migration on blocked storage neither throws nor navigates", () => {
    expect(() => mount({ seed: { [LEGACY_KEY]: "1" }, getItemThrows: true })).not.toThrow();
    const head = mount({ seed: { [LEGACY_KEY]: "1" }, getItemThrows: true });
    head.fireResourceError(CHUNK_URL);
    expect(head.reload).not.toHaveBeenCalled();
    expect(head.navigations).toEqual([]);
  });
});
