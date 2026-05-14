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

export const fetchPublicEventTickets = async (
  eventId: string,
): Promise<PublicTicketProps[]> => {
  const { data, error } = await supabase
    .from("ticket_types")
    .select(
      "id,event_id,name,description,price_cents,currency,quantity_total,is_unlimited,is_free,sale_start_at,sale_end_at,is_hidden,is_disabled,requires_approval,password_protected,available_online,available_in_person,waitlist_enabled,display_order",
    )
    .eq("event_id", eventId)
    .eq("available_online", true)
    .is("deleted_at", null)
    .order("display_order", { ascending: true });

  if (error !== null) throw error;
  return ((data ?? []) as TicketTypeRow[]).map(rowToTicket);
};
