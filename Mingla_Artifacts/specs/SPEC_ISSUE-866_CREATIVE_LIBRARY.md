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
