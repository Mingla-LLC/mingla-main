# Mingla Admin Dashboard

A custom web-based admin dashboard for the Mingla mobile app. Built with React + Vite + Tailwind CSS v4, connected directly to the Mingla Supabase backend. Lets the founder manage the database, view live stats, seed test data, run SQL scripts, and action user reports — all from a clean, professionally designed UI with full light/dark mode support.

---

## What This Is

The Mingla mobile app is a React Native (Expo) app for discovering personalized date and experience recommendations. This admin dashboard is a **separate web project** that talks to the same Supabase database as the mobile app. Think of it as the back-office control panel.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React 19 |
| Build Tool | Vite 7 |
| Styling | Tailwind CSS v4 (design token system with 100+ CSS custom properties) |
| Animations | Framer Motion (page transitions, toast exits, stagger reveals, filter animations) |
| Icons | Lucide React |
| Typography | Geist Sans / Geist Mono (loaded via CDN) |
| Database | Supabase (same project as mobile app) |
| Auth | Supabase Auth (email/password + email OTP 2FA) |
| Supabase Client | `@supabase/supabase-js` v2 (npm package) |
| Charts | Recharts (composable React charting library) |
| Maps | Leaflet + React-Leaflet (OpenStreetMap tiles, no API key needed) |
| Deployment | Vercel (free tier) |

---

## Project Structure

```
mingla-admin/
├── src/
│   ├── globals.css                  ← Design tokens & Tailwind config
│   ├── main.jsx                     ← Entry point with providers
│   ├── App.jsx                      ← Root component (auth routing)
│   ├── lib/
│   │   ├── supabase.js              ← Supabase client (uses .env)
│   │   ├── constants.js             ← Tables, table categories, stat cards, nav config, admin fallback allowlist
│   │   └── authHelpers.js           ← Password validation, brute-force lockout
│   ├── context/
│   │   ├── AuthContext.jsx           ← 2FA auth flow (password → OTP → session)
│   │   ├── ThemeContext.jsx          ← Light/dark mode
│   │   └── ToastContext.jsx          ← Toast notification system
│   ├── components/
│   │   ├── ErrorBoundary.jsx         ← Crash recovery UI
│   │   ├── LoginScreen.jsx           ← Multi-step login (password → OTP)
│   │   ├── InviteSetupScreen.jsx     ← Password setup for invited admins (magic link)
│   │   ├── layout/
│   │   │   ├── AppShell.jsx          ← Sidebar + Header + Content wrapper
│   │   │   ├── Sidebar.jsx           ← Collapsible nav, always dark
│   │   │   └── Header.jsx            ← Breadcrumbs, theme toggle, live indicator
│   │   └── ui/
│   │       ├── Avatar.jsx            ← Image/initials, 4 sizes, groups
│   │       ├── Badge.jsx             ← 7 variants + category badges
│   │       ├── Breadcrumbs.jsx       ← Clickable trail
│   │       ├── Button.jsx            ← 5 variants, 3 sizes, loading state
│   │       ├── Card.jsx              ← StatCard, SectionCard, AlertCard
│   │       ├── Dropdown.jsx          ← Click-outside close, keyboard nav
│   │       ├── Input.jsx             ← Text, password toggle, textarea, toggle switch
│   │       ├── Modal.jsx             ← Overlay, ESC close, focus management
│   │       ├── SearchInput.jsx       ← Icon + clear button
│   │       ├── Skeleton.jsx          ← Shimmer loading placeholders
│   │       ├── Spinner.jsx           ← 3 sizes + full-page loader
│   │       ├── Table.jsx             ← Sticky headers, pagination, empty states
│   │       ├── Tabs.jsx              ← Active border indicator
│   │       └── Toast.jsx             ← Slide-in notifications, auto-dismiss
│   └── pages/
│       ├── OverviewPage.jsx          ← Dashboard with stat cards & activity
│       ├── TableBrowserPage.jsx      ← Browse all 39 database tables
│       ├── SeedPage.jsx              ← Seed scripts & custom SQL runner
│       ├── PlacePoolBuilderPage.jsx   ← Search, import, browse & stats for place_pool
│       ├── UserManagementPage.jsx     ← User list, detail, edit, ban, delete, impersonate
│       ├── SubscriptionManagementPage.jsx  ← Subscription tiers, admin overrides
│       ├── PhotoPoolManagementPage.jsx ← Photo storage health, pool coverage, backfill ops
│       ├── BetaFeedbackPage.jsx       ← Audio feedback from beta testers
│       ├── ContentModerationPage.jsx  ← Experiences, card pool, reviews, curated cache
│       ├── AnalyticsPage.jsx          ← Charts: growth, engagement, retention, funnel, geo
│       ├── ReportsPage.jsx           ← User report management
│       ├── EmailPage.jsx             ← Email compose, history, preferences
│       ├── AdminPage.jsx             ← Admin user invite, accept & revoke
│       └── AppConfigPage.jsx         ← Feature flags, app config, integrations
├── supabase/
│   └── migrations/                  ← SQL migration files (admin_subscription_overrides, admin_backfill_log, admin_config, admin_place_refresh)
├── .env                              ← Supabase credentials (gitignored)
├── .env.example                      ← Template for .env setup
├── index.html
├── vite.config.js
├── package.json
└── README.md
```

---

## Design System

The dashboard implements a comprehensive design token system in `globals.css`, derived from the mobile app's `designSystem.ts` and `colors.ts` for brand consistency.

### Key Design Decisions

- **Brand color:** Orange `#f97316` (matching the Mingla mobile app)
- **Typography:** Geist Sans (body) / Geist Mono (code), with system font fallbacks
- **Border radius:** 8px (sm), 12px (md), 16px (lg), 24px (xl) — matches mobile card styling
- **Sidebar:** Always dark regardless of theme — intentional for visual anchoring
- **Dark mode:** Toggled via `data-theme="dark"` on `<html>`, respects `prefers-color-scheme` on first visit, persists to localStorage
- **Spacing:** Uses Tailwind's default scale which maps exactly to the spec (4px, 8px, 16px, 24px, 32px, 48px, 64px)
- **Page transitions:** Framer Motion `AnimatePresence mode="wait"` crossfade + slide (200ms ease-out) on every tab change
- **Stagger animations:** Framer Motion stagger (60ms delay between items) for stat cards, seed cards, and report cards
- **Filter animations:** Framer Motion `AnimatePresence` with height collapse for filtered report list items
- **Toast animations:** Framer Motion slide-in + slide-out with `popLayout` mode for smooth enter/exit
- **Hover-lift:** CSS utility class for cards that lifts 2px on hover with smooth shadow transition
- **Press feedback:** `active:scale-[0.98]` on all interactive buttons for tactile feel
- **Focus rings:** `focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2` on all interactive elements
- **Theme flash prevention:** Inline `<script>` in `<head>` applies dark mode before CSS/React loads — no white flash on reload
- **Sidebar label transitions:** CSS `max-width` + `opacity` transitions for smooth collapse/expand (no snap)
- **Favicon:** Mingla logo in browser tab (replaces default Vite icon)
- **Warm backgrounds:** Page background uses warm-tinted `#faf8f6` (not cold gray) for clear card/page contrast
- **Visible shadows:** Shadow tokens moved into Tailwind v4 `@theme` block so `shadow-sm`/`shadow-md` utilities use the custom values (multi-layer, visible on light backgrounds)
- **Header brand accent:** 2px orange bottom border on header for brand identity anchoring

### Component Library (14 components)

| Component | Variants / Features |
|-----------|-------------------|
| **Button** | primary, secondary, ghost, danger, link · sm/md/lg · loading spinner · icon support · active:scale press feedback · focus-visible ring |
| **Badge** | default, brand, success, warning, error, info, outline · status dot · category accent colors |
| **Card** | StatCard (KPI, colored left border, hover-lift), SectionCard (grouped content, subtitle, badge props), AlertCard (info/success/warning/error) |
| **Input** | Text, email, password (show/hide toggle), Textarea, Toggle switch · label, error, helper text |
| **Modal** | sm/md/lg sizes · overlay with backdrop blur · ESC close · focus trapping · focus restoration · destructive variant |
| **Toast** | success, error, warning, info · auto-dismiss (5s/8s/manual) · max 3 visible · Framer Motion enter/exit animations |
| **Table** | Sticky headers, striped rows, smart pagination, loading/empty states, custom cell renderers |
| **Spinner** | sm/md/lg · PageLoader with text |
| **Skeleton** | CSS shimmer class (bulletproof light/dark) · StatCard, TableRow, ListItem presets |
| **Avatar** | sm/md/lg/xl · image with error fallback · two-letter initials · bordered prop · AvatarGroup with +N overflow |
| **Tabs** | Active border indicator · keyboard accessible · `aria-controls` / `aria-selected` / `tabIndex` |
| **Dropdown** | Click-outside close, ESC, keyboard nav (Enter/Space/ArrowDown), ARIA roles, separator, labels, destructive items, `onClose` callback |
| **SearchInput** | Search icon, clear button |
| **Breadcrumbs** | Chevron separators, clickable ancestors, `aria-current="page"` on active |

---

## Features

### Dashboard (Overview)
- Live row counts for 8 key tables with skeleton loading states
- Stat cards with colored left accent borders, hover-lift animation, and staggered entrance
- Recent signups list (last 5 users) with avatar initials and onboarding status badges
- Recent app feedback list (last 5 entries) with 5-star color ratings, category badges, and platform labels
- Proper error states on all data fetches (not just silent failures)
- Responsive grid: 4 columns on desktop, 2 on tablet, 1 on mobile

### Table Browser
- Browse all 39 Supabase tables from a grouped, collapsible sidebar organized by category (Users, Experiences, Social, Collaboration, Calendar, Analytics, Caches)
- Paginated table view (20 rows per page) with smart page numbers
- Smart cell formatting: UUIDs auto-truncated with tooltip, ISO dates formatted as readable dates, JSON/boolean/null shown as typed badges
- Live row count per table in the sidebar
- Search filter for table names (auto-expands categories when filtering)
- Error state with retry button when table load fails

### Seed & Scripts
- Production warning banner ("Caution — Live Database") at the top of the page
- 4 pre-built one-click seed/maintenance scripts:
  - **Seed Demo Profiles** — inserts 5 test users
  - **Clear Expired Caches** — deletes stale Google Places, Ticketmaster, and Discover cache rows
  - **Reset Inactive Sessions** — marks old collaboration sessions inactive
  - **Clear Demo Data** — removes all `@mingla.app` test profiles
- Script cards with inline success/error result display and border color feedback
- Custom SQL runner with styled monospace textarea
- Toast notifications on success/failure
- Note: scripts require an `exec_sql` RPC function in Supabase

### User Reports
- View all user reports with reason, details, reporter ID, and timestamp
- Status filter pills with live counts (All, Pending, Reviewed, Resolved, Dismissed)
- Structured report cards with user avatar icon and metadata row
- Action buttons: Mark as Reviewed, Resolved, or Dismissed
- Status badges with color coding (pending/reviewed/resolved/dismissed)
- Proper error state when reports fail to load
- Toast feedback on status changes

### Place Pool Builder
- **Search & Import** — search for places globally via Google Places API (New), review results in a sortable table or interactive Leaflet map, select/deselect individual places, push approved places to `place_pool` with one click
- **Browse Pool** — view all existing `place_pool` entries with search by name, filter by city/type, active/inactive status filter, paginated table (20/page), single-row and bulk actions (refresh, deactivate, reactivate)
- **Pool Stats** — stat cards (total places, cities covered, avg rating, last added), price tier distribution bar chart, city breakdown table, type breakdown table (top 20)
- Google API calls go through the `admin-place-search` Supabase Edge Function — no API key exposed in the browser
- Deduplication: re-pushing existing places updates them (upsert on `google_place_id`), with "In Pool" badges shown in search results
- Map rendering uses Leaflet + OpenStreetMap (free, no extra API key)

### User Management
- **User list** — paginated, searchable table of all Mingla users with avatar, name, email, phone, gender, birthday, country, account type, onboarding status, active/banned status, and join date
- **Search & filter** — search by name, email, username, or phone; filter by onboarding status (completed/incomplete) and account status (active/banned); debounced search input (400ms)
- **Stats cards** — total users, active, banned, onboarding completion %, new this week
- **User detail view** — tabbed interface with 18 tabs showing all user-associated data: profile fields, preferences, saves (experiences + cards), friends, friend requests, friend links, saved people, blocked/muted users, conversations, boards, calendar entries, reviews & feedback, interactions, reports & app feedback, activity, sessions, location history, and preference change history
- **Inline edit** — edit display name, username, email, phone, country, account type, visibility mode, onboarding status, and active status directly from the detail view
- **Ban/unban** — toggle user's `active` status from the list view or detail view with instant feedback
- **Delete with confirmation** — destructive delete requires typing the user's username to confirm; cascades to related data if FK cascades are configured
- **Impersonate view** — read-only view of a user's saved experiences, saved cards, boards, and preferences as if you were them
- **Empty states** — all sections gracefully handle zero-data scenarios with descriptive messages

### Subscription Management
- **User subscription list** — paginated, searchable table of all users showing their effective subscription tier, resolved from the following priority chain: admin override > RevenueCat entitlement > active trial > referral reward > free
- **Search & filter by tier** — search by name or email, filter by effective tier (free / pro / elite) or by whether an admin override is currently active
- **Stats cards** — total users, free tier count, pro tier count, elite tier count, and number of active admin overrides
- **Grant tier overrides** — select any user and grant them a pro or elite override for a configurable duration (1 day, 7 days, 30 days, 90 days, or permanent); override is written to `admin_subscription_overrides` with the granting admin's ID and an optional reason
- **Revoke overrides early** — any active override can be revoked before its expiry; the override record is soft-deleted (revoked_at timestamp) and the user reverts to their natural tier
- **Full audit trail per user** — expand any user to see their complete override history: tier granted, duration, granted by, reason, start/end dates, and revocation info if applicable
- **Setup detection** — if the `admin_subscription_overrides` table does not exist, the page shows the required migration SQL with a one-click copy button so setup is self-guided
- **Requires:** `admin_subscription_overrides` table — migration SQL provided in `supabase/migrations/`

### Photo & Pool Management
- **Photo Storage Health** — stat cards showing total places, places with stored photos, places missing photos, coverage percentage, and estimated monthly cost from Google API on-demand fetching. Table of the top 200 missing-photo places sorted by impression cost (highest-cost gaps first) with checkbox selection for targeted backfill
- **Category Coverage** — grid of 12 Mingla category cards with color-coded health indicators (green/yellow/red based on card count and location diversity thresholds). Click any category to drill into location buckets showing card count, average rating, and photo coverage per geographic cluster
- **Location Coverage** — cross-category location bucket table sorted by card count ascending to surface "cold spots" (locations with fewer than 10 cards highlighted in red). Category breakdown badges show distribution across categories per location
- **Cost Monitor** — estimated daily and monthly costs from missing photos, recent 30-day backfill spend, configurable alert threshold with red warning banner when exceeded, weekly backfill cost bar chart (last 12 weeks)
- **Backfill Operations** — trigger photo backfill for selected places or all missing places; trigger category fill for a specific category + location with cost estimate shown before confirmation. All operations logged with operator, timestamp, status, success/failure counts, and estimated cost. Operations polling with progress bar
- **Backfill Log** — paginated table of all backfill operations with expandable error details, status badges (pending/running/completed/failed), and triggered-by name resolution
- **Concurrency guard** — prevents duplicate "backfill all missing" operations; returns existing log ID if one is already running
- **Setup detection** — if RPCs don't exist, shows migration SQL with retry button
- **Place Data Refresh** — admin-controlled Google Place Details refresh replacing the disabled automatic `refresh-place-pool` edge function (which cost ~$75/month). Shows staleness stats (total active, stale >7d, stale >30d, recently served & stale), two refresh modes with cost estimates and confirmation dialogs: "Refresh Recently Served" (only places users actually viewed in the last 7 days) and "Refresh All Stale" (all places with data older than 7 days, capped at 500). Concurrency guard prevents duplicate refresh operations.
- **Requires:** `admin_backfill_log` table, `admin_config` table — migration SQL in `supabase/migrations/20260317000002_admin_photo_pool_management.sql` and `supabase/migrations/20260317000003_admin_place_refresh.sql`

### Beta Feedback
- **Audio feedback browser** — paginated, searchable table of all beta tester audio feedback submissions with relative timestamps, user info, category badges, audio duration, device info, app version, and inline status dropdown
- **Audio playback** — HTML5 audio player with signed URL generation (1-hour expiry, auto-refresh on expiration); plays `.m4a` (AAC) recordings up to 5 minutes
- **Feedback detail view** — modal with full user info (name, email, phone), device context (OS, version, model, app version, screen before feedback, session duration), location coordinates, audio player, status management, and admin notes
- **Status management** — inline dropdown to change feedback status (New → Reviewed → Actioned / Dismissed) with optimistic local state updates and stats refresh
- **Admin notes** — free-text notes field with save button per feedback item; notes persist across sessions
- **Filters** — status filter pills (All / New / Reviewed / Actioned / Dismissed), category filter (All / Bug / Feature Request / UX Issue / General), search by user name or email
- **Stats cards** — total submissions, new, reviewed, actioned, dismissed counts with skeleton loading
- **Requires:** `beta_feedback` table and `beta-feedback` storage bucket in Supabase (created by mobile app); admin user must have `is_admin = true` in profiles for RLS access

### Content Moderation
- **Four sub-views** in a single Content tab: Experiences, Card Pool, Place Reviews, Curated Cache
- **Experiences** — browse all experiences with search by title, filter by category, paginated table (20/page), inline edit modal (title, category, price, duration, image URL), delete with confirmation
- **Card Pool** — browse all cards sorted by popularity, filter by type (single/curated) and status (active/inactive), deactivate/reactivate cards (soft toggle on `is_active`), view served count, popularity score, last served date
- **Place Reviews** — browse all user reviews with reviewer names (FK join with fallback), star ratings, sentiment badges, theme tags, voice/text type indicator; expandable detail panel showing full transcription, AI summary, processing status, audio file count; delete with confirmation
- **Curated Cache** — browse cached curated place bundles with location key, radius, category/place counts parsed from JSON, age display; delete individual entries or bulk clear all cache
- **Resilient data fetching** — all sub-views have loading, error, and empty states; reviews use FK join with automatic fallback to separate profile queries if the join fails
- **Debounced search** — 400ms debounce on all search inputs to avoid excessive queries

### Analytics
- **Five sub-views** in a single Analytics tab: User Growth, Engagement, Retention, Funnel, Geographic — with segmented control navigation and icon labels
- **User Growth** — daily signup line chart (Recharts) for selected time range (7d/30d/60d/90d), stat cards for total signups, avg per day, and peak day
- **Engagement** — DAU/WAU/MAU stat cards computed from `user_sessions` with distinct user counting, daily active users trend line chart, average session duration (capped at 2h to exclude outliers), feature usage horizontal bar chart from `user_interactions`
- **Retention** — weekly cohort retention table (last 8 weeks) with color-coded cells (green ≥70%, yellow ≥40%, orange ≥20%, red <20%), cohort size column, percentage in each subsequent week
- **Funnel** — 4-stage conversion funnel (Signed Up → Completed Onboarding → First Interaction → Joined a Board) with visual bar widths, counts, percentages, and drop-off numbers
- **Geographic** — top 20 countries by user count horizontal bar chart, stat cards for total countries, top country, and users with no country set
- **Time range toggle** — 7d/30d/60d/90d buttons for Growth and Engagement views (hidden for Retention/Funnel/Geo which use fixed ranges)
- **Production-grade** — loading spinners, error states with retry, empty states with descriptive messages, `mounted` guards on all async operations, parallel Supabase queries, batched IN queries for retention

### Email Communications
- **Three sub-views** in a single Email tab: Compose, History, Preferences
- **Compose** — send individual emails to specific addresses or bulk emails to user segments (all users, by country, onboarding status, or active/banned status)
- **Templates** — 4 pre-built email templates (Welcome, Feature Announcement, Scheduled Maintenance, We Miss You) with `{name}` personalization
- **Segment estimation** — real-time recipient count estimation before sending, with opt-out counts and rate limit warnings (Resend free tier: 100/day)
- **Email preview** — modal preview showing formatted email with from/to/subject/body before sending
- **Validation** — subject, body, and recipient email required; email format validation; confirmation dialog with recipient count before send
- **History** — paginated log of all sent emails with stats (total sent, today's count, failure rate), status badges (sent/partial/failed), detail modal with full body and segment info
- **Preferences** — read-only view of all user notification preferences (email, push, friends, messages, collabs, marketing) with search and opt-out filter
- **Privacy-respecting** — users who opted out of email (`email_enabled = false`) are excluded from bulk sends; admin cannot override preferences
- **Edge Function** — all emails sent via `admin-send-email` Supabase Edge Function using Resend API; no API keys exposed in browser
- **Setup detection** — if Resend is not configured, shows step-by-step setup instructions instead of the compose form
- **Requires:** `admin_email_log` table, `admin-send-email` Edge Function, Resend API key in Supabase secrets

### Admin Management
- **Invite new admins** — enter an email to grant dashboard access; stored in Supabase `admin_users` table. An invite email is automatically sent via Supabase magic link, which also creates their Supabase Auth account.
- **Magic link onboarding** — when an invited admin clicks the link in their email, they land on a branded "Set Password" screen (`InviteSetupScreen.jsx`) where they create their password. After setting it, they're immediately logged into the dashboard.
- **Accept pending invites** — invited admins appear in a "Pending Invites" section with Accept/Revoke buttons for manual activation
- **Auto-activation** — invited admins are automatically activated to "active" status on their first successful login (via magic link or normal 2FA)
- **Revoke access** — remove an admin's access with confirmation modal; revoked admins shown separately with re-invite option
- **Dynamic allowlist** — AuthContext fetches allowed emails from `admin_users` table on mount, merged with the hardcoded fallback list in `constants.js`. LoginScreen no longer checks the hardcoded list — AuthContext handles all authorization dynamically.
- **Owner protection** — the owner account (role: "owner") cannot be revoked or removed
- **Self-protection** — logged-in admin cannot revoke their own access
- **Setup guide** — if the `admin_users` table doesn't exist yet, the page shows the full setup SQL with a one-click copy button
- **Role badges** — Crown icon for owner, Shield icon for regular admins; "you" badge on your own row
- **Re-invite flow** — revoked admins can be re-invited (re-sends invite email) without creating a new record

### Settings (App Configuration & Integrations)
- **Three sub-views** in a single Settings tab: Feature Flags, App Config, Integrations — with pill-style segmented control navigation
- **Feature Flags** — create, toggle, and delete feature flags that the mobile app reads to enable/disable features without redeployment; card-based layout with enabled/disabled badges, snake_case enforcement, toggle with loading state, delete with confirmation
- **App Config** — key-value configuration store with typed values (string, number, boolean, JSON); create with type-specific input controls (number input, boolean dropdown, JSON textarea), inline edit with Enter/Escape keyboard shortcuts, type validation on create and edit, suggested defaults shown on empty state
- **Integrations** — view and manage third-party service connections (Google Places, OneSignal, Supabase, Resend); card grid with configured/not-configured status badges, API key preview (first 8 chars only — actual keys stay in Supabase secrets), additional config data as JSON, add new integrations, delete with confirmation
- **Requires 3 new Supabase tables:** `feature_flags`, `app_config`, `integrations` — SQL migrations provided in `FEATURE_APP_CONFIG_SPEC.md`

### Authentication & Security (3-Layer)
- **Layer 1 — Email Allowlist:** Only emails in `ALLOWED_ADMIN_EMAILS` (hardcoded fallback in `constants.js`) OR in the `admin_users` Supabase table can attempt login. AuthContext checks both sources dynamically.
- **Layer 2 — Password Verification:** Password must be 12+ characters with uppercase, lowercase, number, and special character. Validated client-side before server check. Supabase Auth verifies server-side.
- **Layer 3 — Email OTP (2FA):** After correct password, a 6-digit code is sent to the user's email via Supabase OTP. The code must be entered to create a session. No code = no access.
- **Brute-force Protection:** After 5 failed attempts (wrong password or wrong OTP), the form locks for 5 minutes. Lockout state persists in localStorage across page refreshes.
- **Session Security:** Password verification creates a temporary Supabase session that is immediately signed out. Only OTP verification creates the real session. A `mingla_2fa_complete` localStorage flag prevents session leaks if the page refreshes between password and OTP steps. Every session acceptance point (`getSession` on mount AND `onAuthStateChange` at runtime) checks both the allowlist AND the 2FA completion flag — no session is ever trusted without both checks passing.
- **Race Condition Prevention:** Three refs work together: `suppressSessionRef` blocks all auth events during password verification (prevents dashboard flash), `otpVerifiedRef` is set synchronously before `verifyOtp` so `onAuthStateChange` accepts the new session before `localStorage.setItem` runs, and the `FULL_AUTH_KEY` flag provides persistence across page refreshes.
- **Multi-step UI:** Step 1 shows email + password form with "Continue with Verification" button. Step 2 shows OTP input with "Verify & Sign In", plus "Back" and "Resend code" links.
- **OTP input:** 6 individual digit boxes with auto-advance, paste support, and keyboard navigation (arrow keys, backspace).
- **Password strength indicator:** Real-time visual bar with per-rule check marks (12+ chars, uppercase, lowercase, number, special).
- **Step indicator:** Visual 2-step progress bar (Credentials → Verify) with check marks for completed steps.
- **Login screen design:** Full-bleed white background (dark in dark mode) with centered card, subtle dot-grid background, brand-colored glow, entrance animations, shake animation on errors, and gradient CTA buttons. Generous spacing throughout — no overlap on any screen size.
- **Adding new admins:** Use the Admin Users tab to invite new admins (stores in Supabase `admin_users` table). The hardcoded `ALLOWED_ADMIN_EMAILS` in `constants.js` serves as a fallback so the owner can always log in even if the table doesn't exist. New admins also need a Supabase Auth account with matching email.

### Layout
- Collapsible sidebar (260px expanded, 72px collapsed) with smooth CSS label transitions
- Custom tooltips on collapsed sidebar items (replaces native `title` attribute)
- Sidebar active state: `bg-white/10` background with visible orange accent bar
- Mobile: sidebar becomes a slide-over overlay with fade-in backdrop animation
- Sticky header with functional breadcrumbs (chevron separators, click "Admin" to navigate to Dashboard), dark mode toggle, live indicator
- Framer Motion page transitions (`AnimatePresence mode="wait"`) on every tab change
- Content area: max-width 1280px, centered
- Responsive breakpoints: 640px / 768px / 1024px / 1280px / 1536px

### Dark Mode
- Toggle in the header (sun/moon icon)
- Inline `<script>` in `<head>` prevents white flash on dark mode page load
- Respects system `prefers-color-scheme` on first visit and listens for system theme changes at runtime
- Explicit-choice tracking: once user toggles manually, system theme changes are ignored (tracked via `EXPLICIT_KEY` localStorage flag)
- Persists preference to localStorage
- Login screen fully dark-mode-aware (all colors use CSS variables with light-mode fallbacks)
- Sidebar stays dark in both themes
- All UI components use CSS variables for colors — no hardcoded hex values in dark mode

---

## Stability & Reliability

### Issues Fixed from Previous Version
| Issue | Before | After |
|-------|--------|-------|
| **CDN dependency** | Supabase loaded from `esm.sh` (runtime CDN, can fail) | Proper npm package |
| **Hardcoded credentials** | Supabase URL + key in source code | `.env` file (gitignored) |
| **Single-file architecture** | 484-line `App.jsx` with inline styles | 30+ files, clean separation of concerns |
| **No error handling** | Component crash = white screen | ErrorBoundary with recovery UI |
| **Race conditions** | Table browser double-loaded on tab switch | Single `useEffect` with proper deps |
| **Memory leaks** | Auth subscription not cleaned up on unmount | `mounted` guards + subscription cleanup |
| **No loading states** | "Loading..." text only | Skeleton loaders, spinners, button loading states |
| **No accessibility** | No focus management, no ARIA | Focus rings, ARIA roles, keyboard navigation |
| **White flash on dark mode reload** | No theme applied until React mounts | Inline `<script>` in `<head>` applies `data-theme` before CSS loads |
| **Skeleton shimmer broken** | Conflicting Tailwind classes overwrite each other | Dedicated `.skeleton-shimmer` CSS class with light/dark variants |
| **Toast no exit animation** | CSS `slide-in-right` entry only, instant removal | Framer Motion `AnimatePresence mode="popLayout"` for smooth exit |
| **Sidebar active state invisible** | Orange accent on `bg-brand-500` background | `bg-white/10` background, orange accent bar now visible |
| **Sidebar labels snap on collapse** | Conditional render (`{!collapsed && <span>}`) | Always-rendered spans with CSS `max-width` + `opacity` transitions |
| **No page transitions** | Instant tab swap | Framer Motion `AnimatePresence mode="wait"` crossfade + slide |
| **Buttons feel dead** | No press or focus feedback | `active:scale-[0.98]` + `focus-visible:ring-2` on all buttons |
| **Avatar broken image** | Shows browser broken image icon | `onError` handler falls back to two-letter initials |
| **Vite favicon in browser tab** | Default Vite logo | Mingla logo favicon |
| **Double theme apply** | `useEffect` + direct calls both called `applyTheme` | Removed redundant `useEffect`, single apply path |

### Issues Fixed in Full Codebase Hardening (60+ fixes)
| Issue | Category | Fix |
|-------|----------|-----|
| **Dark mode missing grays** | CSS | Added `--gray-400` through `--gray-700` dark overrides, status color dark overrides, brand dark overrides, `::selection` dark styling |
| **ErrorBoundary weak reset** | Architecture | Key-based remount (`resetKey` state) forces full unmount/remount on recovery. Top-level wrapping in `main.jsx`, separate boundary around `ToastContainer` |
| **Button/Input DOM mutations** | React | Replaced all `e.currentTarget.style.X = Y` patterns with React state (`hovered`, `focused`, `pressed`) — eliminates re-render flicker |
| **SearchInput DOM mutations** | React | Same React state pattern for focus border/shadow |
| **Header hardcoded colors** | Dark mode | Live indicator and border use CSS variables with fallbacks |
| **Sidebar dead imports** | Cleanup | Removed unused `Settings`, `BarChart3`, `Bell` imports |
| **Sidebar tooltip bg** | Dark mode | Tooltip uses `var(--sidebar-bg)` instead of hardcoded `bg-gray-900` |
| **Sidebar ARIA** | Accessibility | Added `role="navigation"`, `role="list"`, `role="listitem"`, `aria-current="page"` |
| **Spinner Tailwind v4** | CSS | Replaced `border-t-brand-500` class with inline `borderTopColor` CSS variable |
| **Toast dark mode** | Dark mode | `VARIANT_CONFIG` uses CSS variables with fallbacks for all colors |
| **Badge dark mode** | Dark mode | `VARIANT_STYLES` uses CSS variables with fallbacks |
| **Breadcrumbs DOM mutation** | React | Extracted `BreadcrumbLink` component with React `hovered` state |
| **StatCard DOM mutation** | React | Replaced JS hover handlers with CSS `hover-lift` class |
| **Card padding redundancy** | Cleanup | Fixed `padding: "20px 20px"` to `padding: 20` |
| **AlertCard dark mode** | Dark mode | `ALERT_CONFIG` uses CSS variables with fallbacks |
| **Dropdown keyboard/ARIA** | Accessibility | Added Enter/Space/ArrowDown/Escape, `role="button"`, `tabIndex`, `aria-haspopup`, `aria-expanded`, focus return on close |
| **Modal focus trapping** | Accessibility | Tab wraps at boundaries, auto-focus first element on open, `FOCUSABLE_SELECTOR` pattern |
| **Tabs ARIA** | Accessibility | Added `aria-controls`, `id`, `tabIndex` for proper tab pattern |
| **Filter pills ARIA** | Accessibility | Added `aria-pressed` to ReportsPage filter buttons |
| **Supabase module crash** | Error handling | Replaced `throw` with `console.error` + placeholder client — lets ErrorBoundary handle failures gracefully |
| **Silent error swallowing** | Error handling | All bare `catch {}` blocks now capture `err` and log via `console.error` with contextual prefixes |
| **49 concurrent queries** | Performance | TableBrowser count queries batched 6 at a time with progressive UI updates |
| **SQL splitting breaks strings** | Data safety | Character-by-character parser respects single-quoted string literals with escaped quotes |
| **Array index React keys** | React | OverviewPage users use `u.email`, feedback uses `f.created_at + f.message` |
| **"1-0 of 0" pagination** | UI bug | Fixed `from` calculation: `total === 0 ? 0 : page * PAGE_SIZE + 1` |
| **String truncation no ellipsis** | UI | `formatCellValue` now appends `"..."` when truncating strings > 60 chars |
| **TableBrowser filter DOM mutation** | React | Replaced `onFocus`/`onBlur` style mutations with Tailwind `focus:border-[#f97316]` |
| **TableBrowser active state dark mode** | Dark mode | Uses `var(--color-brand-50)` and `var(--color-brand-700)` with fallbacks |
| **SeedPage icon circle dark mode** | Dark mode | Uses `var(--color-brand-50, #fff7ed)` |
| **SeedPage warning banner dark mode** | Dark mode | Uses `var(--color-warning-50, #fffbeb)` |
| **LoginScreen all-white dark mode** | Dark mode | Replaced 18 hardcoded hex colors in COLORS constant with CSS variables + fallbacks |
| **LoginScreen inputStyle hardcoded** | Dark mode | Input color, backgroundColor, border all use CSS variables |
| **LoginScreen outer bg** | Dark mode | Uses `login-screen-bg` CSS class instead of inline `backgroundColor` |
| **StepIndicator inactive circle** | Dark mode | Uses `var(--gray-100)` instead of `#f3f4f6` |
| **StepIndicator connector line** | Dark mode | Uses `var(--gray-200)` instead of `#e5e7eb` |
| **PasswordStrength bar bg** | Dark mode | Uses `var(--gray-200)` instead of `#f0f0f0` |
| **PasswordStrength separator dots** | Dark mode | Uses `var(--gray-300)` instead of `#d1d5db` |
| **Footer separator dot** | Dark mode | Uses `var(--gray-300)` instead of `#d1d5db` |
| **useCallback on keystroke deps** | Performance | Removed `useCallback` from `handlePasswordSubmit` and `handleOtpSubmit` (deps change every keystroke = zero memoization benefit) |
| **System theme listener broken** | Theme | Added `EXPLICIT_KEY` localStorage flag — system `prefers-color-scheme` changes only apply if user hasn't manually toggled |
| **ReportsPage addToast in deps** | React | Removed `addToast` from useEffect dependency array (stable context callback) |

### Defensive Patterns
- All `useEffect` data fetches have `mounted` flags to prevent state updates after unmount
- Modal locks body scroll and restores previous focus on close
- Toast timers are cleared on unmount to prevent orphaned timeouts
- Supabase client logs missing env vars gracefully (no module-level crash) and creates a placeholder client that fails cleanly
- ErrorBoundary catches component crashes and offers a "Try Again" button
- Auth `onAuthStateChange` is suppressed during password verification to prevent dashboard flash
- 2FA completion flag in localStorage prevents session leaks on page refresh during OTP step
- Brute-force lockout persists in localStorage — survives page refresh and tab close
- Failed signOut after password verification triggers an automatic retry
- AlertCard uses `<div>` (not `<p>`) for children to allow block-level content (lists, nested elements)
- Theme flash prevention script runs in `<head>` before any CSS or JS loads
- System `prefers-color-scheme` changes are listened for at runtime (only when user hasn't explicitly toggled, tracked via `EXPLICIT_KEY` localStorage flag)
- Sidebar labels always exist in DOM — CSS transitions handle visibility (no layout thrash from mount/unmount)
- Toast container always renders (even when empty) so `AnimatePresence` can animate exit of last toast
- `prefers-reduced-motion: reduce` disables skeleton shimmer and other animations for accessibility

---

## Running Locally

**Prerequisites:** Node.js 18+

```bash
# 1. Navigate to the project
cd mingla-admin

# 2. Copy environment variables
cp .env.example .env
# Then fill in your Supabase URL and anon key in .env

# 3. Install dependencies
npm install

# 4. Start the dev server
npm run dev
```

Then open your browser to `http://localhost:5173`.

Sign in with an email from the `ALLOWED_ADMIN_EMAILS` list, your password, and the 6-digit OTP code sent to your email.

### Supabase Setup Required for 2FA

Before the email OTP works, configure these in the Supabase Dashboard:

1. **Authentication → Providers → Email** — Enable "Email provider" and "Confirm Email"
2. **Authentication → Settings → Password** — Set minimum password length to **12**
3. **Authentication → Email Templates → Magic Link** — Update the body to include `{{ .Token }}` so the email shows the 6-digit code
4. **Authentication → Users** — Ensure your admin user exists and has a password meeting the strength rules (12+ chars, upper, lower, number, special)

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Your Supabase project URL (e.g. `https://xxx.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon/public key |

These are required. The app will throw a clear error on startup if they're missing.

> The anon key is the public-facing key — safe for client-side use. Never commit the `service_role` key.

> RLS (Row Level Security) is enabled on most tables. Some tables may return 0 rows if the anon user does not have read access. If a table appears empty unexpectedly, check the RLS policy in Supabase.

---

## Deploying to Vercel

```bash
# Install Vercel CLI (only once)
npm install -g vercel

# Deploy
vercel
```

Set environment variables in the Vercel dashboard:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

---

## Relationship to the Mobile App

| | Mobile App | Admin Dashboard |
|---|---|---|
| Repo | `github.com/sethogieva/Mingla` (private) | Separate local project |
| Framework | React Native (Expo) | React (Vite) |
| Supabase project | Same | Same |
| Design tokens | `designSystem.ts` + `colors.ts` | `globals.css` (derived from mobile) |
| Purpose | End-user experience | Founder management tool |

The mobile app and admin dashboard share the same Supabase database. Changes made in the dashboard (seeding, deleting rows, updating statuses) affect the live app.

---

## Recent Changes

- **Admin Place Data Refresh** — added Place Data Refresh tab to Photo & Pool Management page with staleness stats, two refresh modes (recently served / all stale), cost estimates, confirmation dialogs, and concurrency guard. New migration adds `place_refresh` operation type and `admin_trigger_place_refresh` RPC.
- **Beta Feedback Management** — added `BetaFeedbackPage.jsx` for browsing, playing, filtering, and managing audio feedback from beta testers. Includes HTML5 audio playback with signed URL generation, status management, admin notes, dual-axis filtering (status + category), search, and stats dashboard.
- **Photo & Pool Management** — added `PhotoPoolManagementPage.jsx` with 5 dashboard sections: photo storage health, category coverage with drill-down, location coverage cold spots, cost monitoring with weekly chart, and backfill operations log.
- **Subscription Management** — added `SubscriptionManagementPage.jsx` with full tier visibility, grant/revoke admin overrides, per-user audit trail, stats cards, and self-guided setup detection.

---

## What's Next

- [ ] Create `exec_sql` RPC function in Supabase to enable one-click script execution
- [x] Add Admin Management tab (invite, accept, revoke admin users)
- [x] Add Place Pool Builder tab (search, import, browse, stats)
- [x] Add a Users tab for managing individual profiles
- [x] Add Content Moderation tab (experiences, card pool, reviews, curated cache)
- [x] Add a Charts tab (signups over time, active sessions, popular categories)
- [x] Add Settings tab (feature flags, app config key-values, integrations viewer)
- [x] Add Email Communications tab (compose, history, preferences)
- [x] Add Subscription Management tab (view tiers, grant/revoke overrides, audit trail)
- [x] Add Photo & Pool Management tab (photo health, category coverage, location coverage, cost monitor, backfill log)
- [ ] Deploy to Vercel
- [ ] Add TypeScript (project structure is ready for incremental migration)

---

## Database Tables (39 total)

The dashboard connects to these tables in the `public` schema:

`admin_users` · `admin_email_log` · `admin_subscription_overrides` · `admin_backfill_log` · `admin_config` · `notification_preferences` · `feature_flags` · `app_config` · `integrations` · `profiles` · `preferences` · `preference_history` · `saves` · `saved_card` · `saved_experiences` · `saved_people` · `experiences` · `card_pool` · `place_pool` · `user_card_impressions` · `discover_daily_cache` · `google_places_cache` · `ticketmaster_events_cache` · `curated_places_cache` · `friends` · `friend_requests` · `friend_links` · `conversations` · `messages` · `conversation_participants` · `message_reads` · `blocked_users` · `muted_users` · `collaboration_sessions` · `session_participants` · `collaboration_invites` · `boards` · `board_cards` · `board_votes` · `board_card_rsvps` · `board_messages` · `board_card_messages` · `board_message_reads` · `board_card_message_reads` · `board_saved_cards` · `board_session_preferences` · `board_threads` · `board_typing_indicators` · `board_user_swipe_states` · `board_participant_presence` · `activity_history` · `calendar_entries` · `place_reviews` · `experience_feedback` · `person_experiences` · `person_audio_clips` · `scheduled_activities` · `user_interactions` · `user_sessions` · `user_activity` · `user_location_history` · `user_preference_learning` · `user_reports` · `app_feedback` · `undo_actions`
