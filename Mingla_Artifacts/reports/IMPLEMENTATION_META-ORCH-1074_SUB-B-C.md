# IMPLEMENTATION — META-ORCH-1074 Sub-B (receive path) + Sub-C (in-app inbox)

**Date:** 2026-06-04
**Skill:** mingla-implementor+claude
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1074-[business-notifications]/` on branch `META-ORCH-1074-client`
**Specs built to:** `SPEC_META-ORCH-1074_BUSINESS_NOTIFICATIONS.md` §4 (Sub-B) + §5 (Sub-C); `SPEC_META-ORCH-1074_SUB-C_DESIGN.md`; `SPEC_META-ORCH-1074_SUB-D_COPY_AND_PREFS.md`
**Scope:** client-only (`mingla-business/`). No edge-function / DB / migration work (Sub-A backend already merged, PR #354).
**Status:** implemented & verified (tests green + fails-on-revert; tsc clean on touched files; lint clean; gates green). Live push delivery + on-device tap routing are `implemented, unverified` — require a dev build + business OneSignal creds (Q1), out of this client pass.

**Comms-ledger acks (entry):** COMMS-0019 (FYI — addressed to `meta-orch-1072-paystack-nigeria`, not this ORCH; read, no action). COMMS-0002 N/A (no `supabase/functions/` or `supabase/migrations/` files touched → ORCH-0863 C7 not triggered; verified below). COMMS-0003 factored — OneSignal opt-in/permission docs URLs cited inline in `oneSignalService.ts` headers. No BLOCK/WARN row targets this ORCH or `mingla-implementor`.

---

## 0. Cross-Surface Impact (Step 3.5)

| Surface | Affected | What changes | Parity |
|---|---|---|---|
| Consumer iOS/Android (`app-mobile/`) | NO | Untouched; `business.%`/`stripe.%` already excluded from consumer feed | n/a |
| Buyer/anon Web | NO | Separate email/SMS path; untouched | n/a |
| Business iOS | YES | Push opt-in + foreground banner + tap routing (Sub-B); bell→inbox + unread + 4-family cards + per-type prefs (Sub-C) | manual vs Android (same RN code path; no platform `.tsx` splits added) |
| Business Android | YES | Same as iOS + Android-13 `POST_NOTIFICATIONS` runtime prompt at the value moment | manual — same code path; opaque-glass clip applied |
| Admin Web | NO | No notification surface | n/a |
| Business Web preview | YES (inbox only) | Bell→inbox route + unread + mark-read render/work from DB; OneSignal is a guarded no-op (no push) | manual — Web variant = inbox-only |

Parity is **automatic** (single shared RN code path) across iOS/Android/Web for the inbox + settings; the only platform branches are `Platform.OS === "web"` guards (close vs back icon, no native push) and the Android opaque-glass clip (`overflow:'hidden'` + zero elevation, already baked).

---

## 1. Files changed (Old → New receipts)

### NEW `mingla-business/src/constants/businessNotificationTemplates.ts`
**Before:** did not exist.
**Now:** Sub-D template data: `BUSINESS_NOTIFICATION_TEMPLATES` (the 11 v1 types, `new_follower` dropped), `BUSINESS_NOTIFICATION_BRANCH_COPY` (account_status_changed / claim_decision branches), the 4-family→icon→accent→severity taxonomy (`resolveNotificationVisual` — maps `business.*` + `stripe.*` rows to money/risk/audience/team), `interpolateTemplate` (no-`{var}`-leak fallback), `isBusinessNotificationType`. The single source of truth the inbox uses to decorate rows.
**Why:** Sub-C card system (§2 design) + Sub-D copy/defaults (SC-D1..D4) + the regression test.
**Lines:** ~360.

### NEW `mingla-business/src/services/businessNotificationRouting.ts`
**Before:** did not exist.
**Now:** Sub-B §4.B.4 routing: `parseBusinessDeepLink` (mingla-business:// → expo-router path), `resolveBusinessNavTarget` (per-type NAV_TARGETS for all 11 + `stripe.*`), `processBusinessNotification` (mark row read + `push_clicked` + Mixpanel + navigate; stash when unauthenticated). `payments` (id-less) resolves to the current brand's `/brand/{id}/payments`, falling back to `/(tabs)/account`.
**Why:** SC-B4 (tap each type → correct screen + row marked read/clicked).
**Lines:** ~190.

### NEW `mingla-business/src/hooks/usePushPermissionMoment.ts`
**Before:** did not exist.
**Now:** fires `requestPushPermission()` ONCE at the value moment (authenticated + a current brand exists) via a persisted AsyncStorage one-shot flag — never on boot/account-only.
**Why:** Sub-B §4.B.2 (SC-B2 — prompt at value moment, no boot prompt, no re-prompt spam).
**Lines:** ~60.

### NEW `mingla-business/src/hooks/useNotificationTypePrefs.ts`
**Before:** did not exist.
**Now:** reads/writes `public.notification_preferences` (channel × type × opt_in; upsert on `user_id,channel,type`). `isOn(type, channel)` = explicit row OR template default; `setPref` (single) + `setMany` (master gate writes all children push+in_app). Optimistic with revert.
**Why:** Sub-C §5.C.4 / §8 — per-type prefs MUST persist to the table `notify-dispatch` reads (SC-C5), not only Zustand. PostgREST upsert doc cited inline.
**Lines:** ~210.

### NEW `mingla-business/app/notifications.tsx`
**Before:** did not exist.
**Now:** full-screen expo-router route (SUB-C_DESIGN §1 — route, not sheet) mounting `BusinessNotificationsScreen` under a `chromeRow` header (chevL/close left, centred "Notifications", "Mark all read" right when `unreadCount > 0`). Web uses `close`. Tap → `resolveBusinessNavTarget` navigation.
**Why:** SC-C1 (bell opens inbox iOS+Android+Web), §4.3 mark-all-read.
**Lines:** ~175.

### MODIFIED `mingla-business/src/hooks/useBusinessNotifications.ts`
**Before:** read-only — query + INSERT-only Realtime invalidate. Returned the `UseQueryResult`.
**Now:** legacy `useBusinessNotifications` preserved (backward compatible). Added `useBusinessNotificationsInbox(userId)` → `{ query, notifications, unreadCount, markAsRead, markAllAsRead }`. `unreadCount = read_at===null` business rows. `markAsRead`/`markAllAsRead` optimistic + silent revert; `markAllAsRead` bulk update scoped `.or('type.like.stripe.%,type.like.business.%')`. Realtime now also handles UPDATE (patches cache). Added `data` column to the select. **Kept the I-PROPOSED-W `.or(...)` SELECT clause byte-intact.**
**Why:** Sub-C §5.C.2 (SC-C2/C3).
**Lines changed:** ~+170 (file roughly doubled).

### MODIFIED `mingla-business/src/services/oneSignalService.ts`
**Before:** install-only — init + login (NO optIn) + logout. Header said optIn/handlers/permission were deferred.
**Now:** `loginToOneSignal` now calls `OneSignal.User.pushSubscription.optIn()` (consumer ORCH-0407 parity). Added `requestPushPermission()`, `onForegroundNotification`, `onNotificationClicked`, `clearNotificationBadge`. All behind the existing `_enabled` / `Platform.OS !== "web"` guards (web = no-op, no native import). OneSignal docs URLs cited inline (aliases-external-id, permission-requests).
**Why:** Sub-B §4.B.1/§4.B.3 + Sub-C badge clear (SC-B1/B3/B6, SC-C2). COMMS-0003 docs-cited.
**Lines changed:** ~+130.

### MODIFIED `mingla-business/app/_layout.tsx`
**Before:** initialized OneSignal; no handlers, no permission moment.
**Now:** after init — calls `usePushPermissionMoment(user!==null, currentBrandId)`; registers `onForegroundNotification` (display() the banner) + `onNotificationClicked` (→ `processBusinessNotification`) in a `useEffect` keyed on the signed-in user, with cleanup; replays a deferred push target after sign-in (AsyncStorage stash). Web = guarded no-op.
**Why:** Sub-B §4.B.2/§4.B.3 (SC-B2/B3/B4 + T-B-ADV deferred replay).
**Lines changed:** ~+75.

### MODIFIED `mingla-business/src/components/ui/TopBar.tsx`
**Before:** bell rendered with `badge={unreadCount}` but `onPress` unwired (`[TRANSITIONAL]`); no consumer ever passed `unreadCount`, so the badge was always empty.
**Now:** `DefaultRightSlotInner` self-sources `unreadCount` from `useBusinessNotificationsInbox(user.id)` (an explicit prop still wins), wires the bell `onPress → router.push("/notifications")`, passes `badgeCap={9}`, and sets a count-aware accessibilityLabel. **All wiring stays INSIDE the default cluster — no `rightSlot=` added anywhere (I-37 preserved).**
**Why:** Sub-C §5.C.1 / §6 (SC-C1/C2), I-37.
**Lines changed:** ~+25.

### MODIFIED `mingla-business/src/components/ui/IconChrome.tsx`
**Before:** badge capped at hardcoded `"99+"`.
**Now:** added `badgeCap?: number` (default 99 — back-compat for every existing call-site); badge renders `{cap}+`. The notifications bell passes `badgeCap={9}`.
**Why:** SUB-C_DESIGN §6 9+ cap, scoped (other call-sites keep 99).
**Lines changed:** ~+6.

### MODIFIED `mingla-business/src/components/notifications/BusinessNotificationsScreen.tsx`
**Before:** flat list, spinner loading, title/body/timestamp/unread-dot, 4 states (loading/error/empty/populated).
**Now:** rebuilt to SUB-C_DESIGN — 4-family tinted-icon-circle cards, bold-entity title (`data.boldToken`), 2-line body, relative time, unread rail + dot + family-tinted fill, inline "Respond" button on blocking-risk rows, `chevR` affordance elsewhere; date buckets (Today/Yesterday/This week/Earlier) with unread-blocking-risk float within a bucket; skeleton (NOT spinner) via `useShimmer`; empty / error+retry / offline-banner(cached) / degraded(silent-revert) / web-capped-column states. NO swipe-to-dismiss. Android opaque-glass (`overflow:'hidden'` + zero elevation; iOS-only shadow). All tokens from `designSystem`.
**Why:** Sub-C §5.C.3 + the full DESIGN spec (SC-C4).
**Lines changed:** full rewrite (~270 → ~620).

### MODIFIED `mingla-business/app/account/notifications.tsx`
**Before:** 4 flat master toggles → Zustand (+ marketing → creator_accounts). TRANSITIONAL "delivery wires up in B-cycle" banner.
**Now:** 6-master layout — Order activity + **Payments & trust (new)** + **Audience & content (new)** + Brand team each expand to per-type child rows with Push + In-app switches persisting to `notification_preferences`; master OFF dims+disables children and writes `opt_in=false` for all of them; Scanner + Marketing unchanged. TRANSITIONAL banner removed (delivery is real). Defaults from the template matrix (SUB-D §4).
**Why:** Sub-C §5.C.4 + §8 (SC-C5).
**Lines changed:** full rewrite (~325 → ~560).

### NEW tests (3)
- `src/services/__tests__/businessNotificationRouting.test.ts` (Sub-B)
- `src/hooks/__tests__/useBusinessNotificationsInbox.test.ts` (Sub-C)
- `src/constants/__tests__/businessNotificationTemplates.test.ts` (Sub-D copy integrity)

---

## 2. How it all wires together

**Bell → inbox (Sub-C):** every screen's `<TopBar leftKind="brand">` renders `DefaultRightSlotInner`, which now (a) derives the unread badge from `useBusinessNotificationsInbox(user.id)` and (b) wires the bell to `router.push("/notifications")`. `app/notifications.tsx` mounts `BusinessNotificationsScreen` + the header's "Mark all read". No screen passes `unreadCount`/`rightSlot`, so I-37 holds and every screen stays byte-stable.

**Unread + mark-read (Sub-C):** `useBusinessNotificationsInbox` shares the SAME query key as the legacy hook, so the bell badge and the open inbox stay in cache lockstep. Tapping a row optimistically marks it read (`markAsRead`) → rail/dot/tint clear instantly → `clearNotificationBadge()` resets the iOS badge when the last unread clears. "Mark all read" does the bulk business-scoped update.

**Settings → backend honor (Sub-C):** per-type Push/In-app switches upsert `notification_preferences` rows; `notify-dispatch` reads that table and returns `reason:"user_disabled"` for an opted-out type (SC-C5). A master OFF writes `opt_in=false` for all its children so the backend honors the coarse toggle too.

**Opt-in + receive path (Sub-B):** `loginToOneSignal` (called from AuthContext on SIGNED_IN) now binds external_id AND `optIn()`s the device for delivery. `usePushPermissionMoment` fires the OS permission dialog once when a brand exists (the value moment). `_layout.tsx` registers the foreground handler (display() the banner) + the click handler (→ `processBusinessNotification`). A tap parses `data.deepLink` (`mingla-business://…`) via `parseBusinessDeepLink`, falls back to `resolveBusinessNavTarget` by type, marks the row read + `push_clicked`, tracks Mixpanel, and navigates. A tap while logged out stashes the resolved target in AsyncStorage; the post-login effect replays it once.

---

## 3. Web-export safety

- No static `import … from "react-native-onesignal"` exists; the only reference is the `Platform.OS !== "web"`-guarded `require()` in `oneSignalService.ts`. Web bundles never load the native module.
- The inbox screen + route import `clearNotificationBadge` (web-safe no-op) but never OneSignal directly. `app/notifications.tsx` + `BusinessNotificationsScreen` use `Platform.OS === "web"` for the web variant (close icon, no native shadow). `useShimmer` / `@react-native-async-storage/async-storage` / supabase are all web-safe.
- **ORCH-0778 web Stripe/native-import gate: PASSED.** I-PROPOSED-W gate: PASSED (0 violations). I-37: preserved by construction (no `rightSlot=` added; verified via `git diff`).
- **Deviation (documented):** the DESIGN spec referenced `@react-native-community/netinfo` for the offline state, but it is NOT a dependency in this app. To avoid adding a native dependency (out of scope), offline/degraded is implemented via React Query state — a fetch failure WITH cached rows shows the cached list + an offline-style banner; a fetch failure with NO cache shows the error+retry state. Same user-facing outcome, no new dependency.

---

## 4. Regression tests

All under `mingla-business/**/__tests__/**`, jest (ts-jest, node env).

| Test | Path | Asserts |
|---|---|---|
| Sub-B | `src/services/__tests__/businessNotificationRouting.test.ts` | `parseBusinessDeepLink` + `resolveBusinessNavTarget` per-type routing (11 types + stripe.* + fallbacks), `processBusinessNotification` marks read + navigates when authed / stashes when not |
| Sub-C | `src/hooks/__tests__/useBusinessNotificationsInbox.test.ts` | `unreadCount` = read_at===null count; `markAsRead` optimistic cache patch + `.update().eq("id",…)`; `markAllAsRead` clears all + business-scoped bulk update |
| Sub-D | `src/constants/__tests__/businessNotificationTemplates.test.ts` | 11 types, char budgets, `interpolateTemplate` no-`{var}`-leak, both branch sets, family/icon visual mapping |

**Passing run (34/34):**
```
Test Suites: 3 passed, 3 total
Tests:       34 passed, 34 total
```

**Fails-on-revert (verified at base commit `158068f3b`):** breaking `unreadCount` (count all rows) + the routing (payments → `/event/BROKEN`) produced `9 failed, 16 passed` across the two suites; restoring → `34 passed`. The Sub-D template test fails on a dropped type or a broken interpolate fallback.

---

## 5. Spec success-criteria traceability

| SC | Verdict | Evidence |
|---|---|---|
| SC-B1 (opt-in + banner) | implemented, unverified | `optIn()` wired in login + handlers registered; live delivery needs creds (Q1) + dev build |
| SC-B2 (value-moment prompt, not boot) | PASS (logic) | `usePushPermissionMoment` gated on brand-exists + one-shot flag |
| SC-B3 (foreground banner) | implemented, unverified | `display()` called for all types; needs dev build |
| SC-B4 (tap → correct screen + read/clicked) | PASS (logic, tested) | `businessNotificationRouting.test.ts` |
| SC-B5-Web (web no-op, builds) | PASS | guarded require; ORCH-0778 gate green |
| SC-B6 (logout clears) | PASS | `OneSignal.logout()` already wired, `_loginComplete=false` |
| SC-C1 (bell opens inbox 3 surfaces) | PASS | route + bell onPress |
| SC-C2 (badge + decrement + clear) | PASS (tested) | inbox hook test + `clearNotificationBadge` |
| SC-C3 (realtime INSERT + UPDATE) | implemented, unverified | UPDATE handler added; needs runtime |
| SC-C4 (9 states, business voice) | PASS | screen rewrite per DESIGN |
| SC-C5 (per-type prefs persist + honored) | PASS (write path) | `useNotificationTypePrefs` upserts the table notify-dispatch reads |
| SC-C6 (I-PROPOSED-W intact, no consumer rows) | PASS | gate green, `.or()` intact |
| SC-C7-Web (inbox + mark-read, builds) | PASS | web variant + guards |
| SC-D1..D4 (copy integrity) | PASS (tested) | template test |

---

## 6. Invariant verification

| Invariant | Preserved? | Note |
|---|---|---|
| I-PROPOSED-W (notif app-type-prefix) | Y | SELECT `.or()` clause byte-intact; mutations target by id / business-scoped; gate green |
| I-37 (brand TopBar no `rightSlot=`) | Y | bell wired inside default cluster; no `rightSlot=` added |
| Constitution #6 (logout clears) | Y | OneSignal logout already wired |
| COMMS-0002 (backend allowlist) | N/A | no `supabase/functions` or `supabase/migrations` files touched |
| COMMS-0003 (provider docs inline) | Y | OneSignal docs URLs cited in `oneSignalService.ts` |
| Android opaque-glass policy | Y | cards `overflow:'hidden'` + zero elevation; iOS-only shadow |

---

## 7. Discoveries for orchestrator

- **netinfo absence (documented above):** if true OS-level offline detection is wanted later, `@react-native-community/netinfo` would need adding (new dependency → its own decision). Current behavior degrades gracefully without it.
- **Live-delivery gates on Q1 (business OneSignal creds) + a dev build:** SC-B1/B3 + SC-C3 are `implemented, unverified` — they need `ONESIGNAL_BUSINESS_APP_ID`/`REST_API_KEY` set AND a `mingla-business` dev build on a device. No `eas build` run per dispatch.
- **Pre-existing repo TS errors** (NOT introduced here): `IconChrome.tsx:177` `hovered: false` (on HEAD), `account.tsx` `trending-up`, checkout buyer `any` params, `packages/brand-rendering` module resolution, several test-file `category`/`account_owner` mismatches. My touched files are tsc-clean.

---

## 8. Deploy / next

No deploy. No migration. Client-only. Hand back to the orchestrator for PR + (after merge) the dev-build verification pass with business creds.
