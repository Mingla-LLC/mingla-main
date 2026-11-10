/* eslint-disable import/first */
// issue #3827 — a published RSVP opened at /event/<id>/guests lands on its
// RSVP guest console. Renders the REAL ticketed guests route with its hooks
// mocked at the module boundary (the same harness as
// guests.issue_3827_comps.implementor.test.tsx).
//
//   R-1  an RSVP: router.replace("/rsvp/<id>/guests"), and the ticketed list
//        (which counts ticket orders) is never drawn
//   R-2  a ticketed event: no hand-over, the list renders
//
// Fails on revert: delete the rsvpTwinRoute hand-over in guests/index.tsx and
// R-1 sees no replace and the roster drawn.

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
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: mockReplace, canGoBack: () => true }),
  useLocalSearchParams: () => ({ id: EVENT_ID, guestId: mockGuestId }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockEvent: Record<string, unknown> = {
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
jest.mock("../../../../../src/hooks/useEventDoorSales", () => ({
  useEventDoorSales: () => ({
    data: [], isLoading: false, isError: false, refetch: jest.fn(),
  }),
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

const mount = async (el: React.ReactElement): Promise<Renderer> => {
  const client = new QueryClient();
  let r!: Renderer;
  await act(async () => {
    r = TestRenderer.create(<QueryClientProvider client={client}>{el}</QueryClientProvider>);
  });
  return r;
};

const rosterDrawn = (r: Renderer): boolean =>
  r.root.findAll((n) => n.type === "RosterProbe" || n.type === "ScrollView").length > 0;

beforeEach(() => {
  mockReplace.mockReset();
  mockOrders = [];
  mockLegacy = [];
  mockRank = 40;
});

describe("issue #3827 — an RSVP at /event/<id>/guests", () => {
  test("R-1 an RSVP hands over to the RSVP guest console and never draws the ticketed list", async () => {
    mockEvent.event_type = "rsvp";
    const r = await mount(<GuestsRoute />);
    expect(mockReplace).toHaveBeenCalledWith(`/rsvp/${EVENT_ID}/guests`);
    expect(rosterDrawn(r)).toBe(false);
    await act(async () => r.unmount());
  });

  test("R-2 a ticketed event stays on its guest list", async () => {
    mockEvent.event_type = "event";
    const r = await mount(<GuestsRoute />);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(rosterDrawn(r)).toBe(true);
    await act(async () => r.unmount());
  });
});
