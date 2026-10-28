/**
 * #2829 W5 (amendment A4) — a site's contact form and newsletter box, and the
 * exact contract they speak with Mingla's public enquiry and subscribe
 * functions (#4111: `public-brand-enquiry`, `public-brand-subscribe`).
 *
 * Messages and signups land in the brand's Mingla contacts and Customer
 * enquiries (#4111 owns storage, consent, rate limits and notifications). The
 * site keeps no copy. This module is the ONE place the request bodies and the
 * response meanings are written down, so the runtime route, its contract test
 * and any later caller agree byte for byte.
 *
 * Shapes, from #4111's handler header contracts:
 *   enquiry  POST {brand_id, entry:"site", context_kind:"none", source:"site",
 *                  reason:"website_contact", origin, name (1–80), email,
 *                  phone? (E.164), body (10–2000), hp, t0}
 *            → 202 {status:"sent", thread_url} | 400 {error:"invalid_input", field}
 *              | 404 {error:"enquiries_unavailable"} | 403 {error:"origin_not_allowed"}
 *   subscribe POST {brand_id, email, hp, t0, source:"site", origin,
 *                  disclosure_text, disclosure_version}   (double opt-in)
 *            → 202 {status:"sent"} | 400 {error:"invalid_input", field}
 *              | 403 {error:"origin_not_allowed"}
 * Both refuse silently (still 202) when the form was filled in under 3 s, the
 * honeypot is filled, or a rate limit is hit — so the site checks the first
 * two itself and tells the visitor, rather than showing "sent" for a message
 * that was dropped (no silent failures).
 */

export const ENQUIRY_FUNCTION = "public-brand-enquiry" as const;
export const SUBSCRIBE_FUNCTION = "public-brand-subscribe" as const;

/** #4111 drops anything submitted faster than this after the form opened. */
export const FORM_MIN_FILL_MS = 3_000;
/** A rendered form stays valid this long (a tab left open overnight re-renders). */
export const FORM_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const CONTACT_NAME_MAX = 80;
export const CONTACT_MESSAGE_MIN = 10;
export const CONTACT_MESSAGE_MAX = 2000;
export const EMAIL_MAX = 254;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const E164_RE = /^\+[1-9][0-9]{6,14}$/;

export type FormKind = "contact" | "newsletter";

/** What a visitor is told; the runtime owns the words (formErrorMessage). */
export type FormErrorCode =
  | "missing"
  | "email"
  | "phone"
  | "short"
  | "toolong"
  | "fast"
  | "expired"
  | "trap"
  | "rate"
  | "unavailable"
  | "server";

export const FORM_ERROR_CODES: readonly FormErrorCode[] = [
  "missing", "email", "phone", "short", "toolong", "fast", "expired", "trap", "rate", "unavailable", "server",
];

export function isFormErrorCode(value: unknown): value is FormErrorCode {
  return typeof value === "string" && (FORM_ERROR_CODES as readonly string[]).includes(value);
}

/** Collapses whitespace the way a browser shows it. */
function shown(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * The exact words a newsletter box shows next to its button, in reading
 * order (heading, body, button label, small print), one line each. This is
 * the consent text recorded with a signup: what the visitor saw, nothing more.
 */
export function newsletterDisclosureText(block: {
  heading?: unknown;
  body?: unknown;
  button_label?: unknown;
  small_print?: unknown;
}): string {
  return [block.heading, block.body, block.button_label, block.small_print].map(shown).filter(Boolean).join("\n");
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** `site-<kind>:<first 16 hex of sha256(text)>` — stable for the same words. */
export async function disclosureVersion(kind: FormKind, text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `site-${kind}:${hex(digest).slice(0, 16)}`;
}

export type ContactInput = { name: string; email: string; phone: string | null; message: string };

/** The visitor's contact form fields, checked exactly as #4111 will. */
export function checkContactInput(
  raw: { name?: unknown; email?: unknown; phone?: unknown; message?: unknown },
  options: { phoneShown: boolean },
): { ok: true; value: ContactInput } | { ok: false; error: FormErrorCode } {
  const name = shown(raw.name);
  const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  const phoneRaw = options.phoneShown && typeof raw.phone === "string" ? raw.phone.replace(/[\s().-]/g, "") : "";
  if (!name || !email || !message) return { ok: false, error: "missing" };
  if (name.length > CONTACT_NAME_MAX || message.length > CONTACT_MESSAGE_MAX) return { ok: false, error: "toolong" };
  if (email.length > EMAIL_MAX || !EMAIL_RE.test(email)) return { ok: false, error: "email" };
  if (message.length < CONTACT_MESSAGE_MIN) return { ok: false, error: "short" };
  if (phoneRaw && !E164_RE.test(phoneRaw)) return { ok: false, error: "phone" };
  return { ok: true, value: { name, email, phone: phoneRaw || null, message } };
}

export function checkNewsletterEmail(raw: unknown): { ok: true; email: string } | { ok: false; error: FormErrorCode } {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!email) return { ok: false, error: "missing" };
  if (email.length > EMAIL_MAX || !EMAIL_RE.test(email)) return { ok: false, error: "email" };
  return { ok: true, email };
}

/** The honeypot and the time since the form was rendered. */
export function checkSubmissionTiming(
  input: { honeypot: unknown; renderedAt: number; now: number },
): FormErrorCode | null {
  if (typeof input.honeypot === "string" ? input.honeypot.trim() !== "" : input.honeypot != null) return "trap";
  const age = input.now - input.renderedAt;
  if (!Number.isFinite(age) || age < 0 || age > FORM_MAX_AGE_MS) return "expired";
  if (age < FORM_MIN_FILL_MS) return "fast";
  return null;
}

/** The request body for #4111 `public-brand-enquiry` (a site contact form). */
export function enquiryRequestBody(input: {
  brandId: string;
  siteId: string;
  renderedAt: number;
  contact: ContactInput;
}): Record<string, unknown> {
  return {
    brand_id: input.brandId,
    entry: "site",
    context_kind: "none",
    source: "site",
    reason: "website_contact",
    origin: input.siteId,
    name: input.contact.name,
    email: input.contact.email,
    ...(input.contact.phone ? { phone: input.contact.phone } : {}),
    body: input.contact.message,
    hp: "",
    t0: input.renderedAt,
  };
}

/** The request body for #4111 `public-brand-subscribe` (a site newsletter box). */
export function subscribeRequestBody(input: {
  brandId: string;
  siteId: string;
  renderedAt: number;
  email: string;
  disclosureText: string;
  disclosureVersion: string;
}): Record<string, unknown> {
  return {
    brand_id: input.brandId,
    email: input.email,
    hp: "",
    t0: input.renderedAt,
    source: "site",
    origin: input.siteId,
    disclosure_text: input.disclosureText,
    disclosure_version: input.disclosureVersion,
  };
}

/**
 * What #4111's answer means for the visitor. 202 is the only success; a
 * field refusal maps to the field's own message; "enquiries off" is said
 * plainly; everything else (403, 405, 5xx, junk) is a retryable failure.
 */
export function formOutcome(
  kind: FormKind,
  status: number,
  body: unknown,
): { ok: true } | { ok: false; error: FormErrorCode } {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (status === 202 && record.status === "sent") return { ok: true };
  if (status === 400 && record.error === "invalid_input") {
    switch (record.field) {
      case "email":
        return { ok: false, error: "email" };
      case "phone":
        return { ok: false, error: kind === "contact" ? "phone" : "server" };
      case "name":
      case "body":
        return { ok: false, error: kind === "contact" ? "missing" : "server" };
      default:
        return { ok: false, error: "server" };
    }
  }
  if (status === 404 && record.error === "enquiries_unavailable" && kind === "contact") {
    return { ok: false, error: "unavailable" };
  }
  return { ok: false, error: "server" };
}
