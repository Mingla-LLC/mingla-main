/**
 * #4541 R2.4 — every brand form read and write the Explorer app makes.
 *
 * The RSVP page read moved here from rsvpDeckService (R1.14): it goes through
 * the `brand-form-submit` edge function (`{op:"page_form"}`), never the
 * `public_brand_form_for_event` database function directly, which guests are
 * not allowed to call (live bug N1, invariant I-4541-NO-CLIENT-SERVICE-ROLE-RPC).
 *
 * Services throw `BrandFormError {code, status, detail}`; hooks map the code to
 * a screen state (R2.3) and copy (R2.12). A personal link token is sent in the
 * POST body only and is never logged.
 */
import {
  parseRsvpBrandFormRead,
  type RsvpBrandFormRead,
} from "@mingla/offering-rendering/rsvpBrandForm";

import { supabase } from "./supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BrandFormMode = "optional_on_page" | "required_step" | "after_purchase";
export type BrandFormSubjectKind = "rsvp" | "rsvp_guest" | "order";
export type BrandFormAnswerValue = string | string[] | null;
export type BrandFormAnswerMap = Record<string, BrandFormAnswerValue>;

/** A failed brand form call: the server's code (or `network` / `server_error`). */
export class BrandFormError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly detail: Record<string, unknown> | null;

  constructor(code: string, status: number | null, detail: Record<string, unknown> | null = null) {
    super(code);
    this.name = "BrandFormError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/** The server body of a failed `functions.invoke`, read once (never logged). */
async function errorFromInvoke(error: unknown): Promise<BrandFormError> {
  const context = (error as { context?: unknown } | null)?.context;
  const response = context !== null && typeof context === "object"
    ? context as { status?: unknown; clone?: () => { text?: () => Promise<string> }; text?: () => Promise<string> }
    : null;
  const status = typeof response?.status === "number" ? response.status : null;
  if (response === null || status === null) return new BrandFormError("network", null);
  try {
    const reader = typeof response.clone === "function" ? response.clone() : response;
    const raw = typeof reader.text === "function" ? await reader.text() : "";
    const body = JSON.parse(raw) as unknown;
    if (body !== null && typeof body === "object" && !Array.isArray(body)) {
      const record = body as Record<string, unknown>;
      const code = typeof record.error === "string" && record.error.length > 0
        ? record.error
        : status >= 500 ? "server_error" : "bad_request";
      return new BrandFormError(code, status, record);
    }
  } catch {
    // An unreadable body: classify by status below.
  }
  return new BrandFormError(status >= 500 ? "server_error" : "bad_request", status);
}

async function invoke(body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("brand-form-submit", { body });
  if (error !== null && error !== undefined) throw await errorFromInvoke(error);
  return data;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * R1.14 — the RSVP page's form, through the edge (the public key is enough:
 * the signed-out page reads it the same way). Returns questions on the page,
 * an "After they RSVP" notice, or null for no form.
 */
export async function fetchPageForm(eventId: string): Promise<RsvpBrandFormRead | null> {
  const data = await invoke({ op: "page_form", eventId });
  return parseRsvpBrandFormRead(data);
}

/** The form screen's one read shape (R2.3), whatever way the screen was opened. */
export interface FormScreenRead {
  state: "unanswered" | "answered" | "code_required";
  form: {
    id: string;
    name: string;
    status: "live" | "closed";
    versionId: string | null;
    definition: FormDefinition | null;
    doorFullAnswers: boolean;
  };
  brand: Record<string, unknown>;
  /** The link's person ("Ada O."), links only. */
  identity: string | null;
  eventId: string | null;
  response: {
    id: string;
    versionId: string | null;
    definition: FormDefinition | null;
    isCurrentVersion: boolean;
    answers: BrandFormAnswerMap;
    editCount: number;
    updatedAt: string | null;
  } | null;
  /** Unknown Blast replies cannot be read back or edited. */
  editable: boolean;
  /** Unknown Blast replies only (R8.5). */
  botTicket: string | null;
}

export interface FormDefinition {
  title?: string;
  intro?: string;
  questions: {
    id: string;
    position: number;
    type: "short_text" | "long_text" | "number" | "date" | "single_choice" | "multi_choice" | "file_upload";
    label: string;
    help?: string | null;
    required: boolean;
    options?: { id: string; label: string }[];
    show_if?: { question_id: string; option_id: string } | null;
    show_at_door?: boolean;
    door_label?: string | null;
  }[];
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;

function parseDefinition(v: unknown): FormDefinition | null {
  const d = asRecord(v);
  if (d === null || !Array.isArray(d.questions)) return null;
  return d as unknown as FormDefinition;
}

function parseAnswers(v: unknown): BrandFormAnswerMap {
  const a = asRecord(v);
  if (a === null) return {};
  const out: BrandFormAnswerMap = {};
  for (const [id, value] of Object.entries(a)) {
    if (typeof value === "string") out[id] = value;
    else if (typeof value === "number") out[id] = String(value);
    else if (Array.isArray(value) && value.every((x) => typeof x === "string")) out[id] = value as string[];
  }
  return out;
}

/** `brand_form_my_response`'s payload (also inside `link_read`). Pure; exported for tests. */
export function parseFormScreenRead(raw: unknown): FormScreenRead | null {
  const r = asRecord(raw);
  if (r === null) return null;
  const form = asRecord(r.form);
  if (form === null || typeof form.id !== "string" || !UUID.test(form.id)) return null;
  const state = r.state === "answered" || r.state === "code_required" ? r.state : "unanswered";
  const resp = asRecord(r.response);
  return {
    state,
    form: {
      id: form.id.toLowerCase(),
      name: typeof form.name === "string" ? form.name : "",
      status: form.status === "closed" ? "closed" : "live",
      versionId: typeof form.versionId === "string" ? form.versionId : null,
      definition: parseDefinition(form.definition),
      doorFullAnswers: form.doorFullAnswers === true,
    },
    brand: asRecord(r.brand) ?? {},
    identity: typeof r.identity === "string" && r.identity.length > 0 ? r.identity : null,
    eventId: typeof r.eventId === "string" && UUID.test(r.eventId) ? r.eventId.toLowerCase() : null,
    response: resp === null || typeof resp.id !== "string"
      ? null
      : {
        id: resp.id,
        versionId: typeof resp.versionId === "string" ? resp.versionId : null,
        definition: parseDefinition(resp.definition),
        isCurrentVersion: resp.isCurrentVersion !== false,
        answers: parseAnswers(resp.answers),
        editCount: typeof resp.editCount === "number" ? resp.editCount : 0,
        updatedAt: typeof resp.updatedAt === "string" ? resp.updatedAt : null,
      },
    editable: r.editable !== false,
    botTicket: typeof r.botTicket === "string" ? r.botTicket : null,
  };
}

/** A personal link read (`{op:"link_read"}`), recognised as the link's person. */
export async function fetchLinkForm(
  formId: string,
  token: string,
  challengeId?: string | null,
): Promise<FormScreenRead> {
  const data = asRecord(await invoke({
    op: "link_read",
    formId,
    token,
    ...(challengeId ? { challengeId } : {}),
  }));
  const read = parseFormScreenRead(data?.read);
  if (read === null) throw new BrandFormError("server_error", 200);
  return read;
}

/** The signed-in person's own read for a form (optionally at one event). */
export async function fetchMyForm(formId: string, eventId: string | null): Promise<FormScreenRead> {
  const { data, error } = await supabase.rpc("brand_form_my_response", {
    p_form_id: formId,
    p_event_id: eventId,
  });
  if (error !== null) {
    const message = typeof error.message === "string" ? error.message : "";
    const code = message.trim().split(/[\s:]/)[0] ?? "";
    throw new BrandFormError(
      ["form_not_found", "not_signed_in", "link_invalid", "link_revoked"].includes(code)
        ? (code === "not_signed_in" ? "sign_in_required" : code)
        : "server_error",
      null,
    );
  }
  const read = parseFormScreenRead(data);
  if (read === null) throw new BrandFormError("server_error", 200);
  return read;
}

/**
 * R4.5 — a Blast form (no page) read with the campaign it came in, through
 * brand-form-submit `{op:"blast_form", formId, campaignId}`, which answers
 * `{form, brand, botTicket}`.
 */
export async function fetchBlastForm(formId: string, campaignId: string): Promise<FormScreenRead> {
  const data = asRecord(await invoke({ op: "blast_form", formId, campaignId }));
  const form = asRecord(data?.form);
  const read = parseFormScreenRead({
    state: "unanswered",
    form: form === null ? null : { ...form, id: form.id ?? formId },
    brand: data?.brand,
    botTicket: data?.botTicket,
    editable: false,
  });
  if (read === null) throw new BrandFormError("form_not_found", 404);
  return read;
}

/** R2.10 — what the cart's questions block shows. */
export interface CheckoutBrandForm {
  mode: BrandFormMode;
  formId: string;
  versionId: string;
  name: string;
  definition: FormDefinition;
  doorFullAnswers: boolean;
  brand: Record<string, unknown>;
  /** R1.1: this buyer already answered for this event (read-only here). */
  answeredHere: boolean;
  /** Their own answers: read-only with answeredHere, else editable prefill. */
  prefill: BrandFormAnswerMap | null;
}

/** The checkout read's payload, or null when the page asks nothing. Pure; exported for tests. */
export function parseCheckoutBrandForm(raw: unknown): CheckoutBrandForm | null {
  const outer = asRecord(raw);
  const d = asRecord(outer?.form) ?? outer;
  if (d === null || d.active !== true) return null;
  if (typeof d.formId !== "string" || !UUID.test(d.formId)) return null;
  const mode = d.mode === "required_step" || d.mode === "optional_on_page" || d.mode === "after_purchase"
    ? d.mode
    : null;
  if (mode === null) return null;
  const definition = parseDefinition(d.definition);
  if (definition === null || typeof d.versionId !== "string") return null;
  const prefill = asRecord(d.prefill);
  return {
    mode,
    formId: d.formId.toLowerCase(),
    versionId: d.versionId.toLowerCase(),
    name: typeof d.name === "string" ? d.name : "",
    definition,
    doorFullAnswers: d.doorFullAnswers === true,
    brand: asRecord(d.brand) ?? {},
    answeredHere: d.answeredHere === true,
    prefill: prefill === null ? null : parseAnswers(prefill.answers),
  };
}

/**
 * The checkout's form read with the buyer's own credential (the bearer the
 * client attaches). The native cart carries no private ticket-link token.
 */
export async function fetchCheckoutForm(
  eventId: string,
  ticketLinkToken: string | null = null,
): Promise<CheckoutBrandForm | null> {
  const data = await invoke({
    op: "checkout_form",
    eventId,
    ...(ticketLinkToken !== null ? { ticketLinkToken } : {}),
  });
  return parseCheckoutBrandForm(data);
}

// ---------------------------------------------------------------------------
// Pending forms ("to answer" cards)
// ---------------------------------------------------------------------------

export interface PendingBrandForm {
  eventId: string;
  eventTitle: string | null;
  eventStatus: string | null;
  subject: { kind: BrandFormSubjectKind; id: string };
  mode: BrandFormMode;
  required: boolean;
  formId: string;
  formName: string;
  formStatus: "live" | "closed";
  answered: boolean;
  answeredSource: string | null;
  brand: { displayName?: string } | null;
}

/** One `brand_forms_my_pending` row, or null. Pure; exported for tests. */
export function parsePendingBrandForm(raw: unknown): PendingBrandForm | null {
  const r = asRecord(raw);
  const subject = asRecord(r?.subject);
  if (r === null || subject === null) return null;
  const kind = subject.kind === "rsvp" || subject.kind === "rsvp_guest" || subject.kind === "order"
    ? subject.kind
    : null;
  const mode = r.mode === "required_step" || r.mode === "optional_on_page" || r.mode === "after_purchase"
    ? r.mode
    : null;
  if (
    kind === null || mode === null || typeof subject.id !== "string" ||
    typeof r.eventId !== "string" || typeof r.formId !== "string"
  ) return null;
  const brand = asRecord(r.brand);
  return {
    eventId: r.eventId,
    eventTitle: typeof r.eventTitle === "string" ? r.eventTitle : null,
    eventStatus: typeof r.eventStatus === "string" ? r.eventStatus : null,
    subject: { kind, id: subject.id },
    mode,
    required: r.required === true,
    formId: r.formId,
    formName: typeof r.formName === "string" ? r.formName : "",
    formStatus: r.formStatus === "closed" ? "closed" : "live",
    answered: r.answered === true,
    answeredSource: typeof r.answeredSource === "string" ? r.answeredSource : null,
    brand: brand === null ? null : { displayName: typeof brand.displayName === "string" ? brand.displayName : undefined },
  };
}

/** The signed-in guest's forms for their held orders, RSVPs and claimed plus-ones. */
export async function fetchMyPendingBrandForms(): Promise<PendingBrandForm[]> {
  const { data, error } = await supabase.rpc("brand_forms_my_pending");
  if (error !== null) throw new BrandFormError("server_error", null);
  if (!Array.isArray(data)) return [];
  return data.map(parsePendingBrandForm).filter((row): row is PendingBrandForm => row !== null);
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

export interface SubmitBrandFormBody {
  formId: string;
  versionId: string | null;
  eventId: string | null;
  answers: BrandFormAnswerMap;
  expectedEditCount?: number | null;
  token?: string | null;
  challengeId?: string | null;
  rsvpId?: string | null;
  rsvpGuestId?: string | null;
  orderId?: string | null;
  /**
   * Blast replies (R4.5): `campaignId`, `botTicket` and `website` (the bot
   * trap) are accepted submit keys (`_shared/brandFormsContract.ts` BODY_KEYS).
   */
  campaignId?: string | null;
  botTicket?: string | null;
  website?: string;
}

export interface SubmitBrandFormResult {
  responseId: string;
  editCount: number;
  versionId: string;
  created: boolean;
}

/** The submit body: only the keys the server accepts, nulls dropped. Pure; exported for tests. */
export function submitBody(body: SubmitBrandFormBody): Record<string, unknown> {
  const out: Record<string, unknown> = { formId: body.formId, answers: body.answers };
  const optional: (keyof SubmitBrandFormBody)[] = [
    "versionId", "eventId", "expectedEditCount", "token", "challengeId",
    "rsvpId", "rsvpGuestId", "orderId", "campaignId", "botTicket", "website",
  ];
  for (const key of optional) {
    const value = body[key];
    if (value !== undefined && value !== null) out[key] = value;
  }
  // A personal link names its own person: never send a held item beside it.
  if (typeof out.token === "string") {
    delete out.rsvpId;
    delete out.rsvpGuestId;
    delete out.orderId;
  }
  return out;
}

export async function submitBrandForm(body: SubmitBrandFormBody): Promise<SubmitBrandFormResult> {
  const data = asRecord(await invoke(submitBody(body)));
  if (data === null || data.ok !== true || typeof data.responseId !== "string") {
    throw new BrandFormError("server_error", 200);
  }
  return {
    responseId: data.responseId,
    editCount: typeof data.editCount === "number" ? data.editCount : 0,
    versionId: typeof data.versionId === "string" ? data.versionId : "",
    created: data.created === true,
  };
}

/**
 * R2.11 — tell the server this phone can open the form screen
 * (`brand_form_report_capability`, migration M-B). A failure is ignored by the
 * caller and logged once.
 */
export async function reportFormCapability(platform: string, appVersion: string): Promise<void> {
  const { error } = await supabase.rpc("brand_form_report_capability", {
    p_app_id: "explorer",
    p_platform: platform,
    p_app_version: appVersion,
    p_screen_version: 1,
  });
  if (error !== null) throw new BrandFormError("server_error", null);
}
