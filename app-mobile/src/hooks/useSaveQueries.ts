/**
 * ORCH-0640 ch09 — Legacy save hooks retired (DEC-050).
 *
 * The original useSaveQueries hooks wrapped `savesService` (DELETED), which read/wrote
 * the `saves` + `experiences` tables (both DROPPED in ch12). Those tables no longer
 * exist.
 *
 * Replacement: use `savedCardsService` + `useSavedCards` (saved_card snapshot table).
 * Existing callers that import from this file:
 *   - `RealtimeSubscriptions.tsx` — uses useSavesRealtimeSync. Replaced with no-op.
 *
 * No other exports are needed. The file is kept (instead of deleted) only so that
 * `RealtimeSubscriptions.tsx` still compiles without an OTA gap during cutover.
 * Delete this file once RealtimeSubscriptions is amended to remove the import.
 */

// No-op: subscribes to nothing. `saved_card` table changes are watched via
// `useSavedCards`' own React Query cache invalidation — no separate Realtime needed.
export function useSavesRealtimeSync(): void {
  // Intentionally empty.
}

// Type re-export is dropped — SavedExperience was tied to the deleted saves table.
// If any consumer still needs it, they should use SavedCardModel from savedCardsService.
