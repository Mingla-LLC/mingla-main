// #4514 wave 4 — guest-roster-actions' form operations: "Ask guests to answer"
// and "Remind" from the guest list answers drawer, the Responses page and the
// "Ask earlier guests?" prompt. Preview shows reach and cost; send repeats the
// read, refuses a cost that grew, and sends through _shared/brandFormRequests
// (decision 17: no invite, a brand form link per guest, a 24-hour per-guest
// throttle in SQL). The roster's reminder and retry operations are untouched.

import {
  type FormRequestAudienceKind,
  type FormRequestChannel,
  type FormRequestDeps,
  parseAudience,
  previewFormRequest,
  sendFormRequests,
} from "../_shared/brandFormRequests.ts";
import type { SmsRateV1 } from "../_shared/smsPriceTable.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FormRequestBody {
  operation: "form_preview" | "form_send";
  eventId: string;
  formId: string;
  kind: "ask" | "remind";
  audience: FormRequestAudienceKind;
  channels: FormRequestChannel[];
  subjects?: Array<{ kind: "rsvp" | "order"; id: string }>;
  expectedCostMinor?: number | null;
  currency?: string | null;
}

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
    !ch.every((c) => c === "push" || c === "sms" || c === "email")
  ) return false;
  if (b.subjects !== undefined) {
    const s = b.subjects;
    if (
      !Array.isArray(s) || s.length < 1 || s.length > 500 ||
      !s.every((x) =>
        typeof x === "object" && x !== null && !Array.isArray(x) &&
        Object.keys(x).every((k) => k === "kind" || k === "id") &&
        ((x as Record<string, unknown>).kind === "rsvp" ||
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
  } else if (b.expectedCostMinor !== undefined || b.currency !== undefined) {
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
  const known = KNOWN.find((k) => message.includes(k));
  return known !== undefined
    ? { code: known, status: 409 }
    : { code: "form_request_unavailable", status: 409 };
}

export async function handleFormRequest(
  body: FormRequestBody,
  actorId: string,
  deps: FormRequestDeps & { smsRates: () => Promise<SmsRateV1[] | null> },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const channels = [...body.channels].sort() as FormRequestChannel[];
  const read = await deps.rpc("brand_form_request_audience", {
    p_actor_id: actorId,
    p_form_id: body.formId,
    p_event_id: body.eventId,
    p_audience: body.audience,
    p_subjects: body.subjects ?? null,
  });
  if (read.error !== null) {
    const e = audienceError(read.error.message);
    return { status: e.status, body: { ok: false, code: e.code } };
  }
  let audience;
  try {
    audience = parseAudience(read.data);
  } catch {
    return {
      status: 502,
      body: { ok: false, code: "form_request_unavailable" },
    };
  }
  const rates = channels.includes("sms") ? await deps.smsRates() : null;
  const preview = previewFormRequest(audience, channels, rates);
  if (body.operation === "form_preview") {
    return { status: 200, body: { ok: true, ...preview } };
  }
  if (preview.reachableCount === 0) {
    return {
      status: 409,
      body: { ok: false, code: "no_recipients", ...preview },
    };
  }
  const expected = body.expectedCostMinor ?? null;
  if (
    preview.estimatedCostMinor !== null && preview.estimatedCostMinor > 0 &&
    (expected === null ||
      preview.estimatedCostMinor > Math.ceil(expected * 1.1) ||
      body.currency !== preview.currency)
  ) {
    return {
      status: 409,
      body: { ok: false, code: "preview_stale_cost", ...preview },
    };
  }
  const outcome = await sendFormRequests(
    deps,
    audience,
    channels,
    body.kind,
    actorId,
  );
  return { status: 200, body: { ok: true, status: "sent", ...outcome } };
}
