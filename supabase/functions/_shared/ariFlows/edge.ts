/**
 * Issue #3355 P3 — glue between the flow runner and the Ari edge functions
 * (agent-chat, agent-confirm-action, agent-turn-control). Kept here so each
 * function only calls one helper and tests can drive it with fake clients.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { AgentChoicesV2 } from "../agentChoices.ts";
import {
  type BrandReadiness,
  readBrandReadiness,
} from "../agentReadinessTools.ts";
import type { ReadinessAction } from "../readinessCatalog.ts";
import {
  classifyReadinessQuestion,
  findFlowDefinition,
  intentWantsInstallments,
  intentWantsPaid,
} from "./index.ts";
import { buildReadinessAnswer } from "./readinessAnswer.ts";
import { SITE_AGENT_READ_ONLY, SITE_AGENT_TOOLS } from "../agentSiteTools.ts";
import { detectWebsiteSetupIntent } from "../agentWebsiteSetup.ts";
import { WEBSITE_SETUP_FLOW, WEBSITE_SETUP_FLOW_KEY } from "./websiteSetup.ts";
import {
  CONTACT_LIST_STEP,
  CONTACT_REVIEW_STEP,
  IMPORT_CONTACTS_FLOW_KEY,
} from "./contactImport.ts";
import { CONTACT_IMPORT_MAPPING_VERSION } from "../contactImportContract.ts";
import {
  ARI_CONTACT_CSV_MAPPING,
  contactImportErrorCode,
} from "../ariContactImportWrite.ts";
import { PLAN_PARTS, type PlanPartKey } from "../siteContracts/sitePlan.ts";
import {
  followUpOf,
  parkArtefact,
  RESUME_CHOICE,
  runFlowStep,
  type RunnerOutcome,
  type RunnerTrigger,
} from "./runner.ts";
import type { FlowRequestHint } from "./requestRead.ts";
import {
  createFlowStore,
  FlowConflict,
  type FlowDisplacement,
  FlowEngineUnavailable,
  type FlowStore,
} from "./store.ts";
import {
  type ContactImportCounts,
  type ContactImportPreview,
  ContactImportRefused,
  type ContactImportStatus,
} from "./types.ts";
import type {
  FlowAnswer,
  FlowAnswerValues,
  FlowArtefact,
  FlowEventRow,
  FlowExperienceRow,
  FlowPlaceValue,
  FlowProbeDeps,
  FlowRun,
  FlowStayInventory,
  FlowTripPlace,
  FlowTripRow,
  FlowVenueRow,
} from "./types.ts";
import { LIVE_FLOW_STATUSES } from "./types.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Validate the Host's structured answer (`flow_answer`). */
export function parseFlowAnswer(value: unknown): FlowAnswer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.run_id !== "string" || !UUID.test(raw.run_id) ||
    typeof raw.question_id !== "string" || !UUID.test(raw.question_id) ||
    typeof raw.step_key !== "string" ||
    !/^[a-z][a-z_]{1,40}$/.test(raw.step_key) ||
    typeof raw.choice_id !== "string" ||
    !/^[a-z][a-z_]*(?::[a-z][a-z_.]*)?$/.test(raw.choice_id) ||
    raw.choice_id.length > 80 ||
    typeof raw.display_text !== "string" ||
    raw.display_text.trim().length === 0 || raw.display_text.length > 200
  ) return null;
  // #2830 P4: a form answer (choice "answer") carries the card control's
  // values and nothing else; a chip answer carries none.
  let values: FlowAnswerValues | undefined;
  if (raw.choice_id === "answer") {
    const parsed = parseFlowAnswerValues(raw.values);
    if (!parsed) return null;
    values = parsed;
  } else if (raw.values !== undefined) {
    return null;
  }
  return {
    run_id: raw.run_id,
    question_id: raw.question_id,
    step_key: raw.step_key,
    choice_id: raw.choice_id,
    display_text: raw.display_text.trim(),
    ...(values ? { values } : {}),
  };
}

function parseFlowAnswerValues(value: unknown): FlowAnswerValues | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    Object.keys(raw).some((key) =>
      !["choices", "country", "response", "place"].includes(key)
    )
  ) return null;
  // #3355 P7: a place picked from the address search on the card.
  let place: FlowPlaceValue | undefined;
  if (raw.place !== undefined) {
    const parsed = parseFlowPlace(raw.place);
    if (!parsed) return null;
    place = parsed;
  }
  const choices = raw.choices ?? [];
  if (
    !Array.isArray(choices) || choices.length > 10 ||
    choices.some((choice) =>
      typeof choice !== "string" || !choice.trim() || choice.length > 100
    )
  ) return null;
  const country = raw.country ?? null;
  if (
    country !== null &&
    (typeof country !== "string" || !/^[A-Z]{2}$/.test(country))
  ) return null;
  const response = raw.response ?? "";
  if (typeof response !== "string" || response.length > 2000) return null;
  if (choices.length === 0 && !response.trim() && !place) return null;
  return {
    choices: (choices as string[]).map((choice) => choice.trim()),
    country: country as string | null,
    response: response.trim(),
    ...(place ? { place } : {}),
  };
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

/** #3355 P7 — validate a picked place (shape only; the server re-checks). */
export function parseFlowPlace(value: unknown): FlowPlaceValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const allowed = [
    "venue_name",
    "address",
    "city",
    "country_code",
    "lat",
    "lng",
    "feature_type",
    // #3355 P9 — the address search's own id (an experience stop's place_id).
    "place_id",
  ];
  if (Object.keys(raw).some((key) => !allowed.includes(key))) return null;
  const venue = boundedText(raw.venue_name, 120);
  const address = boundedText(raw.address, 300);
  const city = boundedText(raw.city, 120);
  const lat = raw.lat;
  const lng = raw.lng;
  if (
    !venue || !address || !city || typeof lat !== "number" ||
    typeof lng !== "number" || !Number.isFinite(lat) ||
    !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180
  ) return null;
  const country = raw.country_code ?? null;
  if (
    country !== null &&
    (typeof country !== "string" || !/^[A-Z]{2}$/.test(country))
  ) return null;
  const feature = raw.feature_type ?? null;
  if (
    feature !== null &&
    (typeof feature !== "string" || !/^[a-z_]{1,30}$/.test(feature))
  ) return null;
  const placeId = raw.place_id ?? null;
  if (
    placeId !== null &&
    (typeof placeId !== "string" ||
      !/^[A-Za-z0-9._:=+/-]{1,300}$/.test(placeId))
  ) return null;
  return {
    venue_name: venue,
    address,
    city,
    country_code: country as string | null,
    lat,
    lng,
    feature_type: feature as string | null,
    ...(placeId ? { place_id: placeId } : {}),
  };
}

/** What every response tells the Host about the chat's run. */
export interface FlowStateView {
  run_id: string;
  /** #2830 P4: which flow (the Host shows Website setup progress for it). */
  flow_key: string;
  status: FlowRun["status"];
  current_artefact_id: string | null;
  current_step_key: string | null;
  lease_owner_name: string | null;
  /** Who started the run (shown to teammates who can only follow along). */
  owner_name: string;
  view_only: boolean;
  /** #2830 — the field the open card asks about; the setup form highlights it. */
  current_field_key: string | null;
}

export function flowStateOf(run: FlowRun | null): FlowStateView | null {
  if (!run) return null;
  const live = LIVE_FLOW_STATUSES.has(run.status);
  return {
    run_id: run.id,
    flow_key: run.flow_key,
    status: run.status,
    // #3355 Wave A: a parked run's one current card is its Resume card.
    current_artefact_id: live
      ? run.current_artefact?.artefact_id ?? null
      : run.status === "parked"
      ? parkArtefact(run).artefact_id
      // #3355 Wave A (A3): a finished run's summary link stays tappable.
      : run.status === "completed" &&
          run.current_artefact?.kind === "summary" &&
          run.current_artefact.options.length > 0
      ? run.current_artefact.artefact_id
      : null,
    current_step_key: run.current_step_key,
    lease_owner_name: run.lease_held && !run.lease_held_by_me
      ? run.lease_owner_name
      : null,
    owner_name: run.started_by_name,
    view_only: !run.started_by_me,
    current_field_key: (() => {
      const key = run.current_step_key
        ? run.step_states[run.current_step_key]?.data?.field_key
        : null;
      return typeof key === "string" ? key : null;
    })(),
  };
}

/**
 * The card's choices in the existing v2 choices shape. Each option still
 * travels to the server as a structured `flow_answer`, never as text.
 */
export function flowChoices(
  artefact: FlowArtefact,
): AgentChoicesV2 | undefined {
  if (!artefact.question_id || artefact.options.length === 0) return undefined;
  return {
    schema_version: 2,
    question_id: artefact.question_id,
    kind: "next_step",
    prompt: artefact.title,
    required_slot_keys: [],
    options: artefact.options.slice(0, 4).map((option) => ({
      id: option.id,
      label: option.label,
      payload: option.route
        ? { type: "handoff" as const, route: option.route }
        : {
          type: "slot_patch" as const,
          slot_updates: { flow_choice: option.id },
        },
    })),
  };
}

/**
 * #2830 P4 — the extra structured content an agent-chat reply needs for a
 * flow card: a form card's control (its rendition). Every row that shows a
 * form card must carry it, or the owner sees the question with no control.
 */
export function flowReplyStructured(
  artefact: FlowArtefact | null,
): { structuredData?: Record<string, unknown> } {
  return artefact?.rendition
    ? { structuredData: { rendition: artefact.rendition } }
    : {};
}

/** Assistant row content for a flow artefact. */
export function flowMessageContent(
  text: string,
  artefact: FlowArtefact | null,
  state: FlowStateView | null,
): Record<string, unknown> {
  const choices = artefact ? flowChoices(artefact) : undefined;
  return {
    text,
    ...(artefact || state
      ? {
        structured: {
          ...(artefact ? { flow: artefact } : {}),
          ...(choices ? { choices } : {}),
          // #2830 P4: a form card's control rides as its rendition.
          ...(artefact?.rendition ? { rendition: artefact.rendition } : {}),
          ...(state ? { flow_state: state } : {}),
        },
      }
      : {}),
  };
}

const SITE_READS: ReadonlyMap<string, (typeof SITE_AGENT_TOOLS)[number]> =
  new Map(
    SITE_AGENT_TOOLS.filter((tool) => SITE_AGENT_READ_ONLY.has(tool.name))
      .map((tool) => [tool.name, tool]),
  );

const EVENT_COLUMNS =
  "id,title,status,timezone,description,party_types,city,cover_media_url,online_url,created_at,theme";

function eventRowOf(data: unknown): FlowEventRow {
  const row = data as Record<string, unknown>;
  const theme = row.theme && typeof row.theme === "object"
    ? row.theme as Record<string, unknown>
    : {};
  const draft = theme.business_draft && typeof theme.business_draft === "object"
    ? theme.business_draft as Record<string, unknown>
    : {};
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value : null;
  return {
    id: String(row.id),
    title: typeof row.title === "string" ? row.title : "",
    status: typeof row.status === "string" ? row.status : "",
    timezone: text(row.timezone),
    description: text(row.description),
    party_types: Array.isArray(row.party_types)
      ? row.party_types.filter((item): item is string =>
        typeof item === "string"
      )
      : [],
    city: text(row.city),
    cover_media_url: text(row.cover_media_url),
    online_url: text(row.online_url),
    created_at: text(row.created_at),
    draft,
  };
}

/** #3355 P8 — a trip place from theme.business_trip (`departure…` keys). */
function tripPlaceOf(
  trip: Record<string, unknown>,
  side: "departure" | "destination",
  column: unknown,
): FlowTripPlace | null {
  const label = typeof column === "string" && column.trim()
    ? column.trim()
    : typeof trip[`${side}LocationText`] === "string"
    ? String(trip[`${side}LocationText`]).trim()
    : "";
  if (!label) return null;
  const num = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  return {
    label,
    lat: num(trip[`${side}Lat`]),
    lng: num(trip[`${side}Lng`]),
  };
}

/** #3355 P8 — one trip, read as the caller (null when gone or not theirs). */
async function readTripRow(
  userClient: SupabaseClient,
  brandId: string,
  id: string,
): Promise<FlowTripRow | null> {
  const { data, error } = await userClient.from("events")
    .select(
      "id,title,status,timezone,updated_at,theme,refund_policy,destination_text,departure_text",
    )
    .eq("id", id)
    .eq("brand_id", brandId)
    .eq("event_type", "trip")
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  const [dates, tickets, tiers, days] = await Promise.all([
    userClient.from("event_dates").select("start_at,end_at")
      .eq("event_id", id).eq("is_master", true).maybeSingle(),
    userClient.from("ticket_types").select("id,name,price_cents,quantity_total")
      .eq("event_id", id).is("deleted_at", null),
    userClient.from("trip_pricing_tiers").select("ticket_type_id,tier_metadata")
      .eq("event_id", id),
    userClient.from("trip_days").select("id", { count: "exact", head: true })
      .eq("event_id", id),
  ]);
  if (dates.error || tickets.error || tiers.error || days.error) return null;
  const theme = row.theme && typeof row.theme === "object"
    ? row.theme as Record<string, unknown>
    : {};
  const trip = theme.business_trip && typeof theme.business_trip === "object"
    ? theme.business_trip as Record<string, unknown>
    : {};
  const metadata = new Map(
    ((tiers.data ?? []) as Record<string, unknown>[]).map((tier) => [
      String(tier.ticket_type_id),
      tier.tier_metadata,
    ]),
  );
  const date = (dates.data ?? null) as Record<string, unknown> | null;
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value : null;
  return {
    id: String(row.id),
    title: typeof row.title === "string" ? row.title : "",
    status: typeof row.status === "string" ? row.status : "",
    timezone: text(row.timezone),
    updated_at: String(row.updated_at ?? ""),
    start_at: text(date?.start_at),
    end_at: text(date?.end_at),
    departure: tripPlaceOf(trip, "departure", row.departure_text),
    destination: tripPlaceOf(trip, "destination", row.destination_text),
    refund_policy: row.refund_policy && typeof row.refund_policy === "object"
      ? row.refund_policy as Record<string, unknown>
      : null,
    day_count: days.count ?? 0,
    packages: ((tickets.data ?? []) as Record<string, unknown>[])
      .filter((ticket) => metadata.has(String(ticket.id)))
      .map((ticket) => {
        const meta = metadata.get(String(ticket.id));
        return {
          ticket_type_id: String(ticket.id),
          name: typeof ticket.name === "string" ? ticket.name : "",
          price_cents: Number(ticket.price_cents ?? 0),
          capacity: typeof ticket.quantity_total === "number"
            ? ticket.quantity_total
            : null,
          installments: !!meta && typeof meta === "object" &&
            !!(meta as Record<string, unknown>).installments,
        };
      }),
  };
}

/** #3355 P9 — one experience, read as the caller (null when gone). */
async function readExperienceRow(
  userClient: SupabaseClient,
  brandId: string,
  id: string,
): Promise<FlowExperienceRow | null> {
  const { data, error } = await userClient.from("events")
    .select(
      "id,title,status,updated_at,timezone,description,experience_intents,whole_price_cents,theme",
    )
    .eq("id", id)
    .eq("brand_id", brandId)
    .eq("event_type", "experience")
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  const [stops, tickets] = await Promise.all([
    userClient.from("experience_stops")
      .select("place_name,ai_description,address,place_id,lat,lng,stop_order")
      .eq("event_id", id)
      .order("stop_order", { ascending: true }),
    userClient.from("ticket_types").select("is_free,price_cents,display_order")
      .eq("event_id", id).is("deleted_at", null)
      .order("display_order", { ascending: true }).limit(1),
  ]);
  if (stops.error || tickets.error) return null;
  const theme = row.theme && typeof row.theme === "object"
    ? row.theme as Record<string, unknown>
    : {};
  const meta =
    theme.experience_meta && typeof theme.experience_meta === "object"
      ? theme.experience_meta as Record<string, unknown>
      : {};
  const whenDraft = meta.when_draft && typeof meta.when_draft === "object"
    ? meta.when_draft as Record<string, unknown>
    : {};
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value : null;
  const ticket = ((tickets.data ?? []) as Record<string, unknown>[])[0];
  return {
    id: String(row.id),
    title: typeof row.title === "string" ? row.title : "",
    status: typeof row.status === "string" ? row.status : "",
    updated_at: String(row.updated_at ?? ""),
    timezone: text(row.timezone) ?? text(whenDraft.timezone),
    description: text(row.description),
    intents: Array.isArray(row.experience_intents)
      ? row.experience_intents.filter((item): item is string =>
        typeof item === "string"
      )
      : [],
    stops: ((stops.data ?? []) as Record<string, unknown>[]).map((stop) => ({
      name: typeof stop.place_name === "string" ? stop.place_name : "",
      description: typeof stop.ai_description === "string"
        ? stop.ai_description
        : "",
      address: typeof stop.address === "string" ? stop.address : "",
      has_point: typeof stop.lat === "number" && typeof stop.lng === "number",
      has_place_id: !!text(stop.place_id),
    })),
    is_free: ticket?.is_free === true,
    whole_price_cents: typeof row.whole_price_cents === "number"
      ? row.whole_price_cents
      : null,
    when: whenDraft.when && typeof whenDraft.when === "object"
      ? whenDraft.when as Record<string, unknown>
      : null,
  };
}

/** #3355 P9 — the brand's venue listings (no contact details). */
async function readVenues(
  userClient: SupabaseClient,
  brandId: string,
): Promise<FlowVenueRow[]> {
  const { data, error } = await userClient.from("venue_listings")
    .select(
      "id,name,slug,venue_category,claim_status,city,country_code,cover_media_url,created_at",
    )
    .eq("brand_id", brandId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error || !Array.isArray(data)) return [];
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value : null;
  return (data as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    name: typeof row.name === "string" ? row.name : "",
    slug: typeof row.slug === "string" ? row.slug : "",
    venue_category: typeof row.venue_category === "string"
      ? row.venue_category
      : "",
    claim_status: typeof row.claim_status === "string" ? row.claim_status : "",
    city: text(row.city),
    country_code: text(row.country_code),
    cover_media_url: text(row.cover_media_url),
    created_at: text(row.created_at),
  }));
}

/** #3355 P9 — one venue's Stay through manage-stay-inventory "get". */
async function readStayInventory(
  userClient: SupabaseClient,
  venueId: string,
): Promise<FlowStayInventory | null> {
  const { data, error } = await userClient.functions.invoke(
    "manage-stay-inventory",
    { body: { action: "get", venueId, payload: {} } },
  );
  if (error || !data || typeof data !== "object") return null;
  return stayInventoryOf(venueId, (data as { data?: unknown }).data);
}

/** The Stay snapshot (issue_1387_stay_inventory_snapshot) in flow terms. */
export function stayInventoryOf(
  venueId: string,
  snapshot: unknown,
): FlowStayInventory | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const snap = snapshot as Record<string, unknown>;
  const settings = snap.settings && typeof snap.settings === "object"
    ? snap.settings as Record<string, unknown>
    : null;
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value : null;
  const offerings = Array.isArray(snap.offerings)
    ? snap.offerings as Record<string, unknown>[]
    : [];
  return {
    venue_id: venueId,
    settings_version: typeof settings?.version === "number"
      ? settings.version
      : null,
    settings: settings
      ? {
        summary: typeof settings.summary === "string" ? settings.summary : "",
        timezone: text(settings.timezone),
        check_in_time: text(settings.check_in_time),
        check_out_time: text(settings.check_out_time),
      }
      : null,
    settings_raw: settings,
    offerings: offerings.map((offering) => ({
      id: String(offering.id ?? ""),
      name: typeof offering.name === "string" ? offering.name : "",
      kind: typeof offering.kind === "string" ? offering.kind : "",
      status: typeof offering.status === "string" ? offering.status : "",
      version: typeof offering.version === "number" ? offering.version : 0,
      has_price: !!offering.currentPrice,
      has_policy: !!offering.currentPolicy,
    })),
  };
}

const ARI_CONTACT_FILE_NAME = "ari-contact-list.csv";

function importCounts(value: unknown): ContactImportCounts | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const keys = [
    "rowCount",
    "addedCount",
    "updatedCount",
    "reviewCount",
    "invalidCount",
    "duplicateCount",
    "unchangedCount",
    "alreadySuppressedCount",
  ] as const;
  if (keys.some((key) => typeof raw[key] !== "number")) return null;
  return Object.fromEntries(
    keys.map((key) => [key, raw[key]]),
  ) as unknown as ContactImportCounts;
}

async function invokeContactImport(
  userClient: SupabaseClient,
  body: FormData | Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const { data, error } = await userClient.functions.invoke("contact-import", {
    body,
    ...(headers ? { headers } : {}),
  });
  if (error) {
    const code = await contactImportErrorCode(error);
    throw new ContactImportRefused(code, code);
  }
  const payload = (data as { data?: unknown } | null)?.data;
  if (!payload || typeof payload !== "object") {
    throw new ContactImportRefused("IMPORT_FAILED", "IMPORT_FAILED");
  }
  return payload as Record<string, unknown>;
}

function csvForm(csv: string, extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.append(
    "file",
    new File([csv], ARI_CONTACT_FILE_NAME, { type: "text/csv" }),
  );
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  return form;
}

/**
 * #3355 — inspect then preview with the existing import (the Host's own two
 * calls), on the CSV Ari built from the owner's list.
 */
export async function contactImportPreview(
  userClient: SupabaseClient,
  brandId: string,
  csv: string,
): Promise<ContactImportPreview> {
  const inspected = await invokeContactImport(userClient, csvForm(csv), {
    "x-mingla-import-action": "inspect",
    "x-mingla-brand-id": brandId,
  });
  const inspectionId = inspected.inspectionId;
  const inspectionToken = inspected.inspectionToken;
  if (typeof inspectionId !== "string" || typeof inspectionToken !== "string") {
    throw new ContactImportRefused("IMPORT_FAILED", "IMPORT_FAILED");
  }
  const previewed = await invokeContactImport(
    userClient,
    csvForm(csv, {
      inspectionId,
      inspectionToken,
      mappingVersion: CONTACT_IMPORT_MAPPING_VERSION,
      normalizedMapping: JSON.stringify(ARI_CONTACT_CSV_MAPPING),
    }),
    { "x-mingla-import-action": "preview", "x-mingla-brand-id": brandId },
  );
  const counts = importCounts(previewed.counts);
  const file = previewed.file as { sha256?: unknown } | undefined;
  if (
    typeof previewed.batchId !== "string" ||
    typeof previewed.previewToken !== "string" ||
    typeof file?.sha256 !== "string" || !counts
  ) {
    throw new ContactImportRefused("IMPORT_FAILED", "IMPORT_FAILED");
  }
  const rows = Array.isArray(previewed.rows) ? previewed.rows : [];
  return {
    batch_id: previewed.batchId,
    preview_token: previewed.previewToken,
    file_sha256: file.sha256,
    counts,
    rows: rows.flatMap((row) => {
      const r = row as Record<string, unknown>;
      return typeof r.rowNumber === "number" && typeof r.outcome === "string"
        ? [{
          row_number: r.rowNumber,
          outcome: r.outcome,
          reason: typeof r.reasonCode === "string" ? r.reasonCode : null,
        }]
        : [];
    }),
  };
}

/** #3355 — one import read back as the caller (null when not found). */
export async function contactImportStatus(
  userClient: SupabaseClient,
  brandId: string,
  batchId: string,
): Promise<ContactImportStatus | null> {
  try {
    const status = await invokeContactImport(userClient, {
      action: "status",
      brandId,
      batchId,
      pageSize: 1,
    });
    const counts = importCounts(status.counts);
    if (typeof status.state !== "string" || !counts) return null;
    return { batch_id: batchId, state: status.state, counts };
  } catch (error) {
    if (
      error instanceof ContactImportRefused &&
      error.code === "BATCH_NOT_FOUND"
    ) return null;
    throw error;
  }
}

/** Canonical reads the runner makes for one brand, memoised per request. */
/**
 * #2830 — passed in by the functions that may search (agent-chat,
 * agent-confirm-action). Without it the question is simply plain.
 */
export type FlowResearch = (args: {
  userId: string;
  brandId: string;
  plan: Record<string, unknown>;
}) => Promise<Record<string, Record<string, unknown>[] | undefined> | null>;

export function buildFlowProbeDeps(
  userClient: SupabaseClient,
  brandId: string,
  userId?: string,
  conversationId?: string,
  research?: FlowResearch,
): FlowProbeDeps {
  const cache = new Map<string, Promise<BrandReadiness>>();
  const reads = new Map<string, Promise<unknown>>();
  const events = new Map<string, Promise<FlowEventRow | null>>();
  const trips = new Map<string, Promise<FlowTripRow | null>>();
  const experiences = new Map<string, Promise<FlowExperienceRow | null>>();
  const stays = new Map<string, Promise<FlowStayInventory | null>>();
  let venueList: Promise<FlowVenueRow[]> | null = null;
  return {
    // #2830 P4: one read-only Website tool as the caller, memoised for the
    // request. A write tool is never reachable here.
    readTool(name: string, args: Record<string, unknown>) {
      const tool = SITE_READS.get(name);
      if (!tool || !userId) {
        return Promise.reject(new Error(`read ${name} unavailable`));
      }
      const key = `${name}:${JSON.stringify(args)}`;
      let pending = reads.get(key);
      if (!pending) {
        pending = tool.executor(args, userClient, userId, {
          operationId: null,
        });
        reads.set(key, pending);
      }
      return pending;
    },
    // #2830 — Ari's public research for brand details. Never holds the question
    // up; candidates become evidence only when the field is asked.
    async brandResearch(plan: Record<string, unknown>) {
      if (!research || !userId) return null;
      return await research({ userId, brandId, plan });
    },
    async recordFinding(fieldKey, candidates) {
      // As the caller: the RPC refuses anyone who can't edit the brand.
      const { error } = await userClient.rpc(
        "ari_record_brand_context_finding",
        {
          p_brand_id: brandId,
          p_field_key: fieldKey,
          p_disposition: "stale",
          p_candidates: candidates,
        },
      );
      return !error;
    },
    async hasOpenProposal() {
      if (!userId || !conversationId) return false;
      const { data, error } = await userClient.from("agent_pending_actions")
        .select("id")
        .eq("user_id", userId)
        .eq("conversation_id", conversationId)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .limit(1);
      return !error && Array.isArray(data) && data.length > 0;
    },
    readiness(action: ReadinessAction | null) {
      const key = action ?? "all";
      let pending = cache.get(key);
      if (!pending) {
        pending = readBrandReadiness(userClient, brandId, action);
        cache.set(key, pending);
      }
      return pending;
    },
    // #3355 P7 — the brand's own facts and its events, read as the caller.
    async brandFacts() {
      const { data, error } = await userClient.from("brands")
        .select(
          "default_timezone,country_code,default_currency,contact_email,contact_phone",
        )
        .eq("id", brandId)
        .maybeSingle();
      if (error || !data) return null;
      const row = data as Record<string, unknown>;
      const text = (value: unknown) =>
        typeof value === "string" && value.trim() ? value.trim() : null;
      return {
        default_timezone: text(row.default_timezone),
        country_code: text(row.country_code),
        default_currency: text(row.default_currency),
        contact_email: text(row.contact_email),
        contact_phone: text(row.contact_phone),
      };
    },
    eventRow(id: string) {
      let pending = events.get(id);
      if (!pending) {
        pending = (async () => {
          const { data, error } = await userClient.from("events")
            .select(EVENT_COLUMNS)
            .eq("id", id)
            .eq("brand_id", brandId)
            .is("deleted_at", null)
            .maybeSingle();
          return error || !data ? null : eventRowOf(data);
        })();
        events.set(id, pending);
      }
      return pending;
    },
    async eventsTitled(title: string) {
      const { data, error } = await userClient.from("events")
        .select(EVENT_COLUMNS)
        .eq("brand_id", brandId)
        .eq("event_type", "event")
        .in("status", ["draft", "scheduled"])
        .is("deleted_at", null)
        .ilike("title", title.replace(/[\\%_]/g, (c) => `\\${c}`))
        .limit(10);
      if (error || !Array.isArray(data)) return [];
      return data.map(eventRowOf);
    },
    tripRow(id: string) {
      let pending = trips.get(id);
      if (!pending) {
        pending = readTripRow(userClient, brandId, id);
        trips.set(id, pending);
      }
      return pending;
    },
    // #3355 P9 — experiences, venues and Stays, read as the caller.
    experienceRow(id: string) {
      let pending = experiences.get(id);
      if (!pending) {
        pending = readExperienceRow(userClient, brandId, id);
        experiences.set(id, pending);
      }
      return pending;
    },
    venues() {
      if (!venueList) venueList = readVenues(userClient, brandId);
      return venueList;
    },
    stayInventory(venueId: string) {
      let pending = stays.get(venueId);
      if (!pending) {
        pending = readStayInventory(userClient, venueId);
        stays.set(venueId, pending);
      }
      return pending;
    },
    // #3355 — the existing contact import (#1775), as the caller: check a
    // list (stage it; nothing is added to the contacts) and read one back.
    contactImportPreview(csv: string) {
      return contactImportPreview(userClient, brandId, csv);
    },
    contactImportStatus(batchId: string) {
      return contactImportStatus(userClient, brandId, batchId);
    },
    async featureFlag(key: string) {
      const { data, error } = await userClient.from("feature_flags")
        .select("is_enabled")
        .eq("flag_key", key)
        .maybeSingle();
      return !error && (data as { is_enabled?: unknown } | null)?.is_enabled ===
          true;
    },
    async subjectExists(table: string, id: string) {
      if (!["events"].includes(table)) return false;
      const { data, error } = await userClient.from(table)
        .select("id")
        .eq("id", id)
        .eq("brand_id", brandId)
        .maybeSingle();
      return !error && !!data;
    },
    async setAside(itemKey: string) {
      cache.clear();
      const { error } = await userClient.rpc("brand_readiness_defer", {
        p_brand_id: brandId,
        p_item_key: itemKey,
        p_reason: "Not now (from Ari)",
      });
      return error ? "session_only" : "brand";
    },
  };
}

export type FlowTurnDecision =
  | { kind: "none" }
  | {
    kind: "reply";
    text: string;
    artefact: FlowArtefact | null;
    state: FlowStateView | null;
    handoff_route?: string;
    classification: string;
  }
  | {
    kind: "delegate";
    semantic_message: string;
    ack?: string;
    state: FlowStateView | null;
  }
  | { kind: "stale"; next: FlowArtefact | null; state: FlowStateView | null }
  /**
   * #3355 Wave A (A2) — the run was parked: the agent loop serves the
   * owner's words this turn, and `resume` (the Resume card) goes with it.
   */
  | {
    kind: "parked";
    hint: FlowRequestHint | "repeated";
    resume: FlowArtefact;
    state: FlowStateView | null;
  }
  /** #2830 P4: the owner's answer becomes one protected proposal. */
  | {
    kind: "propose";
    tool_name: string;
    tool_args: Record<string, unknown>;
    rows: { label: string; value: string }[];
    /** #3355 P7 — the card shows only these rows. */
    rows_only?: boolean;
    /** #3355 — the card's heading, in plain words. */
    card_title?: string;
    ack?: string;
    state: FlowStateView | null;
  }
  /**
   * #2830 P4: not the engine's turn, but the engine owns this chat's Website
   * setup — the pre-engine Website lanes must stay out of it.
   */
  | {
    kind: "side";
    state: FlowStateView | null;
    /**
     * #3355 — the card the owner is on. If the side answer fails, it comes
     * back with plain words instead of an error (the flow is never stranded).
     */
    artefact?: FlowArtefact | null;
  };

function decisionFromOutcome(outcome: RunnerOutcome): FlowTurnDecision {
  const state = flowStateOf(outcome.run);
  switch (outcome.kind) {
    case "artefact":
    case "completed":
      return {
        kind: "reply",
        text: outcome.text,
        artefact: outcome.artefact,
        state,
        ...(outcome.kind === "artefact" && outcome.open_route
          ? { handoff_route: outcome.open_route }
          : {}),
        classification: "flow_engine",
      };
    case "notice":
      return {
        kind: "reply",
        text: outcome.text,
        // #2830 P4: a refusal or "not there yet" brings the same card back
        // under the words (same artefact id: still the one current card).
        artefact: outcome.represent ? outcome.artefact : null,
        state,
        ...(outcome.open_route ? { handoff_route: outcome.open_route } : {}),
        classification: "flow_engine",
      };
    case "busy":
      return {
        kind: "reply",
        text: outcome.text,
        artefact: null,
        state,
        ...(outcome.open_route ? { handoff_route: outcome.open_route } : {}),
        classification: "flow_engine_busy",
      };
    case "cancelled":
      return {
        kind: "reply",
        text: outcome.text,
        artefact: null,
        state,
        classification: "flow_engine",
      };
    case "delegate":
      return {
        kind: "delegate",
        semantic_message: outcome.semantic_message,
        ...(outcome.ack ? { ack: outcome.ack } : {}),
        state,
      };
    case "stale":
      return { kind: "stale", next: outcome.artefact, state };
    case "parked":
      return {
        kind: "parked",
        hint: outcome.hint,
        resume: outcome.resume,
        state,
      };
    case "propose":
      return {
        kind: "propose",
        tool_name: outcome.tool_name,
        tool_args: outcome.tool_args,
        rows: outcome.rows,
        ...(outcome.rows_only ? { rows_only: true } : {}),
        ...(outcome.card_title ? { card_title: outcome.card_title } : {}),
        ...(outcome.ack ? { ack: outcome.ack } : {}),
        state,
      };
    case "unchanged":
    case "pass":
      return { kind: "none" };
  }
}

/**
 * #3355 Wave E (E1, D3a) — the turn's intent route, as the flow engine needs
 * it. The model's intent read decides; with the hint read ("hints", today's
 * behaviour) the keyword classifier decides the readiness answer and the
 * runner's own Wave A rules decide what typed words do to an open card.
 * Typed words never start a setup here: only the model's start_flow does
 * (see startFlowFromTool).
 */
export interface FlowTurnRoute {
  source: "model" | "hints";
  /** Answer a readiness question from the canonical checklist (no model). */
  readiness: ReadinessAction | "all" | null;
  /**
   * What typed words do to a live run: answer the card, park the run and
   * serve the words, cancel the run, or leave it untouched for a side answer.
   * Undefined: the runner's own rules (the fallback).
   */
  flowAction?: "answer" | "park" | "cancel" | "side";
  /** The host asked to carry on with this chat's parked run. */
  resumeParked?: boolean;
}

/** The hint route (no model): today's classifier behaviour. */
export function flowRouteFromHints(message: string): FlowTurnRoute {
  return {
    source: "hints",
    readiness: classifyReadinessQuestion(message),
  };
}

export interface FlowTurnArgs {
  service: SupabaseClient;
  /** #2830 — see FlowResearch. */
  research?: FlowResearch;
  userClient: SupabaseClient;
  userId: string;
  brand: { id: string; name: string } | null;
  conversationId: string;
  message: string;
  flowAnswer: FlowAnswer | null;
  engineEnabled: boolean;
  /** An event plan or Website setup already owns this chat. */
  otherLaneActive: boolean;
  /**
   * #3355 Wave D (D4): the host is stuck. An open setup is set aside, and no
   * setup or deterministic readiness answer starts this turn.
   */
  escalate?: boolean;
  /**
   * #2830 P4: this turn is Website setup (the Website setup screen). #3355
   * Wave E: a typed "start Website setup" in chat is the model's start_flow.
   */
  websiteSetup?: boolean;
  /** #3355 Wave E — the turn's intent route (default: the hint route). */
  route?: FlowTurnRoute;
  /**
   * #3355 — this turn's attachments as text (a contact list attached in the
   * chat). Read only when the import flow needs them.
   */
  attachments?: () => Promise<FlowTurnAttachment[]>;
  /** Test seam. */
  store?: FlowStore;
  /** Test seam: the canonical reads. */
  probes?: FlowProbeDeps;
}

/** #3355 — one attachment of this turn, as the flow sees it. */
export interface FlowTurnAttachment {
  file_type: string;
  name: string;
  /** Null when the file has no text Ari can read (PDF, image, audio…). */
  text: string | null;
}

/**
 * #3355 — attached files become the contact list step's answer (their text,
 * never the files). A file with no readable text gets plain words and the
 * same card back.
 */
export function contactListFromFiles(
  run: FlowRun,
  files: FlowTurnAttachment[],
): { kind: "answer"; answer: FlowAnswer } | {
  kind: "unreadable";
  text: string;
} {
  const readable = files.filter((file) => file.text && file.text.trim());
  if (readable.length === 0) {
    const pdf = files.some((file) => file.file_type === "pdf");
    return {
      kind: "unreadable",
      text: pdf
        ? "I can't read a contact list out of a PDF reliably, so nothing was saved. Save it as CSV from the program it came from, or copy the rows and paste them here."
        : "I can't read a contact list from that file, so nothing was saved. Attach a spreadsheet saved as CSV, a text file or a Word document, or paste the rows here.",
    };
  }
  const names = readable.map((file) => file.name).join(", ");
  return {
    kind: "answer",
    answer: {
      run_id: run.id,
      step_key: CONTACT_LIST_STEP,
      question_id: run.current_question_id ?? "",
      choice_id: "answer",
      display_text: `Attached ${names}`.slice(0, 200),
      values: {
        choices: [],
        country: null,
        response: readable.map((file) => file.text!.trim()).join("\n"),
      },
    },
  };
}

/**
 * #3355 — a turn of a live contact import that carries files: the files are
 * the list when the list card is open; otherwise plain words, same card.
 */
async function importFilesTurn(
  args: FlowTurnArgs,
  deps: { store: FlowStore; probes: FlowProbeDeps },
  run: FlowRun,
): Promise<FlowTurnDecision | null> {
  if (run.flow_key !== IMPORT_CONTACTS_FLOW_KEY || !args.attachments) {
    return null;
  }
  if (
    run.current_step_key !== CONTACT_LIST_STEP &&
    run.current_step_key !== CONTACT_REVIEW_STEP
  ) return null;
  let files: FlowTurnAttachment[];
  try {
    files = await args.attachments();
  } catch (_error) {
    files = [{ file_type: "unknown", name: "your file", text: null }];
  }
  if (files.length === 0) return null;
  const open = run.current_artefact;
  if (
    !open || run.current_step_key !== CONTACT_LIST_STEP ||
    !run.current_question_id
  ) {
    return {
      kind: "reply",
      text: open
        ? `I've already read a list in this chat. To use this file instead, choose "Use a different list" below, then send it again. Nothing was changed.`
        : "I've already read a list in this chat, so I didn't use this file. Nothing was changed.",
      artefact: open,
      state: flowStateOf(run),
      classification: "flow_engine",
    };
  }
  const read = contactListFromFiles(run, files);
  if (read.kind === "unreadable") {
    return {
      kind: "reply",
      text: `${read.text}\n\n${open.text}`,
      artefact: open,
      state: flowStateOf(run),
      classification: "flow_engine",
    };
  }
  return decisionFromOutcome(
    await runFlowStep(deps, {
      run,
      trigger: "answer",
      answer: read.answer,
      ownerText: read.answer.display_text,
      brandName: args.brand!.name,
    }),
  );
}

/**
 * The engine's say at the start of an agent-chat turn. "none" leaves every
 * existing lane exactly as it was (engine off, migration not applied, or not
 * the engine's turn).
 */
export async function decideFlowTurn(
  args: FlowTurnArgs,
): Promise<FlowTurnDecision> {
  if (!args.brand) return { kind: "none" };
  const websiteMode = args.websiteSetup === true;
  const route = args.route ?? flowRouteFromHints(args.message);

  // Readiness answers come from the canonical checklist, no model — but only
  // when the turn's intent route says this is a readiness question (#3355
  // Wave E: the classifier is a hint, the intent read decides).
  if (!args.flowAnswer && !websiteMode && !args.escalate) {
    const action = route.readiness;
    if (action) {
      try {
        const readiness = await readBrandReadiness(
          args.userClient,
          args.brand.id,
          action === "all" ? null : action,
        );
        const answer = buildReadinessAnswer({
          readiness,
          action,
          brandName: args.brand.name,
        });
        return {
          kind: "reply",
          text: answer.text,
          artefact: null,
          state: null,
          classification: "readiness_answer",
        };
      } catch (_error) {
        // READINESS_UNAVAILABLE during the deploy window: the normal lanes answer.
      }
    }
  }

  if (!args.engineEnabled) {
    return args.flowAnswer
      ? { kind: "stale", next: null, state: null }
      : { kind: "none" };
  }
  const store = args.store ?? createFlowStore(args.service, args.userId);
  const deps = {
    store,
    probes: args.probes ?? buildFlowProbeDeps(
      args.userClient,
      args.brand.id,
      args.userId,
      args.conversationId,
      args.research,
    ),
  };
  try {
    const run = await store.getForConversation(args.conversationId);
    const live = run && LIVE_FLOW_STATUSES.has(run.status) ? run : null;
    if (!live) {
      // #2830 — the run left this chat because a teammate took it over: say so
      // once on a plain turn, and always when an old card is answered.
      const taken = await takenOverReply({
        store,
        conversationId: args.conversationId,
        force: args.flowAnswer !== undefined && args.flowAnswer !== null,
      });
      if (taken) return taken;
    }
    if (args.flowAnswer) {
      if (!live && run && isResumeAnswer(run, args.flowAnswer)) {
        return await resumeParkedRun(args, deps, run);
      }
      if (
        args.flowAnswer.choice_id === RESUME_CHOICE &&
        args.flowAnswer.run_id !== live?.id
      ) {
        return await staleResumeReply(args.flowAnswer, store, live);
      }
      // #3355 rework 2 (P2-11): the completion card's follow-up.
      const followUp = await completedRunFollowUp(args, deps, live, run);
      if (followUp) return followUp;
      if (!live) return { kind: "stale", next: null, state: flowStateOf(run) };
      return decisionFromOutcome(
        await runFlowStep(deps, {
          run: live,
          trigger: "answer",
          answer: args.flowAnswer,
          ownerText: args.flowAnswer.display_text,
          brandName: args.brand.name,
        }),
      );
    }
    if (live) {
      // #3355: a contact list attached while the import flow is open.
      const filesTurn = await importFilesTurn(args, deps, live);
      if (filesTurn) return filesTurn;
      const outcome = await runFlowStep(deps, {
        run: live,
        trigger: "turn",
        ownerText: args.message,
        brandName: args.brand.name,
        ...(args.escalate ? { escalate: true } : {}),
        // #3355 Wave E: the intent read's flow_action is primary.
        ...(route.flowAction ? { flowAction: route.flowAction } : {}),
      });
      const website = live.flow_key === WEBSITE_SETUP_FLOW_KEY;
      // #2830 P4: "Start / continue Website setup" points at the open card.
      if (
        website && outcome.kind === "notice" && outcome.unmatched &&
        isWebsiteSetupRequest(args.message)
      ) {
        return resumeWebsiteReply(outcome.run);
      }
      const decision = decisionFromOutcome(outcome);
      if (!website || decision.kind !== "none") return decision;
      // The engine owns this chat's Website setup: anything else is a side
      // question for the normal lanes, never the pre-engine Website job.
      if (isWebsiteSetupRequest(args.message)) {
        return resumeWebsiteReply(live);
      }
      const current = LIVE_FLOW_STATUSES.has(outcome.run.status)
        ? outcome.run
        : live;
      return {
        kind: "side",
        state: flowStateOf(current),
        artefact: current.current_artefact,
      };
    }
    // #3355 Wave E: "carry on with my event setup" typed in chat, read by the
    // model as flow_action resume on this chat's parked run.
    if (
      !live && run && run.status === "parked" && route.resumeParked &&
      !args.escalate
    ) {
      return await resumeParkedRun(args, deps, run);
    }
    if (websiteMode) {
      // A finished Website setup in this chat is not restarted by every
      // message on the Website screen — only by asking for it again.
      if (
        run && run.flow_key === WEBSITE_SETUP_FLOW_KEY &&
        !isWebsiteSetupRequest(args.message)
      ) {
        return { kind: "side", state: flowStateOf(run), artefact: null };
      }
      return await startWebsiteSetup(args, store, deps);
    }
    // #3355 Wave E (D3a, I-ARI-FLOWS-START-BY-TOOL): typed words never start
    // a setup here. The contact-import and offering keyword starts that lived
    // here are hints now; the model starts a setup with start_flow
    // (startFlowFromTool below).
    return { kind: "none" };
  } catch (error) {
    if (
      error instanceof FlowEngineUnavailable || error instanceof FlowConflict
    ) {
      return args.flowAnswer
        ? { kind: "stale", next: null, state: null }
        : { kind: "none" };
    }
    throw error;
  }
}

/** The completed run whose completion card this answer is for, or null. */
async function followUpTarget(
  store: FlowStore,
  conversationId: string,
  answer: FlowAnswer,
): Promise<FlowRun | null> {
  const old = await store.getById(answer.run_id).catch(() => null);
  if (!old || old.conversation_id !== conversationId) return null;
  return followUpOf(old, answer) ? old : null;
}

/**
 * #3355 rework 2 (P2-11, I-ARI-FLOW-COMPLETES-ON-DRAFT) — an answer to the
 * follow-up on a completed run's card; the runner decides what it does
 * (runner.ts followUpAnswer). Another setup open in this chat is never
 * cancelled by a tap on an older card: its own card comes back.
 */
async function completedRunFollowUp(
  args: FlowTurnArgs,
  deps: { store: FlowStore; probes: FlowProbeDeps },
  live: FlowRun | null,
  current: FlowRun | null = null,
): Promise<FlowTurnDecision | null> {
  const answer = args.flowAnswer;
  if (!answer || !args.brand || live?.id === answer.run_id) return null;
  const old = await followUpTarget(deps.store, args.conversationId, answer);
  if (!old) return null;
  // #3355 rework 3 (R3-7): a paused setup in this chat is open too. The old
  // card's "Yes" never cancels it: its Resume card comes back instead.
  const parked = !live && current?.status === "parked" &&
      current.id !== old.id
    ? current
    : null;
  if (parked) {
    const resume = parkArtefact(parked);
    return {
      kind: "reply",
      text:
        `You have another setup paused in this chat. Pick it up again with ${resume.title}, or finish or stop it first, then ask me again.`,
      artefact: resume,
      state: flowStateOf(parked),
      classification: "flow_engine_follow_up",
    };
  }
  if (live) {
    return {
      kind: "reply",
      text: live.current_artefact
        ? `You have another setup open in this chat. Here's where it is:\n\n${live.current_artefact.text}`
        : "You have another setup open in this chat. Finish or stop it first, then ask me again.",
      artefact: live.current_artefact,
      state: flowStateOf(live),
      classification: "flow_engine_follow_up",
    };
  }
  return decisionFromOutcome(
    await runFlowStep(deps, {
      run: old,
      trigger: "answer",
      answer,
      ownerText: answer.display_text,
      brandName: args.brand.name,
    }),
  );
}

/**
 * #3355 Wave E (D3a) — the model called start_flow. The setup starts exactly
 * as the keyword lane used to start it: its facts come from the host's own
 * words (provenance "owner"), every step keeps its server checks, and the
 * first thing it says is one card. The model's prefills are kept as engine
 * hints only. A run already live in this chat is never forked: its card comes
 * back instead.
 */
export async function startFlowFromTool(
  args: FlowTurnArgs & {
    call: {
      flow_key: string;
      intent_text?: string;
      prefills?: Record<string, string | number | boolean>;
    };
  },
): Promise<FlowTurnDecision> {
  if (!args.brand || !args.engineEnabled) return { kind: "none" };
  const def = findFlowDefinition(args.call.flow_key);
  if (!def) return { kind: "none" };
  const store = args.store ?? createFlowStore(args.service, args.userId);
  const deps = {
    store,
    probes: args.probes ?? buildFlowProbeDeps(
      args.userClient,
      args.brand.id,
      args.userId,
      args.conversationId,
      args.research,
    ),
  };
  try {
    const existing = await store.getForConversation(args.conversationId);
    if (existing && LIVE_FLOW_STATUSES.has(existing.status)) {
      const open = existing.current_artefact;
      return {
        kind: "reply",
        text: open
          ? `You already have a setup open in this chat. Here's where it is:\n\n${open.text}`
          : "You already have a setup open in this chat. Finish it, or say stop, before starting another.",
        artefact: open,
        state: flowStateOf(existing),
        classification: "flow_engine_already_open",
      };
    }
    // #3355 Wave F (I-ARI-NO-STALE-RESUME): starting a setup closes this
    // chat's parked run (one open run per chat, migration 20280628013355).
    // The host is told so in the same reply, and the old Resume card answers
    // "that was closed" instead of acting.
    const closedParked = existing?.status === "parked"
      ? parkArtefact(existing).title.replace(/^Resume /, "")
      : null;
    if (def.key === WEBSITE_SETUP_FLOW_KEY) {
      return withParkedClosedNotice(
        await startWebsiteSetup(args, store, deps),
        closedParked,
      );
    }
    // The owner's own words (this turn) are the setup's request.
    const ownerWords = args.message.slice(0, 600);
    const prefills = args.call.prefills ?? {};
    const started = await store.start({
      brandId: args.brand.id,
      flowKey: def.key,
      flowVersion: def.version,
      concurrency: def.concurrency,
      conversationId: args.conversationId,
      answers: def.key === IMPORT_CONTACTS_FLOW_KEY ? {} : {
        intent_text: { value: ownerWords, source: "owner" },
        paid: { value: intentWantsPaid(ownerWords), source: "owner" },
        // #3355 P6: deposits/instalments are the one paid path payouts block.
        ...(def.key === "create_trip" && intentWantsInstallments(ownerWords)
          ? { installments: { value: true, source: "owner" as const } }
          : {}),
        ...(Object.keys(prefills).length > 0
          ? { model_prefills: { value: prefills, source: "engine" as const } }
          : {}),
      },
    });
    const first = await runFlowStep(deps, {
      run: started.run,
      trigger: "turn",
      brandName: args.brand.name,
    });
    // A contact list attached to the same message is read straight away.
    if (def.key === IMPORT_CONTACTS_FLOW_KEY && first.kind === "artefact") {
      const filesTurn = await importFilesTurn(args, deps, first.run);
      if (filesTurn) return withParkedClosedNotice(filesTurn, closedParked);
    }
    return withParkedClosedNotice(decisionFromOutcome(first), closedParked);
  } catch (error) {
    if (
      error instanceof FlowEngineUnavailable || error instanceof FlowConflict
    ) {
      return { kind: "none" };
    }
    throw error;
  }
}

/** #3355 Wave F — the words that say a parked setup was closed. */
export function parkedClosedNotice(noun: string): string {
  return `I closed your paused ${noun} to start this one, so its Resume button won't bring it back.`;
}

/**
 * #3355 Wave F (I-ARI-NO-STALE-RESUME) — a new setup closed this chat's
 * parked run: say so first, whatever the new setup's first move is.
 */
export function withParkedClosedNotice(
  decision: FlowTurnDecision,
  closedNoun: string | null,
): FlowTurnDecision {
  if (!closedNoun) return decision;
  const notice = parkedClosedNotice(closedNoun);
  switch (decision.kind) {
    case "reply":
      return { ...decision, text: `${notice}\n\n${decision.text}` };
    case "propose":
    case "delegate":
      return {
        ...decision,
        ack: decision.ack ? `${notice} ${decision.ack}` : notice,
      };
    default:
      return decision;
  }
}

/**
 * #3355 Wave F (I-ARI-NO-STALE-RESUME) — a Resume tap whose run is no longer
 * this chat's parked run (a new setup closed it, it expired, or another chat
 * moved on): plain words, plus the setup that is open now. Never acts.
 */
async function staleResumeReply(
  answer: FlowAnswer,
  store: FlowStore,
  live: FlowRun | null,
): Promise<Extract<FlowTurnDecision, { kind: "reply" }>> {
  const old = await store.getById(answer.run_id).catch(() => null);
  const noun = old
    ? parkArtefact(old).title.replace(/^Resume /, "")
    : "paused setup";
  const open = live?.current_artefact ?? null;
  return {
    kind: "reply",
    text: open
      ? `That ${noun} was closed, so there's nothing to pick up. Here's the setup that's open now:\n\n${open.text}`
      : `That ${noun} was closed, so there's nothing to pick up. Tell me what you'd like to do and I'll start from here.`,
    artefact: open,
    state: flowStateOf(live),
    classification: "flow_engine_resume_closed",
  };
}

/**
 * #2830 P4 — opening Website setup is a structured request, not owner words.
 * The owner's bubble says only this; the server builds the instruction the
 * pre-engine lane needs (engine off) from the request itself.
 */
export const WEBSITE_SETUP_KICKOFF_DISPLAY = "Set up my Website";

export interface WebsiteSetupKickoff {
  part: PlanPartKey | null;
}

/** Validate `website_setup_kickoff` ({ part?: plan part key }). */
export function parseWebsiteSetupKickoff(
  value: unknown,
): WebsiteSetupKickoff | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => key !== "part")) return null;
  if (raw.part === undefined || raw.part === null) return { part: null };
  const part = PLAN_PARTS.find((candidate) => candidate.key === raw.part);
  return part ? { part: part.key } : null;
}

/**
 * The instruction the turn runs on (never shown, never stored as the owner's
 * words). It starts with "Start Website setup", which the engine reads as
 * the request to start or resume the run.
 */
export function websiteSetupKickoffInstruction(
  kickoff: WebsiteSetupKickoff,
): string {
  const label = kickoff.part
    ? PLAN_PARTS.find((part) => part.key === kickoff.part)?.label ?? null
    : null;
  return `Start Website setup.${
    label ? ` I'm working on ${label}.` : ""
  } Check the live setup plan, tell me what's done and every field gap, then offer Fix all, one gap, or Add it myself. Ask one question at a time. Don't create a draft until setup and brand context are complete.`;
}

const WEBSITE_KICKOFF =
  /^(?:start|continue|resume)\s+(?:the\s+)?website setup\b|^(?:please\s+)?publish\s+(?:my|the|our)\s+website\b|^(?:continue website setup:)|\bfix all\b[^.?!]*website|\breview every remaining website setup gap\b/i;

/** "Start / continue Website setup" and the Website setup screen's buttons. */
export function isWebsiteSetupRequest(message: string): boolean {
  const normalized = message.replace(/\s+/g, " ").trim();
  return WEBSITE_KICKOFF.test(normalized) ||
    detectWebsiteSetupIntent(normalized) !== null;
}

/**
 * #2830 P4: start (or join) the brand's one Website setup run and present its
 * first open part. A teammate's live run is shown view-only by the runner;
 * the owner's own run in another chat is never forked.
 */
async function startWebsiteSetup(
  args: FlowTurnArgs,
  store: FlowStore,
  deps: { store: FlowStore; probes: FlowProbeDeps },
): Promise<FlowTurnDecision> {
  const def = WEBSITE_SETUP_FLOW;
  const started = await store.start({
    brandId: args.brand!.id,
    flowKey: def.key,
    flowVersion: def.version,
    concurrency: def.concurrency,
    conversationId: args.conversationId,
    answers: {},
  });
  const run = started.run;
  if (
    !started.created && !started.owned_by_other &&
    run.conversation_id && run.conversation_id !== args.conversationId
  ) {
    return {
      kind: "reply",
      text:
        "You already have Website setup open in another Ari chat. Pick it up there so your answers stay in one place — nothing was changed.",
      artefact: null,
      state: null,
      classification: "flow_engine",
    };
  }
  const decision = decisionFromOutcome(
    await runFlowStep(deps, {
      run,
      trigger: "turn",
      brandName: args.brand!.name,
    }),
  );
  if (decision.kind === "reply" && started.created) {
    return {
      ...decision,
      text: `Let's set up your Website for ${
        args.brand!.name
      }. I'll go through the plan one part at a time, ask one thing at a time, and save each change only after you approve it.\n\n${decision.text}`,
    };
  }
  if (decision.kind === "none") {
    return resumeWebsiteReply(run);
  }
  return decision;
}

/**
 * #2830 P4 — "start / continue Website setup" on a run that is already open:
 * the current step comes back at the bottom of the chat, with the SAME card
 * (same artefact id), so the owner never has to scroll up for it and an
 * older copy can never be answered twice. No card open (a proposal is
 * waiting for approval, which is already at the bottom): words only.
 */
export function resumeWebsiteReply(run: FlowRun): FlowTurnDecision {
  const live = LIVE_FLOW_STATUSES.has(run.status);
  const artefact = live ? run.current_artefact : null;
  return {
    kind: "reply",
    text: artefact
      ? `Picking up Website setup where we left off.\n\n${artefact.text}`
      : "Picking up Website setup where we left off.",
    artefact,
    state: flowStateOf(run),
    classification: "flow_engine",
  };
}

/** #2830 — the words a displaced person reads. Seth approved these. */
export function takenOverText(name: string): string {
  return `${name} took over Website setup, so that didn't save. Everything you answered before is still there.`;
}

/** #2830 — null when nothing was taken from this chat, or it was already said. */
async function takenOverReply(args: {
  store: FlowStore;
  conversationId: string;
  force: boolean;
}): Promise<FlowTurnDecision | null> {
  if (!args.store.displacement) return null;
  let displaced: FlowDisplacement | null = null;
  try {
    displaced = await args.store.displacement(args.conversationId);
  } catch (error) {
    // Migration not applied yet: carry on as today.
    if (error instanceof FlowEngineUnavailable) return null;
    throw error;
  }
  if (!displaced || (!args.force && displaced.notified_at !== null)) {
    return null;
  }
  if (displaced.notified_at === null) {
    await args.store.markDisplacementNotified?.(displaced.id);
  }
  const run = await args.store.getById(displaced.run_id).catch(() => null);
  return {
    kind: "reply",
    text: takenOverText(displaced.to_name),
    artefact: null,
    state: flowStateOf(run),
    classification: "flow_engine_taken_over",
  };
}

/** #3355 Wave A — the Resume card's answer, for this chat's parked run. */
export function isResumeAnswer(run: FlowRun, answer: FlowAnswer): boolean {
  if (run.status !== "parked" || answer.choice_id !== RESUME_CHOICE) {
    return false;
  }
  const card = parkArtefact(run);
  return answer.run_id === run.id && answer.question_id === card.question_id &&
    answer.step_key === card.step_key;
}

/**
 * #3355 Wave A — Resume: the parked run is live again in this chat and the
 * owner is shown the step they left (the same card id, so it stays the one
 * answerable copy). A run that expired, or a chat that started something
 * else meanwhile, says so in plain words.
 */
async function resumeParkedRun(
  args: FlowTurnArgs,
  deps: { store: FlowStore; probes: FlowProbeDeps },
  parked: FlowRun,
): Promise<FlowTurnDecision> {
  const title = parkArtefact(parked).title.replace(/^Resume /, "");
  if (!deps.store.resume) return { kind: "stale", next: null, state: null };
  const closed = (run: FlowRun | null): FlowTurnDecision => ({
    kind: "reply",
    text:
      `That ${title} was closed, so there's nothing to pick up. Tell me what you'd like to do and I'll start from here.`,
    artefact: null,
    state: flowStateOf(run),
    classification: "flow_engine_resume_closed",
  });
  let run: FlowRun;
  try {
    run = await deps.store.resume(parked.id, args.conversationId);
  } catch (error) {
    if (error instanceof FlowConflict) {
      return closed(await deps.store.getById(parked.id).catch(() => null));
    }
    throw error;
  }
  // Idle past the rule: it expired instead of coming back (A5).
  if (!LIVE_FLOW_STATUSES.has(run.status)) return closed(run);
  const outcome = await runFlowStep(deps, {
    run,
    trigger: "resume",
    brandName: args.brand!.name,
  });
  const decision = decisionFromOutcome(outcome);
  if (decision.kind !== "none") return decision;
  const current = outcome.run;
  const artefact = LIVE_FLOW_STATUSES.has(current.status)
    ? current.current_artefact
    : null;
  return {
    kind: "reply",
    text: artefact
      ? `Okay, back to your ${title}.\n\n${artefact.text}`
      : current.status === "awaiting_approval"
      ? `Okay, back to your ${title}. Your change is waiting on its confirmation card above.`
      : `Okay, back to your ${title}.`,
    artefact,
    state: flowStateOf(current),
    classification: "flow_engine_resumed",
  };
}

/** Pre-claim check: a structured answer to a card that is no longer current. */
export async function staleFlowAnswer(args: {
  store: FlowStore;
  conversationId: string;
  answer: FlowAnswer;
}): Promise<
  {
    next: FlowArtefact | null;
    state: FlowStateView | null;
    taken_over_text?: string;
  } | null
> {
  try {
    const run = await args.store.getForConversation(args.conversationId);
    if (
      run && LIVE_FLOW_STATUSES.has(run.status) &&
      run.id === args.answer.run_id &&
      run.current_question_id === args.answer.question_id &&
      run.current_step_key === args.answer.step_key
    ) return null;
    // #3355 Wave A: the Resume card of this chat's parked run is current.
    if (run && isResumeAnswer(run, args.answer)) return null;
    // #3355 rework 2 (P2-11): a completed run's follow-up card is current
    // while no other setup is live in the chat.
    if (
      !(run && LIVE_FLOW_STATUSES.has(run.status)) &&
      await followUpTarget(args.store, args.conversationId, args.answer)
    ) return null;
    // #3355 Wave F (I-ARI-NO-STALE-RESUME): a Resume card whose run was
    // closed says so in plain words, with the setup that is open now.
    if (args.answer.choice_id === RESUME_CHOICE) {
      const live = run && LIVE_FLOW_STATUSES.has(run.status) ? run : null;
      const closed = await staleResumeReply(args.answer, args.store, live);
      return {
        next: closed.artefact,
        state: closed.state,
        taken_over_text: closed.text,
      };
    }
    if (!run || !LIVE_FLOW_STATUSES.has(run.status)) {
      const taken = await takenOverReply({
        store: args.store,
        conversationId: args.conversationId,
        force: true,
      });
      if (taken?.kind === "reply") {
        return { next: null, state: taken.state, taken_over_text: taken.text };
      }
    }
    return {
      next: run && LIVE_FLOW_STATUSES.has(run.status)
        ? run.current_artefact
        : null,
      state: flowStateOf(run),
    };
  } catch (error) {
    if (error instanceof FlowEngineUnavailable) {
      return { next: null, state: null };
    }
    throw error;
  }
}

/**
 * After a confirmed write (agent-confirm-action) or on resume
 * (agent-turn-control flow_resume): run the chat's live run once.
 */
export async function runFlowForConversation(args: {
  service: SupabaseClient;
  userClient: SupabaseClient;
  userId: string;
  brand: { id: string; name: string };
  conversationId: string;
  trigger: Exclude<RunnerTrigger, "answer" | "turn">;
  confirmed?: { tool_name: string; result: unknown };
  /** #3355 P7 — the confirmed write was refused; nothing was saved. */
  failed?: { tool_name: string; message: string };
  /** #3355 bundle 5 — see RunnerInput.requireStatus. */
  requireStatus?: FlowRun["status"];
  store?: FlowStore;
  /** Test seam: the canonical reads. */
  probes?: FlowProbeDeps;
  /** #2830 — see FlowResearch. */
  research?: FlowResearch;
}): Promise<{ outcome: RunnerOutcome | null; run: FlowRun | null }> {
  const store = args.store ?? createFlowStore(args.service, args.userId);
  try {
    const run = await store.getForConversation(args.conversationId);
    if (!run || !LIVE_FLOW_STATUSES.has(run.status)) {
      return { outcome: null, run };
    }
    const outcome = await runFlowStep({
      store,
      probes: args.probes ?? buildFlowProbeDeps(
        args.userClient,
        args.brand.id,
        args.userId,
        args.conversationId,
        args.research,
      ),
    }, {
      run,
      trigger: args.trigger,
      ...(args.confirmed ? { confirmed: args.confirmed } : {}),
      ...(args.failed ? { failed: args.failed } : {}),
      ...(args.requireStatus ? { requireStatus: args.requireStatus } : {}),
      brandName: args.brand.name,
    });
    return { outcome, run: outcome.run };
  } catch (error) {
    if (
      error instanceof FlowEngineUnavailable || error instanceof FlowConflict
    ) {
      return { outcome: null, run: null };
    }
    throw error;
  }
}

/** Insert one engine-authored assistant row (never a user turn). */
export async function persistFlowRow(args: {
  service: SupabaseClient;
  userId: string;
  conversationId: string;
  text: string;
  artefact: FlowArtefact | null;
  state: FlowStateView | null;
  promptVersion: string;
  modelVersion: string;
}): Promise<string | null> {
  const id = crypto.randomUUID();
  const { error } = await args.service.from("agent_messages").insert({
    id,
    conversation_id: args.conversationId,
    user_id: args.userId,
    role: "assistant",
    content: flowMessageContent(args.text, args.artefact, args.state),
    prompt_version: args.promptVersion,
    model_version: args.modelVersion,
  });
  return error ? null : id;
}

/**
 * #2830 P4 — an engine-generated turn (opening Website setup) is not an
 * owner message: its attempt is stamped `origin = 'engine'` so the daily cap
 * never counts it (migration 20280306003355). Best effort: before that
 * migration the column is missing and the turn simply counts as before.
 */
export async function markEngineOriginTurn(
  service: SupabaseClient,
  userId: string,
  attemptId: string,
): Promise<boolean> {
  try {
    const { error } = await service.from("agent_turn_attempts")
      .update({ origin: "engine" })
      .eq("id", attemptId)
      .eq("user_id", userId);
    return !error;
  } catch (_error) {
    return false;
  }
}

/**
 * #3355 — a side question's answer failed (the model could not finish).
 * The flow is never stranded on an error: the owner gets plain words and
 * the card they were on, at the bottom of the chat.
 */
export function flowSideFailureText(artefact: FlowArtefact | null): string {
  return artefact
    ? `I couldn't answer that just now, and nothing was changed. We're still on ${artefact.title}:\n\n${artefact.text}`
    : "I couldn't answer that just now, and nothing was changed. Your setup is still where we left it.";
}
