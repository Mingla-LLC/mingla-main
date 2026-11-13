// Issue #3827 — the part of the RSVP delivery worker that tells buyers and
// guests about a material change to a live listing.
//
// The database decides everything: `event_edit_notice_fanout` turns a due
// notice into delivery rows, and each row carries only the notice id. This
// module loads the notice, renders the email through
// `_shared/email/eventUpdatedEmail.ts`, and gives the other channels a real
// sentence. A row without a notice id never reaches this file.

import { canonicalAdDestinationUrl } from "../_shared/adDestination.ts";
import {
  cleanLine,
  type EventUpdateChange,
  type EventUpdateKind,
  eventUpdateReplyTo,
  eventUpdateShortLine,
  renderEventUpdatedEmail,
} from "../_shared/email/eventUpdatedEmail.ts";
import type { RsvpChannelInput } from "../_shared/notifyV2.ts";
// Issue #4422 — the change text is one segment, with a short event link.
import type { ClaimLinkAdmin } from "../_shared/claimLink.ts";
import { eventLinkExpiry, resolveBuyerLink } from "../_shared/messageLinks.ts";
import { formatMessageTime } from "../_shared/messageTime.ts";
import { renderChangeSms } from "../_shared/sms/buyerSms.ts";

interface QueryError {
  code?: string | null;
  message?: string | null;
}

/** The slice of the Supabase client this module uses. */
export interface NoticeAdminClient {
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: QueryError | null }>;
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: unknown; error: QueryError | null }>;
      };
    };
  };
}

/** PostgREST and Postgres both say "no such function" in their own way. */
export function isMissingFunctionError(error: QueryError | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const message = String(error.message ?? "").toLowerCase();
  return code === "PGRST202" || code === "42883" ||
    message.includes("could not find the function") ||
    (message.includes("function") && message.includes("does not exist"));
}

/**
 * Turn due edit notices into delivery rows. The edge function ships before the
 * migration is applied, so a missing function is "nothing to do", not an
 * error. Any other failure is logged and never blocks the rest of the tick.
 */
export async function fanOutEventEditNotices(
  admin: NoticeAdminClient,
): Promise<"ran" | "missing" | "failed"> {
  try {
    const { error } = await admin.rpc("event_edit_notice_fanout", { p_limit: 20 });
    if (!error) return "ran";
    if (isMissingFunctionError(error)) return "missing";
    console.error("[rsvp-notify] event edit fan-out failed", String(error.code ?? "unknown"));
    return "failed";
  } catch {
    console.error("[rsvp-notify] event edit fan-out threw");
    return "failed";
  }
}

export interface NoticeContext {
  noticeId: string;
  kind: EventUpdateKind;
  eventName: string;
  brandName: string;
  brandContactEmail: string | null;
  timezone: string | null;
  changes: EventUpdateChange[];
  reason: string | null;
  venueName: string | null;
  eventUrl: string;
  /** Issue #4422 — the event the short link points at, and when its last
   * date ends (the link lives until 30 days after). */
  eventId?: string | null;
  lastEndAt?: string | null;
}

export type NoticeLoadResult =
  | { state: "ready"; context: NoticeContext }
  /** Could not be read: try again later. */
  | { state: "unavailable" }
  /** The listing is no longer on sale, or the notice was withdrawn. */
  | { state: "not_live" };

export type NoticeLoader = (noticeId: string) => Promise<NoticeLoadResult>;

const asText = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

async function loadNotice(
  admin: NoticeAdminClient,
  noticeId: string,
): Promise<NoticeLoadResult> {
  try {
    const noticeRead = await admin.from("event_edit_notices")
      .select("id,event_id,state,reason,notice_changes,after_snapshot")
      .eq("id", noticeId).maybeSingle();
    if (noticeRead.error) return { state: "unavailable" };
    const notice = noticeRead.data as {
      event_id?: string;
      state?: string;
      reason?: string | null;
      notice_changes?: unknown;
      after_snapshot?: Record<string, unknown> | null;
    } | null;
    if (!notice || !notice.event_id) return { state: "not_live" };
    if (notice.state !== "fanned_out") return { state: "not_live" };

    const eventRead = await admin.from("events")
      .select(
        // The address-hiding switch is read as it is NOW, not as it was when
        // the notice was recorded (issue #3827 rework M1).
        "id,title,slug,timezone,event_type,status,deleted_at,address_withheld:theme->business_event->>hideAddressUntilTicket,brands(name,slug,contact_email,deleted_at),event_dates(start_at,end_at,cancelled_at)",
      )
      .eq("id", notice.event_id).maybeSingle();
    if (eventRead.error) return { state: "unavailable" };
    const event = eventRead.data as {
      title?: string | null;
      slug?: string | null;
      timezone?: string | null;
      event_type?: string | null;
      status?: string | null;
      deleted_at?: string | null;
      address_withheld?: unknown;
      brands?: unknown;
      event_dates?: unknown;
    } | null;
    const brand = (Array.isArray(event?.brands) ? event?.brands[0] : event?.brands) as {
      name?: string | null;
      slug?: string | null;
      contact_email?: string | null;
      deleted_at?: string | null;
    } | null | undefined;
    if (
      !event || event.deleted_at || !brand || brand.deleted_at ||
      !["scheduled", "live"].includes(String(event.status)) ||
      !["event", "rsvp", "experience"].includes(String(event.event_type))
    ) return { state: "not_live" };
    const brandSlug = asText(brand.slug);
    const eventSlug = asText(event.slug);
    if (!brandSlug || !eventSlug) return { state: "not_live" };

    const kind = event.event_type as EventUpdateKind;
    const recorded = Array.isArray(notice.notice_changes)
      ? notice.notice_changes.filter((entry): entry is EventUpdateChange =>
        !!entry && typeof entry === "object" &&
        typeof (entry as EventUpdateChange).field === "string"
      )
      : [];
    // An address hidden NOW is never printed, whatever the notice holds.
    const changes = withholdIfHiddenNow(
      recorded,
      isAddressWithheldNow(event.address_withheld),
      notice.after_snapshot?.venue_from_label === true,
    );
    return {
      state: "ready",
      context: {
        noticeId,
        kind,
        eventName: asText(event.title) ?? (kind === "experience" ? "your experience" : "your event"),
        brandName: asText(brand.name) ?? "The host",
        brandContactEmail: asText(brand.contact_email),
        timezone: asText(event.timezone),
        changes,
        reason: asText(notice.reason),
        venueName: asText(notice.after_snapshot?.venue),
        eventUrl: canonicalAdDestinationUrl(kind, brandSlug, eventSlug),
        eventId: notice.event_id,
        lastEndAt: lastLiveEnd(event.event_dates),
      },
    };
  } catch {
    return { state: "unavailable" };
  }
}

/** The latest end among the dates that are not cancelled, or null. */
function lastLiveEnd(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  let latest: number | null = null;
  for (const row of raw) {
    const date = row as {
      start_at?: unknown;
      end_at?: unknown;
      cancelled_at?: unknown;
    };
    if (date?.cancelled_at) continue;
    const value = asText(date?.end_at) ?? asText(date?.start_at);
    const ms = value ? Date.parse(value) : Number.NaN;
    if (!Number.isNaN(ms) && (latest === null || ms > latest)) latest = ms;
  }
  return latest === null ? null : new Date(latest).toISOString();
}

export type SendCheck = "ok" | "held_feature_off" | "held_allowlist" | "notice_missing" | "unavailable";

/**
 * Issue #3827 rework F4 — the last word before a provider call. The switches,
 * the pilot and the allowlist are re-read for every copy, so switching the
 * feature off stops copies fanned out but not yet sent. Any answer this
 * worker does not know is "unavailable" (the copy is retried, never sent).
 */
export async function checkNoticeSend(
  admin: NoticeAdminClient,
  noticeId: string,
  email: string | null,
): Promise<SendCheck> {
  try {
    const { data, error } = await admin.rpc("event_edit_notice_send_check", {
      p_notice_id: noticeId,
      p_email: email,
    });
    if (error) return "unavailable";
    return data === "ok" || data === "held_feature_off" || data === "held_allowlist" ||
        data === "notice_missing"
      ? data
      : "unavailable";
  } catch {
    return "unavailable";
  }
}

/** The stored switch, as PostgREST hands back a `->>` read: text or null. */
export function isAddressWithheldNow(raw: unknown): boolean {
  return raw === true || (typeof raw === "string" && raw.trim().toLowerCase() === "true");
}

/**
 * Issue #3827 rework M1. When the event hides its address now, every street
 * value in the notice is dropped: the address row says only that it changed,
 * and a venue that was only ever the label (which can hold the street) loses
 * its values too. The venue name of a structured location stays: the public
 * page shows it.
 */
export function withholdIfHiddenNow(
  changes: EventUpdateChange[],
  withheldNow: boolean,
  venueFromLabel: boolean,
): EventUpdateChange[] {
  if (!withheldNow) return changes;
  return changes.map((change) => {
    if (change.field === "address") return { field: "address", withheld: true };
    if (change.field === "venue" && venueFromLabel) return { field: "venue", withheld: true };
    return change;
  });
}

/** One read per notice per invocation, however many recipients share it. */
export function createNoticeLoader(admin: NoticeAdminClient): NoticeLoader {
  const cache = new Map<string, Promise<NoticeLoadResult>>();
  return (noticeId: string) => {
    let pending = cache.get(noticeId);
    if (!pending) {
      pending = loadNotice(admin, noticeId);
      cache.set(noticeId, pending);
    }
    return pending;
  };
}

export interface EventUpdateDispatch {
  title: string;
  body: string;
  sms: string;
  link: string;
  emailOverride: NonNullable<RsvpChannelInput["email_override"]>;
}

/** The one new start when the date (and nothing else) changed, or null. */
function onlyNewStart(changes: EventUpdateChange[]): string | null {
  if (
    changes.length === 0 ||
    !changes.every((c) => c.field === "dates" || c.field === "timezone")
  ) return null;
  const dates = changes.filter((c) => c.field === "dates");
  if (dates.length !== 1 || dates[0].many === true) return null;
  const pairs = Array.isArray(dates[0].new)
    ? dates[0].new.filter((pair) =>
      !!pair && typeof pair === "object" &&
      typeof (pair as { s?: unknown }).s === "string"
    ) as Array<{ s: string }>
    : [];
  return pairs.length === 1 ? pairs[0].s : null;
}

/**
 * Issue #4422 — the change text, one GSM-7 segment: "moved to <date> <time>"
 * when the date alone changed to one new start, "has a new venue" when only
 * the venue or address changed, otherwise "has changed".
 */
function changeSms(
  context: NoticeContext,
  link: string,
): string {
  const start = onlyNewStart(context.changes);
  const when = start === null
    ? null
    : formatMessageTime(start, context.timezone);
  if (when !== null) {
    return renderChangeSms("S20", {
      title: context.eventName,
      date: when.date,
      time: when.time,
      link,
    });
  }
  const venueOnly = context.changes.length > 0 &&
    context.changes.every((c) => c.field === "venue" || c.field === "address");
  return renderChangeSms(venueOnly ? "S20V" : "S20D", {
    title: context.eventName,
    link,
  });
}

/**
 * What to send for one recipient of a notice. Throws
 * `event_update_email_nothing_to_say` when the notice holds nothing printable.
 * `links` mints the shared short event link for the text; without it (or when
 * minting fails) the text carries the full page link, or no link when that
 * does not fit one segment. `withSms` false (an email, push or in-app row)
 * builds no text at all, so a text can never hold back another channel.
 */
export async function buildEventUpdateDispatch(
  context: NoticeContext,
  payload: Record<string, unknown>,
  links: ClaimLinkAdmin | null = null,
  withSms = true,
): Promise<EventUpdateDispatch> {
  const rendered = renderEventUpdatedEmail({
    kind: context.kind,
    eventName: context.eventName,
    brandName: context.brandName,
    recipientName: asText(payload.recipientName),
    timezone: context.timezone,
    changes: context.changes,
    reason: context.reason,
    eventUrl: context.eventUrl,
    venueName: context.venueName,
  });
  const eventName = cleanLine(context.eventName, 120);
  const short = eventUpdateShortLine(context.kind, context.brandName, context.changes);
  const smsLink = !withSms
    ? ""
    : links && context.eventId
    ? (await resolveBuyerLink(links, {
      kind: "event_page",
      sourceId: context.eventId,
      targetUrl: context.eventUrl,
      expiresAt: eventLinkExpiry({ lastEndAt: context.lastEndAt ?? null }),
    })).display
    : context.eventUrl.replace(/^https:\/\//, "");
  return {
    title: `Plans changed: ${eventName}`,
    body: short,
    sms: withSms ? changeSms(context, smsLink) : "",
    link: context.eventUrl,
    emailOverride: {
      rendered: {
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        from: rendered.from,
      },
      replyTo: eventUpdateReplyTo(context.brandContactEmail),
    },
  };
}

/**
 * Run `worker` over `items`, at most `size` at a time, group after group. A
 * worker that throws is reported and never stops later groups.
 */
export async function inGroupsOf<T>(
  items: readonly T[],
  size: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const step = Math.max(1, Math.floor(size));
  for (let index = 0; index < items.length; index += step) {
    // allSettled: one failing copy never stops the groups after it.
    const results = await Promise.allSettled(
      items.slice(index, index + step).map((item) => worker(item)),
    );
    const failed = results.filter((result) => result.status === "rejected").length;
    if (failed > 0) {
      console.error(`[rsvp-notify] ${failed} edit-notice deliveries threw; the rest went on`);
    }
  }
}
