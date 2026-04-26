# Product Snapshot

> **2026-04-25 — ORCH-0669 cycle-2 CLOSED — home + chat chrome looks like glass instead of white seams.** Plain-English: the white-line edges around the home header pills, preferences chip, notification bell, bottom nav, "+" create pill, and chat input capsule were too bright (12% white alpha) — they read as visible seams against the dark frosted-glass backdrop on every render. Lowered to 6% (50% reduction). Same token, single value change, all 7 surfaces consume by reference so no per-component edits. Chat input separators (the 1px dividers between attach + text + send sections) become near-invisible at 6% — explicitly accepted per founder's Option A 2026-04-25 (the capsule still reads as clearly bounded sections via spacing and button positioning). Dead `topHighlight` token from the deleted V5 layer also removed. **What's now strong:** Home + chat chrome reads as premium glass with sub-perceptible edges; new structural invariant `I-CHROME-HAIRLINE-SUB-PERCEPTIBLE` + CI gate prevents the regression class going forward (any future contributor inlining `borderColor: 'rgba(255, 255, 255, 0.X)'` ≥ 9% on a chrome consumer file fails CI). **What's still fragile:** founder hasn't visually confirmed yet (T-04..T-09 home + T-12.1..T-12.3 chat) — non-blocking but recommended within 24h to upgrade CONDITIONAL → unconditional Grade A. If 0.06 reads as "still a seam" or "too floating", spec §14 rollback path is a single-line revert to 0.08 (no structural undo). **Launch posture:** still pre-launch. Zero new S0/S1 issues. ORCH-0669 was the last design-debt polish dispatchable without founder steering — Wave 5 remaining items (ORCH-0671 admin Photos / ORCH-0670 concerts-events / ORCH-0661 pending pills smoke) all require either founder decision or device smoke.

> **2026-04-25 — Wave 4 CLOSE Grade A: chat-domain bundle fully verified.** Plain-English: 4 user-facing fixes verified and on production for an hour. (1) Friends' incoming DMs arrive in real time again — no more silent drops requiring close+reopen. (2) Friends-modal "Add to Session" + DM "Add to Board" both invite for real — no more fake "Sent!" toasts that did nothing. (3) DM "Share Saved Card" sends a real card bubble that the recipient can tap to expand — replaced 5-month-old toast-only stub. (4) Deck cards show real distance ("0.4 mi") and travel-time ("8 min walk") with mode-matching icons — no more fake "Nearby" labels. **What's now strong:** chat domain end-to-end production-grade (DM realtime + saved card share + add-to-session + paired-profile recs from ORCH-0668 yesterday-close). 4 new structural invariants prevent the regression class for each. **What's still fragile:** founder Phase 4 device live-fire (~25 min, 2-3 devices) is the only outstanding evidence — non-blocking but recommended within 24h to upgrade CONDITIONAL → unconditional Grade A. **Launch posture:** still pre-launch. Zero S0/S1 blockers in the chat-domain bundle post-Wave-4. Wave 5 parked items (home-chrome hairline / photos admin / concerts-events / pending pills) are S2/S3 polish. Parallel chat's ORCH-0677 picnic-dates regression is the only S1 currently in flight — separate investigation.

> **2026-04-25 — ORCH-0668 CLOSED Grade A — paired-profile recommendations work again for every paired user.** Plain-English: the recommendation rows under every paired friend's profile (birthday hero, "Your Special Days" anniversaries, "Upcoming Holidays") were all silently broken — every user saw "Couldn't load recommendations" because the database query was timing out at 25 seconds. The fix rewrote that query so it now returns in ~120 milliseconds (220× faster). Tester independently verified across 5 runs at the worst-case 11-signal Raleigh workload — p95 ~135 ms vs the 2000 ms budget = 14× under. Edge function logs confirm production users are already successfully loading recommendation cards at sub-150 ms warm. **What's now strong:** paired-profile experience is production-grade end-to-end; the structural rule (`I-RPC-LANGUAGE-SQL-FOR-HOT-PATH`) that prevents this exact bug class is registered + CI-gated; CI gate negative-control proven (inject synthetic plpgsql migration → fires + names violator). **What's still fragile:** 4 chat-domain ORCHs (0664 DM realtime / 0666 add friend / 0667 share saved card / 0659-0660 deck distance) are IMPL-COMPLETE on production OTAs but await Wave 4 tester verification — all 4 tester prompts pre-written and parallelizable. **Launch posture:** still pre-launch. ORCH-0668 was the only S0 in flight; closing it leaves zero S0s in the chat-domain bundle. T-18 device smoke (~5 min founder action) is recommended but not blocking. 

> **2026-04-25 — ORCH-0672 CLOSED.** Plain-English: the dev build was bricked for ~hours today — every cold start crashed at module load because UI code was reading design tokens that never made it into the codebase. Hotfix landed in ~25 min (INTAKE → CLOSE) via single-file pathspec commit `d566dab7`. App boots again. **Strong/fragile unchanged structurally** — Home pill bar already graded A under ORCH-0589/0661; this restored that prior state, not a new gain. **One process gain:** new invariant `I-COUPLED-DIFF-NEVER-PARTIAL-COMMIT` makes the regression class that caused this S0 structurally preventable in future. **Launch posture:** still pre-launch. Build no longer bricked. 4 mobile-commit waves now queued (ORCH-0664 / 0666 / 0667 / 0659-0660) plus 1 backend-only deploy (ORCH-0668). All 5 are code-complete; founder-driven deploy + commit + OTA + tester dispatch sequence ready.

> **2026-04-23 late-night — ORCH-0641 FORMAL CLOSE.** Tester returned CONDITIONAL PASS. Evidence chain complete. The deck works again for 7 previously-dead chip types — users selecting Brunch, Drinks, Fine Dining, Casual, Icebreakers, Movies, or Play now see real cards instead of empty decks. **Nothing else strong/fragile has moved since the informal closure earlier tonight.** One clarifying note for the snapshot: curated cards are more fragile than previously thought — `filterCuratedByStopHours` in `discover-cards` was assumed dead code but is actually called on every request with a schema bug that makes it a silent no-op ("assume open" default). Curated cards can currently include stops closed at the user's scheduled hour. This was already scoped under ORCH-0644; D-1 reclassification merges ORCH-0645 into 0644 rather than dispatching separately. **Launch blockers unchanged:** none directly from this closure, but ORCH-0643 (picnic-dates empty because groceries signal never scored) is next up and cheap to ship.

> **2026-04-23 night — ORCH-0640 (Great Demolition and Rebuild) CLOSED Grade A. ORCH-0641 (filter schema fix, S0) CLOSED Grade A.** User device smoke 5/5 PASS. **What this means for the product:** the app now has ONE card-generation system instead of three parallel systems that drifted against each other. Every card the user sees — whether a single place, a curated date-night experience, or a saved card — comes from the same `place_pool` table through the same 3-gate quality filter (is_servable + signal score + real photo). This closes ~2 years of architectural debt where `saves`/`experiences` (2025-era) + `card_pool`/AI-validation (early 2026) + `place_pool` (late 2026) all coexisted. **What's now strong:** one owner per truth (Constitutional #2 fully satisfied on serving surface), 7 new invariants CI-enforced via `scripts/ci-check-invariants.sh`, 7 of 10 chips re-serving real cards after 8-day silent regression (ORCH-0641 fix), idempotent save path via verified upsert + unique index. **What's still fragile:** ORCH-0644 (curated cards don't filter by opening hours — can recommend a dinner spot that closed at 3 PM) unblocked and ready for dispatch; 11 other deferred follow-ups queued (mostly admin cleanup + docs). **Rollback safety net intact** — `_archive_card_pool` + `_archive_card_pool_stops` live until 2026-04-30 (7-day soak). **Launch blockers:** none from this closure. No migration pending. OTA already live on both platforms.

> **2026-04-22 — Build-readiness snapshot:** ORCH-0636 (TS Build Hygiene) closed Grade A code-level — `tsc --noEmit` now clean for the first time in the Seth branch. ORCH-0637 (Empty State Redesign) closed Grade A code-level pending device verification. ORCH-0598.11 (Launch-City Pipeline) closed code-level for the SINGLE-card two-gate + RLS hardening, but has a LIVE curated-card serving bug (tracked as **ORCH-0639, deferred to separate chat, Const #13 violation, P1, pool-only enforcement still holds**). **Current posture: OTA-safe to ship ORCH-0636 now. Binary build should wait for ORCH-0639 to land.** "What's strong": TS build clean, Seth-branch empty states coherent with ORCH-0626 dark canvas tokens, single-card two-gate preventing Cary/Durham leaks into Raleigh. "What's fragile": curated-card pool serving currently returns 0 in production (auto-regenerates via pool-only path, but at 1-3s latency vs <500ms cache hit) — ORCH-0639 owns the fix. See WORLD_MAP.md for full detail.

> **2026-04-21 ~23:30 UTC — ORCH-0635 (Coach Mark Refresh) CLOSED Grade A.** Device-verified PASS after iterative cutout tuning. Commit `f284215d`. Tour rewritten from 10 steps to 9 to match post-glass-refresh app layout. 3 orphaned steps (old 2, 5, 10) fixed or dropped, 1 duplicate cutout merged (old 1+3), step 6 retargeted from FilterChip to header panel with centered bubble, NEW step 3 added for Likes tab (closes core-loop save-destination gap), NEW step 9 added targeting BetaFeedbackButton. New `bubblePosition?: 'auto' | 'center'` field on CoachStep. Legacy `coach_mark_step` values normalized to TOUR_COMPLETED on first post-deploy fetch (idempotent). New `__DEV__` warning in `useCoachMark` fires within 500ms if a step's targetRef never attaches — catches future refactor orphans. 14 files, +286/-151. Pure presentation + state-machine. OTA-safe for both platforms. Non-beta feedback universalization flagged as candidate follow-up (BetaFeedbackButton gate).

> **2026-04-21 ~22:00 UTC — ORCH-0627.1 (Profile Core Glass Refresh, Phase 1) CLOSED Grade A.** Device-verified PASS. Commit `e3dfb380`. Converts the last white-on-light screen to warm-charcoal glassmorphic bento. 5 floating cards (Hero elevated + Interests + Stats + Account + Footer) on `rgba(20,17,19,1)` canvas with orange radial glow breathing 0.85↔1.0 over 8s (static with reduce-motion). New `<GlassCard>` primitive (base + elevated) handles iOS BlurView + Android API<31 fallback + Reduce Transparency fallback. New `glass.profile.*` token namespace (~260 tokens: canvas, hero gradient + glow, card base/elevated, 14 text roles, avatar + dual ring, chips intent/category, stat tiles, level ring, tier badge, settings row, sign-out, sheet, motion). Stats card restructured from flat 3+3 to level-ring hero + 2×2 bento grid. Count-up short-circuits on zero. Phase 2 (ORCH-0627.2: sheets + ViewFriendProfileScreen + PairedProfileSection) QUEUED. 9 files, +1396/-452. Pure presentation + token layer. OTA-safe both platforms. Discoveries: placesVisited/streakDays still hardcoded to 0 (ORCH-0629/0630 candidates); BetaFeedbackButton still light-themed (ORCH-0634); AccountSettings nested screens still light (ORCH-0628).

> **2026-04-21 ~21:15 UTC — ORCH-0626 CLOSED Grade A.** Empty-state text legibility restored on dark-canvas screens — a launch-quality concern (users hitting Connections with no friends, DM with no messages, or the deck in error mode previously saw effectively invisible text). Now matches the canonical post-glass-refresh contract. Strengthens the app's "Premium" feel on first-run and error paths. Does not shift any launch blockers. **Next queued: ORCH-0627 (Profile page glass refresh)** — closes the last white-on-light holdout, bringing the full mobile surface into the dark-glass design language.

> **2026-04-21 ~08:30 UTC — ORCH-0595 Slice 3 (Upscale Brunch) CLOSED Grade A.** 3 signals shipped + tuned on family/friends device (fine_dining + drinks + brunch). All calibrated via visible device feedback loop (Slice 2 did 2 cycles, Slice 3 did 3). **What's Strong:** signal-library architecture + per-slice calibration workflow is proven extensible — 3rd signal cycle took ~3 hours end-to-end including calibration. **What's Fragile:** Google types data-quality still has edge cases (Oak/Sitti mislabeled wine_bar for drinks, bar_and_grill chains surface where you don't want them for brunch). 14 signals remaining. Launch blockers: unchanged (none).

> **2026-04-21 ~07:45 UTC — ORCH-0590 Slice 2 (Drinks signal) CLOSED Grade A.** Signal-library architecture now ships TWO signals end-to-end (Fine Dining + Drinks) with generalized cohort branch + auto-listing admin + retroactive chip rename + one-shot DB UPDATE replacing irrelevant AsyncStorage migration mandate. Family/friends device serving real drinks-ranked cards (cocktail bars / wine bars / breweries above restaurant-with-bars). Fine Dining chip rename visible on user device post-OTA. **What's Strong:** unified signal model proven extensible (Slice 3 adding Romantic = one SQL INSERT + one map entry + one mobile chip edit). **What's Fragile:** Google types data-quality edge cases (Oak Steakhouse + Sitti labeled wine_bar when they're restaurants) — data-cleaning work, not scoring flaw. Launch blockers: unchanged (none). Constitutional 14/14 preserved.

> **2026-04-21 03:45 UTC — ORCH-0558 CLOSED Grade A — device verified on iOS + Android.** Collab match promotion is now production-grade reliable. 4 ORCH-IDs bundled-closed: 0558, 0532, 0556, 0557, 0534 (ORCH-0534 historical rows backfilled). Collaboration Sessions surface moves 1 A → gains 1 more A (match-promotion path now structurally proven); 0 C/D/F regressions introduced. New invariants registered: I-MATCH-PROMOTION-DETERMINISTIC, I-BOARD-SAVED-CARDS-EXPERIENCE-ID-NOT-NULL, I-CHECK-FOR-MATCH-COLUMN-ALIGNED, I-MATCH-NOTIFICATION-FAILS-OPEN, I-REALTIME-COLD-FETCH-PARITY, I-COLLAB-MATCH-OBSERVABLE. Constitutional #2 (one-owner-of-truth) + #8 (subtract-before-adding) IMPROVED. Launch blocker on collab match reliability — cleared.

> Last updated: 2026-04-18 (**ORCH-0503 v3 CLOSED A** — user device retest 6/6 PASS; mixed-deck interleave now correct; commit + two-platform OTA pending user action; Phase 2.4 dispatch next)
> Generated by: Orchestrator Post-PASS Protocol

## Operational Alert (2026-04-18 — ORCH-0503 v3 SHIPPED on device, OTA pending)

**Mixed-deck interleave bug is dead. Three fix cycles, one root cause.**

- **What changed:** Provider sync-effect's 3-way "growing cardinality" branch at `RecommendationsContext.tsx:1127-1141` collapsed into a single `const merged = deckCards` adoption line (new line 1118). The prev-preserving `[...prev, ...toAppend]` fallback was destroying React Query's authoritative interleave whenever observer batching collapsed partial-2 + queryFn-resolve into one sync-effect fire (always, under React 18).
- **Why the earlier two fixes failed:** AH-139's spec assumed 3 sync-effect fires (partial-1, partial-2, final-resolve as separate notifications). Device DIAG logs during AH-143 captured the actual 2-fire sequence. The growing branch fired on the collapsed Fire 2 with `deckCards` = interleaved 68 cards and `prev` = 50 singles from Fire 1; `[...prev, ...toAppend]` rebuilt `[50 singles + 18 curated appended]` instead of adopting `deckCards`.
- **User device retest:** 6/6 PASS. T-01 top-of-deck alternates category/curated. T-03 mid-swipe preserved (ORCH-0498 no-regression — `removedCards` is ID-keyed, position-independent). T-04/T-05 single-pill decks unchanged. T-06 3-pill mix interleaves correctly. T-13 dev-console guard silent on happy path.
- **Structural safeguards landed:** (1) 28-line protective comment at call site citing AH-143; (2) `__DEV__` runtime guard fires `console.error` if merged[0..3] ≠ deckCards[0..3]; (3) new invariant `I-PROGRESSIVE-DELIVERY-INTERLEAVE-AUTHORITATIVE` registered in `INVARIANT_REGISTRY.md`; (4) grep invariant `[...prev, ...toAppend]` → 0 live matches in file.
- **Ship posture:** mobile OTA only (no migration, no edge fn, no native). `FEATURE_FLAG_PER_CONTEXT_DECK_STATE = __DEV__` still controls the path; flag-off legacy branch byte-stable. Kill switch = flag flip + OTA.
- **Deploy:** two separate `eas update` commands per memory rule (iOS and Android are distinct invocations — `--platform ios,android` comma syntax is invalid; `--platform all` fails on web due to react-native-maps).
- **Prod users unaffected:** flag off in prod. Fix ships dark until ≥1 week clean DEV telemetry.
- **Still open in this cluster:** ORCH-0510 silent catches (S3 observability, defer to Phase 4 lock-in); ORCH-0508 no test framework in app-mobile (S2 process-debt, blocks automated regression tests for this and similar sync-effect bugs).
- **Next program action:** Phase 2.4 dispatch — user-scoped cross-mode rejected-cards service per DEC-025. Closes ORCH-0493 RC#2 and restores Constitutional #13 exclusion consistency.

## Operational Alert (2026-04-19 very late — Phase 2.3 FAILED RETEST [SUPERSEDED by 2026-04-18 ORCH-0503 v3 CLOSE])

**Phase 2.3 did NOT ship. Do not commit. Do not flip flags.**

- **What failed:** AH-139's equal-cardinality expansion branch did not resolve ORCH-0503 on device retest. User's mixed-deck symptom inverted from "only singles shown" to "only curated shown" — confirming the visible top-of-deck tracks whichever side wins Promise.race in deckService.fetchDeck, not the final interleaved order. Orchestrator hypothesis: the sync effect's `deckIdsKey` uses sorted IDs, so partial-2 and final produce identical keys → sync-effect inner block skips on final → AH-139's new branch never runs. AH-139 implementor trace + orchestrator REVIEW both missed this upstream guard. Quality gap registered.
- **Also discovered (user report):** ORCH-0504 — solo cold-launch resets deck to card 0. ORCH-0505 — collab WAITING_FOR_PARTICIPANTS lying state flashes when ≥2 participants actually exist. Both registered in MASTER_BUG_LIST.
- **Current posture:** Phase 2.3 code remains in working tree, uncommitted. Three stacked reworks (AH-136 parent + AH-138 bridge + AH-139 failed interleave) + new symptoms. Forensic investigation AH-140 dispatched to root-cause all four symptoms before ANY more code attempts.
- **Prod users unaffected:** flag off in prod. Zero user-visible regression in the shipped app.
- **Investigation scope:** four symptoms, HIGH rigor, five-layer cross-check, six-field evidence per root cause. No solutions in the report — spec cycle follows after orchestrator review.
- **ORCH-0491 status unclear** — preservation claim relied on user's earlier Test 1 PASS; given the mixed-deck regression, the cross-mode preservation path may also have issues that weren't exposed by the narrow test. Forensics will re-validate.

## Operational Alert (2026-04-19 late — Phase 2.3 CONDITIONAL PASS [SUPERSEDED])

**Solo↔Collab swipe preservation + mixed-deck double-wipe both closed on device.**

- **What changed:** New `DeckStateRegistry` (`app-mobile/src/contexts/deckStateRegistry.ts`) holds one `DeckState` per `(mode, sessionId)` context. `useDeckCards` split into three calls (legacy + flag-solo + flag-collab) — `enabled` gates select which fires. Mode toggle swaps the registry's active-context pointer; SwipeableCards' swipe state mirrors into the registry and restores from it on toggle. Strict-superset check in the expansion signal closes ORCH-0498. Rework (AH-138) wired the missing save/restore bridge + ordering race guards that the parent phase deferred.
- **User device retest:** Test 1 (Solo swipe 3 → Collab → Solo) PASS — position + removedCards preserved. Test 2 (mixed-deck pref change + swipe during partial window) PASS — swipes preserved through curated merge. No regressions observed.
- **Ship posture:** `FEATURE_FLAG_PER_CONTEXT_DECK_STATE = __DEV__` → prod ships DARK. Kill switch = flip constant + OTA. Coupled-exit with `FEATURE_FLAG_PROGRESSIVE_DELIVERY` — both flip to unconditional `true` after 1wk clean telemetry; flag-off shims removed in cleanup commit.
- **QA:** user device retest + orchestrator code-read REVIEW substituted for the full tester cycle. Device-dependent SCs not formally exercised (SC-2.3-03 two-device collab mid-swipe, SC-2.3-04 Devtools parallel-hooks check, SC-2.3-06 p50/p95 latency measurement) are covered by code-read + the Phase 2.2 CONDITIONAL PASS precedent.
- **Deploy:** no migration, no edge fn change. Mobile OTA (two separate commands — iOS + Android).
- **Next program action:** Phase 2.4 — user-scoped cross-mode rejected-cards service. Absorbs ORCH-0493 RC#2 (`sessionServedIdsRef` replace on batchSeed===0) and restores Constitutional #13 (exclusion consistency). Closes DEC-025's design direction.
- **Still carrying forward:** ORCH-0493 RC#1 **partially closed** — superset subset works; non-superset collab realtime pref change awaits Phase 2.6 per spec line 475.

## Operational Alert (2026-04-19 — Phase 2.2 CONDITIONAL PASS)

**Deck preference-change latency: structural fix complete; production ships DARK pending telemetry.**

- **What changed:** `deckService.fetchDeck` now races singles + curated via `Promise.race`. Whichever resolves first with ≥1 card paints immediately. `useDeckCards` merges (not replaces) via `mergeCardsByIdPreservingOrder`, preserving existing card positions. Zero-singles + non-empty-curated no longer waits on curated's 20s ceiling — curated delivers at its actual settle time. Fixes ORCH-0485 RC#2 (singles-first hardcoded) + RC#3 (zero-singles skip) + ORCH-0486 (mixed-deck serverPath carry-through).
- **Ship posture:** code shipped; production behavior unchanged. `FEATURE_FLAG_PROGRESSIVE_DELIVERY = __DEV__` means DEV builds get the race path, prod builds get the verbatim pre-2.2 sequential-await fallback. Flip to unconditional `true` after 1-week clean telemetry — OR leave gated and Phase 2.3 can flip it explicitly.
- **QA:** `outputs/QA_ORCH-0490_PHASE_2.2_PROGRESSIVE_DELIVERY_REPORT.md` (0 P0/P1/P2/P3, 2 P4 doc-nits). All 7 SCs + 10 regressions + 6 invariants + 4 constitutional principles PASS structurally. TS compile clean (5 pre-existing, 0 new). Device-dependent measurements (warm p50 ≤ 1000ms, visual wipe counts, cross-device cache byte-identity) deferred — tester lacks hardware; structural determinism chain fully traced.
- **Deploy:** no migration, no edge function redeploy. Mobile OTA via two separate `eas update` commands (iOS + Android) per memory feedback. Pending user commit + OTA.
- **Next program action:** Phase 2.3 — per-context deck state + ORCH-0498 (mixed-deck double-wipe closure). Phase 2.3 converts the first-5-IDs wipe from "fires on every cache write" to "fires only on true reorders, not additive merges." Prompt prep pending.
- **Still carrying forward:** Phase 2.1 OTA is still pending user action (committed as 984950fa but iOS/Android OTAs not yet published).

## Operational Alert (2026-04-18, corrected post env-clarification)

## Operational Alert (2026-04-18, corrected post env-clarification)

**Admin Place Pool page is UNBLOCKED on production. Only auto-refresh remains broken.**

- **Environment clarification:** Mingla-dev IS the production Supabase project (single-env setup, user confirmed 2026-04-18). All 4 ORCH-0480/0481 migrations are already live in prod.
- **Primary goal achieved:** The original S1 — admin Place Pool page returning 500s — is RESOLVED. The 3 RPCs that were timing out now run in 107ms / 87ms hot / ~400ms. Admin users can see the page load. **ORCH-0480 closed A.**
- **Residual:** pg_cron auto-refresh of `admin_place_pool_mv` does not work (3-cycle stuck-in-loop, DEC-023). MV data is frozen at 2026-04-17 18:45 UTC initial populate. Admin stats will drift from reality unless someone manually refreshes. No user-facing error surfaced — Constitutional #3 silent-failure partial violation.
- **Path to close ORCH-0481 (D→A):** Dispatch ORCH-0489 implementor. Single-file admin UI change adds "Refresh Stats" button calling existing `admin_refresh_place_pool_mv()` RPC. Converts silent failure into explicit user-controlled refresh. ~2-3 hrs implementor + 1 hr tester. Prompt: `prompts/IMPL_ORCH-0489_ADMIN_REFRESH_BUTTON.md`.
- **Deferred follow-ups:** ORCH-0487 (city_overview covering-index for <500ms target), ORCH-0488 (cache-sensitivity on cold MV reads), ORCH-0484 (776 empty-array orphan rows).
- **Production deploy:** Complete for ORCH-0480/0481 (they're in prod already since Mingla-dev = prod). ORCH-0489 will be the next prod deploy (admin web dashboard — no migration, no EAS OTA).

## App Readiness Summary

| Metric | Value |
|--------|-------|
| Total items tracked | 303 |
| Grade A (launch-ready) | 101 (33%) |
| Grade B (solid, minor gaps) | 26 (9%) ↑ +2 (ORCH-0469, ORCH-0472) |
| Grade C (functional, incomplete) | 4 (1%) |
| Grade D (fragile) | 4 (1%) |
| Grade F (broken/unaudited) | 169 (56%) ↓ -2 |
| Deferred | 1 (<1%) |
| Deck hardening passes complete | 12 (46 bugs fixed) |
| Place-pipeline passes complete | 1 (8 bugs fixed in single ORCH-0460 bundle) |

## Can a User Complete the Core Loop?

| Step | Status | Confidence |
|------|--------|------------|
| Install + Auth | PARTIAL — Phone OTP (B), Google (C), Apple (B), Sign-out (A) | Medium |
| Onboarding | PARTIAL — preference save + skip work (A), but state machine + GPS + resume all F | Low |
| Explore (deck swipe) | STRONG — 37 items at A, 7 at B, deck contract deterministic, cross-page dedup fixed, place→card sync live | High |
| Save experience | UNVERIFIED — save/unsave at F | Low |
| Schedule | PARTIAL — scheduling bugs exist (picker behind modal, no confirmation) | Medium |
| Invite friends | UNVERIFIED — friend request send at B, but collaboration invites at F | Low |
| Collaborate | PARTIAL — UI consolidated (A), but creation/voting/sync all F | Low |
| Go (use experience) | UNVERIFIED — post-experience + review all F | Low |

**Verdict: Core loop is NOT completable end-to-end.** The card deck (middle of funnel) is excellent, but entry (auth/onboarding) and exit (save/schedule/review) are unverified.

## Top 5 Launch Blockers

1. **Avatar impersonation (ORCH-0250)** — Avatars bucket has no user-scoping RLS. Any user can overwrite another's avatar. S1.
2. **Onboarding state machine at F (ORCH-0008)** — Users may get stuck. Completion rate unknown. S0.
3. **Account deletion at F (ORCH-0102)** — Apple/Google require it. App Store rejection if missing. S0.
4. **Save/unsave at F (ORCH-0094)** — Core loop requires saving. Cannot verify user value delivery. S1.
5. **Chat entirely unaudited (ORCH-0127)** — Social feature with zero verification. DM broken = hollow connections. S1.

### Recently Resolved Blockers
- **Place Pipeline Accuracy Overhaul (ORCH-0460 bundle — 8 items)** — CLOSED 2026-04-17. 5 categories were leaking wrong places into users' feeds (restaurants in Creative & Arts, bars in Movies & Theatre, bars/play/tobacco in Brunch Lunch Casual, sports parks/farms/kids centers in Play, garden stores in Flowers). Root cause: every filter in the pipeline only checked `primary_type` — the real identity was often in the `types` array. Fix: expanded all filters to check the full types array, split casual_eats into 3 configs (50-type Google limit), added 58 new world cuisine types to seeding (Cuban, Filipino, Persian, dim sum, soul food, etc.), split FLOWERS_BLOCKED_TYPES into primary/secondary sets (after retest P0 caught a 168-supermarket false-positive regression on `food_store`), created UPSCALE_CHAIN_PROTECTION whitelist. Removed upscale↔casual mutual exclusivity (Nobu-style restaurants now get both). Closed ORCH-0460/0461/0462/0463/0464/0465/0471/0477. QA retest 11/11 SC PASS. Live SQL confirms 139 canonical supermarkets preserved.
- **Photo Backfill Job System (ORCH-0274)** — CLOSED. Broken global photo download replaced with city-scoped batch system. 2 tables, 9 actions, auto-advance, persistent progress, job status bar. Phase 1 (backend) + Phase 2 (UI). 23/23 tests PASS.
- **place_pool → card_pool Sync (ORCH-0273)** — CLOSED. 13+ fields drifted silently between master record and served cards. Unified trigger now syncs 16 fields for single cards + curated composites. Old website trigger replaced. 10/10 tests PASS.
- **Cross-Page Dedup (ORCH-0272)** — CLOSED. Impression recording broken since Mar 29 due to partial index mismatch. Fixed ON CONFLICT predicate, added error throw + degraded mode, client circuit breaker. Infinite scroll restored. 7/7 tests PASS.
- **Deterministic Deck Contract (5 fixes)** — ORCH-0266 (double pagination), ORCH-0267 (travel time), ORCH-0038 (custom location GPS), ORCH-0268 (NULL price tier), ORCH-0048 (category interleave). All CLOSED at A. Solo mode (ORCH-0065) upgraded F→B, collab parity (ORCH-0066) upgraded C→B.
- **ORCH-0258 (admin_users privilege escalation)** — CLOSED. All permissive policies dropped, is_admin_user() gating. QA passed.
- **ORCH-0252 (get_admin_emails exposed to anon)** — CLOSED. Revoked anon access, replaced with is_admin_email() boolean. Fixed with ORCH-0258.
- **ORCH-0224 (Admin auth 3-layer)** — Upgraded B to A. Admin email exposure fixed as part of ORCH-0258.
- **ORCH-0253 (PII exposure via USING(true) on profiles)** — CLOSED. RLS policy tightened. QA passed.

## Top 5 Quality Risks

1. **60% of items at F** — Unknown bug count in production code
2. **Map surface entirely unaudited (16 items at F)** — Large feature with zero verification
3. **Chat entirely unaudited (8 items at F)** — Social feature with zero verification
4. **Calendar entirely unaudited (8 items at F)** — Scheduling is core loop step
5. **10 unverified invariants** — Structural guarantees without proof

## What's Strong (Grade A/B Surfaces)

- **Place Pipeline Accuracy (NEW 2026-04-17)** — 8 A-grade closures. Types-array filtering across 5 categories, 58 new cuisine types seedable, upscale chain whitelist, flowers primary/secondary split preserves canonical supermarkets. Constitutional invariant #13 restored to PASS. Pool: 41,727 approved places; 1,354 (~3.2%) will be correctly re-categorized post-deploy.
- **Card deck pipeline** — 35 items at A, 7 at B. Pool-first architecture, exclusions, balancing, photo integrity. Hardened across 10 passes.
- **Deck Contract** — All 200 pool cards reachable, travel time hard-filtered, categories interleaved, custom location deterministic, NULL price tiers excluded. Solo and collab modes verified.
- **Notification infrastructure** — 6 items at A. Push delivery, realtime subscriptions, app badge.
- **Hardening utilities** — withTimeout, mutation error toast, query key factory. All A.
- **Chat responsiveness** — 4 items at A. Instant open, background fetch, block timeouts.
- **Preferences-to-deck contract** — Race condition killed, prefsHash matching, atomic save.
- **Auth & Session** — 2A/4B/1C. Sign-out hardened. OAuth flows verified.
- **Admin Security** — Admin auth upgraded to A. Privilege escalation fixed, admin email exposure closed, is_admin_user() gating enforced.
- **Payments & Subscriptions** — 8A/6B/1C. Paywalls, RevenueCat, tier gating, swipe limits, referral expiry, trial abuse prevention all verified.
- **State Persistence** — Instant tab switching (always-mounted tabs), PreferencesSheet opens from cache, all tabs always live on foreground resume. 4 items closed at A.

## What's Fragile (Grade D/F Surfaces)

- **Map & Location** — 16 items, 100% at F. Entire feature unaudited.
- **Chat / DM** — 8 items, 100% at F. No verification of send/receive, presence, realtime.
- **Calendar & Scheduling** — 8 items, 100% at F. Core loop step, unverified.
- **People Discovery** — 10 items, 100% at F.
- **Sharing & Invites** — 10 items, 100% at F.
- **Post-Experience** — 9 items, 100% at F.
- **Booking** — 2 items, 100% at F.

## Engineering Velocity

- **10 deck hardening passes** completed (2026-03-20 to 2026-03-24), 44 bugs fixed
- **5 card pipeline audit passes** completed (2026-03-24 to 2026-03-25)
- **2 notification passes** completed (2026-03-21 to 2026-03-23)
- **9 cross-cutting passes** completed (2026-03-23)
- Last commit with hardening work: 2026-03-26 (AI Quality Gate Phase 2)
- Wave 1b payment fixes: 7 bugs closed 2026-03-31 (ORCH-0143/0144/0145/0146/0147/0148/0149)
