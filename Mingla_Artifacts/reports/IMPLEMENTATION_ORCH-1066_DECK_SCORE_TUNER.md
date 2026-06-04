# IMPLEMENTATION — ORCH-1066 [admin deck score tuner + card preview]

**Status:** implemented and verified (DB logic proven on throwaway Postgres; admin UI built + lint-clean + vite-build-green; regression tests pass + fails-on-revert proven). Edge fn + migration await orchestrator deploy.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1066-[deck-score-tuner]/` on branch `ORCH-1066-deck-score-tuner`
**Supabase project ref:** `gqnoajqerqhnvulmnyvv`
**Implementor:** mingla-implementor (Claude)
**Comms acked:** COMMS-0002 (strict-grep allowlist same commit), COMMS-0003 (Supabase docs cited inline) — acks committed on anchor `main` (`03e2145bb`), push deferred to orchestrator (anchor tree dirty with foreign session work).

---

## Commit-per-layer

| Layer | Commit | Contents |
|---|---|---|
| Backend (Layers 1–4) | `3c77f6a49` | Migration `20260904000000` (4 RPCs) + sticky-through-approval in `run-signal-scorer` + `_shared/stickyOverride.ts` + edge actions in `admin-review-venue-claim` + strict-grep allowlist + 2 backend tests |
| Admin UI (Layers 5–8) | `77adf4170` | `<DeckCardPreview>`, `<ScoreTunerPanel>`, `deckCardPreviewRules.js` (+test), services, `ClaimsPage` upgrade, `DeckScoreTunerPage` + nav wiring |

---

## Migration to apply

**File:** `supabase/migrations/20260904000000_orch_1066_deck_score_tuner.sql`
Version `20260904000000` is strictly > remote head `20260902000000` (verified via `list_migrations`) and > sibling ORCH-1065's `20260903000000`. Monotonic, no remote-only versions.

Apply command (orchestrator/operator):
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1066-[deck-score-tuner]" && /Users/sethogieva/bin/supabase db push --linked
```

The migration is 4 `CREATE OR REPLACE FUNCTION` (no table mutation → no abort-on-existing-rows risk). It was applied + behavior-tested on a throwaway Postgres 15 container (schema stubs) — all 4 RPCs create cleanly under `ON_ERROR_STOP=1`; seed/set/pin/rank behavior verified correct (see §Regression).

---

## Edge function to deploy

**`admin-review-venue-claim`** — MODIFIED (added 3 place-keyed actions: `set_place_score`, `pin_place_score`, `score_place_preview`). `verify_jwt` preserved.
**`run-signal-scorer`** — MODIFIED (sticky-through-approval skip). Imports new `_shared/stickyOverride.ts`.

Deploy after `db push` + main merge:
```bash
supabase functions deploy admin-review-venue-claim --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy run-signal-scorer --project-ref gqnoajqerqhnvulmnyvv
```

**Deno gates:** `deno check` run on both touched fns. `admin-review-venue-claim` is clean. `run-signal-scorer` shows the SAME 2 pre-existing `GenericStringError` cast errors that exist on `main` (verified via `git stash` — not introduced by ORCH-1066). New code adds zero new type errors.

---

## The sticky-through-approval mechanism + proof (operator hard requirement #2)

### Investigation
- `admin-review-venue-claim` → `runApproveGoLive` (on approve) flips `is_servable=true` then loops the 16 active signals invoking `run-signal-scorer` once per signal.
- `run-signal-scorer` recomputes each place's score via `computeScore` and **UPSERTs** `place_scores` `ON CONFLICT (place_id, signal_id) DO UPDATE` → would CLOBBER an admin's manual score. If `computeScore` AI-vetoes, the scorer **DELETEs** the row → would erase an admin pin.
- `place_pool.ai_signal_scores_veto` is audit-only — the scorer does NOT read it; it reads `place_pool.ai_signal_scores` (the Gemini slice). So a veto-column approach would not be respected by the scorer without further wiring.

### Chosen mechanism (cleanest, surgical)
Make `run-signal-scorer` **skip** any `(place_id, signal_id)` whose committed `place_scores.contributions` carries an admin-override marker — for BOTH the UPSERT batch AND the veto-DELETE batch. The markers are the agreed provenance keys every admin write stamps:
- `_admin_set` — `admin_set_place_signal_score` (ORCH-1066)
- `_admin_pin` — `admin_pin_place_to_top` (ORCH-1066)
- `_admin_override` — `admin_apply_score_override` (META-ORCH-1062, also now sticky)

Implementation: before the upsert loop, the scorer reads existing `place_scores` rows for the touched place_ids (this signal) and builds a `protectedIds` set via the shared pure predicate `isAdminOverridden()` (`supabase/functions/_shared/stickyOverride.ts`). Protected ids are spliced out of `writes` and `vetoedPlaceIds`. If the pre-read errors, the scorer returns 500 (fail-safe — never silently clobber). Response surfaces `sticky_skipped`.

Why not modify the veto column / RLS: the marker already lives in `place_scores.contributions` (written by 1062 + the two new RPCs), the scorer already touches exactly that table with the conflict key, and reading one extra column is the minimal change that preserves the scorer's existing UPSERT contract (Constitution #2: single coordinated write shape).

### Proof (behavioral regression, fails-on-revert)
`supabase/functions/run-signal-scorer/__tests__/orch_1066_sticky_override.test.ts` — 6 tests, builds an in-memory `place_scores`, pins a signal to 200 with `_admin_pin`, drives the EXACT scorer skip→upsert→veto-delete loop (sharing the real `isAdminOverridden` import), asserts the 200 SURVIVES:
- T-01 admin **pin** survives re-score (computed 117 does NOT clobber 200) — the load-bearing operator test (Lantern & Vine pinned → approve → stays #1).
- T-02 admin **set** (180) survives.
- T-03 admin **override** survives an AI veto-delete.
- T-04 a normal computed row IS still re-scored (sticky doesn't over-protect).
- T-05 `isAdminOverridden` marker detection.
- T-06 source-guard: the scorer actually imports + calls the shared predicate and splices both batches.

Run: `cd supabase && deno test --allow-read functions/run-signal-scorer/__tests__/orch_1066_sticky_override.test.ts` → **6 passed**.
Fails-on-revert: neutering `isAdminOverridden` to `return false` (at the fix base) flips T-01/T-02/T-03/T-05 (admin rows get clobbered/deleted) → **4 failed**. Verified at commit before `3c77f6a49`. Restored → 6 passed.

---

## Regression tests (all paths, fails-on-revert)

| Test | Path | Result | Fails-on-revert |
|---|---|---|---|
| Sticky-through-approval (behavioral) | `supabase/functions/run-signal-scorer/__tests__/orch_1066_sticky_override.test.ts` | 6 passed | ✅ neuter predicate → 4 fail (before `3c77f6a49`) |
| Migration shape (M-01..M-08) | `supabase/migrations/__tests__/orch_1066_deck_score_tuner.test.sql` | M-01..M-07 PASS on stub pg; M-08 PASS on real DB (1062 fn present) | ✅ migration absent → fns don't exist → M-01 raises |
| Tuner edge actions (source-inspect) | `supabase/functions/admin-review-venue-claim/__tests__/orch_1066_tuner_actions.test.ts` | 7 passed | ✅ removing a branch/renaming an RPC flips it |
| Card honest-data rules (UI) | `mingla-admin/src/lib/__tests__/deckCardPreviewRules.test.js` | 16 passed (19 total admin) | ✅ break rating rule → 3 fail; restored → pass |

**RPC behavior proven on throwaway Postgres 15** (schema-stubbed, then dropped):
- Seed: `admin_score_place_preview` → `{seeded_count:3, existing_count:0}`; re-seed idempotent → `{seeded_count:0, existing_count:3}` (DO NOTHING).
- Set: `romantic`→180, `direction:raised`, `_admin_set` marker present.
- Pin computed: `drinks` local_max 140 → `new_score:141, capped:false` (NOT hardcoded 200).
- Pin empty radius: `lively` local_max null → `new_score:200`.
- Rank projected: non-servable target at 141 → `{rank:1, total:3, projected:true, gated_reason:[not_servable]}`.
- Guards: score 250 → `score_out_of_range`; unknown signal → `unknown_or_inactive_signal`.

---

## Old → New receipts

### `supabase/migrations/20260904000000_orch_1066_deck_score_tuner.sql` (NEW)
4 SECURITY DEFINER, `is_admin_user()`-gated, `search_path`-pinned RPCs: `admin_set_place_signal_score` (place-keyed 0–200 dial, `_admin_set`), `admin_pin_place_to_top` (computed `LEAST(200, local_max+1)`, mirrors `query_servable_places_by_signal` gates, `_admin_pin`, capped+tie_warning), `admin_place_deck_rank` (projected rank + `gated_reason`), `admin_score_place_preview` (seed 16 @100, `ON CONFLICT DO NOTHING`, never flips `is_servable`). Supabase docs cited inline (COMMS-0003).

### `supabase/functions/_shared/stickyOverride.ts` (NEW)
Pure `ADMIN_OVERRIDE_MARKERS` + `isAdminOverridden()` + `protectedPlaceIds()` — single source of truth shared by the scorer and the behavioral test.

### `supabase/functions/run-signal-scorer/index.ts`
**Before:** UPSERTs/veto-deletes every scored place unconditionally → approval re-score clobbers admin scores.
**Now:** pre-reads committed contributions for touched place_ids, builds `protectedIds` via `isAdminOverridden`, splices them out of `writes` + `vetoedPlaceIds`; fail-safe 500 on pre-read error; `sticky_skipped` in response.
**Why:** operator hard requirement #2 (sticky-through-approval). ~55 lines.

### `supabase/functions/admin-review-venue-claim/index.ts`
**Before:** brand-keyed `score_override`/`tweak_fields`/`add_feedback` actions only.
**Now:** + 3 place-keyed actions `set_place_score`/`pin_place_score`/`score_place_preview` → call the new RPCs via the user client (admin-gated), audit-log to `admin_audit_log` (`target_type:'place_pool'`), return early. `verify_jwt` untouched. ~95 lines.

### `mingla-admin/src/components/DeckCardPreview.jsx` (NEW)
Web replica of the consumer swipe-card front face (DESIGN §A). Honest data via `lib/deckCardPreviewRules.js` (rating hidden null/≤0; "No photo yet" placeholder; distance/travel OMITTED + caption). All 9 states. Render-phase hero-failure reset (no setState-in-effect).

### `mingla-admin/src/components/ScoreTunerPanel.jsx` (NEW)
One reusable block, two contexts (`density='modal'|'page'`, `projected` prop). 16-signal list (set/pin/per-row rank), explicit Set commit, ≥44px controls, radius selector (8/16/40 km), live card preview, projected-vs-live rank strip, seed block, all 9 states, Mingla copy.

### `mingla-admin/src/pages/ClaimsPage.jsx`
**Before:** dead-end "Score override available after the venue is scored (on approve)." + brand-keyed override grid (only when `scores.length>0`).
**Now:** `<ScoreTunerPanel projected density="modal">` — seed-from-zero + set/pin/preview/rank for all 16 signals. `overrideClaimScore`/`submitScoreOverride`/`scoreDraft` removed from the modal (RPC retained in service for the approval channel, SC-8). Fetches active-signal catalog once.

### `mingla-admin/src/pages/DeckScoreTunerPage.jsx` (NEW) + nav
Standalone `#/deck-tuner`: debounced servable-venue search → pick → `<ScoreTunerPanel projected={false} density="page">`. Nav: `App.jsx` PAGES, `constants.js` NAV_GROUPS (`SlidersHorizontal`), `Sidebar.jsx` ICON_MAP.

### services
`adminClaimsService.js` +4 fns; new `deckTunerService.js` (re-exports + search/preview-card/active-signals/place-scores).

---

## Spec traceability (success criteria)

| SC | Status | Evidence |
|---|---|---|
| SC-1 seed from zero | ✅ | `admin_score_place_preview` seeds 16 @100 idempotent (stub-pg proof); ClaimsPage seed block |
| SC-2 set + audit | ✅ | `admin_set_place_signal_score`→180 `_admin_set` (stub-pg); edge action `place_score_set` audit |
| SC-3 pin computed | ✅ | local_max 140 → 141, not hardcoded 200 (stub-pg); empty radius → 200 |
| SC-4 rank #N of M (projected) | ✅ | `admin_place_deck_rank` rank 1 of 3 projected (stub-pg); rank strip |
| SC-5 card real hero/rating/category, omits distance | ✅ | `DeckCardPreview` + rules test; Lantern rating=null → badge hidden |
| SC-6 standalone page #/deck-tuner | ✅ | `DeckScoreTunerPage` + nav; servable-only search; `projected:false` |
| SC-7 RPC guards | ✅ | `score_out_of_range`/`unknown_or_inactive_signal`/`forbidden`/`not_authenticated` (stub-pg + M-04/M-07) |
| SC-8 1062 RPC untouched | ✅ | `admin_apply_score_override` preserved (M-08 on real DB); service still exports `overrideClaimScore` |
| SC-9 migration ordering | ✅ | `20260904000000` > `20260903000000` (1065) > `20260902000000` (remote) |
| SC-10 strict-grep C7 | ✅ | `ORCH_1066_BACKEND_ALLOWLIST` same commit; full gate exit 0 |

---

## Invariants

**Preserved:** I-PLACE-SCORES-SOLE-WRITER (all writes UPSERT `(place_id,signal_id)`, `_admin_*` provenance), I-SCORER-INVOKE-HAS-SIGNAL-ID (scorer invoke untouched), I-ADMIN-WRITE-GATED (4 RPCs `is_admin_user()`; 3 write actions audit-logged), serving-RPC determinism (`query_servable_places_by_signal` read-only-mirrored verbatim), Constitution #9 (distance/travel omitted, honest placeholder, no fake rank).

**New (DRAFT → ACTIVE on close):**
- I-1066-PIN-COMPUTED-NOT-HARDCODED (M-05 guard: body computes `max(ps.score)` + `LEAST(200, v_local_max+1)`)
- I-1066-PREVIEW-PROJECTED-FOR-NONSERVABLE (rank `projected:true` + UI label)
- I-1066-ONDEMAND-NO-SERVABLE-FLIP (M-06 guard: seed never UPDATEs place_pool)
- I-1066-ADMIN-OVERRIDE-STICKY-THROUGH-RESCORE (the sticky behavioral test)

---

## Cross-surface impact
Only **Admin Web** (`mingla-admin`, single React codebase → no manual parity split) + shared backend (single DB/edge). Consumer iOS/Android, buyer-anon web, business iOS/Android: NOT affected (serving RPC untouched; preview is admin-only projection; no native code).

---

## Discoveries for orchestrator
1. **COMMS ledger ack push deferred:** the anchor `main` tree is dirty with extensive foreign uncommitted + untracked work (Mapbox files, strict-grep deletions) from parallel sessions. My COMMS-0002/0003 ack commit (`03e2145bb`) is committed locally on the anchor but NOT pushed (merge/rebase blocked by foreign work; per shared-anchor + parallel-session-interference rules I did not disturb it). Orchestrator should push the ledger acks when the anchor is clean.
2. **Pre-existing `run-signal-scorer` type-cast errors** (`GenericStringError` on the `processPlaces(data as ...)` casts at the per-place + paging SELECTs) exist on `main` — flagged, not fixed (out of scope).
3. **Serving-gate drift:** `admin_pin_place_to_top` + `admin_place_deck_rank` copy the `query_servable_places_by_signal` WHERE clause verbatim (commented cross-reference). A future serving-gate change must update all three; a shared SQL gate helper would prevent drift (noted, not blocking).
4. **Path A shipped** for on-demand scoring (seed 16 @100, then tune) per SPEC OQ-1 recommendation; Path B (real rule-based projected scores via a new edge fn) is a future upgrade if seed-100 proves too coarse.

---

## Deploy checklist (orchestrator)
1. Merge branch `ORCH-1066-deck-score-tuner` → main via PR (required checks incl. ORCH-0863 strict-grep must be green; C7 verified locally exit 0).
2. `supabase db push --linked` from the worktree (migration `20260904000000`).
3. `supabase functions deploy admin-review-venue-claim` + `run-signal-scorer` from updated main; verify-first-call each (non-404).
4. Admin web auto-deploys on merge (Vercel).
5. Push COMMS ledger acks (`03e2145bb`) when anchor clean.
