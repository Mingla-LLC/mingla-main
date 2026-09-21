/* eslint-disable import/first */
// issue #3284 [refund terms on events and experiences] — implementor happy-path
// regression for the EXPERIENCE half (spec part 2 §C4; design §3.4, §4.2, §4.5).
//
// WHAT THIS FILE PINS — the REAL ExperienceCreatorWizard + ExperiencePricingStep,
// driven step by step, in all three modes:
//   XC-*  CREATE: the Pricing step shows the refund card (experience presets,
//         helper) before Guest privacy; publish writes the chosen terms through
//         the gated owner AFTER the draft row exists and BEFORE the publish RPC;
//         an unavailable owner stops the publish with a visible message.
//   XD-*  DRAFT-EDIT: seeded terms that did not change never call the owner; a
//         change is written (no reason) before the draft save.
//   XL-*  LIVE-EDIT: the sales warning shows; a downgrade the owner refuses shows
//         the new rejection copy inline + as a toast and sends nothing else; an
//         accepted change is written with the organiser's reason before
//         biz_update_live_experience.
//   XS-*  the detail service reads refund_policy, the edit route seeds it, and the
//         live-experience reject copy names the downgrade.
//
// FAILS-ON-REVERT: restore ExperienceCreatorWizard.tsx, ExperiencePricingStep.tsx,
// publishedExperienceEditGuards.ts, experienceDetailService.ts or
// app/experience/[id]/edit.tsx from origin/main and the matching block goes red.

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
  ExperienceCreatorWizard,
  type ExperienceWizardInitialDraft,
} from "../ExperienceCreatorWizard";
import { RefundPolicyEditor } from "../../trip/RefundPolicyEditor";

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

// ===========================================================================
// XC — create
// ===========================================================================

describe("XC — experience create wizard", () => {
  test("XC-1 the Pricing step shows the refund card (experience presets) before Guest privacy", async () => {
    mockRpc.mockResolvedValue({ data: { event: { id: "exp-new" } }, error: null });
    const tree = await mount(
      <ExperienceCreatorWizard brandId="brand-3284" onComplete={jest.fn()} initialDraft={seed()} />,
    );
    await toPricing(tree);
    const editor = tree.root.findAll((n) => n.type === RefundPolicyEditor);
    expect(editor).toHaveLength(1);
    expect(editor[0].props.offeringType).toBe("experience");
    expect(editor[0].props.value).toBeNull();
    const text = textOf(tree);
    expect(text).toContain("No refunds");
    expect(text.indexOf("REFUND POLICY")).toBeGreaterThan(-1);
    expect(text.indexOf("REFUND POLICY")).toBeLessThan(text.indexOf("GUEST PRIVACY"));
    // Free experience → the free helper.
    expect(text).toContain("This experience is free, so guests won't see this unless you add a price.");
    await unmount(tree);
  });

  test("XC-2 publish writes the chosen terms after the draft row exists and BEFORE the publish RPC", async () => {
    mockRpc.mockImplementation(async (name) => {
      if (name === "biz_create_experience") return { data: { event: { id: "exp-new" } }, error: null };
      if (name === "business_patch_offering_refund_policy") {
        return { data: { ok: true, refundPolicy: EVENT_STRICT_POLICY, changed: true }, error: null };
      }
      return { data: { event: { id: "exp-new" } }, error: null };
    });
    const onComplete = jest.fn();
    const tree = await mount(
      <ExperienceCreatorWizard brandId="brand-3284" onComplete={onComplete} initialDraft={seed()} />,
    );
    await toPricing(tree);
    await press(byTestId(tree, "refund-policy-chip-strict"));
    await pressButton(tree, "Continue");
    await pressButton(tree, "Publish");
    await settle();
    expect(rpcNames()).toEqual([
      "biz_create_experience",
      "business_patch_offering_refund_policy",
      "issue_1719_publish_experience_with_poster",
    ]);
    expect(mockRpc.mock.calls[1][1]).toEqual({
      p_event_id: "exp-new",
      p_policy: EVENT_STRICT_POLICY,
      p_reason: null,
    });
    expect(onComplete).toHaveBeenCalledWith("exp-new");
    await unmount(tree);
  });

  test("XC-3 an unavailable owner stops the publish with a visible message", async () => {
    mockRpc.mockImplementation(async (name) => {
      if (name === "biz_create_experience") return { data: { event: { id: "exp-new" } }, error: null };
      if (name === "business_patch_offering_refund_policy") {
        return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
      }
      return { data: { event: { id: "exp-new" } }, error: null };
    });
    const onComplete = jest.fn();
    const tree = await mount(
      <ExperienceCreatorWizard brandId="brand-3284" onComplete={onComplete} initialDraft={seed()} />,
    );
    await toPricing(tree);
    await press(byTestId(tree, "refund-policy-chip-flexible"));
    await pressButton(tree, "Continue");
    await pressButton(tree, "Publish");
    await settle();
    expect(rpcNames()).not.toContain("issue_1719_publish_experience_with_poster");
    expect(onComplete).not.toHaveBeenCalled();
    const toast = host(tree, "ToastProbe")[0];
    expect(toast.props.visible).toBe(true);
    expect(toast.props.message).toBe(REFUND_TERMS_UNAVAILABLE_COPY);
    await unmount(tree);
  });
});

// ===========================================================================
// XD — draft-edit
// ===========================================================================

describe("XD — experience draft-edit wizard", () => {
  test("XD-1 unchanged seeded terms never call the owner; a change is written before the draft save", async () => {
    mockRpc.mockImplementation(async (name) =>
      name === "business_patch_offering_refund_policy"
        ? { data: { ok: true, refundPolicy: EVENT_FLEXIBLE_POLICY, changed: true }, error: null }
        : { data: { event: { id: "exp-draft" } }, error: null },
    );
    const tree = await mount(
      <ExperienceCreatorWizard
        brandId="brand-3284"
        onComplete={jest.fn()}
        existingExperienceId="exp-draft"
        initialDraft={seed(EVENT_STANDARD_POLICY)}
      />,
    );
    await toPricing(tree);
    expect(tree.root.findAll((n) => n.type === RefundPolicyEditor)[0].props.value).toEqual(
      EVENT_STANDARD_POLICY,
    );
    await pressButton(tree, "Continue");
    await pressButton(tree, "Save as draft");
    await settle();
    expect(rpcNames()).toEqual(["issue_1719_publish_experience_with_poster"]);
    await unmount(tree);

    mockRpc.mockClear();
    const edited = await mount(
      <ExperienceCreatorWizard
        brandId="brand-3284"
        onComplete={jest.fn()}
        existingExperienceId="exp-draft"
        initialDraft={seed(EVENT_STANDARD_POLICY)}
      />,
    );
    await toPricing(edited);
    await press(byTestId(edited, "refund-policy-chip-flexible"));
    await pressButton(edited, "Continue");
    await pressButton(edited, "Save as draft");
    await settle();
    expect(rpcNames()).toEqual([
      "business_patch_offering_refund_policy",
      "issue_1719_publish_experience_with_poster",
    ]);
    expect(mockRpc.mock.calls[0][1]).toEqual({
      p_event_id: "exp-draft",
      p_policy: EVENT_FLEXIBLE_POLICY,
      p_reason: null,
    });
    expect((mockRpc.mock.calls[1][1] as { p_publish: boolean }).p_publish).toBe(false);
    await unmount(edited);
  });
});

// ===========================================================================
// XL — live-edit
// ===========================================================================

describe("XL — experience live-edit wizard", () => {
  const REASON = "Updating terms for the season";

  const openLive = async (chip: string): Promise<Renderer> => {
    const detail = liveDetail(EVENT_STANDARD_POLICY);
    const tree = await mount(
      <ExperienceCreatorWizard
        brandId="brand-3284"
        onComplete={jest.fn()}
        existingExperienceId="exp-live"
        initialDraft={seed(EVENT_STANDARD_POLICY)}
        liveExperience={detail}
        liveSoldCount={12}
      />,
    );
    await toPricing(tree);
    expect(textOf(tree)).toContain(
      "12 guests already booked under these terms. More-generous refunds or an extra tier save instantly — but you can't make terms worse for them here.",
    );
    await press(byTestId(tree, chip));
    await act(async () => {
      (host(tree, "LiveEditBannerProbe")[0].props.onReasonChange as (v: string) => void)(REASON);
    });
    await pressButton(tree, "Continue");
    await pressButton(tree, "Save changes");
    await settle();
    return tree;
  };

  test("XL-1 a refused downgrade shows the rejection inline + toast and sends nothing else", async () => {
    mockRpc.mockImplementation(async (name) =>
      name === "business_patch_offering_refund_policy"
        ? {
            data: { ok: false, reason: "refund_policy_downgrade_with_sales", affected_order_count: 12 },
            error: null,
          }
        : { data: { ok: true, event: { id: "exp-live" } }, error: null },
    );
    const tree = await openLive("refund-policy-chip-strict");
    expect(rpcNames()).toEqual(["business_patch_offering_refund_policy"]);
    expect(mockRpc.mock.calls[0][1]).toEqual({
      p_event_id: "exp-live",
      p_policy: EVENT_STRICT_POLICY,
      p_reason: REASON,
    });
    const copy =
      "You can't lower the refund terms — 12 buyers already booked under them. More-generous terms save instantly; to lower them, refund those buyers first.";
    expect(host(tree, "LiveEditBannerProbe")[0].props.errorMessage).toBe(copy);
    expect(host(tree, "ToastProbe")[0].props.message).toBe(copy);
    await unmount(tree);
  });

  test("XL-2 an accepted change is written with the reason BEFORE biz_update_live_experience", async () => {
    mockRpc.mockImplementation(async (name) =>
      name === "business_patch_offering_refund_policy"
        ? { data: { ok: true, refundPolicy: EVENT_FLEXIBLE_POLICY, changed: true }, error: null }
        : { data: { ok: true, event: { id: "exp-live" } }, error: null },
    );
    const tree = await openLive("refund-policy-chip-flexible");
    expect(rpcNames()).toEqual([
      "business_patch_offering_refund_policy",
      "biz_update_live_experience",
    ]);
    expect((mockRpc.mock.calls[1][1] as { p_reason: string }).p_reason).toBe(REASON);
    await unmount(tree);
  });
});

// ===========================================================================
// XS — service, route seed, copy
// ===========================================================================

describe("XS — detail read, edit-route seed, reject copy", () => {
  test("XS-1 getExperienceDetail selects and maps refund_policy", async () => {
    const selects: string[] = [];
    const row = {
      id: "exp-live",
      brand_id: "brand-3284",
      title: "Lagos Food Walk",
      slug: "lagos-food-walk",
      description: null,
      status: "scheduled",
      visibility: "public",
      currency: "GBP",
      timezone: "Europe/London",
      cover_media_url: null,
      cover_media_poster_url: null,
      cover_media_type: null,
      location_mode: "single",
      pricing_mode: "whole",
      experience_intent: null,
      experience_intents: [],
      whole_price_cents: 0,
      is_recurring: false,
      is_multi_date: false,
      recurrence_rules: null,
      event_type: "experience",
      theme: {},
      refund_policy: EVENT_STRICT_POLICY,
      brands: { slug: "sunset" },
    };
    const eventsChain = {
      select: (cols: string) => {
        selects.push(cols);
        return eventsChain;
      },
      eq: () => eventsChain,
      is: () => eventsChain,
      maybeSingle: () => Promise.resolve({ data: row, error: null }),
    };
    const listChain = {
      select: () => listChain,
      eq: () => listChain,
      is: () => listChain,
      order: () => Promise.resolve({ data: [], error: null }),
    };
    mockFrom.mockImplementation((table) => (table === "events" ? eventsChain : listChain));
    const detail = await getExperienceDetail("exp-live");
    expect(selects[0]).toContain("refund_policy");
    expect(detail?.refundPolicy).toEqual(EVENT_STRICT_POLICY);
  });

  test("XS-2 the edit route seeds the wizard with the saved terms, and the copy names the downgrade", () => {
    const route = readSource("app/experience/[id]/edit.tsx");
    expect(route).toContain("refundPolicy: exp.refundPolicy ?? null,");
    expect(liveExperienceRejectCopy("refund_policy_downgrade_with_sales", 1)).toBe(
      "You can't lower the refund terms — 1 buyer already booked under them. More-generous terms save instantly; to lower them, refund those buyers first.",
    );
  });
});
