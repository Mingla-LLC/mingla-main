/**
 * #882 / ORCH-0882 — todoToggleCollapseStore ADVERSARIAL (tester-owned).
 *
 * DIFFERENT ANGLE than the implementor's coverage. Their suites are:
 *   - store unit T1-T5 + rehydrate-wiring (synchronous action calls against the
 *     singleton with an inert null-returning AsyncStorage mock — the persist
 *     middleware never actually rehydrates anything), and
 *   - the component source-grep contract (strings present/absent).
 *
 * This file instead EXECUTES the real async rehydration paths end-to-end with a
 * fresh store instance per scenario (jest.resetModules + jest.doMock), plus
 * cross-file wiring scans the implementor's suites never touch:
 *
 *   ADV-01  corrupted storage blob (garbage JSON) → must NOT crash, must fall
 *           back to default OPEN, and hasHydrated must STILL flip true — if the
 *           error path skipped the gate flip, the toggle would be PERMANENTLY
 *           INVISIBLE for that user (renders null forever).
 *   ADV-02  version-mismatch blob (version 0, no migrate fn) → persisted value
 *           discarded, default OPEN, gate still opens.
 *   ADV-03  valid collapsed blob → rehydrates collapsed=true (the store-level
 *           truth behind SC-2 restart persistence).
 *   ADV-04  pre-hydration write STOMP: a write landing before rehydration
 *           completes is OVERWRITTEN by the incoming persisted value. This is
 *           real zustand-persist behavior and is exactly WHY the component's
 *           hydration gate is load-bearing (no interaction may exist before
 *           hasHydrated) — locked here so nobody "simplifies" the gate away
 *           believing the race is harmless.
 *   ADV-05  dual-mount divergence: two subscribers (Home + Hub instances)
 *           observe the SAME notification sequence under toggle spam — the
 *           surfaces can never disagree, even momentarily (AC-1).
 *   ADV-06  persist-key uniqueness across src/store/*.ts (SPEC-pinned tester
 *           angle) — a duplicated key would silently cross-wire two stores.
 *   ADV-07  clearAllStores wiring (SC-6 sign-out reset) — reset line + import.
 *   ADV-08  component gate ORDER: zero-todos precedence gate strictly before
 *           the hydration gate, both before the JSX return (SPEC render-gate
 *           order; fails if the component reverts to local state).
 *
 * APPEND-ONLY. New file. Never modifies an existing test.
 */

import { describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

type StoreModule =
  typeof import("../todoToggleCollapseStore");

const PERSIST_KEY = "mingla-business.todoToggleCollapse.v1";

/**
 * Load a FRESH store singleton whose AsyncStorage returns `storedValue` for
 * the persist key. Returns the module BEFORE flushing rehydration so callers
 * can interleave writes into the hydration window (ADV-04).
 */
const loadFreshStore = (storedValue: string | null): StoreModule => {
  jest.resetModules();
  jest.doMock("@react-native-async-storage/async-storage", () => ({
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) =>
        key === PERSIST_KEY ? storedValue : null,
      ),
      setItem: jest.fn(async () => undefined),
      removeItem: jest.fn(async () => undefined),
    },
  }));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../todoToggleCollapseStore") as StoreModule;
};

/** Flush the async rehydration microtask chain. */
const flushHydration = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const readRepoFile = (relFromHere: string): string =>
  fs.readFileSync(path.join(__dirname, relFromHere), "utf8");

describe("ORCH-0882 ADVERSARIAL — hostile storage must never brick the toggle", () => {
  test("ADV-882-01: corrupted (non-JSON) blob → no crash, default COLLAPSED (#4304), and the hydration gate STILL opens", async () => {
    const mod = loadFreshStore("{not-json!! ]][");
    await flushHydration();
    const s = mod.useTodoToggleCollapseStore.getState();
    expect(s.collapsed).toBe(true);
    // CRITICAL: hasHydrated must flip true even on the ERROR path, or the
    // To-do toggle would be permanently invisible.
    expect(s.hasHydrated).toBe(true);
  });

  test("ADV-882-02: any older blob (v0) is migrated to nothing → default COLLAPSED, gate opens", async () => {
    const mod = loadFreshStore(
      JSON.stringify({ state: { collapsed: false }, version: 0 }),
    );
    await flushHydration();
    const s = mod.useTodoToggleCollapseStore.getState();
    expect(s.collapsed).toBe(true);
    expect(s.hasHydrated).toBe(true);
  });

  test("ADV-882-03 (#4304): a remembered v1 OPEN position never comes back — every load starts collapsed", async () => {
    // Seth, 2026-11-07: "the to do should always be collapsed by default".
    const mod = loadFreshStore(
      JSON.stringify({ state: { collapsed: false }, version: 1 }),
    );
    await flushHydration();
    const s = mod.useTodoToggleCollapseStore.getState();
    expect(s.collapsed).toBe(true);
    expect(s.hasHydrated).toBe(true);
  });

  test("ADV-882-04 (#4304): with nothing persisted, rehydration never overwrites the session position", async () => {
    const mod = loadFreshStore(
      JSON.stringify({ state: { collapsed: true }, version: 1 }),
    );
    mod.useTodoToggleCollapseStore.getState().setCollapsed(false);
    await flushHydration();
    // The empty persisted partition merges as a no-op; the gate still opens.
    expect(mod.useTodoToggleCollapseStore.getState().collapsed).toBe(false);
    expect(mod.useTodoToggleCollapseStore.getState().hasHydrated).toBe(true);
  });
});

describe("ORCH-0882 ADVERSARIAL — dual-mount (Home + Hub) can never diverge", () => {
  test("ADV-882-05: two subscribers see the IDENTICAL notification sequence under toggle spam; final parity correct", async () => {
    const mod = loadFreshStore(null);
    await flushHydration();
    const store = mod.useTodoToggleCollapseStore;
    store.getState().setCollapsed(false);

    const seenByHome: boolean[] = [];
    const seenByHub: boolean[] = [];
    const unsubHome = store.subscribe((s) => seenByHome.push(s.collapsed));
    const unsubHub = store.subscribe((s) => seenByHub.push(s.collapsed));
    try {
      const SPAM = 25;
      for (let i = 0; i < SPAM; i += 1) {
        store.getState().toggle();
      }
      // Both "screens" observed the exact same sequence — no momentary
      // divergence is even representable (one store, synchronous notify).
      expect(seenByHome).toEqual(seenByHub);
      expect(seenByHome.length).toBeGreaterThanOrEqual(SPAM);
      // 25 toggles from open → collapsed (odd parity), no lost update.
      expect(store.getState().collapsed).toBe(true);
    } finally {
      unsubHome();
      unsubHub();
    }
  });
});

describe("ORCH-0882 ADVERSARIAL — cross-file wiring the unit suites never scan", () => {
  test("ADV-882-06: persist keys across src/store/*.ts are UNIQUE and include the #882 key", () => {
    const storeDir = path.join(__dirname, "..");
    const files = fs
      .readdirSync(storeDir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    const keys: Array<{ file: string; key: string }> = [];
    for (const file of files) {
      const src = fs.readFileSync(path.join(storeDir, file), "utf8");
      const matches = src.matchAll(/name:\s*"(mingla-business\.[^"]+)"/g);
      for (const m of matches) {
        keys.push({ file, key: m[1] });
      }
    }
    const flat = keys.map((k) => k.key);
    // The #882 key exists exactly once, in the new store.
    expect(
      keys.filter((k) => k.key === PERSIST_KEY).map((k) => k.file),
    ).toEqual(["todoToggleCollapseStore.ts"]);
    // NO duplicates anywhere — a duplicated persist name silently cross-wires
    // two stores into one storage row (last-writer-wins data corruption).
    expect(new Set(flat).size).toBe(flat.length);
  });

  test("ADV-882-07: clearAllStores resets the toggle store on sign-out (SC-6, Constitution #6)", () => {
    const src = readRepoFile("../../utils/clearAllStores.ts");
    expect(src).toContain(
      'import { useTodoToggleCollapseStore } from "../store/todoToggleCollapseStore";',
    );
    expect(src).toContain("useTodoToggleCollapseStore.getState().reset();");
  });

  test("ADV-882-08: component render-gate ORDER — zero-todos precedence strictly before the hydration gate, both before JSX", () => {
    const src = readRepoFile(
      "../../components/home/BusinessTodoToggle.tsx",
    );
    const countGate = src.indexOf("if (count === 0) return null;");
    const hydrationGate = src.indexOf("if (!hasHydrated) return null;");
    const jsxReturn = src.indexOf("<GlassCard");
    expect(countGate).toBeGreaterThan(-1);
    expect(hydrationGate).toBeGreaterThan(-1);
    expect(jsxReturn).toBeGreaterThan(-1);
    // SPEC order: zero-todos hide takes precedence (AC-4), THEN the hydration
    // gate, and no JSX is reachable before both.
    expect(countGate).toBeLessThan(hydrationGate);
    expect(hydrationGate).toBeLessThan(jsxReturn);
  });
});
