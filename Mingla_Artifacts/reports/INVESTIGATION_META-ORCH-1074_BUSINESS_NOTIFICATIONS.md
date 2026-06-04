# INVESTIGATION — META-ORCH-1074 [Mingla Business notifications feature build-out]

**Date:** 2026-06-04
**Mode:** INTAKE / INVESTIGATE (cross-app forensic map)
**Owner:** mingla-orchestrator+claude
**Trigger:** Operator wants the Business app to "truly notify" brand users so they stay on top of everything on the app. OneSignal SDK is already installed in the Business app. Observe the deep Consumer integration, the shape of notifications, and how notification cards work; then build the Business equivalent.

---

## 0. One-paragraph executive summary

The Consumer app (`app-mobile/`) has a complete, mature notification system: OneSignal init → per-user login → deferred permission prompt → foreground + click handlers → deep-link routing, plus a full in-app **notification center** (`NotificationsSheet.tsx`) backed by a persisted `notifications` table, a Realtime-synced `useNotifications` hook, a bell + unread badge in the top bar, and ~30 typed notification kinds with accept/decline actions. The backend dispatcher (`notify-dispatch`) already supports brand-scoped notifications (`brand_id` + `deep_link` columns exist and are wired) and a full preference / quiet-hours / rate-limit / in-app-row + push pipeline. The Business app (`mingla-business/`) has OneSignal **installed and initialized** (login/logout wired to auth) but is missing the last mile: push **opt-in**, receive/click **handlers**, deep-link routing, the in-app **inbox UI** (bell exists but is unwired), and — critically — the **backend cannot reach business devices yet** because `push-utils.ts` targets a single (consumer) OneSignal app while the Business app registers against a *separate* OneSignal application. Business push events today are Stripe-compliance only; there are no ticket-sold / payout / follower / review notifications.

---

## 1. Consumer app — the reference implementation (`app-mobile/`)

### 1.1 OneSignal SDK lifecycle
- `app-mobile/src/services/oneSignalService.ts:8` — `ONESIGNAL_APP_ID = '388b3efc-14c2-4de2-98cb-68c818be9f06'` (hardcoded — the **consumer** OneSignal app).
- `:33` `initializeOneSignal()` (3× retry) — called once at boot from `app/index.tsx:331`.
- `:77` `loginToOneSignal(userId)` → `OneSignal.login(userId)` + `pushSubscription.optIn()` — called on auth at `app/index.tsx:340`.
- `:102` `requestPushPermission()` — deferred until **after** the coach-mark tour, sequenced by `permissionOrchestrator.ts` (ATT → AppsFlyer → push).
- `:122` `logoutOneSignal()` → `OneSignal.logout()` — called from `utils/authCleanup.ts:53` on sign-out (Constitution #6).

### 1.2 Receive + deep-link routing
- `oneSignalService.ts:181` `onForegroundNotification()` — explicit `display()` to show banner (SDK v5).
- `:218` `onNotificationClicked()` — tap handler.
- `app/index.tsx:413` `processNotification(data, NAV_TARGETS[data.type])` — extracts `notificationId/deepLink/type/actionId`, stashes deep link if unauthenticated, marks read + `push_clicked`, Mixpanel-tracks, then routes via `deepLink` or a `NAV_TARGETS` type→screen map. Push action buttons (`handlePushAccept`/`handlePushDecline`) process accept/decline straight from the system tray.

### 1.3 In-app notification center (the "cards")
- `app-mobile/src/components/NotificationsSheet.tsx` (1235 lines, V2 redesign ORCH-0975) — gorhom bottom-sheet, pan-down dismiss. Cards show: avatar (with unread amber ring), title with bolded actor name, 2-line body, category pill (social/sessions/messages), relative time, right-side unread dot, inline Accept/Decline for actionable types, pending spinner, error line. List grouped by Today / Yesterday / This Week / Earlier; skeleton, empty ("You're all caught up"), error, and offline states.
- `app-mobile/src/components/GlassTopBar.tsx` — bell `GlassIconButton` + `unreadNotifications` badge; opens the sheet.
- Tap behaviour: actionable → mark read; non-actionable → delete; then navigate + close.

### 1.4 Data model + hook
- `app-mobile/src/hooks/useNotifications.ts:17` `ServerNotification` interface: `id, user_id, type, title, body, data(jsonb), actor_id, related_id, related_type, is_read, read_at, push_sent, push_sent_at, push_clicked, created_at, expires_at`.
- `:215` `fetchNotifications()` — **excludes** `type LIKE 'stripe.%'` and `type LIKE 'business.%'` (the table is shared; business/stripe types are namespaced OUT of the consumer feed by design).
- `:277` Realtime channel `notifications_realtime_${userId}` (INSERT/UPDATE/DELETE) with optimistic cache + haptic on insert.
- React Query keys: `notificationKeys.all(userId)`, `.unreadCount(userId)`.
- Mutations: markAsRead / markAllAsRead / delete / clearAll / loadMore + accept/decline (friend, pair, collab, link).

### 1.5 Notification taxonomy (~30 types)
Social (`friend_request_*`, `pair_request_*`, `paired_user_*`), Collaboration/Sessions (`collaboration_invite_*`, `session_member_*`, `board_card_*`), Messages (`direct_message_received`, `board_message_*`), Calendar (`calendar_reminder_today|tomorrow`), Lifecycle (`trial_ending`, `weekly_digest`, `re_engagement*`), plus `referral_credited`, `visit_feedback_prompt`, `holiday_reminder`, `birthday_reminder`. Categories: social / sessions / messages / all. Actionable: friend/pair/collab requests, trial_ending, visit_feedback_prompt.

---

## 2. Business app — current state (`mingla-business/`)

| Capability | Status | Evidence |
|---|---|---|
| SDK installed | ✅ | `package.json` `react-native-onesignal@5.4.5`, `onesignal-expo-plugin@2.5.0` |
| Plugin configured | ✅ | `app.json:107-110` (filtered out in `app.config.ts` unless `EXPO_PUBLIC_ONESIGNAL_APP_ID` set) |
| App ID | ✅ env-driven, **SEPARATE** app | `src/services/oneSignalService.ts:27` `process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID` (consumer is a different, hardcoded app) |
| Init at boot | ✅ | `app/_layout.tsx:186` (deferred post-paint) |
| login/logout wired | ✅ | `AuthContext.tsx:247/355/423/739` |
| Push **opt-in** | ❌ deferred | `oneSignalService.ts:10-13` comment — `pushSubscription.optIn()` NOT called |
| Permission UX | ❌ | none |
| Foreground/click handlers | ❌ | no `addNotificationClickListener` / `addForegroundWillDisplayListener` in src |
| Deep-link routing | ❌ | none |
| In-app inbox/feed | ❌ | no Inbox/Notification feed screen exists |
| Bell icon | ⚠️ visual only | `src/components/ui/TopBar.tsx:125-131` renders bell + optional `unreadCount` badge, **onPress unwired** |
| Settings screen | ✅ | `app/account/notifications.tsx` — 4 toggle categories (Order activity, Scanner activity, Brand team, Marketing); persists to Zustand + `creator_accounts.marketing_opt_in` |
| Nav shape | — | 5 tabs (`app/(tabs)/_layout.tsx`): home, hub, ari, marketing, account |

---

## 3. Backend — current plumbing (`supabase/`)

- **Dispatcher:** `supabase/functions/notify-dispatch/index.ts` — central path. Accepts `userId, type, title, body, data, brandId, deepLink, emailTo, actorId, relatedId, relatedType, idempotencyKey, expiresAt, pushOverrides`. Writes a `notifications` row (`:308 brand_id`, `:309 deep_link`) and pushes. Enforces: per-user × per-type preferences, quiet hours (22:00–08:00 local), session mute, rate limit (10/type/5min).
- **Push helper:** `supabase/functions/_shared/push-utils.ts` — `sendPush()` / `sendPushToMany()` → `POST https://api.onesignal.com/notifications`, target by `external_id` (Supabase UUID). **Uses a single `ONESIGNAL_APP_ID` + `ONESIGNAL_REST_API_KEY` (`:7-8`)** — currently the consumer app's credentials.
- **Tables:**
  - `notifications` (baseline `20260505000000` lines 8481-8500) + `brand_id` + `deep_link` (`20260511000003_b2a_v3_notifications.sql`). RLS: service-role insert; user reads/updates/deletes own. **Already business-ready.**
  - `notification_preferences` (`20260511000003`) — channel(`email|push|in_app`) × type × opt_in.
  - `ticket_order_notifications` — buyer email/SMS queue (NOT push, NOT in-app).
  - `user_push_tokens` — legacy/unused (OneSignal manages tokens client-side).
- **Existing business push events:** Stripe compliance only — `stripe.kyc_stall_reminder`, `stripe.bank_verification_failed`, `stripe.payout_failed`, `stripe.account_deauthorized`, deadline warnings. **No** ticket-sold, new-order, payout-success, new-follower, or review notifications.

---

## 4. The keystone gap (architecture-critical)

The Business app registers devices against a **separate OneSignal application** (`EXPO_PUBLIC_ONESIGNAL_APP_ID`), but the backend `push-utils.ts` only knows **one** OneSignal app (`ONESIGNAL_APP_ID` = consumer). A business notification dispatched today would be sent to the *consumer* OneSignal app and would **never reach a brand owner's Business-app device**. Fix requires:
- New secrets `ONESIGNAL_BUSINESS_APP_ID` + `ONESIGNAL_BUSINESS_REST_API_KEY` (NEW dependency — operator must provide).
- `push-utils.ts` / `notify-dispatch` must route by audience (consumer vs business OneSignal app), e.g. an `app: 'consumer' | 'business'` param resolved from the notification type namespace (`business.*` → business app).

---

## 5. Recommended build shape (META-ORCH-1074, ~4 sub-orchs)

- **Sub-A — Backend dual-app routing + business triggers.** Teach `push-utils`/`notify-dispatch` to target the business OneSignal app for `business.*` types; add the trigger call-sites for the chosen business events (write via `notify-dispatch` with `brand_id` + `business.*` type + `deep_link`). Cite OneSignal REST docs inline per COMMS-0003. Backend strict-grep allowlist per COMMS-0002.
- **Sub-B — Client receive path (Business app).** Call `optIn()` behind a permission moment; port `processNotification` + a business `NAV_TARGETS` map; foreground display + click handlers; deep-link into hub/orders/account.
- **Sub-C — Client inbox UI (Business app).** Wire the existing TopBar bell onPress + unread badge; build the Business notification inbox (port `NotificationsSheet` to Business design tokens); build a `useNotifications`-equivalent hook (Realtime, scoped to `business.*` + brand-relevant rows). Web preview = inbox only (push native-only).
- **Sub-D (optional) — Taxonomy + copy + default prefs (product).** Define the business notification types, titles/bodies, deep-link targets, inbox categories, and default opt-in matrix.

**Affected Surfaces:** business-iOS, business-Android (push + inbox), business-web-preview (inbox only, no push), backend (edge functions + migration). **NOT in scope:** consumer iOS/Android (reference only — explicitly excluded from the business feed via the `business.%` fetch filter), admin-web (no notification surface), buyer-web (separate email/SMS path).

**Reused for free:** `notifications` table (brand_id/deep_link), `notification_preferences`, `notify-dispatch` pipeline (prefs/quiet-hours/rate-limit), the entire consumer UI as a design+code reference.
