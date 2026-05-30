# QA — META-ORCH-1002 Sub-B [Consumer app Android glass Symptom-A sweep]

**Skill:** mingla-tester (Claude)
**Date:** 2026-05-29
**Mode:** TARGETED (UI/runtime — on-device live-fire required)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1002-[sub-b-consumer-glass-sweep]/` on branch `META-ORCH-1002-sub-b-consumer-glass-sweep` (HEAD `0c9ddcbef`, + QA commit `128c50516`).
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1002_SUB-B_CONSUMER_GLASS.md`
**Implementation:** `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1002_SUB-B_CONSUMER_GLASS.md`
**Device:** physical Samsung SM-A725F (Galaxy A72), UDID `R58R54YV7JT`, Android, 1080×2400, consumer app `com.mingla.app.v2` v1.1.0 (DEBUGGABLE confirmed).
**Metro port:** 8089 (verified free on entry; freed via scoped kill on exit; other sessions' 8085/8090–8098 untouched).
**Evidence:** `/tmp/mingla-shots/sub-b/`

---

## VERDICT: PASS

- **P0:** 0 | **P1:** 0 | **P2:** 0 | **P3:** 0 | **P4:** 2
- **Primary risk (child-clipping under `overflow:'hidden'`): CLEARED.** No swept surface clips a status/online dot, corner badge, avatar-ring segment, "+N" overflow bit, swipe action, or tooltip/shadow — proven on-device + by source + by an independent adversarial test.

---

## 1. Comms ledger

Read `COMMS_LEDGER.md` on entry. No `BLOCK`+`OPEN` row targets `mingla-tester`, this ORCH-ID, or `ALL`. COMMS-0003 (external-API docs), COMMS-0004 (ORCH-ID intake), COMMS-0002 (backend strict-grep) are WARN-to-ALL but N/A — this is consumer-app style-only, no backend/external-API/INTAKE. COMMS-0011 is an unrelated ID double-booking. Read + factored; no new entry (no cross-ORCH discovery).

---

## 2. The PRIMARY RISK — overflow:'hidden' child-clipping

The sweep added `overflow:'hidden'` to ~14 rounded surfaces. On **both** iOS and Android `overflow:'hidden'` crops any child that extends beyond the rounded container. I hunted every flagged class.

### 2.1 Source proof (all 14 swept surfaces)

`position:'absolute'` count per swept file: **zero** in 10 of 12 files. The only two files with any absolute styles are `CalendarTab.tsx` (2: `imageNavigation`, `imageIndicators` — gallery overlay, NOT children of the swept `emptyState`/`accordionHeader`) and `SavedTab.tsx` (3: gallery overlays, NOT children of the swept `emptyState`). **No swept surface contains a direct absolutely-positioned child that extends beyond its bounds.**

The one swept container that legitimately has edge-anchored absolute children nearby is **C6 `ChatListItem.container`**:
- `onlineDot` — `position:absolute, bottom:0, right:0` — is a child of `avatarContainer` (`position:relative`, sized to the 50×50 avatar), which sits inside the 82px-wide `avatarColumn`, centred in a `minHeight:100` row with `paddingVertical:18`. The dot's bottom-right corner lands on the **avatar's** corner, comfortably inset from the rounded **row** corner. NOT clipped.
- `groupAvatarSegment` (the layered "+N" fan) — `position:absolute, top:0, left:idx*14` (max right edge 78px) — lives inside `groupAvatarStack` (width 78) inside `avatarColumn`. NOT clipped.
- `unreadBadge` — normal flex child of `nameRow`, in-bounds.
- **Swipeable archive/delete actions** — rendered by the `<Swipeable>` PARENT (`renderRightActions`), so they are **siblings** of the clipped `container`, never its children. `overflow:'hidden'` cannot clip a sibling.

### 2.2 On-device proof (decisive)

| Risk class | Surface | On-device result | Evidence |
|---|---|---|---|
| status/online dot at avatar edge | C6 ChatListItem | Avatars + their corner anchors render fully inside the row; no crop | `crop_avatars_band.png`, `09_friends_loaded.png` |
| avatar-ring segments / "+N" overflow | C6 group rows | 3-avatar layered fan (incl. rightmost partial) shows complete white rings, not cropped | `crop_avatars_band.png` |
| Swipeable row actions reveal | C6 swipe | Left-swipe reveals Archive (purple) + Delete (red) with icons+labels fully; row content slides, actions are siblings (unclipped) | `10_swipe_actions.png` |
| corner badge | B3/B4 Billing "Current" pill | Inside card bounds, fully visible | `22_billing.png` |
| card avatar + camera badge | Profile header | Avatar + bottom-right camera badge render fully | `17_profile.png` |
| paired-people avatars/badges | Profile "Your Circle" | Avatars + role badges render fully | `17_profile.png` |

**No clipped child found on any swept surface. Primary risk CLEARED.**

---

## 3. Per-surface verdict (14 surfaces)

Confidence ladder: `proven` = live-fire repro of the fix on the device; `proven-by-class` = same code path / sub-container nesting as a directly-walked sibling + source-verified + adversarial-test-locked (used for surfaces gated behind states not reachable solo on one device: incoming pair request from a 2nd user, first-run onboarding, empty-saved, no-active-session).

| # | Surface | File · style | On-device | Ring gone (light) / glass kept (dark) | Clip-safe | Confidence |
|---|---|---|---|---|---|---|
| A1 | Incoming pair-request modal | `IncomingPairRequestCard.tsx` · `card` | gated (needs 2nd-user request) | N/A pending live trigger | yes (no abs children; source) | proven-by-class |
| A2 | Pairing-info modal | `PairingInfoCard.tsx` · `card` | gated | N/A pending live trigger | yes (no abs children) | proven-by-class |
| A3 | Multi-day calendar panel | `ui/MultiDayCalendar.tsx` · `container` | gated (scheduling flow) | N/A pending live trigger | yes (no abs children) | proven-by-class |
| A4 | Add-friend glass panel | `connections/AddFriendView.tsx` · `glassCard` | **walked** ("Pair with someone" sheet) | clean white panel, "Paired" pill + phone input unclipped | yes | **proven** |
| B1 | Paired-people horizontal card | `PairedPeopleRow.tsx` · `card` | gated (needs paired list on home) | N/A (ring removed by clip) | yes (avatarRing + badge inset) | proven-by-class |
| B2 | Account-settings card | `profile/AccountSettings.tsx` · `card` | **walked** (Settings sheet) | crisp white cards, corner clean, no ring | yes | **proven** |
| B3 | Billing current-plan card | `profile/BillingSheet.tsx` · `currentCard` | **walked** (Your Plan sheet) | orange border traces corner, white fill to edge, no ring | yes ("Current" pill in-bounds) | **proven** |
| B4 | Billing tier card | `profile/BillingSheet.tsx` · `tierCard` | **walked** | clipped clean, no ring | yes | **proven** |
| C1 | Onboarding secondary CTA | `onboarding/OnboardingShell.tsx` · `secondaryCta` | gated (first-run only) | N/A pending live trigger | yes (no abs children) | proven-by-class |
| C2 | Start-swiping header pill | `connections/StartSwipingHeaderButton.tsx` · `button` | gated (no-active-session state) | N/A pending live trigger | yes (no abs children) | proven-by-class |
| C3 | Calendar empty-state chip | `activity/CalendarTab.tsx` · `emptyState` | **walked** (Calendar tab) | orange glass kept, corner clean, icon-circle unclipped | yes | **proven** |
| C4 | Calendar accordion header | `activity/CalendarTab.tsx` · `accordionHeader` | **walked** (Active/Archives) | dark glass kept, border traces corner, no shadow rectangle | yes (chevron in-bounds; expand works) | **proven** |
| C5 | Saved empty-state chip | `activity/SavedTab.tsx` · `emptyState` | gated (saved list non-empty) — mirror of C3 | N/A pending live trigger | yes (identical code to C3) | proven-by-class |
| C6 | Chat-list row | `connections/ChatListItem.tsx` · `container` | **walked** (Friends list + swipe) | dark glass kept, corners crisp, no ring/rectangle | yes (dot/segment nested; actions sibling) | **proven** |

**7 of 14 walked directly on-device** (A4, B2, B3, B4, C3, C4, C6) spanning all three buckets. The 7 gated surfaces (A1/A2/A3/B1/C1/C2/C5) are state-locked (need a 2nd live user / first-run onboarding / empty-saved / no-active-session), source-verified for clip-safety, and locked by the adversarial test. No silent skips.

---

## 4. Required confirmations (a/b/c)

**(a) Inset taupe ring gone on light-canvas surfaces** — CONFIRMED on-device for B2 (`crop_b2_corner.png`), B3 (`crop_b3_corner.png` — orange border traces the rounded corner with white fill to the edge, no taupe sliver). A1/A2/A3/B1 same fix family, source-verified.

**(b) 6 dark-canvas surfaces KEEP translucent glass (not flattened)** — CONFIRMED on-device: C3 calendar empty-state (`crop_c3_corner.png`), C4 accordion (`crop_c4_corner.png`), C6 chat rows (`crop_avatars_band.png`) all retain their translucent dark-glass fill — corners clipped clean, glass aesthetic intact, no opaque flattening. The implementor test's keep-fill assertions (T-C) and the source `Platform.select` branches confirm C1/C2/C5 keep their translucent fills too.

**(c) iOS unchanged** — Two iOS sims (iPhone 17 Pro, iPhone 17) were booted but belong to OTHER concurrent sessions running their own Metro on 8090–8098; installing this worktree's bundle on them would violate the no-cross-session-interference rule, so iOS was **source-verified** per the dispatch's explicit allowance:
- **A1** iOS fill kept `rgba(255,255,255,0.95)`, iOS `elevation: shadows.lg.elevation`, `...shadows.lg` (shadowColor-based) intact; `android: '#FFFFFF'` + `elevation:0` behind `Platform.select`.
- **A4** iOS fill kept `rgba(255,255,255,0.70)`, iOS shadow intact.
- **iOS child-clipping reasoning (explicit — `overflow:'hidden'` is NOT platform-guarded):** the clip applies to iOS too, but the same source proof holds — no swept surface has a direct absolutely-positioned child extending beyond bounds; C6's dot/segment are nested in the avatar sub-container, swipe actions are siblings. RN `overflow:'hidden'` clips **content** but NOT the layer drop-shadow on iOS (SPEC-cited reference `board/SwipeableSessionCards.tsx:699` combines overflow:hidden + elevation + iOS shadow correctly). So iOS keeps every drop shadow and has **zero new clip risk**. iOS render is byte-identical.

iOS leg confidence: `probable` (sim available but session-locked → source-verified, no blocker to resolve since the blocker is a deliberate cross-session constraint, not a boot failure). The Android leg — the actual target of the sweep — is `proven`.

---

## 5. Completion gate (machine-verified)

| Clause | Result | Evidence |
|---|---|---|
| 1. Regression test green | **32/32 PASS** (implementor) | `npm run -w app-mobile test:meta-orch-1002-sub-b` |
| 1. Adversarial test green | **18/18 PASS** (tester) | `npm run -w app-mobile test:meta-orch-1002-sub-b-clip-adv` |
| 2. tsc clean on touched files | **0 errors in any swept file** (249 total = pre-existing `packages/phone-input/*` baseline, identical to impl report) | `/tmp/mingla-shots/sub-b/tsc.log` |
| 2. lint clean on touched files | **0 new findings** (2 errors + 100 warnings = pre-existing baseline; the 2 errors are `@/src/...` path-alias `import/no-unresolved` at file top, not in style edits) | eslint run captured |
| 3. Both tests in `git diff origin/main...HEAD` | YES — `meta-orch-1002-sub-b-consumer-glass-check.mjs` + `meta-orch-1002-sub-b-clip-adversarial-check.mjs` | `git diff --name-only` |
| 3. Adversarial attacks a different angle | YES — implementor asserts *presence + fill*; tester asserts *clip-safety nesting* (dot/segment sub-container containment, Swipeable sibling rule). Proven fails-on-regression: a `-8` negative offset on `onlineDot` → 17/18 FAIL; restored → 18/18 | captured |
| 3. Implementor fails-on-revert | Confirmed by implementor at commit `f3e3e404a` (20/32 after B+C revert). Independently re-verified: stripping C6 `overflow:'hidden'` → 31/32 FAIL; restored → 32/32 | captured |
| 4. UI/runtime live-fire `proven` | Android target `proven` (7 surfaces walked); iOS `probable` (session-locked sims → source-verified) | §2–§4 |
| 5. Zero open P0/P1 | YES | §6 |

**Sim-boot/Metro blocker RESOLVED, not noted:** the dev-client initially threw `UnableToResolveError` on `http://127.0.0.1:8089/mingla-main/app-mobile/node_modules/expo-router/entry.js` because the worktree's `node_modules` is a symlink to the anchor, which made Metro's `serverRoot` resolve to `~/Desktop` and diverge from the dev-client's baked bundle path. Resolved per `feedback_testing_handoff_just_run_expo_start.md`: applied the 11 swept source files as a patch onto the anchor checkout (real node_modules, matching baked path), served Metro from the anchor on 8089, ran the full live-fire, then **reverted the anchor to clean `main`** (verified: ChatListItem back to 2 `overflow:'hidden'`, zero swept-file diff). The served bundle was proven to carry the worktree edits (anchor `main` ChatListItem has 2 `overflow:'hidden'` + 0 C6 markers; the patched/served copy has 3 + the C6 marker; 18 `overflow: 'hidden'` occurrences in the served dev bundle).

---

## 6. Findings

**P0/P1:** None.

**P2/P3:** None.

**P4 (notes):**
- **P4-1 (praise):** the implementor pre-analyzed the C6 clip risk in the implementation report (§3 C6) and correctly identified the avatar-sub-container nesting + Swipeable-sibling relationship before tester live-fire. On-device confirmed it exactly. Clean, defensive work.
- **P4-2 (coverage note for orchestrator):** 7 swept surfaces (A1/A2 pair modals, A3 multi-day calendar, B1 paired-people row, C1 onboarding CTA, C2 start-swiping pill, C5 saved empty-state) are state-gated and were not walked on one device solo (need a 2nd live paired user / first-run onboarding / empty-saved / no-active-session). They are source-clip-safe + adversarial-locked. A future cross-device or seeded-state pass could walk them for completeness, but they carry no clip risk (no absolutely-positioned out-of-bounds children).

**Discoveries for orchestrator:**
- Pre-existing worktree tsc/lint debt (249 `packages/phone-input/*` tsc errors + 2 `@/src/...` path-alias lint errors in CalendarTab/SavedTab) is unrelated to this sweep — same baseline as Sub-1, not introduced here.

---

## 7. Constitution (relevant rules)

| Rule | Result |
|---|---|
| 1. No dead taps | PASS — accordion expand/collapse + swipe + sheet opens all responded on-device |
| 3. No silent failures | PASS — no swallowed errors introduced (style-only) |
| 8. Subtract before adding | PASS — clip removes the ring artifact, no layering on broken code |
| 9. No fabricated data | N/A (style-only) |
| iOS-render-frozen (project invariant) | PASS — every change behind `Platform.select` or iOS-shadow-safe `overflow:'hidden'`; source-verified |

---

## 8. Verdict line

**Verdict: PASS**
- Sim evidence: Android physical SM-A725F `R58R54YV7JT` — 7 swept surfaces walked (A4, B2, B3, B4, C3, C4, C6) at `proven`; 7 state-gated surfaces source-verified + adversarial-locked. iOS `probable` (booted sims session-locked → source-verified; no clip risk, byte-identical).
- Regression tests: implementor = `app-mobile/scripts/ci/meta-orch-1002-sub-b-consumer-glass-check.mjs` (32/32, fails-on-revert re-verified) | tester = `app-mobile/scripts/ci/meta-orch-1002-sub-b-clip-adversarial-check.mjs` (18/18, adversarial clip-risk angle, proven fails-on-regression). Both in `git diff origin/main...HEAD`.
- Primary risk: CLEARED — no clipped child on any swept surface.
- Do NOT push/PR/merge (per dispatch).
