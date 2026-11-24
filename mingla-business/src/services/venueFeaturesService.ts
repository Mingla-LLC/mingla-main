/**
 * #4490 — venue features, spaces, special days and the event/venue link.
 *
 * Every write goes through a #4490 RPC (never a table write): the server
 * checks authority, dependencies and versions. Errors are mapped to plain
 * host copy by `venueFeatureErrorCopy`; a raw code never reaches the screen.
 */

import { randomId } from "../utils/randomId";
import type { OtherVenueLayout } from "@mingla/brand-rendering/venueOffers/layoutModel";
import {
  SWITCHABLE_FEATURES,
  VENUE_FEATURE_KEYS,
  featureSetFrom,
  type VenueFeature,
  type VenueFeatureKey,
  type VenueFeatureState,
  type VenueTypeKey,
} from "../types/venueFeatures";

// The Supabase client loads on first use, not at module scope: screens that
// only import a type or a copy helper from here (the event wizard, the venue
// shells) must not create the client just by being imported (#4490; same
// load-on-use rule as brandFormsService / publicEnquiryService).
const getSupabase = async (): Promise<typeof import("./supabase").supabase> =>
  (await import("./supabase")).supabase;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** A server refusal with its code kept for mapping (never shown raw). */
export class VenueFeatureError extends Error {
  readonly code: string;
  readonly detail: string | null;
  constructor(code: string, detail: string | null = null) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

function toVenueFeatureError(error: unknown): VenueFeatureError {
  if (error instanceof VenueFeatureError) return error;
  const raw =
    error !== null && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message ?? "")
      : String(error ?? "");
  const [code, detail] = raw.split(":", 2);
  return new VenueFeatureError((code ?? "").trim() || "unknown", detail?.trim() ?? null);
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

interface FeatureRowJson {
  key?: unknown;
  enabled?: unknown;
  space_ids?: unknown;
  settings?: unknown;
  version?: unknown;
  blocked_by?: unknown;
  needs?: unknown;
}

function isFeatureKey(value: unknown): value is VenueFeatureKey {
  return typeof value === "string" && (VENUE_FEATURE_KEYS as readonly string[]).includes(value);
}

/** Map `issue_4490_get_venue_features` JSON to the client shape. */
export function mapVenueFeatureState(json: unknown): VenueFeatureState {
  const row = (json !== null && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const rows: Partial<VenueFeature>[] = [];
  if (Array.isArray(row.features)) {
    for (const item of row.features as FeatureRowJson[]) {
      if (!isFeatureKey(item.key)) continue;
      rows.push({
        key: item.key,
        enabled: item.enabled === true,
        spaceIds: Array.isArray(item.space_ids)
          ? item.space_ids.filter((id): id is string => typeof id === "string")
          : null,
        settings:
          item.settings !== null && typeof item.settings === "object"
            ? (item.settings as Record<string, unknown>)
            : {},
        version: typeof item.version === "number" ? item.version : 0,
        blockedBy: Array.isArray(item.blocked_by)
          ? item.blocked_by.filter((b): b is string => typeof b === "string")
          : [],
        needs: Array.isArray(item.needs)
          ? item.needs.filter((b): b is string => typeof b === "string")
          : [],
      });
    }
  }
  const flags = (row.flags ?? {}) as Record<string, unknown>;
  return {
    venueId: String(row.venue_id ?? ""),
    brandId: String(row.brand_id ?? ""),
    venueCategory: typeof row.venue_category === "string" ? row.venue_category : null,
    version: typeof row.version === "number" ? row.version : 0,
    activeSpaceCount: typeof row.active_space_count === "number" ? row.active_space_count : 0,
    features: featureSetFrom(rows),
    flags: { reads: flags.reads === true, writes: flags.writes === true },
  };
}

export async function fetchVenueFeatures(venueId: string): Promise<VenueFeatureState> {
  const { data, error } = await (await getSupabase()).rpc("issue_4490_get_venue_features", {
    p_venue_id: venueId,
  });
  if (error !== null) throw toVenueFeatureError(error);
  return mapVenueFeatureState(data);
}

export interface SetVenueFeatureInput {
  venueId: string;
  key: VenueFeatureKey;
  enabled: boolean;
  cascade: boolean;
  expectedVersion?: number | null;
  spaceIds?: string[] | null;
  /** #4490 P5 — the feature's whole settings object (null/undefined = keep). */
  settings?: Record<string, unknown> | null;
}

export interface SetVenueFeatureResult {
  changedKeys: VenueFeatureKey[];
  state: VenueFeatureState;
}

export async function setVenueFeature(input: SetVenueFeatureInput): Promise<SetVenueFeatureResult> {
  const { data, error } = await (await getSupabase()).rpc("issue_4490_set_venue_feature", {
    p_venue_id: input.venueId,
    p_key: input.key,
    p_enabled: input.enabled,
    p_space_ids: input.spaceIds ?? null,
    p_settings: input.settings ?? null,
    p_expected_version: input.expectedVersion ?? null,
    p_idempotency_key: `feature-${randomId()}`,
    p_cascade: input.cascade,
  });
  if (error !== null) throw toVenueFeatureError(error);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    changedKeys: Array.isArray(row.changed_keys) ? row.changed_keys.filter(isFeatureKey) : [],
    state: mapVenueFeatureState(row.features),
  };
}

export interface ApplyPresetResult {
  applied: VenueFeatureKey[];
  skipped: Array<{ key: VenueFeatureKey; reason: string }>;
  state: VenueFeatureState;
}

export async function applyFeaturePreset(
  venueId: string,
  category: VenueTypeKey,
): Promise<ApplyPresetResult> {
  const { data, error } = await (await getSupabase()).rpc("issue_4490_apply_feature_preset", {
    p_venue_id: venueId,
    p_category: category,
    p_idempotency_key: `preset-${randomId()}`,
  });
  if (error !== null) throw toVenueFeatureError(error);
  const row = (data ?? {}) as Record<string, unknown>;
  const skipped: ApplyPresetResult["skipped"] = [];
  if (Array.isArray(row.skipped)) {
    for (const item of row.skipped as Array<Record<string, unknown>>) {
      if (isFeatureKey(item.key)) skipped.push({ key: item.key, reason: String(item.reason ?? "") });
    }
  }
  return {
    applied: Array.isArray(row.applied) ? row.applied.filter(isFeatureKey) : [],
    skipped,
    state: mapVenueFeatureState(row.features),
  };
}

/**
 * #4490 click-test D9 — make a new venue's switches match the add-venue
 * Features step: switch on what the host kept on, and switch off what reads
 * as on only through the backfill rule (Menu for a non-stay venue) when the
 * host turned it off. Table ordering is never written here (it waits for
 * approval). Returns the final state, or null when nothing could be read.
 */
export interface StartingFeaturesRefusal {
  key: VenueFeatureKey;
  /** The server's code ("feature_requires", …) and detail ("space", parent keys). */
  code: string;
  detail: string | null;
}

export interface StartingFeaturesReport {
  state: VenueFeatureState;
  /** Chosen switches the server did not turn on, with why. */
  refused: StartingFeaturesRefusal[];
}

/**
 * #4490 N20: one refusal must not drop the rest. The loop used to throw on
 * the first refusal (Private hire needs a space, and a new venue has none),
 * which silently skipped every switch after it (Floor plan, Pick a table) and
 * the caller swallowed the error. Now each switch is tried on its own, the
 * refusals are collected and handed back so the success screen can say what
 * still needs setting up, with a button to the right place.
 */
export async function applyStartingFeaturesReport(
  venueId: string,
  chosen: readonly VenueFeatureKey[],
): Promise<StartingFeaturesReport> {
  // #4490 fix1 (backend B2): one server call applies every chosen feature
  // (parents first), and says what it skipped and what still needs setup.
  // A space-needing feature is now stored on before the first space exists.
  const { data, error } = await (await getSupabase()).rpc("issue_4490_apply_starting_features", {
    p_venue_id: venueId,
    p_features: [...chosen],
    p_idempotency_key: `start-${randomId()}`,
  });
  if (error !== null) {
    const e = toVenueFeatureError(error);
    // A venue that already sells keeps its switches (Settings changes them).
    if (e.code !== "venue_already_selling") throw e;
    return { state: await fetchVenueFeatures(venueId), refused: [] };
  }
  const row = (data ?? {}) as Record<string, unknown>;
  const refused: StartingFeaturesRefusal[] = [];
  if (Array.isArray(row.skipped)) {
    for (const item of row.skipped as Array<Record<string, unknown>>) {
      if (!isFeatureKey(item.key)) continue;
      const reason = String(item.reason ?? "");
      refused.push(
        reason.startsWith("requires:")
          ? { key: item.key, code: "feature_requires", detail: reason.slice("requires:".length) }
          : { key: item.key, code: reason, detail: null },
      );
    }
  }
  return { state: mapVenueFeatureState(row.features), refused };
}

export async function applyStartingFeatures(
  venueId: string,
  chosen: readonly VenueFeatureKey[],
): Promise<VenueFeatureState | null> {
  return (await applyStartingFeaturesReport(venueId, chosen)).state;
}

// ---------------------------------------------------------------------------
// Spaces
// ---------------------------------------------------------------------------

export type SpaceSetting = "indoor" | "covered" | "outdoor";

/** Normalised rectangle on the site plan, in percent of the plan (0..100). */
export interface SpacePlanShape {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VenueSpace {
  id: string;
  venueId: string;
  name: string;
  setting: SpaceSetting;
  capacityStanding: number | null;
  capacitySeated: number | null;
  layouts: Array<{ layout: OtherVenueLayout; capacity: number }>;
  photos: string[];
  planShape: SpacePlanShape | null;
  /** #4490 P5 — the floor plan's room (`plan_shape.room`), kept when the site plan saves. */
  planRoom?: unknown;
  sortOrder: number;
  canBeHired: boolean;
  stepFree: boolean | null;
  amenities: string[];
  version: number;
}

export interface VenueSpaceCombination {
  id: string;
  venueId: string;
  name: string;
  spaceIds: string[];
  version: number;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapPlanShape(value: unknown): SpacePlanShape | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const x = numOrNull(v.x);
  const y = numOrNull(v.y);
  const w = numOrNull(v.w);
  const h = numOrNull(v.h);
  if (x === null || y === null || w === null || h === null) return null;
  // #4490 P5 — a zero-size box only carries the floor plan's room: not on the site plan.
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function photoUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) =>
      typeof item === "string"
        ? item
        : item !== null && typeof item === "object" && typeof (item as { url?: unknown }).url === "string"
          ? String((item as { url: string }).url)
          : null,
    )
    .filter((url): url is string => url !== null && url.length > 0);
}

export function mapVenueSpace(json: unknown): VenueSpace {
  const r = (json ?? {}) as Record<string, unknown>;
  const setting = r.setting === "covered" || r.setting === "outdoor" ? r.setting : "indoor";
  return {
    id: String(r.id ?? ""),
    venueId: String(r.venue_id ?? ""),
    name: String(r.name ?? ""),
    setting,
    capacityStanding: numOrNull(r.capacity_standing),
    capacitySeated: numOrNull(r.capacity_seated),
    layouts: Array.isArray(r.layouts)
      ? r.layouts.flatMap((value) => {
          if (value === null || typeof value !== "object") return [];
          const row = value as Record<string, unknown>;
          const layout = row.layout;
          const capacity = numOrNull(row.capacity);
          return (layout === "banquet" || layout === "theatre" || layout === "classroom" || layout === "cabaret" || layout === "boardroom") && capacity !== null
            ? [{ layout, capacity }]
            : [];
        })
      : [],
    photos: photoUrls(r.photos),
    planShape: mapPlanShape(r.plan_shape),
    planRoom:
      r.plan_shape !== null && typeof r.plan_shape === "object"
        ? ((r.plan_shape as Record<string, unknown>).room ?? null)
        : null,
    sortOrder: typeof r.sort_order === "number" ? r.sort_order : 0,
    canBeHired: r.can_be_hired !== false,
    stepFree: typeof r.step_free === "boolean" ? r.step_free : null,
    amenities: Array.isArray(r.amenities)
      ? r.amenities.filter((a): a is string => typeof a === "string")
      : [],
    version: typeof r.version === "number" ? r.version : 1,
  };
}

export async function fetchVenueSpaces(venueId: string): Promise<VenueSpace[]> {
  const { data, error } = await (await getSupabase())
    .from("venue_spaces")
    .select(
      "id, venue_id, name, setting, capacity_standing, capacity_seated, photos, plan_shape, sort_order, can_be_hired, step_free, amenities, version",
    )
    .eq("venue_id", venueId)
    .is("archived_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error !== null) throw toVenueFeatureError(error);
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const { data: layoutRows, error: layoutError } = await (await getSupabase())
    .from("venue_space_layouts")
    .select("space_id, layout, capacity")
    .in("space_id", rows.map((row: { id: string }) => row.id));
  if (layoutError !== null) throw toVenueFeatureError(layoutError);
  return rows.map((row: Record<string, unknown>) =>
    mapVenueSpace({
      ...row,
      layouts: (layoutRows ?? []).filter((layout: { space_id: string }) => layout.space_id === row.id),
    }),
  );
}

export async function fetchVenueSpaceCombinations(venueId: string): Promise<VenueSpaceCombination[]> {
  const { data, error } = await (await getSupabase())
    .from("venue_space_combinations")
    .select("id, venue_id, name, space_ids, version")
    .eq("venue_id", venueId)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error !== null) throw toVenueFeatureError(error);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id ?? ""),
    venueId: String(row.venue_id ?? ""),
    name: String(row.name ?? ""),
    spaceIds: Array.isArray(row.space_ids)
      ? row.space_ids.filter((id): id is string => typeof id === "string")
      : [],
    version: typeof row.version === "number" ? row.version : 1,
  }));
}

export interface SpaceDraft {
  name: string;
  setting: SpaceSetting;
  capacityStanding: number | null;
  capacitySeated: number | null;
  layouts: Array<{ layout: OtherVenueLayout; capacity: number }>;
  photos: string[];
  canBeHired: boolean;
  stepFree: boolean | null;
  amenities: string[];
}

export function spaceDraftToPayload(draft: SpaceDraft): Record<string, unknown> {
  return {
    name: draft.name.trim(),
    setting: draft.setting,
    capacity_standing: draft.capacityStanding,
    capacity_seated: draft.capacitySeated,
    layouts: draft.layouts.map(({ layout, capacity }) => ({ layout, capacity })),
    photos: draft.photos,
    can_be_hired: draft.canBeHired,
    step_free: draft.stepFree,
    amenities: draft.amenities.map((a) => a.trim()).filter((a) => a.length > 0),
  };
}

async function manageSpaceRpc(
  action: "create" | "update" | "archive" | "reorder",
  venueId: string,
  payload: Record<string, unknown>,
  expectedVersion: number | null,
): Promise<unknown> {
  const { data, error } = await (await getSupabase()).rpc("issue_4490_manage_space", {
    p_action: action,
    p_venue_id: venueId,
    p_payload: payload,
    p_expected_version: expectedVersion,
  });
  if (error !== null) throw toVenueFeatureError(error);
  return data;
}

export async function createVenueSpace(venueId: string, draft: SpaceDraft): Promise<VenueSpace> {
  return mapVenueSpace(await manageSpaceRpc("create", venueId, spaceDraftToPayload(draft), null));
}

export async function updateVenueSpace(
  venueId: string,
  spaceId: string,
  patch: Record<string, unknown>,
  expectedVersion: number | null,
): Promise<VenueSpace> {
  return mapVenueSpace(
    await manageSpaceRpc("update", venueId, { ...patch, id: spaceId }, expectedVersion),
  );
}

export async function archiveVenueSpace(
  venueId: string,
  spaceId: string,
  expectedVersion: number | null,
): Promise<void> {
  await manageSpaceRpc("archive", venueId, { id: spaceId }, expectedVersion);
}

export async function reorderVenueSpaces(venueId: string, ids: string[]): Promise<void> {
  await manageSpaceRpc("reorder", venueId, { ids }, null);
}

export async function manageSpaceCombination(
  action: "create" | "update" | "archive",
  venueId: string,
  payload: { id?: string; name?: string; spaceIds?: string[] },
  expectedVersion: number | null,
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (payload.id !== undefined) body.id = payload.id;
  if (payload.name !== undefined) body.name = payload.name.trim();
  if (payload.spaceIds !== undefined) body.space_ids = payload.spaceIds;
  const { error } = await (await getSupabase()).rpc("issue_4490_manage_space_combination", {
    p_action: action,
    p_venue_id: venueId,
    p_payload: body,
    p_expected_version: expectedVersion,
  });
  if (error !== null) throw toVenueFeatureError(error);
}

// ---------------------------------------------------------------------------
// Special days
// ---------------------------------------------------------------------------

export interface HoursWindow {
  open: string;
  close: string;
}

export interface VenueSpecialDay {
  id: string;
  localDate: string;
  label: string | null;
  isClosed: boolean;
  windows: HoursWindow[];
  version: number;
}

export async function fetchVenueSpecialDays(
  venueId: string,
  fromDate: string,
): Promise<VenueSpecialDay[]> {
  const { data, error } = await (await getSupabase())
    .from("venue_special_hours")
    .select("id, local_date, label, is_closed, windows, version")
    .eq("venue_id", venueId)
    .gte("local_date", fromDate)
    .order("local_date", { ascending: true });
  if (error !== null) throw toVenueFeatureError(error);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id ?? ""),
    localDate: String(row.local_date ?? ""),
    label: typeof row.label === "string" ? row.label : null,
    isClosed: row.is_closed === true,
    windows: Array.isArray(row.windows)
      ? (row.windows as Array<Record<string, unknown>>)
          .filter((w) => typeof w.open === "string" && typeof w.close === "string")
          .map((w) => ({ open: String(w.open), close: String(w.close) }))
      : [],
    version: typeof row.version === "number" ? row.version : 1,
  }));
}

export async function setVenueSpecialDay(input: {
  venueId: string;
  localDate: string;
  isClosed: boolean;
  windows: HoursWindow[];
  label: string | null;
}): Promise<void> {
  const { error } = await (await getSupabase()).rpc("issue_4490_set_special_hours", {
    p_venue_id: input.venueId,
    p_local_date: input.localDate,
    p_is_closed: input.isClosed,
    p_windows: input.isClosed ? [] : input.windows,
    p_label: input.label !== null && input.label.trim().length > 0 ? input.label.trim() : null,
  });
  if (error !== null) throw toVenueFeatureError(error);
}

export async function clearVenueSpecialDay(venueId: string, localDate: string): Promise<void> {
  const { error } = await (await getSupabase()).rpc("issue_4490_clear_special_hours", {
    p_venue_id: venueId,
    p_local_date: localDate,
  });
  if (error !== null) throw toVenueFeatureError(error);
}

// ---------------------------------------------------------------------------
// Event / experience venue link
// ---------------------------------------------------------------------------

/**
 * #4490 fix 3 (N101) — "takes" = the event holds its space (or every part of
 * its combination, or every space of the venue) while it runs, so no hire,
 * by-the-hour booking or block can use it; "shared" = the space stays open to
 * others. The server enforces it once the event is scheduled or live.
 */
export type EventSpaceUse = "exclusive" | "shared";

export async function setEventVenue(input: {
  eventId: string;
  venueId: string | null;
  spaceId: string | null;
  /** #4490 fix 3 (N106): a combination of the venue instead of one space. */
  combinationId?: string | null;
  spaceUse?: EventSpaceUse;
}): Promise<void> {
  const atVenue = input.venueId !== null;
  const combinationId = atVenue && input.spaceId === null ? input.combinationId ?? null : null;
  const { error } = await (await getSupabase()).rpc("issue_4490_set_event_venue", {
    p_event_id: input.eventId,
    p_venue_id: input.venueId,
    p_space_id: atVenue ? input.spaceId : null,
    p_space_use: atVenue ? input.spaceUse ?? "shared" : "shared",
    p_expected_updated_at: null,
    p_combination_id: combinationId,
  });
  if (error !== null) throw toVenueFeatureError(error);
}

/**
 * #4490 fix 2 (N84) — where a venue is, so an event placed "at one of your
 * venues" takes the venue's name, address, pin and time zone without typing.
 */
export interface VenueLocation {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
  placeId: string | null;
}

export async function fetchVenueLocation(venueId: string): Promise<VenueLocation | null> {
  const { data, error } = await (await getSupabase())
    .from("venue_listings")
    .select("id, name, address, city, country_code, lat, lng, location_provider_place_id")
    .eq("id", venueId)
    .maybeSingle();
  if (error !== null) throw toVenueFeatureError(error);
  if (data === null) return null;
  const row = data as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v : null);
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    address: str(row.address),
    city: str(row.city),
    countryCode: str(row.country_code),
    lat: num(row.lat),
    lng: num(row.lng),
    placeId: str(row.location_provider_place_id),
  };
}

/** Row kinds that can sit in a venue space (the picker's two callers). */
export function eventVenueLinkTypes(kind: "event" | "experience"): readonly string[] {
  return kind === "experience" ? ["experience"] : ["event", "rsvp"];
}

export interface EventVenueLink {
  venueId: string | null;
  spaceId: string | null;
  combinationId: string | null;
  spaceUse: EventSpaceUse;
}

export async function fetchEventVenueLink(
  eventId: string,
  kind: "event" | "experience" = "event",
): Promise<EventVenueLink> {
  const { data, error } = await (await getSupabase())
    // orch-strict-grep-allow events-type-filter — #4490: event_type IS filtered with .in(eventVenueLinkTypes(kind)): the event creator's row is "event" or "rsvp", the experience creator's is "experience"; trips never reach the venue picker.
    .from("events")
    .select("venue_id, space_id, combination_id, space_use")
    .eq("id", eventId)
    .in("event_type", [...eventVenueLinkTypes(kind)])
    .maybeSingle();
  if (error !== null) throw toVenueFeatureError(error);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    venueId: typeof row.venue_id === "string" ? row.venue_id : null,
    spaceId: typeof row.space_id === "string" ? row.space_id : null,
    combinationId: typeof row.combination_id === "string" ? row.combination_id : null,
    spaceUse: row.space_use === "exclusive" ? "exclusive" : "shared",
  };
}
