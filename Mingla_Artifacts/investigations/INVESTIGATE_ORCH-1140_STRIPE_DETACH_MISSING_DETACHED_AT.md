# INVESTIGATE — ORCH-1140 — Stripe disconnect fails: "detachBrandStripe: missing detached_at in response"

- **ORCH-ID:** ORCH-1140
- **Phase:** INVESTIGATE (read-only)
- **Date:** 2026-06-15
- **Confidence:** PROVEN (root cause confirmed across all five layers, incl. live runtime log + DB read of the exact failing invocation)
- **Severity of root cause:** CONFIRMED ROOT CAUSE — but **cosmetic**: the detach SUCCEEDED server-side; the client only fails to recognize success.

---

## 1. Symptom

In the business app, Seth opened "Disconnect Stripe from Night Market 2?", typed the brand name exactly (confirm gate passed), tapped "Disconnect Stripe", and got a red error banner:

> **Couldn't disconnect: detachBrandStripe: missing detached_at in response**

Expected: the sheet closes, Stripe shows disconnected.
Actual: error banner; sheet returns to the confirm step. **But** Stripe is in fact disconnected server-side (proven below) — the UI lies.

---

## 2. Investigation manifest (every file read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `COMMS_LEDGER.md` | Mandatory entry read; check for BLOCK/WARN to forensics/ORCH-1140/ALL |
| 2 | `mingla-business/src/components/brand/BrandStripeDetachConfirmSheet.tsx` | UI that renders the banner (the `Couldn't disconnect: ${error.message}` string) |
| 3 | `mingla-business/src/hooks/useBrandStripeDetach.ts` | Mutation wrapper; error propagation |
| 4 | `mingla-business/src/services/brandStripeDetachService.ts` | Client wrapper that throws the exact message |
| 5 | `supabase/functions/brand-stripe-detach/index.ts` (source) | Every edge-fn return path |
| 6 | Deployed edge fn (MCP `get_edge_function`, version 187) | Source-vs-deploy drift check |
| 7 | `_shared/stripeEdgeAuth.ts` (`jsonResponse`) | Confirms all responses default to HTTP 200 |
| 8 | DB: `brands` ⋈ `stripe_connect_accounts` for "Night Market 2"; `audit_log` | Data layer — did the detach actually write? |
| 9 | MCP edge-function logs | Runtime — real status of the failing invocation |

**Comms ledger:** No `BLOCK`/`OPEN` row targets forensics, ORCH-1140, or `ALL`. The only open WARN is COMMS-0029 (trip-migration clobber, `biz_update_live_trip`) — unrelated to the Stripe detach flow. No ack required.

---

## 3. Q-Scorecard

**Q1 — Which edge-fn return path does the live failure hit?**
Verdict: The **success path** at `index.ts:106-110` (`{ ok: true, status: "detached", stripe_delete_error }`, HTTP 200). PROVEN via runtime log (200) + audit_log `detach_completed` row.

**Q2 — Is the failure (a) caught-exception-in-200, (b) renamed/mis-cased field, (c) auth/precondition 200-with-message, or (d) a masked real error?**
Verdict: **(b) — the success body simply omits `detached_at` entirely.** It is not renamed/mis-cased; the field is absent. Not (a)/(c)/(d). PROVEN.

**Q3 — Source vs deployed drift?**
Verdict: **No drift.** Deployed version 187 is byte-for-byte identical to `origin/main` source. PROVEN via `get_edge_function`.

**Q4 — Did the detach actually happen server-side?**
Verdict: **YES — fully.** `stripe_connect_accounts.detached_at` is set for Night Market 2; audit_log shows `stripe_connect.detach_completed` with `stripe_delete_error: null` (Stripe `accounts.del` also succeeded). PROVEN via DB read.

**Q5 — Regression pin: when was this introduced?**
Verdict: **Not a regression — latent since the feature shipped.** Both the edge fn and the client wrapper were created in the same and only commit `24a3458d8` ("Seth (#65)", 2026-05-07) and never modified since. The mismatch has existed since day one; it surfaced now because ORCH-0802 first wired a UI (`BrandStripeDetachConfirmSheet`) that actually invokes the path. PROVEN via `git log`.

**Q6 — Severity / user impact?**
Verdict: **Cosmetic response-shape bug on top of a SUCCESSFUL operation.** The brand IS disconnected; the user is told it failed and may retry (idempotent — second call hits `if (!row.detached_at)` false, skips Stripe, re-stamps `detached_at`, still returns the same `detached_at`-less 200 → same error banner forever). PROVEN.

---

## 4. Five-Truth-Layer reconciliation

| Layer | Finding |
|-------|---------|
| **Docs** | Service JSDoc (`brandStripeDetachService.ts:18-25`) defines `BrandStripeDetachResult.detachedAt: string` and `RawDetachResponse.detached_at?: string` as the contract. The SPEC lineage (B2a Path C V3 §6 / DEC-121) expects the fn to return the local soft-delete timestamp. **Docs say the response SHOULD carry `detached_at`.** |
| **Schema** | `stripe_connect_accounts.detached_at` exists and is the soft-delete column the fn writes (`index.ts:71`). Column name is correct and consistent with the client field name. |
| **Code** | **CONTRADICTION.** The edge fn writes `detached_at` to the DB (`index.ts:68-72`) but the success response body (`index.ts:106-110`) returns `{ ok, status, stripe_delete_error }` and **never includes `detached_at`**. The client (`service:44`) hard-requires `typeof data.detached_at === "string"`. Code ≠ Docs. **This gap IS the bug.** |
| **Runtime** | Edge log: `POST | 200 | brand-stripe-detach`, version 187, `execution_time_ms: 6239`, ts `1781531155199000` (2026-06-15 13:45:55 UTC). 200 status → `supabase.functions.invoke` sets `error = null` → client falls through to the `detached_at` check → throws. Surrounding `notify-dispatch` 200s at the same instant confirm the full happy path ran. |
| **Data** | `stripe_connect_accounts` for Night Market 2 (`77538e2f-…`): `detached_at = 2026-06-15 13:45:53.592+00`, `updated_at = 13:45:53.652+00`. `audit_log`: one `stripe_connect.detach_completed`, `before.detached_at: null`, `after.detached_at: 2026-06-15T13:45:52.886Z`, `stripe_delete_error: null`. **The detach is committed and complete.** |

**The load-bearing contradiction is Code-vs-Docs at the edge-fn response shape:** the DB write happens, the response field doesn't.

---

## 5. Enumerated edge-fn return-path table (`supabase/functions/brand-stripe-detach/index.ts`)

`jsonResponse(body, status=200)` (`_shared/stripeEdgeAuth.ts`) defaults status to **200** unless an explicit status is passed.

| Line(s) | Condition | HTTP status | Body | Has string `detached_at`? |
|---------|-----------|-------------|------|---------------------------|
| 17 | OPTIONS preflight | 200 | "ok" (text) | No |
| 18 | non-POST | 405 | `{ error: "method_not_allowed" }` | No |
| 20-21 | `requireUserId` fail (no/invalid bearer) | 401 | `{ error: "unauthenticated" }` | No |
| 28 | invalid JSON body | 400 | `{ error: "validation_error", detail: "invalid_json" }` | No |
| 32 | brand_id not a UUID | 400 | `{ error: "validation_error", detail: "brand_id_invalid_uuid" }` | No |
| 36-37 | `requirePaymentsManager` → RPC error | 500 | `{ error: "internal_error" }` | No |
| 36-37 | `requirePaymentsManager` → not permitted | 403 | `{ error: "forbidden", detail: "permission_denied" }` | No |
| 44-47 | `stripe_connect_accounts` read error | 500 | `{ error: "internal_error" }` | No |
| 48-50 | no row (brand never connected) | **200** | `{ ok: true, status: "not_connected" }` | **No** |
| 73-76 | local soft-detach UPDATE error | 500 | `{ error: "internal_error", detail: "local_detach_failed" }` | No |
| **106-110** | **SUCCESS (the live path)** | **200** | **`{ ok: true, status: "detached", stripe_delete_error }`** | **No ← ROOT CAUSE** |

**Two distinct 200 paths return no `detached_at`:** the success path (line 106) AND the not-connected path (line 49). The live failure hits **line 106**. The not-connected path (line 49) would throw the **same** client error if a brand without a connected account were ever submitted (latent secondary bug — see Blast Radius).

---

## 6. Findings (six-field evidence)

### F-1 — Success response omits `detached_at` (CONFIRMED ROOT CAUSE)

1. **Symptom:** Red banner "Couldn't disconnect: detachBrandStripe: missing detached_at in response" after a tap that actually disconnected Stripe.
2. **Layer:** Code (edge-fn response shape) vs Docs (declared response contract).
3. **Probe:** Read `index.ts:106-110` + `service.ts:44-46`; `mcp__supabase__get_edge_function brand-stripe-detach` (verify deploy == source); `mcp__supabase__get_logs edge-function` (status of the invocation).
4. **Evidence:**
   - Edge fn success path (verbatim): `return jsonResponse({ ok: true, status: "detached", stripe_delete_error: stripeDeleteError });` — **no `detached_at` key.**
   - `detachedAt` IS computed (`index.ts:68 const detachedAt = new Date().toISOString();`) and written to DB + audit, but never placed in the response.
   - Client (verbatim): `if (typeof data.detached_at !== "string") { throw new Error("detachBrandStripe: missing detached_at in response"); }` (`service.ts:44-45`).
   - Deployed version 187 success path identical to source (byte-for-byte via `get_edge_function`).
   - Runtime log: `POST | 200 | .../brand-stripe-detach` version 187 — 200 means `invoke` returns `error: null`, so the client reaches the throw.
5. **Mechanism:** Edge fn computes the timestamp, writes it to the DB, but returns a 200 body lacking `detached_at`. `supabase.functions.invoke` only populates `error` on non-2xx, so a 200-with-incomplete-body yields `{ data: {ok,status,stripe_delete_error}, error: null }`; the client's strict `detached_at` guard throws → the sheet surfaces it as a failure banner.
6. **Severity:** CONFIRMED ROOT CAUSE (cosmetic — operation succeeded).

### F-2 — The reported failure is on a SUCCESSFUL detach (CONFIRMED — severity-defining)

1. **Symptom:** UI reports failure; Stripe is actually disconnected.
2. **Layer:** Data + Runtime.
3. **Probe:** `mcp__supabase__execute_sql` on `brands ⋈ stripe_connect_accounts` for "Night Market 2"; on `audit_log` for `stripe_connect.detach%`.
4. **Evidence:**
   - `stripe_connect_accounts`: brand `77538e2f-b66c-4a73-826e-3b9c168a5cc0` (Night Market 2), `stripe_account_id: acct_1Tiap6PjlZrNZNCV`, `detached_at: 2026-06-15 13:45:53.592+00`, `updated_at: 13:45:53.652+00`.
   - `audit_log`: `action: stripe_connect.detach_completed`, `target_id: acct_1Tiap6PjlZrNZNCV`, `before: {detached_at: null}`, `after: {detached_at: 2026-06-15T13:45:52.886Z, stripe_delete_error: null}`, ts `13:45:53`.
   - `stripe_delete_error: null` ⇒ Stripe `accounts.del` also succeeded (the connected account was deleted at Stripe, not just locally).
5. **Mechanism:** All side effects (DB soft-delete, Stripe account delete, audit write, manager notifications) completed before the 200 returned; only the client's success recognition failed.
6. **Severity:** CONFIRMED — this is what makes the bug cosmetic rather than functional, and it materially lowers urgency while RAISING the "UI lies to the user" concern.

### F-3 — Not-connected 200 path (line 49) shares the same client-throw flaw (SUSPECTED CONTRIBUTOR / latent)

1. **Symptom:** None observed today; latent.
2. **Layer:** Code.
3. **Probe:** Read `index.ts:48-50`.
4. **Evidence:** `if (!row) { return jsonResponse({ ok: true, status: "not_connected" }); }` — 200, no `detached_at`. Client would throw the identical "missing detached_at" error.
5. **Mechanism:** Any future caller invoking detach on a brand with no `stripe_connect_accounts` row gets a "success" 200 the client misreads as an error.
6. **Severity:** SUSPECTED CONTRIBUTOR (latent; same fix family).

### F-4 — Idempotent retry does NOT recover (SUSPECTED CONTRIBUTOR)

1. **Symptom:** Re-tapping "Disconnect Stripe" reproduces the same banner forever.
2. **Layer:** Code.
3. **Probe:** Read `index.ts:54-66, 106-110`.
4. **Evidence:** On retry `row.detached_at` is now set, so the `if (!row.detached_at)` Stripe-delete block is skipped, but line 68-72 re-stamps `detached_at` and line 106 still returns no `detached_at` ⇒ same 200, same client throw.
5. **Mechanism:** The bug is in the response shape, not the operation, so retries can't clear it.
6. **Severity:** SUSPECTED CONTRIBUTOR (worsens UX — no self-heal).

---

## 6b. Static-analysis flags noted in passing (NOT root cause)
- `service.ts:36` generic `supabase.functions.invoke<RawDetachResponse>` trusts the shape but at least guards it (good). The guard is correct; the SERVER is non-compliant with the declared contract.
- `index.ts:57` `// @ts-ignore` on `stripe.accounts.del` — runtime-provided namespace; pre-existing, not relevant.
- No silent `catch {}` masking here: the Stripe-delete catch (`index.ts:62-65`) intentionally swallows into `stripeDeleteError` per the documented "always succeed locally" contract — correct by design.

---

## 7. Repro evidence

Live runtime + data repro (no sim needed — this is a backend response-shape bug, exempt from sim live-fire per Prime Directive 7):
- **Runtime:** edge log `POST | 200 | brand-stripe-detach` v187 at 2026-06-15 13:45:55 UTC, exec 6239 ms.
- **Data:** `detached_at` stamped on Night Market 2; `audit_log.detach_completed` with `stripe_delete_error: null`.
- **Code trace:** 200 ⇒ `invoke` `error=null` ⇒ client guard `typeof data.detached_at !== "string"` true (field absent) ⇒ throw ⇒ `BrandStripeDetachConfirmSheet:96` renders `Couldn't disconnect: ${error.message}`.

This is a deterministic, 100%-reproducible bug: every successful detach throws this exact banner.

---

## 8. Blast radius / cross-surface map

**Edge fn `brand-stripe-detach` consumers (grep):** the ONLY client path is `brandStripeDetachService.detachBrandStripe` → `useBrandStripeDetach` → `BrandStripeDetachConfirmSheet`. Single call chain, business app only.

| Surface | Covered | Behavior |
|---------|---------|----------|
| 1. Consumer iOS | Not affected | Consumer app has no detach UI. |
| 2. Consumer Android | Not affected | — |
| 3. Buyer/anon Web | Not affected | — |
| 4. Business iOS | **AFFECTED** | Every detach shows the false-failure banner. |
| 5. Business Android | **AFFECTED** | Same shared RN code path (`BrandStripeDetachConfirmSheet`) — automatic parity, same bug. |
| 6. Admin Web | Not affected | No admin detach path found. |
| 7. Business Web preview | **AFFECTED if reachable** | Shared RN component; same bug if the sheet renders on web. |

Blast is contained to the single business-app detach flow on iOS + Android (shared code ⇒ both fail identically).

---

## 9. Invariant impact

- **No INVARIANT_REGISTRY entry is violated** by the proposed fix family (add a field to a 200 response). The fix must preserve the documented "always succeed locally even if Stripe rejects" contract (`stripeDeleteStatus` semantics) — note the client already maps `stripe_delete_status` / `rejection_reason` (`service.ts:49-50`) but the **edge fn returns `stripe_delete_error` (a string|null), NOT `stripe_delete_status`/`rejection_reason`** — a SECOND latent shape mismatch: the client's `stripeDeleteStatus` will always fall back to `"skipped"` and `rejectionReason` to `null` regardless of the real Stripe outcome. Flag for the SPEC; do not pre-decide.
- Audit/notification side effects are correct and must not be touched.

---

## 10. Discoveries for Orchestrator (side issues — do NOT widen scope here)

- **D-1 (same family):** Field-name mismatch between edge response (`stripe_delete_error`) and client expectation (`stripe_delete_status` + `rejection_reason`). The client's Stripe-outcome reporting is dead — always `"skipped"` / `null`. A complete fix should reconcile BOTH the `detached_at` omission AND this status/reason shape, or the detach sheet will never report a Stripe-side rejection. (Severity: SECONDARY — degrades partial-failure UX; not the reported symptom.)
- **D-2 (latent):** not-connected 200 path (line 49) throws the same client error; relevant only if detach is ever invoked on an unconnected brand.
- **D-3 (deploy hygiene):** deployed v187 == source — no drift this time, but note the edge fn was NOT redeployed when ORCH-0802 wired the UI; the latent bug only became reachable then.

---

## 11. Recommended fix DIRECTION (direction only — NOT code, NOT a spec)

**Narrowest fix:** make the edge fn's success response (and ideally the `not_connected` response) include the `detached_at` string it already computes/holds, so the client's existing guard passes. One-field addition to the 200 body; redeploy the edge fn from merged main. This alone clears the reported banner with zero client change.

**Structural fix (recommended for the SPEC to weigh):** reconcile the FULL response contract between `brand-stripe-detach/index.ts` and `RawDetachResponse` in `brandStripeDetachService.ts` — emit `detached_at`, plus a coherent Stripe-outcome shape (`stripe_delete_status: "succeeded"|"rejected"|"skipped"` + `rejection_reason`) that the client already expects, derived from `stripeDeleteError`/whether the delete block ran. Add a contract regression guard (e.g. a test asserting the success body carries `detached_at`, fails-on-revert) so the omission can't recur. Consider a one-line client hardening: treat `status === "detached"`/`"not_connected"` 200s as success even absent `detached_at`, so the UI never again reports a successful detach as a failure.

**Severity framing for prioritization:** P2-cosmetic on function (detach works), but P1-trust on UX (the app tells the user a destructive, KYC-to-reverse action FAILED when it succeeded — risking duplicate attempts and support confusion). The fix is small and low-risk (additive response field).

---

## 12. Recommended next phase

SPEC (narrow). Scope: reconcile `brand-stripe-detach` success/`not_connected` response shape with `brandStripeDetachService.RawDetachResponse` (`detached_at` + Stripe-outcome fields), add a fails-on-revert contract test, redeploy edge fn from merged main, no migration, no schema change. Business iOS+Android parity is automatic (shared RN). No designer needed (no UI change required; optional copy unaffected).
