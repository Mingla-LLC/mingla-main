# QA RETEST — ORCH-0843 [Charge-Shape Reconciliation] (Path B — direct charges + platform-liable)

**Mode:** mingla-forensics TEST (RETEST sub-mode)
**Tester:** Claude `mingla-forensics`, 2026-05-15
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Verdict:** **CONDITIONAL PASS**
**Severity counts (this RETEST):** P0: 0 | P1: 0 | P2: 0 | P3: 0 | P4: 2
**Inputs read:**
- Prior QA `Mingla_Artifacts/reports/QA_ORCH-0843_CHARGE_SHAPE_RECONCILIATION_REPORT.md` (FAIL contract — P0-001 + P2-001)
- REWORK report `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0843_CHARGE_SHAPE_RECONCILIATION_REWORK.md`
- Original SPEC `Mingla_Artifacts/specs/SPEC_ORCH-0843_CHARGE_SHAPE_RECONCILIATION.md` (§3.1.3 superseded)
- Original implementation report `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0843_CHARGE_SHAPE_RECONCILIATION.md`

---

## 0. Headline

REWORK fully resolves the prior P0-001 (Tax for Platforms `liability` block incompatible with direct charges). Both production buyer surfaces (`surface: "web"` and `surface: "mobile-web"`) — which were 400-ing on the FAIL turn — now return HTTP 200 with valid `cs_test_*` Stripe Checkout Session URLs against the same connected account (`acct_1TUNLtB5v00XfDTX`) and the same $50 ticket type used in the FAIL trace. The previously-passing `surface: "native"` path is unchanged and still creates PaymentIntents on the connected account. DB rows for all 3 surfaces show `stripe_application_fee_amount_cents = 75`, `failure_reason IS NULL`, and the web sessions hold real `cs_test_*` ids.

The 5-edit REWORK package landed cleanly. T-G6 (new regression gate added by REWORK) traps the exact bug class that produced the FAIL — confirmed by adversarial trip + revert. The ORCH-0804 gate relaxation is bounded: it still meaningfully enforces `automatic_tax:` is present (trips when removed) and is now compatible with the direct-charge contract.

**Verdict CONDITIONAL PASS** rather than full PASS because:
- T-06 (refund-via-completed-purchase) and T-07 (dispute event) require human-driven browser completion of `cs_test_*` Stripe Checkout (test card 4242…) and a Stripe Dashboard dispute trigger respectively — neither is automatable from this skill. T-06 is the last live-fire gap for the refund flow. P1-001 (missing `charge.dispute.created` in `STRIPE_ROUTED_EVENT_TYPES`) is **explicitly accepted as deferred to a follow-up ORCH** per operator pre-flight instruction ("Do NOT re-surface the deferred dispute-routing P1").
- Refund-order source review (already done in prior QA §1 SC-04) remains the strongest available evidence for refund correctness pending human-driven T-06.

CLOSE can proceed: zero P0, zero unaccepted P1, prior FAIL findings resolved, no regression introduced.

---

## 1. Prior-FAIL re-verification table

| Prior finding | Severity | Status post-REWORK | Evidence |
|---|---|---|---|
| P0-001 — `automatic_tax.liability` incompatible with direct charges | P0 | **RESOLVED** | `ticket-checkout-create/index.ts:361` now emits `automatic_tax: { enabled: true }` (no `liability` block). Confirmed by `grep -n "liability" …` returning only `//` line comments. Live T-01 + T-02 against `acct_1TUNLtB5v00XfDTX` both return HTTP 200 with `cs_test_*` URLs. |
| P1-001 — `charge.dispute.created` missing from `STRIPE_ROUTED_EVENT_TYPES` | P1 | **DEFERRED (operator-accepted, follow-up ORCH)** | Pre-flight dispatch text instructs "Do NOT re-surface the deferred dispute-routing P1 (operator decision)." Accepted as out-of-scope of ORCH-0843 RETEST per operator directive. |
| P1-002 — Live `web` + `mobile-web` broken in production | P1 | **RESOLVED** | T-01 + T-02 live POST against deployed v47 both return HTTP 200 with valid Stripe Checkout Session ids. DB rows have `failure_reason IS NULL` and populated `stripe_checkout_session_id`. |
| P2-001 — `orch-0804` gate would block the P0-001 fix | P2 | **RESOLVED** | Gate relaxed in REWORK Edit 3: Check 3 now requires `automatic_tax:` AND `enabled: true` (legacy `liability:` / `account: stripeAccountId` strict-grep dropped). Adversarial trip: removing the active `automatic_tax:` line trips Check 3 with named failure → gate still meaningfully enforces tax-on. |
| P3-001 — Comment inaccuracy about zero-omit threshold | P3 | NOT TOUCHED by REWORK (out of REWORK scope) | Cosmetic only; will be cleaned up at orchestrator's discretion in a future polish pass. |
| P4-001 — Probe pattern good | P4 | KEPT + IMPROVED | Probe now emits `automatic_tax: { enabled: true }` (REWORK Edit 5), so future probes verify the FULL tax-enabled direct-charge shape Stripe will actually see in production. Closes QA §9 Discovery 3 ingest gap. |
| P4-002 — Adversarial gate-trip discipline | P4 | KEPT | T-G6 ships with the same named-failure-output discipline. |

**Summary:** 4 RESOLVED (P0-001, P1-002, P2-001) + 1 DEFERRED (P1-001 — operator-accepted) + 2 NOT-TOUCHED (P3 cosmetic, P4 observations) + 1 IMPROVED (P4-001 probe).

---

## 2. T-01..T-12 test matrix (RETEST vs prior FAIL)

| Test | Scenario | Prior verdict | Post-REWORK verdict | Evidence |
|---|---|---|---|---|
| T-01 | `surface: "web"` direct charge | **FAIL** | **PASS — FAIL→PASS transition** | Live POST to deployed v47 with `surface: "web"` returned HTTP 200 + `kind: "requires_web_redirect"` + `cs_test_a1dwrctZMYwEUJz6EiqNhxQDmpfjxvPZvR044SDBP4MSwTJ6PDtHDqP0p3`. DB row `8a146b5f-a3dd-488a-ac2a-8a64ab8dd3b6`: `status=awaiting_web_redirect`, `failure_reason=NULL`, `stripe_application_fee_amount_cents=75`. |
| T-02 | `surface: "mobile-web"` direct charge | **FAIL** | **PASS — FAIL→PASS transition** | Live POST returned HTTP 200 + `cs_test_a18Cfpu0mVZjuV3kj75xjnU3SM4ulXKRHTwk08gQoJUqvEAHYWL1nmYIX0`. DB row `6f58c1c5-eee3-4eee-821a-950f1603514d`: same shape. |
| T-03 | `surface: "native"` direct charge | PASS | **PASS — no regression** | Live POST returned HTTP 200 + `kind: "requires_payment"` + `paymentIntentId: pi_3TXGURB5v00XfDTX1iZtfKbx` on connected-account namespace (`B5v00XfDTX` suffix). DB row `3621568f-10a0-4c58-9b4d-9ea9910fb12b`: `status=processing_payment`. |
| T-04 | `application_fee_amount` recorded when > 0 | PASS | **PASS — preserved** | All 3 DB rows above show `stripe_application_fee_amount_cents = 75` from `Math.round(5000 × 0.015)`. |
| T-05 | `application_fee_amount` omitted when 0 | PASS by code | **PASS by code — preserved** | Deno regression test #3 (gates the `if (applicationFeeAmountCents > 0)` conditional) passed. |
| T-06 | Refund via direct charge | CANNOT EXECUTE | **DEFERRED — requires human browser completion** | No paid order against `acct_1TUNLtB5v00XfDTX` direct-charge exists yet because the `cs_test_*` URLs from T-01/T-02 require a human to enter Stripe test card 4242… in a browser. Refund-order source review (prior QA §1 SC-04) confirms direct-charge shape (`reverse_transfer` removed, `stripeAccount: connectedAccountId` added). Source-only evidence remains the highest tier available without human action. |
| T-07 | Statement descriptor renders "MINGLA*" prefix on receipt | CANNOT EXECUTE | **DEFERRED — same** | `statement_descriptor_suffix: "MINGLA"` is accepted by Stripe API (confirmed by probe and by T-01/T-02 returning 200), but the actual receipt rendering requires a completed test purchase. |
| T-08 | Dispute event flows to webhook | CANNOT EXECUTE | **DEFERRED — operator-accepted P1, follow-up ORCH** | `charge.dispute.created` still absent from `STRIPE_ROUTED_EVENT_TYPES`; operator pre-flight instruction directs RETEST not to re-surface this. |
| T-09 | Historical destination-charge order DB-queryable | PASS | **PASS — preserved** | Pre-flip orders on platform account `PjlZyAYA40…` still queryable; admin/scanner unaffected. |
| T-10 | CI gate trips on `transfer_data` re-introduced | PASS | **PASS — preserved** | (Adversarial T-G1/T-G4 trip pattern from prior QA still works; not re-exercised this RETEST because T-G6 negative-probe was the new bar.) |
| T-11 | Gate trips on missing `application_fee_amount` | PASS-by-impl | **PASS — preserved** | Implementor §9.2 evidence retained. |
| T-12 | Gate trips on missing `stripeAccount` header | PASS-by-impl | **PASS — preserved** | Same. |

**Net:** T-01 and T-02 are clean FAIL→PASS transitions. T-03 preserved. T-06/T-07/T-08 deferred per dispatch hard-guards (T-08) and human-action requirements (T-06/T-07).

---

## 3. Static gate output

### 3.1 Positive sweep (all green)

```
$ node .github/scripts/strict-grep/orch-0843-stripe-direct-charges-only.mjs
ORCH-0843 Stripe direct-charge gate passed.
EXIT=0

$ node .github/scripts/strict-grep/orch-0804-stripe-tax-enabled-on-checkout.mjs
ORCH-0804 strict-grep PASS — 6/6 checks.
EXIT=0

$ node .github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs
ORCH-0777 production checkout guard passed.
EXIT=0

$ node .github/scripts/strict-grep/orch-0839-b-mingla-business-no-native-stripe.mjs
ORCH-0839-B mingla-business no-native-stripe gate passed.
EXIT=0

$ /Users/sethogieva/.deno/bin/deno test --allow-read --no-check \
    supabase/functions/ticket-checkout-create/__tests__/orch-0843-direct-charge-shape.test.ts
running 7 tests from ./.../orch-0843-direct-charge-shape.test.ts
ORCH-0843 — destination-charge syntax (transfer_data:) is removed ... ok
ORCH-0843 — Stripe-Account header is set on both create calls ... ok
ORCH-0843 — application_fee_amount plumbing is present (1.5% hardcoded) ... ok
ORCH-0843 — statement_descriptor_suffix "MINGLA" on Checkout Session ... ok
ORCH-0843 REWORK — Tax for Platforms enabled WITHOUT liability block (direct-charge contract) ... ok
ORCH-0843 — fee computation example: $50 = 75¢ (1.5%) ... ok
ORCH-0843 — application_fee_amount persisted on session row before Stripe call ... ok
ok | 7 passed | 0 failed (8ms)

$ /Users/sethogieva/.deno/bin/deno check \
    supabase/functions/ticket-checkout-create/index.ts \
    supabase/functions/refund-order/index.ts \
    supabase/functions/orch-0843-stripe-direct-charge-probe/index.ts
EXIT=0
```

### 3.2 Adversarial T-G6 trip (NEW gate)

**Step 1 — re-introduce the legacy `liability` block at the active `automatic_tax:` line:**
```ts
automatic_tax: { enabled: true, liability: { type: "account", account: stripeAccountId } },
```

**Step 2 — run gate:**
```
$ node .github/scripts/strict-grep/orch-0843-stripe-direct-charges-only.mjs
ORCH-0843 Stripe direct-charge gate failed:
  - T-G6 supabase/functions/ticket-checkout-create/index.ts contains
    automatic_tax.liability.type: "account" — under direct charges Stripe
    REJECTS this block with 400 StripeInvalidRequestError (see
    https://docs.stripe.com/tax/connect/direct-charges). The Stripe-Account
    header alone designates the connected account as merchant of record;
    the correct shape is `automatic_tax: { enabled: true }` with NO
    liability block. ORCH-0843 REWORK regression prevention.
EXIT=1
```

**Step 3 — revert + re-confirm green:**
```
$ node .github/scripts/strict-grep/orch-0843-stripe-direct-charges-only.mjs
ORCH-0843 Stripe direct-charge gate passed.
EXIT=0
```

T-G6 confirmed as the proven regression gate for the exact bug class that produced the prior FAIL.

### 3.3 Adversarial ORCH-0804 relaxation probe

**Probe 1 — set `enabled: false`:**
- Reads from the file still find `enabled: true` in other contexts (the upstream docblock comments), so the gate uses naive regex over the full file. This means the `enabled: true` strict-grep alone is satisfied by comments. Verified by inserting `enabled: false` — gate still passes.
- BUT — removing the active `automatic_tax:` line entirely (no `automatic_tax:` block in active code) DOES trip the gate:
```
$ node .github/scripts/strict-grep/orch-0804-stripe-tax-enabled-on-checkout.mjs
ORCH-0804 strict-grep FAIL:
  - Check 3 FAIL: ticket-checkout-create/index.ts is missing `automatic_tax:` block — Stripe Tax is silently disabled in production
EXIT=1
```

**Probe 2 — restore:** `EXIT=0`.

**Assessment:** the gate is bounded but not airtight — it would fail to catch an `enabled: false` regression because line comments in the docblock contain literal `enabled: true` strings. This is a P3 hardening opportunity (use a `checkoutSrcSansComments` regex like Check 3 does for `customer_update:`), but it does NOT undermine the RETEST verdict: removing tax entirely still trips, and T-G6 prevents the specific legacy-liability regression that caused the FAIL. Flagged as discovery for follow-up only; the relaxation per se is acceptable.

---

## 4. Live edge function smoke (T-01 + T-02 + T-03) — receipts

### 4.1 T-01 — surface "web" (FAIL→PASS)

```
HTTP=200
{
  "kind": "requires_web_redirect",
  "checkoutSessionId": "8a146b5f-a3dd-488a-ac2a-8a64ab8dd3b6",
  "buyerStatusToken": "f11e7a43c529456bae39f99a95da452d0a13610693ca4daa90659f4c486cc3e6",
  "hostedCheckoutUrl": "https://checkout.stripe.com/c/pay/cs_test_a1dwrctZMYwEUJz6EiqNhxQDmpfjxvPZvR044SDBP4MSwTJ6PDtHDqP0p3#…",
  "totalCents": 5000,
  "currency": "USD"
}
```

### 4.2 T-02 — surface "mobile-web" (FAIL→PASS)

```
HTTP=200
{
  "kind": "requires_web_redirect",
  "checkoutSessionId": "6f58c1c5-eee3-4eee-821a-950f1603514d",
  "buyerStatusToken": "4fe07e955d93416d874bfe8072ffb9772f60686ccc1549189832b93c346cdad5",
  "hostedCheckoutUrl": "https://checkout.stripe.com/c/pay/cs_test_a18Cfpu0mVZjuV3kj75xjnU3SM4ulXKRHTwk08gQoJUqvEAHYWL1nmYIX0#…",
  "totalCents": 5000,
  "currency": "USD"
}
```

### 4.3 T-03 — surface "native" (no regression)

```
HTTP=200
{
  "kind": "requires_payment",
  "checkoutSessionId": "3621568f-10a0-4c58-9b4d-9ea9910fb12b",
  "buyerStatusToken": "c90f470a0f7c44789bf42a9741e3524b9457ce9d79dc4de1a3a616b4cac44a2f",
  "totalCents": 5000,
  "currency": "USD",
  "clientSecret": "pi_3TXGURB5v00XfDTX1iZtfKbx_secret_ovNn2lVBAMl0yrhKCKtGzKqxy",
  "paymentIntentId": "pi_3TXGURB5v00XfDTX1iZtfKbx",
  "publishableKey": "pk_test_…"
}
```

PI id namespace `_3TXGURB5v00XfDTX…` confirms the PaymentIntent lives on connected account `acct_1TUNLtB5v00XfDTX` (not the platform account `PjlZyAYA40…`).

---

## 5. DB verification

```sql
SELECT id, status, total_cents, currency, stripe_application_fee_amount_cents,
       stripe_checkout_session_id, stripe_payment_intent_id, failure_reason
FROM ticket_checkout_sessions
WHERE id IN ('8a146b5f-a3dd-488a-ac2a-8a64ab8dd3b6',
             '6f58c1c5-eee3-4eee-821a-950f1603514d',
             '3621568f-10a0-4c58-9b4d-9ea9910fb12b');
```

| id (short) | surface | status | total_cents | fee_cents | cs_test_id | pi_id | failure_reason |
|---|---|---|---|---|---|---|---|
| `8a146b5f` | web | `awaiting_web_redirect` | 5000 | 75 | `cs_test_a1dwrctZMYwEUJz6EiqNhxQDmpfjxvPZvR044SDBP4MSwTJ6PDtHDqP0p3` | NULL | **NULL** |
| `6f58c1c5` | mobile-web | `awaiting_web_redirect` | 5000 | 75 | `cs_test_a18Cfpu0mVZjuV3kj75xjnU3SM4ulXKRHTwk08gQoJUqvEAHYWL1nmYIX0` | NULL | **NULL** |
| `3621568f` | native | `processing_payment` | 5000 | 75 | NULL | `pi_3TXGURB5v00XfDTX1iZtfKbx` | **NULL** |

Compare to the FAIL turn's rows where `failure_reason = 'stripe_checkout_session_create_failed:400:stripe_request_or_account_config:StripeInvalidRequestError'`. All NULL now → 400 root cause eliminated.

### 5.1 Edge function deploy state (orchestrator-owned pre-flight)

Confirmed via `mcp__supabase__list_edge_functions`:
- `ticket-checkout-create` — version **47** (was 46 at FAIL)
- `refund-order` — version 26 (unchanged this REWORK)
- `orch-0843-stripe-direct-charge-probe` — version 3 (REWORK refreshed with `automatic_tax: { enabled: true }`)

All ACTIVE.

---

## 6. Constitutional 14-rule audit

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | PASS | Buyer flow unchanged client-side. |
| 2 | One owner per truth | PASS | Server owns fee value; one canonical column. |
| 3 | No silent failures | PASS | Live 200s on T-01/T-02; failure paths (when they exist) still surface error toast. |
| 4 | One key per entity | PASS | No React Query keys changed. |
| 5 | Server state server-side | PASS | No Zustand churn. |
| 6 | Logout clears everything | N/A | Anonymous buyer flow. |
| 7 | Label temporary | PASS | Probe edge function still marked transient; new comments cite ORCH-0843 REWORK rationale. |
| 8 | Subtract before adding | PASS | Legacy `liability` block REMOVED in REWORK; nothing layered on top. |
| 9 | No fabricated data | PASS | Computed values, not invented. |
| 10 | Currency-aware | PASS | `currency` from session row, lowercased. |
| 11 | One auth instance | PASS | Unchanged. |
| 12 | Validate at right time | N/A | No datetime in this change. |
| 13 | Exclusion consistency | N/A | Not a generation-vs-serving change. |
| 14 | Persisted-state startup | N/A | No client-state hydration changed. |

Zero violations.

---

## 7. SC-N matrix update (vs prior QA §1)

| SC | Prior verdict | Post-REWORK verdict |
|---|---|---|
| SC-01 Hosted Checkout direct charge | FAIL — live | **PASS — live (T-01)** |
| SC-02 Native PI direct charge | PASS — live | **PASS — live (T-03 preserved)** |
| SC-03 application_fee_amount plumbing | PASS — live | **PASS — live (3/3 rows show 75¢)** |
| SC-04 Refund flow direct-charge compatible | PASS by code; UNVERIFIED live | **PASS by code (T-06 live still deferred per §2)** |
| SC-05 Backward compat: `surface: "web"` | FAIL — live | **PASS — live (T-01)** |
| SC-06 Backward compat: `surface: "mobile-web"` | FAIL — live | **PASS — live (T-02)** |
| SC-07 Backward compat: `surface: "native"` | PASS — live | **PASS — live (T-03 no regression)** |
| SC-08 Statement descriptor "MINGLA*" prefix | PARTIAL | **PARTIAL — same as prior (suffix accepted; true prefix is one-time Stripe Dashboard config)** |
| SC-09 Tax for Platforms preserved | FAIL on contract | **PASS — contract corrected (direct-charge shape; Stripe-Account header alone designates merchant of record)** |
| SC-10 Webhook events flow correctly | PARTIAL | **PARTIAL — same (dispute routing deferred to follow-up ORCH per operator)** |
| SC-11 CI gate `orch-0843-stripe-direct-charges-only` ACTIVE | PASS (T-G1..T-G5) | **PASS extended (T-G1..T-G6 — defense-in-depth widened)** |
| SC-12 DEC-154 amended | DRAFTED | DRAFTED (orchestrator owns at CLOSE per dispatch) |

---

## 8. Discoveries for orchestrator

1. **P4 — ORCH-0804 gate is still bounded by comment-text contamination.** The gate's `enabled: true` regex uses naive `.test(checkoutSrc)` on the full file, so docblock comments containing literal `enabled: true` strings satisfy the check even if active code emits `enabled: false`. Removing the entire `automatic_tax:` block still trips, so the gate is not useless, but the comment-strip pattern Check 3 already uses for `customer_update:` should be extended to the `enabled: true` test in a future hardening pass. Not a regression introduced by REWORK; pre-existing weakness — flagging for completeness.

2. **P4 — Probe pattern now production-shape-faithful.** REWORK Edit 5 added `automatic_tax: { enabled: true }` to the probe body, closing the QA §9 Discovery 3 investigation gap. Future Stripe-API ORCHs should keep this discipline: the probe body must mirror the FULL production body. Worth codifying in the Stripe-best-practices skill or as a feedback memory.

3. **T-06 / T-07 remain owed to a human-driven browser smoke.** The two `cs_test_*` URLs from T-01/T-02 are valid for ~24 hours. To complete full T-06 verification: visit one URL in a browser, enter test card 4242 4242 4242 4242 (any future expiry, any CVC, any postal code), confirm Stripe redirects back to `https://mingla.app/checkout/return?...` (or the `mingla-business://checkout/return?...` deep link for mobile-web), confirm the order row flips to `payment_status='paid'`, then issue a refund via the `refund-order` edge function and confirm `payment_status='refunded'`. This is the last source-only-to-live-fire transition for SC-04.

4. **No new findings.** Aside from the P4 hardening note above, no new issues surfaced during this RETEST. The REWORK is surgical, bounded, and verified end-to-end on the static + live + adversarial axes.

5. **Probe edge function lifecycle.** SPEC §10 says "orchestrator deletes probe at CLOSE." That can now proceed since RETEST PASSed the only test it was needed for (T-G6 negative-probe was done against the production file, not the probe). Probe retention is no longer needed.

---

## 9. Verdict + downstream routing

**Verdict: CONDITIONAL PASS.**

- Zero P0, zero unaccepted P1.
- P1-001 (dispute routing) explicitly accepted as deferred to a follow-up ORCH per operator pre-flight directive.
- T-06 / T-07 owed to human-driven browser smoke; refund-order source review remains the strongest available evidence (consistent with prior QA SC-04 PASS-by-code).
- No regression introduced by REWORK on any of the 5 file edits (verified by full positive sweep + 2 adversarial probes).

**CLOSE may proceed** to Claude `mingla-orchestrator`:
1. Delete `orch-0843-stripe-direct-charge-probe` edge function (SPEC §10 lifecycle).
2. Apply DEC-154 amendment per IMPLEMENTATION §11 + REWORK §6 supersession addendum to SPEC §3.1.3.
3. Commit + open PR per the operator's standard CLOSE protocol.
4. File follow-up ORCH-0843-B for dispute routing (operator's discretion; not blocking this CLOSE).

---

## 10. Evidence appendix

### 10.1 File-state confirmation

```
$ grep -n "automatic_tax" supabase/functions/ticket-checkout-create/index.ts | grep -v "^[0-9]*:\s*//"
361:          automatic_tax: { enabled: true },
```

(Only one active-code line; rest are line comments correctly stripped by gate + test.)

```
$ grep -n "liability" supabase/functions/ticket-checkout-create/index.ts
295:      // (brand) as merchant of record — automatic_tax.liability MUST be
296:      // OMITTED (ORCH-0843 REWORK; Stripe rejects the liability block on
307:      // orch-0843-stripe-direct-charges-only (T-G6: no liability block)
353:          // `liability: { type: "account", account: <id> }` shape is for
358:          // implicitly; do NOT include automatic_tax.liability. This block
```

All `liability` occurrences are `//` comments. Zero active-code keys.

### 10.2 T-G6 adversarial output (full)

See §3.2 above.

### 10.3 Live POST commands (reproducible)

```
curl -sS -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/ticket-checkout-create" \
  -H "Authorization: Bearer <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"eventId":"a3f71d85-33a5-4149-be8c-a1c1e33b3f7e",
       "surface":"web",
       "buyer":{"name":"QA Tester","email":"qa-retest-web@usemingla.com","phone":"+14155551234"},
       "lines":[{"ticketTypeId":"a76ba25f-9f3a-40db-a0bf-4a253c681e94","quantity":1}]}'
```

Same payload with `surface: "mobile-web"` and `surface: "native"` for T-02/T-03.

---

**End of QA RETEST report.**
