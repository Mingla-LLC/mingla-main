# IMPLEMENTATION — ORCH-1388 [checkout-session honest expiry: reconciler non-succeeded branch]

- **Phase:** IMPLEMENT (complete — routed to orchestrator REVIEW)
- **Author:** mingla-implementor+claude, 2026-07-17
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1388-[checkout-session-reconciler]/` on branch `ORCH-1388-checkout-session-reconciler` (rebased onto post-COMMS-0109 main before any code)
- **Binding contract:** `Mingla_Artifacts/specs/SPEC_ORCH-1388_CHECKOUT_SESSION_HONEST_EXPIRY.md` (REVIEW-APPROVED)
- **Commits:** `b6ef60f8a` (implementation, all six allowlist files) + `071c6bbbc` (R-7b needle hardening found by the revert drill)
- **Status label:** implemented and verified (all statically/unit-verifiable SC confirmed; the two live-production SC are structurally implemented and deferred to TEST/CLOSE by design — see SC table)

---

## 1. Summary

The */15-minute `reconcile-stuck-checkouts` cron could previously only FINALIZE checkout sessions whose payment succeeded; every abandoned (never-paid) session was skipped forever — 5 production rows have sat in `processing_payment` for weeks. The function now has a second branch: for every in-flight session it re-checks Stripe truth read-only (through the connected account), and a session that is provably unpaid AND past its 15-minute expiry window is honestly terminalized to `expired` (+`failed_at`+`failure_reason='abandoned_past_expiry'`). Anything mid-payment, ambiguous, or unverifiable (Paystack refs, unknown statuses) is skipped fail-safe — never expired. Zero Stripe writes anywhere. Zero schema change. The succeeded→finalize branch moved but did not change. The first production run after the orchestrator deploys from merged main IS the backfill for the 5 stuck rows.

## 2. SPEC success-criteria coverage table

| SC | Criterion (short) | Status | How verified | Commit |
|---|---|---|---|---|
| SC-1 | Core expiry: past-expiry `processing_payment` + PI `requires_payment_method` → `expired`+`failed_at`+`failure_reason` | ✓ | Unit T-1 (classify → expire) + source R-2 (write shape) + R-1 (row reaches the sweep) | `b6ef60f8a` |
| SC-2 | Backfill = first prod run drains the 5 stuck rows; steady state `expired: 0` | ✓ structurally / LIVE LEG DEFERRED | All 5 rows are STRIPE_PI + `requires_payment_method` + weeks past expiry → classify=expire (T-1); live observation is tester T-A6 + CLOSE (SPEC §8 deploy note — by design not the implementor's) | `b6ef60f8a` |
| SC-3 | Finalize preserved: PI `succeeded` → existing finalize + PDF dispatch, any expiry | ✓ | Unit T-2 (finalize at all 4 expiry points) + the MOVED-unchanged block (old→new receipt §7) + pre-existing `orch_1188_reconcile_pdf_backfill.test.ts` still 3/3 green against the new index.ts | `b6ef60f8a` |
| SC-4 | Mid-payment never expired (`processing`/`requires_action`/`requires_capture`), even past expiry | ✓ | Unit T-3 (3 statuses × 4 expiry points incl. ±ε) + R-4 protect-set needle + protect-set-membership test | `b6ef60f8a` |
| SC-5 | Mixed batch: succeeded finalizes while siblings expire, both counters | ✓ | classify is pure per-row (no cross-row state — T-2 + T-1 in the same suite prove both actions from the same partition); counters derived per-row from `results` (§4.2d code) | `b6ef60f8a` |
| SC-6 | In-window rows never mutated by the expiry branch | ✓ | Unit T-5 + no-charge-partition in-window cases + CAS `.lt("expires_at", nowIso)` re-check (R-3) | `b6ef60f8a` |
| SC-7 | Web arm: unpaid CS → expire; `cs.payment_intent` → resolved PI governs; paid-no-PI → `cs_paid_no_pi` skip | ✓ | Unit T-6/T-7/T-8 + index.ts CS routing (resolved PI id is passed to finalize as `p_stripe_payment_intent_id`) | `b6ef60f8a` |
| SC-8 | Paystack `mingla_*` never expired, never sent to Stripe | ✓ | Unit T-9 + R-8b (`startsWith("pi_")` guard) + I/O routing: `PAYSTACK`/`NO_REF` branches perform no retrieve (code) | `b6ef60f8a` |
| SC-9 | No-ref rows: past-expiry `pending_free`/`requires_payment` → expire; in-window untouched | ✓ | Unit T-10 + R-1 (PI-non-null filter removed so these rows are selected) | `b6ef60f8a` |
| SC-10 | Zero Stripe writes | ✓ | R-6 mutation-regex over index+classify + I-PROPOSED-R gate 0 violations; only `retrieve` calls exist | `b6ef60f8a` |
| SC-11 | CAS + rowcount: 4 guards + `.select("id")`; raced 0-row → `skip: "raced"`, not error | ✓ | R-3 (all four guards on the chain) + R-5 (raced branch error-free) | `b6ef60f8a` |
| SC-12 | `{reconciled, expired, skipped, errors, results}` + one summary log line | ✓ | Code (§4.2d shape verbatim) + `console.log("[reconcile-stuck-checkouts] run summary", …)`; pg_net capture is the tester's live leg | `b6ef60f8a` |
| SC-13 | config.toml explicit stanza `verify_jwt = true`; deployed behavior unchanged | ✓ config / POST-DEPLOY CURL DEFERRED | R-7 needle; the post-deploy 401/200 curl is the orchestrator's CLOSE step per SPEC | `b6ef60f8a` |
| SC-14 | D-D honesty: overpromise gone from fn header AND migration; migration SQL byte-identical | ✓ | R-7b (normalized-prose regex) + R-7c (one-shot framing gone) + `git diff` proof: every changed migration line starts with `--` (comment-only check ran clean) | `b6ef60f8a` |
| SC-15 | Late-payment safety intact: webhook lookup no status filter; finalize guards only order_id | ✓ | R-8 (anchored inside `handleTicketCheckoutPaymentIntent`; between-slice has no `.eq("status"`); both files DO-NOT-TOUCH and untouched (diff proof §3) | `b6ef60f8a` |

## 3. Files changed (complete — exactly the SPEC §12 allowlist)

| File | Change | Delta |
|---|---|---|
| `supabase/functions/reconcile-stuck-checkouts/index.ts` | rewritten per §4.2 (finalize block MOVED unchanged) | +434/−116 lines net area (177 → ~380 lines) |
| `supabase/functions/reconcile-stuck-checkouts/classify.ts` | NEW pure decision module | +219 |
| `supabase/config.toml` | ADD stanza only | +9 |
| `supabase/migrations/20261116000000_orch_1187_reconcile_stuck_checkouts_cron.sql` | comment-only correction | ±13 (all `--` lines; SQL byte-identical — verified by diff filter) |
| `supabase/functions/__tests__/orch_1388_classify_matrix.test.ts` | NEW | +267 |
| `supabase/functions/__tests__/orch_1388_reconciler_expiry_sweep.test.ts` | NEW | +306 |

`git diff origin/main...HEAD --name-only` contains ONLY these six + prior-phase artifacts (investigation, spec, evidence pack, registry row). No DO-NOT-TOUCH file has any diff. Working tree clean.

## 4. Data-model changes applied

**NONE** (per dispatch: migration = NONE). The expiry write reuses the existing `expired` status (already in the CHECK constraint), the existing `failed_at`, `failure_reason`, `updated_at` columns (all verified present in `20260515000013_orch_0777_ticket_checkout_core.sql` table definition before writing the query).

## 5. Edge functions touched

| Function | Change | `verify_jwt` to preserve at deploy |
|---|---|---|
| `reconcile-stuck-checkouts` | two-branch sweep per SPEC §4.2 | `true` (now EXPLICIT in config.toml — documents the current live posture; the cron's service-role bearer is a valid JWT, zero behavior delta) |

No other function modified. Deploy is orchestrator-owned, from MERGED main (see §11).

## 6. Regression tests added

- `supabase/functions/__tests__/orch_1388_classify_matrix.test.ts` — 18 unit tests over the pure partition (T-1..T-11 + ref-classification + fail-safe clock + protect-set membership). Run: `deno test <file>` → **18 passed | 0 failed**.
- `supabase/functions/__tests__/orch_1388_reconciler_expiry_sweep.test.ts` — 12 source-contract tests (R-1..R-8, every assert message carries the protective "why"). Run: `deno test --allow-read <file>` → **12 passed | 0 failed**.
- Pre-existing `orch_1188_reconcile_pdf_backfill.test.ts` re-run against the rewritten index.ts → **3/3 green** (the MOVED finalize block preserves its needles).
- **Append-only:** both files are NEW; no existing test modified or deleted; both are in `git diff origin/main...HEAD --name-only` on this branch.

**fails-on-revert verified at `b6ef60f8a`** (true line-deletion revert, no stash — per the dispatch's no-stash guard the drill used `git checkout origin/main -- <files>` + `rm classify.ts`, which deletes every fix line from the working tree):

- **Full-revert leg** (index.ts/config/migration → origin/main versions; classify.ts deleted): classify matrix suite RED (`error: Type checking failed` — import of deleted module; 0 passed), sweep suite RED (`FAILED | 0 passed | 1 failed`).
- **Partial-revert leg** (classify.ts restored; index/config/migration still pre-fix — proves the needles bite individually): sweep suite **8/12 RED** — R-1, R-2, R-3, R-5, R-6b, R-7, R-7b, R-7c each individually FAILED; R-4/R-6/R-8/R-8b legitimately green (they assert on the restored classify.ts and the untouched webhook router).
- **Drill catch:** the original R-7b regex missed the overpromise because the phrase wraps across `-- ` SQL comment prefixes (`\s+` does not cross them). Hardened in `071c6bbbc` (normalize `\n-- ` before the regex); re-verified RED on the partial-revert leg after hardening.
- **Restore leg** (checkout HEAD): 18 + 12 + 3 all green at `071c6bbbc`; typecheck clean; gates green.

## 7. Old → New receipts

### `supabase/functions/reconcile-stuck-checkouts/index.ts`
**What it did before:** selected only `status='processing_payment' AND stripe_payment_intent_id IS NOT NULL` (unbounded), retrieved each PI, and if `pi.status !== "succeeded"` pushed a skip and continued — abandoned sessions were re-listed and re-skipped forever (root cause F-1). Header comment described a one-shot ORCH-0849 backfill.
**What it does now:** selects ALL FOUR in-flight statuses (`processing_payment`, `awaiting_web_redirect`, `requires_payment`, `pending_free`), oldest-first, capped at `SWEEP_BATCH_LIMIT = 50`; classifies each row's ref (STRIPE_PI / PAYSTACK / STRIPE_CS / NO_REF) via `classify.ts`; performs only the read-only retrieve the class calls for (PI and/or Checkout Session, `Stripe-Account` header when `stripe_account_id` set); then obeys the pure partition: succeeded → the UNCHANGED finalize block (RPC + ORCH-1188 skipNotify PDF dispatch, moved verbatim including the ORCH-0924 annotation); genuinely-unpaid past-expiry → CAS UPDATE to `expired`+`failed_at`+`failure_reason='abandoned_past_expiry'`+`updated_at`, guarded by `id` + status-snapshot + `order_id IS NULL` + `expires_at < now`, rowcount-verified via `.select("id")` (0-row → `skip: "raced"`); everything else → skip with a reason (`cs_paid_no_pi` additionally console.error'd). Response adds `expired` to the counters; one summary log line per run. Header comment rewritten to the two-branch permanent-cron truth including the load-bearing late-payment-safety explanation.
**Why:** SC-1..SC-12, SC-14; F-1/F-2 root causes; Seth rulings 1–4.
**Lines changed:** ~434 added / ~116 removed (file 177 → ~380 lines).

### `supabase/functions/reconcile-stuck-checkouts/classify.ts` (NEW)
**What it did before:** did not exist — the decision logic was a single inline `!== "succeeded"` check.
**What it does now:** exports the pure, I/O-free decision partition: `classifyRef` (4-way ref classification; the `pi_`-prefix check is the Paystack guard) and `classify` (exhaustive PI-status partition with `NEVER_EXPIRE_PI_STATUSES` protect set and `NO_CHARGE_PI_STATUSES`, CS partition with `cs_paid_no_pi` human-surface skip, NO_REF handling, fail-safe defaults for unknown statuses and NULL/unparseable timestamps).
**Why:** SPEC §4.2b — unit-testable partition; SC-4/7/8/9.
**Lines changed:** +219.

### `supabase/config.toml`
**What it did before:** no `[functions.reconcile-stuck-checkouts]` entry (fn ran on the platform default).
**What it does now:** explicit stanza `verify_jwt = true` with the D-C comment (cron bearer is a valid JWT; fn keeps its own service-role check; zero behavior delta).
**Why:** SC-13, fold-in D-C.
**Lines changed:** +9.

### `supabase/migrations/20261116000000_orch_1187_reconcile_stuck_checkouts_cron.sql`
**What it did before:** comment promised "ANY future stuck session auto-recovers within minutes" — false (finalize-only fn), the F-6 documentation debt that misled monitoring.
**What it does now:** comment states the two-branch truth (finalizes PI-succeeded; expires genuinely-unpaid past-expiry; ambiguous skipped fail-safe). Every SQL statement byte-identical (diff-verified: all changed lines start `--`). NOT a new migration; the applied version on prod is untouched by name.
**Why:** SC-14, fold-in D-D half 2.
**Lines changed:** ±13 comment lines.

### The two test files — see §6.

## 8. Cross-surface impact table

Per SPEC §3 — single shared backend path; parity AUTOMATIC (one edge fn); no client branches on the swept states; `expired` already in every client status union.

| Surface | Affected? | Note |
|---|---|---|
| Consumer iOS / Android (`app-mobile/`) | NO | no reader branches on swept states |
| Buyer/anonymous Web (`mingla-business` checkout routes) | Behavioral no-op | a poll on a weeks-dead session now sees honest `expired` instead of eternal `processing_payment`; clients only check `order?.orderId` — zero code/copy change |
| Business iOS / Android | NO | sheet-cancel flow unchanged; no client-side write added |
| Admin Web (`mingla-admin`) | NO | zero references to the table |
| Business Web preview | NO | — |
| **Backend (edge fn + config + migration comment)** | **YES** | the only touched surface; parity automatic |

## 9. Smoke result

Backend-only change — no sim/device surface to drive (live-fire exemption per the investigation's precedent; the runtime legs are tester T-A6 and the orchestrator's post-deploy first call). What WAS run, with real output captured in this session:

- `deno check` classify.ts + index.ts — clean (0 errors).
- `deno test` classify matrix — `ok | 18 passed | 0 failed`.
- `deno test --allow-read` sweep source-contract + 1188 suite — `ok | 15 passed | 0 failed` (12 + 3).
- `node .github/scripts/strict-grep/i-proposed-r-stripe-idempotency-key.mjs` — `scanned 670 .ts files · 0 violations`.
- `node .github/scripts/strict-grep/orch-0829b-d1-checkout-expiry-tombstone-or-clause-present.mjs` — `PASS`.
- `node .github/scripts/strict-grep/i-proposed-finalize-callers-pass-installment-params.mjs` — `PASS` (scans this fn's finalize call; the preserved ORCH-0924 annotation satisfies it).
- Full strict-grep battery (391 scripts): 20 fail in this worktree vs 17 on clean anchor main. The 3 extras (`finalize-callers.test`, `0931`, `0939`, `0943` `.test.mjs` harnesses) fail ONLY because this worktree's path contains `[…]` brackets that their URL-based module resolution percent-encodes (`%5B`) — their underlying plain gates all PASS here; CI checkout paths have no brackets. The other 16-17 are byte-identical to anchor main (pre-existing/environmental, mostly app-side gates needing node_modules).
- `deno fmt` applied to the four new/changed .ts files; re-verified everything green after.

## 10. Known issues / deferred

- No `[TRANSITIONAL]` code introduced.
- SC-2/SC-13 live legs (first prod run drains the 5 rows; post-deploy curl) are deliberately deferred to TEST (T-A6) and CLOSE per the SPEC's phase design — the implementor does not deploy.
- OQ-A bound default shipped: Paystack-armed rows are never expired (skip `paystack_unverified`); a future abandoned Paystack redirect would strand visibly in the skip counter until a follow-up ORCH adds a read-only Paystack verify.
- The full-file source-contract suite reads `classify.ts` at top level, so a full revert reds the whole file rather than per-needle (the partial-revert leg proves per-needle bite; recorded in §6).

## 11. Operator action required

- **Migration `db push`: NONE.** No new migration file exists; the 1187 edit is comment-only on an already-applied version (same filename → never re-applies; still applies cleanly on fresh CI Postgres).
- **Edge deploy (orchestrator, from MERGED main — NOT from this worktree):** deploy `reconcile-stuck-checkouts`; preserve `verify_jwt = true`. Verify with an authenticated first call: expect HTTP 200 with the new `{reconciled, expired, skipped, errors, results}` shape. **That first production run IS the backfill** — expect `expired: 5, reconciled: 0, errors: 0` (the 5 known rows), then `expired: 0` steady-state. Post-run read-only check: `SELECT status, count(*) FROM ticket_checkout_sessions GROUP BY 1;` → zero in-flight rows older than `expires_at`.

## 12. Discoveries for Orchestrator

- **D-1 (tooling):** strict-grep `.test.mjs` harnesses (the self-test wrappers, not the gates) cannot run from any worktree whose path contains `[`/`]` — Node's `import.meta.url`-based child-process resolution percent-encodes the brackets and the module path 404s. Every per-ORCH worktree spawned as `ORCH-NNNN-[label]` hits this. Zero CI impact (clean paths), but local full-battery runs in worktrees will always show these 4 as false-fails. Consider un-bracketing the spawn naming or hardening the harnesses with `fileURLToPath`.
- **D-2 (test-pattern):** SQL comment prose wraps across `-- ` prefixes, and plain `\s+` regexes silently miss multi-word needles spanning that boundary — proven live by this ORCH's revert drill (R-7b was a dud until normalized). Future migration-comment needles should normalize `\n-- ` first; worth a line in the tester playbook.
- No unrelated product bugs found; no side fixes made.
