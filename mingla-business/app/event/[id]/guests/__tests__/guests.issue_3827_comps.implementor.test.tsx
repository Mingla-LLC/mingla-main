/* eslint-disable import/first */
// issue #3827 — Guests list + guest page, implementor render proof.
//
// Renders the REAL screens with their hooks mocked at the module boundary and
// pins:
//   G-1  a source=comp order is a GUEST LIST row (not PAID, not a phone-only
//        COMP entry), and its check-in pill comes from the SERVER tickets
//        (ticketDays) with an EMPTY device scan store
//   G-2  the legacy phone-only comps banner, and Re-add opens the sheet
//        prefilled with those entries
//   G-3  "+" only for ADD_COMP_GUEST (event manager and above)
//   D-1  guest page: one row per REAL ticket, "Admit" calls the server with
//        the real ticket id
//   D-2  Resend / Cancel visibility for a guest-list order; cancel blocked
//        once anyone is checked in
//   D-3  a legacy comp- link renders the not-found shell with Re-add copy

import React from "react";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
let mockGuestId = `order-comp-1`;
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ id: EVENT_ID, guestId: mockGuestId }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockEvent = {
  id: EVENT_ID, serverEventId: EVENT_ID, brandId: "brand-1", name: "Rooftop", event_type: "event",
  brandSlug: "b", eventSlug: "e", currency: "GBP", whenMode: "single", tickets: [],
};
jest.mock("../../../../../src/hooks/useManagedEventRoute", () => ({
  useManagedEventRoute: () => ({
    event: mockEvent, brand: { id: "brand-1", displayName: "Kaycee" }, isLoading: false, replacementEventId: null,
  }),
}));
let mockRank = 40;
jest.mock("../../../../../src/hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: mockRank }),
}));
jest.mock("../../../../../src/context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true, user: { id: "user-1" } }),
}));
let mockOrders: unknown[] = [];
jest.mock("../../../../../src/hooks/useEventOrders", () => ({
  eventOrdersKeys: { all: ["event-orders"] },
  useEventGuestList: () => ({ data: mockOrders, status: "ready", isRefreshing: false, refetch: jest.fn() }),
  useEventGuestById: (_e: string | null, id: string | null) => ({
    data: (mockOrders as Array<{ id: string }>).find((o) => o.id === id) ?? null,
    status: "ready", isRefreshing: false, refetch: jest.fn(),
  }),
}));
jest.mock("../../../../../src/hooks/useGuestRoster", () => ({
  guestRosterKeys: { all: ["guest-roster"] },
  useGuestRosterAccess: () => ({ isError: false, isPending: false, data: { enabled: false }, refetch: jest.fn() }),
}));
jest.mock("../../../../../src/hooks/usePublicEvents", () => ({
  usePublicEventById: () => ({ data: { occurrences: [] } }),
}));
let mockLegacy: unknown[] = [];
const mockRemoveCompEntry = jest.fn();
jest.mock("../../../../../src/store/guestStore", () => ({
  useGuestStore: Object.assign(
    (sel: (s: { entries: unknown[] }) => unknown) => sel({ entries: mockLegacy }),
    { getState: () => ({ removeCompEntry: mockRemoveCompEntry }) },
  ),
}));
jest.mock("../../../../../src/store/doorSalesStore", () => ({
  useDoorSalesStore: (sel: (s: { entries: unknown[]; getSaleById: () => null }) => unknown) =>
    sel({ entries: [], getSaleById: () => null }),
}));
const mockScanEntries: unknown[] = [];
jest.mock("../../../../../src/store/scanStore", () => ({
  useScanStore: (sel: (s: { entries: unknown[] }) => unknown) => sel({ entries: mockScanEntries }),
}));
jest.mock("../../../../../src/utils/guestCsvExport", () => ({ exportGuestsCsv: jest.fn() }));
jest.mock("../../../../../src/services/guestRosterService", () => ({
  createGuestRosterRequestId: jest.fn(), getGuestRosterExport: jest.fn(), requestGuestRosterExport: jest.fn(),
}));
const mockAdmit = jest.fn<(input: { eventId: string; ticketId: string }) => Promise<unknown>>();
const mockResend = jest.fn<(input: unknown) => Promise<unknown>>();
const mockCancel = jest.fn<(input: unknown) => Promise<unknown>>();
jest.mock("../../../../../src/services/guestListService", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const actual = jest.requireActual("../../../../../src/services/guestListService") as Record<string, unknown>;
  return {
    ...actual,
    admitTicket: (i: { eventId: string; ticketId: string }) => mockAdmit(i),
    resendGuestListTicket: (i: unknown) => mockResend(i),
    cancelGuestListTicket: (i: unknown) => mockCancel(i),
  };
});
jest.mock("../../../../../src/services/supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock("../../../../../src/utils/deferAfterDismiss", () => ({ deferAfterDismiss: (fn: () => void) => fn() }));

const probe = (name: string) => (props: Record<string, unknown>) =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("react").createElement(name, props, props.children as React.ReactNode);
jest.mock("../../../../../src/components/guests/AddCompGuestSheet", () => ({ AddCompGuestSheet: probe("AddSheetProbe") }));
jest.mock("../../../../../src/components/guests/GuestRosterExperience", () => ({ GuestRosterExperience: probe("RosterProbe") }));
jest.mock("../../../../../src/components/door/DoorRefundSheet", () => ({ DoorRefundSheet: (): null => null }));
jest.mock("../../../../../src/components/ui/EmptyState", () => ({ EmptyState: probe("EmptyStateProbe") }));
jest.mock("../../../../../src/components/ui/IconChrome", () => ({ IconChrome: probe("IconChromeProbe") }));
jest.mock("../../../../../src/components/ui/Input", () => ({ Input: probe("InputProbe") }));
jest.mock("../../../../../src/components/ui/Pill", () => ({ Pill: probe("PillProbe") }));
jest.mock("../../../../../src/components/ui/Toast", () => ({ Toast: probe("ToastProbe") }));
jest.mock("../../../../../src/components/ui/Button", () => ({ Button: probe("ButtonProbe") }));
jest.mock("../../../../../src/components/ui/GlassCard", () => ({ GlassCard: probe("GlassCardProbe") }));
jest.mock("../../../../../src/components/ui/Sheet", () => ({
  Sheet: (props: { visible: boolean; children: React.ReactNode }) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    props.visible ? require("react").createElement("SheetProbe", null, props.children) : null,
}));
jest.mock("../../../../../src/wrappers/SmartScrollView", () => ({ ScrollView: probe("ScrollView") }));

import GuestsRoute from "../index";
import GuestDetailRoute from "../[guestId]";

const compOrder = (patch: Record<string, unknown> = {}) => ({
  id: "comp-1",
  eventId: EVENT_ID,
  brandId: "brand-1",
  buyer: { name: "DJ Kaycee", email: "dj@kayceemusic.com", phone: "", marketingOptIn: false },
  lines: [{
    ticketTypeId: "tt-gl", ticketNameAtPurchase: "Guest list", unitPriceGbpAtPurchase: 0,
    isFreeAtPurchase: true, quantity: 2, refundedQuantity: 0, refundedAmountGbp: 0,
  }],
  ticketDays: [
    { ticketId: "tk-1", ticketTypeId: "tt-gl", eventDateIds: [], status: "used", usedAt: "2026-11-01T20:58:00Z" },
    { ticketId: "tk-2", ticketTypeId: "tt-gl", eventDateIds: [], status: "valid", usedAt: null },
  ],
  totalGbpAtPurchase: 0, currency: "GBP", paymentMethod: "free", paidAt: "2026-10-20T10:00:00Z",
  status: "paid", refundedAmountGbp: 0, refunds: [], cancelledAt: null,
  source: "comp", compReason: "DJ set + plus-ones", partyLeadOrderId: null, partyLeadName: null,
  lastSeenEventUpdatedAt: "2026-10-20T10:00:00Z",
  ...patch,
});

const text = (node: TestInstance): string =>
  node.children.map((c) => (typeof c === "string" ? c : text(c))).join(" ");

const mount = async (el: React.ReactElement): Promise<Renderer> => {
  const client = new QueryClient();
  let r!: Renderer;
  await act(async () => {
    r = TestRenderer.create(<QueryClientProvider client={client}>{el}</QueryClientProvider>);
  });
  return r;
};

const byLabel = (r: Renderer, type: string, label: string): TestInstance[] =>
  r.root.findAll((n) => n.type === type && n.props.accessibilityLabel === label);

beforeEach(() => {
  mockOrders = [compOrder()];
  mockLegacy = [];
  mockRank = 40;
  mockGuestId = "order-comp-1";
  mockAdmit.mockReset();
  mockResend.mockReset();
  mockCancel.mockReset();
  mockRemoveCompEntry.mockReset();
});

describe("issue #3827 — Guests list", () => {
  test("G-1 a comp order is a GUEST LIST row; check-ins come from the server with an empty scan store", async () => {
    const r = await mount(<GuestsRoute />);
    const all = text(r.root);
    expect(all).toContain("GUEST LIST");
    expect(all).not.toContain("PAID");
    expect(all).not.toContain("COMP");
    expect(all).toContain("1 OF 2 CHECKED IN");
    expect(byLabel(r, "Pressable", "Guest-list guest DJ Kaycee, 2× Guest list")).toHaveLength(1);
    expect(mockScanEntries).toHaveLength(0);
  });

  test("G-2 legacy phone-only comps: banner, and Re-add opens the sheet prefilled", async () => {
    mockLegacy = [{ id: "cg_1", eventId: EVENT_ID, name: "Old Guest", email: "old@example.com", phone: "" }];
    const r = await mount(<GuestsRoute />);
    expect(text(r.root)).toContain(
      "1 guest you added before this update is saved only on this phone and has no ticket. Re-add them to send real tickets.",
    );
    const [readd] = r.root.findAll((n) => n.type === "ButtonProbe" && n.props.label === "Re-add");
    await act(async () => { (readd.props.onPress as () => void)(); });
    const [sheet] = r.root.findAll((n) => n.type === "AddSheetProbe");
    expect(sheet.props.visible).toBe(true);
    expect(sheet.props.prefill).toEqual([{ localId: "cg_1", name: "Old Guest", email: "old@example.com", phone: "" }]);
    await act(async () => {
      (sheet.props.onSuccess as (r: unknown) => void)({ message: "Old Guest is on the guest list. Ticket emailed.", addedLegacyIds: ["cg_1"] });
    });
    expect(mockRemoveCompEntry).toHaveBeenCalledWith("cg_1");
  });

  test("G-3 the + is shown only to event managers and above", async () => {
    let r = await mount(<GuestsRoute />);
    expect(byLabel(r, "IconChromeProbe", "Add to guest list")).toHaveLength(1);
    r.unmount();
    mockRank = 10;
    r = await mount(<GuestsRoute />);
    expect(byLabel(r, "IconChromeProbe", "Add to guest list")).toHaveLength(0);
  });

  test("the empty state names the guest list", async () => {
    mockOrders = [];
    const r = await mount(<GuestsRoute />);
    const [empty] = r.root.findAll((n) => n.type === "EmptyStateProbe");
    expect(empty.props.description).toBe("Once people buy tickets or you add them to the guest list, they'll appear here.");
  });
});

describe("issue #3827 — guest page", () => {
  test("D-1 one row per real ticket; Admit calls the server with the real ticket id", async () => {
    mockAdmit.mockResolvedValue({ result: "success", ticketId: "tk-2" });
    const r = await mount(<GuestDetailRoute />);
    const all = text(r.root);
    expect(all).toContain("GUEST LIST");
    expect(all).toContain("NOTE");
    expect(all).toContain("DJ set + plus-ones");
    expect(all).toMatch(/CHECKED IN \d{2}:\d{2}/);
    expect(all).not.toContain("Mark checked in");
    const admits = r.root.findAll((n) => n.type === "ButtonProbe" && n.props.label === "Admit");
    expect(admits).toHaveLength(1);
    await act(async () => { await (admits[0].props.onPress as () => Promise<void>)(); });
    expect(mockAdmit).toHaveBeenCalledWith({ eventId: EVENT_ID, ticketId: "tk-2" });
  });

  test("D-2 Resend shows with an email; Cancel is blocked once anyone is checked in", async () => {
    const r = await mount(<GuestDetailRoute />);
    expect(r.root.findAll((n) => n.type === "ButtonProbe" && n.props.label === "Resend ticket")).toHaveLength(1);
    const [cancel] = r.root.findAll((n) => n.type === "ButtonProbe" && n.props.label === "Cancel guest-list ticket");
    expect(cancel.props.disabled).toBe(true);
    expect(text(r.root)).toContain("Already checked in");
  });

  test("D-2 cancel: confirm sheet, then the server cancel with an optional reason", async () => {
    mockOrders = [compOrder({
      buyer: { name: "Temi Bello", email: "", phone: "", marketingOptIn: false },
      ticketDays: [{ ticketId: "tk-9", ticketTypeId: "tt-gl", eventDateIds: [], status: "valid", usedAt: null }],
    })];
    mockCancel.mockResolvedValue({ orderId: "comp-1", status: "cancelled", idempotentReplay: false });
    const r = await mount(<GuestDetailRoute />);
    // No email: Resend is hidden.
    expect(r.root.findAll((n) => n.type === "ButtonProbe" && n.props.label === "Resend ticket")).toHaveLength(0);
    const [cancel] = r.root.findAll((n) => n.type === "ButtonProbe" && n.props.label === "Cancel guest-list ticket");
    await act(async () => { (cancel.props.onPress as () => void)(); });
    expect(text(r.root)).toContain("Cancel Temi Bello's guest-list ticket?");
    expect(text(r.root)).toContain("Their QR code stops working and the place is freed. No money is involved.");
    const [confirm] = r.root.findAll((n) => n.type === "ButtonProbe" && n.props.label === "Cancel ticket");
    await act(async () => { await (confirm.props.onPress as () => Promise<void>)(); });
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockCancel.mock.calls[0][0]).toMatchObject({ orderId: "comp-1", reason: null });
  });

  test("D-3 a legacy comp- link renders the not-found shell", async () => {
    mockGuestId = "comp-cg_123";
    const r = await mount(<GuestDetailRoute />);
    const [empty] = r.root.findAll((n) => n.type === "EmptyStateProbe");
    expect(empty.props.description).toBe("This guest isn't on the server. Re-add them from Guests.");
  });

  test("a bought order still reads PAID with its order activity, and no guest-list actions", async () => {
    mockOrders = [compOrder({ source: "online_checkout", totalGbpAtPurchase: 20, paymentMethod: "card" })];
    const r = await mount(<GuestDetailRoute />);
    const all = text(r.root);
    expect(all).toContain("PAID");
    expect(all).toContain("ORDER ACTIVITY");
    expect(r.root.findAll((n) => n.type === "ButtonProbe" && n.props.label === "Cancel guest-list ticket")).toHaveLength(0);
  });
});
