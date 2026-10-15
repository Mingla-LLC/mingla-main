/**
 * #3827 — typing on the Host website never drops letters (Sentry
 * MINGLA-BUSINESS-22, "Maximum update depth exceeded"), event creator.
 *
 * SYMPTOM: in the event creator, a host typing quickly into Description lost a
 * letter about every 50 characters.
 *
 * CAUSE: the creator wraps its steps in the turnout-intelligence provider. On
 * every keystroke the wizard handed it a fresh `source` object and a fresh
 * `navigateTo` function, so the provider rebuilt its context value, and an
 * effect pushed that value into provider state: a second update chained onto
 * every keystroke. Typed back to back, React's nested-update counter passed 50
 * and the next keystroke threw before its letter landed.
 *
 * WHAT RUNS HERE: the REAL EventCreatorWizard on Step 1 with its REAL draft
 * store, REAL Basics step (Name and Description fields), and the REAL turnout
 * provider chain (createDeferredTurnoutIntelProvider -> TurnoutIntelRuntime ->
 * TurnoutIntelObserver -> useTurnoutForecast), through react-native-web on a
 * concurrent react-test-renderer root. 120 characters are typed back to back
 * into Description, delivered through `unstable_flushSync` (a discrete,
 * synchronous update, as a browser input event is). Chrome, the other steps,
 * invites and network
 * services are inert stand-ins; none of them owns these fields or the provider.
 * The draft carries an image cover, as the reproduced draft did.
 *
 * FAILS ON REVERT: hand the wizard's raw `source` / `navigateTo` straight
 * through TurnoutIntelRuntime again and push values with a plain setState, and
 * this suite goes red with lost characters and the update-depth error.
 *
 * Run (from mingla-business/):
 *   npx jest --config jest.issue3827.web.render.cjs --ci --maxWorkers=2
 */

import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

// ---- environment ------------------------------------------------------------
// react-native-web's TextInput reads `document.activeElement` and its
// ImageLoader builds `new window.Image()`; node has neither. `window.document`
// stays undefined, so react-native-web still treats this as non-DOM.
class FakeImage {
  onload: ((event: unknown) => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 1600;
  naturalHeight = 900;
  set src(_value: string) {
    setTimeout(() => this.onload?.({}), 0);
  }
  decode(): Promise<void> {
    return Promise.resolve();
  }
}
Reflect.set(globalThis, "window", { Image: FakeImage });
Reflect.set(globalThis, "document", { activeElement: null });

type Node = {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: Node) => boolean) => Node[];
};
type Renderer = {
  root: Node;
  unmount: () => void;
  unstable_flushSync: (fn: () => void) => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};

// A declaration (hoisted), because the jest.mock factories below are hoisted.
function mockLeaf(name: string) {
  const ReactLocal = jest.requireActual<typeof React>("react");
  return (props: { children?: React.ReactNode }) =>
    ReactLocal.createElement(name, null, props.children);
}

// ---- boundaries -------------------------------------------------------------
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
  },
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: null, signOut: async () => undefined }),
}));
jest.mock("../../../wrappers/useKeyboardIsVisible", () => ({
  useKeyboardIsVisible: () => false,
}));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const ReactLocal = jest.requireActual<typeof React>("react");
  return {
    ScrollView: ReactLocal.forwardRef(
      (props: { children?: React.ReactNode }, ref) => {
        ReactLocal.useImperativeHandle(ref, () => ({
          scrollTo: () => undefined,
          scrollToEnd: () => undefined,
        }));
        return ReactLocal.createElement("mock-scroll", null, props.children);
      },
    ),
  };
});
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: false }),
}));
jest.mock("../../../hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({
    data: false,
    isPending: false,
    isFetching: false,
    isError: false,
  }),
}));
jest.mock("../../../hooks/useWizardHardwareBack", () => ({
  useWizardHardwareBack: () => undefined,
}));
jest.mock("../../../hooks/useOrganiserTermsPublishGate", () => ({
  useOrganiserTermsPublishGate: () => ({}),
}));
jest.mock("../../../services/postHogService", () => ({
  postHogService: { capture: () => undefined },
}));
jest.mock("../../../services/growthToolsService", () => ({
  GrowthToolsAppError: class extends Error {},
  mintClientRef: () => "client-ref",
  readRunByClientRef: async () => null,
  runGrowthTool: async () => {
    throw new Error("#3827 suite: no forecast runs");
  },
}));
jest.mock("../../ui/useShareNetworkState", () => ({
  useShareNetworkState: () => true,
}));
jest.mock("@mingla/brand-assets", () => ({ MINGLA_BUSINESS_LOGO: 1 }));
jest.mock("../../invites/LazyInvitePeopleStep", () => {
  const settled = { isPending: false, isFetching: false, isError: false };
  const summary = {
    plan: { ...settled, data: undefined },
    quote: { ...settled, data: undefined },
    refreshAuthoritative: async () => ({ plan: null, quote: null }),
  };
  return {
    InvitePlanSummaryBridge: () => null,
    PENDING_WIZARD_INVITE_SUMMARY: summary,
    InvitePeopleStep: mockLeaf("mock-invite-step"),
    InvitePlanReviewSummary: mockLeaf("mock-invite-review"),
    InvitePeoplePublishConfirmation: mockLeaf("mock-invite-confirm"),
  };
});
jest.mock("../../ui/Button", () => ({ Button: mockLeaf("mock-button") }));
jest.mock("../../ui/ConfirmDialog", () => ({
  ConfirmDialog: mockLeaf("mock-confirm"),
}));
jest.mock("../../ui/GlassCard", () => ({ GlassCard: mockLeaf("mock-glass") }));
jest.mock("../../ui/Icon", () => ({ Icon: mockLeaf("mock-icon") }));
jest.mock("../../ui/IconChrome", () => ({
  IconChrome: mockLeaf("mock-icon-chrome"),
}));
jest.mock("../../ui/Stepper", () => ({ Stepper: mockLeaf("mock-stepper") }));
jest.mock("../../ui/TopBar", () => ({ TopBar: mockLeaf("mock-topbar") }));
jest.mock("../../ui/Toast", () => ({ Toast: mockLeaf("mock-toast") }));
jest.mock("../../ui/Sheet", () => ({ Sheet: mockLeaf("mock-sheet") }));
jest.mock("../CreatorStep2When", () => ({
  CreatorStep2When: mockLeaf("mock-step-2"),
}));
jest.mock("../CreatorStep3Where", () => ({
  CreatorStep3Where: mockLeaf("mock-step-3"),
}));
jest.mock("../CreatorStep4Cover", () => ({
  CreatorStep4Cover: mockLeaf("mock-step-4"),
}));
jest.mock("../CreatorStep5Tickets", () => ({
  CreatorStep5Tickets: mockLeaf("mock-step-5"),
}));
jest.mock("../CreatorStep6Settings", () => ({
  CreatorStep6Settings: mockLeaf("mock-step-6"),
}));
jest.mock("../CreatorStep7Preview", () => ({
  CreatorStep7Preview: mockLeaf("mock-step-7"),
}));
jest.mock("../PublishErrorsSheet", () => ({
  PublishErrorsSheet: mockLeaf("mock-publish-errors"),
}));

// eslint-disable-next-line import/first
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// eslint-disable-next-line import/first
import {
  buildDraftEvent,
  useDraftEventStore,
  type DraftEvent,
} from "../../../store/draftEventStore";
// eslint-disable-next-line import/first
import { EventCreatorWizard } from "../EventCreatorWizard";
// eslint-disable-next-line import/first
import { AppState } from "react-native";

// react-native-web's AppState returns no subscription outside a DOM; the
// wizard's autosave flush subscribes on mount and removes on unmount.
jest
  .spyOn(AppState, "addEventListener")
  .mockImplementation(() => ({ remove: () => undefined }) as never);

const DRAFT_ID = "11111111-1111-4111-8111-111111113827";
const BRAND_ID = "22222222-2222-4222-8222-222222223827";

const typed = (seed: string): string =>
  Array.from({ length: 120 }, (_unused, index) => seed[index % seed.length]).join(
    "",
  );

const fieldNamed = (renderer: Renderer, label: string): Node => {
  const matches = renderer.root.findAll(
    (node) =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onChangeText === "function",
  );
  expect(matches.length).toBeGreaterThan(0);
  return matches[0];
};

const mountWizard = async (): Promise<Renderer> => {
  const store = useDraftEventStore.getState();
  const base = buildDraftEvent(BRAND_ID, DRAFT_ID);
  store.upsertDraft({
    ...base,
    coverMediaUrl: "https://example.test/brand_covers/salsa.jpg",
    coverMediaType: "image",
  } as DraftEvent);
  const draft = useDraftEventStore.getState().getDraft(DRAFT_ID) as DraftEvent;
  expect(draft).toBeDefined();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  let renderer: Renderer | null = null;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      <QueryClientProvider client={queryClient}>
        <EventCreatorWizard
          draft={draft}
          brand={null}
          initialStep={0}
          isCreateMode={false}
          onExit={() => undefined}
          onOpenPreview={() => undefined}
          onOpenPaymentOnboarding={() => undefined}
        />
      </QueryClientProvider>,
    );
  });
  // Let the lazy turnout runtime and observer load and publish a value, as
  // they have by the time a host starts typing.
  for (let tick = 0; tick < 5; tick += 1) {
    await TestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  return renderer as unknown as Renderer;
};

const typeBackToBack = (
  renderer: Renderer,
  label: string,
  text: string,
  readBack: () => string,
): { thrown: { at: number; message: string }[]; held: string } => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
  const thrown: { at: number; message: string }[] = [];
  let held = readBack();
  for (let index = 0; index < text.length; index += 1) {
    const next = held + text[index];
    const field = fieldNamed(renderer, label);
    try {
      renderer.unstable_flushSync(() => {
        (field.props.onChangeText as (value: string) => void)(next);
      });
    } catch (error) {
      thrown.push({ at: index + 1, message: String(error) });
    }
    held = readBack();
  }
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  return { thrown, held };
};

const storedDraft = (): DraftEvent =>
  useDraftEventStore.getState().getDraft(DRAFT_ID) as DraftEvent;

describe("#3827 event creator keeps every letter typed back to back", () => {
  test("120 back-to-back characters into Description: all land, no update-depth exception", async () => {
    const renderer = await mountWizard();
    // The real turnout provider is mounted around the steps.
    expect(
      renderer.root.findAll(
        (node) =>
          typeof node.type === "function" &&
          (node.type as { displayName?: string }).displayName ===
            "DeferredTurnoutIntelProvider",
      ).length,
    ).toBe(1);
    const text = typed("doors at nine, dress to dance ");
    const { thrown, held } = typeBackToBack(
      renderer,
      "Event description",
      text,
      () => storedDraft().description,
    );
    expect(thrown).toEqual([]);
    expect(held).toBe(text);
    await TestRenderer.act(async () => {
      renderer.unmount();
    });
  });
});
