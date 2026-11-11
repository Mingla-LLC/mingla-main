// #4382 — customer-facing support notifications.
//
// Producer: issue_4382_enqueue_customer_alert (SQL) writes notification_outbox
// rows only. This module is the one place the dispatcher, the outbox drain and
// the templates learn about these categories. Pure: no env reads, no I/O.
//
// Host replies keep the legacy business.support_message push from
// notify-support; everything else for a customer is one of these.

export const ISSUE_4382_SUPPORT_CATEGORIES = [
  "business.support_status_changed",
  "business.support_product_update",
  "explorer.support_reply",
  "explorer.support_status_changed",
  "explorer.support_product_update",
] as const;

export type Issue4382SupportCategory =
  typeof ISSUE_4382_SUPPORT_CATEGORIES[number];

export function isIssue4382SupportCategory(
  category: string,
): category is Issue4382SupportCategory {
  return (ISSUE_4382_SUPPORT_CATEGORIES as readonly string[]).includes(
    category,
  );
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The deep link must open this ticket in the app the category belongs to. */
export function issue4382DeepLinkValid(
  category: Issue4382SupportCategory,
  deepLink: string | null | undefined,
  payload: Record<string, unknown> = {},
): boolean {
  const id = typeof payload.ticket_id === "string" ? payload.ticket_id : "";
  if (!new RegExp(`^${UUID}$`, "i").test(id)) return false;
  const expected = category.startsWith("explorer.")
    ? `mingla://support/${id}`
    : `mingla-business://support/${id}`;
  return deepLink === expected;
}

/** Only opaque ids reach the push provider — never subjects or message text. */
export function issue4382ProviderSafeKeys(): string[] {
  return ["ticket_id", "message_id", "update_kind", "status"];
}

function text(value: unknown, fallback: string): string {
  const v = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return v || fallback;
}

function ticketLabel(payload: Record<string, unknown>): string {
  const n = Number(payload.ticket_number);
  return Number.isInteger(n) && n > 0 ? `S-${n}` : "your request";
}

const STATUS_WORDS: Record<string, string> = {
  new: "is waiting for Mingla",
  open: "is open again",
  pending: "is waiting for an update from Mingla",
  resolved: "is resolved",
  closed: "is closed",
};

export function renderIssue4382Message(
  category: Issue4382SupportCategory,
  payload: Record<string, unknown>,
): {
  push: { title: string; body: string };
  email: { subject: string; body: string };
  sms: string;
} {
  const label = ticketLabel(payload);
  const subject = text(payload.subject, "your request");
  switch (category) {
    case "explorer.support_reply":
      return {
        push: {
          title: "Mingla replied",
          body: `New reply on ${label}: ${subject}`,
        },
        email: {
          subject: "Mingla replied",
          body: `There is a new reply on ${label}: ${subject}.`,
        },
        sms: `Mingla: new reply on ${label}.`,
      };
    case "business.support_status_changed":
    case "explorer.support_status_changed": {
      const kind = text(payload.update_kind, "status");
      if (kind === "opened") {
        return {
          push: { title: "Mingla opened a request with you", body: subject },
          email: { subject: "Mingla opened a request with you", body: subject },
          sms: `Mingla opened ${label} with you.`,
        };
      }
      if (kind === "next_update") {
        return {
          push: {
            title: `Update on ${label}`,
            body: `Mingla set a time for the next update: ${subject}`,
          },
          email: {
            subject: `Update on ${label}`,
            body: `Mingla set a time for the next update on ${subject}.`,
          },
          sms: `Mingla: new update time for ${label}.`,
        };
      }
      const words = STATUS_WORDS[text(payload.status, "")] ?? "has changed";
      return {
        push: { title: `${label} ${words}`, body: subject },
        email: { subject: `${label} ${words}`, body: subject },
        sms: `Mingla: ${label} ${words}.`,
      };
    }
    case "business.support_product_update":
    case "explorer.support_product_update":
      return {
        push: {
          title: "It's live",
          body: `What you reported is fixed: ${subject}`,
        },
        email: {
          subject: "It's live",
          body: `What you reported on ${label} is now live: ${subject}.`,
        },
        sms: `Mingla: what you reported on ${label} is now live.`,
      };
  }
}
