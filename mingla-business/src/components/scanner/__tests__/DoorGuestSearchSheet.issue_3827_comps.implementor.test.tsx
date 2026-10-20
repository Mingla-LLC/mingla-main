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
import { describeScanResult } from "../scanResultCopy";
import { rosterPrimaryLabel } from "../../guests/GuestRosterExperience";
import type { GuestRosterRow } from "../../../types/guestRoster";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";

const text = (node: TestInstance): string =>
  node.children.map((c) => (typeof c === "string" ? c : text(c))).join(" ");

const mount = async (onAdmitted?: jest.Mock): Promise<Renderer> => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let r!: Renderer;
  await act(async () => {
    r = TestRenderer.create(
      <QueryClientProvider client={client}>
        <DoorGuestSearchPanel eventId={EVENT_ID} noun="event" onAdmitted={onAdmitted} />
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

const LOLU = {
  orderId: "o-lolu",
  displayName: "Lolu Ade",
  maskedEmail: null,
  isGuestList: true,
  cameWithName: "DJ Kaycee",
  tickets: [{ ticketId: "tk-l1", ticketName: "Guest list", status: "valid", usedAt: null, eventDateIds: [] }],
};
const LOLADE = {
  orderId: "o-lolade",
  displayName: "Lolade Smith",
  maskedEmail: "lo***@gmail.com",
  isGuestList: false,
  cameWithName: null,
  tickets: [
    { ticketId: "tk-a", ticketName: "General admission", status: "used", usedAt: "2026-11-01T20:31:00Z", eventDateIds: [] },
    { ticketId: "tk-b", ticketName: "General admission", status: "valid", usedAt: null, eventDateIds: [] },
    { ticketId: "tk-c", ticketName: "General admission", status: "valid", usedAt: null, eventDateIds: [] },
  ],
};

beforeEach(() => {
  mockOnline = true;
  mockSearch.mockReset();
  mockAdmit.mockReset();
});

describe("issue #3827 — door Find by name", () => {
  test("S-1 under 2 letters: helper, no request", async () => {
    const r = await mount();
    await typeAndWait(r, "l");
    expect(text(r.root)).toContain("Type at least 2 letters.");
    expect(mockSearch).not.toHaveBeenCalled();
  });

  test("S-2 results: masked email, GUEST LIST, with {lead}, Admit and Admit all", async () => {
    mockSearch.mockResolvedValue({ orders: [LOLU, LOLADE], truncated: false });
    const r = await mount();
    await typeAndWait(r, "lol");
    expect(mockSearch).toHaveBeenCalledWith({ eventId: EVENT_ID, query: "lol" });
    const all = text(r.root);
    expect(all).toContain("Lolu Ade");
    expect(all).toContain("GUEST LIST");
    expect(all).toContain("No email");
    expect(all).toContain("with DJ Kaycee");
    expect(all).toContain("lo***@gmail.com");
    expect(all).toMatch(/Checked in \d{2}:\d{2}/);
    expect(r.root.findAll((n) => n.type === "ButtonProbe" && n.props.accessibilityLabel === "Admit Lolu Ade, Guest list")).toHaveLength(1);
    expect(r.root.findAll((n) => n.type === "ButtonProbe" && n.props.label === "Admit all 2")).toHaveLength(1);
  });

  test("S-3 no match: empty copy", async () => {
    mockSearch.mockResolvedValue({ orders: [], truncated: false });
    const r = await mount();
    await typeAndWait(r, "zz");
    expect(text(r.root)).toContain(`No one called "zz" on this event's list.`);
  });

  test("S-4 offline: banner, disabled input, no request", async () => {
    mockOnline = false;
    const r = await mount();
    expect(text(r.root)).toContain("You're offline. Connect to search the guest list.");
    const [field] = r.root.findAll((n) => n.type === "TextInput");
    expect(field.props.editable).toBe(false);
    await typeAndWait(r, "lol");
    expect(mockSearch).not.toHaveBeenCalled();
  });

  test("S-5 Admit uses the real ticket id; a duplicate reads like the QR camera", async () => {
    mockSearch.mockResolvedValue({ orders: [LOLU], truncated: false });
    mockAdmit.mockResolvedValue({
      result: "duplicate", ticketId: "tk-l1", orderId: "o-lolu", buyerName: "Lolu Ade",
      ticketName: "Guest list", nextStartAt: null, lastEndAt: null, eventDateId: null,
    });
    const onAdmitted = jest.fn();
    const r = await mount(onAdmitted);
    await typeAndWait(r, "lol");
    const [admit] = r.root.findAll((n) => n.type === "ButtonProbe" && n.props.accessibilityLabel === "Admit Lolu Ade, Guest list");
    await act(async () => { (admit.props.onPress as () => void)(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(mockAdmit).toHaveBeenCalledWith({ eventId: EVENT_ID, ticketId: "tk-l1" });
    expect(text(r.root)).toContain("Already checked in");
    expect(onAdmitted).toHaveBeenCalledTimes(1);
    expect((onAdmitted.mock.calls[0][0] as { kind: string }).kind).toBe("duplicate");
  });

  test("the name-admit copy is the QR camera's copy, word for word", () => {
    const scanner = fs.readFileSync(path.join(__dirname, "../../../../app/event/[id]/scanner/index.tsx"), "utf8");
    const base = { buyerName: "Lolu Ade", ticketName: "Guest list", nextStartAt: null, lastEndAt: null };
    for (const kind of ["duplicate", "void", "not_yet_open", "not_found"]) {
      const { message } = describeScanResult(kind, base, "event");
      expect(scanner).toContain(`"${message}"`);
    }
    expect(describeScanResult("success", base, "event").message).toBe("Lolu Ade checked in");
    expect(scanner).toContain("checked in`");
  });

  test("S-6 the web door shows Find a guest by name and keeps its scan-in-the-app message", () => {
    const web = fs.readFileSync(path.join(__dirname, "../../../../app/event/[id]/scanner/index.web.tsx"), "utf8");
    expect(web).toContain("Scan tickets in the app");
    expect(web).toContain("Find a guest by name");
    expect(web).toContain("<DoorGuestSearchPanel");
    const sheet = fs.readFileSync(path.join(__dirname, "..", "DoorGuestSearchSheet.tsx"), "utf8");
    expect(sheet).not.toMatch(/from\s+["']expo-camera["']/);
    expect(sheet).not.toMatch(/from\s+["']expo-haptics["']/);
  });

  test("S-7 roster: a guest-list row reads 'Guest list'; a buyer keeps 'Bought ticket'", () => {
    const row = { primaryStatus: "bought_ticket", guestList: true } as unknown as GuestRosterRow;
    expect(rosterPrimaryLabel(row)).toBe("Guest list");
    expect(rosterPrimaryLabel({ ...row, guestList: false })).not.toBe("Guest list");
    expect(rosterPrimaryLabel({ primaryStatus: "bought_ticket" } as unknown as GuestRosterRow)).not.toBe("Guest list");
  });
});
