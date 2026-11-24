// #4548 — tester: the Guest pack on the experience wizard, driven through the
// REAL ExperienceCreatorWizard, the REAL lazy GuestPackEditor and the REAL working
// copy; only the Supabase client is mocked (harness from
// issue_3284_experience_refund_terms.implementor.test.tsx, without its editor stub).
//   EXP-GP-1  the pack is read once, only after biz_create_experience made the row,
//             with that row's id; leaving Stops and coming back never re-reads it
//   EXP-GP-2  a pending pack blocks Continue on Stops while its save fails (text kept,
//             nothing else written), then saves through its own RPC and advances
//   EXP-GP-3  the refund-terms publish sequence is unchanged apart from that one read
//   EXP-GP-4  (Retest 2) a pack-only change, then Back and Close, asks before discarding;
//             the same walk with nothing typed closes at once (no phantom dialog)

import * as fs from "node:fs";
import * as path from "node:path";
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
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

// ---------------------------------------------------------------------------
// module boundaries
// ---------------------------------------------------------------------------

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
const mockRpc = jest.fn<(name: string, args: Record<string, unknown>) => Promise<RpcResult>>();
const mockFrom = jest.fn<(table: string) => unknown>();

// [TEST-MOD-APPROVED #4490] merge with #4490: the Where step's venue/space link
// has its own data (react-query); this harness mounts no QueryClient, so it
// renders nothing here (as in the other experience wizard suites).
jest.mock("../../venue/features/EventVenueSpacePicker", () => ({
  EventVenueSpacePicker: () => null,
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
  useAuth: () => ({ user: { id: "user-3284" } }),
}));
const mockBrand = {
  id: "brand-3284",
  defaultCurrency: "GBP",
  defaultPassTax: false,
  defaultPassMinglaFee: false,
  defaultPassServiceFee: false,
  takeRateBpsOverride: null,
  stripeStatus: "active",
};
jest.mock("../../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => mockBrand,
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
jest.mock("../../ui/ConfirmDialog", () => ({
  ConfirmDialog: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ConfirmDialogProbe", props),
}));
jest.mock("../ExperienceStopsStep", () => ({ ExperienceStopsStep: (): null => null }));
// #4548 tester: the REAL Guest pack editor and working copy mount on the Stops step.
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
// [TEST-MOD-APPROVED #1780] The wizard now imports the #1780 invite step, whose
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
// [TEST-MOD-APPROVED #3645] settled accepted — refund-terms subject stays refund terms.
jest.mock("../../../hooks/useOrganiserTermsPublishGate", () => ({
  useOrganiserTermsPublishGate: () => ({
    blockPaidPublishUntilAccepted: () => false,
    gateElement: null,
  }),
  ORGANISER_TERMS_PUBLISH_RETRY_TOAST:
    "Accept the Organiser Terms, then tap Publish again.",
}));

import {
  EVENT_FLEXIBLE_POLICY,
  EVENT_STANDARD_POLICY,
  EVENT_STRICT_POLICY,
  type RefundPolicy,
} from "../../../services/refundPolicyModel"; // [TEST-MOD-APPROVED #3284] path only
import {
  getExperienceDetail,
  type ExperienceDetail,
} from "../../../services/experienceDetailService";
import { liveExperienceRejectCopy } from "../../../utils/publishedExperienceEditGuards";
import { REFUND_TERMS_UNAVAILABLE_COPY } from "../../../utils/refundPolicyTerms";
import {
  getGuestPackSession,
  GUEST_PACK_SAVE_FAILED_COPY,
  releaseGuestPackSession,
  setGuestPackNote,
} from "../../../utils/guestPackSession";
import {
  ExperienceCreatorWizard,
  type ExperienceWizardInitialDraft,
} from "../ExperienceCreatorWizard";
import { RefundPolicyEditor } from "../../trip/RefundPolicyEditor";
import { emptyPriceOption } from "../experienceWizardTypes";

// ---------------------------------------------------------------------------
// helpers + fixtures
// ---------------------------------------------------------------------------

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
const byTestId = (tree: Renderer, testID: string): TestInstance => {
  const found = tree.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === testID,
  );
  expect(found.length).toBeGreaterThan(0);
  return found[0];
};
const mount = async (element: React.ReactElement): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(element);
  });
  return tree;
};
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
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};
const unmount = async (tree: Renderer): Promise<void> => {
  await act(async () => {
    tree.unmount();
  });
};
const readSource = (rel: string): string =>
  fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", rel), "utf8");

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

const seed = (refundPolicy?: RefundPolicy | null): ExperienceWizardInitialDraft => ({
  title: "Lagos Food Walk",
  description: "Three stops, one great evening of food.",
  intents: ["group-fun"] as never,
  locationMode: "single",
  pricingMode: "whole",
  stops: [stop(1), stop(2)] as never,
  wholePriceMajor: "0.00",
  // [TEST-MOD-APPROVED #4490] merge with #4490: every price is named by the
  // host (a blank name blocks Continue), as in the #3284 suite.
  priceOptions: [
    emptyPriceOption({ name: "General admission", priceMajor: "0.00", priceBasis: "person" }),
  ],
  isFree: true,
  capacity: "20",
  unlimited: false,
  pricingSwitches: { passTax: null, passMinglaFee: null, passServiceFee: null },
  ...(refundPolicy === undefined ? {} : { refundPolicy }),
});

const liveDetail = (refundPolicy: RefundPolicy | null): ExperienceDetail => ({
  id: "exp-live",
  brandId: "brand-3284",
  brandSlug: "sunset",
  title: "Lagos Food Walk",
  slug: "lagos-food-walk",
  description: "Three stops, one great evening of food.",
  status: "scheduled",
  visibility: "public",
  currency: "GBP",
  timezone: "Europe/London",
  coverMediaUrl: null,
  coverMediaType: null,
  locationMode: "single",
  pricingMode: "whole",
  wholePriceCents: 0,
  isRecurring: false,
  isMultiDate: false,
  recurrenceRule: null,
  whenMode: "single",
  whenDraft: null,
  venueText: null,
  experienceIntents: ["group-fun"] as never,
  experienceIntent: null,
  stops: [1, 2].map((i) => ({
    id: `row-${i}`,
    stopOrder: i - 1,
    placeId: `place-${i}`,
    placeName: `Stop ${i}`,
    address: `${i} High Street, London`,
    city: "London",
    region: null,
    countryCode: "GB",
    lat: 51.5,
    lng: -0.12,
    imageUrls: [],
    startTime: null,
    priceCents: 0,
    description: "A stop.",
  })),
  ticket: {
    id: "ticket-1",
    name: "Entry",
    priceCents: 0,
    currency: "GBP",
    quantityTotal: 20,
    isUnlimited: false,
    isFree: true,
  },
  dates: [],
  refundPolicy,
});

/** Continue from step 1 to the Pricing step (4). */
const toPricing = async (tree: Renderer): Promise<void> => {
  for (let i = 0; i < 3; i += 1) {
    await pressButton(tree, "Continue");
    await settle();
  }
  expect(byTestId(tree, "experience-pricing-refund-card")).toBeDefined();
};

const rpcNames = (): string[] => mockRpc.mock.calls.map((c) => c[0]);

const themeChain = {
  select: () => themeChain,
  eq: () => themeChain,
  maybeSingle: () => Promise.resolve({ data: null, error: null }),
};

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
  mockFrom.mockImplementation(() => themeChain);
  mockSetEventGuestPrivacy.mockClear();
});

const STEP3_TITLE = "When does it happen?";
const pressBack = (tree: Renderer): Promise<void> =>
  press(
    tree.root.findAll(
      (n) => n.props.accessibilityLabel === "Back" && typeof n.props.onPress === "function",
    )[0],
  );

describe("#4548 experience Guest pack (tester)", () => {
  beforeEach(() => {
    releaseGuestPackSession("exp-new");
  });

  test("EXP-GP-1 one read, after the row exists, with its id", async () => {
    mockRpc.mockImplementation(async (name: string) => {
      if (name === "biz_get_event_guest_pack") return { data: null, error: null };
      return { data: { event: { id: "exp-new" } }, error: null };
    });
    const tree = await mount(
      <ExperienceCreatorWizard brandId="brand-3284" onComplete={jest.fn()} initialDraft={seed()} />,
    );
    expect(rpcNames()).not.toContain("biz_get_event_guest_pack");
    await pressButton(tree, "Continue");
    await settle();
    await settle();
    const names = rpcNames();
    expect(names.filter((n) => n === "biz_get_event_guest_pack")).toHaveLength(1);
    expect(names.indexOf("biz_create_experience")).toBeGreaterThan(-1);
    expect(names.indexOf("biz_get_event_guest_pack")).toBeGreaterThan(names.indexOf("biz_create_experience"));
    const call = mockRpc.mock.calls.find((c) => c[0] === "biz_get_event_guest_pack");
    expect(call?.[1]).toEqual({ p_event_id: "exp-new" });
    expect(textOf(tree)).toContain("Guest pack");
    await pressButton(tree, "Continue");
    await settle();
    await pressBack(tree);
    await settle();
    expect(rpcNames().filter((n) => n === "biz_get_event_guest_pack")).toHaveLength(1);
    await unmount(tree);
  });

  test("EXP-GP-2 a failing pack save keeps the host on Stops; a good one saves then advances", async () => {
    let failSet = true;
    mockRpc.mockImplementation(async (name: string) => {
      if (name === "biz_get_event_guest_pack") return { data: null, error: null };
      if (name === "biz_set_event_guest_pack") {
        return failSet
          ? { data: null, error: { message: "Failed to fetch" } }
          : { data: { note: "Meet at the gate", items: [], updatedAt: null }, error: null };
      }
      return { data: { event: { id: "exp-new" } }, error: null };
    });
    const tree = await mount(
      <ExperienceCreatorWizard brandId="brand-3284" onComplete={jest.fn()} initialDraft={seed()} />,
    );
    await pressButton(tree, "Continue");
    await settle();
    await settle();
    await act(async () => {
      setGuestPackNote("exp-new", "Meet at the gate");
    });
    const before = rpcNames().length;
    await pressButton(tree, "Continue");
    await settle();
    expect(rpcNames().slice(before)).toEqual(["biz_set_event_guest_pack"]);
    expect(textOf(tree)).not.toContain(STEP3_TITLE);
    expect(
      host(tree, "ToastProbe").some((n) => JSON.stringify(n.props).includes(GUEST_PACK_SAVE_FAILED_COPY)),
    ).toBe(true);
    expect(getGuestPackSession("exp-new")?.note).toBe("Meet at the gate");
    failSet = false;
    await pressButton(tree, "Continue");
    await settle();
    const setCalls = mockRpc.mock.calls.filter((c) => c[0] === "biz_set_event_guest_pack");
    expect(setCalls).toHaveLength(2);
    expect(setCalls[1][1]).toEqual({ p_event_id: "exp-new", p_note: "Meet at the gate", p_items: [] });
    expect(textOf(tree)).toContain(STEP3_TITLE);
    await unmount(tree);
  });

  test("EXP-GP-3 the refund-terms publish sequence only gains the one pack read", async () => {
    mockRpc.mockImplementation(async (name: string) => {
      if (name === "biz_get_event_guest_pack") return { data: null, error: null };
      if (name === "business_patch_offering_refund_policy") {
        return { data: { ok: true, refundPolicy: EVENT_STRICT_POLICY, changed: true }, error: null };
      }
      return { data: { event: { id: "exp-new" } }, error: null };
    });
    const tree = await mount(
      <ExperienceCreatorWizard brandId="brand-3284" onComplete={jest.fn()} initialDraft={seed()} />,
    );
    await toPricing(tree);
    await press(byTestId(tree, "refund-policy-chip-strict"));
    await pressButton(tree, "Continue");
    await pressButton(tree, "Publish");
    await settle();
    expect(rpcNames()).toEqual([
      "biz_create_experience",
      "biz_get_event_guest_pack",
      "business_patch_offering_refund_policy",
      "issue_1719_publish_experience_with_poster",
    ]);
    await unmount(tree);
  });
});

describe("#4548 experience Guest pack: leaving (tester, Retest 2)", () => {
  beforeEach(() => {
    releaseGuestPackSession("exp-new");
    mockRpc.mockImplementation(async (name: string) => {
      if (name === "biz_get_event_guest_pack") return { data: null, error: null };
      return { data: { event: { id: "exp-new" } }, error: null };
    });
  });
  const closeX = (tree: Renderer): TestInstance | undefined =>
    host(tree, "Pressable").find((n) => n.props.accessibilityLabel === "Cancel experience creation");
  const discardOpen = (tree: Renderer): boolean =>
    host(tree, "ConfirmDialogProbe").some(
      (n) => n.props.testID === "experience-wizard-discard-dialog" && n.props.visible !== false,
    );

  test("EXP-GP-4 pack-only change, Back, Close: asks; untouched: closes at once", async () => {
    for (const typed of [false, true]) {
      releaseGuestPackSession("exp-new");
      const onCancel = jest.fn();
      const tree = await mount(
        <ExperienceCreatorWizard brandId="brand-3284" onComplete={jest.fn()} onCancel={onCancel} initialDraft={seed()} />,
      );
      await pressButton(tree, "Continue");
      await settle();
      await settle();
      if (typed) {
        await act(async () => {
          setGuestPackNote("exp-new", "Meet at the gate");
        });
      }
      await pressBack(tree);
      await settle();
      await press(closeX(tree));
      await settle();
      if (typed) {
        expect(onCancel).not.toHaveBeenCalled();
        expect(discardOpen(tree)).toBe(true);
      } else {
        expect(discardOpen(tree)).toBe(false);
        expect(onCancel).toHaveBeenCalledTimes(1);
      }
      await unmount(tree);
    }
  });
});
