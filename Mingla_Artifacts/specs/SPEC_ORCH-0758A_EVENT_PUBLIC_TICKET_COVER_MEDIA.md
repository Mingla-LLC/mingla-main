# Spec: Event/Public Ticket Cover Media (ORCH-0758A)

> Date: 2026-05-08  
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0758_RICH_MEDIA_COVERS_AND_PICKERS.md`  
> Root cause: Dormant event cover media columns; business event models/renderers remain `coverHue`-only  
> Status: ready for orchestrator review

## 1. Layman Summary

Event and public ticket pages should support real event cover media: uploaded pictures, GIFs, and short videos. Today organisers only get the striped color placeholder, even though Supabase already has `events.cover_media_url` and `events.cover_media_type`.

This spec ships the first bounded slice: event/public ticket cover upload, persistence, preview, publish, and rendering. It does not build brand media, profile media, GIPHY/Pexels search, or moderation/admin tooling. It keeps `coverHue` as the fallback when no media is present or media fails to render.

## 2. User Story

As a Mingla organiser, I want to upload a custom image, GIF, or short video as my event cover, so the public ticket page and organiser event surfaces look alive and trustworthy instead of using the default striped placeholder.

## 3. Scope

- **In scope:**
  - Mingla Business event creator Step 4 cover media upload.
  - Uploaded image/GIF/video cover rendering in draft preview, Step 7 preview card, Home/Events event cards, event detail, checkout mini-card, and public event/ticket page.
  - `DraftEvent` and `LiveEvent` model fields for `coverMediaUrl` and `coverMediaType`.
  - Server draft select/insert/update/hydration for canonical `events.cover_media_url/type`.
  - Publish conversion preserving media and a `serverEventId` bridge from the promoted `events` row into local `LiveEvent`.
  - Published-event edit parity for cover media when a `LiveEvent` has `serverEventId`.
  - Dedicated Supabase Storage bucket/RLS for event cover uploads.

- **Non-goals:**
  - Brand cover/profile media: ORCH-0758B.
  - Business/consumer profile GIF/video media: ORCH-0758C.
  - GIPHY/Pexels search UI/API calls: ORCH-0758D.
  - Admin moderation/takedown queue: ORCH-0758E.
  - Per-ticket-type imagery in `ticket_types`.
  - Dynamic OG image generation. Existing OG placeholder remains explicitly transitional.

- **Assumptions:**
  - "Ticket cover" means the public event/ticket purchase page cover, not per-ticket-tier cards.
  - ORCH-0756B server-backed drafts remain in the working tree. Draft rows exist before Step 4, so upload paths can use the draft/server event UUID.
  - Operator already has GIPHY/Pexels keys, but those keys are not used in ORCH-0758A.

- **Dependencies:**
  - Add `expo-video` or the repo-approved Expo SDK 54 video playback package if no existing video renderer can satisfy this spec. This likely requires a new native/EAS build, not OTA-only, unless the dependency is already included in the deployed runtime.
  - Supabase migration prefix must be greater than current local max `20260515000001`.

## 4. Evidence Trace

| Requirement | Comes from finding / source | Confidence |
|---|---|---|
| Use `events.cover_media_url/type` as canonical owner | Investigation ORCH-0758; `events` table has columns and check constraint | HIGH |
| Preserve `coverHue` fallback | Current `DraftEvent`, `LiveEvent`, `EventCover` are hue-only; must not break existing events | HIGH |
| Update server draft mapper/select | `eventDrafts.ts` `EVENT_DRAFT_SELECT` omits media; `serverDraftEventMapper.ts` omits media | HIGH |
| Add `serverEventId` to `LiveEvent` | Spec trace discovered local live id `le_...` differs from promoted server event UUID | HIGH |
| Include storage/RLS contract | Investigation found no event/brand media bucket; user specifically wants custom uploads | HIGH |
| Keep provider metadata compatible but defer provider search | Investigation provider matrix; ORCH-0758D split | HIGH |
| Require video/GIF-specific renderer behavior | Investigation warned against treating GIF/video as plain images | HIGH |

## 5. Success Criteria

1. A server-backed draft can upload/select an image, GIF, or supported video as its cover and see it immediately in Step 4.
2. Autosave writes `cover_media_url` and `cover_media_type` to the draft's `events` row, and hydration restores those fields after sign-out/sign-in.
3. Preview surfaces render uploaded media and fall back to `EventCover` hue if media is absent or fails.
4. Publishing preserves the media in the promoted server event row and in local `LiveEvent`.
5. Newly published local `LiveEvent` records include `serverEventId = draft.id`, so future media edits can update the canonical server row.
6. Public event/ticket page renders the cover media for image/GIF/video and overlays existing hero chrome without blank heroes.
7. Unsupported files are rejected before upload with visible feedback; failed uploads do not mutate draft state or server columns.
8. Provider-picked media can be added later without changing this renderer contract.

## 6. Invariants

### Must Preserve

| Invariant | Enforcement in this spec | Verification |
|---|---|---|
| One owner per truth | Canonical event media lives in `events.cover_media_url/type`; local state is a hydrated/snapshot copy | Mapper tests + service tests |
| No dead taps | No GIPHY/Pexels tabs in ORCH-0758A; upload/remove controls must be functional or absent | Component tests/static review |
| No silent failures | Upload/save/render failures show visible copy and keep prior state | Tests for upload rejection/failure |
| No fabricated data | No fake provider/media results | Strict search/review |
| Preserve ORCH-0756B publish guard | Do not move server promotion before `canConvertDraftToLiveEvent` preflight | `test:orch-0756b` plus new lifecycle guard |
| No plaintext ticket passwords | Do not change ticket JSON sanitization | Existing mapper test |

### New Invariants

| Invariant | Owner | Enforcement | Verification |
|---|---|---|---|
| Event cover media canonical columns | `events.cover_media_url/type` | Mapper/service writes canonical columns, not only `theme.business_draft` | `serverDraftEventMapper.test` |
| Local live events know their server row when available | `LiveEvent.serverEventId` | Publish converter sets `serverEventId` to the draft/server event UUID | New converter test or lifecycle guard |
| Event cover uploads are team-owned | Storage RLS | `event_manager+` for the event's brand can write/delete; public can read | Supabase migration/RLS tests or SQL review gate |

## 7. Database / RLS / Migration

### Schema

No new event table media columns are required. Existing columns are authoritative:

```sql
-- Already exists in baseline:
events.cover_media_url text
events.cover_media_type text CHECK (cover_media_type IS NULL OR cover_media_type IN ('image','video','gif'))
```

### Required Migration

Create a monotonic migration:

```text
supabase/migrations/20260515000002_orch_0758a_event_cover_storage.sql
```

If a later migration appears before implementation, use the next greater prefix.

Migration requirements:

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'event_covers',
  'event_covers',
  true,
  31457280,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
```

Path convention:

```text
{brandId}/{eventId}/{mediaId}.{ext}
```

- `brandId`: UUID from `DraftEvent.brandId` / `events.brand_id`.
- `eventId`: server event row UUID. For drafts, this is `DraftEvent.id` after ORCH-0756B. For newly published local events, this is `LiveEvent.serverEventId`.
- `mediaId`: generated UUID or collision-resistant id.

RLS policy contract:

- Public read:
  - `SELECT` on `storage.objects` where `bucket_id = 'event_covers'`.
- Authenticated insert/update/delete:
  - `bucket_id = 'event_covers'`.
  - Path has exactly three segments.
  - First segment parses to `brand_id`.
  - Second segment parses to `event_id`.
  - An `events` row exists with `events.id = event_id`, `events.brand_id = brand_id`, `events.deleted_at IS NULL`.
  - Caller rank for `brand_id` is at least `event_manager` using the existing business role helper.

Do not copy the broad consumer `avatars` RLS pattern.

### Backfill

None. Existing events keep `cover_media_url/type = NULL` and render `coverHue`.

### Rollback

- Product rollback can ignore uploaded media and render `coverHue`.
- Database rollback should not drop the bucket automatically if user uploads may exist. If rollback is needed, leave bucket/data in place and stop UI writes.

## 8. Edge Functions / RPCs / Webhooks

None for ORCH-0758A.

Provider search, provider proxying, and provider keys belong to ORCH-0758D. Do not add GIPHY/Pexels edge functions in this slice.

## 9. Service Layer

### `eventDrafts.ts`

Path: `mingla-business/src/services/eventDrafts.ts`

Required changes:

- Extend `EVENT_DRAFT_SELECT` to include:
  - `cover_media_url`
  - `cover_media_type`
- `createServerDraft`, `fetchDraftsForBrand`, `fetchDraftById`, and `autosaveServerDraft` must return rows including those fields.
- `markServerDraftPublished` must preserve the current preflight ordering from `EventCreatorWizard`: local conversion preflight first, server promotion second, local publish third.

### New Event Cover Upload Service

Path recommendation:

`mingla-business/src/services/eventCoverMediaService.ts`

Types:

```ts
export type EventCoverMediaType = "image" | "gif" | "video";

export interface EventCoverUploadInput {
  brandId: string;
  eventId: string;
  uri: string;
  mimeType: string;
  fileName?: string | null;
  fileSize?: number | null;
  durationMs?: number | null;
}

export interface EventCoverUploadResult {
  publicUrl: string;
  mediaType: EventCoverMediaType;
  storagePath: string;
}
```

Contract:

- Validate MIME and extension before upload.
- Allowed images: JPEG, PNG, WEBP.
- Allowed GIF: `image/gif`.
- Allowed videos: MP4 and WEBM only. Reject MOV/QuickTime until a transcoding story exists.
- Max size: 30MB total bucket/file cap.
- Max video duration: 15 seconds.
- For images/GIFs, no client-side manipulation that would strip animation.
- Upload to `event_covers` path convention above.
- Return public URL via Supabase Storage.
- Do not write `events.cover_media_*` directly from this service unless the calling mutation/service also handles draft cache reconciliation. Prefer returning upload result and letting Step 4 update draft/autosave.
- On upload failure, throw a typed error; callers show visible copy.

### Optional Server Update Helper

If implementor chooses explicit save rather than autosave-only:

```ts
updateEventCoverMedia(eventId, mediaUrl, mediaType)
```

Must update `events.cover_media_url/type` only for `status='draft'` from draft flow, or for `serverEventId` from published edit flow. Must throw on Supabase errors.

## 10. Hook / State / Cache Layer

### `DraftEvent`

Path: `mingla-business/src/store/draftEventStore.ts`

Add:

```ts
export type EventCoverMediaType = "image" | "video" | "gif";

coverMediaUrl: string | null;
coverMediaType: EventCoverMediaType | null;
```

Defaults:

```ts
coverMediaUrl: null,
coverMediaType: null,
```

Update action:

- `updateDraft` already accepts partial draft patches; it should carry these fields.
- Removing media sets both to `null`.
- Do not store provider attribution in `DraftEvent` in ORCH-0758A. That belongs to ORCH-0758D.

### `LiveEvent`

Path: `mingla-business/src/store/liveEventStore.ts`

Add:

```ts
serverEventId: string | null;
coverMediaUrl: string | null;
coverMediaType: EventCoverMediaType | null;
```

Rules:

- `convertDraftToLiveEvent` sets `serverEventId` to `draft.id`.
- Legacy local live events migrate to `serverEventId: null`, `coverMediaUrl: null`, `coverMediaType: null`.
- `EditableLiveEventFields` includes `coverMediaUrl` and `coverMediaType`.
- Cover media changes are safe/additive, like `coverHue`.
- Published edit can update cover media only when `serverEventId !== null`. If null, show a visible unsupported legacy-state message rather than pretending the server row changed.

### `serverDraftEventMapper.ts`

Required:

- Add media fields to `ServerDraftEventRow`, `ServerDraftEventInsert`, and `ServerDraftEventUpdate`.
- `draftToServerInsert` and `draftToServerUpdate` set:
  - `cover_media_url: draft.coverMediaUrl`
  - `cover_media_type: draft.coverMediaType`
- `serverRowToDraft` hydrates:
  - `coverMediaUrl: row.cover_media_url`
  - `coverMediaType: row.cover_media_type`
- Do not rely on `theme.business_draft.coverMediaUrl` as the canonical source.
- `theme.business_draft` may omit media entirely or mirror only for compatibility, but canonical reconciliation must prefer row columns.

### React Query

Path: `mingla-business/src/hooks/useServerDraftEvents.ts`

Use existing `eventDraftKeys`.

Required cache behavior:

- Autosave success updates `eventDraftKeys.detail(draft.id)`.
- Autosave invalidates `eventDraftKeys.list(draft.brandId)`.
- Media upload followed by draft patch must trigger autosave or explicit mutation so list/detail caches receive media.
- No new query-key factory is needed unless implementor adds a separate public event service. If a new query key is added, update `docs/QUERY_KEY_REGISTRY.md`.

## 11. Component / Screen Layer

### New Media Renderer Primitive

Path recommendation:

`mingla-business/src/components/ui/EventCoverMedia.tsx`

Do not overload `EventCover` into a mixed media player unless that keeps the component simpler and tests clear. Recommended contract:

```ts
interface EventCoverMediaProps {
  coverHue?: number;
  mediaUrl: string | null;
  mediaType: "image" | "gif" | "video" | null;
  radius?: number;
  label?: string;
  height?: DimensionValue;
  width?: DimensionValue;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  testID?: string;
  children?: React.ReactNode;
}
```

Render rules:

| State | Condition | Renders |
|---|---|---|
| Hue fallback | URL/type null | Existing `EventCover` |
| Image/GIF loading | media URL present before load | Hue fallback under media layer |
| Image/GIF success | `image` or `gif` loads | `Image`/compatible renderer with cover resize and existing vignette/overlay slot |
| Image/GIF error | load error | Hue fallback and no blank rectangle |
| Video loading | video URL present before first frame | Hue fallback/poster-style background |
| Video success | supported video ready | Muted looping cover video |
| Video error | playback/load error | Hue fallback |
| Reduced motion | platform setting indicates reduced motion | Do not autoplay video; show first frame/poster/fallback with play affordance if supported |

Video behavior:

- Public hero and cards should default to muted loop only when reduced motion is off.
- No audio.
- No controls on small cards.
- If video package cannot render in Jest, mock it in tests.

Accessibility:

- Cover media is decorative unless a button wraps it; wrapper owns the accessible label.
- Do not announce provider/source metadata in ORCH-0758A.

### `CreatorStep4Cover.tsx`

Replace the "Photo, video, and GIF uploads coming soon" caption with working controls:

- Preview uses `EventCoverMedia`.
- Primary action: choose/upload cover media.
- Secondary action when media exists: remove media.
- Hue tiles remain available as fallback/background style.
- No GIPHY/Pexels buttons yet.
- Upload denied/invalid/failure states show visible copy:
  - Permission denied: `Photo library access is needed to choose a cover.`
  - Unsupported type: `Use a JPG, PNG, WEBP, GIF, MP4, or WEBM file.`
  - Oversize: `Cover media must be 30MB or less.`
  - Video duration: `Cover videos must be 15 seconds or less.`
  - Upload failed: `Couldn't upload cover media. Tap to try again.`

### Preview/Public/Event Surfaces

Replace direct `EventCover` / hue background usage with `EventCoverMedia`:

- `CreatorStep7Preview.tsx`
- `PreviewEventView.tsx`
- `PublicEventPage.tsx`
- `EventListCard.tsx`
- `mingla-business/app/(tabs)/home.tsx`
- `mingla-business/app/(tabs)/events.tsx` if it uses event cards or inline covers
- `mingla-business/app/event/[id]/index.tsx`
- `mingla-business/app/checkout/[eventId]/index.tsx`
- `mingla-business/app/o/[orderId].tsx`

### `EditPublishedScreen.tsx`

Published edit must include media fields in the transient draft adapter:

- `liveEventToEditableDraft` copies cover media.
- `editableDraftToPatch` detects media changes.
- `FIELD_LABELS` includes `coverMediaUrl` / `coverMediaType` as "Cover media".
- Cover media change is additive/safe.
- If the event lacks `serverEventId`, upload/save should be blocked with visible copy instead of making a local-only canonical lie.

## 12. Business / Admin / Public Parity

- Business app changes: required, as above.
- Admin changes: none in ORCH-0758A.
- Public/web changes: public event page and checkout page render media. Dynamic OG generation remains deferred.
- Operational dependency: if `expo-video` or similar native dependency is added, release requires a native/EAS build for business app users, not OTA-only.

## 13. Realtime / Notifications / Analytics

- Realtime: none.
- Notifications: cover media edits are additive/safe. Existing edit notification severity classification should treat media like cover hue.
- Analytics: optional existing event-edit analytics only. Do not add provider analytics in ORCH-0758A.

## 14. Provider-Readiness Contract

ORCH-0758A does not call GIPHY or Pexels. It must, however, use a renderer and media selection shape that ORCH-0758D can reuse.

Future provider result shape:

```ts
interface ExternalCoverMediaCandidate {
  provider: "giphy" | "pexels";
  providerAssetId: string;
  sourceUrl: string;
  mediaUrl: string;
  mediaType: "image" | "gif" | "video";
  width: number | null;
  height: number | null;
  thumbnailUrl: string | null;
  attributionText: string;
  attributionUrl: string;
  creatorName: string | null;
  analytics?: Record<string, string>;
}
```

Do not persist this metadata in ORCH-0758A. ORCH-0758D must add the metadata persistence/attribution contract before provider picks are saved.

## 15. Implementation Order

1. Add storage migration `20260515000002_orch_0758a_event_cover_storage.sql` or later monotonic prefix.
2. Add/centralize media type definitions, preferably near event types.
3. Extend `DraftEvent` defaults and persisted migration for new fields.
4. Extend `LiveEvent`, persisted migration, editable fields, severity labels, and add `serverEventId`.
5. Update `serverDraftEventMapper.ts` row/insert/update/hydration for canonical media columns.
6. Update `eventDrafts.ts` select list.
7. Add `eventCoverMediaService.ts` for validation/upload/public URL generation.
8. Add `EventCoverMedia` renderer and tests/mocks.
9. Update `CreatorStep4Cover.tsx` upload/remove/fallback UI.
10. Update preview, public, card, home, event detail, checkout, and order surfaces to use `EventCoverMedia`.
11. Update publish conversion to set `serverEventId`, `coverMediaUrl`, and `coverMediaType`.
12. Update published-edit adapter/patch/diff handling.
13. Add/extend automated tests.
14. Run verification gates.

## 16. Test Matrix

| ID | Scenario | Input/setup | Expected | Layer | Verification |
|---|---|---|---|---|---|
| T1 | Mapper persists media columns | Draft with image URL/type | insert/update payload contains `cover_media_url/type`; hydration restores fields | Mapper | `npx jest serverDraftEventMapper.test` |
| T2 | Mapper falls back cleanly | Row with null media fields | hydrated draft has `coverMediaUrl/type = null` and `coverHue` intact | Mapper | Jest |
| T3 | Publish preserves media | Draft with media fields | `LiveEvent` contains same media and `serverEventId = draft.id` | Converter | New Jest test |
| T4 | Publish guard preserved | Current ORCH-0756B preflight order | preflight before server promotion before local publish | Lifecycle guard | `npm run test:orch-0756b` |
| T5 | Renderer image success | image URL/type | image renders, fallback hidden | UI | Component test |
| T6 | Renderer fallback on error | failing media URL | hue fallback renders, no blank hero | UI | Component test |
| T7 | Renderer video reduced motion | video URL/type + reduced motion | no autoplay; fallback/poster visible | UI | Component test/manual if native mock limits |
| T8 | Upload rejects unsupported type | MOV or PDF asset | visible unsupported message, no draft/server mutation | Service/UI | Jest/service test |
| T9 | Upload rejects oversize/duration | >30MB or >15s video | visible rejection, no mutation | Service/UI | Jest/service test |
| T10 | Draft hydration recovers media | server draft row with media | edit/preview surfaces show media after hydration | Hook/route | Jest/static + tester manual |
| T11 | Published edit blocks legacy local-only event | `LiveEvent.serverEventId = null` | visible message; no fake server write | UI/state | Unit/static test |
| T12 | Public page media fallback | public event has null or failed media | `coverHue` fallback hero | Public page | Component test |

Add package script:

```json
"test:orch-0758a": "npx jest serverDraftEventMapper.test serverDraftLifecycleGuards.test eventCoverMedia.test eventCoverMediaService.test"
```

If component tests are difficult under current Jest environment, implement the renderer logic as a pure decision helper with unit tests plus a tester manual gate for actual image/GIF/video playback.

Required gates:

- `cd mingla-business && npm run test:orch-0758a`
- `cd mingla-business && npm run test:orch-0756b`
- `cd mingla-business && npx tsc --noEmit`
- Touched-file ESLint where feasible; full lint may remain unrelated debt if documented.
- If migration added: local Supabase reset/test if available; otherwise SQL review plus operator `supabase db push` later in lifecycle.

## 17. Regression Prevention

- **Structural safeguard:** `EventCoverMedia` becomes the shared renderer; direct `EventCover` usage for event cover surfaces must be limited to fallback internals/styleguide.
- **Strict grep:** add a focused script or Jest static guard that fails if key event/public surfaces render `EventCover hue={event.coverHue}` directly after ORCH-0758A.
- **Mapper test:** canonical row media columns must round-trip.
- **Publish test:** media and `serverEventId` must survive draft-to-live conversion.
- **Protective comment:** document in `serverDraftEventMapper.ts` that `events.cover_media_*` is canonical and `theme.business_draft` must not become the media owner.

## 18. Rollback And Deploy Safety

- **Migration order:** use prefix greater than current max `20260515000001`; recommended `20260515000002`.
- **Edge function deploy:** none.
- **Mobile/native build:** adding a video playback native dependency likely requires EAS native builds for business app. If implementor can satisfy video rendering with an already-installed Expo SDK module, document that explicitly.
- **Business deploy:** business app release required; web/public pages affected.
- **Env vars/secrets:** none for ORCH-0758A. GIPHY/Pexels keys remain unused and must not be added.
- **Partial rollback risk:** uploaded objects may remain in public storage even if UI rolls back. Do not drop the bucket during rollback; stop writes and render hue fallback.
- **Supabase deploy split:** operator runs `supabase db push`; Codex/implementor runs local Deno/SQL gates where applicable and records exact evidence.

## 19. Common Mistakes

1. Saving media only in `theme.business_draft`. This violates one owner per truth because `events.cover_media_*` already exists.
2. Forgetting `serverEventId`. Without it, local `LiveEvent.id` cannot address the promoted server event row for storage/RLS or published edits.
3. Treating GIF/video as plain images. This risks broken animations, blank videos, and poor reduced-motion behavior.
4. Adding GIPHY/Pexels tabs now. Provider search is ORCH-0758D and needs attribution/metadata persistence.
5. Reusing avatar bucket policy patterns. Event covers are team-owned and need brand-role RLS.
6. Letting upload failure mutate draft fields. Prior cover state must remain intact on failure.
7. Breaking ORCH-0756B publish ordering. Server promotion must not happen before local conversion can succeed.

## 20. Handoff To Implementor

Implement ORCH-0758A in layer order: storage migration, type/model fields, mapper/service round-trip, upload service, shared renderer, Step 4 UI, downstream render surfaces, publish/edit adapters, and tests. Use `events.cover_media_url/type` as canonical and preserve `coverHue` fallback everywhere. Add `serverEventId` to bridge local `LiveEvent` records back to the promoted server event row. Do not add GIPHY/Pexels calls or secret values in this slice.

