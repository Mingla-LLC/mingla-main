# AUDIT — META-ORCH-1104 LANE B: Admin Segmentation + Data-Integrity Reconciliation + Support-Desk Mount

**Skill mindset:** `mingla-forensics` (INVESTIGATE/AUDIT). Evidence-backed, exact contracts, five-truth-layer reconciliation.
**Date:** 2026-06-08
**Scope:** Admin user segmentation (Explorer / Business / Admin), the data-integrity mess behind "who is what," and where the admin support desk mounts.
**Method:** Read actual source in the worktree + live production DB introspection via `mcp__supabase__execute_sql`. No code edited.
**Verdict:** Finding E4 in the proposal is **CONFIRMED and worse than stated** — there is no single field that segments users correctly; the one field that exists (`account_type`) is 92% null, has **no app reader anywhere**, and is **free-text with no CHECK constraint**. `profiles.is_admin` is a fully dead column. The two admin gates in the system disagree on their source of truth.

---

## 0. Five-truth-layer summary (the contradiction, quantified)

| Truth layer | "Who is admin?" | "Who is business?" | "Who is Explorer?" |
|---|---|---|---|
| `profiles.account_type` | 1 row `'admin'` | 2 rows `'business'` | 35 `null` |
| `profiles.is_admin` | **0 rows true (dead)** | n/a | n/a |
| `admin_users` table | **1 active** (+4 revoked) | n/a | n/a |
| `brand_team_members` (accepted, active) | n/a | **13 distinct users** | n/a |
| RLS gate `is_admin_user()` | `admin_users.status='active'` by email → **1** | n/a | n/a |
| App-mobile / business / marketing code | — | — | **never reads `account_type`** |

Admin truth is represented **four** incompatible ways (1 `account_type='admin'` / 0 `is_admin` / 1 active `admin_users` / 5 raw `admin_users` rows). Business truth is **13 vs 2** (`brand_team_members` vs `account_type='business'`). Explorer is only definable by exclusion.

---

## 1. ADMIN USERS PAGE REALITY — `mingla-admin/src/pages/UserManagementPage.jsx` (1682 lines)

### 1.1 The segment filter that already exists (and lies)
The page filters the user list to "consumers" using two predicates, repeated on **every** list and stats query:

```
.or('account_type.neq.admin,account_type.is.null')   // hide admin accounts
.eq("is_seed", false)                                 // hide seed users
```

- List query: `UserManagementPage.jsx:208-209`
- Stats queries (5×): `:174, :175, :176, :177, :181`
- Countries fetch: `:148`

**Why it lies:** `account_type.neq.admin` only excludes the **1** row literally tagged `'admin'`. It does NOT exclude the 13 real business users (they're null/`'business'`) nor does it segment them — they all appear in the "consumer" list. And `is_seed=false` is currently a **no-op**: `SELECT count(*) FROM profiles WHERE is_seed=true` = **0** (live). So the existing "informal segmentation" is just "hide the single account literally named admin."

### 1.2 List query (`fetchUsers`, :200-241)
- Table: `profiles`, `count: "exact"`, page size 20 (`PAGE_SIZE`, :27).
- Selected columns (:207): `id, display_name, username, email, phone, has_completed_onboarding, active, country, account_type, avatar_url, created_at, first_name, last_name, gender, birthday, visibility_mode, updated_at, is_beta_tester`.
- Search (:213-220): ilike across `display_name,email,username,phone`.
- Existing filters (:221-227): `onboarding` (completed/incomplete), `status` (active/banned via `active` bool), `country`, `dateFrom`, `dateTo`. Stored in `filters` state (:52-58).
- Sort (:204-211): `sortKey`/`sortDir`, default `created_at desc`.

### 1.3 Stats query (`fetchStats`, :170-196)
5 parallel head-count queries → `{ total, active, banned, onboarded, newThisWeek }` (:75). Rendered as 5 `StatCard`s at :992-996. Every count carries the same `.or(account_type…).eq(is_seed,false)` predicate.

### 1.4 List columns (:835-974)
Actions, avatar, Name, Email, Phone, Gender, Birthday, Country, **Type** (`account_type` badge, :925-930 — shows raw value, "—" when null → so 35/38 rows show "—"), Onboarding, Status, **Beta** (toggle), Joined.

### 1.5 Detail view (:1112-1530)
- 18 detail tabs (:1140-1159): Profile, Preferences, Saves, Friends, Requests, Links, People, Blocked, Messages, Boards, Calendar, Reviews, Interactions, Reports, Activity, Sessions, Location, Pref History.
- `fetchUserDetail` (:245-334) fans out ~25 per-user reads (friends, boards, sessions, conversations, reports, etc.) — **all via the anon client under RLS** (see §2).
- Editable `account_type` is a free-text `<Input>` (:1276) → saved at :545 in `handleSaveEdit`. No dropdown, no validation → this is the only writer of `account_type` in the entire codebase besides signup metadata.

### 1.6 Where Explorer / Business / Admin tabs + counts + filter slot would mount
- **Segment tabs:** a `<Tabs>` row (the component is already imported, :17, and used for detail at :1264) directly above the Filters block (`:1001`), or as a 4th selector inside the existing filter `flex` row (:1002-1050) — i.e., a `<select>` styled identically to the onboarding/status/country selects.
- **Counts:** extend the `stats` object (:75) + `fetchStats` (:170) with `explorer`, `business`, `admin` head-counts derived per §3, rendered as additional `StatCard`s in the grid at :987-998 (grid is `xl:grid-cols-5`, would widen).
- **Filter slot:** add `segment` to `filters` state (:52) and a branch in `fetchUsers` (:221-227). BUT — segment is NOT a `profiles` column, so it cannot be a plain `.eq()`. It must resolve to an id-set (e.g. `admin_users` emails, `brand_team_members` user_ids) and filter via `.in("id", …)` / `.not("id","in",…)`. This is the core implementation consequence of the data-integrity finding.

---

## 2. ADMIN AUTH / ROLE MODEL

### 2.1 Client = anon key, NOT service-role
`mingla-admin/src/lib/supabase.js:3-24` constructs the client with `VITE_SUPABASE_ANON_KEY`. There is **no service-role key in the admin app**. All "service-role-like" all-user reads happen through **RLS policies gated on the admin's authenticated session**.

### 2.2 How an admin gets all-user read access
Live RLS policies on `public.profiles`:
- `"Admins can read all profiles"` — `SELECT USING (is_admin_user())` (baseline `:14044`; confirmed live via `pg_policy`).
- `"Admins can update all profiles"` — `UPDATE USING (is_admin_user()) WITH CHECK (is_admin_user())` (baseline `:14056`).

`is_admin_user()` (live def): reads the caller's email from `auth.users` by `auth.uid()`, returns `EXISTS (SELECT 1 FROM admin_users WHERE email=v_email AND status='active')`. **SECURITY DEFINER, STABLE.** So: log in as an active `admin_users` email → RLS opens every user's profile (and downstream per-user tables that have analogous admin policies). This is the mechanism behind the detail view's ~25 fan-out reads.

### 2.3 Auth flow (`AuthContext.jsx`)
- Two-factor: `verifyPassword` (:273) → `signInWithPassword` then immediate `signOut` (no session persists) → `sendOtp` (:308) → `verifyOtp` (:326) sets `FULL_AUTH_KEY` + accepts session.
- Allowlist check is **email-based, dual-source**: hardcoded `ALLOWED_ADMIN_EMAILS` (`constants.js:5-7` = `["seth@usemingla.com"]`) OR dynamic list from `get_admin_emails()` RPC (:129). Gate: `isEmailAllowed` (:24-30) + `is_admin_email` RPC (:276).
- Invited-admin path: `check_invited_admin` RPC (:52), `activate_invited_admin` self-activation (:251, :348).

### 2.4 The admin-gate DIVERGENCE (data-integrity defect)
There are **two different admin gates** in production that consult **different tables**:
- **RLS + login gate** → `is_admin_user()` / `is_admin_email()` / `get_admin_emails()` → all read `admin_users` (by email, `status`).
- **`admin_toggle_partner` RPC** (live def, called from `UserManagementPage:648`) → gates on `profiles.account_type='admin'` (`SELECT EXISTS(... WHERE p.id=auth.uid() AND p.account_type='admin')`). Same pattern in migrations `20260822000000_orch_1052…:434` and `20260823000000_orch_1054…:118`.

Consequence: an admin invited via the Admin Users page (added to `admin_users`, NOT given `profiles.account_type='admin'`) **passes login + RLS but is FORBIDDEN by `admin_toggle_partner`**. Only `seth@usemingla.com` currently satisfies both (he's `admin_users.active` AND `account_type='admin'`). This is a latent privilege bug, independent of the segmentation feature.

### 2.5 `admin_users` live contents (the real admin list)
`SELECT … FROM admin_users LEFT JOIN profiles ON lower(email)`:

| email | role | status | in profiles | account_type | is_admin |
|---|---|---|---|---|---|
| seth@usemingla.com | owner | **active** | yes | admin | false |
| sethogieva@gmail.com | admin | revoked | yes | null | false |
| egbunagreat02@gmail.com | admin | revoked | no | — | — |
| greatminglaadmin@yopmail.com | admin | revoked | no | — | — |
| rambleawaypod@gmail.com | admin | revoked | no | — | — |

→ The proposal's "5 rows" is raw count; **active admins = 1**. 3 of 5 admin emails have **no `profiles` row at all** (admin-only accounts, never onboarded the consumer app). So `admin_users` ⟂ `profiles.id` — they cannot be joined by id, only by email, and 3 don't join at all.

---

## 3. SEGMENTATION TRUTH RECONCILIATION (definitive derivation table)

All counts live (production), 2026-06-08. Total `profiles` = **38**.

| Field / source | Live value | Verdict |
|---|---|---|
| `profiles.account_type` | 35 null, 1 `admin`, 2 `business` | **Unusable as truth** — 92% null, free-text, no CHECK constraint, only writers are signup-metadata + the unconstrained admin Edit input. |
| `profiles.is_admin` | **0 true / 38 false**, `DEFAULT false` | **DEAD COLUMN.** Zero writers, zero readers in app code (only `.select('is_admin')` in the codebase is on `session_participants`, not `profiles` — `useSessionManagement.ts:808`). Baseline def `20260505…:9665`. |
| `profiles.is_seed` | **0 true / 38 false** | Currently a no-op filter. No seed users in `profiles`. `@mingla.app` email count = 0. |
| `admin_users` (active) | **1** (seth) | The real admin list. Email-keyed, NOT id-joinable to profiles (3/5 emails absent from profiles). |
| `brand_team_members` (accepted, active) | **13 distinct users** | The real business-user truth. All 13 are present in `profiles` (`btm_active_in_profiles=13`). Only 2 of 13 carry `account_type='business'` → **11 mislabeled**. (Raw `btm` = 48 rows, but distinct active users = 13.) |

### 3.1 Identity of the "business 13" (forensic note)
All 13 are Seth's own dev/test accounts (`sethogieva@gmail.com` owns 35 brands; the rest are `sethogieva+orch0954-*@usemingla.com` harness accounts from the ORCH-0954 test run). **There are effectively zero real third-party business users in production yet.** The segment is real as a *definition* but the population is synthetic. The SPEC should not over-engineer for scale.

### 3.2 CORRECT derived segment definitions
- **Admin** = email ∈ `admin_users WHERE status='active'`. (Recommend; matches the RLS gate already protecting the app.) Cannot be expressed as a `profiles` column predicate — must resolve emails → `profiles.id` via email join (and accept that admin-only accounts may have no profile row).
- **Business** = `EXISTS (SELECT 1 FROM brand_team_members btm WHERE btm.user_id = profiles.id AND btm.accepted_at IS NOT NULL AND btm.removed_at IS NULL)`. (13 users.)
- **Explorer** = NOT Admin AND NOT Business. (The residual; ~35-37 users depending on admin/business overlap with profiles.)
- **Seed exclusion:** `is_seed` is presently all-false, so excluding seed users changes nothing today. Keep the `is_seed=false` guard for forward-safety (a future seed run would set it), but it is NOT load-bearing for the current segment counts. Do not rely on it as a segment discriminator.

### 3.3 Why `account_type` is unpopulated (writer audit)
- **Signup writer:** `handle_new_user()` (live def) sets `account_type := NEW.raw_user_meta_data->>'account_type'`. This metadata key is essentially never passed (consumer + business signups don't set it) → NULL for 35/38.
- **Only other writer:** the admin Edit `<Input>` (`UserManagementPage:545,:1276`) — manual, free-text, used twice ever (the 2 `'business'` rows + seth's `'admin'`).
- **No app reader:** grep of `app-mobile/src`, `mingla-business/src`, `mingla-marketing` for `account_type` returns **zero** matches. The only readers are `admin_toggle_partner` (and its migration twins) + the admin page's own filter. So `account_type` drives **nothing user-facing**.

---

## 4. RECOMMENDED SOURCE OF TRUTH + BLAST RADIUS

### 4.1 Recommendation
- **Admin → `admin_users` (status='active').** Already the auth + RLS source of truth; adopting it for segmentation unifies the model. Convert `admin_toggle_partner`'s `profiles.account_type='admin'` check to `is_admin_user()` to close the gate divergence (§2.4) in the same cleanup.
- **Business → `brand_team_members` (accepted, not removed).** The only table that reflects real business membership.
- **`account_type`:** do NOT make it authoritative. Two options: (a) **retire it** (drop the column after migrating the admin/partner gate off it), or (b) **backfill it from a derived view** so the existing admin filter stops lying. Given there are no app readers, (a) is cleaner long-term; (b) is the lower-risk interim if the SPEC wants the existing `.or(account_type…)` filter to keep working without rewrite. Recommend a **`profiles_segment` SQL view / function** (`derive_user_segment(profile_id) → 'admin'|'business'|'explorer'`) as the single source the admin page reads, rather than trusting any stored column.
- **`profiles.is_admin`:** **retire it.** It is provably dead (§3, 0 writers/0 readers/0 true rows). Drop in the same migration. Zero blast radius (see below).

### 4.2 Blast radius — retiring `profiles.is_admin`
Grep across the monorepo: every `is_admin` reference resolves to **`session_participants.is_admin`** (board co-admin), NOT `profiles.is_admin`:
- `app-mobile`: `BoardSettingsDropdown.tsx`, `ParticipantAvatars.tsx`, `useBoardSession.ts`, `useSessionManagement.ts:808`, `boardSessionService.ts`, `MessageInterface.tsx` — all `session_participants`.
- Migrations: `is_admin` in collab/board functions (`20260629…`, `20260628…`) = `session_participants`. Baseline `:9115` = `session_participants.is_admin`; `:9665` = `profiles.is_admin` (the dead one).
**Blast radius of dropping `profiles.is_admin` ≈ zero** (only the column definition + nothing that reads it). The session_participants column is untouched and must NOT be confused with it.

### 4.3 Blast radius — changing/retiring `account_type`
Readers/writers that must be touched if `account_type` is retired or its meaning changes:
- `admin_toggle_partner` RPC (live) + migrations `20260822000000_orch_1052…:112,:434` + `20260823000000_orch_1054…:118` — all gate on `account_type='admin'`. **Must migrate to `is_admin_user()`.**
- `handle_new_user()` signup writer (harmless to leave, but the metadata path becomes vestigial).
- `mingla-admin/src/pages/UserManagementPage.jsx` — the `.or(account_type…)` filter (×6 query sites), the `Type` column (:925), the editable Input (:1276), the save mapping (:545). These rewrite to the derived-segment model.
- No consumer/business/marketing app reads → **no mobile OTA needed** for an `account_type` change. The blast is admin-page + a handful of RPCs only.

---

## 5. ADMIN SUPPORT DESK MOUNT POINT

### 5.1 Router (hash-based, `App.jsx`)
- `PAGES` map (`App.jsx:35-54`): `hash → component`. `getTabFromHash()` (:56-59) reads `window.location.hash`, falls back to `overview`.
- A new Support page registers by adding **one line** to `PAGES`, e.g. `support: SupportDeskPage,` + an import at the top (:11-25). Route becomes `#/support`. The page component receives `onTabChange` (:135) and is wrapped in `ErrorBoundary` + page transition automatically.

### 5.2 Sidebar / nav (`constants.js` → `Sidebar.jsx`)
- Nav is data-driven from `NAV_GROUPS` (`constants.js:122-154`) — a single flat group (post-ORCH-1008). Each item = `{ id, label, icon }`. `id` must match the `PAGES` key.
- Add `{ id: "support", label: "Support", icon: "MessageSquare" }` (or `LifeBuoy`/`Inbox`). **Icon must be registered in `Sidebar.jsx`'s `ICON_MAP` (:36-40)** — `MessageSquare`/`Inbox` patterns exist; a new icon (e.g. `LifeBuoy`) must be imported from `lucide-react` (:2-31) and added to `ICON_MAP`, or it silently falls back to `LayoutDashboard` (:77).
- `NAV_ITEMS` (:157) is auto-derived; `AppShell` title uses it — no extra wiring.

### 5.3 Page pattern to mirror
Best structural template for a Support desk that combines a list + detail + per-row drill-in: **`UserManagementPage.jsx`** (list/detail view-state machine, `DataTable`, `Tabs`, modals) and **`ClaimsPage.jsx`** (queue + review-bundle pattern, closest to a "support case queue"). For the admin-roster CRUD shape (invite/active/revoked sections), **`AdminPage.jsx`** is the model.

### 5.4 Auth note for the support desk
A Support page lands **inside the authed shell** (`App.jsx` only renders `AppShell`+pages when `session` is set, :117-139), so it inherits the same `is_admin_user()` RLS umbrella. If support staff need scoped (non-full-admin) access, that is a NEW role concept — neither `admin_users.role` (`owner`/`admin` only, per the setup SQL CHECK at `AdminPage.jsx:27`) nor any current gate supports a "support" sub-role today. Flag for the SPEC: introducing `support_staff` (per proposal Finding E1's naming) means a new gate function, not a reuse of `is_admin_user()`.

---

## 6. DATA-INTEGRITY RECONCILIATION PLAN (recommended, for the SPEC)

1. **Add `derive_user_segment(p_id uuid) → text`** (SECURITY DEFINER, STABLE): `admin` if email ∈ active `admin_users`; else `business` if active `brand_team_members` row; else `explorer`. Single source the admin page reads. Optionally expose a `profiles_with_segment` view for list/count queries (enables `.eq("segment", …)` ergonomics).
2. **Unify the admin gate:** rewrite `admin_toggle_partner` (and the 2 migration twins) to use `is_admin_user()` instead of `profiles.account_type='admin'`. Closes §2.4.
3. **Retire `profiles.is_admin`** — drop column (blast radius ≈ 0, §4.2). Add a strict-grep gate so it can't return.
4. **Retire OR backfill `account_type`:** prefer retire (no app readers). If kept for the interim filter, backfill from `derive_user_segment` and add a CHECK `IN ('explorer','business','admin')` so the free-text Edit input can't write garbage.
5. **Keep `is_seed=false` guard** but document it as forward-safety, not a current discriminator (0 seed rows today).
6. **Admin page segment UI** reads `derive_user_segment` / the view — never trusts a stored `profiles` column.

---

## 7. EVIDENCE INDEX (file:line + SQL)

- List/stats filter: `UserManagementPage.jsx:148,174-177,181,208-209`. Editable account_type: `:545,:1276`. Type column: `:925-930`. Detail fan-out: `:245-334`. Tabs: `:1140-1159`.
- Admin client = anon key: `mingla-admin/src/lib/supabase.js:3-24`. 2FA auth: `AuthContext.jsx:273-360`. Allowlist: `constants.js:5-7`; dynamic via `get_admin_emails` `:129`.
- Nav/router: `App.jsx:35-59,117-139`; `constants.js:122-157`; `Sidebar.jsx:36-40,77`. Admin roster page: `AdminPage.jsx` (setup SQL `:23-48`, role CHECK `:27`).
- RLS gates (live `pg_policy`): `profiles` "Admins can read all profiles" = `is_admin_user()`; "Admins can update all profiles" = `is_admin_user()` (baseline `:14044,:14056`).
- Function defs (live `pg_get_functiondef`): `is_admin_user` (admin_users.status='active' by auth email), `is_admin_email`, `get_admin_emails`, `check_invited_admin`, `handle_new_user` (account_type from raw_user_meta_data), `admin_toggle_partner` (gates on `profiles.account_type='admin'`).
- account_type writers: `handle_new_user` + `UserManagementPage.jsx:545,:1276`. account_type gate-readers: `admin_toggle_partner` + migrations `20260822000000_orch_1052_partner_identity_stripe.sql:112,:434`, `20260823000000_orch_1054_partner_splits.sql:118`. **No** app-mobile/business/marketing reader (grep empty).
- `profiles.is_admin`: baseline `:9665` `DEFAULT false`; 0 app readers/writers (every `is_admin` app hit is `session_participants`, e.g. `useSessionManagement.ts:808`).
- Live SQL counts (2026-06-08): account_type {null:35, admin:1, business:2}; is_admin {false:38}; is_seed {false:38, true:0}; admin_users {active:1, active|invited:1, total:5, revoked:4}; brand_team_members {distinct active users:13, all in profiles:13, also typed business:2, total rows:48}; account_type='business':2; profiles @mingla.app:0; no CHECK constraint on account_type (`pg_constraint` empty).
