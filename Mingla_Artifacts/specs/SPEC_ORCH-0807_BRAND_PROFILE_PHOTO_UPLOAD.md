# SPEC — ORCH-0807: Brand profile photo upload + native square crop

**Skill:** Claude `mingla-forensics` (SPEC mode)
**Date:** 2026-05-12
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0807_BRAND_PROFILE_PHOTO_UPLOAD.md`

---

## ⚠️ POST-IMPLEMENTATION CORRECTION (2026-05-12, CLOSE)

The original SPEC text below was written before four implementation amendments landed.
The amendments supersede the original text where they conflict. Full audit trail in
`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0807_BRAND_PROFILE_PHOTO_UPLOAD.md`
(Rev 1 + Rev 2 + Rev 3 + Rev 3b headers) and `Mingla_Artifacts/CLOSE_NOTE_ORCH-0807.md`.

| Original SPEC section | Status post-CLOSE | What replaced it |
|-----------------------|-------------------|------------------|
| §5.1 mirror `brand-cover-upload-intent` edge function | ❌ SUPERSEDED | Sibling edge fn does not exist. ORCH-0807 uses direct Supabase Storage upload via `supabase.storage.from('brand_avatars').upload(...)` — RLS on the bucket gates writes (Option A operator-approved). |
| §6.2 manipulator center-crop + `assertSquareDimensions` | ❌ SUPERSEDED | Manipulator dep + assertion removed (Rev 2). Square crop is OFFERED via `expo-image-picker` `allowsEditing: true, aspect: [1, 1]`; user's choice is final. No service-side square enforcement. |
| §6.4 audit slug registration | ❌ SUPERSEDED | No edge fn means no client→server audit emit. DB write audit happens via the existing `useUpdateBrand` chain. |
| §6.6 "1-line `photo` prop addition" to BrandProfileView | ❌ SUPERSEDED | Rev 3 expanded to a full hero-card restructure (~60 LOC) — cover band + half-overlap avatar mirroring `PublicBrandPage.tsx:259-346` (operator-approved scope amendment). |
| §8 I-PROPOSED-BG `BRAND_AVATAR_SQUARE_ONLY` | ❌ SUPERSEDED | Renamed to `BRAND_AVATAR_NATIVE_CROP_OFFERED`. New rule: picker must invoke `allowsEditing: true, aspect: [1, 1]` AND `expo-image-manipulator` MUST NOT be in `package.json`. |
| §10 T-04/T-08/T-10 (manipulator + edge-fn rejection paths) | ❌ SUPERSEDED | Tests dropped per Rev 2 (no manipulator pipeline, no edge fn). |
| §9 strict-grep 3 checks | ❌ SUPERSEDED | Gate re-scoped to 2 checks: (1) sheet contains `allowsEditing: true` AND `aspect: [1, 1]`; (2) package.json does NOT contain `expo-image-manipulator`. |

**NEW work shipped beyond original SPEC scope:**

- **Rev 3 — Brand Profile cover band parity.** Internal `BrandProfileView.tsx` hero card now mirrors the public page's cover-band + half-overlap-avatar pattern.
- **Rev 3b — AppsFlyer dev-client crash unblock.** `appsFlyerService.ts` import line crashed on dev-client builds without the native module. Lazy-require + null guards added; `react-native-appsflyer` properly declared in `package.json`.
- **P3 doc-rot fix (this CLOSE).** Stale manipulator comment in `BrandAvatarPickerSheet.tsx:109-114` rewritten to reflect Rev 2 reality.

The sections below remain as they were written — read alongside the table above.

---

## 1. Scope

Brand admins on the `BrandEditView` screen can upload a profile photo for their brand. The upload pipeline enforces square output (native crop UI via `expo-image-picker` + `expo-image-manipulator` belt-and-braces center-crop). The photo persists to `brands.profile_photo_url` (existing column, currently 100% NULL) and renders as a round circle at every existing Avatar hero usage. Mirrors ORCH-0805 brand cover overhaul tightly, with simpler scope.

**Three layer touches:**

1. **Storage / DB** — new `brand_avatars` Supabase Storage bucket + RLS migration. No schema changes to `brands` (columns `profile_photo_url` + `profile_photo_type` already exist per migration `20260506000000`).
2. **Edge function** — new `brand-avatar-upload-intent` mirroring `brand-cover-upload-intent` (signed upload URL + audit log emit + server-side square guard).
3. **Component** — new `BrandAvatarPickerSheet.tsx`, new service + hook + rules trio, wiring in `BrandEditView` (replace transitional toast), 1-line additions in `BrandProfileView` + the `Avatar` primitive (hero → circle).

## 2. Non-goals

- **NO changes to brand cover surface** (ORCH-0805 just shipped; locked).
- **NO changes to team-member avatar surfaces** (`BrandTeamView`, `BrandMemberDetailView`) — those are person identity, not brand identity.
- **NO new `Brand` TS fields.** The `photo` + `profilePhotoType` fields already exist.
- **NO Pexels / GIPHY / stock-photo integration.** Device-pick only.
- **NO GIF / video avatar support in v1.** The column union (`"image" | "video" | "gif"`) is future-proofed per DEC-109, but v1 writes `"image"` only.
- **NO new `Brand.photo` upload entry point outside `BrandEditView`.** A future cycle could add an onboarding-wizard step or an avatar-only screen; out of scope here.
- **NO changes to `app-mobile/` or `mingla-admin/`** — operator dispatch is mingla-business-only.
- **NO buyer-flow changes.** The `ticket-confirmation-dispatch` edge fn already reads `brands.profile_photo_url` and will auto-populate when the column starts filling; no Mingla code change there.
- **NO `supabase db push` by the implementor** — operator runs migrations.
- **NO edge function deploys by the implementor** — implementor writes the file; orchestrator deploys after operator confirms the migration is on remote (per `feedback_orchestrator_deploys_edge_functions`).
- **NO `mcp__supabase__apply_migration`** — prohibited per skill guard.

## 3. Assumptions

- `expo-image-manipulator ~14.0.8` (matching the `app-mobile/` version under Expo SDK 51) is additively installable in `mingla-business/` with no native build. Implementor adds to `mingla-business/package.json` and runs `npm install` from the `mingla-business/` directory. If the install fails for any reason, surface as a blocker — do not silently switch to a different cropping library.
- The `Avatar` primitive's existing `photo?: string` prop renders via React Native `<Image source={{ uri: photo }} />`. When `photo` is null/undefined, the primitive falls back to the initials placeholder. ORCH-0807 does NOT change this fallback behavior.
- The `brand_covers` storage RLS pattern at `supabase/migrations/20260529000000_orch_0805_brand_covers_storage.sql` is the canonical mirror. New migration clones the structure including the column-detection fallback for CI Postgres compatibility.
- Brand admins (rank ≥ `brand_admin` per DEC-122 / I-PROPOSED-T) are the appropriate gate for upload + write. Confirmed by inspection of the existing brand-cover upload flow.
- The existing `handlePhotoEdit` callback in `BrandEditView.tsx:318-320` and the pencil-edit Pressable at lines 421-428 are reusable — implementor replaces ONLY the toast body in `handlePhotoEdit`, does not rewrite the scaffolding.

---

## 4. Database layer

### 4.1 NO new columns

`brands.profile_photo_url text NULL` and `brands.profile_photo_type text NULL` already exist (live SQL probe 2026-05-12: 14 brands, 100% NULL). No `ALTER TABLE` statements.

### 4.2 New storage bucket + RLS migration

**File:** `supabase/migrations/<timestamp>_orch_0807_brand_avatars_storage.sql`

**Monotonic check:** find the largest existing migration timestamp in `supabase/migrations/` at implementation time (currently `20260530000000_orch_0804_orders_tax_columns.sql` is the latest post-PR-#85 merge per ORCH-0804 close). Implementor MUST pick a timestamp strictly greater than that value.

**Content (mirror of `20260529000000_orch_0805_brand_covers_storage.sql`, parameters changed for avatar):**

- Bucket id: `brand_avatars`
- `public = true` (public read for anonymous buyers rendering brand pages on `/b/{slug}`)
- `file_size_limit = 5242880` (5 MB)
- `allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']` (NO `image/gif` — v1 is static images only per non-goal)
- Column-detection fallback exactly as in the brand_covers migration (handles older CI Postgres `storage.buckets` schema)
- Path convention: `{brandId}/{token}.{ext}` — same as brand_covers
- RLS read policy: public SELECT (matches event_covers, brand_covers)
- RLS write/update/delete policy: same predicate as brand_covers — `public.biz_brand_effective_rank_for_caller((split_part(name, '/', 1))::uuid) >= public.biz_role_rank('brand_admin')`
- In-migration verification probe: `RAISE EXCEPTION` if bucket missing after insert

**RLS justification:** brand-admin+ may write. Brand_admin is the same rank that owns cover writes; consistent with DEC-113 brand-level Connect attachment + I-PROPOSED-T.

---

## 5. Edge function layer

### 5.1 New edge function: `supabase/functions/brand-avatar-upload-intent/index.ts`

**Mirror:** `supabase/functions/brand-cover-upload-intent/index.ts` (implementor reads this first; the file MUST exist on `Seth` post-ORCH-0805 merge).

**HTTP:** `POST`, `verify_jwt: true`.

**Request schema:**
```ts
{
  brand_id: string;      // UUID
  content_type: "image/jpeg" | "image/png" | "image/webp";
  file_size_bytes: number;     // client-asserted; edge fn validates ≤ 5_242_880
  width: number;               // post-manipulator client-asserted; edge fn requires width === height (square guard)
  height: number;              // same
}
```

**Response schema (success, 200):**
```ts
{
  signedUploadUrl: string;     // PUT-able URL the client uses to upload bytes
  publicUrl: string;           // Final public URL to persist to brands.profile_photo_url
  storagePath: string;         // {brandId}/{token}.{ext}
}
```

**Error responses (structured per I-PROPOSED-S audit-log discipline):**
- 400 `validation_error` with `detail: "brand_id_invalid_uuid" | "content_type_unsupported" | "file_size_too_large" | "not_square" | "dimensions_missing"`
- 403 `unauthorized` if `requirePaymentsManager` (or equivalent brand-admin gate — implementor verifies which helper is current canonical) returns forbidden
- 409 `brand_not_found`
- 502 `storage_signed_url_failed` if Supabase signed URL gen fails

**Auth gate:** same helper used by `brand-cover-upload-intent` (`requireBrandAdmin` or equivalent — implementor mirrors). UUID validation on `brand_id`.

**Server-side square guard:** `if (width !== height) return 400 not_square`. Belt-and-braces guard — the client-side `expo-image-manipulator` center-crop should have made this unreachable, but the edge fn rejects regardless to enforce I-PROPOSED-BG at the API tier.

**Idempotency:** standard `idempotencyKey` per I-PROPOSED-R if the edge fn calls any Stripe-style API. Path token regeneration on each upload (mirror `generateCreatorAvatarPathToken()` from `creatorAvatarRules.ts:105-109`) — fresh URL per upload prevents stale image-cache reads.

**Audit log emit:** `writeAudit({action: "brand_avatar.upload_intent_generated", target_type: "brand", target_id: brand_id})`. Slug added to `KNOWN_STATIC_SLUGS` + resolver per SPEC §6.4.

---

## 6. Service / Hook / Component layer

### 6.1 New utility: `mingla-business/src/utils/brandAvatarRules.ts`

**Mirror:** `mingla-business/src/utils/creatorAvatarRules.ts` (ORCH-0786 precedent — 197 lines). Adapt for brand avatars.

**Exports:**
- `BRAND_AVATAR_MAX_BYTES = 5 * 1024 * 1024`
- `BRAND_AVATAR_ALLOWED_MIME_TYPES = ["image/jpeg","image/png","image/webp"] as const` (NO `image/gif`)
- `BRAND_AVATAR_OUTPUT_SIZE = 512` (px — manipulator resize target after square center-crop)
- `BrandAvatarMimeType` type
- `BrandAvatarErrorCode` union: `"permission_denied" | "unsupported_type" | "file_too_large" | "empty_local_file" | "non_square" | "upload_failed" | "display_failed"`
- `BrandAvatarError` class
- `BrandAvatarAssetInput` interface
- `resolveBrandAvatarContentType(input): BrandAvatarMimeType | null` — mirrors `resolveCreatorAvatarContentType`
- `generateBrandAvatarPathToken(): string` — mirrors `generateCreatorAvatarPathToken`
- `brandAvatarStoragePath(brandId, contentType, pathToken): string` — returns `{brandId}/{token}.{ext}` (NOTE: different shape from creator avatars which use `{userId}.{token}.{ext}` — brand_avatars use folder-style to align with brand_covers RLS)
- `extractBrandAvatarStoragePath(publicUrl)` — mirrors creator avatar extractor
- `verifyBrandAvatarPublicUrl(publicUrl, fetchImpl?)` — mirrors creator avatar verifier (HEAD + Range fallback)
- **NEW**: `assertSquareDimensions(width, height): void` — throws `BrandAvatarError("non_square", "...")` if `width !== height`. Used by `brandAvatarService` after manipulator output to enforce I-PROPOSED-BG client-side.

### 6.2 New service: `mingla-business/src/services/brandAvatarService.ts`

**Mirror:** `mingla-business/src/services/brandCoverService.ts` (~158 lines).

**Exports:**
- `uploadBrandAvatar({ brandId, source }): Promise<BrandAvatarUploadResult>` where:
  - `source: { kind: "device"; uri: string; mimeType?: string; fileName?: string }`
  - Result: `{ publicUrl: string; storagePath: string; width: number; height: number }`
- Flow (client-side):
  1. Resolve content type via `resolveBrandAvatarContentType` — throw `unsupported_type` if null
  2. Read source dimensions via `expo-image-picker`'s returned `width`/`height`
  3. Compute square crop region: `side = Math.min(width, height)`; `originX = (width - side) / 2`; `originY = (height - side) / 2`
  4. Call `ImageManipulator.manipulateAsync(uri, [{ crop: { originX, originY, width: side, height: side } }, { resize: { width: BRAND_AVATAR_OUTPUT_SIZE, height: BRAND_AVATAR_OUTPUT_SIZE } }], { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG })` — produces square 512×512 JPEG
  5. `fetch(manipulatorResultUri)` → `blob()` for byte length check; throw `file_too_large` if > `BRAND_AVATAR_MAX_BYTES`; throw `empty_local_file` if 0
  6. `assertSquareDimensions(manipulatorResult.width, manipulatorResult.height)` — belt-and-braces
  7. Invoke `brand-avatar-upload-intent` edge fn with `{brand_id, content_type: "image/jpeg", file_size_bytes, width, height}` — receive `{signedUploadUrl, publicUrl, storagePath}`
  8. `fetch(signedUploadUrl, { method: "PUT", body: blob, headers: { "Content-Type": "image/jpeg" } })` — throw `upload_failed` on non-2xx
  9. `verifyBrandAvatarPublicUrl(publicUrl)` — throws `display_failed` if URL doesn't serve bytes
  10. Return `{ publicUrl, storagePath, width: 512, height: 512 }`

- `writeBrandAvatarToBrand(brandId, publicUrl): Promise<void>` — Supabase UPDATE: `brands SET profile_photo_url = $publicUrl, profile_photo_type = 'image', updated_at = now() WHERE id = $brandId`. Throws on error per Const #3.

### 6.3 New hook: `mingla-business/src/hooks/useBrandAvatarUpload.ts`

**Mirror:** `mingla-business/src/hooks/useBrandCoverUpload.ts` (~130 lines).

**Shape:**
```ts
export interface UseBrandAvatarUploadInput {
  brandId: string;
  source: { kind: "device"; uri: string; mimeType?: string; fileName?: string };
}

export function useBrandAvatarUpload(): {
  uploadAvatar: (input: UseBrandAvatarUploadInput) => Promise<{ publicUrl: string }>;
  isUploading: boolean;
  error: BrandAvatarError | null;
  clearError: () => void;
}
```

`useMutation` with `mutationFn` that calls `uploadBrandAvatar()` then `writeBrandAvatarToBrand()`. `onSuccess` invalidates:
- `["brands", "detail", brandId]`
- Any public-brand-page query key that consumes `profile_photo_url` (implementor identifies the canonical key)

`onError` logs to console (Const #3 — caller subscribes via mutation.error).

### 6.4 New component: `mingla-business/src/components/brand/BrandAvatarPickerSheet.tsx`

**Mirror:** `BrandCoverPickerSheet.tsx` (581 lines) — simpler because no tabs (Upload only), no Pexels/GIPHY services, no GIF preview.

**Props:**
```ts
export interface BrandAvatarPickerSheetProps {
  visible: boolean;
  brandId: string;
  currentPhotoUrl: string | null;
  onClose: () => void;
  onPicked: (result: { publicUrl: string }) => void;
  onErrorToast?: (message: string) => void;
}
```

**States** (single-flow, no tabs):
- `idle` — sheet open, title "Choose a profile photo", "Pick from device" CTA visible (primary)
- `picking` — `ImagePicker.launchImageLibraryAsync` open (native UI); sheet content shows "Opening photos…" copy or spinner
- `cropping` — manipulator center-crop + resize in progress; spinner with copy "Preparing photo…"
- `uploading` — signed URL request + upload + verify; spinner with copy "Uploading…"
- `error` — inline error message from `BrandAvatarError.message`; CTA flips to "Try again" which restarts picker
- `success` — `onPicked` fires with `{ publicUrl }`; sheet closes via `onClose`

**Copy:**
- Title: "Choose a profile photo"
- Subtitle: "Pick a square photo, or pick any photo and crop it square."
- Primary CTA (idle): "Pick from device"
- Secondary CTA (idle): "Cancel" → `onClose`
- Error messages from `BrandAvatarError.message` (already user-friendly per the precedent)

**Picker call:**
```ts
const result = await ImagePicker.launchImageLibraryAsync({
  mediaTypes: ImagePicker.MediaTypeOptions.Images,
  allowsEditing: true,
  aspect: [1, 1],   // Android enforces; iOS shows 1:1 hint overlay
  quality: 1,        // raw — manipulator handles compression
});
if (result.canceled) return;  // user backed out of picker
const asset = result.assets[0];
```

**Manipulator call** (happens inside `uploadBrandAvatar` service, not the sheet — listed here for clarity):

```ts
const side = Math.min(asset.width, asset.height);
const originX = Math.round((asset.width - side) / 2);
const originY = Math.round((asset.height - side) / 2);
const cropped = await ImageManipulator.manipulateAsync(
  asset.uri,
  [
    { crop: { originX, originY, width: side, height: side } },
    { resize: { width: 512, height: 512 } },
  ],
  { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
);
```

**Haptics:**
- `Haptics.selectionAsync()` on idle "Pick from device" tap
- `Haptics.notificationAsync(Success)` on `success`
- `Haptics.notificationAsync(Error)` on `error`

**Accessibility:**
- Sheet `accessibilityRole="dialog"`
- "Pick from device" CTA `accessibilityLabel="Pick a profile photo from your device"`
- "Cancel" CTA `accessibilityLabel="Cancel photo upload"`

**Memory rules honored:**
- `feedback_rn_sub_sheet_must_render_inside_parent` — sheet rendered inside `BrandEditView`'s root View, not as a sibling Fragment.
- `feedback_keyboard_never_blocks_input` — N/A (no TextInput in this sheet).
- `feedback_toast_needs_absolute_wrap` — N/A (no toast inside the sheet; errors render inline).

### 6.5 Wiring in `BrandEditView.tsx`

**Three edits:**

1. **Replace `handlePhotoEdit` body** at lines 318-320:
```ts
// BEFORE (transitional):
const handlePhotoEdit = useCallback((): void => {
  fireToast("Photo upload lands in a later cycle.");
}, [fireToast]);

// AFTER:
const handlePhotoEdit = useCallback((): void => {
  setAvatarPickerVisible(true);
}, []);
```

2. **Add 3 useState + 2 useCallback** parallel to the existing `coverPickerVisible` block at lines 322-340:
```ts
// ORCH-0807 — brand AVATAR picker sheet (Upload only).
const [avatarPickerVisible, setAvatarPickerVisible] = useState<boolean>(false);
const handleCloseAvatarPicker = useCallback((): void => {
  setAvatarPickerVisible(false);
}, []);
const handleAvatarPicked = useCallback(
  (result: { publicUrl: string }): void => {
    setDraft((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            photo: result.publicUrl,
            profilePhotoType: "image",
          },
    );
  },
  [],
);
```

3. **Add `photo` prop to Avatar at line 420 + mount sheet outside ScrollView:**
```tsx
<Avatar name={brand.displayName} size="hero" photo={draft.photo} />
{/* ... existing pencil button + ... */}

// Outside ScrollView, sibling to existing BrandCoverPickerSheet:
<BrandAvatarPickerSheet
  visible={avatarPickerVisible}
  brandId={brand.id}
  currentPhotoUrl={draft.photo ?? null}
  onClose={handleCloseAvatarPicker}
  onPicked={handleAvatarPicked}
  onErrorToast={(msg) => fireToast(msg)}
/>
```

The transitional toast `"Photo upload lands in a later cycle."` is REMOVED (Const #8 subtract-before-adding — no layering on broken code).

### 6.6 Wiring in `BrandProfileView.tsx`

Single 1-line edit at line 356:
```tsx
// BEFORE:
<Avatar name={brand.displayName} size="hero" />

// AFTER:
<Avatar name={brand.displayName} size="hero" photo={brand.photo} />
```

### 6.7 Avatar primitive shape change

**File:** `mingla-business/src/components/ui/Avatar.tsx` line 71

```ts
// BEFORE:
hero: {
  width: 84,
  height: 84,
  borderRadius: radiusTokens.lg,
  fontSize: 36,
},

// AFTER:
hero: {
  width: 84,
  height: 84,
  borderRadius: 999,  // ORCH-0807: full circle for brand/member profile semantics
  fontSize: 36,
},
```

Update the header comment (line 1-25) to reflect that `hero` is now a circle.

### 6.8 Audit slug resolver

`mingla-business/src/utils/auditActionLabels.ts`:
- Add `"brand_avatar.upload_intent_generated"` to `KNOWN_STATIC_SLUGS`
- Add resolver case returning category `"brand"` (or `"brand_identity"` if a better category exists — implementor uses whichever is canonical for non-Stripe brand events), icon `"image"` or `"edit"` (whichever matches the existing icon vocabulary)
- I-PROPOSED-BD AUDIT_LOG_HUMAN_READABLE preserved

---

## 7. Success criteria

1. **C-01** — `BrandEditView` renders the Avatar with `photo={draft.photo}`. When the brand has no photo, the existing initials placeholder renders. When the brand has a photo, the photo URL renders.
2. **C-02** — Tapping the existing pencil-edit button opens `BrandAvatarPickerSheet` (NOT the transitional toast).
3. **C-03** — The sheet's "Pick from device" CTA launches `ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [1,1], quality: 1 })`. Cancellation returns to the sheet idle state.
4. **C-04** — After picker returns, `ImageManipulator.manipulateAsync` center-crops to square (`side = min(width, height)`) and resizes to 512×512 JPEG at quality 0.9. Result is always exactly square.
5. **C-05** — Upload pipeline calls `brand-avatar-upload-intent` for a signed URL, PUTs the JPEG blob, verifies the public URL serves bytes (HEAD or Range), writes `brands.profile_photo_url = publicUrl, profile_photo_type = 'image'`.
6. **C-06** — On success, `BrandEditView`'s draft state updates and the Avatar re-renders with the new photo (still within edit flow; persistence to DB happens on Save per existing edit-view contract).
7. **C-07** — On error, an inline error message renders in the sheet AND a toast fires in `BrandEditView`. Sheet stays open; user can retry.
8. **C-08** — `Avatar` hero variant renders as a full circle (`borderRadius: 999`) at every render site (`BrandEditView`, `BrandProfileView`, `BrandMemberDetailView`, `PublicBrandPage`).
9. **C-09** — `PublicBrandPage` auto-renders the new photo when `brands.profile_photo_url` populates (no Mingla code change needed — already wired).
10. **C-10** — Edge function rejects non-square uploads with HTTP 400 `not_square` (belt-and-braces server-side guard).
11. **C-11** — File > 5MB rejected client-side with `file_too_large` error before upload attempt; edge fn also rejects with 400 `file_size_too_large`.
12. **C-12** — Unsupported MIME (e.g. `image/heic` if iOS returns it) rejected client-side with `unsupported_type`.
13. **C-13** — Audit log emits `brand_avatar.upload_intent_generated` per successful intent generation; slug resolves to non-`other` category per I-PROPOSED-BD.
14. **C-14** — New `brand_avatars` Supabase Storage bucket exists post-migration, public-read RLS, 5MB cap, JPEG/PNG/WEBP only, brand-admin write predicate using `biz_brand_effective_rank_for_caller`.
15. **C-15** — Strict-grep gate `orch-0807-brand-avatar-square` PASSES locally with a negative-control smoke that fails when `ImageManipulator.manipulateAsync` is removed from the upload service.
16. **C-16** — `tsc --noEmit` clean from `mingla-business/`. New jest tests for `brandAvatarRules.ts` (MIME resolution, square assertion, path token shape) all PASS.
17. **C-17** — `expo-image-manipulator ~14.0.8` added to `mingla-business/package.json` dependencies. `npm install` from `mingla-business/` completes without errors.
18. **C-18** — Zero diff in SPEC §2 non-goal surfaces (cover picker, team avatars, app-mobile, mingla-admin, buyer flow code).

---

## 8. Invariants

### NEW invariant promoted DRAFT (flips ACTIVE on ORCH-0807 CLOSE)

**I-PROPOSED-BG BRAND_AVATAR_SQUARE_ONLY**

**Rule:** Every value stored in `brands.profile_photo_url` MUST point at a square image (width === height) stored in the `brand_avatars` Supabase Storage bucket. Client upload pipeline (`brandAvatarService.uploadBrandAvatar`) MUST center-crop and resize via `expo-image-manipulator.manipulateAsync` before upload. Server edge function (`brand-avatar-upload-intent`) MUST validate `width === height` and reject non-square requests with HTTP 400. The bucket's RLS policy enforces brand-admin+ write via `biz_brand_effective_rank_for_caller((split_part(name, '/', 1))::uuid) >= biz_role_rank('brand_admin')`.

**Why:** Avatars render in round-circle and small square contexts; non-square sources visibly distort or crop awkwardly in the UI. Enforcing square at three tiers (client manipulator, client assertion, server edge fn) eliminates a class of fabricated/distorted-data UX defects.

**Enforcement:** Strict-grep gate `orch-0807-brand-avatar-square` at `.github/scripts/strict-grep/orch-0807-brand-avatar-square.mjs`. Three checks:
1. `mingla-business/src/services/brandAvatarService.ts` MUST contain `ImageManipulator.manipulateAsync` AND `crop:` AND `resize:` in the same file (proves client-side square enforcement is wired).
2. `supabase/functions/brand-avatar-upload-intent/index.ts` MUST contain a `not_square` error string AND a `width !== height` (or equivalent) comparison (proves server-side guard).
3. `mingla-business/src/utils/brandAvatarRules.ts` MUST export `assertSquareDimensions` (proves the rule utility exists for the service to call).

**Test:** new jest test in `mingla-business/src/utils/__tests__/brandAvatarRules.test.ts` covering `assertSquareDimensions` happy path + non-square throw. Negative-control: removing the manipulator call from the service fires Check 1 with the exact missing-literal diagnostic.

**EXIT condition:** permanent invariant unless a future ORCH explicitly relaxes (e.g., supporting non-square avatars for some product reason). Reversal requires a new SPEC + DEC entry.

### Preserved

| Invariant | How |
|-----------|-----|
| Constitution #3 (no silent failures) | Sheet inline error + toast; mutation onError logs |
| Constitution #8 (subtract before adding) | Transitional toast removed when sheet replaces it |
| Constitution #9 (no fabricated data) | Initials fallback only fires when `photo` is null/undefined; no placeholder URL |
| Constitution #13 (exclusion consistency) | Avatar hero shape circle for ALL four hero render sites |
| I-PROPOSED-BD AUDIT_LOG_HUMAN_READABLE | New slug added to resolver |
| I-PROPOSED-BE BRAND_COVER_MEDIA_HONORED | Cover surface untouched |
| I-PROPOSED-O STRIPE-EMBEDDED-COMPONENTS (ACTIVE post-ORCH-0802) | No Stripe surface |
| I-PROPOSED-S STRIPE_AUDIT_LOG_ON_EVERY_EDGE_FN | N/A (non-Stripe edge fn; audit emit is still required by SPEC §5.1) |

---

## 9. Strict-grep CI gate

**New file:** `.github/scripts/strict-grep/orch-0807-brand-avatar-square.mjs`

**Three checks** as documented in §8 Enforcement block.

**Registration:** add a new job in `.github/workflows/strict-grep-mingla-business.yml` directly below `orch-0802-stripe-embedded-components-routing`. Job name: `orch-0807-brand-avatar-square`. Display name: `"ORCH-0807: Brand avatar square enforcement (I-PROPOSED-BG)"`.

**Negative-control smoke (mandatory per implementor's local gate run):** removing `ImageManipulator.manipulateAsync` from `brandAvatarService.ts` MUST fire Check 1 with a named diagnostic. Restoring returns the gate to PASS.

---

## 10. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Upload square image | 1024×1024 JPEG | Manipulator no-op crop + resize to 512×512; upload succeeds; brand draft updates | Full stack |
| T-02 | Upload tall image | 600×1200 JPEG | Manipulator crops to 600×600 (centered) then resizes to 512×512; upload succeeds | Full stack |
| T-03 | Upload wide image | 1600×900 PNG | Manipulator crops to 900×900 (centered) then resizes to 512×512; upload succeeds | Full stack |
| T-04 | Upload exceeds 5MB after manipulator | Source 8MB, manipulator output still > 5MB | Client throws `file_too_large`; sheet shows inline error; no upload attempt | Service |
| T-05 | Upload HEIC (iOS source) | iOS HEIC image | `resolveBrandAvatarContentType` returns null → `unsupported_type` error; sheet inline error; user can re-pick | Rules + Sheet |
| T-06 | User cancels picker | Picker cancel | Sheet returns to idle state; no upload | Sheet |
| T-07 | Edge fn auth gate (non-admin) | brand_member tier user | 403 unauthorized; sheet shows "permission_denied" friendly toast | Edge fn |
| T-08 | Edge fn rejects non-square (forced bypass) | Manipulated request with width=512, height=400 | 400 `not_square`; sheet inline error | Edge fn |
| T-09 | Public URL verification fails | Bucket misconfigured | Service throws `display_failed`; sheet shows inline error | Service |
| T-10 | Storage RLS denies non-admin write | Tester probes via direct REST | 403 from Storage; service throws `upload_failed` | RLS |
| T-11 | Avatar renders circle at hero | Any brand with `photo` populated | `borderRadius: 999` applied; visual circle | Component |
| T-12 | Avatar falls back to initials | Brand with `photo === null` | Initials placeholder renders; no broken image icon | Component |
| T-13 | PublicBrandPage auto-renders new photo | DB `profile_photo_url` populated post-upload | Public page shows photo on next render (no Mingla code change needed) | Component |
| T-14 | Audit log emits slug | After successful upload-intent | Row in `brand_audit_logs` with `action = "brand_avatar.upload_intent_generated"` | Audit |
| T-15 | Strict-grep gate clean | Fresh repo | `ORCH-0807 strict-grep PASS — 3/3 checks` | CI |
| T-16 | Negative control: remove manipulator | Temporarily delete `manipulateAsync` from service | Check 1 fires with named diagnostic; restore returns to PASS | CI |
| T-17 | tsc clean | mingla-business/ | EXIT 0 | CI |
| T-18 | Jest brandAvatarRules | New test file | All cases pass including non-square throw | CI |
| T-19 | Negative-control on non-goal files | git diff | Zero diff in BrandCoverPickerSheet, RefundSheet, BrandSwitcherSheet, etc. | CI |

---

## 11. Implementation order

1. **Phase 0 — Re-read sibling files.** Implementor reads `BrandCoverPickerSheet.tsx`, `useBrandCoverUpload.ts`, `brandCoverService.ts`, `brand-cover-upload-intent/index.ts`, and `20260529000000_orch_0805_brand_covers_storage.sql` to confirm the patterns this SPEC is mirroring.
2. **Pre-flight design step** — invoke `/ui-ux-pro-max` skill per `feedback_implementor_uses_ui_ux_pro_max`. Visible UI; non-negotiable per memory.
3. **Add dependency** — `expo-image-manipulator ~14.0.8` to `mingla-business/package.json`; run `npm install` from `mingla-business/` to commit the lockfile change. Verify the install added no native modules requiring `eas build`.
4. **Migration** — write `supabase/migrations/<timestamp>_orch_0807_brand_avatars_storage.sql`. Use a timestamp strictly greater than the latest in `supabase/migrations/`. State "Migration awaiting `supabase db push --linked`" in implementation report. Do NOT use `mcp__supabase__apply_migration`.
5. **Edge function** — write `supabase/functions/brand-avatar-upload-intent/index.ts`. Run `deno check` locally. Do NOT deploy — orchestrator deploys after operator confirms migration is live.
6. **Rules utility** — write `brandAvatarRules.ts` + the jest test file.
7. **Service + Hook** — write `brandAvatarService.ts` + `useBrandAvatarUpload.ts`.
8. **Sheet** — write `BrandAvatarPickerSheet.tsx`.
9. **Avatar primitive change** — flip hero `borderRadius` to `999` in `Avatar.tsx`.
10. **BrandEditView wiring** — replace `handlePhotoEdit` body; add useState + callbacks; add `photo` prop to Avatar; mount sheet.
11. **BrandProfileView wiring** — 1-line `photo={brand.photo}` addition.
12. **Audit slug** — add to `auditActionLabels.ts` + resolver case.
13. **Strict-grep gate** — write `.github/scripts/strict-grep/orch-0807-brand-avatar-square.mjs`. Register the workflow job. Verify negative-control fires.
14. **Local gates** — `tsc --noEmit` (mingla-business), `npx jest brandAvatar`, run strict-grep gate clean + negative-control. All must PASS.
15. **Implementation report** — write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0807_BRAND_PROFILE_PHOTO_UPLOAD.md` with old→new receipts + spec traceability matrix.

---

## 12. Regression prevention

- **Strict-grep gate** enforces manipulator call + server-side `not_square` guard at CI time.
- **Server-side square check** in edge fn is the final guard (defense in depth).
- **`assertSquareDimensions` utility** is the contract everyone must call before persisting.
- **Constitutional #9** preserved via initials fallback — null `photo` does not produce a fabricated placeholder URL.
- **Avatar primitive shape change is universal** — no inconsistent hero shape across surfaces (Constitutional #13).

---

## 13. Hard guards for implementor

- **Stay scoped.** Only the files named in §4, §5, §6, §9. No other product code changes.
- **No `supabase db push`.** Implementor writes the migration file, names it in "Migrations awaiting `supabase db push`" in the implementation report, and stops.
- **No `mcp__supabase__apply_migration`.** Prohibited.
- **No edge function deploys.** Implementor writes the file; orchestrator deploys after operator confirms migration is live on remote.
- **No changes to ANY of the §2 non-goal files.** Verify with `git diff --stat` before commit.
- **No silent fallback to a different cropping library.** If `expo-image-manipulator` install fails, surface as a blocker — do not switch to `react-native-image-crop-picker` or another lib.
- **No expansion of `profilePhotoType` write values.** v1 writes `"image"` only.
- **`/ui-ux-pro-max` MUST be invoked** before any UI file is written — pre-flight design step per `feedback_implementor_uses_ui_ux_pro_max`. Document the invocation in the implementation report.
- **Avatar primitive change is intentional and universal.** Do NOT add a `shape` prop variant; the global flip is the correct call per investigation HIDDEN-FLAW-2 + operator decision.

---

## 14. Expected implementor output

**File:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0807_BRAND_PROFILE_PHOTO_UPLOAD.md`

Standard 15-section implementation report. Must include:

- Old→new receipts for every file changed (15+ files in scope).
- Per-criterion C-01..C-19 verification table.
- `deno check` output for the new edge function.
- `tsc --noEmit` output (clean).
- New jest test output (all pass).
- Strict-grep PASS output + negative-control evidence.
- "Migrations awaiting `supabase db push --linked`" callout naming the new migration filename.
- `/ui-ux-pro-max` invocation evidence (skill output excerpt or summary).
- Discoveries for orchestrator (if any).

---

## Confidence

HIGH on:
- The architectural mirror (ORCH-0805 brand cover pattern is well-established and freshly merged).
- Schema/data state (live SQL probes confirm clean slate).
- Avatar primitive change (single-line, universally correct).
- Existing UI scaffolding reuse (`handlePhotoEdit` stub + pencil button already in place).

MEDIUM on:
- `expo-image-manipulator` install path under mingla-business — should be additive but if it conflicts with the existing Expo SDK lockfile, implementor must surface as a blocker (do not auto-bump SDK).
- Server-side dimension verification approach — SPEC accepts client-asserted width/height because Supabase Storage doesn't expose image dimensions cheaply pre-upload. The edge fn validates the assertion (rejects mismatched values) but a malicious client could lie to the edge fn. Mitigation: the RLS gate restricts to brand_admin+, and the client-side manipulator + assertSquareDimensions are the practical primary defenses. If a stronger guard is desired, a post-upload trigger could read the file dimensions via image inspection — out of scope here.

LOW concerns: none.

---

**End of SPEC.**
