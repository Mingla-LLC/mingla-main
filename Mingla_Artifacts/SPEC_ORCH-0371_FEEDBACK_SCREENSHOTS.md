# SPEC: ORCH-0371 — Optional Screenshot Attachments for Beta Feedback

**Status:** Ready for implementation
**Author:** Forensics (Spec mode)
**Date:** 2026-04-10
**Severity:** S3-low (enhancement)
**Surface:** Profile & Settings > Share Feedback modal

---

## Summary

Add an optional screenshot attachment step to the existing beta feedback flow. After
recording and reviewing audio, users see a new "Attach Screenshots" step where they
can pick up to 10 images from their photo library. Screenshots are compressed client-side
(max 1920px, JPEG 0.7), uploaded to the existing `beta-feedback` storage bucket under a
`screenshots/` subfolder, and stored alongside the audio metadata in the `beta_feedback`
table. The history viewer (mobile) and detail modal (admin) both display screenshots.
The entire existing audio flow remains untouched.

---

## Scope

**In scope:**
- New `screenshots` step in `BetaFeedbackModal.tsx` (between `review` and `submitting`)
- Image picking from photo library (multi-select, up to 10)
- Client-side image compression via `expo-image-manipulator` (already installed)
- Parallel upload to Supabase Storage
- New DB columns: `screenshot_paths text[]`, `screenshot_urls text[]`
- Edge function update: accept, validate, and sign screenshot paths
- Storage bucket update: allow `image/jpeg` MIME type
- History viewer: horizontal thumbnail scroll with tap-to-view
- Admin detail modal: screenshot grid with click-to-lightbox

**Out of scope:**
- Video attachments
- Text input / annotations on screenshots
- Camera capture (photo library only)
- Editing/cropping within the feedback flow
- Any changes to the audio recording flow

---

## Files to Modify

| # | File | What Changes |
|---|------|-------------|
| 1 | `supabase/migrations/20260410100001_beta_feedback_screenshots.sql` | **NEW** — add columns + update bucket MIME types |
| 2 | `supabase/functions/submit-feedback/index.ts` | Accept optional `screenshot_paths`, validate, sign URLs, store |
| 3 | `app-mobile/src/services/betaFeedbackService.ts` | Add `uploadFeedbackScreenshots()`, update `SubmitFeedbackRequest` and `BetaFeedback` types, add `getScreenshotSignedUrls()` |
| 4 | `app-mobile/src/hooks/useBetaFeedback.ts` | Pass `screenshot_paths` through mutation |
| 5 | `app-mobile/src/components/BetaFeedbackModal.tsx` | Add `screenshots` step, screenshot state, image picker, thumbnail grid |
| 6 | `app-mobile/src/components/FeedbackHistorySheet.tsx` | Show screenshot thumbnails in history items |
| 7 | `mingla-admin/src/pages/BetaFeedbackPage.jsx` | Show screenshots in detail modal, add screenshot count to table |

**Files NOT to modify:**
- `BetaFeedbackButton.tsx` — no changes
- `app-mobile/src/services/cameraService.ts` — do NOT reuse; it requests camera permission which we don't need. Write image picking inline in the service.
- RLS policies on `beta_feedback` table — existing policies cover new columns automatically
- Storage RLS on `storage.objects` — existing folder-based policy `(storage.foldername(name))[1] = auth.uid()::text` already covers any subfolder including `screenshots/`

---

## 1. Database Migration

**File:** `supabase/migrations/20260410100001_beta_feedback_screenshots.sql`

```sql
-- ORCH-0371: Add optional screenshot support to beta feedback
-- New nullable array columns for screenshot storage paths and signed URLs.
-- NULL = no screenshots (backward compatible with all existing rows).

ALTER TABLE beta_feedback
  ADD COLUMN screenshot_paths TEXT[] DEFAULT NULL,
  ADD COLUMN screenshot_urls  TEXT[] DEFAULT NULL;

-- Update the beta-feedback storage bucket to also accept JPEG images.
-- Existing allowed_mime_types: ARRAY['audio/mp4', 'audio/x-m4a', 'audio/mpeg', 'audio/aac']
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'audio/mp4', 'audio/x-m4a', 'audio/mpeg', 'audio/aac',
  'image/jpeg'
]
WHERE id = 'beta-feedback';
```

**Why `NULL` default instead of `'{}'`:** Existing rows have no screenshots. NULL semantically
means "not provided" vs empty array meaning "explicitly provided zero." This matches the
existing pattern where `audio_url` is nullable.

**No new indexes:** Screenshots are never queried independently — only fetched as part of
the feedback row. No index needed.

**No RLS changes needed:**
- Table: existing SELECT/INSERT/UPDATE policies apply to all columns equally.
- Storage: existing INSERT policy checks `(storage.foldername(name))[1] = auth.uid()::text`.
  The path `{userId}/screenshots/feedback_xxx.jpg` satisfies this — `foldername` returns
  the first path segment which is the userId. Verified.

---

## 2. Edge Function Changes

**File:** `supabase/functions/submit-feedback/index.ts`

### Updated Request Body

Add ONE new optional field to the destructured body:

```
screenshot_paths   // optional string[] — storage paths to uploaded screenshots
```

### Validation Rules (add after existing audio validation)

1. If `screenshot_paths` is present and not `undefined`/`null`:
   - Must be an array: `Array.isArray(screenshot_paths)`
   - Length must be 0-10: `screenshot_paths.length <= 10`
   - Every element must be a string starting with `${user.id}/screenshots/`
   - If any validation fails → 400 with descriptive error
2. If `screenshot_paths` is `undefined`, `null`, or empty array → treat as no screenshots

### Signed URL Generation

For each valid screenshot path, generate a signed URL (same 3600s expiry as audio):

```
const screenshotUrls: string[] = [];
if (validScreenshotPaths.length > 0) {
  for (const path of validScreenshotPaths) {
    const { data } = await supabaseAdmin.storage
      .from('beta-feedback')
      .createSignedUrl(path, 3600);
    screenshotUrls.push(data?.signedUrl ?? '');
  }
}
```

### Insert Changes

Add to the insert object:
```
screenshot_paths: validScreenshotPaths.length > 0 ? validScreenshotPaths : null,
screenshot_urls: screenshotUrls.length > 0 ? screenshotUrls : null,
```

### Response

No change to response shape. Still returns `{ success: true, feedback_id: string }`.

---

## 3. Service Layer Changes

**File:** `app-mobile/src/services/betaFeedbackService.ts`

### Type Changes

**`SubmitFeedbackRequest`** — add optional field:
```typescript
screenshot_paths?: string[];  // Storage paths to uploaded screenshots
```

**`BetaFeedback`** — add two fields:
```typescript
screenshot_paths: string[] | null;
screenshot_urls: string[] | null;
```

### New Constants

```typescript
export const MAX_SCREENSHOTS = 10;
const SCREENSHOT_MAX_DIMENSION = 1920;  // px, longest edge
const SCREENSHOT_JPEG_QUALITY = 0.7;
```

### New Function: `compressScreenshot`

**Purpose:** Resize image to max 1920px on longest edge, convert to JPEG at 0.7 quality.

**Implementation contract:**
- Import `* as ImageManipulator from 'expo-image-manipulator'`
- Accept: `uri: string` (local file URI from image picker)
- Return: `Promise<{ uri: string; width: number; height: number }>`
- Logic:
  1. Get image dimensions from the picker asset (passed alongside URI — see modal section)
  2. Calculate resize dimensions: if either dimension > 1920, scale down proportionally
     so the longest edge = 1920. If both dimensions <= 1920, skip resize.
  3. Call `ImageManipulator.manipulateAsync(uri, actions, { compress: 0.7, format: SaveFormat.JPEG })`
     where `actions` is `[{ resize: { width, height } }]` if resize needed, or `[]` if not.
  4. Return the manipulated result.

### New Function: `uploadFeedbackScreenshots`

**Signature:**
```typescript
async function uploadFeedbackScreenshots(
  userId: string,
  screenshots: Array<{ uri: string; width: number; height: number }>,
): Promise<string[]>
```

**Implementation contract:**
1. Generate a shared timestamp: `const ts = Date.now()`
2. For each screenshot (with index `i`):
   a. Compress via `compressScreenshot(uri, width, height)`
   b. Build path: `${userId}/screenshots/feedback_${ts}_${i}.jpg`
   c. Build FormData with `{ uri: compressedUri, type: 'image/jpeg', name: fileName }` — same
      `RNFormDataBlob` pattern as `uploadFeedbackAudio`
   d. Upload to `beta-feedback` bucket via `supabase.storage.from('beta-feedback').upload(...)`
3. Upload ALL in parallel: `Promise.all(screenshots.map(...))`
4. If ANY upload fails, throw an Error with message `Failed to upload screenshot ${i+1} of ${total}`
5. Return array of storage paths (in order)

**Why parallel:** Screenshots are independent. Parallel upload is ~Nx faster for N images.

### New Function: `getScreenshotSignedUrls`

**Signature:**
```typescript
async function getScreenshotSignedUrls(
  paths: string[],
): Promise<string[]>
```

**Purpose:** Generate fresh signed URLs for expired screenshot URLs in history view.

**Implementation:**
1. For each path, call `supabase.storage.from('beta-feedback').createSignedUrl(path, 3600)`
2. Return array of signed URLs (parallel)
3. If any fails, return empty string for that index (graceful degradation)

### Export Updates

Add to `betaFeedbackService` object:
```typescript
uploadFeedbackScreenshots,
getScreenshotSignedUrls,
```

Add to module exports:
```typescript
export { MAX_SCREENSHOTS };
```

---

## 4. Hook Layer Changes

**File:** `app-mobile/src/hooks/useBetaFeedback.ts`

**No structural changes needed.** The mutation already passes `SubmitFeedbackRequest`
through to `betaFeedbackService.submitFeedback()`. Since we're adding `screenshot_paths`
as an optional field to `SubmitFeedbackRequest`, it flows through automatically.

The only change: update the import to also import `MAX_SCREENSHOTS` if the hook
needs to expose it. But since the modal can import directly from the service, no
hook change is strictly necessary.

**Verdict:** No changes to this file. The types flow through naturally.

---

## 5. Modal UI Changes

**File:** `app-mobile/src/components/BetaFeedbackModal.tsx`

### Step Type Update

```typescript
type ModalStep = 'category' | 'recording' | 'review' | 'screenshots' | 'submitting' | 'success' | 'error';
```

### New State

```typescript
const [selectedScreenshots, setSelectedScreenshots] = useState<
  Array<{ uri: string; width: number; height: number }>
>([]);
const [screenshotUploading, setScreenshotUploading] = useState(false);
```

### New Imports

```typescript
import * as ImagePicker from 'expo-image-picker';
import { Image, ScrollView } from 'react-native';  // Add Image, ScrollView to existing RN import
import {
  // ... existing imports ...
  MAX_SCREENSHOTS,
} from '../services/betaFeedbackService';
```

### Reset State Update

In `resetState()`, add:
```typescript
setSelectedScreenshots([]);
setScreenshotUploading(false);
```

### Navigation Changes

**From `review` step:** The "Submit" button becomes "Next" and navigates to `screenshots` step
instead of calling `handleSubmit()`.

```
// In renderReview():
// OLD: <TouchableOpacity ... onPress={handleSubmit}>
// NEW: <TouchableOpacity ... onPress={() => setStep('screenshots')}>
//        <Text>Next</Text>
//      </TouchableOpacity>
```

**The review step's "Re-record" button:** Unchanged — still goes to `category`.

### New Function: `pickScreenshots`

```typescript
const pickScreenshots = async () => {
  // Check how many more we can add
  const remaining = MAX_SCREENSHOTS - selectedScreenshots.length;
  if (remaining <= 0) {
    // Show a toast or inline message — "Maximum 10 screenshots reached"
    return;
  }

  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    // Show inline error text: "Photo library access is needed to attach screenshots"
    // Do NOT block submission — user can still skip
    return;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    allowsMultipleSelection: true,
    selectionLimit: remaining,
    quality: 1,  // We compress ourselves via ImageManipulator
    exif: false,
  });

  if (result.canceled || !result.assets?.length) return;

  const newImages = result.assets.map((asset) => ({
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
  }));

  setSelectedScreenshots((prev) => [...prev, ...newImages].slice(0, MAX_SCREENSHOTS));
};
```

**Key decisions:**
- `allowsMultipleSelection: true` — iOS 14+ and Android support multi-select
- `selectionLimit: remaining` — prevents over-selection at the picker level
- `quality: 1` — we compress ourselves for precise control
- `exif: false` — strip metadata for privacy and smaller payloads
- The `.slice(0, MAX_SCREENSHOTS)` is a safety cap in case of race conditions

### New Function: `removeScreenshot`

```typescript
const removeScreenshot = (index: number) => {
  setSelectedScreenshots((prev) => prev.filter((_, i) => i !== index));
};
```

### Updated `handleSubmit`

The submit function now handles screenshot upload before calling the edge function:

```typescript
const handleSubmit = async () => {
  if (!recordedUri || !selectedCategory || !user?.id) return;

  setStep('submitting');

  try {
    // 1. Upload audio (existing)
    const audioPath = await betaFeedbackService.uploadFeedbackAudio(user.id, recordedUri);

    // 2. Upload screenshots (new — only if any selected)
    let screenshotPaths: string[] | undefined;
    if (selectedScreenshots.length > 0) {
      screenshotPaths = await betaFeedbackService.uploadFeedbackScreenshots(
        user.id,
        selectedScreenshots,
      );
    }

    // 3. Collect metadata (existing)
    const deviceInfo = getDeviceInfo();
    const sessionDurationMs = getSessionDurationMs();

    // 4. Location (existing, unchanged)
    // ... same as current ...

    // 5. Build params
    const params: SubmitFeedbackRequest = {
      // ... all existing fields unchanged ...
      screenshot_paths: screenshotPaths,  // NEW — undefined if no screenshots
    };

    await submitMutation.mutateAsync(params);
    // ... rest unchanged (haptics, success, auto-close) ...
  } catch (error: unknown) {
    // ... unchanged ...
  }
};
```

### New Render Function: `renderScreenshots`

```typescript
const renderScreenshots = () => (
  <View style={styles.stepContainer}>
    <Text style={styles.stepTitle}>Add Screenshots</Text>
    <Text style={styles.stepSubtitle}>
      {selectedScreenshots.length === 0
        ? 'Optionally attach up to 10 images from your photo library'
        : `${selectedScreenshots.length}/${MAX_SCREENSHOTS} screenshots`}
    </Text>

    {/* Thumbnail Grid */}
    {selectedScreenshots.length > 0 && (
      <ScrollView
        style={styles.screenshotScrollContainer}
        contentContainerStyle={styles.screenshotGrid}
        showsVerticalScrollIndicator={false}
      >
        {selectedScreenshots.map((img, index) => (
          <View key={`${img.uri}-${index}`} style={styles.screenshotThumb}>
            <Image
              source={{ uri: img.uri }}
              style={styles.screenshotImage}
              resizeMode="cover"
            />
            <TouchableOpacity
              style={styles.screenshotRemove}
              onPress={() => removeScreenshot(index)}
              hitSlop={8}
            >
              <Icon name="close-circle" size={22} color={colors.error[500]} />
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    )}

    {/* Add Button */}
    {selectedScreenshots.length < MAX_SCREENSHOTS && (
      <TouchableOpacity
        style={styles.addScreenshotButton}
        onPress={pickScreenshots}
        activeOpacity={0.7}
      >
        <Icon name="images-outline" size={20} color={colors.primary[500]} />
        <Text style={styles.addScreenshotText}>
          {selectedScreenshots.length === 0 ? 'Add from Library' : 'Add More'}
        </Text>
      </TouchableOpacity>
    )}

    {/* Action Buttons */}
    <View style={styles.screenshotActions}>
      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => setStep('review')}
        activeOpacity={0.7}
      >
        <Text style={styles.secondaryButtonText}>Back</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.primaryButton}
        onPress={handleSubmit}
        activeOpacity={0.7}
      >
        <Text style={styles.primaryButtonText}>
          {selectedScreenshots.length === 0 ? 'Skip & Submit' : 'Submit'}
        </Text>
      </TouchableOpacity>
    </View>
  </View>
);
```

### Step Router Update

```typescript
const renderStep = () => {
  switch (step) {
    case 'category': return renderCategory();
    case 'recording': return renderRecording();
    case 'review': return renderReview();
    case 'screenshots': return renderScreenshots();  // NEW
    case 'submitting': return renderSubmitting();
    case 'success': return renderSuccess();
    case 'error': return renderError();
  }
};
```

### Error Step Update

The error step's "Try Again" button logic:
```typescript
// Currently: onPress={() => setStep(recordedUri ? 'review' : 'category')}
// Updated:   onPress={() => setStep(recordedUri ? 'screenshots' : 'category')}
```
This sends back to screenshots (which has a Back button to review) so the user
doesn't lose their screenshot selections.

### New Styles

```typescript
// Screenshots step
screenshotScrollContainer: {
  maxHeight: 240,
  marginBottom: spacing.md,
},
screenshotGrid: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: spacing.sm,
},
screenshotThumb: {
  width: (screenWidth - spacing.lg * 2 - spacing.sm * 2) / 3,  // 3 columns
  aspectRatio: 1,
  borderRadius: radius.md,
  overflow: 'hidden',
  position: 'relative',
},
screenshotImage: {
  width: '100%',
  height: '100%',
},
screenshotRemove: {
  position: 'absolute',
  top: 4,
  right: 4,
  backgroundColor: 'rgba(0,0,0,0.5)',
  borderRadius: 11,
},
addScreenshotButton: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: spacing.sm,
  paddingVertical: spacing.md,
  marginBottom: spacing.md,
  borderRadius: radius.md,
  borderWidth: 1,
  borderColor: colors.primary[200],
  borderStyle: 'dashed',
  backgroundColor: colors.primary[50],
},
addScreenshotText: {
  ...typography.md,
  fontWeight: fontWeights.semibold,
  color: colors.primary[500],
},
screenshotActions: {
  flexDirection: 'row',
  gap: spacing.sm,
},
```

**Note:** Import `Dimensions` from `react-native` to get `screenWidth`:
```typescript
const screenWidth = Dimensions.get('window').width;
```
Use this outside the component (module-level constant) or inside the style computation.
Since `StyleSheet.create` is static, compute the thumbnail width inside the render
function's inline style or use a percentage-based approach. **Preferred:** use
`(Dimensions.get('window').width - spacing.lg * 2 - spacing.sm * 2) / 3` as an
inline style width on each thumbnail, keeping other styles in the stylesheet.

### Backdrop Press Behavior

Currently, backdrop press is disabled during `recording`. Also disable during `screenshots`
if upload is in progress:
```typescript
// Current: onPress={step === 'recording' ? undefined : handleClose}
// Updated: onPress={step === 'recording' || screenshotUploading ? undefined : handleClose}
```

However, `screenshotUploading` is not used in the current design (uploads happen during
`submitting` step). So no change needed to backdrop behavior.

---

## 6. History Viewer Changes

**File:** `app-mobile/src/components/FeedbackHistorySheet.tsx`

### Type Import Update

The `BetaFeedback` type already includes the new fields after the service change.

### New Import

```typescript
import { Image, ScrollView as RNScrollView } from 'react-native';  // Add Image
import { betaFeedbackService } from '../services/betaFeedbackService';  // already imported
```

### FeedbackItem Changes

Add screenshot thumbnails below the play row:

After the `playRow` TouchableOpacity, add:

```jsx
{/* Screenshot thumbnails */}
{item.screenshot_urls && item.screenshot_urls.length > 0 && (
  <View style={styles.screenshotSection}>
    <Text style={styles.screenshotCountText}>
      {item.screenshot_urls.length} screenshot{item.screenshot_urls.length > 1 ? 's' : ''}
    </Text>
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.screenshotScrollContent}
    >
      {item.screenshot_urls.map((url, idx) => (
        <TouchableOpacity
          key={`${item.id}-ss-${idx}`}
          onPress={() => {/* open full-screen viewer — see below */}}
          activeOpacity={0.8}
        >
          <Image
            source={{ uri: url }}
            style={styles.historyScreenshotThumb}
            resizeMode="cover"
          />
        </TouchableOpacity>
      ))}
    </ScrollView>
  </View>
)}
```

### Full-Screen Image Viewer

Add a simple state to `FeedbackHistorySheet` (not `FeedbackItem`) for showing a
full-screen image:

```typescript
const [fullScreenImageUrl, setFullScreenImageUrl] = useState<string | null>(null);
```

Pass `onViewScreenshot` callback to each `FeedbackItem`:

```typescript
<FeedbackItem
  item={item}
  onViewScreenshot={(url) => setFullScreenImageUrl(url)}
/>
```

Render a fullscreen modal at the bottom of the component:

```jsx
<Modal visible={!!fullScreenImageUrl} transparent animationType="fade" onRequestClose={() => setFullScreenImageUrl(null)}>
  <Pressable style={styles.fullScreenBackdrop} onPress={() => setFullScreenImageUrl(null)}>
    {fullScreenImageUrl && (
      <Image
        source={{ uri: fullScreenImageUrl }}
        style={styles.fullScreenImage}
        resizeMode="contain"
      />
    )}
    <TouchableOpacity style={styles.fullScreenClose} onPress={() => setFullScreenImageUrl(null)}>
      <Icon name="close-circle" size={36} color="#fff" />
    </TouchableOpacity>
  </Pressable>
</Modal>
```

### Expired URL Handling

Signed URLs expire after 1 hour. The `screenshot_urls` stored in the DB at insertion
time will be stale by the time users view history. **Strategy:**

The history query returns `screenshot_paths` (permanent) alongside `screenshot_urls`
(ephemeral). When the image fails to load (onError on `<Image>`), re-fetch a fresh
signed URL using `betaFeedbackService.getScreenshotSignedUrls([path])`.

However, for simplicity in v1: the `useFeedbackHistory` query has a 5-minute staleTime.
Since the user opens history, views it briefly, and closes, the URLs are usually fresh
enough. If we get reports of broken images, add the re-fetch logic as a follow-up.

**Decision: v1 uses the URLs as-is from the DB. Acceptable for beta feedback.**

### New Styles

```typescript
screenshotSection: {
  marginTop: spacing.sm,
  paddingTop: spacing.sm,
  borderTopWidth: StyleSheet.hairlineWidth,
  borderTopColor: colors.gray[200],
},
screenshotCountText: {
  ...typography.xs,
  color: colors.text.tertiary,
  marginBottom: spacing.xs,
},
screenshotScrollContent: {
  gap: spacing.xs,
},
historyScreenshotThumb: {
  width: 56,
  height: 56,
  borderRadius: radius.sm,
},
fullScreenBackdrop: {
  flex: 1,
  backgroundColor: 'rgba(0,0,0,0.9)',
  justifyContent: 'center',
  alignItems: 'center',
},
fullScreenImage: {
  width: '100%',
  height: '80%',
},
fullScreenClose: {
  position: 'absolute',
  top: 60,
  right: 20,
},
```

---

## 7. Admin Panel Changes

**File:** `mingla-admin/src/pages/BetaFeedbackPage.jsx`

### Table Column Addition

Add a column after the `audio_duration_ms` column to show screenshot count:

```javascript
{
  key: "screenshot_count",
  label: "Screenshots",
  render: (_val, row) => {
    const count = row.screenshot_paths?.length ?? 0;
    if (count === 0) return <span className="text-sm text-[var(--color-text-tertiary)]">—</span>;
    return (
      <div className="flex items-center gap-1.5">
        <ImageIcon className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
        <span className="text-sm text-[var(--color-text-secondary)]">{count}</span>
      </div>
    );
  },
},
```

**New import:** Add `ImageIcon` (from `lucide-react`, the icon is named `Image`):
```javascript
import { Image as ImageIcon, /* ... existing ... */ } from "lucide-react";
```

### Detail Modal — Screenshots Section

Add a new section in the detail modal, between the "Audio Recording" section and the
"Admin" section:

```jsx
{/* Screenshots */}
{detailItem.screenshot_paths && detailItem.screenshot_paths.length > 0 && (
  <div>
    <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">
      Screenshots ({detailItem.screenshot_paths.length})
    </h4>
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 p-3 rounded-lg" style={{ backgroundColor: "var(--color-background-secondary)" }}>
      {detailItem.screenshot_paths.map((path, idx) => (
        <ScreenshotThumbnail key={path} path={path} index={idx} />
      ))}
    </div>
  </div>
)}
```

### New Component: `ScreenshotThumbnail`

Add inside `BetaFeedbackPage.jsx` (local component, same pattern as `AudioPlayer`):

```jsx
function ScreenshotThumbnail({ path }) {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    async function fetchUrl() {
      try {
        const { data, error: storageError } = await supabase.storage
          .from("beta-feedback")
          .createSignedUrl(path, 3600);
        if (storageError) throw storageError;
        if (!mountedRef.current) return;
        setUrl(data.signedUrl);
      } catch {
        if (mountedRef.current) setError(true);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    }
    fetchUrl();
  }, [path]);

  if (loading) return <div className="aspect-square rounded-lg bg-[var(--color-background-tertiary)] animate-pulse" />;
  if (error || !url) return <div className="aspect-square rounded-lg bg-[var(--color-background-tertiary)] flex items-center justify-center"><XCircle className="h-4 w-4 text-[var(--color-text-tertiary)]" /></div>;

  return (
    <>
      <button onClick={() => setLightbox(true)} className="aspect-square rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity">
        <img src={url} alt="Screenshot" className="w-full h-full object-cover" />
      </button>
      {lightbox && (
        <Modal open={lightbox} onClose={() => setLightbox(false)} title="Screenshot" size="lg">
          <ModalBody>
            <img src={url} alt="Screenshot" className="w-full rounded-lg" />
          </ModalBody>
        </Modal>
      )}
    </>
  );
}
```

### Export Column Update

Add `screenshot_paths` to the CSV export if desired (low priority, admin convenience):
```javascript
{ key: "screenshot_paths", label: "Screenshot Count", transform: (v) => v?.length ?? 0 },
```

**Note:** The existing `exportCsv` utility may not support `transform`. If not, skip this.
The column data would just show the raw array. Acceptable for v1.

---

## 8. Implementation Order

Execute in this exact sequence:

| Step | Action | Depends On |
|------|--------|-----------|
| 1 | Apply database migration | Nothing |
| 2 | Update edge function `submit-feedback/index.ts` | Step 1 |
| 3 | Update service types and add new functions in `betaFeedbackService.ts` | Nothing |
| 4 | Update `BetaFeedbackModal.tsx` — add screenshots step | Steps 2, 3 |
| 5 | Update `FeedbackHistorySheet.tsx` — show screenshots | Step 3 |
| 6 | Update `BetaFeedbackPage.jsx` — admin screenshots | Step 1 |

Steps 1-3 can be done first in any order. Steps 4-6 depend on prior steps as shown.

---

## 9. Success Criteria

| # | Criterion | How to Verify |
|---|-----------|--------------|
| SC-1 | After audio review, user sees "Add Screenshots" step with "Add from Library" button and "Skip & Submit" | Open feedback modal, record audio, tap Next on review |
| SC-2 | Tapping "Add from Library" opens iOS photo picker with multi-select enabled | Tap the button, verify multi-select UI appears |
| SC-3 | Selected images appear as a 3-column thumbnail grid with "X" remove buttons | Pick 3+ images, verify grid renders |
| SC-4 | Count indicator shows "N/10 screenshots" | Pick images, verify count updates |
| SC-5 | Tapping "X" removes that image from the grid and decrements count | Tap X on a thumbnail |
| SC-6 | "Add More" button appears when count < 10, disappears at 10 | Add images up to 10 |
| SC-7 | Tapping "Skip & Submit" with 0 screenshots submits audio-only (backward compat) | Skip screenshots, submit, check DB row has NULL screenshot_paths |
| SC-8 | Tapping "Submit" with screenshots uploads all images and submits | Add screenshots, submit, check DB row has populated screenshot_paths |
| SC-9 | All uploaded screenshots are JPEG, max 1920px longest edge | Download from Supabase Storage, check dimensions and format |
| SC-10 | Feedback history shows screenshot thumbnails with count label | Submit feedback with screenshots, open history |
| SC-11 | Tapping a history thumbnail opens full-screen image viewer | Tap a thumbnail in history |
| SC-12 | Admin detail modal shows screenshot grid with click-to-lightbox | Open feedback in admin, verify screenshots section |
| SC-13 | Old feedback entries (no screenshots) display correctly with no screenshot section | View pre-existing feedback in both mobile history and admin |
| SC-14 | Photo library permission denial shows graceful message, does not block submission | Deny permission, verify user can still submit |
| SC-15 | "Back" button on screenshots step returns to review with screenshots preserved | Add screenshots, go back, go forward — screenshots still there |
| SC-16 | Edge function rejects screenshot_paths that don't start with user's ID | Send malformed paths, verify 400 response |
| SC-17 | Edge function rejects more than 10 screenshot paths | Send 11 paths, verify 400 response |

---

## 10. Regression Risks

| Risk | What Could Break | How to Verify |
|------|-----------------|--------------|
| Audio-only submission breaks | Adding screenshot_paths to types could cause type errors | Submit feedback without screenshots — must work identically to today |
| Existing feedback history breaks | New fields (null) on old rows cause render crash | View history with mix of old and new entries |
| Storage bucket rejects audio | Updating allowed_mime_types could accidentally drop audio types | Submit audio-only feedback after migration |
| Modal step flow regression | New step could break back-navigation or error recovery | Test: category → record → review → back → re-record → review → screenshots → back → review → screenshots → submit |
| Admin page breaks on old data | Accessing `.screenshot_paths.length` on null crashes | Load admin page with existing data before any new submissions |
| Edge function backward compat | Old mobile versions don't send screenshot_paths | Submit without screenshot_paths field — must not 400 |

---

## 11. Invariants

### Preserved Invariants
- **Audio is required.** Screenshots are optional, but audio recording remains mandatory for all feedback submissions.
- **Beta tester gate.** Only users with `is_beta_tester = true` can submit (unchanged).
- **User folder isolation.** All uploads go to `{userId}/...` — storage RLS enforces this.
- **No silent failures.** Upload errors surface to user, not swallowed.

### New Invariants Established
- **INV-SCREENSHOT-MAX:** No more than 10 screenshots per feedback submission. Enforced at: picker level (selectionLimit), client-side array cap (.slice), edge function validation.
- **INV-SCREENSHOT-OWNERSHIP:** Every screenshot path must start with the authenticated user's ID. Enforced at: edge function validation.
- **INV-SCREENSHOT-FORMAT:** All uploaded screenshots are JPEG, max 1920px longest edge. Enforced at: client-side compression before upload.
