/**
 * Issue #1485 [web-missing-chunk-404] — TESTER ADVERSARIAL suite for P2-1.
 *
 * This is the tester's independent attack on the "one chunk-recovery owner,
 * never move the URL" fix. It deliberately does NOT re-run the implementor's
 * 30 cases in `__tests__/issue1485_p2_1_one_chunk_recovery_owner.test.ts`.
 * Every case here comes at the contract from an angle that suite does not
 * exercise:
 *
 *   * group N — the ACCEPTED FAILURE SCENARIO must be dead under *any*
 *     sequence, not just the two hand-picked ones. A seeded 600-sequence fuzz
 *     over both owners, a whole-alphabet sweep of navigation primitives (not
 *     just replace/assign/href), and a backwards system clock.
 *   * group T — the handoff between the two owners. The implementor only ever
 *     registers the head script FIRST. Here the guard registers first; the
 *     10,000 ms boundary is probed from the OTHER owner's side in both
 *     directions; both owners are made to evaluate in the SAME millisecond;
 *     and the record is carried across a simulated page RELOAD, which is the
 *     one boundary a single-document harness cannot see.
 *   * group M — the migration, which is the newest and least-examined code.
 *     Future timestamps, an empty string (the one value where the head
 *     script's `|| 0` and the guard's `?? 0` could diverge), a 1 MB value, a
 *     competing writer interleaved between the migration's two reads, double
 *     execution, and the residual the implementor documented but did not
 *     measure (injection fails open while a prior build's stamp exists).
 *   * group S — storage hostility beyond "getItem/setItem throw": the
 *     `sessionStorage` PROPERTY itself throwing (Safari with cookies blocked
 *     raises SecurityError on the accessor, not on the method), `removeItem`
 *     throwing alone, and a shim that returns non-strings.
 *   * group I — injection integrity, by RUNNING the real build script against
 *     a real temp `dist/index.html` rather than reading its template literal:
 *     ordering before the entry bundle, idempotency, ORCH-1091 cache-bust and
 *     the blur style still intact, ES5-only tokens, and malformed input.
 *
 * WHAT IT CANNOT PROVE. Deployed production behaviour. Vercel has not built
 * this branch (the `[deploy]` ignoreCommand gate cancels preview builds), so
 * SC-1/SC-3 and the shipped `<head>` bytes on host.usemingla.com remain
 * unproven until the `[deploy]`-tagged squash reaches READY. This suite pins
 * the source and runtime contract only.
 *
 * Fails-on-revert: restoring either `location.replace` branch fails N.2, N.3,
 * S.1 and S.2; forking the shared key fails T.1–T.5; deleting the cooldown
 * comparison fails T.2, T.3, T.6 and M.1; deleting the migration fails M.2–M.7.
 */

import { describe, expect, it } from "@jest/globals";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Script } from "node:vm";

const BUSINESS_ROOT = join(__dirname, "..");
const INJECT_PATH = join(BUSINESS_ROOT, "scripts", "inject-mobile-blur-css.mjs");
const GUARD_PATH = join(BUSINESS_ROOT, "src", "diagnostics", "chunkReloadGuard.ts");
const GUARD_MODULE = "../src/diagnostics/chunkReloadGuard";

const injectSource = readFileSync(INJECT_PATH, "utf8");
const guardSource = readFileSync(GUARD_PATH, "utf8");

function stringConst(source: string, name: string): string {
  const match = source.match(new RegExp(`const ${name} = "([^"]*)";`));
  if (match === null) throw new Error(`could not find string const ${name}`);
  return match[1];
}
function numberConst(source: string, name: string): number {
  const match = source.match(new RegExp(`const ${name} = ([0-9_]+);`));
  if (match === null) throw new Error(`could not find numeric const ${name}`);
  return Number(match[1].replace(/_/g, ""));
}

const LEGACY_KEY = stringConst(injectSource, "CHUNK_RECOVERY_MARKER");
const SHARED_KEY = stringConst(injectSource, "CHUNK_RECOVERY_KEY");
const COOLDOWN_MS = numberConst(injectSource, "CHUNK_RECOVERY_COOLDOWN_MS");
const GUARD_KEY = stringConst(guardSource, "RELOAD_TS_KEY");
const GUARD_COOLDOWN_MS = numberConst(guardSource, "RELOAD_COOLDOWN_MS");

/** The EXACT `<script>…</script>` the build injects, from the real template. */
function injectedScriptTag(): string {
  const match = injectSource.match(/const CHUNK_RECOVERY_SCRIPT =\s*(`[^`]*`);/);
  if (match === null) throw new Error("could not find the CHUNK_RECOVERY_SCRIPT template literal");
  const build = new Function(
    "CHUNK_RECOVERY_MARKER",
    "CHUNK_RECOVERY_KEY",
    "CHUNK_RECOVERY_COOLDOWN_MS",
    `return ${match[1]};`,
  ) as (marker: string, key: string, cooldown: number) => string;
  return build(LEGACY_KEY, SHARED_KEY, COOLDOWN_MS);
}

const SCRIPT_TAG = injectedScriptTag();
const SCRIPT_BODY = SCRIPT_TAG.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");

const CHUNK_URL = "/_expo/static/js/web/index-c71bd65d4564bece548e38b8d5512d1e.js";
const ENTRY_URL = "/_expo/static/js/web/entry-0824756ecd6ed350ea9937412e972c32.js?v=orch1091";
const CHECKOUT_URL = "https://host.usemingla.com/checkout/48db05a9-2b78-4af5-ada4-485b53aa26d1";

// --------------------------------------------------------------------------
// A TAB. Unlike the implementor's single-document harness, storage here
// SURVIVES a simulated reload, so the handoff across a page load is testable.
// --------------------------------------------------------------------------

type StorageMode =
  | "ok"
  | "propertyThrows" // `window.sessionStorage` itself throws (Safari, cookies blocked)
  | "getThrows"
  | "setThrows"
  | "removeThrows"
  | "noop" // writes silently discarded
  | "nonString"; // a shim that hands back objects instead of strings

type Owner = "head" | "guard";

type TabOptions = {
  mode?: StorageMode;
  seed?: Record<string, string>;
  /** Registration order. Real `<head>` order is head-first; both are proved. */
  owners?: Owner[];
  /** Mutate the store the moment `getItem(key)` is served (competing writer). */
  onGetItem?: (key: string, store: Map<string, string>) => void;
};

class Tab {
  readonly store = new Map<string, string>();
  readonly navigations: string[] = [];
  readonly thrown: string[] = [];
  reloads = 0;
  clock = 1_700_000_000_000;
  private listeners = new Map<string, ((event: unknown) => void)[]>();
  private readonly options: TabOptions;

  constructor(options: TabOptions = {}) {
    this.options = options;
    for (const [key, value] of Object.entries(options.seed ?? {})) this.store.set(key, value);
  }

  private buildStorage(): Record<string, unknown> {
    const mode = this.options.mode ?? "ok";
    return {
      getItem: (key: string): unknown => {
        if (mode === "getThrows") throw new Error("SecurityError: sessionStorage is blocked");
        this.options.onGetItem?.(key, this.store);
        const value = this.store.get(key) ?? null;
        if (mode === "nonString" && value !== null) return { toString: () => value };
        return value;
      },
      setItem: (key: string, value: string): void => {
        if (mode === "getThrows" || mode === "setThrows") throw new Error("QuotaExceededError");
        if (mode === "noop") return;
        this.store.set(key, String(value));
      },
      removeItem: (key: string): void => {
        if (mode === "getThrows" || mode === "setThrows" || mode === "removeThrows") {
          throw new Error("removeItem denied");
        }
        this.store.delete(key);
      },
    };
  }

  /** Executes ONE page load: fresh document, same tab storage. */
  load(): this {
    this.listeners = new Map();
    const mode = this.options.mode ?? "ok";

    const location: Record<string, unknown> = {
      reload: () => {
        this.reloads += 1;
      },
      replace: (url: string) => this.navigations.push(`replace:${String(url)}`),
      assign: (url: string) => this.navigations.push(`assign:${String(url)}`),
    };
    Object.defineProperty(location, "href", {
      configurable: true,
      get: () => CHECKOUT_URL,
      set: (value: string) => {
        this.navigations.push(`href:${String(value)}`);
      },
    });

    const win: Record<string, unknown> = {
      addEventListener: (type: string, listener: (event: unknown) => void): void => {
        const existing = this.listeners.get(type) ?? [];
        existing.push(listener);
        this.listeners.set(type, existing);
      },
      location,
      open: (url: string) => this.navigations.push(`open:${String(url)}`),
      history: {
        pushState: (_s: unknown, _t: unknown, url: string) =>
          this.navigations.push(`pushState:${String(url)}`),
        replaceState: (_s: unknown, _t: unknown, url: string) =>
          this.navigations.push(`replaceState:${String(url)}`),
      },
    };
    if (mode === "propertyThrows") {
      Object.defineProperty(win, "sessionStorage", {
        configurable: true,
        get: () => {
          throw new Error("SecurityError: sessionStorage access denied");
        },
      });
    } else {
      win.sessionStorage = this.buildStorage();
    }

    (global as unknown as { window?: unknown }).window = win;
    const quiet = { warn: () => {}, error: () => {}, log: () => {} };

    for (const owner of this.options.owners ?? ["head"]) {
      try {
        if (owner === "head") {
          // `location` is bound explicitly: the retired code called BARE
          // `location.replace(...)`, which in a browser is `window.location`.
          // Without this binding a reverted redirect would surface as a
          // ReferenceError instead of a recorded navigation, and the revert
          // proof would be measuring the wrong thing.
          new Function("window", "console", "location", SCRIPT_BODY)(win, quiet, location);
        } else {
          jest.isolateModules(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require(GUARD_MODULE);
          });
        }
      } catch (error) {
        // A <head>-blocking script that throws would abort before registering
        // its listeners. Recorded, never swallowed: group S asserts it is empty.
        this.thrown.push(`${owner}:${String((error as Error).message)}`);
      }
    }
    return this;
  }

  private dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      try {
        listener(event);
      } catch (error) {
        this.thrown.push(`listener:${String((error as Error).message)}`);
      }
    }
  }

  /** A resource error: `target.src` set, `message` absent — a plain Event. */
  resourceError(src = CHUNK_URL): this {
    this.dispatch("error", { target: { src } });
    return this;
  }
  messageError(message: string): this {
    this.dispatch("error", { message });
    return this;
  }
  rejection(reason: unknown): this {
    this.dispatch("unhandledrejection", { reason });
    return this;
  }
  tick(ms: number): this {
    this.clock += ms;
    return this;
  }
  listenerCount(type: string): number {
    return (this.listeners.get(type) ?? []).length;
  }
}

let activeTab: Tab | undefined;
let dateNowSpy: jest.SpyInstance<number, []> | undefined;
const realWindow = (global as unknown as { window?: unknown }).window;
let nowCalls = 0;

beforeEach(() => {
  nowCalls = 0;
  dateNowSpy = jest.spyOn(Date, "now").mockImplementation(() => {
    nowCalls += 1;
    return activeTab?.clock ?? 1_700_000_000_000;
  });
});

afterEach(() => {
  dateNowSpy?.mockRestore();
  activeTab = undefined;
  (global as unknown as { window?: unknown }).window = realWindow;
  jest.clearAllMocks();
});

function openTab(options: TabOptions = {}): Tab {
  const tab = new Tab(options);
  activeTab = tab;
  return tab.load();
}

// ==========================================================================
// N — the accepted failure scenario must be DEAD. Any URL change is a P0.
// ==========================================================================

describe("#1485 P2-1 tester N — an anonymous buyer can never be navigated away", () => {
  it("N.1 — 600 randomised failure sequences across both owners produce ZERO navigations", () => {
    // Deterministic PRNG so a red run is reproducible in CI.
    let seed = 0x1485c0de;
    const rnd = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const modes: StorageMode[] = [
      "ok",
      "propertyThrows",
      "getThrows",
      "setThrows",
      "removeThrows",
      "noop",
      "nonString",
    ];
    const seeds: (Record<string, string> | undefined)[] = [
      undefined,
      { [LEGACY_KEY]: "1699999999000" },
      { [LEGACY_KEY]: "not-a-number" },
      { [SHARED_KEY]: "1700000000000" },
      { [LEGACY_KEY]: "1700000000000", [SHARED_KEY]: "1699999999000" },
      { [SHARED_KEY]: "" },
    ];
    const ownerSets: Owner[][] = [["head"], ["head", "guard"], ["guard", "head"], ["guard"]];

    let navigationsSeen = 0;
    let escapes = 0;

    for (let run = 0; run < 600; run += 1) {
      const tab = openTab({
        mode: modes[Math.floor(rnd() * modes.length)],
        seed: seeds[Math.floor(rnd() * seeds.length)],
        owners: ownerSets[Math.floor(rnd() * ownerSets.length)],
      });

      const steps = 3 + Math.floor(rnd() * 8);
      for (let step = 0; step < steps; step += 1) {
        // Clock can jump forwards OR backwards (NTP correction, user edit).
        tab.tick(Math.floor(rnd() * 26_000) - 6_000);
        const pick = rnd();
        if (pick < 0.2) tab.resourceError(CHUNK_URL);
        else if (pick < 0.32) tab.resourceError(ENTRY_URL);
        else if (pick < 0.4) tab.resourceError("/assets/logo.png");
        else if (pick < 0.55) tab.rejection(new Error("ChunkLoadError: Loading chunk 42 failed"));
        else if (pick < 0.65) tab.rejection("Failed to fetch dynamically imported module: /x.js");
        else if (pick < 0.72) tab.rejection(new Error("Requiring unknown module \"771\""));
        else if (pick < 0.8) tab.messageError("SyntaxError: Unexpected token '<'");
        else if (pick < 0.86) {
          tab.messageError('Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON');
        } else if (pick < 0.92) tab.rejection(undefined);
        else if (pick < 0.96) tab.rejection({ name: "loadBundleAsync failed" });
        else tab.load(); // a real reload: fresh document, same tab storage
      }

      navigationsSeen += tab.navigations.length;
      escapes += tab.thrown.length;
    }

    expect(navigationsSeen).toBe(0);
    expect(escapes).toBe(0);
  });

  it("N.2 — the shipped bytes contain NO navigation primitive of any kind", () => {
    for (const forbidden of [
      "location.replace",
      "location.assign",
      ".assign(",
      "window.open",
      "pushState",
      "replaceState",
      "http-equiv",
      "document.location",
      "/home",
      "recovered",
    ]) {
      expect(SCRIPT_TAG).not.toContain(forbidden);
    }
    expect(SCRIPT_TAG).not.toMatch(/location\s*\.\s*href\s*=/);
    expect(SCRIPT_TAG).not.toMatch(/location\s*=\s*["'`]/);
    // The one action that IS allowed.
    expect(SCRIPT_TAG).toContain("window.location.reload()");
  });

  it("N.3 — a system clock that jumps BACKWARD suppresses, never navigates, and unwedges", () => {
    const tab = openTab();

    tab.resourceError();
    expect(tab.reloads).toBe(1);

    tab.tick(-3_600_000); // NTP correction an hour backwards
    tab.resourceError();
    tab.resourceError();
    expect(tab.reloads).toBe(1); // now - last is negative, i.e. inside the window
    expect(tab.navigations).toEqual([]);

    tab.tick(3_600_000 + COOLDOWN_MS + 1); // clock restored and past the window
    tab.resourceError();
    expect(tab.reloads).toBe(2);
    expect(tab.navigations).toEqual([]);
  });

  it("N.4 — the guard's own recovery path also never navigates", () => {
    const tab = openTab({ owners: ["guard"] });
    tab.messageError("SyntaxError: Unexpected token '<'");
    tab.tick(COOLDOWN_MS + 1);
    tab.rejection(new Error("ChunkLoadError"));
    expect(tab.reloads).toBe(2);
    expect(tab.navigations).toEqual([]);
    expect(guardSource).not.toContain("location.replace");
    expect(guardSource).not.toContain("location.assign");
  });
});

// ==========================================================================
// T — two owners, one action. Boundary probed from BOTH sides + across reload.
// ==========================================================================

describe("#1485 P2-1 tester T — the handoff between the two owners", () => {
  it("T.1 — order independence: the GUARD registered first still yields one reload", () => {
    const tab = openTab({ owners: ["guard", "head"] });
    expect(tab.listenerCount("error")).toBe(2);
    tab.rejection(new Error("ChunkLoadError: Loading chunk 771 failed"));
    expect(tab.reloads).toBe(1);
    expect(tab.navigations).toEqual([]);
  });

  it("T.2 — head stamps, GUARD probes the boundary: suppressed at 9,999 ms, allowed at 10,000 ms", () => {
    const inside = openTab({ owners: ["head", "guard"] });
    inside.resourceError(); // only the head script can see this
    expect(inside.reloads).toBe(1);
    inside.tick(COOLDOWN_MS - 1);
    inside.messageError("SyntaxError: Unexpected token '<'"); // only the guard sees this
    expect(inside.reloads).toBe(1);

    const atBoundary = openTab({ owners: ["head", "guard"] });
    atBoundary.resourceError();
    expect(atBoundary.reloads).toBe(1);
    atBoundary.tick(COOLDOWN_MS);
    atBoundary.messageError("SyntaxError: Unexpected token '<'");
    expect(atBoundary.reloads).toBe(2);
    expect(atBoundary.navigations).toEqual([]);
  });

  it("T.3 — guard stamps, HEAD probes the boundary: suppressed at 9,999 ms, allowed at 10,000 ms", () => {
    const inside = openTab({ owners: ["head", "guard"] });
    inside.messageError('Requiring unknown module "771"'); // only the guard sees this
    expect(inside.reloads).toBe(1);
    inside.tick(COOLDOWN_MS - 1);
    inside.resourceError(); // only the head script sees this
    expect(inside.reloads).toBe(1);

    const atBoundary = openTab({ owners: ["head", "guard"] });
    atBoundary.messageError('Requiring unknown module "771"');
    atBoundary.tick(COOLDOWN_MS);
    atBoundary.resourceError();
    expect(atBoundary.reloads).toBe(2);
    expect(atBoundary.navigations).toEqual([]);
  });

  it("T.4 — both owners evaluate in the SAME millisecond: one reload, one record", () => {
    const tab = openTab({ owners: ["head", "guard"] });
    const before = nowCalls;
    tab.rejection(new Error("Failed to fetch dynamically imported module: /_expo/x.js"));
    // Both owners matched this reason and both consulted the clock.
    expect(nowCalls).toBeGreaterThan(before + 1);
    expect(tab.reloads).toBe(1);
    expect(tab.store.get(SHARED_KEY)).toBe(String(tab.clock));
    expect([...tab.store.keys()].filter((k) => k !== LEGACY_KEY)).toEqual([SHARED_KEY]);
    expect(tab.navigations).toEqual([]);
  });

  it("T.5 — the record survives a real RELOAD: head acts, bundle boots, guard stands down", () => {
    const tab = openTab({ owners: ["head"] }); // <head> only — no bundle yet
    tab.resourceError(ENTRY_URL); // the entry bundle 404s
    expect(tab.reloads).toBe(1);

    tab.tick(1_200).load(); // the reload lands; this time the bundle boots too
    (tab as unknown as { options: TabOptions }).options.owners = ["head", "guard"];
    tab.load();

    tab.tick(300);
    tab.messageError("SyntaxError: Unexpected token '<'");
    tab.resourceError(CHUNK_URL);
    expect(tab.reloads).toBe(1); // still one, across the handoff boundary
    expect(tab.navigations).toEqual([]);
  });

  it("T.6 — 400 failures over 60 simulated seconds cannot storm or navigate", () => {
    const tab = openTab({ owners: ["head", "guard"] });
    for (let i = 0; i < 400; i += 1) {
      tab.tick(150);
      tab.resourceError();
      tab.rejection(new Error("ChunkLoadError"));
      tab.messageError("SyntaxError: Unexpected token '<'");
    }
    // 60,000 ms elapsed / a 10,000 ms window == at most 7 admissions.
    expect(tab.reloads).toBeLessThanOrEqual(Math.ceil(60_000 / COOLDOWN_MS) + 1);
    expect(tab.reloads).toBeGreaterThan(0);
    expect(tab.navigations).toEqual([]);
  });

  it("T.7 — the two owners agree on the record's shape, not just its name", () => {
    const headOnly = openTab({ owners: ["head"] });
    headOnly.resourceError();
    const headValue = headOnly.store.get(SHARED_KEY);

    const guardOnly = openTab({ owners: ["guard"] });
    guardOnly.messageError("SyntaxError: Unexpected token '<'");
    const guardValue = guardOnly.store.get(SHARED_KEY);

    expect(headValue).toBe(guardValue);
    expect(headValue).toBe(String(1_700_000_000_000));
    expect(SHARED_KEY).toBe(GUARD_KEY);
    expect(COOLDOWN_MS).toBe(GUARD_COOLDOWN_MS);
  });
});

// ==========================================================================
// M — the migration: newest code, least examined.
// ==========================================================================

describe("#1485 P2-1 tester M — the legacy-key migration under attack", () => {
  it("M.1 — a legacy stamp in the FUTURE suppresses recovery but never navigates", () => {
    const tab = openTab({ seed: { [LEGACY_KEY]: String(1_700_000_000_000 + 86_400_000) } });
    expect(tab.store.has(LEGACY_KEY)).toBe(false);
    tab.resourceError();
    tab.tick(60_000);
    tab.resourceError();
    expect(tab.reloads).toBe(0); // fail-safe: a bad clock costs recovery, not the URL
    expect(tab.navigations).toEqual([]);
  });

  it("M.2 — a legacy stamp far outside the window still recovers exactly once", () => {
    const tab = openTab({ seed: { [LEGACY_KEY]: "1" } }); // epoch+1ms
    expect(tab.store.get(SHARED_KEY)).toBe("1");
    tab.resourceError();
    expect(tab.reloads).toBe(1);
    tab.tick(COOLDOWN_MS - 1);
    tab.resourceError();
    expect(tab.reloads).toBe(1);
    expect(tab.navigations).toEqual([]);
  });

  it("M.3 — an EMPTY legacy value is read identically by both owners (|| 0 vs ?? 0)", () => {
    // The head script uses `Number(getItem(KEY) || 0)`; the guard uses
    // `Number(getItem(KEY) ?? 0)`. "" is the one value where those can diverge.
    const head = openTab({ owners: ["head"], seed: { [LEGACY_KEY]: "" } });
    expect(head.store.get(SHARED_KEY)).toBe("");
    head.resourceError();
    expect(head.reloads).toBe(1);

    const guard = openTab({ owners: ["guard"], seed: { [SHARED_KEY]: "" } });
    guard.messageError("SyntaxError: Unexpected token '<'");
    expect(guard.reloads).toBe(1);

    expect(head.navigations).toEqual([]);
    expect(guard.navigations).toEqual([]);
  });

  it("M.4 — a 1 MB legacy value cannot wedge recovery, throw, or navigate", () => {
    const huge = "9".repeat(1_000_000); // Number(...) -> Infinity
    const tab = openTab({ seed: { [LEGACY_KEY]: huge } });
    expect(tab.thrown).toEqual([]);
    tab.resourceError();
    expect(tab.reloads).toBe(1); // isFinite(Infinity) === false, so not suppressed
    expect(tab.store.get(SHARED_KEY)).toBe(String(tab.clock)); // overwritten with a sane stamp
    expect(tab.navigations).toEqual([]);
  });

  it("M.5 — a competing writer between the migration's two reads costs at most one reload", () => {
    // Interleaving A: the shared key appears AFTER the legacy read but BEFORE
    // the shared read -> the migration must not clobber it.
    let served = 0;
    const a = openTab({
      seed: { [LEGACY_KEY]: String(1_700_000_000_000 - 90_000) },
      onGetItem: (key, store) => {
        served += 1;
        if (key === LEGACY_KEY && served === 1) {
          store.set(SHARED_KEY, String(1_700_000_000_000 - 1_000));
        }
      },
    });
    expect(a.store.get(SHARED_KEY)).toBe(String(1_700_000_000_000 - 1_000));
    a.resourceError();
    expect(a.reloads).toBe(0);
    expect(a.navigations).toEqual([]);

    // Interleaving B: the shared key appears AFTER the migration read it as
    // null -> the stale legacy value wins. Worst case must stay bounded.
    let servedB = 0;
    const b = openTab({
      seed: { [LEGACY_KEY]: String(1_700_000_000_000 - 90_000) },
      onGetItem: (key, store) => {
        servedB += 1;
        if (key === SHARED_KEY && servedB === 2) {
          store.set(SHARED_KEY, String(1_700_000_000_000 - 1_000));
        }
      },
    });
    b.resourceError();
    expect(b.reloads).toBeLessThanOrEqual(1); // one extra reload, never a navigation
    expect(b.navigations).toEqual([]);
    expect(b.store.has(LEGACY_KEY)).toBe(false);
  });

  it("M.6 — the head script executed TWICE in one document still yields one reload", () => {
    const tab = openTab({ owners: ["head", "head"] });
    expect(tab.listenerCount("error")).toBe(2);
    tab.resourceError();
    expect(tab.reloads).toBe(1);
    expect(tab.navigations).toEqual([]);
  });

  it("M.7 — one-way: the legacy key is never written, over three page loads", () => {
    const writes: string[] = [];
    const tab = new Tab({ seed: { [LEGACY_KEY]: String(1_699_999_940_000) } });
    activeTab = tab;
    const originalSet = Map.prototype.set;
    // Observe every write that reaches the tab's store.
    (tab.store as unknown as { set: typeof originalSet }).set = function patched(
      this: Map<string, string>,
      key: string,
      value: string,
    ) {
      writes.push(key);
      return originalSet.call(this, key, value) as Map<string, string>;
    };

    tab.load();
    tab.resourceError();
    tab.tick(COOLDOWN_MS + 1).load();
    tab.resourceError();
    tab.tick(COOLDOWN_MS + 1).load();
    tab.resourceError();

    expect(writes).not.toContain(LEGACY_KEY);
    expect(tab.store.has(LEGACY_KEY)).toBe(false);
    expect(tab.navigations).toEqual([]);
    expect(SCRIPT_TAG).not.toContain(`setItem(LEGACY_KEY`);
  });

  it("M.8 — the documented residual (injection fails open) costs ONE reload, never a URL", () => {
    // Build with no head script at all — the fail-open case the implementor
    // documented but did not measure. A prior build left a legacy stamp.
    const tab = openTab({
      owners: ["guard"],
      seed: { [LEGACY_KEY]: String(1_700_000_000_000 - 2_000) },
    });
    expect(tab.store.get(LEGACY_KEY)).toBe(String(1_700_000_000_000 - 2_000)); // never migrated
    tab.messageError("SyntaxError: Unexpected token '<'");
    expect(tab.reloads).toBe(1); // the ignored stamp buys exactly one extra reload
    tab.tick(COOLDOWN_MS - 1);
    tab.messageError("SyntaxError: Unexpected token '<'");
    expect(tab.reloads).toBe(1); // and the guard's own cooldown bounds it from there
    expect(tab.navigations).toEqual([]);
  });
});

// ==========================================================================
// S — storage hostility the implementor's C.1–C.4 do not reach.
// ==========================================================================

describe("#1485 P2-1 tester S — hostile sessionStorage", () => {
  it("S.1 — the sessionStorage PROPERTY itself throwing never escapes and never navigates", () => {
    const tab = openTab({ mode: "propertyThrows", owners: ["head", "guard"] });
    expect(tab.thrown).toEqual([]); // the <head> script did not abort
    expect(tab.listenerCount("error")).toBe(2);
    tab.resourceError();
    tab.messageError("SyntaxError: Unexpected token '<'");
    tab.rejection(new Error("ChunkLoadError"));
    expect(tab.reloads).toBe(0);
    expect(tab.navigations).toEqual([]);
    expect(tab.thrown).toEqual([]);
  });

  it("S.2 — quota-exceeded during the MIGRATION write leaves the tab safe", () => {
    const tab = openTab({ mode: "setThrows", seed: { [LEGACY_KEY]: "1699999990000" } });
    expect(tab.thrown).toEqual([]);
    expect(tab.store.has(LEGACY_KEY)).toBe(true); // removal never reached — documented
    tab.resourceError();
    expect(tab.reloads).toBe(0);
    expect(tab.navigations).toEqual([]);
    expect(tab.thrown).toEqual([]);
  });

  it("S.3 — removeItem throwing alone: the copy lands, the delete does not, nothing navigates", () => {
    const tab = openTab({
      mode: "removeThrows",
      seed: { [LEGACY_KEY]: String(1_700_000_000_000 - 2_000) },
    });
    expect(tab.thrown).toEqual([]);
    expect(tab.store.get(SHARED_KEY)).toBe(String(1_700_000_000_000 - 2_000)); // adopted
    expect(tab.store.has(LEGACY_KEY)).toBe(true); // could not be deleted
    tab.resourceError();
    expect(tab.reloads).toBe(0); // the adopted cooldown is still honoured
    // A second page load must not re-adopt a stale value over a newer record.
    tab.tick(COOLDOWN_MS + 1).load();
    tab.resourceError();
    expect(tab.reloads).toBe(1);
    expect(tab.navigations).toEqual([]);
    expect(tab.thrown).toEqual([]);
  });

  it("S.4 — a shim that returns non-strings cannot crash or navigate", () => {
    const tab = openTab({ mode: "nonString", seed: { [SHARED_KEY]: "1699999999000" } });
    tab.resourceError();
    expect(tab.thrown).toEqual([]);
    expect(tab.navigations).toEqual([]);
  });

  it("S.5 — a silently no-op store: recovery is unbounded but the URL is untouchable", () => {
    // A store whose writes vanish can never engage the cooldown. This is
    // PRE-EXISTING and identical in both owners (measured against origin/main),
    // so it is not pinned as a reload count — only the invariant that matters.
    const tab = openTab({ mode: "noop", owners: ["head", "guard"] });
    for (let i = 0; i < 25; i += 1) {
      tab.tick(120);
      tab.resourceError();
    }
    expect(tab.navigations).toEqual([]);
    expect(tab.thrown).toEqual([]);
  });
});

// ==========================================================================
// I — injection integrity: RUN the real build script, don't read it.
// ==========================================================================

describe("#1485 P2-1 tester I — the build script against real HTML", () => {
  const RAW_MINIFIED =
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width"><title>Mingla Host</title></head>` +
    `<body><div id="root"></div>` +
    `<script src="/_expo/static/js/web/entry-0824756ecd6ed350ea9937412e972c32.js" defer></script>` +
    `<script src="/_expo/static/js/web/_layout-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.js" defer></script>` +
    `</body></html>`;

  function runBuild(html: string | null): {
    dir: string;
    out: string | null;
    log: string;
    status: number | null;
  } {
    const dir = mkdtempSync(join(tmpdir(), "issue1485-tester-"));
    if (html !== null) {
      mkdirSync(join(dir, "dist"), { recursive: true });
      writeFileSync(join(dir, "dist", "index.html"), html);
    }
    // The script reports fail-open cases via console.warn (stderr), so BOTH
    // streams are captured — reading only stdout silently loses them.
    const run = spawnSync(process.execPath, [INJECT_PATH], { cwd: dir, encoding: "utf8" });
    const outPath = join(dir, "dist", "index.html");
    return {
      dir,
      out: existsSync(outPath) ? readFileSync(outPath, "utf8") : null,
      log: `${run.stdout ?? ""}${run.stderr ?? ""}`,
      status: run.status,
    };
  }

  it("I.1 — the recovery script lands in <head>, BEFORE the entry bundle", () => {
    const { dir, out } = runBuild(RAW_MINIFIED);
    try {
      const html = out as string;
      const scriptAt = html.indexOf(`<script id="${LEGACY_KEY}">`);
      const headCloseAt = html.indexOf("</head>");
      const firstBundleAt = html.indexOf("/_expo/static/js/web/");
      expect(scriptAt).toBeGreaterThan(-1);
      expect(scriptAt).toBeLessThan(headCloseAt);
      expect(scriptAt).toBeLessThan(firstBundleAt);
      expect(html.split(`<script id="${LEGACY_KEY}">`)).toHaveLength(2); // exactly one
      expect(html).toContain(`var KEY="${SHARED_KEY}"`);
      expect(html).not.toContain("/home?recovered=chunk");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("I.2 — a second build over its own output is byte-identical and idempotent", () => {
    const dir = mkdtempSync(join(tmpdir(), "issue1485-tester-idem-"));
    try {
      mkdirSync(join(dir, "dist"), { recursive: true });
      const target = join(dir, "dist", "index.html");
      writeFileSync(target, RAW_MINIFIED);
      execFileSync(process.execPath, [INJECT_PATH], { cwd: dir, stdio: "pipe" });
      const first = readFileSync(target, "utf8");
      const second = execFileSync(process.execPath, [INJECT_PATH], {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect(readFileSync(target, "utf8")).toBe(first);
      expect(second).toContain("already present");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("I.3 — ORCH-1091 cache-bust and the mobile blur style survive P2-1", () => {
    const { dir, out } = runBuild(RAW_MINIFIED);
    try {
      const html = out as string;
      expect(html).toContain(`?v=orch1091`);
      expect(html).toContain(`data-orch1091-js-cache-bust="true"`);
      expect(html.match(/\?v=orch1091/g)).toHaveLength(2); // both bundle tags
      expect(html).toContain(`<style id="mingla-mobile-web-no-blur">`);
      expect(html).toContain("backdrop-filter:none !important");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("I.4 — the emitted inline script parses as a classic script and uses ES5 only", () => {
    expect(() => new Script(SCRIPT_BODY)).not.toThrow();
    for (const modern of ["=>", "let ", "const ", "class ", "async ", "await ", "??", "?.", "**", "..."]) {
      expect(SCRIPT_BODY).not.toContain(modern);
    }
    expect(SCRIPT_BODY).not.toContain("`");
    expect(SCRIPT_BODY).not.toMatch(/\bimport\b|\bexport\b/);
    // It must not be able to terminate its own <script> element early.
    expect(SCRIPT_BODY).not.toContain("</script");
    expect(SCRIPT_BODY).not.toContain("<!--");
  });

  it("I.5 — malformed or missing input fails open and never writes a partial file", () => {
    const noHead = runBuild(`<html><body><div id="root"></div></body></html>`);
    try {
      expect(noHead.out).toBe(`<html><body><div id="root"></div></body></html>`);
      expect(noHead.log).toContain("no </head>");
      expect(noHead.status).toBe(0); // must never break the Vercel build
    } finally {
      rmSync(noHead.dir, { recursive: true, force: true });
    }

    const missing = runBuild(null);
    try {
      expect(missing.out).toBeNull();
      expect(missing.log).toContain("not found");
      expect(missing.status).toBe(0);
    } finally {
      rmSync(missing.dir, { recursive: true, force: true });
    }

    // Truncated HTML: a <head> that opens and never closes must also fail open.
    const truncated = runBuild(`<!DOCTYPE html><html><head><title>t</title>`);
    try {
      expect(truncated.out).toBe(`<!DOCTYPE html><html><head><title>t</title>`);
      expect(truncated.status).toBe(0);
    } finally {
      rmSync(truncated.dir, { recursive: true, force: true });
    }
  });

  it("I.6 — a fresh export always receives the corrected script, whatever else is in <head>", () => {
    const withBlurAlready = RAW_MINIFIED.replace(
      "</head>",
      `<style id="mingla-mobile-web-no-blur">@media (max-width:767px){}</style></head>`,
    );
    const { dir, out } = runBuild(withBlurAlready);
    try {
      const html = out as string;
      expect(html).toContain(`var KEY="${SHARED_KEY}"`);
      expect(html.split(`<style id="mingla-mobile-web-no-blur">`)).toHaveLength(2);
      expect(html).not.toContain("/home?recovered=chunk");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
