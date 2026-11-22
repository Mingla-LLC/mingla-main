/**
 * #4541 R4.2 — the one reader of a Blast's embedded form id. A pure leaf
 * (imports nothing) shared by the composer (`blastFormLink.ts`) and the forms
 * owner (`blastFormUsage.ts`), so it is the only Blast-form code the eager Host
 * web `__common` chunk carries. Keep it this small: anything only one side
 * needs lives in that side's own module.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The campaign payload's embedded form id (`channel_payload.embedded_form.form_id`), or null. */
export function embeddedFormIdOf(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const ef = (payload as Record<string, unknown>).embedded_form;
  if (typeof ef !== "object" || ef === null || Array.isArray(ef)) return null;
  const id = (ef as Record<string, unknown>).form_id;
  return typeof id === "string" && UUID.test(id) ? id.toLowerCase() : null;
}
