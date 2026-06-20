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
import {
  asEventCoverMediaProvider,
  type EventCoverMediaProvider,
} from "../types/eventCoverProvider";
import { normalizeCurrency } from "./currency";

export const BUSINESS_DRAFT_SCHEMA_VERSION = 1;

type JsonRecord = Record<string, unknown>;

export interface ServerDraftEventRow {
  id: string;
  brand_id: string;
  created_by: string;
  title: string;
  description: string | null;
  slug: string;
  location_text: string | null;
  online_url: string | null;
  cover_media_url: string | null;
  cover_media_type: EventCoverMediaType | null;
  cover_media_provider?: EventCoverMediaProvider | null;
  cover_media_source_url?: string | null;
  cover_media_credit?: string | null;
  cover_media_credit_url?: string | null;
  cover_media_alt?: string | null;
  currency?: string | null;
  is_online: boolean;
  is_recurring: boolean;
  is_multi_date: boolean;
  recurrence_rules: unknown;
  theme: JsonRecord | null;
  visibility: string;
  status: string;
  timezone: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  deleted_at: string | null;
  // ORCH-0824: top-level taxonomy + city columns. Optional on the row
  // type because legacy rows pre-migration may not have them populated.
  city?: string | null;
  party_types?: string[] | null;
  vibe_tags?: string[] | null;
  music_genres?: string[] | null;
  location_geo?: string | { x: number; y: number } | null;
  // ORCH-1006 — per-offering all-in pricing switches. NULL = inherit brand
  // default. Optional on the row type (legacy rows pre-migration lack them).
  pass_tax?: boolean | null;
  pass_mingla_fee?: boolean | null;
  pass_service_fee?: boolean | null;
}

export interface ServerDraftEventInsert {
  brand_id: string;
  created_by: string;
  title: string;
  slug: string;
  description: string | null;
  location_text: string | null;
  online_url: string | null;
  cover_media_url: string | null;
  cover_media_type: EventCoverMediaType | null;
  cover_media_provider: EventCoverMediaProvider | null;
  cover_media_source_url: string | null;
  cover_media_credit: string | null;
  cover_media_credit_url: string | null;
  cover_media_alt: string | null;
  currency: string;
  is_online: boolean;
  is_recurring: boolean;
  is_multi_date: boolean;
  recurrence_rules: unknown;
  theme: JsonRecord;
  visibility: "draft";
  status: "draft";
  timezone: string;
}

export interface ServerDraftEventUpdate {
  title: string;
  description: string | null;
  location_text: string | null;
  online_url: string | null;
  cover_media_url: string | null;
  cover_media_type: EventCoverMediaType | null;
  cover_media_provider: EventCoverMediaProvider | null;
  cover_media_source_url: string | null;
  cover_media_credit: string | null;
  cover_media_credit_url: string | null;
  cover_media_alt: string | null;
  currency: string;
  is_online: boolean;
  is_recurring: boolean;
  is_multi_date: boolean;
  recurrence_rules: unknown;
  theme: JsonRecord;
  visibility: "draft";
  status: "draft";
  timezone: string;
  // ORCH-0841: top-level taxonomy + city + geo columns. Post-ORCH-0824 the
  // read mapper reads from these top-level columns and explicitly does NOT
  // fall back to theme.business_draft — so autosave MUST write them here
  // every round-trip or the next reload zeroes the user's selections.
  // party_types/vibe_tags/music_genres are NOT NULL ARRAY at the DB layer;
  // always write [] for empty, never null.
  party_types: string[];
  vibe_tags: string[];
  music_genres: string[];
  city: string | null;
  location_geo: string | null;
  // ORCH-1006 — per-offering all-in pricing switches. Written every autosave
  // round-trip (like the taxonomy columns above) so the read mapper, which
  // reads top-level columns and does NOT fall back to theme, never zeroes the
  // user's pass/absorb choices. NULL = inherit the brand default (untouched).
  pass_tax: boolean | null;
  pass_mingla_fee: boolean | null;
  pass_service_fee: boolean | null;
}

export interface BusinessDraftPayload {
  schemaVersion: number;
  legacyLocalDraftId: string | null;
  format: DraftEventFormat;
  // ORCH-0824: replaces the deprecated single-select `category` field.
  // partyTypes is multi-select; required at publish (>= 1). vibeTags
  // and musicGenres are multi-select; optional. city is populated from
  // Google Places autocomplete; required at publish.
  partyTypes: string[];
  vibeTags: string[];
  musicGenres: string[];
  city: string | null;
  locationGeo: { lat: number; lng: number } | null;
  requestedVisibility: DraftEventVisibility;
  coverHue: number;
  coverProvider: {
    provider: EventCoverMediaProvider | null;
    sourceUrl: string | null;
    credit: string | null;
    creditUrl: string | null;
    alt: string | null;
  };
  currency: string;
  whenMode: WhenMode;
  when: {
    date: string | null;
    doorsOpen: string | null;
    endsAt: string | null;
    timezone: string;
  };
  recurrenceRule: RecurrenceRule | null;
  multiDates: MultiDateEntry[] | null;
  location: {
    venueName: string | null;
    address: string | null;
  };
  hideAddressUntilTicket: boolean;
  tickets: TicketStub[];
  settings: {
    requireApproval: boolean;
    allowTransfers: boolean;
    hideRemainingCount: boolean;
    passwordProtected: boolean;
    privateGuestList: boolean;
    inPersonPaymentsEnabled: boolean;
  };
  // ORCH-1150 — RSVP host-control passthrough (additive; the event publish RPC
  // never reads these — only business_publish_rsvp_draft does). See SPEC §5.1.
  isRsvp: boolean;
  rsvpCapacity: number | null;
  rsvpAllowPlusOnes: boolean;
  rsvpPlusOnesMax: number;
  rsvpWaitlistEnabled: boolean;
  rsvpApprovalMode: "auto" | "manual";
  rsvpDiscoverable: boolean;
  lastStepReached: number;
  clientRevision: number;
}

const asRecord = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const asStringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const asCoverMediaType = (value: unknown): EventCoverMediaType | null =>
  value === "image" || value === "video" || value === "gif" ? value : null;

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const asDraftFormat = (value: unknown, isOnline: boolean): DraftEventFormat => {
  if (value === "in_person" || value === "online" || value === "hybrid") {
    return value;
  }
  return isOnline ? "online" : "in_person";
};

const asVisibility = (value: unknown): DraftEventVisibility =>
  value === "unlisted" || value === "private" || value === "public"
    ? value
    : "public";

const asWhenMode = (
  value: unknown,
  row: Pick<ServerDraftEventRow, "is_recurring" | "is_multi_date">,
): WhenMode => {
  if (value === "recurring" || value === "multi_date" || value === "single") {
    return value;
  }
  if (row.is_multi_date) return "multi_date";
  if (row.is_recurring) return "recurring";
  return "single";
};

const sanitizeTicketForServer = (ticket: TicketStub): TicketStub => ({
  ...ticket,
  passwordConfigured:
    ticket.passwordConfigured === true ||
    (ticket.passwordProtected && ticket.password !== null && ticket.password.length >= 4),
  password: null,
});

const normalizeTicketFromServer = (ticket: unknown, idx: number): TicketStub => {
  const t = asRecord(ticket);
  const passwordProtected = asBoolean(t.passwordProtected, false);
  const passwordConfigured = asBoolean(t.passwordConfigured, passwordProtected);
  return {
    id:
      typeof t.id === "string" && t.id.length > 0
        ? t.id
        : `ticket_${idx.toString(36)}`,
    name: typeof t.name === "string" ? t.name : "",
    priceGbp:
      typeof t.priceGbp === "number" && Number.isFinite(t.priceGbp)
        ? t.priceGbp
        : typeof t.price === "number" && Number.isFinite(t.price)
          ? t.price
          : typeof t.priceMajor === "number" && Number.isFinite(t.priceMajor)
            ? t.priceMajor
            : null,
    currency: asStringOrNull(t.currency) ?? undefined,
    capacity:
      typeof t.capacity === "number" && Number.isFinite(t.capacity)
        ? t.capacity
        : null,
    isFree: asBoolean(t.isFree, false),
    isUnlimited: asBoolean(t.isUnlimited, false),
    visibility:
      t.visibility === "hidden" || t.visibility === "disabled" ? t.visibility : "public",
    displayOrder: asNumber(t.displayOrder, idx),
    approvalRequired: asBoolean(t.approvalRequired, false),
    passwordProtected,
    password: null,
    passwordConfigured,
    waitlistEnabled: asBoolean(t.waitlistEnabled, false),
    minPurchaseQty: asNumber(t.minPurchaseQty, 1),
    maxPurchaseQty:
      typeof t.maxPurchaseQty === "number" && Number.isFinite(t.maxPurchaseQty)
        ? t.maxPurchaseQty
        : null,
    allowTransfers: asBoolean(t.allowTransfers, true),
    description: asStringOrNull(t.description),
    saleStartAt: asStringOrNull(t.saleStartAt),
    saleEndAt: asStringOrNull(t.saleEndAt),
    availableAt:
      t.availableAt === "online" || t.availableAt === "door" ? t.availableAt : "both",
  };
};

const ticketsFromPayload = (value: unknown): TicketStub[] =>
  Array.isArray(value) ? value.map(normalizeTicketFromServer) : [];

const buildBusinessDraftPayload = (
  draft: DraftEvent,
  legacyLocalDraftId: string | null,
  clientRevision: number = draft.clientRevision ?? 0,
): BusinessDraftPayload => ({
  schemaVersion: BUSINESS_DRAFT_SCHEMA_VERSION,
  legacyLocalDraftId,
  format: draft.format,
  // ORCH-0824: send the three taxonomy arrays + city + locationGeo so the
  // publish RPC can promote them to top-level events columns.
  partyTypes: draft.partyTypes,
  vibeTags: draft.vibeTags,
  musicGenres: draft.musicGenres,
  city: draft.city,
  locationGeo: draft.locationGeo,
  requestedVisibility: draft.visibility,
  coverHue: draft.coverHue,
  coverProvider: {
    provider: draft.coverMediaProvider ?? null,
    sourceUrl: draft.coverMediaSourceUrl ?? null,
    credit: draft.coverMediaCredit ?? null,
    creditUrl: draft.coverMediaCreditUrl ?? null,
    alt: draft.coverMediaAlt ?? null,
  },
  currency: normalizeCurrency(draft.currency),
  whenMode: draft.whenMode,
  when: {
    date: draft.date,
    doorsOpen: draft.doorsOpen,
    endsAt: draft.endsAt,
    timezone: draft.timezone,
  },
  recurrenceRule: draft.recurrenceRule,
  multiDates: draft.multiDates,
  location: {
    venueName: draft.venueName,
    address: draft.address,
  },
  hideAddressUntilTicket: draft.hideAddressUntilTicket,
  tickets: draft.tickets.map(sanitizeTicketForServer),
  settings: {
    requireApproval: draft.requireApproval,
    allowTransfers: draft.allowTransfers,
    hideRemainingCount: draft.hideRemainingCount,
    passwordProtected: draft.passwordProtected,
    privateGuestList: draft.privateGuestList,
    inPersonPaymentsEnabled: draft.inPersonPaymentsEnabled,
  },
  // ORCH-1150 — RSVP host-control passthrough.
  isRsvp: draft.isRsvp,
  rsvpCapacity: draft.rsvpCapacity,
  rsvpAllowPlusOnes: draft.rsvpAllowPlusOnes,
  rsvpPlusOnesMax: draft.rsvpPlusOnesMax,
  rsvpWaitlistEnabled: draft.rsvpWaitlistEnabled,
  rsvpApprovalMode: draft.rsvpApprovalMode,
  rsvpDiscoverable: draft.rsvpDiscoverable,
  lastStepReached: draft.lastStepReached,
  clientRevision,
});

export const mergeBusinessDraftTheme = (
  existingTheme: unknown,
  draft: DraftEvent,
  legacyLocalDraftId: string | null = null,
): JsonRecord => {
  const theme = asRecord(existingTheme);
  return {
    ...theme,
    coverHue: draft.coverHue,
    business_draft: buildBusinessDraftPayload(
      draft,
      legacyLocalDraftId ??
        asStringOrNull(asRecord(theme.business_draft).legacyLocalDraftId),
      draft.clientRevision ?? asNumber(asRecord(theme.business_draft).clientRevision, 0),
    ),
  };
};

const locationTextForDraft = (draft: DraftEvent): string | null => {
  const parts = [draft.venueName, draft.address].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(" · ") : null;
};

/**
 * ORCH-1172 — the `biz_update_live_rsvp` p_payload shape.
 *
 * The RPC reads `title` (REQUIRED — raises rsvp_title_required when blank),
 * `requestedVisibility` (public|unlisted|private), the snake_case location /
 * cover keys, a single-date `when{}` block, and the 6 camelCase rsvp host-
 * control keys (defaulting absent keys to the existing column). This is the
 * SAME publish-style shape `business_publish_rsvp_draft` consumes — the create
 * publish path sends `title` + `requestedVisibility` + snake_case via
 * draftToServerUpdate (see publishRsvpDraft). Keeping one builder here makes
 * create + edit share a single source of truth for the payload contract.
 */
export interface RsvpUpdatePayload {
  title: string;
  description: string | null;
  location_text: string | null;
  online_url: string | null;
  cover_media_url: string | null;
  cover_media_type: EventCoverMediaType | null;
  requestedVisibility: DraftEventVisibility;
  timezone: string;
  when: {
    date: string | null;
    doorsOpen: string | null;
    endsAt: string | null;
  };
  rsvpCapacity: number | null;
  rsvpAllowPlusOnes: boolean;
  rsvpPlusOnesMax: number;
  rsvpWaitlistEnabled: boolean;
  rsvpApprovalMode: "auto" | "manual";
  rsvpDiscoverable: boolean;
  // ORCH-1172 — privacy toggles persisted into theme.business_event.settings
  // by biz_update_live_rsvp (migration 20261113000000). These are NOT DB
  // columns; without them in the payload the edit silently drops the toggles.
  privateGuestList: boolean;
  hideRemainingCount: boolean;
  // ORCH-1172 R2 — hide-address-until-RSVP'd-going. Like the two toggles above
  // this is NOT a DB column: the publish path stores it at
  // theme.business_event.hideAddressUntilTicket (a DIRECT child of
  // business_event, NOT under settings) and pg_public_rsvp_by_slug reads it
  // from there. Without it in the payload the edit silently drops it and the
  // address keeps showing publicly. biz_update_live_rsvp (migration
  // 20261114000000) deep-merges it back into that leaf.
  hideAddressUntilTicket: boolean;
}

/**
 * ORCH-1172 — build the publish-style RSVP edit payload from the FULL edit
 * state (not a sparse patch). The RPC requires `title` unconditionally and
 * defaults absent keys to the existing column, so emitting the full current
 * values is safe + idempotent. Fixes BUG-A (title always present → no more
 * rsvp_title_required) and BUG-B (the 6 rsvp* host-controls + when always
 * present, correctly snake-cased location/cover + requestedVisibility).
 */
export const buildRsvpUpdatePayload = (
  draft: DraftEvent,
): RsvpUpdatePayload => ({
  title: draft.name.trim(),
  description: draft.description.trim().length > 0 ? draft.description : null,
  location_text: locationTextForDraft(draft),
  online_url: draft.onlineUrl,
  cover_media_url: draft.coverMediaUrl,
  cover_media_type: draft.coverMediaUrl === null ? null : draft.coverMediaType,
  requestedVisibility: draft.visibility,
  timezone: draft.timezone,
  when: {
    date: draft.date,
    doorsOpen: draft.doorsOpen,
    endsAt: draft.endsAt,
  },
  rsvpCapacity: draft.rsvpCapacity,
  rsvpAllowPlusOnes: draft.rsvpAllowPlusOnes,
  rsvpPlusOnesMax: draft.rsvpPlusOnesMax,
  rsvpWaitlistEnabled: draft.rsvpWaitlistEnabled,
  rsvpApprovalMode: draft.rsvpApprovalMode,
  rsvpDiscoverable: draft.rsvpDiscoverable,
  privateGuestList: draft.privateGuestList,
  hideRemainingCount: draft.hideRemainingCount,
  hideAddressUntilTicket: draft.hideAddressUntilTicket,
});

const recurrenceRulesForDraft = (draft: DraftEvent): unknown =>
  draft.recurrenceRule === null ? null : draft.recurrenceRule;

export const draftToServerInsert = (
  draft: DraftEvent,
  userId: string,
  slug: string,
  existingTheme: unknown = {},
  legacyLocalDraftId: string | null = null,
): ServerDraftEventInsert => ({
  brand_id: draft.brandId,
  created_by: userId,
  title: draft.name.trim().length > 0 ? draft.name.trim() : "Untitled draft",
  slug,
  description: draft.description.trim().length > 0 ? draft.description : null,
  location_text: locationTextForDraft(draft),
  online_url: draft.onlineUrl,
  cover_media_url: draft.coverMediaUrl,
  cover_media_type:
    draft.coverMediaUrl === null ? null : draft.coverMediaType,
  cover_media_provider:
    draft.coverMediaUrl === null ? null : draft.coverMediaProvider ?? null,
  cover_media_source_url:
    draft.coverMediaUrl === null ? null : draft.coverMediaSourceUrl ?? null,
  cover_media_credit:
    draft.coverMediaUrl === null ? null : draft.coverMediaCredit ?? null,
  cover_media_credit_url:
    draft.coverMediaUrl === null ? null : draft.coverMediaCreditUrl ?? null,
  cover_media_alt:
    draft.coverMediaUrl === null ? null : draft.coverMediaAlt ?? null,
  currency: normalizeCurrency(draft.currency),
  is_online: draft.format === "online" || draft.format === "hybrid",
  is_recurring: draft.whenMode === "recurring",
  is_multi_date: draft.whenMode === "multi_date",
  recurrence_rules: recurrenceRulesForDraft(draft),
  theme: mergeBusinessDraftTheme(existingTheme, draft, legacyLocalDraftId),
  visibility: "draft",
  status: "draft",
  timezone: draft.timezone,
});

export const draftToServerUpdate = (
  draft: DraftEvent,
  existingTheme: unknown,
  clientRevision: number = draft.clientRevision ?? 0,
): ServerDraftEventUpdate => ({
  title: draft.name.trim().length > 0 ? draft.name.trim() : "Untitled draft",
  description: draft.description.trim().length > 0 ? draft.description : null,
  location_text: locationTextForDraft(draft),
  online_url: draft.onlineUrl,
  cover_media_url: draft.coverMediaUrl,
  cover_media_type:
    draft.coverMediaUrl === null ? null : draft.coverMediaType,
  cover_media_provider:
    draft.coverMediaUrl === null ? null : draft.coverMediaProvider ?? null,
  cover_media_source_url:
    draft.coverMediaUrl === null ? null : draft.coverMediaSourceUrl ?? null,
  cover_media_credit:
    draft.coverMediaUrl === null ? null : draft.coverMediaCredit ?? null,
  cover_media_credit_url:
    draft.coverMediaUrl === null ? null : draft.coverMediaCreditUrl ?? null,
  cover_media_alt:
    draft.coverMediaUrl === null ? null : draft.coverMediaAlt ?? null,
  currency: normalizeCurrency(draft.currency),
  is_online: draft.format === "online" || draft.format === "hybrid",
  is_recurring: draft.whenMode === "recurring",
  is_multi_date: draft.whenMode === "multi_date",
  recurrence_rules: recurrenceRulesForDraft(draft),
  theme: mergeBusinessDraftTheme(existingTheme, {
    ...draft,
    clientRevision,
  }),
  visibility: "draft",
  status: "draft",
  timezone: draft.timezone,
  // ORCH-0841: write taxonomy + city + geo to top-level columns so the
  // post-ORCH-0824 read mapper sees them on the autosave response. Without
  // these, every 700ms autosave round-trip overwrites the local draft with
  // empty arrays / null and the user's pill selections silently deselect.
  party_types: Array.isArray(draft.partyTypes) ? draft.partyTypes : [],
  vibe_tags: Array.isArray(draft.vibeTags) ? draft.vibeTags : [],
  music_genres: Array.isArray(draft.musicGenres) ? draft.musicGenres : [],
  city: draft.city,
  location_geo:
    draft.locationGeo === null
      ? null
      : `(${draft.locationGeo.lng},${draft.locationGeo.lat})`,
  // ORCH-1006 — per-offering pricing switches. NULL = inherit brand default.
  // Draft rows are status=draft (unsold → never locked) so a direct column
  // write is safe; the post-sale lock guard only matters on live edits.
  pass_tax: draft.pricingSwitches?.passTax ?? null,
  pass_mingla_fee: draft.pricingSwitches?.passMinglaFee ?? null,
  pass_service_fee: draft.pricingSwitches?.passServiceFee ?? null,
});

export const publishedVisibilityForDraft = (
  visibility: DraftEventVisibility,
): "public" | "hidden" | "private" => {
  if (visibility === "unlisted") return "hidden";
  return visibility;
};

export const serverRowToDraft = (row: ServerDraftEventRow): DraftEvent => {
  const theme = asRecord(row.theme);
  const businessDraft = asRecord(theme.business_draft);
  const when = asRecord(businessDraft.when);
  const location = asRecord(businessDraft.location);
  const settings = asRecord(businessDraft.settings);
  const format = asDraftFormat(businessDraft.format, row.is_online);
  const whenMode = asWhenMode(businessDraft.whenMode, row);

  const legacyLocalDraftId = asStringOrNull(businessDraft.legacyLocalDraftId);
  return {
    id: row.id,
    brandId: row.brand_id,
    serverSlug: row.slug,
    name: row.title === "Untitled draft" ? "" : row.title,
    description: row.description ?? "",
    format,
    // ORCH-0824: read taxonomy from TOP-LEVEL row columns (canonical post
    // ORCH-0824 migration). Legacy rows without these columns fall back
    // to empty arrays — the wizard validator will force re-selection on
    // republish. Do NOT read businessDraft.partyTypes/etc. — those are
    // ephemeral payload mirrors that the publish RPC strips. See
    // feedback_verify_db_column_names_before_writing_queries.md.
    partyTypes: Array.isArray(row.party_types)
      ? row.party_types.filter((s): s is string => typeof s === "string")
      : [],
    vibeTags: Array.isArray(row.vibe_tags)
      ? row.vibe_tags.filter((s): s is string => typeof s === "string")
      : [],
    musicGenres: Array.isArray(row.music_genres)
      ? row.music_genres.filter((s): s is string => typeof s === "string")
      : [],
    whenMode,
    date: asStringOrNull(when.date),
    doorsOpen: asStringOrNull(when.doorsOpen),
    endsAt: asStringOrNull(when.endsAt),
    // ORCH-0877 — recomputed by the consuming layer when needed; on initial
    // server-row → draft conversion we leave this null because the master
    // event_dates row carries the real end_at (caller can pass through the
    // server projection if available).
    endsAtUtc: null,
    timezone:
      asStringOrNull(when.timezone) ?? row.timezone ?? "Europe/London",
    recurrenceRule:
      businessDraft.recurrenceRule === null ||
      businessDraft.recurrenceRule === undefined
        ? null
        : (businessDraft.recurrenceRule as RecurrenceRule),
    multiDates: Array.isArray(businessDraft.multiDates)
      ? (businessDraft.multiDates as MultiDateEntry[])
      : null,
    venueName: asStringOrNull(location.venueName),
    address: asStringOrNull(location.address),
    // ORCH-0824: city from top-level column. locationGeo is parsed from
    // the Postgres `point` representation (string "(lng,lat)" OR object
    // {x,y}). Empty point → null.
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
    onlineUrl: row.online_url,
    hideAddressUntilTicket: asBoolean(
      businessDraft.hideAddressUntilTicket,
      true,
    ),
    coverHue: asNumber(businessDraft.coverHue ?? theme.coverHue, 25),
    coverMediaUrl: row.cover_media_url,
    coverMediaType:
      row.cover_media_url === null ? null : asCoverMediaType(row.cover_media_type),
    coverMediaProvider:
      row.cover_media_url === null
        ? null
        : asEventCoverMediaProvider(
            row.cover_media_provider ??
              asRecord(businessDraft.coverProvider).provider,
          ),
    coverMediaSourceUrl:
      row.cover_media_url === null
        ? null
        : asStringOrNull(
            row.cover_media_source_url ??
              asRecord(businessDraft.coverProvider).sourceUrl,
          ),
    coverMediaCredit:
      row.cover_media_url === null
        ? null
        : asStringOrNull(
            row.cover_media_credit ?? asRecord(businessDraft.coverProvider).credit,
          ),
    coverMediaCreditUrl:
      row.cover_media_url === null
        ? null
        : asStringOrNull(
            row.cover_media_credit_url ??
              asRecord(businessDraft.coverProvider).creditUrl,
          ),
    coverMediaAlt:
      row.cover_media_url === null
        ? null
        : asStringOrNull(
            row.cover_media_alt ?? asRecord(businessDraft.coverProvider).alt,
          ),
    currency:
      asStringOrNull(businessDraft.currency) ?? asStringOrNull(row.currency) ?? null,
    // ORCH-1006 — read pricing switches from top-level columns. null = inherit.
    pricingSwitches: {
      passTax: row.pass_tax ?? null,
      passMinglaFee: row.pass_mingla_fee ?? null,
      passServiceFee: row.pass_service_fee ?? null,
    },
    tickets: ticketsFromPayload(businessDraft.tickets),
    visibility: asVisibility(businessDraft.requestedVisibility),
    requireApproval: asBoolean(settings.requireApproval, false),
    allowTransfers: asBoolean(settings.allowTransfers, true),
    hideRemainingCount: asBoolean(settings.hideRemainingCount, false),
    passwordProtected: asBoolean(settings.passwordProtected, false),
    privateGuestList: asBoolean(settings.privateGuestList, false),
    inPersonPaymentsEnabled: asBoolean(settings.inPersonPaymentsEnabled, false),
    // ORCH-1150 — RSVP host-control round-trip from business_draft. Defaults
    // keep ticketed drafts byte-identical (isRsvp:false). See SPEC §4.6.
    isRsvp: asBoolean(businessDraft.isRsvp, false),
    rsvpCapacity:
      typeof businessDraft.rsvpCapacity === "number" &&
      Number.isFinite(businessDraft.rsvpCapacity)
        ? businessDraft.rsvpCapacity
        : null,
    rsvpAllowPlusOnes: asBoolean(businessDraft.rsvpAllowPlusOnes, false),
    rsvpPlusOnesMax: asNumber(businessDraft.rsvpPlusOnesMax, 0),
    rsvpWaitlistEnabled: asBoolean(businessDraft.rsvpWaitlistEnabled, false),
    rsvpApprovalMode:
      businessDraft.rsvpApprovalMode === "manual" ? "manual" : "auto",
    rsvpDiscoverable: asBoolean(businessDraft.rsvpDiscoverable, false),
    lastStepReached: asNumber(businessDraft.lastStepReached, 0),
    status: "draft",
    clientRevision: asNumber(businessDraft.clientRevision, 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(legacyLocalDraftId !== null ? { legacyLocalDraftId } : {}),
  } as DraftEvent;
};
