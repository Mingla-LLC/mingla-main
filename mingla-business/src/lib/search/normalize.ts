/**
 * Global search — text normalization.
 *
 * META-ORCH-1073 Sub-A. SPEC §3.2 (matching algorithm — normalization):
 * lowercase + diacritic-strip via NFD + combining-mark removal. Applied to
 * BOTH the query and every searchable field. Pure, no I/O.
 */

/**
 * Lowercase + strip diacritics + collapse whitespace. Deterministic.
 *
 *   "Café"  → "cafe"
 *   "EVENT" → "event"
 *   "  Pôp   Up " → "pop up"
 */
export function normalizeSearchText(input: string): string {
  return input
    .normalize("NFD")
    // Remove Unicode combining marks (U+0300–U+036F).
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
