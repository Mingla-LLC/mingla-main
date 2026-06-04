# QA — ORCH-1066 [admin deck score tuner + card preview]

**Verdict:** ✅ **PASS**
**Tester:** mingla-tester (Claude)
**Mode:** TARGETED — code-level + regression (live edge deploy + operator Lantern & Vine surfacing test are the orchestrator's job, OUT of scope here per dispatch)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1066-[deck-score-tuner]/` on branch `ORCH-1066-deck-score-tuner`
**Supabase project ref:** `gqnoajqerqhnvulmnyvv`
**Date:** 2026-06-03

- P0: 0 | P1: 0 | P2: 0 | P3: 0 | P4: 3
- **STICKY-THROUGH-APPROVAL invariant HOLDS** — an admin pin survives BOTH the approval re-score (clobber path) AND the AI veto-delete path. Proven by the implementor's behavioral test (6 pass, fails-on-revert 4-fail) AND my independent mixed-batch adversarial test (5 pass, fails-on-revert 2-fail), AND by reading the real scorer fail-close ordering.

**Sim evidence:** EXEMPT — the only UI surface is Admin Web (`mingla-admin`, single React-web codebase; SPEC §2 cross-surface table rows 1–7 all NO except Admin Web). No iOS/Android/native code touched. Backend is SQL/RPC + Deno edge (source-only sufficient per Phase 0.A exemption). Admin-web verification is vite-build-green + lint-clean + node --test green + live read-only DB introspection (the RPCs are already applied live).

**Regression tests:**
- implementor (happy-path) = `supabase/functions/run-signal-scorer/__tests__/orch_1066_sticky_override.test.ts` — 6 pass; ✅ fails-on-revert: neuter `isAdminOverridden→false` → 4 fail (T-01/02/03/05). Committed `3c77f6a49`.
- tester (adversarial, DIFFERENT angle) = `supabase/functions/run-signal-scorer/__tests__/orch_1066_sticky_mixed_batch.adversarial.test.ts` — 5 pass; ✅ fails-on-revert: neuter predicate → ADV-01/ADV-02 fail.

---

## 1. The 4 RPCs — live introspection (read-only, already applied)

Migration `20260904000000_orch_1066_deck_score_tuner.sql` is recorded in
`supabase_migrations.schema_migrations` (live). All 4 RPCs verified via
`pg_proc` + `pg_get_functiondef` against the live DB — the live bodies match the
worktree migration byte-for-byte on every locked construct.

| RPC | SECURITY DEFINER | search_path | admin gate | auth gate | grants (proacl) | locked construct present |
|---|---|---|---|---|---|---|
| `admin_set_place_signal_score(uuid,text,numeric,text)` | ✅ | `public, pg_temp` | `is_admin_user()` ✅ | `auth.uid() IS NULL` ✅ | authenticated+service_role only; **no PUBLIC/anon** ✅ | `p_score < 0 OR p_score > 200` guard ✅ + `_admin_set` marker ✅ |
| `admin_pin_place_to_top(uuid,text,double precision)` | ✅ | `public, pg_temp` | ✅ | ✅ | same ✅ | LOCKED rule `CASE WHEN v_local_max IS NULL THEN 200 ELSE LEAST(200, v_local_max + 1) END` ✅ + `_admin_pin` ✅ |
| `admin_place_deck_rank(uuid,text,double precision)` | ✅ STABLE | `public, pg_temp` | ✅ | ✅ | same ✅ | `projected = (v_is_servable IS NOT TRUE)` ✅ |
| `admin_score_place_preview(uuid)` | ✅ | `public, pg_temp` | ✅ | ✅ | same ✅ | `ON CONFLICT (place_id, signal_id) DO NOTHING` ✅ + seeds `, 100,` ✅ |

- **No PUBLIC/anon EXECUTE** on any of the 4 (proacl = `postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres`; the absence of a leading `=X/` (empty grantee) row proves PUBLIC was revoked). Matches `REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated`.
- **`admin_score_place_preview` NEVER flips is_servable/is_active** — confirmed live: `position('UPDATE public.place_pool SET is_servable' ...)=0` AND `... is_active=0` for all 4 functions. I-1066-ONDEMAND-NO-SERVABLE-FLIP holds at the DB level (the only `is_servable` text in the bodies is the serving-gate WHERE clause + protective comments, not a write).
- **MCP role cannot EXECUTE the RPCs** (`permission denied for function admin_place_deck_rank`) — independent proof the grant lockdown works (a non-granted caller is rejected before reaching the body).

### Independent projected-rank validation (T-11/T-13 on REAL data)
Replicated the RPC's exact gates+Haversine for Lantern & Vine (`8b720912`, lat 35.7989165 / lng -78.7381279, `is_servable=false`, `score_rows=0`) at a hypothetical `romantic=150`, 16 km:
- 1963 servable+scored+photo'd `romantic` places in radius → `above_150 = 46` → **projected_rank = 47 of 1964** (1963 others + the non-servable target via the `+1` normalization). `rank ≤ total` holds; matches the RPC algorithm exactly.

### Pin cap/tie edge case (T-09 on REAL data)
`drinks` near Lantern & Vine: real incumbent local-max = **200** → `LEAST(200, 201)=200`, `would_be_capped = true`. Matches the RPC's `capped`/`tie_warning` return. **Pin is computed, never a blind literal 200** — I-1066-PIN-COMPUTED-NOT-HARDCODED holds.

---

## 2. STICKY-THROUGH-APPROVAL (the load-bearing invariant) — HOLDS

### Mechanism (read at `run-signal-scorer/index.ts:282-341`)
After `processPlaces` populates `writes` + `vetoedPlaceIds`, BEFORE the upsert/delete batches, the scorer:
1. Builds the union of touched place_ids, chunk-pre-reads committed `place_scores.contributions` for `signal_id` (lines 305-309).
2. **Fail-close:** if the pre-read errors → returns HTTP 500 (lines 310-322) BEFORE any write — never proceeds and risks clobbering an unseen admin pin (Constitution #5).
3. Builds `protectedIds` via the shared pure predicate `isAdminOverridden()` (`_shared/stickyOverride.ts`, markers `_admin_set`/`_admin_pin`/`_admin_override`).
4. **Reverse-splices** protected ids out of BOTH `writes` (lines 331-333) and `vetoedPlaceIds` (lines 336-338). The admin score wins on BOTH the clobber path and the veto-delete path.

The approval re-score (`runApproveGoLive`) flips `is_servable=true` THEN invokes the scorer per signal — so the just-approved pinned venue DOES appear in `processPlaces` (it now passes the `is_servable=true` SELECT filter), making the sticky protection the only thing standing between the admin pin and a clobber/veto. The mechanism covers exactly that.

### Implementor's proof (verified independently)
`orch_1066_sticky_override.test.ts` — 6 pass (captured). Shares the REAL `isAdminOverridden`/`protectedPlaceIds` import; T-06 source-guard asserts the real scorer wires it. Fails-on-revert reproduced by me: neuter `isAdminOverridden→false` → **4 fail (T-01/02/03/05)**, restore → 6 pass. Matches the implementation report's claim exactly.

### Tester's adversarial proof (DIFFERENT angle)
`orch_1066_sticky_mixed_batch.adversarial.test.ts` — **5 pass** (captured). Attacks the **batch-interleaving + reverse-splice mechanics** (where off-by-one / forward-splice leaks live), which the implementor's one-protected-place-per-test never exercises:
- **ADV-01** — single re-score batch with protected (`_admin_pin`/`_admin_set`/`_admin_override`) and unprotected rows **interleaved** in BOTH the writes array AND the veto array. Asserts: pinned+set stay, override survives veto, an idle admin row is untouched, AND the 2 normal rows DO re-score, 1 normal vetoed row IS deleted. Catches a forward-splice that would skip an adjacent protected row.
- **ADV-02** — all-protected batch is a strict no-op (zero writes, zero deletes).
- **ADV-03** — cross-signal isolation: a `drinks` pin does NOT shield the same place's `romantic` computed row (stickiness is per `(place_id, signal_id)`).
- **ADV-04** — source-guard: the real scorer uses the descending `for (let i = …length - 1; i >= 0; i--)` reverse-splice for BOTH arrays (a forward splice would skip; locks the iteration direction).
- **ADV-05** — source-guard: the sticky pre-read fail-close `status: 500` return is positioned BEFORE the `.upsert(...)` (abort-not-clobber); proves the AI-veto/clobber can never silently win on a read error.

Fails-on-revert (captured): neuter `isAdminOverridden→false` → **ADV-01 + ADV-02 fail** (ADV-03/04/05 are cross-signal + source-guards, predicate-independent by design). Restore → 5 pass; combined run with the implementor's test → **11 pass**.

**Conclusion: an admin pin survives the approval re-score AND the AI veto-delete path. The invariant holds.**

---

## 3. Admin UI — no dead/duplicate controls vs the 1062 path

- `ClaimsPage.jsx` — the dead-end "Score override available after the venue is scored" copy + the brand-keyed override grid are **removed**; the modal now renders `<ScoreTunerPanel projected density="modal">`. `overrideClaimScore`/`submitScoreOverride`/`scoreDraft` no longer called from the modal (only referenced in removal comments). **No duplicate score controls.**
- **SC-8 preserved:** `adminClaimsService.js:121 overrideClaimScore` (the 1062 brand-keyed `admin_apply_score_override` channel) is **retained** for the approval `score_vetoes` path. The 1062 edge branches (`score_override`/`tweak_fields`/`add_feedback`) remain intact in `admin-review-venue-claim` (verified). 1062 RPC untouched.
- `ScoreTunerPanel.jsx` — when `scores.length===0` shows the **"Score this venue now"** seed button (→ `scorePlacePreview`). After seeding, the row list maps over the FULL active-signal catalog (`signals`), not just `scores` — so all 16 signals are editable from zero (SC-1). Per-row Set / Pin to top / live rank chip; radius selector 8/16/40 km; degraded state shows "Rank unavailable" (never a fake number).
- `DeckCardPreview.jsx` — **OMITS distance/travel** (only the explanatory caption "Distance & travel time appear on the buyer's device…" mentions them — no fabricated values); "No photo yet" placeholder for missing/`__backfill_failed__` hero; rating hidden when null/≤0. Pure rules in `lib/deckCardPreviewRules.js` (16 unit tests pass). Constitution #9 satisfied.
- `DeckScoreTunerPage.jsx` + nav: `App.jsx` PAGES `"deck-tuner"`, `constants.js` NAV_GROUPS entry (`SlidersHorizontal`), `Sidebar.jsx` ICON_MAP imports + registers `SlidersHorizontal`. Reachable at `#/deck-tuner` (SC-6).

---

## 4. Gates — all green (captured)

| Gate | Command | Result |
|---|---|---|
| Sticky deno test (implementor) | `deno test --allow-read .../orch_1066_sticky_override.test.ts` | 6 passed |
| Sticky deno test (tester adversarial) | `deno test --allow-read .../orch_1066_sticky_mixed_batch.adversarial.test.ts` | 5 passed |
| Tuner edge actions | `deno test --allow-read .../orch_1066_tuner_actions.test.ts` | 7 passed |
| Admin full suite | `npm test` (mingla-admin) | 19 passed / 0 fail |
| Admin lint | `eslint` on 7 ORCH-1066 files | exit 0 |
| Admin build | `vite build` | green (pre-existing chunk-size warning only) |
| Edge typecheck | `deno check admin-review-venue-claim/index.ts` | exit 0 (clean) |
| Edge typecheck | `deno check run-signal-scorer/index.ts` | 2 errors — **pre-existing on origin/main** (the `processPlaces(data as …)` casts, present at main lines 238/262). NOT introduced by ORCH-1066; sticky block type-checks clean. → P4 |
| strict-grep ORCH-0863 C7 | `node .../orch-0863-marketing-hub-phase-b.mjs` | All checks PASS (exit 0), C7 OK with `ORCH_1066_BACKEND_ALLOWLIST` |

### Fails-on-revert (both, captured)
Neutering `_shared/stickyOverride.ts isAdminOverridden → return false`:
- implementor test → **4 failed** (2 passed) — matches report.
- tester adversarial → **2 failed** (3 passed).
Predicate restored byte-identical (verified `git diff` empty on the tracked file).

---

## 5. Defects (severity-ranked)

- **P4-1 (note):** `run-signal-scorer/index.ts` carries 2 pre-existing `deno check` errors at the `processPlaces(data as Array<PlaceForScoring & {id:string}>)` casts. Confirmed identical on `origin/main` (lines 238/262). NOT an ORCH-1066 regression; flagged for a future type-hardening pass (same as implementor Discovery #2).
- **P4-2 (note):** the `admin_audit_log` inserts in the new edge actions are fire-and-forget (no await-error surfaced) — but this matches the pre-existing 1062 action pattern, and the score write itself already succeeded + returned before the audit insert. Consistent house style; not a silent-failure of the user-visible operation.
- **P4-3 (caught + fixed by tester):** my new adversarial test file is a NEW file under `supabase/functions/` and would have tripped the ORCH-0863 C7 `no-new-backend-files` gate on the closing PR. I added it to `ORCH_1066_BACKEND_ALLOWLIST` in the SAME commit as the test (per COMMS-0002) and re-ran the gate → still exit 0. Without this the closing PR would have failed CI.

No P0/P1/P2/P3.

---

## 6. Constitution (relevant rules)

| # | Rule | Verdict |
|---|---|---|
| 2 | One owner per truth | ✅ `place_scores.score` single coordinated UPSERT shape across scorer + 1062 + 3 new RPCs; `_admin_*` provenance keys auditable |
| 3 | No silent failures | ✅ sticky pre-read fails-close 500; edge actions surface RPC errors as JSON 400; rank degraded → "Rank unavailable" |
| 5 | Server state server-side | ✅ all authority in SECURITY DEFINER RPCs / edge fn |
| 9 | No fabricated data | ✅ distance/travel OMITTED (not faked); "No photo yet" placeholder; rating hidden null/≤0; rank null when unscored |
| others | — | N/A (no auth/logout/currency/datetime surface touched) |

---

## 7. Spec success criteria

SC-1..SC-10 all ✅ (see §1–§4). SC-9 note: ORCH-1066's `20260904000000` landed on remote BEFORE sibling ORCH-1065's `20260903000000` (1065 not yet on remote) — the two are non-colliding `CREATE OR REPLACE` migrations, version order is still monotonic, applied cleanly. No collision.

---

## 8. Discoveries for orchestrator

1. **Migration already live, ORCH-1065 not yet.** `20260904000000` is in `schema_migrations`; `20260903000000` (ORCH-1065) is NOT on remote. When 1065 later pushes, its lower-but-later version is harmless here (different RPCs, CREATE OR REPLACE). No action.
2. **Allowlist amended at QA time** (P4-3) — the tester adversarial test was added to `ORCH_1066_BACKEND_ALLOWLIST`. This ships in the QA commit on the ORCH branch; the closing PR inherits it. Confirm it's present before merge.
3. **Edge deploy still pending** (orchestrator): `admin-review-venue-claim` + `run-signal-scorer` must be deployed from updated main AFTER merge for the sticky behavior + tuner actions to be live (the migration/RPCs are already live; the scorer sticky-skip + edge actions are not until deploy). Live Lantern & Vine surfacing test is the operator's post-deploy job per dispatch.
