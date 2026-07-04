# IMPLEMENTATION — ORCH-1272 [Admin Identity console — READ-ONLY]

**Phase:** IMPLEMENT (single pass). **Author:** mingla-implementor.
**Worktree:** `~/Desktop/mingla-orchs/1272-[admin-identity-console]/` on branch `1272-admin-identity-console` (rebased on `origin/main`, which includes the merged ORCH-1271 foundation squash `e17d82f4a`).
**Commit:** `67ab244e7c963967c05960dfc648d5b170870ad4` (HEAD; = `089a25b64` rebase/least-privilege + tester adversarial suite `9a2e878e9` + token-restate chore + the two META-ORCH-0972 kind-removal fixes `22546d32c`/`67ab244e7`). Branch pushed; local == `origin/1272-admin-identity-console`; P0 hardening squash `ae4ebd968` is an ancestor.
> **META-ORCH-0972 kind removal (`22546d32c` then `67ab244e7`):** the admin console now displays NO brand `kind` anywhere, honoring the decommission in spirit (not just the literal). Removed the `brand.kind` badge from `PeopleConsolePage` AND the entire Kind surface from `BrandsConsolePage` (list column, filter, CSV column, detail field, header badge) + dropped `kind` from the `identityReadService` brand SELECTs and the kind filter. The `admin_get_person` RPC still returns whole-row jsonb (kind included) but nothing renders it. Signal-definition `kind` + `BatchProgressRow`/`AlertCard` `kind` props are unrelated and untouched. Zero `brand.kind`/`brands.kind`/`currentBrand.kind` literals + zero brand-kind display reads in `mingla-admin/src`; 0972 gate PASS; lint net-new 0; build clean; 3 authz/console suites + tester deny suite = 65/65; fails-on-revert re-verified at `67ab244e7`.
**Spec:** `reports/SPEC_ORCH-1272_ADMIN_IDENTITY_CONSOLE_READ.md` (binding contract, implemented verbatim).
**Status:** implemented and self-verified (JS/lint/build/strict-grep/append-only + fails-on-revert + read-only prod probe). NOT deployed, NOT merged — orchestrator owns DEPLOY + REVIEW.

> **Rebase reconciliation (post-approval, on the ORCH-1271 P0 hardening squash `ae4ebd968`):** rebased `origin/main`; the only conflict was `.github/workflows/strict-grep-mingla-business.yml` (both sides added a job after `orch-1271-admin-authz-foundation`) — resolved preserving BOTH the hardening's `orch-1271-admin-authz-node-tests` job AND my `orch-1272-identity-admin-read` job. `orch1271_admin_authz_foundation.test.js` (kept the hardening's P0 describe block + my `[TEST-MOD-APPROVED ORCH-1272]` repoint) and `i-admin-gate-first-statement.mjs` (kept the hardening's changes + my `admin_get_person` registry append) auto-merged with both sides intact. **Least-privilege added to `admin_get_person`** per the now-ACTIVE golden template: `REVOKE EXECUTE ... FROM anon, PUBLIC; GRANT ... TO authenticated;` + a `has_function_privilege` apply-time self-assert (anon=false, authenticated=true), mirroring `20261204000003_orch_1271_p0_hardening.sql`. Migration prefixes `20261205000001`/`000002` re-confirmed free + monotonic (> hardening `20261204000003`; clear of sibling bunny `...000000`/`...000003`; nothing on origin/main). Gates re-run green (lint net-new 0; build clean; the 3 CI-gated node suites 59/59; strict-grep 1272 + gate-first + single-gate + write-audited all self-test + real PASS; append-only PASS). **`fails-on-revert re-verified at 089a25b64`** — deleting the 4 RLS `CREATE POLICY` blocks fails the gate + 4 regression subtests; deleting the least-privilege lines fails the new least-privilege regression subtest; restore → green.

---

## 1. Summary (plain English)

The admin dashboard's Business group now has two real, working screens: **People** and **Brands**.

- **People** lists every business account (searchable by business name / owner name / email / phone, filterable by partner + active/deleted). Opening one shows the **unified person view** — both halves of a user in one place: consumer profile, business account, brands they own, brands they're a team member of, subscription (effective tier + any admin override), and support tickets. Consumer-only users are reachable by a `?userId=` deep-link.
- **Brands** lists every brand across the platform (incl. soft-deleted), searchable/filterable by claim status, kind, live/deleted, and payment provider. Opening one shows the full record: profile, claim/verification, money, owner (links to their person view), team, invites, partner links, and brand support tickets.

This wave is **visibility-first / READ-ONLY** — no edit, suspend, delete, or any mutation ships. Every edit surface is a Wave-2 design note. Backend adds 4 admin-read RLS policies + one guard-first read-only RPC. The 1271 placeholder "Business Console" is deleted.

---

## 2. SPEC success-criteria coverage

All at commit `3098ab07a`.

| SC / AC | How satisfied | Result |
|---|---|---|
| **AC-1.1** four is_admin_user() SELECT policies + admin_get_person SECURITY DEFINER | `20261205000001_...rls.sql` (4 policies) + `20261205000002_...admin_get_person.sql` | ✓ (strict-grep + regression + read-only prod probe confirm apply-clean) |
| **AC-1.2 / 1.3 / 1.4** RPC returns bundle / guard-first / cross-row | RPC shipped verbatim from spec §4A (guard-first); live-fire deferred to tester post-deploy | ✓ authored; runtime = tester |
| **AC-1.5** strict-grep fails-on-revert | `i-1272-identity-admin-read.mjs` (self-test 4/4) + gate-first guard-first | ✓ proven (see §6) |
| **AC-2.1 / 2.2** People list + search/filter/CSV | `PeopleConsolePage.jsx` via `EntityListView` + `listAccounts` | ✓ authored (source-verified; UI runtime = tester) |
| **AC-2.3** row → unified Person detail | `PeopleConsolePage` Person view via `getPerson` (`admin_get_person`) | ✓ authored |
| **AC-3.1 / 3.2 / 3.3** Person sections / consumer-only empty-state / deep-link / override | `buildPersonSections` + `?userId=` deep-link; override rendered from `active_override` | ✓ authored |
| **AC-4.1 / 4.2 / 4.3 / 4.4** Brands list + detail (team/invites/partner/tickets) + soft-deleted | `BrandsConsolePage.jsx` + `getBrandDetail` (composed sub-reads by `brand_id`) | ✓ authored |
| **AC-5.1** admin builds, Business group = People+Brands, placeholder gone | `npm run build` clean; nav repointed; `BusinessConsolePage.jsx` deleted | ✓ |
| **AC-5.2** read-only held (0 mutation hits) | `identityReadService` + both pages: no `.update/.insert/.delete/admin_write_audit`; migrations DDL-only | ✓ (regression test asserts) |
| **AC-5.3** UserManagementPage / SubscriptionManagementPage byte-unchanged | not touched | ✓ |
| **AC-6.1** DRAFT invariant + gate + workflow job + gate-first registry append | `INVARIANT_REGISTRY.md` DRAFT; gate + `__tests__` fixture; workflow job `orch-1272-identity-admin-read`; `admin_get_person` appended to gate-first (NOT write-RPC) registry | ✓ |

---

## 3. Files changed (15 files, +1836 / −229)

Created:
- `supabase/migrations/20261205000001_orch_1272_identity_admin_read_rls.sql` (+62)
- `supabase/migrations/20261205000002_orch_1272_admin_get_person.sql` (+59)
- `mingla-admin/src/services/identityReadService.js` (+298)
- `mingla-admin/src/pages/PeopleConsolePage.jsx` (+431)
- `mingla-admin/src/pages/BrandsConsolePage.jsx` (+494)
- `.github/scripts/strict-grep/i-1272-identity-admin-read.mjs` (+138)
- `.github/scripts/strict-grep/__tests__/i-1272-identity-admin-read.test.mjs` (+71)
- `mingla-admin/src/__tests__/orch1272_identity_console_read.test.js` (+208, happy-path regression)

Modified:
- `mingla-admin/src/lib/constants.js` (Business nav group → People + Brands)
- `mingla-admin/src/App.jsx` (import swap + PAGES swap)
- `.github/scripts/strict-grep/i-admin-gate-first-statement.mjs` (append `admin_get_person` to registry + self-test fixture)
- `.github/workflows/strict-grep-mingla-business.yml` (+1 job step)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (DRAFT `I-PROPOSED-1272-IDENTITY-ADMIN-READ`)
- `mingla-admin/src/__tests__/orch1271_admin_authz_foundation.test.js` (3 superseded assertions repointed — `[TEST-MOD-APPROVED ORCH-1272]`)

Deleted:
- `mingla-admin/src/pages/BusinessConsolePage.jsx` (−203, the 1271 placeholder)

---

## 4. Data-model changes (author-only; NOT applied)

**Migration `20261205000001_orch_1272_identity_admin_read_rls.sql`** — 4 idempotent (`DROP POLICY IF EXISTS` + `CREATE POLICY`) `FOR SELECT USING (public.is_admin_user())` policies on `creator_accounts`, `brand_team_members`, `brand_invitations`, `partner_brand_links`. No new `brands` policy (reuses existing `"brands admin can read"`). DDL-only; no ALTER/UPDATE/INSERT/DELETE; never references `account_type`.

**Migration `20261205000002_orch_1272_admin_get_person.sql`** — `public.admin_get_person(p_user_id uuid) RETURNS jsonb`, `SECURITY DEFINER SET search_path TO 'public'`, guard-FIRST (`IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'`), READ-ONLY (no write, not in write-RPC registry). Shipped verbatim from spec §4A. Reuses `get_effective_tier(uuid)` + `derive_user_segment(uuid)`. Crosses `subscriptions` + `admin_subscription_overrides` server-side (no browser RLS on those).

**Read-only prod probe (2026-07-03, `gqnoajqerqhnvulmnyvv`, no mutation)** confirmed apply-clean: all 3 functions present; all 9 referenced tables present; **no colliding policy names** (`DROP/CREATE` applies clean); all RPC-referenced columns present (`support_tickets.requester_user_id/last_message_at/subject/status/priority/brand_id`, `admin_subscription_overrides.user_id/revoked_at/starts_at/expires_at/tier`, `subscriptions.user_id/tier`, `brand_team_members.user_id/role/brand_id`, `creator_accounts.id/business_name/deleted_at/partner_enabled/default_brand_id`, `brands.account_id/claim_status/take_rate_bps_override/pricing_currency`).

---

## 5. Edge functions touched

None. (No edge-function work in scope. `admin_get_person` is an SQL RPC.)

---

## 6. Regression tests + fails-on-revert

**Happy-path regression (implementor-owned):** `mingla-admin/src/__tests__/orch1272_identity_console_read.test.js` — 24 tests, all PASS at `3098ab07a`. Proves: the 4 RLS policies + guard-first READ-ONLY `admin_get_person` in the migrations (the admin-visible data paths incl. soft-deleted rows / non-owned teams a non-admin cannot read + the sensitive money data flowing via the RPC, not a browser read); the service is the single READ authority (getPerson→RPC, reads under RLS, **no** direct `subscriptions`/`admin_subscription_overrides` read, **no** `.update/.insert/.delete/admin_write_audit`); the pages consume the shells + deep-links and ship zero edits; nav repointed + placeholder gone; gate/workflow/registry/DRAFT-invariant wired.

**Strict-grep gate:** `i-1272-identity-admin-read.mjs` — `--self-test` 4/4 PASS + real-run PASS. `__tests__/i-1272-identity-admin-read.test.mjs` — 4/4 PASS. `i-admin-gate-first-statement.mjs` real-run PASS (now includes `admin_get_person` guard-first) + `--self-test` 4/4 PASS. Sibling 1271 gates (`i-admin-single-gate`, `i-admin-write-audited`) unaffected — self-test + real PASS.

**`fails-on-revert verified at 3098ab07a126c422cb1d75e2fbced13f40a12813`** — by TRUE LINE DELETION of all 4 `CREATE POLICY` blocks in `20261205000001_...rls.sql`:
- gate `i-1272-identity-admin-read.mjs` → FAIL (exit 1, all 4 policies flagged);
- regression `orch1272_identity_console_read.test.js` → FAIL (4 subtests red, 20/24);
- `git checkout` restore → gate PASS + regression 24/24 PASS.

**Append-only gate** (`test-append-only-check.js`) PASS: 2 added test files (allowed) + the 1 modified 1271 test authorized by `[TEST-MOD-APPROVED ORCH-1272]` (13 deleted lines).

Tester still owns the SECOND adversarial live-fire suite (the ADV cross-row proofs AC-1.4/2.3/4.3/4.4 against the DEPLOYED migration + the read-only-held grep).

---

## 7. Old → New receipts (key surfaces)

**`lib/constants.js`** — *Before:* Business group = one placeholder item `business-console`. *Now:* `business-people` (People, Users icon) + `business-brands` (Brands, Building2 icon). *Why:* §4E — repoint to the two real domain pages. *Lines:* ~11.

**`App.jsx`** — *Before:* imported + routed `BusinessConsolePage` at `#/business-console`. *Now:* imports `PeopleConsolePage`+`BrandsConsolePage`, routes `#/business-people` + `#/business-brands`. *Why:* §4E. *Lines:* ~12.

**`pages/BusinessConsolePage.jsx`** — *Before:* 1271 scaffolding placeholder (demo rows + audit-probe self-test). *Now:* deleted. *Why:* §4E / Open-Q1 default. *Lines:* −203.

**`i-admin-gate-first-statement.mjs`** — *Before:* registry = `admin_write_audit`, `admin_audit_probe`. *Now:* + `admin_get_person`; self-test GOOD/BAD fixtures gain a guard-first `admin_get_person` so the expanded registry stays green. *Why:* §6 registry append. *Lines:* ~19.

**`orch1271_admin_authz_foundation.test.js`** — *Before:* asserted `business-console` nav/route + read the placeholder file. *Now:* asserts `business-people`+`business-brands` nav/route + placeholder-deleted + adminWriteService preserved for Wave-2. *Why:* the spec-mandated deletion/repoint breaks 3 shipped assertions; `node --test` must stay green. *Lines:* ~33 (13 deletions). **See Discovery D-1.**

*(New files — migrations, service, both pages, gate, fixture, regression test — are net-new; no "before".)*

---

## 8. Cross-surface impact

| Surface | Affected? | Notes |
|---|---|---|
| Consumer iOS | No | No shipping-app change |
| Consumer Android | No | No shipping-app change |
| Buyer/anonymous Web | No | No buyer-route change |
| Business iOS | No | No shipping-app change |
| Business Android | No | No shipping-app change |
| **Admin Web (`mingla-admin/`)** | **Yes** | The only UI surface — new People + Brands pages + read service |
| Business Web preview | No | Untouched |

Backend: 4 RLS SELECT policies + 1 read-only RPC (admin-scoped; no change to any shipping-app read path). Parity automatic (single admin-web surface).

---

## 9. Self-verify results

- `npm run lint` (admin): **net-new 0** — full tree stays at the pre-existing baseline (74 errors / 12 warnings; all in files I did not create). The one flagged pattern in a new file (`react-hooks/set-state-in-effect`) was eliminated by matching the clean `try/finally` structure. (Note: the `motion` unused-var "error" in `App.jsx` is PRE-EXISTING — origin/main App.jsx flags it identically through the project config.)
- `npm run build` (admin): **clean** (`✓ built in 3.41s`; only the pre-existing chunk-size advisory).
- `node --test` (admin): my two suites **PASS** — `orch1272_identity_console_read.test.js` 24/24, reconciled `orch1271_admin_authz_foundation.test.js` 21/21. The 19 remaining failures are PRE-EXISTING (ORCH-1008/1013/1014/1015 intelligence-overview + sidebar suites) — proven independent of ORCH-1272: they fail identically on origin/main nav (sidebar suites 10-pass/5-fail either way). **See Discovery D-2.**
- Strict-grep + append-only + fails-on-revert: all green (§6).

---

## 10. Known issues / deferred

- **No `[TRANSITIONAL]` code.** All degrade paths in `identityReadService` (secondary owner/member-name resolves) log a warning and fall back to "—"/empty — never silent, never fabricated.
- **Wave-2 edits** (suspend/restore/reassign/edit/invite actions) are DESIGNED in spec §5, NOT built (the `EntityDetailView actions` slot is intentionally empty).
- **Runtime UI verification deferred to tester** — the admin authed web runtime is not driveable from this session; source-verified only. Live-fire of the ADV cross-row proofs + the RPC guard requires the DEPLOYED migration.

---

## 11. Operator action required (orchestrator / Seth)

1. **REVIEW** this implementation, then **deploy the two migrations** (managed DDL, from MERGED main — do NOT `db push` from a stale anchor). Copy-paste (after merge, from the worktree or merged checkout):
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/1272-[admin-identity-console]" && /Users/sethogieva/bin/supabase db push --linked
   ```
   Migrations: `20261205000001_orch_1272_identity_admin_read_rls.sql`, `20261205000002_orch_1272_admin_get_person.sql`. Monotonic (> origin head `20261204000002`; clear of the sibling `20261205000000_meta_orch_1270_bunny_provider`). Read-only prod probe confirms clean apply (no colliding policies, all cols/fns/tables present).
2. **No edge-function deploy** (none in scope).
3. **Dispatch tester** for the AC matrix — esp. ADV cross-row proofs (AC-1.4/2.3/4.3/4.4), read-only-held grep (AC-5.2), and fails-on-revert on the RLS/RPC migration + strict-grep.
4. **At CLOSE:** flip `I-PROPOSED-1272-IDENTITY-ADMIN-READ` DRAFT → ACTIVE; merge one PR; update WORLD_MAP.

---

## 12. Discoveries for Orchestrator

- **D-1 (deviation, sanctioned) — 1271 test reconciliation outside the spec allowlist.** The spec required deleting `BusinessConsolePage.jsx` + repointing the nav, which breaks 3 assertions in the shipped `orch1271_admin_authz_foundation.test.js` (it asserted `business-console` and read the now-deleted placeholder). The dispatch requires `node --test` green, so those 3 assertions were minimally repointed to the new People/Brands reality, authorized via `[TEST-MOD-APPROVED ORCH-1272]` (append-only gate PASS). All other 1271 coverage (migrations, edge fn, HighRiskActionModal, adminWriteService, strict-grep) is preserved. Also required a companion edit to `i-admin-gate-first-statement.mjs`'s `--self-test` fixture (add a guard-first `admin_get_person`) so the registry append keeps that gate's self-test green — within the allowlisted file, slightly beyond "registry only" but mechanically necessary.
- **D-2 (pre-existing, not mine) — 19 red admin tests.** `node --test` in `mingla-admin` has 19 pre-existing failures across ORCH-1008/1013/1014/1015 (intelligence-overview + sidebar-prune suites). Proven independent of ORCH-1272 (identical fail count on origin/main nav). Candidate for a housekeeping ORCH to green the admin suite.
- **D-3 (info) — migration prefix collision avoided.** Assigned prefix `20261205000000` was already taken by sibling worktree `meta_orch_1270_bunny_provider`; bumped to `...000001`/`...000002` per the dispatch's collision-check instruction.
- **D-4 (COMMS ledger).** No BLOCK rows on entry. Implementor-addressed WARN rows (COMMS-0013/0014 → ORCH-1006, COMMS-0037 → ORCH-1156) are scoped to other ORCHs. ALL-addressed WARNs (0059 ID-collision hygiene, 0061 DR-restore-is-prod) honored by construction — I collision-checked my prefix and applied/deployed nothing (read-only probe only). No new ledger entry warranted.

---

**Report path:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1272_ADMIN_IDENTITY_CONSOLE_READ.md`
