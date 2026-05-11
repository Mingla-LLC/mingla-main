# Spec: Event Cover Image Provider Pivot (ORCH-0783)

> Date: 2026-05-11
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`
> Original prompt: `Mingla_Artifacts/prompts/FORENSICS_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`
> Status: ready for operator/orchestrator review before implementation

## 1. Layman Summary

Event cover creation should stop asking organisers to pick a placeholder hue or upload a phone video for launch. Step 4 becomes a reliable image-first cover flow: upload a local image/GIF, pick a GIF from GIPHY, or pick a landscape photo from Pexels. Existing published image/GIF/video covers must continue to render, and the old video processing architecture stays in place but dormant until a later legacy-video spec decides what to do with it.

## 2. User Story

As a Mingla organiser, I want a fast cover picker with local images, GIFs, and provider imagery, so that I can make an event page look good without getting blocked by video processing or placeholder hue choices.

## 3. Scope

- **In scope:** Mingla Business event Step 4 cover UI, local image/GIF upload, GIPHY GIF search/select, Pexels photo search/select through a server proxy, cover-provider metadata persistence, public/checkout/order/card rendering parity, attribution rendering, and regression gates.
- **Non-goals:** no Cloudinary rework, no event-cover-video function deletion, no migration deletion, no provider key values in code/artifacts, no Pexels video, no GIPHY stickers/clips, no brand cover/profile media changes, no `coverHue` removal, no legacy video-rendering retirement.
- **Assumptions:** GIPHY production use is approved with public platform/section keys; Pexels requires a server-held API key; provider terms from the ORCH-0783 investigation remain the current launch authority.
- **Dependencies:** operator configures provider keys outside Git, operator/orchestrator reviews this spec before Codex `implementor-mingla`, and all behavior changes ship with repo-running regression tests in the same scoped commit/push.

## 4. Evidence Trace

| Requirement | Comes from finding / source | Confidence |
|---|---|---|
| Remove active Step 4 video upload and processing UI | Investigation F1; `CreatorStep4Cover.tsx` currently imports/opens/polls video upload paths | High |
| Remove visible Step 4 hue chooser only | Investigation F2; hard guard says keep `coverHue` until a legacy spec | High |
| Keep legacy published video rendering/fallback | Investigation backward-compat section; `EventCoverMedia` + `PublicEventPage` already render/fallback video | High |
| Add provider metadata columns | Investigation F3; provider attribution/source data is absent from current `events` contract | High |
| Split GIPHY/Pexels integration shape | Investigation F4; GIPHY client-side rule and Pexels Authorization key/rate-limit docs | High |
| Rewrite old ORCH-0770/0776 gates that require active video UI | Investigation F5; current strict-grep scripts fail if Step 4 stops using video controls | High |

## 5. Success Criteria

1. Step 4 presents local image/GIF upload, GIPHY, and Pexels cover choices; it does not present `Video`, video trimming, processing progress, timeout recovery, replace-video, cancel-processing, or a visible `Cover style` hue grid.
2. Selecting a local image/GIF stores `cover_media_url`, `cover_media_type`, `cover_media_provider = 'upload'`, and clears provider credit/source/alt metadata.
3. Selecting a GIPHY result stores a GIF rendition URL as `cover_media_url`, stores `cover_media_type = 'gif'`, stores provider/source/credit/alt metadata, and displays required GIPHY attribution in the picker and selected-cover preview/public attribution slot.
4. Selecting a Pexels result stores `src.landscape` as `cover_media_url`, stores `cover_media_type = 'image'`, stores photographer/source/alt metadata, and displays compact public credit.
5. Public event page, checkout, order/ticket, organiser cards, and Step 7 preview render provider media without breaking existing image/GIF/video/hue fallback behavior.
6. Existing rows with `cover_media_type = 'video'` still render through the current safe video path or fall back for legacy unsafe MOV/QuickTime URLs.
7. All changed behavior is covered by repo-running automated tests in the same scoped commit/push; any impossible automation becomes an explicit tester manual gate.

## 6. Invariants

### Must Preserve

| Invariant | Enforcement in this spec | Verification |
|---|---|---|
| Raw phone video must not become public cover URL | Do not modify event-cover-video Edge apply/webhook contract except to narrow old active-UI gates | `npm run test:orch-0770`; `npm run test:orch-0776`; Deno shared video tests |
| `coverHue` remains fallback/backcompat | Remove only Step 4 picker UI; keep field in stores, theme, renderers, and fallback rendering | `eventCoverMedia.test`; ORCH-0783 strict-grep gate |
| Published legacy video rows remain readable/renderable | Keep `EventCoverMedia` video support and `isLegacyUnsafeEventCoverVideoUrl` | public/checkout/order tests and manual legacy row QA |
| Strict-grep registry pattern | Add one new script and one job to `.github/workflows/strict-grep-mingla-business.yml` | `node .github/scripts/strict-grep/orch-0783-event-cover-image-provider-pivot.mjs` |
| No provider secrets in Git | Only env variable names are referenced; no values, local secret files, or `.env` contents | code review + `git diff --check` + tester secret scan |

### New Invariants

| Invariant | Owner | Enforcement | Verification |
|---|---|---|---|
| Active event Step 4 is image/provider-only | `CreatorStep4Cover.tsx` | ORCH-0783 strict-grep forbids active video picker/imports/copy/recovery and visible hue grid | `npm run test:orch-0783` |
| Provider media must carry source/credit metadata | `events` schema + mappers | Nullable DB columns, service normalization, publish/autosave hydration tests | `serverDraftEventMapper.test`, publish/public service tests |
| GIPHY and Pexels cannot share one proxy | Provider adapters | GIPHY adapter uses direct client fetch; Pexels uses Edge proxy client | GIPHY/Pexels adapter tests |

## 7. Database / RLS / Migration

Migration filename must be monotonic and greater than current max `20260515000017`:

```sql
-- Migration: 20260515000018_orch_0783_event_cover_provider_metadata.sql

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS cover_media_provider text NULL,
  ADD COLUMN IF NOT EXISTS cover_media_source_url text NULL,
  ADD COLUMN IF NOT EXISTS cover_media_credit text NULL,
  ADD COLUMN IF NOT EXISTS cover_media_credit_url text NULL,
  ADD COLUMN IF NOT EXISTS cover_media_alt text NULL;

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_cover_media_provider_check,
  ADD CONSTRAINT events_cover_media_provider_check
    CHECK (
      cover_media_provider IS NULL
      OR cover_media_provider IN ('upload', 'giphy', 'pexels')
    );

COMMENT ON COLUMN public.events.cover_media_provider IS
  'ORCH-0783: event cover source provider. NULL for legacy rows; upload/giphy/pexels for new image-provider covers.';
COMMENT ON COLUMN public.events.cover_media_source_url IS
  'ORCH-0783: provider source/page URL for attribution and audit; NULL for local uploads and legacy rows.';
COMMENT ON COLUMN public.events.cover_media_credit IS
  'ORCH-0783: provider display credit, e.g. photographer name or GIPHY title/provider label.';
COMMENT ON COLUMN public.events.cover_media_credit_url IS
  'ORCH-0783: provider credit/profile/source link for attribution.';
COMMENT ON COLUMN public.events.cover_media_alt IS
  'ORCH-0783: provider alt/title text for accessibility and moderation.';

CREATE OR REPLACE VIEW public.business_management_events_view
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.brand_id,
  e.created_by,
  b.slug AS brand_slug,
  b.name AS brand_name,
  b.profile_photo_url AS brand_profile_photo_url,
  b.display_attendee_count AS brand_display_attendee_count,
  e.title,
  e.description,
  e.slug,
  e.location_text,
  e.online_url,
  e.is_online,
  e.is_recurring,
  e.is_multi_date,
  e.recurrence_rules,
  e.cover_media_url,
  e.cover_media_type,
  e.cover_media_provider,
  e.cover_media_source_url,
  e.cover_media_credit,
  e.cover_media_credit_url,
  e.cover_media_alt,
  e.visibility,
  e.show_on_discover,
  e.status,
  e.published_at,
  e.timezone,
  e.created_at,
  e.updated_at,
  (e.theme - 'business_draft') AS management_theme,
  e.currency
FROM public.events e
JOIN public.brands b ON b.id = e.brand_id
WHERE e.deleted_at IS NULL
  AND b.deleted_at IS NULL
  AND e.status IN ('scheduled', 'live', 'ended', 'cancelled');

GRANT SELECT ON public.business_management_events_view TO authenticated, service_role;
REVOKE SELECT ON public.business_management_events_view FROM anon;

CREATE OR REPLACE VIEW public.business_public_events_view
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.brand_id,
  b.slug AS brand_slug,
  b.name AS brand_name,
  b.description AS brand_description,
  b.profile_photo_url AS brand_profile_photo_url,
  b.display_attendee_count AS brand_display_attendee_count,
  e.title,
  e.description,
  e.slug,
  e.location_text,
  e.online_url,
  e.is_online,
  e.is_recurring,
  e.is_multi_date,
  e.recurrence_rules,
  e.cover_media_url,
  e.cover_media_type,
  e.cover_media_provider,
  e.cover_media_source_url,
  e.cover_media_credit,
  e.cover_media_credit_url,
  e.cover_media_alt,
  e.visibility,
  e.show_on_discover,
  e.status,
  e.published_at,
  e.timezone,
  e.created_at,
  e.updated_at,
  (e.theme - 'business_draft') AS public_theme,
  e.currency
FROM public.events e
JOIN public.brands b ON b.id = e.brand_id
WHERE e.deleted_at IS NULL
  AND b.deleted_at IS NULL
  AND e.visibility = 'public'
  AND e.status IN ('scheduled', 'live', 'ended', 'cancelled');

GRANT SELECT ON public.business_public_events_view TO anon, authenticated, service_role;

-- In public.business_publish_event_draft, add variables:
--   v_cover_media_provider text;
--   v_cover_media_source_url text;
--   v_cover_media_credit text;
--   v_cover_media_credit_url text;
--   v_cover_media_alt text;
-- Then read them from p_draft_payload and write them in the existing UPDATE public.events SET block.
-- The function body is long and was last replaced in 20260515000009; implementor must copy that latest body and make only the ORCH-0783 additions.

NOTIFY pgrst, 'reload schema';
```

- RLS policies: no new table and no new policies. Existing `events` RLS governs the new nullable columns.
- Backfill/data migration: none. Existing rows remain `NULL` provider metadata, including legacy video rows.
- Indexes/constraints: provider check only. Do not add stricter provider-not-null constraints until runtime legal/UX requirements are proven; app/tests enforce selected provider completeness.
- Rollback: dropping only the five new nullable metadata columns is mechanically possible, but release rollback should first stop provider selection in the app. Never drop `cover_media_type = 'video'`, `event_cover_video_jobs`, storage MIME allowances, or Edge Functions in this rollback.

## 8. Edge Functions / RPCs / Webhooks

### `event-cover-pexels-search`

- **Path:** `supabase/functions/event-cover-pexels-search/index.ts`
- **Auth:** authenticated Mingla Business users only. Verify JWT via Supabase client; return 401 for missing/invalid auth. No service-role table mutation is required.
- **Request schema:** JSON body `{ query: string; page?: number; perPage?: number }`. Trim query; require length 2..80; clamp `page` to 1..50 and `perPage` to 6..20.
- **Provider request:** `GET https://api.pexels.com/v1/search?query=...&orientation=landscape&per_page=...&page=...` with `Authorization: PEXELS_API_KEY`.
- **Success response:** `{ photos: NormalizedPexelsCover[]; page: number; nextPage: number | null; rateLimit: { limit: number | null; remaining: number | null; reset: string | null } }`.
- **Normalized photo:** `{ id: number; provider: "pexels"; mediaUrl: string; sourceUrl: string; credit: string; creditUrl: string; alt: string | null; avgColor: string | null; width: number; height: number }`, where `mediaUrl = photo.src.landscape`.
- **Error responses:** 400 `invalid_query`, 401 `auth_required`, 429 `pexels_rate_limited`, 502 `pexels_unavailable`, 500 `pexels_not_configured`.
- **External calls/timeouts/retries:** abort provider request after 8 seconds; no automatic retry on 429; one retry allowed only for network timeout/5xx if it does not exceed 10 seconds total.
- **Idempotency:** read-only search; no idempotency key needed.
- **Deploy notes:** requires Supabase Edge Function secret named `PEXELS_API_KEY` with no value committed or printed. Deploy only after Deno check/tests pass.

### Existing `event-cover-video-*`

- No deletion, no undeploy, no Cloudinary behavior change, no schema cleanup.
- Old active-UI strict-grep requirements may be narrowed so they protect dormant video processing contracts and legacy public rendering, not Step 4 video entry points.

## 9. Service Layer

### Provider metadata type

- **Path:** `mingla-business/src/types/eventCoverProvider.ts` or colocated in `draftEventStore.ts` if no local type folder pattern fits.
- **Types:**

```ts
export type EventCoverMediaProvider = "upload" | "giphy" | "pexels";

export interface EventCoverProviderMetadata {
  provider: EventCoverMediaProvider | null;
  sourceUrl: string | null;
  credit: string | null;
  creditUrl: string | null;
  alt: string | null;
}
```

### Local upload

- **Path:** `mingla-business/src/services/eventCoverMediaService.ts`
- **Signature change:** `updatePublishedEventCoverMedia(serverEventId, mediaUrl, mediaType, metadata?)`.
- **Query/client behavior:** when local upload succeeds, callers set provider metadata to `{ provider: "upload", sourceUrl: null, credit: null, creditUrl: null, alt: null }`.
- **Error contract:** visible upload errors remain; video-specific copy is removed from active local upload.
- **Return type:** keep `EventCoverUploadResult` and add optional normalized metadata only if useful; do not return video-specific fields for active Step 4 upload.
- **Important split:** preserve legacy classification/presentation helpers for video rendering, but active Step 4 local upload must reject or never route video assets through this service.

### GIPHY client adapter

- **Path:** `mingla-business/src/services/giphyEventCoverService.ts`
- **Signature:** `searchGiphyEventCovers(query: string, options?: { limit?: number; offset?: number }): Promise<GiphyCoverSearchResult[]>`
- **Query/client behavior:** direct client fetch to `https://api.giphy.com/v1/gifs/search` with exact query, public API key env, `rating=pg`, `limit` clamped 6..25, no proxy, no Supabase copy/cache.
- **Normalization:** use a small grid rendition for preview and `images.downsized_medium.url` as selected GIF URL unless absent, then `images.downsized.url`, then `images.original.url`.
- **Selected metadata:** provider `giphy`, type `gif`, source URL from result URL/source/post URL when present, credit `GIPHY`, credit URL source/result URL, alt from title.
- **Error contract:** throw typed `EventCoverProviderError` with `not_configured`, `rate_limited`, `provider_unavailable`, `invalid_response`.

### Pexels client adapter

- **Path:** `mingla-business/src/services/pexelsEventCoverService.ts`
- **Signature:** `searchPexelsEventCovers(query: string, options?: { page?: number; perPage?: number }): Promise<PexelsCoverSearchPage>`
- **Query/client behavior:** call Supabase Edge Function `event-cover-pexels-search`; never read `PEXELS_API_KEY` client-side.
- **Return type:** normalized photo results matching Edge response.
- **Error contract:** typed `EventCoverProviderError`; UI can distinguish missing key/rate limit/network/empty.

## 10. Hook / State / Cache Layer

### `DraftEvent`

- **Path:** `mingla-business/src/store/draftEventStore.ts`
- **Fields to add after `coverMediaType`:**
  - `coverMediaProvider: EventCoverMediaProvider | null`
  - `coverMediaSourceUrl: string | null`
  - `coverMediaCredit: string | null`
  - `coverMediaCreditUrl: string | null`
  - `coverMediaAlt: string | null`
- **Defaults:** all null.
- **Mutation behavior:** every cover selection updates URL/type/provider metadata atomically in one `updateDraft` call.
- **Remove cover behavior:** clears URL/type/provider/source/credit/creditUrl/alt and leaves `coverHue` unchanged.
- **Persist migration:** if persisted drafts lack fields, hydrate them to null without dropping existing media.

### `LiveEvent`

- **Path:** `mingla-business/src/store/liveEventStore.ts`
- Add the same five provider metadata fields to `LiveEvent` and `EditableLiveEventFields`.
- Update persist migration for older live events to backfill null metadata.
- Preserve `coverMediaType` union including `video`.

### Autosave/publish mappers

- **Path:** `mingla-business/src/utils/serverDraftEventMapper.ts`
- Add metadata columns to `ServerDraftEventRow`, `ServerDraftEventInsert`, `ServerDraftEventUpdate`, and `BusinessDraftPayload` only where needed.
- Include the five metadata fields in draft create/autosave/update payloads and hydration.
- Keep `coverHue` inside theme payload exactly as today.

### Provider search state

- Prefer local component state inside `CreatorStep4Cover` or a small child component. Do not introduce persisted Zustand cache for provider results.
- Search states: idle, typing, loading, empty, populated, error, selecting.
- Debounce provider search by 300 ms; minimum query length 2; cancellation/ignore-stale results required.

## 11. Component / Screen Layer

### `CreatorStep4Cover`

- **Path:** `mingla-business/src/components/event/CreatorStep4Cover.tsx`
- **Props:** keep existing props for compatibility, but remove active use of `onCoverVideoProcessingChange` in Step 4. Do not delete the prop if parent edit flows still pass it; leave as inert until later cleanup.
- **States:**

| State | Condition | Renders |
|---|---|---|
| Empty/fallback | no `coverMediaUrl` | `EventCoverMedia` fallback with `coverHue`; no hue grid |
| Local upload ready | always | `Upload image/GIF` action |
| Provider ready | provider env/proxy reachable | `GIPHY` and `Pexels` entry points |
| Uploading/selecting | local/provider selection in flight | disabled actions and spinner copy |
| Provider empty | valid query returns no results | inline empty text for that provider |
| Provider error | provider not configured, rate limited, network/server failure | visible provider-specific error and retry |
| Selected provider cover | provider metadata present | preview image/GIF plus compact attribution |

- **Interactions:**

| Action | Handler | Effect |
|---|---|---|
| Upload image/GIF | existing image picker path | uploads local image/GIF, sets provider `upload`, clears credit metadata |
| Search GIPHY | GIPHY adapter | displays GIPHY-only grid with `Powered By GIPHY` attribution |
| Select GIPHY result | provider select handler | sets URL/type/provider/source/credit/alt and updates preview |
| Search Pexels | Pexels adapter | displays Pexels-only grid with photo credits in results |
| Select Pexels result | provider select handler | sets `src.landscape`, `image`, provider metadata, and preview |
| Remove | `handleRemoveCover` | clears media and metadata, leaves `coverHue` fallback |

- **Copy:**
  - Upload button: `Upload image/GIF`
  - Provider actions: `GIPHY`, `Pexels`
  - Upload limit: `Upload an image or GIF up to 30 MB.`
  - Pexels attribution: `Photo by {credit} on Pexels`
  - GIPHY attribution: `Powered By GIPHY`
  - Pexels missing key: `Pexels covers are temporarily unavailable. Upload an image or try GIPHY.`
  - GIPHY unavailable: `GIPHY covers are temporarily unavailable. Upload an image or try Pexels.`
- **Accessibility:** provider result tiles need labels naming provider, credit/title, and selection action; attribution links need accessibility labels.
- **Layout/design constraints:** no visible `Cover style` section; no nested card-in-card; provider grids must be separate tabs/sections so GIPHY results are not mixed with Pexels results.

### `EventCoverMedia`

- **Path:** `mingla-business/src/components/ui/EventCoverMedia.tsx`
- Add optional attribution child/slot or a small exported `EventCoverAttribution` helper. Do not remove video support.
- Provider attribution should render as overlay or immediately below cover depending on surface. It must not block audio controls or hero chrome.

### Public and commerce surfaces

- **Paths:** `PublicEventPage.tsx`, `app/checkout/[eventId]/index.tsx`, `app/o/[orderId].tsx`, `EventListCard.tsx`, `CreatorStep7Preview.tsx`, `PreviewEventView.tsx` if present.
- Render provider covers through existing `EventCoverMedia`.
- Public page must show compact provider credit for Pexels and GIPHY selected covers. Checkout/order/card surfaces may show attribution only if layout allows; if omitted outside public/edit preview, tests must assert public attribution remains present.
- Preserve `isLegacyUnsafeEventCoverVideoUrl` in public page.

## 12. Business / Admin / Public Parity

- Business app changes: Step 4 and related organiser preview/card/detail rendering only.
- Admin changes: none.
- Public/web changes: public event hero renders provider media and public attribution; legacy video fallback remains.
- Operational dependency: provider configuration belongs to operator/deploy, not Git.

## 13. Realtime / Notifications / Analytics

- Realtime: none.
- Notifications: none.
- Analytics: defer GIPHY Action Register analytics for this launch pivot unless operator/legal requires it before implementation. The spec still requires visible GIPHY attribution and metadata preservation. Add an implementation discovery if GIPHY production approval requires analytics pingbacks as a launch condition.

## 14. Implementation Order

1. Add the migration `20260515000018_orch_0783_event_cover_provider_metadata.sql` with nullable metadata columns, view replacements, publish RPC additions, and PostgREST schema reload.
2. Add shared provider metadata types and update `DraftEvent` / `LiveEvent` fields, defaults, and persistence migrations.
3. Update server draft mapper, business event service, public event service, publish/autosave flows, and published cover-only update service to carry metadata.
4. Add `event-cover-pexels-search` Edge Function and focused Deno tests without exposing secrets.
5. Add GIPHY and Pexels client adapters plus typed provider error handling.
6. Refactor `CreatorStep4Cover` into image/provider-only Step 4, removing active video and hue UI while preserving fallback rendering.
7. Add attribution rendering on Step 4 preview and public event hero; verify checkout/order/card parity.
8. Rewrite old ORCH-0770/0776 tests/gates so they no longer require active Step 4 video upload, while preserving legacy video safety checks.
9. Add ORCH-0783 strict-grep gate, package script, workflow job, and `.github/scripts/strict-grep/README.md` entry.
10. Run the full verification matrix and write the implementation report.

## 15. Test Matrix

| ID | Scenario | Input/setup | Expected | Layer | Verification |
|---|---|---|---|---|---|
| T1 | Step 4 active video removed | inspect source | no `mediaTypes: ["videos"]`, video processing imports/copy/recovery, `Video`, `Replace video`, `Cancel processing` | Component/gate | `npm run test:orch-0783` |
| T2 | Step 4 hue chooser removed | inspect source | no visible `Cover style` hue grid or `HUE_TILES` picker | Component/gate | `npm run test:orch-0783` |
| T3 | Local image upload still works | PNG/JPEG/WebP fixture | uploads, verifies URL, provider `upload`, no credit metadata | Service/component | `eventCoverMediaService.test` |
| T4 | Local GIF upload still works | GIF fixture | stores type `gif`, renders as image/GIF path | Service/render | `eventCoverMediaService.test`, `eventCoverMedia.test` |
| T5 | Active local video rejected/unreachable | video picker/source fixture | active Step 4 cannot launch video; upload adapter rejects if called in active path | Component/service | `eventCoverMedia.test`, strict-grep |
| T6 | GIPHY search query | query `jazz night` | direct client call includes exact `q`, `rating=pg`, no proxy/cache/copy | Adapter | new `giphyEventCoverService.test` |
| T7 | GIPHY select | normalized result | stores GIF URL/type/source/credit/alt and visible GIPHY attribution | Adapter/component | new adapter + Step 4 tests |
| T8 | Pexels proxy search | query `supper club` | Edge calls Pexels with Authorization server-side and `orientation=landscape` | Edge/service | Deno test + `pexelsEventCoverService.test` |
| T9 | Pexels select | normalized photo | stores `src.landscape`, type `image`, photographer/source/alt | Adapter/component | service + mapper tests |
| T10 | Provider metadata persists | draft autosave/publish | metadata survives create, autosave, hydration, publish, public service mapping | Mapper/service | `serverDraftEventMapper.test`, `businessEventsPublish.test`, `publicEventsService.test` |
| T11 | Public attribution | provider event rows | public hero renders provider cover and compact attribution | Public UI | `eventCoverMedia.test` or focused public test |
| T12 | Checkout/order parity | provider event rows | selected provider media renders without breaking layout | Commerce UI | focused Jest/source tests plus manual QA |
| T13 | Legacy safe video | existing `video/mp4` row | still renders via `EventCoverMedia` and can show audio control | Render | preserved `eventCoverMedia.test` |
| T14 | Legacy unsafe video | existing MOV/QuickTime URL | public page nulls media and falls back to hue | Render | preserved ORCH-0770 test |
| T15 | Pexels missing key/rate limit | mocked Edge 500/429 | visible provider-specific error; local upload and GIPHY remain usable | Edge/UI | Deno + service/component tests |
| T16 | GIPHY not configured/rate error | missing env/mocked 429 | visible provider-specific error; local upload and Pexels remain usable | Service/UI | adapter/component tests |

## 16. Regression Prevention

- **Structural safeguard:** new strict-grep `.github/scripts/strict-grep/orch-0783-event-cover-image-provider-pivot.mjs`.
- **Test:** `mingla-business/package.json` adds `test:orch-0783`, and the implementation must run it locally.
- **Protective comment / documentation:** update `.github/scripts/strict-grep/README.md` and workflow registry comments to list ORCH-0783.
- **Artifact update:** implementation report must cite this spec and list exactly which ORCH-0770/0776 assertions were retired/narrowed and why.

The ORCH-0783 strict-grep gate must:

- Fail if `CreatorStep4Cover.tsx` contains `mediaTypes: ["videos"]`, `createEventCoverVideoUploadIntent`, `validateNativeTrimmedEventCoverVideo`, `EVENT_COVER_VIDEO_PROCESSING_COPY`, `Replace video`, `Cancel processing`, or visible `Cover style` hue-grid markers.
- Fail if GIPHY/Pexels adapter files or tests are missing.
- Fail if Pexels key names appear in `mingla-business/src` as public env reads.
- Allow video references only in legacy renderer/service/Edge files with explicit code paths not reachable from Step 4.

## 17. Rollback And Deploy Safety

- **Migration order:** `20260515000018` or higher; do not use an out-of-order migration. Include `NOTIFY pgrst, 'reload schema';`.
- **Edge function deploy:** deploy only new `event-cover-pexels-search`; do not redeploy/delete video functions unless orchestrator explicitly chooses to deploy unchanged functions.
- **Mobile OTA vs native build:** no new native module is expected; Expo OTA should be sufficient if dependencies stay unchanged.
- **Business/admin web deploy:** business web deploy needed after merge for provider UI/public attribution.
- **Env vars/secrets:** GIPHY public key names may be configured per platform/section; Pexels secret must be `PEXELS_API_KEY` in Supabase Edge Function secret storage. No values in artifacts, code, chat, or local secret files.
- **Partial rollback risk:** if app rolls back after migration, nullable columns are harmless. If migration rolls back while app still writes metadata, writes fail with unknown columns; app rollback must happen first.

## 18. Verification Commands

Minimum implementor verification:

```bash
cd mingla-business
npm run test:orch-0758a
npm run test:orch-0783
npm run test:orch-0770
npm run test:orch-0776
npm run tsc -- --noEmit
cd ..
deno test --allow-env --allow-net supabase/functions/event-cover-pexels-search/index.test.ts
deno test --allow-env --allow-net supabase/functions/_shared/eventCoverVideo.test.ts
node .github/scripts/strict-grep/orch-0783-event-cover-image-provider-pivot.mjs
git diff --check
```

If `test:orch-0770` or `test:orch-0776` is redefined/narrowed, the implementation report must name the exact retired Step 4 active-video assertions and the preserved legacy/dormant-video assertions.

## 19. Manual QA Plan

Tester must verify iOS Simulator, Android Emulator, and Web Browser parity:

| Gate | Platforms | Expected result |
|---|---|---|
| Local image upload | iOS, Android, Web | preview updates, draft hydrates, publish/save preserves cover |
| Local GIF upload | iOS, Android, Web | GIF selected and rendered; no video UI appears |
| GIPHY search/select | iOS, Android, Web | results load, attribution visible, selection persists metadata |
| Pexels search/select | iOS, Android, Web | landscape photos load through proxy, credit/source/alt persist |
| Remove cover | iOS, Android, Web | media and metadata clear; fallback returns; hue chooser stays hidden |
| No video entry point | iOS, Android, Web | no Video/trim/processing/replace/cancel path |
| No hue chooser | iOS, Android, Web | no Step 4 `Cover style` grid |
| Public page | iOS, Android, Web | provider cover renders and public attribution appears |
| Checkout/order | iOS, Android, Web | provider/local cover renders without overlap |
| Provider failures | Web plus one native | provider-specific error; other cover choices remain usable |
| Existing legacy video row | Web plus one native | safe video still renders or unsafe MOV/QuickTime falls back |

## 20. Common Mistakes

1. Deleting video migrations/functions because Step 4 no longer exposes video. Do not do this.
2. Removing `coverHue` instead of only removing the visible event hue picker.
3. Proxying GIPHY through Supabase or copying GIPHY media into Storage.
4. Exposing Pexels API key in `EXPO_PUBLIC_*` or client code.
5. Storing provider media URL without credit/source metadata.
6. Mixing GIPHY and Pexels results in one combined grid.
7. Letting old ORCH-0770/0776 gates force dead video UI back into Step 4.
8. Forgetting public/checkout/order parity after Step 4 works.

## 21. Handoff To Implementor

Implement ORCH-0783 only after operator/orchestrator review approves this spec. The implementation must start in `.worktrees/orch-0783-event-cover-image-provider-pivot/`, add provider metadata persistence first, then provider adapters/proxy, then Step 4 UI, then attribution/parity surfaces, then tests/gates. Hard guards: no provider key values, no Cloudinary/video rework, no migration/function deletion, no `coverHue` removal, no brand media expansion, and every behavior change must ship with repo-running regression tests in the same scoped commit/push.

## Next Handoff

NEXT HANDOFF — paste into operator/orchestrator:

Review `Mingla_Artifacts/specs/SPEC_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md` in Working tree: `.worktrees/orch-0783-event-cover-image-provider-pivot/`. The spec translates investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md` and prompt `Mingla_Artifacts/prompts/FORENSICS_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md` into a launch-safe implementation contract for local image/GIF plus GIPHY/Pexels event covers while preserving existing published cover rendering. Hard guards remain: no implementation before review, no provider keys/secrets, no migration/function deletion, no Cloudinary/video rework, keep `coverHue` and legacy video rendering until a later SPEC defines legacy handling, and require repo-running regression tests in the same scoped commit/push for every behavior change. If approved, route next to Codex `implementor-mingla`; expected implementation report is `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`.
