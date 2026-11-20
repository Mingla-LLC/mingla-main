// #4514 wave 4 — Ask guests to answer, Remind and the automatic reminder.
//
// One owner for who a form request reaches, how, what it may cost, and the
// delivery drain. Used by guest-roster-actions (the host's Ask and Remind:
// preview, then queue and drain a first stretch) and notify-reminders (the
// automatic reminder two days before each guest's own date, and the drain that
// resumes anything left in the queue).
//
// Decision 17: a request never creates an invite. The host's send only records
// intent: brand_form_request_enqueue writes one queued row per person (the
// 24-hour per-person throttle, the per-brand daily text limit, quiet hours).
// The drain claims pages of 25 (brand_form_request_claim_batch mints each
// guest's personal link) and sends each through the existing notify v2
// dispatcher: a text to the phone on file, else an email, honouring consent.
// A crashed send is retried by the next drain; the idempotency key per send
// and channel keeps a retry from sending twice. The personal link travels only
// in a text or email. Reach and cost (which needs the SMS adapter's segment
// counter) live in brandFormRequestPreview.ts, so notify-reminders never pulls
// the SMS adapter into its bundle.

import type { DispatchV2Input, DispatchV2Result } from "./notifyV2.ts";
import {
  BRAND_FORM_REQUEST_CATEGORY,
  brandFormEmailCta,
} from "./brandFormNotify.ts";
import { countryFromE164 } from "./e164Country.ts";

// [TRANSITIONAL] Push (and with it the Explorer inbox row) is off for form
// requests: "Tap to answer" would open nothing until the Explorer /form screen
// exists. Exit condition: the Explorer /form route ships; then set this to true
// and push is tried first again for guests with an account (free, no link).
export const FORM_REQUEST_PUSH_ENABLED = false;

export type ContactChannel = "sms" | "email";
export type FormRequestChannel = "push" | ContactChannel;
export type FormRequestKind = "ask" | "remind" | "auto";
export type FormRequestAudienceKind = "unanswered" | "everyone";

export const FORM_LINK_ORIGIN = "https://host.usemingla.com";
/** The drain page size (the invite pipeline's p_limit). */
export const FORM_REQUEST_PAGE = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The channels a host may tick today (push only once the Explorer form screen ships). */
export function allowedRequestChannels(): FormRequestChannel[] {
  return FORM_REQUEST_PUSH_ENABLED
    ? ["push", "sms", "email"]
    : ["sms", "email"];
}

export interface FormRequestRecipient {
  kind: "rsvp" | "order";
  id: string;
  userId: string | null;
  personKey: string;
  email: string | null;
  phone: string | null;
  answered: boolean;
  throttled: boolean;
  /** The contact route the server chose for the ticked channels (text before email). */
  route: ContactChannel[];
  smsOptedOut: boolean;
}

export interface FormRequestAudience {
  formId: string;
  eventId: string;
  brandId: string;
  formName: string;
  eventTitle: string;
  brandName: string;
  eventStartsAt: string | null;
  textsToday: number;
  textCap: number;
  textsWaitUntil: string | null;
  recipients: FormRequestRecipient[];
}

export interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

export interface FormRequestDeps {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
  dispatch: (input: DispatchV2Input) => Promise<DispatchV2Result>;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;
const int = (v: unknown): number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0;
const contactRoute = (v: unknown): ContactChannel[] =>
  Array.isArray(v)
    ? v.filter((c): c is ContactChannel => c === "sms" || c === "email")
    : [];

/** The audience read, checked field by field (a malformed row is refused, never guessed). */
export function parseAudience(value: unknown): FormRequestAudience {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("form_request_audience_invalid");
  }
  const v = value as Record<string, unknown>;
  const ids = [v.formId, v.eventId, v.brandId];
  if (
    !ids.every((id) => typeof id === "string" && UUID.test(id)) ||
    !Array.isArray(v.recipients)
  ) {
    throw new Error("form_request_audience_invalid");
  }
  const recipients = v.recipients.map((row): FormRequestRecipient => {
    const r = (typeof row === "object" && row !== null ? row : {}) as Record<
      string,
      unknown
    >;
    if (
      (r.kind !== "rsvp" && r.kind !== "order") || typeof r.id !== "string" ||
      !UUID.test(r.id) || typeof r.personKey !== "string"
    ) {
      throw new Error("form_request_audience_invalid");
    }
    return {
      kind: r.kind,
      id: r.id,
      userId: str(r.userId),
      personKey: r.personKey,
      email: str(r.email),
      phone: str(r.phone),
      answered: r.answered === true,
      throttled: r.throttled === true,
      route: contactRoute(r.route),
      smsOptedOut: r.smsOptedOut === true,
    };
  });
  return {
    formId: v.formId as string,
    eventId: v.eventId as string,
    brandId: v.brandId as string,
    formName: str(v.formName) ?? "",
    eventTitle: str(v.eventTitle) ?? "",
    brandName: str(v.brandName) ?? "",
    eventStartsAt: str(v.eventStartsAt),
    textsToday: int(v.textsToday),
    textCap: int(v.textCap),
    textsWaitUntil: str(v.textsWaitUntil),
    recipients,
  };
}

/**
 * The channels tried for one guest, in order (the first that sends wins): push
 * to their account only while FORM_REQUEST_PUSH_ENABLED, then the server's
 * contact route (text before email) narrowed to the ticked channels. Empty:
 * they can't be reached.
 */
export function routeFor(
  r: { userId: string | null; route: readonly ContactChannel[] },
  channels: readonly FormRequestChannel[],
): FormRequestChannel[] {
  const out: FormRequestChannel[] = [];
  if (
    FORM_REQUEST_PUSH_ENABLED && channels.includes("push") && r.userId !== null
  ) out.push("push");
  for (const c of r.route) if (channels.includes(c)) out.push(c);
  return out;
}

/** One claimed request from brand_form_request_claim_batch. */
export interface ClaimedRequest {
  sendId: string;
  token: string;
  formId: string;
  eventId: string;
  subjectKind: "rsvp" | "order";
  subjectId: string;
  userId: string | null;
  route: ContactChannel[];
  phone: string | null;
  email: string | null;
  brandName: string;
  eventTitle: string;
  eventTimezone: string | null;
  startsAt: string | null;
}

export function parseClaimed(value: unknown): ClaimedRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const v = value as Record<string, unknown>;
  if (
    typeof v.sendId !== "string" || !UUID.test(v.sendId) ||
    typeof v.token !== "string" || !/^[0-9a-f]{64}$/.test(v.token) ||
    typeof v.formId !== "string" || !UUID.test(v.formId) ||
    typeof v.eventId !== "string" || !UUID.test(v.eventId) ||
    (v.subjectKind !== "rsvp" && v.subjectKind !== "order") ||
    typeof v.subjectId !== "string" || !UUID.test(v.subjectId)
  ) return null;
  return {
    sendId: v.sendId,
    token: v.token,
    formId: v.formId,
    eventId: v.eventId,
    subjectKind: v.subjectKind,
    subjectId: v.subjectId,
    userId: str(v.userId),
    route: contactRoute(v.route),
    phone: str(v.phone),
    email: str(v.email),
    brandName: str(v.brandName) ?? "",
    eventTitle: str(v.eventTitle) ?? "",
    eventTimezone: str(v.eventTimezone),
    startsAt: str(v.startsAt),
  };
}

// A retried claim (its first try died after the provider took the send) meets
// the dispatcher's (idempotency key, channel) slot and comes back "duplicate":
// that channel already sent, so it counts as sent and stops the route (no
// email on top of the text, no "failed" that lets the host pay again).
function delivered(
  result: DispatchV2Result,
  channel: FormRequestChannel,
): boolean {
  if (!result.success) return false;
  return (result.deliveries ?? []).some((d) =>
    d.channel === channel &&
    (d.status === "sent" || d.status === "sending" ||
      d.status === "delivered" || d.status === "queued" ||
      d.status === "duplicate")
  );
}

/** Send one claimed request on its route until one channel sends, then settle it. */
export async function sendClaimed(
  deps: FormRequestDeps,
  c: ClaimedRequest,
): Promise<boolean> {
  const route = routeFor(
    { userId: c.userId, route: c.route },
    allowedRequestChannels(),
  );
  const formUrl = `${FORM_LINK_ORIGIN}/form/${c.formId}#t=${c.token}`;
  const payload: Record<string, unknown> = {
    form_id: c.formId,
    event_id: c.eventId,
    ...(c.subjectKind === "rsvp"
      ? { rsvp_id: c.subjectId }
      : { order_id: c.subjectId }),
    brand_name: c.brandName,
    event_title: c.eventTitle,
    event_date: c.startsAt,
    event_timezone: c.eventTimezone,
  };
  let sentOn: FormRequestChannel | null = null;
  let lastReason = route.length === 0 ? "no_contact" : "not_delivered";
  for (const channel of route) {
    const contact = channel === "sms"
      ? c.phone
      : channel === "email"
      ? c.email
      : null;
    if (channel !== "push" && contact === null) continue;
    try {
      const result = channel === "push"
        ? await deps.dispatch({
          user_id: c.userId,
          category_key: BRAND_FORM_REQUEST_CATEGORY,
          payload,
          idempotency_key: `brand_form_request:${c.sendId}:push`,
          requested_channel: "push",
        })
        : await deps.dispatch({
          user_id: null,
          contact,
          country_code: channel === "sms" ? countryFromE164(c.phone) : null,
          category_key: BRAND_FORM_REQUEST_CATEGORY,
          payload: { ...payload, form_url: formUrl },
          idempotency_key: `brand_form_request:${c.sendId}:${channel}`,
          email_cta: channel === "email"
            ? brandFormEmailCta(BRAND_FORM_REQUEST_CATEGORY, {
              ...payload,
              form_url: formUrl,
            })
            : undefined,
        });
      if (delivered(result, channel)) {
        sentOn = channel;
        break;
      }
      lastReason = `${channel}_not_delivered`;
    } catch {
      lastReason = `${channel}_dispatch_failed`;
    }
  }
  const settled = await deps.rpc("brand_form_request_settle", {
    p_send_id: c.sendId,
    p_channel: sentOn ?? route[route.length - 1] ?? null,
    p_status: sentOn !== null ? "sent" : "failed",
    p_reason: sentOn !== null ? null : lastReason,
  });
  if (settled.error !== null) {
    console.error("[brand-form-request] settle failed", c.sendId);
  }
  return sentOn !== null;
}

export interface DrainOutcome {
  pages: number;
  sent: number;
  failed: number;
  /** True when the time budget ran out with pages still coming. */
  more: boolean;
}

/**
 * Drain the queue a page at a time (FORM_REQUEST_PAGE, five sends at once)
 * until it is empty or the time budget is spent; the next drain resumes. With
 * a form and page, only that page's requests (the host's own send).
 */
export async function drainFormRequests(
  deps: FormRequestDeps,
  opts: {
    budgetMs: number;
    formId?: string;
    eventId?: string;
    now?: () => number;
  },
): Promise<DrainOutcome> {
  const now = opts.now ?? Date.now;
  const start = now();
  const out: DrainOutcome = { pages: 0, sent: 0, failed: 0, more: false };
  while (now() - start < opts.budgetMs) {
    const claim = await deps.rpc("brand_form_request_claim_batch", {
      p_limit: FORM_REQUEST_PAGE,
      p_form_id: opts.formId ?? null,
      p_event_id: opts.eventId ?? null,
    });
    if (claim.error !== null) {
      throw new Error(`brand_form_request_claim_batch: ${claim.error.message}`);
    }
    const rows = Array.isArray(claim.data) ? claim.data : [];
    if (rows.length === 0) return out;
    out.pages += 1;
    const items = rows.map(parseClaimed);
    out.failed += items.filter((i) => i === null).length;
    const valid = items.filter((i): i is ClaimedRequest => i !== null);
    for (let i = 0; i < valid.length; i += 5) {
      const results = await Promise.all(
        valid.slice(i, i + 5).map((c) => sendClaimed(deps, c)),
      );
      for (const ok of results) {
        if (ok) out.sent += 1;
        else out.failed += 1;
      }
    }
    if (rows.length < FORM_REQUEST_PAGE) return out;
  }
  out.more = true;
  return out;
}

/**
 * The automatic reminders (decision 13), for notify-reminders: queue whatever
 * is due (in SQL, per guest's own date), then drain the queue (this also
 * resumes any host send a dead request left behind). Returns null when nothing
 * was due and nothing was sent.
 */
export async function runAutoFormReminders(
  deps: FormRequestDeps,
  budgetMs = 25_000,
): Promise<
  {
    runs: number;
    queued: number;
    held: number;
    sent: number;
    failed: number;
    more: boolean;
  } | null
> {
  const due = await deps.rpc("brand_form_auto_reminders_due", {});
  if (due.error !== null) {
    throw new Error(`brand_form_auto_reminders_due: ${due.error.message}`);
  }
  const d = (typeof due.data === "object" && due.data !== null &&
      !Array.isArray(due.data)
    ? due.data
    : {}) as Record<string, unknown>;
  const drained = await drainFormRequests(deps, { budgetMs });
  const result = {
    runs: int(d.runs),
    queued: int(d.queued),
    held: int(d.held),
    sent: drained.sent,
    failed: drained.failed,
    more: drained.more,
  };
  return result.runs + result.queued + result.held + result.sent +
        result.failed === 0
    ? null
    : result;
}
