# IMPLEMENTATION — ORCH-1276 [Admin Identity console — WAVE-2 EDIT / support actions]

**Parent:** META-ORCH-1237. **Predecessor:** ORCH-1272 (READ, shipped). **Phase:** IMPLEMENT.
**Worktree:** `~/Desktop/mingla-orchs/1276-[admin-identity-edit]/` on branch `1276-admin-identity-edit`, rebased on `origin/main` (contains 1271+1272+1273+1274).
**Commit:** `97be234f35faa05bce189cb4b67ee4db75ced42e`.
**Status:** implemented + self-verified (source + read-only prod probe + gates green + fails-on-revert proven). Migrations NOT applied (orchestrator/operator owns DEPLOY from merged main).

---

## 1. Summary (plain English)

Wave-1 gave admins two read-only screens (People, Brands). Wave-2 gives them the support actions to fix things: edit a brand's or account's profile, move a brand to a new owner, suspend/restore a brand, soft-delete/restore a brand or account, change a team member's role, remove a member, revoke an invite, and disable/enable a user plus a beta toggle. Every dangerous action forces a typed reason + confirm and records a server-side audit row (before → after, actor, reason). Every admin can do them (single `is_admin_user()` gate, no super-admin tier). The two irreversible/email-dependent actions (hard-delete a user, resend an invite) are DEFERRED to a service_role edge-fn follow-on per the spec.

## 2. SPEC success-criteria coverage

All satisfied at commit `97be234f3` unless noted. `HP` = implementor self-verify (source + read-only prod probe + node tests). `ADV` items require the tester's live-fire against the DEPLOYED migrations.

| AC | Coverage | How verified |
|----|----------|--------------|
| AC-0.1 template conformance | ✓ HP | All 11 RPCs SECURITY DEFINER, guard-first, `admin_write_audit(before/after)`, REVOKE anon+PUBLIC / GRANT authenticated, `DO $$ has_function_privilege` self-assert. `i-1276 --self-test` + real PASS; 11 names present in both 1271 registries (their real-runs enumerate all 11). |
| AC-0.2 universal deny | ✓ HP (source) / ADV (live) | Each RPC REVOKEs anon+PUBLIC (blocks anon RPC) + guard-first `not_authorized`. Live 401/403 + no-mutation is the tester's live-fire. |
| AC-0.3 universal audit | ✓ HP (source) / ADV (live) | Each RPC `PERFORM admin_write_audit(verb, entity, id, reason, jsonb_build_object('before',…,'after',…))`; actor bound server-side (helper's `auth.uid()` path, `p_actor_*` never passed). Live audit-row assertion is the tester's. |
| AC-0.4 fails-on-revert | ✓ HP | Proven on real files (see §6): delete guard → gate-first + i-1276 FAIL; delete audit call → write-audited + i-1276 FAIL; delete REVOKE-anon → i-1276 FAIL; restore → all PASS. |
| AC-1.1 A1 whitelist | ✓ HP / ADV | `admin_update_brand` CASE-whitelist; body contains no `kind`/`account_id`/`claim_status`/`deleted_at` (regression test asserts). Empty `name`/`pricing_currency` → `invalid_name`/`invalid_currency`. |
| AC-1.2 A2 reassign | ✓ HP / ADV | `invalid_new_owner` guard on missing/soft-deleted account; phrase=slug client-side. |
| AC-1.3 A3/A4/A5 | ✓ HP / ADV | claim-status allow-set = `suspended\|revoked\|verified\|none` (excludes pending_review/rejected → `invalid_status`); A5 toggles `deleted_at`. |
| AC-1.4 brand HIGH deny | ✓ HP / ADV | guard-first on all. |
| AC-2.1 B1/B2 | ✓ HP / ADV | `admin_update_account` whitelist excludes `deleted_at`/`partner_enabled` (test asserts); B2 toggles `creator_accounts.deleted_at`. |
| AC-2.2 D1/D2 | ✓ HP / ADV | `admin_set_user_active` → `profiles.active` + audit (header badge flips "Banned"); `admin_set_user_beta` → `is_beta_tester`, no modal. |
| AC-2.3 D1/B2 deny | ✓ HP / ADV | guard-first + REVOKE anon. |
| AC-3.1 C1/C2/C3 | ✓ HP / ADV | C1 role CHECK; C2 branches accepted→`removed_at` / un-accepted→DELETE; C3 `not_pending` guard. |
| AC-3.2 orphan-owner | ✓ HP / ADV | C1 `cannot_demote_account_owner`, C2 `cannot_remove_account_owner` (member.user_id = brand.account_id). |
| AC-3.3 team HIGH deny | ✓ HP / ADV | guard-first. |
| AC-4.1 pages build + gates | ✓ HP | `npm run build` clean; changed files eslint 0; `EntityEditModal` gate = required+reason+phrase+JSON. |
| AC-4.2 HighRisk gate | ✓ HP | consumed unchanged (`HighRiskActionModal.jsx` byte-unchanged). |
| AC-4.3 no direct browser write | ✓ HP | `identityWriteService.js` + both pages contain zero `.update(`/`.insert(`/`.delete(`/`admin_write_audit`; regression test + i-1276 gate assert. Read service + EntityDetailView + HighRiskActionModal + UserManagement/Subscription/Claims pages byte-unchanged. |
| AC-4.4 no brands.kind (0972) | ✓ HP | `meta-orch-0972-no-brand-kind-reads.mjs` PASS; `grep '\.kind' mingla-admin/src` shows only pre-existing non-brand hits (signals/inclusions/contacts). |
| AC-5.1 invariant + gate | ✓ HP | DRAFT invariant added; `i-1276` + fixture PASS; workflow job step added; 11 names appended to both registries (self-tests green). |

## 3. Files changed

**New (13):**
- `supabase/migrations/20261208000001_orch_1276_brand_admin_write_rpcs.sql` (A1–A5, ~180 lines)
- `supabase/migrations/20261208000002_orch_1276_account_admin_write_rpcs.sql` (B1–B2, ~95 lines)
- `supabase/migrations/20261208000003_orch_1276_team_invite_admin_write_rpcs.sql` (C1–C3, ~140 lines)
- `supabase/migrations/20261208000004_orch_1276_user_admin_write_rpcs.sql` (D1–D2, ~90 lines)
- `mingla-admin/src/services/identityWriteService.js` (11 wrappers + `mapWriteError`, ~145 lines)
- `mingla-admin/src/components/entity/EntityEditModal.jsx` (generic form modal, ~245 lines)
- `.github/scripts/strict-grep/i-1276-identity-admin-write.mjs` (~230 lines)
- `.github/scripts/strict-grep/__tests__/i-1276-identity-admin-write.test.mjs` (~130 lines)
- `mingla-admin/src/__tests__/orch1276_identity_console_edit.test.js` (51 tests, ~215 lines)

**Modified (7):**
- `mingla-admin/src/pages/BrandsConsolePage.jsx` (+~230 lines: A1–A5, C1–C3 wiring)
- `mingla-admin/src/pages/PeopleConsolePage.jsx` (+~140 lines: B1, B2, D1, D2 wiring)
- `.github/scripts/strict-grep/i-admin-write-audited.mjs` (+11 registry names + self-test fixture)
- `.github/scripts/strict-grep/i-admin-gate-first-statement.mjs` (+11 registry names + self-test fixture)
- `.github/workflows/strict-grep-mingla-business.yml` (+1 job `orch-1276-identity-admin-write`)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (+DRAFT `I-PROPOSED-1276-IDENTITY-ADMIN-WRITE-AUDITED`)
- `mingla-admin/src/__tests__/orch1272_identity_console_read.test.js` (`[TEST-MOD-APPROVED ORCH-1276]` repoint: dropped the now-obsolete "no HighRiskActionModal / no edits" clause; kept + strengthened the no-direct-browser-write invariant)

Diff exactly matches the SPEC allowlist + the §10-sanctioned 1272 test repoint. No DO-NOT-TOUCH file changed.

## 4. Data-model changes applied

None yet (migrations authored, NOT applied). 11 new SECURITY DEFINER functions on deploy; no table/column/constraint/RLS change. No new READ RLS (1272 covers reads); writes bypass RLS via definer, authorized by the guard-first `is_admin_user()`.

**Read-only prod probe (2026-07-03, `execute_sql` SELECT only — mutated nothing, honors COMMS-0061):** confirmed all columns (`brands.updated_at` NOT NULL, `creator_accounts.updated_at` NOT NULL, `profiles.updated_at` nullable, `brand_team_members`/`brand_invitations` have NO `updated_at`); all CHECK constraints (`brands_claim_status_check`, `brands_venue_category_check`, both role checks, `brand_invitations_status_check`) and the `brand_team_members_accepted_removed_excl` exclusion; and that none of the 11 RPC names pre-exist. All match the SPEC `[verified]` markers.

## 5. Edge functions touched

None. The 11 actions are SQL RPCs only. C4 (resend invite) + D3 (safe hard-delete) are DEFERRED design-only edge fns (`admin-resend-brand-invitation`, `admin-delete-user`) — a new service_role edge-fn ORCH, not built here.

## 6. Regression tests + fails-on-revert

**Happy-path (implementor):** `mingla-admin/src/__tests__/orch1276_identity_console_edit.test.js` — 51 tests, all PASS. Covers guard-first + audit(before/after) + least-privilege per RPC, whitelist (no kind/account_id/claim_status/deleted_at; no deleted_at/partner_enabled), team RPCs set no updated_at, orphan-owner + exclusion branch + not_pending, service→RPC mapping, mapWriteError codes, no-direct-write on pages+service, EntityEditModal generic+gated.
**Gate fixture:** `.github/scripts/strict-grep/__tests__/i-1276-identity-admin-write.test.mjs` — 6 tests, all PASS.

**fails-on-revert verified at `97be234f35faa05bce189cb4b67ee4db75ced42e`** (true LINE DELETION on the real migration files, restored via `git restore`):
- Delete `IF NOT public.is_admin_user() …` guard from `admin_update_brand` → `i-admin-gate-first-statement.mjs` FAIL + `i-1276` FAIL; restore → PASS.
- Delete `PERFORM public.admin_write_audit(…)` from `admin_set_user_active` → `i-admin-write-audited.mjs` FAIL + `i-1276` FAIL; restore → PASS.
- Delete `REVOKE EXECUTE … FROM anon, PUBLIC` for `admin_set_brand_deleted` → `i-1276` FAIL; restore → PASS.

**Append-only:** all new test files added; the one existing-test modification (`orch1272_identity_console_read.test.js`) carries `[TEST-MOD-APPROVED ORCH-1276]` in the commit body (tests-append-only gate).

## 7. Old → New receipts

### BrandsConsolePage.jsx
- **Before:** read-only detail; `EntityDetailView actions` empty; `buildBrandSections(detail, onOpenOwner)`.
- **Now:** toolbar (Edit profile A1, Reassign owner A2); footer `actions` (Suspend/Unsuspend A3/A4, Soft-delete/Restore A5) → HighRiskActionModal; per-member Change role (C1)/Remove (C2) + per-invite Revoke (C3); every success `await loadBrand(id)`. Owner picker via `listAccounts`.
- **Why:** SPEC §5.4 Brands wiring. **Lines:** +~230.

### PeopleConsolePage.jsx
- **Before:** read-only detail; `actions` empty.
- **Now:** toolbar (Edit account B1, beta toggle D2 no-modal); footer `actions` (Disable/Enable user D1, Soft-delete/Restore account B2). Refetch `loadPerson(userId)` on success.
- **Why:** SPEC §5.4 People wiring. **Lines:** +~140.

### EntityEditModal.jsx (new, GENERIC)
- **Now:** config-driven form modal (`fields` text/textarea/select/switch/json) + the SAME reason+phrase gate as HighRiskActionModal; `json` fields validated with `JSON.parse` (blocks submit); mounted-fresh-per-open so `initialValues` is correct without a setState-in-effect (React-Compiler-safe). Domain-agnostic — carries no identity/table/RPC terms (regression test asserts) so ORCH-1277/1278 reuse it verbatim.
- **Why:** SPEC §5.3.

### identityWriteService.js (new)
- **Now:** 11 thin wrappers each `callAdminWriteRpc('<audited rpc>', {...})` + `mapWriteError` code→copy map. No `.from`/`.update`/`.insert`/`.delete`.
- **Why:** SPEC §5.2 write seam.

### Migrations 20261208000001–4 (new)
- **Now:** the 11 audited write-RPCs, golden-template each. `$$` body delimiter (matches shipped `admin_write_audit`/`admin_get_person` + the 1271 registry parsers; the SPEC skeleton's `$fn$` is illustrative).

## 8. Cross-surface impact

| # | Surface | Affected | Note |
|---|---------|----------|------|
| 1 | Consumer iOS | No | no shipping-app change |
| 2 | Consumer Android | No | — |
| 3 | Buyer/anon Web | No | — |
| 4 | Business iOS | No | — |
| 5 | Business Android | No | — |
| 6 | **Admin Web** | **YES** | People + Brands detail gain audited edits; parity automatic (single admin-web surface) |
| 7 | Business Web preview | No | — |

Backend: 11 SECURITY DEFINER admin-scoped RPCs; no shipping-app read/write path touched.

## 9. Smoke result

No runtime smoke on a live admin session — `mingla-admin` is a Vite SPA gated behind an authenticated admin JWT (biz-web authed runtime is not reachable headless; memory `feedback_biz_web_authed_runtime_unreachable_cap_claims`). Verified: `npm run build` clean (2977 modules), changed-file eslint 0, `node --test` for the 1276 suite (51) + repointed 1272 (31) green, all strict-grep gates + 0972 green, read-only prod schema probe. Runtime UI behavior (modal gate, refetch, live audit rows) is the tester's live-fire against the DEPLOYED migrations.

## 10. Known issues / deferred

- **C4 resend-invite + D3 safe hard-delete:** DEFERRED (service_role edge fn) per SPEC §5/§6 — design-only, not built. C3 revoke covers the immediate "kill a bad invite" need; D1 disable covers the immediate "block a user" need.
- **A1 contact fields:** the SPEC A1 whitelist includes `contact_email`/`contact_phone`, but the shipped 1272 read (`identityReadService.js`, DO-NOT-TOUCH) does not surface them, so the Edit-profile form OMITS them to avoid overwriting-with-blank (data loss). The RPC still accepts them if ever sent. See Discoveries.
- No `[TRANSITIONAL]` code introduced.

## 11. Operator action required (orchestrator/operator, from MERGED main)

**Apply the 4 migrations** (monotonic `20261208000001–4`; re-confirmed strictly > max existing `20261207000000`, no collision on origin/main or sibling worktrees):
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/1276-[admin-identity-edit]" && /Users/sethogieva/bin/supabase db push --linked
```
Each migration's `DO $$ has_function_privilege` self-assert runs at apply and ABORTS if anon can execute or authenticated cannot — apply is the runtime proof of least-privilege. No edge-fn deploy. On CLOSE: flip `I-PROPOSED-1276-IDENTITY-ADMIN-WRITE-AUDITED` DRAFT→ACTIVE.

## 12. Discoveries for Orchestrator

1. **`admin_toggle_partner` (partner_enabled) is un-audited** — predates the golden template, writes no `admin_audit_log` row. Housekeeping candidate to wrap in the audited pattern (out of 1276 scope; already flagged by the SPEC).
2. **1272 read doesn't surface `contact_email`/`contact_phone`** — a future read extension would let the A1 form expose those two whitelisted brand contact fields safely.
3. **Pre-existing admin test failures (NOT ORCH-1276):** the full `node --test` shows 19 failures in untouched suites — ORCH-1008 (sidebar), ORCH-1013 (intelligence), ORCH-1014 (photo/edge-fn), ORCH-1015 (edge-fn QA). None are in this diff; they fail on `origin/main` independently. Worth a housekeeping ORCH.
