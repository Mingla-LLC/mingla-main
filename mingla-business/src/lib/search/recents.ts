/**
 * #4420 — split out of ./sheetState (which re-exports it). Dependency-free on
 * purpose: the tabs shell's sheet store imports it, and anything it imports
 * would ride into the eager `__common` boot chunk.
 */

/**
 * Recents helper — MRU-ordered, deduped (case-insensitive on the trimmed
 * value), capped at `cap` (default 6). Pure (SPEC §3.4.1 pushRecent
 * semantics). Ephemeral — never persisted (R-4).
 */
export function pushRecent(
  recents: readonly string[],
  query: string,
  cap = 6,
): string[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [...recents];
  const lower = trimmed.toLowerCase();
  const deduped = recents.filter((r) => r.trim().toLowerCase() !== lower);
  return [trimmed, ...deduped].slice(0, cap);
}
