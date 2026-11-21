// #4514 wave 4 — the two notify v2 categories of brand form sending.
//
//   brand_form_request                 a host asked a guest to answer a form
//                                      (Ask guests to answer, Remind, the
//                                      automatic reminder). A text or email to
//                                      the contact on file carries the guest's
//                                      personal link, which only ever travels in
//                                      the anonymous contact path (no inbox row,
//                                      the ledger keeps no body). Push is off
//                                      until the Explorer /form route ships
//                                      (FORM_REQUEST_PUSH_ENABLED).
//   business.brand_form_reminder_held  the automatic reminder was held because
//                                      the form had closed (decision 10).
//
// Pure: no env reads, no I/O. Hooked into renderCategoryMessage,
// providerSafePayload and validDeepLink by one line each.

export const BRAND_FORM_REQUEST_CATEGORY = "brand_form_request";
export const BRAND_FORM_REMINDER_HELD_CATEGORY =
  "business.brand_form_reminder_held";

export function isBrandFormCategory(category: string): boolean {
  return category === BRAND_FORM_REQUEST_CATEGORY ||
    category === BRAND_FORM_REMINDER_HELD_CATEGORY;
}

interface Rendered {
  push: { title: string; body: string };
  email: { subject: string; body: string };
  sms: string;
}

function plain(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Only a personal form link on the production host page, never anything else. */
export function brandFormLinkValid(url: unknown): url is string {
  return typeof url === "string" &&
    /^https:\/\/host\.usemingla\.com\/form\/[0-9a-f-]{36}#t=[0-9a-f]{64}$/.test(
      url,
    );
}

/** Ids only reach the push provider; names and links stay with Mingla. */
export function brandFormProviderSafeKeys(category: string): string[] {
  return category === BRAND_FORM_REQUEST_CATEGORY
    ? ["form_id", "event_id", "rsvp_id", "order_id"]
    : ["form_id", "event_id", "brand_id"];
}

/** The host's link to the form's Responses page (the held-reminder notice). */
export function brandFormHeldDeepLink(formId: string): string {
  return `mingla-business://marketing/forms/${formId}/responses`;
}

/**
 * The request opens no deep link (the Explorer `/form` route ships later); the
 * held notice opens the form's Responses page in the Host app, for its own
 * form only.
 */
export function brandFormDeepLinkValid(
  category: string,
  deepLink: string | null | undefined,
  payload: Record<string, unknown> = {},
): boolean {
  if (deepLink === null || deepLink === undefined) return true;
  return category === BRAND_FORM_REMINDER_HELD_CATEGORY &&
    typeof payload.form_id === "string" &&
    /^[0-9a-f-]{36}$/.test(payload.form_id) &&
    deepLink === brandFormHeldDeepLink(payload.form_id);
}

/** "Sat 21 Nov" in the page's own time zone (empty when unknown). */
export function brandFormDateLabel(value: unknown, timeZone: unknown): string {
  if (typeof value !== "string") return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
  };
  try {
    return new Intl.DateTimeFormat("en-GB", {
      ...opts,
      timeZone: typeof timeZone === "string" && timeZone.length > 0
        ? timeZone
        : "UTC",
    }).format(at).replace(",", "");
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" })
      .format(at).replace(",", "");
  }
}

/** The email button: the guest's own form, from a validated link only. */
export function brandFormEmailCta(
  category: string,
  payload: Record<string, unknown>,
): { label: string; url: string; note: string } | undefined {
  if (category !== BRAND_FORM_REQUEST_CATEGORY) return undefined;
  if (!brandFormLinkValid(payload.form_url)) return undefined;
  const brand = plain(payload.brand_name, 80) || "The host";
  return {
    label: "Answer the questions",
    url: payload.form_url,
    note: `This link is just for you. ${brand} sees your answers.`,
  };
}

export function renderBrandFormMessage(
  category: string,
  payload: Record<string, unknown>,
): Rendered {
  const brand = plain(payload.brand_name, 80) || "The host";
  const event = plain(payload.event_title, 90);
  if (category === BRAND_FORM_REMINDER_HELD_CATEGORY) {
    const form = plain(payload.form_name, 80) || "your form";
    const line = event
      ? `The reminder for ${form} on ${event} wasn't sent because the form is closed.`
      : `The reminder for ${form} wasn't sent because the form is closed.`;
    return {
      push: { title: "Reminder held", body: line },
      email: { subject: "Reminder held", body: line },
      sms: "",
    };
  }
  const day = brandFormDateLabel(payload.event_date, payload.event_timezone);
  const ask = event
    ? `${brand} has a few questions about ${event}${day ? ` on ${day}` : ""}.`
    : `${brand} has a few questions.`;
  const link = brandFormLinkValid(payload.form_url) ? payload.form_url : null;
  return {
    push: { title: `Questions from ${brand}`, body: `${ask} Tap to answer.` },
    email: {
      subject: `${brand} has a few questions`,
      body: link
        ? ask
        : `${ask}\n\nOpen your ticket or pass in Mingla to answer.`,
    },
    // No link, no text: a text is only ever sent with the guest's own link.
    sms: link ? `${ask} Answer here: ${link}` : "",
  };
}
