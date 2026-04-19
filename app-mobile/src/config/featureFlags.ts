/**
 * Feature flags — runtime toggles for progressive rollouts and kill-switch rollback.
 *
 * RULES:
 * - Every flag has a default + exit condition documented in its comment.
 * - Flags are kept per ORCH-ID bundle; document which ORCH owns each.
 * - Production defaults err conservative (off) until telemetry confirms clean.
 * - Keep this file tiny — one module, exports only. No logic here beyond defaults.
 */

/**
 * ORCH-0490 Phase 2.2 — Progressive Delivery Contract.
 *
 * When TRUE: `deckService.fetchDeck` races singles + curated via Promise.race.
 *   Whichever resolves first with ≥1 card delivers to the UI cache via
 *   `onPartialReady`. The second arrival merges (via `mergeCardsByIdPreservingOrder`)
 *   rather than replacing. Zero-singles + non-empty-curated no longer waits on
 *   curated's 20s ceiling — curated delivers immediately.
 *
 * When FALSE: the old sequential-await path runs (await singlesSettled → fire
 *   partial if non-empty → await curatedSettled → final interleave). Identical
 *   to pre-Phase-2.2 behavior. Used as rollback kill switch.
 *
 * Default:
 *   - `__DEV__` = true — developers see the new behavior immediately.
 *   - Production = false — ship the code dark; flip via OTA config once one
 *     week of clean telemetry (no regressions in deck render, no crash spikes,
 *     no `trackDeckError` spikes) has accumulated.
 *
 * Exit condition: after one week of clean telemetry on the flipped state OR
 * explicit orchestrator decision, this constant becomes unconditional `true`
 * and the sequential-await fallback branch in `deckService.fetchDeck` is
 * deleted. See spec `outputs/SPEC_ORCH-0490_DECK_RELIABILITY_AND_PERSISTENCE.md`
 * §9 rollback strategy.
 *
 * FLIP COMPLETE — 2026-04-19 (ORCH-0525 AH-152).
 * AH-151 Release-build gate skipped per DEC-033 — Sentry + 1-line revert = rollback.
 * Kill-switch window: until 2026-05-03 (2 weeks post-flip).
 * If prod regression surfaces → revert to `__DEV__` + OTA.
 * After 2 weeks clean telemetry → ORCH-0525 Option B cleanup dispatch deletes
 * the constant + collapses the 5 [TRANSITIONAL] branches (listed in
 * Mingla_Artifacts/outputs/INVESTIGATION_ORCH-0525_FLAG_FLIP_RISK.md §5),
 * deletes legacyDeck hook, and deletes deckService.ts:556-565 sequential-
 * fallback else-branch.
 */
export const FEATURE_FLAG_PROGRESSIVE_DELIVERY: boolean = true;

/**
 * ORCH-0490 Phase 2.3 — Per-Context Deck State + Parallel Hooks + Expansion Signal.
 *
 * When TRUE: DeckStateRegistry holds per-(mode, sessionId) DeckState. Mode
 *   toggle swaps the active context pointer (no wipe). `useDeckCards` is
 *   split into two always-on hooks — solo + active collab session — so both
 *   contexts' React Query caches stay alive in parallel. SwipeableCards'
 *   first-5-IDs wipe is replaced by an expansion signal: strict-superset
 *   check OR `isDeckExpandingWithinContext` flag must allow the reset.
 *
 * When FALSE: today's single-DeckState / single-hook path runs verbatim.
 *   Kill switch for rollback. `isModeTransitioning` state still lives for
 *   the flag-off path.
 *
 * Default:
 *   - `__DEV__` = true — developers see the new architecture immediately.
 *   - Production = false — ships dark. Coupled with
 *     `FEATURE_FLAG_PROGRESSIVE_DELIVERY`: both flip together to
 *     unconditional `true` after one week of clean telemetry, then the
 *     flag-off shims + `isModeTransitioning` residuals are removed in a
 *     single cleanup commit.
 *
 * Closes: ORCH-0491 (solo↔collab switch loses position), ORCH-0498
 *   (mixed-deck progressive-delivery double-wipe), ORCH-0493 RC#1 (collab
 *   mid-swipe wipe on incoming pref change).
 *
 * Spec: `outputs/SPEC_ORCH-0490_DECK_RELIABILITY_AND_PERSISTENCE.md` §3
 *   Phase 2.3.
 *
 * FLIP COMPLETE — 2026-04-19 (ORCH-0525 AH-152).
 * AH-151 Release-build gate skipped per DEC-033 — Sentry + 1-line revert = rollback.
 * Kill-switch window: until 2026-05-03 (2 weeks post-flip).
 * If prod regression surfaces → revert to `__DEV__` + OTA.
 * After 2 weeks clean telemetry → ORCH-0525 Option B cleanup collapses flag
 * gates + deletes legacyDeck hook + deletes the 5 [TRANSITIONAL] branches
 * (listed in Mingla_Artifacts/outputs/INVESTIGATION_ORCH-0525_FLAG_FLIP_RISK.md §5).
 */
export const FEATURE_FLAG_PER_CONTEXT_DECK_STATE: boolean = true;
