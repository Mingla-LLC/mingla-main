# Admin Panel Spec: Beta Feedback Management

## Overview

The Mingla mobile app allows beta testers to record audio feedback (up to 5 minutes) with full device/context metadata. This spec defines what the admin panel needs to build to let admins browse, play, filter, and manage that feedback.

**Everything connects to the same Supabase project the admin panel already uses.**

---

## What Already Exists (Built in Mobile Repo)

### Database: `beta_feedback` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Feedback submission ID |
| `user_id` | UUID (FK → profiles) | Who submitted |
| `category` | TEXT | One of: `bug`, `feature_request`, `ux_issue`, `general` |
| `audio_path` | TEXT | Storage path: `beta-feedback/{userId}/{filename}.m4a` |
| `audio_url` | TEXT | Signed URL (may be expired — regenerate via edge function) |
| `audio_duration_ms` | INTEGER | Recording length in milliseconds |
| `user_display_name` | TEXT | Snapshot at submission time |
| `user_email` | TEXT | Snapshot at submission time |
| `user_phone` | TEXT | Snapshot at submission time |
| `device_os` | TEXT | `ios` or `android` |
| `device_os_version` | TEXT | e.g. `17.4.1` |
| `device_model` | TEXT | e.g. `iPhone 15 Pro` |
| `app_version` | TEXT | e.g. `1.0.0` |
| `screen_before` | TEXT | Which screen the user was on before opening the feedback modal |
| `session_duration_ms` | INTEGER | How long the app session had been active |
| `latitude` | DOUBLE PRECISION | User location at submission (nullable) |
| `longitude` | DOUBLE PRECISION | User location at submission (nullable) |
| `admin_notes` | TEXT | Free-text notes added by admins |
| `status` | TEXT | One of: `new`, `reviewed`, `actioned`, `dismissed` (default: `new`) |
| `created_at` | TIMESTAMPTZ | Submission timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp (auto-managed) |

### Database: `profiles` table (relevant columns)

| Column | Type | Description |
|--------|------|-------------|
| `is_beta_tester` | BOOLEAN | Whether the user can submit feedback |
| `is_admin` | BOOLEAN | Whether the user has admin access |

### Storage: `beta-feedback` bucket

- **Private** bucket (not publicly accessible)
- File format: `.m4a` (AAC audio)
- Path pattern: `beta-feedback/{userId}/{timestamp}.m4a`
- Max file size: 50MB

### RLS Policies (already configured)

Admins (`is_admin = true` on `profiles`) have:
- **SELECT** on all `beta_feedback` rows
- **UPDATE** on all `beta_feedback` rows (for status + notes)
- **SELECT** on all objects in `beta-feedback` storage bucket

No admin DELETE policy exists — feedback is never deleted.

---

## Option A: Use the `admin-feedback` Edge Function

A dedicated edge function is deployed at `POST /admin-feedback`. Authenticate with the admin user's Supabase session token (same auth flow the admin panel already uses).

### Actions

#### `list` — Get paginated feedback

**Request:**
```json
{
  "action": "list",
  "page": 1,
  "page_size": 20,
  "status_filter": "new",
  "category_filter": "bug"
}
```
- `page` — 1-indexed, default 1
- `page_size` — default 20, max 100
- `status_filter` — optional, one of: `new`, `reviewed`, `actioned`, `dismissed`
- `category_filter` — optional, one of: `bug`, `feature_request`, `ux_issue`, `general`

**Response:**
```json
{
  "data": [ /* array of beta_feedback rows */ ],
  "total": 142,
  "page": 1,
  "page_size": 20
}
```

#### `get` — Get single feedback with full details

**Request:**
```json
{
  "action": "get",
  "feedback_id": "uuid-here"
}
```

**Response:**
```json
{
  "data": { /* single beta_feedback row */ }
}
```

#### `update_status` — Change feedback status

**Request:**
```json
{
  "action": "update_status",
  "feedback_id": "uuid-here",
  "status": "reviewed"
}
```
Valid values: `new`, `reviewed`, `actioned`, `dismissed`

**Response:**
```json
{ "success": true }
```

#### `add_note` — Add or update admin notes

**Request:**
```json
{
  "action": "add_note",
  "feedback_id": "uuid-here",
  "admin_notes": "Confirmed this bug on iOS 17. Relates to ticket #234."
}
```

**Response:**
```json
{ "success": true }
```

#### `get_audio_url` — Get a fresh signed URL for audio playback

**Request:**
```json
{
  "action": "get_audio_url",
  "feedback_id": "uuid-here"
}
```

**Response:**
```json
{
  "url": "https://your-project.supabase.co/storage/v1/object/sign/beta-feedback/...",
  "expires_in": 3600
}
```
- Signed URLs expire in 1 hour — always call this before playing audio
- Use the URL in an HTML5 `<audio>` element

### Error Responses

All errors return:
```json
{
  "error": "Human-readable error message"
}
```

| HTTP Status | Meaning |
|-------------|---------|
| 401 | Not authenticated |
| 403 | Authenticated but not an admin (`is_admin = false`) |
| 400 | Invalid action, missing required fields, or invalid values |
| 404 | Feedback not found |

---

## Option B: Query Supabase Directly

Since the admin panel already has a Supabase client connected to the same project, you can skip the edge function entirely and query the database and storage directly. RLS handles authorization — as long as the logged-in user has `is_admin = true`, all policies apply.

### List feedback
```javascript
const { data, count } = await supabase
  .from('beta_feedback')
  .select('*', { count: 'exact' })
  .eq('status', 'new')           // optional filter
  .eq('category', 'bug')         // optional filter
  .order('created_at', { ascending: false })
  .range(0, 19);                 // pagination
```

### Update status
```javascript
await supabase
  .from('beta_feedback')
  .update({ status: 'reviewed' })
  .eq('id', feedbackId);
```

### Add admin notes
```javascript
await supabase
  .from('beta_feedback')
  .update({ admin_notes: 'Some note here' })
  .eq('id', feedbackId);
```

### Get signed audio URL
```javascript
const { data } = await supabase.storage
  .from('beta-feedback')
  .createSignedUrl(audioPath, 3600); // 1 hour expiry

// data.signedUrl → use in <audio src="...">
```

---

## Recommended Admin UI

### Feedback List View

| Column | Source | Notes |
|--------|--------|-------|
| Date | `created_at` | Format as relative time ("2 hours ago") + absolute on hover |
| User | `user_display_name` | Link to user profile if admin panel has that view |
| Category | `category` | Color-coded badge: 🔴 Bug, 🟣 Feature Request, 🟡 UX Issue, ⚪ General |
| Duration | `audio_duration_ms` | Format as MM:SS |
| Device | `device_os` + `device_model` | e.g. "iOS — iPhone 15 Pro" |
| App Version | `app_version` | |
| Status | `status` | Dropdown to change inline |

### Feedback Detail View (expand or click-through)

**User Info Section:**
- Display name, email, phone
- Device OS + version, device model, app version
- Screen they were on, session duration, location (map pin if lat/lng available)

**Audio Section:**
- HTML5 `<audio>` player with controls
- Duration display
- **Important:** Fetch a fresh signed URL via `get_audio_url` (or `createSignedUrl`) each time the detail view opens. URLs expire after 1 hour.

**Admin Section:**
- Status dropdown (new → reviewed → actioned / dismissed)
- Notes text area with save button
- Timestamps: submitted at, last updated at

### Filters & Search

- **Status filter**: Tabs or dropdown — All / New / Reviewed / Actioned / Dismissed
- **Category filter**: Multi-select checkboxes
- **Date range**: Date picker for start/end
- **Search**: By user name or email (filter client-side or add `.ilike('user_display_name', '%query%')`)

### Stats Dashboard (Optional)

- Total submissions (all time, this week, today)
- Breakdown by category (pie/bar chart)
- Breakdown by status
- Most active beta testers (submission count by user)
- Device distribution (iOS vs Android)

---

## Audio Playback Notes

- Format: `.m4a` (MPEG-4 AAC) — supported natively by all modern browsers
- Standard HTML5 audio element works: `<audio src="{signedUrl}" controls />`
- Max duration: 5 minutes
- Signed URLs expire in 1 hour — regenerate before playback
- If a URL returns 400/403, it's expired — just request a new one

---

## Summary

| What | Where |
|------|-------|
| Database table | `beta_feedback` in shared Supabase project |
| Storage bucket | `beta-feedback` in shared Supabase project |
| Edge function API | `POST /admin-feedback` with actions: list, get, update_status, add_note, get_audio_url |
| Direct Supabase access | Also works — RLS grants admin read/update on all rows |
| Auth requirement | User must have `is_admin = true` in `profiles` table |
| Audio format | `.m4a` (AAC), max 5 minutes, play via HTML5 `<audio>` |
