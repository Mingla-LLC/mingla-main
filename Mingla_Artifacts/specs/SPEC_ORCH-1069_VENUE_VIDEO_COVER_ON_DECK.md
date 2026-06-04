# SPEC — ORCH-1069 [Place/venue video covers render on the consumer deck card + gallery]

**Status:** REGISTERED — SPEC ready, awaiting IMPLEMENT dispatch (Claude `mingla-implementor`).
**Severity:** S2-medium / `feature-gap` (a real venue video cover is uploaded + stored but never plays for the consumer).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1069-[venue-video-cover-on-deck]/` on branch `ORCH-1069-venue-video-cover-on-deck`.
**Builds on:** ORCH-1068 (image-hero picker — CLOSED, ships the first-non-video still as `image` and keeps the full ordered `images`), ORCH-0978/0994/0992 (the shared video-capable `EventCoverMedia`), COMMS-0007 (RESOLVED — `EventCoverMedia`/`EventCover` live in `@mingla/event-rendering`; `expo-video` added to app-mobile).
**Directly closes:** ORCH-1068 OQ-2 ("image-hero now, deck cover-video player a future ORCH").

---

## 0. Layman summary

A business venue (e.g. **Lantern & Vine**) can upload a VIDEO cover (a Cloudinary `.mp4`). Event and trip cards already PLAY their video covers on the consumer side via a shared renderer. Place/venue cards do not — the deck swipe card and the expanded-card photo gallery are still-image-only, so a venue's video either can't play or shows blank. ORCH-1068 made the still-image hero show the venue's first real photo instead of a broken video frame. ORCH-1069 finishes the job: wire the existing, video-capable `EventCoverMedia` renderer into (a) the venue deck swipe card hero and (b) the expanded-card gallery so the venue's video plays (muted autoplay), with ORCH-1068's first still as the poster/fallback. Still-photo venues keep rendering exactly as before. App-only, ships via EAS OTA — no backend deploy, no new native module.

---

## 1. Scope

**IN scope (app-mobile only):**

1. **Deck swipe card hero** — `app-mobile/src/components/SwipeableCards.tsx`. When the active (top) card and the one immediately behind it have a detectable video cover, render `EventCoverMedia` (muted-autoplay video, `image` still as poster/fallback) in place of `CardHeroImage`. Otherwise keep `CardHeroImage` (still image) exactly as today.
2. **Expanded-card gallery** — `app-mobile/src/components/expandedCard/ImageGallery.tsx`. Detect `.mp4`/video entries in the `images` array and render them via `EventCoverMedia` (video); keep image entries on the existing `<Image>`.
3. **Video detection helper** — a single shared app-side predicate (mirrors the edge function's `isVideoUrl`) so both surfaces agree on what counts as a video URL.

**OUT of scope (non-goals, with reason):**

- **No backend change.** The data path is already sufficient (see §3) — `discover-cards` already keeps the `.mp4` in `images`. Touching `discover-cards` to add a `coverVideoUrl` field is explicitly avoided; if any reviewer believes it is needed, that is a SPEC defect to raise BEFORE implement, not a silent addition.
- **No new video player.** Reuse `EventCoverMedia` from `@mingla/event-rendering`. Do NOT build a parallel player, do NOT add `expo-video` call sites directly in app-mobile components.
- **No audio control on the deck card.** Deck/grid video covers are ambient (muted, looping, no sound toggle) — matching `BusinessEventCard`'s grid treatment. The gallery MAY show the audio control (see §6, OPEN).
- **Event/trip cards untouched** — they already play video covers; this spec does not modify `BusinessEventCard.tsx` or `TripCard.tsx`.
- **Curated / experience swipe cards untouched** — `CuratedExperienceSwipeCard` has its own multi-stop FACE and is not a single-venue place card.
- **No change to ORCH-1068's image-hero picker** — the first non-video still remains the poster/fallback. This spec consumes it, never alters it.

**Assumptions (proven in §3, not guessed):**
- A venue video cover survives in `Recommendation.images` as a `.mp4` (or Cloudinary `/video/upload/`) URL. PROVEN.
- `Recommendation.image` is the first non-video still (poster). PROVEN.
- `expo-video` is in the app-mobile build. PROVEN (`app-mobile/package.json` `"expo-video": "~3.0.16"`).
- `@mingla/event-rendering` resolves in app-mobile. PROVEN (`tsconfig.json` paths + `metro.config.js` alias; `BusinessEventCard.tsx`/`TripCard.tsx` already import `EventCoverMedia` from it inside app-mobile).

---

## 2. Investigation summary (evidence the spec rests on)

### 2.1 EventCoverMedia API (the integration contract source)
`packages/event-rendering/EventCoverMedia.tsx` (read in full). Relevant props:

| Prop | Type | Default | Use here |
|------|------|---------|----------|
| `hue` | `number` | `25` | Fallback hue-band color when media fails/absent. Pass the card's hue if available, else default. |
| `mediaUrl` | `string \| null` | `null` | The cover media URL (the `.mp4` on the video path; ignored on the still path). |
| `mediaType` | `"image" \| "video" \| "gif" \| null` | `null` | **Explicit** — there is NO URL auto-detection inside the renderer (see 2.2). Pass `"video"`. |
| `radius` | `number` | `16` | Corner radius to match the card clip. |
| `label` | `string` | `"Cover"` | Accessibility/fallback label — pass the venue title. |
| `videoContentFit` | `"cover" \| "contain"` | `"cover"` | `"cover"` (crop-to-fill) for the deck card + gallery. |
| `autoplay` | `boolean` | `true` | `true` for visible cards. |
| `playbackActive` | `boolean` | `true` | Gate playback to the visible card (see perf guard §5). |
| `muted` | `boolean` | `true` | `true` (ambient, no sound on deck). |
| `loop` | `boolean` | `true` | `true`. |
| `showAudioControl` | `boolean` | `false` | `false` on the deck card; OPEN for the gallery. |
| `style` | `StyleProp<ViewStyle>` | — | `StyleSheet.absoluteFill` to fill the hero box. |

**Reference call site (event grid card), `app-mobile/src/components/discover/BusinessEventCard.tsx:137-145`:**
```tsx
<View style={styles.heroFill} pointerEvents="none">
  <EventCoverMedia
    hue={data.coverHue}
    mediaUrl={data.coverMediaUrl}
    mediaType={data.coverMediaType}
    radius={CARD_RADIUS}
    videoContentFit="cover"
    label={data.title}
    style={StyleSheet.absoluteFill}
  />
</View>
```
Note the `pointerEvents="none"` wrapper — the native `VideoView` would otherwise capture the touch and the card's tap/gesture handler would never fire (META-ORCH-0991 Bug 3a). This is a LOCKED requirement on the deck card (§4.1).

### 2.2 mediaType is explicit — the renderer does NOT auto-detect `.mp4`
`packages/event-rendering/coverMediaPresentation.ts:resolveEventCoverMediaPresentation` returns `"video"` ONLY when `mediaType === "video"`; an unknown/`null` `mediaType` resolves to `"fallback"` (hue band), NOT video. Therefore the place path MUST compute `mediaType` itself by detecting the `.mp4` URL and passing `mediaType="video"` explicitly. The poster/still is fed via the separate still-image path (deck) or `image` (gallery) — `EventCoverMedia` does not take a separate poster prop; on the deck the still already renders behind/in place when there is no video.

### 2.3 Data path — app-only, confirmed
`supabase/functions/discover-cards/index.ts:699-738` (read in full):
```ts
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)(\?|$)/i;
const isVideoUrl = (u: string): boolean => VIDEO_EXT.test(u) || /\/video\/upload\//.test(u);
const heroImage: string | null =
  storedPhotos.find((u) => typeof u === 'string' && !isVideoUrl(u)) ?? null;
// ...
image: heroImage,      // ORCH-1068: first non-video url (real photo, not stock fallback)
images: storedPhotos,  // full ordered list unchanged (cover-video stays available)
```
- `images` = the FULL ordered `stored_photo_urls`, **including the `.mp4`**. So the app can detect the video in `images` and use it as the cover video — NO backend change.
- `image` = first non-video still (the poster/fallback).
- The app's detection regex MUST match the edge function's `isVideoUrl` exactly: `/\.(mp4|mov|webm|m4v)(\?|$)/i` OR `/\/video\/upload\//`.

### 2.4 Card type
`app-mobile/src/types/recommendation.ts` — `Recommendation` carries `image: string` + `images: string[]`. It does NOT carry `coverMediaUrl`/`coverMediaType`. The video cover URL is therefore derived from `images` (the first entry matching `isVideoUrl`), and the poster is `image`. (`mergedDiscover.ts` `BusinessEventCard` is a DIFFERENT type for the event grid surface and already carries `coverMediaUrl`/`coverMediaType` — not used here.)

### 2.5 Deck render sites + visible-card model
`app-mobile/src/components/SwipeableCards.tsx`:
- `CardHeroImage({ uri, style })` at L199-219 — the still-only hero (expo-image).
- Hero render site for the **card behind** (`nextCard = availableRecommendations[1]`) at L2558: `<CardHeroImage uri={nextCard.image} .../>`.
- Hero render site for the **current/top** card (`currentRec`) at L2706: `<CardHeroImage uri={currentRec.image} .../>`.
- Only TWO cards are ever mounted in the swipe stack: the current card (`currentRec`) and the one directly behind it (`nextCard`). Cards deeper than index 1 are NOT rendered. This is the structural basis of the perf guard (§5): at most two video players can ever exist, and only the top one should actively play.
- Prefetch (L883-900) warms `availableRecommendations[1].image` + `[2].image` via `ExpoImage.prefetch`. This warms the STILL poster only and is left unchanged (video is not prefetched — it streams on mount of the visible card).

### 2.6 Gallery render site + data source
`app-mobile/src/components/expandedCard/ImageGallery.tsx` — maps every `images[i]` to a plain RN `<Image>` (L103-114). Called from `app-mobile/src/components/ExpandedCardModal.tsx:1922`:
```tsx
<ImageGallery images={card.images} initialImage={card.image} />
```
`card.images` is the full ordered list (carrying the `.mp4`); `card.image` is the still poster. The gallery's paging/dots/arrows index off `images.length` and `currentIndex` — a video entry occupies one page like any image, so paging math is unchanged.

### 2.7 OTA-ability
- `expo-video ~3.0.16` is already a dependency of app-mobile (`package.json:134`) and is already used in the build via `EventCoverMedia` on the event/trip grid cards. Adding `EventCoverMedia` to the place path pulls **no new native module**. → **OTA-able via `eas update` (per-platform), no native rebuild** (per memory `feedback_eas_ota_publish_per_platform.md` + `project_ota_deferred_until_new_build.md`).

---

## 3. Cross-Surface Impact (Phase 2.5 — MANDATORY)

| # | Surface | Covered? | Behavior demanded | Files | Parity |
|---|---------|----------|-------------------|-------|--------|
| 1 | Consumer iOS (`app-mobile`) | YES | Venue deck card hero + expanded gallery PLAY the `.mp4` cover (muted autoplay), still poster as fallback; still-only venues unchanged | `SwipeableCards.tsx`, `ImageGallery.tsx`, new `videoUrl.ts` helper | Shared RN code → parity with Android is automatic, but EACH must be sim/emu-verified (SC-ACCEPT-iOS / -Android) |
| 2 | Consumer Android (`app-mobile`) | YES | Same as iOS | Same | Same shared code; native `expo-video` `VideoView` path. Android-specific success criterion below. |
| 3 | Buyer/anonymous Web (`mingla-business`) | NO | — | — | This deck swipe card + native expanded-card gallery do not exist on buyer-web. (The shared brand page already renders venue covers via `EventCoverMedia` per COMMS-0007 — different surface, out of scope.) |
| 4 | Business iOS (`mingla-business`) | NO | — | — | No consumer deck in the business app. |
| 5 | Business Android (`mingla-business`) | NO | — | — | Same. |
| 6 | Admin Web (`mingla-admin`) | NO | — | — | Admin doesn't render the consumer deck. |
| 7 | Business Web preview | NO | — | — | Same as 4/5. |

Parity is via shared RN code, so iOS and Android render through the same `EventCoverMedia` native path. Because this is a video/runtime change, **per-platform live-fire is mandatory** (SC-ACCEPT-iOS + SC-ACCEPT-Android), not "code looks the same."

---

## 4. Layer-by-layer specification

### 4.0 New shared helper — `app-mobile/src/utils/videoUrl.ts` 🔒 LOCKED

Create a single source of truth for video-URL detection, matching `discover-cards`'s `isVideoUrl` byte-for-byte in behavior:

```ts
// ORCH-1069: app-side mirror of discover-cards isVideoUrl (index.ts:708-709).
// Single owner so the deck hero + expanded gallery agree on what is a video.
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)(\?|$)/i;

/** True when the URL is a video (Cloudinary .mp4 cover, etc.). */
export function isVideoUrl(u: string | null | undefined): boolean {
  if (typeof u !== "string" || u.length === 0) return false;
  return VIDEO_EXT.test(u) || /\/video\/upload\//.test(u);
}

/** First video URL in an ordered media list, or null if none. */
export function firstVideoUrl(images: ReadonlyArray<string> | null | undefined): string | null {
  if (!Array.isArray(images)) return null;
  return images.find((u) => isVideoUrl(u)) ?? null;
}
```

- Return types explicit. No `any`. No silent failure.
- LOCKED: the regexes MUST match `discover-cards` index.ts:708 exactly (`I-1069-VIDEO-DETECTION-MATCHES-EDGE` — §7).

### 4.1 Deck card hero — `app-mobile/src/components/SwipeableCards.tsx` 🔒 LOCKED (functional) / 🎨 OPEN (internal structure)

**4.1.a — Add a video-aware hero component.** Introduce a `CardHero` wrapper (or extend `CardHeroImage` call sites) that decides per card:

```tsx
// derive once per card
const coverVideoUrl = firstVideoUrl(rec.images);     // null for still-only venues
const hasVideoCover = coverVideoUrl !== null;
```

- If `hasVideoCover` is `false` → render the EXISTING `CardHeroImage uri={rec.image}` unchanged (byte-identical behavior for every still-only / event / TM / curated card — zero regression).
- If `hasVideoCover` is `true` → render `EventCoverMedia` wrapped in a `pointerEvents="none"` `View` (LOCKED — mirrors BusinessEventCard, prevents the VideoView from eating the swipe/tap):

```tsx
<View style={StyleSheet.absoluteFill} pointerEvents="none">
  <EventCoverMedia
    mediaUrl={coverVideoUrl}
    mediaType="video"
    hue={/* rec hue if available, else default 25 */}
    radius={/* card hero radius — match styles.cardImage / imageContainer clip */}
    label={rec.title}
    videoContentFit="cover"
    autoplay={isTopCard}          // see §5
    playbackActive={isTopCard}    // see §5 — only the top card actively plays
    muted
    loop
    showAudioControl={false}
    style={StyleSheet.absoluteFill}
  />
</View>
```

**4.1.b — Poster/fallback.** `EventCoverMedia` shows its hue-band `EventCover` while the video has no first frame, and on error. ORCH-1068's `rec.image` (first still) is the intended POSTER. Because `EventCoverMedia` has no dedicated poster prop, the implementor renders the still BEHIND the video as the poster layer so the card never flashes a bare hue band before the first frame:

```tsx
<View style={StyleSheet.absoluteFill}>
  {/* poster layer (always present, behind) */}
  <CardHeroImage uri={rec.image} style={StyleSheet.absoluteFill} />
  {/* video layer (only when hasVideoCover) */}
  {hasVideoCover && (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <EventCoverMedia ... />
    </View>
  )}
</View>
```
🔒 LOCKED: the still poster MUST be rendered for video-cover cards (no bare-band flash). 🎨 OPEN: whether the poster fades out under the video or simply sits behind it — implementor's craft, as long as there is no visible black/band flash on mount.

**Edge case — video-only venue (no still):** if `rec.image` is empty/null (a venue whose `stored_photo_urls` is `[".mp4"]` only, so `discover-cards` set `image=null`), `CardHeroImage` already falls back to `CARD_FALLBACK_IMAGE` (L200-202). That fallback sits behind the playing video — acceptable; the video covers it. 🔒 LOCKED: must not crash when `rec.image` is null/empty.

**4.1.c — Apply at BOTH render sites:** L2558 (`nextCard`) and L2706 (`currentRec`). The `nextCard` site passes `isTopCard={false}` (poster + paused/non-playing video, or poster-only — see §5); the `currentRec` site passes `isTopCard={true}`.

**4.1.d — Overlays/badges unchanged.** The `LinearGradient` bottom-fade (L2561/L2709), `titleOverlay`, `detailsBadges`, and `minglaPill` continue to render ON TOP of the hero. The new hero layer goes where `CardHeroImage` is today (first child of `imageContainer`); overlays remain siblings after it. 🔒 LOCKED: no z-order regression — title/badges stay above the hero.

**4.1.e — Prefetch unchanged.** L883-900 keeps prefetching `image` (the still poster) for cards 1 + 2. Do NOT prefetch the video (it streams on mount of the visible card; prefetching off-screen videos would defeat the perf guard). 🔒 LOCKED.

### 4.2 Expanded-card gallery — `app-mobile/src/components/expandedCard/ImageGallery.tsx` 🔒 LOCKED (functional) / 🎨 OPEN (audio control, poster)

Inside the `images.map(...)` page render (L103-114), branch per entry:

```tsx
{images.map((mediaUri, index) => (
  <View key={index} style={[styles.imageContainer, { width: containerWidth }]}>
    {isVideoUrl(mediaUri) ? (
      <EventCoverMedia
        mediaUrl={mediaUri}
        mediaType="video"
        radius={0}
        label="Cover video"
        videoContentFit="cover"
        autoplay={index === currentIndex}        // only the visible page plays
        playbackActive={index === currentIndex}  // pause off-screen pages
        muted                                     // OPEN: gallery MAY expose audio control
        loop
        style={styles.image}
      />
    ) : (
      <Image source={{ uri: mediaUri }} style={styles.image} resizeMode="cover" />
    )}
  </View>
))}
```

- 🔒 LOCKED: image entries render via the existing `<Image>` (byte-identical). Only video entries route to `EventCoverMedia`.
- 🔒 LOCKED: only the page at `currentIndex` plays (`playbackActive={index === currentIndex}`) — paging to another photo pauses the video. Prevents N simultaneous video decodes in a multi-media venue.
- 🔒 LOCKED: paging/dots/arrows index math (`images.length`, `currentIndex`, `scrollTo(x = index * containerWidth)`) unchanged — a video occupies one page.
- 🎨 OPEN: the gallery (unlike the deck card) MAY pass `showAudioControl` + `mediaType="video"` so a user can unmute the gallery video (the gallery is an explicit-attention surface, not ambient). Implementor's call; if shown, use `EventCoverMedia`'s built-in control (`audioControlPosition="bottomRight"`), do NOT build a new one.
- 🎨 OPEN: optional still-poster behind the gallery video for a no-flash mount (same pattern as §4.1.b). Lower priority than the deck card since the gallery is opened deliberately.

---

## 5. Performance guard (do NOT regress deck scroll) 🔒 LOCKED

**Rule:** at most ONE actively-playing video on the deck at a time — the top/current card only.

- The swipe stack mounts only `currentRec` (top) + `nextCard` (behind). No card at depth ≥2 mounts a hero at all (proven §2.5) — so a card "deep in the stack" CANNOT mount a video player. This is structural, not a new gate.
- The card BEHIND (`nextCard`, L2558) MUST NOT actively play: pass `isTopCard={false}` → `autoplay={false}` + `playbackActive={false}`. Two acceptable implementations (🎨 OPEN which):
  - (a) render `EventCoverMedia` with `autoplay=false`/`playbackActive=false` (mounts the player paused on poster — ready to play the instant it becomes top), OR
  - (b) render only the still poster (`CardHeroImage`) for the behind card and swap to `EventCoverMedia` when it promotes to top.
  - 🔒 LOCKED requirement either way: the behind card does NOT play video; only the top card plays.
- `playbackActive` is the canonical gate — `EventCoverMedia` pauses the native player when `playbackActive` is false (L271-277, L502) and on app-background (L287-295). 🔒 LOCKED: the top card's `playbackActive` must be `true` only while it is the visible top card.
- Gallery: only `index === currentIndex` plays (§4.2). 🔒 LOCKED.
- 🔒 LOCKED: no video is prefetched (§4.1.e).

**Why this is safe:** the event/trip GRID already mounts many `EventCoverMedia` video covers simultaneously in a scroll list (BusinessEventCard) and ships in production; the deck mounts at most 2 (one playing). This is strictly lighter than the already-shipped grid.

---

## 6. Visual & UX contract (Phase 3.6)

This surface reuses an already-designed, already-shipped renderer (`EventCoverMedia`) inside an already-designed card/gallery. The visual system is therefore inherited and LOCKED to the existing tokens; there is no net-new visual design. Pins:

- **Deck card hero:** fills `styles.imageContainer` (the existing hero box, ~60-65% of card height) with `videoContentFit="cover"` (crop-to-fill, no letterbox). Corner radius MUST equal the existing hero clip radius (read from `styles.cardImage`/`imageContainer` — do not hardcode a new value). Existing `LinearGradient` bottom-fade (`['rgba(0,0,0,0)','rgba(0,0,0,0.2)','rgba(0,0,0,0.55)']`, locations `[0,0.5,1]`) sits above the video unchanged → title/badge contrast preserved.
- **Gallery:** fills the 300pt-tall `styles.imageContainer` with `videoContentFit="cover"`; black gallery background (`#000000`) unchanged; dots/arrows/counter chrome unchanged and above the media.
- **Motion:** muted-autoplay-loop ambient video. Reduce-motion: `EventCoverMedia` already treats muted-autoplay-loop as ambient and does NOT freeze it (`shouldFreezeCoverForReduceMotion` → false for ambient) — inherited, correct, no action.
- **No AI slop:** no new gradients, no stock imagery, no emoji, no decorative effects introduced. The only new pixels are the user's actual uploaded video.
- **All states:** loading → still poster (`rec.image`) shows immediately, video fades/plays when ready; error (video fails) → `EventCoverMedia` falls back to hue band + the poster behind it; empty (no media) → existing `CARD_FALLBACK_IMAGE` / `EventCover` band; populated → video plays; offline → poster still + paused video (no crash); first-time/returning/degraded → identical (no state difference). 🔒 LOCKED: no state regresses vs today's still-only behavior.
- **References examined:** Instagram/TikTok feed video-cover autoplay (muted, visible-item-only playback, poster-first), Airbnb listing media carousel (image+video mixed gallery, single active player). The existing `BusinessEventCard` (event grid) is the in-house reference for the exact same renderer in a card hero.

**Designer note:** because this reuses a shipped renderer inside shipped containers with no new visual primitives, a separate `mingla-designer` pass is NOT required. If the implementor wants the poster-fade or gallery audio-control polish (the 🎨 OPEN items) designed to pixel spec, that is an optional designer micro-pass, not a blocker.

---

## 7. Invariants

**Preserved:**
- `I-1068-DECK-HERO-IS-IMAGE` — ORCH-1068 made the deck STILL hero an image (never a raw `.mp4` in `ExpoImage`). 1069 preserves it: the still path is unchanged; the video plays through `EventCoverMedia`, not by feeding a `.mp4` to `ExpoImage`. The `image` poster stays an image.
- `I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME` — untouched (no change to badges/distance).
- `I-MOR-0827-PACKAGE-ISOLATION` — `EventCoverMedia` is consumed via the public `@mingla/event-rendering` entry; no app-internal import is added to the package.
- Constitution #1 (no dead taps) — the `pointerEvents="none"` wrapper (LOCKED §4.1.a) keeps the card's swipe/tap working over a playing video (the exact META-ORCH-0991 Bug 3a guard).
- Constitution #9 (no fabricated data) — missing video → no video (fall back to still/band), never a fake.

**New:**
- **`I-1069-VIDEO-DETECTION-MATCHES-EDGE`** — the app-side `isVideoUrl` (`app-mobile/src/utils/videoUrl.ts`) MUST use the same predicate as `discover-cards` `isVideoUrl` (`supabase/functions/discover-cards/index.ts:708-709`): `/\.(mp4|mov|webm|m4v)(\?|$)/i` OR `/\/video\/upload\//`. If they drift, a venue's hero (`image`, computed edge-side) and its detected cover-video (computed app-side) disagree. Enforced by a unit test asserting parity (T-07) and a protective comment in both files.
- **`I-1069-ONE-PLAYING-DECK-VIDEO`** — at most one deck video plays at a time (the top card); `playbackActive` gates it. Enforced by the perf-guard success criterion + code review.

---

## 8. Success criteria

| ID | Criterion | Observable / testable |
|----|-----------|------------------------|
| SC-1 | A venue whose `images` contains a `.mp4` renders `EventCoverMedia` (playing video) as the top deck card hero, muted, looping. | Sim: Lantern & Vine top card plays the video. |
| SC-2 | The same card's still (`image`) shows as poster before/under the video — no black/hue-band flash on mount. | Sim: visible poster, smooth into video. |
| SC-3 | A still-only venue (no `.mp4` in `images`) renders the existing `CardHeroImage` with byte-identical behavior. | Sim + unit: `firstVideoUrl` returns null → still path. Snapshot/behavior unchanged. |
| SC-4 | A card deeper than index 1 mounts NO video player (and the card behind the top does not actively play). | Code: only `currentRec`+`nextCard` render heroes; `nextCard` `playbackActive=false`. Perf: deck scroll FPS unchanged vs still-only. |
| SC-5 | The expanded-card gallery plays a `.mp4` entry via `EventCoverMedia` and renders image entries via `<Image>`; only the visible page plays. | Sim: Lantern's gallery — swipe to the video page → plays; swipe away → pauses; image pages render as before. |
| SC-6 | Event/trip/TM/curated cards are visually and behaviorally unchanged. | Code: no edit to `BusinessEventCard.tsx`/`TripCard.tsx`/`CuratedExperienceSwipeCard`; deck path only branches on `firstVideoUrl(rec.images)`. |
| SC-7 | No backend deploy required; ships via `eas update` (iOS + Android separately). | Build: no `supabase/` diff; `expo-video` already present → no native rebuild. |
| SC-ACCEPT-iOS | On the iOS sim, Lantern & Vine's deck card hero AND expanded-card gallery PLAY the video; a still-only venue is unchanged; the deck still swipes/taps normally. | Live-fire iOS sim (mandatory). |
| SC-ACCEPT-Android | Same as SC-ACCEPT-iOS on the Android emulator (native `expo-video` `VideoView` path). | Live-fire Android emu (mandatory). |

---

## 9. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Video cover plays (top card) | `rec.images=['https://…/video/upload/x.mp4', 'https://…/a.jpg']`, `rec.image='…/a.jpg'`, isTop | `EventCoverMedia mediaType="video"` mounts, plays muted/loop; poster `a.jpg` behind | Component (deck) |
| T-02 | Still-only venue (no regression) | `rec.images=['…/a.jpg','…/b.jpg']` | `CardHeroImage uri='…/a.jpg'`; no `EventCoverMedia` mounted | Component (deck) |
| T-03 | Card behind does not play | `nextCard` has `.mp4` | `playbackActive=false`/`autoplay=false` (or poster-only) — no active playback | Component + perf guard |
| T-04 | Video-only venue (null poster) | `rec.images=['…/x.mp4']`, `rec.image=null` | No crash; `CARD_FALLBACK_IMAGE` behind; video plays over it | Component (deck) |
| T-05 | Gallery mixed media | `images=['…/x.mp4','…/a.jpg','…/b.jpg']`, swipe to page 0 | page 0 → `EventCoverMedia` plays; pages 1-2 → `<Image>`; paging to page 1 pauses page 0 | Component (gallery) |
| T-06 | Gallery image-only (no regression) | `images=['…/a.jpg','…/b.jpg']` | every page `<Image>`; identical to today | Component (gallery) |
| T-07 | Detection parity with edge | URLs incl. `x.mp4`, `x.mp4?v=2`, `/video/upload/y`, `x.mov`, `x.jpg`, `''`, null | `isVideoUrl` matches `discover-cards` `isVideoUrl` exactly | Unit (`videoUrl.ts`) |
| T-08 | Video error → fallback | `.mp4` URL 404s | `EventCoverMedia` `onMediaError` → hue band / poster; no crash, card still swipes | Component |
| T-09 | App background pauses | top card playing, background app | native player pauses (EventCoverMedia AppState handler); resumes on foreground | Runtime (sim) |

**Step 0.5 (happy + adversarial), per dispatch:**
- **Happy:** a venue with a `.mp4` cover (Lantern & Vine) renders `EventCoverMedia` (playing video) on the deck card hero AND in the expanded gallery, with the still as poster. (SC-1, SC-5, SC-ACCEPT-iOS/Android.)
- **Adversarial 1 (no regression):** a still-only venue renders the image hero exactly as before — no `EventCoverMedia`, no behavior change. (SC-3, T-02/T-06.)
- **Adversarial 2 (perf guard):** a card deep in the stack mounts NO video player, and the card directly behind the top does NOT actively play — only the top card's video plays. (SC-4, T-03.)

---

## 10. Implementation order

1. Create `app-mobile/src/utils/videoUrl.ts` (`isVideoUrl` + `firstVideoUrl`) with the protective comment citing `discover-cards` index.ts:708 + invariant `I-1069-VIDEO-DETECTION-MATCHES-EDGE`. (§4.0)
2. Wire the gallery (`ImageGallery.tsx`) — the simpler, self-contained surface — and unit-test detection parity (T-07) + gallery branch (T-05/T-06). (§4.2)
3. Wire the deck hero (`SwipeableCards.tsx`) — add the `CardHero` decision (poster + conditional `EventCoverMedia`) at both L2558 (`nextCard`, not-top) and L2706 (`currentRec`, top); thread `isTopCard`. Leave prefetch + overlays + badges untouched. (§4.1, §5)
4. Verify event/trip/TM/curated paths are byte-unaffected (read-only confirm; no edits to those components). (SC-6)
5. Live-fire: iOS sim + Android emu acceptance on Lantern & Vine (SC-ACCEPT-iOS/Android); confirm deck swipe/tap + scroll FPS unchanged. (Tester.)
6. Ship via `eas update --platform ios` then `--platform android` (no native rebuild, no backend deploy).

---

## 11. Regression prevention

- **Class of bug:** a video-capable renderer not wired into a path that receives video data. Safeguard: `I-1069-VIDEO-DETECTION-MATCHES-EDGE` unit test (T-07) keeps app/edge detection in lockstep so a future edge regex change is caught; protective comments in both `videoUrl.ts` and `discover-cards/index.ts:708` cross-reference each other.
- **Perf regression (N videos on deck):** `I-1069-ONE-PLAYING-DECK-VIDEO` + the structural 2-card mount + `playbackActive` gating; T-03 asserts the behind card does not play; code review checkpoint that no video is prefetched.
- **Still-only regression:** T-02/T-06 lock the still path to byte-identical behavior; the deck/gallery only branch when `firstVideoUrl(...) !== null`.
- **Tap-eaten-by-video regression:** the `pointerEvents="none"` wrapper is LOCKED (§4.1.a) with a comment citing META-ORCH-0991 Bug 3a.

---

## 12. OTA / build classification

**App-only. OTA-able. No native rebuild.** `expo-video` is already a dependency and already in the binary (used by the event/trip grid `EventCoverMedia`). Adding `EventCoverMedia` to the place path imports an already-bundled module + a workspace package already imported by app-mobile. No new native module, no `app.config`/Pods/Gradle change. → Ship via `eas update` (per-platform, per `feedback_eas_ota_publish_per_platform.md`). No `supabase/` diff → no backend deploy, no migration, no strict-grep backend allowlist needed.

---

## 13. Open question

- **OQ-1 (non-blocking):** Should the expanded-card gallery expose the unmute audio control (`showAudioControl`) for venue cover videos, or stay muted like the deck card? Recommended default: **show it** in the gallery (deliberate-attention surface) and keep the deck card muted/ambient. Tagged 🎨 OPEN in §4.2 — implementor may decide; no backend or contract impact either way.
