# IMPLEMENTATION — ORCH-0843 [Charge-Shape Reconciliation] REWORK

**Mode:** mingla-implementor REWORK
**Implementor:** Claude `mingla-implementor`, 2026-05-15
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Scope:** the 5 mechanical edits prescribed by QA report §8 P0-001 (Tax for Platforms `automatic_tax.liability` is incompatible with direct charges; Stripe returns 400 `StripeInvalidRequestError` on `surface: "web"` + `surface: "mobile-web"`).

**Hard guards honored:** no scope widening, no dispute-routing P1 work, no `app-mobile/` / `packages/payments-native/` edits, no DB migration, no edge-function deploy, no DEC-154 amendment commit, no `_shared/stripeBlueprintClient.ts` change.

---

## 1. Files edited (5)

### 1.1 `supabase/functions/ticket-checkout-create/index.ts` (lines 345-351 prior → 345-358 post)

**OLD (active code):**
```ts
          payment_intent_data: piData,
          automatic_tax: {
            enabled: true,
            liability: {
              type: "account",
              account: stripeAccountId,
            },
          },
```

**NEW (active code):**
```ts
          payment_intent_data: piData,
          // ORCH-0843 REWORK — Under DIRECT charges (Stripe-Account header
          // set on the request-options below), Stripe Tax for Platforms uses
          // the Stripe-Account header alone to designate the connected
          // account as merchant of record. The legacy
          // `liability: { type: "account", account: <id> }` shape is for
          // destination/separate-transfer charges only and is REJECTED with
          // 400 StripeInvalidRequestError on direct-charge calls. See
          // https://docs.stripe.com/tax/connect/direct-charges — under
          // direct charges the connected account is the merchant of record
          // implicitly; do NOT include automatic_tax.liability. This block
          // replaces the SPEC §3.1.3 "PRESERVED VERBATIM" claim which was
          // SUPERSEDED by ORCH-0843 REWORK after QA caught the 400 in live.
          automatic_tax: { enabled: true },
```

Also updated the upstream docblock at line ~292 to cite both the new ORCH-0843 REWORK direct-charge rule AND the matching CI gates (orch-0804 enabled:true + orch-0843 T-G6 no-liability).

### 1.2 `supabase/functions/ticket-checkout-create/__tests__/orch-0843-direct-charge-shape.test.ts` (lines 112-126)

**OLD:** asserted `automatic_tax` present AND `type: "account"` present (preserved-verbatim claim).

**NEW:** asserts `automatic_tax: { enabled: true }` IS present AND `\bliability\s*:` IS ABSENT anywhere in active code. Cites `https://docs.stripe.com/tax/connect/direct-charges` and the QA report `§8 P0-001` as the bug-class anchor.

### 1.3 `.github/scripts/strict-grep/orch-0804-stripe-tax-enabled-on-checkout.mjs` (Check 3)

**OLD:** asserted `automatic_tax:` AND `liability: {` AND `account: stripeAccountId` ALL present.

**NEW:** asserts `automatic_tax:` AND `enabled: true` present. Dropped the `liability:` / `account: stripeAccountId` strict-grep requirements (they were blocking the ORCH-0843 REWORK fix). Header docblock updated to cite the direct-charge contract change with link to `https://docs.stripe.com/tax/connect/direct-charges`. Item 3 in the "Six pattern checks" header list rewritten to match.

### 1.4 `.github/scripts/strict-grep/orch-0843-stripe-direct-charges-only.mjs` (new T-G6 sub-check)

**ADDED:** a new T-G6 sub-check that scans `checkoutSourceNoComments` for the pattern `/\bliability\s*:\s*\{[^}]{0,200}\btype\s*:\s*["']account["']/`. Trips with a named failure citing the Stripe direct-charges doc URL and the ORCH-0843 REWORK regression-prevention context. Header docblock's T-G* contract list extended with T-G6.

### 1.5 `supabase/functions/orch-0843-stripe-direct-charge-probe/index.ts` (line 111)

**ADDED:** `automatic_tax: { enabled: true },` to the probe's Checkout Session body (alongside an explanatory comment block citing the doc URL). Future probe runs now verify the FULL production tax-enabled-direct-charge shape against a real connected account, closing the QA-report-flagged investigation gap (QA §9 Discovery 3: "the probe must mirror the FULL production body").

---

## 2. Local verification — all green

### 2.1 Gates (positive)
```
$ node .github/scripts/strict-grep/orch-0843-stripe-direct-charges-only.mjs
ORCH-0843 Stripe direct-charge gate passed.
EXIT=0

$ node .github/scripts/strict-grep/orch-0804-stripe-tax-enabled-on-checkout.mjs
ORCH-0804 strict-grep PASS — 6/6 checks.
EXIT=0
```

### 2.2 Deno regression test (7/7)
```
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

ok | 7 passed | 0 failed (6ms)
```

### 2.3 `deno check` (3 files, clean)
```
$ /Users/sethogieva/.deno/bin/deno check \
    supabase/functions/ticket-checkout-create/index.ts \
    supabase/functions/refund-order/index.ts \
    supabase/functions/orch-0843-stripe-direct-charge-probe/index.ts
Check supabase/functions/ticket-checkout-create/index.ts
Check supabase/functions/refund-order/index.ts
Check supabase/functions/orch-0843-stripe-direct-charge-probe/index.ts
```

---

## 3. Adversarial regression test (T-G6 trip evidence)

**Step 1 — re-introduce the legacy block:**
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

T-G6 is the proven regression gate for this exact bug class. If a future change ever re-inlines `liability: { type: "account" }` adjacent to `automatic_tax` in `ticket-checkout-create/index.ts` active code, CI fails with the named message above.

---

## 4. Confirmation: `automatic_tax.liability` is absent from active code

```
$ grep -n "liability" supabase/functions/ticket-checkout-create/index.ts
295:      // (brand) as merchant of record — automatic_tax.liability MUST be
296:      // OMITTED (ORCH-0843 REWORK; Stripe rejects the liability block on
307:      // orch-0843-stripe-direct-charges-only (T-G6: no liability block)
353:          // `liability: { type: "account", account: <id> }` shape is for
358:          // implicitly; do NOT include automatic_tax.liability. This block
```

All matches are `//` line comments (the comment-stripper in both the strict-grep gate and the Deno test correctly ignores them). Zero active-code `liability` keys.

---

## 5. SC-N traceability deltas (vs QA §1 matrix)

| SC | Pre-REWORK | Post-REWORK (code-only; live-fire still owed to orchestrator + tester) |
|---|---|---|
| SC-01 | FAIL — live (web Checkout Session 400) | EXPECTED PASS after redeploy — `automatic_tax.liability` block removed; root cause eliminated |
| SC-05 | FAIL — live (web backward-compat) | EXPECTED PASS after redeploy — same root cause |
| SC-06 | FAIL — live (mobile-web backward-compat) | EXPECTED PASS after redeploy — same root cause |
| SC-09 | FAIL on contract | PASS — Tax for Platforms now uses the direct-charge contract (`automatic_tax: { enabled: true }` + Stripe-Account header). Tax collection remains ON; merchant of record designation is implicit via the header per Stripe's Tax for Platforms direct-charges doc. |
| SC-11 | PASS (T-G1..T-G5) | PASS extended (T-G1..T-G6) — defense-in-depth widened to block the exact bug class that caused the FAIL |

SC-02/SC-03/SC-04/SC-07/SC-08/SC-10/SC-12 unchanged by this REWORK.

P1-001 (`charge.dispute.created` missing from `STRIPE_ROUTED_EVENT_TYPES`) deferred per dispatch hard-guard — to be tracked under a follow-up ORCH at operator's discretion.

---

## 6. Discoveries for orchestrator

1. **Probe is now production-shape-faithful.** With Edit 5 the probe emits `automatic_tax: { enabled: true }` so the next probe run against `acct_1TUNLtB5v00XfDTX` actually verifies the FULL tax-enabled direct-charge body Stripe will see in production — closing the QA §9 Discovery 3 ingest gap. Recommend the orchestrator re-run the probe BEFORE redeploying `ticket-checkout-create v47`.

2. **ORCH-0804 gate relaxation is intentional and bounded.** Check 3 still asserts `automatic_tax:` present AND `enabled: true` present. The dropped `liability:` / `account: stripeAccountId` requirements are now actively forbidden under direct charges by orch-0843 T-G6, so the contracts compose cleanly: orch-0804 guarantees Tax-on, orch-0843 T-G6 guarantees no legacy liability shape. If a future ORCH ever needs to re-enable destination charges (unlikely per DEC-154 amended), the gates will need a revisit; flagging only for completeness.

3. **No DB / migration / type-types impact.** This REWORK is pure server-side body shape — no `orders.*` / `ticket_checkout_sessions.*` schema touched. No regen of TS types needed.

4. **SPEC §3.1.3 superseded — strikethrough recommended.** The original SPEC's "PRESERVED VERBATIM" paragraph (and the matching DEC-154 amendment text if it cites Tax for Platforms shape) needs a strikethrough/addendum noting the corrected contract. Owner: orchestrator at CLOSE per implementor hard guards.

---

## 7. Next handoff

- **Owner:** Claude `mingla-orchestrator`
- **Actions:**
  1. Re-run `orch-0843-stripe-direct-charge-probe` against `acct_1TUNLtB5v00XfDTX` (the probe now mirrors production body — confirms Stripe accepts the tax-enabled direct-charge shape).
  2. `supabase functions deploy ticket-checkout-create` → v47 (orchestrator owns deploy per operator directive).
  3. `supabase functions deploy orch-0843-stripe-direct-charge-probe` (refresh probe with the new body for the verification step).
  4. Hand off to Claude `mingla-forensics` TEST mode RETEST sub-mode — live-fire T-01 / T-02 / T-06 / T-07 against `acct_1TUNLtB5v00XfDTX`. T-06 / T-07 unblock once T-01 / T-02 produce a real Checkout Session a buyer can complete.

---

**End of REWORK report.**
