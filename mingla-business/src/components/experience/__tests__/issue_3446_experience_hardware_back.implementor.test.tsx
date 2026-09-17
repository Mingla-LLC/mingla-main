/* eslint-disable import/first */
/**
 * #3446 — Android hardware back, wired into the REAL ExperienceCreatorWizard
 * (SPEC §7 T-C).
 *
 * The wizard is mounted with the module-boundary harness of
 * issue_3373_wizard_passes_title_and_dates (copied, not shared). Its
 * `useWizardHardwareBack` call is captured, and a hardware back "press" runs
 * the REAL `dispatchWizardHardwareBackPress` against the config the wizard
 * passed on its latest render — so the wizard's own `goBack`, step state and
 * `submitting` flag decide what happens, exactly as on Android.
 *
 * Fails on revert:
 *   - the hook call deleted from the wizard           -> T-19 red (and T-16..18);
 *   - `submitting` dropped from busy                   -> T-18 red (steps back mid-save);
 *   - isFirstStep mapped wrong (e.g. `step === 0`)     -> T-17 red (decision is not "exit");
 *   - onStepBack bound to something other than goBack  -> T-16 red.
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
jest.mock("../../../services/businessEvents", () => ({
  setEventGuestPrivacy: async () => undefined,
}));
jest.mock("../../../services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));
jest.mock("../../../wrappers/useKeyboardIsVisible", () => ({
  useKeyboardIsVisible: () => false,
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-3373" } }),
}));
const mockBrand = {
  id: "brand-3373",
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
jest.mock("../../../hooks/useExperienceDraftAdapter", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactActual = require("react") as typeof React;
  return {
    useExperienceDraftAdapter: (
      _brandId: string,
      initialWhen?: Record<string, unknown>,
    ) => {
      const [whenState] = ReactActual.useState(() => ({
        whenMode: initialWhen?.whenMode ?? "single",
        date: initialWhen?.date ?? null,
        doorsOpen: initialWhen?.doorsOpen ?? null,
        endsAt: initialWhen?.endsAt ?? null,
        timezone: initialWhen?.timezone ?? "Europe/London",
        recurrenceRule: initialWhen?.recurrenceRule ?? null,
        multiDates: initialWhen?.multiDates ?? null,
      }));
      return {
        whenState,
        draftEvent: {},
        updateDraft: () => undefined,
        errors: [],
        showErrors: false,
        setShowErrors: () => undefined,
        isValid: true,
        toPayloadWhen: () => ({
          whenMode: whenState.whenMode,
          when: {
            date: whenState.date,
            doorsOpen: whenState.doorsOpen,
            endsAt: whenState.endsAt,
          },
          multiDates: null,
          recurrence_rules: null,
          timezone: whenState.timezone,
        }),
      };
    },
  };
});
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
jest.mock("../../ui/Toast", () => ({ Toast: (): null => null }));
jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));
jest.mock("../../ui/Input", () => ({
  Input: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("InputProbe", props),
}));
jest.mock("../../ui/Stepper", () => ({ Stepper: (): null => null }));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("GlassCardProbe", props, props.children),
}));
// Step probes: each records that it rendered, and is found in the tree by type.
const mockStepRenders: string[] = [];
jest.mock("../../event/CreatorStep2When", () => ({
  CreatorStep2When: (): null => {
    mockStepRenders.push("when");
    return null;
  },
}));
jest.mock("../ExperienceCoverStep", () => ({
  ExperienceCoverStep: (): null => {
    mockStepRenders.push("cover");
    return null;
  },
}));
jest.mock("../ExperienceStopsStep", () => ({
  ExperienceStopsStep: (): null => {
    mockStepRenders.push("stops");
    return null;
  },
}));
// #3446 — the wizard's hook call is captured; a "press" runs the REAL
// dispatcher against the config the wizard passed on its latest render.
const mockBackConfigs: WizardHardwareBackConfig[] = [];
jest.mock("../../../hooks/useWizardHardwareBack", () => ({
  useWizardHardwareBack: (config: WizardHardwareBackConfig): void => {
    mockBackConfigs.push(config);
  },
}));
jest.mock("../../pricing/WhoCoversCostsSection", () => ({
  WhoCoversCostsSection: (): null => null,
}));
jest.mock("../../offering/StripeBlockedCard", () => ({ StripeBlockedCard: (): null => null }));
jest.mock("../EditAfterPublishExperienceBanner", () => ({
  EditAfterPublishExperienceBanner: (): null => null,
}));
// The #1780 invite step loads react-native-reanimated (unparseable under this
// ts-jest project), so it is stubbed like the other steps. Flag off with a
// settled, empty saved plan gives the five-step list (Cover is the final step).
jest.mock("../../invites/InvitePeopleStep", () => ({
  InvitePeoplePublishConfirmation: (): null => null,
  InvitePeopleStep: (): null => null,
  InvitePlanReviewSummary: (): null => null,
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
  dispatchWizardHardwareBackPress,
  type WizardHardwareBackConfig,
  type WizardHardwareBackDecision,
} from "../../../hooks/wizardHardwareBackRouting";
import { ExperienceCoverStep } from "../ExperienceCoverStep";
import { ExperienceStopsStep } from "../ExperienceStopsStep";
import { CreatorStep2When } from "../../event/CreatorStep2When";
import {
  ExperienceCreatorWizard,
  type ExperienceWizardInitialDraft,
} from "../ExperienceCreatorWizard";

// ---------------------------------------------------------------------------
// helpers + fixtures
// ---------------------------------------------------------------------------

const host = (tree: Renderer, type: string): TestInstance[] =>
  tree.root.findAll((node) => node.type === type);
const rendered = (tree: Renderer, component: unknown): boolean =>
  tree.root.findAll((node) => node.type === component).length > 0;
const mount = async (element: React.ReactElement): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(element);
  });
  return tree;
};
const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};
const pressButton = async (tree: Renderer, label: string): Promise<void> => {
  const button = host(tree, "ButtonProbe").find((n) => n.props.label === label);
  expect(button).toBeDefined();
  await act(async () => {
    ((button as TestInstance).props.onPress as () => void)();
  });
  await settle();
};
const lastConfig = (): WizardHardwareBackConfig => {
  expect(mockBackConfigs.length).toBeGreaterThan(0);
  return mockBackConfigs[mockBackConfigs.length - 1];
};
/** One Android hardware back press, as the native hook would dispatch it. */
const hardwareBack = async (): Promise<WizardHardwareBackDecision> => {
  let decision!: WizardHardwareBackDecision;
  await act(async () => {
    decision = dispatchWizardHardwareBackPress("idle", lastConfig());
  });
  await settle();
  return decision;
};

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

const seed = (): ExperienceWizardInitialDraft => ({
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
  when: {
    whenMode: "single",
    date: "2030-06-01",
    doorsOpen: "19:00",
    endsAt: "22:00",
    timezone: "Europe/London",
    recurrenceRule: null,
    multiDates: null,
  },
});

const themeChain = {
  select: () => themeChain,
  eq: () => themeChain,
  maybeSingle: () => Promise.resolve({ data: null, error: null }),
};

const mountWizard = async (onCancel: () => void): Promise<Renderer> =>
  mount(
    <ExperienceCreatorWizard
      brandId="brand-3446"
      onComplete={jest.fn()}
      onCancel={onCancel}
      existingExperienceId="exp-3446"
      initialDraft={seed()}
    />,
  );

beforeEach(() => {
  mockStepRenders.length = 0;
  mockBackConfigs.length = 0;
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: { event: { id: "exp-3446" } }, error: null });
  mockFrom.mockReset();
  mockFrom.mockImplementation(() => themeChain);
});

// ---------------------------------------------------------------------------

describe("#3446 — Android hardware back in the real Experience creator", () => {
  test("T-19 the wizard wires the hardware back hook on every render", async () => {
    const tree = await mountWizard(jest.fn());
    expect(mockBackConfigs.length).toBeGreaterThan(0);
    const config = lastConfig();
    expect(config.isFirstStep).toBe(true);
    expect(config.busy).toBe(false);
    expect(config.exitSurfaced).toBe(false);
    expect(typeof config.onStepBack).toBe("function");
    expect(config.onExit).toBe(config.onStepBack);
    await act(async () => tree.unmount());
  });

  test("T-16 on Step 3 (When), back returns to Step 2 (Stops) and does not leave", async () => {
    const onCancel = jest.fn();
    const tree = await mountWizard(onCancel);
    await pressButton(tree, "Continue");
    await pressButton(tree, "Continue");
    expect(rendered(tree, CreatorStep2When)).toBe(true);
    expect(lastConfig().isFirstStep).toBe(false);

    const decision = await hardwareBack();

    expect(decision.action).toBe("step_back");
    expect(rendered(tree, ExperienceStopsStep)).toBe(true);
    expect(rendered(tree, CreatorStep2When)).toBe(false);
    expect(mockStepRenders[mockStepRenders.length - 1]).toBe("stops");
    expect(onCancel).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test("T-17 on Step 1, back runs the wizard's cancel exactly once", async () => {
    const onCancel = jest.fn();
    const tree = await mountWizard(onCancel);

    const decision = await hardwareBack();

    expect(decision.action).toBe("exit");
    expect(decision.nextLatch).toBe("exiting");
    expect(onCancel).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test("T-18 while Save as draft is in flight, back is swallowed and the step stays", async () => {
    const onCancel = jest.fn();
    const tree = await mountWizard(onCancel);
    for (let i = 0; i < 4; i += 1) await pressButton(tree, "Continue");
    expect(rendered(tree, ExperienceCoverStep)).toBe(true);
    expect(lastConfig().busy).toBe(false);

    mockRpc.mockImplementation(() => new Promise<RpcResult>(() => undefined));
    await pressButton(tree, "Save as draft");
    expect(mockRpc).toHaveBeenCalled();
    expect(lastConfig().busy).toBe(true);

    const decision = await hardwareBack();

    expect(decision.action).toBe("none");
    expect(rendered(tree, ExperienceCoverStep)).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });
});
