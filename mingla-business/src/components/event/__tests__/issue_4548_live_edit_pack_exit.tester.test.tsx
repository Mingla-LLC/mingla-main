/* eslint-disable import/first */
// #4548 — tester: the published event editor must never drop an unsaved
// guest pack edit silently.
//
// Since 998963561a the main "Save changes" no longer lights up for a pack-only
// change (the pack has its own Save). This file drives the REAL
// EditPublishedScreen with the REAL guest pack working copy (only its network
// service is mocked) and walks every exit with a typed, unsaved pack change:
//   GP-EXIT-1  close with ONLY an unsaved pack change asks first (it must not leave)
//   GP-EXIT-2  Save changes with another change saves the pack first, then the rest
//   GP-EXIT-3  a failed pack save on Save changes keeps the host here, text intact
//
// Harness copied from issue_4420_unsaved_changes_guard.implementor.test.tsx.
import React from "react";
const mockFetchPack = jest.fn<(...a: unknown[]) => Promise<unknown>>();
const mockSavePack = jest.fn<(...a: unknown[]) => Promise<unknown>>();
jest.mock("../../../services/guestPackService", () => ({
  fetchEventGuestPack: (...a: unknown[]) => mockFetchPack(...a),
  saveEventGuestPack: (...a: unknown[]) => mockSavePack(...a),
}));


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
import {
  ensureGuestPackLoaded,
  getGuestPackSession,
  GUEST_PACK_SAVE_FAILED_COPY,
  releaseGuestPackSession,
  setGuestPackNote,
} from "../../../utils/guestPackSession";

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


const typePackNote = async (note: string): Promise<void> => {
  await act(async () => {
    await ensureGuestPackLoaded(SERVER_EVENT_ID);
    setGuestPackNote(SERVER_EVENT_ID, note);
  });
};

describe("#4548 the published editor never drops an unsaved guest pack silently", () => {
  beforeEach(() => {
    releaseGuestPackSession(SERVER_EVENT_ID);
    mockFetchPack.mockReset();
    mockSavePack.mockReset();
    mockUpdateLiveEventFields.mockClear();
    mockFetchPack.mockResolvedValue(null);
  });

  test("GP-EXIT-1 close with only an unsaved pack change asks before leaving", async () => {
    const tree = await mountEditor();
    await typePackNote("Door code 4548");
    await press(closeButton(tree));
    expect(mockSavePack).not.toHaveBeenCalled();
    // Either the pack is kept (dialog) or it was saved; leaving with it unsaved is a silent loss.
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(discardDialog(tree).props.visible).toBe(true);
    await act(async () => tree.unmount());
  });

  test("GP-EXIT-2 Save changes with another change saves the pack first", async () => {
    const tree = await mountEditor();
    await makeAChange(tree);
    await typePackNote("Door code 4548");
    mockSavePack.mockResolvedValue({ note: "Door code 4548", items: [], updatedAt: null });
    const save = host(tree, "ButtonProbe").find((n) => n.props.label === "Save changes") as TestInstance;
    await press(save);
    await flush();
    expect(mockSavePack).toHaveBeenCalledWith(SERVER_EVENT_ID, { note: "Door code 4548", items: [] });
    await act(async () => tree.unmount());
  });

  test("GP-EXIT-3 a failed pack save keeps the host on the screen with the text", async () => {
    const tree = await mountEditor();
    await makeAChange(tree);
    await typePackNote("Door code 4548");
    mockSavePack.mockRejectedValue(new Error("network down"));
    const save = host(tree, "ButtonProbe").find((n) => n.props.label === "Save changes") as TestInstance;
    await press(save);
    await flush();
    expect(mockUpdateLiveEventFields).not.toHaveBeenCalled();
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(getGuestPackSession(SERVER_EVENT_ID)?.note).toBe("Door code 4548");
    void GUEST_PACK_SAVE_FAILED_COPY;
    await act(async () => tree.unmount());
  });
});
