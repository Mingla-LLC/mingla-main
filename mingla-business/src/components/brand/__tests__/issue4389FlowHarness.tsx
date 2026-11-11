/**
 * #4389 — shared harness that mounts the REAL BrandCreationFlow (steps, step
 * derivation, K1, resume banner) with the server reads/writes injected.
 * Not a test file (testMatch needs `.test.tsx`); suites import it first so
 * its jest.mock registrations apply before the flow loads.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { jest } from "@jest/globals";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface FlowItem {
  key: string;
  state: "verified" | "not_applicable" | "missing" | "blocked";
  valuePreview?: string;
}
export interface FlowFacts {
  payoutCountry: string | null;
  currency: string | null;
  provider: "stripe" | "paystack";
  stripeState: "none" | "started" | "submitted" | "action_needed";
  terms: boolean;
  details: boolean;
}

export const harness = {
  checklist: null as null | { readiness: { items: FlowItem[] }; facts: FlowFacts; doneCount: number },
  refetches: 0,
  push: jest.fn<(href: string) => void>(),
  replace: jest.fn<(href: string) => void>(),
  saveCountry: jest.fn<(country: string, o: { onSuccess?: () => void }) => void>(),
  markFreeOnly: jest.fn<() => Promise<void>>(() => Promise.resolve()),
  markFreeOnlyMutate: jest.fn<(v: undefined, o: { onSuccess?: () => void; onError?: () => void }) => void>(),
  focusEffects: [] as Array<() => void>,
  beforeRemove: null as null | ((e: unknown) => void),
  params: {} as Record<string, string>,
  keyboardUp: false,
  offeringProps: null as null | Record<string, unknown>,
  refreshStatus: jest.fn<(id: string) => Promise<unknown>>(() => new Promise(() => undefined)),
  invalidate: jest.fn<(f: { queryKey: readonly unknown[] }) => Promise<void>>(() => Promise.resolve()),
};

export function checklistAt(step: "country" | "pay" | "done", over: Partial<FlowFacts> = {}): NonNullable<typeof harness.checklist> {
  const done = (k: string, after: "name" | "country" | "pay"): FlowItem => {
    const order = ["name", "country", "pay", "done"];
    return { key: k, state: order.indexOf(step) > order.indexOf(after) ? "verified" : "missing", valuePreview: k === "brand.name" ? "Night Owls" : undefined };
  };
  return {
    readiness: {
      items: [
        { key: "brand.name", state: "verified", valuePreview: "Night Owls" },
        done("money.market", "country"),
        done("money.terms_member", "pay"),
        done("money.details_submitted", "pay"),
      ],
    },
    facts: {
      payoutCountry: step === "country" ? null : "US",
      currency: step === "country" ? null : "USD",
      provider: "stripe",
      stripeState: step === "done" ? "submitted" : "none",
      terms: step === "done",
      details: step === "done",
      ...over,
    } as FlowFacts,
    doneCount: step === "country" ? 1 : step === "pay" ? 2 : 4,
  };
}

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => harness.params,
  useRouter: () => ({ push: harness.push, replace: harness.replace, back: jest.fn(), canGoBack: () => true }),
  useNavigation: () => ({
    addListener: (_n: string, cb: (e: unknown) => void) => {
      harness.beforeRemove = cb;
      return () => undefined;
    },
    dispatch: jest.fn(),
  }),
  useFocusEffect: (cb: () => void) => {
    const R = jest.requireActual("react") as typeof React;
    R.useEffect(() => {
      harness.focusEffects.push(cb);
      cb();
    }, [cb]);
  },
}));
jest.mock("../../../wrappers/useKeyboardIsVisible", () => ({ useKeyboardIsVisible: () => harness.keyboardUp }));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return { ScrollView: RN.ScrollView, DONE_BAR_OCCUPIED: 53 };
});
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "acct-4389" }, isAuthReady: true, signOut: jest.fn() }),
}));
jest.mock("../../../hooks/useBrandSetupChecklist", () => ({
  useBrandSetupChecklist: () => ({
    data: harness.checklist ?? undefined,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: () => {
      harness.refetches += 1;
      return Promise.resolve();
    },
  }),
  useCreateSetupBrand: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useSetBrandPayoutCountry: () => ({ mutate: harness.saveCountry, isPending: false }),
  useMarkBrandSetupFreeOnly: () => ({ mutate: harness.markFreeOnlyMutate, mutateAsync: harness.markFreeOnly, isPending: false }),
}));
jest.mock("../../../hooks/useMinglaToSAcceptance", () => ({
  CURRENT_MINGLA_TOS_VERSION: "v1",
  ORGANISER_TERMS_URL: "https://example.test/terms",
  useAcceptMinglaToS: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock("../../../lib/netinfoSafe", () => ({ useNetInfoSafe: () => ({ isConnected: true }) }));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: false }) }));
jest.mock("../../../hooks/useTapToPaySettingsEntry", () => ({ useTapToPaySettingsEntry: () => null }));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ isLoading: false, isError: false, role: "brand_owner", rank: 99 }),
}));
jest.mock("../../../hooks/useBrandTeamMemberDirectory", () => ({
  useBrandTeamMemberDirectory: () => ({ data: undefined }),
}));
jest.mock("../../../hooks/useCreatorAccount", () => ({
  useUpdateCreatorAccount: () => ({ mutateAsync: jest.fn(() => Promise.resolve()) }),
}));
jest.mock("../../../hooks/useBrands", () => ({
  adoptBrandIntoCaches: jest.fn(),
  useDiscardDraftBrand: () => jest.fn(),
}));
jest.mock("../../../services/brandsService", () => ({ getBrand: jest.fn(() => Promise.resolve(null)) }));
jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (sel: (s: { setCurrentBrand: () => void }) => unknown) => sel({ setCurrentBrand: jest.fn() }),
}));
jest.mock("../brandSetupAnalytics", () => ({ trackBrandSetup: jest.fn() }));
jest.mock("../OfferingChooser", () => ({
  OfferingChooser: (p: Record<string, unknown>) => {
    harness.offeringProps = p;
    return null;
  },
  routeForOffering: () => "/",
}));
jest.mock("../BrandPaystackOnboardView", () => ({ BrandPaystackOnboardView: () => null }));
jest.mock("../../ui/Toast", () => ({ Toast: () => null }));
jest.mock("../../ui/Button", () => {
  const R = jest.requireActual("react") as typeof React;
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return {
    Button: (p: { label: string; onPress: () => void; testID?: string; disabled?: boolean }) =>
      R.createElement(RN.Pressable, { testID: p.testID, accessibilityLabel: p.label, onPress: p.onPress, disabled: p.disabled }),
  };
});
jest.mock("../../ui/Sheet", () => {
  const R = jest.requireActual("react") as typeof React;
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return {
    Sheet: (p: { visible: boolean; onClose: () => void; children?: React.ReactNode }) =>
      p.visible ? R.createElement(RN.View, { testID: "sheet", ...({ onClose: p.onClose } as object) }, p.children) : null,
  };
});
jest.mock("../../../services/brandSetupService", () => ({
  ...(jest.requireActual("../../../services/brandSetupService") as object),
  refreshStripeSetupStatus: (id: string) => harness.refreshStatus(id),
}));
jest.mock("../../../hooks/useBrandStripeStatus", () => ({
  brandStripeStatusKeys: { detail: (id: string) => ["brand-stripe-status", id] },
}));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: harness.invalidate }) }));

import { BrandCreationFlow } from "../BrandCreationFlow";

export { BrandCreationFlow };

export interface Node {
  type: unknown;
  props: Record<string, unknown>;
  children: Array<Node | string>;
  findAll(p: (n: Node) => boolean, o?: { deep?: boolean }): Node[];
}
export interface Tree {
  root: Node;
  update(el: React.ReactElement): void;
  unmount(): void;
}
export const TestRenderer = require("react-test-renderer") as {
  create(el: React.ReactElement): Tree;
  act(cb: () => void | Promise<void>): Promise<void> | void;
};

const mounted: Tree[] = [];
export async function mount(el: React.ReactElement): Promise<Tree> {
  let t!: Tree;
  await TestRenderer.act(async () => {
    t = TestRenderer.create(el);
  });
  mounted.push(t);
  return t;
}
export async function unmountAll(): Promise<void> {
  while (mounted.length > 0) {
    const t = mounted.pop();
    await TestRenderer.act(async () => t?.unmount());
  }
}
export async function rerender(t: Tree, el: React.ReactElement): Promise<void> {
  await TestRenderer.act(async () => {
    t.update(el);
  });
}
export const byTestId = (t: Tree, id: string): Node[] =>
  t.root.findAll((n) => typeof n.type === "string" && n.props.testID === id);
export const byLabel = (t: Tree, label: string): Node[] =>
  t.root.findAll((n) => typeof n.type === "string" && n.props.accessibilityLabel === label);
export function allText(t: Tree): string {
  const out: string[] = [];
  const walk = (n: Node | string): void => {
    if (typeof n === "string") out.push(n);
    else n.children.forEach(walk);
  };
  walk(t.root);
  return out.join(" ");
}
export async function press(n: Node | undefined): Promise<void> {
  if (n === undefined) throw new Error("press: no node");
  await TestRenderer.act(async () => {
    (n.props.onPress as () => void)();
  });
}
export function resetHarness(): void {
  harness.checklist = null;
  harness.refetches = 0;
  harness.push.mockReset();
  harness.replace.mockReset();
  harness.saveCountry.mockReset();
  harness.markFreeOnly.mockClear();
  harness.markFreeOnlyMutate.mockReset();
  harness.focusEffects = [];
  harness.beforeRemove = null;
  harness.params = {};
  harness.keyboardUp = false;
  harness.invalidate.mockClear();
  harness.offeringProps = null;
  harness.refreshStatus.mockReset();
  harness.refreshStatus.mockImplementation(() => new Promise(() => undefined));
}
