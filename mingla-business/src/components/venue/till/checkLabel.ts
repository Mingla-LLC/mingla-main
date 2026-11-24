/**
 * #4490 08-O5 fix 5 — one name for a check, everywhere it is listed.
 *
 * A check with no name and no table used to read "New check" in the Till's
 * Paid today list and "Team member" in the day close's open checks, so the
 * same check had two names and neither told it apart. Every list now uses
 * this: the name staff gave it, else its table, else "Check #<ref>", the
 * first four characters of the check's id (the same on every screen and
 * device, so the day close and the Till name the same check the same way).
 *
 * Tiny and dependency-free: the day close imports it without pulling the
 * Till into its chunk.
 */

export const CHECK_LABEL_COPY = {
  check: "Check",
  checkRef: (ref: string): string => `Check #${ref}`,
} as const;

/** The short reference of a check id ("Check #9F3A"): 4 hex characters, upper case. */
export function checkRef(id: string): string {
  return id.replace(/[^0-9a-f]/gi, "").slice(0, 4).toUpperCase();
}

export function checkTitle(check: { id: string; label?: string | null; spotLabel?: string | null }): string {
  const named = [check.label, check.spotLabel].find((s): s is string => typeof s === "string" && s.trim().length > 0);
  if (named !== undefined) return named;
  const ref = checkRef(check.id);
  return ref.length > 0 ? CHECK_LABEL_COPY.checkRef(ref) : CHECK_LABEL_COPY.check;
}
