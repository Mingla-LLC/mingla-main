# SPEC — ORCH-1140 — Stripe detach response-contract reconciliation (honest disconnect UX)

- **ORCH-ID:** ORCH-1140
- **Phase:** SPEC (binding build contract)
- **Date:** 2026-06-15
- **Author:** mingla-forensics (SPEC mode)
- **Source investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1140_STRIPE_DETACH_MISSING_DETACHED_AT.md` (PROVEN, all five layers + live runtime log + DB read)
- **Confidence inherited:** PROVEN root cause. No new investigation performed in this SPEC (per SPEC hard rule #1).

---

## 1. Executive summary

In the business app, disconnecting Stripe from a brand **succeeds server-side** (the connected account is soft-deleted locally AND deleted at Stripe), but the app shows a red failure banner: **"Couldn't disconnect: detachBrandStripe: missing detached_at in response."** The edge function computes the `detached_at` timestamp, writes it to the DB and audit log, but **omits it from the 200 success response body**. The client wrapper hard-requires `detached_at` as a string and throws when it is absent — so a completed, KYC-to-reverse destructive action reads as a failure, inviting duplicate attempts and support tickets.

A second, latent shape mismatch (investigation **D-1**) compounds this: the edge fn emits `stripe_delete_error` (a `string | null`), but the client expects `stripe_delete_status` (`"succeeded" | "rejected" | "skipped"`) + `rejection_reason`. As shipped, the client's Stripe-outcome reporting is dead — it always falls back to `"skipped"` / `null` — so a genuine Stripe-side rejection (e.g. `balance_remaining`) can never be surfaced to the user.

This SPEC reconciles the `brand-stripe-detach` edge-fn response contract with the client `RawDetachResponse` contract on **all** 200 return paths, derives an honest `stripe_delete_status` + `rejection_reason` from the existing server outcome, hardens the client so a future shape drift cannot resurrect the false-failure, and adds a minimal "Disconnected" success affordance + an honest rejection message in the confirm sheet. **No migration, no schema change, no RLS change** (the `detached_at` column already exists and is written). Business iOS + Android parity is automatic (shared RN). The "always succeed locally even if Stripe rejects" semantic is preserved exactly.

---

## 2. Scope & non-goals

### In scope
1. **Edge-fn response reconciliation** — add `detached_at` (string) to BOTH 200 bodies (`status: "detached"` success path and `status: "not_connected"` path) and replace `stripe_delete_error` with the client-expected `stripe_delete_status` + `rejection_reason` pair, derived from the existing server outcome. (Internal `stripeDeleteError` variable + audit `after.stripe_delete_error` field stay as-is — see §4 Audit guard.)
2. **Client hardening** — `brandStripeDetachService.detachBrandStripe` must treat a 200 with `status === "detached"` or `status === "not_connected"` as SUCCESS even if `detached_at` is missing (defense-in-depth), while still throwing on a true non-2xx error or a genuinely malformed/failure body.
3. **UX honesty** — the confirm sheet must show a clear success confirmation (a "Disconnected" state, not silent dismiss-then-nothing) and, on a Stripe rejection, the real reason — without a redesign.
4. **Regression contract** — a fails-on-revert test that the success 200 body carries a string `detached_at`, and a client-wrapper test that it resolves (not throws) on the success body.

### Non-goals (explicitly NOT in this SPEC)
- **No migration / schema / RLS / index change.** `stripe_connect_accounts.detached_at` already exists and is written (investigation Schema + Data layers). Re-confirming: the fix is purely response-shape + client + minimal UI.
- **No change to the soft-delete semantics.** The edge fn ALWAYS succeeds locally even if Stripe rejects the account delete; `stripe_delete_status` reflects ONLY the Stripe-side outcome. This is preserved verbatim.
- **No change to the audit-log writes or the manager-notification side effects** (`writeAudit`, `dispatchNotification`, the `action` selection, the `getBrandPaymentManagerUserIds` loop). DO-NOT-TOUCH.
- **No new edge-fn return path, no new HTTP status code, no auth/precondition change.** Only the *bodies* of the two existing 200 paths change.
- **No designer dispatch.** No net-new UI surface; the success/rejection affordance reuses the existing Sheet, tokens, and copy patterns already in the file. Called out explicitly per dispatch.
- **No consumer-app / web / admin work.** No detach UI exists on those surfaces (investigation Blast Radius).
- **No retry/idempotency redesign.** The fix removes the false failure, so the "retry never recovers" symptom (F-4) dissolves without touching retry logic.

### Assumptions
- The edge fn is deployed at version 187, byte-for-byte identical to `origin/main` (investigation Q3). The implementor branches from MERGED `origin/main`.
- `semantic.success` (`#22c55e`) and `accent` tokens already exist in `mingla-business/src/constants/designSystem.ts` (verified) and are reused for the success affordance.

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered | User-visible behavior demanded | Files touched here | Parity |
|---|---------|---------|-------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/` iOS) | NOT covered | No detach UI on consumer. | none | n/a |
| 2 | Consumer Android (`app-mobile/` Android) | NOT covered | No detach UI on consumer. | none | n/a |
| 3 | Buyer/anon Web | NOT covered | No detach UI on buyer web. | none | n/a |
| 4 | **Business iOS** | **COVERED** | A successful Stripe disconnect shows a clear "Disconnected" confirmation (never a red failure banner). A genuine Stripe rejection shows the real reason. | edge fn (server), `brandStripeDetachService.ts`, `BrandStripeDetachConfirmSheet.tsx` | — |
| 5 | **Business Android** | **COVERED** | Identical to iOS. | same shared RN files | **Automatic** (shared RN code + shared edge fn; no Android-specific path) |
| 6 | Admin Web (`mingla-admin/`, adjacent) | NOT covered | No admin detach path exists. | none | n/a |
| 7 | Business Web preview (adjacent) | COVERED-if-reachable | If the sheet renders on business web preview, the same shared component fix applies automatically. | same shared RN file | Automatic |

Reason every NOT-covered surface is excluded: **no detach UI exists there** (investigation §8 Blast Radius, single call chain, business app only).

---

## 4. Layered specification

### 4.0 Layers genuinely unaffected (skipped, with reason)
- **Database / Schema / RLS / Migration:** unaffected. `detached_at` already exists and is written at `index.ts:71`. No SQL.
- **Hook layer (`useBrandStripeDetach.ts`):** unaffected by contract — it already returns `BrandStripeDetachResult` and invalidates the right caches. It is touched ONLY if the success affordance needs the result's `stripeDeleteStatus`/`rejectionReason` passed up; see §4.3 — the chosen design reads the mutation result inside the sheet via `mutateAsync`, so **the hook is NOT modified.** Listed DO-NOT-TOUCH below.
- **Realtime:** not applicable.

---

### 4.1 Edge function — `supabase/functions/brand-stripe-detach/index.ts`

**No change to:** method/route, auth (`requireUserId`, `requirePaymentsManager`), input validation, the Stripe `accounts.del` call, the soft-delete UPDATE, the `writeAudit` call (including its `after.stripe_delete_error` field — leave the audit shape untouched), the notification loop, or any error (non-200) return path.

**Derive the Stripe-outcome status (new local logic, inserted after the soft-delete UPDATE succeeds, before the two 200 returns).**

Define a derivation from the EXISTING state already in scope — `row.detached_at` (was the Stripe-delete block entered?) and `stripeDeleteError` (did the delete throw?):

| Server state | `stripe_delete_status` | `rejection_reason` |
|--------------|------------------------|--------------------|
| Stripe-delete block was **skipped** because `row.detached_at` was already set (re-detach / idempotent retry) | `"skipped"` | `null` |
| Stripe-delete block **ran** and threw (`stripeDeleteError !== null`) | `"rejected"` | `stripeDeleteError` (the Stripe error message string, e.g. balance-remaining text) |
| Stripe-delete block **ran** and succeeded (`stripeDeleteError === null`) | `"succeeded"` | `null` |

Precise rule (the implementor derives, does not guess):
- The block runs **iff** `!row.detached_at` (existing condition at `index.ts:54`). Capture that boolean (e.g. `const attemptedStripeDelete = !row.detached_at;`) BEFORE the UPDATE re-stamps anything — note `row.detached_at` is the pre-UPDATE value read at `index.ts:39-43`, so it is safe to read at the return site, but capturing it explicitly is clearer and revert-proof.
- `stripe_delete_status` = `!attemptedStripeDelete ? "skipped" : (stripeDeleteError ? "rejected" : "succeeded")`.
- `rejection_reason` = `stripe_delete_status === "rejected" ? stripeDeleteError : null`.

**Return path A — SUCCESS (`index.ts:106-110`).** Replace the body so it carries `detached_at` + the derived status pair:

```
return jsonResponse({
  ok: true,
  status: "detached",
  detached_at: detachedAt,            // ← NEW (already computed at index.ts:68)
  stripe_delete_status: stripeDeleteStatus,   // ← NEW (replaces stripe_delete_error)
  rejection_reason: rejectionReason,          // ← NEW
});
```
HTTP status: **200** (unchanged — `jsonResponse` default).

**Return path B — NOT-CONNECTED (`index.ts:48-50`).** This path returns before `detachedAt` is computed and before the Stripe block. It MUST still carry a string `detached_at` (the client guard, even after hardening, treats a missing field as a defense-in-depth fallback — but the contract demands the field be present on every 200). The brand has no connected account, so nothing was detached now; emit a server-current ISO timestamp and a `"skipped"` Stripe status:

```
if (!row) {
  return jsonResponse({
    ok: true,
    status: "not_connected",
    detached_at: new Date().toISOString(),   // ← NEW (current server time; nothing to detach)
    stripe_delete_status: "skipped",          // ← NEW
    rejection_reason: null,                    // ← NEW
  });
}
```
HTTP status: **200** (unchanged). Rationale: the field MUST be a string on every 200 to satisfy the declared `RawDetachResponse` contract and the I-PROPOSED invariant; the client treats `not_connected` as benign success (no account to disconnect). This kills latent finding **F-3**.

**Full post-fix 200 response contract (authoritative):**

| Return path | HTTP | `ok` | `status` | `detached_at` | `stripe_delete_status` | `rejection_reason` |
|-------------|------|------|----------|---------------|------------------------|--------------------|
| Success (line ~106) | 200 | `true` | `"detached"` | ISO string (computed at line 68) | `"succeeded"` \| `"rejected"` \| `"skipped"` | string (if rejected) \| `null` |
| Not-connected (line ~49) | 200 | `true` | `"not_connected"` | ISO string (current server time) | `"skipped"` | `null` |

All non-200 return paths (405/401/400/403/500) are **unchanged** — they carry `{ error, detail? }` and no `detached_at`, and the client must continue to throw on them (the `error` from `supabase.functions.invoke` is non-null on non-2xx).

**Audit guard (DO-NOT-TOUCH):** the `writeAudit` call at `index.ts:81-89` keeps `after: { detached_at, stripe_delete_error: stripeDeleteError }` exactly as-is. The new `stripe_delete_status` is a RESPONSE-only derivation; do not change the audit payload. The `action` selection at `index.ts:78-80` (which already keys off `stripeDeleteError`) is unchanged.

---

### 4.2 Service — `mingla-business/src/services/brandStripeDetachService.ts`

**Goal:** defense-in-depth so a future shape drift cannot resurrect the false-failure, WITHOUT weakening the genuine-error path.

**Keep unchanged:** the `error` throw (`if (error) throw error;`, line 40) and the null-data throw (`if (data === null) ...`, line 41-43). A real non-2xx still throws; a literal `null` body still throws.

**Change the `detached_at` guard (lines 44-46).** Replace the hard "missing → throw" with a status-aware acceptance:

- If `data.status === "detached"` OR `data.status === "not_connected"` → **treat as SUCCESS** even if `data.detached_at` is not a string. Resolve with `detachedAt: data.detached_at ?? new Date().toISOString()` (fall back to a client timestamp ONLY when the server omitted it — post-fix the server always sends it; this is the drift guard).
- Otherwise (no recognized success `status`, e.g. an unexpected body) → throw a descriptive error (`"detachBrandStripe: unexpected response shape"`) so a genuinely malformed/failure body still surfaces. The reported false-failure cannot recur because the server now always sends `status: "detached"`.

**Add `status` to `RawDetachResponse`** (it is currently untyped on the client): add `status?: "detached" | "not_connected" | string;` so the hardening logic compiles under TS strict. Keep `detached_at?`, `stripe_delete_status?`, `rejection_reason?` as already declared (lines 28-30).

**`stripe_delete_status` / `rejection_reason` mapping (already present, lines 49-50) becomes live** once the server emits the fields — no client change needed there beyond it now receiving real values. Keep the `?? "skipped"` / `?? null` fallbacks (harmless once the server is compliant; defense-in-depth otherwise).

**Result contract unchanged:** still returns `BrandStripeDetachResult { detachedAt, stripeDeleteStatus, rejectionReason }`. Error contract per Const #3 (throws on edge-fn error; never returns null) is preserved.

---

### 4.3 Component — `mingla-business/src/components/brand/BrandStripeDetachConfirmSheet.tsx`

**Current behavior (lines 83-100):** on `mutateAsync` resolve it calls `onDetached?.(brandId)` then `onClose()` — the sheet just dismisses, with NO visible "Disconnected" confirmation. On throw it returns to `confirm` step and renders the red `Couldn't disconnect: ${error.message}` banner. Today every successful detach throws → the user only ever sees the red banner.

**Required change — minimal, reuses the existing 2-step pattern + tokens (NO redesign, NO designer):**

Add a third step `"done"` to the existing `Step` union (`"confirm" | "submitting" | "done"`), mirroring the structure already in the file.

**Success path:** capture the resolved result and branch on its `stripeDeleteStatus`:
- `mutateAsync` returns `BrandStripeDetachResult`. Read it: `const result = await detachMutation.mutateAsync({ brandId });`
- **`stripeDeleteStatus === "rejected"`:** this is an HONEST partial outcome — local disconnect succeeded but Stripe rejected the account delete. Show the `"done"` step with a success-leaning header AND a one-line note carrying the real reason. Header: **"Disconnected"**. Body: **"Stripe is disconnected for {brandName}. Note: Stripe couldn't fully close the account ({rejectionReason}). Your payouts are still disconnected."** (If `rejectionReason` is null, drop the parenthetical.) This is NOT a red error — the disconnect DID happen; the note is informational (use `accent.warm`, the same warm token the "Reconnect requires KYC" card already uses, not `semantic.error`).
- **`stripeDeleteStatus === "succeeded"` or `"skipped"`:** show the `"done"` step with header **"Disconnected"** and body **"Stripe is disconnected for {brandName}."** Use `semantic.success` for the confirmation accent (e.g. a check icon — reuse `Icon name="check"` if it exists in the Icon set; otherwise the existing `"bank"` icon is acceptable — do not invent a new asset).
- The `"done"` step renders a single primary **"Done"** button that calls `onDetached?.(brandId)` then `onClose()`. (Move the existing `onDetached` + `onClose` calls from the immediate post-`mutateAsync` block into the "Done" button handler so the user sees the confirmation before the sheet dismisses.)

**Failure path (genuine throw — now only a true edge-fn error):** unchanged behavior — return to `confirm` step, render the existing red `submitError` banner (`Couldn't disconnect: ${error.message}`). This path is now reached ONLY on a real non-2xx / malformed body, which is correct.

**Copy + token constraints (keep consistent with the existing sheet):**
- Reuse `styles.title` for the "Disconnected" header, `styles.confirmHelper` for the body text, the existing `warnCard` pattern only if a note row is needed for the rejection case (reuse `styles.warnCardWarn` + `accent.warm` for the rejection note; reuse a success-tinted variant or `semantic.success` for the clean case).
- Add at most: one `Step` value, one `done`-step `View` block, and (if needed) one or two `StyleSheet` entries (`doneWrap`, `successAccent`) following the existing naming convention. No new dependencies, no new shared component.
- a11y: the "Done" button gets `accessibilityLabel="Done"`; the success header is plain `Text` (announced by default).

**Why the sheet IS touched (per dispatch's conditional allowlist):** the success affordance is needed — today success silently dismisses (and in practice never fires because of the bug). Without the `"done"` step, the honest "it succeeded" signal is invisible, and the rejection reason has nowhere to render. This is the minimal affordance, not a redesign.

---

## 5. Success criteria (observable, testable)

- **SC-1 (server, both surfaces via shared fn):** A successful detach 200 body contains `detached_at` as a non-empty ISO string, `status: "detached"`, and a `stripe_delete_status` of exactly one of `"succeeded"|"rejected"|"skipped"`.
- **SC-2 (server):** The `not_connected` 200 body contains `detached_at` as a string, `status: "not_connected"`, `stripe_delete_status: "skipped"`, `rejection_reason: null`.
- **SC-3 (server, mapping):** When the Stripe `accounts.del` block ran and threw, the 200 body carries `stripe_delete_status: "rejected"` and `rejection_reason` = the Stripe error message string. When it ran and succeeded, `"succeeded"`/`null`. When it was skipped (already detached), `"skipped"`/`null`.
- **SC-4 (server, preserved semantics):** The DB soft-delete UPDATE, `writeAudit` (with unchanged `after.stripe_delete_error`), `action` selection, and notification loop are byte-unchanged; the fn still returns 200 even when Stripe rejected (local-always-succeeds).
- **SC-5 (client, resolves on success):** `detachBrandStripe` RESOLVES (does not throw) for any 200 body with `status: "detached"` or `"not_connected"`, returning `{ detachedAt, stripeDeleteStatus, rejectionReason }` with the server's real values.
- **SC-6 (client, hardening — drift-proof):** `detachBrandStripe` RESOLVES even if a `status: "detached"` 200 body OMITS `detached_at` (falls back to a client timestamp). It THROWS only on a non-2xx `error`, a `null` body, or a body with no recognized success `status`.
- **SC-7-iOS / SC-7-Android (UX success):** After a successful disconnect, the sheet shows a "Disconnected" confirmation step (header "Disconnected" + body referencing the brand name) and a "Done" button; it does NOT show the red "Couldn't disconnect" banner. (Parity automatic — shared RN.)
- **SC-8-iOS / SC-8-Android (UX rejection honesty):** When `stripeDeleteStatus === "rejected"`, the "Disconnected" step additionally shows the real `rejectionReason` as an informational (warm, not error-red) note. (Parity automatic.)
- **SC-9 (no false failure):** There is no input under which a server-side-successful detach (200, `status: "detached"`) renders the red failure banner.

---

## 6. Invariants

### Preserved
- **"Always succeed locally even if Stripe rejects"** (service JSDoc lines 6-9; DEC-121 / B2a Path C V3 §6). Preserved: the fn still returns 200 on Stripe rejection; `stripe_delete_status` reports ONLY the Stripe outcome. Verified by SC-3 + SC-4 + the edge-fn regression test.
- **Const #3 (service throws on edge-fn error; never returns null).** Preserved: the `error` and `null`-body throws are unchanged; only the over-strict `detached_at` guard is relaxed to a status-aware success check. Verified by SC-6.
- **Audit + notification side effects** (no INVARIANT_REGISTRY entry, but a documented contract). Preserved: DO-NOT-TOUCH. Verified by the existing `index.test.ts` assertions (`writeAudit`, `dispatchNotification`, `detached_at` present, no hard delete) which must continue to pass.

### Established (DRAFT — orchestrator flips to ACTIVE on CLOSE)
- **I-PROPOSED-1140 (DRAFT):** *"Every 200 response from `brand-stripe-detach` MUST include `detached_at` as a string. The success path (`status: "detached"`) MUST additionally carry `stripe_delete_status` ∈ {`succeeded`,`rejected`,`skipped`}."* Enforcement: the fails-on-revert regression test in §9 (structural source assertion + client-wrapper behavioral test). A strict-grep companion may assert the success `return jsonResponse({` block contains `detached_at:` and `stripe_delete_status:`.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 | Success body carries `detached_at` | source of `index.ts` | success `return jsonResponse` block includes `detached_at:` and `stripe_delete_status:` | Edge (structural) |
| T-2 | Not-connected body carries `detached_at` | source of `index.ts` | `status: "not_connected"` body includes `detached_at:` | Edge (structural) |
| T-3 | Client resolves on success body | `{ ok, status:"detached", detached_at:"2026-…Z", stripe_delete_status:"succeeded", rejection_reason:null }`, `error:null` | resolves `{ detachedAt:"2026-…Z", stripeDeleteStatus:"succeeded", rejectionReason:null }` | Service |
| T-4 | Client maps a Stripe rejection | `{ status:"detached", detached_at:"…", stripe_delete_status:"rejected", rejection_reason:"balance_remaining" }` | resolves with `stripeDeleteStatus:"rejected"`, `rejectionReason:"balance_remaining"` | Service |
| T-5 | Client hardening — missing `detached_at` still resolves | `{ ok, status:"detached", stripe_delete_status:"succeeded" }` (no `detached_at`), `error:null` | RESOLVES (does not throw); `detachedAt` is a string (client fallback) | Service |
| T-6 | Client still throws on real error | `{ data:null, error: Error("boom") }` | throws | Service |
| T-7 | Client throws on unrecognized body | `{ data:{ ok:false }, error:null }` | throws ("unexpected response shape") | Service |
| T-8 | Not-connected resolves benignly | `{ ok, status:"not_connected", detached_at:"…", stripe_delete_status:"skipped", rejection_reason:null }` | resolves | Service |
| T-9 (tester) | UX: success shows "Disconnected", not red banner | live-fire detach on a connected test brand (Business iOS sim/device) | sheet shows "Disconnected" + "Done"; no red banner | Component / runtime |
| T-10 (tester) | UX: rejection shows real reason | detach a brand whose Stripe delete would reject (or mocked rejected result) | "Disconnected" step shows warm informational note with the reason | Component / runtime |

T-1..T-8 are the **implementor's happy-path + hardening** Step-0.5 deliverables. T-9/T-10 are left as the **tester's separate adversarial angle** (live-fire rejection-path + UX) — do not pre-build them.

---

## 8. Implementation order

1. **Edge fn** (`supabase/functions/brand-stripe-detach/index.ts`): capture `attemptedStripeDelete`, derive `stripeDeleteStatus` + `rejectionReason`, rewrite the success 200 body and the not-connected 200 body per §4.1. Leave audit/notification/error paths untouched.
2. **Service** (`brandStripeDetachService.ts`): add `status?` to `RawDetachResponse`; replace the strict `detached_at` guard with the status-aware success check + client-timestamp fallback per §4.2.
3. **Component** (`BrandStripeDetachConfirmSheet.tsx`): add the `"done"` step; capture the mutation result; branch on `stripeDeleteStatus`; move `onDetached`/`onClose` to the "Done" button per §4.3.
4. **Tests:** edge-fn structural assertions (T-1/T-2) appended to `supabase/functions/brand-stripe-detach/index.test.ts`; new Jest service test file for T-3..T-8.

---

## 9. Regression prevention (fails-on-revert contract)

**Structural safeguard A (edge, T-1/T-2):** Append to `supabase/functions/brand-stripe-detach/index.test.ts` (existing Deno source-assertion test) assertions that the source contains `detached_at:` inside a `status: "detached"` return AND a `status: "not_connected"` return, plus `stripe_delete_status:`. **Fails-on-revert:** reverting the edge-fn body removes `detached_at:`/`stripe_delete_status:` from the success return → assertion fails. **Passes-on-restore:** present → passes. Add a protective comment: `// ORCH-1140: every 200 body MUST carry detached_at (client guard) + stripe_delete_status (honest Stripe outcome). Do not remove.`

**Behavioral safeguard B (client, T-3 + T-5):** New Jest file `mingla-business/src/services/__tests__/brandStripeDetachService.orch1140.test.ts` (Jest + mocked `supabase.functions.invoke`, following the `brandStripeBalancesService.test.ts` pattern). It asserts the wrapper RESOLVES (does not throw) on a `status:"detached"` 200 body **with** `detached_at` (T-3) AND **without** `detached_at` (T-5, hardening). **Fails-on-revert:** restoring the old strict `typeof data.detached_at !== "string"` throw makes T-5 throw → test fails. **Passes-on-restore:** with the hardening, both resolve.

Both safeguards must FAIL when the fix is reverted and PASS when restored — this is the binding regression contract.

---

## 10. Open questions

- **OQ-1 (non-blocking — implementor may proceed):** the success affordance copy ("Disconnected" / "Stripe is disconnected for {brandName}.") is drafted to match the existing sheet voice. If Seth wants different wording it can be adjusted at CLOSE; it does NOT block IMPLEMENT.
- **OQ-2 (non-blocking):** the rejection-note color uses `accent.warm` (the existing KYC-warning token) to signal "informational, not a hard error." If Seth prefers `semantic.error` styling for the rejection note, swap the token — single-line change. Does not block IMPLEMENT.

No blocking open questions. The SPEC is buildable as written.

---

## 11. Downstream routing

- **Next = mingla-implementor (business side).** Inputs: this SPEC + the investigation. Build the edge-fn body change, the service hardening, the sheet `"done"` step, and the §9 tests. Run the gates; prove fails-on-revert on both §9 safeguards.
- **Then = mingla-tester.** Live-fire T-9/T-10 on Business iOS (sim + physical), plus the adversarial rejection-path mapping (T-4) and missing-field hardening (T-5/T-7). Verify no false-failure banner on a real connected-brand detach; verify the rejection reason renders honestly.
- **Then = mingla-orchestrator CLOSE.** Flip I-PROPOSED-1140 → ACTIVE. **CLOSE-time deploy/OTA steps (NOT implementor steps):**
  1. **Redeploy the edge fn from MERGED `main`** (clobber risk — per `feedback_edge_deploy_and_migration_apply_hazards`; deploy `brand-stripe-detach` from the merged anchor, never a stale worktree).
  2. **Ship the client (service + sheet) change to devices via a business-app OTA** (runtime 1.0.0, per-platform, per `reference_eas_cli_ota_publish_gotchas` — `npx -y eas-cli@latest update`, never `--platform all`). The edge-fn change alone clears the banner; the OTA delivers the success affordance + the live Stripe-outcome reporting.

**Working tree:** to be spawned by the orchestrator at `~/Desktop/mingla-orchs/ORCH-1140-[stripe-detach-contract]/` on branch `ORCH-1140-stripe-detach-contract` (no worktree exists yet; spawn at INTAKE, rebase onto `origin/main` before IMPLEMENT).

---

## Allowlist (implementor may modify ONLY these)
- `supabase/functions/brand-stripe-detach/index.ts`
- `supabase/functions/brand-stripe-detach/index.test.ts` (append assertions)
- `mingla-business/src/services/brandStripeDetachService.ts`
- `mingla-business/src/services/__tests__/brandStripeDetachService.orch1140.test.ts` (new)
- `mingla-business/src/components/brand/BrandStripeDetachConfirmSheet.tsx` (success affordance ONLY)

## DO-NOT-TOUCH
- `mingla-business/src/hooks/useBrandStripeDetach.ts` (no change needed; result already flows through `mutateAsync`).
- The `writeAudit` call + its `after` payload, the `action` selection, `getBrandPaymentManagerUserIds`, and the `dispatchNotification` loop in `index.ts`.
- All non-200 return paths in `index.ts` (405/401/400/403/500) and the auth/validation logic.
- Any migration / schema / RLS / `stripe_connect_accounts` table definition.
- Any consumer-app, buyer-web, or admin file.

The implementor must **stop-and-amend** (request a SPEC amendment) before touching anything outside the allowlist.
