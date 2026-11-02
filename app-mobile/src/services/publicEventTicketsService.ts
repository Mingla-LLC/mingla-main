/**
 * publicEventTicketsService — consumer-side fetch of ticket types for a
 * business event.
 *
 * Per META-ORCH-0827 Pass 2 Step 10 support. Mirrors mingla-business's
 * publicEventsService ticket subset, but mapped directly to
 * PublicTicketProps from @mingla/offering-rendering (skipping the full
 * LiveEvent/TicketStub type conversion that mingla-business needs for
 * its operator-facing surfaces).
 *
 * Consumer-tolerant: queries `ticket_types` directly via the anon RLS
 * policies. Only returns tickets available online.
 */

import { supabase } from "./supabase";
import type { PublicTicketProps } from "@mingla/offering-rendering";

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
  valid_occurrence_keys?: string[] | null;
}

const rowToTicket = (
  row: TicketTypeRow,
  dateIdByKey: ReadonlyMap<string, string>,
): PublicTicketProps => ({
  id: row.id,
  // issue #3281 — the dates a listed ticket covers, as `event_dates.id`s.
  validOccurrenceIds:
    row.valid_occurrence_keys?.flatMap((key) => dateIdByKey.get(key) ?? []) ?? null,
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
 * ORCH-1006/#3872 — per-tier list and sale pricing from
 * pg_public_event_tier_pricing.
 * Server-computed via compute_all_in_cents (same math the cart uses). The only
 * arithmetic the client does is cents/100 below.
 */
interface TierAllInRow {
  ticket_type_id: string;
  base_cents: number | null;
  all_in_cents: number | null;
  currency: string | null;
  sale_base_cents: number | null;
  sale_all_in_cents: number | null;
  sale_ends_at: string | null;
  sale_name: string | null;
  sale_remaining: number | null;
}

export const fetchPublicEventTickets = async (
  eventId: string,
): Promise<PublicTicketProps[]> => {
  // Two server reads, ZERO fee math in TS:
  //  1. raw ticket_types rows (base price_cents only)
  //  2. pg_public_event_tier_pricing RPC — server-computed list and sale all-in via the
  //     SAME compute_all_in_cents math the cart uses (WYSIWYP parity).
  const [ticketsRes, allInRes] = await Promise.all([
    supabase
      .from("ticket_types")
      .select(
        "id,event_id,valid_occurrence_keys,name,description,price_cents,currency,quantity_total,is_unlimited,is_free,sale_start_at,sale_end_at,is_hidden,is_disabled,requires_approval,password_protected,available_online,available_in_person,waitlist_enabled,display_order",
      )
      .eq("event_id", eventId)
      .eq("available_online", true)
      .is("deleted_at", null)
      .order("display_order", { ascending: true }),
    supabase.rpc("pg_public_event_tier_pricing", { p_event_id: eventId }),
  ]);

  if (ticketsRes.error !== null) throw ticketsRes.error;

  // issue #3281 — only a listed ticket needs the date keys. Without them it
  // would read as All dates and the server would refuse its partial cart.
  const rows = (ticketsRes.data ?? []) as TicketTypeRow[];
  const dateIdByKey = new Map<string, string>();
  if (rows.some((row) => row.valid_occurrence_keys != null)) {
    const datesRes = await supabase
      .from("event_dates")
      .select("id,occurrence_key")
      .eq("event_id", eventId);
    if (datesRes.error !== null) throw datesRes.error;
    for (const date of datesRes.data ?? []) {
      if (date.occurrence_key !== null) dateIdByKey.set(date.occurrence_key, date.id);
    }
  }

  // ticket_type_id -> all_in_cents. RPC failure is non-fatal: every tier falls
  // back to its base price in rowToTicket below (never blank).
  const allInByTier = new Map<string, number>();
  const saleByTier = new Map<string, TierAllInRow>();
  if (allInRes.error === null && Array.isArray(allInRes.data)) {
    for (const row of allInRes.data as TierAllInRow[]) {
      if (row?.ticket_type_id != null && typeof row.all_in_cents === "number") {
        allInByTier.set(row.ticket_type_id, row.all_in_cents);
        saleByTier.set(row.ticket_type_id, row);
      }
    }
  }

  return rows.map((row) => {
    const ticket = rowToTicket(row, dateIdByKey);
    // cents/100 is the ONLY math; no fee/tax derivation in TS.
    const allInCents = allInByTier.get(row.id);
    const sale = saleByTier.get(row.id);
    if (ticket.isFree) {
      ticket.priceAllInGbp = null;
    } else if (typeof allInCents === "number") {
      ticket.priceAllInGbp = allInCents / 100;
    } else {
      // No RPC row for this tier → fall back to base (priceGbp), never blank.
      ticket.priceAllInGbp = ticket.priceGbp;
    }
    ticket.salePriceGbp =
      typeof sale?.sale_base_cents === "number"
        ? sale.sale_base_cents / 100
        : null;
    ticket.saleAllInGbp =
      typeof sale?.sale_all_in_cents === "number"
        ? sale.sale_all_in_cents / 100
        : null;
    ticket.saleEndsAt = sale?.sale_ends_at ?? null;
    ticket.saleName = sale?.sale_name ?? null;
    ticket.saleRemaining = sale?.sale_remaining ?? null;
    return ticket;
  });
};
