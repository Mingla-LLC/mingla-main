# META-ORCH-1270 — Vector A: Delivery / Bandwidth Static Audit

Read-only forensic audit of every path that DELIVERS (downloads) Cloudinary
media to a client or bot. No code changed. Evidence = exact `file:line` + the
mechanism that burns bytes. Cloud name `dhza7d54o`, FREE plan (25 credits/mo;
1 credit = 1 GB delivery). This is the SECOND account death; ORCH-1209 shipped a
web-only `preload="none"` fix and CLOSED as "leak dead" — then the account died
again, so a delivery vector survived.

---

## Headline verdict

**Is the native app still eagerly streaming cover videos in the shipped build?
YES — twice over.**

1. Even in the post-ORCH-1209 source, the native renderer downloads the video
   the instant the component mounts, regardless of whether the card is playing,
   off-screen, or behind another card. The ORCH-1209 native "gate" only calls
   `player.pause()` — it never stops the download.
2. The ORCH-1209 native leg ("autoplay-gate") was, by the orchestrator's own
   CLOSE note, "merged but DARK pending an app build" — so the binary users run
   very likely predates even the play/pause gate. Either way the shipped app
   streams.

ORCH-1209's web `preload="none"` fix is airtight FOR WEB (verified below) and
almost certainly killed the bot/SSR bulk that dominated the June 216 GB spike.
But it does nothing for native, and native re-download was explicitly DEFERRED to
a "Phase 2" that was never built. As install count and the number of
video-cover offerings grew after 6/24, the native vector (Findings A/B/C) is the
surviving leak.

---

## Finding A — PRIME LEAK: native `useVideoPlayer(uri)` buffers on creation, not on play

**File:** `packages/offering-rendering/EventCoverMedia.tsx:380` (inside
`EventCoverNativeVideo`).

```
const shouldPlay = autoplay && playbackActive;
const player = useVideoPlayer(uri, (nextPlayer) => { ... if (shouldPlay) ... play() });
```

**What it does.** `useVideoPlayer(uri, …)` is a hook — it runs unconditionally on
every mount of `EventCoverNativeVideo` and binds the expo-video player to the
Cloudinary `.mp4` `uri`. In expo-video `~3.0.16`, creating a player with a
source LOADS that source: the player transitions `loading -> readyToPlay`, which
means it opens the HTTP connection and buffers the leading segment (and, for the
short cover clips Mingla uses, frequently the whole file) BEFORE any
`player.play()` call.

**Why it burns bandwidth.** The `shouldPlay` guard (ORCH-1209 leg 2) only decides
whether to call `player.play()` vs `player.pause()` (see the play/pause effect at
`EventCoverMedia.tsx:425-431`). Pausing does NOT release the source or cancel the
in-flight download. So an off-screen card, a card behind the top card
(`playbackActive=false`), a reduce-motion `video_still`, and a bot-invisible
mount all still fetch video bytes. There is NO native equivalent of the web
`video.preload = "none"` (`EventCoverMedia.tsx:243`). The lazy-mount viewport
gate `useInViewport` (`EventCoverMedia.tsx:507-536`) is WEB-ONLY — it hard-returns
`Platform.OS !== "web"` as `true`, and `renderMedia` (`:665-668`) gates on
`(Platform.OS !== "web" || inView)`, so on native every video cover with a URL
mounts a player immediately.

**The ORCH-1209 comment is factually wrong here.** `EventCoverMedia.tsx:456-460`
claims: "playbackActive=false -> shouldPlay=false -> off-front/behind cards never
stream." They DO stream — the poster `<Image>` is drawn on top, but the player
underneath has already begun downloading. The adversarial test
(`__tests__/orch_1209_bandwidth_adversarial.test.ts:158-172`, test C1) only
asserts `shouldPlay=false => player.pause()` — it never asserts the source is
withheld. So the regression guard proves the WRONG property; it would stay green
even though bytes are flowing.

**Magnitude.** One video download per native mount of a video cover, on EVERY
surface (deck top-2 cards, all detail screens, all grids/rails), independent of
visibility. Re-downloaded on every remount because there is no native disk cache
(Finding C). This is the structural root and is NOT covered by ORCH-1209's
web-only fix.

**One-line fix direction.** Give native a real "preload none": create the player
with a null/empty source and only `player.replaceAsync(uri)` when
`shouldPlay` first becomes true (or gate the whole `<EventCoverVideo>` mount on a
native visibility+shouldPlay condition, mirroring web `useInViewport`). Pausing
is not enough; the source must not be set until play is wanted.

---

## Finding B — HIGH FAN-OUT: DiscoverScreen "On Mingla" grid autoplays every business-event video at once

**Files:**
`app-mobile/src/components/DiscoverScreen.tsx:2246` (`businessEvents.map(...)`)
-> `app-mobile/src/components/discover/BusinessEventCard.tsx:137`
(`<EventCoverMedia>` with NO `autoplay` / NO `playbackActive`).

**What it does.** The discover grid renders `businessEvents.map((be) => <BusinessEventCard .../>)`
inside a plain RN `<ScrollView>` (`DiscoverScreen.tsx:2242-2269`) — NOT a windowed
`FlatList`, so every business event mounts at once. `BusinessEventCard` passes the
cover straight to `EventCoverMedia` with no play props, so both default to `true`
(`EventCoverMedia.tsx:547-548`): `autoplay=true`, `playbackActive=true` ->
`shouldPlay=true`. On native there is no viewport gate (Finding A), so EVERY
business-event video cover in the list creates a player, buffers, AND
autoplay-loops (`loop` defaults true) concurrently.

**Why it burns bandwidth.** N concurrent, continuously-looping Cloudinary video
streams, where N = number of business events with `.mp4` covers currently in the
feed. Grows directly with supply. Worse, every filter change
(segment / genre / date — `DiscoverScreen` refilter) rebuilds `businessEvents` and
remounts all cards -> a re-download storm with no cache reuse.

**Directly contradicts its own contract.** `BusinessEventCard.tsx:9-10` header
comment claims video covers show "a static first-frame poster (autoplay disabled
for the grid)". The code never disables autoplay — the props were simply never
passed. Same pattern in `app-mobile/src/components/discover/TripCard.tsx:105`
(trip rail): `<EventCoverMedia>` with no play gate -> autoplay defaults true.

**Not covered by ORCH-1209.** ORCH-1209 only touched the swipe-deck
(`CuratedExperienceSwipeCard` / `SwipeableCards`) and the web `<video>`. It never
audited the DiscoverScreen grid/rails. These autoplay by default and always have.

**One-line fix direction.** Pass `autoplay={false} playbackActive={false}` at
`BusinessEventCard.tsx:137` and `TripCard.tsx:105` (poster-only grid, matching the
stated intent). Combined with Finding A's source gate, no bytes until tap.

---

## Finding C — MEDIUM / COMPOUNDING: no native cross-mount cache; detail screens always stream

**Files:** `EventCoverMedia.tsx:380` (per-mount player, no cache layer) plus the
detail screens that hard-code streaming:
`app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx:782-783`
(`autoplay={true} playbackActive={true}`),
`app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx:888-889`,
`app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx:853-854`.

**What it does / why it burns.** `useVideoPlayer` streams per-mount and keeps no
cross-mount disk cache, so Cloudinary's `cache-control: immutable, max-age=30d` is
ignored — every screen re-open re-downloads the same clip. This is verbatim
ORCH-1209's own "Cause #2" (`Mingla_Artifacts/ORCH-1209_COVER_VIDEO_BANDWIDTH.md`
line 10) which was EXPLICITLY DEFERRED: "Phase 2 (native caching) ... remain
deferred and unneeded at current scale" (close note, line 49). It was never
built. Each detail-screen open is a guaranteed full fresh download (single player,
so lower fan-out than B, but 100% hit rate and no cache reuse). As users grew
past "current scale," this compounds A and B.

**One-line fix direction.** Add a native cached-source layer (expo-video
`bufferOptions` + a persistent file cache, or `expo-file-system` download-once +
local `uri`) so a re-open reads from disk, honoring Cloudinary's immutable header.

---

## Server vector (question #3) — discover-cards is an ENABLER, not a direct streamer

`supabase/functions/discover-cards/index.ts` does NOT proxy or stream Cloudinary
media. It hands out URLs:

- `transformServablePlaceToCard` (`:895-896`) returns `image` (first NON-video
  URL) plus `images: storedPhotos` — the FULL ordered list, which can include a
  `.mp4` cover video; the client's `firstVideoUrl` (`app-mobile/src/utils/videoUrl.ts`)
  then detects it and mounts a player.
- Experience cards carry one `coverMediaUrl` each (`:414-417`), which can be a
  video.

So the server contributes zero delivery bytes itself, but it feeds video URLs to
every card; the actual download is 100% client-driven (Findings A/B/C). No
server-side fix needed for the bandwidth leak; the leak lives entirely in the
native client render path.

Image prefetch is image-only and safe: `DiscoverScreen.tsx:1793-1804` filters to
`coverMediaType === "image"` before `ExpoImage.prefetch`, and the deck prefetch
(`SwipeableCards.tsx:1077-1086`) prefetches `.image` (the still), not the video.
`deriveCoverPosterUrl` / `posterFor` only ever emit `.jpg` stills (adversarial
test A8) — posters never trigger a video fetch.

## Retry / re-fetch storms (question #5)

- No explicit retry loop on video error: the `statusChange` handler
  (`EventCoverMedia.tsx:389-397`) calls `onError()` (falls back to the hue band);
  it does not re-attach the source. Good.
- The real re-download amplifiers are (a) Finding C (no cache -> every remount
  re-streams) and (b) surfaces that remount whole lists on state change: the
  DiscoverScreen filter/refresh path (Finding B) and the deck dead-state recovery
  (`SwipeableCards.tsx:1097-1125`) / `refreshKey` changes, each of which tears
  down and rebuilds cards -> fresh downloads of every video cover in view.
- `loop=true` replays generally reuse the in-memory buffer, so looping is not the
  primary bandwidth driver; the initial per-mount download is.

---

## Is ORCH-1209's fix airtight? Web YES, native NO

- **Web:** `video.preload = "none"` (`EventCoverMedia.tsx:243`), imperative DOM
  `<video>`, poster set to the `so_0` still. A bot/SSR/desktop-WebKit load fetches
  the `.jpg` poster only, never the `.mp4`. This is correct and airtight; it
  explains the two ~0 GB days that justified the CLOSE.
- **Native:** the "fix" is a `play()`/`pause()` gate + a poster `<Image>` drawn
  over the player. NEITHER suppresses the download. The player is created with the
  source and buffers on mount. The CLOSE assumed "bots ~100% of the 216 GB" and
  ran only 2 post-fix days on web — it never proved native stopped streaming, and
  it shipped none of the native gate to devices ("merged but DARK"). The account's
  second death is consistent with the native vector never having been closed.

## Ranked remediation

1. **A (root):** native source-deferral in `EventCoverNativeVideo`
   (`EventCoverMedia.tsx:380`) — do not set the `.mp4` source until `shouldPlay`.
2. **B (fan-out):** `autoplay={false} playbackActive={false}` on
   `BusinessEventCard.tsx:137` and `TripCard.tsx:105`.
3. **C (compounding):** native disk cache honoring `max-age=30d`, and reconsider
   the always-on `autoplay playbackActive` on the three detail screens.

Fixing A alone neutralizes B and C's byte cost (a paused/off-screen player would
fetch nothing), so A is the single highest-leverage change and the true closer of
this leak. B is the cheapest immediate mitigation. All three are native-only and
require an app build or OTA to actually reach devices — a repo merge will not stop
the bleed on its own (the same "merged but DARK" trap that reopened ORCH-1209).
