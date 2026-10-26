// #4111 — Customer enquiry notifications.
//
// Producers live in SQL (20271221014111 / 20271222004111) and write
// notification_outbox rows only. This module is the one place the dispatcher,
// the outbox drain and the templates learn about these categories. Pure: no
// env reads, no I/O.

export const ISSUE_4111_ENQUIRY_CATEGORIES = [
  "business.brand_enquiry_new",
  "business.brand_enquiry_message",
  "business.brand_enquiry_nudge",
  "explorer.brand_enquiry_reply",
] as const;

export type Issue4111EnquiryCategory = typeof ISSUE_4111_ENQUIRY_CATEGORIES[number];

export function isIssue4111EnquiryCategory(
  category: string,
): category is Issue4111EnquiryCategory {
  return (ISSUE_4111_ENQUIRY_CATEGORIES as readonly string[]).includes(category);
}

/** Categories with an email channel; the drain resolves a team member's address. */
export const ISSUE_4111_EMAIL_CATEGORIES: readonly string[] = [
  "business.brand_enquiry_nudge",
];

const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const HOST_THREAD_LINK = new RegExp(`^mingla-business://messages/(${UUID})$`);
const EXPLORER_THREAD_LINK = new RegExp(
  `^mingla://chat/(${UUID})\\?type=brand_enquiry&enquiryId=(${UUID})$`,
);

/** The deep link each category may carry; it must name the payload's thread. */
export function issue4111DeepLinkValid(
  category: Issue4111EnquiryCategory,
  deepLink: string | null | undefined,
  payload: Record<string, unknown> = {},
): boolean {
  if (typeof deepLink !== "string") return false;
  const conversationId = typeof payload.conversation_id === "string" ? payload.conversation_id : "";
  if (category === "explorer.brand_enquiry_reply") {
    const match = EXPLORER_THREAD_LINK.exec(deepLink);
    return !!match && match[1] === conversationId &&
      match[2] === (typeof payload.enquiry_id === "string" ? payload.enquiry_id : "");
  }
  const match = HOST_THREAD_LINK.exec(deepLink);
  return !!match && match[1] === conversationId;
}

/** Only opaque ids ever reach the push provider — never guest names or text. */
export function issue4111ProviderSafeKeys(): string[] {
  return ["enquiry_id", "conversation_id", "message_id", "brand_id"];
}

export function issue4111PushThreadId(
  category: string,
  payload: Record<string, unknown>,
): string | undefined {
  if (!isIssue4111EnquiryCategory(category)) return undefined;
  return typeof payload.conversation_id === "string"
    ? `brand_enquiry:${payload.conversation_id}`
    : undefined;
}

/** The nudge email button opens the Host inbox on the web. */
export function issue4111EmailCta(
  category: string,
  payload: Record<string, unknown>,
): { label: string; url: string; note: string } | undefined {
  if (category !== "business.brand_enquiry_nudge") return undefined;
  const conversationId = typeof payload.conversation_id === "string" ? payload.conversation_id : "";
  if (!new RegExp(`^${UUID}$`).test(conversationId)) return undefined;
  return {
    label: "Reply in Mingla Host",
    url: `https://host.usemingla.com/messages/${conversationId}`,
    note: "You get this email because guests can message your brand on Mingla. " +
      "You can turn messages off under Contact in your brand settings.",
  };
}

function text(value: unknown, fallback: string): string {
  const v = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return v || fallback;
}

function excerpt(value: unknown, max = 180): string {
  const v = text(value, "");
  return v.length <= max ? v : `${v.slice(0, max - 1).trimEnd()}…`;
}

export function renderIssue4111Message(
  category: Issue4111EnquiryCategory,
  payload: Record<string, unknown>,
): { push: { title: string; body: string }; email: { subject: string; body: string }; sms: string } {
  const brand = text(payload.brand_name, "your brand");
  const guest = text(payload.guest_name, "A guest");
  const topic = text(payload.topic_label, "a question");
  const body = excerpt(payload.body);
  switch (category) {
    case "business.brand_enquiry_new":
      return {
        push: { title: `New enquiry for ${brand}`, body: `${guest} · ${topic}${body ? `: ${body}` : ""}` },
        email: { subject: `New enquiry for ${brand}`, body: `${guest} asked about ${topic}.` },
        sms: `Mingla: New enquiry for ${brand} from ${guest}.`,
      };
    case "business.brand_enquiry_message":
      return {
        push: { title: `${guest} replied`, body: body || `New message about ${topic}` },
        email: { subject: `${guest} replied`, body: body || `New message about ${topic}.` },
        sms: `Mingla: ${guest} replied to ${brand}.`,
      };
    case "business.brand_enquiry_nudge":
      return {
        push: { title: `${guest} is waiting for a reply`, body: `${brand} · ${topic}` },
        email: {
          subject: `${guest} is waiting for a reply from ${brand}`,
          body: `${guest} sent ${brand} a message about ${topic} a day ago and has not had a reply yet.`,
        },
        sms: `Mingla: ${guest} is waiting for a reply from ${brand}.`,
      };
    case "explorer.brand_enquiry_reply": {
      const sender = text(payload.sender_name, brand);
      return {
        push: { title: sender, body: body || `${brand} replied to your message` },
        email: { subject: `${brand} replied`, body: body || `${brand} replied to your message.` },
        sms: `Mingla: ${brand} replied to your message.`,
      };
    }
  }
}

// Subscribe confirmation text (public-brand-subscribe). Sent through
// notify-dispatch so can_send / STOP suppressions and the footer apply; the
// confirm link rides only in that request, never in a stored row.
export const ISSUE_4111_SUBSCRIBE_SMS_CATEGORY = "web.brand_subscribe_confirm";

export function renderIssue4111SubscribeSms(
  payload: Record<string, unknown>,
): { push: { title: string; body: string }; email: { subject: string; body: string }; sms: string } {
  const brand = text(payload.brand_name, "this brand");
  const url = typeof payload.confirm_url === "string" ? payload.confirm_url : "";
  const line = `Confirm texts from ${brand} via Mingla: ${url}`.trim();
  return {
    push: { title: `Confirm texts from ${brand}`, body: line },
    email: { subject: `Confirm texts from ${brand}`, body: line },
    sms: line,
  };
}
