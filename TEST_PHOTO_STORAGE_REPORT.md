# Test Report: Photo Storage Migration (Google → Supabase Storage)
**Date:** 2026-03-15
**Tester:** Brutal Tester Skill
**Verdict:** CONDITIONAL PASS

---

## Executive Summary

The implementation replaces expiring Google photo references with permanent Supabase Storage URLs across the full photo pipeline: download, storage, resolution, and fallback. The architecture is sound — fire-and-forget downloads on upsert, preference-based resolution (stored > Google > Unsplash), and a mobile safety net for expired URLs. Two findings need attention: the Storage bucket RLS policies allow any authenticated or anonymous user to upload/overwrite photos (not just service role), and the batch upsert path in `serveCardsFromPipeline` fires downloads per-place in a loop without concurrency control, risking function timeout under load.

---

## Test Manifest

| Category | Items Tested | Passed | Failed | Warnings |
|----------|-------------|--------|--------|----------|
| Security / RLS | 3 | 1 | 1 | 1 |
| Logic Correctness | 8 | 8 | 0 | 0 |
| Migration | 3 | 3 | 0 | 0 |
| Mobile Component | 4 | 4 | 0 | 0 |
| Performance | 3 | 2 | 0 | 1 |
| Pattern Compliance | 4 | 3 | 0 | 1 |
| **TOTAL** | **25** | **21** | **1** | **3** |

---

## HIGH-001: Storage Bucket RLS Policies Allow Unrestricted Upload

**File:** `supabase/migrations/20260315000003_place_photos_storage.sql` (lines 34-40)
**Category:** Security
**Severity:** HIGH

**What's Wrong:**

The INSERT and UPDATE policies have no role restriction:

```sql
CREATE POLICY "Service role upload for place photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'place-photos');

CREATE POLICY "Service role update for place photos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'place-photos');
```

Despite the policy *names* saying "Service role", the policies themselves have no `auth.role() = 'service_role'` check. This means:
- Any authenticated user (via the anon key + JWT) can upload arbitrary images to the `place-photos` bucket
- An attacker could overwrite legitimate place photos with malicious content (phishing images, inappropriate content)
- The bucket has a 5MB limit and mime-type restriction, but that doesn't prevent content abuse

**Required Fix:**
Add role checks to the INSERT and UPDATE policies:
```sql
CREATE POLICY "Service role upload for place photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'place-photos' AND auth.role() = 'service_role');

CREATE POLICY "Service role update for place photos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'place-photos' AND auth.role() = 'service_role');
```

This ensures only edge functions (which use the service role key) can upload, while the public SELECT policy allows anyone to view photos.

---

## MED-001: Batch Photo Downloads Without Concurrency Control

**File:** `supabase/functions/_shared/cardPoolService.ts` (lines 917-923)
**Category:** Performance / Reliability
**Severity:** MEDIUM

**What's Wrong:**

In `serveCardsFromPipeline`, Phase 3 fires photo downloads for every new place in a loop:

```typescript
for (const { place } of pendingPlaces) {
  if (place.photos?.length > 0 && googleApiKey) {
    downloadAndStorePhotos(supabaseAdmin, place.id, place.photos, googleApiKey).catch(() => {});
  }
}
```

Each `downloadAndStorePhotos` call downloads up to 5 photos (8s timeout each). With 20 pending places × 5 photos = 100 concurrent downloads + 100 Storage uploads. While fire-and-forget means the function doesn't wait, Deno's runtime still processes these, and the edge function's global timeout (typically 60s for Supabase) may kill the process before all downloads complete.

This is non-blocking for the response, so users aren't affected. But photos may not get stored if the function exits before downloads finish.

**Required Fix (optional, non-blocking):**
No immediate fix needed — the photos will be stored on the next `upsertPlaceToPool` call. However, for efficiency, consider batching downloads with a concurrency limit (e.g., 3 concurrent downloads) or prioritizing only the primary photo per place.

---

## MED-002: `buildSingleCardFromPlace` References `stored_photo_urls` But Callers May Not Select It

**File:** `supabase/functions/_shared/cardPoolService.ts` (lines 410-430)
**Category:** Data Access
**Severity:** MEDIUM (low impact — function appears unused currently)

**What's Wrong:**

`buildSingleCardFromPlace` uses `resolvePhotoUrl(place.stored_photo_urls, ...)`, but this function is internal and not currently called. If it's called in the future by code that queries `place_pool` without including `stored_photo_urls` in the SELECT, the field will be `undefined` and `resolvePhotoUrl` will correctly fall back to Google URLs. So no functional bug today, but the contract is implicit.

Not blocking — noting for awareness.

---

## LOW-001: Inline Style Object in SwipeableCards

**File:** `app-mobile/src/components/SwipeableCards.tsx` (lines 1493, 1630)
**Category:** Pattern Compliance
**Severity:** LOW

```tsx
<View style={[styles.imageContainer, { backgroundColor: '#1a1a2e' }]}>
```

Inline style `{ backgroundColor: '#1a1a2e' }` should be in `StyleSheet.create()` per project conventions. Functional — not blocking.

---

## What Passed

### Things Done Right

1. **`resolvePhotoUrl` / `resolveAllPhotoUrls` design is excellent.** Clean priority chain (stored → Google → Unsplash) with no branching at call sites. Every consumer just calls one function. When stored URLs gradually populate, cards silently switch from Google to Supabase — zero code changes needed.

2. **`CardHeroImage` component is a proper safety net.** Uses `useState` + `useEffect` to sync with URI prop changes, and `onError` to fall back. The guard `if (src !== CARD_FALLBACK_IMAGE)` prevents infinite error loops if even the fallback fails. Clean React pattern.

3. **Photo download never blocks card serving.** Both `upsertPlaceToPool` (line 272) and `serveCardsFromPipeline` (line 921) call `downloadAndStorePhotos` with `.catch(() => {})`. The first card serve uses Google URLs; subsequent serves use Supabase URLs. This is the correct tradeoff — no user-facing latency increase.

4. **Migration is idempotent.** `ADD COLUMN IF NOT EXISTS` for the column, `ON CONFLICT DO NOTHING` for the bucket. Safe to run multiple times.

5. **Storage path sanitization.** `googlePlaceId.replace(/[^a-zA-Z0-9_-]/g, '_')` prevents path traversal or encoding issues in Storage paths. Matches the established pattern from `personAudioService.ts`.

6. **`getPhotoUrl` now returns fallback instead of empty string.** Previously returned `''` for places with no photos, which would cause a broken `<Image source={{ uri: '' }}>`. Now returns the Unsplash fallback consistently.

7. **Content-type detection.** `photoStorageService.ts` reads the response `content-type` header and uses the correct extension (jpg/png/webp). Photos are stored with accurate MIME types.

8. **Cache-Control header on uploads.** `cacheControl: '31536000'` (1 year) is perfect for immutable photo assets — CDN will cache aggressively.

9. **All three place_pool fallbacks updated consistently.** discover-cards, discover-experiences, and get-person-hero-cards all select `stored_photo_urls` and use the same priority pattern.

10. **Gradual rollout design.** The system handles the transition gracefully — existing places without `stored_photo_urls` continue using Google URLs until they're refreshed. No migration of existing photos needed.

---

## Spec Compliance Matrix

| Requirement | Tested? | Passed? | Evidence |
|-------------|---------|---------|----------|
| Download photos from Google on place upsert | Yes | Yes | `upsertPlaceToPool` line 271-273 |
| Store in Supabase Storage bucket | Yes | Yes | `photoStorageService.ts` line 68-74 |
| Save URLs to `place_pool.stored_photo_urls` | Yes | Yes | `photoStorageService.ts` line 100-104 |
| Cards prefer stored URLs over Google refs | Yes | Yes | `resolvePhotoUrl` used in `buildSingleCardFromPlace` and all 3 fallbacks |
| Fallback to Google URL when stored unavailable | Yes | Yes | `resolvePhotoUrl` line 125-127 |
| Fallback to Unsplash when no photo at all | Yes | Yes | `resolvePhotoUrl` line 129 + `getPhotoUrl` + `CardHeroImage` |
| Mobile handles expired URL gracefully | Yes | Yes | `CardHeroImage` onError at line 69-71 |
| Fire-and-forget (never blocks serving) | Yes | Yes | `.catch(() => {})` on all download calls |
| Migration adds column + creates bucket | Yes | Yes | `IF NOT EXISTS` + `ON CONFLICT DO NOTHING` |
| Public read access for photos | Yes | Yes | SELECT policy at line 29-31 |

---

## Recommendations

### Must Fix Before Merge
1. **HIGH-001**: Add `auth.role() = 'service_role'` to the INSERT and UPDATE Storage policies. Without this, any client can overwrite place photos.

### Should Fix Soon
2. **MED-001**: Consider limiting concurrent photo downloads (non-blocking for users but affects storage population completeness)

### Nice to Have
3. **LOW-001**: Move inline backgroundColor to StyleSheet

---

## Verdict Justification

**CONDITIONAL PASS** — The photo storage architecture is well-designed and the rollout strategy is smart. The resolution chain (`stored → Google → fallback`) is clean, the mobile safety net handles edge cases, and the fire-and-forget pattern ensures zero latency impact. The one blocking issue is the Storage bucket RLS — the policies named "Service role" don't actually restrict to service role, allowing any user to upload. This is a straightforward SQL fix (add `AND auth.role() = 'service_role'`). After that fix, this is ready for merge.
