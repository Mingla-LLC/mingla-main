/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4473 device pass fixes (implementor, render + behaviour).
 *
 *   D1  one dark Done bar: the add / send sheets turn the shared floating
 *       toolbar off on iOS (dark elsewhere) and attach their own dark accessory
 *       to every field; focusing a field scrolls the primary button into view.
 *   D2  the country picker is a step inside the sheet, offers only the
 *       countries claim-contact can text, and the placeholder follows the
 *       selected country; an unsupported country is refused in words.
 *   D3  shared notes are worded per kind (no QR claim for bookings and stays);
 *       a stay's venue is not repeated.
 *   D4  the code hint follows the channel the code went to.
 *   D5  the keyboard is closed while the field is still on screen, before a
 *       result step, so the sheet settles flush at the bottom.
 *   Send to a friend: "First name" label, one dark bar.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 */
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
const mockScrollToEnd = jest.fn();
jest.mock("../../ui/BaseBottomSheet", () => {
  const ReactActual = jest.requireActual("react");
  const h = ReactActual.createElement;
  function BaseBottomSheet(props: Record<string, unknown>) {
    mockSheetProps.push(props);
    const scrollProps = props.scrollProps as { ref?: { current: unknown } } | undefined;
    if (scrollProps?.ref) scrollProps.ref.current = { scrollToEnd: mockScrollToEnd, scrollTo: jest.fn() };
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
const { SendTicketSheet } = require("../SendTicketSheet");
const { SHEET_KEYBOARD_DONE_BAR_ID } = require("../SheetKeyboardDoneBar");
const { joinDistinct } = require("../../../utils/purchasePresentation");

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
  mockScrollToEnd.mockReset();
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

function addSheet(props: Record<string, unknown> = {}): Renderer {
  return render(
    React.createElement(AddIdentitySheet, {
      visible: true,
      userId: "user-1",
      identifiers: [],
      onClose: jest.fn(),
      ...props,
    }),
  );
}

function phone(renderer: Renderer): Node {
  return renderer.root.findAll((node) => node.type === "PhoneInput")[0];
}

function stayEntry(overrides: Record<string, unknown> = {}) {
  return {
    kind: "stay_group", id: "stay-s1", routeKind: "stay", routeId: "stay-s1",
    offeringType: "stay", noun: "booking", title: "Harbour House", orderLabel: null,
    startsAt: null, timezone: "UTC", venueLine: "Harbour House", quantity: 1,
    source: "booking", sentByFirstName: null, chatJoined: null, conversationId: null,
    role: "shared", sharedWithAnotherAccount: true,
    ...overrides,
  };
}

const NO_SWEEP = { count: 0, eventIds: [], claims: [], claimed: [], more: false, rateLimited: false, throttled: false, reason: "add_identity" };

describe("#4473 D1 one dark Done bar, primary always reachable", () => {
  test("the add sheet never asks for the light shared toolbar, and every field carries the sheet's own bar", async () => {
    const renderer = addSheet();
    expect(["none", "dark"]).toContain(mockSheetProps.at(-1)!.keyboardToolbar);
    expect(phone(renderer).props.showDoneAccessory).not.toBe(false);
    await press(byId(renderer, "add-identity-tab-email"));
    expect(byId(renderer, "add-identity-email").props.inputAccessoryViewID).toBe(SHEET_KEYBOARD_DONE_BAR_ID);
  });

  test("on iOS the shared toolbar is off; elsewhere it is the dark one", () => {
    jest.isolateModules(() => {
      const rn = require("react-native");
      const original = rn.Platform.OS;
      rn.Platform.OS = "ios";
      try {
        expect(require("../SheetKeyboardDoneBar").PURCHASE_SHEET_KEYBOARD_TOOLBAR).toBe("none");
      } finally {
        rn.Platform.OS = original;
      }
    });
    jest.isolateModules(() => {
      const rn = require("react-native");
      const original = rn.Platform.OS;
      rn.Platform.OS = "android";
      try {
        expect(require("../SheetKeyboardDoneBar").PURCHASE_SHEET_KEYBOARD_TOOLBAR).toBe("dark");
      } finally {
        rn.Platform.OS = original;
      }
    });
  });

  test("focusing the email or mobile field scrolls the Send code button into view", async () => {
    jest.useFakeTimers();
    try {
      const renderer = addSheet();
      act(() => {
        phone(renderer).props.onFocus();
        jest.advanceTimersByTime(300);
      });
      expect(mockScrollToEnd).toHaveBeenCalledTimes(1);
      await act(async () => {
        byId(renderer, "add-identity-tab-email").props.onPress();
      });
      act(() => {
        byId(renderer, "add-identity-email").props.onFocus();
        jest.advanceTimersByTime(300);
      });
      expect(mockScrollToEnd).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test("the code field carries the sheet's own bar too", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ok: true, challengeId: "ch1", sentTo: "g@example.com" }, error: null });
    const renderer = addSheet();
    await press(byId(renderer, "add-identity-tab-email"));
    await act(async () => {
      byId(renderer, "add-identity-email").props.onChangeText("g@example.com");
    });
    await press(byId(renderer, "add-identity-send"));
    expect(byId(renderer, "otp").props.inputAccessoryViewID).toBe(SHEET_KEYBOARD_DONE_BAR_ID);
  });

  test("Send to a friend: one dark bar, and First name has a label", () => {
    const renderer = render(
      React.createElement(SendTicketSheet, {
        ticket: { id: "t1", ticketIndex: 2 },
        total: 3,
        visible: true,
        onClose: jest.fn(),
        onSent: jest.fn(),
      }),
    );
    expect(["none", "dark"]).toContain(mockSheetProps.at(-1)!.keyboardToolbar);
    expect(text(renderer)).toContain("First name");
    const inputs = renderer.root.findAll((node) => node.type === "BottomSheetTextInput");
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    for (const input of inputs) {
      expect(input.props.inputAccessoryViewID).toBe(SHEET_KEYBOARD_DONE_BAR_ID);
    }
    expect(inputs[0].props.accessibilityLabel).toBe("First name");
  });
});

describe("#4473 D2 country picker in the sheet, supported countries only", () => {
  test("the country button opens a step inside the sheet with only the countries we can text", async () => {
    const renderer = addSheet();
    expect(phone(renderer).props.countryCode).toBe("US");
    expect(phone(renderer).props.placeholder).toBe("(555) 123-4567");
    await act(async () => {
      phone(renderer).props.onRequestCountryPicker();
    });
    const rows = renderer.root.findAll(
      (node) => typeof node.props?.testID === "string" &&
        node.props.testID.startsWith("add-identity-country-") &&
        node.props.testID !== "add-identity-country-back" &&
        typeof node.type !== "string",
    );
    const codes = [...new Set(rows.map((node) => node.props.testID.replace("add-identity-country-", "")))];
    expect(codes).toEqual(["US", "CA", "GB", "NG", "GH", "KE", "ZA"]);
    expect(text(renderer)).not.toContain("France");
    await press(byId(renderer, "add-identity-country-GB"));
    expect(maybeId(renderer, "add-identity-country")).toBeUndefined();
    expect(phone(renderer).props.countryCode).toBe("GB");
    expect(phone(renderer).props.placeholder).toBe("07400 123456");
  });

  test("a pasted number from a country we cannot text is refused in words", async () => {
    const renderer = addSheet();
    await act(async () => {
      phone(renderer).props.onChangeCountry("FR");
      phone(renderer).props.onChangePhone("6 12 34 56 78");
    });
    expect(phone(renderer).props.error).toContain("We can only text numbers in Canada, Ghana, Kenya");
    expect(byId(renderer, "add-identity-send").props.disabled).toBe(true);
  });
});

describe("#4473 D3 shared wording per kind", () => {
  test("shared and owner notes: a ticket scans once; a booking and a stay make no QR claim", () => {
    const ticket = render(React.createElement(PurchaseShareNote, { kind: "order", variant: "shared" }));
    expect(text(ticket)).toContain("one ticket, so the QR scans once");
    for (const kind of ["reservation", "stay"]) {
      const booking = render(React.createElement(PurchaseShareNote, { kind, variant: "shared" }));
      expect(text(booking)).toContain("one booking");
      expect(text(booking)).not.toContain("QR");
      expect(text(booking)).not.toContain("ticket");
    }
    const owner = render(React.createElement(PurchaseShareNote, { kind: "reservation", variant: "owner" }));
    expect(text(owner)).toBe("Shows on both accounts. It's one booking.");
    const ownerTicket = render(React.createElement(PurchaseShareNote, { kind: "order", variant: "owner" }));
    expect(text(ownerTicket)).toBe("Shows on both accounts. One ticket, scans once.");
  });

  test("the shared stay detail and card do not repeat the venue", async () => {
    const stay = {
      kind: "stay_group", sourceId: "stay-s1", stayGroupId: "stay-s1", role: "shared",
      sharedWithAnotherAccount: true, venueId: "v1", venueName: "Harbour House", title: "Harbour House",
      offeringType: "stay", publicReference: "STAY-7Q2K", state: "confirmed", mode: "instant",
      createdAt: "2026-11-10T10:00:00.000Z",
    };
    const item = sharedTimelineItem(stay);
    const card = render(React.createElement(PurchaseCard, { item, onPress: jest.fn() }));
    expect(text(card).match(/Harbour House/g)).toHaveLength(1);
    const detail = render(
      React.createElement(SharedPurchaseDetail, {
        item,
        qrSize: 200,
        onAddToCalendar: jest.fn(),
        onOpenChat: jest.fn(),
        onOpenEventPage: jest.fn(),
      }),
    );
    await flush();
    const copy = text(detail);
    // Title once, and once more only as the "Where" row value.
    expect(copy.match(/Harbour House/g)).toHaveLength(2);
    expect(copy).not.toContain("QR");
    expect(joinDistinct(["A", " a ", null, "B"])).toBe("A · B");
  });

  test("the found note follows what was found", async () => {
    mockInvoke
      .mockResolvedValueOnce({ data: { ok: true, challengeId: "ch1", sentTo: "g@example.com" }, error: null })
      .mockResolvedValueOnce({ data: { ok: true, claimed: { count: 1, claimed: [stayEntry()] } }, error: null });
    mockSweep.mockResolvedValue(NO_SWEEP);
    const renderer = addSheet();
    await press(byId(renderer, "add-identity-tab-email"));
    await act(async () => {
      byId(renderer, "add-identity-email").props.onChangeText("g@example.com");
    });
    await press(byId(renderer, "add-identity-send"));
    await act(async () => {
      byId(renderer, "otp").props.onComplete("123456");
    });
    await flush();
    const note = text(renderer);
    expect(note).toContain("so this booking shows on both. It's one booking, shared by both accounts.");
    expect(note).not.toContain("QR scans once");
  });
});

describe("#4473 D4 code hint by channel", () => {
  test("an emailed code says check your inbox; a texted one does not", async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, challengeId: "ch1", sentTo: "g@example.com" }, error: null });
    const byEmail = addSheet();
    await press(byId(byEmail, "add-identity-tab-email"));
    await act(async () => {
      byId(byEmail, "add-identity-email").props.onChangeText("g@example.com");
    });
    await press(byId(byEmail, "add-identity-send"));
    expect(text(byEmail)).toContain("Check your inbox");
    expect(text(byEmail)).not.toContain("Messages");

    const byPhone = addSheet();
    await act(async () => {
      phone(byPhone).props.onChangePhone("(984) 382-2876");
    });
    await press(byId(byPhone, "add-identity-send"));
    expect(text(byPhone)).toContain("It checks itself once all 6 digits are in.");
    expect(text(byPhone)).not.toContain("Check your inbox");
  });
});

describe("#4473 D5 the keyboard closes before a result step", () => {
  test("Send code and the 6th digit close the keyboard while the field is still on screen", async () => {
    const dismiss = jest.spyOn(RN.Keyboard, "dismiss");
    let resolveVerify: (value: unknown) => void = () => undefined;
    mockInvoke
      .mockResolvedValueOnce({ data: { ok: true, challengeId: "ch1", sentTo: "g@example.com" }, error: null })
      .mockReturnValueOnce(new Promise((resolve) => { resolveVerify = resolve; }));
    mockSweep.mockResolvedValue(NO_SWEEP);
    const renderer = addSheet();
    await press(byId(renderer, "add-identity-tab-email"));
    await act(async () => {
      byId(renderer, "add-identity-email").props.onChangeText("g@example.com");
    });
    await press(byId(renderer, "add-identity-send"));
    expect(dismiss).toHaveBeenCalledTimes(1);
    await act(async () => {
      byId(renderer, "otp").props.onComplete("123456");
    });
    // Dismissed while the code boxes are still mounted (verifying).
    expect(dismiss).toHaveBeenCalledTimes(2);
    expect(maybeId(renderer, "otp")).toBeTruthy();
    await act(async () => {
      resolveVerify({ data: { ok: true, claimed: { count: 0, claimed: [] } }, error: null });
    });
    await flush();
    expect(maybeId(renderer, "add-identity-none")).toBeTruthy();
  });
});
