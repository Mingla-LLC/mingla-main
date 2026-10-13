/* eslint-disable import/first */
// issue #3827 [live event editor: buyer-aware reason] — implementor regression
// for the buyer who arrives while the editor is open.
//
// THE BUG. The editor read "no buyers" when it opened, so Review changes said
// "Reason (optional)". A ticket was then bought. The host saved with no reason
// and the server (correctly) refused with `invalid_edit_reason`. The editor
// closed the sheet on a "contact support and quote that code" toast and kept
// believing there were no buyers, so the same blank save failed again.
//
// WHAT THIS FILE PINS
//   RN-1  the REAL EditPublishedScreen, rendered, with the REAL
//         useEventBuyerCount under a real QueryClient. A blank-reason save
//         refused with `invalid_edit_reason`: reports the refusal, keeps
//         Review changes open, shows the plain reason-needed message (never
//         the contact-support one), and once the count is refetched the sheet
//         is handed the real count, which makes the reason mandatory.
//   RN-2  a refusal of a reason the host DID type is not blamed on a new
//         buyer: it keeps its existing handling.
//   RN-3  the event route invalidates the count through its key factory and
//         hands the callback to the editor; the RSVP route is untouched.
//
// FAILS-ON-REVERT: delete the `invalid_edit_reason` block from the save catch
// in EditPublishedScreen.tsx and RN-1 goes red (the sheet closes, the toast is
// the contact-support one, the count is never refetched); delete the
// `onReasonRefused` callback from app/event/[id]/edit.tsx and RN-3 goes red.

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";

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
jest.mock("../../ui/IconChrome", () => ({ IconChrome: (): null => null }));
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
import {
  eventBuyerCountKeys,
  useEventBuyerCount,
} from "../../../hooks/useEventBuyerCount";
import type { LiveEvent } from "../../../store/liveEventStore";
import type { TicketStub } from "../../../store/draftEventStore";
import { EditPublishedScreen } from "../EditPublishedScreen";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const REASON_NEEDED =
  "Someone has just bought a ticket. Add a reason so we can tell your buyers what changed.";
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

// The route's wrapper, reproduced: the count is read beside the editor and
// invalidated by its key factory when the editor reports a refused reason.
// RN-3 pins that app/event/[id]/edit.tsx does exactly this.
const refused = jest.fn();
function EditorWithBuyerCount(): React.ReactElement {
  const queryClient = useQueryClient();
  const buyerCount = useEventBuyerCount(SERVER_EVENT_ID);
  return (
    <EditPublishedScreen
      liveEvent={liveEvent}
      disableLocalSaveReason="Server-loaded events are readable here."
      buyerCount={buyerCount}
      onReasonRefused={() => {
        refused();
        void queryClient.invalidateQueries({
          queryKey: eventBuyerCountKeys.detail(SERVER_EVENT_ID),
        });
      }}
    />
  );
}

let buyersOnServer = 0;
const rpcNames = (): string[] => mockRpc.mock.calls.map((c) => c[0]);

/** Opens the editor on a no-buyer event, changes one setting, opens Review changes. */
const openReview = async (): Promise<Renderer> => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <QueryClientProvider client={client}>
        <EditorWithBuyerCount />
      </QueryClientProvider>,
    );
  });
  await flush();
  const settingsHeader = host(tree, "Pressable").find(
    (n) => n.props.accessibilityLabel === "Settings section (collapsed)",
  );
  expect(settingsHeader).toBeDefined();
  await press(settingsHeader as TestInstance);
  const toggle = host(tree, "Pressable").find(
    (n) => n.props.accessibilityLabel === "Require approval to buy",
  );
  expect(toggle).toBeDefined();
  await press(toggle as TestInstance);
  const save = host(tree, "ButtonProbe").find((n) => n.props.label === "Save changes");
  await press(save as TestInstance);
  const modal = host(tree, "ChangeSummaryModalProbe")[0];
  expect(modal.props.visible).toBe(true);
  // The editor opened on a known zero: the reason is optional.
  expect(modal.props.buyerCount).toBe(0);
  return tree;
};

const confirm = async (tree: Renderer, reason: string): Promise<void> => {
  const modal = host(tree, "ChangeSummaryModalProbe")[0];
  await act(async () => {
    await (modal.props.onConfirm as (reason: string) => Promise<void>)(reason);
    await wait(500);
  });
};

beforeEach(() => {
  mockRpc.mockReset();
  mockRouter.back.mockClear();
  mockUpdateLiveEventFields.mockClear();
  refused.mockClear();
  buyersOnServer = 0;
  mockRpc.mockImplementation(async (name) =>
    name === "business_event_buyer_count"
      ? { data: buyersOnServer, error: null }
      : { data: null, error: { message: "invalid_edit_reason" } },
  );
});

describe("issue #3827 — a buyer arrives while the editor is open", () => {
  test("RN-1: a refused blank reason keeps Review changes open, asks for a reason and refetches the count", async () => {
    const tree = await openReview();
    expect(rpcNames()).toEqual(["business_event_buyer_count"]);

    // A ticket is bought, then the host saves with no reason.
    buyersOnServer = 2;
    await confirm(tree, "");

    expect(rpcNames()).toEqual([
      "business_event_buyer_count",
      "business_update_live_event_atomic",
      "business_event_buyer_count",
    ]);
    expect(mockRpc.mock.calls[1][1].p_reason).toBe("");
    expect(refused).toHaveBeenCalledTimes(1);

    const toast = host(tree, "ToastProbe")[0];
    expect(toast.props.visible).toBe(true);
    expect(toast.props.message).toBe(REASON_NEEDED);
    expect(String(toast.props.message)).not.toMatch(/support|quote|saved/i);

    const modal = host(tree, "ChangeSummaryModalProbe")[0];
    // Still open, no longer submitting, and now told there are buyers: the
    // sheet requires a reason and shows the buyer copy for any count but 0.
    expect(modal.props.visible).toBe(true);
    expect(modal.props.submitting).toBe(false);
    expect(modal.props.buyerCount).toBe(2);

    // Nothing was saved, so nothing was written locally and nobody navigated.
    expect(mockUpdateLiveEventFields).not.toHaveBeenCalled();
    expect(mockRouter.back).not.toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
  });

  test("RN-2: a refused reason the host did type is not blamed on a new buyer", async () => {
    const tree = await openReview();
    await confirm(tree, "Tightening the door policy");

    expect(refused).not.toHaveBeenCalled();
    const toast = host(tree, "ToastProbe")[0];
    expect(toast.props.visible).toBe(true);
    expect(toast.props.message).not.toBe(REASON_NEEDED);
    expect(host(tree, "ChangeSummaryModalProbe")[0].props.visible).toBe(false);
    await act(async () => {
      tree.unmount();
    });
  });
});

describe("issue #3827 — the event route refetches the count on a refused reason", () => {
  const squash = (source: string): string => source.replace(/\s+/g, " ");
  const read = (rel: string): string =>
    fs.readFileSync(path.join(__dirname, rel), "utf8");
  const eventRoute = squash(read("../../../../app/event/[id]/edit.tsx"));
  const rsvpRoute = squash(read("../../../../app/rsvp/[id]/edit.tsx"));

  test("RN-3: the count is invalidated by its key factory and the callback reaches the editor", () => {
    expect(eventRoute).toContain(
      "void queryClient.invalidateQueries({ queryKey: eventBuyerCountKeys.detail(serverEventId), });",
    );
    expect(eventRoute).toContain(
      "const props = { ...routeProps, onReasonRefused };",
    );
    expect(eventRoute).toContain(
      "<EditPublishedScreen {...props} buyerCount={buyerCount} />",
    );
    // One key per entity: the route never spells the key out by hand.
    expect(eventRoute).not.toContain('"event-buyer-count"');
    expect(rsvpRoute).not.toContain("onReasonRefused");
  });
});
