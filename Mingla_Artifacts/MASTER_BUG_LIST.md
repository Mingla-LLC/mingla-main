# Master Bug List

> Last updated: 2026-04-19 (**ORCH-0490 Phase 2.5 verification CLOSED** — NARROW SCOPE verdict, 3 real pending items; **ORCH-0525 registered S1** flag-flip prod gap — AH-138 per-context registry fix not active in production; **DEC-031 logged** mingla_last_mode as accepted architecture; DEC-026 RETRACTED; ORCH-0499 ready to close) + 2026-04-19 (**ORCH-0520 intake + investigation complete** — session more-menu polish + invite rework; H confidence; awaiting user decisions on 3 scope questions before spec; ORCH-0521/0522/0523/0524 registered as side discoveries) + 2026-04-18 (**ORCH-0490 Phase 2.4 CLOSED** — structurally satisfied, no code; AH-147 verification PASS HIGH; DEC-029 logged; ORCH-0518 registered as side discovery) + 2026-04-18 (ORCH-0503 CLOSED v3 PASS device retest 6/6; commit 841d9fb7 pushed; OTA pending) + 2026-04-19 late (Phase 2.3 rework — ORCH-0491 + ORCH-0498 closed)
> Total: 382 | Open: 173 | Closed: 132 (incl ORCH-0512 retracted) | Verified (B grade): 24 | Partial: 2 | Deferred: 3 (now incl ORCH-0531) | Partially-shipped: 1 | Program charter: 3 | Phase-0-verified: 3 | Phase-2.1-shipped: 1 | Phase-2.2-shipped: 1 | Phase-2.3-shipped: 1 | Phase-2.4-closed-no-code: 1 | Phase-2.5-verified-narrow: 1

> **ORCH-0526 Phase 4 M1 (Database) SHIPPED + CHECKPOINT 1 PASS 2026-04-19:** 3 migrations deployed via `supabase db push`: `20260420000001_create_rules_engine_tables.sql` (4 tables + 2 ALTER + immutability triggers + indexes + RLS), `20260420000002_seed_rules_engine_v1.sql` (18 rules + 612 entries + v1-initial-seed manifest), `20260420000003_create_rules_engine_rpcs.sql` (12 admin RPCs + 2 advisory lock helpers + 1 paginated helper + admin_config flag bootstrap). All 13 verification checks PASS via MCP: 4 tables present, 5 new columns, CHECK extended with `rules_only_complete`, 18 rule_sets, 18 versions, 612 entries, manifest exists, 0 missing pointers, 15 RPCs created, flag=false, **immutability trigger proven structurally** (UPDATE rejected with `P0001: rule_set_versions is immutable`), **admin gate proven** (service-role call rejected with `P0001: Admin access required`). I-RULE-VERSION-IMMUTABLE enforced at engine level. Per-rule entries match expected distribution (EXCLUSION_KEYWORDS=192, FAST_FOOD=66, etc.). 3 zero-entry rules carry only thresholds JSONB. **M2 (edge function refactor) is next — user re-invokes mingla-implementor when ready.**

> **ORCH-0526 Phase 4 implementor prompt READY 2026-04-19 evening:** Dispatch prompt at `prompts/IMPL_ORCH-0526_RULES_FILTER_TAB.md`. 4-milestone build with mandatory user checkpoints between each (M1 DB → M2 edge fn → M3 admin UI core → M4 stubs+CI+flag-flip). Estimated 1.5–2 weeks. Diagnose-First Workflow enforced (implementor presents findings before writing code at every checkpoint). All 5 bundled bug fixes scoped + verification protocols defined. Invariant preservation re-checked at every checkpoint. Final handoff after M4 → mingla-tester. Implementor does NOT flip production feature flag — that's coordinated with tester.

> **ORCH-0526 Phase 3 spec AMENDED 2026-04-19 evening (Amendment 1):** User-driven product clarifications produced 2 changes: (1) `run_drift_check` scope corrected from 4 sources to 3 — seeding dropped because it's an INPUT contract bounded by Google's vocabulary, not by Mingla's category logic. ORCH-0528 narrows accordingly. (2) NEW v1 addition: `scripts/validate-category-consistency.ts` CI script catches drift at PR time (complement to runtime drift_check which catches drift at admin-edit time). Two safety nets at the two moments drift can happen. (3) NEW known limitation registered as ORCH-0531 — rule rollback does NOT auto-restore prior AI verdicts on affected places. Deferred to v2 follow-up. v1 mitigation: history preserved in ai_validation_results, manual override available, impact preview before save makes "oh no I broke 47 places" rare. Amendment 1 added to spec head; supersedes §5.4, T-09/T-10, §12 step 6.5; no other sections changed. Confidence remains HIGH.

> **ORCH-0531 (NEW 2026-04-19 evening — known limitation, deferred):** Rule rollback (admin_rules_rollback RPC) creates a new rule_set_version matching the target version, but does NOT auto-restore prior AI verdicts on places affected by the rolled-back rule. Concrete scenario: AI accepts Bar Vento → rules-v8 rejects Bar Vento (overwrites place_pool.ai_approved=false) → admin rolls back to v7 → re-runs rules-filter → rules don't fire on Bar Vento (no rule rejects it) → place_pool.ai_approved STAYS at false (last-writer-wins). Bar Vento doesn't reappear in decks. v1 mitigations: (a) history preserved in ai_validation_results so admin can SEE the AI verdict that got overwritten, (b) admin can manually override via Review Queue (existing admin_ai_override_place RPC), (c) re-running AI validation on affected places restores verdicts (costs OpenAI tokens), (d) impact preview before save (spec §5.2) makes the bad-rule-save scenario rare. v2 fix options: snapshot last_ai_verdict on place_pool OR compute on-the-fly from ai_validation_results history. ~2-3 days build. Classification: missing-feature + ux. S3 (low — has manual mitigation, low frequency expected). Discovered via user product question on ORCH-0526 Phase 3 spec review.

> **ORCH-0526 Phase 3 spec COMPLETE + APPROVED 2026-04-19:** mingla-forensics SPEC mode returned the binding contract at `outputs/SPEC_ORCH-0526_RULES_FILTER_TAB.md`. Schema verified live via MCP before writing ALTERs (CHECK constraint on `stage` already accepts `rules_only` — only adds `rules_only_complete`; `admin_users.role` already exists for v2; `seeding_cities.id` is UUID for clean FK). 3-migration sequence (M1 schema + M2 seed + M3 RPCs), edge function refactor with 5 bundled bug fixes (ORCH-0512 retraction, 0527 unchanged counter, 0528 drift check action, 0529 advisory lock, 0530 city_id FK), 12 admin RPCs fully signed, 14 frontend components fully spec'd with props/state/RPC bindings, 22 success criteria mapped to 20 test cases, 6 invariants ready for INVARIANT_REGISTRY.md. Migration ordering + rollback + 15-step implementation order all defined. 4 new hidden flaws + 1 observation surfaced during spec writing. **Phase 4 (implementor) prompt to follow.**

> **ORCH-0526 Phase 2 design COMPLETE + APPROVED 2026-04-19:** mingla-designer returned the Rules Filter tab spec at `outputs/DESIGN_ORCH-0526_RULES_FILTER_TAB.md`. 3-tier IA (Health row → 2-column workspace → side-panel drill-ins). 17 states designed. Vibes-readiness validated for all 20 vibes via 2 stub editors (`TimeWindowEditor`, `NumericRangeEditor`) shipped in v1 to lock the architecture for time_window + numeric_range rule kinds. Reuses 14 existing components (`StatCard`, `SectionCard`, `Badge`, `Button`, `Tabs`, `SearchInput`, `Dropdown`, `Skeleton`, `Spinner`, `Toast`, `Modal`, `Input`, `DataTable`, `AlertCard`); adds 14 new ones in `mingla-admin/src/components/rules-filter/`. Design implies 4 new DB tables (rule_sets, rule_set_versions, rule_entries, rules_versions), ALTER ai_validation_jobs + ai_validation_results for FK columns, 12 admin RPCs, edge function refactor (read rules from DB, fix `stage` discriminator preservation, accept rules_version_id param). 5 designer open-questions resolved by orchestrator: Q1 role-based defer-to-v2, Q2 JSON export include-in-v1, Q3 reason-required-for-blacklist-and-demotion-only, Q4 AI-suggestions defer-to-v2, Q5 sandbox defer-to-v2. **Awaiting user confirmation on the 5 resolutions** before Phase 3 (spec) prompt is written.

> **ORCH-0526 Phase 1 audit COMPLETE 2026-04-19 (HIGH confidence):** Phase 1 forensics returned. 18 deterministic rules enumerated (16 named + 2 inline) — all in `ai-verify-pipeline/index.ts`. Per-city rules-filter runs CONFIRMED working (Cary 2x, Raleigh 2x, Fort Lauderdale 1x). Versioning ZERO across all tables. Rules live in 4 separate files (drift risk). 10 of 20 vibes can plug into existing rule structure; 6 partial; 4 AI-only. **ORCH-0512 RETRACTED** — rules-only runs correctly produce $0 cost (no AI calls); the actual hidden flaw is `stage` field overwritten at job-end destroying the discriminator. Architectural fork presented (Path A: extend tables, keep rules in code, ~1 week / Path B: move rules to DB, full tweakability, vibes-ready, ~3 weeks). 4 new side-issue ORCH-IDs registered below (0527–0530). Report: `outputs/INVESTIGATION_ORCH-0526_DETERMINISTIC_FILTER_AUDIT.md`. Awaiting user steering on Path A vs B before Phase 2 (Design) prompt is written.

> **ORCH-0527 (NEW 2026-04-19 — misleading admin label, S2):** `ai_validation_jobs.approved` field for rules-only runs is misnamed — it's computed as `total_processed - rejected - reclassified` at edge function line 1606, which means the count of UNCHANGED places, not newly-approved places. Admin "Recent Runs" displays "approved=1212" which an admin reads as "1212 places approved by this run" but actually means "1212 places left alone by this run." Constitutional #3 adjacent (misleading rather than silent). Fix: rename to `unchanged` for rules-only runs OR add separate counters. Bundle with ORCH-0526 Phase 3 spec.

> **ORCH-0528 (NEW 2026-04-19 — silent drift, S2):** Four separate sources of category-to-Google-type truth: (a) `ai-verify-pipeline/index.ts` — what to STRIP, (b) `_shared/seedingCategories.ts` — what to SEED, (c) `_shared/categoryPlaceTypes.ts` — what to RETURN on-demand, (d) `mingla-admin/src/constants/categories.js` — display labels. No validator catches drift between these 4. A Google type seeded by (b) but stripped by (a) silently disappears from decks without warning. Path B in ORCH-0526 fixes this structurally (single source of truth in DB); Path A does not. Architecture-flaw + documentation-drift.

> **ORCH-0529 (NEW 2026-04-19 — race risk, S3):** `handleRunRulesFilter` has no concurrency lock. Two admin tabs running rules-filter on the same city simultaneously will both execute and write to the same place_pool rows, last writer wins. No `lock_token` field on `ai_validation_jobs`. Fix: add advisory lock by `(city_id, scope)` tuple; return 409 if held. Bundle with ORCH-0526 Phase 3 spec.

> **ORCH-0530 (NEW 2026-04-19 — historical link risk, S3):** `ai_validation_jobs.city_filter` stores city display name (e.g. "Cary"), not `city_id` UUID. If a city is renamed in `seeding_cities`, historical job-row → city lookup breaks. Add `city_id UUID FK seeding_cities` alongside the existing display string. Bundle with ORCH-0526 Phase 3 spec.

> **ORCH-0512 RETRACTED 2026-04-19:** Original framing "cost_usd=0 + completed_batches=0 regression on jobs after 2026-04-14" was a mis-attribution by the ORCH-0511 audit. Those jobs are RULES-ONLY runs which correctly produce $0 cost (no AI calls) and don't increment `completed_batches` (they don't use the AI batch loop — they paginate directly). The PRE-Apr-14 jobs were AI runs (real cost). The actual hidden flaw remaining is that `stage` is overwritten from `"rules_only"` to `"complete"` at job-end (line 1602), destroying the discriminator. The "Recent Runs" admin table also displays $0.00 cost for rules-only runs without labeling them — that's a UI labeling gap. Re-framed as: discriminator-loss + labeling-gap, both bundled into ORCH-0526 Phase 3 spec scope. ORCH-0512 closed administratively.

> **ORCH-0526 (NEW 2026-04-19 — program charter, S1):** Deterministic Rules Engine — Visible, Versioned, Extensible. **Vision:** new "Rules Filter" admin tab in `AIValidationPage.jsx` (after Command Center) that exposes the 16+ TypeScript constants currently buried in `ai-verify-pipeline/index.ts` (FAST_FOOD_BLACKLIST, EXCLUSION_KEYWORDS with 15 sub-categories, BLOCKED_PRIMARY_TYPES, FLOWERS_BLOCKED_*, CASUAL_CHAIN_DEMOTION, UPSCALE_CHAINS + UPSCALE_CHAIN_PROTECTION, RESTAURANT_TYPES, CREATIVE_ARTS/MOVIES_THEATRE/BRUNCH_CASUAL/PLAY_BLOCKED_*, GARDEN_STORE_PATTERNS, DELIVERY_ONLY_PATTERNS, SOCIAL_DOMAINS) as: per-rule visibility (whitelist/blacklist viewer), per-rule editability (DB-backed instead of code constants), versioning (which rules version was applied to which city), per-city run history, and progress tracking. Architectural goal: rule infrastructure must serve TODAY's 10 categories AND tomorrow's 20 vibes (`vibe-engine/Vibes.md`) without rewrite. **On the critical path to ORCH-0511 vibe-unlock gate condition #3 ("AI pedantry upgrade").** **4-phase pipeline:** Phase 1 forensics (audit current rules + vibe-to-rule mapping), Phase 2 design (admin tab UI spec — design-skill choice TBD), Phase 3 spec (DB migration + edge function refactor + admin RPCs), Phase 4 implement+test. **Phase 1 prompt:** `prompts/FORENSICS_ORCH-0526_DETERMINISTIC_RULES_AUDIT.md`. Classification: architecture-flaw (code-only rules) + missing-feature (admin UI gap) + ux. Discovered 2026-04-19 via user request. Bundles thematically with ORCH-0512 (telemetry regression) and ORCH-0514 (orphan writers) since all touch the same edge function. Counter +1 (Total 376→377; Open 168→169; Program charter 2→3).

> **ORCH-0525 AH-150 INVESTIGATION + SPEC COMPLETE 2026-04-19 (HIGH confidence):** Flag-flip risk audit + rollout spec delivered. Two flags (`FEATURE_FLAG_PROGRESSIVE_DELIVERY` + `FEATURE_FLAG_PER_CONTEXT_DECK_STATE`) default to `__DEV__` — both dark in production. Activating via 2-line flip unlocks 6 previously-dark fixes in one bundle. Option A chosen (flip to unconditional `true`; keep constants as 2-week kill-switch; Option B cleanup dispatch scheduled 2 weeks post-flip). Pre-flip gate: AH-137 + AH-135 + AH-146 test matrices must PASS on a **Release build** (not Debug) with flags manually on. If Release-build divergence found → abort + forensic. Rollback: 1-line revert per flag + OTA, < 5 min. Reports: `outputs/INVESTIGATION_ORCH-0525_FLAG_FLIP_RISK.md` + `outputs/SPEC_ORCH-0525_FLAG_FLIP_ROLLOUT.md`. Next: AH-151 pre-flip tester gate (manual user Release-build smoke).

> **PROCESS CORRECTION 2026-04-19 — flag-gated "closed" status was inaccurate:** AH-150 investigation §10 surfaced a process gap: five ORCH-IDs marked `closed` in prior tracker entries are actually `closed-on-DEV-but-prod-dark`. Customer-facing status = still open until ORCH-0525 flip ships + AH-153 tester retest PASSES. Re-tagging these entries as `closed-pending-prod-flag-flip`:
> - **ORCH-0485 RC#2** (singles-first hardcoded) — closed on DEV via AH-134; prod still takes old order
> - **ORCH-0485 RC#3** (zero-singles 20s wait) — closed on DEV via AH-134; prod still waits 20s
> - **ORCH-0491** (Solo↔Collab toggle wipes position) — closed on DEV via AH-138; prod still wipes
> - **ORCH-0498** (mixed-deck double-wipe on pref change) — closed on DEV via AH-136; prod still double-wipes
> - **ORCH-0493 RC#1** (collab mid-swipe wipe on incoming pref change) — closed on DEV via AH-136; prod still wipes mid-swipe
> These auto-close to `closed-verified-prod` when ORCH-0525 AH-153 tester reports PASS on Release build. **Permanent process improvement:** future tester PASS on flag-gated fix must set `closed-pending-prod-flag-flip`, not `closed`. Artifact template update needed (separate dispatch).

> **ORCH-0499 CLOSED 2026-04-19 — resolved by DEC-031:** Mode/session cold-launch persistence was the stated problem. AH-148 discovered the `mingla_last_mode` AsyncStorage key at `AppStateManager.tsx:168,391` ALREADY persists `{ mode, sessionId }` and is read+verified on mount. Never needed Phase 2.5 code work. Logout covered by prefix sweep at `AppStateManager.tsx:792`. Closing administratively — no commit, no OTA, no tester.

> **ORCH-0492 RC#3 RE-GRADED S1 → S2 perf 2026-04-19:** Original framing "solo-only lastDeckQueryKey → collab has no cache" was incorrect per rescan. React Query persister at `app/index.tsx:2978-2983` persists populated collab `deck-cards` queries for 24h; `mingla_card_state_${mode}_${refreshKey}_*` AsyncStorage restores position; `mingla_last_mode` restores mode+session. Collab functionally remembers everything today. What's missing: pre-GPS instant-render optimization (`@mingla/lastDeckQueryKey` passed as `lastKnownQueryKey` to the hook — solo-only path at `RecommendationsContext.tsx:658`). Delta: collab cold-launch waits ~200-2000ms for GPS before cache hit; solo renders immediately. AH-149 closes this as perf polish, not bug fix.

> **ORCH-0525 (NEW 2026-04-19 — prod flag-flip gap, S1):** `FEATURE_FLAG_PER_CONTEXT_DECK_STATE` at `app-mobile/src/config/featureFlags.ts:67` defaults to `__DEV__` (truthy only in development + local TestFlight debug builds). All AH-138 per-context `DeckStateRegistry` work + flag-on-only `modeChanged` wipe-skip at `SwipeableCards.tsx:945-947` are **prod-inactive**. Production customers still experience **ORCH-0491** (Solo↔Collab position loss) and **ORCH-0498** (mixed-deck double-wipe) because the fix is gated off in release builds. AH-138 tester PASS on DEV build is therefore misleading relative to real customer experience. Classification: architecture-flaw / regression-risk / documentation-drift. S1 because it blocks the realized product benefit of AH-138. Not a launch blocker in itself (existing prod behavior is degraded but not crashing). Fix: risk-analysis + prod flag flip (likely via `FEATURE_FLAG_PER_CONTEXT_DECK_STATE = true` unconditional, with rollback plan). Cutover criteria + telemetry plan required before the flip. Discovered by AH-148 Phase 2.5 verification §6 Discovery 1.

> **ORCH-0490 Phase 2.5 VERIFIED NARROW 2026-04-19 (3 real pending items):** AH-148 verification (`outputs/INVESTIGATION_ORCH-0490_PHASE_2.5_COLD_LAUNCH_RESTORE.md`) mapped the 9 master-spec Phase 2.5 file edits: **1 ✅ SHIPPED** (item 8 structurally via prefix sweep) · **2 ⚠️ PARTIAL flag-gated** (items 1+2 via AH-138's `DeckStateRegistry` + `effectiveModeChanged` gate — active DEV-only, pending ORCH-0525 prod flag flip) · **3 ❌ PENDING** (items 3+6+7 — only real remaining work: prose comment at `SwipeableCards.tsx:513`; remove `isSoloMode` guard at `RecommendationsContext.tsx:718` so collab persists `@mingla/lastDeckQueryKey_collab_<sessionId>`; expand cold-start restore at `RecommendationsContext.tsx:236-265` to try collab key first) · **3 🗑️ SUPERSEDED** (items 4+5+9 — mode/session persistence already delivered via `mingla_last_mode` AsyncStorage key per DEC-031; no Zustand partialize change needed). SC-2.5-01/04/05/08 ✅ HOLDS; SC-2.5-02/03 ⚠️ PARTIAL (flag-gate + item 6+7 gap); SC-2.5-06/07 ❌ gap (trivial grep guards post-fix). I-DECK-POSITION-PERSISTS-ACROSS-INTERRUPTIONS PARTIALLY ENFORCED (full enforcement needs ORCH-0525 + items 6+7). I-MODE-SESSION-PERSISTS-COLD-LAUNCH ✅ ENFORCED via `mingla_last_mode`. Side finds: ORCH-0525 registered (flag flip), DEC-031 logged, DEC-026 retracted, ORCH-0499 ready to close, `mingla_last_mode` added as 6th persistence mechanism (Phase 0-B doc gap), `I-REFRESHKEY-PERSISTED` missing from INVARIANT_REGISTRY.md despite AH-142 claim (now backfilled). Next: AH-149 NARROW SPEC for items 3+6+7.

> **ORCH-0520 (NEW 2026-04-19 — session modal polish cluster, S2):** User-reported UX issues in the collaboration session more-menu (`BoardSettingsDropdown.tsx`). Four scopes in one pass: (a) title-edit affordance invisible, (b) mute toggle buried in menu row instead of header icon, (c) renamed title does not refresh live in main modal header, (d) "Invite Participants" row should be replaced with inline country-picker + phone + Invite button. Forensic investigation COMPLETE 2026-04-19 (H confidence). Two root causes proven: (1) `SessionViewModal.tsx:161` stale-prop `||` override — session name has 3 owners, stale parent prop overrides fresh DB read; (2) `SessionViewModal.tsx:166` — mute toggle is pure local useState, zero persistence, dead control (Constitutional #1 violation). `InviteParticipantsModal.tsx` deletion = SAFE (only caller is SessionViewModal) BUT it is a friend-picker, not phone-invite — Q4 "preserve exact current phone behavior" has no referent because no phone-invite path exists from this surface today. User must pick phone-invite contract before spec. Intake: `outputs/INTAKE_ORCH-0520_SESSION_MODAL_POLISH.md`. Investigation: `outputs/INVESTIGATION_ORCH-0520_REPORT.md`. Status: **SPEC COMPLETE 2026-04-19** (H confidence, orchestrator review APPROVED). Spec: `outputs/SPEC_ORCH-0520_SESSION_MODAL_POLISH.md` — 20 sections, 6 deliverables, 17 success criteria, 24 test cases, 4 open questions (all LOW/MED, none blocking). Decisions locked: (D1) keep friend picker via inline collapsible accordion AND add phone invite — extract to `InlineInviteFriendsList.tsx`, delete 695-line modal; (D2) hybrid invite contract (lookup → in-app if Mingla user, SMS if not); (D3) real mute persistence via `session_participants.notifications_muted` column + `notify-dispatch` gate (ORCH-0521 bundled). Two NEW invariants established: I-SESSION-MUTE-RESPECTED-AT-DISPATCH, I-SESSION-NAME-SINGLE-OWNER. Implementor prompt: `prompts/IMPLEMENTATION_ORCH-0520_SESSION_MODAL_POLISH.md`. **Implementor dispatch PAUSED 2026-04-19** — user raised regression concern about accept-invite flow. Pre-build verification investigation dispatched to close 4 unverified assumptions: (A1) acceptCollaborationInvite independence, (A2) RLS for inviter→invitee session_participants INSERT, (A3) Participant type extension blast radius, (A4) send-collaboration-invite side effects. Verification prompt: `prompts/VERIFICATION_ORCH-0520_PREBUILD_ADDENDUM.md`. **Verification COMPLETE 2026-04-19** (H confidence): verdict **PATCH NEEDED (not block)**. A1 (accept-invite) SAFE — UPSERT `onConflict: 'session_id,user_id'` gracefully harmonizes with warm-path pre-insert; notifications_muted preserved. A2 (RLS) SAFE — `sp_insert` policy at `20260227000005_harden_session_participants_insert_rls.sql` covers session-creator and is_session_participant cases. A3 (Participant type) CONFLICT — shared interface at `ParticipantAvatars.tsx:12` imports into 4 files; spec §11.4 was wrong about local interface in SessionViewModal. A4 (send-collaboration-invite) SAFE — read-only, type=collaboration_invite_received not session-scoped. **User directive 2026-04-19: "notifications not muted by default" — enforced by `NOT NULL DEFAULT false` on migration column + codified as new invariant I-SESSION-MUTE-DEFAULT-UNMUTED.** Spec patched: §11.4 rewritten to target ParticipantAvatars.tsx + BoardSettingsDropdown.tsx (no SessionViewModal type change needed), 3 new invariants (SESSION-MUTE-RESPECTED-AT-DISPATCH, SESSION-NAME-SINGLE-OWNER, SESSION-MUTE-DEFAULT-UNMUTED), SC-07b + T-22b/T-22c added to verify default-unmuted behavior. Report: `outputs/VERIFICATION_ORCH-0520_PREBUILD_ADDENDUM.md`. Side discoveries: ORCH-0525 proposed (Participant type drift, S3), ORCH-0526 proposed (BoardMemberManagementModal possibly dead, S3), R-1 (pre-insert orphan rows on never-acted invites — pre-existing behavior). **SCOPE EXPANDED 2026-04-19** — user raised two concerns: (A) admin-only invite gate visibility, (B) preference union on accept. Verified (B) is safe — `acceptCollaborationInvite` Step 4 (`collaborationInviteService.ts:185-218`) seeds prefs via `upsert_participant_prefs` RPC, untouched by our changes. For (A), surfaced pre-existing bug: `useBoardSession.ts:169` sets `setIsAdmin(isCreator)` — non-creator admins promoted via the member-admin toggle (BoardSettingsDropdown:252-282) are NOT recognized by the canManageSession gate. User approved folding the one-line fix into ORCH-0520 as Deliverable 7. Spec patched with §11.3b (isAdmin fix + protective comment), SC-18/SC-19 (admin vs participant visibility), T-25/T-26/T-27 (admin/participant/creator invite-section visibility). ORCH-0520 now has 7 deliverables (was 6), 19 success criteria (was 17), 27 test cases (was 24). Implementor prompt READY against patched spec: `prompts/IMPLEMENTATION_ORCH-0520_SESSION_MODAL_POLISH.md`. **Implementation COMPLETE 2026-04-19** — 13 files touched (3 created, 8 modified, 1 deleted, 29 locale renames), net -535 lines inside `components/board/` after modal deletion. Zero new TS errors (5 pre-existing in unrelated files unchanged). All 7 invariants have code evidence. Report: `outputs/IMPLEMENTATION_ORCH-0520_REPORT.md`. Deploy order: (1) `supabase db push`, (2) `supabase functions deploy notify-dispatch`, (3) commit + push, (4) EAS OTA iOS + Android. Orchestrator REVIEW verdict: **APPROVED**. 15/23 SCs verified at code level; 8 need device verification. **ORCH-0526 DROPPED** — implementor confirmed `BoardMemberManagementModal.tsx` imported by `BoardDiscussion.tsx` (not dead). Tester prompt: `prompts/TESTER_ORCH-0520_SESSION_MODAL_POLISH.md`. **Tester dispatch PAUSED 2026-04-19** — user device-tested v1 first and reported 3 UX bugs before formal test run: (B1) Invite button doesn't show live Mingla-user status — implementor scope miss; should have reused existing `usePhoneLookup` hook used by `CollaborationSessions.tsx:216` + `AddFriendView.tsx:121` instead of building generic button from scratch. (B2) Leave + Delete buttons shift with friend accordion expansion — should be fixed footer outside ScrollView. (B3) Pencil icon floats to far right due to `TextInput flex:1` layout — should hug the title text; also underline may not render prominently on iOS (solid orange fallback per spec OQ-1). Rework dispatch: `prompts/REWORK_ORCH-0520_V2_POLISH_FIXES.md`. Scope-tight — ONLY `BoardSettingsDropdown.tsx` touched. 8 new test cases (T-28 through T-35) appended to spec. **v2 IMPLEMENTATION COMPLETE 2026-04-19** — 2 files touched (`BoardSettingsDropdown.tsx` + `en/board.json`), +73/-35 lines, zero new TS errors. (B1) Wired `usePhoneLookup` + `useDebouncedValue` — live warm/cold visual now renders (green check + "is on Mingla" → "Invite {name}" button, gray icon + "Not on Mingla yet" → "Send SMS invite" button). (B2) `actionButtonsRow` moved outside ScrollView with border-top + `backgroundColor: white` — fixed footer. (B3) Removed `headerTitleSection` flex wrapper, added tight `titleAndPencil` wrapper with `maxWidth: 75%` + `headerSpacer` with `flex: 1`; replaced dashed border with solid orange (cross-platform reliable). v2 report: `outputs/IMPLEMENTATION_ORCH-0520_REPORT_v2.md`. Orchestrator REVIEW v2: **APPROVED** — one minor partial on T-31 (lookup network error live-row absent; user-level error still surfaces via Alert on tap — acceptable). Tester prompt patched with v2 target + T-28 through T-35 test cases. PASS threshold raised: ≥30 of 32 device tests must pass. **DEPLOY COMPLETE 2026-04-19**: migration `20260419000001` applied to remote DB; edge function `notify-dispatch` redeployed with SESSION_SCOPED_TYPES mute gate; mobile code committed + pushed to `Seth` branch (commit `d31cd499`, 41 files, +1308/-821); EAS OTA published iOS + Android. All infrastructure live. Awaiting user dispatch to tester for v2 against the OTA-updated device.
>
> **ORCH-0521 (NEW 2026-04-19 — side discovery from ORCH-0520, S2 dead-control — BUNDLED INTO ORCH-0520 by user decision 2026-04-19):** Session-level mute toggle at `SessionViewModal.tsx:166` is pure local `useState(true)` — zero persistence to DB, AsyncStorage, or OneSignal. Tapping "Turn Off Notifications" toggles a boolean that resets on modal open. Push notifications fire regardless. Constitutional #1 violation. Fix requires new session-level mute infrastructure (column on `session_participants` OR `session_mutes` table + OneSignal tag integration). **User chose Option A: fix persistence in the ORCH-0520 pass.** ORCH-0521 is now a tracking reference only; actual work is covered by the ORCH-0520 spec.
>
> **ORCH-0522 (NEW 2026-04-19 — side discovery from ORCH-0520, S3 design-debt):** `BoardSettingsDropdown.tsx` uses hard-coded hex colors instead of `app-mobile/src/constants/designSystem.ts` tokens. Pattern drift. Flag for design-system sweep; do not fix in ORCH-0520 pass.
>
> **ORCH-0523 (NEW 2026-04-19 — side discovery from ORCH-0520, S3 accessibility):** `BoardSettingsDropdown.tsx` has zero `accessibilityLabel`/`accessibilityRole`/`accessibilityHint`. Screen-reader users hear raw text. Flag for a11y sweep; do not fix in ORCH-0520 pass.
>
> **ORCH-0524 (NEW 2026-04-19 — side discovery from ORCH-0520, S2 silent-failure):** `useSessionManagement.ts:599–601` wraps `createPendingSessionInvite` in try/catch as "non-fatal" with console-only logging. At session creation, if pending-invite write fails, user gets no feedback. Constitutional #3 violation.
>
> **ORCH-0511 audit COMPLETE 2026-04-18 (HIGH confidence):** Vibe pipeline architecture audit returned. Live taxonomy is 10 cats (post-ORCH-0434 2026-04-15) but standalone script + categorizer skill still reference OLD 13-cat taxonomy → would corrupt place_pool if run. Iteration labelling EXISTS for edge-function path (ai_validation_jobs/batches/results, 19 jobs, 6,874 verdicts), MISSING for script + categorizer + price-tier skill paths. 3 writers compete on `place_pool.ai_*` columns with no ownership boundary. 0 vibe/taxonomy/run-version columns on place_pool. AIValidationPage admin UI fully shipped (3 tabs: Command Center, Pipeline, Review Queue) with 11 RPCs. 15 gaps enumerated for vibes as parallel track. Report: `outputs/INVESTIGATION_ORCH-0511_VIBE_PIPELINE_AUDIT.md`. ORCH-0511 vibe spec remains DEFERRED until unlock gate met; audit findings (0512–0517) ARE the path to that gate.

> **ORCH-0512 (NEW 2026-04-18 — telemetry regression):** `ai_validation_jobs.cost_usd = 0` AND `completed_batches = 0` for ALL jobs after 2026-04-14 despite jobs marked `status='completed'` and `processed = total_places`. Older jobs (pre-2026-04-14) had real cost_usd values ($0.92–$1.65) and incrementing batch counters. Counter-update + cost-tracking both silently broken in the `run_batch` action of `ai-verify-pipeline` edge function. Constitutional #3 violation. Admin "Recent Runs" table now displays $0.00 cost for all real validation work. S2 process-debt / observability. Bundle into next AIValidationPage commit. Discovered by ORCH-0511 forensic audit §3.8.

> **ORCH-0513 (NEW 2026-04-18 — orphan table):** Live DB has `card_pool_categories_backup_0434` table that ORCH-0434 Phase 9 cleanup migration `20260415200000_orch0434_phase9_cleanup.sql` lines 339-341 attempted to DROP. Sibling backup tables (`preferences_backup_0434`, `place_pool_ai_categories_backup_0434`, `board_session_preferences_backup_0434`) were dropped successfully. This one survived — likely manual restore or migration idempotency issue. S3 cleanup. Single `DROP TABLE` migration. Discovered by ORCH-0511 forensic audit §5 C9.

> **ORCH-0514 (NEW 2026-04-18 — taxonomy drift landmine, S1):** `scripts/verify-places-pipeline.mjs` (1112 lines) and `.claude/skills/mingla-categorizer/SKILL.md` + `references/category-mapping.md` (v3) BOTH still reference the OLD 13-category taxonomy (casual_eats, fine_dining, first_meet, drink, watch, live_performance, nature_views, picnic_park, wellness). Live taxonomy is 10 cats, locked in by ORCH-0434 Phase 1 migration `20260415100000` on 2026-04-15. Either system, if invoked today, would silently write obsolete slugs into `place_pool.ai_categories` that no longer normalize in `query_pool_cards` RPC (latest at migration `20260416100000_orch0443_fix_category_slug_mismatch.sql`) — affected places would silently disappear from decks. Live data confirms ZERO rows currently have old slugs (good — neither has been run since 2026-04-15). The categorizer skill's user-facing trigger phrases ("categorize places", "recategorize") could be invoked by user at any time. Promoted from S2 to **S1** because it directly blocks ORCH-0511 unlock gate condition #1 (mingla-categorizer at grade A). Classification: architecture-flaw + ux + documentation-drift. Two fix options: (a) deprecate both, OR (b) update both to 10-cat taxonomy AND route through `ai-verify-pipeline` edge function so writes populate `ai_validation_results`. Discovered by ORCH-0511 forensic audit §3.1 + §3.3.

> **ORCH-0515 (NEW 2026-04-18 — coverage gap):** `mingla-price-tiers` skill has not been swept across the full pool. Only 27,135 of 41,682 approved places (65%) have `price_tiers` assigned. Remaining 14,547 approved places fall into either NULL price_tier (no Google price_level data + skill never ran for that primary_type) or stale assignments. S2 coverage-gap. Single full sweep of the skill closes it. Not blocking for ORCH-0511 vibes work, but should be fixed before vibe filtering depends on price tier as a secondary filter. Discovered by ORCH-0511 forensic audit §3.4 + §3.8.

> **ORCH-0516 (NEW 2026-04-18 — historical coverage gap):** Only 6,874 rows in `ai_validation_results` despite 58,735 places having `ai_validated_at IS NOT NULL` — ~12% history coverage. Older verdicts (pre-2026-04-09) and any script/skill writes are not auditable: no `previous_categories`, no `evidence`, no `cost_usd`, no `job_id`. Reconstructible only from `outputs/pipeline_results.jsonl` if those files still exist on disk. S2 coverage-gap. Going forward: tighten by ensuring ALL writers (currently 3) route through the edge function. Backfill is optional. Vibes pipeline must establish 100% history coverage from day 1 to avoid repeating this hole. Discovered by ORCH-0511 forensic audit §4 + §3.8.

> **ORCH-0517 (NEW 2026-04-18 — feature usage gap):** `admin_ai_override_place` RPC and the AIValidationPage Review Queue side-panel override controls have been used 0 times in production. Override count = 0 across all 6,874 result rows. Either (a) the review queue isn't surfacing high-value rows to admins, (b) admins are not engaging with the queue, OR (c) confidence scores are well-calibrated and overrides are genuinely rare. UX investigation needed before vibes ship a parallel review queue — same risk applies. S3 ux/observability. Discovered by ORCH-0511 forensic audit §3.8.

> **ORCH-0490 Phase 2.4 CLOSED 2026-04-18 (structurally satisfied, no code change):** Verification AH-147 proved all 5 DEC-025 requirements already hold post-commit `841d9fb7`. R1–R3 + R5 ✅ HOLDS (HIGH confidence, six-field evidence per requirement). R4 (cold launch = fresh) is DEGENERATE — code treats cold launch as resumption (consistent with ORCH-0492 goals); needs user clarification on "session over = app closed" vs "session over = prefs changed" intent. DEC-029 logged. Master spec `SPEC_ORCH-0490_DECK_RELIABILITY_AND_PERSISTENCE.md` Phase 2.4 section marked SUPERSEDED (doc drift). Side discoveries: **ORCH-0518** (dual rejection persistence keys — Constitutional #2 mild drift, S3). Phase 2.4 is DONE. Phase 2.5 (session persistence) is the next ORCH-0490 program action OR orchestrator closes out ORCH-0490 entirely and moves to next Priority Board top item. Report: `outputs/INVESTIGATION_ORCH-0490_PHASE_2.4_CONTEXT_SCOPED_DEDUP.md`.

> **ORCH-0519 (NEW 2026-04-19 — admin error UX failure, S2):** Revoked admin (status='revoked' in `admin_users`) sees broken AIValidationPage with cryptic console errors instead of a clean "Access revoked" page. Reproducer: log into admin panel with a revoked admin account → AIValidationPage loads → `admin_ai_city_category_coverage` RPC returns HTTP 500 (RAISE 'Admin access required' propagated as 500 by PostgREST) and every `ai-verify-pipeline` edge function call returns 401/403. Root cause: every admin-gated RPC raises an exception (PostgREST converts to 500) and the edge function returns 403 (which the supabase-js SDK may surface as 401 to the browser). Constitutional #3 violation (no silent failures — errors must surface meaningfully). Discovered 2026-04-19 via user report — `sethogieva@gmail.com` is revoked, only `seth@usemingla.com` is active. Fix direction (TBD): (a) frontend wraps all admin RPCs/edge fn calls and routes 403/500-with-Admin-message to a dedicated AccessRevokedPage; (b) RPCs return JSON `{error: 'admin_revoked'}` instead of RAISE; (c) login flow checks admin_users.status before granting admin shell. S2 admin-UX. Bundle with future admin-shell hardening or address standalone.

> **ORCH-0518 (NEW 2026-04-18 — Constitutional #2 mild drift):** Two distinct AsyncStorage mechanisms track conceptually-similar "rejected" cards: `mingla_card_state_${mode}_${refreshKey}_removed` (SwipeableCards' `removedCards` Set — swipe-left rejections, mode+refreshKey-scoped) and `dismissed_cards_${user.id}_${currentMode}` (RecommendationsContext's `dismissedCards` — dismissed-sheet actions, user+mode-scoped). Different keying conventions for related concepts → "one owner per truth" drift. Not causing any observable bug today — they track different actions (swipe vs dismiss) so pair is functionally correct. Low-severity tech debt. Consolidate into a single per-context rejection store in Phase 2.5 OR a standalone cleanup sweep. Classification: architecture-flaw (minor) / documentation-drift. S3. Discovered by AH-147 forensics verification §6 OBS-2.4-3.

> **ORCH-0503 CLOSED A 2026-04-18 — v3 fix shipped:** Mixed-deck partial→final ordering. AH-145 implementor collapsed the 3-way growing branch into a single `const merged = deckCards` adoption line at `RecommendationsContext.tsx:1118`. Root cause was provider-side branch selection on a 2-fire React Query observer-batched notification pattern — not cache corruption, not timing. User device retest 6/6 PASS: T-01 mixed-deck interleaves correctly at top; T-03 ORCH-0498 mid-swipe preservation held; T-13 runtime guard silent on happy path; T-04, T-05, T-06 single-pill + 3-pill mix all correct. 28-line protective comment cites AH-143 investigation. `__DEV__` runtime guard loudly fires `console.error` if any future edit reintroduces merged[0..3] ≠ deckCards[0..3] divergence. New invariant `I-PROGRESSIVE-DELIVERY-INTERLEAVE-AUTHORITATIVE` registered in INVARIANT_REGISTRY.md. Solo+collab parity inherited via outer `isSoloMode||isCollaborationMode` guard. TS compile clean (5 pre-existing, 0 new). Flag-off legacy branch byte-stable. Reports: AH-143 investigation (`outputs/INVESTIGATION_ORCH-0503_GROWING_BRANCH_INTERLEAVE_LOSS.md`), AH-144 spec (`outputs/SPEC_ORCH-0503_v3_INTERLEAVE_PRESERVATION.md`), AH-145 impl (`outputs/IMPLEMENTATION_ORCH-0503_v3_INTERLEAVE_PRESERVATION_REPORT.md`). Grade A. Commit + two-platform OTA pending user action.

> **ORCH-0511 (DEFERRED program charter — chartered 2026-04-18):** Vibes-Future — replace the 13-category taxonomy with a 20-vibe taxonomy as the primary discovery signal. **Vision:** cross-category marketplace positioning — "The fastest way to pick a place that feels right for whoever you're with" — supporting friend groups, couples, serial daters, and new-city movers as one audience under one job. **Taxonomy (v0.3, 20 vibes across 7 dimensions):** Mood & Energy (Romantic, Sexy, Cozy, Lively, Chill, Upscale); Time & Meal (Brunch, Dinner, Late-Night); Setting (Rooftop, Nature); Activity (Creative, Theatre & Arts, Movies, Play); Social Shape (First Meet, Solo-Welcoming); Discovery & Signal (Hidden Gem, Iconic); Flavor (Boozy). 10 universal vibes form the minimum viable ship list. **Source docs:** `Mingla_Artifacts/vibe-engine/Vibes.md` (taxonomy) + `Mingla_Artifacts/vibe-engine/chatconvo.md` (strategic reasoning with GPT-4, positioning, marketplace thesis, AI implementation plan). **Unlock gate (three conditions, ALL required):** (1) mingla-categorizer producing stable output across all ~60k active places with grade A in Launch Readiness Tracker AND admin categorization UI trusted/signed-off; (2) live user signal proving category filter drives swipe/save/schedule rates (≥4 weeks production telemetry); (3) AI system upgrade to be more granular and pedantic — multi-label scoring with reason strings, multimodal (text + images), sampled human QA loop, structured JSON output per Vibes.md open-question decisions. **Implementation scope when unlocked:** taxonomy finalization → AI labeling pipeline (50 places → 500 → 5k → full 60k per chatconvo.md Phase 1–4) → Supabase schema (`vibe_scores` JSONB + `vibe_reasons` JSONB + pgvector embeddings) → product surfaces (filter UI, card tags, deck ranking) → category deprecation sequence. **Do not dispatch investigation or spec until user flips unlock flag.** Classification: strategic-initiative / architecture-flaw (replaces primary taxonomy) / ux (changes core discovery). S1 strategic. No launch blocker — post-launch program.

> **ORCH-0503 — see CLOSED A entry at top.** (Historical context preserved above for audit trail; v3 fix landed 2026-04-18.)

> **ORCH-0510 (NEW 2026-04-18 — observability gap):** Two silent catch blocks in `RecommendationsContext.tsx`: line **263** (`} catch {}` on cold-start persisted-deck-key read — swallows any AsyncStorage/JSON parse failure, persisted key silently ignored) and line **336** (`} catch {}` on dismissed-cards JSON.parse — malformed storage entry → dismissed cards silently reset to empty). Not causal to ORCH-0503, but they hide observability for any future persistence regression in this same provider. Constitutional #3 violation (no silent failures). S3 observability debt. Replace with `catch (e) { if (__DEV__) console.warn('[Deck] persisted-key read failed', e); }` pattern used elsewhere in this file. Discovered by independent cross-verification of ORCH-0503. Bundle into next RecommendationsContext-touching commit OR defer to Phase 4 lock-in.
>
> **ORCH-0504 (NEW 2026-04-19 very late):** Solo cold-launch deck resume resets to card 0. User report: "in solo mode, closing the app and resuming resets deck to first card." Possible causes (investigator must prove): (a) AsyncStorage key mismatch — `mingla_card_state_${mode}_${refreshKey}_index|_removed` — if `refreshKey` differs across sessions, keys don't match, restore fails; (b) regression from Phase 2.3 flag-gated `modeChanged` wipe interaction with my RESTORE effect timing on initial mount; (c) DeckStateRegistry in-memory-only + Phase 2.5 Zustand-persist deferral exposes the gap explicitly now that registry is authoritative for swipe state under flag-on. S1. Adjacent to ORCH-0499 (mode/session not persisted) but distinct symptom. Classification: regression OR pre-existing bug exposed by Phase 2.3 (TBD by forensics).
>
> **ORCH-0505 (NEW 2026-04-19 very late):** Collab `WAITING_FOR_PARTICIPANTS` lying state flashes on session entry even when ≥2 accepted participants exist. User report: "sometimes there is a waiting for friends to join lying state that shows briefly before the deck loads. It lies because there are friends." Hypothesis (investigator confirms or denies): race between `hasCompletedFetchForCurrentMode` flipping true and `allParticipantPrefs` loading. The deckUIState selector at `RecommendationsContext.tsx:1217-1223` checks `acceptedCount = allParticipantPrefs?.length ?? 0` — when `allParticipantPrefs` is null (still loading), falls through to WAITING. Classification: lying-state / Constitutional #3 adjacent (surface falsehood). S1. Likely pre-existing, not a Phase 2.3 regression.
>
> **ORCH-0506 (2026-04-19 very late):** User clarified ORCH-0503 is NOT about tab switching — pure partial-delivery ordering bug. Merged into ORCH-0503 scope (same root). No separate ID needed; closing.
>
> **ORCH-0507 (NEW 2026-04-19 very late):** ORCH-0505 cluster extensions from second research session cross-validation. Three distinct sub-issues, all found in RecommendationsContext.tsx: (a) **generic completion-effect race at line 1346** — "Mark Fetch Complete" effect can flip `hasCompletedFetchForCurrentMode = true` BEFORE `useBoardSession.loadSession` populates `allParticipantPreferences`; this is a SECOND source of the premature-complete problem independent of CF-2.3-4 flag-gate; (b) **semantic bug in WAITING check at line 1557** — `allParticipantPrefs?.length ?? 0 < 2` conflates "data not loaded" (null → 0) with "not enough accepted participants" (actual count); should use a loading-vs-count-based distinction; (c) **dead `WAITING_FOR_PREFERENCES` state** — declared in DeckUIState union at RecommendationsContext.tsx:52, rendered at SwipeableCards.tsx:1936, never returned by the selector. Unreachable code path. S1 (a+b), S3 (c). Bundled with ORCH-0505 in the same spec cycle. Forensics cross-validation: yes — second research session independently confirmed all 3 primary root causes (0503/0504/0505) AND surfaced these three extensions my AH-140 investigation missed.
>
> **ORCH-0508 (NEW 2026-04-19 very late — process observation):** Zero automated test coverage around `RecommendationsContext` / `SwipeableCards` / `useDeckCards` exposed by the Phase 2.3 cycle-3+ regression pattern. Unit tests on the sync-effect change-detection guard + deckUIState selector would have caught ORCH-0503 + ORCH-0505 before device. Not a product bug; a test-infrastructure gap. S2 process-debt. Flag for Phase 4 lock-in or dedicated test-coverage phase after Phase 2.3 lands.
>
> **ORCH-0509 (NEW 2026-04-19 very late — process observation):** Both Phase 2.2 + Phase 2.3 feature flags default to `__DEV__`, so dev builds ONLY exercise the flag-on path. No dev-time A/B visibility to catch regressions in the flag-off fallback. Every flag-off regression shipped to prod would be undetected until prod telemetry. Recommend a rotating/randomized flag state in dev OR a dedicated flag-off QA matrix in tester dispatches. S3 process-debt. Flag for Phase 4 lock-in.
>
> **Phase 2.3 CLOSURES (2026-04-19 late):**
> - **ORCH-0491 CLOSED:** Solo↔Collab toggle losing position. Root-cause fix: per-context DeckStateRegistry holds one DeckState per `(mode, sessionId)` tuple. Mode toggle swaps the active-context pointer — never wipes. SwipeableCards' swipe state (removedCards + currentCardIndex) is mirrored into the registry on change and restored from it on context change. Three wipe vectors all blocked under flag-on: (1) `checkAndRestoreState` modeChanged branch gated off, (2) expansion effect context-change guard early-returns before locking wrong-context IDs, (3) RESTORE effect sets `previousCardIdsSetRef = Set()` so next render INIT-branches. User device retest 2026-04-19 PASSED on DEV build.
> - **ORCH-0498 CLOSED:** Mixed-deck progressive-delivery double-wipe on solo pref change. Root-cause fix: SwipeableCards' strict-superset check detects progressive-delivery partial→final as EXPANSION (final's ID set is a superset of partial's) and suppresses wipe. User device retest confirmed mid-swipe preservation through partial→curated merge.
> - **ORCH-0493 RC#1 PARTIAL:** Collab mid-swipe wipe on incoming pref change. Superset subset closed by same expansion-signal mechanism. Non-superset case (large aggregated-prefs change producing substantively different deck) awaits Phase 2.6 which will set `isDeckExpandingWithinContext=true` on realtime pref propagation. **Do not mark fully closed until Phase 2.6 ships.**
> - **3 new invariants ESTABLISHED:** `I-PROGRESSIVE-DELIVERY-EXPANSION-NOT-REPLACEMENT` (every partial→final transition is EXPANSION — strict-superset check), `I-COLLAB-LIVE-POSITION-STABLE` (partial — Phase 2.6 completes), `I-PER-CONTEXT-DECK-STATE` (registry holds one DeckState per context; toggle swaps pointer never wipes).
> - **Ship posture:** FEATURE_FLAG_PER_CONTEXT_DECK_STATE = `__DEV__` — prod ships dark. Kill switch = flip to `false` + OTA. Coupled-exit with FEATURE_FLAG_PROGRESSIVE_DELIVERY — both flip to unconditional `true` after 1wk clean telemetry.

> **ORCH-0501 (NEW 2026-04-19):** Deck prefetch key factory at `RecommendationsContext.tsx:761-773` (inside `handleDeckCardProgress`) omits the Phase 2.3 `mode` + `sessionId` discriminants. Under FEATURE_FLAG_PER_CONTEXT_DECK_STATE=true, prefetched data lands under a mismatched key → wasted cache write, hook reads miss. Not a correctness bug (next-page fetch still works when the real boundary is crossed — just no prefetch acceleration). S3 perf/UX minor. Fix at flag-exit commit OR bundle into Phase 2.5 prefetch-persistence rework. Discovered by implementor during Phase 2.3. `implementation/IMPLEMENTATION_ORCH-0490_PHASE_2.3_PER_CONTEXT_DECK_STATE_REPORT.md §15`.
>
> **ORCH-0502 (NEW 2026-04-19):** Shared `batchSeed` provider state is NOT per-context under Phase 2.3 despite DeckStateRegistry's DeckState type having a `batchSeed` field. On context toggle (Solo↔Collab), the shared state doesn't track the new context's pagination cursor. The registry mirrors `batchSeed` but the provider's shared React state is the actual driver passed to `useDeckCards`. Subtle impact: resuming a collab session that was on batch 2 may refetch batch 0 until pagination catches up. S3. Fix at flag-exit commit OR Phase 2.5 (which reworks pagination/persistence). Discovered by implementor. `implementation/IMPLEMENTATION_ORCH-0490_PHASE_2.3_PER_CONTEXT_DECK_STATE_REPORT.md §15 #2`.

> **Phase 2.2 CLOSURES (2026-04-19):**
> - **ORCH-0485 RC#2 closed:** `deckService.fetchDeck` no longer hardcodes singles-first. `Promise.race([singlesRacer, curatedRacer])` now lets curated win when it resolves first (cold-isolate / slow-singles scenarios). `useDeckCards.onPartialReady` callback signature changed from `(cards) => void` to `(cards, {source}) => void`; cache merges via `mergeCardsByIdPreservingOrder` preserving existing positions.
> - **ORCH-0485 RC#3 closed:** Zero-singles no longer skips `onSinglesReady`. When singles settles with `value:[]`, the race path awaits curated's actual settle time (not the 20s ceiling), then fires `deliverCuratedPartial`. Zero-singles + non-empty-curated now delivers at curated's resolution time. New invariants `I-PROGRESSIVE-DELIVERY-FIRST-WIN` + `I-ZERO-SINGLES-NOT-20S-WAIT` established.
> - **ORCH-0486 closed:** mixed-deck serverPath carry-through — when singles rejects with tagged `DeckFetchError` (auth-required / pipeline-error) and curated succeeds, final return's `serverPath` carries singles' discriminant. Previously leaked `'pipeline'` default. Fix at `deckService.ts:612-618`. INV-042 + INV-043 preserved.
> - **Ship posture:** code shipped, production gated via `FEATURE_FLAG_PROGRESSIVE_DELIVERY` (defaults to `__DEV__`, so prod runs sequential-await fallback until 1-week clean telemetry). DEV builds get race path immediately. Rollback = flip constant to `false` + OTA. QA: `outputs/QA_ORCH-0490_PHASE_2.2_PROGRESSIVE_DELIVERY_REPORT.md` (0 P0/P1/P2/P3, 2 P4 doc-nits). Phase 2.3 (per-context deck state + ORCH-0498 double-wipe closure) is next.
>
> **ORCH-0494 CLOSED A (2026-04-18):** False EMPTY race eliminated via Phase 2.1. 20s safety timer + `hasStartedRef` deleted. EMPTY branch rewritten to require server verdict (`soloServerPath === 'pool-empty'` or `isDeckBatchLoaded && !deckHasMore`). `trackDeckEmptyFilter` analytic gated on `serverPath === 'pool-empty'` only (expected 60-90% event volume drop — product team notified). New invariant `I-DECK-EMPTY-IS-SERVER-VERDICT` established. QA: `outputs/QA_ORCH-0490_PHASE_2.1_DECOUPLE_LOCATION_REPORT.md` (CONDITIONAL PASS, 0 P0/P1/P2/P3).
>
> **ORCH-0485 RC#1 closed (2026-04-18):** `refreshKey` removed from `useUserLocation.ts:152` query key. Location only invalidates on location-field changes. New invariant `I-LOCATION-INVALIDATE-ON-LOCATION-ONLY` established. DiscoverScreen.tsx:709 mirror also fixed. RC#2 (singles-first hardcoded) + RC#3 (zero-singles skip) remain open for ORCH-0490 Phase 2.2.
>
> **ORCH-0490 Phase 0 COMPLETE (2026-04-18):** All three verification investigations returned APPROVED. Phase 0-A amendment §12 (device trace — code-side only; new RC#4 → ORCH-0498). Phase 0-C (collab pressure — ⚠️ PARTIAL; Phase 2.6 scope CONFIRMED). Phase 0-B baseline (persistence — 3 RCs proven, `outputs/INVESTIGATION_ORCH-0492_PERSISTENCE_BASELINE.md`; JTBD-3 broken by three specific code sites, charter §4 "no persistence" assumption proven 50% wrong). **Total findings across Phase 0: 5 🔴 root causes + 2 🟠 contributing + 8 🟡 hidden flaws + 9 🔵 observations.** Net new ORCH-IDs registered: 0496, 0497, 0498, 0499, 0500. Phase 1 spec now fully unblocked — can be written from code-level evidence alone; device timings flow in as Phase 2 tester acceptance inputs.
>
> **ORCH-0499 (NEW 2026-04-18):** `currentMode` + `currentSession` not persisted across cold launch. Zustand partialize at `appStore.ts:206-216` intentionally excludes them (ORCH-0209-era design). User always lands in Solo on cold launch. Third of three code sites blocking JTBD-3. S1.
>
> **ORCH-0500 (NEW 2026-04-18):** Dead RQ cache entries accumulate in `REACT_QUERY_OFFLINE_CACHE` after pref changes — old-deckPrefsHash entries persist under old keys. S3, not critical until 1.5MB Android cap hit.
>
> **ORCH-0498 (NEW 2026-04-18):** Mixed-deck progressive-delivery double-wipe on solo pref change. Solo analog of ORCH-0493 RC#1. Discovered via Phase 0-A code-verification amendment in `outputs/INVESTIGATION_ORCH-0485_DECK_PREF_CHANGE_LATENCY.md` §12.2. Every solo user with ≥1 category + ≥1 curated pill experiences TWO wipes on pref change: once when singles land (expected), once when the 1:1-interleaved full result overwrites (unintended). Both wipes driven by `SwipeableCards.tsx:979-980` first-5-IDs check — same mechanism as ORCH-0493 RC#1. S1. H on code mechanism, M on user-visible outcome. Absorb into ORCH-0490 Phase 2.3 or dedicated slice.
>
> **ORCH-0493 (VERIFIED ⚠️ PARTIAL 2026-04-18):** Phase 0-C collab-pressure verification complete `outputs/INVESTIGATION_ORCH-0493_COLLAB_PRESSURE_VERIFICATION.md`. User's claim "changes in background, shown in next card" — background part ✅ TRUE (placeholderData + isDeckPlaceholder guard prevent skeleton), but "next card" part ❌ FALSE — when new deck lands on mid-swipe participant, `SwipeableCards.tsx:979-980` + `RecommendationsContext.tsx:836` wipe position + dedup. Phase 2.6 of ORCH-0490 now **CONFIRMED ON** (not conditional). S1-S6 scenarios: S1✅ baseline, S2✅ (idle), S3⚠️ (mid-swipe wiped), S4✅ (w/ 2× fetch), S5✅ (leave cleans JSONB), S6✅ (no role difference). Constitutional #13 violated. Side discoveries **ORCH-0496** (4 zombie realtime/cache sites from incomplete ORCH-0446 cleanup — S3) + **ORCH-0497** (author-device triple-write on updatePreferences — S3, benign, defer) registered.
>
> **ORCH-0490 (chartered 2026-04-17 late):** Deck reliability & session persistence program chartered — bundles ORCH-0485 (pref-change latency, already registered) + **ORCH-0491** (solo↔collab mode switch progress loss + skeleton) + **ORCH-0492** (session persistence across app close + mode switch) + **ORCH-0493** (collab multi-participant pref-change pressure — verification required before scope grows) + **ORCH-0494** (false EMPTY race / polluted `trackDeckEmptyFilter` analytics) + **ORCH-0495** (client warm-ping of discover-cards — renumbered from colliding ORCH-0488). Charter: `outputs/PROGRAM_ORCH-0490_DECK_RELIABILITY_AND_PERSISTENCE.md`. 4-phase pipeline: Phase 0 (3 investigator verifications) → Phase 1 (bundled spec) → Phase 2 (six phased implementor/tester slices 2.1–2.6) → Phase 3 (full regression) → Phase 4 (lock-in). User-aligned: "clean, not big rewrites, methodical, rigorous testing, spell checks, regression tests." Phase 0 dispatches next.
>
> **ORCH-0481 + 0480 status corrected 2026-04-18:** User confirmed Mingla-dev IS the production Supabase project. All 4 migrations already live in prod. **ORCH-0480 CLOSED A** — original user-reported 500 errors on admin Place Pool page are RESOLVED by ORCH-0481's MV layer (live on prod: admin_place_country_overview 87ms hot, pool_overview ~400ms, category_breakdown 107ms; all under 8s timeout). **ORCH-0481 partially shipped D** — query layer works, but pg_cron auto-refresh remains inoperative (jobid=13 never fires; Constitutional #3 silent-failure residual; 3-cycle stuck-in-loop per DEC-023). Path forward: ORCH-0489 (admin-UI "Refresh Stats" button calling `admin_refresh_place_pool_mv()`) — user-chosen Alternative 1. Prompt at `prompts/IMPL_ORCH-0489_ADMIN_REFRESH_BUTTON.md`. On ORCH-0489 close → ORCH-0481 promotes D→A.
> Recently closed (2026-04-17): **ORCH-0474** (discover-cards fall-through split — QA retest cycle 1 PASS, Grade B, INV-042 + INV-043 locked in; constitutional #3 + #9 restored; deployed discover-cards v118 `ezbr_sha256: 3cf3ae84…`; T-06 empirically validated `auth-required` path on live edge fn), **ORCH-0469** (brunch/lunch/casual cache poisoning + EMPTY vs EXHAUSTED split — QA retest cycle #1 PASS 6/6, Grade B, I-EMPTY-CACHE-NONPERSIST invariant established), **ORCH-0472** (jointly closed with ORCH-0469), **ORCH-0460** (place pipeline accuracy overhaul — QA retest PASS 11/11 SC), ORCH-0461 (casual_eats 50-type split), ORCH-0462 (Upscale & Fine Dining expansion), ORCH-0463 (garden store flowers leak — FLOWERS_BLOCKED_TYPES split primary/secondary, live SQL: 180→11 strips, 139 supermarkets preserved), ORCH-0464 (venue name keyword sync), ORCH-0465 (brunch-restaurants-only), ORCH-0471 (mutual exclusivity upscale↔casual REMOVED — supersedes ORCH-0428), ORCH-0477 (invariant #13 drift — constitutional #13 restored FAIL→PASS)
> Previously closed: ORCH-0431 (deck loading skeleton on pref change — QA PASS 16/16), ORCH-0419 (real-time data stack: Mapbox + Open-Meteo + venue heuristic — QA PASS 17/17), ORCH-0250, ORCH-0251
> Recently added: **ORCH-0486** (mixed-deck serverPath silently absorbed when category fetch fails but curated succeeds — P3, ~3-line fix in deckService.fetchDeck; discovered by tester in ORCH-0474 cycle 0), **ORCH-0485** (deck cards take >1s after pref change — S1 perceived-latency perf, investigator queued), **ORCH-0480** (admin Place Pool RPC timeouts — S1, implementation delivered), **ORCH-0481** (admin RPC MV layer — S1, systemic fix ready to dispatch), **ORCH-0482** (admin analytics RPCs will fail at scale — S2, pre-emptive), **ORCH-0483** (admin RPC perf gate — S2 process rule), **ORCH-0484** (776 approved places with NULL ai_categories — S2 data integrity, discovered via ORCH-0480 D-2), **ORCH-0474** — CLOSED Grade B 2026-04-17 (see Recently Closed header row above), **ORCH-0475** (filter-outline icon name unknown to app — S3, side effect of ORCH-0472 UI split), ORCH-0476 (category-mapping.md stale — doc debt), ORCH-0478 (pre-flight pool-impact dry-run — S2, high-value guardrail), ORCH-0479 (TopGolf non-idempotent classification — S3), ORCH-0470 (generate-single-cards seeding-ID vs app-slug mismatch — awaiting spec dispatch), ORCH-0473 (dead-code TS errors in RecommendationsContext — implementor discovery, not urgent), ORCH-0466 (admin-seed-places create_run 500 regression — fixed, pending smoke), ORCH-0467 (edge-function deploy pipeline lacks type-check gate), ORCH-0468 (admin-seed-places duplicated batch logic — tech debt)
> ID correction 2026-04-17 (first): UX EMPTY/EXHAUSTED split was mis-registered as ORCH-0471 (collision with pre-existing Place-Pipeline ORCH-0471 at line 478 of WORLD_MAP). Corrected to ORCH-0472. TS-debt discovery shifted to ORCH-0473.
> ID correction 2026-04-17 (second): Place-pipeline side discoveries initially took 0472/0473/0474/0475, colliding with UX session's prior 0472/0473 allocation. Renumbered to 0476 (category-mapping.md stale), 0477 (invariant #13 drift — closed), 0478 (pre-flight dry-run), 0479 (TopGolf). QA/implementation reports for ORCH-0460 retain the original IDs as historical artifacts; the WORLD_MAP entries carry the new canonical IDs with cross-references.
> Previously closed: ORCH-0402 (calendar button visibility + birthday push notifications — QA PASS 17/17)

## Summary by Status

| Status | Count | % |
|--------|-------|---|
| Open (F grade, unaudited) | 123 | 41% |
| Open (F grade, known bug) | 7 | 2% |
| Open (F grade, missing-feature) | 1 | <1% |
| Open (F grade, quality-gap) | 2 | <1% |
| Open (D grade, quality-gap) | 2 | <1% |
| Closed (A grade) | 90 | 30% |
| Verified (B grade) | 16 | 5% |
| Verified (C grade) | 1 | <1% |
| Deferred | 1 | <1% |

## Summary by Severity

| Severity | Open | Closed/Verified | Total |
|----------|------|-----------------|-------|
| S0 (Critical) | 3 | 11 | 14 |
| S1 (High) | 50 | 45 | 95 |
| S2 (Medium) | 64 | 38 | 102 |
| S3 (Low) | 18 | 12 | 30 |

## Active Issues (Open — Grade F)

### S0-Critical (Launch Blockers)

| ID | Title | Surface | Classification | Source |
|----|-------|---------|---------------|--------|
| ORCH-0066 | Collab mode parity (Phase 1 CLOSED — 5 sub-issues fixed, ORCH-0316 remains for Phase 2) | Collaboration | architecture-flaw | Closed → B |
| ORCH-0336 | App stuck in loading after long iOS background (hours/days) | App Lifecycle | architecture-flaw | User report (production) |
| ORCH-0362 | Reporting a user from the map does nothing — report not saved, account not flagged | Moderation | bug | User report 2026-04-10 |
| ORCH-0364 | Admin reports tab shows no reports — moderation pipeline end-to-end broken | Moderation | bug | User report 2026-04-10 |
| ORCH-0102 | Account deletion | Profile | unaudited | Tracker |
| ORCH-0135 | Paywall screen | Payments | unaudited | Tracker |
| ORCH-0137 | RevenueCat integration | Payments | unaudited | Tracker |
| ORCH-0317 | Collab time_slot + normalizer (CLOSED) | Collaboration | bug | Closed → A |
| ORCH-0318 | Travel aggregation UNION (CLOSED) | Collaboration | bug | Closed → A |

### S1-High (Degrades Critical Flow)

| ID | Title | Surface | Classification | Source |
|----|-------|---------|---------------|--------|
| ORCH-0337 | Realtime event handlers silently cleared after disconnect/connect — all live updates dead until force-close | App Lifecycle | architecture-flaw | INV-010 (SDK-proven, RealtimeChannel.js:313) |
| ORCH-0404 | Realtime update audit — pair request acceptance doesn't update sender + systemic audit of all two-party realtime gaps | Pairing + Cross-cutting | architecture-flaw | User report 2026-04-13 |
| ORCH-0406 | Price tier labels wrong/hardcoded on expanded single card view + full card view audit | Discovery | bug | User report 2026-04-13 |
| ORCH-0407 | Push notifications fundamentally broken across systems — full OneSignal pipeline audit | Notifications | architecture-flaw | User report 2026-04-13 |
| ORCH-0409 | Map avatars intermittently disappear — possible ORCH-0385 regression | Map | regression | User report 2026-04-13 |
| ORCH-0410 | Android discover map fundamentally broken — pan/scroll, labels, not fluid like iOS | Map | architecture-flaw | User report 2026-04-13 |
| ORCH-0429 | Android map markers (avatars + places) rendering as lines — bitmap regression | Map | regression | User report 2026-04-14 |
| ORCH-0431 | Deck stuck on exhausted/empty screen after preference change — no loading skeleton | Discovery | bug | Closed → A |
| ORCH-0411 | Paired friend can't see my liked places — asymmetric visibility | Pairing | bug | User report 2026-04-13 |
| ORCH-0363 | Report modal from friend list opens too late — user navigates away before modal appears | Moderation | ux | User report 2026-04-10 |
| ORCH-0338 | React Query retry:1 wastes budget on 401s — auth-aware retry needed | State & Cache | quality-gap | INV-009 discovery |
| ORCH-0352 | Beta feedback modal — end-to-end defects (CLOSED) | Profile | bug | Closed → A |
| ORCH-0008 | State machine progression | Onboarding | unaudited | Tracker |
| ORCH-0009 | GPS requirement enforcement | Onboarding | unaudited | Tracker |
| ORCH-0316 | Dead CollaborationPreferences.tsx deleted (CLOSED) | Collaboration | architecture-flaw | Closed → A |
| ORCH-0319 | Location fallback divergence (CLOSED) | Collaboration | bug | Closed → A |
| ORCH-0320 | Legacy time_of_day / time_slot (CLOSED) | Collaboration | bug | Closed → A |
| ORCH-0011 | Resume after interruption | Onboarding | unaudited | Tracker |
| ORCH-0014 | Intent selection step | Onboarding | unaudited | Tracker |
| ORCH-0017 | Consent step | Onboarding | unaudited | Tracker |
| ORCH-0039 | Currency changes with GPS | Discovery | bug | Investigation |
| ORCH-0041 | Curated no Schedule button | Discovery | bug | Investigation |
| ORCH-0070 | Session creation | Collaboration | unaudited | Tracker |
| ORCH-0071 | Invite send/receive | Collaboration | unaudited | Tracker |
| ORCH-0072 | Real-time sync | Collaboration | unaudited | Tracker |
| ORCH-0073 | Voting mechanics | Collaboration | unaudited | Tracker |
| ORCH-0075 | Concurrent mutation safety | Collaboration | unaudited | Tracker |
| ORCH-0079 | Friend-based content visibility | Social | unaudited | Tracker |
| ORCH-0087 | In-app notifications | Notifications | unaudited | Tracker |
| ORCH-0094 | Save/unsave experience | Saved | unaudited | Tracker |
| ORCH-0095 | Board create/edit/delete | Saved | unaudited | Tracker |
| ORCH-0105 | Subscription management | Profile | unaudited | Tracker |
| ORCH-0111 | Map rendering (dual provider) | Map | unaudited | Tracker |
| ORCH-0112 | User location tracking | Map | unaudited | Tracker |
| ORCH-0114 | Nearby people display | Map | unaudited | Tracker |
| ORCH-0126 | Discover map integration | Map | unaudited | Tracker |
| ORCH-0127 | Send/receive messages | Chat | unaudited | Tracker |
| ORCH-0129 | Conversation list | Chat | unaudited | Tracker |
| ORCH-0132 | Messaging realtime | Chat | unaudited | Tracker |
| ORCH-0136 | Custom paywall screen | Payments | unaudited | Tracker |
| ORCH-0138 | Subscription service | Payments | unaudited | Tracker |
| ORCH-0140 | Feature gate enforcement | Payments | unaudited | Tracker |
| ORCH-0141 | Swipe limit (free users) | Payments | unaudited | Tracker |
| ORCH-0143 | Calendar tab display | Calendar | unaudited | Tracker |
| ORCH-0145 | Calendar service | Calendar | unaudited | Tracker |
| ORCH-0158 | Discover screen (people) | People | unaudited | Tracker |
| ORCH-0168 | Send pair request | Pairing | unaudited | Tracker |
| ORCH-0201 | Network failure at every layer | Network | unaudited | Tracker |
| ORCH-0218 | Error boundary coverage | Error | unaudited | Tracker |
| ORCH-0221 | Silent failure paths | Error | unaudited | Tracker |
| ORCH-0222 | Service error contract | Error | design-debt | Tracker |
| ORCH-0227 | Deep link service routing | DeepLink | unaudited | Tracker |
| ORCH-0233 | Error boundary (app-wide) | Lifecycle | unaudited | Tracker |
| ORCH-0236 | App state manager — duplicate useForegroundRefresh hook causes double disconnect/connect | Lifecycle | bug | INV-009 (upgraded from unaudited) |
| ORCH-0238 | Notification system provider | Lifecycle | unaudited | Tracker |
| ORCH-0242 | AppsFlyer integration | Analytics | unaudited | Tracker |

### Regressions from Active Work

| ID | Title | Surface | Severity | Classification | Source |
|----|-------|---------|----------|---------------|--------|
| ORCH-0392 | Travel mode pills overflow section — "Driving" bleeds right edge after i18n label change | Discovery | S2 | regression | **CLOSED** — flexWrap added, visually verified on-device EN+ES |

### Admin Panel (Place Pool Management)

| ID | Title | Surface | Classification | Source |
|----|-------|---------|---------------|--------|
| ORCH-0332 | Admin cannot update existing city bbox — self-overlap block | Admin | missing-feature | Previous session |
| ORCH-0333 | Admin cannot change tile radius on seeded city | Admin | missing-feature | Previous session |
| ORCH-0334 | Photo tab stale London run (180/351 batches) | Admin | bug | Previous session |
| ORCH-0335 | Photo stats only count AI-approved — behavior change | Admin | quality-gap | Previous session |

### New from Wave 1b (Payments Investigation)

| ID | Title | Surface | Severity | Classification | Source |
|----|-------|---------|----------|---------------|--------|
| ORCH-0143 | Referral bonus grants 'pro' on server, 'elite' on client | Payments | S0 | bug | **CLOSED** |
| ORCH-0144 | Referral bonus months never expire | Payments | S0 | bug | **CLOSED** |
| ORCH-0145 | Session creation limit not enforced in UI | Payments | S1 | bug | **CLOSED** |
| ORCH-0146 | Swipe limit paywall doesn't trigger (stale ref) | Payments | S1 | bug | **CLOSED** |
| ORCH-0147 | Silent swipe blocking after limit — no user feedback | Payments | S2 | quality-gap | **CLOSED** |
| ORCH-0148 | useEffectiveTier can downgrade user (misleading comment) | Payments | S2 | quality-gap | **CLOSED** |
| ORCH-0149 | Trial abuse: delete + re-signup = infinite free Elite | Payments | S1 | bug | **CLOSED** |

### New from Session 2026-04-13 (User-Reported Concerns)

| ID | Title | Surface | Severity | Classification | Source |
|----|-------|---------|----------|---------------|--------|
| ORCH-0403 | Generic card descriptions on some categories (Play) — thin one-liners | Discovery | S2 | quality-gap | User report 2026-04-13 |
| ORCH-0404 | Realtime update audit — pair request + all two-party systems | Pairing + Cross-cutting | S1 | architecture-flaw | User report 2026-04-13 |
| ORCH-0405 | Saved/scheduled cards should reappear in deck with label | Discovery | S2 | missing-feature | User report 2026-04-13 |
| ORCH-0406 | Price tier labels wrong/hardcoded on expanded card view | Discovery | S1 | bug | User report 2026-04-13 |
| ORCH-0407 | Push notifications fundamentally broken across systems | Notifications | S1 | architecture-flaw | User report 2026-04-13 |
| ORCH-0408 | Quoted message in DM compressed to invisibility | Chat | S2 | bug | User report 2026-04-13 |
| ORCH-0409 | Map avatars intermittently disappear (possible ORCH-0385 regression) | Map | S1 | regression | User report 2026-04-13 |
| ORCH-0410 | Android discover map fundamentally broken | Map | S1 | architecture-flaw | User report 2026-04-13 |
| ORCH-0411 | Paired friend can't see my liked places — asymmetric | Pairing | S1 | bug | User report 2026-04-13 |
| ORCH-0412 | Default avatar color inconsistency across app | UI | S2 | design-debt | User report 2026-04-13 |
| ORCH-0428 | Google Sign-In fails on Android dev builds — debug SHA-1 not in Google Cloud Console | Auth | S2 | bug | User report 2026-04-14. Root cause confirmed: Google Play re-signs with app signing key (registered), but EAS debug keystore SHA-1 not registered. Fix: add debug SHA-1 to Google Cloud Console OAuth client. No code change needed. |
| ORCH-0429 | Android map markers (avatars + places) rendering as lines | Map | S1 | regression | User report 2026-04-14. Both person pins and place pins degenerate into thin lines. Likely ORCH-0410 bitmap fixes incomplete. |

(Full list of S2 and S3 items omitted for readability — see WORLD_MAP.md Issue Registry for complete data)

## Recently Closed (Map Foreground Refresh)

| ID | Title | Resolution | Closed Date | Evidence |
|----|-------|-----------|-------------|----------|
| ORCH-0385 | Map avatars disappear after background | Added `['nearby-people']` + `['map-settings']` to `CRITICAL_QUERY_KEYS`. tracksViewChanges resets on data change. | 2026-04-11 | QA_ORCH-0385 PASS 7/7 |

## Recently Closed (Map Wave 2)

| ID | Title | Resolution | Closed Date | Evidence |
|----|-------|-----------|-------------|----------|
| ORCH-0355 | Generic person profile crash + bare bottom sheet | `.maybeSingle()` crash fix + shared category pills in PersonBottomSheet | 2026-04-10 | QA_WAVE2 PASS (AH-059) |
| ORCH-0359 | Place pins no labels | Truncated name labels below every PlacePin | 2026-04-10 | QA_WAVE2 PASS (AH-059) |
| ORCH-0361 | Avatar disappearance | 3s `tracksViewChanges` window for image loading | 2026-04-10 | QA_WAVE2 PASS (AH-059) |

## Recently Closed (Map & Reporting Wave 1)

| ID | Title | Resolution | Closed Date | Evidence |
|----|-------|-----------|-------------|----------|
| ORCH-0358 | Friends-of-friends filter broken | MapPrivacySettings updated + DB CHECK constraint ALTERed | 2026-04-10 | QA_WAVE1 PASS + pg_constraint verified |
| ORCH-0362 | Map report silent failure | ReportUserModal replaces broken inline handler | 2026-04-10 | QA_WAVE1 PASS (AH-057) |
| ORCH-0363 | Report modal delay + double-block | Premature onBlockUser removed | 2026-04-10 | QA_WAVE1 PASS (AH-057) |
| ORCH-0364 | Admin reports empty | RLS SELECT + UPDATE policies added (migration 20260410000002) | 2026-04-10 | QA_WAVE1 PASS (AH-057) |
| ORCH-0365 | Phone PII exposed in friend profile | Phone removed from useFriendProfile + ViewFriendProfileScreen | 2026-04-10 | QA_WAVE1 PASS (AH-057) |

## Recently Closed (Photo Backfill Job System)

| ID | Title | Resolution | Closed Date | Evidence |
|----|-------|-----------|-------------|----------|
| ORCH-0274 | Photo backfill pipeline broken | Full job system: 2 tables, 9 edge function actions, city-scoped batches, auto-advance, persistent UI. Phase 1 + Phase 2. | 2026-04-02 | QA_PHOTO_BACKFILL_PHASE1_BACKEND_REPORT.md + QA_PHOTO_BACKFILL_PHASE2_ADMIN_UI_REPORT.md |

## Recently Closed (place_pool → card_pool Sync)

| ID | Title | Resolution | Closed Date | Evidence |
|----|-------|-----------|-------------|----------|
| ORCH-0273 | place_pool → card_pool data drift | Unified sync trigger: 16 single card fields + curated composites. Old website trigger replaced. | 2026-04-02 | QA_PLACE_POOL_CARD_POOL_SYNC_REPORT.md |

## Recently Closed (Cross-Page Dedup)

| ID | Title | Resolution | Closed Date | Evidence |
|----|-------|-----------|-------------|----------|
| ORCH-0272 | Cross-page dedup — pages return same 20 cards + UI freeze | ON CONFLICT predicate fixed to match partial index, error throw + degraded mode, client circuit breaker | 2026-04-02 | QA_ORCH_0272_CROSS_PAGE_DEDUP_REPORT.md |

## Recently Closed (State Persistence)

| ID | Title | Resolution | Closed Date | Evidence |
|----|-------|-----------|-------------|----------|
| ORCH-0209 | App background/foreground state survival | Always-mounted tabs + resume prefetch | 2026-03-31 | QA_LIVE_APP_STATE_PERSISTENCE_REPORT.md |
| ORCH-0240 | Foreground refresh | Refreshes ALL tabs (all mounted), preferences prefetched | 2026-03-31 | QA_LIVE_APP_STATE_PERSISTENCE_REPORT.md |
| ORCH-0270 | Tab switching loading spinners (SP-01 root cause) | Always-mounted tabs eliminate remount spinners | 2026-03-31 | QA_LIVE_APP_STATE_PERSISTENCE_REPORT.md |
| ORCH-0271 | PreferencesSheet loading shimmer on every open | Opens from cache, no shimmer | 2026-03-31 | QA_LIVE_APP_STATE_PERSISTENCE_REPORT.md |

## Recently Closed (Deterministic Deck Contract)

| ID | Title | Resolution | Closed Date | Evidence |
|----|-------|-----------|-------------|----------|
| ORCH-0266 | Double pagination — card pool unreachable | Duplicate .range() removed, all 200 pool cards reachable | 2026-03-31 | QA_DETERMINISTIC_DECK_CONTRACT_REPORT.md |
| ORCH-0267 | Travel time not enforced in deck | Hard filter added, out-of-range cards excluded | 2026-03-31 | QA_DETERMINISTIC_DECK_CONTRACT_REPORT.md |
| ORCH-0038 | Coordinates replacing text in location | Custom location deterministic, GPS fallback eliminated | 2026-03-31 | QA_DETERMINISTIC_DECK_CONTRACT_REPORT.md |
| ORCH-0268 | NULL price tier passthrough | NULL price_level filtered before deck assembly | 2026-03-31 | QA_DETERMINISTIC_DECK_CONTRACT_REPORT.md |
| ORCH-0048 | Curated/category round-robin broken | Category interleave rewritten with round-robin balancer | 2026-03-31 | QA_DETERMINISTIC_DECK_CONTRACT_REPORT.md |

## Regraded (Deterministic Deck Contract)

| ID | Title | Old Grade | New Grade | Evidence |
|----|-------|-----------|-----------|----------|
| ORCH-0065 | Solo mode | F | B | INVESTIGATION_PREFS_DECK_CONTRACT.md |
| ORCH-0066 | Collab mode parity | C | B | INVESTIGATION_PREFS_DECK_CONTRACT.md |

## Recently Closed (Wave 2 — Admin Users RLS Fix)

| ID | Title | Resolution | Closed Date | Evidence |
|----|-------|-----------|-------------|----------|
| ORCH-0258 | admin_users privilege escalation | RLS locked to is_admin_user(), safe RPCs for login flow | 2026-03-31 | QA_ADMIN_USERS_RLS_REPORT.md |
| ORCH-0252 | get_admin_emails() exposed to anon | Revoked anon access, replaced with is_admin_email() boolean | 2026-03-31 | Fixed with ORCH-0258 |

## Recently Closed (Wave 2 — Security Emergency Fix)

| ID | Title | Resolution | Closed Date | Evidence |
|----|-------|-----------|-------------|----------|
| ORCH-0253 | USING(true) on profiles — PII exposure | RLS policy tightened to remove public read | 2026-03-31 | QA_EMERGENCY_RLS_FIX_REPORT.md |

## Regraded from Investigation (Wave 2 — Security)

| ID | Title | Old Grade | New Grade | Evidence |
|----|-------|-----------|-----------|----------|
| ORCH-0223 | RLS policy coverage | F | D | INVESTIGATION_SECURITY_WAVE2.md |
| ORCH-0224 | Admin auth (3-layer) | F | A | INVESTIGATION_SECURITY_WAVE2.md, QA_ADMIN_USERS_RLS_REPORT.md |
| ORCH-0225 | PII handling | F | C | INVESTIGATION_SECURITY_WAVE2.md |
| ORCH-0226 | Storage path injection | F | D | INVESTIGATION_SECURITY_WAVE2.md |

## New Bugs (Wave 2 — Security Investigation)

| ID | Title | Surface | Severity | Classification | Source |
|----|-------|---------|----------|---------------|--------|
| ORCH-0250 | Avatars bucket no user-scoping | Security | S1 | bug | Investigation |
| ORCH-0251 | Messages bucket public — DM files accessible without auth | Security | S1 | bug | Investigation |
| ORCH-0252 | get_admin_emails() exposes admin list to anon | Security | S2 | bug | Investigation |
| ORCH-0254 | Full phone numbers logged in console | Security | S3 | bug | Investigation |
| ORCH-0255 | board-attachments + experience-images buckets missing | Security | S2 | bug | Investigation |
| ORCH-0256 | Client-side brute-force lockout bypassable | Security | S3 | bug | Investigation |
| ORCH-0257 | 6 edge functions have no auth (incl. Google Maps key) | Security | S2 | bug | Investigation |
| ORCH-0258 | admin_users USING(true) on UPDATE/DELETE — privilege escalation | Security | S1 | bug | Investigation |

## Recently Closed (Wave 1b — Payments Expiry/Trial)

| ID | Title | Resolution | Closed Date | Evidence |
|----|-------|-----------|-------------|----------|
| ORCH-0144 | Referral bonus never expires | Date-based expiry: started_at + months*30d | 2026-03-31 | QA_PAYMENTS_EXPIRY_TRIAL_REPORT.md |
| ORCH-0149 | Trial abuse via delete+re-signup | Phone-hash table survives deletion, checked at onboarding | 2026-03-31 | QA_PAYMENTS_EXPIRY_TRIAL_REPORT.md |

## Recently Closed (Wave 1b — Payments Clear Bugs)

| ID | Title | Resolution | Closed Date | Evidence |
|----|-------|-----------|-------------|----------|
| ORCH-0143 | Referral tier disagreement | SQL migration: get_effective_tier returns 'elite' | 2026-03-31 | QA_PAYMENTS_CLEAR_BUGS_REPORT.md |
| ORCH-0145 | Session creation limit | useSessionCreationGate wired into CollaborationSessions | 2026-03-31 | QA_PAYMENTS_CLEAR_BUGS_REPORT.md |
| ORCH-0146 | Swipe paywall timing | recordSwipe() return value + PanResponder feedback | 2026-03-31 | QA_PAYMENTS_CLEAR_BUGS_REPORT.md |
| ORCH-0147 | Silent swipe blocking | Fixed with ORCH-0146 | 2026-03-31 | QA_PAYMENTS_CLEAR_BUGS_REPORT.md |
| ORCH-0148 | useEffectiveTier comment | Fixed with ORCH-0143 | 2026-03-31 | QA_PAYMENTS_CLEAR_BUGS_REPORT.md |

## Recently Closed (Wave 1a)

| ID | Title | Resolution | Closed Date | Evidence |
|----|-------|-----------|-------------|----------|
| ORCH-0004 | Sign-out cleanup | RevenueCat/Mixpanel cleanup added, 401 handler rewired, dead code removed | 2026-03-31 | QA_ORCH-0004_SIGNOUT_CLEANUP_REPORT.md |

## Closed Issues (Grade A)

88 items closed with evidence. Key closures:

| Area | Count | Key Commits |
|------|-------|-------------|
| Discovery / Card Pipeline | 30 | 94143183, 77b92984, 6c7b2429, 7ca26b48, 28be9a63, 7fef7ed0, dba7b3f0 |
| Notifications | 6 | 376cd237, d4c6725e, ea655d36 |
| Collaboration UI | 3 | 15fe8742, 76cd2ca7, 3ee1bce9 |
| Profile & Settings | 4 | a268b19f, 302b74d5, cdd3cac0 |
| State & Cache | 5 | 846e7cce, 27e475ac |
| Chat Responsiveness | 4 | bef4ca3b, 2549dbe6 |
| Hardening Infrastructure | 3 | 06614e98 |
| UI Components | 3 | 0254bc4f, 2a96c8f6, 88f2d43f |
| Social / Friends | 1 | 76cd2ca7 |
| Pairing | 3 | 376cd237, 23f3a0dd |
| Card Rendering & Swipe | 2 | 5702067b, acf7e508 |
| Deck Pipeline | 7 | 79d0905b, 28be9a63 |

## Verified Issues (Grade B — Not Yet Fully Closed)

| ID | Title | Gap to A |
|----|-------|----------|
| ORCH-0002 | Session persistence | Full offline flow unaudited |
| ORCH-0007 | Zombie auth prevention | Heuristic-based (transitional) |
| ORCH-0035 | Triple duplicate API calls | One hidden flaw remains |
| ORCH-0042 | Paired view repeated experiences | Race on simultaneous fetches |
| ORCH-0050 | AI Card Quality Gate | Not yet run on production data |
| ORCH-0051 | Flowers category too broad | AI sole gate, not production-validated |
| ORCH-0063 | Empty pool state | Only discover-cards tested on device |
| ORCH-0076 | Friend request send/accept | Send flow unaudited |
| ORCH-0083 | Push delivery (OneSignal) | Sound uses OS defaults |
| ORCH-0088 | Deep link from notification | Invalid sessionId lingers |
| ORCH-0092 | Notification send observability | No retry queue |
| ORCH-0103 | Subscription tier freshness | "Take highest of 3" transitional model |
| ORCH-0156 | Holiday reminder notifications | custom_holidays.year NOT NULL, no recurring |
| ORCH-0204 | Offline queue observability | No user notification on discard |
| ORCH-0065 | Solo mode | Full offline + edge cases unaudited |
| ORCH-0066 | Collab mode parity | Collab-specific edge cases unaudited |

## Deferred Issues

| ID | Title | Reason | Exit Condition | Date |
|----|-------|--------|----------------|------|
| ORCH-0222 | Service error contract | ~60+ call sites, high blast radius | Next hardening cycle | 2026-03-23 |

## Deck Hardening History (Passes 1-10)

44 bugs completed across 10 passes. All have commit evidence and test reports.
See Launch Readiness Tracker "Deck Hardening" section for full details.
