/* eslint-disable import/first */
// issue #3827 — door "Find by name", TESTER ADVERSARIAL.
//
// D-1  A multi-day (all_days) pass admitted on night 1 comes back from
//      biz_door_guest_search on night 2 as status "valid" with used_at set
//      (biz_ticket_scan sets used_at on the FIRST admission and only flips
//      status to "used" once every day is consumed). The server WILL admit it
//      tonight (proved on pg17 by the tester). The door must therefore still
//      offer Admit, not "Checked in 21:04".
// D-2  The fully consumed / cancelled / refunded / transferred states stay
//      non-admissible.

import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../lib/netinfoSafe", () => ({
  useNetInfoSafe: () => ({ isConnected: true, isInternetReachable: true }),
}));
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

import { ticketStateLabel } from "../DoorGuestSearchSheet";
import type { DoorGuestTicket } from "../../../services/guestListService";

const t = (patch: Partial<DoorGuestTicket>): DoorGuestTicket => ({
  ticketId: "tk-1",
  ticketName: "Weekend pass",
  status: "valid",
  usedAt: null,
  eventDateIds: [],
  ...patch,
});

describe("issue #3827 adversarial — door ticket state", () => {
  test("D-1 a two-day pass admitted on night 1 is still admissible on night 2", () => {
    const pass = t({ status: "valid", usedAt: "2026-11-01T21:04:00Z", eventDateIds: ["night-1", "night-2"] });
    expect(ticketStateLabel(pass)).toBeNull();
  });

  test("D-2 consumed, cancelled, refunded and transferred tickets are not admissible", () => {
    expect(ticketStateLabel(t({ status: "used", usedAt: "2026-11-01T21:04:00Z" }))).not.toBeNull();
    expect(ticketStateLabel(t({ status: "valid", usedAt: "2026-11-01T21:04:00Z", eventDateIds: [] }))).not.toBeNull();
    expect(ticketStateLabel(t({ status: "valid", usedAt: "2026-11-01T21:04:00Z", eventDateIds: ["night-1"] }))).not.toBeNull();
    expect(ticketStateLabel(t({ status: "void" }))).toBe("Cancelled");
    expect(ticketStateLabel(t({ status: "refunded" }))).toBe("Refunded");
    expect(ticketStateLabel(t({ status: "transferred" }))).toBe("Transferred");
    expect(ticketStateLabel(t({ status: "valid" }))).toBeNull();
  });
});
