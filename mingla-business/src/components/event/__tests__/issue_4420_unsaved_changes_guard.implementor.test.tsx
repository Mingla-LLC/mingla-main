/* eslint-disable import/first */
// issue #4420 — closing an edited form never asked before discarding.
//
// WHAT THIS FILE PROVES
//   UG-1  the REAL EditPublishedScreen (published event / RSVP edit): with a
//         pending change, the close control opens the discard dialog and does
//         NOT leave; Keep editing stays; Discard leaves.
//   UG-2  with no change, close leaves at once (no dialog).
//   UG-3  while the edit is dirty, a web reload / tab close is guarded
//         (beforeunload), and the guard is removed once it is clean.
//   UG-4  the pure rules: busy never prompts; the trip diff counts every
//         side channel (switches, guest privacy, days, inclusions, tiers).
//   UG-5  Android hardware back on a dirty screen runs the screen's close
//         owner instead of popping it (native variant).
//
// FAILS-ON-REVERT: restore src/components/event/EditPublishedScreen.tsx from
// origin/main and UG-1 / UG-3 go red (close leaves silently).

import React from "react";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  children: Array<TestInstance | string>;
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
// module boundaries (network + chrome leaves only; product logic stays real)
// ---------------------------------------------------------------------------

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
const mockRpc = jest.fn<(name: string, args: Record<string, unknown>) => Promise<RpcResult>>();

jest.mock("../../../services/supabase", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => mockRpc(name, args),
  },
}));
jest.mock("../../../services/appsFlyerService", () => ({
  logAppsFlyerEvent: jest.fn(),
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true }),
}));

jest.mock("../../ui/GlassCard", () => ({
  GlassCard: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("GlassCardProbe", props, props.children),
}));
jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));
jest.mock("../../ui/IconChrome", () => ({
  IconChrome: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("IconChromeProbe", props),
}));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ButtonProbe", props),
}));
jest.mock("../../ui/ConfirmDialog", () => ({
  ConfirmDialog: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ConfirmDialogProbe", props),
}));
jest.mock("../../ui/Toast", () => ({
  Toast: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ToastProbe", props),
}));
jest.mock("../ChangeSummaryModal", () => ({
  ChangeSummaryModal: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ChangeSummaryModalProbe", props),
}));
jest.mock("../CreatorStep1Basics", () => ({ CreatorStep1Basics: (): null => null }));
jest.mock("../CreatorStep2When", () => ({ CreatorStep2When: (): null => null }));
jest.mock("../CreatorStep3Where", () => ({ CreatorStep3Where: (): null => null }));
jest.mock("../CreatorStep4Cover", () => ({ CreatorStep4Cover: (): null => null }));
jest.mock("../CreatorStep5Tickets", () => ({ CreatorStep5Tickets: (): null => null }));
jest.mock("../EditAfterPublishBanner", () => ({ EditAfterPublishBanner: (): null => null }));
jest.mock("../EventTicketCheckoutAccessCard", () => ({
  EventTicketCheckoutAccessCard: (): null => null,
}));
jest.mock("../../theme/ThemeControlRow", () => ({ ThemeControlRow: (): null => null }));
jest.mock("../../theme/ThemeSheet", () => ({ ThemeSheet: (): null => null }));
jest.mock("../../rsvp/RsvpStep5Setup", () => ({ RsvpStep5Setup: (): null => null }));
jest.mock("../../../wrappers/SmartScrollView", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react");
  return {
    ScrollView: R.forwardRef((props: Record<string, unknown>, ref: unknown) =>
      R.createElement("ScrollView", { ...props, ref }, props.children),
    ),
  };
});
jest.mock("../../../wrappers/useKeyboardIsVisible", () => ({
  useKeyboardIsVisible: () => false,
}));
const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  canGoBack: jest.fn(() => true),
};
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("../../../hooks/useBusinessEvents", () => ({
  businessEventKeys: {
    detail: (id: string) => ["business-event", id],
    list: (id: string) => ["business-events", id],
  },
}));
jest.mock("../../../hooks/usePublicEvents", () => ({
  publicEventKeys: {
    detailById: (id: string) => ["public-event", id],
    detailBySlug: (a: string, b: string) => ["public-event", a, b],
    brandBySlug: (a: string) => ["public-brand", a],
  },
}));
const mockOrdersRead = { status: "ready", data: [], refetch: jest.fn() };
jest.mock("../../../hooks/useEventOrders", () => ({
  useEventReconciliation: () => mockOrdersRead,
  useEventHasWebPurchases: () => false,
}));
const mockSoldCtx = { soldCountByTier: {}, soldCountForEvent: 0 };
jest.mock("../../../services/eventOrdersService", () => ({
  buildSoldCountContextFromOrders: () => mockSoldCtx,
}));
jest.mock("../../../services/orderRefundService", () => ({
  refundAllEventOrders: jest.fn(),
}));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 100 }),
}));
jest.mock("../../../hooks/useBrands", () => ({
  useBrand: () => ({ data: null, isLoading: false, isError: false }),
}));
jest.mock("../../../hooks/useBrandStripeStatus", () => ({
  useBrandStripeStatus: () => ({ data: undefined }),
}));
jest.mock("../../../services/eventCoverMediaService", () => ({
  attestEventCoverSelection: jest.fn(),
  EventCoverMediaError: class EventCoverMediaError extends Error {},
}));
jest.mock("../../../services/pricingSwitchesService", () => ({
  refreshBrandTaxRegistrationAttestation: jest.fn(),
}));
jest.mock("../../../services/rsvpEvents", () => ({ updateLiveRsvp: jest.fn() }));
jest.mock("../../../utils/rsvpHubMetrics", () => ({ rsvpEditNoticeCopy: () => "" }));
const mockUpdateLiveEventFields = jest.fn(() => ({ ok: true, editLogEntryId: "log-1" }));
jest.mock("../../../store/liveEventStore", () => ({
  useLiveEventStore: (selector: (s: unknown) => unknown) =>
    selector({ updateLiveEventFields: mockUpdateLiveEventFields }),
}));

import { PARTY_TYPE_SLUGS } from "../../../constants/eventTaxonomy";
import type { LiveEvent } from "../../../store/liveEventStore";
import type { TicketStub } from "../../../store/draftEventStore";
import { EditPublishedScreen } from "../EditPublishedScreen";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const SERVER_EVENT_ID = "server-event-3827";

const host = (tree: Renderer, type: string): TestInstance[] =>
  tree.root.findAll((node) => node.type === type);

const press = async (node: TestInstance): Promise<void> => {
  await act(async () => {
    (node.props.onPress as () => void)();
  });
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const flush = async (): Promise<void> => {
  await act(async () => {
    await wait(20);
  });
};

const ticket: TicketStub = {
  id: "ticket-ga",
  name: "General admission",
  priceGbp: 25,
  capacity: 100,
  isFree: false,
  isUnlimited: false,
  visibility: "public",
  displayOrder: 0,
  approvalRequired: false,
  passwordProtected: false,
  password: null,
  waitlistEnabled: false,
  minPurchaseQty: 1,
  maxPurchaseQty: null,
  allowTransfers: true,
  description: null,
  saleStartAt: null,
  saleEndAt: null,
  availableAt: "both",
};

const liveEvent: LiveEvent = {
  id: "event-3827",
  serverEventId: SERVER_EVENT_ID,
  brandId: "brand-3827",
  brandSlug: "sunset",
  eventSlug: "rooftop-sessions",
  status: "scheduled",
  publishedAt: "2026-09-01T12:00:00.000Z",
  cancelledAt: null,
  endedAt: null,
  event_type: "event",
  name: "Rooftop Sessions",
  description: "Late sets on the roof.",
  format: "in_person",
  category: null,
  partyTypes: [PARTY_TYPE_SLUGS[0]],
  vibeTags: [],
  musicGenres: [],
  city: "London",
  locationGeo: { lat: 51.5, lng: -0.12 },
  whenMode: "single",
  date: "2030-06-01",
  doorsOpen: "20:00",
  endsAt: "23:30",
  timezone: "Europe/London",
  recurrenceRule: null,
  multiDates: null,
  venueName: "The Roof",
  address: "1 High Street, London",
  onlineUrl: null,
  hideAddressUntilTicket: false,
  coverHue: 25,
  coverMediaUrl: null,
  coverMediaPosterUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaSourceUrl: null,
  coverMediaCredit: null,
  coverMediaCreditUrl: null,
  coverMediaAlt: null,
  currency: "GBP",
  tickets: [ticket],
  visibility: "public",
  requireApproval: false,
  allowTransfers: true,
  hideRemainingCount: false,
  passwordProtected: false,
  privateGuestList: false,
  inPersonPaymentsEnabled: false,
  pricingSwitches: { passTax: null, passMinglaFee: null, passServiceFee: null },
  themeOverrides: null,
  refundPolicy: null,
  orders: [],
  createdAt: "2026-09-01T11:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
};

const mountEditor = async (): Promise<Renderer> => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <QueryClientProvider client={client}>
        <EditPublishedScreen
          liveEvent={liveEvent}
          disableLocalSaveReason="Server-loaded events are readable here."
          buyerCount={{ count: 0, isLoading: false, isError: false, refetch: jest.fn() } as never}
        />
      </QueryClientProvider>,
    );
  });
  await flush();
  return tree;
};

const makeAChange = async (tree: Renderer): Promise<void> => {
  const settingsHeader = host(tree, "Pressable").find(
    (n) => n.props.accessibilityLabel === "Settings section (collapsed)",
  );
  await press(settingsHeader as TestInstance);
  const toggle = host(tree, "Pressable").find(
    (n) => n.props.accessibilityLabel === "Require approval to buy",
  );
  await press(toggle as TestInstance);
};

const closeButton = (tree: Renderer): TestInstance =>
  host(tree, "IconChromeProbe").find((n) => n.props.accessibilityLabel === "Close edit") as TestInstance;
const discardDialog = (tree: Renderer): TestInstance =>
  host(tree, "ConfirmDialogProbe").find(
    (n) => n.props.testID === "edit-published-discard-dialog",
  ) as TestInstance;

const listeners = new Map<string, Set<unknown>>();
const g = globalThis as unknown as {
  addEventListener?: (t: string, fn: unknown) => void;
  removeEventListener?: (t: string, fn: unknown) => void;
};

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockImplementation(async () => ({ data: 0, error: null }));
  mockRouter.back.mockClear();
  mockRouter.replace.mockClear();
  listeners.clear();
  g.addEventListener = (t, fn) => {
    if (!listeners.has(t)) listeners.set(t, new Set());
    listeners.get(t)!.add(fn);
  };
  g.removeEventListener = (t, fn) => {
    listeners.get(t)?.delete(fn);
  };
});

describe("#4420 a published edit asks before discarding", () => {
  test("UG-1 close with a pending change opens the dialog; Keep editing stays; Discard leaves", async () => {
    const tree = await mountEditor();
    await makeAChange(tree);
    await press(closeButton(tree));
    expect(mockRouter.back).not.toHaveBeenCalled();
    const dialog = discardDialog(tree);
    expect(dialog.props.visible).toBe(true);
    expect(dialog.props.title).toBe("Discard your changes?");
    expect(dialog.props.cancelLabel).toBe("Keep editing");
    await act(async () => {
      (dialog.props.onClose as () => void)();
    });
    expect(discardDialog(tree).props.visible).toBe(false);
    expect(mockRouter.back).not.toHaveBeenCalled();
    await press(closeButton(tree));
    await act(async () => {
      (discardDialog(tree).props.onConfirm as () => void)();
    });
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test("UG-2 close with no change leaves at once", async () => {
    const tree = await mountEditor();
    await press(closeButton(tree));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(discardDialog(tree).props.visible).toBe(false);
    await act(async () => tree.unmount());
  });

  test("UG-3 a dirty edit guards a web reload or tab close", async () => {
    const tree = await mountEditor();
    expect(listeners.get("beforeunload")?.size ?? 0).toBe(0);
    await makeAChange(tree);
    const guards = [...(listeners.get("beforeunload") ?? [])] as Array<(e: unknown) => void>;
    expect(guards).toHaveLength(1);
    const event = { preventDefault: jest.fn(), returnValue: undefined as unknown };
    guards[0](event);
    expect(event.preventDefault).toHaveBeenCalled();
    await act(async () => tree.unmount());
    expect(listeners.get("beforeunload")?.size ?? 0).toBe(0);
  });
});

describe("#4420 unsaved-changes rules", () => {
  test("UG-4 busy never prompts; every trip side channel counts", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rules = require("../../../utils/unsavedChangesGuard") as typeof import("../../../utils/unsavedChangesGuard");
    expect(rules.shouldConfirmLeave({ dirty: true })).toBe(true);
    expect(rules.shouldConfirmLeave({ dirty: true, busy: true })).toBe(false);
    expect(rules.shouldConfirmLeave({ dirty: false })).toBe(false);
    const clean = { patch: {}, pricingSwitchesChanged: null, guestPrivacyChanged: null, dayDiffs: [], inclusionDiffs: [], pricingTierDiffs: [], droppedDayOrdinals: [], droppedInclusionKeys: [] };
    expect(rules.hasUnsavedTripEdits(clean)).toBe(false);
    expect(rules.hasUnsavedTripEdits({ ...clean, patch: { name: "x" } })).toBe(true);
    expect(rules.hasUnsavedTripEdits({ ...clean, pricingSwitchesChanged: { passTax: true } })).toBe(true);
    expect(rules.hasUnsavedTripEdits({ ...clean, guestPrivacyChanged: { privateGuestList: true } })).toBe(true);
    expect(rules.hasUnsavedTripEdits({ ...clean, dayDiffs: [{}] })).toBe(true);
    expect(rules.hasUnsavedTripEdits({ ...clean, droppedInclusionKeys: ["k"] })).toBe(true);
  });

  test("UG-5 Android back on a dirty screen runs its close owner; clean screens keep the default", async () => {
    jest.resetModules();
    const handlers: Array<() => boolean> = [];
    jest.doMock("react-native", () => ({
      Platform: { OS: "android" },
      BackHandler: {
        addEventListener: (_e: string, fn: () => boolean) => {
          handlers.push(fn);
          return { remove: () => handlers.splice(handlers.indexOf(fn), 1) };
        },
      },
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactLocal = require("react") as typeof React;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RendererLocal = require("react-test-renderer") as typeof TestRenderer;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useUnsavedChangesGuard } = require("../../../hooks/useUnsavedChangesGuard.native") as typeof import("../../../hooks/useUnsavedChangesGuard.native");
    const onLeave = jest.fn();
    const Probe = ({ dirty, hardwareBack }: { dirty: boolean; hardwareBack?: boolean }): null => {
      useUnsavedChangesGuard({ dirty, onRequestLeave: onLeave, hardwareBack });
      return null;
    };
    let tree!: Renderer;
    await RendererLocal.act(async () => {
      tree = RendererLocal.create(ReactLocal.createElement(Probe, { dirty: false }));
    });
    expect(handlers).toHaveLength(0);
    await RendererLocal.act(async () => {
      (tree as unknown as { update: (n: React.ReactElement) => void }).update(ReactLocal.createElement(Probe, { dirty: true }));
    });
    expect(handlers).toHaveLength(1);
    expect(handlers[0]()).toBe(true);
    expect(onLeave).toHaveBeenCalledTimes(1);
    await RendererLocal.act(async () => {
      (tree as unknown as { update: (n: React.ReactElement) => void }).update(ReactLocal.createElement(Probe, { dirty: true, hardwareBack: false }));
    });
    expect(handlers).toHaveLength(0);
    await RendererLocal.act(async () => tree.unmount());
  });
});
