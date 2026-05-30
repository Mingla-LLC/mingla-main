# SPEC — ORCH-1013 Place Intel Control Tower + Coverage Fix + Admin Build Restore

- **ORCH-ID:** ORCH-1013
- **Branch:** `ORCH-1013-place-intel-control-tower-coverage-fix`
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1013-[place-intel-control-tower-coverage-fix]/`
- **Branched from main at:** `1af58e4ca`
- **Bundles:** Finding A (P1 coverage bug), Finding B (multi-run control tower UX), Finding C (admin Tailwind drift / absorbs ORCH-1012)
- **External APIs touched:** Gemini 2.5 Flash via `run-place-intelligence-trial` edge fn. Pricing reference: https://ai.google.dev/pricing/gemini-2-5-flash (verified 2026-05-30). COMMS-0003 compliance required.
- **Skill notes:** No Stripe surfaces. No DB migration. No new edge-fn actions strictly required (control tower reuses `list_active_runs`, `run_status`, `cancel_trial`, `start_run`); Finding B's "Run on all" is a pure client-side dispatcher over existing `start_run`.

---

## §1 — Goal (plain English)

Three problems land in one PR for ORCH-1013, all inside `mingla-admin`'s Place Intelligence surface:

1. **Finding A — Stop lying about coverage.** Today the Overview tab tells the operator Cary is 100% covered (0 remaining) when it's actually 99.87% (1 servable place still un-evaluated). The miscount happens because the "evaluated" subquery counts trial-run rows whose place has since drifted out of `is_servable`; the `Math.min(evaluated, servable)` clamp then hides the gap. Fix the count so it only credits trial rows whose place is STILL servable; "remaining" then equals reality.

2. **Finding B — Control tower for parallel city backfills.** When META-ORCH-1009 fires "Run remainder" on 4 cities at once, the operator currently has to click into Trial Results and inspect each run individually. Ship a pinned "Active runs" panel at the top of the Place Intelligence page with one card per in-flight run (progress bar, live ETA, running spend, soft-cancel button), polling every 5s; add a "Run remainder on all un-evaluated cities" header button in Overview that queues every <100% city with a 2s stagger and a 3-concurrent client-side dispatcher cap; replace the existing in-tab active-run banner with the new shared panel.

3. **Finding C — Restore `mingla-admin` build.** `npm run build`, `npm run dev`, and `npx eslint` fail in the main anchor because `node_modules/tailwindcss/dist/lib.mjs` is missing. Root cause is a half-extracted `node_modules/tailwindcss` (only `lib.js` present, `lib.mjs` and 7 other `.mjs` files absent vs. the published 4.2.1 tarball that ships both). Fix is a plain `npm install` (or `npm ci`) — **no** `package.json` or `package-lock.json` change. Absorbs the closed-as-WIP ORCH-1012 ticket.

After this PR ships: coverage tiles tell the truth, parallel backfills are watchable at-a-glance with soft-cancel + bulk-launch, and `mingla-admin` boots clean on a fresh checkout.

---

## §2 — Inputs (file/path inventory per finding)

All paths absolute to worktree root `~/Desktop/mingla-orchs/ORCH-1013-[place-intel-control-tower-coverage-fix]/`.

### Finding A — Coverage math
- `supabase/functions/run-place-intelligence-trial/index.ts`
  - L2196-L2303 — `handleIntelligenceCoverage()` (the buggy query).
  - L2206-L2228 — the 4-parallel-query block; the `completedRes` query at L2216-L2220 is where the bug lives.
  - L2276-L2300 — the per-city row build with the `Math.min(evaluated, servable)` clamp.
- `supabase/functions/run-place-intelligence-trial/__tests__/` — drop the new regression test here (filename below).
- `mingla-admin/src/services/intelligenceCoverageService.js` — **read-only**, no change. The fix is server-side so the contract docstring at L9-L26 stays accurate after the bug is removed.
- `mingla-admin/src/components/placeIntelligenceTrial/IntelligenceOverviewTab.jsx` — **read-only**, no change. Reads the corrected `evaluated_count` / `remaining_count` / `coverage_pct` straight through.
- Live truth (re-probed 2026-05-30 from production DB):
  - Cary: servable=761, evaluated-any-pool-state=766, evaluated-AND-still-servable=760, remaining-currently-servable=1
  - Raleigh: servable=1540, evaluated-any-pool-state=1540, evaluated-AND-still-servable=1540, remaining-currently-servable=0

### Finding B — Control tower + Run-on-all
- `mingla-admin/src/pages/PlaceIntelligenceTrialPage.jsx`
  - L45-L89 — mounts the new `<ActiveRunsControlTower>` ABOVE the tabs.
  - Already has `useState("overview")` for active tab; expose `onSwitchToResults` to the control tower so a cancelled-card "View" button can deep-link.
- `mingla-admin/src/components/placeIntelligenceTrial/IntelligenceOverviewTab.jsx`
  - L55-L394 — add "Run remainder on all <N> un-evaluated cities" button in the SectionCard `action` slot, alongside the existing Refresh button.
  - L87-L103 — `aggregate.remaining` already computed; reuse for the modal's total-cost preview.
- `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx`
  - L697-L769 — DELETE the in-tab active-run banner (it duplicates the new control tower). Keep the cancel + resume affordances by routing them through the control tower instead.
  - L240-L274 — keep the existing per-run poll loop for `cityCoverage` data, but the activeRun banner is gone; the control tower owns its own poll loop.
- `mingla-admin/src/components/placeIntelligenceTrial/CancelRunConfirmModal.jsx` — **read-only**, reused verbatim by the control tower's soft-cancel button.
- `mingla-admin/src/components/placeIntelligenceTrial/RunRemainderConfirmModal.jsx` — **read-only**, no change. Existing modal is per-city; Run-on-all gets a new sibling modal.
- **NEW files** (under `mingla-admin/src/components/placeIntelligenceTrial/`):
  - `ActiveRunsControlTower.jsx` — the panel + per-card sub-component.
  - `ActiveRunCard.jsx` — one card per in-flight run (split for testability).
  - `RunRemainderOnAllConfirmModal.jsx` — bulk-launch confirmation modal.
  - `useActiveRunsPoller.js` — shared hook (5s poll of `list_active_runs` + per-run `run_status` for live counts).
  - `useBulkRunDispatcher.js` — client-side dispatcher (3-concurrent cap, 2s stagger, auto-queue).
- `supabase/functions/run-place-intelligence-trial/index.ts`
  - L2569-L2577 — `handleListActiveRuns()` — confirmed to exist; returns `{ runs: [...] }` of full `place_intelligence_runs` rows in statuses `pending|running|cancelling`. Shape is sufficient (city_id, city_name, mode, total_count, processed_count, succeeded_count, failed_count, cost_so_far_usd, estimated_cost_usd, status, started_at). **No edge-fn change required for Finding B.**
  - L2490-L2528 — `handleRunStatus()` — returns `{ parent, totalPlaces, statusCounts, totalCostUsd, rows }`. Control tower uses `parent` only (counts come straight from `place_intelligence_runs` columns), so per-card payload stays small.
  - L2530-L2563 — `handleCancelTrial()` — exists, behaves async (sets `cancelling`, worker finalizes). Control tower wires its soft-cancel button straight to this.
  - L967-L1232 — `handleStartRun()` — exists with `mode='remainder'`. Run-on-all dispatcher just calls it per-city.

### Finding C — Admin Tailwind drift
- `mingla-admin/package.json` — confirmed `"tailwindcss": "^4.2.1"` + `"@tailwindcss/vite": "^4.2.1"` (correct).
- `mingla-admin/package-lock.json` — confirmed pins `tailwindcss@4.2.1`, `@tailwindcss/node@4.2.1`, `@tailwindcss/oxide@4.2.1` etc (correct).
- `mingla-admin/node_modules/tailwindcss/dist/` — installed copy has 19 files / 1 `.mjs`; published 4.2.1 tarball ships 27 files / 8 `.mjs`. Missing `lib.mjs` (which `@tailwindcss/node@4.2.1/dist/index.mjs` imports) is the proximate cause.
- **No file edits.** Fix is a clean reinstall in the anchor and worktree.

---

## §3 — Contracts per finding

### Finding A — Coverage query fix

#### Root cause (verified)

`handleIntelligenceCoverage` at `index.ts` L2216-L2220 builds the evaluated set from:

```ts
db
  .from("place_intelligence_trial_runs")
  .select("city_id, place_pool_id")
  .eq("status", "completed")
  .not("city_id", "is", null),
```

This counts EVERY completed trial-run row for the city, including places whose `place_pool.is_servable` flipped to `false` after the run (re-classification, geofence shift, vendor drop, etc).

Then L2289 clamps: `evaluated_count: Math.min(evaluated, servable)`. The clamp hides the over-count but does NOT correct the count — it just caps the displayed integer. `remaining_count` at L2290 uses the un-clamped `evaluated`, masking the genuine un-evaluated tail.

Live Cary proves the bug:
- Total completed trial-run rows: 766 (`evaluated_any_pool_state`)
- Of those, still-servable: 760
- Currently servable: 761
- Un-evaluated currently-servable: 1
- **Current Overview output:** `evaluated_count = min(766, 761) = 761`, `remaining_count = max(0, 761 - 766) = 0`, `coverage_pct = min(100, 100.66) = 100` → **WRONG**
- **Correct output:** `evaluated_count = 760`, `remaining_count = 1`, `coverage_pct = 99.9`

#### Fix — server-side, edge fn `handleIntelligenceCoverage`

Replace the `completedRes` query (L2216-L2220) so it only emits `(city_id, place_pool_id)` pairs where the joined `place_pool.is_servable = true`. Supabase JS client doesn't expose `INNER JOIN` filtering directly; use the relationship-filter form `!inner` with the FK alias:

##### Diff (verbatim contract — implementor uses this exact shape)

**File:** `supabase/functions/run-place-intelligence-trial/index.ts`

**Before (L2216-L2220):**
```ts
    db
      .from("place_intelligence_trial_runs")
      .select("city_id, place_pool_id")
      .eq("status", "completed")
      .not("city_id", "is", null),
```

**After:**
```ts
    // ORCH-1013 Finding A — restrict evaluated set to places STILL servable.
    // Without the !inner+is_servable filter, places that drifted out of the
    // pool (e.g. re-classified non-servable post-evaluation) are counted as
    // evaluated, falsely inflating coverage to 100% and zeroing remaining.
    // Verified live 2026-05-30 against Cary: 6 drifted rows masked 1 truly
    // un-evaluated servable place. See SPEC §3 Finding A.
    db
      .from("place_intelligence_trial_runs")
      .select("city_id, place_pool_id, place_pool!inner(is_servable)")
      .eq("status", "completed")
      .eq("place_pool.is_servable", true)
      .not("city_id", "is", null),
```

**Plus** at L2289-L2290 remove the now-redundant clamp + flip `remaining` to use the corrected `evaluated`:

**Before (L2289-L2290):**
```ts
        evaluated_count: Math.min(evaluated, servable),
        remaining_count: Math.max(0, servable - evaluated),
```

**After:**
```ts
        // ORCH-1013 Finding A — `evaluated` is now ≤ `servable` by construction
        // (the JOIN at line ~2218 filters to currently-servable places only).
        // The defensive Math.min/Math.max stays for cosmetic safety (race
        // between the 4 parallel queries could theoretically see a 1-row skew).
        evaluated_count: Math.min(evaluated, servable),
        remaining_count: Math.max(0, servable - evaluated),
```
*(no functional change to L2289-L2290; the comment merely documents that the clamp is now defensive-only. Implementor MAY drop the clamp entirely; reviewer's call.)*

##### Before/After example (Cary, live 2026-05-30)

| Field | Before (current bug) | After (fix) | Truth |
|---|---|---|---|
| servable_count | 761 | 761 | 761 |
| evaluated_count | 761 (clamped from 766) | 760 | 760 |
| remaining_count | 0 (`max(0, 761-766)`) | 1 | 1 |
| coverage_pct | 100.0 | 99.9 | 99.87 |

Raleigh stays at 1540 / 1540 / 0 / 100.0 (no drift; both queries return same number).

##### COMMS-0003 compliance

No external API parameters/payloads changed by Finding A. Gemini docs link already present in the file header + `services/intelligenceCoverageService.js` docstring.

##### Edge-case audit

- **City with 0 servable + N evaluated (city fully decommissioned):** L2299 `.filter((r) => r.servable_count > 0)` already drops the row from the response. No change.
- **Place evaluated multiple times (mode changes):** `evaluatedByCity` is a `Set<place_pool_id>` (L2242-L2251); dedupes correctly both before and after fix.
- **Pending/running rows:** filtered out by `.eq("status", "completed")`; only terminal rows count. No change.
- **Failed/cancelled rows:** also excluded (status='completed' only). Operator sees "remaining" tail that includes ever-failed places — correct per existing semantics; Retry-failed flow handles them separately.
- **No active run + 100% coverage:** still renders 100% / 0 remaining. Run-remainder button stays disabled at L356 (`disabled = row.remaining_count <= 0`).

---

### Finding B — Control tower + Run-on-all + soft-cancel + 3-concurrent dispatcher

#### B.1 Mount point + layout

`mingla-admin/src/pages/PlaceIntelligenceTrialPage.jsx` gains the control tower BETWEEN the page header (L50-L63) and the Tabs row (L65-L86). Sticky behavior is NOT required — the AppShell already handles vertical scroll; the panel renders inline at the top of the scroll region.

```jsx
<div className="py-6 flex flex-col gap-6">
  {/* ... existing header L50-L63 ... */}

  <ActiveRunsControlTower
    onViewRun={(runId) => setActiveTab("results")}  // deep-link to Results tab
  />

  <div>
    <Tabs ... />
    {/* ... existing tab body ... */}
  </div>
</div>
```

#### B.2 `<ActiveRunsControlTower />` contract

**File:** `mingla-admin/src/components/placeIntelligenceTrial/ActiveRunsControlTower.jsx`

```ts
type Props = {
  onViewRun?: (runId: string) => void;
};
```

**Behavior:**
- On mount, opens `useActiveRunsPoller()` (poll interval 5000ms).
- Renders NOTHING when `activeRuns.length === 0` (returns `null`) — including loading state. First poll is fire-and-forget; no spinner.
- When `activeRuns.length ≥ 1`, renders a `<SectionCard>` titled "Active runs (N)" with the cards stacked vertically (gap-2). No subtitle.
- Each card is `<ActiveRunCard run={run} onCancelled={…} onViewRun={onViewRun} />`.
- When a run transitions to terminal (`status ∈ {complete, cancelled, failed}`), the card SHOWS a brief "completed" state for 3000ms with a "Cancelled" / "Done" / "Failed" pill (color matches existing `statusBadgeClasses` in IntelligenceOverviewTab L42-L53), then unmounts via `<AnimatePresence>` (framer-motion `exit={{ opacity: 0, x: 8 }}`, 200ms ease-out).
- When ALL cards unmount, the SectionCard itself unmounts (returns `null`).
- A11y: `<SectionCard>` has `role="region" aria-label="Active intelligence runs"`. Each card's progress bar is `role="progressbar"` with `aria-valuenow/min/max`.

**Polling state machine:**
```
[Idle (no active runs)] --poll--> [Render N cards] --any run terminal--> [Render card in completed state for 3s]
                                                                                              |
                                                                                              v
                                                                                       [Animate out + remove]
                                                                                              |
                                                                                              v
                                                                                       [Re-evaluate; if 0 left → unmount panel]
```

#### B.3 `<ActiveRunCard />` contract

**File:** `mingla-admin/src/components/placeIntelligenceTrial/ActiveRunCard.jsx`

```ts
type Props = {
  run: {
    id: string;
    city_id: string;
    city_name: string;
    mode: 'sample' | 'full_city' | 'remainder' | 'retry_failed';
    status: 'pending' | 'running' | 'cancelling' | 'cancelled' | 'complete' | 'failed';
    total_count: number;
    processed_count: number;
    succeeded_count: number;
    failed_count: number;
    cost_so_far_usd: number | null;
    estimated_cost_usd: number | null;
    started_at: string | null;
    // ORCH-1013-B added — computed client-side, not from DB:
    _liveEtaSeconds?: number | null;       // null when running < 60s (insufficient sample)
    _liveRatePerMin?: number | null;       // for tooltip; ditto
  };
  onCancelled?: (runId: string) => void;   // bubbles up to poller for terminal animation
  onViewRun?: (runId: string) => void;
};
```

**Visual contract (matches DESIGN_ORCH-1008_PHASE_4_INTELLIGENCE_TRIAL_UX.md tokens):**

Card frame: `border border-[var(--color-brand-200)] rounded-lg p-4 bg-[var(--color-brand-50)]` (same as the existing in-tab active-run banner being deleted at TrialResultsTab L703).

Top row: city_name + mode icon (Globe for full_city, Clock for sample, ArrowRight for remainder, RotateCcw for retry_failed) on the left; status pill + count `processed_count / total_count (XX%)` on the right (font-mono tabular-nums).

Progress bar: identical to TrialResultsTab L718-L723 (h-2, brand-500 fill, brand-200 track, 200ms transition).

Live metrics row (text-xs, gap-3, flex-wrap):
- `✓ {succeeded_count}` (success-700)
- `✗ {failed_count}` (error-700)
- `cost: ${cost_so_far_usd.toFixed(4)} of ~${estimated_cost_usd.toFixed(2)}` (text-secondary)
- `ETA: ~{X} min` when `_liveEtaSeconds != null` AND status === 'running'; show `ETA: —` otherwise (text-secondary, ml-auto)

Cross-check line (text-[10px] text-tertiary italic, font-mono):
- `${processed_count} × $0.0040 = ${(processed_count * 0.0040).toFixed(4)} expected · ${cost_so_far_usd.toFixed(4)} actual`
- Mismatch tolerance: `±$0.0010 per place`. If `|actual - expected| > processed_count * 0.0010` AND `processed_count > 10`, append warning icon + tooltip "Cost drift from $0.0040/place baseline > 25% — verify Gemini pricing."

Action row:
- If status === 'running': `<Button variant="ghost" size="sm" icon={X}>Cancel</Button>` (the `X` icon, NOT `Square`, to match the "⊗" semantic in the brief — operator wants visual distinction from the deleted in-tab "Cancel run" banner. Use `lucide-react`'s `X` icon).
- If status === 'cancelling': disabled spinner + text "Cancelling… (~30-90s)".
- If status === 'cancelled' (terminal-with-pill state): show "Cancelled" pill (warning tokens) + "View" button (size sm, ghost, iconRight=ArrowRight) → calls `onViewRun(run.id)`.
- If status === 'complete' (terminal-with-pill state): "Done" pill (success tokens) + "View" button.
- If status === 'failed' (terminal-with-pill state): "Failed" pill (error tokens) + "View" button.

Cancel click → opens `<CancelRunConfirmModal>` (existing component, reuse verbatim; cityName=run.city_name, processedCount=run.processed_count, totalCount=run.total_count). On confirm:
1. POST `{ action: 'cancel_trial', run_id: run.id }` via `invokeWithRefresh`.
2. On success: toast "Cancelling…" (matches existing TrialResultsTab L294-L297 copy). The poller will pick up the new `status='cancelling'` on next tick; no optimistic update.
3. On error: toast "Couldn't cancel" with extracted message; modal stays open with retry.

#### B.4 `useActiveRunsPoller()` contract

**File:** `mingla-admin/src/components/placeIntelligenceTrial/useActiveRunsPoller.js`

```ts
function useActiveRunsPoller(): {
  activeRuns: ActiveRun[];
  terminalRuns: ActiveRun[];    // runs in the 3-second "show-then-fade" state
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}
```

**Behavior:**
- On mount, fires first `list_active_runs` immediately, then every `POLL_INTERVAL_MS = 5000`.
- On EACH poll:
  1. Call `{ action: 'list_active_runs' }` → returns runs with `status ∈ {pending, running, cancelling}`.
  2. For each run currently in `activeRuns` whose ID is NO LONGER in the new list AND whose previous status was `running`/`cancelling`, fetch its terminal state via `{ action: 'run_status', run_id }` once, and stage it in `terminalRuns` with a 3000ms TTL.
  3. For each run still active, optionally fetch `run_status` for the freshest counts (alternative: just use the `place_intelligence_runs` row fields returned by `list_active_runs` which already has `processed_count`/`succeeded_count`/`failed_count`/`cost_so_far_usd` — this is enough, **do not** call `run_status` on every tick to keep edge-fn load minimal).
- **Live ETA calculation** (client-only, no DB write):
  - Maintain a ring buffer per `run.id`: `[(timestamp, processed_count), ...]` keyed by run, capped at 12 entries (60s at 5s poll).
  - On each tick: if buffer has ≥ 2 entries AND elapsed between first+last ≥ 30s, compute `ratePerSec = (last.processed - first.processed) / (last.ts - first.ts)`.
  - If `ratePerSec > 0`, `_liveEtaSeconds = (run.total_count - run.processed_count) / ratePerSec`; else `_liveEtaSeconds = null`.
  - If `ratePerSec ≤ 0` (run stalled), `_liveEtaSeconds = null`; card displays "ETA: —".
  - On unmount/run-removal: drop the run's buffer.
- **Tab visibility:** when `document.visibilityState === 'hidden'`, pause polling (`clearInterval`). On 'visible', resume with an immediate tick. (Prevents background-tab waste and accidental ETA distortion from polls firing slowly under throttling.)
- **Operator closes tab mid-run:** polling stops. Cancellation is server-side durable (`cancel_trial` sets `status='cancelling'` in DB; worker finalizes on next chunk). On next open, control tower hydrates from `list_active_runs` and resumes display. No loss.
- **Operator closes tab mid-cancel:** identical to above — cancellation already requested, server completes it; on next open the run shows up in `complete` status grouping (in Results tab) and NOT in the control tower (already terminal).
- **Auth refresh / network error:** silent retry on next tick; set `error` state only after 3 consecutive failures, and surface a small inline "Couldn't refresh active runs (retrying)" pill under the SectionCard title.

#### B.5 `<RunRemainderOnAllConfirmModal />` contract

**File:** `mingla-admin/src/components/placeIntelligenceTrial/RunRemainderOnAllConfirmModal.jsx`

```ts
type Props = {
  open: boolean;
  onClose: () => void;
  candidateCities: Array<{
    city_id: string;
    city_name: string;
    remaining_count: number;
  }>;     // only cities with remaining_count > 0
  perPlaceCostUsd?: number;  // default 0.0040
  onConfirm: (cities: Array<{ city_id, city_name, remaining_count }>) => void;
};
```

**Behavior:**
- Renders nothing when `!open`.
- Title: `Run remainder on {N} un-evaluated cit{N === 1 ? 'y' : 'ies'}`.
- Body lists each candidate as a row: `{city_name} — {remaining_count.toLocaleString()} places — ~${(remaining_count * 0.0040).toFixed(2)}` (font-mono tabular-nums for numbers).
- Below the list, totals box (same visual idiom as RunRemainderConfirmModal cost-breakdown box L167-L191):
  - "Total places: {sumRemaining.toLocaleString()}"
  - "Total est. cost: ~${(sumRemaining * 0.0040).toFixed(2)}"
  - Pricing-source link to https://ai.google.dev/pricing/gemini-2-5-flash (verified 2026-05-30, COMMS-0003).
- Acknowledgement checkbox: "I understand this will charge ~${totalCost} on the Gemini API."
- High-cost gate (mirrors RunRemainderConfirmModal):
  - `totalCost > $10` → additionally require typed `RUN ALL` confirmation (NOT a city name — there are multiple cities; use a fixed phrase).
  - `totalCost > $5` → modal still requires the checkbox; per-city `start_run` call will include `confirm_high_cost: true` for each city whose individual estimate exceeds $5.
- Confirm button: disabled until checkbox + typed-confirm (if shown) pass. On click, calls `onConfirm(candidateCities)` and closes.
- "Concurrent runs" disclosure line in modal footer: "Up to 3 cities will run at a time. Remaining cities queue automatically and start as slots free up."

#### B.6 `useBulkRunDispatcher()` contract (3-concurrent client-side cap)

**File:** `mingla-admin/src/components/placeIntelligenceTrial/useBulkRunDispatcher.js`

```ts
type BulkRunStatus = 'pending' | 'starting' | 'running' | 'complete' | 'failed' | 'skipped_concurrent';

type DispatcherState = {
  queue: Array<{
    city_id: string;
    city_name: string;
    remaining_count: number;
    status: BulkRunStatus;
    run_id?: string;       // set after start_run succeeds
    error?: string;        // set on start_run failure
    started_at?: number;   // Date.now() at dispatch
  }>;
  inFlight: number;         // count of status === 'starting' | 'running'
};

function useBulkRunDispatcher(): {
  state: DispatcherState;
  enqueue: (cities: Array<{ city_id, city_name, remaining_count }>) => void;
  cancelAll: () => void;    // sets all 'pending' to 'skipped_concurrent'; does NOT cancel in-flight runs (those use control tower's per-card cancel)
};
```

**State machine (per city):**
```
pending
   │
   │ (slot available: inFlight < 3) AND (≥2s elapsed since prior start in this batch)
   ▼
starting  ── start_run POST in flight
   │
   ├─ 200 OK ──▶ running   (run_id captured; control tower picks it up on next poll)
   │
   ├─ 409 concurrent_run ──▶ skipped_concurrent (server says city already has active run)
   │
   └─ 500/network ──▶ failed (error captured; toast surfaces "city X failed to start")

running
   │
   │ (poll of list_active_runs no longer includes this run_id)
   ▼
complete (or failed/cancelled — dispatcher does not distinguish; control tower owns terminal UX)
```

**Invariants:**
- `inFlight ≤ 3` AT ALL TIMES (hard client-side cap). Server's per-city unique-partial-index handles the per-city guard; this cap is operator-experience only.
- Between consecutive `starting` transitions: minimum 2000ms gap (the brief's "2s stagger").
- The dispatcher does NOT cancel in-flight runs on tab close. If operator wants to cancel, they use per-card cancel in the control tower (which is server-durable).
- After `enqueue()`, the dispatcher is fire-and-forget; the hook keeps running until all `pending` are drained or `cancelAll()` is called.

**Tick logic** (runs every 500ms while any city is `pending`):
```js
const now = Date.now();
const lastStartAt = Math.max(...state.queue.filter(c => c.started_at).map(c => c.started_at), 0);
const canStartNext = (now - lastStartAt) >= 2000 && state.inFlight < 3;
if (canStartNext) {
  const next = state.queue.find(c => c.status === 'pending');
  if (next) startCity(next);
}
```

**Tab-close behavior:**
- `pending` cities: lost (no server-side queue). Operator must re-fire bulk-launch when they reopen. **Decision §7-D2:** acceptable trade-off — server-side queueing would require new tables + cron + a much larger SPEC; META-ORCH-1009 acceptably covers ≤8 cities which fit comfortably in one operator session.
- `running` cities: continue server-side (durable). On reopen, control tower hydrates them.

#### B.7 "Run remainder on all" header button (Overview tab)

`mingla-admin/src/components/placeIntelligenceTrial/IntelligenceOverviewTab.jsx`

Add to the `<SectionCard>` `action` slot at L210-L221, BEFORE the Refresh button:

```jsx
<Button
  size="sm"
  variant="secondary"
  icon={Play}
  onClick={() => setBulkModalOpen(true)}
  disabled={loading || candidateCities.length === 0}
  title={
    candidateCities.length === 0
      ? "All cities are fully evaluated"
      : `Run remainder on ${candidateCities.length} un-evaluated cit${candidateCities.length === 1 ? 'y' : 'ies'}`
  }
>
  Run remainder on all{candidateCities.length > 0 ? ` (${candidateCities.length})` : ""}
</Button>
```

Where `candidateCities = useMemo(() => rows.filter((r) => r.remaining_count > 0), [rows])`.

On confirm in `<RunRemainderOnAllConfirmModal>`, call `dispatcher.enqueue(candidateCities)` and close the modal. Toast: `"Bulk remainder queued — {N} cities, ~${totalCost.toFixed(2)} total."`

The dispatcher state and per-city errors are surfaced via:
1. The control tower picks up each new `run_id` on its next 5s poll (no special UI needed — runs just appear).
2. For cities that 409-skipped or 500-failed, fire a `addToast({ variant: 'warning', title: 'Couldn't start {city_name}', description: error })` per city.

#### B.8 TrialResultsTab — banner deletion contract

DELETE the entire `{activeRun && !bannerDismissed && (...)}` block at TrialResultsTab L702-L769.

Also DELETE:
- `bannerDismissed` state (L103) and its reset effect (L244-L246).
- `cancelModalOpen` state (L98), `cancelLoading` state (L99), `handleCancelActiveRunConfirmed` (L278-L304).
- `handleResumeFromN` (L320-L327) — superseded by control tower's `onCancelled` → "Resume" affordance shown ONLY in the control tower's per-card "cancelled" terminal state. (DEFER on the actual resume affordance — out-of-scope for this PR; operator re-runs remainder from Overview tab. See §6.)
- The `<CancelRunConfirmModal>` mount at L1128-L1136.
- The `Square` icon import on L18 IF no longer used after the `handleCancel` (sample mode) and active-run banner are deleted. (Keep `Square` if `handleCancel` at L566-L569 still references it; check use-by-use.)

KEEP:
- The cross-session hydration effect at L218-L238 — it sets `activeRunId`/`activeRun` for the SAMPLE-mode browser-loop only. Wait — re-reading: this effect picks up any active run including remainder/full_city. Its outputs (`activeRunId`, `activeRun`) drove the deleted banner. **Decision §7-D3:** delete this effect too; the control tower hydrates active runs independently. Sample-mode browser-loop uses `progress` state (L77), not `activeRun`.
- The `cityCoverage` poll at L184-L186 — still used by the Trial Results tab's per-city scored coverage tile (L984-L1057).
- `handleRetryFailedPlaces` (L571-L636) — unrelated, untouched.
- The mode toggle (L771-L834) and Run trial button (L898-L913) — unchanged.

After deletion: the activeRunId state stays for sample-mode loop interaction (`disabled={!!activeRunId}` at L848, L887, etc — currently prevents starting a new run while one is active). Hydration removal means TrialResultsTab no longer knows about active remainder/full_city runs at all; the `!activeRunId` gates on lines 665-670, 848, 887 will always be true (no active run from this tab's POV). **Decision §7-D4:** that's correct — operator can fire a SAMPLE from the Trial Results tab even if a full-city is running elsewhere (server's per-city unique constraint still enforces single-active-per-city). The "Already a run in progress" warning at L969-L973 becomes dead and is deleted with the banner block.

The `<RunRemainderConfirmModal>` at L1137-L1162 STAYS — it's still used by the Trial Results mode toggle's "Remainder only" path.

---

### Finding C — Admin Tailwind drift fix

#### Diagnosis (verified 2026-05-30 on main anchor)

`cd ~/Desktop/mingla-main/mingla-admin && npm run build` exits 1 with:
```
failed to load config from /Users/sethogieva/Desktop/mingla-main/mingla-admin/vite.config.js
error during build:
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/sethogieva/Desktop/mingla-main/mingla-admin/node_modules/tailwindcss/dist/lib.mjs' imported from /Users/sethogieva/Desktop/mingla-main/mingla-admin/node_modules/@tailwindcss/node/dist/index.mjs
Did you mean to import "tailwindcss/dist/lib.js"?
```

**Root cause:** `node_modules/tailwindcss/dist/` in the anchor is **partially extracted**:
- Installed: 19 files, 1 `.mjs` (only `flatten-color-palette.mjs`).
- Published `tailwindcss@4.2.1` tarball: 27 files, 8 `.mjs` (including `lib.mjs`, `index.mjs`, plugin.mjs etc).
- The missing `lib.mjs` is precisely what `@tailwindcss/node@4.2.1/dist/index.mjs` imports.

**Package.json + lockfile are correct:** `"tailwindcss": "^4.2.1"` in package.json, `tailwindcss@4.2.1` pinned in package-lock.json. Worktree's `node_modules/tailwindcss` (symlinked from anchor) inherits the same broken install.

**Not a version mismatch. Not a Tailwind v4 breaking change. Not a peer-dep conflict.** Just a torn install — likely from a prior interrupted `npm install` or a `git clean` that nuked partial files. `package-lock.json` integrity hash check (npm 9+) doesn't validate physical file presence post-install.

#### Fix — operator-approval-free reinstall

```bash
cd ~/Desktop/mingla-main/mingla-admin
rm -rf node_modules
npm ci
```

OR (safer if any local-only deps exist, none observed):
```bash
cd ~/Desktop/mingla-main/mingla-admin
rm -rf node_modules/tailwindcss node_modules/@tailwindcss
npm install
```

**Cited operator-approval guard:** per `feedback_autonomy_posture_verifier_not_manager.md`, reinstalls of existing dependencies are autonomy-safe. NO `package.json` edit, NO `package-lock.json` change, NO new dependency. **No operator approval needed.** Implementor runs the reinstall, verifies `npm run build` exits 0, and includes the reinstall in the PR's repro steps (no commit produced).

**Why no lockfile bump:** lockfile already pins the correct version (4.2.1). The published tarball is intact (verified via `npm pack tailwindcss@4.2.1` — ships `lib.mjs`). A `npm install` re-downloads + re-extracts from the cached/remote tarball, restoring the missing files.

**Why no version pin change:** the bug is NOT in Tailwind 4.2.1. Bumping wouldn't help and would introduce risk surface (4.3.0 has different `lightningcss` and `enhanced-resolve` ranges).

**Why no config migration:** no Tailwind config file at all in `mingla-admin` (Tailwind v4 uses `@tailwindcss/vite` + CSS-first config). Nothing to migrate.

#### Worktree implication

The ORCH-1013 worktree's `node_modules/tailwindcss` is symlinked from the anchor. After the anchor reinstall, the worktree's symlinks auto-resolve to the freshly-extracted files. No worktree-side action.

#### Implementor verification steps (Finding C acceptance)

```bash
# 1. Reinstall in anchor
cd ~/Desktop/mingla-main/mingla-admin && rm -rf node_modules && npm ci

# 2. Verify file presence
ls node_modules/tailwindcss/dist/lib.mjs   # must exist
ls node_modules/tailwindcss/dist/ | wc -l  # must be 27 (matches published)

# 3. Build passes
npm run build                              # exit 0
npm run dev &
sleep 5; curl -fsSI http://localhost:5173 | head -1
kill %1
```

If `npm ci` fails with EINTEGRITY or similar lockfile-state error: that escalates to operator (would imply a real lockfile bump is needed). On the verified 2026-05-30 state, the package.json + lockfile are internally consistent, so `npm ci` is expected to succeed cleanly.

---

## §4 — Success criteria + acceptance tests per finding

### Finding A — Coverage truth

**Test 1 — Regression (Cary drift scenario), edge-fn unit test**

**File:** `supabase/functions/run-place-intelligence-trial/__tests__/handleIntelligenceCoverage.drift.test.ts` (new)

Uses Deno test runner (matches existing tests in the dir). Fixture:
- 1 seeded city (Cary) with 761 servable + 6 non-servable place_pool rows.
- 766 `place_intelligence_trial_runs` rows with `status='completed'`: 760 reference still-servable places, 6 reference rows whose `place_pool.is_servable` is `false`.
- Stub `SupabaseClient` returning those rows from the 4 parallel queries.

**Assertions:**
- Returned row for Cary has `servable_count: 761`, `evaluated_count: 760`, `remaining_count: 1`, `coverage_pct: 99.9`.
- (BEFORE-fix sanity check — optional: add a `// @ts-expect-error` snapshot of the pre-fix output `evaluated_count: 761, remaining_count: 0, coverage_pct: 100` so a regression future-bumps the snapshot.)

**Test 2 — Raleigh genuinely-100% case**

Same harness, fixture 1540/1540 with zero drift. Assertions: `evaluated_count: 1540`, `remaining_count: 0`, `coverage_pct: 100.0`.

**Test 3 — Live-DB smoke (manual, captured in PR description)**

After deploy:
```bash
curl -X POST https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/run-place-intelligence-trial \
  -H "Authorization: Bearer <admin token>" \
  -H "Content-Type: application/json" \
  -d '{"action":"intelligence_coverage"}' | jq '.rows[] | select(.city_name == "Cary")'
```
Expected: `evaluated_count: 760, remaining_count: 1, coverage_pct: 99.9` (or current-as-of-deploy truth via the §3 Finding A SQL probe).

### Finding B — Control tower behaviors

**Test 4 — Control tower mount/unmount on run state change**

`mingla-admin/src/components/placeIntelligenceTrial/__tests__/ActiveRunsControlTower.test.jsx` (new; vitest + RTL).

- Mock `useActiveRunsPoller` to return `activeRuns: []` initially → assert panel renders `null`.
- Update mock to return 1 running run → assert SectionCard renders with title "Active runs (1)" + 1 card.
- Update mock to remove that run + add to `terminalRuns` with status='complete' → assert card still rendered with "Done" pill.
- Advance 3000ms (vitest fake timers) → assert card removed via AnimatePresence.

**Test 5 — Run-on-all dispatcher correctness**

`mingla-admin/src/components/placeIntelligenceTrial/__tests__/useBulkRunDispatcher.test.js` (new).

- `enqueue([{city_id:'a',...}, {city_id:'b',...}, {city_id:'c',...}, {city_id:'d',...}])`.
- Mock `start_run` to resolve after 100ms with `{runId: ...}`.
- Use vitest fake timers; tick through dispatcher.
- Assert:
  - At t=0ms: `inFlight=0`. At t=500ms (first tick): city 'a' transitions to `starting` (only one — 2s stagger doesn't apply to first start).
  - Wait, stagger contract says "min 2s gap BETWEEN consecutive `starting` transitions." First start at t=500ms; second start blocked until t=2500ms.
  - At t=2500ms: city 'b' starts (inFlight now 2).
  - At t=4500ms: city 'c' starts (inFlight=3, AT cap).
  - At t=6500ms: city 'd' WOULD start but inFlight===3 → blocked. Verify city 'd' stays `pending`.
  - Simulate city 'a' completing (remove from `list_active_runs` mock) → poller reports inFlight=2 → next tick (within 500ms) city 'd' starts.
- Assert hard cap: at no point during ticks does `inFlight` exceed 3.

**Test 6 — 409 concurrent_run handling**

Mock `start_run` for city 'b' to return 409 → assert `state.queue[1].status === 'skipped_concurrent'` and the toast was emitted with city_name + error.

**Test 7 — Soft-cancel state machine**

`mingla-admin/src/components/placeIntelligenceTrial/__tests__/ActiveRunCard.test.jsx` (new).

- Render card with `run.status='running'`.
- Click ⊗ Cancel → assert `<CancelRunConfirmModal>` opens (visible).
- Click "Cancel run" in modal → assert POST to `cancel_trial` fires with `run_id`.
- Mock 200 response → assert toast "Cancelling…" fires + modal closes.
- Re-render card with `run.status='cancelling'` → assert button replaced with spinner + "Cancelling… (~30-90s)" text.
- Re-render with `run.status='cancelled'` (terminal pill state) → assert "Cancelled" pill + "View" button render.

**Test 8 — Live ETA suppression < 60s**

In `useActiveRunsPoller` test, simulate buffer with single entry → assert `_liveEtaSeconds === null` → card shows "ETA: —". After 30s buffer with positive rate → assert `_liveEtaSeconds > 0` and card shows e.g. "ETA: ~14 min".

**Test 9 — Manual smoke (operator-driven, captured in PR description)**

1. Open Place Intel page → no runs → control tower hidden.
2. Click "Run remainder" on Cary (1 place remaining post-Finding-A-fix) → control tower appears with Cary card.
3. Fire `start_run` on Raleigh in another tab → after ≤5s, Raleigh card appears alongside Cary.
4. Click Cary's ⊗ → modal opens → Confirm → modal closes, toast "Cancelling…", card shows "Cancelling… (~30-90s)".
5. Wait for cancel finalization → card shows "Cancelled" pill for 3s, slides out.
6. Raleigh's card stays visible with live ETA + cost cross-check.
7. Click "Run remainder on all" header button → modal lists candidate cities → confirm → up to 3 cities start with 2s stagger; 4th queues.

### Finding C — Build restored

**Test 10 — Build passes (anchor)**

```bash
cd ~/Desktop/mingla-main/mingla-admin
rm -rf node_modules && npm ci
npm run build
echo $?   # must be 0
```

**Test 11 — Dev server boots (anchor)**

```bash
cd ~/Desktop/mingla-main/mingla-admin
npm run dev &
sleep 8
curl -fsSI http://localhost:5173 | head -1  # expect 200 OK
kill %1
```

**Test 12 — ESLint runs**

```bash
cd ~/Desktop/mingla-main/mingla-admin
npx eslint src --max-warnings=999    # must exit 0 (warnings ok, errors not)
```

**Test 13 — Worktree inherits fix (symlink resolution)**

```bash
cd "~/Desktop/mingla-orchs/ORCH-1013-[place-intel-control-tower-coverage-fix]/mingla-admin"
npm run build
echo $?   # must be 0
```

All Finding-C tests are mechanical and require no manual judgment. The implementor runs them and pastes output into the PR description.

---

## §5 — Invariants (new + amended)

### New (DRAFT — flip ACTIVE on ORCH-1013 CLOSE)

- **`I-PROPOSED-INTEL-COVERAGE-COUNTS-CURRENTLY-SERVABLE`** — `handleIntelligenceCoverage` MUST only count `(city_id, place_pool_id)` evaluation pairs where `place_pool.is_servable = true` at query time. Specifically: the `completedRes` subquery at `supabase/functions/run-place-intelligence-trial/index.ts` ~L2216-L2220 MUST include `.select("city_id, place_pool_id, place_pool!inner(is_servable)").eq("place_pool.is_servable", true)`. Strict-grep gate: assert this exact substring in CI.

- **`I-PROPOSED-INTEL-BULK-DISPATCHER-CAP-3`** — `useBulkRunDispatcher` MUST never let `inFlight` exceed 3. Backed by `useBulkRunDispatcher.test.js` Test 5.

- **`I-PROPOSED-INTEL-BULK-DISPATCHER-STAGGER-2S`** — `useBulkRunDispatcher` MUST enforce ≥ 2000ms between consecutive `starting` transitions. Backed by Test 5.

- **`I-PROPOSED-INTEL-CONTROL-TOWER-VISIBILITY-GATE`** — `<ActiveRunsControlTower />` MUST return `null` when both `activeRuns.length === 0` AND `terminalRuns.length === 0`. No empty card frame.

### Amended (no change to wording, but Finding B affects practice)

- **`I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING`** (existing, ORCH-0734) — unchanged. Control tower + bulk dispatcher are pure observability/operational; no consumer-ranking surface touched.

### Operator-facing
- No COMMS-ledger entry needed for Finding A (server-side bug, no contract change).
- COMMS-0003 already satisfied by existing Gemini pricing citations; new bulk modal MUST also cite the URL (contract §3.B.5).

---

## §6 — Out of scope

Explicitly NOT in this PR:

1. **META-ORCH-1009 consumer-deck code** — this PR ships ONLY admin-side coverage truth + control-tower UX + admin build restore. Whatever feeds card-ranking from `place_pool` / `place_scores` is untouched.
2. **app-mobile** — no React Native changes. No expo update required.
3. **mingla-business** — no business-app changes.
4. **Server-side run queue** — `useBulkRunDispatcher` is client-only. If operator closes tab with `pending` cities, those are lost (per §3.B.6 decision). A future ORCH could promote queueing to the edge fn + a new `intelligence_run_queue` table, but that's a larger architectural shift gated on operator demand.
5. **"Resume from N" affordance** — the deleted active-run banner had a "Resume from place N+1" button (TrialResultsTab L320-L327, L751-L760). Control tower's "View" button on a cancelled card deep-links to Results tab, where the operator manually re-fires the remainder mode. The dedicated Resume button is **deferred** — operator can use Run-on-all (or per-city Run remainder) from the Overview tab which is equivalent in effect.
6. **Cost-drift > 25% diagnostics** — the warning icon in §3.B.3 is an INDICATOR only. No telemetry, no Sentry, no alert. If operator sees it repeatedly, that's the trigger for a separate forensic ORCH on Gemini pricing.
7. **A new `run_state_changed` realtime channel** — the 5s poll is sufficient per the brief. Supabase Realtime + channel auth would be a larger ORCH.
8. **Tailwind config migration to v4 CSS-first** — `mingla-admin` is already on `@tailwindcss/vite` (CSS-first); no migration is needed or in scope.
9. **`mingla-admin` ESLint rule changes** — Test 12 only verifies eslint runs to completion; existing warning counts are not adjusted in this PR.

---

## §7 — Decisions (judgment calls + why)

### D1 — Server-side fix for Finding A (not client-side workaround)

The brief lists two options: (a) fix the JS service file, OR (b) fix the edge fn SQL. **Decision: fix the edge fn.** Reasons:
- The bug is in the data layer; a client-side filter would re-query `place_pool` from the browser just to second-guess the server, doubling the load.
- The edge fn already does the 4 parallel queries server-side; adding `!inner` is a 1-line join hint, not a new query.
- Tests can run via Deno (matches existing test pattern in `__tests__/`) without a Supabase client mock at all (just the response shape).

### D2 — Client-side bulk dispatcher (not server-side queue)

The brief explicitly says "enforced CLIENT-SIDE by the dispatcher (server's per-city guard handles the rest)." Decision honored. Trade-off: tab-close loses `pending` cities. Mitigation: operator can re-fire; expected use case is one bulk launch then operator watches the control tower for 5-60 min until cities complete.

### D3 — Delete TrialResultsTab cross-session hydration effect (L218-L238)

Originally added in ORCH-0737 so that reopening Trial Results would show the in-progress full-city banner. With the banner deleted (replaced by the Place-Intel-page-level control tower), this effect orphans `activeRunId`/`activeRun` state with no UI consumer. Cleanest: delete the effect AND the unused state. Sample-mode `progress` state at L77 is unaffected.

### D4 — Sample-mode "blocked while active run" semantics relax

Pre-PR: TrialResultsTab disables city picker + Run button if ANY active run exists (`!!activeRunId` checks at L848, L887, L665-L670). Post-PR: TrialResultsTab no longer knows about active runs, so a sample can be fired even while another city's full_city run is in flight. Server's per-city unique-partial-index still prevents starting a SECOND run on the SAME city (409 concurrent_run). For DIFFERENT cities, this is operationally desirable — operator can sample-test City B while Cary's remainder finishes. **Risk:** edge-fn worker pool / Gemini rate-limit pressure under heavy parallelism. Mitigation: paid Gemini tier 1 has effectively unbounded RPM per ORCH-0734 docstring; 3-concurrent cap on bulk dispatcher + 1 manual sample = 4 max concurrent invocations, well within budget.

### D5 — `lucide-react` icon for soft-cancel: `X`, not `Square`

The deleted banner uses `Square` for "Cancel run". The brief's "⊗" notation suggests `X` (cross/circle) over `Square` (stop). Decision: use `X` for control tower per-card cancel to visually distinguish from the deleted in-tab "Square" button + match the "soft" semantic. `Square` stays in TrialResultsTab for the sample-mode browser-loop "Cancel" (L910-L912) — that's a hard immediate-stop, not a soft async cancel.

### D6 — Run-on-all typed confirm = fixed phrase `"RUN ALL"`, not city names

RunRemainderConfirmModal at >$10 requires typing the city name. With Run-on-all, multiple city names are involved; typing all of them is hostile UX. Fixed phrase `"RUN ALL"` is a strong-enough friction gate at the >$10 threshold without being unusable. (If operator pushes back on this, escalate to mingla-designer in a follow-up.)

### D7 — Cost-drift tolerance: ±$0.0010 per place, 10-place minimum

Per-place cost is $0.0040; ±25% drift threshold ($0.0010) catches significant pricing changes without false-firing on rounding noise. Suppress under 10 places to avoid noise on tiny runs. This is purely visual; no action taken on the value.

### D8 — Finding C reinstall scope: full `node_modules` wipe vs targeted `tailwindcss` remove

The brief allows either. Recommended: `rm -rf node_modules && npm ci` for safety (catches any other torn install). If operator hits a slow re-install (mingla-admin has many deps), implementor MAY fall back to the targeted `rm -rf node_modules/tailwindcss node_modules/@tailwindcss && npm install`. Both leave package-lock.json untouched; both produce the same final state.

### D9 — Coverage clamp Math.min/Math.max retained as defensive (not removed)

After Finding A fix, `evaluated ≤ servable` by JOIN construction. The clamp is therefore mathematically redundant. **Kept as defensive** because the 4 parallel queries (L2206-L2228) are not transactional; a write to `place_pool` between the `servableRes` and `completedRes` queries could create a 1-row skew. The clamp prevents a transient display glitch. Cost: 0. Worth: small but real. (Implementor MAY drop in a follow-up; reviewer's call.)

### D10 — Items flagged for operator review

**Operator approval NEEDED:** NONE for this SPEC. Finding C's reinstall is autonomy-safe (no dep change). Finding B introduces new files but no new packages.

**Operator visibility NICE-TO-HAVE:**
- META-ORCH-1009 implications: control tower's 5s poll across 8 cities = ~96 edge-fn invocations/minute. Within Supabase free-tier (500K/month = ~11K/min); not a concern.
- Bulk dispatcher tab-close loses pending — operator should know.
- D5 icon choice — purely cosmetic; can roll back if operator dislikes.

---

## §A — Spec completeness self-check (gate per `feedback_forensics_depth_and_spec_granularity.md`)

| Clause | Status |
|---|---|
| 1. Goal in plain English | §1 |
| 2. Every file path verified to exist (Read tool, not guessed) | §2 — IntelligenceOverviewTab, TrialResultsTab, RunRemainderConfirmModal, CancelRunConfirmModal, intelligenceCoverageService, PlaceIntelligenceTrialPage, index.ts all read; line ranges verified |
| 3. External API URLs cited inline | §3.B.5 (Gemini pricing), §3.A (Finding A does not introduce new API surface; existing header citations stand) |
| 4. Each contract has function signatures + behavior | §3.B.2-B.7 |
| 5. Acceptance tests per finding | §4 Tests 1-13 |
| 6. Invariants declared with grep targets | §5 (4 new DRAFTs) |
| 7. Out-of-scope explicit | §6 (9 items) |
| 8. Decisions enumerated with WHY | §7 (10 decisions) |
| 9. Live-data probe used to verify before/after | §3.A Cary numbers re-probed 2026-05-30 |
| 10. No code changes attempted | Pure SPEC document |

SPEC complete and ready for implementor dispatch.
