# SPEC — META-ORCH-1236: brands.pricing_currency MUST track default_currency

**Date:** 2026-06-26
**Author:** mingla-forensics (SPEC mode)
**Source investigation (authoritative, PROVEN):** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-1236_LIVE_CURRENCY_PAYMENT_INTENT.md`
**Working tree:** `~/Desktop/mingla-orchs/META-ORCH-1236-[live-currency-fix]/` on branch `META-ORCH-1236-live-currency-fix` (rebased on `origin/main`; HEAD `8e72f5cb8`).
**Severity:** S0-critical (live buyers charged wrong currency + native paid checkout broken).
**Status:** SPEC — implementor-ready contract. No product code written here.

---

## 1. Executive summary

A brand whose Stripe-synced settlement currency is **USD** (Smoke & Rhythm) is being **charged in GBP**, because `brands.pricing_currency` (the authoritative charge currency) silently kept its SQL column default `'GBP'`. The one-time ORCH-1034 backfill aligned the rows that existed then, but **no forward code path** keeps `pricing_currency`/`pricing_region` in step with `default_currency` for brands created/onboarded afterward. Result: a real £10 overcharge settled on web, and the native PaymentIntent is rejected `400 payment_intent_invalid_parameter`.

This spec delivers the **operator-approved full fix**:
- **A. Data hotfix** — idempotent migration re-aligning drifted rows (mirrors ORCH-1034), stopping the live overcharge.
- **B. Structural forward fix (chosen: Approach 2 — DB single-owner trigger)** — extend the existing canonical mirror trigger `tg_sync_brand_stripe_cache()` so `pricing_currency`/`pricing_region` are derived from `default_currency` in the same write, in lockstep with the already-mirrored `stripe_*` + `default_currency` columns. This is DB-enforced, applies to BOTH refresh-status and onboard (both write through `stripe_connect_accounts`), and is impossible for any future code path to bypass.
- **C. New invariant** `I-PROPOSED-1236-PRICING-CURRENCY-TRACKS-DEFAULT` (DRAFT).
- **D. CI guard** extending the existing I-PROPOSED-P canonical-writer gate to cover `pricing_currency`/`pricing_region`.
- **E. Cheap defense-in-depth currency cross-check** at charge time in both edge functions (warn-only on the established path; the primary correctness is the trigger).
- **F. Step-0.5 regression tests** (implementor happy-path + tester adversarial), fails-on-revert.

---

## 2. Scope & non-goals

### In scope
1. Re-align drifted `brands.pricing_currency` / `pricing_region` for all existing rows (data hotfix).
2. Make the DB trigger that already mirrors `default_currency` ALSO derive + write `pricing_currency` + `pricing_region`, so they can never drift again — covering every forward Stripe-state write (onboard + refresh-status, both via `stripe_connect_accounts`).
3. Drop the misleading `'GBP'` / `'GB'` column defaults on `brands.pricing_currency` / `pricing_region` (they no longer represent any real brand; they were the trap).
4. Add a cheap, warn-only charge-time currency cross-check in `ticket-checkout-create` and `venue-reservation-create` (defense-in-depth).
5. New DRAFT invariant + CI guard + regression tests.

### Non-goals (explicitly OUT)
- **Refund/remediation of the settled £10 charge.** Operator decision; tracked separately (Open Question OQ-1). NOT this implementor's job.
- **Rewriting money rows** (`events.currency`, `ticket_types.currency`, `orders.currency`). The hotfix touches ONLY two brand config columns. Frozen money snapshots are immutable by design (ORCH-0769) and stay untouched.
- **Paystack/NGN charge path changes.** NGN routes to Paystack before any Stripe call; the derivation MUST still map NGN→NG correctly (region allowlist already includes NG), but no Paystack logic changes.
- **Edge-fn `ENABLED_PRICING_REGIONS` widening to NG** (a separate latent item — see Discoveries D-1; out of scope here because NG never reaches the Stripe block).
- **Confirming the exact rejected Stripe native-PI parameter** (OQ-2 — secondary; the fix charges in USD which is unconditionally valid on a US account, so this does not gate the fix).
- **Memory correction** that ORCH-1034 was "shipped, not 'not started'" — orchestrator owns at CLOSE.

### Assumptions
- The investigation's root cause is accepted as proven; this SPEC does not re-investigate.
- `tg_sync_brand_stripe_cache()` latest definition is `20260515000009_orch_0769_app_wide_currency.sql` L96–119 (verified: no later migration redefines it).
- Region allowlist current state is `('GB','US','EU','CH','NG')` from `20260915000000_meta_orch_1076_p1_payment_provider.sql` L78 (verified latest).

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

The fix is DB-layer (trigger + data) + two edge functions. All paid surfaces resolve currency from the SAME `resolve_event_pricing_inputs()` → `b.pricing_currency`, so parity is **automatic** once the brand column is correct.

| # | Surface | Covered? | User-visible behavior demanded | Files touched here | Parity |
|---|---------|----------|-------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/` iOS) | YES (via backend) | Native PaymentIntent built in the brand's real currency (USD) → succeeds; correct currency charged | none (backend-only) | automatic (shared resolver) |
| 2 | Consumer Android (`app-mobile/` Android) | YES (via backend) | Same as iOS | none | automatic |
| 3 | Buyer/anonymous Web (`mingla-business/` `/checkout/{eventId}`, `/e/...`, `/b/...`, `/t/...`) | YES (via backend) | Checkout Session in correct currency; no more £-at-last-step | none | automatic |
| 4 | Business iOS | N/A | Business authors, does not buy — no charge path | none | n/a |
| 5 | Business Android | N/A | Same | none | n/a |
| 6 | Admin Web (`mingla-admin/`, adjacent) | N/A | No brand-currency write path in admin | none | n/a |
| 7 | Business Web preview (adjacent) | N/A | No charge path | none | n/a |

**Backend (the actual fix surface):** `supabase/migrations/` (1 new migration) + `supabase/functions/ticket-checkout-create/` + `supabase/functions/venue-reservation-create/` + `.github/` CI guard. Reservations, events, trips, experiences are all the SAME edge-fn/resolver paths (see investigation §5) and are covered automatically by the column fix.

---

## 4. Layered specification

### 4.A — DATABASE (the core fix)

One new migration. **Version prefix:** highest existing across all active worktrees + `origin/main` = `20261126000002` (verified by scan). Use **`20261127000000`** (strictly greater; monotonic protocol honored).

**File:** `supabase/migrations/20261127000000_meta_orch_1236_pricing_currency_tracks_default.sql`

This single migration does THREE things, in order, wrapped in `BEGIN;`/`COMMIT;`:

#### 4.A.1 — Data hotfix (mirror ORCH-1034 exactly; idempotent; NGN/NG added)

```sql
-- Re-align drifted rows: pricing_currency := default_currency, derive region.
UPDATE public.brands
   SET pricing_currency = upper(trim(default_currency::text)),
       updated_at       = now()
 WHERE default_currency IS NOT NULL
   AND upper(trim(default_currency::text)) IS DISTINCT FROM pricing_currency;

UPDATE public.brands
   SET pricing_region = CASE upper(trim(default_currency::text))
                          WHEN 'GBP' THEN 'GB'
                          WHEN 'USD' THEN 'US'
                          WHEN 'EUR' THEN 'EU'
                          WHEN 'CHF' THEN 'CH'
                          WHEN 'NGN' THEN 'NG'   -- NEW vs ORCH-1034
                          ELSE pricing_region
                        END,
       updated_at = now()
 WHERE default_currency IS NOT NULL
   AND upper(trim(default_currency::text)) IN ('GBP','USD','EUR','CHF','NGN')
   AND pricing_region IS DISTINCT FROM (
         CASE upper(trim(default_currency::text))
           WHEN 'GBP' THEN 'GB' WHEN 'USD' THEN 'US' WHEN 'EUR' THEN 'EU'
           WHEN 'CHF' THEN 'CH' WHEN 'NGN' THEN 'NG' ELSE pricing_region END);
```

- NULL-`default_currency` brands (no Stripe account, cannot transact) are LEFT as-is — same D1 decision as ORCH-1034. The `WHERE default_currency IS NOT NULL` gate prevents abort/fabrication.
- Touches ONLY `pricing_currency` + `pricing_region` (+ `updated_at`). NO money rows.
- Live impact today: exactly 1 row (Smoke & Rhythm GBP→USD, GB→US).

#### 4.A.2 — Drop the misleading `'GBP'`/`'GB'` column defaults

```sql
ALTER TABLE public.brands ALTER COLUMN pricing_currency DROP DEFAULT;
ALTER TABLE public.brands ALTER COLUMN pricing_region   DROP DEFAULT;
```

- These columns are NOT NULL. Every INSERT path must therefore now provide a value. **VERIFY before relying on this:** the trigger is AFTER INSERT, so it cannot satisfy a NOT-NULL-at-INSERT requirement. Two safe options — implementor MUST pick the one proven correct against the brand-create path:
  - **Option (a) [PREFERRED]:** keep the columns NOT NULL but change the default to derive-at-insert is impossible in pure DDL, so instead **add a `BEFORE INSERT` clause to the trigger logic** (see 4.A.3 — the trigger fires on `stripe_connect_accounts`, NOT `brands`, so it does NOT help brand INSERT). Therefore: **set the column default to derive from a NOT-NULL fallback is not available.** → Choose Option (b).
  - **Option (b) [USE THIS]:** Do **NOT** drop the defaults outright. Instead, **change the defaults to remain present but make them HARMLESS by also covering brand-insert in a `BEFORE INSERT` trigger on `brands`** that sets `pricing_currency`/`pricing_region` from `NEW.default_currency` when `default_currency` is present (see 4.A.3b). Keep a NOT-NULL-satisfying default only as the last-resort floor for the no-currency-yet brand (which cannot charge anyway).

  > **Implementor decision contract:** the GOAL is "no future row can have pricing_currency disagree with a non-NULL default_currency." Dropping the literal default is cosmetic; the load-bearing piece is the trigger(s) in 4.A.3. If dropping the default would make any existing brand-INSERT path fail the NOT-NULL constraint (because that path does not set pricing_currency), DO NOT drop it — keep the default AND rely on the BEFORE INSERT trigger. Prove which path is real by reading the brand-create code (`mingla-business` create flow + any `INSERT INTO brands` in migrations/RPCs) before deciding. Record the decision in the implementation report.

#### 4.A.3 — Extend the canonical mirror trigger (the structural single-owner fix)

`tg_sync_brand_stripe_cache()` is the SOLE writer of `brands.stripe_*` + `brands.default_currency` (per I-PROPOSED-P / I-PROPOSED-K; trigger is `AFTER INSERT OR UPDATE ON stripe_connect_accounts`). Extend its `UPDATE public.brands SET ...` to ALSO derive `pricing_currency` + `pricing_region` from the SAME `default_currency` it already computes — in the SAME statement, so the two columns are written atomically together and can never diverge.

`CREATE OR REPLACE FUNCTION public.tg_sync_brand_stripe_cache()` — extend the SET list (preserve the existing detach-aware `default_currency` CASE; add two derived columns keyed off the SAME resolved currency). Skeleton (illustrative — implementor writes the full body, preserving every existing clause + comments + SECURITY DEFINER + search_path):

```sql
-- inside the existing UPDATE public.brands SET ... WHERE id = NEW.brand_id:
default_currency = <existing detach-aware CASE>,            -- UNCHANGED
pricing_currency = CASE
    WHEN NEW.detached_at IS NOT NULL THEN brands.pricing_currency  -- detach: leave commerce ccy
    WHEN NEW.default_currency IS NOT NULL
      THEN upper(trim(NEW.default_currency::text))
    ELSE brands.pricing_currency
  END,
pricing_region = CASE
    WHEN NEW.detached_at IS NOT NULL THEN brands.pricing_region
    WHEN NEW.default_currency IS NOT NULL THEN (CASE upper(trim(NEW.default_currency::text))
        WHEN 'GBP' THEN 'GB' WHEN 'USD' THEN 'US' WHEN 'EUR' THEN 'EU'
        WHEN 'CHF' THEN 'CH' WHEN 'NGN' THEN 'NG' ELSE brands.pricing_region END)
    ELSE brands.pricing_region
  END
```

- **Detach semantics:** mirror the existing `default_currency` rule — on detach, do NOT reset commerce currency (keep prior value), matching ORCH-0769's deliberate "detach clears Stripe cache without resetting brand commerce currency."
- **Unmapped currency:** leave `pricing_region` as-is (cannot violate the `('GB','US','EU','CH','NG')` CHECK because we only set mapped values).
- Update the `COMMENT ON FUNCTION` to state it now also derives `pricing_currency`/`pricing_region` from the active SCA currency.

#### 4.A.3b — BEFORE INSERT/UPDATE trigger on `brands` (closes the brand-direct-write hole)

The `stripe_connect_accounts` trigger covers Stripe-driven currency changes, but a brand can also be created/updated with a `default_currency` directly (e.g. a future create path, or an admin/RPC change). To make the invariant truly DB-enforced (Constitution #2/#10) and to satisfy the dropped-default question in 4.A.2, add a `BEFORE INSERT OR UPDATE OF default_currency ON brands` trigger that derives `pricing_currency`/`pricing_region` from `NEW.default_currency` whenever `default_currency` is present, UNLESS the row is being written by the SCA mirror (avoid double-derive races — use a guard, e.g. only derive when `NEW.pricing_currency` was not explicitly set to match, or simply derive idempotently since the SCA trigger writes the same value).

```sql
CREATE OR REPLACE FUNCTION public.tg_brands_derive_pricing_from_default()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.default_currency IS NOT NULL THEN
    NEW.pricing_currency := upper(trim(NEW.default_currency::text));
    NEW.pricing_region := CASE upper(trim(NEW.default_currency::text))
        WHEN 'GBP' THEN 'GB' WHEN 'USD' THEN 'US' WHEN 'EUR' THEN 'EU'
        WHEN 'CHF' THEN 'CH' WHEN 'NGN' THEN 'NG'
        ELSE COALESCE(NEW.pricing_region, 'GB') END;  -- unmapped: keep/ floor
  END IF;
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_brands_derive_pricing_from_default ON public.brands;
CREATE TRIGGER trg_brands_derive_pricing_from_default
  BEFORE INSERT OR UPDATE OF default_currency ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.tg_brands_derive_pricing_from_default();
```

- Because this is BEFORE INSERT, it satisfies the NOT-NULL constraint when `default_currency` is set, which RESOLVES the 4.A.2 default-drop question: **with this trigger in place, dropping the `'GBP'`/`'GB'` defaults is SAFE for any insert that provides `default_currency`.** For inserts with NULL `default_currency` (non-transacting brands), the columns still need a NOT-NULL value → keep a minimal default OR have the trigger floor them. **Implementor: confirm the real brand-INSERT path sets default_currency; if some path inserts with NULL default_currency, KEEP a NOT-NULL default (the floor) and document it. Do not let the migration break brand creation.**
- **Idempotency / no-fight:** the two triggers can both fire (brand UPDATE from the SCA mirror also triggers the BEFORE UPDATE OF default_currency). They derive the SAME value, so the result is convergent. Verify no infinite loop: the SCA trigger does `UPDATE brands`, which fires the BEFORE trigger once (BEFORE triggers do not re-enter on the same statement). Confirm with the SQL test.

> **WHY Approach 2 (DB trigger) over Approach 1 (edge-fn writes) — chosen + justified in §10.**

### 4.B — EDGE FUNCTIONS (defense-in-depth only; primary fix is the column)

Two functions consume `pricing.pricing_currency` as the charge currency:
- `supabase/functions/ticket-checkout-create/index.ts` (web Checkout Session L1078+ and native PaymentIntent L1565–1627).
- `supabase/functions/venue-reservation-create/index.ts` (L303–312).

**Change (both files):** add a cheap, NON-fatal currency cross-check **before** the Stripe charge, comparing the resolved settlement currency against the connected-account currency we already hold. The connected-account currency is reachable two ways without an extra Stripe round-trip:
1. `stripe_connect_accounts.default_currency` (already synced; can be read alongside the existing pricing read), OR
2. `brands.default_currency` (already the trigger-synced mirror).

Since the trigger now guarantees `pricing_currency == upper(default_currency)`, the cross-check is a guard against regression, NOT the fix. Behavior:
- If `pricing_currency` (lowercased) **equals** the account currency → proceed silently.
- If they **differ** → `console.warn` with `{ eventId/brandId, pricingCurrency, accountCurrency }` (mirrors the existing L876–880 session-vs-settlement warn). Do NOT hard-block on the established path (the trigger should make this unreachable; blocking risks a false-positive outage). 
- **Optional hard-fail (implementor judgement, default OFF):** only fail-closed if `accountCurrency` is present AND differs AND `pricing_currency` is NULL/empty — i.e. a genuinely unsafe state. Keep the existing `pricing_currency_missing` fail-closed (L867–873 / L304–308) untouched.

> Keep scope tight: do NOT add a live `stripe.accounts.retrieve` call on the checkout hot path (latency + rate-limit). Use the already-synced DB value. Cite: charging in the connected account's settlement currency avoids Stripe FX — https://docs.stripe.com/connect/charges and direct-charge fee collection https://docs.stripe.com/connect/direct-charges#collect-fees ; PaymentIntent `currency` param https://docs.stripe.com/api/payment_intents/create .

### 4.C — SERVICE / HOOK / COMPONENT / REALTIME

No changes. The resolver `resolve_event_pricing_inputs()` already returns `b.pricing_currency`; once the column is correct, all consumers are correct. No client code is touched.

---

## 5. Success criteria

- **SC-1 (data):** After migration, `SELECT count(*) FROM brands WHERE default_currency IS NOT NULL AND upper(trim(default_currency::text)) IS DISTINCT FROM pricing_currency` = **0**.
- **SC-2 (region):** After migration, every row with `default_currency IN ('GBP','USD','EUR','CHF','NGN')` has `pricing_region` = the mapped value (GB/US/EU/CH/NG respectively).
- **SC-3 (Smoke & Rhythm specifically):** brand `1ce63bf4-1a33-4309-ab0b-ec23343e3569` ends with `pricing_currency='USD'`, `pricing_region='US'`.
- **SC-4 (trigger — refresh/onboard path):** Updating `stripe_connect_accounts.default_currency` to a new value (e.g. 'eur') for a brand sets `brands.pricing_currency='EUR'` and `brands.pricing_region='EU'` in the SAME transaction (no second write needed). Detach (`detached_at` set) does NOT reset `pricing_currency`.
- **SC-5 (trigger — brand-direct path):** Inserting/updating a `brands` row with `default_currency='usd'` yields `pricing_currency='USD'`, `pricing_region='US'` without any app code setting those columns.
- **SC-6 (idempotency):** Re-running the migration changes 0 rows (all UPDATEs are `IS DISTINCT FROM`-gated).
- **SC-7 (native PI valid) [iOS + Android]:** A native paid checkout for the USD brand builds a PaymentIntent with `currency: "usd"` and is accepted by Stripe (no `payment_intent_invalid_parameter`). (Live-fire at TEST against Stripe test/live logs.)
- **SC-8 (web Checkout) [Web]:** A buyer-web checkout for the USD brand renders a `$` Checkout Session, not `£`.
- **SC-9 (no money-row mutation):** `events.currency`, `ticket_types.currency`, `orders.currency` row counts/values are byte-identical before/after migration.
- **SC-10 (CI guard):** The extended I-PROPOSED-P / new gate fails when any app/edge file writes `brands.pricing_currency`/`pricing_region` directly without the allowlist tag, and passes on a clean tree.

---

## 6. Invariants

### Preserved
- **I-PROPOSED-P** (brands.stripe_* canonical; mirrored only by trigger): preserved AND extended — `pricing_currency`/`pricing_region` join the trigger-owned set.
- **I-PROPOSED-K** (default_currency mirrored from active SCA): preserved; the new derivation keys off the same value.
- **ORCH-0769 detach semantics** (detach clears Stripe cache but NOT commerce currency): preserved — detach branch leaves `pricing_currency` unchanged.
- **Constitution #2** (one owner per truth) + **#10** (currency-aware): now satisfied — the trigger is the single owner deriving pricing currency from default currency.
- **events.currency immutability** (ORCH-0769): untouched.

### New (DRAFT — orchestrator flips ACTIVE on CLOSE)
- **I-PROPOSED-1236-PRICING-CURRENCY-TRACKS-DEFAULT**
  - **Rule:** `brands.pricing_currency` MUST always equal `upper(trim(brands.default_currency))` for any row with a non-NULL `default_currency`, and `brands.pricing_region` MUST be its mapped region (GBP→GB, USD→US, EUR→EU, CHF→CH, NGN→NG). Neither column may be written directly by application or edge code; both are derived by DB trigger from `default_currency`.
  - **Enforcement:** (1) DB triggers `tg_sync_brand_stripe_cache` (SCA path) + `tg_brands_derive_pricing_from_default` (brand-direct path); (2) CI strict-grep guard (§9); (3) SQL regression test (§7/§9).
  - **Regression test:** `supabase/migrations/__tests__/meta_orch_1236_pricing_currency_tracks_default.test.sql` (fails-on-revert — see §9).

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 happy | Hotfix aligns drift | seed brand default='USD' pricing='GBP' | after migration: pricing='USD', region='US' | SQL migration |
| T-02 happy | Idempotent re-run | run migration twice | 2nd run updates 0 rows | SQL |
| T-03 happy | SCA trigger derives | update sca.default_currency='eur' | brands.pricing_currency='EUR', region='EU' | SQL trigger |
| T-04 happy | brand-direct trigger | insert brand default='usd' | pricing_currency='USD', region='US' | SQL trigger |
| T-05 edge | NGN→NG mapping | brand default='NGN' | pricing_currency='NGN', region='NG' | SQL |
| T-06 edge | detach preserves ccy | set sca.detached_at | pricing_currency UNCHANGED, stripe_* cleared | SQL trigger |
| T-07 edge | NULL default untouched | brand default=NULL | pricing_currency keeps prior/floor; no abort | SQL |
| T-08 edge | unmapped currency | brand default='CAD' | pricing_currency='CAD', region left/floored (no CHECK violation) | SQL |
| T-09 error | money rows frozen | run migration | events/ticket_types/orders currency unchanged | SQL data |
| T-10 happy | native PI currency | USD brand native checkout | PI currency='usd', accepted | edge runtime (TEST) |
| T-11 happy | web session currency | USD brand web checkout | `$` session, not `£` | edge runtime (TEST) |
| T-12 error | CI guard catches direct write | add `pricing_currency:` write in edge fn | guard exits 1 | CI |
| T-13 happy | CI guard self-test + clean | run guard `--self-test` then on tree | exit 0 | CI |

---

## 8. Implementation order

1. **DB:** write `supabase/migrations/20261127000000_meta_orch_1236_pricing_currency_tracks_default.sql` — sections 4.A.1 (hotfix), 4.A.3 (extend `tg_sync_brand_stripe_cache`), 4.A.3b (new brand-direct trigger), then 4.A.2 (default decision — drop or keep-with-floor, per the read of the real brand-INSERT path). Order matters: define triggers BEFORE deciding on default drop.
2. **SQL test:** write `supabase/migrations/__tests__/meta_orch_1236_pricing_currency_tracks_default.test.sql` (T-01..T-09, transaction-rollback DO blocks, `\set ON_ERROR_STOP on`, fails-on-revert assertions).
3. **Edge:** `ticket-checkout-create/index.ts` — add the warn-only currency cross-check before the web session AND native PI builds.
4. **Edge:** `venue-reservation-create/index.ts` — same cross-check before the Stripe charge.
5. **CI guard:** extend `i-proposed-p-stripe-state-canonical.mjs` field regex to include `pricing_currency|pricing_region` (OR add sibling `meta-orch-1236-pricing-currency-canonical.mjs`); add a job in `.github/workflows/strict-grep-mingla-business.yml` (with `--self-test` step).
6. **Deploy note (orchestrator, not implementor):** migration via `supabase db push --linked` (NOT blind push — verify history first); edge fns deploy + one-curl verify; per `feedback_orchestrator_deploys_edge_functions`.

---

## 9. Regression prevention (fails-on-revert contract)

**Structural safeguard:** the DB triggers make the drift impossible; the CI guard prevents code from bypassing them; the SQL test proves the triggers work.

- **SQL fails-on-revert:** `meta_orch_1236_..._test.sql` T-03 seeds an SCA currency change and asserts `brands.pricing_currency` updated in lockstep. If the trigger extension is reverted (pricing_currency no longer in the SET list), the assertion's "expected derived value did NOT appear" branch RAISEs → test fails. T-01 asserts the hotfix alignment; reverting the UPDATE leaves drift → fails. Each DO block runs in its own transaction and ROLLBACKs (write-safe).
- **CI guard fails-on-revert:** the strict-grep job has a `--self-test` step that asserts the guard flags a known-bad fixture (a line writing `pricing_currency:` into a `.from("brands").update(...)`); if the guard logic is weakened, `--self-test` fails. On the real tree it must pass (no direct writes exist).
- **Protective comment:** the migration header MUST explain: "pricing_currency/pricing_region are DERIVED from default_currency by trigger; the literal column default was the ORCH-1236 trap — never reintroduce a static currency default. See I-PROPOSED-1236."

**Concrete test targets/paths:**
- Implementor happy-path (fails-on-revert): `supabase/migrations/__tests__/meta_orch_1236_pricing_currency_tracks_default.test.sql` (T-01, T-03, T-04 minimum).
- Tester adversarial (DIFFERENT angle — to be written by mingla-tester at TEST, named here): `supabase/migrations/__tests__/meta_orch_1236_pricing_currency.adversarial.test.sql` — attack vectors: (a) detach-then-reattach with a DIFFERENT currency; (b) rapid SCA update flip USD→EUR→USD asserting final convergence; (c) brand UPDATE that tries to set `pricing_currency` to a value DISAGREEING with `default_currency` and asserting the BEFORE trigger overrides it; (d) an unmapped currency ('CAD') asserting no CHECK violation + region floor; (e) confirm no money-row mutation under a real `ticket-checkout`-shaped insert.

---

## 10. Open questions

- **CHOSEN STRUCTURAL APPROACH: Approach 2 (DB trigger), with B1 (edge cross-check) folded in as warn-only defense-in-depth.** Justification: (1) The codebase ALREADY treats `brands.stripe_*` + `default_currency` as trigger-owned cache (I-PROPOSED-P/K) written ONLY by `tg_sync_brand_stripe_cache`; `pricing_currency`/`pricing_region` are the SAME class of derived-from-default truth, so the natural single owner is that exact trigger — extending it is the minimal, convention-aligned change. (2) Approach 1 alone (edge-fn writes) would leave the brand-direct INSERT/UPDATE path uncovered and re-introduce a second writer (Constitution #2 violation). (3) A DB trigger is unbypassable by any future code path (the investigation's core requirement: "no code path can ever drift them again"). (4) Approach 3 (CI guard) is necessary but NOT sufficient alone — it catches new code, not the existing forward hole; included as the enforcement layer. So: Approach 2 = primary fix; Approach 3 = enforcement; Approach 1's spirit = the warn-only edge cross-check.
- **OQ-1 (operator decision, NON-blocking for IMPLEMENT):** the already-settled £10 GBP overcharge — refund the FX delta, full refund + re-charge in USD, or leave? Owner: Seth. Tracked separately; NOT this implementor's job.
- **OQ-2 (secondary, NON-blocking — for stripe skill at IMPLEMENT/TEST):** the exact rejected native-PI parameter (likely GBP×Link or GBP×US-direct-charge per investigation §4). Confirm from live Stripe logs at TEST. Does NOT gate the fix (USD on a US account is unconditionally valid).
- **OQ-3 (implementor must resolve by reading code, NOT by guessing):** does any real brand-INSERT path insert with NULL `default_currency`? If yes → keep a NOT-NULL floor default; if all paths set `default_currency` → safe to drop the literal default. Read the `mingla-business` create flow + every `INSERT INTO brands` in migrations/RPCs before deciding (§4.A.2 / §4.A.3b). Record the decision in the implementation report.

---

## 11. Downstream routing

- **Next phase:** mingla-implementor.
- **Working tree:** `~/Desktop/mingla-orchs/META-ORCH-1236-[live-currency-fix]/` on branch `META-ORCH-1236-live-currency-fix`.
- **Then:** mingla-tester (adversarial SQL test §9 + live-fire SC-7/SC-8/SC-10/SC-11 against Stripe logs; resolve OQ-2 via the stripe skill).
- **Then:** mingla-orchestrator CLOSE (flip I-PROPOSED-1236 → ACTIVE, register the guard in INVARIANT_REGISTRY, correct the ORCH-1034 "not started" memory, surface OQ-1 to Seth, one-PR-per-CLOSE, all-checks-green pre-gate).

---

## Scoped allowlist (implementor MAY change ONLY these)

- `supabase/migrations/20261127000000_meta_orch_1236_pricing_currency_tracks_default.sql` (NEW)
- `supabase/migrations/__tests__/meta_orch_1236_pricing_currency_tracks_default.test.sql` (NEW)
- `supabase/functions/ticket-checkout-create/index.ts` (warn-only cross-check only)
- `supabase/functions/venue-reservation-create/index.ts` (warn-only cross-check only)
- `.github/scripts/strict-grep/i-proposed-p-stripe-state-canonical.mjs` (extend field regex) OR `.github/scripts/strict-grep/meta-orch-1236-pricing-currency-canonical.mjs` (NEW sibling)
- `.github/workflows/strict-grep-mingla-business.yml` (register the guard job)

## DO-NOT-TOUCH

- Any migration ≤ `20261126000002` (history is applied/immutable).
- `events.currency`, `ticket_types.currency`, `orders.currency` and all money-snapshot columns/rows.
- The Stripe charge SHAPE (direct-charge, application_fee_amount, payment_method_types allowlist, idempotency keys, API version) — out of scope; protected by I-PROPOSED-O/P/Q/R/S/STRIPE-PM-METHOD-ALLOWLIST.
- Paystack/NGN routing logic in both edge fns.
- The edge-fn `ENABLED_PRICING_REGIONS` array (NG-widening is a separate item — Discovery D-1).
- Any client/app/admin code (no UI change required).

Outside this list → STOP and request a SPEC amendment (`SPEC_AMENDMENT_META-ORCH-1236_*.md`); never silently widen.

---

## Discoveries for orchestrator (NOT in scope)

- **D-1:** `ticket-checkout-create/index.ts` L889 `ENABLED_PRICING_REGIONS = ["GB","US","EU","CH"]` omits `"NG"` — an NG brand would degrade to flat-absorb tax. BENIGN today because NGN routes to Paystack before the Stripe block, but it is an inconsistency vs the DB allowlist `('GB','US','EU','CH','NG')`. Register as a low-priority follow-up.
- **D-2:** Memory `project_orch_1034_currency_de_gbp_scope` says ORCH-1034 "not started" — STALE; the migration + edge de-GBP logic shipped. Correct at CLOSE.
