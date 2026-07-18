# INVESTIGATION — ORCH-1388 [checkout sessions stuck `processing_payment` forever for never-paid abandonments — `reconcile-stuck-checkouts` never terminalizes them]

- **Phase:** INVESTIGATE only (no fix proposed — SPEC follows after REVIEW)
- **Author:** mingla-forensics+claude, 2026-07-17
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1388-[checkout-session-reconciler]/` on branch `ORCH-1388-checkout-session-reconciler`
- **Confidence:** **PROVEN** (root cause runtime-proven at every truth layer; live-fire sim exemption applies — pure backend/SQL/edge-fn/cron investigation, no UI reproducer)
- **Evidence pack:** `Mingla_Artifacts/evidence/ORCH-1388/` (runtime/cron/pg_net/DB dossier + 5 client_secret-redacted Stripe PI JSONs)

---

## 1. Symptom summary

**Expected:** a checkout session whose buyer walks away without paying should reach an honest terminal state within a bounded time, driven by the `reconcile-stuck-checkouts` safety net (ORCH-1187's migration comment promises: "ANY future stuck session auto-recovers within minutes").

**Actual:** 5 of 9 all-time `ticket_checkout_sessions` rows sit in `processing_payment` forever (oldest since 2026-06-27, ~3 weeks), `failure_reason` NULL, while the reconciler runs every 15 minutes, sees all 5, and skips all 5 — every run, indefinitely. All 5 PIs are abandoned (`requires_payment_method`, zero charges): nobody was charged, no refunds owed (orchestrator facts confirmed and extended to all five).

---

## 2. Investigation manifest (files read, in trace order)

| File | Layer | Why |
|---|---|---|
| `Mingla_Artifacts/WORLD_MAP.md` § ORCH-1388/1387 stanzas | Docs | Prior facts, established Stripe truth for 2 of 5 PIs |
| `supabase/functions/reconcile-stuck-checkouts/index.ts` (all 177 lines) | Code | The reconciler: predicate, auth, Stripe path |
| `supabase/migrations/20261116000000_orch_1187_reconcile_stuck_checkouts_cron.sql` | Schema/Docs | Cron registration + design intent |
| `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql` | Schema | Table + original status CHECK + RLS + create/finalize RPCs |
| `supabase/migrations/20260520000001_orch_0789_0790_web_checkout.sql` | Schema | CURRENT status CHECK (adds `awaiting_web_redirect`) — no later migration alters it (grep-verified) |
| `supabase/migrations/20260520000002_orch_0791_session_terminal_tombstone.sql` | Schema | Terminal-set definition + idempotency tombstone |
| `supabase/migrations/20260605000002_orch_0829b_d1_checkout_expiry_tombstone.sql` | Schema/Docs | LAZY expiry semantics — `expired` + `failed_at` for abandoned in-flight sessions |
| `supabase/migrations/20261101000000_meta_orch_1174_b1_multiline_installments.sql` | Schema | LATEST `biz_ticket_checkout_create_session` — expiry-tombstone predicate survival verified (lines 144-155) |
| `supabase/functions/ticket-checkout-create/index.ts` (1754 lines; all status-transition arms) | Code | Every `processing_payment`/`awaiting_web_redirect`/`failed` writer |
| `supabase/functions/ticket-checkout-confirm/index.ts` (512 lines) | Code | Buyer confirm path; PI-status → client-status mapping |
| `supabase/functions/ticket-checkout-status/index.ts` (all 103 lines) | Code | Buyer status poll; returns raw DB status |
| `supabase/functions/_shared/stripeWebhookRouter.ts` (subscription list + `handleTicketCheckoutPaymentIntent` 1076-1342) | Code | Webhook transitions: succeeded/payment_failed/canceled |
| `supabase/config.toml` | Code | `verify_jwt` registrations (reconcile fn has NO entry) |
| `mingla-business/src/payments/nativeCheckoutFlow.native.ts` | Code | Client abandonment path (sheet cancel) |
| `mingla-business/src/services/ticketCheckoutService.ts`, `eventOrdersService.ts`, `hooks/useOrderRealtimeSubscription.ts` | Code | Every client reader of session status |
| Prod `cron.job`, `cron.job_run_details`, `net._http_response`, `ticket_checkout_sessions` (read-only SQL) | Runtime/Data | Execution history + row truth |
| Stripe live API — 5 × `GET /v1/payment_intents/{id}` with `Stripe-Account` header (read-only) | Runtime | PI truth for all five |

Migration-chain check: for every object cited, the LATEST defining migration was identified and read (`create_session` → 20261101000000; `finalize` → 20261117000001; status CHECK → 20260520000001; cron → 20261116000000). No stale definitions cited.

---

## 3. The state machine (scope item a)

**Status enum (current CHECK, migration 20260520000001 — authoritative, never altered since):**
`pending_free` · `requires_payment` · `awaiting_web_redirect` · `processing_payment` · `paid_completed` · `free_completed` · `failed` · `expired`

**Terminal set (per ORCH-0791/0829-B code):** `paid_completed`, `free_completed`, `failed`, `expired`. Both honest abandoned-terminal candidates (`expired`, `failed`) ALREADY EXIST in the enum — no migration is required to terminalize to `expired`.

**Every writer of `ticket_checkout_sessions.status` (complete map):**

| # | Writer | Transition | Trigger |
|---|---|---|---|
| W1 | `biz_ticket_checkout_create_session` RPC (latest: 1174) | INSERT → `pending_free` / `requires_payment` | checkout create |
| W2 | `ticket-checkout-create` native Stripe arm (index.ts:1692) | `requires_payment` → **`processing_payment`** | **at PI-creation time — BEFORE the buyer sees the PaymentSheet** |
| W3 | `ticket-checkout-create` web Stripe arm (:1216) / Paystack arm (:715) | → `awaiting_web_redirect` | hosted-checkout/Paystack redirect minted |
| W4 | `ticket-checkout-create` error paths (:785, :1197, :1337, :1675) | → `failed` + `failed_at` + `failure_reason` | PI/CS/Paystack create failure |
| W5 | `stripeWebhookRouter.handleTicketCheckoutPaymentIntent` | `payment_intent.succeeded` → `biz_ticket_checkout_finalize` → `paid_completed`; `payment_intent.payment_failed` / `.canceled` → `failed` (:1327-1338, order_id-null-guarded) | Stripe webhook |
| W6 | `ticket-checkout-confirm` / `reconcile-stuck-checkouts` | → `paid_completed` via same finalize RPC | client confirm race-winner / cron net — **succeeded PIs only** |
| W7 | `biz_ticket_checkout_create_session` LAZY tombstone (0829-B, survives in 1174:144-155) | terminal-or-past-expiry match on SAME idempotency key → `expired` + `failed_at` + key tombstoned | **only when the same buyer retries the same event with the IDENTICAL cart** |
| W8 | Paystack webhook router | reference-matched finalize → `paid_completed` | charge.success |

**What SHOULD happen to an abandoned never-confirmed PI (the system's own precedent):** ORCH-0829-B's migration doc + code define it — past-`expires_at` in-flight sessions are "dead artifacts" that transition to **`expired` with `failed_at` set**. But that transition exists ONLY as W7's lazy retry path. There is NO proactive writer: no sweep, no cron, no RPC performs `processing_payment(past-expiry)` → terminal. `checkout.session.expired` is not a subscribed webhook event, and an unconfirmed PI emits no webhook at all. Client-side, PaymentSheet cancel returns `{ outcome: "canceled" }` with zero server writes (`nativeCheckoutFlow.native.ts:380-381`). Abandonment is therefore the exact hole between all eight writers.

---

## 4. Q-scorecard

**Q1 — Who sets `processing_payment`?**
`ticket-checkout-create` native Stripe arm only (W2, index.ts:1692), immediately after `stripe.paymentIntents.create` succeeds and before returning the client_secret. Semantically it means "PI minted, sheet handed to client", NOT "buyer submitted payment". **Verdict: answered, proven (code + data: all 5 stuck rows are native-arm with `stripe_checkout_session_id` NULL).**

**Q2 — What are the intended terminal states and who writes them?**
Terminal set `paid_completed/free_completed/failed/expired`; complete writer map in §3. The honest abandoned-terminal (`expired` + `failed_at`) is already system precedent via ORCH-0829-B. **Verdict: answered, proven.**

**Q3 — WHY does `reconcile-stuck-checkouts` skip these rows?**
**PREDICATE GAP — proven with runtime evidence.** The fn (a) selects `status = 'processing_payment' AND stripe_payment_intent_id IS NOT NULL`, (b) retrieves each PI (WITH the `stripeAccount` header when `stripe_account_id` is set — index.ts:62-68), and (c) at index.ts:70-73 `if (pi.status !== "succeeded") { skip: "pi_status_<status>"; continue; }`. It can only ever finalize PAID sessions; it has no terminalize branch. This is by construction: ORCH-0849 built it as a one-shot backfill for pi-SUCCEEDED-but-webhook-missed sessions; ORCH-1187 promoted it to a */15 cron WITHOUT widening the predicate. Runtime proof: pg_net responses show every run = HTTP 200, `{reconciled:0, skipped:5, errors:0}` with all 5 sessions listed as `skip: "pi_status_requires_payment_method"`. The three competing hypotheses are **RULED OUT by the same artifact**: (i) never-scheduled/never-runs — cron.job jobid 28 active `*/15 * * * *`, job_run_details succeeded every 15 min; (ii) runs-but-errors — `errors: 0`, HTTP 200, edge log 200 @ ~3s; (iii) connected-account visibility (platform-vs-Stripe-Account header) — the header IS passed, `stripe_account_id` is populated on all 5 rows, and every retrieve succeeded (a header bug would surface as `error: resource_missing`, not a clean `pi_status_*` skip). **Verdict: predicate gap, PROVEN.**

**Q4 — Enumerate ALL currently-stuck sessions with Stripe truth.**
Exactly 5 (full table in evidence pack §4-5): `4fb46905` $65 Jun-27, `37572cf8` $20 Jun-27, `96949032` $10 Jun-27, `c9bac9dd` $10 Jul-1, `9bfcaaf8` $20 Jul-2 — all USD, all native-arm, all on connected acct `acct_1Tml2YI4pBxuXrhh` (Smoke & Rhythm), all past their 15-minute `expires_at` by weeks. Stripe (fresh read-only GETs, all five): `requires_payment_method`, `latest_charge` null, `last_payment_error` null, `canceled_at` null. **ZERO charges ever; nobody owed anything.** The three Jun-27 sessions were previously un-probed; they match the known two exactly. **Verdict: answered, proven.**

**Q5 — Why didn't the lazy 0829-B tombstone save them?**
Because it requires an IDENTICAL deterministic idempotency key (same buyer+event+cart). The data shows it firing correctly twice (rows 1a69d793 → `expired`, f9281048 tombstoned) where carts matched, and never firing for the stuck five (same buyer, different cart totals $65/$20/$10 → different keys). A lazy retry-keyed path is structurally incapable of being the safety net. **Verdict: answered, proven from data timeline.**

**Q6 — Blast: what reads session status; would terminalizing break any reader?**
See §6. Short: no reader breaks; `expired` is already in every client union and the confirm edge already tells these buyers "failed". **Verdict: answered, proven (all readers enumerated by grep + read).**

**Q7 — Do the stuck rows hold inventory or money?**
No. Capacity reservation (`create_session` RPC, 1174:262-263) counts in-flight sessions only where `expires_at > now()` — all 5 are weeks past. No money moved (Q4). The damage is honesty/monitoring + the broken safety net for the future genuinely-paid-then-stuck case (which the reconciler DOES handle — that branch works and stays). **Verdict: answered, proven.**

---

## 5. Findings (six-field evidence)

### F-1 — CONFIRMED ROOT CAUSE: reconciler predicate is finalize-only; skips every non-succeeded PI forever
1. **Symptom:** 5 sessions `processing_payment` for 2-3 weeks; reconciler logs show them skipped every 15 min.
2. **Layer:** code + runtime.
3. **Probe:** read `reconcile-stuck-checkouts/index.ts`; `SELECT … FROM net._http_response WHERE content::text LIKE '%reconciled%'` on prod.
4. **Evidence:** index.ts:70-73 `if (pi.status !== "succeeded") { results.push({ sessionId, piId, skip: \`pi_status_${pi.status}\` }); continue; }` — no other branch mutates the session. Runtime: 4 consecutive retained runs (02:15-03:00 UTC 2026-07-18) all HTTP 200 `{"reconciled":0,"skipped":5,"errors":0}`, all 5 rows `skip:"pi_status_requires_payment_method"` (evidence pack §3).
5. **Mechanism:** fn was designed (ORCH-0849 header comment, lines 1-18) as a one-shot backfill for PIs that DID succeed but missed the webhook; ORCH-1187 promoted it to the permanent */15 safety net without adding a terminalize branch → abandoned sessions are re-listed, re-fetched from Stripe, and re-skipped forever.
6. **Severity:** CONFIRMED ROOT CAUSE.

### F-2 — SECONDARY ROOT CAUSE: no proactive expiry writer exists anywhere in the system
1. **Symptom:** past-expiry in-flight rows can ONLY terminalize if the same buyer retries the identical cart.
2. **Layer:** schema + code + data.
3. **Probe:** grep all migrations/functions for expire/fail RPCs; read latest `create_session` (1174:144-155); DB timeline of the 9 rows.
4. **Evidence:** grep for `biz_ticket_checkout_fail|biz_ticket_checkout_expire|ticket_checkout_mark` → zero hits. `checkout.session.expired` absent from the webhook subscribe list (`stripeWebhookRouter.ts:76-92`). Data: rows 1a69d793/f9281048 tombstoned by identical-cart retries; rows 4fb46905/37572cf8/96949032 (same buyer, different carts) never matched.
5. **Mechanism:** the only `→ expired` writer is the lazy idempotency-key path (W7), which is keyed on exact cart identity — structurally not a sweep; every other abandonment strands.
6. **Severity:** SECONDARY ROOT CAUSE.

### F-3 — SUSPECTED CONTRIBUTOR: `processing_payment` is set at PI-mint, not at payment submission
1. **Symptom:** the state name lies — rows say "processing" when no payment was ever attempted.
2. **Layer:** code.
3. **Probe:** read `ticket-checkout-create/index.ts:1688-1698` + `nativeCheckoutFlow.native.ts:380-381`.
4. **Evidence:** status flips to `processing_payment` in the same request that returns the client_secret; sheet cancel returns `{outcome:"canceled"}` with no server write.
5. **Mechanism:** DB cannot distinguish "buyer typing card number" from "buyer closed the app 3 weeks ago"; only `expires_at` + Stripe PI status carry that truth. Not itself the bug (the design is defensible — the PI exists), but it is why abandonment lands specifically in this state.
6. **Severity:** SUSPECTED CONTRIBUTOR (naming/semantics; any fix keyed on `expires_at` + Stripe truth works without changing this).

### F-4 — RULED OUT: cron not scheduled / not running / erroring
Probe + evidence: cron.job jobid 28 `orch_1187_reconcile_stuck_checkouts` active `*/15 * * * *`; job_run_details `succeeded` every 15 min; pg_net HTTP 200; edge log 200 @ 3020 ms, fn version 234. **RULED OUT.**

### F-5 — RULED OUT: connected-account visibility (Stripe-Account header) bug in the reconciler
Probe + evidence: index.ts:62-68 passes `{ stripeAccount: stripeAccountId }` when set; DB shows `stripe_account_id = acct_1Tml2YI4pBxuXrhh` on ALL 5 rows; runtime `errors: 0` with clean `pi_status_*` skips (a visibility failure would be a caught error, not a status skip); my own header-bearing GETs returned all 5 PIs. (The orchestrator's plain-retrieve 404 was platform-scoped retrieval WITHOUT the header — the reconciler never does that when the column is set.) **RULED OUT.** Residual note: a session with `stripe_account_id` NULL would take the plain-retrieve branch (:68) and error every run — impossible for paid arms today (create_session RPC raises `stripe_account_not_ready` before minting a paid session without an account), so theoretical only.

### F-6 — SUSPECTED CONTRIBUTOR: docs-vs-code contradiction in the ORCH-1187 cron migration
Evidence: migration comment (20261116000000, lines 5-8) — "ANY future stuck session auto-recovers within minutes". The fn only recovers PAID stuck sessions. The safety net was believed wider than it is; ORCH-1388 is that belief failing in production. **SUSPECTED CONTRIBUTOR (documentation debt; misled monitoring expectations).**

### F-7 — SUSPECTED CONTRIBUTOR: unbounded forever-work — every abandoned session adds ~96 Stripe GETs/day permanently
Evidence: the fn's select has no time floor and skips don't terminalize, so the skip list only grows; currently 5 PIs × 96 runs/day = ~480 read-only Stripe calls/day, forever, growing with every future abandonment. Harmless today; structural waste + noise. **SUSPECTED CONTRIBUTOR.**

---

## 6. Blast radius & cross-surface map (scope item d)

**Readers of session status — all enumerated, none breaks on terminalization:**

| Reader | What it does with the stuck rows | Effect of `processing_payment` → `expired` (+`failed_at`) |
|---|---|---|
| `ticket-checkout-status` edge (:44) | returns RAW DB status to the buyerStatusToken holder; clients only check `order?.orderId` presence (both native flows poll-and-timeout) | none — clients don't branch on the string; honest value replaces a lie |
| `ticket-checkout-confirm` edge | maps PI `requires_payment_method` → `"failed"` ALREADY (else-branch :509); its 0829-B web branch already returns `"expired"` | none — client union `"paid"|"pending"|"failed"|"expired"` (`ticketCheckoutService.ts:115`) already contains it |
| `biz_ticket_checkout_create_session` capacity reserve (1174:262-263) | ignores rows with `expires_at <= now()` — stuck rows hold NO inventory | none |
| idempotency short-circuit (1174:144-155) | past-expiry rows are already tombstone candidates on key-match | none — terminal set already includes `expired` |
| seller Orders (`eventOrdersService.ts:82`) | reads finalized `orders` only — "pre-finalization failures live in ticket_checkout_sessions" by design | none |
| `useOrderRealtimeSubscription` (ORCH-0852 realtime publication) | subscribes to UPDATEs on the row during an ACTIVE checkout | a sweep UPDATE emits realtime events; only buyers mid-checkout are subscribed, and a sweep honoring `expires_at` never touches in-window rows |
| admin console (`mingla-admin`) | zero references to the table (grep) | none |
| reconciler itself | `.eq("status","processing_payment")` | terminalized rows leave its work list — F-7 growth stops |
| metrics/monitoring | 5/9 all-time sessions read as "processing" — poisons any conversion/funnel read | fixed by honesty |

**Enum/migration answer:** the status CHECK already contains `expired` and `failed`; terminalizing to `expired` (the ORCH-0829-B precedent, with `failed_at` stamped) requires **NO schema migration and no client change**. A NEW value (e.g. `abandoned`) would require a CHECK-constraint migration + widening the client `FinalizeStatus` union + auditing every switch — strictly more surface for the same honesty.

**In-scope surfaces:** backend only (edge fn + optionally the cron/RPC layer). **Out-of-scope:** consumer iOS/Android, business iOS/Android, buyer web, admin web, business web preview — no client code branches on `processing_payment`, no copy changes needed (declared per the 5+2 surface list; parity N/A — single shared backend path).

**Adjacent same-class strand (flagged, NOT in scope):** `awaiting_web_redirect` (web hosted-Checkout + Paystack arms) and `requires_payment`/`pending_free` can strand identically past-expiry — abandoned hosted checkout emits `checkout.session.expired` which is unsubscribed; abandoned Paystack redirect emits nothing. Currently ZERO such rows (all-time data), but the reconciler's predicate only queries `processing_payment`, so the class exists. SPEC should decide whether the sweep covers all past-expiry in-flight statuses or only `processing_payment` (see OQ-3).

---

## 7. Five-Truth-Layer reconciliation

| Layer | Truth | Contradiction |
|---|---|---|
| **Docs** | ORCH-1187 migration: "ANY future stuck session auto-recovers within minutes". ORCH-0829-B: abandoned past-expiry in-flight sessions are dead artifacts → `expired`+`failed_at`. | **Docs vs Code #1:** 1187's "ANY" is false — only PI-succeeded sessions recover (F-6). |
| **Schema** | CHECK admits `expired`/`failed` terminals; RLS: service-role manages, brand team reads; realtime publication on the table; NO expire RPC/sweep exists. | **Docs vs Schema:** 0829-B names the honest terminal but schema provides no proactive writer for it (F-2). |
| **Code** | W1-W8 writer map (§3); reconciler finalize-only predicate (F-1); client cancel writes nothing. | **Code vs Data:** state named `processing_payment` describes rows where no payment was ever processed (F-3). |
| **Runtime** | Cron fires */15, fn 200s in ~3s, `reconciled:0 skipped:5 errors:0` every run; Stripe retrieves succeed with the account header. | **Runtime vs Docs:** the "safety net" demonstrably loops on the same 5 rows for weeks (F-1/F-6). |
| **Data** | 5/9 rows stuck; all past 15-min expiry; `failure_reason`/`failed_at`/`order_id` NULL; Stripe: `requires_payment_method`, zero charges, all five. Lazy tombstone fired exactly where cart-identity matched, nowhere else. | consistent with all of the above. |

## 8. Repro evidence

Live-fire simulator exemption applies (pure backend/cron/edge/SQL investigation — Prime Directive 7 exemption list). The "repro" is the production runtime itself, captured read-only: the failing loop was observed live across 4 consecutive cron cycles (evidence pack §2-3), and the abandonment mechanism was traced in code to the client sheet-cancel path. No writes of any kind were made: Supabase SQL was SELECT-only, Stripe calls were GETs, no PI was confirmed/canceled, no session mutated, no deploys.

## 9. Invariant impact (flagged, not resolved)

- **I-CHECKOUT-IDEMPOTENT** — genuine in-window retries must keep short-circuiting. Any sweep MUST honor `expires_at > now()` as untouchable (the 0829-B predicate already encodes this line). Flagged as the fix's hard boundary; resolution belongs to SPEC.
- **I-PROPOSED-CHECKOUT-EXPIRY-TOMBSTONE** (ORCH-0829-B, with CI gate `orch-0829b-d1-checkout-expiry-tombstone`) — the direction any fix must stay consistent with: `expired` + `failed_at` for past-expiry in-flight sessions. A sweep is the proactive completion of this invariant, not a conflict — but the CI gate's grep expectations must be checked at SPEC time.
- **Stripe read-idempotency (COMMS-0039 lineage / strict-grep `stripe-no-idempotency-key`)** — the reconciler's read-only retrieves carry the established `orch-strict-grep-allow` annotations; any new Stripe call added by the fix must satisfy the same gate. If the SPEC chooses to CANCEL abandoned PIs on Stripe (a mutation), that requires an idempotency key + explicit REVIEW sign-off — flagged, not decided.
- **I-COMMS-LEDGER / prod-write guards** — untouched; this phase wrote nothing to prod.

## 10. Discoveries for Orchestrator (side issues — register, do not fold into 1388)

- **D-A:** capacity-reservation predicate (`create_session` 1174:262-263) counts `pending_free/requires_payment/processing_payment` but **omits `awaiting_web_redirect`** — two web buyers can pass the capacity check for the same last ticket while one holds an open hosted-Checkout session. Zero live impact today (no capped sellouts yet); real oversell vector at scale.
- **D-B:** two OTHER cron-driven fns return 401 every cycle in the last-24h edge logs: `keep-warm` (`UNAUTHORIZED_NO_AUTH_HEADER`, from the ORCH-1187-era `keep-functions-warm` job posting without a bearer) and `process-booking-deadlines`. Their crons report "succeeded" (pg_net enqueue) while the fns reject — same monitoring-honesty class as 1388.
- **D-C:** `reconcile-stuck-checkouts` has no `[functions.reconcile-stuck-checkouts]` entry in `supabase/config.toml` (runs on default `verify_jwt`; works because the cron sends the service-role JWT) — a config-explicitness gap, not a live bug.
- **D-D:** the ORCH-1187 migration comment overpromise (F-6) should be corrected whenever the reconciler is next touched, so future readers don't re-inherit the false belief.

## 11. Open questions for Seth (genuine product forks only)

- **OQ-1 — abandonment line:** sessions already carry a 15-minute `expires_at`, and ORCH-0829-B already treats past-expiry as dead. Is `expires_at` (15 min) the abandonment cutoff for the sweep, or do you want a longer grace (e.g. expires_at + 1h) before terminalizing? (Recommendation direction only: the 0829-B precedent says expires_at; Stripe truth is re-checked at sweep time either way so a buyer mid-payment can never be falsely expired.)
- **OQ-2 — terminal value:** reuse **`expired`** (zero migration, zero client change, matches 0829-B precedent, `failed_at` stamped) vs mint a new **`abandoned`** status (cleaner analytics label; costs a CHECK migration + client-union widening + reader audit). 
- **OQ-3 — sweep breadth:** `processing_payment` only (the observed bug), or all past-expiry in-flight statuses (`+ awaiting_web_redirect, requires_payment, pending_free` — same strand class, currently zero rows)?
- **OQ-4 — Stripe-side hygiene:** should abandoned PIs also be CANCELED on Stripe (a write; stops them lingering as `requires_payment_method` in the dashboard), or left untouched (DB-only honesty)? Canceling is safe for `requires_payment_method` PIs but is a mutation and needs explicit authorization.

## 12. Confidence & recommended next phase

**Confidence: PROVEN.** Root cause (F-1) and the missing-writer structure (F-2) are established with verbatim code, live cron/pg_net/edge-log runtime capture, full DB enumeration, and fresh Stripe truth for all five PIs; all alternative mechanisms ruled out with evidence.

**Recommended next phase:** REVIEW → SPEC (this skill, SPEC mode) once OQ-1..OQ-4 are decided. **Recommended scope (direction only, NOT a fix):** the reconciler's non-succeeded branch + the honest terminal transition keyed on Stripe truth + `expires_at`, bounded by I-CHECKOUT-IDEMPOTENT's in-window protection; backend-only, no client surface. Out-of-recommended-scope: D-A capacity predicate, D-B cron-auth 401s, D-C config entry (register separately).
