/**
 * #4453 milestone 7 — the inputs composer v2 and Ari's design pass read:
 * Core's signed `design_pass` body (the plan, the owner's own Q5-Q8 answers,
 * Mingla's facts, other brands' live looks) checked key by key, plus this
 * site's own Studio records (ready photos, destinations, stories, confirmed
 * reviews). Anything malformed is dropped (fail closed: the section is left
 * out, never invented).
 */
import type { PayloadRequest } from "payload";
import { EMPTY_INVENTORY, type ContentInventory } from "../contracts/generated/sectionSources.ts";
import { parseFingerprint, type DesignFingerprint } from "../contracts/generated/formats.ts";
import { tickerPhrases, type FaqItem, type ProcessStep, type QuickFacts, type ValuePoint } from "../contracts/generated/sitePlan.ts";
import type { ComposeV2Answers, ComposeV2Plan, ComposeV2Sources } from "./composeFormat";

type AnyDoc = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ["trip", "event", "experience"] as const;
const VENUE_FORMATS = ["restaurants", "play", "art", "hotels"] as const;

export type SignedFacts = {
  upcoming: Record<(typeof KINDS)[number], number>;
  ended: Record<(typeof KINDS)[number], number>;
  next_offering: Partial<Record<(typeof KINDS)[number], string>>;
  bookable: Partial<Record<(typeof KINDS)[number], number>>;
  venue_id: Partial<Record<(typeof VENUE_FORMATS)[number], string>>;
  verified_venues: Partial<Record<(typeof VENUE_FORMATS)[number], number>>;
  venue_reservations_on: Partial<Record<(typeof VENUE_FORMATS)[number], boolean>>;
  open_venue_slots: Partial<Record<(typeof VENUE_FORMATS)[number], number>>;
  published_menu: boolean;
  live_stay_offerings: number;
  stay_offering_id: string | null;
  public_ticket_tiers: number;
  mingla_reviews: number;
};

export type SignedDesignPass = {
  design_key: string | null;
  plan: ComposeV2Plan | null;
  answers: ComposeV2Answers;
  address: string | null;
  facts: SignedFacts;
  style_library: boolean;
  live_fingerprints: DesignFingerprint[];
};

const obj = (value: unknown): AnyDoc => (value && typeof value === "object" && !Array.isArray(value) ? value as AnyDoc : {});
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);
const str = (value: unknown, max: number): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

function rows<T extends AnyDoc>(value: unknown, keys: readonly (keyof T & string)[], required: readonly (keyof T & string)[], max: number): T[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).flatMap((row) => {
    const raw = obj(row);
    const out: AnyDoc = {};
    for (const key of keys) {
      const text = str(raw[key], 1000);
      if (text) out[key] = text;
    }
    return required.every((key) => typeof out[key] === "string") ? [out as T] : [];
  });
}

function ids<K extends string>(value: unknown, keys: readonly K[]): Partial<Record<K, string>> {
  const raw = obj(value);
  const out: Partial<Record<K, string>> = {};
  for (const key of keys) if (typeof raw[key] === "string" && UUID.test(raw[key] as string)) out[key] = (raw[key] as string).toLowerCase();
  return out;
}

function counts<K extends string>(value: unknown, keys: readonly K[]): Record<K, number> {
  const raw = obj(value);
  return Object.fromEntries(keys.map((key) => [key, num(raw[key])])) as Record<K, number>;
}

function flags<K extends string>(value: unknown, keys: readonly K[]): Partial<Record<K, boolean>> {
  const raw = obj(value);
  return Object.fromEntries(keys.filter((key) => typeof raw[key] === "boolean").map((key) => [key, raw[key] === true])) as Partial<Record<K, boolean>>;
}

export function parseAnswers(value: unknown): ComposeV2Answers {
  const raw = obj(value);
  const quick = obj(raw.quick_facts);
  const quickFacts: QuickFacts | null = raw.quick_facts
    ? {
      facts: rows<{ big: string; small: string }>(quick.facts, ["big", "small"], ["big", "small"], 3),
      use_in_ticker: quick.use_in_ticker === true,
      ticker: Array.isArray(quick.ticker) ? quick.ticker.flatMap((item) => (str(item, 80) ? [str(item, 80)!] : [])).slice(0, 12) : [],
    }
    : null;
  return {
    value_points: rows<ValuePoint>(raw.value_points, ["title", "sentence"], ["title", "sentence"], 6),
    faq: rows<FaqItem>(raw.faq, ["question", "answer"], ["question", "answer"], 12),
    process_steps: rows<ProcessStep>(raw.process_steps, ["title", "text", "time"], ["title"], 5).map((step) => ({ ...step, text: step.text ?? "" })),
    quick_facts: quickFacts,
  };
}

export function parseSignedDesignPass(value: unknown): SignedDesignPass | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as AnyDoc;
  const facts = obj(raw.facts);
  const plan = raw.plan ? obj(raw.plan) : null;
  return {
    design_key: str(raw.design_key ?? plan?.design_key, 40),
    plan: plan
      ? {
        offerings_selected: Array.isArray(plan.offerings_selected) ? plan.offerings_selected.filter((key): key is string => typeof key === "string").slice(0, 7) : [],
        venue_descriptor: str(plan.venue_descriptor, 60),
        story: plan.story ? {
          who: str(obj(plan.story).who, 300) ?? undefined,
          why: str(obj(plan.story).why, 300) ?? undefined,
          main_action: str(obj(plan.story).main_action, 80) ?? undefined,
        } : null,
      }
      : null,
    answers: parseAnswers(raw.answers),
    address: str(raw.address, 300),
    facts: {
      upcoming: counts(facts.upcoming, KINDS),
      ended: counts(facts.ended, KINDS),
      next_offering: ids(facts.next_offering, KINDS),
      bookable: counts(facts.bookable, KINDS),
      venue_id: ids(facts.venue_id, VENUE_FORMATS),
      verified_venues: counts(facts.verified_venues, VENUE_FORMATS),
      venue_reservations_on: flags(facts.venue_reservations_on, VENUE_FORMATS),
      open_venue_slots: counts(facts.open_venue_slots, VENUE_FORMATS),
      published_menu: facts.published_menu === true,
      live_stay_offerings: num(facts.live_stay_offerings),
      stay_offering_id: typeof facts.stay_offering_id === "string" && UUID.test(facts.stay_offering_id) ? facts.stay_offering_id.toLowerCase() : null,
      public_ticket_tiers: num(facts.public_ticket_tiers),
      mingla_reviews: num(facts.mingla_reviews),
    },
    style_library: raw.style_library === true,
    live_fingerprints: Array.isArray(raw.live_fingerprints) ? raw.live_fingerprints.slice(0, 500).flatMap((fp) => parseFingerprint(fp) ?? []) : [],
  };
}

/** The venue format a plan's ticks name (for the venue facts), or null. */
const VENUE_FORMAT_FOR_TICK: Readonly<Record<string, (typeof VENUE_FORMATS)[number]>> = {
  venue_coworking: "play",
  venue_food_drink: "restaurants",
  venue_play: "play",
  venue_creative_arts: "art",
  venue_stay: "hotels",
};

export type StudioRecords = {
  photos: Array<{ id: string; alt: string | null }>;
  destination_ids: string[];
  stories: number;
  confirmed_reviews: number;
  ready_videos: number;
  has_logo: boolean;
};

/** This site's own Studio records the composer may point at. */
export async function loadStudioRecords(req: PayloadRequest, tenantId: string | number): Promise<StudioRecords> {
  const tenant = { tenant: { equals: tenantId } };
  const [photos, videos, destinations, stories, reviews] = await Promise.all([
    req.payload.find({ collection: "media", overrideAccess: true, depth: 0, limit: 12, sort: "-createdAt", where: { and: [tenant, { state: { equals: "READY" } }, { kind: { equals: "image" } }] } }),
    req.payload.count({ collection: "media", overrideAccess: true, where: { and: [tenant, { state: { equals: "READY" } }, { kind: { in: ["file_video", "stream_video"] } }] } }),
    req.payload.find({ collection: "destinations", overrideAccess: true, depth: 0, limit: 12, where: { and: [tenant, { enabled: { not_equals: false } }] } }),
    req.payload.count({ collection: "stories", overrideAccess: true, where: { and: [tenant, { enabled: { not_equals: false } }] } }),
    req.payload.count({ collection: "testimonials", overrideAccess: true, where: { and: [tenant, { confirmed_real: { equals: true } }, { enabled: { not_equals: false } }] } }),
  ]);
  return {
    // Media records carry no alt text (it lives on each block); gallery images are written without one.
    photos: photos.docs.map((doc) => ({ id: String(doc.id), alt: null })),
    destination_ids: destinations.docs.map((doc) => String(doc.id)),
    stories: stories.totalDocs,
    confirmed_reviews: reviews.totalDocs,
    ready_videos: videos.totalDocs,
    has_logo: false,
  };
}

/** The inventory and sources for one composition (counts only; ids only to point blocks). */
export function inventoryAndSources(input: {
  signed: SignedDesignPass;
  records: StudioRecords;
  offerings_selected: readonly string[];
  brand: { bio: string | null; tagline: string | null; contact_email: string | null; city: string | null };
  cover_media_id: string | null;
}): { inventory: ContentInventory; sources: ComposeV2Sources } {
  const { signed, records } = input;
  const facts = signed.facts;
  const venueFormat = input.offerings_selected.map((tick) => VENUE_FORMAT_FOR_TICK[tick]).find(Boolean) ?? null;
  const ticker = tickerPhrases(signed.answers.quick_facts);
  const inventory: ContentInventory = {
    ...EMPTY_INVENTORY,
    upcoming: facts.upcoming,
    ended: facts.ended,
    confirmed_reviews: records.confirmed_reviews,
    enabled_destinations: records.destination_ids.length,
    enabled_stories: records.stories,
    ready_photos: records.photos.length,
    ready_videos: records.ready_videos,
    value_points: signed.answers.value_points.length,
    faq_items: signed.answers.faq.length,
    process_steps: signed.answers.process_steps.length,
    quick_facts: signed.answers.quick_facts?.facts.length ?? 0,
    ticker_phrases: ticker.length,
    mingla_reviews: facts.mingla_reviews,
    has_bio: Boolean(input.brand.bio?.trim()),
    has_tagline: Boolean(input.brand.tagline?.trim()),
    has_contact_email: Boolean(input.brand.contact_email),
    has_city: Boolean(input.brand.city),
    has_logo: records.has_logo,
    has_cover: Boolean(input.cover_media_id),
    verified_venues: venueFormat ? facts.verified_venues[venueFormat] ?? 0 : 0,
    venue_reservations_on: venueFormat ? facts.venue_reservations_on[venueFormat] === true : false,
    open_venue_slots: venueFormat ? facts.open_venue_slots[venueFormat] ?? 0 : 0,
    live_stay_offerings: facts.live_stay_offerings,
    sellable_nights: facts.live_stay_offerings,
    public_ticket_tiers: facts.public_ticket_tiers,
    published_menu: facts.published_menu,
    booking_target: Boolean(
      (venueFormat && venueFormat !== "hotels" && facts.venue_id[venueFormat] && facts.venue_reservations_on[venueFormat]) ||
      (venueFormat === "hotels" && facts.stay_offering_id) ||
      facts.next_offering.experience,
    ),
  };
  return {
    inventory,
    sources: {
      cover_media_id: input.cover_media_id,
      photos: records.photos,
      destination_ids: records.destination_ids,
      next_offering: facts.next_offering,
      bookable: facts.bookable,
      venue_id: facts.venue_id,
      stay_offering_id: facts.stay_offering_id,
      address: signed.address,
    },
  };
}
