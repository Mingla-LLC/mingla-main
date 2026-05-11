import type { TicketStub } from "../store/draftEventStore";

const ticketPriceCents = (ticket: TicketStub): number =>
  ticket.isFree || ticket.priceGbp === null
    ? 0
    : Math.round(ticket.priceGbp * 100);

export const draftTicketToTicketTypeInsert = (
  eventId: string,
  ticket: TicketStub,
  currency?: string | null,
): Record<string, unknown> => {
  const resolvedCurrency = (ticket.currency ?? currency)?.trim().toUpperCase();
  if (resolvedCurrency === undefined || resolvedCurrency.length === 0) {
    throw new Error("Ticket currency is not set.");
  }

  return {
    event_id: eventId,
    name: ticket.name,
    description: ticket.description,
    price_cents: ticketPriceCents(ticket),
    currency: resolvedCurrency,
    quantity_total: ticket.isUnlimited ? null : ticket.capacity,
    is_unlimited: ticket.isUnlimited,
    is_free: ticket.isFree,
    sale_start_at: ticket.saleStartAt,
    sale_end_at: ticket.saleEndAt,
    min_purchase_qty: ticket.minPurchaseQty,
    max_purchase_qty: ticket.maxPurchaseQty,
    is_hidden: ticket.visibility === "hidden",
    is_disabled: ticket.visibility === "disabled",
    requires_approval: ticket.approvalRequired,
    allow_transfers: ticket.allowTransfers,
    password_protected: ticket.passwordProtected,
    password_hash: null,
    available_online: ticket.availableAt === "online" || ticket.availableAt === "both",
    available_in_person: ticket.availableAt === "door" || ticket.availableAt === "both",
    waitlist_enabled: ticket.waitlistEnabled,
    display_order: ticket.displayOrder,
    deleted_at: null,
  };
};
