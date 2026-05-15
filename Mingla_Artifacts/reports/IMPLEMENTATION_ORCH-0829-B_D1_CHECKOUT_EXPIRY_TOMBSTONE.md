# IMPLEMENTATION — ORCH-0829-B D-1: Checkout-session expiry tombstone + handleBuy try/finally + PaymentSheet timeout race

**Mode:** IMPLEMENT
**Implementor:** Claude `mingla-implementor`
**Date:** 2026-05-14
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0829-B_D1_CHECKOUT_EXPIRY_TOMBSTONE.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0829-B_D1_CHECKOUT_CREATE_RETURNS_200_NO_SESSION.md`
**Sibling -B first pass (preserved as-is):** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0829-B_STRIPE_DOUBLE_RESOLVE.md`

---

## 1. Layman Summary

Three scoped changes shipped against `Seth`:
- **Migration** `20260605000002_orch_0829b_d1_checkout_expiry_tombstone.sql` extends the `biz_ticket_checkout_create_session` RPC so past-expiry in-flight sessions are tombstoned and transitioned to `status='expired'` instead of being reused with stale Stripe PaymentIntents.
- **Mobile** `ExpandedBusinessEventSheet.tsx` wraps `runNativeCheckout` in `try/catch/finally` so `checkoutInFlight` always clears (no silent stuck-flag lockout).
- **Package** `useStripePaymentSheet.ts` gets a 60-second timeout race on both `initPaymentSheet` and `presentPaymentSheet` so any future Stripe SDK hang surfaces as a loud error toast instead of an indefinite spinner.

No edge function source change. No `supabase db push` run (operator gate). Local regression checks: 9/9 PASS (new D-1) + 15/15 PASS (existing -A) + 6/6 PASS (existing -B) + 11/11 PASS (existing 0828). TypeScript: no new errors on touched files.

**Status:** completed · **Verification:** partial (source contracts + regression PASS; live-fire end-to-end deferred to tester RETEST_3 after operator's `supabase db push`).

---

## 2. Files Changed (Old → New Receipts)

### 2.1 `supabase/migrations/20260605000002_orch_0829b_d1_checkout_expiry_tombstone.sql` (NEW, 253 lines)
**What it did before:** N/A — new file.
**What it does now:** Defines the latest `CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session` body. Extends the `IF FOUND THEN ... IF v_existing.status IN (...) OR v_existing.expires_at < now() THEN` tombstone-eligibility predicate with the new OR clause, and adds a CASE expression on the UPDATE that preserves terminal statuses as-is but transitions non-terminal rows to `status='expired'` and sets `failed_at=now()` when they're past expiry. The rest of the function body (event lookup, line validation, INSERT, items insert, final RETURN) is copied verbatim from `20260520000002_orch_0791_session_terminal_tombstone.sql` lines 115-249 per spec §3.1.
**Why:** Investigation R-1 — past-expiry in-flight sessions were being treated as "genuine retries" by the idempotency-key short-circuit, causing the edge function to return HTTP 200 with a stale Stripe clientSecret that the Stripe RN SDK on iOS 26 could not present, producing a ~90s loading-hang then silent dismiss.
**Lines changed:** ~253 (new file; ~30 of those are the new tombstone-eligibility block, ~140 are verbatim copy of the unchanged RPC body).

### 2.2 `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`
**What it did before:** `handleBuy` (lines 219-233) called `setCheckoutInFlight(true)`, awaited `runNativeCheckout`, then unconditionally called `setCheckoutInFlight(false)`. If `runNativeCheckout` threw or hung indefinitely, `setCheckoutInFlight(false)` never ran, leaving the flag stuck true and silently no-op'ing all subsequent Buy taps via the line-192 early return.
**What it does now:** Wraps `runNativeCheckout` in `try { ... } catch (err) { result = { outcome: "failed", message: err instanceof Error ? err.message : "Payment failed." } } finally { setCheckoutInFlight(false) }`. Adds `NativeCheckoutOutcome` type import. The catch block converts any thrown error (including the new H-3 synthetic Timeout error) into the existing failed-outcome branch so the user always sees the error-toast + haptic instead of silent failure. The finally block guarantees the in-flight flag always clears even on hang/throw.
**Why:** Investigation H-2 / RETEST_2 D-2 — `checkoutInFlight` was getting stuck true after the first hung paid attempt, making subsequent attempts in the same session silently dismiss the confirmation modal without ever firing the edge function call.
**Lines changed:** ~25 (1 import line modified to add `type NativeCheckoutOutcome`, ~24 lines added/restructured in the handleBuy body).

### 2.3 `packages/payments-native/useStripePaymentSheet.ts`
**What it did before:** Once-only guard wrapping `initPaymentSheet` and `presentPaymentSheet`. Each wrapper's IIFE awaited the native call and cleared its in-flight ref in a `finally` block. If the native Promise never resolved (Stripe RN 0.50.3 + iOS 26 hang), the `finally` never ran, the ref stayed set forever, and the user was locked out of the entire payment flow for the rest of the app session.
**What it does now:** Adds a module-level `PAYMENT_SHEET_TIMEOUT_MS = 60_000` constant and a module-level `withTimeout<T>(promise, ms, label)` helper that races the provided Promise against a 60-second timer. On timeout, the helper logs `[useStripePaymentSheet] ${label} timed out after ${ms}ms — rejecting with synthetic Timeout error` and rejects with `Object.assign(new Error(...), { code: "Timeout" })`. Both `initPaymentSheet` and `presentPaymentSheet` wrappers now wrap their native calls in `withTimeout(...)` inside the existing IIFE, so the timeout rejection propagates through the existing `try/finally` and clears the in-flight ref correctly. The original once-only guard refs are preserved unchanged. JSDoc updated to document the new behavior and reference the new proposed invariant `I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE`.
**Why:** Investigation H-3 / RETEST_2 fallback (a) — the defensive once-only guard alone could not handle a native call that never resolves; without a timeout escape, the JS-side Promise would hang forever even after the native sheet self-dismissed.
**Lines changed:** ~85 added (withTimeout helper + constant + JSDoc), ~12 modified (each native call wrapped). Total file grew from 102 to 162 lines.

### 2.4 `app-mobile/scripts/ci/orch-0829b-d1-regression-check.mjs` (NEW, ~175 lines)
**What it did before:** N/A — new file.
**What it does now:** Node-based regression check with 9 contracts (T-A1 through T-A9) covering: migration file existence + monotonic prefix, migration body OR clause, migration body status='expired' CASE, handleBuy try/finally wrapper, handleBuy catch error conversion, useStripePaymentSheet timeout constant + helper, both wrappers using withTimeout, synthetic Timeout error code, diagnostic log line. Exit 1 on any FAIL.
**Why:** Spec §3.4 S4 — regression coverage of all source-level contracts in this implementation.
**Lines changed:** ~175 new.

### 2.5 `app-mobile/package.json`
**What it did before:** Scripts ended at `test:orch-0829b`.
**What it does now:** Added `"test:orch-0829b-d1": "node ./scripts/ci/orch-0829b-d1-regression-check.mjs"`.
**Why:** Wire the new regression check into the npm-script convention used by all sibling ORCH regression checks.
**Lines changed:** 1 modified (comma added after prior entry), 1 added.

### 2.6 `.github/scripts/strict-grep/orch-0829b-d1-checkout-expiry-tombstone-or-clause-present.mjs` (NEW, ~95 lines)
**What it did before:** N/A — new file.
**What it does now:** Strict-grep CI gate. Scans `supabase/migrations/*.sql` for files containing `CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session`, picks the LATEST by lexical sort of filename (project's monotonic-timestamp prefix guarantees lexical=chronological), then asserts the body contains both `OR v_existing.expires_at < now()` AND the CASE expression that transitions non-terminal rows to `status='expired'`. Exit 0 on PASS, exit 1 on FAIL with clear violation message, exit 2 on script error (no matching migration).
**Why:** Spec §3.4 S5 — prevent any future RPC replacement from silently dropping the D-1 fix. Backed by proposed invariant `I-PROPOSED-CHECKOUT-EXPIRY-TOMBSTONE`.
**Lines changed:** ~95 new.

### 2.7 `.github/workflows/strict-grep-mingla-business.yml`
**What it did before:** Registry header listed all current strict-grep gates; jobs section ended at `orch-0828-no-date-only-string-constructor`.
**What it does now:** Added `ORCH-0829-B D-1` line to the registry header comment with the invariant ID and description. Added new job `orch-0829b-d1-checkout-expiry-tombstone` at the end of the jobs section mirroring the existing pattern (4 steps: checkout, setup-node@20, run gate script). Per the registry pattern in `feedback_strict_grep_registry_pattern.md`, one script + one job — no parallel workflow files.
**Why:** Spec §3.4 S5 — wire the new gate into CI so it runs on every PR/push affecting the relevant paths.
**Lines changed:** 1 header line added, ~10 lines added for the new job entry.

---

## 3. Spec Traceability

| Spec § / Criterion | Implementation | Status |
|---|---|---|
| S1 (Migration with OR clause + status=expired) | §2.1 — new migration body extends predicate and adds CASE | DONE |
| S2 (try/catch/finally in handleBuy) | §2.2 — try block wraps await; catch converts to failed outcome; finally clears flag | DONE |
| S3 (withTimeout helper, 60s, both wrappers) | §2.3 — helper added, both wrappers use it, synthetic Timeout code | DONE |
| S4 (Regression check 9/9) | §2.4 + §2.5 — script + npm wire; verified 9/9 PASS locally | DONE + PASS |
| S5 (Strict-grep CI gate) | §2.6 + §2.7 — script + workflow job + registry header; verified PASS locally | DONE + PASS |
| C1 (Deployed RPC body has OR clause) | Migration written; awaits operator `supabase db push` | UNVERIFIED — operator gate |
| C2 (Tombstone fires on past-expiry row) | Migration logic verified by source reading; awaits live DB query post-push | UNVERIFIED — operator gate |
| C3 (Stripe sheet renders card form within ~3s) | Source contract correct; awaits live-fire on iPhone 17 Pro sim | UNVERIFIED — tester gate |
| C4 (Successful paid checkout end-to-end) | Source path unchanged from working free flow + spec-correct paid additions; awaits live-fire with test card 4242 | UNVERIFIED — tester gate |
| C5 (Calendar updates within 5s of paid success) | Existing -A invalidate + poll logic unchanged; awaits live-fire | UNVERIFIED — tester gate |
| C6 (Hang induces toast + flag clears) | Source: H-2 finally + H-3 timeout race; awaits induced-hang live-fire | UNVERIFIED — tester gate |
| C7 (No double-resolve banner) | Source: original ORCH-0829-B guard preserved + H-3 timeout race adds defense in depth | UNVERIFIED — tester gate |
| C8 (Regression check 9/9) | `npm run test:orch-0829b-d1` → 9/9 PASS | PASS |
| C9 (Strict-grep CI gate PASS) | Local node invocation: PASS. GitHub Actions will run on push | PASS (local) — UNVERIFIED (CI) |
| C10 (tsc --noEmit clean on touched files) | Only pre-existing structural errors at `useStripePaymentSheet.ts:41-42` (react/stripe declarations) — same as prior -B pass per implementation report; ExpandedBusinessEventSheet.tsx clean | PASS (no new errors) |
| C11 (Pre-existing -A + -B regression still pass) | `npm run test:orch-0829a` → 15/15; `npm run test:orch-0829b` → 6/6 | PASS |

**Summary:** 5 spec implementation criteria DONE + 4 PASS verifications (C8, C9 local, C10, C11) + 7 UNVERIFIED criteria (C1-C7) requiring either operator `supabase db push` (C1, C2) or tester live-fire RETEST_3 (C3-C7).

---

## 4. Invariant Verification

| Invariant | Preserved? | Evidence |
|---|---|---|
| `I-CHECKOUT-IDEMPOTENT` (per ORCH-0791 migration commentary) | Y | The ELSE branch on the IF FOUND THEN block is preserved verbatim and still short-circuits for in-flight non-terminal sessions whose expires_at is still in the future. Test case T-C14 in the spec validates this. |
| `I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS` (ORCH-0828) | Y | This implementation does not touch the sheet rendering at all. |
| `I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY` (ORCH-0829-B first pass) | Y | The once-only guard refs (`inFlightInitRef`, `inFlightPresentRef`) are preserved unchanged. The timeout race layers above the guard, not replacing it. |
| Constitutional Rule 3 (No silent failures) | Y — STRENGTHENED | Before: hung native calls silently locked the user out of payment for the rest of the session. After: hangs surface as a loud error toast within 60s via the catch path. |
| Constitutional Rule 11 (One auth instance) | Y | Auth unchanged. |
| Constitutional Rule 12 (Validate at right time) | Y | DB-side `now()` is the authoritative time; no client `new Date()` introduced. |

**New invariants proposed (orchestrator to add at CLOSE):**
- `I-PROPOSED-CHECKOUT-EXPIRY-TOMBSTONE` — RPC tombstone-eligibility predicate must include `OR v_existing.expires_at < now()`. Backed by §2.6 CI gate.
- `I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE` — useStripePaymentSheet wrappers must wrap native calls in `withTimeout(...)`. Backed by §2.4 regression contracts T-A6/T-A7/T-A8/T-A9.

---

## 5. Parity Check

| Surface | Affected by this change? | Status |
|---|---|---|
| `app-mobile/` consumer | YES — direct (S2 component, S3 package) | DONE |
| `mingla-business/` business | INDIRECT — consumes the same `biz_ticket_checkout_create_session` RPC for its own paid-flow path, AND consumes the same `packages/payments-native/useStripePaymentSheet.ts` package for its native checkout | Both S1 and S3 benefit `mingla-business` for free without code change there (RPC is shared DB-side, package is monorepo-shared). Business code in this commit is unchanged. |
| `mingla-admin/` | NO — admin doesn't initiate buyer checkouts | N/A |
| Web buyer flow (Surface = "web") | YES via RPC change | The same short-circuit gate fires before surface-specific branching. Web buyers get the same fix for free. |
| Solo mode | N/A — this is a paid-checkout flow, not collab-mode-relevant | N/A |
| iOS sim | YES — primary verification target | UNVERIFIED until tester RETEST_3 |
| Android emulator | YES — same package + same RPC | UNVERIFIED — tester should check Android emulator post-RETEST_3 PASS on iOS |
| Free ticket flow | UNCHANGED behavior. Free flow uses different ticket_type_id → different deterministic idempotency_key → never matches a paid stuck row. Free tickets transition to `'free_completed'` (terminal) immediately, so the OLD tombstone branch always handled them correctly. | T-C12 in spec validates no regression. |

---

## 6. Cache Safety

| Query / cache | Affected? | Mitigation |
|---|---|---|
| `["businessEventOrders", userId]` | NO — same key, same shape, same invalidation logic | Existing -A invalidate + 3×1s poll is preserved verbatim in handleBuy's success branch. |
| `ticket_checkout_sessions` DB state | YES — past-expiry in-flight rows will be tombstoned + transitioned on next match | Backup snapshot: NOT REQUIRED. The tombstone is reversible — original `id`, `order_id`, `stripe_payment_intent_id`, and `stripe_checkout_session_id` are queryable on the tombstoned row for forensic/refund-reconciliation work (same audit-trail guarantee as ORCH-0791). |
| AsyncStorage / Zustand persist | NO | This implementation touches neither. |

---

## 7. Regression Surface (5 adjacent features tester should check)

1. **Free ticket claim from the same Big Party event** — must still work identically (spec T-C12). Different idempotency key, different code path, but shares the RPC entry point.
2. **First-time paid buyer on a different event** — should work end-to-end with no stuck row needing to be tombstoned (spec T-C13). Validates the OR clause doesn't accidentally over-trigger on fresh inserts.
3. **In-flight retry within 15 min window** — should short-circuit to existing session as before (spec T-C14). Validates the ELSE branch (genuine in-flight retry preservation) wasn't broken.
4. **Calendar tab Tickets section** — should still show 3 existing Big Party tickets (no regression on -A), then 4 after a successful paid checkout in RETEST_3.
5. **Other inline `<BottomSheet>` flows** (ORCH-0828's TM sheet + place sheet) — should be untouched. The H-2 try/finally change is isolated to `ExpandedBusinessEventSheet.tsx handleBuy`; the H-3 timeout race is in a shared package but only used by the native checkout flow.

---

## 8. Constitutional Compliance

| # | Rule | Status |
|---|---|---|
| 1 | No dead taps | PASS — Continue to Payment will now produce visible feedback within 60s in worst case |
| 2 | One owner per truth | PASS — RPC remains canonical for session creation; mobile UI remains canonical for in-flight state |
| 3 | No silent failures | **STRENGTHENED** — converts silent stuck-flag bug + silent presentation-hang bug into loud toast |
| 4 | One key per entity | N/A — no query key changes |
| 5 | Server state server-side | PASS — checkoutInFlight is client-only UI state; session truth lives in DB |
| 6 | Logout clears everything | PASS — unchanged |
| 7 | Label temporary | N/A — no transitional code introduced |
| 8 | Subtract before adding | PASS — the broken short-circuit logic is replaced (not layered) by the extended predicate |
| 9 | No fabricated data | PASS — no data fabrication |
| 10 | Currency-aware | PASS — currency handling unchanged |
| 11 | One auth instance | PASS — unchanged |
| 12 | Validate at right time | PASS — DB-side `now()` is authoritative; no client timestamps introduced |
| 13 | Exclusion consistency | N/A |
| 14 | Persisted-state startup | PASS — unchanged |

---

## 9. Deploy Notes

### 9.1 Migration deploy (operator-owned)

**Operator MUST run:**
```bash
cd /Users/sethogieva/Desktop/mingla-main
supabase db push --linked
```

**Post-deploy verification (orchestrator runs via Management API SQL probe):**
```sql
SELECT pg_get_functiondef(p.oid) LIKE '%OR v_existing.expires_at < now()%' AS or_clause_present
  FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
 WHERE n.nspname = 'public' AND p.proname = 'biz_ticket_checkout_create_session';
```
Expected: `or_clause_present = true`.

### 9.2 Edge function deploy

**None.** `ticket-checkout-create/index.ts` is unchanged.

### 9.3 Mobile deploy

After CLOSE, orchestrator publishes the OTA via EAS:
```bash
cd app-mobile && eas update --branch production --platform ios --message "ORCH-0829-B D-1: checkout expiry tombstone + handleBuy try/finally + PaymentSheet timeout race"
```
- iOS only (web bundle fails due to react-native-maps native dependency).
- This is a JS-only change — no `eas build` needed.
- **Order:** apply the migration FIRST (operator), then OTA the JS bundle. Otherwise the mobile bundle calls a RPC that doesn't yet have the fix, and stuck rows are still reused for the brief window between OTA push and DB push.

### 9.4 Manual cleanup of the existing stuck row (optional — operator's call)

The existing row `acc20778-8b55-4e2c-9ad3-fedd2637a164` will be auto-tombstoned the next time anyone hits the matching idempotency key post-deploy. If operator wants to pre-clear it before tester RETEST_3 (to make T-C3 reproducible on the first attempt without first triggering the tombstone via a doomed live-fire):
```sql
UPDATE public.ticket_checkout_sessions
   SET idempotency_key = idempotency_key || ':tombstone:' || id::text,
       status = 'expired',
       failed_at = now(),
       updated_at = now()
 WHERE id = 'acc20778-8b55-4e2c-9ad3-fedd2637a164';
```

---

## 10. Local Verification Results

| Gate | Command | Result |
|---|---|---|
| New regression check | `npm run test:orch-0829b-d1` | **9/9 PASS** |
| Existing -A regression | `npm run test:orch-0829a` | **15/15 PASS** (no regression) |
| Existing -B regression | `npm run test:orch-0829b` | **6/6 PASS** (no regression) |
| Existing 0828 regression | `npm run test:orch-0828` | **11/11 PASS** (no regression) |
| Strict-grep CI gate (local invocation) | `node .github/scripts/strict-grep/orch-0829b-d1-checkout-expiry-tombstone-or-clause-present.mjs` | **PASS — `20260605000002_orch_0829b_d1_checkout_expiry_tombstone.sql` contains both contracts** |
| `tsc --noEmit` on touched files | `npx tsc --noEmit 2>&1 \| grep ExpandedBusinessEventSheet \| useStripePaymentSheet \| nativeCheckoutFlow` | Only pre-existing structural errors at `useStripePaymentSheet.ts:41-42` (react/stripe declarations) — **same as prior -B pass per its implementation report; no new errors introduced** |

---

## 11. Deno gate (not run in this Claude session)

Per cross-skill parity rule 8: this session does NOT have Deno on PATH (only the operator's Codex sessions do). However, the spec is a **pure-RPC + mobile** fix — no edge function source changes. `ticket-checkout-create/index.ts` is untouched, so `deno check supabase/functions/ticket-checkout-create/index.ts` would not validate anything new even if run. **Recommended:** operator does NOT need to run a Deno gate for this implementation.

If the operator wants belt-and-suspenders confirmation:
```bash
deno check supabase/functions/ticket-checkout-create/index.ts
deno test supabase/functions/_shared/
```
Expected: same baseline output as last successful Deno gate (no new failures because no edge source changed).

---

## 12. Test First (priorities for tester / operator)

1. **Operator runs `supabase db push --linked`** — single most important gate before anything else. Without this, the DB still has the old RPC.
2. **Orchestrator verifies via the SQL probe in §9.1** — confirms the migration applied cleanly.
3. **Tester runs the Maestro reproducer from RETEST_2** — exact same flow (Discover → Tonight → Big Party → Buy ticket on $250 paid → confirmation modal → Continue to Payment). MUST advance to Stripe card-entry form (not loading skeleton) within ~3s.
4. **Tester types test card 4242 4242 4242 4242, expiry 12/34, CVC 123, ZIP 94103, taps Pay** — should produce success toast + 4th calendar ticket. (If Maestro can't reach Stripe's UIKit fields, tester should STOP and ASK operator per Prime Directive 8.)
5. **Tester runs induced-hang scenario T-C6** — toggle airplane mode mid-attempt OR set publishable key invalid. Within 65s, error toast appears. Subsequent Buy tap re-fires the flow (proves H-2 finally cleared the flag).

---

## 13. Discoveries for Orchestrator

### D-NEW (this implementation): NONE — investigation already surfaced everything in scope

The investigation's D-NEW-1 (pg_cron periodic cleanup), D-NEW-2 (Stripe PI cancel on tombstone), D-NEW-3 (brands/stripe_connect_accounts dedup), D-NEW-4 (test session uses operator email) are all already in `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0829-B_D1_*.md` Discoveries section and are explicitly deferred to sibling ORCHs per spec §2.2.

### Confirmed during implementation: the spec's verbatim-copy guidance was correct

Spec §3.1 said "lines 115-249 of `20260520000002` MUST be copied verbatim." I verified this by reading those exact lines (`Read` tool, offset=115, limit=140) and matching them against my migration body byte-for-byte for the non-modified portion. No paraphrase, no "improvements." This guarantees no accidental regression in the working capacity-check + event-lookup + INSERT + RETURN paths.

### Risk acknowledgment: live-fire ETA depends on operator gate

Without operator's `supabase db push`, the deployed RPC still has the old short-circuit logic. The mobile-side changes (S2 + S3) will work in production from the moment the OTA ships, but the user-visible silent-failure symptom (S1's target) will persist until both the DB push AND the OTA are live. **Recommend:** orchestrator coordinates DB push BEFORE EAS OTA in the CLOSE protocol.

---

## 14. Working-Branch Discipline

All five scoped changes live on `Seth` in `/Users/sethogieva/Desktop/mingla-main`. Only the named files in §2 were modified or created. No global indexes (DECISION_LOG, INVARIANT_REGISTRY, WORLD_MAP, AGENT_HANDOFFS) were written — those are orchestrator-owned at CLOSE. No edge function deployed. No migration applied. No destructive DB action taken.

Files modified:
- `supabase/migrations/20260605000002_orch_0829b_d1_checkout_expiry_tombstone.sql` (NEW)
- `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` (MODIFIED)
- `packages/payments-native/useStripePaymentSheet.ts` (MODIFIED)
- `app-mobile/scripts/ci/orch-0829b-d1-regression-check.mjs` (NEW)
- `app-mobile/package.json` (MODIFIED)
- `.github/scripts/strict-grep/orch-0829b-d1-checkout-expiry-tombstone-or-clause-present.mjs` (NEW)
- `.github/workflows/strict-grep-mingla-business.yml` (MODIFIED)

7 files total: 3 NEW + 4 MODIFIED.

---

## 15. Failure Honesty

**Label:** implemented, partially verified.

- Source-level contracts: PASS (9/9 new regression + all 32/32 sibling regressions + tsc clean on touched files + strict-grep gate PASS locally).
- DB live behavior: UNVERIFIED — operator must run `supabase db push --linked` first, then the SQL probe in §9.1.
- iOS sim live-fire: UNVERIFIED — tester RETEST_3 covers spec test cases T-C1 through T-C14 after operator's DB push.
- GitHub Actions CI: UNVERIFIED — strict-grep gate verified locally; will run on push to Seth.

**No false claims.** I did not run the live-fire because that's the tester's responsibility per the pipeline split. I did not run `supabase db push` because that's the operator's gate per the standing deploy split.

---

NEXT HANDOFF — paste into Claude `mingla-forensics` (TEST mode):

Run RETEST_3 live-fire verification of ORCH-0829-B D-1 against the implementation at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0829-B_D1_CHECKOUT_EXPIRY_TOMBSTONE.md` and the spec at `Mingla_Artifacts/specs/SPEC_ORCH-0829-B_D1_CHECKOUT_EXPIRY_TOMBSTONE.md`, citing prior context in the investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0829-B_D1_CHECKOUT_CREATE_RETURNS_200_NO_SESSION.md` and the prior failure at `Mingla_Artifacts/reports/QA_ORCH-0829-B_STRIPE_LIVEFIRE_REPORT_RETEST_2.md`. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Sub-mode: RETEST (3rd cycle on -B — flag stuck-in-loop to orchestrator if FAIL since spec discipline says >2 retest cycles escalates). **PRE-CONDITION (hard gate):** operator MUST have run `supabase db push --linked` and the orchestrator's SQL probe per spec §9.1 / implementation §9.1 MUST have returned `or_clause_present = true` before testing begins — if not, STOP and ask the operator. Test coverage: all 14 test cases T-C1 through T-C14 in spec §6 — DB-level checks T-C1/T-C2/T-C14 via Management API SQL probes; mobile live-fire T-C3/T-C4/T-C5 via Maestro on iPhone 17 Pro sim `17091E60-C3B6-4167-980D-60C348E177F6` Metro `:8084` (drive Discover → Big Party → scroll → Buy ticket at `tapOn: point: "18%,87%"` → confirmation modal → `tapOn: "Continue to Payment"` text-match → Stripe sheet MUST show card-entry form within ~3s; if Maestro can't reach Stripe's UIKit fields STOP and ASK operator to type 4242 4242 4242 4242 / 12/34 / 123 / 94103 manually); induced-hang T-C6 via airplane mode toggle mid-attempt (verify 60s timeout produces error toast + verify subsequent Buy tap re-fires by re-tapping after the toast); regression-no-banner T-C7 visual check across all screenshots; CI gates T-C8 (`cd app-mobile && npm run test:orch-0829b-d1` → 9/9 PASS) + T-C11 (`npm run test:orch-0829a` 15/15 + `npm run test:orch-0829b` 6/6) and T-C10 (`tsc --noEmit` clean on touched files); strict-grep T-C9 confirmed once GitHub Actions runs after push. Hard guards: NEVER weaken any test to make it pass; NEVER apply migrations from MCP; NEVER use osascript keystrokes (Maestro only per discipline rule 14); capture screenshots + Metro log evidence for every criterion; if Stripe sheet still hangs despite the fix (i.e. test C-3 still shows loading skeleton past 5s with a fresh PaymentIntent), do NOT pivot to a new investigation — STOP and ask operator to confirm both the DB push gate AND the OTA timing (mobile bundle may still be running pre-D-1 code if OTA hasn't published); the timeout race (H-3) will at least surface a loud toast within 65s, so even an SDK-level hang now has a positive failure signal. Expected output: `Mingla_Artifacts/reports/QA_ORCH-0829-B_D1_REPORT_RETEST_3.md` with verdict PASS / CONDITIONAL PASS / FAIL, full per-criterion result matrix, P0-P4 counts, screenshot/log evidence, and Discoveries for Orchestrator. Downstream routing: PASS → Claude `mingla-orchestrator` (or Codex peer) for CLOSE of four-ORCH bundle 0824 + 0828 + 0829-A + 0829-B in one PR Seth→main with the pre-merge gate; FAIL → return to Claude `mingla-implementor` (or Codex peer) for REWORK with specific FAIL findings cited by file/line.
