// #4514 brand forms: the shared contract for brand-form-submit and its callers
// (buyer web, Explorer, host web). Payload types, error codes, the HTTP status
// each code maps to, and the abuse limits. The SQL side is
// supabase/migrations/20281120034514_issue_4514_brand_forms.sql
// (brand_form_submit_core raises these codes as the exception message).

export const BRAND_FORM_SCHEMA = "mingla.brand_form.v1" as const;

export type BrandFormQuestionType =
  | "short_text"
  | "long_text"
  | "number"
  | "date"
  | "single_choice"
  | "multi_choice"
  | "file_upload";

export interface BrandFormOption {
  id: string;
  label: string;
}

export interface BrandFormQuestion {
  id: string;
  position: number;
  type: BrandFormQuestionType;
  label: string;
  help?: string | null;
  required: boolean;
  options?: BrandFormOption[];
  show_if?: { question_id: string; option_id: string } | null;
  show_at_door?: boolean;
  door_label?: string | null;
}

export interface BrandFormDefinition {
  schema: typeof BRAND_FORM_SCHEMA;
  title?: string;
  intro?: string;
  questions: BrandFormQuestion[];
}

/** One answer: text, a number, a date (YYYY-MM-DD), an option id, or option ids. */
export type BrandFormAnswer = string | number | string[] | null;
export type BrandFormAnswers = Record<string, BrandFormAnswer>;

export type BrandFormSource =
  | "signup"
  | "page"
  | "link"
  | "pass"
  | "purchase_redirect"
  | "blast";
export const BRAND_FORM_SOURCES: readonly BrandFormSource[] = [
  "signup",
  "page",
  "link",
  "pass",
  "purchase_redirect",
  "blast",
];

/** The body a client posts to brand-form-submit. */
export interface BrandFormSubmitRequest {
  formId: string;
  /** The version the client rendered; a newer live version answers 409 form_changed. */
  versionId?: string | null;
  /** The page the answer is for (signed-in user with no RSVP or order). */
  eventId?: string | null;
  answers: BrandFormAnswers;
  source?: BrandFormSource;
  /** The edit count the client loaded; null or absent means "no answer yet". */
  expectedEditCount?: number | null;
  /** Personal link token (from the URL fragment). Without it a sign-in is required. */
  token?: string | null;
  /** A settled one-time code challenge for this link (C2). */
  challengeId?: string | null;
  /** Signed-in holder: answer for this RSVP or order. */
  rsvpId?: string | null;
  /** Signed-in claimed plus-one: answer only for that claimed guest row. */
  rsvpGuestId?: string | null;
  orderId?: string | null;
  /**
   * #4541 R4.5: the Blast the form came in. With a token it is the recipient's
   * own Blast link; signed in it is the person themselves; otherwise Unknown,
   * which needs `botTicket` (from the blast_form read) and an empty `website`.
   */
  campaignId?: string | null;
  /** #4541 R8.5: the bot ticket from the blast_form or page_form read (Unknown only). */
  botTicket?: string | null;
  /** #4541 R8.5: the honeypot field; must be empty or absent. */
  website?: string | null;
}

export interface BrandFormSubmitSuccess {
  ok: true;
  responseId: string;
  editCount: number;
  versionId: string;
  created: boolean;
  /** #4541 R4.5: false for an Unknown Blast reply (a new row every time, no edit). */
  editable?: boolean;
}

export type BrandFormSubmitErrorCode =
  | "origin"
  | "method"
  | "too_large"
  | "bad_request"
  | "sign_in_required"
  | "forms_paused"
  | "rate_limited"
  | "form_not_found"
  | "form_not_live"
  | "form_closed"
  | "form_changed"
  | "response_stale"
  | "form_answers_invalid"
  | "link_invalid"
  | "link_wrong_form"
  | "link_revoked"
  | "code_required"
  | "not_holder"
  | "not_current"
  | "form_not_on_event"
  | "subject_unavailable"
  | "credential_invalid"
  | "open_reply_limit"
  | "bot_check_failed"
  | "server_error";

export interface BrandFormSubmitError {
  ok: false;
  error: BrandFormSubmitErrorCode;
  /** form_answers_invalid: which questions and why. */
  errors?: Array<{ questionId: string | null; code: string }>;
  /** form_changed: the live version to reload. */
  versionId?: string;
  /** response_stale: the stored edit count. */
  editCount?: number;
}

export const BRAND_FORM_ERROR_STATUS: Readonly<
  Record<BrandFormSubmitErrorCode, number>
> = {
  origin: 403,
  method: 405,
  too_large: 413,
  bad_request: 400,
  sign_in_required: 401,
  forms_paused: 503,
  rate_limited: 429,
  form_not_found: 404,
  form_not_live: 404,
  form_closed: 410,
  form_changed: 409,
  response_stale: 409,
  form_answers_invalid: 422,
  link_invalid: 403,
  link_wrong_form: 403,
  link_revoked: 403,
  code_required: 403,
  not_holder: 403,
  // #4541 R1.4: an RSVP, plus-one or order that is no longer current.
  not_current: 403,
  form_not_on_event: 403,
  subject_unavailable: 422,
  credential_invalid: 400,
  // #4541 R4.5: a form's daily limit of replies from people we cannot identify.
  open_reply_limit: 429,
  // #4541 R8.5: an Unknown reply without a valid bot ticket.
  bot_check_failed: 422,
  server_error: 500,
};

/** Codes brand_form_submit_core raises (exception message), in one list. */
export const BRAND_FORM_CORE_CODES: readonly BrandFormSubmitErrorCode[] = [
  "forms_paused",
  "form_not_found",
  "form_not_live",
  "form_closed",
  "form_changed",
  "response_stale",
  "form_answers_invalid",
  "link_invalid",
  "link_wrong_form",
  "link_revoked",
  "code_required",
  "not_holder",
  "not_current",
  "form_not_on_event",
  "subject_unavailable",
  "credential_invalid",
  "open_reply_limit",
];

/**
 * Wave 5 (C1): the capability marker a checkout client sends in the
 * ticket-checkout-create body (`brandFormStep: 1`) when it can show the
 * Questions step. Without it a required form never blocks: the order completes
 * and the buyer is "to answer". Mirrored by mingla-business
 * `src/services/ticketCheckoutService.ts` (BRAND_FORM_CHECKOUT_STEP).
 */
export const BRAND_FORM_CHECKOUT_STEP = 1 as const;

/**
 * #4541: capability marker for RSVP clients that can render the Questions
 * block. Without it, required questions never strand an older client: the RSVP
 * completes and the guest remains in the host's "to answer" audience.
 */
export const BRAND_FORM_RSVP_STEP = 1 as const;

/** §3.8 abuse limits. */
export const BRAND_FORM_MAX_BODY_BYTES = 32 * 1024;
export const BRAND_FORM_PER_IP_10MIN = 20;
export const BRAND_FORM_PER_IP_24H = 100;
/** Slice 3 (open links): per form per 24 h. Declared here so every caller reads one number. */
export const BRAND_FORM_OPEN_LINK_PER_FORM_24H = 500;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[0-9a-f]{64}$/;
const BODY_KEYS = new Set([
  "formId",
  "versionId",
  "eventId",
  "answers",
  "source",
  "expectedEditCount",
  "token",
  "challengeId",
  "rsvpId",
  "rsvpGuestId",
  "orderId",
  // #4541 R4.5 / R8.5 (Blast replies).
  "campaignId",
  "botTicket",
  "website",
]);

function optionalUuid(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null;
  return typeof v === "string" && UUID_RE.test(v) ? v.toLowerCase() : undefined;
}

/** Shape check only; the server validates answers against the stored version. */
export function parseSubmitRequest(
  raw: unknown,
): BrandFormSubmitRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some((k) => !BODY_KEYS.has(k))) return null;
  if (typeof r.formId !== "string" || !UUID_RE.test(r.formId)) return null;
  if (!r.answers || typeof r.answers !== "object" || Array.isArray(r.answers)) {
    return null;
  }
  const versionId = optionalUuid(r.versionId);
  const eventId = optionalUuid(r.eventId);
  const challengeId = optionalUuid(r.challengeId);
  const rsvpId = optionalUuid(r.rsvpId);
  const rsvpGuestId = optionalUuid(r.rsvpGuestId);
  const orderId = optionalUuid(r.orderId);
  const campaignId = optionalUuid(r.campaignId);
  if (
    [versionId, eventId, challengeId, rsvpId, rsvpGuestId, orderId, campaignId]
      .some((v) => v === undefined)
  ) return null;
  if (campaignId && (rsvpId || rsvpGuestId || orderId || eventId)) return null;
  let botTicket: string | null = null;
  if (r.botTicket !== undefined && r.botTicket !== null) {
    if (typeof r.botTicket !== "string" || r.botTicket.length > 200) return null;
    botTicket = r.botTicket;
  }
  let website: string | null = null;
  if (r.website !== undefined && r.website !== null) {
    if (typeof r.website !== "string" || r.website.length > 500) return null;
    website = r.website;
  }
  if ([rsvpId, rsvpGuestId, orderId].filter(Boolean).length > 1) return null;
  let token: string | null = null;
  if (r.token !== undefined && r.token !== null) {
    if (typeof r.token !== "string" || !TOKEN_RE.test(r.token)) return null;
    token = r.token;
  }
  let expectedEditCount: number | null = null;
  if (r.expectedEditCount !== undefined && r.expectedEditCount !== null) {
    if (
      typeof r.expectedEditCount !== "number" ||
      !Number.isInteger(r.expectedEditCount) || r.expectedEditCount < 0 ||
      r.expectedEditCount > 999_999_999
    ) {
      return null;
    }
    expectedEditCount = r.expectedEditCount;
  }
  let source: BrandFormSource | undefined;
  if (r.source !== undefined) {
    if (
      typeof r.source !== "string" ||
      !(BRAND_FORM_SOURCES as readonly string[]).includes(r.source)
    ) return null;
    source = r.source as BrandFormSource;
  }
  return {
    formId: r.formId.toLowerCase(),
    versionId: versionId ?? null,
    eventId: eventId ?? null,
    answers: r.answers as BrandFormAnswers,
    source,
    expectedEditCount,
    token,
    challengeId: challengeId ?? null,
    rsvpId: rsvpId ?? null,
    rsvpGuestId: rsvpGuestId ?? null,
    orderId: orderId ?? null,
    campaignId: campaignId ?? null,
    botTicket,
    website,
  };
}

/**
 * The core payload for public.brand_form_submit_core. A personal link names its
 * own person (I-4514-FORM-LINK-ONE-FORM-ONE-RECIPIENT): with a token, any
 * signed-in user, RSVP or order in the body is ignored.
 */
export function corePayload(
  req: BrandFormSubmitRequest,
  userId: string | null,
): Record<string, unknown> | null {
  const base: Record<string, unknown> = {
    formId: req.formId,
    versionId: req.versionId ?? null,
    eventId: req.eventId ?? null,
    answers: req.answers,
    source: req.source ?? (req.token ? "link" : "page"),
    expectedEditCount: req.expectedEditCount ?? null,
  };
  if (req.token) {
    // A personal page link or a personal Blast link: the SQL core reads which.
    return {
      ...base,
      ...(req.campaignId ? { source: req.source ?? "blast" } : {}),
      credential: {
        kind: "link",
        token: req.token,
        challengeId: req.challengeId ?? null,
      },
    };
  }
  // #4541 R4.4: a Blast form. Signed in: the person themselves. Signed out with
  // no link: Unknown (the edge checks the bot ticket first). Typed answers never
  // change who a reply belongs to.
  if (req.campaignId) {
    return {
      ...base,
      eventId: null,
      source: "blast",
      credential: userId
        ? { kind: "user", userId, campaignId: req.campaignId }
        : { kind: "unknown", campaignId: req.campaignId },
    };
  }
  if (!userId) return null;
  const credential: Record<string, unknown> = { kind: "user", userId };
  if (req.rsvpId) credential.rsvpId = req.rsvpId;
  if (req.rsvpGuestId) credential.rsvpGuestId = req.rsvpGuestId;
  if (req.orderId) credential.orderId = req.orderId;
  return { ...base, credential };
}

/**
 * The code inside a PostgREST error message ('form_closed', 'form_changed', …).
 * Bad input is a validation error, never a server error: any other failure whose
 * SQLSTATE is a data exception (class 22, e.g. 22008 bad date, 22P02 bad text,
 * 22P05 an untranslatable character) maps to form_answers_invalid.
 */
export function coreErrorCode(
  message: string,
  sqlstate?: string | null,
): BrandFormSubmitErrorCode {
  const first = (message ?? "").trim().split(/[\s:]/)[0] ?? "";
  if ((BRAND_FORM_CORE_CODES as readonly string[]).includes(first)) {
    return first as BrandFormSubmitErrorCode;
  }
  return typeof sqlstate === "string" && /^22[0-9A-Z]{3}$/.test(sqlstate)
    ? "form_answers_invalid"
    : "server_error";
}

// A NUL, or half of a surrogate pair: PostgreSQL's jsonb refuses both (22P05),
// so they are answered here as invalid input instead of reaching the database.
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const NUL = String.fromCharCode(0);
function unstorableText(t: string): boolean {
  return t.includes(NUL) || LONE_SURROGATE.test(t);
}

function storableScalar(v: unknown): boolean {
  if (v === null || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  return typeof v === "string" && !unstorableText(v);
}

/**
 * Per-question input errors the database could not even store: a NUL or a lone
 * surrogate (in a key or a value), an object, or an array holding anything but
 * scalars. Each is the contract's validation error (code "type"); everything
 * else is validated by the SQL core against the stored version.
 */
export function unstorableAnswerErrors(
  answers: BrandFormAnswers,
): Array<{ questionId: string | null; code: string }> {
  const out: Array<{ questionId: string | null; code: string }> = [];
  for (
    const [key, value] of Object.entries(answers as Record<string, unknown>)
  ) {
    const keyOk = !unstorableText(key);
    const valueOk = Array.isArray(value)
      ? value.every(storableScalar)
      : storableScalar(value);
    if (!keyOk || !valueOk) {
      out.push({
        questionId: keyOk ? key : null,
        code: "type",
      });
    }
  }
  return out;
}
