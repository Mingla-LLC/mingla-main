# META-ORCH-1270 — Cloudinary Total-Footprint Leak Report (Master Synthesis)

**Date:** 2026-07-03
**Severity:** S0-critical (account DELETED → live media broken; 2nd recurrence)
**Status:** INVESTIGATE complete. Awaiting Seth's strategic decision before SPEC.
**Method:** 4 parallel read-only static forensic sweeps (no API key needed — old account is dead).

Per-vector reports:
- `META-ORCH-1270_VECTOR_A_DELIVERY_BANDWIDTH.md`
- `META-ORCH-1270_VECTOR_B_TRANSFORMATIONS.md`
- `META-ORCH-1270_VECTOR_C_UPLOAD_STORAGE.md`
- `META-ORCH-1270_VECTOR_D_CONFIG_MONITOR_CUTOVER.md`

---

## 1. One-paragraph truth

The account died a second time because **ORCH-1209 only ever fixed the web half of the leak.** The
native app never stopped streaming cover videos: the video player downloads the file the instant it
is created (the "gate" only *pauses*, which cancels nothing), the "On Mingla" discover grid autoplays
**every** video cover at once (the code says autoplay is disabled for the grid, but the setting was
never actually passed), and phones keep no cache so every screen re-open re-downloads. On top of that,
deleted/replaced/failed cover videos are **never purged** from storage, and the usage alarm we already
had **never actually fired** (it emails only, and hangs on a free-plan quirk that leaves it showing
green). Transformations and secret-exposure were both cleared — Cloudinary is used in **exactly one
feature** (cover video), and no key is baked into any app bundle.

## 2. Root-cause ranking (by contribution to the kill)

| # | Vector | What it is | Killed us? |
|---|--------|-----------|-----------|
| 1 | **A — native bandwidth** | Deployed apps still eagerly stream cover videos; grid streams ALL covers concurrently; no cache → re-download storms | **YES — the recurrence** |
| 2 | **D — blind monitoring** | Usage alarm wired on paper but never proven to fire; email-only; silent-null on free plan | **YES — why nobody caught it** |
| 3 | **C — storage orphans + no byte cap** | Superseded/failed/replaced covers never destroyed; raw source is permanent dead weight; server trusts client-declared file size | Slow compounding leak + abuse hole |
| 4 | **B — transformations** | Tiny, static, cache-friendly `so_0` poster only | **NO — exonerated** |

## 3. Findings in detail

### Vector A — Delivery / Bandwidth (THE recurrence)
1. `packages/offering-rendering/EventCoverMedia.tsx:380` — native `useVideoPlayer(uri)` buffers/downloads
   the `.mp4` on player creation, regardless of `shouldPlay`. ORCH-1209's native gate only calls
   `player.pause()` — it does NOT release the source or cancel the download. The web `preload="none"`
   has **no native counterpart** (`useInViewport` hard-returns `true` on native). Applies to every
   surface, off-screen and behind-card included; re-downloads per mount (no native cache).
   **Fix:** create the player with a null source; `player.replaceAsync(uri)` only on first `shouldPlay`
   (native "preload none").
2. `app-mobile/src/components/discover/BusinessEventCard.tsx:137` (+ `TripCard.tsx:105`), fed by a
   non-windowed `ScrollView` (`DiscoverScreen.tsx:2246`) — `<EventCoverMedia>` is passed **no**
   `autoplay`/`playbackActive`, both default `true` → every business-event & trip video cover in the
   grid autoplay-loops and streams concurrently. The file header even claims "autoplay disabled for the
   grid" — the props were never wired. Unbounded (grows with supply); each re-filter remounts = a
   re-download storm. **Fix:** pass `autoplay={false} playbackActive={false}`.
3. Detail screens hard-code `autoplay playbackActive` (`ConsumerEventDetailScreen.tsx:782`,
   `ConsumerTripDetailScreen.tsx:888`, `ConsumerExperienceDetailScreen.tsx:853`) and there is **no
   native disk cache**, so Cloudinary's `cache-control: immutable, max-age=30d` is ignored — every
   screen re-open re-downloads. This is ORCH-1209's own "Cause #2," deferred to a Phase 2 never built.
   **Fix:** a native cached-source layer honoring the immutable header.

**Native-eager-stream question: YES.** The shipped native app still eagerly streams cover videos.

### Vector B — Transformations (exonerated)
- No per-render / per-viewport / `dpr_` / `w_${width}` / cache-busted transform exists anywhere.
- Cloudinary is used in **exactly one feature** (event/brand cover-video). Place photos, avatars,
  thumbnails, marketing images all run on **Supabase Storage / Google `lh3` CDN**, never Cloudinary.
- `deriveCoverPosterUrl` (`coverMediaPresentation.ts:78`) emits a static `so_0` first-frame `.jpg` —
  deterministic per immutable `cover_media_url`, cached after first hit. No cost problem.
- Eager derivative (`event-cover-video-upload-intent/index.ts:313-321`) is one static joined transform,
  `eager_async`. Its bytes fall under Vector C's non-reaping problem, not a transform-count problem.

### Vector C — Upload / Storage
- **Signed uploads (good).** No `upload_preset` exists; signature is `SHA-1(sorted params + secret)`
  server-side (`_shared/eventCoverVideo.ts:266-274`), auth+role gated. No anonymous/forged uploads.
- **No real server-side byte cap (bad).** The 100 MB / 60 s checks validate the client-*declared*
  `sourceBytes`/`sourceDurationMs` (`upload-intent/index.ts:138,146-176`), decoupled from the actual
  file POSTed. A client can declare 1 MB, get a valid signature, upload 5 GB. The true byte count is
  even known at ack time (`event-cover-video-source-uploaded/index.ts:132-140`) but never enforced.
- **No cleanup-on-delete (bad).** `cloudinaryDestroy` (`_shared:276-324`) is reachable only via explicit
  user cancel. No destroy on supersede, retry, failure, cover-replace, draft-abandon, or event/user
  delete; no reaper cron. Applied covers also permanently retain the raw source.
- **Fixes:** destroy on supersede/failure/replace/cancel/delete; add a reaper cron; enforce the real
  byte cap at ack (destroy + fail if actual > cap); re-host the derivative and destroy the raw source
  after apply; set a Cloudinary account max-file-size backstop.

### Vector D — Config / Monitoring / Cutover
- **(a) No secret in any client bundle — proven.** `CLOUDINARY_API_SECRET` is read only via
  `Deno.env.get` inside `supabase/functions/**`. The `dhza7d54o` cloud name is NOT hardcoded in shipped
  code (only test fixtures + `.md` docs). The API *key* is fetched per-upload from the edge fn (standard
  signed-upload pattern — public, never baked in). **Cutover is a secrets swap, no app build for the key.**
- **(b) The monitor never proved it alerts.** A path exists on paper: hourly pg_cron → `probeCloudinary`
  reads `credits.used_percent` → `evaluateBalanceForSignal` flags ≥80% → one-shot "💳 Cloudinary balance
  low" **email to seth@usemingla.com** via Resend. **Email-only — no push/SMS/Slack.** It hangs on ~7
  silent-failure conditions; **prime suspect:** the FREE-plan `/usage` may not return a numeric
  `credits.used_percent` → the `typeof === "number"` guard yields `null` → status stays `healthy` → no
  email, dot stays green. Suspension also triggers on per-metric caps this single field may not track.
  Matches "died twice with no warning."
- **(c) Cutover checklist (guardrails FIRST):**
  1. Quantify blast radius: `SELECT count(*) … WHERE cover_media_url ILIKE '%dhza7d54o%'` (expected ~0 post-wipe).
  2. Prove the monitor can see the new account (`/usage` returns numeric `used_percent`; else extend probe to per-metric blocks).
  3. Verify alert plumbing end-to-end (cron scheduled; vault secrets; `cloudinary` alert-state row seeded; migrations applied; `RESEND_API_KEY` non-sandbox; Seth on recipients). Lower warn to ~50-60%. **Add push/SMS, not just email.**
  4. Add a hard pre-upload usage **circuit-breaker** in `event-cover-video-upload-intent` (none today) — fail closed above ~90%.
  5. Swap secrets (the cutover): `supabase secrets set CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET --project-ref gqnoajqerqhnvulmnyvv` — one update covers all 5 consumers.
  6. Redeploy the 4 edge fns; verify each with one live call.
  7. Confirm webhook signature verification passes on the new secret.
  8. `preload=none` leak-proofing is WEB-only → ships via web export, NO native build. The native fixes (Vector A) need an OTA/build.
  9. Repair dead rows only if step 1 finds meaningful counts — must be RE-UPLOAD (old assets are gone), not a string swap.

## 4. The strategic fork (Seth's decision)

The bandwidth leak comes from **already-installed app builds.** Fixing the code does not retroactively
fix phones already in the wild — they keep streaming until each user updates. On a FREE plan that will
kill a new account again as supply grows, no matter how clean the new code is. So the real question is
**what the new account should be**, and there are two honest paths (not mutually exclusive):

- **Path 1 — Harden & stay on Cloudinary (fast).** Land the native fixes + storage reaping + a working
  alarm + an upload circuit-breaker, put the new account on a **paid plan with a hard billing cap** (no
  hard-delete on paid), swap the key. Bridges the "old builds still bleed" window with money instead of
  risk. Cheapest engineering, ongoing cost, keeps a vendor whose free tier already bit us twice.
- **Path 2 — Migrate cover-video OFF Cloudinary (permanent).** Because Cloudinary powers **exactly one
  feature** and images already live on Supabase Storage, moving cover-video to Supabase Storage /
  Cloudflare Stream / bunny.net **eliminates the entire Cloudinary dependency and its free-tier
  fragility.** More engineering up front; kills the whole problem class permanently; no vendor lock-in.

**Recommendation:** land the guardrails + native fixes + storage reaping **regardless of path** (they
are required either way), and choose **Path 2 (migrate off)** as the permanent posture *if* we can
absorb the build cost soon — with **Path 1 as the bridge** (paid Cloudinary with a cap) so we are never
blind again while the migration ships. The one thing we must NOT do: drop a new FREE Cloudinary key in
behind the current leaky builds and hope.

## 5. Non-negotiable gate before the new key goes in

No matter the path, these must be live **before** the new key is active, or a 3rd kill is inevitable:
- A usage alarm that is **proven to fire** (handles the null/per-metric case; push/SMS not just email; warn lowered).
- A **hard server-side circuit-breaker** on uploads (fail closed above ~90%).
- A **real server-enforced byte cap** at upload-ack (destroy + fail on oversize).
- The native eager-stream fixes merged (they ship to users on the next build/OTA, but must exist in code).
- **Storage reaping** on supersede/failure/replace/delete + a reaper cron.
