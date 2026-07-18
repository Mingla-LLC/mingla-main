# TEST — ORCH-1388 [checkout-session honest expiry: reconciler non-succeeded branch]

- **Phase:** TEST (mingla-tester+claude, 2026-07-18)
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1388-[checkout-session-reconciler]/` on branch `ORCH-1388-checkout-session-reconciler` (rebased onto `origin/main` this phase, clean — no Mingla_Artifacts conflicts)
- **Contract under test:** `Mingla_Artifacts/specs/SPEC_ORCH-1388_CHECKOUT_SESSION_HONEST_EXPIRY.md` (SC-1..SC-15, §9 T-A1..T-A7, §1 keystone)
- **Implementation:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1388_CHECKOUT_SESSION_HONEST_EXPIRY.md`
- **Ground truth:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1388_CHECKOUT_SESSION_RECONCILER.md`
- **Mode:** SPEC-COMPLIANCE + TARGETED + SECURITY (money-safety). Backend-only (Deno edge fn + SQL migration comment + config.toml + tests).
- **Live-fire sim gate:** EXEMPT — no UI/runtime client surface (Phase 0.A exemption list: edge-function-only / SQL-only / config). The runtime legs are read-only prod SQL + read-only Stripe GETs (T-A6 / T-A5), performed live below.

---

## 1. VERDICT

**PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 2 (praise).

Regression gate SATISFIED: implementor happy-path fails-on-revert independently re-run (both legs reproduced); tester adversarial test added on a DIFFERENT angle, on-branch, in-diff, with its own two-leg fails-on-revert. Zero product-code changes by the tester. The single reservation is a **phase boundary, not a defect**: SC-2's write-observation and SC-13's post-deploy curl happen when the **orchestrator deploys from merged main at CLOSE** (the tester is forbidden to deploy) — both are fully evidenced read-only here (the 5-row prediction is locked with live DB + live Stripe truth), so the deploy is a confirmation step, not an open risk.

**Keystone independently proven:** marking a session `expired` does NOT block a later `payment_intent.succeeded` from finalizing it — the webhook session lookup carries no status filter and `biz_ticket_checkout_finalize` guards only on `order_id`. Late payment after expiry still delivers the order. (See §6 SC-15 + R-8 anchored proof.)

---

## 2. SC-by-SC matrix

| SC | Verdict | Evidence |
|---|---|---|
| SC-1 core expiry (`processing_payment` + PI `requires_payment_method` → `expired`+`failed_at`+`failure_reason`) | **PASS** | classify T-1 → `{action:"expire"}`; index.ts CAS write payload `status:"expired", failed_at:nowIso, failure_reason:"abandoned_past_expiry", updated_at` (index.ts:317-321); source R-2 green. My INVARIANT B confirms `requires_payment_method`+past → expire is the *only* way to reach the write. |
| SC-2 backfill = first prod run drains the 5; steady `expired:0` | **PASS (read-only prediction; write is CLOSE-owned)** | Live prod DB: exactly 5 rows `processing_payment`, all `past_expiry=true`, `order_id=null`, `failure_reason=null`, native-arm (`stripe_checkout_session_id=null`), acct `acct_1Tml2YI4pBxuXrhh`. Live Stripe (fresh GETs, all 5): `requires_payment_method`, zero charges. Each → STRIPE_PI × no-charge × past → `expire`; all 4 CAS guards pass → `expired:5, reconciled:0, skipped:0, errors:0`. Predicted per-row table §9. |
| SC-3 finalize preserved (PI `succeeded` → finalize + PDF, any expiry) | **PASS** | classify T-2 finalize at PAST/FUTURE/±ε; finalize block MOVED verbatim (index.ts:222-305, incl. ORCH-1188 skipNotify dispatch + ORCH-0924 annotation); pre-existing `orch_1188_reconcile_pdf_backfill.test.ts` 3/3 green against the rewritten index.ts. My INVARIANT A: `succeeded` → finalize at ALL 5 expiry points, never expire. |
| SC-4 mid-payment never expired (`processing`/`requires_action`/`requires_capture`, even past) | **PASS** | classify T-3 (3 statuses × 4 expiry pts incl. ±ε) → skip. My INVARIANT A sweeps the SAME protect set across the full cross-product incl. exact-ms boundary → never expire. R-4 needle green. |
| SC-5 mixed batch (succeeded finalizes while siblings expire) | **PASS** | classify is pure per-row (no cross-row state) — a batch with both actions is the union of per-row decisions; index.ts derives counters per-row from `results` (index.ts:364-369). Structurally guaranteed. |
| SC-6 in-window rows never mutated by expiry | **PASS** | classify in-window → `skip in_window`; index CAS additionally re-checks `.lt("expires_at", nowIso)` server-side (index.ts:326). My BOUNDARY test pins `<` (not `<=`): a row expiring at exactly `now` is protected. |
| SC-7 web arm (unpaid CS→expire; resolved PI governs; paid-no-PI→`cs_paid_no_pi`) | **PASS** | classify T-6/T-7/T-8; index CS routing resolves `cs.payment_intent` → retrieves THAT PI with the account header → PI partition (index.ts:189-209); paid-no-PI → console.error + skip (index.ts:339-345). |
| SC-8 Paystack `mingla_*` never expired, never sent to Stripe | **PASS** | `classifyRef` `startsWith("pi_")` guard → PAYSTACK → `skip paystack_unverified`; index.ts performs NO retrieve for PAYSTACK (truth `{}`). My INVARIANT C + classifyRef-fuzz: `mingla_*`, `mingla_pi_*`, `PI_` (uppercase), ` pi_` (leading space), `xpi_` all route to PAYSTACK, never STRIPE_PI. |
| SC-9 no-ref rows (`pending_free`/`requires_payment`) past→expire, in-window→untouched | **PASS** | classify T-10; select drops the `.not(...is,null)` filter so no-ref rows are in scope (R-1). No such rows exist in prod today (verified — status distribution has none), so the sweep's first run acts only on the 5 STRIPE_PI rows. |
| SC-10 zero Stripe writes | **PASS** | R-6 mutation-regex `/stripe\.\w+(\.\w+)*\.(cancel\|update\|confirm\|create\|capture)\(/` green over index+classify; `i-proposed-r-stripe-idempotency-key.mjs` → 0 violations/670 files. Live Stripe activity this phase: **GETs only** (10 PI GETs + 1 CS-less control). No PI mutated/canceled. |
| SC-11 CAS + rowcount; raced 0-row → `skip:"raced"` not error | **PASS** | index.ts:323-337 — 4 guards on the chain (`.eq id`, `.eq status snapshot`, `.is order_id null`, `.lt expires_at`) + `.select("id")`; 0-row branch pushes `skip:"raced"` with no error push (R-3 + R-5, both re-run). |
| SC-12 `{reconciled,expired,skipped,errors,results}` + summary log | **PASS** | index.ts:364-386 response shape + `console.log("[reconcile-stuck-checkouts] run summary", …)`. pg_net capture is the CLOSE live leg. |
| SC-13 config `verify_jwt = true`; deployed behavior unchanged | **PASS (config verified; curl is CLOSE-owned)** | config.toml:101-108 explicit stanza + D-C comment. Live deployed fn `reconcile-stuck-checkouts` = **version 234, ACTIVE, verify_jwt=true** — so the stanza documents the ALREADY-LIVE posture with ZERO behavior delta. The 401/200 curl is the orchestrator's post-deploy step. |
| SC-14 D-D honesty (overpromise gone from fn header AND migration; SQL byte-identical) | **PASS** | fn header rewritten to two-branch contract (index.ts:1-40); migration comment corrected (lines 7-11 state the two-branch truth, `ANY future stuck session` gone); every changed migration line starts with `--` (SQL byte-identical); R-7b (normalized needle) + R-7c green. |
| SC-15 late-payment safety intact (webhook no status filter; finalize order_id-only) | **PASS** | R-8 anchored inside `handleTicketCheckoutPaymentIntent`: the slice between `.from("ticket_checkout_sessions")` and `.eq("stripe_payment_intent_id"` contains NO `.eq("status"`. `_shared/stripeWebhookRouter.ts` + finalize RPC are DO-NOT-TOUCH and untouched (diff proof). Independent keystone reasoning §7. |

---

## 3. Findings

**Zero P0. Zero P1. Zero P2. Zero P3.**

- **P4-1 (praise):** the pure-`classify.ts`/I/O-`index.ts` split is exemplary — it makes the entire money-safety partition unit-testable in isolation and let this phase attack it as a universal invariant with zero mocking. Replicate this shape for future decision-heavy sweeps.
- **P4-2 (praise):** the fail-safe default discipline (unknown PI status, unparseable/NULL `expires_at`, unresolvable-CS all → skip, never expire) is exactly right for a money path; the CAS `.lt` + `.is(order_id,null)` belt-and-suspenders means even a classify bug cannot expire a finalized or in-window row.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Method: true line-deletion, **no `git stash`** (per hard guard) — `git checkout origin/main -- index.ts config.toml <1187-migration>` + `rm classify.ts`; restore via `git checkout HEAD -- …`. Baseline HEAD at drill time `f00149875`. (Rebase note: the implementor's originally-cited hashes `b6ef60f8a`/`071c6bbbc` were rewritten by this phase's rebase onto post-COMMS-0109 main; the byte-identical fix content now lives at `fa9cab900` (implementation) + `082697b2b` (R-7b hardening).)

- **Full-revert leg** (index/config/migration → origin/main; classify.ts deleted): `orch_1388_classify_matrix.test.ts` **RED** (`error: Type checking failed` — import of deleted module); `orch_1388_reconciler_expiry_sweep.test.ts` **RED** (`NotFound … classify.ts`, `0 passed | 1 failed`). Matches the implementor's claim.
- **Partial-revert leg** (classify.ts restored; index/config/migration still pre-fix): sweep suite **8/12 RED** — exactly **R-1, R-2, R-3, R-5, R-6b, R-7, R-7b, R-7c** failed; **R-4, R-6, R-8, R-8b** legitimately green (they assert on the restored classify.ts + the untouched webhook router). Byte-for-byte the implementor's documented 8/4 split — confirmed, not trusted.
- **Restore leg** (`git checkout HEAD`): 18 + 12 + 3 all green; working tree clean after each leg.

---

## 5. Adversarial test added (tester side — DIFFERENT ANGLE)

- **File:** `supabase/functions/__tests__/orch_1388_money_safety_invariant.test.ts` (NEW, append-only).
- **Commit:** `a20f3c1a8` (on branch, in `git diff origin/main...HEAD --name-only`).
- **Angle (distinct from the implementor's two suites):** the implementor's `classify_matrix` asserts *specific rows → specific actions* (enumerated points); the `expiry_sweep` asserts *source needles present*. Mine proves the ONE load-bearing SAFETY PROPERTY as a **universal invariant** swept over the full cross-product `{4 ref classes} × {complete Stripe PI status enum + 7 adversarial fuzz strings} × {past / exact-ms boundary / future / NULL / unparseable}`:
  - **INVARIANT A** — `expire` NEVER coincides with PI success/in-flight evidence (`succeeded`/`processing`/`requires_action`/`requires_capture`), incl. resolved-PI STRIPE_CS; `succeeded`→finalize at every expiry.
  - **INVARIANT B** — the dual: every `expire` is strictly-past-expiry, non-Paystack, and success/paid-evidence-free (realistic ref→truth couplings mirroring index.ts I/O routing).
  - **INVARIANT C** — PAYSTACK is inert to Stripe: always `skip paystack_unverified`.
  - **BOUNDARY** — `expires_at === now` to the millisecond is NOT past (`<`, not `<=`) — **a comparator the implementor's ±ε points do not pin**.
  - **classifyRef fuzz** — the Paystack guard is unbypassable: `mingla_*`, `mingla_pi_*`, `PI_` (case), ` pi_` (whitespace), `xpi_` all → PAYSTACK, never a Stripe retrieve.
- **Real-module provenance:** imports the SHIPPED `classify.ts`; never re-implements the partition (the oracle sets `MONEY_EVIDENCE_PI` / `isStrictlyPast` are the test's own independent reference, so a module regression cannot mask itself).
- **fails-on-revert verified at `a20f3c1a8`** (two legs, both re-run this phase):
  1. Full revert — delete `classify.ts` → import type-check fail → all 5 RED.
  2. **Semantic mutation** — flip `isPastExpiry` `<`→`<=` in classify.ts → my suite **RED** (BOUNDARY + INVARIANT B, 2 failed) while the implementor's `classify_matrix` stays **18/18 green** — direct proof this suite closes a gap the implementor's matrix misses. Restore → 5/5 green.
- **Both tests in the closing diff:** `orch_1388_classify_matrix.test.ts`, `orch_1388_reconciler_expiry_sweep.test.ts` (implementor) AND `orch_1388_money_safety_invariant.test.ts` (tester) all appear in `git diff origin/main...HEAD --name-only`.

Full battery from worktree ROOT (relative test paths, per the harness cwd-relative-read note): **38 passed | 0 failed** (18 classify + 12 sweep + 5 money-safety + 3 the 1188 regression suite). `deno check` on index.ts/classify.ts/my test — clean. `deno fmt --check` — clean.

---

## 6. Tester angle results (SPEC §9 T-A1..T-A7)

| Angle | Result | Evidence |
|---|---|---|
| **T-A1** mid-payment at `expires_at ± ε` never expired | **PASS** | INVARIANT A holds the protect set at PAST/±ε/BOUNDARY_EXACT/FUTURE; BOUNDARY test pins the exact-ms edge; classify T-3/T-5. |
| **T-A2** succeeded-but-webhook-lost in same batch finalizes, not expires | **PASS** | INVARIANT A `succeeded`→finalize at every expiry; per-row purity means a mixed batch yields both counters. classify T-2/T-7. |
| **T-A3** keystone (expiry does not block late `succeeded`) | **PASS (independently proven)** | R-8 anchored slice has no `.eq("status")`; `_shared/stripeWebhookRouter.ts` + `biz_ticket_checkout_finalize` are DO-NOT-TOUCH and byte-identical (diff). Reasoned chain §7. |
| **T-A4** Paystack fail-safe (never Stripe, never expired) | **PASS** | INVARIANT C + classifyRef fuzz; index.ts routes PAYSTACK to zero retrieves. |
| **T-A5** connected-account visibility (`Stripe-Account` header load-bearing) | **PASS (live-proven)** | Live control: `GET pi_3TmqbH…` WITH `Stripe-Account: acct_1Tml2YI4pBxuXrhh` → HTTP **200**; WITHOUT header (plain platform retrieve) → HTTP **404 `resource_missing`**. index.ts:81-85/101-107 pass `stripeAccount` when `stripe_account_id` set; all 5 rows have it set. |
| **T-A6** live read-only 5-row prediction | **PASS** | §9 table — all 5 re-confirmed `requires_payment_method`/zero-charge at test time; predicted all 5 → `expired`, none finalized. |
| **T-A7** error containment + idempotence + batch cap | **PASS** | index.ts per-row `try/catch` (index.ts:158-361) pushes `{error}` and continues — one throwing retrieve cannot abort the batch or expire that row (expire is only reached on a returned classify action, never in the catch). Idempotence: a second sweep over `expired` rows never re-selects them (status leaves the `.in([...])` set). Cap: `SWEEP_BATCH_LIMIT = 50` + `.limit()` + `.order("created_at", asc)` (R-1). |

### §7 — Keystone independent reasoning (late payment after expiry still finalizes)

1. The sweep's EXPIRE write mutates only the DB row (`status/failed_at/failure_reason/updated_at`) and issues **zero Stripe calls** — the PaymentIntent is never canceled (SC-10, live-observed GET-only).
2. A late `payment_intent.succeeded` webhook enters `handleTicketCheckoutPaymentIntent`, which looks the session up by `stripe_payment_intent_id` with **no `.eq("status")`** (R-8 anchored proof) — an `expired` row is still found.
3. `biz_ticket_checkout_finalize` (latest migration `20261117000001`) guards on `IF v_session.order_id IS NOT NULL` and completes unconditionally otherwise — an `expired` row has `order_id = null` (the sweep's CAS `.is("order_id", null)` guarantees it only ever expires order_id-null rows), so finalize proceeds and transitions `expired → paid_completed`.
4. Therefore honest expiry and late-payment safety **coexist** — no money can be stranded by a DB-only expiry. The load-bearing "why" is documented in index.ts:25-32 with a DO-NOT-harden warning.

---

## 7. Constitution 14-rule matrix (independently re-checked against the diff)

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | no UI surface |
| 2 | One owner per truth | **PASS** | the sweep writes session status via CAS on `status` snapshot + `order_id null` — it yields to concurrent finalize/create (0-row → `skip:"raced"`), never double-writes |
| 3 | No silent failures | **PASS** | per-row errors surfaced in `errors` counter + `results`; `cs_paid_no_pi` additionally `console.error`; summary log per run |
| 4 | One query key per entity | N/A | no React Query |
| 5 | Server state server-side | N/A | edge fn, no Zustand |
| 6 | Logout clears everything | N/A | no auth/session client state |
| 7 | Label `[TRANSITIONAL]` + exit | **PASS** | no transitional code introduced (implementor §10) |
| 8 | Subtract before adding | **PASS** | reuses existing `expired`/`failed_at`/`failure_reason`; migration = NONE; finalize block MOVED not duplicated |
| 9 | No fabricated data | **PASS** | expiry only on Stripe-proven-unpaid + past-expiry; ambiguous/unverifiable → skip; nothing faked |
| 10 | Currency-aware | N/A | no amount rendering (status-only write) |
| 11 | One auth instance | **PASS** | single service-role client; service-role bearer check at entry |
| 12 | Validate at the right time | **PASS** | `nowIso` captured once/run; CAS re-checks `.lt("expires_at", nowIso)` server-side at write time; strictly-`<` (BOUNDARY test) |
| 13 | Exclusion consistency | **PASS** | in-flight `.in([...])` select and the expiry cutoff are consistent; in-window rows uniformly protected across classify + CAS |
| 14 | Persisted-state startup | N/A | no client hydration |

No violation → no automatic P0.

---

## 8. Device / parity matrix

Single shared backend path (one edge fn) — parity AUTOMATIC per SPEC §3; no client branches on the swept states; `expired` already in every client status union.

| Surface | Verdict | Reason |
|---|---|---|
| Consumer iOS / Android | N/A (skip) | no reader branches on swept states; no file touched |
| Buyer/anonymous Web | N/A (behavioral no-op) | a poll on a weeks-dead session now sees honest `expired`; clients check only `order?.orderId` |
| Business iOS / Android | N/A (skip) | sheet-cancel flow unchanged; no client write added |
| Admin Web / Business Web preview | N/A (skip) | zero references to the table |
| **Backend edge fn + config + migration comment** | **PASS** | the only touched surface; verified above |
| Physical iPhone (HITL) | N/A | no user-touchable surface — nothing to hand off |
| **Live prod (read-only)** | **PASS** | Supabase SELECT-only (5-row + status distribution); Stripe GET-only (10 PI reads + 1 no-header control); deployed-fn state read via `list_edge_functions`. Zero writes, zero mutations, zero deploys. |

---

## 9. Predicted first-prod-run outcome (T-A6, read-only) — the 5 stuck rows

Deploy is CLOSE-owned (orchestrator, from merged main). Live truth captured this phase (2026-07-18):

| Session id (prefix) | PI id | DB status | past_expiry | order_id | Stripe status (live GET) | charges | → predicted sweep action |
|---|---|---|---|---|---|---|---|
| `4fb46905…` | `pi_3TmqbHI4pBxuXrhh0Zw4v0Fq` | processing_payment | true | null | requires_payment_method | none | **EXPIRE** ($65) |
| `37572cf8…` | `pi_3TmqfRI4pBxuXrhh0cXZ2vyi` | processing_payment | true | null | requires_payment_method | none | **EXPIRE** ($20) |
| `96949032…` | `pi_3Tmr3kI4pBxuXrhh1AlyasBC` | processing_payment | true | null | requires_payment_method | none | **EXPIRE** ($10) |
| `c9bac9dd…` | `pi_3ToXuJI4pBxuXrhh0OaFDbwh` | processing_payment | true | null | requires_payment_method | none | **EXPIRE** ($10) |
| `9bfcaaf8…` | `pi_3TooOQI4pBxuXrhh0cZrpJqL` | processing_payment | true | null | requires_payment_method | none | **EXPIRE** ($20) |

**First run:** `{ reconciled: 0, expired: 5, skipped: 0, errors: 0 }` — each stamped `status='expired', failed_at=<run>, failure_reason='abandoned_past_expiry'`. **Steady state (subsequent runs):** `{ reconciled: 0, expired: 0, skipped: 0, errors: 0 }` (rows leave the `.in([...])` select → F-7 forever-work stops). No row finalized (zero charges → never `succeeded`). No web/no-ref/Paystack rows exist, so no other action fires. All 5 have `stripe_account_id` set → the sweep uses the `Stripe-Account` header (T-A5 proved that path returns 200; the plain path 404s).

---

## 10. Discoveries for Orchestrator (side issues — NOT fixed here)

- **DISC-1 (COMMS-0109 number collision — CLOSE-blocking to resolve):** the dispatch labels the CLOSE PR "COMMS-0109", but `COMMS-0109` is ALREADY an OPEN WARN in the ledger (mingla-orchestrator, ORCH-1385 merge-propagation / rerun-red guidance). The CLOSE comms entry must take the **next free** number, not 0109. Flagging so CLOSE doesn't overwrite the live ledger row.
- **DISC-2 (COMMS-0109 WARN factored):** this phase rebased the ORCH-1388 branch onto post-fix `origin/main` (`d4f0996df`+), so the CLOSE PR will be a FRESH pull_request event, not a rerun against pre-fix main — no rerun-red rediagnosis needed. Ack recorded in the ledger.
- **DISC-3 (implementor D-1 confirmed):** strict-grep `.test.mjs` self-test harnesses cannot run from a worktree whose path contains `[`/`]` (Node percent-encodes the brackets in `import.meta.url` child-process resolution). Zero CI impact (clean checkout paths). The underlying gates (`i-proposed-r`, `orch-0829b-d1`) run clean here (0 violations / PASS). Not a code defect.
- **DISC-4 (deploy note for CLOSE):** the currently-deployed fn is **version 234** (finalize-only, ACTIVE, verify_jwt=true) — the OLD code. The orchestrator's deploy from merged main is what activates the two-branch sweep; its first scheduled run IS the backfill. Confirm `expired:5` then steady `expired:0` in the fn logs, and re-run the SC-2 read-only status-distribution check.

---

## 11. Downstream routing

**PASS → orchestrator CLOSE.** One fresh PR from `ORCH-1388-checkout-session-reconciler` (use the NEXT free COMMS number, not 0109 — DISC-1); merge on all-green gates; deploy `reconcile-stuck-checkouts` from merged main (`verify_jwt=true`; authenticated first-call verify → expect `{reconciled:0, expired:5, …}`); observe the backfill (SC-2) then steady `expired:0`; run the read-only `SELECT status, count(*) …` post-check; flip `I-PROPOSED-1388-RECONCILER-HONEST-EXPIRY` DRAFT→ACTIVE; reap the worktree.
