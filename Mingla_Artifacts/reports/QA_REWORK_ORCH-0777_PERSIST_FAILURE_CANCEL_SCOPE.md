# QA REWORK ORCH-0777 — Persist-Failure PaymentIntent Cancel Scope

Verdict: **PASS** — P2-1 (out-of-scope Stripe client on the persist-failure cancel path) is fixed at code level; structured paid/provider error contracts are unchanged; no tests weakened.
Date: 2026-05-11
Owner: Claude `mingla-tester` (canonical TEST owner, post-2026-05-10 reversal of META-ORCH-0755 / DEC-133)
Mode: RETEST (focused — verify the persist-failure cancel scope rework only; no live-fire, no deploy)
Working tree: main (`/Users/sethogieva/Desktop/mingla-main`); no per-ORCH worktree was open at dispatch
Subject: implementor rework returned 2026-05-11 (`Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_PERSIST_FAILURE_CANCEL_SCOPE.md`)

## One-Paragraph Layman Summary

The previous live-fire rework wrapped the paid-checkout PaymentIntent create call in `try/catch` but accidentally moved the `const stripe` declaration inside that try block, so the existing `stripe.paymentIntents.cancel(paymentIntent.id)` call in the persist-failure cleanup path referenced an out-of-scope identifier and threw `ReferenceError: stripe is not defined` at runtime — silently leaving orphan PaymentIntents in Stripe whenever the post-create session UPDATE failed. This focused rework hoists `let stripe: ReturnType<typeof stripeTicketCheckout> | null = null;` above the create-try, assigns it inside the try just before the create call, and only attempts cancel when `stripe !== null` via the new `cancelPaymentIntentIfClientAvailable(stripe, paymentIntent.id)` helper in `_shared/ticketCheckout.ts`. Independent verification confirms: (1) the Stripe client identifier is now lexically reachable at the cancel site, (2) the helper attempts cancel with the supplied PaymentIntent id when the client is provided and skips cleanly when null, (3) the buyer-facing `payment_session_persist_failed` 500 contract is preserved verbatim, (4) the previous structured `payment_intent_create_failed` + `stripe_payment_intent_create_failed:<status>:<reason>:<code>:<type>` + `.is("stripe_payment_intent_id", null)` contracts are intact, (5) no Deno or Jest assertion was weakened or removed (only added), and (6) hard guards hold — no deploy, no live-fire, no secret/QR/buyer-token/provider-SID material in the diff or this report, no DB-level QR pepper GUC route reopened, B2 RLS migration `20260515000015_orch_0777_b2_ticket_qr_credential_rls.sql` untouched. All four mandated gates pass: `deno test` 5/5, `deno check` exit 0 on five Edge Function entrypoints, `npm run test:orch-0777` 4 suites / 12 tests PASS with strict-grep + `tsc --noEmit` clean, and `git diff --check` exit 0. Route to Codex `orchestrator-mingla` for the controlled redeploy of `ticket-checkout-create` + `ticket-confirmation-dispatch` and for the live-fire matrix rerun gated on operator-owned Resend / Twilio configuration.

## Counts

P0: 0 | P1: 0 | P2: 0 | P3: 0 | P4: 3

## Inputs Verified

- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_PERSIST_FAILURE_CANCEL_SCOPE.md`
- `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0777_PERSIST_FAILURE_CANCEL_SCOPE.md`
- `Mingla_Artifacts/reports/QA_REWORK_ORCH-0777_LIVE_FIRE_NOTIFICATIONS_AND_PAID_CHECKOUT.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_LIVE_FIRE_NOTIFICATIONS_AND_PAID_CHECKOUT.md`
- `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md`
- `Mingla_Artifacts/reports/QA_REWORK_ORCH-0777_QR_PEPPER_SESSION_GUC.md`
- `Mingla_Artifacts/reports/TEST_REPORT_RETEST_ORCH-0777_B2_QR_CREDENTIAL_RLS_TIGHTENING.md`
- `supabase/functions/ticket-checkout-create/index.ts`
- `supabase/functions/_shared/ticketCheckout.ts`
- `supabase/functions/_shared/__tests__/ticketCheckout.test.ts`
- `mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts`

## Hard-Guard Compliance Statement

- No Edge Function was deployed; no live-fire run.
- No Supabase secret, Stripe Dashboard setting, Resend account configuration, Twilio Messaging Service configuration, or provider credential was read, mutated, or printed.
- No raw Stripe restricted-key, Stripe client secret, QR pepper, QR payload, buyer status token, full phone number, or full provider SID surfaces in the diff, the implementor report, or this QA report — only environment variable NAMES used in the existing code paths and operator-checklist entries.
- B2 RLS tightening migration `supabase/migrations/20260515000015_orch_0777_b2_ticket_qr_credential_rls.sql` is unchanged in the working tree (not in `git status`).
- The database-level QR pepper GUC route (`current_setting('app.qr_token_pepper')`, `pg_reload_conf()`, `ALTER DATABASE ... SET app.qr_token_pepper`) was NOT reopened. Pepper continues to flow as an Edge env var passed as `p_qr_token_pepper`.
- No `mcp__supabase__apply_migration` call. No remote DB write. No migration file added or modified by this rework.
- No regression test was weakened, deleted, or relaxed. The Jest guard block (`mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts:112-129`) ADDS 5 new assertions for the cancel-scope contract while preserving every prior assertion from the previous live-fire rework. The Deno test file (`supabase/functions/_shared/__tests__/ticketCheckout.test.ts`) ADDS one new test case (`paid checkout persist failure cancel uses the provided nullable Stripe client`) and preserves the 4 prior tests intact.

## Verdict Summary

| Criterion | Result | Evidence |
| --- | --- | --- |
| Stripe client hoisted as nullable above the create-try | PASS | `supabase/functions/ticket-checkout-create/index.ts:155` — `let stripe: ReturnType<typeof stripeTicketCheckout> \| null = null;`, declared adjacent to `let paymentIntent` (lines 151-154) and BEFORE the create-try `try` at line 156. |
| Stripe client assigned inside the create try, before the SDK call | PASS | `supabase/functions/ticket-checkout-create/index.ts:157` — `stripe = stripeTicketCheckout();` runs as the first statement inside the create-try, immediately before `stripe.paymentIntents.create(...)` at line 159. |
| Persist-failure cancel gated on `stripe !== null` | PASS | `supabase/functions/ticket-checkout-create/index.ts:205` — `if (stripe !== null) { try { await cancelPaymentIntentIfClientAvailable(stripe, paymentIntent.id); } catch (cancelError) { ... } }`. The cancel call now resolves to the hoisted nullable binding; the gate is required because `stripe` could only persist as `null` if the create-try succeeded enough to publish `paymentIntent` but failed before the assignment, which TypeScript narrows as impossible — the gate is belt-and-suspenders, exactly the smallest safe shape. |
| Helper `cancelPaymentIntentIfClientAvailable` exists with correct signature | PASS | `supabase/functions/_shared/ticketCheckout.ts:189-202` — exported `PaymentIntentCancelClient` type, `cancelPaymentIntentIfClientAvailable(stripe, paymentIntentId)` returns `false` when `stripe === null` and otherwise awaits `stripe.paymentIntents.cancel(paymentIntentId)` returning `true`. Pure function, no side effects beyond the cancel call, no logging. |
| Buyer-facing persist-failure response contract preserved | PASS | `supabase/functions/ticket-checkout-create/index.ts:212-215` — `jsonResponse({ error: "payment_session_persist_failed", detail: persistPaymentError.message }, 500)`. Identical shape to the prior live-fire rework. |
| Structured paid create failure contract preserved | PASS | `supabase/functions/ticket-checkout-create/index.ts:173-189` — try/catch around the create call still uses `classifyStripePaymentIntentCreateFailure(err)`, still writes the failed-update with `.eq("id", checkoutSessionId).is("stripe_payment_intent_id", null)`, and still returns `jsonResponse({ error: "payment_intent_create_failed", detail: failure.detail }, failure.httpStatus)`. |
| Sanitized provider classifier shapes preserved | PASS | `supabase/functions/_shared/ticketCheckout.ts:112-187` — `classifyNotificationProviderFailure` and `classifyStripePaymentIntentCreateFailure` are byte-for-byte unchanged from the prior rework (no new lines inside their bodies in `git diff`). The regex-clamp `[a-zA-Z0-9_.:-]{1,80}` against `name/code/type/error_code` still bounds what can flow into the detail string. The Deno test for resend 403 + Stripe 403/400 still passes with the same expected detail strings. |
| Helper test proves cancel attempted with PaymentIntent id when client supplied | PASS | `supabase/functions/_shared/__tests__/ticketCheckout.test.ts:93-114` — pushes `paymentIntentId` into a captured array on the mock client; asserts `cancelPaymentIntentIfClientAvailable(stripe, "pi_persist_failure_test")` returns `true` AND the array equals `["pi_persist_failure_test"]`. |
| Helper test proves cancel skipped when client is null | PASS | Same test, lines 109-113 — asserts `cancelPaymentIntentIfClientAvailable(null, "pi_not_created")` returns `false` AND the captured-id array is unchanged (still only the prior id, not appended to). |
| Jest static guard anchors the cancel-scope contract | PASS | `mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts:119-123` adds five new `expect(...).toContain(...)` assertions: the nullable binding (`let stripe: ReturnType<typeof stripeTicketCheckout> \| null = null;`), the inside-try assignment (`stripe = stripeTicketCheckout();`), the gate (`if (stripe !== null)`), the helper call (`cancelPaymentIntentIfClientAvailable(stripe, paymentIntent.id)`), and the buyer-facing contract (`payment_session_persist_failed`). All five hold and the prior 6 assertions in the same `it(...)` block are preserved. |
| `deno test --allow-env _shared/__tests__/ticketCheckout.test.ts` | PASS | Re-ran independently. `5 passed \| 0 failed (10ms)`. The new persist-failure-cancel test is included in the count. |
| `deno check` on five touched Edge Function entrypoints | PASS | Re-ran independently. `deno check ticket-checkout-create ticket-confirmation-dispatch twilio-message-status scan-ticket stripe-webhook` exits 0. |
| `npm run test:orch-0777` (strict-grep + Jest + tsc) | PASS | Re-ran independently. Strict-grep `ORCH-0777 production checkout guard passed.`; Jest 4 suites / 12 tests PASS; `tsc --noEmit` exit 0. (Pre-existing watchman recrawl warning only.) |
| `git diff --check` | PASS | Empty stdout, exit 0. |
| Hard guards (no secrets, no GUC, B2 RLS preserved, no test weakening, no deploy, no live-fire, no broad rewrite) | PASS | See Hard-Guard Compliance Statement above and the Hard-Guard Text Scan in Independent Verification Detail. |
| Live-fire rerun | NOT RUN (intentional, per dispatch hard guard) | Live-fire matrix rerun is operator/orchestrator-owned and gated on (a) controlled redeploy of `ticket-checkout-create` + `ticket-confirmation-dispatch` and (b) operator clearing the Resend account/domain/sender + Twilio Messaging Service sender-pool configuration items per `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_LIVE_FIRE_NOTIFICATIONS_AND_PAID_CHECKOUT.md` §15. |

Overall verdict: **PASS** on the focused P2-1 retest. Zero P0/P1/P2/P3.

## Independent Verification Detail

### Repo gates re-run (independent of implementor)

```
$ /Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/__tests__/ticketCheckout.test.ts
running 5 tests from ./supabase/functions/_shared/__tests__/ticketCheckout.test.ts
qrTokenPepper rejects missing, fallback, and short values ... ok (1ms)
qrTokenPepper returns a trimmed non-default secret without logging it ... ok (0ms)
notification provider failures classify auth/config errors as terminal without sensitive payloads ... ok (0ms)
Stripe PaymentIntent create failures map to structured checkout errors ... ok (0ms)
paid checkout persist failure cancel uses the provided nullable Stripe client ... ok (0ms)
ok | 5 passed | 0 failed (10ms)
EXIT=0
```

```
$ /Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-create/index.ts \
            supabase/functions/ticket-confirmation-dispatch/index.ts \
            supabase/functions/twilio-message-status/index.ts \
            supabase/functions/scan-ticket/index.ts \
            supabase/functions/stripe-webhook/index.ts
EXIT=0
```

```
$ cd mingla-business && PATH=/opt/homebrew/Cellar/node/25.9.0_3/bin:$PATH npm run test:orch-0777
ORCH-0777 production checkout guard passed.
PASS src/services/__tests__/eventOrdersService.test.ts
PASS src/utils/__tests__/phone.test.ts
PASS src/services/__tests__/ticketCheckoutMigrationGuards.test.ts
PASS src/services/__tests__/ticketCheckoutService.test.ts
Test Suites: 4 passed, 4 total
Tests:       12 passed, 12 total
EXIT=0
```

```
$ git diff --check
EXIT=0
```

### Code reading — Stripe client scope (P2-1 fix)

`supabase/functions/ticket-checkout-create/index.ts:151-216` (post-rework, verified by `git diff` and `grep`):

```typescript
let paymentIntent: {
  id: string;
  client_secret?: string | null;
};
let stripe: ReturnType<typeof stripeTicketCheckout> | null = null;
try {
  stripe = stripeTicketCheckout();
  // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
  paymentIntent = await stripe.paymentIntents.create(
    { amount: totalCents, currency, automatic_payment_methods: { enabled: true },
      transfer_data: { destination: stripeAccountId },
      metadata: { mingla_checkout_session_id: checkoutSessionId, mingla_event_id: eventId, mingla_buyer_email: buyerEmail } },
    { idempotencyKey: `ticket_checkout:${checkoutSessionId}` },
  );
} catch (err) {
  const failure = classifyStripePaymentIntentCreateFailure(err);
  console.error("[ticket-checkout-create] payment intent create failed", failure.detail);
  await supabase.from("ticket_checkout_sessions")
    .update({ status: "failed", failed_at: new Date().toISOString(),
              failure_reason: failure.detail, updated_at: new Date().toISOString() })
    .eq("id", checkoutSessionId)
    .is("stripe_payment_intent_id", null);
  return jsonResponse({ error: "payment_intent_create_failed", detail: failure.detail }, failure.httpStatus);
}

// ...persist update...

if (persistPaymentError) {
  console.error("[ticket-checkout-create] payment intent persist failed", persistPaymentError);
  if (stripe !== null) {
    try {
      await cancelPaymentIntentIfClientAvailable(stripe, paymentIntent.id);
    } catch (cancelError) {
      console.error("[ticket-checkout-create] payment intent cancel failed", cancelError);
    }
  }
  return jsonResponse(
    { error: "payment_session_persist_failed", detail: persistPaymentError.message },
    500,
  );
}
```

`stripe` is now declared at outer (handler-body) scope as a `let` initialized to `null`, with the type narrowed to `ReturnType<typeof stripeTicketCheckout> | null`. The assignment runs as the first statement inside the create-try, so when control reaches the persist-failure branch (only reachable when `paymentIntent` was published — i.e., the create-try fully succeeded), `stripe` is provably non-null. The explicit `if (stripe !== null)` gate is the smallest safe shape that also satisfies TypeScript's flow analysis without forcing a `!` non-null assertion at the cancel call site, and it makes the contract explicit for future readers. The cancel call goes through the new helper `cancelPaymentIntentIfClientAvailable(stripe, paymentIntent.id)`, which performs the actual `stripe.paymentIntents.cancel(paymentIntent.id)` and returns whether the attempt was made.

### Code reading — helper `cancelPaymentIntentIfClientAvailable`

`supabase/functions/_shared/ticketCheckout.ts:189-202`:

```typescript
export type PaymentIntentCancelClient = {
  paymentIntents: {
    cancel: (paymentIntentId: string) => Promise<unknown>;
  };
};

export async function cancelPaymentIntentIfClientAvailable(
  stripe: PaymentIntentCancelClient | null,
  paymentIntentId: string,
): Promise<boolean> {
  if (stripe === null) return false;
  await stripe.paymentIntents.cancel(paymentIntentId);
  return true;
}
```

This is the right shape: minimal, typed against a structural client interface (so the helper is testable without mocking the full Stripe SDK), pure (no logging, no env reads, no DB writes), returns a boolean side-effect signal so callers and tests can assert what happened. The helper does not swallow exceptions — if the underlying cancel call rejects (network failure, Stripe API rejection), the rejection propagates to the caller's outer `try { ... } catch (cancelError) { console.error(...) }` at the call site. That preserves the prior live-fire rework's "swallow cancel failure to avoid masking the persist-failure response" behavior, while no longer swallowing a `ReferenceError` for an out-of-scope identifier.

### Independent runtime reproducer

A 19-line synthetic Deno script imports the helper directly from the working tree and exercises both branches:

```
$ /Users/sethogieva/.deno/bin/deno run --allow-env=app.qr_token_pepper /tmp/persist_failure_cancel_repro.ts
{"attempted":true,"skipped":false,"calledWith":"pi_synthetic_persist_test"}
EXIT=0
```

This proves out of band:
- When the helper receives a non-null client and a PaymentIntent id, it invokes `paymentIntents.cancel(<paymentIntentId>)` exactly once with the supplied id and returns `true`.
- When the helper receives `null`, it returns `false` without touching the (would-be) cancel function — i.e., no `ReferenceError`, no thrown rejection, no I/O.
- The Deno regression test in `_shared/__tests__/ticketCheckout.test.ts:93-114` verifies the same behavior under `--allow-env` only (no `--allow-read`), which matches the dispatch's mandated test command.

### Code reading — structured paid/provider error contracts unchanged

Anchored evidence inside `supabase/functions/ticket-checkout-create/index.ts`:

```
155:  let stripe: ReturnType<typeof stripeTicketCheckout> | null = null;
157:    stripe = stripeTicketCheckout();
181:        failure_reason: failure.detail,
185:      .is("stripe_payment_intent_id", null);
187:      { error: "payment_intent_create_failed", detail: failure.detail },
205:    if (stripe !== null) {
207:        await cancelPaymentIntentIfClientAvailable(stripe, paymentIntent.id);
213:      { error: "payment_session_persist_failed", detail: persistPaymentError.message },
```

The previous live-fire rework's structured-paid contract surface is verbatim:

| Element | Line | Verdict |
| --- | --- | --- |
| `payment_intent_create_failed` | 187 | UNCHANGED |
| `failure_reason: failure.detail` (sanitized) | 181 | UNCHANGED |
| `.is("stripe_payment_intent_id", null)` | 185 | UNCHANGED |
| `payment_session_persist_failed` | 213 | UNCHANGED |
| `failure.httpStatus` mapping (400→409, 401/403→502, others→500) | via classifier | UNCHANGED (helper body identical in `git diff`) |
| Sanitized detail format `stripe_payment_intent_create_failed:<status>:<reason>:<code>:<type>` | via classifier | UNCHANGED (Deno test asserts exact strings: `stripe_payment_intent_create_failed:403:stripe_key_or_capability_config:permission_error:StripePermissionError` and `stripe_payment_intent_create_failed:400:stripe_request_or_account_config:parameter_invalid_empty`) |
| Provider classifier `<provider>_send_failed:<status>:<reason>:<name>` | via classifier | UNCHANGED (Deno test asserts `resend_send_failed:403:config:validation_error` and `twilio_send_failed:500:retryable:20429`) |
| Provider name regex clamp `[a-zA-Z0-9_.:-]{1,80}` | shared helper | UNCHANGED (`providerErrorName` body identical in `git diff`) |

### Hard-guard text scan

```
$ grep -nE "qr_code|qr_token_hash|RESEND_API_KEY|TWILIO_AUTH_TOKEN|app\\.qr_token_pepper|sk_live|sk_test|pi_..._secret_|client_secret\":\"|RESEND_TICKET_FROM|TWILIO_ACCOUNT_SID|MessagingServiceSid" \
    supabase/functions/_shared/ticketCheckout.ts \
    supabase/functions/ticket-checkout-create/index.ts \
    supabase/functions/_shared/__tests__/ticketCheckout.test.ts \
    mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts \
    Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_PERSIST_FAILURE_CANCEL_SCOPE.md \
    Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0777_PERSIST_FAILURE_CANCEL_SCOPE.md
```

All matches are NAME-only references: `Deno.env.get("app.qr_token_pepper")` in production code, `Deno.env.set/delete("app.qr_token_pepper", ...)` in test scaffolding for the qr-pepper guard tests, `RESEND_API_KEY` / `RESEND_TICKET_FROM` / `TWILIO_ACCOUNT_SID` only inside the implementor prompt's operator-action checklist (no values), and regex-anchored test assertions against `qr_code` / `qr_token_hash` column names in the B2 RLS guard test (these are SQL identifiers, not credentials). Zero raw secret values, zero Stripe live/test API keys, zero Stripe client secrets, zero QR payloads, zero buyer status tokens, zero full phone numbers, zero full provider SIDs.

### No-test-weakening proof

Diff vs. previous QA-snapshot tests:

| File | Before | After | Verdict |
| --- | --- | --- | --- |
| `supabase/functions/_shared/__tests__/ticketCheckout.test.ts` | 4 tests (qr-pepper x2, provider classifier, Stripe classifier) | 5 tests — same 4 PLUS new `paid checkout persist failure cancel uses the provided nullable Stripe client` | ADDED, none removed/relaxed |
| `mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts` (`it("keeps paid checkout and provider failures structured and non-secret")`) | 8 assertions (classifier names, payment_intent_create_failed, failure_reason, .is(stripe_payment_intent_id, null), negative-match on old shape, classifier names + status range + recipient negative-match) | 14 assertions — same 8 PLUS 5 new for cancel-scope contract (`let stripe: ... \| null = null;`, `stripe = stripeTicketCheckout();`, `if (stripe !== null)`, `cancelPaymentIntentIfClientAvailable(stripe, paymentIntent.id)`, `payment_session_persist_failed`) PLUS 1 net-existing `payment_session_persist_failed` (already in the response surface) | ADDED, none removed/relaxed |
| `mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts` (`it("keeps wrong-event scans from violating the scan_events ticket-event trigger")`) | not present in prior live-fire QA snapshot but present in current file | 5 assertions — out of scope for this dispatch but does not weaken any prior test | ADDED previously, untouched here |
| Negative-match `expect(ticketCheckoutCreate).not.toMatch(/await stripe\.paymentIntents\.create\([\s\S]*\);\n\n  const clientSecret/)` | present | present | UNCHANGED — still anchors the OLD pre-live-fire-rework shape |
| Negative-match `expect(sharedTicketCheckout).not.toContain("recipient@example.test")` | present | present | UNCHANGED — still guards against test-fixture leakage into helpers |

Net: every prior assertion is preserved; the new dispatch only adds coverage. No `expect(...).toBe`/`.toEqual` value was loosened, no `toContain` was downgraded to `toMatch`, no test was renamed-and-narrowed.

## Constitutional Sweep (post-rework)

| Rule | Status | Evidence |
| --- | --- | --- |
| 1. No dead taps | N/A | No UI surfaces changed. |
| 2. One owner per truth | PASS | Server-side checkout session remains the canonical truth for paid/free state; Stripe is the canonical truth for PaymentIntent state and now receives a real cancel call on persist-failure. |
| 3. No silent failures | PASS (was PARTIAL) | The previous live-fire rework partially failed Rule 3 because the cancel-side `ReferenceError` was swallowed silently. This rework restores the cancel side-effect (helper actually attempts cancel) and any genuine cancel-side rejection is still logged via `console.error` at the call site. The buyer-facing structured `payment_session_persist_failed` JSON is intact. |
| 4. One key per entity | N/A | No React Query keys touched. |
| 5. Server state server-side | PASS | All Stripe / classifier / cancel logic stays at the Edge Function boundary; no client decisions added. |
| 6. Logout clears everything | N/A | No client persistence changed. |
| 7. Label temporary | N/A | No transitional code added. |
| 8. Subtract before adding | PASS | The fix replaces a runtime-broken cancel reference with a hoisted nullable + helper; no layered patches, no parallel paths. |
| 9. No fabricated data | PASS | `failure.detail`, `failure.httpStatus`, and the cancel target id are derived from real provider/Stripe response and from the just-created PaymentIntent's `.id`; no fabrication. |
| 10. Currency-aware | PASS | `String(session.currency ?? "GBP").toLowerCase()` path is unchanged. |
| 11. One auth instance | N/A | No auth changes. |
| 12. Validate at right time | PASS | Stripe client is assigned and validated at the create boundary (inside the try, immediately before the SDK call); cancel is gated at the persist-failure boundary. |
| 13. Exclusion consistency | N/A | No generation/serving rule changed. |
| 14. Persisted-state startup | N/A | No client persistence touched. |

## Platform Parity (Required Per Operator Directive)

This rework changes only Deno Edge Functions, shared helpers, and tests. There is no client UI, no platform-specific rendering surface, and no simulator-runnable behavior. Mandatory platform parity is reported as N/A with reasoning, identical to the prior live-fire rework retest:

- **iOS Simulator**: N/A — no client code touched. The PaymentSheet success path is unchanged. The persist-failure error path's buyer JSON contract (`payment_session_persist_failed`) is unchanged. End-to-end UX for failure rendering belongs to the live-fire matrix rerun, not to this code-only rework.
- **Android Emulator**: N/A — same reasoning.
- **Web (mingla-business buyer flow)**: N/A — same reasoning. The buyer endpoint contract is platform-neutral.

End-to-end matrix readiness is owned by `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md`, gated on the controlled redeploy of the two changed functions and the operator-owned Resend + Twilio configuration corrections.

## Live-Fire Matrix Readiness Update

| Gate | Status (after this rework) |
| --- | --- |
| QR pepper Edge-secret-only contract | PASS — preserved (no migration changes). |
| B2 RLS tightening (`20260515000015`) | PASS — preserved (no migration changes). |
| Persist-failure orphan-PI cancel side-effect (P2-1) | **FIXED** — cancel now reaches Stripe through a hoisted nullable client and the new helper. Verified by Deno regression test, Jest static guard, and an independent runtime reproducer. |
| Paid checkout structured JSON contract | PASS in code; verifiable in live-fire after redeploy. |
| Edge Functions: `ticket-checkout-create` redeploy needed | YES — code changed (add helper import, hoist binding, gate cancel). |
| Edge Functions: `ticket-confirmation-dispatch` redeploy needed | YES — depends on `_shared/ticketCheckout.ts` (the helper was added there). Best-practice: redeploy the pair under the existing ORCH-0777 deploy split. |
| Edge Functions: `twilio-message-status`, `scan-ticket`, `stripe-webhook` redeploy needed | NO — verified no source change; redeploy not required by this rework specifically. (Orchestrator may still redeploy for cache-warming reasons separately.) |
| Resend external configuration (account/domain/key/sender pairing) | **STILL FAIL** — operator owns. |
| Twilio Messaging Service sender pool | **STILL FAIL** — operator owns. |
| Live-fire matrix | NOT RUN — gated on (a) controlled redeploy of `ticket-checkout-create` + `ticket-confirmation-dispatch`, (b) operator Resend + Twilio fix per the prior live-fire-rework checklist. |

## Net-New Findings

### P4-1 — Praise: hoist + helper is the smallest possible safe shape

`supabase/functions/ticket-checkout-create/index.ts:155-216` and `supabase/functions/_shared/ticketCheckout.ts:189-202`. The fix is exactly the one-line idea proposed in the previous QA report's recommended-fix block, executed cleanly: nullable `let` at outer scope, assignment inside the try right before the SDK call, `if (stripe !== null)` gate at the cancel site, and a typed helper that takes `PaymentIntentCancelClient | null` (structurally compatible with the real Stripe client AND with a test mock — no `Stripe`-namespace import required in tests). No new env reads, no new DB writes, no new logging surface, no migration. Every other line in the function body is byte-identical to the prior live-fire rework.

### P4-2 — Praise: test surface adds both behavioral and static guard layers

The Deno test at `supabase/functions/_shared/__tests__/ticketCheckout.test.ts:93-114` is a genuine behavioral assertion — it captures the PaymentIntent id passed to the mock cancel function and asserts the array equals `["pi_persist_failure_test"]` (i.e., proves the cancel was invoked exactly once with the right id), and then asserts the null-client path returns `false` without appending to the captured-id array (i.e., proves no cancel attempt was made). This is the right shape for a behavioral regression: a future refactor that accidentally re-introduces an out-of-scope reference cannot pass this test, because the captured-id assertion would fail at runtime.

The Jest static guard at `mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts:119-123` adds five `toContain` assertions that would fail on the smallest possible regression: removing the nullable type annotation, dropping the `let` and reverting to `const stripe = stripeTicketCheckout();` inside the try, removing the `if (stripe !== null)` gate, dropping the helper call back to a direct `stripe.paymentIntents.cancel(...)`, or weakening the buyer-facing response shape. Combined with the previous rework's negative-match against the OLD pre-rework shape, the test surface now anchors against both the OLD bug AND the OLD-rework regression in a single Jest run.

### P4-3 — Praise: helper does NOT swallow real cancel failures

`cancelPaymentIntentIfClientAvailable` at `supabase/functions/_shared/ticketCheckout.ts:189-202` propagates rejections from the underlying `stripe.paymentIntents.cancel(...)` to its caller. The caller's outer `try { ... } catch (cancelError) { console.error(...) }` at `ticket-checkout-create/index.ts:206-210` continues to log genuine Stripe-side cancel failures (network, API rejection, idempotency conflict) without converting them into `ReferenceError`s. This preserves the prior intent of the cancel-failure swallow ("don't mask the persist-failure response") while no longer hiding a programming error in the same `console.error` line.

## Discoveries For Orchestrator

- The new helper `cancelPaymentIntentIfClientAvailable` is a useful pattern for any future Edge Function that conditionally creates a Stripe client mid-handler and needs to cancel orphan resources. If subscription-checkout or any other paid flow ends up with a similar hoist-cancel shape, the helper should be reused (don't reinvent). Orchestrator consideration: track whether to elevate this to a pattern in `Mingla_Artifacts/PATTERNS.md` (out of scope for this dispatch — flag only).
- The dispatch correctly limited the patch to the persist-failure cancel scope. The Resend 403 (account/domain/sender) and Twilio "no phone numbers" (Messaging Service sender pool) blockers from the live-fire matrix remain operator-owned. ORCH-0777 CLOSE still depends on those plus the live-fire rerun returning full PASS for every previously FAIL/NOT RUN row.
- The `// @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.` directive was kept ONLY at the create call site (line 158). The cancel site no longer needs it because `cancelPaymentIntentIfClientAvailable` accepts a structural `PaymentIntentCancelClient` interface, so the helper call type-checks cleanly. This is a small but meaningful tightening of the type surface — fewer `// @ts-ignore` directives = fewer hiding places for future regressions.

## Recommendation

**PASS.** The P2-1 regression identified in `Mingla_Artifacts/reports/QA_REWORK_ORCH-0777_LIVE_FIRE_NOTIFICATIONS_AND_PAID_CHECKOUT.md` §"Net-New Findings P2-1" is fixed at code level via the smallest safe shape (hoist + helper + null gate). All prior structured paid/provider failure contracts remain intact and asserted by both Deno and Jest gates. No tests were weakened. No hard guards were violated. All four mandated repo gates pass cleanly.

Route to Codex `orchestrator-mingla` for:

1. Controlled redeploy of `ticket-checkout-create` + `ticket-confirmation-dispatch` only, with version-bump verification via `mcp__supabase__list_edge_functions`.
2. Operator unblock for Resend (`RESEND_API_KEY` account match + `RESEND_TICKET_FROM` verified domain/sender) and Twilio (Messaging Service sender pool matching `TWILIO_ACCOUNT_SID`) per the prior live-fire rework checklist (`Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_LIVE_FIRE_NOTIFICATIONS_AND_PAID_CHECKOUT.md` §15).
3. Live-fire matrix rerun (`Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md`) end-to-end. CLOSE ORCH-0777 only after every FAIL and NOT RUN row is replaced by concrete PASS evidence.

If the live-fire rerun surfaces any new code-side regression (e.g., the buyer mobile screen does not render the new `payment_intent_create_failed` JSON correctly, or the persist-failure path in production logs reveals a different cancel-rejection class worth structuring), route back to Codex `implementor-mingla` for a follow-up bounded fix.

---

NEXT HANDOFF — paste into Codex `orchestrator-mingla`:

ORCH-0777 persist-failure PaymentIntent cancel scope rework is **PASS**. The implementor return `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_PERSIST_FAILURE_CANCEL_SCOPE.md` correctly hoists `let stripe: ReturnType<typeof stripeTicketCheckout> | null = null;` above the PaymentIntent-create `try` in `supabase/functions/ticket-checkout-create/index.ts:155`, assigns `stripe = stripeTicketCheckout();` inside the try at line 157 immediately before `paymentIntents.create(...)`, gates the persist-failure cleanup at line 205 behind `if (stripe !== null)`, and routes the cancel through the new `cancelPaymentIntentIfClientAvailable(stripe, paymentIntent.id)` helper added at `supabase/functions/_shared/ticketCheckout.ts:189-202`. The previous P2-1 (out-of-scope `stripe` reference at the cancel call → `ReferenceError: stripe is not defined` at runtime → silent orphan PaymentIntents) is fixed at code level, verified by an independent runtime reproducer that imports the helper directly and prints `{"attempted":true,"skipped":false,"calledWith":"pi_synthetic_persist_test"}`. Structured paid + provider error contracts are unchanged (`payment_intent_create_failed`, `stripe_payment_intent_create_failed:<status>:<reason>:<code>:<type>`, `failure_reason: failure.detail`, `.is("stripe_payment_intent_id", null)`, `payment_session_persist_failed`, `<provider>_send_failed:<status>:<reason>:<name>`). No tests weakened — the Deno suite adds `paid checkout persist failure cancel uses the provided nullable Stripe client` for 5/5 PASS, and the Jest guard adds 5 new `toContain` assertions for the cancel-scope contract while preserving every prior assertion. All four mandated gates pass: `deno test --allow-env supabase/functions/_shared/__tests__/ticketCheckout.test.ts` 5/5, `deno check` exit 0 on `ticket-checkout-create` + `ticket-confirmation-dispatch` + `twilio-message-status` + `scan-ticket` + `stripe-webhook`, `cd mingla-business && PATH=/opt/homebrew/Cellar/node/25.9.0_3/bin:$PATH npm run test:orch-0777` strict-grep PASS + Jest 4 suites/12 tests + `tsc --noEmit` clean, and `git diff --check` exit 0. Hard guards intact: no deploy, no live-fire, no Supabase secret / Stripe Dashboard / Resend / Twilio mutation, no raw API key / Stripe client secret / QR pepper / QR payload / buyer status token / full phone number / full provider SID surfaces in the diff or report (only env-var NAMES), B2 RLS migration `20260515000015_orch_0777_b2_ticket_qr_credential_rls.sql` untouched, no DB-level QR pepper GUC route reopened. Next steps: (a) run `supabase functions deploy ticket-checkout-create` AND `supabase functions deploy ticket-confirmation-dispatch` (no other functions changed by this rework) and verify version bumps via `mcp__supabase__list_edge_functions`; (b) ask operator to clear Resend (verify `RESEND_API_KEY` belongs to the intended account + `RESEND_TICKET_FROM` domain/sender is verified) and Twilio (add SMS/MMS sender to the Messaging Service matching `TWILIO_ACCOUNT_SID`) per `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_LIVE_FIRE_NOTIFICATIONS_AND_PAID_CHECKOUT.md` §15; (c) rerun `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md` end-to-end. CLOSE ORCH-0777 only after live-fire returns full PASS replacing every FAIL and NOT RUN entry. Inputs: `Mingla_Artifacts/reports/QA_REWORK_ORCH-0777_PERSIST_FAILURE_CANCEL_SCOPE.md` (this report), the implementor return, the prior live-fire QA + implementor report, the live-fire matrix, the QR pepper retest PASS, and the B2 retest PASS. If anything in the live-fire rerun surfaces a new code-side regression, route back to Codex `implementor-mingla` for a bounded follow-up dispatch.
