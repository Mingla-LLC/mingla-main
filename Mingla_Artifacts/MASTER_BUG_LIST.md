# Master Bug List

> Last updated: 2026-04-19 (Phase 2.2 CONDITIONAL PASS — ORCH-0485 RC#2 + RC#3 CLOSED, ORCH-0486 CLOSED; Post-PASS artifacts synced; Phase 2.3 dispatch prep next)
> Total: 360 | Open: 157 | Closed: 127 | Verified (B grade): 24 | Partial: 1 | Deferred: 1 | Partially-shipped: 1 | Program charter: 1 | Phase-0-verified: 3 | Phase-2.1-shipped: 1 | Phase-2.2-shipped: 1

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
