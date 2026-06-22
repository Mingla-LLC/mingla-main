# ORCH-1209 — Cover-video bandwidth leak: investigation + Phase-1 fix plan

**Affected Surfaces:** Consumer iOS + Android (`app-mobile`), Buyer/public Web + Business app (`mingla-business` public pages), via the shared renderer. Backend not touched in Phase 1. Admin not in scope.

## The problem (proven)
Cloudinary hit **747.88% of the Free plan** (199.88 GB delivered) — but the account holds only ~290 MB of assets (≈8 short cover videos, each transcoded to 0.3–2 MB). The entire bill is **delivery bandwidth**: the same ~8 tiny clips were each streamed end-to-end **~25,000×**. Transcode (0.5 credits) and storage (0.32) are noise. (Live `/usage` probe + byte-math: 200 GB ÷ ~1 MB ≈ 205k full downloads; 544,603 requests ÷ 205k ≈ 2.7 req/download = HTTP range fan-out.)

**Two independent causes (forensic, file:line in the investigation):**
1. **Eager fetch when nobody is watching** — public web pages render the cover `<video>` with `preload="auto"` (`packages/offering-rendering/EventCoverMedia.tsx:221`), so every link-preview unfurl, crawler, uptime check, and in-app browser downloads the WHOLE file on page load even though desktop WebKit blocks muted autoplay (shows a play button, never auto-plays). This machine traffic is the most plausible bulk of the 25,000×. Also one deck card autoplays off-screen (`CuratedExperienceSwipeCard.tsx:~351`) without the `isTopCard` guard the main deck uses (`SwipeableCards.tsx:~389`).
2. **No cache between views (native)** — `useVideoPlayer` streams per-mount and keeps no cross-mount disk cache, so a real user re-opening a screen re-downloads. Cloudinary's `cache-control: immutable, max-age=30d` is ignored by the native streaming player.

## Decision: Phase 1 = the free, add-nothing fixes (this ORCH). Phase 2 (caching) deferred + data-gated.
Cause #1 is the machine-scale bulk and is fixable with ZERO new dependencies/vendors/infra. Cause #2 (native re-download) mostly affects real-user data/battery, is NOT the current cost driver at low user count, and the fix ADDS a caching layer — so it is deferred and only built if the health-hub meter still shows a problem after Phase 1.

## Phase-1 fixes (this ORCH — keep autoplay, no visible change)
1. **Web: `preload="none"` + poster.** In the shared `EventCoverMedia.tsx` web path, change `video.preload = "auto"` → `"none"` and set a `poster` (the existing cover IMAGE, or a one-time first-frame still). Real viewers still play on tap/viewport (web never auto-played on desktop anyway); bots/unfurlers/off-screen now get the poster image, not a video download.
2. **Native: gate the off-screen-autoplaying card.** Add the `isTopCard`/visible-card guard to `CuratedExperienceSwipeCard` so it matches `SwipeableCards`. Only the on-screen card autoplays/streams.
3. **Poster everywhere a cover video renders.** Pass the existing cover image (or first-frame still) as the poster on web AND as the placeholder on native, so there's always an instant still frame and bots get an image.

NOT in Phase 1: native HTTP/disk caching (Phase 2, data-gated), CDN/storage migration (optional scale-proofing), dropping Cloudinary.

## Why no regressions / no visible change
- **Single chokepoint:** all cover media on all surfaces renders through `packages/offering-rendering/EventCoverMedia.tsx` — one change, consistent everywhere.
- **Image path untouched:** cover IMAGES already come from Supabase Storage (`eventCoverMediaService.ts`), not Cloudinary — only the video fetch-timing changes.
- **Only non-visible behavior changes:** off-screen cards + automated bots. Anything a real user looks at behaves identically (native autoplay on the visible card unchanged; web tap-to-play unchanged).
- **Regression surface already mapped** (the investigation lists every screen/card/page that renders a cover).
- **Reversible:** small contained changes (one attribute, one guard, one poster prop).
- **Verified + measured:** adversarial test across surfaces + the ORCH-1201 API-health hub already monitors Cloudinary `credits.used_percent` hourly → objective before/after proof.

## Open verify for SPEC/implement
- Confirm every cover-VIDEO row has a usable poster image source (cover image or first-frame); where none exists, generate a one-time first-frame still — NO new runtime dependency.
- Re-verify exact current line numbers (code may have shifted since the investigation).
- Confirm detail screens (single on-screen video, real viewer) need no change beyond the poster.
