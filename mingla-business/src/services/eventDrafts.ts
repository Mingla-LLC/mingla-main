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

const EVENT_DRAFT_SELECT =
  "id,brand_id,created_by,title,description,slug,location_text,online_url,cover_media_url,cover_media_type,is_online,is_recurring,is_multi_date,recurrence_rules,theme,visibility,status,timezone,created_at,updated_at,published_at,deleted_at";

const serverDraftSlug = (): string =>
  generateEventSlug("draft", new Set<string>());

const requireUserId = async (): Promise<string> => {
  const { data, error } = await supabase.auth.getUser();
  if (error !== null) throw error;
  const userId = data.user?.id;
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("Sign in before editing event drafts.");
  }
  return userId;
};

const rowToDraft = (row: unknown): DraftEvent =>
  serverRowToDraft(row as ServerDraftEventRow);

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
  const { error: softDeleteError } = await supabase
    .from("ticket_types")
    .update({ deleted_at: now })
    .eq("event_id", draft.id)
    .is("deleted_at", null);

  if (softDeleteError !== null) throw softDeleteError;

  const rows = draft.tickets.map((ticket) =>
    draftTicketToTicketTypeInsert(draft.id, ticket),
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
  const draft = sourceDraft ?? buildDraftEvent(brandId, undefined, now);
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

const fetchExistingTheme = async (draftId: string): Promise<unknown> => {
  const { data, error } = await supabase
    .from("events")
    .select("theme")
    .eq("id", draftId)
    .is("deleted_at", null)
    .single();

  if (error !== null) throw error;
  return (data as { theme?: unknown } | null)?.theme ?? {};
};

export const autosaveServerDraft = async (
  draft: DraftEvent,
): Promise<DraftEvent> => {
  const existingTheme = await fetchExistingTheme(draft.id);
  const updatePayload = draftToServerUpdate(
    draft,
    existingTheme,
    draft.clientRevision ?? 0,
  );

  const { data, error } = await supabase
    .from("events")
    .update(updatePayload)
    .eq("id", draft.id)
    .eq("status", "draft")
    .is("deleted_at", null)
    .select(EVENT_DRAFT_SELECT)
    .single();

  if (error !== null) throw error;
  return rowToDraft(data);
};

export const discardServerDraft = async (draftId: string): Promise<void> => {
  const { data, error } = await supabase.rpc("business_discard_event_draft", {
    p_event_id: draftId,
  });

  if (error !== null) throw error;
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
