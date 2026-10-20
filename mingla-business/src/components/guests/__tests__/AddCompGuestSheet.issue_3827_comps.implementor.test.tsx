/* eslint-disable import/first */
// issue #3827 — "Add to guest list" sheet, implementor render proof.
//
// Renders the REAL AddCompGuestSheet (network and chrome leaves mocked) and
// pins: validation copy, sold-out tiers disabled, the issue payload (named and
// blank plus-ones), one clientRequestId reused by "Try again" which resends
// only the refused people, and that nothing is written to the phone-only
// guestStore any more.
//
// FAILS-ON-REVERT 7: re-introduce a guestStore write (recordCompEntry) in the
// sheet and the "never writes the phone store" test goes red; drop the
// retry-only-failed filter and the partial-failure test goes red.

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

const mockIssue = jest.fn<(input: Record<string, unknown>) => Promise<unknown>>();
jest.mock("../../../services/guestListService", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const actual = jest.requireActual("../../../services/guestListService") as Record<string, unknown>;
  return { ...actual, issueGuestListTickets: (input: Record<string, unknown>) => mockIssue(input) };
});
jest.mock("../../../services/supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));

let mockOrders: unknown[] = [];
jest.mock("../../../hooks/useEventOrders", () => ({
  eventOrdersKeys: { all: ["event-orders"] },
  useEventOrders: () => ({ data: mockOrders, status: "ready", isRefreshing: false, refetch: jest.fn() }),
}));
jest.mock("../../../hooks/useGuestRoster", () => ({ guestRosterKeys: { all: ["guest-roster"] } }));
jest.mock("../../../hooks/usePublicEvents", () => ({ usePublicEventById: () => ({ data: { occurrences: [] } }) }));
let mockRank = 40;
jest.mock("../../../hooks/useCurrentBrandRole", () => ({ useCurrentBrandRole: () => ({ rank: mockRank }) }));
jest.mock("../../ui/PhoneField", () => ({
  usePhoneEntry: () => ({
    countryIso: "GB", text: "", touched: false, result: { ok: false }, e164: null, isEmpty: true,
    setCountryIso: (): void => undefined, setText: (): void => undefined,
    markTouched: (): void => undefined, reset: (): void => undefined,
  }),
  PhoneField: (): null => null,
}));
jest.mock("../../ui/Sheet", () => ({
  Sheet: (props: { visible: boolean; children: React.ReactNode }) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    props.visible ? require("react").createElement("SheetProbe", null, props.children) : null,
}));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ButtonProbe", props),
}));
jest.mock("../../ui/Pill", () => ({
  Pill: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("PillProbe", props, props.children),
}));
jest.mock("../../../wrappers/SmartScrollView", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react");
  return {
    ScrollView: (props: Record<string, unknown>) => R.createElement("ScrollView", props, props.children),
  };
});

import { AddCompGuestSheet } from "../AddCompGuestSheet";
import type { LiveEvent } from "../../../store/liveEventStore";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";

const tier = (id: string, name: string, capacity: number | null, extra: Record<string, unknown> = {}) => ({
  id, name, capacity, isUnlimited: capacity === null, visibility: "public", displayOrder: 0,
  priceGbp: 0, isFree: true, approvalRequired: false, passwordProtected: false, password: null,
  waitlistEnabled: false, minPurchaseQty: 1, maxPurchaseQty: null, allowTransfers: true,
  description: null, saleStartAt: null, saleEndAt: null, availableAt: "both", ...extra,
});

const event = (tickets: unknown[]): LiveEvent => ({
  id: EVENT_ID,
  serverEventId: EVENT_ID,
  brandId: "brand-1",
  currency: "GBP",
  whenMode: "single",
  tickets,
} as unknown as LiveEvent);

const text = (node: TestInstance): string =>
  node.children.map((c) => (typeof c === "string" ? c : text(c))).join("");

const allText = (r: Renderer): string => text(r.root);

const input = (r: Renderer, label: string, index = 0): TestInstance => {
  const found = r.root.findAll((n) => n.type === "TextInput" && n.props.accessibilityLabel === label);
  if (found.length <= index) throw new Error(`no TextInput "${label}" #${index}`);
  return found[index];
};

const submit = (r: Renderer): TestInstance => {
  const [b] = r.root.findAll((n) => n.type === "ButtonProbe" && n.props.testID === "comp-submit");
  return b;
};

const press = async (node: TestInstance): Promise<void> => {
  await act(async () => {
    await (node.props.onPress as () => Promise<void> | void)();
  });
};

const type = async (node: TestInstance, value: string): Promise<void> => {
  await act(async () => {
    (node.props.onChangeText as (v: string) => void)(value);
  });
};

const mount = async (tickets: unknown[], onSuccess = jest.fn()): Promise<Renderer> => {
  const client = new QueryClient();
  let r!: Renderer;
  await act(async () => {
    r = TestRenderer.create(
      <QueryClientProvider client={client}>
        <AddCompGuestSheet visible event={event(tickets)} brandId="brand-1" onClose={jest.fn()} onSuccess={onSuccess} />
      </QueryClientProvider>,
    );
  });
  return r;
};

beforeEach(() => {
  mockIssue.mockReset();
  mockOrders = [];
  mockRank = 40;
});

describe("issue #3827 — Add to guest list sheet", () => {
  test("title, subhead and validation copy; submit stays disabled until a name is typed", async () => {
    const r = await mount([tier("tt-gl", "Guest list", 20, { visibility: "hidden" })]);
    expect(allText(r)).toContain("Add to guest list");
    expect(allText(r)).toContain("They get a free ticket with a QR code by email. Guest-list tickets take a place but aren't sales.");
    expect(submit(r).props.disabled).toBe(true);
    await type(input(r, "Full name"), "Ana Bello");
    expect(submit(r).props.disabled).toBe(false);
    expect(submit(r).props.label).toBe("Add 1 guest");
    await type(input(r, "Email"), "ana@bad");
    expect(allText(r)).toContain("That email doesn't look right.");
    expect(submit(r).props.disabled).toBe(true);
    // A hidden "Guest list" tier is offered and labelled.
    expect(allText(r)).toContain("HIDDEN");
    expect(allText(r)).toContain("20 left");
  });

  test("a sold-out tier is disabled", async () => {
    mockOrders = [{
      id: "o1", eventId: EVENT_ID, status: "paid", lines: [{ ticketTypeId: "tt-ga", quantity: 2, refundedQuantity: 0 }],
      ticketDays: [
        { ticketId: "a", ticketTypeId: "tt-ga", eventDateIds: [], status: "valid", usedAt: null },
        { ticketId: "b", ticketTypeId: "tt-ga", eventDateIds: [], status: "valid", usedAt: null },
      ],
    }];
    const r = await mount([tier("tt-ga", "General admission", 2), tier("tt-vip", "VIP", 5)]);
    const chips = r.root.findAll((n) => n.type === "Pressable" && n.props.accessibilityRole === "radio");
    const ga = chips.find((c) => String(c.props.accessibilityLabel).startsWith("General admission"));
    expect(ga?.props.disabled).toBe(true);
    expect(String(ga?.props.accessibilityLabel)).toContain("Sold out");
  });

  test("issue payload: guest, a named plus-one and a blank plus-one; one clientRequestId", async () => {
    mockIssue.mockResolvedValue({
      eventDateId: null, addedCount: 2, failedCount: 0, remaining: 17,
      results: [
        { index: 0, plusOneIndex: null, status: "added", orderId: "o-1", ticketCount: 2, emailQueued: true, smsQueued: false, code: null },
        { index: 0, plusOneIndex: 0, status: "added", orderId: "o-2", ticketCount: 1, emailQueued: true, smsQueued: false, code: null },
      ],
    });
    const onSuccess = jest.fn();
    const r = await mount([tier("tt-gl", "Guest list", 20)], onSuccess);
    await type(input(r, "Full name"), "Ada Okoro");
    await type(input(r, "Email"), "Ada@Example.com");
    const [addPlusOne] = r.root.findAll((n) => n.type === "Pressable" && n.props.accessibilityLabel === "Add a plus-one for guest 1");
    await press(addPlusOne);
    await press(addPlusOne);
    await type(input(r, "Plus-one 1 name"), "Chidi Eze");
    expect(allText(r)).toContain("No name: their QR code goes in Ada Okoro's email.");
    expect(submit(r).props.label).toBe("Add 3 guests");
    await press(submit(r));
    expect(mockIssue).toHaveBeenCalledTimes(1);
    const call = mockIssue.mock.calls[0][0] as Record<string, unknown>;
    expect(call.eventId).toBe(EVENT_ID);
    expect(call.ticketTypeId).toBe("tt-gl");
    expect(String(call.clientRequestId)).toMatch(/^[0-9a-f-]{36}$/);
    expect(call.guests).toEqual([{
      index: 0, name: "Ada Okoro", email: "ada@example.com", phoneE164: null,
      plusOnes: [
        { name: "Chidi Eze", email: null, phoneE164: null },
        { name: null, email: null, phoneE164: null },
      ],
    }]);
    expect(onSuccess).toHaveBeenCalledWith({
      message: "Ada Okoro and 2 plus-ones are on the guest list. Tickets emailed.",
      addedLegacyIds: [],
    });
  });

  test("a plus-one with an email but no name is blocked with the spec copy", async () => {
    const r = await mount([tier("tt-gl", "Guest list", 20)]);
    await type(input(r, "Full name"), "Ada Okoro");
    const [addPlusOne] = r.root.findAll((n) => n.type === "Pressable" && n.props.accessibilityLabel === "Add a plus-one for guest 1");
    await press(addPlusOne);
    await type(input(r, "Plus-one 1 email"), "chidi@example.com");
    await press(submit(r));
    expect(allText(r)).toContain("Add their name, or leave all three empty.");
    expect(mockIssue).not.toHaveBeenCalled();
  });

  test("partial failure: banner, 'Try again' resends ONLY the refused guest with the SAME clientRequestId", async () => {
    mockIssue.mockResolvedValueOnce({
      eventDateId: null, addedCount: 1, failedCount: 1, remaining: 18,
      results: [
        { index: 0, plusOneIndex: null, status: "added", orderId: "o-1", ticketCount: 1, emailQueued: true, smsQueued: false, code: null },
        { index: 1, plusOneIndex: null, status: "failed", orderId: null, ticketCount: null, emailQueued: false, smsQueued: false, code: "already_on_guest_list" },
      ],
    });
    const onSuccess = jest.fn();
    const r = await mount([tier("tt-gl", "Guest list", 20)], onSuccess);
    await type(input(r, "Full name"), "Kaycee");
    const [another] = r.root.findAll((n) => n.type === "Pressable" && n.props.accessibilityLabel === "Add another guest");
    await press(another);
    await type(input(r, "Full name", 1), "Temi Bello");
    await type(input(r, "Email", 1), "temi@example.com");
    await press(submit(r));
    expect(allText(r)).toContain("1 added, 1 couldn't be added.");
    expect(allText(r)).toContain("Already on the guest list for this event.");
    expect(allText(r)).toContain("✓ Added");
    expect(submit(r).props.label).toBe("Try again");
    expect(onSuccess).not.toHaveBeenCalled();

    mockIssue.mockResolvedValueOnce({
      eventDateId: null, addedCount: 1, failedCount: 0, remaining: 17,
      results: [{ index: 1, plusOneIndex: null, status: "added", orderId: "o-2", ticketCount: 1, emailQueued: true, smsQueued: false, code: null }],
    });
    await type(input(r, "Email"), "temi.b@example.com");
    await press(submit(r));
    expect(mockIssue).toHaveBeenCalledTimes(2);
    const first = mockIssue.mock.calls[0][0] as { clientRequestId: string };
    const second = mockIssue.mock.calls[1][0] as { clientRequestId: string; guests: Array<{ index: number; email: string }> };
    expect(second.clientRequestId).toBe(first.clientRequestId);
    expect(second.guests).toHaveLength(1);
    expect(second.guests[0]).toMatchObject({ index: 1, email: "temi.b@example.com" });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  test("a whole-request refusal shows the server copy and keeps the inputs", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GuestListError } = require("../../../services/guestListService") as typeof import("../../../services/guestListService");
    mockIssue.mockRejectedValue(new GuestListError({ code: "ticket_capacity_exceeded", operation: "issue", remaining: 0, ticketName: "Guest list" }));
    const r = await mount([tier("tt-gl", "Guest list", 20)]);
    await type(input(r, "Full name"), "Ana Bello");
    await press(submit(r));
    expect(allText(r)).toContain("Not enough places left on Guest list. 0 left.");
    expect(input(r, "Full name").props.value).toBe("Ana Bello");
  });

  test("without ADD_COMP_GUEST the button is disabled with the gate caption", async () => {
    mockRank = 20;
    const r = await mount([tier("tt-gl", "Guest list", 20)]);
    await type(input(r, "Full name"), "Ana Bello");
    expect(submit(r).props.disabled).toBe(true);
  });

  test("never writes the phone-only guestStore (comps are server tickets now)", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "AddCompGuestSheet.tsx"), "utf8");
    expect(source).not.toMatch(/guestStore/);
    expect(source).not.toMatch(/recordCompEntry/);
    expect(source).not.toMatch(/sleep\(/);
    expect(source).toMatch(/issueGuestListTickets\(/);
  });
});
