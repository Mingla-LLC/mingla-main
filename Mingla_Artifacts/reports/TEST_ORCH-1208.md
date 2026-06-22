# TEST — ORCH-1208 [cover-video bandwidth fix — Phase 1]

**Phase:** TEST (brutal gatekeeper, independent adversarial). **Verdict: CONDITIONAL PASS.**
**Worktree / branch:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1208-[cover-video-bandwidth-fix]/` on `ORCH-1208-cover-video-bandwidth-fix`.
**Implementor commit under test:** `afec5639f` (code) + `2f6b35de1` (report).
**Tester adversarial commit:** `88bd22b9f`.
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1208_cover_video_bandwidth.md`.

---

## Verdict

**CONDITIONAL PASS.** Every claim provable without a deploy is **VERIFIED** with independent,
different-angle evidence (including a REAL headless-Chromium network proof that `preload="none"` +
poster downloads **0 bytes of `.mp4`** in a bot context while a real viewer's autoplay **still
fetches + plays**). The two things that matter most are proven at runtime in principle and at the
source anchor for the shipped code. The only items that cannot be closed pre-merge are inherently
**RUNTIME-GATED**: the live network proof against the *deployed* public page and on-device autoplay
parity. Both have an exact post-merge checklist below. No defects found; scope honored; zero new
dependency; image path byte-identical.

---

## What I attacked (DIFFERENT angles than the implementor)

The implementor's suite is entirely **source-structural greps** + a 4-example `deriveCoverPosterUrl`
unit. I did NOT re-run those as my proof. My evidence is:

1. **A REAL browser network proof** — `mingla-business/playwright/orch1208-cover-video-bandwidth-runtime-probe.mjs`.
   Drives headless Chromium against a logging server, reproducing the **exact shipped imperative
   `<video>` attribute sequence** (read+anchored from `EventCoverWebVideo` source), and measures the
   actual bytes. This is the bandwidth proof the implementor could not run (no jsdom/browser in their
   bed).
2. **Derivation EDGE cases** the implementor never tested (uppercase ext, no-extension, nested
   Cloudinary transforms, multi-param query, `/image/upload/` near-miss, protocol-relative, garbage,
   numeric abuse) — `orch_1208_bandwidth_adversarial.test.ts`, group A.
3. **The `resolvedPosterUrl` GATING contract** (image-cover can never receive a poster) — group B.
4. **The native `shouldPlay` BOUNDARY** (`isTopCard=false ⇒ shouldPlay=false`) — group C.

---

## P0 — must hold for ship (the two things that matter most)

### P0-a — bots/SSR/off-screen no longer download the video  → **VERIFIED (runtime, principle) + RUNTIME-GATED (live page)**
Real headless Chromium, self-contained mode (`88bd22b9f` probe):
```
BOT        (preload=none, no autoplay): mp4=0 jpg=1   → PASS no eager download, poster fetched
REALVIEWER (preload=none, autoplay):    mp4=1 jpg=1   → PASS plays/fetches (autoplay intact)
REVERTED   (preload=auto, no autoplay): mp4=1 jpg=1   → PASS confirms the bug the fix closes
```
The browser semantics the fix relies on are **empirically true**, not assumed. The probe is anchored
to the shipped `EventCoverWebVideo` source (reads `video.preload="none"` + `video.poster` + the
muted/playsinline attribute pins) so a future revert fails it (see fails-on-revert). **Web off-screen
is additionally already gated** by the pre-existing `useInViewport` IntersectionObserver (rootMargin
400px, `EventCoverMedia.tsx:507/665`) — off-screen web cards never even mount the `<video>`.
→ RUNTIME-GATED remainder: the same probe against the *deployed* `/e/<slug>` page (`ORCH1208_LIVE_URL`).

### P0-b — a real viewer's autoplay is UNCHANGED  → **VERIFIED (web runtime + source) + RUNTIME-GATED (native device)**
- **Web:** REALVIEWER case above fetched + played the `.mp4` with `preload="none"`. The 6 ORCH-1167
  cover-contract suites (R4/R5/R6/R7/R8 imperative-mount, muted-first autoplay, loop, aspect-ratio,
  teardown) still pass **33/33** unchanged — autoplay path untouched.
- **Native:** source-proven — `EventCoverMedia.tsx` resolves `shouldPlay = autoplay && playbackActive`
  in `EventCoverNativeVideo`; the active card threads `isTopCard={true}` from the Current-Card slot
  (`SwipeableCards.tsx:2955`) ⇒ `shouldPlay=true` ⇒ `player.play()`. The poster `<Image>` sits BEHIND
  the opaque playing `VideoView` (invisible while playing). The I-1069 / ORCH-1167 one-playing-deck
  contract is intact (CardHero unchanged, still `autoplay={isTopCard} playbackActive={isTopCard}`).
  → RUNTIME-GATED: on-device confirmation the visible experience card still autoplays muted-looping.

---

## P1 — correctness of the supporting machinery (all VERIFIED)

| # | Claim | Evidence | Result |
|---|---|---|---|
| P1-1 | Native gate: off-front card streams nothing | `shouldPlay=autoplay&&playbackActive`; card binds BOTH to `isTopCard`; no bare `autoplay`. Adversarial group C + fails-on-revert (C2 fails when the bare-autoplay form is reverted). | VERIFIED |
| P1-2 | Native gate: active card DOES stream | `isTopCard={true}` at both experience + curated Current-Card renders (`SwipeableCards.tsx:2955,2967`) ⇒ `shouldPlay=true`. | VERIFIED |
| P1-3 | `deriveCoverPosterUrl` Cloudinary → `so_0` `.jpg` | Pure-fn run + 8 adversarial edge cases — none throw; correct null-vs-jpg on each. | VERIFIED |
| P1-4 | Non-Cloudinary / non-video / null/garbage → `null` graceful | Group A5/A7 (incl. numeric abuse `12345 as never` → null, no throw). | VERIFIED |
| P1-5 | Derived poster is ALWAYS a `.jpg`, never an `.mp4` | Group A8 — a poster can never itself trigger a video download. | VERIFIED |
| P1-6 | Image/GIF cover path byte-identical | `resolvedPosterUrl` null unless video/video_still; the `<Image source={{uri:mediaUrl}}>` branch never receives `posterUrl`; `resizeMode="cover"` untouched. Group B1/B2/B3. | VERIFIED |
| P1-7 | Invariant gate ACTUALLY enforces | Independently reintroduced `preload="auto"` → gate **exit 1**; removed poster → gate **fails**; restored → **exit 0**. Self-test passes (detects synthetic violations). | VERIFIED |
| P1-8 | Zero new dependency / no backend / no migration | `git diff` of package/lock files = empty; only EventCoverMedia + coverMediaPresentation + 1 card + caller + gate + tests changed. | VERIFIED |

---

## P2 — residual / out-of-scope (documented, accurate)

- **P2-1 — Discover-grid native streaming (SECONDARY RISK).** `discover/BusinessEventCard.tsx` and
  `discover/TripCard.tsx` render `<EventCoverMedia>` with **no** `autoplay`/`playbackActive` props →
  both default `true` → on native, all N video-cover grid cards stream (no native in-view gate).
  **Confirmed untouched** by this ORCH (`git diff` empty for both). The spec correctly flags this as
  the Phase-1.5 follow-on; the web `preload=none`+poster chokepoint win still reaches them. The
  BusinessEventCard header comment ("autoplay disabled for the grid") is **inaccurate for native** —
  worth a one-line correction when Phase-1.5 lands, but not a blocker.
- **P2-2 — degenerate poster URL.** `deriveCoverPosterUrl("…/video/upload/")` → `"…/so_0/.jpg"`
  (no crash; Cloudinary 404 → image error → hue-band fallback → still no eager video download).
  Benign; only reachable for a malformed `cover_media_url` that is also `mediaType:"video"`.
- **P2-3 — non-Cloudinary cover videos** (legacy Supabase `.mp4`, if any) get no derived poster →
  hue-band placeholder, still no eager download. Acceptable per spec RISK #1.

---

## RUNTIME / LIVE-FIRE CHECKLIST (post-merge close criteria)

1. **Live bandwidth proof (authoritative P0-a).** After the web/JS deploy:
   ```
   ORCH1208_LIVE_URL="https://<vercel-preview-or-prod>/e/<slug-with-video-cover>" \
     node mingla-business/playwright/orch1208-cover-video-bandwidth-runtime-probe.mjs
   ```
   PASS = **0** `.mp4` / `/video/upload/` requests on a bot (headless, no gesture) load of the real
   shipped page; the poster `.jpg` IS present. Repeat for a public experience page and a public
   event page.
2. **On-device autoplay parity (P0-b).** On a real iPhone + Android, open the consumer deck on an
   experience-cover brand: the **visible front experience card still autoplays muted-looping**, and
   the detail-screen hero autoplays. Record before/after (no flash-of-black; poster appears first).
3. **Cloudinary meter close criterion (the objective win).** Watch the ORCH-1201 API-health hub
   Cloudinary `credits.used_percent` (hourly). Capture the value at merge; **confirm the delivery /
   credit-usage curve flattens** over the following 24–72h. The fix is "closed" only when the meter
   visibly drops off its 748%-of-free-plan trajectory. If it stays hot, ship the **Phase-1.5**
   Discover-grid native gate (P2-1) — the next-largest lever.

---

## Adversarial test artifacts + fails-on-revert proof

- **`mingla-business/playwright/orch1208-cover-video-bandwidth-runtime-probe.mjs`** (NEW, runtime).
  Fails-on-revert: with `preload="none"`→`"auto"` reverted in the shipped `EventCoverMedia.tsx`, the
  probe's source anchor refused to run and exited **1** (restored → exit **0**). Proven this session.
- **`packages/offering-rendering/__tests__/orch_1208_bandwidth_adversarial.test.ts`** (NEW, 14 asserts).
  Fails-on-revert: reverting the card's `playbackActive={isTopCard}` to the bare-`autoplay` form →
  **C2 FAILED** (1 failed / 13 passed); restored → **14/14 passed**. Proven this session.
- Both are **append-only** (new files; append-only check passed) and committed at **`88bd22b9f`**.

## Suites run (this session, all green)
- `orch_1208` + `coverWebVideoImperativeMount` + `coverWebVideoAutoplay` + `orch_1167_r4/r5/r7`:
  **7 suites / 47 tests passed** (incl. my adversarial suite + the autoplay-contract regressions).
- Strict-grep gate `i-proposed-1208-no-eager-video-preload.mjs`: self-test PASS, run PASS, **and
  independently proven to fail on `preload=auto` reintroduction and on poster removal**.
- Type-check: 2 changed app-mobile files (`CuratedExperienceSwipeCard`, `SwipeableCards`) → **0
  errors**; `coverMediaPresentation.ts` helper clean. (`EventCoverMedia.tsx` cross-package
  `Cannot find module 'react'` cascade is a pre-existing env artifact, not introduced here.)
- Zero new dependency confirmed (empty package/lock diff).

---

## Bottom line
The fix does exactly what the spec contracts: bots/SSR/off-screen stop eagerly downloading the cover
`.mp4` (proven at the browser-semantics + source level), real-viewer autoplay is preserved (web
proven at runtime, native proven at source + I-1069 contract), the image path is byte-identical, the
gate enforces, and there's no new dependency. **CONDITIONAL PASS** — clear to merge/deploy; close
only after the post-merge live bandwidth proof, on-device autoplay parity, and the Cloudinary-meter
drop in the checklist above.
