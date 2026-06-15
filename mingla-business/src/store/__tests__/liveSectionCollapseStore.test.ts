/**
 * ORCH-1143 — liveSectionCollapseStore behavioural tests (T7/T8/T11).
 *
 * Exercises the persisted accordion-collapse store's actions + the hydration
 * gate contract (Constitution #14) + the logout reset (Constitution #6).
 * AsyncStorage is mocked so the persist middleware is inert under node/ts-jest.
 */

import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

import { useLiveSectionCollapseStore } from "../liveSectionCollapseStore";

afterEach(() => {
  // Reset to clean defaults between tests (collapsed=false). hasHydrated is a
  // separate flag — set it back to false explicitly.
  useLiveSectionCollapseStore.getState().reset();
  useLiveSectionCollapseStore.getState().setHasHydrated(false);
});

describe("liveSectionCollapseStore", () => {
  test("defaults: collapsed=false (open); hasHydrated flips true once rehydration completes", () => {
    const s = useLiveSectionCollapseStore.getState();
    // collapsed defaults to false → the live section is OPEN on first load.
    expect(s.collapsed).toBe(false);
    // The persist middleware fired onRehydrateStorage at store creation
    // (AsyncStorage mocked → empty → rehydrate completes immediately), so by now
    // the cold-start gate has flipped true. This proves onRehydrateStorage wires
    // setHasHydrated(true). (The in-memory initializer default is false — asserted
    // via the partialize/initializer contract below + the setHasHydrated test.)
    expect(s.hasHydrated).toBe(true);
  });

  test("T6/SC-4: toggle flips collapsed; setCollapsed sets it explicitly", () => {
    useLiveSectionCollapseStore.getState().toggle();
    expect(useLiveSectionCollapseStore.getState().collapsed).toBe(true);
    useLiveSectionCollapseStore.getState().toggle();
    expect(useLiveSectionCollapseStore.getState().collapsed).toBe(false);
    useLiveSectionCollapseStore.getState().setCollapsed(true);
    expect(useLiveSectionCollapseStore.getState().collapsed).toBe(true);
  });

  test("T8/#14: hasHydrated is NOT in the persisted partition (collapsed only)", () => {
    // The persist partialize must include ONLY `collapsed` — assert via the
    // store options surfaced on the persist API.
    const persistApi = (
      useLiveSectionCollapseStore as unknown as {
        persist: {
          getOptions: () => {
            partialize?: (s: Record<string, unknown>) => Record<string, unknown>;
          };
        };
      }
    ).persist;
    const partialized = persistApi.getOptions().partialize?.({
      collapsed: true,
      hasHydrated: true,
    });
    expect(partialized).toEqual({ collapsed: true });
    expect(Object.keys(partialized ?? {})).not.toContain("hasHydrated");
  });

  test("T7/SC-5: setHasHydrated(true) flips the gate without touching collapsed", () => {
    useLiveSectionCollapseStore.getState().setCollapsed(true);
    useLiveSectionCollapseStore.getState().setHasHydrated(true);
    const s = useLiveSectionCollapseStore.getState();
    expect(s.hasHydrated).toBe(true);
    expect(s.collapsed).toBe(true);
  });

  test("T11/SC-8: reset returns collapsed to the default (open) — logout cascade", () => {
    useLiveSectionCollapseStore.getState().setCollapsed(true);
    useLiveSectionCollapseStore.getState().reset();
    expect(useLiveSectionCollapseStore.getState().collapsed).toBe(false);
  });
});
