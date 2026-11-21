/* eslint-disable import/first */
// #4514 §6 — "Find by name" admit shows the same door line as a ticket scan,
// ready-made by the server; the panel only renders it. Harness copied from
// DoorGuestSearchSheet.issue_3281_booked_start.implementor.test.tsx.

import React from "react";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  children: (TestInstance | string)[];
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

import { DoorGuestSearchPanel, DoorGuestSearchSheet } from "../DoorGuestSearchSheet";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";


const text = (node: TestInstance): string =>
  node.children.map((c) => (typeof c === "string" ? c : text(c))).join(" ");
const textNodes = (r: Renderer, testID: string): TestInstance[] =>
  r.root.findAll((n) => n.props.testID === testID && typeof n.type === "string");

const ADA = {
  orderId: "o-ada",
  displayName: "Ada Obi",
  maskedEmail: "ad***@example.test",
  isGuestList: false,
  cameWithName: null,
  viaLinkLabel: null,
  tickets: [{ ticketId: "tk-a1", ticketName: "GA", status: "valid", usedAt: null, eventDateIds: [] }],
};
const SCAN = "77777777-7777-4777-8777-777777777777";
const admitted = (extra: Record<string, unknown>) => ({
  result: "success", ticketId: "tk-a1", orderId: "o-ada", buyerName: "Ada Obi",
  ticketName: "GA", nextStartAt: null, lastEndAt: null, eventDateId: null, ...extra,
});
const ANSWERED = {
  state: "answered",
  header: "From Quinn B.'s order",
  lines: ["Performing: Yes", "Group: 4"],
  fullAnswers: true,
};

const mount = async (onOpenAnswers?: jest.Mock): Promise<Renderer> => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let r!: Renderer;
  await act(async () => {
    r = TestRenderer.create(
      <QueryClientProvider client={client}>
        <DoorGuestSearchPanel eventId={EVENT_ID} noun="event" onOpenAnswers={onOpenAnswers} />
      </QueryClientProvider>,
    );
  });
  return r;
};

const searchAndAdmit = async (r: Renderer): Promise<void> => {
  const [field] = r.root.findAll((n) => n.type === "TextInput" && n.props.accessibilityLabel === "Search name or email");
  await act(async () => { (field.props.onChangeText as (v: string) => void)("ad"); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const [admit] = r.root.findAll((n) => n.type === "ButtonProbe" && n.props.accessibilityLabel === "Admit Ada Obi, GA");
  await act(async () => { (admit.props.onPress as () => void)(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
};
const seeAll = (r: Renderer): TestInstance[] =>
  r.root.findAll((n) => n.type === "ButtonProbe" && n.props.testID === "door-admit-see-all-answers");

describe("#4514 door line on the name admit", () => {
  beforeEach(() => {
    mockOnline = true;
    mockSearch.mockReset();
    mockAdmit.mockReset();
    mockSearch.mockResolvedValue({ orders: [ADA], truncated: false });
  });

  test("renders the server's lines and header as sent, and See all opens the admit's receipt", async () => {
    mockAdmit.mockResolvedValue(admitted({ scanId: SCAN, doorAnswers: ANSWERED }));
    const open = jest.fn();
    const r = await mount(open);
    await searchAndAdmit(r);
    const [line] = textNodes(r, "door-admit-door-answered");
    expect(text(line)).toBe("Performing: Yes · Group: 4");
    expect(r.root.findAll((n) => typeof n.type === "string" && text(n) === "From Quinn B.'s order").length).toBeGreaterThan(0);
    const [button] = seeAll(r);
    await act(async () => { (button.props.onPress as () => void)(); });
    expect(open).toHaveBeenCalledWith({ scanId: SCAN, guestName: "Ada Obi" });
    await act(async () => { r.unmount(); });
  });

  test("an unanswered form is a warning line on an admitted guest, with no See all", async () => {
    mockAdmit.mockResolvedValue(admitted({
      scanId: SCAN,
      doorAnswers: { state: "not_answered", header: null, lines: ["Questions not answered"], fullAnswers: false },
    }));
    const r = await mount(jest.fn());
    await searchAndAdmit(r);
    expect(text(textNodes(r, "door-admit-door-not_answered")[0])).toBe("Questions not answered");
    expect(seeAll(r)).toHaveLength(0);
    await act(async () => { r.unmount(); });
  });

  test("the host switch off, no receipt, or no opener (the web door): the line only", async () => {
    for (const [doorAnswers, scanId, opener] of [
      [{ ...ANSWERED, fullAnswers: false }, SCAN, jest.fn()],
      [ANSWERED, null, jest.fn()],
      [ANSWERED, SCAN, undefined],
    ] as const) {
      mockAdmit.mockResolvedValue(admitted({ scanId, doorAnswers }));
      const r = await mount(opener);
      await searchAndAdmit(r);
      expect(textNodes(r, "door-admit-door-answered")).toHaveLength(1);
      expect(seeAll(r)).toHaveLength(0);
      await act(async () => { r.unmount(); });
    }
  });

  test("no door line, or a malformed one, leaves the admit card as before", async () => {
    for (const doorAnswers of [undefined, null, "x", { state: "answered", lines: [] }, { state: "weird", lines: ["a"] }]) {
      mockAdmit.mockResolvedValue(admitted({ doorAnswers }));
      const r = await mount(jest.fn());
      await searchAndAdmit(r);
      expect(r.root.findAll((n) => n.props.testID === "door-admit-door")).toHaveLength(0);
      await act(async () => { r.unmount(); });
    }
  });

  test("the sheet renders the scanner's answers sheet inside itself (a modal over the search)", async () => {
    let r!: Renderer;
    await act(async () => {
      r = TestRenderer.create(
        <QueryClientProvider client={new QueryClient()}>
          <DoorGuestSearchSheet visible onClose={jest.fn()} eventId={EVENT_ID} noun="event" answers={React.createElement("AnswersProbe")} />
        </QueryClientProvider>,
      );
    });
    const [sheet] = r.root.findAll((n) => n.type === "SheetProbe");
    expect(sheet.findAll((n) => n.type === "AnswersProbe")).toHaveLength(1);
    await act(async () => { r.unmount(); });
  });
});
