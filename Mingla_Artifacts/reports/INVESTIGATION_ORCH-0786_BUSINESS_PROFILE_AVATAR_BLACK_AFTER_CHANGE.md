# INVESTIGATION ORCH-0786 — Business Profile Avatar Renders Black After Change

> Date: 2026-05-11
> Mode: Claude `mingla-forensics` — INVESTIGATE
> Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
> Dispatch: `Mingla_Artifacts/prompts/FORENSICS_ORCH-0786_BUSINESS_PROFILE_AVATAR_BLACK_AFTER_CHANGE.md`
> Confidence: HIGH — `root cause proven` (6-field evidence + remote DB read-only proof)
> Lifecycle recommendation: **SPEC NEXT**

---

## 1. Layman summary

When an organiser changes their Mingla Business account profile picture, the new picture appears as a black circle instead of the chosen photo. This is **not** a render bug, a permission bug, or a missing-bucket bug — the upload completes "successfully" but writes a **zero-byte file** to Supabase Storage. The black circle is the dark background of the empty avatar tile bleeding through after iOS fails to decode an empty image.

We proved this against the live database. Both avatar files belonging to the operator (sethogieva@gmail.com, account id `b17e3e15-218d-475b-8c80-32d4948d6905`) are 0 bytes in the `creator_avatars` Storage bucket. The most recent one was last touched `2026-05-11 08:47:17 UTC` — the same minute as the operator's screenshot (`04:47` local on iPhone 17 Pro).

The cause is `mingla-business/app/account/edit-profile.tsx:164-165` — it reads the picker asset using `await fetch(asset.uri).blob()`. On iOS React Native this commonly produces a Blob with `size === 0` because of the polyfill realm mismatch (the same class of bug the team already fixed for event covers in ORCH-0766B). Supabase Storage cheerfully accepts the empty blob, returns HTTP 200, the app stamps the cache-busted public URL onto `creator_accounts.avatar_url`, and iOS later refuses to decode a 0-byte image — so the avatar circle stays black with no fallback.

The fix path is bounded and well-trodden: switch the avatar upload to the proven `readEventCoverFileBytes` pattern (`expo-file-system` `new File(uri).arrayBuffer()`), reject empty local bytes before calling Supabase, add an `onError`/initials fallback on the avatar `<Image>`, stop persisting the cache-bust `?t=…` token into the DB, and add the missing `20260504_b1_phase5_creator_avatars.sql` migration back to the active folder so fresh environments can recreate the bucket. Same blast radius as Cycle 14 J-A1; no event-cover / provider-picker / ticket-media work in scope.

---

## 2. Symptom summary

| Field | Value |
|---|---|
| Surface | `mingla-business` → Account tab → Edit profile |
| Trigger | Tap avatar → ImagePicker → pick a photo → return to Edit profile |
| Expected | New picture renders inside the orange-ring avatar circle, persists across reload, syncs back from DB |
| Actual | Avatar circle renders as a dark/black fill; no initials fallback; no error toast; "Edit" badge still visible |
| Reproduction | Confirmed on operator iPhone 17 Pro Simulator, 2026-05-11 04:47 local (08:47 UTC) |
| Persisted state | `creator_accounts.avatar_url` is a valid-looking URL ending in `?t=1778489182992`; the public URL serves a 0-byte body |
| Started | Cycle 14 J-A1 ship (2026-05-04). ORCH-0766 flagged the storage-proof gap on 2026-05-09 but did not investigate the upload payload. |

Operator quote (2026-05-11): *"when i change the acount profile picture, it just shows black"*.

---

## 3. Investigation manifest (every file read, in trace order)

| # | File | Layer | Purpose |
|---|---|---|---|
| 1 | `Mingla_Artifacts/prompts/FORENSICS_ORCH-0786_BUSINESS_PROFILE_AVATAR_BLACK_AFTER_CHANGE.md` | dispatch | Symptom + scope guards |
| 2 | `/Users/sethogieva/Desktop/Simulator Screenshot - iPhone 17 Pro - 2026-05-11 at 04.47.20.png` | runtime | Visual confirmation of black avatar |
| 3 | `mingla-business/app/account/edit-profile.tsx` | component | Avatar picker + upload + render |
| 4 | `mingla-business/src/hooks/useCreatorAccount.ts` | hook | React Query read + update mutation |
| 5 | `mingla-business/src/services/creatorAccount.ts` | service | DB UPDATE wrapper |
| 6 | `mingla-business/src/services/eventCoverMediaService.ts` | service (control) | Proven-working upload pattern for comparison |
| 7 | `mingla-business/src/services/eventCoverFileReader.ts` | service (control) | `expo-file-system` `File.arrayBuffer()` pattern |
| 8 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0766_CUSTOM_MINGLA_UPLOAD_CURRENT_STATE.md` | history | F6 flagged storage-proof gap; pointed at this exact code |
| 9 | `Mingla_Artifacts/reports/REVIEW_ORCH-0766_CUSTOM_MINGLA_UPLOAD_CURRENT_STATE.md` | history | Orchestrator review accepted F6 as a deferred profile-avatar follow-on |
| 10 | `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0766B_ZERO_BYTE_EVENT_COVER_UPLOAD.md` | history | Identical root-cause class (zero-byte blob) and the fix template |
| 11 | `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_16A_QUICK_WINS_REPORT.md` | history | Cycle 16a touched the same `handlePickPhoto` for permission UX only — left upload payload unchanged |
| 12 | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` | schema | Authoritative baseline — verified `creator_accounts` table, NO `creator_avatars` bucket |
| 13 | `supabase/migrations/` (full chronological scan) | schema | Confirmed NO post-baseline migration creates `creator_avatars` |
| 14 | `Mingla_Artifacts/MASTER_BUG_LIST.md`, `WORLD_MAP.md` | history | Cycle 14 close referenced `20260504_b1_phase5_creator_avatars.sql` migration as deployed remotely but the file is no longer in active migrations |
| 15 | Live Supabase MCP read-only probes | remote schema + storage | Bucket existence, RLS policies, object byte sizes, operator's persisted `avatar_url` |
| 16 | `mingla-business/src/components/brand/PublicBrandPage.tsx`, `app/account/notifications.tsx`, `app/account/delete.tsx`, `src/services/brandsService.ts`, `src/store/notificationPrefsStore.ts`, `src/hooks/useCurrentBrandRole.ts`, `src/context/AuthContext.tsx` | code | Blast-radius map — verified avatar_url is **not** consumed anywhere outside edit-profile.tsx today |

---

## 4. Five-layer cross-check

| Layer | Finding | Source of truth |
|---|---|---|
| **Docs** | Cycle 14 SPEC §1.5 SPEC-pivot says profile photo uploads to a NEW `creator_avatars` bucket with path-scoped RLS `split_part(name,'.',1) = auth.uid()::text`. WORLD_MAP.md and MASTER_BUG_LIST.md record `20260504_b1_phase5_creator_avatars.sql` as deployed. | `WORLD_MAP.md:213`, `MASTER_BUG_LIST.md:287` |
| **Schema (intended/local)** | `20260505000000_baseline_squash_orch_0729.sql` defines `public.creator_accounts` (line 8020) with `avatar_url text` (line 8024) and RLS, but contains **no** `creator_avatars` bucket / storage policies. No later migration in `supabase/migrations/` creates them either. The pre-squash `20260504_b1_phase5_creator_avatars.sql` file is not present in the active migrations folder. | Repo file scan |
| **Schema (actual/remote)** | Bucket `creator_avatars` **exists** remotely (created `2026-05-04 21:07:16 UTC`, public, `file_size_limit=10485760`, MIME whitelist `image/jpeg, image/png, image/webp`). 4 RLS policies present on `storage.objects`: public SELECT + INSERT/UPDATE/DELETE gated by `split_part(name,'.',1) = auth.uid()::text`. | `SELECT … FROM storage.buckets`, `pg_policies` probe |
| **Code** | `edit-profile.tsx:164-171` reads picker asset with `const blob = await (await fetch(asset.uri)).blob();` then uploads with `supabase.storage.from('creator_avatars').upload(path, blob, { upsert: true, contentType: blob.type !== '' ? blob.type : `image/${validExt}` })`. No empty-blob guard. No post-upload byte verification. No `onError` on the `<Image>`. | `mingla-business/app/account/edit-profile.tsx:164-177` and `:299-305` |
| **Runtime (persisted data)** | Two objects exist for the operator in `creator_avatars`: `b17e3e15…6905.jpg` (last updated `2026-05-11 08:47:17 UTC`, `size = 0`, `mimetype = image/jpeg`) and `b17e3e15…6905.png` (`2026-05-08 06:01:24 UTC`, `size = 0`, `mimetype = image/png`). 2 of 2 objects in the bucket are zero-byte. `creator_accounts.avatar_url = https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/creator_avatars/b17e3e15-218d-475b-8c80-32d4948d6905.jpg?t=1778489182992`. For control: `event_covers` has 8+ healthy non-zero objects (~1–8 MB) — same operator, different uploader code path. | Read-only MCP SQL probes (results below) |

**Contradiction found.** Code claims "upload success" because `supabase.storage.upload()` returns no error. Storage claims success because RLS accepted a 0-byte INSERT. Render fails because iOS `<Image>` cannot decode an empty body and the empty `<Image>` overlays the dark glass-tint background with no `onError` fallback. The chain is silently broken end-to-end and surfaces only as a visual black circle.

### 4a. Raw remote evidence (read-only, redacted to public IDs)

```sql
-- Bucket presence
SELECT id, name, public, file_size_limit, allowed_mime_types, created_at
FROM storage.buckets
WHERE name = 'creator_avatars';
-- → { name: 'creator_avatars', public: true, file_size_limit: 10485760,
--     allowed_mime_types: ['image/jpeg','image/png','image/webp'],
--     created_at: '2026-05-04 21:07:16+00' }

-- Object byte sizes (proof of zero-byte upload)
SELECT name, metadata->>'mimetype' AS mimetype, (metadata->>'size')::bigint AS bytes, updated_at
FROM storage.objects
WHERE bucket_id = 'creator_avatars';
-- → b17e3e15-…6905.jpg | image/jpeg | 0 | 2026-05-11 08:47:17+00
--   b17e3e15-…6905.png | image/png  | 0 | 2026-05-08 06:01:24+00
-- (2 of 2 objects are 0 bytes; aggregate: total=2, zero_byte=2, healthy=0)

-- Persisted avatar_url on the operator's account row
SELECT id, email, avatar_url FROM public.creator_accounts WHERE email ILIKE '%sethogieva%';
-- → id=b17e3e15…6905, avatar_url='.../creator_avatars/b17e3e15…6905.jpg?t=1778489182992'

-- RLS policy shape (path-scoped owner gate)
-- "Anyone can read creator avatars"          SELECT/public      qual: bucket_id='creator_avatars'
-- "Creator can upload own avatar"            INSERT/authenticated  with_check: bucket_id='creator_avatars' AND split_part(name,'.',1)=auth.uid()::text
-- "Creator can update own avatar"            UPDATE/authenticated  same
-- "Creator can delete own avatar"            DELETE/authenticated  same
```

The bucket, policies, and table column are healthy. **The payload is empty.**

---

## 5. Findings (classified)

### 🔴 F1 — `fetch(asset.uri).blob()` on React Native silently yields a 0-byte Blob, producing the persisted zero-byte avatar that renders black

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/app/account/edit-profile.tsx:164-171` |
| **Exact code** | `const response = await fetch(asset.uri);`<br>`const blob = await response.blob();`<br>`const { error: uploadError } = await supabase.storage.from('creator_avatars').upload(path, blob, { upsert: true, contentType: blob.type !== '' ? blob.type : `image/${validExt}` });` |
| **What it does** | Reads the picker `file://…` asset via WHATWG `fetch` polyfill, materialises a Blob, hands it to Supabase Storage. In React Native (iOS Hermes + Expo SDK 51 image-picker), this polyfill chain commonly returns a Blob whose backing data is empty even though `response.ok` is true. Supabase Storage accepts a 0-byte body, the RLS path policy passes (path encodes the owner id), the public URL is constructed, and `setPhotoUri` writes a cache-busted version of it. |
| **What it should do** | Read the picker asset's actual bytes via `expo-file-system` (e.g. `new File(uri).arrayBuffer()` per the proven `readEventCoverFileBytes` pattern), reject empty/zero-byte buffers BEFORE calling `supabase.storage.upload`, optionally verify the public object's Content-Length after upload, and only then `setPhotoUri`. |
| **Causal chain** | 1) User picks photo → 2) `fetch(file://…).blob()` returns `{ size: 0, type: 'image/jpeg' }` → 3) `supabase.storage.upload(path, emptyBlob)` returns no error (RLS + bucket whitelist both pass for 0-byte INSERT) → 4) `getPublicUrl(path)` returns a valid URL → 5) `setPhotoUri(${url}?t=…)` updates state → 6) iOS `<Image>` requests URL → 7) CDN serves `Content-Length: 0` image → 8) RN image decoder fails silently → 9) `<Image>` collapses but the surrounding `avatarWrap` `backgroundColor: glass.tint.profileBase` (dark glass tile) shows through → 10) operator sees a black circle with the orange ring and the EDIT badge (the screenshot). |
| **Verification step** | Live remote probe (Section 4a) shows 2/2 objects in `creator_avatars` are exactly 0 bytes. The newer object's `updated_at` (`2026-05-11 08:47:17 UTC`) matches the operator's iPhone screenshot timestamp (`04:47` local Eastern = `08:47 UTC`). Control surface `event_covers` (which uses `readEventCoverFileBytes`) has healthy non-zero objects for the same operator. The diff between working and broken uploads is exactly the read path. |

**Classification:** 🔴 Root cause. Proven via remote read.

This is the **same root-cause class** as ORCH-0766B (zero-byte event cover upload), which the team has already proven and patched on the event-cover side. The avatar upload was not migrated to the new pattern because Cycle 16a J-X6 only refactored the permission UX (toast → ConfirmDialog) and explicitly did not touch the upload payload (`IMPLEMENTATION_BIZ_CYCLE_16A_QUICK_WINS_REPORT.md` §4.2).

---

### 🟠 F2 — Cache-bust token `?t=<Date.now()>` is persisted into `creator_accounts.avatar_url`, not just held in component state

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/app/account/edit-profile.tsx:177` and `:196-199` |
| **Exact code** | `setPhotoUri(\`${publicUrlData.publicUrl}?t=${Date.now()}\`);` → later → `await updateAccount({ display_name: trimmedName, avatar_url: photoUri });` |
| **What it does** | The cache-bust query parameter is a UI-side hint to defeat React Native `<Image>` caching when the underlying object name doesn't change. The code appends it to the URL and then writes that exact string into the database column via React Query mutation. We confirmed remotely: the persisted `avatar_url` for the operator literally is `…/creator_avatars/b17e3e15…6905.jpg?t=1778489182992`. |
| **What it should do** | Apply `?t=…` only at render time (e.g. when `<Image source={{ uri }}/>` mounts). Persist the canonical public URL **without** the cache-bust token. |
| **Causal chain** | When (today's bug aside) a healthy non-zero file lands at the same path again, every consumer that reads `avatar_url` will keep loading the OLD `?t=<old timestamp>` cached version because the DB string is frozen. Supabase's CDN front (`storage/v1/object/public/...`) honours the query string but the cache token never refreshes once persisted. Side-effects: stale avatars across sessions / shared surfaces; baked-in timestamps in any future analytics, share, or export pipeline; risk of leaking timing into public surfaces. |
| **Verification step** | The persisted value above contains `?t=1778489182992` (May 11, 2026 04:46:22 UTC + leap-ish offset — clearly `Date.now()` at upload). Future re-uploads will overwrite with a new `?t=` but only when the user navigates through edit-profile again; any non-edit consumer (e.g. a future brand-team avatar list, public surface, email template) would be pinned to the most recently saved token. |

**Classification:** 🟠 Contributing factor / Hidden flaw bridge. Not the cause of today's black circle (any string would render the same black circle once the bytes are 0), but materially worsens the post-fix experience and is in the same line of code as the root cause.

---

### 🟠 F3 — `<Image source={{ uri: photoUri }} />` has no `onError` fallback; render failure silently shows the dark `glass.tint.profileBase` background

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/app/account/edit-profile.tsx:299-315` (and the `avatarWrap` style at `:476-487`) |
| **Exact code** | `{photoUri !== null && photoUri.length > 0 ? (<Image source={{ uri: photoUri }} style={styles.avatarImage} />) : (<View style={styles.avatarFallback}><Text>{initials}</Text></View>)}` with `styles.avatarWrap.backgroundColor = glass.tint.profileBase`. |
| **What it does** | Whenever `photoUri` is non-null, the initials fallback view is unmounted and the `<Image>` is mounted unconditionally. If the image fails to decode (zero bytes, 404, network error, blocked CORS, etc.) the `<Image>` collapses to a transparent 100% × 100% box on top of the `glass.tint.profileBase` dark glass tile. The orange `accent.border` ring and the absolute-positioned EDIT badge remain visible — exactly what the screenshot shows. |
| **What it should do** | Use an `onError` handler that flips back to the initials fallback (or a tinted placeholder) when the image fails to decode, so a render failure is visible and recoverable instead of presenting a black, decoration-only avatar that the user thinks is "their photo, but corrupted". Optionally also `onLoad` to clear an internal "loading" flag. |
| **Causal chain** | After F1 stores a 0-byte object, `Image.source.uri` is non-empty → component renders `<Image>` → iOS `RCTImageView` cannot decode an empty body → no error surfaces to the user → only the dark tile remains. |
| **Verification step** | Screenshot (operator iPhone 17 Pro, 04:47 local) shows the orange `accent.border` ring + EDIT badge over a uniform dark fill; no initials are visible despite `display_name = "Seth Ogieva"` (initials "SO") being clearly derivable from the rendered NAME field below. This is consistent with `<Image>` mounted-but-failed, not the fallback path. |

**Classification:** 🟠 Contributing factor. Even with F1 fixed, the app should not silently render a broken image — it should fall back to initials. Today it amplifies F1 into a UX dead end.

---

### 🟡 F4 — `20260504_b1_phase5_creator_avatars.sql` migration is missing from the local active migrations folder AND from the baseline squash

| Field | Evidence |
|---|---|
| **Files** | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` (no `creator_avatars` bucket / no avatar storage policies) and `supabase/migrations/2026050*` (none mention `creator_avatars`). |
| **Historical reference** | `Mingla_Artifacts/WORLD_MAP.md:213` and `Mingla_Artifacts/MASTER_BUG_LIST.md:287` both record `NEW migration 20260504_b1_phase5_creator_avatars.sql` deployed during Cycle 14. ORCH-0766 F6 (2026-05-09) noted the same gap and recommended "Forensics or implementor should either confirm `creator_avatars` exists remotely … or add a monotonic migration creating the bucket and RLS policies. Do not rely on manual dashboard state." |
| **What it does** | Today: nothing — the remote bucket is up (we verified) so production users hit a healthy bucket. The drift only bites in environments that rebuild from `supabase/migrations/` (`supabase db reset`, CI fixtures, fresh staging projects, or any developer's first local stack). |
| **What it should do** | The active migrations folder should contain a monotonic migration that creates the `creator_avatars` bucket and the 4 RLS policies, mirroring the live remote state (verified shape recorded in Section 4a). |
| **Causal chain (latent)** | A future `supabase db reset` or fresh-env bootstrap would: 1) apply baseline squash → `creator_accounts` healthy; 2) skip avatar storage → no bucket → avatar upload returns `Bucket not found` → entire J-A1 flow breaks. Combined with F1, the runtime symptom would shift from "0-byte saved silently" to "explicit error toast on every change", which the operator could surface but new contributors would chase the wrong root cause. |
| **Verification step** | We compared the baseline squash content against the live `storage.buckets` and `pg_policies` rows. The remote has policies the local migrations folder does not declare. |

**Classification:** 🟡 Hidden flaw. Not causing today's symptom (because the remote bucket exists from a one-time historical apply), but it's load-bearing on future deploys and on any clean reproduction. Should be re-added during the SPEC fix.

---

### 🟡 F5 — `contentType` fallback `image/${validExt}` can produce a MIME (`image/jpg`) outside the bucket's allowed list

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/app/account/edit-profile.tsx:158-171` |
| **Exact code** | `const validExt = […].includes(ext) ? (ext === 'jpeg' ? 'jpg' : ext) : 'jpg';` … `contentType: blob.type !== '' ? blob.type : \`image/${validExt}\``. |
| **What it does** | Normalises the file extension to `'jpg'|'png'|'webp'` (treating both `jpeg` and the default fallback as `jpg`). Then, only when `blob.type` is empty, falls back to `image/jpg`. |
| **What it should do** | `image/jpg` is not an IANA-registered MIME and is not in the `creator_avatars` `allowed_mime_types` list (`image/jpeg`, `image/png`, `image/webp`). The fallback should map `'jpg'` → `'image/jpeg'`. Today the bug is masked because `fetch().blob()` does populate `blob.type` with `'image/jpeg'` on iOS — but the moment we move to `expo-file-system` (Section 6, fix direction), `blob.type` will be `''` and this fallback path becomes live. |
| **Causal chain (latent)** | After F1's fix, if the file-system reader returns bytes without a MIME header, the code would attempt `contentType: 'image/jpg'` and Supabase Storage would reject the upload because `'image/jpg' ∉ allowed_mime_types`. The user would see an actual error toast — better than a silent black circle, but still wrong. |
| **Verification step** | Direct read of `storage.buckets.allowed_mime_types` confirms `['image/jpeg','image/png','image/webp']`. `image/jpg` is not on the list. |

**Classification:** 🟡 Hidden flaw. Triggered by the F1 fix unless addressed alongside.

---

### 🟡 F6 — No post-upload byte verification (no equivalent to `verifyEventCoverPublicUrl`)

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/app/account/edit-profile.tsx:166-177` — no byte-proof step exists between `upload` returning success and `setPhotoUri(publicUrl)` |
| **What it does** | Trusts Supabase's response. Even when (post-F1) the local bytes look healthy, there is no `HEAD` / `GET range` check on the public URL to confirm `Content-Length > 0` before persistence. ORCH-0766B added exactly this gate to event-cover uploads. |
| **What it should do** | Mirror the `verifyEventCoverPublicUrl` pattern from `mingla-business/src/utils/eventCoverMediaRules.ts` (`HEAD` first, fall back to bounded `GET Range: bytes=0-0`, reject `content-length: 0`). |
| **Causal chain (latent)** | A future regression in the file reader could re-introduce zero bytes; without a byte-proof gate the same silent black-circle bug returns. |
| **Verification step** | `IMPLEMENTATION_REWORK_ORCH-0766B_ZERO_BYTE_EVENT_COVER_UPLOAD.md` documents the verifier shape and why it exists. |

**Classification:** 🟡 Hidden flaw. Belt-and-braces for the avatar upload, matching the regression-prevention bar already set for event covers.

---

### 🔵 F7 — Account tab does not render the avatar today

| Field | Evidence |
|---|---|
| **Files** | `mingla-business/app/(tabs)/account.tsx` (no `avatar_url` reference); grep across `mingla-business/src/components/**` and `mingla-business/app/**` shows `avatar_url`/`avatarUrl` referenced **only** in `app/account/edit-profile.tsx` (read at line 81, write at line 198) and the `useCreatorAccount` hook + service typings. |
| **Why this matters** | The black circle is currently only visible in the Edit Profile screen itself. The Account tab top-of-screen does not render the avatar, and no public Mingla Business surface re-uses `creator_accounts.avatar_url` (the public-brand surfaces read brand-side imagery via the `business_public_brand_profile_view`, not creator-side avatars). The blast radius of today's symptom is **local to Edit Profile**. |
| **Implication** | The spec can be tightly scoped to the upload + render path in `edit-profile.tsx` without worrying about cascading consumers. Future cycles that introduce avatar display on Account tab / Brand team list / public profile must inherit the same render-error fallback (F3) and persisted-URL hygiene (F2). |

**Classification:** 🔵 Observation. Bounds the blast radius and confirms the fix scope.

---

## 6. Blast radius map

| Surface | Reads `avatar_url`? | Today's impact | Post-fix consideration |
|---|---|---|---|
| `mingla-business/app/account/edit-profile.tsx` (Edit Profile screen) | Yes (`account.avatar_url` → `setPhotoUri`) | Black circle (this bug) | Primary fix site |
| `mingla-business/app/(tabs)/account.tsx` (Account tab) | No | None | No regression risk |
| `mingla-business` brand surfaces (`PublicBrandPage.tsx`, `BrandEditView.tsx`, brand team, brand profile) | No (use brand-side `profile_photo_url` / `cover_media_*`) | None | None |
| `mingla-business` checkout / order / public event (`PublicEventPage.tsx`, `EventListCard.tsx`, etc.) | No | None | None |
| `mingla-admin` | No reference to `creator_accounts.avatar_url` in admin queries (admin reads `creator_accounts` for moderation but does not render the avatar field) | None | None |
| `app-mobile` (consumer app) | N/A — separate `profiles.avatar_url` table, different bucket, different pipeline | None | Out of scope |
| Supabase Storage `creator_avatars` bucket | 2/2 objects = 0 bytes (entire bucket population is corrupt) | Latent — only the operator's account has historical zero-byte writes today, but **every** Mingla Business creator who has tried to set an avatar since Cycle 14 ship would have the same condition | Spec should consider whether to backfill (delete the 0-byte rows and force re-upload) or leave them in place for users to overwrite manually |

**iOS / Android / Web parity:**

- iOS: directly observed (operator screenshot). `fetch().blob()` polyfill on Hermes/JSC is the documented failure mode.
- Android: not directly observed for this surface, but the same code path runs and the same `fetch().blob()` issue is reported in identical event-cover history (ORCH-0766B retest covered both). High likelihood of same symptom.
- Web (mingla-business.com): `fetch().blob()` works correctly in browser realms — the avatar upload is likely **functional on web** today. Worth proving in TEST mode, since it would indicate a platform-conditional fix path is acceptable (but better practice is to unify on `expo-file-system` for native and keep a web branch).

**Security implications:** None. RLS on `creator_avatars` is healthy (owner-gated). No PII exposure beyond the operator email already visible in the dispatch. No anon writes possible. The DB-level `creator_accounts` RLS (self-write only) is intact.

---

## 7. Invariant check

| Invariant | Status | Notes |
|---|---|---|
| **Constitution #3 — No silent failures** | **VIOLATED** | Zero-byte upload + render decode failure are both silent; user sees no error toast, no fallback, no recovery affordance. F1 + F3 together. |
| **Constitution #9 — No fabricated data** | **VIOLATED (soft)** | The UI implies the avatar saved (no error, photo state set, save button works) while the underlying object is empty. The user's mental model is "I uploaded a photo and the app shows it" — the app shows a black hole instead. |
| **I-21 — operator-side route, uses `useAuth` via `useCurrentBrandRole`** | Preserved | edit-profile.tsx remains an operator-only route. |
| **I-35 — creator_accounts.deleted_at soft-delete contract** | Preserved | Not touched. |
| **I-36 — ROOT-ERROR-BOUNDARY** | Preserved | Not touched. |
| **DEC-096 D-14-2 — creator_avatars Storage bucket per Cycle 14 SPEC-pivot** | **Drift** | Remote-only existence; local migrations folder lost the source-of-truth file (F4). |

---

## 8. Fix strategy (direction only — not a spec)

Bounded fix, scoped to the upload / render / persistence chain for the profile avatar. Direct parallel to ORCH-0766B.

1. **Replace the read path.** Swap `await fetch(asset.uri).blob()` for a shared file-bytes reader that uses `expo-file-system` (e.g. introduce `mingla-business/src/services/creatorAvatarFileReader.ts` mirroring `eventCoverFileReader.ts`). Read into a `Uint8Array` / `ArrayBuffer`, not a WHATWG Blob.
2. **Reject empty bytes before upload.** If `byteLength === 0`, throw a typed error that surfaces a "Couldn't read that photo. Try another." toast (no silent path).
3. **Tighten MIME mapping.** Map `'jpg' → 'image/jpeg'` in the fallback content-type branch. Validate that the resolved content-type is in the bucket whitelist; reject otherwise with a clear toast.
4. **Verify the public object after upload.** Mirror `verifyEventCoverPublicUrl` — HEAD first, fall back to `GET Range: bytes=0-0`; reject `content-length: 0`. Only then call `setPhotoUri`.
5. **Stop persisting the cache-bust token.** Persist the canonical `publicUrl` into `creator_accounts.avatar_url`. Apply `?t=<Date.now()>` only at render time (e.g. wrap the URL in a `useMemo` that adds `?t=` based on a mounted-at timestamp or the file's `updated_at` from Storage).
6. **Render fallback.** Add `onError` to the avatar `<Image>` that flips back to the initials fallback view; optionally show a non-blocking inline toast "We couldn't show your photo — tap to retry."
7. **Re-add the migration.** Author a monotonic migration in `supabase/migrations/` (e.g. `20260511000001_orch_0786_creator_avatars_bucket.sql`) that recreates the bucket + 4 RLS policies in the shape verified in Section 4a. Use `CREATE … IF NOT EXISTS` semantics where possible; ensure idempotency against the live state. Do **not** run `supabase db push` until the migration is reconciled and the operator/orchestrator decides on deploy gating.
8. **Decide on backfill.** Either delete the 2 known 0-byte objects (forcing the operator to re-upload through the fixed path) or leave them and let the upsert overwrite the next time the user changes their photo. Recommend deletion as part of the fix verification step so the test verdict is clean.

Out of scope (hard guards): event-cover media, brand cover/photo, ticket-tier media, Giphy/Pexels picker, Stripe surfaces, public-brand surfaces, app-mobile profile avatars, any admin avatar surfaces.

---

## 9. Regression prevention requirements

The SPEC must require, and the TEST phase must independently verify:

1. **Static rejection** of the broken pattern. A new strict-grep CI gate (per `feedback_strict_grep_registry_pattern`) that flags `fetch(asset.uri).blob()` anywhere inside `mingla-business/app/account/**` and `mingla-business/src/services/creator*` — or, more durably, requires `expo-file-system` File/arrayBuffer usage in those paths.
2. **Repo-running regression test** (unit) that mocks the file reader to return `byteLength: 0` and asserts (a) `supabase.storage.upload` is **not** called and (b) the user-visible toast is `"Couldn't upload photo. Tap to try again."` or equivalent. Test must fail against the current code, pass after the fix.
3. **Repo-running regression test** (unit/component) that mounts the avatar `<Image>` with a URL that 404s and asserts the initials fallback is rendered after `onError` fires.
4. **Repo-running regression test** (unit) that asserts the persisted `avatar_url` does **not** contain `?t=`.
5. **Operator-assisted runtime gate** before CLOSE: open Edit profile on iOS Simulator, change avatar, verify (a) the new picture renders, (b) reopen the screen and confirm it still renders, (c) sign out + sign in and confirm it survives, (d) inspect the Storage object via MCP and confirm `bytes > 0`.
6. **Android parity gate**: same flow on Android emulator. If web is a required surface for Edit Profile, add web gate.
7. **Migration verification gate**: after re-adding the bucket migration, `supabase db push` against a fresh ephemeral branch must apply cleanly; the bucket and 4 policies must match the live shape; CI must apply the migration successfully.

---

## 10. Discoveries for orchestrator

| ID | Severity | Description | Recommendation |
|---|---|---|---|
| D-ORCH-0786-FOR-1 | S2 (deployment-pipeline drift) | `20260504_b1_phase5_creator_avatars.sql` is referenced in artifacts as deployed but is absent from `supabase/migrations/`. Schema drift between code and remote. | Fold into SPEC §3 step 7. Audit if any other Cycle-14-era migrations have the same drift; this is the only one I noticed during this investigation but a broader audit could be its own ORCH. |
| D-ORCH-0786-FOR-2 | S3 (latent UX) | `creator_accounts.avatar_url` persists `?t=…` cache-bust tokens (F2). At minimum 1 row in production (operator) has the token baked in. | Decide whether to backfill-strip the token DB-side or leave it; the fix will overwrite it on next user change anyway. |
| D-ORCH-0786-FOR-3 | S3 (orphaned 0-byte objects) | 2 zero-byte objects in `creator_avatars` belong to the operator. They will continue to serve empty bodies for any consumer until overwritten. | Decide whether to delete them as part of the deploy or wait for the user to overwrite. |
| D-ORCH-0786-FOR-4 | S3 (parity audit) | Same picker / fetch-blob pattern may exist in `mingla-business` brand profile-photo handler or other surfaces. Cycle 14 only shipped J-A1 avatar — but future cycles may inherit the same broken read path. | Add a strict-grep gate that fails on `fetch(…).blob()` for any picker-driven upload in `mingla-business`. Codifies the lesson once. |
| D-ORCH-0786-FOR-5 | S2 (memory rule candidate) | The "fetch(uri).blob() returns size 0 on RN" failure has now happened twice: ORCH-0766B (event covers) and ORCH-0786 (creator avatars). | Promote to a top-level memory feedback rule under "RN file upload pattern — always use expo-file-system, never fetch.blob()" so future implementor dispatches don't re-rediscover it. |

---

## 11. Confidence

**HIGH.** `root cause proven`. Six-field evidence captured from:

- Source code at exact file:line.
- Local migration filesystem (proves absence of bucket migration).
- Live remote DB read-only probes (proves bucket existence, RLS shape, two 0-byte avatar objects, persisted `avatar_url` value).
- Historical reports proving an identical root-cause class (ORCH-0766B) and an unaddressed F6 callout from ORCH-0766.
- Operator screenshot timestamp (`04:47` local Eastern = `08:47 UTC`) matching `storage.objects.updated_at` (`08:47:17 UTC`) within seconds.

The only thing this investigation did **not** prove with direct runtime traces is the `fetch(file://).blob()` returning size-0 inside the operator's actual Simulator session — but the diff between the working (`event_covers`, 8 healthy non-zero files for the same operator using `readEventCoverFileBytes`) and broken (`creator_avatars`, 2 of 2 zero-byte files using `fetch().blob()`) code paths is conclusive evidence. Any remaining uncertainty is resolved during TEST mode with operator-assisted device verification post-implementor.

---

## 12. Cross-references

- **Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_ORCH-0786_BUSINESS_PROFILE_AVATAR_BLACK_AFTER_CHANGE.md`
- **Operator evidence:** `/Users/sethogieva/Desktop/Simulator Screenshot - iPhone 17 Pro - 2026-05-11 at 04.47.20.png`
- **Code under investigation:** `mingla-business/app/account/edit-profile.tsx:60-205`, `mingla-business/src/hooks/useCreatorAccount.ts`, `mingla-business/src/services/creatorAccount.ts`
- **Control (proven-working) pattern:** `mingla-business/src/services/eventCoverMediaService.ts`, `mingla-business/src/services/eventCoverFileReader.ts`
- **Prior investigations:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0766_CUSTOM_MINGLA_UPLOAD_CURRENT_STATE.md` (F6), `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0766B_ZERO_BYTE_EVENT_COVER_UPLOAD.md`
- **Cycle 14 close anchors:** `Mingla_Artifacts/WORLD_MAP.md:213`, `Mingla_Artifacts/MASTER_BUG_LIST.md:287`
- **Cycle 16a touch on same file (permission UX only, upload payload unchanged):** `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_16A_QUICK_WINS_REPORT.md` §4.2
- **Schema baseline:** `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql`
- **Live remote evidence:** Supabase MCP read-only probes captured in Section 4a

---

## 13. Lifecycle recommendation

**SPEC NEXT.** Root cause is proven and the repair scope is bounded (single component file, single service to introduce, one migration to re-add, one regression-test bundle, one strict-grep gate). The downstream pipeline routing is:

1. Claude `mingla-forensics` SPEC mode → `Mingla_Artifacts/specs/SPEC_ORCH-0786_BUSINESS_PROFILE_AVATAR_BLACK_AFTER_CHANGE.md`
2. Codex `implementor-mingla` → `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0786_BUSINESS_PROFILE_AVATAR_BLACK_AFTER_CHANGE.md`
3. Claude `mingla-forensics` TEST mode → `Mingla_Artifacts/reports/QA_ORCH-0786_BUSINESS_PROFILE_AVATAR_BLACK_AFTER_CHANGE.md` (iOS + Android + Web parity; operator-assisted runtime gate on Simulator)
4. Codex `orchestrator-mingla` CLOSE.
