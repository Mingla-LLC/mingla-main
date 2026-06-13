# TEST — ORCH-1133 [revert checkout cover to original compact band + Sound-pill clearance from the details section]

**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1133-[revert-cover-pill-bottom]/` on branch `ORCH-1133-revert-cover-pill-bottom`
**HEAD at test:** `daeeda425` (tester adversarial commit) on top of `d2c54b23f` (implementor revert commit, carries the `[TEST-MOD-APPROVED ORCH-1133]` test-mod token; re-carried in HEAD after the tester commit — see Finding P3-1).
**Base:** origin/main `907b2b2a0`.
**Mode:** TARGETED + SPEC-COMPLIANCE. Buyer web is the authoritative live-fire surface.
**Date:** 2026-06-13.

---

## 1. Verdict

# PASS

**Finding counts:** P0: 0 · P1: 0 · P2: 0 · P3: 1 (a CI-gate hazard the tester caught AND resolved in-lane on the test commit) · P4: 2 (pre-existing notes).

Seth's two round-3 complaints are BOTH resolved with `proven`-level runtime evidence:
1. "The cover fills the entire screen. Revert to original." → the three checkout covers now render a **compact 64px band** (independently measured h=64 on a live local web build), not a full-screen cover.
2. "The sound button still needs some space or padding from the details section." → the public-event Sound pill now clears the blue details panel by **+12px** (independently measured on live prod: prod's old `bottom:22` = −6px overlap; the new `bottom:40` = +12px gap), and the pill still **FIRES** at runtime (clicking it flipped the cover `<video>` from `muted:true` → `muted:false`).

Regression gate satisfied (implementor happy-path with fails-on-revert + tester adversarial on a different angle, both on-branch and in-diff). Append-only gate green 7/7. Non-regression proven by full-suite baseline diff (branch has FEWER failures than origin/main).

---

## 2. SC-by-SC matrix

| SC | Criterion | Verdict | Evidence (runtime / live-fire) |
|----|-----------|---------|--------------------------------|
| **SC-1-Web** | `/e/*` Sound pill bottom ≥10px above details panel (target +12) | **PASS** | Tester Playwright (chromium-headless, 430×932@2x) on live `https://business.usemingla.com/e/leggothis/vibes-and-stuff`: PROD `bottom:22` → pill.bottom=551, panel.top=545, **gap=−6px** (the bug); injected `bottom:40` → pill.bottom=533, panel.top=545, **gap=+12px**. Matches implementor + forensics. Screenshot `/tmp/orch1133_tester_pill.png`. |
| **SC-1-fire** | The pill must STILL FIRE (mute/unmute, no dead tap) | **PASS** | Same Playwright session: located `[role="button"]` "Sound", clicked. Cover `<video>` `muted:true → muted:false`; pill text "Sound" → toggled. Runtime firing proof, not source wiring. |
| **SC-2-Web** | Each checkout shows a fixed 64px compact band (not full-screen); `miniCover` declares `height:64` | **PASS** | Tester ran THIS worktree's Expo web build (`expo start --web :8095`), loaded `/checkout/09b4ece6-eabc-4734-8ce3-3a25d90417e4`: cover VIDEO measured **w=382, h=64, top=81**, page = compact "Vibes and Stuff" mini-card, **0 console errors**. Screenshot `/tmp/orch1133_tester_checkout.png`. Contrast: prod (old code) = h=684 full-screen (`BEFORE_prod_checkout_cover_fullscreen.png`). |
| **SC-2-iOS / SC-2-Android** | Same compact band (shared RN code) | **PASS (parity automatic)** | Single RN codebase; all 3 routes' `miniCover` = `{height:64, borderRadius:radiusTokens.md, marginBottom:spacing.sm}` + plain 6-prop `<EventCoverMedia>`. The web export is the faithful render of the RN source. No platform-specific cover code. |
| **SC-3** | 3 checkout files have NO coverAspect/setCoverAspect/clampedCoverAspect/onAspectRatio/videoContentFit/inline aspectRatio; plain 6-prop call | **PASS** | grep across all 3 files: 0 forbidden tokens. JSX = `<EventCoverMedia hue mediaUrl mediaType radius={0} label="" style={styles.miniCover}/>`. The inverted `orch1132ClampMathHeroIsolationAdversarial.test.ts` asserts all absent on all 3 routes (green). |
| **SC-4** | trip + experience drop `useState`; event keeps it; tsc/lint clean (no unused-import) | **PASS** | event=`useCallback, useState`; trip=`useCallback, useMemo`; experience=`useCallback`. The 3 checkout `index.tsx` files are tsc-clean (no unused-import from the `useState` drop). eslint: 0 errors on the 3 files (2 warnings — `useMemo` in trip, `LiveEvent` in event — both PRE-EXIST identically on origin/main; P4-1). |
| **SC-5** | `audioControlBottomRight = {right:24, bottom:40}`; right unchanged 24; topLeft/topRight 14 | **PASS** | Source confirmed: `right:24` (untouched), `bottom:40` (only changed line). `minHeight:36` preserved in base `audioControl`. `orch1131SiblingInsetNonRegressionAdversarial.test.ts` asserts right[24]/bottom[40]/topLeft[14]/topRight[14] (green). |
| **SC-6 (cross-consumer)** | Pill stays on-screen at bottom:40 on full-bleed covers, not behind chrome | **PASS** | Computed geometry (tester adversarial test): shortest real `bottomRight` consumer = expandedCard `ImageGallery` (height:300). Pill band = [300−(40+36) .. 300−40] = [224 .. 260] — top edge 224px, safely inside the box. SwipeableCards uses `showAudioControl={false}` (unaffected). PublicEventPage hero + authoring previews (CoverPicker/CreatorStep4Cover/ExperienceCoverStep/TripCreatorStep1Basics/EditPublishedTripScreen) all render ≥200px full-bleed covers with no bottom panel → benign. |
| **SC-7 (tests)** | 6 in-scope jest files PASS at round-3 values, token present | **PASS** | 6 pinned files (5 standalone + the pill tests in eventCoverMedia) = green; full pinned set re-run with the tester adversarial = 6 suites / 45 tests green. Append-only check 7/7 (6 modified + 1 added). |

---

## 3. Findings (P-numbered)

### P3-1 — Adding a tester commit on top of the implementor's test-mod commit broke the append-only gate; resolved in-lane.
- **Evidence:** The append-only gate (`.github/scripts/test-append-only-check.js`) checks the `[TEST-MOD-APPROVED ORCH-####]` token in the **LATEST commit body only**. The implementor's token lived in `d2c54b23f`. When the tester committed the new adversarial test as `daeeda425` (no token), the gate flipped to **1 passed / 6 failed** for the still-present test-file deletions.
- **Impact:** Would FAIL CI at merge time even though the deletions are legitimately approved — a closing-PR blocker.
- **Resolution (in-lane, tester-owned commit only):** amended the tester commit body to re-carry `[TEST-MOD-APPROVED ORCH-1133]` with the same why-cited reason. Gate now **7 passed / 0 failed**. No product code touched.
- **Retest:** `node .github/scripts/test-append-only-check.js` → `Append-only check: 7 passed, 0 failed.`
- **Note for the orchestrator:** at CLOSE, if any further commit lands on this branch, the LATEST commit body must re-carry the token (gate is HEAD-only, not range-wide).

### P4-1 (NOTE, pre-existing) — Two eslint `no-unused-vars` warnings unrelated to ORCH-1133.
`useMemo` (trip `index.tsx`) and `LiveEvent` (event `index.tsx`) are import-only and UNUSED on origin/main too (verified via `git show origin/main:…`). NOT introduced by this ORCH; out of allowlist scope. 0 errors.

### P4-2 (NOTE, pre-existing) — Wide jest/strict-grep baseline noise, identical to origin/main.
The full business jest suite fails 79 suites / 148 tests on the branch vs **81 suites / 151 tests on origin/main** — i.e. the branch has FEWER failures (it FIXED the eventCoverMedia pill test + the 1131/1132/1128 suites). All remaining failures are pre-existing (missing `@testing-library/react-native`, `@mingla/payments-native`; source-introspection drift from unrelated ORCHs). 3 non-PASS strict-grep gates (`orch-0756a`, `orch-0770`, `orch-0776a`) all touch files NOT in the ORCH-1133 diff. The 4 ORCH-0978 cover gates + orch-0766f/0783/0805/0989 cover gates all PASS.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Checked out the implementor's product state (HEAD `d2c54b23f` cover/pill values). Hand-mutated the product code (TRUE line edits) and ran the implementor's happy-path test `orch1131CoverCropSoundInset.test.ts`:

- **Mutation:** removed `height: 64` from `checkout/[eventId]/index.tsx` `miniCover`; reverted `EventCoverMedia.tsx` pill `bottom: 40 → 22`.
- **Result (mutated):** `Tests: 2 failed, 6 passed` — the `miniCover height:64` assertion AND the `bottom === 40` assertion both RED. (The implementor reported 3-failed because they additionally re-added onAspectRatio/videoContentFit; my narrower mutation reproduced the two core failures.)
- **Result (restored):** `Tests: 8 passed, 8 total` — green.
- **Conclusion:** the implementor's happy-path test genuinely exercises the fix and is not comment-fooled. **fails-on-revert verified at `d2c54b23f`.** Product tree restored clean (git status shows no product modifications).

---

## 5. Adversarial test added (tester-owned)

- **Path:** `mingla-business/__tests__/orch1133PillClearanceGeometryAdversarial.tester.test.ts`
- **Commit:** `daeeda425` (on-branch, in `git diff origin/main...HEAD --name-only`).
- **Different angle:** the implementor's tests assert WHICH literals are present (source-introspection). This test parses the real `bottom`/`marginTop`/`minHeight` numbers out of the shared source and PROVES the resulting GEOMETRY — the two physical invariants Seth complained about:
  - **(1) Clearance:** `gap = pill.bottom − |bodyContent.marginTop|` = `40 − 28 = +12` must be `≥ +10` (asserts `=== 12`), with an in-test regression proof that the old `bottom:22` would yield `−6` (overlap).
  - **(2) On-screen safety:** for the shortest `bottomRight` consumer (ImageGallery h=300), the pill's TOP edge `300 − (40+36) = 224` must be `> 0` (never clipped off the top).
- **fails-on-revert verified at `daeeda425`:** mutated `EventCoverMedia.tsx` `bottom: 40 → 22` → `Tests: 2 failed, 4 passed` (the (1) "round-3 contract" + "positive clearance" assertions RED). Restored → 6 passed. Recorded; product tree restored clean.
- **Both tests in the closing diff:** `orch1131CoverCropSoundInset.test.ts` (implementor) + `orch1133PillClearanceGeometryAdversarial.tester.test.ts` (tester) both appear in `git diff origin/main...HEAD --name-only`. ✓

**Inverted-test audit (spec asked to verify):** `orch1132ClampMathHeroIsolationAdversarial.test.ts` was INVERTED in place (not deleted — append-only gate forbids test-file deletion with no token bypass). I read it: it now asserts, on ALL 3 checkout routes, NO `Math.min(Math.max(...))` clamp, NO `coverAspect`/`clampedCoverAspect`, NO `onAspectRatio`/`videoContentFit`/inline `aspectRatio` in the EventCoverMedia call, AND `miniCover.height:64` — i.e. it genuinely guards the full-screen-cover code staying gone, and still guards the public-hero clamp isolation (B) + the EventCoverMedia `videoContentFit="cover"` default (C). It is a STRONGER durable guard than deletion. Confirmed valid.

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | **PASS** | Sound pill FIRES at runtime (video muted:true→false on click). The bottom:40 inset is style-only; the onClick wiring is untouched. `orch_1124_cover_audio_pill_fires.adversarial.test.ts` green. |
| 2 | One owner per truth | N/A | No state ownership change (removed redundant `coverAspect` local state). |
| 3 | No silent failures | N/A | No error paths changed; pure style/JSX. |
| 4 | One query key per entity | N/A | No queries. |
| 5 | Server state stays server-side | N/A | No Zustand/server-state. |
| 6 | Logout clears everything | N/A | No auth/session. |
| 7 | Label `[TRANSITIONAL]` | **PASS** | None introduced. |
| 8 | Subtract before adding | **PASS** | This ORCH IS a subtraction (removed the ORCH-1131/1132 adaptive-cover additions). |
| 9 | No fabricated data | N/A | No data. |
| 10 | Currency-aware | N/A | No prices. |
| 11 | One auth instance | N/A | Anon buyer routes; no useAuth touched. |
| 12 | Validate at the right time | N/A | No validation. |
| 13 | Exclusion consistency | N/A | No filters. |
| 14 | Persisted-state startup | N/A | No persisted state. |

No constitutional violations.

---

## 7. Device / parity matrix

| Surface | Verdict | Evidence |
|---------|---------|----------|
| Buyer/anon Web (authoritative) | **PASS (proven)** | Live prod pill measure (−6→+12, fires) + local web checkout cover measure (h=64, 0 errors). |
| Consumer iOS | **PASS (parity automatic)** | Shared `EventCoverMedia.tsx` pill only; SwipeableCards `showAudioControl={false}` so the deck card is unaffected. No consumer cover code touched. |
| Consumer Android | **PASS (parity automatic)** | Same shared RN pill. |
| Business iOS | **PASS (parity automatic)** | 3 checkout `index.tsx` are shared RN; `miniCover.height:64` renders identically. |
| Business Android | **PASS (parity automatic)** | Same. |
| Admin Web | **N/A (skip)** | No consumer of these files. |
| Business Web preview (authoring) | **PASS (parity automatic)** | Shared pill +18px up on ≥200px full-bleed preview covers; benign (no bottom panel). |

**Physical iPhone HITL:** NOT required — buyer web is the spec-authoritative surface and was live-fired by the tester; the change is a single shared style literal + a style-only cover-band revert with no native-only code path. No native rebuild (pure-JS RN). Stated as a deliberate skip with reason, not "TBD".

---

## 8. Discoveries for Orchestrator

- **DISC-T1 (ID collision):** `git worktree list` shows TWO `ORCH-1133` worktrees — this one (`ORCH-1133-[revert-cover-pill-bottom]`) and `ORCH-1133-[biz-root-render-loop]` (HEAD `68d9aede6`). Two different efforts share the ORCH-1133 number. Orchestrator should de-conflict the IDs at INTAKE/CLOSE (one must be renumbered) before either merges, to avoid registry/World-Map collision.
- **DISC-T2 (append-only gate is HEAD-only):** confirms the implementor's DISC-A and adds a corollary — because the gate reads the token from the LATEST commit body only, ANY commit added on top of a token-bearing test-mod commit (incl. the tester's adversarial test, incl. a CLOSE doc commit on the same branch) must re-carry the token or the gate flips red. Already handled here (P3-1); flag for future ORCHs that the tester/closer commit AFTER the token commit.
- **DISC-T3 (env, confirms implementor DISC-B):** the worktree needed `expo-image-manipulator` to bundle the business web; it was already present (implementor's `--no-save` install persisted). `package.json`/`lock` unmodified. A clean spawn likely needs `npm install` to run the business web locally.
- The open COMMS-ledger rows (0027/0028/0029 trip migrations, 0024/0025 prior cover ORCHs, etc.) are all WARN and orthogonal to this RN style revert — read, no BLOCK addressed to ORCH-1133/tester/ALL.

---

## 9. Gate results summary

- **Pinned jest (6 files):** 6 suites / 45 tests GREEN (incl. tester adversarial). eventCoverMedia 2 pill tests GREEN; its 5 DISC-2 cover-picker-copy failures fail IDENTICALLY on origin/main (verified by running origin's file against origin's source: same 5 + the pill test which the branch FIXED) → out of scope per spec §2/§7.
- **Append-only gate:** 7 passed / 0 failed (token in HEAD `daeeda425`).
- **fails-on-revert:** implementor `orch1131CoverCropSoundInset.test.ts` verified at `d2c54b23f` (2 failed→8 passed); tester `orch1133PillClearanceGeometryAdversarial.tester.test.ts` verified at `daeeda425` (2 failed→6 passed).
- **Non-regression:** full business jest branch = 79 failed suites vs origin/main = 81 failed suites (branch fixed 2, added 0). 4 ORCH-0978 + cover strict-grep gates PASS.
- **tsc:** the 3 checkout `index.tsx` files clean; EventCoverMedia.tsx pre-existing cross-package resolution noise only (single-literal change cannot introduce type errors).

---

## 10. Routing

**PASS → CLOSE (mingla-orchestrator).** No rework. At CLOSE: keep the `[TEST-MOD-APPROVED ORCH-1133]` token in the LATEST commit body of the closing branch (DISC-T2), and de-conflict the ORCH-1133 ID collision (DISC-T1).
