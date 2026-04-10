# Master Bug List

> Last updated: 2026-04-10
> Total: 306 | Open: 132 | Closed: 106 | Verified (B grade): 21 | Deferred: 1

## Summary by Status

| Status | Count | % |
|--------|-------|---|
| Open (F grade, unaudited) | 123 | 41% |
| Open (F grade, known bug) | 7 | 2% |
| Open (F grade, missing-feature) | 2 | <1% |
| Open (F grade, quality-gap) | 2 | <1% |
| Open (D grade, quality-gap) | 2 | <1% |
| Closed (A grade) | 88 | 30% |
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

(Full list of S2 and S3 items omitted for readability — see WORLD_MAP.md Issue Registry for complete data)

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
