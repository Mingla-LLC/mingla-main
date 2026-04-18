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
 */
export const FEATURE_FLAG_PROGRESSIVE_DELIVERY: boolean = __DEV__;
