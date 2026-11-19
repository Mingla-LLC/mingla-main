/**
 * #4453 (contract section I, rule 6) — /brand/<id>/creators/brief ("Hire a
 * creator") kept no copy of the brief as it opened, so nothing could tell a
 * brief with writing in it from an untouched one: picking another brand
 * opened that brand's empty brief and this one was lost without a word.
 *
 * WHAT RUNS: the real brief screen (its load, form state and changed check),
 * the real useUnsavedChangesGuard counter and the real
 * useWorkspaceBrandSwitch. The kit's controls are plain stand-ins.
 *
 * FAILS-ON-REVERT: remove the `useUnsavedChangesGuard` call from the screen
 * and "a typed title holds the switch" resolves without a hold or a toast.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/components/creators/screens/__tests__/issue_4453_gig_brief_holds_switch.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mockLeaf(name: string) {
  const R = jest.requireActual<typeof React>("react");
  return (props: Record<string, unknown>) => R.createElement(name, props, props.children as React.ReactNode);
}
const mockReplace = jest.fn();
const mockPick = jest.fn();
let mockParams: Record<string, string> = { listingKind: "event", listingId: "event-1" };
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: jest.fn(), replace: (...a: unknown[]) => mockReplace(...a), canGoBack: () => true }),
}));
jest.mock("../../../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
jest.mock("../../../../hooks/usePickBrand", () => ({ usePickBrand: () => (b: unknown) => mockPick(b) }));
jest.mock("../../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (sel: (s: { currentBrandId: string | null }) => unknown) => sel({ currentBrandId: "brand-lantern" }),
}));
jest.mock("../../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: false }) }));
jest.mock("../../../programs/useProgramParams", () => ({
  useProgramParams: () => ({
    brandId: "brand-lantern",
    params: mockParams,
    brand: { id: "brand-lantern", displayName: "Lantern Room", slug: "lantern-room" },
    currency: "USD",
  }),
}));
jest.mock("../../../programs/ProgramKit", () => ({
  Chip: mockLeaf("mock-chip"),
  FieldError: mockLeaf("mock-field-error"),
  ListGroup: mockLeaf("mock-list-group"),
  ListRow: mockLeaf("mock-list-row"),
  Muted: mockLeaf("mock-muted"),
  ProgramLoading: mockLeaf("mock-loading"),
  ProgramScreen: mockLeaf("mock-program-screen"),
  SectionLabel: mockLeaf("mock-section-label"),
  Segmented: mockLeaf("mock-segmented"),
  SheetBody: mockLeaf("mock-sheet-body"),
}));
jest.mock("../../../programs/ProgramSheet", () => ({ ProgramSheet: () => null }));
jest.mock("../../../programs/TimeField", () => ({ TimeField: mockLeaf("mock-time") }));
jest.mock("../../../ui/Button", () => ({ Button: mockLeaf("mock-button") }));
jest.mock("../../../ui/Stepper", () => ({ Stepper: mockLeaf("mock-stepper") }));
jest.mock("../../../ui/DateField", () => ({ DateField: mockLeaf("mock-date") }));
jest.mock("../../../ui/NumberStepper", () => ({ NumberStepper: mockLeaf("mock-number") }));
jest.mock("../../../ui/Input", () => ({ Input: mockLeaf("mock-input") }));
jest.mock("../../../marketing/marketingSubNavTabs", () => ({ blastHubHref: () => "/(tabs)/marketing/creators" }));
jest.mock("../../../../services/creatorGigsService", () => ({
  creatorGigsService: { hostHome: async () => ({ gigs: [] }), saveGig: jest.fn() },
  fetchGigCities: async () => [{ id: "city-lagos", name: "Lagos", country: "Nigeria" }],
}));
jest.mock("../../../../services/promoteListingService", () => ({
  fetchPromoteListing: async () => ({ kind: "event", title: "Rooftop night", startDay: "2027-01-10", cityName: "Lagos" }),
  matchCity: (cities: { id: string; name: string }[], name: string | null) => cities.find((c) => c.name === name) ?? null,
}));

import { TextInput } from "react-native";
import { WorkspaceRouteContext } from "../../../ui/hostShellContext";
import { resetToastStoreForTest, useToastStore } from "../../../ui/toastStore";
import { unsavedWork } from "../../../../hooks/useUnsavedChangesGuard";
import {
  UNSAVED_WORK_HOLDS_SWITCH,
  useWorkspaceBrandSwitch,
  type WorkspaceBrandSwitchOutcome,
} from "../../../../hooks/useWorkspaceBrandSwitch";
import type { Brand } from "../../../../types/brand";
import { emptyBrief } from "../../../programs/gigBrief";
const brief = require("../GigBriefEditorScreen") as typeof import("../GigBriefEditorScreen");
const GigBriefEditor = brief.default;

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
      <WorkspaceRouteContext.Provider value={{ pathname: "/brand/brand-lantern/creators/brief", params: { id: "brand-lantern" }, routeBrandId: "brand-lantern", pendingSwitch: { current: null } }}>
        <Switcher />
        <GigBriefEditor />
      </WorkspaceRouteContext.Provider>,
    );
  });
  // The cities and the listing answer, then the form is ready.
  for (let i = 0; i < 20 && renderer.root.findAll((n) => n.type === "mock-input").length === 0; i += 1) {
    await TestRenderer.act(async () => {
      await Promise.resolve();
    });
  }
  return renderer;
}
const title = (r: Renderer): Node => r.root.findAll((n) => n.type === "mock-input" && n.props.accessibilityLabel === "Gig title")[0]!;
const publicBrief = (r: Renderer): Node => r.root.findAll((n) => n.type === TextInput && n.props.accessibilityLabel === "Public brief")[0]!;
const typeInto = async (node: Node, text: string): Promise<void> =>
  TestRenderer.act(async () => {
    (node.props.onChangeText as (v: string) => void)(text);
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
  mockParams = { listingKind: "event", listingId: "event-1" };
  unsavedWork.screens = 0;
  resetToastStoreForTest();
});

describe("#4453 the gig brief holds a brand switch while it has unsaved writing", () => {
  test("a typed title holds the switch: the message shows, nothing moves, the text is still there", async () => {
    const r = await mount();
    expect(unsavedWork.screens).toBe(0);
    await typeInto(title(r), "Rooftop night out");
    expect(unsavedWork.screens).toBe(1);
    await expect(pick()).resolves.toBe("held");
    expect(toasts()).toEqual([UNSAVED_WORK_HOLDS_SWITCH]);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPick).not.toHaveBeenCalled();
    expect(title(r).props.value).toBe("Rooftop night out");
    await TestRenderer.act(async () => r.unmount());
    expect(unsavedWork.screens).toBe(0);
  });

  test("the brief boxes count too, and writing typed back out does not", async () => {
    const r = await mount();
    await typeInto(publicBrief(r), "Film the rooftop at golden hour.");
    expect(unsavedWork.screens).toBe(1);
    await expect(pick()).resolves.toBe("held");
    await typeInto(publicBrief(r), "");
    expect(unsavedWork.screens).toBe(0);
    resetToastStoreForTest();
    await expect(pick()).resolves.not.toBe("held");
    expect(toasts()).toEqual([]);
    await TestRenderer.act(async () => r.unmount());
  });

  test("a brief just opened (its city already filled from the listing) counts as untouched", async () => {
    const r = await mount();
    expect(unsavedWork.screens).toBe(0);
    await expect(pick()).resolves.not.toBe("held");
    expect(toasts()).toEqual([]);
    await TestRenderer.act(async () => r.unmount());
  });

  test("the rule itself: compared with the brief as it opened; nothing opened, nothing changed", () => {
    const opened = emptyBrief();
    expect(brief.briefChanged(opened, null)).toBe(false);
    expect(brief.briefChanged({ ...opened }, opened)).toBe(false);
    expect(brief.briefChanged({ ...opened, title: "x" }, opened)).toBe(true);
    expect(brief.briefChanged({ ...opened, platforms: [...opened.platforms].reverse() }, opened)).toBe(opened.platforms.length > 1);
  });
});
