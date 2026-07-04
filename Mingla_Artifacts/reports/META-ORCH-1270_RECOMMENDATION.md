# META-ORCH-1270 — Do we need Cloudinary? Recommendation + No-Break Migration Plan

**Date:** 2026-07-03
**Question (Seth):** "Do we really need Cloudinary? What is the cheapest and most sustainable alternative? Trace the entire pipeline — selection, upload, processing, every moving part."
**Answer:** **No, we don't need Cloudinary. Move cover-video to Bunny Stream.**

Backed by four traces: `PIPELINE_CLIENT.md`, `PIPELINE_SERVER.md`, `ALTERNATIVES_PRICING.md`, and the leak audit `MASTER_LEAK_REPORT.md`.

---

## 1. What Cloudinary actually does for us (the whole pipeline)

**Selection → Trim → Compress → Upload → Transcode → Poster → Deliver.**
- **Client (business app):** pick video (expo-image-picker native / file input web) → trim (native only, 29 s) → *opportunistic* compress (native only, ≥5 MB, non-deterministic "auto"; **web compresses nothing**) → upload the raw/loosely-shrunk file **directly to Cloudinary** with server-signed fields.
- **Cloudinary:** transcodes to a browser-safe ≤720p H.264/AAC MP4 ≤25 MB (the "eager" transform), makes a first-frame poster (`so_0`), fires a "ready" webhook, and serves both over its CDN.
- **Our server:** signs the upload, tracks a job through a state machine, validates the result, applies `cover_media_url` to the event/brand.

**Load-bearing Cloudinary capabilities:** signed direct upload · async transcode · ready-webhook · poster/thumbnail · delete API · CDN delivery. Because **web does no real compression and native's is non-deterministic, the transcode is genuinely needed** — we cannot just dump raw files on plain storage.

## 2. Do we need Cloudinary specifically? No.

Cloudinary powers **exactly one feature** (cover video). Every capability above has a direct equivalent on a purpose-built video host — and the pipeline **already has a provider seam** (`EVENT_COVER_VIDEO_PROVIDER`, default `cloudinary`) with a provider-agnostic core (job table, states, validation, progress UI). Swapping is **adding a lane behind an existing switch**, not a rewrite.

## 3. Cheapest + most sustainable: Bunny Stream

| Option | Transcode | Poster | Webhook | Direct upload | Overage behavior | Cost @ 1k / 10k / 50k plays/mo |
|--------|-----------|--------|---------|---------------|------------------|-------------------------------|
| **Bunny Stream** ✅ | Yes (free) | Yes | Yes | Yes (TUS/pre-signed) | **Prepaid bill; pauses if unpaid; never deletes** | **~$1 / ~$2.6 / ~$12.6** |
| Cloudflare Stream | Yes | Yes | Yes | Yes | Bill | ~$5.5 / ~$10 / ~$30 |
| Supabase Storage | **No** | **No** | n/a | signed | Bill (shared egress = availability risk) | ~$0 / ~$0 / +$30–90 — **but needs client compression + client poster** |
| Cloudinary (paid) | Yes | Yes | Yes | Yes | **Free tier = deletion**; paid = premium bill | Premium (highest per-GB) |

*(Prices 2026 web-sourced; 25 MB / 30 s clips, 500 stored.)*

**Why Bunny Stream wins:** it does everything Cloudinary did (so the app stays simple — no need to build deterministic client transcoding, which is painful on web), it's the cheapest by a wide margin, and its failure mode is a **prepaid bill that pauses delivery if unfunded — it can never delete your account.** That single fact removes the exact catastrophe that hit us twice.

**One caveat — Nigeria/Africa egress:** Bunny's *standard* network charges $0.06/GB for African delivery (6×). Given Mingla's Nigeria presence, we use Bunny's **Volume network ($0.005/GB)** — perfectly fine for muted 30 s loops — or price the standard network in (still cheap: ~$15/mo even at 50k African plays). Not a blocker.

## 4. Why this doesn't break anything

- The Cloudinary account is **already deleted** and there are **zero live cover videos** (verified: 0 across events/brands/venues). There is **no working production flow to break and nothing to migrate.**
- The provider seam already exists; we build the `bunny` branch **alongside** the Cloudinary code and prove it end-to-end before flipping `EVENT_COVER_VIDEO_PROVIDER`.
- The user experience (pick → trim → upload → cover appears) is **unchanged** — only the plumbing behind the switch changes.
- You hand a key to **Bunny (into Supabase secrets), not Cloudinary** — and never a free-tier account again.

## 5. The build (SPEC scope) — one project, done once

**A. Leak-proofing (needed on ANY host, do regardless):**
1. Native "preload none": don't source the player until it should play (`EventCoverMedia.tsx`); pass `autoplay=false playbackActive=false` to the discover grid (`BusinessEventCard`/`TripCard`).
2. Native on-device cache honoring the immutable header.
3. Storage reaping: destroy on supersede/failure/replace/cancel/delete + reaper cron.
4. Real server-enforced byte cap at upload-ack.

**B. Guardrails (must be live before any key goes in):**
5. Fix the usage alarm so it actually fires (handle null/per-metric; lower threshold; push/SMS not just email) — repoint it at Bunny's usage API.
6. A hard usage circuit-breaker in upload-intent (fail closed above ~90% of a set cap).

**C. Bunny provider branch (the migration):**
7. `upload-intent`: create a Bunny video + return its TUS/pre-signed upload URL (replaces Cloudinary signed fields).
8. `webhook`: handle Bunny's "encoding complete" callback (verify signature), set `processed_url` to the Bunny CDN URL.
9. `destroy`: Bunny delete-video API.
10. Poster: Bunny auto-thumbnail URL (replaces the `so_0` derivation).
11. Client (`eventCoverVideoProcessingService.ts`, the 7 couplings): add the Bunny upload leg (TUS/PUT).
12. Flip `EVENT_COVER_VIDEO_PROVIDER=bunny`; set Bunny secrets; verify end-to-end on a test brand; then remove the Cloudinary branch.

**Net effect:** cover video works exactly as before, costs ~$1–13/month at real scale, and can never again be deleted for overage.
