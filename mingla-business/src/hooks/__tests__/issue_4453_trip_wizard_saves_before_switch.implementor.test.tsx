/**
 * #4453 (contract section I, rule 6: "unsaved work is saved before a brand
 * switch, or the switch waits and says why") — the trip wizard saves a step
 * only on Continue, Back or Close. Its own top bar carries the brand
 * switcher on desktop, so picking another brand left for that brand's trips
 * with the step being typed unsaved, and no message.
 *
 * The switcher now asks screens that save by themselves to save first
 * (`unsavedWork.flushers`), and the wizard registers the same step save that
 * Close runs. WHAT RUNS: the real useWorkspaceBrandSwitch, the real wizard
 * rule (saveTripWizardBeforeBrandSwitch) on the real trip save queue, and the
 * real wizard source for the wiring.
 *
 * FAILS-ON-REVERT: stop the switch hook running the flushers (read
 * `unsavedWork.screens` only, as before) and "the step is saved, then the
 * switch goes on" finds no save; drop the wizard's registration and the
 * wiring test fails.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/hooks/__tests__/issue_4453_trip_wizard_saves_before_switch.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockReplace = jest.fn();
const mockPick = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ replace: (...a: unknown[]) => mockReplace(...a), push: () => undefined }) }));
jest.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
jest.mock("../usePickBrand", () => ({ usePickBrand: () => (b: unknown) => mockPick(b) }));
jest.mock("../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (sel: (s: { currentBrandId: string | null }) => unknown) => sel({ currentBrandId: "brand-lantern" }),
}));

import { WorkspaceRouteContext } from "../../components/ui/hostShellContext";
import { resetToastStoreForTest, useToastStore } from "../../components/ui/toastStore";
import { unsavedWork } from "../useUnsavedChangesGuard";
import {
  UNSAVED_WORK_HOLDS_SWITCH,
  unsavedWorkHoldsSwitch,
  useWorkspaceBrandSwitch,
  type WorkspaceBrandSwitchOutcome,
} from "../useWorkspaceBrandSwitch";
import type { Brand } from "../../types/brand";
import { saveTripWizardBeforeBrandSwitch } from "../../utils/tripWizardBrandSwitch";

type Renderer = { unmount(): void };
const TestRenderer = require("react-test-renderer") as {
  create(el: React.ReactElement): Renderer;
  act(cb: () => void | Promise<void>): Promise<void>;
};

const TRIP = "a3e4756c-f273-47fc-bf73-2f8432217e3a";
const GAMELAND = { id: "brand-gameland", displayName: "Gameland Lagos", role: "owner" } as unknown as Brand;
let switchTo: ((brand: Brand) => Promise<WorkspaceBrandSwitchOutcome>) | null = null;
const Switcher = (): null => {
  switchTo = useWorkspaceBrandSwitch({ fromBrandId: "brand-lantern" });
  return null;
};
/** What the wizard holds: typed text, and the step save Close runs. */
function wizard(over: Partial<Parameters<typeof saveTripWizardBeforeBrandSwitch>[0]> = {}) {
  const log: string[] = [];
  const session = {
    conflicted: () => false,
    busy: () => false,
    waitForSave: async () => true,
    nothingToSave: () => false,
    save: async () => {
      log.push("saved");
    },
    ...over,
  };
  return { log, flush: (): Promise<boolean> => saveTripWizardBeforeBrandSwitch(session) };
}
async function mount(): Promise<Renderer> {
  let renderer!: Renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      <WorkspaceRouteContext.Provider value={{ pathname: `/trip/${TRIP}/edit`, params: { id: TRIP }, routeBrandId: "brand-lantern", pendingSwitch: { current: null } }}>
        <Switcher />
      </WorkspaceRouteContext.Provider>,
    );
  });
  return renderer;
}
const pick = async (): Promise<WorkspaceBrandSwitchOutcome> => {
  let outcome!: WorkspaceBrandSwitchOutcome;
  await TestRenderer.act(async () => {
    outcome = await switchTo!(GAMELAND);
  });
  return outcome;
};
const toasts = (): string[] => useToastStore.getState().toasts.map((t) => t.message);
const register = (flush: () => Promise<boolean>): void => {
  (unsavedWork.flushers ??= new Set()).add(flush);
};

beforeEach(() => {
  mockReplace.mockClear();
  mockPick.mockClear();
  unsavedWork.screens = 0;
  unsavedWork.flushers = undefined;
  resetToastStoreForTest();
});
afterEach(() => {
  unsavedWork.flushers = undefined;
});

describe("#4453 the trip wizard saves its step before a brand switch", () => {
  test("typed text: the step is saved, then the switch goes on", async () => {
    const w = wizard();
    register(w.flush);
    const r = await mount();
    const outcome = await pick();
    expect(w.log).toEqual(["saved"]);
    expect(outcome).not.toBe("held");
    expect(toasts()).toEqual([]);
    // It left for the other brand only after the save.
    expect(mockReplace).toHaveBeenCalledTimes(1);
    await TestRenderer.act(async () => r.unmount());
  });

  test("the save fails: the switch waits and says why; nothing moves", async () => {
    const w = wizard({
      save: async () => {
        throw new Error("network");
      },
    });
    register(w.flush);
    const r = await mount();
    await expect(pick()).resolves.toBe("held");
    expect(toasts()).toEqual([UNSAVED_WORK_HOLDS_SWITCH]);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPick).not.toHaveBeenCalled();
    await TestRenderer.act(async () => r.unmount());
  });

  test("the trip changed somewhere else: held, and no save is attempted", async () => {
    const w = wizard({ conflicted: () => true });
    register(w.flush);
    const r = await mount();
    await expect(pick()).resolves.toBe("held");
    expect(w.log).toEqual([]);
    expect(mockReplace).not.toHaveBeenCalled();
    await TestRenderer.act(async () => r.unmount());
  });

  test("a save already on the wire is waited for, never joined by a second one beside it", async () => {
    const order: string[] = [];
    let busy = true;
    const w = wizard({
      busy: () => busy,
      waitForSave: async () => {
        order.push("waited");
        busy = false;
        return true;
      },
      save: async () => {
        order.push(busy ? "saved-while-busy" : "saved-after");
      },
    });
    register(w.flush);
    const r = await mount();
    await expect(pick()).resolves.not.toBe("held");
    expect(order).toEqual(["waited", "saved-after"]);
    await TestRenderer.act(async () => r.unmount());

    // ...and if that save did not land, the switch is held.
    const failed = wizard({ busy: () => true, waitForSave: async () => false });
    unsavedWork.flushers = new Set([failed.flush]);
    const r2 = await mount();
    await expect(pick()).resolves.toBe("held");
    expect(failed.log).toEqual([]);
    await TestRenderer.act(async () => r2.unmount());
  });

  test("a new trip nobody typed into has nothing to save: the switch goes straight on", async () => {
    const w = wizard({ nothingToSave: () => true });
    register(w.flush);
    const r = await mount();
    await expect(pick()).resolves.not.toBe("held");
    expect(w.log).toEqual([]);
    expect(toasts()).toEqual([]);
    await TestRenderer.act(async () => r.unmount());
  });

  test("with no wizard open nothing is asked; a screen with unsaved edits still holds outright", async () => {
    await expect(unsavedWorkHoldsSwitch()).resolves.toBe(false);
    const w = wizard();
    register(w.flush);
    unsavedWork.screens = 1;
    await expect(unsavedWorkHoldsSwitch()).resolves.toBe(true);
    // Held by the other screen: the wizard is not asked to save for a switch that will not happen.
    expect(w.log).toEqual([]);
    // A flusher that throws holds, it never lets the switch through.
    unsavedWork.screens = 0;
    unsavedWork.flushers = new Set([async () => Promise.reject(new Error("boom"))]);
    await expect(unsavedWorkHoldsSwitch()).resolves.toBe(true);
  });
});

describe("#4453 the wizard's wiring", () => {
  const src = (require("fs") as typeof import("fs")).readFileSync(
    (require("path") as typeof import("path")).join(__dirname, "../../components/trip/TripCreatorWizard.tsx"),
    "utf8",
  );
  test("it registers one flusher while mounted, and takes it away when it goes", () => {
    expect(src).toMatch(
      /useEffect\(\(\) => \{\s*const flush = \(\): Promise<boolean> => brandSwitchFlushRef\.current\(\);\s*const flushers = \(unsavedWork\.flushers \?\?= new Set\(\)\);\s*flushers\.add\(flush\);\s*return \(\): void => \{\s*flushers\.delete\(flush\);\s*\};\s*\}, \[\]\);/,
    );
  });
  test("the flusher is the step save Close runs, on the one save queue", () => {
    const block = src.slice(src.indexOf("brandSwitchFlushRef.current = "), src.indexOf("useEffect(() => {\n    const flush"));
    expect(block).toContain("saveTripWizardBeforeBrandSwitch({");
    expect(block).toContain("conflicted: () => saveQueue.isConflicted(),");
    expect(block).toContain("busy: () => saveQueue.isBusy(),");
    expect(block).toContain("waitForSave: waitForSaveInFlight,");
    expect(block).toContain("save: autosaveCurrentStep,");
    // Only a new, untouched trip skips the save (as Close reads it).
    expect(block).toMatch(/nothingToSave: \(\) =>\s*isCreateMode &&\s*dirtyTierIdsRef\.current\.size === 0 &&\s*isTripWizardPristine\(/);
  });
});
