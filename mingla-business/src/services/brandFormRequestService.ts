/**
 * #4514 wave 4 — "Ask guests to answer", "Remind" and the automatic reminder
 * switch, and the host's delivery log. The edge (guest-roster-actions form
 * operations) checks the role (event manager and up, C5), throttles each person
 * per form for 24 hours, queues the requests and sends them by text or email
 * with each guest's own form link; a request never creates an invite (decision
 * 17). #4541 R3: push (free) goes only to people whose app can open the
 * form, and only while the server's push switch is on (`pushAvailable`).
 * R5: texts share Blast's monthly allowance; over it (or today's 300) texts
 * are off for that send, never a refused send (`textsOff`).
 * Loaded only by the lazy forms owner; no module-scope client.
 */

export type FormRequestChannel = "push" | "sms" | "email";
/** #4541 R5.4: why texts are off for a send. */
export type FormRequestTextsOffReason = "monthly_allowance" | "daily_cap";
export interface FormRequestTextsOff {
  reason: FormRequestTextsOffReason;
  needed: number;
  remaining: number;
}
export type FormRequestKind = "ask" | "remind";
export type FormRequestAudience = "unanswered" | "everyone";

export interface FormRequestSubject {
  kind: "rsvp" | "rsvp_guest" | "order";
  id: string;
}

export interface FormRequestInput {
  formId: string;
  eventId: string;
  kind: FormRequestKind;
  audience: FormRequestAudience;
  channels: FormRequestChannel[];
  /** Named guests (the answers drawer); absent: everyone on the page in the audience. */
  subjects?: FormRequestSubject[];
}

export interface FormRequestPreview {
  selectedCount: number;
  reachableCount: number;
  throttledCount: number;
  smsOptedOutCount: number;
  unreachableCount: number;
  perChannelReachable: Record<FormRequestChannel, number>;
  smsCount: number;
  /** Parts per text, as the SMS adapter counts them (emoji and accents cost more). */
  smsSegments: number;
  /** null: some texts go to a country without a price yet (never a guessed amount). */
  estimatedCostMinor: number | null;
  currency: string | null;
  /** The brand's form request texts in the last 24 hours, and the daily limit. */
  textsToday: number;
  textCap: number;
  overTextCap: boolean;
  /** Texts wait until this time (9am on the page's own clock), or null. */
  textsWaitUntil: string | null;
  /** #4541 R3.1: the server's push switch is on (else "Push: not available yet"). */
  pushAvailable: boolean;
  /** #4541 R5.5: the monthly text allowance shared with Blast (null: no limit). */
  monthlyTextCap: number | null;
  textsLeftThisMonth: number | null;
  /** The texts this send will use (0 when texts are off). */
  textsThisSendUses: number;
  textsTodayUsed: number;
  dailyTextCap: number;
  /** Texts are off for this send (email and push still go), or null. */
  textsOff: FormRequestTextsOff | null;
}

export interface FormRequestResult {
  queued: number;
  sent: number;
  failed: number;
  /** Queued and still going out (the rest of a big send, or texts waiting for 9am). */
  pending: number;
  waitingForMorning: number;
  throttled: number;
  answered: number;
  unreachable: number;
  /** #4541 R5.4: texts were off for this send. */
  textsOff: FormRequestTextsOff | null;
}

export interface FormRequestLogRow {
  id: string;
  kind: "ask" | "remind" | "auto";
  subjectKind: "rsvp" | "rsvp_guest" | "order";
  subjectId: string;
  name: string;
  channel: FormRequestChannel | "push" | null;
  status: "queued" | "claimed" | "sent" | "failed" | "skipped" | "unreachable";
  reason: string | null;
  notBefore: string | null;
  createdAt: string;
  settledAt: string | null;
}

export interface FormRequestLog {
  sends: FormRequestLogRow[];
  counts: { queued: number; sent: number; failed: number; unreachable: number; skipped: number };
  runs: Array<{ startsAt: string; outcome: "sending" | "sent" | "failed" | "held_form_closed" }>;
}

export type FormRequestErrorCode =
  | "forbidden"
  | "form_closed"
  | "form_not_live"
  | "form_not_on_event"
  | "audience_too_large"
  | "no_recipients"
  | "preview_stale_cost"
  | "cost_unpriced"
  | "text_cap"
  | "forms_paused"
  // #4573: every code the server can return has a sentence (Constitution rule 3).
  | "form_request_unavailable"
  | "form_not_found"
  | "event_not_found"
  | "unauthorized"
  | "invalid_request"
  | "invalid_json"
  | "method_not_allowed"
  | "request_too_large"
  | "network_error"
  | "invalid_response"
  | "unknown";

export class FormRequestError extends Error {
  public readonly code: FormRequestErrorCode;
  public constructor(code: FormRequestErrorCode, message: string) {
    super(message);
    this.name = "FormRequestError";
    this.code = code;
  }
}

/**
 * #4573: every code guest-roster-actions can return for a form request
 * (formRequest.ts and index.ts). Each one has its own sentence in ERROR_COPY;
 * the regression test pins that none falls through to "unknown".
 */
export const FORM_REQUEST_SERVER_CODES = [
  "forbidden",
  "forms_paused",
  "form_closed",
  "form_not_live",
  "form_not_on_event",
  "form_not_found",
  "event_not_found",
  "audience_too_large",
  "form_request_unavailable",
  "no_recipients",
  "cost_unpriced",
  "preview_stale_cost",
  "text_cap",
  "unauthorized",
  "invalid_json",
  "invalid_request",
  "request_too_large",
  "method_not_allowed",
] as const satisfies readonly FormRequestErrorCode[];

const APP_NEEDS_UPDATE = "This app needs an update to send. Refresh the page or update the app.";

const ERROR_COPY: Record<FormRequestErrorCode, string> = {
  forbidden: "Your role doesn't include this action. Ask an event manager or above.",
  form_closed: "This form is closed. Reopen it to ask guests.",
  form_not_live: "Publish the form before asking guests.",
  form_not_on_event: "This form is no longer on this page. Reload.",
  audience_too_large: "That's more than 500 guests. Ask from the guest list in smaller groups.",
  no_recipients: "Nobody here can be reached right now.",
  preview_stale_cost: "The cost changed. Check the new estimate and send again.",
  cost_unpriced: "Some texts have no price yet. Tick the box to send them anyway, or untick Text.",
  text_cap: "That's over today's limit for form texts. Send by email, or text the rest tomorrow.",
  // #4541 R1.8: the off switch stops sending too.
  forms_paused: "Forms are paused right now. Try again later.",
  form_request_unavailable: "We couldn't queue these requests. Nothing was sent. Try again in a minute.",
  form_not_found: "This form was deleted. Reload.",
  event_not_found: "This page is no longer available. Reload.",
  unauthorized: "Your sign-in expired. Sign in again.",
  invalid_request: APP_NEEDS_UPDATE,
  invalid_json: APP_NEEDS_UPDATE,
  method_not_allowed: APP_NEEDS_UPDATE,
  request_too_large: "Too many guests at once. Ask in smaller groups.",
  network_error: "Couldn't reach Mingla. Check your connection and try again.",
  invalid_response: "Something went wrong reading the reply. Try again.",
  unknown: "Couldn't send. Try again.",
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** `{reason, needed, remaining}` or null (an unknown reason is never guessed). */
export function parseTextsOff(v: unknown): FormRequestTextsOff | null {
  if (!isRecord(v)) return null;
  const reason = v.reason === "monthly_allowance" || v.reason === "daily_cap" ? v.reason : null;
  return reason === null ? null : { reason, needed: num(v.needed), remaining: num(v.remaining) };
}

const getSupabase = async () => (await import("./supabase")).supabase;

/**
 * #4573 spec §5: a send the preview allowed is refused only for a change
 * between preview and send. For these the sheet reads the preview again so the
 * reason and the new numbers are on screen before the next Send.
 */
export const FORM_REQUEST_PREVIEW_CHANGED_CODES: ReadonlySet<FormRequestErrorCode> = new Set<FormRequestErrorCode>([
  "preview_stale_cost",
  "forms_paused",
  "form_closed",
  "form_not_live",
  "form_not_on_event",
  "form_not_found",
]);

/** True when a refused send means the preview must be read again (spec §5). */
export function shouldRefetchPreviewAfter(error: unknown): boolean {
  return error instanceof FormRequestError && FORM_REQUEST_PREVIEW_CHANGED_CODES.has(error.code);
}

/** The host-facing sentence for a code ("unknown" for anything else). */
export function formRequestErrorCopy(code: FormRequestErrorCode): string {
  return ERROR_COPY[code];
}

export function codeOf(value: unknown): FormRequestErrorCode {
  const code = isRecord(value) && typeof value.code === "string" ? value.code : "";
  if (code in ERROR_COPY) return code as FormRequestErrorCode;
  // #4573: a server code with no sentence is a gap; make it visible in development.
  if (typeof __DEV__ !== "undefined" && __DEV__ === true) {
    console.warn("[brand-form-request] no copy for server code", code === "" ? "(none)" : code);
  }
  return "unknown";
}

async function invoke(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.functions.invoke("guest-roster-actions", { body });
  if (error !== null) {
    // A non-2xx reply carries the code in its body; read it, never guess.
    const context: unknown = (error as { context?: unknown }).context;
    let payload: unknown = null;
    if (context instanceof Response) {
      try {
        payload = await context.json();
      } catch {
        payload = null;
      }
    }
    const code = payload === null ? "network_error" : codeOf(payload);
    throw new FormRequestError(code, ERROR_COPY[code]);
  }
  if (!isRecord(data) || data.ok !== true) {
    const code = codeOf(data);
    throw new FormRequestError(code, ERROR_COPY[code]);
  }
  return data;
}

export function parseFormRequestPreview(data: Record<string, unknown>): FormRequestPreview {
  const per = isRecord(data.perChannelReachable) ? data.perChannelReachable : {};
  return {
    selectedCount: num(data.selectedCount),
    reachableCount: num(data.reachableCount),
    throttledCount: num(data.throttledCount),
    smsOptedOutCount: num(data.smsOptedOutCount),
    unreachableCount: num(data.unreachableCount),
    perChannelReachable: { push: num(per.push), sms: num(per.sms), email: num(per.email) },
    smsCount: num(data.smsCount),
    smsSegments: num(data.smsSegments),
    estimatedCostMinor: typeof data.estimatedCostMinor === "number" ? data.estimatedCostMinor : null,
    currency: typeof data.currency === "string" ? data.currency : null,
    textsToday: num(data.textsToday),
    textCap: num(data.textCap),
    overTextCap: data.overTextCap === true,
    textsWaitUntil: typeof data.textsWaitUntil === "string" ? data.textsWaitUntil : null,
    pushAvailable: data.pushAvailable === true,
    monthlyTextCap: numOrNull(data.monthlyTextCap),
    textsLeftThisMonth: numOrNull(data.textsLeftThisMonth),
    // An older server sends none of these: today's numbers stand in.
    textsThisSendUses: typeof data.textsThisSendUses === "number" ? num(data.textsThisSendUses) : num(data.smsCount),
    textsTodayUsed: typeof data.textsTodayUsed === "number" ? num(data.textsTodayUsed) : num(data.textsToday),
    dailyTextCap: typeof data.dailyTextCap === "number" ? num(data.dailyTextCap) : num(data.textCap),
    textsOff: parseTextsOff(data.textsOff),
  };
}

const requestBody = (input: FormRequestInput): Record<string, unknown> => ({
  eventId: input.eventId,
  formId: input.formId,
  kind: input.kind,
  // Remind reaches only people who have not answered.
  audience: input.kind === "remind" ? "unanswered" : input.audience,
  channels: [...input.channels].sort(),
  ...(input.subjects !== undefined && input.subjects.length > 0 ? { subjects: input.subjects } : {}),
});

export async function previewFormRequest(input: FormRequestInput): Promise<FormRequestPreview> {
  return parseFormRequestPreview(await invoke({ operation: "form_preview", ...requestBody(input) }));
}

export type FormRequestSendInput = FormRequestInput & {
  expectedCostMinor: number | null;
  currency: string | null;
  /** The host ticked "send texts without a price" (the server checks it). */
  confirmUnpriced?: boolean;
};

export async function sendFormRequest(input: FormRequestSendInput): Promise<FormRequestResult> {
  const data = await invoke({
    operation: "form_send",
    ...requestBody(input),
    expectedCostMinor: input.expectedCostMinor,
    currency: input.currency,
    ...(input.confirmUnpriced === true ? { confirmUnpriced: true } : {}),
  });
  const skipped = isRecord(data.skipped) ? data.skipped : {};
  return {
    queued: num(data.queued),
    sent: num(data.sent),
    failed: num(data.failed),
    pending: num(data.pending),
    waitingForMorning: num(data.waitingForMorning),
    throttled: num(skipped.throttled),
    answered: num(skipped.answered),
    unreachable: num(skipped.unreachable),
    textsOff: parseTextsOff(data.textsOff),
  };
}

export async function setFormAutoRemind(input: {
  attachmentId: string;
  on: boolean;
  channels: FormRequestChannel[];
}): Promise<{ autoRemind: boolean; remindAt: string | null; channels: FormRequestChannel[] }> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("biz_brand_form_set_auto_remind", {
    p_attachment_id: input.attachmentId,
    p_on: input.on,
    p_channels: [...input.channels].sort(),
  });
  if (error !== null) {
    const code: FormRequestErrorCode = error.code === "42501" ? "forbidden" : error.code === "PT409" ? "form_not_on_event" : "unknown";
    throw new FormRequestError(code, code === "unknown" ? "Couldn't change the reminder. Try again." : ERROR_COPY[code]);
  }
  if (!isRecord(data)) throw new FormRequestError("invalid_response", ERROR_COPY.invalid_response);
  return {
    autoRemind: data.autoRemind === true,
    remindAt: typeof data.remindAt === "string" ? data.remindAt : null,
    channels: parseContactChannels(data.channels),
  };
}

/** The automatic reminder's stored channels: text and email only (it never pushes). */
export function parseContactChannels(value: unknown): FormRequestChannel[] {
  return Array.isArray(value)
    ? value.filter((c): c is FormRequestChannel => c === "sms" || c === "email")
    : [];
}

const LOG_STATUSES: ReadonlyArray<FormRequestLogRow["status"]> = ["queued", "claimed", "sent", "failed", "skipped", "unreachable"];

export function parseFormRequestLog(value: unknown): FormRequestLog {
  if (!isRecord(value)) throw new FormRequestError("invalid_response", ERROR_COPY.invalid_response);
  const sends = (Array.isArray(value.sends) ? value.sends : []).flatMap((row): FormRequestLogRow[] => {
    if (!isRecord(row) || typeof row.id !== "string" || typeof row.createdAt !== "string") return [];
    const status = LOG_STATUSES.find((x) => x === row.status);
    if (status === undefined) return [];
    const kind = row.kind === "remind" || row.kind === "auto" ? row.kind : "ask";
    const channel = row.channel === "sms" || row.channel === "email" || row.channel === "push" ? row.channel : null;
    return [{
      id: row.id,
      kind,
      subjectKind: row.subjectKind === "order" ? "order" : row.subjectKind === "rsvp_guest" ? "rsvp_guest" : "rsvp",
      subjectId: typeof row.subjectId === "string" ? row.subjectId : "",
      name: typeof row.name === "string" && row.name.length > 0 ? row.name : "Guest",
      channel,
      status,
      reason: typeof row.reason === "string" ? row.reason : null,
      notBefore: typeof row.notBefore === "string" ? row.notBefore : null,
      createdAt: row.createdAt,
      settledAt: typeof row.settledAt === "string" ? row.settledAt : null,
    }];
  });
  const c = isRecord(value.counts) ? value.counts : {};
  const runs = (Array.isArray(value.runs) ? value.runs : []).flatMap((r): FormRequestLog["runs"] => {
    if (!isRecord(r) || typeof r.startsAt !== "string") return [];
    const outcome = r.outcome === "sent" || r.outcome === "failed" || r.outcome === "held_form_closed" ? r.outcome : "sending";
    return [{ startsAt: r.startsAt, outcome }];
  });
  return {
    sends,
    counts: { queued: num(c.queued), sent: num(c.sent), failed: num(c.failed), unreachable: num(c.unreachable), skipped: num(c.skipped) },
    runs,
  };
}

/** The host's delivery log for one form on one page (event manager and up), optionally one guest. */
export async function fetchFormRequestLog(input: {
  formId: string;
  eventId: string;
  subject?: FormRequestSubject;
}): Promise<FormRequestLog> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("biz_brand_form_request_log", {
    p_form_id: input.formId,
    p_event_id: input.eventId,
    p_subject: input.subject ?? null,
  });
  if (error !== null) {
    const code: FormRequestErrorCode = error.code === "42501" ? "forbidden" : "unknown";
    throw new FormRequestError(code, code === "unknown" ? "Couldn't load the delivery log. Try again." : ERROR_COPY[code]);
  }
  return parseFormRequestLog(data);
}
