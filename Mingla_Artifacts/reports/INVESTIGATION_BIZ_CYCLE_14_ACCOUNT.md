# INVESTIGATION — BIZ Cycle 14 (Account: edit profile, settings, delete-flow, sign out)

**Mode:** INVESTIGATE (no SPEC mode yet — surface architecture decisions for operator lock first)
**Date:** 2026-05-04
**Surface:** Mingla Business mobile app (`mingla-business/`) — Phase 5 opens
**Dispatch:** [`prompts/FORENSICS_BIZ_CYCLE_14_ACCOUNT.md`](../prompts/FORENSICS_BIZ_CYCLE_14_ACCOUNT.md)
**Canonical epic:** [`github/epics/cycle-14.md`](../github/epics/cycle-14.md) — 5 journeys (J-A1..J-A5), ~48h estimated
**Confidence:** **H** overall · H per thread except Thread 2 (M-H — TRANSITIONAL-heavy due to missing notification infrastructure)

---

## 1 — Plain-English summary (5 lines max)

PR #59 already shipped 80% of Cycle 14's schema: `creator_accounts.deleted_at` (soft-delete column), `account_deletion_requests` audit table (service-role-only writes), `marketing_opt_in` boolean — Cycle 14's UI just wires what already exists. Email is OAuth-locked (no email-OTP path; only Google + Apple), so D-14-1 collapses to "read-only via OAuth provider." Profile photo reuses existing `avatar_url` field. **Notification settings are infrastructure-blocked**: ZERO push deps installed (no `expo-notifications` / no `react-native-onesignal`); Cycle 14 ships TRANSITIONAL placeholder toggles only. Delete-account flow uses existing schema + a B-cycle-deferred `request-account-deletion` edge function for the audit-table write + cron. Recommend **single ~48h cycle** (no split needed; account tab is tightly coupled UX).

---

## 2 — Investigation manifest (every file read in trace order)

### 2.1 Anchor
| # | File | Reason |
|---|------|--------|
| 1 | [`Mingla_Artifacts/github/epics/cycle-14.md`](../github/epics/cycle-14.md) | Canonical scope — 5 journeys + Phase 5 + ~48h estimate + GDPR R4 reference |
| 2 | [`Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_14_ACCOUNT.md`](../prompts/FORENSICS_BIZ_CYCLE_14_ACCOUNT.md) | Dispatch — 5-thread structure + 17 operator decisions queued |

### 2.2 Mobile baseline
| # | File | Reason |
|---|------|--------|
| 3 | `mingla-business/app/(tabs)/account.tsx` | Cycle 0a + 1 baseline — sign-out + email + brand list + dev seeds; explicit "Cycle 14 lands real Account features" comment |
| 4 | `mingla-business/src/context/AuthContext.tsx` | Auth wrapper — Google + Apple sign-in flows, signOut, ensureCreatorAccount call chain |
| 5 | `mingla-business/src/services/creatorAccount.ts` | `ensureCreatorAccount(user)` upsert helper — derives display_name + avatar_url from OAuth metadata |
| 6 | `mingla-business/src/utils/clearAllStores.ts` | 10-store reset cascade — Const #6 logout-clears chokepoint |
| 7 | `mingla-business/package.json` | Verify push/email infrastructure presence (already verified Cycle 13: NO push deps; only `expo-image-picker` + `expo-apple-authentication` + Google Sign In) |

### 2.3 Schema — creator_accounts chain (migration order)
| # | File | Authority |
|---|------|-----------|
| 8 | `supabase/migrations/20260404000001_creator_accounts.sql` | Original `creator_accounts` table — id, email, display_name, avatar_url, business_name (6 cols) + 3 RLS policies (self-only SELECT/INSERT/UPDATE) + ON DELETE CASCADE from auth.users |
| 9 | `supabase/migrations/20260502100000_b1_business_schema_rls.sql` | **PR #59 — LATEST authority.** ADD `phone_e164`, `marketing_opt_in NOT NULL DEFAULT false`, `deleted_at`, `default_brand_id`. NEW `account_deletion_requests` table (id + user_id + requested_at + scheduled_hard_delete_at + status CHECK pending/cancelled/completed + reason + metadata jsonb). RLS: SELECT for own user only; service-role writes only. NEW anon SELECT policy on creator_accounts for organiser public profile lookups. |

### 2.4 Brand chain (cascade implications)
| # | File | Reason |
|---|------|--------|
| 10 | `mingla-business/src/store/brandTeamStore.ts` | I-31 TRANSITIONAL — Cycle 13a brand-team UI-only invitations (B-cycle EXIT to invite-brand-member edge fn) |
| 11 | `supabase/migrations/20260502100000_b1_business_schema_rls.sql` lines 86-140 | `brands.account_id ON DELETE CASCADE` + IMMUTABLE via `biz_prevent_brand_account_id_change` trigger — operator CANNOT transfer brand ownership at DB level; hard-delete cascades brands |

### 2.5 Existing delete pattern (consumer app — architectural model)
| # | File | Reason |
|---|------|--------|
| 12 | `supabase/functions/delete-user/index.ts` | Consumer app pattern (`profiles` + `collaboration_sessions` + `place_reviews`) — NOT business schema. Provides architectural model for B-cycle business `delete-user` (auth.admin.deleteUser → CASCADE through ~80 tables; pre-deletion anonymization batch; phone freeing). Confirms business-schema delete-account does NOT exist yet. |

### 2.6 Cycle 13 plumbing reusable
| # | File | Reason |
|---|------|--------|
| 13 | `mingla-business/src/utils/permissionGates.ts` | `canPerformAction(rank, action)` + `gateCaptionFor` reusable for permission gates if Cycle 14 needs any (likely none — account deletion is self-only) |
| 14 | `mingla-business/src/hooks/useCurrentBrandRole.ts` | rank chain for brand-context counts in cascade preview |

### 2.7 Static checks
| # | Probe | Result |
|---|-------|--------|
| 15 | grep `react-native-onesignal\|expo-notifications\|@notifee` in package.json | **0 hits** — NO push notification deps installed |
| 16 | glob `mingla-business/src/**/notification*` | **0 files** — NO existing notification client code |
| 17 | glob `supabase/functions/*account*\|*delete*` for business schema | Only consumer-app `delete-user` — confirms business-schema delete-account is B-cycle deferred per cycle-14.md notes |
| 18 | grep `email_otp\|signInWithOtp\|otpType` in mingla-business | **0 hits** — confirms email-OTP path NOT implemented; Google + Apple ONLY |

---

## 3 — Per-thread investigation

### 3.1 Thread 1 — J-A1 edit profile (name + photo) 🔵

#### 3.1.1 Five-truth-layer cross-check

| Layer | Finding |
|-------|---------|
| **Docs** | cycle-14.md J-A1: "Edit profile (name + photo)" — explicitly notes "email — through OAuth provider"; BUSINESS_PRD §1 anchors creator account model. |
| **Schema** | `creator_accounts` has `display_name` + `avatar_url` + `email` (the 3 fields J-A1 needs); RLS SELECT/UPDATE self-only (mobile can write directly). `phone_e164` exists but B1 future-use; `business_name` exists but unclear ownership. |
| **Code** | `creatorAccount.ensureCreatorAccount(user)` derives `display_name` from `user_metadata.full_name \|\| name \|\| email split`, `avatar_url` from `user_metadata.avatar_url \|\| picture`. Apple sign-in writes `display_name` from `credential.fullName` post-signup (AuthContext line 286-296). NO existing edit-profile UI. |
| **Runtime** | OAuth metadata flows on first sign-in; subsequent edits would need direct supabase mutate (RLS allows self-update). |
| **Data** | All operators have a `creator_accounts` row post-first-signin; rows have email + display_name + avatar_url populated from OAuth claims. |

#### 3.1.2 Architectural options

| Decision | Option A | Option B | Option C | Recommend |
|----------|----------|----------|----------|-----------|
| **D-14-1 Email editability** | Read-only via OAuth | Editable with re-verification | Hybrid (OAuth-locked for Google/Apple; editable for email-OTP) | **A** — no email-OTP path exists; OAuth IDs are immutable; surface email as `Signed in via Google/Apple` badge with "Change email by switching providers" link to docs (or simply not-editable copy) |
| **D-14-2 Profile photo storage** | NEW `profile_photos` bucket | Reuse `brand_covers` bucket with separate path prefix | LOCAL-only TRANSITIONAL Zustand (defer storage to B-cycle) | **B** — `brand_covers` bucket likely exists (Cycle 7 brand cover); add `profiles/{userId}.{ext}` path prefix; reuse existing `expo-image-picker` flow + Supabase Storage RLS policy. **Note:** implementor verifies `brand_covers` bucket exists + adds path-prefix RLS during SPEC §4 |
| **D-14-3 Persistence layer** | New `userProfileStore` (Zustand persist) | Direct React Query mutation against `creator_accounts` | TRANSITIONAL hybrid | **B** — Cycle 13a established React Query pattern (`useCurrentBrandRole`); `creator_accounts` UPDATE RLS allows self-write directly; mutate via Supabase client + invalidate `creator-account` query key on success. NO new Zustand store. |

**Decision recommendations confidence:** H (D-14-1 + D-14-3) · M-H (D-14-2 — needs `brand_covers` bucket existence verification).

**Blast radius:**
- 1 NEW route: `app/account/edit-profile.tsx` (~250-350 LOC — name input + photo picker + save CTA)
- 1 NEW hook: `src/hooks/useCreatorAccount.ts` (~80 LOC — query key factory + read + update mutation)
- 1 MOD: `app/(tabs)/account.tsx` (add "Edit profile" row that routes to /account/edit-profile)
- 0 NEW migrations (schema already complete)
- 0 mutations to existing stores

### 3.2 Thread 2 — J-A2 notification settings 🟡

#### 3.2.1 Five-truth-layer cross-check

| Layer | Finding |
|-------|---------|
| **Docs** | cycle-14.md J-A2: "Notification settings (push / email toggles per category)" — minimal scope guidance |
| **Schema** | `creator_accounts.marketing_opt_in` boolean DEFAULT false (B1 — only existing notification flag). NO `user_notification_prefs` table; NO per-category prefs schema. |
| **Code** | NO push notification client code (0 files match `notification*`); `notifyEventChanged` in liveEventStore is console-stub per Cycle 9c-2 history. |
| **Runtime** | Email delivery deferred to B-cycle Resend per Cycle 9b-1 explicit toast copy ("Buyers will be refunded when emails wire up"). Push never wired. |
| **Data** | `marketing_opt_in` is the only persisted notification preference; defaults false (GDPR-favored opt-out). |

#### 3.2.2 Architectural options

| Decision | Option A | Option B | Option C | Recommend |
|----------|----------|----------|----------|-----------|
| **D-14-4 Notification categories** | Tight 4 (Order activity / Scanner activity / Brand team / Marketing) | Wide 7 (above + Event-day reminder + Weekly digest + Security/Account) | Just 1 (Marketing — match existing `marketing_opt_in`) | **A** (4 categories) — surfaces real B-cycle channels operator will care about; Wide 7 adds categories operator hasn't validated; just-1 is too thin for a "settings cluster" UX |
| **D-14-5 Push infrastructure status** | Ship with TRANSITIONAL toggles only (no real delivery) | Wire OneSignal SDK + user_notification_prefs table NOW | Defer notification settings entirely to B-cycle | **A** — TRANSITIONAL toggles ship in Zustand-persisted store with explicit "delivery wires up in B-cycle" caption; B (wire OneSignal now) requires `eas build` + new dep + edge fn + RLS work that's out-of-scope per cycle-14.md ~48h budget |
| **D-14-6 Default opt-in vs opt-out** | All ON (transactional + marketing) | Transactional ON; Marketing OFF (GDPR-favored) | All OFF | **B** — GDPR best practice: transactional categories (orders/scanner/team) defaults ON since user expects them after sign-up; marketing defaults OFF (matches existing `marketing_opt_in DEFAULT false`) |
| **D-14-7 Persistence layer** | Zustand `useNotificationPrefsStore` (persisted, TRANSITIONAL) | Direct Supabase mutation now | Hybrid | **A** — Zustand persisted-store TRANSITIONAL until B-cycle ships `user_notification_prefs` table + edge fn; sync to existing `creator_accounts.marketing_opt_in` for the marketing toggle ONLY (use existing schema column where possible) |

**Decision recommendations confidence:** M-H — TRANSITIONAL architecture is the right call given infrastructure gap, but operator may push back on "ship UI without delivery" UX honesty.

**Blast radius:**
- 1 NEW route: `app/account/notifications.tsx` (~200-280 LOC — 4 toggle rows + TRANSITIONAL banner)
- 1 NEW store: `src/store/notificationPrefsStore.ts` (~80 LOC persisted Zustand with 4-toggle shape)
- 1 MOD: `creatorAccount.ts` to sync `marketing_opt_in` toggle on UPDATE
- 1 MOD: `clearAllStores.ts` to add `useNotificationPrefsStore.reset` in cascade
- 1 MOD: `app/(tabs)/account.tsx` (add "Notifications" row)
- 0 NEW migrations
- 0 NEW deps

### 3.3 Thread 3 — J-A3 + J-A5 security + sign-out cluster 🔵

#### 3.3.1 Five-truth-layer cross-check

| Layer | Finding |
|-------|---------|
| **Docs** | cycle-14.md J-A3 ("Security: sign out everywhere; delete account") + J-A5 ("Sign out — single device") |
| **Schema** | N/A — Supabase Auth manages sessions internally |
| **Code** | `AuthContext.signOut` calls `supabase.auth.signOut()` with NO scope arg. **Critical: Supabase JS v2.39+ defaults `signOut()` to `{ scope: 'global' }`.** mingla-business uses `@supabase/supabase-js@^2.74.0` per package.json — meaning the existing button is ALREADY "sign out everywhere" by default. |
| **Runtime** | onAuthStateChange listener defensively fires `clearAllStores()` on `SIGNED_OUT` event (line 103-107) — covers both button-driven and server-side-revoked sign-outs. |
| **Data** | Sessions tracked in `auth.refresh_tokens` (Supabase-managed); no client-side session list available without backend RPC. |

#### 3.3.2 Architectural options

| Decision | Option A | Option B | Option C | Recommend |
|----------|----------|----------|----------|-----------|
| **D-14-8 Sign-out-everywhere** | Add separate "Sign out from this device" button (defaults stays "everywhere") | Keep single "Sign out" button (already global default; rename to "Sign out everywhere"); no separate single-device | Add explicit "Sign out everywhere" CTA + leave existing single-device behavior unchanged (requires explicit `{ scope: 'local' }` arg to existing button) | **B** — security-favored default; renames existing button to "Sign out everywhere" with clarifying caption "Signs you out on every device". Single-device sign-out is a power-user feature most operators don't need; defer if surfaced. (Alternative C is fine if operator wants both.) |
| **D-14-9 Active sessions list** | Ship | Omit (just trust the global flag) | TRANSITIONAL B-cycle | **B** — Supabase Auth doesn't expose session list to mobile by default; would require backend RPC + new edge fn. Skip; "Sign out everywhere" without a list is the industry-standard simple UX (mirrors Stripe Connect, Apple ID, etc.) |

**Decision recommendations confidence:** H — Supabase v2 default scope is well-documented; sign-out-everywhere is one rename + one caption update.

**Blast radius:**
- 0 NEW files
- 1 MOD: `app/(tabs)/account.tsx` (rename "Sign out" button label + add caption)
- 0 MOD: `AuthContext.signOut` body unchanged (already global by default)
- 0 NEW deps

**Verification step (mandatory in SPEC §4):** Implementor must verify Supabase v2.74 default scope is global (read `node_modules/@supabase/auth-js/src/GoTrueClient.ts` `signOut` default arg) before relying on this.

### 3.4 Thread 4 — J-A4 delete-account 4-step flow + cascade preview 🟢

#### 3.4.1 Five-truth-layer cross-check

| Layer | Finding |
|-------|---------|
| **Docs** | cycle-14.md J-A4: "4-step flow (warn → list cascading effects → type to confirm → soft-delete + audit)" + Notes: "30-day soft-delete; cascade edge function lands B1/B2." Strategic Plan R4 mandates GDPR completeness. |
| **Schema** | **CRITICAL — already shipped:** `creator_accounts.deleted_at` (timestamptz, nullable; UPDATE RLS allows self-write) + `account_deletion_requests` table (id + user_id + requested_at + scheduled_hard_delete_at + status CHECK pending/cancelled/completed + reason + metadata jsonb; service-role-only writes per RLS). `brands.account_id ON DELETE CASCADE` (hard-delete cascades brands; soft-delete leaves brands alive). `brands.account_id` IMMUTABLE via `biz_prevent_brand_account_id_change` trigger (no ownership transfer at DB level). |
| **Code** | NO existing business-schema delete-account flow. Consumer app `delete-user` edge function exists as architectural model (auth.admin.deleteUser + CASCADE + pre-deletion anonymization batch). |
| **Runtime** | Mobile UPDATE on `creator_accounts.deleted_at` works today via existing self-write RLS — proven path. `account_deletion_requests` insert requires service-role (B-cycle edge fn). |
| **Data** | All 4 source stores (orderStore + doorSalesStore + guestStore + scanStore) + brand-team store + currentBrandStore are local Zustand — perfect for client-side cascade preview aggregation. |

#### 3.4.2 Architectural options

| Decision | Option A | Option B | Option C | Recommend |
|----------|----------|----------|----------|-----------|
| **D-14-10 Cascade preview scope** | Tight (Brands + Events count + Orders count + 30-day window copy) | Full (Brands + Events + Orders + Comps + Scanner invites + Audit log entries — itemized with totals) | Custom prose ("All your brands, events, and ticket data") | **B** — itemized counts honor GDPR data-subject right-to-know + Const #9 no-fabricated-data; aggregator pure read over already-shipping stores; matches Cycle 13 reconciliation pattern (raw entries + useMemo per Cycle 9c v2 selector rule). |
| **D-14-11 Type-to-confirm string** | Account email | Literal "DELETE" | Both (email AND "DELETE") | **A** — account email is industry standard (Stripe / GitHub / Vercel); harder to typo-confirm than literal string; matches user mental model ("I'm deleting my account") |
| **D-14-12 Soft-delete marker** | NEW client-side migration | Use existing `creator_accounts.deleted_at` | Pure Zustand TRANSITIONAL | **B (FORCED)** — schema already has `deleted_at`. Cycle 14 just calls `UPDATE creator_accounts SET deleted_at = now() WHERE id = auth.uid()` via existing RLS. Decision was a non-question once schema verified. |
| **D-14-13 Recovery window** | 30 days per cycle-14.md | 14 days | 60 days | **A** — confirms cycle-14.md default; matches industry standard (Apple ID, Google Account, Stripe). 14 days too short for accidental deletion recovery; 60 too long for data-deletion compliance posture. |
| **D-14-14 Active events check** | Block deletion until all events end/cancel | Warn loudly + allow proceed | Force "transfer ownership first" flow | **B** — block-deletion is paternalistic + GDPR-tense (right-to-erasure should not be blocked by user-owned data); force-transfer is impossible at DB level (`brands.account_id` IMMUTABLE per trigger). Warn loudly with cascade preview itemized counts: "You have 3 brands with 12 live events totaling £8,247 in sold tickets. All will be soft-deleted with you. Recover within 30 days." |

**D-14-12 reshape:** original dispatch asked about "client-side migration NOW vs B-cycle" — but PR #59 ALREADY shipped `deleted_at`. Question collapsed to "use existing column" (Option B), no operator decision needed. Same logic for D-14-15 (audit log writers — `account_deletion_requests` is already the audit table; just service-role-only writes from B-cycle edge fn).

**4-step flow (recommended UX):**
1. **Warn** — single-screen full-bleed warning. Copy: "Delete your Mingla Business account? This will soft-delete all your brands, events, orders, and team data. You have 30 days to recover before everything is permanently erased."
2. **Cascade preview** — itemized counts pulled from local stores (raw entries + useMemo): "You have:" + bulleted list (`{N} brands` · `{N} live events` · `{N} sold orders worth £{X}` · `{N} comp guests` · `{N} scanner invitations` · `{N} team invitations`). Active-events warning if `liveEventStore.entries.filter(e => deriveLiveStatus(e) === "live" \|\| "upcoming").length > 0`.
3. **Type-to-confirm** — TextInput labeled "Type your email to confirm" + matches `user.email` exactly to enable Confirm button.
4. **Soft-delete + audit** — calls UPDATE `creator_accounts.deleted_at = now()` (mobile-side) + auto-fires `signOut()` + clearAllStores() + navigates to BusinessWelcomeScreen with confirmation toast: "Account scheduled for deletion. Recover within 30 days by signing in again." (B-cycle TRANSITIONAL note: `account_deletion_requests` row gets inserted by B-cycle edge fn picking up `deleted_at` flag; for now mobile only writes the marker.)

**Architectural option for sign-in-during-recovery:** if user signs in within 30 days, AuthContext sees `creator_accounts.deleted_at != null` and EITHER (a) auto-clears the marker on bootstrap (recover) OR (b) shows "Your account is scheduled for deletion. [Recover] [Stay deleted]" dialog. Recommend (a) auto-clear with visible "Welcome back — your account has been recovered" toast (operator-friendly UX). Document for SPEC writer.

**Decision recommendations confidence:** H — schema 100% verified; UX 4-step matches industry standard.

**Blast radius:**
- 1 NEW route: `app/account/delete.tsx` (~500-700 LOC — 4-step Sheet/Modal sequence + cascade preview aggregator + type-to-confirm validator)
- 1 NEW utility: `src/utils/accountDeletionPreview.ts` (~120 LOC — pure aggregator pattern matching Cycle 13 `reconciliation.ts`; reads brands + events + orders + door sales + comps + scans for current account_id)
- 1 NEW hook: `src/hooks/useAccountDeletion.ts` (~60 LOC — React Query mutation for `creator_accounts.deleted_at` UPDATE + invalidate; recovery on bootstrap if `deleted_at != null`)
- 1 MOD: `AuthContext.tsx` — bootstrap behavior to recover account if user signs in with `deleted_at` set (per recommendation above)
- 1 MOD: `app/(tabs)/account.tsx` — add "Delete account" entry routing to `/account/delete` (gated to authenticated user; no permission rank gate — self-action)
- 0 NEW migrations
- 0 NEW edge functions (B-cycle ships `request-account-deletion` for `account_deletion_requests` audit insert + cron-job-30d to fire hard-delete)

### 3.5 Thread 5 — Cross-cutting concerns 🟢

#### 3.5.1 Multi-brand cascade implications

For account_owners of multiple brands, soft-delete preserves all brands intact during the 30-day window (brands.deleted_at stays null; brands.account_id still points to the soft-deleted account). If hard-delete fires day 31, `brands.account_id ON DELETE CASCADE` from auth.users delete cascades brands automatically. For brands the user is admin-of-not-owner-of, only their `brand_team_members` row is affected (CASCADE on user_id deletion).

**Recommendation:** cascade preview itemizes brands the user OWNS (via brands joined on account_id) AND brands the user is a team-member-of (via brand_team_members). The Warning: "You'll lose access to N brands you're a team member of. The brand owners will be notified." (B-cycle wires the notification; Cycle 14 just shows the count.)

#### 3.5.2 Auth provider variant matrix

| Provider | Email change | Photo change | Delete-account quirks |
|----------|--------------|--------------|----------------------|
| Google Sign In | OAuth-locked to Google account | Editable in Mingla (writes `creator_accounts.avatar_url`) | Standard cascade. User can re-create account by signing in again — `ensureCreatorAccount` upsert handles re-init. |
| Apple Sign In | OAuth-locked. **Apple privacy-relay email forwarding may break post-deletion** — if user used "Hide My Email", deleting Mingla account does NOT free the relay; user must revoke at appleid.apple.com. | Editable | Standard cascade. Document the privacy-relay quirk in SPEC §4.4 + UI copy: "If you used Apple's Hide My Email, you may also need to remove Mingla from appleid.apple.com." |
| Email-OTP | NOT IMPLEMENTED in mingla-business (per probe #18) | N/A | N/A |

#### 3.5.3 Audit log integration (D-14-15)

`account_deletion_requests` is a separate audit table from Cycle 13b's `audit_log`. The `audit_log` brand-admin SELECT policy (Cycle 13b RLS) is for team-management actions; `account_deletion_requests` is for account-lifecycle. Cycle 14 doesn't write to `audit_log` for account events.

**Recommendation:** **DEFER all audit_log writers entirely to B-cycle** (matches D-14-11 lock from Cycle 13). Cycle 14 only writes `creator_accounts.deleted_at` from mobile; B-cycle edge fn writes `account_deletion_requests` row + cron handles hard-delete + populates `audit_log` if needed.

#### 3.5.4 Account-owner brand-orphan policy (D-14-16)

**Brands.account_id is IMMUTABLE per DB trigger** — no ownership transfer possible at DB level. So Option A (force-transfer-first) from dispatch is unrealizable without a migration. Option B (soft-orphan with B-cycle takeover) and Option C (block deletion) remain.

**Recommendation:** **Option B (soft-orphan)** — soft-delete leaves brands intact for 30-day recovery window. If hard-delete fires day 31, `account_id ON DELETE CASCADE` cascades brands. If operator re-signs-in within 30 days, brands recover automatically. Loud warn with itemized cascade preview honors GDPR data-subject right-to-know without paternalism.

#### 3.5.5 account.tsx baseline preservation (D-14-17)

Existing baseline: TopBar (brand chip → switcher) + email display + sign-out + brand list + dev seeds (gated `__DEV__`).

**Recommendation:** **PRESERVE** — Cycle 14 ADDS sections rather than rewrites:
- Existing email display + brand chip + brand list stay
- ADD "Edit profile" row routing to `/account/edit-profile`
- ADD "Notifications" row routing to `/account/notifications`
- RENAME "Sign out" → "Sign out everywhere" (D-14-8) with clarifying caption
- ADD "Delete account" row (red text/destructive variant) routing to `/account/delete`
- KEEP dev seed/wipe controls (TRANSITIONAL, gated `__DEV__` per existing pattern)

This makes `account.tsx` the central hub; sub-routes handle the 4 substantive flows.

---

## 4 — Auth provider variant matrix (consolidated per §3.5.2)

See §3.5.2 above. SPEC writer must include the Apple privacy-relay quirk in UI copy + delete-flow Step 1 warning copy.

---

## 5 — GDPR compliance summary

**What Cycle 14 ships:**
- Soft-delete UI flow (4-step) writes `creator_accounts.deleted_at`
- Cascade preview itemizes data-subject-affected entities
- Type-to-confirm with account email (industry standard data-erasure pattern)
- 30-day recovery window with auto-recovery on sign-in
- Honest TRANSITIONAL labeling for B-cycle-deferred audit + cron

**What B-cycle ships (cycle-14.md notes):**
- `request-account-deletion` edge function (writes `account_deletion_requests` row + sets `scheduled_hard_delete_at`)
- Cron job: after 30 days, status = 'completed' + auth.admin.deleteUser → CASCADE through ~80 tables (mirrors consumer app `delete-user` pattern)
- Resend email: "Your account has been deleted. Recover within 30 days at..."
- Audit log writers if operator-events need audit trail beyond `account_deletion_requests`

**GDPR posture:** Cycle 14 honestly documents what's deferred. Operator can answer GDPR data-subject erasure requests today via the soft-delete flow + manual support intervention to fire hard-delete; B-cycle automates the 30-day cron.

---

## 6 — Decomposition recommendation

**Recommend SINGLE Cycle 14 (~48h)** matching epic budget exactly. Rationale:

1. **Tight UX coupling** — all 5 journeys live inside the Account tab; user never crosses between cycles
2. **Single hub-and-spoke nav pattern** — `account.tsx` hub + 4 sub-routes (`edit-profile`, `notifications`, `delete`); splitting 14a/14b breaks the mental model
3. **Cascade preview aggregator** is small (Cycle 13 `reconciliation.ts` ~340 LOC; this aggregator ~120 LOC)
4. **Schema 100% ready** — no schema work in either half; pure UI cycle
5. **Wall budget exact match** — epic says ~48h; estimated breakdown ~12h profile + ~10h notifications + ~6h sign-out cluster + ~16h delete-flow + ~4h hub-and-spoke nav + ~+QA = 48h. Splitting saves no wall.

**Alternative (if operator pushes back):** split into 14a (profile + notifications + sign-out cluster ~28h) and 14b (delete-flow ~20h) IF operator wants to ship 14a quickly to validate UI hub + come back to 14b later. SPEC writer follows operator's lead at decision-lock-in.

---

## 7 — Operator decisions queued (lock before SPEC dispatch)

| # | Decision | Recommendation | Confidence |
|---|----------|----------------|-----------|
| **D-14-1** | Email editability | A — Read-only via OAuth provider | H |
| **D-14-2** | Profile photo storage | B — Reuse `brand_covers` bucket with `profiles/` path prefix (verify bucket exists at SPEC §4) | M-H |
| **D-14-3** | Profile persistence layer | B — Direct React Query mutation against `creator_accounts` | H |
| **D-14-4** | Notification categories | A — Tight 4 (Order activity / Scanner activity / Brand team / Marketing) | M-H |
| **D-14-5** | Push infrastructure status | A — Ship TRANSITIONAL toggles only; B-cycle wires real delivery | H |
| **D-14-6** | Default opt-in vs opt-out | B — Transactional ON; Marketing OFF (GDPR-favored; matches existing schema default) | H |
| **D-14-7** | Notification persistence layer | A — Zustand `useNotificationPrefsStore` (TRANSITIONAL); sync `marketing_opt_in` to `creator_accounts` | H |
| **D-14-8** | Sign-out-everywhere | B — Rename existing button to "Sign out everywhere" (already global default in Supabase v2.39+); add clarifying caption | H |
| **D-14-9** | Active sessions list | B — Omit; Supabase Auth doesn't expose without backend RPC | H |
| **D-14-10** | Cascade preview scope | B — Itemized full counts (Brands + Events + Orders + Comps + Scanner invites + Team invites) | H |
| **D-14-11** | Type-to-confirm string | A — Account email | H |
| **D-14-12** | Soft-delete marker | **B (FORCED)** — Use existing `creator_accounts.deleted_at` (already shipped PR #59) | H |
| **D-14-13** | Recovery window | A — 30 days per cycle-14.md | H |
| **D-14-14** | Active events check | B — Warn loudly with itemized cascade preview; do NOT block | H |
| **D-14-15** | Audit log writers for account events | DEFER — `account_deletion_requests` audit is B-cycle service-role write; Cycle 14 just writes `deleted_at` flag | H |
| **D-14-16** | Account-owner brand-orphan | B (soft-orphan; brands stay alive 30 days; CASCADE handles hard-delete) — NOT A (force-transfer impossible per immutable trigger) | H |
| **D-14-17** | account.tsx baseline | A — PRESERVE existing structure; ADD 3 new rows (Edit profile / Notifications / Delete account) + RENAME sign-out button | H |

**Decisions resolved by schema findings (no operator input needed):**
- D-14-12 — schema already has `deleted_at` column
- D-14-15 — `account_deletion_requests` audit table already shipped with service-role-only writes
- D-14-16 — brands.account_id IMMUTABLE per trigger forces Option B

**Decisions remaining for operator:** 14 of 17 (D-14-1/2/3/4/5/6/7/8/9/10/11/13/14/17).

---

## 8 — Confidence levels

| Thread | Confidence | Reasoning |
|--------|-----------|-----------|
| Thread 1 (J-A1 edit profile) | **H** | Schema crystal clear (display_name + avatar_url + email already exist); UPDATE RLS allows self-write; existing image-picker reusable; only Supabase Storage bucket verification needed at SPEC §4 |
| Thread 2 (J-A2 notification settings) | **M-H** | Push infrastructure missing forces TRANSITIONAL-heavy ship; operator may want to wire OneSignal SDK now (Option B alternative) — H confidence on "ship TRANSITIONAL only" recommendation |
| Thread 3 (J-A3+J-A5 sign-out) | **H** | Supabase v2.39+ default scope is global; existing button is already "everywhere"; rename + caption only. Implementor verification step at SPEC §4. |
| Thread 4 (J-A4 delete-account) | **H** | Schema 100% ready (`creator_accounts.deleted_at` + `account_deletion_requests` both shipped); existing consumer app pattern provides architectural model; UX 4-step matches industry standard |
| Thread 5 (cross-cutting) | **H** | Multi-brand cascade clear via FK chain; auth provider variant matrix complete; Apple privacy-relay quirk documented; account.tsx baseline preservation pattern straightforward |
| **Overall** | **H** | All architecture decisions reversible (no schema migrations); store-agnostic data layer means B-cycle backend swap is mechanical (TRANSITIONAL marker + EXIT condition documented per existing pattern); largest risk is D-14-5 push infrastructure (operator may push back on TRANSITIONAL-only ship) |

---

## 9 — Forensics discoveries (D-CYCLE14-FOR-N)

### D-CYCLE14-FOR-1 (S2 obs) — Existing `delete-user` edge function is consumer-app-only

**Issue:** `supabase/functions/delete-user/index.ts` exists and is well-architected (auth.admin.deleteUser + CASCADE + pre-deletion anonymization batch + phone freeing + session ownership transfer) but operates on consumer-app schema (`profiles` + `collaboration_sessions` + `place_reviews`). NO equivalent business-schema delete-account edge function exists.

**Cycle 14 implication:** confirms B-cycle deferral per cycle-14.md notes. Architectural model proven viable; B-cycle just needs to swap consumer-app schema for business-schema (creator_accounts + brands + events + orders + door_sales + comps + scans + team + invitations).

**Recommendation:** at B-cycle SPEC time, fork `supabase/functions/delete-user/index.ts` → `delete-creator-account/index.ts` with business-schema cascade. Reuse the pre-deletion anonymization batch pattern. Document for B-cycle backlog.

### D-CYCLE14-FOR-2 (S3 obs) — `creator_accounts.business_name` field unused

**Issue:** original `20260404000001_creator_accounts.sql` migration includes `business_name text` column. NO mobile code reads or writes it (verified by grep). NO obvious B-cycle plan documents its purpose.

**Cycle 14 implication:** Cycle 14's edit-profile flow MAY surface a "Business name" field. Operator decision needed: surface in UI now (D-14-1 follow-up) or defer until purpose clarified.

**Recommendation:** **DEFER** — surface in B-cycle when operator validates the use case. Cycle 14's edit-profile UI scopes to display_name + avatar_url + email (read-only).

### D-CYCLE14-FOR-3 (S3 obs) — `creator_accounts.phone_e164` unused in client

**Issue:** PR #59 added `phone_e164` for "B1 organiser contact" purposes. NO mobile read/write; NO B-cycle wiring documented yet.

**Cycle 14 implication:** Cycle 14's edit-profile MAY surface phone field. Same answer as FOR-2 — defer until B1 operator-contact use case validates.

**Recommendation:** **DEFER**.

### D-CYCLE14-FOR-4 (S3 obs) — `brands.account_id` IMMUTABLE limits future ownership-transfer features

**Issue:** `biz_prevent_brand_account_id_change` trigger blocks brand ownership transfer at DB level. Cycle 14 doesn't need transfer (D-14-16 recommends soft-orphan), but this constraint may come back when operator surfaces a "transfer brand to co-founder" use case.

**Cycle 14 implication:** none today. Future cycle (Cycle 15+ or B-cycle) addressing brand-team founder-transfer would need a migration to drop or relax the trigger.

**Recommendation:** Document constraint for future-cycle awareness. NOT a Cycle 14 blocker.

### D-CYCLE14-FOR-5 (S3 obs — note for SPEC writer) — `/ui-ux-pro-max` pre-flight required for J-A1 + J-A4

Per `feedback_implementor_uses_ui_ux_pro_max` memory rule, the J-A1 edit-profile and J-A4 delete-account routes are substantive new visible UI surfaces. SPEC writer must instruct implementor to run `/ui-ux-pro-max` pre-flight before component code on both routes (separate queries OR combined). Existing kit primitives (GlassCard / Pill / IconChrome / EmptyState / Sheet / Toast / Button) cover the ground; pre-flight will surface dark-mode + glassmorphism guidance per Cycle 12/13 precedent.

### D-CYCLE14-FOR-6 (S3 obs) — Recovery-on-sign-in flow needs explicit UX call

**Issue:** if user soft-deletes their account then signs in within 30 days, AuthContext sees `creator_accounts.deleted_at != null`. Two UX options:
- (a) Auto-clear marker + show "Welcome back — your account has been recovered" toast (recommended)
- (b) Show modal "Your account is scheduled for deletion. [Recover] [Stay deleted]" — user explicitly chooses

**Cycle 14 implication:** SPEC must lock the choice. Recommend (a) auto-clear since the user signing in IS the recovery action; explicit modal adds friction without security benefit. (B-cycle hard-delete cron checks `deleted_at` against 30-day window before firing — auto-clear before that window stops the cron.)

**Recommendation:** lock (a) at SPEC dispatch time. Operator may flip to (b) if security review demands explicit confirmation.

---

## 10 — Cross-references

- Canonical epic: [`Mingla_Artifacts/github/epics/cycle-14.md`](../github/epics/cycle-14.md)
- Dispatch: [`prompts/FORENSICS_BIZ_CYCLE_14_ACCOUNT.md`](../prompts/FORENSICS_BIZ_CYCLE_14_ACCOUNT.md)
- Cycle 13 close (Phase 4 feature-complete; Phase 5 opens): [`reports/IMPLEMENTATION_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION_REPORT.md`](IMPLEMENTATION_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION_REPORT.md)
- Cycle 13a (rank-gating + permission plumbing reusable): [`reports/IMPLEMENTATION_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS_REPORT.md`](IMPLEMENTATION_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS_REPORT.md)
- Cycle 13b (audit_log RLS — informs delete-event audit semantics): [`reports/IMPLEMENTATION_BIZ_CYCLE_13B_PERMISSIONS_DEPTH_REPORT.md`](IMPLEMENTATION_BIZ_CYCLE_13B_PERMISSIONS_DEPTH_REPORT.md)
- Existing baseline: `mingla-business/app/(tabs)/account.tsx` (Cycle 0a + 1)
- AuthContext: `mingla-business/src/context/AuthContext.tsx` (Cycle 6 + Cycle 0b)
- Logout cascade: `mingla-business/src/utils/clearAllStores.ts` (10 stores)
- Supabase Storage bucket pattern: Cycle 7 brand cover (verify `brand_covers` bucket existence at SPEC §4)
- Consumer app delete-user architectural model: `supabase/functions/delete-user/index.ts`
- creator_accounts schema chain: `supabase/migrations/20260404000001_creator_accounts.sql` (origin) + `supabase/migrations/20260502100000_b1_business_schema_rls.sql` lines 38-78 (PR #59 latest authority)
- BUSINESS_PRD §1 — account model + auth requirements
- Strategic Plan R4 — account-deletion GDPR critical-path
- Memory rules honored: `reference_cycle_roadmap_authoritative_source` · `feedback_forensic_thoroughness` · `feedback_orchestrator_never_executes` · `feedback_no_summary_paragraph` · `feedback_diagnose_first_workflow` · `feedback_implementor_uses_ui_ux_pro_max` (flagged §9 D-CYCLE14-FOR-5 for SPEC handoff) · `feedback_anon_buyer_routes` (account surface is operator-only; I-21)
