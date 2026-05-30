# SPEC — ORCH-1008 — Admin shell prune + Intelligence padding fix + Overview tab

- **Status:** READY FOR IMPLEMENT (Phases 1–3 only; Phase 4 dispatched to `mingla-designer` separately).
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1008-[admin-shell-prune-intelligence-overview]/`
- **Branch:** `ORCH-1008-admin-shell-prune-intelligence-overview`
- **Owner skill:** `mingla-implementor`
- **Date:** 2026-05-29
- **Predecessor context:** META-ORCH-1009 will use this admin tool to backfill 11,344 places. The Intelligence page must be operationally clean and the shell uncluttered before that megarun starts.

---

## §1 — Goal

Clean up the Mingla admin shell so the upcoming Intelligence backfill (META-ORCH-1009) has a focused operator surface. Three changes, in one PR: (Phase 1) delete six unused admin pages and flatten the sidebar so every surviving page is one click away; (Phase 2) fix the Place Intelligence Trial page so its outer padding matches the peer pages (Place Pool, Signal Library, Overview) which currently look wider/cleaner; (Phase 3) add an **Overview** tab to the Intelligence page that shows per-city coverage (servable totals, evaluated counts, % covered, last-run cost) and a **Run remainder** action that fires `start_run` with `mode='remainder'` to evaluate every un-evaluated servable place in the selected city.

---

## §2 — Inputs (file/path inventory)

> **Path discipline:** every path below is verified to exist in this worktree as of 2026-05-29. The implementor must not invent new files outside what is listed here.

### Phase 1 deletions (6 files)

```
mingla-admin/src/pages/ContentModerationPage.jsx (DELETE)
mingla-admin/src/pages/AnalyticsPage.jsx          (DELETE)
mingla-admin/src/pages/ReportsPage.jsx            (DELETE)
mingla-admin/src/pages/BetaFeedbackPage.jsx       (DELETE)
mingla-admin/src/pages/SeedPage.jsx               (DELETE)
mingla-admin/src/pages/TableBrowserPage.jsx       (DELETE)
```

If any of the six pages have peer-only subdirectories under `mingla-admin/src/components/` (e.g. `components/seeding/` exists today and is consumed exclusively by `SeedPage.jsx`), the implementor MUST `grep -r '<componentName>' mingla-admin/src/` to confirm zero remaining import sites, then delete the orphaned subtree in the same commit. Confirmed orphans expected after deletion:

- `mingla-admin/src/components/seeding/**` (consumed only by `SeedPage.jsx` — verify with grep before deletion)
- `mingla-admin/src/components/rules-filter/**` (header comment in `App.jsx` says rules-filter rehomed to `SignalLibraryPage` via tab prop — verify zero references from surviving pages before deletion; if still in use by SignalLibraryPage, KEEP)

### Phase 1 edits (3 files)

```
mingla-admin/src/App.jsx
  — lines 13, 19, 20, 22 (delete 4 imports)
  — line 24 (delete BetaFeedbackPage import)
  — lines 12, 47 (delete TableBrowserPage import + 'tables' route)
  — lines 35-55: delete from PAGES map the 6 keys: 'content', 'analytics', 'reports', 'feedback', 'seed', 'tables'

mingla-admin/src/lib/constants.js
  — NAV_GROUPS array (lines 110-178 currently): rewrite per §3 Phase 1 contract below.
  — NAV_ITEMS (line 181) is derived from NAV_GROUPS — no manual change needed.

mingla-admin/src/components/layout/Sidebar.jsx
  — verify NAV_GROUPS render still works after constants.js rewrite.
  — no structural edit needed; the `group.collapsible` branch (lines 137-159) becomes dead code path because no surviving group sets collapsible=true; LEAVE the branch in place (harmless, future-proofing).
```

### Phase 1 — KEEP, do NOT delete

```
mingla-admin/src/pages/EmailPage.jsx          (operator-confirmed survival; sidebar position preserved)
mingla-admin/src/pages/SettingsPage.jsx       (sidebar link promotes from System dropdown → flat top-level)
mingla-admin/src/pages/OverviewPage.jsx       (Dashboard — sidebar root)
mingla-admin/src/pages/AdminPage.jsx          (Admin Users)
mingla-admin/src/pages/SubscriptionManagementPage.jsx
mingla-admin/src/pages/UserManagementPage.jsx
mingla-admin/src/pages/PlacePoolManagementPage.jsx
mingla-admin/src/pages/SignalLibraryPage.jsx
mingla-admin/src/pages/PhotoLabelingPage.jsx
mingla-admin/src/pages/PhotoScorerPage.jsx
mingla-admin/src/pages/PlaceIntelligenceTrialPage.jsx
mingla-admin/src/pages/ClaimsPage.jsx
```

### Phase 2 edits (1 file)

```
mingla-admin/src/pages/PlaceIntelligenceTrialPage.jsx
  — line 43 (root wrapper): change
      <div className="max-w-[var(--content-max-width)] mx-auto px-6 py-6 space-y-6">
    to
      <div className="py-6 flex flex-col gap-6">
```

### Phase 3 new files (3 files)

```
mingla-admin/src/components/placeIntelligenceTrial/IntelligenceOverviewTab.jsx (NEW)
mingla-admin/src/services/intelligenceCoverageService.js                       (NEW)
mingla-admin/src/components/placeIntelligenceTrial/RunRemainderConfirmModal.jsx (NEW)
```

> **Naming decision (logged §7-D1):** The Trial Results tab does NOT need to be extracted into its own file — it's already in `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx`. The dispatch's "IntelligenceTrialResultsTab.jsx (extracted from existing)" entry is satisfied by the existing file; no rename required.

### Phase 3 edits (2 files)

```
mingla-admin/src/pages/PlaceIntelligenceTrialPage.jsx
  — TABS array (line 28): add { id: "overview", label: "Overview" } as the FIRST entry
      (Overview is the operator's landing tab when they click Intelligence Trial)
  — useState default (line 40): change "results" → "overview"
  — AnimatePresence branch (line 76): add `{activeTab === "overview" && <IntelligenceOverviewTab />}`
  — header copy (lines 49-56): unchanged
  — info AlertCard (line 59-63): unchanged

supabase/functions/run-place-intelligence-trial/index.ts
  — line 27 of the CHECK constraint (migration file, NOT touched in this ORCH — see §3 Phase 3b D-1)
  — handleStartRun (line 965 onward):
      * line 988: extend mode validation to accept 'remainder' as a third value
      * line 994: extend `if (mode === "sample")` branch so 'remainder' SKIPS sample-size requirement (mirrors full_city)
      * line 1035: extend effectiveCount calculation
      * line 1039-1056: add remainder branch — load servable IDs EXCLUDING ones already evaluated for this city
      * line 1058-1080: cost guard — 'remainder' uses same $5 hard guard as sample (raise above $5 only with confirm_high_cost=true, mirrors full_city)
      * line 1094-1095: parent insert — sample_size NULL for remainder, mode='remainder'
      * line 1155-1180: 'remainder' SHOULD use the same pg_net first-chunk kick as full_city (durable server-side execution)
  — line 550 error message: update enum list to include 'remainder' in the docstring
```

> **Migration decision (logged §7-D2):** The DB CHECK constraint `mode IN ('sample','full_city')` (migration `20260506000001_orch_0737_async_trial_runs.sql:27`) MUST be extended to allow `'remainder'`. The implementor creates a NEW migration file `supabase/migrations/<YYYYMMDDHHMMSS>_orch_1008_remainder_mode.sql` that drops + recreates the constraint and the `chk_sample_size_consistency` CHECK to allow `(mode='remainder' AND sample_size IS NULL)`. The original migration must NOT be edited (immutability rule).

---

## §3 — Contracts per phase

### Phase 1 — Shell prune + flat navigation

**Before:** 7 nav groups, "System" dropdown collapsed by default holds Settings + Table Browser. 6 pages users never click ship in production.

**After:** 1 flat sidebar list, no collapsible groups, no `System` dropdown. Sidebar order top→bottom:

```
Dashboard              (id: "overview",     icon: "LayoutDashboard")
Subscriptions          (id: "subscriptions",icon: "CreditCard")
Admin Users            (id: "admin",        icon: "Shield")
Place Pool             (id: "placepool",    icon: "Globe")
Signal Library         (id: "signals",      icon: "Activity")
Photo Labeling         (id: "photo-labeling",icon: "Camera")
Photo Scorer           (id: "photo-scorer", icon: "Sparkles")
Intelligence Trial     (id: "place-intelligence-trial", icon: "Microscope")
Email                  (id: "email",        icon: "Mail")
Venue claims           (id: "claims",       icon: "ClipboardList")
Users                  (id: "users",        icon: "Users")
Settings               (id: "settings",     icon: "Settings")
```

> **Order decision (logged §7-D3):** The user-supplied desired order ("Overview > Subscriptions > Admin Users > Place Pool > Signal Library > Photo Labeling > Photo Scorer > Intelligence Trial > Email > Venue claims > Settings") OMITS the surviving `UserManagementPage` ("Users"). Operator was almost certainly listing in shorthand. The implementor MUST keep Users in the sidebar (the page is not in the deletion list) and place it ONE row above Settings as shown above. If operator wanted Users deleted, this SPEC must be revised before implementation.

**Exact rewrite for `mingla-admin/src/lib/constants.js` NAV_GROUPS:**

```js
export const NAV_GROUPS = [
  {
    label: null,
    items: [
      { id: "overview",                  label: "Dashboard",          icon: "LayoutDashboard" },
      { id: "subscriptions",             label: "Subscriptions",      icon: "CreditCard" },
      { id: "admin",                     label: "Admin Users",        icon: "Shield" },
      { id: "placepool",                 label: "Place Pool",         icon: "Globe" },
      { id: "signals",                   label: "Signal Library",     icon: "Activity" },
      { id: "photo-labeling",            label: "Photo Labeling",     icon: "Camera" },
      { id: "photo-scorer",              label: "Photo Scorer",       icon: "Sparkles" },
      { id: "place-intelligence-trial",  label: "Intelligence Trial", icon: "Microscope" },
      { id: "email",                     label: "Email",              icon: "Mail" },
      { id: "claims",                    label: "Venue claims",       icon: "ClipboardList" },
      { id: "users",                     label: "Users",              icon: "Users" },
      { id: "settings",                  label: "Settings",           icon: "Settings" },
    ],
  },
];
```

**Behavior change:**
- `getTabFromHash()` (App.jsx line 57): the PAGES guard still falls back to `'overview'` for any deleted hash (`#/seed`, `#/tables`, etc.) — no extra handling needed.
- CommandPalette (`mingla-admin/src/components/CommandPalette.jsx`): the implementor MUST `grep -n "seed\|tables\|content\|analytics\|reports\|feedback" mingla-admin/src/components/CommandPalette.jsx` and remove any palette entries referencing the 6 deleted IDs.

**Acceptance gate (Phase 1):**
- `cd mingla-admin && npm run build` exits 0.
- `grep -rE "ContentModerationPage|AnalyticsPage|ReportsPage|BetaFeedbackPage|SeedPage|TableBrowserPage" mingla-admin/src/` returns ZERO matches.
- Sidebar renders exactly 12 nav items in the order specified above; no group labels visible; no ChevronDown collapse affordance visible.
- Navigating to legacy hashes (`#/seed`, `#/tables`, `#/content`, `#/analytics`, `#/reports`, `#/feedback`) silently falls back to `'overview'` (existing fallback in `getTabFromHash`, line 59).

---

### Phase 2 — Padding fix

**Before:** `PlaceIntelligenceTrialPage.jsx` line 43 root wrapper is `<div className="max-w-[var(--content-max-width)] mx-auto px-6 py-6 space-y-6">`. The AppShell already wraps every page child in `<div className="w-full max-w-[--content-max-width] mx-auto px-16">` (AppShell.jsx line 39). Result: the Intelligence Trial page applies a redundant `max-w` inside an already-`max-w` container AND adds a second horizontal padding (`px-6` inside `px-16`), making content visually narrower and shifted compared to peer pages.

**After:** Root wrapper matches the canonical peer-page pattern used by `SignalLibraryPage.jsx` line 1001 (`<div className="py-6 flex flex-col gap-6">`) and `PlacePoolManagementPage.jsx` line 2460 (`<div className="space-y-4 py-6">`). Pick:

```jsx
<div className="py-6 flex flex-col gap-6">
```

This drops `max-w-[var(--content-max-width)] mx-auto` (already handled by AppShell) and `px-6` (already handled by AppShell `px-16`). `py-6` is retained because AppShell does not provide vertical padding. `space-y-6` → `flex flex-col gap-6` (equivalent, matches SignalLibraryPage convention).

**Acceptance gate (Phase 2):**
- Visual diff: open `#/place-intelligence-trial` and `#/signals` side-by-side in browser; the page content's left edge, right edge, and top inset match within 1px.
- `cd mingla-admin && npm run build` exits 0.
- No regression in TrialResultsTab inner layout (the tab is a child of the wrapper; inner padding unaffected).

---

### Phase 3a — Overview tab (UI + service)

#### File 1: `mingla-admin/src/services/intelligenceCoverageService.js` (NEW)

**Purpose:** Single service that fetches per-city coverage for every city that has at least one servable place. Called by `IntelligenceOverviewTab` on mount + refresh.

**Function signature (verbatim):**

```js
/**
 * Fetch per-city intelligence coverage for the Overview tab.
 *
 * Returns an array — one row per seeding_city that has ≥1 servable place_pool row.
 * Sorted by servable_count desc.
 *
 * @returns {Promise<Array<{
 *   city_id: string,
 *   city_name: string,
 *   country: string | null,
 *   servable_count: number,           // place_pool WHERE city_id=X AND is_servable=true
 *   evaluated_count: number,          // distinct place_pool_id from place_intelligence_trial_runs WHERE city_id=X AND status='completed'
 *   remaining_count: number,          // servable_count - evaluated_count (floor 0)
 *   coverage_pct: number,             // round(evaluated_count / servable_count * 100, 1); 0 if servable_count=0
 *   last_run_at: string | null,       // ISO timestamp of most recent place_intelligence_runs.completed_at WHERE city_id=X
 *   last_run_status: string | null,   // status of that run
 *   last_run_cost_usd: number | null, // cost_so_far_usd of that run
 *   last_run_mode: string | null,     // 'sample' | 'full_city' | 'remainder'
 * }>>}
 */
export async function fetchIntelligenceCoverage() { ... }
```

**SQL (verbatim — executed via supabase-js client; the implementor may issue these as three parallel queries + join in JS, OR define one Postgres RPC `admin_intelligence_coverage()` and call it):**

```sql
-- Query A: servable counts per city
SELECT city_id, count(*)::int AS servable_count
FROM public.place_pool
WHERE is_servable = true AND city_id IS NOT NULL
GROUP BY city_id;

-- Query B: evaluated counts per city (distinct place ids that have ≥1 completed evaluation)
SELECT city_id, count(DISTINCT place_pool_id)::int AS evaluated_count
FROM public.place_intelligence_trial_runs
WHERE status = 'completed' AND city_id IS NOT NULL
GROUP BY city_id;

-- Query C: most recent terminal run per city
SELECT DISTINCT ON (city_id)
  city_id,
  id              AS last_run_id,
  completed_at    AS last_run_at,
  status          AS last_run_status,
  cost_so_far_usd AS last_run_cost_usd,
  mode            AS last_run_mode
FROM public.place_intelligence_runs
WHERE status IN ('complete','failed','cancelled')
ORDER BY city_id, completed_at DESC NULLS LAST;

-- Query D: city dimension (one row per city in seeding_cities that has ≥1 servable place)
SELECT sc.id AS city_id, sc.name AS city_name, sc.country
FROM public.seeding_cities sc
WHERE EXISTS (
  SELECT 1 FROM public.place_pool pp
  WHERE pp.city_id = sc.id AND pp.is_servable = true
);
```

> **RPC vs JS-join decision (logged §7-D4):** The implementor chooses based on existing convention. If `admin_*` RPCs are the pattern in `mingla-admin/src/services/` (yes — `adminClaimsService.js` uses RPCs), prefer a NEW Postgres RPC `admin_intelligence_coverage()` returning the joined rows. The migration goes in the SAME `<...>_orch_1008_remainder_mode.sql` file as the CHECK constraint change. Otherwise issue 4 parallel `supabase.from(...).select(...)` calls and join client-side.

#### File 2: `mingla-admin/src/components/placeIntelligenceTrial/IntelligenceOverviewTab.jsx` (NEW)

**Purpose:** Renders the per-city coverage table + "Run remainder" CTA per row.

**Layout contract (mobile/desktop responsive — desktop primary; admin is desktop-first per existing convention):**

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Header:  "Per-city coverage"  [Refresh button]                           │
├──────────────────────────────────────────────────────────────────────────┤
│ Table:                                                                   │
│  City | Country | Servable | Evaluated | Remaining | Coverage |          │
│  Last run (mode, status, when, $) | Action                               │
│                                                                          │
│  For each row: "Run remainder" button → opens RunRemainderConfirmModal   │
│   - Disabled (greyed + tooltip "0 places to evaluate") if remaining=0    │
│   - Disabled (greyed + tooltip "Run already in progress") if there is    │
│     an active run for this city (re-query place_intelligence_runs        │
│     WHERE status IN ('pending','running','cancelling') on click via      │
│     the existing 'list_active_runs' edge action before opening modal —   │
│     avoids race with the unique partial index 23505 error)               │
└──────────────────────────────────────────────────────────────────────────┘
```

**Cells:**
- Servable / Evaluated / Remaining: `.toLocaleString()` integers.
- Coverage: `XX.X%` with a horizontal mini-bar (reuse the bar pattern from `PlacePoolManagementPage.jsx` line 2491 `<div className="flex-1 bg-[var(--gray-100)] rounded-full h-2 overflow-hidden max-w-[120px]">`).
- Last run cell: `gemini · complete · 4h ago · $12.34` formatted via existing `lib/formatters.js` `timeAgo` helper; `$—` when no terminal run exists; mode capitalized.

**Empty state:** "No cities have servable places yet. Seed a city via Place Pool first." with a button that calls `onTabChange('placepool')` (the tab is currently passed to OverviewPage via `<ActivePage onTabChange={handleTabChange} />` in App.jsx line 136 — the implementor MUST thread the same prop through `PlaceIntelligenceTrialPage` → `IntelligenceOverviewTab`).

**Loading state:** Skeleton rows (reuse `mingla-admin/src/components/ui/Skeleton.jsx` if a row skeleton exists; otherwise 5 plain pulse divs).

**Error state:** Reuse the `ErrorState` pattern from `OverviewPage.jsx` lines 248-262.

#### File 3: `mingla-admin/src/components/placeIntelligenceTrial/RunRemainderConfirmModal.jsx` (NEW)

**Purpose:** Confirmation modal shown before firing `start_run` with `mode='remainder'`.

**Behavior:**
1. On open: receive `{ cityId, cityName, remainingCount }`. Compute estimated cost client-side: `estCost = remainingCount * 0.0040`. (Matches `PER_PLACE_COST_USD` in edge fn line 637; **Gemini 2.5 Flash pricing reference: https://ai.google.dev/pricing/gemini-2-5-flash** — last verified 2026-05-29; implementor MUST verify this URL still resolves and the per-input/output-token math behind `$0.0040` still holds. If the rate has moved materially, flag and pause.)
2. Render headline: `Run remainder for <cityName>?`
3. Render body: `This will evaluate <remainingCount.toLocaleString()> un-evaluated servable places using Gemini 2.5 Flash. Estimated cost: $<estCost.toFixed(2)>. Estimated runtime: <ceil(remainingCount * 30 / 60)> minutes (server-side; you can close the tab).`
4. If `estCost > 10`: show a SECOND red banner: `⚠ Estimated cost exceeds $10. Type the city name below to confirm.` Require a text input matching `cityName` exactly (case-sensitive) before the Run button enables.
5. If `5 < estCost <= 10`: enable Run normally but ALSO set `confirm_high_cost: true` in the edge call body (matches existing full_city contract at edge fn line 1071).
6. If `estCost <= 5`: enable Run normally without `confirm_high_cost`.
7. On Run click: POST to `run-place-intelligence-trial` with body:
   ```js
   {
     action: "start_run",
     city_id: cityId,
     mode: "remainder",
     confirm_high_cost: estCost > 5,  // true ≥ $5; field ignored by edge for ≤$5
   }
   ```
8. On success: close modal, surface toast `Run started — <runId.slice(0,8)>`, navigate to Trial Results tab (`setActiveTab("results")`) so operator can watch progress (the existing TrialResultsTab already polls `run_status`).
9. On error: keep modal open, surface red banner with `extractFunctionError` output. Handle the 409 `concurrent_run` case (city already has an active run) with a clear message + a "View running run" button that switches to Trial Results tab.

> **$10 threshold decision (logged §7-D5):** Dispatch said "Confirmation modal threshold ($10 estimated cost)". The existing edge function uses $5 as the hard guard. We layer the UX: $0–$5 single confirm, $5.01–$10 require `confirm_high_cost=true` (edge accepts), >$10 require typed city-name confirmation in addition to `confirm_high_cost=true`. This preserves the existing edge guard semantics while adding the operator-requested $10 friction.

**Acceptance gate (Phase 3a):**
- Mount the Overview tab on a fresh page load — within 3s, see ≥1 row (today: Raleigh, Lagos, DC at minimum based on existing place_pool data).
- Click Refresh — table re-fetches without a page reload.
- For a city with `remaining_count = 0`, the Run remainder button is visibly disabled with tooltip.
- For a city with an active running run, clicking Run remainder shows a "Run already in progress" toast and does NOT open the modal.
- Modal cost-preview math matches the edge function's actual `effectiveCount * 0.0040` calculation.

---

### Phase 3b — Edge function `mode='remainder'` action

**Function signature change:**

```ts
// edge fn line 988 — extend the mode enum check:
if (mode !== "sample" && mode !== "full_city" && mode !== "remainder") {
  return json({ error: "mode must be 'sample' | 'full_city' | 'remainder'" }, 400);
}
```

**Sample-size handling (line 994):**

```ts
let sampleSize: number | null = null;
if (mode === "sample") {
  // existing 50-500 validation unchanged
}
// 'remainder' and 'full_city' both leave sampleSize === null
```

**Place selection (insert NEW branch alongside the existing line 1041 `if (mode === "full_city")`):**

```ts
let sampledIds: string[];
if (mode === "full_city") {
  sampledIds = pool.map((p) => p.id);
} else if (mode === "remainder") {
  // ORCH-1008 — select servable place IDs that have NEVER been completed for this city.
  // "Never completed" = no row in place_intelligence_trial_runs with status='completed'
  // and city_id = <this city>. We do this via a NOT IN subquery against the already-loaded
  // pool to avoid a second round-trip.
  const { data: completedRows, error: completedErr } = await db
    .from("place_intelligence_trial_runs")
    .select("place_pool_id")
    .eq("city_id", cityId)
    .eq("status", "completed");
  if (completedErr) return json({ error: completedErr.message }, 500);
  const evaluatedSet = new Set((completedRows ?? []).map((r) => r.place_pool_id));
  sampledIds = pool.map((p) => p.id).filter((id) => !evaluatedSet.has(id));
  if (sampledIds.length === 0) {
    return json({
      error: "no_remainder",
      message: `All ${pool.length} servable places in this city are already evaluated.`,
    }, 400);
  }
} else {
  // existing 'sample' stratified-random branch unchanged
}
```

**SQL predicate (verbatim — what "un-evaluated servable places in a city" means):**

```sql
SELECT pp.id
FROM public.place_pool pp
WHERE pp.is_servable = true
  AND pp.city_id    = $1::uuid
  AND NOT EXISTS (
    SELECT 1
    FROM public.place_intelligence_trial_runs r
    WHERE r.place_pool_id = pp.id
      AND r.city_id       = $1::uuid
      AND r.status        = 'completed'
  );
```

The TS branch above is the JS-side equivalent of this SQL — same semantics. The implementor MAY swap the JS approach for a single RPC call if they prefer, as long as the resulting `sampledIds` set is identical to the SQL above.

**effectiveCount + estCost (line 1035):**

```ts
const effectiveCount = mode === "sample"
  ? Math.min(sampleSize as number, totalServable)
  : sampledIds.length;  // full_city: all servable; remainder: only un-evaluated
const estCost = +(effectiveCount * PER_PLACE_COST_USD).toFixed(4);
```

**Cost guard (line 1063):**

```ts
if (estCost > COST_GUARD_USD) {
  if (mode === "sample") {
    return json({ error: `cost guard tripped: ...` }, 400);
  }
  // full_city AND remainder both require confirm_high_cost
  if ((mode === "full_city" || mode === "remainder") && body.confirm_high_cost !== true) {
    return json({
      error: "cost_above_guard",
      estimated_cost_usd: estCost,
      cost_guard_usd: COST_GUARD_USD,
      message: `${mode === "remainder" ? "Remainder" : "Full-city"} run exceeds $${COST_GUARD_USD}. Resubmit with confirm_high_cost=true to override.`,
    }, 400);
  }
}
```

**Parent insert (line 1094):**

```ts
.insert({
  ...
  mode,                                                // 'remainder' literal flows through
  sample_size: mode === "sample" ? effectiveCount : null,  // null for both full_city and remainder
  ...
})
```

**pg_net first-chunk kick (line 1158):**

```ts
if ((mode === "full_city" || mode === "remainder") && serviceKey) {
  // existing fire-and-forget POST to process_chunk unchanged
}
```

**DB CHECK constraint migration (NEW file):**

Create `supabase/migrations/<YYYYMMDDHHMMSS>_orch_1008_remainder_mode.sql`:

```sql
-- ORCH-1008: extend place_intelligence_runs.mode enum to include 'remainder'
-- (un-evaluated-only mode for backfill ops). Sample_size stays NULL for remainder.

BEGIN;

ALTER TABLE public.place_intelligence_runs
  DROP CONSTRAINT IF EXISTS place_intelligence_runs_mode_check;

ALTER TABLE public.place_intelligence_runs
  ADD  CONSTRAINT place_intelligence_runs_mode_check
       CHECK (mode IN ('sample','full_city','remainder'));

ALTER TABLE public.place_intelligence_runs
  DROP CONSTRAINT IF EXISTS chk_sample_size_consistency;

ALTER TABLE public.place_intelligence_runs
  ADD  CONSTRAINT chk_sample_size_consistency
       CHECK (
         (mode = 'sample'    AND sample_size IS NOT NULL)
         OR (mode = 'full_city' AND sample_size IS NULL)
         OR (mode = 'remainder' AND sample_size IS NULL)
       );

-- Optional: admin_intelligence_coverage RPC (§3 Phase 3a — only if implementor chose RPC path)
-- CREATE OR REPLACE FUNCTION public.admin_intelligence_coverage() ...

COMMIT;
```

**Acceptance gate (Phase 3b):**
- `supabase db push` (or remote migration via Management API) succeeds; constraint visible via `\d+ place_intelligence_runs`.
- Edge fn `deno check supabase/functions/run-place-intelligence-trial/index.ts` exits 0.
- Manual probe (via the admin UI Run remainder button on a small test city, OR via direct curl):
  ```bash
  curl -X POST https://<project>.supabase.co/functions/v1/run-place-intelligence-trial \
    -H "Authorization: Bearer <admin-jwt>" \
    -H "Content-Type: application/json" \
    -d '{"action":"start_run","city_id":"<test-city-uuid>","mode":"remainder"}'
  ```
  returns `{ run_id, mode: "remainder", count, estimated_cost_usd, ... }` AND a row appears in `place_intelligence_runs` with `mode='remainder'` AND child pending rows appear in `place_intelligence_trial_runs` only for places that have NEVER had `status='completed'` for this city.
- Second curl with the SAME city while the run is still active returns 409 `concurrent_run` (unique-index behavior preserved).
- After the run completes, calling Run remainder a SECOND time on the same city returns 400 `no_remainder` (because all servable places are now evaluated OR failed; failed places are NOT re-attempted by remainder mode — that's what `retry_failed_run` is for).

---

## §4 — Success criteria + acceptance tests per phase

### Phase 1 (shell prune)
- `cd mingla-admin && npm run build` exits 0.
- No 404s when clicking every surviving sidebar link (12 links).
- Sidebar order matches §3 Phase 1 exactly; Settings is a flat top-level item (no dropdown wrapper).
- Implementor regression test (NEW file `mingla-admin/src/__tests__/orch1008_shell_prune.test.js`):
  - Imports `NAV_GROUPS` from `lib/constants.js`; asserts `NAV_GROUPS.length === 1`, `NAV_GROUPS[0].items.length === 12`, and the exact id list matches `['overview','subscriptions','admin','placepool','signals','photo-labeling','photo-scorer','place-intelligence-trial','email','claims','users','settings']`.
  - Asserts none of `['content','analytics','reports','feedback','seed','tables']` appear in NAV_GROUPS.
  - Asserts deleted page modules cannot be imported (`expect(() => require('../pages/SeedPage')).toThrow()` etc.) — use dynamic `import()` + Jest's `expect(...).rejects.toThrow()`.
- Tester adversarial test (`mingla-tester`):
  - `grep -rE "import .* from .*pages/(SeedPage|TableBrowserPage|ContentModerationPage|AnalyticsPage|ReportsPage|BetaFeedbackPage)" mingla-admin/src/` returns ZERO matches.
  - Boot the dev server (`cd mingla-admin && npm run dev`), visit `/`, click every sidebar item, screenshot each — verify no console errors and no blank pages.
  - Visit `#/seed` directly in URL bar — verify clean fallback to `#/overview` without console error.
  - Verify `CommandPalette` (Cmd+K) does NOT show entries for the 6 deleted pages.

### Phase 2 (padding fix)
- `cd mingla-admin && npm run build` exits 0.
- Side-by-side screenshot test: open `#/place-intelligence-trial` and `#/signals` at 1440px viewport width; the content's left/right edges align within 1px.
- Tester adversarial: also compare at 1024px and 1920px breakpoints — alignment holds at all three.
- No regression in TrialResultsTab inner content (collage images, expand/collapse, run cards all render the same as before the patch).

### Phase 3a (Overview tab UI + service)
- Click Intelligence Trial in sidebar → page lands on Overview tab by default.
- Within 3 seconds of mount, the per-city coverage table renders with ≥1 row.
- Click Refresh → table re-fetches without a page reload; loading skeleton appears briefly.
- For each row, all 8 displayed fields match a direct SQL probe against the database (tester runs the §3 Phase 3a SQL queries via Management API + diff).
- Implementor unit test (`mingla-admin/src/services/__tests__/intelligenceCoverageService.test.js`): mock supabase client, assert the service returns the contracted shape and computes `coverage_pct` correctly for edge cases (0 servable, 0 evaluated, evaluated > servable from a stale matview — clamp to 100%).

### Phase 3b (Run remainder action + edge + migration)
- See §3 Phase 3b acceptance gate (curl probes + 409 + 400 `no_remainder` behavior).
- Tester adversarial:
  - Probe the unique-index race: open the Run remainder modal in TWO browser tabs for the same city. Click Run in tab 1 → success. Click Run in tab 2 → 409 with friendly message, modal stays open.
  - Probe the cost-guard tiers: pick a city with remaining_count = 100 (~$0.40, no `confirm_high_cost` needed). Pick a city with remaining_count = 2000 (~$8.00, `confirm_high_cost=true` set silently). If any city has remaining_count > 2500 (~$10.00+), the typed-city-name confirmation is required.
  - Cancel during a remainder run: existing `cancel_trial` action MUST work for `mode='remainder'` runs identically to full_city runs (it does — no code change needed because cancel_trial is mode-agnostic).
  - Verify no completed place is re-evaluated: after the run finishes, SQL probe `SELECT count(DISTINCT place_pool_id) FROM place_intelligence_trial_runs WHERE city_id=X AND status='completed'` strictly grows; no place_pool_id appears twice as completed within the same run.

---

## §5 — Invariants

**NEW invariant (status: PROPOSED — flips to ACTIVE on ORCH-1008 CLOSE):**

`I-PROPOSED-ADMIN-SHELL-FLAT-NAVIGATION` — The mingla-admin sidebar (driven by `mingla-admin/src/lib/constants.js` `NAV_GROUPS`) MUST contain exactly one group with `label: null`, no `collapsible: true` groups, and every surviving page MUST appear in that single group. Adding a new admin page requires inserting one item into the single group at the operator-approved position. This invariant is enforceable via a unit-test grep: `expect(NAV_GROUPS.length).toBe(1) && expect(NAV_GROUPS[0].collapsible).toBeFalsy()`.

**NEW invariant (status: PROPOSED — flips to ACTIVE on ORCH-1008 CLOSE):**

`I-PROPOSED-INTEL-TRIAL-PEER-PADDING` — `PlaceIntelligenceTrialPage.jsx` root wrapper MUST NOT include `max-w-*` or `mx-auto` or `px-*` classes; the AppShell owns horizontal layout. Only `py-*`, `flex flex-col`, `gap-*`, `space-y-*` are allowed at the page root. Enforceable via static grep: `grep -E '^\s*<div className=".*(max-w-|mx-auto|px-)' mingla-admin/src/pages/PlaceIntelligenceTrialPage.jsx` MUST return zero matches at the file's root return statement.

**NEW invariant (status: PROPOSED — flips to ACTIVE on ORCH-1008 CLOSE):**

`I-PROPOSED-INTEL-REMAINDER-SKIPS-COMPLETED` — `start_run` with `mode='remainder'` MUST exclude any `place_pool_id` that already has at least one `place_intelligence_trial_runs` row with `status='completed'` for the same `city_id`. Failed places are NOT skipped (operator uses `retry_failed_run` for that, which is mode-agnostic and already exists). Enforceable via the §4 Phase 3b adversarial probe.

---

## §6 — Out of scope

- **Phase 4 — UX upgrade of Trial Results tab.** `mingla-designer` owns that in a parallel dispatch. This SPEC does NOT touch `TrialResultsTab.jsx` internals.
- **Any consumer-deck code, `signalScorer.ts`, `ai_signal_scores` column.** META-ORCH-1009 territory; do NOT touch.
- **New external dependencies.** Reuse `framer-motion`, `lucide-react`, `tailwind`, supabase-js, existing UI primitives in `mingla-admin/src/components/ui/`.
- **Deleting `EmailPage.jsx`, `SettingsPage.jsx`, or any page not in the 6-deletion list.** Operator explicitly confirmed `EmailPage` survives; `SettingsPage` survives but flattens out of the System dropdown.
- **Renaming routes / changing hash schema.** Existing `#/<id>` scheme preserved.
- **Touching the original `20260506000001_orch_0737_async_trial_runs.sql` migration.** Immutability rule — extensions go in a NEW migration file.
- **The `retry_failed_run` action.** Already works for any mode; not modified.
- **Mobile/tablet redesign of the admin shell.** Desktop-first; mobile is operator-acceptable as-is.

---

## §7 — Decisions (judgment calls + rationale)

### D-1: Don't extract `TrialResultsTab` into a renamed file
**Context:** Dispatch listed `mingla-admin/src/pages/PlaceIntelligenceTrialPage/IntelligenceTrialResultsTab.jsx (extracted from existing)`. The file already exists at `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx`.
**Decision:** Keep the existing file unchanged. The "extraction" the dispatch implies has already happened in prior ORCHs.
**Risk if wrong:** None — implementor can rename later in Phase 4 if `mingla-designer` requires it.

### D-2: Create a NEW migration for the mode enum extension; do NOT edit the original
**Context:** The `mode IN ('sample','full_city')` CHECK constraint lives in `20260506000001_orch_0737_async_trial_runs.sql`. Mingla's migration immutability rule (codified across the codebase) forbids editing applied migrations.
**Decision:** New migration file `<timestamp>_orch_1008_remainder_mode.sql` drops + recreates both `place_intelligence_runs_mode_check` and `chk_sample_size_consistency`.
**Risk if wrong:** Implementor accidentally edits the original → dev-snowflake migration history breaks → recovery via the Taofeek-PR-merge SOP applies.

### D-3: Keep `Users` page in the sidebar; place it above Settings
**Context:** Operator's stated sidebar order omits `Users` (`UserManagementPage`), but the page is not in the deletion list.
**Decision:** Keep `Users` (id `"users"`) one row above `Settings`. Implementor MUST NOT delete it. If operator wanted it deleted, this SPEC must be revised first.
**Risk if wrong:** Sidebar has 12 items instead of 11 — operator can request re-prune in a follow-up.

### D-4: Service uses RPC if peer services do, else 4 parallel client queries
**Context:** `mingla-admin/src/services/adminClaimsService.js` uses Postgres RPCs as the dominant pattern.
**Decision:** Prefer a new RPC `admin_intelligence_coverage()` for performance and atomicity (single DB round-trip). Migration goes in the same `<...>_orch_1008_remainder_mode.sql` file. Fallback to 4 parallel `supabase.from()` calls is acceptable if the implementor finds an RPC pattern blocker.
**Risk if wrong:** Implementor picks the 4-query path → slightly slower Overview tab mount; acceptable.

### D-5: Layered cost guard ($5 hard-edge, $10 typed-confirm)
**Context:** Dispatch said "Confirmation modal threshold ($10 estimated cost)". Edge fn already has $5 hard guard.
**Decision:** Three-tier UX: $0–$5 single confirm, $5.01–$10 auto-`confirm_high_cost=true`, >$10 require typed city-name confirmation in addition. Edge fn semantics unchanged.
**Risk if wrong:** Operator wanted $10 to be the ONLY threshold (no $5 layer) → trivial UI rework, edge fn untouched.

### D-6: `remainder` mode does NOT re-process failed places
**Context:** Ambiguous in dispatch. "Un-evaluated" could mean "not completed" (excludes failed-with-row) or "no row at all" (excludes failed-with-row too) — but operator might want failed places retried.
**Decision:** `remainder` skips ANY place with `status='completed'` for the city, INCLUDING places that have ONLY failed rows (those still count as un-evaluated because no completed row exists). This means a `remainder` run WILL pick up previously-failed places. The existing `retry_failed_run` action remains the explicit path for retrying within a single source-run lineage.
**Risk if wrong:** If operator wanted `remainder` to skip failed-rows too, they can call `retry_failed_run` first to handle them, then `remainder` for everything else.

### D-7: Delete orphan component subtrees (`components/seeding`, etc.) in same commit
**Context:** Deleting `SeedPage.jsx` orphans `components/seeding/**`. Leaving orphans pollutes the codebase.
**Decision:** Implementor MUST `grep -r` to confirm zero remaining imports before deletion, then delete the orphan subtree in the same commit. The grep command + the deletions are listed explicitly in §2.
**Risk if wrong:** If a surviving page DOES import from `components/seeding`, the grep will catch it and the implementor will leave the subtree. Safe.

---

## §8 — Implementor checklist (one-page summary)

1. **Phase 1:** Delete 6 page files. Delete orphan component subtrees after grep-verifying zero remaining imports. Edit `App.jsx` (5 import lines + 6 PAGES keys). Rewrite `NAV_GROUPS` in `lib/constants.js` to the exact single-group structure in §3 Phase 1. Grep `CommandPalette.jsx` for deleted IDs and remove. Write the regression test file at `mingla-admin/src/__tests__/orch1008_shell_prune.test.js`. Build green.
2. **Phase 2:** One-line wrapper edit in `PlaceIntelligenceTrialPage.jsx` line 43. Build green. Visual diff vs SignalLibraryPage.
3. **Phase 3a:** Create `intelligenceCoverageService.js` with the exact signature in §3 Phase 3a. Create `IntelligenceOverviewTab.jsx` per the layout contract. Create `RunRemainderConfirmModal.jsx` with the 3-tier cost guard. Wire the new "overview" tab as the default in `PlaceIntelligenceTrialPage.jsx`. Optional RPC migration (see D-4).
4. **Phase 3b:** Create the migration file for the mode CHECK constraint + sample_size consistency CHECK. Extend `handleStartRun` in the edge fn per §3 Phase 3b. Update the line-550 error docstring. Deploy edge fn. Push migration.
5. **Single PR** with all phases. Title: `ORCH-1008: admin shell prune + Intelligence padding + Overview tab + remainder mode`. The tester runs §4 acceptance for all phases before merge.

— END SPEC —
