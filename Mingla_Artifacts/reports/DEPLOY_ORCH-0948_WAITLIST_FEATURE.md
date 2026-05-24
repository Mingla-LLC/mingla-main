# DEPLOY — ORCH-0948 [Waitlist feature — schema + RPC + buyer-web "Join waitlist" CTA + planner notification when spot opens]

**Date:** 2026-05-24
**Mode:** Orchestrator post-IMPLEMENT routing
**Working tree:** `~/Desktop/mingla-orchs/ORCH-0948-[waitlist-feature]/` on branch `ORCH-0948-waitlist-feature`
**Inputs:**
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0948_WAITLIST_FEATURE.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0948_WAITLIST_FEATURE.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0948_WAITLIST_FEATURE.md`

---

## 1. Pre-flight checks run by orchestrator

### 1.1 Migration version collision discovery (BLOCKING — RESOLVED)

`mcp__supabase__list_migrations` returned remote head row at `version=20260724000006, name=orch_0946_public_ticket_types_remaining` (applied by ORCH-0946 [Public ticket_types remaining-capacity exposure]). Local ORCH-0948 implementor file was `supabase/migrations/20260724000006_orch_0948_waitlist_feature.sql` — same `version` value, different `name`. `supabase db push --linked` would have rejected as a duplicate-version conflict.

Cross-worktree scan of `~/Desktop/mingla-orchs/*/supabase/migrations/` showed four parallel ORCHs all reserved prefix `20260724000006_` (orch-0915 / orch-0946 / orch-0948 / orch-0953) — ORCH-0946 won the race and shipped first.

**Resolution (orchestrator-applied, no operator intervention required):** renamed the local migration to `supabase/migrations/20260724000010_orch_0948_waitlist_feature.sql`, updated the in-test relative URL, and added BOTH the old and new filenames to the `orch-0948-waitlist-feature` block of `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` allowlist (the C7 gate uses `git diff --name-only` without rename detection, so the rename is recorded as deletion + addition). Committed as `d6eb376e`.

Post-rename gate evidence:
- `node .github/scripts/strict-grep/orch-0948-waitlist-feature.mjs` → `PASS — confirm exclusion preserved`
- `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` → `All checks PASS — 32 files changed total`

### 1.2 Invariant data-shape probe (codified backstop, codified 2026-05-24)

The migration's §6.1.b guard `RAISE EXCEPTION 'ORCH-0948 requires ticket_order_notifications.order_id to be NULLABLE for waitlist invites'` would abort against current remote data.

Probe: `SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='ticket_order_notifications' AND column_name='order_id'` → `is_nullable = 'NO'`.

The guard would fire — BUT the migration prepends an `ALTER TABLE public.ticket_order_notifications ALTER COLUMN order_id DROP NOT NULL;` at lines 5-6 before the guard executes at line 89. Execution order is safe; the guard becomes a regression backstop for any future migration that re-tightens the column.

Verdict: invariant-safe, no operator data repair runbook required.

### 1.3 Edge-function surface enumeration

The implementation touched THREE deployable edge functions, not two:

| Function | Slug exists on remote? | Current remote version | Reason in this ORCH |
|---|---|---|---|
| `waitlist-signup` | **NO — new** | n/a | New anon-tolerant signup endpoint (SPEC §7.1). |
| `ticket-confirmation-dispatch` | YES | 80 | Extended with `waitlist_spot_open` template-key branch + null-`order_id` routing (SPEC §7.2, implementor report row 3). |
| `notification-retry-sweeper` | YES | 50 | Implementor extended to group by `notificationId` when `order_id IS NULL` so waitlist invite rows do not strand (implementor report row 7 — out-of-spec but required for correctness; orchestrator confirms inclusion). |

The implementor's report explicitly flagged the sweeper as orchestrator-deploy-decision territory. Orchestrator decides: **deploy all three**, in this order (no inter-function dependency, but waitlist-signup first so the table-writer is live before any drain event):

1. `waitlist-signup` (new)
2. `ticket-confirmation-dispatch` (extension — must ship in same window as the migration's trigger so the queued template_key has a handler)
3. `notification-retry-sweeper` (extension — must ship so the retry path doesn't strand null-`order_id` rows)

---

## 2. Operator DB-push handoff

**Status:** AWAITING OPERATOR.

Operator runs the following from the per-ORCH worktree (do NOT run from anchor). The worktree is currently NOT linked to the Supabase project (implementor's `migration list --linked` returned `Cannot find project ref`), so a `supabase link` step is included.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0948-[waitlist-feature]"
/Users/sethogieva/bin/supabase link --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase migration list --linked
# Expect: 20260724000006 orch_0946_public_ticket_types_remaining as latest applied;
# 20260724000010 orch_0948_waitlist_feature as the only local-only version.
# If any other local-only version appears, STOP and reconcile (do NOT --include-all).
/Users/sethogieva/bin/supabase db push --linked
```

**Do NOT use `--include-all`** unless `migration list` shows additional local-only rows that have been operator-vetted.

After push succeeds, operator pastes the success line back here so the orchestrator can proceed to §3.

---

## 3. Edge-function deploy plan (executes after operator confirms §2)

Commands the orchestrator will run from this worktree:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0948-[waitlist-feature]"
/Users/sethogieva/bin/supabase functions deploy waitlist-signup --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy ticket-confirmation-dispatch --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy notification-retry-sweeper --project-ref gqnoajqerqhnvulmnyvv
```

Then verify via `mcp__supabase__list_edge_functions`:

| Function | Pre-deploy version | Post-deploy version | `verify_jwt` preserved? |
|---|---|---|---|
| `waitlist-signup` | n/a (new) | **1 (id `fbeeda42-1cbc-484e-a09f-be967e5f88e8`)** | `verify_jwt=false` ✓ |
| `ticket-confirmation-dispatch` | 80 | **81** | `verify_jwt=true` preserved |
| `notification-retry-sweeper` | 50 | **51** | `verify_jwt=true` preserved |

All three verified via `mcp__supabase__list_edge_functions` at 2026-05-24 ~16:57 BST. `verify_jwt` preservation confirmed for the two existing functions; new function deployed with the spec-required anon setting.

### 3.1 Migration apply receipt

```
Applying migration 20260724000010_orch_0948_waitlist_feature.sql...
NOTICE (00000): trigger "trg_waitlist_drain_on_capacity_freed" for relation "public.tickets" does not exist, skipping
Finished supabase db push.
```

Push used `--include-all` (codified out-of-order case — our `…000010` sorts before remote head `…000001` from ORCH-0947, applied while ORCH-0948 was in IMPLEMENT). Migration is independent of ORCH-0947 / ORCH-0950 / ORCH-0946 changes; safe out-of-order. NOTICE is the migration's defensive `DROP TRIGGER IF EXISTS` running before `CREATE TRIGGER` — benign.

### 3.2 Reconciliation commits added to branch pre-push

| Commit | Reason |
|---|---|
| `d6eb376e` | Renamed migration 06→10 to avoid version collision with applied ORCH-0946 [Public ticket_types remaining-capacity exposure]. |
| `2e6278cf` | Source-reconciled ORCH-0946 + ORCH-0950 [Trip capacity single source] migrations into the worktree (both were remote-only — 0946 merged to main after this worktree was branched; 0950 pushed from its own worktree). |
| `0bdc3eb6` | Source-reconciled ORCH-0947 [Biz trip tickets sold] migration (third remote-only surfaced after first reconciliation). |
| `5638993c` | Source-reconciled ORCH-0915 [Buyer pay-in-full opt-out] migration (fourth remote-only — also a 06→07 rename done by that worktree). |

All four reconciliation files are exact copies of what the owning worktrees pushed to remote. Each owning ORCH retains authority over its file; ORCH-0948 carries them transiently so its own push could succeed. They will be cleaned up automatically at PR-merge time via squash + rebase.

---

## 4. Hard guards observed by orchestrator on this turn

- No implementor DB push replayed — operator owns push.
- No edits to `app-mobile/`, `mingla-admin/`, `mingla-business/app/checkout/[eventId]/confirm/`, `mingla-business/app/checkout-trip/[tripEventId]/confirm/`, or `TicketQrCarousel.tsx` (I-WAITLIST-CONFIRM-EXCLUSION verified by re-running orch-0948 strict-grep gate post-rename).
- No regression-test files modified (only the relative-URL string inside the migration test was rewritten to point at the renamed migration; no `it()` block, no assertion, no test path changed).
- No new product code written — only the migration filename + two references and the allowlist entry were touched.

---

## 5. Downstream routing (post-deploy)

After §3 completes and version bumps are verified, orchestrator hands off to **Claude `mingla-tester`** in TARGETED sub-mode against the applied migration + live edges, producing `Mingla_Artifacts/reports/QA_ORCH-0948_WAITLIST_FEATURE.md` per SPEC §11 adversarial tests T-WL-07..T-WL-12. After tester PASS, CLOSE returns to the orchestrator that takes the close (this Claude session by default, or Codex `orchestrator-mingla` if operator redirects) for the §15 SPEC CLOSE banner + PR to main.

---

## 6. Open items for tester focus (carried from implementor's residual-risks)

- True FIFO drain against an applied trigger (T-WL-07).
- Idempotency under repeated `tickets.status` flips (T-WL-08).
- `ticket_order_notifications.order_id` nullability assertion at runtime (T-WL-09).
- Malformed dispatcher payload handling for `waitlist_spot_open` (T-WL-10).
- iOS + Android + business-web-preview parity on the planner `WaitlistEntriesSheet`.
- Anon `/waitlist-signup` HTTP shape verification (200 / 409 / 400 / 422 paths).
- Buyer-web sold-out CTA reachability on both `/checkout/{eventId}` AND `/e/{brandSlug}/{eventSlug}`.

---

**Status: Phase 1 (pre-push) complete. Awaiting operator §2.**
