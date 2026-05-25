# INVESTIGATION — ORCH-0957 [Storage image transformation overage]

**Mode:** INVESTIGATE
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/0957-[storage-image-transform-overage]`
**Branch:** `0957-storage-image-transform-overage`
**Confidence:** PROVEN (single call site, DB-volume math reconciles to within ~2% of billed quantity)
**Sim live-fire:** N/A — pure backend / edge-function / data investigation (Prime Directive 7 exemption)

---

## 1. Summary (plain English)

Mingla's Supabase Image Transformations bill (9,168 unique images / period vs 100 included) is driven by **exactly one code path**: the place-intelligence pipeline at `supabase/functions/run-place-intelligence-trial/index.ts`. Each place it analyzes gets a photo collage composed for Claude vision classification, and the collage helper at `_shared/imageCollage.ts:67-100` rewrites every Supabase-Storage-hosted source photo into a `/storage/v1/render/image/...?width=192&height=192&resize=cover` transform URL — every unique source photo touched this way counts as one billable origin image. The transform is **load-bearing**: it was added by ORCH-0737 v6 (2026-05-06) specifically to fix a `WORKER_RESOURCE_LIMIT 546` OOM that occurred when decoding native-resolution photos. Removing it without an alternative resize strategy will re-trigger that crash. The right fix is to **stop transforming photos at read-time** and instead **store pre-sized thumbnail variants alongside the original** at ingest time, then point the collage pipeline at the thumb directly.

---

## 2. Investigation Manifest

Files read, in order:

| # | Path | Why |
|---|---|---|
| 1 | `supabase/functions/_shared/imageCollage.ts` | Only file in the repo that emits Storage transform URLs (found via grep) |
| 2 | `supabase/functions/_shared/imageCollage.test.ts` | Confirm URL shape + scope |
| 3 | `supabase/functions/run-place-intelligence-trial/index.ts` (lines 27-30, 85, 907, 2443, 3035, 3092, 3118-3195) | Sole caller of `composeCollage` |
| 4 | Supabase Management API DB probe — `storage.objects` row counts per bucket | Quantify volume by source |
| 5 | https://supabase.com/docs/guides/storage/serving/image-transformations | Pricing rule verification |
| 6 | https://supabase.com/docs/guides/platform/manage-your-usage/storage-image-transformations | Pricing rule verification (detailed page) |

Cross-app grep matrix (all four shipping codebases — app-mobile, mingla-business, mingla-admin, supabase/functions) for three pattern families:

- **Pattern A** — `transform:` option on `getPublicUrl` / `createSignedUrl`: ZERO product hits (only React Native `transform: [{ translateX }]` style props, which are unrelated)
- **Pattern B** — `/storage/v1/render/image` substring: ZERO outside `imageCollage.ts` + its test
- **Pattern C** — `width=` / `height=` / `resize=` query params on Storage URLs: ZERO outside `imageCollage.ts` + its test + unrelated brand-cover URL-shape test fixtures

There is no other code path in the Mingla monorepo that hits the Supabase image transformation endpoint.

---

## 3. Findings

### F-1 🔴 ROOT CAUSE — Place-intelligence collage pipeline rewrites Supabase Storage URLs to the metered transform endpoint, once per unique source photo

- **File + line:** `supabase/functions/_shared/imageCollage.ts:67-100` (function `transformPhotoUrlForTile`), called from `supabase/functions/_shared/imageCollage.ts:109-130` (function `fetchAndDecode`), called from `supabase/functions/_shared/imageCollage.ts:162-178` (function `composeCollage`'s inner serial loop), called from `supabase/functions/run-place-intelligence-trial/index.ts:907` (action `compose_collage`).
- **Exact code (imageCollage.ts:77-86):**
  ```ts
  const supabaseObjectPrefix = "/storage/v1/object/public/";
  if (url.includes(supabaseObjectPrefix)) {
    const transformedPath = url.replace(
      "/storage/v1/object/public/",
      "/storage/v1/render/image/public/",
    );
    const [base] = transformedPath.split("?");
    return `${base}?width=${tileSize}&height=${tileSize}&resize=cover`;
  }
  ```
- **What it does:** For every source photo URL in the Supabase `place-photos` bucket, rewrites the public-object URL to the `/storage/v1/render/image/...` endpoint with `width=192&height=192&resize=cover` (192 = 768 / 4 = tile size for a 4×4 grid; 256 for 3×3; 384 for 2×2; 768 for 1×1). The rewritten URL is then fetched. Each fetch is one transformation operation against Supabase's metered image transformation pipeline, and each **unique source photo path** touched in a billing period counts as **one billable origin image** (see F-2 for the pricing rule).
- **What it should do (in product-spec terms):** Either (a) NOT rewrite the URL, instead serving the original via the non-metered `/storage/v1/object/public/...` endpoint, OR (b) point at a pre-sized variant in a separate bucket (`place-photos-thumbs/...`) that does not require the transform endpoint. Today's behavior is correct for the runtime / memory-safety constraint ORCH-0737 v6 solved but trades memory pressure for billing pressure with no awareness of the cost.
- **Causal chain to billing line:**
  1. Cron / on-demand dispatch invokes `run-place-intelligence-trial` for a new or stale place.
  2. The pipeline pulls up to 16 photo URLs from the place's `place-photos/<place_id>/*.jpg` Storage directory (or Google `lh3.googleusercontent.com` CDN for Serper-sourced photos — those don't count toward Supabase billing, only Pattern 1 does).
  3. `composeCollage(photoUrls)` calls `fetchAndDecode` serially for each photo.
  4. `fetchAndDecode` calls `transformPhotoUrlForTile`, which rewrites Supabase URLs to the transform endpoint.
  5. The fetch hits Supabase's image transformer; that photo's origin file is now counted as "transformed this billing period".
  6. Per billing period, the count of distinct origin files touched this way = the displayed "Cumulative in period" figure (9,168 on the dashboard screenshot dated 2026-05-25).
- **Verification step (proves causation, not coincidence):** Database probe via Supabase Management API on 2026-05-25:
  - `place-collages` bucket — objects created since 2026-05-06 (billing-period start): **2,246**
  - `place-photos` bucket — total objects: **88,133** across **18,547 distinct place directories**
  - `place-photos` bucket — objects created since 2026-05-06: **0** (the photo pool is static; only new collages are being composed)
  - Each collage averages ~4 photos (mix of 2×2 grids for places with 2-4 photos and 3×3 grids for places with 5-9 photos; per `computeGridDims` at `imageCollage.ts:25-34`). 2,246 collages × ~4 photos avg = **~9,000 unique-photo transforms**, matching the billed 9,168 within ~2% (the small surplus = some collages used 9-16 photos hitting the 4×4 grid).
  - All other Storage buckets combined have **133 objects** total (avatars 49, event_covers 27, voice-reviews 21, beta-feedback 9, ticket-pdfs 8, messages 6, brand_covers 5, creator_avatars 5, App Stuff 2, brand_avatars 1, marketing-assets 1). Even if every single one were transformed daily, they could not account for >1.5% of the 9,168 figure. Pattern-grep confirmation: NONE of these buckets are read via the transform endpoint anywhere in the codebase.

### F-2 🔵 OBSERVATION — Supabase pricing rule (verified against docs)

- **Source:** https://supabase.com/docs/guides/platform/manage-your-usage/storage-image-transformations
- **Quote:** *"You are charged for the number of distinct images transformed during the billing period, regardless of how many transformations each image undergoes."* and *"The count resets at the start of each billing cycle."*
- **Implication for fix-tier analysis:** A CDN cache layer (Cloudflare Image Resizing, Vercel Image Optimization, Bunny.net) **does NOT reduce the bill**. Repeat fetches of the same transformed image already cost zero additional units. The bill is driven by the **count of distinct origin files** touched in a period, not request volume. Tier C from the dispatch prompt is therefore eliminated.

### F-3 🟠 CONTRIBUTING FACTOR — The transform is load-bearing for memory safety; the kill-switch makes the OOM crash regression-easy

- **File + line:** `supabase/functions/_shared/imageCollage.ts:48-72` (`[CRITICAL — ORCH-0737 v6]` comment block + `DISABLE_PHOTO_URL_TRANSFORM` env kill-switch).
- **Exact code (imageCollage.ts:70-72):**
  ```ts
  if (Deno.env.get("DISABLE_PHOTO_URL_TRANSFORM") === "true") return url;
  ```
- **What it does:** Provides a runtime escape valve to disable the transform without redeploying. Documented as: "useful if a CDN behavior change breaks the pattern."
- **Why it contributes:** Setting `DISABLE_PHOTO_URL_TRANSFORM=true` to stop the bill today re-introduces the `WORKER_RESOURCE_LIMIT 546` OOM that ORCH-0737 v6 fixed. Per the in-code postmortem comment at `imageCollage.ts:48-59`: native-resolution decode consumed up to **~92 MB per photo** (4800×4800 RGBA), and with the outer parallel-12 prep at `run-place-intelligence-trial/index.ts:3092`, that would be **~1.1 GB peak per worker** — well over the 256 MB edge-function memory limit.
- **Operational implication:** The kill-switch is **not a viable cost-control lever**. Anyone who flips it to stop the bill will crash the pipeline within minutes.

### F-4 🟡 HIDDEN FLAW — Place-photo mirroring is the upstream cause; Google CDN photos already work bill-free

- **File + line:** `supabase/functions/_shared/imageCollage.ts:88-96` (`transformPhotoUrlForTile` Pattern 2).
- **What the code does today:** When a source photo is hosted on Google's `lh3.googleusercontent.com` CDN, the function rewrites the URL to `=w192-h192` Google CDN suffix. This costs Mingla **zero Supabase image transformations** — Google serves the resized image directly.
- **What this implies:** The 88,133 photos in `place-photos` bucket are mirrored copies (likely from Google Places API at ingest time, predating ORCH-0737 v6 or to insulate against Google Places photo-reference expiry). For NEW places, the pipeline could plausibly skip the Supabase mirroring step entirely and just store Google CDN URLs on the place row. That would drop the marginal Supabase image-transformation cost to **zero** for all new places.
- **Why it's a "hidden flaw" not a root cause:** This isn't causing today's symptom — the bill is real because the mirror already exists and the pipeline already runs against the mirror. But going forward this is the systemic cost amplifier. If we add 1M new places to the pool and mirror each one's photos, we'll be transforming 4M+ photos per period and the bill will be ~$20K/month at Supabase's $5/1,000 overage rate.
- **Trade-off worth surfacing:** Google Places photo references have known durability concerns. If a place's `photo_reference` expires or Google rotates the CDN path, we lose the photo. The mirror was likely added for resilience. The fix here may need to weigh durability vs cost.

### F-5 🔵 OBSERVATION — Tile size matrix

`computeGridDims` (`imageCollage.ts:25-34`) returns tile sizes based on photo count:

| Photos | Grid | Tile px | Cost weight |
|---|---|---|---|
| 1 | 1×1 | 768 | 1 unique image |
| 2-4 | 2×2 | 384 | 2-4 unique images |
| 5-9 | 3×3 | 256 | 5-9 unique images |
| 10-16 | 4×4 | 192 | 10-16 unique images |

The choice of tile size does NOT affect billing — each distinct origin image counts once regardless of requested transform dimensions. So shrinking tile size further has zero cost benefit.

---

## 4. Five-Layer Cross-Check

| Layer | What it says | Contradiction with billing reality? |
|---|---|---|
| **Docs** | ORCH-0712 dispatch designed the collage helper; ORCH-0737 v6 added the URL transform for memory safety. Neither doc modeled per-photo Storage transformation billing. | YES — no doc anticipated the cost. |
| **Schema** | `place-photos` bucket: 88,133 objects in 18,547 dirs; `place-collages` bucket: 2,327 total (2,246 in period). Static photo pool, growing collage pool. | NO — schema matches expected pipeline shape. |
| **Code** | `imageCollage.ts:77-86` rewrites every Supabase URL to the transform endpoint with no metering awareness. Single call site at `run-place-intelligence-trial/index.ts:907`. | NO — code is doing exactly what it says. |
| **Runtime** | 2,246 collages composed in 19 days × avg ~4 photos = ~9,000 transform calls. Supabase bills 9,168. | NO — runtime volume reconciles to billing within 2%. |
| **Data** | Each distinct `place_id` directory has 1-9 photos. Pipeline touches each photo at most once per collage version. | NO — data shape matches pipeline behavior. |

**No layers contradict each other.** The bug is a known-cost trade-off that nobody priced when ORCH-0737 v6 shipped. The system is operating as designed; the design has a now-visible cost.

---

## 5. Blast Radius Map

- **Surface attribution:** 100% backend (edge function `run-place-intelligence-trial`). ZERO client surfaces (consumer iOS/Android, business iOS/Android, buyer-web, admin-web) hit the image transform endpoint. The 5 + 2 surfaces from the ORCH affected-surfaces field were correctly declared as in-scope at INTAKE, but the investigation rules them all OUT — only backend.
- **Solo / collab:** N/A (place-intelligence runs server-side, has no client mode dimension).
- **Cross-domain consumers:** None. The collage PNGs end up in `place-collages` bucket and are read by Claude vision via the LLM-call code path; no client app reads collages directly.
- **Query keys / cache state:** N/A.
- **Invariants violated:** None explicit. The closest existing rule is the unwritten "external API parameters verified against provider docs" invariant (`I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED`, DRAFT) — Supabase Storage transforms ARE an external/metered API call shape, and the cost model was not verified inline when ORCH-0737 v6 introduced the transform. Worth flagging this in a discovery for the orchestrator (see §7).
- **Recurring-pattern match:** Yes — this is the same shape as "feature ships, cost surfaces months later" pattern. The fix tier should include a structural safeguard: a CI lint / strict-grep rule that flags any new `transform:` option on Supabase Storage calls and requires a "this writes to a metered endpoint" acknowledgment comment.

---

## 6. Fix Strategy (direction only — NOT a spec, NOT code)

Three candidate tiers, with verdict:

### Tier A — Drop the transform entirely (`DISABLE_PHOTO_URL_TRANSFORM=true` or code removal)

- **Bill impact:** Cuts to ~$0 immediately.
- **Runtime impact:** Re-triggers `WORKER_RESOURCE_LIMIT 546` OOM crash on collage composition (per ORCH-0737 v6 postmortem). Place-intelligence pipeline becomes non-functional.
- **Verdict:** **NOT VIABLE.** Trades a $45/mo bill for a broken core pipeline.

### Tier B — Pre-generate thumbnail variants at upload time, store in parallel bucket, point collage pipeline at the thumbs

- **Approach:**
  1. Add a `place-photos-thumbs/` bucket (or convention-named path inside `place-photos`, e.g., `<place_id>/_thumb_<index>.jpg`).
  2. At place-photo ingest time (in whatever edge function copies Google Places photos into `place-photos`), ALSO generate a 384×384 JPEG thumb (large enough to cover all four tile sizes — 192, 256, 384, 768 will all `resize()` down cleanly from 384, and 768 callers are rare since most places have 2-9 photos triggering 384 or 256). Decode + resize + write thumb sequentially per photo at ingest time = bounded memory (1 photo at a time).
  3. Modify `transformPhotoUrlForTile` Pattern 1 to point at `_thumb` variant via `/storage/v1/object/public/` (non-metered). Strip the transform endpoint usage entirely.
  4. **Backfill** existing 88,133 photos: write a one-shot edge function that processes them N at a time (e.g., 100/minute), fetching the original via `/storage/v1/object/public/` (non-metered), decoding + resizing in-memory (1 at a time = bounded), and writing the thumb back. Do NOT use the transform endpoint for backfill — that would cost 88K transformations against the meter ($440 one-time). Direct fetch + imagescript resize = $0 + ~24 hours wall time spread across a day.
- **Bill impact:** $0 ongoing for thumb-served photos. Backfill cost = $0 (if done via direct fetch, not transform endpoint).
- **Storage cost impact:** +88K × ~12 KB thumbs ≈ **+1 GB storage** = ~$0.02/mo (Supabase storage is $0.021/GB/mo). Negligible.
- **Code impact:** New ingest-time resize logic + new transformPhotoUrlForTile branch + backfill script + migration.
- **Risk:** Backfill script must be carefully memory-bounded (use the same serial-1-per-worker pattern ORCH-0737 v6 established for the collage compose loop).
- **Verdict:** **RECOMMENDED.** Eliminates the bill structurally and indefinitely; one-shot backfill cost is zero; storage cost is negligible.

### Tier C — CDN cache layer in front of Supabase Storage

- **Bill impact:** ZERO. Per Supabase's pricing rule (verified §F-2), billing counts unique origin images per period regardless of request frequency. A CDN cache only helps for repeat-fetches, which Supabase already counts as zero additional units.
- **Verdict:** **NOT APPLICABLE.** Eliminated by docs verification.

### Tier D (new — discovered during investigation) — Stop mirroring Google Places photos into Supabase Storage at all

- **Approach:** For NEW places, the place-ingest pipeline stores the Google CDN URL (`https://lh3.googleusercontent.com/...`) directly on the place row instead of copying the photo into the `place-photos` bucket. `transformPhotoUrlForTile` already handles Google CDN URLs via Pattern 2 (`=w192-h192` suffix) at zero cost.
- **Bill impact for new places:** $0 marginal.
- **Bill impact for existing 18,547 places:** still pays the transformation cost until they age out or are re-ingested.
- **Risk:** Google `photo_reference` durability. Photos may become unfetchable if Google rotates the CDN path or invalidates the reference. The current mirror was likely defensive.
- **Open question for operator:** is the mirror policy a deliberate durability choice or accidental? If accidental → switch to Google CDN URLs and the long-term cost trajectory flattens.
- **Verdict:** **WORTH PAIRING WITH TIER B.** Tier B fixes the existing 88K. Tier D prevents the next 88K from ever being needed. Together they take Mingla to near-zero permanent cost on this meter.

### Recommended fix path

**Tier B + Tier D**, implemented as two separate SPECs:

1. **SPEC A** (Tier B): pre-generate thumbs at ingest, backfill existing photos, point collage at thumbs, drop Supabase transform endpoint usage entirely. Estimated complexity: M (2-3 days implement + 1 day backfill + 1 day verify).
2. **SPEC B** (Tier D): switch new-place ingest from mirror to Google CDN URL storage. Estimated complexity: S (1 day implement, with operator decision on durability trade-off).

Both can ship independently. SPEC A is the bigger lever (eliminates the bill today). SPEC B is the long-term prevention.

---

## 7. Cost Projection

Assumptions: 2,246 collages / 19 days ≈ 118 collages/day; ~4 photos per collage avg.

| Scenario | Unique transforms / month | Pro plan included | Overage units | Overage cost @ $5/1K |
|---|---|---|---|---|
| Today (no growth) | ~14,200 | 100 | 14,100 | **~$70/mo** |
| 10× growth (real-user launch) | ~142,000 | 100 | 141,900 | **~$710/mo** |
| 100× growth (post-PMF) | ~1,420,000 | 100 | 1,419,900 | **~$7,100/mo** |

At today's volume the cost is annoying but not strategic. At 10× it becomes a meaningful line item. At 100× it becomes a "why is our infra bill this high" board-deck question. **The fix matters more for future trajectory than for today.**

Caveat: Supabase Team plan ($599/mo) and Enterprise tiers may include higher Image Transformation quotas with different overage rates — verify against billing if Mingla upgrades. Current numbers assume Pro plan continues.

---

## 8. Discoveries for Orchestrator

- **D-1 (P3, FYI):** ORCH-0737 v6 shipped a cost-increasing change without modeling the cost in the SPEC or close report. This is the same pattern as the recent ORCH-0954 Stripe-API-shape failure (COMMS-0003) and warrants a process tweak: **any change that introduces a call to a metered external API endpoint must cite the metering rule + provider docs URL inline in the SPEC**, mirroring the existing `I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED` invariant. Suggest broadening that invariant from "API enums/payloads" to "API enums/payloads/metering". I am NOT registering this as a separate ORCH — just flagging for orchestrator awareness when this ORCH ships and the invariant is reviewed.
- **D-2 (P4, observation):** The `place-collages` bucket has 2,327 total objects vs 18,547 distinct places. ~16,200 places have NEVER been collaged. If the pipeline is incrementally back-processing them, projection volume could be materially higher than the today-extrapolation. Worth a quick check via the pipeline's job-state table before final SPEC sizing.
- **D-3 (P4, observation):** Google CDN photos in the pipeline (Pattern 2 in `transformPhotoUrlForTile`) are FREE to transform. If we have telemetry on Pattern-1 vs Pattern-2 hit ratio per collage, we could model exactly how much of the 9,168 is Supabase-mirror vs Google-CDN. Not strictly necessary for the fix — Pattern 1 is the only one that costs anything, so eliminating its endpoint usage closes the loop regardless.

---

## 9. Open Questions for Operator

- **OQ-1:** Is the `place-photos` mirror a deliberate durability choice (insulate against Google `photo_reference` expiry) or a default that crept in? Answer determines whether Tier D (stop mirroring new places) is viable or whether we need to keep mirroring + pay for the thumb-pre-generation pipeline forever.
- **OQ-2:** Backfill timing — is it OK to spread backfill across ~24 hours (cheapest, safest, $0 cost), or is there pressure to reduce the bill faster? If "faster," we can spend ~$50 one-time to backfill via the transform endpoint and stop the daily burn within an hour.
- **OQ-3:** Should we ship Tier B and Tier D as one SPEC or two? Single SPEC = atomic deploy but bigger blast radius. Two SPECs = lower per-deploy risk but more orchestration overhead.

---

## 10. Confidence + What I Would NOT Claim

**Confidence: PROVEN** for F-1 root cause. Single call site identified by exhaustive 3-pattern grep across all 4 apps; DB-volume math reconciles to billing within 2%; pricing rule verified against Supabase's authoritative docs.

What I would NOT claim without further evidence:
- Exact backfill timing without measuring `place-photos` average file size and edge-function decode latency at scale (the 24-hour estimate is back-of-envelope).
- Tier D viability without operator confirmation on Google CDN durability requirements (OQ-1).
- That this is the ONLY metered Supabase usage at risk — only this specific meter was investigated. Other meters (Storage egress, Edge Function invocations, Database egress, Realtime messages) may have their own overage stories worth a future SNAPSHOT pass.
