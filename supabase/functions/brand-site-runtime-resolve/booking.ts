/*
 * #4453 milestone 5 — the live booking facts for ONE site (spec v2 §5).
 *
 * The runtime asks for exactly what the page's stored blocks name (its own
 * venue, room, event or experience ids, derived by `bookingRequestFor`), and
 * Core answers from the static, service-role-only reads in
 * 20280726004453_issue_4453_booking_reads.sql. Every answer is re-validated
 * here against the shared contract before it leaves Core: a read that fails
 * the contract (a link to another brand, a full slot with a link, over the
 * limits) is dropped, so the block renders nothing (fail closed). Nothing
 * here is flagged: rendering a stored block is never flagged; offering new
 * ones is (SITES_BOOKING_BLOCKS, Studio).
 */
import {
  availabilityKey,
  type AvailabilityFeed,
  type BookingRequest,
  type BookingTarget,
  parseAvailability,
  parseBookingTarget,
  parseTicketTiers,
  targetKey,
  type TicketTiersFeed,
} from "../_shared/siteContracts/availability.ts";
import { type MinglaRating, parseMinglaRating } from "../_shared/siteContracts/ratings.ts";

export type BookingRpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

export type BookingAnswer = {
  generated_at: string;
  availability: Record<string, AvailabilityFeed>;
  ticket_tiers: Record<string, TicketTiersFeed>;
  targets: Record<string, BookingTarget>;
  rating: MinglaRating | null;
};

async function read(rpc: BookingRpc, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error("BOOKING_READ_FAILED");
  return data ?? null;
}

/** The brand slug of the site (null when the site or brand is gone). */
export async function bookingBrandSlug(rpc: BookingRpc, siteId: string): Promise<string | null> {
  const rows = await read(rpc, "brand_site_booking_brand", { p_site_id: siteId });
  const row = Array.isArray(rows) ? rows[0] : rows;
  const slug = row && typeof row === "object" ? (row as Record<string, unknown>).brand_slug : null;
  return typeof slug === "string" && slug ? slug : null;
}

export async function answerBooking(rpc: BookingRpc, siteId: string, brandSlug: string, request: BookingRequest, now = new Date()): Promise<BookingAnswer> {
  const availability: Record<string, AvailabilityFeed> = {};
  const ticketTiers: Record<string, TicketTiersFeed> = {};
  const targets: Record<string, BookingTarget> = {};
  const jobs: Promise<void>[] = [];
  for (const slots of request.availability) {
    jobs.push((async () => {
      const raw = slots.source === "venue_slots"
        ? await read(rpc, "brand_site_venue_slots", { p_site_id: siteId, p_venue_id: slots.target_id, p_party_size: slots.party_size, p_days: slots.days })
        : slots.source === "stay_nights"
        ? await read(rpc, "brand_site_stay_nights", { p_site_id: siteId, p_stay_offering_id: slots.target_id, p_days: slots.days })
        : await read(rpc, "brand_site_offering_dates", { p_site_id: siteId, p_offering_id: slots.target_id, p_source: slots.source, p_days: slots.days });
      const feed = raw === null ? null : parseAvailability(raw, brandSlug);
      if (feed && feed.source === slots.source) availability[availabilityKey(slots)] = feed;
    })());
  }
  for (const eventId of request.ticket_tiers) {
    jobs.push((async () => {
      const raw = await read(rpc, "brand_site_ticket_tiers", { p_site_id: siteId, p_event_id: eventId });
      const feed = raw === null ? null : parseTicketTiers(raw, brandSlug);
      if (feed && feed.event.id.toLowerCase() === eventId) ticketTiers[eventId] = feed;
    })());
  }
  for (const target of request.targets) {
    jobs.push((async () => {
      const raw = await read(rpc, "brand_site_booking_target", { p_site_id: siteId, p_kind: target.kind, p_target_id: target.id });
      const parsed = raw === null ? null : parseBookingTarget(raw, brandSlug);
      if (parsed && parsed.kind === target.kind && parsed.id.toLowerCase() === target.id) targets[targetKey(target)] = parsed;
    })());
  }
  let rating: MinglaRating | null = null;
  if (request.rating) {
    jobs.push((async () => {
      rating = parseMinglaRating(await read(rpc, "brand_site_mingla_rating", { p_site_id: siteId }));
    })());
  }
  await Promise.all(jobs);
  return { generated_at: now.toISOString(), availability, ticket_tiers: ticketTiers, targets, rating };
}
