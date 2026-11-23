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

import type {
  FormDispatchInput as DispatchV2Input,
  FormDispatchResult as DispatchV2Result,
} from "./brandFormDispatchTypes.ts";
import {
  BRAND_FORM_REQUEST_CATEGORY,
  brandFormEmailCta,
  brandFormRequestPushDeepLink,
} from "./brandFormNotify.ts";
import { countryFromE164 } from "./e164Country.ts";

// #4541 R3.1: push is a database switch, not a code constant. BRAND_FORMS_PUSH
// (off until Seth turns it on) and BRAND_FORMS_PUSH_EMAIL_ALONGSIDE (on during the
// rollout) are read once per drain through brand_form_push_settings. The SQL
// decides per person whether push is tried (brand_form_push_eligible: the app
// said in the last 45 days that it opens the form), at preview and again at
// claim; a claimed route starts with "push" only then.
export interface FormRequestPushSettings {
  push: boolean;
  emailAlongside: boolean;
}

/** Push off and email alongside on: what a missing or unreadable switch means. */
export const PUSH_SETTINGS_OFF: FormRequestPushSettings = {
  push: false,
  emailAlongside: true,
};

export type ContactChannel = "sms" | "email";
export type FormRequestChannel = "push" | ContactChannel;
export type FormRequestKind = "ask" | "remind" | "auto";
export type FormRequestAudienceKind = "unanswered" | "everyone";

export const FORM_LINK_ORIGIN = "https://host.usemingla.com";
/** The drain page size (the invite pipeline's p_limit). */
export const FORM_REQUEST_PAGE = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The channels a host may tick. #4541 R3.1: "push" is always accepted; while
 * BRAND_FORMS_PUSH is off the server silently removes it (the preview then
 * reads "Push: not available yet").
 */
export function allowedRequestChannels(): FormRequestChannel[] {
  return ["push", "sms", "email"];
}

/** The push switches, read once per drain. An unreadable read never turns push on. */
export async function readPushSettings(
  deps: Pick<FormRequestDeps, "rpc">,
): Promise<FormRequestPushSettings> {
  const read = await deps.rpc("brand_form_push_settings", {});
  if (read.error !== null || typeof read.data !== "object" || read.data === null) {
    console.error("[brand-form-request] push settings unreadable: push off");
    return PUSH_SETTINGS_OFF;
  }
  const d = read.data as Record<string, unknown>;
  return { push: d.push === true, emailAlongside: d.emailAlongside !== false };
}

/** #4541 R1.15: a claimed plus-one is its own subject (rsvp_guest). */
export type FormRequestSubjectKind = "rsvp" | "rsvp_guest" | "order";

const isSubjectKind = (v: unknown): v is FormRequestSubjectKind =>
  v === "rsvp" || v === "rsvp_guest" || v === "order";

export interface FormRequestRecipient {
  kind: FormRequestSubjectKind;
  id: string;
  userId: string | null;
  personKey: string;
  email: string | null;
  phone: string | null;
  answered: boolean;
  throttled: boolean;
  /** The contact route the server chose for the ticked channels (text before email). */
  route: ContactChannel[];
  /** #4541 R3.2: push will be tried first (switch on, push ticked, the person's app can open the form). */
  pushOk: boolean;
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
  /** #4541 R3.1: BRAND_FORMS_PUSH is on. */
  pushAvailable: boolean;
  /** #4541 R5.5: the brand's one monthly text budget (null: no limit). */
  monthlyTextCap: number | null;
  textsLeftThisMonth: number | null;
  recipients: FormRequestRecipient[];
}

export interface RpcResult {
  data: unknown;
  /**
   * #4573: `code` is PostgREST's error code (a SQLSTATE such as 21000 or
   * PT409, or a PGRST code), passed through for the refusal log only.
   */
  error: { message: string; code?: string | null } | null;
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
const intOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
/** A claimed route: push (only first, as the claim puts it) then the contact route. */
const claimedRoute = (v: unknown): FormRequestChannel[] => {
  if (!Array.isArray(v)) return [];
  const contact = contactRoute(v);
  return v[0] === "push" ? ["push", ...contact] : contact;
};

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
      !isSubjectKind(r.kind) || typeof r.id !== "string" ||
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
      pushOk: r.pushOk === true,
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
    pushAvailable: v.pushAvailable === true,
    monthlyTextCap: intOrNull(v.monthlyTextCap),
    textsLeftThisMonth: intOrNull(v.textsLeftThisMonth),
    recipients,
  };
}

/**
 * The channels tried for one guest, in order (the first that sends wins): push
 * when the server said it will be tried (pushOk: the switch, push ticked, an
 * app that opens the form), then the server's contact route (text before
 * email) narrowed to the ticked channels. Empty: they can't be reached.
 */
export function routeFor(
  r: { pushOk?: boolean; route: readonly ContactChannel[] },
  channels: readonly FormRequestChannel[],
): FormRequestChannel[] {
  const out: FormRequestChannel[] = [];
  if (channels.includes("push") && r.pushOk === true) out.push("push");
  for (const c of r.route) if (channels.includes(c)) out.push(c);
  return out;
}

/** One claimed request from brand_form_request_claim_batch. */
export interface ClaimedRequest {
  sendId: string;
  token: string;
  formId: string;
  eventId: string;
  subjectKind: FormRequestSubjectKind;
  subjectId: string;
  userId: string | null;
  /** #4541: ask, remind or the automatic reminder (the push wording). */
  kind: FormRequestKind;
  /** "push" first only when the claim decided the person's app can open the form. */
  route: FormRequestChannel[];
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
    !isSubjectKind(v.subjectKind) ||
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
    kind: v.kind === "remind" || v.kind === "auto" ? v.kind : "ask",
    route: claimedRoute(v.route),
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

/**
 * Send one claimed request on its route until one channel sends, then settle it.
 * #4541 R3.4: push first when the claim put it there and BRAND_FORMS_PUSH is on.
 * A delivered push is followed by the email (the same personal link) while
 * BRAND_FORMS_PUSH_EMAIL_ALONGSIDE is on, never by a text; a push that did not
 * deliver continues as today (text, then email). The push carries only a deep
 * link built from ids (R3.3) and no link, token or contact (R3.6).
 */
export async function sendClaimed(
  deps: FormRequestDeps,
  c: ClaimedRequest,
  settings: FormRequestPushSettings = PUSH_SETTINGS_OFF,
): Promise<boolean> {
  const route = c.route.filter((ch) =>
    ch !== "push" || (settings.push && c.userId !== null)
  );
  const formUrl = `${FORM_LINK_ORIGIN}/form/${c.formId}#t=${c.token}`;
  const payload: Record<string, unknown> = {
    form_id: c.formId,
    event_id: c.eventId,
    ...(c.subjectKind === "rsvp"
      ? { rsvp_id: c.subjectId }
      : c.subjectKind === "rsvp_guest"
      ? { rsvp_guest_id: c.subjectId }
      : { order_id: c.subjectId }),
    brand_name: c.brandName,
    event_title: c.eventTitle,
    event_date: c.startsAt,
    event_timezone: c.eventTimezone,
    request_kind: c.kind,
  };
  const sendContact = async (channel: ContactChannel, contact: string) =>
    await deps.dispatch({
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
  let sentOn: FormRequestChannel | null = null;
  let withEmail = false;
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
          deep_link: brandFormRequestPushDeepLink({
            formId: c.formId,
            eventId: c.eventId,
            subjectKind: c.subjectKind,
            subjectId: c.subjectId,
          }),
          idempotency_key: `brand_form_request:${c.sendId}:push`,
          requested_channel: "push",
        })
        : await sendContact(channel, contact as string);
      if (delivered(result, channel)) {
        sentOn = channel;
        break;
      }
      lastReason = `${channel}_not_delivered`;
    } catch {
      lastReason = `${channel}_dispatch_failed`;
    }
  }
  if (sentOn === "push" && settings.emailAlongside && c.email !== null) {
    try {
      withEmail = delivered(await sendContact("email", c.email), "email");
    } catch {
      withEmail = false;
    }
    if (!withEmail) console.error("[brand-form-request] email alongside push not delivered", c.sendId);
  }
  const settled = await deps.rpc("brand_form_request_settle", {
    p_send_id: c.sendId,
    p_channel: sentOn ?? route[route.length - 1] ?? null,
    p_status: sentOn !== null ? "sent" : "failed",
    // The delivery log shows both channels when the email went alongside the push.
    p_reason: sentOn === null ? lastReason : withEmail ? "push_and_email" : null,
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
  /** #4541 R1.8: the forms off switch was on, so nothing was claimed or sent. */
  paused?: boolean;
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
  // #4541 R1.8: the off switch stops texts, pushes and emails too. Read once per
  // run; switched on, nothing is claimed and every queued row stays queued.
  const off = await deps.rpc("brand_forms_switched_off", {});
  if (off.error !== null) {
    throw new Error(`brand_forms_switched_off: ${off.error.message}`);
  }
  if (off.data === true) return { ...out, paused: true };
  // #4541 R3.1: the push switches, once per run.
  const settings = await readPushSettings(deps);
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
        valid.slice(i, i + 5).map((c) => sendClaimed(deps, c, settings)),
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
