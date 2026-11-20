/**
 * #4514 — the host side of brand forms: one service over the wave 1 RPCs and
 * the three tables hosts may read (`brand_forms`, `brand_form_versions`,
 * `brand_form_attachments`, readable from marketing manager up by RLS).
 *
 * Every write is a SECURITY DEFINER RPC (`biz_brand_form_*`). Services throw:
 * a failure never comes back as null or an empty list. Every error is a
 * `BrandFormsError` with a stable `code` and a message that is safe to show.
 *
 * `./supabase` is loaded on use, never at module scope (it pulls
 * AsyncStorage and expo modules, which breaks dormant render suites).
 */

import type { IntakeQuestionType } from "./intakeSchemaService";
import {
  BRAND_FORM_SCHEMA,
  type BrandFormDefinition,
  type BrandFormOptionDef,
  type BrandFormQuestionDef,
} from "../utils/brandFormDefinition";

export type BrandFormStatus = "draft" | "live" | "closed" | "archived";
export type BrandFormMode = "optional_on_page" | "required_step" | "after_purchase";
export type BrandFormResponsesFilter = "all" | "earlier_version";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type BrandFormsErrorCode =
  | "form_draft_conflict"
  | "attachment_conflict"
  | "forbidden"
  | "not_found"
  | "form_archived"
  | "form_not_live"
  | "form_not_closed"
  | "form_attached"
  | "no_questions"
  | "name_invalid"
  | "invalid_definition"
  | "mode_invalid"
  | "trip_uses_intake"
  | "network_error"
  | "invalid_response"
  | "unknown";

export class BrandFormsError extends Error {
  public readonly code: BrandFormsErrorCode;
  /** The raw server reason, for logs only. */
  public readonly detail: string | null;
  /** The server's current draft revision, on a stale draft write. */
  public readonly currentDraftRev: number | null;
  /** The attachment the server holds now, on a stale attach. */
  public readonly currentAttachmentId: string | null;

  public constructor(
    code: BrandFormsErrorCode,
    message: string,
    detail: string | null = null,
    extra: { currentDraftRev?: number | null; currentAttachmentId?: string | null } = {},
  ) {
    super(message);
    this.name = "BrandFormsError";
    this.code = code;
    this.detail = detail;
    this.currentDraftRev = extra.currentDraftRev ?? null;
    this.currentAttachmentId = extra.currentAttachmentId ?? null;
  }
}

export const STALE_DRAFT_MESSAGE = "Someone else changed this form. Reload.";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const DEFINITION_ERROR_COPY: Record<string, string> = {
  too_many_questions: "A form can have at most 20 questions.",
  too_many_door_questions: "A form can show at most 3 questions at the door.",
  door_type_not_allowed: "Long text answers are too long to show at the door.",
  door_label_invalid: "The label at the door can be 1 to 16 characters.",
  help_invalid: "Help text can be up to 300 characters.",
  label_invalid: "Every question needs a question, up to 200 characters.",
  options_count: "A choice needs 2 to 10 options.",
  option_invalid: "Each option needs 1 to 80 characters.",
  show_if_not_earlier: "A question can only depend on an earlier question.",
  show_if_not_single_choice: "A question can only depend on a single-choice question.",
  show_if_too_deep: "A question cannot depend on a question that already depends on another.",
  show_if_unknown_option: "A \"Show only if\" points at an option that no longer exists.",
  show_if_unknown_question: "A \"Show only if\" points at a question that no longer exists.",
  file_upload_unavailable: "File upload questions are coming later.",
  title_invalid: "The form title is too long.",
  intro_invalid: "The intro can be up to 500 characters.",
  no_questions: "Add at least one question before publishing.",
};

const firstDefinitionCode = (detail: string | null): string | null => {
  if (detail === null) return null;
  try {
    const parsed: unknown = JSON.parse(detail);
    if (Array.isArray(parsed)) {
      const first: unknown = parsed[0];
      if (isRecord(first) && typeof first.code === "string") return first.code;
    }
  } catch {
    // A detail that is not JSON just falls through to the generic message.
  }
  return null;
};

const parseDetailObject = (detail: string | null): Record<string, unknown> | null => {
  if (detail === null) return null;
  try {
    const parsed: unknown = JSON.parse(detail);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** The one place a PostgREST / fetch failure becomes a BrandFormsError. */
export function mapBrandFormsError(error: unknown, fallbackMessage: string): BrandFormsError {
  if (error instanceof BrandFormsError) return error;
  const raw = isRecord(error) ? error : {};
  const message = typeof raw.message === "string" ? raw.message : error instanceof Error ? error.message : "";
  const sqlState = typeof raw.code === "string" ? raw.code : "";
  const detail = typeof raw.details === "string" && raw.details.length > 0 ? raw.details : null;
  const reason = message.trim();

  if (reason === "form_draft_conflict" || (sqlState === "PT409" && reason.startsWith("form_"))) {
    const rev = parseDetailObject(detail)?.draftRev;
    return new BrandFormsError("form_draft_conflict", STALE_DRAFT_MESSAGE, reason, {
      currentDraftRev: typeof rev === "number" ? rev : null,
    });
  }
  if (reason === "attachment_conflict" || sqlState === "PT409") {
    const id = parseDetailObject(detail)?.attachmentId;
    return new BrandFormsError(
      "attachment_conflict",
      "Someone else changed the questions on this page. Reload.",
      reason,
      { currentAttachmentId: typeof id === "string" ? id : null },
    );
  }
  if (reason === "brand_form_forbidden" || sqlState === "42501") {
    return new BrandFormsError("forbidden", "Your role doesn't include this action. Ask an event manager or above.", reason);
  }
  if (sqlState === "P0002" || reason === "form_not_found" || reason === "event_not_found" || reason === "attachment_not_found" || reason === "brand_not_found") {
    return new BrandFormsError("not_found", "We couldn't find that form. It may have been removed.", reason);
  }
  switch (reason) {
    case "form_archived":
      return new BrandFormsError("form_archived", "This form is archived.", reason);
    case "form_not_live":
      return new BrandFormsError("form_not_live", "Only a live form can be closed.", reason);
    case "form_not_closed":
      return new BrandFormsError("form_not_closed", "Only a closed form can be reopened.", reason);
    case "form_attached":
      return new BrandFormsError(
        "form_attached",
        "This form is still on a page. Remove it from its pages first.",
        reason,
      );
    case "name_invalid":
      return new BrandFormsError("name_invalid", "A form name needs 2 to 80 characters.", reason);
    case "mode_invalid":
      return new BrandFormsError("mode_invalid", "Pick when guests answer.", reason);
    case "trip_uses_intake":
      return new BrandFormsError(
        "trip_uses_intake",
        "Trips keep their own questions step for now. Choose \"After they purchase\".",
        reason,
      );
    case "invalid_definition": {
      const code = firstDefinitionCode(detail);
      if (code === "no_questions") {
        return new BrandFormsError("no_questions", DEFINITION_ERROR_COPY.no_questions, reason);
      }
      return new BrandFormsError(
        "invalid_definition",
        (code !== null ? DEFINITION_ERROR_COPY[code] : undefined) ?? "Some questions are not valid yet. Check each one.",
        detail ?? reason,
      );
    }
    default:
      break;
  }
  const looksOffline = /network|fetch|timeout|offline|failed to fetch/i.test(message);
  if (looksOffline) {
    return new BrandFormsError("network_error", "You look offline. Check your connection and try again.", message);
  }
  return new BrandFormsError("unknown", fallbackMessage, message.length > 0 ? message : null);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrandFormRow {
  id: string;
  brandId: string;
  name: string;
  status: BrandFormStatus;
  draft: BrandFormDefinition;
  draftRev: number;
  liveVersionId: string | null;
  doorFullAnswers: boolean;
  updatedAt: string;
  closedAt: string | null;
}

export interface BrandFormAttachment {
  id: string;
  formId: string;
  eventId: string;
  mode: BrandFormMode;
  autoRemind: boolean;
  /** The automatic reminder's stored channels (text, email; push waits for the Explorer form screen). */
  autoRemindChannels: Array<"sms" | "email">;
  eventName: string | null;
  eventType: string | null;
}

export interface BrandFormListItem {
  form: BrandFormRow;
  questionCount: number;
  /** The live version number, or null while the form is a draft. */
  version: number | null;
  attachments: BrandFormAttachment[];
}

export interface BrandFormDetail {
  form: BrandFormRow;
  /** Latest published version number, or null. */
  version: number | null;
  /** The published definition, to tell "unpublished changes" from a clean draft. */
  published: BrandFormDefinition | null;
  attachments: BrandFormAttachment[];
}

export interface BrandFormResponseRow {
  responseId: string;
  versionId: string;
  version: number;
  earlierVersion: boolean;
  answers: Record<string, unknown>;
  source: string;
  verified: boolean;
  viaLink: boolean;
  editCount: number;
  submittedAt: string;
  updatedAt: string;
  subject: { kind: string; id: string | null; name: string | null };
  /** Wave 3: a signed-in answer's RSVP and orders at this page (null without a page). */
  holder: { rsvpId: string | null; orderIds: string[] } | null;
}

export interface BrandFormNotAnswered {
  kind: string;
  id: string;
  name: string | null;
  addedByHost: boolean;
}

export interface BrandFormVersionDef {
  version: number;
  definition: BrandFormDefinition;
}

export interface BrandFormResponsesPage {
  form: {
    id: string;
    name: string;
    status: BrandFormStatus;
    liveVersionId: string | null;
    doorFullAnswers: boolean;
  };
  mode: BrandFormMode | null;
  versions: Record<string, BrandFormVersionDef>;
  total: number;
  /** {questionId: {optionId: n}} */
  counts: Record<string, Record<string, number>>;
  rows: BrandFormResponseRow[];
  /** Empty when no page was named. */
  notAnswered: BrandFormNotAnswered[];
}

export interface BrandFormExportColumn {
  key: string;
  version: number;
  questionId: string;
  label: string;
  type: string;
}

export interface BrandFormExportRow {
  responseId: string;
  version: number;
  submittedAt: string;
  updatedAt: string;
  verified: boolean;
  values: Record<string, string>;
}

export interface BrandFormExport {
  columns: BrandFormExportColumn[];
  rows: BrandFormExportRow[];
}

// ---------------------------------------------------------------------------
// Parsing (runtime guards: a malformed payload throws, it never returns [])
// ---------------------------------------------------------------------------

const bad = (what: string): BrandFormsError =>
  new BrandFormsError("invalid_response", "We couldn't read the answer from the server. Try again.", what);

const str = (value: unknown, what: string): string => {
  if (typeof value !== "string") throw bad(what);
  return value;
};
const strOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown, what: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw bad(what);
  return value;
};
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);
const rec = (value: unknown, what: string): Record<string, unknown> => {
  if (!isRecord(value)) throw bad(what);
  return value;
};
const arr = (value: unknown, what: string): unknown[] => {
  if (!Array.isArray(value)) throw bad(what);
  return value;
};

const STATUSES: readonly BrandFormStatus[] = ["draft", "live", "closed", "archived"];
const MODES: readonly BrandFormMode[] = ["optional_on_page", "required_step", "after_purchase"];

const parseStatus = (value: unknown): BrandFormStatus => {
  const s = str(value, "status");
  const found = STATUSES.find((x) => x === s);
  if (found === undefined) throw bad("status");
  return found;
};

export const parseMode = (value: unknown): BrandFormMode => {
  const s = str(value, "mode");
  const found = MODES.find((x) => x === s);
  if (found === undefined) throw bad("mode");
  return found;
};

const QUESTION_TYPES: readonly IntakeQuestionType[] = [
  "short_text",
  "long_text",
  "number",
  "date",
  "single_choice",
  "multi_choice",
  "file_upload",
];

const parseQuestion = (value: unknown, what: string): BrandFormQuestionDef => {
  const q = rec(value, what);
  const typeText = str(q.type, `${what}.type`);
  const type = QUESTION_TYPES.find((t) => t === typeText);
  if (type === undefined) throw bad(`${what}.type`);
  const out: BrandFormQuestionDef = {
    id: str(q.id, `${what}.id`),
    position: num(q.position, `${what}.position`),
    type,
    label: str(q.label, `${what}.label`),
    required: bool(q.required, false),
  };
  if (typeof q.help === "string") out.help = q.help;
  if (Array.isArray(q.options)) {
    out.options = q.options.map((o): BrandFormOptionDef => {
      const opt = rec(o, `${what}.options[]`);
      return { id: str(opt.id, `${what}.options.id`), label: str(opt.label, `${what}.options.label`) };
    });
  }
  if (isRecord(q.show_if)) {
    out.show_if = {
      question_id: str(q.show_if.question_id, `${what}.show_if.question_id`),
      option_id: str(q.show_if.option_id, `${what}.show_if.option_id`),
    };
  }
  if (q.show_at_door === true) out.show_at_door = true;
  if (typeof q.door_label === "string") out.door_label = q.door_label;
  return out;
};

const parseDefinition = (value: unknown, what: string): BrandFormDefinition => {
  const def = rec(value, what);
  const questions = arr(def.questions, `${what}.questions`).map((q) => parseQuestion(q, `${what}.questions[]`));
  const out: BrandFormDefinition = {
    schema: BRAND_FORM_SCHEMA,
    title: typeof def.title === "string" ? def.title : "",
    questions,
  };
  if (typeof def.intro === "string" && def.intro.length > 0) out.intro = def.intro;
  return out;
};

const parseFormRow = (value: unknown): BrandFormRow => {
  const r = rec(value, "form");
  return {
    id: str(r.id, "form.id"),
    brandId: str(r.brand_id, "form.brand_id"),
    name: str(r.name, "form.name"),
    status: parseStatus(r.status),
    draft: parseDefinition(r.draft, "form.draft"),
    draftRev: num(r.draft_rev, "form.draft_rev"),
    liveVersionId: strOrNull(r.live_version_id),
    doorFullAnswers: bool(r.door_full_answers, true),
    updatedAt: str(r.updated_at, "form.updated_at"),
    closedAt: strOrNull(r.closed_at),
  };
};

const parseAttachment = (
  value: unknown,
  eventNames: ReadonlyMap<string, { name: string | null; type: string | null }>,
): BrandFormAttachment => {
  const r = rec(value, "attachment");
  const eventId = str(r.event_id, "attachment.event_id");
  const ev = eventNames.get(eventId);
  return {
    id: str(r.id, "attachment.id"),
    formId: str(r.form_id, "attachment.form_id"),
    eventId,
    mode: parseMode(r.mode),
    autoRemind: bool(r.auto_remind, false),
    autoRemindChannels: contactChannels(r.auto_remind_channels),
    eventName: ev?.name ?? null,
    eventType: ev?.type ?? null,
  };
};

const FORM_COLUMNS =
  "id, brand_id, name, status, draft, draft_rev, live_version_id, door_full_answers, updated_at, closed_at";
const ATTACHMENT_COLUMNS = "id, form_id, event_id, mode, auto_remind, auto_remind_channels";

/** Stored reminder channels, push dropped (it waits for the Explorer form screen). */
const contactChannels = (value: unknown): Array<"sms" | "email"> =>
  Array.isArray(value) ? value.filter((c): c is "sms" | "email" => c === "sms" || c === "email") : [];

const getSupabase = async () => (await import("./supabase")).supabase;

const failFrom = (error: unknown, fallback: string): never => {
  throw mapBrandFormsError(error, fallback);
};

async function fetchEventNames(
  eventIds: readonly string[],
): Promise<Map<string, { name: string | null; type: string | null }>> {
  const out = new Map<string, { name: string | null; type: string | null }>();
  if (eventIds.length === 0) return out;
  const supabase = await getSupabase();
  const { data, error } = await supabase
    // orch-strict-grep-allow events-type-filter — #4514: reads only the name and kind of events a form is attached to; a form attaches to any offering kind (RSVP, event, experience, trip) by design.
    .from("events")
    .select("id, name, event_type")
    .in("id", [...eventIds]);
  if (error !== null) return failFrom(error, "Couldn't load the pages this form is on. Try again.");
  for (const row of (data ?? []) as unknown[]) {
    if (!isRecord(row) || typeof row.id !== "string") continue;
    out.set(row.id, { name: strOrNull(row.name), type: strOrNull(row.event_type) });
  }
  return out;
}

async function fetchActiveAttachments(
  filter: { formIds: readonly string[] } | { eventId: string },
): Promise<BrandFormAttachment[]> {
  const supabase = await getSupabase();
  const base = supabase
    .from("brand_form_attachments")
    .select(ATTACHMENT_COLUMNS)
    .is("detached_at", null);
  const { data, error } =
    "eventId" in filter
      ? await base.eq("event_id", filter.eventId)
      : await base.in("form_id", [...filter.formIds]);
  if (error !== null) return failFrom(error, "Couldn't load where this form is used. Try again.");
  const rows = (data ?? []) as unknown[];
  const eventIds = rows
    .map((r) => (isRecord(r) && typeof r.event_id === "string" ? r.event_id : null))
    .filter((id): id is string => id !== null);
  const names = await fetchEventNames([...new Set(eventIds)]);
  return rows.map((r) => parseAttachment(r, names));
}

async function fetchVersionNumbers(formIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (formIds.length === 0) return out;
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("brand_form_versions")
    .select("form_id, version")
    .in("form_id", [...formIds]);
  if (error !== null) return failFrom(error, "Couldn't load the form versions. Try again.");
  for (const row of (data ?? []) as unknown[]) {
    if (!isRecord(row)) continue;
    const formId = row.form_id;
    const version = row.version;
    if (typeof formId !== "string" || typeof version !== "number") continue;
    out.set(formId, Math.max(out.get(formId) ?? 0, version));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Every form of a brand (archived ones are left out), newest change first. */
export async function fetchBrandForms(brandId: string): Promise<BrandFormListItem[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("brand_forms")
    .select(FORM_COLUMNS)
    .eq("brand_id", brandId)
    .neq("status", "archived")
    .order("updated_at", { ascending: false });
  if (error !== null) return failFrom(error, "Couldn't load your forms. Try again.");
  const forms = ((data ?? []) as unknown[]).map(parseFormRow);
  const ids = forms.map((f) => f.id);
  const [attachments, versions] = await Promise.all([
    ids.length > 0 ? fetchActiveAttachments({ formIds: ids }) : Promise.resolve<BrandFormAttachment[]>([]),
    fetchVersionNumbers(ids),
  ]);
  return forms.map((form) => ({
    form,
    questionCount: form.draft.questions.length,
    version: form.liveVersionId === null ? null : versions.get(form.id) ?? null,
    attachments: attachments.filter((a) => a.formId === form.id),
  }));
}

export async function fetchBrandForm(formId: string): Promise<BrandFormDetail> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("brand_forms")
    .select(FORM_COLUMNS)
    .eq("id", formId)
    .maybeSingle();
  if (error !== null) return failFrom(error, "Couldn't load this form. Try again.");
  if (data === null) throw new BrandFormsError("not_found", "We couldn't find that form. It may have been removed.", "form_not_found");
  const form = parseFormRow(data);
  const [attachments, latest] = await Promise.all([
    fetchActiveAttachments({ formIds: [formId] }),
    supabase
      .from("brand_form_versions")
      .select("version, definition")
      .eq("form_id", formId)
      .order("version", { ascending: false })
      .limit(1),
  ]);
  if (latest.error !== null) return failFrom(latest.error, "Couldn't load this form. Try again.");
  const top: unknown = ((latest.data ?? []) as unknown[])[0];
  let version: number | null = null;
  let published: BrandFormDefinition | null = null;
  if (isRecord(top)) {
    version = num(top.version, "version.version");
    published = parseDefinition(top.definition, "version.definition");
  }
  return { form, version, published, attachments };
}

/** The active attachment on one page (event, experience, trip or RSVP), or null. */
export async function fetchEventAttachment(
  eventId: string,
): Promise<{ attachment: BrandFormAttachment; form: BrandFormRow } | null> {
  const attachments = await fetchActiveAttachments({ eventId });
  const attachment = attachments[0];
  if (attachment === undefined) return null;
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("brand_forms")
    .select(FORM_COLUMNS)
    .eq("id", attachment.formId)
    .maybeSingle();
  if (error !== null) return failFrom(error, "Couldn't load this page's form. Try again.");
  if (data === null) throw new BrandFormsError("not_found", "We couldn't find that form. It may have been removed.", "form_not_found");
  return { attachment, form: parseFormRow(data) };
}

const parseCounts = (value: unknown): Record<string, Record<string, number>> => {
  const out: Record<string, Record<string, number>> = {};
  if (!isRecord(value)) return out;
  for (const [qid, opts] of Object.entries(value)) {
    if (!isRecord(opts)) continue;
    const inner: Record<string, number> = {};
    for (const [oid, n] of Object.entries(opts)) {
      if (typeof n === "number") inner[oid] = n;
    }
    out[qid] = inner;
  }
  return out;
};

const parseResponseRow = (value: unknown): BrandFormResponseRow => {
  const r = rec(value, "row");
  const subject = rec(r.subject, "row.subject");
  return {
    responseId: str(r.responseId, "row.responseId"),
    versionId: str(r.versionId, "row.versionId"),
    version: num(r.version, "row.version"),
    earlierVersion: bool(r.earlierVersion, false),
    answers: isRecord(r.answers) ? r.answers : {},
    source: typeof r.source === "string" ? r.source : "page",
    verified: bool(r.verified, true),
    viaLink: bool(r.viaLink, false),
    editCount: typeof r.editCount === "number" ? r.editCount : 0,
    submittedAt: str(r.submittedAt, "row.submittedAt"),
    updatedAt: str(r.updatedAt, "row.updatedAt"),
    subject: {
      kind: str(subject.kind, "row.subject.kind"),
      id: strOrNull(subject.id),
      name: strOrNull(subject.name),
    },
    holder: isRecord(r.holder)
      ? {
        rsvpId: strOrNull(r.holder.rsvpId),
        orderIds: Array.isArray(r.holder.orderIds)
          ? r.holder.orderIds.filter((x): x is string => typeof x === "string")
          : [],
      }
      : null,
  };
};

export interface FetchResponsesInput {
  formId: string;
  eventId: string | null;
  filter: BrandFormResponsesFilter;
  limit?: number;
  offset?: number;
}

export async function fetchBrandFormResponses(input: FetchResponsesInput): Promise<BrandFormResponsesPage> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("biz_brand_form_responses", {
    p_form_id: input.formId,
    p_event_id: input.eventId,
    p_filter: input.filter,
    p_limit: input.limit ?? 50,
    p_offset: input.offset ?? 0,
  });
  if (error !== null) return failFrom(error, "Couldn't load the answers. Try again.");
  const root = rec(data, "responses");
  const form = rec(root.form, "responses.form");
  const versionsRaw = rec(root.versions, "responses.versions");
  const versions: Record<string, BrandFormVersionDef> = {};
  for (const [id, v] of Object.entries(versionsRaw)) {
    const vr = rec(v, "responses.versions[]");
    versions[id] = {
      version: num(vr.version, "version.version"),
      definition: parseDefinition(vr.definition, "version.definition"),
    };
  }
  return {
    form: {
      id: str(form.id, "form.id"),
      name: str(form.name, "form.name"),
      status: parseStatus(form.status),
      liveVersionId: strOrNull(form.liveVersionId),
      doorFullAnswers: bool(form.doorFullAnswers, true),
    },
    mode: root.mode === null || root.mode === undefined ? null : parseMode(root.mode),
    versions,
    total: num(root.total, "responses.total"),
    counts: parseCounts(root.counts),
    rows: arr(root.rows, "responses.rows").map(parseResponseRow),
    notAnswered: arr(root.notAnswered, "responses.notAnswered").map((n): BrandFormNotAnswered => {
      const r = rec(n, "notAnswered[]");
      return {
        kind: str(r.kind, "notAnswered.kind"),
        id: str(r.id, "notAnswered.id"),
        name: strOrNull(r.name),
        addedByHost: bool(r.addedByHost, false),
      };
    }),
  };
}

/** The answers feed (event manager and up). One column per question and version. */
export async function fetchBrandFormExport(formId: string, eventId: string): Promise<BrandFormExport> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("biz_brand_form_responses_export", {
    p_form_id: formId,
    p_event_id: eventId,
  });
  if (error !== null) return failFrom(error, "Couldn't prepare the export. Try again.");
  const root = rec(data, "export");
  return {
    columns: arr(root.columns, "export.columns").map((c): BrandFormExportColumn => {
      const r = rec(c, "export.columns[]");
      return {
        key: str(r.key, "column.key"),
        version: num(r.version, "column.version"),
        questionId: str(r.questionId, "column.questionId"),
        label: str(r.label, "column.label"),
        type: str(r.type, "column.type"),
      };
    }),
    rows: arr(root.rows, "export.rows").map((row): BrandFormExportRow => {
      const r = rec(row, "export.rows[]");
      const values: Record<string, string> = {};
      if (isRecord(r.values)) {
        for (const [k, v] of Object.entries(r.values)) if (typeof v === "string") values[k] = v;
      }
      return {
        responseId: str(r.responseId, "row.responseId"),
        version: num(r.version, "row.version"),
        submittedAt: str(r.submittedAt, "row.submittedAt"),
        updatedAt: str(r.updatedAt, "row.updatedAt"),
        verified: bool(r.verified, true),
        values,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Writes (each one RPC; the server enforces rank and revisions)
// ---------------------------------------------------------------------------

export async function createBrandForm(
  brandId: string,
  name: string,
  draft?: BrandFormDefinition,
): Promise<{ formId: string; draftRev: number }> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("biz_brand_form_create", {
    p_brand_id: brandId,
    p_name: name,
    p_draft: draft ?? null,
  });
  if (error !== null) return failFrom(error, "Couldn't create the form. Try again.");
  const r = rec(data, "create");
  return { formId: str(r.formId, "create.formId"), draftRev: num(r.draftRev, "create.draftRev") };
}

export interface SaveDraftInput {
  formId: string;
  draft: BrandFormDefinition;
  draftRev: number;
  name?: string;
}

export async function saveBrandFormDraft(input: SaveDraftInput): Promise<{ draftRev: number }> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("biz_brand_form_save_draft", {
    p_form_id: input.formId,
    p_draft: input.draft,
    p_draft_rev: input.draftRev,
    p_name: input.name ?? null,
  });
  if (error !== null) return failFrom(error, "Couldn't save the draft. Try again.");
  return { draftRev: num(rec(data, "save").draftRev, "save.draftRev") };
}

export interface PublishResult {
  versionId: string;
  version: number;
  status: BrandFormStatus;
  /** Pages the form is attached to. */
  attachedEventIds: string[];
  /** Wave 3 (C12): per live page, the guests who signed up and have not answered. */
  earlierGuests: Array<{ eventId: string; count: number }>;
}

export async function publishBrandForm(formId: string, draftRev: number): Promise<PublishResult> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("biz_brand_form_publish", {
    p_form_id: formId,
    p_draft_rev: draftRev,
  });
  if (error !== null) return failFrom(error, "Couldn't publish the form. Try again.");
  const r = rec(data, "publish");
  return {
    versionId: str(r.versionId, "publish.versionId"),
    version: num(r.version, "publish.version"),
    status: parseStatus(r.status),
    attachedEventIds: arr(r.attachedEventIds ?? [], "publish.attachedEventIds").filter(
      (id): id is string => typeof id === "string",
    ),
    earlierGuests: arr(r.earlierGuests ?? [], "publish.earlierGuests").flatMap((g) => {
      const x = rec(g, "publish.earlierGuest");
      return typeof x.eventId === "string" ? [{ eventId: x.eventId, count: count(x.count) }] : [];
    }),
  };
}

const statusRpc = async (
  fn: "biz_brand_form_close" | "biz_brand_form_reopen" | "biz_brand_form_archive",
  formId: string,
  fallback: string,
): Promise<BrandFormStatus> => {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc(fn, { p_form_id: formId });
  if (error !== null) return failFrom(error, fallback);
  return parseStatus(rec(data, fn).status);
};

export const closeBrandForm = (formId: string): Promise<BrandFormStatus> =>
  statusRpc("biz_brand_form_close", formId, "Couldn't close the form. Try again.");
export const reopenBrandForm = (formId: string): Promise<BrandFormStatus> =>
  statusRpc("biz_brand_form_reopen", formId, "Couldn't reopen the form. Try again.");
export const archiveBrandForm = (formId: string): Promise<BrandFormStatus> =>
  statusRpc("biz_brand_form_archive", formId, "Couldn't archive the form. Try again.");

export async function setBrandFormDoorFullAnswers(formId: string, on: boolean): Promise<boolean> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("biz_brand_form_set_door_full_answers", {
    p_form_id: formId,
    p_on: on,
  });
  if (error !== null) return failFrom(error, "Couldn't change that setting. Try again.");
  return bool(rec(data, "door").doorFullAnswers, on);
}

export interface AttachInput {
  formId: string;
  eventId: string;
  mode: BrandFormMode;
  autoRemind?: boolean;
  /** The attachment the screen saw on the page (null: none). A different one is a stale write. */
  expectedAttachmentId: string | null;
}

export interface AttachResult {
  attachmentId: string;
  mode: BrandFormMode;
  existingGuests: number;
  /** Wave 3 (C12): signed up and not answered (0 unless the form is live). */
  earlierGuests: number;
  formStatus: BrandFormStatus;
  replacedAttachmentId: string | null;
  /** The new attachment's stored automatic reminder (the earlier-guests sheet shows it). */
  autoRemind: boolean;
  autoRemindChannels: Array<"sms" | "email">;
}

export async function attachBrandForm(input: AttachInput): Promise<AttachResult> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("biz_brand_form_attach", {
    p_form_id: input.formId,
    p_event_id: input.eventId,
    p_mode: input.mode,
    p_auto_remind: input.autoRemind ?? false,
    p_expected_attachment_id: input.expectedAttachmentId,
  });
  if (error !== null) return failFrom(error, "Couldn't save the guest questions. Try again.");
  const r = rec(data, "attach");
  return {
    attachmentId: str(r.attachmentId, "attach.attachmentId"),
    mode: parseMode(r.mode),
    existingGuests: typeof r.existingGuests === "number" ? r.existingGuests : 0,
    earlierGuests: count(r.earlierGuests),
    formStatus: parseStatus(r.formStatus),
    replacedAttachmentId: strOrNull(r.replacedAttachmentId),
    autoRemind: r.autoRemind === true,
    autoRemindChannels: contactChannels(r.autoRemindChannels),
  };
}

export async function detachBrandForm(attachmentId: string): Promise<void> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("biz_brand_form_detach", {
    p_attachment_id: attachmentId,
  });
  if (error !== null) return failFrom(error, "Couldn't remove the form from this page. Try again.");
  if (rec(data, "detach").ok !== true) throw bad("detach.ok");
}

// ---------------------------------------------------------------------------
// Counts (wave 3): one read for the forms list cards and the manage tiles
// ---------------------------------------------------------------------------

export interface BrandFormCount {
  formId: string;
  answered: number;
  toAnswer: number;
  pages: number;
}

export interface BrandFormPageCount {
  eventId: string;
  formId: string;
  answered: number;
  toAnswer: number;
}

export interface BrandFormCounts {
  forms: BrandFormCount[];
  pages: BrandFormPageCount[];
}

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/** Answered and to-answer per form and per page (`biz_brand_form_counts`, marketing manager and up). */
export async function fetchBrandFormCounts(brandId: string): Promise<BrandFormCounts> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("biz_brand_form_counts", { p_brand_id: brandId });
  if (error !== null) return failFrom(error, "Couldn't load the answer counts. Try again.");
  const r = rec(data, "counts");
  return {
    forms: arr(r.forms ?? [], "counts.forms").map((f) => {
      const x = rec(f, "counts.form");
      return { formId: str(x.formId, "counts.formId"), answered: count(x.answered), toAnswer: count(x.toAnswer), pages: count(x.pages) };
    }),
    pages: arr(r.pages ?? [], "counts.pages").map((pg) => {
      const x = rec(pg, "counts.page");
      return {
        eventId: str(x.eventId, "counts.eventId"),
        formId: str(x.formId, "counts.page.formId"),
        answered: count(x.answered),
        toAnswer: count(x.toAnswer),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// The manage-page tile
// ---------------------------------------------------------------------------

export interface GuestQuestionsTileData {
  attachment: BrandFormAttachment;
  form: BrandFormRow;
  published: boolean;
  answered: number;
  notAnswered: number;
}

/**
 * What the "Guest questions" tile on a manage page needs: the page's active
 * form and, once the form has been published, how many answered and how many
 * are still to answer. Null when no form is on the page.
 */
export async function fetchGuestQuestionsTile(eventId: string): Promise<GuestQuestionsTileData | null> {
  const found = await fetchEventAttachment(eventId);
  if (found === null) return null;
  const published = found.form.liveVersionId !== null;
  if (!published || found.form.status === "draft") {
    return { attachment: found.attachment, form: found.form, published, answered: 0, notAnswered: 0 };
  }
  // Wave 3: the one counts read (per page), not a page of responses.
  const counts = await fetchBrandFormCounts(found.form.brandId);
  const here = counts.pages.find((p) => p.eventId === eventId && p.formId === found.form.id);
  return {
    attachment: found.attachment,
    form: found.form,
    published,
    answered: here?.answered ?? 0,
    notAnswered: here?.toAnswer ?? 0,
  };
}
