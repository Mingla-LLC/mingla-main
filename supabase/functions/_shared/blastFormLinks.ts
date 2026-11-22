// #4541 R4.3 / R4.10: a Blast's "+ Form" links. Pure, no I/O: shared by the
// Blast quote (_shared/marketingBookQuote.ts, which counts the SMS link at its
// real length) and marketing-send (which mints each recipient's own link).
//
// The link never passes through the /m/ click-tracking redirect (C3): opening
// it is counted by brand_form_link_resolve (use_count).

export const BLAST_FORM_LINK_ORIGIN = "https://host.usemingla.com";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The embedded form of a campaign payload (channel_payload.embedded_form.form_id), or null. */
export function embeddedFormIdOf(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const ef = (payload as Record<string, unknown>).embedded_form;
  if (!ef || typeof ef !== "object" || Array.isArray(ef)) return null;
  const id = (ef as Record<string, unknown>).form_id;
  return typeof id === "string" && UUID.test(id) ? id.toLowerCase() : null;
}

/** One recipient's personal form link: /form/{formId}?c={campaignId}#t={token}. */
export function blastFormUrl(formId: string, campaignId: string, token: string): string {
  if (!UUID.test(formId) || !UUID.test(campaignId) || !/^[0-9a-f]{64}$/.test(token)) {
    throw new Error("blast_form_link_invalid");
  }
  return `${BLAST_FORM_LINK_ORIGIN}/form/${formId}?c=${campaignId}#t=${token}`;
}

/** A link of exactly the real length, for quotes and segment counts (about 130 characters). */
export const BLAST_FORM_SAMPLE_URL = blastFormUrl(
  "00000000-0000-4000-8000-000000000000",
  "00000000-0000-4000-8000-000000000000",
  "0".repeat(64),
);

/** The SMS line a Blast with a form appends to each text (after link tracking). */
export function blastFormSmsLine(url: string): string {
  return ` Answer: ${url}`;
}

/** The push deep link of a Blast's form (only for app-ready recipients). */
export function blastFormPushDeepLink(formId: string, campaignId: string): string {
  if (!UUID.test(formId) || !UUID.test(campaignId)) throw new Error("blast_form_link_invalid");
  return `mingla://form/${formId}?campaign=${campaignId}&from=push`;
}
