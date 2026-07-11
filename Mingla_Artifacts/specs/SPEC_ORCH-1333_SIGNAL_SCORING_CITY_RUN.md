# SPEC — ORCH-1333 [signal-scoring-city-run]: bounded, incremental, resumable whole-city scoring

- **Phase:** SPEC (build contract — NO product code here).
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1331-[signal-scoring-city-run]/` (dir name cosmetically says 1331) on branch **`ORCH-1333-signal-scoring-city-run`** (rebased onto `origin/main`, up to date incl. #816).
- **Investigation:** `Mingla_Artifacts/investigations/INVESTIGATION_ORCH-1333_SIGNAL_SCORING_CITY_RUN.md` (authoritative; references renumbered 1331→1333).
- **Comms ledger:** read on entry; no `BLOCK`/`WARN`+`OPEN` row is addressed to `mingla-forensics`, `ORCH-1333`, `ORCH-1331`, or `ALL` requiring action (COMMS-0087 CI-TS-pin WARN is RESOLVED; COMMS-0052 business-OTA BLOCK is irrelevant to this backend/admin change).
- **Chosen fix:** **cursor-loop (ORCH-1018 Bouncer precedent)** — each `run-signal-scorer` invocation processes ONE bounded page and does sticky-pre-read + UPSERT + veto-delete **for that page only**, returning `{ next_cursor, done, remaining, running totals }`; the admin client loops until `done`, mirroring `BouncerStep`. Justification in §2.

---

## 1. Executive summary

**Plain English:** Today, clicking "Run scorer" for a big city that only became scorable after 2026-05-30 (New York, Paris) finishes but saves **zero** scores. The scorer tries to score the *entire* city in one server call: it reads all ~9,900 places into memory, then — only after the whole read — runs an admin-pin safety check across all ~8,400 place-ids, then writes everything at once. For large post-Sub-B cities that one giant call trips the edge function's fail-safe and returns an error **before any write lands**, so the city stays empty while the button still looks "done."

**The fix:** rebuild the city / all-cities scoring path to work the way the Bouncer already works (ORCH-1018): the server scores **one page (500 places)** per call — sticky-check, write, and veto-delete **just that page** — then hands the admin browser a cursor to fetch the next page. The browser loops the call until the server says `done`. This bounds the work per call, bounds the admin-pin safety check to one page, and — critically — **persists each page as it goes**, so a failure on page 12 can never wipe pages 1-11 (today's abort-all footgun is gone). Plus a cheap UI fix so the "Scored" counter actually refreshes when a run completes, and an operational backfill to fill NY + Paris once shipped.

**Root cause being fixed (from the sealed investigation, F-1…F-5):** the whole-city *accumulate-then-verify-then-write-all-at-once* shape does too much per invocation and aborts the entire run on any pre-UPSERT error. The sticky pre-read (ORCH-1066) is a fail-close `return 500` (`index.ts` L315-321) that fires after the full-city read, before the first UPSERT.

---

## 2. Scope & non-goals

### In scope
1. **Primary fix** — make `run-signal-scorer` city / all_cities scoring **bounded, incremental, and resumable** via a cursor-loop (per-page sticky + UPSERT + veto), with a matching admin client loop. Per-place mode routes through the same page engine but still finishes in ONE invocation (preserves the 15-min cron + approval re-score callers unchanged).
2. **Defect A (F-6)** — wire the admin Signal Library scorer/Bouncer `onComplete` handlers to ALSO refresh `CityPipelineHistory` (the "Scored" column), not only `TopPlacesPreview`.
3. **Backfill** — operational runbook to score New York + Paris to full coverage post-deploy, plus a sweep query for any other post-2026-05-30 large city in the same state.
4. **Regression guard** — a behavioral, CI-executed, fails-on-revert test proving a large write-set run persists incrementally and does NOT abort-all when the sticky pre-read fails mid-run; DRAFT invariant `I-PROPOSED-1333-SCORER-CITY-RUN-INCREMENTAL-PERSIST`.

### Non-goals (explicitly OUT — do not build here)
- **D-1** consumer supply gap: NY/Paris have ~0 ranked venue supply in the consumer deck. Product/growth impact; separate future ORCH. (The backfill in §4.C will *incidentally* start filling it, but productizing that is out of scope.)
- **D-2** quarterly `all_cities` backstop (`tg_meta_orch_1009_sub_d_quarterly_sweep`) hitting the same wall. It shares the fixed path automatically once this ships (all_cities routes through the same engine), but any NEW quarterly-sweep behavior/scheduling change is a separate ORCH.
- **No change** to `_shared/signalScorer.ts` `computeScore` logic (eligibility gate, AI blend, `inappropriate_for` veto, business-hero boost, prompt-version discrimination). The scoring math is correct and untouched.
- **No change** to the 15-min rescore cron migration, the approval re-score loop in `admin-review-venue-claim`, or `admin_city_pipeline_status()` RPC.
- **No migration, no edge deploy, no `db push`** authored in this SPEC (orchestrator deploys the edge fn at CLOSE).

### Assumptions
- `place_pool.id` is a stable, unique, id-orderable key (it is; the existing paging already `.order('id')`s and the Bouncer cursors on it).
- Per-invocation page size 500 keeps the sticky pre-read to ≤ 1 chunked `.in(≤500)` lookup and keeps per-page CPU well under the edge budget (today's failure needed ~8,448 ids × ~17 chunks in one call).

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | User-visible behavior demanded | Files touched here | Parity |
|---|---------|----------|--------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/` iOS) | NO | none | none | Reads `place_scores` only; benefits indirectly once NY/Paris fill. Reason: read-only consumer of the column. |
| 2 | Consumer Android (`app-mobile/` Android) | NO | none | none | Same as #1. |
| 3 | Buyer/anonymous Web (`mingla-business/` public routes) | NO | none | none | Does not read `place_scores`. Reason: unrelated surface. |
| 4 | Business iOS | NO | none | none | Does not run the scorer. |
| 5 | Business Android | NO | none | none | Same as #4. |
| 6 | **Admin Web (`mingla-admin/`)** | **YES** | "Run scorer" / "Score ALL signals" for a large city now persists all servable places (progresses across batches, shows a live batch/remaining counter) and the "Scored" column refreshes on completion. | `mingla-admin/src/pages/SignalLibraryPage.jsx` | Manual — the only surface that triggers scoring. |
| 7 | Business Web preview (adjacent) | NO | none | none | Does not run the scorer. |
| **Backend** | Edge fn `run-signal-scorer` + new `_shared/signalScorerBatch.ts` | **YES** | City/all_cities scoring is per-page & resumable; per-place mode unchanged in outcome (one-call). | `supabase/functions/run-signal-scorer/index.ts`, `supabase/functions/_shared/signalScorerBatch.ts` (new) | N/A (single implementation). |

---

## 4. Layered specification

There is **no Database / RLS / migration / Realtime change**. The layers touched are: (A) a new shared batch engine, (B) the edge function, (C) an operational backfill, and (D) the admin client. Success criteria in §5.

### 4.A — NEW shared module `supabase/functions/_shared/signalScorerBatch.ts`

**Why a shared module (mirrors `_shared/bouncerBatch.ts`):** it makes the cursor-loop **unit-testable in memory** (the edge `index.ts` boots `serve()` + a real Supabase client at import, so it cannot be sandboxed cheaply — this is exactly why `run-signal-scorer/__tests__/per_place_mode.test.ts` fell back to source-inspection). Extracting the loop lets the regression guard (§9) inject a fake store and PROVE incremental persistence behaviorally.

**Hard constraint — the module performs NO database IO and writes NO owned columns itself.** Exactly like `bouncerBatch.ts`, all IO is injected via callbacks that live in `index.ts`. This keeps the sole-writer strict-grep gates satisfied: the literal `ai_signal_scores_at:` write key, the `.upsert(...)` on `place_scores`, the sticky `.select('place_id, contributions')`, and the `isAdminOverridden(...)` call all remain inside `run-signal-scorer/index.ts` (see §6 gate preservation).

**Imports:** `computeScore`, `PlaceForScoring`, `SignalConfig` from `./signalScorer.ts`. (It calls `computeScore` — the pure scoring function — but never touches the DB.)

**Exported types (contract):**

```ts
export interface ScoreWrite {
  place_id: string; signal_id: string; score: number;
  contributions: Record<string, number | string>;
  signal_version_id: string; ai_signal_scores_at: string | null;
}
export interface ScorerSummary {           // identical shape to today's index.ts ScorerSummary
  scored_count: number; ineligible_count: number; vetoed_count: number;
  ai_blended_count: number; signal_version_id: string | null;
  score_distribution: { '0-50': number; '50-100': number; '100-150': number; '150-200': number };
}
export interface ScorerBatchDeps {
  // Load the next id-ordered page AFTER `cursor` (null = from start), ≤ pageSize rows.
  // Throwing propagates as a fatal read error (index.ts catch → 500).
  loadPage: (cursor: string | null, pageSize: number) => Promise<Array<PlaceForScoring & { id: string }>>;
  // ORCH-1066 sticky pre-read, bounded to THIS page's touched ids. Returns the set of
  // admin-protected place_ids. Throwing → fail-CLOSE for this page (do NOT upsert it).
  readProtectedIds: (placeIds: string[]) => Promise<Set<string>>;
  // UPSERT one page's writes. Returns { error } (non-throwing) — a non-null error is
  // fatal for THIS invocation (prior pages already persisted).
  upsertScores: (rows: ScoreWrite[]) => Promise<{ error: string | null }>;
  // DELETE vetoed (place,signal) rows for one page. NON-fatal (logged, run continues).
  deleteVetoed: (placeIds: string[]) => Promise<{ deleted: number; error: string | null }>;
  // Remaining unscored servable count for the scope (progress UI). null when unknown/all_cities.
  countRemaining: () => Promise<number | null>;
}
export interface ScorerBatchOptions {
  signalId: string; config: SignalConfig; signalVersionId: string;
  maxRows: number; pageSize: number; afterId: string | null; dryRun: boolean;
}
export interface ScorerBatchResult {
  summary: ScorerSummary;
  processed: number; written: number; veto_deleted: number; sticky_skipped: number;
  next_cursor: string | null; done: boolean; remaining: number | null;
  error: string | null;           // set when a page sticky/upsert failed (fatal for this call)
}
export async function runSignalScorerBatch(
  deps: ScorerBatchDeps, opts: ScorerBatchOptions,
): Promise<ScorerBatchResult>;
```

**Loop contract (exact ordering — the implementor builds this):**
1. `cursor = opts.afterId`; init totals (`processed/written/veto_deleted/sticky_skipped = 0`, fresh `summary`), `reachedEnd = false`.
2. `while (processed < opts.maxRows)`:
   - `pageStartCursor = cursor` (captured BEFORE advancing — used for the error-return cursor so a retry re-attempts the failed page).
   - `pageSize = Math.min(opts.pageSize, opts.maxRows - processed)`.
   - `rows = await deps.loadPage(cursor, pageSize)`; if `rows.length === 0` → `reachedEnd = true; break`.
   - **Score the page in memory:** for each `place`, `result = computeScore(place, opts.config, opts.signalId)`; bucketize into `summary.score_distribution` (null score = don't bucket); increment `ineligible_count` when `contributions._ineligible !== undefined` else `scored_count`; on `result.score === null` push `place.id` to `pageVetoes` and `vetoed_count++`; else push a `ScoreWrite` to `pageWrites` (with `ai_signal_scores_at: result.ai_blended?.evaluated_at ?? null`) and `ai_blended_count++` when `result.ai_blended`.
   - `processed += rows.length`.
   - **If `opts.dryRun`:** skip all writes; `cursor = rows[rows.length-1].id`; if `rows.length < pageSize` → `reachedEnd = true; break`; else `continue`.
   - **Sticky pre-read (this page only):** `touched = [...new Set([...pageWrites.map(w=>w.place_id), ...pageVetoes])]`. `let protectedIds; try { protectedIds = await deps.readProtectedIds(touched); } catch (e) { return { …totals, next_cursor: pageStartCursor, done: false, remaining: null, error: 'sticky override pre-read failed: '+e.message }; }` — **fail-CLOSE: do NOT upsert this page** (protects admin pins) but prior pages stay persisted.
   - **Drop protected from BOTH batches:** `finalWrites = pageWrites.filter(w => !protectedIds.has(w.place_id))`; `finalVetoes = pageVetoes.filter(id => !protectedIds.has(id))`; `sticky_skipped += (pageWrites.length - finalWrites.length)`.
   - **UPSERT this page:** `const up = await deps.upsertScores(finalWrites); if (up.error) { return { …totals, next_cursor: pageStartCursor, done: false, remaining: null, error: 'place_scores upsert failed: '+up.error }; }` `written += finalWrites.length`.
   - **Veto-delete this page (non-fatal):** if `finalVetoes.length` → `const del = await deps.deleteVetoed(finalVetoes); veto_deleted += del.deleted;` (a `del.error` is already logged by the dep; do not abort).
   - **Advance cursor only after successful write:** `cursor = rows[rows.length-1].id`.
   - If `rows.length < pageSize` → `reachedEnd = true; break`.
3. `remaining = await deps.countRemaining()` (guard against throwing → treat as `null`).
4. `return { summary, processed, written, veto_deleted, sticky_skipped, next_cursor: reachedEnd ? null : cursor, done: reachedEnd, remaining, error: null }`.

**Invariant preserved by the ordering:** sticky pre-read → filter → upsert → veto-delete, per page — identical semantics to today's post-loop block, only now scoped to one page and repeated. Admin pins are never clobbered; on any sticky/upsert error the page is skipped (not clobbered) and prior pages persist.

### 4.B — Edge function `supabase/functions/run-signal-scorer/index.ts`

**Preserved verbatim:** `SELECT_FIELDS` (incl. `reviews`, `ai_signal_scores`), `BATCH_SIZE = 500`, `verify_jwt: true` (unchanged — do NOT touch `config.toml`/deploy flags), the signal-definition + version load (L110-155), the `import { isAdminOverridden } from '../_shared/stickyOverride.ts'` (kept), CORS, the `catch` envelope.

**New request field:** parse `after_id` exactly like `run-bouncer` (L57-58):
`const afterId: string | null = typeof body.after_id === 'string' && body.after_id.length > 0 ? body.after_id : null;`
Keep ALL existing validation (`signal_id` required; `place_ids` ≤ 1000; `place_ids`+`all_cities` mutually exclusive; at least one of `place_ids`/`city_id`/`all_cities`). `after_id` is additive and ignored by per-place callers.

**New constant:** `const SCORER_MAX_ROWS_PER_CALL = 500;` (one page per city/all_cities invocation → bounds per-call CPU + sticky-read; client loops).

**Replace** the entire scope-dispatch block **(current L166-395: the `writes[]`/`vetoedPlaceIds[]` accumulators, `processPlaces`, the per-place branch, the `while(true)` paging loop, the post-loop ORCH-1066 sticky block, the UPSERT loop, and the veto-delete loop)** with:
- Build `const isPerPlace = !!(placeIds && placeIds.length > 0);`
- Build a single `ScorerBatchDeps` object (all DB IO lives here, in `index.ts`):
  - `loadPage(cursor, size)`: `supabaseAdmin.from('place_pool').select(SELECT_FIELDS).eq('is_active', true).eq('is_servable', true).order('id').limit(size)`; then `if (isPerPlace) q = q.in('id', placeIds); else if (cityId) q = q.eq('city_id', cityId);` (all_cities → no scope filter); `if (cursor) q = q.gt('id', cursor);` — on error `throw new Error('place_pool fetch failed: '+error.message)`.
  - `readProtectedIds(ids)`: chunk `ids` by 500; for each chunk `supabaseAdmin.from('place_scores').select('place_id, contributions').eq('signal_id', signalId).in('place_id', chunk)`; on error `throw new Error(error.message)` (harness fail-close); for each row `if (isAdminOverridden(row.contributions)) out.add(row.place_id)`; return the `Set`. **This is where the `isAdminOverridden(row.contributions)` call stays in `index.ts`.**
  - `upsertScores(rows)`: if `rows.length === 0` return `{ error: null }`; `const now = new Date().toISOString();` `supabaseAdmin.from('place_scores').upsert(rows.map(w => ({ place_id: w.place_id, signal_id: w.signal_id, score: w.score, contributions: w.contributions, signal_version_id: w.signal_version_id, scored_at: now, ai_signal_scores_at: w.ai_signal_scores_at })), { onConflict: 'place_id,signal_id' })`; return `{ error: error?.message ?? null }`. **This is where the `ai_signal_scores_at:` write key + the `.upsert` on `place_scores` stay in `index.ts`** (sole-writer gate preservation).
  - `deleteVetoed(ids)`: chunk by 500; `supabaseAdmin.from('place_scores').delete({ count: 'exact' }).eq('signal_id', signalId).in('place_id', chunk)`; on error `console.error('[run-signal-scorer] veto-delete failed:', delErr.message)` and continue; sum `count`; return `{ deleted, error: null }`.
  - `countRemaining()`: return `null` when `isPerPlace || allCities`; else count servable places in the city that have no `place_scores` row for this signal (best-effort; on any error return `null`). Acceptable simplest impl: `null` for all scopes if a clean "unscored count" query is non-trivial — progress UI degrades gracefully (matches Bouncer's `null`-tolerant client). Implementor's choice; MUST NOT throw.
- Call `const result = await runSignalScorerBatch(deps, { signalId, config, signalVersionId, maxRows: isPerPlace ? 1000 : SCORER_MAX_ROWS_PER_CALL, pageSize: BATCH_SIZE, afterId, dryRun });`
  - `maxRows` rationale: per-place = 1000 so the cron/approval (≤500 ids) finish in ONE invocation with `done:true` (no client loop for those callers); city/all_cities = 500 (one page) so the admin client loops.
- **dry_run:** keep the existing `dry_run` early-return semantics but source the numbers from `result` (the harness honored `dryRun`): log the same `[run-signal-scorer] dry_run …` line and return `{ success: true, dry_run: true, ...result.summary, next_cursor: result.next_cursor, done: result.done, remaining: result.remaining, duration_ms }`.
- **Error return (fatal page error):** `if (result.error) { console.error('[run-signal-scorer]', result.error); return 500 with { error: result.error, partial_summary: result.summary, written: result.written, next_cursor: result.next_cursor } }`. Prior pages remain persisted; the client stops and surfaces the error.
- **Success return:** log `console.log(\`[run-signal-scorer] signal=${signalId} scope=${isPerPlace?'place_ids['+placeIds.length+']':(cityId ?? 'all')} scored=${result.summary.scored_count} ineligible=${result.summary.ineligible_count} vetoed=${result.summary.vetoed_count} ai_blended=${result.summary.ai_blended_count} written=${result.written} veto_deleted=${result.veto_deleted} next_cursor=${result.next_cursor ?? 'DONE'} elapsed_ms=${Date.now()-t0}\`)` then:
  ```
  return new Response(JSON.stringify({
    success: true,
    ...result.summary,               // scored_count, ineligible_count, vetoed_count, ai_blended_count, signal_version_id, score_distribution
    written: result.written,
    veto_deleted: result.veto_deleted,
    sticky_skipped: result.sticky_skipped,
    next_cursor: result.next_cursor, // null when done
    done: result.done,
    remaining: result.remaining,
    duration_ms: Date.now() - t0,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  ```
  **Response-shape contract (preserved):** `scored_count`, `ineligible_count`, `vetoed_count`, `ai_blended_count`, `signal_version_id`, `score_distribution`, `written`, `veto_deleted`, `sticky_skipped`, `duration_ms` — all retained with identical meaning. **Additive:** `next_cursor`, `done`, `remaining`. No existing key is removed or renamed (the cron, `admin-review-venue-claim`, and admin UI all keep reading what they read today).

### 4.C — Operational backfill (§ post-deploy, run by Seth / orchestrator, NOT code)

Once the edge fn is deployed (orchestrator, `[deploy]`-tag CLOSE) and the admin bundle is live:
1. In the admin Signal Library, pick **New York**, click **"Score ALL N signals for New York"**. The button now loops each signal to completion (≈20 batches/signal for NY). Watch the per-signal progress and the "Scored" column climb to ~100% of servable.
2. Repeat for **Paris**.
3. **Sweep** for any other post-2026-05-30 large city in the same state with the investigation's coverage query (§7 of the investigation): any city with large `servable` and `scored ≈ 0` gets the same "Score ALL" treatment.
4. Verify with the coverage query that NY + Paris reach parity (`scored / servable ≈ 100%`, matching London/Washington).

This is an operator runbook step for the CLOSE/post-CLOSE, not a code deliverable. No standalone backfill script is required because the fixed admin button IS the backfill tool (identical to how Bouncer backfills run from the same page).

### 4.D — Admin client `mingla-admin/src/pages/SignalLibraryPage.jsx`

**D.1 — Extract a shared cursor-loop runner** (module-scope helper, mirrors `BouncerStep`'s inline loop + `mergeBouncerSummary`):
```
// runScorerToCompletion(signalId, cityId, onBatch?) → accumulated summary
```
Contract: loop `invokeWithRefresh("run-signal-scorer", { body: { signal_id, city_id, after_id: cursor } })`; on transport `error` → `extractFunctionError` throw; on `data.error` → throw `new Error(data.error)`; accumulate via a new `mergeScorerSummary(acc, data)` that sums `scored_count`, `ineligible_count`, `vetoed_count`, `ai_blended_count`, `written`, `veto_deleted`, `sticky_skipped` and merges the four `score_distribution` buckets; call `onBatch?.({ batches, scored, remaining: data.remaining, done: data.done })`; break on `data.done === true`; else `nc = data.next_cursor`; break if `!nc || nc === cursor`; else `cursor = nc`. Guard with `MAX_CALLS = 500` (Bouncer precedent — one call covers ≤20k rows at pageSize 500, so this only guards a stuck/null cursor). Returns the accumulated summary.

**D.2 — `RunScorerButton.trigger`** (L450-477): replace the single `invokeWithRefresh(...)` call with `const acc = await runScorerToCompletion(signalId, cityId, (p) => setProgress(p));` add a `progress` state + render a small `batches N · scored=… · remaining=… · done` line (copy the `BouncerStep` progress block). Final toast: `Scorer done: ${acc.scored_count} scored, ${acc.ineligible_count} ineligible across ${calls} batches`. Keep `onComplete?.(acc)`.

**D.3 — `ScoreAllSignalsButton.trigger`** (L676-745): inside the per-signal `for` loop, replace the single `invokeWithRefresh(...)` with `const acc = await runScorerToCompletion(sig.id, cityId, (p) => setProgress({ current: i+1, total: signals.length, label: sig.label, batch: p.batches }));` push `{ signal_id, label, ok:true, scored: acc.scored_count, ineligible: acc.ineligible_count }`. Preserve the confirm dialog, per-signal error capture (`ok:false`), final summary, and `onComplete?.(results)`.

**D.4 — Defect A: `CityPipelineHistory` refresh on completion** (F-6). Add a `refreshSignal` prop and refetch when it changes:
- `function CityPipelineHistory({ selectedCityId, onPickCity, refreshSignal })` (L547) and change the mount effect (L567) to `useEffect(() => { refresh(); }, [refresh, refreshSignal]);`.
- At the render site (L1084) pass `refreshSignal={previewKey}`. Because all four scorer/Bouncer `onComplete` handlers already do `setPreviewKey((k) => k + 1)` (L1143, L1157, L1197, and the Bouncer via L437→L1143), bumping `previewKey` now re-fetches `admin_city_pipeline_status()` and the "Scored"/"Bouncer-passed" columns move immediately. No new state, no new counter. (Chosen over a `key=` remount to avoid a full spinner flash of the whole table on every batch — the effect refetch reuses the existing loading state once, on completion.)

**Unchanged in this file:** `admin_city_pipeline_status` / `admin_city_picker_data` RPC calls, `TopPlacesPreview` (still re-keyed by `previewKey`), the city picker, cohort slider, all layout.

---

## 5. Success criteria (observable, testable)

- **SC-1 (Backend, city persists incrementally):** A `run-signal-scorer` call with `{ signal_id, city_id }` and no `after_id` scores ≤ 500 places, persists their `place_scores` rows in that call, and returns `next_cursor` (non-null when more remain) + `done:false`. A follow-up call with `after_id = next_cursor` continues from the next id. Looping to `done:true` persists ALL servable places for the city. Proven by SC-1 backfill: NY coverage query moves from 35 → ~9,903 distinct scored places.
- **SC-2 (Backend, no abort-all):** If the sticky pre-read throws on the Nth page, the call returns HTTP 500 with `error` + `written` = rows persisted by pages 1..N-1 (and prior invocations' pages stay in the DB). It NEVER wipes previously-persisted pages. (Test in §7 T-A / §9.)
- **SC-3 (Backend, sticky per-page preserved):** An admin-pinned/`_admin_set`/`_admin_override` `place_scores` row for a scored place is NOT clobbered and NOT veto-deleted by a city run — enforced per page. `sticky_skipped` counts the protected writes dropped.
- **SC-4 (Backend, per-place mode unchanged):** A call with `{ signal_id, place_ids:[…≤1000] }` (no `after_id`) scores exactly that set in ONE invocation, returns `done:true`, writes `ai_signal_scores_at`, and never abort-alls. The 15-min cron and `admin-review-venue-claim` approval loop behave identically to before (they read `scored_count` etc., unaffected by the additive `next_cursor`/`done`).
- **SC-5 (Backend, response shape):** The success JSON contains `scored_count`, `ineligible_count`, `vetoed_count`, `written`, `veto_deleted`, `sticky_skipped`, `score_distribution`, `signal_version_id`, `duration_ms`, plus additive `next_cursor`/`done`/`remaining`. `verify_jwt:true` unchanged.
- **SC-6-Web (Admin, client loop):** Clicking "Run scorer for New York" runs to completion across batches in one click (progress shows `batch N · scored=… · remaining=… · done`), and the final toast reports the accumulated `scored`/`ineligible`. No manual re-clicking.
- **SC-7-Web (Admin, Score ALL):** "Score ALL signals" loops every signal, each to full completion, before reporting `okCount/total` and total scored.
- **SC-8-Web (Defect A, counter refresh):** On any scorer/Bouncer completion, the `CityPipelineHistory` "Scored" (and "Bouncer-passed") column re-fetches and reflects the new coverage WITHOUT a manual "Refresh" click.
- **SC-9 (Guard):** The §9 regression test FAILS if the bulk path reverts to whole-city accumulate-then-write-all or abort-all-on-sticky-error, and PASSES on the fixed code. The test runs in CI.

---

## 6. Invariants

### Preserved (must not regress)
- **I-1066-ADMIN-OVERRIDE-STICKY-THROUGH-RESCORE** (ACTIVE) — admin pins survive re-score. Preserved: the per-page sticky pre-read + drop-from-writes/vetoes runs for every page; `readProtectedIds` still imports & calls `isAdminOverridden` from `_shared/stickyOverride.ts` inside `index.ts`. **Test:** `run-signal-scorer/__tests__/orch_1066_sticky_override.test.ts` T-01…T-05 (behavioral, use the shared predicate — unaffected). T-06 (source-inspect of `index.ts`) MUST be re-pinned (see §9 / allowlist) because `writes.splice`/`vetoedPlaceIds.splice` move into the harness `.filter`; re-pin T-06 to assert (a) `from '../_shared/stickyOverride.ts'` import present, (b) `isAdminOverridden(row.contributions)` present, (c) `runSignalScorerBatch(` is called, (d) the deps object provides `readProtectedIds`.
- **I-AI-SCORE-STALENESS-AUTO-RECOVERED** (ACTIVE, META-ORCH-1009 Sub-D) — `place_scores.ai_signal_scores_at` written by EXACTLY `run-signal-scorer/index.ts`. Preserved: the `ai_signal_scores_at:` write key stays inside `index.ts`'s `upsertScores` dep; the new `_shared/signalScorerBatch.ts` NEVER contains that key. **Gate:** `strict-grep/meta-orch-1009-sub-d-ai-score-staleness-recovery.mjs` Part B (`ALLOWED_WRITER_FILES = { run-signal-scorer/index.ts }`) stays green. Note §7 §Investigation §10 flags this invariant's "auto-recover" promise is effectively false for large never-scored cities until THIS fix lands — this SPEC makes it true again (bulk fill possible), which is a reinforcement, not a change to the invariant text.
- **I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER** / **I-CONSUMER-READS-AI-SIGNAL-SCORES-NOT-TRIAL-TABLE** — untouched; `_shared/signalScorer.ts` unchanged; the new module does not read the trial table. Gates at `strict-grep-mingla-business.yml` L1668/1679 stay green.
- **I-SCORER-INVOKE-HAS-SIGNAL-ID** (META-ORCH-1062, gate L1701-1703) — every `run-signal-scorer` invoke carries `signal_id`. Preserved: admin-review-venue-claim untouched; the admin client invokes still carry `signal_id` (adding `after_id` does not remove it). The gate scans `admin-review-venue-claim` only.
- **Constitutional #2** — `place_scores.score` written solely by `run-signal-scorer`. Preserved: the `.upsert` stays in `index.ts`; the shared harness writes nothing.
- **I-SIGNAL-CONTINUOUS / I-SCORE-NON-NEGATIVE / I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED / I-COLLAB-DECK-DETERMINISM-PRESERVED-UNDER-AI-BLEND** — all live in `computeScore` (`_shared/signalScorer.ts`), which is UNCHANGED.

### New (DRAFT — orchestrator flips ACTIVE at CLOSE)
- **`I-PROPOSED-1333-SCORER-CITY-RUN-INCREMENTAL-PERSIST`** (DRAFT): The `run-signal-scorer` city/all_cities path MUST persist scores **incrementally per bounded page** (page size ≤ `BATCH_SIZE`) and MUST NOT accumulate an entire city's write-set before its first UPSERT. A per-page sticky-pre-read or UPSERT failure MUST leave all previously-written pages persisted (no abort-all) and surface the error with a resumable `next_cursor`; it MUST NOT return 0 rows for a fully-read large city. Enforced by the §9 behavioral test (CI-executed). Established DRAFT at ORCH-1333 IMPLEMENT; flips ACTIVE at CLOSE.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-A (guard, happy) | Multi-page city processed in full via cursor | fake store of 1200 places, pageSize 500, maxRows 1500 | `written == 1200`, every id upserted once, `done:true`, `next_cursor:null`, `remaining:0` | `_shared` behavioral |
| T-B (guard, no-abort-all) | Sticky pre-read throws on the 3rd page | 1500 places, `readProtectedIds` throws on call #3, maxRows 1500, pageSize 500 | `written == 1000` (pages 1-2 persisted), result `error` set, `next_cursor == pageStartCursor of page 3`, prior pages remain in the fake store | `_shared` behavioral |
| T-C (guard, sticky per-page) | An `_admin_pin` row is present in the store | one protected place in page 1 | protected place is NOT upserted (score unchanged) and NOT veto-deleted; `sticky_skipped >= 1` | `_shared` behavioral |
| T-D (guard, dry_run) | dry_run scores but never writes | 600 places, dryRun:true | `written == 0`, store unchanged, `done:true` | `_shared` behavioral |
| T-E (guard, resume) | Resume from a cursor | call 1 (maxRows 500) then call 2 with `afterId = next_cursor` | union of both calls == all rows, no double-write, 2nd call ends `done:true` | `_shared` behavioral |
| T-F (per-place unchanged) | Per-place one-call | `{ signal_id, place_ids }` in `index.ts` (source-inspect) | per-place `loadPage` uses `.in('id', placeIds)`; maxRows 1000; `ai_signal_scores_at` written | source-inspect `index.ts` (re-pinned `per_place_mode.test.ts`) |
| T-G (client loop) | Admin RunScorerButton loops to done | mocked responses `{done:false,next_cursor:'a'}` → `{done:true}` | two invokes, accumulated `scored_count` summed, `onComplete` fired once | (optional) admin unit / manual |
| T-H (defect A) | Completion refreshes counter | `refreshSignal` prop change | `CityPipelineHistory` refetches `admin_city_pipeline_status` | manual admin QA (mingla-admin has no jsx test harness) |

T-A…T-F are the CI-enforced fails-on-revert set (§9). T-G/T-H are manual-QA success criteria for the tester (admin web has no automated jsx test rig).

---

## 8. Implementation order

1. **New `_shared/signalScorerBatch.ts`** — types + `runSignalScorerBatch` loop (§4.A). No DB IO.
2. **`run-signal-scorer/index.ts`** — parse `after_id`; add `SCORER_MAX_ROWS_PER_CALL`; replace L166-395 with the deps object + `runSignalScorerBatch` call + new return/error shape (§4.B). Keep imports, validation, dry_run, `verify_jwt`.
3. **Regression tests** (§9): new `_shared/__tests__/signalScorerBatch.test.ts` (T-A…T-E) + `signalScorerBatch.adversarial.test.ts` (T-B/T-C emphasis) mirroring `bouncerBatch*.test.ts`; re-pin `run-signal-scorer/__tests__/per_place_mode.test.ts` T-04/T-05/T-07 + `orch_1066_sticky_override.test.ts` T-06 to the new shape (T-01/T-02/T-03/T-06 of per_place + T-01…T-05 of sticky pass unchanged).
4. **Wire the new tests into CI** — add `_shared/__tests__/signalScorerBatch.test.ts` (+ adversarial) to a `DENO_TEST_FILES` list in `.github/workflows/supabase-migrations-and-stripe-deno.yml` as a NEW job `orch-1333-signal-scorer-deno-tests` (mirror the existing `appsflyer-s2s-deno-tests` job block: `denoland/setup-deno@v1` `1.46.x`, inert `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` env, `deno test --allow-read --no-check`, 3-attempt retry). **Rationale:** the existing scorer/bouncer Deno tests are NOT in any CI job's file list, so a guard placed only on disk would never run — it MUST be added to a job to be CI-enforced (I-CLOSE regression-protection HARD MUST).
5. **Admin client** — `mingla-admin/src/pages/SignalLibraryPage.jsx`: add `runScorerToCompletion` + `mergeScorerSummary`; rewire `RunScorerButton` (D.2), `ScoreAllSignalsButton` (D.3); add `refreshSignal` to `CityPipelineHistory` + pass `refreshSignal={previewKey}` (D.4).
6. **Commit** with `[TEST-MOD-APPROVED ORCH-1333]` in the commit body (required by `tests-append-only.yml` because step 3 modifies existing test files with deletions).

---

## 9. Regression prevention (fails-on-revert contract)

**Structural safeguard:** the cursor-loop shape itself (bounded page + per-page persist) makes whole-city-accumulate impossible to reintroduce silently.

**The load-bearing test — `supabase/functions/_shared/__tests__/signalScorerBatch.test.ts` (T-B, the abort-all guard):** build an in-memory fake store (mirror `bouncerBatch.test.ts`'s `makeFakeStore`): `loadPage` slices id-ordered rows after a cursor; `upsertScores` records rows into a `Map`; `readProtectedIds` returns `Set()` normally but is wired to **throw on its 3rd invocation**; `deleteVetoed` no-ops. Run `runSignalScorerBatch` with 1500 rows, pageSize 500, maxRows 1500. **Assert:** `result.written === 1000` (pages 1-2 persisted before the page-3 sticky failure), `result.error` is non-null, `result.next_cursor` equals the id at the start of page 3, and the store `Map` still holds pages 1-2's rows. **Fails-on-revert:** if the implementation reverts to accumulate-then-write-all (single post-loop UPSERT) or abort-all (sticky error wipes/returns 0), `written` becomes `0` and the assertion breaks. Add a protective header comment citing ORCH-1333 + F-4/F-5 + `I-PROPOSED-1333-SCORER-CITY-RUN-INCREMENTAL-PERSIST` explaining WHY (the NY/Paris 0-row incident).

**Companion — T-A/T-E** prove the happy-path completeness (every row written exactly once across pages; resume from cursor unions correctly) so a future refactor that drops a page or double-writes also fails.

**CI enforcement:** the new job `orch-1333-signal-scorer-deno-tests` (step 4) runs T-A…T-E on every PR touching the paths (the workflow already triggers on `supabase/functions/_shared/**`).

**Append-only compliance:** T-06/T-07 re-pins are deletions-in-existing-test-files → the CLOSE commit body MUST contain `[TEST-MOD-APPROVED ORCH-1333]` (per `.github/workflows/tests-append-only.yml`). New test files are pure additions (no token needed for them).

---

## 10. Open questions

1. **`countRemaining` fidelity.** The cheapest correct impl (count servable-in-city without a `place_scores` row for this signal) is an extra query per invocation. Acceptable to ship `remaining: null` for v1 (progress UI already tolerates null, like the Bouncer's all_cities path) and add the count later? **Recommendation:** ship `null`-tolerant; implement the city-scoped count only if trivial. Non-blocking — does not affect correctness of persistence.
2. **`SCORER_MAX_ROWS_PER_CALL = 500` (one page/call).** Chosen conservatively because the per-row AI-blend compute is the proven cost center (F-5). If the tester's live-fire shows headroom, a later ORCH could raise it to 2-3 pages/call to cut round-trips. **Recommendation:** keep 500 for this fix; revisit only with runtime evidence. Non-blocking.

Neither blocks implementation; both have a stated default.

---

## 11. Downstream routing

**NEXT = `mingla-implementor`** (backend + admin-web). Build strictly to §4/§8 in the worktree `~/Desktop/mingla-orchs/ORCH-1331-[signal-scoring-city-run]/` on branch `ORCH-1333-signal-scoring-city-run`. Inputs: this SPEC + `investigations/INVESTIGATION_ORCH-1333_SIGNAL_SCORING_CITY_RUN.md`. Hard constraints: honor the allowlist + DO-NOT-TOUCH; keep every preserved invariant/gate green (§6); commit body carries `[TEST-MOD-APPROVED ORCH-1333]`; do NOT deploy or migrate. Output: `reports/IMPLEMENTATION_ORCH-1333_SIGNAL_SCORING_CITY_RUN.md` + fails-on-revert evidence (run T-B, revert to accumulate-then-write-all, show red; restore, show green).

**Then → `mingla-tester`:** live-fire on prod-admin with an admin JWT — run "Run scorer for New York" (single signal) end-to-end, prove `place_scores` NY distinct-scored jumps from 35 toward 9,903 across batches, prove SC-2 (kill mid-run / observe partial persist), SC-3 (an admin-pinned NY place keeps its score), SC-8 (counter refreshes). Verify per-place cron path still writes (SC-4).

**Then → `mingla-orchestrator` CLOSE:** deploy `run-signal-scorer` (edge, `[deploy]`), verify the deploy with one curl, run the §4.C backfill (NY + Paris + sweep), flip `I-PROPOSED-1333-SCORER-CITY-RUN-INCREMENTAL-PERSIST` DRAFT→ACTIVE, sync WORLD_MAP + INVARIANT_REGISTRY, register D-1/D-2 as separate ORCHs.

---

## Scoped allowlist + DO-NOT-TOUCH

### Allowlist (implementor MAY create/modify ONLY these)
- `supabase/functions/_shared/signalScorerBatch.ts` — **CREATE** (cursor-loop engine, no DB IO).
- `supabase/functions/run-signal-scorer/index.ts` — **MODIFY** (parse `after_id`; deps object; call harness; new return/error shape). Keep imports, validation, dry_run, `verify_jwt`.
- `supabase/functions/_shared/__tests__/signalScorerBatch.test.ts` — **CREATE** (T-A/T-D/T-E).
- `supabase/functions/_shared/__tests__/signalScorerBatch.adversarial.test.ts` — **CREATE** (T-B/T-C).
- `supabase/functions/run-signal-scorer/__tests__/per_place_mode.test.ts` — **MODIFY** (`[TEST-MOD-APPROVED ORCH-1333]`). **T-01/T-02/T-03/T-06 pass unchanged** (`.in('id', placeIds)`, `placeIds && placeIds.length > 0`, the 1000-cap + mutual-exclusion + missing-scope messages all stay in `index.ts`). **Re-pin T-04, T-05, T-07:** T-04's `ai_signal_scores_at: result.ai_blended?.evaluated_at ?? null` and T-05's `ai_signal_scores_at: string | null;` (`ScoreWrite` type) now live in `_shared/signalScorerBatch.ts` — point those assertions at that file; `index.ts` still keeps `ai_signal_scores_at: w.ai_signal_scores_at` in `upsertScores` (assert it there). T-07's `while(true)` + `.range(offset, offset + BATCH_SIZE - 1)` are gone — re-pin to assert the cursor contract (`.gt('id', cursor)` in `loadPage` + `runSignalScorerBatch(` call + `after_id` parse).
- `supabase/functions/run-signal-scorer/__tests__/orch_1066_sticky_override.test.ts` — **MODIFY** (re-pin T-06 source-inspect strings to the new wiring; keep behavioral T-01…T-05; `[TEST-MOD-APPROVED ORCH-1333]`).
- `.github/workflows/supabase-migrations-and-stripe-deno.yml` — **MODIFY** (add the `orch-1333-signal-scorer-deno-tests` job running the two new test files).
- `mingla-admin/src/pages/SignalLibraryPage.jsx` — **MODIFY** (`runScorerToCompletion` + `mergeScorerSummary`; rewire `RunScorerButton`, `ScoreAllSignalsButton`; `refreshSignal` on `CityPipelineHistory`).

### DO-NOT-TOUCH (stop-and-amend before changing any of these)
- `supabase/functions/_shared/signalScorer.ts` — the scoring math (eligibility, AI blend, veto, boost). UNCHANGED.
- `supabase/functions/_shared/stickyOverride.ts` — the admin-override predicate. UNCHANGED (imported as-is).
- `supabase/functions/admin-review-venue-claim/**` — the approval re-score loop (per-place caller). UNCHANGED (I-SCORER-INVOKE-HAS-SIGNAL-ID gate).
- `supabase/migrations/**` — no migration; the 15-min cron migration + `admin_city_pipeline_status()` UNCHANGED.
- `supabase/functions/run-bouncer/**`, `run-pre-photo-bouncer/**`, `_shared/bouncerBatch.ts` — the Bouncer precedent; read for reference, do NOT edit.
- `.github/scripts/strict-grep/**` — the sole-writer gates; do NOT weaken (`ALLOWED_WRITER_FILES` must stay = `run-signal-scorer/index.ts`).
- Consumer/business apps, buyer web, any `place_scores` READERS — read-only consumers; UNCHANGED.
- `config.toml` / edge deploy flags — `verify_jwt:true` UNCHANGED.

Amendments append in-file or land as `Mingla_Artifacts/specs/SPEC_AMENDMENT_ORCH-1333_SIGNAL_SCORING_CITY_RUN.md`.
