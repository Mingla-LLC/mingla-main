/**
 * #4453 (contract section I, rule 6) — /event/<id>/dates kept "this date has
 * typed edits" in a ref, which re-renders nothing: picking another brand left
 * the screen and the typed title or place was gone, with no message.
 *
 * WHAT RUNS: the real route (it reads its dates, holds the drafts and saves a
 * row), the real useUnsavedChangesGuard counter and the real
 * useWorkspaceBrandSwitch. The database is played by the test.
 *
 * FAILS-ON-REVERT: remove the `useUnsavedChangesGuard` call from the route
 * and "a typed title holds the switch" resolves without a hold or a toast.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     "app/event/\[id\]/__tests__/issue_4453_dates_hold_switch.implementor.test.tsx"
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EVENT = "a3e4756c-f273-47fc-bf73-2f8432217e3a";
const FUTURE = new Date(Date.now() + 30 * 86_400_000).toISOString();
const mockRows = [
  { id: "d1", start_at: FUTURE, end_at: FUTURE, timezone: "UTC", override_title: "Opening night", override_location: null, status: "scheduled" },
  { id: "d2", start_at: FUTURE, end_at: FUTURE, timezone: "UTC", override_title: null, override_location: null, status: "scheduled" },
];
const mockReplace = jest.fn();
const mockPick = jest.fn();
const mockRpc = jest.fn(async (_name: string, _args: unknown) => ({ data: null, error: null }));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "a3e4756c-f273-47fc-bf73-2f8432217e3a" }),
  useRouter: () => ({ back: jest.fn(), replace: (...a: unknown[]) => mockReplace(...a), canGoBack: () => true }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../../../../src/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
jest.mock("../../../../src/hooks/usePickBrand", () => ({ usePickBrand: () => (b: unknown) => mockPick(b) }));
jest.mock("../../../../src/store/currentBrandStore", () => ({
  useCurrentBrandStore: (sel: (s: { currentBrandId: string | null }) => unknown) => sel({ currentBrandId: "brand-lantern" }),
}));
jest.mock("../../../../src/services/supabase", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: mockRows, error: null }) }) }) }),
    rpc: (name: string, args: unknown) => mockRpc(name, args),
  },
}));
jest.mock("../../../../src/wrappers/SmartScrollView", () => {
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return { ScrollView: RN.ScrollView };
});
jest.mock("../../../../src/components/ui/TopBar", () => ({ TopBar: () => null }));
jest.mock("../../../../src/components/ui/Toast", () => ({ Toast: () => null }));
jest.mock("../../../../src/components/ui/Button", () => {
  const R = jest.requireActual("react") as typeof React;
  return { Button: (p: Record<string, unknown>) => R.createElement("mock-button", p) };
});

import { TextInput } from "react-native";
import { WorkspaceRouteContext } from "../../../../src/components/ui/hostShellContext";
import { resetToastStoreForTest, useToastStore } from "../../../../src/components/ui/toastStore";
import { unsavedWork } from "../../../../src/hooks/useUnsavedChangesGuard";
import {
  UNSAVED_WORK_HOLDS_SWITCH,
  useWorkspaceBrandSwitch,
  type WorkspaceBrandSwitchOutcome,
} from "../../../../src/hooks/useWorkspaceBrandSwitch";
import type { Brand } from "../../../../src/types/brand";
const dates = require("../dates") as typeof import("../dates");
const EventDatesScreen = dates.default;

interface Node { type: unknown; props: Record<string, unknown>; findAll(p: (n: Node) => boolean): Node[] }
type Renderer = { root: Node; unmount(): void };
const TestRenderer = require("react-test-renderer") as {
  create(el: React.ReactElement): Renderer;
  act(cb: () => void | Promise<void>): Promise<void>;
};

const GAMELAND = { id: "brand-gameland", displayName: "Gameland Lagos", role: "owner" } as unknown as Brand;
let switchTo: ((brand: Brand) => Promise<WorkspaceBrandSwitchOutcome>) | null = null;
const Switcher = (): null => {
  switchTo = useWorkspaceBrandSwitch({ fromBrandId: "brand-lantern" });
  return null;
};
async function mount(): Promise<Renderer> {
  let renderer!: Renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      <WorkspaceRouteContext.Provider value={{ pathname: `/event/${EVENT}/dates`, params: { id: EVENT }, routeBrandId: "brand-lantern", pendingSwitch: { current: null } }}>
        <Switcher />
        <EventDatesScreen />
      </WorkspaceRouteContext.Provider>,
    );
  });
  // The dates read answers.
  await TestRenderer.act(async () => {
    await Promise.resolve();
  });
  return renderer;
}
/** The title boxes, one per date, in order. */
const titles = (r: Renderer): Node[] =>
  r.root.findAll((n) => n.type === TextInput && n.props.placeholder === "Inherits event title");
const typeTitle = async (r: Renderer, row: number, text: string): Promise<void> =>
  TestRenderer.act(async () => {
    (titles(r)[row]!.props.onChangeText as (v: string) => void)(text);
  });
const pick = async (): Promise<WorkspaceBrandSwitchOutcome> => {
  let outcome!: WorkspaceBrandSwitchOutcome;
  await TestRenderer.act(async () => {
    outcome = await switchTo!(GAMELAND);
  });
  return outcome;
};
const toasts = (): string[] => useToastStore.getState().toasts.map((t) => t.message);

beforeEach(() => {
  mockReplace.mockClear();
  mockPick.mockClear();
  mockRpc.mockClear();
  unsavedWork.screens = 0;
  resetToastStoreForTest();
});

describe("#4453 the event's dates hold a brand switch while a date has unsaved edits", () => {
  test("a typed title holds the switch: the message shows, nothing moves, the text is still there", async () => {
    const r = await mount();
    expect(titles(r)).toHaveLength(2);
    await typeTitle(r, 1, "Closing party");
    expect(unsavedWork.screens).toBe(1);
    await expect(pick()).resolves.toBe("held");
    expect(toasts()).toEqual([UNSAVED_WORK_HOLDS_SWITCH]);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPick).not.toHaveBeenCalled();
    expect(titles(r)[1]!.props.value).toBe("Closing party");
    await TestRenderer.act(async () => r.unmount());
    expect(unsavedWork.screens).toBe(0);
  });

  test("as loaded, or with the edit typed back out, the switch goes through", async () => {
    const r = await mount();
    expect(unsavedWork.screens).toBe(0);
    await typeTitle(r, 0, "Opening night!");
    expect(unsavedWork.screens).toBe(1);
    await typeTitle(r, 0, "Opening night");
    expect(unsavedWork.screens).toBe(0);
    await expect(pick()).resolves.not.toBe("held");
    expect(toasts()).toEqual([]);
    await TestRenderer.act(async () => r.unmount());
  });

  test("saving the date lets go of the hold", async () => {
    const r = await mount();
    await typeTitle(r, 1, "Closing party");
    expect(unsavedWork.screens).toBe(1);
    const save = r.root.findAll((n) => n.type === "mock-button" && n.props.label === "Save")[1]!;
    await TestRenderer.act(async () => {
      (save.props.onPress as () => void)();
      await Promise.resolve();
    });
    expect(mockRpc).toHaveBeenCalledWith("business_set_event_date_override", expect.objectContaining({ p_event_date_id: "d2", p_title: "Closing party" }));
    expect(unsavedWork.screens).toBe(0);
    await expect(pick()).resolves.not.toBe("held");
    await TestRenderer.act(async () => r.unmount());
  });

  test("the rule itself: compared with what is saved, trimmed as a save stores it", () => {
    const rows = [{ id: "d1", override_title: "Opening night", override_location: null }];
    expect(dates.hasUnsavedDateEdits(rows, {})).toBe(false);
    expect(dates.hasUnsavedDateEdits(rows, { d1: { title: "Opening night", location: "" } })).toBe(false);
    expect(dates.hasUnsavedDateEdits(rows, { d1: { title: "Opening night ", location: " " } })).toBe(false);
    expect(dates.hasUnsavedDateEdits(rows, { d1: { title: "", location: "" } })).toBe(true);
    expect(dates.hasUnsavedDateEdits(rows, { d1: { title: "Opening night", location: "The Shrine" } })).toBe(true);
    // A draft for a date that is no longer listed holds nothing.
    expect(dates.hasUnsavedDateEdits(rows, { gone: { title: "x", location: "" } })).toBe(false);
  });
});
