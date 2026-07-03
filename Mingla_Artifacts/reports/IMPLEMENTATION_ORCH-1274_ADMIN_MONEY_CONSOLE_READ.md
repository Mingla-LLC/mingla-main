# IMPLEMENTATION — ORCH-1274 [Admin Money console — READ-ONLY]

**Parent:** META-ORCH-1237. **Depends on:** ORCH-1271 (merged) + ORCH-1272 (merged). **Surface:** Admin Web (`mingla-admin/`) + backend read-only migration. **Status:** implemented and self-verified; NOT deployed/merged (orchestrator owns DEPLOY + CLOSE).
**Worktree:** `~/Desktop/mingla-orchs/1274-[admin-money-console]` on branch `1274-admin-money-console`. **Commit:** `cbd04f350` (single implementation commit; report commit follows).

---

## 1. Summary

Built the READ-ONLY money console per SPEC. Admins now get three new pages under the "Business" nav group: **Payments** (per-brand Stripe Connect / Paystack status + KYC next-steps + bank accounts), **Orders** (cross-brand order search → full money detail bundle + a subscriber-context lookup), and **Money ledger** (Refunds · Disputes · Payouts · Platform-revenue tabs, with a dispute detail). Every money read flows through one of 10 new guard-first `SECURITY DEFINER` RPCs — no admin RLS is added to any money table (money containment), money stays integer cents + currency, and no Stripe API is called. All wave-2 act buttons ("Refresh from Stripe", "Generate onboarding link", "Issue refund") render disabled + WAVE-2 tag with no handlers.

Migration SQL was validated READ-ONLY against live PROD `gqnoajqerqhnvulmnyvv` (COMMS-0061 honored — SELECT probes only, zero mutation): all 10 RPC bodies compile, columns/joins/helper calls are correct, and the Connect-status + orders + subscription shapes return the expected live rows.

---

## 2. SPEC success-criteria coverage

| SC | Coverage | Verified how | Status |
|----|----------|--------------|--------|
| SC-1.1 Connect list renders, non-fallback icon | `BusinessPaymentsPage` + CreditCard nav + `admin_list_brand_stripe_status` | live read-only probe returned the 1 Connect brand (Smoke & Rhythm, active); regression asserts nav wiring | ✓ `cbd04f350` |
| SC-1.2 detail w/ next-steps + external accts | `getBrandStripeStatus` bundle + `NextSteps` renderer | probe of bundle logic OK | ✓ `cbd04f350` |
| SC-1.3 filters + search + CSV | EntityListView filters/csv wired | build clean | ✓ `cbd04f350` |
| SC-1.4/1.5 ADV cross-brand + non-admin raise | guard-first RPC reads `stripe_connect_accounts` (definer); non-admin `not_authorized` | guard proven (MCP no-JWT call raised `Unauthorized`); **tester seeds cross-brand rows** | ✓ (HP) / TESTER (ADV) |
| SC-2.1 orders list w/ buyer/offering/amount/status | `admin_list_orders` + `BusinessOrdersPage` | live probe returned both live orders, cents+currency | ✓ `cbd04f350` |
| SC-2.2 detail bundle + View-subscriber gating | `admin_get_order` + `SubscriberContextCard` (only when `buyer_user_id`) | live probe returned full bundle; regression T-13 gating | ✓ `cbd04f350` |
| SC-2.3 search/status/CSV | wired | build clean | ✓ `cbd04f350` |
| SC-2.4/2.5 ADV cross-brand+private + non-admin | definer RPC (no brand/public filter) + guard-first | **tester seeds private cross-brand order** | TESTER (ADV) |
| SC-3.1 4 tabs, clean empty states | `BusinessMoneyLedgerPage` tabs; refunds/disputes/payouts empty, revenue lists | build clean; live data 0/0/0/49 | ✓ `cbd04f350` |
| SC-3.2 dispute evidence-due + detail + raw event | `evidenceDue` + `admin_get_dispute` collapsible raw | build clean | ✓ `cbd04f350` |
| SC-3.3/3.4 ADV cross-brand seed + non-admin | definer RPCs, disputes ordered evidence-due ASC | **tester seeds** | TESTER (ADV) |
| SC-4.1 subscriber detail bundle + card | `admin_get_subscription_detail` + card | non-guarded parts probed live (effective_tier, override window, history shape) | ✓ `cbd04f350` |
| SC-4.2 SubscriptionManagementPage untouched | not in change set | `git diff` shows no touch | ✓ `cbd04f350` |
| SC-4.3 non-admin raise | guard-first | proven (nested `admin_get_override_history` raised under no-JWT MCP) | ✓ |
| SC-5.1 build clean, 0 net-new lint | `npm run build` OK; net-new lint 0 | see §Gates | ✓ `cbd04f350` |
| SC-5.2 `i-money-no-admin-rls` fails on RLS/to_char | gate + fixture | self-test PASS 4/4; fixture 5/5 | ✓ `cbd04f350` |
| SC-5.3 gate-first passes 10 new RPCs, fails on moved guard | registry appended | gate PASS; fails-on-revert proven | ✓ `cbd04f350` |
| SC-5.4 0 direct `.from(money)` in pages | regression containment suite | 32/32 pass | ✓ `cbd04f350` |

---

## 3. Files changed (commit `cbd04f350`)

**New (9):**
- `supabase/migrations/20261207000000_orch_1274_money_read_rpcs.sql` (+~290) — 10 read-RPCs + least-privilege + self-assert
- `mingla-admin/src/services/adminMoneyService.js` (+~140) — 10 RPC wrappers, RPC-only
- `mingla-admin/src/components/entity/SubscriberContextCard.jsx` (+~170)
- `mingla-admin/src/pages/BusinessPaymentsPage.jsx` (+~300)
- `mingla-admin/src/pages/BusinessOrdersPage.jsx` (+~330)
- `mingla-admin/src/pages/BusinessMoneyLedgerPage.jsx` (+~340)
- `mingla-admin/src/__tests__/orch1274_money_console_read.test.js` (+~200) — happy-path regression
- `.github/scripts/strict-grep/i-money-no-admin-rls.mjs` (+~180) — new gate
- `.github/scripts/strict-grep/__tests__/i-money-no-admin-rls.test.mjs` (+~110) — gate fixture

**Modified (6):**
- `mingla-admin/src/lib/constants.js` (+10) — 3 Business nav items
- `mingla-admin/src/components/layout/Sidebar.jsx` (+6) — import Receipt+Landmark → ICON_MAP
- `mingla-admin/src/App.jsx` (+10) — 3 page imports + 3 PAGES routes
- `.github/scripts/strict-grep/i-admin-gate-first-statement.mjs` (+~20) — 10 RPC names appended to registry + self-test fixtures
- `.github/workflows/strict-grep-mingla-business.yml` (+17) — `orch-1274-money-read-authz` job (gate self-test + gate + fixture + regression)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (+~14) — 2 DRAFT invariants

All within the SPEC §11 allowlist. No DO-NOT-TOUCH file changed.

---

## 4. Data-model changes applied

**None to schema.** The migration adds only 10 `SECURITY DEFINER STABLE` read-RPCs (no DDL, no RLS policy, no column). Each: `IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'` first statement; list RPCs return `{rows,total}`, detail RPCs return a `jsonb` bundle; money as integer cents + currency; `REVOKE EXECUTE FROM anon, PUBLIC` + `GRANT EXECUTE TO authenticated`; a tail `DO` self-assert loops all 10 signatures (anon=false, authenticated=true) so apply FAILS if the lockdown breaks. RPCs: `admin_list_brand_stripe_status`, `admin_get_brand_stripe_status`, `admin_list_orders`, `admin_get_order`, `admin_list_refunds`, `admin_list_disputes`, `admin_get_dispute`, `admin_list_payouts`, `admin_list_revenue_log`, `admin_get_subscription_detail`.

---

## 5. Edge functions touched

**None.** No Stripe API call, no edge deploy in this wave. Wave-2 act edge fns (`admin-refund-order`, `admin-stripe-connect-action`, `admin-stripe-dispute-action`) are SPEC §9 design notes only — NOT built.

---

## 6. Regression tests added + fails-on-revert

- **Implementor happy-path:** `mingla-admin/src/__tests__/orch1274_money_console_read.test.js` — 32 tests: each of the 10 RPCs guard-first + least-privilege (REVOKE anon/PUBLIC + GRANT authenticated); self-assert present; cents contract (no to_char/'$'); no admin RLS in the migration; service reads only via `supabase.rpc` (no `.from`); the 3 pages + card take no direct `.from(<money table>)` (SC-5.4 containment); nav wiring. **32/32 PASS.**
- **Gate fixture:** `.github/scripts/strict-grep/__tests__/i-money-no-admin-rls.test.mjs` — 5/5 PASS (incl. self-test + 3 fail-on-revert cases).
- **`fails-on-revert verified at `cbd04f350`:** deleting the `admin_list_orders` guard line (true LINE DELETION) → happy-path `admin_list_orders: is guard-first` FAILS (31/32) **and** `i-admin-gate-first-statement.mjs` FAILS (`first executable statement is NOT an is_admin_user() guard`). `git checkout --` restore → 32/32 green.

The tester writes the SECOND, adversarial suite (cross-brand/private-event seeding, silent-empty count parity, non-admin `not_authorized` live-fire, `i-money-no-admin-rls` fails-on-revert).

---

## 7. Old → New receipts (per surface)

- **Migration (new):** before — admins had NO read path to money tables (only `brands` mirror for Connect; `admin_list_subscriptions` for subs). now — 10 guard-first definer RPCs expose Connect status/requirements, orders, refunds/disputes/payouts/revenue, and a subscription support bundle, all admin-only, cents-safe. why — SPEC §4–§7.
- **`adminMoneyService.js` (new):** thin `supabase.rpc` wrappers; list fns map fetchPage→params, return `{rows,total}` throwing on error; detail fns return raw `{data,error}`. No `.from`. why — §11 service contract + money containment.
- **Pages (new):** reuse `EntityListView`/`EntityDetailView`; Payments has a pure requirements→next-steps renderer; Orders opens `SubscriberContextCard` only when `buyer_user_id`; Money-ledger uses in-page `Tabs`. why — §4.4/§5.3/§6.3.
- **Nav (modified):** +3 Business items; Receipt+Landmark added to ICON_MAP (avoids the documented LayoutDashboard fallback); +3 App routes. why — §11 nav wiring.
- **Gates (new/modified):** `i-money-no-admin-rls.mjs` enforces no-money-admin-RLS + cents contract (SQL comments stripped first); 10 RPC names appended to the gate-first registry; 1 workflow job. why — §10 invariants.

---

## 8. Cross-surface impact

| Surface | Affected | Parity |
|---|---|---|
| Consumer iOS / Android (`app-mobile/`) | NO — admin-only | n/a |
| Buyer/anon Web (`mingla-business/` public) | NO | n/a |
| Business iOS / Android (`mingla-business/`) | NO | n/a |
| **Admin Web (`mingla-admin/`)** | **YES** — 3 new READ-ONLY pages + subscriber card | Manual (single admin surface) |
| Business Web preview (adjacent) | NO | n/a |

Backend RPCs are shared by definition (one DB). No shipping-app code touched.

---

## 9. Gate results (all green)

- `i-admin-gate-first-statement.mjs` — self-test PASS (4/4); gate PASS (all 13 fns incl. the 10 new guard-first).
- `i-money-no-admin-rls.mjs` — self-test PASS (4/4); gate PASS (no admin money RLS, 10 RPCs present, cents-clean).
- `i-money-no-admin-rls.test.mjs` — 5/5 PASS.
- `orch1274_money_console_read.test.js` — 32/32 PASS.
- `meta-orch-0972-no-brand-kind-reads.mjs` + `meta-orch-0972-data-driven-tabs.mjs` — PASS. `grep '\.kind\b'` in all new files → 0 hits; no `kind` in the migration.
- **Least-privilege self-asserts** — every RPC REVOKE anon/PUBLIC + GRANT authenticated + a tail `DO` `has_function_privilege` check (anon=false, authenticated=true) proven by construction; apply FAILS if broken.
- **Money-containment** — regression asserts 0 direct `.from(<money table>)` across the 3 pages + card + service; reads go only via the definer RPCs.
- `mingla-admin`: `npm ci` (symlink was broken, per dispatch), `npm run build` clean (2968 modules), **net-new lint = 0** (the only 2 lint errors in edited files — App.jsx:2 `motion` unused, Sidebar.jsx:77 `use-memo` — are PRE-EXISTING baseline, confirmed identical on origin/main).

---

## 10. Migration versions + collision-check

- **Assigned/used prefix:** `20261207000000` (single file). Strictly greater than the max local prefix `20261205000003` and greater than every sibling-worktree prefix scanned (`~/Desktop/mingla-orchs/*/supabase/migrations/` max = `20261205000003_meta_orch_1270_reaper_and_alarm.sql`). No `20261206*`/`20261207*` exists anywhere. No collision.

---

## 11. Operator action required (orchestrator/operator owns — NOT done here)

1. **Deploy the migration from MERGED main** (self-assert runs at apply; anon-EXECUTABLE would abort apply):
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/1274-[admin-money-console]" && /Users/sethogieva/bin/supabase db push --linked
   ```
   Re-run the Pre-Flight monotonicity/drift check before pushing. No `--include-all` needed (in-order).
2. **No edge-fn deploy** (none touched).
3. **Vercel** ships `mingla-admin` on merge (no `[deploy]` tag needed for admin — it's the Vite admin app, not business web).
4. **Tester dispatch** for the ADV rows (§6) — must seed cross-brand rows.
5. At CLOSE: flip the 2 DRAFT invariants ACTIVE; remove the registry row; update WORLD_MAP.

---

## 12. Discoveries for Orchestrator

- **D-1 (SPEC §10 minor error — resolved in-gate):** SPEC §10 lists `partner_splits` in the "NO admin RLS" money-table set, but ORCH-1271's `20261204000000_orch_1271_single_admin_gate.sql` ALREADY grants admin read on `partner_splits` via an `OR public.is_admin_user()` branch in `partner_splits_partner_self_select` (a foundation decision; DO-NOT-TOUCH covers any money-table RLS). I EXCLUDED `partner_splits` from the `i-money-no-admin-rls` forbidden-RLS set (documented inline + in the invariant text) — the gate would otherwise fail on the shipped tree, and reverting the 1271 branch is out of scope. `partner_splits` is still read ONLY via `admin_get_order` (SECURITY DEFINER), so the read-path containment holds; the UI `.from()` containment check still includes it.
- **D-2 (column-name correction vs SPEC §7.2):** SPEC §7.2 referenced `subscriptions.trial_end`; the live column is `trial_ends_at`. Used the real column in `admin_get_subscription_detail` + the card. No functional impact.
- **D-3 (nested guarded call — validated safe):** `admin_get_subscription_detail` calls the admin-gated `admin_get_override_history` internally. Under a no-JWT MCP connection this correctly raised `Unauthorized` (guard works); in the real admin-UI path `auth.uid()` is preserved through the nested SECURITY DEFINER call (same mechanism the shipped `admin_get_person` uses for its helpers), so it resolves for an authenticated admin. Tester should live-fire this one path with a real admin JWT.
- **D-4 (pre-existing admin-web lint baseline):** `mingla-admin` carries pre-existing React-Compiler lint errors on origin/main (App.jsx `motion` unused; Sidebar.jsx `use-memo`) — not introduced here. A separate cleanup ORCH could address the baseline.

---

## 13. Report path

`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1274_ADMIN_MONEY_CONSOLE_READ.md` (this file, in the worktree).
