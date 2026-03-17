# Admin Dashboard — Full Analysis Report

**Date:** 2026-03-17
**Mode:** State Audit + Design + Copy Analysis
**Scope:** All 14 pages, 14 UI components, 3 contexts, navigation, and design system

---

## Executive Summary

The admin dashboard has solid engineering foundations — good auth, decent component library, dark mode, accessibility basics — but it was built feature-by-feature without a cohesive UX strategy. The result: **14 flat nav items with no grouping, inconsistent interaction patterns across pages, missing power-user features, no data export, client-side analytics that won't scale, terrible copy, and critical management workflows that are either missing or half-built.**

This report covers three perspectives:
1. **Architecture & Structure** — what exists, what's broken, what's missing
2. **Design & UX** — layout, flows, information architecture, interaction patterns
3. **Copy & Messaging** — every piece of text the admin sees

---

## Part 1: Architecture & Structure Audit

### 1.1 Navigation — Flat, Ungrouped, Disorienting

**Current state:** 14 sidebar items, all at the same level, in no logical order.

```
Dashboard → Analytics → Users → Subscriptions → Content → Tables → Seed & Scripts →
Place Pool → Photo & Pool → Beta Feedback → Reports → Email → Admin Users → Settings
```

**Problems:**
- No grouping. "Users" and "Subscriptions" are separated by nothing. "Place Pool" and "Photo & Pool" are adjacent but unrelated to "Beta Feedback" between them and "Reports" after.
- "Tables" and "Seed & Scripts" are developer tools mixed in with business operations.
- "Settings" page doesn't exist (nav item points to nothing — renders empty).
- "Dashboard" is the only overview; there's no way to quickly see health across areas.

**Recommended grouping:**

| Group | Pages | Why |
|-------|-------|-----|
| **Overview** | Dashboard | Entry point, health metrics |
| **People** | Users, Subscriptions, Admin Users | All user/admin management together |
| **Content** | Content Moderation, Place Pool, Photo Pool | All content curation together |
| **Operations** | Email, Reports, Beta Feedback | All operational/support workflows |
| **Intelligence** | Analytics | Data analysis and insights |
| **System** | App Config, Tables, Seed & Scripts | Developer/system tools (collapsible, bottom) |

### 1.2 Per-Page Gap Analysis

#### Overview Page
| What Exists | What's Missing |
|-------------|----------------|
| 8 stat cards (counts only) | Trend indicators (up/down vs yesterday/week) |
| Last 5 users | Quick actions (ban, view profile) on recent users |
| Last 5 feedback | Alerts/warnings (high report count, failed emails, expired caches) |
| | "View All" links to respective pages |
| | Cost projections from API usage |
| | System health indicators (edge function errors, RLS failures) |

#### Users Page
| What Exists | What's Missing |
|-------------|----------------|
| Search (name, email, phone) | Advanced filters: date range, country, subscription tier, activity |
| Status filter (active/banned) | Bulk actions (ban multiple, export segment, send email to segment) |
| Onboarding filter | User timeline/activity feed view |
| 18-tab detail view | Sortable columns (last active, created date, etc.) |
| Edit profile fields | CSV/JSON export |
| Ban/Unban | Notes/tags on users (internal admin annotations) |
| Full cascade delete | Role management (beyond just ban/active) |
| "Impersonate" view (misleading name) | Actual impersonation or "view as user" mode |
| | Quick stats per user (sessions, friends, interactions count) |

**Critical bug:** Client-side cascade delete across 40+ tables. If browser closes mid-delete, data is left in partial state. Must be a server-side RPC.

#### Subscriptions Page
| What Exists | What's Missing |
|-------------|----------------|
| Tier filter pills | Date range filter (when did they subscribe) |
| Override grant/revoke | Bulk override (e.g., grant Pro to all users in a city) |
| Override history per user | Revenue analytics / MRR tracking |
| | Stripe Connect integration visibility |
| | Subscription funnel (free → trial → pro → elite conversion rates) |
| | Expiring overrides alert |

#### Analytics Page
| What Exists | What's Missing |
|-------------|----------------|
| User growth chart | All analytics computed client-side — will collapse at scale |
| DAU/WAU/MAU | No date range picker (only preset 7/30/60/90) |
| Retention cohorts | No custom date ranges |
| Conversion funnel | No comparison periods (this week vs last week) |
| Geographic distribution | No export (CSV, PNG of charts) |
| | No map view for geo (Leaflet exists in project but not used here) |
| | No cost projections or API usage metrics |
| | No real-time dashboard / live counters |
| | No custom event tracking visualization |

**Scalability risk:** Growth tab fetches up to 50,000 profile rows client-side to count signups per day. Retention batches 200 user IDs at a time. These need server-side aggregation RPCs.

#### Content Moderation Page
| What Exists | What's Missing |
|-------------|----------------|
| 4 sub-tabs (Experiences, Cards, Reviews, Cache) | Bulk actions (approve/reject multiple) |
| Category/status filters | Image preview for cards and experiences |
| Toggle active/inactive | Review actions (approve/reject/flag) — currently read-only |
| Edit experiences/cards | Content queue (new content waiting for review) |
| Delete with confirmation | Automated flagging/scoring |
| | Content analytics (most viewed, most saved, etc.) |

#### Place Pool Builder
| What Exists | What's Missing |
|-------------|----------------|
| Google Places search + import | **No city/zipcode/region-based seeding** |
| Browse pool with map | No bulk import by city or area |
| Pool stats | No deduplication check |
| Category filter | No edit after import |
| | No place quality scoring |
| | No "seed database per launch city" workflow |
| | No radius-based exploration tool |

**This is one of the biggest gaps.** The user specifically wants to seed the database per launch city, zipcode, and region. The current Place Pool only supports individual search + import.

#### Photo Pool
| What Exists | What's Missing |
|-------------|----------------|
| Photo pipeline per category | No "run all" with progress |
| Approve/reject photos | No manual upload |
| Health scoring per category | No drag-and-drop |
| Coverage stats | No photo editing/cropping |

#### Beta Feedback
| What Exists | What's Missing |
|-------------|----------------|
| Audio playback with signed URLs | No transcription (admin must listen to each one) |
| Status management | No bulk status update |
| Category filter | Audio URL expires after 1h, no auto-refresh |
| Admin notes | No export |

#### Reports
| What Exists | What's Missing |
|-------------|----------------|
| Status filter pills | **Hard limit: 50 reports, no pagination** |
| Status update (review/resolve/dismiss) | No search |
| | Reporter/reported shown as UUIDs — no display names |
| | No detail modal — only truncated text visible |
| | No link to reported user's profile |
| | Can't re-open or change status after initial action |
| | No severity classification |

#### Email
| What Exists | What's Missing |
|-------------|----------------|
| Individual + bulk send | No HTML email / rich text editor |
| 4 templates | Templates hardcoded — can't edit without code change |
| History log | No email scheduling |
| Preference management | Only `{name}` placeholder supported |
| Segment by country/onboarding/status | No segment by city, zipcode, subscription tier, activity |
| | No A/B testing |
| | No open/click tracking |
| | Rate limit warning but no enforcement |

#### App Config
| What Exists | What's Missing |
|-------------|----------------|
| Feature flags (toggle) | No search/filter |
| Key-value config store | No audit trail (who changed what, when) |
| Integration management | `window.confirm()` for deletes instead of proper modal |
| | No config history/rollback |
| | No environment labels (dev/staging/prod) |

#### Table Browser
| What Exists | What's Missing |
|-------------|----------------|
| Browse all 54 tables | Read-only — no edit/insert/delete |
| Categorized sidebar | No column sorting or filtering |
| Pagination | No JSON cell expansion (just shows "JSON" badge) |
| | No SQL query runner (that's on Seed page, separate) |
| | No export |

#### Seed & Scripts
| What Exists | What's Missing |
|-------------|----------------|
| 4 predefined scripts | **Only 4 scripts, none for city/region seeding** |
| Custom SQL runner | No city/zipcode/region seed workflows |
| | SQL results not displayed (captured but not rendered) |
| | No transaction wrapping — partial failures leave DB inconsistent |
| | No confirmation modal for destructive scripts |
| | `exec_sql` RPC is a security risk in production |

#### Admin Users
| What Exists | What's Missing |
|-------------|----------------|
| Invite/accept/revoke flow | Only 2 roles (owner/admin) — no granular permissions |
| Magic link setup | No activity log per admin |
| | `admin_users` has anon read RLS — **security vulnerability** |
| | No role-based page access control |

#### Settings Page
**Does not exist.** The nav item "Settings" is listed but no `SettingsPage.jsx` exists. It renders nothing.

### 1.3 Cross-Cutting Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| No URL routing | Medium | `useState` navigation — no deep links, no browser back/forward, no bookmarkable pages |
| No data export | High | Zero pages offer CSV/JSON export of any data |
| No audit logging | High | Admin actions (ban, delete, config changes) aren't logged except email sends |
| Client-side analytics | High | Fetching 50K rows to count things. Will collapse at ~1K users |
| Duplicated utilities | Low | `timeAgo`, `formatDate` reimplemented across 4+ pages |
| Inconsistent pagination | Medium | Some pages use exact count, some use heuristics, Reports has a hard cap of 50 |
| Inconsistent delete confirmations | Low | Some pages use `Modal`, others use `window.confirm()` |
| No global keyboard shortcuts | Low | No Cmd+K search, no keyboard navigation between pages |
| DRY violation in auth screens | Low | LoginScreen and InviteSetupScreen share ~200 lines of identical code |
| Security: anon read on admin_users | Critical | Anyone can read admin email list without authentication |
| Security: exec_sql RPC | Critical | Arbitrary SQL execution available if RPC exists in production |

---

## Part 2: Design & UX Analysis

### 2.1 Information Architecture — Broken

**Problem:** The dashboard treats all 14 features as equal-weight sidebar items. An admin managing a launch city has to jump between Place Pool, Photo Pool, Seed Scripts, Users, Content, and Analytics — 6 different pages with no workflow connecting them.

**Missing workflows:**
1. **City Launch Workflow** — Seed places → assign photos → verify content → configure cards → set geo filters → monitor analytics. Currently requires visiting 6 unrelated pages.
2. **User Investigation Workflow** — See report → view reported user → check their content → take action. Currently: Reports shows UUIDs, no link to user profile.
3. **Content Pipeline** — Import places → generate cards → assign photos → moderate → publish. Currently fragmented across Place Pool, Content Moderation, and Photo Pool.

### 2.2 Filter & Search Patterns — Inconsistent

| Page | Search | Filters | Sorting |
|------|--------|---------|---------|
| Overview | None | None | None |
| Users | Server-side debounced | Status, Onboarding | None |
| Subscriptions | Server-side debounced | Tier pills | None |
| Analytics | None | Time range preset only | None |
| Content | Client-side | Category, Status, Sentiment | None |
| Place Pool | Mixed | Category | None |
| Photo Pool | None (filter buttons) | Category, Status | None |
| Beta Feedback | Server-side debounced | Status pills, Category pills | None |
| Reports | None | Status pills (client-side) | None |
| Email | Client-side (Prefs only) | Opted-out toggle | None |
| App Config | None | None | None |
| Tables | Sidebar filter only | None | None |
| Seed | None | None | None |
| Admin | None | None | None |

**Zero pages have column sorting.** This is a fundamental gap — admins can't sort users by last active, subscriptions by expiry date, feedback by rating, etc.

### 2.3 Empty States & Error Handling

- Most pages show basic empty text ("No results found") but miss the opportunity to guide the admin toward action.
- Error states mostly show a retry button, which is correct.
- No global error notification — errors are page-scoped only.

### 2.4 Responsive Design

- Sidebar collapses to drawer on mobile — good.
- Tables scroll horizontally — acceptable.
- Some pages don't adapt well (18-tab user detail, analytics charts).

### 2.5 Missing Power-User Features

1. **Global search** (Cmd+K) — search across users, content, places, config, tables
2. **Batch/bulk operations** — select multiple rows, apply action
3. **Saved filters** — save frequently used filter combinations
4. **Keyboard shortcuts** — navigate between pages, confirm modals, etc.
5. **Activity feed** — real-time log of all admin actions
6. **Notifications** — alert when reports spike, caches expire, emails fail

---

## Part 3: Copy & Messaging Audit

### 3.1 Page Headers — Generic and Unhelpful

| Current | Problem | Recommended |
|---------|---------|-------------|
| "Dashboard" / "Overview of your Mingla platform metrics" | Tells you nothing you can't see | "Dashboard" / Remove subtitle — the data speaks |
| "User Management" / "Browse, search, and manage all Mingla users" | Restates the nav item label | "Users" / Remove subtitle |
| "Subscription Management" / "View tiers, grant overrides, manage subscriptions" | Laundry list | "Subscriptions" / Remove subtitle |
| "Content Moderation" / "Manage experiences, card pool, and reviews" | Laundry list | "Content" / Remove subtitle |
| "Seed & Scripts" / "Run predefined seed scripts or custom SQL queries" | Developer language for an admin tool | "Database Tools" / "Run maintenance scripts or query data directly" |
| "Beta Feedback" / "Browse, play, and manage audio feedback from beta testers" | Fine but wordy | "Feedback" / Remove subtitle |
| "User Reports" / "Review and manage user-submitted reports" | Redundant | "Reports" / Remove subtitle |

**Rule: Page headers should be 1-2 words. Subtitles should be removed unless they add genuine context. The page content is the context.**

### 3.2 Empty States — Missed Opportunities

| Current | Problem | Recommended |
|---------|---------|-------------|
| "No users yet" | Passive | "No users have signed up yet. Share the app to get started." |
| "No feedback yet" | Dead end | "No feedback received. Users can submit feedback from the app's settings." |
| "No reports to review" | Fine | "All clear — no pending reports." (Positive framing) |
| "No results found" (generic) | Says nothing | Vary by context: "No users match that search" / "No places in the pool yet — import some from the Search tab" |

### 3.3 Action Labels — Vague or Wrong

| Current | Problem | Recommended |
|---------|---------|-------------|
| "Impersonate" button (Users) | Doesn't impersonate — it's a read-only profile viewer | "View as User" or "Preview Profile" |
| "PERMANENTLY Delete User" / "FULL WIPE" | Screaming caps, panic tone | "Delete User Permanently" — calm, clear, final |
| "Run" button on seed scripts | What does it run? | "Run Script" with the script name |
| "Gift" icon for grant override | Gift emoji is informal for a business action | "Override" or "Grant" |
| "Try Again" on error boundaries | Generic | "Reload" or "Retry" |

### 3.4 Warning & Confirmation Copy

| Current | Problem | Recommended |
|---------|---------|-------------|
| "Caution — Live Database. These scripts run directly against your production Supabase database." | Good intent, but "Supabase" is implementation detail | "Warning: These scripts modify live data. Changes cannot be undone." |
| "Resend free tier allows 100 emails/day" | Mentions vendor name | "Free plan limit: 100 emails per day. Upgrade for higher volume." |
| "They will fall back to their underlying tier (RevenueCat / trial / referral / free)" | Technical jargon | "They'll return to their current plan when the override expires." |

### 3.5 Template Copy — Needs Professional Rewrite

The 4 email templates are functional but read like developer placeholders:

**Welcome template:** "We're excited to have you join us!" — generic, says nothing about Mingla.

**Recommendation:** Every template should be rewritten by a copywriter with:
- Brand voice consistency
- Specific value propositions
- Clear CTAs
- Proper formatting (currently plain text only)

### 3.6 Stat Card Labels

| Current | Recommended |
|---------|-------------|
| "Total Users" | "Users" (total is implied) |
| "Card Pool" | "Cards" (pool is an implementation detail) |
| "Sessions" | "Collab Sessions" (sessions is ambiguous — could be user sessions) |
| "User Reports" | "Reports" (user is redundant in admin context) |

---

## Part 4: Missing Features — Priority Matrix

### P0 — Must Have (Blocking Admin Effectiveness)

| Feature | Why | Pages Affected |
|---------|-----|----------------|
| **City/Region Seeding Workflow** | Can't launch in new cities without manually importing places one by one | Place Pool, Seed, new CityLaunch page |
| **Column Sorting on All Tables** | Can't find what you need without sorting | All pages with tables |
| **Reports Pagination + User Names** | Reports page is broken above 50 reports and shows UUIDs | Reports |
| **Server-Side Analytics** | Client-side computation will timeout at scale | Analytics |
| **Data Export (CSV)** | No way to get data out of the system | All pages |
| **Audit Logging** | No accountability for admin actions | Cross-cutting |
| **Fix Security: anon read on admin_users** | Admin emails exposed to public | Admin |

### P1 — Should Have (Major UX Improvement)

| Feature | Why | Pages Affected |
|---------|-----|----------------|
| **Sidebar Grouping** | 14 flat items is disorienting | Navigation |
| **Global Search (Cmd+K)** | No way to quickly find a user, place, or config | Cross-cutting |
| **Bulk Actions** | Can't act on multiple items (ban users, approve photos, etc.) | Users, Content, Photos, Reports |
| **URL Routing** | Can't bookmark, share, or use browser back/forward | App.jsx |
| **Cost Projections Dashboard** | No visibility into API costs | New page or Analytics tab |
| **Advanced Filters** | Most pages have minimal or no filtering | Users, Subscriptions, Email |
| **Settings Page** | Nav item exists but page doesn't | New page |

### P2 — Nice to Have (Polish & Power Features)

| Feature | Why | Pages Affected |
|---------|-----|----------------|
| **Keyboard Shortcuts** | Power users want Cmd+K, Esc, arrow navigation | Cross-cutting |
| **Activity Feed** | Real-time log of all admin actions | New widget or page |
| **Email Templates in DB** | Can't edit templates without code change | Email |
| **Audio Transcription** | Must listen to every feedback audio manually | Beta Feedback |
| **HTML Email Editor** | Plain text only currently | Email |
| **Config Audit Trail** | No history of who changed what config | App Config |
| **Saved Filter Presets** | Frequently used filters require re-creating each time | All pages |

---

## Part 5: Recommended Restructure

### New Navigation Architecture

```
┌─ OVERVIEW
│  └─ Dashboard (enhanced with alerts, trends, cost projections)
│
├─ PEOPLE
│  ├─ Users (with advanced filters, bulk actions, export)
│  ├─ Subscriptions (with revenue metrics, bulk overrides)
│  └─ Admin Users (with role-based permissions)
│
├─ CONTENT
│  ├─ Moderation (with image preview, bulk approve/reject, queue)
│  ├─ Places (merged Place Pool + region seeding)
│  └─ Photos (with manual upload, bulk pipeline)
│
├─ OPERATIONS
│  ├─ Reports (with pagination, user links, severity)
│  ├─ Feedback (with transcription, bulk actions)
│  └─ Email (with HTML editor, scheduling, DB templates)
│
├─ INTELLIGENCE
│  └─ Analytics (server-side, custom date ranges, cost projections, map view)
│
├─ LAUNCH TOOLS
│  ├─ City Launcher (new: seed places + cards + photos for a city/region/zipcode)
│  └─ Database Tools (renamed Seed & Scripts, with visible query results)
│
└─ SYSTEM (collapsible, bottom)
   ├─ App Config (merged feature flags + config + integrations)
   ├─ Table Browser (with JSON expansion, column sorting)
   └─ Settings (new: dashboard preferences, notification settings)
```

### New Page: City Launcher

**Purpose:** One workflow to seed a new launch city.

**Flow:**
1. Select city / enter zipcode / draw region on map
2. Auto-search Google Places in that area (restaurants, bars, activities, attractions)
3. Preview results on map + table
4. Bulk import selected places to place_pool
5. Auto-run photo pipeline for imported places
6. Generate card_pool entries from imported places
7. Review + moderate generated content
8. Toggle city as "live"

**This is the single biggest missing feature in the admin dashboard.**

### Enhanced Overview Dashboard

Replace the current 8-count-only stat cards with:

1. **Health Indicators** — green/yellow/red for: pending reports, failed emails, expired caches, edge function errors
2. **Trend Metrics** — users this week vs last week, sessions this week vs last week
3. **Alerts** — "12 reports pending", "3 caches expired", "email quota at 80%"
4. **Cost Projections** — Google Places API calls this month, estimated cost
5. **Quick Actions** — "Review Reports", "Moderate New Content", "Check Feedback"

---

## Part 6: Immediate Action Items

### Quick Wins (< 1 day each)
1. Group sidebar nav items with section headers
2. Add column sorting to DataTable component
3. Fix Reports page: add pagination, fetch user display names, add detail modal
4. Remove `window.confirm()` — use Modal component everywhere
5. Rename "Impersonate" to "Preview Profile"
6. Fix Settings nav item (either build the page or remove the nav item)
7. Fix `admin_users` anon read RLS policy

### Medium Effort (1-3 days each)
8. Add CSV export to Users, Subscriptions, Analytics, Content pages
9. Add URL-based routing (React Router or similar)
10. Build the Settings page (theme, notification prefs, dashboard layout)
11. Add audit logging for all admin actions
12. Move analytics to server-side RPCs
13. Add global Cmd+K search

### Large Effort (3-7 days each)
14. Build City Launcher page + workflow
15. Add bulk actions across all table pages
16. Enhanced Overview dashboard with health, trends, alerts, costs
17. Rewrite all copy (headers, empty states, confirmations, email templates)
18. HTML email editor with DB-stored templates

---

## Handoff Summary

The admin dashboard has decent engineering but was built without UX strategy. The three biggest problems are: **(1)** flat navigation with no workflow grouping makes every task feel like hunting through a filing cabinet, **(2)** the complete absence of city/region seeding — the single most important admin workflow for launching Mingla in new markets — and **(3)** zero data export, zero audit logging, and client-side analytics that will break at scale. The copy throughout reads like developer placeholder text — generic headers, vague action labels, and email templates that could be for any product. The foundation is solid; what's needed is a UX-first restructure that groups features by admin workflow rather than by database table.
