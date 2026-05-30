/**
 * publicEventTicketsService — consumer-side fetch of ticket types for a
 * business event.
 *
 * Per META-ORCH-0827 Pass 2 Step 10 support. Mirrors mingla-business's
 * publicEventsService ticket subset, but mapped directly to
 * PublicTicketProps from @mingla/event-rendering (skipping the full
 * LiveEvent/TicketStub type conversion that mingla-business needs for
 * its operator-facing surfaces).
 *
 * Consumer-tolerant: queries `ticket_types` directly via the anon RLS
 * policies. Only returns tickets available online.
 */

import { supabase } from "./supabase";
import type { PublicTicketProps } from "@mingla/event-rendering";

interface TicketTypeRow {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  quantity_total: number | null;
  is_unlimited: boolean;
  is_free: boolean;
  sale_start_at: string | null;
  sale_end_at: string | null;
  is_hidden: boolean;
  is_disabled: boolean;
  requires_approval: boolean;
  password_protected: boolean;
  available_online: boolean;
  available_in_person: boolean;
  waitlist_enabled: boolean;
  display_order: number;
}

const rowToTicket = (row: TicketTypeRow): PublicTicketProps => ({
  id: row.id,
  name: row.name,
  description: row.description ?? null,
  priceGbp: row.is_free ? null : row.price_cents / 100,
  currency: row.currency,
  isFree: row.is_free,
  isUnlimited: row.is_unlimited,
  capacity: row.quantity_total,
  visibility: row.is_hidden ? "hidden" : row.is_disabled ? "disabled" : "visible",
  passwordProtected: row.password_protected,
  password: null,
  saleStartAt: row.sale_start_at,
  saleEndAt: row.sale_end_at,
  approvalRequired: row.requires_approval,
  waitlistEnabled: row.waitlist_enabled,
  availableAt:
    row.available_online && row.available_in_person
      ? "both"
      : row.available_online
        ? "online"
        : "door",
  displayOrder: row.display_order,
});

/**
 * ORCH-1006 Slice 3 — per-tier all-in row from pg_public_event_tier_allin.
 * Server-computed via compute_all_in_cents (same math the cart uses). The only
 * arithmetic the client does is cents/100 below.
 */
interface TierAllInRow {
  ticket_type_id: string;
  base_cents: number | null;
  all_in_cents: number | null;
  currency: string | null;
}

export const fetchPublicEventTickets = async (
  eventId: string,
): Promise<PublicTicketProps[]> => {
  // Two server reads, ZERO fee math in TS:
  //  1. raw ticket_types rows (base price_cents only)
  //  2. pg_public_event_tier_allin RPC — server-computed all-in per tier via the
  //     SAME compute_all_in_cents math the cart uses (WYSIWYP parity).
  const [ticketsRes, allInRes] = await Promise.all([
    supabase
      .from("ticket_types")
      .select(
        "id,event_id,name,description,price_cents,currency,quantity_total,is_unlimited,is_free,sale_start_at,sale_end_at,is_hidden,is_disabled,requires_approval,password_protected,available_online,available_in_person,waitlist_enabled,display_order",
      )
      .eq("event_id", eventId)
      .eq("available_online", true)
      .is("deleted_at", null)
      .order("display_order", { ascending: true }),
    supabase.rpc("pg_public_event_tier_allin", { p_event_id: eventId }),
  ]);

  if (ticketsRes.error !== null) throw ticketsRes.error;

  // ticket_type_id -> all_in_cents. RPC failure is non-fatal: every tier falls
  // back to its base price in rowToTicket below (never blank).
  const allInByTier = new Map<string, number>();
  if (allInRes.error === null && Array.isArray(allInRes.data)) {
    for (const row of allInRes.data as TierAllInRow[]) {
      if (row?.ticket_type_id != null && typeof row.all_in_cents === "number") {
        allInByTier.set(row.ticket_type_id, row.all_in_cents);
      }
    }
  }

  return ((ticketsRes.data ?? []) as TicketTypeRow[]).map((row) => {
    const ticket = rowToTicket(row);
    // cents/100 is the ONLY math; no fee/tax derivation in TS.
    const allInCents = allInByTier.get(row.id);
    if (ticket.isFree) {
      ticket.priceAllInGbp = null;
    } else if (typeof allInCents === "number") {
      ticket.priceAllInGbp = allInCents / 100;
    } else {
      // No RPC row for this tier → fall back to base (priceGbp), never blank.
      ticket.priceAllInGbp = ticket.priceGbp;
    }
    return ticket;
  });
};
