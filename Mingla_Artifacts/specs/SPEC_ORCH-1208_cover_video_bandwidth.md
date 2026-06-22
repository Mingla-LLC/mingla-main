# SPEC — ORCH-1208 [cover-video bandwidth fix — Phase 1]

**Phase:** SPEC (build contract). **Status:** ready for IMPLEMENT dispatch.
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1208-[cover-video-bandwidth-fix]/` on `ORCH-1208-cover-video-bandwidth-fix`.
**Investigation:** `Mingla_Artifacts/ORCH-1208_COVER_VIDEO_BANDWIDTH.md`.

## Goal (one sentence)
Stop bots / SSR / off-screen instances from eagerly downloading cover **videos** — WITHOUT any
visible change for a real on-screen viewer, WITHOUT a new dependency / vendor / caching layer, and
WITHOUT touching the IMAGE delivery path.

## Hard constraints (binding)
- NO new npm dependency, NO new vendor, NO caching layer (Phase 2), NO backend / migration / edge
  change, NO change to the image delivery path (cover **images** are Supabase Storage; untouched).
- Autoplay for the visible card / real viewer MUST be byte-for-byte preserved (web tap-to-play and
  native muted-autoplay both unchanged).
- Single chokepoint: all real changes live in `packages/offering-rendering/EventCoverMedia.tsx` +
  `packages/offering-rendering/coverMediaPresentation.ts` (poster helper) + ONE consumer card
  (`app-mobile/src/components/CuratedExperienceSwipeCard.tsx`). Minimize edits elsewhere.

---

## Forensic grounding (verified against current code, this worktree)

**Where cover media lives.** Cover **images/GIFs** → Supabase Storage `event_covers` bucket
(`mingla-business/src/services/eventCoverMediaService.ts`). Cover **videos** → Cloudinary
(`event-cover-video-upload-intent` → `event-cover-video-webhook`); the persisted `cover_media_url`
is the Cloudinary eager `secure_url`, an `.mp4` under `/video/upload/` (`event-cover-video-webhook/
index.ts:179,251`). Video detection regex (shared, do not drift): `VIDEO_EXT =
/\.(mp4|mov|webm|m4v)(\?|$)/i`, plus `/\/video\/upload\//` (`app-mobile/src/utils/videoUrl.ts:22`;
`supabase/functions/discover-cards/index.ts:867`).

**Single chokepoint confirmed.** Every cover on every surface renders through
`packages/offering-rendering/EventCoverMedia.tsx`. Web `<video>` is built IMPERATIVELY
(`document.createElement('video')`, `EventCoverWebVideo`, lines 127–334); native uses
`useVideoPlayer` (`EventCoverNativeVideo`, lines 336–443). The web path already lazy-mounts behind an
IntersectionObserver gate (`useInViewport`, `rootMargin:"400px"`, lines 468–497; gate at
`renderMedia`, lines 615–618), so off-screen *web* cards never mount the `<video>`. Native is always
`inView=true` (no observer) — native off-screen gating is the caller's job (`autoplay`/
`playbackActive` props).

**Cause #1 — eager web fetch.** `EventCoverWebVideo` sets `video.preload = "auto"`
(`EventCoverMedia.tsx:221`). On any rendered-but-not-really-watched context (link-preview unfurl,
crawler, uptime check, in-app browser, desktop WebKit which blocks muted autoplay and shows a play
button), `preload="auto"` downloads the WHOLE `.mp4` on mount even though the video never plays. This
is the machine-scale bulk of the 200 GB.

**Cause #2 — native off-screen autoplay (the dispatched card).**
`CuratedExperienceSwipeCard.tsx:347-358` renders `<EventCoverMedia ... autoplay muted loop>` with NO
`playbackActive` prop → defaults `autoplay=true, playbackActive=true` →
`shouldPlay = autoplay && playbackActive = true` ALWAYS, so the native `useVideoPlayer` streams the
moment the card mounts regardless of whether it is the front card. The correct pattern is
`SwipeableCards.tsx` `CardHero` (lines 356–399): `autoplay={isTopCard} playbackActive={isTopCard}`
+ a still poster layer behind, enforced by `I-1069-ONE-PLAYING-DECK-VIDEO`.
NOTE: today the experience variant is rendered ONLY in the **Current Card** slot
(`SwipeableCards.tsx:2925`), i.e. it is always the front card, so the *current* live blast radius is
"this one card streams while shown" rather than "N cards stream off-screen." The fix is still
required: it (a) removes the always-stream-on-mount even when paused/backgrounded would be correct,
(b) hardens against any future stacked/behind-card mount, and (c) brings the card to parity with the
proven deck contract. Threading `playbackActive` is the load-bearing half (native streams on
`shouldPlay`); `autoplay` is threaded for symmetry/intent.

**Poster source — verified.**
- VENUE deck cards already carry a separate still: discover-cards sets `image` = first NON-video URL
  (`discover-cards/index.ts:869,895`) and `CardHero` already layers it as the poster
  (`SwipeableCards.tsx:380`). So venue covers HAVE a poster today.
- EXPERIENCE cards + DETAIL screens + public pages pass ONLY `coverMediaUrl` (the video) with NO
  sibling still (`CuratedExperienceSwipeCard.tsx:347`; `ConsumerEventDetailScreen.tsx:773`;
  `ParallaxCoverShell.tsx:186`; `PublicEventPage.tsx:423`). For these, a poster must be DERIVED.
- **Derivation, zero new dep:** a Cloudinary video URL `…/video/upload/<rest>.mp4` yields a
  first-frame JPEG by inserting the `so_0` (start-offset 0s) transform and swapping the extension to
  `.jpg`: `…/video/upload/so_0/<rest>.jpg`. Pure string transform — no runtime dependency, no
  backend, no API call. When the URL is NOT a Cloudinary `/video/upload/` URL (or not a video at
  all), derivation returns `null` and the existing `EventCover` hue-band placeholder shows (still no
  eager video download — that is the only behavior that matters for bots).

---

## FIX 1 — WEB: `preload="none"` + poster on the imperative `<video>`

**File:** `packages/offering-rendering/EventCoverMedia.tsx`, `EventCoverWebVideo`.

**1a. preload.** Line **221**.

BEFORE:
```ts
    video.preload = "auto";
```
AFTER:
```ts
    // ORCH-1208 — bandwidth: never eagerly download the cover video. A real
    // on-screen viewer still fetches+plays (the autoplay attribute / tap drives
    // the load); bots, SSR, link-unfurlers and desktop-WebKit (which shows a
    // play button and never auto-plays) get the POSTER image only, no .mp4.
    video.preload = "none";
```

Why safe: with `preload="none"`, the browser still fetches the moment playback is *actually* invoked
— `video.autoplay = shouldPlayRef.current` (line 218) when `shouldPlay` is true (a real on-screen
player permitted to autoplay), and the user's tap on desktop (WebKit play button) triggers the load.
A headless bot / unfurler that has no autoplay permission and never taps downloads nothing.

**1b. poster.** Add a `posterUrl?: string | null` prop to `EventCoverWebVideo`'s props type (after
`uri`), thread it from `EventCoverVideo` and `EventCoverMedia` (see FIX 3 for the prop chain), and
set it on the imperative element in the create effect, alongside the other attribute pins
(insert immediately after line 220 `video.controls = false;`, before the new `preload="none"`):
```ts
    if (typeof posterUrl === "string" && posterUrl.length > 0) {
      video.poster = posterUrl;
      video.setAttribute("poster", posterUrl);
    }
```
- `posterUrl` must be read via a ref-free direct prop in the create-effect dependency list ONLY if it
  cannot change for a given `uri`; since poster is derived deterministically from `uri` it is stable,
  so it is safe to reference directly inside the `[uri, contentFit]` effect WITHOUT adding it to the
  dep array (adding it would not retrigger because it is a pure function of `uri`). Do NOT add
  `posterUrl` to the dependency array (keeps the imperative-mount teardown contract — R8 — intact).

**Acceptance (FIX 1):**
- `grep -n 'preload' EventCoverMedia.tsx` shows `preload = "none"` and NEVER `"auto"`.
- A real user on a card/page in viewport still autoplays (native) / plays-on-tap (web desktop)
  identically to today.
- A bot / SSR render / off-screen (web already gated) instance downloads ZERO bytes of `.mp4`; it
  shows the poster image (or the hue-band fallback if no poster derivable).
- Desktop-web behavior (already a play button over a poster) is unchanged for the human — the play
  button now overlays the poster frame instead of a black box; tap still loads + plays.

---

## FIX 2 — NATIVE: gate the off-screen-autoplaying experience card

**File:** `app-mobile/src/components/CuratedExperienceSwipeCard.tsx`.

Thread a `isTopCard` prop into the card and pass it to `EventCoverMedia` as BOTH `autoplay` and
`playbackActive`, mirroring `SwipeableCards.tsx` `CardHero` (lines 389–390).

**2a. Props type.** In `interface Props` (around line 224), add:
```ts
  // ORCH-1208: only the front/active deck card streams its cover video. When
  // false the cover mounts paused on its poster (playbackActive=false) and
  // downloads nothing. Defaults true so non-deck callers (none today) are
  // unaffected. Mirrors SwipeableCards CardHero isTopCard (I-1069).
  isTopCard?: boolean;
```

**2b. Destructure** (function signature, line 249) — add `isTopCard = true` to the destructured
props (default `true` so any caller that omits it is byte-identical to today).

**2c. Cover render.** Lines 347–358.

BEFORE:
```tsx
              <EventCoverMedia
                hue={experienceCover?.coverHue}
                mediaUrl={coverUrl}
                mediaType={coverType}
                autoplay
                muted
                loop
                radius={0}
                height="100%"
                width="100%"
                label={card.title}
              />
```
AFTER:
```tsx
              <EventCoverMedia
                hue={experienceCover?.coverHue}
                mediaUrl={coverUrl}
                mediaType={coverType}
                // ORCH-1208 — only the front card streams (parity with the
                // venue deck CardHero, I-1069). Off-front: paused on poster.
                autoplay={isTopCard}
                playbackActive={isTopCard}
                muted
                loop
                radius={0}
                height="100%"
                width="100%"
                label={card.title}
              />
```

**2d. Caller.** `app-mobile/src/components/SwipeableCards.tsx`. The experience variant is rendered in
the **Current Card** slot (line 2925) — it is the active card — so pass `isTopCard`:
```tsx
                  <CuratedExperienceSwipeCard
                    ...
                    isTopCard={true}   // ORCH-1208: front card streams
                  />
```
Add the SAME `isTopCard={true}` to the **curated** variant at line 2954 (also a front-card render;
curated cards carry no cover so it is a no-op there, but kept for symmetry / future cover support).
If a future behind-card render of the experience card is added, it MUST pass `isTopCard={false}`.

**Acceptance (FIX 2):**
- The on-screen experience card autoplays its cover video identically to today (muted, looping).
- `EventCoverMedia` inside `CuratedExperienceSwipeCard` receives `playbackActive={isTopCard}` — when
  `isTopCard` is false the native `useVideoPlayer` does NOT play (`shouldPlay=false`) and does not
  stream.
- `grep` proves `CuratedExperienceSwipeCard` no longer passes a bare `autoplay` without a matching
  `playbackActive` gate.

---

## FIX 3 — POSTER everywhere (web `poster` + native placeholder) via a centralized derivation

The goal: anywhere a cover **video** renders, there is an instant still frame (so bots get an image
and humans see no flash-of-black). Implemented as ONE optional prop on `EventCoverMedia` plus ONE
derivation helper, so callers stay byte-identical unless they opt to override.

**3a. Derivation helper.** `packages/offering-rendering/coverMediaPresentation.ts` — add (keeps the
package self-contained, no app import, honoring `I-MOR-0827-PACKAGE-ISOLATION`):
```ts
// ORCH-1208 — derive a poster still for a cover VIDEO with ZERO new dependency.
// Cloudinary video URLs (.../video/upload/<rest>.mp4) yield a first-frame JPEG
// via the `so_0` (start-offset 0s) transform + .jpg extension. Non-Cloudinary
// or non-video URLs return null → the hue-band EventCover placeholder shows
// (still no eager video download — the only thing that matters for bots).
export const deriveCoverPosterUrl = (
  videoUrl?: string | null,
): string | null => {
  if (typeof videoUrl !== "string" || videoUrl.length === 0) return null;
  const marker = "/video/upload/";
  const i = videoUrl.indexOf(marker);
  if (i < 0) return null;
  const head = videoUrl.slice(0, i + marker.length);
  let tail = videoUrl.slice(i + marker.length);
  // Drop any query string from the derived still.
  const q = tail.indexOf("?");
  if (q >= 0) tail = tail.slice(0, q);
  // Swap the video extension for .jpg (Cloudinary renders the frame as JPEG).
  tail = tail.replace(/\.(mp4|mov|webm|m4v)$/i, ".jpg");
  if (!/\.jpg$/i.test(tail)) tail = `${tail}.jpg`;
  return `${head}so_0/${tail}`;
};
```

**3b. `EventCoverMedia` prop + plumbing.** `packages/offering-rendering/EventCoverMedia.tsx`.
- Add to `EventCoverMediaProps` (after `mediaType`, ~line 30):
  ```ts
    // ORCH-1208 — explicit still poster for a video cover. When omitted, a
    // poster is auto-derived from a Cloudinary video URL (deriveCoverPosterUrl).
    // Callers that already have a real still (e.g. the venue deck `image`) pass
    // it directly. Images/GIFs ignore this prop.
    posterUrl?: string | null;
  ```
- In the `EventCoverMedia` component body, after `presentation` is resolved (~line 586), compute:
  ```ts
    const resolvedPosterUrl =
      presentation === "video" || presentation === "video_still"
        ? (posterUrl ?? deriveCoverPosterUrl(mediaUrl))
        : null;
  ```
  (import `deriveCoverPosterUrl` from `./coverMediaPresentation`).
- Pass `posterUrl={resolvedPosterUrl}` into `<EventCoverVideo .../>` (lines 649–658). Add `posterUrl`
  to `EventCoverVideo`, `EventCoverWebVideo`, and `EventCoverNativeVideo` prop types and thread it.
- **Web:** consumed in FIX 1b (`video.poster`).
- **Native:** `EventCoverNativeVideo` — render the poster as a still BEHIND the `VideoView` so there
  is an instant frame before the first decoded video frame and while paused (`playbackActive=false`).
  Replace the bare `<VideoView ... />` return (lines 432–442) with a wrapper:
  ```tsx
    return (
      <View style={StyleSheet.absoluteFill}>
        {typeof posterUrl === "string" && posterUrl.length > 0 ? (
          <Image
            source={{ uri: posterUrl }}
            style={StyleSheet.absoluteFill}
            resizeMode={contentFit}
          />
        ) : null}
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          nativeControls={false}
          fullscreenOptions={{ enable: false }}
          allowsPictureInPicture={false}
          playsInline
        />
      </View>
    );
  ```
  (`Image` is already imported at the top of the file, line 6.) This is additive and benign when
  playing (the opaque video frame covers the poster); when `playbackActive=false` the poster is what
  the user sees instead of a black box.

**3c. Wire the existing real still where one exists (optional, no behavior change).** The venue
`CardHero` already has its own poster layer (`SwipeableCards.tsx:380`), so it needs nothing — leave
it. Experience cards, detail screens, public pages get their poster via auto-derivation (3a/3b),
which is the whole point. Do NOT add poster props to those callers; the derivation handles them at
the chokepoint.

**Acceptance (FIX 3):**
- Every video-cover render path yields a poster: web sets `<video poster>`, native renders an
  `<Image>` still behind the `VideoView`.
- Image/GIF covers are unaffected (`resolvedPosterUrl` is null for non-video presentations; the
  `<Image>` branch in `EventCoverMedia` is untouched).
- For a Cloudinary cover with no sibling still, `deriveCoverPosterUrl` returns the `so_0` `.jpg`; for
  a non-Cloudinary video the poster is null and the hue-band placeholder shows (no eager download
  either way).
- No flash-of-black before first frame on the detail screens / public hero.

---

## REGRESSION SURFACE — verify "unchanged" on each

The chokepoint touches EVERY cover renderer. The grep `grep -rln "EventCoverMedia" --include` lists
~60 files; the ones that render a cover at runtime (not types/services) and MUST be confirmed:

**app-mobile (consumer, native — autoplay must be byte-identical for the on-screen instance):**
- `SwipeableCards.tsx` `CardHero` (venue deck top + behind card): top card still autoplays its
  `.mp4`, behind card still paused-on-poster; the existing CardHeroImage poster layer still shows.
  CONFIRM: `isTopCard` semantics untouched; the new derived poster does not double-render (CardHero
  passes its own poster as a sibling Image, and EventCoverMedia's native poster is additive — both
  are stills behind the video, benign).
- `CuratedExperienceSwipeCard.tsx` (experience + curated card): on-screen card autoplays; FIX 2 gate
  applied; curated (no cover) renders the stop-strip hero unchanged (SC-13 byte-identical — verify
  the `isTopCard` default doesn't disturb curated callers; default true = today).
- `discover/BusinessEventCard.tsx` (Discover grid "On Mingla" cards): passes NO `autoplay`/
  `playbackActive` → defaults true/true; **SECONDARY RISK (see below)** — confirm it still autoplays
  identically (no functional change in this ORCH) and now shows a poster.
- `discover/TripCard.tsx` (Discover trips grid): same as above.
- `ConsumerEventDetailScreen.tsx` / `ConsumerTripDetailScreen.tsx` /
  `ConsumerExperienceDetailScreen.tsx` (single on-screen hero, `autoplay playbackActive`): CONFIRM
  the single hero still autoplays muted-looping; now backed by a poster (no black flash). NO gating
  change needed (real viewer, single video).
- `activity/CalendarTab.tsx`, `expandedCard/ImageGallery.tsx`, `DiscoverScreen.tsx`: confirm no
  visible change (these render covers; image path untouched, video path gains poster + preload=none).

**packages (shared public bodies — web + native):**
- `ParallaxCoverShell.tsx` (line 186, `autoplay playbackActive`): the public offering hero — confirm
  web tap-to-play + native autoplay unchanged; poster now present.
- `PublicEventPage.tsx` (line 423): the bot-exposed buyer-web event page — THIS is where the
  `preload="none"` win lands; confirm a real visitor still plays, an unfurl/crawler downloads only
  the poster.
- `ExperienceOfferingBody.tsx` (327) / `TripOfferingBody.tsx` (372): shared experience/trip bodies —
  same confirmation.
- `OfferingChrome.tsx`: mute toggle still drives `muted` (unchanged; no cover render here).
- `brand-rendering/PublicBrandPage.tsx`: brand page cover grid — confirm video covers preload=none +
  poster, image covers unchanged.

**mingla-business (business app + business public pages — confirm no regression):**
- Authoring previews / list cards / public pages that render `EventCoverMedia`
  (`event/PublicEventPage.tsx`, `CreatorStep7Preview.tsx`, `OfferingListCard.tsx`,
  `EventListCard.tsx`, `TripListCard.tsx`, `experience/ExperiencePreview.tsx`,
  `brand/BrandProfileView.tsx`, the `app/event|trip|experience|rsvp|checkout*` routes, etc.):
  business app re-exports the SAME shared component (`mingla-business/src/components/ui/
  EventCoverMedia.tsx`). CONFIRM authoring/preview covers still autoplay on the active screen and
  gain a poster; no business OTA is required by this ORCH (web/JS deploy + consumer OTA cover the
  blast).

"Unchanged" per surface = the human-visible playback (autoplay-on-screen / tap-on-web) is identical
AND the image-cover path is byte-identical; the ONLY observable deltas are: (a) a poster still now
appears where a black box / hue band used to flash, and (b) bots/off-screen no longer download the
`.mp4`.

### SECONDARY RISK (documented, NOT fixed in this ORCH)
`discover/BusinessEventCard.tsx` and `discover/TripCard.tsx` render `EventCoverMedia` with NO
`autoplay`/`playbackActive` props → default `true/true` → in a Discover GRID with N video-cover
cards, ALL N stream natively (no native inView gate). This is the same class as FIX 2 but on a
different surface and OUTSIDE the dispatched scope (the dispatch names only
`CuratedExperienceSwipeCard`). **Flag to orchestrator as a Phase-1.5 follow-on** (apply the same
`isTopCard`/visibility gate to the Discover grid cards via an on-screen/`viewabilityConfig` flag).
Left untouched here to honor "minimize edits elsewhere" and keep the change reversible. The poster +
`preload=none` win still applies to these cards via the chokepoint, so even unfixed they no longer
eagerly download on web; the residual is native grid streaming, which is real-user-data not
bot-scale.

---

## INVARIANT (DRAFT) — `I-PROPOSED-1208-NO-EAGER-VIDEO-PRELOAD`

**Statement:** The shared web cover `<video>` (imperative element in `EventCoverWebVideo`) MUST set
`video.preload = "none"` and MUST NEVER set `preload = "auto"`. The cover renderer MUST always be
able to supply a poster for a video cover (the `posterUrl` prop + `deriveCoverPosterUrl` derivation
exist and are wired). The native `CuratedExperienceSwipeCard` cover MUST be gated by
`playbackActive`/`isTopCard` (no bare always-on `autoplay`).

**Grep enforcement (new source-structural test — see TEST PLAN T-INV):**
```
# In EventCoverMedia.tsx (web path):
assert   /video\.preload\s*=\s*["']none["']/   present
assert   /preload\s*=\s*["']auto["']/          ABSENT
assert   /video\.poster\s*=/                   present
assert   export deriveCoverPosterUrl + /so_0/  present in coverMediaPresentation.ts
# In CuratedExperienceSwipeCard.tsx:
assert   /playbackActive=\{isTopCard\}/        present
assert   bare /autoplay\s+muted\s+loop/ WITHOUT a sibling playbackActive  ABSENT
```

Place under `packages/offering-rendering/__tests__/orch_1208_no_eager_video_preload.test.ts` (source
`readFileSync` contract, matching the existing `coverWebVideoImperativeMount.orch1167r8.test.ts`
style — no jsdom; these mounts pull react-native + expo-video so the contract is asserted at source
level). Status `I-PROPOSED-1208-*` until orchestrator promotes it.

---

## TEST PLAN

### Implementor happy-path (MUST fail on revert)
- **T-1 (preload):** `packages/offering-rendering/__tests__/orch_1208_no_eager_video_preload.test.ts`
  — assert the web slice (`EventCoverWebVideo`) contains `video.preload = "none"` and contains NO
  `preload = "auto"`. Reverting FIX 1a flips it back → test fails.
- **T-2 (poster wired):** assert `EventCoverWebVideo` sets `video.poster`, that `EventCoverMedia`
  computes `resolvedPosterUrl` and passes `posterUrl` to `EventCoverVideo`, and that
  `deriveCoverPosterUrl` is exported from `coverMediaPresentation.ts` and emits `so_0` + `.jpg`.
- **T-3 (derivation unit):** pure-function test of `deriveCoverPosterUrl`:
  - `…/video/upload/v1/abc.mp4` → `…/video/upload/so_0/v1/abc.jpg`
  - `…/video/upload/c_fill/v1/abc.mp4?x=1` → `…/video/upload/so_0/c_fill/v1/abc.jpg` (query dropped)
  - `https://storage.supabase…/cover.png` → `null` (not Cloudinary video)
  - `null` / `""` / non-video → `null`
- **T-4 (native gate wired):** assert `CuratedExperienceSwipeCard.tsx` declares `isTopCard?: boolean`,
  destructures `isTopCard = true`, and passes `autoplay={isTopCard} playbackActive={isTopCard}` to
  `EventCoverMedia`. Assert `SwipeableCards.tsx` passes `isTopCard` to the experience-variant render.

### Tester adversarial (different angle — runtime/structural)
- **A-1 (visible card STILL autoplays):** drive the consumer deck on an experience-cover venue
  (sim + physical) — confirm the front experience card autoplays muted-looping byte-identically to
  pre-ORCH (record before/after). Confirm the detail screen hero autoplays.
- **A-2 (off-front does NOT stream):** unit/integration — render `CuratedExperienceSwipeCard` with
  `isTopCard={false}` and assert `EventCoverMedia` receives `playbackActive={false}` →
  `EventCoverNativeVideo` `shouldPlay=false` → no `player.play()`. (Prove via the prop contract +
  a render assertion; the native player not-playing is the load-bearing claim.)
- **A-3 (web no eager download):** on a Vercel preview, load a public event page with a video cover
  in a headless/no-autoplay context (the orchestrator's headless-WebKit harness used by ORCH-1167)
  and assert NO `.mp4` request fires on load (only the poster `.jpg`); then simulate a real
  user-gesture play and assert the `.mp4` loads + plays. This is the authoritative bandwidth proof.
- **A-4 (image-cover path unaffected):** assert an image-cover and a GIF-cover render byte-identical
  (no poster prop reaches the `<Image>` branch; `resolvedPosterUrl` is null for non-video).
- **A-5 (cross-surface no-regression sweep):** spot-check 3+ surfaces from the regression list (venue
  deck, public event web page, business authoring preview) for identical human-visible behavior.
- **A-6 (objective meter):** the ORCH-1201 API-health hub monitors Cloudinary `credits.used_percent`
  hourly — capture the value at merge and confirm the delivery curve flattens after Phase 1 (the
  before/after bandwidth proof; not a pre-merge gate but the close criterion).

---

## RISKS / OPEN ITEMS found

1. **Cover videos with no derivable poster.** Any cover whose `cover_media_url` is NOT a Cloudinary
   `/video/upload/` URL (e.g. a legacy Supabase-hosted `.mp4`, if any exist) yields `null` from
   `deriveCoverPosterUrl` → falls back to the hue-band `EventCover` placeholder. This is acceptable
   (still no eager download, still an instant frame), but it means "poster everywhere" is "poster
   everywhere a Cloudinary still is derivable; hue band otherwise." Verify during implement whether
   any non-Cloudinary cover videos exist; if a meaningful number do, a Phase-2 follow-on could
   persist a real first-frame still column (out of scope here — no migration in Phase 1).
2. **Derived poster aspect ratio.** `deriveCoverPosterUrl` does not add Cloudinary sizing transforms,
   so the `so_0` frame is the source resolution. For the hero `onAspectRatio` path the poster is
   purely decorative (the video reports the real ratio once loaded), so this is benign. Do NOT add
   sizing transforms in Phase 1 (would touch image delivery shaping — out of scope).
3. **Secondary native streaming surface** (`BusinessEventCard` / `TripCard` Discover grids) is NOT
   fixed here — documented above as a Phase-1.5 follow-on. If the post-merge meter (A-6) is still
   hot, this is the next lever.
4. **Double poster on the venue deck** (CardHero's own `image` poster + EventCoverMedia's new native
   poster) — both are stills behind the same video; harmless layering, no visible artifact. Confirmed
   benign in the regression notes; no change to CardHero required.
