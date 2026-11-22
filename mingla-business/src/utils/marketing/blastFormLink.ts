/**
 * #4541 R4.2 / R4.10 — a Blast's "+ Form", client side. Pure leaf (imports
 * nothing), so the composer's static cards can count the text honestly without
 * pulling any forms code.
 *
 * Composer side only (the composer route and `campaignChannelGroupService`,
 * which only the composer loads). The payload reader is `blastFormPayload.ts`
 * and the forms owner's count is `blastFormUsage.ts`: a module reached from
 * both the composer chunk and the forms owner chunk is hoisted into the eager
 * Host web `__common` chunk (gate: issue-4541-forms-owner-no-nested-lazy R3).
 *
 * Each recipient gets their own link, `https://host.usemingla.com/form/{formId}
 * ?c={campaignId}#t={token}`, never through click tracking. The text adds
 * " Answer: {link}", counted at the link's real length (the server's quote
 * measures the same line, `_shared/blastFormLinks.ts`).
 */

/** A link of exactly the real length (the token and ids are placeholders). */
export const BLAST_FORM_SAMPLE_URL = `https://host.usemingla.com/form/${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}?c=${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}#t=${"0".repeat(64)}`;

/** The line a Blast with a form adds to each text, at its real length. */
export const BLAST_FORM_SMS_LINE = ` Answer: ${BLAST_FORM_SAMPLE_URL}`;

/** The host's words for a confirm the server refused over the form, or null. */
export function blastFormErrorCopy(code: string): string | null {
  if (code.includes("embedded_form_not_live")) return "This form isn't live. Publish or reopen it in Forms.";
  if (code.includes("embedded_form_other_brand")) return "That form belongs to another brand.";
  return null;
}
