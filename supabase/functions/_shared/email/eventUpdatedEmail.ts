// Issue #3827 — the email a ticket holder, RSVP guest or experience buyer
// gets when a host materially changes a live listing.
//
// Body only: the document is built by `renderShell` (the one permitted
// <!doctype> builder), and every dynamic string reaches the HTML through
// `escapeHtml`. What changed comes from `event_edit_notices.notice_changes`,
// which the database has already stripped of anything that must not be
// printed: the street of a hide-address event, every stop address and place
// name of an experience, and the online link itself.
//
// The host's reason is quoted, attributed to the host, never placed in the
// subject, and never treated as markup: control, bidi and zero-width
// characters are removed and anything that looks like a link or an email
// address is replaced with "[link removed]" before it is escaped.

import { escapeHtml } from "./escape.ts";
import { renderShell, SHELL_TOKENS } from "./shell.ts";
import { formatEventDateLine } from "./dateLine.ts";
import { EMAIL_SENDERS, type SenderIdentity } from "./senders.ts";
import { minglaLogoUrl } from "../brandAssets.ts";
import { resolveRuntimeString } from "../runtimeConfig.ts";
import { isWellFormedEmail } from "../organiserContactEmail.ts";

const { BRAND_ORANGE, BRAND_ORANGE_BUTTON, BRAND_INK, BRAND_MUTED, BRAND_BG_SOFT, BRAND_BORDER } =
  SHELL_TOKENS;

const DEFAULT_SUPPORT_EMAIL = "support@usemingla.com";
const REASON_MAX = 200;
/** Recorded by the database when an edit had no buyers and no reason. */
const NO_REASON_CONSTANT = "No buyers at time of edit; no reason given";
export const LINK_REMOVED = "[link removed]";

export type EventUpdateKind = "event" | "rsvp" | "experience";

export interface EventUpdateDatePair {
  s: string;
  e: string;
}

/** One entry of `event_edit_notices.notice_changes`. */
export interface EventUpdateChange {
  field: string;
  old?: unknown;
  new?: unknown;
  withheld?: boolean;
  many?: boolean;
  old_present?: boolean;
  new_present?: boolean;
}

export interface EventUpdatedEmailInput {
  kind: EventUpdateKind;
  eventName: string;
  brandName: string;
  recipientName: string | null;
  /** The listing's IANA timezone, as stored AFTER the change. */
  timezone: string | null;
  changes: EventUpdateChange[];
  reason: string | null;
  /** The public page, from the existing URL builder. */
  eventUrl: string;
  /** The current venue name, shown beside a withheld address when known. */
  venueName?: string | null;
  supportEmail?: string;
}

export interface EventUpdatedEmailResult {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  from: SenderIdentity;
}

// Control characters (C0, DEL, C1), line and paragraph separators.
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;
// Bidirectional overrides, embeddings, isolates and marks.
const BIDI_CHARS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
// Zero-width and invisible joiners, soft hyphen, byte-order mark, tag block.
const INVISIBLE_CHARS =
  /[\u00AD\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200D\u2060-\u2064\u206A-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]|\uDB40[\uDC00-\uDC7F]/g;
const EMAIL_LIKE = /[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+/gu;
// A scheme of ANY kind followed by something: https://, javascript:, data:,
// mailto:, tel:, intent:, a made-up one. Two letters at least, so "a:b" in a
// sentence is left alone; a colon followed by a space never matches.
const SCHEME_LIKE = /(?<![\p{L}\p{N}])[a-z][a-z0-9+.-]{1,31}:(?:\/\/)?[^\s]+/giu;
const WWW_LIKE = /(?<![\p{L}\p{N}])www\.[^\s]+/giu;
// IPv4 addresses, with an optional port and path.
const IP_LIKE = /(?<![\p{N}.])\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:[/?#][^\s]*)?/gu;
// A host name: labels joined by a dot BETWEEN two word characters, ending in a
// 2 to 24 letter top-level label (any script) or a punycode one, then an
// optional port and path. "Lagos. We" (a dot followed by a space), "e.g." and
// "3.5km" are sentences, not hosts, and stay.
const HOST_LIKE =
  /(?<![\p{L}\p{N}@-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,62})\.)+(?:\p{L}{2,24}|xn--[a-z0-9-]{2,59})(?![\p{L}\p{N}-])(?::\d{1,5})?(?:[/?#][^\s]*)?/giu;

/**
 * At most `max` UTF-16 units, cut between whole characters as a reader sees
 * them (grapheme clusters), never inside a surrogate pair. A single cluster
 * longer than the budget is cut between code points instead.
 */
export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = "";
  const Segmenter = (Intl as unknown as {
    Segmenter?: new (locale?: string, options?: { granularity: string }) => {
      segment(input: string): Iterable<{ segment: string }>;
    };
  }).Segmenter;
  const pieces: Iterable<string> = Segmenter
    ? Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment)
    : Array.from(text);
  for (const piece of pieces) {
    if (out.length + piece.length > max) {
      if (out.length === 0) {
        for (const point of Array.from(piece)) {
          if (out.length + point.length > max) break;
          out += point;
        }
      }
      break;
    }
    out += piece;
  }
  return out;
}

/** One line of plain text: no control, bidi or invisible characters. */
export function cleanLine(raw: unknown, max = 200): string {
  if (typeof raw !== "string") return "";
  return truncateText(
    raw
      .replace(CONTROL_CHARS, " ")
      .replace(BIDI_CHARS, "")
      .replace(INVISIBLE_CHARS, "")
      .replace(/\s+/g, " ")
      .trim(),
    max,
  ).trim();
}

/**
 * The host's reason, safe to quote. Returns null when there is nothing to
 * quote. The result is still plain text: the caller escapes it for HTML.
 */
export function sanitiseEditReason(raw: unknown): string | null {
  const line = cleanLine(raw, 2000);
  if (line.length === 0 || line === NO_REASON_CONSTANT) return null;
  const cleaned = truncateText(
    line
      .replace(EMAIL_LIKE, LINK_REMOVED)
      .replace(SCHEME_LIKE, LINK_REMOVED)
      .replace(WWW_LIKE, LINK_REMOVED)
      .replace(IP_LIKE, LINK_REMOVED)
      .replace(HOST_LIKE, LINK_REMOVED)
      .replace(/\s+/g, " ")
      .trim(),
    REASON_MAX,
  ).trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Replies go to the brand when it has a usable address, else to support. */
export function eventUpdateReplyTo(
  brandContactEmail: unknown,
  supportEmail: string = DEFAULT_SUPPORT_EMAIL,
): string {
  if (isWellFormedEmail(brandContactEmail)) {
    const candidate = cleanLine(brandContactEmail, 254);
    if (isWellFormedEmail(candidate) && !/[<>,;"]/.test(candidate)) return candidate;
  }
  return supportEmail;
}

type ChangeGroup = "when" | "where" | "how";

function groupsOf(changes: EventUpdateChange[]): Set<ChangeGroup> {
  const groups = new Set<ChangeGroup>();
  for (const change of changes) {
    if (change.field === "dates" || change.field === "timezone") groups.add("when");
    else if (
      change.field === "venue" || change.field === "address" ||
      change.field === "route" || change.field === "stop_times"
    ) groups.add("where");
    else groups.add("how");
  }
  return groups;
}

/** The fixed vocabulary. Nothing a host typed can reach these words. */
function vocabulary(kind: EventUpdateKind, changes: EventUpdateChange[]): {
  subjectLead: string;
  heading: string;
  what: string;
} {
  const groups = groupsOf(changes);
  const onlyWhen = groups.size === 1 && groups.has("when");
  if (kind === "experience") {
    return {
      subjectLead: onlyWhen ? "Dates changed" : "Details changed",
      heading: "Your experience has changed",
      what: onlyWhen ? "dates" : "details",
    };
  }
  if (groups.has("when") && groups.has("where") && !groups.has("how")) {
    return {
      subjectLead: "Venue and time changed",
      heading: "The venue and time have changed",
      what: "venue and time",
    };
  }
  if (onlyWhen) {
    return { subjectLead: "Date changed", heading: "The date has changed", what: "date" };
  }
  if (groups.size === 1 && groups.has("where")) {
    return { subjectLead: "Venue changed", heading: "The venue has changed", what: "venue" };
  }
  return {
    subjectLead: "Event details changed",
    heading: "The event details have changed",
    what: "details",
  };
}

export function eventUpdatedSubject(
  kind: EventUpdateKind,
  eventName: string,
  changes: EventUpdateChange[],
): string {
  const name = cleanLine(eventName, 120) || (kind === "experience" ? "your experience" : "your event");
  return `${vocabulary(kind, changes).subjectLead}: ${name}`;
}

function datePairs(value: unknown): EventUpdateDatePair[] {
  if (!Array.isArray(value)) return [];
  return value.filter((pair): pair is EventUpdateDatePair =>
    !!pair && typeof pair === "object" &&
    typeof (pair as EventUpdateDatePair).s === "string" &&
    typeof (pair as EventUpdateDatePair).e === "string"
  );
}

/** "Lagos time (GMT+1)" for the listing's zone at the given instant. */
export function zoneLine(timezone: string | null, atIso: string | null): string {
  const tz = typeof timezone === "string" && timezone.length > 0 ? timezone : "UTC";
  const at = atIso ? new Date(atIso) : new Date();
  const instant = Number.isNaN(at.getTime()) ? new Date() : at;
  let offset = "";
  try {
    offset = new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(instant).find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
  const city = cleanLine(tz.split("/").pop() ?? "", 60).replace(/_/g, " ");
  if (tz === "UTC" || city.length === 0) return offset ? `UTC (${offset})` : "UTC";
  return offset ? `${city} time (${offset})` : `${city} time`;
}

function zoneName(timezone: unknown, atIso: string | null): string {
  const tz = cleanLine(timezone, 80);
  if (tz.length === 0) return "";
  const line = zoneLine(tz, atIso);
  return line.length > 0 ? line : tz;
}

const FORMAT_LABELS: Record<string, string> = {
  in_person: "In person",
  online: "Online",
  hybrid: "In person and online",
};

interface Block {
  label: string;
  /** Struck-through "Was" lines. */
  was: string[];
  /** "Now" lines. */
  now: string[];
  /** Plain sentences, used when the values themselves are not shown. */
  notes: string[];
  /** A muted line under the block (the timezone). */
  foot: string | null;
}

function buildBlocks(input: EventUpdatedEmailInput): Block[] {
  const page = input.kind === "experience" ? "experience page" : "event page";
  const blocks: Block[] = [];
  const venueChanged = input.changes.some((change) => change.field === "venue");
  for (const change of input.changes) {
    switch (change.field) {
      case "dates": {
        const oldPairs = datePairs(change.old);
        const newPairs = datePairs(change.new);
        if (change.many === true || (oldPairs.length === 0 && newPairs.length === 0)) {
          blocks.push({
            label: "Date and time",
            was: [],
            now: [],
            notes: [`The dates have changed. You will find the current dates on the ${page}.`],
            foot: null,
          });
          break;
        }
        // Old values are shown in the zone the listing has now, so the two
        // lines can be compared; a zone change gets its own block.
        blocks.push({
          label: "Date and time",
          was: oldPairs.map((pair) => formatEventDateLine(pair.s, pair.e, input.timezone)),
          now: newPairs.map((pair) => formatEventDateLine(pair.s, pair.e, input.timezone)),
          notes: [],
          foot: zoneLine(input.timezone, newPairs[0]?.s ?? oldPairs[0]?.s ?? null) || null,
        });
        break;
      }
      case "timezone":
        blocks.push({
          label: "Time zone",
          was: [zoneName(change.old, null)].filter((line) => line.length > 0),
          now: [zoneName(change.new, null)].filter((line) => line.length > 0),
          notes: [],
          foot: null,
        });
        break;
      case "venue":
        if (change.withheld === true) {
          blocks.push({
            label: "Venue",
            was: [],
            now: [],
            notes: [`The location has changed. You will find it on the ${page}.`],
            foot: null,
          });
        } else {
          blocks.push({
            label: "Venue",
            was: [cleanLine(change.old, 200)].filter((line) => line.length > 0),
            now: [cleanLine(change.new, 200) || "No venue name"],
            notes: [],
            foot: null,
          });
        }
        break;
      case "address":
        if (change.withheld === true) {
          const venue = venueChanged ? "" : cleanLine(input.venueName, 200);
          blocks.push({
            label: "Address",
            was: [],
            now: [],
            notes: [
              ...(venue.length > 0 ? [`Venue: ${venue}`] : []),
              `The address has changed. You will find it on the ${page}.`,
            ],
            foot: null,
          });
        } else {
          blocks.push({
            label: "Address",
            was: [cleanLine(change.old, 300)].filter((line) => line.length > 0),
            now: [cleanLine(change.new, 300) || "No address"],
            notes: [],
            foot: null,
          });
        }
        break;
      case "format":
        blocks.push({
          label: "Format",
          was: [FORMAT_LABELS[String(change.old)] ?? ""].filter((line) => line.length > 0),
          now: [FORMAT_LABELS[String(change.new)] ?? "Changed"],
          notes: [],
          foot: null,
        });
        break;
      case "online_link":
        blocks.push({
          label: "Online link",
          was: [],
          now: [],
          notes: [
            change.new_present === false
              ? "This event no longer has an online link."
              : change.old_present === false
              ? `An online link has been added. You will find it on the ${page}.`
              : `The online link has changed. You will find the new one on the ${page}.`,
          ],
          foot: null,
        });
        break;
      case "route":
        blocks.push({
          label: "Location",
          was: [],
          now: [],
          notes: [
            "The location or route has changed.",
            `You will find the details on the ${page}.`,
          ],
          foot: null,
        });
        break;
      case "stop_times":
        blocks.push({
          label: "Stop times",
          was: [],
          now: [],
          notes: ["Stop times have changed.", `You will find the new times on the ${page}.`],
          foot: null,
        });
        break;
      default:
        // An entry this version does not know is never printed.
        break;
    }
  }
  return blocks;
}

function renderBlockHtml(block: Block, isLast: boolean): string {
  const wasHtml = block.was.map((line) =>
    `<p style="margin:0 0 4px 0;font-size:14px;line-height:1.5;color:${BRAND_MUTED};">Was: <span style="text-decoration:line-through;">${
      escapeHtml(line)
    }</span></p>`
  ).join("");
  const nowHtml = block.now.map((line) =>
    `<p style="margin:0 0 4px 0;font-size:16px;line-height:1.5;color:${BRAND_INK};font-weight:600;">Now: ${
      escapeHtml(line)
    }</p>`
  ).join("");
  const notesHtml = block.notes.map((line) =>
    `<p style="margin:0 0 4px 0;font-size:15px;line-height:1.5;color:${BRAND_INK};">${
      escapeHtml(line)
    }</p>`
  ).join("");
  const footHtml = block.foot
    ? `<p style="margin:4px 0 0 0;font-size:13px;line-height:1.5;color:${BRAND_MUTED};">${
      escapeHtml(block.foot)
    }</p>`
    : "";
  return `<tr>
                    <td style="padding:16px 18px;${
    isLast ? "" : `border-bottom:1px solid ${BRAND_BORDER};`
  }">
                      <p style="margin:0 0 8px 0;font-size:12px;line-height:1.4;color:${BRAND_MUTED};font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">${
    escapeHtml(block.label)
  }</p>
                      ${wasHtml}${nowHtml}${notesHtml}${footHtml}
                    </td>
                  </tr>`;
}

export function renderEventUpdatedEmail(
  input: EventUpdatedEmailInput,
): EventUpdatedEmailResult {
  const supportEmail = input.supportEmail ?? Deno.env.get("SUPPORT_EMAIL") ??
    DEFAULT_SUPPORT_EMAIL;
  const logoUrl = minglaLogoUrl();
  // Same resolution as the other transactional emails (the runtime bundle,
  // which itself falls back to the plain variable); the test-only fallback
  // keeps the suite hermetic.
  const footerAddress = (
    resolveRuntimeString("mingla_footer_address", "MINGLA_FOOTER_ADDRESS") ?? ""
  ).trim() ||
    (Deno.env.get("DENO_TESTING") === "1" ? "Mingla, hello@usemingla.com" : "");
  if (footerAddress.length === 0) {
    throw new Error("email_env_missing:MINGLA_FOOTER_ADDRESS");
  }

  const isExperience = input.kind === "experience";
  const noun = isExperience ? "experience" : "event";
  const eventName = cleanLine(input.eventName, 160) || `your ${noun}`;
  const brandName = cleanLine(input.brandName, 120) || "The host";
  const recipientName = cleanLine(input.recipientName, 80);
  const reason = sanitiseEditReason(input.reason);
  const words = vocabulary(input.kind, input.changes);
  const blocks = buildBlocks(input);
  if (blocks.length === 0) {
    // Nothing printable changed: sending "something changed" with no detail
    // would be noise. The caller treats this as nothing to send.
    throw new Error("event_update_email_nothing_to_say");
  }

  const subject = eventUpdatedSubject(input.kind, input.eventName, input.changes);
  const preheader =
    `${brandName} changed the ${words.what} for ${eventName}. Here is what is different.`;
  const stillValid = isExperience
    ? "Your booking is still valid."
    : input.kind === "rsvp"
    ? "Your RSVP still stands."
    : "Your ticket is still valid.";
  const buttonLabel = isExperience ? "View the experience" : "View the event page";
  const because = isExperience
    ? "because you booked this experience"
    : input.kind === "rsvp"
    ? "because you said you are going to this event"
    : "because you have a ticket for this event";
  const helpLine = input.kind === "rsvp"
    ? `If the new details do not work for you, you can change your RSVP from your invite. For help, reply to this email or write to ${supportEmail}.`
    : `If the new details do not work for you, the refund terms for this ${noun} are on the ${noun} page. To ask for a refund or for help, reply to this email or write to ${supportEmail}.`;
  const greeting = recipientName.length > 0 ? `Hi ${recipientName},` : "Hi,";

  const blocksHtml = blocks
    .map((block, index) => renderBlockHtml(block, index === blocks.length - 1))
    .join("");
  const reasonHtml = reason
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">
                  <tr>
                    <td style="padding:14px 18px;background:${BRAND_BG_SOFT};border-left:3px solid ${BRAND_ORANGE};border-radius:8px;">
                      <p style="margin:0 0 6px 0;font-size:12px;line-height:1.4;color:${BRAND_MUTED};font-weight:600;">Reason given by ${
      escapeHtml(brandName)
    }</p>
                      <p style="margin:0;font-size:15px;line-height:1.55;color:${BRAND_INK};">&ldquo;${
      escapeHtml(reason)
    }&rdquo;</p>
                    </td>
                  </tr>
                </table>`
    : "";

  const bodyHtml =
    `<p style="margin:0 0 6px 0;font-size:13px;line-height:1.4;color:${BRAND_MUTED};">Update from ${
      escapeHtml(brandName)
    }</p>
                <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;color:${BRAND_INK};font-weight:700;">${
      escapeHtml(words.heading)
    }</h1>
                <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">${
      escapeHtml(greeting)
    }</p>
                <p style="margin:0 0 20px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">${
      escapeHtml(brandName)
    } has changed the details of <strong>${escapeHtml(eventName)}</strong>. ${
      escapeHtml(stillValid)
    }</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BRAND_BORDER};border-radius:12px;">
                  ${blocksHtml}
                </table>
                ${reasonHtml}
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
                  <tr>
                    <td style="background:${BRAND_ORANGE_BUTTON};border-radius:999px;">
                      <a href="${
      escapeHtml(input.eventUrl)
    }" style="display:inline-block;padding:12px 22px;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;">${
      escapeHtml(buttonLabel)
    }</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0 0;font-size:14px;line-height:1.55;color:${BRAND_MUTED};">${
      escapeHtml(helpLine)
    }</p>
                <p style="margin:14px 0 0 0;font-size:13px;line-height:1.55;color:${BRAND_MUTED};">Sent by Mingla on behalf of ${
      escapeHtml(brandName)
    }, ${escapeHtml(because)}.</p>`;

  const html = renderShell({
    preheader,
    bodyHtml,
    supportEmail,
    logoUrl,
    footerAddress,
  });

  const textLines: string[] = [
    `Update from ${brandName}`,
    words.heading,
    "",
    greeting,
    "",
    `${brandName} has changed the details of ${eventName}. ${stillValid}`,
  ];
  for (const block of blocks) {
    textLines.push("", block.label.toUpperCase());
    for (const line of block.was) textLines.push(`Was: ${line}`);
    for (const line of block.now) textLines.push(`Now: ${line}`);
    for (const line of block.notes) textLines.push(line);
    if (block.foot) textLines.push(block.foot);
  }
  if (reason) {
    textLines.push("", `Reason given by ${brandName}:`, `"${reason}"`);
  }
  textLines.push(
    "",
    `${buttonLabel}: ${input.eventUrl}`,
    "",
    helpLine,
    "",
    `Sent by Mingla on behalf of ${brandName}, ${because}.`,
    footerAddress,
  );

  return {
    subject,
    preheader,
    html,
    text: textLines.join("\n"),
    from: EMAIL_SENDERS.tickets,
  };
}

/** One sentence for the channels that have no room for the blocks. */
export function eventUpdateShortLine(
  kind: EventUpdateKind,
  brandName: string,
  changes: EventUpdateChange[],
): string {
  const brand = cleanLine(brandName, 80) || "The host";
  return `${brand} changed the ${vocabulary(kind, changes).what}. Open the page to see what is different.`;
}
