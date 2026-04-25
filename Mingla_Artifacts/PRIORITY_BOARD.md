# Priority Board

> **2026-04-25 — Active wave plan (post-ORCH-0668 CLOSE):** **Waves 1-3 ✅ DONE** (ORCH-0672 hotfix; Wave 2 backend deploys; Wave 3 chat-domain bundle 1db3d80e + ORCH-0666 cycle-2 85dd4462 + Wave 3d 0659/0660 be442c29). **Wave 4 testers — IN PROGRESS:** ORCH-0668 ✅ CONDITIONAL PASS accepted + CLOSED Grade A (this entry). **Wave 4 remaining (4 parallel testers, all PRE-WRITTEN at `prompts/TESTER_*`, parallelizable):** ORCH-0664 (DM realtime — 2-device live-fire), ORCH-0666 (add friend to session — 10-test matrix incl. cycle-2 DM-button verification), ORCH-0667 (share saved card — 9 mandatory smoke + 3 negative-controls + 20-test matrix), ORCH-0659/0660 (deck distance/travel-time — live-fire LF-1..LF-4 + device smoke DS-1..DS-5). **Wave 5 parked / awaiting decision:** ORCH-0669 cycle-2 (now reactivatable since 0672 lands; refresh §13 gate 2 wording first), ORCH-0671 (orchestrator REVIEW spec → write IMPL prompt), ORCH-0670 (founder steering on Option A/B/C for concerts/events scope), ORCH-0661 (founder 3-check smoke → CLOSE if PASS). **Founder follow-up on ORCH-0668:** T-18 6-step device matrix (~5 min, low-risk since prod logs already show paired-profile recs loading successfully). NOT a blocker. **Recommended next single action:** dispatch any of the 4 remaining Wave 4 testers; ORCH-0667 + ORCH-0659/0660 have the most automated coverage and parallel best.

> **2026-04-25 — Active wave plan (post-ORCH-0672 CLOSE):** **Wave 1 ✅ DONE** (ORCH-0672 hotfix unbricked dev build, commit `d566dab7`, founder boot smoke PASS). **Wave 2 NEXT (founder ops, ~10 min):** push Seth + 2 OTAs for ORCH-0672 → `supabase db push` (applies migrations 0666/0667/0668) → `supabase functions deploy notify-message get-person-hero-cards discover-cards generate-curated-experiences --project-ref gqnoajqerqhnvulmnyvv` → run pre-tester probes (ORCH-0667 T-01/02/03 SQL probes; ORCH-0666 spec §3.1 probes 1-4; ORCH-0668 5-run perf gate at 11-signal Raleigh expecting ≤2 s p95). **Wave 3 (surgical mobile commits, one ORCH per commit, `git add -p` because ConnectionsPage/MessageInterface/locale chats have multi-ORCH hunks):** order = (3a) ORCH-0664 DM realtime dedup [smallest, least entangled — re-apply 6 edits per spec, 5-file commit, OTA both]; (3b) ORCH-0666 add friend to existing session [allowlist from impl report §I, commit, OTA]; (3c) ORCH-0667 share saved card [allowlist from impl report §I — index already pre-staged with 67 ORCH-0667 files from prior chat, commit, OTA]; (3d) ORCH-0659/0660 deck distance/travel-time rework v2 [16-file allowlist, commit, OTA]. After each Wave 3 commit: `bash scripts/ci-check-invariants.sh && cd app-mobile && npx tsc --noEmit` must exit 0 before OTA. **Wave 4 (parallel tester dispatches, all PRE-WRITTEN at `prompts/TESTER_*`):** ORCH-0666 / ORCH-0667 / ORCH-0668 / ORCH-0659/0660. **Wave 5 (parked / awaiting decision):** ORCH-0669 cycle-2 (now reactivatable, refresh §13 gate 2 wording first), ORCH-0671 (orchestrator REVIEW spec → write IMPL prompt), ORCH-0670 (founder steering on Option A/B/C), ORCH-0661 (founder 3-check smoke → CLOSE if PASS). **Risk callout:** Wave 3c (ORCH-0667 mobile commit) MUST land AFTER Wave 2 `supabase db push` applies the `0667_add_card_message_type` migration — otherwise every send violates `messages_message_type_check` CHECK constraint and DM is broken in prod. Discipline holds: backend before mobile.

> **✅ 2026-04-24 — ORCH-0646 CLOSED GRADE A.** Admin Place Pool + Signal Library both serving cleanly in prod. 6 DB RPCs rewritten + 28 JSX sites + CI gate extension + new I-COLUMN-DROP-CLEANUP-EXHAUSTIVE invariant (proven active by catching cycle-2 first rework attempt in real time). Commit `322b7337` on origin/Seth. Retest cycles: 2 of 2 within threshold. 2 P4 praises. Deferred: D-1/D-2 (P3 follow-ups); ORCH-0647 (PhotoPoolManagementPage audit, separate dispatch). **Next queue head:** ORCH-0649 (expanded card quartet — implementor APPROVED, tester dispatch ready at `prompts/TESTER_ORCH-0649_EXPANDED_CARD_QUARTET.md`).

> **🟠 2026-04-23 late-night — ORCH-0643 BLOCKED (user-action required).** AH-172 Implementor stopped at right boundary. Registration needs SQL editor work + weight design (product judgment). Recommended: user copies `flowers` row live, adapts for groceries, applies, clicks Run Scorer in admin. ~10-15 min. 3 discoveries filed (ORCH-0650/0651/0652). **Priority Board shuffle:** recovery bundle AH-170 now reads 1 CLOSED (0641) / 1 BLOCKED-pending-user (0643) / 2 PENDING (0644, 0642). **Two NEW items entered today outside the bundle:** ORCH-0646 (admin Place Pool + Signal Library both 500 on city load — S1 regression from ORCH-0640 column drop) and ORCH-0649 (expanded card quartet — 4 bugs on Likes expanded card, S1 user-visible, founder-reported). Both are S1-high and user-visible/admin-breaking; recommend prioritizing 0646 over 0643-finish if user can't do the SQL editor step today. **Next-dispatch recommendation:** ask user to do the ORCH-0643 SQL editor step now (10 min, no dispatch needed), or pivot to ORCH-0644 (curated hours filter, 30 min code) which IS dispatchable.

> **✅ 2026-04-23 late-night — ORCH-0641 FORMALLY CLOSED (AH-175 Tester CONDITIONAL PASS, Grade A).** Evidence chain complete: commit `5e2b821f` deployed, 7/8 SCs verified, R-2 cross-function audit clean, constitutional scan clean, user live-fire confirmed. QA: `outputs/QA_ORCH-0641_FILTER_SCHEMA_FIX_REPORT.md`. **D-1 reclassification:** ORCH-0645 (filterCuratedByStopHours) was mislabeled "dead code" — it's LIVE at `discover-cards:940` with inverse-failure schema mismatch. Merged into ORCH-0644 scope (no separate dispatch). **Recovery bundle AH-170 status: 1 of 4 CLOSED.** Recommended next dispatch: **ORCH-0643 (groceries scorer)** — 5 min admin action, unblocks picnic-dates entirely. IMPL prompt ready at `prompts/IMPL_ORCH-0643_GROCERIES_SCORER_FIX.md`. Alternative order: 0644 first if user prefers the curated hours bug fixed before picnic; either works, no blocking dependency.

> **✅ 2026-04-23 night — ORCH-0640 + ORCH-0641 BOTH CLOSED Grade A.** ORCH-0640 (Great Demolition and Rebuild) device-smoke 5/5 PASS on user's phone. 14 migrations live, 5 edge fns deployed, 7 edge fns + 2 admin pages + 4 mobile files deleted, 7 new invariants registered, CI gate live. 11 follow-ups queued for later dispatch. ORCH-0641 (filterByDateTime schema fix, S0) shipped out-of-band during auto-mode session — `discover-cards` deployed to prod, 3 helpers now read `oh.periods` canonically. Both removed from Top 20 below. **Next queue head recommendation:** ORCH-0644 (curated hours filter — now unblocked by ORCH-0641, silent UX bug where curated can recommend closed restaurants). Spec exists at `outputs/SPEC_ORCH-0644_CURATED_HOURS_FILTER.md`, ready to dispatch.

> **🔴 2026-04-23 — SERVING RECOVERY BUNDLE READY (AH-170).** 4 APPROVED specs cover the full recovery: ORCH-0641 (filter schema fix, S0, 15 min code), ORCH-0643 (groceries scorer, S1, 5 min admin), ORCH-0644 (curated hours filter, S1, 30 min code — NEW bug found during hunts, was hardcoding `isOpenNow: true`), ORCH-0642 (9-city Bouncer sweep, S1, 90 min admin). Dispatch order: 0641 → 0643 (concurrent) → 0644 → 0642. Total recovery effort ~3 hours. After completion: every chip returns cards, curated stops respect opening hours, picnic works, 9 new cities launch-ready. Specs: `outputs/SPEC_ORCH-0641_FILTER_SCHEMA_FIX.md`, `outputs/SPEC_ORCH-0643_GROCERIES_SCORER_FIX.md`, `outputs/SPEC_ORCH-0644_CURATED_HOURS_FILTER.md`, `outputs/SPEC_ORCH-0642_CROSS_CITY_BOUNCER_SWEEP.md`. Umbrella: `outputs/INVESTIGATION_SERVING_RECOVERY_ADJACENT_HUNTS.md`. Also registered: ORCH-0645 (dead code auto-resolves via 0644), ORCH-0646 (dead secondary_opening_hours column), ORCH-0648 (admin health dashboards — future).

> **🔴 2026-04-23 — ORCH-0641 PRODUCTION INCIDENT: SINGLES DECK IS 70% BROKEN FOR EVERY USER.** Forensics v3 (AH-168) traced the user's "only 3 chip types visible" symptom to a silent schema-vs-code mismatch in `discover-cards:305-316`. The `hasOpeningData` filter checks `opening_hours._periods` (underscore) + lowercase day keys. The database actually stores `opening_hours.periods` (no underscore) + Google v1 API keys (`openNow, periods, weekdayDescriptions, nextOpenTime`). Filter returns false → card excluded unless primary_type ∈ 17 ALWAYS_OPEN_TYPES whitelist. **Per-chip survival at Raleigh: brunch 376→0, casual_food 627→0, drinks 185→0, fine_dining 111→0, movies 13→0, play 20→0, icebreakers 392→5; nature 77→74 (parks whitelisted), creative_arts 26→2, theatre 15→2.** Introduced 2026-04-15 in commit `26a9eaf2` (ORCH-0434 Phase 3A "rewrite filterByDateTime"), masked for 8 days by the always-open-types escape hatch. Fix: 1-2 line change. No migration. v2 forensics pass was wrong ("user just has 3 chips selected") — user pushed back correctly, v3 found the real bug. Also uncovered 9-city Bouncer gap (ORCH-0642) + groceries signal unscored (ORCH-0643). Reports: `outputs/INVESTIGATION_SERVING_COVERAGE_MATRIX_V3.md`.

> **✅ 2026-04-23 — ORCH-0634 + D-008 CLOSED Grade A. Curated is back online (v135 200s).** Full arc: (1) ORCH-0634 main signal-only serving + multi-chip fan-out + round-robin interleave + card_pool elimination from serving paths shipped and singles verified. (2) Tester caught P0 module-load regression on curated side — forensics traced to typo `'wholesale_store'` at `seedingCategories.ts:157` from commit `4574b5a7` (ORCH-0631 bundle), inherited by ORCH-0634 via git ancestry not introduced. (3) AH-165 surgical fix: 1-char typo correction + [CRITICAL] comment above validator. (4) Curated v134→v135 + admin-seed-places v94→v95 deployed. (5) 8/9 SCs PASS + 1 UNVERIFIED (local deno CLI — functional proxy via SC-3 satisfies). Live proofs: warmPing HTTP 200, real curated adventurous request returned 4 full cards (Page-Walker Arts → Pro's Epicurean, Cary Theater → Hank's, etc.) with stops/photos/prices/distances, teaser cache populated 4 rows (fire-and-forget upsert working). Reports: `outputs/IMPLEMENTATION_ORCH-0634_SIGNAL_ONLY_SERVING_AND_INTERLEAVE_REPORT.md`, `outputs/INVESTIGATION_ORCH-0634_D008_CURATED_MODULE_LOAD.md`, `outputs/SPEC_ORCH-0634_D008_CURATED_MODULE_LOAD_FIX.md`, `outputs/IMPLEMENTATION_ORCH-0634_D008_CURATED_MODULE_LOAD_FIX_REPORT.md`.

> **🔴 ~~2026-04-22 22:00 UTC — PRODUCTION INCIDENT: Curated cards DOWN.~~ RESOLVED 2026-04-23 — see entry above.** ORCH-0634 tester retest returned FAIL. `generate-curated-experiences` edge function v134 (and v133 before it) is returning HTTP 500 WORKER_ERROR on every POST — every curated card request fails at Deno module-load, before the handler runs. Singles path is healthy (discover-cards v132 clean, G3 photo gate closes 9 leaks, flowers surfaces only real bouquets). **Impact:** users picking any curated intent pill (Romantic, Group Fun, Picnic, flowers+brunch, etc.) see no curated cards. Condition pre-existed ORCH-0634 (earliest observed failure ~16:18 UTC today) — our ORCH-0634 commit did not fix it and may have layered additional module-load failure on top. **Registered:** ORCH-0634.D-008 (P0), D-009/D-010 (process), D-011 (attribution) + D-012 (admin-seed-places collateral S2) + D-013 (missing test S2). **Forensics AH-164 COMPLETE (2026-04-23) — APPROVED HIGH.** Root cause PROVEN with six-field evidence: typo `'wholesale_store'` at `seedingCategories.ts:157` (Google canonical is `'wholesaler'`). Top-level validator at line 647 throws at module load, crashes every edge fn importing from this file. Commit `4574b5a7` (ORCH-0631) introduced it; ORCH-0634 inherited via ancestry. **AH-165 Implementor dispatch READY** at `prompts/IMPLEMENT_ORCH-0634_D008_CURATED_MODULE_LOAD_FIX.md` — 1-char typo fix + create missing `seedingCategories.test.ts` + [CRITICAL] comment + redeploy curated + admin-seed-places. 9 live-fire SCs. Investigation at `outputs/INVESTIGATION_ORCH-0634_D008_CURATED_MODULE_LOAD.md`, spec at `outputs/SPEC_ORCH-0634_D008_CURATED_MODULE_LOAD_FIX.md`. AH-166 Tester conditional (may skip if Implementor delivers all 9 SCs with Dashboard stderr confirmation). User heads-up: curated has been broken for hours; rollback won't help (v133 was also broken); fix-forward is the only path.

> **2026-04-22 — ORCH-0636 (TS Build Hygiene) CLOSED Grade A code-level.** Removed from active board. ORCH-0637 (Empty State Redesign) + ORCH-0598.11 (Launch-City Pipeline) also closed code-level — both pending device verification before binary ship. **Current top priority:** ORCH-0639 (curated two-gate / Const #13 violation — deferred to separate chat; fixes must be a new superseding `CREATE OR REPLACE` migration since ORCH-0598.11 is already live). Binary build gated on ORCH-0639 completion. OTA ship of ORCH-0636 safe immediately (pure JS, no migration, no native). See WORLD_MAP.md for ORCH-0636/0637/0639 detail.

> **2026-04-21 ~23:30 UTC — ORCH-0635 (Coach Mark Refresh) CLOSED Grade A.** Device-verified PASS after iterative cutout tuning. Commit `f284215d`. Tour rewritten from 10 steps to 9 to match post-glass-refresh app layout. 3 orphaned steps (old 2, 5, 10) fixed or dropped, 1 duplicate cutout merged (old 1+3), step 6 retargeted from FilterChip to header panel with centered bubble, NEW step 3 added for Likes tab (closes core-loop save-destination gap), NEW step 9 added targeting BetaFeedbackButton. New `bubblePosition?: 'auto' | 'center'` field on CoachStep. Legacy `coach_mark_step` values normalized to TOUR_COMPLETED on first post-deploy fetch (idempotent). New `__DEV__` warning in `useCoachMark` fires within 500ms if a step's targetRef never attaches — catches future refactor orphans. 14 files, +286/-151. Pure presentation + state-machine. OTA-safe for both platforms. Non-beta feedback universalization flagged as candidate follow-up (BetaFeedbackButton gate).

> **2026-04-21 ~22:00 UTC — ORCH-0627.1 (Profile Core Glass Refresh, Phase 1) CLOSED Grade A.** Device-verified PASS. Commit `e3dfb380`. Converts the last white-on-light screen to warm-charcoal glassmorphic bento. 5 floating cards (Hero elevated + Interests + Stats + Account + Footer) on `rgba(20,17,19,1)` canvas with orange radial glow breathing 0.85↔1.0 over 8s (static with reduce-motion). New `<GlassCard>` primitive (base + elevated) handles iOS BlurView + Android API<31 fallback + Reduce Transparency fallback. New `glass.profile.*` token namespace (~260 tokens: canvas, hero gradient + glow, card base/elevated, 14 text roles, avatar + dual ring, chips intent/category, stat tiles, level ring, tier badge, settings row, sign-out, sheet, motion). Stats card restructured from flat 3+3 to level-ring hero + 2×2 bento grid. Count-up short-circuits on zero. Phase 2 (ORCH-0627.2: sheets + ViewFriendProfileScreen + PairedProfileSection) QUEUED. 9 files, +1396/-452. Pure presentation + token layer. OTA-safe both platforms. Discoveries: placesVisited/streakDays still hardcoded to 0 (ORCH-0629/0630 candidates); BetaFeedbackButton still light-themed (ORCH-0634); AccountSettings nested screens still light (ORCH-0628).

> **2026-04-21 ~21:15 UTC — ORCH-0626 (Empty-state text legibility on dark glass canvas) CLOSED Grade A.** Device-verified PASS. Commit `590972d4`. 6 files, 12 color-value swaps across ConnectionsPage + MessageInterface + FriendsManagementList + RequestsView + BlockedUsersView + SwipeableCards. Pure presentation, OTA-safe both platforms. Closure is a design-debt carve-out from the glass refresh series (ORCH-0566/0589/0590/0600/0610). **Next dispatch queued: ORCH-0627 (Profile page glass refresh — warm-dark charcoal canvas with bento cards).** Designer prompt written and awaiting dispatch. ORCH-0626 was never in the Top 20 (S3-cosmetic), so no re-rank needed.

> **2026-04-21 ~08:30 UTC — ORCH-0595 Slice 3 (Brunch) CLOSED Grade A.** Third signal shipped + calibrated via 3 device-visible cycles. 3 of 17 signals done (18%). Remaining 14 signals will average ~1-2h each per slice (infra fully proven). **Next priority recommended: Slice 4 (casual_food)** to unlock the TRANSITIONAL union for "Brunch, Lunch & Casual" chip, OR user may pivot to a different priority. Alternative: catch up on parallel ORCH-0589/0590 Glass-Discover track (unchanged in-flight). No launch blockers.

> **2026-04-21 ~07:45 UTC — ORCH-0590 Slice 2 (Drinks) CLOSED Grade A.** Second signal vertical shipped, live at 100% cohort on family/friends device, 4 calibration cycles landed v1.0.0→v1.4.0. Retroactively closes sub-items ORCH-0590.1-0590.8. 3 new P3/P4 items registered (0590.9 data-quality, 0590.10 Mediterranean penalty gap, 0590.11 admin RPC testability), none blocking. **Next priority recommended: Slice 3 (Romantic signal, first quality-grounded vibe)** — ORCH-0595 to avoid ID collision with Discover modernization 0590. Scope estimated ≤ half of Slice 2 since infra is proven (one seed migration + one CATEGORY_TO_SIGNAL map entry + optional new chip). Alternatively: user may pause signal-library track and return to Glass/Discover track (ORCH-0589 v5/v6 + ORCH-0590 Phase 1 cleanup both pending). Parallel tracks both healthy; user to sequence.

> **2026-04-21 03:45 UTC — ORCH-0558 CLOSED Grade A** (device-verified iOS + Android). Retroactively closes ORCH-0532, ORCH-0556, ORCH-0557, ORCH-0534. Collab match promotion launch-blocker cleared. Remaining backlog unchanged below — user to decide next priority from Top 20. 2 new P3 items registered (non-blocking): ORCH-0564 (dblink + stress harness) and ORCH-0565 (unrelated admin delete-user column bug).

> Last updated: 2026-04-19 (**ORCH-0490 Phase 2.5 verified NARROW** per AH-148 — 3 real pending items [3+6+7] via narrow spec dispatch AH-149; **ORCH-0525 registered S1** — `FEATURE_FLAG_PER_CONTEXT_DECK_STATE = __DEV__` means AH-138 per-context registry fix not active in production; user to decide sequencing: AH-149 narrow spec first OR ORCH-0525 flag flip first OR both in parallel since they are independent)
> Generated by: Orchestrator strategic-review mode

## Scoring Factors

| Factor | Weight | Description |
|--------|--------|-------------|
| User Pain | 25% | How many users hit this, how bad is it |
| Launch Risk | 20% | Does this block shipping |
| Flow Criticality | 15% | Is this on the core loop |
| Blast Radius | 15% | How many other things does this affect |
| Architecture Risk | 10% | Does this violate invariants |
| Regression Likelihood | 10% | Will this come back if patched poorly |
| Evidence Quality | 5% | Do we understand this well enough to fix |

## Top 20

| Rank | ID | Title | Score | Surface | Severity | Action | Rationale |
|------|----|-------|-------|---------|----------|--------|-----------|
<!-- Rank 0 ORCH-0634.D-008 CLOSED 2026-04-23. See banner above. -->
<!-- ORCH-0641 CLOSED Grade A 2026-04-23 night. See banner above. -->
<!-- ORCH-0640 CLOSED Grade A 2026-04-23 night. See banner above. -->
| 0 | **ORCH-0644** | **🟡 Curated cards ignore opening hours — can recommend closed restaurants** | **85** | **Curated Serving** | **S1 silent UX bug** | **SPEC APPROVED → IMPLEMENT (~30 min)** | **ORCH-0641 now shipped → unblocked. Extract filter to `_shared/curatedHoursFilter.ts` with ORCH-0641-fixed schema access. Replace hardcoded `isOpenNow: true` at generate-curated-experiences:641 with computed value.** |
| 0b | ORCH-0643 | groceries signal unscored — picnic silently produces 0 cards | 85 | Curated Serving | S1 | **Admin action (run scorer)** | 2,228 grocery places in pool, zero scored. 10-min fix from admin dashboard. |
| 0c | ORCH-0642 | 9 cities with 0 servable — Bouncer never ran | 75 | Launch Expansion | S1 | **Admin action (per-city Bouncer)** | Non-launch cities broken. No user impact today; blocks geo expansion. |
| 1 | ORCH-0336 | App stuck loading after long iOS background | 95 | App Lifecycle | S0 | **Investigate** | Every user who backgrounds for 1h+ hits this. Race condition between focusManager refetches and auth refresh. Production-reported. |
| 1b | ORCH-0525 | Prod flag flip: `FEATURE_FLAG_PER_CONTEXT_DECK_STATE` | 82 | Deck state | S1 | **Investigate (risk + rollout)** | AH-138 per-context registry fix is gated on `__DEV__` → prod users still hit ORCH-0491 (Solo↔Collab state loss) and ORCH-0498 (mixed-deck double-wipe). Dev-tested as PASS; prod still broken. Flag flip risk analysis + cutover plan needed. Parallel-safe with AH-149. |
| 1c | ORCH-0490 Phase 2.5 narrow | Items 3+6+7 (collab persistence + prose) | 65 | Deck persistence | S2 | **Spec (AH-149)** | 3 small items: prose comment, remove isSoloMode guard on lastDeckQueryKey, collab cold-start restore. ~50-80 LOC, 2 files, no migration. Closes ORCH-0492 RC#3. |
| 2 | ORCH-0008 | Onboarding state machine | 83 | Onboarding | S0 | Investigate | Users can get stuck mid-onboarding. Auto-escalated S0. Completion rate unknown. |
| 2 | ORCH-0102 | Account deletion | 80 | Profile | S0 | Investigate | Apple/Google require account deletion. App Store rejection if missing. |
| 3 | ORCH-0250 | Avatars bucket no user-scoping | 80 | Security | S1 | Implement | Any user can overwrite another user's avatar. Identity impersonation risk. |
| 4 | ORCH-0094 | Save/unsave experience | 78 | Saved | S1 | Investigate | Core loop step. Users can swipe but can't verify saves work. |
| 5 | ORCH-0041 | Curated no Schedule button | 76 | Discovery | S1 | Implement | Known bug with fix path. Curated cards missing Schedule = half the deck unusable for planning. |
| 6 | ORCH-0251 | Messages bucket public — DM files without auth | 75 | Security | S1 | Implement | Anyone with a URL can access DM file attachments. Privacy violation. |
| 7 | ORCH-0257 | 6 edge functions have no auth (incl. Google Maps key) | 70 | Security | S2 | Implement | Unauthenticated endpoints expose API keys and server logic. |
| 8 | ORCH-0127 | Send/receive messages | 70 | Chat | S1 | Investigate | Social feature. If DM broken, friend connections are hollow. |
| 9 | ORCH-0039 | Currency changes with GPS | 68 | Discovery | S1 | Investigate | Currency re-derived from GPS instead of locked from onboarding. User sees different $ symbols. |
| 10 | ORCH-0111 | Map rendering (dual provider) | 65 | Map | S1 | Investigate | Entire map feature unaudited. 16 items at F. Start with the renderer. |
| 11 | ORCH-0070 | Session creation | 64 | Collaboration | S1 | Investigate | Collaboration creation flow unaudited. Core social feature. |

## Strategic Categories

| Category | Score Range | Count | IDs |
|----------|-----------|-------|-----|
| Fix Now | 70-100 | 9 | ORCH-0336, 0008, 0041, 0094, 0102, 0127, 0250, 0251, 0257 |
| Fix Next | 50-69 | ~30 | Remaining S1 items + high S2 items |
| Should Fix | 30-49 | ~40 | S2 items on non-critical flows |
| Debt | 10-29 | ~30 | S3 items, cosmetic issues |
| Defer | 0-9 | ~5 | Booking, A/B testing, DM email |

## Active Workstream: Analytics & Documentation Truth Sweep

ORCH-0390 (documentation truth sweep) is the active workstream. Phase 1 (dead code elimination) and Phase 2 (analytics/notification architecture investigation) are complete. Phase 3 (artifact sync) is executing now.

### New Analytics ORCHs (registered this session)

| ID | Title | Score | Severity | Status |
|----|-------|-------|----------|--------|
| ORCH-0387 | Analytics identity & cross-service integration | 60 | S1 | Investigated |
| ORCH-0388 | RevenueCat "customer" count inflation | 45 | S2 | Investigated |
| ORCH-0389 | OneSignal push_clicked tracking gap | 40 | S2 | Open |
| ORCH-0390 | Documentation truth sweep | 55 | S1 | Partial (Phase 3 executing) |

These don't displace the top 10 (all S0/S1 user-facing) but enter the "Fix Next" category.

## Recently Closed (2026-04-17 — ORCH-0460 Bundle)

| ID | Title | Status | Evidence |
|----|-------|--------|----------|
| ORCH-0460 | Place pipeline accuracy overhaul — master | closed A | QA PASS retest cycle 1, 11/11 SC |
| ORCH-0461 | casual_eats split into 3 configs | closed A | Under 50-type Google limit |
| ORCH-0462 | Upscale & Fine Dining expansion | closed A | 8→32 seeding types; chain protection whitelist |
| ORCH-0463 | Garden store flowers leak | closed A | Live SQL: 180→11, 139 supermarkets preserved |
| ORCH-0464 | Venue keyword sync | closed A | Kids keywords 12→37 |
| ORCH-0465 | Brunch restaurants-only | closed A | Food courts/delis/bars/tobacco excluded |
| ORCH-0471 | Mutual exclusivity upscale↔casual REMOVED | closed A | Nobu/Spago dual-category examples |
| ORCH-0477 | Invariant #13 drift | closed A | Constitutional #13 restored FAIL→PASS |

## Newly Open (2026-04-17)

| ID | Title | Score | Severity | Status |
|----|-------|-------|----------|--------|
| ORCH-0489 | Admin-UI "Refresh Stats" button — replaces failed pg_cron with user-controlled refresh | **65** | S1 | **Implemented, build-verified 2026-04-18.** `npm run build` PASS (2918 modules, 0 errors). Browser smoke test pending (prompts/TESTER_ORCH-0489_ADMIN_REFRESH_BUTTON.md — 6 quick checks). |
| ORCH-0481 | Admin RPC materialized view layer — query layer SHIPPED, auto-refresh INOPERATIVE | — | S1 | **Partially shipped to production (Mingla-dev).** Query-rewrite wins live: admin page loads in 87-400ms. pg_cron jobid=13 never fires (3-cycle stuck-in-loop per DEC-023). ORCH-0489 absorbs the remaining auto-refresh gap. Grade D; → A on ORCH-0489 close. |
| ORCH-0480 | Admin Place Pool page 500s — 3 RPCs timing out | — | S1 | **CLOSED A (2026-04-18)** — original incident resolved by ORCH-0481's MV layer. Migration `20260417300001` live on prod as harmless stepping stone. |
| ORCH-0482 | Admin analytics RPCs will time out when profiles grow — same pattern as ORCH-0480 | 48 | S2 | Open (pre-emptive; can bundle into ORCH-0481) |
| ORCH-0483 | Admin RPC perf gate — EXPLAIN ANALYZE required for every new admin_* function | 45 | S2 | Open (process improvement) |
| ORCH-0484 | 776 approved active places have NULL/empty ai_categories — contract violation | 35 | S2 | Open (discovered via ORCH-0480 D-2; data-integrity audit needed) |
| ORCH-0478 | Pre-flight pool-impact dry-run before mass re-validation | 62 | S2 | Open (tester-escalated from S3) |
| ORCH-0476 | category-mapping.md stale vs 10-category reality | 40 | S2 | Open (doc debt) |
| ORCH-0479 | GPT Example 2 (TopGolf) non-idempotent classification | 22 | S3 | Open (non-blocking) |

## Newly Open (2026-04-17 late — ORCH-0490 Program)

| ID | Title | Score | Severity | Status |
|----|-------|-------|----------|--------|
| ORCH-0490 | **PROGRAM — Deck reliability & session persistence master initiative** | **88** | S1 | **Charter — Phase 0 verification dispatches pending** (3 investigator prompts next). Bundles ORCH-0485/0491/0492/0493/0494 under 4-phase pipeline. User-aligned 2026-04-17. |
| ORCH-0485 | Deck pref-change latency (3 root causes proven) | 82 | S1 | **RC#1 CLOSED 2026-04-18 via Phase 2.1 CONDITIONAL PASS** — refreshKey removed from location query key. RC#2 + RC#3 pending Phase 2.2. |
| ORCH-0494 | False EMPTY race (20s safety timer) + polluted analytics | — | S1 | **CLOSED A 2026-04-18 via Phase 2.1 CONDITIONAL PASS.** QA report PASS; new invariant I-DECK-EMPTY-IS-SERVER-VERDICT established. |
| ORCH-0491 | Solo↔Collab switch: preserve progress, parallel live decks | 78 | S1 | Charter — ORCH-0490 Phase 2.3 |
| ORCH-0492 | Session persistence: last-card position across app close + mode switch | 78 | S1 | Charter — baseline investigation Phase 0-B, design Phase 2.5 |
| ORCH-0493 | Collab multi-participant pref-change pressure — **verified ⚠️ PARTIAL 2026-04-18** | 76 | S1 | Phase 0-C complete. In-flight position + dedup memory wiped on pref-change propagation. RC#1 H, RC#2 M. Phase 2.6 scope CONFIRMED ON. |
| ORCH-0495 | Client warm-ping of discover-cards on foreground | 42 | S2 | Open (renumbered from colliding 0488) |
| ORCH-0496 | Zombie realtime subscriptions + dead query-key lookups after ORCH-0446 partial rebuild | 18 | S3 | Open 2026-04-18. Bundle into ORCH-0490 Phase 2.6 as ~10-line cleanup. |
| ORCH-0497 | `useBoardSession.updatePreferences` triple-writes author-device state | 12 | S3 | Open 2026-04-18. Benign, defer to post-ORCH-0490. |
| ORCH-0498 | Mixed-deck progressive-delivery double-wipe on solo pref change (SOLO analog of ORCH-0493 RC#1) | 74 | S1 | Charter 2026-04-18 via Phase 0-A §12.2. H on code mechanism. Same fix as ORCH-0491 + ORCH-0493 RC#1. Absorb into ORCH-0490 Phase 2.3 or dedicated slice. |
| ORCH-0499 | `currentMode` + `currentSession` not persisted — cold launch always lands in Solo | 75 | S1 | Charter 2026-04-18 via Phase 0-B RC#2. Intentional ORCH-0209-era design now contradicts JTBD-3. Core of ORCH-0490 Phase 2.5. Product tradeoff: freshness vs resumption. |
| ORCH-0500 | Dead React Query cache entries accumulate after pref changes | 14 | S3 | Charter 2026-04-18 via Phase 0-B HF#3. Not critical until 1.5MB Android CursorWindow cap hit. Defer to post-ORCH-0490 unless beta testing surfaces it. |

**Why ORCH-0490 ranks 88 even without being a launch blocker:** core-loop discovery reliability. Every user hits the deck every session. Current state lies (false EMPTY), loses state (swipe position), and punishes pref changes with 2–10s blank screens. Does not block first ship but does block delightful UX. Sequenced AFTER the S0 launch-blocker top three (ORCH-0336, 0008, 0102).

## Admin RPC Perf Cluster (2026-04-17 — updated post-FAIL)

The admin Place Pool page broke hard when place_pool hit 63,239 rows. Diagnostic audit of all 66 `admin_*` RPCs found 22 carry the same vulnerability pattern (live COUNT + GROUP BY + full-table scan). ORCH-0480 attempted an emergency narrow fix via a partial expression index — **it FAILED perf targets** per tester report: index works for pure COUNT (53ms Index-Only Scan) but cannot accelerate real RPCs that project heap-resident columns (`stored_photo_urls`, `rating`). Post-migration timings on Mingla-dev: all 3 RPCs still 4–9s, still exceeding PostgREST's 8s timeout.

**Pivot decided 2026-04-17 (DEC-021):** ORCH-0480 is architecturally insufficient for the data volume. Skip rework. Dispatch ORCH-0481 (materialized view layer) as the next implementation wave — it's the only structurally-sound path.

Revised sequencing:

1. **Now (recommended):** User dispatches ORCH-0481 implementor prompt. Materialized view layer covers all 3 ORCH-0480 functions + 19 others at risk. Expected: admin pages <200ms.
2. **Optional pre-ORCH-0481:** Test ORCH-0480 migration on production DB to learn whether prod's faster I/O brings timings under 8s (partial win as stepping stone). Migration is currently on Mingla-dev only (commit 82d94aef).
3. **After ORCH-0481 closes:** ORCH-0483 (perf gate process rule) + ORCH-0484 (data-integrity audit of 776 orphan empty-array rows).

ORCH-0480's migration stays in place on dev (commit 82d94aef) as a stepping stone — its index is not harmful, just insufficient. Function rewrites will be replaced by ORCH-0481's MV-backed versions anyway.

**ORCH-0478 elevation rationale:** The tester's predictive SQL proved its value twice — caught a P0 that would have destroyed 168 legitimate supermarkets' flowers category, then confirmed the fix. Should be mandatory before any scope=all re-validation.

## Recommended Next Action

**Browser smoke test of ORCH-0489** — lightweight 6-check verification:

1. Open the admin Place Pool page → Overview tab — confirm "Refresh stats" button appears right-aligned in the header.
2. Click the button → confirm it disables + shows spinner + "Refreshing…" text.
3. Wait 30s–2min → confirm success toast appears with "N,NNN places in X.Xs".
4. Confirm other Overview tab content re-renders with fresh numbers.
5. Click through Browse Pool / Map View / Seeding / Photo Management / Stale Review tabs → confirm no layout breaks from the new header row.
6. (Optional but valuable) Before click: `SELECT COUNT(*) FROM admin_place_pool_mv` should be ≤ `SELECT COUNT(*) FROM place_pool`. After click: they should match. Proves MV is being refreshed.

Tester prompt at `prompts/TESTER_ORCH-0489_ADMIN_REFRESH_BUTTON.md` if you want formal QA; user-direct smoke works too given the tight scope.

On PASS → Post-PASS protocol → ORCH-0489 closes A, ORCH-0481 promotes D→A, admin dashboard story complete.

**Alternative to consider:** Before dispatching, run ORCH-0480's migration against production to learn whether prod I/O is fast enough to make it a partial win (admin loads slowly but doesn't 500). Low-cost info-gathering; doesn't delay ORCH-0481.

**Top launch priorities (unchanged):** ORCH-0336 (app stuck loading), ORCH-0008 (onboarding state machine), ORCH-0102 (account deletion). These remain the highest-impact items blocking launch. Admin RPC cluster is operational, not launch-gating, but blocks internal place-curation work today.
