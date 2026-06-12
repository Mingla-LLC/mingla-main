# SPEC — ORCH-1116: Public paid-event booking gate false-positive (booking-gate-RLS)

**Status:** SPEC complete — ready for IMPLEMENT dispatch.
**Phase owner:** mingla-forensics (SPEC) → mingla-implementor (build) → mingla-tester (verify) → orchestrator (CLOSE).
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1116-[booking-gate-rls]/` on branch `ORCH-1116-booking-gate-rls` (rebased on origin/main).
**Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1116_BOOKING_GATE_FALSE_POSITIVE.md` (root cause `proven`, live DB evidence).
**Project ref:** `gqnoajqerqhnvulmnyvv`.
**Comms factored:** COMMS-0021 (WARN — provider-neutral `brandPayout.ts` readiness helper exists brand-side; the buyer-side raw predicate is what's broken here, no copy collision); COMMS-0022 (FYI/RESOLVED — "Leggo This" is the real prod brand in the repro). No BLOCK entries target forensics or ORCH-1116.

---

## 1. Executive summary

A logged-out (or non-owner logged-in) buyer who opens a public paid event/experience/trip page sees **"Booking unavailable right now — This organizer is finishing their payment setup"** with a dead Get-Tickets CTA, even when the brand is fully Stripe-active and *can* charge. This is a revenue-blocking false positive.

The cause (proven): the shared readiness predicate `pg_brand_can_charge(uuid)` is `SECURITY INVOKER` and reads the RLS-protected `stripe_connect_accounts` table, whose only SELECT-capable RLS policy is scoped to `{authenticated}` brand-payments-admins. When a buyer (anon, or authenticated-but-not-this-brand's-payments-admin) calls the RPC, RLS hides the row → the inner `EXISTS` sees 0 rows → the function returns `false` for a brand that demonstrably can charge. The batched sibling `pg_brands_can_charge(uuid[])` inherits the same defect because it calls `pg_brand_can_charge` per element under the same caller context. Publish-time RPCs disagree (publish was allowed) only because they are `SECURITY DEFINER` — they read the row under elevated privilege.

**The fix:** convert both readiness predicates to `SECURITY DEFINER` with a locked, schema-qualified `search_path`, returning ONLY the boolean (no row data ever crosses to the caller). This matches the existing publish-side and deck-RPC `SECURITY DEFINER` pattern that the ORCH-1076 migration comment already *believed* these functions mirrored. A behavioral regression test that executes the RPCs under `SET ROLE anon` (not merely an EXECUTE-grant check) locks it fails-on-revert, closing the exact CI gap that let this ship green.

This is a single-migration, backend-only fix. All affected buyer surfaces (web event, web brand feed, web experience, consumer-app brand page) read the same shared predicate, so they inherit the fix with zero client edits.

---

## 2. Scope & non-goals

### In scope
- Convert `public.pg_brand_can_charge(uuid)` from `SECURITY INVOKER` → `SECURITY DEFINER` with `SET search_path = ''` (every identifier schema-qualified), body returning only the boolean.
- Convert `public.pg_brands_can_charge(uuid[])` to `SECURITY DEFINER` with the same locked `search_path` (it must read the table under elevated privilege in its own right, not merely delegate — see §4.1 rationale).
- One new migration carrying both `CREATE OR REPLACE FUNCTION` re-emissions + re-asserted grants + corrected comments.
- One new behavioral regression test (`.test.sql`) that exercises the anon role and asserts the RETURN VALUE.
- One new strict-grep gate asserting both predicates are `SECURITY DEFINER` in their latest defining migration (fails-on-revert at the text layer).
- Correct the load-bearing-wrong comment in `20260917000000_…sql` is **NOT** edited (historical migration is immutable); instead the new migration's comments state the correct security posture (D-2 addressed forward, not by rewriting applied history).

### Non-goals (explicitly NOT in this ORCH)
- **No new buyer-readable RLS policy on `stripe_connect_accounts`.** DISPREFERRED and rejected (§4.1) — it would expose Stripe-account rows to anon, a far larger attack surface than the boolean it would unlock.
- **No change to the five buyer-supply RPCs** (`pg_eligible_experiences_for_deck`, `pg_brand_experiences_for_place`, `pg_public_experiences_by_brand`, `pg_public_brand_upcoming`, `pg_public_trips_by_brand`). They are already `SECURITY DEFINER`; their nested call to `pg_brand_can_charge` already runs under DEFINER privilege and is unaffected. Converting the inner predicate to DEFINER does not change their behavior (DEFINER calling DEFINER is still elevated).
- **No client/edge code changes.** No edits to `publicEventsService.ts`, `publicExperienceService.ts`, `useBrandBySlug.ts`, `discover-merged-events`, or `ticket-checkout-create`. The fix is entirely in the shared predicate.
- **No change to the checkout 409 path** — proven SAFE (§6, D-3): `ticket-checkout-create` uses a service-role client calling the `SECURITY DEFINER` session RPC `biz_ticket_checkout_create_session`, which reads `stripe_connect_accounts.charges_enabled` directly under elevated privilege; it never calls `pg_brand_can_charge` under a buyer JWT.
- **No widening of the predicate's truth.** The function's boolean logic is byte-identical to today (`EXISTS attached row with non-null stripe_account_id AND charges_enabled IS DISTINCT FROM false`). Only the security mode + search_path change.
- **No app OTA / TestFlight in this ORCH.** Backend migration only; the orchestrator decides release. (App surfaces inherit the fix the moment the migration applies — no bundle change needed.)

### Assumptions
- The function owner is `postgres` (confirmed live: `pg_proc … owner postgres`). `SECURITY DEFINER` therefore executes as `postgres`, which is RLS-exempt on `public.stripe_connect_accounts` (table owned by `postgres`, no `FORCE ROW LEVEL SECURITY` on it — only `partner_stripe_connect_accounts` is FORCE'd). This is the same privilege the publish RPCs already rely on.
- Existing `GRANT EXECUTE … TO anon, authenticated, service_role` stays; `SECURITY DEFINER` does not change who may CALL, only the privilege the body runs under.

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior demanded | Files touched here | Parity |
|---|---------|---------|--------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/` iOS) | YES (inherits) | Brand page: paid events from a ready brand no longer dropped from the flat-events feed for a logged-in buyer who isn't the owner. | none (shared predicate) | Automatic (shared RPC) |
| 2 | Consumer Android (`app-mobile/` Android) | YES (inherits) | Same as iOS. | none | Automatic (shared RPC) |
| 3 | Buyer/anonymous Web (`mingla-business/` `/e/{brand}/{event}`, `/b/{brand}`, `/t/...`, experience pages) | YES (primary repro) | Public event/experience/trip page: ready brand shows Get-Tickets/Book CTA, not the "finishing payment setup" banner; brand feed shows paid events. | none (shared predicate) | Automatic (shared RPC) |
| 4 | Business iOS | NOT COVERED | N/A — business/owner reads go through DEFINER publish RPCs + the client `BrandStripeStatus` store, never the buyer predicate. Owner already saw correct state. | none | N/A |
| 5 | Business Android | NOT COVERED | Same as Business iOS. | none | N/A |
| 6 | Admin Web (`mingla-admin/`, adjacent) | NOT COVERED | N/A — admin does not read the buyer readiness predicate. | none | N/A |
| 7 | Business Web preview (adjacent) | NOT COVERED | N/A — owner-context preview reads the client store, not the buyer predicate. | none | N/A |

All three covered surfaces are covered by the SAME single shared-predicate change; parity is automatic because no client code is duplicated — the only point of repair is the function in the DB.

---

## 4. Layered specification

This is a **database-only** fix. No edge / service / hook / component / realtime layers change.

### 4.1 Chosen approach + rationale (why DEFINER, why not RLS-policy)

**Chosen: `SECURITY DEFINER` + `SET search_path = ''` (fully schema-qualified), returning only the boolean.**

Why this is the correct option among the investigation's §8 three:

1. **It matches the established pattern.** Every publish guard (`business_publish_event_draft`, `biz_publish_experience`, `business_publish_trip_draft`, `biz_update_live_*`, `business_patch_event_when`) and every buyer-supply RPC (`pg_eligible_experiences_for_deck`, etc.) that already calls `pg_brand_can_charge` is `SECURITY DEFINER`. The ORCH-1076 migration comment explicitly (and wrongly) claimed `pg_brand_can_charge` "mirrors the anon-safe posture of the SECURITY-DEFINER supply RPCs." This change makes the comment true. One predicate, one security posture, no surface can disagree.

2. **It leaks zero row data.** The function's RETURNS type is `boolean` (and the batched one is `TABLE(brand_id uuid)` — it returns only brand-ids the *caller already supplied*, never a `stripe_connect_accounts` field). `SECURITY DEFINER` changes the privilege the body executes under; it does not change the function's return shape. No `stripe_account_id`, `charges_enabled`, `payouts_enabled`, or any other column value is ever returned to or inferable beyond the single yes/no the caller passed a `brand_id` to ask about. The caller learns exactly one bit ("can this brand charge?") — which is the bit the public Get-Tickets CTA already encodes and which a buyer is entitled to know.

3. **It does not weaken the true-negative.** The body's boolean logic is unchanged (`EXISTS(… attached, non-null stripe_account_id, charges_enabled IS DISTINCT FROM false)`). A genuinely not-ready brand (no attached account, or `charges_enabled=false`) still yields `false` under DEFINER exactly as it did under superuser. DEFINER only fixes the *false-negative for ready brands* caused by RLS hiding the row from buyers; it cannot turn a not-ready brand ready.

4. **`SET search_path = ''` is the SECURITY DEFINER hardening requirement.** A `SECURITY DEFINER` function with a mutable `search_path` is a privilege-escalation vector (a caller could shadow `stripe_connect_accounts` with a temp object). Setting `search_path = ''` and schema-qualifying every identifier (`public.stripe_connect_accounts`, `pg_catalog.unnest`) closes that vector. (The existing supply RPCs use `SET search_path = public, pg_temp` / `'public','pg_temp'`; `''` is strictly safer and is the modern recommendation — we use `''` + full qualification here. This is intentional and documented in the migration comment.)

**Rejected — narrow buyer-readable RLS policy on `stripe_connect_accounts`** (investigation §8 option 2): to make `SECURITY INVOKER` work, anon/authenticated buyers would need a SELECT policy on `stripe_connect_accounts`. Even a column-restricted policy exposes the existence and selected fields of Stripe-account rows to the entire anonymous internet — a materially larger attack surface than the single boolean, and it would couple every future column added to that table to a re-audit of buyer exposure. DISPREFERRED by the orchestrator's lead and rejected here.

**Rejected — buyer-safe readiness column/view** (investigation §8 option 3): would require a trigger-maintained denormalized boolean on `brands` (cache drift risk — exactly the `brands.stripe_charges_enabled` cache the ORCH-1075 design deliberately avoided reading) or a new security-definer view (more surface, same DEFINER decision, no benefit over fixing the function in place). Rejected as strictly worse than fixing the existing single predicate.

### 4.2 Database — exact function DDL contract

**Migration file:** `supabase/migrations/20260927000000_orch_1116_booking_gate_rls.sql`
(version `20260927000000` — strictly greater than the current max across anchor `main` + all sibling worktrees, which is `20260926000000_orch_1111_oauth_null_email_accept.sql`; re-confirm with a fresh scan at IMPLEMENT per §8 step 1.)

The migration wraps both re-emissions in a single `BEGIN; … COMMIT;`.

**Function A — `pg_brand_can_charge(uuid)`** (the predicate). Contract:

| Property | Value |
|----------|-------|
| Signature | `public.pg_brand_can_charge(p_brand_id uuid)` (UNCHANGED — no DROP needed) |
| Returns | `boolean` (UNCHANGED) |
| Language | `sql` (UNCHANGED) |
| Volatility | `STABLE` (UNCHANGED) |
| Security | **`SECURITY DEFINER`** (CHANGED from INVOKER — the fix) |
| search_path | **`SET search_path = ''`** (NEW — DEFINER hardening) |
| Body | byte-identical boolean logic, every identifier schema-qualified |
| Grants (re-asserted) | `GRANT EXECUTE … TO anon, authenticated` (preserve existing; service_role already has it implicitly) |
| Comment | corrected: states it is SECURITY DEFINER, returns only a boolean, reads `public.stripe_connect_accounts` under definer privilege so buyers get the correct answer without row exposure |

Body shape (≤ contract illustration, not full file):
```sql
CREATE OR REPLACE FUNCTION public.pg_brand_can_charge(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.stripe_connect_accounts s
     WHERE s.brand_id = p_brand_id
       AND s.detached_at IS NULL
       AND s.stripe_account_id IS NOT NULL
       AND s.charges_enabled IS DISTINCT FROM false
  );
$function$;
```
Note the `$function$` dollar-tag (not `$$`) so the `GRANT` statements that follow parse cleanly per the safe-migration protocol (§8). The `IS DISTINCT FROM false` predicate is preserved verbatim (true only).

**Function B — `pg_brands_can_charge(uuid[])`** (the batched resolver). Contract:

| Property | Value |
|----------|-------|
| Signature | `public.pg_brands_can_charge(p_brand_ids uuid[])` (UNCHANGED) |
| Returns | `TABLE (brand_id uuid)` (UNCHANGED — no RETURNS-signature widening, so **no DROP required**) |
| Language | `sql` (UNCHANGED) |
| Volatility | `STABLE` (UNCHANGED) |
| Security | **`SECURITY DEFINER`** (CHANGED — the fix) |
| search_path | **`SET search_path = ''`** (NEW) |
| Body | inlines the EXISTS predicate directly (does NOT depend on the inner function's privilege) — see rationale |
| Grants (re-asserted) | `GRANT EXECUTE … TO anon, authenticated, service_role` (preserve existing) |

Body shape:
```sql
CREATE OR REPLACE FUNCTION public.pg_brands_can_charge(p_brand_ids uuid[])
RETURNS TABLE (brand_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT bid
  FROM pg_catalog.unnest(p_brand_ids) AS bid
  WHERE public.pg_brand_can_charge(bid);
$function$;
```

**Rationale for `pg_brands_can_charge` also being DEFINER (not relying on the inner DEFINER):** once `pg_brand_can_charge` is `SECURITY DEFINER`, the batched function would in principle work even if it stayed INVOKER, because the inner call re-elevates. However, making the batched function DEFINER too is required for defense-in-depth and correctness-independence: (a) it removes the hidden dependency where the batched resolver's correctness silently relies on the inner function's security mode — a future "optimization" that inlines the predicate into `pg_brands_can_charge` would re-introduce the INVOKER+RLS bug invisibly; (b) the strict-grep gate (§9) asserts BOTH are DEFINER, so both must carry the clause; (c) it is the same one-bit-only return (the subset of supplied brand-ids), no extra exposure. We keep the body delegating to `public.pg_brand_can_charge(bid)` for single-source-of-truth on the predicate logic, but the outer DEFINER + `unnest` qualified to `pg_catalog.unnest` guarantees it reads correctly under any caller regardless of the inner mode.

### 4.3 Migration header requirements

The migration's top comment block MUST:
- State the ORCH-ID, the proven root cause (one line), and that the ONLY change is `INVOKER → DEFINER` + `SET search_path = ''` (boolean logic byte-identical).
- Cite the monotonic-version reasoning (max scanned prefix + the new prefix).
- Explicitly correct the D-2 misconception: note that the prior `20260917000000` comment wrongly called the function "anon-safe / mirrors the SECURITY-DEFINER supply RPCs" while it was actually INVOKER, and that THIS migration makes that posture true.
- Note that no DROP is needed (no signature/RETURNS change) and that `CREATE OR REPLACE` is idempotent + safe to re-run.
- Note `DO NOT run supabase db push from the implementor` — the orchestrator applies via the Management API after review (CLI is drift-wedged per memory; MCP `apply_migration` or Management API is the apply path).

---

## 5. Success criteria (binding, testable)

All criteria are DB-observable and map directly to the regression test (§7, §9).

- **SC-1 (anon true-positive):** `SET ROLE anon; SELECT public.pg_brand_can_charge('<ready brand id>')` returns **`true`** (where the brand has an attached `stripe_connect_accounts` row, `detached_at IS NULL`, non-null `stripe_account_id`, `charges_enabled = true`). *(Before fix: returns `false`.)*
- **SC-2 (anon true-negative preserved):** `SET ROLE anon; SELECT public.pg_brand_can_charge('<not-ready brand id>')` returns **`false`** (brand with no attached account, or `charges_enabled = false`). *(Must NOT regress to a permissive `true`.)*
- **SC-3 (authenticated non-owner true-positive):** `SET ROLE authenticated` with a JWT/`request.jwt.claims` for a user who is NOT the brand's payments-admin → `pg_brand_can_charge('<ready brand id>')` returns **`true`**.
- **SC-4 (batched, anon):** `SET ROLE anon; SELECT brand_id FROM public.pg_brands_can_charge(ARRAY['<ready>','<not-ready>']::uuid[])` returns exactly the **`<ready>`** id and NOT the `<not-ready>` id.
- **SC-5 (no row leak):** As anon, no `stripe_connect_accounts` column value (`stripe_account_id`, `charges_enabled`, `payouts_enabled`, `created_at`, …) becomes selectable as a side effect. Verified by asserting `SET ROLE anon; SELECT count(*) FROM public.stripe_connect_accounts WHERE brand_id = '<ready>'` still returns **`0`** (RLS on the base table is untouched), AND the function's RETURNS type remains `boolean` / `TABLE(brand_id uuid)` (no field widening).
- **SC-6 (security mode):** `SELECT prosecdef FROM pg_proc WHERE proname='pg_brand_can_charge'` = **`true`** and same for `pg_brands_can_charge` = **`true`** (both DEFINER). `proconfig` contains `search_path=` for both.
- **SC-7 (supply RPCs unchanged):** the five buyer-supply RPCs still return the correct gated rows for a ready vs not-ready brand (no regression in the nested-call path) — i.e. the existing ORCH-1076 behavioral test still passes.
- **SC-8 (Leggo This live):** post-apply, `SET ROLE anon; SELECT public.pg_brand_can_charge('22a18413-bfbf-4087-9ba7-45f70deba0f3')` returns **`true`** (the reported brand), and the `/e/leggothis/the-party-block` public page shows the Get-Tickets CTA (tester live-fire, web).

---

## 6. Verified blast radius (resolves D-3)

The investigation's D-3 ("are the checkout-409 path and the consumer-app detail screens affected?") is **resolved with read-the-code evidence** below.

### AFFECTED — fixed by this shared-predicate change (read the same fixed function)
| Surface | Call site | Client auth context (verified) | Why affected | Fix |
|---|---|---|---|---|
| Buyer/anon web — event page | `mingla-business/src/services/publicEventsService.ts:919` (`resolveEventBookable`) → `.rpc("pg_brand_can_charge")` | imports `./supabase` (anon/buyer JS client) | INVOKER under anon → false | inherits DEFINER fix |
| Buyer/anon web — brand event feed | `publicEventsService.ts:933` (`fetchReadyBrandIds`) → `.rpc("pg_brands_can_charge")` | same anon/buyer client | INVOKER batched under anon → empty set → paid rows fail-closed | inherits DEFINER fix |
| Buyer/anon web — experience page | `mingla-business/src/services/publicExperienceService.ts:173` (`resolveBookable`) → `.rpc("pg_brand_can_charge")` | same anon/buyer client | INVOKER under anon → false | inherits DEFINER fix |
| Consumer app — brand page feed | `app-mobile/src/hooks/useBrandBySlug.ts:365` → `.rpc("pg_brands_can_charge")` | imports `../services/supabase` (**buyer JWT** session client) | INVOKER batched under buyer JWT → empty set → paid events dropped from the feed | inherits DEFINER fix |

### NOT AFFECTED — service-role or DEFINER (RLS bypassed; verified)
| Surface | Call site | Evidence it is safe |
|---|---|---|
| Consumer discover/swipe feed | `supabase/functions/discover-merged-events/index.ts:459` (`pg_brands_can_charge`) | line 285/289: client built with `SUPABASE_SERVICE_ROLE_KEY` → RLS bypass. Safe today; still safe after (DEFINER is a no-op for service-role). |
| **Checkout 409** (`ticket-checkout-create`) — **D-3 keystone** | `supabase/functions/ticket-checkout-create/index.ts:808-812` (`stripe_account_not_ready` 409) | The 409 is derived from `session.stripeAccountId`, which comes from `biz_ticket_checkout_create_session` (line 489) — a **`SECURITY DEFINER`** RPC (`20260915000000_…sql:211`) called by a **service-role** client (`serviceClient()` at line 274, `_shared/ticketCheckout.ts:18`). It reads `stripe_connect_accounts.charges_enabled` / `stripe_account_id` **directly under elevated privilege** (`20260915000000_…sql:319,529`). It NEVER calls `pg_brand_can_charge` under a buyer JWT. **Checkout is SAFE and independent of this defect.** It would (correctly) ALLOW Leggo's checkout — the banner was the only thing wrongly blocking the buyer. |
| Consumer app — event/trip/experience **detail** screens | `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` + deck supply | **No direct `pg_brand_can_charge` / `pg_brands_can_charge` call exists in any consumer detail screen** (grep-verified). Their supply arrives via the DEFINER deck/supply RPCs (`pg_eligible_experiences_for_deck` etc., already gated under DEFINER) or via the brand-page hook above. The `bookable*` symbols in `ExpandedBusinessEventSheet.tsx` are occurrence/capacity logic (ORCH-1072), not Stripe readiness. |
| Publish-time guards | `business_publish_event_draft` / `biz_publish_experience` / `business_publish_trip_draft` / `biz_update_live_*` / `business_patch_event_when` (all DEFINER) | call `pg_brand_can_charge` under DEFINER → already correct; unchanged. After the fix, DEFINER-calls-DEFINER is still elevated → no behavior change. |
| The five buyer-supply RPCs | `pg_eligible_experiences_for_deck` / `pg_brand_experiences_for_place` / `pg_public_experiences_by_brand` / `pg_public_brand_upcoming` / `pg_public_trips_by_brand` (all DEFINER) | their nested `pg_brand_can_charge(e.brand_id)` runs under each RPC's DEFINER privilege → already correct for the nested path. After the fix, unchanged. (Note: these RPCs were the *correct-by-accident* path; the bug only ever bit the DIRECT buyer-JWT calls to the predicate.) |
| Brand-side publish preflight UI | `mingla-business/src/components/offering/publishStripeReadiness.ts` | reads the client `BrandStripeStatus` store, not the RPC; owner context. Unaffected. |

### D-3 verdict
**The consumer app IS affected — but only on the brand-page feed** (`useBrandBySlug` under buyer JWT), which inherits the fix. The consumer **checkout path and the consumer detail screens are SAFE** (service-role DEFINER session RPC and DEFINER deck supply respectively). The fix in the single shared predicate covers every affected surface with no client change.

### Invariant impact
`I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED` (ORCH-1076) is currently violated in the WRONG direction — over-suppressing ready brands. This fix restores it to only suppress genuinely not-ready brands (SC-2/SC-7 preserve the true-negative). No other invariant is touched. One NEW draft invariant proposed (§ Invariants).

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 (happy, anon) | Ready brand, anon caller | `SET ROLE anon; pg_brand_can_charge(ready)` | `true` | DB |
| T-02 (true-negative, anon) | Not-ready brand (no account), anon | `SET ROLE anon; pg_brand_can_charge(notready)` | `false` | DB |
| T-03 (true-negative, charges off) | Brand with attached account but `charges_enabled=false`, anon | `SET ROLE anon; pg_brand_can_charge(chargesoff)` | `false` | DB |
| T-04 (edge: detached) | Brand whose only account has `detached_at IS NOT NULL`, anon | `SET ROLE anon; pg_brand_can_charge(detached)` | `false` | DB |
| T-05 (happy, authenticated non-owner) | Ready brand, authenticated non-payments-admin JWT | `SET ROLE authenticated` + non-owner claims; `pg_brand_can_charge(ready)` | `true` | DB |
| T-06 (batched, anon) | Mixed ids, anon | `SET ROLE anon; pg_brands_can_charge([ready, notready])` | rows = `{ready}` only | DB |
| T-07 (no-leak) | anon row visibility on base table | `SET ROLE anon; count(*) FROM stripe_connect_accounts WHERE brand_id=ready` | `0` (RLS untouched) | DB/security |
| T-08 (security mode) | catalog probe | `prosecdef` for both fns | `true` for both; `proconfig` has `search_path=` | DB |
| T-09 (supply RPC regression) | ready vs not-ready paid experience via supply RPC | existing ORCH-1076 behavioral test re-run | unchanged PASS | DB |
| T-10 (fails-on-revert) | revert the migration (restore INVOKER) and re-run T-01 | `pg_brand_can_charge(ready)` as anon | **`false`** → test RAISEs/fails | DB |
| T-11 (live, web) | Leggo This public event page, logged-out browser | open `/e/leggothis/the-party-block` | Get-Tickets CTA renders, no "finishing payment setup" banner | runtime (tester) |
| T-12 (live, consumer app) | Leggo This brand page, logged-in non-owner buyer | open brand page in app | paid event appears in feed | runtime (tester) |

The DB tests (T-01..T-10) seed fixtures **as the migration superuser** (anon cannot INSERT into `stripe_connect_accounts`), then wrap ONLY the RPC assertion in `SET LOCAL ROLE anon` / `SET LOCAL ROLE authenticated` inside a transaction that ROLLBACKs (write-safe, no surviving fixtures). T-05's authenticated non-owner uses `SET LOCAL ROLE authenticated` + `SET LOCAL request.jwt.claims` to a non-payments-admin sub (or simply asserts that authenticated-with-no-matching-policy still returns true under DEFINER — the policy predicate is irrelevant once the body runs as definer).

---

## 8. Implementation order (safe-migration protocol)

1. **Re-scan monotonic version.** `ls supabase/migrations/` in the worktree AND `ls /Users/sethogieva/Desktop/mingla-orchs/*/supabase/migrations/` for any prefix ≥ `20260927000000`. Confirm `20260927000000` is still free (current max is `20260926000000`); bump if a sibling worktree registered a higher prefix. Re-emit nothing else.
2. **Write the migration** `supabase/migrations/20260927000000_orch_1116_booking_gate_rls.sql`:
   - Header comment per §4.3.
   - `BEGIN;`
   - `CREATE OR REPLACE FUNCTION public.pg_brand_can_charge(uuid)` per §4.2 Function A — `SECURITY DEFINER`, `SET search_path = ''`, schema-qualified body, `$function$` dollar-tag terminated **before** the GRANT.
   - `GRANT EXECUTE ON FUNCTION public.pg_brand_can_charge(uuid) TO anon, authenticated;` (re-assert).
   - corrected `COMMENT ON FUNCTION public.pg_brand_can_charge(uuid) IS '…SECURITY DEFINER…returns only a boolean…';`
   - `CREATE OR REPLACE FUNCTION public.pg_brands_can_charge(uuid[])` per §4.2 Function B — `SECURITY DEFINER`, `SET search_path = ''`, `pg_catalog.unnest`, `$function$` terminated before GRANT.
   - `GRANT EXECUTE ON FUNCTION public.pg_brands_can_charge(uuid[]) TO anon, authenticated, service_role;` (re-assert).
   - corrected `COMMENT ON FUNCTION public.pg_brands_can_charge(uuid[]) IS '…';`
   - `COMMIT;`
   - **No DROP** — neither signature nor RETURNS changes, so `CREATE OR REPLACE` suffices (DROP would only be needed if widening a `RETURNS TABLE`; not applicable).
   - **Dollar-tag rule:** use `$function$ … $function$` (NOT `$$`) for both bodies so the trailing `GRANT`/`COMMENT` statements parse — per the safe-migration protocol (`$function$;` before any GRANT).
3. **Write the behavioral test** `supabase/migrations/__tests__/orch_1116_booking_gate_rls.test.sql` (§9).
4. **Write the strict-grep gate** `.github/scripts/strict-grep/orch-1116-booking-gate-security-definer.mjs` (§9) and register it in `.github/workflows/strict-grep-mingla-business.yml` alongside the orch-1075/1076 gates.
5. **Update the C7 backend allowlist** (`ORCH_1116_BACKEND_ALLOWLIST` analogue) in the SAME commit if the repo's strict-grep harness requires the migration path to be allowlisted (mirror how ORCH-1075/1076 added `ORCH_1075_BACKEND_ALLOWLIST` / `ORCH_1076_BACKEND_ALLOWLIST` — check `.github/scripts/strict-grep/` for the allowlist convention and follow it).
6. **Do NOT `supabase db push`.** Leave application to the orchestrator (Management API / MCP `apply_migration` — CLI is drift-wedged per memory).
7. **Self-verify:** run the strict-grep gate's `--self-test`, and run the `.test.sql` against the live remote (read-and-rollback; SELECT-only RPC calls + rolled-back fixtures are write-safe) to prove SC-1..SC-9 and T-10 fails-on-revert.

---

## 9. Regression prevention (fails-on-revert)

This is the heart of the fix — the ORCH-1076 CI gap (D-1) is precisely what let the bug ship green. Two independent safeguards, BOTH required:

### 9.1 Behavioral SQL test (primary, behavior-level) — `supabase/migrations/__tests__/orch_1116_booking_gate_rls.test.sql`
Modeled on `orch_1076_paid_supply_suppression.test.sql` but with the critical difference the old test LACKED: **it executes the RPC under `SET ROLE anon` and asserts the RETURN VALUE**, not merely the EXECUTE grant.

- **G-00 (text/catalog):** assert `prosecdef = true` for both `pg_brand_can_charge` and `pg_brands_can_charge` (catches a revert to INVOKER at the catalog level), and that `proconfig` contains `search_path` for both.
- **G-01 (anon true-positive — THE fails-on-revert case):** in a `BEGIN…ROLLBACK` tx, seed (as superuser) a brand + a ready `stripe_connect_accounts` row, then:
  ```sql
  SET LOCAL ROLE anon;
  IF public.pg_brand_can_charge(v_ready) IS NOT TRUE THEN
    RAISE EXCEPTION 'G-01 FAIL: anon got % for a READY brand (the ORCH-1116 RLS-INVOKER bug is back)', public.pg_brand_can_charge(v_ready);
  END IF;
  RESET ROLE;
  ```
  **This RAISEs when the migration is reverted** (INVOKER → anon sees 0 rows → returns false → `IS NOT TRUE` fires). PASSES when the fix is in place. This is the exact gate the ORCH-1076 G-00 should have been.
- **G-02 (anon true-negative preserved):** seed a not-ready brand (no account) and a `charges_enabled=false` brand; assert `SET LOCAL ROLE anon; pg_brand_can_charge(notready) = false` and `= false` for charges-off. Guards against an over-correction that returns true for everyone.
- **G-03 (batched, anon):** `SET LOCAL ROLE anon; SELECT array_agg(brand_id) FROM pg_brands_can_charge(ARRAY[ready, notready])` = `{ready}` only.
- **G-04 (no-leak):** `SET LOCAL ROLE anon; SELECT count(*) FROM public.stripe_connect_accounts WHERE brand_id = v_ready` = `0` (base-table RLS untouched).
- Protective comment at top of the file: explains WHY the anon-role assertion exists (the ORCH-1076 G-00 only checked the EXECUTE grant, which is the gap that let ORCH-1116 ship; an EXECUTE-grant check is NEVER sufficient for a SECURITY-INVOKER-over-RLS predicate — the test MUST exercise the anon role and assert the boolean).

### 9.2 Strict-grep gate (secondary, static text-level) — `.github/scripts/strict-grep/orch-1116-booking-gate-security-definer.mjs`
Modeled byte-for-byte on `orch-1076-paid-supply-requires-charges-enabled.mjs`'s "find latest defining migration → slice the function body → assert a marker" structure. For EACH of `pg_brand_can_charge` and `pg_brands_can_charge`:
- find the latest migration that defines it (descending sort, first `CREATE OR REPLACE FUNCTION public.<name>` hit),
- slice that function's body,
- assert the slice contains BOTH `SECURITY DEFINER` AND `search_path` (case-insensitive),
- fail (exit 1) with an explanatory message if either marker is missing — "a future migration dropped the DEFINER/search_path hardening; the ORCH-1116 booking-gate RLS false-positive will return."
- include a `--self-test` mode (inlined with/without fixtures) mirroring the ORCH-1076 gate.

This catches a revert at the source-text layer even before the DB test runs, and it fails-on-revert: if someone re-emits the predicate without `SECURITY DEFINER`, the gate trips in CI.

### Why two safeguards
The strict-grep gate catches a text-level regression in the latest migration; the behavioral test catches a real runtime regression under the anon role (the only level at which the bug actually manifests). The ORCH-1076 incident proves a text/grant-level gate ALONE is insufficient — hence the behavioral anon-role test is the primary, non-negotiable safeguard.

---

## 10. Invariants

- **Preserve `I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED` (ORCH-1076):** the fix restores correct enforcement (suppress only genuinely not-ready brands). Verified by SC-2/SC-7/G-02/T-09 (true-negative + supply RPC regression unchanged).
- **NEW (proposed, DRAFT) — `I-PROPOSED-BUYER-READINESS-PREDICATE-IS-DEFINER`:** Any predicate a buyer (anon or non-owner authenticated) calls to compute a public bookable/readiness flag from an RLS-protected table MUST be `SECURITY DEFINER` with a locked `search_path` AND return only the derived boolean/id-subset (never a protected row field); AND its regression test MUST execute the RPC under `SET ROLE anon` (or the anon-JWT path) and assert the RETURN VALUE — an EXECUTE-grant-only check is explicitly forbidden as a sufficient gate. Tagged **DRAFT**; flips ACTIVE on CLOSE (orchestrator owns the flip). Rationale: this is the exact failure mode of ORCH-1116 (and the exact CI gap of ORCH-1076's G-00).

---

## 11. Scoped allowlist + DO-NOT-TOUCH

### Allowlist (implementor MAY create/modify ONLY these)
- `supabase/migrations/20260927000000_orch_1116_booking_gate_rls.sql` (CREATE)
- `supabase/migrations/__tests__/orch_1116_booking_gate_rls.test.sql` (CREATE)
- `.github/scripts/strict-grep/orch-1116-booking-gate-security-definer.mjs` (CREATE)
- `.github/workflows/strict-grep-mingla-business.yml` (MODIFY — register the new gate only)
- the C7 backend-allowlist file IF the strict-grep harness requires the new migration path allowlisted (MODIFY — additive entry only; mirror ORCH-1075/1076 convention)
- `Mingla_Artifacts/` artifacts (this SPEC, the implementation report)

### DO-NOT-TOUCH (stop-and-amend required before changing any of these)
- The applied historical migrations `20260911000000_…1075…sql` and `20260917000000_…1076…sql` — **immutable**; do not edit (the D-2 comment correction lives in the NEW migration's comments, not by rewriting applied history).
- The five buyer-supply RPCs and any publish/session RPC bodies — no behavioral change; they already work under DEFINER.
- Any client/edge code: `publicEventsService.ts`, `publicExperienceService.ts`, `useBrandBySlug.ts`, `discover-merged-events/index.ts`, `ticket-checkout-create/index.ts`, `biz_ticket_checkout_create_session`, `_shared/ticketCheckout.ts`, `publishStripeReadiness.ts`, `brandPayout.ts`.
- The RLS policy on `stripe_connect_accounts` — do NOT add a buyer-readable policy (explicitly rejected, §4.1).
- The `pg_brand_can_charge` boolean LOGIC — preserve byte-identical (`IS DISTINCT FROM false`, `detached_at IS NULL`, `stripe_account_id IS NOT NULL`). Only the security mode + search_path + schema-qualification change.

If the implementor finds the fix needs anything outside this allowlist, STOP and request a SPEC amendment (`SPEC_AMENDMENT_ORCH-1116_BOOKING_GATE_RLS.md`) — do not silently widen.

---

## 12. Open questions

- **OQ-1 (apply path):** confirm the orchestrator applies via Management API / MCP `apply_migration` (not `supabase db push`) per the drift-wedged-CLI memory. (Assumption: yes; stated in §8 step 6. Not a blocker for IMPLEMENT.)
- **OQ-2 (C7 allowlist convention):** the implementor must check `.github/scripts/strict-grep/` for whether a `ORCH_1116_BACKEND_ALLOWLIST` entry is required (ORCH-1075/1076 both added one). If the harness does not gate new migration paths, skip step 5. (Resolvable by the implementor reading the harness — not a Seth decision.)

No questions require Seth before IMPLEMENT.

---

## 13. Downstream routing

- **Next:** `mingla-implementor` builds from this SPEC + the investigation, in the worktree `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1116-[booking-gate-rls]/` on branch `ORCH-1116-booking-gate-rls`. Deliverables: the migration, the anon-role behavioral test, the strict-grep gate (+ workflow registration), and the implementation report — strictly within the §11 allowlist. Self-verify SC-1..SC-9 + T-10 fails-on-revert.
- **Then:** `mingla-tester` verifies — runs the behavioral SQL test live (read-and-rollback), runs the strict-grep gate + `--self-test`, proves fails-on-revert (restore INVOKER → G-01 RAISEs), and live-fires T-11 (logged-out web `/e/leggothis/the-party-block` shows Get-Tickets) + T-12 (consumer app brand page paid event appears for a non-owner buyer).
- **Then:** orchestrator applies the migration (Management API), runs the post-apply behavioral probe, flips `I-PROPOSED-BUYER-READINESS-PREDICATE-IS-DEFINER` to ACTIVE, and CLOSEs. The orchestrator owns merge + apply + reap; the implementor and tester do NOT push/apply/merge.
