# SPEC — ORCH-1015 Intel Overview readiness ladder (boundary + details binary badges + smart-skip bulk run)

- **ORCH-ID:** ORCH-1015
- **Branch:** `ORCH-1015-intel-overview-readiness-ladder-badges`
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1015-[intel-overview-readiness-ladder-badges]/`
- **Branched from main at:** `9e1d25ad5` (ORCH-1014 was merged at `b9d9570b4`, closed `c1eeb441d`)
- **Findings:** A (badge logic), B (3-band ladder layout), C (smart-skip bulk button), D (edge-fn extension)
- **External APIs touched:** Gemini 2.5 Flash via `run-place-intelligence-trial` (pricing reference only). Pricing: https://ai.google.dev/pricing/gemini-2-5-flash (verified 2026-05-30). COMMS-0003 compliance: any code path that touches the edge fn must keep the pricing citation block intact.
- **Skill notes:** No Stripe surfaces. No DB migration. No new edge-fn actions (extending the existing `intelligence_coverage` action). No new external API calls — both new flags are derived from existing `seeding_cities` + `place_pool` columns.
- **Supersedes within scope:** Replaces the visualisation contract from ORCH-1014 (Seed count + Refresh count badges) with two binary readiness pills. Pre-existing count fields stay on the wire for downstream diagnostic use.

---

## §1 — Goal (plain English)

ORCH-1014 just shipped count-based "Seed status" + "Refresh status" badges in the per-city Intelligence Overview table. The operator reviewed and decided **counts are more information than needed** — what they actually need is a binary readiness check per city, on two specific questions tied to historical cutovers:

1. **Boundary** — has this city been **regeocoded** under the bbox model (the 2026-04 cutover that deprecated `coverage_radius_km`), or is it still on the old radius-based seeding?
2. **Details** — has this city been **refreshed since 2026-03-19**, when commit `596b3c05c` introduced the 48-field `DETAIL_FIELD_MASK` (editorialSummary + generativeSummary + priceRange + 23 facet booleans) that the Gemini intelligence trial actually reads?

Each becomes a green ✓ ("current") or amber ⚠ ("needs prep") pill. For Details, when ⚠ we still show the count of places needing refresh — so the operator can tell "Raleigh: 41" (quick fix) apart from a hypothetical "Lagos: 900" (big job). The pill itself is binary, but the cost-of-fix signal stays.

Three downstream consequences flow from those two flags:

1. **3-band ladder layout** — group the city rows by readiness: green-green at top, boundary-only at middle, boundary-needs-reseed at bottom. Within each band, sort by servable count desc. Operator's eye lands on "what's ready, what's almost ready, what needs major work" with zero cognitive load.
2. **Smart-skip bulk button** — ORCH-1013's "Run remainder on all un-evaluated cities" header button becomes **"Run remainder on all ready cities"** that auto-skips any city without both badges green. Protects Gemini scoring quality (cards in old-boundary or stale-details cities shouldn't get evaluated until the underlying data is ready). The per-city "Run remainder" button stays — operator override path preserved.
3. **Edge-fn shape extension** — the `intelligence_coverage` action returns three new fields per city (`regeocoded`, `refreshed_new_fields`, `needs_refresh_count`). Existing 6 ORCH-1014 fields (`first_seeded_at`, `last_seeded_at`, `refresh_oldest_at`, `refresh_newest_at`, `stale_refresh_count`, `missing_fields_count`) stay on the wire — operator may want them later for diagnostic purposes.

After ship: operator opens the Overview tab, sees three bands of cities, instantly knows which ones are bulk-runnable, hits one button to evaluate them all, and the un-ready cities surface their prep work (reseed / refresh) in the skipped-list so the operator can queue those separately.

---

## §2 — Inputs (file/path inventory per finding)

All paths absolute to worktree root `~/Desktop/mingla-orchs/ORCH-1015-[intel-overview-readiness-ladder-badges]/`. Every listed file confirmed to exist via `Read` tool 2026-05-30.

### Finding A — Binary badge logic
- **REPLACE** `mingla-admin/src/components/placeIntelligenceTrial/SeedStatusBadge.jsx` (43 lines) → **NEW** `mingla-admin/src/components/placeIntelligenceTrial/BoundaryReadinessBadge.jsx`
- **REPLACE** `mingla-admin/src/components/placeIntelligenceTrial/RefreshStatusBadge.jsx` (45 lines) → **NEW** `mingla-admin/src/components/placeIntelligenceTrial/DetailsReadinessBadge.jsx`
- **REPLACE** `mingla-admin/src/components/placeIntelligenceTrial/seedRefreshBadgeContent.js` (97 lines) → **NEW** `mingla-admin/src/components/placeIntelligenceTrial/readinessBadgeContent.js`
  - Same pattern (pure-JS helpers, no JSX) so `node --test` can exercise them — no new deps.

### Finding B — 3-band ladder layout
- **EDIT** `mingla-admin/src/components/placeIntelligenceTrial/IntelligenceOverviewTab.jsx` (488 lines)
  - L34-L35 — swap badge imports (`SeedStatusBadge` → `BoundaryReadinessBadge`, `RefreshStatusBadge` → `DetailsReadinessBadge`).
  - L313-L326 — rename column headers (`Seed status` → `Boundary`, `Refresh status` → `Details (new Google fields)`); `title` tooltips updated per §3-B.4.
  - L336-L438 — restructure tbody to render 3 banded sub-groups with thin divider rows + within-band sort by servable_count desc.
  - L349-L361 — swap badge instantiations + props per §3-A contracts.
  - L97-L108 — `candidateCities` `useMemo` becomes derived from §3-C readiness predicates (only green-green pass), feeds the bulk modal.

### Finding C — Smart-skip bulk button + modal
- **EDIT** `mingla-admin/src/components/placeIntelligenceTrial/RunRemainderOnAllConfirmModal.jsx` (215 lines)
  - L23-L30 — accept new prop `skippedCities` (cities NOT included; rendered in a separate panel).
  - L95-L111 — keep the "ready cities" list; add a sibling "skipped — needs prep first" list below.
  - L83-L86 — modal title becomes `Run remainder on N ready cities ↑` (singular/plural handling preserved).
  - L91-L93 — body intro copy updated per §3-C.3.
- **EDIT** `mingla-admin/src/components/placeIntelligenceTrial/IntelligenceOverviewTab.jsx`
  - L237-L251 — header button label changes (per §3-C.1); `disabled` predicate flips from `candidateCities.length === 0` to `readyCities.length === 0`; tooltip updated.
  - L97-L108 — split `candidateCities` into two memos: `readyCities` (passes §3-A predicate for BOTH badges = ✓) AND has `remaining_count > 0`; `skippedCities` (would have remainder but missing at least one ✓).
  - L462-L482 — pass `skippedCities` prop into the modal.

### Finding D — Edge-fn shape extension
- **EDIT** `supabase/functions/run-place-intelligence-trial/index.ts` (2429+ lines)
  - L2195-L2218 — extend header comment block with the 3 new fields + cutover-date constant rationale.
  - L2219 — keep `ORCH_1014_STALE_THRESHOLD_MS`. Add new constant:
    ```ts
    // ORCH-1015 — operator-chosen cutover date for the 48-field DETAIL_FIELD_MASK.
    // Set 2026-03-19 (commit 596b3c05c "feat: admin stale-place lifecycle UI + manual
    // refresh edge function"). Hardcoded; if the field mask ever expands again,
    // operator opens a new ORCH to bump this value — NOT runtime-tunable.
    const ORCH_1015_REFRESH_CUTOVER_DATE_MS = Date.parse("2026-03-19T00:00:00Z");
    ```
  - L2229-L2277 — extend the 6-parallel-fetch block: add a 7th fetch for `seeding_cities.coverage_radius_km` (joined to existing `citiesRes` shape change instead — see §3-D.2).
  - L2292-L2327 — extend the per-row aggregation loop to also count `needs_refresh_count` against the cutover-date constant.
  - L2377-L2414 — extend the returned row shape with `regeocoded`, `refreshed_new_fields`, `needs_refresh_count` (additive — keep all 6 ORCH-1014 fields).
- **EDIT** `mingla-admin/src/services/intelligenceCoverageService.js` (72 lines)
  - L9-L48 — extend the JSDoc typedef block with the 3 new fields. Keep existing 6.
- **TEST-MOD-APPROVED ORCH-1015** — extend these tests with new assertions for the 3 new fields, keep existing 6-field assertions intact:
  - `supabase/functions/run-place-intelligence-trial/__tests__/intelligence_coverage_seed_refresh.test.ts`

### Existing tests REPLACED per `[TEST-MOD-APPROVED ORCH-1015]`
The ORCH-1014 tests assert count-based renderings that flip to binary. Whole-file replacements (filenames change to reflect new contract):
- **DELETE** `mingla-admin/src/__tests__/orch1014_seed_status_badge.test.js` → **NEW** `mingla-admin/src/__tests__/orch1015_boundary_readiness_badge.test.js`
- **DELETE** `mingla-admin/src/__tests__/orch1014_refresh_status_badge.test.js` → **NEW** `mingla-admin/src/__tests__/orch1015_details_readiness_badge.test.js`
- **DELETE** `mingla-admin/src/__tests__/orch1014_overview_three_columns.test.js` → **NEW** `mingla-admin/src/__tests__/orch1015_overview_readiness_ladder.test.js`
- **DELETE** `mingla-admin/src/__tests__/orch1014_adversarial_badge_edge_cases.test.js` → **NEW** `mingla-admin/src/__tests__/orch1015_adversarial_badge_edge_cases.test.js`

### Tests KEPT verbatim (file-list scan still valid)
- `mingla-admin/src/__tests__/orch1014_adversarial_no_merge_conflicts.test.js` — UPDATE the `FILES_TO_SCAN` array to remove the 3 deleted filenames and add the 3 new ones. Keep test name + assertions identical.
- `mingla-admin/src/__tests__/orch1014_sidebar_post_prune.test.js` — no change, unrelated.

### Read-only references (no edit)
- `supabase/functions/admin-seed-places/index.ts` L166-L168 — the "BBOX MODEL (2026-04)" comment block that anchors the `coverage_radius_km = 0` semantic. Cited in §3-D.1.
- `supabase/functions/admin-refresh-places/index.ts` L31-L143 — the `DETAIL_FIELD_MASK` array. Cited in §3-D.1.
- `mingla-admin/src/components/placeIntelligenceTrial/RunRemainderConfirmModal.jsx` — per-city modal, untouched (override path).

### Live-DB truth re-probed 2026-05-30 (PROD)

```sql
SELECT name,
       CASE WHEN coverage_radius_km = 0 THEN 'yes' ELSE 'no' END AS regeocoded,
       CASE WHEN oldest_refresh >= '2026-03-19' THEN 'yes' ELSE 'no' END AS refreshed_new_fields,
       oldest_refresh, servable, needs_refresh_count, coverage_radius_km
FROM (
  SELECT sc.id, sc.name, sc.coverage_radius_km,
         COUNT(*) FILTER (WHERE pp.is_servable) AS servable,
         MIN(pp.last_detail_refresh) FILTER (WHERE pp.is_servable) AS oldest_refresh,
         COUNT(*) FILTER (WHERE pp.is_servable AND pp.last_detail_refresh < '2026-03-19') AS needs_refresh_count
  FROM seeding_cities sc
  LEFT JOIN place_pool pp ON pp.city_id = sc.id
  GROUP BY sc.id, sc.name, sc.coverage_radius_km
) t WHERE servable > 0 ORDER BY name;
```

| city | regeocoded | refreshed_new_fields | oldest_refresh | servable | needs_refresh_count | radius_km |
|---|---|---|---|---|---|---|
| Baltimore | ✗ | ✓ | 2026-04-02 | 1,205 | 0 | 10 |
| Brussels | ✓ | ✓ | 2026-04-02 | 1,858 | 0 | 0 |
| Cary | ✓ | ✓ | 2026-04-01 | 761 | 0 | 0 |
| Durham | ✓ | ✓ | 2026-04-22 | 648 | 0 | 0 |
| Fort Lauderdale | ✓ | ✓ | 2026-04-22 | 958 | 0 | 0 |
| Lagos | ✓ | ✓ | 2026-04-25 | 908 | 0 | 0 |
| London | ✗ | ✗ | 2026-03-16 | 3,495 | 10 | 10 |
| Raleigh | ✓ | ✓ | 2026-04-20 | 1,540 | 0 | 0 |
| Washington | ✓ | ✓ | 2026-04-01 | 2,298 | 0 | 0 |

(Cities with servable=0 — Berlin, Barcelona, Chicago, Dallas, Miami, New York, Paris, Toronto — hidden by default per existing filter preserved from ORCH-1014.)

**Truth changes since brief:**
- Cary, Durham, Raleigh have all been refreshed since the brief was written — now ✓-✓ (operator did a sweep).
- **London** now has servable=3,495 (was 0 in brief) AND is ✗-✗ — first true band-3 case in PROD.
- Baltimore alone in band 2 (boundary ✗, details ✓). Curious case the operator should triage: Baltimore was refreshed under the new field mask but its `coverage_radius_km` is still 10. Possible the operator refreshed places but didn't trigger a re-seed. Flagged in §7-D2.

---

## §3 — Contracts per finding

### Finding A — Binary readiness badge components

#### A.1 `BoundaryReadinessBadge.jsx` (NEW; 🔒LOCKED contract)

```jsx
// BoundaryReadinessBadge — ORCH-1015 Finding A (JSX renderer)
//
// Thin renderer around boundaryStatus() from readinessBadgeContent.js (pure JS,
// unit-tested separately). Read-only: NO button, NO link, NO CTA. Dark + light
// mode both use Tailwind v4 var(--color-…) tokens so the component inherits
// the active scheme. Operator acts on this signal from the Place Pool page —
// not here.

import { boundaryStatus } from "./readinessBadgeContent";

export function BoundaryReadinessBadge({ regeocoded }) {
  const c = boundaryStatus({ regeocoded });
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      data-testid="boundary-readiness-badge"
      data-state={c.state}
      style={{ backgroundColor: c.bgVar, color: c.fgVar }}
      title={c.tooltip}
    >
      {c.label}
    </span>
  );
}

export default BoundaryReadinessBadge;
```

**Prop contract (🔒LOCKED):**
- `regeocoded: boolean` — TRUE when `seeding_cities.coverage_radius_km = 0` (the deprecation marker the operator zeros after re-seeding under bbox).

**Render contract (🔒LOCKED):**
- `regeocoded === true` → pill text `✓ current`, `data-state="current"`, `bgVar="var(--color-success-50)"`, `fgVar="var(--color-success-700)"`, tooltip `"Re-seeded under the bbox model (coverage_radius_km = 0). Ready for evaluation."`.
- `regeocoded === false` → pill text `⚠ reseed`, `data-state="needs-reseed"`, `bgVar="var(--color-warning-50)"`, `fgVar="var(--color-warning-700)"`, tooltip `"Still on the deprecated radius model. Re-seed in Place Pool before evaluating."`.

#### A.2 `DetailsReadinessBadge.jsx` (NEW; 🔒LOCKED contract)

```jsx
// DetailsReadinessBadge — ORCH-1015 Finding A (JSX renderer)
//
// Thin renderer around detailsStatus() from readinessBadgeContent.js. Same
// read-only contract as BoundaryReadinessBadge.

import { detailsStatus } from "./readinessBadgeContent";

export function DetailsReadinessBadge({ refreshed, needs_refresh_count }) {
  const c = detailsStatus({ refreshed, needs_refresh_count });
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      data-testid="details-readiness-badge"
      data-state={c.state}
      style={{ backgroundColor: c.bgVar, color: c.fgVar }}
      title={c.tooltip}
    >
      {c.label}
    </span>
  );
}

export default DetailsReadinessBadge;
```

**Prop contract (🔒LOCKED):**
- `refreshed: boolean` — TRUE when oldest `last_detail_refresh` across servable places for this city is `>= 2026-03-19`.
- `needs_refresh_count: number` — count of servable places with `last_detail_refresh < 2026-03-19`. Only used when `refreshed === false`.

**Render contract (🔒LOCKED):**
- `refreshed === true` → pill text `✓ current`, `data-state="current"`, success tokens (same as boundary ✓), tooltip `"All servable places refreshed under the 48-field mask (post 2026-03-19)."`.
- `refreshed === false` → pill text `⚠ {N} places need refresh` where `N = needs_refresh_count.toLocaleString()` (thousands sep), `data-state="needs-refresh"`, warning tokens, tooltip `"{N} servable places haven't been refreshed since 2026-03-19 when the 48-field DETAIL_FIELD_MASK shipped. Refresh in Place Pool."` with `{N}` substituted (no thousands sep in tooltip — just bare number).
- Edge case: `refreshed === false && needs_refresh_count === 0` is logically impossible (if zero places need refresh, oldest is >= cutover). If it slips through (race), render the `⚠ 0 places need refresh` literal and let the test surface the bug.

#### A.3 `readinessBadgeContent.js` (NEW; 🔒LOCKED helpers)

```js
/**
 * Pure-JS readiness badge content helpers — ORCH-1015 Finding A
 *
 * Extracted from BoundaryReadinessBadge.jsx + DetailsReadinessBadge.jsx so the
 * text + state contracts can be unit-tested with plain `node --test` (no JSDOM,
 * no JSX loader, no new deps — same hard guard as ORCH-1014's
 * seedRefreshBadgeContent.js it replaces).
 *
 * Contracts mirror SPEC §3 A.1 + A.2 verbatim.
 */

/**
 * @typedef {Object} BoundaryStatusContent
 * @property {"current"|"needs-reseed"} state
 * @property {string} label    // "✓ current" or "⚠ reseed"
 * @property {string} bgVar    // CSS var token for pill background
 * @property {string} fgVar    // CSS var token for pill text
 * @property {string} tooltip
 */

/**
 * @param {Object} args
 * @param {boolean} args.regeocoded - true ⇔ seeding_cities.coverage_radius_km = 0
 * @returns {BoundaryStatusContent}
 */
export function boundaryStatus({ regeocoded }) {
  if (regeocoded) {
    return {
      state: "current",
      label: "✓ current",
      bgVar: "var(--color-success-50)",
      fgVar: "var(--color-success-700)",
      tooltip: "Re-seeded under the bbox model (coverage_radius_km = 0). Ready for evaluation.",
    };
  }
  return {
    state: "needs-reseed",
    label: "⚠ reseed",
    bgVar: "var(--color-warning-50)",
    fgVar: "var(--color-warning-700)",
    tooltip: "Still on the deprecated radius model. Re-seed in Place Pool before evaluating.",
  };
}

/**
 * @typedef {Object} DetailsStatusContent
 * @property {"current"|"needs-refresh"} state
 * @property {string} label    // "✓ current" or "⚠ N places need refresh"
 * @property {string} bgVar
 * @property {string} fgVar
 * @property {string} tooltip
 */

/**
 * @param {Object} args
 * @param {boolean} args.refreshed - true ⇔ MIN(last_detail_refresh for servable) >= 2026-03-19
 * @param {number}  args.needs_refresh_count - count of servable rows below cutover (rendered when !refreshed)
 * @returns {DetailsStatusContent}
 */
export function detailsStatus({ refreshed, needs_refresh_count = 0 }) {
  if (refreshed) {
    return {
      state: "current",
      label: "✓ current",
      bgVar: "var(--color-success-50)",
      fgVar: "var(--color-success-700)",
      tooltip: "All servable places refreshed under the 48-field mask (post 2026-03-19).",
    };
  }
  const n = Number(needs_refresh_count) || 0;
  return {
    state: "needs-refresh",
    label: `⚠ ${n.toLocaleString()} places need refresh`,
    bgVar: "var(--color-warning-50)",
    fgVar: "var(--color-warning-700)",
    tooltip: `${n} servable places haven't been refreshed since 2026-03-19 when the 48-field DETAIL_FIELD_MASK shipped. Refresh in Place Pool.`,
  };
}
```

**Helper contracts (🔒LOCKED):**
- Helpers are pure: no side effects, no mutation of input args, new object per call.
- No `onClick`, `href`, or any callable field in the descriptor (read-only — operator acts in Place Pool).
- All color tokens MUST be `var(--color-…)` so dark + light render coherently via existing Tailwind v4 theming.

---

### Finding B — 3-band readiness ladder

#### B.1 Column header changes (🔒LOCKED)

In `IntelligenceOverviewTab.jsx` L313-L326:

| current (ORCH-1014) | new (ORCH-1015) | tooltip |
|---|---|---|
| `Seed status` | `Boundary` | `Re-seed in Place Pool when ⚠` |
| `Refresh status` | `Details (new Google fields)` | `Refresh in Place Pool when ⚠` |

Column order unchanged: `City | Country | Boundary | Details | Servable | Evaluated | Remaining | Coverage | Last run | Action`. The two readiness columns sit between `Country` and `Servable` exactly where ORCH-1014 put them.

#### B.2 3-band grouping (🔒LOCKED)

Replace the single-tbody flat row-render at L336-L438 with three banded tbody sections (or a flat tbody with thin divider rows — implementor's choice, both are accessible). Bands defined:

| band | predicate | label (rendered in divider row) |
|---|---|---|
| 1 (top) | `regeocoded === true && refreshed_new_fields === true` | `Ready — boundary current + details current` |
| 2 (mid) | `regeocoded === true && refreshed_new_fields === false` | `Needs detail refresh` |
| 3 (bot) | `regeocoded === false` (details state irrelevant) | `Needs re-seed (deprecated boundary)` |

**Within each band:** sort by `servable_count DESC`. (Operator wants the biggest cities — most expensive to run — surfaced first within each band.)

**Empty bands:** omit the divider row entirely. Don't render `Needs re-seed — 0 cities`; just skip the band.

**Divider row markup** (🎨OPEN — implementor picks exact spacing within constraints):
- Full-width `<tr>` with a single `<td colSpan={10}>` (the 10 columns above).
- Tone: subtle. `bg-[var(--gray-50)]` background, `text-[10px] uppercase tracking-wide font-mono text-[var(--color-text-tertiary)]`, `px-3 py-1.5` padding, `border-y border-[var(--gray-200)]`.
- Text: the label from the table above. No icon, no badge, no action.
- a11y: `role="row"` already implicit; the divider must NOT have a `<th>` (it's not a header).

#### B.3 Default-hide cities with `servable_count = 0` (preserved from ORCH-1014)

The existing edge-fn `.filter((r) => r.servable_count > 0)` at L2413 stays. No client-side filter change. Cities still being seeded but with 0 servables (Berlin, Barcelona, Chicago, Dallas, Miami, New York, Paris, Toronto on the live probe) remain hidden by default.

#### B.4 Readiness predicates exposed as derived memos

In `IntelligenceOverviewTab.jsx` ABOVE `aggregate` (~L97):

```jsx
// ORCH-1015 — readiness predicates used by both the 3-band layout (§3 B.2)
// and the smart-skip bulk button (§3 C.2). Keep these helpers HERE (not in a
// shared util) so the test surface stays bound to the component file.
function isBoundaryReady(r) {
  return r?.regeocoded === true;
}
function isDetailsReady(r) {
  return r?.refreshed_new_fields === true;
}
function isFullyReady(r) {
  return isBoundaryReady(r) && isDetailsReady(r);
}

// ... inside the component:
const bandedRows = useMemo(() => {
  const sortBySrv = (a, b) => b.servable_count - a.servable_count;
  const band1 = rows.filter((r) => isBoundaryReady(r) && isDetailsReady(r)).sort(sortBySrv);
  const band2 = rows.filter((r) => isBoundaryReady(r) && !isDetailsReady(r)).sort(sortBySrv);
  const band3 = rows.filter((r) => !isBoundaryReady(r)).sort(sortBySrv);
  return { band1, band2, band3 };
}, [rows]);
```

---

### Finding C — Smart-skip bulk button + modal

#### C.1 Header button copy (🔒LOCKED)

In `IntelligenceOverviewTab.jsx` L237-L251, replace the button content:

**Before (ORCH-1013):**
```
Run remainder on all (N)
```

**After (ORCH-1015):**
- Label: `Run remainder on all ready cities`
- Count suffix: ` (${readyCities.length})` when > 0
- `disabled` when `readyCities.length === 0`
- `title` tooltip:
  - When ready > 0: `Queues remainder runs on ${readyCities.length} cit${plural} — skips ${skippedCount} cit${pluralSkipped} needing reseed or refresh to protect Gemini scoring quality`
  - When ready === 0 AND skipped > 0: `All cities with remainder need prep first (reseed or detail refresh)`
  - When ready === 0 AND skipped === 0: `All cities are fully evaluated` (preserved from ORCH-1013)

#### C.2 Ready/skipped split (🔒LOCKED)

In `IntelligenceOverviewTab.jsx` replace `candidateCities` memo (L97-L108) with:

```jsx
const readyCities = useMemo(
  () =>
    rows
      .filter((r) => r.remaining_count > 0 && isFullyReady(r))
      .map((r) => ({
        city_id: r.city_id,
        city_name: r.city_name,
        remaining_count: r.remaining_count,
      })),
  [rows],
);

const skippedCities = useMemo(
  () =>
    rows
      .filter((r) => r.remaining_count > 0 && !isFullyReady(r))
      .map((r) => ({
        city_id: r.city_id,
        city_name: r.city_name,
        remaining_count: r.remaining_count,
        regeocoded: r.regeocoded,
        refreshed_new_fields: r.refreshed_new_fields,
        skip_reason:
          !r.regeocoded
            ? "needs reseed"
            : "needs detail refresh",
      })),
  [rows],
);
```

#### C.3 Modal body update (🔒LOCKED)

`RunRemainderOnAllConfirmModal.jsx`:

- Prop signature gains `skippedCities = []` (default).
- Title becomes:
  ```
  Run remainder on ${safeCities.length} ready ${cityWord}
  ```
  (singular = `city`, plural = `cities` — preserved).
- Body intro copy (L91-L93):
  ```
  This will queue a remainder run for every city where Boundary + Details are
  both current, using Gemini 2.5 Flash. Cities needing reseed or detail
  refresh are listed below as skipped — fix those in Place Pool first.
  ```
- The existing "Per-city list" container (L96-L111) renders `safeCities` UNCHANGED.
- Add a NEW sibling container BELOW the totals block (after L140) and BEFORE the high-cost gate (L143), gated on `skippedCities.length > 0`:
  ```jsx
  {skippedCities.length > 0 && (
    <div className="rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)]">
      <div className="px-3 py-2 text-[10px] uppercase tracking-wide font-mono text-[var(--color-text-tertiary)] border-b border-[var(--gray-200)]">
        Skipped — needs prep first ({skippedCities.length})
      </div>
      <div className="divide-y divide-[var(--gray-200)] max-h-[160px] overflow-y-auto">
        {skippedCities.map((c) => (
          <div
            key={c.city_id}
            className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm"
          >
            <span className="text-[var(--color-text-secondary)] font-medium truncate">
              {c.city_name}
            </span>
            <span className="text-xs text-[var(--color-warning-700)] shrink-0">
              {c.skip_reason}
            </span>
          </div>
        ))}
      </div>
    </div>
  )}
  ```
- Acknowledgement copy + typed-confirm phrase + dispatcher behavior — UNCHANGED.
- Confirm button label `Queue all` — UNCHANGED. The `onConfirm(safeCities)` callback fires with the ready-only list (skipped cities never enter the dispatcher).

#### C.4 Per-city `Run remainder` button preserved (🔒LOCKED)

L418-L435 — the per-row `<Button>` stays. Operator can still hit `Run remainder` on a band-2 or band-3 city manually if they want to override. No badge gating on that path. (Override is intentional: operator may need to bootstrap a city or test a fix.)

---

### Finding D — Edge-fn `intelligence_coverage` extension

#### D.1 Cutover constants and rationale (🔒LOCKED)

Inside `supabase/functions/run-place-intelligence-trial/index.ts` near L2218, add a second named constant alongside `ORCH_1014_STALE_THRESHOLD_MS`:

```ts
// ORCH-1015 — operator-chosen cutover date for the 48-field DETAIL_FIELD_MASK.
// Set 2026-03-19 (commit 596b3c05c "feat: admin stale-place lifecycle UI +
// manual refresh edge function"). Anchored to the introduction of the full
// field set the Gemini intelligence trial reads (editorialSummary,
// generativeSummary, priceRange + 23 facet booleans). Hardcoded; if the field
// mask ever expands again, operator opens a new ORCH to bump this value —
// NOT runtime-tunable. See supabase/functions/admin-refresh-places/index.ts
// L31-L143 (DETAIL_FIELD_MASK array).
const ORCH_1015_REFRESH_CUTOVER_DATE_MS = Date.parse("2026-03-19T00:00:00Z");
```

`ORCH_1014_STALE_THRESHOLD_MS` and the existing 6 ORCH-1014 fields stay — operator may consult them later for diagnostic / sweep purposes.

#### D.2 Fetch the radius column (🔒LOCKED)

Extend the existing `citiesRes` fetch at L2237-L2240 from:

```ts
db
  .from("seeding_cities")
  .select("id, name, country")
  .order("name"),
```

…to:

```ts
db
  .from("seeding_cities")
  .select("id, name, country, coverage_radius_km")
  .order("name"),
```

No new parallel fetch needed. `coverage_radius_km` is the only column we need from `seeding_cities` for the `regeocoded` flag.

#### D.3 Aggregation logic (🔒LOCKED)

In the existing aggregation loop over `servableDetailsRes.data` (L2298-L2327), add a third per-city counter:

```ts
const needsRefreshByCity = new Map<string, number>(); // ORCH-1015
// ... inside the loop, after the existing stale + missing logic:
const lastRefreshMs = lastRefresh ? Date.parse(lastRefresh) : null;
if (lastRefreshMs === null || lastRefreshMs < ORCH_1015_REFRESH_CUTOVER_DATE_MS) {
  needsRefreshByCity.set(cityId, (needsRefreshByCity.get(cityId) || 0) + 1);
}
```

**Semantic contract:** a place with `last_detail_refresh = NULL` counts toward `needs_refresh_count` (never refreshed = needs refresh). This matches the existing stale-treatment of NULL at L2314.

#### D.4 Row-shape extension (🔒LOCKED)

In the per-city row build at L2385-L2411, ADD three fields (do not remove any existing ones):

```ts
return {
  // ... existing 12 fields unchanged (city_id, city_name, country,
  //     servable_count, evaluated_count, remaining_count, coverage_pct,
  //     last_run_id, last_run_at, last_run_status, last_run_cost_usd,
  //     last_run_mode) ...

  // ORCH-1014 — Seed status badge inputs (PRESERVED — operator may use later)
  first_seeded_at: firstSeededByCity.get(c.id) ?? null,
  last_seeded_at: lastSeededByCity.get(c.id) ?? null,
  // ORCH-1014 — Refresh status badge inputs (PRESERVED)
  refresh_oldest_at: refreshOldestByCity.get(c.id) ?? null,
  refresh_newest_at: refreshNewestByCity.get(c.id) ?? null,
  stale_refresh_count: staleRefreshByCity.get(c.id) ?? 0,
  missing_fields_count: missingFieldsByCity.get(c.id) ?? 0,

  // ORCH-1015 — Boundary + Details binary readiness flags.
  // regeocoded: city has been re-seeded under the bbox model (the
  //   coverage_radius_km column is zeroed when operator re-seeds; see
  //   supabase/functions/admin-seed-places/index.ts L166-L168
  //   "BBOX MODEL (2026-04): … coverage_radius_km is deprecated").
  regeocoded: (c.coverage_radius_km ?? null) === 0,
  // refreshed_new_fields: oldest servable last_detail_refresh is on/after the
  //   2026-03-19 cutover when the 48-field DETAIL_FIELD_MASK shipped (commit
  //   596b3c05c). When no servable places, false (defensive — operator can't
  //   evaluate a city with zero servable; it'll also be filtered out by the
  //   servable_count > 0 gate below).
  refreshed_new_fields: (() => {
    const oldest = refreshOldestByCity.get(c.id);
    if (!oldest) return false;
    return Date.parse(oldest) >= ORCH_1015_REFRESH_CUTOVER_DATE_MS;
  })(),
  // needs_refresh_count: number of servable places with last_detail_refresh
  //   strictly before the cutover (or NULL). Used by DetailsReadinessBadge
  //   to size the warning ("⚠ 41 places need refresh").
  needs_refresh_count: needsRefreshByCity.get(c.id) ?? 0,
};
```

The existing `.filter((r) => r.servable_count > 0)` at L2413 stays — cities with 0 servable never appear in the response.

#### D.5 Sort order on the wire (🔒LOCKED)

The existing `.sort((a, b) => b.servable_count - a.servable_count)` at L2414 stays. The client's 3-band layout re-sorts within bands — but the wire order remains servable-desc so consumers that don't band still get a sensible default order.

#### D.6 Service typedef extension (🔒LOCKED)

In `mingla-admin/src/services/intelligenceCoverageService.js` L9-L48, append to the JSDoc Array<{…}> entry (keep all existing fields):

```js
 *
 *     // ORCH-1015 — Boundary + Details binary readiness flags driving the
 *     // 3-band layout + smart-skip bulk button on IntelligenceOverviewTab.
 *     regeocoded: boolean,              // seeding_cities.coverage_radius_km = 0
 *     refreshed_new_fields: boolean,    // MIN(last_detail_refresh for is_servable) >= 2026-03-19
 *     needs_refresh_count: number,      // COUNT(*) FILTER (is_servable AND last_detail_refresh < 2026-03-19)
```

---

## §4 — Acceptance tests per finding

All test files land in the existing test trees with no new tooling required. Implementor MUST run all four suites (3× node --test, 1× deno test) and capture pass output as evidence before tester handoff.

### A — `orch1015_boundary_readiness_badge.test.js` (NEW; node --test)

Path: `mingla-admin/src/__tests__/orch1015_boundary_readiness_badge.test.js`

Required assertions:
1. `regeocoded: true` → `{ state: 'current', label: '✓ current', bgVar: 'var(--color-success-50)', fgVar: 'var(--color-success-700)' }`.
2. `regeocoded: false` → `{ state: 'needs-reseed', label: '⚠ reseed', bgVar: 'var(--color-warning-50)', fgVar: 'var(--color-warning-700)' }`.
3. tooltip mentions the literal `"bbox model"` when ✓ and `"deprecated radius"` when ⚠.
4. tooltip mentions `"Place Pool"` (operator action venue) when ⚠.
5. helper is pure: `notEqual(boundaryStatus({regeocoded:true}), boundaryStatus({regeocoded:true}))` (new object each call).
6. helper does NOT mutate args: snapshot JSON.stringify before/after, assert equal.
7. descriptor exposes no `onClick`, `href`, or function-typed field.
8. all color tokens start with `var(--color-`.

### A — `orch1015_details_readiness_badge.test.js` (NEW; node --test)

Path: `mingla-admin/src/__tests__/orch1015_details_readiness_badge.test.js`

Required assertions:
1. `{ refreshed: true, needs_refresh_count: 0 }` → success state, label `✓ current`, tooltip mentions `"48-field"` and `"2026-03-19"`.
2. `{ refreshed: false, needs_refresh_count: 41 }` → warning state, label exactly `⚠ 41 places need refresh`, tooltip starts with `"41 servable places"` and mentions `"2026-03-19"` + `"DETAIL_FIELD_MASK"` + `"Place Pool"`.
3. `{ refreshed: false, needs_refresh_count: 1706 }` → label exactly `⚠ 1,706 places need refresh` (thousands separator).
4. `{ refreshed: false, needs_refresh_count: undefined }` → label `⚠ 0 places need refresh` (defensive default).
5. helper pure / no-mutation / no-CTA-fields — same battery as boundary helper.
6. all color tokens start with `var(--color-`.

### B — `orch1015_overview_readiness_ladder.test.js` (NEW; node --test, source-scan style)

Path: `mingla-admin/src/__tests__/orch1015_overview_readiness_ladder.test.js`

Pattern: same as the ORCH-1014 file it replaces (reads `IntelligenceOverviewTab.jsx` source text and asserts via regex — no JSDOM).

Required assertions:
1. imports `BoundaryReadinessBadge` from `./BoundaryReadinessBadge` (not `SeedStatusBadge`).
2. imports `DetailsReadinessBadge` from `./DetailsReadinessBadge` (not `RefreshStatusBadge`).
3. does NOT import `SeedStatusBadge` or `RefreshStatusBadge` anywhere (regression guard).
4. renders a `<th>` containing the literal text `Boundary` (no longer `Seed status`).
5. renders a `<th>` containing the literal text `Details (new Google fields)` (no longer `Refresh status`).
6. `Boundary` header appears before `Details` header which appears before `>Servable<`.
7. instantiates `<BoundaryReadinessBadge regeocoded={row.regeocoded}` (regex anchored).
8. instantiates `<DetailsReadinessBadge refreshed={row.refreshed_new_fields}` and `needs_refresh_count={row.needs_refresh_count}` props.
9. source contains `bandedRows` memo (asserts banded structure exists).
10. source contains the 3 band labels verbatim: `Ready — boundary current + details current`, `Needs detail refresh`, `Needs re-seed (deprecated boundary)`.
11. neither badge cell contains `<Button`, `<a `, or `onClick` (read-only contract preserved).

### B — smart-skip unit test (in `orch1015_overview_readiness_ladder.test.js` OR sibling file — implementor's choice)

Given the synthetic row set:
```js
const rows = [
  // band 1 — 4 ready cities, varying remaining
  { city_id: 'a', city_name: 'A', regeocoded: true, refreshed_new_fields: true, remaining_count: 10, servable_count: 100 },
  { city_id: 'b', city_name: 'B', regeocoded: true, refreshed_new_fields: true, remaining_count: 5, servable_count: 80 },
  { city_id: 'c', city_name: 'C', regeocoded: true, refreshed_new_fields: true, remaining_count: 0, servable_count: 70 }, // ready but 0 remaining → NOT enqueued
  { city_id: 'd', city_name: 'D', regeocoded: true, refreshed_new_fields: true, remaining_count: 3, servable_count: 60 },
  { city_id: 'e', city_name: 'E', regeocoded: true, refreshed_new_fields: true, remaining_count: 7, servable_count: 50 },
  // band 2 — 3 boundary-only cities with remainder
  { city_id: 'f', city_name: 'F', regeocoded: true, refreshed_new_fields: false, remaining_count: 12, needs_refresh_count: 12, servable_count: 90 },
  { city_id: 'g', city_name: 'G', regeocoded: true, refreshed_new_fields: false, remaining_count: 8, needs_refresh_count: 8, servable_count: 75 },
  { city_id: 'h', city_name: 'H', regeocoded: true, refreshed_new_fields: false, remaining_count: 4, needs_refresh_count: 4, servable_count: 40 },
  // band 3 — 1 boundary-needs-reseed city with remainder
  { city_id: 'i', city_name: 'I', regeocoded: false, refreshed_new_fields: false, remaining_count: 20, needs_refresh_count: 20, servable_count: 200 },
];
```

Extract `readyCities` and `skippedCities` per §3-C.2 logic (lift the predicate into a testable helper if helpful — `isFullyReady` is fine to export from a test-utility module). Assert:
- `readyCities.length === 4` (a, b, d, e — c excluded by `remaining_count > 0` filter)
- `readyCities.map(c => c.city_id).sort() === ['a','b','d','e']`
- `skippedCities.length === 4` (f, g, h, i)
- `skippedCities.find(c => c.city_id === 'i').skip_reason === 'needs reseed'`
- `skippedCities.find(c => c.city_id === 'f').skip_reason === 'needs detail refresh'`

### C — Modal smart-skip test (in same file or sibling; source-scan style)

Read `RunRemainderOnAllConfirmModal.jsx` source, assert:
1. accepts `skippedCities = []` prop with default.
2. renders the literal `Skipped — needs prep first` heading text when `skippedCities.length > 0`.
3. renders each `skippedCities[i].skip_reason` (one of `needs reseed` / `needs detail refresh`).
4. `onConfirm` is called with `safeCities` (ready list only) — assert via grep that `onConfirm?.(safeCities)` is the only call site.
5. title contains `ready` (literal).

### D — `intelligence_coverage_seed_refresh.test.ts` (EXTEND; deno test)

Path: `supabase/functions/run-place-intelligence-trial/__tests__/intelligence_coverage_seed_refresh.test.ts`

Add the following test cases (keep all existing assertions intact):

1. **regeocoded flag — true when radius=0:** given a city with `coverage_radius_km = 0`, assert response row `regeocoded === true`.
2. **regeocoded flag — false when radius=10:** given a city with `coverage_radius_km = 10`, assert response row `regeocoded === false`.
3. **regeocoded flag — false when radius=null:** given a city with `coverage_radius_km = null`, assert response row `regeocoded === false` (defensive — `null !== 0`).
4. **refreshed_new_fields — true when oldest >= cutover:** given 3 servable places with `last_detail_refresh` of `2026-04-01`, `2026-04-10`, `2026-05-01`, assert row `refreshed_new_fields === true` and `needs_refresh_count === 0`.
5. **refreshed_new_fields — false when any below cutover:** given 3 servable places with `last_detail_refresh` of `2026-04-01`, `2026-03-15`, `2026-04-10`, assert row `refreshed_new_fields === false` and `needs_refresh_count === 1`.
6. **refreshed_new_fields — NULL counts as needing refresh:** given 2 servable places, one with `null` and one with `2026-04-01`, assert `refreshed_new_fields === false` and `needs_refresh_count === 1`.
7. **cutover constant — exactly 2026-03-19:** source-inspect the edge fn for the literal `"2026-03-19T00:00:00Z"` AND the literal constant name `ORCH_1015_REFRESH_CUTOVER_DATE_MS`. Fail-on-revert if either disappears.
8. **All 6 ORCH-1014 fields still present:** source-grep for `first_seeded_at`, `last_seeded_at`, `refresh_oldest_at`, `refresh_newest_at`, `stale_refresh_count`, `missing_fields_count` in the row return block (regression guard against accidental removal during the extension).

### Visual mode coverage (🔒LOCKED)
Both badges MUST render coherently in dark + light mode by virtue of using Tailwind v4 `var(--color-…)` tokens (no hardcoded hex). Verified by the assertion in A-tests that every `bgVar` and `fgVar` value starts with `var(--color-`.

---

## §5 — Invariants

### Existing — PRESERVED
- `I-PROPOSED-INTEL-READINESS-COVERAGE-COUNTS-CURRENTLY-SERVABLE` (ORCH-1013) — the `evaluated_count` server-side query still joins `place_pool!inner(is_servable)`. ORCH-1015 doesn't touch the count math. UNCHANGED.
- `I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED` (COMMS) — the Gemini pricing citation block at L2210-L2212 of the edge fn stays. ORCH-1015 only adds Supabase reads.

### NEW — `I-PROPOSED-INTEL-READINESS-BINARY-NOT-COUNT`
**Statement:** The Place Intelligence Overview tab MUST render Boundary and Details readiness as binary pills (`✓ current` / `⚠ reseed` / `⚠ N places need refresh`), NEVER as raw counts of seed/refresh history. Operator-locked 2026-05-30.

**Enforcement:**
- File-presence: `BoundaryReadinessBadge.jsx`, `DetailsReadinessBadge.jsx`, `readinessBadgeContent.js` exist; `SeedStatusBadge.jsx`, `RefreshStatusBadge.jsx`, `seedRefreshBadgeContent.js` deleted.
- Grep: `IntelligenceOverviewTab.jsx` does NOT contain `SeedStatusBadge` or `RefreshStatusBadge` (case-sensitive) anywhere.
- Behavioral: badge `data-state` enum is exactly `"current" | "needs-reseed" | "needs-refresh"`.
- Adversarial test `orch1015_overview_readiness_ladder.test.js` asserts these conditions.

**Stays DRAFT until ORCH-1015 CLOSE.** Operator promotes to ACTIVE on CLOSE per the standard invariant lifecycle. Add to `Mingla_Artifacts/INVARIANTS.md` registry on CLOSE.

### NEW — `I-PROPOSED-INTEL-BULK-RUN-RESPECTS-READINESS`
**Statement:** The "Run remainder on all" bulk launcher MUST only enqueue cities where `regeocoded === true && refreshed_new_fields === true`. Cities failing either gate appear in a "Skipped — needs prep first" panel of the confirm modal and never enter the dispatcher. The per-city `Run remainder` button on individual rows is EXEMPT (operator override path).

**Enforcement:**
- Acceptance test in §4 (smart-skip unit test) — given 9-city fixture, only the 4 fully-ready cities are passed to `onConfirm`.
- Source grep: `RunRemainderOnAllConfirmModal.jsx` only calls `onConfirm?.(safeCities)` (which is filtered to ready by §3-C.2).

**Stays DRAFT until ORCH-1015 CLOSE.**

---

## §6 — Out of scope

- Any consumer-side deck code (META-ORCH-1009 territory).
- New action buttons on the badges (Place Pool owns reseed + refresh CTAs; Overview stays read-only).
- Backfill of `coverage_radius_km = 0` for the 7 cities still at radius=10 (Baltimore, Barcelona, Berlin, Chicago, Dallas, London, Toronto). That's a separate operator action in Place Pool; ORCH-1015 just surfaces the gap.
- The `score-place-photo-aesthetics` edge function (queued for ops cleanup, separate ORCH).
- Migrating the cutover date to an env var or settings row. Per §7-D1, it stays hardcoded.
- Refactoring the band layout into a generic `<BandedTable>` component. Inline `bandedRows` memo is fine for one consumer.
- Adding a "View all cities (including 0-servable)" toggle. Default-hide stays; if operator wants to see Berlin/Paris/etc, they go to Place Pool.

---

## §7 — Decisions (with rationale; flagged for operator review where noted)

### D1 — Counts shown on ⚠ Details cells (✓ locked, no operator review needed)
Operator explicitly requested the count signal even though the gate itself is binary. Rationale: a city with `⚠ 41 places need refresh` (Raleigh-class) vs. `⚠ 900 places need refresh` (hypothetical Lagos-class) requires very different operator effort. The pill says "not ready" binarily; the number tells the operator the size of the chore. Boundary doesn't get a count because the boundary fix is a single seed run regardless of city size — the count would be misleading.

### D2 — Baltimore curiosity (✗ FLAGGED for operator)
Live-probe finding 2026-05-30: Baltimore has `coverage_radius_km = 10` (band 3 by Boundary) but `refreshed_new_fields = ✓` with `needs_refresh_count = 0`. Means: operator refreshed all 1,205 servable Baltimore places under the new field mask, but never re-seeded the city under the bbox model. Possible explanations:
1. Operator did a bulk refresh sweep across multiple cities and Baltimore happened to be included, but the bbox re-seed only ran on the operator-prioritized cities (Brussels, Cary, Durham, FL, Lagos, Raleigh, Washington).
2. Baltimore was seeded after the bbox cutover but the old radius value was never zeroed.

**Operator action:** confirm whether Baltimore needs a re-seed or whether the boundary check is satisfied by some other criterion the spec missed. If the latter, the `regeocoded` rule needs adjustment (e.g., maybe also check `bbox_sw_lat IS NOT NULL`). For now the SPEC assumes `coverage_radius_km = 0` is the canonical signal per the brief.

### D3 — Cities with `servable_count = 0` hidden by default (✓ locked)
Preserved from ORCH-1014. Berlin/Barcelona/Chicago/Dallas/Miami/NewYork/Paris/Toronto stay hidden. Adding them with empty badges adds noise without value. Operator surfaces them in Place Pool when they want to triage.

### D4 — `REFRESH_CUTOVER_DATE = '2026-03-19'` is a hardcoded constant (✓ locked)
Not an env var. Not a settings table row. Per the brief, if the field mask expands again, operator opens a new ORCH to bump this date. Rationale: this is a code-level historical anchor (tied to a specific commit's behavior change), not a runtime knob. Drift between code expectations and a settings-table value would be worse than an explicit code change.

### D5 — London now has servable=3,495 (FYI, not flagged)
Was 0 in the brief. Doesn't affect SPEC validity — London just becomes a band-3 city in the rendered ladder (boundary ✗, details ✗, 10 places need refresh). First true band-3 case in PROD, gives the test fixture a real-world counterpart.

### D6 — Override per-city `Run remainder` button stays (✓ locked)
Per brief. Operator may need to manually evaluate a band-2 or band-3 city for testing or bootstrap purposes. Smart-skip only applies to the bulk header button.

### D7 — Wire keeps 6 ORCH-1014 fields (✓ locked)
Operator may want them later for diagnostic purposes. No cost to keep them — they're already computed. Service typedef preserves them for any future consumer.

### D8 — Sort within band: servable_count DESC (✓ locked)
Operator wants the biggest, most expensive-to-run cities surfaced first within each band so cost preview math is visible at a glance.

### D9 — Divider rows vs. separate tbody (🎨 OPEN)
Implementor's choice. Both render correctly and both pass the acceptance tests. Divider rows are simpler; separate tbodies are more semantically distinct. No accessibility requirement either way.

### D10 — Stripe surfaces (N/A)
No Stripe code in scope. No `stripe-best-practices` skill invocation needed.

---

## §8 — Implementation order (recommended)

1. Edge fn (`run-place-intelligence-trial/index.ts`) — fields D2-D4. Run existing 1014 + 1013 Deno tests to confirm no regression. Add D test assertions.
2. Service typedef (`intelligenceCoverageService.js`) — D6.
3. New `readinessBadgeContent.js` helpers + 2 new `.jsx` badges. Run new A tests (`node --test`).
4. Wire badges into `IntelligenceOverviewTab.jsx` with bandedRows memo + new column headers. Run new B test.
5. Update `RunRemainderOnAllConfirmModal.jsx` for smart-skip. Run new C test.
6. Delete the 3 superseded ORCH-1014 test files; rename the merge-conflict guard's FILES_TO_SCAN.
7. Manual smoke on dev: `npm run dev` in `mingla-admin`, log in, hit Place Intelligence → Overview, verify 3 bands render with current PROD data (8 cities in band 1, 0 in band 2, 1 in band 3 — Baltimore in band 2 if §7-D2 is unresolved at ship time; London in band 3).
8. Capture screenshots (light + dark mode) for the close report.

---

## §9 — Completion gates (this SPEC is ready when…)

1. ✅ Every file path verified to exist (or marked NEW with parent dir confirmed). DONE.
2. ✅ Every contract has a 🔒LOCKED tag (no AI-slop drift on hard requirements).
3. ✅ Every external API parameter cited with provider docs URL (only Gemini pricing, which is preserved verbatim from ORCH-1014).
4. ✅ Live-DB truth re-probed within 24h of SPEC delivery (2026-05-30, current).
5. ✅ Acceptance tests cover every Finding's contract surface.
6. ✅ Invariants enumerated with enforcement mechanisms.
7. ✅ §7 decisions enumerated; one operator-review flag raised (D2: Baltimore).
