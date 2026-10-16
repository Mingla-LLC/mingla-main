/**
 * #3645 — an experience on a brand with no currency.
 *
 * The server refuses to let an experience leave draft when its brand has no
 * currency (`event_currency_required`), free or priced. Now that brand
 * creation no longer saves pounds by default, a brand can reach the experience
 * creator with no currency. So:
 *
 *   - Publish never reaches the server for a no-currency brand. The organiser
 *     reads "Choose your payout country to publish an experience." and gets the
 *     payout-country prompt on the same screen.
 *   - Once a country is chosen, Publish goes through from that screen with the
 *     draft intact.
 *   - A server `event_currency_required` that still gets through (stale brand
 *     state) lands on the same sentence and prompt, not a generic error and not
 *     a trip to bank setup. The PostgREST error is a plain object.
 *   - No dollar sign is shown for a brand that has no currency.
 *
 * Harness mirrors issue_3284_experience_refund_terms.implementor.test.tsx.
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
  useAuth: () => ({ user: { id: "user-3645" } }),
}));
const BASE_BRAND = {
  id: "brand-3645",
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
jest.mock("../../pricing/WhoCoversCostsSection", () => ({
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
import {
  EXPERIENCE_PAYOUT_COUNTRY_PUBLISH_COPY,
  experienceDisplayCurrencySymbol,
  experiencePublishNeedsPayoutCountry,
  isEventCurrencyRequiredRefusal,
} from "../../../utils/experiencePublishCurrencyGate";

const collectText = (node: unknown, out: string[] = []): string[] => {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  collectText((node as { children?: unknown }).children, out);
  return out;
};
const textOf = (tree: Renderer): string => collectText(tree.toJSON()).join("\n");
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
    brandId="brand-3645"
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
const prompt = (tree: Renderer): TestInstance[] =>
  host(tree, "PayoutCountryFieldProbe").filter(
    (n) => n.props.testID === "experience-publish-payout-country-prompt-field",
  );

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
  mockFrom.mockImplementation(() => themeChain);
  mockRouter.push.mockReset();
  mockBrandBox.current = { ...BASE_BRAND };
  mockRpc.mockResolvedValue({ data: { event: { id: "exp-3645" } }, error: null });
});

describe("#3645 an experience on a brand with no currency cannot reach the publish RPC", () => {
  // The free row was removed on purpose (#3645, approved): a free experience is
  // no longer stopped on the client. See the describe block at the end of this
  // file for what a free experience does on both server answers.
  test.each([
    ["priced", true],
  ])("a %s experience: Publish stops on the client with the plain reason and the country prompt", async (_label, priced) => {
    const onComplete = jest.fn();
    const tree = await mountAtPublish(onComplete, priced);

    // The prompt is on the publish screen before any tap.
    expect(prompt(tree)).toHaveLength(1);
    expect(textOf(tree)).toContain(EXPERIENCE_PAYOUT_COUNTRY_PUBLISH_COPY);

    await pressButton(tree, "Publish");
    await settle();

    expect(rpcNames()).not.toContain(PUBLISH_RPC);
    expect(rpcNames()).not.toContain("biz_publish_experience");
    expect(onComplete).not.toHaveBeenCalled();
    expect(toasts(tree)).toContain(EXPERIENCE_PAYOUT_COUNTRY_PUBLISH_COPY);
    // Not sent away to bank setup: the choice is made here.
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(textOf(tree)).not.toMatch(/Stripe|Paystack/);
    await act(async () => tree.unmount());
  });

  test("a blank currency counts as none", async () => {
    mockBrandBox.current = { ...BASE_BRAND, defaultCurrency: "   " };
    // Priced: the client stop is for paid experiences only (#3645).
    const tree = await mountAtPublish(jest.fn(), true);
    await pressButton(tree, "Publish");
    await settle();
    expect(rpcNames()).not.toContain(PUBLISH_RPC);
    await act(async () => tree.unmount());
  });

  test("Save as draft is not gated: a draft needs no currency", async () => {
    const onComplete = jest.fn();
    const tree = await mountAtPublish(onComplete, false);
    await pressButton(tree, "Save as draft");
    await settle();
    expect(rpcNames()).toContain(PUBLISH_RPC);
    const call = mockRpc.mock.calls.find((c) => c[0] === PUBLISH_RPC);
    expect(call?.[1].p_publish).toBe(false);
    expect(onComplete).toHaveBeenCalledWith("exp-3645");
    await act(async () => tree.unmount());
  });

  test("after a country is chosen, Publish proceeds from the same screen with the draft intact", async () => {
    const onComplete = jest.fn();
    // Priced: the client stop is for paid experiences only (#3645).
    const tree = await mountAtPublish(onComplete, true);
    await pressButton(tree, "Publish");
    await settle();
    expect(rpcNames()).not.toContain(PUBLISH_RPC);

    // The organiser picks a country in the prompt: the brand now has a currency
    // (and, being paid, can collect).
    mockBrandBox.current = { ...BASE_BRAND, defaultCurrency: "EUR", stripeStatus: "active" };
    await act(async () => {
      (prompt(tree)[0].props.onCountryChosen as () => void)();
      tree.update(element(onComplete, true));
    });
    await settle();
    // The prompt is gone; the draft is still the one being published (below).
    expect(prompt(tree)).toHaveLength(0);

    await pressButton(tree, "Publish");
    await settle();
    const call = mockRpc.mock.calls.find((c) => c[0] === PUBLISH_RPC);
    expect(call).toBeDefined();
    expect(call?.[1].p_publish).toBe(true);
    expect((call?.[1].p_payload as { title: string }).title).toBe("Lagos Food Walk");
    expect(onComplete).toHaveBeenCalledWith("exp-3645");
    await act(async () => tree.unmount());
  });
});

describe("#3645 a server event_currency_required refusal lands on the same prompt", () => {
  test("stale brand state: the plain-object refusal shows the sentence and the prompt, not a generic error or bank setup", async () => {
    // This client believes the brand has a currency; the server disagrees.
    mockBrandBox.current = { ...BASE_BRAND, defaultCurrency: "GBP" };
    mockRpc.mockImplementation(async (name) =>
      name === PUBLISH_RPC
        ? {
            data: null,
            // A PostgREST error: a bare object, never an Error instance.
            error: { code: "P0001", message: "event_currency_required" },
          }
        : { data: { event: { id: "exp-3645" } }, error: null },
    );
    const onComplete = jest.fn();
    const tree = await mountAtPublish(onComplete, false);
    expect(prompt(tree)).toHaveLength(0);

    await pressButton(tree, "Publish");
    await settle();

    expect(rpcNames()).toContain(PUBLISH_RPC);
    expect(onComplete).not.toHaveBeenCalled();
    expect(toasts(tree)).toContain(EXPERIENCE_PAYOUT_COUNTRY_PUBLISH_COPY);
    expect(toasts(tree).join("\n")).not.toMatch(
      /event_currency_required|Couldn't publish|payment setup|\[object Object\]/,
    );
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(prompt(tree)).toHaveLength(1);

    // Choosing a country clears the refusal and Publish can be tried again.
    mockRpc.mockResolvedValue({ data: { event: { id: "exp-3645" } }, error: null });
    mockRpc.mockImplementation(async () => ({
      data: { event: { id: "exp-3645" } },
      error: null,
    }));
    await act(async () => {
      (prompt(tree)[0].props.onCountryChosen as () => void)();
    });
    await settle();
    expect(prompt(tree)).toHaveLength(0);
    await pressButton(tree, "Publish");
    await settle();
    expect(onComplete).toHaveBeenCalledWith("exp-3645");
    await act(async () => tree.unmount());
  });

  test("the refusal reader accepts an Error, a bare object and a string, and nothing else", () => {
    expect(
      isEventCurrencyRequiredRefusal({ code: "P0001", message: "event_currency_required" }),
    ).toBe(true);
    expect(isEventCurrencyRequiredRefusal(new Error("event_currency_required"))).toBe(true);
    expect(isEventCurrencyRequiredRefusal("event_currency_required")).toBe(true);
    expect(isEventCurrencyRequiredRefusal({ message: "stripe_charges_disabled" })).toBe(false);
    expect(isEventCurrencyRequiredRefusal({ message: "event_currency_unsupported" })).toBe(false);
    expect(isEventCurrencyRequiredRefusal(null)).toBe(false);
    expect(isEventCurrencyRequiredRefusal({})).toBe(false);
  });
});

describe("#3645 no dollars are shown for a brand with no currency", () => {
  test("a priced experience on a no-currency brand shows the amount with no symbol", async () => {
    // The Pricing step is where the total is shown.
    const tree = await mountAtStep(jest.fn(), true, 3);
    const text = textOf(tree);
    // #3281 intentionally suppresses trailing zeroes for whole-unit prices.
    expect(text).toContain("Buyers pay 25 for all 2 stops");
    expect(text).not.toContain("$");
    expect(text).not.toContain("USD");
    await act(async () => tree.unmount());
  });

  test("a brand WITH a currency still shows its own symbol", async () => {
    mockBrandBox.current = {
      ...BASE_BRAND,
      defaultCurrency: "GBP",
      stripeStatus: "active",
    };
    const tree = await mountAtStep(jest.fn(), true, 3);
    // #3281 intentionally suppresses trailing zeroes for whole-unit prices.
    expect(textOf(tree)).toContain("Buyers pay £25 for all 2 stops");
    await act(async () => tree.unmount());
  });

  test("the pure helpers", () => {
    const symbolFor = (code: string): string => (code === "GBP" ? "£" : `${code} `);
    expect(experienceDisplayCurrencySymbol(undefined, symbolFor)).toBe("");
    expect(experienceDisplayCurrencySymbol(null, symbolFor)).toBe("");
    expect(experienceDisplayCurrencySymbol("  ", symbolFor)).toBe("");
    expect(experienceDisplayCurrencySymbol("gbp", symbolFor)).toBe("£");
    expect(
      experiencePublishNeedsPayoutCountry({ publish: true, brandDefaultCurrency: undefined }),
    ).toBe(true);
    expect(
      experiencePublishNeedsPayoutCountry({ publish: false, brandDefaultCurrency: undefined }),
    ).toBe(false);
    expect(
      experiencePublishNeedsPayoutCountry({ publish: true, brandDefaultCurrency: "NGN" }),
    ).toBe(false);
    expect(EXPERIENCE_PAYOUT_COUNTRY_PUBLISH_COPY).not.toMatch(/Stripe|Paystack/i);
  });
});

// ---------------------------------------------------------------------------
// #3645 — a FREE experience on a brand with no payout country is the server's
// call, and the server's answer changes when migration 20270830003645 is
// applied. The creator no longer stops it on the client; it handles both
// answers.
// ---------------------------------------------------------------------------
describe("#3645 a free experience on a brand with no currency goes to the server", () => {
  test("nothing asks for a country before Publish is pressed", async () => {
    const tree = await mountAtPublish(jest.fn(), false);
    expect(prompt(tree)).toHaveLength(0);
    expect(textOf(tree)).not.toContain(EXPERIENCE_PAYOUT_COUNTRY_PUBLISH_COPY);
    await act(async () => tree.unmount());
  });

  test("the server publishes it (after the migration is applied): it is published, with no country asked", async () => {
    const onComplete = jest.fn();
    const tree = await mountAtPublish(onComplete, false);
    await pressButton(tree, "Publish");
    await settle();
    const call = mockRpc.mock.calls.find((c) => c[0] === PUBLISH_RPC);
    expect(call).toBeDefined();
    expect(call?.[1].p_publish).toBe(true);
    expect((call?.[1].p_payload as { is_free?: boolean }).is_free).toBe(true);
    expect(onComplete).toHaveBeenCalledWith("exp-3645");
    expect(toasts(tree)).not.toContain(EXPERIENCE_PAYOUT_COUNTRY_PUBLISH_COPY);
    expect(prompt(tree)).toHaveLength(0);
    expect(mockRouter.push).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test("the server refuses it (today): the same sentence and the same in-place prompt as before, then it publishes once a country is chosen", async () => {
    mockRpc.mockImplementation(async (name, args) =>
      name === PUBLISH_RPC && args.p_publish === true
        ? { data: null, error: { code: "P0001", message: "event_currency_required" } }
        : { data: { event: { id: "exp-3645" } }, error: null },
    );
    const onComplete = jest.fn();
    const tree = await mountAtPublish(onComplete, false);
    await pressButton(tree, "Publish");
    await settle();

    expect(rpcNames()).toContain(PUBLISH_RPC);
    expect(onComplete).not.toHaveBeenCalled();
    // Exactly what the host read when the client stopped it.
    expect(toasts(tree)).toContain(EXPERIENCE_PAYOUT_COUNTRY_PUBLISH_COPY);
    expect(prompt(tree)).toHaveLength(1);
    expect(textOf(tree)).toContain(EXPERIENCE_PAYOUT_COUNTRY_PUBLISH_COPY);
    expect(toasts(tree).join("\n")).not.toMatch(
      /event_currency_required|Couldn't publish|payment setup|\[object Object\]/,
    );
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(textOf(tree)).not.toMatch(/Stripe|Paystack/);

    // The organiser picks a country in the prompt and publishes from there.
    mockBrandBox.current = { ...BASE_BRAND, defaultCurrency: "NGN" };
    mockRpc.mockImplementation(async () => ({
      data: { event: { id: "exp-3645" } },
      error: null,
    }));
    await act(async () => {
      (prompt(tree)[0].props.onCountryChosen as () => void)();
      tree.update(element(onComplete, false));
    });
    await settle();
    expect(prompt(tree)).toHaveLength(0);
    await pressButton(tree, "Publish");
    await settle();
    expect(onComplete).toHaveBeenCalledWith("exp-3645");
    await act(async () => tree.unmount());
  });

  test("a priced experience on the same brand is still stopped before the server", async () => {
    const tree = await mountAtPublish(jest.fn(), true);
    expect(prompt(tree)).toHaveLength(1);
    await pressButton(tree, "Publish");
    await settle();
    expect(rpcNames()).not.toContain(PUBLISH_RPC);
    expect(toasts(tree)).toContain(EXPERIENCE_PAYOUT_COUNTRY_PUBLISH_COPY);
    await act(async () => tree.unmount());
  });

  test("the guard is paid-only, and a caller that cannot say is treated as paid", () => {
    const none = { publish: true, brandDefaultCurrency: null };
    expect(experiencePublishNeedsPayoutCountry({ ...none, isPaid: false })).toBe(false);
    expect(experiencePublishNeedsPayoutCountry({ ...none, isPaid: true })).toBe(true);
    expect(experiencePublishNeedsPayoutCountry(none)).toBe(true);
    expect(
      experiencePublishNeedsPayoutCountry({ publish: false, brandDefaultCurrency: null, isPaid: true }),
    ).toBe(false);
    expect(
      experiencePublishNeedsPayoutCountry({ publish: true, brandDefaultCurrency: "NGN", isPaid: true }),
    ).toBe(false);
  });
});

