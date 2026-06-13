# TEST / QA — ORCH-1132 — Checkout cover full-frame (no crop) + public Sound-pill edge clearance (round 2)

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1132-[cover-fullframe-sound-inset]/`
**Branch:** `ORCH-1132-cover-fullframe-sound-inset`
**Tester:** mingla-tester (Claude)
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1132_COVER_FULLFRAME_SOUND_INSET.md` (SC-1..SC-7)
**Implementation:** commit `b4c77aa81` (code + tests), `f606687a6` (report)
**Tester adversarial test commit:** `2927098a4`
**Date:** 2026-06-12 → 2026-06-13

---

## 1. Verdict

### PASS — 0 P0 · 0 P1 · 0 P2 · 1 P3 · 1 P4

ORCH-1131's two misses are corrected and verified. The three checkout mini-cards now render the
WHOLE portrait cover frame uncropped (real-media live-fire confirms head+body+feet visible, not a
mid-strip), and the public-event Sound pill is visibly inset (`right:24`, +8px) while STILL FIRING
at runtime (mute toggle proven). Cross-consumer non-regression holds: the public hero and consumer
deck card are structurally untouched and the cover-mode change is fully scoped to checkout. The one
P3 is a PRE-EXISTING stale test inherited from ORCH-1131 (not a regression from this ORCH) — routed
to the orchestrator as a Discovery, not a blocker.

**Confidence ladder:**
- **Checkout cover full-frame (SC-1/2/3) — PROVEN (web, real media):** the actual Raleigh Wine and
  Dine Crawl cover video rendered through real-browser `objectFit:contain` + adaptive box shows the
  full frame for portrait (0.5625→0.6 box) and square (1.0 box). The CSS render path is the real one;
  the call-site wiring is line-verified.
- **Sound pill inset + fires (SC-5) — PROVEN (runtime):** `right:24` visual inset proven via the
  faithful built-value harness; pill firing proven by the ORCH-1124 runtime onPress test (3/3 PASS)
  on this branch — the tap toggles `isMuted` + calls `onMutedChange`.
- **Native expo-video `contain` path — SUSPECTED (source-verified):** `contentFit={contentFit}` is
  passed to `VideoView` (EventCoverMedia.tsx:306) — the SAME prop the public hero already uses on
  native by RN contract. No full iOS dev-build rebuild performed (disproportionate for a style-only
  prop already in native production use). Marked **suspected pending Seth's dev-OTA confirmation** per
  the dispatch's native note. Seth verifies on his dev build after the OTA.

---

## 2. SC-by-SC matrix

| SC | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| **SC-1-event** | Event checkout: portrait video cover shows whole frame, head not cut | **PASS** | `app/checkout/[eventId]/index.tsx`: `coverAspect` state + `clamp(0.6,1.91)` + `videoContentFit="contain"` + inline `aspectRatio` (lines 87-88, 254-256); real-media live-fire `checkout_cover_RECOMMENDED_contain.png` (portrait full-frame) + `checkout_cover_before_after_BUILT.png`. My adversarial test executes the clamp: 0.5625→0.6 box (< hero's 0.75). |
| **SC-1-trip** | Trip checkout: same | **PASS** | `app/checkout-trip/[tripEventId]/index.tsx` — byte-identical mechanism (grep-confirmed same clamp + props); adversarial test runs all three routes. |
| **SC-1-experience** | Experience checkout: same | **PASS** | `app/checkout-experience/[experienceEventId]/index.tsx` — byte-identical mechanism; adversarial test runs all three routes. |
| **SC-2** | Landscape (≈1.78) full frame; box bounded by 1.91 (not a sliver) | **PASS** | Adversarial test executes `clamp(1.78)=1.78` (in-range, full frame) and `clamp(3.0)=1.91` (panorama bounded, > 16/9). `contain` guarantees no center-crop. Letterbox bars invisible on `#0c0e12`. |
| **SC-3** | Square (1.0) box ≈square, full frame | **PASS** | Adversarial test executes `clamp(1.0)=1.0` (exact-fit, unclamped). Real-media `checkout_cover_RECOMMENDED_contain.png` square panel shows full frame letterboxed on black. |
| **SC-4** | `miniCover` declares no fixed `height:` in all three | **PASS** | All three `miniCover` blocks contain only `borderRadius`+`marginBottom` (no `height:`). Implementor happy-path test asserts `extractNumericStyleValue(body,'height')===null` across all three; independently re-run + fails-on-revert verified. |
| **SC-5** | Public Sound pill `right:24`, `bottom:22` unchanged; STILL FIRES | **PASS** | `EventCoverMedia.tsx:616` `right:24`, line 619 `bottom:22`; exactly one `right:` declaration. Visual inset proven `public_hero_soundpill_16_vs_24_BUILT.png`. **Runtime-fires proven:** `orch_1124_cover_audio_pill_fires.adversarial.test.ts` 3/3 PASS on this branch (onPress toggles isMuted + calls onMutedChange; positive zIndex; bottomRight wired). Pill handler NOT in this commit's diff — byte-identical to the runtime-proven ORCH-1124 baseline. |
| **SC-6** | Public hero `heroBox` + deck card untouched | **PASS** | `PublicEventPage.tsx` + `SwipeableCards.tsx` NOT in the commit diff. Hero still `clampedHeroAspect=clamp(0.75,16/9)` (line 552), no fixed pixel height (heroBox style has no `height`), `cover` fill (no `videoContentFit` on hero call → default cover). Deck: explicit `videoContentFit="cover"` + `showAudioControl={false}`. My adversarial isolation test proves the hero clamp is a structurally DIFFERENT range (0.5625→0.75 hero vs 0.6 checkout; upper 16/9 hero vs 1.91 checkout). |
| **SC-7** | `EventCoverMedia` defaults `cover`/undefined; no other consumer changes | **PASS** | `videoContentFit="cover"` default (line 382), `onAspectRatio?` optional no-default (undefined), image `resizeMode="cover"` (line 514). My adversarial test asserts no `videoContentFit="contain"` default exists + `objectFit:contentFit` passthrough + image `resizeMode="cover"`. Only the shared pill style + 3 checkout call-sites changed. |

---

## 3. Findings

### P3-1 (DISCOVERY → orchestrator; NOT an ORCH-1132 regression) — stale ORCH-1124 pill test pins `right: 14`
- **Evidence:** `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts:369`
  `expect(bottomRightStyle).toContain("right: 14")`. The live style is `right: 24`. Test FAILS.
- **Pre-existing proof:** on `origin/main` the SAME test still asserts `"right: 14"` while the
  `origin/main` code is already `right: 16` (ORCH-1131 moved the pill 14→16 but never updated this
  ORCH-1124 sibling test) → the assertion **already fails on main**, independent of ORCH-1132.
  ORCH-1132 makes it staler (24 vs 14) but did NOT introduce the red.
- **Why not a blocker for ORCH-1132:** `eventCoverMedia.test.ts` is OUTSIDE the spec §9 allowlist;
  the implementor correctly did not touch it. The pill IS at the intended 24 (the test pins an
  obsolete number, the product is correct). Fixing it here would be scope-widening.
- **Impact:** a red test in the touched component's test file; will keep failing CI until updated to
  `right: 24` / `bottom: 22`.
- **Required fix (future ORCH / orchestrator call):** update `eventCoverMedia.test.ts:369` from
  `"right: 14"` → `"right: 24"`. Trivial. Should be folded into the ORCH-1132 close OR a fast-follow
  if the orchestrator wants CI green on this file.
- **Retest:** `npx jest eventCoverMedia.test -t "defaults the audio pill to bottomRight"` → green.

### P4-1 (PRAISE) — clean reuse of the proven hero mechanism + faithful real-media evidence
- The implementor reused the public hero's exact `onAspectRatio`+adaptive-box mechanism rather than
  inventing a new render path, paired it with `contain` (vs the hero's `cover`) for the stricter
  no-crop requirement, and produced live-fire evidence using the ACTUAL cover video frame
  (`checkout_cover_RECOMMENDED_contain.png` / `checkout_cover_A120_B075_C08_portrait.png`) — not just
  the synthetic HEAD/BODY/FEET harness. Byte-identical across all three checkout files. Defaults
  untouched, scope held to the allowlist.

### Other 10 jest failures in `eventCoverMediaService.test.ts` / `eventCoverMedia.test.ts` — PRE-EXISTING, UNRELATED
- e.g. "Cover videos must be 15 seconds or shorter" vs received "29 seconds", Uint8Array/Blob upload,
  picker upload-limits. None touch cover-sizing or pill position; all unrelated to ORCH-1132's
  surfaces and present independent of this ORCH (the touched files are not in the diff). Noted for the
  orchestrator's repo-health awareness; not ORCH-1132 defects.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Checked out implementor commit `b4c77aa81`. Backed up the two product files, then performed TRUE
LINE DELETIONS of the fix (not comment-out):
- `EventCoverMedia.tsx` `audioControlBottomRight.right: 24 → 16`
- `app/checkout/[eventId]/index.tsx`: dropped `onAspectRatio`/`videoContentFit="contain"`/inline
  `aspectRatio` (back to `style={styles.miniCover}`) and re-added `height: 120` to `miniCover`.

Re-ran the two implementor tests — observed EXACTLY the implementor's reported failing assertions:
```
FAIL __tests__/orch1131CoverCropSoundInset.test.ts
  - miniCover.height: expect(...).toBeNull() → Received: 120
  - EventCoverMedia: expect(call).toMatch(/videoContentFit="contain"/) → not found
  - bottomRight.right: expect(...).toBe(24) → Received: 16
FAIL __tests__/orch1131SiblingInsetNonRegressionAdversarial.test.ts
  - bottomRight.right: expect(allNumericValues(...,'right')).toEqual([24]) → Received: [16]
Tests:       4 failed, 8 passed, 12 total
```
Restored both files from backup → `git status` clean → re-ran → **12/12 PASS**. The implementor's
fails-on-revert claim is independently CONFIRMED at `b4c77aa81`.

---

## 5. Adversarial test added (tester-owned, different angle)

- **Path:** `mingla-business/__tests__/orch1132ClampMathHeroIsolationAdversarial.test.ts`
- **Commit:** `2927098a4` (on-branch; appears in `git diff origin/main...HEAD --name-only`).
- **Angle (distinct from the implementor's STATIC source-string matching):** EXECUTES the actual
  checkout clamp expression at runtime against SC-1/2/3 inputs (portrait 0.5625, square 1.0, landscape
  1.78, panorama 3.0) and degenerate inputs (NaN/0/negative), asserting the RESULTING box aspect the
  user sees; and proves SC-6/SC-7 ISOLATION by executing the public-hero clamp and asserting it is a
  structurally different range NOT inherited by checkout, plus the `videoContentFit` default stays
  `"cover"`. 24 tests, all PASS.
- **Regression class it catches that the static test does NOT:** a "tidy" that copies the hero bounds
  (`0.6→0.75`, `1.91→16/9`) into the checkout clamp would keep `videoContentFit="contain"` present
  (so the implementor's string test stays green) yet SILENTLY RE-CROP portrait covers — the exact
  ORCH-1131 miss this ORCH exists to fix.
- **fails-on-revert verified by the tester:** reverted `app/checkout/[eventId]/index.tsx` clamp
  `0.6,1.91 → 0.75,16/9`; re-ran → portrait, landscape, panorama, degenerate-floor, and cross-file
  isolation assertions FAILED (`Expected 0.6 Received 0.75`, `Expected 1.91 Received 1.7777`).
  Restored → **24/24 PASS**. `fails-on-revert verified at 2927098a4`.
- **Append-only:** NEW file; modifies no existing test. Both implementor tests AND this adversarial
  test are in `git diff origin/main...HEAD --name-only`.

**Combined run (all three ORCH-1131/1132 tests):** 36/36 PASS. ORCH-0978 autoplay/muted strict-grep
gate: `OK ORCH-0978 autoplay muted contract gate` (untouched).

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | **PASS** | Sound pill still fires — ORCH-1124 runtime test 3/3 PASS on branch (onPress toggles isMuted + onMutedChange); handler untouched by this commit. |
| 2 | One owner per truth | **PASS** | `coverAspect` owned by each checkout screen's local state; pill `right` single declaration (no shadow override). |
| 3 | No silent failures | **PASS** | Degenerate `onAspectRatio` (0/negative) floors to 0.6 (no sliver collapse); NaN passes through (RN ignores → benign), documented in adversarial test. Media error → EventCover fallback (unchanged). |
| 4 | One query key per entity | **N/A** | No data fetch added. |
| 5 | Server state server-side | **N/A** | No Zustand/server-state change. |
| 6 | Logout clears everything | **N/A** | No auth/persisted state. |
| 7 | Label `[TRANSITIONAL]` | **PASS** | No transitional code; image-cover-stays-cover is intended scope (spec §4.4), correctly NOT marked transitional. |
| 8 | Subtract before adding | **PASS** | Removed fixed `height:120` before adding adaptive aspect; superseded ORCH-1131 values rather than layering. |
| 9 | No fabricated data | **PASS** | No fabricated ratings/prices/times; aspect is derived from real media intrinsic size. |
| 10 | Currency-aware | **N/A** | No money rendering changed. |
| 11 | One auth instance | **N/A** | Buyer/anon checkout routes; no `useAuth` touched. |
| 12 | Validate at right time | **N/A** | No datetime validation. |
| 13 | Exclusion consistency | **N/A** | No filtering. |
| 14 | Persisted-state startup gate | **N/A** | No hydration-gated state. |

No constitutional violation.

---

## 7. Device / parity matrix

| Surface | Verdict | Evidence |
|---------|---------|----------|
| Consumer iOS (`app-mobile/`) | **PASS (pill only, source+runtime)** | Inherits shared pill +8px on expandedCard ImageGallery (`audioControlPosition="bottomRight"` line 134 → modified style); cover-sizing change does NOT reach deck (fixed cover, `showAudioControl={false}`). Pill firing proven by ORCH-1124 runtime test. |
| Consumer Android | **PASS (pill only, by parity)** | Same shared RN style; no Android-specific override on `audioControlBottomRight`. |
| Buyer/anon Web (`mingla-business` checkout + public) | **PASS (PROVEN, real-media web live-fire)** | The authoritative surface. Real cover video through `objectFit:contain` + adaptive box → full frame (portrait/square evidenced). Pill `right:24` visual inset evidenced. |
| Business iOS (`mingla-business/`) | **PASS (cover source+web-proven; native contain SUSPECTED)** | Checkout summary cover full-frame logic identical to web; native `contentFit` prop = same one hero uses on native (source-verified line 306). iOS dev-build render of native `contain` = SUSPECTED pending Seth's dev-OTA. |
| Business Android | **PASS (same as Business iOS; native SUSPECTED)** | Same code path. |
| Admin Web (`mingla-admin/`) | **SKIPPED (does not consume)** | Admin renders no `EventCoverMedia` checkout card. |
| Business Web preview (adjacent) | **PASS (pill, source)** | Authoring previews (CoverPicker / ExperienceCoverStep / TripCreatorStep1Basics / EditPublishedTripScreen / BrandCreationFlow) all use default bottomRight pill → inherit +8px; grep-confirmed no `right` override. |

**Physical iPhone HITL:** not invoked. The authoritative surface for both fixes is buyer web (proven
at runtime). The only native-specific item (expo-video `contentFit:contain`) is a style-only prop
already in native production use by the hero; per the dispatch's native note a full iOS dev-build
rebuild is disproportionate for a style-only change — Seth will confirm on his dev build after the
OTA. Stated as SUSPECTED, not silently skipped.

**Live edge-deploy state:** N/A — no edge function / DB / migration in this ORCH (component/style only).

---

## 8. Discoveries for Orchestrator

1. **P3-1 (above):** `eventCoverMedia.test.ts:369` pins the obsolete pill `right: 14`. Already red on
   `origin/main` (ORCH-1131 left it stale at 14 after moving the pill to 16). ORCH-1132 makes it
   staler (24). Outside the ORCH-1132 allowlist — recommend the orchestrator either fold a one-line
   bump (`"right: 14"`→`"right: 24"`) into the close or register a fast-follow. Trivial.
2. **~10 unrelated pre-existing failures** in `eventCoverMediaService.test.ts` / `eventCoverMedia.test.ts`
   (video duration 15→29s drift, Uint8Array/Blob upload, picker limits). None touch ORCH-1132
   surfaces; flagged for repo-health awareness.
3. **Native `contain` confirmation** is the one item web could not prove. Seth's dev-OTA verification
   closes it; if it ever renders wrong on native it would be a fast follow (low risk — same prop the
   hero uses).

---

## 9. Routing

**PASS → CLOSE (orchestrator).** No P0/P1. The single P3 is a pre-existing out-of-scope stale test
(Discovery, not REWORK). Both fixes proven on the authoritative buyer-web surface; pill fires at
runtime; cross-consumer non-regression holds; native `contain` source-verified + flagged SUSPECTED
for Seth's dev-OTA confirmation per the dispatch.

Comms ledger read on entry: no BLOCK/OPEN row addressed to mingla-tester / ORCH-1132 / ALL. Active
ALL/relevant rows (COMMS-0029 WARN to ORCH-1119 trip-function clobber; COMMS-0030 RESOLVED iOS build;
COMMS-0027 OTA-poison) are not in this ORCH's path (no DB/edge/trip-function/native-build work). No
new cross-ORCH discovery requiring a COMMS entry.
