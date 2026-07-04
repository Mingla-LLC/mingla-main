# INVESTIGATION — META-ORCH-1237 · Identity layer (users / accounts / brands)

**Phase:** INVESTIGATE (read-only). **Domain:** identity — consumer users, business/creator accounts, brands, the links between them, their RLS, and the existing admin coverage.
**Backend:** Supabase LIVE PROD `gqnoajqerqhnvulmnyvv`. All queries SELECT-only. No code edited except this report.
**Date:** 2026-07-03.

---

## Headline findings

1. **One auth user, two first-class profile tables.** Identity anchors on a single `auth.users` row. Two separate public tables hang off the SAME `auth.uid()`: `profiles` (consumer) and `creator_accounts` (business/creator). Both RLS-key on `auth.uid() = id`. Live data proves the overlap: **all 13 `creator_accounts` share their `id` with a `profiles` row** (`SELECT count(DISTINCT p.id) FROM profiles p JOIN creator_accounts c ON c.id=p.id` = 13). There is **no enforced cross-schema FK** to `auth.users` on either table — the link is the shared primary key. Consequence for the console: to show "a user and their business" you must join `profiles.id = creator_accounts.id`; there is no `account_type`-style switch that reliably separates them (`profiles.account_type` is nullable and mostly null).

2. **Admin RLS covers `profiles` and `brands` — but NOT the business-account/team/invite/subscription layer.** `is_admin_user()` policies grant admin full read+write on `profiles` ("Admins can read all profiles" / "Admins can update all profiles") and read+update on `brands` ("Admins can read brands for operations", "Admins can update brands for claim review"). **There is NO admin policy of any kind on `creator_accounts`, `brand_team_members`, `brand_invitations`, `partner_brand_links`, `subscriptions`, `admin_subscription_overrides`, or `account_deletion_requests`.** With the browser's anon key, the admin console literally cannot read or write those tables directly — only via SECURITY DEFINER RPCs / service_role edge functions.

3. **The existing `UserManagementPage` is consumer-only, and its one business read is broken-by-design.** It reads `creator_accounts` for exactly two fields (`partner_enabled, partner_country`) at `UserManagementPage.jsx:304`. Because `creator_accounts` has no admin RLS policy, that read only succeeds through the *public-share-page* policy ("Public can read organiser profiles for share pages" — requires a non-deleted brand with a public event); for any business account without a live public event it **silently returns null**. The page never surfaces `business_name`, the user's owned brands, team memberships, or invites.

4. **No brand-management admin surface exists.** `brands` are only ever touched by admin through the **claims** flow (`ClaimsPage.jsx` + `adminClaimsService.js` → `admin-review-venue-claim` edge fn), which mutates `claim_status`, feedback, and place scores. There is no UI/service to edit a brand's profile, reassign its owner (`account_id`), soft-delete it, or resend a brand invite — **even though the `brands` admin-UPDATE RLS policy (`is_admin_user()`) already permits all of those column writes.** The capability exists at the RLS layer and is simply unused.

5. **`brands.kind` is ALIVE in the live schema, contradicting the "DECOMMISSIONED" memory.** Live: `kind text NOT NULL DEFAULT 'popup'`, CHECK `kind IN ('physical','popup','trip_planner')`. The decommission was at the authoring/persona-picker product layer, not a column drop. This is a docs-vs-schema contradiction the console must resolve (show it read-only? hide it?).

6. **There is no business/creator "plan" or subscription.** `creator_accounts` has no tier/plan/status/subscription column. Business monetization is **take-rate**: `brands.take_rate_bps_override` (+ `admin_set_brand_take_rate_override` / `admin_clear_brand_take_rate_override` RPCs). The only subscription tier in the system is **consumer Mingla+**: `subscriptions.tier IN ('free','mingla_plus')`, comped via `admin_grant_override` / `admin_revoke_override` on `admin_subscription_overrides`. "Comp a plan" for a business today = change its take-rate, not grant a subscription.

7. **"Disable a user" is a soft, app-enforced flag with no auth-level teeth.** Admin disable = `profiles.update({active:false})` (`UserManagementPage.jsx:388,671`) via the admin-UPDATE RLS policy. There is **no password reset, no auth-email change, no auth ban** in the console; editing `profiles.email` does not touch `auth.users`. Hard delete routes through the `delete-user` edge fn (`:536`). Brand/business suspension exists only as `brands.claim_status IN ('suspended','revoked')` — with no admin UI to set it.

8. **Support already carries partial business context, but it's a dead-end.** `support_tickets.brand_id` links a ticket to a brand; `SupportDeskPage.jsx:150` selects it and `:178` joins `brands(id,name)` for a label; admin reads every ticket via the `is_admin_user()` umbrella. But there is no navigation from a brand/account record into its support history, nor from a ticket into the full account/brand identity.

---

## Schema map per entity

### A. Consumer user — `public.profiles` (PK `id` = `auth.uid()`, no FK to auth.users)
Key columns (verified live): `id, email, display_name, username, first_name, last_name, phone, avatar_url, bio, location, birthday, gender, country, currency (def 'USD'), preferred_language, timezone, visibility_mode (def 'friends'), account_type (nullable), has_completed_onboarding (def false), email_verified (def false), onboarding_step, active (NOT NULL def true) ← the disable flag, is_admin (NOT NULL def false), is_beta_tester (NOT NULL def true), is_seed (NOT NULL def false), show_activity, referral_code, preferences jsonb, photos text[], created_at, updated_at, coach_mark_step`.
- **No ban/suspend column** — `active=false` is the only disable lever.
- Consumer-vs-business distinction is NOT a column on `profiles`; it's the *existence* of a matching `creator_accounts` row (and `profiles_with_segment` view derives an `explorer/business/admin` segment used by the admin list).
- **RLS:** self read/update (`auth.uid()=id`); public read when `visibility_mode='public'`; friends read; blocked-user exclusion; **admin read all + admin update all via `is_admin_user()`**. Full admin CRUD-read/update present. (No admin DELETE policy — deletes go via the `delete-user` edge fn.)

### B. Business account — `public.creator_accounts` (PK `id` = `auth.uid()`, no FK to auth.users)
Columns (verified live): `id, email, display_name, avatar_url, business_name, phone_e164, marketing_opt_in (def false), deleted_at, default_brand_id → brands.id, partner_enabled (def false), partner_country, created_at, updated_at`.
- **No tier/plan/subscription/status/ban column.** `deleted_at` is the only soft-delete.
- **RLS (CRITICAL GAP):** only `auth.uid()=id` (self read/insert/update) + "Public can read organiser profiles for share pages" (deleted_at IS NULL AND has a public-event brand). **No `is_admin_user()` policy.** → admin browser cannot read/write another account's `creator_accounts` row directly.

### C. Brands — `public.brands` (owner FK `account_id → creator_accounts.id`, NOT NULL)
Full column list (verified live), grouped:
- **Identity/profile:** `id, account_id, name, slug (nonempty CHECK), description, profile_photo_url, profile_photo_type, cover_media_url, cover_media_type, cover_hue, contact_email, contact_phone, social_links jsonb, custom_links jsonb, display_attendee_count, theme_color/theme_font/theme_animation (whitelisted CHECKs)`.
- **Kind/type:** `kind NOT NULL DEFAULT 'popup'` CHECK `('physical','popup','trip_planner')` — **alive, contra memory**; `has_physical_location (def false)`; `venue_category` CHECK `('restaurant','play','creative_and_arts')`.
- **Location:** `address, place_pool_id → place_pool.id, google_place_id, lat, lng, city, country_code`.
- **Claim/verification:** `claim_status NOT NULL DEFAULT 'none'` CHECK `('none','pending_review','verified','rejected','suspended','revoked')`, `verified_at, verified_by (uuid), rejection_reason, claim_follow_up_at, duplicate_of_brand_id → brands.id, marked_called_at, marked_called_by, claim_decision_emailed_at`.
- **Money:** `default_currency (char), tax_settings jsonb, default_pass_tax/mingla_fee/service_fee, pricing_region (def 'GB') CHECK GB/US/EU/CH/NG, pricing_currency (def 'GBP'), take_rate_bps_override (0–3000 CHECK), take_rate_override_updated_at/by, payment_provider (def 'stripe') CHECK stripe/paystack, payment_country, stripe_connect_id, stripe_payouts_enabled, stripe_charges_enabled, paystack_subaccount_code, partner_setup`.
- **Timestamps:** `created_at, updated_at, deleted_at`.
- **RLS:** owner (`account_id=auth.uid()`) select/insert/update/(none-delete); brand-member reads (`biz_is_brand_member_for_read_for_caller`), brand-admin-plus update/delete (`biz_is_brand_admin_plus_for_caller`); public read of non-deleted brands (anon+authenticated); **admin read (`is_admin_user()`) + admin update (`is_admin_user()`, with_check `is_admin_user()`)**. → Admin can already UPDATE any brand column (incl. `account_id`, profile fields, `deleted_at`, `claim_status`) via RLS; **no admin DELETE policy** (soft-delete via UPDATE deleted_at is the path).

### D. Membership / roles — `public.brand_team_members`
Columns: `id, brand_id → brands.id, user_id (= auth.uid(); NO declared FK), role, invited_at, accepted_at, removed_at, permissions_override jsonb, mingla_tos_accepted_at, mingla_tos_version_accepted`. Role CHECK: `('brand_owner','brand_admin','event_manager','finance_manager','marketing_manager','scanner')`. Exclusion CHECK: `removed_at` only when `accepted_at` present.
- **RLS (GAP):** self-read (`user_id=auth.uid()`) + `biz_is_brand_admin_plus_for_caller(brand_id)` for read/insert/update/delete. **No admin policy** → admin can't see/manage any brand's team via the browser.

### E. Invitations
- **`brand_invitations`:** `id, brand_id → brands.id, email, role, invited_by, token_hash, expires_at, accepted_at, invitee_name, status (def 'pending'), accepted_by_account_id → creator_accounts.id, revoked_at, declined_at`. RLS: brand-owner/admin only (via `brand_team_members`/`creator_accounts` EXISTS checks). **No admin policy** → admin can't list/resend/revoke invites.
- **`partner_brand_links`** (partner-to-owner invite): `id, partner_account_id → creator_accounts.id, brand_id → brands.id, invited_owner_email, personal_note, invited_at, accepted_at, owner_stripe_connected_at, first_split_at, cancelled_at`. RLS: `partner_account_id=auth.uid()` self-select only. **No admin policy.**

### F. Subscriptions (consumer only)
- **`subscriptions`:** `id, user_id (=auth.uid()), tier (def 'free') CHECK free/mingla_plus, stripe_customer_id, stripe_subscription_id, current_period_start/end, trial_ends_at, referral_bonus_months, referral_bonus_started_at, is_active, cancelled_at, created_at, updated_at`. RLS: self read/update only. **No admin policy** → admin reads via `admin_list_subscriptions` RPC.
- **`admin_subscription_overrides`:** `id, user_id, tier CHECK free/mingla_plus, reason, granted_by, starts_at, expires_at, revoked_at, created_at, updated_at`. RLS: self-read own overrides only. Writes via `admin_grant_override` / `admin_revoke_override` RPCs; history via `admin_get_override_history`.

### G. Lifecycle / moderation
- **`account_deletion_requests`:** `id, user_id, requested_at, scheduled_hard_delete_at, status (def 'pending'), reason, metadata jsonb`. RLS: owner-read only. **No admin policy.**
- **`admin_users`** (the admin console's own staff roster, email-keyed, NOT the app users): `id, email, role (def 'admin'), status (def 'invited'), invited_by, created_at, accepted_at`. Full admin CRUD via `is_admin_user()` + a `self_activate` policy. This is the gate source for `is_admin_user()` (checks `admin_users.email = auth.email() AND status='active'`).

### Identity RPC inventory (SECURITY DEFINER, admin-gated) relevant to this domain
`is_admin_user`, `is_admin_email`; `admin_list_subscriptions`, `admin_subscription_stats`, `admin_grant_override`, `admin_revoke_override`, `admin_get_override_history`; `admin_toggle_partner`; `admin_set_brand_take_rate_override`, `admin_clear_brand_take_rate_override`; `admin_reset_inactive_sessions`; claim side: `admin_get_claim_review_bundle`, `admin_tweak_venue_claim_fields`, `admin_add_venue_claim_feedback`, `admin_apply_score_override`, `admin_score_place_preview`, `admin_pin_place_to_top`, `admin_place_deck_rank`.
**Absent (no RPC exists):** edit/read a `creator_accounts` business record; list a user's brands; reassign a brand owner; edit brand profile fields; soft-delete/suspend a brand; list/read/resend/revoke `brand_invitations`; read/manage `brand_team_members`; read `account_deletion_requests`.

---

## Existing admin coverage (what it shows/edits TODAY)

### `UserManagementPage.jsx` (consumer-centric, 1765 lines)
- **List/stats** off `profiles` + `profiles_with_segment` (country breakdown, active/onboarded counts, explorer/business/admin segments) — `:166–208, :248`.
- **User detail** loads a wide consumer graph: `profiles.*`, `preferences`, `friends`, `user_activity`, `user_sessions`, `session_participants`→`boards`, `saved_card/saved_people`, `friend_requests/friend_links`, `blocked_users/muted_users`, `conversations`, `calendar_entries`, `place_reviews`, `experience_feedback`, `user_interactions`, `user_reports`, `app_feedback`, `user_location_history`, `preference_history` — `:296–357`. Business side: only `creator_accounts.select("id,partner_enabled,partner_country")` — `:304`.
- **Edit actions:** profile field editor writing `{display_name, username, email, phone, has_completed_onboarding, active, visibility_mode, country, account_type, is_beta_tester}` — `:583–595`; disable/enable (`active` toggle) `:388,:406`; bulk ban `:671`; hard delete (related-row purge + `profiles.delete()` + `delete-user` edge fn) `:520–536`; partner toggle `admin_toggle_partner` `:695`; beta-tester toggle `:731`; "Preview Profile" (read-only impersonation of consumer content) `:611`; CSV export `:649`.
- **Does NOT:** show a user's brands, business_name, team memberships, invites, subscription state, or support history; no auth-level actions (reset password, resend confirm, auth ban/unban).

### `SubscriptionManagementPage.jsx` (consumer Mingla+ only, 835 lines)
- Lists/stat consumer subs via `admin_list_subscriptions` `:136`, `admin_subscription_stats` `:165`; grants a comp via `admin_grant_override` `:298`; revokes via `admin_revoke_override` `:337`; history via `admin_get_override_history` `:327,:363`; reads a config flag in `app_config` `:236,:254`.
- **Does NOT:** touch business accounts, brands, take-rate, or any business monetization.

### `ClaimsPage.jsx` + `adminClaimsService.js` (brand claims only)
- Lists brands by `claim_status` (`pending_review/verified/rejected`) `adminClaimsService.js:44–77`; review bundle `admin_get_claim_review_bundle`; approve/reject/need-more-info/mark-called + feedback + score overrides via `admin-review-venue-claim` edge fn.
- **Identity side:** a claim IS a `brands` row; owner = `brands.account_id → creator_accounts.id`. The page shows the brand's place identity and claim state but **never the owner account**, and offers no owner reassignment or brand-profile edit.

### `SupportDeskPage.jsx` (help & support)
- Reads `support_tickets` (incl. `brand_id`, `requester_user_id`, `requester_segment`) `:150`, joins `brands(id,name)` `:178` and `profiles_with_segment` `:173` for labels; thread via `messages` `:223`; lifecycle via `support-*` edge fns (may be undeployed). Admin sees all via `is_admin_user()`.
- **Does NOT:** link a ticket to the full account/brand identity, or a brand/account to its ticket history.

**No brand-management page exists** (`ls src/pages/` confirms: no Brand/Account page). Routes are hash-based in `App.jsx`.

---

## Gap list — "see, edit, change, help & support" per entity

### Consumer users (`profiles`)
Admin CAN today: view full consumer graph; edit core profile fields; disable/enable (`active`); bulk ban; hard delete (edge fn); beta toggle; preview consumer content.
**Gaps:**
- No auth-level actions: **reset password, resend email confirmation, change/verify auth email, auth-level ban/lock** (current `active=false` is app-enforced only and can be bypassed by any surface that doesn't check it).
- No view of the user's **business side** from the user record: their `creator_accounts` record, owned brands, memberships, subscription/override state, support tickets.
- `email` edit writes only `profiles.email`, drifting from `auth.users.email` (no reconciliation).
- No moderation view of `account_deletion_requests` (pending deletions invisible).

### Business / creator accounts (`creator_accounts`)
Admin CAN today: only `admin_toggle_partner` (partner_enabled) via RPC; a fragile 2-field read that depends on the public-share policy.
**Gaps (largest of the three):**
- **No admin read** of `creator_accounts` (business_name, email, phone_e164, avatar, default_brand_id, marketing_opt_in, deleted_at) — no admin RLS policy and no RPC.
- **No admin edit** of any business-account field.
- No "list this account's brands / team / invites / payments" rollup.
- No soft-delete / restore / suspend of a business account (only `deleted_at`, unreachable by admin).
- No concept of a business plan to comp (monetization is take-rate; see brands).

### Brands (`brands`)
Admin CAN today: read + update ANY brand column via `is_admin_user()` RLS (used only by the claims flow); set/clear take-rate override via RPC.
**Gaps (capability exists at RLS, no surface):**
- No UI to **edit brand profile** (name, description, contacts, social/custom links, theme, currency, tax/fee defaults, kind, venue_category).
- No **owner reassignment** (`account_id`) UI/service — high-value for support ("move this brand to the right account").
- No **soft-delete / restore** (`deleted_at`) or **suspend/revoke** (`claim_status`) UI.
- No admin list/search of ALL brands (only claim-filtered lists exist).
- `brands.kind` docs-vs-schema contradiction unresolved.
- `default_currency` is `character` (fixed-length) and nullable while `pricing_currency` defaults `'GBP'`/`pricing_region 'GB'` — currency surfaced in a console must read the right field (see the ORCH-1034/1236 currency-tracks-default work).

### Membership / roles (`brand_team_members`) & invitations (`brand_invitations`, `partner_brand_links`)
Admin CAN today: nothing (no admin RLS, no RPC).
**Gaps:** no admin view of a brand's team or roles; no add/remove/change-role; no view of pending/expired invites; **no resend/revoke invite**; no view of partner links.

### Subscriptions (consumer)
Admin CAN today: list/stat, grant/revoke comp, history (all RPC-backed) — reasonably complete for consumer Mingla+.
**Gaps:** override read/list still relies on RPCs (fine); no linkage from a user record to their subscription in `UserManagementPage`; no business equivalent (by design — none exists).

### Support
Admin CAN today: see all tickets, thread, reply, set status (if edge fns deployed); ticket carries `brand_id`.
**Gaps:** no cross-navigation account/brand ⇄ tickets; no "open a ticket / note on behalf of" from an account/brand record; support-* edge fns may be undeployed.

---

## Five-truth-layer contradictions flagged (not resolved)
- **Docs vs Schema — `brand.kind`:** memory says DECOMMISSIONED; live schema keeps `kind NOT NULL DEFAULT 'popup'` + CHECK. Console must decide display/edit semantics.
- **Code vs Schema — admin `creator_accounts` read:** `UserManagementPage.jsx:304` assumes it can read another account; schema RLS has no admin policy, so it succeeds only via the public-share-page policy and returns null otherwise (latent, silent).
- **Capability vs Surface — `brands`:** admin-UPDATE RLS already allows full brand editing incl. owner reassignment; no code uses it beyond claims.

## Discoveries for Orchestrator (out of scope, flagged)
- **D-1 (security):** advisor flags `_backup_profiles` and `_deprecated_profiles_is_admin_backup` as **RLS-disabled in public** (data-exposure risk — full profile backups). Separate from this ORCH; worth a cleanup ORCH.
- **D-2:** `brands` and `business_public_brands_view` flagged as SECURITY DEFINER views by the advisor — verify intended.
- **D-3:** `brand_team_members.user_id` has **no FK** to `auth.users`/`creator_accounts` — orphan-membership risk; a console that manages teams should validate on write.

## Scale (live, post-2026-06-22 wipe)
`profiles`=46 (0 disabled), `creator_accounts`=13 (1 soft-deleted), live `brands`=5, active memberships=12, pending brand invites=0, Mingla+ subs=4, auth ids that are BOTH consumer+business=13.

---

## Candidate approaches (direction only — NOT a spec)
1. **Add `is_admin_user()` RLS read (and scoped update) to the business layer** (`creator_accounts`, `brand_team_members`, `brand_invitations`, `partner_brand_links`) — mirrors what already exists for `profiles`/`brands`; unlocks browser-side visibility with the anon key. Lowest-friction for read; guard writes carefully.
2. **OR keep the browser on the anon key and add SECURITY DEFINER admin RPCs** (pattern already established: `admin_toggle_partner`, `admin_grant_override`, claim RPCs) for each new capability: `admin_get_account_bundle(user_id)` (profile + account + brands + team + subs + tickets), `admin_edit_account`, `admin_edit_brand`, `admin_reassign_brand_owner`, `admin_set_brand_status` (soft-delete/suspend), `admin_list_brand_team`, `admin_resend_brand_invite`. This keeps privileged writes server-audited (each existing admin RPC writes `admin_audit_log`).
3. **Unify the console entry point on the shared `auth.uid()`** so one "person" record shows both the consumer profile and the business account+brands (join `profiles.id = creator_accounts.id`), with tabs for consumer / business / support.
4. **Auth-level actions** (reset password, resend confirm, ban) require a service_role edge fn against the Supabase Auth admin API (the `delete-user` edge fn is the existing precedent) — cannot be done from the browser.
5. **Resolve `brands.kind`** at the product/docs level before exposing it in a brand editor.

**Confidence:** proven for schema + RLS + admin-code coverage (live `information_schema`/`pg_policies`/`pg_constraint` queries + verbatim file:line reads). This is a static schema/RLS/code audit (exempt from sim live-fire per the skill's backend/RLS exemption). Recommended next phase: SPEC the admin identity console's read/edit/support surface for users+accounts+brands, choosing between candidate approaches 1 vs 2 per Seth's key-handling posture (anon-key-only browser).
