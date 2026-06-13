# INVESTIGATION — ORCH-1133 [revert checkout cover to original compact band + give the public-event Sound pill clearance from the details section]

**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1133-[revert-cover-pill-bottom]/` on branch `ORCH-1133-revert-cover-pill-bottom`
**Base:** rebased on origin/main `907b2b2a0` (contains ORCH-1132 full-frame cover + pill `right:24` / `bottom:22`).
**Date:** 2026-06-13
**Confidence:** PROVEN (live-fire on buyer web: `https://business.usemingla.com/e/leggothis/vibes-and-stuff` + `/a-life-in-vegas`).

This is round 3 of the cover/pill saga (ORCH-1128 → 1131 → 1132 → 1133). Seth rejected ORCH-1132's full-frame cover on his dev build ("The get tickets page now looks awful, revert. The cover fills the entire screen. Revert to original.") and separately ("The sound button still needs some space or padding from the details section.").

---

## Symptom summary (expected vs actual)

| # | Expected | Actual (current main 907b2b2a0) |
|---|----------|----------------------------------|
| S1 | The three Get-tickets checkout mini-card covers show a SMALL compact band (the pre-ORCH-1131 original). | ORCH-1132 made each cover adaptive-aspect full-frame (`aspectRatio` driven by `onAspectRatio`, `videoContentFit="contain"`). A portrait cover (0.5625) clamps to 0.6 → balloons to ~screen-width-tall, "fills the entire screen". |
| S2 | The public-event "Sound" pill sits with clear, visible separation above the blue details panel. | The pill (`bottom:22`) overlaps the details panel top edge by 6px — the panel (rounded, `marginTop:-28`) covers the pill's bottom. Pill bleeds into the details section. |

---

## Investigation manifest (every file read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `COMMS_LEDGER.md` | Mandatory entry scan. No BLOCK/WARN row targets forensics / ORCH-1133 / ALL relevant to cover/pill (active rows are trip-migration COMMS-0029 etc.). |
| 2 | `mingla-business/app/checkout/[eventId]/index.tsx` | Event checkout cover (current ORCH-1132 state + state hooks + styles). |
| 3 | `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` | Trip checkout cover (parallel). |
| 4 | `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx` | Experience checkout cover (parallel). |
| 5 | `git show e90875dda~1:<each of the 3 files>` | The TRUE original (pre-ORCH-1131) cover code to restore. |
| 6 | `packages/event-rendering/EventCoverMedia.tsx` | Shared `audioControlBottomRight` pill style (`right:24`, `bottom:22`). |
| 7 | `packages/event-rendering/PublicEventPage.tsx` | Public hero (`heroBox`) + details panel (`bodyContent`, `marginTop:-28`) geometry. |
| 8 | `app-mobile/src/components/expandedCard/ImageGallery.tsx` | Consumer cross-surface consumer of the shared `bottomRight` pill. |
| 9 | CoverPicker / ExperienceCoverStep / TripCreatorStep1Basics / EditPublishedTripScreen / CreatorStep4Cover | Authoring-preview consumers (default `bottomRight`). |
| 10 | 6 jest test files (1131/1132/1128/eventCoverMedia) | Regression assertions on the values being changed. |
| 11 | `.github/scripts/test-append-only-check.js`, `tests-append-only.yml`, `regression-test-backfill-warning.mjs` | Append-only override mechanics. |

---

## Q-scorecard

**Q1 — What was the TRUE original checkout cover (the one Seth wants back)?**
Verdict (PROVEN): `git show e90875dda~1` shows in all three files an identical `miniCover` block —
```
miniCover: {
  height: 64,
  borderRadius: radiusTokens.md,
  marginBottom: spacing.sm,
},
```
and a plain `<EventCoverMedia hue=… mediaUrl=… mediaType=… radius={0} label="" style={styles.miniCover} />` with NO `coverAspect` state, NO `onAspectRatio`, NO `videoContentFit`, NO inline `aspectRatio`. (F-1)

**Q2 — What did ORCH-1131 + ORCH-1132 add on top that must be removed?**
Verdict (PROVEN): ORCH-1131 changed height 64→120; ORCH-1132 removed the fixed height entirely and added (a) `const [coverAspect, setCoverAspect] = useState(0.75)` + `const clampedCoverAspect = Math.min(Math.max(coverAspect, 0.6), 1.91)`, (b) `onAspectRatio={setCoverAspect}` + `videoContentFit="contain"` + `style={[styles.miniCover, { aspectRatio: clampedCoverAspect }]}` on the JSX, (c) a 6-line ORCH-1132 comment block in `miniCover` and removal of `height:`. All of (a)(b)(c) revert. (F-2)

**Q3 — Does removing `coverAspect` orphan the `useState` import in any file?**
Verdict (PROVEN): YES in trip + experience. Original imports were `{ useCallback, useMemo }` (trip) and `{ useCallback }` (experience) — neither imported `useState`. The event file's original import IS `{ useCallback, useState }` because `waitlistTicketId` also uses `useState` (line 81), so the event file KEEPS `useState`. (F-3)

**Q4 — How does the public details panel overlap the pill, and what is the measured gap?**
Verdict (PROVEN, live-fire): `bodyContent` (the blue/dark rounded details panel, `borderTopLeftRadius:28`) has `marginTop:-28`, so its top edge sits 28px above the cover/hero bottom. The pill has `bottom:22` + `minHeight:36`. Measured on buyer web: pill bottom = hero_bottom − 22; panel top = hero_bottom − 28 → **gap = panelTop − pillBottom = −6.0px on BOTH rendered events**. The panel overlaps the pill's bottom 6px. (F-4)

**Q5 — What `bottom` value gives clear, visible separation?**
Verdict (PROVEN, live-fire): the CSS `bottom` value equals `28 + desiredGap`. Injecting candidates at runtime: `bottom:40` → measured gap **+12.0px** (clean); `bottom:44` → **+16.0px**. Recommend **`bottom:40`** (12px clearance — a deliberate, visible gap above the panel, without over-lifting the pill into the cover subject). (F-5)

**Q6 — Cross-consumer blast radius of a larger `bottom` on the shared pill?**
Verdict (PROVEN, source + render): benign. Consumers — PublicEventPage hero (target), app-mobile ImageGallery (full-bleed gallery slide), and 5 authoring previews (CoverPicker / ExperienceCoverStep / TripCreatorStep1Basics / EditPublishedTripScreen / CreatorStep4Cover) — all render the pill on a FULL-BLEED cover ≥ ~200px tall. A 36px-tall pill at `bottom:40` only goes off-screen if the cover box is < 76px tall; none are. No bottom-panel collision exists on those surfaces. The candidate render (430×932 viewport) showed the pill clear of top chrome (X / share) and not pushed off-screen. (F-6)

**Q7 — Which jest tests assert the values being changed, and what is their CURRENT pass state?**
Verdict (PROVEN): SIX files assert these values; THREE are ALREADY FAILING on current main (8 failed tests), pre-introduced by ORCH-1132's `right:16→24` + bloated comment block (the business app has NO full jest CI gate, so ORCH-1132 merged green). See F-7 + Discoveries. The clamp-execution test becomes structurally invalid post-revert (no clamp to extract). (F-7)

---

## Findings (six-field evidence)

### F-1 — TRUE original cover is `height:64` compact band + plain EventCoverMedia (CONFIRMED ROOT CAUSE of S1 revert target)
- **Symptom:** Seth wants "the original" back.
- **Layer:** code.
- **Probe:** `git show 'e90875dda~1:mingla-business/app/checkout/[eventId]/index.tsx'` (and trip/experience).
- **Evidence (verbatim, all three identical):**
  ```
  miniCover: { height: 64, borderRadius: radiusTokens.md, marginBottom: spacing.sm },
  ```
  JSX (event): `<EventCoverMedia hue={event.coverHue} mediaUrl={event.coverMediaUrl} mediaType={event.coverMediaType} radius={0} label="" style={styles.miniCover} />`. Trip/experience use `hue={0}` + their own media fields, otherwise identical (no aspect props).
- **Mechanism:** the fixed 64px band gives the component's default cover-fill (`videoContentFit` default = `"cover"`) → small compact thumbnail, never balloons.
- **Severity:** CONFIRMED ROOT CAUSE (revert target).

### F-2 — Current ORCH-1132 cover is adaptive-aspect full-frame → balloons portrait covers (CONFIRMED ROOT CAUSE of S1)
- **Symptom:** "The cover fills the entire screen."
- **Layer:** code.
- **Probe:** read current files (lines: event 87-88/248-257/353-362; trip 138-139/310-321/438-447; experience 102-103/252-261/339-348).
- **Evidence (event, verbatim):**
  ```
  const [coverAspect, setCoverAspect] = useState(0.75);
  const clampedCoverAspect = Math.min(Math.max(coverAspect, 0.6), 1.91);
  …
  onAspectRatio={setCoverAspect}
  videoContentFit="contain"
  style={[styles.miniCover, { aspectRatio: clampedCoverAspect }]}
  …
  miniCover: { /* ORCH-1132 6-line comment */ borderRadius: radiusTokens.md, marginBottom: spacing.sm },  // NO height
  ```
- **Mechanism:** a 360×640 (0.5625) portrait cover → clamp floors to 0.6 → the column-width mini-card box becomes ~0.6 aspect → ≈ screen-width-tall band → "fills the entire screen."
- **Severity:** CONFIRMED ROOT CAUSE.

### F-3 — Reverting `coverAspect` orphans `useState` in trip + experience ONLY (SECONDARY)
- **Symptom:** would leave an unused import → lint/TS noise (and the original had no `useState` there).
- **Layer:** code.
- **Probe:** `grep -n useState` current vs `git show e90875dda~1:…`.
- **Evidence:** current trip import `import React, { useCallback, useMemo, useState }`; original `…{ useCallback, useMemo }`. current experience import `…{ useCallback, useState }`; original `…{ useCallback }`. Event original IS `…{ useCallback, useState }` (kept — `waitlistTicketId` uses it, line 81).
- **Mechanism:** `coverAspect`/`setCoverAspect` are the SOLE `useState` users in trip + experience; removing them must drop `useState` from those two imports (NOT the event import).
- **Severity:** SECONDARY ROOT CAUSE (revert correctness).

### F-4 — Details panel overlaps the pill by −6px (CONFIRMED ROOT CAUSE of S2)
- **Symptom:** "The sound button still needs some space or padding from the details section."
- **Layer:** code + runtime.
- **Probe:** Playwright/Chrome (channel:chrome, 430×932@2x) on `…/e/leggothis/vibes-and-stuff` and `…/a-life-in-vegas`; measured `getBoundingClientRect()` of the pill (aria-label "Turn on cover video audio"), the panel (`borderTopLeftRadius:28`), and the `<video>` hero. Script: `/tmp/orch1133_measure.mjs`. Evidence: `Mingla_Artifacts/evidence/ORCH-1133/`.
- **Evidence (verbatim):**
  - vibes-and-stuff: `PILL.bottom = 551.3  PANEL.top = 545.3  GAP = -6.0px`; `PILL.bottom inset from HERO.bottom = 22.0px`.
  - a-life-in-vegas: `PILL.bottom = 219.9  PANEL.top = 213.9  GAP = -6.0px`; inset `22.0px`.
  - source: `PublicEventPage.tsx` `bodyContent { marginTop: -28 }` (line 1461); `EventCoverMedia.tsx` `audioControlBottomRight { right: 24, bottom: 22 }` (lines 616/619); pill `minHeight: 36` (line 587).
  - screenshot `seam_leggothis__vibes-and-stuff.png` shows the "Sound" pill bottom clipped behind the rounded panel top.
- **Mechanism:** panel top = hero_bottom − 28; pill bottom = hero_bottom − 22 → pill bottom is 6px BELOW the panel top → panel covers/touches the pill bottom = the visible bleed.
- **Severity:** CONFIRMED ROOT CAUSE.

### F-5 — `bottom:40` yields a clean +12px gap (the fix value, live-verified)
- **Symptom:** need clear separation.
- **Layer:** runtime.
- **Probe:** `/tmp/orch1133_verify_bottom.mjs` — injected `pill.style.bottom` and re-measured on vibes-and-stuff.
- **Evidence (verbatim):** `candidate bottom:40 => gap:12`; `candidate bottom:44 => gap:16`. Screenshot `candidate_bottom40_vibes.png` shows the Sound pill clearly separated above the blue details panel, clear of the top X/share chrome, not off-screen.
- **Mechanism:** CSS `bottom = 28 (panel overlap) + desiredGap`. 40 → +12px (one perceptible step, matches the "needs some space/padding" ask without lifting the pill into the cover subject). 44 (= spacing.md gap of 16) is the more-generous alternative.
- **Severity:** N/A (the chosen fix value).

### F-6 — Shared-pill blast radius is benign across all consumers
- **Symptom:** a larger bottom inset could push the pill off-screen / behind chrome on another surface.
- **Layer:** code + render.
- **Probe:** grep `showAudioControl` / `audioControlPosition` consumers; read each preview box style; the candidate render at 430×932.
- **Evidence:** consumers = PublicEventPage hero (target), `app-mobile/.../ImageGallery.tsx:134` (`bottomRight`, full-bleed `styles.image`), and 5 authoring previews (CoverPicker:1053, ExperienceCoverStep:107, TripCreatorStep1Basics:504, EditPublishedTripScreen:1446, CreatorStep4Cover:99 — all default `bottomRight`). All preview boxes are `overflow:hidden` + aspect-driven full-bleed media (≥ ~200px tall when populated). `SwipeableCards.tsx:335` passes `showAudioControl={false}` (deck card — pill never renders; explicitly out of scope per dispatch).
- **Mechanism:** +18px bottom on a ≥200px full-bleed cover keeps the 36px pill comfortably inside; no surface has a bottom panel at that inset except the public hero (the one we are fixing).
- **Severity:** RULED OUT (no adverse cross-consumer effect).

### F-7 — Six test files assert the changed values; three ALREADY FAIL on current main (CONFIRMED)
- **Symptom:** ORCH-1133's reverts/round-3 values contradict pinned jest assertions.
- **Layer:** code (tests).
- **Probe:** `npx jest` on the 6 files at HEAD 907b2b2a0 (clean worktree).
- **Evidence (verbatim):** `Test Suites: 3 failed, 3 passed; Tests: 8 failed, 58 passed`. Failing files: `eventCoverMedia.test.ts`, `orch1128FreeCtaMutePill.test.ts`, `orch1128FreeCtaMutePill.adversarial.test.ts`. Assertions touched:
  - `orch1131CoverCropSoundInset.test.ts:81/87-88` — miniCover NO height + `videoContentFit="contain"` + `onAspectRatio=` → ALL INVERT under revert; `:101` `right===24` KEEP; `:105` `bottom===22` → 40.
  - `orch1131SiblingInsetNonRegressionAdversarial.test.ts:87` `right [24]` KEEP; `:88` `bottom [22]` → `[40]`. (topLeft/topRight/heroBox assertions untouched — stay green.)
  - `orch1132ClampMathHeroIsolationAdversarial.test.ts` — first `describe` (83-139) + the cross-file check (159-168) call `extractClamp(checkoutSrc)`, which THROWS post-revert (no `Math.min(Math.max(...))` clamp left in the checkout files) → whole file invalid. SC-7 block (171-192, EventCoverMedia `videoContentFit` default = `"cover"`) stays valid. → DELETE the file (its subject, the checkout clamp, is removed); the SC-7 assertions are already covered by the SC-7 default check and can be dropped with it.
  - `eventCoverMedia.test.ts:369` `right: 14` (stale; current is 24) + `:371` `bottom: 22` → `right: 24` + `bottom: 40`, and WIDEN the 400-char slice (the ORCH-1132 comment block pushed `bottom:` out of the window → current failure).
  - `orch1128FreeCtaMutePill.test.ts:97` `/bottom:\s*22/` → `/bottom:\s*40/` (+ slice/window fix).
  - `orch1128FreeCtaMutePill.adversarial.test.ts:122-127` numeric `bottom > 14` (passes for 40) but currently NULL because the 400-char slice from `audioControlBottomRight:` no longer reaches `bottom:` (ORCH-1132 comment bloat); `:133` `right:\s*14` (stale — current is 24) → must update to 24. WIDEN the slice and update `right` to 24.
- **Mechanism:** ORCH-1132 changed `right` + bloated the comment but did not update `eventCoverMedia` + `orch1128` tests; no full jest gate caught it. ORCH-1133 must bring all in-scope pill/cover assertions back to GREEN at the round-3 values.
- **Severity:** CONFIRMED (regression-test update plan, not a product bug).

---

## Five-Truth-Layer reconciliation

| Layer | Truth | Contradiction? |
|-------|-------|----------------|
| Docs | Seth: revert cover to original; give pill space from details. | — |
| Schema | n/a (pure RN style). | — |
| Code | Checkout = ORCH-1132 adaptive full-frame; pill `right:24`/`bottom:22`. | Code ≠ desired (S1+S2). |
| Runtime | Buyer web: pill overlaps panel by −6px; portrait cover balloons. | Confirms code → symptom. |
| Data | live events `leggothis/vibes-and-stuff`, `/a-life-in-vegas` (video covers). | — |

**Flagged contradiction:** three jest files assert values that no longer match current main (ORCH-1132 drift) — see F-7 / Discoveries.

---

## Repro evidence

Buyer web, Chrome (Playwright channel:chrome), 430×932@2x, prod `https://business.usemingla.com`:
- `Mingla_Artifacts/evidence/ORCH-1133/repro_leggothis__vibes-and-stuff.png` + `seam_*.png` — pill bottom clipped behind details panel (−6px).
- `…/repro_leggothis__a-life-in-vegas.png` + `seam_*.png` — same, −6px.
- `…/candidate_bottom40_vibes.png` — pill cleanly separated (+12px) at `bottom:40`.
- (raleigh-wine-and-dine-crawl returned null — status `scheduled`, no rendered video hero; the two live ones reproduce.)

---

## Blast radius / cross-surface map

| Surface | In scope | Effect |
|---------|----------|--------|
| Buyer/anon Web (`/checkout/*`, `/e/*`) | YES | cover revert (3 checkouts) + pill `bottom:22→40` on `/e/*` hero. |
| Business iOS/Android | YES (checkout cover only) | same 3 checkout files reverted. |
| Consumer iOS/Android (ImageGallery pill) | YES (shared pill only, benign) | pill moves +18px up on full-bleed gallery slide; no panel collision. |
| Authoring previews (5 mounts) | YES (shared pill only, benign) | pill +18px up on full-bleed preview; benign. |
| Consumer deck card (`SwipeableCards`) | NO | `showAudioControl={false}` — pill never renders. |
| Public hero cover rendering | NO (DO-NOT-TOUCH) | `right:24` + hero clamp untouched. |
| Admin Web | NO | no consumer. |

---

## Invariant impact
- `I-1128` (pill clears the cover seam) — PRESERVED and strengthened (22→40 widens clearance).
- No new invariant required; the regression test (updated to `bottom:40`) is the durable guard.

## Discoveries for Orchestrator
1. **DISC-1 (pre-existing, P2):** 3 jest files (`eventCoverMedia.test.ts`, `orch1128FreeCtaMutePill.test.ts` + `.adversarial.test.ts`) are RED on current main (8 failed tests) — ORCH-1132 changed `right:16→24` and bloated the `audioControlBottomRight` comment (pushing `bottom:` out of the tests' 400-char slice window) without updating these files. They merged because mingla-business has NO full jest CI gate (only strict-grep + append-only + a single `featureFlags.test.ts`). ORCH-1133 fixes the pill-related assertions as part of its test update; the slice-window brittleness should be hardened (parse the style block, not a fixed 400-char slice).
2. **DISC-2 (pre-existing, out of scope):** other `eventCoverMedia.test.ts` failures (upload-limits / iOS-image / native-trim copy) read `CreatorStep4Cover.tsx` and assert strings that moved into `CoverPickerSheet` under ORCH-0989 — unrelated cover-picker drift, NOT touched by ORCH-1133.

## Confidence
PROVEN — buyer-web live-fire measured the −6px overlap and the +12px fix on two live events; source diff against `e90875dda~1` is exact.

## Recommended next phase
SPEC (this dispatch is INVESTIGATE-THEN-SPEC). Then implementor. Scope: the exact per-file revert of the 3 checkout covers + `bottom:22→40` on the shared pill + the regression-test update with `[TEST-MOD-APPROVED ORCH-1133]`. NO product-code beyond these. DO-NOT-TOUCH: `right:24`, the public hero cover rendering / hero clamp, the consumer deck card.
