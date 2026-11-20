/**
 * #4453 (contract section I, rule 6) — Website › Addresses: a domain typed
 * into "Connect a domain you own" and not yet added was dropped by a brand
 * switch from the workspace bar, with no message.
 *
 * WHAT RUNS: the real AddressesSection, the real useUnsavedChangesGuard
 * counter and the real useWorkspaceBrandSwitch.
 *
 * FAILS-ON-REVERT: remove the `useUnsavedChangesGuard` call from
 * AddressesSection and "a typed domain holds the switch" is not held.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/components/sites/website/__tests__/issue_4453_address_holds_switch.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockReplace = jest.fn();
const mockPick = jest.fn();
jest.mock("../WebsiteIcon", () => ({ WebsiteIcon: () => null }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: (...a: unknown[]) => mockReplace(...a), back: jest.fn(), canGoBack: () => true }) }));
jest.mock("../../../ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("../../../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
jest.mock("../../../../hooks/usePickBrand", () => ({ usePickBrand: () => (b: unknown) => mockPick(b) }));
jest.mock("../../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (sel: (s: { currentBrandId: string | null }) => unknown) => sel({ currentBrandId: "brand-lantern" }),
}));
jest.mock("../../../../hooks/useBrandSite", () => ({
  useBrandSiteDomains: () => ({
    isLoading: false, isError: false, refetch: jest.fn(),
    data: {
      site_id: "s", can_manage: true, max_custom_domains: 4,
      hosts: [{ id: "h1", hostname: "lantern.sites.usemingla.com", kind: "mingla_subdomain", status: "active", is_primary: true, is_apex: false, apex: null, dns_state: "ok", tls_state: "issued", records: [], registrar: null, mx_missing: false, misconfigured_since: null, redirect_until: null, last_checked_at: null, activated_at: null, created_at: "2026-10-01T00:00:00Z" }],
    },
  }),
  useAttachBrandSiteDomain: () => ({ mutate: jest.fn(), isPending: false }),
  useCheckBrandSiteDomain: () => ({ mutate: jest.fn(), isPending: false }),
  useSetPrimaryBrandSiteDomain: () => ({ mutate: jest.fn(), isPending: false }),
  useDetachBrandSiteDomain: () => ({ mutate: jest.fn(), isPending: false }),
}));

import { TextInput } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WebsiteProvider, type WebsiteContextValue } from "../WebsiteContext";
import { AddressesSection } from "../sections/AddressesSection";
import { WorkspaceRouteContext } from "../../../ui/hostShellContext";
import { resetToastStoreForTest, useToastStore } from "../../../ui/toastStore";
import { unsavedWork } from "../../../../hooks/useUnsavedChangesGuard";
import {
  UNSAVED_WORK_HOLDS_SWITCH,
  useWorkspaceBrandSwitch,
  type WorkspaceBrandSwitchOutcome,
} from "../../../../hooks/useWorkspaceBrandSwitch";
import type { Brand } from "../../../../types/brand";

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
const context = (): WebsiteContextValue => ({
  brandId: "brand-lantern", brandName: "Lantern Room",
  controller: { user: { id: "u1" }, siteId: "11111111-1111-4111-8111-111111111111", capabilities: { canPublish: true, canEdit: true, canCreate: true } },
  phone: false, section: "addresses", go: jest.fn(), back: jest.fn(), toast: jest.fn(), askAdmin: jest.fn(), asking: false,
  lock: { heldByOther: false, holderName: null, canTakeOver: true, takeOver: jest.fn(), takingOver: false },
  plan: null, headingRef: React.createRef(), offerings: ["trips"], setStickyBar: jest.fn(), setTopbarSave: jest.fn(),
} as unknown as WebsiteContextValue);
async function mount(): Promise<Renderer> {
  let renderer!: Renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      <QueryClientProvider client={new QueryClient()}>
        <WorkspaceRouteContext.Provider value={{ pathname: "/brand/brand-lantern/website/addresses", params: { id: "brand-lantern" }, routeBrandId: "brand-lantern", pendingSwitch: { current: null } }}>
          <Switcher />
          <WebsiteProvider value={context()}><AddressesSection /></WebsiteProvider>
        </WorkspaceRouteContext.Provider>
      </QueryClientProvider>,
    );
  });
  return renderer;
}
const domain = (r: Renderer): Node => r.root.findAll((n) => n.type === TextInput && n.props.testID === "domain-input")[0]!;
const typeDomain = async (r: Renderer, text: string): Promise<void> =>
  TestRenderer.act(async () => {
    (domain(r).props.onChangeText as (v: string) => void)(text);
  });
const pick = async (): Promise<WorkspaceBrandSwitchOutcome> => {
  let outcome!: WorkspaceBrandSwitchOutcome;
  await TestRenderer.act(async () => {
    outcome = await switchTo!(GAMELAND);
  });
  return outcome;
};

beforeEach(() => {
  mockReplace.mockClear();
  mockPick.mockClear();
  unsavedWork.screens = 0;
  resetToastStoreForTest();
});

describe("#4453 Website addresses hold a brand switch while a domain is typed and not added", () => {
  test("a typed domain holds the switch: the message shows, nothing moves, the text is still there", async () => {
    const r = await mount();
    await typeDomain(r, "lanternroom.com");
    expect(unsavedWork.screens).toBe(1);
    await expect(pick()).resolves.toBe("held");
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([UNSAVED_WORK_HOLDS_SWITCH]);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPick).not.toHaveBeenCalled();
    expect(domain(r).props.value).toBe("lanternroom.com");
    await TestRenderer.act(async () => r.unmount());
    expect(unsavedWork.screens).toBe(0);
  });

  test("an empty box, or one cleared again, lets the switch through", async () => {
    const r = await mount();
    await expect(pick()).resolves.not.toBe("held");
    await typeDomain(r, "lantern");
    await typeDomain(r, "  ");
    expect(unsavedWork.screens).toBe(0);
    await expect(pick()).resolves.not.toBe("held");
    expect(useToastStore.getState().toasts).toHaveLength(0);
    await TestRenderer.act(async () => r.unmount());
  });
});
