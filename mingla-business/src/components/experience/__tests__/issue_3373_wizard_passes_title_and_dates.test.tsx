/* eslint-disable import/first */
/**
 * #3373 — the experience creator hands its Cover step the experience's title
 * and When state, so the Theme sheet can preview this experience instead of the
 * "Rooftop Sessions" sample.
 *
 * The REAL ExperienceCreatorWizard is mounted (harness pattern from
 * issue_3284_experience_refund_terms) and driven step by step to the Cover step.
 * The Cover step itself is a probe that records the props of every render;
 * issue_3373_experience_theme_preview.test.tsx mounts the real step.
 *
 * useExperienceDraftAdapter cannot load under this ts-jest project (its
 * synthetic DraftEvent does not type-check here, which is why the #3284 suite
 * mocks it too). Its stand-in keeps `whenState` in React state, exactly like the
 * real hook, and the source guard at the bottom pins that on the real file.
 *
 * Fails on revert:
 *   - ExperienceCreatorWizard.tsx without `title` / `when` on the Cover step ->
 *     every test here goes red;
 *   - a `when` rebuilt on each render (e.g. an inline object) -> the identity
 *     test goes red, because it would break the step's React.memo and bring back
 *     the META-ORCH-1059 cover freeze.
 */

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
jest.mock("../../event/CreatorStep2When", () => ({ CreatorStep2When: (): null => null }));
const mockCoverStepRenders: Record<string, unknown>[] = [];
jest.mock("../ExperienceCoverStep", () => ({
  ExperienceCoverStep: (props: Record<string, unknown>): null => {
    mockCoverStepRenders.push(props);
    return null;
  },
}));
jest.mock("../ExperienceStopsStep", () => ({ ExperienceStopsStep: (): null => null }));
jest.mock("../../pricing/WhoCoversCostsSection", () => ({
  WhoCoversCostsSection: (): null => null,
}));
jest.mock("../../offering/StripeBlockedCard", () => ({ StripeBlockedCard: (): null => null }));
jest.mock("../EditAfterPublishExperienceBanner", () => ({
  EditAfterPublishExperienceBanner: (): null => null,
}));

import type { CoverPatch } from "../../ui/CoverPicker";
import {
  ExperienceCreatorWizard,
  type ExperienceWizardInitialDraft,
} from "../ExperienceCreatorWizard";

// ---------------------------------------------------------------------------
// helpers + fixtures
// ---------------------------------------------------------------------------

const host = (tree: Renderer, type: string): TestInstance[] =>
  tree.root.findAll((node) => node.type === type);
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
const pressContinue = async (tree: Renderer): Promise<void> => {
  const button = host(tree, "ButtonProbe").find((n) => n.props.label === "Continue");
  expect(button).toBeDefined();
  await act(async () => {
    ((button as TestInstance).props.onPress as () => void)();
  });
  await settle();
};
/** Continue from Identity (1) to Cover (5). */
const toCover = async (tree: Renderer): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await pressContinue(tree);
  expect(mockCoverStepRenders.length).toBeGreaterThan(0);
};
const lastCoverStepProps = (): Record<string, unknown> =>
  mockCoverStepRenders[mockCoverStepRenders.length - 1];

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

const WHEN: NonNullable<ExperienceWizardInitialDraft["when"]> = {
  whenMode: "single",
  date: "2030-06-01",
  doorsOpen: "19:00",
  endsAt: "22:00",
  timezone: "Europe/London",
  recurrenceRule: null,
  multiDates: null,
};

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
  when: WHEN,
});

const themeChain = {
  select: () => themeChain,
  eq: () => themeChain,
  maybeSingle: () => Promise.resolve({ data: null, error: null }),
};

beforeEach(() => {
  mockCoverStepRenders.length = 0;
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: { event: { id: "exp-3373" } }, error: null });
  mockFrom.mockReset();
  mockFrom.mockImplementation(() => themeChain);
});

// ---------------------------------------------------------------------------

describe("#3373 — the experience creator passes its title and dates to the Cover step", () => {
  test("editing a draft: the Cover step receives the saved title and When state", async () => {
    const tree = await mount(
      <ExperienceCreatorWizard
        brandId="brand-3373"
        onComplete={jest.fn()}
        existingExperienceId="exp-3373"
        initialDraft={seed()}
      />,
    );
    await toCover(tree);
    const props = lastCoverStepProps();
    expect(props.title).toBe("Lagos Food Walk");
    expect(props.when).toEqual(
      expect.objectContaining({
        whenMode: "single",
        date: "2030-06-01",
        doorsOpen: "19:00",
        multiDates: null,
      }),
    );
    await act(async () => tree.unmount());
  });

  test("creating: a title typed on the first step reaches the Cover step", async () => {
    const tree = await mount(
      <ExperienceCreatorWizard
        brandId="brand-3373"
        onComplete={jest.fn()}
        initialDraft={seed()}
      />,
    );
    const titleInput = host(tree, "InputProbe").find(
      (n) => n.props.accessibilityLabel === "Experience title",
    );
    expect(titleInput).toBeDefined();
    await act(async () => {
      ((titleInput as TestInstance).props.onChangeText as (v: string) => void)(
        "Lagos Night Market",
      );
    });
    await toCover(tree);
    expect(lastCoverStepProps().title).toBe("Lagos Night Market");
    await act(async () => tree.unmount());
  });

  test("picking a cover re-renders the wizard, but title and When state keep their references", async () => {
    const tree = await mount(
      <ExperienceCreatorWizard
        brandId="brand-3373"
        onComplete={jest.fn()}
        existingExperienceId="exp-3373"
        initialDraft={seed()}
      />,
    );
    await toCover(tree);
    const before = lastCoverStepProps();
    const rendersBefore = mockCoverStepRenders.length;

    const picked: CoverPatch = {
      coverMediaUrl: "https://cdn.example.com/food-walk.jpg",
      coverMediaPosterUrl: null,
      coverMediaType: "image",
      coverMediaProvider: "upload",
      coverMediaSourceUrl: null,
      coverMediaCredit: null,
      coverMediaCreditUrl: null,
      coverMediaAlt: null,
    };
    await act(async () => {
      (before.onCoverChange as (patch: CoverPatch) => void)(picked);
    });

    expect(mockCoverStepRenders.length).toBeGreaterThan(rendersBefore);
    const after = lastCoverStepProps();
    expect(after.cover).toBe(picked);
    // Same references => React.memo can keep skipping renders that change nothing.
    expect(after.when).toBe(before.when);
    expect(after.title).toBe(before.title);
    expect(after.onCoverChange).toBe(before.onCoverChange);
    expect(after.onThemeChange).toBe(before.onThemeChange);
    await act(async () => tree.unmount());
  });
});

describe("#3373 — source guard on the Cover step mount", () => {
  test("the wizard's <ExperienceCoverStep> passes title and the adapter's When state", () => {
    const wizard = fs.readFileSync(
      path.join(__dirname, "..", "ExperienceCreatorWizard.tsx"),
      "utf8",
    );
    const mounts = wizard.match(/<ExperienceCoverStep\b[\s\S]*?\/>/g) ?? [];
    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toMatch(/\btitle=\{title\}/);
    expect(mounts[0]).toMatch(/\bwhen=\{whenAdapter\.whenState\}/);

    // whenState is React state, so it keeps its reference between renders.
    const adapter = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "hooks", "useExperienceDraftAdapter.ts"),
      "utf8",
    );
    expect(adapter).toMatch(
      /const \[whenState, setWhenState\] = useState<ExperienceWhenState>\(/,
    );
  });
});
