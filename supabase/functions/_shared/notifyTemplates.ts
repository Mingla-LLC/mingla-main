// META-ORCH-1161 Sub-A — per-category message templates (single source of truth).
import { discoverCityWatchCopy } from "./discoverCityWatchCopy.ts";
//
// Copy is VERBATIM from
// Mingla_Artifacts/design/ORCH-1161/COPY_META-ORCH-1161_CONSENT_AND_MESSAGE_TEMPLATES.md.
// GSM-7 discipline: SMS bodies use only ASCII punctuation (straight quotes,
// hyphens). The dispatcher's smsAdapter still runs the sanitizer, but these are
// authored clean. The thin slice wires buyer_reservation_changed; the other
// rendered moments are present so the v2 core can fan out the seeded categories.

import { formatMessageTime, type MessageTime } from "./messageTime.ts";
import { type BuyerSmsNoun, renderBuyerSms } from "./sms/buyerSms.ts";
import {
  isIssue4111EnquiryCategory,
  ISSUE_4111_SUBSCRIBE_SMS_CATEGORY,
  renderIssue4111Message,
  renderIssue4111SubscribeSms,
} from "./issue4111EnquiryNotifications.ts";

export interface RenderedMessage {
  push: { title: string; body: string };
  email: { subject: string; body: string };
  sms: string; // WITHOUT the STOP footer — smsAdapter appends it.
}

function str(v: unknown, fallback = ""): string {
  return v === null || v === undefined ? fallback : String(v);
}

// #3720 — Community copy is authored as Markdown but native push, email text,
// and the Host inbox are plain-text surfaces. Keep the words while removing
// formatting tokens so users never see raw ###, ** or backticks.
export function communityMarkdownToPlainText(value: unknown): string {
  return str(value)
    .replace(/```(?:[a-z0-9_-]+)?\s*([\s\S]*?)```/gi, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/(^|\n)\s{0,3}#{1,6}\s+/g, "$1")
    .replace(/(^|\n)\s{0,3}(?:[-+*]|\d+[.)])\s+/g, "$1")
    .replace(/(^|\n)\s{0,3}>\s?/g, "$1")
    .replace(/[*_~`]+/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

function communityExcerpt(value: unknown, maxLength = 180): string {
  const plain = communityMarkdownToPlainText(value);
  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, maxLength - 1).trimEnd()}…`;
}

// #3988 — plain-text email lines for teammate alerts. Empty values are left
// out rather than shown blank (never fabricate).
function issue3988Lines(intro: string, rows: Array<[string, string]>): string {
  const lines = rows
    .filter(([, value]) => value.trim().length > 0)
    .map(([label, value]) => `${label}: ${value}`);
  return lines.length ? `${intro}\n\n${lines.join("\n")}` : intro;
}

function priorityLabel(value: unknown): string {
  const v = str(value).toLowerCase();
  return ["low", "normal", "high", "urgent"].includes(v)
    ? v.charAt(0).toUpperCase() + v.slice(1)
    : "";
}

function kindLabel(value: unknown): string {
  switch (str(value)) {
    case "question":
      return "Question";
    case "account":
      return "Account";
    case "bug":
      return "Bug";
    case "feature":
      return "Feature";
    case "trust_safety":
      return "Trust and safety";
    default:
      return "";
  }
}

function dueLabel(value: unknown): string {
  const ms = Date.parse(str(value));
  return Number.isFinite(ms) ? new Date(ms).toUTCString() : "";
}

// Format an integer cents amount into a currency-aware display string. Mirrors the
// edge-side formatMoneyCents intent without importing the Stripe helper here (this
// module must stay dependency-light + unit-testable). Falls back to a plain amount
// if the payload already carries a pre-formatted `amount` string.
function fmtAmount(payload: Record<string, unknown>): string {
  if (typeof payload.amount === "string" && payload.amount.length > 0) {
    return payload.amount;
  }
  const cents = Number(payload.amount_cents);
  if (!Number.isFinite(cents)) return "";
  const currency = str(payload.currency, "USD").toUpperCase().slice(0, 3);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

// Format an ISO timestamp into a short date + time for copy interpolation.
// Locale-aware-friendly but deterministic for tests (en-US, UTC-stable display
// would require the venue tz — the thin slice passes pre-formatted date/time in
// payload when available, else derives a simple split).
function fmtDate(
  payload: Record<string, unknown>,
): { date: string; time: string } {
  if (payload.date && payload.time) {
    return { date: str(payload.date), time: str(payload.time) };
  }
  const iso = str(payload.reserved_for);
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "", time: "" };
  const date = d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  });
  return { date, time };
}

interface Issue4063BuyerContext {
  link: string;
  claimed: boolean;
  when: MessageTime;
}

// #4063 — new producers carry listing-local time facts, and the outbox drain
// adds the one governed buyer link immediately before dispatch. Older queued
// rows carry neither shape, so they deliberately stay on the exact legacy
// renderer below instead of printing an empty slot or inventing UTC.
function issue4063BuyerContext(
  payload: Record<string, unknown>,
): Issue4063BuyerContext | null {
  const instant = str(payload.reserved_for ?? payload.event_start_at);
  const timezone = typeof payload.timezone === "string"
    ? payload.timezone
    : typeof payload.event_timezone === "string"
    ? payload.event_timezone
    : null;
  const link = str(payload.message_link_display).trim();
  if (!instant || !timezone || !link) return null;
  const when = formatMessageTime(instant, timezone);
  if (when === null || !when.tzKnown) return null;
  return {
    link,
    claimed: payload.message_link_claimed === true || payload.claimed === true,
    when,
  };
}

function issue4063OfferingNoun(payload: Record<string, unknown>): BuyerSmsNoun {
  const kind = str(payload.kind ?? payload.event_type).toLowerCase();
  return kind === "trip" || kind === "experience" ? "booking" : "ticket";
}

// #3391 — the refund amount on a venue-cancelled paid booking, with the glyph
// the guest reads ("$50.00", "£50.00", "₦25,000.00"). `narrowSymbol` because the
// default ISO fallback prints "NGN 25,000.00" in en-US (the #3341 rule). Returns
// null unless the payload is a venue cancellation with a positive refund.
//
// `gsm7: true` is for SMS bodies, which this file authors GSM-7 clean: a glyph
// outside that alphabet ("₦") would silently force UCS-2 and halve the segment,
// so SMS reads the ISO code instead ("NGN 25,000.00"). "$" and "£" are GSM-7.
export function venueCancelRefundAmount(
  payload: Record<string, unknown>,
  options: { gsm7?: boolean } = {},
): string | null {
  if (payload.cancelled_by !== "venue") return null;
  const cents = Number(payload.refund_amount_cents);
  const currency = str(payload.refund_currency).trim().toUpperCase();
  if (
    !Number.isSafeInteger(cents) || cents <= 0 || !/^[A-Z]{3}$/.test(currency)
  ) {
    return null;
  }
  const format = (currencyDisplay: "narrowSymbol" | "code"): string =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay,
    }).format(cents / 100).replace(/[\u00a0\u202f]/g, " ");
  try {
    const glyph = format("narrowSymbol");
    if (options.gsm7 && !/^[\x20-\x7e£]*$/.test(glyph)) return format("code");
    return glyph;
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function renderCategoryMessage(
  categoryKey: string,
  payload: Record<string, unknown>,
): RenderedMessage {
  // #4111 — customer enquiry copy lives with its categories.
  if (isIssue4111EnquiryCategory(categoryKey)) {
    return renderIssue4111Message(categoryKey, payload);
  }
  if (categoryKey === ISSUE_4111_SUBSCRIBE_SMS_CATEGORY) {
    return renderIssue4111SubscribeSms(payload);
  }
  const brand = str(payload.brand_name ?? payload.brand, "Mingla");
  const party = str(payload.party_size ?? payload.party, "");
  const { date, time } = fmtDate(payload);
  // Reminder lead bucket ('24h' | '2h') decides which COPY §3.3-3.6 variant renders.
  const leadBucket = str(payload.lead_bucket, "24h");
  const eventTitle = str(payload.event_title ?? payload.title, "your event");
  // #3281 PR6 — per-date override title/place on reminders (from enqueue payload).
  const dateTitle = str(payload.date_title);
  const dateLocation = str(payload.date_location);
  const reminderHeadline = dateTitle.length > 0 ? dateTitle : eventTitle;
  const reminderPlace = dateLocation.length > 0 ? ` — ${dateLocation}` : "";

  switch (categoryKey) {
    case "discover_city_plans_live": {
      const copy=discoverCityWatchCopy(str(payload.lang,"en"),str(payload.city_label,"your city"));
      return {push:{title:copy.pushTitle,body:copy.pushBody},email:{subject:copy.emailSubject,body:copy.emailBody},sms:""};
    }
    case "business.community_announcement": {
      const title = communityMarkdownToPlainText(payload.title) ||
        "Mingla announcement";
      const body = communityMarkdownToPlainText(
        payload.body_md ?? payload.body,
      );
      return {
        push: {
          title,
          body: communityExcerpt(body) ||
            "Open Mingla Host to read the update.",
        },
        email: {
          subject: title,
          body: body || "Open Mingla Host to read the update.",
        },
        sms: `Mingla: ${communityExcerpt(body)}`,
      };
    }
    case "business.community_reply": {
      const body = "Someone replied to your Community post.";
      return {
        push: { title: "New Community reply", body },
        email: { subject: "New Community reply", body },
        sms: `Mingla: ${body}`,
      };
    }
    case "business.community_roadmap_updated": {
      const body = "See what’s new in Now, Next and Later.";
      return {
        push: { title: "Mingla roadmap updated", body },
        email: { subject: "Mingla roadmap updated", body },
        sms: `Mingla: ${body}`,
      };
    }
    case "business.support_new_ticket": {
      if (payload.audience === "brand") {
        const subject = communityMarkdownToPlainText(payload.subject);
        const updateKind = str(payload.update_kind);
        const status = str(payload.status).replaceAll("_", " ");
        const publicBody = updateKind === "owned"
          ? "Mingla Support has taken ownership of your brand’s case."
          : updateKind === "status"
          ? `Your brand’s support case is now ${status || "updated"}.`
          : updateKind === "next_update"
          ? "The next-update promise on your brand’s support case changed."
          : "Mingla Support opened and took ownership of a case for your brand.";
        return {
          push: {
            title: updateKind === "opened"
              ? "Support case opened"
              : "Support case updated",
            body: publicBody,
          },
          email: {
            subject: updateKind === "opened"
              ? "Mingla Support opened and took ownership of a case for your brand"
              : "Your Mingla support case was updated",
            body: subject ? `${publicBody}\n\nSubject: ${subject}` : publicBody,
          },
          sms: `Mingla: ${publicBody}`,
        };
      }
      const publicBody = "A new support ticket needs attention.";
      const subject = communityMarkdownToPlainText(payload.subject);
      return {
        push: { title: "New support request", body: publicBody },
        email: {
          subject: "New Mingla support ticket",
          body: subject ? `${publicBody}\n\nSubject: ${subject}` : publicBody,
        },
        sms: `Mingla: ${publicBody}`,
      };
    }
    // #3988 — support and product alerts for Mingla teammates. IDs, subject
    // or title, priority and due time only; never a message body, staff
    // ticket details or a signal's problem statement.
    case "business.support_ticket_reply": {
      const subject = communityMarkdownToPlainText(payload.subject);
      const body = subject
        ? `New message on: ${subject}`
        : "A Host replied on a support ticket.";
      return {
        push: { title: "Support reply", body },
        email: {
          subject: "A Host replied on a Mingla support ticket",
          body: issue3988Lines("A Host replied on a support ticket.", [
            ["Subject", subject],
            ["Priority", priorityLabel(payload.priority)],
            ["Ticket", str(payload.ticket_id)],
          ]),
        },
        sms: "Mingla: A Host replied on a support ticket.",
      };
    }
    case "admin.support_staff_ticket": {
      const subject = communityMarkdownToPlainText(payload.subject);
      return {
        push: {
          title: "New staff ticket",
          body: subject || "A teammate opened a staff ticket.",
        },
        email: {
          subject: "New Mingla staff ticket",
          body: issue3988Lines("A teammate opened a staff ticket.", [
            ["Subject", subject],
            ["Priority", priorityLabel(payload.priority)],
            ["Ticket", str(payload.thread_id)],
          ]),
        },
        sms: "Mingla: A teammate opened a staff ticket.",
      };
    }
    case "admin.support_assigned": {
      const subject = communityMarkdownToPlainText(payload.subject);
      return {
        push: {
          title: "Staff ticket assigned to you",
          body: subject || "A staff ticket is now yours.",
        },
        email: {
          subject: "A Mingla staff ticket is assigned to you",
          body: issue3988Lines("A staff ticket is now assigned to you.", [
            ["Subject", subject],
            ["Priority", priorityLabel(payload.priority)],
            ["Ticket", str(payload.thread_id)],
          ]),
        },
        sms: "Mingla: A staff ticket is assigned to you.",
      };
    }
    case "admin.support_overdue": {
      const title = communityMarkdownToPlainText(payload.title);
      const isSignal = payload.kind === "product_signal";
      const what = isSignal ? "product signal" : "staff ticket";
      const lead = payload.audience === "lead";
      const intro = lead
        ? `A ${what}'s promised update is more than 24 hours overdue.`
        : `The promised update on your ${what} is overdue.`;
      return {
        push: {
          title: lead ? "Update overdue for 24 hours" : "Update overdue",
          body: title || intro,
        },
        email: {
          subject: lead
            ? `Mingla ${what} update overdue for 24 hours`
            : `Your Mingla ${what} update is overdue`,
          body: issue3988Lines(intro, [
            [isSignal ? "Signal" : "Subject", title],
            ["Priority", priorityLabel(payload.priority)],
            ["Update was due", dueLabel(payload.due_at)],
            [isSignal ? "Signal ID" : "Ticket", str(payload.item_id)],
          ]),
        },
        sms: `Mingla: ${intro}`,
      };
    }
    case "admin.product_signal_new": {
      const title = communityMarkdownToPlainText(payload.title);
      return {
        push: {
          title: "New product signal",
          body: title || "A new product signal needs review.",
        },
        email: {
          subject: "New Mingla product signal",
          body: issue3988Lines("A new product signal needs review.", [
            ["Signal", title],
            ["Type", kindLabel(payload.signal_kind)],
            ["Priority", priorityLabel(payload.priority)],
            ["Signal ID", str(payload.signal_id)],
          ]),
        },
        sms: "Mingla: A new product signal needs review.",
      };
    }
    case "admin.product_signal_assigned": {
      const title = communityMarkdownToPlainText(payload.title);
      return {
        push: {
          title: "Product signal handed to you",
          body: title || "A product signal is now yours.",
        },
        email: {
          subject: "A Mingla product signal is now yours",
          body: issue3988Lines("A product signal was handed to you.", [
            ["Signal", title],
            ["Priority", priorityLabel(payload.priority)],
            ["Signal ID", str(payload.signal_id)],
          ]),
        },
        sms: "Mingla: A product signal was handed to you.",
      };
    }
    case "admin.product_signal_progress": {
      const title = communityMarkdownToPlainText(payload.title);
      const issue = Number(payload.issue_number);
      const body = payload.event === "released"
        ? "The product signal you raised is released."
        : Number.isInteger(issue) && issue > 0
        ? `The product signal you raised is linked to GitHub issue #${issue}.`
        : "The product signal you raised is linked to GitHub.";
      return {
        push: { title: title || "Product signal update", body },
        email: { subject: "Your Mingla product signal moved", body },
        sms: `Mingla: ${body}`,
      };
    }
    case "business.brand_group_message": {
      const sender = communityMarkdownToPlainText(payload.sender_name) ||
        "Someone";
      const brandName = communityMarkdownToPlainText(payload.brand_name) ||
        "your Brand group";
      const mentioned = payload.mentioned === true;
      const body = communityExcerpt(
        communityMarkdownToPlainText(payload.body),
      ) || "Open Mingla Host to read the message.";
      return {
        push: {
          title: mentioned
            ? `${sender} mentioned you in ${brandName}`
            : `${sender} in ${brandName}`,
          body,
        },
        email: {
          subject: mentioned
            ? `${sender} mentioned you in ${brandName}`
            : `${sender} in ${brandName}`,
          body,
        },
        sms: `Mingla: ${body}`,
      };
    }
    case "stay_request_received":
    case "stay_request_action_needed":
    case "stay_reconciliation_attention": {
      const body = str(
        payload.body,
        "A Stay reservation needs your attention.",
      );
      return {
        push: { title: "Stay reservation update", body },
        email: { subject: "Stay reservation update", body },
        sms: `Mingla: ${body}`,
      };
    }
    case "stay_payment_required": {
      const deadline = str(payload.payment_deadline);
      const body = deadline
        ? `Your Stay request was approved. Complete payment by ${deadline}.`
        : "Your Stay request was approved. Complete payment to confirm.";
      return {
        push: { title: "Your Stay is ready for payment", body },
        email: { subject: "Complete your Mingla Stay reservation", body },
        sms: `Mingla: ${body}`,
      };
    }
    case "stay_request_declined": {
      const body = "The property declined your Stay reservation request.";
      return {
        push: { title: "Stay request declined", body },
        email: { subject: "Your Mingla Stay request", body },
        sms: `Mingla: ${body}`,
      };
    }
    case "stay_reservation_confirmed": {
      const body = "Your selected Rooms and Places are confirmed.";
      return {
        push: { title: "Stay confirmed", body },
        email: { subject: "Your Mingla Stay is confirmed", body },
        sms: `Mingla: ${body}`,
      };
    }
    case "stay_reservation_cancelled": {
      const body = "Your selected Rooms and Places were cancelled.";
      return {
        push: { title: "Stay reservation cancelled", body },
        email: { subject: "Your Mingla Stay cancellation", body },
        sms: `Mingla: ${body}`,
      };
    }
    case "stay_refund_state": {
      const amount = fmtAmount(payload);
      const body = amount
        ? `Your ${amount} Stay refund has been issued.`
        : "Your Stay refund status was updated.";
      return {
        push: { title: "Stay refund update", body },
        email: { subject: "Your Mingla Stay refund", body },
        sms: `Mingla: ${body}`,
      };
    }
    case "stay_reservation_reminder": {
      const body = str(
        payload.body,
        "Your Mingla Stay reservation is coming up.",
      );
      return {
        push: { title: "Your Stay is coming up", body },
        email: { subject: "Your Mingla Stay reminder", body },
        sms: `Mingla: ${body}`,
      };
    }
    case "source_refund_buyer_state": {
      const message = str(payload.message, "Your refund is processing.");
      return {
        push: { title: "Refund update", body: message },
        email: { subject: "Your Mingla refund update", body: message },
        sms: message,
      };
    }
    case "source_refund_brand_state": {
      const message = str(payload.message, "A refund needs review.");
      const operationId = str(payload.operation_id);
      return {
        push: { title: "Refund operation update", body: message },
        email: {
          subject: "Mingla refund operation update",
          body: `${message}\n\nOperation ID: ${operationId}`,
        },
        sms: `${message} Operation ID: ${operationId}`,
      };
    }
    case "buyer_reservation_changed": {
      const context = issue4063BuyerContext(payload);
      if (context !== null) {
        const venue = str(payload.venue_name, brand);
        return {
          push: {
            title: `Booking changed: ${venue}`,
            body:
              `Now ${context.when.date}, ${context.when.time}, ${party} people.`,
          },
          email: {
            subject:
              `Changed: ${venue}, now ${context.when.date} at ${context.when.time}`,
            body:
              "Booking changed.\n\nYour booking in the app is already updated.",
          },
          sms: renderBuyerSms("S9B", {
            venue,
            date: context.when.date,
            time: context.when.time,
            party,
            link: context.link,
            noun: "booking",
            claimed: context.claimed,
          }),
        };
      }
      // COPY §3.1
      return {
        push: {
          title: "Reservation updated",
          body: `${brand}: now ${date} ${time}, party of ${party}.`,
        },
        email: {
          subject: `Your ${brand} reservation changed`,
          body: `Your reservation at ${brand} has been updated.\n\n` +
            `It's now ${date} at ${time}, party of ${party}.\n\n` +
            `See the details in the Mingla app.`,
        },
        sms:
          `${brand}: Your reservation changed - now ${date} ${time}, party of ${party}.`,
      };
    }

    case "buyer_reservation_confirmed": {
      const context = issue4063BuyerContext(payload);
      if (context !== null) {
        const venue = str(payload.venue_name, brand);
        return {
          push: {
            title: `Booked: ${venue}`,
            body:
              `${context.when.date}, ${context.when.time}, ${party} people.`,
          },
          email: {
            subject:
              `Booked: ${venue}, ${context.when.date} at ${context.when.time}`,
            body: `You're booked.\n\nYour booking ${
              context.claimed ? "is in" : "is waiting in"
            } the Mingla app.`,
          },
          sms: renderBuyerSms(
            payload.created_via === "operator" ? "S8H" : "S8",
            {
              venue,
              date: context.when.date,
              time: context.when.time,
              party,
              link: context.link,
              noun: "booking",
              claimed: context.claimed,
            },
          ),
        };
      }
      return {
        push: {
          title: "Reservation confirmed",
          body: `${brand}: ${date} ${time}, party of ${party}.`,
        },
        email: {
          subject: `Your ${brand} reservation is confirmed`,
          body:
            `Your table for ${party} is confirmed at ${brand} on ${date} at ${time}.\n\nSee you there!`,
        },
        sms: `${brand}: Table for ${party} confirmed ${date} ${time}.`,
      };
    }

    case "buyer_reservation_cancelled": {
      // #3391 — the venue cancelled a PAID booking and the refund row already
      // exists (the reservation trigger adds these fields only then). Say the
      // money is on its way; "processing" and "processed" stay with the
      // source_refund_buyer_state notices the refund runner sends.
      const refund = venueCancelRefundAmount(payload);
      if (refund !== null) {
        const line = (amount: string) =>
          `The venue cancelled your reservation. Your ${amount} refund is on its way.`;
        const body = line(refund);
        return {
          push: { title: "Reservation cancelled", body },
          email: {
            subject: `Your ${brand} reservation was cancelled`,
            body: date ? `${body}\n\nReservation: ${brand}, ${date}.` : body,
          },
          sms: `${brand}: ${
            line(venueCancelRefundAmount(payload, { gsm7: true }) ?? refund)
          }`,
        };
      }
      // COPY §3.2
      return {
        push: {
          title: "Reservation cancelled",
          body: `${brand}: your ${date} reservation was cancelled.`,
        },
        email: {
          subject: `Your ${brand} reservation was cancelled`,
          body:
            `Your reservation at ${brand} for ${date} was cancelled.\n\nQuestions? Contact the venue.`,
        },
        sms:
          `${brand}: Your reservation for ${date} was cancelled. Questions? Contact the venue.`,
      };
    }

    case "buyer_venue_order_receipt": {
      const venue = str(payload.venue_name, brand || "the venue");
      const link = str(
        payload.message_link_display ?? payload.message_link_url,
        "usemingla.com/download",
      );
      const claimed = payload.message_link_claimed === true ||
        payload.claimed === true;
      return {
        push: {
          title: `Receipt from ${venue}`,
          body: "Your food-order receipt is in Mingla.",
        },
        email: {
          subject: `Your ${venue} receipt`,
          body: "Your food-order receipt is in the Mingla app.",
        },
        sms: renderBuyerSms("S17", {
          venue,
          link,
          noun: "receipt",
          claimed,
        }),
      };
    }

    case "buyer_door_receipt": {
      const link = str(
        payload.message_link_display ?? payload.message_link_url,
        "usemingla.com/download",
      );
      return {
        push: {
          title: `Receipt from ${eventTitle}`,
          body: "Your door-sale receipt is in Mingla.",
        },
        email: {
          subject: `Your ${eventTitle} receipt`,
          body: "Your door-sale receipt is in the Mingla app.",
        },
        sms: renderBuyerSms("S15", {
          title: eventTitle,
          link,
          noun: "receipt",
        }),
      };
    }

    case "buyer_ticket_sent": {
      const sender = str(payload.sender, "A friend");
      const context = issue4063BuyerContext(payload);
      const link = context?.link ?? str(
        payload.message_link_display ?? payload.message_link_url,
        "usemingla.com/download",
      );
      const when = context?.when ?? { date, time };
      const whenLine = [when.date, when.time].filter(Boolean).join(" ");
      const detail = [eventTitle, whenLine].filter(Boolean).join(" · ");
      return {
        push: {
          title: `${sender} sent you a ticket`,
          body: detail || "Your ticket is waiting in Mingla.",
        },
        email: {
          subject: `${sender} sent you a ticket for ${eventTitle}`,
          body: `${sender} sent you a ticket.${
            detail ? `\n\n${detail}` : ""
          }\n\nGet your ticket using this number: ${link}`,
        },
        sms: renderBuyerSms("S16", {
          sender,
          title: eventTitle,
          date: when.date,
          time: when.time,
          link,
        }),
      };
    }

    case "buyer_event_reminder": {
      const context = issue4063BuyerContext(payload);
      if (context !== null) {
        const noun = issue4063OfferingNoun(payload);
        const twoHour = leadBucket === "2h";
        const dayWord = twoHour
          ? context.when.dayWord === "tonight"
            ? "Tonight"
            : context.when.dayWord === "today"
            ? "Today"
            : context.when.date
          : context.when.dayWord === "tomorrow"
          ? "Tomorrow"
          : context.when.date;
        return {
          push: {
            title: `${dayWord}, ${context.when.time} · ${reminderHeadline}`,
            body: `Tap for your ${noun}.`,
          },
          email: {
            subject: `${dayWord}: ${reminderHeadline} at ${context.when.time}`,
            body: `See you ${dayWord.toLowerCase()}.\n\nYour ${noun} ${
              context.claimed ? "is in" : "is waiting in"
            } the Mingla app.`,
          },
          sms: renderBuyerSms(twoHour ? "S7" : "S6", {
            title: reminderHeadline,
            date: context.when.date,
            time: context.when.time,
            dayWord: context.when.dayWord,
            link: context.link,
            noun,
            claimed: context.claimed,
          }),
        };
      }
      // COPY §3.3 (24h) / §3.4 (2h). #3281 PR6 names the date override when set.
      if (leadBucket === "2h") {
        return {
          push: {
            title: `Starting soon: ${reminderHeadline}`,
            body: `${brand}: starts in 2h at ${time}${reminderPlace}.`,
          },
          email: {
            subject: `${reminderHeadline} starts in 2 hours`,
            body:
              `${reminderHeadline} starts in 2 hours at ${time}${reminderPlace}.\n\n` +
              `See you soon! Details are in the Mingla app.`,
          },
          sms:
            `${brand}: ${reminderHeadline} starts in 2 hours at ${time}${reminderPlace}. See you soon!`,
        };
      }
      return {
        push: {
          title: `Tomorrow: ${reminderHeadline}`,
          body: `${brand}: starts ${time}${reminderPlace}. See you there!`,
        },
        email: {
          subject: `${reminderHeadline} is tomorrow`,
          body:
            `${reminderHeadline} is tomorrow at ${time}${reminderPlace}.\n\n` +
            `See you there! Details are in the Mingla app.`,
        },
        sms:
          `${brand}: ${reminderHeadline} is tomorrow at ${time}${reminderPlace}. See you there!`,
      };
    }

    case "buyer_reservation_reminder": {
      const context = issue4063BuyerContext(payload);
      if (context !== null) {
        const venue = str(payload.venue_name, brand);
        const dayWord = context.when.dayWord === "tonight"
          ? "Tonight"
          : context.when.dayWord === "today"
          ? "Today"
          : context.when.dayWord === "tomorrow"
          ? "Tomorrow"
          : context.when.date;
        return {
          push: {
            title: `${dayWord}, ${context.when.time} · ${venue}`,
            body: `${party} people. Tap for your booking.`,
          },
          email: {
            subject: `${dayWord}: ${venue} at ${context.when.time}`,
            body: `See you ${dayWord.toLowerCase()}.\n\nYour booking ${
              context.claimed ? "is in" : "is waiting in"
            } the Mingla app.`,
          },
          sms: renderBuyerSms("S10V", {
            venue,
            date: context.when.date,
            time: context.when.time,
            dayWord: context.when.dayWord,
            party,
            link: context.link,
            noun: "booking",
            claimed: context.claimed,
          }),
        };
      }
      // COPY §3.5 (24h) / §3.6 (2h).
      if (leadBucket === "2h") {
        return {
          push: {
            title: "Reservation soon",
            body: `${brand}: in 2h at ${time}, party of ${party}.`,
          },
          email: {
            subject: `Your ${brand} reservation is in 2 hours`,
            body:
              `Your reservation at ${brand} is in 2 hours at ${time}, party of ${party}.\n\n` +
              `See you soon!`,
          },
          sms:
            `${brand}: Your reservation is in 2 hours at ${time}, party of ${party}.`,
        };
      }
      return {
        push: {
          title: "Reservation tomorrow",
          body: `${brand}: ${time}, party of ${party}.`,
        },
        email: {
          subject: `Your ${brand} reservation is tomorrow`,
          body:
            `Reminder - your reservation at ${brand} is tomorrow at ${time}, party of ${party}.\n\n` +
            `See you there!`,
        },
        sms:
          `${brand}: Reminder - your reservation is tomorrow at ${time}, party of ${party}.`,
      };
    }

    case "buyer_purchase_confirmation": {
      // COPY §3.11 — NO SMS (DEC-185). Push + email only. The email PDF/.ics
      // artifact stays owned by ticket-confirmation-dispatch (§7.1); this push/
      // inapp leg is the net-new add. The sms string is rendered defensively but
      // the seed has no 'sms' channel for this category so it is never used.
      return {
        push: {
          title: `You're in for ${eventTitle}`,
          body:
            `${brand}: ${date} at ${time} - your tickets are in the Mingla app.`,
        },
        email: {
          subject: `Your ${brand} tickets for ${eventTitle}`,
          body: `You're confirmed for ${eventTitle}. ` +
            `Your ticket and calendar invite are attached, and everything lives in the Mingla app.`,
        },
        sms:
          `${brand}: You're in for ${eventTitle} on ${date}. Tickets in the Mingla app.`,
      };
    }

    case "buyer_refund_issued": {
      // COPY §3.9.
      const amount = fmtAmount(payload);
      return {
        push: {
          title: "Refund issued",
          body: `${brand}: ${amount} refunded, 5-10 days to appear.`,
        },
        email: {
          subject: `Your ${brand} refund has been issued`,
          body: `Your refund of ${amount} from ${brand} has been issued.\n\n` +
            `It should appear on your statement in 5-10 days.`,
        },
        sms:
          `${brand}: Your refund of ${amount} has been issued and should appear in 5-10 days.`,
      };
    }

    case "buyer_order_cancelled":
      // COPY §3.10.
      return {
        push: {
          title: "Order cancelled",
          body:
            `${brand}: your ${eventTitle} order was cancelled; payment refunded.`,
        },
        email: {
          subject: `Your ${brand} order was cancelled`,
          body: `Your order for ${eventTitle} at ${brand} was cancelled.\n\n` +
            `Any payment will be refunded.`,
        },
        sms:
          `${brand}: Your order for ${eventTitle} was cancelled. Any payment will be refunded.`,
      };

    case "buyer_contribution_receipt": {
      // ORCH-1298 [chip-in-receipt-emails] — GUEST gift receipt. Gift-framed
      // thank-you, NOT a tax/invoice/receipt-of-sale document (Seth-locked
      // ORCH-1291 gift semantics: NO "tax", NO "invoice", NO "VAT"). Amount is
      // currency-aware via fmtAmount (reads amount_cents + currency). NO sms
      // channel on the seeded category, so the sms string is defensive only.
      const amount = fmtAmount(payload);
      return {
        push: {
          title: "Gift received 💛",
          body: `Your ${amount} gift to ${eventTitle} is in — thank you!`,
        },
        email: {
          subject: `Thanks for chipping in to ${eventTitle} 💛`,
          body: `Thank you for chipping in ${amount} to ${eventTitle}.\n\n` +
            `Your gift is confirmed. This is a thank-you, not a bill — there is nothing more to pay.\n\n` +
            `See you there!`,
        },
        sms: `${brand}: Your ${amount} gift to ${eventTitle} is in. Thank you!`,
      };
    }

    case "business.rsvp_contribution_received": {
      // ORCH-1298 [chip-in-receipt-emails] — HOST "you got a gift" moment. Routes
      // to the BUSINESS OneSignal app via the `business.` category prefix
      // (resolveOneSignalApp / I-PROPOSED-W). Positive gift framing, NO
      // tax/invoice language. Amount currency-aware; guest label from payload.
      const amount = fmtAmount(payload);
      const guest = str(payload.guest_name, "Someone");
      return {
        push: {
          title: "You got a gift 🎁",
          body: `${guest} chipped in ${amount} to ${eventTitle}.`,
        },
        email: {
          subject: `${guest} chipped in ${amount} to ${eventTitle}`,
          body:
            `Good news — ${guest} just chipped in ${amount} to ${eventTitle}.\n\n` +
            `It's on its way to your connected account. See the details in Mingla Host.`,
        },
        sms: `${brand}: ${guest} chipped in ${amount} to ${eventTitle}.`,
      };
    }

    default:
      // Generic fallback — never fabricate; render a plain notice from payload.
      return {
        push: {
          title: str(payload.title, "Mingla update"),
          body: str(payload.body, ""),
        },
        email: {
          subject: str(payload.title, "Mingla update"),
          body: str(payload.body, ""),
        },
        sms: `${brand}: ${str(payload.body, "You have a new update.")}`,
      };
  }
}
