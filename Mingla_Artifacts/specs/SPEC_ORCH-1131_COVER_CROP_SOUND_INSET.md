# SPEC — ORCH-1131 — Get-tickets cover crop + public-event Sound-pill edge clearance

- **ORCH-ID:** ORCH-1131
- **Severity / class:** S3 · ux + design-debt
- **Working tree:** `~/Desktop/mingla-orchs/ORCH-1131-[cover-crop-sound-inset]/` on branch `ORCH-1131-cover-crop-sound-inset`
- **Lineage:** direct follow-on to ORCH-1128 (mute pill `bottom:14→22`) and ORCH-1124 (introduced the `bottomRight` Sound pill on the public hero).
- **Source:** single Seth report with screenshots — two small consumer-facing polish fixes.
- **Phase produced by:** mingla-forensics (INVESTIGATE + SPEC, combined). No product code written.

---

## 1. Executive summary

Two independent, low-risk visual-polish fixes on the buyer-facing surfaces:

- **FIX 1 — Get-tickets cover crop.** The checkout "mini-card" cover renders into a 64pt-tall band via `EventCoverMedia`, which fills with `objectFit/contentFit:"cover"`. A **portrait** cover video (1080×1920) is sliced to a thin mid-frame horizontal strip — the buyer sees an unrecognizable sliver (Seth's screenshot: only the "...days..." mid-band). Fix: give the mini-card cover a taller, fixed compact band (**120pt**, keeping `contentFit:"cover"`) so the cover is recognizable while the card stays a compact checkout summary.
- **FIX 2 — Public-event Sound pill too close to the right edge.** The shared `EventCoverMedia` `audioControlBottomRight` style sits at `right:14`, while the sibling floating chrome (X / share) on the public event hero sits at `right:16` (`spacing.md`). The pill protrudes ~2px past the chrome's right edge toward the screen edge and reads cramped. Fix: set `right:16` so the pill's right edge aligns to the chrome column.

Both are reproduced and measured below.

---

## 2. Scope & non-goals

### In scope (the two named fixes)
1. **FIX 1** — taller compact cover band on the **event** Get-tickets checkout mini-card (`mingla-business/app/checkout/[eventId]/index.tsx`, `styles.miniCover`).
2. **FIX 2** — `right` inset of the shared `audioControlBottomRight` Sound pill in `packages/event-rendering/EventCoverMedia.tsx`.

### Strongly-recommended parallel application (same bug class — see Open Question OQ-1)
The trip and experience Get-tickets checkouts (`checkout-trip/[tripEventId]/index.tsx`, `checkout-experience/[experienceEventId]/index.tsx`) carry a **byte-identical** `miniCover { height: 64 … }` block and the **same** crop bug. A buyer hitting a trip/experience checkout sees the same sliver. The fix is the same one-line height change. Recommended to apply to all three in this ORCH; gated on Seth/orchestrator greenlight (OQ-1) because the dispatch named only the event checkout. Default recommendation: **apply to all three.**

### Non-goals (explicitly NOT in this ORCH)
- Do **NOT** change `EventCoverMedia`'s default `videoContentFit:"cover"` or image `resizeMode:"cover"` globally. List/grid/deck cards depend on "cover" crop-to-fill.
- Do **NOT** touch the public event hero's cover rendering — it already adapts to media aspect via `onAspectRatio`/`aspectRatio` (ORCH-0992) and does **not** crop. FIX 1 is checkout-only.
- Do **NOT** change the pill's `bottom:22` (ORCH-1128) or its `bottomRight` position (ORCH-1124). FIX 2 is the `right` value only.
- Do **NOT** alter `audioControlTopLeft`/`audioControlTopRight` insets (untouched at `14`).
- No new components, no new tokens, no migrations, no edge/DB/service/hook changes.
- `CreatorStep7Preview.tsx` `miniCover` is an authoring **preview** that wraps a plain `<View>` (not `EventCoverMedia`) — OUT of scope, different code path.

### Assumptions
- Phone content width on checkout ≈ 342pt (390pt screen − 2×`spacing.lg`=24). At that width a 120pt band ≈ 2.85:1 (compact cinematic). Verified against `scrollContent.paddingHorizontal: spacing.lg`.

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior | Files touched here | Parity |
|---|---------|---------|-----------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | FIX 2 only | Sound pill on consumer native event view + expandedCard ImageGallery moves `right:14→16` (shared style). Cosmetic 2px. No FIX-1 surface here. | (shared) `packages/event-rendering/EventCoverMedia.tsx` | Automatic (shared package) |
| 2 | Consumer Android (`app-mobile/`) | FIX 2 only | Same as iOS. | (shared) same | Automatic |
| 3 | Buyer/anonymous Web (`mingla-business/` checkout + `/e/...`) | **FIX 1 + FIX 2** | Get-tickets cover band recognizable (FIX 1); public-event Sound pill clears the edge (FIX 2). | `mingla-business/app/checkout/[eventId]/index.tsx` (+trip/experience per OQ-1); `packages/event-rendering/EventCoverMedia.tsx` | FIX 1 manual per-checkout-route; FIX 2 automatic |
| 4 | Business iOS (`mingla-business/`) | FIX 2 incidental | Authoring cover previews (CreatorStep4Cover, TripCreatorStep1Basics, ExperienceCoverStep, EditPublishedTripScreen, CoverPicker) use default `bottomRight` pill → `right` shifts 14→16. Cosmetic, improves alignment. | (shared) same | Automatic |
| 5 | Business Android (`mingla-business/`) | FIX 2 incidental | Same as Business iOS. | (shared) same | Automatic |
| 6 | Admin Web (`mingla-admin/`, adjacent) | Not covered | Admin does not render `EventCoverMedia` audio pill or the checkout mini-card. | — | n/a |
| 7 | Business Web preview (adjacent) | FIX 2 incidental | Same shared-style shift as Business iOS/Android previews. | (shared) same | Automatic |

**FIX 2 is a shared-package style change → it lands on every `bottomRight` `EventCoverMedia` consumer simultaneously.** Enumerated consumers (all default or explicit `bottomRight`): `PublicEventPage.tsx:591` (target), `ImageGallery.tsx:134` (consumer expanded card, explicit), and the 5 business authoring previews listed above. In every case the change is +2px of right inset that improves edge clearance — no consumer relies on `right:14`. Safe.

---

## 4. Layered specification

Only the **Component** layer is touched. No DB / RLS / edge / service / hook / realtime changes.

### FIX 1 — checkout mini-card cover band (Component)

**File:** `mingla-business/app/checkout/[eventId]/index.tsx`
**Style:** `styles.miniCover` (lines ~344–348).

Before:
```ts
miniCover: {
  height: 64,
  borderRadius: radiusTokens.md,
  marginBottom: spacing.sm,
},
```
After:
```ts
miniCover: {
  // ORCH-1131 — 64 → 120: a 64pt band sliced a PORTRAIT cover video
  // (EventCoverMedia fills contentFit:"cover") to an unrecognizable mid-frame
  // strip. 120pt (~2.85:1 at 342pt content width) reveals the cover while
  // keeping the checkout summary compact. Kept "cover" (no letterbox bars on
  // the dark card). Repro: Mingla_Artifacts/evidence/ORCH-1131/01-repro-full.png.
  height: 120,
  borderRadius: radiusTokens.md,
  marginBottom: spacing.sm,
},
```

- No prop changes to the `<EventCoverMedia>` element (lines ~241–248): it keeps `radius={0}` + `style={styles.miniCover}`. The container's `borderRadius` (from `miniCover`) + `overflow:"hidden"` (from EventCoverMedia `styles.container`) continue to clip the corners; the inner media stays `absoluteFill`. No regression to the rounded corners.
- Do **NOT** add `videoContentFit="contain"` — repro Proposed-B showed black pillarbox bars reading as a broken/empty card on the dark `#0c0e12` background.

**Per OQ-1 (recommended):** apply the byte-identical change to:
- `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` `styles.miniCover` (lines ~429–433).
- `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx` `styles.miniCover` (lines ~330–334).
Both already import `radius as radiusTokens` + `spacing` and use the identical block — drop-in.

### FIX 2 — shared Sound-pill right inset (Component, shared package)

**File:** `packages/event-rendering/EventCoverMedia.tsx`
**Style:** `styles.audioControlBottomRight` (lines ~606–611).

Before:
```ts
audioControlBottomRight: {
  right: 14,
  // ORCH-1128 — 14 → 22: clears the cover seam …
  bottom: 22,
},
```
After:
```ts
audioControlBottomRight: {
  // ORCH-1131 — 14 → 16: align the pill's right edge to the public-event
  // floating chrome (X / share at right: spacing.md = 16, PublicEventPage
  // floatingChrome). At 14 the pill protruded ~2px past the chrome column
  // toward the screen edge and read cramped. Shared style: also nudges the
  // consumer expandedCard + business authoring-preview pills by +2px (safe;
  // no consumer relies on 14). Repro measured: chrome gap 16 vs pill gap 14
  // (Mingla_Artifacts/evidence/ORCH-1131/shoot.cjs).
  right: 16,
  // ORCH-1128 — clears the cover seam so the pill stops bleeding into the
  // details section below the public hero (radius:0 + absoluteFill).
  bottom: 22,
},
```

- Use the raw literal `16` (not an imported token) to match this file's existing convention — `EventCoverMedia.tsx` does **not** import `designTokens`; all three position styles (`topLeft`/`topRight`/`bottomRight`) use raw numbers. `16 === spacing.md`. Introducing a token import for one value would deviate from the file and is out of scope.
- Reject `right:24` (`spacing.lg`): repro showed `16` lands the pill's right edge exactly on the chrome column; `24` over-indents it inboard of the chrome. Align, don't over-inset.

---

## 5. Success criteria

- **SC-1-Web (FIX 1, event):** On the buyer web Get-tickets screen (`/checkout/{eventId}`) for an event with a **portrait** cover video, the cover band is 120pt tall and the cover is recognizable (more than a single mid-frame strip), with rounded corners intact and no black letterbox bars.
- **SC-2-Web (FIX 1, landscape regression):** For an event with a **landscape/16:9** cover, the 120pt band still renders a clean cover-filled image with no distortion or new whitespace.
- **SC-3 (FIX 1, OQ-1, if greenlit):** Trip checkout (`/checkout-trip/{id}`) and experience checkout (`/checkout-experience/{id}`) mini-cards render the same 120pt recognizable band.
- **SC-4-Web (FIX 2, public hero):** On `/e/{brandSlug}/{eventSlug}` with a video cover, the Sound pill's right edge aligns to the floating X/share chrome column (both at 16px from the hero's right edge); visible space exists between the pill and the screen edge.
- **SC-5-iOS / SC-5-Android (FIX 2, parity):** Consumer native event view + expandedCard ImageGallery Sound pill, and business authoring cover previews, render the pill at `right:16` with no clipping or overlap.
- **SC-6 (no global regression):** List/grid/deck cards (`SwipeableCards`, `BusinessEventCard`, `TripCard`, brand page) still crop-to-fill their covers (`videoContentFit:"cover"` unchanged); the public event hero still adapts to media aspect (no new crop/letterbox).

---

## 6. Invariants

| Invariant | How preserved | Verifying test |
|-----------|---------------|----------------|
| `orch-0978-video-autoplay-muted-contract` (EventCoverMedia defaults muted=true + web inline-playback primitives + package export) | FIX 2 touches only `audioControlBottomRight.right`; no change to muted default, web video branch, or the package export | Re-run `node .github/scripts/strict-grep/orch-0978-video-autoplay-muted-contract.mjs` → PASS |
| I-MOR-0827-PACKAGE-ISOLATION (`@mingla/event-rendering` imports no app code) | FIX 2 uses a raw literal `16`, no new import; package stays isolated | grep: no new `import` lines in EventCoverMedia.tsx |
| ORCH-1128 pill `bottom:22` (cover-seam clearance) | Preserved verbatim; only `right` changes | Visual SC-4 + style assertion `bottom === 22` |
| ORCH-1124 pill `bottomRight` position | Preserved; position prop + style selection unchanged | Visual SC-4 |
| safearea-on-fullscreen-routes allow (checkout header banner aesthetic) | FIX 1 changes only `miniCover.height`; header/insets untouched | n/a (no header edit) |

No new invariants proposed. (The 120pt band and 16px inset are values, not structural contracts worth pinning; the regression guard in §9 covers recurrence.)

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T1 (happy, FIX1) | Portrait video cover on event checkout | event w/ 1080×1920 cover video | 120pt band, "more than a strip" visible, corners rounded, no letterbox | Component / web render |
| T2 (edge, FIX1) | Landscape cover on event checkout | event w/ 1920×1080 cover | clean cover fill in 120pt band, no distortion | Component |
| T3 (edge, FIX1) | No cover media (hue fallback) | event w/ `coverMediaUrl=null` | `EventCover` hue placeholder fills 120pt band, no crash | Component |
| T4 (parity, FIX1) | Trip + experience checkout (OQ-1) | trip/experience w/ portrait cover | identical 120pt band | Component |
| T5 (happy, FIX2) | Public event video hero | `/e/{b}/{e}` video cover | pill right edge == chrome right edge (both 16px from hero edge) | Component / measured |
| T6 (regression, FIX2) | List/deck/grid cards | any video cover card | still `videoContentFit:"cover"` crop-to-fill; hero still aspect-adaptive | Component |
| T7 (style assertion) | `audioControlBottomRight` | StyleSheet | `right === 16 && bottom === 22` | unit (jest StyleSheet introspection) |
| T8 (gate) | strict-grep 0978 | CI | PASS unchanged | CI |

**Adversarial angles for the tester:**
- A **square** (1080×1080) cover at 120pt — still cover-cropped; confirm it doesn't look broken.
- Very long event name (2 lines, `numberOfLines={2}`) under the taller band — confirm the card vertical rhythm + `bottomBar` clearance (`paddingBottom: insets.bottom + 140`) still scrolls clear; no overlap with "Select your tickets".
- FIX 2 on the **narrowest** supported phone width — confirm the pill at `right:16` with a long "Sound"/"Mute" label never clips the hero's right edge.
- Confirm FIX 2 did **not** accidentally shift `topLeft`/`topRight` pills (still `14`).
- Confirm the event-page hero (adaptive, `onAspectRatio`) did NOT inherit a 120pt fixed height from anywhere (it must not).

---

## 8. Implementation order

1. **FIX 2 (shared):** edit `packages/event-rendering/EventCoverMedia.tsx` `audioControlBottomRight.right` `14 → 16` + comment.
2. **FIX 1 (event):** edit `mingla-business/app/checkout/[eventId]/index.tsx` `miniCover.height` `64 → 120` + comment.
3. **FIX 1 (trip + experience), if OQ-1 greenlit:** apply identical `height 64 → 120` to `checkout-trip/[tripEventId]/index.tsx` and `checkout-experience/[experienceEventId]/index.tsx`.
4. Run gates: `node .github/scripts/strict-grep/orch-0978-video-autoplay-muted-contract.mjs`; typecheck `mingla-business` + package; the FIX-1 jest (if added) + T7 style assertion.
5. Web repro both fixes (buyer web checkout + public event page) per Mingla live-fire policy; capture before/after into `Mingla_Artifacts/evidence/ORCH-1131/`.

---

## 9. Regression prevention (fails-on-revert contract)

- **FIX 2 — style-introspection unit test** (`audioControlBottomRight` flattened style): assert `right === 16 && bottom === 22`. Must FAIL if reverted to `right:14` and PASS at `16`. Protective comment cites ORCH-1131 (align-to-chrome) + ORCH-1128 (bottom:22) so a future editor knows both values are load-bearing.
- **FIX 1 — style-introspection unit test** on the event checkout `miniCover`: assert `height === 120`. Must FAIL at `64`. (If OQ-1 greenlit, extend the assertion across all three checkout `miniCover` styles so a future copy-paste can't regress one surface.)
- **Structural safeguard against the broader bug class:** the protective comment in each `miniCover` block names the portrait-video crop cause, so a maintainer doesn't "tidy" the height back down. No new strict-grep gate proposed (a jest style assertion is sufficient and cheaper for a value-only contract).

---

## 10. Open questions

- **OQ-1 (scope, recommend YES):** Apply the FIX-1 height change to the **trip** and **experience** checkout mini-cards too? They are the same bug (byte-identical `miniCover{height:64}`), same fix, zero added risk, and a real buyer path. The dispatch named only the event checkout and capped scope at "exactly two fixes." Forensics reads FIX 1 as the *concept* "checkout mini-card cover crop" (one of the two fixes), of which there are three instances. **Recommendation: apply to all three.** Defaulting to event-only ships a knowingly-partial fix. Awaiting Seth/orchestrator confirmation; this is the only scope decision in the ORCH.
- **OQ-2 (none blocking):** No other open questions. 120pt and right:16 are repro-justified; no design ambiguity.

---

## 11. Downstream routing

- **Next = mingla-implementor (business side):** execute §8 in the worktree `~/Desktop/mingla-orchs/ORCH-1131-[cover-crop-sound-inset]/` on branch `ORCH-1131-cover-crop-sound-inset`. Allowlist below. Resolve OQ-1 before deciding whether step 3 runs (default: run it).
- **Then = mingla-tester:** verify SC-1..SC-6 with web live-fire on buyer checkout + public event page; confirm the 0978 gate + style assertions; adversarial angles in §7.
- **Then = mingla-orchestrator CLOSE.**

### Scoped allowlist (implementor MAY edit)
- `packages/event-rendering/EventCoverMedia.tsx` — `audioControlBottomRight.right` only.
- `mingla-business/app/checkout/[eventId]/index.tsx` — `styles.miniCover.height` only.
- `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` — `styles.miniCover.height` only (OQ-1).
- `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx` — `styles.miniCover.height` only (OQ-1).
- New test file(s) for §9 assertions.

### DO-NOT-TOUCH
- `EventCoverMedia.tsx` everything except the one `right` value (no `videoContentFit` default, no `resizeMode`, no muted/autoplay, no `audioControlTopLeft/TopRight`, no `bottom:22`).
- `packages/event-rendering/PublicEventPage.tsx` (hero is already aspect-adaptive — leave it).
- `CreatorStep7Preview.tsx` `miniCover` (authoring preview, plain `<View>`, different path).
- Any list/grid/deck card cover usage; any DB/RLS/edge/service/hook.
- Stop-and-amend (request a SPEC amendment) before touching anything outside the allowlist.

---

## Appendix — Repro evidence

- **Harness:** `Mingla_Artifacts/evidence/ORCH-1131/repro.html` (faithful replica of the web render: `EventCoverMedia` web output = container `overflow:hidden` + media `absoluteFill` `objectFit:cover`; portrait 1080×1920 stand-in frame — cover math identical for `<img>`/`<video>`). Driven by Playwright `shoot.cjs` (chromium, DPR 2).
- **`01-repro-full.png`:** side-by-side of FIX-1 variants (current 64 = sliver; A 16:9 ≈192pt = too tall; **C 120pt = chosen**; B 96 contain = black bars/broken) and FIX-2 (right:16 aligned vs right:14 protruding past the chrome guide).
- **`02-fix1-current-crop.png`:** close-up of the current 64pt sliver.
- **Measured (FIX 2):** `chromeRightGap = 16`, `pillRightGap (current) = 14` → pill sits 2px closer to the edge than the chrome. Confirms the misalignment.
- **Confidence:** **confirmed (proven)** for both root causes — geometry is deterministic and reproduced/measured on the actual web render path. (Not booted through the full authenticated buyer funnel, which adds no information for a pure layout/CSS contract; the render primitives are identical.)
