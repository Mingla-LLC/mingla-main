// #4514 wave 4 — guest-roster-actions' form operations: "Ask guests to answer"
// and "Remind" from the guest list answers drawer, the Responses page and the
// "Ask earlier guests?" prompt. Preview shows reach and cost; send repeats the
// read, refuses a cost that grew, a text with no price the host did not
// confirm, then only queues the
// requests (brand_form_request_enqueue) and drains this page's queue for a
// bounded stretch; notify-reminders' drain sends whatever is left. #4541 R5.4:
// a text limit (the shared monthly allowance or today's 300) turns texts off
// for the send instead of refusing it. Decision
// 17: no invite, a brand form link per guest, a 24-hour per-person throttle in
// SQL. The roster's reminder and retry operations are untouched.

import {
  allowedRequestChannels,
  drainFormRequests,
  type FormRequestAudienceKind,
  type FormRequestChannel,
  type FormRequestDeps,
  parseAudience,
} from "../_shared/brandFormRequests.ts";
import { previewFormRequest } from "../_shared/brandFormRequestPreview.ts";
import type { SmsRateV1 } from "../_shared/smsPriceTable.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FormRequestBody {
  operation: "form_preview" | "form_send";
  eventId: string;
  formId: string;
  kind: "ask" | "remind";
  audience: FormRequestAudienceKind;
  channels: FormRequestChannel[];
  /** #4541 R1.15: a claimed plus-one (rsvp_guest) can be asked on its own. */
  subjects?: Array<{ kind: "rsvp" | "rsvp_guest" | "order"; id: string }>;
  expectedCostMinor?: number | null;
  currency?: string | null;
  /** The host confirmed sending texts that have no price yet (server-checked). */
  confirmUnpriced?: boolean;
}

/** How long the host's own request drains its page before the cron takes over. */
export const FORM_SEND_DRAIN_BUDGET_MS = 20_000;

export function isFormRequestBody(value: unknown): value is FormRequestBody {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const b = value as Record<string, unknown>;
  const allowed = [
    "operation",
    "eventId",
    "formId",
    "kind",
    "audience",
    "channels",
    "subjects",
    "expectedCostMinor",
    "currency",
    "confirmUnpriced",
  ];
  if (!Object.keys(b).every((k) => allowed.includes(k))) return false;
  if (b.operation !== "form_preview" && b.operation !== "form_send") {
    return false;
  }
  if (
    typeof b.eventId !== "string" || !UUID.test(b.eventId) ||
    typeof b.formId !== "string" || !UUID.test(b.formId)
  ) return false;
  if (b.kind !== "ask" && b.kind !== "remind") return false;
  if (b.audience !== "unanswered" && b.audience !== "everyone") return false;
  // Remind reaches only people who have not answered.
  if (b.kind === "remind" && b.audience !== "unanswered") return false;
  const ch = b.channels;
  if (
    !Array.isArray(ch) || ch.length < 1 || ch.length > 3 ||
    new Set(ch).size !== ch.length ||
    !ch.every((c) => allowedRequestChannels().includes(c))
  ) return false;
  if (b.subjects !== undefined) {
    const s = b.subjects;
    if (
      !Array.isArray(s) || s.length < 1 || s.length > 500 ||
      !s.every((x) =>
        typeof x === "object" && x !== null && !Array.isArray(x) &&
        Object.keys(x).every((k) => k === "kind" || k === "id") &&
        ((x as Record<string, unknown>).kind === "rsvp" ||
          (x as Record<string, unknown>).kind === "rsvp_guest" ||
          (x as Record<string, unknown>).kind === "order") &&
        typeof (x as Record<string, unknown>).id === "string" &&
        UUID.test((x as Record<string, unknown>).id as string)
      )
    ) {
      return false;
    }
  }
  if (b.operation === "form_send") {
    const cost = b.expectedCostMinor;
    if (
      !(cost === null ||
        (typeof cost === "number" && Number.isSafeInteger(cost) && cost >= 0))
    ) return false;
    if (
      !(b.currency === null ||
        (typeof b.currency === "string" && /^[A-Z]{3}$/.test(b.currency)))
    ) return false;
    if (
      b.confirmUnpriced !== undefined && typeof b.confirmUnpriced !== "boolean"
    ) {
      return false;
    }
  } else if (
    b.expectedCostMinor !== undefined || b.currency !== undefined ||
    b.confirmUnpriced !== undefined
  ) {
    return false;
  }
  return true;
}

const FORBIDDEN = /brand_form_forbidden/;
const KNOWN = [
  "form_closed",
  "form_not_live",
  "form_not_on_event",
  "form_not_found",
  "event_not_found",
  "audience_too_large",
];

/** Map an audience read failure to a stable code and status (no raw database text). */
export function audienceError(
  message: string,
): { code: string; status: number } {
  if (FORBIDDEN.test(message)) return { code: "forbidden", status: 403 };
  // #4541 R1.8: the forms off switch stops new requests (Host: "Forms are paused
  // right now. Try again later.").
  if (message.includes("forms_paused")) return { code: "forms_paused", status: 503 };
  const known = KNOWN.find((k) => message.includes(k));
  return known !== undefined
    ? { code: known, status: 409 }
    : { code: "form_request_unavailable", status: 409 };
}

/** #4573: where a form_request_unavailable refusal came from. */
export type FormRequestRefusalStage = "audience" | "enqueue" | "parse";

/** A database error code is logged only as a short fixed token (SQLSTATE or PGRST code). */
const DB_STATE = /^[A-Z0-9]{5,8}$/;

/**
 * #4573 Constitution rule 3: every refused form request leaves exactly one log
 * line. No personal data: no raw database message, contact, name, token or id
 * (the form and event ids are not logged either).
 */
export function logFormRequestRefusal(fields: {
  op: FormRequestBody["operation"];
  code: string;
  status: number;
  dbState: string | null;
  kind: FormRequestBody["kind"];
  channels: FormRequestChannel[];
  smsCount: number | null;
  reachable: number | null;
  stage?: FormRequestRefusalStage;
}): void {
  const dbState = fields.dbState !== null && DB_STATE.test(fields.dbState)
    ? fields.dbState
    : null;
  const line: Record<string, unknown> = {
    op: fields.op,
    code: fields.code,
    status: fields.status,
    dbState,
    kind: fields.kind,
    channels: fields.channels,
    smsCount: fields.smsCount,
    reachable: fields.reachable,
  };
  if (fields.code === "form_request_unavailable" && fields.stage !== undefined) {
    line.stage = fields.stage;
  }
  console.warn("[brand-form-request] refused", JSON.stringify(line));
}

export async function handleFormRequest(
  body: FormRequestBody,
  actorId: string,
  deps: FormRequestDeps & { smsRates: () => Promise<SmsRateV1[] | null> },
  budgetMs = FORM_SEND_DRAIN_BUDGET_MS,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const channels = [...body.channels].sort() as FormRequestChannel[];
  let counts: { smsCount: number | null; reachable: number | null } = {
    smsCount: null,
    reachable: null,
  };
  const refuse = (
    status: number,
    payload: Record<string, unknown> & { code: string },
    dbState: string | null = null,
    stage?: FormRequestRefusalStage,
  ): { status: number; body: Record<string, unknown> } => {
    logFormRequestRefusal({
      op: body.operation,
      code: payload.code,
      status,
      dbState,
      kind: body.kind,
      channels,
      ...counts,
      stage,
    });
    return { status, body: { ok: false, ...payload } };
  };
  // #4541 R3.1: push goes to the server too; it drops push while the
  // BRAND_FORMS_PUSH switch is off.
  const audienceKind = body.kind === "remind" ? "unanswered" : body.audience;
  const read = await deps.rpc("brand_form_request_audience", {
    p_actor_id: actorId,
    p_form_id: body.formId,
    p_event_id: body.eventId,
    p_audience: audienceKind,
    p_subjects: body.subjects ?? null,
    p_channels: channels,
  });
  if (read.error !== null) {
    const e = audienceError(read.error.message);
    return refuse(e.status, { code: e.code }, read.error.code ?? null, "audience");
  }
  let audience;
  try {
    audience = parseAudience(read.data);
  } catch {
    return refuse(502, { code: "form_request_unavailable" }, null, "parse");
  }
  const rates = channels.includes("sms") ? await deps.smsRates() : null;
  const preview = previewFormRequest(audience, channels, rates, body.kind);
  if (body.operation === "form_preview") {
    return { status: 200, body: { ok: true, ...preview } };
  }
  counts = { smsCount: preview.smsCount, reachable: preview.reachableCount };
  if (preview.reachableCount === 0) {
    return refuse(409, { ...preview, code: "no_recipients" });
  }
  // #4541 R5.4: a text limit never refuses the send: over the monthly
  // allowance or today's 300, texts are off for this send (preview.textsOff)
  // and email and push still go.
  // Texts with no price: only when the host explicitly confirmed it.
  if (
    preview.smsCount > 0 && preview.estimatedCostMinor === null &&
    body.confirmUnpriced !== true
  ) {
    return refuse(409, { ...preview, code: "cost_unpriced" });
  }
  const expected = body.expectedCostMinor ?? null;
  if (
    preview.estimatedCostMinor !== null && preview.estimatedCostMinor > 0 &&
    (expected === null ||
      preview.estimatedCostMinor > Math.ceil(expected * 1.1) ||
      body.currency !== preview.currency)
  ) {
    return refuse(409, { ...preview, code: "preview_stale_cost" });
  }
  const queued = await deps.rpc("brand_form_request_enqueue", {
    p_actor_id: actorId,
    p_form_id: body.formId,
    p_event_id: body.eventId,
    p_kind: body.kind,
    p_audience: audienceKind,
    p_subjects: body.subjects ?? null,
    p_channels: channels,
  });
  if (queued.error !== null) {
    const dbState = queued.error.code ?? null;
    if (queued.error.message.includes("form_request_text_cap")) {
      return refuse(409, { ...preview, code: "text_cap" }, dbState);
    }
    const e = audienceError(queued.error.message);
    return refuse(e.status, { code: e.code }, dbState, "enqueue");
  }
  const q =
    (typeof queued.data === "object" && queued.data !== null
      ? queued.data
      : {}) as Record<string, unknown>;
  const n = (v: unknown): number =>
    typeof v === "number" && Number.isSafeInteger(v) ? v : 0;
  // Send this page's first stretch now; anything left is resumed by the
  // five-minute drain in notify-reminders (a crash here loses nothing).
  let drained = { sent: 0, failed: 0, more: false };
  try {
    drained = await drainFormRequests(deps, {
      budgetMs,
      formId: body.formId,
      eventId: body.eventId,
    });
  } catch (error) {
    console.error(
      "[brand-form-request] drain after queue failed; the cron resumes it",
      error instanceof Error ? error.message : String(error),
    );
    drained.more = true;
  }
  const queuedCount = n(q.queued);
  return {
    status: 200,
    body: {
      ok: true,
      status: drained.more || drained.sent + drained.failed < queuedCount
        ? "queued"
        : "sent",
      queued: queuedCount,
      sent: drained.sent,
      failed: drained.failed,
      pending: Math.max(queuedCount - drained.sent - drained.failed, 0),
      waitingForMorning: n(q.waitingForMorning),
      textsOff: typeof q.textsOff === "object" && q.textsOff !== null
        ? q.textsOff
        : null,
      skipped: {
        throttled: n(q.throttled),
        answered: n(q.answered),
        unreachable: n(q.unreachable),
      },
    },
  };
}
