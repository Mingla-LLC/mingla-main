/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4473 — purchases shared with a second proven account, and "Is this your
 * ticket?" (implementor, render + behaviour).
 *
 *   - pg_my_shared_purchases is parsed defensively; shared purchases join the
 *     Purchases timeline marked `shared`, with no amount, and never twice.
 *   - The list card says "Shared"; an owned card does not.
 *   - The shared detail shows only the QR this account may present (not a
 *     ticket a friend holds), the shared note and the read-only line, and none
 *     of the owner's actions (send, take back, cancel, refund, PDF, manage).
 *   - The buyer's own purchase flagged by pg_my_purchase_share_flags shows the
 *     "Shows on both accounts" note.
 *   - Calendar gets shared orders, RSVPs and reservations (read-only rows),
 *     and a failed shared read never hides the buyer's own rows.
 *   - "Is this your ticket?": the ticket from the link, the masked purchase
 *     contact, Send code via claim-link contact_code_send, the code step via
 *     contact_code_verify, then Found with the shared note; the refusal codes
 *     keep their copy; "I can't get into that inbox" goes to Ask.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 */
import React from "react";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");
const { act } = TestRenderer;

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

jest.mock("react-i18next", () => {
  const purchases = jest.requireActual("../../../i18n/locales/en/purchases.json");
  const lookup = (key: string): unknown =>
    key.split(".").reduce<unknown>(
      (node, part) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      purchases,
    );
  const t = (key: string, options: Record<string, unknown> = {}): string => {
    const plural = typeof options.count === "number"
      ? lookup(`${key}_${options.count === 1 ? "one" : "other"}`)
      : undefined;
    const value = plural ?? lookup(key);
    if (typeof value !== "string") return key;
    return value.replace(/{{\s*(\w+)\s*}}/g, (match, name) =>
      name in options ? String(options[name]) : match
    );
  };
  return {
    initReactI18next: { type: "3rdParty", init: () => undefined },
    useTranslation: () => ({ t, i18n: { language: "en" } }),
  };
});

const mockSheetProps: Array<Record<string, unknown>> = [];
jest.mock("../../ui/BaseBottomSheet", () => {
  const ReactActual = jest.requireActual("react");
  const h = ReactActual.createElement;
  function BaseBottomSheet(props: Record<string, unknown>) {
    mockSheetProps.push(props);
    if (props.visible !== true) return null;
    return h("SheetHost", { testID: "sheet-host" }, props.children);
  }
  const BottomSheetTextInput = ReactActual.forwardRef(
    (props: Record<string, unknown>, _ref: unknown) => h("BottomSheetTextInput", props),
  );
  return { BaseBottomSheet, BottomSheetTextInput };
});
jest.mock("../../onboarding/OTPInput", () => {
  const ReactActual = jest.requireActual("react");
  return {
    OTPInput: (props: Record<string, unknown>) =>
      ReactActual.createElement("OTPInput", { ...props, testID: "otp" }),
  };
});
jest.mock("../../onboarding/PhoneInput", () => {
  const ReactActual = jest.requireActual("react");
  return {
    PhoneInput: (props: Record<string, unknown>) =>
      ReactActual.createElement("PhoneInput", props),
  };
});
jest.mock("../DoorModeModal", () => {
  const ReactActual = jest.requireActual("react");
  return {
    DoorModeModal: (props: Record<string, unknown>) =>
      ReactActual.createElement("DoorModeModal", { ...props, testID: "door-mode" }),
  };
});
jest.mock("react-native-qrcode-svg", () => {
  const ReactActual = jest.requireActual("react");
  return (props: Record<string, unknown>) =>
    ReactActual.createElement("QRCode", props);
});
jest.mock("@mingla/offering-rendering", () => {
  const ReactActual = jest.requireActual("react");
  return {
    EventCoverMedia: (props: Record<string, unknown>) =>
      ReactActual.createElement("EventCoverMedia", props),
  };
});
jest.mock("../../../constants/countries", () => {
  const directory = jest.requireActual("@mingla/phone-input/countries");
  return { ...directory, getDefaultCountryCode: () => "US" };
});

/** A tiny PostgREST double: every chain resolves to the table's queued answer. */
const mockTables: Record<string, { data: unknown; error: unknown }> = {};
const mockRpc = jest.fn();
const mockInvoke = jest.fn();
function mockChain(table: string): Record<string, unknown> {
  const answer = () => mockTables[table] ?? { data: [], error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (value: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(answer()).then(resolve, reject);
  return chain;
}
jest.mock("../../../services/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (table: string) => mockChain(table),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
  reactivateExplorerForVerifiedSession: jest.fn(),
}));
jest.mock("../../../lib/secureStoreSafe", () => ({
  secureGetItem: jest.fn(),
  secureSetItem: jest.fn(),
  secureDeleteItem: jest.fn(),
}));
jest.mock("../../../utils/explorerReactivation", () => ({
  withExplorerReactivationIntent: jest.fn(),
}));
jest.mock("../../../services/userActivityService", () => ({ userActivityService: {} }));
jest.mock("../../../services/cardEngagementService", () => ({ recordCardSchedule: jest.fn() }));
jest.mock("../../../services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));
const mockSweep = jest.fn();
jest.mock("../../../services/claimSweep", () => ({
  runClaimSweep: (...args: unknown[]) => mockSweep(...args),
}));
jest.mock("../../../config/queryClient", () => ({
  queryClient: {
    getQueryState: jest.fn(),
    invalidateQueries: jest.fn(() => Promise.resolve()),
  },
}));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
}));

const RN = require("react-native");
const {
  fetchMyPurchaseShareFlags,
  fetchMySharedPurchases,
  isPurchaseShareFlagged,
  parseSharedPurchases,
  sharedCalendarOrders,
  sharedCalendarReservations,
  sharedCalendarRsvps,
  sharedPurchaseSources,
} = require("../../../services/sharedPurchasesService");
const { CalendarService } = require("../../../services/calendarService");
const { mergeSharedSources } = require("../../../hooks/usePurchases");
const { buildPurchaseTimeline } = require("../../../utils/purchaseTimeline");
const { PurchaseCard } = require("../PurchaseCard");
const { PurchaseShareNote, SharedPurchaseDetail } = require("../SharedPurchaseDetail");
const { AddIdentitySheet, claimLinkContact } = require("../AddIdentitySheet");
const { parseClaimedEntries } = require("../../../services/attendanceClaimService");
const { sharedPurchaseRoute } = require("../../../services/sharedPurchasesService");
const { calendarPlanMessageControl } = require("../../brandEnquiry/calendarPlanMessage");
const { claimedEntryPath } = require("../missingTicketModel");

type Renderer = import("react-test-renderer").ReactTestRenderer;
type Node = import("react-test-renderer").ReactTestInstance;

const NOW = new Date("2026-11-17T12:00:00.000Z");
const FUTURE = "2026-12-15T19:00:00.000Z";
const FUTURE_END = "2026-12-15T23:00:00.000Z";

function sharedOrder(overrides: Record<string, unknown> = {}) {
  return {
    kind: "order",
    sourceId: "order-s1",
    role: "shared",
    sharedWithAnotherAccount: true,
    sharedAt: "2026-11-17T10:00:00.000Z",
    title: "Live payment test",
    offeringType: "event",
    createdAt: "2026-11-10T10:00:00.000Z",
    orderId: "order-s1",
    eventId: "event-1",
    eventSlug: "live-payment-test",
    coverMediaUrl: null,
    coverMediaType: null,
    timezone: "Europe/London",
    locationText: "Lantern Room",
    city: "London",
    isOnline: false,
    onlineUrl: null,
    brand: { id: "brand-1", slug: "lantern", name: "Lantern Room" },
    eventDateId: "date-1",
    bookedStartAt: null,
    eventDates: [{ id: "date-1", startAt: FUTURE, endAt: FUTURE_END, isMaster: true }],
    paymentStatus: "paid",
    cancelledAt: null,
    source: "web",
    tickets: [
      { id: "t1", ticketIndex: 1, ticketTypeId: "tt", ticketTypeName: "General", status: "valid", approvalStatus: null, transferState: "none", qrCode: "QR-ONE", eventDateIds: [] },
      { id: "t2", ticketIndex: 2, ticketTypeId: "tt", ticketTypeName: "General", status: "valid", approvalStatus: null, transferState: "claimed", qrCode: null, eventDateIds: [] },
    ],
    ...overrides,
  };
}

function sharedRsvp(overrides: Record<string, unknown> = {}) {
  return {
    kind: "rsvp",
    sourceId: "rsvp-s1",
    role: "shared",
    sharedWithAnotherAccount: true,
    title: "Neighbors Night",
    offeringType: "rsvp",
    createdAt: "2026-11-10T10:00:00.000Z",
    rsvpId: "rsvp-s1",
    eventId: "event-2",
    eventSlug: "neighbors-night",
    timezone: "America/New_York",
    locationText: "61 Wythe Ave",
    brand: { id: "brand-2", slug: "wythe", name: "Wythe" },
    startsAt: FUTURE,
    endsAt: FUTURE_END,
    rsvpStatus: "going",
    approvalStatus: "approved",
    quantity: 2,
    qrCode: "RSVP-QR",
    checkedIn: false,
    ...overrides,
  };
}

function sharedReservation(overrides: Record<string, unknown> = {}) {
  return {
    kind: "reservation",
    sourceId: "res-s1",
    role: "shared",
    sharedWithAnotherAccount: true,
    title: "Table at Harmattan",
    offeringType: "venue",
    createdAt: "2026-11-10T10:00:00.000Z",
    reservationId: "res-s1",
    venueId: "venue-1",
    venueName: "Harmattan",
    startsAt: FUTURE,
    partySize: 4,
    status: "confirmed",
    timezone: "Africa/Lagos",
    ...overrides,
  };
}

function sharedStay(overrides: Record<string, unknown> = {}) {
  return {
    kind: "stay_group",
    sourceId: "stay-s1",
    stayGroupId: "stay-s1",
    role: "shared",
    sharedWithAnotherAccount: true,
    sharedAt: "2026-11-17T10:00:00.000Z",
    venueId: "venue-9",
    venueName: "Harbour House",
    title: "Harbour House",
    offeringType: "stay",
    publicReference: "STAY-7Q2K",
    state: "confirmed",
    mode: "instant",
    createdAt: "2026-11-10T10:00:00.000Z",
    ...overrides,
  };
}

const mounted: Renderer[] = [];
function render(element: React.ReactElement): Renderer {
  let renderer: Renderer | null = null;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  mounted.push(renderer as unknown as Renderer);
  return renderer as unknown as Renderer;
}
function byId(renderer: Renderer, id: string): Node {
  const found = renderer.root.findAll(
    (node) => node.props?.testID === id && typeof node.type !== "string",
  )[0] ?? renderer.root.findAll((node) => node.props?.testID === id)[0];
  if (!found) throw new Error(`no node with testID ${id}`);
  return found;
}
function maybeId(renderer: Renderer, id: string): Node | undefined {
  return renderer.root.findAll((node) => node.props?.testID === id)[0];
}
function text(renderer: Renderer): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (typeof node === "string") return void parts.push(node);
    if (Array.isArray(node)) return void node.forEach(walk);
    walk((node as { children?: unknown }).children);
  };
  walk(renderer.toJSON());
  return parts.join(" ");
}
async function press(node: Node): Promise<void> {
  await act(async () => {
    await node.props.onPress();
  });
}
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

function sharedTimelineItem(raw: Record<string, unknown>) {
  const timeline = buildPurchaseTimeline(
    sharedPurchaseSources(parseSharedPurchases([raw])),
    NOW,
  );
  return [...timeline.upcoming, ...timeline.past].flatMap((group) => group.items)[0];
}

beforeEach(() => {
  mockSheetProps.length = 0;
  mockRpc.mockReset();
  mockInvoke.mockReset();
  mockSweep.mockReset();
  mockPush.mockReset();
  for (const key of Object.keys(mockTables)) delete mockTables[key];
  jest.spyOn(RN.AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
  jest.spyOn(RN.AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
  // react-native-web's Keyboard.dismiss reads `document`, absent in this node lane.
  jest.spyOn(RN.Keyboard, "dismiss").mockImplementation(() => undefined);
});
afterEach(() => {
  for (const renderer of mounted.splice(0)) {
    act(() => {
      renderer.unmount();
    });
  }
  jest.restoreAllMocks();
});

describe("#4473 shared purchases: data", () => {
  test("the payload is parsed defensively; junk rows are dropped", () => {
    const parsed = parseSharedPurchases([
      sharedOrder(),
      { kind: "bogus", sourceId: "x", title: "x" },
      { kind: "order", title: "no id" },
      null,
      sharedRsvp({ quantity: "lots" }),
    ]);
    expect(parsed.map((row: { kind: string }) => row.kind)).toEqual(["order", "rsvp"]);
    expect(parsed[0].tickets[1].qrCode).toBeNull();
    expect(parsed[1].quantity).toBe(1);
    expect(parseSharedPurchases({ not: "an array" })).toEqual([]);
  });

  test("RPC reads: shared purchases and the owner's share flags", async () => {
    mockRpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === "pg_my_shared_purchases"
          ? { data: [sharedOrder()], error: null }
          : { data: [{ kind: "order", source_id: "own-1" }, { kind: "rsvp_guest", source_id: "g-1" }], error: null },
      )
    );
    expect((await fetchMySharedPurchases())[0].sourceId).toBe("order-s1");
    const flags = await fetchMyPurchaseShareFlags();
    expect(flags).toEqual(["order:own-1", "rsvp_guest:g-1"]);
    expect(isPurchaseShareFlagged(flags, "order", ["own-1"])).toBe(true);
    expect(isPurchaseShareFlagged(flags, "rsvp", ["r-9", "g-1"])).toBe(true);
    expect(isPurchaseShareFlagged(flags, "reservation", ["own-1"])).toBe(false);
  });

  test("shared purchases join the timeline marked shared, without amounts, never twice", () => {
    const owned = {
      orders: [{
        id: "order-own", eventId: "e", eventTitle: "Own show", eventType: "event",
        brandName: "B", coverMediaUrl: null, startAt: FUTURE, endAt: FUTURE_END,
        timezone: "UTC", venueLine: null, paymentStatus: "paid", ticketCount: 1,
        validTicketCount: 1, source: null, currency: "USD", buyerTotalCents: 2500,
        refundedAmountCents: 0, raw: {},
      }],
      rsvps: [],
      reservations: [],
      venueOrders: [],
    };
    const shared = parseSharedPurchases([
      sharedOrder(),
      sharedOrder({ sourceId: "order-own", orderId: "order-own" }),
      sharedRsvp(),
      sharedReservation(),
      {
        kind: "stay_group", sourceId: "stay-1", role: "shared", sharedWithAnotherAccount: true,
        title: "Stay", offeringType: "stay", createdAt: "2026-11-01T10:00:00Z",
        stayGroupId: "stay-1", venueId: "venue-1", venueName: "Lantern Room",
        publicReference: "LR-1", state: "confirmed", mode: "nightly",
      },
    ]);
    const sources = mergeSharedSources(owned, shared);
    expect(sources.orders.map((order: { id: string }) => order.id)).toEqual(["order-own", "order-s1"]);
    const items = [...buildPurchaseTimeline(sources, NOW).upcoming]
      .flatMap((group: { items: unknown[] }) => group.items) as Array<Record<string, unknown>>;
    const own = items.find((item) => item.id === "order-own")!;
    const sharedOrderItem = items.find((item) => item.id === "order-s1")!;
    expect(own.shared).toBe(false);
    expect(own.amountCents).toBe(2500);
    expect(sharedOrderItem.shared).toBe(true);
    expect(sharedOrderItem.amountCents).toBeNull();
    // Only the ticket this account may present counts; the friend's does not.
    expect(sharedOrderItem.count).toBe(1);
    expect(items.find((item) => item.kind === "rsvp")?.shared).toBe(true);
    expect(items.find((item) => item.kind === "reservation")?.amountCents).toBeNull();
    // A well-formed shared stay is listed too (D5), read-only and with no amount.
    const stay = items.find((item) => item.kind === "stay");
    expect(stay?.shared).toBe(true);
    expect(stay?.amountCents ?? null).toBeNull();
    expect(items).toHaveLength(5);
  });

  test("Calendar rows: paid orders, going RSVPs and reservations, all read-only", () => {
    const parsed = parseSharedPurchases([
      sharedOrder(),
      sharedOrder({ sourceId: "o-ref", orderId: "o-ref", paymentStatus: "refunded" }),
      sharedRsvp(),
      sharedRsvp({ sourceId: "r-off", rsvpId: "r-off", rsvpStatus: "cancelled" }),
      sharedReservation(),
    ]);
    const orders = sharedCalendarOrders(parsed);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ orderId: "order-s1", shared: true, ticketPdfPath: null, publicBuyerUrl: null, masterDateUtc: FUTURE });
    expect(orders[0].tickets.map((ticket: { qrCode: string }) => ticket.qrCode)).toEqual(["QR-ONE"]);
    const rsvps = sharedCalendarRsvps(parsed);
    expect(rsvps.map((row: { rsvpId: string }) => row.rsvpId)).toEqual(["rsvp-s1"]);
    expect(rsvps[0].shared).toBe(true);
    const reservations = sharedCalendarReservations(parsed);
    expect(reservations[0]).toMatchObject({ id: "res-s1", shared: true, fee_cents: null, party_size: 4 });
  });

  test("Calendar fetch appends shared orders, and keeps own rows when the shared read fails", async () => {
    mockTables.orders = { data: [], error: null };
    mockRpc.mockResolvedValueOnce({ data: [sharedOrder()], error: null });
    const rows = await CalendarService.fetchUserBusinessEventOrders("user-1");
    expect(rows.map((row: { orderId: string; shared?: boolean }) => [row.orderId, row.shared])).toEqual([["order-s1", true]]);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await CalendarService.fetchUserBusinessEventOrders("user-1")).toEqual([]);
    warn.mockRestore();
  });

  test("Calendar RSVPs keep the account's own rows and add shared ones", async () => {
    mockRpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === "fetch_user_going_rsvps"
          ? { data: [], error: null }
          : { data: [sharedRsvp()], error: null },
      )
    );
    const rows = await CalendarService.fetchUserGoingRsvps("user-1");
    expect(rows.map((row: { rsvpId: string; shared?: boolean }) => [row.rsvpId, row.shared])).toEqual([["rsvp-s1", true]]);
  });

  test("claimed entries read the optional role", () => {
    const base = {
      kind: "order", id: "o1", routeKind: "order", routeId: "o1", offeringType: "event",
      noun: "ticket", title: "T", timezone: "UTC", source: "purchase",
    };
    const [plain, shared] = parseClaimedEntries([base, { ...base, id: "o2", role: "shared", sharedWithAnotherAccount: true }]);
    expect(plain.role).toBeNull();
    expect(shared.role).toBe("shared");
    expect(shared.sharedWithAnotherAccount).toBe(true);
  });
});

describe("#4473 shared purchases: list and detail", () => {
  test("the list card says Shared and shows no amount; an owned card does not", () => {
    const item = sharedTimelineItem(sharedOrder());
    const shared = render(React.createElement(PurchaseCard, { item, onPress: jest.fn() }));
    expect(maybeId(shared, "purchase-card-shared")).toBeTruthy();
    expect(text(shared)).toContain("Shared");
    expect(text(shared)).not.toContain("$");
    const owned = render(
      React.createElement(PurchaseCard, {
        item: { ...item, shared: false, amountCents: 2500, currency: "USD" },
        onPress: jest.fn(),
      }),
    );
    expect(maybeId(owned, "purchase-card-shared")).toBeUndefined();
  });

  test("shared detail: presentable QR only, the note, and no owner actions", async () => {
    mockTables.conversations = { data: [{ id: "conv-1", event_id: "event-1" }], error: null };
    const onOpenChat = jest.fn();
    const onOpenEventPage = jest.fn();
    const renderer = render(
      React.createElement(SharedPurchaseDetail, {
        item: sharedTimelineItem(sharedOrder()),
        qrSize: 200,
        onAddToCalendar: jest.fn(),
        onOpenChat,
        onOpenEventPage,
      }),
    );
    await flush();
    const qrs = renderer.root.findAll((node) => node.type === "QRCode");
    expect(qrs.map((node) => node.props.value)).toEqual(["QR-ONE"]);
    expect(maybeId(renderer, "purchase-share-note-shared")).toBeTruthy();
    const copy = text(renderer);
    expect(copy).toContain("Only the buyer can send, cancel or change it.");
    for (const ownerOnly of [
      "Send to a friend", "Take it back", "Cancel booking", "Download PDF",
      "Manage booking", "Change or cancel this RSVP", "Refunds and help",
      "Receipt", "Follow", "•••", "$",
    ]) {
      expect(copy).not.toContain(ownerOnly);
    }
    await press(byId(renderer, "shared-open-chat"));
    expect(onOpenChat).toHaveBeenCalledWith("conv-1", "event-1");
    await press(byId(renderer, "shared-open-event"));
    expect(onOpenEventPage.mock.calls[0][0].eventSlug).toBe("live-payment-test");
    await press(byId(renderer, "shared-show-at-door"));
    const door = byId(renderer, "door-mode");
    expect(door.props.visible).toBe(true);
    expect(door.props.tickets.map((ticket: { qrCode: string }) => ticket.qrCode)).toEqual(["QR-ONE"]);
  });

  test("shared RSVP and booking show their own passes; a pending RSVP shows none", async () => {
    const rsvp = render(
      React.createElement(SharedPurchaseDetail, {
        item: sharedTimelineItem(sharedRsvp()),
        qrSize: 200,
        onAddToCalendar: jest.fn(),
        onOpenChat: jest.fn(),
        onOpenEventPage: jest.fn(),
      }),
    );
    await flush();
    expect(rsvp.root.findAll((node) => node.type === "QRCode").map((node) => node.props.value)).toEqual(["RSVP-QR"]);
    const pending = render(
      React.createElement(SharedPurchaseDetail, {
        item: sharedTimelineItem(sharedRsvp({ approvalStatus: "pending" })),
        qrSize: 200,
        onAddToCalendar: jest.fn(),
        onOpenChat: jest.fn(),
        onOpenEventPage: jest.fn(),
      }),
    );
    await flush();
    expect(pending.root.findAll((node) => node.type === "QRCode")).toHaveLength(0);
    const booking = render(
      React.createElement(SharedPurchaseDetail, {
        item: sharedTimelineItem(sharedReservation()),
        qrSize: 200,
        onAddToCalendar: jest.fn(),
        onOpenChat: jest.fn(),
        onOpenEventPage: jest.fn(),
      }),
    );
    await flush();
    expect(booking.root.findAll((node) => node.type === "QRCode").map((node) => node.props.value))
      .toEqual(["mingla://reservation/res-s1"]);
    expect(text(booking)).toContain("Party size");
    expect(maybeId(booking, "shared-open-chat")).toBeUndefined();
  });

  test("the buyer's own flagged purchase gets the both-accounts note", () => {
    const renderer = render(React.createElement(PurchaseShareNote, { kind: "order", variant: "owner" }));
    expect(text(renderer)).toBe("Shows on both accounts. One ticket, scans once.");
  });
});

describe("#4473 Is this your ticket?", () => {
  const claim = {
    code: "AB12CD34EF",
    noun: "ticket",
    title: "Live payment test",
    orderLabel: null,
    startsAt: FUTURE,
    timezone: "Europe/London",
    emailMasked: "s•••••••@gmail.com",
    phoneLast4: "2876",
    preferredProof: "any",
    expired: false,
  };
  function landed(props: Record<string, unknown> = {}): Renderer {
    return render(
      React.createElement(AddIdentitySheet, {
        visible: true,
        initialStep: "landed",
        claimLink: claim,
        userId: "user-1",
        identifiers: [],
        onClose: jest.fn(),
        ...props,
      }),
    );
  }
  function httpError(status: number, body: Record<string, unknown>) {
    return {
      data: null,
      error: { message: "x", context: { status, json: async () => body } },
    };
  }

  test("picks the contact to prove, masked", () => {
    expect(claimLinkContact(claim)).toEqual({ channel: "email", display: "s•••••••@gmail.com" });
    expect(claimLinkContact({ ...claim, preferredProof: "phone" })).toEqual({ channel: "phone", display: "•••• 2876" });
    expect(claimLinkContact({ ...claim, emailMasked: null })).toEqual({ channel: "phone", display: "•••• 2876" });
    expect(claimLinkContact({ ...claim, emailMasked: null, phoneLast4: null })).toBeNull();
  });

  test("ticket, masked contact, Send code, the code step, then Found with the shared note", async () => {
    mockInvoke
      .mockResolvedValueOnce({ data: { ok: true, challengeId: "11111111-1111-4111-8111-111111111111", channel: "email", sentTo: "s•••@gmail.com" }, error: null })
      .mockResolvedValueOnce({
        data: {
          ok: true,
          claimed: {
            count: 1,
            more: false,
            claimed: [{
              kind: "order", id: "o1", routeKind: "order", routeId: "order-1", offeringType: "event",
              noun: "ticket", title: "Live payment test", timezone: "Europe/London", source: "purchase",
              startsAt: FUTURE, venueLine: null, quantity: 1, chatJoined: true,
              sharedWithAnotherAccount: true, role: "shared",
            }],
          },
        },
        error: null,
      });
    mockSweep.mockResolvedValue({ count: 0, eventIds: [], claims: [], claimed: [], more: false, rateLimited: false, throttled: false, reason: "add_identity" });
    const renderer = landed();
    const copy = text(renderer);
    expect(copy).toContain("Is this your ticket?");
    expect(copy).toContain("Live payment test");
    expect(copy).toContain("It was bought with s•••••••@gmail.com.");
    expect(copy).toContain("From your link");
    await press(byId(renderer, "add-identity-landed-send"));
    expect(mockInvoke).toHaveBeenCalledWith("claim-link", {
      body: { op: "contact_code_send", code: "AB12CD34EF", channel: "email" },
    });
    expect(text(renderer)).toContain("Sent to s•••@gmail.com");
    await act(async () => {
      byId(renderer, "otp").props.onComplete("123456");
    });
    await flush();
    expect(mockInvoke).toHaveBeenLastCalledWith("claim-link", {
      body: { op: "contact_code_verify", challengeId: "11111111-1111-4111-8111-111111111111", otp: "123456" },
    });
    expect(text(renderer)).toContain("Found 1 ticket");
    expect(maybeId(renderer, "add-identity-shared-note")).toBeTruthy();
  });

  test("already proven: no code, straight to the result", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ok: true, alreadyConfirmed: true, claimed: { count: 0, more: false, claimed: [] } }, error: null });
    mockSweep.mockResolvedValue({ count: 0, eventIds: [], claims: [], claimed: [], more: false, rateLimited: false, throttled: false, reason: "add_identity" });
    const renderer = landed();
    await press(byId(renderer, "add-identity-landed-send"));
    await flush();
    expect(maybeId(renderer, "otp")).toBeUndefined();
    expect(maybeId(renderer, "add-identity-none")).toBeTruthy();
  });

  test.each([
    [httpError(410, { ok: false, error: "expired" }), "This link has expired."],
    [{ data: { ok: false, error: "no_email" }, error: null }, "We can't send a code for this one."],
    [httpError(400, { ok: false, error: "unsupported_phone" }), "We can't text that number yet."],
    [httpError(502, { ok: false, error: "send_failed" }), "We couldn't send the code. Try again."],
    [httpError(429, { ok: false, error: "rate_limited" }), "Too many attempts. Try again in a few minutes."],
    [httpError(409, { ok: false, error: "limit_reached" }), "You've added the most emails and numbers this account can hold."],
    [httpError(503, { ok: false, error: "unavailable" }), "Check your connection and try again."],
  ])("a refused send keeps its copy (%#)", async (response, copy) => {
    mockInvoke.mockResolvedValueOnce(response);
    const renderer = landed();
    await press(byId(renderer, "add-identity-landed-send"));
    expect(byId(renderer, "add-identity-error").props.accessibilityRole).toBe("alert");
    expect(text(renderer)).toContain(copy);
  });

  test("a wrong code stays on the code step", async () => {
    mockInvoke
      .mockResolvedValueOnce({ data: { ok: true, challengeId: "11111111-1111-4111-8111-111111111111", channel: "email", sentTo: "s•••@gmail.com" }, error: null })
      .mockResolvedValueOnce(httpError(400, { ok: false, error: "bad_code", attemptsLeft: 4 }));
    const renderer = landed();
    await press(byId(renderer, "add-identity-landed-send"));
    await act(async () => {
      byId(renderer, "otp").props.onComplete("000000");
    });
    await flush();
    expect(text(renderer)).toContain("That code didn't work. Check the latest message and try again.");
    await press(byId(renderer, "add-identity-change"));
    expect(maybeId(renderer, "add-identity-landed")).toBeTruthy();
  });

  test("an expired link offers only asking; can't get in goes to Ask", async () => {
    const expired = landed({ claimLink: { ...claim, expired: true } });
    expect(maybeId(expired, "add-identity-landed-send")).toBeUndefined();
    expect(text(expired)).toContain("This link has expired.");
    const phone = landed({ claimLink: { ...claim, preferredProof: "phone" } });
    expect(text(phone)).toContain("confirm that number");
    expect(text(phone)).toContain("I can't get to that phone");
    await press(byId(phone, "add-identity-landed-ask"));
    expect(maybeId(phone, "missing-ask-step")).toBeTruthy();
  });
});

describe("#4473 D4 shared bookings carry no brand and no cancel", () => {
  test("a shared Calendar booking never passes the venue id off as a brand id", () => {
    const [row] = sharedCalendarReservations(parseSharedPurchases([sharedReservation()]));
    expect(row.brand_id).toBe("");
    expect(row.brand_id).not.toBe("venue-1");
  });

  test("Calendar plan sheet: no Message brand (so no Cancel) for a shared booking", () => {
    const [shared] = sharedCalendarReservations(parseSharedPurchases([sharedReservation()]));
    expect(calendarPlanMessageControl({ kind: "reservation", reservation: shared })).toBeNull();
    const own = { ...shared, shared: false, brand_id: "brand-real", brand_slug: "harmattan" };
    const ownControl = calendarPlanMessageControl({ kind: "reservation", reservation: own }, NOW.getTime());
    expect(ownControl?.allowCancel).toBe(true);
    expect(ownControl?.target.brandId).toBe("brand-real");
    const [rsvp] = sharedCalendarRsvps(parseSharedPurchases([sharedRsvp()]));
    expect(calendarPlanMessageControl({ kind: "rsvp", rsvp }, NOW.getTime())?.allowCancel).toBe(false);
    expect(calendarPlanMessageControl({ kind: "calendar" })).toBeNull();
    expect(calendarPlanMessageControl(null)).toBeNull();
  });
});

describe("#4473 D5 shared stays are reachable", () => {
  test("a shared stay has a Purchases route and joins the list, upcoming while active", () => {
    const parsed = parseSharedPurchases([sharedStay(), sharedStay({ sourceId: "stay-old", stayGroupId: "stay-old", state: "checked_out" })]);
    expect(sharedPurchaseRoute(parsed[0])).toEqual({ kind: "stay", id: "stay-s1" });
    const timeline = buildPurchaseTimeline(
      mergeSharedSources({ orders: [], rsvps: [], reservations: [], venueOrders: [] }, parsed),
      NOW,
    );
    const upcoming = timeline.upcoming.flatMap((group: { items: Array<Record<string, unknown>> }) => group.items);
    const past = timeline.past.flatMap((group: { items: Array<Record<string, unknown>> }) => group.items);
    expect(upcoming.map((item) => [item.kind, item.id, item.shared, item.amountCents])).toEqual([
      ["stay", "stay-s1", true, null],
    ]);
    expect(past.map((item) => item.id)).toEqual(["stay-old"]);
  });

  test("the list card says Stay and Shared, with no made-up date", () => {
    const item = sharedTimelineItem(sharedStay());
    const card = render(React.createElement(PurchaseCard, { item, onPress: jest.fn() }));
    const copy = text(card);
    expect(copy).toContain("Stay");
    expect(copy).toContain("Shared");
    expect(copy).toContain("Harbour House");
    expect(copy).not.toContain("10");
    expect(copy).not.toContain("Nov");
  });

  test("the read-only stay detail shows venue, reference, state and mode, and nothing to act on", async () => {
    const renderer = render(
      React.createElement(SharedPurchaseDetail, {
        item: sharedTimelineItem(sharedStay()),
        qrSize: 200,
        onAddToCalendar: jest.fn(),
        onOpenChat: jest.fn(),
        onOpenEventPage: jest.fn(),
      }),
    );
    await flush();
    const copy = text(renderer);
    for (const shown of ["Harbour House", "Reference", "STAY-7Q2K", "Status", "Confirmed", "Booking type", "Instant"]) {
      expect(copy).toContain(shown);
    }
    expect(maybeId(renderer, "purchase-share-note-shared")).toBeTruthy();
    expect(renderer.root.findAll((node) => node.type === "QRCode")).toHaveLength(0);
    expect(maybeId(renderer, "shared-add-to-calendar")).toBeUndefined();
    expect(maybeId(renderer, "shared-open-chat")).toBeUndefined();
    expect(copy).not.toContain("When");
    expect(copy).not.toContain("Cancel");
  });

  test("a claimed stay with no timezone still parses, and Open goes to the shared detail", () => {
    const stayEntry = {
      kind: "stay_group", id: "stay-s1", routeKind: "stay", routeId: "stay-s1",
      offeringType: "stay", noun: "booking", title: "Harbour House", orderLabel: null,
      startsAt: null, timezone: null, venueLine: "Harbour House", quantity: null,
      source: "booking", role: "shared", sharedWithAnotherAccount: true,
    };
    const [parsed] = parseClaimedEntries([stayEntry]);
    expect(parsed).toMatchObject({ kind: "stay_group", timezone: "UTC", role: "shared" });
    expect(claimedEntryPath(parsed)).toBe("/purchases/stay/stay-s1");
    // The buyer's own claimed stay keeps its own stay screen.
    expect(claimedEntryPath({ ...parsed, role: null, sharedWithAnotherAccount: false })).toBe("/stay/stay-s1");
  });

  test("Found card Open for a shared stay lands on the read-only detail route", async () => {
    mockInvoke
      .mockResolvedValueOnce({ data: { ok: true, challengeId: "11111111-1111-4111-8111-111111111111", channel: "email", sentTo: "s•••@gmail.com" }, error: null })
      .mockResolvedValueOnce({
        data: {
          ok: true,
          claimed: {
            count: 1,
            more: false,
            claimed: [{
              kind: "stay_group", id: "stay-s1", routeKind: "stay", routeId: "stay-s1",
              offeringType: "stay", noun: "booking", title: "Harbour House", orderLabel: null,
              startsAt: null, timezone: null, venueLine: "Harbour House", quantity: null,
              source: "booking", role: "shared", sharedWithAnotherAccount: true,
            }],
          },
        },
        error: null,
      });
    mockSweep.mockResolvedValue({ count: 0, eventIds: [], claims: [], claimed: [], more: false, rateLimited: false, throttled: false, reason: "add_identity" });
    const onClose = jest.fn();
    const renderer = render(
      React.createElement(AddIdentitySheet, {
        visible: true,
        initialStep: "landed",
        claimLink: {
          code: "AB12CD34EF", noun: "booking", title: "Harbour House", orderLabel: null,
          startsAt: null, timezone: "UTC", emailMasked: "s•••@gmail.com", phoneLast4: null,
          preferredProof: "email", expired: false,
        },
        userId: "user-1",
        identifiers: [],
        onClose,
      }),
    );
    await press(byId(renderer, "add-identity-landed-send"));
    await act(async () => {
      byId(renderer, "otp").props.onComplete("123456");
    });
    await flush();
    expect(text(renderer)).toContain("Harbour House");
    await press(byId(renderer, "add-identity-open-stay-s1"));
    expect(onClose).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith("/purchases/stay/stay-s1");
  });
});
