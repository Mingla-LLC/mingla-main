# REVIEW ORCH-0953 — Stripe live-mode cutover (Implementation REVIEW)

**Date:** 2026-05-24
**Reviewer:** Claude `mingla-orchestrator` (REVIEW mode)
**Working tree:** `~/Desktop/mingla-orchs/ORCH-0953-[stripe-live-cutover]/`
**Branch:** `ORCH-0953-stripe-live-cutover`
**Commits reviewed:** `bc5935fc`, `222daa04`, `fcd010eb`, `103c17c4` (rework)
**Inputs:**
- SPEC: [`Mingla_Artifacts/specs/SPEC_ORCH-0953_STRIPE_LIVE_CUTOVER.md`](../specs/SPEC_ORCH-0953_STRIPE_LIVE_CUTOVER.md)
- Investigation: [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0953_STRIPE_LIVE_CUTOVER_AUDIT.md`](INVESTIGATION_ORCH-0953_STRIPE_LIVE_CUTOVER_AUDIT.md)
- Implementation report: [`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0953_STRIPE_LIVE_CUTOVER.md`](IMPLEMENTATION_ORCH-0953_STRIPE_LIVE_CUTOVER.md)
- DEC-154 + DEC-156 in `Mingla_Artifacts/DECISION_LOG.md`

---

## Verdict: **APPROVED post-rework** (commit `103c17c4` resolves the P1; one operator preflight gate flagged below)

Original REVIEW (2026-05-24 first pass) returned NEEDS WORK on the P1 migration-version collision. Codex shipped rework commit `103c17c4`:
- Renamed migration to `supabase/migrations/20260726000000_orch_0953_create_stripe_disputes.sql` (verified: only ORCH-0953 holds `20260726000000*` across all per-ORCH worktrees + anchor).
- Updated `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0953_STRIPE_LIVE_CUTOVER.md` line 66 + §3.3 rework receipt + deploy notes + verification.
- Updated `supabase/functions/_shared/__tests__/stripeDisputeHandlers.test.ts` line 121 filename string (would have knowingly broken the branch otherwise).
- 4/4 Deno tests in `stripeDisputeHandlers.test.ts` passed post-rename.
- `git diff --check` clean. No scope creep, no unrelated staging.

Verdict: **APPROVED.** Every contract verifies clean against SPEC §3.1–§3.10 and §7 (SC-1..SC-17). Routing to operator for migration apply subject to the preflight gate below.

## Operator preflight gate — remote-only migration reconciliation

**Surfaced by Codex during the rework:** running `/Users/sethogieva/bin/supabase migration list --linked` from the anchor shows three remote-only versions (Local column blank, Remote column populated):

```
20260724000007 | (remote-only)
20260725000000 | (remote-only)
20260725000001 | (remote-only)
```

Per the orchestrator's 2026-05-24 codified instruction: *"If a remote-only version exists, source-reconcile the exact already-applied migration file into the branch or block for a dedicated reconciliation PR; do not default to `supabase migration repair` or `supabase db pull`."*

**Why it matters:** `supabase db push --linked` for ORCH-0953's `20260726000000` will succeed mechanically (the version is later than all remote versions, and `stripe_disputes` only references the long-standing `brands` and `orders` tables — no schema dependency on the missing versions). However, leaving remote-only migrations un-reconciled means the anchor's `main` branch does not model production schema truthfully, and any future ORCH that touches related schema risks unexpected conflict.

**Required action — operator-owned, runs BEFORE `db push`:**

1. Identify which ORCHs the three remote-only migrations came from. Likely candidates given the version range: ORCH-0915 [Buyer pay-in-full opt-out], ORCH-0946 [Buyer-web sold-out gate], ORCH-0947 [Biz trip tickets sold], ORCH-0948 [Waitlist feature], ORCH-0950 [Trip capacity single source]. Quickest check: `git -C ~/Desktop/mingla-main log --oneline --all -- 'supabase/migrations/2026072500000*.sql' 'supabase/migrations/20260724000007*.sql'` and inspect their per-ORCH worktrees if not on `main` yet.
2. For each remote-only version, locate the source migration `.sql` file in its owning ORCH worktree and either:
   - **(a)** wait for that ORCH's PR to merge to `main`, then rebase ORCH-0953 onto the updated `main` so all three migration files appear in the ORCH-0953 branch's `supabase/migrations/` automatically, OR
   - **(b)** if those ORCHs are far from CLOSE, cherry-pick or source-reconcile the three migration files into the ORCH-0953 branch as a separate commit titled `chore: source-reconcile remote-only migrations` so ORCH-0953's branch models production truthfully before push.
3. Re-run `cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0953-[stripe-live-cutover]" && /Users/sethogieva/bin/supabase migration list --linked` (after operator links the worktree with `supabase link --project-ref gqnoajqerqhnvulmnyvv` — Codex flagged the worktree is not linked yet). Confirm zero remote-only versions remain.
4. Only then run `/Users/sethogieva/bin/supabase db push --linked` — at that point only the ORCH-0953 `20260726000000` migration will be pushed.

**Risk if skipped:** mechanically the push works; politically the anchor `main` drifts further from production schema, and the next migration author hits the same surprise. Reconcile now.

---

## REVIEW protocol checklist

| Check | Result |
|---|---|
| Root cause proven / spec faithfully implemented | YES — all 9 contracts mapped to file:line changes verified directly |
| Scope appropriate — no out-of-scope code | YES — implementor flagged + skipped pre-existing `brand-stripe-tax-dashboard-link` type-check issue correctly |
| Hidden fallback paths that mask failure | NO — §3.1 fail-close verified at lines 110 + 167 (only `STRIPE_RAK_ONBOARD`, fallback removed); §3.2 production-profile gate present in `mingla-business/app.config.ts` |
| Response shape truthful in all states | YES — region gate returns explicit 400 with `retryWithSurface: "web"`; signature-failure alert no-ops on missing env per SC-17 |
| Real fix or symptom mask | REAL FIX — dispute persistence shipped (new table + RLS + router + handler + AppsFlyer + operator alert); webhook router contract complete |
| Cross-surface parity | YES — Google Pay + region-gate copy ship to both consumer and business apps; intent filters ship to both Android apps |
| Constitutional compliance | PASS — no silent failures, no fabricated data, single owner per truth, server state stays server-side |
| Evidence chain complete | YES — 10 fails-on-revert receipts in §14 of implementation report, all citing commit `bc5935fc`/`222daa04` |
| Regression-test gate (ORCH-0840) | YES — 10 implementor happy-path tests at real `__tests__/` paths with fails-on-revert receipts; tester adversarial tests still owed at TEST phase (per SPEC §6) |
| Documents updated | PARTIAL — WORKTREE_REGISTRY row exists; WORLD_MAP and other indexes updated at CLOSE per protocol |

---

## P1 FINDING — Migration filename version collision

### Severity
**P1 — HIGH (deploy-blocking).** Must be fixed before PR open; cannot reach `main` as-is.

### Finding
The migration ships as `supabase/migrations/20260724000006_orch_0953_create_stripe_disputes.sql`. That `20260724000006` version prefix is currently in use by **four parallel per-ORCH worktrees**:

```
~/Desktop/mingla-orchs/orch-0915-[buyer-pay-in-full-opt-out]/supabase/migrations/20260724000006_orch_0915_pay_in_full_opt_out.sql
~/Desktop/mingla-orchs/ORCH-0946-[buyer-web-sold-out-gate]/supabase/migrations/20260724000006_orch_0946_public_ticket_types_remaining.sql
~/Desktop/mingla-orchs/ORCH-0948-[waitlist-feature]/supabase/migrations/20260724000006_orch_0948_waitlist_feature.sql
~/Desktop/mingla-orchs/ORCH-0953-[stripe-live-cutover]/supabase/migrations/20260724000006_orch_0953_create_stripe_disputes.sql
```

(A fifth — ORCH-0950's worktree — also carries an `_orch_0946_…` file at this prefix, which is ORCH-0950's own issue, not ORCH-0953's.)

### Why this is deploy-blocking
Supabase's `db push` orders migrations by their numeric version prefix. When two migrations share the same prefix, the second one to attempt apply will be silently skipped (the migration history table is keyed on version). Whichever ORCH merges to `main` second wins; the loser's migration never runs on the remote DB even though its file exists in `supabase/migrations/`.

The orchestrator skill instruction explicitly warns: *"When authoring or reviewing migration filenames, also check active per-ORCH worktrees under `~/Desktop/mingla-orchs/*/supabase/migrations/` for later or equal prefixes so parallel ORCHs do not reuse the same migration version."* (2026-05-24 codification.) That check was not performed at IMPLEMENT.

### Required fix
1. Rename the migration file to a unique prefix that is later than every active per-ORCH worktree's claim. Earliest safe version: **`20260726000000_orch_0953_create_stripe_disputes.sql`** (after the `20260725000000` claims in ORCH-0947 and ORCH-0950 worktrees).
2. Update any artifact reference to the migration filename:
   - `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0953_STRIPE_LIVE_CUTOVER.md` §6 (Old To New Receipts row) and §17 (Deploy Notes).
3. Re-commit on the same branch. The fails-on-revert receipt for §3.3 in §14 of the implementation report should be re-stated against the new commit hash.

### Verification
After rename, run `ls ~/Desktop/mingla-orchs/*/supabase/migrations/20260726* 2>/dev/null` — only the ORCH-0953 file should appear.

---

## Approved per-contract verification

Spot-checked each contract directly against source. All §3.1–§3.10 contracts verified.

| Contract | File:line confirmation | SPEC SC | Status |
|---|---|---|---|
| §3.1 RAK fail-close | `_shared/stripeBlueprintClient.ts:110` and `:167` — both arrays now `["STRIPE_RAK_ONBOARD"]` only | SC-1 | ✅ APPROVED |
| §3.2 pk_live production gate | `mingla-business/app.config.ts:79-87` — IIFE wraps the env read, production profile throws on missing/non-`pk_live_` | SC-2 | ✅ APPROVED |
| §3.3 dispute table + router + handler | Migration `stripe_disputes` schema matches SPEC; router lines 70-72 add the 3 dispute event types; handler at `_shared/stripeDisputeHandlers.ts` (260 lines, real implementation with upsert + dispatchNotification + AppsFlyer) | SC-3, SC-4, SC-5, SC-6 | ✅ APPROVED (subject to P1 rename) |
| §3.4 noisy events documented | Router lines 62-66 — explicit comment block stating `charge.succeeded`/`charge.failed`/`payment_intent.processing` are NOT routed | SC-7 | ✅ APPROVED |
| §3.5 business Android scheme | `mingla-business/app.json` adds explicit `com.sethogieva.minglabusiness` VIEW intent filter | SC-8 | ✅ APPROVED |
| §3.6 consumer Android scheme | `app-mobile/app.json` adds explicit `com.mingla.app.v2` VIEW intent filter | SC-9 | ✅ APPROVED |
| §3.7 Google Pay production env | `nativeCheckoutFlow.ts` + `nativeCheckoutFlow.native.ts` swap `__DEV__` for `process.env.EAS_BUILD_PROFILE !== "production"` | SC-10 | ✅ APPROVED |
| §3.8 native region gate | New `_shared/stripeTax.ts` (21 lines, env-driven allowlist helper) + `ticket-checkout-create/index.ts` gate before native PI create; consumer + business native flows surface web-fallback copy | SC-11, SC-12, SC-13, SC-14 | ✅ APPROVED |
| §3.9 reconciliation probe | `scripts/orch-0953/connect_inventory_reconciliation.sql` (read-only SELECT only) + README runbook + shape test | SC-15 | ✅ APPROVED |
| §3.10 signature-failure alert | `stripe-webhook/index.ts` adds `dispatchNotification` hook gated on `STRIPE_WEBHOOK_FAILURE_ALERT_USERS` env | SC-16, SC-17 | ✅ APPROVED |

---

## Implementor discoveries — verified

| Discovery | Verdict |
|---|---|
| `brand-stripe-tax-dashboard-link/index.ts:122` pre-existing Deno type-check failure on the `writeAudit` call | ACCEPTED as pre-existing. Out of ORCH-0953 scope. **Orchestrator carry-forward:** when deploying this function at the DEPLOY phase, either accept the type warning (Deno deploy proceeds with `--no-check` if needed) or open a small follow-up ORCH to fix the audit-call types. Filed as discovery for orchestrator (§ below). |
| SPEC named `brand_memberships` table + roles `'owner'`, `'payment_manager'`; implementor used real repo table `brand_team_members` + roles `'account_owner'`, `'brand_admin'`, `'finance_manager'` | ACCEPTED. Implementor adapted to live schema correctly. SPEC §3.3 RLS policy text was advisory; the production-faithful version ships. Memory: update the new DEC §10 invariant text at CLOSE to match the real role names. |

---

## Discoveries for orchestrator

1. **Migration version-prefix collision is now a recurring class of bug across the worktree-per-ORCH cutover.** Five worktrees converged on `20260724000006` this week. **Recommended META action:** add a pre-commit hook to `scripts/orch-worktree/spawn.sh` that records the highest existing version across all worktrees + anchor and seeds the new worktree's `supabase/config.toml` or a `.next-migration-version` sidecar so implementors get a guaranteed-unique starting prefix. Register as follow-up META-ORCH after ORCH-0953 closes.
2. **`brand-stripe-tax-dashboard-link` Deno type-check has been broken pre-ORCH-0953 and will produce a noisy deploy warning when the orchestrator redeploys at the DEPLOY phase per §17 of the implementation report.** Register a small follow-up ORCH for the `writeAudit` type fix.
3. **`brand-stripe-tax-dashboard-link` is also the single remaining `STRIPE_SECRET_KEY` consumer in production code** (Investigation F-2 accepted exception). When the follow-up types ORCH is opened, consider whether `accounts.createLoginLink` could be moved behind a dedicated tightly-scoped RAK with `connect:write account_login_links` permission, eliminating the last full-key surface. Defer — not launch-blocking.

---

## Routing decision

**Verdict: NEEDS WORK** — return to implementor for a 1-file rename + 2 artifact updates.

After rework:
1. Implementor renames migration to `20260726000000_orch_0953_create_stripe_disputes.sql`, updates 2 references in the implementation report, re-commits.
2. Implementor returns with new commit hash.
3. Orchestrator REVIEW (this skill) confirms the rename — single-line APPROVED.
4. Operator runs `cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0953-[stripe-live-cutover]" && /Users/sethogieva/bin/supabase db push --linked` for the `stripe_disputes` migration. Pre-flight: `cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0953-[stripe-live-cutover]" && /Users/sethogieva/bin/supabase migration list --linked` and confirm no remote-only versions.
5. Orchestrator deploys six edge functions via `/Users/sethogieva/bin/supabase functions deploy <name> --project-ref gqnoajqerqhnvulmnyvv`: `ticket-checkout-create`, `stripe-webhook`, `brand-stripe-onboard`, `refund-order`, `cancel-trip-booking`, `brand-stripe-tax-dashboard-link` (last one may need `--no-check` to bypass pre-existing type warning per Discovery #2).
6. Orchestrator verifies version bumps via `mcp__supabase__list_edge_functions`.
7. Operator runs Phase A–E from SPEC §4 + writes evidence pack `Mingla_Artifacts/reports/EVIDENCE_PACK_ORCH-0953_LIVE_ACTIVATION.md`.
8. Claude `mingla-tester` runs T-01..T-11 live-fire matrix from SPEC §6.
9. Orchestrator CLOSE with PR + `[deploy]` tag (mingla-business config touched) + 5 new I-PROPOSED invariants + DEC entry from SPEC §10.

---

## End of REVIEW.
