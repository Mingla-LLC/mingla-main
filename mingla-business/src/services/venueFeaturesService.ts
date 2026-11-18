/**
 * #4490 — venue features, spaces, special days and the event/venue link.
 *
 * Every write goes through a #4490 RPC (never a table write): the server
 * checks authority, dependencies and versions. Errors are mapped to plain
 * host copy by `venueFeatureErrorCopy`; a raw code never reaches the screen.
 */

import { supabase } from "./supabase";
import { randomId } from "../utils/randomId";
import {
  SWITCHABLE_FEATURES,
  VENUE_FEATURE_KEYS,
  featureSetFrom,
  type VenueFeature,
  type VenueFeatureKey,
  type VenueFeatureState,
  type VenueTypeKey,
} from "../types/venueFeatures";

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
  const { data, error } = await supabase.rpc("issue_4490_get_venue_features", {
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
}

export interface SetVenueFeatureResult {
  changedKeys: VenueFeatureKey[];
  state: VenueFeatureState;
}

export async function setVenueFeature(input: SetVenueFeatureInput): Promise<SetVenueFeatureResult> {
  const { data, error } = await supabase.rpc("issue_4490_set_venue_feature", {
    p_venue_id: input.venueId,
    p_key: input.key,
    p_enabled: input.enabled,
    p_space_ids: input.spaceIds ?? null,
    p_settings: null,
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
  const { data, error } = await supabase.rpc("issue_4490_apply_feature_preset", {
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
export async function applyStartingFeatures(
  venueId: string,
  chosen: readonly VenueFeatureKey[],
): Promise<VenueFeatureState | null> {
  let state = await fetchVenueFeatures(venueId);
  for (const key of SWITCHABLE_FEATURES) {
    if (key === "table_ordering") continue;
    const want = chosen.includes(key);
    if (state.features[key].enabled === want) continue;
    const result = await setVenueFeature({
      venueId,
      key,
      enabled: want,
      cascade: true,
      expectedVersion: state.features[key].version,
    });
    state = result.state;
  }
  return state;
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
  photos: string[];
  planShape: SpacePlanShape | null;
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
    photos: photoUrls(r.photos),
    planShape: mapPlanShape(r.plan_shape),
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
  const { data, error } = await supabase
    .from("venue_spaces")
    .select(
      "id, venue_id, name, setting, capacity_standing, capacity_seated, photos, plan_shape, sort_order, can_be_hired, step_free, amenities, version",
    )
    .eq("venue_id", venueId)
    .is("archived_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error !== null) throw toVenueFeatureError(error);
  return (data ?? []).map(mapVenueSpace);
}

export async function fetchVenueSpaceCombinations(venueId: string): Promise<VenueSpaceCombination[]> {
  const { data, error } = await supabase
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
  const { data, error } = await supabase.rpc("issue_4490_manage_space", {
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
  const { error } = await supabase.rpc("issue_4490_manage_space_combination", {
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
  const { data, error } = await supabase
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
  const { error } = await supabase.rpc("issue_4490_set_special_hours", {
    p_venue_id: input.venueId,
    p_local_date: input.localDate,
    p_is_closed: input.isClosed,
    p_windows: input.isClosed ? [] : input.windows,
    p_label: input.label !== null && input.label.trim().length > 0 ? input.label.trim() : null,
  });
  if (error !== null) throw toVenueFeatureError(error);
}

export async function clearVenueSpecialDay(venueId: string, localDate: string): Promise<void> {
  const { error } = await supabase.rpc("issue_4490_clear_special_hours", {
    p_venue_id: venueId,
    p_local_date: localDate,
  });
  if (error !== null) throw toVenueFeatureError(error);
}

// ---------------------------------------------------------------------------
// Event / experience venue link
// ---------------------------------------------------------------------------

export async function setEventVenue(input: {
  eventId: string;
  venueId: string | null;
  spaceId: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("issue_4490_set_event_venue", {
    p_event_id: input.eventId,
    p_venue_id: input.venueId,
    p_space_id: input.venueId === null ? null : input.spaceId,
    p_space_use: "shared",
    p_expected_updated_at: null,
  });
  if (error !== null) throw toVenueFeatureError(error);
}

/** Row kinds that can sit in a venue space (the picker's two callers). */
export function eventVenueLinkTypes(kind: "event" | "experience"): readonly string[] {
  return kind === "experience" ? ["experience"] : ["event", "rsvp"];
}

export async function fetchEventVenueLink(
  eventId: string,
  kind: "event" | "experience" = "event",
): Promise<{ venueId: string | null; spaceId: string | null }> {
  const { data, error } = await supabase
    // orch-strict-grep-allow events-type-filter — #4490: event_type IS filtered with .in(eventVenueLinkTypes(kind)): the event creator's row is "event" or "rsvp", the experience creator's is "experience"; trips never reach the venue picker.
    .from("events")
    .select("venue_id, space_id")
    .eq("id", eventId)
    .in("event_type", [...eventVenueLinkTypes(kind)])
    .maybeSingle();
  if (error !== null) throw toVenueFeatureError(error);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    venueId: typeof row.venue_id === "string" ? row.venue_id : null,
    spaceId: typeof row.space_id === "string" ? row.space_id : null,
  };
}
