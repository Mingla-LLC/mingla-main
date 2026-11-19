// MINGLA-INVARIANT: I-4453-BRAND-EDIT-HOLDS-THE-SWITCH | issue #4453 | Brand settings (/brand/<id>/edit) with unsaved edits holds a brand switch: the switcher shows its "save first" message, the screen and the brand stay, and the typed text is still there. A clean form, or one whose edits were undone, switches as usual.
/**
 * #4453 (contract section I, rule 6) — on /brand/<id>/edit, typing a tagline
 * and picking another brand opened that brand's form at once: the text was
 * gone, unsaved, with no message.
 *
 * WHAT RUNS: the real BrandEditView (draft, dirty check), the real
 * useUnsavedChangesGuard counter and the real useWorkspaceBrandSwitch, on the
 * route /brand/<Lantern Room>/edit. Sibling chrome is inert stand-ins.
 *
 * FAILS-ON-REVERT: remove the `useUnsavedChangesGuard` call from
 * BrandEditView and "typed text holds the switch" resolves "same-screen" with
 * a route replace and no toast.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/components/brand/__tests__/issue_4453_brand_edit_holds_switch.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import type { Brand } from "../../../types/brand";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mockLeaf(name: string) {
  const ReactLocal = jest.requireActual<typeof React>("react");
  return (props: Record<string, unknown>) =>
    ReactLocal.createElement(name, props, props.children as React.ReactNode);
}
const mockReplace = jest.fn();
const mockPick = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ replace: (...a: unknown[]) => mockReplace(...a), push: () => undefined }) }));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
jest.mock("../../../hooks/usePickBrand", () => ({ usePickBrand: () => (b: unknown) => mockPick(b) }));
jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (sel: (s: { currentBrandId: string | null }) => unknown) => sel({ currentBrandId: "brand-lantern" }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../../../hooks/useSwitchAccount", () => ({
  useSwitchAccount: () => ({ signedInEmail: null, onSwitchAccount: () => undefined }),
}));
jest.mock("../../../constants/publicUrls", () => ({
  brandPublicUrl: (slug: string) => `https://business.example.test/b/${slug}`,
}));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const ReactLocal = jest.requireActual<typeof React>("react");
  return {
    ScrollView: ReactLocal.forwardRef((props: { children?: React.ReactNode }, _ref) =>
      ReactLocal.createElement("mock-scroll", null, props.children)),
  };
});
jest.mock("../../ui/EventCoverMedia", () => ({ EventCoverMedia: mockLeaf("mock-cover") }));
jest.mock("../../ui/Avatar", () => ({ Avatar: mockLeaf("mock-avatar") }));
jest.mock("../../ui/Button", () => ({ Button: mockLeaf("mock-button") }));
jest.mock("../../ui/ConfirmDialog", () => ({ ConfirmDialog: mockLeaf("mock-confirm") }));
jest.mock("../../ui/GlassCard", () => ({ GlassCard: mockLeaf("mock-glass") }));
jest.mock("../../ui/Icon", () => ({ Icon: mockLeaf("mock-icon") }));
jest.mock("../../ui/Toast", () => ({ Toast: mockLeaf("mock-toast") }));
jest.mock("../../ui/TopBar", () => ({ TopBar: mockLeaf("mock-topbar") }));
jest.mock("../../ui/Input", () => ({ Input: mockLeaf("mock-input"), PHONE_COUNTRIES: [] }));
jest.mock("../BrandAvatarPickerSheet", () => ({ BrandAvatarPickerSheet: mockLeaf("mock-avatar-sheet") }));
jest.mock("../../ui/CoverPickerSheet", () => ({ CoverPickerSheet: mockLeaf("mock-cover-sheet") }));
jest.mock("../../theme/ThemeControlRow", () => ({ ThemeControlRow: mockLeaf("mock-theme-row") }));
jest.mock("../../theme/ThemeSheet", () => ({ ThemeSheet: mockLeaf("mock-theme-sheet") }));
jest.mock("../../auth/SignedInNotFoundNotice", () => ({ SignedInNotFoundNotice: mockLeaf("mock-not-found") }));

import type { WorkspaceRoute } from "../workspaceBrandContext";
import { WorkspaceRouteContext } from "../../ui/hostShellContext";
import { resetToastStoreForTest, useToastStore } from "../../ui/toastStore";
import type { PendingBrandSwitchHolder } from "../../../hooks/pendingBrandSwitch";
import { unsavedWork } from "../../../hooks/useUnsavedChangesGuard";
import {
  UNSAVED_WORK_HOLDS_SWITCH,
  useWorkspaceBrandSwitch,
  type WorkspaceBrandSwitchOutcome,
} from "../../../hooks/useWorkspaceBrandSwitch";

type Node = {
  type: unknown;
  props: Record<string, unknown>;
  children: (Node | string)[];
  findAll: (predicate: (node: Node) => boolean) => Node[];
};
type Renderer = { root: Node; unmount: () => void };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { BrandEditView } = require("../BrandEditView") as typeof import("../BrandEditView");

const LANTERN = {
  id: "brand-lantern",
  displayName: "Lantern Room",
  slug: "lantern-room",
  role: "owner",
  stats: { events: 0, rev: 0 },
  currentLiveEvent: null,
  bio: "",
  tagline: "Supper club",
  contact: { email: "hello@lantern.test", phone: "" },
  links: {},
  countryCode: "US",
  coverHue: 25,
} as unknown as Brand;
const GAMELAND = { ...LANTERN, id: "brand-gameland", displayName: "Gameland Lagos", slug: "gameland-lagos" } as Brand;

const PATH = `/brand/${LANTERN.id}/edit`;
const pendingSwitch: PendingBrandSwitchHolder = { current: null };
let switchTo: ((brand: Brand) => Promise<WorkspaceBrandSwitchOutcome>) | null = null;
// The brand switcher's side: the one switch hook, as the menu calls it.
const Switcher = (): null => {
  switchTo = useWorkspaceBrandSwitch({ fromBrandId: LANTERN.id });
  return null;
};

async function mountEdit(): Promise<Renderer> {
  const route: WorkspaceRoute = { pathname: PATH, params: { id: LANTERN.id }, routeBrandId: LANTERN.id, pendingSwitch };
  let renderer!: Renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      <WorkspaceRouteContext.Provider value={route}>
        <Switcher />
        <BrandEditView
          brand={LANTERN}
          accountId="user-1"
          onCancel={() => undefined}
          onSave={async () => undefined}
          onAfterSave={() => undefined}
        />
      </WorkspaceRouteContext.Provider>,
    );
  });
  return renderer;
}
const tagline = (renderer: Renderer): Node =>
  renderer.root.findAll((node) => node.type === "mock-input" && node.props.testID === "brand-tagline")[0]!;
const type = async (renderer: Renderer, text: string): Promise<void> =>
  TestRenderer.act(async () => {
    (tagline(renderer).props.onChangeText as (v: string) => void)(text);
  });
const pick = async (brand: Brand): Promise<WorkspaceBrandSwitchOutcome> => {
  let outcome: WorkspaceBrandSwitchOutcome | null = null;
  await TestRenderer.act(async () => {
    outcome = await (switchTo as NonNullable<typeof switchTo>)(brand);
  });
  return outcome as unknown as WorkspaceBrandSwitchOutcome;
};
const toasts = (): string[] => useToastStore.getState().toasts.map((t) => t.message);

beforeEach(() => {
  mockReplace.mockClear();
  mockPick.mockClear();
  pendingSwitch.current = null;
  unsavedWork.screens = 0;
  resetToastStoreForTest();
});

describe("#4453 brand settings holds a brand switch while it has unsaved edits", () => {
  test("typed text holds the switch: the message shows, nothing moves, the text is still there", async () => {
    const renderer = await mountEdit();
    await type(renderer, "Supper club, now on Fridays");
    await expect(pick(GAMELAND)).resolves.toBe("held");
    expect(toasts()).toEqual([UNSAVED_WORK_HOLDS_SWITCH]);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPick).not.toHaveBeenCalled();
    expect(pendingSwitch.current).toBeNull();
    expect(tagline(renderer).props.value).toBe("Supper club, now on Fridays");
    await TestRenderer.act(async () => renderer.unmount());
  });

  test("a clean form switches to the same screen for the other brand", async () => {
    const renderer = await mountEdit();
    await expect(pick(GAMELAND)).resolves.toBe("same-screen");
    expect(toasts()).toEqual([]);
    expect(mockReplace).toHaveBeenCalledWith(`/brand/${GAMELAND.id}/edit`);
    await TestRenderer.act(async () => renderer.unmount());
  });

  test("undoing the edit, or leaving the screen, lets go of the hold", async () => {
    const renderer = await mountEdit();
    await type(renderer, "Something else");
    expect(unsavedWork.screens).toBe(1);
    await type(renderer, "Supper club");
    expect(unsavedWork.screens).toBe(0);
    await expect(pick(GAMELAND)).resolves.toBe("same-screen");
    await type(renderer, "Something else again");
    expect(unsavedWork.screens).toBe(1);
    await TestRenderer.act(async () => renderer.unmount());
    expect(unsavedWork.screens).toBe(0);
  });
});
