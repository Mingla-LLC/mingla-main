# Coverage Map

> **2026-04-25 — Wave 4 CLOSE: 4 chat-domain ORCHs to Grade A (single bundled CLOSE).** Surface grade movements: **DM Messaging F→A** (ORCH-0664 dedup ordering fixed; messages no longer silently drop), **Add Friend to Existing Session F→A** (ORCH-0666 RPC + cycle-2 prop migration; both Friends-modal + DM "Add to Board" entry points now real), **DM Saved-Card Sharing F→A** (ORCH-0667 picker + bubble + push pipeline live), **Discover/Singles Deck Distance Display C→A** (ORCH-0659/0660 honest haversine + per-mode travel time + null-safe UI). 4 invariants now active across these surfaces: I-DEDUP-AFTER-DELIVERY, I-INVITE-CREATION-IS-RPC-ONLY, I-CHAT-MESSAGE-TYPE-CARD-PAYLOAD-COMPLETENESS, I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME — each with CI gate proven via tester negative-control reproductions. **Heatmap delta:** +4 A, -4 F across chat/DM/deck domains. Baseline `fetch_local_signal_ranked` CI gate failure persists as orthogonal parallel-chat issue (recommend separate ORCH for tracking). **Coverage observation:** the bundled-tester approach revealed cross-ORCH integration paths (X-01 card-share via realtime / X-02 invite push delivery / X-03 deck-share data preservation) that single-ORCH testers would have missed — recommend keeping bundled-test pattern for future multi-ORCH waves where surfaces share code paths.

> **2026-04-25 — ORCH-0668 CLOSED Grade A.** **Paired-Profile Recommendations surface: A reaffirmed** (was silently F since plpgsql plan-cache trap activated for ≥6 signals, restored by the `LANGUAGE sql STABLE` rewrite). Production perf p95 ~135 ms at 11-signal Raleigh confirms the surface is now production-grade across the full workload range tested by the dispatch (3 / 6 / 11 signals all sub-150 ms). **Sibling surfaces unchanged:** Discover/Singles (`query_servable_places_by_signal`) and Curated Experiences (`fetch_local_signal_ranked`) both verified `LANGUAGE sql STABLE` with body hashes captured for future byte-compare baseline (`cde9ef2edc7...` and `1fd57904a06...`). **New invariant `I-RPC-LANGUAGE-SQL-FOR-HOT-PATH` registered + CI gate active** — closes the regression class for hot-path RPCs that take array parameters. Pre-existing `fetch_local_signal_ranked (no defining migration found)` CI gate baseline failure is orthogonal (parallel chat) and tracked separately. **Heatmap delta:** Paired-Profile Recommendations F→A. Total grade distribution: +1 A, -1 F.

> **2026-04-25 — ORCH-0672 CLOSED.** No surface grade movement — this was a regression hotfix that restored the previously-audited state of the Home pill bar (originally graded under ORCH-0589 "unified glass home" + ORCH-0661 "pending pill states"). The `glass.chrome.pending` token sub-namespace was always intended to be HEAD truth; the 3911b696 partial-commit was the anomaly, not the prior state. Home/Chrome surface grade unchanged at A (per ORCH-0589/0661 closure). **Coverage observation:** the regression itself revealed a process gap — forensics + orchestrator capture of in-flight diffs did not classify coupled diffs (consumer + token must move together). New invariant `I-COUPLED-DIFF-NEVER-PARTIAL-COMMIT` registered in INVARIANT_REGISTRY.md to close the regression class structurally. **Heatmap unchanged. Total grade distribution unchanged.**

> **2026-04-23 late-night — ORCH-0641 FORMAL QA CLOSE (AH-175 CONDITIONAL PASS).** Discovery/Singles Serving surface grade: **A reaffirmed** (not A→A because no new grade earned; prior A was silently invalidated by the 2026-04-15 regression, now restored). Cross-function `_periods` audit across all 72 edge functions confirms the bug was isolated to `discover-cards` — no hidden copies elsewhere. Constitutional #3/#8/#13 preserved or improved. One coverage observation from D-1: Curated-stop hours filtering has been an unaudited no-op via `filterCuratedByStopHours` at `discover-cards:940` — grade on Curated Serving surface demoted to B-pending (was A via ORCH-0634 closure) until ORCH-0644 ships the shared hours helper replacement. No other grade movements.

> **2026-04-23 night — ORCH-0640 (Great Demolition and Rebuild) + ORCH-0641 (filter schema fix) BOTH CLOSED Grade A.** Device smoke 5/5 PASS on user phone. ORCH-0640: 14 migrations live, 5 edge fns deployed + 7 deleted, 2 admin pages deleted, 4 mobile files deleted, 7 new invariants registered. Discovery / Explore surface grade distribution **unchanged structurally** — the demolition collapsed 3 parallel card-generation systems into 1 without adding or removing audited flows. Surface coverage strengthens via consolidation: every serving path now goes through the 3-gate `query_servable_places_by_signal` RPC (G1 is_servable + G2 signal score + G3 stored_photo_urls). ORCH-0641 restores 7 previously-dead chips (brunch/casual_food/drinks/fine_dining/movies/play/icebreakers) — was a silent regression since 2026-04-15, already included in Discovery surface grade via ORCH-0434 closure, so no grade movement needed. Place Pipeline surface count UNCHANGED — AI validation layer deletion absorbed into signal-serving pipeline that was already audited A. Rollback archive lives until 2026-04-30. 11 deferred follow-ups queued for later dispatch.

> **2026-04-22 — ORCH-0636 (TS Build Hygiene) closed Grade A code-level.** No surface grade change (pure type-hygiene + dead-code removal affecting `RecommendationsContext.tsx`, `ViewFriendProfileScreen.tsx`, `useSessionManagement.ts`). Minor positive signal on Discovery/Collab surface: collab prefetch path converged onto the proven solo path, meaning both modes now share the same `['deck-cards', …]` query key — coverage improves via consolidation. ORCH-0636.1 (P3 residual) and ORCH-0639 (P1 Const #13 / curated two-gate) remain open. See WORLD_MAP.md.

> **2026-04-21 ~23:30 UTC — ORCH-0635 (Coach Mark Refresh) CLOSED Grade A.** Device-verified PASS after iterative cutout tuning. Commit `f284215d`. Tour rewritten from 10 steps to 9 to match post-glass-refresh app layout. 3 orphaned steps (old 2, 5, 10) fixed or dropped, 1 duplicate cutout merged (old 1+3), step 6 retargeted from FilterChip to header panel with centered bubble, NEW step 3 added for Likes tab (closes core-loop save-destination gap), NEW step 9 added targeting BetaFeedbackButton. New `bubblePosition?: 'auto' | 'center'` field on CoachStep. Legacy `coach_mark_step` values normalized to TOUR_COMPLETED on first post-deploy fetch (idempotent). New `__DEV__` warning in `useCoachMark` fires within 500ms if a step's targetRef never attaches — catches future refactor orphans. 14 files, +286/-151. Pure presentation + state-machine. OTA-safe for both platforms. Non-beta feedback universalization flagged as candidate follow-up (BetaFeedbackButton gate).

> **2026-04-21 ~22:00 UTC — ORCH-0627.1 (Profile Core Glass Refresh, Phase 1) CLOSED Grade A.** Device-verified PASS. Commit `e3dfb380`. Converts the last white-on-light screen to warm-charcoal glassmorphic bento. 5 floating cards (Hero elevated + Interests + Stats + Account + Footer) on `rgba(20,17,19,1)` canvas with orange radial glow breathing 0.85↔1.0 over 8s (static with reduce-motion). New `<GlassCard>` primitive (base + elevated) handles iOS BlurView + Android API<31 fallback + Reduce Transparency fallback. New `glass.profile.*` token namespace (~260 tokens: canvas, hero gradient + glow, card base/elevated, 14 text roles, avatar + dual ring, chips intent/category, stat tiles, level ring, tier badge, settings row, sign-out, sheet, motion). Stats card restructured from flat 3+3 to level-ring hero + 2×2 bento grid. Count-up short-circuits on zero. Phase 2 (ORCH-0627.2: sheets + ViewFriendProfileScreen + PairedProfileSection) QUEUED. 9 files, +1396/-452. Pure presentation + token layer. OTA-safe both platforms. Discoveries: placesVisited/streakDays still hardcoded to 0 (ORCH-0629/0630 candidates); BetaFeedbackButton still light-themed (ORCH-0634); AccountSettings nested screens still light (ORCH-0628).

> **2026-04-21 ~21:15 UTC — ORCH-0626 CLOSED Grade A.** Six empty-state surfaces promoted from F-invisible to A-legible on dark-canvas screens. Surfaces touched: Connections (title+subtitle), Messages (DM empty), Friends list, Requests, Blocked users, Deck errors (SwipeableCards — "Couldn't load your deck" + auth_error + "That didn't land" + "Waiting for friends" + "No places found nearby"). Grade-distribution impact: +6 A on empty-state coverage within the existing dark-glass audit. No new unaudited surfaces introduced. Adjacent light-theme screens (modals, sheets, board, onboarding) explicitly verified untouched with rationale.

> **2026-04-21 ~08:30 UTC — ORCH-0595 Slice 3 (Upscale Brunch signal) CLOSED Grade A.** Signal-library architecture extended with third signal; now proves the pattern across 3 distinct signal configs tuned through device-observed calibration. Brunch scoring 1,449 Raleigh places with 286 at 150-200 cap tier after v1.3.0 upscale tune. Discovery surface grade distribution unchanged — signal-library is reinforcing architecture, not changing grades.

> **2026-04-21 ~07:45 UTC — ORCH-0590 Slice 2 (Drinks signal) CLOSED Grade A.** Discovery surface: signal-library architecture extended with second signal. Drinks scoring 1,449 Raleigh places (172 ≥120 filter_min, 53 at 200 cap), cohort-gated serving via generalized `CATEGORY_TO_SIGNAL` map in discover-cards. Surface grade distribution unchanged (Discovery was already Strong pre-Slice-2; second signal reinforces architecture but doesn't move grade buckets). New invariant registered: `I-CATEGORY-SIGNAL-ALIAS-COMPLETE` — every cohort-eligible chip has BOTH display name AND slug keyed in the map. Slice 1 (fine_dining) backward-compat aliases preserved as `[TRANSITIONAL]` until 2026-05-05.

> **2026-04-21 03:45 UTC — ORCH-0558 CLOSED Grade A.** Collaboration Sessions surface: 1 additional A from match promotion structural hardening (advisory lock + unique constraint + atomic RPC + telemetry observable). Surface distribution: 7 total → 4 A / 0 B / 0 C / 0 D / 3 F (was 3 A / 0 B / 0 C / 0 D / 4 F). Match-promotion path verified live via 10 MCP deploy probes + tester Tier A/B/F + device test on iOS + Android. 6 new invariants registered.

> Last updated: 2026-04-18 (**ORCH-0503 CLOSED A** — v3 fix PASS; Discovery surface grade distribution unchanged: the fix restores correctness inside an already-Strong-graded deck pipeline, so no grade-count movement; new invariant `I-PROGRESSIVE-DELIVERY-INTERLEAVE-AUTHORITATIVE` reinforces Constitutional #2 "One owner per truth" at the deck-sync-effect boundary)

## Surface Coverage

| Surface | Total | A | B | C | D | F | % Unaudited | % Stale | Confidence |
|---------|-------|---|---|---|---|---|-------------|---------|------------|
| Auth & Session | 7 | 2 | 4 | 1 | 0 | 0 | 0% | 0% | Partial |
| Onboarding | 11 | 2 | 0 | 0 | 0 | 9 | 82% | 0% | Weak |
| Discovery / Explore | 55 | 39 | 10 | 0 | 0 | 6 | 11% | 0% | Strong (↑ ORCH-0474 closed B — ORCH-0469, ORCH-0472 previously B) |
| **Place Pipeline (Seeding + AI Validation)** | **11** | **8** | **0** | **0** | **0** | **3** | **27%** | **0%** | **Strong (NEW 2026-04-17)** |
| Collaboration Sessions | 7 | 4 | 0 | 0 | 0 | 3 | 43% | 0% | Partial (↑ ORCH-0558 closed A — match promotion structurally proven deterministic + observable) |
| Social / Friends | 7 | 1 | 1 | 0 | 0 | 5 | 71% | 0% | Weak |
| Notifications | 11 | 6 | 2 | 0 | 0 | 3 | 27% | 0% | Partial |
| Saved / Boards | 5 | 0 | 0 | 0 | 0 | 5 | 100% | 0% | Unaudited |
| Profile & Settings | 10 | 4 | 1 | 0 | 0 | 5 | 50% | 0% | Weak |
| Map & Location | 16 | 0 | 0 | 0 | 0 | 16 | 100% | 0% | Unaudited |
| Chat / DM | 8 | 0 | 0 | 0 | 0 | 8 | 100% | 0% | Unaudited |
| Payments & Subscriptions | 15 | 8 | 6 | 1 | 0 | 0 | 0% | 0% | Strong |
| Calendar & Scheduling | 8 | 0 | 0 | 0 | 0 | 8 | 100% | 0% | Unaudited |
| Holidays & Events | 8 | 1 | 1 | 0 | 0 | 6 | 75% | 0% | Weak |
| People Discovery | 10 | 0 | 0 | 0 | 0 | 10 | 100% | 0% | Unaudited |
| Pairing System | 10 | 3 | 0 | 0 | 0 | 7 | 70% | 0% | Weak |
| Sharing & Invites | 10 | 0 | 0 | 0 | 0 | 10 | 100% | 0% | Unaudited |
| Post-Experience | 9 | 0 | 0 | 0 | 0 | 9 | 100% | 0% | Unaudited |
| Booking | 2 | 0 | 0 | 0 | 0 | 2 | 100% | 0% | Unaudited |
| Network & Offline | 5 | 0 | 1 | 0 | 0 | 4 | 80% | 0% | Weak |
| State & Cache | 8 | 5 | 0 | 0 | 0 | 3 | 38% | 0% | Partial |
| Chat Responsiveness | 4 | 4 | 0 | 0 | 0 | 0 | 0% | 0% | Strong |
| Hardening Infrastructure | 3 | 3 | 0 | 0 | 0 | 0 | 0% | 0% | Strong |
| Error Handling | 5 | 0 | 0 | 0 | 0 | 5 | 100% | 0% | Unaudited |
| Security & Auth | 13 | 5 | 0 | 1 | 2 | 5 | 38% | 0% | Weak |
| Deep Linking | 4 | 0 | 1 | 0 | 0 | 3 | 75% | 0% | Weak |
| App Lifecycle | 11 | 2 | 0 | 0 | 0 | 9 | 82% | 0% | Weak |
| Analytics & Tracking | 11 | 1 | 0 | 2 | 2 | 6 | 55% | 0% | Weak |
| Weather & External | 6 | 0 | 0 | 0 | 0 | 6 | 100% | 0% | Unaudited |
| UI Components | 10 | 3 | 0 | 0 | 0 | 7 | 70% | 0% | Weak |
| **TOTAL** | **303** | **100** | **24** | **4** | **4** | **171** | **56%** | **0%** | **Weak → Slightly improving** |

## Heatmap Summary

### Strong (>70% at A/B)
- Chat Responsiveness (4/4 A)
- Hardening Infrastructure (3/3 A)
- Discovery / Explore (42/52 A+B = 81%)
- Payments & Subscriptions (14/15 A+B = 93%)

### Partial (40-70% at A/B)
- Auth & Session (6/7 A+B = 86%)
- Notifications (8/11 A+B = 73%)
- State & Cache (5/8 A = 63%)

### Weak (<40% at A/B)
- Profile & Settings (4/10 = 40%)
- Collaboration Sessions (3/7 = 43%)
- Pairing System (3/10 = 30%)
- Security & Auth (5/13 A+B = 38%)
- All cross-cutting except Chat-Resp, Infra, and State & Cache

### Unaudited (>80% at F)
- Saved / Boards (100%)
- Map & Location (100%)
- Chat / DM (100%)
- Calendar & Scheduling (100%)
- People Discovery (100%)
- Sharing & Invites (100%)
- Post-Experience (100%)
- Booking (100%)
- Error Handling (100%)
- Weather & External (100%)
- Onboarding (82%)
- Holidays & Events (86%)
- Analytics & Tracking (88%)
- App Lifecycle (82%)

## Staleness Check

All evidence dates are within 7 days (latest: 2026-03-31). No stale items.
7 payment bugs closed 2026-03-31 — audit velocity resumed. All payment bugs now closed.
Security Wave 2: 4 items regraded (D/B/C/D → D/A/C/D), 3 closed (ORCH-0253, ORCH-0258, ORCH-0252), 8 new bugs registered 2026-03-31.
Deterministic Deck Contract: 5 closed (ORCH-0266/0267/0268/0038/0048), 2 upgraded (ORCH-0065 F→B, ORCH-0066 C→B). Discovery now 81% A+B.
State Persistence: 4 closed (ORCH-0209 F→A, ORCH-0240 B→A, ORCH-0270 new→A, ORCH-0271 new→A). State & Cache now 63% A. App Lifecycle loses its only B, now 2A/9F.
