# SPEC — ORCH-1388 [checkout-session honest expiry: reconciler non-succeeded branch + proactive `expired` terminal]

- **Phase:** SPEC (contract only — no product code in this phase)
- **Author:** mingla-forensics+claude, 2026-07-17
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1388-[checkout-session-reconciler]/` on branch `ORCH-1388-checkout-session-reconciler`
- **Ground truth (do not re-derive):** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1388_CHECKOUT_SESSION_RECONCILER.md` (F-1..F-7, W1–W8, §6 blast, §11–12) + `Mingla_Artifacts/evidence/ORCH-1388/`
- **Binding Seth rulings (2026-07-17, WORLD_MAP § Issue Registry — NOT relitigable):**
  1. Abandonment cutoff = the EXISTING 15-min `expires_at` (ORCH-0829-B precedent). Stripe truth is re-checked at sweep time before terminalizing any row; a PI with any charge/success evidence is NEVER expired — it routes down the existing finalize path.
  2. Terminal value = reuse **`expired`** (zero migration), `failed_at` stamped per the 0829-B shape.
  3. Sweep breadth = ALL past-expiry in-flight states: `processing_payment`, `awaiting_web_redirect`, `requires_payment`, `pending_free`.
  4. **NO Stripe writes of any kind** — DB-only honesty. The sweep never cancels/mutates PIs.
- **Fold-ins:** D-C (explicit `[functions.reconcile-stuck-checkouts]` config.toml stanza) + D-D (correct the ORCH-1187 migration-comment overpromise wherever the reconciler is touched).

---

## 1. Executive summary

`reconcile-stuck-checkouts` (the */15-min cron safety net) can today only FINALIZE sessions whose PaymentIntent succeeded; every non-succeeded PI is skipped forever (F-1). No proactive expiry writer exists anywhere (F-2), so abandoned checkouts sit in `processing_payment` (and could sit in the three sibling in-flight states) permanently — 5 of 9 all-time production rows are stuck this way, poisoning monitoring and growing the reconciler's forever-work list.

This SPEC extends the SAME edge function with a **non-succeeded branch**: for each in-flight session it re-checks Stripe truth read-only (direct charges on CONNECTED accounts — the `Stripe-Account` header path the investigation verified; a plain platform retrieve 404s), then

- **succeeded evidence** → the EXISTING finalize path, unchanged;
- **genuinely unpaid** (Stripe status proves no successful or in-flight charge) AND past `expires_at` → stamp `status='expired'` + `failed_at` + `failure_reason` (all three columns already exist — zero schema change);
- **anything ambiguous or mid-flight** → skip, never expire (fail-safe).

Idempotent, capped batch, structured `{reconciled, expired, skipped, errors}` logs. **Migration: NONE.** The backfill for the 5 existing stuck rows is the sweep's own first production run after the orchestrator deploys from merged main — no manual SQL.

**Keystone safety property (verified in this phase, load-bearing):** a DB-only expiry can never strand real money, because a late payment through a never-canceled PI still finalizes. `_shared/stripeWebhookRouter.ts` looks the session up by `stripe_payment_intent_id` with **no status filter** (:1087-1091), and the LATEST `biz_ticket_checkout_finalize` (migration `20261117000001`) guards **only on `order_id`** (`IF v_session.order_id IS NOT NULL` — line 78) and unconditionally completes (line 317). `expired` → `paid_completed` on a late `payment_intent.succeeded` is legal and correct. This property is a hard DO-NOT-BREAK (see §6, §9, tester angle T-A4).

---

## 2. Scope & non-goals

**In scope**
- `supabase/functions/reconcile-stuck-checkouts/index.ts` — widened select + classification + expiry write + response counters + header-comment rewrite (D-D half 1).
- NEW pure module `supabase/functions/reconcile-stuck-checkouts/classify.ts` — the decision partition as an exported pure function, unit-testable.
- `supabase/config.toml` — explicit `[functions.reconcile-stuck-checkouts]` stanza (D-C).
- `supabase/migrations/20261116000000_orch_1187_reconcile_stuck_checkouts_cron.sql` — **comment-only** correction of the "ANY future stuck session auto-recovers" overpromise (D-D half 2). This migration is already applied on prod; a comment edit never re-applies (Supabase records applied versions by name) and the file still applies cleanly on fresh CI Postgres. NOT a new migration.
- Two new deno test files under `supabase/functions/__tests__/` (§9).

**Non-goals (explicitly OUT — registered elsewhere or ruled out)**
- ORCH-1390 — cron 401s on `process-booking-deadlines` / `keep-warm`. Do not touch those fns or their crons.
- ORCH-1391 — capacity predicate `awaiting_web_redirect` omission. Do not touch `biz_ticket_checkout_create_session` or any capacity logic.
- Any Stripe mutation (cancel/update/confirm/create) — ruling 4.
- Any new status value (`abandoned` etc.) — ruling 2.
- Any schema/RPC change — `expired`, `failed_at`, `failure_reason` all exist; finalize is untouched.
- Renaming/re-timing `processing_payment` semantics (F-3 is a contributor, not fixed here; the sweep keys on `expires_at` + Stripe truth and works regardless).
- The cron job itself — jobid/jobname/schedule `*/15 * * * *` unchanged.
- Paystack API calls — see OQ-A (default: Paystack-armed rows are never expired, skipped fail-safe).

**Assumptions (verified this phase, cited):**
- Status CHECK admits `expired`; terminal set = `paid_completed/free_completed/failed/expired` (migration `20260520000001`, investigation §3 — never altered since).
- The 0829-B lazy tombstone (`create_session` 1174:144-155) preserves terminal statuses on key-match — sweep-expired rows hit its terminal-preserve CASE, so retry idempotency keeps working.
- Capacity reservation (1174:262-263) already ignores past-expiry rows — the sweep frees no inventory (none was held) and cannot race it.
- The Paystack arm stores its reference IN `stripe_payment_intent_id` as `mingla_<sessionId>_<b36>` (`ticket-checkout-create/index.ts:707-717`) — NOT a retrievable Stripe PI id. The web Stripe arm stores only `stripe_checkout_session_id`; its PI stays NULL until payment (:1213-1220).

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

Single shared backend path; no client branches on `processing_payment`; `expired` is already inside every client status union (`ticketCheckoutService.ts:115`; investigation §6). Parity is automatic (one edge fn) — no per-surface SC splits needed.

| # | Surface | Covered? | User-visible behavior demanded | Files touched there |
|---|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/`) | NOT covered | none — no reader branches on the swept states | none |
| 2 | Consumer Android (`app-mobile/`) | NOT covered | none — same shared reader code | none |
| 3 | Buyer/anonymous Web (`mingla-business` `/checkout/...`) | NOT covered (behavioral no-op) | a buyer polling `ticket-checkout-status` on a weeks-dead session now sees the honest `expired` instead of an eternal `processing_payment`; clients only check `order?.orderId` presence — no copy/branch change | none |
| 4 | Business iOS | NOT covered | none — sheet-cancel flow unchanged; no server write added client-side | none |
| 5 | Business Android | NOT covered | none — same | none |
| 6 | Admin Web (`mingla-admin`, adjacent) | NOT covered | none — zero references to the table (grep, investigation §6) | none |
| 7 | Business Web preview (adjacent) | NOT covered | none | none |
| — | **Backend (edge fn + config)** | **COVERED** | honest terminal states within one sweep cycle; monitoring counters | `supabase/functions/reconcile-stuck-checkouts/*`, `supabase/config.toml`, 1187 cron migration comment |

Realtime note (investigation §6): the expiry UPDATE emits a realtime event on `ticket_checkout_sessions`; only buyers actively subscribed to their OWN session receive it, the client does not branch on the status string, and the sweep never touches in-window rows — no client change required.

---

## 4. Layered specification

### 4.1 Database — **NONE (stated per dispatch)**

No migration. No new status. No new column. The terminal write reuses the exact ORCH-0829-B shape: `status='expired'`, `failed_at=now`, plus the EXISTING `failure_reason` column (dispatch: "a reason field IF one already exists") with the bound literal **`abandoned_past_expiry`** (matches the sibling snake_case convention, e.g. `installment_customer_provisioning_failed`).

### 4.2 Edge function — `supabase/functions/reconcile-stuck-checkouts/index.ts`

**Unchanged:** fn name, route, method, auth (service-role bearer check at :29-31), Stripe client (`stripeTicketCheckout()`), pepper, the ENTIRE succeeded→finalize path including the ORCH-1188 `ticket-confirmation-dispatch` `skipNotify` PDF backfill, and both existing `orch-strict-grep-allow stripe-no-idempotency-key` annotations on the PI retrieves.

**(a) Widened select** — replace the current predicate (`.eq("status","processing_payment").not("stripe_payment_intent_id","is",null)`) with:

- `.in("status", ["processing_payment", "awaiting_web_redirect", "requires_payment", "pending_free"])` (ruling 3 — the whole strand family; the PI-non-null filter is REMOVED because no-ref rows are now in scope),
- selected columns: `id, status, expires_at, order_id, stripe_payment_intent_id, stripe_checkout_session_id, stripe_account_id, brand_id, buyer_email`,
- `.order("created_at", { ascending: true }).limit(SWEEP_BATCH_LIMIT)` with `const SWEEP_BATCH_LIMIT = 50` (capped batch per dispatch; current population is 5; the 15-min cadence drains any backlog across successive runs).

**(b) Classification** — NEW pure module `classify.ts` exporting one pure function (no I/O, no Stripe/DB imports) that takes the row's ref columns, the (already-retrieved) Stripe truth, and `now`, and returns exactly one action: `finalize | expire | skip(reason)`. `index.ts` performs the I/O (retrieves, RPC, UPDATE) and obeys the returned action. The partition is BINDING:

**Ref classification (from DB columns, in this order):**

| Class | Discriminator | Stripe truth source |
|---|---|---|
| STRIPE_PI | `stripe_payment_intent_id` starts with `pi_` | retrieve the PI (existing code path, `Stripe-Account` header when `stripe_account_id` set) |
| PAYSTACK | `stripe_payment_intent_id` non-null, NOT `pi_`-prefixed (the `mingla_*` reference) | NONE — never sent to Stripe (it is not a Stripe id) |
| STRIPE_CS | PI null, `stripe_checkout_session_id` non-null | retrieve the Checkout Session read-only (same header rule); if `cs.payment_intent` resolves to an id, retrieve THAT PI and fall through to the PI partition |
| NO_REF | all ref columns null (`pending_free` / pre-mint `requires_payment`) | NONE — no payment object was ever minted, no money is possible |

**PI-status partition (exhaustive over Stripe's PI state machine):**

| PI status | Action | Why |
|---|---|---|
| `succeeded` | **FINALIZE** (existing branch, regardless of `expires_at` — current behavior preserved) | webhook-lost paid session; ruling 1 |
| `processing`, `requires_action`, `requires_capture` | **SKIP** `pi_status_<status>` — never expire, even past expiry | in-flight / pending-3DS / authorized money; Stripe's state machine says a charge may still complete |
| `requires_payment_method`, `requires_confirmation`, `canceled` | past `expires_at` → **EXPIRE**; in-window → SKIP `in_window` | Stripe's state machine guarantees NO successful or in-flight charge exists in these states (a succeeded charge forces `succeeded`; an in-flight one `processing`; an authorized one `requires_capture`) — this status partition IS ruling 1's "charge/success evidence" check. A prior DECLINED attempt (`latest_charge` = failed charge) does not block expiry: declined attempts move no money |
| any other/unknown (future API values) | **SKIP** `pi_status_<status>` | fail-safe default: never expire on unrecognized truth |

**CS partition (web arm, PI null):**

| CS truth | Action |
|---|---|
| `cs.payment_intent` present | resolve → retrieve that PI → PI partition above (a `succeeded` PI finalizes with THAT id — `biz_ticket_checkout_finalize` line 161 COALESCEs `p_stripe_payment_intent_id` over the row's null column) |
| `cs.payment_status` = `"unpaid"`, no PI | past `expires_at` → **EXPIRE**; in-window → SKIP |
| `cs.payment_status` ∈ `{"paid","no_payment_required"}` with no resolvable PI | **SKIP** `cs_paid_no_pi` (error-grade log) — never expire; surface for a human |
| unknown | **SKIP** — fail-safe |

**PAYSTACK:** always **SKIP** `paystack_unverified` — never expired, never sent to Stripe (OQ-A default; zero such rows all-time).

**NO_REF:** past `expires_at` → **EXPIRE**; in-window → SKIP `in_window`.

**(c) The EXPIRE write** — a guarded compare-and-swap, rowcount-verified (I-PROPOSED-I):

```
.update({ status: "expired", failed_at: nowIso, failure_reason: "abandoned_past_expiry", updated_at: nowIso })
.eq("id", id).eq("status", snapshotStatus).is("order_id", null).lt("expires_at", nowIso).select("id")
```

- `snapshotStatus` = the status read in THIS run's select (CAS — a concurrent finalize/create transition makes it 0-row).
- `.lt("expires_at", nowIso)` re-checks the cutoff server-side at write time; `nowIso = new Date().toISOString()` captured once per run (second-level clock skew is immaterial: eligibility is already Stripe-truth-gated, and the record population is weeks past expiry). A NULL `expires_at` never matches `.lt` — fail-safe.
- `.is("order_id", null)` — belt-and-suspenders: a finalized row can never be expired even if status raced.
- `.select("id")` — rowcount verification. **0 rows → count as `skip: "raced"` (NOT an error);** ≥1 row → count under `expired`.

**(d) Response + structured logs** — extend the existing counters additively (pg_net captures the body; nothing parses it programmatically):

```
{ reconciled, expired, skipped, errors, results }
```

- `expired` = results with `status: "expired"`; existing `reconciled`/`skipped`/`errors` semantics unchanged.
- Per-row result entries carry `sessionId`, the ref used (`piId` and/or `csId`), and `status | skip | error`.
- One `console.log("[reconcile-stuck-checkouts] run summary", {...counters})` per run for edge-log greppability.

**(e) Stripe read-only + gate compliance** — the ONLY new Stripe calls are read-only retrieves (`checkout.sessions.retrieve`, and PI retrieve for the CS-resolved id). Each new call site MUST carry the established annotation within 5 lines above: `// orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve`. **Zero occurrences of `stripe.paymentIntents.cancel|update|confirm|create` or any other mutating Stripe method may exist in this fn** (ruling 4; enforced by test R-6, §9).

**(f) Header comment rewrite (D-D half 1)** — replace the ORCH-0849 "one-shot backfill" header (:1-18) with an accurate contract: permanent */15 cron net with TWO branches (finalize succeeded / expire abandoned past-expiry), DB-only Stripe posture, ORCH-1388 reference, and the late-payment safety property (§1) as a protective "why" comment.

### 4.3 Config — `supabase/config.toml` (D-C)

Add the explicit stanza (currently absent — the fn runs on the platform default):

```
[functions.reconcile-stuck-checkouts]
verify_jwt = true
```

with a comment: cron-invoked via pg_cron → `net.http_post` with the service-role bearer (a valid JWT, so platform verification passes); the fn additionally enforces its own service-role check at entry. `verify_jwt = true` documents the CURRENT live posture with ZERO behavior delta (OQ-B default — see §10).

### 4.4 Migration comment (D-D half 2) — `20261116000000_orch_1187_reconcile_stuck_checkouts_cron.sql`

Comment-only edit of lines 5-8: remove the overpromise ("…so ANY future stuck session auto-recovers within minutes…") and state the two-branch truth: *finalizes PI-succeeded sessions; expires genuinely-unpaid past-expiry in-flight sessions (ORCH-1388); mid-flight/ambiguous rows are skipped fail-safe.* No SQL statement may change; the file must remain byte-identical outside comment lines.

### 4.5 Service / Hook / Component / Realtime layers — N/A

No client file changes (see §3). Realtime behavior analyzed in §3 note — no subscription/copy change.

---

## 5. Success criteria (numbered, observable — single backend surface, no per-surface splits)

1. **SC-1 (core expiry):** a past-expiry `processing_payment` session whose PI is `requires_payment_method` is updated, in one sweep run, to `status='expired'`, `failed_at` set, `failure_reason='abandoned_past_expiry'`, and counted under `expired` in the response.
2. **SC-2 (backfill = first prod run):** on the first post-deploy production run, ALL 5 known stuck sessions (`4fb46905…`, `37572cf8…`, `96949032…`, `c9bac9dd…`, `9bfcaaf8…` — investigation Q4) terminalize to `expired`; response shows `expired: 5, reconciled: 0, errors: 0`; subsequent runs show `expired: 0` with an empty work list (F-7 forever-work stops).
3. **SC-3 (finalize preserved):** a session whose PI is `succeeded` (any status, any expiry) still finalizes exactly as today — finalize RPC + PDF dispatch + `reconciled` count; no behavior delta on this branch.
4. **SC-4 (mid-payment never expired):** a session at `expires_at ± ε` whose PI is `processing`, `requires_action`, or `requires_capture` is NEVER expired — skipped with `pi_status_<status>`, no DB write.
5. **SC-5 (mixed batch):** a succeeded-but-webhook-lost session in the SAME sweep batch as expire-eligible sessions is finalized, not expired; the batch response shows both counters non-zero.
6. **SC-6 (in-window untouchable):** rows with `expires_at > now()` are never mutated by the expiry branch regardless of PI status (the only permitted write on an in-window row is the pre-existing succeeded→finalize).
7. **SC-7 (web arm):** a past-expiry `awaiting_web_redirect` row with an unpaid CS (no PI) → `expired`; the same row with `cs.payment_intent` → resolved PI truth governs (succeeded → finalize; unpaid → expire); `cs.payment_status="paid"` with no resolvable PI → skipped `cs_paid_no_pi`, never expired.
8. **SC-8 (Paystack fail-safe):** a row whose `stripe_payment_intent_id` is `mingla_*` is never expired and never sent to Stripe; skipped `paystack_unverified`.
9. **SC-9 (no-ref rows):** past-expiry `pending_free` / `requires_payment` rows with no payment refs → `expired`; in-window → untouched.
10. **SC-10 (zero Stripe writes):** the fn contains no mutating Stripe call (cancel/update/confirm/create/capture) — proven by test R-6 and by tester runtime observation (only GETs).
11. **SC-11 (CAS + rowcount):** the expiry UPDATE is guarded by `id + status-snapshot + expires_at < now + order_id IS NULL` and chains `.select("id")`; a raced 0-row outcome is counted `skip: "raced"`, never an error, never a second write.
12. **SC-12 (observability):** every run returns `{reconciled, expired, skipped, errors, results}` and logs one summary line; pg_net response capture shows the new shape.
13. **SC-13 (config explicit):** `supabase/config.toml` contains `[functions.reconcile-stuck-checkouts]` with `verify_jwt = true`; deployed auth behavior unchanged (401 without bearer, 200 with service-role bearer — orchestrator's post-deploy curl check).
14. **SC-14 (D-D honesty):** neither the fn header nor the 1187 migration contains the "ANY future stuck session auto-recovers" overpromise; both describe the two-branch contract; the migration's SQL statements are byte-identical.
15. **SC-15 (late-payment safety intact):** the webhook succeeded path still finalizes a session REGARDLESS of its status — a sweep-`expired` row receiving `payment_intent.succeeded` transitions to `paid_completed` (structural: webhook lookup has no status filter; finalize guards only on `order_id`; enforced by test R-8 and tester angle T-A4).

---

## 6. Invariants

**Preserved (ID → how → verifying test):**
- **I-CHECKOUT-IDEMPOTENT** — in-window sessions are untouchable by the expiry branch (partition + CAS `.lt("expires_at")`); genuine retries keep short-circuiting; sweep-expired rows hit the 0829-B tombstone's terminal-preserve CASE. → tests U-matrix in-window rows + R-3; SC-6.
- **I-PROPOSED-CHECKOUT-EXPIRY-TOMBSTONE** (0829-B, DRAFT) — the sweep is the proactive completion of this invariant using the identical terminal shape (`expired` + `failed_at`). Its CI gate (`orch-0829b-d1-checkout-expiry-tombstone-or-clause-present.mjs`) scans only migrations defining `biz_ticket_checkout_create_session` — untouched by this change (verified this phase). → gate stays green.
- **I-PROPOSED-R (Stripe idempotency-key gate)** — all new Stripe calls are read-only retrieves carrying the established allow annotation. → gate `i-proposed-r-stripe-idempotency-key.mjs` green.
- **I-PROPOSED-I (mutation rowcount verified)** — the expiry UPDATE chains `.select("id")` and branches on rowcount. → test R-5; SC-11.
- **Late-payment finalize safety (§1 keystone)** — no status guard may be added to the webhook lookup or finalize path by this change (they are DO-NOT-TOUCH anyway). → test R-8; SC-15.

**NEW (proposed DRAFT — flips ACTIVE at CLOSE; orchestrator owns the flip):**
- **`I-PROPOSED-1388-RECONCILER-HONEST-EXPIRY` (DRAFT):** every past-expiry in-flight `ticket_checkout_sessions` row with no payment-success/in-flight evidence at its truth source terminalizes to `expired` (+`failed_at`+`failure_reason`) within one reconciler cycle; the reconciler never mutates Stripe state and never terminalizes a row whose truth source shows success/in-flight evidence or cannot be checked (Paystack, unknown statuses). Enforced by the §9 test family.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1 (happy) | abandoned native session | past-expiry `processing_payment`, PI `requires_payment_method` | EXPIRE; `failure_reason='abandoned_past_expiry'` | unit (classify) + runtime |
| T-2 (happy) | webhook-lost paid session | any expiry, PI `succeeded` | FINALIZE (existing path) | unit + runtime |
| T-3 (edge) | mid-payment at boundary | `expires_at ± ε`, PI `processing` / `requires_action` / `requires_capture` | SKIP, never expire | unit |
| T-4 (edge) | declined-then-abandoned | past-expiry, PI `requires_payment_method` with failed `latest_charge` | EXPIRE (declined ≠ money moved) | unit |
| T-5 (edge) | in-window abandoned-looking | `expires_at > now`, PI `requires_payment_method` | SKIP `in_window` | unit |
| T-6 (happy) | web abandoned | past-expiry `awaiting_web_redirect`, CS unpaid, no PI | EXPIRE | unit |
| T-7 (edge) | web paid, webhook lost | CS `payment_intent` → PI `succeeded` | FINALIZE with resolved PI id | unit |
| T-8 (error) | web paid, no PI resolvable | CS `payment_status="paid"`, no PI | SKIP `cs_paid_no_pi`, never expire | unit |
| T-9 (edge) | Paystack ref | `stripe_payment_intent_id = "mingla_…"` | SKIP `paystack_unverified`; ref never sent to Stripe | unit + source-contract |
| T-10 (happy) | no-ref strands | past-expiry `pending_free` / `requires_payment`, all refs null | EXPIRE | unit |
| T-11 (edge) | unknown PI status | past-expiry, PI status = future/unknown string | SKIP (fail-safe) | unit |
| T-12 (error) | Stripe retrieve throws | network/permission error mid-row | row counted under `errors`; loop continues; NO expire on error | unit + source-contract |
| T-13 (edge) | CAS race | UPDATE returns 0 rows (concurrent finalize won) | `skip: "raced"`, not error, no retry-write | source-contract + tester |
| T-14 (runtime) | first prod run | the 5 real stuck rows | `expired: 5`; steady state `expired: 0` after | live (TEST/CLOSE, read-only SQL + pg_net) |
| T-15 (structural) | late payment on expired row | `payment_intent.succeeded` webhook for an `expired` session | finalize → `paid_completed` (no status guard anywhere) | source-contract (R-8) |

---

## 8. Implementation order

1. `supabase/functions/reconcile-stuck-checkouts/classify.ts` — NEW pure decision module (§4.2b partition, exhaustive, fail-safe default).
2. `supabase/functions/reconcile-stuck-checkouts/index.ts` — widened select (§4.2a), ref-class I/O routing, EXPIRE write (§4.2c), counters/logs (§4.2d), annotations (§4.2e), header rewrite (§4.2f). The succeeded→finalize block is MOVED, not modified.
3. `supabase/config.toml` — add the stanza (§4.3).
4. `supabase/migrations/20261116000000_orch_1187_reconcile_stuck_checkouts_cron.sql` — comment-only correction (§4.4).
5. `supabase/functions/__tests__/orch_1388_classify_matrix.test.ts` — unit matrix over the full partition (imports `classify.ts`; T-1..T-11).
6. `supabase/functions/__tests__/orch_1388_reconciler_expiry_sweep.test.ts` — source-contract tests (R-1..R-8, §9).
7. Run locally: both deno test files + `i-proposed-r-stripe-idempotency-key.mjs` + `orch-0829b-d1-checkout-expiry-tombstone-or-clause-present.mjs` + the revert drill (§9).

**Deploy note (orchestrator, post-merge — NOT the implementor):** deploy `reconcile-stuck-checkouts` from merged main; verify with an authenticated curl first call (per the edge-deploy SOP): expect HTTP 200 with the new `{reconciled, expired, …}` shape. **That first production run IS the backfill** for the 5 stuck rows — no manual SQL. Post-run read-only verification: `SELECT status, count(*) FROM ticket_checkout_sessions GROUP BY 1;` → zero rows remain in the four in-flight states older than `expires_at`.

---

## 9. Regression prevention — two-sided contract

### Implementor side (fails-on-revert; each MUST fail when the fix is reverted and pass when restored)

**File A — `orch_1388_classify_matrix.test.ts` (real unit tests, imports `classify.ts`):** the full T-1..T-11 matrix (7 PI statuses × in-window/past-expiry × 4 ref classes + CS states + unknown-status fail-safe). Reverting the fix deletes `classify.ts` → import fails → red.

**File B — `orch_1388_reconciler_expiry_sweep.test.ts` (source-contract, `Deno.readTextFile` needle pattern per `orch_1188_reconcile_pdf_backfill.test.ts` — the established local convention):**
- **R-1:** select contains `.in("status"` with ALL FOUR statuses; the old `.eq("status", "processing_payment")` and the old `.not("stripe_payment_intent_id", "is", null)` are GONE; `SWEEP_BATCH_LIMIT` + `.limit(` present.
- **R-2:** the expire write contains `status: "expired"`, `failed_at`, `failure_reason: "abandoned_past_expiry"`.
- **R-3:** CAS guards all present on the expiry update: `.eq("status"`, `.lt("expires_at"`, `.is("order_id", null)`, chained `.select(`.
- **R-4:** the protect set is enforced — the never-expire statuses (`processing`, `requires_action`, `requires_capture`) appear in the classify partition (assert in `classify.ts` source or via File A).
- **R-5:** raced-0-row handling present (`raced` needle) and NOT counted as error.
- **R-6 (ruling 4):** `!/stripe\.\w+(\.\w+)*\.(cancel|update|confirm|create|capture)\(/` over the reconciler fn + classify — zero Stripe mutations. Plus: every `retrieve(` call site has the `orch-strict-grep-allow stripe-no-idempotency-key` annotation.
- **R-7 (fold-ins):** `config.toml` contains `[functions.reconcile-stuck-checkouts]`; the 1187 migration no longer matches `/ANY\s+future\s+stuck\s+session/` and still contains all its SQL probes (`cron.schedule`, `*/15 * * * *`).
- **R-8 (keystone):** the webhook's ticket-checkout session lookup (`stripeWebhookRouter.ts`) has NO `.eq("status"` filter between `.from("ticket_checkout_sessions")` and `.eq("stripe_payment_intent_id"`; the reconciler's Paystack guard (`pi_` prefix check) is present.

Each source-contract assert carries the "why" as its message (protective-comment requirement). **Revert drill (required in the implementation report):** `git stash` of the index.ts/classify.ts changes → File A + R-1..R-6 red; restore → green.

### Tester side (named adversarial angles — mingla-tester owns TEST)

- **T-A1 (dispatch-named):** a mid-payment session at exactly `expires_at ± ε` must never be expired — drive classify with `processing`/`requires_action` at both boundary sides; and confirm `requires_payment_method` at ε-BEFORE expiry is `in_window`-skipped.
- **T-A2 (dispatch-named):** a succeeded-but-webhook-lost session in the same sweep batch as expire-eligible rows must FINALIZE, not expire (mixed-batch ordering).
- **T-A3 (dispatch-named):** connected-account visibility — the PI/CS retrieves carry `stripeAccount` when `stripe_account_id` is set (a plain platform retrieve 404s on these direct-charge PIs — investigation F-5); a `mingla_*` ref must NEVER reach a Stripe retrieve.
- **T-A4:** late-payment safety — simulate/inspect: an `expired` session receiving `payment_intent.succeeded` still finalizes to `paid_completed` (no status guard added anywhere in the chain).
- **T-A5:** CAS race — 0-row update counted `raced`, no error, no second write, loop continues.
- **T-A6:** live post-deploy (read-only) — first prod run drains exactly the 5 known rows to `expired` with `failed_at`/`failure_reason` stamped; steady-state runs return `expired: 0`; pg_net capture shows the new response shape; Stripe activity during the run is GETs only.
- **T-A7:** error-path containment — a throwing Stripe retrieve mid-batch increments `errors`, expires nothing for that row, and does not abort the remaining rows.

---

## 10. Open questions (genuine forks — reversible defaults bound; proceed on defaults unless Seth overrides)

- **OQ-A — Paystack-armed rows:** the dispatch's truth-check is Stripe-framed; verifying a Paystack reference needs a Paystack API read (out of dispatch scope). **DEFAULT (bound): never expire Paystack-armed rows — skip `paystack_unverified`.** Zero such rows exist all-time; fail-safe forever. Reversible: a follow-up ORCH can add the read-only Paystack verify and flip that one classify branch. Cost of the default: a future abandoned Paystack redirect would strand in `awaiting_web_redirect` (visible in the skip counter — monitorable, honest about being unverified).
- **OQ-B — explicit `verify_jwt` value:** **DEFAULT (bound): `verify_jwt = true`** — documents the CURRENT live posture, zero behavior delta (the cron's service-role bearer already passes platform JWT verification). Alternative: `false` per the cron-fn sibling convention (`event-cover-video-reaper`), relying solely on the fn's own service-role check. Reversible: one config line + redeploy.

---

## 11. Downstream routing

- **Next: mingla-implementor** — build exactly §4 + §8 in this worktree (`~/Desktop/mingla-orchs/ORCH-1388-[checkout-session-reconciler]/`, branch `ORCH-1388-checkout-session-reconciler`); run the §9 revert drill; produce the implementation report. STOP-AND-AMEND before touching anything outside §12's allowlist.
- **Then: mingla-tester** — §9 tester angles T-A1..T-A7; runtime evidence required for the live legs (T-A6 read-only prod).
- **Then: orchestrator CLOSE** — PR from the ORCH branch (fresh PR event per COMMS-0109), merge gates green, deploy the edge fn from merged main, verify first call (SC-13), observe the backfill run (SC-2), flip the DRAFT invariant, reap the worktree.

---

## 12. Scoped allowlist + DO-NOT-TOUCH (BINDING)

**Allowlist (the implementor may change ONLY these):**
| File | Change |
|---|---|
| `supabase/functions/reconcile-stuck-checkouts/index.ts` | modify per §4.2 |
| `supabase/functions/reconcile-stuck-checkouts/classify.ts` | NEW per §4.2b |
| `supabase/config.toml` | ADD the §4.3 stanza only |
| `supabase/migrations/20261116000000_orch_1187_reconcile_stuck_checkouts_cron.sql` | comment-only per §4.4 |
| `supabase/functions/__tests__/orch_1388_classify_matrix.test.ts` | NEW |
| `supabase/functions/__tests__/orch_1388_reconciler_expiry_sweep.test.ts` | NEW |

**DO-NOT-TOUCH (stop-and-amend required):** `ticket-checkout-create/index.ts` · `ticket-checkout-confirm/index.ts` · `ticket-checkout-status/index.ts` · `_shared/stripeWebhookRouter.ts` · `_shared/stripe.ts` · `_shared/ticketCheckout.ts` · `ticket-confirmation-dispatch/index.ts` · ALL other migrations (especially every `biz_ticket_checkout_*` RPC definition — **no new migration files: migration = NONE**) · the pg_cron job (name/schedule/body) · `process-booking-deadlines` + `keep-warm` (ORCH-1390) · any capacity logic (ORCH-1391) · all client code (`mingla-business/`, `app-mobile/`, `mingla-admin/`) · every existing test file (append-only gate) · every existing strict-grep gate script.
