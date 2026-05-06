# INVESTIGATION REPORT — ORCH-0731 B1 HISTORICAL FORENSICS

**Mode:** INVESTIGATE (PASS-10 — historical forensics on B1 brands setup)
**Dispatch anchor:** [`prompts/INVESTIGATION_ORCH_0731_B1_HISTORICAL_FORENSICS.md`](../prompts/INVESTIGATION_ORCH_0731_B1_HISTORICAL_FORENSICS.md)
**Predecessors:** ORCH-0728 PASS-1..6 + ORCH-0729 (PASS-7) + ORCH-0730 (PASS-8) + 9 implementor passes
**Authored:** 2026-05-06

---

## 1. Layman summary

The investigation pivoted on a critical operator observation: brand-create has NEVER successfully run in this Supabase project (`brands.relpages = 0`, count = 0 ever). The bug is NOT a Cycle 17e-A regression — it's a latent B1 bug that 17e-A surfaced because 17e-A is the first cycle to actually wire brand INSERT to the real Supabase table (pre-17e-A wrote to local Zustand only). Operator's "I created a brand once with icloud" memory refers to that local-only Zustand path.

Historical archaeology of B1 reveals: the brands setup, RLS policy, and grants in B1's original migrations match the squashed migration matches live DB matches what we recreated. Every Copilot review fix was either unrelated to the INSERT path OR introduced caller-scoped wrappers that the brands-INSERT policy doesn't use. **The brands-INSERT policy is exactly `account_id = auth.uid() AND deleted_at IS NULL`** — straightforward, no helper functions called, no hooks.

We have now formally proven a Postgres-side contradiction: under simulated authenticated context, `SELECT (b17e3e15...::uuid = auth.uid())` returns TRUE, `SELECT (NULL::timestamptz IS NULL)` returns TRUE, but `INSERT INTO brands (account_id) VALUES (b17e3e15...)` returns 42501. **This contradicts the Postgres documentation of WITH CHECK evaluation.** Either there's a Postgres-side quirk in how WITH CHECK evaluates predicates under specific GUC + SET LOCAL ROLE conditions, OR Supabase has a platform-layer hook we can't see.

**Findings:** 0 root causes proven · 1 contradiction formally documented · 6 historical hypotheses REJECTED (B1 setup correctness, Copilot review changes, biz_* privileges, column-level grants, FK chain corruption, table rewrite desync) · 2 still untested (H39 RLS rebind + Supabase platform).

**Confidence:** root cause **INCONCLUSIVE** at PASS-10. Definitively gated on (a) operator running H39 hypothesis-killer (`ALTER TABLE ... DISABLE/ENABLE RLS`) AND (b) Supabase platform-layer visibility we don't have.

---

## 2. Critical evidence pivot (this pass)

### 2.1 Brand-create has NEVER worked in this project

| Probe | Result | Interpretation |
|---|---|---|
| `count(*) FROM public.brands` (all) | 0 | NO brand row ever existed |
| `min(created_at) FROM public.brands` | NULL | Confirms no row ever |
| `relpages` for brands | 0 | Table has zero data pages on disk |
| `relpages` for creator_accounts | 1 (3 rows) | Creator_accounts has data |
| `count(*) FROM public.audit_log` | 0 | Never any audit events |

This rules out "the bug is a regression." It's a latent B1 bug exposed by 17e-A's real DB write path.

### 2.2 B1 git history — what was actually deployed

| Commit | Date | Description |
|---|---|---|
| `2d21222e` | 2026-05-01 | feat(db): B1 phase 0 — biz_role_rank helper for RLS |
| `b0259f3f` | 2026-05-01 | feat(db): B1 phase 1 — creator_accounts extension + account_deletion_requests |
| `0dc7b3cd` | 2026-05-01 | **feat(db): B1 phase 2 — brands, team members, invitations + RLS** |
| `e4412602` | 2026-05-01 | feat(db): B1 phase 3 — events + event_dates with RLS |
| `9954dd69` | 2026-05-01 | feat(db): B1 phase 4 — ticket_types + waitlist_entries with RLS |
| `8323a909` | 2026-05-01 | feat(db): B1 phase 5 — orders + order_line_items with RLS |
| `11d8b468` | 2026-05-01 | feat(db): B1 phase 5b+6 — orders FK; scanners, tickets, scan_events |
| `7b20715b` | 2026-05-01 | feat(db): B1 phase 7 — permissions_matrix seed, audit_log |
| `4ae3a08c` | 2026-05-01 | feat(db): B1 phase 8 — Stripe ledger tables + payment RLS |
| `35e94cbc` | 2026-05-01 | feat(db): B1 phase 9 — public anon policies + events/brands/organisers views |
| `d46ceb6c` | 2026-05-01 | fix(db): address Copilot PR review on B1 migration |
| `488e9090` | 2026-05-01 | **fix(db): second Copilot review — consistency triggers, RLS helpers, anon column grants** |
| `836ce108` | 2026-05-02 | **fix(b1): Copilot review — public view, attendee default, caller-scoped biz_*** |
| `d8b5a28c` | 2026-05-?? | feat(supabase): ORCH-0706 — PR #59 B1.5 backend hardening migration |
| `9d879ac2` | 2026-05-?? | chore(orch): ORCH-0706 CLOSE Grade A + Mingla Business backend LIVE |
| `361e0c56` | 2026-05-01 | refactor(db): consolidate Cycle B1 into one migration file |
| `6b91c3ec` | 2026-05-05 | fix(supabase): ORCH-0729 — squash 493 historical migrations |

### 2.3 Diff: B1 phase 2 brands ↔ B1 phase 1 creator_accounts (per dispatch §4.4)

| Aspect | brands (broken) | creator_accounts (works) | Difference impact |
|---|---|---|---|
| INSERT policy text | `account_id = auth.uid() AND deleted_at IS NULL` | `auth.uid() = id` | Different ID column name; same auth.uid() pattern |
| RLS enabled | YES, before policies created | YES, before policies created | Same |
| Policy `TO authenticated` clause | YES | YES | Same |
| Policy `permissive` flag | TRUE | TRUE | Same |
| Schema modifications post-creation | 17e-A added 6 NOT NULL DEFAULT cols (table rewrite) | None | **DIFFERENCE — but H39 hasn't been tested** |
| Triggers | 3 user UPDATE-only + RI internal | 1 user (updated_at) + RI | Different but UPDATE triggers don't fire on INSERT |
| ACL grants (table-level) | postgres=arwdDxtm, authenticated=arwdDxtm, anon=awdDxtm | Same | Identical |
| ACL grants (column-level for authenticated) | All present (probed) | All present | Identical |
| Functions called by RLS policy | NONE (just `auth.uid()`) | NONE (just `auth.uid()`) | Same |

**No structural difference in the INSERT policy chain.** Yet brands fails, creator_accounts works.

### 2.4 Copilot review impact on brands-INSERT path

Two Copilot review commits modified RLS:

**`488e9090` (2nd review):**
- Added `INNER JOIN public.brands b ON b.id = m.brand_id` to `biz_brand_effective_rank` (team branch ignores soft-deleted brands)
- Added column-level GRANTs for `anon` on creator_accounts and brands
- REVOKE'd ALL on biz_* functions FROM PUBLIC; explicitly GRANTed to authenticated + service_role

**`836ce108` (3rd review):**
- Default brands.display_attendee_count to true
- Added `*_for_caller(uuid)` SECURITY DEFINER wrappers using `auth.uid()`
- RLS and triggers updated to call `_for_caller` versions
- Said "revoke EXECUTE on 2-arg biz_* from authenticated" — but live DB shows authenticated still HAS EXECUTE on 2-arg versions

**Critical observation:** The brands-INSERT policy `account_id = auth.uid() AND deleted_at IS NULL` does NOT call any `biz_*` function. So neither Copilot review modified the brands-INSERT path. Bug must be elsewhere.

---

## 3. Findings (classified — PASS-10)

### 🔴 ROOT CAUSE — STATUS: STRUCTURALLY IMPOSSIBLE PER AVAILABLE EVIDENCE

#### F-12 — Postgres (or Supabase platform) denies brands INSERT WITH CHECK despite predicate evaluating TRUE

| Field | Value |
|---|---|
| File + line | (Architectural — no specific code line; the contradiction is between Postgres's WITH CHECK enforcement and observable predicate evaluation) |
| Exact code | RLS policy: `WITH CHECK ((account_id = auth.uid()) AND (deleted_at IS NULL))` |
| What it does | At INSERT time, evaluates the WITH CHECK predicate against the new row + current auth context. Returns 42501 (RLS denial). |
| What it should do | The predicate should evaluate to TRUE because: (a) `account_id` value supplied = `b17e3e15-218d-475b-8c80-32d4948d6905`, (b) `auth.uid()` resolves to `b17e3e15-218d-475b-8c80-32d4948d6905` (PROVEN via STEP B-1 SELECT), (c) `deleted_at` defaults to NULL. The INSERT should succeed. |
| Causal chain | Cannot construct — every evidence layer says ALLOW, runtime says DENY |
| Verification step | Already ran: 9 forensic passes + 8 Dashboard SQL probes + DROP+CREATE policy. All confirm contradiction. Final verification gates: (a) H39 RLS rebind test, (b) Supabase platform-layer trace |

**Confidence:** Genuinely contradictory. Cannot be PROVEN from available evidence.

### 🟡 HIDDEN FLAWS (carried from prior passes — not directly causing brand-create failure but real bugs)

| # | Description | Severity |
|---|---|---|
| H-1 to H-14 | Per ORCH-0728 PASS-3 forensic catalog (~50 silent-failure sites in mingla-business) | P0–P2 |
| H-15 | reapOrphanStorageKeys allowlist missing `currentBrand.v13` | P2 |
| H-16 | Persist migrate v12→v13 doesn't nuke stub-id currentBrand | P1 (regression) |
| **H-NEW-1** | **`ensureCreatorAccount` upsert fires TWICE per auth event** (bootstrap + onAuthStateChange listener both call it) | P2 — observed in API logs; 2x request volume on auth |

### 🔵 OBSERVATIONS

| Obs | Note |
|---|---|
| O-1 | `brands.relpages = 0` is the formal proof that NO brand row has EVER persisted — separate from RLS deny |
| O-2 | Project's JWT TTL is 30 days (unusually long; operator-set). Eliminates expiry hypothesis class. |
| O-3 | B1 was deployed via 10 phased commits + 3 review fixes + 1 consolidation + 1 squash. Production DB state was set by the original phased migrations (which were applied, then deleted from migrations table when squash replaced them). |
| O-4 | The brands_public_view has `security_invoker = true` (Postgres 15+ feature). Doesn't affect INSERT. |
| O-5 | 70k requests/24h is mostly admin dashboard auto-polling (not the brand-create bug). Side concern. |

---

## 4. Five-Layer Cross-Check (PASS-10)

| Layer | Truth |
|---|---|
| Docs | B1 spec + IMPL describes brand-create as "RLS WITH CHECK enforces account_id = auth.uid()". Matches expectation. |
| Schema | All schema correct: 25 columns, 5 PERMISSIVE policies (no restrictive), 0 INSERT triggers, all CHECKs valid, FK chain intact, ACL grants present at table + column level for authenticated. |
| Code | Static analysis exhausts. Mapper output correct. mutationFn safe. Raw fetch with explicit headers reproduces same denial. Copilot review fixes don't touch INSERT path. |
| Runtime | **OPAQUE — primary diagnostic blocker.** Postgres/PostgREST internals not exposed to operator. |
| Data | `brands.relpages=0`, `count=0`, `audit_log=0`. brands has NEVER had a row written. creator_accounts works. |

**Layer disagreement:** Docs + Schema + Code unanimously say ALLOW. Runtime says DENY. Data confirms the denial has been consistent since B1 deployment. Without runtime visibility (which only Supabase has), we cannot reconcile.

---

## 5. Hypothesis matrix — final state

| # | Hypothesis | Status | Evidence |
|---|---|---|---|
| F-1 | PostgREST cache stale | REJECTED | NOTIFY pgrst sent in PASS-1; bug persists |
| F-2 | Silent auth-not-ready return | REJECTED | Diagnostic patch confirmed mutateAsync fires |
| F-3 | JWT/session race | REJECTED | Fresh sign-in still 42501s; session present + valid |
| F-4 | Catch swallows error | CONFIRMED — diagnosis blocker; not the cause |
| F-5 | Optimistic rollback flash | CONFIRMED — UX symptom only |
| F-6 | Stub-brand persist survival | CONFIRMED — separate side bug |
| F-9 | Session expired | REJECTED — 30-day TTL, fresh sign-in 36s old |
| F-10a/b/c/d | Env mismatch / stale anon / supabase-js header / JWT format | REJECTED — env config matches, raw fetch reproduces, JWT claims correct |
| F-11 | Recovery-event side effect | UNLIKELY — recovery worked successfully per audit log |
| H7 | FK mismatch | REJECTED — FK chain confirmed |
| H10 | Undeclared field | REJECTED — mapper output matches schema |
| H11 | auth.uid() mismatch | REJECTED — auth.uid() resolves correctly |
| H12 | INSERT trigger | REJECTED — 0 INSERT-fired user triggers; only RI internal FK |
| H13 | TopSheet event propagation | REJECTED — direct fetch reproduces |
| H14 | Empty CHECK | REJECTED — payload satisfies all CHECKs |
| H15 | mutationFn pre-Supabase throw | REJECTED |
| H17a/b | Stale bundle | REJECTED — diagnostic markers fire |
| H18-H21 | Misc state hypotheses | REJECTED |
| H22 | No session at PostgREST | REJECTED — session.access_token present |
| H23 | Wrong-user session | REJECTED — matches=true |
| H24 | JWT not attached / header mismatch | REJECTED — raw fetch with explicit headers reproduces |
| H25 | JWT silently degrades to anon | REJECTED — creator_accounts probe returns operator's row (proves auth.uid() resolves) |
| H32 | JWT format / claim | REJECTED — auth.users.aud = "authenticated" matches |
| H33 | B1 original migration had quirks | REJECTED — original B1 phase 2 file matches squash matches live |
| H34 | Custom function/extension hook | REJECTED — pg_extension probed; only standard Supabase extensions |
| H35 | B1 brands ≠ creator_accounts setup | REJECTED — both follow `auth.uid() = id` pattern |
| H36 | B1 implementation report deferred issue | (Not deeply pursued — Fehintola B1 IMPL reports not enumerated) |
| H37 | Postgres extension affects RLS | REJECTED — checked `pg_extension` against allowlist |
| H38 | Table internal state desync | REJECTED — pg_class probe shows clean state |
| **H39** | **Cycle 17e-A ALTER TABLE rewrite desynced RLS bindings** | **UNTESTED** — operator hasn't run DISABLE/ENABLE RLS |
| H40 | Supabase platform-level config | UNTESTABLE from outside | **Path C escalation** |

---

## 6. Blast radius

ALL RLS-gated mutations across mingla-business are predicted to fail with 42501:
- brands INSERT/UPDATE/DELETE — confirmed broken
- brand_team_members INSERT/UPDATE/DELETE — predicted broken
- brand_invitations INSERT — predicted broken
- events INSERT/UPDATE/DELETE — predicted broken (Cycle 3+ event creator)
- event_dates / ticket_types / orders / scan_events — predicted broken

Account-related mutations on `creator_accounts` work (proven via probe).

**Operator MUST NOT release until F-12 root cause is found and fixed.**

---

## 7. Fix strategy (next steps)

### Phase 1 — H39 hypothesis-killer (1 minute, by operator in Dashboard)

```sql
ALTER TABLE public.brands DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
```

Then immediately retry brand-create from app. If 17e-A's ALTER TABLE column adds desynced RLS bindings, this rebind clears the issue. **If it works, that's the fix.** If not, H39 REJECTED → Path C.

### Phase 2 — Supabase support escalation (Path C)

If H39 doesn't fix it, escalate to Supabase support with this evidence package:

1. Project ref: `gqnoajqerqhnvulmnyvv`
2. brands.account_id RLS WITH CHECK denies INSERT despite:
   - `auth.uid()` resolves to operator's user.id under simulated authenticated context (verifiable)
   - `account_id = auth.uid()` evaluates TRUE in standalone SELECT (verifiable)
   - `deleted_at IS NULL` evaluates TRUE
   - WITH CHECK should pass; returns 42501
3. Service-role INSERT works (schema is fine)
4. brands.relpages = 0 (NEVER had a row inserted via authenticated role)
5. Other tables (creator_accounts) with same RLS pattern work fine
6. Reproducible test in Dashboard SQL editor (provided)
7. Ask: **internal RLS evaluation trace + PostgREST log for the failing INSERT**

---

## 8. Discoveries for orchestrator

| ID | Severity | Description |
|---|---|---|
| **D-ORCH-0731-FOR-1** | NEW | The bug is NOT a Cycle 17e-A regression — it's a B1 latent bug exposed by 17e-A's first real DB write path. Reframe SPEC_ORCH_0729 accordingly. |
| **D-ORCH-0731-FOR-2** | NEW | `ensureCreatorAccount` fires twice per auth event (bootstrap + onAuthStateChange) — observed in API logs. Halves auth-related request count if fixed. Register as ORCH-0732. |
| **D-ORCH-0731-FOR-3** | Forward | Supabase escalation should request internal RLS evaluation trace + PostgREST log for one failed INSERT — that's the only remaining diagnostic angle. |
| **D-ORCH-0731-FOR-4** | NEW | The brands_public_view has `security_invoker = true`. Worth verifying this doesn't cause unexpected behavior in any of the SELECT-after-INSERT chains. |
| **D-ORCH-0731-FOR-5** | NEW | We did NOT enumerate Fehintola's B1 implementation report — that file may exist and contain notes on brands-specific deferred issues. Future investigation should grep `Mingla_Artifacts/reports/` for any B1 report. |

---

## 9. Confidence assessment

| Item | Confidence |
|---|---|
| Bug is latent in B1 setup, not a 17e-A regression | HIGH |
| B1 brands-INSERT policy text is correct | HIGH |
| Copilot review changes don't affect brands-INSERT path | HIGH |
| `auth.uid()` resolves correctly under simulated context | HIGH |
| Schema accepts row when RLS bypassed | HIGH |
| Predicate evaluates TRUE in standalone SELECT | HIGH |
| INSERT WITH CHECK denies despite predicate TRUE | HIGH (proven contradiction) |
| Root cause in catalog/grants/code | REJECTED |
| Root cause in H39 (RLS rebind) | UNTESTED — pending operator |
| Root cause in Supabase platform-layer (H40) | MEDIUM (most likely remaining) |

---

**Authored:** 2026-05-06
**Authored by:** mingla-forensics (PASS-10 / ORCH-0731)
**Status:** Static + historical analysis exhausted. Root cause INCONCLUSIVE; gated on H39 test + Supabase platform visibility.
**Next step:** Orchestrator routes to (a) operator runs H39 DISABLE/ENABLE RLS test (1 min), then (b) if H39 doesn't fix it → Path C Supabase support escalation with this report as evidence package.
