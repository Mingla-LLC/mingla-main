import { supabase } from "./supabase";
import {
  buildDraftEvent,
  type DraftEvent,
} from "../store/draftEventStore";
import { draftTicketToTicketTypeInsert } from "./ticketTypeMapper";
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

const EVENT_DRAFT_SELECT =
  "id,brand_id,created_by,title,description,slug,location_text,online_url,cover_media_url,cover_media_type,currency,is_online,is_recurring,is_multi_date,recurrence_rules,theme,visibility,status,timezone,created_at,updated_at,published_at,deleted_at";

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

export const isServerDraftLifecycleError = (
  error: unknown,
): error is ServerDraftLifecycleError =>
  error instanceof ServerDraftLifecycleError ||
  (error !== null &&
    typeof error === "object" &&
    (error as { name?: unknown }).name === "ServerDraftLifecycleError" &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { draftId?: unknown }).draftId === "string");

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

const nullableCurrency = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim().toUpperCase()
    : null;

const fetchBrandDefaultCurrency = async (brandId: string): Promise<string | null> => {
  const { data, error } = await supabase
    .from("brands")
    .select("default_currency")
    .eq("id", brandId)
    .maybeSingle();
  if (error !== null) throw error;
  return nullableCurrency(
    (data as { default_currency?: unknown } | null)?.default_currency,
  );
};

const resolveDraftCurrencyForPublish = async (
  draft: DraftEvent,
  existingCurrency: unknown = null,
): Promise<string> => {
  const localCurrency = nullableCurrency(draft.currency);
  if (localCurrency !== null) return localCurrency;
  const serverCurrency = nullableCurrency(existingCurrency);
  if (serverCurrency !== null) return serverCurrency;
  const brandCurrency = await fetchBrandDefaultCurrency(draft.brandId);
  if (brandCurrency === null) {
    throw new Error("Brand currency is not set. Connect Stripe before publishing paid tickets.");
  }
  return brandCurrency;
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

export const syncDraftTicketsToServerEvent = async (
  draft: DraftEvent,
): Promise<void> => {
  if (draft.tickets.length === 0) {
    throw new Error("Publish requires at least one ticket type.");
  }

  const now = new Date().toISOString();
  // I-MUTATION-ROWCOUNT-WAIVER: ORCH-0763 first sync may have zero existing ticket rows
  const { error: softDeleteError } = await supabase
    .from("ticket_types")
    .update({ deleted_at: now })
    .eq("event_id", draft.id)
    .is("deleted_at", null);

  if (softDeleteError !== null) throw softDeleteError;

  const brandCurrency = await resolveDraftCurrencyForPublish(draft);
  const rows = draft.tickets.map((ticket) =>
    draftTicketToTicketTypeInsert(draft.id, ticket, brandCurrency),
  );
  const { error: insertError } = await supabase.from("ticket_types").insert(rows);

  if (insertError !== null) throw insertError;
};

export const createServerDraft = async (
  brandId: string,
  sourceDraft?: DraftEvent,
): Promise<DraftEvent> => {
  const userId = await requireUserId();
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

  const { data, error } = await supabase
    .from("events")
    .insert(insertPayload)
    .select(EVENT_DRAFT_SELECT)
    .single();

  if (error !== null) throw error;
  return rowToDraft(data);
};

export const fetchDraftsForBrand = async (
  brandId: string,
): Promise<DraftEvent[]> => {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_DRAFT_SELECT)
    .eq("brand_id", brandId)
    .eq("status", "draft")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (error !== null) throw error;
  return (data ?? []).map(rowToDraft);
};

export const fetchDraftById = async (
  draftId: string,
): Promise<DraftEvent | null> => {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_DRAFT_SELECT)
    .eq("id", draftId)
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
  const { data, error } = await supabase
    .from("events")
    .select("status,deleted_at")
    .eq("id", draftId)
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
  const { data, error } = await supabase
    .from("events")
    .select("theme,currency")
    .eq("id", draftId)
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

  const { data, error } = await supabase
    .from("events")
    .update(updatePayload)
    .eq("id", draft.id)
    .eq("status", "draft")
    .is("deleted_at", null)
    .select(EVENT_DRAFT_SELECT)
    .maybeSingle();

  if (error !== null) throw error;
  if (data === null) {
    throw new ServerDraftLifecycleError("draft_not_editable", draft.id);
  }
  return rowToDraft(data);
};

export const discardServerDraft = async (draftId: string): Promise<void> => {
  const { data, error } = await supabase.rpc("business_discard_event_draft", {
    p_event_id: draftId,
  });

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
