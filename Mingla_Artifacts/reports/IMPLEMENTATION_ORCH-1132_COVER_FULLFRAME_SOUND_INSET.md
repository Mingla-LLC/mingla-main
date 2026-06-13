# IMPLEMENTATION — ORCH-1132 — Checkout cover full-frame (no crop) + public Sound-pill edge clearance (round 2)

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1132-[cover-fullframe-sound-inset]/`
**Branch:** `ORCH-1132-cover-fullframe-sound-inset` (rebased on origin/main; 0 behind)
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1132_COVER_FULLFRAME_SOUND_INSET.md`
**Implementor:** mingla-implementor (Claude)
**Commit:** `b4c77aa819241a922a11159b2afb9ef7ff05bbb0` (implementation + tests)
**Status:** implemented and verified (web repro + source-introspection); native expo-video `contain` path = suspected pending the iOS dev build (tester-owned, per spec §11)

---

## 1. Summary (plain English)

Two value/structure changes superseding ORCH-1131's misses, no new product surfaces:

1. **Checkout cover = full frame, no crop.** All three checkout mini-cards (event / trip /
   experience) now render the WHOLE cover frame uncropped. Each screen gained `coverAspect` state
   (init `0.75`, clamp `0.6..1.91`), wires the `onAspectRatio` callback, passes
   `videoContentFit="contain"`, drives the box via an inline `aspectRatio`, and DROPPED the fixed
   `miniCover.height:120` that sliced a 360×640 portrait cover to a head-cut-off mid-frame strip.
   This reuses the exact adaptive mechanism the public event hero already uses — no new render path.
2. **Sound pill clearly inset.** The shared `EventCoverMedia` `audioControlBottomRight.right` moved
   `16 → 24` (`spacing.lg`) for visible right-edge breathing room. `bottom:22` (ORCH-1128 cover-seam
   clearance) preserved verbatim.

`EventCoverMedia` defaults are unchanged (`videoContentFit` default still `"cover"`, `onAspectRatio`
default still `undefined`); no consumer other than the three checkout covers + the shared pill
changes behaviour.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence / commit |
|----|-----------|--------|-------------------|
| SC-1-event | Event checkout: portrait video cover shows whole frame, head not cut | ✓ | `app/checkout/[eventId]/index.tsx` (b4c77aa81); evidence `checkout_cover_before_after_BUILT.png` |
| SC-1-trip | Trip checkout: same | ✓ | `app/checkout-trip/[tripEventId]/index.tsx` (b4c77aa81) — byte-identical mechanism |
| SC-1-experience | Experience checkout: same | ✓ | `app/checkout-experience/[experienceEventId]/index.tsx` (b4c77aa81) — byte-identical mechanism |
| SC-2 | Landscape (≈1.78) shows full frame; box bounded by 1.91 clamp (not a sliver) | ✓ (source) | clamp upper `1.91` + `contain` in all three; web-repro logic confirmed |
| SC-3 | Square (1.0) box ≈square, full frame | ✓ (source) | 1.0 is in-range of `0.6..1.91`; adaptive box = exact fit |
| SC-4 | `miniCover` declares no fixed `height:` in all three | ✓ | jest happy-path test asserts `extractNumericStyleValue(body,'height') === null` across all three routes |
| SC-5 | Public Sound pill `right:24`, `bottom:22` unchanged | ✓ | `EventCoverMedia.tsx:616` (b4c77aa81); evidence `public_hero_soundpill_16_vs_24_BUILT.png` |
| SC-6 | Public hero `heroBox` + deck card untouched | ✓ | DO-NOT-TOUCH respected (no edit to `PublicEventPage.tsx` / `SwipeableCards.tsx`); adversarial test asserts `heroBox` has no fixed height |
| SC-7 | `EventCoverMedia` `videoContentFit` default `"cover"`, `onAspectRatio` default `undefined`; no other consumer changes | ✓ | defaults untouched (line 44/50); only pill style + 3 checkout call-sites changed |

---

## 3. Files changed

| File | Lines Δ (approx) | Change |
|------|------------------|--------|
| `packages/event-rendering/EventCoverMedia.tsx` | +2 / -7 (comment rewrite) | `audioControlBottomRight.right` 16 → 24 + ORCH-1132 comment |
| `mingla-business/app/checkout/[eventId]/index.tsx` | +13 / -8 | `coverAspect` state + clamp; wire `onAspectRatio` + `videoContentFit="contain"` + inline `aspectRatio`; remove `miniCover.height:120` |
| `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` | +14 / -8 | identical change + `useState` import |
| `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx` | +14 / -8 | identical change + `useState` import |
| `mingla-business/__tests__/orch1131CoverCropSoundInset.test.ts` | +40 / -19 | round-2 assertions (no fixed height + `videoContentFit="contain"` + `onAspectRatio` across all three; pill right=24) `[TEST-MOD-APPROVED ORCH-1132]` |
| `mingla-business/__tests__/orch1131SiblingInsetNonRegressionAdversarial.test.ts` | +6 / -3 | bottomRight adversarial `right === [24]` (T-8/T-6 kept verbatim) `[TEST-MOD-APPROVED ORCH-1132]` |

No file outside the spec §9 allowlist was touched.

---

## 4. Data-model changes applied

None. Component/style layer only. No DB / migration / RLS.

## 5. Edge functions touched

None.

---

## 6. Regression tests added / updated

**Paths:**
- `mingla-business/__tests__/orch1131CoverCropSoundInset.test.ts` (happy-path, updated to round-2)
- `mingla-business/__tests__/orch1131SiblingInsetNonRegressionAdversarial.test.ts` (adversarial sibling-non-regression, bottomRight assertion updated)

Both modify ORCH-1131 assertions under the same lineage → the commit body carries
`[TEST-MOD-APPROVED ORCH-1132]` (satisfies CI `tests-append-only.yml`).

**Passing run (restored fix):**
```
PASS __tests__/orch1131CoverCropSoundInset.test.ts
PASS __tests__/orch1131SiblingInsetNonRegressionAdversarial.test.ts
Tests:       12 passed, 12 total
```

**fails-on-revert verified at `b4c77aa819241a922a11159b2afb9ef7ff05bbb0`.** True LINE DELETION of the
fix (not comment-out): reverted pill `right:24→16`, dropped `videoContentFit="contain"` +
`onAspectRatio` from the event checkout call, and re-added `height:120` to `miniCover`. Re-run:
```
FAIL __tests__/orch1131CoverCropSoundInset.test.ts
  - miniCover.height: expect(...).toBeNull() → Received: 120
  - EventCoverMedia: expect(call).toMatch(/videoContentFit="contain"/) → not found
  - bottomRight.right: expect(...).toBe(24) → Received: 16
FAIL __tests__/orch1131SiblingInsetNonRegressionAdversarial.test.ts
  - bottomRight.right: expect(...).toEqual([24]) → Received: [16]
Tests:       4 failed, 8 passed, 12 total
```
Fix restored via `git checkout --`; re-run → 12/12 PASS. Both tests appear in
`git diff origin/main...HEAD --name-only` on the closing branch (shipped in the same commit as the fix).

---

## 7. Old → New receipts

### `packages/event-rendering/EventCoverMedia.tsx`
- **Before:** `audioControlBottomRight.right = 16` (ORCH-1131 aligned to floating-chrome column; read cramped).
- **Now:** `right = 24` (`spacing.lg`) — +8px, a perceptible 50% inset increase; one deliberate step past the chrome column. `bottom:22` preserved.
- **Why:** SC-5 / spec §4.3. Shared style → intentionally moves the bottomRight pill for every consumer (expandedCard ImageGallery + authoring previews).
- **Lines:** ~9 (comment + value).

### `mingla-business/app/checkout/[eventId]/index.tsx` (and trip / experience, identical)
- **Before:** `miniCover` had fixed `height:120` + `EventCoverMedia` rendered default `videoContentFit:"cover"` → a 342×120 mid-frame strip of a 360×640 portrait cover; head cropped off.
- **Now:** `coverAspect` state (init 0.75) + `clampedCoverAspect = Math.min(Math.max(coverAspect,0.6),1.91)`; `EventCoverMedia` gets `onAspectRatio={setCoverAspect}` + `videoContentFit="contain"`; `style={[styles.miniCover, { aspectRatio: clampedCoverAspect }]}`; `miniCover` no longer declares `height:`.
- **Why:** SC-1 / SC-4 / spec §4.2. Reuses the public hero's adaptive box mechanism, paired with `contain` so nothing is ever cropped; thin clamp-boundary letterbox bars are near-invisible on the `#0c0e12` card.
- **Lines:** ~13–14 each.

---

## 8. Cross-surface impact

| # | Surface | Affected | What changes | Parity |
|---|---------|----------|--------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | Pill only | bottomRight pill on expandedCard ImageGallery +8px inset; cover-sizing change does NOT reach the deck (fixed `cover`, `showAudioControl={false}`) | Automatic (shared style) |
| 2 | Consumer Android | Pill only | Same as iOS | Automatic |
| 3 | Buyer/anon Web | YES (both) | Checkout mini-cards full-frame uncropped; public Sound pill clears edge by 24 | Manual (3 checkout files) + shared pill |
| 4 | Business iOS | YES (cover) + pill | Checkout summary full-frame cover; authoring preview pills +8px | Manual + automatic |
| 5 | Business Android | Same as Business iOS | Same | Manual + automatic |
| 6 | Admin Web | NO | Admin does not render `EventCoverMedia` checkout cards | n/a |
| 7 | Business Web preview (adjacent) | Pill | Authoring cover-preview pills (CoverPicker / CreatorStep4Cover / TripCreatorStep1Basics / EditPublishedTripScreen / ExperienceCoverStep) +8px | Automatic (shared style) |

Manual parity across 3 checkout files: implemented identically in all three (verified by grep — same `onAspectRatio`/`videoContentFit="contain"`/`aspectRatio` line set + clamp `0.6..1.91`).

---

## 9. Gate results / smoke

- **jest (the two ORCH-1131/1132 tests):** 12 passed / 12 total. PASTED §6.
- **ORCH-0978 strict-grep autoplay/muted contract:** `OK ORCH-0978 autoplay muted contract gate` (untouched by this change — gate pins only autoplay/muted, not pill position / aspect / contentFit).
- **tsc (`npx tsc --noEmit`):** my three edited checkout files + EventCoverMedia are CLEAN (grep for them in tsc output → NONE). Pre-existing repo errors remain in unrelated files (sibling `buyer.tsx` implicit-any, marketing ComposerV2, `@mingla/payments-native` / `@testing-library/react-native` module-resolution, etc.) — all present independent of this ORCH, none in scope.
- **Web repro (Playwright, faithful EventCoverMedia web-path mirror, reads the ACTUAL committed values):**
  - `checkout_cover_before_after_BUILT.png` — BEFORE (`height:120` + `cover`): a thin strip showing only BODY (HEAD + FEET cropped). AFTER (built `aspectRatio:0.6` + `contain`): full portrait frame — HEAD, BODY, FEET all visible inside the edge ruler. SC-1 proven.
  - `public_hero_soundpill_16_vs_24_BUILT.png` — pill at built `right:24` sits visibly further from the red screen-edge marker than `right:16`. SC-5 proven.
- **Native expo-video `contain` path:** suspected (same prop the hero already uses on native by RN contract). The web repro could not prove native — tester verifies on the iOS dev build per spec §11.

**Evidence folder:** `Mingla_Artifacts/evidence/ORCH-1132/`
- `checkout_cover_before_after_BUILT.png`, `public_hero_soundpill_16_vs_24_BUILT.png`, `portrait.png` (implementor, built-code render)
- `checkout_cover_A120_B075_C08_portrait.png`, `checkout_cover_RECOMMENDED_contain.png`, `public_hero_soundpill_16_vs_24.png` (forensics repro)

---

## 10. Known issues / deferred

- **Image covers stay `cover`-fitted** (spec §4.4 / §10 Q1): `videoContentFit` does not affect images
  (`EventCoverMedia.tsx:514` hardcodes `resizeMode="cover"`). In-range image covers get no crop; only
  clamp-boundary portrait/landscape images crop a little. SPEC intentionally did NOT add an
  `imageContentFit` prop (scope guard). Accept for this ORCH, or a follow-on ORCH for full image
  `contain`. No `[TRANSITIONAL]` marker — this is intended scope, not tech debt.
- **First-paint reflow** (0.75 → true aspect once media reports): brief, benign, identical in
  character to the hero's first paint. Acceptable per spec §10 Q3.
- **Native `contain` verification** deferred to the tester (iOS dev build) — the one item the web
  repro cannot prove.

---

## 11. Operator action required

- **No migration.** No `db push`.
- **No edge-function deploy.** Component/style only.
- **Pure-JS / RN change** — per `project_ota_deferred_until_new_build.md`, ship via `eas update`
  (per-platform) at CLOSE; no native rebuild required. (Operator/orchestrator decision at CLOSE,
  not the implementor's.)

---

## 12. Discoveries for Orchestrator

- **Pre-existing tsc errors in `mingla-business`** (sibling `buyer.tsx` implicit-any params,
  `@mingla/payments-native` + `@testing-library/react-native` + `expo-image-manipulator` unresolved
  module types, marketing ComposerV2 type mismatches). NONE in this ORCH's scope; flagged so the
  orchestrator can register a repo-health cleanup if desired. They predate ORCH-1132 and do not block.
- **Comms ledger:** read on entry. No BLOCK/OPEN row addressed to mingla-implementor / ORCH-1132 /
  ALL requiring action. The two ALL WARN rows (COMMS-0030 iOS build — already RESOLVED per recent
  main commits; COMMS-0027 OTA-poison from symlinked worktrees) are deploy/build concerns owned by
  the orchestrator/operator at CLOSE, not the implementor; noted for awareness. No new COMMS entry
  needed (no cross-ORCH discovery).
