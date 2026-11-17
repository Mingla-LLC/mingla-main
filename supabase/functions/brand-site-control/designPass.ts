/**
 * #4453 milestone 7 (spec v2 §6.2-§6.6) — what Core signs into Studio for
 * Ari's design pass and composer v2.
 *
 *   - SITES_ARI_DESIGN_PASS and SITES_STYLE_LIBRARY, per brand
 *     (`brand_site_flag_on`: the flag, or the brand's allowlist row). Never the
 *     caller's value.
 *   - The Mingla facts composer v2 places sections from: counts and booleans
 *     (`brand_site_compose_facts`), the next bookable offering of each kind and
 *     whether it has open dates, open table slots, the next event's on-sale
 *     tiers. Ids only point blocks at this brand's own Mingla records; no name,
 *     price or date is passed for Studio to type.
 *   - The looks of OTHER brands' live sites of the same format (no brand ids),
 *     for the look-alike warning (D7: warns, never blocks).
 *
 * Any failed read fails closed: the fact is 0 / absent, so the section is
 * left out (never invented).
 */
import { primaryFormat, type FormatKey } from "../_shared/siteContracts/formats.ts";
import { mainActionPage } from "../_shared/siteContracts/sitePlan.ts";

type JsonObject = Record<string, unknown>;
type RpcResult = { data: unknown; error: { message: string } | null };
export type ServiceRpc = (fn: string, args: JsonObject) => Promise<RpcResult>;

/** The Studio actions that belong to the design pass (all three need SITES_ARI_DESIGN_PASS). */
export const DESIGN_PASS_ACTIONS: ReadonlySet<string> = new Set([
  "get_site_design_brief",
  "propose_site_design_pass",
  "propose_site_chrome",
]);

export async function brandFlagOn(rpc: ServiceRpc, flag: "SITES_ARI_DESIGN_PASS" | "SITES_STYLE_LIBRARY", brandId: string): Promise<boolean> {
  const { data, error } = await rpc("brand_site_flag_on", { p_flag: flag, p_brand_id: brandId });
  return !error && data === true;
}

type FeedRow = { id?: unknown; kind?: unknown; start_at?: unknown; end_at?: unknown };

const KINDS = ["trip", "event", "experience"] as const;
type Kind = (typeof KINDS)[number];
const DATE_SOURCE: Readonly<Record<Kind, string>> = { trip: "trip_departures", event: "event_dates", experience: "experience_slots" };
const VENUE_CATEGORY: Readonly<Record<string, "restaurants" | "play" | "art" | "hotels">> = {
  restaurant: "restaurants",
  play: "play",
  creative_and_arts: "art",
  stay: "hotels",
};

/** Open entries in a booking read's `days` (slots, dates or tiers that are not full). */
export function openCount(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const days = (value as JsonObject).days;
  if (!Array.isArray(days)) return 0;
  let open = 0;
  for (const day of days as JsonObject[]) {
    const slots = Array.isArray(day?.slots) ? day.slots as JsonObject[] : [day];
    for (const slot of slots) if (slot && slot.state !== "full" && slot.state !== "ended") open += 1;
  }
  return open;
}

export type ComposeFacts = {
  upcoming: Record<Kind, number>;
  ended: Record<Kind, number>;
  next_offering: Partial<Record<Kind, string>>;
  bookable: Partial<Record<Kind, number>>;
  venue_id: Partial<Record<"restaurants" | "play" | "art" | "hotels", string>>;
  verified_venues: Partial<Record<"restaurants" | "play" | "art" | "hotels", number>>;
  venue_reservations_on: Partial<Record<"restaurants" | "play" | "art" | "hotels", boolean>>;
  open_venue_slots: Partial<Record<"restaurants" | "play" | "art" | "hotels", number>>;
  published_menu: boolean;
  live_stay_offerings: number;
  stay_offering_id: string | null;
  public_ticket_tiers: number;
  mingla_reviews: number;
};

/** The facts, from the offerings feed rows Core already read plus the booking reads. */
/**
 * #4453 milestone 10 — `siteId` is null for a plan preview of a brand with no
 * site yet: only the feed counts are known, and every site-scoped booking read
 * is skipped (those facts stay 0 / absent, so the sections are left out).
 */
export async function composeFacts(rpc: ServiceRpc, siteId: string | null, feed: readonly FeedRow[], now = new Date()): Promise<ComposeFacts> {
  const facts: ComposeFacts = {
    upcoming: { trip: 0, event: 0, experience: 0 },
    ended: { trip: 0, event: 0, experience: 0 },
    next_offering: {},
    bookable: {},
    venue_id: {},
    verified_venues: {},
    venue_reservations_on: {},
    open_venue_slots: {},
    published_menu: false,
    live_stay_offerings: 0,
    stay_offering_id: null,
    public_ticket_tiers: 0,
    mingla_reviews: 0,
  };
  const nextStart: Partial<Record<Kind, number>> = {};
  for (const row of feed) {
    const id = typeof row.id === "string" ? row.id : null;
    if (!id) continue;
    if (row.kind === "stay") {
      facts.live_stay_offerings += 1;
      facts.stay_offering_id ??= id;
      continue;
    }
    const kind = KINDS.find((candidate) => candidate === row.kind);
    if (!kind) continue;
    const end = typeof row.end_at === "string" ? Date.parse(row.end_at) : NaN;
    const start = typeof row.start_at === "string" ? Date.parse(row.start_at) : NaN;
    const finished = Number.isFinite(end) ? end < now.getTime() : Number.isFinite(start) && start < now.getTime();
    if (finished) {
      facts.ended[kind] += 1;
      continue;
    }
    facts.upcoming[kind] += 1;
    const at = Number.isFinite(start) ? start : Number.MAX_SAFE_INTEGER;
    if (nextStart[kind] === undefined || at < nextStart[kind]!) {
      nextStart[kind] = at;
      facts.next_offering[kind] = id;
    }
  }

  if (siteId === null) return facts;
  const reads: Promise<void>[] = [];
  const base = await rpc("brand_site_compose_facts", { p_site_id: siteId });
  if (!base.error && base.data && typeof base.data === "object") {
    const raw = base.data as JsonObject;
    facts.published_menu = raw.published_menu === true;
    facts.mingla_reviews = typeof raw.mingla_reviews === "number" ? raw.mingla_reviews : 0;
    const venues = (raw.venues ?? {}) as Record<string, JsonObject>;
    for (const [category, row] of Object.entries(venues)) {
      const format = VENUE_CATEGORY[category];
      if (!format || !row) continue;
      facts.verified_venues[format] = typeof row.count === "number" ? row.count : 0;
      if (row.count === 1 && typeof row.venue_id === "string") {
        facts.venue_id[format] = row.venue_id;
        facts.venue_reservations_on[format] = row.reservations_on === true;
        if (row.reservations_on === true && format !== "hotels") {
          const venue = row.venue_id;
          reads.push(rpc("brand_site_venue_slots", { p_site_id: siteId, p_venue_id: venue, p_party_size: 2, p_days: 7 })
            .then((slots) => { facts.open_venue_slots[format] = slots.error ? 0 : openCount(slots.data); }));
        }
      }
    }
  }
  for (const kind of KINDS) {
    const id = facts.next_offering[kind];
    if (!id) continue;
    reads.push(rpc("brand_site_offering_dates", { p_site_id: siteId, p_offering_id: id, p_source: DATE_SOURCE[kind], p_days: 14 })
      .then((dates) => { facts.bookable[kind] = dates.error ? 0 : openCount(dates.data); }));
  }
  if (facts.next_offering.event) {
    reads.push(rpc("brand_site_ticket_tiers", { p_site_id: siteId, p_event_id: facts.next_offering.event })
      .then((tiers) => {
        const list = !tiers.error && tiers.data && typeof tiers.data === "object" ? (tiers.data as JsonObject).tiers : null;
        facts.public_ticket_tiers = Array.isArray(list) ? (list as JsonObject[]).filter((tier) => tier?.state === "on_sale").length : 0;
      }));
  }
  await Promise.all(reads);
  return facts;
}

export type PlanInputs = {
  offerings_selected: string[];
  venue_descriptor: string | null;
  story: JsonObject | null;
  design_key: string | null;
};

/** The brand's primary format for the plan (v2 §4.1), or null. */
export function planFormat(plan: PlanInputs): FormatKey | null {
  const mainAction = typeof plan.story?.main_action === "string" ? plan.story.main_action : null;
  return primaryFormat({ offerings_selected: plan.offerings_selected, main_action_page: mainActionPage(mainAction, plan.offerings_selected) });
}

/** Other brands' live looks of the same format (no brand ids), capped. */
export async function liveFingerprints(rpc: ServiceRpc, format: FormatKey | null, brandId: string): Promise<unknown[]> {
  if (!format) return [];
  const { data, error } = await rpc("brand_site_live_fingerprints", { p_format: format, p_brand_id: brandId });
  return !error && Array.isArray(data) ? data.slice(0, 500) : [];
}
