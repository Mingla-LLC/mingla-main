/**
 * #4453 (contract section I, rule 6) — /brand/<id>/tap-to-pay/address had no
 * idea whether anything had been entered: picking another brand opened that
 * brand's empty form and the address being typed was gone, with no message.
 *
 * WHAT RUNS: the real route, the real useUnsavedChangesGuard counter and the
 * real useWorkspaceBrandSwitch. The Google address box is a stand-in that
 * hands its text and its pick to the route.
 *
 * FAILS-ON-REVERT: remove the `useUnsavedChangesGuard` call from the route
 * and "a typed search holds the switch" resolves without a hold or a toast.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     "app/brand/\[id\]/__tests__/issue_4453_tap_address_holds_switch.implementor.test.tsx"
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockReplace = jest.fn();
const mockPick = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "brand-lantern" }),
  useRouter: () => ({ back: jest.fn(), replace: (...a: unknown[]) => mockReplace(...a), canGoBack: () => true }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../../../../src/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
jest.mock("../../../../src/hooks/usePickBrand", () => ({ usePickBrand: () => (b: unknown) => mockPick(b) }));
jest.mock("../../../../src/store/currentBrandStore", () => ({
  useCurrentBrandStore: (sel: (s: { currentBrandId: string | null }) => unknown) => sel({ currentBrandId: "brand-lantern" }),
}));
jest.mock("../../../../src/wrappers/SmartScrollView", () => {
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return { ScrollView: RN.ScrollView, DONE_BAR_OCCUPIED: 53 };
});
jest.mock("../../../../src/components/location/AddressInput", () => {
  const R = jest.requireActual("react") as typeof React;
  return { AddressInput: (p: Record<string, unknown>) => R.createElement("mock-address-input", p) };
});
jest.mock("../../../../src/components/ui/Button", () => {
  const R = jest.requireActual("react") as typeof React;
  return { Button: (p: Record<string, unknown>) => R.createElement("mock-button", p) };
});
jest.mock("../../../../src/components/ui/CenteredState", () => ({ CenteredState: () => null }));
jest.mock("../../../../src/hooks/useBrandSetupChecklist", () => ({
  useBrandSetupChecklist: () => ({ data: { facts: { payoutCountry: "US" } }, isLoading: false, isError: false }),
}));
jest.mock("../../../../src/hooks/useSetTapLocationAddress", () => ({
  useSetTapLocationAddress: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("../../../../src/lib/netinfoSafe", () => ({ useNetInfoSafe: () => ({ isConnected: true }) }));

import { WorkspaceRouteContext } from "../../../../src/components/ui/hostShellContext";
import { resetToastStoreForTest, useToastStore } from "../../../../src/components/ui/toastStore";
import { unsavedWork } from "../../../../src/hooks/useUnsavedChangesGuard";
import {
  UNSAVED_WORK_HOLDS_SWITCH,
  useWorkspaceBrandSwitch,
  type WorkspaceBrandSwitchOutcome,
} from "../../../../src/hooks/useWorkspaceBrandSwitch";
import type { Brand } from "../../../../src/types/brand";
const TapAddressRoute = (require("../tap-to-pay/address") as { default: React.FC }).default;

interface Node { type: unknown; props: Record<string, unknown>; findAll(p: (n: Node) => boolean): Node[] }
type Renderer = { root: Node; unmount(): void };
const TestRenderer = require("react-test-renderer") as {
  create(el: React.ReactElement): Renderer;
  act(cb: () => void | Promise<void>): Promise<void>;
};

const GAMELAND = { id: "brand-gameland", displayName: "Gameland Lagos", role: "owner" } as unknown as Brand;
const PATH = "/brand/brand-lantern/tap-to-pay/address";
let switchTo: ((brand: Brand) => Promise<WorkspaceBrandSwitchOutcome>) | null = null;
const Switcher = (): null => {
  switchTo = useWorkspaceBrandSwitch({ fromBrandId: "brand-lantern" });
  return null;
};
async function mount(): Promise<Renderer> {
  let renderer!: Renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      <WorkspaceRouteContext.Provider value={{ pathname: PATH, params: { id: "brand-lantern" }, routeBrandId: "brand-lantern", pendingSwitch: { current: null } }}>
        <Switcher />
        <TapAddressRoute />
      </WorkspaceRouteContext.Provider>,
    );
  });
  return renderer;
}
const search = (r: Renderer): Node => r.root.findAll((n) => n.type === "mock-address-input")[0]!;
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

describe("#4453 the card-payments address holds a brand switch while it is being entered", () => {
  test("a typed search holds the switch: the message shows, nothing moves, the text is still there", async () => {
    const r = await mount();
    await TestRenderer.act(async () => {
      (search(r).props.onChangeText as (v: string) => void)("12 Marina Rd");
    });
    expect(unsavedWork.screens).toBe(1);
    await expect(pick()).resolves.toBe("held");
    expect(toasts()).toEqual([UNSAVED_WORK_HOLDS_SWITCH]);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPick).not.toHaveBeenCalled();
    expect(search(r).props.value).toBe("12 Marina Rd");
    await TestRenderer.act(async () => r.unmount());
    expect(unsavedWork.screens).toBe(0);
  });

  test("a picked address (shown back, waiting for Save) holds it too", async () => {
    const r = await mount();
    await TestRenderer.act(async () => {
      (search(r).props.onPick as (d: Record<string, unknown>, label: string) => void)(
        { line1: "12 Marina Rd", postalCode: "10001", city: "New York", regionCode: "NY", countryCode: "US", formattedAddress: "12 Marina Rd, New York" },
        "12 Marina Rd",
      );
    });
    expect(unsavedWork.screens).toBe(1);
    await expect(pick()).resolves.toBe("held");
    await TestRenderer.act(async () => r.unmount());
  });

  test("an untouched form, or one cleared again, lets the switch through", async () => {
    const r = await mount();
    expect(unsavedWork.screens).toBe(0);
    await TestRenderer.act(async () => {
      (search(r).props.onChangeText as (v: string) => void)("12");
    });
    await TestRenderer.act(async () => {
      (search(r).props.onChangeText as (v: string) => void)("");
    });
    expect(unsavedWork.screens).toBe(0);
    await expect(pick()).resolves.not.toBe("held");
    expect(toasts()).toEqual([]);
    await TestRenderer.act(async () => r.unmount());
  });
});
