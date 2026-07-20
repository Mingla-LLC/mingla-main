/**
 * #882 — todoToggleCollapseStore behavioural tests (SPEC T1-T5).
 *
 * Exercises the persisted To-Do-toggle position store's actions + the
 * hydration-gate contract (Constitution #14) + the logout reset
 * (Constitution #6) + persist-identity honesty (the cold-start-gate-lie
 * angle from the ORCH-1143 adversarial suite: `hasHydrated` must NEVER be
 * persisted). Mirrors `liveSectionCollapseStore.test.ts`. AsyncStorage is
 * mocked so the persist middleware is inert under node/ts-jest.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

import { useTodoToggleCollapseStore } from "../todoToggleCollapseStore";

type PersistApi = {
  persist: {
    getOptions: () => {
      name?: string;
      version?: number;
      partialize?: (s: Record<string, unknown>) => Record<string, unknown>;
      onRehydrateStorage?: () => (
        state?: unknown,
        error?: unknown,
      ) => void;
    };
  };
};

const persistApi = (useTodoToggleCollapseStore as unknown as PersistApi)
  .persist;

beforeEach(() => {
  // Known baseline for every test: default position, gate closed. hasHydrated
  // is a separate unpersisted flag — set it back to false explicitly.
  useTodoToggleCollapseStore.getState().reset();
  useTodoToggleCollapseStore.getState().setHasHydrated(false);
});

describe("todoToggleCollapseStore", () => {
  test("T1 defaults: collapsed=false (open) and hasHydrated=false until rehydration", () => {
    const s = useTodoToggleCollapseStore.getState();
    // collapsed defaults to false → the To-Do toggle is OPEN on first load
    // (AC-5 / SC-5: fresh install with no persisted key renders open).
    expect(s.collapsed).toBe(false);
    // The in-memory initializer default for the gate is false — the toggle
    // renders NOTHING until onRehydrateStorage flips it (Constitution #14).
    expect(s.hasHydrated).toBe(false);
  });

  test("T2 toggle flips collapsed; setCollapsed sets it explicitly", () => {
    useTodoToggleCollapseStore.getState().toggle();
    expect(useTodoToggleCollapseStore.getState().collapsed).toBe(true);
    useTodoToggleCollapseStore.getState().toggle();
    expect(useTodoToggleCollapseStore.getState().collapsed).toBe(false);
    useTodoToggleCollapseStore.getState().setCollapsed(true);
    expect(useTodoToggleCollapseStore.getState().collapsed).toBe(true);
  });

  test("T3 partialize honesty: persisted partition is exactly { collapsed } — never hasHydrated", () => {
    const partialized = persistApi.getOptions().partialize?.({
      collapsed: true,
      hasHydrated: true,
    });
    expect(partialized).toEqual({ collapsed: true });
    expect(Object.keys(partialized ?? {})).not.toContain("hasHydrated");
  });

  test("T4 persist identity: name mingla-business.todoToggleCollapse.v1, version 1", () => {
    const options = persistApi.getOptions();
    expect(options.name).toBe("mingla-business.todoToggleCollapse.v1");
    expect(options.version).toBe(1);
  });

  test("T5 reset returns collapsed to the default (open) — logout cascade (Constitution #6)", () => {
    useTodoToggleCollapseStore.getState().setCollapsed(true);
    useTodoToggleCollapseStore.getState().reset();
    expect(useTodoToggleCollapseStore.getState().collapsed).toBe(false);
  });

  test("onRehydrateStorage wires setHasHydrated(true) without touching collapsed", () => {
    useTodoToggleCollapseStore.getState().setCollapsed(true);
    expect(useTodoToggleCollapseStore.getState().hasHydrated).toBe(false);
    // Invoke the persist option exactly as the middleware does post-rehydrate.
    const postRehydrate = persistApi.getOptions().onRehydrateStorage?.();
    postRehydrate?.(undefined, undefined);
    const s = useTodoToggleCollapseStore.getState();
    expect(s.hasHydrated).toBe(true);
    expect(s.collapsed).toBe(true);
  });
});
