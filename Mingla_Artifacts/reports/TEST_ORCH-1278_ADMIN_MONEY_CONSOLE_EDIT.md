# TEST — ORCH-1278 [Admin Money console — WAVE-2 EDIT / ACT]

**Verdict: CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 1 · P4: 3.
**Gatekeeper:** mingla-tester. **Branch:** `1278-admin-money-edit` HEAD `e36b2e698` (code `c6f605934`; tester adversarial `e36b2e698`). **Backend:** LIVE PROD `gqnoajqerqhnvulmnyvv` (verified). **Spec:** `SPEC_ORCH-1278_ADMIN_MONEY_CONSOLE_EDIT.md`.
**Domain:** HIGHEST-RISK (money). **Safety honored:** NO real `stripe.refunds.create` fired (even TEST). All DB-write tests ran in force-rolled-back txns (sentinel RAISE); zero prod mutation confirmed. Edge auth tested via curl only (no Stripe reached). No migrations/deploy/db push by tester.

**COMMS:** COMMS-0052 (BLOCK, business-OTA freeze) honored by construction — tester performed zero OTA/deploy and touched no `mingla-business`. No BLOCK row addressed to mingla-tester / ORCH-1278 / ALL is otherwise OPEN-and-unhonored.

**CONDITIONAL basis (dispatch-documented, not defects):** the full end-to-end Stripe TEST-mode refund happy-path (`admin-refund-order` → `stripe.refunds.create` → commit) was deliberately NOT fired per the safety mandate. Per the dispatch ("A full end-to-end Stripe TEST refund = mark CONDITIONAL (mechanism proven; deferred to a controlled run)"), W2-A's Stripe leg is CONDITIONAL: every layer BEFORE the Stripe call (RPC bounds, guard, idempotency, least-privilege, edge auth) is PROVEN live; the Stripe call itself + LIVE-mode refund remain Seth-gated. Admin-web UI interaction is source-verified and capped at "suspected" (admin-web authed runtime is unreachable to the tester — no admin login).

---

## 1. Live-fire evidence (the load-bearing proofs)

### 1.1 Least-privilege (grants on LIVE PROD — reconfirmed via `has_function_privilege`)
| Function | anon EXEC | authenticated EXEC | service_role EXEC | Verdict |
|---|---|---|---|---|
| `admin_refund_order` | **false** | **false** | true | PASS — service_role ONLY |
| `admin_refund_order_commit` | **false** | **false** | true | PASS — service_role ONLY |
| `admin_annotate_dispute` | false | true | true | PASS — DB-only authed |
| `admin_grant_override_audited` | false | true | true | PASS |
| `admin_revoke_override_audited` | false | true | true | PASS |
| `admin_get_order` (extended) | false | true | true | PASS |

All `SECURITY DEFINER = true`. The two refund twins are unreachable by any JWT caller (anon+authenticated both DENIED) — a non-admin authenticated user calling the twin directly gets `permission denied for function` at the grant layer (defense #1).

### 1.2 Live deployed bodies match branch (deploy renamed the migration prefix)
Branch file `20261210000000_orch_1278_money_act.sql`; deployed migration record `20260703183435 orch_1278_money_act` (deploy-time rename). Verified the LIVE function bodies carry every guard: `admin_refund_order` → ceiling (`refund_exceeds_remaining`) ✓, null-safe twin guard ✓, per-line qty bound ✓, idempotency precheck ✓, order-state gate ✓; `admin_refund_order_commit` → twin guard ✓; `admin_annotate_dispute` → `is_admin_user()` guard ✓, `admin_write_audit` ✓, `reason_required` ✓, **no Stripe API ref** (the `stripe` substring is only the table name `stripe_disputes`), does not touch `raw_event` ✓. See §Discoveries re: the prefix rename.

### 1.3 Refund RPC bounds — rolled-back txns as service_role/admin-sim (auth.uid()=NULL)
Single DO block, each case in its own subtransaction, whole block force-rolled-back:
```
CEILING (Σ 1500 > remaining 1000)  → refund_exceeds_remaining: requested=1500 remaining=1000   ✓
OVERQTY (qty 2 > capacity 1)       → line_overrefund: requested=2 existing=0 capacity=1          ✓
STATE   (order set to 'refunded')  → order_not_refundable: status=refunded                       ✓
REASON  (<10 chars)                → reason_invalid_length                                       ✓
```

### 1.4 Refund idempotency + crash-safe ordering — rolled-back
```
FIRST  call: refund_id=f7fb6e4d… · status='pending' written · idempotent_replay=false
SECOND call (same Idempotency-Key): refund_id=f7fb6e4d… (SAME) · idempotent_replay=true
refund_rows_for_key=1 (no second row) · line_item_rows=1 · proposed_status='refunded'
```
Proves: the pending `refunds` row is written by the RPC BEFORE any Stripe step (crash-safe ordering — the edge fn calls `admin_refund_order` as Step 1, `stripe.refunds.create` as Step 3); a replay on the same key returns the existing pending row, never a second insert.

### 1.5 Twin-guard + guard-first for a NON-ADMIN JWT — rolled-back (set `request.jwt.claims.sub`)
```
auth.uid()=00000000-…-0001  is_admin_user=false
REFUND_TWIN (admin_refund_order)       → not_authorized   ✓ (defense #2, service_role-safe twin guard)
ANNOTATE    (admin_annotate_dispute)   → not_authorized   ✓ (guard-first)
GRANT       (admin_grant_override_audited)  → not_authorized  ✓
REVOKE      (admin_revoke_override_audited) → not_authorized  ✓
```

### 1.6 Dispute annotate (W2-C) happy + error — admin ctx, rolled-back
```
note set='internal review note QA' · reviewed_at_set=true · reviewed_by=63835860… (=auth.uid())
status_unchanged=true · amount_unchanged=true · raw_event_unchanged=true
audit_delta=1 · last_action='dispute.annotate' · target=<dispute id>
BLANK_REASON → reason_required · UNKNOWN_DISPUTE → dispute_not_found
```

### 1.7 Subscription override wrappers (W2-D) — admin ctx, rolled-back
```
override_id=c630c46c… (base admin_grant_override created) · revoke_ok=true
audit_delta=2 · recent_actions = subscription.override_grant, subscription.override_revoke
INVALID_TIER → "Invalid tier: ultra_premium. Must be free or mingla_plus." (base RPC raise surfaces)
```

### 1.8 Edge-fn auth via curl on LIVE PROD (no Stripe reached — 401 returns before any RPC/Stripe)
| Call | Result |
|---|---|
| `admin-refund-order` — NO JWT | **401** gateway `UNAUTHORIZED_NO_AUTH_HEADER` (verify_jwt=true) |
| `admin-refund-order` — anon bearer (valid JWT, no user) | **401** `{"error":"unauthorized"}` (fn `getUser` → no user, before RPC/Stripe) |
| `admin-stripe-connect-action` — NO JWT | **401** gateway `UNAUTHORIZED_NO_AUTH_HEADER` |
| `admin-stripe-connect-action` — anon bearer | **401** `{"error":"unauthorized"}` |

Edge fns deployed ACTIVE, `verify_jwt=true`, version 1 (both). The `403`-for-a-valid-non-admin-user path is source-verified (`admin_users .eq('status','active').maybeSingle()` → `if(!adminRow) 403`) and RPC-twin-guard-proven; a live 403 curl requires a mintable authenticated non-admin user JWT (not available to the tester).

### 1.9 Zero prod mutation (post-test safety check)
`refunds=0 · refund_line_items=0 · stripe_disputes=0 · admin_audit_log=100 (unchanged) · order 7f577d38 = paid / refunded_amount_cents=0`. Every rollback held.

---

## 2. SC-by-SC matrix

| SC | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| A-1 | TEST full refund → Stripe refund + order `refunded` + audit | **CONDITIONAL** | RPC leg proven (§1.4 proposed_status=refunded; commit RPC recomputes); Stripe `refunds.create` leg deliberately NOT fired (safety) — deferred to controlled TEST run |
| A-2 | Partial refund + typed-amount confirm | **CONDITIONAL** (RPC) / suspected (UI) | RPC partial path proven via per-line bounds; typed-amount confirm source-verified (`confirmPhrase=(totalCents/100).toFixed(2)`, exact match gate) |
| A-3 | Idempotency — same key → ONE row, replay flag | **PASS** | §1.4 — same refund_id, replay=true, 1 row |
| A-4 | Amount ceiling `Σ > total−refunded` → `refund_exceeds_remaining` 422 | **PASS** | §1.3 CEILING; edge maps `refund_exceeds_remaining→422` (source) |
| A-5 | Over-refund by qty → 422 `line_overrefund` | **PASS** | §1.3 OVERQTY |
| A-6 | Non-admin/anon → 403/401; twin not authenticated-granted | **PASS** | §1.1 (authenticated EXEC=false) + §1.5 (twin not_authorized) + §1.8 (401 live); edge-403 source-verified |
| A-7 | Fails-on-revert on ceiling → gate FAILS | **PASS** | §4 — strict-grep + happy-path + tester adversarial all fail on ceiling deletion |
| B-1 | Connect `refresh` → sca synced + derived status + audit | **suspected** | source-verified; live needs admin JWT + Stripe (not fired) |
| B-2 | Connect `onboarding_link` (existing acct) + audit | **suspected** | source-verified |
| B-3 | No connect account → 422 `no_connect_account` | **suspected** | source-verified (`if(!scaRow…) 422`); anon call returns 401 before sca read |
| B-4 | Non-admin/anon → 403/401 | **PASS** | §1.8 (401 live both fns); 403 source-verified |
| C-1 | Annotate sets note + reviewed cols; status/amount/raw_event untouched; audit | **PASS** | §1.6 |
| C-2 | Non-admin / blank reason / unknown id | **PASS** | §1.5 + §1.6 (reason_required, dispute_not_found) |
| C-3 | No Stripe in annotate path | **PASS** | §1.2 — pure DB RPC; `stripe` match is only the `stripe_disputes` table name |
| D-1 | Grant override audited + audit `override_grant` | **PASS** | §1.7 |
| D-2 | Revoke override audited + audit `override_revoke` | **PASS** | §1.7 |
| D-3 | Non-admin / invalid tier | **PASS** | §1.5 (not_authorized) + §1.7 (invalid tier raise) |
| D-4 | No RevenueCat/Stripe billing call | **PASS** | DB entitlement shim only (source + §1.7 — base override RPC, no billing) |
| X-1 | Admin builds clean; all 4 modals = HighRiskActionModal | **suspected** | source-verified (all 4 flows import+use HighRiskActionModal); build re-run not driven |
| X-2 | No direct money-table `.update/.insert` on pages | **PASS** | grep: 0 hits across the 3 pages + SubscriberContextCard; 0 `brands.kind` refs |
| X-3 | write-audited + gate-first registries PASS + fail-on-revert | **PASS** | §4 |

---

## 3. Findings

**No P0. No P1. No P2.**

**P3-1 — Migration prefix drift (deploy-time rename).** Branch file is `20261210000000_orch_1278_money_act.sql`; the LIVE `schema_migrations` record is `20260703183435`. The deployed function BODIES match the branch exactly (§1.2), so there is no runtime risk today. Impact: on a future `supabase db push` from merged `main`, the CLI may see local version `20261210000000` as un-applied and re-run it. The migration is fully idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`, privilege `DO $$` self-assert), so a re-apply is safe — but this is exactly the migration-history-drift class (`project_migration_history_drift_db_push_unsafe`). Required fix: at CLOSE, reconcile the merged migration filename with the deployed history (rename the merged file to `20260703183435*` OR `supabase migration repair`), so history stays linear. Retest: `supabase migration list` shows no divergence.

**P4-1 — Per-attempt idempotency key minted client-side.** `adminMoneyActService.refundOrder` calls `crypto.randomUUID()` on every invocation (per SPEC §5A.4 "per-attempt key"). Double-click is correctly blocked by `HighRiskActionModal` (`submitting` gate + `disabled={!canConfirm}` + early `if(submitting) return`). A manual retry AFTER a surfaced error mints a NEW key — acceptable and consistent with the proven `refund-order` design (webhook + DB pending-precheck reconcile). Optional hardening: persist the key in modal state so a manual retry reuses it. Not blocking.

**P4-2 — Idempotent-replay manifest hardcodes `proposed_new_payment_status:'partial_refund'` / `is_full_refund:false`** in `admin_refund_order`'s replay branch regardless of the original refund's shape. Cosmetic only: the edge fn's replay path re-reads the committed refund state, and the commit RPC computes the real `payment_status`. No money-correctness impact.

**P4-3 (praise) — Crash-safe ordering + least-privilege are exemplary.** Pending row before Stripe; twin guard null-safe for service_role; runtime `DO $$` privilege self-assert in the migration; edge audit post-commit; buyer notification correctly delegated to the webhook (no double push). Clean, defensive money code.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Ran against branch HEAD (`b40553c69`, includes fix `c6f605934`) in the worktree:
- `node .github/scripts/strict-grep/i-admin-refund-bounded.mjs --self-test` → **PASS (7/7)**.
- `node .github/scripts/strict-grep/i-admin-refund-bounded.mjs` (real) → **PASS**.
- `node --test …/orch1278_money_console_act.test.js` → **43/43 PASS**.
- **True line-deletion of the ceiling guard block** (`v_remaining_cents := …; IF v_refund_amount_cents > v_remaining_cents THEN RAISE 'refund_exceeds_remaining' …`) → strict-grep **FAILED (exit 1)** ("missing the total-amount ceiling guard (refund_exceeds_remaining)") AND happy-path **42/43 (1 fail)**. Restored via `git checkout` → both **PASS**, tree clean.

**Implementor fails-on-revert independently confirmed at `c6f605934`.**

## 5. Adversarial test added (different angle)

`mingla-admin/src/__tests__/orch1278_money_ceiling_leastpriv_adversarial.test.js` — committed `e36b2e698`, pushed. 18 tests, **18/18 PASS** on correct code. Different angle than the implementor happy-path + strict-grep (both presence-based): attacks (1) **crash-safe ORDERING** — ceiling/state/reason RAISE must precede the `INSERT INTO public.refunds` (a moved-below regression stays green on presence gates but writes a pending row for a rejected refund); (2) **null-safe twin-guard FORM** — asserts both twins use `auth.uid() IS NOT NULL AND NOT is_admin_user()` and NOT the bare `IF NOT is_admin_user()` (which would raise not_authorized for EVERY service_role refund — a silent total outage); (3) **idempotency-precheck SCOPE** — key + `order_id` + `status='pending'`; (4) **least-privilege exactness** — twins REVOKE authenticated + GRANT service_role only (never authenticated), DB-only RPCs GRANT authenticated + REVOKE anon, + the runtime `DO $$` self-assert.

**fails-on-revert verified at `c6f605934`:** ceiling-guard true line-deletion → the "crash-safe ordering" suite fails **3 tests** (15/18); restore → 18/18. Both the implementor happy-path AND this adversarial test appear in `git diff origin/main...HEAD --name-only`.

## 6. Constitution 14-rule matrix (against the diff)

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | N/A (suspected) | admin-web UI source-clean; runtime not driven |
| 2 | One owner per truth | PASS | twins own refund writes via edge fn; brand path untouched; `admin_get_order` additive |
| 3 | No silent failures | PASS | edge maps every RPC error to HTTP; commit-after-stripe-failure → webhook reconcile; audit failure logged non-fatal |
| 4 | One query key per entity | N/A | invalidation via existing admin query keys |
| 5 | Server state server-side | PASS | no Zustand server snapshots introduced |
| 6 | Logout clears everything | N/A | no auth-state change |
| 7 | `[TRANSITIONAL]` labels | N/A | none |
| 8 | Subtract before adding | PASS | disabled `WAVE-2` buttons replaced (not duplicated) |
| 9 | No fabricated data | PASS | cents from real rows; no placeholder money |
| 10 | Currency-aware | PASS | integer cents throughout; `formatMoney(x, order.currency)` client-side only |
| 11 | One auth instance | PASS | edge fns use one service_role client; RPCs SECURITY DEFINER |
| 12 | Validate at right time | PASS | order-state + ceiling + reason validated in the RPC before write |
| 13 | Exclusion consistency | N/A | — |
| 14 | Persisted-state startup | N/A | — |

## 7. Device / parity matrix

| Surface | Ships here? | Verdict | Note |
|---|---|---|---|
| Consumer iOS / Android | No | N/A | admin-only |
| Buyer/anon Web | No | N/A | — |
| Business iOS / Android | No | N/A | — |
| **Admin Web** | **Yes** | **suspected (source-clean)** | authed admin-web runtime unreachable to tester (no admin login) — capped per `feedback_biz_web_authed_runtime_unreachable_cap_claims`; source + build claims verified |
| Business Web preview | No | N/A | — |
| **Backend (RPC + edge fn, LIVE PROD)** | **Yes** | **PASS (live-fire)** | §1 — grants, bounds, idempotency, guard, edge auth all proven on `gqnoajqerqhnvulmnyvv` |

Edge-fn live deploy: `admin-refund-order` + `admin-stripe-connect-action` ACTIVE, `verify_jwt=true`, version 1.

## 8. Discoveries for Orchestrator

1. **Migration prefix drift (P3-1).** Reconcile `20261210000000` (branch) vs `20260703183435` (deployed) at CLOSE — rename the merged file or `migration repair` so history stays linear. Deployed bodies already correct; no runtime risk.
2. **`admin_get_order` extended (implementor Discovery #1, verified live).** Additive: `line_items` now expose `order_line_item_id` + `refunded_quantity` for the refund line-picker. Live function returns them. Additive, `CREATE OR REPLACE` preserved anon-revoked/authenticated grant. Low risk.
3. **Live-fire deferrals (Seth-gated).** (a) End-to-end Stripe TEST-mode refund happy-path (`stripe.refunds.create`) NOT fired — run as a controlled TEST-mode step to close A-1/A-2 fully. (b) LIVE-mode refund needs Seth's explicit go (SPEC §11). (c) Connect refresh/onboarding + a live edge-403 need an admin session — verify during a controlled admin-web run.

## 9. Accepted conditions (CONDITIONAL PASS)

Per the dispatch's explicit framing ("A full end-to-end Stripe TEST refund = mark CONDITIONAL"), these deferrals are documented-accepted, not defects:
1. W2-A end-to-end Stripe TEST-mode refund happy-path (A-1/A-2 Stripe leg) — mechanism proven at RPC + edge-auth layers; the `stripe.refunds.create` call deferred to a controlled TEST run.
2. W2-A LIVE-mode refund — Seth-gated (SPEC §11).
3. Admin-web UI interaction (A-2 modal, X-1 build, B-1/B-2/B-3 connect happy-paths) — source-verified, capped at "suspected" (authed admin-web runtime unreachable to the tester).
4. Live edge-403 for an authenticated non-admin JWT — source + RPC-twin-guard proven (401 proven live).

**Routing:** CONDITIONAL PASS with dispatch-documented deferrals → orchestrator CLOSE may proceed (flip 3 DRAFT invariants ACTIVE, reconcile P3-1, merge one PR). The Stripe TEST-mode end-to-end refund + LIVE-mode refund remain separate Seth-gated runs.
