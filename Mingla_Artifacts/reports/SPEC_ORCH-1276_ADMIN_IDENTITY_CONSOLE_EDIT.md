# SPEC — ORCH-1276 [Admin Identity console — WAVE-2 EDIT / support actions]

**Parent:** META-ORCH-1237 (Admin full-visibility console). **Predecessor:** ORCH-1272 (READ, SHIPPED + LIVE). **Phase:** SPEC (build contract). **Author:** mingla-forensics.
**Backend:** Supabase LIVE PROD `gqnoajqerqhnvulmnyvv`. **Surfaces touched:** Admin Web (`mingla-admin/`) + backend (SECURITY DEFINER write-RPCs). **No shipping-app surface.**
**Inputs consumed (in full):** `SPEC_ORCH-1272_ADMIN_IDENTITY_CONSOLE_READ.md` (§5 Wave-2 deferred-edit notes = starting scope), `IMPLEMENTATION_ORCH-1272_ADMIN_IDENTITY_CONSOLE_READ.md`, `INVESTIGATION_META-ORCH-1237_IDENTITY_USERS_ACCOUNTS_BRANDS.md`; verbatim reads of `supabase/migrations/20261204000003_orch_1271_p0_hardening.sql` (GOLDEN write-RPC template), the shipped `20261205000001_...rls.sql` + `20261205000002_...admin_get_person.sql`, `components/entity/HighRiskActionModal.jsx`, `components/entity/EntityDetailView.jsx`, `services/adminWriteService.js`, `pages/PeopleConsolePage.jsx`, `pages/BrandsConsolePage.jsx`, `services/identityReadService.js`.
**COMMS ledger:** scanned on entry — no BLOCK rows for this ORCH / ALL. Only scope-relevant OPEN row = COMMS-0061 (WARN, ALL): `gqnoajqerqhnvulmnyvv` is LIVE PROD, DR-drills clone-only. Honored by construction — this spec ran read-only `execute_sql` SELECT probes only (column/constraint/RPC verification), mutated nothing. Factored; no ack write needed (WARN, honored).

> Every table / column / constraint / RPC name below was verified against live PROD via read-only `execute_sql` on 2026-07-03. `[verified]` = confirmed this session; `[report]` = sealed by the 1237 identity investigation; `[1271]` = golden template / audited-write primitive; `[1272]` = shipped READ foundation this spec extends.

---

## 1. Executive summary (plain English)

Wave-1 gave admins two read screens (People, Brands). Wave-2 gives them the **support actions** to fix things: edit a brand's or account's profile, move a brand to the right owner, suspend/restore a brand, soft-delete/restore a brand or account, manage a brand's team & invites, and disable/enable a user (plus a beta toggle). Every dangerous action forces a typed **reason + confirm** and records a **server-side audit row (before → after, actor, reason)** — Seth's binding rule. Every admin can do them (no super-admin tier). Two irreversible/email-dependent actions — **hard-delete a user** and **resend an invite** — are DEFERRED with full design contracts because they need a service_role edge function (Auth Admin API / email infra), not the SQL golden template.

---

## 2. Scope & risk-classification table

**Binding rule (Seth):** HIGH-risk action = typed **reason** + **confirm** (`HighRiskActionModal` / `EntityEditModal` reason+phrase gate) + server **audit** (`admin_write_audit` before/after). LOW-risk = **audit-only** (audit row written, no reason/confirm modal). Every admin may perform every action; the sole gate is `is_admin_user()`. No `account_type='admin'`.

| # | Action | Entity / column | Risk | Confirm phrase | Write RPC | UI host |
|---|---|---|---|---|---|---|
| A1 | Edit brand profile (name, description, contacts, links, theme, currency, venue_category — **NOT `kind`**) | `brands` (whitelisted cols) | **LOW** (audit-only) | — | `admin_update_brand(p_brand_id, p_patch jsonb, p_reason default null)` | `EntityEditModal` (form, no confirm) |
| A2 | Reassign brand owner | `brands.account_id` | **HIGH** | brand `slug` | `admin_reassign_brand_owner(p_brand_id, p_new_account_id, p_reason)` | `EntityEditModal` (account field + reason + phrase) |
| A3 | Suspend / revoke brand | `brands.claim_status` → `suspended`/`revoked` | **HIGH** | brand `slug` | `admin_set_brand_claim_status(p_brand_id, p_status, p_reason)` | `HighRiskActionModal` |
| A4 | Unsuspend / restore brand claim | `brands.claim_status` → `verified`/`none` | **HIGH** | — | `admin_set_brand_claim_status` (same RPC) | `HighRiskActionModal` (reason only) |
| A5 | Soft-delete / restore brand | `brands.deleted_at` | **HIGH** | brand `slug` (delete only) | `admin_set_brand_deleted(p_brand_id, p_deleted bool, p_reason)` | `HighRiskActionModal` |
| B1 | Edit account core (business_name, phone_e164, marketing_opt_in, display_name, email) | `creator_accounts` (whitelisted) | **LOW** (audit-only) | — | `admin_update_account(p_user_id, p_patch jsonb, p_reason default null)` | `EntityEditModal` (form, no confirm) |
| B2 | Suspend/soft-delete / restore account | `creator_accounts.deleted_at` | **HIGH** | `business_name`\|`email` (delete only) | `admin_set_account_deleted(p_user_id, p_deleted bool, p_reason)` | `HighRiskActionModal` |
| C1 | Change team-member role | `brand_team_members.role` | **HIGH** | — | `admin_set_team_member_role(p_member_id, p_role, p_reason)` | `EntityEditModal` (role select + reason) |
| C2 | Remove team member | `brand_team_members.removed_at` / DELETE | **HIGH** | member email | `admin_remove_team_member(p_member_id, p_reason)` | `HighRiskActionModal` |
| C3 | Revoke invite | `brand_invitations.status`/`revoked_at` | **HIGH** | — | `admin_revoke_brand_invitation(p_invitation_id, p_reason)` | `HighRiskActionModal` (reason only) |
| C4 | Resend invite | `brand_invitations` (regen token + email) | LOW | — | **DEFERRED — edge fn** (§6) | — |
| D1 | Disable / enable user | `profiles.active` | **HIGH** | user `email` (disable only) | `admin_set_user_active(p_user_id, p_active bool, p_reason)` | `HighRiskActionModal` |
| D2 | Beta toggle | `profiles.is_beta_tester` | **LOW** (audit-only) | — | `admin_set_user_beta(p_user_id, p_is_beta bool, p_reason default null)` | direct footer button (no modal) |
| D3 | Safe hard-delete user | `auth.users` + cascade | **HIGH** | user `email` | **DEFERRED — service_role edge fn** (§5) | — |

**Risk-classification reasoning.** The dispatch's explicit HIGH set (owner-reassign, suspend, soft-delete, user-disable, user-delete) is honored. Team/invite mutations (C1–C3) are **access-and-trust changes** — err toward capturing WHY → HIGH (graduated confirm-phrase: destructive removals get a phrase, reversible role/revoke get reason-only). Multi-field profile edits (A1, B1) and the beta flag (D2) are the "simple field edit" class → LOW/audit-only. `partner_enabled` is out of scope — already served by the shipped (unaudited) `admin_toggle_partner` [verified]; wrapping it in the audited pattern is flagged as Discovery, not built here.

**In scope:** the 11 buildable audited write-RPCs (A1–A5, B1–B2, C1–C3, D1–D2) + their UI wiring on the two shipped console pages, one new form-modal component, the write-service seam, and the strict-grep/invariant gate. **Non-goals (HARD):** no `brands.kind` read/write anywhere (META-ORCH-0972); no take-rate/Stripe writes (ORCH-1274); no subscription/override writes (already covered by `admin_grant_override`/`admin_revoke_override`); no `admin_toggle_partner` change; no auth-level email/password reset; no `account_deletion_requests` moderation; no change to `UserManagementPage.jsx`/`SubscriptionManagementPage.jsx`/`ClaimsPage.jsx`; no new READ RLS (1272 covers reads); no shipping-app code; **C4 resend + D3 hard-delete are DEFERRED (design-only).**

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered? | Behavior demanded | Files | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS | No | — (no shipping-app change) | — | n/a |
| 2 | Consumer Android | No | — | — | n/a |
| 3 | Buyer/anonymous Web | No | — | — | n/a |
| 4 | Business iOS | No | — | — | n/a |
| 5 | Business Android | No | — | — | n/a |
| 6 | **Admin Web (`mingla-admin/`)** | **YES** | Edit/support actions on People + Brands detail; every high-risk one gated by reason+confirm+audit | `pages/PeopleConsolePage.jsx`, `pages/BrandsConsolePage.jsx`, `components/entity/EntityEditModal.jsx` (new), `services/identityWriteService.js` (new) | automatic (single admin-web surface) |
| 7 | Business Web preview | No | — | — | n/a |

Backend: 11 SECURITY DEFINER write-RPCs (admin-scoped; bypass RLS via definer, gated by `is_admin_user()`); no change to any shipping-app read/write path.

---

## 4. Foundation / template dependencies (consumed verbatim, NOT redefined)

| From | 1276 uses it for | Hard rule |
|---|---|---|
| **GOLDEN write-RPC template** `[1271, §GOLDEN block of 20261204000003]` | Every RPC in §7 copies it exactly: guard-first `is_admin_user()` → reason gate (HIGH) → `to_jsonb` before-capture → `not_found` guard → UPDATE (`+ updated_at=now()` **only where the column exists**) → `admin_write_audit('<entity>.<verb>', …, jsonb_build_object('before',v_before,'after',v_after))` → `REVOKE EXECUTE FROM anon[,authenticated], PUBLIC; GRANT TO authenticated` → `DO $$` privilege self-assert. | If any RPC deviates from the template shape, STOP and amend. |
| **`admin_write_audit(p_action,p_entity_type,p_entity_id,p_reason,p_metadata,p_require_reason,p_actor_email,p_actor_uid)`** `[verified]` SECURITY DEFINER | Called from inside each write RPC. **Actor is bound server-side** — inside a SECURITY DEFINER admin RPC, `auth.uid()` still returns the calling admin's uid (JWT claims GUC is definer-independent), so the helper's `auth.uid() IS NOT NULL` branch records the real admin; `p_actor_*` is NEVER passed by these RPCs. **EXECUTE is revoked from `authenticated`** — nested calls succeed because the caller RPC is SECURITY DEFINER (owner=postgres has EXECUTE); do not GRANT `authenticated` on `admin_write_audit`. For LOW-risk audit-only RPCs pass `p_require_reason => false`. | Never forge `p_actor_*` from a JWT path. Never re-GRANT the helper to authenticated. |
| **`HighRiskActionModal`** `[1271]` (`open,onClose,title,description,confirmLabel,destructive,requireReason,reasonLabel,confirmPhrase,onConfirm({reason})→Promise,successMessage`) | Field-less HIGH actions (A3, A4, A5, B2, C2, C3, D1). Contract preserved: confirm disabled until reason non-empty (+ phrase exact); on resolve → success toast + close; on throw → inline error, modal stays open, reason preserved. | Consume as-is. No prop/behavior change. |
| **`EntityDetailView`** `[1271/1272]` — `actions=[{label,title,description,confirmLabel,destructive,requireReason,reasonLabel,confirmPhrase,buttonVariant,onConfirm}]` renders footer buttons → `HighRiskActionModal` | ENTITY-LEVEL footer HIGH actions (brand: suspend/restore, soft-delete/restore; person: soft-delete account, disable user). The 1272 spec reserved this slot for Wave-2 — now populated. | Pass `actions`; do NOT modify the component. |
| **`adminWriteService.callAdminWriteRpc(rpcName, params)`** `[1271]` — thin `supabase.rpc()` wrapper returning `{data,error}` | Every `identityWriteService` fn delegates to it. | Reuse; do not re-implement the seam. |
| **`identityReadService` (getPerson/listAccounts/listBrands/getBrandDetail)** `[1272]` | After every successful write the page re-invokes the matching read to refresh the detail (no optimistic fabrication). | Reuse; do not modify. |
| **`is_admin_user()` single gate** `[1271]` | Sole gate of every write RPC. | Never `account_type='admin'`. |

**Verified schema facts that shape the RPCs** `[verified 2026-07-03]`:
- `brands.updated_at` NOT NULL default `now()`; `creator_accounts.updated_at` NOT NULL default `now()`; `profiles.updated_at` nullable default `now()` → all three write RPCs SET `updated_at = now()`.
- **`brand_team_members` and `brand_invitations` have NO `updated_at`** → their RPCs MUST NOT set it (use state columns `removed_at`/`revoked_at` instead).
- `brands.claim_status` CHECK = `none|pending_review|verified|rejected|suspended|revoked`; `brand_invitations.status` CHECK = `pending|accepted|revoked|expired|declined`; `brand_team_members.role` / `brand_invitations.role` CHECK = `brand_owner|brand_admin|event_manager|finance_manager|marketing_manager|scanner`.
- `brand_team_members` exclusion CHECK `brand_team_members_accepted_removed_excl` = `(removed_at IS NULL OR accepted_at IS NOT NULL)` → cannot set `removed_at` on a never-accepted row → C2 must branch (soft-remove accepted rows; DELETE un-accepted rows).
- `brands.account_id` is NOT NULL FK → `creator_accounts.id` → A2 must validate the new owner exists and is not soft-deleted.
- `creator_accounts` has **only `deleted_at`** for lifecycle (no suspend/status column) → account "suspend" == soft-delete (B2).
- No name collision: none of the 11 RPC names exist today [verified]. Existing `admin_set_brand_take_rate_override`/`admin_toggle_partner`/`admin_get_brand_stripe_status` are out of scope.

**SECURITY DEFINER + RLS note:** because every write RPC is SECURITY DEFINER (owner=postgres), it bypasses RLS on the target table. Therefore **no new admin-UPDATE/DELETE RLS policy is needed** on `creator_accounts`/`brand_team_members`/`brand_invitations`; the guard-first `is_admin_user()` check is the authorization. The 1272 admin-READ RLS stays; writes flow only through these RPCs. `brands` already has admin-UPDATE RLS but the RPC path (audited) is the ONLY sanctioned admin write surface — the console must never `.update()` `brands` directly from the browser.

---

## 5. Layered specification

### 5.1 Database — 11 write-RPCs across 4 migrations (prefix `20261208*`; orchestrator confirms exact ts at implement, monotonic > `20261205000002`)

All follow the GOLDEN template. Illustrative skeleton (≤ contract, not full code) — the **positional** variant (A3/A5/B2/C2/C3/D1/D2) and the **jsonb-patch** variant (A1/B1) and the **validated-target** variant (A2/A4/C1):

```sql
-- HIGH positional (e.g. admin_set_brand_deleted):
CREATE OR REPLACE FUNCTION public.admin_set_brand_deleted(p_brand_id uuid, p_deleted boolean, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;      -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT to_jsonb(b) INTO v_before FROM public.brands b WHERE b.id = p_brand_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.brands SET deleted_at = CASE WHEN p_deleted THEN now() ELSE NULL END, updated_at = now()
   WHERE id = p_brand_id RETURNING to_jsonb(brands) INTO v_after;
  PERFORM public.admin_write_audit('brand.set_deleted','brand',p_brand_id::text,p_reason,
    jsonb_build_object('before',v_before,'after',v_after));
  RETURN v_after;
END; $fn$;
REVOKE EXECUTE ON FUNCTION public.admin_set_brand_deleted(uuid,boolean,text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_brand_deleted(uuid,boolean,text) TO authenticated;
-- + DO $$ has_function_privilege self-assert (anon=false, authenticated=true) per template.
```

**Per-RPC contract (signature · verb string · mutation · validation · risk):**

**Migration `20261208000001_orch_1276_brand_admin_write_rpcs.sql`:**
- **A1 `admin_update_brand(p_brand_id uuid, p_patch jsonb, p_reason text DEFAULT NULL)`** — verb `brand.update`. Whitelist keys applied from `p_patch` via key-presence (`p_patch ? 'k'`): `name`(NOT NULL — reject empty), `description`, `contact_email`, `contact_phone`, `pricing_currency`(NOT NULL — reject empty), `default_currency`, `venue_category`(validate CHECK `restaurant|play|creative_and_arts` when present), `theme_color`, `theme_font`, `theme_animation`, `social_links`(jsonb), `custom_links`(jsonb). **Any non-whitelisted key is IGNORED** — `kind`, `account_id`, `claim_status`, `deleted_at`, `take_rate_bps_override`, `stripe_*` can NEVER be written through this path. SET `updated_at=now()`. LOW → `admin_write_audit(..., p_require_reason=>false)` (records the optional `p_reason`).
- **A2 `admin_reassign_brand_owner(p_brand_id uuid, p_new_account_id uuid, p_reason text)`** — verb `brand.reassign_owner`. Guard+reason; `IF NOT EXISTS (SELECT 1 FROM creator_accounts WHERE id=p_new_account_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'invalid_new_owner'`. UPDATE `account_id=p_new_account_id, updated_at=now()`. Audit before/after. HIGH.
- **A3/A4 `admin_set_brand_claim_status(p_brand_id uuid, p_status text, p_reason text)`** — verb `brand.set_claim_status`. Guard+reason; `IF p_status NOT IN ('suspended','revoked','verified','none') THEN RAISE EXCEPTION 'invalid_status'` (deliberately EXCLUDES `pending_review`/`rejected` — those belong to the claims flow). UPDATE `claim_status=p_status, updated_at=now()`. Audit. HIGH. (Open Q1: `verified` here is an admin override that bypasses claim review — flagged.)
- **A5 `admin_set_brand_deleted(p_brand_id uuid, p_deleted boolean, p_reason text)`** — verb `brand.set_deleted` (skeleton above). HIGH.

**Migration `20261208000002_orch_1276_account_admin_write_rpcs.sql`:**
- **B1 `admin_update_account(p_user_id uuid, p_patch jsonb, p_reason text DEFAULT NULL)`** — verb `account.update`. Row lookup `creator_accounts WHERE id=p_user_id`. Whitelist: `business_name`, `phone_e164`, `marketing_opt_in`(bool), `display_name`, `email`. Ignore all else (esp. `deleted_at`, `partner_enabled`, `default_brand_id`). SET `updated_at=now()`. LOW audit-only.
- **B2 `admin_set_account_deleted(p_user_id uuid, p_deleted boolean, p_reason text)`** — verb `account.set_deleted`. UPDATE `deleted_at = CASE WHEN p_deleted THEN now() ELSE NULL END, updated_at=now()` on `creator_accounts WHERE id=p_user_id`. Audit. HIGH.

**Migration `20261208000003_orch_1276_team_invite_admin_write_rpcs.sql`** (NO `updated_at` on these tables):
- **C1 `admin_set_team_member_role(p_member_id uuid, p_role text, p_reason text)`** — verb `team_member.set_role`. Lookup `brand_team_members WHERE id=p_member_id` (capture `v_before`). `IF p_role NOT IN (<6 role CHECK values>) THEN RAISE 'invalid_role'`. **Orphan-owner guard:** `IF v_before->>'user_id' = (SELECT account_id::text FROM brands WHERE id = v_before->>'brand_id') AND p_role <> 'brand_owner' THEN RAISE EXCEPTION 'cannot_demote_account_owner'`. UPDATE `role=p_role` (no updated_at). Audit. HIGH.
- **C2 `admin_remove_team_member(p_member_id uuid, p_reason text)`** — verb `team_member.remove`. Lookup + `not_found`. Same orphan-owner guard (`cannot_remove_account_owner`). Branch on the exclusion CHECK: `IF v_before->>'accepted_at' IS NOT NULL THEN UPDATE ... SET removed_at=now() ... RETURNING to_jsonb → v_after; ELSE DELETE FROM brand_team_members WHERE id=p_member_id; v_after := jsonb_build_object('deleted', true); END IF`. Audit before/after. HIGH.
- **C3 `admin_revoke_brand_invitation(p_invitation_id uuid, p_reason text)`** — verb `invitation.revoke`. Lookup + `not_found`; `IF v_before->>'status' <> 'pending' THEN RAISE EXCEPTION 'not_pending'` (only pending invites are revocable). UPDATE `status='revoked', revoked_at=now()` (no updated_at). Audit. HIGH.

**Migration `20261208000004_orch_1276_user_admin_write_rpcs.sql`:**
- **D1 `admin_set_user_active(p_user_id uuid, p_active boolean, p_reason text)`** — verb `user.set_active`. Lookup `profiles WHERE id=p_user_id` + `not_found`. UPDATE `active=p_active, updated_at=now()`. Audit. HIGH. (App-enforced disable only — see §5.4 note; no auth-level ban.)
- **D2 `admin_set_user_beta(p_user_id uuid, p_is_beta boolean, p_reason text DEFAULT NULL)`** — verb `user.set_beta`. UPDATE `is_beta_tester=p_is_beta, updated_at=now()`. LOW audit-only (`p_require_reason=>false`).

Each RPC ends with the least-privilege `REVOKE ... FROM anon, PUBLIC; GRANT ... TO authenticated;` + the `DO $$ has_function_privilege(...)` self-assert (apply FAILS if anon can execute or authenticated cannot), copied from the shipped `admin_get_person` / P0-hardening pattern.

### 5.2 Service — `mingla-admin/src/services/identityWriteService.js` (NEW)

Thin typed wrappers, each `return callAdminWriteRpc('<rpc>', {...})` → `{data,error}` (import `callAdminWriteRpc` from `./adminWriteService`). Plus one shared `mapWriteError(error)` translating RPC error codes to copy: `not_authorized`→"You are not authorized to do this.", `reason_required`→"A reason is required.", `not_found`→"That record no longer exists.", `invalid_new_owner`→"That account can't own a brand (missing or deleted).", `invalid_status`/`invalid_role`→"Invalid selection.", `not_pending`→"This invite is no longer pending.", `cannot_demote_account_owner`/`cannot_remove_account_owner`→"You can't remove or demote the brand's account owner.", else the raw message. Exports: `updateBrand(brandId, patch, reason?)`, `reassignBrandOwner(brandId, newAccountId, reason)`, `setBrandClaimStatus(brandId, status, reason)`, `setBrandDeleted(brandId, deleted, reason)`, `updateAccount(userId, patch, reason?)`, `setAccountDeleted(userId, deleted, reason)`, `setTeamMemberRole(memberId, role, reason)`, `removeTeamMember(memberId, reason)`, `revokeInvitation(invitationId, reason)`, `setUserActive(userId, active, reason)`, `setUserBeta(userId, isBeta, reason?)`.

### 5.3 Component — `mingla-admin/src/components/entity/EntityEditModal.jsx` (NEW, one component)

A config-driven form modal that generalizes `HighRiskActionModal` to carry **form fields** plus the SAME optional reason+confirm gate. Props: `{open, onClose, title, description, fields:[{key,label,type:'text'|'textarea'|'select'|'switch'|'json', options?, placeholder?}], initialValues, submitLabel, requireReason=false, reasonLabel, confirmPhrase, destructive=false, onSave:async(values,{reason})=>void, successMessage}`. Behavior (mirror `HighRiskActionModal` verbatim for the gate): submit disabled until (all required fields valid) AND (reason non-empty when `requireReason`) AND (typed phrase === `confirmPhrase` when set); on submit → submitting spinner + inputs disabled → `await onSave(values,{reason})` → success toast + `handleClose()`; on throw → inline `AlertCard` error, stay open, values+reason preserved; event-driven reset on close. Reuse the shipped `Modal`/`ModalBody`/`ModalFooter`/`Button`/`AlertCard`/`useToast` kit and the exact input classes from `HighRiskActionModal`. `type:'json'` renders a textarea validated with `JSON.parse` (invalid JSON blocks submit with an inline field error). Used for A1, A2, B1, C1.

### 5.4 UI wiring — modify the two shipped pages

Contract for BOTH pages: **the page owns all mutation state and renders the modals**; `EntityDetailView` stays untouched except that it now receives an `actions` array; the section-builder functions gain an `actions` callbacks object (extending the existing `onOpenBrand`/`onOpenOwner` threading). After any successful write the page re-invokes the matching read (`loadPerson`/`loadBrand`) so the detail reflects truth — **no optimistic fabrication**.

**`BrandsConsolePage.jsx`:**
- ENTITY-LEVEL footer actions → pass to `EntityDetailView actions=[...]` (renders `HighRiskActionModal`): **Suspend brand** (A3, phrase=slug), **Unsuspend brand** (A4, reason-only; shown when `claim_status='suspended'`), **Soft-delete brand** (A5, phrase=slug) / **Restore brand** (A5 restore, reason-only; shown when `deleted_at`). Each `onConfirm:async({reason})=>{ const {error}=await <svc>(...); if(error) throw new Error(mapWriteError(error)); await loadBrand(id); }`.
- Page-rendered `EntityEditModal` (page state) for **Edit profile** (A1 — trigger: a page-rendered "Edit profile" button in the detail toolbar) and **Reassign owner** (A2 — trigger button; fields = one `select`/searchable account field sourced from a small `listAccounts` fetch or a uuid text field per Open Q2, + reason, phrase=slug).
- PER-ROW actions inside the Team section (`buildBrandSections` render fns call page callbacks) → page-rendered `HighRiskActionModal`/`EntityEditModal` keyed by the active row: per member **Change role** (C1, `EntityEditModal` role `select`) + **Remove** (C2, `HighRiskActionModal`, phrase=member email); per invite **Revoke** (C3, `HighRiskActionModal`, reason-only, only when `status='pending'`).
- Currency edit (A1) surfaces `pricing_currency` primary + `default_currency` secondary (ORCH-1034/1236 currency-tracks-default). **`kind` never appears** (0972).

**`PeopleConsolePage.jsx`** (Person detail; account actions shown only when `bundle.account` exists):
- ENTITY-LEVEL footer actions → `EntityDetailView actions`: **Disable user** (D1, phrase=email) / **Enable user** (D1 enable, reason-only; toggle by `person.active`), **Soft-delete account** (B2, phrase=business_name||email) / **Restore account** (B2 restore, reason-only; toggle by `account.deleted_at`).
- Page-rendered `EntityEditModal` for **Edit account** (B1, fields = business_name/phone_e164/display_name/email/marketing_opt_in switch; no reason required).
- **Beta toggle** (D2) → a direct footer/section button ("Enable beta"/"Disable beta") that calls `setUserBeta(userId, !current)` then `loadPerson(userId)` + toast; NO modal (audit-only).
- The `?userId=` deep-link + brand/owner cross-links [1272] are preserved.

**States (every action):** submitting (modal spinner, inputs disabled) · error (inline `AlertCard`, modal open, input preserved) · success (toast + close + detail refetch) · disabled (footer button hidden/disabled when the action is impossible, e.g. Restore hidden unless soft-deleted; Revoke only for pending invites). No dead taps.

### 5.5 Realtime / edge

None for the 11 shipped actions (SQL RPCs only). Deferred C4 + D3 are edge functions — §5/§6.

---

## 5. Safe-user-delete decision (D3)

**DEFER hard-delete to a dedicated service_role edge-function ORCH; ship the reversible `admin_set_user_active` disable/enable (D1) now to cover the immediate support need.** Rationale: the investigation proved `delete-user` is a **self-delete** of `auth.uid()`'s own account with no safe admin arbitrary-user path `[report: D-1/G-7]`; a correct admin hard-delete needs the Supabase **Auth Admin API** (`auth.admin.deleteUser`) which is only reachable from a **service_role edge function** — it cannot use the SQL golden template — and it must cascade-purge many public tables and is **irreversible**, so it warrants its own investigate→spec→test cycle.

**Design contract for the follow-on (NOT built in 1276):** new edge fn `supabase/functions/admin-delete-user/` — verify the caller's JWT is an active admin via `is_admin_user()` (RPC round-trip) BEFORE elevating; take `{ p_user_id, p_reason }`; run the same related-row purge `UserManagementPage.jsx:520-536` performs, then `auth.admin.deleteUser(p_user_id)`; write the audit row via `admin_write_audit(..., p_actor_email, p_actor_uid)` using the **service_role no-JWT actor path** (the one legitimate use of `p_actor_*`, populated from the verified admin's email/uid); UI = `HighRiskActionModal` with `confirmPhrase = user email` + `destructive`. Never reuse the self-delete `delete-user` fn.

---

## 6. Deferred invite-resend (C4) — design-only

Resend needs to regenerate `token_hash` + bump `expires_at` AND send an email — the SQL golden template cannot send email. DEFER to the same edge-fn follow-on: new service_role edge fn `admin-resend-brand-invitation` (`is_admin_user()` re-check → regen token + `expires_at` → invoke the existing brand-invite email path → `admin_write_audit` service_role actor path). Revoke (C3) ships now and covers the immediate support need (revoke a bad invite; the owner re-invites through the normal flow). **Open Q3:** the brand-invite email edge-fn name is unconfirmed (SPEC-mode: no new investigation) — the follow-on investigation resolves it. Classified LOW-risk but deferred purely on the email dependency.

---

## 7. Invariants

**Preserved:** `I-PROPOSED-1271-ADMIN-SINGLE-GATE` (every RPC gates on `is_admin_user()`), `I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT` (guard is the first executable statement — all 11 RPCs appended to its registry), `I-PROPOSED-1271-ADMIN-WRITE-AUDITED` (every admin write RPC calls `admin_write_audit` — all 11 appended to its write-RPC registry), `I-PROPOSED-1272-IDENTITY-ADMIN-READ` (unchanged; reads still via 1272 RLS/RPC), and the META-ORCH-0972 no-`brands.kind` rule (0972 gate stays green — `admin_update_brand` whitelist excludes `kind`; no page renders it).

**New (DRAFT — flip ACTIVE on CLOSE; orchestrator owns the flip):**

| ID | Rule | Enforcement | Regression (fails-on-revert) |
|---|---|---|---|
| `I-PROPOSED-1276-IDENTITY-ADMIN-WRITE-AUDITED` | Every ORCH-1276 identity write RPC (the 11 in §5.1) is SECURITY DEFINER, guards `is_admin_user()` as its first statement, calls `admin_write_audit` with a `before`/`after` metadata object, and carries the least-privilege `REVOKE EXECUTE ... FROM anon, PUBLIC` line. The admin console performs identity mutations ONLY via these RPCs — never a direct browser `.update()/.insert()/.delete()` on `brands`/`creator_accounts`/`brand_team_members`/`brand_invitations`/`profiles`. | strict-grep over `supabase/migrations/**` + `mingla-admin/src/**`. | `.github/scripts/strict-grep/i-1276-identity-admin-write.mjs` + `__tests__/` fixture: assert each of the 11 `CREATE OR REPLACE FUNCTION public.admin_<...>(` bodies contains, in order, the `is_admin_user()` guard as first statement, an `admin_write_audit(` call with `'before'`+`'after'`, and a `REVOKE EXECUTE ... FROM anon` line; AND assert `identityWriteService.js` + both pages contain zero `.update(`/`.insert(`/`.delete(` on the five identity tables. Deleting any guard/audit/REVOKE line → script FAILS; restored → PASS. One job step in `.github/workflows/strict-grep-mingla-business.yml`. |

**Registry appends (append-only, 1271-owned):** add the 11 RPC names to BOTH `i-admin-write-audited.mjs` and `i-admin-gate-first-statement.mjs` registered-fn lists (so reverting the audit call or moving the guard off first-statement in ANY of them fails those gates too). `admin_get_person` stays read-only (not added to the write set).

---

## 8. Success / acceptance criteria (testable)

`HP` = implementor self-verify (source + read-only prod probe / node test). `ADV` = tester adversarial live-fire (against the DEPLOYED migrations). CLOSE requires both. Live anchors `[report, post-wipe]`: `creator_accounts`=13 (1 soft-deleted), live `brands`=5, memberships=12, pending invites=0.

**AC-0 — template conformance (all 11 RPCs)**
- AC-0.1 [HP] `pg_proc` shows all 11 as SECURITY DEFINER; each migration `DO $$` self-assert passes at apply (anon cannot EXECUTE, authenticated can). `i-1276-identity-admin-write.mjs --self-test` + real-run PASS; the 11 names present in `i-admin-write-audited.mjs` + `i-admin-gate-first-statement.mjs` registries.
- AC-0.2 [ADV — the universal deny proof] For EVERY RPC: an **anon** `POST /rest/v1/rpc/<fn>` is rejected (no EXECUTE → 401/403, no mutation); a **non-admin authenticated** session calling it RAISES `not_authorized` and writes NO row and NO audit. Asserted live per RPC.
- AC-0.3 [ADV — the universal audit proof] For EVERY successful HIGH write by an admin, exactly one `admin_audit_log` row is inserted with `admin_email` = the acting admin (server-bound, NOT forgeable), `action` = the verb string, `target_id` = the entity id, `reason` = the typed reason, and `metadata->'before'` ≠ `metadata->'after'` reflecting the exact column change. LOW writes (A1/B1/D2) also write an audit row (reason optional).
- AC-0.4 [ADV — fails-on-revert] Deleting the `is_admin_user()` guard line from any RPC → `i-admin-gate-first-statement.mjs` FAILS; deleting its `admin_write_audit(` call → `i-admin-write-audited.mjs` FAILS; deleting its `REVOKE ... FROM anon` line → `i-1276-identity-admin-write.mjs` FAILS. Restore → all PASS.

**AC-1 — Brand actions**
- AC-1.1 [HP/ADV] A1 edit: admin changes name/contact/currency on a brand it does not own → row updated, `kind`/`account_id`/`claim_status`/`deleted_at` UNCHANGED even if injected into `p_patch` (whitelist proof); audit row written. Empty `name`/`pricing_currency` rejected.
- AC-1.2 [ADV] A2 reassign: moving a brand to a valid non-deleted account succeeds + audits; a random/soft-deleted `p_new_account_id` RAISES `invalid_new_owner` (no change). Confirm phrase = slug enforced client-side.
- AC-1.3 [ADV] A3/A4: suspend (→`suspended`) then unsuspend (→`verified`) both audit; `p_status='pending_review'` RAISES `invalid_status`. A5: soft-delete sets `deleted_at`, brand then appears only under Status=Deleted in the list; restore clears it.
- AC-1.4 [ADV] All brand HIGH actions: non-admin → `not_authorized`, no mutation, no audit.

**AC-2 — Account & user actions**
- AC-2.1 [HP/ADV] B1 edit account core (business_name/phone/email) audits; injected `deleted_at`/`partner_enabled` keys ignored. B2 soft-delete/restore toggles `creator_accounts.deleted_at` + audits; the soft-deleted account already in the fixture is restorable.
- AC-2.2 [ADV] D1 disable: `profiles.active=false` + audit; the Person header badge flips to "Banned"; enable restores. D2 beta toggle flips `is_beta_tester` + audits with no modal.
- AC-2.3 [ADV] D1/B2 non-admin → `not_authorized`, no mutation/audit; anon rpc → blocked by REVOKE.

**AC-3 — Team & invites**
- AC-3.1 [ADV] C1 change-role on a non-owned brand's member audits before/after role; C2 remove: an accepted member gets `removed_at` set (row still present, dim in UI), a never-accepted member row is DELETEd; both audit. C3 revoke sets `status='revoked'`+`revoked_at`, audits; a non-pending invite RAISES `not_pending`.
- AC-3.2 [ADV — orphan-owner guard] C1 demoting, and C2 removing, the member whose `user_id` = the brand's `account_id` RAISES `cannot_demote_account_owner`/`cannot_remove_account_owner` (no change). Proven live.
- AC-3.3 [ADV] Team/invite HIGH actions: non-admin → `not_authorized`.

**AC-4 — UI wiring & read-only-elsewhere**
- AC-4.1 [HP] Both pages build clean (`npm run build`, zero net-new lint/type). `EntityEditModal` gates: submit disabled until required fields + reason (when required) + phrase (when set); invalid JSON in a `json` field blocks submit; on RPC error the modal stays open with values preserved and shows the mapped copy; on success it closes, toasts, and the detail refetches showing the new value.
- AC-4.2 [ADV] `HighRiskActionModal` never calls `onSave/onConfirm` with an empty reason; the confirm phrase must match exactly.
- AC-4.3 [ADV — no direct browser write] grep `identityWriteService.js` + both pages → zero `.update(`/`.insert(`/`.delete(` on the five identity tables; every mutation routes through `callAdminWriteRpc`. `EntityDetailView.jsx`/`HighRiskActionModal.jsx`/`identityReadService.js`/`UserManagementPage.jsx`/`SubscriptionManagementPage.jsx`/`ClaimsPage.jsx` byte-unchanged.
- AC-4.4 [HP] META-ORCH-0972 gate PASS — no `brands.kind` read/write anywhere in the diff.

**AC-5 — Invariant + gate**
- AC-5.1 [HP] `I-PROPOSED-1276-IDENTITY-ADMIN-WRITE-AUDITED` added DRAFT to `INVARIANT_REGISTRY.md`; `i-1276-identity-admin-write.mjs` + `__tests__/` fixture PASS; one job step registered in `strict-grep-mingla-business.yml`; the 11 RPCs appended to the two 1271 registries (self-test green).

---

## 9. Implementor task list (ordered)

Work in the orchestrator-spawned per-ORCH worktree `~/Desktop/mingla-orchs/1276-[identity-console-edit]/`, rebased on `origin/main` (which already contains 1271 + 1272). Migration prefix `20261208*` — re-confirm next-free monotonic ts (> `20261205000002`; collision-check sibling worktrees) at implement.

1. **DB — brand RPCs.** `20261208000001_orch_1276_brand_admin_write_rpcs.sql`: A1–A5 per §5.1, golden template each (guard-first, reason gate for HIGH, before-capture, whitelist/validation, `admin_write_audit`, REVOKE/GRANT + self-assert). (AC-0, AC-1)
2. **DB — account RPCs.** `20261208000002_orch_1276_account_admin_write_rpcs.sql`: B1, B2. (AC-2.1)
3. **DB — team/invite RPCs.** `20261208000003_orch_1276_team_invite_admin_write_rpcs.sql`: C1, C2 (exclusion-CHECK branch + orphan-owner guard), C3. No `updated_at`. (AC-3)
4. **DB — user RPCs.** `20261208000004_orch_1276_user_admin_write_rpcs.sql`: D1, D2. (AC-2.2)
5. **Service.** `services/identityWriteService.js` (new): 11 wrappers over `callAdminWriteRpc` + `mapWriteError`. (§5.2)
6. **Component.** `components/entity/EntityEditModal.jsx` (new): config-driven form modal with the reason+confirm gate mirrored from `HighRiskActionModal`. (§5.3, AC-4.1/4.2)
7. **UI — Brands.** Modify `pages/BrandsConsolePage.jsx`: thread action callbacks into `buildBrandSections`; wire A1–A5 + C1–C3 (footer `actions` for entity-level HIGH, page-rendered modals for edits + per-row). (§5.4, AC-1/3/4)
8. **UI — People.** Modify `pages/PeopleConsolePage.jsx`: wire B1, B2, D1, D2 (footer `actions` + edit modal + beta button). (§5.4, AC-2/4)
9. **Invariant + gate.** Add DRAFT invariant to `INVARIANT_REGISTRY.md`; write `i-1276-identity-admin-write.mjs` + `__tests__/` fixture; register one job step in `strict-grep-mingla-business.yml`; append the 11 RPC names to `i-admin-write-audited.mjs` + `i-admin-gate-first-statement.mjs` registries. (AC-0.1/0.4, AC-5)
10. **Regression test.** `mingla-admin/src/__tests__/orch1276_identity_console_edit.test.js` (new): service→RPC-name mapping, page modal wiring, no-direct-browser-write assertion, `EntityEditModal` gate, whitelist enforcement markers. Append-only gate; `[TEST-MOD-APPROVED ORCH-1276]` only if a 1271/1272 assertion must be repointed.
11. **Self-verify.** `npm run lint`/`build` clean; strict-grep 1276 + appended registries self-test + real PASS; prove fails-on-revert (delete a guard / an audit call / a REVOKE line → the matching gate FAILS; restore → PASS); read-only prod probe of the 4 migrations (functions defined, self-asserts pass) — hand migration deploy to orchestrator (managed DDL, from MERGED main).

**Allowlist (implementor may create/modify ONLY these):**
`supabase/migrations/20261208000001_orch_1276_brand_admin_write_rpcs.sql`, `…000002_…account…`, `…000003_…team_invite…`, `…000004_…user…` · `mingla-admin/src/services/identityWriteService.js` · `mingla-admin/src/components/entity/EntityEditModal.jsx` · `mingla-admin/src/pages/BrandsConsolePage.jsx`, `PeopleConsolePage.jsx` · `.github/scripts/strict-grep/i-1276-identity-admin-write.mjs` (+ `__tests__/` fixture) · `.github/scripts/strict-grep/i-admin-write-audited.mjs` + `i-admin-gate-first-statement.mjs` (append 11 names to registries only) · `.github/workflows/strict-grep-mingla-business.yml` (append one job step) · `mingla-admin/src/__tests__/orch1276_identity_console_edit.test.js` · `Mingla_Artifacts/INVARIANT_REGISTRY.md` (append DRAFT invariant).

**DO-NOT-TOUCH (stop-and-amend first):** `is_admin_user()` · `admin_write_audit` / `admin_audit_probe` bodies + their GRANTs (nested calls rely on the current least-privilege) · `admin_get_person` + the 1272 read RLS/migrations · `services/adminWriteService.js` · `services/identityReadService.js` · `components/entity/EntityDetailView.jsx` + `HighRiskActionModal.jsx` + `EntityListView.jsx` (consume, don't modify) · `UserManagementPage.jsx` / `SubscriptionManagementPage.jsx` / `ClaimsPage.jsx` / `SupportDeskPage.jsx` · `delete-user` edge fn · any `brands.kind` surface · `admin_toggle_partner` / take-rate / Stripe RPCs · subscriptions/overrides RLS · any shipping-app code · the C4/D3 deferred edge fns (design-only).

---

## 10. Open questions (with defaults)

- **Q1 (non-blocking) — `verified` via A3/A4 bypasses claim review.** `admin_set_brand_claim_status` allows `verified`/`none` for unsuspend/restore, which can set a brand `verified` outside the claims flow. **Default:** keep it (support needs to un-suspend a formerly-verified brand) but the strict allow-set EXCLUDES `pending_review`/`rejected` so approval/rejection stays in `ClaimsPage`; the audit row records every transition. Alternative: unsuspend restores to a stored prior-status (needs a new column — deferred).
- **Q2 (non-blocking) — reassign-owner account picker.** A2 needs the admin to pick `p_new_account_id`. **Default:** `EntityEditModal` renders a searchable `select` populated by the shipped `listAccounts` read (business_name → id). Alternative: a raw uuid text field (lower-effort, more error-prone) — the RPC's `invalid_new_owner` guard backstops either way.
- **Q3 (non-blocking) — invite-resend email fn.** C4 deferred; the brand-invite email edge-fn name is unconfirmed. **Default:** resolve in the C4/D3 follow-on investigation; revoke (C3) covers the immediate need now.
- **Q4 (non-blocking) — audit-only reason capture for LOW edits.** A1/B1/D2 don't force a reason. **Default:** `EntityEditModal` offers an OPTIONAL "Note (audit)" field feeding `p_reason`; RPC calls `admin_write_audit(..., p_require_reason=>false)`. Alternative: no note field (pure silent audit) — rejected (a note aids support forensics).
- **No BLOCKING open questions.** All 11 RPC signatures, mutations, validations, CHECK/exclusion constraints, `updated_at` presence, name-non-collision, and the golden-template + component reuse are verified against live PROD and the shipped 1271/1272 code.

---

## 11. Downstream routing

Next = **mingla-implementor** (build §9 task list in the `1276-[identity-console-edit]` worktree, rebased on `origin/main`). Then **mingla-tester** (AC matrix — esp. the universal deny AC-0.2, universal audit AC-0.3, fails-on-revert AC-0.4, the whitelist proof AC-1.1, orphan-owner guard AC-3.2, and no-direct-browser-write AC-4.3, all live-fired against the DEPLOYED migrations with admin + non-admin + anon sessions). Then **orchestrator CLOSE** (flip `I-PROPOSED-1276-IDENTITY-ADMIN-WRITE-AUDITED` DRAFT→ACTIVE, deploy the 4 migrations from merged main, merge one PR, update WORLD_MAP). The DEFERRED C4 (invite-resend) + D3 (safe hard-delete) route to a NEW service_role edge-fn ORCH (investigate→spec→test) consuming the design contracts in §5/§6.

**Discovery for orchestrator:** `admin_toggle_partner` (partner_enabled) predates the audited-write primitive and writes NO `admin_audit_log` row — a housekeeping candidate to wrap it in the golden template (out of 1276 scope).
