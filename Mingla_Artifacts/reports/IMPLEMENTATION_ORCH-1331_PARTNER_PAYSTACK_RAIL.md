# IMPLEMENTATION — ORCH-1331 [partner program Nigeria/Paystack payout rail]

- **Date:** 2026-07-11
- **Mode:** IMPLEMENT (against `SPEC_ORCH-1331_PARTNER_PAYSTACK_RAIL.md` @ 37df6bfbc + `DESIGN_ORCH-1331_PARTNER_PAYSTACK_UI.md` @ c8b4d6d43 — both binding)
- **Working tree:** `~/Desktop/mingla-orchs/orch-1331-[partner-paystack-rail]/` on branch `orch-1331-partner-paystack-rail` (rebased/confirmed current on `origin/main` @ `7ae4966e1`)
- **Commits:** `e230ccef0` (DB + engine + webhook) → `dc3607825` (onboard + sweep + exclusivity + Deno suites) → `27f9f75af` (gates + CI) → `49bd06da9` (client leg)
- **Status label:** implemented and verified (mocked-Paystack ceiling — see Verification cap)

---

## 1. Summary

Nigerian partners can now get paid. A flagged NG partner picks **Nigeria** in the earnings country picker (via the picker's `extraOptions` slot — never the Stripe allowlist), connects a bank through a Paystack bank-details form (bank picker → 10-digit NUBAN → verified holder name → connect), and from then on every NGN ticket sale on their partner brands records a `partner_splits` row and pays them 10% of Mingla's platform fee via a **post-hoc Paystack Transfer from Mingla's balance** (SPEC §4.1 Option B). The LIVE NGN checkout is byte-untouched; the split fan-out in `paystack-webhook` is constitutionally fail-soft (a split failure can never fail a checkout, a finalize, or the webhook ack — proven at runtime by T-8). A */30 cron sweep retries pending transfers (absorbing T+1 settlement/OTP/balance gaps), `transfer.*`/`refund.processed` webhooks drive the full lifecycle including the honest no-claw-back `reversal_owed_at` marker, and `/partner/brands` labels went provider-neutral without touching the frozen status values or column names.

## 2. SPEC success-criteria coverage

| SC | Verified by | Commit | Result |
|---|---|---|---|
| SC-1 | T-16 (picker `extraOptions` NG row + fork), T-1 `list_banks` (mocked live list); non-partner card untouched (screen branch order pins it) | 49bd06da9 / dc3607825 | ✓ (static + mocked runtime) |
| SC-2 | T-1 resolve → holder name; form invalidation contract (T-16 `onAccountChange`/`onPickBank` assertions); 422 → inline E1, NO recipient (T-1/validation tests) | dc3607825 / 49bd06da9 | ✓ |
| SC-3 | T-1 create_recipient (200, UPSERT last4-only, `partner_country='NG'`, audit); T-2 PII hunt (full NUBAN absent from every write + audit + error body); card flip = state-8 loading hold + status refetch (T-16) | dc3607825 / 49bd06da9 | ✓ (mocked runtime) |
| SC-4 | T-3 both directions: paystack fn 409 `stripe_already_connected` (runtime, injected deps); stripe fn 409 `paystack_already_connected` (source-contract: guard between partner gate and account reuse) | dc3607825 | ✓ (paystack leg runtime; stripe leg structural — see cap) |
| SC-5 | T-4 (share = `Math.round(F * PARTNER_SHARE_OF_FEE)`, 15000→1500, 15005→1501), T-7 replay (one row, early return), T-14 (RPC `'paystack:'||reference` key + `ON CONFLICT DO NOTHING` + `provider='paystack'` + `transfer_currency='ngn'`) | e230ccef0 | ✓ |
| SC-6 | T-9 (success → `mark_partner_split_transferred` + first-split push ONCE with the idempotent key); `first_split_at` stamps via the UNCHANGED ORCH-1081 trigger (probe 6.4 asserts it still exists) | e230ccef0 | ✓ |
| SC-7 | **T-8 RUNTIME** — real webhook handler, split engine force-thrown: 200 ack, `received:true`, finalize called, confirmation dispatched, inbox `processed=true` + `error=null`, split ran strictly AFTER dispatch | e230ccef0 | ✓ (runtime, fails-on-revert proven) |
| SC-8 | Engine tests: no/detached recipient → `blocked_no_paystack` row, zero transfer calls; badge "Blocked — Paystack" (T-15) | e230ccef0 / 49bd06da9 | ✓ |
| SC-9 | T-10 family: insufficient balance → pending + SAME reference (no bump); `transfer.failed` → bump (NEW reference); 5th → `failed` + ops alert; sweep reconcile-first never double-initiates | e230ccef0 / dc3607825 | ✓ |
| SC-10 | T-12 family: pending → `reversed_pending` (sweep never pays); transferred → `reversal_owed_at` + audit + ops email, status STAYS `transferred`; idempotent replay no-op | e230ccef0 | ✓ |
| SC-11 | T-13 (trigger event/guards/COALESCE/active-only + no-RENAME); backfill statement (prod probe: 0 rows today); labels "Active"/"Payouts connected" (T-15); `deriveLinkStatus` untouched (zero diff) | e230ccef0 / 49bd06da9 | ✓ |
| SC-12 | `git diff origin/main...HEAD` = **0 lines** on `_shared/partnerSplits.ts`, `_shared/stripeWebhookRouter.ts`, `_shared/ticketCheckout.ts`, `ticket-checkout-create/index.ts`; orch-1052/1054/1081 + stripe webhook suites 48/48 green | — | ✓ |
| SC-13 | I-PROPOSED-T gate PASS (2159 files, 0 violations); T-16 asserts no `"NG"` in `stripeSupportedCountries.ts` | 27f9f75af | ✓ |

## 3. Files changed (24 files, +5,625 / −68)

**New (backend):** `supabase/migrations/20261228000000_orch_1331_partner_paystack_rail.sql` (+485) · `supabase/migrations/__tests__/orch_1331_partner_paystack_rail.test.ts` (+246) · `supabase/functions/_shared/paystackPartnerSplits.ts` (+758) · `supabase/functions/partner-paystack-onboard/index.ts` (+463) · `supabase/functions/partner-paystack-split-retry/index.ts` (+256) · 4 Deno test suites (+1,834 total).
**Modified (backend):** `_shared/paystack.ts` (+160, additive helpers + `PaystackApiError`) · `paystack-webhook/index.ts` (+59) · `_shared/paystackWebhookRouter.ts` (+9/−2, optional `paidAtIso` only) · `partner-stripe-onboard/index.ts` (+23, exclusivity guard only) · `supabase/config.toml` (+12, two entries).
**New (client):** `mingla-business/src/services/partnerPaystackService.ts` (+136) · `src/hooks/usePartnerPaystack.ts` (+142) · `src/components/partner/PartnerPaystackOnboardForm.tsx` (+545) · `src/components/partner/__tests__/orch_1331_partner_paystack_ui.test.ts` (+211).
**Modified (client):** `app/partner/earnings.tsx` (+260/−62) · `app/partner/brands.tsx` (+8/−3, labels/doc only) · `src/services/partnerSplitsService.ts` (+8/−1, type + select only).
**Gates/CI:** `.github/scripts/strict-grep/orch-1331-partner-split-fail-soft.mjs` (+182) · `orch-1331-share-single-source.mjs` (+151) · `.github/workflows/supabase-migrations-and-stripe-deno.yml` (+127: 3 jobs + path filters).

## 4. Data-model changes (migration `20261228000000`, NOT applied — operator/orchestrator owns apply)

- **NEW `partner_paystack_accounts`**: recipient mirror keyed `UNIQUE(account_id)` + `UNIQUE(recipient_code)`; `account_number_last4` ONLY (PII comment); RLS ENABLE+FORCE, `partner_paystack_self_select` = self OR `is_admin_user()`; zero write policies (service-role only); index on `account_id`.
- **`partner_splits` additive widen**: `provider` (`stripe|paystack`, default `stripe`), `payout_reference`, `attempt_count`, `reversal_owed_at`; status CHECK dropped-by-introspection + re-added with `blocked_no_paystack` (widen-only — prod probe confirms all existing values fit; table is currently 0 rows); column-reuse COMMENTs on `stripe_application_fee_id` (`'paystack:'||reference`) + `stripe_transfer_id` (TRF code).
- **RPCs**: `mark_partner_split_failed` re-created (allowlist + `blocked_no_paystack`, same signature); NEW `record_paystack_partner_split_attempt` / `mark_paystack_partner_split_attempted` / `bump_paystack_partner_split_attempt` — all SECURITY DEFINER, `search_path 'public','pg_temp'`, REVOKE PUBLIC + GRANT service_role only.
- **Trigger** `partner_brand_links_paystack_connected_trigger` AFTER UPDATE OF `paystack_subaccount_code` ON `brands` → stamps `owner_stripe_connected_at` (COALESCE, active links only; column NOT renamed) + defensive backfill (prod probe: 0 rows).
- **Cron** `orch_1331_partner_paystack_split_retry` `*/30 * * * *` → `POST /functions/v1/partner-paystack-split-retry` (vault-sourced URL + service key; NOTICE advisories; prod probe: both vault secrets present, no name collision).
- **Probes** (§6): table / provider column / widened CHECK text / both triggers (new + ORCH-1081 first-split) / cron row — RAISE EXCEPTION on miss.

## 5. Edge functions touched (deploy from MERGED main — orchestrator-owned; NOT deployed by me)

| Function | Change | `verify_jwt` to preserve |
|---|---|---|
| `partner-paystack-onboard` | NEW | **true** (new config.toml entry) |
| `partner-paystack-split-retry` | NEW | **false** (service-role header gate in-fn; new config.toml entry) |
| `paystack-webhook` | MODIFIED (fail-soft fan-out + transfer/refund routing) | **false** (unchanged) |
| `partner-stripe-onboard` | MODIFIED (409 exclusivity guard only) | **true** (unchanged) |
| shared: `_shared/paystack.ts`, `_shared/paystackPartnerSplits.ts` (new), `_shared/paystackWebhookRouter.ts` | additive | rides consumers above |

## 6. Regression tests added (all NEW files — append-only honored; zero existing tests modified)

| Suite | Path | Count |
|---|---|---|
| Engine T-4..T-7, T-9..T-12 | `supabase/functions/_shared/__tests__/paystackPartnerSplits.orch1331.test.ts` | 24 |
| Onboard T-1/T-2/T-3 | `supabase/functions/_shared/__tests__/partnerPaystackOnboard.orch1331.test.ts` | 16 |
| Sweep T-10 leg | `supabase/functions/_shared/__tests__/partnerPaystackSplitRetry.orch1331.test.ts` | 7 |
| SQL contract T-13/T-14 | `supabase/migrations/__tests__/orch_1331_partner_paystack_rail.test.ts` | 10 |
| **T-8 fail-soft RUNTIME** | `supabase/functions/_shared/__tests__/paystackWebhookFailSoft.orch1331.test.ts` | 1 |
| Client T-15/T-16 | `mingla-business/src/components/partner/__tests__/orch_1331_partner_paystack_ui.test.ts` | 20 |

**Fails-on-revert (true LINE DELETION, restore, re-pass — all at commit `49bd06da9`):**
1. `fails-on-revert verified at 49bd06da9` — deleted the webhook fan-out try/catch (bare call left) → **T-8 FAILED** + `orch-1331-partner-split-fail-soft.mjs` **FAILED** ("call is NOT inside its own try/catch") → restored → both PASS.
2. `fails-on-revert verified at 49bd06da9` — deleted the `PARTNER_SHARE_OF_FEE` import + `Math.round(... * PARTNER_SHARE_OF_FEE)` line (drifted local `Math.floor(* 0.1)`) → **T-4 rounding-parity FAILED** (15005→1500 not 1501) + `orch-1331-share-single-source.mjs` **FAILED** (3 violations) → restored → PASS.
3. `fails-on-revert verified at 49bd06da9` — deleted the brands trigger block from the migration → **T-13 FAILED** (3 assertions) → restored → PASS (10/10).
4. `fails-on-revert verified at 49bd06da9` — deleted the earnings NG-fork block → **T-16 FAILED** (1/20) → restored → PASS (20/20).

**Gate self-tests:** fail-soft gate 5/5 BAD shapes rejected + GOOD passes; share gate 4/4 BAD shapes rejected + GOOD passes; both PASS against the live tree.

## 7. Old → New receipts

### supabase/migrations/20261228000000_orch_1331_partner_paystack_rail.sql (NEW)
**Before:** no Paystack partner identity; `partner_splits` was Stripe-only (7-status CHECK); `owner_stripe_connected_at` only stamped from Stripe `charges_enabled`.
**Now:** full DB rail per SPEC §4.2 (table/RLS/RPCs/trigger/backfill/cron/probes), idempotent end-to-end.
**Why:** SC-3/5/9/11. ~485 lines.

### supabase/functions/_shared/paystack.ts
**Before:** initialize/verify/banks/resolve/subaccount helpers only — no transfer surface.
**Now:** + `PaystackApiError` (HTTP status carrier), `paystackCreateTransferRecipient`, `paystackDeleteTransferRecipient`, `paystackInitiateTransfer` (`source:"balance"`, reference idempotency), `paystackFetchTransfer`. Additive only; existing exports byte-identical.
**Why:** SPEC §4.3; bodies exactly per the §4.1 doc-verified param table. ~160 lines.

### supabase/functions/_shared/paystackPartnerSplits.ts (NEW)
**Before:** an NGN sale could never produce a partner split (money leg failed silently).
**Now:** the Option-B engine — fee from `orders.stripe_application_fee_amount_cents`, brand via the canonical orders→events join, partner pinned at verified `paid_at`, share = `Math.round(fee * PARTNER_SHARE_OF_FEE)` (imported — single source), record-first idempotent ledger, eligibility → `blocked_no_paystack`/`blocked_currency_mismatch`, `psplit_<id>_a<n>` transfer references (bump ONLY on definitive failure), OTP/balance operational-block handling with deduped ops alerts, `transfer.*` + `refund.processed` lifecycle incl. `reversal_owed_at`, first-split push mirror (30s window, idempotent key). Deps-injected for mocked tests.
**Why:** SPEC §4.5 in full. ~758 lines.

### supabase/functions/paystack-webhook/index.ts
**Before:** routed only `charge.success`; everything else audited no-op.
**Now:** captures `{reference, orderId, paidAtIso}` on finalized/replayed charges and runs the split fan-out strictly AFTER `dispatchTicketConfirmation` inside a dedicated catch-and-log block (never sets `processingError` — I-PROPOSED-1331-PARTNER-SPLIT-FAIL-SOFT comment on-site); routes `transfer.success|failed|reversed` + `refund.processed` inside the normal retry-semantics try; `refund.failed|pending|processing` → `paystack.webhook_unhandled_refund_state` audit no-op. Signature verification + inbox untouched.
**Why:** SPEC §4.6. +59 lines.

### supabase/functions/_shared/paystackWebhookRouter.ts
**Before:** `PaystackChargeResult` = status + orderId.
**Now:** + optional `paidAtIso` (from the verified txn), set on the finalize and ticket-replay paths. Nothing else changed.
**Why:** SPEC §4.6.1 BINDING plumb. +9/−2.

### supabase/functions/partner-paystack-onboard/index.ts (NEW)
**Before:** no partner-side Paystack backend.
**Now:** action-multiplexed fn (list_banks/resolve_account/create_recipient/status/disconnect) with the `partner_enabled` 403 gate (Stripe-fn parity), 409 `stripe_already_connected` exclusivity, resolved-name recipient create, last4-only UPSERT + audit, `partner_country='NG'` non-fatal stamp, soft-detach + best-effort recipient delete, `_shared/cors.ts` headers (x-client-info included), exported `handler` + `import.meta.main` serve guard (ORCH-1205 testability pattern).
**Why:** SPEC §4.4. ~463 lines.

### supabase/functions/partner-stripe-onboard/index.ts
**Before:** no knowledge of the Paystack rail.
**Now:** ONE additive guard after the partner gate / before account create-or-reuse: active `partner_paystack_accounts` row → 409 `paystack_already_connected`. Everything else byte-identical.
**Why:** SPEC §4.4 mirror guard (I-PROPOSED-1331-PARTNER-PAYOUT-RAIL-EXCLUSIVE). +23 lines.

### supabase/functions/partner-paystack-split-retry/index.ts (NEW)
**Before:** a pending split had no retry path.
**Now:** service-role-gated sweep (reconcile-stuck-checkouts auth mirror): cap-finalization pass (idempotent via the status flip) then a 20-row oldest-first batch — reconcile-before-retry when a transfer_code exists (never double-initiates), eligibility re-check, per-row try/catch, `{scanned, transferred, retried, skipped, failed}` response.
**Why:** SPEC §4.7. ~256 lines.

### mingla-business/src/services/partnerPaystackService.ts + src/hooks/usePartnerPaystack.ts (NEW)
**Before:** no client surface.
**Now:** key factory + typed wrappers (unwrapError parity with brandPaystackService); hooks mirror usePartnerStripe (`staleTime:0` status; banks 24h stale; create/disconnect invalidate BOTH rails' status keys; every mutation has `onError`).
**Why:** SPEC §4.8. ~278 lines.

### mingla-business/src/components/partner/PartnerPaystackOnboardForm.tsx (NEW)
**Before:** an NG partner hit a dead end.
**Now:** the DESIGN §3 form verbatim — anatomy rows 1–9, §3.2 state machine (incl. the BINDING `isPending || isSuccess` connect hold), §7 copy strings byte-exact (C2–C12, E1–E5), verbatim ORCH-1165 bank sheet (42dp Android Done-bar clearance keyed on keyboard-open, opaque `#14110f`, dedupe-by-code), confirm-name entrance gated on `useReducedMotion`, live regions, §12 testIDs.
**Why:** DESIGN §3 (supersedes SPEC §4.9 client detail). ~545 lines.

### mingla-business/app/partner/earnings.tsx
**Before:** Stripe-only country picker; NG unreachable; "Stripe"-hardcoded copy; badge map lacked the Paystack block reason.
**Now:** NG via `extraOptions` on the frozen picker; DESIGN §1.4 picker-replacement fork (`selectedCountry==="NG"` → form; back button clears country + re-opens the sheet via `defaultOpen`); PAYOUTS READY (Paystack) card (§4.2 grammar + C15 disconnect confirm, `selectedCountry` reset on detach); `countryLocked` from either rail; paystack status/error join the screen-level gates AFTER the non-partner branch (a non-partner's 403 can never mask their card); KAV wrap + `keyboardShouldPersistTaps`/`on-drag`; C18 copy generalizations; `blocked_no_paystack` badge.
**Why:** DESIGN §2 rows 1–7 + §4. +260/−62.

### mingla-business/app/partner/brands.tsx + src/services/partnerSplitsService.ts
**Before:** "Awaiting Stripe"/"Stripe connected" labels; split type without the Paystack reason/provider.
**Now:** "Awaiting payouts"/"Payouts connected" (labels ONLY — `awaiting_stripe` value + `deriveLinkStatus` + timestamp columns frozen); type union + optional `provider`/`payout_reference` + `provider` in the select.
**Why:** DESIGN §5 / SPEC §4.8. +16/−4.

### Gates + CI
**Before:** no regression armor on the fail-soft/one-rate contracts; new suites unwired (docs-only-CLOSE hazard).
**Now:** two self-testing strict-grep gates + three named CI jobs (`orch-1331-partner-paystack-deno-tests` incl. the import-map T-8 leg, `orch-1331-business-jest`, `orch-1331-partner-paystack-strict-grep`) with path filters over the guarded SOURCE trees (`paystack-webhook/**`, both new fns, `ticket-checkout-create/**`, the client leg).
**Why:** SPEC §9. +460 lines.

## 8. Cross-surface impact

| Surface | Affected? | What changes | Parity |
|---|---|---|---|
| Consumer iOS / Android (`app-mobile/`) | NO | zero files touched | n/a |
| Buyer/anonymous Web (checkout) | NO (must be unchanged) | NGN checkout byte-identical (SC-12 zero-diff); split runs post-finalize, fail-soft backend-only | automatic (backend) |
| Business iOS | **YES** | NG in picker → bank form → PAYOUTS READY card; badge; neutral labels | automatic (shared RN code) |
| Business Android | **YES** | same + 42dp Done-bar clearance in the bank sheet | automatic (shared code) |
| Business Web preview | **YES (incidental)** | same screens render via RN-web; form is plain (no WebBrowser dep); RN-web Alert fallback = shipped Stripe-disconnect pattern | automatic (shared code) |
| Admin Web | NO | additive schema; existing definer reads unaffected | n/a |
| Backend (`supabase/`) | **YES** | shared substrate per §4/5 above | n/a |

## 9. Verification / smoke result (all runs local, pasted counts)

- **New Deno suites: 58/58 PASS** (engine 24 + onboard 16 + sweep 7 + SQL contract 10 + T-8 runtime 1).
- **Pre-existing suites (SC-12/T-17): 48/48 PASS** — orch_1054 happy+adversarial, orch_1052, orch_1054 SQL, orch_1081, stripeWebhookRouter, stripeWebhookSignature.
- **Client jest: 20/20 PASS** (T-15/T-16). Adjacent suites (KeyboardRoot, businessNotificationRouting, orch_1082): 120 passed / **5 failed — PROVEN PRE-EXISTING** (identical 5 failures reproduced after `git stash -u` of all ORCH-1331 changes: 4× ENOENT on `src/components/brand/TripBrandWizard.tsx` — a file absent from origin/main — and 1× mock-shape `update().eq().select` in businessNotificationRouting; neither file touched by this ORCH). Known other pre-existing reds NOT attributed: `shell.test.ts` tax-jurisdiction [ORCH-1330], `VenueCreatorWizard.ve2.test.ts` [ORCH-1345].
- **`deno check`: 7/7 touched fns/modules PASS.**
- **Gates:** both new gates self-test + live PASS; I-PROPOSED-T (2159 files, 0 violations), I-38 (530 files, 0), I-39 (530 files, 0), ORCH-0785-C escape gate PASS (run defensively; no email/HTML strings were authored — ops alerts ride the shared `renderTransactionalEmail` pipeline).
- **`tsc --noEmit` (mingla-business):** zero errors in any ORCH-1331 file (the repo carries a large pre-existing whole-project error baseline in `packages/**` and older app files — untouched).
- **Migration prefix re-scan (implementation-time):** origin/main frontier `20261227000000`; highest across ALL sibling worktrees `20261227000000` → **`20261228000000` confirmed monotonic and unclaimed**.
- **Read-only prod probes (Mgmt MCP `execute_sql`, SELECT-only):** backfill predicate = **0 rows** (as spec expected); `partner_splits` = 0 rows (CHECK widen trivially safe; live CHECK = the exact ORCH-1054 7-value set under the expected constraint name); `is_admin_user()` present; vault `supabase_url` + `service_role_key` both present; no pre-existing cron/table name collisions.
- **Device/sim smoke: NOT run** — client behavior verified by static/source contract + type-level only; see Verification cap.

## 10. Known issues / deferred

- **Verification cap (honest, per SPEC):** no live Paystack calls were made (LIVE mode, real money). Recipient creation, transfers, balance behavior, and real `transfer.*`/`refund.*` payload shapes are **mocked-fetch verified only**. The `refund.processed` parent-reference field is implemented as `transaction_reference` with an object-form fallback and carries the SPEC's `[verify-in-webhook-log]` marker — pin it from a captured LIVE payload during the post-deploy smoke.
- **SC-4 stripe-direction runtime ceiling:** `partner-stripe-onboard` serves at module load (no exported handler), so its 409 leg is verified structurally (source-contract test pins the guard's content and position); the tester can add a serve-shim runtime angle.
- **Non-partner background 403s:** `usePartnerPaystackStatus` is enabled on `isAuthReady` (per SPEC §4.8), so a NON-partner's status query 403s harmlessly in the background (UI unaffected — the not-a-partner branch renders first). Cosmetic console noise only; flagged for the tester.
- **No sim/device run** — business iOS/Android/web visual smoke is outstanding (tester + post-deploy manual smoke per SPEC §11).
- No `[TRANSITIONAL]` markers were introduced.

## 11. Operator action required (orchestrator/Seth — NOT performed by me)

1. **Migration apply** (at CLOSE, after merge). Mandated copy-paste form:
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/orch-1331-[partner-paystack-rail]" && /Users/sethogieva/bin/supabase db push --linked
   ```
   **⚠ DRIFT FLAG (pre-checked):** `supabase migration list --linked` shows **no remote-only rows** (the STOP condition is absent) **but** every migration since ~`20261208` is LOCAL-ONLY in the remote history table (applied to prod via the Mgmt-API path without history rows — long-standing house drift). A naive `db push --linked` would re-run all of them plus mine. **Recommended:** apply `20261228000000_orch_1331_partner_paystack_rail.sql` via the established safe-migration Mgmt-API protocol instead (the file is idempotent end-to-end and its §6 probes self-verify), or repair history first. All §4.2 pre-flight assumptions were probe-verified against live prod (see §9).
2. **Edge deploys from MERGED main:** `partner-paystack-onboard` (verify_jwt=true), `partner-paystack-split-retry` (verify_jwt=false), `paystack-webhook` (verify_jwt=false), `partner-stripe-onboard` (verify_jwt=true). Verify versions with a curl probe post-deploy.
3. **Client:** business web via Vercel `[deploy]`; native rides the NEXT business build — **NO `eas update` for mingla-business** (COMMS-0052/0063).
4. **OPS prerequisites before the first real payout (SPEC §10):** OPS-1 balance funding (Manual Payouts or NGN float), OPS-2 disable transfer OTP, OPS-3 confirm the live webhook receives `transfer.*`/`refund.*`. Until OPS-1/2: splits sit `pending` with one ops alert; the sweep self-heals after.
5. Optional env: `PAYSTACK_PARTNER_ALERT_EMAILS` (comma list; defaults to `seth@usemingla.com`).

## 12. Config dependency-walk (config-layer touches — REVIEW requirement)

| Changed key / block | Every consumer | Compatibility |
|---|---|---|
| `config.toml` `[functions.partner-paystack-onboard] verify_jwt = true` | Supabase deploy pipeline (`deploy-functions.yml` / CLI) applies it to the NEW fn only; client calls via `supabase.functions.invoke` attach the session JWT automatically | NEW key — zero existing consumers; mirrors `partner-stripe-onboard` |
| `config.toml` `[functions.partner-paystack-split-retry] verify_jwt = false` | deploy pipeline; the pg_cron `net.http_post` (registered by THIS migration) which sends the service-role Bearer; the fn's first-statement key gate | NEW key — zero existing consumers; mirrors `reconcile-stuck-checkouts` |
| workflow `supabase-migrations-and-stripe-deno.yml` path filters (+9 paths) | GitHub Actions trigger evaluation only — widens WHEN the workflow runs; never narrows (all pre-existing paths kept verbatim) | additive; existing jobs unaffected |
| workflow: 3 new jobs (`orch-1331-partner-paystack-deno-tests`, `orch-1331-business-jest`, `orch-1331-partner-paystack-strict-grep`) | GitHub Actions; branch-protection required-checks list (new checks appear; existing required checks untouched) | additive; pinned tooling per house rule (deno 1.46.x, node 20, `npm ci` from `mingla-business/package-lock.json`); YAML validated |
| `.github/scripts/strict-grep/orch-1331-*.mjs` (NEW ×2) | only the new workflow jobs invoke them; self-tests gate the real runs | NEW files; registry-pattern compliant |

Note on gate location: SPEC §8's allowlist wrote `scripts/orch-1331-*.mjs`; the repo's canonical gate directory (and the SPEC's own §5.9/§9 "existing gate pattern" + the `i-proposed-t` sibling it cites) is `.github/scripts/strict-grep/` — placed there. Zero-behavior deviation; flagged for REVIEW.

Note on CORS: SPEC §4.4 said "same literal object as brand-paystack-onboard"; the orchestrator dispatch said "CORS via `_shared/cors.ts`". Used `_shared/cors.ts` (a strict superset carrying all four required entries incl. the mandatory `x-client-info`, + `accept-language` + Allow-Methods) — runtime-asserted by the T-1 CORS test.

## 13. Discoveries for Orchestrator

- **DISC-1331-1 (P2, CI-hygiene):** `mingla-business/src/wrappers/__tests__/KeyboardRoot.test.tsx` has 4 pre-existing failures — ENOENT on `src/components/brand/TripBrandWizard.tsx`, a file that no longer exists on origin/main (deleted/renamed by a prior ORCH without a `[TEST-MOD-APPROVED]` test update). Latent main-red in any job that globs it.
- **DISC-1331-2 (P3, CI-hygiene):** `src/services/__tests__/businessNotificationRouting.test.ts` — 1 pre-existing failure: the test's supabase mock lacks `.update().eq().select()` chaining that the service now uses (mock drift, not product breakage).
- **DISC-1331-3 (P1-at-CLOSE, process):** remote migration HISTORY drift — everything since ~`20261208` is local-only in `supabase_migrations` history while live in prod. Any future naive `db push` re-runs ~20 migrations. Worth a one-time history repair ORCH.
- **DISC-1331-4 (P3, UX-polish):** non-partner accounts fire background 403s on the paystack status query (`staleTime:0` + window-focus refetch). Harmless; could gate `enabled` on `partner_enabled` in a polish pass (would need the SPEC hook contract amended).
- **Forward note honored (ORCH-1332):** no changes to the accept path; the restored gate MUST be provider-aware (an NGN brand + active `partner_paystack_accounts` row must pass).

## Invariant preservation (Pre-Flight §6 / Post-Flight re-check)

I-PROPOSED-PARTNER-TRANSFER-SOURCE-CURRENCY ✓ (NGN-only, `transfer_currency='ngn'` pinned in the RPC, defensive order-currency guard) · I-PROPOSED-T ✓ (gate PASS) · RSVP chip-in invariants ✓ (contribution path untouched; T-8 stub exercises the lookup unchanged) · I-38/I-39 ✓ (gates PASS; all new Pressables labeled ≥44pt effective) · ORCH-1188 finalize contract ✓ (zero diff) · ANDROID_GLASS_USES_OPAQUE_FALLBACK ✓ (opaque `#14110f` sheet) · I-KEYBOARD-NEVER-BLOCKS-INPUT ✓ (KAV + persistTaps + 42dp clearance) · Zustand/query-key rules ✓ (factories only; no server state in Zustand) · tests-append-only ✓ (new files only). New DRAFT invariants I-PROPOSED-1331-{PARTNER-SPLIT-FAIL-SOFT, PARTNER-SHARE-FROM-PLATFORM-FEE, PARTNER-PAYOUT-RAIL-EXCLUSIVE, NUBAN-NEVER-PERSISTED, LINK-COLUMNS-FROZEN} implemented + enforced (gates/tests) — orchestrator flips ACTIVE at CLOSE.
