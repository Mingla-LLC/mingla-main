// #4514 wave 4 — the two notify v2 categories of brand form sending.
//
//   brand_form_request                 a host asked a guest to answer a form
//                                      (Ask guests to answer, Remind, the
//                                      automatic reminder). A text or email to
//                                      the contact on file carries the guest's
//                                      personal link, which only ever travels in
//                                      the anonymous contact path (no inbox row,
//                                      the ledger keeps no body). #4541: a push
//                                      (and its inbox row) carries only a deep
//                                      link built from ids, behind the
//                                      BRAND_FORMS_PUSH database switch.
//   business.brand_form_reminder_held  the automatic reminder was held because
//                                      the form had closed (decision 10).
//
// Pure: no env reads, no I/O. Hooked into renderCategoryMessage,
// providerSafePayload and validDeepLink by one line each.

export const BRAND_FORM_REQUEST_CATEGORY = "brand_form_request";
export const BRAND_FORM_REMINDER_HELD_CATEGORY =
  "business.brand_form_reminder_held";
/** #4541 R4.3: a scheduled Blast was not sent because its form closed first. */
export const BLAST_FORM_CLOSED_CATEGORY = "business.blast_form_closed";

export function isBrandFormCategory(category: string): boolean {
  return category === BRAND_FORM_REQUEST_CATEGORY ||
    category === BRAND_FORM_REMINDER_HELD_CATEGORY ||
    category === BLAST_FORM_CLOSED_CATEGORY;
}

interface Rendered {
  push: { title: string; body: string };
  email: { subject: string; body: string };
  sms: string;
}

/** A brand or event name for the lock screen: 40 characters, no address or "@". */
function pushName(value: unknown): string {
  if (typeof value !== "string") return "";
  const cleaned = value.replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, " ").replace(/\S*@\S*/g, " ")
    .replace(/\bt=\S*/gi, " ");
  return plain(cleaned, 40);
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
    ? ["form_id", "event_id", "rsvp_id", "order_id", "rsvp_guest_id"]
    : category === BLAST_FORM_CLOSED_CATEGORY
    ? ["campaign_id", "form_id", "brand_id"]
    : ["form_id", "event_id", "brand_id"];
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * #4541 R3.3: the form request push's deep link, built only from ids. Orders and
 * RSVPs open their purchase page with the form named in the query: app 1.3.x
 * ignores the extra parameters and opens the ticket or pass (scenario 7); a new
 * build opens the form over it. A claimed plus-one has no purchase page of its
 * own, so it opens the form route (1.3.x falls back to its type route).
 */
export function brandFormRequestPushDeepLink(p: {
  formId: string;
  eventId: string;
  subjectKind: "rsvp" | "rsvp_guest" | "order";
  subjectId: string;
}): string {
  if (![p.formId, p.eventId, p.subjectId].every((v) => ID.test(v))) {
    throw new Error("brand_form_push_link_ids");
  }
  return p.subjectKind === "rsvp_guest"
    ? `mingla://form/${p.formId}?event=${p.eventId}&as=rsvp_guest&sid=${p.subjectId}&from=push`
    : `mingla://purchases/${p.subjectKind}/${p.subjectId}?form=${p.formId}&event=${p.eventId}`;
}

/** The one deep link a form request may carry: the one its own payload ids build. */
function brandFormRequestDeepLinkValid(
  deepLink: string,
  payload: Record<string, unknown>,
): boolean {
  const formId = payload.form_id, eventId = payload.event_id;
  if (typeof formId !== "string" || typeof eventId !== "string") return false;
  const subject = typeof payload.order_id === "string"
    ? { subjectKind: "order" as const, subjectId: payload.order_id }
    : typeof payload.rsvp_id === "string"
    ? { subjectKind: "rsvp" as const, subjectId: payload.rsvp_id }
    : typeof payload.rsvp_guest_id === "string"
    ? { subjectKind: "rsvp_guest" as const, subjectId: payload.rsvp_guest_id }
    : null;
  if (subject === null) return false;
  try {
    return deepLink === brandFormRequestPushDeepLink({ formId, eventId, ...subject });
  } catch {
    return false;
  }
}

/** The host's link to the form's Responses page (the held-reminder notice). */
export function brandFormHeldDeepLink(formId: string): string {
  return `mingla-business://marketing/forms/${formId}/responses`;
}

/**
 * #4541 R3.3: a request opens only the deep link its own ids build
 * (brandFormRequestPushDeepLink); the held notice opens the form's Responses
 * page in the Host app, for its own form only.
 */
export function brandFormDeepLinkValid(
  category: string,
  deepLink: string | null | undefined,
  payload: Record<string, unknown> = {},
): boolean {
  if (deepLink === null || deepLink === undefined) return true;
  if (category === BRAND_FORM_REQUEST_CATEGORY) {
    return brandFormRequestDeepLinkValid(deepLink, payload);
  }
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
  if (category === BLAST_FORM_CLOSED_CATEGORY) {
    const campaign = plain(payload.campaign_name, 80) || "Your Blast";
    const form = plain(payload.form_name, 80) || "its form";
    const line = `${campaign} wasn't sent because ${form} is closed. Reopen the form, then send again.`;
    return {
      push: { title: "Blast not sent", body: line },
      email: { subject: "Blast not sent", body: line },
      sms: "",
    };
  }
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
  // #4541 R3.6: the lock screen. Names cut to 40 characters; never a link, a
  // token, a contact, an answer or a question (an "@" or a web address in a
  // name is dropped).
  const pBrand = pushName(payload.brand_name) || "The host";
  const pEvent = pushName(payload.event_title);
  const remind = payload.request_kind === "remind" || payload.request_kind === "auto";
  const about = pEvent ? ` about ${pEvent}${day ? ` on ${day}` : ""}` : "";
  const pushBody = remind
    ? `Still to answer: a few questions${about}.`
    : `${pBrand} has a few questions${about}. Tap to answer.`;
  return {
    push: { title: `Questions from ${pBrand}`, body: pushBody },
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
