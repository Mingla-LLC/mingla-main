# SPEC — Creative Library: reuse venue content across ad campaigns

**Issue:** GitHub #866 (child of initiative #852 "[Full Rooms] Internal Ad & Reservation Engine")
**Mode:** SPEC (grounded in a live READ-ONLY probe of the connected `meta-ads` + `tiktok-ads` MCPs + codebase recon of #862 / #864 specs)
**Worktree:** `~/Desktop/mingla-orchs/issue-866-creative-library/` on branch `issue-866-creative-library`
**Downstream routing:** this SPEC → `mingla-implementor` → `mingla-tester` → orchestrator CLOSE
**Author:** mingla-forensics · **Date:** 2026-07-14

> **User story (verbatim / issue AC):** "As a Mingla admin, I can upload/store creative media, tag it by venue, and select it from a library inside the campaign builder — so one asset is made once, tagged to a venue, and reused across every ad platform."

> **COMMS acknowledged this turn:** COMMS-0096 + COMMS-0097 (WARN/OPEN → ALL): the release-config CI gates (`I-RELEASE-VERSION-PARITY`, `I-RELEASE-SUBMIT-CONFIG`) stay in lockstep. This spec touches **no** `app.json` / `eas.json` / store-submit config, so both gates are untouched (§9). No BLOCK entries were open for issue-866 / forensics / ALL.

---

## 1. Executive summary

Build the **Creative Library** — the single source of truth for ad creative media in Mingla's internal Ad Engine. An admin **uploads a creative once** (an image or a video), **tags it to a venue** (the existing `place_pool` entity) and optionally a brand, and it lands in a browsable library. From the campaign builder (#864) the admin **selects a creative from that library** instead of re-uploading per campaign.

The library is **platform-agnostic**. The canonical asset lives in Mingla's own storage — images in the existing Supabase Storage bucket `meta-ad-creatives` (created by #864), videos in **Bunny Stream** (Cloudinary was retired — META-1270). When an ad on a given platform first references a creative, a shared edge module **lazily uploads the asset to that platform and caches the platform's returned identifier**, so the same asset is never uploaded twice to the same platform/lane/account. Each channel needs a different primitive — Meta an `image_hash`/`video_id`, TikTok a `material_id`, Snapchat a `media_id`, Google an asset resource id — and the cached-ref table absorbs that difference behind one interface.

This follows the **exact server-side pattern** used by #862 (Meta engine): all platform tokens live only in **Supabase Edge Function Secrets** (`Deno.env`), never in the DB or any client; DB stores only non-secret asset metadata + external ids; all writes are **admin-only** and **fail-close**. #862's `admin-meta-create-campaign` is amended to accept a `creative_id` and resolve the platform ref at ad-create time; #863 (TikTok) and #867 (Snap/Google) will consume the identical `resolveCreativeRef()` entry point.

---

## 2. Scope & non-goals

### In scope (this story only)
1. **Upload / store** a creative asset (image or video) as a canonical library row — image via the existing `meta-ad-creatives` bucket, video via the existing Bunny Stream pipeline.
2. **Tag** a creative by **venue** (existing `place_pool` entity) and optionally by **brand** (`brands`); edit/retag.
3. **List / browse / filter** the library (by search, kind, venue, brand, status) — the reader the #864 builder's "select from library" step calls.
4. **Select** a creative for a campaign (return the row + its per-platform ref status for the chosen platform/lane).
5. **Per-platform upload-on-demand + ref caching**: a shared module `_shared/creatives.ts` with per-platform upload adapters (`uploadToMeta`, `uploadToTikTok`, `uploadToSnap`, `uploadToGoogle`) behind one interface, invoked **lazily** the first time an ad in that platform references the creative, with the returned external id **cached** in `ad_creative_platform_refs` (never re-uploaded).
6. **Amend #862's create endpoint** to accept `creative_id` (resolve → Meta `image_hash`/`video_id`) in addition to the existing `image_url` path (backward compatible).

### Non-goals (explicitly NOT built here — separate sibling issues)
- **The campaign-builder UI itself** (wizard shell, steps, preview) → **#864**. #866 ships the library grid + upload + tag + an **embeddable picker** the #864 builder renders in its Media step; it does not rebuild the wizard.
- **Campaign create / launch / pause** on any platform → **#862** (Meta), **#863** (TikTok), **#867** (Snap/Google). #866 supplies the creative + the resolve-ref primitive those engines call; it never creates a campaign.
- **Attribution / reservation-conversion tracking** → **#865**.
- **AI creative generation** (text-to-image / text-to-video / auto-variants) → **OUT** of the entire Ad Engine scope for now (Open Decision OD-6). #866 stores and reuses human-made assets only.
- **TikTok / Snap / Google connection provisioning** (accounts, tokens, OAuth) → owned by #863 / #867. #866 defines the adapters + the env-var **names** they read; only the **Meta** lane is live-testable in this story.
- **Consumer app, business app, buyer web, business-web preview** behavior — no code changes to those surfaces. Creatives *depict* venues; they do not modify any consumer/business surface.

### Assumptions
- Mingla manages **only its own** per-lane ad accounts (consumer + business), matching #862's two-lane model — so a creative's platform ref is keyed by lane/account, not by tenant.
- The `meta-ads` / `tiktok-ads` MCPs used to author this spec are **per-user OAuth exploration tools only**; production upload uses Mingla's **own** platform tokens (Function Secrets) — a hard constraint (§6).
- `place_pool` is the canonical venue entity (confirmed in migrations §4.0); the exact FK target is re-confirmed at implementation (OD-1).

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | User-visible behavior demanded | Files touched here | Parity |
|---|---------|----------|-------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/` iOS) | **No** | none | none | n/a — engine is admin/back-office only |
| 2 | Consumer Android (`app-mobile/` Android) | **No** | none | none | n/a |
| 3 | Buyer/anonymous Web (`mingla-business` `/e/…`, `/b/…`, `/t/…`, `/checkout/…`) | **No** | none — a creative *depicts* a venue/event but does not alter its public page | none | n/a |
| 4 | Business iOS | **No** | none | none | n/a |
| 5 | Business Android | **No** | none | none | n/a |
| 6 | **Admin Web** (`mingla-admin/`) | **YES — primary** | Upload/store/tag/browse creatives; select one in the builder | `mingla-admin/src/**` (new library route, service, hook, components; embeddable picker for #864) | Single surface — no cross-platform parity concern |
| 7 | Business Web preview (adjacent) | **No** | none | none | n/a |
| — | **Backend** (`supabase/`) | **YES — primary** | new tables, RLS, `_shared/creatives.ts`, edge functions; amend #862 create fn | `supabase/migrations/**`, `supabase/functions/admin-creative-*/**`, `supabase/functions/_shared/creatives.ts`, `supabase/functions/admin-meta-create-campaign/**` (amend), `supabase/config.toml` | Server-authoritative; no parity concern |

**Why each NOT-covered surface is out:** the Creative Library is an internal back-office tool for building paid campaigns. It reuses assets that *point users at* already-live public pages; it does not change what consumers or businesses see. Venue tagging **reads** `place_pool` (never writes it).

---

## 4. Layered specification

### 4.0 "What's buildable" — LIVE MCP probe evidence (read-only, 2026-07-14)

All values below are **real responses** from the connected `meta-ads` (`mcp.facebook.com/ads`) and `tiktok-ads` MCPs, plus verbatim tool-schema contracts. No write/upload/spend tool was called.

**Per-platform creative-upload primitives — the exact id each platform returns and requires on an ad:**

| Platform | Image primitive | Video primitive | Upload endpoint (production, direct Graph/API call) | Owner scope | Evidence |
|---|---|---|---|---|---|
| **Meta** | **`image_hash`** (uniquely identifies an image; required on `object_story_spec.link_data.image_hash`) | **`video_id`** (video FBID) + a thumbnail **`image_hash`**/`image_url` | image → `POST /act_{id}/adimages` (bytes or URL) → `{hash}`; video → `POST /act_{id}/advideos` (`file_url`) → `{id}`, **async — poll `GET /{video_id}?fields=status` until `status.video_status='ready'`** | **ad account** (`act_2393570861066813`) + **`page_id`** (`797406353459597`) for the creative | `ads_create_creative` schema (requires `ad_account_id`+`page_id`; image → `image_hash`\|`image_url`+`link_url`; video → `video_id`+`link_url?`+thumbnail `image_hash`\|`image_url`); `ads_get_ad_images` (returns `hash`, `width`, `height`, `url`, `status`); `ads_get_ad_videos` (returns `id`, `length`, `picture`) |
| **TikTok** | **`image_id`** + **`material_id`** (both first-class filter keys) | **`video_id`** + **`material_id`** | image → `POST /file/image/ad/upload/` (`upload_type=UPLOAD_BY_URL`, `image_url`) → `{image_id, material_id}`; video → `POST /file/video/ad/upload/` (`upload_type=UPLOAD_BY_URL`, `video_url`) → `{video_id, material_id}` | **advertiser** (`7627974536397766673`) Asset Library | `file_image_ad_search` filtering exposes `image_ids` **and** `material_ids` as distinct keys; `creative_portfolio_list_get` (portfolios wrap materials) |
| **Snapchat** | **`media_id`** (type IMAGE) | **`media_id`** (type VIDEO) | `POST /v1/adaccounts/{id}/media` (create media entity → `media_id`) then `POST .../media/{media_id}/upload` **or** `.../upload_from_url` | **ad account** | No MCP available → documented from Snap Marketing API contract; **verify at implementation** (§11 OD-2) |
| **Google** | Asset **`resource_name`/`id`** (`ImageAsset`) | Asset **`resource_name`/`id`** (`YoutubeVideoAsset` — requires a **YouTube-hosted** video) | `AssetService.MutateAssets` (`ImageAsset.data` bytes/URL, or `YoutubeVideoAsset.youtube_video_id`) → asset `resource_name` | **customer** (Google Ads account) | No MCP available → documented from Google Ads API contract; **Bunny video cannot upload directly — YouTube dependency**, §11 OD-2 |

**Live probe results (both accounts fresh):**
- `ads_get_ad_images(2393570861066813)` → `{"ad_images":[]}` · `ads_get_ad_videos(2393570861066813)` → `{"ad_videos":[]}` · `ads_get_ad_account_pages(2393570861066813)` → `{"pages":[]}`.
- `file_image_ad_search(7627974536397766673)` → `{"list":[], "total_number":0}` · `creative_portfolio_list_get(7627974536397766673)` → `{"creative_portfolios":[], "total_number":0}`.
- **Interpretation:** every platform asset library is **empty**. This is positive evidence for the architecture — the platform libraries are *destinations we populate*, not sources of truth. Mingla's own storage (bucket + Bunny) is the single source; the platform id is a **cached upload artifact**, produced on demand.

**Storage reality (from project memory context — not re-derived):**
- **Video** cover/creative media is served from **Bunny Stream** (Cloudinary RETIRED — META-1270). A video creative's canonical handle is its **Bunny video id + playback/source URL**.
- **Images** live in **Supabase Storage** — the `meta-ad-creatives` bucket (public-read, `image/png`+`image/jpeg`, 30 MB) created by #864 (its §4.5), explicitly noted there as "the shared substrate #866 will extend." Public URL so any platform can fetch by URL.

**Venue entity (confirmed in `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql`):**
- `public.place_pool` — `id uuid DEFAULT gen_random_uuid()`, `name text`, `google_place_id`, `lat/lng`, `types text[]`, `photos jsonb`, … Sibling tables (`place_scores`, `place_admin_actions`, `rules_run_results`) all FK `place_id → place_pool(id)`. **This is the existing venue entity — do NOT invent a new venue table.** `brands.id` is `uuid`.

---

### 4.1 Architecture & data flow

```
Admin (mingla-admin) — Creative Library
   │  1. UPLOAD: image → mediaUpload.js → bucket meta-ad-creatives (public URL)   [reuse #864]
   │            video → existing Bunny Stream pipeline → bunny_video_id + URL      [reuse META-1270]
   │  2. RECORD: POST admin-creative-upload  → INSERT ad_creatives (canonical row + venue tag)
   ▼
Supabase DB  ad_creatives (canonical asset + place_id venue tag)
   │
   │  3. SELECT (in #864 builder Media step): POST admin-creative-list / admin-creative-select → creative_id
   ▼
Campaign create — the channel engine (#862 Meta / #863 TikTok / #867 Snap+Google)
   │  4. at ad-create time, calls resolveCreativeRef(creative_id, platform, lane):
   │        _shared/creatives.ts
   │         ├─ SELECT ad_creative_platform_refs (creative_id, platform, lane, account) → cached?  ── YES ─► return external_ref (NO upload)
   │         └─ NO → adapter.upload(asset, laneCtx) → external id → CACHE row status='ready' ─────────────► return external_ref
   │  5. engine builds its ad with the returned id (Meta image_hash/video_id, TikTok material_id, …)
   ▼
Platform ad references the cached creative ref (uploaded exactly once)
```

**Invariants of the flow:** (a) every platform token stays in the edge runtime (`Deno.env`), never client/DB; (b) an asset is uploaded to a given `(platform, lane, external_account)` **at most once** — the ref is cached and reused; (c) if storage or platform upload fails, `resolveCreativeRef` **throws** and the calling engine aborts ad-create — **no orphaned ad without a creative**; (d) every state-changing edge call is `is_admin_user()`-gated; (e) a venue tag references an **existing** `place_pool` row or the tag write is rejected (422).

### 4.2 Database layer

New migration `supabase/migrations/<ts>_issue_866_creative_library.sql` (timestamp AFTER the latest existing migration; verify with `ls supabase/migrations | tail`). House pattern: RLS enabled, admin-read via `is_admin_user()`, writes service-role-only, `updated_at` triggers.

**Table `public.ad_creatives`** — the canonical asset (one row per creative, made once).
```
id                 uuid PK default gen_random_uuid()
kind               text NOT NULL CHECK (kind IN ('image','video'))
name               text NOT NULL
-- canonical source (Mingla-owned; exactly one storage home per kind):
source_url         text NULL          -- public fetchable URL (image: meta-ad-creatives public URL; video: Bunny playback/source URL)
storage_bucket     text NULL          -- 'meta-ad-creatives' for image assets in Supabase storage
storage_path       text NULL          -- object path within the bucket
bunny_video_id     text NULL          -- Bunny Stream id for video assets (META-1270)
poster_url         text NULL          -- video cover/thumbnail URL (needed by Meta+TikTok video creatives)
-- venue tagging (EXISTING entities — no new venue table):
place_id           uuid NULL REFERENCES public.place_pool(id) ON DELETE SET NULL   -- the venue the content depicts
brand_id           uuid NULL REFERENCES public.brands(id)     ON DELETE SET NULL   -- optional brand tag
-- descriptive metadata:
width              integer NULL
height             integer NULL
aspect_ratio       numeric NULL        -- width/height, e.g. 1.7778 (16:9), 1.0 (1:1), 0.5625 (9:16)
duration_seconds   numeric NULL        -- video only
mime_type          text NULL
status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived'))
created_by         uuid NULL REFERENCES auth.users(id)
created_at         timestamptz NOT NULL DEFAULT now()
updated_at         timestamptz NOT NULL DEFAULT now()
-- integrity: an image must have a fetchable image; a video must have a Bunny id + poster
CONSTRAINT ad_creatives_image_source  CHECK (kind <> 'image' OR source_url IS NOT NULL)
CONSTRAINT ad_creatives_video_source  CHECK (kind <> 'video' OR (bunny_video_id IS NOT NULL AND poster_url IS NOT NULL))
```

**Table `public.ad_creative_platform_refs`** — the per-platform uploaded-ref cache (upload once, reuse forever).
```
id                  uuid PK default gen_random_uuid()
creative_id         uuid NOT NULL REFERENCES public.ad_creatives(id) ON DELETE CASCADE
platform            text NOT NULL CHECK (platform IN ('meta','tiktok','snap','google'))
lane                text NOT NULL CHECK (lane IN ('consumer','business'))     -- which per-lane account family
external_account_id text NOT NULL          -- the ad account / advertiser / customer the asset physically lives in
                                           -- (Meta image_hash is ACCOUNT-scoped; keying by account survives rebinds)
external_kind       text NOT NULL CHECK (external_kind IN ('image','video'))
external_ref        text NULL              -- PRIMARY id: meta image_hash|video_id · tiktok material_id · snap media_id · google asset resource_name
external_ref_extra  jsonb NOT NULL DEFAULT '{}'::jsonb
                                           -- secondary ids: meta {thumbnail_image_hash} · tiktok {image_id|video_id} · google {resource_name}
status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploading','ready','failed'))
error               text NULL              -- normalized platform error on failure (NEVER contains a token)
uploaded_at         timestamptz NULL
created_at          timestamptz NOT NULL DEFAULT now()
updated_at          timestamptz NOT NULL DEFAULT now()
CONSTRAINT ad_creative_platform_refs_uniq UNIQUE (creative_id, platform, lane, external_account_id)  -- THE idempotency key
```

**RLS (both tables):** `ENABLE ROW LEVEL SECURITY`.
- `SELECT`: `USING ( public.is_admin_user() )` for `authenticated`.
- `INSERT`/`UPDATE`/`DELETE`: **no policy for authenticated** — service-role (the admin-gated edge functions) writes; mirrors #862's `meta_*` tables + `payment_webhook_events`.
- `GRANT SELECT` to `authenticated`; no direct write grants.

**Indexes:** `ad_creatives (place_id)`, `ad_creatives (brand_id)`, `ad_creatives (kind, status)`, `ad_creative_platform_refs (creative_id)`, `ad_creative_platform_refs (platform, lane)`. `updated_at` triggers on both.

### 4.3 Shared edge module — `supabase/functions/_shared/creatives.ts` (NEW)

The heart of the story. Mirrors `_shared/meta.ts` (#862): a typed resolver + per-platform adapters + fail-close. **The idempotency + caching guard lives in the shared wrapper `resolveCreativeRef`, NOT in the adapters** (adapters are pure upload).

**Common adapter interface (illustrative ≤3 lines):**
```
interface CreativeUploadAdapter {
  readonly platform: 'meta'|'tiktok'|'snap'|'google';
  upload(asset: AdCreativeRow, ctx: LaneContext): Promise<UploadedRef>;   // pure upload; throws on failure
}
type UploadedRef = { external_kind:'image'|'video'; external_ref:string; external_ref_extra:Record<string,unknown>; external_account_id:string };
type LaneContext = { lane:'consumer'|'business'; external_account_id:string; tokenEnvVar:string; pageId?:string };
```

**`resolveCreativeRef(supabaseSvc, creativeId, platform, lane): Promise<UploadedRef>`** — the single entry point every channel engine calls at ad-create:
1. Load the platform/lane **connection** → `external_account_id`, the **token env-var NAME** for that lane, and (Meta) `page_id`. If the connection is missing/invalid → **throw `CreativeConnectionError`** (fail-close; the engine surfaces it, no ad written).
2. Load the `ad_creatives` row; if absent or `status='archived'` → throw `CreativeNotFoundError`.
3. `SELECT ad_creative_platform_refs` by `(creative_id, platform, lane, external_account_id)`:
   - `status='ready'` → **return the cached `external_ref` — NO upload** (the idempotency win).
   - `status='uploading'` (a concurrent create) → await-with-backoff / re-read; on persistent lock → throw retryable.
   - `status='failed'` or absent → proceed to upload.
4. **Upsert** a row `status='uploading'` (the `UNIQUE` key makes this the concurrency lock), then call `adapter.upload(asset, ctx)`.
5. On success → `UPDATE status='ready', external_ref, external_ref_extra, external_account_id, uploaded_at=now()` and return it. On failure → `UPDATE status='failed', error=normalize(e)` and **re-throw `CreativeUploadError`** (fail-close).

**Adapters (each reads its token via `Deno.env.get(ctx.tokenEnvVar)` — NAME only, never a value):**
- **`uploadToMeta`** — image → `POST /act_{acct}/adimages` (pass `source_url` or bytes) → `image_hash`. video → `POST /act_{acct}/advideos` (`file_url=source_url` = the Bunny URL) → `video_id`, then poll `GET /{video_id}?fields=status` until `video_status='ready'`; upload `poster_url` → thumbnail `image_hash` stored in `external_ref_extra`. Reuses `metaGraph()` + `resolveMetaToken()`/lane env from #862's `_shared/meta.ts` (import; see §10 coordination). Env names: `META_SYSTEM_USER_TOKEN` (consumer) / `META_MINGLABIZ_SYSTEM_USER_TOKEN` (business).
- **`uploadToTikTok`** — image → `POST /file/image/ad/upload/` (`UPLOAD_BY_URL`, `image_url=source_url`) → `{image_id, material_id}` (`external_ref=material_id`, `external_ref_extra={image_id}`). video → `POST /file/video/ad/upload/` (`UPLOAD_BY_URL`, `video_url=Bunny URL`) → `{video_id, material_id}`. Env names: `TIKTOK_ACCESS_TOKEN` (+ `_MINGLABIZ_` business variant) — **owned/confirmed by #863**.
- **`uploadToSnap`** — `POST /v1/adaccounts/{acct}/media` → `media_id`; then `.../media/{media_id}/upload_from_url` (`source_url`/Bunny URL) → `external_ref=media_id`. Env names: `SNAP_ACCESS_TOKEN` — **owned/confirmed by #867**.
- **`uploadToGoogle`** — image → `AssetService.MutateAssets` `ImageAsset` (bytes/URL) → asset `resource_name`. video → `YoutubeVideoAsset` **requires a YouTube-hosted `youtube_video_id`** (Bunny cannot upload directly → OD-2). Env names: `GOOGLE_ADS_DEVELOPER_TOKEN` / `GOOGLE_ADS_REFRESH_TOKEN` / `GOOGLE_ADS_CUSTOMER_ID` — **owned/confirmed by #867**.
- **`normalizeCreativeError(e)`** → `{ platform, code, message }` client-safe; a token is **never** logged or echoed.

> **This story implements the wrapper + all four adapter stubs + a fully-working `uploadToMeta` (live-testable).** TikTok/Snap/Google adapters are built to the documented contract but are **live-verified by #863/#867** when those lanes are provisioned; until then they throw a typed "lane not provisioned" error (fail-close).

### 4.4 Edge functions (all POST; `verify_jwt=true`; in-code `admin_users` gate; service-role DB writes)

Reuse `_shared/cors.ts` + the #862 admin-gate entry pattern. Add each to `supabase/config.toml` as `[functions.<name>] verify_jwt = true`.

**Admin gate (every function, after `requireUserId`):** `admin_users.email == user.email AND status='active'` else `403` (identical to #862 §4.4).

#### (a) `admin-creative-upload` — record a canonical asset
- **Body:** `{ kind:'image'|'video', name, source_url?, storage_bucket?, storage_path?, bunny_video_id?, poster_url?, place_id?, brand_id?, width?, height?, aspect_ratio?, duration_seconds?, mime_type? }`.
- **Flow:** the client has already put bytes in storage — image via #864's `mediaUpload.js` (bucket `meta-ad-creatives`, returns `{publicUrl, path}`), video via the existing Bunny pipeline (returns `bunny_video_id` + playback URL + poster). This endpoint **records the metadata row only** — it does **not** call any ad platform (that is lazy, at ad-create).
- **Validation (fail-close):** image → `source_url` required; video → `bunny_video_id` + `poster_url` required (mirrors the DB CHECKs). If `place_id` present → verify it exists in `place_pool` (else **422 `venue_not_found`**). If `brand_id` present → verify in `brands` (else 422).
- **Writes:** INSERT `ad_creatives` (`created_by=user.id`). **Output:** the row.

#### (b) `admin-creative-list` — browse / filter (the #864 "select from library" reader)
- **Body:** `{ search?, kind?:'image'|'video', place_id?, brand_id?, status?='active', page?=1, page_size?=24 }`.
- **Flow:** SELECT `ad_creatives` filtered; `search` matches `name` (+ optional venue name join); order `created_at DESC`; paginate. Optionally LEFT JOIN a compact `platform_refs` summary (`{platform,lane,status}[]`) so the grid can show per-platform readiness dots. **Output:** `{ rows, total }`.

#### (c) `admin-creative-tag` — set/change the venue (and brand) tag
- **Body:** `{ creative_id, place_id?:uuid|null, brand_id?:uuid|null }`.
- **Validation:** each non-null id must exist in `place_pool` / `brands` (else 422). Passing `null` clears the tag.
- **Writes:** UPDATE `ad_creatives` (`place_id`/`brand_id`, `updated_at`). **Output:** the updated row.

#### (d) `admin-creative-select` — confirm a creative for a campaign
- **Body:** `{ creative_id, platform?:'meta'|'tiktok'|'snap'|'google', lane?:'consumer'|'business', warm?:false }`.
- **Flow:** return the `ad_creatives` row + (when `platform`+`lane` given) the `ad_creative_platform_refs` **status** for that pair (`ready` / `not_uploaded` / `failed`) so the builder can show "already uploaded" vs "will upload on create". **Default `warm=false`** — upload stays lazy (OD-3). If `warm=true` → call `resolveCreativeRef` now to pre-produce the ref (optional review-step nicety). Reject `select` on an `archived` creative (409). **Output:** `{ creative, ref_status }`.

> **No standalone "resolve" edge function.** `resolveCreativeRef()` is imported and called **in-process** by the channel-engine create functions (§4.3 flow step 4), not exposed as its own HTTP endpoint. `admin-creative-select --warm` is the only HTTP path that warms a ref, and it is optional.

#### (e) `admin-meta-create-campaign` — **AMENDMENT (coordinated edit to #862)**
- Accept **`creative_id`** in the `creative` block as an alternative to the existing `image_url`/`image_hash`. When present: at the creative-build step, call `resolveCreativeRef(svc, creative_id, 'meta', connection.lane)` → use the returned `image_hash` (image) or `video_id`+thumbnail `image_hash` (video) in `object_story_spec`. The **existing `image_url` MVP path stays** (backward compatible — #864 still passes `image_url` until it adopts the picker). If `resolveCreativeRef` throws → the create **fails-close before any Meta campaign write** (extends #862's no-orphan contract to the creative). This is the **only** edit outside #866's own files (§10 allowlist + coordination note).

### 4.5 Service + hook (mingla-admin)
- `mingla-admin/src/services/creativeLibrary.js` — thin wrappers over `supabase.functions.invoke('admin-creative-*', …)`: `listCreatives(filters)`, `uploadCreative(meta)` (after `mediaUpload.js`/Bunny), `tagCreative({creative_id, place_id, brand_id})`, `selectCreative({creative_id, platform, lane})`, `getCreative(id)`. Reuse #864's `mediaUpload.js` for image bytes; add a small `bunnyVideoUpload.js` only if none exists (else reuse the existing Bunny helper). Throw on error (house pattern).
- `mingla-admin/src/hooks/useCreativeLibrary.js` (or Context, matching admin conventions) — library list, upload/tag/select mutations with `onError` toasts. Match the existing admin data pattern (per #862/#864 recon: direct Supabase calls + Context, no hard React-Query requirement).
- **Venue lookup for tagging:** reuse the #864 destination-picker pattern but source options from `place_pool` (search by `name`/city). A read-only reader `listVenues({search})` (edge or a direct admin-read query against `place_pool` — `place_pool` grants read to admins) supplies options. Confirm the read path at implementation (OD-1).

### 4.6 Component layer (mingla-admin) — see §5 for exact states
New route **`/ad-engine/creatives`** ("Ad Engine → Creative Library"), admin-only. New components: `CreativeLibraryPage` (grid), `CreativeCard` (thumbnail + kind badge + venue-tag chip + per-platform ref-status dots), `CreativeUploadModal` (drag/drop image → `mediaUpload`; video → Bunny pipeline; then `admin-creative-upload`), `VenueTagPicker` (searches `place_pool`), and **`CreativePicker`** — the **embeddable** browse+filter+select surface the #864 builder renders in its Media step (reuse `Card`, `Badge`, `SearchInput`, `Spinner`, `Modal` per #864's reuse list).

---

## 5. Admin UI states (single surface → no per-platform split)

- **SC-1 — Empty library:** no creatives → empty-state card "No creatives yet. Upload venue photos or videos to reuse across campaigns." + "Upload" CTA.
- **SC-2 — Uploading:** progress on the upload modal; button disabled; no duplicate submits; image type/size validated client-side (JPG/PNG ≤30 MB per #864); video routed to Bunny.
- **SC-3 — Upload error:** inline message (bad type/oversize, storage failure, `venue_not_found`); the asset is NOT recorded; retry available.
- **SC-4 — Populated grid:** each `CreativeCard` shows thumbnail (image or video poster), a **kind badge** (Image/Video), the **venue-tag chip** (place name, or "Untagged"), and **per-platform ref dots** (Meta/TikTok/Snap/Google × lane): grey = not uploaded, spinner = uploading, green = ready, red = failed. Filter bar: search, kind, venue, brand, status.
- **SC-5 — Tagging:** `VenueTagPicker` searches `place_pool` and sets `place_id`; clearing sets it null; the chip updates. (Selection = ring + check, never color alone — WCAG per #864.)
- **SC-6 — Select in builder:** the `CreativePicker` embedded in #864's Media step lists creatives (filter by the campaign's venue by default), highlights the picked one (ring+check), and returns `creative_id` to the builder. If a creative's Meta ref for the campaign's lane is `not_uploaded`, show "Will be uploaded to Meta when you create the campaign."
- **SC-7 — Ref failure surfaced:** if a create fails because `resolveCreativeRef` failed, the error routes back with the normalized platform message; the `CreativeCard`'s platform dot goes red with a "Retry upload" affordance (re-runs `admin-creative-select --warm`). Nothing silently succeeds.

---

## 6. Security

- **SC-SEC-1 — Tokens:** every platform token is a Function Secret read via `Deno.env.get('<NAME>')` — `META_SYSTEM_USER_TOKEN` / `META_MINGLABIZ_SYSTEM_USER_TOKEN` (#862), `TIKTOK_ACCESS_TOKEN` (#863), `SNAP_ACCESS_TOKEN` / `GOOGLE_ADS_*` (#867). **Names only, never values, in this spec, the DB, any response, `error` column, log, or client bundle.** Identical precedent to #862 §6.
- **SC-SEC-2 — Distinct from MCP OAuth:** production uploads use Mingla's own platform tokens; the exploration MCPs' per-user OAuth is not used and no per-user OAuth flow is built.
- **SC-SEC-3 — Authorization:** `verify_jwt=true` → in-code `getUser` (401) → `admin_users` active gate (403) on **every** `admin-creative-*` function. `ad_creatives` / `ad_creative_platform_refs` are admin-read-only via `is_admin_user()` RLS; writes service-role-only.
- **SC-SEC-4 — Storage:** reuse #864's `meta-ad-creatives` bucket policy — public-read, admin-write (`is_admin_user()`) on `storage.objects`. Video via Bunny (existing, keys server-side).
- **SC-SEC-5 — Fail-close:** missing/invalid platform connection, storage failure, or platform-upload failure → `resolveCreativeRef` throws → the calling engine aborts ad-create; no ad is written against a missing creative; the ref row records `status='failed'` for retry. A tag against a non-existent venue → 422 (no silent write).

---

## 7. Prerequisites Seth must provision (ACTION ITEMS)

Mostly **already done** — the storage substrate exists; per-platform accounts are owned by sibling issues.

1. **Image storage bucket `meta-ad-creatives` — ALREADY created by #864** (public-read, admin-write, JPG/PNG, 30 MB). **Confirm #864's migration is applied** before #866's live-fire. **No new bucket needed** — #866 reuses it (OD-7). If posters need a distinct home, they also go in this bucket.
2. **Video storage — Bunny Stream is LIVE** (META-1270). Confirm the existing Bunny upload helper/keys are reachable from `mingla-admin` (or that a server-side Bunny upload path exists). No new provisioning expected.
3. **Meta lane — ALREADY provisioned** (#862 Amendment A2): ad account `2393570861066813`, Page `797406353459597`, `META_SYSTEM_USER_TOKEN` verified valid. #866's Meta upload adapter is **live-testable now**. (Billing/`UNSETTLED` only blocks *delivery*, not asset upload.)
4. **TikTok / Snap / Google lanes — provisioned by #863 / #867.** #866 only needs their env-var **names** to exist; those adapters are live-verified when the lanes land. TikTok advertiser `7627974536397766673` is known (probe).
5. **Confirm the venue FK target** — `place_id → public.place_pool(id)` (this spec's assumption, migration-verified). If a later venue-unification (META-ORCH-1186) introduces a different canonical venue table, re-point the FK at implementation (OD-1).
6. **(Google video only)** a **YouTube upload path** for video assets (Google `YoutubeVideoAsset` needs `youtube_video_id`); until provided, Google **video** creatives are deferred (OD-2). Google **image** and all other platforms accept the Bunny/bucket URL directly.

---

## 8. Acceptance criteria + test plan

### Acceptance criteria (testable)
- **AC-1 (upload/store):** `admin-creative-upload` for an image with a `meta-ad-creatives` public URL, and for a video with a `bunny_video_id`+`poster_url`, each persists **one** `ad_creatives` row with the correct `kind`, source fields, and (if given) `place_id`. Image missing `source_url` or video missing `bunny_video_id`/`poster_url` → 422 (DB CHECK + edge validation).
- **AC-2 (tag by venue — existing entity):** `admin-creative-tag` with a real `place_pool` id sets `ad_creatives.place_id`; a **non-existent** `place_id` → **422 `venue_not_found`** (no write). `null` clears the tag.
- **AC-3 (list/select):** `admin-creative-list` returns the library filtered by search/kind/venue/status with `{rows,total}`; `admin-creative-select` returns the creative + the ref status for a given `(platform, lane)`.
- **AC-4 (idempotent per-platform upload — the core invariant):** the **first** `resolveCreativeRef(id,'meta',lane)` uploads to Meta and inserts a `ready` `ad_creative_platform_refs` row with the real `external_ref` (image → `image_hash`; video → `video_id`); the **second** call returns the **same cached `external_ref` with ZERO additional Meta upload calls**. UNIQUE `(creative_id, platform, lane, external_account_id)` is enforced.
- **AC-5 (fail-close, no orphan ad):** if the Meta upload fails, `resolveCreativeRef` throws, the ref row is `status='failed'`, and the calling `admin-meta-create-campaign` returns an error with **no `meta_campaigns` row and no Meta campaign** created (extends #862 AC-6).
- **AC-6 (Meta live-fire, post-prereqs):** upload a real image creative → create a Meta campaign referencing `creative_id` → a real `image_hash` is produced, cached, and used in the creative; a video creative yields a `video_id` (poll-until-ready) + thumbnail hash.
- **AC-7 (authz + RLS):** a non-admin JWT → 403 on every `admin-creative-*` function; an ordinary authenticated user `SELECT` on `ad_creatives` / `ad_creative_platform_refs` returns 0 rows.
- **AC-8 (no token leak):** no platform token appears in any edge response, the `error` column, any log, any `ad_creative*` column, or the admin client bundle.
- **AC-9 (adapter interface):** all four adapters conform to `CreativeUploadAdapter`; unprovisioned lanes (TikTok/Snap/Google) throw a typed "lane not provisioned" error (fail-close), never a partial upload.

### Test plan
**Unit / integration (edge, Deno test — reuse `__tests__` convention):**
- upload records exactly one row per kind; image/video CHECK violations rejected (AC-1).
- tag with fake `place_id` → 422 before any write (AC-2).
- **idempotency:** mock the Meta upload; first `resolveCreativeRef` uploads + caches; second returns the cached ref and the mock upload is **called exactly once** (AC-4 — drives RT-1).
- upload-failure → throw + `status='failed'` + engine writes no ad row (AC-5 — drives RT-2).
- response/`error`/logs never contain the token (AC-8).
**RLS (SQL):** ordinary authenticated `SELECT` on both tables → denied/0 rows; `is_admin_user()` → rows (AC-7).
**Live-fire (mingla-tester, Meta lane, post-prereqs):** upload a real venue image → tag it to a `place_pool` venue → create a $1/day Traffic campaign (#862) referencing the `creative_id` → confirm the Meta creative carries a real `image_hash`, the `ad_creative_platform_refs` row is `ready`, and a **second** campaign reusing the same creative performs **no second upload** (inspect Meta ad-images count + the cache row). Repeat for a Bunny video → `video_id`. Capture ids + screenshots.
**Security (mingla-tester):** build the admin bundle and `grep -r` for the token names' values → absent; inspect connect/upload/create network responses → tokens absent.

---

## 9. Invariants + regression prevention

### Invariants preserved / established
- **Preserve I-ADMIN-GATE** (#862): every write re-checks `admin_users` active. Test: AC-7.
- **Preserve #862 no-orphan-write:** extended — a platform ad exists **iff** its creative ref resolved. Test: AC-5.
- **Preserve #864 `meta-ad-creatives` admin-write** (I-PROPOSED-864-CREATIVE-BUCKET-ADMIN-WRITE): reused, not modified.
- **I-PROPOSED-CREATIVE-IDEMPOTENT-UPLOAD (DRAFT):** an asset is uploaded to a given `(platform, lane, external_account_id)` **at most once**; a `ready` ref is returned from cache, never re-uploaded. (Flips ACTIVE at CLOSE — orchestrator owns the flip.)
- **I-PROPOSED-CREATIVE-FAIL-CLOSE (DRAFT):** storage/connection/platform-upload failure aborts ad-create; no ad without a resolved creative; the ref records `failed`.
- **I-PROPOSED-CREATIVE-ADMIN-ONLY (DRAFT):** `ad_creatives` / `ad_creative_platform_refs` are admin-read via RLS + service-role-write only.
- **I-PROPOSED-CREATIVE-VENUE-EXISTING-ENTITY (DRAFT):** venue tags reference the existing `place_pool(id)`; **no new venue table** is created and a tag to a non-existent venue is rejected.
- **I-PROPOSED-CREATIVE-TOKEN-ENV-ONLY (DRAFT):** every platform token lives only in `Deno.env`; never in DB/response/log/client (aligns with #862's token invariant).

### Regression contract (fails-on-revert)
- **RT-1 (idempotent upload):** edge test asserts a second `resolveCreativeRef` returns the cached `external_ref` and invokes the platform upload **zero** additional times. **Reverting the "SELECT-ready-ref-before-upload" guard makes RT-1 fail; restoring it passes.** Protective comment on the guard explains the "no double-upload / no double-spend-on-storage" why.
- **RT-2 (fail-close, no orphan):** edge test asserts an upload throw yields `status='failed'` + **no** engine ad row. Reverting the throw (silent-continue) fails RT-2.
- **RT-3 (no token leak) — strict-grep CI gate:** repo grep asserts platform-token env-var access appears **only** under `supabase/functions/**` and **never** under `mingla-admin/src/**`, `app-mobile/**`, `mingla-business/**`. Follows the house strict-grep-registry pattern (extends #862's RT-3 with the TikTok/Snap/Google names).
- **RT-4 (venue = existing entity):** a schema test asserts `ad_creatives.place_id` FK targets `public.place_pool` and that **no** new `venues`/`ad_venues` table was introduced. Reverting to a fabricated venue table fails RT-4.
- **Release gates untouched:** no `app.json`/`eas.json`/store-submit change → `I-RELEASE-VERSION-PARITY` / `I-RELEASE-SUBMIT-CONFIG` (COMMS-0096/0097) remain green.

---

## 10. Implementation order + scoped allowlist

### Order (DB → shared → edge → config → admin UI → #862 amendment → CI)
1. **Migration** `supabase/migrations/<ts>_issue_866_creative_library.sql` — 2 tables + RLS + indexes + `updated_at` triggers.
2. **`supabase/functions/_shared/creatives.ts`** — `resolveCreativeRef` (idempotent cache + fail-close) + the four adapters (Meta fully working; TikTok/Snap/Google to-contract stubs) + `normalizeCreativeError`.
3. **Edge fns** `admin-creative-upload`, `admin-creative-list`, `admin-creative-tag`, `admin-creative-select` (+ `__tests__`).
4. **`supabase/config.toml`** — four `[functions.admin-creative-*] verify_jwt = true` blocks.
5. **mingla-admin** — `services/creativeLibrary.js`, `hooks/useCreativeLibrary.js`, route `/ad-engine/creatives`, components (`CreativeLibraryPage`, `CreativeCard`, `CreativeUploadModal`, `VenueTagPicker`, `CreativePicker`).
6. **Amend `admin-meta-create-campaign`** (#862) to accept `creative_id` → `resolveCreativeRef(…, 'meta', lane)` (backward-compatible with the existing `image_url` path) — **coordination point** (§4.4e).
7. **CI** — extend the RT-3 strict-grep gate + add the RT-4 schema assertion.

### Allowlist (implementor MAY create/modify ONLY these)
- `supabase/migrations/<ts>_issue_866_creative_library.sql` (new)
- `supabase/functions/_shared/creatives.ts` (new)
- `supabase/functions/admin-creative-upload/**`, `admin-creative-list/**`, `admin-creative-tag/**`, `admin-creative-select/**` (new)
- `supabase/functions/admin-meta-create-campaign/**` — **amend only** the creative-resolution block per §4.4e (backward-compatible; do not alter #862's connection/destination/budget/no-orphan logic)
- `supabase/config.toml` (append the four function blocks only)
- `mingla-admin/src/**` (new library route, service, hook, components + the embeddable `CreativePicker`; wire into existing admin nav only)
- CI workflow file for the strict-grep + schema gates (append jobs)

### DO-NOT-TOUCH (stop-and-amend before any edit)
- `supabase/functions/_shared/meta.ts` (#862) — **import** `metaGraph`/`resolveMetaToken`/lane env; do **not** modify its signatures.
- #864's `meta-ad-creatives` bucket migration + `mediaUpload.js` — **reuse**, do not alter (the bucket is the shared substrate).
- Existing `_shared/{stripe*,paystack*,cors,audit,idempotency,stripeEdgeAuth}.ts`, and every existing `admin-*`/`stripe*`/`events`/`discover-*` function — reuse by import only.
- `place_pool` / `brands` / `admin_users` / `events` schemas — **read only** (FK reference `place_pool`/`brands`; add no columns to them).
- `app-mobile/**`, `mingla-business/**` — no consumer/business/public-web changes.
- Any `app.json` / `eas.json` / store-submit config.
Anything outside the allowlist → request a `SPEC_AMENDMENT_ISSUE-866_*` before touching.

---

## 11. Open decisions (with recommendations)

- **OD-1 — Venue FK target:** `place_id → public.place_pool(id)` **[RECOMMEND — migration-verified as the canonical venue entity; sibling tables already FK it]**. Re-confirm at implementation that META-ORCH-1186 venue-unification hasn't introduced a different canonical table; if it has, re-point the FK. Never create a new venue table.
- **OD-2 — Video → platform upload source:** Meta/TikTok/Snap accept a **remote URL** → pass the **Bunny playback/source URL** directly **[RECOMMEND]**. **Google `YoutubeVideoAsset` requires a YouTube-hosted video** (`youtube_video_id`) — Bunny cannot upload directly. **Recommend deferring Google *video* creatives** until a YouTube upload path exists; Google *image* and all other platforms are unaffected.
- **OD-3 — Upload timing:** **lazy, at ad-create** (`resolveCreativeRef` inside the engine) **[RECOMMEND — no wasted uploads, matches the "upload on demand" AC]** vs eager warm on select. Keep `admin-creative-select --warm` as an optional review-step nicety.
- **OD-4 — Video poster/thumbnail:** Meta + TikTok video creatives need a cover image. **Require an explicit `poster_url`** on video assets (DB CHECK) **[RECOMMEND]** vs auto-deriving a Bunny thumbnail. Recommend explicit `poster_url` (deterministic, admin-controlled).
- **OD-5 — Ref cache key:** include `external_account_id` in the UNIQUE key (survives account rebinds; Meta `image_hash` is account-scoped) **[RECOMMEND]** vs `(creative_id, platform, lane)` only.
- **OD-6 — AI creative generation:** **OUT of scope** for the whole Ad Engine right now **[RECOMMEND confirm]** — #866 stores/reuses human-made assets; auto-generation is a later, separate initiative.
- **OD-7 — Bucket:** **reuse #864's `meta-ad-creatives`** as the image + poster home **[RECOMMEND — it is explicitly the shared substrate]** vs a fresh `ad-creatives` bucket. Reuse now; rename semantics later only if the "meta-" prefix becomes misleading across four platforms (cosmetic, low priority).
- **OD-8 — Poster/video helper in admin:** reuse an existing Bunny upload helper if one exists in `mingla-admin`/`mingla-business`; only build `bunnyVideoUpload.js` if none is reusable. Confirm during recon.

---

## Downstream routing
**Next:** `mingla-implementor` (build from this SPEC in the worktree below) → `mingla-tester` (RLS + idempotency + fail-close + Meta live-fire once #862/#864 prereqs are applied) → orchestrator CLOSE.
**Working tree:** `~/Desktop/mingla-orchs/issue-866-creative-library/` on branch `issue-866-creative-library`.

---

# Amendment A1 — battle-test corrections (2026-07-15, evidence-backed)

**Mode:** SPEC amendment, append-only (no code, no API writes). **Author:** mingla-forensics · **Date:** 2026-07-15.
**Evidence base:** `~/Desktop/mingla-orchs/issue-862-meta-ads-api/Mingla_Artifacts/research/ad-pipeline-2026-07-15/` — `GAP_REGISTER.md` (GR rows; §4 spec-corrections S-x/G-x/M-x; §6 DO-NOT-BUILD), `PIPELINE_BLUEPRINT.md` (§1.5 creative step; §2.1–§2.5 validation matrix; §4.2/§4.3), `PROOF_LOG.md` (S-P1/S-P4/S-P5, D-P1), `snapchat.md` §4a/§5, `google.md` §5.1/§5.3, `tiktok.md` G14.
**Alignment:** the canonical decisions below are conductor-fixed and identical across the parallel #862/#863/#867/#884 amendments — no per-spec drift.
**Reading rule:** original sections stand as historical record (append-only); where an item says SUPERSEDED, this amendment is the binding text.

---

## A1-1 — Platform enum: `'snap'` → `'snapchat'`, add `'reddit'`; ref cache keys on CONTENT

**Old (§4.2 `ad_creative_platform_refs` CHECK; §4.3 interface; §4.4d body; §5 SC-4/SC-6; §11):** `platform IN ('meta','tiktok','snap','google')`.
**New (SUPERSEDES):** `platform text NOT NULL CHECK (platform IN ('meta','tiktok','snapchat','google','reddit'))`. Every `'snap'` literal in this spec reads `'snapchat'` (A3 §D/§F is canonical). A `uploadToReddit` adapter **stub** joins the registry (typed fail-close "lane not provisioned") so the CHECK and the adapter interface stay total; real Reddit creative semantics are **a `t3_` post created via an async structured-posts job — there is NO media id on a Reddit ad** (GR-10) — owned by the new Reddit spec, not built here.
**Content addressing (new invariant):**
- `ad_creatives.content_hash text NOT NULL` — sha256 of the canonical bytes, computed by the A1-6 byte-probe, **never client-supplied**. Source bytes are **immutable after create**: changed bytes = a NEW `ad_creatives` row.
- `ad_creative_platform_refs.content_hash text NOT NULL` — snapshot at upload time. `resolveCreativeRef` returns a cached `ready` ref **only if the hashes match**; mismatch ⇒ fresh upload (and on Google, necessarily a fresh asset — see A1-5 immutability).
- The `UNIQUE (creative_id, platform, lane, external_account_id)` concurrency key is unchanged.
**Why:** the `'snap'`/`'snapchat'` mismatch silently breaks the cache key and the CHECK if #866 lands first (GR-14); a cache keyed on id/name without content silently reuses a stale Google asset (GR-53).
**Evidence:** GR-14 · GAP §4 S-8 · GR-53 · PIPELINE_BLUEPRINT §2.4 (asset-immutability row).

## A1-2 — Snap auth: there is NO static token; mint per call

**Old (§4.3 `uploadToSnap`; §6 SC-SEC-1; §9 RT-3 name list):** "Env names: `SNAP_ACCESS_TOKEN`".
**New (SUPERSEDES):** there is **no static Snap access token** — it is minted per call and expires in 3600 s (proven live: PROOF_LOG S-P1). `uploadToSnap` calls `mintSnapAccessToken()` (refresh-token grant) reading env **NAMES** `SNAPCHAT_REFRESH_TOKEN` / `SNAPCHAT_CLIENT_ID` / `SNAPCHAT_CLIENT_SECRET`; the minted access token lives in memory only — never persisted, logged, or echoed. §6 SC-SEC-1's name list is amended accordingly. The **strict-grep regression gate (§9 RT-3 in this spec)** must enumerate these REAL names; `SNAP_ACCESS_TOKEN` must appear **nowhere** — as spec'd, the adapter reads a secret that will never exist and **fails closed forever**.
**Evidence:** GR-14 ("There is no static Snap access token") · GAP §4 S-8 · PROOF_LOG S-P1 (`expires_in: 3600`, both scopes).

## A1-3 — Snap upload rewrite: `upload_from_url` DOES NOT EXIST

**Old (§4.0 table Snapchat row; §4.3 `uploadToSnap`):** `POST .../media/{media_id}/upload_from_url` (`source_url`/Bunny URL).
**New (SUPERSEDES) — `uploadToSnap` flow:**
1. `POST /v1/adaccounts/{acct}/media` (`type: IMAGE|VIDEO`) → `media_id`.
2. **Bytes, not URLs.** ≤32 MB → `POST /v1/media/{media_id}/upload` (**`multipart/form-data`, NOT JSON**). >32 MB → `POST /v1/media/{media_id}/multipart-upload-v2` (**INIT → ADD → FINALIZE**, max **32 chunks × 32 MB = 1 GB**, per-chunk retry).
3. **Source-byte resolution:** Bunny Stream serves **HLS, not a downloadable MP4** — there is no single file to fetch. REQUIRED: resolve a **direct MP4 rendition** from Bunny **or** keep an **MP4 master in Supabase Storage** alongside the Bunny id (new column `ad_creatives.mp4_master_url text NULL`; one of the two byte sources MUST resolve at `resolveCreativeRef` time for any video destined for Snap or Google — enforced in the resolver, not by DB CHECK, so a Meta/TikTok-only video is not blocked at upload).
4. Poll `media_status` → **`READY`** before returning the ref (a creative referencing `PENDING_UPLOAD` media fails).
5. **Handoff contract to #867** (mirror of A1-10): the creative-create consumer polls creative `packaging_status` → **`SUCCESS`**, and every Snap response assertion checks **`request_status` AND every per-entity `sub_request_status`** — an HTTP 200 with `request_status:"SUCCESS"` can still carry `sub_request_status:"FAILURE"` (envelope shape confirmed live: S-P5).
6. **Runtime limits:** the 1 GB chunked path may exceed Deno edge memory/time limits. The adapter guarantees the ≤32 MB single-shot path; the chunked path sits behind an explicit size check with a typed error, and the implementor must measure and record edge limits — if infeasible in-edge, **stop-and-amend**, never silently buffer.
**Context (not a #866 field):** the Snap Public Profile `profile_id` is unverifiable pre-create with our token class (S-P4: businessapi lookup → 403) — config-trusted, owned by #867; #866's media path never touches it.
**Evidence:** GR-09 ("the single largest under-scoped work item in the Snap lane") · GAP §4 S-5, S-9 · snapchat.md §4a ("There is NO documented `upload_from_url` endpoint. Snap ingests raw bytes") · PROOF_LOG S-P4, S-P5 · PIPELINE_BLUEPRINT §1.5 "The Snapchat upload path", §4.3.

## A1-4 — Google video: the YouTube "blocker" is WRONG — **OD-2 CLOSED**

**Old (§4.0 Google row; §4.3 `uploadToGoogle` video; §7 item 6; §11 OD-2):** "`YoutubeVideoAsset` requires a YouTube-hosted video — Bunny cannot upload directly → YouTube dependency; defer Google video creatives."
**New (SUPERSEDES):** half true, wrong conclusion. True: `YoutubeVideoAsset` takes no bytes and no URL. **False that this forces a YouTube channel + the YouTube Data API.** **`YouTubeVideoUploadService.CreateYouTubeVideoUpload` accepts raw video bytes over resumable REST** — `POST https://googleads.googleapis.com/resumable/upload/v{N}/customers/{cid}/youTubeVideoUploads:create` with headers `X-Goog-Upload-Protocol: resumable`, `X-Goog-Upload-Command: start|upload|query|finalize`, `X-Goog-Upload-Header-Content-Length`, `X-Goog-Upload-Offset`.
- **`channel_id` omitted ⇒ Google-managed YouTube channel** tied to the Ads account: **no YouTube channel, no YouTube Data API**; privacy forced **UNLISTED** (trade-off: no YT analytics / view-remarketing / appeals on the asset). `channel_id` supplied ⇒ own brand channel, user-auth only, `PUBLIC` allowed — a later option, not a dependency.
- Poll `state`: **`PENDING → UPLOADED → PROCESSED`** (fail-close on `FAILED|REJECTED|UNAVAILABLE`; same async shape as Meta's `video_status='ready'`) → output-only `video_id` → `YoutubeVideoAsset {youtube_video_id}` → link.
- REST is officially supported ("only … the Python client library and by using REST") ⇒ the Deno/TS edge adapter qualifies natively. **Reject the YouTube Data API alternative** (~100 uploads/day bucket + separate `youtube.upload` scope + channel + OAuth consent — strictly worse).
- Video bytes come from the same MP4 source rule as A1-3 step 3.
**OD-2 status: CLOSED.** Google video creatives are IN scope for the adapter contract. **§7 item 6 (YouTube provisioning ask) is WITHDRAWN** — no human provisioning is needed.
**Evidence:** GAP §4 G-7 · GR-36 · §6 DO-NOT-BUILD #5 · google.md §5.3 (full service/resource contract + state enum) · PIPELINE_BLUEPRINT §1.5 "The Google video path", §4.3.

## A1-5 — Google images: bytes ONLY, pre-cropped, ≤5,120 KB, JPG/PNG, unique names, IMMUTABLE

**Old (§4.3 `uploadToGoogle` image):** "`AssetService.MutateAssets` `ImageAsset` (bytes/URL) → asset `resource_name`".
**New (SUPERSEDES):** **URL is not an option — Google never fetches remote URLs.** `uploadToGoogle` (image): fetch bytes from our storage → validate **≤5,120 KB** and **JPG/PNG only** (**GIF/WEBP are rejected** for marketing/logo assets despite `IMAGE_GIF`/`IMAGE_WEBP` existing in the `MimeType` enum — the enum is broader than the policy) → **pre-crop server-side** (the API has **NO crop parameter** — §6 DO-NOT-BUILD #12) from the master to the marketing ratios: **1.91:1 → 1200×628 (min 600×314) · 1:1 → 1200×1200 (min 300×300) · 4:5 → 960×1200 (min 480×600)** → base64 → `assets:mutate` → cache `resource_name` per ratio in `external_ref_extra` (primary `external_ref` = the 1.91:1 marketing asset).
- **Asset names are unique per account:** derive `mingla_{creative_id}_{ratio}_{content_hash:12}`; on duplicate-name error, auto-suffix.
- **Assets are IMMUTABLE:** an "edit" = new asset + relink, which **restarts review** ⇒ A1-1's content-hash rule is the cache-correctness guarantee.
**Evidence:** GAP §4 G-12 · GR-53 · §6 DO-NOT-BUILD #12 · google.md §5.1 (dims/min/byte-cap/format table) · PIPELINE_BLUEPRINT §2.4.

## A1-6 — Server-side byte-probe validator — **OD-6 PARTIALLY CLOSED**

**Old (§4.2 metadata; §2 non-goals / §11 OD-6):** `width/height/aspect_ratio/duration_seconds/mime_type` admin-supplied, nullable, never validated against the bytes; all variant work ruled out by OD-6. (#866 was transport-only: `watermark`/`safe zone`/`black bar`/`transcode`/`bitrate`/`codec` — 0 mentions.)
**New (SUPERSEDES) — validation is a byte-probe, not a form check:**
(a) **Probe:** `admin-creative-upload` gains a server-side probe step — **ffprobe-or-equivalent on the ACTUAL BYTES** — that populates `width/height/aspect_ratio/duration_seconds/mime_type` + `content_hash` + `has_audio boolean` (video). Admin-supplied dimensions are **ignored as inputs — never trusted**.
(b) **Constants table:** PIPELINE_BLUEPRINT **§2 (§2.1–§2.5) verbatim** is the validator's constants source — the implementor encodes those rows, and does NOT re-derive numbers. **Hard-reject only on rows marked [SPEC]/[OFFICIAL]; [3P]/[UNVERIFIED] rows are WARN-only** — validating on a wrong constant is worse than not validating (all of Reddit's pixel/byte numbers are [3P] ⇒ WARN).
(c) **Three tiers** (blueprint §1.5, including its exact operator messages):
- **AUTO-FIX** (deterministic transforms): resize, re-encode, re-container, **crop-to-ratio from the master**, **per-ratio variant derivation (4:5 + 1:1 + 9:16 slots)**, metadata strip.
- **HARD-REJECT**: video with **no audio track** (Snap auto-rejects silent video as "Low-Quality Creative"; TikTok requires audio); **over-duration** per channel (TikTok **POLICY 5–60 s** despite the 10-min technical limit; Snap Top Snap **3–180 s**); **watermarks / other-platform burn-ins**; **black bars / letterboxing** (edge-row luma — the #1 TikTok auto-reject); image over a channel byte cap after re-encode fails.
- **WARN**: safe zones — **Meta 9:16 top 14% / bottom 35% / sides 6%** (at 1080×1920 = **269 / 672 / 65 px**; usable band 950×979); **Snap top 150 px + bottom 150 px**; **TikTok caption-length-dependent** (engineering defaults, not TikTok constants); **Reddit bottom ~20%** (engagement-bar overlay); plus any [3P] number.
(d) **OD-6 status: PARTIALLY CLOSED.** AI/variant **GENERATION stays OUT of scope**. **Per-ratio CROPPING from an uploaded master is now IN scope** — it is a **deterministic transform** of an existing human-made asset, not generation. Normative distinction: transforms that change bytes but not meaning (crop/resize/re-encode/re-container) are library features; anything that synthesizes new content is not.
**Evidence:** GR-22 ("Server-side media probe … never trust admin-supplied dimensions") · GR-23 (Advantage+ placement union demands 4:5/1:1/9:16) · PIPELINE_BLUEPRINT §1.5 ("[DESIGN DECISION] … byte-probe, not a form check" + tier table + exact messages), §2 matrix, §4.2.

## A1-7 — DO-NOT-BUILD register (recorded so nobody re-adds them)

| # | The belief | Verdict |
|---|---|---|
| 1 | **Meta 20% text-in-image density validator** | **DEAD** — rule removed ~Sept 2020; Meta's live ad-standards page contains no text-density language at all. Build **safe-zone** validation instead (A1-6c). *(GAP §6 #1)* |
| 2 | **Meta video-bitrate validator** | **NO official number exists** ("5–10 Mbps" is folklore) — do not invent a constant. **TikTok's ≥516 kbps IS official — encode that one** (and Snap's −16 LUFS audio target). *(GAP §6 #9)* |
| 3 | **60/90-second Reels duration caps** | **FALSE — IG Reels = 15 min; FB Reels = no maximum.** Do not hardcode 60/90. *(GAP §6 #10 · §4 M-12)* |

Cross-refs already encoded above: GAP §6 #5 (the YouTube "blocker") → **A1-4**; GAP §6 #12 (a Google crop parameter) → **A1-5**.

## A1-8 — AI disclosure, creative `name`, poster/thumbnail

**New (§4.2 schema + §4.3 `uploadToMeta` / §4.4e):**
(a) `ad_creatives.ai_generated boolean NOT NULL DEFAULT false` → Meta **`self_ai_disclosure`**: `true ⇒ 'OPT_IN'`, `false ⇒ 'OPT_OUT'`. **Default `OPT_IN` (i.e. `ai_generated=true`) for anything originating from the Higgsfield/Remotion ad pipeline** — our creative pipeline is AI-generative and non-disclosure is a compliance exposure we are actively creating. Carried on the Meta creative create via #862's amended create fn. *(TikTok cannot express this: `aigc_disclosure_type` is `CUSTOMIZED_USER`-only and our account class is barred from `CUSTOMIZED_USER` — escalated separately; not buildable. GR-25.)*
(b) Meta creative **`name`** is passed on create ([SCHEMA] "strongly recommended"; without it the Meta-side library is unbrowsable) — derived from `ad_creatives.name`.
(c) **Poster/thumbnail:** the OD-4 DB CHECK (`kind='video' ⇒ poster_url NOT NULL`) **STANDS** — and now also serves **Reddit, where a thumbnail is REQUIRED for VIDEO posts [SPEC]**. No fixed official Meta thumbnail resolution exists — match the video's ratio.
**Evidence:** GR-61 · PIPELINE_BLUEPRINT §1.5 (`self_ai_disclosure` section), §2.1 (thumbnail row), §2.5 (Reddit thumbnail [SPEC] row).

## A1-9 — TikTok intake hardening

**Old (§4.3 `uploadToTikTok`):** URL-based `UPLOAD_BY_URL` flow — **kept; our public-URL-first design is compatible** — but zero constraints encoded.
**New (ADDS constraints):**
- Modes are **`UPLOAD_BY_URL` / `UPLOAD_BY_FILE_ID` only** (no multipart binary param).
- TikTok's fetch has a **10-second request timeout**, and `video_url` is *"recommended file size within 10 MB"* — a large Bunny video can exceed the fetch window; fall back to the A1-3 MP4-master source and `UPLOAD_BY_FILE_ID`.
- **FLAGGED PRE-BUILD CHECK:** nobody has verified TikTok's fetcher can reach Bunny (no hotlink/geo/allowlist analysis exists) — verify before build; fail-close with a typed error if unreachable.
- **File names are unique per advertiser:** pre-check with `file_name_check`; append a timestamp suffix on collision.
- Capture **BOTH** `image_id`/`video_id` **AND** `material_id`; `external_ref = material_id` with the raw id in `external_ref_extra` — reconfirmed unchanged.
- Video upload sets **`flaw_detect=true` + `auto_fix_enabled=true`** (auto-fixes `LOW_RESOLUTION` → 1280×720 and `ILLEGAL_VIDEO_SIZE` → 1:1/9:16/16:9; with auto-fix off, detected flaws return an error). Neither touches duration/watermarks/black bars/safe zones — those stay on A1-6. *(`creative_auto_enhancement_strategy_list` is an ad-create-side setting — owned by #863.)*
**Evidence:** GR-58 · tiktok.md G14 + Smart Fix contract · PIPELINE_BLUEPRINT §2.2.

## A1-10 — Meta video handoff (reconfirmed; consumer referenced, not duplicated)

#866's `uploadToMeta` video branch is **correct as spec'd**: `POST /act_{acct}/advideos` → poll `video_status='ready'` (bounded timeout; a video stuck in transcoding **fails close** per the no-orphan contract) → upload `poster_url` → thumbnail `image_hash` in `external_ref_extra`. The **consumer** side — `object_story_spec.video_data = {video_id, image_hash:<thumbnail>, title, message, link_description, call_to_action}` in the creative build — **is added by #862 Amendment A4; this spec references it and does not duplicate it.** §4.4e is amended to read: `creative_id` resolution returns `image_hash` (image) **or** `{video_id, thumbnail image_hash}` (video), consumed by #862-A4's `video_data` branch.
**Evidence:** GR-57 ("the A3 seam exists; #862's creative builder has no `video_data` branch") · GAP §4 M-10 · PIPELINE_BLUEPRINT §1.5/§3.4.

---

## A1 — Consolidated schema delta (net effect on §4.2)

- **`ad_creatives`:** + `content_hash text NOT NULL` (probe-derived) · + `has_audio boolean NULL` (video) · + `ai_generated boolean NOT NULL DEFAULT false` · + `mp4_master_url text NULL` (video byte source for Snap/Google) · + per-ratio variant slots (4:5 / 1:1 / 9:16, A1-6c) · `width/height/aspect_ratio/duration_seconds/mime_type` become **probe-populated, never client-trusted** · source bytes immutable after create (changed bytes = new row).
- **`ad_creative_platform_refs`:** platform CHECK → `('meta','tiktok','snapchat','google','reddit')` · + `content_hash text NOT NULL` · a cached `ready` ref is valid **only** on hash match.
- **Resolver-enforced (not DB CHECK):** video destined for Snap/Google must resolve an MP4 byte source (Bunny direct-MP4 rendition or `mp4_master_url`) at `resolveCreativeRef` time; Meta/TikTok-only videos are unaffected at upload.

## A1 — Flagged contradictions (recorded, not silently resolved)

1. **RT-gate numbering:** GR-14 says the "RT-4 strict-grep" must cover the real Snap env names; in THIS spec the strict-grep token gate is **RT-3** (RT-4 is the venue-schema gate). A1-2 applies the name-list change to RT-3; RT-4 is untouched. GR-14's label is a mislabel against this spec's numbering.
2. **§4.0's Snap row** claimed `upload_from_url` was "documented from Snap Marketing API contract" — it never was; the endpoint does not exist (snapchat.md §4a). Original text stands as historical record; A1-3 supersedes.
3. **Snap Top Snap max duration:** Snap's media table renders 1800 s; Snap's creative guidance says 3–180 s (1800 s most likely covers `LONGFORM_VIDEO`). **Validate 3–180 s; confirm live.**
4. **Google doc conflicts:** square recommended 600×600 vs 1200×1200 (**use 1200×1200**); logo min 128×128 vs 144×144 (**use 144×144 floor**). **No published Google aspect-ratio tolerance exists** — do not encode the folkloric ±1%.
5. **Meta FB-Stories bottom safe zone:** 35% (image page) vs 20% (video page) — a confirmed real Meta inconsistency; **design to the stricter unified 14/35/6**.
6. **TikTok carousel image byte cap:** 100 KB (suggested) vs 100 MB (GAB image) — TikTok's own numbers, 1000× apart; **validate per-format; WARN tier**.
7. **D-P1 (destination):** the OneLink serves crawlers an AppsFlyer interstitial — destination policy is owned by #862/A3, **no #866 delta** — noted here because creative-adjacent link fields must never default to the OneLink.

## A1 — Open-decision ledger after this amendment

| OD | Status |
|---|---|
| OD-2 (Google video source) | **CLOSED** — A1-4 (G-7/GR-36); §7 item 6 withdrawn |
| OD-6 (AI creative generation) | **PARTIALLY CLOSED** — generation stays OUT; deterministic per-ratio cropping from a master is IN (A1-6d) |
| OD-1, OD-3, OD-4, OD-5, OD-7, OD-8 | Unchanged (OD-4 reinforced by A1-8c) |
