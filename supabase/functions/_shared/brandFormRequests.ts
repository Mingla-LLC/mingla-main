// #4514 wave 4 — Ask guests to answer, Remind and the automatic reminder.
//
// One owner for who a form request reaches, how, what it may cost, and the send
// loop. Used by guest-roster-actions (the host's Ask and Remind, preview then
// send) and notify-reminders (the optional reminder two days before).
//
// Decision 17: a request never creates an invite. Each guest is claimed in SQL
// (brand_form_request_claim: the 24-hour per-guest throttle, the personal brand
// form link) and sent through the existing notify v2 dispatcher, the rail RSVP
// and ticket messages use: push to the guest's account first when ticked (free,
// no link), else their contact on file, a phone before an email, as the ticket
// reminders choose. The personal link travels only in a text or email.

import type { DispatchV2Input, DispatchV2Result } from "./notifyV2.ts";
import {
  BRAND_FORM_REQUEST_CATEGORY,
  brandFormEmailCta,
} from "./brandFormNotify.ts";
import { countryFromE164 } from "./e164Country.ts";
import type { SmsRateV1 } from "./smsPriceTable.ts";

export type FormRequestChannel = "push" | "sms" | "email";
export type FormRequestKind = "ask" | "remind" | "auto";
export type FormRequestAudienceKind = "unanswered" | "everyone";

export const FORM_LINK_ORIGIN = "https://host.usemingla.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FormRequestRecipient {
  kind: "rsvp" | "order";
  id: string;
  userId: string | null;
  email: string | null;
  phone: string | null;
  answered: boolean;
  throttled: boolean;
  smsAllowed: boolean;
  emailAllowed: boolean;
}

export interface FormRequestAudience {
  formId: string;
  eventId: string;
  brandId: string;
  formName: string;
  eventTitle: string;
  brandName: string;
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
      !UUID.test(r.id)
    ) {
      throw new Error("form_request_audience_invalid");
    }
    return {
      kind: r.kind,
      id: r.id,
      userId: str(r.userId),
      email: str(r.email),
      phone: str(r.phone),
      answered: r.answered === true,
      throttled: r.throttled === true,
      smsAllowed: r.smsAllowed === true,
      emailAllowed: r.emailAllowed === true,
    };
  });
  return {
    formId: v.formId as string,
    eventId: v.eventId as string,
    brandId: v.brandId as string,
    formName: str(v.formName) ?? "",
    eventTitle: str(v.eventTitle) ?? "",
    brandName: str(v.brandName) ?? "",
    recipients,
  };
}

/**
 * The channels tried for one guest, in order (the first that sends wins): push
 * to their account when ticked, then their contact on file (phone before email)
 * on a ticked channel the consent gate allows. Empty: they can't be reached.
 */
export function routeFor(
  r: FormRequestRecipient,
  channels: readonly FormRequestChannel[],
): FormRequestChannel[] {
  const out: FormRequestChannel[] = [];
  if (channels.includes("push") && r.userId !== null) out.push("push");
  if (r.phone !== null && channels.includes("sms") && r.smsAllowed) {
    out.push("sms");
  } else if (r.email !== null && channels.includes("email") && r.emailAllowed) {
    out.push("email");
  }
  return out;
}

export interface FormRequestPreview {
  selectedCount: number;
  reachableCount: number;
  throttledCount: number;
  smsOptedOutCount: number;
  unreachableCount: number;
  perChannelReachable: Record<FormRequestChannel, number>;
  smsCount: number;
  estimatedCostMinor: number | null;
  currency: string | null;
}

/** The longest text a request sends, for the segment estimate (GSM: 160, then 153 a part). */
export function requestSmsSegments(
  brandName: string,
  eventTitle: string,
): number {
  const fakeLink = `${FORM_LINK_ORIGIN}/form/${"0".repeat(36)}#t=${
    "0".repeat(64)
  }`;
  const text = `${brandName.slice(0, 80)} has a few questions about ${
    eventTitle.slice(0, 90)
  }. Answer here: ${fakeLink}`;
  return text.length <= 160 ? 1 : Math.ceil(text.length / 153);
}

/**
 * Reach and cost before sending. Texts are counted for every guest whose route
 * includes one (a push that fails falls back to the text), so the cost is an
 * upper bound. Unpriced countries or mixed currencies: no amount, never a guess.
 */
export function previewFormRequest(
  audience: FormRequestAudience,
  channels: readonly FormRequestChannel[],
  rates: readonly SmsRateV1[] | null,
): FormRequestPreview {
  const per: Record<FormRequestChannel, number> = { push: 0, sms: 0, email: 0 };
  let reachable = 0, throttled = 0, optedOut = 0, unreachable = 0, smsCount = 0;
  let costNumer = 0;
  let priced = rates !== null;
  let currency: string | null = null;
  const segments = requestSmsSegments(audience.brandName, audience.eventTitle);
  for (const r of audience.recipients) {
    if (r.throttled) {
      throttled += 1;
      continue;
    }
    const route = routeFor(r, channels);
    if (route.length === 0) {
      if (r.phone !== null && channels.includes("sms") && !r.smsAllowed) {
        optedOut += 1;
      } else unreachable += 1;
      continue;
    }
    reachable += 1;
    per[route[0]] += 1;
    if (route.includes("sms") && r.phone !== null) {
      smsCount += 1;
      const country = countryFromE164(r.phone);
      const rate = rates?.find((x) => x.country === country);
      if (
        rate === undefined || (currency !== null && rate.currency !== currency)
      ) {
        priced = false;
      } else {
        currency = rate.currency;
        costNumer += (segments * rate.minorNumerator) / rate.minorDenominator;
      }
    }
  }
  return {
    selectedCount: audience.recipients.length,
    reachableCount: reachable,
    throttledCount: throttled,
    smsOptedOutCount: optedOut,
    unreachableCount: unreachable,
    perChannelReachable: per,
    smsCount,
    estimatedCostMinor: smsCount === 0
      ? 0
      : priced
      ? Math.ceil(costNumer)
      : null,
    currency: smsCount === 0 ? null : priced ? currency : null,
  };
}

export interface FormRequestOutcome {
  sent: number;
  failed: number;
  skipped: Record<
    "throttled" | "answered" | "not_a_guest" | "form_closed" | "unreachable",
    number
  >;
}

function delivered(
  result: DispatchV2Result,
  channel: FormRequestChannel,
): boolean {
  if (!result.success) return false;
  return (result.deliveries ?? []).some((d) =>
    d.channel === channel &&
    (d.status === "sent" || d.status === "sending" ||
      d.status === "delivered" || d.status === "queued")
  );
}

/** Send one guest's request: claim (throttle, link), then each route channel until one sends. */
async function sendOne(
  deps: FormRequestDeps,
  audience: FormRequestAudience,
  r: FormRequestRecipient,
  channels: readonly FormRequestChannel[],
  kind: FormRequestKind,
  actorId: string | null,
  out: FormRequestOutcome,
): Promise<void> {
  const route = routeFor(r, channels);
  if (route.length === 0) {
    out.skipped.unreachable += 1;
    return;
  }
  const claim = await deps.rpc("brand_form_request_claim", {
    p_form_id: audience.formId,
    p_event_id: audience.eventId,
    p_subject: { kind: r.kind, id: r.id },
    p_kind: kind,
    p_actor_id: actorId,
  });
  if (
    claim.error !== null || typeof claim.data !== "object" ||
    claim.data === null
  ) {
    out.failed += 1;
    return;
  }
  const c = claim.data as {
    claimed?: boolean;
    reason?: string;
    sendId?: string;
    token?: string;
  };
  if (c.claimed !== true) {
    const reason = c.reason;
    if (
      reason === "throttled" || reason === "answered" ||
      reason === "not_a_guest" || reason === "form_closed"
    ) {
      out.skipped[reason] += 1;
    } else out.failed += 1;
    return;
  }
  if (
    typeof c.sendId !== "string" || typeof c.token !== "string" ||
    !/^[0-9a-f]{64}$/.test(c.token)
  ) {
    out.failed += 1;
    return;
  }
  const formUrl = `${FORM_LINK_ORIGIN}/form/${audience.formId}#t=${c.token}`;
  const payload: Record<string, unknown> = {
    form_id: audience.formId,
    event_id: audience.eventId,
    ...(r.kind === "rsvp" ? { rsvp_id: r.id } : { order_id: r.id }),
    brand_name: audience.brandName,
    event_title: audience.eventTitle,
  };
  let sentOn: FormRequestChannel | null = null;
  let lastReason = "not_delivered";
  for (const channel of route) {
    try {
      const result = channel === "push"
        ? await deps.dispatch({
          user_id: r.userId,
          category_key: BRAND_FORM_REQUEST_CATEGORY,
          payload,
          idempotency_key: `brand_form_request:${c.sendId}:push`,
          requested_channel: "push",
        })
        : await deps.dispatch({
          user_id: null,
          contact: channel === "sms" ? r.phone : r.email,
          country_code: channel === "sms" ? countryFromE164(r.phone) : null,
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
    p_channel: sentOn ?? route[route.length - 1],
    p_status: sentOn !== null ? "sent" : "failed",
    p_reason: sentOn !== null ? null : lastReason,
  });
  if (settled.error !== null) {
    console.error("[brand-form-request] settle failed", c.sendId);
  }
  if (sentOn !== null) out.sent += 1;
  else out.failed += 1;
}

/** Send to every guest of the audience who is not throttled, five at a time. */
export async function sendFormRequests(
  deps: FormRequestDeps,
  audience: FormRequestAudience,
  channels: readonly FormRequestChannel[],
  kind: FormRequestKind,
  actorId: string | null,
): Promise<FormRequestOutcome> {
  const out: FormRequestOutcome = {
    sent: 0,
    failed: 0,
    skipped: {
      throttled: 0,
      answered: 0,
      not_a_guest: 0,
      form_closed: 0,
      unreachable: 0,
    },
  };
  const queue = audience.recipients.filter((r) => {
    if (r.throttled) {
      out.skipped.throttled += 1;
      return false;
    }
    if (kind !== "ask" && r.answered) {
      out.skipped.answered += 1;
      return false;
    }
    return true;
  });
  for (let i = 0; i < queue.length; i += 5) {
    await Promise.all(
      queue.slice(i, i + 5).map((r) =>
        sendOne(deps, audience, r, channels, kind, actorId, out)
      ),
    );
  }
  return out;
}

/**
 * The automatic reminders (decision 13), for notify-reminders. Returns null and
 * touches nothing beyond one read when none is due. Push first (free), then only
 * the channels the host ticked when switching it on (stored on the attachment;
 * email and push by default, so no text is paid for unless the host chose it).
 */
export async function runAutoFormReminders(deps: FormRequestDeps): Promise<
  { pages: number; sent: number; failed: number } | null
> {
  const due = await deps.rpc("brand_form_auto_reminders_due", {});
  if (due.error !== null) {
    throw new Error(`brand_form_auto_reminders_due: ${due.error.message}`);
  }
  const pages = Array.isArray(due.data)
    ? due.data as Array<
      {
        attachmentId?: unknown;
        formId?: unknown;
        eventId?: unknown;
        channels?: unknown;
      }
    >
    : [];
  if (pages.length === 0) return null;
  let sent = 0, failed = 0;
  for (const page of pages) {
    try {
      const read = await deps.rpc("brand_form_request_audience", {
        p_actor_id: null,
        p_form_id: page.formId,
        p_event_id: page.eventId,
        p_audience: "unanswered",
        p_subjects: null,
      });
      if (read.error !== null) throw new Error(read.error.message);
      const ticked = Array.isArray(page.channels)
        ? page.channels.filter((c): c is FormRequestChannel =>
          c === "push" || c === "sms" || c === "email"
        )
        : [];
      const channels: FormRequestChannel[] = [
        "push",
        ...ticked.filter((c) => c !== "push"),
      ];
      const outcome = await sendFormRequests(
        deps,
        parseAudience(read.data),
        channels,
        "auto",
        null,
      );
      sent += outcome.sent;
      failed += outcome.failed;
      await deps.rpc("brand_form_auto_reminder_settle", {
        p_attachment_id: page.attachmentId,
      });
    } catch (error) {
      failed += 1;
      console.error(
        "[brand-form-request] automatic reminder failed",
        page.attachmentId,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return { pages: pages.length, sent, failed };
}
