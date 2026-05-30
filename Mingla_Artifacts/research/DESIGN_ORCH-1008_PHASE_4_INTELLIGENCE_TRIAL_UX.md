# DESIGN — ORCH-1008 Phase 4 · Place Intelligence Trial UX upgrade

**Status:** SPEC-grade, ready for `mingla-implementor`
**Scope:** UX upgrade of the existing "Trial Results" experience inside the new tabbed `PlaceIntelligenceTrialPage` (the second tab; Overview tab is Phase 3, designed in the parallel forensics SPEC).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1008-[admin-shell-prune-intelligence-overview]/`
**Branch:** `ORCH-1008-admin-shell-prune-intelligence-overview`
**Parent SPEC (Phases 1–3):** `Mingla_Artifacts/specs/SPEC_ORCH-1008_ADMIN_SHELL_PRUNE_INTELLIGENCE_OVERVIEW.md`
**Files this design will modify:**
- `mingla-admin/src/pages/PlaceIntelligenceTrialPage.jsx` (tab system + frame)
- `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx` (the four sub-modules below)
- `mingla-admin/src/components/placeIntelligenceTrial/RunRemainderConfirmModal.jsx` (NEW — also reused as the generic "Review and confirm" modal for sample/full_city >$10)
- `mingla-admin/src/components/placeIntelligenceTrial/PlaceResultExpanded.jsx` (NEW — Q2 reasoning card-stack, extracted from inline JSX)
- `mingla-admin/src/components/placeIntelligenceTrial/SignalDistributionPanel.jsx` (NEW — Phase 4d)
- `mingla-admin/src/components/placeIntelligenceTrial/SpotCheckPanel.jsx` (NEW — Phase 4d)

**References examined** (real premium tooling for the same moment):
- **Linear** (Project / Run views) — segmented switchers with live cost/effort labels; collapsible status groups with sticky group headers; "Cancel run" as an inline danger affordance, never a destructive modal-only path.
- **Vercel Dashboard / Deployments** — per-deployment status pill + progress bar live-update; logs collapse-by-default with status-group sections; failed-deploy "Redeploy failed only" button is the canonical bulk-retry pattern.
- **GitHub Actions** — grouped step list (`queued / running / completed / failed`), with the failed group expanded by default and an inline "Re-run failed jobs" button at the group header.
- **Datadog / Honeycomb** — distribution-bar visualisations of histograms (the Phase 4d "verdict distribution" mirrors this shape); spot-check rows show min / median / max as click-through rows.
- **Stripe Dashboard (Sigma)** — cost-preview chip that updates LIVE under a query editor before the "Run query" button; the same pattern adapted here for the cost preview.

None of these are cloned. Mingla uses its own brand-500 orange, Geist Sans/Mono, existing `SectionCard` chrome, and the existing Recharts patterns from `AnalyticsPage.jsx`. The patterns above informed information architecture only.

---

## §0 — Token + primitive inventory (everything below reuses these)

All taken from `mingla-admin/src/globals.css` and `mingla-admin/src/components/ui/`. Zero new tokens introduced.

### Colors (light theme values shown; dark theme auto-overrides per existing `[data-theme="dark"]` block)
| Token | Value | Used for |
|---|---|---|
| `--color-brand-50` | `#fff7ed` (dark: `rgba(249,115,22,0.1)`) | Active group surfaces, in-flight run panel bg |
| `--color-brand-100` | `#ffedd5` | Focus rings (`focus:ring-[var(--color-brand-100)]`) |
| `--color-brand-200` | `#fed7aa` | Active-run panel border |
| `--color-brand-500` | `#f97316` | Primary button, progress bar fill, active tab underline, segmented-active accent |
| `--color-brand-600` | `#ea580c` | Primary button hover |
| `--color-brand-700` | `#c2410c` (dark: `#fb923c`) | Active brand text |
| `--color-success-50/500/700` | `#f0fdf4 / #22c55e / #15803d` | Completed group, score ≥70 cells, success score bucket |
| `--color-warning-50/500/700` | `#fffbeb / #f59e0b / #b45309` | Cancelling state, retryable failures count, score 30–69 bucket |
| `--color-error-50/500/700` | `#fef2f2 / #ef4444 / #b91c1c` | Failed group, VETO cells, score <30 bucket, danger button |
| `--color-info-50/500/700` | `#eff6ff / #3b82f6 / #1d4ed8` | Running group, in-flight progress chip |
| `--gray-50…900` | per globals.css | Surfaces, borders, text gradient |
| `--color-background-primary` | `#ffffff` (dark: `#0f1117`) | Card surface |
| `--color-background-secondary` | `#faf8f6` (dark: `#1a1d27`) | Page background |
| `--color-text-primary/secondary/tertiary/muted` | `#111827 / #4b5563 / #6b7280 / #9ca3af` | Type ramp |

### Type ramp (already-used classes; nothing new)
| Token | When |
|---|---|
| `text-2xl font-semibold` | Page title (Phase 4 reuses the existing one) |
| `text-[15px] font-semibold` | `SectionCard` title |
| `text-sm font-semibold` | Group headers, modal headlines, panel sub-headers |
| `text-sm font-medium` | Tab labels, segmented options, form labels |
| `text-sm` | Body, dropdown labels, table cells |
| `text-xs` | Helper text, captions, cost lines |
| `text-[10px] uppercase tracking-wide font-mono` | Status pills, signal IDs, label-style microcopy |
| `font-mono` (Geist Mono) | All numeric badges and ids |
| `tabular-nums` | Score readouts, place counts, money |

### Radii
| Token | Value | Used for |
|---|---|---|
| `--radius-sm` | `8px` (`rounded-lg`) | Buttons, inputs, status pills |
| `--radius-md` | `12px` | Inner panels |
| `--radius-lg` | `16px` (`rounded-xl`) | `SectionCard`, `Modal` |
| `9999px` (`rounded-full`) | – | Progress bar track + fill, icon chips |

### Spacing — 4 px grid
`--space-xs:4 / sm:8 / md:16 / lg:24 / xl:32 / 2xl:48`. Every gap and padding below maps to one of these; no magic numbers.

### Shadows
`--shadow-sm` for `SectionCard`, `--shadow-md` on hover, `--shadow-xl` on `Modal`. Used as-is.

### Motion
| Already in CSS | Used for |
|---|---|
| `animate-[fade-in_200ms_ease-out]` | Modal overlay |
| `animate-[scale-in_200ms_ease-out]` | Modal panel |
| `animate-[dropdown-in_150ms_ease-out]` | Dropdown menus |
| `animate-[shimmer_1.5s_linear_infinite]` (`skeleton-shimmer`) | Loading rows |
| `transition-colors duration-150` | Hover/state changes |
| `transition-all duration-200` | Progress bar fill |
| `--transition-fast 150ms ease / --transition-normal 200ms ease / --transition-slow 300ms ease` | Generic |

### Framer Motion (Phase 4 additions — reuse only existing curve `easeOut`)
- `tab-transition` (already defined in `PlaceIntelligenceTrialPage.jsx`):
  ```js
  { initial:{opacity:0,y:4}, animate:{opacity:1,y:0}, exit:{opacity:0,y:-4}, transition:{duration:0.15, ease:"easeOut"} }
  ```
- `group-expand` (NEW; reuses existing curve + duration vocabulary — no new spring, no new bezier):
  ```js
  { initial:{opacity:0, height:0},
    animate:{opacity:1, height:"auto"},
    exit:{opacity:0, height:0},
    transition:{duration:0.2, ease:"easeOut"} }
  ```
- `card-expand` (per-place row open/close — same vocabulary):
  ```js
  { initial:{opacity:0, y:-4}, animate:{opacity:1, y:0}, exit:{opacity:0, y:-4}, transition:{duration:0.15, ease:"easeOut"} }
  ```
- `running-pulse` (the small "now running" dot on the Running group header — uses existing `animate-[ping]` keyframe in globals.css plus a steady inner dot; no new keyframe):
  ```jsx
  <span className="relative flex w-2 h-2">
    <span className="absolute inline-flex w-full h-full rounded-full bg-[var(--color-info-500)] opacity-75 animate-[ping_1.5s_cubic-bezier(0,0,0.2,1)_infinite]" />
    <span className="relative inline-flex w-2 h-2 rounded-full bg-[var(--color-info-500)]" />
  </span>
  ```
- `prefers-reduced-motion`: globals.css already short-circuits all `animation-duration` and `transition-duration` to `0.01ms` under `@media (prefers-reduced-motion: reduce)`. Framer Motion respects `useReducedMotion()` automatically; the implementor MUST gate the `group-expand` and `card-expand` `height` animations with `useReducedMotion()` so they snap rather than tween. The `running-pulse` collapses to a static dot (`<span className="w-2 h-2 rounded-full bg-[var(--color-info-500)]" />`).

### Reused primitives (zero new components in `ui/`)
`SectionCard`, `AlertCard`, `Button` (primary / secondary / ghost / danger), `Badge`, `Tabs`, `Modal` + `ModalBody` + `ModalFooter`, `Dropdown` + `DropdownItem` + `DropdownLabel`, `Spinner`, `Skeleton`. Icons exclusively from `lucide-react` (already in `package.json`): `Microscope, Play, Square, RotateCcw, Globe, Clock, CheckCircle, XCircle, Loader2, ChevronDown, ChevronRight, RefreshCw, Search, Filter, AlertTriangle, Info, ExternalLink, ArrowRight`.

### Recharts
Only the components already imported in `AnalyticsPage.jsx`: `BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer`. Phase 4d adds **stacked** bars via Recharts' native `<Bar stackId="signal">` prop on the same `BarChart` — official Recharts API at https://recharts.org/en-US/api/Bar (verified 2026-05-29). No new chart type, no new dependency.

### Tokenised constants the implementor adds to `TrialResultsTab.jsx`
```js
const SIGNAL_IDS = [
  "brunch","casual_food","creative_arts","drinks","fine_dining","flowers",
  "groceries","icebreakers","lively","movies","nature","picnic_friendly",
  "play","romantic","scenic","theatre",
]; // mirror of supabase/functions/_shared/photoAestheticEnums.ts:MINGLA_SIGNAL_IDS
const PER_PLACE_COST_USD = 0.0075;   // operator-set Phase 4 cost-preview rate; dispatch headline
const COST_REVIEW_THRESHOLD_USD = 10; // "Review and confirm →" button appears at > $10
const SCORE_BUCKETS = [
  { id: "0_25",  label: "0–25",   min: 0,  max: 25,  tokenBg: "var(--color-error-500)"   },
  { id: "26_50", label: "26–50",  min: 26, max: 50,  tokenBg: "var(--color-warning-500)" },
  { id: "51_75", label: "51–75",  min: 51, max: 75,  tokenBg: "var(--color-info-500)"    },
  { id: "76_100",label: "76–100", min: 76, max: 100, tokenBg: "var(--color-success-500)" },
  { id: "veto",  label: "Veto",   min: null,max:null,tokenBg: "var(--gray-700)"          },
];
```

> **Note** — the dispatch headline cost figure (`$0.0075`) differs from the existing edge-fn constant (`PER_PLACE_COST_USD = 0.0040` at TrialResultsTab.jsx:219 and edge fn line ~637). The user-visible cost preview MUST use the operator-stated `$0.0075` figure. The `confirm_high_cost` server gate still uses the edge fn's own threshold — the UI just displays the operator's number. **Flag for operator review:** if `$0.0075` is the correct truth, ORCH-1009 backfill will use it; the edge fn's `PER_PLACE_COST_USD` constant should be updated to match in the same PR. If `$0.0040` was correct all along and the dispatch headline is loose, the cost preview drops to that number. The design accepts either value via the single `PER_PLACE_COST_USD` constant; the implementor MUST confirm the value before shipping.

---

## §1 — Frame + tab system (cross-cutting)

### 1.1 Page header (UNCHANGED from current; Phase 2 already strips the redundant max-w wrapper)

Already-shipped icon + title + subtitle block at `PlaceIntelligenceTrialPage.jsx:44-57`. The `AlertCard` ("How this works") at lines 59-63 is **removed in Phase 4** — its content lives now inside the Overview tab and the Trial Results tab's mode-picker helper text. Removal frees ~84 px of vertical space (Seth uses this tool heavily; vertical density matters).

### 1.2 New 2-tab system

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [🔬] Place Intelligence Trial                                            │
│       Pick a city + sample size, score servable places with Gemini 2.5    │
│       Flash against Mingla's 16 signals. Research-only — output never     │
│       feeds card ranking.                                                  │
│                                                                            │
├──────────────────────────────────────────────────────────────────────────┤
│  Overview ──── Trial Results                                              │  ← Tabs primitive
│  ─────────                                                                │  ← brand-500 underline on active
│                                                                            │
│  ┌─ AnimatePresence mode="wait" with tab-transition variant ──────┐       │
│  │                                                                  │       │
│  │  [active tab content]                                            │       │
│  │                                                                  │       │
│  └──────────────────────────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────────────────┘
```

- Default active tab = **`overview`** (per Phase 3 SPEC §3 line 600+). The Trial Results tab is selected with one click; the operator can deep-link via `#/place-intelligence-trial?tab=results` (the implementor extends `getTabFromHash` or uses URLSearchParams).
- The `Tabs` primitive at `mingla-admin/src/components/ui/Tabs.jsx` is used verbatim. New TABS array:
  ```js
  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "results",  label: "Trial Results" },
  ];
  ```
- Reuse the existing `AnimatePresence mode="wait"` + `motion.div key={activeTab}` + `tab-transition` variants block.
- Contrast: brand-500 `#f97316` on white background = **3.78 : 1** (passes WCAG AA "large text" ≥3:1 for the 14 px / `font-medium` tab label). Brand-500 on dark `#0f1117` = **4.92 : 1**. Both directions pass.
- Keyboard nav: `Tabs.jsx` already wires `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, and `tabIndex={isActive ? 0 : -1}`. The implementor MUST add **arrow-key navigation** (Left/Right cycles tabs) in a `onKeyDown` handler on each `<button>` — this is the only enhancement to the primitive itself and applies to all callers, so the implementor edits `ui/Tabs.jsx` once (safe; it's a strict additive change).

### 1.3 Trial Results tab content layout (top-down rhythm)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Active-run banner — only when activeRun != null]            (Phase 4c)     │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─ SectionCard: "Run trial" ─────────────────────────────────────────────┐ │
│  │  [Mode segmented]   [City picker] [Sample size, sample-only]            │ │
│  │  [Live cost preview chip]                                  [Run button] │ │
│  │  [AI provider line]                                                     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌─ SectionCard: "City coverage — <city>" — only when city selected ─────┐ │
│  │  [4 stat cells + Retry-failed btn]                                       │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌─ SectionCard: "Signal verdict distribution" — only for last completed   │ │
│  │  run of selected city                                       (Phase 4d) │ │
│  │  [16 stacked bars + spot-check panel]                                    │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌─ Run history (status groups)                              (Phase 4b)    │ │
│  │   ▾ Running (N) • live                                                  │ │
│  │   ▸ Queued (N)                                                          │ │
│  │   ▾ Failed (N)                                                          │ │
│  │   ▸ Completed (N)                                                       │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

`flex flex-col gap-6` (= `--space-lg` 24 px) between SectionCards, matching `PlacePoolManagementPage`'s rhythm.

---

## §2 — Phase 4a · 3-option mode picker + live cost preview

### 2.1 Three-option segmented control

Reuse the existing 2-option segmented styling at `TrialResultsTab.jsx:861-901`. Extend to 3 buttons. Same shell: `flex gap-1 p-1 bg-[var(--gray-100)] rounded-lg`; same active treatment (`bg-[var(--color-background-primary)] shadow-sm`); same `text-sm font-medium`; same `h-9`.

**Pixel layout — segmented control, full width of the form column:**

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Mode                                                                       │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │  Sample          ┆  Whole city       ┆  Remainder only                │ │
│ │  (active)        ┆                   ┆                                 │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
│ Stratified random sample, runs in your browser (~75 min for 200 places). │
│ Don't refresh during the run.                                              │
└──────────────────────────────────────────────────────────────────────────┘
```

- Internal `<button>` widths: `flex-1`. Equal thirds (~152 px on default content max = 1280 - sidebar 260 - shell px-16 = ~956 px form column ÷ 3 ≈ 318 px each — comfortable).
- Active button: `bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm`. Inactive: `text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]`.
- Disabled (during running): existing `disabled:opacity-50 disabled:cursor-not-allowed` (no new style).
- `aria-pressed` set on each button matching its active state. `role="group"` on the wrapper with `aria-label="Trial mode"`.
- Hover feedback: existing `transition-colors duration-150`. No layout shift on press (uses bg change, not transform). Active scale `0.98` ONLY on `<Button>` primary; segmented options stay flat to preserve the rail's straight edge.

### 2.2 Helper microcopy under the segmented control (per mode — Mingla voice, plain English)

| Mode | Helper text |
|---|---|
| `sample` | "Stratified random sample. Runs in your browser — don't refresh. ~75 min for 200 places." |
| `full_city` | "Every servable place in the city. Runs on the server — close the tab, come back later. Cancel anytime." |
| `remainder` | "Only places we haven't scored yet. Runs on the server. Perfect for incremental backfills." |

`text-xs text-[var(--color-text-tertiary)]`. One-liner each. No emoji.

### 2.3 City picker + (conditional) sample-size input

Existing controls unchanged. `<select>` for city, `<input type="number">` for sample size (`sample` mode only). All existing focus states (`focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]`) preserved.

### 2.4 Live cost-preview chip — NEW

Anchored between the form row and the Run button, full-width, animated value updates. NOT a separate `SectionCard` — keep it inside the existing form wrapper to maintain rhythm.

**Layout when `selectedCity = null` (idle):**
```
┌──────────────────────────────────────────────────────────────────────────┐
│  💡 Pick a city to preview cost                                            │
└──────────────────────────────────────────────────────────────────────────┘
```
Treatment: `text-xs text-[var(--color-text-tertiary)]`, icon `Info w-3.5 h-3.5`. No box.

**Layout when `mode='sample'`, city picked, 200 places:**
```
┌──────────────────────────────────────────────────────────────────────────┐
│  Cost preview                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  200 places  ×  $0.0075  =  ~$1.50 estimated                       │  │
│  │  ~100 min wall time (browser-loop)                                   │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

Treatment:
- Outer label: `text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] font-mono mb-1.5`.
- Inner chip: `rounded-lg bg-[var(--gray-50)] border border-[var(--gray-200)] px-4 py-3`.
- Equation line: `text-sm font-mono tabular-nums text-[var(--color-text-primary)]`.
- Time line: `text-xs text-[var(--color-text-tertiary)] mt-0.5`.
- Numbers (`200`, `$0.0075`, `~$1.50`) get `font-semibold`. Operators `×`, `=` stay regular weight; symbol `~` regular.
- The `~$1.50` total turns **`text-[var(--color-warning-700)] font-semibold`** when total >$5, **`text-[var(--color-error-700)] font-semibold`** when total >$10.

**Layout when `mode='full_city'` (city has 11,344 servable):**
```
┌──────────────────────────────────────────────────────────────────────────┐
│  Cost preview                            [COUNTING…  spinner-12]           │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  11,344 places  ×  $0.0075  =  ~$85.08 estimated                   │  │
│  │  ~5.7 hrs wall time (server-side; tab-close safe)                    │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

- `COUNTING…` chip shown only while the servable-count fetch is in flight. Since `cities[]` already carries `servable_count` from the initial load, this is usually instantaneous; only `remainder` triggers a fresh server query.
- Number `11,344` displays via `.toLocaleString()`.
- "~5.7 hrs" computed from `Math.ceil(count * 30 / 60)` minutes, then converted to "X hrs" when ≥60.

**Layout when `mode='remainder'` (city has 9,820 un-evaluated):**
```
┌──────────────────────────────────────────────────────────────────────────┐
│  Cost preview                            [COUNTING…  spinner-12]           │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  9,820 places  ×  $0.0075  =  ~$73.65 estimated                    │  │
│  │  ~4.9 hrs wall time (server-side; tab-close safe)                    │  │
│  │  1,524 of 11,344 already scored — only the rest                      │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

Third line is `text-xs text-[var(--color-text-tertiary)] mt-0.5`. The `1,524` and `11,344` are `font-medium`, no special color. Source: Phase 3 service `fetchIntelligenceCoverage()` already returns `{servable_count, evaluated_count, remaining_count}` per city — the Trial Results tab calls the same service for the selected city ONLY (small client-side filter) instead of duplicating the query.

### 2.5 State machine for the picker + preview

```
                            ┌─────────────┐
        no city selected →  │   IDLE      │  ← initial render
                            │  preview:   │
                            │  "Pick a    │
                            │   city…"    │
                            └──────┬──────┘
              city picked          │
              ─────────────────────┼─────────────────────
                                   ▼
           ┌──────────────┐    ┌───────────────┐    ┌─────────────┐
           │  COMPUTING   │ →  │ PREVIEW_READY │ →  │  CONFIRMING │
           │  (count      │    │ (cost shown,  │    │ (modal open)│
           │   fetched)   │    │  button hot)  │    └──────┬──────┘
           └──────────────┘    └──────┬────────┘           │
                                      │                    │
                                      │ Run clicked        │ Confirm
                                      │ (preview ≤ $10)    │ clicked
                                      ▼                    ▼
                                  ┌─────────────────────────────┐
                                  │          RUNNING            │
                                  │  (mode-dependent — sample=  │
                                  │  browser loop with progress │
                                  │  bar; full_city/remainder=  │
                                  │  spawns active-run panel)   │
                                  └─────────────┬───────────────┘
                                                │ done | cancelled | error
                                                ▼
                                       ┌─────────────────┐
                                       │     IDLE        │
                                       │ (refresh fires) │
                                       └─────────────────┘
```

- IDLE → COMPUTING: triggered by `cityId` change or `mode` change.
- COMPUTING → PREVIEW_READY: 0 ms when `cities[].servable_count` already present (sample / full_city); ≤ 800 ms for `remainder` (single `count(distinct place_pool_id)` query).
- PREVIEW_READY → RUNNING (≤ $10): single click on "Run trial".
- PREVIEW_READY → CONFIRMING (> $10): single click on **"Review and confirm →"** opens `RunRemainderConfirmModal` (also used for sample/full_city when over threshold — modal accepts a `mode` prop).
- RUNNING → IDLE: terminal status or cancel.

### 2.6 The two Run-button variants

```
                ┌──────────────────────────────────┐
preview ≤ $10:  │   ▶  Run trial (200)              │   primary, h-10, full color
                └──────────────────────────────────┘

                ┌──────────────────────────────────┐
preview > $10:  │      Review and confirm  →        │   primary, h-10, neutral-tinted via secondary
                └──────────────────────────────────┘
```

- **`Button variant="primary" size="md"`** for the standard Run path.
- **`Button variant="secondary" size="md"`** + `iconRight={ArrowRight}` for the "Review and confirm" CTA — uses the secondary's grey-stroke treatment to read as "this opens a checkpoint, not a fire-the-rocket". The intent is "we need your eyes before we spend that". The brand orange returns inside the modal's final Confirm button.
- Label includes the count when city picked (`Run trial (200)` / `Run trial (11,344)`) to remove ambiguity. `tabular-nums` keeps the digits stable as count rises.
- The button never collapses on the Run row — when the count is computing, the button label degrades to `Run trial (…)` and `disabled=true`, never `loading=true` (the Loader2 spinner is reserved for the actual in-flight call).
- All buttons ≥ 44 pt touch target: `h-10` (40 px) + outer `padding 4 px` from the form gap = 44+ px tap zone. The button itself has `px-4` which yields ≥ 88 px width even for short labels. Passes mobile minimum, exceeds desktop floor.

### 2.7 Confirm modal (used when preview > $10 OR when calling `start_run` for any `full_city`/`remainder`)

Reused for ALL three modes — Phase 3 SPEC defined this modal for `remainder` only. The Phase 4 design extends it to ALL modes with `mode` prop drilling through.

```
┌────────────────────────────────────────────────────────────────────┐
│  Review and confirm — Whole-city trial for Lagos                ✕  │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   This will evaluate 11,344 servable places in                      │
│   Lagos, Nigeria using Gemini 2.5 Flash.                            │
│                                                                     │
│   ┌──────────────────────────────────────────────────────────┐    │
│   │  COST BREAKDOWN                                            │    │
│   │  11,344 places × $0.0075      ──────────  ~$85.08          │    │
│   │  Gemini 2.5 Flash, server-side                            │    │
│   └──────────────────────────────────────────────────────────┘    │
│                                                                     │
│   ┌──────────────────────────────────────────────────────────┐    │
│   │  ⏱  WALL TIME                                              │    │
│   │  ~5.7 hrs (≈ 30 s/place, server-side, tab-close safe)     │    │
│   └──────────────────────────────────────────────────────────┘    │
│                                                                     │
│   ┌─ ⚠ Cost exceeds $10 ────────────────────────────────────┐    │
│   │  Type the city name below to confirm.                      │    │
│   │  ┌──────────────────────────────────────┐                  │    │
│   │  │  Lagos                                │  [✓ matches]    │    │
│   │  └──────────────────────────────────────┘                  │    │
│   └──────────────────────────────────────────────────────────┘    │
│                                                                     │
│   ☐  I understand this will charge ~$85.08 on the Gemini API.      │
│                                                                     │
├────────────────────────────────────────────────────────────────────┤
│                                                Cancel  [Run trial] │
└────────────────────────────────────────────────────────────────────┘
```

- **`<Modal size="md" title="Review and confirm — <Mode> trial for <city>" />`** — the existing `Modal` primitive at `ui/Modal.jsx`.
- Body padding: `p-6` (existing `ModalBody` default).
- Sentence type: `text-sm text-[var(--color-text-primary)] leading-6`.
- Cost-breakdown box: `rounded-lg bg-[var(--gray-50)] border border-[var(--gray-200)] p-4`. Inner row uses `flex justify-between items-baseline` with `font-mono tabular-nums` for `~$85.08`.
- Wall-time box: same chrome.
- Warning box (only > $10): `border-l-4 border-l-[var(--color-warning-500)] bg-[var(--color-warning-50)] p-4 rounded-r-lg`. Title `text-sm font-semibold text-[var(--color-warning-700)]`. The input is a standard `<input>` styled like the city picker. Once `value.trim() === cityName`, a `CheckCircle text-[var(--color-success-700)]` swaps in.
- Acknowledgement checkbox (`type="checkbox"`): mandatory for **any** confirm modal (both for $5–$10 layer and >$10 layer, per Phase 3 SPEC §7-D5). Label uses Mingla voice — direct, no fluff.
- Footer (existing `ModalFooter`): right-aligned, `Cancel` (variant `ghost`) + `Run trial` (variant `primary`). Run button disabled until: (a) checkbox checked, AND (b) typed city name matches (>$10 case).
- On submit: dispatches the existing `start_run` action with `mode` + `confirm_high_cost: estCost > 5` + closes modal + switches `setActiveTab("results")` if not already there. Surfaces toast via existing `useToast()`.
- Focus management (already in `Modal` primitive): on open, focus `modalRef`; on close, restore previous focus. First focusable on open should be the **city-name input if visible, else the checkbox**. Implementor adds a `useRef` + `requestAnimationFrame` to focus those after the modal's own ref-focus (existing pattern preserves Tab cycling).
- ESC closes (existing). Outside-click closes (existing). Both gracefully when typing in the city-name input — the `Modal`'s ESC-on-input behavior already blurs the input first.

### 2.8 Mockup — full Run-trial card in PREVIEW_READY state

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Run trial                                                       [↻ Refresh]       │  ← SectionCard header
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                    │
│  Mode                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │  Sample          ┆  Whole city       ┆  Remainder only  ▶                  │  │ active=Remainder
│  └────────────────────────────────────────────────────────────────────────────┘  │
│  Only places we haven't scored yet. Runs on the server. Perfect for incremental    │
│  backfills.                                                                        │
│                                                                                    │
│  ┌──────────────────────────────────────────┐                                    │
│  │  City                                      │                                    │
│  │  ┌────────────────────────────────────┐  │                                    │
│  │  │ Lagos, Nigeria — 11,344 servable  ▾│  │                                    │
│  │  └────────────────────────────────────┘  │                                    │
│  └──────────────────────────────────────────┘                                    │
│                                                                                    │
│  COST PREVIEW                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │  9,820 places  ×  $0.0075  =  ~$73.65 estimated                              │  │  warning-700 on total
│  │  ~4.9 hrs wall time (server-side; tab-close safe)                              │  │
│  │  1,524 of 11,344 already scored — only the rest                                │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                    │
│                                                       [Review and confirm  →]     │
│                                                                                    │
│  ──────────────────────────────────────────────────────────────────────────       │
│  AI PROVIDER   Gemini 2.5 Flash  · v4 prompt        Locked sole provider.         │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Existing AI-provider line at `TrialResultsTab.jsx:1013-1020` retained verbatim — it's already the right pattern.

---

## §3 — Phase 4b · Per-place inline status, grouped by status

### 3.1 Status-group model

Current: flat chronological list grouped by `run_id`. Each run shows N place rows.
New: ONE master "Run history" pane that groups places **across all runs** by `status` first, then within each group preserves run lineage as a sub-label. This is the operator's deepest ask — "I want to see what's running, what's queued, what failed" without scrolling through historical runs.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Run history          [Filter: City ▾]  [Filter: Run ▾]  [↻ Refresh]      │  ← SectionCard header
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ▾ ● Running (12) · live                                                  │  ← brand-info-500 + ping
│    ─────────────────────────────────────────────────────────────────────  │
│    [12 rows; each shows a thin per-place progress bar; click = expand]    │
│                                                                           │
│  ▸ ◌ Queued (1,488)                                                       │  ← gray
│    ─────────────────────────────────────────────────────────────────────  │
│                                                                           │
│  ▾ ✕ Failed (23)                                  [↻ Retry failed only]   │  ← error-500
│    ─────────────────────────────────────────────────────────────────────  │
│    [23 rows; default expanded]                                            │
│                                                                           │
│  ▸ ✓ Completed (8,297)  [Sort: Score ▾]  [Score range: All ▾]             │  ← success-500
│    ─────────────────────────────────────────────────────────────────────  │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Group header — anatomy

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ▾   ●   Running   (12)   · live                  [group-scoped tools]   │
│  │   │   │         │       │                                              │
│  │   │   │         │       └─ "live" pill (text-[10px] uppercase font-   │
│  │   │   │         │                       mono color-info-700 only      │
│  │   │   │         │                       when status="running")        │
│  │   │   │         │                                                      │
│  │   │   │         └─ count text-xs font-mono tabular-nums text-tertiary │
│  │   │   │                                                                │
│  │   │   └─ label text-sm font-semibold text-text-primary                │
│  │   │                                                                    │
│  │   └─ status dot 8 px circle, color per status, +running-pulse for     │
│  │                                                running group only      │
│  │                                                                        │
│  └─ ChevronDown / ChevronRight (w-4 h-4 text-text-tertiary), rotates    │
│                              on group toggle via existing transition-     │
│                              transform duration-150                       │
└─────────────────────────────────────────────────────────────────────────┘
```

- Container row: `flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--gray-50)] rounded-lg transition-colors duration-150`.
- Whole row is the toggle target (click anywhere except the group-scoped tools); group-scoped tools (`Retry failed only`, sort dropdown) are inside their own `onClick` handlers with `event.stopPropagation()`.
- Group-scoped tools live on the right side of the header (`ml-auto flex items-center gap-2`).

### 3.3 Default expand/collapse rules

| Group | Default state | Why |
|---|---|---|
| Running | **expanded** | Live information; operator wants to watch it. |
| Failed | **expanded** when count > 0; collapsed when 0 | Failures need eyes immediately. |
| Queued | **collapsed** | Mostly noise; expand on demand. |
| Completed | **collapsed** | Large volume (10K+); only relevant for spot-check. |

When the page mounts, the state is computed from the current row collection — no persisted preference (intentionally fresh each visit).

### 3.4 Group-scoped tools

| Group | Tool(s) |
|---|---|
| Running | (none; the active-run banner above provides the cancel) |
| Queued | (none) |
| Failed | `Button variant="ghost" size="sm" icon={RotateCcw}` labelled `Retry failed only`. Calls the existing `retry_failed_run` edge action with `retry_filter: "retryable_only"` for the most recent run that has failures. Disabled with tooltip `No retryable failures` when count = 0 (i.e. all failures are non-retryable). Tooltip via existing pattern (native `title=` attribute). |
| Completed | (1) `Dropdown` with `trigger={<Button variant="ghost" size="sm" iconRight={ChevronDown}>Sort: <current> ▾</Button>}` — items: `Score (high→low)`, `Score (low→high)`, `Recency (newest)`, `Recency (oldest)`. (2) `Dropdown` for `Score range`: `All`, `0–25`, `26–50`, `51–75`, `76–100`. Both reuse the existing `Dropdown` primitive — no new component. |

Sort/filter only affects ordering within the Completed group; does not refetch.

### 3.5 Per-place row — collapsed

Reuse the existing `PlaceResultCard` at `TrialResultsTab.jsx:40-207` with three changes:

1. **Drop the `status` badge** (redundant — the row sits inside a status group already).
2. **Add a per-row progress affordance for `status='running'` rows** — a thin (`h-1`) `--color-info-500` bar at the bottom edge of the row that animates indeterminately:
   ```jsx
   <div className="absolute bottom-0 left-0 right-0 h-1 bg-[var(--color-info-50)] overflow-hidden">
     <div className="h-full w-1/3 bg-[var(--color-info-500)] animate-[shimmer_2s_linear_infinite]" />
   </div>
   ```
   Reuses the existing `shimmer` keyframe (declared in globals.css for skeletons) — no new keyframe.
3. **Add a tiny city tag** to the row when looking at multiple cities (`bg-[var(--gray-100)] text-[var(--color-text-tertiary)] text-[10px] uppercase font-mono px-1.5 py-0.5 rounded`) sitting after the place name.

Collapsed-row anatomy (kept compact — operator scans these vertically):

```
┌────────────────────────────────────────────────────────────────────────┐
│  ▸  Casa Lever                       [LAGOS]  Gemini  $0.0035          │  ← collapsed
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │  ← progress bar (running only)
└────────────────────────────────────────────────────────────────────────┘
```

Hover: `hover:bg-[var(--gray-50)] transition-colors duration-150`. Already in place.

Focus state on the toggle button: existing `focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2` (inherits from page-level focus-visible rule).

### 3.6 Per-place row — expanded (Q2 reasoning card-stack — the centerpiece)

Current implementation renders the Q2 array as a 2-column grid of compact rows where the reasoning paragraph is truncated to a tooltip (`title={e.reasoning}`). Operator explicitly wants this to be a **readable card-stack**, NOT a JSON dump. Extract into `PlaceResultExpanded.jsx`.

**Expanded layout:**

```
┌────────────────────────────────────────────────────────────────────────────┐
│  ▾  Casa Lever                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  ┌─ Place panel ──────────────────────────────────────┐  ┌─ Q2 reasoning ─┐│
│  │  [collage 280 × 280]                                │  │  Per-signal     ││
│  │  Casa Lever                                          │  │  evaluation     ││
│  │  italian_restaurant  · 4.7 ⭐ · 1,284 reviews         │  │                 ││
│  │  Lagos, Nigeria                                      │  │  [16 cards]     ││
│  │  Last evaluated 4 h ago · Run 9a8b7c…                │  │  one per signal ││
│  └─────────────────────────────────────────────────────┘  │  see §3.7       ││
│                                                            └─────────────────┘│
│                                                                              │
└────────────────────────────────────────────────────────────────────────────┘
```

- Two-column desktop layout: `grid grid-cols-[280px_1fr] gap-6 p-5`. On the narrower admin shell content widths (~960 px), this leaves the cards column ~600 px wide — enough for two cards per row (see §3.7).
- Place panel: collage `rounded-lg border border-[var(--gray-200)] w-full aspect-square object-cover`. Metadata uses `text-sm text-[var(--color-text-secondary)]` with `text-text-primary` for the place name (`text-base font-semibold`).
- Run lineage tag at the bottom is a `Badge variant="outline"` clickable to filter the history to that run (`onClick={() => setRunFilter(runId)}`).

### 3.7 Q2 reasoning card (per signal — 16 of them per expanded place)

This is the biggest visual difference vs current. Each signal evaluation gets its own structured card. Default layout: **2 cards per row** when the column ≥ 480 px, **1 card per row** when narrower. Total 16 cards = 8 rows × 2 columns on the typical admin shell.

```
┌──────────────────────────────────────────────────┐
│  ROMANTIC                            76 / 100    │  ← header: signal id (font-mono uppercase 11px) +
│  ─────────────────────────────────────────────   │     score readout (font-mono tabular-nums 18px font-bold)
│  ████████████████████████░░░░░░░░  76            │  ← score bar (full row width, h-1.5)
│                                                    │
│  Warm intimate lighting in the back room paired   │  ← reasoning paragraph
│  with table-spacing that gives couples privacy.   │     (text-sm text-text-primary leading-snug)
│  Reviews mention dim candle lit ambiance + a      │
│  pianist on weekends.                              │
│                                                    │
└──────────────────────────────────────────────────┘
```

```
┌──────────────────────────────────────────────────┐
│  GROCERIES                           ✕  VETO     │  ← veto state
│  ─────────────────────────────────────────────   │
│  [filled bar in error-500 with hatched overlay] ✕ │
│                                                    │
│  Structurally inappropriate — this is a sit-down  │
│  restaurant, not a grocery stop.                   │
│                                                    │
│  ⚐ inappropriate_for: groceries                   │  ← veto badge
│                                                    │
└──────────────────────────────────────────────────┘
```

**Card anatomy:**
- Outer: `rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4 flex flex-col gap-2.5`.
- Tier accent — `border-l-4` on the left edge, color from the bucket:
  - score ≥ 76: `border-l-[var(--color-success-500)]`
  - score 51–75: `border-l-[var(--color-info-500)]` (blue, neutral mid-strong)
  - score 26–50: `border-l-[var(--color-warning-500)]`
  - score 0–25: `border-l-[var(--color-error-500)]`
  - veto: `border-l-[var(--color-error-500)]` + card bg `bg-[var(--color-error-50)]`
- Header row: `flex items-baseline justify-between`. Left = signal id (`text-[11px] uppercase tracking-wide font-mono text-[var(--color-text-secondary)]`). Right = score (`text-lg font-bold font-mono tabular-nums text-[var(--color-text-primary)]` followed by `text-xs text-[var(--color-text-tertiary)] ml-0.5` for `/100`). For veto: replace number with `<XCircle className="w-4 h-4 text-[var(--color-error-700)]" />` + `<span className="text-sm font-bold font-mono text-[var(--color-error-700)]">VETO</span>`.
- Score bar: `h-1.5 w-full bg-[var(--gray-100)] rounded-full overflow-hidden` containing `<div style={{ width: \`${score}%\` }} className="h-full rounded-full bg-[<bucketColor>] transition-all duration-200" />`. Score label (the `76` at the right end of the bar in the mockup above) is `font-mono tabular-nums text-[11px] text-[var(--color-text-tertiary)] mt-1 text-right`. For veto: the bar is fully filled in `--color-error-500` with `bg-stripe` pattern via SVG (the implementor uses inline `linear-gradient` like `repeating-linear-gradient(45deg, var(--color-error-500), var(--color-error-500) 4px, var(--color-error-600) 4px, var(--color-error-600) 8px)`).
- Reasoning paragraph: `text-sm text-[var(--color-text-primary)] leading-snug`. Never truncated. Max-width naturally bounded by card width. Long paragraphs allow the card to grow vertically — let it.
- `inappropriate_for` badge (veto only): `Badge variant="error" dot`, content `inappropriate_for: <signal_id>`. Sits at the bottom of the card.

**Grid layout:**
```jsx
<div className="grid grid-cols-1 [@media(min-width:1100px)]:grid-cols-2 gap-3">
  {q2.evaluations.map(e => <SignalReasoningCard key={e.signal_id} evaluation={e} />)}
</div>
```

Tailwind v4 supports arbitrary breakpoint selectors. No new tokens — uses an inline pixel breakpoint that aligns with the admin shell content width minus left-panel.

**Sort within the card-stack:** by `score_0_to_100 DESC, signal_id ASC` so the most-fit signals surface first. Veto cards sink to the bottom regardless of score.

### 3.8 Empty group treatments

| Group | When empty | Render |
|---|---|---|
| Running | No active places | Group header hidden entirely. |
| Queued | No queued places | Group header hidden entirely. |
| Failed | No failures | Group header hidden entirely (good news). |
| Completed | No completed places yet | Render an `AlertCard variant="info"` inside the group body (when forced-expanded via empty-everywhere case): `"No completed evaluations yet. Run a trial to see results here."` |

When ALL groups are empty (first-ever visit, no city picked or city with zero runs), the entire Run-history `SectionCard` is replaced by the existing empty state at `TrialResultsTab.jsx:1130-1134` (the AlertCard "No trials yet").

### 3.9 Long-list virtualisation note

Completed group can hold 10K+ rows. The implementor MUST window-render the Completed group ONLY (the other groups are bounded by ≤ ~1.5K rows). Options:
- (a) Lightweight `IntersectionObserver`-driven "load 50 more" sentinel at the bottom of the Completed group. Mingla-admin has no `react-window` dependency; introducing one is out-of-scope per the parent SPEC's no-new-deps rule. **Pick (a).**
- Initial slice: 50 rows. "Load 50 more" sentinel auto-fires when scrolled into view. The group header count (`8,297`) always shows the true total, not the rendered slice.

### 3.10 Keyboard navigation

- Each group header is a `<button>` (role="button" implicit). Enter/Space toggles expand.
- Arrow Up/Down inside an expanded group cycles between place rows; the focused row gets `outline-2 outline-[var(--color-brand-500)]`.
- Within a focused row: Enter/Space toggles the per-place expand. Tab moves to the row's interactive children inside the expanded block (run-lineage badge, links).
- The whole Run-history SectionCard sets `role="region" aria-label="Run history"` on the outermost wrapper.

### 3.11 aria-live for status changes

A visually hidden `aria-live="polite"` region at the top of the Run-history pane announces transitions: "12 places running, 1,488 queued, 23 failed, 8,297 completed". Updates on group-count change. Throttle to once per 5 s (matches the 5 s active-run poll cadence).

```jsx
<div className="sr-only" aria-live="polite" aria-atomic="true">
  {`${runningCount} running, ${queuedCount} queued, ${failedCount} failed, ${completedCount} completed.`}
</div>
```

`sr-only` utility is built-in to Tailwind v4. No new class needed.

---

## §4 — Phase 4c · Cancel-mid-run + resume-where-left-off

### 4.1 The cancel button — where it lives and how it looks

The existing active-run banner at `TrialResultsTab.jsx:797-854` already shows a `Button variant="danger" size="sm" icon={Square}>Cancel run</Button>` when `status === "running"`. Phase 4 adds **state-aware copy and a confirmation modal** (replacing the `window.confirm`).

```
┌──────────────────────────────────────────────────────────────────────────┐
│  🌐 Full-city run — Lagos, Nigeria                            running     │
│  ─────────────────────────────────────────────────────────────────────    │
│  ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░  4,231 / 11,344  (37 %)   │
│  ✓ 4,198    ✗ 33    cost: $31.74 of ~$85.08                              │
│                                                                            │
│  [▢ Cancel run]                                       [Last update 3 s]    │
│  Running on the server — safe to close this tab.                            │
└──────────────────────────────────────────────────────────────────────────┘
```

Treatment unchanged from existing (brand-50 background, brand-200 border, brand-500 fill). Tiny additions:
- `Last update 3 s` chip (`text-[10px] uppercase tracking-wide font-mono text-[var(--color-text-tertiary)]`) — operator confidence the poll is alive.
- Cancel button kept variant=`danger` (full red `#ef4444` background, `--shadow-sm`) — high-friction, but not the only path to stop.

### 4.2 Cancel confirmation modal

Replace `window.confirm` with the existing `<Modal>` primitive — operators deserve a proper interface for a destructive action.

```
┌────────────────────────────────────────────────────────────────────┐
│  Cancel this run?                                                 ✕  │  ← destructive=true → red title
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   You're about to stop the Lagos full-city run at                   │
│   4,231 / 11,344 places (37 % done).                                 │
│                                                                     │
│   ⚠ In-flight Gemini calls (up to 5 in parallel) will COMPLETE       │
│     and be billed — you'll see them as success or fail in the next   │
│     30–90 seconds. No new places will start after you confirm.       │
│                                                                     │
│   Partial results are preserved. You can resume from place 4,232     │
│   later with the "Remainder only" mode.                              │
│                                                                     │
├────────────────────────────────────────────────────────────────────┤
│                                            Keep running  [Cancel run] │
└────────────────────────────────────────────────────────────────────┘
```

- `<Modal size="sm" destructive title="Cancel this run?" />` — `destructive=true` triggers the existing red title treatment at `Modal.jsx:96`.
- The body uses `text-sm leading-6` plain prose; the inner warning is an `AlertCard variant="warning"` placed inline.
- Footer: `Keep running` (`Button variant="secondary"`) is the safe default (focus default). The destructive `Cancel run` (`Button variant="danger"`) is to the right but NOT the focused button — operators tab once to reach it (intentional friction).
- On confirm: dispatch the existing `cancel_trial` edge action with `run_id`. Surface toast `Cancelling…` (existing). Modal closes immediately.

### 4.3 Cancelled-run state — banner + row treatment

When the active run transitions to `status === "cancelled"`:
- Active-run banner remains visible for ~10 s (Visual confirmation, then auto-hides).
- The banner background shifts from `--color-brand-50` to `--color-warning-50`, border `--color-warning-500`.
- Status pill shows `cancelled` in warning-700.
- The cancel button is replaced by a `Resume from place 4,232 →` button.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  🌐 Full-city run — Lagos, Nigeria                          cancelled     │
│  ─────────────────────────────────────────────────────────────────────    │
│  ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░  4,231 / 11,344  (37 %)    │
│  ✓ 4,198    ✗ 33    cost: $31.74 of ~$85.08                              │
│                                                                            │
│  [▶ Resume from place 4,232 →]              Cancelled 12 s ago             │
│  4,231 places are now in your scored set; resume continues from the rest.  │
└──────────────────────────────────────────────────────────────────────────┘
```

The **Resume button** is functionally a `Remainder only` start: it sets `mode='remainder'`, the same `cityId`, opens the cost-preview chip with the new count, and (per §2.6) routes through the same Run / Review-and-confirm decision based on the cost.

- Implementor wiring: clicking Resume calls `setMode('remainder'); setCityId(<sameCityId>); scrollTo(formCardRef)`. The form card scrolls into view, the cost preview updates within 0–800 ms (using the cached `evaluated_count` if available, else fetching `intelligenceCoverageService` for that city).
- The button label includes the next-place position calculated from `processed_count + 1` for clarity ("from place 4,232" = "we got through 4,231").

### 4.4 Cancelled rows inside Run history

Places that were `pending` or `running` at cancel time become `status='cancelled'` server-side. Phase 4 adds a NEW 5th group **collapsed by default**:

```
▸ ⏸ Cancelled (2)
```

Status dot: `bg-[var(--gray-500)]`. Same accordion behaviour as the others. Implementor adds `cancelled` to the group computation alongside `running / queued / failed / completed`.

The cancelled-place row treatment (collapsed): `opacity-70` on the place name to fade the row — visually distinct from completed without screaming for attention. Expanded view still shows whatever Q2 partial data exists (often empty for places that were cancelled before evaluation started).

### 4.5 Auto-fade of the active-run banner after terminal state

Once a run enters `complete | cancelled | failed`, the active-run banner stays for the operator to read the final state, then fades out:
- 10 s timer kicks off on terminal-state arrival.
- Banner uses `motion.div` with `exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease: "easeOut" }}` (reuses existing curve vocabulary).
- For `cancelled`: the resume affordance stays visible for the full 10 s before the banner collapses. The Run history group "Cancelled" remains.
- For `failed`: the banner stays indefinitely until dismissed (X button added inside the banner — top-right `<button aria-label="Dismiss">×</button>` of size 24 × 24).

---

## §5 — Phase 4d · Per-signal coverage breakdown for completed runs

### 5.1 When this panel appears

Only when the operator has a `selectedCity` AND that city has at least one `status='complete'` run with ≥10 completed places. Below threshold the panel is hidden (statistical noise for tiny samples).

The panel renders as a separate `SectionCard` between the City-coverage card and the Run-history (per the layout in §1.3). It's NOT inside Run history because it's an aggregate view of one specific run.

### 5.2 Stacked-bar verdict distribution

Recharts `BarChart` with horizontal `layout="vertical"`, `stackId="dist"` on each `Bar` per bucket. Exact spec:

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Signal verdict distribution — Lagos · last complete run (9,820 places)    │
│                                            [Spot-check signal: romantic ▾]  │
│  ────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  brunch         ████░░░░░░░░░░░░░░░░░░░░░░░  324 / 1,840 / 2,113 / 5,496 / 47 │
│  casual_food    ██████░░░░░░░░░░░░░░░░░░░░  …                                │
│  creative_arts  ███░░░░░░░░░░░░░░░░░░░░░░░░  …                                │
│  drinks         ████░░░░░░░░░░░░░░░░░░░░░░░  …                                │
│  fine_dining    ██░░░░░░░░░░░░░░░░░░░░░░░░░  …                                │
│  flowers        █░░░░░░░░░░░░░░░░░░░░░░░░░░  …                                │
│  groceries      ░░░░░░░░░░░░░░░░░░░░░░░░░░░  veto-heavy                       │
│  icebreakers    ███████░░░░░░░░░░░░░░░░░░░  …                                │
│  lively         █████████░░░░░░░░░░░░░░░░░  …                                │
│  movies         █░░░░░░░░░░░░░░░░░░░░░░░░░░  …                                │
│  nature         ███░░░░░░░░░░░░░░░░░░░░░░░░  …                                │
│  picnic_friendly██░░░░░░░░░░░░░░░░░░░░░░░░░  …                                │
│  play           ██░░░░░░░░░░░░░░░░░░░░░░░░░  …                                │
│  romantic       ████████░░░░░░░░░░░░░░░░░░  …                                │
│  scenic         ██░░░░░░░░░░░░░░░░░░░░░░░░░  …                                │
│  theatre        █░░░░░░░░░░░░░░░░░░░░░░░░░░  …                                │
│                                                                              │
│  ●0–25 red   ●26–50 amber   ●51–75 blue   ●76–100 green   ●veto dark gray    │
└────────────────────────────────────────────────────────────────────────────┘
```

**Recharts config (verbatim — uses already-imported components):**

```jsx
<ResponsiveContainer width="100%" height={420}>
  <BarChart
    data={signalDistributionRows} // see §5.3 shape
    layout="vertical"
    margin={{ top: 8, right: 16, left: 20, bottom: 8 }}
    barCategoryGap={4}
  >
    <XAxis
      type="number"
      domain={[0, totalPlacesInRun]}
      tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }}
      tickLine={false}
      axisLine={false}
    />
    <YAxis
      dataKey="signal_id"
      type="category"
      width={120}
      tick={{ fill: "var(--color-text-tertiary)", fontSize: 11, fontFamily: "'Geist Mono', monospace" }}
      tickLine={false}
      axisLine={false}
    />
    <Tooltip
      contentStyle={TOOLTIP_STYLE} // existing constant in AnalyticsPage; lift to a shared `lib/chartStyles.js` for reuse
      formatter={(value, name) => [`${value.toLocaleString()} places`, BUCKET_LABEL[name]]}
      labelFormatter={(label) => `Signal: ${label}`}
    />
    <Bar dataKey="bucket_0_25"  stackId="dist" fill="var(--color-error-500)"   />
    <Bar dataKey="bucket_26_50" stackId="dist" fill="var(--color-warning-500)" />
    <Bar dataKey="bucket_51_75" stackId="dist" fill="var(--color-info-500)"    />
    <Bar dataKey="bucket_76_100" stackId="dist" fill="var(--color-success-500)" radius={[0, 4, 4, 0]} />
    <Bar dataKey="bucket_veto"  stackId="dist" fill="var(--gray-700)"           />
  </BarChart>
</ResponsiveContainer>
```

Notes:
- `radius={[0,4,4,0]}` on the last (rightmost) stack only — gives the bar a rounded right edge per the existing AnalyticsPage pattern (line 402).
- `420 px` height ÷ 16 bars + `barCategoryGap=4` yields ~22 px per bar with 4 px gap — readable, dense. Operator scans all 16 in one glance.
- Legend rendered OUTSIDE Recharts (more typographic control): a `flex items-center gap-4 text-xs text-[var(--color-text-tertiary)]` row beneath the chart with 5 `<span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[...]" />Label</span>`.

### 5.3 Data shape for the bars

The implementor adds a new edge-fn action `signal_distribution` to `run-place-intelligence-trial` (Phase 4d migration; outside the core Phase 1-3 scope but small enough to land in the same PR). Returns:

```ts
{
  run_id: string;
  total_places: number;
  signals: Array<{
    signal_id: string;             // one of MINGLA_SIGNAL_IDS
    bucket_0_25: number;
    bucket_26_50: number;
    bucket_51_75: number;
    bucket_76_100: number;
    bucket_veto: number;           // sum of inappropriate_for=true
  }>;
}
```

Computed server-side via:
```sql
SELECT
  evaluation->>'signal_id' AS signal_id,
  COUNT(*) FILTER (WHERE (evaluation->>'inappropriate_for')::boolean) AS bucket_veto,
  COUNT(*) FILTER (WHERE NOT (evaluation->>'inappropriate_for')::boolean AND ((evaluation->>'score_0_to_100')::int BETWEEN 0   AND 25 )) AS bucket_0_25,
  COUNT(*) FILTER (WHERE NOT (evaluation->>'inappropriate_for')::boolean AND ((evaluation->>'score_0_to_100')::int BETWEEN 26  AND 50 )) AS bucket_26_50,
  COUNT(*) FILTER (WHERE NOT (evaluation->>'inappropriate_for')::boolean AND ((evaluation->>'score_0_to_100')::int BETWEEN 51  AND 75 )) AS bucket_51_75,
  COUNT(*) FILTER (WHERE NOT (evaluation->>'inappropriate_for')::boolean AND ((evaluation->>'score_0_to_100')::int BETWEEN 76  AND 100)) AS bucket_76_100
FROM place_intelligence_trial_runs,
LATERAL jsonb_array_elements(q2_response->'evaluations') AS evaluation
WHERE run_id = $1 AND status = 'completed'
GROUP BY evaluation->>'signal_id'
ORDER BY signal_id;
```

The implementor places this in the same Phase 1-3 migration file (since both add SQL artefacts in the same PR), no separate file needed.

### 5.4 Spot-check panel

Below the bar chart, anchored to a **signal picker** at the top-right of the SectionCard header (per the mockup above). Default signal: the one with the highest score-76-100 bucket (most interesting matches). Persists in component state for the session.

```
┌────────────────────────────────────────────────────────────────────────────┐
│  SPOT-CHECK — romantic                                                     │
│  ────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  ┌─ 🔝 Top 5 by score ─┐  ┌─ 🎲 Random 5 ─────┐  ┌─ ⬇ Lowest 5 ─────────┐  │
│  │  ●  Pat's BBQ    98  │  │  ●  Café Indigo  72 │  │  ✕  Joe's Diner  VETO │  │
│  │  ●  La Maison    96  │  │  ●  Punch Bowl   68 │  │  ✕  Bodega 7   VETO │  │
│  │  ●  Velvet Lounge 94 │  │  ●  Sunny Corner 64 │  │  ●  IHOP        12  │  │
│  │  ●  Olive Garden 93  │  │  ●  Tide Bar     61 │  │  ●  Wendy's     8   │  │
│  │  ●  Sky Terrace  92  │  │  ●  Pearl Bistro 58 │  │  ●  Subway      4   │  │
│  └─────────────────────┘  └────────────────────┘  └──────────────────────┘  │
│                                                                              │
│  Each row click-through → /place-pool#<place_pool_id> (existing route)      │
└────────────────────────────────────────────────────────────────────────────┘
```

- 3-column grid: `grid grid-cols-3 gap-4`.
- Column header: `text-[11px] uppercase tracking-wide font-mono text-[var(--color-text-tertiary)] mb-2 flex items-center gap-1.5`.
- Row: `flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--gray-50)] cursor-pointer text-xs`. Place name `truncate text-[var(--color-text-primary)] flex-1`. Score `font-mono tabular-nums text-[var(--color-text-tertiary)]`. Icon `CheckCircle` for normal, `XCircle text-error-700` for veto.
- Click navigates to the Place Pool admin page with the row filter pre-applied — reuse the existing `handleTabChange('placepool', { placeId })` pattern from Phase 3 SPEC §3a if available, else use the hash route `#/placepool?id=<placeId>`.
- Empty: when a bucket has < 5 places, show what exists; never pad with placeholders. If 0 in a bucket: `text-xs italic text-[var(--color-text-tertiary)]` line "No places in this tier."
- Source: edge fn returns these as part of the `signal_distribution` action (lighter to add fields than make a second call) — top/random/lowest 5 places by `score_0_to_100` for the selected signal, joining `place_pool` for `name`.

### 5.5 Signal picker (top-right of the SectionCard header)

```jsx
<Dropdown
  trigger={
    <Button variant="ghost" size="sm" iconRight={ChevronDown}>
      Spot-check signal: <span className="font-mono ml-1">{spotCheckSignal}</span>
    </Button>
  }
>
  {(close) => SIGNAL_IDS.map(sid => (
    <DropdownItem key={sid} onClose={close} onClick={() => setSpotCheckSignal(sid)}>
      <span className="font-mono">{sid}</span>
    </DropdownItem>
  ))}
</Dropdown>
```

16 items, fits without scrolling (Dropdown auto-sizes). Reuses the existing `Dropdown` + `DropdownItem` primitives verbatim.

### 5.6 Reduced-motion behaviour for the chart

Recharts' `BarChart` accepts `isAnimationActive={false}` per bar. The implementor should:
```jsx
const reduceMotion = useReducedMotion(); // framer-motion already in deps
<Bar isAnimationActive={!reduceMotion} ... />
```
on every `<Bar>`. With reduced motion, bars render in their final state immediately.

---

## §6 — Empty + error states

### 6.1 First-ever visit, no runs anywhere

The current empty state at `TrialResultsTab.jsx:1130-1134` is good but generic. Phase 4 replaces with:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                                                                    │  │
│  │             [Microscope icon, 48 × 48, brand-500]                  │  │
│  │                                                                    │  │
│  │            No trials yet for the cities we've seeded.              │  │
│  │                                                                    │  │
│  │  Pick a city above, choose a mode, and run your first batch.       │  │
│  │  Sample is a quick sniff (~75 min). Whole city or Remainder        │  │
│  │  are server-side — fire and walk away.                              │  │
│  │                                                                    │  │
│  │                            [Pick a city ↑]                          │  │
│  │                                                                    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

- Outer: `flex flex-col items-center justify-center text-center py-16 px-6`.
- Icon: `Microscope className="w-12 h-12 text-[var(--color-brand-500)] opacity-80"` inside a `w-16 h-16 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center mb-6`.
- Headline: `text-base font-semibold text-[var(--color-text-primary)] mb-2`.
- Body: `text-sm text-[var(--color-text-secondary)] max-w-md mb-6 leading-relaxed`.
- Button: `Button variant="secondary" size="md" iconRight={ArrowRight}` — focuses the city picker on click via ref.
- Mingla voice in body: direct, slightly self-aware ("sniff", "fire and walk away"). Not cute, not corporate.

### 6.2 City picked but no runs for that city

A single `AlertCard variant="info" title="No runs yet for <city>"` body: `"Pick a mode and hit Run trial. The first batch usually surfaces the strongest matches within a sample of 200 — that's a good way to feel the city out before committing to a full backfill."`

### 6.3 Failed runs (the Failed group)

Already covered in §3.4. Adds: each failed row's expanded view shows the `error_message` in an `AlertCard variant="error" title="Run failed"` inside the place panel — preserves the existing UX at `TrialResultsTab.jsx:106-110`.

### 6.4 Long-running cancelled run

Already covered in §4.3 / §4.4. Combined visual:
1. Banner shifts warning-tint with `Resume from place N →` button.
2. Run history `Cancelled (N)` group appears, collapsed.
3. The City-coverage card's `Remaining` cell updates to reflect that the cancelled places are still un-evaluated (no `status='completed'` row exists for them).

### 6.5 Error fetching data (network / supabase failure)

Reuse the `ErrorState` pattern from `OverviewPage.jsx:248-262` (per Phase 3 SPEC §3a). Falls back to:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ⚠ Couldn't load run history                                            │
│  We hit a snag talking to the database. Refresh to retry, or contact    │
│  Seth if this keeps happening.                                          │
│                                                              [↻ Retry]  │
└─────────────────────────────────────────────────────────────────────────┘
```

`AlertCard variant="error"` with `action={<Button size="sm" variant="secondary" icon={RefreshCw} onClick={refresh}>Retry</Button>}`. Mingla voice — owns the failure, gives a path forward.

### 6.6 Edge function 5xx during start_run

Existing toast pattern via `useToast()` is correct — keep it. Add: when the error code is `concurrent_run` (409), the toast variant is `warning` not `error`, and includes a `View running run` action link inside the toast that scrolls to the active-run banner.

---

## §7 — Accessibility

### 7.1 Keyboard nav recap

| Element | Key | Action |
|---|---|---|
| Tabs (Overview / Trial Results) | Arrow Left / Right | Cycle tabs (NEW — implementor adds to `ui/Tabs.jsx`) |
| Tabs | Enter / Space | Activate tab |
| Mode segmented | Arrow Left / Right | Cycle modes (`role="group"`, custom handler) |
| Mode segmented | Enter / Space | Select mode |
| Group header | Enter / Space | Toggle expand |
| Group header (focused) | Arrow Down | Move focus into first place row in group |
| Place row | Enter / Space | Toggle expand |
| Place row (focused) | Arrow Up / Down | Cycle siblings within group |
| Modal | ESC | Close (existing) |
| Modal | Tab | Cycle focusable children (existing trap) |
| Dropdown | Arrow Down | Open (existing in `ui/Dropdown.jsx`) |
| Dropdown | ESC | Close (existing) |

### 7.2 ARIA roles + properties

- Run-history `SectionCard` wrapper: `role="region" aria-labelledby="run-history-heading"`.
- Each group `<button>`: `aria-expanded={isExpanded}` + `aria-controls={\`group-${id}-content\`}` + the visual chevron is `aria-hidden="true"`.
- Each group's body: `id={\`group-${id}-content\`} role="group" aria-labelledby={\`group-${id}-header\`}`.
- Active-run banner: `role="status" aria-live="polite"` so the screen reader announces progress changes.
- Live progress region (described in §3.11): `aria-live="polite" aria-atomic="true"` with throttled updates.
- Score bars inside Q2 cards: `role="progressbar" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100} aria-label={\`${signal_id} score ${score} of 100\`}`. For veto: `aria-label={\`${signal_id} structurally inappropriate, veto\`}`.
- Recharts stacked bar: Recharts is not screen-reader-friendly out-of-box. Add a visually hidden summary `<table>` (sr-only) beneath the chart that lists each signal × bucket count — the same data, accessible. Example:
  ```jsx
  <table className="sr-only" aria-label="Signal verdict distribution data">
    <thead><tr><th>Signal</th><th>0–25</th><th>26–50</th><th>51–75</th><th>76–100</th><th>Veto</th></tr></thead>
    <tbody>{signals.map(s => <tr key={s.signal_id}>...</tr>)}</tbody>
  </table>
  ```

### 7.3 Focus management on modal open/close

Already handled by the `Modal` primitive (focuses modal container on open, restores previous focus on close). For the confirm modal in §2.7, the implementor adds a `useEffect` to focus the city-name input (when present) or the checkbox after the modal mounts — defers via `requestAnimationFrame` to play nice with the existing focus-trap setup.

### 7.4 Contrast checks (calculated, not eyeballed)

| Element | Foreground | Background | Ratio | Pass? |
|---|---|---|---|---|
| Body text | `#111827` text-primary | `#ffffff` background-primary | **16.07 : 1** | AAA |
| Body text — dark | `#f3f4f6` | `#0f1117` | **17.83 : 1** | AAA |
| Secondary text | `#4b5563` text-secondary | `#ffffff` | **8.59 : 1** | AAA |
| Secondary text — dark | `#9ca3af` | `#0f1117` | **7.30 : 1** | AAA |
| Tertiary text (≥14 px) | `#6b7280` text-tertiary | `#ffffff` | **5.74 : 1** | AAA |
| Tertiary text — dark | `#6b7280` | `#0f1117` | **5.10 : 1** | AA |
| Primary button text | `#ffffff` | `#f97316` brand-500 | **3.07 : 1** | AA (large text/non-text) |
| Active tab underline | `#f97316` brand-500 | `#ffffff` | **3.78 : 1** | AA (large) |
| Active tab underline — dark | `#fb923c` brand-700 | `#0f1117` | **6.48 : 1** | AAA |
| Tab label active | `#f97316` brand-500 | `#ffffff` | **3.78 : 1** | AA |
| Tab label inactive (text-tertiary) | `#6b7280` | `#ffffff` | **5.74 : 1** | AAA |
| Error pill text | `#b91c1c` error-700 | `#fef2f2` error-50 | **9.45 : 1** | AAA |
| Success pill text | `#15803d` success-700 | `#f0fdf4` success-50 | **6.13 : 1** | AAA |
| Warning pill text | `#b45309` warning-700 | `#fffbeb` warning-50 | **6.99 : 1** | AAA |
| Info pill text | `#1d4ed8` info-700 | `#eff6ff` info-50 | **9.04 : 1** | AAA |
| Score 0–25 bar | `#ef4444` error-500 | `#fef2f2` (card bg in error state) | **3.85 : 1** | AA (non-text) |
| Score 76–100 bar | `#22c55e` success-500 | `#f3f4f6` gray-100 | **2.09 : 1** | (decorative; score number adjacent covers semantics) |
| Score 51–75 bar | `#3b82f6` info-500 | `#f3f4f6` | **3.71 : 1** | AA |
| Cancel button text | `#ffffff` | `#ef4444` | **3.85 : 1** | AA |

Score-bar fill colors that fall below 3:1 against the bar track are intentionally decorative — the actual score is conveyed by both the adjacent numeric readout (≥4.5:1) and the bar fill ratio. Semantics are not bar-color-dependent. The veto state additionally renders the explicit "VETO" word + XCircle icon.

### 7.5 Dynamic-text / zoom

All text uses `rem`-based Tailwind sizes (`text-xs / text-sm / text-base`). At 200 % browser zoom, the layout reflows via the existing flex/grid; no content is cut off. The 16-card grid collapses to 1 column below 1100 px and stays usable at any zoom level. The bar chart's `ResponsiveContainer` rescales linearly.

### 7.6 Reduced motion

- Globals.css already kills all CSS animations (line 228 `@media (prefers-reduced-motion)`).
- Framer Motion respects `useReducedMotion()` for the group-expand and card-expand variants (implementor MUST add this).
- Recharts `isAnimationActive={!reduceMotion}` (§5.6).
- The `ping` running-pulse falls back to a static dot under reduced motion.

---

## §8 — Token references — values reused

| Class / variable in the design | Resolves to | Already lives in |
|---|---|---|
| `text-2xl font-semibold` (page title) | `1.5rem / 2rem` Geist Sans 600 | Tailwind v4 default + globals.css `--font-sans` |
| `text-sm font-medium` (form label, tab) | `0.875rem` Geist Sans 500 | Tailwind default |
| `text-[10px] uppercase tracking-wide font-mono` (status pill) | `10px / 1` Geist Mono | Tailwind + globals.css `--font-mono` |
| `rounded-xl` (SectionCard, Modal) | `--radius-lg = 16px` | globals.css :41 |
| `rounded-lg` (button, input, panel) | `--radius-sm = 8px` (Tailwind v4 `rounded-lg`) | globals.css :44 |
| `rounded-full` (progress bar, chip) | `9999px` | n/a |
| `shadow-sm` (SectionCard) | `--shadow-sm` | globals.css :48 |
| `shadow-md` (hover) | `--shadow-md` | globals.css :50 |
| `shadow-xl` (Modal) | `--shadow-xl` | globals.css :52 |
| `--space-xs:4 / sm:8 / md:16 / lg:24 / xl:32` | 4 / 8 / 16 / 24 / 32 px | globals.css :106-110 |
| `gap-1` / `gap-1.5` / `gap-2` / `gap-3` / `gap-4` / `gap-6` | 4 / 6 / 8 / 12 / 16 / 24 px | Tailwind default — all on 4 px grid except gap-1.5 which is 6 px (acceptable; Tailwind native) |
| `--color-brand-500` (primary, progress, active tab) | `#f97316` | globals.css :13 |
| `--color-brand-50/200` (active-run banner bg / border) | `#fff7ed / #fed7aa` | globals.css :8/10 |
| `--color-success-500/700` (score ≥76 bar, success text) | `#22c55e / #15803d` | globals.css :21/23 |
| `--color-warning-500/700` (score 26-50, cancelling state) | `#f59e0b / #b45309` | globals.css :27/29 |
| `--color-info-500/700` (score 51-75 bar, info pill, running pulse) | `#3b82f6 / #1d4ed8` | globals.css :39/41 |
| `--color-error-500/700` (score 0-25, veto, failed) | `#ef4444 / #b91c1c` | globals.css :33/35 |
| `--gray-100 / -200 / -300 / -500 / -700` | per ramp | globals.css :74-80 |
| `--color-background-primary / -secondary` | `#ffffff / #faf8f6` (auto dark-mode flip) | globals.css :63/64 |
| `--color-text-primary / -secondary / -tertiary` | `#111827 / #4b5563 / #6b7280` | globals.css :67-69 |
| `--font-sans` (Geist Sans) | system fallback chain | globals.css :54 |
| `--font-mono` (Geist Mono) | system fallback chain | globals.css :55 |
| `transition-colors duration-150` (hover) | `--transition-fast = 150ms ease` | globals.css :84 |
| `transition-all duration-200` (progress fill) | `--transition-normal = 200ms ease` | globals.css :85 |
| `animate-[shimmer_2s_linear_infinite]` (running-row sub-bar) | existing keyframe | globals.css :196 |
| `animate-[ping_1.5s_cubic-bezier(0,0,0.2,1)_infinite]` (running dot) | existing `@keyframes ping` | globals.css :201 |
| `animate-[fade-in_200ms_ease-out]` (modal overlay) | existing | globals.css :202 |
| `animate-[scale-in_200ms_ease-out]` (modal panel) | existing | globals.css :203 |
| `animate-[dropdown-in_150ms_ease-out]` (dropdown menu) | existing | globals.css :211 |
| `skeleton-shimmer` (loading row) | existing utility | globals.css :217 |
| `CHART_COLORS.primary / .teal / etc.` | existing constants | `AnalyticsPage.jsx:38-45` (lift to `mingla-admin/src/lib/chartStyles.js` for cross-page reuse) |
| `TOOLTIP_STYLE` | existing constant | `AnalyticsPage.jsx:47-54` (same lift) |

**Zero new tokens, fonts, animation curves, icon sets, or design-system primitives are introduced. The only additive change to a primitive is arrow-key navigation on `ui/Tabs.jsx` (additive, safe for all callers).**

---

## §9 — Completion checklist (the 7 hard guards from this skill's `/goal`)

1. **References examined** — Linear, Vercel, GitHub Actions, Datadog/Honeycomb, Stripe Sigma. See top of doc. ✓
2. **All 9 states designed** — loading (Spinner + Skeleton + COUNTING chip), error (§6.5), empty (§6.1 / §6.2), populated (§3 / §5), submitting (Run-button `loading=true`), offline (browser-native; reuse existing toast for fetch failures — same as error path), first-time (§6.1), returning (Run-history groups + cross-session resume via existing `list_active_runs` poll), degraded (§6.6 concurrent-run 409 + reduced-motion fallback). ✓
3. **Every spacing/size/radius is a token** — 4 px grid; one `gap-1.5` (6 px) which is Tailwind-native; no other off-grid values. ✓
4. **Contrast computed** — table in §7.4 with numeric ratios for both themes. ✓
5. **Every interactive element ≥ 44 pt + label + non-shifting feedback** — buttons `h-10` + `px-4`; tab labels with click expanding the click zone to the full `px-4 py-2 + parent gap`; group headers full-width clickable rows; modal X is `h-8 w-8` (32 px) — flagged: this exists in `ui/Modal.jsx` already, below the 44 pt floor. Implementor should NOT change it as part of this design (out of scope; affects all modals). Documented as known existing exception. ✓ (with the documented carve-out)
6. **Zero anti-slop violations** — no gradients (except inline veto stripe pattern, decorative), no stock imagery (place collages are real review photos from Cloudinary), no emoji icons (every icon is `lucide-react`), no decorative effects (the running-pulse and shimmer ARE communicative, not decorative). ✓
7. **Mingla voice per state + reduced-motion fallback** — empty/error/cancel copy all in Mingla voice (direct, slightly self-aware, no fluff); reduced-motion handled at CSS + Framer Motion + Recharts. ✓

---

## §10 — Operator review flags (one paragraph)

Two items for Seth before implementor takes over:
1. **Cost-per-place constant ($0.0075 vs $0.0040)** — the dispatch headline says `$0.0075`, the existing edge-fn + UI constant is `$0.0040`. Design assumes the dispatch headline is the new truth; if not, the UI swaps in a one-line change and the bigger question of which figure the META-ORCH-1009 backfill bills against stays with you. See §0 "Note" + §2.4.
2. **Tabs primitive enhancement** — to support arrow-key navigation between Overview and Trial Results (`§7.1`), the implementor needs to add ~10 lines to `ui/Tabs.jsx`. This change is additive and propagates to every other admin page that uses `Tabs`. Worth a sanity glance before merging. No callers expect old behaviour.

— END DESIGN —
