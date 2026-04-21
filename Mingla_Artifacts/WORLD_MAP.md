# Mingla World Map

> **2026-04-21 ~08:30 UTC — ORCH-0595 (Signal-Library Slice 3: Upscale Brunch) CLOSED Grade A**: Commit `dfc89f19` + 3 MCP calibration cycles (v1.0.0→v1.3.0). Final config correctly surfaces upscale-brunch destinations (Brewery Bhavana, Whiskey Kitchen, Salt & Lime, Irregardless, Jolie, Bida Manda, Element Gastropub, Capital Grille, Stanbury, Second Empire) while demoting chain breakfast (First Watch 181-193, below top), cafe/coffee shops (Jubala/Morning Times/Sosta excluded), and bar/sports venues (Drive Shack → 0, Carolina Ale House → 154). Signal-library architecture now ships 3 signals end-to-end: fine_dining + drinks + brunch. CATEGORY_TO_SIGNAL map 7 entries. Active brunch version: `c60beb9b-1c51-42b5-995a-33b67363e5cc`. No mobile changes (chip "Brunch, Lunch & Casual" unchanged). [TRANSITIONAL] marker: map entry converts to union when Slice 4 (casual_food) lands.

> **2026-04-21 ~07:45 UTC — ORCH-0590 (Signal-Library Slice 2: Drinks) CLOSED Grade A**: Tester returned PASS on `outputs/QA_ORCH-0590_SLICE2_DRINKS_SIGNAL_VERTICAL_REPORT.md`. 11/11 SCs + 8/8 regressions + 4/4 security gates verified. Live-fire proven via 4 calibration cycles (v1.0.0 → v1.4.0) on user's family/friends device. Drinks signal at 100% cohort, serving production via discover-cards v123. Mobile chip rename "Upscale & Fine Dining" → "Fine Dining" live on iOS + Android. 3 new P3/P4 discoveries: 0590.9 Google mislabels steakhouses (Oak/Sitti), 0590.10 missing Mediterranean/Middle-Eastern penalty in v1.4.0, 0590.11 admin RPC not sandbox-testable. **⚠ ORCH-ID collision flag (ORCH-0590.12 P4):** ORCH-0590 was used BOTH for Signal-Library Slice 2 AND for Discover Screen modernization (entry immediately below). Both tracks are contextually distinguishable; future references should disambiguate. Slice 3 (Romantic signal) will use ORCH-0595 to avoid further collision. `[TRANSITIONAL]` aliases in CATEGORY_TO_SIGNAL exit 2026-05-05.

> **2026-04-21 — ORCH-0590 CHARTER INTAKE (Discover Screen modernization)**: User directive: "Discover screen is no longer tabbed — it's just concerts + events. Clean up dead code + references. Then apply Tinder-Explore visual pattern (sticky header with blurred backdrop on scroll, sticky section bars, large title, 2-col grid, everything glass morphism premium matching home page)." Charter = 3 phases: **Phase 1 (cleanup)** — subtract dead tab code + orphaned services/hooks/components from `DiscoverScreen.tsx` (currently 4,082 lines with ~20 white-bg refs); events content wiring preserved (NightOutExperiencesService + Ticketmaster integration). **Phase 2 (design)** — designer spec for the Tinder-Explore pattern applied to events content, consuming `glass.chrome.*` tokens from ORCH-0589. **Phase 3 (implementor)** — execute Phase 2 spec. Phase 1 dispatch ready at `prompts/IMPL_ORCH-0590_PHASE1_DISCOVER_DEAD_CODE_CLEANUP.md` — 10 SCs, scope-locked to DiscoverScreen.tsx + any orphaned adjacent files, zero visual redesign this phase (Phase 3 handles that). Phase 2/3 follow after Phase 1 lands. Runs in parallel with ORCH-0589 v6.3 tune still awaiting commit.

> **2026-04-21 — ORCH-0589 v4 DEVICE VERIFICATION RETURNED 5-POINT v5 REWORK (user-confirmed)**: 5 polish gaps: (T1) nav narrower than full-bleed card + not rounded enough — widen `glassNavWrapper.paddingHorizontal 20→8` + bump `nav.radius 28→36` (fully rounded pill on 72pt tall capsule); (T2) tapping a collab pill switches context but does NOT open the session modal — wire to CollaborationSessions' existing `openSessionId` flow; (T3) re-tapping already-active collab pill is a no-op — remove early-return in GlassSessionSwitcher, add nonce-based trigger so same-id re-taps fire; (T4) active Preferences/Notifications icons are orange on orange glass — flip `c.active.iconColor` from `#eb7825` → `#FFFFFF` (unifies active-content: nav+pill+icon-button all white on orange glass); (T5) nav has 8pt gap above home-indicator safe-area — reduce `bottomNavigation.paddingTop 8→0` (paddingBottom stays for home-indicator clearance). Dispatch `prompts/IMPL_ORCH-0589_v5_WIDER_ROUNDER_MODAL_FLUSH.md` with 9 SCs, 7 invariants, 7 anti-patterns, 5 escalation triggers. Scope: 4 files guaranteed (`designSystem.ts`, `app/index.tsx`, `GlassSessionSwitcher.tsx`, `HomePage.tsx`); possibly 1 more (`CollaborationSessions.tsx`) if nonce trigger needs additive prop. Implementor reads + decides.

> **2026-04-21 — ORCH-0589 v3 DEVICE VERIFICATION RETURNED 5-POINT v4 POLISH REWORK**: User device-tested deployed v3 build. 5 gaps: (V1) card lost rounded corners in v3's full-bleed — looks like a rectangle, not a card — need large (~40pt) radius matching iPhone bezel + slight bottom gap from nav; (V2) active nav icon is orange (v3 R7 unification) — user wants WHITE; (V3) nav capsule too cramped — no breathing room around icon + label (v3 reduced `verticalPadding` 6→4); (V4) user-clarified: the top-right "past cards" element is `batchChip` at `SwipeableCards.tsx:2124` — a conditional TouchableOpacity (`"View Previous"` pill with clock icon + "viewed: N" text) that opens `DismissedCardsSheet`; move from `top: 16` to `top: insets.top + 62` to sit below top-bar chrome; NOT `galleryIndicatorWrapper` (that's the separate photo-count chip — stays put); (V5) visible white 1px line at top of Preferences button + Notifications bell + session-pill capsule — the `glass.chrome.border.topHighlight` rendering as an artifact on chrome (NOT on GlassBadge chips which work fine). Rework dispatch `prompts/IMPL_ORCH-0589_v4_BEZEL_BREATHING_POLISH.md` with 8 SCs, 7 invariants, 8 anti-patterns, 4 escalation triggers. Scope: 5 files (`SwipeableCards.tsx` V1+V4, `GlassBottomNav.tsx` V2+V5, `GlassSessionSwitcher.tsx` V5, `GlassIconButton.tsx` V5, `designSystem.ts` V1+V2+V3 tokens, optional HomePage.tsx for V4 safe-area wiring). `GlassBadge.tsx`/`GlassTopBar.tsx`/`app/index.tsx`/`CollaborationSessions.tsx` untouched.

> **2026-04-21 — ORCH-0589 v3 SCOPE CORRECTED VIA USER ROUND-TRIP + CONFIRMED**: Orchestrator's first v3 draft misidentified R1 as `cardDetails` white Share section. User corrected: the white bar is the app-level `safeArea` backgroundColor (`app/index.tsx:2588` white showing through the transparent `bottomNavigation` from v2). User also retracted v2 G7 (solid-orange nav active) and asked for nav active to match session-pill active exactly (translucent orange glass + orange border + orange glow + orange icon + white label). v3 prompt rewritten in place with 7 targeted fixes (R1 safeArea white→black, R2 topInset 8→2, R3 blurred header backdrop, R4 card full-bleed width, R5 bottomInset 12→6, R6 spotlight first-render bug + wider coverage, R7 nav active consumes `glass.chrome.active.*` tokens unified with session pill — deletes v2's `nav.activeFill/activeIconColor/activeLabelColor/activeGlowOpacity/activeGlowRadius` tokens). `cardDetails` + in-card Share button explicitly UNTOUCHED. 9 SCs, 8 invariants, 8 anti-patterns, 4 escalation triggers. Files touched: `app/index.tsx` + `SwipeableCards.tsx` + `GlassTopBar.tsx` + `GlassBottomNav.tsx` + `designSystem.ts`. Primitives `GlassIconButton`/`GlassSessionSwitcher`/`GlassBadge`/`HomePage.tsx`/`CollaborationSessions.tsx` explicitly NOT touched this cycle.

> **2026-04-21 — ORCH-0589 v2 DEVICE VERIFICATION RETURNED 6-POINT v3 POLISH REWORK**: User device-tested the deployed v2 build (screenshot of Sono Sushi card attached). 6 gaps: (R1) white `cardDetails` section still rendering a white strip with the Share button at the bottom of every card — orchestrator verified root cause at `SwipeableCards.tsx:2683` (flex 0.12 white 0.85); (R2) floating top chrome has a visible gap from the status bar — reduce `glass.chrome.row.topInset 8→2`; (R3) status-bar icons + top chrome need a blurred backdrop canvas to stay readable on bright photos — add new backdrop BlurView layer inside GlassTopBar; (R4) card does NOT fill screen width — `cardContainer.width: SCREEN_WIDTH - 32` + `paddingHorizontal: 8` creates 48pt of visible gaps, change to full width; (R5) nav bar too high — reduce `glass.chrome.row.bottomInset 12→6`; (R6) active spotlight invisible on first mount + too narrow — orchestrator identified first-render bug (layoutsRef undefined on mount, effect bails early) + `spotlightInset: 4` too much + `verticalPadding: 6` too tall. Rework dispatch `prompts/IMPL_ORCH-0589_v3_FULL_BLEED_POLISH.md` with 8 SCs, 7 invariants, 7 anti-patterns, 5 escalation triggers. Scope: 4 files (`SwipeableCards.tsx` cardDetails deletion + share-button relocation + full-bleed container, `GlassTopBar.tsx` backdrop layer, `GlassBottomNav.tsx` first-render fix + spotlight sizing, `designSystem.ts` tokens). `GlassIconButton` / `GlassSessionSwitcher` / `GlassBadge` / `HomePage.tsx` / `app/index.tsx` explicitly NOT touched this cycle.

> **2026-04-21 — ORCH-0589 v1 DEVICE VERIFICATION RETURNED 7-POINT POLISH REWORK LIST → v2 REWORK DISPATCH READY**: User device-tested the deployed ORCH-0589 chrome. 7 concrete gaps returned: (G1) Mingla logo header still renders, should be deleted entirely; (G2) white bottom-nav container background + top border still visible behind glass capsule (`styles.bottomNavigation` in `app/index.tsx:2636` has `backgroundColor: "white"` + `borderTopWidth: 1` — root cause confirmed by orchestrator); (G3) card does NOT fill viewport — `mainContent` applies `paddingTop: layout.insets.top` on Swipe page, and `safeArea` has `backgroundColor: "white"` — card should extend under status bar edge-to-edge; (G4) card chips feel under-designed/positioned — need more breathing room + bottom photo gradient for premium; (G5) session switcher pills should show only names, remove avatars; (G6) hard-edged rectangle visible at scroll end — v1 `fadeEdge` used solid matte instead of `expo-linear-gradient` (implementor shortcut confirmed); (G7) bottom-nav active state should be SOLID ORANGE fill + WHITE icon + WHITE text (current tinted-glass spotlight too subtle). None require redesign — all are tight polish fixes on existing primitives. 4 gaps override spec decisions (G1/G3/G5/G7 change the original contract); 3 gaps correct v1 implementation shortcuts (G2/G4/G6). Rework dispatch `prompts/IMPL_ORCH-0589_v2_POLISH_REWORK.md` written with 8 SCs, 7 invariants preserved, 6 anti-patterns, 5 escalation triggers. Scope: ~6 files to touch (`HomePage.tsx` logo deletion, `app/index.tsx` bottomNavigation + statusBar + paddingTop, `SwipeableCards.tsx` chip positioning + photo gradient, `GlassSessionSwitcher.tsx` avatar removal + linear-gradient fades, `GlassBottomNav.tsx` solid-orange spotlight, `designSystem.ts` new activeFill token). Primitives `GlassIconButton`, `GlassTopBar`, `GlassBadge`, `CollaborationSessions` explicitly NOT touched.

> **2026-04-20 — ORCH-0589 DESIGNER COMPLETE + APPROVED HIGH + USER-STEERED CHOICES LOCKED → IMPLEMENTOR READY**: mingla-designer returned `outputs/SPEC_ORCH-0589_FLOATING_GLASS_HOME.md` (19 sections, 16 SCs, 4 primitives, 3 nav variants). User picks after orchestrator layman-explanation pass: **Q1=Variant A** (Glass Capsule + Orange Spotlight — labels always visible, orange spotlight pill slides between tabs on tap), **Q2=YES "+" pill** (session-create affordance on top bar), Q3 auto-resolved by orchestrator (verified bell already lives at `HomePage.tsx:268` → migrate, delete old, one-owner-per-truth), Q4 locked default (top bar stays during card expand). Spec extends ORCH-0566 `glass.badge.*` system with new `glass.chrome.*` sub-namespace. Chrome-specific values: BlurView intensity 28 (vs badge 24 — larger surfaces), tint floor `rgba(12,14,18,0.48)`, orange active energy on every selected state (tint `rgba(235,120,37,0.28)` + border `rgba(235,120,37,0.55)` + orange glow + `#eb7825` icon). WCAG AA math verified, reduce-transparency + reduce-motion + Android<31 all specified with identical silhouettes. Implementor dispatch at `prompts/IMPL_ORCH-0589_FLOATING_GLASS_HOME.md` — scope: 4 NEW primitives (`GlassIconButton`, `GlassSessionSwitcher`, `GlassBottomNav`, `GlassTopBar`) + 3 MODIFY (designSystem tokens + `app/index.tsx` nav replacement + `HomePage.tsx` bell deletion) + 1 OPTIONAL MODIFY (`CollaborationSessions.tsx` refactor path a or b). Variant B + C explicitly forbidden as dead code. 12 invariants, 10 anti-patterns, 9-step build-in-isolation-first discipline. Stacks on top of ORCH-0566 (still awaiting device verification); does not block.

> **2026-04-20 — ORCH-0589 INTAKE (S2 design-debt / ux)**: User-requested floating-glass home-page chrome inspired by Tinder reference screenshot. Four locked decisions after two rounds of Q&A: (1) no bottom 5-button action row — keep gestures; (2) session pills horizontally scroll inside one floating glass container, scrollbar hidden; (3) top bar is Swipe-page-only (hides on Explore/Likes/Chat/Profile); (4) new top-left Preferences button is NET-NEW — existing preferences triggers at `SwipeableCards.tsx:1852/1978` only render in empty states (verified via code read), so no migration/cleanup needed. Scope: chrome only (top bar + bottom nav) — `SwipeableCards` internals, `ExpandedCardModal`, and `PreferencesSheet` untouched. Designer dispatch at `prompts/DESIGN_ORCH-0589_FLOATING_GLASS_HOME.md` — must produce 2-3 selectable bottom-nav variants for user to pick. Builds on ORCH-0566 `glass.badge.*` tokens and `GlassBadge` primitive. Stacks on top of ORCH-0566 (awaiting device verification) — does not block.

> **2026-04-20 — ORCH-0566 IMPLEMENTOR COMPLETE + REVIEW APPROVED HIGH → AWAITING DEVICE VERIFICATION**: AH-163 mingla-implementor returned `outputs/IMPLEMENTATION_ORCH-0566_GLASS_CARD_LABELS_REPORT.md`. Four files: new `components/ui/GlassBadge.tsx` (370 lines, reusable glass primitive with Reduce-Transparency + Android-pre-API-31 fallback paths, BlurView `pointerEvents=none` hit-testing trap handled, reactive AccessibilityInfo listener), token additions to `constants/designSystem.ts` (+58 under `glass.badge.*` sub-namespace to avoid collision with existing onboarding `glass.*` — orchestrator endorsed), `SwipeableCards.tsx` (14 chip replacements: nextCard preview non-pressable, currentRec front pressable with haptic + stagger entry motion wired to existing `handleCardTap`), `CuratedExperienceSwipeCard.tsx` (stopBadge → circular glass variant; amber categoryBadge preserved). Post-implementation user-directed revision: "View more" chip deleted from both blocks, saved/scheduled brand chips relocated into their own row below the metadata row (renamed `viewMoreRow` → `stateBadgesRow`), 29 i18n `swipeable.view_more` keys cleaned from all locales. TS compile: 5 pre-existing errors, **0 new**. REVIEW VERDICT: **APPROVED HIGH** (10/10 gates — constitutional #2/#3/#8/#10 satisfied; 9 invariants preserved; grep confirms zero stale style refs; `matchBadge` untouched; `categoryBadge` untouched). 4 SCs PASS code-level (SC-5/6/9/10/12); 8 SCs DEFERRED to user device verification (SC-1/2/3/4/7/8/11 require GPU/visual/haptic/framerate evidence). **Next: user commits + iOS + Android OTA + device-tests on both platforms — tester dispatch SKIPPED per `feedback_headless_qa_rpc_gap.md` inverse reasoning (headless cannot validate visual/haptic/perf outputs). Post-PASS protocol on device confirm OR implementor rework dispatch on device fail.**

> **2026-04-20 — ORCH-0566 DESIGNER COMPLETE + APPROVED → IMPLEMENTOR READY**: AH-162 mingla-designer (COMPONENT mode) returned `outputs/SPEC_ORCH-0566_GLASS_CARD_LABELS.md` (18 sections, 12 SCs, full token list). Two designer discoveries endorsed on review: (1) excluded `CuratedExperienceSwipeCard.categoryBadge` from glass — brand amber accent on dark info panel, not a plastic chip over imagery; (2) added `galleryIndicator` to scope for visual chip-family coherence. Five-layer glass stack locked: BlurView 24 + tint floor + top highlight + hairline border + shadow. Reduce-Transparency + Android API <31 fallback with identical silhouette. Fully-round pill (`radius.full`). WCAG AA math verified. Perf budget 60fps with platform-split fallback plan. Zero hardcoded values — new `glass.*` token namespace. Spec gate: 10/10 review pass. AH-163 implementor dispatch at `prompts/IMPL_ORCH-0566_GLASS_CARD_LABELS.md` ready — scope: 1 NEW `GlassBadge.tsx` + 3 MODIFY (designSystem tokens + SwipeableCards 14 sites + CuratedExperienceSwipeCard 1 site). Build-in-isolation-first discipline mandated. Zero commit / zero OTA in this dispatch (Post-PASS protocol owns both).

> **2026-04-19 — ORCH-0566 INTAKE (S2 design-debt)**: User-requested premium glassmorphism for all labels on discovery cards. Currently flat `rgba(107,114,128,0.8)` gray plastic. Designer dispatch at `prompts/DESIGN_ORCH-0566_GLASS_CARD_LABELS.md`.

> **2026-04-21 03:45 UTC — ORCH-0558 CLOSED GRADE A — DEVICE VERIFIED ON iOS + ANDROID.** Retroactively closes ORCH-0532, ORCH-0556, ORCH-0557, ORCH-0534 Grade A (bundled). Collab match promotion is now reliable, deterministic, observable at DB + device level. 5 migrations applied + edge fn deployed + EAS OTA both platforms + user device-tested. 6 new invariants registered in `Mingla_Artifacts/INVARIANT_REGISTRY.md`. 2 discoveries opened: ORCH-0564 (enable dblink + stress harness) + ORCH-0565 (unrelated admin delete-user column mismatch). See `outputs/QA_ORCH-0558_BULLETPROOF_COLLAB_MATCH_REPORT.md` for evidence chain. Launch blocker cleared.

> Last updated: 2026-04-20 00:50 UTC (**ORCH-0558 NEW S1 launch-blocker**: User device-retested post-0556 OTA. Match DID NOT promote, no push, no in-app, no Cards-tab visibility. Orchestrator traced via MCP: 3 compounding root-cause-tier failures — (A) ghost saved_card from April 19 direct-save (ORCH-0534, deferred) has experience_id=NULL; new trigger found via card_data->>'id' shortcut, attached votes, but no new saved_card row → no realtime event → no notification. (B) checkForMatch queries experience_id only; blind to NULL-column rows. (C) concurrency race under READ COMMITTED: 2 swipes in same millisecond can both see count=1 and both return early. IA-mode dispatch at `prompts/FORENSICS_ORCH-0558_BULLETPROOF_COLLAB_MATCH.md` demands structural reliability (advisory lock / SERIALIZABLE / ON CONFLICT), invariant enforcement (experience_id NOT NULL), column alignment, telemetry, concurrency test harness at N=2/3/5/10. 0532/0556/0557 CLOSE-PENDING until 0558 lands. Process lesson: "theoretical fits without concurrency+runtime proofs fail at device-retest" — V3 demands structural proofs before code.) + 2026-04-19 late evening (**ORCH-0556 P0 REGRESSION SURFACED BY 0532 DEVICE TEST + ORCH-0557 P3 TOAST COLOR**: User device-tested post-ORCH-0532 OTA and hit `ERROR 42P01 "relation public.session_decks does not exist"` on 2nd right-swipe. **Dormant P0 from 2026-04-17:** migration `20260417000003_drop_session_decks.sql` dropped table but didn't update `check_mutual_like` trigger that reads from it. Pre-0532 direct-save bypass hid the break. Now match promotion is 100% broken. ORCH-0532 withdrawn from close-pending until 0556 fixed. Combined dispatch at `prompts/IMPL_ORCH-0556_0557_TRIGGER_REPAIR_AND_TOAST.md` — migration adds `card_data JSONB` to `board_user_swipe_states` + rewrites trigger to read from swipe-states instead of dropped table + client passes cardData via `trackSwipeState`. Toast color `'info'` → `'success'` bundled.) + 2026-04-19 late evening (**ORCH-0532 QA CONDITIONAL PASS — CODE+DB PROVEN, DEVICE PENDING OTA**: Tester returned `outputs/QA_ORCH-0532_COLLAB_QUORUM_FIX_REPORT.md`. 0 P0/P1/P2/P3, 2 P4 praise. 20/20 SCs evaluated, 0 FAIL. Mathematical proofs: SC-16 (user-auth INSERT rejected), SC-17 (trigger works), SC-20 (zero user-auth callers). Regression: 0 new anomaly rows at T+10min. 30-min silent-fail window ACTIVE on user device (migration live but pre-fix OTA still on phone). Not full CLOSE yet — requires push + OTA iOS + OTA Android + device smoke retest + SC-18 48h monitoring.) + 2026-04-19 late evening (**ORCH-0532 IMPLEMENTATION COMPLETE + APPROVED HIGH — DEPLOY PENDING**: implementor returned 8-file change set (net −125 LoC, 1 new migration, 1 new helper, 5 new i18n keys). All 7 invariants have code-level enforcement. 20/20 SCs PASS code-level. Zero new TS errors. REVIEW VERDICT: APPROVED. Tester dispatch ready at `prompts/TESTER_ORCH-0532_COLLAB_QUORUM_FIX.md`. Report: `outputs/IMPLEMENTATION_ORCH-0532_REPORT.md`. User action required BEFORE tester: commit → `supabase db push` migration → verify RLS → EAS OTA iOS + Android, all within 30min window.) + 2026-04-19 late evening (**ORCH-0532 SPEC COMPLETE + APPROVED HIGH**: Forensics SPEC returned `outputs/SPEC_ORCH-0532_COLLAB_QUORUM_FIX.md` — 12 sections, 20 SCs, 23 test cases, 7 invariants. Spec author corrected 2 dispatch errors: boardsSessions lives in AppStateManager React useState (not Zustand) — fix routes via prop chain; simpler RLS pattern `current_user='postgres' OR auth.role()='service_role'` verified against live DB. New `collabSaveCard` helper consolidates collab-save logic. Toast Q1-B specified with 4 i18n keys. Implementor dispatch `prompts/IMPL_ORCH-0532_COLLAB_QUORUM_FIX.md` ready. Deploy order: migration FIRST, mobile OTA within 30min window.) + 2026-04-19 15:29 UTC (**ORCH-0526 CLOSED — GRADE A — PRODUCTION LIVE**: Deterministic Rules Engine charter shipped end-to-end across 7 commits (M1 DB + 12 RPCs → M2 edge fn → M3.1-M3.4 admin UI + 16 components + CI script → M4.1 flag RPC → M4.2 tester CONDITIONAL PASS → flag flip at 15:29:27 UTC). DEC-036 logged. 6 invariants preserved. 4 BLOCKED SCs pending user 24h browser spot-check (low-risk). v2 backlog: ORCH-0531/0533/0538/0539. New admin surface: **Rules Filter tab** under AI Validation — Grade A.) + 2026-04-19 late evening (**ORCH-0532 V2 re-audit COMPLETE + APPROVED**: mechanism proven HIGH via JSONB fingerprint (all 6 anomaly rows have 26-33-key client-payload shape; trigger produces 2-key stub); gate-failure trigger honestly MEDIUM with 8 candidates enumerated, no live repro. **Option D remains the fix** — trigger-agnostic, removes the direct-save sink structurally. Per-user differential confirmed: creator has 0 swiped_right rows ever; partner has 3. ORCH-0537 registered as optional parallel instrumentation task. SPEC prompt remains valid pending user Q1/Q2 decisions. Report: `outputs/INVESTIGATION_ORCH-0532_V2_REAUDIT.md`. Lesson logged: "pattern-fits ≠ proven — use distinguishing evidence before HIGH.") + 2026-04-19 late evening (**ORCH-0532 re-audit dispatched — prior HIGH verdict withdrawn**: user flagged that their experience does not correlate with the Amendment-1 hypothesis windows (cold-launch / just-created / just-accepted). Orchestrator concurs: "pattern fits evidence" ≠ "mechanism proven". V2 deep re-audit prompt at `prompts/FORENSICS_ORCH-0532_V2_DEEP_REAUDIT.md` — starts from zero, enumerates 10 candidate questions (Q-A–Q-J), requires mechanistic elimination or live reproduction before any RC claim, demands explicit confidence-level honesty. SPEC prompt `prompts/SPEC_ORCH-0532_COLLAB_QUORUM_FIX.md` PAUSED. Side-discoveries 0533/0534/0535 remain independent; 0536 "resolved-by-fix" status revoked. Lesson logged: "A hypothesis that fits existing data without live-reproduction is MEDIUM confidence, not HIGH.") + 2026-04-19 evening (**ORCH-0532 INVESTIGATION AMENDED** initially HIGH, downgraded MEDIUM on user challenge: user device-falsified original RC-1; forensics rescanned and found the real mechanism — **dual-source-of-truth divergence** between `useSessionManagement.availableSessions` (hook-local) and Zustand `boardsSessions` (global). When the two disagree on "am I in a session?", the primary swipe gesture's guard in `SwipeableCards` fails, falls into `onCardLike` → `AppHandlers.handleSaveCard` (which uses the OTHER source) → direct INSERT into `board_saved_cards` bypassing the `check_mutual_like` trigger. DB proof: user's session has saved-card row but ZERO swipe-state rows — mechanically impossible under any other path. Option D fix: gut collab branch from `handleSaveCard`, unify session-state source. 2 new invariants established (I-SESSION-STATE-SINGLE-SOURCE, I-HANDLE-SAVE-CARD-IS-SOLO-ONLY). Constitutional #2 violation. Side discoveries: ORCH-0533 (curated swipe-state gap), 0534 (historical data), 0535 (RLS lacks quorum check), 0536 (dual-mode architecture — resolved by 0532 fix). Spec prompt pending 2 user decisions. Lesson: when two functions gate on "same" state, verify they read from the same source, not just that both have a check.) + 2026-04-19 (**ORCH-0532 INTAKE** — user-reported collab quorum bug: single right-swipe lands on Cards tab without ≥2 participant agreement. S1 invariant violation.) + 2026-04-18 (**ORCH-0503 CLOSED A** — v3 fix user device retest 6/6 PASS; mixed-deck interleave correct; new invariant `I-PROGRESSIVE-DELIVERY-INTERLEAVE-AUTHORITATIVE` established; commit + two-platform OTA pending user action; Phase 2.4 dispatch next) + 2026-04-19 late (Phase 2.3 rework shipped — ORCH-0491 + ORCH-0498 closed; ORCH-0493 RC#1 partial) + 2026-04-18 (**ORCH-0511 Vibes-Future** program charter registered DEFERRED) + 2026-04-18 (**ORCH-0511 vibe pipeline audit COMPLETE** HIGH confidence — 6 side-issues registered ORCH-0512–0517; **ORCH-0514 PROMOTED to S1** as critical-path unlock-gate blocker for vibes; report at `outputs/INVESTIGATION_ORCH-0511_VIBE_PIPELINE_AUDIT.md`)
> Orchestrator version: 1.0
> This is the single source of truth for all Mingla product reality.

---

## Product Surface Inventory

| Surface | Domain | Key Files | Grade | Items Tracked | Coverage |
|---------|--------|-----------|-------|---------------|----------|
| Auth & Session | Mobile + Backend | useAuthSimple.ts, session management | Mixed (2A, 4B, 1C) | 7 | Partial |
| Onboarding | Mobile | OnboardingFlow.tsx, useOnboardingStateMachine.ts | Mixed (3A, 9F) | 12 | Weak |
| Discovery / Explore | Mobile + Backend | SwipeableCards.tsx, deckService.ts, RecommendationsContext.tsx | Strong (38A, 5B, 0C, 12F) | 55 | Strong |
| Collaboration Sessions | Mobile + Backend | SessionViewModal, CollaborationSessions.tsx, BoardSettingsDropdown.tsx | Mixed (7A, 4F) | 11 | Partial |
| Social / Friends | Mobile + Backend | friendsService.ts, ConnectionsPage.tsx | Mixed (1A, 1B, 5F) | 7 | Weak |
| Notifications | Mobile + Backend | notify-dispatch, NotificationsModal.tsx | Mixed (7A, 2B, 3F) | 12 | Partial |
| Saved / Boards | Mobile | LikesPage.tsx, boardService.ts | All F | 5 | Unaudited |
| Profile & Settings | Mobile | ProfilePage.tsx, AccountSettings.tsx | Mixed (3A, 1B, 6F) | 10 | Weak |
| Map & Location | Mobile + Backend | DiscoverMap.tsx, get-nearby-people | All F | 16 | Unaudited |
| Chat / DM | Mobile + Backend | messagingService.ts, useMessages.ts | All F | 8 | Unaudited |
| Payments & Subscriptions | Mobile + Backend | useRevenueCat.ts, PaywallScreen.tsx | Mixed (8A, 6B, 1C) | 15 | Strong |
| Calendar & Scheduling | Mobile | CalendarTab.tsx, calendarService.ts | All F | 8 | Unaudited |
| Holidays & Events | Mobile + Backend | holiday-experiences, CustomHolidayModal.tsx | Mixed (1B, 6F) | 7 | Weak |
| People Discovery | Mobile + Backend | DiscoverScreen.tsx, get-person-hero-cards | All F | 10 | Unaudited |
| Pairing System | Mobile + Backend | pairingService.ts, send-pair-request | Mixed (3A, 7F) | 10 | Weak |
| Sharing & Invites | Mobile + Backend | ShareModal.tsx, send-phone-invite | All F | 10 | Unaudited |
| Post-Experience & Reviews | Mobile + Backend | PostExperienceModal.tsx, record-visit | All F | 9 | Unaudited |
| Booking | Mobile | bookingService.ts | All F | 2 | Unaudited |
| Reporting & Moderation | Mobile + Admin + Backend | ReportModal, admin Reports page | All F (2×S0, 1×S1) | 3 | Unaudited |
| Network & Offline | Cross-cutting | networkMonitor.ts | Mixed (1B, 4F) | 5 | Weak |
| State & Cache | Cross-cutting | queryKeys.ts, Zustand stores | Mixed (5A, 3F) | 8 | Partial |
| Chat Responsiveness | Cross-cutting | messagingService.ts | All A | 4 | Strong |
| Hardening Infrastructure | Cross-cutting | withTimeout.ts, mutationErrorToast.ts | All A | 3 | Strong |
| Error Handling | Cross-cutting | ErrorBoundary.tsx, edgeFunctionError.ts | All F | 5 | Unaudited |
| Security & Auth | Cross-cutting | RLS policies, admin auth | Mixed (1A, 1B, 1C, 2D) | 13 | Weak |
| Deep Linking | Cross-cutting | deepLinkService.ts | Mixed (1B, 3F) | 4 | Weak |
| App Lifecycle | Cross-cutting | AppStateManager.tsx, AnimatedSplashScreen.tsx, useForegroundRefresh.ts | Mixed (2A, 10F) | 12 | Weak |
| Analytics & Tracking | Cross-cutting | appsFlyerService.ts, mixpanelService.ts | Mixed (1A, 7F) | 8 | Weak |
| Weather & External | Cross-cutting | weatherService.ts, busynessService.ts, geocodingService.ts | Mixed (2A, 4F) | 6 | Partial |
| UI Components | Cross-cutting | Toast.tsx, InAppBrowserModal.tsx | Mixed (3A, 7F) | 10 | Weak |
| Admin Panel | Admin | PlacePoolManagementPage.jsx, admin-seed-places | Mixed (1A, 7F) | 8 | Weak |
| Code Quality | Cross-cutting | tsconfig.json, all .ts/.tsx files | All A | 1 | Strong |

---

## User Journey

### Phase 1: Acquisition
Install → Welcome Screen → OAuth (Google/Apple)

### Phase 2: Onboarding
Phone OTP → Gender → Details → Value Prop → Intent → Location → Preferences → Friends → Collab → Consent → Deck Ready

### Phase 3: Core Loop
Explore (deck swipe) → Save → Schedule → Invite → Collaborate → Go → Review

### Phase 4: Retention
Calendar reminders → Push notifications → Holiday experiences → Re-engagement → Subscription upgrade

### Phase 5: Social
Friend discovery → Pair requests → DM → Map presence → Activity feed

---

## Issue Registry

### Section 1: Authentication & Session Management

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0001 | Phone OTP verification (onboarding) | Auth | S1 | quality-gap | verified | B | 2026-03-31 | INVESTIGATION_AUTH_WAVE1.md — backend solid, client in onboarding scope |
| ORCH-0002 | Session persistence | Auth | S1 | quality-gap | verified | B | 2026-03-25 | _hasHydrated gate + Zustand persistence |
| ORCH-0003 | Token refresh / expiry handling | Auth | S0 | bug | closed | A | 2026-03-24 | Commit aa9cfd68 |
| ORCH-0004 | Sign-out cleanup | Auth | S0 | bug | closed | A | 2026-03-31 | QA_ORCH-0004_SIGNOUT_CLEANUP_REPORT.md — RevenueCat/Mixpanel added, 401 rewired, dead code removed |
| ORCH-0005 | Google Sign-In flow | Auth | S1 | quality-gap | verified | C | 2026-03-31 | INVESTIGATION_AUTH_WAVE1.md — works but brittle string matching in retry logic |
| ORCH-0006 | Apple Sign-In flow | Auth | S1 | quality-gap | verified | B | 2026-03-31 | INVESTIGATION_AUTH_WAVE1.md — clean, minor fire-and-forget name risk |
| ORCH-0007 | Zombie auth prevention | Auth | S1 | bug | verified | B | 2026-03-23 | Commit 2a96c8f6 |
| ORCH-0348 | Auto-assign beta tester flag on signup + backfill existing users | Auth | S2 | missing-feature | closed | A | 2026-04-09 | Migration 20260409700000 applied. Column default → true, all existing rows backfilled. Verified: 0 users with false. |

### Section 2: Onboarding

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0008 | State machine progression | Onboarding | S0 | unaudited | open | F | — | — |
| ORCH-0009 | GPS requirement enforcement | Onboarding | S1 | unaudited | open | F | — | — |
| ORCH-0010 | Preference save reliability | Onboarding | S1 | bug | closed | A | 2026-03-23 | Commit 302b74d5 |
| ORCH-0011 | Resume after interruption | Onboarding | S1 | unaudited | open | F | — | — |
| ORCH-0012 | Audio recording (voice review) | Onboarding | S2 | unaudited | open | F | — | — |
| ORCH-0013 | Country/language picker | Onboarding | S2 | unaudited | open | F | — | — |
| ORCH-0014 | Intent selection step | Onboarding | S1 | unaudited | open | F | — | — |
| ORCH-0015 | Travel mode selection | Onboarding | S2 | unaudited | open | F | — | — |
| ORCH-0016 | Friends & pairing onboarding step | Onboarding | S2 | unaudited | open | F | — | — |
| ORCH-0017 | Consent step | Onboarding | S1 | unaudited | open | F | — | — |
| ORCH-0018 | Skip button responsiveness | Onboarding | S2 | bug | closed | A | 2026-03-23 | Commit 76cd2ca7 |
| ORCH-0350 | Update Terms/Privacy URLs app-wide to usemingla.com | Cross-cutting | S2 | missing-feature | closed | A | 2026-04-09 | QA_ORCH-0350-0351 PASS. All legal URLs centralized in urls.ts → usemingla.com. 660 lines hardcoded text deleted. InAppBrowserModal for Profile + Paywall. |
| ORCH-0351 | SMS consent checkbox gate before OTP on onboarding | Onboarding | S1 | missing-feature | closed | A | 2026-04-09 | QA_ORCH-0350-0351 PASS. Checkbox + TCPA consent text. CTA gated. InAppBrowserModal links. Full accessibility. |
| ORCH-0370 | OTP multi-channel support — add WhatsApp and voice call fallback channels via Twilio Verify | Onboarding | S2 | missing-feature | closed | A | 2026-04-10 | QA PASS. 16/16 tests, 0 defects. send-otp accepts channel param (sms/whatsapp/call). OTP sub-step shows fallback buttons. Consent text covers all channels. verify-otp untouched. |
| ORCH-0386 | App-wide i18n — translate all UI strings + move language picker to first onboarding screen | Onboarding + Cross-cutting | S2 | missing-feature | closed | A | 2026-04-11 | QA PASS. 13/13 SC, 5/5 regressions, 0 defects. i18next + react-i18next wired. Language picker first onboarding screen. 171 keys EN+ES. All onboarding strings use t(). |
| ORCH-0387 | Settings language picker uses stale hardcoded 10-language list instead of canonical 25 | Profile & Settings | S3 | quality-gap | open | F | — | Found during ORCH-0386 investigation |
| ORCH-0388 | 37 hardcoded 'en-US' locale strings in date/currency formatting — wrong for non-US users | Cross-cutting | S2 | bug | open | F | — | Found during ORCH-0386 investigation |

### Section 3: Discovery / Explore (Card Deck)

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0019 | Pool-first card pipeline | Discovery | S0 | architecture-flaw | closed | A | 2026-03-20 | Multiple commits |
| ORCH-0020 | Curated card generation | Discovery | S0 | architecture-flaw | closed | A | 2026-03-20 | Commits 77b92984, 27d4ea8b |
| ORCH-0021 | Category system (13 categories) | Discovery | S1 | architecture-flaw | closed | A | 2026-03-21 | Commits 6c7b2429, e42429af |
| ORCH-0022 | Admin seeding pipeline | Discovery | S1 | missing-feature | closed | A | 2026-03-20 | Commit 1bab3a10 |
| ORCH-0023 | Admin pool management (UI) | Discovery | S2 | missing-feature | closed | A | 2026-03-20 | Commits 9af5b5e4, 9493a697 |
| ORCH-0024 | Admin Card Pool page (rewrite) | Discovery | S1 | architecture-flaw | closed | A | 2026-03-21 | Commit e58d8769 |
| ORCH-0025 | Per-category exclusion enforcement | Discovery | S1 | bug | closed | A | 2026-03-21 | Commits 984f8be7, a408e1b1 |
| ORCH-0026 | City/country TEXT contract | Discovery | S1 | data-integrity | closed | A | 2026-03-21 | Commit 5db8dbe8 |
| ORCH-0027 | Card photo integrity | Discovery | S1 | data-integrity | closed | A | 2026-03-22 | Commit 7ca26b48 |
| ORCH-0028 | Curated nearest-place selection | Discovery | S2 | bug | closed | A | 2026-03-22 | Commit 35c10157 |
| ORCH-0029 | Curated per-user travel times | Discovery | S2 | bug | closed | A | 2026-03-22 | Commit 35c10157 |
| ORCH-0030 | Card photo coverage | Discovery | S1 | data-integrity | closed | A | 2026-03-22 | Commits 7ca26b48, 267b29b0 |
| ORCH-0031 | Broken icons (ICON_MAP) | Discovery | S2 | bug | closed | A | 2026-03-22 | Commit 88f2d43f |
| ORCH-0032 | "Now" filter live opening hours | Discovery | S1 | bug | closed | A | 2026-03-22 | Commit 28be9a63 |
| ORCH-0033 | Batch transition hang (16s) | Discovery | S1 | bug | closed | A | 2026-03-22 | Commit 28be9a63 |
| ORCH-0034 | Prefetch key alignment | Discovery | S2 | bug | closed | A | 2026-03-22 | Commit 28be9a63 |
| ORCH-0035 | Triple duplicate API calls | Discovery | S2 | performance | verified | B | 2026-03-22 | One hidden flaw remains |
| ORCH-0036 | ActionButtons analytics | Discovery | S3 | missing-feature | closed | A | 2026-03-22 | Commit dba7b3f0 |
| ORCH-0037 | Expanded card travel mode icon | Discovery | S3 | bug | closed | A | 2026-03-22 | Commit dba7b3f0 |
| ORCH-0038 | Coordinates replacing text in location | Discovery | S1 | bug | closed | A | 2026-03-31 | QA_DETERMINISTIC_DECK_CONTRACT_REPORT.md — custom location now deterministic, GPS fallback eliminated |
| ORCH-0039 | Currency changes with GPS | Discovery | S1 | bug | open | F | — | INVESTIGATION_DECK_AND_DISCOVER.md |
| ORCH-0040 | priceLevel enum on paired cards | Discovery | S2 | bug | open | F | — | INVESTIGATION_DECK_AND_DISCOVER.md |
| ORCH-0041 | Curated cards missing Schedule button | Discovery | S1 | bug | open | F | — | INVESTIGATION_DECK_AND_DISCOVER.md |
| ORCH-0042 | Paired view repeated experiences | Discovery | S2 | bug | verified | B | 2026-03-24 | Commit 0ae81113 |
| ORCH-0043 | Policies open phone browser | Discovery | S2 | bug | open | F | — | User report |
| ORCH-0044 | Schedule picker behind modal | Discovery | S2 | bug | open | F | — | User report |
| ORCH-0045 | No schedule confirmation | Discovery | S2 | ux | open | F | — | User report |
| ORCH-0046 | Can't use current date to schedule | Discovery | S2 | bug | open | F | — | User report |
| ORCH-0047 | Slug on saved page | Discovery | S2 | bug | open | F | — | User report |
| ORCH-0048 | Curated/category round-robin broken | Discovery | S1 | bug | closed | A | 2026-03-31 | QA_DETERMINISTIC_DECK_CONTRACT_REPORT.md — category interleave rewritten with round-robin balancer |
| ORCH-0049 | Schools in cards | Discovery | S1 | bug | closed | A | 2026-03-24 | Commit 0ae81113 |
| ORCH-0050 | AI Card Quality Gate | Discovery | S1 | architecture-flaw | verified | B | 2026-03-26 | Commits c9708465, 97a5dfd0 |
| ORCH-0051 | Flowers category too broad | Discovery | S2 | quality-gap | verified | B | 2026-03-26 | Commit 97a5dfd0 |
| ORCH-0052 | Curated AI stop descriptions missing | Discovery | S2 | bug | open | F | — | User report |
| ORCH-0053 | Push delivery via OneSignal | Discovery | S0 | bug | closed | A | 2026-03-22 | Commits 163ce5f1, 469b0f11 |
| ORCH-0054 | Per-category deck balancing | Discovery | S2 | bug | closed | A | 2026-03-22 | Commit 7fef7ed0 |
| ORCH-0055 | Curated card exclusion enforcement | Discovery | S1 | bug | closed | A | 2026-03-22 | Commit 7fef7ed0 |
| ORCH-0056 | Category balancing | Discovery | S2 | bug | closed | A | 2026-03-22 | Commit 7fef7ed0 |
| ORCH-0057 | Children's venue filter | Discovery | S1 | bug | closed | A | 2026-03-22 | Commit dba7b3f0 |
| ORCH-0058 | Empty category pools (operational) | Discovery | S2 | missing-feature | open | F | — | Needs seeding |
| ORCH-0059 | Discover retry responsiveness | Discovery | S2 | bug | closed | A | 2026-03-23 | Commit 2a96c8f6 |
| ORCH-0060 | Pull-to-refresh fix | Discovery | S2 | bug | closed | A | 2026-03-23 | Commit 2a96c8f6 |
| ORCH-0061 | Card rendering (all types) | Discovery | S1 | bug | closed | A | 2026-03-25 | Commits 5702067b + Pass 5 |
| ORCH-0062 | Swipe mechanics | Discovery | S1 | bug | closed | A | 2026-03-25 | Commits acf7e508 + Pass 5 |
| ORCH-0063 | Empty pool state | Discovery | S2 | quality-gap | verified | B | 2026-03-20 | HTTP 200 with empty array |
| ORCH-0064 | Preferences → deck pipeline | Discovery | S0 | architecture-flaw | closed | A | 2026-03-24 | Commit 79d0905b |
| ORCH-0065 | Solo mode | Discovery | S1 | quality-gap | verified | B | 2026-03-31 | INVESTIGATION_PREFS_DECK_CONTRACT.md — core contract verified, deck deterministic |
| ORCH-0066 | Collab mode parity | Discovery | S0 | architecture-flaw | closed | A | 2026-04-06 | QA_ORCH-0066_COLLAB_PREF_PARITY_REPORT.md + INVESTIGATION_UNIFY_PREFERENCE_SHEETS_REPORT.md — Phase 1: save/load parity + UNION aggregation (14/14 PASS). Phase 2: dead CollaborationPreferences.tsx deleted. All sub-issues closed. |
| ORCH-0266 | Double pagination — card pool unreachable | Discovery | S0 | bug | closed | A | 2026-03-31 | QA_DETERMINISTIC_DECK_CONTRACT_REPORT.md — duplicate .range() removed, all 200 pool cards reachable |
| ORCH-0267 | Travel time not enforced in deck | Discovery | S1 | bug | closed | A | 2026-03-31 | QA_DETERMINISTIC_DECK_CONTRACT_REPORT.md — hard filter added, out-of-range cards excluded |
| ORCH-0268 | NULL price tier passthrough | Discovery | S2 | bug | closed | A | 2026-03-31 | QA_DETERMINISTIC_DECK_CONTRACT_REPORT.md — NULL price_level now filtered before deck assembly |
| ORCH-0272 | Cross-page dedup — pages return same 20 cards + UI freeze | Discovery | S0 | bug | closed | A | 2026-04-02 | QA_ORCH_0272_CROSS_PAGE_DEDUP_REPORT.md — ON CONFLICT predicate fixed, error throw + circuit breaker added. Migration applied live. 7/7 tests PASS. |
| ORCH-0301 | Swiped cards reappear in same session — duplicate cards in deck | Discovery | S1 | bug | spec-ready | F | — | FORENSIC_MASTER_REPORT.md — SwipeableCards.tsx:938 clears removedCards on batch append. Effect can't distinguish append from replacement. |
| ORCH-0302 | Exact address not persisting in preferences sheet — truncated to short form | Discovery | S1 | bug | spec-ready | F | — | FORENSIC_MASTER_REPORT.md — PreferencesSheet.tsx:530 saves suggestion.displayName (short) instead of suggestion.fullAddress. |
| ORCH-0303 | Under 10 cards then exhausted despite large pool | Discovery | S1 | bug | spec-ready | F | — | FORENSIC_MASTER_REPORT.md — limit:20 hardcoded in 3 places + datetime filter kills 60%+ evening cards + curated gets disproportionately small allocation. |
| ORCH-0304 | GPS location stuck on old city (Raleigh) — staleTime:Infinity + undefined refreshKey | Discovery | S0 | bug | spec-ready | F | — | FORENSIC_MASTER_REPORT.md — 3 compounding failures: staleTime:Infinity, undefined refreshKey in DiscoverScreen, one-shot GPS never resets. |
| ORCH-0305 | Card Pool page doesn't show AI-approved cards (64 fine dining Raleigh approved but not visible) | Admin | S1 | bug | open | F | — | User report 2026-04-04 — AI-categorized and approved places not appearing in card pool UI |
| ORCH-0306 | Cannot generate single cards for entire batch of available cards | Admin | S1 | bug | open | F | — | User report 2026-04-04 — generate cards button doesn't process all available cards |
| ORCH-0307 | Card generation has no progress feedback — no batch count, no live stats, just success message | Admin | S1 | ux | open | F | — | User report 2026-04-04 — unlike seeding/photo download which show live progress, card gen is fire-and-forget |
| ORCH-0308 | Pair request acceptance not updating in real-time for SENDER | Pairing | S1 | bug | open | F | — | User report 2026-04-04 — sender sends request, receiver accepts, sender's UI doesn't update. Realtime subscription exists but may not fire (RPC bypass, user_a/user_b ordering, or WebSocket disconnect). |
| ORCH-0309 | 921 cards had wrong categories — generated before AI recategorized, never updated | Discovery | S0 | data-integrity | closed | A | 2026-04-05 | SQL fix applied live: synced all card_pool.categories with place_pool.ai_categories. Structural fix: generate-single-cards now syncs categories on duplicate detection instead of just skipping. |
| ORCH-0310 | 724 AI-approved places globally have zero cards generated | Discovery | S1 | missing-feature | open | F | — | DB evidence: LEFT JOIN card_pool on place_pool_id shows 724 approved+active places with no card_pool entry. Blocked by ORCH-0305/0306. |
| ORCH-0311 | custom_lat/custom_lng NULL in DB despite custom location being set | Discovery | S1 | bug | open | F | — | DB evidence: preferences row has custom_location string but custom_lat=null, custom_lng=null. Fire-and-forget save not persisting coordinates. |
| ORCH-0312 | query_pool_cards RPC times out on cold call for large result sets (Baltimore 1335 cards) | Discovery | S1 | performance | open | F | — | Log evidence: "canceling statement due to statement timeout" + discover-cards ERROR 12008ms for Baltimore bbox. |
| ORCH-0313 | Timezone double-application in datetime filter — picks wrong day for scheduled dates | Discovery | S0 | bug | closed | A | 2026-04-05 | datetimePref already encodes local midnight as UTC. Edge function applied longitude offset (-5h) on top, pushing midnight April 6 (Monday) back to April 5 23:00 (Sunday). Most fine dining closed Sunday → 5 cards instead of 14+. Fixed: extract day directly from datetimePref without offset. |
| ORCH-0314 | Admin card pool dashboard shows counts by seeding_category not card_pool.categories — misleading | Admin | S2 | ux | open | F | — | Dashboard shows 32 fine dining for Raleigh but only 20 have fine_dining in card_pool.categories. Rest were AI-recategorized to casual_eats etc. |
| ORCH-0315 | Hidden CATEGORY_MIN_PRICE_TIER floor kills AI-approved fine dining cards with low price tiers | Discovery | S1 | architecture-flaw | closed | A | 2026-04-05 | scorePoolCards had a bougie price floor for fine_dining. 4 AI-approved cards (Brodeto, M Sushi, Omakase, The Pit) permanently invisible because price_tier was chill/comfy. Removed — AI is the sole quality gate. |
| ORCH-0273 | place_pool → card_pool data drift (13+ fields stale) | Discovery | S1 | architecture-flaw | closed | A | 2026-04-02 | QA_PLACE_POOL_CARD_POOL_SYNC_REPORT.md — Unified sync trigger, 16 fields + curated composites. Old website trigger replaced. 10/10 PASS. P3: redundant city/country trigger (cleanup). |
| ORCH-0274 | Photo backfill pipeline broken — no city filter, timeouts, no job tracking | Discovery | S1 | architecture-flaw | closed | A | 2026-04-02 | QA_PHOTO_BACKFILL_PHASE1_BACKEND_REPORT.md + QA_PHOTO_BACKFILL_PHASE2_ADMIN_UI_REPORT.md — Full job system: 2 tables, 9 actions, city-scoped batches, auto-advance, persist across reloads. P1 13/13 + P2 10/10 PASS. |

| ORCH-0392 | Travel mode pills overflow section container — "Driving" bleeds right edge after i18n label change | Discovery | S2 | regression | closed | A | 2026-04-11 | flexWrap: "wrap" added to travelModesGrid. Visually verified EN + ES on-device. Parent: ORCH-0386. |
| ORCH-0402 | Calendar button invisible on birthday hero + no birthday push notifications | Discovery | S2 | ux + missing-feature | closed | A | 2026-04-11 | QA_ORCH-0402_CALENDAR_BUTTON_AND_BIRTHDAY_PUSH_REPORT.md — 17/17 criteria PASS, 4/4 regressions clean. CalendarButton inverted prop, 5-tier push pipeline via pg_cron. |
| ORCH-0403 | Generic/thin card descriptions on some categories (Play especially) — one-liners vs rich descriptions | Discovery | S2 | quality-gap | open | F | — | User report 2026-04-13. Hypothesis: data pipeline treats categories unevenly, or Google metadata sparse for Play venues. |
| ORCH-0405 | Saved/scheduled cards should reappear in deck with label ("You have this saved") — deck never empty | Discovery | S2 | missing-feature | open | F | — | User report 2026-04-13. Feature request: re-surface saved/scheduled cards with badge so deck always has content. |
| ORCH-0406 | Price tier labels wrong/hardcoded on expanded single card view + full card view audit needed | Discovery | S1 | bug | open | F | — | User report 2026-04-13. Price label on expanded view doesn't reflect actual price_tier. Audit both collapsed + expanded views for single and curated cards. |

### Section 4: Collaboration Sessions

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0067 | UI consolidation (single entry point) | Collaboration | S2 | design-debt | closed | A | 2026-03-23 | Commit 15fe8742 |
| ORCH-0068 | Board exit responsiveness | Collaboration | S2 | bug | closed | A | 2026-03-23 | Commit 76cd2ca7 |
| ORCH-0069 | Session load performance | Collaboration | S1 | performance | closed | A | 2026-03-24 | Commit 3ee1bce9 |
| ORCH-0070 | Session creation | Collaboration | S1 | unaudited | open | F | — | — |
| ORCH-0071 | Invite send/receive | Collaboration | S1 | unaudited | open | F | — | — |
| ORCH-0072 | Real-time sync | Collaboration | S1 | unaudited | open | F | — | — |
| ORCH-0073 | Voting mechanics | Collaboration | S1 | unaudited | open | F | — | — |
| ORCH-0074 | Session end / results | Collaboration | S2 | unaudited | open | F | — | — |
| ORCH-0075 | Concurrent mutation safety | Collaboration | S1 | unaudited | open | F | — | — |
| ORCH-0316 | Dead code: CollaborationPreferences.tsx deleted (1,753 lines, zero imports) | Collaboration | S1 | architecture-flaw | closed | A | 2026-04-06 | INVESTIGATION_UNIFY_PREFERENCE_SHEETS_REPORT.md — File was never imported. PreferencesSheet already handled both modes. Deleted. Parent: ORCH-0066. |
| ORCH-0317 | Collab time_slot missing from PreferencesSheet save + normalizer doesn't clear time_of_day | Collaboration | S0 | bug | closed | A | 2026-04-06 | QA_ORCH-0066_COLLAB_PREF_PARITY_REPORT.md — time_slot added to save payload, normalizer clears both fields on "now". 14/14 PASS. |
| ORCH-0318 | Travel constraint aggregation MEDIAN → Math.max (UNION) | Collaboration | S0 | bug | closed | A | 2026-04-06 | QA_ORCH-0066_COLLAB_PREF_PARITY_REPORT.md — Math.max replaces median. MODE_RANK for travel mode. DATE_RANK for date option. timeSlots UNION array. 14/14 PASS. |
| ORCH-0319 | custom_lat/lng missing from PreferencesSheet collab save + load | Collaboration | S1 | bug | closed | A | 2026-04-06 | QA_ORCH-0066_COLLAB_PREF_PARITY_REPORT.md — Coordinates added to save, structured use_gps_location loading, coords restored on load. 14/14 PASS. |
| ORCH-0320 | Legacy time_of_day / time_slot — collab load reads time_slot||time_of_day | Collaboration | S1 | bug | closed | A | 2026-04-06 | QA_ORCH-0066_COLLAB_PREF_PARITY_REPORT.md — Prefers time_slot, falls back to time_of_day. Both written on save. 14/14 PASS. |
| ORCH-0321 | PreferencesSheet collab load restores date_option with kebab + legacy compat | Collaboration | S1 | bug | closed | A | 2026-04-06 | QA_ORCH-0066_COLLAB_PREF_PARITY_REPORT.md — KEBAB_TO_DATE_OPTION map handles both formats. 14/14 PASS. |
| ORCH-0322 | RLS policy gap — board_session_preferences has no INSERT policy for non-creator participants | Collaboration | S1 | security | open | F | — | INVESTIGATION_COLLAB_PREF_PARITY_REPORT.md Finding 8 — Original migration only has SELECT + UPDATE (creator only). Needs separate investigation. |
| ORCH-0443 | Collab session blank deck — isBoardSession gate permanently false + 7 competing seeders + race condition | Collaboration | S0 | architecture-flaw | implemented | B | 2026-04-16 | ACTUAL root cause: `isBoardSession` checked `session_type==='board'` but sessions created with `'group_hangout'` — deck query NEVER fired. Fix: `e751c8f3` (gate fix) + `ec9bbbf4` (seeding consolidation) + `9d7a73a2` (exhaustion flag race) + backfill migration + edge function deployed. Needs device verification. |
| ORCH-0439 | Board settings UX — consolidate floating dropdown + manage modal + edit modal into single bottom sheet | Collaboration | S2 | design-debt | closed | A | 2026-04-16 | QA CONDITIONAL PASS (P2 resolved). Commits 468c33bb + b5e49763. BoardSettingsDropdown.tsx: bottom sheet with inline-editable name, members list, leave/delete buttons. ManageBoardModal.tsx deleted. Double-confirm P2 fixed. |
| ORCH-0440 | Session deletion not broadcast to other users — no realtime DELETE listener, no notification, stale UI | Collaboration | S1 | bug | closed | A | 2026-04-16 | QA CONDITIONAL PASS. Commit 468c33bb. realtimeService DELETE listener, SessionViewModal auto-close + toast, notifySessionDeleted(), REPLICA IDENTITY FULL migration applied. |
| ORCH-0441 | Stale session pills after deletion — invited user still sees greyed-out pill for deleted session | Collaboration | S1 | bug | closed | A | 2026-04-16 | QA CONDITIONAL PASS. Commit 468c33bb. useSessionManagement Realtime subscription on invites + participants. REPLICA IDENTITY FULL on 3 tables. |
| ORCH-0442 | Collaboration pill bar — greyed-out pills clipped at top (overflow:hidden) + scroll arrows mispositioned | Collaboration | S2 | bug | closed | A | 2026-04-16 | QA CONDITIONAL PASS. Commit 468c33bb. overflow:hidden removed, paddingVertical added, arrows repositioned after + button, 24px centered. |
| ORCH-0323 | generate-curated-experiences standalone aggregation stale — MIN, no time_slot, legacy location parse | Collaboration | S2 | design-debt | open | F | — | INVESTIGATION_COLLAB_PREF_PARITY_REPORT.md Findings 9+10 — Not used in deck flow but will break if called with session_id. |
| ORCH-0437 | Per-category interleaved deck with strict category/intent alternation — both solo and collab | Discovery + Collaboration | S2 | design-debt | in-progress | F | — | User request 2026-04-15. Collab interleaving fixed (commit 2bb3a91f). Pending: testing + OTA. |
| ORCH-0438 | Collab session lifecycle — stale error cache, missing state machine, premature deck generation | Collaboration | S1 | architecture-flaw | open | F | — | 2026-04-15. Creator opens session before invitee accepts → deck fails → error cached → invitee later sees cards but creator stuck on error. Band-aid applied (commit 881db8fe). Structural investigation dispatched. |
| ORCH-0451 | Stale deck shown during pref change — placeholderData leak + false "You've seen it all" flash | Discovery | S1 | bug | implemented | B | 2026-04-17 | Commit 13fac033. isPlaceholderData guard added to sync + clear-refresh effects. previousDeckIdsRef reset restored (ORCH-0431 parity). Persisted exhaustion cleared on pref change. Needs device verification. |
| ORCH-0452 | Preferences-to-deck determinism audit (8-handoff chain) | Discovery | S0 | architecture-flaw | investigated | — | 2026-04-17 | INVESTIGATION_ORCH-0452_PREFERENCES_TO_DECK_DETERMINISM.md — Chain is airtight. Root cause of "wrong category cards": **curated cards (intent-based) bypass category filtering** + multi-category place overlap. Product decision needed. |
| ORCH-0453 | Fire-and-forget preference DB write causes cold-start stale prefs | Discovery | S2 | quality-gap | implemented | B | 2026-04-17 | Commit 13fac033. Retry-once + toast + AsyncStorage stash pattern. Foreground resume syncs pending prefs. Solo only — collab already resilient. Needs device verification. |
| ORCH-0469 | Brunch/Lunch/Casual pref change shows false "seen everything" in warm app — cold start fixes it | Discovery | S1 | bug | closed | **B** | 2026-04-17 | **QA Retest #1 PASS** (6/6 tests) — `outputs/QA_ORCH-0469-0472_REPORT_RETEST_1.md`. Rework: `outputs/IMPLEMENTATION_ORCH-0469-0472_REPORT_v2.md`. Original impl: `outputs/IMPLEMENTATION_ORCH-0469-0472_REPORT.md`. Spec: `outputs/SPEC_ORCH-0469-0472_DECK_CACHE_AND_EMPTY_VS_EXHAUSTED.md`. Investigation: `outputs/INVESTIGATION_ORCH-0469_DECK_STATE_POLLUTION.md`. Constitutional #9 restored, I-EMPTY-CACHE-NONPERSIST established. Grade B pending device smoke of T-02/T-03/T-13 pre-OTA. |
| ORCH-0472 | EMPTY and EXHAUSTED deck states render identical copy ("You've seen everything") + fire same Mixpanel event | Discovery | S2 | ux | closed | **B** | 2026-04-17 | **Closed jointly with ORCH-0469** — QA Retest #1 PASS. UI split now renders distinct copy/icon/CTA/Mixpanel event for EMPTY vs EXHAUSTED. `cards:swipeable.no_matches_title` + `no_matches_subtitle` keys across 29 locales. `Deck Empty Filter` Mixpanel event added. `session_mode` pre-existing hardcode fixed as side benefit. |
| ORCH-0473 | Dead-code TS errors in RecommendationsContext.tsx — `fetchSessionDeck` + `SessionDeckResponse` refs | Discovery | S3 | quality-gap | open | F | — | Discovered by implementor during ORCH-0469 impl. Pre-existing dead code from ORCH-0446 refactor. Currently at lines ~724 and ~865 (post-ORCH-0469 line-shift). Cleanup candidate, not urgent. Clean up alongside next context refactor. |
| ORCH-0474 | `discover-cards` silently degrades 3 failure modes to one "pool-empty" response; collab multi-category session sees "no spots" while server holds 1,595 matching rows | Discovery + Backend | S1 | architecture-flaw | **CLOSED** | **B** | 2026-04-17 | **CLOSED Grade B 2026-04-17.** QA retest cycle 1 PASS (`outputs/QA_ORCH-0474_REPORT_RETEST_1.md`) — T-06 empirically validated new `auth-required` response on live v118 with spec-compliant body shape. 0 P0/P1/P2, 1 P3 (ORCH-0486, non-blocking), 4 P4 notes. Deploy: discover-cards v118 on Mingla-dev (`ezbr_sha256: 3cf3ae84…`). Pipeline: Investigation → Spec → Implementation → Structural QA cycle 0 (CONDITIONAL PASS) → Runtime retest cycle 1 (PASS). Establishes INV-042 (no conflating runtime errors with data signals) + INV-043 (no unconditional fall-throughs) — both locked in INVARIANT_REGISTRY.md. Constitutional #3 + #9 restored. Grade B (not A) because device-layer runtime verification (T-12-T-15, T-27) remains user-executed before App Store submission; structural verification is exhaustive. |
| ORCH-0475 | New `filter-outline` icon name unknown to app icon whitelist — EMPTY state renders without icon | Discovery | S3 | ux | awaiting-spec | F | — | Introduced by ORCH-0472 UI split. `<Icon name="filter-outline" ...>` at SwipeableCards.tsx:1601 logs `[Icon] Unknown icon name: "filter-outline"` — rendering falls through without the intended icon. State still renders correctly (title + subtitle + CTA), icon circle is just empty. Fix options: add `filter-outline` to icon whitelist, OR swap to an already-whitelisted name. Single-line change. |
| ORCH-0486 | Mixed-deck (category + curated) — category fetch failure silently absorbed when curated succeeds; AUTH_REQUIRED/PIPELINE_ERROR UI never fires | Discovery | P3 | quality-gap | awaiting-spec | F | — | Discovered by tester in ORCH-0474 cycle 0. When a deck has BOTH category pills AND curated pills, if `categoryPromise` rejects with `DeckFetchError` (auth-required or pipeline-error) while `curatedPromise` resolves, `deckService.fetchDeck` falls through to return curated-only cards with `serverPath` defaulting to `'pipeline'`. The tagged error discriminant is lost. User sees cards but no retry affordance for the failed category side. Fix is ~3 lines in `app-mobile/src/services/deckService.ts:fetchDeck` around line 482: even when curated succeeded, if `singlesResult.error instanceof DeckFetchError`, carry its `serverPath` into the final return. **Why low severity:** rare in practice — auth/pipeline failures typically hit both calls (same token, same backend), activating the existing "both failed" branch correctly. No crash, no security, no data loss. Not a blocker for ORCH-0474 cycle 1. |
| ORCH-0485 | Deck takes several seconds to show cards after preference change — not the <1s target promised by ORCH-0340 singles-first path | Discovery | S1 | performance | **RC#1 closed (Phase 2.1) — RC#2/RC#3 pending Phase 2.2** | F | — | User report 2026-04-17. Investigation `outputs/INVESTIGATION_ORCH-0485_DECK_PREF_CHANGE_LATENCY.md` §3 + §12 amendment. **RC#1 RESOLVED 2026-04-18 via Phase 2.1 CONDITIONAL PASS:** `useUserLocation.ts:152` query key no longer contains `refreshKey`; location only invalidates on location-field changes (customLat/Lng/Location/useGpsFlag). New invariant `I-LOCATION-INVALIDATE-ON-LOCATION-ONLY` established. DiscoverScreen.tsx:709 mirror also fixed. **RC#2 (singles-first hardcoded)** + **RC#3 (zero-singles skips partial-delivery)** remain open — absorbed into ORCH-0490 Phase 2.2 (progressive delivery contract). Device latency measurement (p50 ≤ 1000ms warm) pending post-OTA; if missed, follow-up ORCH not Phase 2.1 rework. |
| ORCH-0490 | **PROGRAM — Deck reliability & session persistence master initiative** | Discovery + Collaboration + State | S1 | program | charter | F | — | Charter 2026-04-17 `outputs/PROGRAM_ORCH-0490_DECK_RELIABILITY_AND_PERSISTENCE.md`. Bundles ORCH-0485 + ORCH-0491 + ORCH-0492 + ORCH-0493 + ORCH-0494 under 4-phase pipeline (Phase 0 verification → Phase 1 spec → Phase 2 phased implementation → Phase 3 full regression → Phase 4 lock-in). User JTBDs: (1) solo pref change → fast cards, no lying states; (2) collab shared deck absorbs multi-user pref changes; (3) last-card position survives mode switch + app close. Methodical, clean refactor; no big rewrites. Phase 0 dispatches imminent. |
| ORCH-0491 | Solo↔Collab mode switch: preserve swipe progress, parallel live decks, eliminate mode-transition skeleton | Discovery + Collaboration | S1 | architecture-flaw | charter | F | — | Evidence `outputs/ARCHITECTURE_WHY_DECK_RELOADS_ON_SOLO_COLLAB_PILL_SWITCH.md`. Three simultaneous reload triggers at `RecommendationsContext.tsx:846-898`: state wipe (clears `accumulatedCardsRef`, `sessionServedIdsRef`, batch seed), invalidateQueries `['deck-cards']`, natural key change (solo categories vs collab union). Single `useDeckCards()` hook with swappable inputs — no mechanism to keep both decks alive. Target: per-context state `{solo, collab: Map<sessionId>}` + both hooks live; user swipe position preserved across mode toggles. Part of ORCH-0490 Phase 2.3. |
| ORCH-0492 | Session persistence — last-card position restored across app close + mode switches | Discovery + State & Cache | S1 | architecture-flaw | **baseline established — Phase 0-B complete 2026-04-18** | F | 2026-04-18 | Phase 0-B complete `outputs/INVESTIGATION_ORCH-0492_PERSISTENCE_BASELINE.md`. **Charter §4 correction:** persistence story is RICHER than charter assumed — `SwipeableCards.tsx:932-949` DOES persist `currentCardIndex` + `removedCards` per-mode-per-refreshKey; React Query persister hydrates populated `deck-cards` across cold launch (24h); `@mingla/lastDeckQueryKey` enables solo cold-start instant render. BUT JTBD-3 is PROVEN BROKEN by three independent code sites: (RC#1) `SwipeableCards.tsx:854-857` actively deletes prior-mode position on mode change; (RC#2 → ORCH-0499) Zustand partialize does not persist `currentMode`/`currentSession`, always lands in Solo on cold launch; (RC#3) `@mingla/lastDeckQueryKey` is solo-only, collab never gets instant-read. 7-fragment × 4-interruption matrix populated (H confidence across cells). Constitutional #14 PARTIAL (same-mode works, cross-mode doesn't). Spec writer now has baseline. Part of ORCH-0490 Phase 2.5 — reverse the cross-mode wipe, add mode/session persistence, extend instant-read to collab. |
| ORCH-0493 | Collab multi-participant preference change pressure — "changes in background, shown in next card" | Collaboration | S1 | architecture-flaw | **verified ⚠️ PARTIAL — Phase 2.6 scope CONFIRMED ON** | F | 2026-04-18 | Phase 0-C verification complete `outputs/INVESTIGATION_ORCH-0493_COLLAB_PRESSURE_VERIFICATION.md`. Verdict: propagation pipeline sound (realtime → `onSessionUpdated` → `setAllParticipantPreferences` → `collabDeckParams` recompute → new deck fetch), `placeholderData` + `isDeckPlaceholder` guard prevent skeleton flash (background: ✅). BUT when new deck lands on mid-swipe participant, `SwipeableCards.tsx:979-980` treats it as full replacement → wipes `removedCards` + `currentCardIndex`. `sessionServedIdsRef` ALSO REPLACED at `RecommendationsContext.tsx:836` on `batchSeed===0` path. User's claim "shown in next card" = FALSE — shown in CURRENT card replaced in place. RC#1 (SwipeableCards full-reset signal too broad — H confidence) + RC#2 (dedup memory replaced not merged — M confidence pending device repro). Constitutional #13 violated. S1-S6 matrix: S1✅, S2✅, S3⚠️, S4✅ w/ 2× fetch, S5✅, S6✅. Bundle ORCH-0496 zombie-subscription cleanup into Phase 2.6. |
| ORCH-0494 | False EMPTY race on preference change — 20s safety timer flips completion flag before cards land; polluted `trackDeckEmptyFilter` analytics | Discovery | S1 | architecture-flaw | **closed — Phase 2.1 CONDITIONAL PASS 2026-04-18** | **A** | 2026-04-18 | Phase 2.1 implementation `outputs/IMPLEMENTATION_ORCH-0490_PHASE_2.1_DECOUPLE_LOCATION_REPORT.md` + QA `outputs/QA_ORCH-0490_PHASE_2.1_DECOUPLE_LOCATION_REPORT.md`. Fix: (1) 20s safety timer DELETED from `RecommendationsContext.tsx:708-721`; (2) `hasStartedRef` declaration removed; (3) EMPTY branch rewritten to require server-verdict only — `serverPath === 'pool-empty'` OR `(isDeckBatchLoaded && !deckHasMore)` — no longer depends on `hasCompletedFetchForCurrentMode`; (4) `trackDeckEmptyFilter` at `SwipeableCards.tsx:1593` gated on `serverPath === 'pool-empty'` — filter-to-empty no longer fires the analytic. New invariant `I-DECK-EMPTY-IS-SERVER-VERDICT` established. 6/7 SCs structurally PASS. Device latency measurement (SC-2.1-02) deferred to post-OTA. Expected 60-90% drop in `trackDeckEmptyFilter` event volume — product team notified. `filter-outline` icon discoverability (ORCH-0475) is separate and still open. |
| ORCH-0496 | Zombie realtime subscriptions + dead query-key lookups after ORCH-0446 partial rebuild | Collab + State & Cache | S3 | documentation-drift | open | F | — | Discovered 2026-04-18 via ORCH-0493 investigation §7 HF-1/2/3/4. Four dead-code sites from incomplete ORCH-0446 cleanup: (1) `realtimeService.ts:550-563` subscribes to `board_session_preferences` filter — table DROPPED in migration `20260417000002`; (2) `realtimeService.ts:583-595` subscribes to `session_decks` INSERTs — table DROPPED in `20260417000003`, callback `onDeckRegenerated` explicitly no-op in `useBoardSession.ts:377-380`; (3) `RecommendationsContext.tsx:884` calls `queryClient.getQueryData<SessionDeckResponse>(['session-deck', ...])` — cache key never written since ORCH-0446, `hasCachedCards` always false for collab → collab re-entry never hits cache-first path; (4) `useBoardSession.ts:349` invalidates `['session-deck', sessionId]` on participant join — no-op. Not blocking but confusing for future readers and possibly wasting Supabase channel budget. Bundle into ORCH-0490 Phase 2.6 as ~10-line cleanup. |
| ORCH-0497 | `useBoardSession.updatePreferences` triple-writes same state on author device | Collab | S3 | quality-gap | open | F | — | Discovered 2026-04-18 via ORCH-0493 investigation §7 Contributing Factor #1. When a participant writes their own prefs: (a) optimistic `setAllParticipantPreferences` (line 239-248), (b) `loadSession(sessionId)` re-reads + sets state again (line 254), (c) realtime UPDATE `onSessionUpdated` fires back locally and sets state AGAIN (line 313-330). Three writes of equivalent data on author device. Benign (idempotent) but causes extra renders and one extra DB round-trip. Non-author devices only receive (c). Low priority; defer to post-ORCH-0490. |
| ORCH-0495 | Client-initiated warm-ping of `discover-cards` on app resume/foreground — eliminate 4–9s Deno cold start | Discovery | S2 | performance | open | F | — | **(Renumbered from proposed ORCH-0488 in ORCH-0485 investigation §9 to avoid ID collision with admin RPC cache-sensitivity ORCH-0488 at line 495.)** `discover-cards` supports `warmPing: true` (edge fn line 397) but no client caller was found. Adding a foreground-resume warm-ping would keep the isolate warm through typical session gaps. Complementary to ORCH-0490 — candidate for Phase 2.2 bundle or deferred to post-program. |
| ORCH-0498 | Mixed-deck progressive-delivery double-wipe on solo pref change | Discovery | S1 | architecture-flaw | charter | F | — | Discovered 2026-04-18 via Phase 0-A amendment §12.2 (see `outputs/INVESTIGATION_ORCH-0485_DECK_PREF_CHANGE_LATENCY.md` §12). Solo analog of ORCH-0493 RC#1 — same disease, different trigger. Mechanism: on a MIXED deck (≥1 category + ≥1 curated pill), `onSinglesReady` in `useDeckCards.ts:148-162` writes `setQueryData(singles)` when singles resolve (~1s) → UI renders singles-only. User may start swiping. Later, full `fetchDeck` promise resolves with 1:1 interleaved `regular+curated` at `deckService.ts:484-503` — positions 0,1,2,3,4 become `reg[0], cur[0], reg[1], cur[1], reg[2]` instead of `reg[0..4]`. React Query overwrites cache. `recommendations` state changes. `SwipeableCards.tsx:979-980` sees first-5-IDs differ → WIPE #2: `setRemovedCards(new Set()) + setCurrentCardIndex(0)`. Any swipes in the singles-only window are lost. Occurs on EVERY solo user with curated pills on EVERY pref change. Confidence: H on mechanism (code-proven), M on user-visible outcome (depends on swipe timing; device test would confirm). Shares fix with ORCH-0491 + ORCH-0493 RC#1 (narrow "deck expanded, same session" signal vs full-replacement signal). Absorb into ORCH-0490 Phase 2.3 or dedicated slice — spec-writer call. |
| ORCH-0499 | `currentMode` + `currentSession` not persisted across cold launch — user always lands in Solo | Discovery + State & Cache | S1 | architecture-flaw | charter | F | — | Discovered 2026-04-18 via Phase 0-B `outputs/INVESTIGATION_ORCH-0492_PERSISTENCE_BASELINE.md` RC#2. Zustand partialize at `app-mobile/src/store/appStore.ts:206-216` intentionally EXCLUDES `isInSolo`, `currentSession`, `availableSessions`, `pendingInvites` — per comment at line 210-214: *"refreshed from the database on every app open"*. This was the correct design for ORCH-0209 (state survival) which optimized for freshness. JTBD-3 reframes the requirement: the user explicitly wants to resume the session they left. Default `isInSolo: true` at line 139 means every cold launch lands in Solo regardless of prior mode. Combined with ORCH-0492 RC#1 (`SwipeableCards.tsx:854-857` deletes prior-mode position on mode change) and ORCH-0492 RC#3 (`@mingla/lastDeckQueryKey` is solo-only), this is the third of three code sites that together block JTBD-3. Spec writer must balance freshness-vs-resumption tradeoff — likely by persisting mode+sessionId AND triggering validation re-fetch on resume (not either-or). Core of ORCH-0490 Phase 2.5. |
| ORCH-0500 | Dead React Query cache entries accumulate in persister after pref changes | State & Cache | S3 | quality-gap | open | F | — | Discovered 2026-04-18 via Phase 0-B HF#3. `REACT_QUERY_OFFLINE_CACHE` hydrates `deck-cards` entries regardless of whether `deckPrefsHash` in Zustand still matches. Pref change bumps `deckPrefsHash`, creates new query key — but OLD deck-cards entry under OLD key survives in the persisted blob. Dormant (new query uses new key), but consumes space toward the 1.5MB Android CursorWindow cap. Not critical today (fresh installs well under cap). Fix directions: prune entries not matching current `deckPrefsHash` on hydration, OR scope the persister to a single active key. Defer to post-ORCH-0490 unless the 1.5MB cap is hit in beta testing. |

### Section 5: Social / Friends

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0076 | Friend request send/accept/decline | Social | S1 | bug | verified | B | 2026-03-23 | Commit 76cd2ca7 |
| ORCH-0077 | Link intent flow | Social | S2 | unaudited | open | F | — | — |
| ORCH-0078 | Block/unblock/remove responsiveness | Social | S2 | bug | closed | A | 2026-03-23 | Commit 76cd2ca7 |
| ORCH-0079 | Friend-based content visibility | Social | S1 | unaudited | open | F | — | — |
| ORCH-0080 | Friend search (search-users) | Social | S2 | unaudited | open | F | — | Edge function `search-users` deleted as dead code (ORCH-0390). Feature never built. |
| ORCH-0081 | View friend profile | Social | S2 | unaudited | open | F | — | — |
| ORCH-0082 | Mute/unmute friends | Social | S3 | unaudited | open | F | — | — |

### Section 6: Notifications

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0083 | Push delivery (OneSignal) | Notifications | S1 | quality-gap | verified | B | 2026-03-21 | Investigation report |
| ORCH-0084 | Pair accepted notification | Notifications | S2 | missing-feature | closed | A | 2026-03-21 | Commit 376cd237 |
| ORCH-0085 | Pair activity preference enforcement | Notifications | S2 | bug | closed | A | 2026-03-21 | Commit 376cd237 |
| ORCH-0086 | Dead type cleanup | Notifications | S3 | design-debt | closed | A | 2026-03-21 | Commit 376cd237 |
| ORCH-0087 | In-app notifications | Notifications | S1 | unaudited | open | F | — | — |
| ORCH-0088 | Deep link from notification | Notifications | S2 | quality-gap | verified | B | 2026-03-23 | Commit 15fe8742 |
| ORCH-0089 | Notification for deleted content | Notifications | S2 | unaudited | open | F | — | — |
| ORCH-0090 | iOS app badge | Notifications | S2 | bug | closed | A | 2026-03-23 | Commits d4c6725e, ea655d36 |
| ORCH-0091 | DM unread realtime | Notifications | S2 | bug | closed | A | 2026-03-23 | Commit ea655d36 |
| ORCH-0092 | Notification send observability | Notifications | S2 | quality-gap | verified | B | 2026-03-23 | Commit ea655d36 |
| ORCH-0093 | Realtime subscription lifecycle | Notifications | S1 | architecture-flaw | closed | A | 2026-03-23 | Commit ea655d36 |
| ORCH-0349 | Acted-on notifications not auto-clearing (in-sheet + out-of-sheet) | Notifications | S1 | bug | closed | A | 2026-04-09 | QA PASS. DB trigger + graceful stale handling + out-of-sheet cleanup. Migration 20260409800000. |
| ORCH-0407 | Push notifications fundamentally broken across systems — full audit of OneSignal pipeline, triggers, in-app behavior | Notifications | S1 | architecture-flaw | open | F | — | User report 2026-04-13. Systemic: which events trigger push? Which should but don't? In-app behavior? App feels dead without push activity. |

### Section 7: Saved Experiences / Boards

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0094 | Save/unsave experience | Saved | S1 | unaudited | open | F | — | — |
| ORCH-0095 | Board create/edit/delete | Saved | S1 | unaudited | open | F | — | — |
| ORCH-0096 | Board sharing | Saved | S2 | unaudited | open | F | — | — |
| ORCH-0097 | Board RSVP | Saved | S2 | unaudited | open | F | — | — |
| ORCH-0098 | Saved content cache | Saved | S2 | unaudited | open | F | — | — |

### Section 8: Profile & Settings

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0099 | Profile cold-start freshness | Profile | S2 | bug | closed | A | 2026-03-23 | Commit a268b19f |
| ORCH-0100 | Preference updates + authority | Profile | S1 | architecture-flaw | closed | A | 2026-03-23 | Commits 302b74d5, a268b19f |
| ORCH-0101 | Category filter → deck sync | Profile | S1 | bug | closed | A | 2026-03-23 | Commit a268b19f |
| ORCH-0102 | Account deletion | Profile | S0 | unaudited | open | F | — | — |
| ORCH-0103 | Subscription tier freshness | Profile | S1 | quality-gap | verified | B | 2026-03-23 | Commit cdd3cac0 |
| ORCH-0104 | Purchase error handling | Profile | S1 | bug | closed | A | 2026-03-23 | Commit cdd3cac0 |
| ORCH-0105 | Subscription management | Profile | S1 | unaudited | open | F | — | — |
| ORCH-0106 | Edit bio | Profile | S3 | unaudited | open | F | — | — |
| ORCH-0107 | Edit interests | Profile | S3 | unaudited | open | F | — | — |
| ORCH-0108 | Privacy controls | Profile | S2 | unaudited | open | F | — | — |
| ORCH-0109 | Billing management | Profile | S2 | unaudited | open | F | — | — |
| ORCH-0110 | Terms/Privacy screens | Profile | S2 | unaudited | open | F | — | — |
| ORCH-0352 | Beta feedback modal — end-to-end defects (freeze, stale state, audio leak, icon errors, close-path gaps) | Profile | S1 | bug | closed | A | 2026-04-09 | QA PASS (AH-051). Full audit found 4 defects (missing pause icon, orphaned success timer, unstable onClose, cached permissions). All fixed in clean pass (AH-050). Prior patches preserved. 5 files changed total. |
| ORCH-0353 | Permission storm on first landing — 4 OS dialogs fire on boot | App Lifecycle | S1 | ux | closed | A | 2026-04-09 | Device-verified PASS. Split OneSignal login/permission, removed auto location/camera/tracking from MobileFeaturesProvider, ATT wait→0. Zero dialogs on Home. |
| ORCH-0354 | Coach mark guided tour system (10-step, cross-tab, resumable) | App Lifecycle | S1 | missing-feature | implementing | F | 2026-04-09 | Spec: SPEC_ORCH-0349_COACH_MARK_SYSTEM.md. Design: Hybrid bottom card + self-highlight. Phase 1 pending. Prerequisite ORCH-0353 complete. |
| ORCH-0371 | Beta feedback — optional screenshot attachments (up to 10) | Profile | S3 | missing-feature | closed | A | 2026-04-11 | QA PASS (0 defects, 17/17 SC). Commit a666dee7. Migration applied, functions deployed. Report: QA_ORCH-0371_FEEDBACK_SCREENSHOTS_REPORT.md |
| ORCH-0373 | Friend profile screen overhaul — hide username, add bio + stats (places/streak/friends non-tappable), fix interests, wire chat avatar tap, wire onMessage (friends-only gate) | Profile + Chat | S1 | quality-gap | closed | A | 2026-04-11 | QA PASS 12/12 + rework approved. 5 files changed. Message button gated to friends-only. Reports: QA_ORCH-0373 + REWORK_MESSAGE_GATE. |
| ORCH-0374 | Friend profile — show GPS city instead of country code, and make interests visible to all viewers (not just friends) | Profile | S1 | quality-gap | closed | A | 2026-04-11 | Implementation approved. GPS city persisted to profiles.location on profile open. RLS policy added for public display interests read. Migration: 20260411000002. Deploy order: migration first, then OTA. |
| ORCH-0377 | Beta feedback — allow users to delete their own submitted feedback | Profile | S2 | missing-feature | implementing | F | — | Spec: SPEC_ORCH-0377_DELETE_FEEDBACK.md. 4 files, 13 success criteria. Dispatched to implementor. |
| ORCH-0375 | Own-profile + friend-profile stats decorative — placesVisited=0, streakDays=0 hardcoded despite real computation engine existing | Profile | S2 | quality-gap | investigated | F | — | Constitutional Rule #9 violation (no fabricated data). ProfilePage.tsx:330-331 and ViewFriendProfileScreen.tsx:243-244 hardcode zeros. enhancedProfileService.ts has working calculateUserAchievements(). GamifiedHistory.tsx already uses real data. Fix: wire useEnhancedProfile into both screens. |

### Section 9: Map & Location

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0111 | Map rendering (dual provider) | Map | S1 | unaudited | open | F | — | — |
| ORCH-0112 | User location tracking | Map | S1 | unaudited | open | F | — | — |
| ORCH-0113 | Map location update | Map | S2 | unaudited | open | F | — | — |
| ORCH-0114 | Nearby people display | Map | S1 | unaudited | open | F | — | — |
| ORCH-0115 | Person bottom sheet on map | Map | S2 | unaudited | open | F | — | — |
| ORCH-0116 | Place pins on map | Map | S2 | unaudited | open | F | — | — |
| ORCH-0117 | Place heatmap | Map | S3 | unaudited | open | F | — | — |
| ORCH-0118 | Map filter bar | Map | S3 | unaudited | open | F | — | — |
| ORCH-0119 | Layer toggles | Map | S3 | unaudited | open | F | — | — |
| ORCH-0120 | Map bottom sheet | Map | S2 | unaudited | open | F | — | — |
| ORCH-0121 | Curated route display | Map | S2 | unaudited | open | F | — | — |
| ORCH-0122 | Go Dark / privacy FAB | Map | S2 | unaudited | open | F | — | — |
| ORCH-0123 | Activity feed overlay | Map | S3 | unaudited | open | F | — | — |
| ORCH-0124 | Activity status picker | Map | S3 | unaudited | open | F | — | — |
| ORCH-0125 | Map cards hook | Map | S2 | unaudited | open | F | — | — |
| ORCH-0126 | Discover map integration | Map | S1 | unaudited | open | F | — | — |
| ORCH-0366 | Edge function timeouts — query_pool_cards optimized, timeout 12s→20s, dead curated timeout removed | Map | S1 | performance | closed | A | 2026-04-10 | User-verified working. Migration 20260410000005. Commit 6bdbbd30. |
| ORCH-0324 | User marker disappears from map — map shrunk to 1px when person pill active | Map | S1 | bug | investigated | F | — | INVESTIGATION_MAP_BUGS_REPORT.md — mapHidden: 1x1px confuses react-native-maps marker rendering. paused=true disables nearby-people query. |
| ORCH-0325 | Map centering broken — animateToRegion races with 1px→fullscreen layout transition | Map | S1 | bug | investigated | F | — | INVESTIGATION_MAP_BUGS_REPORT.md — Both state updates in same tick; animation fires before map expands. |
| ORCH-0326 | Mock strangers invisible — bidirectional "everyone" visibility required + code defaults to "off" | Map | S1 | bug | investigated | F | — | INVESTIGATION_MAP_BUGS_REPORT.md — get-nearby-people:103 requires requester visibility="everyone". Code defaults to "off" (line 42) contradicting schema default "friends". |
| ORCH-0328 | Hidden flaw: get-nearby-people defaults visibility to "off" instead of schema default "friends" | Map | S1 | bug | closed | A | 2026-04-06 | Fixed: default changed to "friends" in get-nearby-people:42. |
| ORCH-0329 | Visibility filtering fixed — TARGET-based filter + friends_of_friends implemented | Map | S1 | bug | closed | A | 2026-04-06 | QA_ORCH-0329_VISIBILITY_FIXES_REPORT.md — 11/11 PASS. Switch statement checks TARGET's level. FoF single query. Bidirectional check removed (DEC-012). |
| ORCH-0330 | Visibility dropdown fixed — optimistic update + rollback + toast on error | Map | S1 | bug | closed | A | 2026-04-06 | QA_ORCH-0329_VISIBILITY_FIXES_REPORT.md — onMutate instant cache, onError rollback + toast. |
| ORCH-0327 | Stranger seeding — global grid, DiceBear avatars, friend request interception, updated categories | Map | S1 | missing-feature | closed | A | 2026-04-06 | QA_ORCH-0327_STRANGER_SEEDING_REPORT.md — 14/14 PASS. Code ready. Seed NOT yet run — deploy first, then call seed_global_grid. |
| ORCH-0331 | Admin dashboard seed filter — all profile queries now exclude is_seed=true | Admin | S1 | bug | closed | A | 2026-04-06 | QA_ORCH-0327_STRANGER_SEEDING_REPORT.md — 8 admin queries fixed (T-11 through T-14 PASS). |
| ORCH-0355 | Map person profile fixed — crash eliminated (.maybeSingle), shared category pills added to PersonBottomSheet | Map | S1 | bug | closed | A | 2026-04-10 | QA PASS (AH-059). `.single()` → `.maybeSingle()` prevents crash. Interests pills for all relationships. 18/18 tests pass. |
| ORCH-0365 | Phone number PII removed from ViewFriendProfileScreen — useFriendProfile no longer selects phone | Profile | S1 | security | closed | A | 2026-04-10 | QA PASS (AH-057). Phone removed from interface, select, return, and UI. Zero references remain. |
| ORCH-0356 | Strangers on discover map can be messaged — should only show Add Friend + View Profile. DM must be gated to friends-only app-wide (pairing/collab invites must NOT be affected). | Map | S1 | security | closed | A | 2026-04-09 | QA PASS (AH-054). 3-layer defense: UI gate (PersonBottomSheet), service gate (messagingService), RLS gate (blocked_users). 13/13 SC, 17/17 tests. Pairing/collab/deletion confirmed safe. |
| ORCH-0360 | Map interactions — broken block handler (wrong column), silent push notification failure (idempotency), block modal sluggish, add friend UX gaps | Map | S1 | bug | closed | A | 2026-04-10 | QA PASS. blockService replaces raw upsert, idempotency key unique per attempt, InteractionManager defers modal, push response logged. 17/17 tests. |
| ORCH-0358 | Friends-of-friends filter fixed — MapPrivacySettings + DB CHECK constraint updated | Map | S1 | bug | closed | A | 2026-04-10 | QA PASS (AH-057). FoF added to VISIBILITY_LEVELS + LABELS. DB constraint ALTERed live (migration 20260410000003). Verified via pg_constraint query. |
| ORCH-0359 | Place pins now show name labels — truncated place/stop name below each pin | Map | S2 | ux | closed | A | 2026-04-10 | QA PASS (AH-059). Text label added to PlacePinContent. Curated shows first stop name, singles show place name. 15-char truncation. |
| ORCH-0361 | Avatar disappearance fixed — 3s tracksViewChanges window for image loading | Map | S1 | bug | closed | A | 2026-04-10 | QA PASS (AH-059). Person markers `tracksViewChanges={true}` for 3s then false. Prevents permanent fallback on slow image load. |
| ORCH-0378 | Map pin labels redesigned — orange pill with "Category · Place Name", full text no truncation, widened wrappers | Map | S2 | ux | closed | A | 2026-04-11 | User-verified on device. PlacePin.tsx: orange pill (rgba(235,120,37,0.85)), getReadableCategoryName + title, no maxWidth/numberOfLines constraints. 3 iterations (v1 pill, v2 content, v3 no truncation). |
| ORCH-0379 | Fix pin tap regression + hide label on selection — anchor/tappable added to Markers, isSelected prop threaded through pin chain | Map | S1 | regression | closed | A | 2026-04-11 | User-verified on device. anchor={{x:0.5,y:0.27}} + tappable on both Markers. isSelected hides label pill when bottom sheet open. 3 files changed. |
| ORCH-0409 | Map avatars intermittently disappear — possible ORCH-0385 regression or incomplete fix (different trigger than background return) | Map | S1 | regression | open | F | — | User report 2026-04-13. ORCH-0385 closed 2026-04-11 for background-return trigger. User still experiencing disappearance with unknown trigger. Closing+reopening app restores. |
| ORCH-0410 | Android discover map fundamentally broken — pan/scroll issues, labels cut off, not fluid like iOS | Map | S1 | architecture-flaw | open | F | — | User report 2026-04-13. Platform parity issue. Gesture handler conflicts, text scaling, map tile provider differences suspected. Related: ORCH-0111. |
| ORCH-0429 | Android map markers (avatars + places) rendering as lines — bitmap capture producing degenerate visuals | Map | S1 | regression | open | F | — | User report 2026-04-14. Both person pins and place pins render as thin lines on Android. Likely bitmap snapshot dimension collapse. Related: ORCH-0410 fixes landed same day. |

### Section 10: Direct Messaging & Chat

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0127 | Send/receive messages | Chat | S1 | unaudited | open | F | — | — |
| ORCH-0128 | Message list rendering | Chat | S2 | unaudited | open | F | — | — |
| ORCH-0129 | Conversation list | Chat | S1 | unaudited | open | F | — | — |
| ORCH-0130 | Chat presence (online/typing) | Chat | S2 | unaudited | open | F | — | — |
| ORCH-0131 | Broadcast receiver (realtime) | Chat | S2 | unaudited | open | F | — | — |
| ORCH-0132 | Messaging realtime | Chat | S1 | unaudited | open | F | — | — |
| ORCH-0133 | DM email notification | Chat | S3 | unaudited | open | F | — | — |
| ORCH-0134 | Chat status line | Chat | S3 | unaudited | open | F | — | — |
| ORCH-0357 | Blocked/unfriended/deleted users still messageable — message field should be hidden, replaced with status banner explaining why ("You blocked this person" / "User deleted their account") | Chat | S1 | security | closed | A | 2026-04-09 | QA PASS (AH-054). Three banners (blocked/unfriended/deleted) with hidden input. Account deletion confirmed regression-free. |
| ORCH-0367 | Block/friend mutual exclusion — accept clears blocks, block cancels pending requests, stale data fixed | Chat + Social | S0 | data-integrity | closed | A | 2026-04-10 | User-verified: Seth+Arifat can message. Migration 20260410000004. Commit 6bdbbd30. |
| ORCH-0408 | Quoted/reply message in DM compressed to invisibility — can't read quoted content | Chat | S2 | bug | open | F | — | User report 2026-04-13. Quote-reply preview too compressed to read. Likely max-height or line-clamp too aggressive. |

### Section 11: Payments & Subscriptions

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0135 | Paywall screen | Payments | S0 | quality-gap | verified | B | 2026-03-31 | INVESTIGATION_PAYMENTS_WAVE1B.md |
| ORCH-0136 | Custom paywall screen | Payments | S1 | quality-gap | verified | B | 2026-03-31 | INVESTIGATION_PAYMENTS_WAVE1B.md |
| ORCH-0137 | RevenueCat integration | Payments | S0 | closed | closed | A | 2026-03-31 | INVESTIGATION_PAYMENTS_WAVE1B.md |
| ORCH-0138 | Subscription service | Payments | S1 | quality-gap | verified | C | 2026-03-31 | INVESTIGATION_PAYMENTS_WAVE1B.md |
| ORCH-0139 | Creator tier gating | Payments | S2 | quality-gap | verified | B | 2026-03-31 | INVESTIGATION_PAYMENTS_WAVE1B.md |
| ORCH-0140 | Feature gate enforcement | Payments | S1 | bug | verified | B | 2026-03-31 | INVESTIGATION_PAYMENTS_WAVE1B.md — session limits now enforced. Remaining gap: referral tier expiry (ORCH-0144) |
| ORCH-0141 | Swipe limit (free users) | Payments | S1 | bug | verified | B | 2026-03-31 | INVESTIGATION_PAYMENTS_WAVE1B.md — paywall now triggers, PanResponder feedback works. Remaining gap: client-authoritative count (OB-02) |
| ORCH-0142 | Referral processing | Payments | S2 | bug | verified | B | 2026-03-31 | QA_PAYMENTS_EXPIRY_TRIAL_REPORT.md — referral has finite expiry, tier correct. Remaining: no UI for "days remaining" (cosmetic) |
| ORCH-0143 | Referral tier: server 'pro', client 'elite' | Payments | S0 | bug | closed | A | 2026-03-31 | QA_PAYMENTS_CLEAR_BUGS_REPORT.md |
| ORCH-0144 | Referral bonus months never expire | Payments | S0 | bug | closed | A | 2026-03-31 | QA_PAYMENTS_EXPIRY_TRIAL_REPORT.md — date-based expiry, no cron |
| ORCH-0145 | Session creation limit not enforced | Payments | S1 | bug | closed | A | 2026-03-31 | QA_PAYMENTS_CLEAR_BUGS_REPORT.md |
| ORCH-0146 | Swipe paywall doesn't trigger (stale ref) | Payments | S1 | bug | closed | A | 2026-03-31 | QA_PAYMENTS_CLEAR_BUGS_REPORT.md |
| ORCH-0147 | Silent swipe blocking after limit | Payments | S2 | quality-gap | closed | A | 2026-03-31 | Fixed with ORCH-0146 — PanResponder now shows paywall |
| ORCH-0148 | useEffectiveTier can downgrade (misleading comment) | Payments | S2 | quality-gap | closed | A | 2026-03-31 | Fixed with ORCH-0143 — comment corrected in useSubscription.ts |
| ORCH-0149 | Trial abuse: delete+re-signup = infinite Elite | Payments | S1 | bug | closed | A | 2026-03-31 | QA_PAYMENTS_EXPIRY_TRIAL_REPORT.md — phone-hash table, checked at onboarding |
| ORCH-0372 | Price tier restructure: 3 tiers (Free/Pro/Elite) → 2 tiers (Free/Mingla+) | Payments | S0 | architecture-flaw | closed | A | 2026-04-11 | QA CONDITIONAL PASS (P1 reworked). 19/23 code tests PASS, 14 UNVERIFIED (device). DB migration applied, 3 edge functions deployed, ~22 frontend files updated, 2 deleted. Full pipeline: forensic → spec → W1 backend → W2 frontend → QA → rework → PASS. |

### Section 12: Calendar & Scheduling

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0143 | Calendar tab display | Calendar | S1 | unaudited | open | F | — | — |
| ORCH-0144 | Device calendar sync | Calendar | S2 | unaudited | open | F | — | — |
| ORCH-0145 | Calendar service | Calendar | S1 | unaudited | open | F | — | — |
| ORCH-0146 | Date options grid | Calendar | S2 | unaudited | open | F | — | — |
| ORCH-0147 | Propose date/time modal | Calendar | S2 | unaudited | open | F | — | — |
| ORCH-0148 | Weekend day selection | Calendar | S3 | unaudited | open | F | — | — |
| ORCH-0149 | Collaboration calendar | Calendar | S2 | unaudited | open | F | — | — |
| ORCH-0150 | Calendar button on cards | Calendar | S2 | unaudited | open | F | — | — |

### Section 13: Holidays & Events

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0151 | Holiday categories | Holidays | S2 | unaudited | open | F | — | — |
| ORCH-0152 | Holiday experiences | Holidays | S2 | unaudited | open | F | — | — |
| ORCH-0153 | Holiday cards | Holidays | S2 | unaudited | open | F | — | — |
| ORCH-0154 | Custom holidays CRUD | Holidays | S2 | unaudited | open | F | — | — |
| ORCH-0155 | Calendar holidays mapping | Holidays | S3 | unaudited | open | F | — | — |
| ORCH-0156 | Holiday reminder notifications | Holidays | S2 | bug | verified | B | 2026-03-21 | Commit d4c6725e |
| ORCH-0157 | Ticketmaster events | Holidays | S3 | unaudited | open | F | — | — |

### Section 14: People Discovery

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0158 | Discover screen (people) | People | S1 | unaudited | open | F | — | — |
| ORCH-0159 | Person grid cards | People | S2 | unaudited | open | F | — | — |
| ORCH-0160 | Person tab bar | People | S2 | unaudited | open | F | — | — |
| ORCH-0161 | Person holiday view | People | S2 | unaudited | open | F | — | — |
| ORCH-0162 | Person hero cards | People | S2 | unaudited | open | F | — | — |
| ORCH-0163 | Personalized cards | People | S2 | unaudited | open | F | — | — |
| ORCH-0164 | Link request banner | People | S2 | unaudited | open | F | — | — |
| ORCH-0165 | Link consent card | People | S2 | unaudited | open | F | — | — |
| ORCH-0166 | Enhanced profile view | People | S2 | unaudited | open | F | — | — |
| ORCH-0167 | Phone lookup (friend discovery) | People | S2 | unaudited | open | F | — | — |

### Section 15: Pairing System

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0168 | Send pair request | Pairing | S1 | unaudited | open | F | — | — |
| ORCH-0169 | Pair request modal | Pairing | S2 | unaudited | open | F | — | — |
| ORCH-0170 | Incoming pair request card | Pairing | S2 | unaudited | open | F | — | — |
| ORCH-0171 | Paired profile section | Pairing | S2 | unaudited | open | F | — | — |
| ORCH-0172 | Paired people row | Pairing | S2 | unaudited | open | F | — | — |
| ORCH-0173 | Paired saves list | Pairing | S2 | unaudited | open | F | — | — |
| ORCH-0174 | Paired map saved cards | Pairing | S2 | unaudited | open | F | — | — |
| ORCH-0175 | Pair accepted notification | Pairing | S2 | missing-feature | closed | A | 2026-03-21 | Commit 376cd237 |
| ORCH-0176 | Pair activity notifications | Pairing | S2 | bug | closed | A | 2026-03-21 | Commit 376cd237 |
| ORCH-0177 | Unpair flow (atomic RPC) | Pairing | S1 | bug | closed | A | 2026-03-22 | Commit 23f3a0dd |
| ORCH-0178 | Pairing info card | Pairing | S3 | unaudited | open | F | — | — |
| ORCH-0404 | Realtime update audit — pair request acceptance doesn't update sender + systemic audit of all two-party realtime gaps | Pairing + Cross-cutting | S1 | architecture-flaw | open | F | — | User report 2026-04-13. Expands ORCH-0308 scope. Audit ALL two-party interactions: pairing, friend requests, DM read receipts, board sharing, session invites. Confirm collab sessions DO have realtime. |
| ORCH-0411 | Paired friend can't see my liked places — asymmetric visibility (user sees friend's 10, friend can't see user's 1) | Pairing | S1 | bug | open | F | — | User report 2026-04-13. Likely query direction assumption or RLS policy asymmetry. |

### Section 16: Sharing & Invites

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0179 | Share modal | Sharing | S2 | unaudited | open | F | — | — |
| ORCH-0180 | User invite modal | Sharing | S2 | unaudited | open | F | — | — |
| ORCH-0181 | Phone invite flow | Sharing | S2 | unaudited | open | F | — | — |
| ORCH-0182 | Invite link share | Sharing | S2 | unaudited | open | F | — | — |
| ORCH-0183 | QR code display | Sharing | S3 | unaudited | open | F | — | — |
| ORCH-0184 | Invite code display | Sharing | S3 | unaudited | open | F | — | — |
| ORCH-0185 | Invite method selector | Sharing | S3 | unaudited | open | F | — | — |
| ORCH-0186 | Invite accept screen | Sharing | S2 | unaudited | open | F | — | — |
| ORCH-0187 | Board invite service | Sharing | S2 | unaudited | open | F | — | — |
| ORCH-0188 | Collaboration invite service | Sharing | S2 | unaudited | open | F | — | — |

### Section 17: Post-Experience & Reviews

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0189 | Post-experience modal | Post-Experience | S2 | unaudited | open | F | — | — |
| ORCH-0190 | Post-experience check | Post-Experience | S2 | unaudited | open | F | — | — |
| ORCH-0191 | Record visit | Post-Experience | S2 | unaudited | open | F | — | — |
| ORCH-0192 | Voice review recording | Post-Experience | S2 | unaudited | open | F | — | — |
| ORCH-0193 | Experience feedback | Post-Experience | S2 | unaudited | open | F | — | — |
| ORCH-0194 | Visit badge display | Post-Experience | S3 | unaudited | open | F | — | — |
| ORCH-0195 | Dismissed cards sheet | Post-Experience | S3 | unaudited | open | F | — | — |
| ORCH-0196 | Deck history sheet | Post-Experience | S3 | unaudited | open | F | — | — |
| ORCH-0197 | Feedback history sheet | Post-Experience | S3 | unaudited | open | F | — | — |

### Section 18: Booking

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0198 | Booking service | Booking | S2 | unaudited | open | F | — | — |
| ORCH-0199 | Enhanced favorites | Booking | S3 | unaudited | open | F | — | — |

### Section 19: Admin Panel (Place Pool Management)

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0332 | Admin cannot update existing city bbox — overlap check blocks self | Admin | S2 | missing-feature | investigated | F | 2026-04-08 | INVESTIGATION_CITY_UPDATE_AND_TILE_REGEN.md — Backend ready (p_exclude_id exists, RLS allows UPDATE, generate_tiles works). Pure UI work. CASCADE risk guarded by activeRun check. |
| ORCH-0333 | Admin cannot change tile radius on already-seeded city | Admin | S2 | missing-feature | investigated | F | 2026-04-08 | INVESTIGATION_CITY_UPDATE_AND_TILE_REGEN.md — TILE_RADIUS_OPTIONS exists. SeedTab needs picker + save-before-regenerate. No backend changes. |
| ORCH-0334 | Photo tab shows stale London run (180/351 batches) — old run has dead references | Admin | S3 | bug | open | F | — | Previous session: old photo backfill run data from pre-bbox migration. May need cancel/dismiss action. |
| ORCH-0335 | admin_place_photo_stats only counts AI-approved places — correct per spec but changed from before | Admin | S3 | quality-gap | open | F | — | Spec decision: photo stats scoped to AI-approved. Stats look different from pre-spec totals. Not a bug — document and close. |
| ORCH-0466 | admin-seed-places create_run returns 500 (EDGE_FUNCTION_ERROR) — ReferenceError on undefined categoryIds | Admin + Backend | S1 | regression | implemented-pending-smoke | F | — | INVESTIGATION_ADMIN_SEED_PLACES_500_REPORT.md + IMPLEMENTATION_ADMIN_SEED_PLACES_500_FIX_REPORT.md. Regression from 4365082c (ORCH-0434 Phase 8). Fixed by restoring `const categoryIds = validConfigs.map(c => c.appCategorySlug)` at index.ts:522. Deployed version 82. Awaiting admin-UI smoke. |
| ORCH-0467 | Edge function deploy pipeline has no static type-check gate (deno check / tsc) | Backend + Ops | S2 | quality-gap | open | F | — | Discovered via ORCH-0466: a trivial ReferenceError reached prod because deploy does not run `deno check` on edge function sources. Structural prevention needed. |
| ORCH-0468 | admin-seed-places handleRunNextBatch and handleRetryBatch duplicate ~120 lines of batch-execution logic | Backend | S3 | architecture-flaw | open | F | — | Discovered via ORCH-0466. Any future fix to one must be mirrored to the other. Refactor candidate, not urgent. |

### Section 19B: Place Pipeline Accuracy (Seeding + AI Validation)

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0460 | Place pipeline accuracy overhaul — 5 categories leaking wrong places, 58 missing cuisine types, types-array filters missing | Admin + Backend | S1 | data-integrity | closed | A | 2026-04-17 | **QA PASS cycle 1** — QA_ORCH-0460_SEEDING_VALIDATION_ACCURACY_REPORT_RETEST_1.md. 11/11 SC PASS. P0 resolved (180→11 flower strips, 0 supermarkets false-positive, 139 preserved, 175/175 food_store-in-types preserved). P1 invariant #13 resolved (40→0 gaps). 25/26 unit fixtures (same baseline). One retest cycle. Ships. |
| ORCH-0461 | casual_eats at 49/50 Google type limit — cannot add new cuisine types without splitting | Admin | S2 | architecture-flaw | closed | A | 2026-04-17 | Closed via ORCH-0460 bundle. Split into 3 configs (casual_eats 45 + casual_eats_world 50 + casual_eats_extended 15). All under 50-limit verified via AST. |
| ORCH-0462 | Upscale & Fine Dining too restrictive — only 8 seeding types, misses world cuisines, blanket-excludes tapas/bistro | Admin + Backend | S2 | quality-gap | closed | A | 2026-04-17 | Closed via ORCH-0460 bundle. Seeding 8→32 types. EXPENSIVE+4.0 promotion tier. UPSCALE_CHAIN_PROTECTION whitelist (24 chains). GPT prompt loosened. QA T-2.19/T-2.21/T-2.22 PASS. |
| ORCH-0463 | Garden stores leaking into Flowers — types array not checked, only primary_type | Backend | S2 | data-integrity | closed | A | 2026-04-17 | Closed via ORCH-0460 v2 rework. FLOWERS_BLOCKED_TYPES split into PRIMARY (10, broad) + SECONDARY (4, tight — excludes food_store). Live SQL: 180→11 strips, all 11 defensible. |
| ORCH-0464 | Venue name keywords 48% out of sync between ai-verify and categoryPlaceTypes | Backend | S2 | quality-gap | closed | A | 2026-04-17 | Closed via ORCH-0460 bundle. Kids keywords expanded 12→37 in ai-verify. EXCLUDED_VENUE_NAME_KEYWORDS +8 in categoryPlaceTypes. QA T-2.26 PASS. |
| ORCH-0465 | Brunch Lunch Casual definition tightened — restaurants only, no food courts/delis/bars/tobacco/play | Backend | S1 | quality-gap | closed | A | 2026-04-17 | Closed via ORCH-0460 bundle. Seeding removed cafe/coffee_shop/food_court/deli. +20 exclusions. Types-array check with real-restaurant guard. QA T-2.7/T-2.8/T-2.9/T-2.10 PASS. |
| ORCH-0471 | Mutual exclusivity between upscale_fine_dining and brunch_lunch_casual REMOVED — Nobu-style restaurants can now have both | Backend | S2 | data-integrity | closed | A | 2026-04-17 | Closed via ORCH-0460 bundle. Supersedes ORCH-0428. enforceExclusivity() fully removed. GPT prompt mutual-exclusivity paragraph replaced with dual-category guidance + 3 new worked examples. |
| ORCH-0477 | Invariant #13 drift — pipeline BLOCKED type sets vs on-demand CATEGORY_EXCLUDED_PLACE_TYPES not synced | Backend | S2 | architecture-flaw | closed | A | 2026-04-17 | **(ID correction 2026-04-17: originally registered as ORCH-0473; collided with ORCH-0473 at line 217 for dead-code TS errors. Renumbered. QA reports retain original ID as historical artifact.)** Closed via ORCH-0460 v2 rework. +32 types to Creative & Arts on-demand, +8 to Movies & Theatre. Harness confirms 0 gaps. Constitutional #13 restored FAIL→PASS. |
| ORCH-0478 | Pre-flight pool-impact dry-run needed before any mass re-validation | Process + Backend | S2 | quality-gap | open | F | — | **(ID correction 2026-04-17: originally registered as ORCH-0474; renumbered due to 0473/0472 collision cluster.)** Tester escalated S3→S2 per RETEST_1 report D-3: the predictive SQL proved its value twice (caught P0 in cycle 0, confirmed fix in cycle 1). Should become mandatory gate before any scope=all re-validation. Propose: admin UI "preview re-validation impact" action that runs deterministicFilter against sample of approved places, returns per-bucket projected strip counts. High-value guardrail. Awaiting investigation/spec. |
| ORCH-0479 | GPT prompt Example 2 (TopGolf) inconsistent with deterministic filter — non-idempotent classification | Backend | S3 | quality-gap | open | F | — | **(ID correction 2026-04-17: originally registered as ORCH-0475; renumbered due to collision cluster.)** Example 2 uses `type:restaurant` for TopGolf → both play+brunch accepted. Real Google often returns `type:amusement_center` → deterministic filter strips brunch on re-validation. First classification ≠ re-validation result. Fix: either update Example 2 to match real Google data OR add TopGolf-style exception to brunch stripping. Low priority, non-blocking. |
| ORCH-0476 | category-mapping.md stale — references 13 categories with wellness, doesn't reflect 10-category reality + ORCH-0460 user decisions | Docs | S2 | documentation-drift | open | F | — | **(ID correction 2026-04-17: originally registered as ORCH-0472; collided with UX EMPTY/EXHAUSTED at line 216. Renumbered.)** File at `.claude/skills/mingla-categorizer/references/category-mapping.md` still references watch/live_performance/picnic_park/wellness as separate categories. Needs update to 10-category reality + brunch-restaurants-only + upscale loosening + removal of upscale/casual exclusivity + tightened creative_arts/movies_theatre/play definitions. |
| ORCH-0470 | generate-single-cards uses seeding ID (casual_eats) to query ai_categories which stores app slug (brunch_lunch_casual) | Backend | S2 | data-integrity | awaiting-spec | F | — | Line-level evidence in `outputs/INVESTIGATION_ORCH-0469_DECK_STATE_POLLUTION.md` Side Discovery section. DEC-020 locked Direction A (fix consumer, not data). Spec dispatch ready: `prompts/SPEC_ORCH-0470_GENERATE_SINGLE_CARDS_SLUG_FIX.md`. Single-file edge fn fix, no migration. |
| ORCH-0480 | Admin Place Pool page 500s — all 3 RPCs (pool_overview, category_breakdown, country_overview) timeout | Admin + Backend | S1 | performance | **closed (superseded by ORCH-0481)** | A | 2026-04-18 | User-reported 2026-04-17. ORCH-0480's partial-index approach FAILed per `reports/QA_ORCH-0480_ADMIN_RPC_PERF_REPORT.md`, but the user-facing problem (500 errors) is resolved by ORCH-0481's MV layer (now live on Mingla-dev=prod). Admin Place Pool page loads; the 3 original RPCs run in 107ms / 87ms hot / ~400ms. ORCH-0480's migration `20260417300001_orch0480_admin_rpc_perf.sql` is live (commit 82d94aef); its index is harmlessly retained and its function body was superseded by ORCH-0481's rewrites. DEC-021 documents the pivot. Closed A because the user-reported incident is resolved regardless of attribution. |
| ORCH-0481 | Admin RPC materialized view layer — ~22 vulnerable admin RPCs all run live aggregates over place_pool/card_pool/profiles | Admin + Backend | S1 | architecture-flaw | **partially shipped — query layer live in prod, auto-refresh inoperative** | D | — | **IMPORTANT CLARIFICATION 2026-04-18:** Mingla-dev IS the production Supabase project — single-env setup (confirmed by user). All 4 cycle migrations (`20260417300001`, `20260418000001`, `20260418000002`, `20260418000003`) are in production right now. Admin Place Pool page no longer 500s because cycle 0/1 query rewrites made the RPCs fast enough (`admin_place_country_overview` 87ms hot, `admin_place_pool_overview` ~400ms, `admin_place_category_breakdown` 107ms — all under 8s PostgREST timeout). **Primary goal of ORCH-0481 ACHIEVED.** BUT auto-refresh is non-functional: pg_cron jobid=13 has never fired since cycle 2 deploy (0 runs in cron.job_run_details). MV frozen at state from 2026-04-17 18:45 UTC initial populate. Admin stats will drift from reality over time; any new place_pool writes invisible in admin stats. Tester cycle 2 retest report: `reports/QA_ORCH-0481_ADMIN_MV_LAYER_REPORT_RETEST_2.md`. Three rework cycles all targeted cron plumbing → stuck-in-loop escalation (DEC-023). Path forward: ORCH-0489 (admin-UI "Refresh Stats" button calling `admin_refresh_place_pool_mv()`) — user-chosen Alternative 1. Removes cron dependency entirely; admin gets explicit, visible freshness control. Query-rewrite wins preserved regardless of button decision. Grade promoted F→D: admin page works but silent auto-refresh failure remains (Constitutional #3 partial violation). Would be A once ORCH-0489 ships + button replaces the silent-failure mode with user-driven visible refresh. |
| ORCH-0482 | Admin analytics RPCs will time out when profiles table grows — same pattern as ORCH-0480 | Admin + Backend | S2 | performance | open | F | — | Pre-emptive registration 2026-04-17. The 5 admin_analytics_* RPCs (funnel, geo, growth, retention, engagement) run live aggregates over profiles. Not failing now because profiles ~2k-5k rows, but will fail at ~40k. Fix: extend ORCH-0481's materialized view pattern to profiles (admin_profiles_mv). Can be bundled into ORCH-0481 or deferred. |
| ORCH-0483 | Admin RPC perf gate — EXPLAIN ANALYZE required in code review for every new admin_* function | Process + Backend | S2 | quality-gap | open | F | — | Discovered via ORCH-0480: the 22 vulnerable RPCs reached production because no perf check gates function creation. Propose: pre-flight rule — every new admin_* RPC must include an EXPLAIN ANALYZE output showing <1s execution on production-scale data. Violations blocked at review. Complements ORCH-0467 (edge-fn type-check gate) and ORCH-0478 (pre-flight dry-run). Together these three prevent the "works in dev, fails at scale" class of bugs. |
| ORCH-0484 | 776 approved active places have `ai_categories = '{}'` (empty array) — should not exist per AI pipeline rules | Backend + Data Integrity | S2 | data-integrity | open | F | — | Discovered via ORCH-0480 implementor D-2 (2026-04-17), **tightened by tester 2026-04-17**: all 776 rows have `ai_categories = '{}'` (empty array), **ZERO are NULL**. Tester-verified correct count query: `SELECT COUNT(*) FROM place_pool WHERE is_active=true AND ai_approved=true AND COALESCE(array_length(ai_categories,1), 0) = 0` returns 776 on Mingla-dev. (Implementor's report used `array_length=0` which returns NULL for empty arrays, not TRUE — same Postgres NULL-semantics gotcha tricked tester initially too.) These rows are correctly excluded from ORCH-0480's new partial index (predicate `array_length(ai_categories,1) > 0` correctly fails for empty arrays), so no perf impact. But their existence contradicts the AI pipeline contract (approval requires category assignment). Need investigator to trace — legacy pre-AI rows, race condition in ai-verify-pipeline, or silent failure in validation writeback. Pair with ORCH-0481 MV migration (clean up before snapshot). |
| ORCH-0487 | admin_place_city_overview <500ms target not met — residual Bitmap Heap Scan I/O on Mingla-dev after ORCH-0481 rework | Admin + Backend | S2 | performance | open | F | — | Registered 2026-04-17 from ORCH-0481 rework cycle 1 D-NEW-1. Post-rework timing on Mingla-dev: **3,061ms warm** (down from 5,118ms pre-rework). Under PostgREST 8s timeout so the admin country-drill-down page loads, but 6× over the <500ms spec target. Root cause: Bitmap Heap Scan on 4,858 MV heap pages for a single country's ~31k rows (columns `has_photos`, `primary_category`, `rating`, `city_id` are not in the existing `(country_code, is_active, ai_approved)` index, forcing heap access for projection). Fix: follow-up migration adding `INCLUDE (city_id, has_photos, primary_category, rating)` to `admin_place_pool_mv_country_active_approved` index (enables Index-Only Scan; expected <200ms). Alternative: CLUSTER the MV by country_code (one-time heap reorganization). Not blocking admin dashboard load today; defer until ORCH-0481 cycle 1 closes + city-drill-down UX feedback confirms the 3s latency matters. |
| ORCH-0488 | Admin RPC cache-sensitivity on Mingla-dev — 2-5s cold-cache latencies across multiple admin_* RPCs (not just city_overview) | Admin + Backend | S2 | performance | open | F | — | Registered 2026-04-17 from ORCH-0481 tester cycle 1 retest D-NEW-6. Tester observed: `admin_place_country_overview` 87ms hot / 5,047ms mildly-cold / 6,832ms fully-cold; `admin_place_category_breakdown` 107ms cycle 0 / 4,219ms cycle 1 (unchanged body — plan drift + cold cache). Root cause: Mingla-dev's slow I/O (~1ms per heap page read) means the 44MB MV (27 cols × 63k rows) exceeds shared_buffers working set. When pages get evicted between queries, re-reads are I/O-bound. **Decision point: is this Mingla-dev-only or does it replicate on production?** Production may have larger shared_buffers / faster disk → cache hit ratios closer to 100% → sub-500ms consistently. **Defer evaluation until post-production deploy.** If prod also sees 2-5s latencies, the structural fix is to narrow the MV (drop TOAST'd columns like `stored_photo_urls raw`, `photos jsonb`, `ai_categories raw`, `types raw` that only a few RPCs need — reduces physical footprint ~10× to 4-5MB, fits in cache). Not blocking close if admin page loads under 8s. |
| ORCH-0489 | Admin UI "Refresh Stats" button — replaces failed pg_cron auto-refresh with user-controlled refresh | Admin UI | S1 | missing-feature | **implemented-awaiting-verify** | F | — | Implementation delivered 2026-04-18 by implementor: single-file change in `mingla-admin/src/pages/PlacePoolManagementPage.jsx`, ~35 lines added (state + handler + Button JSX) inside `OverviewTab`. Build-verified (`npm run build` PASS: 2918 modules, 0 errors, 11.93s). Report: `reports/IMPLEMENTATION_ORCH-0489_ADMIN_REFRESH_BUTTON_REPORT.md`. Structural review APPROVED — Button placed right-aligned in new flex header row next to scope label; calls `supabase.rpc('admin_refresh_place_pool_mv')`; auth-error path via `/not authorized/i` regex surfaces "Admin access required" toast; success path shows row count + duration, auto-refires `fetchData()`; `mountedRef.current` guard for unmount safety. All 8 SCs met by construction or build. **Awaiting runtime verification** (prompt: `prompts/TESTER_ORCH-0489_ADMIN_REFRESH_BUTTON.md`) — 6 browser-driven checks (visual render, click flow, auth-error path, long-running refresh, regression in other tabs, MV actually refreshes). On tester PASS → ORCH-0489 closes A and ORCH-0481 promotes D→A. |

### Section 20: User Reporting & Moderation

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0362 | Map report fixed — ReportUserModal replaces broken inline handler | Moderation | S0 | bug | closed | A | 2026-04-10 | QA PASS (AH-057). Old `map_interaction` enum removed. Now uses reportService.submitReport() via ReportUserModal. Error checking verified. |
| ORCH-0363 | Report modal delay fixed — premature block removed, single-block on submit | Moderation | S1 | ux | closed | A | 2026-04-10 | QA PASS (AH-057). `onBlockUser` call removed from handleReportUser. ReportUserModal.handleSubmit blocks once on submit. |
| ORCH-0364 | Admin reports RLS fixed — SELECT + UPDATE policies added, FK join hint corrected | Moderation | S0 | bug | closed | A | 2026-04-10 | QA PASS (AH-057). Migration 20260410000002 applied. is_admin_user() SELECT + UPDATE policies live. Join hint fixed to column-based. |

### Cross-Cutting: Network & Offline

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0200 | Offline browsing (saved cards) | Network | S2 | unaudited | open | F | — | — |
| ORCH-0201 | Network failure at every layer | Network | S1 | unaudited | open | F | — | — |
| ORCH-0202 | Slow network degradation | Network | S2 | unaudited | open | F | — | — |
| ORCH-0203 | Reconnection recovery | Network | S2 | unaudited | open | F | — | — |
| ORCH-0204 | Offline queue observability | Network | S2 | quality-gap | verified | B | 2026-03-23 | Commit 8839c00b |

### Cross-Cutting: State & Cache

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0205 | Query key consolidation | State | S1 | architecture-flaw | closed | A | 2026-03-23 | Commit 846e7cce |
| ORCH-0206 | Mutation error handling | State | S1 | quality-gap | closed | A | 2026-03-23 | Commit 27e475ac |
| ORCH-0207 | React Query cache invalidation | State | S2 | unaudited | open | F | — | — |
| ORCH-0208 | Zustand persistence schema versioning | State | S2 | unaudited | open | F | — | — |
| ORCH-0209 | App background/foreground state survival | State | S2 | bug | closed | A | 2026-03-31 | QA_LIVE_APP_STATE_PERSISTENCE_REPORT.md — always-mounted tabs + resume prefetch |
| ORCH-0210 | Memory pressure on large lists | State | S3 | unaudited | open | F | — | — |
| ORCH-0270 | Tab switching loading spinners | State | S1 | bug | closed | A | 2026-03-31 | QA_LIVE_APP_STATE_PERSISTENCE_REPORT.md — SP-01 root cause, always-mounted tabs |
| ORCH-0271 | PreferencesSheet loading shimmer on every open | State | S2 | bug | closed | A | 2026-03-31 | QA_LIVE_APP_STATE_PERSISTENCE_REPORT.md — opens from cache |
| ORCH-0300 | App doesn't feel alive — content freshness architecture flaw | State | S1 | architecture-flaw | spec-ready | F | — | FORENSIC_MASTER_REPORT.md — Content excluded from foreground refresh based on false "expensive API" assumption. All 3 content edge functions read from our DB, zero external calls. |

### Cross-Cutting: Chat Responsiveness

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0211 | Existing chat tap (cached) | Chat-Resp | S2 | bug | closed | A | 2026-03-23 | Commit 2549dbe6 |
| ORCH-0212 | First-time chat open | Chat-Resp | S2 | bug | closed | A | 2026-03-23 | Commit 2549dbe6 |
| ORCH-0213 | New conversation from picker | Chat-Resp | S2 | bug | closed | A | 2026-03-23 | Commit 2549dbe6 |
| ORCH-0214 | Block service timeout | Chat-Resp | S2 | bug | closed | A | 2026-03-23 | Commit 2549dbe6 |

### Cross-Cutting: Hardening Infrastructure

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0215 | withTimeout utility | Infra | S2 | missing-feature | closed | A | 2026-03-23 | Commit 06614e98 |
| ORCH-0216 | Mutation error toast utility | Infra | S2 | missing-feature | closed | A | 2026-03-23 | Commit 06614e98 |
| ORCH-0217 | Centralized query key factory | Infra | S2 | architecture-flaw | closed | A | 2026-03-23 | Commit 06614e98 |

### Cross-Cutting: Error Handling

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0218 | Error boundary coverage | Error | S1 | unaudited | open | F | — | — |
| ORCH-0219 | Edge function error extraction | Error | S2 | unaudited | open | F | — | — |
| ORCH-0220 | User-facing error messages | Error | S2 | unaudited | open | F | — | — |
| ORCH-0221 | Silent failure paths | Error | S1 | unaudited | open | F | — | — |
| ORCH-0222 | Service error contract | Error | S1 | design-debt | deferred | F | 2026-03-23 | TRANSITIONAL logging. Full fix deferred. |

### Cross-Cutting: Security & Auth

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0223 | RLS policy coverage | Security | S0 | quality-gap | verified | D | 2026-03-31 | INVESTIGATION_SECURITY_WAVE2.md |
| ORCH-0224 | Admin auth (3-layer) | Security | S0 | quality-gap | closed | A | 2026-03-31 | INVESTIGATION_SECURITY_WAVE2.md, QA_ADMIN_USERS_RLS_REPORT.md — admin email exposure (SEC-01) fixed: get_admin_emails revoked from anon, replaced with is_admin_email boolean |
| ORCH-0225 | PII handling | Security | S0 | quality-gap | verified | C | 2026-03-31 | INVESTIGATION_SECURITY_WAVE2.md |
| ORCH-0226 | Storage path injection | Security | S1 | quality-gap | verified | D | 2026-03-31 | INVESTIGATION_SECURITY_WAVE2.md |
| ORCH-0250 | Avatars bucket no user-scoping | Security | S1 | bug | open | F | — | INVESTIGATION_SECURITY_WAVE2.md |
| ORCH-0251 | Messages bucket public — DM files accessible without auth | Security | S1 | bug | open | F | — | INVESTIGATION_SECURITY_WAVE2.md |
| ORCH-0252 | get_admin_emails() exposes admin list to anon | Security | S2 | bug | closed | A | 2026-03-31 | Fixed with ORCH-0258 — get_admin_emails revoked from anon, replaced with is_admin_email() boolean |
| ORCH-0253 | USING(true) on profiles — PII exposure | Security | S1 | bug | closed | A | 2026-03-31 | IMPLEMENTATION_EMERGENCY_RLS_FIX_REPORT.md, QA_EMERGENCY_RLS_FIX_REPORT.md |
| ORCH-0254 | Full phone numbers logged in console | Security | S3 | bug | open | F | — | INVESTIGATION_SECURITY_WAVE2.md |
| ORCH-0255 | board-attachments + experience-images buckets missing | Security | S2 | bug | open | F | — | INVESTIGATION_SECURITY_WAVE2.md |
| ORCH-0256 | Client-side brute-force lockout bypassable | Security | S3 | bug | open | F | — | INVESTIGATION_SECURITY_WAVE2.md |
| ORCH-0257 | 6 edge functions have no auth (incl. Google Maps key) | Security | S2 | bug | open | F | — | INVESTIGATION_SECURITY_WAVE2.md |
| ORCH-0258 | admin_users USING(true) on UPDATE/DELETE — privilege escalation | Security | S1 | bug | closed | A | 2026-03-31 | QA_ADMIN_USERS_RLS_REPORT.md — all permissive policies dropped, is_admin_user() gating |

### Cross-Cutting: Deep Linking

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0227 | Deep link service routing | DeepLink | S1 | unaudited | open | F | — | — |
| ORCH-0228 | Session deep links | DeepLink | S2 | quality-gap | verified | B | 2026-03-23 | Commit 15fe8742 |
| ORCH-0229 | Universal link handling | DeepLink | S2 | unaudited | open | F | — | — |
| ORCH-0230 | Deferred deep links (pre-install) | DeepLink | S2 | unaudited | open | F | — | — |

### Cross-Cutting: App Lifecycle

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0231 | Animated splash screen | Lifecycle | S2 | unaudited | open | F | — | — |
| ORCH-0232 | App loading screen | Lifecycle | S2 | unaudited | open | F | — | — |
| ORCH-0233 | Error boundary (app-wide) | Lifecycle | S1 | unaudited | open | F | — | — |
| ORCH-0234 | Error state component | Lifecycle | S2 | unaudited | open | F | — | — |
| ORCH-0235 | Offline indicator | Lifecycle | S2 | unaudited | open | F | — | — |
| ORCH-0236 | App state manager | Lifecycle | S1 | unaudited | open | F | — | — |
| ORCH-0237 | App handlers | Lifecycle | S2 | unaudited | open | F | — | — |
| ORCH-0238 | Notification system provider | Lifecycle | S1 | unaudited | open | F | — | — |
| ORCH-0239 | Mobile features provider | Lifecycle | S2 | unaudited | open | F | — | — |
| ORCH-0240 | Foreground refresh | Lifecycle | S2 | quality-gap | closed | A | 2026-03-31 | QA_LIVE_APP_STATE_PERSISTENCE_REPORT.md — refreshes ALL tabs (all mounted), preferences prefetched |
| ORCH-0241 | Lifecycle logger | Lifecycle | S3 | unaudited | open | F | — | — |
| ORCH-0368 | Bad merge artifact audit — corruption isolated to MessageInterface.tsx only. 88 files scanned with 6 detection passes, zero additional corruption found. | Lifecycle | S1 | regression | closed | A | 2026-04-10 | INVESTIGATION_ORCH-0368_BAD_MERGE_AUDIT.md — All 88 files clean. Fix: commit 8bc694c6. |

### Cross-Cutting: Analytics & Tracking

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0242 | AppsFlyer integration | Analytics | S1 | data-integrity | investigated | C | 2026-04-11 | INVESTIGATION_ANALYTICS_IDENTITY_AUDIT.md — 22 events wired, never verified in dashboard, identity not cleared on logout |
| ORCH-0243 | Mixpanel integration | Analytics | S1 | data-integrity | closed | A | 2026-04-11 | Token set, 17 active methods firing, 4 onboarding methods wired, preferences + friend request tracking wired. Live events confirmed in dashboard. |
| ORCH-0387 | Analytics identity & cross-service integration audit | Analytics | S1 | data-integrity | closed | B | 2026-04-11 | Mixpanel live (A), push_clicked wired (A), onboarding funnel tracked (A). Remaining: AppsFlyer logout gap (deferred), unified identity layer (deferred per product strategy). |
| ORCH-0388 | RevenueCat "customer" count inflation — 104 phantom customers | Analytics | S2 | data-integrity | investigated | C | 2026-04-11 | INVESTIGATION_ANALYTICS_IDENTITY_AUDIT.md — RC counts every SDK touch as "customer." Anonymous→identified merges may inflate. Need RC dashboard audit. |
| ORCH-0389 | OneSignal push_clicked tracking gap | Analytics | S2 | missing-feature | closed | A | 2026-04-11 | push_clicked + push_clicked_at now set on notification tap in processNotification. Mixpanel "Push Notification Clicked" event also fires. |
| ORCH-0244 | Screen logger | Analytics | S3 | unaudited | open | F | — | — |
| ORCH-0245 | Tracked pressable / touchable | Analytics | S3 | missing-feature | closed | A | 2026-03-22 | Commit dba7b3f0 |
| ORCH-0246 | User activity service | Analytics | S2 | unaudited | open | F | — | — |
| ORCH-0247 | User interaction service | Analytics | S2 | unaudited | open | F | — | — |
| ORCH-0248 | Session tracker | Analytics | S2 | unaudited | open | F | — | — |
| ORCH-0249 | A/B testing service | Analytics | S3 | unaudited | open | F | — | — |
| ORCH-0390 | Documentation truth sweep — all artifacts, READMEs, comments must reflect code reality | Documentation | S1 | documentation-drift | closed | A | 2026-04-11 | 3 phases complete: (1) Dead code elimination — 17 files, 4 exports, 4 edge fns, 3 RPCs removed (QA PASS). (2) Code inventory + analytics architecture — 57 edge fns, 79 services, 25 AF events, 33 MP methods, 29 notification types mapped. (3) Artifact sync — READMEs fixed (71→57), 4 queue docs deprecated, 5 decisions logged, Priority Board updated. |

### Cross-Cutting: Weather & External Data

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0250 | Weather service — replaced OpenWeatherMap with Open-Meteo (free, no key, 15-min cache) | Weather | S2 | architecture-flaw | closed | A | 2026-04-13 | QA PASS 17/17. ORCH-0419 bundle. QA_ORCH-0419_REALTIME_DATA_STACK_REPORT.md |
| ORCH-0251 | Busyness data — replaced BestTime (never worked) with venue-type-aware heuristic + Est. badge | Weather | S2 | architecture-flaw | closed | A | 2026-04-13 | QA PASS 17/17. ORCH-0419 bundle. QA_ORCH-0419_REALTIME_DATA_STACK_REPORT.md |
| ORCH-0252 | Geocoding service | Weather | S2 | unaudited | open | F | — | — |
| ORCH-0253 | Currency service | Weather | S2 | unaudited | open | F | — | — |
| ORCH-0254 | Translation service | Weather | S3 | unaudited | open | F | — | — |
| ORCH-0255 | Locale preferences | Weather | S2 | unaudited | open | F | — | — |
| ORCH-0419 | Real-time data stack replacement — Mapbox (travel+traffic), Open-Meteo (weather), venue-type heuristic (busyness) with Est. badge. $0/month. | Weather | S1 | architecture-flaw | closed | A | 2026-04-13 | QA PASS 17/17, 0 defects. Full pipeline: investigation → spec → addendum (7 fixes) → implementation → QA. Reports: FORENSICS, SPEC, ADDENDUM, IMPLEMENTATION, QA_ORCH-0419_REALTIME_DATA_STACK_REPORT.md |
| ORCH-0420 | Widen Haversine search radius + add "~" prefix to collapsed card travel times — standardize speed profiles across edge functions (35→50 km/h), larger candidate pool, and label all Haversine estimates as approximate ("~12 min") so they don't conflict with real Mapbox times on expanded card | Weather | S2 | quality-gap | open | F | — | User request 2026-04-13. Depends on ORCH-0419. Scope: standardize `_shared/` speed profile, bump speed, add "~" to SwipeableCards/CardInfoSection travel time pills. |
| ORCH-0421 | Card deck severely underfilled across all categories — price tier filter excludes NULL/chill places for price-irrelevant categories (nature, picnic, watch, creative arts, live performance) | Discovery | S0 | architecture-flaw | closed | A | 2026-04-14 | QA PASS 18/18 tests, 0 defects. Migration 20260414100001 adds v_price_exempt + NULL-safe handling. Nature: 9→200 cards. Casual Eats: 200→200 (no regression). PreferencesSheet hides price picker for exempt-only categories. |
| ORCH-0422 | Wellness AI approval coverage critically low — 44% (117/264 globally, 41/98 in Raleigh) | Discovery | S2 | data-integrity | open | F | — | Discovered during ORCH-0421 investigation. Independent of price filter. Needs AI validation pipeline run on wellness places. |
| ORCH-0423 | Picnic Park has only 1 card globally — category is effectively empty | Discovery | S2 | data-integrity | open | F | — | Discovered during ORCH-0421 investigation. Data seeding issue. 1,607 nature_views cards are also tagged picnic_park in categories array but have nature_views as primary category. |
| ORCH-0424 | Remove max selection limits on intents and categories — allow unlimited picks in onboarding and PreferencesSheet | Preferences | S2 | ux | closed | A | 2026-04-14 | QA PASS 20/20, 0 defects. Full pipeline: investigate → spec → implement → test. 7 source files + 58 locale files. QA_ORCH-0424_REMOVE_SELECTION_LIMITS_REPORT.md. |
| ORCH-0425 | Flowers category — garden centers/cemeteries/funeral homes/delivery-only stripped. Supermarket research complete: 16/18 chains confirmed bouquet sellers. Japan Village fixed. | Discovery | S1 | data-integrity | closed | A | 2026-04-14 | QA PASS 10/10 SC. Deployed. SQL cleanup ran. Supermarket research: all legitimate except Japan Village (fixed). |
| ORCH-0426 | Weird places blocked — gas stations, car dealers, cemeteries, funeral homes, no-data places rejected by Stage 2 | Discovery | S2 | data-integrity | closed | A | 2026-04-14 | QA PASS. Deployed. SQL cleanup ran. 21 blocked types, underscore fix, min-data guard. |
| ORCH-0427 | Fine dining promotion — VERY_EXPENSIVE auto-promoted, GPT prompt updated, mutual exclusivity enforced (ORCH-0428) | Discovery | S1 | data-integrity | closed | A | 2026-04-14 | QA PASS. Deployed. Mutual exclusivity resolved via ORCH-0428. EXPENSIVE restaurants still need full AI re-run (user triggers from admin). |
| ORCH-0428 | Fine dining / casual_eats mutual exclusivity — enforceExclusivity() at 3 write points + GPT prompt fix | Discovery | S2 | data-integrity | closed | A | 2026-04-14 | Deployed. SQL cleanup ran: 555 → 0 dual-tagged. Verified in production DB. Commit ba1cf39b. |

| ORCH-0429 | Picnic Park / Nature & Views — dual-tagging is fine (user confirmed parks can be both). Original exclusivity request WITHDRAWN. No code change needed. | Discovery | S1 | data-integrity | closed | B | 2026-04-14 | User confirmed parks can be both picnic and nature. The real problem is ORCH-0430 (same parks every time). |
| ORCH-0430 | Curated experiences always showed same venues — fetchSinglesForCategory now shuffles results for variety | Discovery | S1 | quality-gap | closed | A | 2026-04-14 | Root cause: rating DESC sort + anchorPlaces[0] = deterministic. Fix: shuffle(filtered) at line 307. Benefits all 6 experience types. Pending deploy. |
| ORCH-0431 | Deck stuck on exhausted/empty screen after preference change — no loading skeleton shown | Discovery | S1 | bug | closed | A | 2026-04-14 | Root cause: refreshKey handler missing hasCompletedFetchForCurrentMode reset + race condition via placeholderData. Fix: 3 changes to RecommendationsContext.tsx. QA PASS 16/16. Commit b1b8ebef. |

| ORCH-0432 | Pre-existing: blocked types gap — meal_takeaway (149), educational_institution (46), pizza_delivery (31), sports_complex (34) still approved | Discovery | S2 | data-integrity | open | F | — | Discovered by full session audit 2026-04-15. Deterministic filter catches keywords but not all Google primary_types. Add to BLOCKED_PRIMARY_TYPES or EXCLUSION_KEYWORDS. |
| ORCH-0433 | Fine dining quality gap — INEXPENSIVE restaurants tagged fine_dining (Les Oiseaux Paris), event_venue tagged fine_dining (Marti's Bistro) | Discovery | S2 | data-integrity | open | F | — | Discovered by full session audit 2026-04-15. Add INEXPENSIVE demotion rule to deterministicFilter: if fine_dining AND INEXPENSIVE → strip fine_dining. Manual override for event_venue edge cases. |
| ORCH-0434 | **Preferences Simplification Initiative** — Restructure categories (12→8), remove budget+time slot filters, bake time into Google hours, redesign preferences sheet order+toggles, redesign onboarding to match, migrate all users | Discovery / Onboarding / Admin | S0 | architecture-flaw | in-progress | C | 2026-04-15 | **Phase 1+2+3 PASS.** Entire backend complete: DB migrated (P1), shared libs (P2), all 15 edge functions updated (P3A+3B) — filterByDateTime rewritten, GPT prompt rewritten, 21 combos updated, budget/time removed. Phase 4 (mobile constants/types) next. |

### Cross-Cutting: UI Components & Design System

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0256 | Toast system | UI | S2 | unaudited | open | F | — | — |
| ORCH-0257 | In-app browser | UI | S2 | bug | closed | A | 2026-03-22 | Commit 0254bc4f |
| ORCH-0258 | Pull-to-refresh | UI | S2 | bug | closed | A | 2026-03-23 | Commit 2a96c8f6 |
| ORCH-0259 | Image with fallback | UI | S2 | unaudited | open | F | — | — |
| ORCH-0260 | Loading skeleton | UI | S3 | unaudited | open | F | — | — |
| ORCH-0261 | Keyboard-aware scroll view | UI | S2 | unaudited | open | F | — | — |
| ORCH-0262 | Success animation | UI | S3 | unaudited | open | F | — | — |
| ORCH-0263 | Popularity indicators | UI | S3 | unaudited | open | F | — | — |
| ORCH-0264 | Confidence score | UI | S3 | unaudited | open | F | — | — |
| ORCH-0265 | Icon map completeness | UI | S2 | bug | closed | A | 2026-03-22 | Commit 88f2d43f |
| ORCH-0412 | Default avatar color inconsistency — green/yellow/other colors in different app locations for users without profile pictures | UI | S2 | design-debt | open | F | — | User report 2026-04-13. Multiple avatar implementations with different color derivation logic. Need single source of truth. |

### Cross-Cutting: Code Quality & Type Safety

| ID | Title | Surface | Severity | Class | Status | Grade | Verified | Evidence |
|----|-------|---------|----------|-------|--------|-------|----------|----------|
| ORCH-0376 | 272 pre-existing TypeScript errors — full cleanup (dead code deletion + type fixes across 57 files) | Code Quality | S3 | design-debt | closed | A | 2026-04-11 | QA PASS 7/7, 0 defects (2 pre-existing noted). 272→0 errors. 50 dead files deleted. 57 files fixed. Reports: IMPLEMENTATION + QA_ORCH-0376_TYPESCRIPT_CLEANUP_REPORT.md |
| ORCH-0377 | Dead code: src/main.tsx | Code Quality | S3 | design-debt | closed | A | 2026-04-11 | Deleted in ORCH-0384 sweep. |
| ORCH-0378 | Dead code: SimpleAuthGuard.tsx | Code Quality | S3 | design-debt | closed | A | 2026-04-11 | Deleted in ORCH-0384 sweep. |
| ORCH-0379 | Dead code: PurchaseQRCode.tsx | Code Quality | S3 | design-debt | closed | A | 2026-04-11 | Deleted in ORCH-0384 sweep. |
| ORCH-0380 | SessionViewModal.tsx called 4 non-existent state setters — refactor remnant | Code Quality | S2 | bug | open | F | — | setParticipants/setSessionValid/setHasPermission/setIsAdmin removed during ORCH-0376. Session validation logic may be incomplete. |
| ORCH-0381 | calendar.tsx + checkbox.tsx are minimal stubs — need proper implementations if features activate | Code Quality | S3 | design-debt | open | F | — | Created during ORCH-0376 to satisfy imports from PreferencesSheet + OnboardingFlow. Functional but bare-minimum UI. |
| ORCH-0382 | BoardDiscussion dropdown menu renders flat — needs proper RN dropdown component | Collab Sessions | S2 | ux | open | F | — | Pre-existing: shadcn/Radix DropdownMenu never worked in RN. Now stubbed as pass-through (items always visible). Needs react-native-popup-menu or ActionSheet. QA_ORCH-0376 P2-001. |
| ORCH-0383 | enhancedFavoritesService dead code | Code Quality | S3 | design-debt | closed | A | 2026-04-11 | Deleted in ORCH-0384 sweep. smartNotificationService import stubbed. |
| ORCH-0384 | Full dead code sweep — 78 dead files deleted, 24K lines removed, across components/hooks/services/utils | Code Quality | S2 | design-debt | closed | A | 2026-04-11 | Forensic verified 87 candidates: 78 deleted, 12 false positives saved. 2 cascading fixes (useLifecycleLogger, enhancedFavoritesService). tsc=0, iOS build clean. Reports: INVESTIGATION + IMPLEMENTATION_ORCH-0384. |
| ORCH-0385 | Map avatars disappear after returning from background — `['nearby-people']` added to `CRITICAL_QUERY_KEYS` + tracksViewChanges reset | Map & Location | S1 | bug | closed | A | 2026-04-11 | QA PASS 7/7. Added `['nearby-people']` + `['map-settings']` to foreground refresh. tracksViewChanges resets on data change. 2 files, ~6 lines. Reports: INVESTIGATION + IMPLEMENTATION + QA_ORCH-0385. |

---

## Launch Readiness by Surface

See COVERAGE_MAP.md for detailed grade distribution.

---

## Active Investigations

| ID | Issue | Investigator | Started | Last Update | Status |
|----|-------|-------------|---------|-------------|--------|
| ORCH-0300 | App freshness architecture — content stale times, missing content realtime, foreground refresh gaps | Forensics | 2026-04-04 | 2026-04-04 | Dispatched |
| ORCH-0301–0304 | 4 deck bugs — duplicate cards, address not persisting, sparse deck, GPS location stale | Forensics | 2026-04-04 | 2026-04-04 | Dispatched |
| ORCH-0305–0307 | 3 admin card pool issues — browse visibility, generation skip transparency, progress feedback | Forensics | 2026-04-04 | 2026-04-04 | Dispatched |

---

## Top 20 Priorities

See PRIORITY_BOARD.md

---

## Invariant Registry

See INVARIANT_REGISTRY.md

---

## Decision Log

See DECISION_LOG.md

---

## Open Questions

| ID | Question | Context | Blocking | Date Raised |
|----|----------|---------|----------|-------------|
| OQ-001 | Is Phone OTP auth the only path or do Google/Apple bypass it? | Auth flow — determines S0 vs S1 | Yes — affects auth audit scope | 2026-03-30 |
| OQ-002 | Should Map/Chat/Calendar ship as launch features or be deferred? | 48+ F items across these three surfaces | Yes — determines audit scope | 2026-03-30 |
| OQ-003 | What is the launch city strategy? | Empty category pools need seeding per city | Yes — operational blocker | 2026-03-30 |

---

## Deferred Items

| ID | Title | Reason Deferred | Exit Condition | Date Deferred |
|----|-------|----------------|----------------|---------------|
| ORCH-0222 | Service error contract (ServiceResult<T>) | ~60+ call sites, high blast radius | Next hardening cycle | 2026-03-23 |

---

## Unresolved Operational Risks

| Risk | Probability | Impact | Mitigation | Owner |
|------|------------|--------|------------|-------|
| Empty category pools in launch city | High | Users see no cards for selected categories | Seeding pipeline exists but needs data | Ops |
| 54% of items at grade F (unaudited) | Certain | Unknown bugs shipping to production | Systematic audit wave needed | Orchestrator |
| No end-to-end test suite | Certain | Regressions undetectable without manual testing | Invest in automated testing | Engineering |
| Security layer completely unaudited | High | Potential data exposure, unauthorized access | RLS + PII audit needed before launch | Security |
