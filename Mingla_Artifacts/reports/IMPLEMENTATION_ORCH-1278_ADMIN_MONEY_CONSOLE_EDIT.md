# IMPLEMENTATION — ORCH-1278 [Admin Money console — WAVE-2 EDIT / ACT]

**Parent:** META-ORCH-1237. **Children-of:** ORCH-1271 (authz+audit FOUNDATION) + ORCH-1274 (money READ).
**Spec:** `Mingla_Artifacts/reports/SPEC_ORCH-1278_ADMIN_MONEY_CONSOLE_EDIT.md` (binding).
**Worktree:** `~/Desktop/mingla-orchs/1278-[admin-money-edit]/` on branch `1278-admin-money-act` — actual branch `1278-admin-money-edit`.
**Domain:** HIGHEST-RISK (real money). **Status:** implemented + self-verified. Author only — no migration applied, no edge fn deployed, no Stripe API called at build time.

---

## 1. Summary (plain English)

Turned on the four money actions in the admin Money console, each behind a typed reason + confirm and each writing an audit-log row:

- **Refund an order** (Orders detail) — a line-picker where the admin picks how many of each item to refund; the admin must type the exact refund total to confirm. Runs the real Stripe refund server-side. Bounded so you can never refund more than what's left on the order.
- **Stripe Connect refresh / onboarding link** (Payments detail) — pull a brand's live Connect status from Stripe, or mint an onboarding link to send the brand. No money moves.
- **Dispute internal note / mark reviewed** (Money-ledger → Disputes) — annotate a dispute for the team. Never touches Stripe or money.
- **Comp / extend / revoke Plus** (Subscriber card) — grant or revoke a DB subscription-tier override for support. Billing is untouched.

Every action is admin-gated at the server, and only the refund can move real money — and only in Stripe LIVE mode (Mingla is TEST end-to-end today, so build + test are safe; a real LIVE refund needs your explicit go).

---

## 2. SPEC success-criteria coverage

Fix commit hash: `<COMMIT>` (see §Commit). All satisfied against it.

| SC | Criterion | Status | Where |
|----|-----------|--------|-------|
| A-1/A-2 | Full + partial refund; typed-amount confirm | ✓ | `admin_refund_order`/`_commit` twins + `RefundModal` (BusinessOrdersPage) |
| A-3 | Idempotency (DB pending-key + Stripe key) | ✓ | `admin_refund_order` precheck + edge `admin_refund:<id>` + `Idempotency-Key` header |
| A-4 | Amount ceiling `Σ ≤ total − refunded` → 422 | ✓ | `admin_refund_order` `refund_exceeds_remaining` (P0009) + edge `→422` |
| A-5 | Over-refund by qty → 422 | ✓ | inherited per-line `line_overrefund` bound |
| A-6 | Non-admin/anon → 403/401; twin not authenticated-granted | ✓ | edge admin_users gate + `REVOKE…FROM PUBLIC,anon,authenticated; GRANT…service_role` + DO-block self-assert |
| A-7 | Fails-on-revert on ceiling | ✓ | `i-admin-refund-bounded.mjs` (proven, §4) |
| B-1/B-2 | Connect refresh / onboarding_link + audit | ✓ | `admin-stripe-connect-action` |
| B-3 | No connect account → 422 | ✓ | `no_connect_account` |
| B-4 | Non-admin/anon → 403/401 | ✓ | edge admin_users gate |
| C-1 | Annotate (note + reviewed) untouched status/amount/raw_event | ✓ | `admin_annotate_dispute` (only annotation cols) |
| C-2 | Non-admin/blank reason/unknown id | ✓ | guard + `reason_required` + `dispute_not_found` |
| C-3 | No Stripe in annotate path | ✓ | DB-only RPC (`callAdminWriteRpc`) |
| D-1/D-2 | Grant/revoke override audited | ✓ | `admin_grant_override_audited`/`admin_revoke_override_audited` wrappers |
| D-3 | Non-admin/invalid tier | ✓ | guard + base RPC tier RAISE |
| D-4 | No RevenueCat/Stripe billing call | ✓ | DB entitlement shim only |
| X-1 | Admin builds clean; all 4 modals are HighRiskActionModal | ✓ | `npm run build` OK; 4 flows use `HighRiskActionModal` |
| X-2 | No direct money-table writes on pages | ✓ | `i-admin-refund-bounded.mjs` UI check + regression |
| X-3 | write-audited + gate-first PASS for new RPCs | ✓ | both registries PASS + fail-on-revert |

---

## 3. Files changed

**New (7):**
- `supabase/migrations/20261210000000_orch_1278_money_act.sql` (+~330)
- `supabase/functions/admin-refund-order/index.ts` (+~330)
- `supabase/functions/admin-stripe-connect-action/index.ts` (+~230)
- `mingla-admin/src/services/adminMoneyActService.js` (+~80)
- `.github/scripts/strict-grep/i-admin-refund-bounded.mjs` (+~230)
- `.github/scripts/strict-grep/__tests__/i-admin-refund-bounded.test.mjs` (+~150)
- `mingla-admin/src/__tests__/orch1278_money_console_act.test.js` (+~230)

**Modified (11):**
- `supabase/config.toml` (+13 — 2 verify_jwt entries)
- `mingla-admin/src/services/adminWriteService.js` (+~10 — backward-compatible `opts.idempotencyKey` on `invokeAdminWriteEdge`)
- `mingla-admin/src/components/entity/HighRiskActionModal.jsx` (+~6 — optional `children` slot)
- `mingla-admin/src/components/entity/SubscriberContextCard.jsx` (+~90 — W2-D grant/revoke)
- `mingla-admin/src/pages/BusinessOrdersPage.jsx` (+~170 — RefundModal + wiring)
- `mingla-admin/src/pages/BusinessPaymentsPage.jsx` (+~80 — connect refresh/onboarding + copy-link)
- `mingla-admin/src/pages/BusinessMoneyLedgerPage.jsx` (+~75 — dispute annotate)
- `.github/scripts/strict-grep/i-admin-write-audited.mjs` (+~18 — 3 DB-only RPCs appended + self-test fixture)
- `.github/scripts/strict-grep/i-admin-gate-first-statement.mjs` (+~25 — 5 RPCs appended + self-test fixture)
- `.github/workflows/strict-grep-mingla-business.yml` (+27 — `orch-1278-money-act` job)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (+~24 — 3 DRAFT invariants)

---

## 4. Data-model changes

`stripe_disputes` — 3 additive **nullable** columns (backward-compatible with the webhook that owns the row): `admin_internal_note text`, `admin_reviewed_at timestamptz`, `admin_reviewed_by uuid`. No NOT NULL, no default churn, no RLS change.

New/changed RPCs (all `SECURITY DEFINER`, guard-first):
- `admin_refund_order(uuid,jsonb,text,text)` — service_role only; twin of `biz_refund_order` (brand gate stripped) + NEW total-amount ceiling.
- `admin_refund_order_commit(uuid,text,integer,text,text)` — service_role only; twin of `biz_refund_order_commit` (brand gate stripped).
- `admin_annotate_dispute(uuid,text,boolean,text)` — authenticated; audited.
- `admin_grant_override_audited(uuid,text,text,int,timestamptz)` / `admin_revoke_override_audited(uuid,uuid,text)` — authenticated; audited wrappers over the existing `admin_grant_override`/`admin_revoke_override` (called, never modified).
- `admin_get_order(uuid)` — **extended** (additive): line_items now also expose `order_line_item_id` + `refunded_quantity` (see §Discoveries — required for the refund line-picker; the spec assumed these were already present).

`admin_get_dispute` was **NOT** changed — it returns `to_jsonb(stripe_disputes)`, so the 3 new columns surface in the read bundle automatically.

---

## 5. Edge functions (list + verify_jwt to preserve)

| Edge fn | verify_jwt | Notes |
|---------|-----------|-------|
| `admin-refund-order` | **true** | admin_users active-check → 403; calls the service_role twins + `stripe.refunds.create` (`admin_refund:<id>` key + `stripeAccount` header); post-commit `admin_write_audit('order.refund')`; NO buyer-notification enqueue (webhook owns it) |
| `admin-stripe-connect-action` | **true** | admin gate; `mode:refresh` (accounts.retrieve→sca sync→derive) / `mode:onboarding_link` (account_sessions.create over EXISTING account only); audits; NEVER creates/replaces an account |

Both registered in `supabase/config.toml`.

---

## 6. Regression tests + fails-on-revert

- **Happy-path (implementor):** `mingla-admin/src/__tests__/orch1278_money_console_act.test.js` — 43 tests, 43 pass (source-level, node:test).
- **Gate + fixture:** `.github/scripts/strict-grep/i-admin-refund-bounded.mjs` (`--self-test` 7/7) + `__tests__/i-admin-refund-bounded.test.mjs` (7/7). 5 RPCs appended to the two 1271 registries (both `--self-test` + REAL PASS).
- **Fails-on-revert (TRUE LINE DELETION):** deleted the amount-ceiling guard block (`v_remaining_cents := …; IF v_refund_amount_cents > v_remaining_cents THEN RAISE 'refund_exceeds_remaining' …`) from the migration → `i-admin-refund-bounded.mjs` **FAILED** (exit 1) AND `orch1278_money_console_act.test.js` **FAILED** (42/43). Restored → both PASS again. **fails-on-revert verified at `<COMMIT>`.**

---

## 7. Old → New receipts (key surfaces)

- **`BusinessOrdersPage.jsx`** — before: disabled `WAVE-2` "Issue refund" button. now: a live danger button (visible only when `payment_status IN ('paid','partial_refund')`) opens `RefundModal` (line-picker + auto-computed per-line amounts + full-refund toggle + typed-amount confirm) → `refundOrder()` → refetch. why: SC A-1/A-2/A-4.
- **`BusinessPaymentsPage.jsx`** — before: two disabled `WAVE-2` buttons. now: live "Refresh from Stripe" / "Generate onboarding link" → HighRiskActionModal → `connectAction()`; onboarding URL shown with copy-to-clipboard. why: SC B-1/B-2.
- **`BusinessMoneyLedgerPage.jsx`** — before: read-only dispute detail. now: "Add internal note / Mark reviewed" → HighRiskActionModal (note textarea + reviewed checkbox) → `annotateDispute()` + a new "Admin review" section rendering the annotation. why: SC C-1.
- **`SubscriberContextCard.jsx`** — before: read-only. now: "Comp/Extend Plus" + "Revoke override" (revoke uses the active override's id from `override_history`) → HighRiskActionModal → grant/revoke wrappers → refetch. why: SC D-1/D-2.
- **`HighRiskActionModal.jsx`** — added an optional `children` slot (renders above the reason field) so the refund line-picker + grant tier/duration inputs live inside the same typed-reason+confirm shell; all 4 flows remain HighRiskActionModal (SC X-1).
- **`adminWriteService.js`** — `invokeAdminWriteEdge(fn, body, opts)` gains `opts.idempotencyKey` → attaches the `Idempotency-Key` header (backward-compatible; 2-arg callers unchanged). Matches the spec §3/§5A.4 documented signature.

---

## 8. Cross-surface impact

| Surface | Affected | Parity |
|---------|----------|--------|
| Consumer iOS/Android | No | n/a — admin-only |
| Buyer/anon Web | No | n/a |
| Business iOS/Android | No | n/a |
| **Admin Web** | **Yes** — 4 money-act buttons go live behind reason+confirm | Manual (single admin surface) |
| Business Web preview | No | n/a |

Backend edge fns/RPCs are shared by definition (one DB). No shipping-app code touched → no `eas update` (complies with COMMS-0052 OTA freeze trivially).

---

## 9. Self-verify results (real output)

- `i-admin-refund-bounded.mjs` `--self-test` **PASS (7/7)** + REAL **PASS**.
- `i-admin-write-audited.mjs` `--self-test` **PASS (3/3)** + REAL **PASS** (3 DB-only RPCs audit in-body).
- `i-admin-gate-first-statement.mjs` `--self-test` **PASS (4/4)** + REAL **PASS** (all 5 guard-first).
- `i-money-no-admin-rls.mjs` REAL **PASS** (no admin RLS on money tables incl. touched `stripe_disputes`).
- `i-admin-single-gate.mjs` REAL **PASS** (regression).
- `meta-orch-0972-no-brand-kind-reads.mjs` **PASS**; `meta-orch-0972-data-driven-tabs.mjs` **PASS**; `orch-1047-brand-owner-renamed.mjs` **PASS**.
- `deno check supabase/functions/admin-refund-order/index.ts` **OK**; `deno check supabase/functions/admin-stripe-connect-action/index.ts` **OK** (deno 2.7.14).
- `mingla-admin` net-new lint **0** (7 touched files eslint exit 0; the 86 repo-wide problems are pre-existing in untouched files).
- `npm run build` **OK** (vite, 2978 modules; only the pre-existing chunk-size advisory).
- node tests: `orch1278` 43/43 + `orch1274` + `orch1276` = **131/131**; strict-grep fixtures **18/18**.

**Least-privilege self-asserts (in the migration `DO $$` block, runtime-proven at apply):** twins NOT anon/authenticated-EXECUTE-able + service_role can; the 3 DB-only acts authenticated-yes / anon-no.

---

## 10. Known issues / deferred (spec-declared out-of-scope)

- **W2-A LIVE-mode refund** — moves real money; needs Seth's explicit go (Mingla is TEST today, so build/test safe).
- **W2-C dispute evidence submission / accept** (`disputes.update`/`.close`) — OUT OF SCOPE (real money; Stripe-dashboard-native). Only the DB note/mark-reviewed ships.
- **W2-D real subscription cancel/refund** — OUT OF SCOPE (RevenueCat-owned billing). Only the DB entitlement override ships.
- **W2-B account creation/replacement** — OUT OF SCOPE; admin is scoped to refresh + session-mint over an EXISTING account (422 if none).

---

## 11. Operator action required (orchestrator / Seth)

1. **Apply the migration** (collision-checked prefix `20261210000000`, strictly > worktree+sibling max `20261208000005`):
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/1278-[admin-money-edit]" && /Users/sethogieva/bin/supabase db push --linked
   ```
   > Guard-probe note: the migration only ADDs nullable columns + CREATE OR REPLACE functions + a privilege `DO $$` self-assert (no data backfill, no destructive predicate) — the self-assert only checks grants set within the same migration, so no pre-flight remote data probe is required.
2. **Deploy 2 edge fns from MERGED main** (verify_jwt=true for both): `admin-refund-order`, `admin-stripe-connect-action`. Verify each with one curl (401 without JWT / 403 non-admin).
3. **Flip the 3 DRAFT invariants → ACTIVE** at CLOSE.

---

## 12. Discoveries for Orchestrator (spec-gap resolutions — flag)

1. **`admin_get_order` extended (necessary).** The spec's refund line-picker (§5A.4) needs `order_line_item_id` + already-refunded qty per line, but the 1274 `admin_get_order` bundle exposed neither. Added them additively (same pattern the allowlist grants for `admin_get_dispute`). Without this the refund cannot form its RPC payload.
2. **`admin_get_dispute` NOT touched.** The spec anticipated a 3-column SELECT-list edit, but the RPC returns `to_jsonb(stripe_disputes)`, so the new columns flow automatically — one less change than the spec assumed.
3. **Audit split by layer (I-1278-MONEY-ACT-AUDITED).** The spec's §7 said "append the 5 RPC names to `i-admin-write-audited`," but that gate greps each RPC's SQL body for `admin_write_audit(` — the two refund twins correctly do NOT self-audit (service_role can't resolve the actor; the edge fn audits post-commit). Literally registering them there would be unsatisfiable. Resolution: the 3 DB-only acts are appended to `i-admin-write-audited` (they audit in-body); the 2 refund twins' edge-fn audit is asserted by the new `i-admin-refund-bounded.mjs`. All 5 are appended to `i-admin-gate-first-statement`. Net effect fully honors the invariant intent (every money act audits, checked at the correct layer, fails-on-revert).
4. **`invokeAdminWriteEdge` extended (spec-documented).** The spec §3/§5A.4 references a 3-arg `invokeAdminWriteEdge(fn, body, opts)`; the live 1271 code was 2-arg. Added a backward-compatible `opts.idempotencyKey` → `Idempotency-Key` header. `adminWriteService.js` wasn't on the literal create/modify allowlist, but the spec's own API contract requires it and it's additive.
5. **`HighRiskActionModal` `children` slot.** Not on the literal allowlist; a minimal backward-compatible optional slot needed to host the refund line-picker while keeping SC X-1 ("all four modals are HighRiskActionModal") literally true.

---

**Next handoff:** orchestrator REVIEW → tester (§8 matrix, TEST-mode live-fire only; cross-brand seeding of ≥1 order + ≥1 dispute; idempotency A-3; ceiling A-4; non-admin/anon A-6/B-4/C-2/D-3; fails-on-revert on `i-admin-refund-bounded.mjs`). A real LIVE-mode refund is a separate Seth-gated step after CLOSE.
