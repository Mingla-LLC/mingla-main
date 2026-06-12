# TEST — ORCH-1124 [cover-video Sound/Mute pill: top-right → bottom-right]

**Tester:** mingla-tester · **Date:** 2026-06-12
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1124-[cover-mute-pill]`
**Branch:** `ORCH-1124-cover-mute-pill` · **HEAD under test:** `c869a58f5` (fix) → tester commit `87074317a` (adversarial test)
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1124_COVER_MUTE_PILL.md`

---

## 1. Verdict

### **PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 1

The one-line fix (drop `audioControlPosition="topRight"` at `PublicEventPage.tsx:592` so the pill
inherits `EventCoverMedia`'s `bottomRight` default) is correct and runtime-proven. On buyer-web the
Sound/Mute pill now renders at the BOTTOM-RIGHT of the video cover, FIRES bidirectionally on tap
(toggles `<video>.muted` and the aria-label), no longer collides with the top-right close+share
chrome, and does not collide with the ORCH-1117 floating Buy bar on a short page. The consumer app's
already-correct `bottomRight` control is structurally untouched. Regression gate satisfied (implementor
happy-path + tester adversarial, both in the closing diff, both fails-on-revert verified).

Regression-gate: implementor `fails-on-revert @ c869a58f5` (verified by me) · tester adversarial
`mingla-business/src/components/ui/__tests__/orch_1124_cover_audio_pill_fires.adversarial.test.ts`
fails-on-revert @ tester-broke-wiring.

---

## 2. SC-by-SC matrix

| SC | Criterion | Surface | Result | Evidence |
|----|-----------|---------|--------|----------|
| T-DEADTAP-pos | Pill renders BOTTOM-RIGHT of the video cover | Buyer web (Chromium) | **PASS** (proven) | Pill rect `x:330 y:192 w:86 h:36` → `right:416 bottom:228` inside cover `w:430 h:242` ⇒ right≈14 / bottom≈14. |
| T-DEADTAP-fire | Pill FIRES on tap (toggles audio), not inert | Buyer web (Chromium) | **PASS** (proven) | Click dispatched on pill node: aria `"Turn on cover video audio"→"Mute cover video audio"→"Turn on…"`; `<video>.muted` `true→false→true`. Bidirectional toggle. |
| T-DEADTAP-chrome | Top-right close (X) + share still work, no overlap with pill | Buyer web (Chromium) | **PASS** (proven) | Close `x:16 y:16` (top-left), Share `x:374 y:16` (top-right) both bottom-edge y=56; pill top y=192 ⇒ 136px clear gap. Chrome buttons present + hit-testable in their own zone. |
| T-COLLISION | Bottom-right pill does NOT collide with ORCH-1117 floating Buy bar on a short page | Buyer web (Chromium, 430×740) | **PASS** (proven) | Pill bottom y=228; floating Buy bar ("Get free ticket") top y=659 ⇒ 431px gap. Different vertical zones. |
| T-NOREGRESS | Consumer app's `bottomRight` audio control unchanged | Consumer app (source-immutable) | **PASS** | `app-mobile/.../ImageGallery.tsx:134 audioControlPosition="bottomRight"` is NOT in `git diff origin/main...HEAD` — the fix cannot touch it; it is the SAME default the shared page now inherits. |
| T-REGTEST | Implementor regression test passes + fails-on-revert | Jest | **PASS** | Branch 15/20 pass (5 pre-existing out-of-scope fails); main 12/18 (6 fails) ⇒ implementor fixed 1, introduced 0. Fails-on-revert reproduced (§4). |
| T-ADVERSARIAL | Tester adversarial test (different angle, on-branch, in-diff, fails-on-revert) | Jest | **PASS** | New file, 3/3 pass; Angle-1 fails when firing wiring removed (§5). In closing diff. |

---

## 3. Findings

**P4 (NOTE) — clean, minimal, correct fix.** The fix is the right shape: it does not re-style or
re-position by hand — it DELETES the override so all surfaces inherit the one shared `bottomRight`
default the consumer app already used. One owner for the position; the business-native adapter
(`mingla-business/src/components/event/PublicEventPage.tsx` → `@mingla/event-rendering`) picks it up
for free. Implementor also reconciled 1 genuinely-stale test assertion (the removed
`publicPageSource` block that targeted strings no longer present), reducing the pre-existing failure
count 6→5 with 0 new failures.

No P0/P1/P2/P3 findings.

---

## 4. Step 0.5 — Independent re-run of the implementor's fails-on-revert proof

- Checked out HEAD `c869a58f5`. Ran `npx jest …/eventCoverMedia.test.ts` → **15 passed / 5 failed / 20 total** (the 2 ORCH-1124 tests green).
- Re-applied the reverted state by re-inserting `audioControlPosition="topRight"` into `packages/event-rendering/PublicEventPage.tsx` (line 592).
- Re-ran the ORCH-1124 happy-path test: **`public event page does not pin the cover audio pill to a top position` FAILED** (`expect(page).not.toContain('audioControlPosition="topRight"')`), companion bottomRight-default test still passed.
- Restored the fix → topRight count back to 0, test green.
- Cross-check: ran main's version of the test file → **12 passed / 6 failed / 18 total**, confirming the implementor fixed exactly 1 pre-existing failure and added 2 passing tests with 0 new failures. **Pre-existing-failure count claim (main 6 → branch 5) VERIFIED.**

The 5 remaining failures are all unrelated to the audio pill (upload limits / iOS image output / GIF
picking / surface-intent gating / media-render-failure surfacing) — OUT OF SCOPE per dispatch, not
touched.

## 5. Adversarial test added

- **Path:** `mingla-business/src/components/ui/__tests__/orch_1124_cover_audio_pill_fires.adversarial.test.ts`
- **Commit:** `87074317a` (on `ORCH-1124-cover-mute-pill`, present in `git diff origin/main...HEAD --name-only`).
- **Different angle:** the implementor asserts POSITION only (`not topRight/topLeft`; default `bottomRight` at `right:14/bottom:14`). My test attacks **FIRING + STACKING** — the class of regression where a future change keeps the pill bottom-right but breaks the tap (dead tap). Three angles: (1) `onPress` toggles `isMuted` AND calls `onMutedChange` (the tap fires); (2) `audioControl` carries a positive `zIndex` so the bottom-right pill stacks above the cover and stays tappable; (3) the `bottomRight` default is wired to the `audioControlBottomRight` style branch in the Pressable's style chain.
- **Fails-on-revert verified:** removed `onMutedChange?.(next);` from `EventCoverMedia.tsx` → Angle-1 test `audio pill onPress toggles isMuted and calls onMutedChange (the tap fires)` **FAILED** (other two correctly still passed, as they guard different invariants); restored → 3/3 green. (Repo Jest runs in a Node env without react-test-renderer, so this is a source-wiring lock backstopping the Chromium runtime firing proof — matching the repo's existing harness note in `PublicBrandPage.closeButton.test.tsx`.)

---

## 6. Constitution 14-rule matrix

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | **PASS** | The whole point: the pill was an unreachable dead tap under top-right chrome; now bottom-right and runtime-proven to FIRE (aria + `<video>.muted` toggle). |
| 2 | One owner per truth | **PASS** | Position now owned solely by `EventCoverMedia`'s default; override deleted. |
| 3 | No silent failures | N/A | No error paths touched. |
| 4 | One query key per entity | N/A | No data layer. |
| 5 | Server state server-side | N/A | UI position only. |
| 6 | Logout clears all | N/A | Anon/public surface. |
| 7 | `[TRANSITIONAL]` labels | N/A | Permanent change. |
| 8 | Subtract before adding | **PASS** | Fix is a deletion (removed override), not an addition. |
| 9 | No fabricated data | N/A | No data. |
| 10 | Currency-aware | N/A | No money. |
| 11 | One auth instance | **PASS** | Public route, no `useAuth` introduced. |
| 12 | Validate at right time | N/A | No validation. |
| 13 | Exclusion consistency | N/A | No filtering. |
| 14 | Persisted-state startup | N/A | No persistence. |

No violations.

---

## 7. Device / parity matrix

| Surface | Result | Evidence |
|---------|--------|----------|
| Buyer / anonymous Web (Chromium, RN-web export) | **PASS (proven)** | Drove `http://localhost:8091/e/leggothis/a-life-in-vegas` (live video-cover event, prod Supabase). Geometry + bidirectional firing + chrome-no-overlap + short-page no-collision all captured. |
| Business app — iOS sim | **PASS (probable, by shared component)** | The business native app renders the IDENTICAL shared `@mingla/event-rendering` `PublicEventPage` + `EventCoverMedia` via its adapter (`mingla-business/src/components/event/PublicEventPage.tsx`) — same code path, same inherited `bottomRight` default proven on web. A fresh native dev-build run from this worktree was deferred: this worktree's directory name contains a bracket (`[cover-mute-pill]`) which trips Metro's module resolver (surfaced a benign `@expo-google-fonts/inter` redbox via a malformed `./mingla-main/...` path) — an environment artifact of the bracketed worktree path, NOT the fix. Not blocking: the rendered audio-pill code is byte-identical to the web-proven path. |
| Consumer app (iOS/Android) | **PASS (no-regress, source-immutable)** | Already `bottomRight` via `ImageGallery.tsx:134`; file NOT in the diff. |
| Admin web | N/A | Does not render public event covers. |

**Physical iPhone HITL:** not requested by this dispatch; web Chromium runtime proof + shared-component
identity to native were sufficient for a `proven` PASS on the shipping surface (buyer web).

**Note on screenshots:** evidence PNGs in `Mingla_Artifacts/evidence/ORCH-1124/` include the dev-server
redbox overlay (the bracketed-path Metro artifact above) over part of the frame. The AUTHORITATIVE
evidence is the live DOM geometry + the firing state-transition captured programmatically (logged in
this report), which the overlay does not affect — the overlay only intercepts synthetic mouse
hit-testing, which is why the firing proof was captured by dispatching the click on the pill node
directly. The pill, cover, close, share, and floating-bar bounds were all read from the live DOM.

---

## 8. Discoveries for Orchestrator

- **D1 (env, P3, not ORCH-1124):** Running an Expo web/native dev server from a worktree whose path
  contains square brackets (`ORCH-1124-[cover-mute-pill]`) trips Metro's module resolver, producing a
  spurious `Unable to resolve module ./mingla-main/mingla-business/node_modules/@expo-google-fonts/inter`
  redbox (malformed relative path) even though the dependency is installed. Survives `--clear`. This is
  a recurring hazard for ANY tester/implementor driving a dev server from a bracketed per-ORCH worktree.
  Mitigation: drive via the production web export, or symlink/rename to a bracket-free path for the dev
  run. Worth a memory entry alongside the worktree-strategy notes. Does not affect shipped behaviour
  (the redbox is dev-only; the underlying page rendered correctly).

---

## 9. Routing

**PASS → CLOSE** (orchestrator). Do NOT merge/OTA from here (per dispatch). The fix ships to buyer/anon
web (`/e/`) and the business app (shared component) on merge; consumer app unaffected.
