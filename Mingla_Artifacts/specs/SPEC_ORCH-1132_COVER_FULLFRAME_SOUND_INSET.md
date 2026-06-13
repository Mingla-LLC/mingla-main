# SPEC — ORCH-1132 — Checkout cover full-frame (no crop) + public Sound-pill visibly clear of edge (round 2)

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1132-[cover-fullframe-sound-inset]/`
**Branch:** `ORCH-1132-cover-fullframe-sound-inset` (rebased on origin/main; carries ORCH-1131 shipped values)
**Author:** mingla-forensics (INVESTIGATE + SPEC)
**Status:** SPEC complete — ready for IMPLEMENT
**Confidence on root mechanism:** PROVEN (live-fire web repro; intrinsic media dimensions probed via ffprobe)

---

## 0. Why this is round 2 (the misses being corrected)

ORCH-1131 shipped two value-only changes (PR #459, merge `e90875dda`) that fell short of intent, verified on Seth's dev build:

- **Cover.** It raised the checkout `miniCover.height` 64→120 and KEPT `contentFit:"cover"` (the comment even says "Do NOT switch to contain"). At 342pt content width a 120pt band shows only a `342×120` window of a **360×640 portrait** cover video → a mid-frame horizontal strip that **crops the subject's head off**. Seth's real complaint is the CROP, not the band size.
- **Sound pill.** It moved `audioControlBottomRight.right` 14→16 to align the pill to the public-event X/share chrome column (`floatingChrome.right = spacing.md = 16`). That is a 2px nudge — imperceptible. Seth wants VISIBLE breathing room between the pill and the screen edge.

This SPEC supersedes ORCH-1131's two value choices. Same file surfaces; opposite design call on both.

---

## 1. Executive summary

Two value/structure changes, no new product surfaces:

1. **Checkout cover = full frame, no crop.** Make the three checkout-summary mini-cards (event / trip / experience) render the WHOLE cover frame uncropped as a tall, portrait-friendly block — a smaller echo of the public event-page hero. Reuse the hero's proven adaptive mechanism: the `onAspectRatio` callback drives the box's `aspectRatio` to the media's real shape, paired with `videoContentFit="contain"` so nothing is ever cropped (and the near-black card swallows any letterbox bars). Default behaviour of `EventCoverMedia` for every other consumer is unchanged.
2. **Sound pill clearly inset.** Move the shared `EventCoverMedia` `audioControlBottomRight.right` from 16 to **24 (`spacing.lg`)** for obvious right-edge breathing room. `bottom:22` preserved verbatim (ORCH-1128 cover-seam clearance — load-bearing).

---

## 2. Scope & non-goals

### In scope
- The three checkout mini-card cover renders: `app/checkout/[eventId]/index.tsx`, `app/checkout-trip/[tripEventId]/index.tsx`, `app/checkout-experience/[experienceEventId]/index.tsx` (mingla-business) — each gains adaptive-aspect state + `onAspectRatio` + `videoContentFit="contain"`, and `miniCover` loses its fixed `height:120` in favour of an inline `aspectRatio`.
- The shared `audioControlBottomRight.right` value in `packages/event-rendering/EventCoverMedia.tsx`.
- The two ORCH-1131 jest tests that pin the now-superseded values (`orch1131CoverCropSoundInset.test.ts`, `orch1131SiblingInsetNonRegressionAdversarial.test.ts`) — update the pinned numbers to round-2 values (same ORCH lineage; round 2 supersedes round 1).

### Non-goals (explicit)
- **Do NOT change `EventCoverMedia`'s defaults.** `videoContentFit` default stays `"cover"`; `onAspectRatio` default stays `undefined`. No existing consumer may change behaviour from this change except via the shared pill inset (item 2, intentional).
- **Do NOT touch the public event-page hero rendering** (`PublicEventPage` `heroBox` / `heroColumn` / `clampedHeroAspect`). The hero already adapts; it is the REFERENCE, not a target. Only its Sound pill moves (via the shared style — that is the intended shared effect).
- **Do NOT touch the consumer deck card** (`SwipeableCards.tsx` — it passes `showAudioControl={false}` and no adaptive aspect; the deck cover stays fixed-shape `cover`).
- **Do NOT add a portrait clamp to the public hero** or otherwise alter its `0.75..16/9` clamp.
- No new edge functions, DB, RLS, hooks, services, analytics, copy.

### Assumptions
- `onAspectRatio` fires for images AND videos (verified: video via `loadedmetadata`/`sourceLoad`; image via `onLoad` → `event.nativeEvent.source.width/height`, EventCoverMedia.tsx:517-530).
- The checkout content column is `paddingHorizontal: spacing.lg` (24) each side → ~342pt at a 390pt screen; the card background is `#0c0e12` (checkout `container.backgroundColor`) so `contain` letterbox bars on a black video background are nearly invisible.

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behaviour | Files touched here | Parity |
|---|---------|---------|------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | Pill only (shared) | Sound pill on expanded-card ImageGallery + any default-bottomRight cover moves +8px inset; cover-sizing change does NOT reach consumer (deck uses fixed `cover`, `showAudioControl={false}`) | none directly; inherits `EventCoverMedia` pill style | Automatic (shared style) |
| 2 | Consumer Android (`app-mobile/`) | Pill only (shared) | Same as iOS | none | Automatic |
| 3 | Buyer/anon Web (`mingla-business` checkout routes + public event page) | YES (both fixes) | Checkout mini-cards show full uncropped cover; public-event Sound pill clears the edge by 24 | 3 checkout `index.tsx` + `EventCoverMedia.tsx` | Manual (3 separate checkout files) + shared pill |
| 4 | Business iOS (`mingla-business/`) | YES (cover) + pill | Checkout summary full-frame cover (in-app checkout preview); authoring cover previews' pill moves +8px | 3 checkout files + shared pill | Manual + automatic |
| 5 | Business Android (`mingla-business/`) | Same as Business iOS | Same | same | Manual + automatic |
| 6 | Admin Web (`mingla-admin/`) | NO | Admin does not render `EventCoverMedia` checkout cards | none | n/a — surface does not consume |
| 7 | Business Web preview (adjacent) | YES (pill) | Authoring cover previews (CoverPicker, CreatorStep4Cover, TripCreatorStep1Basics, EditPublishedTripScreen, ExperienceCoverStep) all use default-bottomRight pill → +8px inset | shared pill | Automatic (shared style) |

**Pill is a shared style — it intentionally moves the bottomRight pill for every consumer.** Full safety assessment in §6 / §10.

---

## 4. Layered specification (Component layer only — no DB/edge/hook/service/realtime touched)

### 4.1 The confirmed full-frame mechanism (how the public hero does it)

`EventCoverMedia` (packages/event-rendering/EventCoverMedia.tsx) exposes two ORCH-0992 props that together produce uncropped rendering:

- **`onAspectRatio?: (ratio: number) => void`** — fires once the media's intrinsic `width/height` is known. Video web: `loadedmetadata` → `videoWidth/videoHeight` (line 149-161). Video native: expo-video `sourceLoad`/`videoTrack.size` (line 248-260). Image: `onLoad` → `source.width/height` (line 517-530). Guarded so consumers that omit it pay nothing.
- **`videoContentFit?: "cover" | "contain"`** (default `"cover"`) — passed through to the web `<video>` `objectFit` (line 202) and the native `VideoView contentFit` (line 306). **Images are always `resizeMode="cover"`** (line 514) — see §4.4 for the image caveat.

The **public hero** (`PublicEventPage.tsx:546-597`) wires these as:
```
const [heroAspect, setHeroAspect] = useState(16/9);
const clampedHeroAspect = Math.min(Math.max(heroAspect, 0.75), 16/9);
<View style={[styles.heroBox, { aspectRatio: clampedHeroAspect }]}>
  <EventCoverMedia ... onAspectRatio={setHeroAspect} />  // default videoContentFit "cover"
```
The box's `aspectRatio` is driven to the media's real shape, so `cover` fills it with no crop AND no letterbox — **as long as the box aspect equals the media aspect.** When the clamp bites (media outside `0.75..16/9`, e.g. a 0.5625 portrait → clamped to 0.75), the hero's `cover` DOES crop the difference (0.5625 vs 0.75). The hero accepts that small crop to bound page height; the checkout requirement is stricter ("nothing gets cut off"), so the checkout pairs the same adaptive box with **`contain`** instead of `cover`.

> **Live-fire proof (ffprobe):** the two newest real video covers (`Raleigh Wine and Dine Crawl`, `Vibes and Stuff`) are both **360×640 (portrait, aspect 0.5625)**. At 342pt width a 120pt `cover` band shows a `342×120` strip — the head is cropped out. See evidence §8.

### 4.2 Chosen checkout-cover approach (B-adaptive + contain) — APPLIES TO ALL THREE MINI-CARDS

Reuse the hero's adaptive-box mechanism, but pair it with `videoContentFit="contain"` and a **portrait-permitting clamp** so the FULL frame always shows:

In each of the three checkout screens, add adaptive aspect state and wire the cover:
```
const [coverAspect, setCoverAspect] = useState(0.75);            // portrait-ish first paint
const clampedCoverAspect = Math.min(Math.max(coverAspect, 0.6), 1.91);
...
<EventCoverMedia
  ...existing props (hue / mediaUrl / mediaType / radius={0} / label="")...
  onAspectRatio={setCoverAspect}
  videoContentFit="contain"
  style={[styles.miniCover, { aspectRatio: clampedCoverAspect }]}
/>
```
And in each screen's `StyleSheet`, **remove `height: 120`** from `miniCover`, keeping `borderRadius: radiusTokens.md` and `marginBottom: spacing.sm`. (Width stays `width:"100%"` default → full content-column width; the box height now follows `aspectRatio` inline.)

**Exact values (identical across all three files):**
- `useState` initial: `0.75` (a stable portrait-ish first paint before media reports; matches the hero's "common first paint" pattern).
- Clamp: **lower `0.6`** (allows true-portrait covers a tall box; a 0.5625 portrait clamps to 0.6 and `contain` shows the full frame with ~3% invisible side bars on the black card), **upper `1.91`** (a wide/landscape cover gets a reasonable, not-too-short block; `contain` shows the full landscape frame letterboxed top/bottom — bars invisible on black). The upper bound also bounds the card's *minimum* height so a panoramic cover can't collapse to a sliver.
- `videoContentFit="contain"` — guarantees NO crop at the clamp boundaries.

**Why this over the alternatives** (evidence §8 compares all three):
- **(a) adaptive + `cover` (the literal hero mechanism):** at the portrait clamp it STILL crops (0.5625 media in a 0.75 box). Fails "nothing gets cut off." REJECTED.
- **(c) fixed `aspectRatio:0.8` + contain:** simplest (no state), full-frame, but a landscape cover gets large top/bottom bars and wastes vertical space, and a portrait cover is slightly letterboxed side-to-side even though a taller box could fit it edge-to-edge. Acceptable but inferior. REJECTED as second choice.
- **(B) adaptive + `contain` (CHOSEN):** box tracks the media's real shape so for in-range covers `contain` ≈ perfect fill (no visible bars); only clamp-boundary covers get thin, near-invisible bars on `#0c0e12`. Best result for portrait / square / landscape alike. Proven in evidence `checkout_cover_RECOMMENDED_contain.png`.

**First-paint note:** before `onAspectRatio` fires the box is 0.75 (portrait-ish). For a few hundred ms a landscape cover paints into a 0.75 box with `contain` (letterboxed), then settles to its true shape when the ratio reports. This is a brief, benign reflow identical in character to the hero's first-paint behaviour. Acceptable.

### 4.3 Sound-pill inset (shared)

In `packages/event-rendering/EventCoverMedia.tsx`, `styles.audioControlBottomRight`:
```
right: 24,   // ORCH-1132 — 16 → 24 (spacing.lg): visible right-edge breathing room.
bottom: 22,  // ORCH-1128 — preserved verbatim (cover-seam clearance, load-bearing)
```
- **Chosen value: `24` (= `spacing.lg`).** Justification vs the chrome insets: the public-event X/share chrome sits at `right: spacing.md = 16`. ORCH-1131 aligned the pill to that column (16); Seth found it cramped. 24 is +8px (a perceptible 50% increase in inset) and a real design token (`spacing.lg`), so the pill now sits one step further from the edge than the chrome — a deliberate, legible offset, not a misalignment. 24 keeps the pill comfortably clear of the cover's left content and never collides with the bottom seam (bottom:22 unchanged). The raw literal `24` matches this file's convention (topLeft/topRight use raw numbers); a comment names it `spacing.lg`.

### 4.4 Image-cover caveat (must be in the SPEC, must NOT trigger scope creep)

`EventCoverMedia` renders IMAGE covers with a hardcoded `resizeMode="cover"` (line 514) — `videoContentFit` does NOT apply to images. So for an **image** cover the adaptive box (driven by `onAspectRatio`, which DOES fire for images) will match the image's real aspect, and `cover` into a same-aspect box yields no crop. The only residual crop for images is at the clamp boundary (a 0.5 portrait image in a 0.6 box crops ~16% off the sides). This is acceptable and intentional — **do NOT** widen scope to add an `imageContentFit` prop in this ORCH. If Seth later wants image covers fully `contain`'d too, that is a separate ORCH. Flagged in §10.

---

## 5. Success criteria

- **SC-1 (cover, all three, per-surface manual):** On the buyer-web checkout for an event with a **portrait (0.5625) video cover**, the mini-card cover shows the WHOLE frame — the subject's head/feet are NOT cut off — as a tall portrait-ish block.
  - **SC-1-event** — `app/checkout/[eventId]/index.tsx`
  - **SC-1-trip** — `app/checkout-trip/[tripEventId]/index.tsx`
  - **SC-1-experience** — `app/checkout-experience/[experienceEventId]/index.tsx`
- **SC-2:** For a **landscape (≈1.78) cover**, the same mini-card shows the full landscape frame (letterboxed top/bottom; bars near-invisible on `#0c0e12`), not a center-crop. Box height is bounded by the 1.91 clamp (not a sliver).
- **SC-3:** For a **square (1.0) cover**, the mini-card box is ≈square and shows the full frame.
- **SC-4:** `miniCover` in all three files no longer declares a fixed `height:` (height follows the inline `aspectRatio`).
- **SC-5:** The public-event Sound pill sits at `right:24` — visibly further from the screen edge than at 16, and `bottom:22` is unchanged.
- **SC-6 (non-regression):** The public-event hero (`PublicEventPage` `heroBox`) is unchanged — still aspect-adaptive via `clampedHeroAspect` (`0.75..16/9`), `cover` fill, NO fixed pixel height; the consumer deck card cover is unchanged (fixed `cover`, no adaptive aspect, no pill).
- **SC-7 (default-safety):** `EventCoverMedia`'s `videoContentFit` default is still `"cover"` and `onAspectRatio` default is still `undefined`; no consumer other than the three checkout cards (cover) and the shared bottomRight pill (inset) changes behaviour.

---

## 6. Invariants

- **I-MOR-0827-PACKAGE-ISOLATION** — preserved; no app-level imports added to the package.
- **I-MOR-0978 autoplay/muted contract** (strict-grep `orch-0978-video-autoplay-muted-contract.mjs`) — preserved; this change touches neither autoplay nor muted (verified: the gate pins only those two, NOT pill position / aspect / contentFit).
- **ORCH-1128 cover-seam clearance (`bottom:22`)** — preserved verbatim.
- **No NEW invariant proposed.** This is a value/structure tuning within an existing, already-invariant-guarded component.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 happy | Portrait video cover at checkout | 360×640 cover, event route | Box `aspectRatio` 0.6, `videoContentFit="contain"`, full frame visible | Component (source-introspection + web repro) |
| T-2 happy | Sound-pill inset | `audioControlBottomRight` | `right === 24`, `bottom === 22` | Style (source-introspection) |
| T-3 edge | Landscape cover | 1280×720 cover | Box clamps to ≤1.91, contain, no crop | Component |
| T-4 edge | Square cover | 1:1 cover | Box ≈1.0, full frame | Component |
| T-5 error | `onAspectRatio` never fires (media error → fallback) | broken URL | Box stays at first-paint 0.75; EventCover placeholder renders; no crash | Component |
| T-6 non-regress | Public hero untouched | `PublicEventPage` `heroBox` | NO fixed pixel `height`; clamp still `0.75..16/9` | Source-introspection |
| T-7 non-regress | Deck card untouched | `SwipeableCards` | `showAudioControl={false}`, no adaptive aspect, fixed cover | Source-introspection |
| T-8 adversarial | Sibling pills not shifted | `audioControlTopLeft`/`audioControlTopRight` | still `14` | Source-introspection |
| T-9 adversarial | Single `right:` declaration | `audioControlBottomRight` | exactly one `right:` = 24 (no shadow override) | Source-introspection |
| T-10 default-safety | EventCoverMedia defaults | component signature | `videoContentFit="cover"` default, `onAspectRatio` default undefined | Source-introspection |

## 7a. Regression-test contract (fails-on-revert)

Update the two existing ORCH-1131 jest tests (same lineage) and keep them fails-on-revert:

1. **`orch1131CoverCropSoundInset.test.ts`** (rename optional to `orch1132...`; updating in place is acceptable):
   - Replace the `miniCover.height === 120` assertions with: each of the three checkout routes' `miniCover` block has **NO** numeric `height:` declaration (assert `extractNumericStyleValue(body,'height') === null`) AND each `EventCoverMedia` call in that file passes `videoContentFit="contain"` and `onAspectRatio=` (grep the call). FAILS-ON-REVERT: re-adding `height: 120` or dropping `videoContentFit="contain"` makes it fail.
   - Replace the pill `right === 16` assertion with `right === 24`. FAILS-ON-REVERT: reverting to 16 (or 14) fails.
2. **`orch1131SiblingInsetNonRegressionAdversarial.test.ts`**:
   - Keep T-8 (topLeft/topRight stay 14) and T-6 (heroBox no fixed height) verbatim.
   - Update the `audioControlBottomRight` adversarial assertion: `right` values === `[24]` (exactly one), `bottom` values === `[22]`.

Both tests already use comment-proof `property: value` source extraction (a true line edit changes the asserted value). Verify both FAIL when the round-2 changes are reverted and PASS when restored (record in the IMPLEMENTATION report).

---

## 8. Repro evidence (live-fire web)

All under `Mingla_Artifacts/evidence/ORCH-1132/`:

- **`checkout_cover_A120_B075_C08_portrait.png`** — three-up of the real 360×640 portrait video cover in a 342pt content column on the `#0c0e12` card: **(A)** current ORCH-1131 `height:120` + cover = a thin mid-frame strip, head cropped (Seth's complaint, reproduced); **(B)** `aspectRatio:0.75` + cover (the literal hero mechanism) = taller but STILL crops top/bottom; **(C)** `aspectRatio:0.8` + contain = full frame, near-invisible bars.
- **`checkout_cover_RECOMMENDED_contain.png`** — the CHOSEN approach: portrait `0.6`-box + contain (full vertical frame, imperceptible side bars) and a square-box + contain (full frame). Confirms full-frame for portrait and square.
- **`public_hero_soundpill_16_vs_24.png`** — public-hero pill at `right:16` (current) vs `right:24` (proposed) with a red edge-marker; 24 sits visibly further from the edge.

Intrinsic dimensions probed with `ffprobe` (2 of the 3 real video covers = 360×640 portrait); harness faithfully mirrors `EventCoverMedia`'s web rendering (`objectFit` = `videoContentFit`, absolute-fill in a fixed-dimension box). Confidence on the crop mechanism: **PROVEN**. Note the harness reproduces the WEB path; native expo-video `contentFit` behaves identically by RN contract — the implementor/tester should confirm on the iOS sim/dev build (caps at "suspected" for native until then, but the prop is the same one the hero already uses on native).

---

## 9. Implementation order

1. `packages/event-rendering/EventCoverMedia.tsx` — `audioControlBottomRight.right` 16 → 24 (+ comment). (Shared pill; one-line.)
2. `mingla-business/app/checkout/[eventId]/index.tsx` — add `coverAspect` state + clamp, wire `onAspectRatio` + `videoContentFit="contain"` + inline `aspectRatio`; remove `miniCover.height:120`.
3. `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` — identical change.
4. `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx` — identical change.
5. Update `mingla-business/__tests__/orch1131CoverCropSoundInset.test.ts` + `orch1131SiblingInsetNonRegressionAdversarial.test.ts` per §7a. Prove fails-on-revert.
6. Run the business jest suite; run the ORCH-0978 strict-grep gate to confirm green (it pins only autoplay/muted).

### Scoped allowlist (implementor MUST stop-and-amend before touching anything else)
- `packages/event-rendering/EventCoverMedia.tsx` (pill inset only — line ~614)
- `mingla-business/app/checkout/[eventId]/index.tsx`
- `mingla-business/app/checkout-trip/[tripEventId]/index.tsx`
- `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx`
- `mingla-business/__tests__/orch1131CoverCropSoundInset.test.ts`
- `mingla-business/__tests__/orch1131SiblingInsetNonRegressionAdversarial.test.ts`

### DO-NOT-TOUCH
- `packages/event-rendering/PublicEventPage.tsx` (hero rendering — REFERENCE only; its pill moves via the shared style, no edit here).
- `packages/event-rendering/EventCoverMedia.tsx` defaults / `videoContentFit` default / `onAspectRatio` default / image `resizeMode` / topLeft/topRight pill insets / `bottom:22`.
- `app-mobile/src/components/SwipeableCards.tsx` and any deck card.
- `app-mobile/src/components/expandedCard/ImageGallery.tsx` (inherits the shared pill move; no edit).
- The authoring cover-preview consumers (CoverPicker, CreatorStep4Cover, TripCreatorStep1Basics, EditPublishedTripScreen, ExperienceCoverStep) — they inherit the shared pill move; no edit.
- Any DB / edge / hook / service / RLS / strict-grep gate.

---

## 10. Open questions

1. **Image covers stay `cover`-fitted (clamp-boundary crop possible).** `videoContentFit` does not affect images (line 514 hardcodes `resizeMode="cover"`). For in-range image covers the adaptive box yields no crop; only clamp-boundary portrait/landscape images crop a little. SPEC intentionally does NOT add an `imageContentFit` prop (scope guard). Confirm acceptable, or spawn a follow-on ORCH for full image `contain`. **Recommendation: accept for this ORCH.**
2. **Clamp bounds `0.6 .. 1.91`.** Chosen so a 0.5625 portrait gets a near-edge-to-edge tall box and a wide cover is not a sliver. If Seth wants even taller portrait blocks (true 0.5625, no clamp) the lower bound can drop to `0.5625` — but that pushes the summary further down before the ticket selector. **Recommendation: keep 0.6** (full frame already achieved; bars imperceptible).
3. **First-paint reflow** (0.75 → true aspect once media reports) is brief and benign, same as the hero. Confirm acceptable.

---

## 11. Downstream routing

NEXT = `mingla-implementor` in this worktree (`~/Desktop/mingla-orchs/ORCH-1132-[cover-fullframe-sound-inset]/`, branch `ORCH-1132-cover-fullframe-sound-inset`). Build exactly §4 + §9, prove §7a fails-on-revert, write the IMPLEMENTATION report.
THEN = `mingla-tester` — verify SC-1..SC-7 on buyer web (portrait + landscape + square covers) AND on the iOS dev build for the native expo-video `contain` path (the one item the web repro could not prove); confirm the public hero + deck card are visually untouched; confirm the shared pill move looks right on the authoring previews + ImageGallery.
THEN = `mingla-orchestrator` CLOSE (PR-protected main → isolated docs worktree).
