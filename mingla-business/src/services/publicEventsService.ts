import { supabase } from "./supabase";
import type {
  DraftEventFormat,
  DraftEventVisibility,
  MultiDateEntry,
  RecurrenceRule,
  TicketStub,
  WhenMode,
} from "../store/draftEventStore";
import type { LiveEvent, LiveEventStatus } from "../store/liveEventStore";
import type {
  Brand,
  BrandCustomLink,
  BrandHourEntry,
  BrandLinks,
  VenueCategory,
} from "../types/brand";
import { parseClaimedVenueHours } from "../utils/venuePublicHours";
import { buildVenueGalleryPhotoUrls } from "../utils/venuePublicPhotos";
import {
  asEventCoverMediaProvider,
  type EventCoverMediaProvider,
} from "../types/eventCoverProvider";
import { splitBrandDescription } from "./brandMapping";

type JsonRecord = Record<string, unknown>;

interface BusinessPublicEventViewRow {
  id: string;
  brand_id: string;
  brand_slug: string;
  brand_name: string;
  brand_description: string | null;
  brand_profile_photo_url: string | null;
  brand_display_attendee_count: boolean;
  brand_kind: "physical" | "popup" | "trip_planner";
  brand_address: string | null;
  brand_cover_media_url: string | null;
  title: string;
  description: string | null;
  slug: string;
  location_text: string | null;
  online_url: string | null;
  is_online: boolean;
  is_recurring: boolean;
  is_multi_date: boolean;
  recurrence_rules: unknown;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  cover_media_provider: EventCoverMediaProvider | null;
  cover_media_source_url: string | null;
  cover_media_credit: string | null;
  cover_media_credit_url: string | null;
  cover_media_alt: string | null;
  currency?: string | null;
  visibility: string;
  show_on_discover: boolean;
  status: string;
  published_at: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
  public_theme: JsonRecord | null;
  // ORCH-0792: master event_dates columns surfaced by the view.
  master_start_at: string | null;
  master_end_at: string | null;
  master_timezone: string | null;
  master_event_date_id: string | null;
}

// ORCH-0792: split a UTC ISO timestamp into YYYY-MM-DD + HH:MM in a target
// IANA timezone. Returns nulls if input is null. Used to render event dates
// sourced from event_dates back into the date/time shape consumers expect.
const splitTimestampInTz = (
  iso: string | null,
  tz: string,
): { date: string | null; time: string | null } => {
  if (iso === null) return { date: null, time: null };
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return { date: null, time: null };
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(dt);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
};

interface BusinessPublicBrandViewRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  profile_photo_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  social_links: unknown;
  custom_links: unknown;
  display_attendee_count: boolean;
  kind: "physical" | "popup" | "trip_planner";
  address: string | null;
  cover_hue: number;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  profile_photo_type: "image" | "video" | "gif" | null;
  created_at: string;
  updated_at: string;
}

/** Ve4 — row shape from `claimed_venues_public_view`. */
export interface ClaimedVenuePublicViewRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  profile_photo_url: string | null;
  profile_photo_type: "image" | "video" | "gif" | null;
  contact_email: string | null;
  contact_phone: string | null;
  social_links: unknown;
  custom_links: unknown;
  display_attendee_count: boolean;
  address: string | null;
  city: string | null;
  country_code: string | null;
  lat: number | null;
  lng: number | null;
  cover_hue: number;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  kind: "physical";
  venue_category: VenueCategory | null;
  place_pool_id: string | null;
  google_place_id: string | null;
  created_at: string;
  updated_at: string;
  hours: unknown;
  pool_photo_urls: string[] | null;
}

/** Ve4 — structured listing fields for verified physical venues. */
export interface PublicVenueDetail {
  isVerifiedVenue: true;
  city: string | null;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
  venueCategory: VenueCategory | null;
  googlePlaceId: string | null;
  hours: BrandHourEntry[];
  galleryPhotoUrls: string[];
}

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
  min_purchase_qty: number;
  max_purchase_qty: number | null;
  is_hidden: boolean;
  is_disabled: boolean;
  requires_approval: boolean;
  allow_transfers: boolean;
  password_protected: boolean;
  available_online: boolean;
  available_in_person: boolean;
  waitlist_enabled: boolean;
  display_order: number;
}

export type PublicBrandRecord = Brand;
export type PublicEventRecord = LiveEvent;
export type PublicTicketTypeRecord = TicketStub;

export interface PublicEventDetail {
  event: PublicEventRecord;
  brand: PublicBrandRecord;
  tickets: PublicTicketTypeRecord[];
}

export interface PublicBrandDetail {
  brand: PublicBrandRecord;
  events: PublicEventRecord[];
  /** Present only for verified physical venues (Ve4). */
  venue: PublicVenueDetail | null;
}

const asRecord = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const asStringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const asDateStringOrNull = (value: unknown): string | null => {
  const candidate = asStringOrNull(value);
  if (candidate === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const [year, month, day] = candidate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return candidate;
};

const asWhenMode = (
  value: unknown,
  row: Pick<BusinessPublicEventViewRow, "is_recurring" | "is_multi_date">,
): WhenMode => {
  if (value === "recurring" || value === "multi_date" || value === "single") {
    return value;
  }
  if (row.is_multi_date) return "multi_date";
  if (row.is_recurring) return "recurring";
  return "single";
};

const asFormat = (value: unknown, isOnline: boolean): DraftEventFormat => {
  if (value === "in_person" || value === "online" || value === "hybrid") {
    return value;
  }
  return isOnline ? "online" : "in_person";
};

const asVisibility = (value: string): DraftEventVisibility => {
  if (value === "private") return "private";
  if (value === "hidden") return "unlisted";
  return "public";
};

const asCustomLinks = (value: unknown): BrandCustomLink[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is BrandCustomLink =>
      item !== null &&
      typeof item === "object" &&
      typeof (item as BrandCustomLink).label === "string" &&
      typeof (item as BrandCustomLink).url === "string",
  );
};

const asLinks = (
  socialValue: unknown,
  customValue?: unknown,
): BrandLinks | undefined => {
  const record = asRecord(socialValue);
  const links: BrandLinks = {};
  for (const key of [
    "website",
    "instagram",
    "tiktok",
    "x",
    "facebook",
    "youtube",
    "linkedin",
    "threads",
  ] as const) {
    if (typeof record[key] === "string" && record[key].length > 0) {
      links[key] = record[key];
    }
  }
  const custom = asCustomLinks(customValue);
  if (custom.length > 0) links.custom = custom;
  return Object.keys(links).length > 0 ? links : undefined;
};

const extractBrandContact = (
  email: string | null,
  phone: string | null,
): Brand["contact"] => {
  const out: NonNullable<Brand["contact"]> = {};
  if (typeof email === "string" && email.trim().length > 0) {
    out.email = email;
  }
  if (typeof phone === "string" && phone.trim().length > 0) {
    out.phone = phone;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

const viewRowToBrand = (row: BusinessPublicEventViewRow): PublicBrandRecord => {
  const theme = asRecord(row.public_theme);
  const { tagline, bio } = splitBrandDescription(row.brand_description);
  return {
    id: row.brand_id,
    displayName: row.brand_name,
    slug: row.brand_slug,
    kind: row.brand_kind,
    address: row.brand_address,
    coverHue: asNumber(theme.brandCoverHue, asNumber(theme.coverHue, 25)),
    coverMediaUrl: row.brand_cover_media_url ?? undefined,
    photo: row.brand_profile_photo_url ?? undefined,
    role: "owner",
    stats: {
      events: 0,
      followers: 0,
      rev: 0,
      rev7d: 0,
      attendees: 0,
    },
    currentLiveEvent: null,
    bio,
    tagline,
    links: asLinks(theme.brandLinks),
    displayAttendeeCount: row.brand_display_attendee_count,
  };
};

export const publicBrandViewRowToBrand = (
  row: BusinessPublicBrandViewRow,
  eventCount = 0,
): PublicBrandRecord => {
  const { tagline, bio } = splitBrandDescription(row.description);
  return {
    id: row.id,
    displayName: row.name,
    slug: row.slug,
    kind: row.kind,
    address: row.address,
    coverHue: row.cover_hue,
    coverMediaUrl: row.cover_media_url ?? undefined,
    coverMediaType: row.cover_media_type ?? undefined,
    profilePhotoType: row.profile_photo_type ?? undefined,
    photo: row.profile_photo_url ?? undefined,
    role: "owner",
    stats: {
      events: eventCount,
      followers: 0,
      rev: 0,
      rev7d: 0,
      attendees: 0,
    },
    currentLiveEvent: null,
    bio,
    tagline,
    contact: extractBrandContact(row.contact_email, row.contact_phone),
    links: asLinks(row.social_links, row.custom_links),
    displayAttendeeCount: row.display_attendee_count,
  };
};

const asVenueCategory = (value: unknown): VenueCategory | null => {
  if (
    value === "restaurant" ||
    value === "play" ||
    value === "creative_and_arts"
  ) {
    return value;
  }
  return null;
};

export const claimedVenueRowToPublicVenue = (
  row: ClaimedVenuePublicViewRow,
): PublicVenueDetail => ({
  isVerifiedVenue: true,
  city: asStringOrNull(row.city),
  countryCode: asStringOrNull(row.country_code),
  lat: typeof row.lat === "number" ? row.lat : null,
  lng: typeof row.lng === "number" ? row.lng : null,
  venueCategory: asVenueCategory(row.venue_category),
  googlePlaceId: asStringOrNull(row.google_place_id),
  hours: parseClaimedVenueHours(row.hours),
  galleryPhotoUrls: buildVenueGalleryPhotoUrls({
    coverMediaUrl: row.cover_media_url,
    profilePhotoUrl: row.profile_photo_url,
    poolPhotoUrls: row.pool_photo_urls,
  }),
});

export const claimedVenueRowToBrand = (
  row: ClaimedVenuePublicViewRow,
  eventCount = 0,
): PublicBrandRecord => {
  const { tagline, bio } = splitBrandDescription(row.description);
  return {
    id: row.id,
    displayName: row.name,
    slug: row.slug,
    kind: "physical",
    address: row.address,
    coverHue: row.cover_hue,
    coverMediaUrl: row.cover_media_url ?? undefined,
    coverMediaType: row.cover_media_type ?? undefined,
    profilePhotoType: row.profile_photo_type ?? undefined,
    photo: row.profile_photo_url ?? undefined,
    role: "owner",
    stats: {
      events: eventCount,
      followers: 0,
      rev: 0,
      rev7d: 0,
      attendees: 0,
    },
    currentLiveEvent: null,
    bio,
    tagline,
    contact: extractBrandContact(row.contact_email, row.contact_phone),
    links: asLinks(row.social_links, row.custom_links),
    displayAttendeeCount: row.display_attendee_count,
    claimStatus: "verified",
    city: asStringOrNull(row.city) ?? undefined,
    countryCode: asStringOrNull(row.country_code) ?? undefined,
    lat: typeof row.lat === "number" ? row.lat : undefined,
    lng: typeof row.lng === "number" ? row.lng : undefined,
    venueCategory: asVenueCategory(row.venue_category) ?? undefined,
    googlePlaceId: asStringOrNull(row.google_place_id) ?? undefined,
    placePoolId: row.place_pool_id ?? undefined,
  };
};

const viewStatusToLiveStatus = (status: string): LiveEventStatus => {
  if (
    status === "scheduled" ||
    status === "cancelled" ||
    status === "ended" ||
    status === "live"
  ) {
    return status;
  }
  return "scheduled";
};

const ticketRowToTicketStub = (row: TicketTypeRow): PublicTicketTypeRecord => ({
  id: row.id,
  name: row.name,
  priceGbp: row.is_free ? null : row.price_cents / 100,
  currency: row.currency,
  capacity: row.quantity_total,
  isFree: row.is_free,
  isUnlimited: row.is_unlimited,
  visibility: row.is_hidden ? "hidden" : row.is_disabled ? "disabled" : "public",
  displayOrder: row.display_order,
  approvalRequired: row.requires_approval,
  passwordProtected: row.password_protected,
  password: null,
  passwordConfigured: row.password_protected,
  waitlistEnabled: row.waitlist_enabled,
  minPurchaseQty: row.min_purchase_qty,
  maxPurchaseQty: row.max_purchase_qty,
  allowTransfers: row.allow_transfers,
  description: row.description,
  saleStartAt: row.sale_start_at,
  saleEndAt: row.sale_end_at,
  availableAt:
    row.available_online && row.available_in_person
      ? "both"
      : row.available_online
        ? "online"
        : "door",
});

export const publicEventViewRowToEvent = (
  row: BusinessPublicEventViewRow,
  tickets: PublicTicketTypeRecord[],
): PublicEventRecord => {
  const theme = asRecord(row.public_theme);
  const businessEvent = asRecord(theme.business_event);
  const location = asRecord(businessEvent.location);
  const settings = asRecord(businessEvent.settings);
  const coverHue = asNumber(businessEvent.coverHue ?? theme.coverHue, 25);
  // ORCH-0792: dates sourced from event_dates via master_* columns on the
  // view (I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY).
  const dateTimezone =
    row.master_timezone ?? asStringOrNull(row.timezone) ?? "UTC";
  const startSplit = splitTimestampInTz(row.master_start_at, dateTimezone);
  const endSplit = splitTimestampInTz(row.master_end_at, dateTimezone);
  return {
    id: row.id,
    serverEventId: row.id,
    brandId: row.brand_id,
    brandSlug: row.brand_slug,
    eventSlug: row.slug,
    status: viewStatusToLiveStatus(row.status),
    publishedAt: row.published_at ?? row.updated_at,
    cancelledAt: row.status === "cancelled" ? row.updated_at : null,
    endedAt: row.status === "ended" ? row.updated_at : null,
    name: row.title,
    description: row.description ?? "",
    format: asFormat(businessEvent.format, row.is_online),
    category: asStringOrNull(businessEvent.category),
    whenMode: asWhenMode(businessEvent.whenMode, row),
    date: startSplit.date,
    doorsOpen: startSplit.time,
    endsAt: endSplit.time,
    // ORCH-0877 — full UTC instants from the matview master_* columns.
    // Source of truth for cross-midnight display and ORCH-0850 lifecycle
    // math. When non-null these take precedence over the smart-infer
    // fallback in `computeMasterEndAtUtc`.
    masterStartAtUtc: row.master_start_at,
    masterEndAtUtc: row.master_end_at,
    timezone: dateTimezone,
    recurrenceRule:
      businessEvent.recurrenceRule === null ||
      businessEvent.recurrenceRule === undefined
        ? row.recurrence_rules === null
          ? null
          : (row.recurrence_rules as RecurrenceRule)
        : (businessEvent.recurrenceRule as RecurrenceRule),
    multiDates: Array.isArray(businessEvent.multiDates)
      ? (businessEvent.multiDates as MultiDateEntry[])
      : null,
    venueName: asStringOrNull(location.venueName) ?? row.location_text,
    address: asStringOrNull(location.address) ?? row.location_text,
    onlineUrl: row.online_url,
    hideAddressUntilTicket: asBoolean(
      businessEvent.hideAddressUntilTicket,
      true,
    ),
    coverHue,
    coverMediaUrl: row.cover_media_url,
    coverMediaType: row.cover_media_type,
    coverMediaProvider: asEventCoverMediaProvider(row.cover_media_provider),
    coverMediaSourceUrl: asStringOrNull(row.cover_media_source_url),
    coverMediaCredit: asStringOrNull(row.cover_media_credit),
    coverMediaCreditUrl: asStringOrNull(row.cover_media_credit_url),
    coverMediaAlt: asStringOrNull(row.cover_media_alt),
    currency:
      asStringOrNull(row.currency) ??
      tickets.find((ticket) => ticket.currency !== undefined)?.currency,
    tickets,
    visibility: asVisibility(row.visibility),
    requireApproval: asBoolean(
      settings.requireApproval,
      tickets.some((ticket) => ticket.approvalRequired),
    ),
    allowTransfers: asBoolean(
      settings.allowTransfers,
      tickets.every((ticket) => ticket.allowTransfers),
    ),
    hideRemainingCount: asBoolean(settings.hideRemainingCount, false),
    passwordProtected: asBoolean(
      settings.passwordProtected,
      tickets.some((ticket) => ticket.passwordProtected),
    ),
    privateGuestList: asBoolean(settings.privateGuestList, false),
    inPersonPaymentsEnabled: asBoolean(
      settings.inPersonPaymentsEnabled,
      tickets.some(
        (ticket) =>
          ticket.availableAt === "both" || ticket.availableAt === "door",
      ),
    ),
    orders: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

/**
 * ORCH-0946 — anon-callable RPC returning sold + remaining per ticket_type
 * for one event. Used by both `fetchTickets` (event side) and
 * `getPublicTripById` (trip side) to thread `remaining` through to the
 * buyer-checkout sold-out gate. Falls back to an empty map on RPC error
 * (sold-out gate is then a no-op, matching pre-ORCH-0946 behaviour — the
 * checkout RPC still rejects oversold attempts as the last line of defence).
 */
const fetchTicketTypesRemaining = async (
  eventId: string,
): Promise<Map<string, number | null>> => {
  const { data, error } = await supabase.rpc(
    "pg_public_ticket_types_remaining",
    { p_event_id: eventId },
  );
  if (error !== null) {
    console.warn(
      "[ORCH-0946] pg_public_ticket_types_remaining failed; sold-out gate degrades to checkout-RPC catch",
      error,
    );
    return new Map();
  }
  const rows = (data ?? []) as Array<{
    ticket_type_id: string;
    sold: number;
    remaining: number | null;
  }>;
  return new Map(rows.map((r) => [r.ticket_type_id, r.remaining]));
};

const fetchTickets = async (
  eventId: string,
): Promise<PublicTicketTypeRecord[]> => {
  const { data, error } = await supabase
    .from("ticket_types")
    .select(
      "id,event_id,name,description,price_cents,currency,quantity_total,is_unlimited,is_free,sale_start_at,sale_end_at,min_purchase_qty,max_purchase_qty,is_hidden,is_disabled,requires_approval,allow_transfers,password_protected,available_online,available_in_person,waitlist_enabled,display_order",
    )
    .eq("event_id", eventId)
    .eq("available_online", true)
    .is("deleted_at", null)
    .order("display_order", { ascending: true });

  if (error !== null) throw error;
  const stubs = ((data ?? []) as TicketTypeRow[]).map(ticketRowToTicketStub);
  // ORCH-0946 — overwrite capacity with remaining so the buyer-checkout
  // sold-out gate + QuantityRow "+" cap reflect what's actually bookable
  // (not total tier capacity). Unlimited tiers keep capacity=null untouched.
  const remainingById = await fetchTicketTypesRemaining(eventId);
  return stubs.map((s) => {
    if (s.isUnlimited) return s;
    const remaining = remainingById.get(s.id);
    if (remaining === undefined) return s;
    return { ...s, capacity: remaining };
  });
};

const detailFromRow = async (
  row: BusinessPublicEventViewRow,
): Promise<PublicEventDetail> => {
  const tickets = await fetchTickets(row.id);
  return {
    event: publicEventViewRowToEvent(row, tickets),
    brand: viewRowToBrand(row),
    tickets,
  };
};

export const getPublicEventBySlug = async (
  brandSlug: string,
  eventSlug: string,
): Promise<PublicEventDetail | null> => {
  // ORCH-0859 REWORK 3 (events-type-filter audit): anon buyer landing on
  // `/e/{brandSlug}/{slug}` MUST NOT resolve to a trip rendered as an
  // event. View doesn't expose event_type, so probe events table and
  // reject trip slugs. Trip-public surface is /t/{brandSlug}/{tripSlug}.
  // orch-strict-grep-allow events-type-filter — view doesn't expose event_type; trip exclusion via probe below
  const { data, error } = await supabase
    .from("business_public_events_view")
    .select("*")
    .eq("brand_slug", brandSlug)
    .eq("slug", eventSlug)
    .maybeSingle();

  if (error !== null) throw error;
  if (data === null) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any;
  // orch-strict-grep-allow events-type-filter — this IS the filter probe (returns event_type for client-side trip rejection)
  const typeResp = await supabase
    .from("events")
    .select("event_type")
    .eq("id", row.id)
    .maybeSingle();
  if (typeResp.error !== null) throw typeResp.error;
  if (typeResp.data !== null && typeResp.data.event_type === "trip") {
    return null;
  }
  return detailFromRow(data as BusinessPublicEventViewRow);
};

export const getPublicEventById = async (
  eventId: string,
): Promise<PublicEventDetail | null> => {
  // ORCH-0859 REWORK 3 (events-type-filter audit): same as
  // getPublicEventBySlug — reject trip rows from event-only public surface.
  // orch-strict-grep-allow events-type-filter — this IS the filter probe (returns event_type for client-side trip rejection)
  const typeResp = await supabase
    .from("events")
    .select("event_type")
    .eq("id", eventId)
    .maybeSingle();
  if (typeResp.error !== null) throw typeResp.error;
  if (typeResp.data !== null && typeResp.data.event_type === "trip") {
    return null;
  }

  // orch-strict-grep-allow events-type-filter — view doesn't expose event_type; trip exclusion via probe above
  const { data, error } = await supabase
    .from("business_public_events_view")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();

  if (error !== null) throw error;
  return data === null ? null : detailFromRow(data as BusinessPublicEventViewRow);
};

const fetchPublicBrandEvents = async (
  brandSlug: string,
): Promise<PublicEventRecord[]> => {
  // orch-strict-grep-allow events-type-filter — view doesn't expose event_type; trip exclusion via probe below
  const { data, error } = await supabase
    .from("business_public_events_view")
    .select("*")
    .eq("brand_slug", brandSlug)
    .order("published_at", { ascending: false, nullsFirst: false });

  if (error !== null) throw error;
  const rawRows = (data ?? []) as BusinessPublicEventViewRow[];

  // ORCH-0859 REWORK 3 (events-type-filter audit): brand-public-page
  // events list MUST exclude trips. View doesn't expose event_type;
  // probe events for the returned ids and filter trip rows out. Trips
  // get their own surfaces on the brand page (not yet implemented).
  let rows = rawRows;
  if (rawRows.length > 0) {
    const ids = rawRows.map((r) => r.id);
    // orch-strict-grep-allow events-type-filter — this IS the filter probe (returns event_type for client-side trip rejection)
    const typesResp = await supabase
      .from("events")
      .select("id, event_type")
      .in("id", ids);
    if (typesResp.error !== null) throw typesResp.error;
    const tripIds = new Set(
      ((typesResp.data ?? []) as Array<{ id: string; event_type: string | null }>)
        .filter((r) => r.event_type === "trip")
        .map((r) => r.id),
    );
    rows = rawRows.filter((r) => !tripIds.has(r.id));
  }

  const eventTickets = await Promise.all(rows.map((row) => fetchTickets(row.id)));
  return rows.map((row, idx) =>
    publicEventViewRowToEvent(row, eventTickets[idx] ?? []),
  );
};

export const getPublicBrandBySlug = async (
  brandSlug: string,
): Promise<PublicBrandDetail | null> => {
  const { data: claimedVenue, error: claimedError } = await supabase
    .from("claimed_venues_public_view")
    .select("*")
    .eq("slug", brandSlug)
    .maybeSingle();

  if (claimedError !== null) throw claimedError;

  if (claimedVenue !== null) {
    const venueRow = claimedVenue as ClaimedVenuePublicViewRow;
    const events = await fetchPublicBrandEvents(brandSlug);
    return {
      brand: claimedVenueRowToBrand(venueRow, events.length),
      venue: claimedVenueRowToPublicVenue(venueRow),
      events,
    };
  }

  const { data: brandData, error: brandError } = await supabase
    .from("business_public_brands_view")
    .select("*")
    .eq("slug", brandSlug)
    .maybeSingle();

  if (brandError !== null) throw brandError;
  if (brandData === null) return null;

  const events = await fetchPublicBrandEvents(brandSlug);
  return {
    brand: publicBrandViewRowToBrand(
      brandData as BusinessPublicBrandViewRow,
      events.length,
    ),
    venue: null,
    events,
  };
};

// ============================================================
// ORCH-0876 — getPublicTripById
// ============================================================
//
// Trip-only resolver. Lives ALONGSIDE getPublicEventById (which keeps its
// trip-rejection probe per ORCH-0859 REWORK 3 audit). Mirrors
// usePublicTripBySlug's query shape (`mingla-business/src/hooks/usePublicTripBySlug.ts`)
// but resolves by event-row-id instead of brand/trip slug pair. Used by
// the new `/checkout-trip/[tripEventId]/*` chain to load a published trip
// for the buyer-facing surface.
//
// Audit-test invariant: this function MUST pin `.eq("event_type", "trip")`.
// See mingla-business/src/services/__tests__/eventType.filter.audit.test.ts
// (extended by ORCH-0876).

import type {
  Trip,
  TripDay,
  TripInclusion,
  TripPricingTier,
} from "./tripsService";

export interface PublicTripBrand {
  id: string;
  slug: string;
  name: string;
  bio: string | null;
  coverMediaUrl: string | null;
}

export interface PublicTripDetail {
  trip: Trip;
  brand: PublicTripBrand;
}

export const getPublicTripById = async (
  tripEventId: string,
): Promise<PublicTripDetail | null> => {
  // 1. Resolve trip row — pins event_type='trip' + scheduled/live + not deleted.
  // orch-strict-grep-allow events-type-filter — ORCH-0876: trip-only resolver
  const eventResp = await supabase
    .from("events")
    .select("*")
    .eq("id", tripEventId)
    .eq("event_type", "trip")
    .in("status", ["scheduled", "live"])
    .is("deleted_at", null)
    .maybeSingle();
  if (eventResp.error !== null) throw eventResp.error;
  if (eventResp.data === null) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const event = eventResp.data as any;
  const brandId = event.brand_id as string;

  // 2. Resolve brand
  const brandResp = await supabase
    .from("brands")
    .select("id, slug, name, description, cover_media_url")
    .eq("id", brandId)
    .is("deleted_at", null)
    .maybeSingle();
  if (brandResp.error !== null) throw brandResp.error;
  if (brandResp.data === null) return null;

  const brand = brandResp.data;

  // 3. Sidecar tables — anon-readable via published-only RLS
  const [daysResp, tiersResp, inclusionsResp, ticketsResp] = await Promise.all([
    supabase
      .from("trip_days")
      .select("*")
      .eq("event_id", tripEventId)
      .order("ordinal"),
    supabase
      .from("trip_pricing_tiers")
      .select("*")
      .eq("event_id", tripEventId),
    supabase
      .from("trip_inclusions")
      .select("*")
      .eq("event_id", tripEventId)
      .order("kind")
      .order("ordinal"),
    supabase
      .from("ticket_types")
      .select("*")
      .eq("event_id", tripEventId)
      .is("deleted_at", null),
  ]);
  if (daysResp.error !== null) throw daysResp.error;
  if (tiersResp.error !== null) throw tiersResp.error;
  if (inclusionsResp.error !== null) throw inclusionsResp.error;
  if (ticketsResp.error !== null) throw ticketsResp.error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const days = (daysResp.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tiers = (tiersResp.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inclusions = (inclusionsResp.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tickets = (ticketsResp.data ?? []) as any[];

  // ORCH-0946 — remaining-capacity per ticket_type for the sold-out gate.
  const remainingById = await fetchTicketTypesRemaining(tripEventId);

  const ticketsById = new Map(tickets.map((tt) => [tt.id, tt]));
  const bt =
    (event.theme?.business_trip as Record<string, unknown> | undefined) ?? {};

  const trip: Trip = {
    id: event.id,
    brandId: event.brand_id,
    brandSlug: brand.slug,
    title: event.title,
    description: event.description,
    slug: event.slug,
    status: event.status,
    visibility: event.visibility,
    publishedAt: event.published_at,
    timezone: event.timezone,
    coverMediaUrl: event.cover_media_url,
    coverMediaType: event.cover_media_type,
    businessTrip: {
      startAt: typeof bt.startAt === "string" ? bt.startAt : null,
      endAt: typeof bt.endAt === "string" ? bt.endAt : null,
      destinationPlaceId:
        typeof bt.destinationPlaceId === "string"
          ? bt.destinationPlaceId
          : null,
      destinationLocationText:
        typeof bt.destinationLocationText === "string"
          ? bt.destinationLocationText
          : null,
      destinationLat:
        typeof bt.destinationLat === "number" ? bt.destinationLat : null,
      destinationLng:
        typeof bt.destinationLng === "number" ? bt.destinationLng : null,
      capacity: typeof bt.capacity === "number" ? bt.capacity : null,
    },
    days: days.map(
      (d): TripDay => ({
        id: d.id,
        eventId: d.event_id,
        ordinal: d.ordinal,
        title: d.title,
        narrative: d.narrative,
        date: d.date,
        stops: Array.isArray(d.stops) ? d.stops : [],
      }),
    ),
    pricingTiers: tiers.map((t): TripPricingTier => {
      const tt = ticketsById.get(t.ticket_type_id);
      const installmentSchedule =
        (t.tier_metadata?.installments as
          | TripPricingTier["installmentSchedule"]
          | undefined) ?? null;
      const isUnlimited = tt?.is_unlimited ?? false;
      // ORCH-0946 — null when unlimited or unknown; otherwise GREATEST(total - sold, 0).
      const ticketsRemaining = isUnlimited
        ? null
        : (remainingById.get(t.ticket_type_id) ?? null);
      return {
        id: t.id,
        eventId: t.event_id,
        ticketTypeId: t.ticket_type_id,
        tierName: t.tier_name,
        tierMetadata: t.tier_metadata ?? {},
        priceCents: tt?.price_cents ?? 0,
        currency: tt?.currency ?? "",
        quantityTotal: tt?.quantity_total ?? null,
        ticketsRemaining,
        isUnlimited,
        installmentSchedule,
      };
    }),
    inclusions: inclusions.map(
      (i): TripInclusion => ({
        id: i.id,
        eventId: i.event_id,
        kind: i.kind,
        item: i.item,
        ordinal: i.ordinal,
      }),
    ),
    createdAt: event.created_at,
    updatedAt: event.updated_at,
    // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] fields — read directly
    // off events row; defaults match Trip type contract.
    refundPolicy:
      (event.refund_policy as Trip["refundPolicy"] | undefined) ?? null,
    bookingDeadline: event.booking_deadline ?? null,
    bookingsClosed: event.bookings_closed === true,
    bookingsClosedAt: event.bookings_closed_at ?? null,
    ticketsSoldCount: 0,
  };

  return {
    trip,
    brand: {
      id: brand.id,
      slug: brand.slug,
      name: brand.name,
      bio: brand.description ?? null,
      coverMediaUrl: brand.cover_media_url ?? null,
    },
  };
};
