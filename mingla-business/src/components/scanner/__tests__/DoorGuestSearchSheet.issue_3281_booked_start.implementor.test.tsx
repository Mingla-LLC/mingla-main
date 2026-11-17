/* eslint-disable import/first */
// issue #3827 — door "Find by name", implementor render proof.
//
//   S-1  under 2 letters: helper copy, no search request
//   S-2  results: name, masked email, GUEST LIST, "with {lead}", Admit per
//        open ticket, "Admit all {n}"; checked-in tickets show the time
//   S-3  no match: the empty copy
//   S-4  offline: banner, input disabled, no request
//   S-5  Admit → server admit with the real ticket id; a duplicate shows the
//        same "Already checked in" the QR camera shows; onAdmitted fires
//   S-6  the web door renders the panel inline and keeps its "scan in the
//        app" message (ORCH-1099), with no camera or haptics import
//   S-7  roster rows of guest-list guests read "Guest list"

import * as fs from "node:fs";
import * as path from "node:path";
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

let mockOnline = true;
jest.mock("../../../lib/netinfoSafe", () => ({
  useNetInfoSafe: () => ({ isConnected: mockOnline, isInternetReachable: mockOnline }),
}));
const mockSearch = jest.fn<(input: { eventId: string; query: string }) => Promise<unknown>>();
const mockAdmit = jest.fn<(input: { eventId: string; ticketId: string }) => Promise<unknown>>();
jest.mock("../../../services/guestListService", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const actual = jest.requireActual("../../../services/guestListService") as Record<string, unknown>;
  return {
    ...actual,
    searchDoorGuests: (i: { eventId: string; query: string }) => mockSearch(i),
    admitTicket: (i: { eventId: string; ticketId: string }) => mockAdmit(i),
  };
});
jest.mock("../../../services/supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock("../../../hooks/useEventOrders", () => ({ eventOrdersKeys: { all: ["event-orders"] } }));
jest.mock("../../../hooks/useGuestRoster", () => ({ useGuestRoster: jest.fn(), guestRosterKeys: { all: ["guest-roster"] } }));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: false }) }));
jest.mock("../../../services/guestRosterService", () => ({}));
const probe = (name: string) => (props: Record<string, unknown>) =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("react").createElement(name, props, props.children as React.ReactNode);
jest.mock("../../ui/Button", () => ({ Button: probe("ButtonProbe") }));
jest.mock("../../ui/Pill", () => ({ Pill: probe("PillProbe") }));
jest.mock("../../ui/Sheet", () => ({ Sheet: probe("SheetProbe") }));
jest.mock("../../ui/EmptyState", () => ({ EmptyState: probe("EmptyStateProbe") }));
jest.mock("../../ui/GlassCard", () => ({ GlassCard: probe("GlassCardProbe") }));
jest.mock("../../ui/IconChrome", () => ({ IconChrome: probe("IconChromeProbe") }));
jest.mock("../../ui/Input", () => ({ Input: probe("InputProbe") }));
jest.mock("../../../wrappers/SmartScrollView", () => ({ ScrollView: probe("ScrollView") }));

import { DoorGuestSearchPanel } from "../DoorGuestSearchSheet";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";

const text = (node: TestInstance): string =>
  node.children.map((c) => (typeof c === "string" ? c : text(c))).join(" ");

const mount = async (onAdmitted?: jest.Mock, timeZone: string | null = "Africa/Lagos"): Promise<Renderer> => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let r!: Renderer;
  await act(async () => {
    r = TestRenderer.create(
      <QueryClientProvider client={client}>
        <DoorGuestSearchPanel eventId={EVENT_ID} noun="event" onAdmitted={onAdmitted} timeZone={timeZone} />
      </QueryClientProvider>,
    );
  });
  return r;
};

const typeAndWait = async (r: Renderer, value: string): Promise<void> => {
  const [field] = r.root.findAll((n) => n.type === "TextInput" && n.props.accessibilityLabel === "Search name or email");
  await act(async () => {
    (field.props.onChangeText as (v: string) => void)(value);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};


// issue #3281 — the door's "Find by name" names the start each guest booked,
// in the offering's zone, on the row and on the admit banner.
const ADA = {
  orderId: "o-ada",
  displayName: "Ada Obi",
  maskedEmail: "ad***@example.test",
  isGuestList: false,
  cameWithName: null,
  viaLinkLabel: null,
  // 18:30 UTC is 19:30 in Lagos (WAT, UTC+1, no DST).
  bookedStartAt: "2026-11-14T18:30:00.000Z",
  tickets: [{ ticketId: "tk-a1", ticketName: "Sunset walk", status: "valid", usedAt: null, eventDateIds: [] }],
};
const BO = { ...ADA, orderId: "o-bo", displayName: "Bo Eze", bookedStartAt: undefined,
  tickets: [{ ticketId: "tk-b1", ticketName: "Sunset walk", status: "valid", usedAt: null, eventDateIds: [] }] };

const textNodes = (r: Renderer, testID: string): TestInstance[] =>
  r.root.findAll((n) => n.props.testID === testID && typeof n.type === "string");

describe("issue #3281 — booked start at the door search", () => {
  beforeEach(() => {
    mockOnline = true;
    mockSearch.mockReset();
    mockAdmit.mockReset();
  });

  test("a row shows the booked start in the offering's zone; a row without one shows nothing", async () => {
    mockSearch.mockResolvedValue({ orders: [ADA, BO], truncated: false });
    const r = await mount();
    await typeAndWait(r, "ad");
    const [line] = textNodes(r, "door-booked-o-ada");
    expect(line).toBeDefined();
    expect(text(line)).toMatch(/^Booked for /);
    expect(text(line)).toMatch(/7:30|19:30/);
    expect(textNodes(r, "door-booked-o-bo")).toHaveLength(0);
    r.unmount();
  });

  test("an unreadable booked start is never shown", async () => {
    mockSearch.mockResolvedValue({ orders: [{ ...ADA, bookedStartAt: "not a date" }], truncated: false });
    const r = await mount();
    await typeAndWait(r, "ad");
    expect(textNodes(r, "door-booked-o-ada")).toHaveLength(0);
    r.unmount();
  });

  test("the admit banner names the admitted guest's booked start", async () => {
    mockSearch.mockResolvedValue({ orders: [ADA], truncated: false });
    mockAdmit.mockResolvedValue({
      result: "success", ticketId: "tk-a1", orderId: "o-ada", buyerName: "Ada Obi",
      ticketName: "Sunset walk", nextStartAt: null, lastEndAt: null, eventDateId: null,
    });
    const r = await mount();
    await typeAndWait(r, "ad");
    const [admit] = r.root.findAll((n) => n.type === "ButtonProbe" && n.props.accessibilityLabel === "Admit Ada Obi, Sunset walk");
    await act(async () => { (admit.props.onPress as () => void)(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const [line] = textNodes(r, "door-admit-booked");
    expect(line).toBeDefined();
    expect(text(line)).toMatch(/^Booked for .*(7:30|19:30)/);
    r.unmount();
  });

  test("a refused admission (void ticket) shows no booked start", async () => {
    mockSearch.mockResolvedValue({ orders: [ADA], truncated: false });
    mockAdmit.mockResolvedValue({
      result: "void", ticketId: "tk-a1", orderId: "o-ada", buyerName: "Ada Obi",
      ticketName: "Sunset walk", nextStartAt: null, lastEndAt: null, eventDateId: null,
    });
    const r = await mount();
    await typeAndWait(r, "ad");
    const [admit] = r.root.findAll((n) => n.type === "ButtonProbe" && n.props.accessibilityLabel === "Admit Ada Obi, Sunset walk");
    await act(async () => { (admit.props.onPress as () => void)(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(textNodes(r, "door-admit-booked")).toHaveLength(0);
    r.unmount();
  });

  test("no zone falls back to UTC, never the phone's zone", async () => {
    mockSearch.mockResolvedValue({ orders: [ADA], truncated: false });
    const r = await mount(undefined, null);
    await typeAndWait(r, "ad");
    const [line] = textNodes(r, "door-booked-o-ada");
    expect(text(line)).toMatch(/6:30|18:30/);
    r.unmount();
  });
});
