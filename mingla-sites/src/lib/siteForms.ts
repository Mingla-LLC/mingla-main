import { timingSafeEqual } from "node:crypto";
import { isFormErrorCode, type FormErrorCode, type FormKind } from "../contracts/generated/forms.ts";
import { hmacBase64 } from "./crypto";
import { runtimeConfig } from "./config";

/*
 * #2829 W5 — what a rendered contact form or newsletter box carries, and what
 * the page shows after a send without JavaScript.
 *
 * Each form is stamped with the moment it was rendered and an HMAC over
 * `site_id|rendered_at`, so the send route knows how long the visitor took
 * (Mingla drops anything faster than 3 s) and that the stamp came from this
 * site's own page. The key is derived from the runtime's signing key under
 * its own label: no new secret.
 */
const FORM_KEY_LABEL = "mingla-sites/forms/v1";

let derivedKey: { source: string; key: string } | undefined;

async function formKey(): Promise<string> {
  const source = runtimeConfig().runtimeHmac;
  if (derivedKey?.source === source) return derivedKey.key;
  const key = await hmacBase64(source, FORM_KEY_LABEL);
  derivedKey = { source, key };
  return key;
}

export async function formStampSignature(siteId: string, renderedAt: number): Promise<string> {
  return hmacBase64(await formKey(), `${siteId}|${renderedAt}`);
}

export async function formStampValid(siteId: string, renderedAt: number, signature: unknown): Promise<boolean> {
  if (typeof signature !== "string" || signature.length > 100 || !Number.isSafeInteger(renderedAt)) return false;
  const expected = Buffer.from(await formStampSignature(siteId, renderedAt));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Whether this brand takes messages, as Mingla says (A4). */
export type EnquiryAvailability = "available" | "unavailable" | "unknown";

/** The status line one form shows after a send without JavaScript. */
export type FormNotice = { blockIndex: number; kind: FormKind; ok: true } | { blockIndex: number; kind: FormKind; ok: false; error: FormErrorCode };

export type FormsContext = {
  renderedAt: number;
  signature: string;
  enquiries: EnquiryAvailability;
  notice: FormNotice | null;
  /** A private preview never sends (it shows the form, switched off). */
  preview?: boolean;
  /** #2829 W10 — a private share link (a visitor outside the team is looking). */
  shared?: boolean;
};

/** `?sent=<kind>&form=<i>` or `?formError=<code>&form=<i>` → the notice (junk ignored). */
export function formNoticeFrom(search: Record<string, string | string[] | undefined> | undefined): FormNotice | null {
  const one = (key: string) => {
    const value = search?.[key];
    return typeof value === "string" ? value : undefined;
  };
  const index = Number(one("form"));
  if (!Number.isInteger(index) || index < 0 || index > 59) return null;
  const sent = one("sent");
  if (sent === "contact" || sent === "newsletter") return { blockIndex: index, kind: sent, ok: true };
  const error = one("formError");
  const kind = one("formKind");
  if (isFormErrorCode(error) && (kind === "contact" || kind === "newsletter")) return { blockIndex: index, kind, ok: false, error };
  return null;
}

/** The visitor-facing words for each refusal (the site owns its copy). */
export function formErrorMessage(code: FormErrorCode, brand: { name: string; fallbackEmail?: string | null }): string {
  switch (code) {
    case "missing":
      return "Please fill in each required field.";
    case "email":
      return "Please check your email address.";
    case "phone":
      return "Please check your phone number, starting with the country code (for example +1 555 010 0100).";
    case "short":
      return "Your message is a little short. Please add a few more words.";
    case "toolong":
      return "That is longer than we can send. Please shorten it.";
    case "fast":
      return "That was very quick. Please check your details and send it again.";
    case "expired":
      return "This form has expired. Please reload the page and try again.";
    case "trap":
      return "We couldn't send that. Please try again.";
    case "rate":
      return "You've sent a few already. Please wait a while and try again.";
    case "unavailable":
      return brand.fallbackEmail
        ? `Messages can't be sent from this website right now. Please email ${brand.fallbackEmail}.`
        : `Messages can't be sent from this website right now. Please try again later.`;
    case "server":
      return "We couldn't send that just now. Please check your connection and try again.";
  }
}

export function formSuccessMessage(kind: FormKind, brandName: string, successText?: unknown): string {
  if (kind === "newsletter") return "Check your inbox to confirm your subscription.";
  return typeof successText === "string" && successText.trim() ? successText.trim() : `Thanks, your message is with ${brandName}.`;
}

/** The anchor id of a form on its page. */
export function formAnchor(blockIndex: number): string {
  return `form-${blockIndex}`;
}
