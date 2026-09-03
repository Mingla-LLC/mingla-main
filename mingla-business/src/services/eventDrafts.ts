import { supabase } from "./supabase";
import {
  buildDraftEvent,
  type DraftEvent,
} from "../store/draftEventStore";
import { generateEventSlug } from "../utils/eventSlug";
import {
  draftToServerInsert,
  draftToServerUpdate,
  serverRowToDraft,
  type ServerDraftEventRow,
} from "../utils/serverDraftEventMapper";
import {
  BusinessAuthNotReadyError,
  toBusinessAuthNotReadyError,
} from "../utils/authReadiness";

// ORCH-0841: include the post-ORCH-0824 top-level taxonomy + city + geo
// columns so serverRowToDraft sees them on every fetch / autosave round-trip.
// Without these the mapper falls back to empty arrays / null and silently
// deselects the user's party-type / vibe-tag / music-genre picks every 700ms.
// #1022: the three theme override columns ride the same contract. Without them
// the autosave echo replaces the local draft with a projection lacking the
// theme, so a colour set in the wizard is silently deleted roughly one
// round-trip after being picked (A/F-1).
const EVENT_DRAFT_SELECT =
  "id,brand_id,created_by,title,description,slug,location_text,online_url,cover_media_url,cover_media_poster_url,cover_media_type,currency,is_online,is_recurring,is_multi_date,recurrence_rules,theme,visibility,status,timezone,created_at,updated_at,published_at,deleted_at,party_types,vibe_tags,music_genres,city,location_geo,pass_tax,pass_mingla_fee,pass_service_fee,theme_color_override,theme_font_override,theme_animation_override";

export type ServerDraftLifecycleErrorCode =
  | "draft_not_found"
  | "draft_not_editable"
  | "draft_not_readable";

export class ServerDraftLifecycleError extends Error {
  code: ServerDraftLifecycleErrorCode;
  draftId: string;

  constructor(code: ServerDraftLifecycleErrorCode, draftId: string) {
    super(`Server draft is no longer editable: ${code}`);
    this.name = "ServerDraftLifecycleError";
    this.code = code;
    this.draftId = draftId;
  }
}

// Issue #3065 — the RSVP and event draft RPCs both guard writes with an
// optimistic `clientRevision`, and BOTH used to wedge permanently the moment a
// client's counter and the server's diverged: nothing here resynced, the
// counter is persisted in Zustand, and the wizard's `clientRevisionRef` is
// monotonic, so the same losing revision was resent forever. The server half
// of the fix (migration 20270617003065) makes the guard reject only a writer
// that is BEHIND the stored revision. This is the client half: a conflict now
// pulls the authoritative server draft back so the store — and therefore the
// wizard's monotonic ref — adopts the server's revision, and the NEXT edit
// saves. It is a reconcile, never a force-write: if another device really did
// move ahead, its content is what lands in the store.
export class DraftRevisionConflictError extends Error {
  draftId: string;
  serverDraft: DraftEvent | null;

  constructor(draftId: string, serverDraft: DraftEvent | null) {
    super(`Draft revision conflict: ${draftId}`);
    this.name = "DraftRevisionConflictError";
    this.draftId = draftId;
    this.serverDraft = serverDraft;
  }
}

export const isDraftRevisionConflictError = (
  error: unknown,
): error is DraftRevisionConflictError =>
  error instanceof DraftRevisionConflictError ||
  (error !== null &&
    typeof error === "object" &&
    (error as { name?: unknown }).name === "DraftRevisionConflictError" &&
    typeof (error as { draftId?: unknown }).draftId === "string");

// Both draft RPCs raise these, and PostgREST hands them back as PLAIN OBJECTS
// (not Error instances), so match on the shape rather than `instanceof`.
const REVISION_CONFLICT_SIGNALS = [
  "rsvp_revision_conflict",
  "stale_client_revision",
];

const isRevisionConflictResponse = (error: unknown): boolean => {
  if (error === null || typeof error !== "object") return false;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return false;
  return REVISION_CONFLICT_SIGNALS.some((signal) => message.includes(signal));
};

export const isServerDraftLifecycleError = (
  error: unknown,
): error is ServerDraftLifecycleError =>
  error instanceof ServerDraftLifecycleError ||
  (error !== null &&
    typeof error === "object" &&
    (error as { name?: unknown }).name === "ServerDraftLifecycleError" &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { draftId?: unknown }).draftId === "string");

// ORCH-1150 [RSVP event wizard] — RSVP drafts are stored event_type='rsvp'
// from promotion onward (see createServerDraft). Every draft READ/UPDATE that
// previously filtered .eq("event_type","event") must admit 'rsvp' too, or RSVP
// drafts vanish from the Hub list (fetchDraftsForBrand), can't be resolved
// (fetchDraftById), can't autosave (autosaveServerDraft), and can't resolve
// their save context / lifecycle. Trip rows are still excluded (they have their
// own tripsService draft path). This is the discriminator set for the
// universal-authoring draft pipeline (event + RSVP share it).
const DRAFT_EVENT_TYPES = ["event", "rsvp"] as const;

const serverDraftSlug = (): string =>
  generateEventSlug("draft", new Set<string>());

const requireUserId = async (): Promise<string> => {
  const { data, error } = await supabase.auth.getUser();
  if (error !== null) throw toBusinessAuthNotReadyError(error) ?? error;
  const userId = data.user?.id;
  if (typeof userId !== "string" || userId.length === 0) {
    throw new BusinessAuthNotReadyError(
      "auth_not_ready",
      "Finishing sign-in. Try again in a moment.",
    );
  }
  return userId;
};

const rowToDraft = (row: unknown): DraftEvent =>
  serverRowToDraft(row as ServerDraftEventRow);

const createRsvpRequestId = (): string => {
  const maybeCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof maybeCrypto?.randomUUID === "function") return maybeCrypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
};

const eventRowFromDraftRpc = (value: unknown, operation: string): unknown => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${operation}: RPC returned malformed response`);
  }
  const event = (value as { event?: unknown }).event;
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    throw new Error(`${operation}: RPC response missing event`);
  }
  return event;
};

const eventFromRsvpGraph = (value: unknown, operation: string): DraftEvent =>
  rowToDraft(eventRowFromDraftRpc(value, operation));

const nullableCurrency = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim().toUpperCase()
    : null;

const fetchBrandDefaultCurrency = async (brandId: string): Promise<string | null> => {
  const { data, error } = await supabase
    .from("brands")
    .select("default_currency")
    .eq("id", brandId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error !== null) throw error;
  return nullableCurrency(
    (data as { default_currency?: unknown } | null)?.default_currency,
  );
};

const resolveDraftCurrencyForSave = async (
  draft: DraftEvent,
  existingCurrency: unknown = null,
): Promise<string | null> => {
  const localCurrency = nullableCurrency(draft.currency);
  if (localCurrency !== null) return localCurrency;
  const serverCurrency = nullableCurrency(existingCurrency);
  if (serverCurrency !== null) return serverCurrency;
  return fetchBrandDefaultCurrency(draft.brandId);
};

interface DiscardDraftRpcResponse {
  event_id: string;
  brand_id: string;
  deleted_at: string;
}

const asDiscardDraftRpcResponse = (value: unknown): DiscardDraftRpcResponse => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("discardServerDraft: RPC returned malformed response");
  }
  const record = value as Record<string, unknown>;
  const eventId = record.event_id;
  const brandId = record.brand_id;
  const deletedAt = record.deleted_at;
  if (
    typeof eventId !== "string" ||
    typeof brandId !== "string" ||
    typeof deletedAt !== "string"
  ) {
    throw new Error("discardServerDraft: RPC response missing discard fields");
  }
  return { event_id: eventId, brand_id: brandId, deleted_at: deletedAt };
};

export const createServerDraft = async (
  brandId: string,
  sourceDraft?: DraftEvent,
): Promise<DraftEvent> => {
  const userId = await requireUserId();
  // I-BRAND-UNIVERSAL-AUTHORING (META-ORCH-0972) — no kind gate.
  const now = new Date().toISOString();
  const effectiveCurrency =
    nullableCurrency(sourceDraft?.currency) ?? (await fetchBrandDefaultCurrency(brandId));
  const draft =
    sourceDraft !== undefined
      ? { ...sourceDraft, currency: effectiveCurrency }
      : {
          ...buildDraftEvent(brandId, undefined, now),
          currency: effectiveCurrency,
        };
  const legacyLocalDraftId =
    sourceDraft !== undefined && sourceDraft.id.startsWith("d_")
      ? sourceDraft.id
      : null;
  const insertPayload = draftToServerInsert(
    draft,
    userId,
    serverDraftSlug(),
    {},
    legacyLocalDraftId,
  );

  // ORCH-0859 REWORK 3 (events-type-filter audit): explicitly set
  // event_type on the insert payload. DB default is 'event' per
  // information_schema probe so this pin makes the type explicit at the call
  // site.
  // ORCH-1150 [RSVP event wizard] — the lazily-promoted server row MUST carry
  // the RSVP discriminator when the source draft is an RSVP draft (isRsvp:true).
  // Without this the row is 'event', the cover-video pipeline binds to an
  // 'event' row (so RSVP video covers never persist — D-2), and the publish
  // RPC's event_type flip is the ONLY place the row would ever become 'rsvp'.
  // Setting it at draft-promotion realizes SPEC §4.6:401's explicit instruction.
  const eventTypeForInsert: "event" | "rsvp" =
    draft.isRsvp === true ? "rsvp" : "event";
  if (eventTypeForInsert === "rsvp") {
    const { data, error } = await supabase.rpc("business_create_rsvp_draft_graph", {
      p_brand_id: brandId,
      p_payload: insertPayload,
      p_client_request_id: createRsvpRequestId(),
    });
    if (error !== null) throw error;
    return eventFromRsvpGraph(data, "createServerDraft");
  }
  // orch-strict-grep-allow events-type-filter — ORCH-1150 D-2: event_type IS written (event|rsvp) via the eventTypeForInsert variable, not unfiltered; the gate only matches string literals in the payload.
  const { data, error } = await supabase.rpc("business_create_event_draft", {
    p_brand_id: brandId,
    p_payload: insertPayload,
  });

  if (error !== null) throw error;
  return rowToDraft(eventRowFromDraftRpc(data, "createServerDraft"));
};

export const fetchDraftsForBrand = async (
  brandId: string,
): Promise<DraftEvent[]> => {
  // ORCH-0859 REWORK 3 (events-type-filter audit): drafts list.
  // ORCH-1150: include RSVP drafts (DRAFT_EVENT_TYPES) so they don't vanish.
  // orch-strict-grep-allow events-type-filter — ORCH-1150 D-2: RSVP drafts are included via .in("event_type", ["event","rsvp"]); event_type IS filtered (event+rsvp), not unfiltered.
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_DRAFT_SELECT)
    .eq("brand_id", brandId)
    .in("event_type", DRAFT_EVENT_TYPES)
    .eq("status", "draft")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (error !== null) throw error;
  return (data ?? []).map(rowToDraft);
};

export const fetchDraftById = async (
  draftId: string,
): Promise<DraftEvent | null> => {
  // ORCH-0859 REWORK 3 (events-type-filter audit): single draft read.
  // ORCH-1150: include RSVP drafts so resume/edit can resolve them.
  // orch-strict-grep-allow events-type-filter — ORCH-1150 D-2: RSVP drafts are included via .in("event_type", ["event","rsvp"]); event_type IS filtered (event+rsvp), not unfiltered.
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_DRAFT_SELECT)
    .eq("id", draftId)
    .in("event_type", DRAFT_EVENT_TYPES)
    .eq("status", "draft")
    .is("deleted_at", null)
    .maybeSingle();

  if (error !== null) throw error;
  return data === null ? null : rowToDraft(data);
};

interface ExistingDraftSaveContext {
  theme: unknown;
  currency: string | null;
}

const resolveMissingDraftLifecycle = async (
  draftId: string,
): Promise<ServerDraftLifecycleError> => {
  // ORCH-0859 REWORK 3 (events-type-filter audit): lifecycle check is for
  // event + RSVP drafts (DRAFT_EVENT_TYPES). Trip-draft lifecycle is handled by
  // tripsService. ORCH-1150: RSVP drafts must resolve their lifecycle too.
  // orch-strict-grep-allow events-type-filter — ORCH-1150 D-2: RSVP drafts are included via .in("event_type", ["event","rsvp"]); event_type IS filtered (event+rsvp), not unfiltered.
  const { data, error } = await supabase
    .from("events")
    .select("status,deleted_at")
    .eq("id", draftId)
    .in("event_type", DRAFT_EVENT_TYPES)
    .maybeSingle();

  if (error !== null) throw error;
  const row = data as { status?: unknown; deleted_at?: unknown } | null;
  if (row === null) {
    return new ServerDraftLifecycleError("draft_not_found", draftId);
  }
  if (row.status !== "draft" || row.deleted_at !== null) {
    return new ServerDraftLifecycleError("draft_not_editable", draftId);
  }
  return new ServerDraftLifecycleError("draft_not_readable", draftId);
};

const fetchExistingDraftSaveContext = async (
  draftId: string,
): Promise<ExistingDraftSaveContext> => {
  // ORCH-0859 REWORK 3 (events-type-filter audit): draft save context.
  // ORCH-1150: include RSVP drafts so their autosave can resolve theme/currency.
  // orch-strict-grep-allow events-type-filter — ORCH-1150 D-2: RSVP drafts are included via .in("event_type", ["event","rsvp"]); event_type IS filtered (event+rsvp), not unfiltered.
  const { data, error } = await supabase
    .from("events")
    .select("theme,currency")
    .eq("id", draftId)
    .in("event_type", DRAFT_EVENT_TYPES)
    .eq("status", "draft")
    .is("deleted_at", null)
    .maybeSingle();

  if (error !== null) throw error;
  if (data === null) throw await resolveMissingDraftLifecycle(draftId);
  const row = data as { theme?: unknown; currency?: unknown } | null;
  return {
    theme: row?.theme ?? {},
    currency: nullableCurrency(row?.currency),
  };
};

// Issue #3065 — turn a revision conflict into a RECONCILE. Pulls the
// authoritative server draft so the caller can adopt it; a fetch failure
// degrades to a conflict with no draft rather than masking the conflict.
const toRevisionConflictError = async (
  error: unknown,
  draftId: string,
): Promise<unknown> => {
  if (!isRevisionConflictResponse(error)) return error;
  let serverDraft: DraftEvent | null = null;
  try {
    serverDraft = await fetchDraftById(draftId);
  } catch {
    serverDraft = null;
  }
  return new DraftRevisionConflictError(draftId, serverDraft);
};

export const autosaveServerDraft = async (
  draft: DraftEvent,
): Promise<DraftEvent> => {
  const existing = await fetchExistingDraftSaveContext(draft.id);
  const effectiveCurrency = await resolveDraftCurrencyForSave(draft, existing.currency);
  const normalizedDraft = { ...draft, currency: effectiveCurrency };
  const updatePayload = draftToServerUpdate(
    normalizedDraft,
    existing.theme,
    draft.clientRevision ?? 0,
  );

  if (draft.isRsvp === true) {
    const { data, error } = await supabase.rpc("business_update_rsvp_graph", {
      p_event_id: draft.id,
      p_payload: {
        ...updatePayload,
        __expectedClientRevision: draft.clientRevision ?? 0,
      },
      p_reason: null,
      p_client_request_id: createRsvpRequestId(),
    });
    if (error !== null) throw await toRevisionConflictError(error, draft.id);
    return eventFromRsvpGraph(data, "autosaveServerDraft");
  }

  // ORCH-0859 REWORK 3 (events-type-filter audit): draft UPDATE must not
  // accidentally write to a trip row that shares an id space.
  // ORCH-1150: include RSVP drafts (DRAFT_EVENT_TYPES) so RSVP autosave persists.
  // orch-strict-grep-allow events-type-filter — ORCH-1150 D-2: RSVP-draft UPDATE is scoped via .in("event_type", ["event","rsvp"]); event_type IS filtered (event+rsvp), not unfiltered.
  const { data, error } = await supabase.rpc("business_update_event_draft", {
    p_event_id: draft.id,
    p_payload: updatePayload,
    p_client_revision: draft.clientRevision ?? 0,
  });

  if (error !== null) throw await toRevisionConflictError(error, draft.id);
  if (data === null) {
    throw new ServerDraftLifecycleError("draft_not_editable", draft.id);
  }
  return rowToDraft(eventRowFromDraftRpc(data, "autosaveServerDraft"));
};

export const discardServerDraft = async (draftId: string): Promise<void> => {
  // orch-strict-grep-allow events-type-filter — #1977 canonical discard must read
  // both event and RSVP drafts; the adjacent DRAFT_EVENT_TYPES filter is exact.
  const { data: row, error: readError } = await supabase
    .from("events")
    .select("event_type")
    .eq("id", draftId)
    .in("event_type", DRAFT_EVENT_TYPES)
    .eq("status", "draft")
    .is("deleted_at", null)
    .maybeSingle();
  if (readError !== null) throw readError;
  if (row === null) throw await resolveMissingDraftLifecycle(draftId);
  const isRsvp = (row as { event_type?: unknown }).event_type === "rsvp";
  const { data, error } = await supabase.rpc(
    isRsvp ? "business_discard_rsvp_draft" : "business_discard_event_draft",
    {
    p_event_id: draftId,
      ...(isRsvp ? { p_client_request_id: createRsvpRequestId() } : {}),
    },
  );

  if (error !== null) {
    const message = error.message;
    if (message.includes("event_draft_not_found")) {
      throw new ServerDraftLifecycleError("draft_not_found", draftId);
    }
    if (message.includes("event_draft_not_discardable")) {
      throw new ServerDraftLifecycleError("draft_not_editable", draftId);
    }
    throw error;
  }
  asDiscardDraftRpcResponse(data);
};

export const markServerDraftPublished = async (
  draft: DraftEvent,
): Promise<void> => {
  void draft;
  throw new Error(
    "Client-side draft promotion is disabled. Use business_publish_event_draft RPC.",
  );
};
