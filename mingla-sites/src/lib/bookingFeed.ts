import {
  availabilityKey,
  type AvailabilityFeed,
  type BookingRequest,
  type BookingTarget,
  bookingRequestFor,
  isEmptyBookingRequest,
  parseAvailability,
  parseBookingTarget,
  parseTicketTiers,
  targetKey,
  type TicketTiersFeed,
} from "../contracts/generated/availability.ts";
import { type MinglaRating, parseMinglaRating } from "../contracts/generated/ratings.ts";
import type { ArtifactV2 } from "../contracts/generated/artifactV2.ts";
import { signedCorePost, type SiteBinding } from "./coreGateway";
import { emitPublicObservation } from "./observability";

/*
 * #4453 milestone 5 — the live booking facts one page draws (spec v2 §5):
 * slots, nights and dates, ticket tiers, the hero booking bar's target and
 * the Mingla rating. Asked of Core for exactly what the page's STORED blocks
 * name (never what a visitor sends), cached 60 s per site and request.
 *
 * Unlike the offerings feed there is NO publish-time snapshot: a stale slot
 * shown as open would send a guest to a time that is gone, so when Core
 * cannot answer, the booking blocks render nothing (and the failure is
 * logged). Every answer is re-validated here against the contract (a link to
 * another brand, a full slot with a link, 19 reviews: dropped).
 */
export const BOOKING_FRESH_MS = 60_000;
export const BOOKING_TIMEOUT_MS = 2_500;

export type BookingView = {
  availability: ReadonlyMap<string, AvailabilityFeed>;
  ticketTiers: ReadonlyMap<string, TicketTiersFeed>;
  targets: ReadonlyMap<string, BookingTarget>;
  rating: MinglaRating | null;
};

export type BookingFetcher = (site: SiteBinding, request: BookingRequest) => Promise<unknown>;

const cache = new Map<string, { view: BookingView; fetchedAt: number }>();

export function clearBookingCache(): void {
  cache.clear();
}

export const fetchCoreBooking: BookingFetcher = async (site, request) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BOOKING_TIMEOUT_MS);
  try {
    const response = await Promise.race([
      signedCorePost({
        edgeFunction: "brand-site-runtime-resolve",
        path: `/internal/v1/sites/${site.site_id}/booking`,
        site,
        body: { site_id: site.site_id, request },
      }),
      new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("BOOKING_TIMEOUT")))),
    ]);
    if (!response.ok) throw new Error("BOOKING_UNAVAILABLE");
    const payload = await response.json() as { ok?: unknown; data?: unknown };
    if (payload?.ok !== true) throw new Error("BOOKING_UNAVAILABLE");
    return payload.data;
  } finally {
    clearTimeout(timer);
  }
};

/** Core's answer → the view, keeping only entries that pass the contract and were asked for. */
export function bookingViewFrom(raw: unknown, request: BookingRequest, brandSlug: string): BookingView {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
  const availability = new Map<string, AvailabilityFeed>();
  for (const ask of request.availability) {
    const feed = parseAvailability(pick(data.availability)[availabilityKey(ask)], brandSlug);
    if (feed && feed.source === ask.source) availability.set(availabilityKey(ask), feed);
  }
  const ticketTiers = new Map<string, TicketTiersFeed>();
  for (const eventId of request.ticket_tiers) {
    const feed = parseTicketTiers(pick(data.ticket_tiers)[eventId], brandSlug);
    if (feed && feed.event.id.toLowerCase() === eventId) ticketTiers.set(eventId, feed);
  }
  const targets = new Map<string, BookingTarget>();
  for (const ask of request.targets) {
    const target = parseBookingTarget(pick(data.targets)[targetKey(ask)], brandSlug);
    if (target && target.kind === ask.kind && target.id.toLowerCase() === ask.id) targets.set(targetKey(ask), target);
  }
  return { availability, ticketTiers, targets, rating: request.rating ? parseMinglaRating(data.rating) : null };
}

function observe(site: SiteBinding, metric: string, transition: string): void {
  emitPublicObservation({
    event: "mingla_sites_state", metric, request_id: crypto.randomUUID(), operation_id: null, site_id: site.site_id,
    publication_id: null, direction: "public_runtime", route: "/booking", state_transition: transition, latency_ms: 0,
    retry_count: 0, safe_error_code: null, status_code: null, version: "sites-v1",
  });
}

/**
 * The booking facts for one page, or undefined when the page names none, the
 * artifact carries no brand (published before the booking lock), or Core
 * cannot answer (the booking blocks then render nothing).
 */
export async function loadBooking(
  site: SiteBinding,
  artifact: Pick<ArtifactV2, "site_id" | "action_scope">,
  blocks: readonly unknown[],
  deps: { fetcher?: BookingFetcher; now?: () => number } = {},
): Promise<BookingView | undefined> {
  if (artifact.site_id !== site.site_id) throw new Error("SITE_SCOPE_MISMATCH");
  const brandSlug = artifact.action_scope?.brand_slug;
  const request = bookingRequestFor(blocks as Array<Record<string, unknown>>);
  if (!brandSlug || isEmptyBookingRequest(request)) return undefined;
  const now = deps.now ?? Date.now;
  const key = `${site.site_id}|${JSON.stringify(request)}`;
  const hit = cache.get(key);
  if (hit && now() - hit.fetchedAt < BOOKING_FRESH_MS) return hit.view;
  try {
    const view = bookingViewFrom(await (deps.fetcher ?? fetchCoreBooking)(site, request), request, brandSlug);
    cache.set(key, { view, fetchedAt: now() });
    return view;
  } catch {
    cache.delete(key);
    observe(site, "public.booking.unavailable", "booking_unavailable->blocks_omitted");
    return undefined;
  }
}
