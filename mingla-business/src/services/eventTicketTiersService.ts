/** Issue #1974 — the one Business web/iOS/Android ticket-tier writer. */
import type { TicketStub } from "../store/draftEventStore";
import { supabase } from "./supabase";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const newUuid = (): string => {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const canonicalTier = (ticket: TicketStub, id: string): Record<string, unknown> => ({
  id,
  name: ticket.name,
  isFree: ticket.isFree,
  isUnlimited: ticket.isUnlimited,
  priceGbp: ticket.isFree ? null : ticket.priceGbp,
  capacity: ticket.isUnlimited ? null : ticket.capacity,
  visibility: ticket.visibility,
  displayOrder: ticket.displayOrder,
  approvalRequired: ticket.approvalRequired,
  passwordProtected: ticket.passwordProtected,
  passwordConfigured: ticket.passwordConfigured === true,
  waitlistEnabled: ticket.waitlistEnabled,
  minPurchaseQty: ticket.minPurchaseQty,
  maxPurchaseQty: ticket.maxPurchaseQty,
  allowTransfers: ticket.allowTransfers,
  description: ticket.description,
  saleStartAt: ticket.saleStartAt,
  saleEndAt: ticket.saleEndAt,
  availableAt: ticket.availableAt,
  // Intentionally no password or currency. Secrets never cross this seam and
  // currency is derived by the database from the event/brand rail.
});

export interface TicketTierMutationResult {
  event_id: string;
  representation: "draft" | "live";
  effective_currency: string | null;
  tiers: TicketStub[];
  client_revision: number | null;
  updated_at: string;
}

export async function persistEventTicketTiers(input: {
  eventId: string;
  tickets: TicketStub[];
  lifecycle: "draft" | "live";
  expectedUpdatedAt?: string | null;
  expectedClientRevision?: number | null;
  reason?: string | null;
}): Promise<TicketTierMutationResult> {
  const ids = new Map<string, string>();
  const tiers = input.tickets.map((ticket) => {
    const id = input.lifecycle === "draft" || UUID_RE.test(ticket.id)
      ? ticket.id
      : ids.get(ticket.id) ?? newUuid();
    ids.set(ticket.id, id);
    return canonicalTier(ticket, id);
  });
  const { data, error } = await supabase.rpc("business_patch_event_ticket_tiers", {
    p_event_id: input.eventId,
    p_tiers: tiers,
    p_expected_event_updated_at: input.expectedUpdatedAt ?? null,
    p_expected_client_revision: input.lifecycle === "draft"
      ? input.expectedClientRevision ?? 0
      : null,
    p_operation_id: null,
    p_reason: input.lifecycle === "live" ? input.reason ?? null : null,
  });
  if (error) throw new Error(error.message ?? "ticket_tier_save_failed");
  if (!data || typeof data !== "object") throw new Error("ticket_tier_readback_missing");
  return data as unknown as TicketTierMutationResult;
}

