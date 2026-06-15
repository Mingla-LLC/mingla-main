# IMPLEMENTATION — ORCH-1140 — Stripe detach response-contract reconciliation

- **ORCH-ID:** ORCH-1140
- **Phase:** IMPLEMENT
- **Date:** 2026-06-15
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1140-[stripe-detach-contract]/` on branch `ORCH-1140-stripe-detach-contract`
- **Commit:** `5b7ebb853`
- **SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1140_STRIPE_DETACH_RESPONSE_CONTRACT.md`
- **Status:** implemented and verified (server source + client unit verified; UX affordance implemented, runtime device verification deferred to tester per SPEC T-9/T-10)

---

## 1. Summary

The business-app Stripe disconnect succeeded server-side but showed a red failure banner
("missing detached_at in response"). The edge fn computed `detached_at` and wrote it to the DB
but omitted it from the 200 body; the client hard-required it and threw. Fixed by:
1. **Edge fn** now emits `detached_at` + a derived `stripe_delete_status`/`rejection_reason` on
   BOTH 200 bodies (success + not_connected), replacing the dead `stripe_delete_error` wire field.
2. **Client** hardened to treat any 200 with `status` `detached`/`not_connected` as success even if
   `detached_at` is missing (drift guard), while still throwing on non-2xx / null / unrecognized bodies.
3. **Confirm sheet** gains a `"done"` step: an honest "Disconnected" confirmation, plus the real
   Stripe rejection reason (warm, informational) when Stripe rejected the account delete.

No migration / schema / RLS. Audit payload, `action` selection, notification loop, and all non-200
paths byte-unchanged. "Always succeed locally even if Stripe rejects" preserved.

---

## 2. SPEC success-criteria coverage

| SC | Description | Verified | How | Commit |
|----|-------------|----------|-----|--------|
| SC-1 | Success 200 carries `detached_at` (ISO), `status:"detached"`, `stripe_delete_status` ∈ {succeeded,rejected,skipped} | ✓ | edge source + Deno structural test T-1 | 5b7ebb853 |
| SC-2 | not_connected 200 carries `detached_at`, `status:"not_connected"`, `stripe_delete_status:"skipped"`, `rejection_reason:null` | ✓ | edge source + Deno test T-2 + client T-8 | 5b7ebb853 |
| SC-3 | Mapping rejected/succeeded/skipped derived from `attemptedStripeDelete` + `stripeDeleteError` | ✓ | edge source (lines 117-128) + client T-4 | 5b7ebb853 |
| SC-4 | DB UPDATE, `writeAudit` (incl. `after.stripe_delete_error`), `action`, notification loop unchanged; still 200 on Stripe rejection | ✓ | diff inspection (lines 79-115 untouched); existing Deno audit-contract test still passes | 5b7ebb853 |
| SC-5 | Client resolves on success body with real values | ✓ | jest T-3/T-4/T-8 | 5b7ebb853 |
| SC-6 | Client resolves on missing `detached_at`; throws on non-2xx / null / unrecognized | ✓ | jest T-5/T-6/T-7 + null-body test | 5b7ebb853 |
| SC-7-iOS / SC-7-Android | Success shows "Disconnected" step + "Done"; no red banner | ✓ (impl) / runtime→tester | sheet `done` step (shared RN ⇒ both platforms) | 5b7ebb853 |
| SC-8-iOS / SC-8-Android | Rejection shows real reason as warm informational note | ✓ (impl) / runtime→tester | `done` step rejection branch | 5b7ebb853 |
| SC-9 | No input where a server-successful detach renders the red banner | ✓ | handleSubmit advances to `done` on resolve; banner only on catch (now only a real error) | 5b7ebb853 |

---

## 3. Files changed (all in commit 5b7ebb853)

| File | +/- | Type |
|------|-----|------|
| `supabase/functions/brand-stripe-detach/index.ts` | +27/-3 | edge fn |
| `supabase/functions/brand-stripe-detach/index.test.ts` | +36 | edge test (append) |
| `mingla-business/src/services/brandStripeDetachService.ts` | +13/-3 | service |
| `mingla-business/src/services/__tests__/brandStripeDetachService.orch1140.test.ts` | +136 (new) | client test |
| `mingla-business/src/components/brand/BrandStripeDetachConfirmSheet.tsx` | +71/-3 | component |

Exactly the 5 allowlisted files; nothing else staged.

---

## 4. Data-model changes applied

None. No migration, no schema, no RLS, no index. `stripe_connect_accounts.detached_at` already
exists and is written (unchanged at index.ts:79-83).

---

## 5. Edge functions touched

| Function | `verify_jwt` to preserve | Change |
|----------|--------------------------|--------|
| `brand-stripe-detach` | preserve existing (auth via `requireUserId` in-body; do not change config) | response body of the two 200 paths only |

**Deploy is orchestrator/operator-owned at CLOSE, from MERGED main** (not from this worktree).
Expected post-deploy version > 187.

---

## 6. Regression tests added

- **Edge structural (T-1/T-2):** appended 2 Deno tests to
  `supabase/functions/brand-stripe-detach/index.test.ts` asserting the `status:"detached"` and
  `status:"not_connected"` return blocks each contain `detached_at:` + `stripe_delete_status:`.
- **Client behavioral (T-3..T-8 + null):** new
  `mingla-business/src/services/__tests__/brandStripeDetachService.orch1140.test.ts` (7 tests).

**fails-on-revert verified at 5b7ebb853** (both safeguards, via true LINE DELETION):
- Safeguard A (edge): deleting `detached_at` + status fields from the success body →
  `success 200 body carries detached_at + stripe_delete_status` FAILED (`AssertionError: success
  200 body must include detached_at`). Restored → 3 passed | 0 failed.
- Safeguard B (client): restoring the old strict `typeof data.detached_at !== "string"` throw →
  `resolves even when detached_at is missing (drift hardening)` AND `throws on an unrecognized
  response shape` FAILED (2 failed, 5 passed). Restored → 7 passed | 7 total.

Passing-run output (restored state):
- Deno: `ok | 3 passed | 0 failed`
- Jest (ORCH-1140 file): `Tests: 7 passed, 7 total`
- Adjacent stripe service suites (balances + account-session + orch1140): `3 passed, 11 tests`.

---

## 7. Old → New receipts

### supabase/functions/brand-stripe-detach/index.ts
- **Before:** not_connected 200 returned `{ ok, status:"not_connected" }`; success 200 returned
  `{ ok, status:"detached", stripe_delete_error }`. Neither carried `detached_at`; neither carried
  the client-expected `stripe_delete_status`/`rejection_reason`.
- **Now:** captures `attemptedStripeDelete = !row.detached_at` before the UPDATE; derives
  `stripeDeleteStatus` (skipped|rejected|succeeded) + `rejectionReason`; both 200 bodies carry
  `detached_at` (string) + `stripe_delete_status` + `rejection_reason`. not_connected uses a
  current server ISO timestamp + `"skipped"`.
- **Why:** SC-1/2/3/9 — the missing `detached_at` was the root cause; the dead `stripe_delete_error`
  wire field (D-1) is replaced by the contract the client already expects.
- **Lines:** ~+27/-3. Audit/action/notification/non-200 paths untouched.

### mingla-business/src/services/brandStripeDetachService.ts
- **Before:** threw "missing detached_at in response" whenever `data.detached_at` wasn't a string —
  i.e. on every real (compliant-pre-fix) success body.
- **Now:** added `status?` to `RawDetachResponse`; treats `status` `detached`/`not_connected` as
  success (falls back to a client ISO timestamp only if `detached_at` is absent); throws
  "unexpected response shape" on any body without a recognized success status. `error`/`null`
  throws unchanged.
- **Why:** SC-5/SC-6 — defense-in-depth so a future shape drift can't resurrect the false failure,
  without weakening the genuine-error path (Const #3).
- **Lines:** ~+13/-3.

### mingla-business/src/components/brand/BrandStripeDetachConfirmSheet.tsx
- **Before:** on `mutateAsync` resolve it called `onDetached` + `onClose` and dismissed silently
  (and in practice never fired — the throw always won). Step union was `confirm | submitting`.
- **Now:** `Step` adds `"done"`; `handleSubmit` captures the result, sets it in state, advances to
  `"done"`. New `handleDone` fires `onDetached` + `onClose`. The `done` step shows a check icon +
  "Disconnected" header + "Stripe is disconnected for {brandName}.", plus a warm informational note
  with the real `rejectionReason` when `stripeDeleteStatus === "rejected"`, and a single "Done"
  button. Imports the `BrandStripeDetachResult` type. Added `doneWrap` + `doneHeaderRow` styles.
- **Why:** SC-7/SC-8 — honest success confirmation + honest rejection reason (minimal, reuses
  existing tokens/patterns; no redesign).
- **Lines:** ~+71/-3.

---

## 8. Cross-surface impact

| Surface | Affected | Parity |
|---------|----------|--------|
| Consumer iOS | No (no detach UI) | n/a |
| Consumer Android | No | n/a |
| Buyer/anon Web | No | n/a |
| **Business iOS** | **Yes** — honest "Disconnected" confirmation; no false banner | — |
| **Business Android** | **Yes** — identical | Automatic (shared RN + shared edge fn) |
| Admin Web | No (no admin detach path) | n/a |
| Business Web preview | Yes-if-reachable | Automatic (shared RN) |

---

## 9. Smoke / verification result

- Deno structural tests: 3 passed | 0 failed.
- Deno `deno check` of `index.ts`: only a PRE-EXISTING `TS2345` on `writeAudit(supabase, …)` (a
  `@supabase/supabase-js` version-mismatch in `serviceRoleClient()` typing, present on pristine
  origin/main — verified by stashing the ORCH-1140 edits and re-running check on the unmodified
  file). My change introduces no new type errors.
- Business-app `tsc --noEmit`: zero errors in any of the 3 touched business files.
- Jest ORCH-1140 client test: 7/7 pass; adjacent stripe suites 11/11.
- Strict-grep gates run: idempotency-key (R), audit-log (S), notification-via-shared (V),
  api-version (Q) — all 0 violations.
- **No sim/device live-fire run** (backend response-shape + RN component); SPEC routes T-9/T-10
  (live detach + rejection-path UX) to the tester. Labeled implemented, runtime-unverified for the
  UX affordance per SPEC §11.

---

## 10. Known issues / deferred

- No `[TRANSITIONAL]` code introduced.
- UX runtime verification (T-9 success banner-absence, T-10 rejection note) deferred to tester per
  SPEC (live-fire on Business iOS sim + device).

---

## 11. Operator action required (CLOSE-time, NOT implementor)

1. **Migration `db push`:** none (no migration).
2. **Edge deploy (from MERGED main, not this worktree):** redeploy `brand-stripe-detach`. Preserve
   its `verify_jwt` config. Expected version > 187. The edge-fn change alone clears the banner.
3. **Business-app OTA (runtime 1.0.0, per-platform, `npx -y eas-cli@latest update`, never
   `--platform all`):** ships the service hardening + sheet `done` affordance + live Stripe-outcome
   reporting to devices.

---

## 12. Discoveries for Orchestrator

- **D-pre-existing-TS2345:** `deno check supabase/functions/brand-stripe-detach/index.ts` reports a
  `TS2345` on `writeAudit(supabase, …)` — a `@supabase/supabase-js` `SupabaseClient` generic-arity
  mismatch in `serviceRoleClient()`'s type, present on pristine origin/main (NOT introduced by
  ORCH-1140). Likely affects other Stripe edge fns using `serviceRoleClient()` + `writeAudit`. Out
  of ORCH-1140 scope; flag for a future deps/types alignment ORCH.
- **COMMS:** No ledger BLOCK/OPEN row targets ORCH-1140 / implementor / ALL. Only COMMS-0029 (WARN,
  ORCH-1119/1120 trip-migration clobber) is open — unrelated to the Stripe detach flow; no ack
  required, no new entry written.
