# IMPLEMENTATION — META-ORCH-1236: brands.pricing_currency tracks default_currency

**Date:** 2026-06-26
**Implementor:** mingla-implementor (Claude)
**Spec (binding contract):** `Mingla_Artifacts/specs/SPEC_META-ORCH-1236_CURRENCY_TRACKS_DEFAULT.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-1236_LIVE_CURRENCY_PAYMENT_INTENT.md`
**Working tree:** `~/Desktop/mingla-orchs/META-ORCH-1236-[live-currency-fix]/` on branch `META-ORCH-1236-live-currency-fix`
**Branch HEAD (this work):** `6fa0d8a4def47513240799e858e5814e525d17f0` (rebased on `origin/main` @ `8e72f5cb8`)
**Status:** implemented and verified (SQL migration + trigger + test live-fired on real Postgres; edge fns `deno check` clean; CI guard self-test + real-tree clean). Migration NOT applied to prod; edge fns NOT deployed; not merged — orchestrator/operator owns those.

---

## 1. Summary (plain English)

A USD-settling brand was being charged in GBP because `brands.pricing_currency` (the authoritative charge currency) kept its static SQL default `'GBP'` and no forward code path synced it to the brand's real `default_currency`. This delivers the operator-approved Approach 2: the DB now DERIVES `pricing_currency`/`pricing_region` from `default_currency` in the same write the existing trigger already mirrors — so they can never drift again — plus a one-time data hotfix re-aligning the drifted row, a warn-only charge-time cross-check in the two paid edge functions, a CI guard, and a fails-on-revert SQL test.

---

## 2. SPEC success-criteria coverage

| SC | Description | Verified | Evidence / commit |
|----|-------------|----------|-------------------|
| SC-1 | drift count = 0 after migration | ✓ PASS | live PG: `seed-drifted` GBP→USD; SQL test T-02 idempotency. `6fa0d8a` |
| SC-2 | region mapped for GBP/USD/EUR/CHF/NGN | ✓ PASS | SQL test T-03/T-04/T-05; migration A.2. `6fa0d8a` |
| SC-3 | Smoke & Rhythm → USD/US | ✓ PASS (mechanism) | hotfix is the same `IS DISTINCT FROM`-gated UPDATE proven on the drifted fixture; real-row apply at deploy. `6fa0d8a` |
| SC-4 | SCA trigger derives in same txn; detach preserves | ✓ PASS | SQL test T-03 (EUR→EUR/EU lockstep) + T-06 (detach preserves). `6fa0d8a` |
| SC-5 | brand-direct insert/update derives | ✓ PASS | SQL test T-01/T-04/T-05. `6fa0d8a` |
| SC-6 | idempotent re-run = 0 rows | ✓ PASS | SQL test T-02. `6fa0d8a` |
| SC-7 | native PI built in `usd`, accepted | UNVERIFIED (TEST) | backend now resolves USD; live-fire vs Stripe logs is the tester's job. `6fa0d8a` |
| SC-8 | web Checkout renders `$` not `£` | UNVERIFIED (TEST) | same resolver; live-fire is the tester's job. `6fa0d8a` |
| SC-9 | no money-row mutation | ✓ PASS | live PG: `events.currency` byte-identical before/after; SQL test T-09. `6fa0d8a` |
| SC-10 | CI guard catches direct write + passes clean | ✓ PASS | self-test exit 0 (flags bad fixture) + real-tree exit 0 (0/1977). `6fa0d8a` |

---

## 3. Files changed (all in the SPEC allowlist)

| File | Type | ~LOC | Commit |
|------|------|------|--------|
| `supabase/migrations/20261127000000_meta_orch_1236_pricing_currency_tracks_default.sql` | NEW | 215 | `6fa0d8a` |
| `supabase/migrations/__tests__/meta_orch_1236_pricing_currency_tracks_default.test.sql` | NEW | 240 | `6fa0d8a` |
| `supabase/functions/ticket-checkout-create/index.ts` | EDIT | +40 | `6fa0d8a` |
| `supabase/functions/venue-reservation-create/index.ts` | EDIT | +28 | `6fa0d8a` |
| `.github/scripts/strict-grep/meta-orch-1236-pricing-currency-canonical.mjs` | NEW | 290 | `6fa0d8a` |
| `.github/workflows/strict-grep-mingla-business.yml` | EDIT | +14 | `6fa0d8a` |

No file outside the allowlist was touched. No unrelated dirty files were staged.

---

## 4. OQ-3 decision + file:line evidence

**Question:** does any real brand-INSERT path insert with NULL `default_currency`?

**Decision: KEEP the `'GBP'`/`'GB'` NOT-NULL column defaults — do NOT drop them.** (SPEC §4.A.2 Option (b).)

**Evidence (read of code, not guess):** EVERY brand-INSERT path inserts a brand WITHOUT `default_currency`, so it lands NULL; it is populated only later by the Stripe sync trigger.

- `brands.default_currency` had both its `NOT NULL` and `DEFAULT 'GBP'` dropped: `supabase/migrations/20260515000011_orch_0769_no_implicit_gbp_currency.sql:7-8` (`ALTER COLUMN default_currency DROP DEFAULT, ... DROP NOT NULL;`).
- Client create path: `mingla-business/src/services/brandsService.ts:283` `createBrand()` → `mingla-business/src/services/brandMapping.ts:341` `default_currency: brand.defaultCurrency ?? null`; the `CreateBrandInput` interface (`brandsService.ts:241-256`) has NO `defaultCurrency` field and `createBrand` never passes one → always NULL.
- 6 SECURITY DEFINER brand-create RPCs, none of which sets `default_currency`: `20260729000000_meta_orch_0972_universal_authoring.sql:608` (`biz_create_venue_brand_authoring`, the one the venue client calls), `20260613000000_ve1_physical_venue_brand_onboarding.sql:234`, `20260614000000_ve1_pr_review_hardening.sql:245`, `20260618000000_ve2_pool_match_claim.sql:129`, `20260809000000_meta_orch_1009_sub_e_business_supply_feeder.sql:344`, `20261116000000_orch_1186_a_hours_single_owner_seed.sql:233`.
- No brand-create INSERT or RPC in `supabase/functions/`.

**Consequence:** because `pricing_currency`/`pricing_region` are still `NOT NULL` and the new BEFORE trigger only derives when `default_currency IS NOT NULL`, a brand inserted with NULL `default_currency` needs a NOT-NULL value at INSERT time. Dropping the `'GBP'`/`'GB'` defaults would therefore BREAK brand creation. So the defaults are KEPT as the floor for non-transacting brands (no Stripe account, NULL `default_currency`, can never charge) — the SAME D1 decision ORCH-1034 made for its 21 NULL-default brands. The load-bearing correctness is the trigger, not the literal default; this is documented in the migration header.

---

## 5. Data-model changes applied

- Trigger fn `tg_sync_brand_stripe_cache()` (`AFTER INSERT OR UPDATE ON stripe_connect_accounts`) — extended `UPDATE public.brands SET ...` to also derive `pricing_currency` (= `upper(trim(default_currency))`) and `pricing_region` (GBP→GB, USD→US, EUR→EU, CHF→CH, NGN→NG) from the same active-SCA currency, in the same statement. Detach branch preserves both (ORCH-0769 semantics). `SECURITY DEFINER` + `search_path` + every prior clause preserved. `COMMENT` updated.
- New trigger fn `tg_brands_derive_pricing_from_default()` + trigger `trg_brands_derive_pricing_from_default` (`BEFORE INSERT OR UPDATE OF default_currency ON brands`) — derives the two columns from `NEW.default_currency` when present; NULL leaves the floor.
- Data hotfix: idempotent NULL-tolerant `UPDATE brands SET pricing_currency/pricing_region` for drifted rows (`WHERE default_currency IS NOT NULL AND ... IS DISTINCT FROM ...`).
- Column defaults `pricing_currency='GBP'` / `pricing_region='GB'`: UNCHANGED (kept — see OQ-3).
- No CHECK/constraint changes (region allowlist `('GB','US','EU','CH','NG')` from `20260915000000` already covers all mapped values).
- NO money rows touched (`events.currency`, `ticket_types.currency`, `orders.currency`).

---

## 6. Edge functions touched

| Function | Change | `verify_jwt` to preserve |
|----------|--------|--------------------------|
| `ticket-checkout-create` | warn-only currency cross-check vs `brands.default_currency` (read via events→brands, no extra Stripe call) before the charge | default (auth-gated; handles guest internally) — UNCHANGED |
| `venue-reservation-create` | same warn-only cross-check vs `brands.default_currency` (read by `brandId`) | `verify_jwt = false` (config.toml) — UNCHANGED |

Both are log-only (`console.warn`); the existing `pricing_currency_missing` fail-close is untouched. Both pass `deno check`.

---

## 7. Regression tests added

- Implementor happy-path (fails-on-revert): `supabase/migrations/__tests__/meta_orch_1236_pricing_currency_tracks_default.test.sql` — 9 cases (T-01..T-09), one transaction, `ROLLBACK` (write-safe).
- **fails-on-revert verified at `6fa0d8a4def47513240799e858e5814e525d17f0`** on a real Postgres 15 (minimal schema fixture reproducing brands/SCA/the 0769 trigger):
  - Happy path: 10/10 NOTICE PASS, exit 0.
  - Revert A (delete the A.1 hotfix UPDATE via true line deletion): test FAILS → `T-02 FAIL: hotfix re-run updated 1 rows` (exit 3).
  - Revert B (delete `pricing_currency`/`pricing_region` from the SCA trigger SET + delete the brand-direct trigger via true line deletion): test FAILS → `T-01 FAIL: setting default_currency=USD did not track pricing (pricing_currency=GBP...)` (exit 3).
  - Fix restored: passes again.
- CI guard `--self-test` (pure-JS, deterministic): PASS — flags a known-bad `.from("brands").update({pricing_currency})` + a raw `UPDATE brands SET pricing_region`, ignores reads/types/allowlisted/other-tables. Real-tree scan: 0 violations / 1977 files.

---

## 8. Old → New receipts

### tg_sync_brand_stripe_cache() (migration)
- **Before:** mirrored `stripe_*` + `default_currency` from the active SCA; left `pricing_currency`/`pricing_region` untouched (the forward hole).
- **Now:** same write also derives `pricing_currency`/`pricing_region` from the same active-SCA currency; detach preserves them.
- **Why:** SC-4; close the forward drift hole (Constitution #2/#10).

### tg_brands_derive_pricing_from_default() + trigger (migration, NEW)
- **Before:** no brand-direct enforcement; a `default_currency` set directly left `pricing_currency` at the floor.
- **Now:** BEFORE INSERT/UPDATE derives both columns from `default_currency` when present.
- **Why:** SC-5; brand-direct path coverage.

### data hotfix (migration)
- **Before:** drifted rows (e.g. default USD / pricing GBP) charged in GBP.
- **Now:** re-aligned idempotently; NULL-default brands keep their floor.
- **Why:** SC-1/2/3; stop the live overcharge.

### ticket-checkout-create/index.ts + venue-reservation-create/index.ts
- **Before:** charged in `pricing.pricing_currency` with no account-currency cross-check.
- **Now:** warn-only log if the resolved currency disagrees with `brands.default_currency` (no extra Stripe call).
- **Why:** SPEC §4.B defense-in-depth / regression tripwire.

### meta-orch-1236-pricing-currency-canonical.mjs + workflow (NEW/EDIT)
- **Before:** nothing stopped app/edge code from writing the derived columns.
- **Now:** self-tested CI gate fails on any direct `brands.pricing_currency/region` write; registered job runs self-test + real scan.
- **Why:** SC-10; enforcement layer.

---

## 9. Cross-surface impact

| Surface | Affected | Parity |
|---------|----------|--------|
| Consumer iOS | YES (backend) | automatic (shared resolver) |
| Consumer Android | YES (backend) | automatic |
| Buyer/anonymous Web | YES (backend) | automatic |
| Business iOS | N/A (authors, no charge) | n/a |
| Business Android | N/A | n/a |
| Admin Web | N/A (no brand-currency write path) | n/a |
| Business Web preview | N/A | n/a |

All paid surfaces resolve currency from the same `b.pricing_currency`; once the column is correct, parity is automatic. No client/app/admin code changed.

---

## 10. Smoke / verification run

Live-fired against an ephemeral Postgres 15 (docker) with a minimal schema fixture (auth.users, creator_accounts, brands with real columns/defaults, stripe_connect_accounts, the pre-fix 0769 trigger, events). Migration applied clean; drift (`seed-drifted` USD/GBP/GB) → USD/US; NULL-default kept floor; `events.currency` unchanged; SQL test 10/10 PASS + both true-line-deletion reverts FAIL. Edge fns: `deno check` clean on both. (No local Supabase stack; full migration-history apply not run — see Known issues.)

---

## 11. Known issues / deferred

- **SC-7 / SC-8 (native PI valid / web `$` session)** are UNVERIFIED here — they need live-fire against Stripe logs (tester). The backend now resolves USD, which is unconditionally valid on a US account.
- **OQ-2** (exact rejected native-PI parameter) — secondary; tester to confirm from live Stripe logs.
- **OQ-1** (the settled £10 overcharge) — operator decision; out of scope.
- The SQL test was live-fired against a **minimal fixture**, not the full migration history (no local PG/Supabase stack in this session). The trigger + hotfix logic is proven against the real column shapes/defaults/CHECK; the tester should confirm against the linked remote (read-only probe + the adversarial SQL test).

---

## 12. Operator action required

1. **Apply the migration** (orchestrator/operator, AFTER review + tester PASS, from the worktree):
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1236-[live-currency-fix]" && /Users/sethogieva/bin/supabase db push --linked
   ```
   Monotonicity re-checked: highest existing prefix across anchor + all active worktrees + origin/main = `20261126000002`; this is `20261127000000` (strictly greater). No remote-only drift expected; verify `supabase migration list --linked` before push.
2. **Guard/backfill remote probe (read-only, recommended before push):** the hotfix is NULL-tolerant and `IS DISTINCT FROM`-gated (cannot abort), but confirm the live drift is exactly the expected 1 row:
   ```sql
   SELECT id, slug, default_currency, pricing_currency, pricing_region
   FROM public.brands
   WHERE default_currency IS NOT NULL
     AND upper(trim(default_currency::text)) IS DISTINCT FROM pricing_currency;
   -- expect 1 row: Smoke & Rhythm 1ce63bf4-... (USD / GBP / GB)
   ```
3. **Deploy edge functions** (from MERGED main, orchestrator/operator-owned): `ticket-checkout-create`, `venue-reservation-create`. Preserve `verify_jwt` (ticket: default auth-gated; venue: `false`). Verify with one curl each.
4. **No `--include-all`** needed (in-order migration).

---

## 13. Discoveries for orchestrator (not in scope)

- **D-1 (from SPEC):** `ticket-checkout-create/index.ts` `ENABLED_PRICING_REGIONS = ["GB","US","EU","CH"]` omits `"NG"` — benign today (NGN routes to Paystack before the Stripe block) but inconsistent with the DB allowlist `('GB','US','EU','CH','NG')`. Low-priority follow-up.
- **D-2 (from SPEC/investigation):** memory `project_orch_1034_currency_de_gbp_scope` says ORCH-1034 "not started" — STALE; the migration + edge de-GBP logic shipped. Correct at CLOSE.
- **New invariant** `I-PROPOSED-1236-PRICING-CURRENCY-TRACKS-DEFAULT` is DRAFT — register in `INVARIANT_REGISTRY.md` and flip ACTIVE at CLOSE.
