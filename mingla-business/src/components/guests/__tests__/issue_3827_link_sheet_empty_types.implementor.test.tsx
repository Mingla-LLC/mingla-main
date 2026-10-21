/* eslint-disable import/first */
// issue #3827 — the New link form never leaves a host at an empty Ticket type
// picker.
//
// Renders the REAL TicketLinksSheet (network and chrome leaves mocked):
//   - an event whose only type is a PUBLIC PAID ticket shows why nothing can
//     use a link, plus "Add a hidden paid ticket" and "Add a free guest-list
//     ticket", each handing its preset to the caller;
//   - Create link is disabled, with the reason shown, while no type is picked;
//   - when eligible types exist the "Ticket type" picker lists exactly them
//     and Create link turns on;
//   - opened from inside the ticket editor (no `onAddTicketType`) the empty
//     state explains the rule without buttons that would do nothing.
//
// FAILS-ON-REVERT: remove the `ticket-link-no-types` block and the empty-state
// tests go red; drop `noTypeSelected` from Create link's `disabled` and the
// disabled test goes red.

import React from "react";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

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

jest.mock("../../../services/ticketLinksService", () => ({
  listTicketLinks: async () => [],
  createTicketLink: async () => ({ id: "link-1", url: "https://example.test/g/abc" }),
}));
jest.mock("../../../utils/sharePublicUrl", () => ({
  copyPublicUrl: async () => undefined,
  sharePublicUrl: async () => undefined,
}));
jest.mock("@react-native-community/datetimepicker", () => ({ __esModule: true, default: (): null => null }));
jest.mock("../../ui/WebDateTimeInput", () => ({ WebDateTimeInput: (): null => null }));
jest.mock("../TicketLinkRequestsSheet", () => ({ TicketLinkRequestsSheet: (): null => null }));
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
jest.mock("../../ui/IconChrome", () => ({
  IconChrome: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("IconChromeProbe", props),
}));
jest.mock("../../ui/Input", () => ({
  Input: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("InputProbe", props),
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

import { TicketLinksSheet } from "../TicketLinksSheet";
import type { TicketStub } from "../../../store/draftEventStore";
import type { NewTicketPreset } from "../../../utils/ticketLinkEligibility";

const tier = (id: string, name: string, extra: Partial<TicketStub> = {}): TicketStub => ({
  id, name, priceGbp: 25, capacity: 100, isFree: false, isUnlimited: false, visibility: "public",
  displayOrder: 0, approvalRequired: false, passwordProtected: false, password: null,
  waitlistEnabled: false, minPurchaseQty: 1, maxPurchaseQty: null, allowTransfers: true,
  description: null, saleStartAt: null, saleEndAt: null, availableAt: "both",
  ...extra,
} as TicketStub);

const text = (node: TestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(text).join("");

const byTestID = (r: Renderer, id: string): TestInstance[] =>
  r.root.findAll((n) => typeof n.type === "string" && n.props.testID === id);

const buttons = (r: Renderer): TestInstance[] => r.root.findAll((n) => n.type === "ButtonProbe");
const button = (r: Renderer, label: string): TestInstance | undefined =>
  buttons(r).find((n) => n.props.label === label);

const mount = async (
  tickets: TicketStub[],
  onAddTicketType?: (preset: NewTicketPreset) => void,
): Promise<Renderer> => {
  let r: Renderer | undefined;
  await act(async () => {
    r = TestRenderer.create(
      <TicketLinksSheet
        visible
        eventId="event-3827"
        eventTitle="Detty December Weekend"
        tickets={tickets}
        startCreating
        onClose={() => undefined}
        onAddTicketType={onAddTicketType}
      />,
    );
  });
  return r as Renderer;
};

describe("#3827 New link — empty Ticket type picker", () => {
  let added: NewTicketPreset[];
  beforeEach(() => {
    added = [];
  });

  test("only a public paid ticket: says why, and offers both ways to add a type", async () => {
    const r = await mount([tier("ga", "General Admission")], (preset) => added.push(preset));
    const empty = byTestID(r, "ticket-link-no-types");
    expect(empty).toHaveLength(1);
    const copy = text(empty[0]);
    expect(copy).toContain("No ticket types can use a private link yet.");
    expect(copy).toContain("Paid links need a hidden ticket type; free guest-list links can use any free type.");
    // The public paid ticket is NOT offered as a choice.
    expect(byTestID(r, "ticket-link-type-ga")).toHaveLength(0);

    const hidden = button(r, "Add a hidden paid ticket");
    const free = button(r, "Add a free guest-list ticket");
    expect(hidden).toBeDefined();
    expect(free).toBeDefined();
    await act(() => (hidden?.props.onPress as () => void)());
    await act(() => (free?.props.onPress as () => void)());
    expect(added).toEqual(["hidden-paid", "free-guest-list"]);
  });

  test("Create link is disabled, with the reason on screen, while no type is selected", async () => {
    const r = await mount([tier("ga", "General Admission")], () => undefined);
    const submit = button(r, "Create link");
    expect(submit?.props.disabled).toBe(true);
    expect(submit?.props.accessibilityHint).toBe("Pick a ticket type to create a link.");
    expect(text(byTestID(r, "ticket-link-create-disabled-reason")[0])).toBe("Pick a ticket type to create a link.");
  });

  test("eligible types render under the Ticket type label and Create link turns on", async () => {
    const r = await mount([
      tier("ga", "General Admission"),
      tier("vip", "VIP table", { visibility: "hidden" }),
      tier("gl", "Guest list", { isFree: true, priceGbp: null }),
    ], () => undefined);
    const labels = r.root.findAll((n) => n.type === "Text").map(text);
    expect(labels).toContain("Ticket type");
    expect(byTestID(r, "ticket-link-no-types")).toHaveLength(0);
    expect(byTestID(r, "ticket-link-type-ga")).toHaveLength(0);
    expect(byTestID(r, "ticket-link-type-vip")).toHaveLength(1);
    expect(byTestID(r, "ticket-link-type-gl")).toHaveLength(1);
    expect(text(byTestID(r, "ticket-link-type-vip")[0])).toContain("Private ticket · Hidden");
    expect(text(byTestID(r, "ticket-link-type-gl")[0])).toContain("Guest list · Public");
    expect(button(r, "Create link")?.props.disabled).toBe(false);
    expect(byTestID(r, "ticket-link-create-disabled-reason")).toHaveLength(0);
  });

  test("opened without a way to add a type, the empty state explains and shows no dead buttons", async () => {
    const r = await mount([tier("ga", "General Admission")]);
    expect(byTestID(r, "ticket-link-no-types")).toHaveLength(1);
    expect(button(r, "Add a hidden paid ticket")).toBeUndefined();
    expect(button(r, "Add a free guest-list ticket")).toBeUndefined();
    expect(text(byTestID(r, "ticket-link-no-types")[0])).toContain("Tickets section");
  });
});
