# Feature Spec: Beta Tester Feedback System

## Summary

Beta testers get a "Share Feedback" button on their Profile page that opens a modal where they can record up to 5 minutes of audio feedback, select a category, and submit. Submissions are stored with full device/context metadata. Beta testers can view and replay their past submissions. Admin access is handled by the separate Mingla admin repo, which hits the same Supabase project — this repo provides the database schema, RLS policies (including admin read/update access), storage bucket, and an `admin-feedback` edge function as the API contract.

## User Stories

- **As a beta tester**, I want to record audio feedback directly from my profile so I can quickly share thoughts without leaving the app.
- **As a beta tester**, I want to see my past feedback submissions so I know what I've already reported.
- **As an admin**, I want to browse all feedback with full user/device context so I can triage and act on it.

## Success Criteria

1. Only users with `is_beta_tester = true` see the feedback button on Profile
2. Audio recording works on both iOS and Android, up to 5 minutes
3. Each submission stores: user ID, display name, email, phone, device OS, OS version, device model, app version, screen the user was on before opening the modal, session duration, location (lat/lng), category, audio file URL, audio duration, timestamp
4. Beta testers can view a list of their past submissions and replay audio
5. Admins (users with `is_admin = true`) can access a web panel to browse all feedback
6. Audio files are stored in a private bucket with RLS — users access only their own, admins access all

---

## Database Changes

### Migration 1: Add role flags to profiles

```sql
-- Add beta tester and admin flags
ALTER TABLE profiles ADD COLUMN is_beta_tester BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;
```

### Migration 2: Create beta_feedback table

```sql
CREATE TABLE beta_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Category
  category TEXT NOT NULL CHECK (category IN ('bug', 'feature_request', 'ux_issue', 'general')),

  -- Audio
  audio_path TEXT NOT NULL,          -- Storage path: beta-feedback/{userId}/{filename}
  audio_url TEXT,                     -- Signed URL (generated after upload)
  audio_duration_ms INTEGER NOT NULL, -- Duration in milliseconds

  -- User snapshot (denormalized for admin convenience)
  user_display_name TEXT,
  user_email TEXT,
  user_phone TEXT,

  -- Device & context metadata
  device_os TEXT NOT NULL,            -- 'ios' or 'android'
  device_os_version TEXT,             -- e.g. '17.4.1'
  device_model TEXT,                  -- e.g. 'iPhone 15 Pro'
  app_version TEXT NOT NULL,          -- e.g. '1.0.0'
  screen_before TEXT,                 -- Screen user was on before opening modal
  session_duration_ms INTEGER,        -- How long the app session has been active
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,

  -- Admin fields
  admin_notes TEXT,                   -- Admin can add notes
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'actioned', 'dismissed')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for admin queries
CREATE INDEX idx_beta_feedback_created ON beta_feedback(created_at DESC);
CREATE INDEX idx_beta_feedback_user ON beta_feedback(user_id);
CREATE INDEX idx_beta_feedback_status ON beta_feedback(status);

-- Auto-update updated_at
CREATE TRIGGER set_beta_feedback_updated_at
  BEFORE UPDATE ON beta_feedback
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Migration 3: RLS policies for beta_feedback

```sql
ALTER TABLE beta_feedback ENABLE ROW LEVEL SECURITY;

-- Beta testers can read their own feedback
CREATE POLICY "Users can read own feedback"
  ON beta_feedback FOR SELECT
  USING (auth.uid() = user_id);

-- Beta testers can insert their own feedback
CREATE POLICY "Beta testers can insert feedback"
  ON beta_feedback FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_beta_tester = true)
  );

-- Admins can read all feedback
CREATE POLICY "Admins can read all feedback"
  ON beta_feedback FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- Admins can update feedback (status, notes)
CREATE POLICY "Admins can update feedback"
  ON beta_feedback FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
```

### Migration 4: Storage bucket for beta feedback audio

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'beta-feedback',
  'beta-feedback',
  false,
  52428800,  -- 50MB (5 min audio at 128kbps ≈ 4.8MB, generous buffer)
  ARRAY['audio/mp4', 'audio/x-m4a', 'audio/mpeg', 'audio/aac']
);

-- Users can upload to their own folder
CREATE POLICY "Beta testers can upload feedback audio"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'beta-feedback'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_beta_tester = true)
  );

-- Users can read their own audio
CREATE POLICY "Users can read own feedback audio"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'beta-feedback'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admins can read all feedback audio
CREATE POLICY "Admins can read all feedback audio"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'beta-feedback'
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );
```

---

## Edge Functions

### 1. `admin-feedback` (NEW)

**Route**: `POST /admin-feedback`
**Auth**: Requires authenticated user with `is_admin = true`

**Request schema**:
```typescript
type AdminFeedbackRequest =
  | { action: 'list'; page?: number; page_size?: number; status_filter?: string; category_filter?: string }
  | { action: 'get'; feedback_id: string }
  | { action: 'update_status'; feedback_id: string; status: 'new' | 'reviewed' | 'actioned' | 'dismissed' }
  | { action: 'add_note'; feedback_id: string; admin_notes: string }
  | { action: 'get_audio_url'; feedback_id: string }  // Returns fresh signed URL
```

**Response schema**:
```typescript
// list
{ data: BetaFeedback[]; total: number; page: number; page_size: number }

// get
{ data: BetaFeedback }

// update_status / add_note
{ success: true }

// get_audio_url
{ url: string; expires_in: 3600 }
```

**Validation**:
- Verify caller has `is_admin = true` in profiles table
- Validate action is one of the allowed values
- Validate status transitions
- Generate signed URLs with 1-hour expiry

### 2. `submit-feedback` (NEW)

**Route**: `POST /submit-feedback`
**Auth**: Requires authenticated user with `is_beta_tester = true`

**Why an edge function instead of direct insert?**
- Generates signed URL for audio playback after upload
- Denormalizes user snapshot (display_name, email, phone) at submission time
- Single atomic operation — no partial state if something fails
- Future: could trigger Slack notification to team

**Request schema**:
```typescript
interface SubmitFeedbackRequest {
  category: 'bug' | 'feature_request' | 'ux_issue' | 'general';
  audio_path: string;          // Storage path already uploaded
  audio_duration_ms: number;
  device_os: string;
  device_os_version: string;
  device_model: string;
  app_version: string;
  screen_before: string;
  session_duration_ms: number;
  latitude?: number;
  longitude?: number;
}
```

**Response schema**:
```typescript
{ success: true; feedback_id: string }
```

---

## Mobile Implementation

### Services

#### `app-mobile/src/services/betaFeedbackService.ts` (NEW)

```typescript
// --- Recording ---
class FeedbackRecorder {
  private recording: Audio.Recording | null = null;
  private startTime: number = 0;

  async initialize(): Promise<boolean>;
  // Request mic permission, set audio mode (same as voiceReviewService)

  async startRecording(): Promise<void>;
  // Create Audio.Recording with same codec settings as voiceReviewService
  // Store startTime = Date.now()

  async stopRecording(): Promise<{ uri: string; durationMs: number }>;
  // Stop, unload, return URI and duration

  async cancelRecording(): Promise<void>;
  // Stop and discard

  getElapsedMs(): number;
  // Date.now() - startTime (for UI timer)
}

// --- Upload & Submit ---
async function uploadFeedbackAudio(
  userId: string,
  localUri: string
): Promise<string>;
// Upload to beta-feedback/{userId}/{timestamp}.m4a
// Returns storage path

async function submitFeedback(
  params: SubmitFeedbackRequest
): Promise<{ feedback_id: string }>;
// Invoke submit-feedback edge function

// --- History ---
async function getUserFeedbackHistory(
  userId: string
): Promise<BetaFeedback[]>;
// SELECT * FROM beta_feedback WHERE user_id = ? ORDER BY created_at DESC

async function getFeedbackAudioUrl(
  audioPath: string
): Promise<string>;
// Generate signed URL for playback (1 hour expiry)
```

#### `app-mobile/src/services/deviceInfoService.ts` (NEW)

```typescript
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import Constants from 'expo-constants';

interface DeviceInfo {
  device_os: string;           // Platform.OS
  device_os_version: string;   // Device.osVersion
  device_model: string;        // Device.modelName
  app_version: string;         // Application.nativeApplicationVersion
}

function getDeviceInfo(): DeviceInfo;
// Synchronous collection of all device metadata
```

**Dependencies needed**: `expo-device`, `expo-application` (check if already installed, likely are with Expo)

#### `app-mobile/src/services/sessionTracker.ts` (NEW)

```typescript
// Simple module-level tracker
let sessionStartTime: number = Date.now();

function getSessionDurationMs(): number {
  return Date.now() - sessionStartTime;
}

function resetSession(): void {
  sessionStartTime = Date.now();
}
```

### Hooks

#### `app-mobile/src/hooks/useBetaFeedback.ts` (NEW)

```typescript
// --- Check if user is beta tester ---
function useIsBetaTester(): boolean;
// Reads from the profile query already cached by React Query
// Returns profiles.is_beta_tester ?? false

// --- Feedback history ---
function useFeedbackHistory() {
  return useQuery({
    queryKey: ['beta-feedback', 'history', userId],
    queryFn: () => getUserFeedbackHistory(userId),
    enabled: isBetaTester,
    staleTime: 5 * 60 * 1000, // 5 min
  });
}

// --- Submit mutation ---
function useSubmitFeedback() {
  return useMutation({
    mutationFn: submitFeedback,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['beta-feedback', 'history'] });
    },
  });
}
```

### Components

#### `app-mobile/src/components/BetaFeedbackButton.tsx` (NEW)

**Props**: none (reads beta tester status from hook)
**Renders**: Orange "Share Feedback" button — only visible when `useIsBetaTester()` returns true
**Placement**: In `ProfilePage.tsx`, between the Settings row and Legal footer
**On press**: Opens `BetaFeedbackModal`

#### `app-mobile/src/components/BetaFeedbackModal.tsx` (NEW)

**Props**: `{ visible: boolean; onClose: () => void }`

**States**:
1. **Category selection** — 4 tappable category pills (Bug, Feature Request, UX Issue, General)
2. **Recording** — Mic button, live timer (counts up to 5:00), stop button, cancel button
3. **Review** — Playback controls for recorded audio, re-record button, submit button
4. **Submitting** — Loading spinner, "Submitting feedback..." text
5. **Success** — Checkmark animation, "Thank you!" message, auto-close after 2s
6. **Error** — Error message with retry button

**Flow**:
```
Open modal → Select category → Tap record → Recording (timer counting up)
  → Tap stop → Review (play/re-record/submit)
    → Submit → Uploading → Success → Auto-close
```

**Recording constraints**:
- Max duration: 5 minutes (300,000 ms)
- Auto-stops at 5:00 with haptic feedback
- Minimum duration: 3 seconds (prevents accidental taps)
- Timer shows MM:SS format

**Metadata collected on submit**:
- `getDeviceInfo()` — OS, OS version, model, app version
- `getSessionDurationMs()` — how long the app has been open
- Current screen name (passed as prop or read from navigation state)
- Location from expo-location (if permission granted, otherwise null)

#### `app-mobile/src/components/FeedbackHistorySheet.tsx` (NEW)

**Props**: `{ visible: boolean; onClose: () => void }`

**Renders**:
- List of past submissions, sorted by date (newest first)
- Each item shows: category badge, date, duration, status
- Tap to expand → playback controls (expo-av `Audio.Sound`)
- Empty state: "No feedback submitted yet"

**Accessed from**: A "View History" link in the `BetaFeedbackModal` header area, or a secondary button on the Profile page next to "Share Feedback"

---

## Web Admin Panel (Out of Scope — Admin Repo)

The admin UI lives in the separate Mingla admin repo. This repo provides:
- **`admin-feedback` edge function** — full CRUD API (list, get, update status, add notes, get signed audio URLs)
- **RLS policies** — admins (`is_admin = true`) can SELECT and UPDATE all `beta_feedback` rows and SELECT all `beta-feedback` storage objects
- **Database schema** — the `beta_feedback` table with all metadata columns the admin UI needs

The admin repo team can either call the edge function or query Supabase directly — both paths are secured by RLS.

---

## Implementation Order

1. **Database migrations** — Add `is_beta_tester` + `is_admin` to profiles, create `beta_feedback` table, create `beta-feedback` storage bucket, add all RLS policies
2. **`deviceInfoService.ts`** — Install `expo-device` if needed, implement device info collection
3. **`sessionTracker.ts`** — Simple session duration tracker
4. **`betaFeedbackService.ts`** — FeedbackRecorder class (adapt from voiceReviewService), upload, submit, history functions
5. **`submit-feedback` edge function** — Validates beta tester, denormalizes user data, inserts record, generates signed URL
6. **`useBetaFeedback.ts` hook** — Beta tester check, history query, submit mutation
7. **`BetaFeedbackModal.tsx`** — Recording UI with category selection, timer, review, submit flow
8. **`FeedbackHistorySheet.tsx`** — Past submissions list with playback
9. **`BetaFeedbackButton.tsx`** — Conditional button on Profile page
10. **Integrate into `ProfilePage.tsx`** — Add button + modals
11. **`admin-feedback` edge function** — List, get, update, audio URL endpoints (API contract for admin repo)
12. **Manual test** — Set `is_beta_tester = true` on a test user via Supabase dashboard

---

## Test Cases

| # | Scenario | Input | Expected Result | Layer |
|---|----------|-------|-----------------|-------|
| 1 | Non-beta user visits Profile | `is_beta_tester = false` | No feedback button visible | Component |
| 2 | Beta user taps Share Feedback | `is_beta_tester = true` | Modal opens with category selection | Component |
| 3 | Record 10 seconds of audio | Tap record, wait 10s, stop | Audio clip saved locally, review screen shown | Service |
| 4 | Record hits 5-minute limit | Let recording run to 5:00 | Auto-stops, haptic feedback, review screen | Service |
| 5 | Submit feedback | Complete full flow | Row in `beta_feedback`, file in storage bucket | Edge Function + DB |
| 6 | View feedback history | Beta user with 3 past submissions | List shows 3 items, sorted newest first | Hook + Component |
| 7 | Playback past feedback | Tap item in history | Audio plays via signed URL | Service |
| 8 | Non-beta tries to insert directly | Direct Supabase insert without flag | RLS rejects with permission error | Database |
| 9 | Non-admin accesses admin endpoint | Regular user calls admin-feedback | 403 Forbidden | Edge Function |
| 10 | Admin browses feedback | Admin with `is_admin = true` | Sees all feedback from all users | Edge Function + Admin Panel |
| 11 | Admin updates status | Change status to "reviewed" | Status updated, `updated_at` refreshed | Edge Function + DB |
| 12 | Audio upload to wrong folder | Upload to `beta-feedback/other-user-id/` | RLS rejects — folder must match auth.uid() | Storage |

---

## Common Mistakes to Avoid

1. **Don't reuse `voice-reviews` bucket** — Keep feedback audio separate. Different retention, different access patterns, different RLS rules.
2. **Don't use `.json()` on edge function responses** — Use `edgeFunctionError.ts` utility. Read as `.text()` first, then `JSON.parse()`.
3. **Signed URL expiry** — Voice review service uses 1-year URLs. For feedback, use 1-hour URLs and regenerate on demand (admin panel and history playback).
4. **`expo-av` audio mode conflicts** — `setAudioModeAsync` is global. Save and restore previous mode after recording to avoid breaking other audio playback in the app.
5. **Storage path sanitization** — User IDs are UUIDs (safe), but if phone numbers ever enter the path, sanitize per the established pattern in `personAudioService.ts`.
6. **Don't call `expo-device` on web** — Guard with `Platform.OS` checks. Not relevant now but prevents future issues if code is shared.
7. **RLS policy ordering** — The "admins can read all" policy must not conflict with "users read own." Both use `FOR SELECT` — Postgres ORs them, so this is fine. Just verify in testing.

---

## Regression Prevention

### Structural Safeguards
- `CHECK` constraints on `category` and `status` columns prevent invalid values at DB level
- RLS `WITH CHECK` on insert verifies `is_beta_tester = true` — cannot be bypassed from mobile
- Storage RLS enforces folder-level isolation — cannot upload to another user's folder
- 5-minute recording limit enforced in code AND validated in edge function (duration_ms ≤ 300000)

### Validation Safeguards
- Edge function validates all required fields before insert
- Edge function verifies caller is beta tester (insert) or admin (read all)
- Category validated against enum both in UI (picker) and DB (CHECK constraint)

### Cache Safety
- Query key `['beta-feedback', 'history', userId]` includes userId — no cross-user cache leaks
- Submit mutation invalidates history query — new submission appears immediately
- Signed URLs have 1-hour TTL — stale URLs fail gracefully, UI regenerates on demand

### Regression Tests

| Test | Input | Expected Result |
|------|-------|-----------------|
| Insert without beta flag | `is_beta_tester = false`, direct insert | RLS rejects |
| Insert with beta flag | `is_beta_tester = true`, valid payload | Row created |
| Admin reads all | `is_admin = true`, SELECT * | Returns all rows |
| Non-admin reads all | `is_admin = false`, SELECT * | Returns only own rows |
| Invalid category | `category = 'invalid'` | CHECK constraint rejects |
| Audio > 5 min | `duration_ms = 400000` | Edge function rejects |
| Upload to wrong folder | Path doesn't match uid | Storage RLS rejects |

---

## Handoff to Implementor

**Build order**: Migrations → device/session services → feedback service (adapt voiceReviewService recorder pattern) → edge functions → hook → modal components → Profile page integration → admin panel.

**Key reuse**: The `FeedbackRecorder` class is nearly identical to `VoiceReviewRecorder` in `voiceReviewService.ts` — same expo-av setup, same codec, just change max duration from 60s to 300s. The modal follows the exact same pattern as `EditBioSheet` in ProfilePage (React Native `Modal`, transparent backdrop, white rounded card).

**New dependencies**: `expo-device` and `expo-application` (likely already in Expo, just need to import). No new npm packages.

**Admin panel**: Out of scope — admin repo team builds their UI against the `admin-feedback` edge function and/or direct Supabase queries (both secured by RLS).
