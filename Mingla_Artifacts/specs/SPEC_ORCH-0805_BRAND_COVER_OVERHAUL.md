# SPEC — ORCH-0805: Brand Cover Overhaul (Custom Upload + Pexels + Giphy)

**Skill:** Claude `mingla-forensics` (SPEC mode, IA continuation of ORCH-0801)
**Date:** 2026-05-12
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** [INVESTIGATION_ORCH-0801_BRAND_PAGE_FULL_AUDIT.md](../reports/INVESTIGATION_ORCH-0801_BRAND_PAGE_FULL_AUDIT.md) §F-06, §F-09
**Dispatch:** `Mingla_Artifacts/prompts/SPEC_ORCH-0805_BRAND_COVER_OVERHAUL.md` — PRIVATE_PROMPT_NOT_VERSIONED (the `prompts/` directory is gitignored per the documentation system policy; dispatch evidence lives in this SPEC + the parent investigation cited below).
**Operator decisions:** All 6 of Open Questions §8 (Q1-Q6) locked from Wave 1 dispatch

---

## 1. Scope

Wave 3 of the ORCH-0801 brand-page campaign. Three deliverables in one logical change:

1. **Delete** the 6 hue swatch presets from `BrandEditView` and the entire `COVER_HUE_TILES` constant. `coverHue` stays in the DB column and Brand type as a **fallback render value** only; it is no longer user-selectable.
2. **Add** a brand cover picker with three sources:
   - **Upload** from device (image or GIF), via a new `brandCoverService` mirroring the proven ORCH-0786 avatar pipeline.
   - **Pexels** library search (reuses existing `event-cover-pexels-search` edge function).
   - **Giphy** library search (mirrors existing client-side Giphy pattern).
3. **Update** `PublicBrandPage` hero to render `cover_media_url` via `expo-image` (correct GIF animation on Android), falling back to the hue gradient when the URL is null OR fails to load.

## 2. Non-goals

- **Cover video (MP4).** Schema column `cover_media_type` accepts `'video'` but this SPEC ships image + GIF only. MP4 cover support is a future ORCH.
- **Brand-avatar pencil dead tap (F-09).** Defer to ORCH-0805-A. Different bucket, different upload shape; bundling would inflate scope by ~40% without sharing code. The pencil toast stays in place until 0805-A.
- **expo-image migration of the whole app.** Only the brand-page hero adopts `expo-image`. Event-cover and avatar renders remain on their current primitives (no behavioural regression risk).
- **Generalising `pexelsEventCoverService` / `giphyEventCoverService`.** Cloning to brand-specific siblings instead — event-cover services have event-specific coupling and just shipped via ORCH-0758a/0766f/0783; touching them risks regression.
- **Renaming `event-cover-pexels-search`.** Edge function is a thin Pexels proxy; reused as-is from the brand service with a comment noting cross-domain consumer. Rename is a future cleanup ORCH if desired.
- **Schema column changes.** All three columns (`cover_hue`, `cover_media_url`, `cover_media_type`) are already in `20260506000000_brand_kind_address_cover_hue_media.sql`. Reuse.
- **Real-time updates** when another team member changes the cover — covered by existing React Query staleTime + edit flow refetch; no Realtime subscription introduced.

## 3. Assumptions

- The Pexels API key in the `event-cover-pexels-search` edge function env is already valid (confirmed by ORCH-0783 close).
- The Giphy public-search API key is already configured client-side (confirmed by `giphyEventCoverService.ts` consumption).
- `expo-image ~3.0.11` is installed in `mingla-business/package.json` (Wave 1 commit `083debc9`).
- `brand-stripe-detach` and other Stripe edge functions are untouched by this work.
- Operator owns `supabase db push` for the new migration; implementor does NOT run it.

---

## 4. Database layer

### 4.1 New migration: `supabase/migrations/20260529000000_orch_0805_brand_covers_storage.sql`

**Monotonic check:** the latest migration on `Seth` after the merge is `20260528000001_orch_0793_widen_scan_result_check.sql`. New filename `20260529000000_...` is strictly greater. ✓

```sql
-- ORCH-0805 — brand cover storage bucket + RLS.
-- Public read (brand pages are public-anonymous-accessible).
-- Authenticated write scoped to brand admins via existing biz_role_rank gate
-- mirrored from the creator_avatars bucket policy precedent (ORCH-0786).

BEGIN;

-- 1. Create the bucket. public = true so anonymous buyers can render the
--    cover on /b/{slug} without a signed URL roundtrip.
INSERT INTO storage.buckets (id, name, public)
VALUES ('brand_covers', 'brand_covers', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Allow public anonymous SELECT (read) on objects in the bucket.
DROP POLICY IF EXISTS "brand_covers_public_read" ON storage.objects;
CREATE POLICY "brand_covers_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'brand_covers');

-- 3. Allow authenticated INSERT/UPDATE/DELETE only when the user is brand_admin+
--    on the brand whose UUID is the FIRST path segment of the object name.
--    Path convention: '{brandId}/{token}.{ext}' — enforced by the service layer
--    via brandCoverStoragePath(). RLS validates the brand UUID matches a brand
--    the caller has biz_role_rank >= brand_admin (50) on.
DROP POLICY IF EXISTS "brand_covers_admin_write" ON storage.objects;
CREATE POLICY "brand_covers_admin_write"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'brand_covers'
  AND EXISTS (
    SELECT 1
    FROM public.brand_team_members btm
    WHERE btm.brand_id = (split_part(name, '/', 1))::uuid
      AND btm.user_id = auth.uid()
      AND btm.removed_at IS NULL
      AND biz_brand_effective_rank(btm.role::text) >= biz_role_rank('brand_admin')
  )
);

DROP POLICY IF EXISTS "brand_covers_admin_update" ON storage.objects;
CREATE POLICY "brand_covers_admin_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'brand_covers'
  AND EXISTS (
    SELECT 1
    FROM public.brand_team_members btm
    WHERE btm.brand_id = (split_part(name, '/', 1))::uuid
      AND btm.user_id = auth.uid()
      AND btm.removed_at IS NULL
      AND biz_brand_effective_rank(btm.role::text) >= biz_role_rank('brand_admin')
  )
);

DROP POLICY IF EXISTS "brand_covers_admin_delete" ON storage.objects;
CREATE POLICY "brand_covers_admin_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'brand_covers'
  AND EXISTS (
    SELECT 1
    FROM public.brand_team_members btm
    WHERE btm.brand_id = (split_part(name, '/', 1))::uuid
      AND btm.user_id = auth.uid()
      AND btm.removed_at IS NULL
      AND biz_brand_effective_rank(btm.role::text) >= biz_role_rank('brand_admin')
  )
);

-- 4. Restrict allowed MIME types via the bucket-level allowed_mime_types
--    column (mirrors the creator_avatars precedent). Image + GIF only;
--    video MIME types intentionally excluded (deferred to future ORCH).
UPDATE storage.buckets
SET
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ],
  file_size_limit = 15728640  -- 15 MB
WHERE id = 'brand_covers';

-- 5. Verification probe.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'brand_covers') THEN
    RAISE EXCEPTION 'ORCH-0805 verification probe failed: brand_covers bucket missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'brand_covers_public_read'
  ) THEN
    RAISE EXCEPTION 'ORCH-0805 verification probe failed: public read policy missing';
  END IF;
END $$;

COMMIT;
```

**No `public.brands` schema changes.** The 3 cover columns (`cover_hue`, `cover_media_url`, `cover_media_type`) exist already.

### 4.2 RLS verification

The migration's RLS predicates use `biz_brand_effective_rank` + `biz_role_rank` — same helpers used by ORCH-0795 event-scanner-auto-provision (confirmed to work in current codebase). Storage path convention `{brandId}/{token}.{ext}` is enforced by the service layer; RLS reads the brand UUID from `split_part(name, '/', 1)`.

---

## 5. Edge function layer

### 5.1 Reuse `event-cover-pexels-search` as-is

No new edge function. No changes to existing edge function source. The brand service calls it with the same `{ query, page }` request body.

A `[ORCH-0805]` comment in `pexelsBrandCoverService.ts` documents the cross-domain reuse so a future maintainer doesn't accidentally tightly couple the function to events.

### 5.2 Giphy

Direct client-side calls to Giphy API (mirror `giphyEventCoverService.ts`). No edge function. The Giphy API key already lives in the client (it's a public-search key by Giphy's API design).

---

## 6. Service layer (5 new files)

### 6.1 `mingla-business/src/utils/brandCoverRules.ts` (new)

Mirror of `creatorAvatarRules.ts` adapted for cover (allows GIF, larger size).

```typescript
export const BRAND_COVER_MAX_BYTES = 15 * 1024 * 1024; // 15 MB

export type BrandCoverMimeType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif";

export type BrandCoverMediaType = "image" | "gif";

export interface BrandCoverAssetInput {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
}

export type BrandCoverErrorCode =
  | "unsupported_type"
  | "file_too_large"
  | "empty_local_file"
  | "upload_failed"
  | "display_failed"
  | "provider_search_failed";

export class BrandCoverError extends Error {
  readonly code: BrandCoverErrorCode;
  constructor(code: BrandCoverErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "BrandCoverError";
  }
}

// Resolve MIME from input metadata + URI extension. Returns null if unsupported.
export const resolveBrandCoverContentType = (
  input: BrandCoverAssetInput,
): BrandCoverMimeType | null => { /* implementation per creatorAvatarRules pattern */ };

// MIME → media_type discriminator. Image MIMEs return "image"; GIF returns "gif".
export const brandCoverMediaTypeFromMime = (
  mime: BrandCoverMimeType,
): BrandCoverMediaType =>
  mime === "image/gif" ? "gif" : "image";

// Storage path: '{brandId}/{token}.{ext}'.
export const brandCoverStoragePath = (
  brandId: string,
  pathToken: string,
  mime: BrandCoverMimeType,
): string => `${brandId}/${pathToken}.${EXT_BY_MIME[mime]}`;

export const generateBrandCoverPathToken = (): string => { /* uuid-like */ };

export const extractBrandCoverStoragePath = (publicUrl: string): string | null => { /* parse */ };

// HEAD/Range probe to confirm uploaded URL renders (mirror creatorAvatar).
export const verifyBrandCoverPublicUrl = async (url: string): Promise<void> => { /* impl */ };

const EXT_BY_MIME: Record<BrandCoverMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
```

### 6.2 `mingla-business/src/services/brandCoverFileReader.ts` (new)

Mirror `creatorAvatarFileReader.ts` exactly: uses `expo-file-system.File` → `Uint8Array` (RN iOS-safe; `fetch(uri).blob()` returns size-0 on iOS).

```typescript
export const readBrandCoverFileBytes = async (
  uri: string,
): Promise<{ bytes: Uint8Array; byteLength: number }> => { /* expo-file-system impl */ };
```

### 6.3 `mingla-business/src/services/brandCoverService.ts` (new)

Mirror `creatorAvatarService.ts`. Exports:

```typescript
export const BRAND_COVERS_BUCKET = "brand_covers";

export interface BrandCoverUploadResult {
  publicUrl: string;
  storagePath: string;
  contentType: BrandCoverMimeType;
  mediaType: BrandCoverMediaType; // "image" | "gif" — written to brands.cover_media_type
}

export interface BrandCoverUploadOptions {
  previousPublicUrl?: string | null; // best-effort delete after verify succeeds
}

export const uploadBrandCover = async (
  brandId: string,
  input: BrandCoverAssetInput,
  options?: BrandCoverUploadOptions,
): Promise<BrandCoverUploadResult> => { /* impl */ };

// Used when the user picks from Pexels or Giphy: no upload, just URL persistence.
// Validates URL host against an allowlist {images.pexels.com, media*.giphy.com, …}
// and resolves a synthetic mediaType from the host (Giphy → "gif", Pexels → "image").
export interface BrandCoverProviderRef {
  provider: "pexels" | "giphy";
  publicUrl: string;
  attribution: { name: string; url: string } | null;
}
export const validateBrandCoverProviderUrl = (
  ref: BrandCoverProviderRef,
): { publicUrl: string; mediaType: BrandCoverMediaType } => { /* allowlist + media type */ };
```

### 6.4 `mingla-business/src/services/pexelsBrandCoverService.ts` (new)

Thin clone of `pexelsEventCoverService.ts`. Calls `event-cover-pexels-search` edge fn (reused as-is). Returns `BrandCoverProviderRef[]`. Documents the cross-domain reuse via `[ORCH-0805]` header comment.

### 6.5 `mingla-business/src/services/giphyBrandCoverService.ts` (new)

Mirror `giphyEventCoverService.ts`. Direct client-side calls to `api.giphy.com/v1/gifs/search`. Returns `BrandCoverProviderRef[]` typed for cover usage.

---

## 7. Hook layer

### 7.1 New hook: `mingla-business/src/hooks/useBrandCoverUpload.ts`

```typescript
export interface BrandCoverUploadInput {
  brandId: string;
  source:
    | { kind: "upload"; asset: BrandCoverAssetInput }
    | { kind: "provider"; ref: BrandCoverProviderRef };
}

export interface UseBrandCoverUploadResult {
  uploadCover: (input: BrandCoverUploadInput) => Promise<void>;
  isUploading: boolean;
  error: BrandCoverError | null;
}

export const useBrandCoverUpload = (): UseBrandCoverUploadResult => {
  // useMutation:
  //   - source.kind === "upload" → call uploadBrandCover, then patch brands row with
  //     { cover_media_url, cover_media_type }
  //   - source.kind === "provider" → validate URL, patch brands row directly
  //   - onSuccess: invalidate brandKeys.byId(brandId) + brandKeys.byAccount(...)
  //   - onError: surface via error state; component fires Toast
};
```

### 7.2 Query key impact

No new query key factory entry. The mutation invalidates existing `brandKeys.byId(brandId)` (from `useBrand`) and `brandKeys.byAccount(accountId)` (from `useBrands` list).

---

## 8. Component layer

### 8.1 `mingla-business/src/components/brand/BrandCoverPickerSheet.tsx` (new, ~400 lines)

Bottom Sheet with 3 segmented tabs.

**Props:**
```typescript
interface BrandCoverPickerSheetProps {
  visible: boolean;
  brandId: string;
  currentMediaUrl: string | null;
  onClose: () => void;
  onPicked: (result: { url: string; mediaType: BrandCoverMediaType }) => void;
}
```

**Tabs:**
1. **Upload** — "Choose from device" button → `expo-image-picker` (already installed at `~17.0.11`). Accepts JPEG/PNG/WebP/GIF. On selection, calls `useBrandCoverUpload({ kind: "upload", asset: ... })`. Submitting state disables both the button and the tab switcher.
2. **Pexels** — text input + grid of result thumbnails. Search calls `pexelsBrandCoverService`. Tapping a thumbnail calls `useBrandCoverUpload({ kind: "provider", ref })` with provider="pexels".
3. **Giphy** — same shape as Pexels but with `giphyBrandCoverService`.

**Empty / error / loading states** for each tab. Pexels and Giphy show attribution per their TOS (e.g., "Photo by [name] on Pexels"; "Powered by GIPHY" footer).

**Accessibility:** each tab + each thumbnail has `accessibilityRole="button"` + label. Modal has `accessibilityViewIsModal` on iOS.

### 8.2 `mingla-business/src/components/brand/BrandEditView.tsx` (edit)

Remove:
- `COVER_HUE_TILES` constant (line 75).
- The 6-swatch UI block (lines 454-475).
- The `handlePhotoEdit` deferral toast (lines 305-307) — replaced by sheet trigger.
- The "Photo and video uploads coming soon" caption (lines 476-478).
- All `styles.coverHueRow` / `styles.coverHueTile` / `styles.coverHuePreview` etc. that become orphans.

Add:
- Local `useState` for `pickerVisible: boolean`.
- A new "Change cover" CTA (`Button` with `secondary` variant) that opens the sheet. Label changes to "Add cover" when `draft.coverMediaUrl` is null.
- Cover preview area: renders a small `expo-image` of `draft.coverMediaUrl` when present, falling back to the existing `EventCover` hue render when null. **Note: this is the PREVIEW only, not the live render path.**
- Sheet integration: `<BrandCoverPickerSheet visible={pickerVisible} brandId={brand.id} currentMediaUrl={draft.coverMediaUrl} onClose={...} onPicked={(result) => setDraft({ ...draft, coverMediaUrl: result.url, coverMediaType: result.mediaType })} />` rendered INSIDE the parent Sheet/View per the [Sub-sheet inside parent](feedback memory) rule.

### 8.3 `mingla-business/src/components/brand/PublicBrandPage.tsx` (edit)

Replace the hue-only hero render (lines 250-261) with the fallback chain:

```tsx
{/* ORCH-0805 — cover hero: media URL preferred; hue gradient is fallback */}
<View style={styles.heroWrap} pointerEvents="none">
  {brand.coverMediaUrl !== null && brand.coverMediaUrl.length > 0 ? (
    <ExpoImage
      source={{ uri: brand.coverMediaUrl }}
      style={styles.heroImage}
      contentFit="cover"
      // expo-image animates GIFs on Android correctly (RN <Image> does not).
      onError={(e) => {
        // Fall back to hue: clear the local override so the hue layer below
        // becomes the only render. State-tracked via local useState.
        setCoverMediaFailed(true);
      }}
    />
  ) : null}
  {brand.coverMediaUrl === null || coverMediaFailed ? (
    <View
      style={[
        styles.heroGradient,
        { backgroundColor: `hsl(${brand.coverHue}, 60%, 45%)` },
      ]}
    />
  ) : null}
  <View style={styles.heroFade} />
</View>
```

Adds `const [coverMediaFailed, setCoverMediaFailed] = useState(false);` near the top of the component. Resets when `brand.coverMediaUrl` changes (via `useEffect`).

`ExpoImage` imported from `expo-image`. Other renders in the file stay on RN `<Image>` (out of scope).

### 8.4 `mingla-business/src/components/ui/EventCover.tsx`

**Not modified.** Used elsewhere; this SPEC does not touch event-cover code paths.

---

## 9. Success criteria

1. **C-01** — `COVER_HUE_TILES` constant is removed from `BrandEditView.tsx` (verified via strict-grep negative-control).
2. **C-02** — The 6-swatch hue picker UI is removed from `BrandEditView.tsx` (verified via UI snapshot diff + strict-grep on `coverHueRow`/`coverHueTile` style names).
3. **C-03** — `handlePhotoEdit` toast string `"Photo upload lands in a later cycle."` is removed (verified via grep).
4. **C-04** — Tapping "Change cover" opens `BrandCoverPickerSheet` with 3 tabs (Upload / Pexels / Giphy).
5. **C-05** — Upload tab: tapping "Choose from device" opens `expo-image-picker`; selecting a JPEG/PNG/WebP/GIF file ≤ 15 MB persists to `brands.cover_media_url` + `brands.cover_media_type`.
6. **C-06** — Upload tab: file > 15 MB rejects with `BrandCoverError("file_too_large", …)` and surfaces via toast `"That file is too large — pick one under 15 MB."`
7. **C-07** — Upload tab: unsupported MIME (e.g., HEIC) rejects with `BrandCoverError("unsupported_type", …)` and toast `"Choose a JPEG, PNG, WebP, or GIF."`
8. **C-08** — Pexels tab: typing a query and tapping a result thumbnail persists the Pexels image URL to `brands.cover_media_url` with `cover_media_type='image'`.
9. **C-09** — Giphy tab: typing a query and tapping a result thumbnail persists the Giphy GIF URL to `brands.cover_media_url` with `cover_media_type='gif'`.
10. **C-10** — `PublicBrandPage` hero renders `cover_media_url` via `expo-image` when present.
11. **C-11** — `PublicBrandPage` hero falls back to hue gradient when `cover_media_url` is `null`.
12. **C-12** — `PublicBrandPage` hero falls back to hue gradient when `cover_media_url` is present but `onError` fires (defensive fallback).
13. **C-13** — On Android, a GIF cover animates (verified via device probe — implementor reports observed behaviour).
14. **C-14** — Brand non-admin (rank < 50) cannot upload (RLS denies; toast surfaces "You don't have permission").
15. **C-15** — Storage path matches `{brandId}/{token}.{ext}` (verified via inspection of uploaded object name).
16. **C-16** — Previous cover storage object is best-effort deleted after a new upload verifies (mirror ORCH-0786 path rotation).
17. **C-17** — `tsc --noEmit` clean from `mingla-business/`.
18. **C-18** — Jest passes (new tests for `brandCoverRules` MIME + size + path resolvers; new tests for hook mutation paths).
19. **C-19** — Strict-grep gate `orch-0805-brand-cover-overhaul` PASSES locally with negative control proven.
20. **C-20** — `event-cover-pexels-search` edge function is NOT touched (verified by grep — no edits to that file or its `_shared` deps).

---

## 10. Invariants

### Preserved

- **Constitution #3** — upload errors surface via toast; no silent swallow. RLS denies surface as `BrandCoverError("upload_failed", …)`.
- **Constitution #5** — server state (cover_media_url) lives in React Query; Zustand untouched.
- **Constitution #8** — hue swatch UI + handlePhotoEdit toast removed BEFORE the picker is wired (subtract before adding).
- **Constitution #9** — when `cover_media_url` is null, the hue fallback is NOT a fabrication; it's the documented secondary render path (commented in code as "fallback when cover_media_url IS NULL").
- **I-PROPOSED-J ZUSTAND-PERSIST-NO-SERVER-SNAPSHOTS** — no new persist keys; brand object stays out of Zustand persist payload (post-v14 it already only persists `currentBrandId`).
- **I-32 / I-PROPOSED-A** — brands queries filter `deleted_at IS NULL` (no change to brandsService).
- **Stripe Connect invariants** — entirely orthogonal; no touch.

### New invariant proposed (DRAFT — flips ACTIVE on ORCH-0805 CLOSE)

**I-PROPOSED-BE BRAND_COVER_MEDIA_HONORED**

**Rule:** When `brands.cover_media_url` is non-null, the public brand page (`PublicBrandPage.tsx` hero) AND the edit-brand preview (`BrandEditView.tsx`) MUST render the media URL. The hue gradient is a fallback render path used ONLY when `cover_media_url` IS NULL OR the media URL fails to load. The 6-swatch user-selectable hue picker MUST NOT be reintroduced as a primary cover authoring affordance. `cover_media_url` writes flow through `useBrandCoverUpload` (which routes through `brandCoverService` for uploads and `validateBrandCoverProviderUrl` for Pexels/Giphy refs) — no direct writes from components.

**Enforcement:** Strict-grep gate `orch-0805-brand-cover-overhaul` (10 checks, §11).

**Test:** new jest specs in `mingla-business/src/utils/__tests__/brandCoverRules.test.ts` cover MIME + size + path resolution; new specs in `mingla-business/src/hooks/__tests__/useBrandCoverUpload.test.ts` cover both source kinds + error paths.

---

## 11. Strict-grep CI gate

**New file:** `.github/scripts/strict-grep/orch-0805-brand-cover-overhaul.mjs`

Mirror the ORCH-0795 / ORCH-0806 registry pattern (one script + one job). Ten checks:

1. Migration file `*orch_0805_brand_covers_storage.sql` exists under `supabase/migrations/`.
2. Migration declares `INSERT INTO storage.buckets` for `brand_covers` (positive grep on the literal `'brand_covers'`).
3. Migration declares all 3 admin write policies (`brand_covers_admin_write`, `brand_covers_admin_update`, `brand_covers_admin_delete`).
4. `mingla-business/src/utils/brandCoverRules.ts` exports `BrandCoverError`, `BRAND_COVER_MAX_BYTES`, `resolveBrandCoverContentType`, `brandCoverStoragePath`.
5. `mingla-business/src/services/brandCoverService.ts` exports `uploadBrandCover` and the `BRAND_COVERS_BUCKET` constant equals `"brand_covers"`.
6. `mingla-business/src/services/pexelsBrandCoverService.ts` and `giphyBrandCoverService.ts` exist.
7. **Negative grep:** `BrandEditView.tsx` does NOT contain `COVER_HUE_TILES` (constant removal).
8. **Negative grep:** the literal `"Photo upload lands in a later cycle."` does NOT appear anywhere under `mingla-business/`.
9. `BrandCoverPickerSheet.tsx` exists and references all 3 source labels (`Upload`, `Pexels`, `Giphy`).
10. `PublicBrandPage.tsx` imports `expo-image` AND references `brand.coverMediaUrl`.

Register the job in `.github/workflows/strict-grep-mingla-business.yml` directly below `orch-0806-audit-action-labels`. Job name: `orch-0805-brand-cover-overhaul`. Display name: `"ORCH-0805: brand cover overhaul (custom upload + Pexels + Giphy) (I-PROPOSED-BE)"`.

Negative control test for CLOSE: implementor re-adds `COVER_HUE_TILES` literal temporarily; gate Check 7 FAILS with the exact constant name. Restore; gate returns to PASS.

---

## 12. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Upload JPEG happy path | 2 MB JPEG selected from device | `brands.cover_media_url` populated; `cover_media_type='image'`; storage object exists at `{brandId}/{token}.jpg` | Full stack |
| T-02 | Upload GIF happy path | 8 MB GIF selected | `cover_media_type='gif'`; URL persists | Full stack |
| T-03 | Upload too-large | 20 MB JPEG | Toast `"That file is too large…"`; no DB write | Service + component |
| T-04 | Upload wrong MIME | HEIC file | Toast `"Choose a JPEG, PNG, WebP, or GIF."`; no DB write | Service |
| T-05 | Upload empty-bytes | iOS fetch().blob() corner case (mocked) | `BrandCoverError("empty_local_file", …)` surfaces | File reader unit |
| T-06 | Pexels happy path | Pick image from search | URL with `images.pexels.com` host persists; `cover_media_type='image'` | Service + hook |
| T-07 | Pexels unknown host attempted | Synthetic URL with non-Pexels host | `validateBrandCoverProviderUrl` rejects | Unit |
| T-08 | Giphy happy path | Pick GIF from search | URL with `media*.giphy.com` host persists; `cover_media_type='gif'` | Service + hook |
| T-09 | Public render with media | Brand has cover_media_url | `expo-image` renders the URL | Component |
| T-10 | Public render fallback on null | cover_media_url null | hue gradient renders | Component |
| T-11 | Public render fallback on load error | cover_media_url present but 404 | `onError` flips state; hue gradient renders | Component |
| T-12 | Android GIF animation | GIF URL on Android device | Animation observed (implementor reports) | Device probe |
| T-13 | RLS denies non-admin | Brand member tries upload | Storage returns 403; toast surfaces "You don't have permission" | RLS |
| T-14 | Previous cover deletion | Upload #2 succeeds | Previous storage object deleted (best-effort) | Service |
| T-15 | Edit preview reflects pick | Pick Pexels image in sheet | BrandEditView preview shows the new URL before save | Component |
| T-16 | Cancel sheet preserves draft | Open sheet, browse Pexels, close | `draft.coverMediaUrl` unchanged | Component |
| T-17 | Hue gradient remains for legacy brands | Brand created pre-ORCH-0805 with no media | Public page renders hue (no regression) | Component |
| T-18 | Strict-grep negative control | Re-add `COVER_HUE_TILES` literal | Check 7 FAIL naming the constant | CI |

---

## 13. Implementation order

1. **DB migration** — write `supabase/migrations/20260529000000_orch_0805_brand_covers_storage.sql`. **Implementor does NOT run `supabase db push`.** State explicitly in the implementation report: "migration must be applied by operator before testing." Tester verifies bucket existence via read-only Supabase MCP probe.
2. **Rules + reader + service modules** (no UI yet): `brandCoverRules.ts`, `brandCoverFileReader.ts`, `brandCoverService.ts`. Write unit tests T-04, T-05, T-07, T-14 against these.
3. **Provider services**: `pexelsBrandCoverService.ts`, `giphyBrandCoverService.ts`. Cite the `event-cover-pexels-search` edge function reuse in a header comment.
4. **Hook**: `useBrandCoverUpload.ts`. Write hook tests T-06, T-08, T-13.
5. **Component — sheet**: `BrandCoverPickerSheet.tsx`. Mount it inside `BrandEditView` per the sub-sheet-inside-parent rule.
6. **Component — BrandEditView edits**: delete hue constant + 6-swatch UI + handlePhotoEdit toast + dead styles; add "Change cover" CTA + sheet integration + preview render.
7. **Component — PublicBrandPage edits**: add `expo-image` import; replace hero render with the 3-state fallback chain; add `coverMediaFailed` local state with reset useEffect.
8. **Strict-grep gate**: write script + register job in workflow.
9. **Local gates**: run `tsc --noEmit`, `npx jest brandCover`, `node .github/scripts/strict-grep/orch-0805-brand-cover-overhaul.mjs` + negative control smoke.
10. **Implementation report**: write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0805_BRAND_COVER_OVERHAUL.md` with old→new receipts, every success criterion mapped, the migration-pending callout, and Android GIF observation if device probe was possible.

---

## 14. Regression prevention

- **Class of bug being prevented:** placeholder UI ("coming soon") for shipped features (Constitution #9 erosion). The dead-tap-toast pattern lived for cycles. The strict-grep gate Check 8 (negative grep on `"Photo upload lands in a later cycle."` string) ensures the toast cannot be reintroduced.
- **Migration safety:** the in-migration `DO $$` verification probe RAISES EXCEPTION on apply if the bucket or public-read policy is missing — apply-time fail-fast rather than runtime mystery.
- **Storage path injection prevention:** `brandCoverStoragePath()` constructs the path; RLS validates the brand UUID is the first segment. No way for a brand member to write to another brand's path.
- **Architectural decoupling:** brand and event cover services are cleanly separate. A future regression in `pexelsEventCoverService` cannot break `pexelsBrandCoverService`, and vice versa.
- **Protective comment** at the top of `brandCoverRules.ts`: explains the invariant + how to add new MIME types + cross-ref to ORCH-0805 + I-PROPOSED-BE.

---

## 15. Hard guards for implementor

- **No `supabase db push`.** Implementor writes the migration file, lists it in "Migrations awaiting `supabase db push`" in the implementation report, and stops. Operator applies. Orchestrator confirms via `mcp__supabase__list_migrations` after operator confirms.
- **No edge function deploys.** No edge function changes. `event-cover-pexels-search` is reused as-is.
- **No `mcp__supabase__apply_migration`.** Prohibited.
- **No schema changes to `public.brands`.** Cover columns already exist.
- **No touch of event-cover code paths** (`EventCover.tsx`, `eventCoverMediaService.ts`, `eventCoverFileReader.ts`, `pexelsEventCoverService.ts`, `giphyEventCoverService.ts`, all `event-cover-*` edge functions). Strict-grep Check 20 / spec criterion C-20 verifies.
- **No avatar-pencil F-09 fix.** Defer to ORCH-0805-A. The `handlePhotoEdit` pencil callsite stays as-is; only its dead-tap toast is removed because it shares the same handler.
- **No new edge functions.**
- **No persistence of Brand snapshots in Zustand.** `currentBrandStore.ts` v14 partialize stays `{ currentBrandId }` only.
- **No provider secrets in source.** Pexels API key stays in edge fn env. Giphy API key already in client (public search key per Giphy's design).
- **Use `expo-image` only on `PublicBrandPage` hero + `BrandEditView` preview.** Don't migrate other Image renders in the file; out of scope.
- **Mount the sheet inside the parent View** per the sub-sheet-inside-parent rule (referenced from Cycle 12 / 13a precedent).
- **Currency: N/A** — no money on this surface.

---

## 16. Expected implementor output

**File:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0805_BRAND_COVER_OVERHAUL.md`

Sections: scope confirmation; file diff summary; per-criterion C-01..C-20 verification with file:line + test name; jest output; tsc output; strict-grep output + negative control smoke; migration-pending callout (operator must `supabase db push` before tester runs RLS probes); device-probe observation for Android GIF animation (T-12, T-13) if available, marked UNVERIFIED otherwise; known limitations; downstream test handoff note.

---

## Confidence

HIGH on the architectural decisions, schema correctness, and pipeline mirror patterns. MEDIUM on the exact Pexels API response shape mapping to `BrandCoverProviderRef` — implementor should mirror the existing `pexelsEventCoverService` types directly rather than re-deriving. Android GIF animation correctness in `expo-image` is HIGH per the package's documented behaviour but requires a device probe to fully confirm (T-13).

---

**End of SPEC.**
