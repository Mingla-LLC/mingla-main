import { supabase } from "./supabase";
import type {
  DraftEvent,
  DraftEventFormat,
  DraftEventVisibility,
  EventCoverMediaType,
  MultiDateEntry,
  RecurrenceRule,
  TicketStub,
  WhenMode,
} from "../store/draftEventStore";
import type { LiveEvent, LiveEventStatus } from "../store/liveEventStore";
import type { Brand, BrandLinks } from "../store/currentBrandStore";
import {
  asEventCoverMediaProvider,
  type EventCoverMediaProvider,
} from "../types/eventCoverProvider";
import { draftToServerUpdate, publishedVisibilityForDraft } from "../utils/serverDraftEventMapper";
// ORCH-0808 — organizer-funnel instrumentation.
import { logAppsFlyerEvent } from "./appsFlyerService";

type JsonRecord = Record<string, unknown>;

interface BusinessManagementEventRow {
  id: string;
  brand_id: string;
  created_by: string;
  brand_slug: string;
  brand_name: string;
  brand_profile_photo_url: string | null;
  brand_display_attendee_count: boolean;
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
  cover_media_type: EventCoverMediaType | null;
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
  management_theme: JsonRecord | null;
  // ORCH-0792: master event_dates columns surfaced by the view.
  // LEFT JOIN means these are null on draft rows; the view filter
  // currently excludes drafts so non-null in practice post-backfill.
  master_start_at: string | null;
  master_end_at: string | null;
  master_timezone: string | null;
  master_event_date_id: string | null;
  // ORCH-0824 hotfix: top-level taxonomy + city columns surfaced via the
  // business_management_events_view after migration 20260604000002.
  // Optional during transition — legacy persisted rows + pre-view-update
  // responses won't have them; the eventFromRow reader defaults to empty
  // arrays / null.
  city?: string | null;
  party_types?: string[] | null;
  vibe_tags?: string[] | null;
  music_genres?: string[] | null;
  location_geo?: string | { x: number; y: number } | null;
}

// ORCH-0792: derive YYYY-MM-DD + HH:MM in the event's IANA timezone from a
// UTC ISO timestamp. Returns nulls when input is null so callers can fall
// back gracefully (e.g., a draft row pre-backfill).
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

interface PublishRpcResponse {
  event: {
    id: string;
    brand_id: string;
    created_by: string;
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
    cover_media_type: EventCoverMediaType | null;
    cover_media_provider?: EventCoverMediaProvider | null;
    cover_media_source_url?: string | null;
    cover_media_credit?: string | null;
    cover_media_credit_url?: string | null;
    cover_media_alt?: string | null;
    currency?: string | null;
    visibility: string;
    status: string;
    published_at: string | null;
    timezone: string;
    created_at: string;
    updated_at: string;
    theme: JsonRecord | null;
    // ORCH-0824: top-level columns returned via `to_jsonb(v_event)` in
    // the publish RPC. Optional during transition for old test fixtures.
    city?: string | null;
    party_types?: string[] | null;
    vibe_tags?: string[] | null;
    music_genres?: string[] | null;
    location_geo?: string | { x: number; y: number } | null;
  };
  brand: {
    id: string;
    slug: string;
    name: string;
  };
  tickets: TicketTypeRow[];
  // ORCH-0792: publish RPC also returns event_dates rows so the client can
  // populate date displays without a second round-trip. Optional to keep
  // backward compatibility with pre-ORCH-0792 test fixtures; runtime
  // production responses always include this field.
  eventDates?: Array<{
    id: string;
    event_id: string;
    start_at: string;
    end_at: string;
    timezone: string;
    is_master: boolean;
  }>;
  client_revision: number | null;
}

export interface BusinessEventDetail {
  event: LiveEvent;
  brand: Brand;
  tickets: TicketStub[];
}

export interface PublishedBusinessEvent {
  event: LiveEvent;
  brand: Pick<Brand, "id" | "slug" | "displayName">;
  tickets: TicketStub[];
  clientRevision: number | null;
}

const BUSINESS_EVENT_SELECT = "*";
const TICKET_SELECT =
  "id,event_id,name,description,price_cents,currency,quantity_total,is_unlimited,is_free,sale_start_at,sale_end_at,min_purchase_qty,max_purchase_qty,is_hidden,is_disabled,requires_approval,allow_transfers,password_protected,available_online,available_in_person,waitlist_enabled,display_order";

const asRecord = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const asStringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const asWhenMode = (
  value: unknown,
  row: Pick<BusinessManagementEventRow, "is_recurring" | "is_multi_date">,
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

const asLinks = (value: unknown): BrandLinks | undefined => {
  const record = asRecord(value);
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
  return Object.keys(links).length > 0 ? links : undefined;
};

const viewStatusToLiveStatus = (status: string): LiveEventStatus => {
  if (
    status === "scheduled" ||
    status === "live" ||
    status === "cancelled" ||
    status === "ended"
  ) {
    return status;
  }
  return "scheduled";
};

export const ticketRowToTicketStub = (row: TicketTypeRow): TicketStub => ({
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

const brandFromRow = (row: BusinessManagementEventRow): Brand => {
  const theme = asRecord(row.management_theme);
  return {
    id: row.brand_id,
    displayName: row.brand_name,
    slug: row.brand_slug,
    kind: "popup",
    address: null,
    coverHue: asNumber(theme.brandCoverHue, asNumber(theme.coverHue, 25)),
    photo: row.brand_profile_photo_url ?? undefined,
    role: "owner",
    stats: { events: 0, followers: 0, rev: 0, rev7d: 0, attendees: 0 },
    currentLiveEvent: null,
    bio: undefined,
    tagline: undefined,
    links: asLinks(theme.brandLinks),
    displayAttendeeCount: row.brand_display_attendee_count,
  };
};

const eventFromRow = (
  row: BusinessManagementEventRow,
  tickets: TicketStub[],
  // ORCH-0865 REWORK 5: discriminator passed in from the 2-step probe
  // (fetchBusinessEventsForBrand) so the LiveEvent carries event_type
  // into the cache → home/hub tap-handlers can route trips vs events
  // correctly via routeForEventRow. View doesn't expose event_type so
  // we attach it here from the events-table probe result.
  eventType: "event" | "experience" | "trip" = "event",
): LiveEvent => {
  const theme = asRecord(row.management_theme);
  const businessEvent = asRecord(theme.business_event);
  const location = asRecord(businessEvent.location);
  const settings = asRecord(businessEvent.settings);

  // ORCH-0792: dates sourced from event_dates via master_* columns on the
  // view (I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY). The view filter
  // excludes drafts; post-backfill every non-draft row has master_*.
  const dateTimezone = row.master_timezone ?? row.timezone;
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
    // ORCH-0865 REWORK 5: attach event_type from the 2-step probe so
    // home/hub tap-handlers can dispatch correctly via routeForEventRow.
    event_type: eventType,
    name: row.title,
    description: row.description ?? "",
    format: asFormat(businessEvent.format, row.is_online),
    // ORCH-0824: legacy `category` is read-only from JSONB for backward
    // compat with pre-ORCH-0824 events; new publishes write null (the
    // canonical replacement is partyTypes/vibeTags/musicGenres below).
    category: asStringOrNull(businessEvent.category),
    // ORCH-0824 hotfix: read taxonomy from TOP-LEVEL row columns, NOT
    // from the JSONB blob (which the publish RPC strips). Defensive
    // defaults handle pre-view-update responses where the columns aren't
    // surfaced yet.
    partyTypes: Array.isArray(row.party_types)
      ? row.party_types.filter((s): s is string => typeof s === "string")
      : [],
    vibeTags: Array.isArray(row.vibe_tags)
      ? row.vibe_tags.filter((s): s is string => typeof s === "string")
      : [],
    musicGenres: Array.isArray(row.music_genres)
      ? row.music_genres.filter((s): s is string => typeof s === "string")
      : [],
    city: asStringOrNull(row.city),
    locationGeo: ((): { lat: number; lng: number } | null => {
      const g = row.location_geo;
      if (g == null) return null;
      if (typeof g === "string") {
        const m = g.match(/^\(([-\d.]+),([-\d.]+)\)$/);
        return m ? { lng: Number(m[1]), lat: Number(m[2]) } : null;
      }
      if (typeof g === "object" && typeof g.x === "number" && typeof g.y === "number") {
        return { lng: g.x, lat: g.y };
      }
      return null;
    })(),
    whenMode: asWhenMode(businessEvent.whenMode, row),
    date: startSplit.date,
    doorsOpen: startSplit.time,
    endsAt: endSplit.time,
    timezone: dateTimezone,
    recurrenceRule:
      businessEvent.recurrenceRule === null ||
      businessEvent.recurrenceRule === undefined
        ? null
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
    coverHue: asNumber(businessEvent.coverHue ?? theme.coverHue, 25),
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
    requireApproval: asBoolean(settings.requireApproval, tickets.some((t) => t.approvalRequired)),
    allowTransfers: asBoolean(settings.allowTransfers, tickets.every((t) => t.allowTransfers)),
    hideRemainingCount: asBoolean(settings.hideRemainingCount, false),
    passwordProtected: asBoolean(settings.passwordProtected, tickets.some((t) => t.passwordProtected)),
    privateGuestList: asBoolean(settings.privateGuestList, false),
    inPersonPaymentsEnabled: asBoolean(
      settings.inPersonPaymentsEnabled,
      tickets.some((ticket) => ticket.availableAt === "both" || ticket.availableAt === "door"),
    ),
    orders: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const fetchTicketsForEvent = async (eventId: string): Promise<TicketStub[]> => {
  const { data, error } = await supabase
    .from("ticket_types")
    .select(TICKET_SELECT)
    .eq("event_id", eventId)
    .is("deleted_at", null)
    .order("display_order", { ascending: true });

  if (error !== null) throw error;
  return ((data ?? []) as TicketTypeRow[]).map(ticketRowToTicketStub);
};

const detailFromRow = async (
  row: BusinessManagementEventRow,
): Promise<BusinessEventDetail> => {
  const tickets = await fetchTicketsForEvent(row.id);
  return {
    event: eventFromRow(row, tickets),
    brand: brandFromRow(row),
    tickets,
  };
};

export const fetchBusinessEventsForBrand = async (
  brandId: string,
): Promise<LiveEvent[]> => {
  // orch-strict-grep-allow events-type-filter — view doesn't expose event_type; trip exclusion via 2-step probe below (.from("events").select("id, event_type")) — pattern documented in ORCH-0859 REWORK 2
  const { data, error } = await supabase
    .from("business_management_events_view")
    .select(BUSINESS_EVENT_SELECT)
    .eq("brand_id", brandId)
    .order("published_at", { ascending: false, nullsFirst: false });

  if (error !== null) throw error;
  const rows = (data ?? []) as BusinessManagementEventRow[];

  // ORCH-0859 REWORK 2 (operator smoke #1): exclude event_type='trip' so
  // trip-planner trips don't leak into the events tab. Trips live in their
  // own /hub/trips view via useTripsByBrand. The view doesn't expose
  // event_type, so filter client-side via a second small query.
  // Mirrors the filter the discover-merged-events edge function already
  // applies for the consumer feed
  // (supabase/functions/discover-merged-events/index.ts).
  let filteredRows = rows;
  // ORCH-0865 REWORK 5: capture event_type per id so we can attach it to
  // the LiveEvent output (defensive: tap-handlers route trips → /trip/{id}
  // even if a trip leaks past this filter via a future regression).
  const eventTypeById = new Map<string, "event" | "experience" | "trip">();
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    // orch-strict-grep-allow events-type-filter — this IS the filter probe (returns event_type for client-side trip rejection)
    const typesResp = await supabase
      .from("events")
      .select("id, event_type")
      .in("id", ids);
    if (typesResp.error !== null) throw typesResp.error;
    const tripIds = new Set<string>();
    for (const r of (typesResp.data ?? []) as Array<{
      id: string;
      event_type: "event" | "experience" | "trip" | null;
    }>) {
      const t = r.event_type ?? "event";
      eventTypeById.set(r.id, t);
      if (t === "trip") tripIds.add(r.id);
    }
    filteredRows = rows.filter((r) => !tripIds.has(r.id));
  }

  // [ORCH-0859-REWORK-4-DIAG] events-tab-leak diagnostic — proves the
  // filter is running in the operator's deployed bundle. Reaps at CLOSE.
  // eslint-disable-next-line no-console
  console.log("[ORCH-0859-REWORK-4-DIAG] fetchBusinessEventsForBrand", {
    brandId,
    rowsCount: rows.length,
    tripIdsCount:
      rows.length > 0
        ? rows.filter((r) => !filteredRows.includes(r)).length
        : 0,
    filteredCount: filteredRows.length,
  });

  const ticketLists = await Promise.all(
    filteredRows.map((row) => fetchTicketsForEvent(row.id)),
  );
  return filteredRows.map((row, idx) =>
    eventFromRow(
      row,
      ticketLists[idx] ?? [],
      eventTypeById.get(row.id) ?? "event",
    ),
  );
};

export const fetchBusinessEventById = async (
  eventId: string,
): Promise<BusinessEventDetail | null> => {
  // ORCH-0859 REWORK 3 (events-type-filter audit): view doesn't expose
  // event_type. Do a second small probe against events to reject trips.
  // Single-event detail is event-only; trip detail lives at /trip/{id}.
  // orch-strict-grep-allow events-type-filter — this IS the filter probe (returns event_type for client-side trip rejection)
  const typeResp = await supabase
    .from("events")
    .select("id, event_type")
    .eq("id", eventId)
    .maybeSingle();
  if (typeResp.error !== null) throw typeResp.error;
  if (typeResp.data !== null && typeResp.data.event_type === "trip") {
    return null;
  }

  // orch-strict-grep-allow events-type-filter — view doesn't expose event_type; trip exclusion via probe above
  const { data, error } = await supabase
    .from("business_management_events_view")
    .select(BUSINESS_EVENT_SELECT)
    .eq("id", eventId)
    .maybeSingle();

  if (error !== null) throw error;
  return data === null ? null : detailFromRow(data as BusinessManagementEventRow);
};

const eventFromPublishResponse = (
  response: PublishRpcResponse,
): PublishedBusinessEvent => {
  const businessEvent = asRecord(asRecord(response.event.theme).business_event);
  if (response.event.currency === null || response.event.currency === undefined) {
    throw new Error("Published event is missing currency.");
  }
  // ORCH-0792: extract master event_dates row from the RPC response so the
  // synthetic BusinessManagementEventRow has master_* populated, matching
  // what business_management_events_view returns on subsequent fetches.
  const masterRow =
    (response.eventDates ?? []).find((d) => d.is_master === true) ?? null;
  const row: BusinessManagementEventRow = {
    id: response.event.id,
    brand_id: response.event.brand_id,
    created_by: response.event.created_by,
    brand_slug: response.brand.slug,
    brand_name: response.brand.name,
    brand_profile_photo_url: null,
    brand_display_attendee_count: false,
    title: response.event.title,
    description: response.event.description,
    slug: response.event.slug,
    location_text: response.event.location_text,
    online_url: response.event.online_url,
    is_online: response.event.is_online,
    is_recurring: response.event.is_recurring,
    is_multi_date: response.event.is_multi_date,
    recurrence_rules: response.event.recurrence_rules,
    cover_media_url: response.event.cover_media_url,
    cover_media_type: response.event.cover_media_type,
    cover_media_provider: response.event.cover_media_provider ?? null,
    cover_media_source_url: response.event.cover_media_source_url ?? null,
    cover_media_credit: response.event.cover_media_credit ?? null,
    cover_media_credit_url: response.event.cover_media_credit_url ?? null,
    cover_media_alt: response.event.cover_media_alt ?? null,
    currency: response.event.currency,
    visibility: response.event.visibility,
    show_on_discover: false,
    status: response.event.status,
    published_at: response.event.published_at,
    timezone: response.event.timezone,
    created_at: response.event.created_at,
    updated_at: response.event.updated_at,
    management_theme: {
      ...asRecord(response.event.theme),
      business_event: businessEvent,
    },
    master_start_at: masterRow?.start_at ?? null,
    master_end_at: masterRow?.end_at ?? null,
    master_timezone: masterRow?.timezone ?? null,
    master_event_date_id: masterRow?.id ?? null,
    // ORCH-0824 hotfix: forward the new top-level columns from the
    // publish RPC response so the synthetic row matches what the
    // management view returns on subsequent fetches.
    city: response.event.city ?? null,
    party_types: response.event.party_types ?? null,
    vibe_tags: response.event.vibe_tags ?? null,
    music_genres: response.event.music_genres ?? null,
    location_geo: response.event.location_geo ?? null,
  };
  const tickets = (response.tickets ?? []).map(ticketRowToTicketStub);
  return {
    event: eventFromRow(row, tickets),
    brand: {
      id: response.brand.id,
      slug: response.brand.slug,
      displayName: response.brand.name,
    },
    tickets,
    clientRevision: response.client_revision,
  };
};

export const publishBusinessEventDraft = async (
  draft: DraftEvent,
  clientRevision: number | null = draft.clientRevision ?? null,
): Promise<PublishedBusinessEvent> => {
  const payload = draftToServerUpdate(draft, {});
  const { data, error } = await supabase.rpc("business_publish_event_draft", {
    p_event_id: draft.id,
    p_draft_payload: {
      ...payload,
      visibility: publishedVisibilityForDraft(draft.visibility),
    },
    p_client_revision: clientRevision,
  });

  if (error !== null) throw error;
  const response = data as PublishRpcResponse | null;
  if (response === null) {
    throw new Error("Publish did not return a durable event.");
  }
  if (response.event.slug.startsWith("draft-")) {
    throw new Error("Publish returned a draft placeholder slug.");
  }

  // ORCH-0808 — organizer-funnel event. Fires on every successful publish
  // (NOT every re-publish — `business_publish_event_draft` RPC only succeeds
  // on the draft→live transition; subsequent edits go through update RPCs).
  // Fire-and-forget; no-op when AppsFlyer env missing.
  logAppsFlyerEvent("mingla_event_published", {
    event_id: response.event.id,
    brand_id: response.brand.id,
  });

  return eventFromPublishResponse(response);
};

export const cancelBusinessEvent = async (
  eventId: string,
): Promise<PublishedBusinessEvent> => {
  const { data, error } = await supabase.rpc("business_cancel_event", {
    p_event_id: eventId,
  });

  if (error !== null) throw error;
  const response = data as PublishRpcResponse | null;
  if (response === null) {
    throw new Error("Cancel did not return a durable event.");
  }
  return eventFromPublishResponse(response);
};

export const endBusinessEventTicketSales = async (
  eventId: string,
): Promise<PublishedBusinessEvent> => {
  const { data, error } = await supabase.rpc(
    "business_end_event_ticket_sales",
    {
      p_event_id: eventId,
    },
  );

  if (error !== null) throw error;
  const response = data as PublishRpcResponse | null;
  if (response === null) {
    throw new Error("End ticket sales did not return a durable event.");
  }
  return eventFromPublishResponse(response);
};

// ─── ORCH-0824 hotfix (Option B) ─────────────────────────────────────────────
// Post-publish patch path for the 5 new ORCH-0824 fields (city, party_types,
// vibe_tags, music_genres, location_geo). Bridges the gap between
// mingla-business's local-only EditPublishedScreen save flow and the DB row.
// Without this, legacy events stay invisible on consumer Discover because
// brand edits never reach the events row.
//
// Calls RPC `business_patch_event_taxonomy` (migration 20260604000003).
// The RPC validates ownership, canonical slugs, and required city before
// applying the patch. Errors thrown here surface to the caller; the
// EditPublishedScreen handler displays a toast.

export interface PatchEventTaxonomyInput {
  eventId: string;
  city: string;
  partyTypes: string[];
  vibeTags: string[];
  musicGenres: string[];
  locationGeo: { lat: number; lng: number } | null;
  /**
   * ORCH-0824 hotfix-5: formatted address (e.g. from Google Places).
   * When non-null, writes to events.location_text. When null, the RPC
   * leaves location_text unchanged.
   */
  locationText: string | null;
}

interface PatchEventTaxonomyResponse {
  event: {
    id: string;
    city: string | null;
    party_types: string[] | null;
    vibe_tags: string[] | null;
    music_genres: string[] | null;
    location_geo: string | { x: number; y: number } | null;
    updated_at: string;
  };
  updated_at: string;
}

export const patchPublishedEventTaxonomy = async (
  input: PatchEventTaxonomyInput,
): Promise<PatchEventTaxonomyResponse> => {
  const { data, error } = await supabase.rpc(
    "business_patch_event_taxonomy",
    {
      p_event_id: input.eventId,
      p_city: input.city,
      p_party_types: input.partyTypes,
      p_vibe_tags: input.vibeTags,
      p_music_genres: input.musicGenres,
      p_location_lat: input.locationGeo?.lat ?? null,
      p_location_lng: input.locationGeo?.lng ?? null,
      p_location_text: input.locationText,
    },
  );

  if (error !== null) {
    // Surface the RPC's error code (e.g. 'city_required',
    // 'party_types_required', 'party_types_not_canonical',
    // 'insufficient_event_permission', 'event_not_editable_status') for
    // the UI to map to user-friendly copy.
    const code = error.message ?? "patch_event_taxonomy_failed";
    throw new Error(code);
  }
  const response = data as PatchEventTaxonomyResponse | null;
  if (response === null) {
    throw new Error("patch_event_taxonomy_empty_response");
  }
  return response;
};
