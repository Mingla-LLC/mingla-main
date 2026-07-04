# SPEC — ORCH-1272 [Admin Identity console — READ-ONLY]

**Parent:** META-ORCH-1237 (Admin full-visibility console). **Child sequence:** unblocks only after ORCH-1271 ships. **Phase:** SPEC (build contract). **Author:** mingla-forensics.
**Backend:** Supabase LIVE PROD `gqnoajqerqhnvulmnyvv`. **Surface:** Admin Web (`mingla-admin/`) + backend (RLS SELECT policies + ONE read-RPC). **No shipping-app surface, no edits.**
**Inputs consumed (in full):** `reports/SPEC_ORCH-1271_ADMIN_AUTHZ_FOUNDATION.md` (foundation contract), `reports/INVESTIGATION_META-ORCH-1237_IDENTITY_USERS_ACCOUNTS_BRANDS.md` (domain truth), `reports/INVESTIGATION_META-ORCH-1237_MASTER_SYNTHESIS.md` (plan), plus verbatim reads of `mingla-admin/src/pages/UserManagementPage.jsx`, `SubscriptionManagementPage.jsx`, `services/adminClaimsService.js`, `App.jsx`, `lib/constants.js`.
**COMMS ledger:** scanned on entry. Only scope-relevant OPEN row = COMMS-0061 (WARN, ALL): `gqnoajqerqhnvulmnyvv` is LIVE PROD, drills clone-only. Honored by construction — this spec ran read-only `execute_sql` SELECT probes only, mutated nothing. Factored; no ack write needed (WARN, honored).

> Every schema / column / policy / function name below was verified against live PROD via read-only `execute_sql` on 2026-07-03. `[verified]` = confirmed this session; `[report]` = sealed by the cited investigation; `[1271]` = defined by the foundation spec (consumed, not redefined).

---

## Binding decision — VISIBILITY-FIRST (Seth)

This wave ships **READ-ONLY**. Spec the full read/see console for identity now. Every edit / change / support-action surface is **DESIGNED here but marked WAVE-2 (deferred)** and is NOT buildable in 1272. Wave-2 edits will use the ORCH-1271 audited-write primitive (`admin_write_audit` + §2d template + `HighRiskActionModal`). No edit RPC is specced as buildable.

---

## 1. Scope & non-goals (read-only)

**In scope — admin READ visibility for four identity entities:**
1. **Unified Person view** — one screen showing BOTH halves for a user: consumer profile (`profiles`) + business account (`creator_accounts`, shared PK) + brands they own/belong to + subscription (effective tier + override) + support tickets.
2. **Accounts** — list / search / detail of `creator_accounts` (business_name, contacts, partner flags, soft-delete). Currently near-invisible to admin.
3. **Brands** — cross-brand list / search + detail (profile, currency, `kind`, owner account, claim/verify state, take-rate, Stripe flags). Brands already have admin-read RLS — reuse.
4. **Team & invites (read)** — a brand's `brand_team_members` (roles) + `brand_invitations` + `partner_brand_links`.

**Non-goals (HARD — do NOT build in 1272):**
- NO edit / change / mutation of ANY identity field (brand profile, account, owner, currency, kind, take-rate, membership, invite state). All routed to Wave-2 (§5).
- NO destructive action (suspend, soft-delete, restore, ban, disable, delete-user, resend/revoke invite, owner-reassign).
- NO new RLS on `subscriptions` / `admin_subscription_overrides` (money-ish; read via the existing RPC path per the §3 convention).
- NO change to `UserManagementPage.jsx` / `SubscriptionManagementPage.jsx` behavior. They stay as-is; the new Person view is reachable independently (and deep-linkable — §4A).
- NO new `is_admin_user()` internals, no `account_type='admin'` reintroduction, no changes to any ORCH-1271 primitive, invariant, or component API.
- NO shipping-app (`app-mobile/`, `mingla-business/`) code.
- NO remediation of the flagged `delete-user` self-delete gap or `admin_set_city_live` (out of scope; 1271 flagged, Wave-2/other ORCH owns).

**Cross-surface impact (all NOT-covered surfaces are backend-only reads or admin-web):** Consumer iOS/Android — not covered (no shipping-app change). Buyer/anon Web — not covered. Business iOS/Android — not covered. **Admin Web (`mingla-admin/`) — COVERED (the only UI surface).** Business Web preview — not covered. Parity is automatic (single admin-web surface).

---

## 2. Foundation-contract dependencies (ORCH-1271 — consumed verbatim, not redefined)

1272 is a strict consumer of the 1271 foundation. It **must** reuse, and must NOT re-implement:

| From 1271 | 1272 uses it for |
|---|---|
| **Read-authz convention** (§3 of 1271: RLS-policy vs read-RPC decision rule; naming `admin_list_*`/`admin_get_*`; return-shape `{rows,total}` for lists, single `jsonb` for detail; the MANDATORY "prove against a known draft/private/cross-brand row" acceptance rule) | Every read-authz choice in §4 below follows it exactly. |
| **`EntityListView`** (`components/entity/EntityListView.jsx`) — props `{title, columns, fetchPage:async({search,sortKey,sortDir,filters,page,pageSize})=>{rows,total}, filters, csv, onRowClick, emptyMessage, ...}` | The list on People + Brands pages. |
| **`EntityDetailView`** (`components/entity/EntityDetailView.jsx`) — props `{header:{title,subtitle,badges,backLabel,onBack}, sections:[{label,fields:[{label,value,render}]}], loading, error, onRetry, actions?}` | The Person detail + Brand detail. In 1272 `actions` is UNUSED (read-only); Wave-2 attaches `HighRiskActionModal` actions. |
| **`HighRiskActionModal`** | NOT wired in 1272. Reserved for Wave-2 edits. |
| **`I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT`** + its strict-grep registry | `admin_get_person` (§4A) is APPENDED to that registry (guard-first). It is a READ RPC → **NOT** added to the `i-admin-write-audited` write-RPC registry (it performs no mutation, so it must not be forced to call `admin_write_audit`). |
| **`is_admin_user()` single gate** (1271 §1) | The sole gate for every new RLS policy + the read-RPC. `account_type='admin'` is never referenced. |
| **`brands.kind` ALIVE DEC** (1271 §6) | Brand detail shows `kind` (physical/popup/trip_planner) as a live, read-only field. |
| **"Business" nav group + `Building2` icon** (1271 §4a; `Building2` already in `Sidebar.jsx` ICON_MAP) | 1272 repurposes this group (see §4, Open Q1). |

**Hard rule:** if any 1271 API differs from the above when 1272 implements, STOP and request a SPEC amendment — do not adapt silently.

---

## 3. Read-authz choice per entity (applying the 1271 §3 rule)

| Entity | Read path | Authz mechanism | Why (per 1271 §3 rule) |
|---|---|---|---|
| **Accounts** (`creator_accounts` list/detail) | Browser `supabase.from('creator_accounts')` (anon key) | **NEW RLS SELECT policy** `"creator_accounts admin can read" USING (is_admin_user())` | Whole rows of a single table, no cross-brand derivation → mirror `brands`/`venue_listings`/`profiles`. |
| **Brands** (`brands` list/detail) | Browser `supabase.from('brands')` | **REUSE existing RLS** (`"brands admin can read" USING is_admin_user()` `[verified]`) | Already present. Admin policy (unlike "Public can read non-deleted brands") also exposes soft-deleted brands — required for the console. NO new policy. |
| **Team** (`brand_team_members`) | Browser `supabase.from('brand_team_members')` | **NEW RLS SELECT policy** `"brand_team_members admin can read" USING (is_admin_user())` | Whole-row single-table read. |
| **Invites** (`brand_invitations`) | Browser `supabase.from('brand_invitations')` | **NEW RLS SELECT policy** `"brand_invitations admin can read" USING (is_admin_user())` | Whole-row single-table read. |
| **Partner links** (`partner_brand_links`) | Browser `supabase.from('partner_brand_links')` | **NEW RLS SELECT policy** `"partner_brand_links admin can read" USING (is_admin_user())` | Whole-row single-table read. |
| **Unified Person** (profile + account + brands + subscription + tickets) | Browser `supabase.rpc('admin_get_person', {p_user_id})` | **NEW read-RPC** `admin_get_person(p_user_id uuid) RETURNS jsonb` (SECURITY DEFINER, guard-first) | Joined + cross-brand + crosses the sensitive `subscriptions`/`admin_subscription_overrides` tables + derives effective tier → RPC per the rule. Precedent: `admin_get_claim_review_bundle` `[verified]`. |

**Copy-paste RLS exemplar** `[verified: "venue_listings admin can read"]`:
```sql
CREATE POLICY "<table> admin can read" ON public.<table> FOR SELECT USING (public.is_admin_user());
```

---

## 4. Per-entity READ spec

All UI paths under `mingla-admin/src/`. All backend under `supabase/migrations/`. Reuse `EntityListView` / `EntityDetailView` `[1271]`; reuse existing `ui/*` kit; do NOT re-implement Table/Modal/SearchInput/Card/Badge/Skeleton/Spinner/Toast.

### 4A. Unified Person view — `admin_get_person` read-RPC + Person detail

**Table facts** `[verified]`: `profiles.id` = `creator_accounts.id` = `auth.uid()` (shared PK; proven on all 13 business accounts `[report]`). `brands.account_id → creator_accounts.id` (owner, NOT NULL). `brand_team_members.user_id` = `auth.uid()` (NO FK `[report: D-3]`). `subscriptions.user_id`, `admin_subscription_overrides.user_id`, `support_tickets.requester_user_id` = the same uid.

**Migration** `supabase/migrations/<ts>_orch_1272_admin_get_person.sql` (implementor: next-free UTC ts > latest on `origin/main`). No such RPC exists today `[verified]`. Ship verbatim (adjust only formatting) — this IS the read primitive:
```sql
CREATE OR REPLACE FUNCTION public.admin_get_person(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_out jsonb; v_ov RECORD;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- (I-ADMIN-GATE-FIRST-STATEMENT)
  SELECT to_jsonb(p) INTO v_out FROM public.profiles p WHERE p.id = p_user_id;
  IF v_out IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  v_out := jsonb_build_object(
    'person',  v_out || jsonb_build_object('segment', public.derive_user_segment(p_user_id)),
    'account', (SELECT to_jsonb(a) FROM public.creator_accounts a WHERE a.id = p_user_id),
    'brands_owned', COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.created_at DESC)
                              FROM public.brands b WHERE b.account_id = p_user_id), '[]'::jsonb),
    'brands_member', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                 'brand_id', b.id, 'brand_name', b.name, 'brand_slug', b.slug,
                                 'role', m.role, 'accepted_at', m.accepted_at, 'removed_at', m.removed_at))
                              FROM public.brand_team_members m JOIN public.brands b ON b.id = m.brand_id
                              WHERE m.user_id = p_user_id), '[]'::jsonb),
    'subscription', jsonb_build_object(
        'effective_tier', public.get_effective_tier(p_user_id),
        'raw', (SELECT to_jsonb(s) FROM public.subscriptions s WHERE s.user_id = p_user_id)),
    'active_override', (SELECT to_jsonb(o) FROM public.admin_subscription_overrides o
                        WHERE o.user_id = p_user_id AND o.revoked_at IS NULL
                          AND o.starts_at <= now() AND o.expires_at > now()
                        ORDER BY o.expires_at DESC LIMIT 1),
    'tickets', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                            'id', t.id, 'subject', t.subject, 'status', t.status, 'priority', t.priority,
                            'brand_id', t.brand_id, 'created_at', t.created_at, 'last_message_at', t.last_message_at)
                            ORDER BY t.last_message_at DESC)
                         FROM public.support_tickets t WHERE t.requester_user_id = p_user_id), '[]'::jsonb));
  RETURN v_out;
END; $$;
```
Notes: guard FIRST (no query precedes it). READ-ONLY — no `admin_write_audit`, NOT in the write-RPC registry. Reuses `get_effective_tier` + `derive_user_segment` `[verified]`. Timestamps ISO-8601 (jsonb default); money raw (`take_rate_bps_override` int, currency codes) — no pre-formatting.

**Service** — `mingla-admin/src/services/identityReadService.js` (new): `getPerson(userId) -> supabase.rpc('admin_get_person', { p_user_id: userId })` returning `{ data, error }`.

**Person detail UI** — rendered by `EntityDetailView` inside `PeopleConsolePage` (§4B). Sections (all read-only; use `SectionCard`/`Badge`/`Avatar` from kit):
- **Header:** `person.display_name || account.business_name || person.email`; subtitle = `user_id` (mono); badges = segment (`derive_user_segment`), `active === false ? "Banned" : "Active"`, `account ? "Business" : "Consumer-only"`, `account.deleted_at ? "Account deleted"`.
- **Consumer profile:** email, username, first/last name, phone, country, currency, `visibility_mode`, `has_completed_onboarding`, `is_beta_tester`, `created_at`. (Read straight from `person.*`.)
- **Business account:** business_name, email, phone_e164, `partner_enabled`, `partner_country`, `default_brand_id` (resolve name from `brands_owned`), `marketing_opt_in`, `deleted_at`, `created_at`. Empty-state copy if `account` is null: "No business account — consumer-only user."
- **Brands owned** (`brands_owned[]`): row per brand → name, `kind`, `claim_status` badge, `pricing_currency`, `deleted_at`. Click → open Brand detail (§4C).
- **Brands member of** (`brands_member[]`): brand_name, `role` badge, `accepted_at`, `removed_at` (dim if removed).
- **Subscription:** `subscription.effective_tier` badge; raw tier `subscription.raw.tier`; trial/period from `subscription.raw`; if `active_override` present → override tier + reason + expiry (reuse the `TierBadge`/`timeRemaining` style from `SubscriptionManagementPage`, read-only).
- **Support tickets** (`tickets[]`): subject, status badge, priority, created/last-message; brand label if `brand_id` (resolve from `brands_owned`). Deep-link to `#/support` (existing) preserved.
- **States:** loading → `EntityDetailView loading`; error (`not_authorized`/`not_found`/network) → `EntityDetailView error` + `onRetry`; empty sub-lists → explicit "None" copy (never a fabricated 0/row).

**Deep-link:** Person detail opens via hash param `#/business-people?userId=<uuid>` (mirrors `UserManagementPage.jsx:152-159`'s `userId` param) so support agents (and Wave-2 cross-links from `UserManagementPage`) can jump straight in for any user, including consumer-only ones.

### 4B. Accounts — `creator_accounts` list → Person detail

**RLS migration** `supabase/migrations/<ts>_orch_1272_identity_admin_read_rls.sql` — add (this file also carries the team/invites/partner policies, §4D):
```sql
CREATE POLICY "creator_accounts admin can read" ON public.creator_accounts FOR SELECT USING (public.is_admin_user());
```

**Columns (verified live)** available to read: `id, email, display_name, avatar_url, business_name, phone_e164, marketing_opt_in, deleted_at, default_brand_id, partner_enabled, partner_country, created_at, updated_at`.

**Page** — `mingla-admin/src/pages/PeopleConsolePage.jsx` (new). Uses `EntityListView`:
- **List source (service `listAccounts`):** `supabase.from('creator_accounts').select('id,business_name,display_name,email,phone_e164,partner_enabled,partner_country,default_brand_id,deleted_at,created_at', { count:'exact' })` + server `.order()` + `.range(page*size,(page+1)*size-1)`. Returns `{ rows: data, total: count }`.
- **List columns:** Business (business_name || display_name), Email, Phone (phone_e164), Partner (`partner_enabled` badge + partner_country), Default brand (resolve name via one `brands.in('id', defaultBrandIds)` read; "—" if none), Status (`deleted_at ? "Deleted" : "Active"`), Joined (`created_at`, `timeAgo`).
- **Search:** debounced 300ms `.or('business_name.ilike.%<s>%,display_name.ilike.%<s>%,email.ilike.%<s>%,phone_e164.ilike.%<s>%')` (escape via `escapeLike`).
- **Filters:** Partner (`all`/`enabled`/`disabled` → `.eq('partner_enabled', …)`), Status (`all`/`active`(deleted_at IS NULL)/`deleted`(deleted_at NOT NULL) → `.is('deleted_at', null)` / `.not('deleted_at','is',null)`).
- **CSV:** cols = id, business_name, email, phone_e164, partner_enabled, partner_country, deleted_at, created_at; filename `accounts`.
- **Row click:** open **Person detail** (§4A) for that `id` (account.id == person.id).
- **States:** loading → DataTable loading; error → Card + retry (surface `error.message`); empty → "No business accounts match." **Silent-empty guard:** if the admin RLS policy were missing this list would return `[]` and look empty-but-fine — the mandatory cross-row acceptance proof (AC-2.3) catches that.

### 4C. Brands — `brands` list → Brand detail (reuse existing admin RLS)

**No new brands RLS** — `"brands admin can read" USING is_admin_user()` exists `[verified]` and exposes soft-deleted brands (the "Public can read non-deleted brands" policy does not).

**Columns (verified live):** `id, account_id, name, slug, description, kind, venue_category, claim_status, verified_at, city, country_code, default_currency (char, nullable), pricing_currency (def GBP), pricing_region, take_rate_bps_override (0–3000), payment_provider, stripe_charges_enabled, stripe_payouts_enabled, deleted_at, created_at`. `kind` CHECK `physical/popup/trip_planner` `[verified]`; `claim_status` CHECK `none/pending_review/verified/rejected/suspended/revoked` `[verified]`.

**Page** — `mingla-admin/src/pages/BrandsConsolePage.jsx` (new). Uses `EntityListView`:
- **List source (service `listBrands`):** `supabase.from('brands').select('id,name,slug,kind,claim_status,city,country_code,pricing_currency,default_currency,take_rate_bps_override,payment_provider,stripe_charges_enabled,account_id,deleted_at,created_at', { count:'exact' })` + order + range → `{ rows, total }`. Resolve owner business_name via one `creator_accounts.in('id', accountIds)` read (admin RLS) mapped onto rows.
- **List columns:** Name (+ slug), Kind (badge), Claim status (badge; color map: verified→success, pending_review→warning, rejected/suspended/revoked→error, none→default), Owner (business_name via in()-read; "—"), City/Country, Currency (**`pricing_currency`** primary; `default_currency` secondary/dim per ORCH-1034/1236 currency-tracks-default), Take-rate (`take_rate_bps_override` → display helper `bps/100 + "%"`, "default" if null), Payments (`payment_provider` + Stripe charges dot), Status (`deleted_at ? "Deleted" : "Live"`), Created.
- **Search:** `.or('name.ilike.%<s>%,slug.ilike.%<s>%,city.ilike.%<s>%')`.
- **Filters:** Claim status (all + the 6 CHECK values → `.eq('claim_status',…)`), Kind (all/physical/popup/trip_planner), Status (all/live/deleted), Payment provider (all/stripe/paystack).
- **CSV:** id, name, slug, kind, claim_status, city, country_code, pricing_currency, take_rate_bps_override, payment_provider, deleted_at, created_at; filename `brands`.
- **Row click → Brand detail** (`EntityDetailView`), sections composed from direct RLS reads (service `getBrandDetail(brandId)`):
  - **Brand profile:** name, slug, description, kind, venue_category, city/country, lat/lng, cover/profile media URLs, theme_color/font/animation, social_links/custom_links (rendered read-only). Source: the brand row.
  - **Claim / verification:** claim_status badge, verified_at, verified_by (uuid), rejection_reason, marked_called_at, duplicate_of_brand_id.
  - **Money:** pricing_currency, default_currency (dim), pricing_region, take_rate_bps_override (+ % helper), payment_provider, payment_country, stripe_connect_id, stripe_charges_enabled, stripe_payouts_enabled, paystack_subaccount_code. (All read-only; no live Stripe call — that is ORCH-1274.)
  - **Owner:** `creator_accounts` where `id = brand.account_id` (admin RLS): business_name, email, phone_e164, partner_enabled, deleted_at. Link → open Person detail for `account_id`.
  - **Team** (§4D): `brand_team_members` where `brand_id`.
  - **Invites** (§4D): `brand_invitations` where `brand_id`.
  - **Partner links** (§4D): `partner_brand_links` where `brand_id`.
  - **Support tickets for this brand:** `support_tickets` where `brand_id` (admin RLS): subject, status, created_at.
- **States:** same loading/error/empty contract; each sub-section shows explicit "None" when empty (never fabricated).

### 4D. Team & invites (read) — three new RLS policies

Added in the same `<ts>_orch_1272_identity_admin_read_rls.sql` migration:
```sql
CREATE POLICY "brand_team_members admin can read" ON public.brand_team_members FOR SELECT USING (public.is_admin_user());
CREATE POLICY "brand_invitations admin can read"  ON public.brand_invitations  FOR SELECT USING (public.is_admin_user());
CREATE POLICY "partner_brand_links admin can read" ON public.partner_brand_links FOR SELECT USING (public.is_admin_user());
```

**Read (service `getBrandDetail` sub-reads, all filtered by `brand_id`):**
- **`brand_team_members`** cols `[verified]`: `id, user_id, role, invited_at, accepted_at, removed_at, permissions_override`. Role CHECK `brand_owner/brand_admin/event_manager/finance_manager/marketing_manager/scanner` `[verified]`. Resolve member display via one `profiles.in('id', userIds)` read (NO FK, so explicit in()-read, not embed) + `creator_accounts.in('id', userIds)` for business_name. Detail rows: member name/email, role badge, accepted/removed state (dim if `removed_at`).
- **`brand_invitations`** cols `[verified]`: `id, email, role, status, invitee_name, invited_by, expires_at, accepted_at, revoked_at, declined_at`. Status CHECK `pending/accepted/revoked/expired/declined` `[verified]`. Rows: email/invitee_name, role, status badge, expires_at. (Live count = 0 pending `[report]` — the read must render an empty "No invitations" state correctly; the RLS-present proof (AC-4.3) uses any historical/other-status row or, if none, asserts policy presence + non-admin denial.)
- **`partner_brand_links`** cols `[verified]`: `id, partner_account_id, invited_owner_email, personal_note, invited_at, accepted_at, owner_stripe_connected_at, cancelled_at`. Rows: partner (resolve `partner_account_id` business_name via in()-read), invited_owner_email, accepted/cancelled state.

### 4E. Nav + routing wiring

- `lib/constants.js`: the "Business" nav group `[1271]` — set its `items` to **two** real entries (removing the `business-console` placeholder item):
  ```js
  { label: "Business", items: [
    { id: "business-people", label: "People", icon: "Users" },      // Users already in ICON_MAP
    { id: "business-brands", label: "Brands", icon: "Building2" },   // Building2 added by 1271
  ] }
  ```
  Both icons are already registered in `Sidebar.jsx` ICON_MAP `[verified: Users used by Users nav; Building2 added by 1271]` → **no Sidebar.jsx edit needed**.
- `App.jsx`: in `PAGES`, remove `"business-console"`, add `"business-people": PeopleConsolePage` + `"business-brands": BrandsConsolePage`. Hash routes `#/business-people`, `#/business-brands` work via `getTabFromHash`.
- Delete the 1271 placeholder `pages/BusinessConsolePage.jsx` (its smoke-test purpose is served; the two real pages replace it). `services/adminWriteService.js` (1271) is left untouched — Wave-2 uses it. (See Open Q1.)

---

## 5. Wave-2 deferred-edit DESIGN notes (DO NOT build in 1272)

Each is DESIGNED here so the read surface anticipates it, but is **buildable only in Wave-2** via the 1271 audited-write primitive (guard-first `admin_<verb>_<entity>(…, p_reason text)` per §2d template, or a service_role edge fn for Stripe; each with typed reason + confirm via `HighRiskActionModal` + server `admin_write_audit`). The Person/Brand `EntityDetailView` reserves the `actions` slot for these; in 1272 it is empty.

| Wave-2 action | Target | Primitive path | Notes |
|---|---|---|---|
| Edit brand profile (name, description, contacts, links, theme, currency, `kind`, venue_category) | `brands` | `admin_update_brand(p_brand_id, …, p_reason)` — brands admin-UPDATE RLS already permits `[verified]`; wrap in audited RPC | `kind` is a live editable column (1271 DEC). |
| Reassign brand owner | `brands.account_id` | `admin_reassign_brand_owner(p_brand_id, p_new_account_id, p_reason)` | Validate new account exists + not soft-deleted. High-value support action. |
| Suspend / revoke brand | `brands.claim_status` → suspended/revoked | `admin_set_brand_claim_status(p_brand_id, p_status, p_reason)` | Confirm-phrase gate. |
| Soft-delete / restore brand | `brands.deleted_at` | `admin_set_brand_deleted(p_brand_id, p_deleted bool, p_reason)` | Reversible. |
| Edit business account | `creator_accounts` | needs NEW admin-UPDATE RLS or audited RPC (no admin write today `[report]`) | Account fields (business_name, phone_e164, marketing_opt_in). |
| Soft-delete / restore account | `creator_accounts.deleted_at` | audited RPC | |
| Resend / revoke invite | `brand_invitations` | audited RPC (+ email edge fn for resend) | Revoke = set `revoked_at`/`status`. |
| Change / remove team member role | `brand_team_members` | audited RPC | Validate `user_id` (D-3: no FK → validate on write). |
| Disable / ban user | `profiles.active` | audited RPC (app-enforced only; no auth-level ban today `[report]`) | Auth-level ban needs a service_role edge fn (Auth admin API). |
| Safe user delete | `auth.users` + cascade | NEW service_role edge fn — **current `delete-user` self-deletes the caller's own id, no safe admin arbitrary-user-delete path `[report: D-1/G-7]`** | Must be built net-new, carefully guarded. |

---

## 6. Invariants

**Preserved:** `I-PROPOSED-1271-ADMIN-SINGLE-GATE` (every new policy/RPC uses `is_admin_user()`, never `account_type='admin'`), `I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT` (`admin_get_person` guards first — appended to that registry).

**New (DRAFT — flip ACTIVE on CLOSE; orchestrator owns the flip):**

| ID | Rule | Enforcement | Regression-test (fails-on-revert) |
|---|---|---|---|
| `I-PROPOSED-1272-IDENTITY-ADMIN-READ` | The four identity tables `creator_accounts`, `brand_team_members`, `brand_invitations`, `partner_brand_links` each have an `is_admin_user()` SELECT RLS policy; the admin Person bundle reads only via the guard-first `admin_get_person` RPC (no direct browser read of `subscriptions`/`admin_subscription_overrides`). | strict-grep over `supabase/migrations/**`. | `.github/scripts/strict-grep/i-1272-identity-admin-read.mjs` + `__tests__/` fixture: assert the four `CREATE POLICY "<table> admin can read" ON public.<table> FOR SELECT USING (public.is_admin_user())` tokens are PRESENT in a migration AND `admin_get_person(` definition is PRESENT. Reverting the RLS/RPC migration removes the tokens → script FAILS; restored → PASSES. Register one job step in `.github/workflows/strict-grep-mingla-business.yml`. |

**Registry append (append-only, 1271-owned):** add `admin_get_person` to the `i-admin-gate-first-statement.mjs` registered-fn list. Do **NOT** add it to the `i-admin-write-audited.mjs` write-RPC set (it performs no write).

---

## 7. Acceptance criteria (testable)

**HP** = happy-path (implementor self-verify). **ADV** = adversarial (tester). CLOSE gate requires both. Every read surface carries the MANDATORY "prove against a known draft/private/cross-brand row" rule `[1271 §3]` — spelled out per entity below. Live-data anchors `[report, post-wipe]`: `creator_accounts`=13 (1 soft-deleted), live `brands`=5, memberships=12, mingla+ subs=4, pending invites=0.

**AC-1 — RLS + RPC (§4A/§4B/§4D)**
- AC-1.1 [HP] After migrations, `pg_policies` shows an `is_admin_user()` SELECT policy on each of `creator_accounts`, `brand_team_members`, `brand_invitations`, `partner_brand_links`; and `admin_get_person(uuid)` exists as SECURITY DEFINER.
- AC-1.2 [HP] As active admin, `SELECT admin_get_person('<a real business user id>')` returns a jsonb bundle with non-null `person` + `account` + a non-empty `brands_owned` + `subscription.effective_tier`.
- AC-1.3 [ADV] `admin_get_person` guard: a **non-admin** authed session calling it RAISES `not_authorized` and returns no data (proves guard-first). `admin_get_person('<random uuid>')` as admin RAISES `not_found`.
- AC-1.4 [ADV — the mandatory cross-row proof] As admin, all four direct reads return rows the admin does NOT own: (a) a `creator_accounts` row **with `deleted_at` set** (the soft-deleted account) — a non-admin session gets `[]` for it; (b) a `brand_team_members` row for a brand the admin is not a member of; (c) a `brands` row with `deleted_at` set (soft-deleted) — non-admin's "Public can read non-deleted brands" excludes it. Each pair (admin sees / non-admin blocked) is asserted live.
- AC-1.5 [ADV] `i-1272-identity-admin-read.mjs` FAILS when the RLS/RPC migration is reverted; PASSES restored. `i-admin-gate-first-statement.mjs` (with `admin_get_person` registered) FAILS if the guard is not the first statement.

**AC-2 — Accounts (People) list (§4B)**
- AC-2.1 [HP] `#/business-people` loads `PeopleConsolePage`; the list shows ≥12 business accounts with business_name/email/phone/partner/status columns.
- AC-2.2 [HP] Search narrows by business_name/email/phone; Partner filter and Status filter (active/deleted) change the rows; the soft-deleted account appears only under Status=Deleted (or All); CSV downloads.
- AC-2.3 [ADV] Row click opens the **unified Person detail** showing BOTH halves (consumer profile + business account + owned brands + subscription + tickets) for a user the admin is not. Silent-empty guard: with the `creator_accounts` policy reverted, the list renders empty — proving the policy is load-bearing (tester reverts locally).

**AC-3 — Person detail (§4A)**
- AC-3.1 [HP] Person detail renders each section; consumer-only user (no `creator_accounts`) shows the "No business account" empty-state, not a crash; a business user shows brands + memberships + subscription + tickets.
- AC-3.2 [HP] Deep-link `#/business-people?userId=<uuid>` opens the Person detail directly.
- AC-3.3 [ADV] Person detail for a user with a live `admin_subscription_overrides` row shows the override tier + expiry (proves the private, no-RLS subscription/override data flows through the RPC, not a browser read).

**AC-4 — Brands + Team/Invites (§4C/§4D)**
- AC-4.1 [HP] `#/business-brands` loads `BrandsConsolePage`; list shows all live brands with kind/claim_status/owner/currency/take-rate; Currency column shows `pricing_currency`; take-rate renders as `%` (or "default" when null).
- AC-4.2 [HP] Brand detail composes brand profile + claim + money + owner + team + invites + partner-links + brand tickets; empty sub-sections show "None"; owner link opens the owner's Person detail.
- AC-4.3 [ADV — cross-brand proof] As admin, the Brand detail for a brand under an account the admin does NOT own renders its `brand_team_members` rows (role visible) and its `brand_invitations` state; a non-admin session reading the same `brand_team_members`/`brand_invitations` by `brand_id` gets `[]`. If `brand_invitations` is empty in prod, assert the policy exists + non-admin denial on a synthetic/other-status probe.
- AC-4.4 [ADV] Soft-deleted brand: a brand with `deleted_at` set appears in the admin list under Status=Deleted and its detail loads (admin RLS), while a non-admin cannot read it.

**AC-5 — Scope + build (§1/§4E)**
- AC-5.1 [HP] `mingla-admin` builds (`npm run build`) with zero new lint/type errors; "Business" group shows People + Brands with non-fallback icons; the 1271 `business-console` placeholder route + `BusinessConsolePage.jsx` are gone.
- AC-5.2 [ADV — read-only held] grep `PeopleConsolePage.jsx` + `BrandsConsolePage.jsx` + `identityReadService.js` for `.update(` / `.insert(` / `.delete(` / `admin_write_audit` / `rpc('admin_update` / `rpc('admin_set` → **0 hits** (proves no edit shipped). No new migration contains `ALTER`/`UPDATE`/`INSERT`/`DELETE` on business tables (only `CREATE POLICY` + the read `CREATE FUNCTION`).
- AC-5.3 [HP] `UserManagementPage.jsx` + `SubscriptionManagementPage.jsx` are byte-unchanged (no behavior drift).

**AC-6 — Invariant + registry (§6)**
- AC-6.1 [HP] `I-PROPOSED-1272-IDENTITY-ADMIN-READ` added to `INVARIANT_REGISTRY.md` as DRAFT; `i-1272-identity-admin-read.mjs` + `__tests__/` fixture present + PASS on the built tree; one job step registered in `strict-grep-mingla-business.yml`; `admin_get_person` appended to the `i-admin-gate-first-statement.mjs` registry.

---

## 8. Implementor task list (ordered)

Work inside the per-ORCH worktree (`~/Desktop/mingla-orchs/1272-[identity-console]/`), rebased on `origin/main` **after** ORCH-1271 has merged (dependency).

1. **DB — RLS.** Write `supabase/migrations/<ts>_orch_1272_identity_admin_read_rls.sql`: four `CREATE POLICY "<table> admin can read" … USING (public.is_admin_user())` on `creator_accounts`, `brand_team_members`, `brand_invitations`, `partner_brand_links`. (AC-1.1, AC-1.4)
2. **DB — read-RPC.** Write `supabase/migrations/<ts>_orch_1272_admin_get_person.sql`: `admin_get_person(p_user_id uuid)` verbatim §4A (guard-first, read-only). (AC-1.2, AC-1.3)
3. **Service.** `mingla-admin/src/services/identityReadService.js`: `getPerson`, `listAccounts`, `listBrands`, `getBrandDetail` (each `{data,error}` / `{rows,total}` per §4). Reuse `escapeLike` from `lib/formatters`.
4. **UI — People.** `pages/PeopleConsolePage.jsx`: `EntityListView` (accounts list) + `EntityDetailView` (Person bundle) + `userId` deep-link (§4A/§4B).
5. **UI — Brands.** `pages/BrandsConsolePage.jsx`: `EntityListView` (brands list) + `EntityDetailView` (brand detail w/ team/invites/partner/tickets sections) (§4C/§4D).
6. **Nav wiring.** `lib/constants.js` "Business" group → People + Brands; `App.jsx` PAGES swap; delete `pages/BusinessConsolePage.jsx`. (§4E, AC-5.1)
7. **Invariant + gate.** Add `I-PROPOSED-1272-IDENTITY-ADMIN-READ` to `INVARIANT_REGISTRY.md` (DRAFT); write `.github/scripts/strict-grep/i-1272-identity-admin-read.mjs` + `__tests__/` fixture; register one job step in `strict-grep-mingla-business.yml`; append `admin_get_person` to `i-admin-gate-first-statement.mjs` registry. (AC-6.1)
8. **Self-verify.** `npm run build` (admin) clean; run the new strict-grep script locally (PASS) + prove fails-on-revert on the RLS/RPC migration; run AC-1.2/1.3/1.4 as read-only `SELECT`/`rpc` probes (admin + non-admin sessions); hand migration deploy to orchestrator.

**Allowlist (implementor may create/modify/delete ONLY these):**
`supabase/migrations/<ts>_orch_1272_identity_admin_read_rls.sql`, `<ts>_orch_1272_admin_get_person.sql` · `mingla-admin/src/services/identityReadService.js` · `mingla-admin/src/pages/PeopleConsolePage.jsx`, `BrandsConsolePage.jsx` · `mingla-admin/src/lib/constants.js` · `mingla-admin/src/App.jsx` · DELETE `mingla-admin/src/pages/BusinessConsolePage.jsx` · `.github/scripts/strict-grep/i-1272-identity-admin-read.mjs` (+ `__tests__/` fixture) · `.github/scripts/strict-grep/i-admin-gate-first-statement.mjs` (append `admin_get_person` to registry only) · `.github/workflows/strict-grep-mingla-business.yml` (append one job step) · `Mingla_Artifacts/INVARIANT_REGISTRY.md` (append DRAFT invariant).

**DO-NOT-TOUCH (stop-and-amend first):** `is_admin_user()` · `subscriptions`/`admin_subscription_overrides` RLS (no admin policy — read via RPC only) · any existing `admin_*` RPC or the 1271 primitive (`admin_write_audit`, `admin_audit_probe`) · `services/adminWriteService.js` · `components/entity/*` (consume, don't modify) · `Sidebar.jsx` (icons already registered) · `UserManagementPage.jsx` / `SubscriptionManagementPage.jsx` / `ClaimsPage.jsx` · `delete-user` edge fn · `admin_set_city_live` · any brands admin-WRITE path (Wave-2) · any shipping-app code.

---

## 9. Open questions (with defaults)

- **Q1 (non-blocking) — placeholder disposition.** 1272 deletes the 1271 `BusinessConsolePage.jsx` placeholder and repoints the "Business" nav to two real pages (People, Brands). Alternative: keep it as a landing/index. **Default: delete + two real pages** (no dead placeholder in prod). `adminWriteService.js` stays for Wave-2.
- **Q2 (non-blocking) — Person bundle vs split reads.** `admin_get_person` returns the whole bundle in one RPC (crosses `subscriptions`/`overrides`, reuses `get_effective_tier`). Alternative: compose the profile/account/brands/team/tickets client-side from RLS reads + a tiny `admin_get_subscription_context` RPC for just the money half. **Default: single bundle RPC** — matches the `admin_get_claim_review_bundle` precedent + the §3 "joined/cross-sensitive → RPC" rule, one atomic round-trip.
- **Q3 (non-blocking) — People list scope.** The People list is the missing **business-account** layer (`creator_accounts`), with consumer-only users reachable via the `userId` deep-link (and Wave-2 cross-links from `UserManagementPage`). Alternative: make the list a unified persons list off `profiles_with_segment`. **Default: business-account list + deep-link** — avoids duplicating `UserManagementPage`'s consumer list.
- **Q4 (non-blocking) — team-member identity.** `brand_team_members.user_id` has NO FK `[report: D-3]`, so member names come from explicit `profiles.in()` / `creator_accounts.in()` reads, not a PostgREST embed. **Default: two-step in()-reads** (robust vs embed relationship detection). Orphan `user_id`s render as the raw uuid.
- **No BLOCKING open questions.** All schema/RLS/RPC facts verified against live PROD; the read-authz choice, RPC body, RLS policies, pages, and scaffolding reuse are fully specified.

---

## 10. Downstream routing

Next = **mingla-implementor** (build per §8 task list, in the `1272-[identity-console]` worktree, rebased on `origin/main` after 1271 merges). Then **mingla-tester** (AC matrix — esp. the ADV cross-row proofs AC-1.4/AC-2.3/AC-4.3/AC-4.4, the read-only-held grep AC-5.2, and fails-on-revert on the RLS/RPC migration + strict-grep). Then **orchestrator CLOSE** (flip `I-PROPOSED-1272-IDENTITY-ADMIN-READ` DRAFT→ACTIVE, deploy the two migrations, merge one PR, update WORLD_MAP). ORCH-1273 (offerings) + ORCH-1274 (money) proceed independently on the same 1271 foundation; Wave-2 identity edits (§5) are a later ORCH consuming the 1271 audited-write primitive.
```
