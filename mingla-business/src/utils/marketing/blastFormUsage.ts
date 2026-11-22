/**
 * #4541 design v10 G "2b" — forms-owner side of a Blast's "+ Form". Reached
 * only through `useBrandForms` inside the forms owner chunk; the composer's
 * text and error copy stay in `blastFormLink.ts` so neither module is shared
 * by two async chunks (which would hoist it into the eager `__common` chunk).
 */
import { embeddedFormIdOf } from "./blastFormPayload";

/** How many scheduled campaigns carry this form. Pure; the forms screens warn with it before a host closes the form. */
export function countScheduledBlastsUsingForm(
  rows: readonly { status: string; channel_payload: unknown }[],
  formId: string | null,
): number {
  if (formId === null) return 0;
  const id = formId.toLowerCase();
  return rows.filter((r) => r.status === "scheduled" && embeddedFormIdOf(r.channel_payload) === id).length;
}
