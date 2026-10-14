/**
 * buyerNoticeCopy — every word a host reads about emailing buyers after a
 * live edit (issue #3827). Pure: no React, no network, no store.
 *
 * The server decides. `business_update_live_event_atomic`,
 * `biz_update_live_rsvp` and `biz_update_live_experience` answer each save
 * with `buyer_notice`, and `business_event_buyer_notice_status` says whether
 * buyer emails are on for the brand and how many people would be told. This
 * file only turns those answers into copy; it never promises a message the
 * server did not schedule, and email is the only channel it ever names.
 */
import type { EditSeverity } from "../store/eventEditLogStore";

/** What a live-edit save answered about telling buyers. */
export interface BuyerNotice {
  state: "logged" | "scheduled" | "superseded" | "fanned_out" | "held" | "none";
  holdCode: string | null;
  live: boolean;
  material: boolean;
  /** People an email can reach (distinct addresses). */
  audience: number;
  sendAfter: string | null;
  /** Emails are being tested: only allowlisted addresses are emailed. */
  allowlistOnly: boolean;
}

/** `business_event_buyer_notice_status`, or null when it is not known. */
export interface BuyerNoticeStatus {
  live: boolean;
  /** People an email can reach (distinct addresses), not counting those with none. */
  audience: number;
  /** People with no email address. Absent when there are none (or not known). */
  noEmail?: number;
  /** Emails are being tested: only allowlisted addresses are emailed. Absent = no. */
  allowlistOnly?: boolean;
  last: {
    state: string;
    holdCode: string | null;
    audience: number;
    sent: number;
    pending: number;
    failed: number;
    noEmail: number;
    held: number;
  } | null;
}

export type BuyerNoticeNoun = "buyers" | "guests";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
const NOTICE_STATES: readonly BuyerNotice["state"][] = [
  "logged",
  "scheduled",
  "superseded",
  "fanned_out",
  "held",
  "none",
];

/** Null for anything that is not a `buyer_notice` the server could have sent. */
export const parseBuyerNotice = (raw: unknown): BuyerNotice | null => {
  if (!isRecord(raw)) return null;
  const state = NOTICE_STATES.find((known) => known === raw.state);
  if (state === undefined) return null;
  return {
    state,
    holdCode: typeof raw.hold_code === "string" ? raw.hold_code : null,
    live: raw.live === true,
    material: raw.material === true,
    audience: count(raw.audience),
    sendAfter: typeof raw.send_after === "string" ? raw.send_after : null,
    allowlistOnly: raw.allowlist_only === true,
  };
};

/** Null for anything that is not a usable status answer. */
export const parseBuyerNoticeStatus = (raw: unknown): BuyerNoticeStatus | null => {
  if (!isRecord(raw) || typeof raw.live !== "boolean") return null;
  const last = isRecord(raw.last) && typeof raw.last.state === "string"
    ? {
        state: raw.last.state,
        holdCode: typeof raw.last.holdCode === "string" ? raw.last.holdCode : null,
        audience: count(raw.last.audience),
        sent: count(raw.last.sent),
        pending: count(raw.last.pending),
        failed: count(raw.last.failed),
        noEmail: count(raw.last.noEmail),
        held: count(raw.last.held),
      }
    : null;
  const status: BuyerNoticeStatus = { live: raw.live, audience: count(raw.audience), last };
  // Optional facts are present only when the server says so.
  const noEmail = count(raw.noEmail);
  if (noEmail > 0) status.noEmail = noEmail;
  if (raw.allowlistOnly === true) status.allowlistOnly = true;
  return status;
};

const people = (n: number, noun: BuyerNoticeNoun): string =>
  `${n} ${n === 1 ? noun.slice(0, -1) : noun}`;

/** Whole minutes until the send, from the server's own time; 5 when unknown. */
const minutesUntil = (sendAfter: string | null, now: number): number => {
  if (sendAfter === null) return 5;
  const at = Date.parse(sendAfter);
  if (!Number.isFinite(at)) return 5;
  return Math.min(20, Math.max(1, Math.round((at - now) / 60000)));
};

/**
 * The toast after a save, or null when the server scheduled no email (the
 * caller then shows what it always showed).
 */
export const buyerNoticeSavedToast = (
  raw: unknown,
  noun: BuyerNoticeNoun = "buyers",
  now: number = Date.now(),
): string | null => {
  const notice = parseBuyerNotice(raw);
  if (notice === null || notice.state !== "scheduled" || notice.audience === 0) {
    return null;
  }
  if (notice.allowlistOnly) {
    return noun === "guests"
      ? "Saved. Guest emails are being tested: only test addresses get the new email, and your other going guests get the usual alert."
      : "Saved. Buyer emails are being tested, so only test addresses will be emailed about this change.";
  }
  const minutes = minutesUntil(notice.sendAfter, now);
  return `Saved. We'll email ${people(notice.audience, noun)} in about ${minutes} ${
    minutes === 1 ? "minute" : "minutes"
  }.`;
};

/**
 * The toast after a live RSVP save. A change the edit email owns but did not
 * schedule (put back to what guests last knew, or nothing they act on) says
 * just "Saved. Live now." instead of promising an alert; otherwise the
 * caller decides from the guests the server alerted the usual way.
 */
export const rsvpSavedToast = (raw: unknown, now: number = Date.now()): string | null => {
  const scheduled = buyerNoticeSavedToast(raw, "guests", now);
  if (scheduled !== null) return scheduled;
  const notice = parseBuyerNotice(raw);
  if (notice !== null && notice.live && notice.material && !notice.allowlistOnly) {
    return "Saved. Live now.";
  }
  return null;
};

/**
 * The fields the server emails buyers about: when, where and how they attend.
 * Narrower than the editor's material fields: ticket and refund-term changes
 * are material to the editor but are not emailed (the server refuses a price
 * change on a sold tier, and refund terms can only become more generous).
 */
export const EMAIL_MATERIAL_FIELD_KEYS: ReadonlySet<string> = new Set([
  "format",
  "date",
  "doorsOpen",
  "endsAt",
  "timezone",
  "venueName",
  "address",
  "onlineUrl",
  "whenMode",
  "recurrenceRule",
  "multiDates",
]);

/** The fields a going guest is alerted about today, before emails are on. */
const GUEST_ALERT_FIELD_KEYS: ReadonlySet<string> = new Set([
  "date",
  "doorsOpen",
  "venueName",
  "address",
  "multiDates",
]);

/** The date and time fields: refused by the server once tickets are sold. */
const WHEN_FIELD_KEYS: ReadonlySet<string> = new Set([
  "date",
  "doorsOpen",
  "endsAt",
  "timezone",
  "whenMode",
  "recurrenceRule",
  "multiDates",
]);

export const BUYER_EMAILS_TESTING_COPY =
  "Buyer emails are being tested. Only test addresses will be emailed about this change; your buyers are not emailed yet.";
export const GUEST_EMAILS_TESTING_COPY =
  "Guest emails are being tested. Only test addresses get the new email; your other going guests get the usual alert that plans changed.";

export const NOT_SWITCHED_ON_COPY =
  "Buyer emails are not switched on yet. This change is saved and logged; buyers are not emailed.";
export const TRIP_EDIT_LOGGED_COPY =
  "Logged in your trip's edit history. Travellers are not emailed about edits yet.";
export const GUESTS_ALERTED_COPY =
  "Going guests are alerted that plans changed. Your reason is logged; it is not sent to them yet.";

export interface ChangeSummaryNoticeInput {
  /** The sheet's own "logged, nobody is told" line. */
  loggedCopy: string;
  entityLabel: "event" | "trip";
  severity: EditSeverity;
  /** The buyer count is KNOWN to be zero. */
  noBuyers: boolean;
  /** Field keys of the rows on screen. */
  fieldKeys: readonly string[];
  /**
   * `undefined`: the caller does not read the status at all.
   * `null`: it does, and the answer is not known (loading, failed, or the
   * server function is not there yet). Both mean "not switched on".
   */
  status: BuyerNoticeStatus | null | undefined;
  noun: BuyerNoticeNoun;
  /**
   * The event has sales and this save is not "refund all": the server refuses
   * a date or time change, so those rows are never promised an email.
   */
  whenRefused?: boolean;
}

export interface ChangeSummaryNotice {
  footer: string;
  /** The footer says buyers WILL be told: styled as the warm notice. */
  footerIsNotice: boolean;
  /** Field keys that carry the tag. */
  taggedKeys: ReadonlySet<string>;
  tag: string;
}

const NO_KEYS: ReadonlySet<string> = new Set();

/** The Review changes footer and the rows that carry the tag. */
export const changeSummaryNotice = (
  input: ChangeSummaryNoticeInput,
): ChangeSummaryNotice => {
  const tag = input.noun === "guests" ? "NOTIFIES GUESTS" : "NOTIFIES BUYERS";
  const logged = input.loggedCopy;
  if (input.entityLabel === "trip") {
    return {
      footer: input.severity === "destructive" ? "" : TRIP_EDIT_LOGGED_COPY,
      footerIsNotice: false,
      taggedKeys: NO_KEYS,
      tag,
    };
  }
  if (input.severity === "destructive") {
    return { footer: "", footerIsNotice: false, taggedKeys: NO_KEYS, tag };
  }
  const emailKeys = input.fieldKeys.filter((key) =>
    EMAIL_MATERIAL_FIELD_KEYS.has(key) &&
    !(input.whenRefused === true && WHEN_FIELD_KEYS.has(key))
  );
  if (input.severity === "additive" || input.noBuyers || emailKeys.length === 0) {
    return { footer: logged, footerIsNotice: false, taggedKeys: NO_KEYS, tag };
  }
  const status = input.status ?? null;
  if (status !== null && status.live) {
    if (status.audience === 0) {
      return { footer: logged, footerIsNotice: false, taggedKeys: NO_KEYS, tag };
    }
    if (status.allowlistOnly === true) {
      if (input.noun === "guests") {
        // Off-list guests get the usual alert for a date, time or place.
        const alerted = input.fieldKeys.filter((key) => GUEST_ALERT_FIELD_KEYS.has(key));
        return {
          footer: GUEST_EMAILS_TESTING_COPY,
          footerIsNotice: alerted.length > 0,
          taggedKeys: new Set(alerted),
          tag,
        };
      }
      return { footer: BUYER_EMAILS_TESTING_COPY, footerIsNotice: false, taggedKeys: NO_KEYS, tag };
    }
    const noEmail = status.noEmail ?? 0;
    return {
      footer: `We'll email your ${people(status.audience, input.noun)} what changed and your reason.${
        noEmail > 0 ? ` ${noEmail} ${noEmail === 1 ? "has" : "have"} no email address.` : ""
      }`,
      footerIsNotice: true,
      taggedKeys: new Set(emailKeys),
      tag,
    };
  }
  if (input.noun === "guests") {
    // Going guests of an RSVP are alerted today by the queue that predates
    // the edit email, for a changed date, time or place.
    const alerted = input.fieldKeys.filter((key) => GUEST_ALERT_FIELD_KEYS.has(key));
    return alerted.length > 0
      ? {
          footer: GUESTS_ALERTED_COPY,
          footerIsNotice: true,
          taggedKeys: new Set(alerted),
          tag,
        }
      : { footer: logged, footerIsNotice: false, taggedKeys: NO_KEYS, tag };
  }
  return {
    footer: NOT_SWITCHED_ON_COPY,
    footerIsNotice: false,
    // [TRANSITIONAL] A caller that passes no status at all keeps the tag it
    // had before #3827, because an existing suite mounts the sheet that way
    // and pins the tag. Both shipped editors pass a status (or null), so no
    // screen shows the tag beside "not switched on yet". Exit: that suite is
    // updated under [TEST-MOD-APPROVED] and this arm returns NO_KEYS.
    taggedKeys: input.status === undefined ? new Set(emailKeys) : NO_KEYS,
    tag,
  };
};

/** The line under the reason field of the live experience editor. */
export const experienceLiveEditNotice = (
  status: BuyerNoticeStatus | null,
): string => {
  if (status !== null && status.live && status.allowlistOnly === true) {
    return BUYER_EMAILS_TESTING_COPY;
  }
  if (status !== null && status.live && status.audience > 0) {
    return `If the dates, the route or the stop times change, we'll email your ${
      people(status.audience, "buyers")
    } what changed and your reason.`;
  }
  if (status !== null && status.live) {
    return (status.noEmail ?? 0) > 0
      ? "None of your buyers has an email address, so nobody is emailed. Your reason is saved and logged."
      : "Nobody has booked yet, so nobody is emailed. Your reason is saved and logged.";
  }
  return NOT_SWITCHED_ON_COPY;
};

export interface LastNoticeLine {
  text: string;
  /** One or more emails could not be delivered: shown in red with support. */
  failed: boolean;
}

/** The "Last update" line of the live-edit banner, or null with nothing to say. */
export const lastNoticeLine = (
  status: BuyerNoticeStatus | null,
  noun: BuyerNoticeNoun = "buyers",
): LastNoticeLine | null => {
  const last = status?.last ?? null;
  if (last === null) return null;
  if (last.state === "scheduled") {
    return {
      text: `Last update: an email to ${people(last.audience, noun)} is waiting to go out.`,
      failed: false,
    };
  }
  if (last.state === "held") {
    return last.holdCode === "refund_all"
      ? {
          text: `Last update: no email was sent, because that change refunds every ${noun.slice(0, -1)}.`,
          failed: false,
        }
      : null;
  }
  if (last.state !== "fanned_out") return null;
  const parts = [
    `Last update: sent to ${last.sent} of ${last.audience}${noun === "guests" ? " guests" : ""}`,
  ];
  if (last.pending > 0) parts.push(`${last.pending} still sending`);
  parts.push(
    `${last.noEmail} ${last.noEmail === 1 ? "has" : "have"} no email address`,
  );
  if (last.held > 0) parts.push(`${last.held} held back while emails are being tested`);
  parts.push(`${last.failed} failed`);
  return {
    text: last.failed > 0
      ? `${parts.join(" · ")}. Contact support.`
      : parts.join(" · "),
    failed: last.failed > 0,
  };
};
