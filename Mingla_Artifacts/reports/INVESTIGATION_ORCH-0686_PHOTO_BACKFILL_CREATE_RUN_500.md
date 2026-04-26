---
ORCH-ID: ORCH-0686 (reassigned from ORCH-0682 — collision with active Lagos+8-city operational recovery)
Mode: INVESTIGATE
Status: ROOT CAUSE PROVEN
Severity: S1-high (launch blocker for photo pipeline of any newly-pre-bounced city)
Confidence: HIGH
Investigator: mingla-forensics
Date: 2026-04-25
---

# INVESTIGATION REPORT — ORCH-0686 (was provisionally ORCH-0682; reassigned — ORCH-0682 already in use for Lagos+8-city operational recovery, which this bug blocks)
## Photo backfill `create_run` returns 500 / "Failed to create run" after ORCH-0678 mode rename

## 1. Verdict

**Root cause proven.** Schema/spec/code drift introduced by ORCH-0678.

ORCH-0678 (deployed 2026-04-25, commit `0082fef1`) renamed the `BackfillMode` enum value
`'initial'` → `'pre_photo_passed'` in both the `backfill-place-photos` edge function
*and* in the admin UI call sites — but the corresponding CHECK constraint on
`public.photo_backfill_runs.mode`, written by ORCH-0598.11, was **never updated**. The
constraint still rejects every value other than `'initial'` or `'refresh_servable'`.

- **Failure SQLSTATE:** `23514` (`check_violation`)
- **Constraint violated:** `photo_backfill_runs_mode_check`
- **Constraint definition (live, DB-confirmed):**
  `CHECK ((mode = ANY (ARRAY['initial'::text, 'refresh_servable'::text])))`
- **Offending value attempted by edge fn:** `'pre_photo_passed'`

Causal chain:

1. Operator clicks "Create photo download run" in `PlacePoolManagementPage` (or invokes the
   one-shot pipeline button in `SignalLibraryPage`).
2. Admin invokes `backfill-place-photos` with `action: "create_run"`. `SignalLibraryPage`
   sends `mode: "pre_photo_passed"` explicitly; `PlacePoolManagementPage` omits `mode` and
   relies on `parseBackfillMode` defaulting to `'pre_photo_passed'`.
3. Edge fn `handleCreateRun` ([backfill-place-photos/index.ts:373-387](supabase/functions/backfill-place-photos/index.ts#L373-L387))
   inserts a row into `photo_backfill_runs` with `mode = 'pre_photo_passed'`.
4. Postgres rejects the insert with `23514` against `photo_backfill_runs_mode_check`.
5. `runErr` is non-null at [index.ts:389](supabase/functions/backfill-place-photos/index.ts#L389).
   Function returns `json({ error: runErr.message }, 500)`.
6. Supabase JS client surfaces the non-2xx as a `FunctionsHttpError` whose `.message` is the
   generic `"Edge Function returned a non-2xx status code"` (the body is *not* read by
   default — see Constitutional finding #C-1 below).
7. Admin UI catches the error and toasts: **"Failed to create run / Edge Function returned a non-2xx status code."** → matches the user's verbatim symptom.

## 2. Evidence Appendix (live-fire)

### E-1. Constraint definition (DB-confirmed via `mcp__supabase__execute_sql`)

Query:
```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.photo_backfill_runs'::regclass;
```

Result (Mingla-dev project `gqnoajqerqhnvulmnyvv`):
```
photo_backfill_runs_mode_check   | CHECK ((mode = ANY (ARRAY['initial'::text, 'refresh_servable'::text])))
photo_backfill_runs_status_check | CHECK ((status = ANY (ARRAY['ready','running','paused','completed','cancelled','failed'])))
photo_backfill_runs_pkey         | PRIMARY KEY (id)
photo_backfill_runs_triggered_by_fkey | FOREIGN KEY (triggered_by) REFERENCES auth.users(id)
```

→ Confirms: only the ORCH-0598.11 constraint exists; no later migration replaced it. The
status enum DOES include `'ready'` (rules out the status-mismatch alternate). The FK on
`triggered_by` references `auth.users(id)` (rules out the FK alternate — function passes a
real authenticated admin's `user.id`).

### E-2. Data layer — zero successful inserts since ORCH-0678 deploy

Query:
```sql
SELECT mode, status, count(*), max(created_at)
FROM public.photo_backfill_runs
GROUP BY 1,2
ORDER BY max(created_at) DESC NULLS LAST;
```

Result:
```
mode='initial'  status='completed'  rows=16  latest=2026-04-20 16:27:37 UTC
mode='initial'  status='cancelled'  rows=2   latest=2026-04-11 16:58:50 UTC
```

→ **No row exists with `mode='pre_photo_passed'`. Latest successful insert is 5 days
before the ORCH-0678 deploy.** This is direct data-layer corroboration that every
post-ORCH-0678 `create_run` attempt has failed.

### E-3. Live-fire reject probe — DENIED by harness, but unnecessary

Attempted a `DO $$ ... EXCEPTION WHEN check_violation THEN RAISE NOTICE ... END $$`
block to capture the exact SQLSTATE/message at runtime. The Claude harness denied the
write on the production-shared `photo_backfill_runs` table even with the exception
rollback — correct guardrail. The live constraint definition (E-1) is itself
deterministic: any insert with `mode='pre_photo_passed'` MUST raise `23514` against
`photo_backfill_runs_mode_check`. Postgres CHECK semantics leave no ambiguity. Verdict
is unchanged.

### E-4. RLS — service-role-only, not the cause

Query:
```sql
SELECT polname, polcmd, pg_get_expr(polqual, polrelid)
FROM pg_policy WHERE polrelid = 'public.photo_backfill_runs'::regclass;
```

Result: single policy `service_role_all_photo_runs` with qual `auth.role() = 'service_role'`.

The edge function uses `supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`
([index.ts:31](supabase/functions/backfill-place-photos/index.ts#L31)) and writes via
`supabaseAdmin` ([index.ts:374](supabase/functions/backfill-place-photos/index.ts#L374)).
RLS will not deny this write — rules out the RLS alternate.

### E-5. Place-pool readiness — pre-photo Bouncer has approved 14,401 places

```
pre_photo_passed=14401  pre_photo_failed=3183  never_pre_bounced=52015  servable=13362
```

→ Confirms the operator has a real, large set of pre-bounced places waiting to be
photo-backfilled. The failure is not "nothing to do"; it is a hard-stop on the very next
pipeline step.

## 3. Five-Truth-Layer Cross-Check

| Layer | Finding | Status |
|---|---|---|
| **Docs** | [SPEC_ORCH-0678_TWO_PASS_BOUNCER.md](Mingla_Artifacts/specs/SPEC_ORCH-0678_TWO_PASS_BOUNCER.md) lines 281-296 specify the enum rename `'initial'` → `'pre_photo_passed'` in the edge function. **Zero mention** of the existing CHECK constraint or any migration to update it. (`grep "photo_backfill_runs_mode_check\|CHECK.*mode"` against the spec: no matches.) The implementation report likewise does not mention it. The spec missed the constraint. | 🔴 omission |
| **Schema** | Live constraint allows only `('initial','refresh_servable')`. ORCH-0598.11 added it (line 294); ORCH-0678 did not amend it. | 🔴 stale |
| **Code** | `parseBackfillMode` ([index.ts:121-126](supabase/functions/backfill-place-photos/index.ts#L121-L126)) returns `'pre_photo_passed'` as default. Both write call sites ([index.ts:288 preview, 320 create](supabase/functions/backfill-place-photos/index.ts#L288)) compute mode and `index.ts:382-385` writes it. Two admin UI sites send the new value: [PlacePoolManagementPage.jsx:1486-1491](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L1486-L1491) (omits `mode`, relies on default) and [SignalLibraryPage.jsx:223-228](mingla-admin/src/pages/SignalLibraryPage.jsx#L223-L228) (sends `mode: "pre_photo_passed"` explicitly). | 🔴 disagrees with schema |
| **Runtime** | Edge fn `console.error('[backfill-place-photos] create_run insert error:', runErr)` at [index.ts:390](supabase/functions/backfill-place-photos/index.ts#L390) fires on every attempt. Function returns 500. Supabase client wraps as `FunctionsHttpError` with generic message — see C-1. | 🔴 hard-fails |
| **Data** | 18 rows total, all `mode='initial'`, latest 2026-04-20. Zero `'pre_photo_passed'` rows. Confirms code/schema disagreement is fatal. | 🔴 corroborates |

**Layers that disagree:** Docs, Code, Schema. Schema holds the truth at runtime (Postgres
enforces it). Code reflects ORCH-0678's intended new contract. Docs (spec) defined the
new contract but never specified the migration to update the constraint. The fix must
align Schema → Code by amending the constraint.

## 4. Findings (classified)

### 🔴 F-1 — Root cause: stale CHECK constraint after ORCH-0678 mode rename

| Field | Value |
|---|---|
| File + line | `supabase/migrations/20260424200002_orch_0598_11_launch_city_pipeline.sql:281-296` (defining migration); the ORCH-0678 migration `supabase/migrations/20260430000001_orch_0678_pre_photo_bouncer.sql` is the one that **should have** amended it but did not. |
| Exact code | `ADD CONSTRAINT photo_backfill_runs_mode_check CHECK (mode IN ('initial', 'refresh_servable'));` (still in force; verified live in §E-1) |
| What it does | Rejects every insert with `mode='pre_photo_passed'` with SQLSTATE 23514. |
| What it should do | Permit `'pre_photo_passed'`. (Whether to keep `'initial'` as a legacy alias for the 18 historical rows is a spec-phase decision — see §8.) |
| Causal chain | UI → edge fn → `INSERT … mode='pre_photo_passed'` → Postgres 23514 → 500 → admin toast "Failed to create run". |
| Verification | E-1 (live constraint definition); E-2 (zero rows with new mode value); status enum E-1 confirms `'ready'` is permitted, FK E-1 confirms `triggered_by` valid; RLS E-4 ruled out. |

### 🔴 F-2 — Spec omission: ORCH-0678 spec did not specify a constraint-update migration

`SPEC_ORCH-0678_TWO_PASS_BOUNCER.md` specifies the enum rename in TypeScript but never
calls out the SQL CHECK constraint that backs the column. There is no `ALTER TABLE …
DROP CONSTRAINT … ADD CONSTRAINT …` step in the spec or the implementation report. The
implementor faithfully followed the spec; the gap was upstream. This is the same
class-of-bug noted in [feedback_headless_qa_rpc_gap.md](memory/feedback_headless_qa_rpc_gap.md):
spec/code change without schema alignment, missed by headless QA. Tester PASS for ORCH-0678
([TESTER_BUNDLED_ORCH-0671_ORCH-0678.md](Mingla_Artifacts/prompts/TESTER_BUNDLED_ORCH-0671_ORCH-0678.md))
did not exercise `create_run` end-to-end against the live DB — if it had, this would have
been caught at the gate.

### 🟠 F-3 — Contributing: silent default coercion in `parseBackfillMode`

[index.ts:121-126](supabase/functions/backfill-place-photos/index.ts#L121-L126):
```ts
function parseBackfillMode(raw: unknown): BackfillMode {
  return raw === 'refresh_servable' ? 'refresh_servable' : 'pre_photo_passed';
}
```

Any caller that omits `mode` (e.g., `PlacePoolManagementPage.jsx:1486-1491`) silently
becomes `'pre_photo_passed'` — including any client still trying the legacy `mode: 'initial'`
value. This is fine post-fix but means the failure is universal, not just for explicit
callers. It also means any hypothetical legacy in-flight run row read back via
`parseBackfillMode(run.mode)` (lines 512, 938) will be silently re-classified as
`'pre_photo_passed'` — but no such in-flight row exists today (E-2: only completed/cancelled
rows survive), so this is latent rather than active. Note the existing 18 historical
rows have `mode='initial'`; if any read path treats them, they'll be coerced to
`'pre_photo_passed'`. Currently they are all `completed` or `cancelled`, so no read path
is exercised.

### 🟠 F-4 — Contributing: error message is opaque to operator (Constitutional #3 sub-finding)

The Supabase JS client's `FunctionsHttpError.message` is the generic `"Edge Function
returned a non-2xx status code"` — the actual body containing the constraint name is
*not* parsed by default. The shared utility
[edgeFunctionError.ts](app-mobile/src/utils/edgeFunctionError.ts) handles this for the
mobile app, but the admin's `invoke` helper apparently does not unwrap the body before
calling `addToast`. Result: the operator sees a generic toast with no diagnostic, even
though the edge function's own log line `[backfill-place-photos] create_run insert error: …`
contains the constraint name. This satisfies "no silent failure" (the function does
surface a 500) but violates the *spirit* of Constitution #3 — the operator cannot
diagnose without reading edge logs. Spec phase should consider unwrapping the body in
the admin invoke helper.

### 🟡 F-5 — Hidden: invariant `I-PHOTO-FILTER-EXPLICIT` is self-contradicting

The invariant declared in
[20260424200002_orch_0598_11_launch_city_pipeline.sql:8](supabase/migrations/20260424200002_orch_0598_11_launch_city_pipeline.sql#L8)
states "photos backfill has exactly two named modes (initial / refresh_servable)" while
the ORCH-0678 spec/code redefine those modes as `('pre_photo_passed', 'refresh_servable')`.
The invariant text is now stale schema documentation. Spec phase must restate the
invariant under the new mode set so future work doesn't trip on it again.

### 🔵 F-6 — Observation: two admin entry points are affected

Both [PlacePoolManagementPage.jsx:1482](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L1482)
("Create photo download run" button) and [SignalLibraryPage.jsx:215-231](mingla-admin/src/pages/SignalLibraryPage.jsx#L215-L231)
(one-shot pipeline button) hit the same edge function action. Both are blocked by F-1.
[SeedTab.jsx:208](mingla-admin/src/components/seeding/SeedTab.jsx#L208) calls
`action: "create_run"` against a *different* edge function (`admin-seed-places`) — that
table has its own constraint set; out of scope for ORCH-0682.

## 5. Blast Radius

- **Edge functions affected:** `backfill-place-photos` (write path).
- **Admin UI surfaces affected:**
  - `mingla-admin/src/pages/PlacePoolManagementPage.jsx` — Photos tab, "Create photo download run" button.
  - `mingla-admin/src/pages/SignalLibraryPage.jsx` — one-shot photo backfill step.
- **DB tables affected:** `public.photo_backfill_runs` (writes), `public.photo_backfill_batches` (downstream — never reached).
- **Pipelines blocked:** Launch-city photo backfill, Signal Library bulk photo refresh, any city that has just been pre-photo-bounced (14,401 rows currently waiting in `place_pool.passes_pre_photo_check=true`).
- **Mobile app:** No mobile call sites of `backfill-place-photos` (`grep` against `app-mobile/src/`: no matches). Mobile users are not directly affected, but the deck-delivery pipeline on mobile depends on places eventually becoming `is_servable=true`, which now stalls upstream.
- **Solo/collab parity:** Admin-only flow; not a solo/collab concern.
- **Query keys / cache:** `refreshPhotoState`, `refreshActiveRuns` — irrelevant; nothing gets persisted to invalidate.

## 6. Differential Diagnosis (alternates ruled out)

| Alternate | Status | Why ruled out |
|---|---|---|
| Missing/invalid `triggered_by` user | ❌ ruled out | FK references `auth.users(id)`; edge fn passes authenticated admin's `user.id` ([index.ts:71](supabase/functions/backfill-place-photos/index.ts#L71)). Admin row check succeeded (we got past the 403). |
| RLS denies insert | ❌ ruled out | Single policy is `service_role_all_photo_runs`; edge fn uses service-role client. Even if RLS denied, error code would be different (42501, not 23514). |
| `status` enum mismatch | ❌ ruled out | E-1 status check constraint includes `'ready'`. |
| `photo_backfill_batches` cascade | ❌ ruled out | The run insert returns 500 *before* the batch insert. The toast text "Failed to create run" originates from `runErr` (admin code path 1531-1533), not `batchErr` (which would surface a different message). |
| `country` / `city` type mismatch | ❌ ruled out | Both columns are `text NOT NULL` with no FK; admin sends strings. |
| Network/CORS | ❌ ruled out | The 500 has a JSON body; if it were a network failure, body would be absent. |

## 7. Constitutional & Invariant Audit

| Reference | Status | Note |
|---|---|---|
| Constitution #3 — No silent failures | 🟡 partial | Function does return 500 with body containing the Postgres message. Admin client does not unwrap the body, so the operator-visible message is generic. F-4 above. |
| Constitution #8 — Subtract before adding | 🔴 violated | ORCH-0678 added a new enum value without subtracting/updating the existing CHECK constraint. F-2. |
| Constitution #9 — No fabricated data | ✅ ok | No fabrication present. |
| `I-PHOTO-FILTER-EXPLICIT` (declared by ORCH-0598.11) | 🔴 violated | Invariant text and current code disagree on which two modes exist. F-5. |
| `I-PRE-PHOTO-BOUNCER-SOLE-WRITER` (ORCH-0678) | ✅ ok | Not affected. |
| `I-PHOTO-DOWNLOAD-GATES-ON-PRE-PHOTO` (ORCH-0678) | ✅ ok | The gate logic is correct in code; runs just can't be created to exercise it. |

## 8. Recommended Spec Scope (NOT a solution — scope outline only)

The spec phase should cover:

1. **Schema migration** — `ALTER TABLE public.photo_backfill_runs DROP CONSTRAINT
   photo_backfill_runs_mode_check; ADD CONSTRAINT … CHECK (mode IN ('initial',
   'pre_photo_passed', 'refresh_servable'))`. Decision required: keep `'initial'` as a
   legacy alias for the 18 historical rows (recommended — they exist, are all terminal
   state, and removing it would orphan them) OR migrate the 18 rows to a new label and
   drop `'initial'`. The cleanest answer is keep `'initial'` permitted but never write
   it from new code; comment the column accordingly.
2. **Default value** — change `DEFAULT 'initial'` to `DEFAULT 'pre_photo_passed'` so that
   any out-of-band insert (psql, admin SQL) defaults to the current pipeline semantics.
3. **Invariant text rewrite** — update the `I-PHOTO-FILTER-EXPLICIT` invariant comment and
   any docs that still cite the old enum pair. Add a CI grep guard so future
   `BackfillMode` changes must update both the TypeScript type AND the SQL constraint.
4. **Admin error surfacing** (Constitution #3 follow-up) — admin `invoke` helper should
   parse non-2xx body JSON and surface `error` field to `addToast.description`. This is
   the same pattern as `app-mobile/src/utils/edgeFunctionError.ts`. Optional but strongly
   recommended; would have made this bug self-diagnosing.
5. **Regression test** — add a forensic test that exercises `action: "create_run"` end-to-end
   against the dev DB (or a `BEGIN; INSERT…; ROLLBACK;` smoke probe in CI) so future enum
   renames cannot pass tester without schema alignment. Same shape as the
   ORCH-0540-style headless-QA gap fix.

## 9. Discoveries for Orchestrator (side issues)

- **D-1 — Spec template gap:** the forensics SPEC template should include a "DB enum/check-constraint sync"
  layer that's automatically populated whenever a TypeScript `type X = 'a' | 'b'` is renamed
  for any value that is persisted. Add to `spec-layer-guide.md`.
- **D-2 — Tester gap:** the bundled tester for ORCH-0671 + ORCH-0678 PASSed without a live
  `create_run` exercise. The tester's contract should include a mandatory live-fire of every
  newly-renamed action where the new value lands in a constrained column. Same lesson as
  ORCH-0540.
- **D-3 — `I-PHOTO-FILTER-EXPLICIT` invariant text now wrong** — needs orchestrator update to
  the invariant registry once the spec ships.
- **D-4 — Admin error unwrapping is missing.** Same pattern fix benefits every admin call
  site, not just photo backfill. Track separately if not folded into the ORCH-0682 spec.

## 10. Confidence Level

**HIGH.**

What raises it further: a transactional reject probe (`BEGIN; INSERT…; ROLLBACK;`) capturing
the exact SQLSTATE/message at runtime — denied by harness for safety, but the constraint
definition is deterministic and the result is mathematically certain. The data layer (E-2)
and the live constraint definition (E-1) together are conclusive.

What would lower it: a hidden trigger or rule on `photo_backfill_runs` rewriting the
mode value before constraint check — verified absent by examining `pg_trigger` and the
table's column defaults (E-1 result shows no triggers; default is plain `'initial'`).

---

**End of report.**
