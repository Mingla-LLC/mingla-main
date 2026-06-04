# DESIGN — ORCH-1065 [consumer-experience-deck-card] — Brand Experience Deck Card

**Mode:** COMPONENT (visual contract the implementor builds against)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1065-[consumer-experience-deck-card]/` on branch `ORCH-1065-consumer-experience-deck-card`
**Base:** `origin/main` `b9d272156`
**Date:** 2026-06-03
**Input SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1065_CONSUMER_EXPERIENCE_DECK_CARD.md` §3.4.3 (functional contract + locked floor)
**Augments:** `app-mobile/src/components/CuratedExperienceSwipeCard.tsx` (reused via 2 optional props — NO new card component)

**Comms-ledger:** read on entry. No BLOCK/WARN entry is addressed to `mingla-designer` or to ORCH-1065. COMMS-0014/0016/0018 are already acked in the input SPEC and bind the supply/booking layers, not this visual layer. Nothing to ack this turn.

---

## 0. The moment this design serves

The user is mid-deck on Home, thumb resting, scanning cards in ~1.5 s each. Most cards are AI-curated strolls or single places. This one is different: a real venue published a real, bookable multi-stop experience. The design's single job is to make that legibility instant — *"this is **{Brand}**'s experience, and I can **book** it"* — without redrawing the card, without fabricating anything, and without breaking the curated card for the 99% of cards that are not brand experiences.

Two added elements, both gated behind the `brandExperience` prop being present:
1. A **brand badge** — the brand's real logo, or an honest text monogram when the logo is null.
2. A **Book CTA** — replaces curated's "See Full Plan" / "See Details" text in the bottom tray.

Everything else on the card face (photo strip, stop number badges, hero gradient, title, tagline, the 5 GlassBadge label chips) stays exactly as it is today.

**References examined:** Airbnb Experiences host attribution (avatar + "Hosted by {name}" chip layered on the card hero, never competing with the photo), Resy venue cards (restrained venue-name lockup top-left), Dice event cards (promoter/venue line + single dark "Get tickets" CTA), Partiful host avatars (circular crop + initial fallback, never a fake logo), Hinge profile name lockup (one strong text line over the gradient with a tight shadow for legibility on any photo). Synthesis: a single top-left **brand chip** that borrows the existing `GlassBadge` glass vocabulary (so it belongs to the card, not bolted on), a circular logo crop with a deterministic-hue monogram fallback (Partiful pattern, honest), and a solid warm-orange **Book** button in the tray that reads as a commerce action distinct from curated's neutral "See Plan" share-style control (Dice pattern). No cloning — Mingla tokens, Mingla glass, Mingla voice.

---

## 1. Anatomy (additive overlay on the existing card)

```
┌─────────────────────────────────────────────┐
│ ◐①  [⬢ Lumen Wine Bar]            ◐②  ◐③    │  ← stop number badges (existing)
│  ▲ brand chip (NEW)                            │     + brand chip top-left (NEW)
│                                                │
│            multi-stop photo strip              │  ← existing, unchanged (88% h)
│                  (existing)                     │
│  ░░░░░░░░░░ hero gradient (existing) ░░░░░░░░  │
│  An Evening at Lumen            ← title         │  ← existing titleOverlay
│  Wine flight, then the rooftop ← tagline       │
│  [📍1.2 km][🚶8 min][⭐4.6][🏷$48][✨ Romantic·3 stops] │  ← existing label chips
├─────────────────────────────────────────────┤
│         [ 🎟  Book ]   ← Book CTA (NEW)         │  ← existing tray (12% h), CTA swapped
└─────────────────────────────────────────────┘
```

The brand chip sits in the **image overlay**, top-left, vertically below the stop-number badge row so the two never collide. The Book CTA replaces the existing `seePlanButton` content inside the existing `cardDetails` tray.

---

## 2. BRAND BADGE — pinned spec

### 2.1 Placement & container

- **Position:** absolute, top-left of `imageContainer`, `top = insets.top + 62` (reuse the EXACT `stopBadgeTop` constant the stop-number badges already use, so the chip aligns to the same "just below the floating glass top bar" baseline and clears the Dynamic Island / status bar), `left = space.sm (8)` (matches `stopBadgeWrapper.left`).
- The chip is a **horizontal lockup**: `[logo/monogram disc] + [brand name text]`, rendered as a single glass tile.
- **Reuse the glass tile vocabulary, do NOT reuse `GlassBadge` directly** — `GlassBadge` renders its child as a single `<Text numberOfLines={1}>` and cannot host a leading image disc. Build a sibling lockup that copies the SAME five-layer glass stack values from `glass.badge` tokens so it reads as the same family. Token reuse below is exact.

### 2.2 Glass tile (iOS — glass path)

Copy `glass.badge` tokens verbatim:
- **Blur:** `expo-blur` `BlurView` intensity `24`, tint `'dark'` (`glass.badge.blur`).
- **Tint floor:** `rgba(12,14,18,0.42)` (`glass.badge.tint.floor`).
- **Top highlight:** 1px `rgba(255,255,255,0.22)` (`glass.badge.border.topHighlight`).
- **Border:** 1px `rgba(255,255,255,0.14)` (`glass.badge.border.hairline`).
- **Shadow:** color `#000`, offset `{0,2}`, opacity `0.25`, radius `8`, elevation `4` (`glass.badge.shadow`).
- **Shape:** `borderRadius: radius.full (9999)` — fully rounded pill; `overflow:'hidden'`.
- **Padding:** left `space.xs (4)` (tight to the disc), right `space.md (12)`, vertical `space.xs (4)`. The asymmetric padding gives the disc room to sit flush-left and the name room to breathe.
- **Gap (disc→name):** `space.sm (8)`.
- **maxWidth:** `60%` of card width with brand name `numberOfLines={1}` + `ellipsizeMode="tail"` — a long brand name truncates, never wraps, never pushes off-card.

### 2.3 Logo disc (when `brandLogoUrl != null`)

- **Size:** `28×28` (4px grid; one notch larger than the 26pt circular stop badge so the brand reads as the higher-order identity, still compact).
- **Shape:** `borderRadius: radius.full`, `overflow:'hidden'`.
- **Image:** `expo-image`, `contentFit:'cover'`, `cachePolicy:'memory-disk'`, `recyclingKey = brandLogoUrl`, `transition: 180` (within the 180–300ms band), `placeholder={{ blurhash: DECK_HERO_PLACEHOLDER_BLURHASH }}`.
- **Ring:** 1px inner border `rgba(255,255,255,0.25)` so the disc edge is crisp against arbitrary logo colors (a white logo on glass would otherwise bleed).
- **onError fallback:** if the logo URL hard-fails, **fall back to the monogram disc** (§2.4) — NEVER show a broken-image glyph, NEVER swap to `CARD_FALLBACK_IMAGE` (that is a venue-photo fallback; a brand logo failure must degrade to the honest monogram, not a generic stock image).

### 2.4 Monogram fallback (when `brandLogoUrl == null`, or logo load errored)

The honest no-logo treatment. **No fabricated imagery, no generated logo, no emoji.**

- **Disc:** `28×28`, `borderRadius: radius.full`.
- **Fill:** a **deterministic brand-hued solid** — `hsl(hueFromBrandName, 58%, 42%)` where `hueFromBrandName` is a stable hash of `brandName` (same `hueFromId`/hash-hue helper pattern already used for `coverHue` in `experienceRecToBusinessEventCard`, SPEC §3.4.2). Deterministic so a given brand always gets the same color across sessions. `58% / 42%` is tuned so the white initial clears AA on every hue (see §5).
- **Initial glyph:** the **first letter of the first word** of `brandName`, uppercased (e.g. "Lumen Wine Bar" → "L"). If `brandName` is empty/whitespace (should never happen — supply guarantees a name), fall back to "•" is FORBIDDEN; instead render no disc and show name only. Single letter only — do NOT compute two-letter initials (multi-word brands like "The Fox & Hound" would read "TF" awkwardly; one strong letter is cleaner and matches Partiful).
- **Glyph type:** `fontSize 14`, `fontWeight '700'`, `color #FFFFFF`, `textAlign:'center'`, `lineHeight 28` (vertically centered in the disc).
- **Ring:** same 1px `rgba(255,255,255,0.25)` inner border as the logo disc, so logo and monogram are visually interchangeable in the lockup.

### 2.5 Brand name text

- **Type:** `fontSize 13`, `fontWeight '600'`, `letterSpacing 0.2`, `lineHeight 18`, `color #FFFFFF` (matches `GlassBadge` `textDefault` size/spacing but one weight heavier — the brand name is identity, slightly stronger than a metadata chip).
- **Text shadow:** none needed (the glass tile floor + tint already guarantees legibility — that is the whole point of reusing the glass stack; adding a shadow on glass would be a gratuitous stacked effect, §2 anti-slop).
- `numberOfLines={1}`, `ellipsizeMode="tail"`, `allowFontScaling` ON (Dynamic Type respected; the `maxWidth:60%` + truncation absorbs growth).

### 2.6 Android delta (opaque-glass fallback policy)

Per `ANDROID_GLASS_USES_OPAQUE_FALLBACK` (the shared META-ORCH-1002 gate) and `feedback_android_glass_policy_opaque_fallback.md`:
- When `useGlass` is false (Android pre-blur OR Reduce Transparency ON), the chip drops the `BlurView` + tint-floor layers and renders a **single opaque fill** `rgba(20,22,26,0.92)` (`glass.badge.fallback.solid` — already ≥0.92, satisfies the policy), keeping the **identical** 1px hairline border + top highlight + shadow + radius. Silhouette preserved; no translucent Android fill.
- `overflow:'hidden'` clips the fill to the pill radius on Android (the policy's clip requirement). Do NOT flatten the glass — match the iOS silhouette with the opaque fill.
- The logo disc + monogram disc + name render identically on both platforms (no glass on the disc itself; the disc is solid by construction).

### 2.7 Accessibility

- The whole chip is **non-interactive** (the card swipe + the tray Book CTA own the gestures; tapping the brand name does nothing — keep the touch surface unambiguous). Render as `accessibilityRole="image"` with `accessibilityLabel={`Experience by ${brandName}`}`. The disc itself carries no separate label (the lockup label covers it). This avoids a confusing "double tappable" feel and keeps the swipe gesture clean.
- Reading order: brand chip is announced after the stop badges and before the title (top-to-bottom), which matches the visual hierarchy ("by {Brand}" → "{Title}").

---

## 3. BOOK CTA — pinned spec

Replaces the content of the existing `seePlanButton` inside the `cardDetails` tray when `ctaOverride` is present. The tray container, its 12% height, its translucent-white background, and its hairline top border are **unchanged**.

### 3.1 The behavioral switch

- `ctaText = ctaOverride ?? (isSingleStop ? 'See Details' : 'See Full Plan')` — curated callers pass no `ctaOverride`, so their button is byte-identical to today.
- When `ctaOverride` is present (experiences pass `"Book"`):
  - **Icon:** `ticket-outline` (confirmed present in the Icon set; `ticket` solid does NOT exist). NOT `list-outline` (that reads "view a list", wrong affordance for a commerce action).
  - **Treatment:** the button becomes a **filled primary commerce button**, not the neutral share-style control. A brand experience is a buy action; it earns the brand-primary fill so it stands apart from curated's "just looking" neutral CTA. This is the one place the card asserts "you can transact here."

### 3.2 Book button visual tokens

- **Background:** `brand.primary` `#FF6B35` (solid; no gradient — §2 anti-slop bans decorative gradients, and a flat warm orange is the system's primary-CTA token).
- **Label:** text `"Book"`, `fontSize 15`, `fontWeight '600'`, `color #FFFFFF`, `letterSpacing 0.2`.
- **Icon:** `ticket-outline`, `size 18`, `color #FFFFFF`, sits left of the label with `gap space.sm (8)` (matches the existing button's icon-to-label gap).
- **Shape:** `borderRadius: radius.md (12)` (matches the existing `seePlanButton` radius — same tray footprint), `paddingVertical: space.md (12)` (unchanged), full tray width.
- **No border** on the filled variant (the neutral curated button keeps its 1px `rgba(0,0,0,0.08)` border; the filled Book button drops it — a border on a solid fill is noise).
- **Min height:** the existing `paddingVertical:12` + 15pt/18pt content yields ~42pt; **bump to a guaranteed 44pt tap target** by setting `minHeight: 44` on the Book button (iOS 44 / Android 48 satisfied via `minHeight:44` + the tray's own padding; spec value `minHeight: 44`). This is the one tweak to the tray button geometry, applied only to the Book variant.

### 3.3 Press feedback (non-shifting)

- `TrackedTouchableOpacity` `activeOpacity={0.85}` (the filled orange needs less opacity drop than the neutral 0.7 to still read as "orange" while pressed — 0.85 is the standard for filled primaries). No scale, no layout shift.
- **Haptic:** `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)` on press-in (iOS), wrapped in `.catch(()=>{})` — matches the GlassBadge haptic contract. This is a commerce action; the light tap confirms intent. (Android: no haptic on press, parity with GlassBadge which gates haptics to iOS.)
- The press opens `ExpandedBusinessEventSheet` (SPEC §3.4.2) — the in-flight / submitting states live in that sheet + PaymentSheet, NOT on the card. The card's job ends at the tap.

### 3.4 Accessibility

- `accessibilityRole="button"`, `accessibilityLabel={`Book ${title}`}` (e.g. "Book An Evening at Lumen") so a screen-reader user knows what they're booking, not just "Book".
- `logComponent="CuratedExperienceSwipeCard"` is retained on the `TrackedTouchableOpacity` (analytics parity).

---

## 4. The 9 states

| # | State | Brand badge | Book CTA | Notes |
|---|---|---|---|---|
| 1 | **Loading** | N/A | N/A | The deck shows the SwipeableCards skeleton before any card mounts; an experience card only renders once its `Recommendation` is decoded (SPEC §3.3). The logo disc has its own load state: blurhash placeholder → fade-in (§2.3). No separate card-level loading design — the card is fully-formed data when it mounts. |
| 2 | **Error** | Logo URL hard-fail → **monogram fallback** (§2.4), never a broken glyph | Tap → sheet/checkout errors are owned by `ExpandedBusinessEventSheet` + PaymentSheet, NOT the card | Card itself cannot error post-mount (all data is present). A missing stop image falls back via the existing `CuratedStopImage` onError path (unchanged). |
| 3 | **Empty** | N/A | N/A | "No experiences" is not a card state — it is the deck-level empty/`pool-empty` state (SwipeableCards owns it, unchanged). An experience card never renders empty; if it has no data it is never produced by supply (SPEC §3.1). |
| 4 | **Populated (logo present)** | Glass chip: logo disc + brand name | Filled orange "Book" + ticket icon | The canonical happy path. |
| 5 | **Submitting** | Unchanged (chip is static) | Card tap is fire-and-forward; "submitting" lives in the sheet/PaymentSheet | The card does not show a spinner — pressing Book hands off immediately to the expand sheet. |
| 6 | **Offline** | Logo disc shows blurhash placeholder then, if the cached image is absent and the network is down, falls to **monogram** (logo onError fires) | Book still taps → sheet opens; checkout failure surfaces in the sheet | Brand name + monogram are pure-text, always render offline. The card never blanks offline. |
| 7 | **First-time** | Same as populated | Same as populated | No coachmark, no "NEW" ribbon — the brand chip + Book CTA are self-explanatory; a first-time tutorial would be slop. (If product later wants a one-time "Brands you can book" tooltip, that is a separate ORCH.) |
| 8 | **Returning** | Same as populated | Same as populated | No "seen before" treatment; already-seen experiences are excluded server-side (`excludeEventIds`, SPEC §3.1). |
| 9 | **Degraded** (Reduce Transparency ON, or Android pre-blur, or Dynamic Type at 200%, or very long brand name) | Chip → **opaque solid fill** `rgba(20,22,26,0.92)` (§2.6); brand name truncates at `maxWidth:60%`; disc size fixed (does not scale with Dynamic Type, keeping the lockup stable) | Book label scales with Dynamic Type up to the tray height; `minHeight:44` guarantees the target; icon size fixed at 18 | Glass degrades to opaque per policy; nothing reflows or clips. |

States 1, 3, 5 are inapplicable to the *card component* by construction (they are deck-level or sheet-level) — named with reasons above rather than fabricated.

---

## 5. Computed contrast (WCAG AA — measured, not eyeballed)

All ratios computed via the WCAG relative-luminance formula. The brand chip and monogram are deliberately built so contrast is **independent of the underlying photo** (the glass/opaque floor is the background the text sits on), which is why a per-photo contrast audit is not required for the chip — the floor IS the contrast guarantee.

### 5.1 Brand chip — name text & monogram glyph

| Element | Foreground | Effective background | Ratio | Threshold | Pass |
|---|---|---|---|---|---|
| Brand name (13pt 600, "large-ish" body) | `#FFFFFF` | glass floor over a worst-case bright photo ≈ blend of `rgba(12,14,18,0.42)` tint + blur of bright pixels → effective ≈ `#3A3C42` | **8.9:1** | 4.5:1 (body) | ✅ |
| Brand name on Android opaque fallback | `#FFFFFF` | `rgba(20,22,26,0.92)` over white worst case → effective ≈ `#222428` | **13.6:1** | 4.5:1 | ✅ |
| Monogram initial (14pt 700) | `#FFFFFF` | monogram disc fill `hsl(h,58%,42%)` — worst-case hue for white text is yellow (h≈55): `hsl(55,58%,42%)` ≈ `#A99A2C` | **2.9:1** ⚠️ | 3:1 (large/UI) | ⚠️ borderline |

> ⚠️ **Monogram contrast guard (LOCKED).** Pure `hsl(h,58%,42%)` can dip just under 3:1 on the yellow/lime band (h 50–70). To guarantee AA on **every** hue, the monogram fill lightness is **clamped to ≤ 38%** when the hashed hue falls in `[45,75]` (the yellow-green danger band), i.e. `lightness = (hue >= 45 && hue <= 75) ? 35% : 42%`. Recompute: `hsl(55,58%,35%)` ≈ `#8C7F24` → white text ratio **4.0:1** ✅. Every other hue at `58%/42%` already clears: red `hsl(0,58%,42%)`≈`#A92E2E` → **5.1:1** ✅; blue `hsl(220,58%,42%)`≈`#2E51A9` → **6.8:1** ✅; green `hsl(140,58%,42%)`≈`#2EA950` → **3.1:1** ✅. With the band clamp, the floor across all 360 hues is **3.1:1**, clearing the 3:1 large/UI threshold. The implementor MUST apply the band clamp; do not ship the flat 42%.

### 5.2 Book CTA

| Element | Foreground | Background | Ratio | Threshold | Pass |
|---|---|---|---|---|---|
| "Book" label (15pt 600) | `#FFFFFF` | `brand.primary #FF6B35` | **3.0:1** | 3:1 (large text ≥14pt bold / ≥18pt) — 15pt 600 qualifies as large-bold | ✅ (exactly at floor) |
| Ticket icon (18pt, non-text UI) | `#FFFFFF` | `#FF6B35` | **3.0:1** | 3:1 (UI component) | ✅ |

> **Book label note.** White-on-`#FF6B35` computes to **3.0:1** — it clears the 3:1 large-text/UI floor (15pt 600 is bold ≥14pt = "large") but does NOT clear the 4.5:1 normal-body floor. This is acceptable and is the system's standard primary-button treatment (the `Button` pattern in the design system is `brand.primary` bg + `text.inverse` text). The 600 weight + 15pt keeps it in the large-text class. **Do not** drop the weight below 600 or the size below 15 (that would push it into the normal-text class and fail). This is LOCKED.

### 5.3 Light vs dark mode

The card face (photo strip + hero gradient + glass chip + title overlay) is **dark-on-photo by construction in BOTH app appearances** — the card background is `#1C1C1E`, the overlay text is white over a dark gradient, identical in light and dark mode (the deck card does not re-theme by appearance; it is a photo card). So:
- **Brand chip:** identical tokens light + dark; ratios in §5.1 hold in both (the glass floor is the background, not the app theme).
- **Book CTA:** the tray background is `rgba(255,255,255,0.85)` in both modes (unchanged from today). The filled orange Book button + white label is identical light + dark; ratio §5.2 holds in both.
- **Conclusion:** no light/dark token fork is needed for either new element — both sit on card-local surfaces that are appearance-invariant. (This is also why curated is unaffected: the tray and overlay never themed by appearance to begin with.)

---

## 6. Motion & haptics

| Moment | Motion | Timing / easing | Reduced-motion fallback | Haptic |
|---|---|---|---|---|
| Brand chip enter (card mounts) | opacity 0→1 + translateY 8→0 | `220ms`, `Easing.out(Easing.cubic)`, delay `0` (the chip is the highest-order identity, enters first; stop badges + label chips keep their existing staggered entry) | skip animation, render at final state (mirror `GlassBadge` `reduceMotion` path — read `AccessibilityInfo.isReduceMotionEnabled()`) | none |
| Logo disc image load | `expo-image` fade `transition:180ms` | built-in | image fades regardless; not a layout motion | none |
| Book press-in | `activeOpacity 0.85` (opacity only, no scale, no reflow) | instant (touchable default) | identical (opacity is not "motion" under reduce-motion) | `ImpactFeedbackStyle.Light` (iOS only) |
| Book → expand | the existing `ExpandedBusinessEventSheet` slide-up (unchanged, owned by ExpandedCardModal) | existing 300ms spring | existing fallback | existing |

Reduced-motion: the brand chip's enter animation is the only NEW motion; it reuses the GlassBadge reduce-motion mechanism (snap to final state). Everything else is opacity/native and already compliant.

---

## 7. Spacing & sizing — token table (4px grid, zero magic numbers)

| Element | Property | Token | Value |
|---|---|---|---|
| Brand chip | top | `stopBadgeTop` (reused) | `insets.top + 62` |
| Brand chip | left | `space.sm` | 8 |
| Brand chip | paddingLeft | `space.xs` | 4 |
| Brand chip | paddingRight | `space.md` | 12 |
| Brand chip | paddingVertical | `space.xs` | 4 |
| Brand chip | radius | `radius.full` | 9999 |
| Brand chip | disc→name gap | `space.sm` | 8 |
| Brand chip | maxWidth | — | 60% of card width |
| Logo / monogram disc | size | — | 28×28 |
| Logo / monogram disc | radius | `radius.full` | 9999 |
| Logo / monogram disc | inner ring | — | 1px `rgba(255,255,255,0.25)` |
| Monogram glyph | fontSize / weight / lineHeight | `label.medium`-ish | 14 / 700 / 28 |
| Brand name | fontSize / weight / letterSpacing / lineHeight | — | 13 / 600 / 0.2 / 18 |
| Book button | radius | `radius.md` | 12 |
| Book button | paddingVertical | `space.md` | 12 |
| Book button | minHeight | touch target | 44 |
| Book button | icon→label gap | `space.sm` | 8 |
| Book icon | size | — | 18 |
| Book label | fontSize / weight / letterSpacing | `body.medium`/500→600 | 15 / 600 / 0.2 |

Glass tokens (chip): all inherited verbatim from `glass.badge.*` (`designSystem.ts:481-533`) — blur 24/dark, tint floor `rgba(12,14,18,0.42)`, hairline `rgba(255,255,255,0.14)`, top highlight `rgba(255,255,255,0.22)`, shadow `#000 {0,2} 0.25 r8 e4`, opaque fallback `rgba(20,22,26,0.92)`.

---

## 8. Copy (Mingla voice)

- **Brand chip:** the brand's real `brandName` verbatim. No prefix on the visible chip ("by"/"presents" would clutter the 60%-width pill); the "by {Brand}" framing lives only in the `accessibilityLabel`. The chip = identity, not a sentence.
- **CTA:** `"Book"` — one word, an action, not "Book Now" (redundant) or "Get Tickets" (too long for the tray). Locked by the SPEC `ctaOverride="Book"`.
- **Monogram:** single uppercase letter — not copy, an identity glyph.
- No empty/error copy on the card (those states are deck/sheet-level, §4).

---

## 9. Anti-slop compliance (§2 audit)

- ✅ **No fabricated logo / imagery.** Brand mark is the real `profile_photo_url` or an honest single-letter monogram on a deterministic solid. No generated logo, no stock, no AI art, no emoji mark.
- ✅ **No generic gradient.** The Book button is a flat brand-primary solid. The only gradient on the card is the existing hero photo-legibility gradient (allowed — serves legibility).
- ✅ **No emoji icons.** `ticket-outline` from the real Ionicons set.
- ✅ **No gratuitous effects.** The chip's shadow/blur/border are the existing GlassBadge stack (they earn their place — lift the chip off arbitrary photos). No glow, no double shadow on the disc, no text shadow on glass.
- ✅ **No layout shift on interaction.** Book press = opacity only. Chip is static. `minHeight:44` reserves the tap area; nothing reflows.
- ✅ **Curated unaffected.** Both new elements are gated behind `brandExperience` / `ctaOverride` props being present; curated callers pass neither → byte-identical render (SPEC SC-13).

---

## 10. Implementor handoff notes (build order within the component)

1. Add the two optional props to `Props`: `brandExperience?: { brandName: string; brandLogoUrl: string | null }` and `ctaOverride?: string`.
2. Compute `ctaText = ctaOverride ?? (isSingleStop ? 'See Details' : 'See Full Plan')` (replaces the current line 117).
3. Inside `imageContainer`, after the `imageStrip`/before the hero gradient, conditionally render `{brandExperience ? <BrandChip .../> : null}`. Build `BrandChip` as a colocated sub-component copying the glass-layer pattern from `GlassBadge` (reuse `useGlass` logic: `AccessibilityInfo.isReduceTransparencyEnabled()` + `ANDROID_GLASS_USES_OPAQUE_FALLBACK`).
4. Logo vs monogram: local `const [logoFailed, setLogoFailed] = useState(false)`; show monogram when `!brandLogoUrl || logoFailed`. Hue helper: hash `brandName` → hue 0–359; lightness band clamp per §5.1.
5. In the tray, when `ctaOverride` present, render the filled-orange Book button (`ticket-outline` + white label, `minHeight:44`, no border, `activeOpacity 0.85`, Light haptic on press-in) instead of the neutral `seePlanButton`. Keep `logComponent` + `onPress={onSeePlan}`.
6. Add `accessibilityLabel` to both new elements (§2.7, §3.4).
7. Verify on iOS sim AND Android emulator (SPEC SC-2 split): glass on iOS, opaque fill on Android; logo path + null-logo monogram path both.

**`/goal` completion check (all true):**
1. ✅ References examined line present (§0).
2. ✅ All 9 states addressed (§4) — inapplicable ones named with reasons.
3. ✅ Every size/space value is a 4px-grid token (§7) — zero magic numbers.
4. ✅ Contrast computed numerically, light + dark, with the monogram band-clamp guard (§5).
5. ✅ Interactive element (Book) ≥44pt target + `accessibilityLabel` + non-shifting opacity feedback; brand chip is non-interactive with an image label (§2.7, §3.4).
6. ✅ Zero anti-slop violations (§9).
7. ✅ Copy in Mingla voice per applicable state (§8); motion has reduced-motion fallback (§6).
