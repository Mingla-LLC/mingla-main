# TEST / QA — ORCH-1131 — Get-tickets cover crop + public-event Sound-pill edge clearance

- **ORCH-ID:** ORCH-1131
- **Class:** S3 · ux + design-debt (value-only visual polish)
- **Working tree:** `~/Desktop/mingla-orchs/ORCH-1131-[cover-crop-sound-inset]/` on branch `ORCH-1131-cover-crop-sound-inset`
- **Under test:** commit `116603b66` (fix) + `fde467565` (impl report). Base `origin/main`.
- **Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1131_COVER_CROP_SOUND_INSET.md` (SC-1..SC-6)
- **Mode:** SPEC-COMPLIANCE + TARGETED (web buyer surface + shared package)
- **Comms ledger:** read on entry. No `BLOCK`/`OPEN` row targets `mingla-tester`, `ORCH-1131`, or `ALL` requiring action. COMMS-0029 (WARN → ORCH-1119, trip `biz_update_live_trip` migration clobber) is N/A: this ORCH touches zero migrations / edge fns / DB. No new comms entry written (no cross-ORCH discovery).

---

## 1. VERDICT

**PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 2

Both fixes are exactly the spec'd one-line value changes, present in the closing diff, with no collateral regression to the untouched sibling pill insets or the aspect-adaptive public hero. Geometry proven by the implementor's render harness + reviewed screenshots; the Sound pill's runtime FIRING (mute/unmute toggle + `onMutedChange` callback) independently proven via a tester live-fire that drives real clicks. Implementor fails-on-revert independently re-run; a tester adversarial test on a different angle (sibling-inset / hero-height non-regression) added, passing, and proven to fail on the regression it guards. Strict-grep 0978 gate PASS. → routes to CLOSE.

Regression gate: **satisfied** — implementor happy-path test (fails-on-revert re-run by tester) AND tester adversarial test (different angle, on-branch, in working-tree diff).

---

## 2. SC-by-SC matrix

| SC | Description | Verdict | Evidence |
|----|-------------|---------|----------|
| **SC-1-Web** | FIX 1 event checkout: 120pt band, portrait cover recognizable, rounded corners, no letterbox | **PASS** | `miniCover.height=120` committed (`checkout/[eventId]/index.tsx:350`); screenshot `04-fix1-after-committed.png` shows "DAYS / of summer" recognizable (vs prior single-strip sliver `02`), corners rounded, NO black letterbox bars on the `#0c0e12` card. `contentFit:"cover"` kept (no `contain`). |
| **SC-2-Web** | FIX 1 landscape regression: clean cover fill, no distortion | **PASS** | Only `height` raised; fill mode `videoContentFit:"cover"` untouched (EventCoverMedia line 382). A 16:9 cover crop-fills the 120pt band identically to before — no aspect/distortion logic touched. Source-confirmed; geometry deterministic. |
| **SC-3** | FIX 1 OQ-1: trip + experience checkout 120pt band | **PASS** | `miniCover.height=120` in `checkout-trip/[tripEventId]/index.tsx:432` + `checkout-experience/[experienceEventId]/index.tsx:333` (git show `116603b66`). Byte-identical blocks; all three asserted by both jest suites. OQ-1 all-three Seth-confirmed 2026-06-12. |
| **SC-4-Web** | FIX 2 public hero: pill right edge aligns to chrome column (both 16px from hero edge); clearance to screen edge | **PASS** | `audioControlBottomRight.right=16` (`EventCoverMedia.tsx:614`); `PublicEventPage.floatingChrome.right = spacing.md = 16` (line 1350). Tester live-fire measured `measuredPillRightGap=16 == chromeRight=16, aligned:true`. Screenshot `06`/`08` show pill flush on chrome column with screen-edge clearance. |
| **SC-5-iOS / SC-5-Android** | FIX 2 parity: consumer native + expandedCard + business authoring previews at `right:16`, no clipping | **PASS (automatic)** | Single shared `bottomRight` style in `@mingla/event-rendering`; business app consumes via thin re-export (`mingla-business/src/components/ui/EventCoverMedia.tsx` → `export {…} from "@mingla/event-rendering"`). All `bottomRight` consumers inherit `right:16` simultaneously. Pill is right-anchored (no `left`) → a long "Sound"/"Mute" label grows LEFTWARD and can never clip the right edge on the narrowest phone (structural). Native +2px cosmetic; no logic path. Device spot-check deferred — see P4-1. |
| **SC-6** | No global regression: list/grid/deck still crop-to-fill; hero still aspect-adaptive | **PASS** | `videoContentFit="cover"` default untouched (line 382). `PublicEventPage.heroBox` carries NO fixed pixel `height` (uses `aspectRatio: clampedHeroAspect` inline, line 581; style block lines 1376–1382) — tester adversarial test asserts `heroBox` has zero numeric `height`. Hero did NOT inherit the checkout 120pt band. |

---

## 3. Findings

No P0/P1/P2/P3. Two P4 notes.

### P4-1 (NOTE) — Native FIX-2 parity device spot-check deferred (accepted)
- **Evidence:** FIX 2 is a shared `@mingla/event-rendering` style; the +2px native pill nudge reaches consumer iOS/Android + business authoring previews only via OTA (impl report §13). Not separately device-captured.
- **Impact:** Cosmetic +2px right inset on native pills. No logic/firing path changes (the `right` value does not touch the `Pressable.onPress`). The same shared style backs web, where firing + alignment are runtime-proven.
- **Why acceptable:** The change is a single shared value with no per-surface branch; web live-fire exercises the identical Pressable + style. Spec §7 lists native parity as an optional "may device-spot-check," not a gate. Not a PASS-blocker.
- **Retest:** After OTA from merged main, eyeball the Sound pill on a native consumer event video cover; confirm +2px clearance, no clip.

### P4-2 (NOTE / praise) — Clean, contained, spec-faithful change
- The diff is exactly the four allowlisted value changes + comments; zero DO-NOT-TOUCH file touched; `bottom:22` (ORCH-1128) and `topLeft`/`topRight` insets preserved verbatim; raw-literal `16` matches the file's no-token convention. The implementor's source-introspection test correctly stays green on the un-reverted `bottom:22` while failing the reverted values — a precise fails-on-revert. Replicable pattern.

---

## 4. Step 0.5 — Independent re-run of the implementor's fails-on-revert proof

Checked out `116603b66` (the worktree HEAD branch). Ran the implementor's `orch1131CoverCropSoundInset.test.ts`:

- **Committed state:** `Test Suites: 1 passed` · `Tests: 5 passed, 5 total`.
- **True line-deletion revert** (tester-performed via `sed` on the live files, NOT comment-out): set all three `miniCover.height` `120→64` and `audioControlBottomRight.right` `16→14`. Re-ran →
  ```
  Tests: 4 failed, 1 passed, 5 total
  ✕ checkout/[eventId] miniCover.height === 120   (Received: 64)
  ✕ checkout-trip miniCover.height === 120        (Received: 64)
  ✕ checkout-experience miniCover.height === 120  (Received: 64)
  ✕ right === 16                                  (Received: 14)
  ✓ bottom === 22  (correctly still passes — bottom:22 was NOT reverted)
  ```
- **Restored** via `git checkout -- <4 files>` + removed `.bak`; re-ran → `5 passed, 5 total`. Working tree clean (`git status` shows no product-file change).

The implementor's claim is **independently confirmed**: 4 fail on revert, the `bottom:22` guard correctly stays green proving the test exercises exactly the changed values.

---

## 5. Adversarial test added (tester-authored, different angle)

- **Path:** `mingla-business/__tests__/orch1131SiblingInsetNonRegressionAdversarial.test.ts` (4 assertions, append-only NEW file).
- **Different angle:** the implementor's test asserts the POSITIVE changed values. This test attacks the **collateral / sibling-invariant** surface the happy-path test does NOT guard (spec §7 adversarial angles):
  - `audioControlTopLeft` STILL `left:14 / top:14` (exactly one each).
  - `audioControlTopRight` STILL `right:14 / top:14`.
  - `audioControlBottomRight` has EXACTLY ONE `right:` declaration `=== 16` (+ `bottom===22`) — guards a duplicate/shadow override.
  - `PublicEventPage.heroBox` declares ZERO numeric `height` — guards against the hero inheriting a fixed band (SC-6 / §2 non-goals).
- **Committed-state run:** `Test Suites: 1 passed` · `Tests: 4 passed, 4 total`.
- **fails-on-revert verified at `116603b66`** (tester hand-mutation, then restored): set `topLeft → left:16/top:16`, `topRight → right:16`, and inserted `height: 220` into `heroBox`. Re-ran →
  ```
  Tests: 3 failed, 1 passed, 4 total
  ✕ audioControlTopLeft stays left:14 / top:14
  ✕ audioControlTopRight stays right:14 / top:14
  ✓ audioControlBottomRight has exactly ONE right: declaration  (correctly unaffected)
  ✕ PublicEventPage heroBox declares NO fixed pixel height
  ```
  Restored both files (`cp` from `/tmp` backup); `git status -- packages/` clean; both ORCH-1131 suites green (9/9).
- **In closing diff:** both `orch1131CoverCropSoundInset.test.ts` (implementor) and `orch1131SiblingInsetNonRegressionAdversarial.test.ts` (tester) are present in the worktree on-branch and staged for the closing PR. (Tester does not commit product/test code; orchestrator/implementor includes both in the PR per worktree workflow.)

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | **PASS** | Sound pill `Pressable.onPress` toggles `setIsMuted` + `onMutedChange` (EventCoverMedia.tsx:539–567); tester live-fire drove 2 real clicks → label flipped Sound→Mute→Sound, callback logged `[false,true]`. The `right` value does not touch the handler. |
| 2 | One owner per truth | N/A | No state ownership change; pure style values. |
| 3 | No silent failures | N/A | No error paths touched. |
| 4 | One query key per entity | N/A | No data fetching. |
| 5 | Server state server-side | N/A | No Zustand/server state. |
| 6 | Logout clears everything | N/A | No auth/session. |
| 7 | Label `[TRANSITIONAL]` | N/A | No transitional code. |
| 8 | Subtract before adding | **PASS** | No new component/token; raw literal `16`, no new import (package isolation kept). |
| 9 | No fabricated data | N/A | No data. |
| 10 | Currency-aware | N/A | No money/price logic. |
| 11 | One auth instance | **PASS** | Buyer checkout + public page remain anon-tolerant; no `useAuth` introduced (style-only). |
| 12 | Validate at right time | N/A | No validation. |
| 13 | Exclusion consistency | N/A | No filters. |
| 14 | Persisted-state startup | N/A | No persisted state. |

No violation. Zero automatic-P0 triggers.

---

## 7. Device / parity matrix

| Surface | Ships here | Verdict | Evidence |
|---------|-----------|---------|----------|
| Buyer/anon Web (checkout + `/e/...`) | **FIX 1 + FIX 2** | **PASS (proven)** | Render-geometry screenshots `04`/`06` + tester runtime live-fire `tester-pill-fire.cjs` (pill FIRES + aligned, exit 0); screenshots `07`/`08`. Render primitives identical to the buyer web build (overflow:hidden clip + objectFit:cover + absolute pill). |
| Consumer iOS (`app-mobile/`) | FIX 2 only | **PASS (automatic, proven-by-shared-style)** | Shared `bottomRight` style; +2px right inset. Device spot-check deferred → P4-1 (accepted). |
| Consumer Android | FIX 2 only | **PASS (automatic)** | Same shared style. P4-1. |
| Business iOS (`mingla-business/`) | FIX 2 incidental | **PASS (automatic)** | Authoring-preview pills inherit `right:16`. P4-1. |
| Business Android | FIX 2 incidental | **PASS (automatic)** | Same. P4-1. |
| Admin Web (adjacent) | not shipped | **N/A** | Admin renders neither the pill nor the checkout mini-card. |
| Business Web preview (adjacent) | FIX 2 incidental | **PASS (automatic)** | Same shared shift. |

Physical iPhone HITL: not required for a value-only shared-style polish where web runtime-fire + alignment are proven and native is the same single value with no branch. No operator-unblock ask outstanding.

Live deploy state: no edge function / migration / DB touched → nothing to verify against prod. OTA to ship the native +2px pill nudge is an operator decision at CLOSE (impl report §13); not a test gate.

---

## 8. Gate results (independently re-run)

| Gate | Result |
|------|--------|
| `node .github/scripts/strict-grep/orch-0978-video-autoplay-muted-contract.mjs` | **PASS** (exit 0) — muted/autoplay contract + package export intact |
| Implementor `orch1131CoverCropSoundInset.test.ts` @ `116603b66` | **5/5 PASS**; **4 fail on tester line-deletion revert** (re-run §4) |
| Tester `orch1131SiblingInsetNonRegressionAdversarial.test.ts` | **4/4 PASS**; **3 fail on tester mutation** (§5) |
| Tester runtime pill-fire (`tester-pill-fire.cjs`) | **PASS** (exit 0) — `aligned:true`, `toggledOnTap1`, `toggledBackOnTap2`, `callbackFiredBothTaps` all true |
| Both ORCH-1131 suites together | `Test Suites: 2 passed` · `Tests: 9 passed, 9 total` |
| Package isolation (I-MOR-0827) | **PASS** — raw literal `16`, no new import in EventCoverMedia.tsx |

---

## 9. Discoveries for Orchestrator

- **Native FIX-2 OTA (informational):** shipping the +2px native pill nudge to consumer/business apps needs an `eas update` (pure-JS, per `project_ota_deferred_until_new_build`) from MERGED main — operator decision at CLOSE. Not a defect.
- **No unrelated bugs** found in the touched files or their dependents. The checkout ScrollView (`paddingBottom: insets.bottom + 140`) + absolute-positioned `bottomBar` architecture structurally precludes the "taller band pushes summary into the Continue bar / clips the 2-line title" failure mode (the band adds scroll height, it cannot collide with the floating bar). The right-anchored pill structurally precludes a long label clipping the screen edge. Both adversarial worries are eliminated by layout architecture, not just by these values.

---

## 10. Routing

**PASS → mingla-orchestrator CLOSE.** Ensure both test files + the tester evidence (`tester-pill-fire.cjs`, `07`/`08` PNGs) land in the closing PR diff. OTA decision per §9.
