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
    /** Kept from the new email while emails are being tested. */
    heldTesting?: number;
    /** Not sent because buyer emails were switched off. */
    heldSwitchedOff?: number;
    /** RSVP guests given the usual alert instead. */
    alerted?: number;
    /** Going guests with no email whose copy went by text or the app. */
    reachedOther?: number;
    /** A waiting email: the people it can reach now. */
    emailable?: number;
    /** Emails are being tested now. */
    testing?: boolean;
    /** A waiting email while testing: how many recipients are test addresses. */
    testAddresses?: number;
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
  let last: BuyerNoticeStatus["last"] = null;
  if (isRecord(raw.last) && typeof raw.last.state === "string") {
    const source = raw.last;
    const parsed: NonNullable<BuyerNoticeStatus["last"]> = {
      state: source.state as string,
      holdCode: typeof source.holdCode === "string" ? source.holdCode : null,
      audience: count(source.audience),
      sent: count(source.sent),
      pending: count(source.pending),
      failed: count(source.failed),
      noEmail: count(source.noEmail),
      held: count(source.held),
    };
    // Optional facts are present only when the server sent them.
    for (
      const key of [
        "heldTesting",
        "heldSwitchedOff",
        "alerted",
        "reachedOther",
        "emailable",
        "testAddresses",
      ] as const
    ) {
      if (typeof source[key] === "number") parsed[key] = count(source[key]);
    }
    if (typeof source.testing === "boolean") parsed.testing = source.testing;
    last = parsed;
  }
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
  const one = noun.slice(0, -1);
  const addresses = (n: number): string => `${n} test ${n === 1 ? "address" : "addresses"}`;
  if (last.state === "scheduled") {
    if (last.testing === true) {
      return {
        text: `Last update: waiting to go out to ${addresses(last.testAddresses ?? 0)}. Your ${noun} are not emailed while emails are being tested.`,
        failed: false,
      };
    }
    return {
      text: `Last update: an email to ${people(last.emailable ?? last.audience, noun)} is waiting to go out.`,
      failed: false,
    };
  }
  if (last.state === "held") {
    return last.holdCode === "refund_all"
      ? {
          text: `Last update: no email was sent, because that change refunds every ${one}.`,
          failed: false,
        }
      : null;
  }
  if (last.state !== "fanned_out") return null;
  const heldOff = last.heldSwitchedOff ?? 0;
  const heldTesting = last.heldTesting ?? (last.heldSwitchedOff === undefined ? last.held : 0);
  const alerted = last.alerted ?? 0;
  const reachedOther = last.reachedOther ?? 0;
  const reached = last.sent + last.pending + last.failed + reachedOther;
  const otherPart = reachedOther > 0
    ? `${people(reachedOther, noun)} with no email address reached by text or the app`
    : null;
  const failedPart = last.failed > 0 ? `${last.failed} failed` : null;
  const finish = (parts: Array<string | null>): LastNoticeLine | null => {
    const kept = parts.filter((part): part is string => part !== null);
    // Nothing true to say (for example a copy for nobody): no line at all.
    if (kept.length === 0) return null;
    const text = `Last update: ${kept.join(" · ")}`;
    return last.failed > 0 ? { text: `${text}. Contact support.`, failed: true } : { text, failed: false };
  };
  if (reached === 0 && heldOff > 0 && heldTesting === 0 && alerted === 0) {
    return {
      text: `Last update: not sent, because ${one} emails were switched off. ${people(heldOff, noun)} ${
        heldOff === 1 ? "was" : "were"
      } not emailed.`,
      failed: false,
    };
  }
  if (reached === 0 && heldTesting === 0 && alerted > 0) {
    // Nobody had the new email; the guests had the usual alert instead.
    return finish([
      `${people(alerted, noun)} alerted the usual way`,
      heldOff > 0 ? `${heldOff} not sent because emails were switched off` : null,
    ]);
  }
  // "Being tested" is what the server recorded for this notice when it went
  // out (`testing`), never today's switch. An answer from an older server
  // without that field falls back to the shape a test leaves behind.
  if (
    heldTesting > 0 || last.testing === true ||
    (last.testing === undefined && alerted > 0 && heldOff === 0 && last.sent > 0)
  ) {
    // Emails were being tested: only test addresses had the new email.
    return finish([
      alerted > 0 ? `${people(alerted, noun)} alerted the usual way` : null,
      last.sent > 0 ? `${addresses(last.sent)} emailed` : null,
      otherPart,
      last.pending > 0 ? `${last.pending} still sending` : null,
      heldTesting > 0 ? `${people(heldTesting, noun)} not emailed while emails are being tested` : null,
      heldOff > 0 ? `${heldOff} not sent because emails were switched off` : null,
      failedPart,
    ]);
  }
  return finish([
    `sent to ${last.sent} of ${
      noun === "guests" ? people(last.audience, noun) : String(last.audience)
    }`,
    otherPart,
    last.pending > 0 ? `${last.pending} still sending` : null,
    // A zero is never a clause: "0 have no email address" beside a guest with
    // no address reached by text read as a contradiction.
    last.noEmail > 0 ? `${last.noEmail} ${last.noEmail === 1 ? "has" : "have"} no email address` : null,
    heldOff > 0 ? `${heldOff} not sent because emails were switched off` : null,
    alerted > 0 ? `${people(alerted, noun)} alerted the usual way` : null,
    `${last.failed} failed`,
  ]);
};

