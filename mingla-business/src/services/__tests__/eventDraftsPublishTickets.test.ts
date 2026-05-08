import { describe, expect, test } from "@jest/globals";

import type { TicketStub } from "../../store/draftEventStore";
import { draftTicketToTicketTypeInsert } from "../ticketTypeMapper";

const ticket = (patch: Partial<TicketStub> = {}): TicketStub => ({
  id: "local-ticket-1",
  name: "General",
  priceGbp: 12.5,
  capacity: 40,
  isFree: false,
  isUnlimited: false,
  visibility: "public",
  displayOrder: 2,
  approvalRequired: false,
  passwordProtected: false,
  password: null,
  waitlistEnabled: true,
  minPurchaseQty: 1,
  maxPurchaseQty: 6,
  allowTransfers: true,
  description: "Entry plus drink.",
  saleStartAt: "2026-06-01T09:00:00.000Z",
  saleEndAt: null,
  availableAt: "both",
  ...patch,
});

describe("draft ticket publish mapping", () => {
  test("maps local draft tickets into server ticket_types rows without local IDs", () => {
    const row = draftTicketToTicketTypeInsert("event-uuid", ticket());

    expect(row).not.toHaveProperty("id");
    expect(row).toMatchObject({
      event_id: "event-uuid",
      name: "General",
      description: "Entry plus drink.",
      price_cents: 1250,
      currency: "GBP",
      quantity_total: 40,
      is_unlimited: false,
      is_free: false,
      sale_start_at: "2026-06-01T09:00:00.000Z",
      min_purchase_qty: 1,
      max_purchase_qty: 6,
      is_hidden: false,
      is_disabled: false,
      requires_approval: false,
      allow_transfers: true,
      password_protected: false,
      password_hash: null,
      available_online: true,
      available_in_person: true,
      waitlist_enabled: true,
      display_order: 2,
      deleted_at: null,
    });
  });

  test("maps free, hidden, unlimited, and door-only modifiers explicitly", () => {
    const row = draftTicketToTicketTypeInsert(
      "event-uuid",
      ticket({
        isFree: true,
        priceGbp: null,
        isUnlimited: true,
        capacity: null,
        visibility: "hidden",
        availableAt: "door",
      }),
    );

    expect(row.price_cents).toBe(0);
    expect(row.quantity_total).toBeNull();
    expect(row.is_hidden).toBe(true);
    expect(row.available_online).toBe(false);
    expect(row.available_in_person).toBe(true);
  });
});
