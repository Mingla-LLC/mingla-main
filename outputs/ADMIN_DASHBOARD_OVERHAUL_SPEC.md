# Admin Dashboard Overhaul — Production Spec

**Version:** 1.0
**Date:** 2026-03-17
**Status:** Draft — awaiting approval before implementation
**Scope:** Full restructure of `mingla-admin/` — navigation, cross-cutting infrastructure, all 14 existing pages, 2 new pages, copy overhaul, security fixes

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Intended Outcome](#2-intended-outcome)
3. [Non-Goals](#3-non-goals)
4. [Architectural Constraints & Dependencies](#4-architectural-constraints--dependencies)
5. [Regression Risk Map](#5-regression-risk-map)
6. [Wave 1: Cross-Cutting Infrastructure](#6-wave-1-cross-cutting-infrastructure)
7. [Wave 2: Security Fixes](#7-wave-2-security-fixes)
8. [Wave 3: Page-Level Fixes](#8-wave-3-page-level-fixes)
9. [Wave 4: New Pages](#9-wave-4-new-pages)
10. [Wave 5: Copy Overhaul](#10-wave-5-copy-overhaul)
11. [Wave 6: Power-User Features](#11-wave-6-power-user-features)
12. [Wave 7: Polish & Consistency](#12-wave-7-polish--consistency)
13. [Implementation Order & Dependencies](#13-implementation-order--dependencies)
14. [Acceptance Criteria — Global](#14-acceptance-criteria--global)

---

## 1. Problem Statement

The admin dashboard was built feature-by-feature without a cohesive UX strategy. The result:

1. **Disorienting navigation.** 14 flat sidebar items with no grouping. Related workflows (Users + Subscriptions + Admin Users) are scattered. "Settings" nav item renders nothing.

2. **Missing critical workflows.** No way to seed a launch city. No bulk actions on any page. No data export. No audit trail of admin actions. No global search.

3. **Broken or incomplete pages.** Reports capped at 50 rows with UUIDs instead of names. Analytics fetches 50K rows client-side. Client-side cascade delete across 40 tables. `admin_users` RLS allows anon read.

4. **Inconsistent patterns.** Some pages use `window.confirm()`, others use `Modal`. Some have `mountedRef` guards, others don't. Pagination varies (exact count vs heuristic vs hard cap). Helper functions (`timeAgo`, `formatDate`) are duplicated across 4+ pages.

5. **Placeholder copy.** Generic headers that restate the nav label. Empty states that are dead ends. Action labels that mislead ("Impersonate" = read-only view). Vendor names (Supabase, Resend, RevenueCat) in user-facing text.

6. **No column sorting on any table.** Zero pages support sorting by any column.

---

## 2. Intended Outcome

After this overhaul, an admin can:

- **Navigate by workflow**, not by database table. Sidebar is grouped into People, Content, Operations, Intelligence, Launch Tools, System.
- **Launch a new city** in one workflow: define area → search places → import → generate cards → assign photos → moderate → go live.
- **Manage users at scale** with advanced filters (country, tier, date range, activity), bulk actions (ban, export, email), column sorting, and CSV export.
- **See dashboard health at a glance** with trend indicators, alerts (pending reports, expired caches, expiring overrides), and quick action links.
- **Trust the data** because analytics are computed server-side, pagination is consistent, and audit logging captures every admin action.
- **Work efficiently** with global Cmd+K search, keyboard shortcuts, sortable tables, and bulk operations.
- **Read clear copy** that guides action, not developer placeholder text.

---

## 3. Non-Goals

These are explicitly out of scope to prevent drift:

1. **No React Router library.** Use hash-based routing (`window.location.hash`) — no new dependency.
2. **No TypeScript migration.** Admin dashboard stays JSX.
3. **No Zustand or React Query.** Admin dashboard continues using React Context + direct Supabase calls.
4. **No real-time subscriptions.** Admin dashboard remains request/response. No Supabase Realtime channels.
5. **No mobile app changes.** This spec touches only `mingla-admin/` and `supabase/` (shared backend).
6. **No Stripe Connect integration UI.** Revenue metrics are out of scope.
7. **No A/B testing for emails.** Out of scope.
8. **No open/click tracking for emails.** Requires third-party integration beyond Resend.
9. **No audio transcription.** Requires Whisper/Deepgram integration — separate spec.
10. **No HTML rich text email editor.** Email body remains plain text with template placeholders. Adding a WYSIWYG editor is a separate project.
11. **No drag-and-drop photo upload.** Manual upload via file input is in scope; drag-and-drop is not.
12. **No saved filter presets.** Infrastructure could support this later, but not in this spec.
13. **No role-based page access control.** Admin roles (owner/admin/viewer) are in scope for the data model only. Enforcing page-level visibility is a follow-up.

---

## 4. Architectural Constraints & Dependencies

### 4.1 Confirmed Constraints (from code reading)

| # | Constraint | Source |
|---|-----------|--------|
| C1 | No React Router — `App.jsx` uses `useState("overview")` + `PAGES` map. All 14 pages render inside `AppShell`. | `App.jsx:49-93` |
| C2 | `NAV_ITEMS` IDs must match `PAGES` keys in `App.jsx`. `ICON_MAP` in `Sidebar.jsx` must include icons for all nav items. | `constants.js:102-117`, `Sidebar.jsx:26`, `App.jsx:25-40` |
| C3 | `activeTab` + `onTabChange` flows: `App.jsx` state → `AppShell` (props) → `Sidebar` + `Header`. Both `Sidebar.onTabChange` and `Header.onNavigate` call the same function. | `AppShell.jsx:6,22,30,35` |
| C4 | `AppShell` derives page title from `NAV_ITEMS.find(n => n.id === activeTab)?.label` with fallback `"Dashboard"`. | `AppShell.jsx:22` |
| C5 | Framer Motion `AnimatePresence` wraps page content in `App.jsx`. Page transition: `{opacity:0, y:8}` → `{opacity:1, y:0}` → `{opacity:0, y:-4}`, 200ms ease-out. | `App.jsx:42-47,66-73` |
| C6 | `DataTable` column contract: `{key, label, render?(value,row), className?, cellClassName?, width?}`. Row key: `row._key ?? row.id ?? index`. | `Table.jsx:67,88-92` |
| C7 | `Modal` manages `body.style.overflow = "hidden"` globally and has a focus trap. Nested modals will conflict (only one modal can own overflow at a time). | `Modal.jsx:36-53` |
| C8 | Brand color `#f97316` is hardcoded in 7+ component files, not fully tokenized to CSS custom property. `globals.css` defines `--brand-orange` but components use raw hex. | Multiple files |
| C9 | `AuthContext` uses `suppressSessionRef` + `otpVerifiedRef` + `initCompleteRef` refs for race condition handling. Any changes to auth flow must preserve these. | `AuthContext.jsx` |
| C10 | Provider nesting: `StrictMode > ErrorBoundary > ThemeProvider > AuthProvider > ToastProvider > App`. Auth depends on Theme being available. Toast depends on Auth being available. | `main.jsx` |
| C11 | No `exec_sql` RPC found in migrations. `SeedPage.jsx` calls it but it may not exist in the current deployment. The page shows "exec_sql RPC not found" fallback. | `SeedPage.jsx`, migrations |
| C12 | Edge functions use two different auth patterns: `admin-place-search` checks `admin_users` table; `admin-feedback` checks `is_admin` flag in `profiles`. | Edge function source |
| C13 | `delete-user` edge function already exists and handles comprehensive cascade deletion with proper ordering (auth first, then profile). | `supabase/functions/delete-user/index.ts` |
| C14 | `is_admin_user()` SQL helper already exists (checks caller email in `admin_users` where `status='active'`). Used by all subscription + photo pool RPCs. | Migration `20260317100001` |
| C15 | `admin_users` RLS: anon SELECT allowed (for login check), INSERT/UPDATE/DELETE require `is_admin_user()`. The anon SELECT is intentional for the pre-auth email check. | Migration `20260317200000` |
| C16 | `PlacePoolBuilderPage` `BrowsePoolView` already has checkbox selection + bulk deactivate. This is the only page with any bulk action support. | `PlacePoolBuilderPage.jsx` |
| C17 | `PhotoPoolManagementPage` uses RPC-based architecture (all data via `admin_pool_*` RPCs), not direct table queries. | `PhotoPoolManagementPage.jsx` |
| C18 | `EmailPage` `ComposeSubView` uses `callEdgeFunction` with `admin-send-email` edge function. The edge function handles estimation, individual send, and bulk send. | `EmailPage.jsx` |
| C19 | `ContentModerationPage` `ReviewsSubView` has a fallback pattern: tries FK join first, falls back to separate queries if join fails (tracked via `useRef`). | `ContentModerationPage.jsx` |
| C20 | Content moderation uses `curated_places_cache` (not `curated_experience_cache` as originally noted). Clear-all uses a workaround: `.delete().gte("created_at", "1970-01-01T00:00:00Z")`. | `ContentModerationPage.jsx` |

### 4.2 Assumptions (require verification)

| # | Assumption | Risk if Wrong |
|---|-----------|---------------|
| A1 | `exec_sql` RPC does not exist in current deployment (no migration found). SeedPage falls back gracefully. | If it does exist, it's a security hole. We proceed with replacing it regardless. |
| A2 | `admin_users` anon SELECT is needed for pre-auth email allowlist check in `AuthContext.fetchDynamicAdmins`. | If we restrict it, login flow breaks. We must preserve this specific read path. See §7.1. |
| A3 | All RPC functions (`admin_list_subscriptions`, `admin_pool_*`, etc.) are deployed and functional. | If any are missing, pages show setup screens (PGRST202 detection already exists). |
| A4 | Resend API key is configured via Supabase secrets, not env vars. | Email send will fail silently if not configured — existing behavior, not a new risk. |
| A5 | `delete-user` edge function is deployed and the client-side cascade in `UserManagementPage` is redundant legacy code. | If edge function isn't deployed, removing client-side cascade breaks delete. §8.3 addresses this. |

### 4.3 Open Questions

| # | Question | Impact | Default if Unanswered |
|---|----------|--------|-----------------------|
| Q1 | Should we add `react-router-dom` or use hash-based routing? | Affects URL structure, SSR potential, bundle size. | Hash-based (no new dep). |
| Q2 | Should `admin_users` anon SELECT be narrowed to only return `email, status` columns instead of `*`? | Reduces data exposure while preserving login check. | Yes, narrow it. |
| Q3 | For the City Launcher, does the `admin-place-search` edge function support bounding-box search, or only text query + city? | Determines if we need a new edge function. | Check edge function params; build `admin-city-search` if needed. |
| Q4 | Should the custom SQL runner be removed entirely, or kept as owner-only? | Security vs developer convenience. | Keep as owner-only with explicit RPC. |
| Q5 | Is there a `beta_feedback` table, or is beta feedback in `app_feedback`? | BetaFeedbackPage queries `beta_feedback`. | Assume `beta_feedback` exists (page works currently). |

---

## 5. Regression Risk Map

Every change in this spec is mapped to its regression risks and safeguards.

### 5.1 High-Risk Changes

| Change | Risk | Safeguard |
|--------|------|-----------|
| **Restructure `NAV_ITEMS`** (§6.1) | `PAGES` keys in `App.jsx` must match `NAV_ITEMS` IDs. `ICON_MAP` must include all icons. `AppShell.currentTitle` derives from `NAV_ITEMS`. | Update all three files atomically. Add fallback: unknown `activeTab` → `OverviewPage`. Existing fallback (`PAGES[activeTab] \|\| OverviewPage`) already handles this. |
| **Add hash routing** (§6.2) | `AnimatePresence` key changes could break page transitions. `activeTab` state must stay in sync with hash. Browser back/forward could trigger unexpected re-renders. | Hash → state sync is one-directional: `hashchange` sets `activeTab`. `activeTab` sets hash. Guard against loops. Keep `AnimatePresence` key as `activeTab` (unchanged). |
| **Add sorting to `DataTable`** (§6.3) | Pages that pass `rows` expect stable order. Adding `onSort` callback changes the component contract. Pages using client-side filtering after fetch could conflict with sort. | `sortable` is opt-in per column. No sorting by default — existing behavior preserved. `onSort` is optional callback — omitting it means DataTable does client-side sort on the already-provided `rows`. |
| **Modify `admin_users` RLS** (§7.1) | Login flow reads `admin_users` to build dynamic admin list. Tightening RLS could break authentication. | Only narrow SELECT to `email, status` columns. Keep anon SELECT for these columns. Test: new user can still log in after RLS change. |
| **Replace client-side delete with edge function** (§8.3) | If `delete-user` edge function fails or isn't deployed, delete is broken. | Check edge function existence before calling. If unavailable, fall back to current client-side cascade (preserve existing code as fallback, don't delete it). |
| **Move analytics to server-side RPCs** (§8.6) | New RPCs must exist before the page can use them. If migration isn't run, analytics page breaks. | Use the same PGRST202 detection pattern (already used by SubscriptionManagement and PhotoPool). Show setup screen with migration SQL if RPCs are missing. |

### 5.2 Medium-Risk Changes

| Change | Risk | Safeguard |
|--------|------|-----------|
| **Add `admin_audit_log` table** (§6.5) | Insert calls added to every mutation. If table doesn't exist, mutations could fail. | Wrap audit log insert in try/catch — never let audit failure block the primary mutation. Log errors to console. |
| **Extract shared utilities** (§6.6) | Import path changes across multiple files. If any import is missed, that page breaks. | Grep for every function name being extracted. Update every import. Verify no file still defines its own version. |
| **Add bulk actions to `DataTable`** (§11.2) | Checkbox column changes table layout. Selected state must be cleared on page change, filter change, and data refresh. | `selectable` prop is opt-in. Selection state managed by page, not DataTable. DataTable only renders checkboxes and calls `onSelect`. |

### 5.3 Low-Risk Changes

| Change | Risk | Safeguard |
|--------|------|-----------|
| Copy text changes (§10) | None (string-only changes) | Visual review. |
| `window.confirm()` → Modal (§6.7) | None (behavioral equivalent) | Same confirmation flow, better UI. |
| CSS/styling changes | Dark mode could miss new elements | Test every new component in both light and dark themes. |

---

## 6. Wave 1: Cross-Cutting Infrastructure

These changes provide shared foundations that all subsequent waves depend on.

### 6.1 Grouped Sidebar Navigation

**Files modified:** `constants.js`, `Sidebar.jsx`, `App.jsx`

#### 6.1.1 Data Model Change (`constants.js`)

Replace flat `NAV_ITEMS` array with grouped structure:

```js
export const NAV_GROUPS = [
  {
    label: null, // No header for top-level
    items: [
      { id: "overview", label: "Dashboard", icon: "LayoutDashboard" },
    ],
  },
  {
    label: "People",
    items: [
      { id: "users", label: "Users", icon: "Users" },
      { id: "subscriptions", label: "Subscriptions", icon: "CreditCard" },
      { id: "admin", label: "Admin Users", icon: "Shield" },
    ],
  },
  {
    label: "Content",
    items: [
      { id: "content", label: "Moderation", icon: "Layers" },
      { id: "placepool", label: "Places", icon: "Globe" },
      { id: "photopool", label: "Photos", icon: "Camera" },
    ],
  },
  {
    label: "Operations",
    items: [
      { id: "reports", label: "Reports", icon: "Flag" },
      { id: "feedback", label: "Feedback", icon: "Mic" },
      { id: "email", label: "Email", icon: "Mail" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { id: "analytics", label: "Analytics", icon: "BarChart3" },
    ],
  },
  {
    label: "Launch Tools",
    items: [
      { id: "citylauncher", label: "City Launcher", icon: "Rocket" },
      { id: "seed", label: "Database Tools", icon: "Terminal" },
    ],
  },
  {
    label: "System",
    collapsible: true,
    items: [
      { id: "settings", label: "Settings", icon: "Settings" },
      { id: "tables", label: "Table Browser", icon: "Database" },
    ],
  },
];

// Backward-compatible flat list (used by AppShell.currentTitle)
export const NAV_ITEMS = NAV_GROUPS.flatMap(g => g.items);
```

**Note:** `AppConfigPage` is merged into `SettingsPage` (§9.2). Its nav item is removed. The `PAGES` map in `App.jsx` keeps the `"settings"` key pointing to the new `SettingsPage`.

#### 6.1.2 Sidebar Render Change (`Sidebar.jsx`)

- Import `NAV_GROUPS` instead of `NAV_ITEMS`.
- Render groups with section headers: small uppercase text (`text-[10px] font-semibold uppercase tracking-wider text-[var(--sidebar-text)] opacity-50 px-5 pt-4 pb-1`).
- Groups with `label: null` render items only (no header).
- Groups with `collapsible: true` render with a chevron toggle. Collapsed state stored in `useState` (default: collapsed). When collapsed, items are hidden but the group header remains.
- When sidebar is collapsed (icon-only mode), group headers are hidden. Items render as before (icon-only with tooltip).
- Add `Rocket` to `ICON_MAP` (import from `lucide-react`).

**UX rationale:** Grouping by workflow domain (People, Content, Operations) matches how admins think about their tasks, not how the database is structured.

#### 6.1.3 App.jsx Update

Add to `PAGES` map:
```js
citylauncher: CityLauncherPage,
settings: SettingsPage,  // replaces the missing settings page
```

Remove from `PAGES`:
```js
// appconfig is now merged into settings
```

#### 6.1.4 Backward Compatibility

- `NAV_ITEMS` flat export is preserved for `AppShell.currentTitle` lookup.
- All existing page `id` values are unchanged — no URL or state breakage.
- `activeTab` values that existing pages set via `onTabChange` continue to work.

#### 6.1.5 Copy for Group Headers

| Group | Header Text | Collapsed Sidebar |
|-------|------------|-------------------|
| (top) | *(no header)* | *(no header)* |
| People | PEOPLE | hidden |
| Content | CONTENT | hidden |
| Operations | OPERATIONS | hidden |
| Intelligence | INTELLIGENCE | hidden |
| Launch Tools | LAUNCH | hidden |
| System | SYSTEM | hidden |

#### Acceptance Criteria
- [ ] Sidebar renders 7 groups with correct headers
- [ ] System group is collapsible (default collapsed)
- [ ] Collapsed sidebar (icon-only) hides group headers
- [ ] Mobile drawer renders identically to expanded sidebar
- [ ] All existing page IDs continue to work
- [ ] `AppShell.currentTitle` resolves correctly for all pages
- [ ] No Framer Motion transition regressions (same `activeTab` key pattern)

---

### 6.2 Hash-Based URL Routing

**Files modified:** `App.jsx`

#### 6.2.1 Implementation

Replace `useState("overview")` with hash-synchronized state:

```js
function getTabFromHash() {
  const hash = window.location.hash.replace("#/", "").split("?")[0];
  return PAGES[hash] ? hash : "overview";
}

function App() {
  const [activeTab, setActiveTab] = useState(getTabFromHash);

  useEffect(() => {
    const onHashChange = () => setActiveTab(getTabFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const handleTabChange = useCallback((tabId) => {
    window.location.hash = `#/${tabId}`;
    // hashchange event will update state — no direct setState needed
  }, []);

  // ... rest unchanged, pass handleTabChange as onTabChange
}
```

#### 6.2.2 URL Structure

| Page | URL |
|------|-----|
| Dashboard | `#/overview` |
| Users | `#/users` |
| Analytics | `#/analytics` |
| City Launcher | `#/citylauncher` |
| Settings | `#/settings` |
| (no hash) | redirects to `#/overview` |
| (invalid hash) | renders Overview (existing fallback) |

#### 6.2.3 Behavior

- **Browser back/forward:** Works — `hashchange` fires, `activeTab` updates, page transitions animate.
- **Page refresh:** URL preserved — user returns to same page.
- **Deep linking:** Admins can share URLs like `#/reports` or `#/users`.
- **`AnimatePresence` key:** Stays `activeTab` — no change to transition behavior.
- **Initial load with no hash:** Sets hash to `#/overview` without creating a history entry (use `replaceState`).

#### 6.2.4 Loop Prevention

`handleTabChange` sets `window.location.hash`. The `hashchange` listener calls `setActiveTab`. This is one-directional (no loop) because `setActiveTab` does not modify the hash.

#### Acceptance Criteria
- [ ] URL updates when navigating between pages
- [ ] Browser back/forward navigates between visited pages
- [ ] Page refresh stays on the same page
- [ ] Invalid hash falls back to overview
- [ ] No infinite loop between hash and state
- [ ] Page transitions still animate correctly
- [ ] Sidebar active indicator matches URL, not just state

---

### 6.3 Column Sorting on DataTable

**Files modified:** `Table.jsx`

#### 6.3.1 New Props

```js
// New optional props added to DataTable
{
  sortKey: string | null,          // Currently sorted column key
  sortDirection: "asc" | "desc",   // Current sort direction
  onSort: (key, direction) => void, // Callback when header is clicked
  // If onSort is not provided but column has sortable:true,
  // DataTable does client-side sort on `rows`
}
```

#### 6.3.2 Column Extension

```js
// Column objects gain optional `sortable` property
{ key: "created_at", label: "Joined", sortable: true, render: ... }
```

#### 6.3.3 Behavior

1. **Header click on sortable column:**
   - If `onSort` prop exists: calls `onSort(key, newDirection)`. Page handles server-side sort.
   - If `onSort` prop is absent: DataTable sorts `rows` locally using `Array.from(rows).sort(comparator)`.
2. **Sort indicator:** Chevron up/down icon in header cell, only on the active sort column.
3. **Default comparator:** String comparison with `localeCompare` for strings, numeric comparison for numbers, date comparison for ISO date strings. `null`/`undefined` sort last.
4. **Sort direction cycle:** null → asc → desc → null (click three times to clear sort).

#### 6.3.4 Visual Design

- Sortable column headers show a subtle `ChevronUp`/`ChevronDown` icon (12px, `opacity-30`) on hover.
- Active sort column shows icon at full opacity with `text-[#f97316]` color.
- Non-sortable headers remain unchanged.

#### 6.3.5 Backward Compatibility

- All existing DataTable usages have no `sortKey`/`sortDirection`/`onSort` props → no sorting UI appears → zero behavior change.
- Adding `sortable: true` to individual columns is opt-in per page.

#### Acceptance Criteria
- [ ] Clicking a sortable header cycles through asc → desc → none
- [ ] Sort indicator shows correct direction
- [ ] Client-side sort works for strings, numbers, dates, nulls
- [ ] Server-side sort (`onSort` callback) fires with correct key and direction
- [ ] Existing tables without `sortable` columns are visually and behaviorally unchanged
- [ ] Sort state resets when data reloads (page change, filter change)
- [ ] Pagination resets to page 1 when sort changes

---

### 6.4 CSV Export Utility

**New file:** `lib/exportCsv.js`

#### 6.4.1 Implementation

```js
export function exportCsv(columns, rows, filename) {
  const headers = columns.map(c => c.label);
  const csvRows = rows.map(row =>
    columns.map(c => {
      const val = row[c.key];
      if (val == null) return "";
      if (typeof val === "object") return JSON.stringify(val);
      const str = String(val);
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(",")
  );
  const csv = [headers.join(","), ...csvRows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
```

**Note:** BOM prefix (`\uFEFF`) ensures Excel opens UTF-8 correctly.

#### 6.4.2 Integration Pattern

Each page adds an "Export" button in its toolbar area:

```jsx
<Button variant="secondary" size="sm" icon={Download}
  onClick={() => exportCsv(columns, rows, "users")}>
  Export
</Button>
```

For pages with server-side pagination, export fetches ALL rows first (with a loading state on the button), then calls `exportCsv`. Maximum export: 10,000 rows (hardcoded limit to prevent memory issues).

#### 6.4.3 Pages That Get Export

| Page | Exportable Data | Filename |
|------|----------------|----------|
| Users | User list (current filters applied) | `users` |
| Subscriptions | Subscription list (current filters) | `subscriptions` |
| Content → Experiences | Experiences list | `experiences` |
| Content → Card Pool | Card pool list | `card_pool` |
| Content → Reviews | Reviews list | `reviews` |
| Place Pool → Browse | Pool places | `places` |
| Beta Feedback | Feedback list | `beta_feedback` |
| Reports | Reports list | `reports` |
| Email → History | Email log | `email_history` |
| Email → Preferences | Notification preferences | `notification_prefs` |
| Table Browser | Current table data | `{tableName}` |
| Analytics → Growth | Signups by day | `signups` |
| Analytics → Geo | Countries | `geo_distribution` |

#### Acceptance Criteria
- [ ] CSV downloads with correct filename and date suffix
- [ ] Excel opens the file correctly (UTF-8 BOM)
- [ ] Values with commas, quotes, and newlines are properly escaped
- [ ] Null values export as empty strings
- [ ] JSON values export as stringified JSON
- [ ] Export button shows loading state during fetch-all
- [ ] Export respects current filters (does not export unfiltered data)
- [ ] Maximum 10,000 rows with toast warning if limit reached

---

### 6.5 Audit Logging

**New migration:** `YYYYMMDD_create_admin_audit_log.sql`
**New file:** `lib/auditLog.js`

#### 6.5.1 Database Schema

```sql
CREATE TABLE admin_audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_log_created_at ON admin_audit_log (created_at DESC);
CREATE INDEX idx_audit_log_admin ON admin_audit_log (admin_email);
CREATE INDEX idx_audit_log_action ON admin_audit_log (action);

-- RLS
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read audit log"
  ON admin_audit_log FOR SELECT
  USING (is_admin_user());

CREATE POLICY "Admins can insert audit log"
  ON admin_audit_log FOR INSERT
  WITH CHECK (is_admin_user());
```

#### 6.5.2 Action Taxonomy

| Action | Target Type | Used By | Metadata |
|--------|------------|---------|----------|
| `user.ban` | `user` | Users | `{display_name}` |
| `user.unban` | `user` | Users | `{display_name}` |
| `user.delete` | `user` | Users | `{display_name, email}` |
| `user.edit` | `user` | Users | `{fields_changed: [...]}` |
| `subscription.grant_override` | `user` | Subscriptions | `{tier, duration_days, reason}` |
| `subscription.revoke_override` | `override` | Subscriptions | `{user_display_name}` |
| `content.toggle_active` | `experience`/`card` | Content | `{title, is_active}` |
| `content.edit` | `experience`/`card` | Content | `{title, fields_changed}` |
| `content.delete` | `experience`/`card`/`review` | Content | `{title}` |
| `config.create` | `flag`/`config`/`integration` | App Config | `{key}` |
| `config.update` | `flag`/`config`/`integration` | App Config | `{key, old_value, new_value}` |
| `config.delete` | `flag`/`config`/`integration` | App Config | `{key}` |
| `admin.invite` | `admin` | Admin Users | `{email}` |
| `admin.accept` | `admin` | Admin Users | `{email}` |
| `admin.revoke` | `admin` | Admin Users | `{email}` |
| `email.send` | `email` | Email | `{subject, recipient_count, segment}` |
| `seed.run` | `script` | Seed | `{script_label}` |
| `place.import` | `place` | Place Pool | `{count}` |
| `place.toggle_active` | `place` | Place Pool | `{name, is_active}` |
| `feedback.update_status` | `feedback` | Beta Feedback | `{old_status, new_status}` |
| `report.update_status` | `report` | Reports | `{old_status, new_status}` |
| `photo.backfill` | `photo` | Photo Pool | `{mode, count}` |

#### 6.5.3 Client Utility

```js
// lib/auditLog.js
import { supabase } from "./supabase";

export async function logAdminAction(action, targetType, targetId, metadata = {}) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await supabase.from("admin_audit_log").insert({
      admin_email: session.user.email,
      action,
      target_type: targetType,
      target_id: targetId,
      metadata,
    });
  } catch (err) {
    console.error("Audit log failed:", err);
    // Never block the primary action
  }
}
```

#### 6.5.4 Integration Pattern

After every successful mutation, call `logAdminAction`:
```js
const { error } = await supabase.from("profiles").update({ active: false }).eq("id", userId);
if (!error) {
  logAdminAction("user.ban", "user", userId, { display_name: user.display_name });
}
```

**Critical: audit logging must never block or fail the primary action.** The try/catch in `logAdminAction` ensures this.

#### Acceptance Criteria
- [ ] Every mutation listed in the action taxonomy triggers an audit log entry
- [ ] Audit log failure does not block primary mutation
- [ ] Audit log entries include admin email, action, target, and metadata
- [ ] Overview page shows latest 50 audit entries (§8.2)
- [ ] Audit log table has proper RLS (admin-only read/write)

---

### 6.6 Shared Utility Extraction

**New file:** `lib/formatters.js`

#### 6.6.1 Functions to Extract

```js
export function timeAgo(dateStr) { /* from UserManagementPage */ }
export function formatDate(dateStr) { /* from UserManagementPage */ }
export function formatDateTime(dateStr) { /* from UserManagementPage */ }
export function formatRelativeTime(dateStr) { /* from EmailPage */ }
export function escapeLike(str) { /* from ContentModerationPage */ }
export function truncate(str, max) { /* from ContentModerationPage */ }
```

#### 6.6.2 Files to Update (remove inline definitions, add imports)

- `UserManagementPage.jsx` — `timeAgo`, `formatDate`, `formatDateTime`
- `ContentModerationPage.jsx` — `timeAgo`, `formatDate`, `truncate`, `escapeLike`
- `SubscriptionManagementPage.jsx` — verify if it has its own formatters
- `BetaFeedbackPage.jsx` — verify formatters
- `EmailPage.jsx` — `formatRelativeTime`, `formatFullDate`
- `PhotoPoolManagementPage.jsx` — verify formatters

#### Acceptance Criteria
- [ ] No page defines its own `timeAgo`, `formatDate`, `formatDateTime`, or `escapeLike`
- [ ] All pages import from `lib/formatters.js`
- [ ] Output of every formatter function is identical to the original (exact same format strings)
- [ ] No visual or behavioral change on any page

---

### 6.7 Replace `window.confirm()` with Modal

**Files modified:** `AppConfigPage.jsx`, `EmailPage.jsx`, `PlacePoolBuilderPage.jsx`

#### 6.7.1 Inventory of `window.confirm()` Calls

| File | Current Usage | Replacement |
|------|--------------|-------------|
| `AppConfigPage.jsx` — FeatureFlagsView | `confirm('Delete flag "{key}"?...')` | Destructive Modal: "Delete Feature Flag" / "This will permanently remove the flag **{key}**. The app will no longer be able to check this flag." / Cancel + "Delete Flag" |
| `AppConfigPage.jsx` — AppConfigView | `confirm('Delete config "{key}"?')` | Destructive Modal: "Delete Config" / "This will permanently remove **{key}**." / Cancel + "Delete" |
| `AppConfigPage.jsx` — IntegrationsView | `confirm('Remove integration "{name}"?')` | Destructive Modal: "Remove Integration" / "This will remove the **{name}** integration." / Cancel + "Remove" |
| `EmailPage.jsx` — ComposeSubView | `confirm('Send email to ${recipientDesc}?')` | Non-destructive Modal: "Confirm Send" / "Send email to {recipientDesc}?" / Cancel + "Send" |
| `PlacePoolBuilderPage.jsx` — BrowsePoolView | `confirm('Deactivate "{name}"?...')` | Destructive Modal: "Deactivate Place" / "**{name}** will be hidden from the active pool." / Cancel + "Deactivate" |
| `PlacePoolBuilderPage.jsx` — BrowsePoolView | `confirm('Deactivate {n} selected places?')` | Destructive Modal: "Deactivate {n} Places" / "These places will be hidden from the active pool." / Cancel + "Deactivate All" |
| `PhotoPoolManagementPage.jsx` | `confirm()` in `triggerPlaceRefresh` | Destructive Modal: "Refresh Places" / "This will make Google API calls. Estimated cost: ${cost}." / Cancel + "Refresh" |

#### 6.7.2 Pattern

Each page adds a `confirmState` useState:
```js
const [confirmModal, setConfirmModal] = useState(null);
// { title, message, onConfirm, destructive?, confirmLabel? }
```

And a shared `ConfirmModal` component (or use `Modal` + `ModalBody` + `ModalFooter` directly).

#### Acceptance Criteria
- [ ] Zero `window.confirm()` calls remain in the codebase
- [ ] Every confirmation uses the `Modal` component with proper destructive/non-destructive styling
- [ ] Confirm modals have clear title, description, and action buttons
- [ ] Cancel always works (closes modal, takes no action)

---

## 7. Wave 2: Security Fixes

### 7.1 Narrow `admin_users` Anon SELECT

**File modified:** New migration

#### 7.1.1 Current State

```sql
CREATE POLICY "Allow anon read" ON admin_users FOR SELECT USING (true);
```

This allows **any** unauthenticated request to read **all columns** of `admin_users`, exposing admin emails, roles, invite status, and timestamps.

#### 7.1.2 Why Anon Read Exists

`AuthContext.fetchDynamicAdmins` runs BEFORE authentication (to build the allowlist for login). It queries:
```js
supabase.from("admin_users").select("email, status").in("status", ["active", "invited"])
```

This runs with the anon key. If we remove anon SELECT entirely, the login flow breaks.

#### 7.1.3 Fix

Create a **Postgres function** that returns only the data needed for login check, and narrow the policy:

```sql
-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Allow anon read" ON admin_users;

-- Create a function that returns only what the login check needs
CREATE OR REPLACE FUNCTION get_admin_emails()
RETURNS TABLE(email TEXT, status TEXT) AS $$
  SELECT email, status FROM admin_users
  WHERE status IN ('active', 'invited');
$$ LANGUAGE sql SECURITY DEFINER;

-- Allow anon to call this function
GRANT EXECUTE ON FUNCTION get_admin_emails() TO anon;

-- Authenticated admins can still read the full table
CREATE POLICY "Admins can read admin_users"
  ON admin_users FOR SELECT
  USING (is_admin_user());
```

#### 7.1.4 Client Update (`AuthContext.jsx`)

Replace:
```js
const { data } = await supabase.from("admin_users")
  .select("email, status").in("status", ["active", "invited"]);
```

With:
```js
const { data } = await supabase.rpc("get_admin_emails");
```

#### 7.1.5 Impact on AdminPage.jsx

`AdminPage.jsx` queries `admin_users.select("*")`. After RLS change, this only works for authenticated admins (which is correct — you must be logged in to see the admin management page).

**Regression check:** The `tableExists` detection (error code `42P01`) still works because RLS errors produce different codes (`42501` for insufficient privilege). If the table doesn't exist, it still returns `42P01`.

#### Acceptance Criteria
- [ ] Unauthenticated requests can call `get_admin_emails()` RPC (returns email + status only)
- [ ] Unauthenticated requests CANNOT read `admin_users` table directly
- [ ] Login flow works correctly (dynamic admin list loads)
- [ ] AdminPage works correctly (full table readable when authenticated)
- [ ] No columns beyond `email` and `status` are exposed to anon

---

### 7.2 Secure Script Execution

**Files modified:** `SeedPage.jsx`, new migration

#### 7.2.1 Current State

`SeedPage.jsx` calls `supabase.rpc("exec_sql", { sql: stmt })` for both predefined scripts and custom SQL. No `exec_sql` RPC found in migrations (likely doesn't exist in production — page shows fallback).

#### 7.2.2 Fix

Create individual RPCs for each predefined script. Keep a custom SQL RPC restricted to owner role.

**Migration:**

```sql
-- Predefined scripts as safe RPCs
CREATE OR REPLACE FUNCTION admin_seed_demo_profiles()
RETURNS VOID AS $$
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  INSERT INTO profiles (id, email, display_name, username, first_name, last_name,
    has_completed_onboarding, active, created_at)
  VALUES
    (gen_random_uuid(), 'demo1@mingla.app', 'Alex Demo', 'alexdemo', 'Alex', 'Demo', true, true, now()),
    (gen_random_uuid(), 'demo2@mingla.app', 'Jamie Test', 'jamietest', 'Jamie', 'Test', true, true, now()),
    (gen_random_uuid(), 'demo3@mingla.app', 'Sam Dev', 'samdev', 'Sam', 'Dev', false, true, now()),
    (gen_random_uuid(), 'demo4@mingla.app', 'Taylor QA', 'taylorqa', 'Taylor', 'QA', true, true, now()),
    (gen_random_uuid(), 'demo5@mingla.app', 'Jordan Seed', 'jordanseed', 'Jordan', 'Seed', false, true, now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_clear_expired_caches()
RETURNS VOID AS $$
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  DELETE FROM google_places_cache WHERE expires_at < now();
  DELETE FROM ticketmaster_events_cache WHERE expires_at < now();
  DELETE FROM discover_daily_cache WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_reset_inactive_sessions()
RETURNS VOID AS $$
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE collaboration_sessions SET is_active = false
  WHERE last_activity_at < now() - interval '7 days' AND is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_clear_demo_data()
RETURNS VOID AS $$
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  DELETE FROM profiles WHERE email LIKE '%@mingla.app';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Owner-only SQL execution (for custom queries)
CREATE OR REPLACE FUNCTION admin_exec_sql(sql TEXT)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
  caller_role TEXT;
BEGIN
  -- Must be admin
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  -- Must be owner
  SELECT role INTO caller_role FROM admin_users
  WHERE email = auth.jwt()->>'email' AND status = 'active';
  IF caller_role != 'owner' THEN RAISE EXCEPTION 'Owner access required'; END IF;
  -- Execute
  EXECUTE sql;
  RETURN '{"success": true}'::jsonb;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

#### 7.2.3 Client Update (`SeedPage.jsx`)

Replace `exec_sql` calls for predefined scripts with named RPCs:
```js
const SEED_SCRIPTS = [
  { label: "Seed Demo Profiles", rpc: "admin_seed_demo_profiles", ... },
  { label: "Clear Expired Caches", rpc: "admin_clear_expired_caches", ... },
  { label: "Reset Inactive Sessions", rpc: "admin_reset_inactive_sessions", ... },
  { label: "Clear Demo Data", rpc: "admin_clear_demo_data", ... },
];

// Run script:
const { error } = await supabase.rpc(script.rpc);
```

Custom SQL runner calls `admin_exec_sql` RPC (owner-only).

#### 7.2.4 SeedPage Enhancements (bundled here)

1. **Confirmation modal before every script** — uses Modal component.
2. **SQL results display** — custom SQL runner shows returned data in a DataTable if the RPC returns rows.
3. **"Owner only" badge** on custom SQL section if user is not owner (gray out, show tooltip).

#### Acceptance Criteria
- [ ] Predefined scripts use named RPCs, not raw SQL execution
- [ ] Custom SQL is owner-only (non-owner sees disabled section with explanation)
- [ ] Every script has a confirmation modal before execution
- [ ] No `exec_sql` RPC exists or is callable
- [ ] Script results are displayed (success/error + data if applicable)
- [ ] Audit log entry created for every script run

---

### 7.3 Server-Side User Delete

**Files modified:** `UserManagementPage.jsx`

#### 7.3.1 Current State

`handleFullDelete` in `UserManagementPage.jsx` deletes from 38 tables in client-side batches, then calls `delete-user` edge function, then falls back to admin API with anon key.

#### 7.3.2 Confirmed: `delete-user` Edge Function Exists

The `supabase/functions/delete-user/index.ts` already handles comprehensive cascade deletion:
- Transfers collaboration session ownership
- Deletes user interactions, location history, preferences, activity
- Cleans up social data (friends, requests, blocks, mutes)
- Soft-deletes messages to preserve conversation history
- Deletes board, calendar, presence data
- Cancels pending invites
- Deletes auth user first (invalidates JWT)
- Deletes profile via `delete_user_profile` RPC

#### 7.3.3 Fix

Replace the entire client-side cascade with a single edge function call:

```js
async function handleFullDelete(userId) {
  setDeleting(true);
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/delete-user`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ user_id: userId }),
      }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(body || `Delete failed (${res.status})`);
    }
    addToast("User deleted permanently", "success");
    logAdminAction("user.delete", "user", userId, { display_name, email });
    setView("list");
    fetchUsers();
    fetchStats();
  } catch (err) {
    addToast(`Delete failed: ${err.message}`, "error");
  } finally {
    setDeleting(false);
  }
}
```

**Remove:** The entire 38-table client-side cascade code and the anon-key admin API fallback.

#### 7.3.4 Fallback Behavior

If the edge function returns an error (not deployed, internal error), the toast shows the error message. The user is not left in a partial-delete state because either the edge function succeeds atomically or it fails without partial cleanup.

#### Acceptance Criteria
- [ ] Delete calls `delete-user` edge function only (no client-side cascade)
- [ ] Type-to-confirm modal still required before delete
- [ ] Success navigates back to list and refreshes
- [ ] Error shows specific error message in toast
- [ ] No partial deletes possible (edge function is transactional)
- [ ] Anon key is no longer exposed in admin API calls
- [ ] Audit log entry created on successful delete

---

## 8. Wave 3: Page-Level Fixes

### 8.1 Reports Page Overhaul

**File modified:** `ReportsPage.jsx`
**New migration:** Add `severity` column to `user_reports`

#### 8.1.1 Current Problems
1. Hard limit of 50 reports, no pagination
2. Reporter/reported shown as truncated UUIDs — no display names
3. No detail modal — only truncated text (`line-clamp-2`)
4. No search
5. Can't reopen or change status after initial action
6. No severity classification
7. No link to reported user's profile

#### 8.1.2 Database Changes

```sql
ALTER TABLE user_reports ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'medium'
  CHECK (severity IN ('low', 'medium', 'high', 'critical'));
```

#### 8.1.3 Query Changes

Replace:
```js
supabase.from("user_reports")
  .select("id,reason,details,status,created_at,reporter_id,reported_user_id")
  .order("created_at", { ascending: false })
  .limit(50)
```

With:
```js
supabase.from("user_reports")
  .select(`
    id, reason, details, status, severity, created_at, reviewed_at,
    reporter_id, reported_user_id,
    reporter:profiles!user_reports_reporter_id_fkey(display_name, email, avatar_url),
    reported:profiles!user_reports_reported_user_id_fkey(display_name, email, avatar_url)
  `, { count: "exact" })
  .order("created_at", { ascending: false })
  .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
```

If FK join fails (foreign key names may differ), fall back to separate profile lookups:
```js
// Fallback: fetch reporter and reported profiles by ID
const reporterIds = [...new Set(reports.map(r => r.reporter_id).filter(Boolean))];
const reportedIds = [...new Set(reports.map(r => r.reported_user_id).filter(Boolean))];
const { data: profiles } = await supabase.from("profiles")
  .select("id, display_name, email, avatar_url")
  .in("id", [...reporterIds, ...reportedIds]);
// Map profiles back to reports
```

#### 8.1.4 New Features

1. **Pagination:** `PAGE_SIZE = 20`, offset-based with DataTable pagination.
2. **Search:** Debounced (400ms), searches `reason` and `details` via `.or("reason.ilike.%q%,details.ilike.%q%")`.
3. **Severity filter pills:** All, Low, Medium, High, Critical (alongside status pills).
4. **Detail modal:** Shows full report text, reporter profile (Avatar + name + email), reported user profile (Avatar + name + email), timestamps, severity selector, status actions.
5. **Status changes on any report:** "Reopen" (→ pending), "Review", "Resolve", "Dismiss" available regardless of current status.
6. **Severity selector:** Dropdown in detail modal — Low, Medium, High, Critical. Saves to `severity` column.
7. **Link to reported user:** Button in detail modal: "View User Profile" → calls `onTabChange("users")` and passes reported user ID. (Requires adding a user navigation mechanism — see §8.1.5.)
8. **Column sorting:** Sortable on `created_at`, `status`, `severity`.

#### 8.1.5 Cross-Page Navigation to User

Add a query parameter mechanism to the hash router:

```
#/users?userId=abc-123
```

`UserManagementPage` reads this on mount:
```js
const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
const targetUserId = params.get("userId");
if (targetUserId) {
  setSelectedUserId(targetUserId);
  setView("detail");
}
```

The Reports detail modal navigates:
```js
window.location.hash = `#/users?userId=${reported_user_id}`;
```

#### 8.1.6 Copy

| Element | Text |
|---------|------|
| Page header | "Reports" |
| Page subtitle | *(removed)* |
| Empty — no reports | "All clear — no pending reports." |
| Empty — no matching filter | "No {status} reports." |
| Empty — no search results | "No reports match that search." |
| Detail modal title | "Report Details" |
| Severity labels | Low (default badge), Medium (warning badge), High (error badge), Critical (error badge, dot) |
| Status action — Reopen | "Reopen" |
| Status action — Review | "Mark Reviewed" |
| Status action — Resolve | "Resolve" |
| Status action — Dismiss | "Dismiss" |
| Link to user | "View User Profile →" |

#### Acceptance Criteria
- [ ] Pagination works (20 per page, exact count, proper Prev/Next)
- [ ] Reporter and reported show display name + avatar (not UUID)
- [ ] Detail modal shows full report text, both user profiles, timestamps
- [ ] Search filters by reason and details text
- [ ] Severity filter pills work alongside status filter pills
- [ ] Status can be changed from any state (reopen, review, resolve, dismiss)
- [ ] Severity can be set in detail modal
- [ ] "View User Profile" navigates to Users page with that user selected
- [ ] Column sorting on date, status, severity
- [ ] Export button downloads CSV
- [ ] Audit log entry on status/severity change

---

### 8.2 Overview Page Enhancement

**File modified:** `OverviewPage.jsx`

#### 8.2.1 New Sections

The page layout changes from:
```
[Stat Cards x8]
[Recent Users] [Recent Feedback]
```

To:
```
[Stat Cards x8 — with trend indicators]
[Alerts Bar]
[Quick Actions]
[Recent Activity (audit log)] [Recent Feedback]
```

#### 8.2.2 Trend Indicators on Stat Cards

For each stat card, fetch two counts:
- Current period: `count where created_at > now() - 7 days`
- Previous period: `count where created_at > now() - 14 days AND created_at <= now() - 7 days`

Calculate percentage change: `((current - previous) / previous * 100).toFixed(0)`.

Display as trend text on existing `StatCard` component: `+12% ↑` (green) or `-5% ↓` (red) or `—` if previous is 0.

**Note:** Not all tables have `created_at` (e.g., `boards` might not). Only show trends for tables that have a timestamp column. For others, show count only (current behavior).

#### 8.2.3 Alerts Bar

New section between stat cards and content:

```jsx
<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
  {pendingReports > 0 && (
    <AlertCard variant={pendingReports > 20 ? "error" : "warning"}
      title={`${pendingReports} pending reports`}
      action={<Button size="sm" onClick={() => onTabChange("reports")}>Review</Button>} />
  )}
  {expiredCaches > 0 && (
    <AlertCard variant="info"
      title={`${expiredCaches} expired cache entries`}
      action={<Button size="sm" onClick={() => onTabChange("seed")}>Clean Up</Button>} />
  )}
  {expiringOverrides > 0 && (
    <AlertCard variant="warning"
      title={`${expiringOverrides} overrides expiring in 7 days`}
      action={<Button size="sm" onClick={() => onTabChange("subscriptions")}>Review</Button>} />
  )}
</div>
```

**Queries:**
- Pending reports: `user_reports.select("*", {count:"exact", head:true}).eq("status", "pending")`
- Expired caches: Sum of counts from `google_places_cache`, `ticketmaster_events_cache`, `discover_daily_cache` where `expires_at < now()`
- Expiring overrides: `admin_subscription_overrides.select("*", {count:"exact", head:true}).eq("status", "active").lte("expires_at", sevenDaysFromNow)`

If all counts are 0, the alerts bar is hidden (not an empty bar).

#### 8.2.4 Quick Actions

Row of 3 ghost buttons below alerts:
- "Review Reports" → `onTabChange("reports")`
- "Moderate Content" → `onTabChange("content")`
- "Check Feedback" → `onTabChange("feedback")`

#### 8.2.5 Recent Activity (replaces Recent Users)

Replace the "Recent Users" section with "Recent Activity" showing the last 20 audit log entries:

| Column | Content |
|--------|---------|
| Time | `timeAgo(created_at)` |
| Admin | `admin_email` (truncated) |
| Action | Human-readable action label (e.g., "Banned user") |
| Target | Target name from metadata |

Link at bottom: "View All Activity →" navigates to a full activity log (future — not in this spec).

**Note:** If `admin_audit_log` table doesn't exist yet (migration not run), show "Recent Users" as fallback.

#### 8.2.6 Copy

| Element | Text |
|---------|------|
| Page header | "Dashboard" |
| Page subtitle | *(removed)* |
| Alerts — no alerts | *(section hidden)* |
| Recent Activity header | "Recent Activity" |
| Recent Activity empty | "No admin activity recorded yet." |
| Recent Feedback empty | "No feedback received. Users can submit feedback from the app." |

#### Acceptance Criteria
- [ ] Stat cards show trend percentage (green up, red down, dash if no previous data)
- [ ] Alerts bar shows pending reports, expired caches, expiring overrides with correct severity
- [ ] Alerts bar is hidden when all counts are 0
- [ ] Quick action buttons navigate to correct pages
- [ ] Recent Activity shows last 20 audit log entries
- [ ] Graceful fallback if audit log table doesn't exist
- [ ] "View All" links on Recent Feedback navigate to feedback page

---

### 8.3 Users Page Enhancements

**File modified:** `UserManagementPage.jsx`

#### 8.3.1 Advanced Filters

Add filter dropdowns alongside existing ones:

| Filter | Type | Values | Query |
|--------|------|--------|-------|
| Country | dropdown | Distinct countries from profiles | `.eq("country", val)` |
| Subscription Tier | dropdown | Free, Pro, Elite | Join via `admin_list_subscriptions` or filter client-side after fetch (depending on performance) |
| Date Range | two date inputs | From / To | `.gte("created_at", from).lte("created_at", to)` |
| Status | dropdown (existing) | All, Active, Banned | `.eq("active", val)` |
| Onboarding | dropdown (existing) | All, Complete, Incomplete | `.eq("has_completed_onboarding", val)` |

**Implementation note:** Country dropdown values are fetched once on mount: `supabase.from("profiles").select("country").not("country", "is", null)` → deduplicate.

Subscription tier filter requires joining or sub-querying — **this is complex with direct Supabase client**. Simplest approach: add a `current_tier` computed/cached column to profiles, or filter client-side after fetching the page. **Decision: filter client-side for the current page of results only.** This means the tier filter is approximate for large datasets. Mark as known limitation.

#### 8.3.2 Column Sorting

Add `sortable: true` to columns: `display_name`, `email`, `country`, `created_at`, `updated_at`.

When sorting, pass `sortKey` and `sortDirection` to the Supabase query's `.order()`:
```js
query = query.order(sortKey, { ascending: sortDirection === "asc" });
```

Reset page to 0 when sort changes.

#### 8.3.3 Bulk Actions

Add checkbox column via DataTable `selectable` prop (§11.2). When rows are selected, show floating action bar:

```jsx
<div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[var(--color-background-primary)] border rounded-xl shadow-xl px-6 py-3 flex items-center gap-4 z-[var(--z-overlay)]">
  <span className="text-sm font-medium">{selectedIds.size} selected</span>
  <Button variant="danger" size="sm" onClick={handleBulkBan}>Ban Selected</Button>
  <Button variant="secondary" size="sm" icon={Download} onClick={handleBulkExport}>Export</Button>
  <Button variant="ghost" size="sm" onClick={clearSelection}>Clear</Button>
</div>
```

**Bulk ban:** Confirmation modal → `Promise.all` of individual updates (Supabase doesn't support bulk update by ID array directly with `.in()`).

**Bulk export:** Fetches full profile data for selected IDs, exports CSV.

Selection clears on: page change, filter change, search change.

#### 8.3.4 Rename "Impersonate" to "Preview Profile"

Single string change in the button label and tooltip. No behavior change.

#### 8.3.5 Delete Flow — Use Edge Function

See §7.3. The client-side cascade is removed; delete calls `delete-user` edge function.

#### 8.3.6 Copy Changes

| Element | Current | New |
|---------|---------|-----|
| Page header | "User Management" | "Users" |
| Page subtitle | "Browse, search, and manage all Mingla users" | *(removed)* |
| Delete modal title | "PERMANENTLY Delete User" | "Delete User Permanently" |
| Delete modal body | "FULL WIPE -- This cannot be undone" | "All data for this user will be permanently deleted. This cannot be undone." |
| Impersonate button | "Impersonate" | "Preview Profile" |
| Ban inline confirm | (Confirm/No buttons) | Modal: "Ban {name}? They will lose access to the app." / Cancel + "Ban User" |

#### Acceptance Criteria
- [ ] Country filter shows distinct countries from data
- [ ] Date range filter restricts by `created_at`
- [ ] Column sorting works for name, email, country, created_at
- [ ] Sort persists across pagination
- [ ] Bulk select with checkbox column
- [ ] Floating action bar appears with selected count
- [ ] Bulk ban with confirmation modal
- [ ] Bulk export downloads CSV of selected users
- [ ] Selection clears on filter/page/search change
- [ ] "Preview Profile" label (not "Impersonate")
- [ ] Delete uses edge function
- [ ] All copy updated per table above
- [ ] Audit log entry for ban, unban, edit, delete

---

### 8.4 Subscriptions Page Enhancements

**File modified:** `SubscriptionManagementPage.jsx`
**New migration:** `admin_subscription_stats` RPC

#### 8.4.1 Stats RPC

Replace client-side stats (fetching 10K rows to count) with:

```sql
CREATE OR REPLACE FUNCTION admin_subscription_stats()
RETURNS JSONB AS $$
DECLARE result JSONB;
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM profiles),
    'free', (SELECT count(*) FROM profiles p WHERE get_effective_tier(p.id) = 'free'),
    'pro', (SELECT count(*) FROM profiles p WHERE get_effective_tier(p.id) = 'pro'),
    'elite', (SELECT count(*) FROM profiles p WHERE get_effective_tier(p.id) = 'elite'),
    'overrides', (SELECT count(*) FROM admin_subscription_overrides WHERE status = 'active'),
    'expiring_soon', (SELECT count(*) FROM admin_subscription_overrides
      WHERE status = 'active' AND expires_at <= now() + interval '7 days')
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Performance note:** `get_effective_tier` is called per-user. If slow at scale, add a materialized view later. For now, this is better than fetching 10K rows client-side.

#### 8.4.2 Column Sorting

Add `sortable: true` to: effective_tier, created_at, override_expires_at.

**Note:** Sorting happens server-side — the `admin_list_subscriptions` RPC needs `p_sort_key` and `p_sort_dir` parameters. **Migration update required** to modify the RPC.

If modifying the RPC is too complex for this wave, fall back to client-side sorting of the current page (acceptable for 20 rows per page).

#### 8.4.3 Expiring Overrides Alert

```jsx
{stats.expiring_soon > 0 && (
  <AlertCard variant="warning"
    title={`${stats.expiring_soon} override${stats.expiring_soon > 1 ? "s" : ""} expiring within 7 days`} />
)}
```

#### 8.4.4 Copy Changes

| Element | Current | New |
|---------|---------|-----|
| Page header | "Subscription Management" | "Subscriptions" |
| Page subtitle | "View tiers, grant overrides, manage subscriptions" | *(removed)* |
| Grant modal — revoke warning | "They will fall back to their underlying tier (RevenueCat / trial / referral / free)" | "They'll return to their current plan when the override expires." |
| Gift icon button | Gift icon | "Grant Override" text button |

#### Acceptance Criteria
- [ ] Stats load from RPC (no client-side 10K fetch)
- [ ] Expiring overrides alert shows when > 0
- [ ] Column sorting on tier and dates
- [ ] All copy updated per table
- [ ] Export button downloads CSV
- [ ] Audit log on grant/revoke

---

### 8.5 Content Moderation Enhancements

**File modified:** `ContentModerationPage.jsx`

#### 8.5.1 Image Preview

For Experiences and Card Pool tables, add a thumbnail column:

```js
{
  key: "image_url", // or whatever the image field is
  label: "",
  width: "48px",
  render: (val) => val ? (
    <img src={val} alt="" className="w-10 h-10 rounded object-cover" />
  ) : null,
}
```

Clicking the thumbnail opens a larger preview in a Modal.

#### 8.5.2 Bulk Actions on Experiences and Card Pool

Same pattern as Users (§8.3.3): checkbox column, floating action bar with "Activate", "Deactivate", "Delete Selected".

#### 8.5.3 Review Actions

Add moderation buttons to place reviews (currently read-only):
- "Approve" → update `place_reviews` set `moderation_status = 'approved'`
- "Reject" → update `place_reviews` set `moderation_status = 'rejected'`
- "Flag" → update `place_reviews` set `moderation_status = 'flagged'`

**Migration:** `ALTER TABLE place_reviews ADD COLUMN IF NOT EXISTS moderation_status TEXT DEFAULT 'pending' CHECK (moderation_status IN ('pending', 'approved', 'rejected', 'flagged'));`

#### 8.5.4 Copy Changes

| Element | Current | New |
|---------|---------|-----|
| Page header | "Content Moderation" | "Content" |
| Page subtitle | "Manage experiences, card pool, and reviews" | *(removed)* |

#### Acceptance Criteria
- [ ] Image thumbnails show in experience and card pool tables
- [ ] Thumbnail click opens larger preview modal
- [ ] Bulk actions work on experiences and card pool
- [ ] Place reviews have approve/reject/flag buttons
- [ ] `moderation_status` column exists and saves correctly
- [ ] Audit log entries for all mutations

---

### 8.6 Analytics — Server-Side RPCs

**File modified:** `AnalyticsPage.jsx`
**New migration:** 5 analytics RPCs

#### 8.6.1 New RPCs

```sql
CREATE OR REPLACE FUNCTION admin_analytics_growth(p_days INT DEFAULT 30)
RETURNS TABLE(day DATE, signups BIGINT) AS $$
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
    SELECT created_at::date AS day, count(*) AS signups
    FROM profiles
    WHERE created_at >= now() - (p_days || ' days')::interval
    GROUP BY created_at::date
    ORDER BY day;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_analytics_engagement(p_days INT DEFAULT 30)
RETURNS JSONB AS $$
DECLARE result JSONB;
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT jsonb_build_object(
    'dau', (SELECT count(DISTINCT user_id) FROM user_sessions
            WHERE started_at >= now() - interval '1 day'),
    'wau', (SELECT count(DISTINCT user_id) FROM user_sessions
            WHERE started_at >= now() - interval '7 days'),
    'mau', (SELECT count(DISTINCT user_id) FROM user_sessions
            WHERE started_at >= now() - interval '30 days'),
    'avg_duration_seconds', (SELECT coalesce(avg(EXTRACT(EPOCH FROM (ended_at - started_at))), 0)
            FROM user_sessions WHERE ended_at IS NOT NULL
            AND started_at >= now() - (p_days || ' days')::interval),
    'feature_usage', (SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
            SELECT interaction_type, count(*) AS cnt
            FROM user_interactions
            WHERE created_at >= now() - (p_days || ' days')::interval
            GROUP BY interaction_type ORDER BY cnt DESC LIMIT 10
    ) t)
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_analytics_retention(p_weeks INT DEFAULT 8)
RETURNS JSONB AS $$
-- Returns cohort retention matrix
-- Each cohort = users who signed up in week N
-- Retention = % of cohort who had a session in subsequent weeks
DECLARE result JSONB;
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  -- [implementation: build weekly cohorts, count active per subsequent week]
  -- Returns: [{cohort_week, cohort_size, week_1_pct, week_2_pct, ...}]
  -- Exact SQL depends on table structure — implementor to finalize
  RETURN '[]'::jsonb; -- placeholder
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_analytics_funnel()
RETURNS JSONB AS $$
DECLARE result JSONB;
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT jsonb_build_object(
    'signups', (SELECT count(*) FROM profiles),
    'onboarded', (SELECT count(*) FROM profiles WHERE has_completed_onboarding = true),
    'interacted', (SELECT count(DISTINCT user_id) FROM user_interactions),
    'boarded', (SELECT count(DISTINCT user_id) FROM session_participants)
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_analytics_geo()
RETURNS TABLE(country TEXT, user_count BIGINT) AS $$
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
    SELECT coalesce(p.country, 'Unknown') AS country, count(*) AS user_count
    FROM profiles p
    GROUP BY p.country
    ORDER BY user_count DESC
    LIMIT 50;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

#### 8.6.2 Client Update

Each sub-view calls its RPC instead of fetching raw data:

```js
// Growth
const { data } = await supabase.rpc("admin_analytics_growth", { p_days: daysFromRange });
// data is [{day, signups}] — ready for Recharts

// Engagement
const { data } = await supabase.rpc("admin_analytics_engagement", { p_days: daysFromRange });
// data is {dau, wau, mau, avg_duration_seconds, feature_usage}

// etc.
```

#### 8.6.3 PGRST202 Fallback

If RPCs don't exist, show setup screen with migration SQL (same pattern as Subscriptions and PhotoPool).

#### 8.6.4 Leaflet Map for Geo Tab

Add a Leaflet map to the Geographic sub-tab showing countries with circle markers sized by user count. Country coordinates from a static lookup table (top 50 countries). Below the map, keep the existing bar chart.

#### 8.6.5 Custom Date Range

Replace preset-only time range with: preset pills (7d, 30d, 60d, 90d) + "Custom" option that reveals two date inputs (from/to).

#### 8.6.6 Copy Changes

| Element | Current | New |
|---------|---------|-----|
| Tab: "User Growth" | "User Growth" | "Growth" |
| Tab: "Engagement" | "Engagement" | "Engagement" *(unchanged)* |
| Tab: "Geographic" | "Geographic" | "Geography" |
| Empty chart text | "No signups in the last X days" | "No data for this period." |

#### Acceptance Criteria
- [ ] All 5 analytics RPCs exist and return correct data
- [ ] Page uses RPCs instead of fetching raw rows
- [ ] Setup screen shown if RPCs are missing
- [ ] Leaflet map renders on Geography tab
- [ ] Custom date range picker works
- [ ] Charts render correctly with RPC data
- [ ] No 50K row fetches anywhere in analytics

---

### 8.7 Email Page Enhancements

**File modified:** `EmailPage.jsx`

#### 8.7.1 Templates in Database

**New migration:**
```sql
CREATE TABLE email_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  placeholders TEXT[] DEFAULT ARRAY['name'],
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage templates" ON email_templates
  FOR ALL USING (is_admin_user());

-- Seed existing templates
INSERT INTO email_templates (name, subject, body, placeholders) VALUES
  ('Welcome', 'Welcome to Mingla, {name}!', E'Hi {name},\n\nWelcome to Mingla...', ARRAY['name']),
  ('Feature Announcement', 'New in Mingla: ...', E'Hi {name},\n\n...', ARRAY['name']),
  ('Scheduled Maintenance', 'Scheduled Maintenance Notice', E'Hi {name},\n\n...', ARRAY['name']),
  ('We Miss You', 'We miss you, {name}!', E'Hi {name},\n\n...', ARRAY['name']);
```

#### 8.7.2 Template Picker from DB

Replace hardcoded `TEMPLATES` constant with a fetch from `email_templates`. Show a "Manage Templates" button that opens a modal to create/edit/delete templates.

#### 8.7.3 Additional Segments

Add segment options:
- "By City" → fetches distinct cities from profiles, admin selects one
- "By Subscription Tier" → Free, Pro, Elite dropdown
- "By Last Active" → "Active in last 7/30/90 days" or "Inactive for 30+ days"

These require updates to the `admin-send-email` edge function's `estimate` and `send_bulk` actions.

#### 8.7.4 Additional Placeholders

Support: `{name}`, `{email}`, `{city}`, `{tier}`. Document in the compose form:
```
Available placeholders: {name}, {email}, {city}, {tier}
```

Edge function substitutes these from the profile row during send.

#### 8.7.5 Rate Limit Enforcement

```js
// Fetch today's sent count
const { count } = await supabase.from("admin_email_log")
  .select("*", { count: "exact", head: true })
  .gte("created_at", todayStart);

if (count >= 100) {
  addToast("Daily email limit reached (100/day). Try again tomorrow.", "error");
  return;
}
```

Disable send button when limit reached. Show remaining count: "72/100 emails sent today".

#### 8.7.6 Replace `window.confirm` with Modal

See §6.7 — already covered.

#### 8.7.7 Copy Changes

| Element | Current | New |
|---------|---------|-----|
| Page header | "Email" | "Email" *(unchanged)* |
| Rate limit text | "Resend free tier allows 100 emails/day" | "Daily limit: 100 emails. {remaining} remaining today." |
| From defaults | "Mingla" / "hello@usemingla.com" | *(unchanged — these are correct)* |

#### Acceptance Criteria
- [ ] Templates load from database
- [ ] Admin can create/edit/delete templates
- [ ] New segment options work (city, tier, activity)
- [ ] Rate limit enforced (not just warned)
- [ ] Remaining count shown
- [ ] Confirmation uses Modal, not `window.confirm()`
- [ ] Audit log on every send

---

### 8.8 App Config Enhancements

**File modified:** `AppConfigPage.jsx`

**Note:** AppConfig is being merged into the new SettingsPage (§9.2). The three sub-tabs (Feature Flags, App Config, Integrations) become tabs within Settings alongside new tabs (Theme, Account).

#### 8.8.1 Search

Add `SearchInput` at the top of each sub-tab. Client-side filter on key/name/description.

#### 8.8.2 Audit History per Config Item

Each item's row gets a "History" button that opens a modal showing filtered audit log entries for that item (`target_type = "flag"/"config"/"integration"` AND `target_id = item.id`).

#### 8.8.3 Modal for Deletes

Already covered by §6.7.

#### Acceptance Criteria
- [ ] Search filters items in each sub-tab
- [ ] History button shows audit log for that item
- [ ] All deletes use Modal confirmation
- [ ] Audit log entries for all create/update/delete

---

### 8.9 Table Browser Enhancements

**File modified:** `TableBrowserPage.jsx`

#### 8.9.1 Column Sorting

Wire DataTable `onSort` to Supabase `.order()`:
```js
query = query.order(sortKey, { ascending: sortDirection === "asc" });
```

All columns are sortable by default (since they're dynamic).

#### 8.9.2 JSON Cell Expansion

When a cell value is an object (currently shows "JSON" badge), clicking the badge opens a Modal with:
```jsx
<pre className="text-sm font-mono whitespace-pre-wrap bg-[var(--color-background-tertiary)] p-4 rounded-lg max-h-[60vh] overflow-auto">
  {JSON.stringify(value, null, 2)}
</pre>
```

#### 8.9.3 Export

Add export button that downloads current table's visible data as CSV.

#### Acceptance Criteria
- [ ] Clicking any column header sorts the table
- [ ] JSON badge click opens formatted JSON modal
- [ ] Export downloads current table as CSV
- [ ] Sorting resets pagination to page 1

---

### 8.10 Beta Feedback Enhancements

**File modified:** `BetaFeedbackPage.jsx`

#### 8.10.1 Auto-Refresh Audio URLs

When audio player gets a 403 or load error, automatically re-fetch signed URL:
```js
const handleAudioError = async () => {
  if (retryCount < 2) {
    const newUrl = await fetchSignedUrl(audioPath);
    setAudioUrl(newUrl);
    setRetryCount(c => c + 1);
  } else {
    setError("Audio unavailable. The file may have been deleted.");
  }
};
```

Max 2 retries per audio load.

#### 8.10.2 Bulk Status Update

Checkbox column + floating bar with status dropdown: "Mark Selected as..." (Reviewed / Actioned / Dismissed).

#### 8.10.3 Copy Changes

| Element | Current | New |
|---------|---------|-----|
| Page header | "Beta Feedback" | "Feedback" |
| Page subtitle | "Browse, play, and manage audio feedback from beta testers" | *(removed)* |
| Audio error | "Audio expired -- click refresh" | "Reloading audio..." (auto-retry) or "Audio unavailable" (after retries) |

#### Acceptance Criteria
- [ ] Audio auto-retries on 403/load error (up to 2 times)
- [ ] Bulk status update with checkbox selection
- [ ] Export button downloads CSV
- [ ] All copy updated

---

### 8.11 Place Pool Enhancements

**File modified:** `PlacePoolBuilderPage.jsx`

#### 8.11.1 Deduplication Check

Before import, query `place_pool` for matching `google_place_id`s. In search results, show badge on duplicates: "Already imported" (dimmed, non-selectable).

**Current behavior note:** The page already does this! `existingPlaceIds` Set is populated and used to show "Already in pool" badges. However, duplicates can still be selected. **Fix:** Exclude them from selection:
```js
const toggleSelection = (id) => {
  if (existingPlaceIds.has(id)) return; // Prevent selecting duplicates
  // ... existing toggle logic
};
```

#### 8.11.2 Edit After Import

In Browse Pool, clicking a place name opens an edit modal:
- Fields: Name, Category (dropdown), Visibility toggle, Price Tier (dropdown)
- Mutation: `place_pool.update({name, category, is_active, price_tier}).eq("id", id)`

#### 8.11.3 Replace `window.confirm()` with Modal

Already covered by §6.7.

#### 8.11.4 Map Clustering

Add Leaflet.markercluster:
```
npm install @changey/react-leaflet-markercluster leaflet.markercluster
```

Wrap map markers in `<MarkerClusterGroup>`. This handles thousands of points without performance issues.

**Dependency note:** This adds 2 new npm packages. Both are lightweight (leaflet.markercluster ~40KB).

#### Acceptance Criteria
- [ ] Duplicate places cannot be selected for import
- [ ] Places can be edited after import
- [ ] Map clusters markers at low zoom levels
- [ ] All `window.confirm()` replaced with Modal
- [ ] Audit log on import and edit

---

### 8.12 Photo Pool Enhancements

**File modified:** `PhotoPoolManagementPage.jsx`

#### 8.12.1 Replace `window.confirm()` with Modal

See §6.7. The `triggerPlaceRefresh` confirmation becomes a Modal showing cost estimate.

#### 8.12.2 "Run All Categories" with Progress

New button: "Backfill All Categories". When clicked:
1. Shows Modal with cost estimate for all categories
2. On confirm, iterates categories calling `admin_trigger_backfill` for each
3. Shows progress: `<ProgressBar value={completed} max={total} />` + per-category status chips (pending/running/done/failed)
4. Polling (existing 3s interval) tracks each backfill

#### Acceptance Criteria
- [ ] "Backfill All" with progress bar and per-category status
- [ ] Cost estimate shown before confirming
- [ ] All `window.confirm()` replaced
- [ ] Audit log on backfill operations

---

### 8.13 Admin Users Enhancements

**File modified:** `AdminPage.jsx`

#### 8.13.1 Role Column

Add `role` column display in the admin list. Already exists in the data (`role` column on `admin_users`). Currently only shown for the owner badge. Show for all: "Owner" (crown icon) or "Admin" (shield icon).

#### 8.13.2 Activity Log per Admin

Add "Activity" button per admin → opens Modal showing audit log filtered by that admin's email:
```js
const { data } = await supabase.from("admin_audit_log")
  .select("*").eq("admin_email", adminEmail)
  .order("created_at", { ascending: false }).limit(50);
```

#### 8.13.3 Copy Changes

| Element | Current | New |
|---------|---------|-----|
| Page header | "Admin Management" | "Admin Users" |
| Page subtitle | "Invite, accept, and manage admin dashboard users" | *(removed)* |
| Revoke modal body | "They will be logged out and unable to access the admin dashboard. You can re-invite them later." | "They'll lose dashboard access immediately. You can re-invite them later." |

#### Acceptance Criteria
- [ ] Role shown for every admin (Owner/Admin)
- [ ] Activity button opens audit log modal per admin
- [ ] All copy updated
- [ ] Audit log on invite/accept/revoke

---

## 9. Wave 4: New Pages

### 9.1 City Launcher Page

**New file:** `pages/CityLauncherPage.jsx`
**New edge function:** `admin-city-search` (if existing `admin-place-search` doesn't support area search)

#### 9.1.1 Purpose

One workflow to seed a new launch city: define area → search → import → generate cards → assign photos → moderate → go live.

#### 9.1.2 Layout

Wizard-style stepper with 5 steps:

```
[1. Define Area] → [2. Search & Select] → [3. Import & Generate] → [4. Review] → [5. Launch]
```

Step indicator at top. Back/Next buttons at bottom. Each step is a full section.

#### 9.1.3 Step 1: Define Area

- **City input:** Text field with Google autocomplete (via edge function) or manual entry
- **Zipcode input:** Optional — narrows the area within a city
- **Radius:** Slider or dropdown (1km, 2km, 5km, 10km, 25km)
- **Map preview:** Leaflet map showing the selected area as a circle overlay
- **Categories:** Checkbox grid of place categories to search (restaurants, bars, cafes, parks, museums, theaters, nightlife, shopping, fitness, entertainment, landmarks, hotels). Default: all checked.

**State:**
```js
{ city, zipcode, lat, lng, radius, selectedCategories, mapCenter, mapZoom }
```

**Geocoding:** On city/zipcode input blur, call edge function to geocode → set lat/lng → update map.

#### 9.1.4 Step 2: Search & Select

- **Auto-search:** On entering step 2, automatically search Google Places for each selected category within the defined area. Show progress: "Searching restaurants... (3/12 categories done)"
- **Results:** Combined table + map view. Each result shows: name, category, rating, review count, address, price tier, "Already imported" badge if in `place_pool`.
- **Selection:** Checkbox per result. "Select All New" button. Deselect duplicates by default.
- **Stats bar:** "{total} found · {new} new · {duplicates} already imported · {selected} selected"

**API calls:** POST to `admin-place-search` with `{ action: "search", textQuery: category, city, country, postcode }` per category. Batch sequentially (not parallel) to avoid API rate limits. Show progress.

#### 9.1.5 Step 3: Import & Generate

- **Import:** POST to `admin-place-search` with `{ action: "push", places: selectedPlaces }`. Show progress bar.
- **Generate cards:** POST to new edge function `admin-generate-cards` that creates `card_pool` entries from `place_pool` entries (title, description, category mapping, image URL).
- **Photo pipeline:** POST to `admin-photo-pipeline` edge function for each category to fetch photos for imported places.
- **Progress:** Three progress sections: Import (progress bar), Card Generation (progress bar), Photo Fetch (progress bar).

**Edge function dependency:** `admin-generate-cards` may not exist. If not, show "Card generation requires the admin-generate-cards edge function. Import places now and generate cards manually from the Content page." Allow proceeding without card generation.

#### 9.1.6 Step 4: Review

- **Imported places table:** Name, category, rating, photo (thumbnail), status (active/inactive).
- **Generated cards table:** Title, category, image, status.
- **Bulk actions:** "Activate All", "Deactivate All", "Remove Selected".
- **Edit:** Click any row to edit inline.

#### 9.1.7 Step 5: Launch

- **Summary:** X places imported, Y cards generated, Z photos fetched.
- **"Go Live" button:** Sets all imported places and generated cards to `is_active = true`.
- **Confirmation modal:** "Launch {city}? This will make {X} places and {Y} cards visible to users."

#### 9.1.8 Copy

| Element | Text |
|---------|------|
| Page header | "City Launcher" |
| Step 1 header | "Define your launch area" |
| Step 1 helper | "Choose a city and radius. We'll search Google Places for venues in that area." |
| Step 2 header | "Review search results" |
| Step 2 helper | "Select the places you want to import. Duplicates are excluded automatically." |
| Step 3 header | "Importing and generating content" |
| Step 4 header | "Review imported content" |
| Step 4 helper | "Review and edit before going live. Deactivate anything that doesn't look right." |
| Step 5 header | "Ready to launch" |
| Go Live button | "Launch {city}" |
| Success | "{city} is live! {X} places and {Y} cards are now visible to users." |

#### 9.1.9 Error & Edge States

| State | Behavior |
|-------|----------|
| No geocode result | "Couldn't find that location. Try a different city or enter coordinates manually." |
| API rate limit | "Google API rate limit reached. Wait a moment and try again." |
| No results for a category | Category row shows "0 results" — no error |
| Import fails | Toast with error, retry button per failed batch |
| Photo pipeline fails | Non-blocking — show warning, allow proceeding without photos |
| Edge function not deployed | Show setup instructions for that specific function |

#### Acceptance Criteria
- [ ] 5-step wizard completes full city seed workflow
- [ ] Map shows selected area with radius overlay
- [ ] Search progress shows per-category status
- [ ] Duplicate places are flagged and excluded from selection
- [ ] Import, card generation, and photo fetch have individual progress bars
- [ ] Review step allows bulk and individual edits
- [ ] "Go Live" activates all imported content
- [ ] Graceful degradation if edge functions are missing
- [ ] Audit log entries for import, generate, and launch actions

---

### 9.2 Settings Page

**New file:** `pages/SettingsPage.jsx`

#### 9.2.1 Tabs

1. **Appearance** — Theme toggle (light/dark/auto), content density (compact/default — future)
2. **Feature Flags** — Migrated from AppConfigPage
3. **App Config** — Migrated from AppConfigPage
4. **Integrations** — Migrated from AppConfigPage

#### 9.2.2 Appearance Tab

```jsx
<SectionCard title="Theme">
  <div className="flex gap-3">
    <Button variant={theme === "light" ? "primary" : "secondary"} onClick={() => setTheme("light")}>Light</Button>
    <Button variant={theme === "dark" ? "primary" : "secondary"} onClick={() => setTheme("dark")}>Dark</Button>
    <Button variant={!explicit ? "primary" : "secondary"} onClick={setAutoTheme}>System</Button>
  </div>
</SectionCard>
```

#### 9.2.3 Migration from AppConfigPage

Move `FeatureFlagsView`, `AppConfigView`, `IntegrationsView` from `AppConfigPage.jsx` into `SettingsPage.jsx` as tabs. Delete `AppConfigPage.jsx`. Remove `appconfig` from `PAGES` map.

**Regression risk:** Any links or references to the "appconfig" tab ID must be updated to "settings". Grep for `"appconfig"` across the codebase.

#### Acceptance Criteria
- [ ] Settings page renders with 4 tabs
- [ ] Theme toggle works (light/dark/system)
- [ ] Feature Flags, App Config, Integrations work identically to before
- [ ] No references to "appconfig" remain in the codebase
- [ ] Settings nav item now renders a real page

---

## 10. Wave 5: Copy Overhaul

### 10.1 Page Headers

Every page header is simplified. Subtitles are removed.

| Page | Current Header | Current Subtitle | New Header | New Subtitle |
|------|---------------|-----------------|------------|-------------|
| Overview | "Dashboard" | "Overview of your Mingla platform metrics" | "Dashboard" | *(none)* |
| Users | "User Management" | "Browse, search, and manage all Mingla users" | "Users" | *(none)* |
| Subscriptions | "Subscription Management" | "View tiers, grant overrides, manage subscriptions" | "Subscriptions" | *(none)* |
| Content | "Content Moderation" | "Manage experiences, card pool, and reviews" | "Content" | *(none)* |
| Analytics | "Analytics" | *(none)* | "Analytics" | *(none)* |
| Place Pool | "Place Pool Builder" | "Search, review, and import places..." | "Places" | *(none)* |
| Photo Pool | *(varies by section)* | *(varies)* | "Photos" | *(none)* |
| Feedback | "Beta Feedback" | "Browse, play, and manage audio feedback..." | "Feedback" | *(none)* |
| Reports | "User Reports" | "Review and manage user-submitted reports" | "Reports" | *(none)* |
| Email | "Email" | *(none)* | "Email" | *(none)* |
| Admin Users | "Admin Management" | "Invite, accept, and manage admin dashboard users" | "Admin Users" | *(none)* |
| Seed | "Seed & Scripts" | "Run predefined seed scripts or custom SQL queries" | "Database Tools" | *(none)* |
| Table Browser | "Table Browser" | "Browse and inspect all database tables" | "Table Browser" | *(none)* |
| Settings | *(did not exist)* | *(did not exist)* | "Settings" | *(none)* |
| City Launcher | *(new)* | *(new)* | "City Launcher" | *(none)* |

### 10.2 Empty States

| Page | Context | Current | New |
|------|---------|---------|-----|
| Overview | No users | "No users yet" | "No users have signed up yet." |
| Overview | No feedback | "No feedback yet" | "No feedback received. Users submit feedback from the app." |
| Reports | No reports at all | "No reports to review" | "All clear — no reports to review." |
| Reports | No reports in filter | "No {status} reports" | "No {status} reports found." |
| Content | No experiences | "No experiences found" | "No experiences yet." |
| Content | No reviews | Generic | "No reviews to moderate." |
| Place Pool | Empty pool | "No places in the pool yet..." | "No places imported yet. Use the Search tab to find and import places." |
| Table Browser | No data | "No results found" | "This table is empty." |
| App Config | No flags | "No feature flags yet" | "No feature flags. Create one to control app features remotely." |
| Beta Feedback | No feedback | "No beta feedback found" | "No feedback submissions yet." |
| Email Prefs | No prefs | Generic | "No notification preferences set." |
| Admin | No active | "No active admins" | "No active admins. Invite someone to get started." |

### 10.3 Stat Card Labels

| Current | New |
|---------|-----|
| "Total Users" | "Users" |
| "Card Pool" | "Cards" |
| "Sessions" | "Collab Sessions" |
| "User Reports" | "Reports" |
| "Experiences" | *(unchanged)* |
| "Boards" | *(unchanged)* |
| "Reviews" | *(unchanged)* |
| "Feedback" | *(unchanged)* |

### 10.4 Warning & Confirmation Copy

| Location | Current | New |
|----------|---------|-----|
| Seed page banner | "Caution — Live Database. These scripts run directly against your production Supabase database. Seed scripts insert or delete real data. Use with care." | "These scripts modify live data. Changes cannot be undone. Proceed with care." |
| Subscription revoke | "They will fall back to their underlying tier (RevenueCat / trial / referral / free)" | "They'll return to their current plan when the override expires." |
| Email rate limit | "Resend free tier allows 100 emails/day" | "Daily limit: 100 emails. {remaining} remaining today." |
| Email template help | *(mentions {name} only)* | "Available placeholders: {name}, {email}, {city}, {tier}" |
| Admin revoke modal | "They will be logged out and unable to access the admin dashboard. You can re-invite them later." | "They'll lose dashboard access immediately. You can re-invite them later." |
| User delete modal | "PERMANENTLY Delete User" / "FULL WIPE — This cannot be undone" | "Delete User Permanently" / "All data for this user will be permanently deleted. This cannot be undone." |

### 10.5 Error Boundary

| Current | New |
|---------|-----|
| "Try Again" | "Retry" |
| "Something went wrong" | "Something went wrong" *(unchanged — clear enough)* |

#### Acceptance Criteria
- [ ] Every page header matches the table in §10.1
- [ ] Every empty state matches the table in §10.2
- [ ] Every stat card label matches §10.3
- [ ] Every warning/confirmation matches §10.4
- [ ] No vendor names (Supabase, Resend, RevenueCat) appear in user-facing copy
- [ ] No screaming caps in any user-facing text

---

## 11. Wave 6: Power-User Features

### 11.1 Global Search (Cmd+K)

**New file:** `components/CommandPalette.jsx`
**File modified:** `App.jsx`

#### 11.1.1 Trigger

`Cmd+K` (Mac) / `Ctrl+K` (Windows). Register listener in `App.jsx`:
```js
useEffect(() => {
  const handler = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setCommandPaletteOpen(true);
    }
  };
  document.addEventListener("keydown", handler);
  return () => document.removeEventListener("keydown", handler);
}, []);
```

#### 11.1.2 UI

Full-width overlay modal (like VS Code / Spotlight):
- Backdrop blur
- Large search input at top
- Results grouped by type: **Pages**, **Users**, **Places**, **Config**
- Keyboard navigation: arrow keys to select, Enter to navigate, Escape to close
- Max 5 results per group

#### 11.1.3 Search Sources

| Source | Query | Result Format |
|--------|-------|--------------|
| Pages | Client-side filter on `NAV_ITEMS` labels | Page name → navigate to page |
| Users | `profiles.select("id, display_name, email").ilike("display_name", "%q%").limit(5)` | Name + email → navigate to `#/users?userId=id` |
| Places | `place_pool.select("id, name, address").ilike("name", "%q%").limit(5)` | Name + address → navigate to `#/placepool` |
| Config | `feature_flags` + `app_config` client-side filter | Key → navigate to `#/settings` |

#### 11.1.4 Debounce

Search input debounced at 300ms. Pages filter is instant (client-side). DB queries fire after debounce.

#### Acceptance Criteria
- [ ] Cmd+K / Ctrl+K opens command palette
- [ ] Escape closes it
- [ ] Arrow keys navigate results
- [ ] Enter navigates to selected result
- [ ] Results grouped by type with max 5 per group
- [ ] Database queries debounced at 300ms
- [ ] Page search is instant

---

### 11.2 Bulk Actions on DataTable

**File modified:** `Table.jsx`

#### 11.2.1 New Props

```js
{
  selectable: boolean,                    // Show checkbox column
  selectedIds: Set,                       // Controlled selected IDs
  onSelect: (id, selected) => void,       // Individual row select
  onSelectAll: (allSelected) => void,     // Header checkbox toggle
  getRowId: (row) => string,              // Row ID extractor (default: row.id)
}
```

#### 11.2.2 Visual

- Checkbox column is the first column (width: 40px)
- Header has a "select all on this page" checkbox
- Selected rows have a subtle highlight: `bg-[var(--color-brand-50)]`
- Indeterminate state on header checkbox when some (but not all) are selected

#### 11.2.3 Floating Action Bar

Each page that uses bulk actions renders its own floating bar (not part of DataTable). DataTable only manages selection state.

Pattern:
```jsx
{selectedIds.size > 0 && (
  <div className="fixed bottom-6 left-1/2 -translate-x-1/2 ...">
    <span>{selectedIds.size} selected</span>
    {/* Page-specific action buttons */}
    <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
      Clear
    </Button>
  </div>
)}
```

#### 11.2.4 Selection Lifecycle

- Selection clears when: page changes (pagination), filters change, search changes, data refreshes
- "Select All" only selects visible rows on the current page
- Selected IDs persist across no-op re-renders (Set reference stability)

#### Acceptance Criteria
- [ ] Checkbox column appears when `selectable={true}`
- [ ] Header checkbox toggles all visible rows
- [ ] Indeterminate state when partially selected
- [ ] Selected rows are visually highlighted
- [ ] Selection clears on page/filter/search change
- [ ] `onSelect` and `onSelectAll` callbacks fire correctly
- [ ] Existing DataTable usages (without `selectable`) are unchanged

---

## 12. Wave 7: Polish & Consistency

### 12.1 Consistent Pagination

Standardize all pages to use the same pattern:

```js
// Query
const { data, count } = await supabase.from(table)
  .select("*", { count: "exact" })
  .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

// DataTable
<DataTable
  pagination={{
    page,
    pageSize: PAGE_SIZE,
    total: count,
    from: page * PAGE_SIZE + 1,
    to: Math.min((page + 1) * PAGE_SIZE, count),
    onChange: setPage,
  }}
/>
```

**Pages to fix:**
- `ReportsPage` — currently limit 50, no pagination → add proper pagination
- `SubscriptionManagementPage` — currently `hasMore = length === PAGE_SIZE` heuristic → use count from stats RPC or add count to list RPC
- `AdminPage` — no pagination (loads all) → acceptable for small dataset, no change needed
- `AppConfigPage` sub-views — no pagination (loads all) → acceptable, no change needed

### 12.2 `mountedRef` Consistency

Add `mountedRef` guard to ALL pages with async operations. Pages missing it:
- `OverviewPage` — has `mounted` local var in effect, but not a ref. Convert to `useRef`.
- `UserManagementPage` — no mounted guard. Add `mountedRef`.
- `ContentModerationPage` — no mounted guard. Add `mountedRef`.
- `ReportsPage` — no mounted guard. Add `mountedRef`.
- `AppConfigPage` — no mounted guard. Add `mountedRef`.
- `AdminPage` — no mounted guard. Add `mountedRef`.

Pattern:
```js
const mountedRef = useRef(true);
useEffect(() => () => { mountedRef.current = false; }, []);
// In every async handler:
if (!mountedRef.current) return;
```

### 12.3 DRY Auth Screens

**New file:** `lib/authComponents.js`

Extract from `LoginScreen.jsx` and `InviteSetupScreen.jsx`:
- `COLORS` constant
- `FocusInput` component
- `PasswordStrength` component
- `inputStyle` function
- `btnStyle` function
- Eye button pattern

Both screens import from the shared file.

### 12.4 User Detail — Responsive Tabs

The 18-tab detail view in `UserManagementPage` doesn't work on small screens.

**Fix:** On screens < `md` breakpoint, replace horizontal tabs with a dropdown select:
```jsx
{isMobile ? (
  <select value={detailTab} onChange={(e) => setDetailTab(e.target.value)}
    className="w-full h-10 rounded-lg border ...">
    {DETAIL_TABS.map(t => <option key={t.id} value={t.id}>{t.label} ({count})</option>)}
  </select>
) : (
  <Tabs tabs={DETAIL_TABS} activeTab={detailTab} onChange={setDetailTab} />
)}
```

### 12.5 Dark Mode Audit

Every new component added in this spec must be tested in both light and dark modes. Checklist:
- [ ] Command palette
- [ ] City Launcher wizard
- [ ] Settings page
- [ ] Floating action bar
- [ ] Sort indicators
- [ ] JSON expansion modal
- [ ] Audit log entries
- [ ] Alert cards on Overview
- [ ] Map overlays (Leaflet)

All must use CSS custom properties from `globals.css`, never raw hex values for backgrounds, text, or borders.

---

## 13. Implementation Order & Dependencies

```
Wave 1 (foundation) ─────────────────────────────────────────────────────
  1A. Sidebar grouping          [no deps]
  1B. Hash routing               [no deps]
  1C. DataTable sorting          [no deps]
  1D. CSV export utility         [no deps]
  1E. Audit logging (migration)  [no deps]
  1F. Shared formatters          [no deps]
  1G. window.confirm → Modal     [no deps]

Wave 2 (security) ───────────────────────────────────────────────────────
  2A. admin_users RLS            [depends on 1E migration being deployed first]
  2B. Secure script execution    [no deps]
  2C. Server-side user delete    [no deps]

Wave 3 (page fixes) ─────────────────────────────────────────────────────
  All page fixes depend on Wave 1 being complete.
  Individual pages are independent of each other.
  Recommended order:
    3A. Reports (most broken)
    3B. Overview (depends on 1E for audit activity section)
    3C. Users (largest, most impactful)
    3D. Subscriptions
    3E. Content
    3F. Analytics (requires migration)
    3G. Email (requires migration + edge function update)
    3H. App Config
    3I. Table Browser
    3J. Beta Feedback
    3K. Place Pool
    3L. Photo Pool
    3M. Admin Users

Wave 4 (new pages) ──────────────────────────────────────────────────────
  4A. City Launcher              [depends on 1A, 1B, 1C, 1D]
  4B. Settings page              [depends on 3H completion to migrate App Config]

Wave 5 (copy) ───────────────────────────────────────────────────────────
  Can run in parallel with Wave 3 — string-only changes.
  Do copy changes page-by-page as each page is touched in Wave 3.

Wave 6 (power features) ─────────────────────────────────────────────────
  6A. Command palette            [depends on 1B for navigation]
  6B. Bulk actions on DataTable  [depends on 1C]

Wave 7 (polish) ──────────────────────────────────────────────────────────
  Last. All other waves must be complete.
```

**Minimum viable delivery:** Waves 1 + 2 + 5. This gives grouped nav, sorting, export, audit logging, security fixes, and clean copy — without any page logic changes.

---

## 14. Acceptance Criteria — Global

These apply to EVERY change in this spec:

### Functional
- [ ] All existing page IDs (`overview`, `analytics`, `users`, etc.) continue to work
- [ ] All existing Supabase queries continue to return correct data
- [ ] All existing mutations continue to succeed
- [ ] No `window.confirm()` calls remain
- [ ] All tables have column sorting available
- [ ] All tables with data have an Export button
- [ ] Audit log captures every admin mutation
- [ ] Pagination is consistent (exact count + range) on all paginated pages

### Regression
- [ ] Auth flow works (login, 2FA, invite setup)
- [ ] Theme toggle works (light/dark/system)
- [ ] Framer Motion page transitions still animate
- [ ] Mobile sidebar still works (drawer mode)
- [ ] Toast notifications still appear and auto-dismiss
- [ ] Error boundaries still catch and display errors
- [ ] All existing modals still open, focus-trap, and close correctly
- [ ] No nested-modal `body.overflow` conflicts introduced

### Security
- [ ] `admin_users` no longer exposes full table to anon
- [ ] `get_admin_emails()` RPC returns only email + status
- [ ] No `exec_sql` RPC is callable
- [ ] Custom SQL is owner-only
- [ ] User delete uses server-side edge function only
- [ ] No anon key exposed in admin-level API calls

### Visual
- [ ] All new components work in light and dark mode
- [ ] No hardcoded hex colors for backgrounds, text, or borders (use CSS custom properties)
- [ ] Brand color `#f97316` is only used for accent elements (consistent with existing usage)
- [ ] Sidebar group headers are visually distinct but not distracting

### Copy
- [ ] No vendor names (Supabase, Resend, RevenueCat) in user-facing text
- [ ] No screaming caps in any text
- [ ] No subtitles that restate the page title
- [ ] All empty states guide the admin toward action
- [ ] All confirmation modals have clear, specific copy

### Performance
- [ ] No page fetches more than 1,000 rows client-side (analytics uses RPCs)
- [ ] Export is capped at 10,000 rows with warning
- [ ] Search debounce is 300-400ms on all pages
- [ ] Map clustering prevents marker overload

---

## Appendix A: New Database Objects Summary

| Object | Type | Migration Required |
|--------|------|-------------------|
| `admin_audit_log` table | Table + RLS | Yes |
| `get_admin_emails()` | Function | Yes |
| `admin_seed_demo_profiles()` | Function | Yes |
| `admin_clear_expired_caches()` | Function | Yes |
| `admin_reset_inactive_sessions()` | Function | Yes |
| `admin_clear_demo_data()` | Function | Yes |
| `admin_exec_sql()` | Function | Yes |
| `admin_subscription_stats()` | Function | Yes |
| `admin_analytics_growth()` | Function | Yes |
| `admin_analytics_engagement()` | Function | Yes |
| `admin_analytics_retention()` | Function | Yes |
| `admin_analytics_funnel()` | Function | Yes |
| `admin_analytics_geo()` | Function | Yes |
| `email_templates` table | Table + RLS + Seed | Yes |
| `user_reports.severity` column | ALTER TABLE | Yes |
| `place_reviews.moderation_status` column | ALTER TABLE | Yes |

**Total migrations:** 3-4 migration files (group logically, not one-per-object).

## Appendix B: New NPM Dependencies

| Package | Version | Purpose | Size |
|---------|---------|---------|------|
| `leaflet.markercluster` | ^1.5.3 | Map marker clustering | ~40KB |
| `@changey/react-leaflet-markercluster` | ^4.0.0 | React wrapper for markercluster | ~5KB |

No other new dependencies. Hash routing, CSV export, command palette, audit logging — all built with existing packages.

## Appendix C: New Files Summary

| File | Purpose |
|------|---------|
| `lib/exportCsv.js` | CSV export utility |
| `lib/auditLog.js` | Audit logging utility |
| `lib/formatters.js` | Shared date/string formatters |
| `lib/authComponents.js` | Shared auth screen components (DRY extraction) |
| `pages/CityLauncherPage.jsx` | City seeding wizard |
| `pages/SettingsPage.jsx` | Settings (theme + migrated App Config) |
| `components/CommandPalette.jsx` | Global Cmd+K search |

## Appendix D: Deleted Files

| File | Reason |
|------|--------|
| `pages/AppConfigPage.jsx` | Merged into SettingsPage |

---

*End of spec.*
