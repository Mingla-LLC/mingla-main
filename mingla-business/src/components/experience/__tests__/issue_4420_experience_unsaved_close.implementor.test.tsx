/* eslint-disable import/first */
// issue #4420 — the experience wizard keeps every field on screen until Save
// draft / Publish / Save changes (no field autosave), so closing it with edits
// lost them silently.
//
//   EXU-1 a fresh wizard (seeded, untouched) closes at once.
//   EXU-2 after the host edits a field, close opens the discard dialog and
//         does not leave; Keep editing stays; Discard leaves.
//
// FAILS-ON-REVERT: restore src/components/experience/ExperienceCreatorWizard.tsx
// from origin/main and EXU-2 goes red.
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
jest.mock("../../ui/Input", () => ({
  Input: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("InputProbe", props),
}));
jest.mock("../../ui/ConfirmDialog", () => ({
  ConfirmDialog: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ConfirmDialogProbe", props),
}));
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


const closeX = (tree: Renderer): TestInstance | undefined =>
  host(tree, "Pressable").find(
    (n) => n.props.accessibilityLabel === "Cancel experience creation",
  );
const discardDialog = (tree: Renderer): TestInstance | undefined =>
  host(tree, "ConfirmDialogProbe").find(
    (n) => n.props.testID === "experience-wizard-discard-dialog",
  );
const touchForm = async (tree: Renderer): Promise<void> => {
  const root = tree.root.findAll(
    (n) => typeof n.props.onStartShouldSetResponderCapture === "function",
  )[0];
  await act(async () => {
    (root.props.onStartShouldSetResponderCapture as () => boolean)();
  });
};
const typeTitle = async (tree: Renderer, value: string): Promise<void> => {
  const input = host(tree, "InputProbe").find(
    (n) => n.props.accessibilityLabel === "Experience title",
  );
  expect(input).toBeDefined();
  await act(async () => {
    (input!.props.onChangeText as (v: string) => void)(value);
  });
};

describe("#4420 closing the experience wizard with edits asks first", () => {
  test("EXU-1 an untouched wizard closes at once", async () => {
    const onCancel = jest.fn();
    const tree = await mount(
      <ExperienceCreatorWizard brandId="brand-3284" onComplete={jest.fn()} onCancel={onCancel} initialDraft={seed()} />,
    );
    await settle();
    await press(closeX(tree));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(discardDialog(tree)).toBeUndefined();
    await unmount(tree);
  });

  test("EXU-2 an edited wizard opens the discard dialog; Keep editing stays; Discard leaves", async () => {
    const onCancel = jest.fn();
    const tree = await mount(
      <ExperienceCreatorWizard brandId="brand-3284" onComplete={jest.fn()} onCancel={onCancel} initialDraft={seed()} />,
    );
    await settle();
    await touchForm(tree);
    await typeTitle(tree, "Lagos Night Food Walk");
    await press(closeX(tree));
    await settle();
    expect(onCancel).not.toHaveBeenCalled();
    expect(discardDialog(tree)?.props.visible).toBe(true);
    expect(discardDialog(tree)?.props.title).toBe("Discard your changes?");
    await act(async () => {
      (discardDialog(tree)!.props.onClose as () => void)();
    });
    expect(discardDialog(tree)).toBeUndefined();
    expect(onCancel).not.toHaveBeenCalled();
    await press(closeX(tree));
    await settle();
    await act(async () => {
      (discardDialog(tree)!.props.onConfirm as () => void)();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    await unmount(tree);
  });
});
