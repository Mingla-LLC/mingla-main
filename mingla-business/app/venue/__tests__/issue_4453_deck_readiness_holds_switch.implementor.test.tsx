/**
 * #4453 (contract section I, rule 6) — /venue/deck-readiness knew about
 * unsaved deck changes only through a ref (the leave handle), which
 * re-renders nothing: the brand switcher could not see them, so picking
 * another brand swapped the brand under the form and the changes were gone.
 *
 * WHAT RUNS: the real route, the real useUnsavedChangesGuard counter and the
 * real useWorkspaceBrandSwitch. The deck form itself is a stand-in that
 * reports "changed" the way the real one now does (`onDirtyChange`); the
 * last test reads the real form's source for that report.
 *
 * FAILS-ON-REVERT: remove the `useUnsavedChangesGuard` call (or the
 * `onDirtyChange` hand-off) from the route and "unsaved deck changes hold the
 * switch" resolves without a hold or a toast.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     app/venue/__tests__/issue_4453_deck_readiness_holds_switch.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockReplace = jest.fn();
const mockPick = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ brand_id: "brand-lantern", venue_id: "venue-1", place_pool_id: "pool-1" }),
  useRouter: () => ({ back: jest.fn(), replace: (...a: unknown[]) => mockReplace(...a), canGoBack: () => true }),
  useNavigation: () => ({ addListener: () => () => undefined, dispatch: () => undefined }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../../../src/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" }, isAuthReady: true }) }));
jest.mock("../../../src/hooks/usePickBrand", () => ({ usePickBrand: () => (b: unknown) => mockPick(b) }));
jest.mock("../../../src/store/currentBrandStore", () => ({
  useCurrentBrandStore: (sel: (s: { currentBrandId: string | null }) => unknown) => sel({ currentBrandId: "brand-lantern" }),
}));
jest.mock("../../../src/store/venueSuiteStore", () => ({
  useVenueSuiteStore: (sel: (s: { setSavedFlash: () => void }) => unknown) => sel({ setSavedFlash: () => undefined }),
}));
jest.mock("../../../src/hooks/useVenueListings", () => ({
  useVenueListing: () => ({ data: { id: "venue-1", name: "Lantern Room", venueCategory: "bar", placePoolId: "pool-1" }, isLoading: false }),
}));
jest.mock("../../../src/hooks/useBrandPlacePipelineState", () => ({
  useBrandPlaceAuthoringContext: () => ({
    isLoading: false,
    data: { tier2: {}, pending_ai_outputs: null, coaching: [], gallery_urls: [], cover_media_url: null, cover_media_poster_url: null, cover_media_type: null },
  }),
}));
jest.mock("../../../src/components/ui/IconChrome", () => ({ IconChrome: () => null }));
jest.mock("../../../src/components/ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("../../../src/components/venue/VenueDeckReadinessSetup", () => {
  const R = jest.requireActual("react") as typeof React;
  return { VenueDeckReadinessSetup: (p: Record<string, unknown>) => R.createElement("mock-deck-setup", p) };
});

import { WorkspaceRouteContext } from "../../../src/components/ui/hostShellContext";
import { resetToastStoreForTest, useToastStore } from "../../../src/components/ui/toastStore";
import { unsavedWork } from "../../../src/hooks/useUnsavedChangesGuard";
import {
  UNSAVED_WORK_HOLDS_SWITCH,
  useWorkspaceBrandSwitch,
  type WorkspaceBrandSwitchOutcome,
} from "../../../src/hooks/useWorkspaceBrandSwitch";
import type { Brand } from "../../../src/types/brand";
const DeckReadinessRoute = (require("../deck-readiness") as { default: React.FC }).default;

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
      <WorkspaceRouteContext.Provider value={{ pathname: "/venue/deck-readiness", params: { brand_id: "brand-lantern", venue_id: "venue-1" }, routeBrandId: "brand-lantern", pendingSwitch: { current: null } }}>
        <Switcher />
        <DeckReadinessRoute />
      </WorkspaceRouteContext.Provider>,
    );
  });
  return renderer;
}
const setup = (r: Renderer): Node => r.root.findAll((n) => n.type === "mock-deck-setup")[0]!;
const reportDirty = async (r: Renderer, dirty: boolean): Promise<void> =>
  TestRenderer.act(async () => {
    (setup(r).props.onDirtyChange as (d: boolean) => void)(dirty);
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
  unsavedWork.screens = 0;
  resetToastStoreForTest();
});

describe("#4453 deck readiness holds a brand switch while it has unsaved changes", () => {
  test("unsaved deck changes hold the switch: the message shows and nothing moves", async () => {
    const r = await mount();
    expect(typeof setup(r).props.onDirtyChange).toBe("function");
    await reportDirty(r, true);
    expect(unsavedWork.screens).toBe(1);
    await expect(pick()).resolves.toBe("held");
    expect(toasts()).toEqual([UNSAVED_WORK_HOLDS_SWITCH]);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPick).not.toHaveBeenCalled();
    // The form is still mounted, untouched.
    expect(r.root.findAll((n) => n.type === "mock-deck-setup")).toHaveLength(1);
    await TestRenderer.act(async () => r.unmount());
    expect(unsavedWork.screens).toBe(0);
  });

  test("a clean deck, or one saved or put back, lets the switch through", async () => {
    const r = await mount();
    expect(unsavedWork.screens).toBe(0);
    await expect(pick()).resolves.not.toBe("held");
    await reportDirty(r, true);
    await reportDirty(r, false);
    expect(unsavedWork.screens).toBe(0);
    await expect(pick()).resolves.not.toBe("held");
    expect(toasts()).toEqual([]);
    await TestRenderer.act(async () => r.unmount());
  });

  test("the real deck form reports its own changed-state, and clears it when it goes", () => {
    const src = (require("fs") as typeof import("fs")).readFileSync(
      (require("path") as typeof import("path")).join(__dirname, "../../../src/components/venue/VenueDeckReadinessSetup.tsx"),
      "utf8",
    );
    const effect = /useEffect\(\(\) => \{\s*if \(onDirtyChange === undefined\) return undefined;\s*onDirtyChange\(formDirty\);\s*return \(\): void => onDirtyChange\(false\);\s*\}, \[formDirty, onDirtyChange\]\);/;
    expect(src).toMatch(effect);
    // The same `formDirty` the leave dialog and the Save button read.
    expect(src).toContain("isDirty: () => formDirty,");
    expect(src).toContain("disabled={busy !== null || !formDirty}");
  });
});
