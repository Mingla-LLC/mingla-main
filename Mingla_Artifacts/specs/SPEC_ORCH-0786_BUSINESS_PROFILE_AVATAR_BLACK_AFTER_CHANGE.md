# Spec: Business Profile Avatar Black After Change (ORCH-0786)

> Date: 2026-05-11
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0786_BUSINESS_PROFILE_AVATAR_BLACK_AFTER_CHANGE.md`
> Root cause: F1 (zero-byte upload via `fetch(asset.uri).blob()` on React Native) — `root cause proven`, confidence HIGH
> Status: READY FOR IMPLEMENTOR
> Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## 1. Plain-English Goal

When a Mingla Business organiser changes their profile picture, the new picture must actually show — not a black circle. Today the app reports "upload succeeded" but actually stores a zero-byte file in Supabase Storage, and iOS can't decode an empty image, so the avatar tile renders as a dark fill behind the orange ring.

This spec fixes the upload path so the picker's actual bytes are read (via `expo-file-system`, the proven event-cover pattern), rejects empty payloads before they leave the device, verifies the public object is non-empty after upload, and adds an `onError` initials fallback so even an unexpected render failure surfaces as readable initials instead of a silent black hole. It also re-adds the missing `creator_avatars` bucket migration so any fresh environment recreates the same bucket state that already exists in production.

Scope is bounded to the avatar upload / render / persistence chain in `mingla-business/app/account/edit-profile.tsx`. No event-cover, brand-cover, ticket-tier, Giphy/Pexels, app-mobile, or admin work.

---

## 2. User Story

As a Mingla Business organiser, I want my chosen profile picture to actually display after I select it and save, on iOS, Android, and web, so that my account identity is correct on every surface that shows it — and if anything goes wrong I want a clear failure (initials + retryable toast), not a black circle.

---

## 3. Scope

- **In scope:**
  1. `mingla-business/app/account/edit-profile.tsx` avatar picker, upload, render, and save chain.
  2. A new shared file-bytes reader for creator avatars (`mingla-business/src/services/creatorAvatarFileReader.ts`) modelled on `eventCoverFileReader.ts`.
  3. A new shared upload+verify service (`mingla-business/src/services/creatorAvatarService.ts`) and rules helper (`mingla-business/src/utils/creatorAvatarRules.ts`) modelled on the ORCH-0766B post-fix shape of event covers.
  4. Removal of the persisted `?t=…` cache-bust token from `creator_accounts.avatar_url`; cache-busting is applied only at render time.
  5. `<Image onError>` fallback to initials in the Edit profile avatar.
  6. Re-add a monotonic Supabase migration recreating the live remote `creator_avatars` bucket + 4 RLS policies (idempotent shape — the bucket already exists in production; the migration must be a safe no-op when applied to that state and a clean create when applied to a fresh database).
  7. Repo-running regression tests under `mingla-business/src/services/__tests__/` and `mingla-business/src/utils/__tests__/`.
  8. New strict-grep CI gate `orch-0786-creator-avatar-upload-integrity.mjs` wired into `.github/workflows/strict-grep-mingla-business.yml` per the registry pattern (`feedback_strict_grep_registry_pattern`).
  9. New `mingla-business/package.json` script `test:orch-0786` chaining the strict-grep gate and the new Jest specs.

- **Non-goals:**
  - Event cover media, brand cover, brand profile photo, ticket-tier media, Giphy/Pexels provider work, AI-driven avatars.
  - `app-mobile` (consumer app) profile avatar pipeline — it uses a different table (`profiles.avatar_url`) and a different bucket (`avatars`) and is not affected by this bug.
  - Admin dashboard surfaces.
  - Animated avatars (GIF/WebP animation). The remote bucket whitelist already excludes `image/gif`; this spec keeps that whitelist.
  - HEIC/HEIF source handling — `expo-image-picker` is configured with `allowsEditing: true` which already converts HEIC to JPEG on iOS, so HEIC handling stays out of scope.
  - Editing the operator's currently-persisted `avatar_url` value (the next valid upload overwrites it).
  - Stripe, payouts, public brand pages, public event pages, checkout, scanner.
  - Any architectural change to `useCreatorAccount` / `creatorAccount.ts` beyond what is needed to drop the `?t=` token.

- **Assumptions:**
  - The `creator_avatars` bucket and 4 RLS policies live in remote production today exactly as captured in `INVESTIGATION_ORCH-0786 §4a` (verified via read-only MCP probe on 2026-05-11). The new migration must converge on that shape, not invent a new one.
  - `expo-file-system` is already a runtime dependency of `mingla-business` (verified in `mingla-business/package.json` — `expo-file-system: ~19.0.21`). No new package required.
  - The current `useUpdateCreatorAccount` mutation contract (write `display_name` + `avatar_url` to `creator_accounts` via existing self-write RLS) is correct and does not change.
  - Operator will dispatch `supabase db push --linked` for the new migration as part of CLOSE (per `feedback_orchestrator_deploys_edge_functions` for migrations); the migration must be idempotent against the live state so this push is a no-op against production while still applying cleanly to a fresh database.

---

## 4. Evidence Trace

| Requirement | Comes from investigation finding | Confidence |
|---|---|---|
| Replace `fetch(asset.uri).blob()` with `expo-file-system` byte read | 🔴 F1 — proven via remote DB: 2/2 objects in `creator_avatars` are 0 bytes; event_covers uses `readEventCoverFileBytes` and has only non-zero files | HIGH |
| Reject empty local bytes before `supabase.storage.upload` | 🔴 F1 causal-chain step 3 + ORCH-0766B precedent | HIGH |
| Verify public object after upload (HEAD / GET range) | 🟡 F6 — no post-upload byte gate; ORCH-0766B added `verifyEventCoverPublicUrl` for the same reason | HIGH |
| Persist canonical URL without `?t=` query token | 🟠 F2 — operator's `creator_accounts.avatar_url` currently contains `?t=1778489182992` literally baked in | HIGH |
| Add `onError` fallback on `<Image>` to render initials | 🟠 F3 — screenshot shows black tile + EDIT badge but no initials despite valid `display_name` | HIGH |
| Map `'jpg' → 'image/jpeg'` in MIME fallback; reject MIMEs outside bucket whitelist | 🟡 F5 — `image/jpg` is not in `creator_avatars.allowed_mime_types = ['image/jpeg','image/png','image/webp']` | HIGH |
| Re-add `creator_avatars` bucket migration to active migrations folder | 🟡 F4 — `20260504_b1_phase5_creator_avatars.sql` referenced in artifacts but absent from `supabase/migrations/` and baseline squash | HIGH |
| Strict-grep CI gate banning `fetch(uri).blob()` for picker uploads + asserting service/reader files exist | Regression prevention §9 of investigation; D-ORCH-0786-FOR-4 | HIGH |
| Backfill decision for 2 known 0-byte objects | D-ORCH-0786-FOR-3 — non-blocking; the fix's first successful upload overwrites the operator's `.jpg` row | HIGH |

---

## 5. Success Criteria

Numbered. Each is observable, testable, unambiguous.

1. When a signed-in organiser taps the avatar, picks a JPEG/PNG/WebP image, and the bytes are read successfully (≥ 1 byte), the upload writes a **non-zero-byte** object to `creator_avatars/{user.id}.{ext}` and the picture renders inside the orange-ring avatar circle within 2 seconds.
2. When the file-bytes reader returns `byteLength === 0`, `supabase.storage.upload` is **not** called, no row is updated, and the user sees a Toast: `"We couldn't read that photo. Try another."` The avatar tile remains in its prior state (initials or previous photo).
3. When `supabase.storage.upload` returns an error, the user sees a Toast: `"Couldn't upload photo. Tap to try again."` `photoUri` is not updated; the avatar tile remains in its prior state.
4. After a successful upload, the avatar `<Image>` is mounted with the **canonical** public URL (no `?t=` query token in `photoUri`'s persisted form).
5. When the user taps **Save** after a successful upload, `creator_accounts.avatar_url` is updated with the **canonical** public URL — no `?t=…` substring is persisted.
6. When the user reopens Edit profile after Save, hydration reads the canonical URL from `creator_accounts.avatar_url` and renders the picture (no black tile, no regression).
7. When the `<Image>` `onError` event fires for any reason (network error, decode failure, 404, zero-byte body, etc.), the avatar tile falls back to the initials view (text `initials`, `accent.warm` color, `accent.tint` background), and a `Toast` displays `"Couldn't show your photo. Tap the avatar to retry."` (info toast, non-blocking).
8. Post-upload byte verification: after `supabase.storage.upload` resolves, the service issues a `HEAD` against the public URL; if `HEAD` is not supported (HTTP 405/501), it falls back to `GET` with `Range: bytes=0-0`. If the proof shows `content-length: 0` or fails, the service throws `CreatorAvatarError("upload_failed", ...)`, the row is **not** persisted, the local `photoUri` does **not** update, and the user sees the `"Couldn't upload photo…"` toast.
9. When the picker returns an asset whose extension is `jpg`, `jpeg`, `png`, or `webp`, the upload `contentType` is exactly one of `image/jpeg`, `image/png`, `image/webp` (never `image/jpg`). Any other extension or unsupported MIME causes a typed error and a `"Choose a JPEG, PNG, or WebP image."` toast — no upload attempt is made.
10. The `creator_avatars` storage bucket and its 4 RLS policies exist as a monotonic migration file in `supabase/migrations/20260511000001_orch_0786_creator_avatars_bucket.sql` (or the next available monotonic timestamp ≥ the latest existing migration), with the exact same shape captured in INVESTIGATION §4a. The migration is idempotent against the live remote state (no errors on `supabase db push --linked` against production).
11. `npm run test:orch-0786` from `mingla-business/` runs (a) the strict-grep gate and (b) the new Jest specs; both PASS. Without the fix, the Jest specs FAIL with deterministic assertions tied to the exact file:line of the broken pattern.
12. `npm run test:orch-0786` is wired into the `mingla-business` `package.json` scripts block.
13. A new CI job `orch-0786-creator-avatar-upload-integrity` runs in `.github/workflows/strict-grep-mingla-business.yml` and FAILs the PR if (a) `fetch(asset.uri).blob()` appears in `mingla-business/app/account/**` or `mingla-business/src/services/creator*`, (b) the new `creatorAvatarFileReader.ts` / `creatorAvatarService.ts` / `creatorAvatarRules.ts` are missing or stop using `expo-file-system`, or (c) `edit-profile.tsx` persists a `?t=` substring into `avatar_url`.
14. iOS Simulator runtime gate (operator-assisted, TEST mode): pick a photo → see the photo render → reopen Edit profile → photo persists → sign out / sign in → photo persists → MCP read-only probe shows `(metadata->>'size')::bigint > 0` for `creator_avatars/{operator.id}.{ext}`. Same gate on Android emulator and web (`expo start --web`).

---

## 6. Invariants

### Must Preserve

| Invariant | How this spec preserves it | Verification |
|---|---|---|
| **Constitution #2 — One owner per truth** | `creator_accounts.avatar_url` remains the single owner of the persisted avatar URL; `photoUri` is component-local state derived from it; no Zustand. | code review + diff inspection |
| **Constitution #3 — No silent failures** | Empty-bytes path throws → toast; upload-error path throws → toast; verify-fail path throws → toast; render-fail path triggers `onError` → initials fallback + toast. **Every** branch produces visible user feedback. | `test:orch-0786` Jest specs (T-02, T-03, T-08, T-07) |
| **Constitution #5 — Server state server-side** | React Query owns `creator_accounts` hydration via `useCreatorAccount`; mutation invalidates the right key; no client cache duplicates the URL. | Diff review — no new Zustand persist entry |
| **Constitution #9 — No fabricated data** | When the avatar fails to render, the UI shows initials (truthful) rather than a black hole that implies a saved picture. | T-07 component test |
| **I-21 — operator-side route** | `edit-profile.tsx` remains under `app/account/`, behind `useAuth`, not exposed to anon-tolerant buyer routes. | unchanged file location |
| **I-35 — `creator_accounts.deleted_at` soft-delete contract** | Avatar mutation goes through existing self-write RLS; deleted accounts already blocked by Cycle 14 contract. | DB-policy unchanged |
| **DEC-096 D-14-2 — `creator_avatars` bucket per Cycle 14 SPEC-pivot** | Re-add the migration to active migrations folder; preserve the exact remote shape. | new migration + post-`supabase db push` verification |
| **`feedback_strict_grep_registry_pattern`** | One script + one job in the existing workflow; no parallel workflow file. | registry-pattern compliance in PR diff |

### New Invariants Established

| ID | Description | Enforcement | Verification |
|---|---|---|---|
| **I-PROPOSED-AD** — `RN-FILE-UPLOAD-VIA-EXPO-FILE-SYSTEM` | Every React Native picker-driven storage upload in `mingla-business/app/**` and `mingla-business/src/services/**` must read bytes via `expo-file-system` (`new File(uri).arrayBuffer()` or equivalent). `fetch(asset.uri).blob()` is forbidden for picker assets. | Strict-grep CI gate `orch-0786-creator-avatar-upload-integrity.mjs` + the codified memory rule promoted from D-ORCH-0786-FOR-5. | CI fail on regression; Jest spec asserts the reader uses `expo-file-system` (import-shape assertion) |
| **I-PROPOSED-AE** — `STORAGE-URL-PERSISTED-WITHOUT-CACHE-BUSTER` | URLs persisted into Postgres columns (`creator_accounts.avatar_url`, future avatar/cover columns added under this contract) must be canonical public URLs without a `?t=` / `?v=` / `?cb=` cache-bust query token. Cache-busting is a render-time concern only. | Strict-grep CI gate (assert `edit-profile.tsx` does not call `updateAccount({ avatar_url: photoUri })` where `photoUri` contains a cache-bust suffix). | CI fail on regression; Jest spec asserts persisted URL matches `^https://.+/storage/v1/object/public/creator_avatars/[a-f0-9-]+\.(jpe?g\|png\|webp)$` |
| **I-PROPOSED-AF** — `AVATAR-IMAGE-HAS-ONERROR-FALLBACK` | Every avatar `<Image>` in `mingla-business/app/account/**` must have an `onError` handler that flips to the initials fallback view. | Strict-grep CI gate (Babel-parsed AST assertion that `<Image …/>` inside `app/account/edit-profile.tsx` has `onError`). | CI fail on regression; component test mounts with bad URL and asserts initials render |

---

## 7. Database / RLS / Migration

### 7.1 New migration

Path: `supabase/migrations/20260511000001_orch_0786_creator_avatars_bucket.sql`
(If a later `20260511…` migration already lands before implementor commits, bump the trailing serial so this file is monotonic.)

This migration **must converge** on the live remote shape verified via MCP on 2026-05-11. It MUST be idempotent against the existing remote state (i.e. `supabase db push --linked` against production must succeed with no errors and no data changes).

```sql
-- ORCH-0786 — Re-add creator_avatars storage bucket + RLS policies to active migrations.
-- Bucket was created out-of-band on 2026-05-04 21:07 UTC during Cycle 14 J-A1 and
-- referenced in artifacts as 20260504_b1_phase5_creator_avatars.sql, but that file
-- never landed in supabase/migrations/. This migration re-establishes the source of
-- truth so any fresh environment (CI fixtures, dev reset, staging rebuild) recreates
-- the bucket + 4 policies in the exact shape that exists in production.
--
-- Idempotent: safe to re-apply against production where the bucket + policies
-- already exist.

-- 1. Bucket: insert only if absent
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'creator_avatars',
  'creator_avatars',
  true,
  10485760, -- 10 MB
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. RLS policies on storage.objects (drop-then-create for idempotency)

DROP POLICY IF EXISTS "Anyone can read creator avatars" ON storage.objects;
CREATE POLICY "Anyone can read creator avatars"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'creator_avatars');

DROP POLICY IF EXISTS "Creator can upload own avatar" ON storage.objects;
CREATE POLICY "Creator can upload own avatar"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'creator_avatars'
    AND split_part(name, '.', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "Creator can update own avatar" ON storage.objects;
CREATE POLICY "Creator can update own avatar"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'creator_avatars'
    AND split_part(name, '.', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "Creator can delete own avatar" ON storage.objects;
CREATE POLICY "Creator can delete own avatar"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'creator_avatars'
    AND split_part(name, '.', 1) = auth.uid()::text
  );

-- DO NOT add COMMENT ON POLICY ... ON storage.objects — storage.objects ownership
-- is reserved for supabase_storage_admin and decorative comments are rejected at
-- migration time (the same hotfix Cycle 14 had to apply to the original file).
```

### 7.2 RLS audit

- Read policy (`SELECT`, `public`) — matches existing remote. Required for the public `<Image>` fetch.
- Insert / Update / Delete policies (`authenticated`) — gated on `split_part(name,'.',1) = auth.uid()::text`. Path-scoped owner-only mutation.
- Bucket is `public = true` (matches remote). Object-level access is gated by the SELECT policy above; no anon writes.

No changes to `public.creator_accounts` RLS or table definition. The existing self-write UPDATE policy already permits `auth.uid() = id`.

### 7.3 Deployment gate

The implementor MUST NOT run `supabase db push --linked`. The orchestrator (Codex `orchestrator-mingla`) owns migration deploy per `feedback_orchestrator_deploys_edge_functions`. Implementor writes the file and leaves it staged.

---

## 8. Edge Functions / RPCs / Webhooks

None.

This spec does not touch any edge function. All work is client-side (mingla-business RN/web) + one new migration + the strict-grep CI gate.

---

## 9. Service Layer

### 9.1 `mingla-business/src/utils/creatorAvatarRules.ts` (NEW)

Pure utility module; no Supabase imports. Models the `eventCoverMediaRules.ts` shape but tighter (image-only, smaller cap).

```typescript
export const CREATOR_AVATAR_MAX_BYTES = 10 * 1024 * 1024; // 10 MB — matches bucket file_size_limit

export const CREATOR_AVATAR_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type CreatorAvatarMimeType =
  (typeof CREATOR_AVATAR_ALLOWED_MIME_TYPES)[number];

export type CreatorAvatarErrorCode =
  | "permission_denied"
  | "unsupported_type"
  | "file_too_large"
  | "empty_local_file"
  | "upload_failed"
  | "display_failed";

export class CreatorAvatarError extends Error {
  code: CreatorAvatarErrorCode;
  constructor(code: CreatorAvatarErrorCode, message: string) {
    super(message);
    this.name = "CreatorAvatarError";
    this.code = code;
  }
}

export interface CreatorAvatarAssetInput {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
}

/**
 * Maps file extension or picker MIME to a bucket-allowed MIME type.
 * Critically, maps the non-IANA "image/jpg" alias to "image/jpeg".
 * Returns null if neither MIME nor extension yields a bucket-whitelisted type.
 */
export const resolveCreatorAvatarContentType = (
  input: CreatorAvatarAssetInput,
): CreatorAvatarMimeType | null => { /* impl */ };

/**
 * Resolves the storage path: `{userId}.{ext}` (extension matches resolved MIME).
 * NOTE: this preserves the existing Cycle 14 path scheme so the
 * `split_part(name,'.',1) = auth.uid()::text` RLS policy still matches.
 */
export const creatorAvatarStoragePath = (
  userId: string,
  contentType: CreatorAvatarMimeType,
): string => { /* impl */ };

/**
 * Verifies the public Supabase Storage URL serves at least one byte.
 * Mirrors verifyEventCoverPublicUrl: HEAD first; on 405/501 falls back to
 * GET Range: bytes=0-0; rejects content-length: 0.
 * Throws CreatorAvatarError("upload_failed", ...) on verification failure.
 */
export const verifyCreatorAvatarPublicUrl = async (
  publicUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> => { /* impl */ };
```

**Error contract:** every public function either returns its declared type or throws a `CreatorAvatarError`. No silent failures.

### 9.2 `mingla-business/src/services/creatorAvatarFileReader.ts` (NEW)

Mirrors `eventCoverFileReader.ts` shape. Sole purpose: read picker asset bytes via `expo-file-system`, never via `fetch().blob()`.

```typescript
import { File } from "expo-file-system";
import { CreatorAvatarError } from "../utils/creatorAvatarRules";

export interface CreatorAvatarFileBytes {
  bytes: Uint8Array;
  byteLength: number;
}

export const readCreatorAvatarFileBytes = async (
  uri: string,
): Promise<CreatorAvatarFileBytes> => {
  try {
    const buffer = await new File(uri).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    return { bytes, byteLength: bytes.byteLength };
  } catch {
    throw new CreatorAvatarError(
      "upload_failed",
      "We couldn't read that photo. Try another.",
    );
  }
};
```

**Error contract:** throws `CreatorAvatarError("upload_failed", …)` on any read error.

### 9.3 `mingla-business/src/services/creatorAvatarService.ts` (NEW)

Orchestrates: read bytes → reject empty → resolve MIME → upload → verify public URL → return canonical public URL.

```typescript
import { supabase } from "./supabase";
import {
  CREATOR_AVATAR_MAX_BYTES,
  CreatorAvatarError,
  creatorAvatarStoragePath,
  resolveCreatorAvatarContentType,
  verifyCreatorAvatarPublicUrl,
  type CreatorAvatarAssetInput,
} from "../utils/creatorAvatarRules";
import { readCreatorAvatarFileBytes } from "./creatorAvatarFileReader";

export const CREATOR_AVATARS_BUCKET = "creator_avatars";

export interface CreatorAvatarUploadResult {
  publicUrl: string;       // canonical — no ?t= suffix
  storagePath: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
}

export const uploadCreatorAvatar = async (
  userId: string,
  input: CreatorAvatarAssetInput,
): Promise<CreatorAvatarUploadResult> => {
  // 1. MIME resolution (reject up-front if unsupported)
  const contentType = resolveCreatorAvatarContentType(input);
  if (contentType === null) {
    throw new CreatorAvatarError(
      "unsupported_type",
      "Choose a JPEG, PNG, or WebP image.",
    );
  }

  // 2. Byte read via expo-file-system (NEVER fetch().blob())
  const { bytes, byteLength } = await readCreatorAvatarFileBytes(input.uri);

  // 3. Empty-bytes guard
  if (byteLength <= 0) {
    throw new CreatorAvatarError(
      "empty_local_file",
      "We couldn't read that photo. Try another.",
    );
  }

  // 4. Size guard
  if (byteLength > CREATOR_AVATAR_MAX_BYTES) {
    throw new CreatorAvatarError(
      "file_too_large",
      "Pick a photo under 10 MB.",
    );
  }

  // 5. Upload (upsert) — Supabase JS accepts ArrayBuffer/Uint8Array directly
  const path = creatorAvatarStoragePath(userId, contentType);
  const { error: uploadError } = await supabase.storage
    .from(CREATOR_AVATARS_BUCKET)
    .upload(path, bytes, { upsert: true, contentType });
  if (uploadError) {
    throw new CreatorAvatarError(
      "upload_failed",
      "Couldn't upload photo. Tap to try again.",
    );
  }

  // 6. Resolve canonical public URL (NO cache-bust token)
  const { data: publicUrlData } = supabase.storage
    .from(CREATOR_AVATARS_BUCKET)
    .getPublicUrl(path);
  const publicUrl = publicUrlData.publicUrl;

  // 7. Verify public object is non-empty
  await verifyCreatorAvatarPublicUrl(publicUrl);

  return { publicUrl, storagePath: path, contentType };
};
```

**Error contract:** all error paths throw `CreatorAvatarError` with a user-readable `message`. Caller decides toast copy by mapping `error.code` → string (centralised in the component handler).

**No silent fallbacks.** No `?? ""`. No `try/catch (e) {}`. Constitution #3.

### 9.4 `mingla-business/src/services/creatorAccount.ts` (UNCHANGED)

No changes. The existing `updateCreatorAccount(userId, patch)` continues to write `display_name` + `avatar_url` via existing self-write RLS. The component will pass a canonical URL (no cache-bust) into `avatar_url`.

---

## 10. Hook Layer

### 10.1 `mingla-business/src/hooks/useCreatorAccount.ts` (UNCHANGED)

No changes. The hook contract — `useCreatorAccount()` for hydration, `useUpdateCreatorAccount()` for save — remains exactly as it is. The mutation already invalidates the right query key on success.

**Reasoning:** The bug is entirely in the picker → upload → render chain inside the component, plus a missing migration. Hook ownership and cache invalidation are correct.

---

## 11. Component Layer

### 11.1 `mingla-business/app/account/edit-profile.tsx` (MOD)

Replace the body of `handlePickPhoto` (lines 133-183) and the avatar JSX (lines 299-315) per below. Everything else (permission gate, save handler, chrome, name field, email field, delete CTA, toast wiring, ConfirmDialog) stays as-is.

#### 11.1.1 Imports to add

```typescript
import {
  CreatorAvatarError,
  type CreatorAvatarErrorCode,
} from "../../src/utils/creatorAvatarRules";
import { uploadCreatorAvatar } from "../../src/services/creatorAvatarService";
```

(Drop the `supabase` import from this file once `handlePickPhoto` no longer calls it — but only if no other line in the file uses `supabase`. If anything else uses it, leave the import.)

#### 11.1.2 `handlePickPhoto` (replacement)

```typescript
const handlePickPhoto = useCallback(async (): Promise<void> => {
  if (user === null) return;
  const granted = await photoGate.requestWithFallback();
  if (!granted) {
    if (!photoGate.settingsDialogVisible) {
      showToast("Photo permission required.");
    }
    return;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  });
  if (result.canceled || result.assets.length === 0) return;
  const asset = result.assets[0];
  setUploadingPhoto(true);
  try {
    const { publicUrl } = await uploadCreatorAvatar(user.id, {
      uri: asset.uri,
      mimeType: asset.mimeType ?? null,
      fileName: asset.fileName ?? null,
      fileSize: asset.fileSize ?? null,
    });
    // Persist the canonical URL — NO cache-bust token in DB state.
    setPhotoUri(publicUrl);
    // Render-side cache-bust handled by avatarImageSource (below).
    setAvatarRenderToken(Date.now());
  } catch (err) {
    if (err instanceof CreatorAvatarError) {
      showToast(err.message);
    } else {
      showToast("Couldn't upload photo. Tap to try again.");
    }
  } finally {
    setUploadingPhoto(false);
  }
}, [user, photoGate, showToast]);
```

#### 11.1.3 Render-time cache-bust (new local state)

Add alongside the existing component state declarations:

```typescript
// Render-only cache-bust token. Bumped after upload + on onError retry.
// NEVER persisted into avatar_url.
const [avatarRenderToken, setAvatarRenderToken] = useState<number | null>(null);
const [avatarLoadFailed, setAvatarLoadFailed] = useState<boolean>(false);

const avatarImageSource = useMemo<{ uri: string } | null>(() => {
  if (photoUri === null || photoUri.length === 0) return null;
  return {
    uri:
      avatarRenderToken === null
        ? photoUri
        : `${photoUri}${photoUri.includes("?") ? "&" : "?"}t=${avatarRenderToken}`,
  };
}, [photoUri, avatarRenderToken]);
```

Also reset `avatarLoadFailed` to `false` whenever `photoUri` changes:

```typescript
useEffect(() => {
  setAvatarLoadFailed(false);
}, [photoUri]);
```

#### 11.1.4 Avatar JSX (replacement for lines 299-315)

```tsx
{avatarImageSource !== null && !avatarLoadFailed ? (
  <Image
    source={avatarImageSource}
    style={styles.avatarImage}
    onError={() => {
      setAvatarLoadFailed(true);
      showToast("Couldn't show your photo. Tap the avatar to retry.");
    }}
    accessibilityIgnoresInvertColors
  />
) : (
  <View style={styles.avatarFallback}>
    <Text style={styles.avatarInitials}>{initials}</Text>
  </View>
)}
```

#### 11.1.5 Save (`handleSave`) — UNCHANGED in logic

`handleSave` still calls `updateAccount({ display_name: trimmedName, avatar_url: photoUri })`. Because `photoUri` is now the canonical URL (no `?t=` suffix), the persisted `avatar_url` is canonical.

#### 11.1.6 States table

| State | Condition | Renders |
|---|---|---|
| Loading | `isLoading` | spinner (unchanged) |
| Error | `isError` | EmptyState + Retry (unchanged) |
| No photo | `photoUri === null` OR `photoUri.length === 0` | Initials view inside avatar circle |
| Photo loading from server | `photoUri !== null && !avatarLoadFailed` | `<Image>` |
| Photo failed to render | `photoUri !== null && avatarLoadFailed` | Initials view + non-blocking Toast (`"Couldn't show your photo. Tap the avatar to retry."`) |
| Uploading | `uploadingPhoto === true` | Existing dark overlay + spinner |
| Saving | `updating === true` | "Saving…" CTA label (unchanged) |
| Bytes empty | thrown by `uploadCreatorAvatar` | Toast: `"We couldn't read that photo. Try another."` |
| Upload error | thrown by `uploadCreatorAvatar` | Toast: `"Couldn't upload photo. Tap to try again."` |
| Unsupported type | thrown by `uploadCreatorAvatar` | Toast: `"Choose a JPEG, PNG, or WebP image."` |
| File too large | thrown by `uploadCreatorAvatar` | Toast: `"Pick a photo under 10 MB."` |
| Verify failed | thrown by `uploadCreatorAvatar` | Toast: `"Couldn't upload photo. Tap to try again."` (display_failed maps to the same user-facing message) |

#### 11.1.7 Accessibility

- The avatar `<Pressable>` keeps its existing `accessibilityRole="button"` + `accessibilityLabel="Change profile photo"`.
- `<Image>` adds `accessibilityIgnoresInvertColors` so iOS smart-invert does not flip the photo.
- The initials fallback view is decorative; no `accessibilityLabel` change.
- Toasts use the existing Toast primitive (visual + accessibility behaviour unchanged).

#### 11.1.8 Haptics

No new haptics. Existing button haptics on Save remain unchanged.

#### 11.1.9 Pre-flight design step

Per `feedback_implementor_uses_ui_ux_pro_max`: the implementor MUST invoke `/ui-ux-pro-max` as a pre-flight step before editing `edit-profile.tsx`, framed as "minimal account edit screen — avatar with reliable upload, initials fallback on render failure, no scope creep". Apply guidance only to the avatar block; do not redesign other fields.

---

## 12. Realtime

None.

---

## 13. Tests

### 13.1 New Jest specs

#### `mingla-business/src/services/__tests__/creatorAvatarService.test.ts` (NEW)

| Test | Scenario | Setup | Expected |
|---|---|---|---|
| T-01 | Happy path | Mock `readCreatorAvatarFileBytes` → 100-byte JPEG bytes. Mock `supabase.storage.upload` → `{ error: null }`. Mock `getPublicUrl` → canonical URL. Mock `verifyCreatorAvatarPublicUrl` → resolves. | Returns `{ publicUrl, storagePath: '{userId}.jpg', contentType: 'image/jpeg' }`. `upload` called with `Uint8Array` (NOT a Blob). |
| T-02 | Empty local bytes rejected | Mock `readCreatorAvatarFileBytes` → `{ bytes, byteLength: 0 }`. | Throws `CreatorAvatarError` with `code: 'empty_local_file'` and message `"We couldn't read that photo. Try another."`. `supabase.storage.upload` NOT called. |
| T-03 | File too large rejected | Mock reader → 11 MB byteLength. | Throws `CreatorAvatarError` with `code: 'file_too_large'`. `upload` NOT called. |
| T-04 | Unsupported MIME rejected | Input `mimeType: 'image/heic'`, `fileName: 'pic.heic'`. | Throws `CreatorAvatarError` with `code: 'unsupported_type'`. `upload` NOT called. |
| T-05 | `'jpg'` extension yields `image/jpeg` (not `image/jpg`) | Input `mimeType: null`, `fileName: 'pic.jpg'`. Mock reader → valid bytes. | `upload` called with `contentType: 'image/jpeg'`. |
| T-06 | Public URL verify fails on 0-byte HEAD | Mock reader → valid bytes. Mock `upload` → success. Mock `verifyCreatorAvatarPublicUrl` → throws `CreatorAvatarError('upload_failed', …)`. | Throws `CreatorAvatarError` with `code: 'upload_failed'`. Caller (component) maps to upload-failed toast. |
| T-07 | Supabase upload error surfaces | Mock reader → valid bytes. Mock `upload` → `{ error: { message: 'whatever' } }`. | Throws `CreatorAvatarError` with `code: 'upload_failed'`. |
| T-08 | Canonical URL has no `?t=` suffix | Happy path (T-01). | `result.publicUrl` matches `/^https:\/\/.+\/storage\/v1\/object\/public\/creator_avatars\/[a-f0-9-]+\.(jpe?g\|png\|webp)$/`. |

#### `mingla-business/src/utils/__tests__/creatorAvatarRules.test.ts` (NEW)

| Test | Scenario | Expected |
|---|---|---|
| T-09 | `verifyCreatorAvatarPublicUrl` rejects `content-length: 0` | Mock `fetch` → `Response` with `content-length: 0`, `200 OK`. | Throws `CreatorAvatarError("upload_failed", …)`. |
| T-10 | `verifyCreatorAvatarPublicUrl` accepts `content-length: 1234` + `image/jpeg` | Mock `fetch` HEAD → OK with positive length. | Resolves. |
| T-11 | `verifyCreatorAvatarPublicUrl` falls back to `Range: bytes=0-0` GET when HEAD returns 405 | Mock HEAD → 405; mock GET range → `206` with positive content-range. | Resolves. |
| T-12 | `verifyCreatorAvatarPublicUrl` rejects when both HEAD and ranged GET show empty body | Mock HEAD → 405; ranged GET → `200`, `content-length: 0`. | Throws `CreatorAvatarError("upload_failed", …)`. |
| T-13 | `resolveCreatorAvatarContentType` maps `image/jpg` → `image/jpeg` | Input `mimeType: 'image/jpg'`. | Returns `'image/jpeg'`. |
| T-14 | `resolveCreatorAvatarContentType` returns null for unsupported MIME | Input `mimeType: 'image/heic'`. | Returns `null`. |

#### `mingla-business/src/services/__tests__/creatorAvatarFileReader.test.ts` (NEW)

| Test | Scenario | Expected |
|---|---|---|
| T-15 | Reader returns `byteLength` of underlying file | Mock `expo-file-system.File` so `arrayBuffer()` returns a 1024-byte buffer. | Returns `{ byteLength: 1024 }`. |
| T-16 | Reader throws on `expo-file-system` error | Mock `File` to throw. | Throws `CreatorAvatarError("upload_failed", "We couldn't read that photo. Try another.")`. |
| T-17 | Reader does NOT call `fetch` (no `fetch(uri).blob()` regression) | Spy on global `fetch`. | `fetch` was not called. |

#### `mingla-business/app/account/__tests__/edit-profile.avatar.test.tsx` (NEW — component layer)

| Test | Scenario | Expected |
|---|---|---|
| T-18 | `<Image>` `onError` flips to initials fallback | Render with `account.avatar_url = 'https://example/will-fail.jpg'`. Trigger `onError` on the `<Image>`. | Initials view (`<Text>{initials}</Text>`) rendered; Toast `"Couldn't show your photo. Tap the avatar to retry."` visible. |
| T-19 | Persisted `photoUri` is canonical (no `?t=` suffix) after successful upload | Mock `uploadCreatorAvatar` → canonical URL `https://…/{uid}.jpg`. Simulate user picking a photo. | Component state `photoUri` matches the regex from T-08. When `handleSave` is invoked, the `updateAccount` mutation receives `avatar_url` with NO `?t=` substring. |
| T-20 | Render-time cache-bust adds `?t=` only to `<Image>.source.uri`, never to persisted state | After T-19's success, inspect the `<Image>` `source` prop AND the saved mutation payload. | `<Image>.source.uri` includes `?t=<number>` (render hint). `updateAccount.avatar_url` does NOT include `?t=`. |
| T-21 | Empty-bytes toast text | Mock `uploadCreatorAvatar` → throws `CreatorAvatarError('empty_local_file', …)`. Simulate user picking a photo. | Toast `"We couldn't read that photo. Try another."` visible; `photoUri` unchanged. |

### 13.2 Strict-grep gate

`.github/scripts/strict-grep/orch-0786-creator-avatar-upload-integrity.mjs` (NEW) — Node.js, no runtime deps beyond `node:fs`, `node:path` (matches every existing gate). Babel parser is only required if the AST-shape assertion for `<Image onError>` is implemented as AST traversal; otherwise the gate may use regex string assertions following the `orch-0784-event-list-sales-summary-visibility.mjs` pattern.

Assertions (all must pass):

1. **Banned read-path** — `mingla-business/app/account/edit-profile.tsx` MUST NOT contain `fetch(asset.uri)` OR `fetch(asset.uri).blob()` OR a regex `/await\s+fetch\([^)]*asset\.uri[^)]*\)/`.
2. **Banned read-path (any file)** — `mingla-business/app/account/**` and `mingla-business/src/services/creator*` MUST NOT contain `/await\s+\(?\s*await\s+fetch\([^)]+\)\)?\.blob\(\s*\)/` (the generic broken-pattern signature).
3. **Required reader** — `mingla-business/src/services/creatorAvatarFileReader.ts` MUST exist and MUST `import { File } from "expo-file-system"` AND MUST export `readCreatorAvatarFileBytes`.
4. **Required service** — `mingla-business/src/services/creatorAvatarService.ts` MUST exist and MUST `import { readCreatorAvatarFileBytes }` AND export `uploadCreatorAvatar`.
5. **Required rules helper** — `mingla-business/src/utils/creatorAvatarRules.ts` MUST exist and MUST export `verifyCreatorAvatarPublicUrl`, `resolveCreatorAvatarContentType`, `CreatorAvatarError`, `CREATOR_AVATAR_MAX_BYTES`.
6. **Avatar Image has onError** — `mingla-business/app/account/edit-profile.tsx` MUST contain a substring matching `onError={`. (Regex assertion is acceptable; AST assertion is the upgrade path.)
7. **No persisted cache-bust** — `mingla-business/app/account/edit-profile.tsx` MUST NOT contain a literal `setPhotoUri(\`${...}?t=${...}\`)` or any pattern matching `updateAccount\(\{[^}]*avatar_url:\s*\`[^`]*\?t=`. The acceptable shape is `setPhotoUri(publicUrl)` where `publicUrl` is the canonical URL.
8. **Migration present** — `supabase/migrations/` MUST contain a file matching `^[0-9]{14}_orch_0786_creator_avatars_bucket\.sql$` and that file MUST contain the literal strings `creator_avatars`, `auth.uid()::text`, `ON CONFLICT (id) DO UPDATE`, and `DROP POLICY IF EXISTS`.
9. **Migration MIME shape** — the new migration MUST contain `ARRAY['image/jpeg','image/png','image/webp']` (single-quoted, no `image/jpg`).
10. **package.json script wired** — `mingla-business/package.json` `scripts["test:orch-0786"]` MUST chain the strict-grep gate and the four Jest specs (`creatorAvatarService.test`, `creatorAvatarRules.test`, `creatorAvatarFileReader.test`, `edit-profile.avatar.test`).

Workflow registration in `.github/workflows/strict-grep-mingla-business.yml`:
- Append one job entry `orch-0786-creator-avatar-upload-integrity` after `orch-0784-event-list-sales-summary-visibility`, copying that job's shape (`actions/checkout@v4` + `actions/setup-node@v4` Node 20 + run `node .github/scripts/strict-grep/orch-0786-creator-avatar-upload-integrity.mjs`).
- Add the gate ID to the comment registry block at the top of the workflow.

### 13.3 Required-test bar before TEST mode hands off PASS

- `npm run test:orch-0786` → PASS (gate + 4 Jest specs).
- `npx tsc --noEmit` in `mingla-business/` → no NEW errors (existing D-CYCLE12-IMPL-1 / D-CYCLE12-IMPL-2 carry-forward errors are acceptable per Cycle 16a §2; any new error is a P0).
- iOS Simulator runtime gate (operator-assisted; TEST mode): change avatar → photo renders → reopen → photo persists → MCP read-only `SELECT (metadata->>'size')::bigint FROM storage.objects WHERE bucket_id='creator_avatars' AND name LIKE '{operator.id}.%'` returns `> 0`.
- Android emulator parity gate.
- Web parity gate (`expo start --web`).
- Migration dry-run gate: orchestrator runs `supabase db push --linked` and reports zero errors / zero unintended diffs against production state.

---

## 14. Implementation Order

Sequential, one step at a time per `feedback_sequential_one_step_at_a_time`. Do **not** parallelise. After each step the implementor commits locally (or stages clean) and runs `npx tsc --noEmit` from `mingla-business/`. Operator approval is required before pushing to `Seth`.

1. **Pre-flight design step** — invoke `/ui-ux-pro-max` with query `"minimal account edit screen avatar reliable upload initials fallback minimalism trust"`. Document the applied guidance in the implementation report. Do not edit any other component.
2. **Author the SQL migration** — `supabase/migrations/20260511000001_orch_0786_creator_avatars_bucket.sql` matching §7.1 byte-for-byte. Do NOT run `supabase db push`.
3. **Author `creatorAvatarRules.ts`** — pure-utility module per §9.1. Run `npx tsc --noEmit`.
4. **Author `creatorAvatarFileReader.ts`** — per §9.2. Run `npx tsc --noEmit`.
5. **Author `creatorAvatarService.ts`** — per §9.3. Run `npx tsc --noEmit`.
6. **Author the 4 Jest spec files** — `creatorAvatarRules.test.ts`, `creatorAvatarFileReader.test.ts`, `creatorAvatarService.test.ts`, `edit-profile.avatar.test.tsx` per §13.1. Confirm each spec FAILs against the current `edit-profile.tsx` (so we know the spec is real). Then proceed.
7. **Edit `edit-profile.tsx`** — replace `handlePickPhoto` per §11.1.2, add render-time cache-bust state per §11.1.3, replace the avatar JSX per §11.1.4. No other changes to the file. Run `npx tsc --noEmit`.
8. **Author the strict-grep gate** — `.github/scripts/strict-grep/orch-0786-creator-avatar-upload-integrity.mjs` per §13.2. Run it from the repo root and confirm all 10 assertions PASS.
9. **Register the gate in the workflow** — append the job entry to `.github/workflows/strict-grep-mingla-business.yml` per §13.2.
10. **Wire `test:orch-0786` in `package.json`** — chain the strict-grep gate and the 4 Jest specs.
11. **Run `npm run test:orch-0786` from `mingla-business/`** — must PASS.
12. **Run `npx tsc --noEmit` from `mingla-business/`** — no NEW errors.
13. **Write the implementation report** — `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0786_BUSINESS_PROFILE_AVATAR_BLACK_AFTER_CHANGE.md` with old→new receipts, SC verification matrix, T-G assertions, and memory-rule deference proof. Cite §17 of this spec for handoff direction.

Database first (step 2) per the spec-template ordering — even though the implementor does not push, the migration must exist before service/component code so the schema source-of-truth lands in the same change.

---

## 15. Regression Prevention

- **Structural safeguard:** New invariant **I-PROPOSED-AD** (`RN-FILE-UPLOAD-VIA-EXPO-FILE-SYSTEM`) is enforced via CI strict-grep gate. Any future picker-driven upload that resurrects `fetch(uri).blob()` fails the PR build before merge.
- **Test:** `creatorAvatarFileReader.test.ts:T-17` spies on global `fetch` and asserts it is not called by the reader. `creatorAvatarService.test.ts:T-02` asserts `supabase.storage.upload` is not called when bytes are empty.
- **Memory rule:** Promote D-ORCH-0786-FOR-5 to a top-level feedback memory: *"RN file upload pattern — always use `expo-file-system` (`new File(uri).arrayBuffer()`), never `fetch(uri).blob()`. The polyfill silently returns size-0 blobs on iOS. Established after ORCH-0766B (event covers) and ORCH-0786 (creator avatars)."* The orchestrator handles memory rule registration at CLOSE.
- **Protective comments:** Add a short single-line comment above the empty-bytes guard in `creatorAvatarService.ts`: `// ORCH-0786 — fetch(uri).blob() silently returns size-0 on RN iOS. expo-file-system is mandatory.` No multi-line block.
- **Backfill posture:** Do NOT add any one-off cleanup code in product. The 2 known 0-byte objects in production (operator's two avatar files) will be overwritten the next time the operator picks a photo on the fixed build. The orchestrator may optionally issue a one-off MCP delete during CLOSE, but it is not required.

---

## 16. Common Mistakes (specific to this implementation)

1. **Using `fetch(asset.uri).blob()` "but wrapped in try/catch"** — does not fix anything. The bug is silent success: `.blob()` returns `{ size: 0 }` with `response.ok === true`. Don't try/catch around it. Replace it.
2. **Passing a `Blob` (not `Uint8Array`/`ArrayBuffer`) to `supabase.storage.upload`** — Supabase JS accepts both, but on React Native a Blob constructed from polyfilled `fetch` is the source of the zero-byte bug. Pass the `Uint8Array` returned by `readCreatorAvatarFileBytes` directly. Do not wrap it in `new Blob([bytes])` — that re-introduces the polyfill surface area.
3. **Persisting `?t=${Date.now()}` into `avatar_url`** — the cache-bust is a render hint, not a storage value. Persist canonical URL. Apply `?t=` only via `useMemo` on the component side. Avoid the temptation to "make it work for one user" by stamping a token into the DB.
4. **Skipping the post-upload verify** — without HEAD/Range verification, a future regression that re-introduces a zero-byte payload (e.g. someone reverts the reader to a Blob path) would slip through. The verify is belt-and-braces.
5. **Forgetting `onError` on the `<Image>`** — the strict-grep gate will flag it, but more importantly, this is the difference between "I can see what went wrong" and "I see a black hole".
6. **Adding `image/gif` to the bucket whitelist** — out of scope. The remote bucket explicitly does NOT allow GIFs. Do not expand it. Animated avatars are a future product decision.
7. **Running `supabase db push --linked`** — the implementor never deploys migrations. Operator/orchestrator owns deploy gate.
8. **Editing `useCreatorAccount.ts` or `creatorAccount.ts`** — they are correct. Stay out.
9. **Touching any non-avatar code in `edit-profile.tsx`** — name field, email field, save handler, delete CTA, ConfirmDialog, permission gate all stay as-is.
10. **Decorative `COMMENT ON POLICY ... ON storage.objects`** — Cycle 14 already learned that Postgres rejects these because `storage.objects` ownership is reserved for `supabase_storage_admin`. The §7.1 migration does NOT include any `COMMENT ON POLICY` line.
11. **Inventing a new path scheme** — keep `{user.id}.{ext}` so the existing RLS `split_part(name,'.',1) = auth.uid()::text` still matches. If a different scheme is desired in a future ORCH, it requires both code AND migration changes; not in scope here.

---

## 17. Rollback Safety

- **Database:** the new migration is purely additive (insert bucket if absent, drop+recreate policies). On a fresh database it creates the bucket; on production it converges on the existing state. Rolling back the migration file removes future provisioning but leaves the live bucket intact — no data loss. There is no UNDO statement; that is acceptable because the migration is idempotent.
- **Code:** the component change is locally scoped to `handlePickPhoto` + the avatar JSX block. The three new files (`creatorAvatarFileReader.ts`, `creatorAvatarService.ts`, `creatorAvatarRules.ts`) are net-new — reverting their introduction also reverts the component to the broken state, but no other consumer depends on them.
- **Risk of partial revert:** if the component change is reverted but the new files remain, no harm — they are unused. If the new files are reverted but the component still imports them, TypeScript fails at build time — caught by `npx tsc --noEmit`.
- **Risk of partial deploy:** if the new migration is NOT applied to production but the new code IS shipped, the code still works (the bucket already exists remotely). The migration is purely a source-of-truth restoration; it does not change runtime behaviour. So OTA-shipping the code-only fix is safe ahead of `supabase db push`.

---

## 18. Cross-References

- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0786_BUSINESS_PROFILE_AVATAR_BLACK_AFTER_CHANGE.md`
- **Operator evidence:** `/Users/sethogieva/Desktop/Simulator Screenshot - iPhone 17 Pro - 2026-05-11 at 04.47.20.png`
- **Proven-working pattern (template):** `mingla-business/src/services/eventCoverMediaService.ts`, `mingla-business/src/services/eventCoverFileReader.ts`, `mingla-business/src/utils/eventCoverMediaRules.ts` (especially `verifyEventCoverPublicUrl`)
- **Identical root-cause-class history:** `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0766B_ZERO_BYTE_EVENT_COVER_UPLOAD.md`
- **Strict-grep registry pattern:** `feedback_strict_grep_registry_pattern` memory rule; `.github/scripts/strict-grep/README.md`; example `orch-0784-event-list-sales-summary-visibility.mjs`
- **Migration deploy ownership:** `feedback_orchestrator_deploys_edge_functions` memory rule
- **UI/UX pre-flight rule:** `feedback_implementor_uses_ui_ux_pro_max`
- **No-Co-Authored-By rule:** `feedback_no_coauthored_by` (applies to the orchestrator's commit message at CLOSE)

---

## 19. Handoff to Implementor

Build it in the §14 order. Database migration file first, then `creatorAvatarRules.ts`, then the reader, then the service, then the Jest specs (confirm-they-FAIL pre-fix), then the component edit, then the strict-grep gate, then the workflow + package.json wiring. Use the proven `eventCoverFileReader.ts` / `verifyEventCoverPublicUrl` shape — do not invent a new file-bytes or verify pattern. Stay strictly inside the avatar picker / upload / render / migration / CI surface — no event cover, brand, ticket, app-mobile, or admin work, and absolutely no `fetch(asset.uri).blob()` anywhere in the diff. Do not run `supabase db push --linked`; the orchestrator owns migration deploy at CLOSE. Output the implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0786_BUSINESS_PROFILE_AVATAR_BLACK_AFTER_CHANGE.md` with old→new receipts mapping to every §5 success criterion, every §13.2 strict-grep assertion, and every §15 regression-prevention item.
