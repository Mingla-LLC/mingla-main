/**
 * #4238 W6-12, experience half. Mounts the real ExperienceCreatorWizard,
 * walks to the publish step and presses Publish / Save as draft against a
 * mocked publish RPC and a mocked AppsFlyer service.
 *
 * Harness copied from issue_3645_experience_no_currency_publish.implementor.test.tsx
 * (same module boundaries); only the AppsFlyer mock and the cases are new.
 */
import React from "react";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface Renderer {
  root: TestInstance;
  toJSON: () => unknown;
  update: (node: React.ReactElement) => void;
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

// ---------------------------------------------------------------------------

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
const mockRpc = jest.fn<(name: string, args: Record<string, unknown>) => Promise<RpcResult>>();
const mockFrom = jest.fn<(table: string) => unknown>();

const mockLogAppsFlyerEvent = jest.fn<(name: string, values: Record<string, unknown>) => void>();
// #4490 — the Where step's venue/space link has its own data (react-query);
// these wizard harnesses mount no QueryClient, so it renders nothing here.
jest.mock("../../venue/features/EventVenueSpacePicker", () => ({
  EventVenueSpacePicker: () => null,
}));
jest.mock("../../../services/appsFlyerService", () => ({
  logAppsFlyerEvent: (name: string, values: Record<string, unknown>) =>
    mockLogAppsFlyerEvent(name, values),
}));

jest.mock("../../../services/supabase", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => mockRpc(name, args),
    from: (table: string) => mockFrom(table),
  },
}));
const mockSetEventGuestPrivacy = jest.fn(async () => undefined);
jest.mock("../../../services/businessEvents", () => ({
  setEventGuestPrivacy: (...args: unknown[]) => mockSetEventGuestPrivacy(...(args as [])),
}));
jest.mock("../../../services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("../../../wrappers/useKeyboardIsVisible", () => ({
  useKeyboardIsVisible: () => false,
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-4238" } }),
}));
const BASE_BRAND = {
  id: "brand-4238",
  defaultPassTax: false,
  defaultPassMinglaFee: false,
  defaultPassServiceFee: false,
  takeRateBpsOverride: null,
  stripeStatus: "not_connected",
};
const mockBrandBox: { current: Record<string, unknown> } = {
  current: { ...BASE_BRAND },
};
jest.mock("../../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => mockBrandBox.current,
}));
// The country field is the brand-creation one; here it is a probe so the test
// can "choose a country" the way a successful pick does.
jest.mock("../../brand/BrandPayoutCountryField", () => ({
  BrandPayoutCountryField: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("PayoutCountryFieldProbe", props),
}));
jest.mock("../../../hooks/useExperienceVenueDefault", () => ({
  useExperienceVenueDefault: () => ({ hasPrefill: false, defaultVenue: "" }),
}));
jest.mock("../../../hooks/useBrandTaxRegistration", () => ({
  useBrandTaxRegistration: () => ({ data: { hasActiveRegistration: false } }),
}));
jest.mock("../../../hooks/useExperienceDraftAdapter", () => ({
  useExperienceDraftAdapter: () => ({
    whenState: { whenMode: "single", date: "2030-06-01", doorsOpen: "19:00", endsAt: "22:00" },
    draftEvent: {},
    updateDraft: () => undefined,
    errors: [],
    showErrors: false,
    setShowErrors: () => undefined,
    isValid: true,
    toPayloadWhen: () => ({
      whenMode: "single",
      when: { date: "2030-06-01", doorsOpen: "19:00", endsAt: "22:00" },
      multiDates: null,
      recurrence_rules: null,
      timezone: "Europe/London",
    }),
  }),
}));
jest.mock("../../intel/createDeferredTurnoutIntelProvider", () => ({
  createDeferredTurnoutIntelProvider:
    () =>
    ({ children }: { children: React.ReactNode }) =>
      children,
}));
jest.mock("../../intel/useTurnoutFocusTarget", () => ({
  useTurnoutFocusTarget: () => false,
}));
jest.mock("../../intel/PrePublishIntelligenceSurfaces", () => ({
  PrePublishGateSheet: (): null => null,
}));
jest.mock("../../../utils/turnoutGateAnalytics", () => ({
  shouldTrackGatePublishedAnyway: () => false,
}));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ButtonProbe", props),
}));
jest.mock("../../ui/Toast", () => ({
  Toast: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ToastProbe", props),
}));
jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));
jest.mock("../../ui/Input", () => ({ Input: (): null => null }));
jest.mock("../../ui/Stepper", () => ({ Stepper: (): null => null }));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("GlassCardProbe", props, props.children),
}));
jest.mock("../../event/CreatorStep2When", () => ({ CreatorStep2When: (): null => null }));
jest.mock("../ExperienceCoverStep", () => ({ ExperienceCoverStep: (): null => null }));
jest.mock("../ExperienceStopsStep", () => ({ ExperienceStopsStep: (): null => null }));
jest.mock("../../pricing/LazyWhoCoversCostsSection", () => ({
  WhoCoversCostsSection: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("WhoCoversCostsSectionProbe", {}),
}));
jest.mock("../../offering/StripeBlockedCard", () => ({ StripeBlockedCard: (): null => null }));
jest.mock("../EditAfterPublishExperienceBanner", () => ({
  EditAfterPublishExperienceBanner: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("LiveEditBannerProbe", props),
}));
// The wizard imports the #1780 invite step, whose
// ConfirmDialog loads react-native-reanimated (unparseable under this ts-jest
// project), plus the invite flag and persisted-plan hooks. Stub them at the
// module boundary like the other steps above. Flag off with a settled, empty
// saved plan keeps the pre-#1780 step list and publish arguments this suite pins.
jest.mock("../../invites/InvitePeopleStep", () => ({
  InvitePeoplePublishConfirmation: (): null => null,
  InvitePeopleStep: (): null => null,
  InvitePlanReviewSummary: (): null => null,
  // #1780 [bundle budget] — the wizard reads the saved selection through this
  // module now. Report the SAME summary this file's useOfferingInvitePlan mock
  // already returns, so the wizard sees exactly what it saw when it called the
  // hook itself and no assertion below changes meaning.
  InvitePlanSummaryBridge: ({ onChange }: { onChange: (summary: unknown) => void }): null => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactActual = require("react") as typeof import("react");
    const { useOfferingInvitePlanSummary } = jest.requireMock(
      "../../../hooks/useOfferingInvitePlan",
    ) as { useOfferingInvitePlanSummary: () => unknown };
    const summary = useOfferingInvitePlanSummary();
    ReactActual.useEffect(() => {
      onChange(summary);
    }, [onChange, summary]);
    return null;
  },
}));
jest.mock("../../../hooks/useFeatureFlag", () => {
  const settledOff = { data: false, isPending: false, isFetching: false, isError: false };
  return { useFeatureFlag: () => settledOff };
});
jest.mock("../../../hooks/useOfferingInvitePlan", () => {
  const settledIdle = { isPending: false, isFetching: false, isError: false };
  const emptyPlan = {
    eventId: "event-1780-empty",
    eventType: "experience",
    selectionRevision: 0,
    selectedCount: 0,
    brandPersonIds: [],
    selectionHash: "0".repeat(64),
    state: "draft",
    publishedSelectionRevision: null,
    updatedAt: null,
  };
  const summary = {
    plan: { ...settledIdle, data: emptyPlan },
    quote: { ...settledIdle, data: undefined },
    refreshAuthoritative: async () => ({ plan: emptyPlan, quote: null }),
  };
  return { useOfferingInvitePlanSummary: () => summary };
});
jest.mock("../../../hooks/useOrganiserTermsPublishGate", () => ({
  useOrganiserTermsPublishGate: () => ({
    blockPaidPublishUntilAccepted: () => false,
    gateElement: null,
  }),
  ORGANISER_TERMS_PUBLISH_RETRY_TOAST:
    "Accept the Organiser Terms, then tap Publish again.",
}));


import {
  ExperienceCreatorWizard,
  type ExperienceWizardInitialDraft,
} from "../ExperienceCreatorWizard";
import { emptyPriceOption } from "../experienceWizardTypes";

const host = (tree: Renderer, type: string): TestInstance[] =>
  tree.root.findAll((node) => node.type === type);
const press = async (node: TestInstance | undefined): Promise<void> => {
  expect(node).toBeDefined();
  await act(async () => {
    const result = ((node as TestInstance).props.onPress as () => unknown)();
    if (result instanceof Promise) await result;
  });
};
const pressButton = (tree: Renderer, label: string): Promise<void> =>
  press(host(tree, "ButtonProbe").find((n) => n.props.label === label));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
};
const toasts = (tree: Renderer): string[] =>
  host(tree, "ToastProbe")
    .filter((n) => n.props.visible !== false)
    .map((n) => String(n.props.message ?? ""));
const rpcNames = (): string[] => mockRpc.mock.calls.map((c) => c[0]);
const PUBLISH_RPC = "issue_1719_publish_experience_with_poster";

const stop = (i: number) => ({
  clientId: `stop-${i}`,
  placeId: `place-${i}`,
  placeName: `Stop ${i}`,
  address: `${i} High Street, London`,
  city: "London",
  region: null,
  countryCode: "GB",
  lat: 51.5 + i / 100,
  lng: -0.12,
  coordinatePrecision: "exact" as const,
  imageUrls: [],
  startTime: null,
  priceMajor: "0",
  description: `Stop ${i} is a lovely place to be.`,
});
const seed = (priced: boolean): ExperienceWizardInitialDraft => ({
  title: "Lagos Food Walk",
  description: "Three stops, one great evening of food.",
  intents: ["group-fun"] as never,
  locationMode: "single",
  pricingMode: "whole",
  stops: [stop(1), stop(2)] as never,
  wholePriceMajor: priced ? "25.00" : "0.00",
  // #4490 — every price is named by the host (a blank name blocks Continue).
  priceOptions: [
    emptyPriceOption({ name: "General admission", priceMajor: priced ? "25.00" : "0.00", priceBasis: "person" }),
  ],
  isFree: !priced,
  capacity: "20",
  unlimited: false,
  pricingSwitches: { passTax: null, passMinglaFee: null, passServiceFee: null },
});

const themeChain = {
  select: () => themeChain,
  eq: () => themeChain,
  maybeSingle: () => Promise.resolve({ data: null, error: null }),
};

const element = (onComplete: () => void, priced: boolean): React.ReactElement => (
  <ExperienceCreatorWizard
    brandId="brand-4238"
    onComplete={onComplete}
    initialDraft={seed(priced)}
  />
);

/** Mounts the wizard and walks to the final (publish) step. */
const mountAtStep = async (
  onComplete: () => void,
  priced: boolean,
  continues: number,
): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(element(onComplete, priced));
  });
  for (let i = 0; i < continues; i += 1) {
    await pressButton(tree, "Continue");
    await settle();
  }
  return tree;
};
const mountAtPublish = async (
  onComplete: () => void,
  priced: boolean,
): Promise<Renderer> => {
  const tree = await mountAtStep(onComplete, priced, 4);
  expect(host(tree, "ButtonProbe").some((n) => n.props.label === "Publish")).toBe(
    true,
  );
  return tree;
};

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
  mockFrom.mockImplementation(() => themeChain);
  mockRouter.push.mockReset();
  // A brand that can publish a paid experience: the payout-country gate is
  // #3645's subject, not this file's.
  mockBrandBox.current = { ...BASE_BRAND, defaultCurrency: "GBP", stripeStatus: "active" };
  mockRpc.mockResolvedValue({ data: { event: { id: "exp-4238" } }, error: null });
  mockLogAppsFlyerEvent.mockReset();
});

const supplyCalls = (): [string, Record<string, unknown>][] =>
  mockLogAppsFlyerEvent.mock.calls.filter(([name]) => name === "mingla_experience_published");

describe("#4238 W6-12 a published experience logs mingla_experience_published", () => {
  test.each([
    ["free", false],
    ["priced", true],
  ])("a %s experience the server publishes logs the event once, with its id and brand", async (_l, priced) => {
    const onComplete = jest.fn();
    const tree = await mountAtPublish(onComplete, priced);
    await pressButton(tree, "Publish");
    await settle();
    const call = mockRpc.mock.calls.find((c) => c[0] === PUBLISH_RPC);
    expect(call?.[1].p_publish).toBe(true);
    expect(onComplete).toHaveBeenCalledWith("exp-4238");
    expect(supplyCalls()).toEqual([
      ["mingla_experience_published", { event_id: "exp-4238", brand_id: "brand-4238" }],
    ]);
    await act(async () => tree.unmount());
  });

  test("Save as draft is not a publish: nothing is logged", async () => {
    const onComplete = jest.fn();
    const tree = await mountAtPublish(onComplete, false);
    await pressButton(tree, "Save as draft");
    await settle();
    const call = mockRpc.mock.calls.find((c) => c[0] === PUBLISH_RPC);
    expect(call?.[1].p_publish).toBe(false);
    expect(onComplete).toHaveBeenCalledWith("exp-4238");
    expect(supplyCalls()).toEqual([]);
    await act(async () => tree.unmount());
  });

  test("a publish the server refuses logs nothing", async () => {
    mockRpc.mockImplementation(async (name) =>
      name === PUBLISH_RPC
        ? { data: null, error: { code: "P0001", message: "experience_stops_required" } }
        : { data: { event: { id: "exp-4238" } }, error: null },
    );
    const onComplete = jest.fn();
    const tree = await mountAtPublish(onComplete, false);
    await pressButton(tree, "Publish");
    await settle();
    expect(rpcNames()).toContain(PUBLISH_RPC);
    expect(onComplete).not.toHaveBeenCalled();
    expect(toasts(tree).length).toBeGreaterThan(0);
    expect(supplyCalls()).toEqual([]);
    await act(async () => tree.unmount());
  });

  test("an AppsFlyer failure never blocks the publish", async () => {
    mockLogAppsFlyerEvent.mockImplementation(() => {
      throw new Error("native module missing");
    });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const onComplete = jest.fn();
    const tree = await mountAtPublish(onComplete, false);
    await pressButton(tree, "Publish");
    await settle();
    expect(onComplete).toHaveBeenCalledWith("exp-4238");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    await act(async () => tree.unmount());
  });
});
