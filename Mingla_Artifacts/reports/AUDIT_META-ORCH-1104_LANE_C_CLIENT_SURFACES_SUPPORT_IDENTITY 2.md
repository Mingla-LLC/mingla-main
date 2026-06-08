# AUDIT — META-ORCH-1104 LANE C: Client Surfaces + Support-Staff Identity

**Lane:** C (consumer + business client surfaces, support-staff toggle identity, push)
**Mode:** forensic INVESTIGATE / AUDIT — evidence-backed, exact mount points. No code edited.
**Date:** 2026-06-08
**Worktree:** `meta-orch-1104-[support-livechat-segmentation]` (rebased onto `origin/main`, was 14 behind)
**Reads against:** PROPOSAL_META-ORCH-1104 §1–§6.5

---

## Scope note

This lane covers WHERE the support UI mounts on the two phone clients and WHO is allowed to
operate the support console. It does NOT cover the admin web desk (Lane B), the support
domain model / RLS (Lane A / Phase 0), or the segmentation view. Cross-references those lanes
where a mount point depends on a backend contract.

---

## FINDING 1 — Consumer account surface (`AccountSettings.tsx` + `ProfilePage.tsx`)

### 1.1 Mount chain
- `ProfilePage.tsx` is the consumer Profile tab. It opens the settings sheet via state
  `showAccountSettings` (`app-mobile/src/components/ProfilePage.tsx:133`), a `SettingsRow`
  tap (`:535-542`), and mounts `<AccountSettings … visible={showAccountSettings} … />`
  (`:590-597`). Import at `:42`.
- `AccountSettings.tsx` is a `BaseBottomSheet` (`wrapInRNModal`, 92% snap) whose body is a
  vertical stack of **accordion cards** (`AccountSettings.tsx:559-865`).

### 1.2 Accordion / section structure (the insertion target)
`SectionId` union = `"basics" | "privacy" | "notifications" | "quietHours" | "appInfo"`
(`AccountSettings.tsx:65`). Cards render in order:
1. The Basics — `:560`
2. Privacy — `:638`
3. Notification Settings — `:695` (writes `notification_preferences` booleans — see Finding 3)
4. Quiet Hours — `:780`
5. **App Information** — `:809` — **contains the only current "support" affordance**:
   a `TouchableOpacity` row "Contact support" that does `Linking.openURL("mailto:support@usemingla.com")`
   (`:822-836`). This is the static mailto the proposal §6.5/E5 flagged.
6. The Red Zone (delete account, non-collapsible) — `:839`.

**EXACT place a "Help & Support" entry would mount:** add a new `SectionId` `"support"` to the
union (`:65`), seed it in the default-expanded set if desired (`:127`, `:146`), and insert a new
`<AccordionCard icon="help-circle" title="Help & Support" …>` **between App Information (`:837`)
and the Red Zone (`:839`)**. Inside it: a "Start a live chat" row and a "My support requests"
row. The existing static "Contact support" mailto row (`:822-836`) should be **moved into** this
new section (or replaced) so there is one support home, not two.

### 1.3 Nested bottom-sheet pattern (sibling-root, one-sheet-at-a-time)
Documented in-code at `AccountSettings.tsx:471-510`. Mechanics a support live-chat sheet must follow:
- gorhom sheets do not portal/stack; two `wrapInRNModal` sheets cannot co-present on iOS.
- The root sheet renders only `visible={visible && !anyChildOpen}` (`:516`); `anyChildOpen`
  is the OR of every child-sheet flag (`:484-489`).
- Each child picker is its OWN `wrapInRNModal` `BaseBottomSheet` rendered as a **sibling**
  after the root closes (gender `:876`, language `:903`, birthday `:933`, country `:952`,
  delete center-dialog `:966`). `handleRootClose` (`:491-510`) swallows the suppressed-for-child
  close so dismissing a child returns to settings rather than closing the whole flow.
- **For support:** the live-chat thread is large/full-screen and keyboard-heavy — better mounted
  as its OWN route/full-screen modal launched from the Profile tab, NOT as a nested
  `BaseBottomSheet` child of AccountSettings (the sibling-root pattern fights a chat composer's
  keyboard). The AccountSettings row should `onClose()` settings then navigate to the chat
  surface. A lightweight "create ticket" form, however, fits the sibling-root child pattern fine.

### 1.4 Reusable chat thread (message-list + composer) — CONFIRMED
- `app-mobile/src/components/MessageInterface.tsx` is the canonical 1:1 / group chat thread
  component. It has a **message list + composer**, both confirmed:
  - inverted `FlatList` message list, `flatListRef` (`MessageInterface.tsx:514`, list at `:1548`,
    `inverted={true}` `:1698`), rendering `MessageBubble` (`:29` import).
  - a `TextInput` composer (`:2016`) with placeholder/send wiring.
  - props include `conversationId?: string | null` (`:190`, default `:233`) and `currentUserId`.
  - sends via `messagingService.sendCardMessage(conversationId, …)` (`:1016`) — the canonical
    `messagingService` (`:54`).
  - live presence via `useChatPresence` (`:26`) and realtime via `useBroadcastReceiver` /
    `chat:{conversationId}` broadcast (`:559,:569`).
- Chat UI atoms in `app-mobile/src/components/chat/`: `MessageBubble.tsx`, `TypingIndicator.tsx`,
  `ReplyPreviewBar.tsx`, `ReplyQuoteBlock.tsx`, `SwipeableMessage.tsx`, `MessageContextMenu.tsx`,
  `ChatStatusLine.tsx`, `DoubleTapHeart.tsx`.
- **Reuse path for support live-chat:** a support ticket OWNS a `conversations` row
  (`linked_entity_type='support'` per proposal §3.1/E2); the requester surface renders
  `<MessageInterface conversationId={ticketConversationId} currentUserId={user.id} … />`. The
  many collab/board props are optional and default off, so a "plain DM" configuration is viable
  — but `MessageInterface` is heavy (collab decks, mentions, card chips). RECOMMENDATION for
  SPEC: a thin `SupportChatScreen` wrapper that mounts `MessageInterface` with all collab props
  disabled, OR a minimal new message-list that reuses only `MessageBubble` + composer styles.

---

## FINDING 2 — Business account surface + nav (`(tabs)/account.tsx`, `account/*`, `_layout.tsx`)

### 2.1 Router structure (expo-router)
- Tab shell: `mingla-business/app/(tabs)/_layout.tsx`. It renders `<Slot/>` + a custom glass
  `BottomNav` capsule (`:136-154`). The tab registry is a `TABS` array (`:47-67`):
  `home (:48)`, `hub (:54)`, `ari (:59)`, `marketing/"Blast" (:65)`, `account (:66)`.
- The visible set is **rank-filtered** per render via `visibleTabsForRank(TABS, rank)`
  (`:119-122`) where `rank` comes from `useCurrentBrandRole(currentBrandId)` (`:99`).
  Thresholds live in `navTabGate.ts` `MIN_RANK_FOR_TAB` (`navTabGate.ts:43-49`).
- Account sub-pages are file-routes under `mingla-business/app/account/`:
  `edit-profile.tsx`, `notifications.tsx`, `delete.tsx`. Navigated to from the Account tab via
  `router.push("/account/edit-profile")` (`account.tsx:139`) and
  `router.push("/account/notifications")` (`:143`).

### 2.2 Account tab body
`(tabs)/account.tsx` renders a `TopBar` + `ScrollView` of `GlassCard`s:
"Your brands" (`:245`), optional "Mingla Partner" (`:304`), and a **"Settings" card**
(`:333-355`) with `SettingsNavRow` rows: "Edit profile", "Notifications", "Sign out everywhere".
`SettingsNavRow` is an inline component (`:415-453`).

### 2.3 (a) Business user's own "Help & Support" entry
**EXACT place:** add a `SettingsNavRow` to the existing "Settings" `GlassCard`
(`account.tsx:338-354`, after the "Notifications" row `:344-348`) with
`icon="help"` / label "Help & Support", `onPress={() => router.push("/account/support")}`.
That implies a NEW file-route `mingla-business/app/account/support.tsx` (mirrors the
`notifications.tsx` sub-page pattern) — the business requester surface (start chat / file ticket),
reachable by every business user regardless of rank.

### 2.4 (b) Support-staff "Live Chats" inbox — tab vs sub-page
There IS a tab bar to extend (`(tabs)/_layout.tsx:47`). Two viable mounts:
- **Sub-page (recommended for v1):** `app/(tabs)/account.tsx` shows a NEW "Support console"
  `GlassCard` ONLY when the user is support staff (Finding 3), with a row →
  `router.push("/support/inbox")` (new route group `app/support/inbox.tsx` + `app/support/[ticketId].tsx`).
  This avoids touching the rank-filtered `TABS` array and the strict-grep `MIN_RANK_FOR_TAB`
  gate, and keeps the inbox invisible to normal operators.
- **Dedicated "Support" tab (v2):** add `{ id: "support", icon: "chat", label: "Support" }` to
  `TABS` (`:47`). This REQUIRES a matching entry in `navTabGate.ts:MIN_RANK_FOR_TAB`
  (strict-grep gate `nav-tab-gate-declared.test.ts` fails the build otherwise — `navTabGate.ts:38-42`).
  BUT `visibleTabsForRank` filters on **brand rank**, and support staffing is DECOUPLED from
  brand membership (Finding 3) — so a Support tab cannot be gated by the existing rank machinery.
  Adding it as a tab would need `visibleTabsForRank` (or the `(tabs)/_layout.tsx` `visibleTabs`
  memo `:119`) extended to OR-in a `support_staff` capability flag. Heavier; defer.

---

## FINDING 3 — Support-staff identity + toggle (DECOUPLED from brand membership)

### 3.1 How the business app knows WHO + WHAT-they-can-do today
- **WHO:** `useAuth()` from `mingla-business/src/context/AuthContext.tsx` exposes
  `user: User | null` (`AuthContext.tsx:132`), `isAuthReady` (`:136`), `signOut` (`:156`).
  `user.id` is the Supabase auth uuid. OneSignal external-id is set via `loginToOneSignal(s.user.id)`
  (`:304`, `:412`).
- **WHAT (capabilities):** `useCurrentBrandRole(brandId)` (`hooks/useCurrentBrandRole.ts`) reads
  `brand_team_members.role` + `permissions_override` for `(brand_id, user_id)` with
  `removed_at IS NULL` (queryFn `:113-122`), falling back to `brand_owner` synthesis for the solo
  brand creator via `brands.account_id → creator_accounts.user_id` (`:131-160`). Returns
  `{ role, rank, permissionsOverride }`. Rank enum in `utils/brandRole.ts:28-36`
  (`scanner 10 … brand_owner 60`).
- **Action gating:** `utils/permissionGates.ts` `MIN_RANK` + `canPerformAction(rank, action)`
  (`permissionGates.ts:16,41`). **Nav gating:** `utils/navTabGate.ts` `MIN_RANK_FOR_TAB`
  (`navTabGate.ts:43`).

**KEY FORENSIC POINT:** every capability today is **brand-scoped** — it is a function of
`(user, currentBrand)`. There is NO user-global capability concept in the business app. Support
staffing must NOT be expressed as a `brand_team_members.role` (that would tie support to a brand
and exclude a support hire who owns no brand). The proposal §3.1/E1 correctly recommends a
dedicated table — name it `support_staff` / `support_operators`, NOT `agents` (collides with the
ARI `agent_*` tables per §6.5/E1).

### 3.2 Cleanest insertion point for a `support_staff` capability (Lane-C client side)
1. **Backend (Phase 0, Lane A):** a `support_operators(user_id PK, enabled bool, available bool,
   display_name, role 'operator'|'lead')` table, RLS readable by self, plus an RPC/view
   `is_support_operator()` or a `useSupportOperator()` hook reading own row.
2. **Business-app hook:** add `mingla-business/src/hooks/useSupportOperator.ts` —
   a React-Query hook keyed on `user.id` (NOT `currentBrandId`), reading the operator's own
   `support_operators` row. This is the brand-decoupled mirror of `useCurrentBrandRole`. It
   returns `{ isOperator, enabled, available }`. STALE_TIME short (security-adjacent), same
   posture as `useCurrentBrandRole`'s 30s (`useCurrentBrandRole.ts` STALE_TIME_MS).
3. **Toggle (enable/availability) mount:** the per-staffer "I'm available for support live"
   switch belongs on the **Account tab support console card** (Finding 2.4) and/or the new
   `app/support/inbox.tsx` header — a `Switch` writing `support_operators.available`. The
   capability GRANT/REVOKE (`enabled`) is an **admin** action (Lane B / mingla-admin), not
   self-serve, so the cofounder/hire can't self-promote. `available` is self-serve (shift toggle).
4. **Conditional rendering:** the "Support console" entry in `account.tsx` and any `/support/*`
   route renders only when `useSupportOperator().isOperator && enabled`. Server RLS on
   `support_tickets`/messages is the ultimate gate (mirrors the brandRole "RLS is the safety net"
   posture).

---

## FINDING 4 — Business-app push + notifications (staffer side)

### 4.1 Registration / identity
- `mingla-business/src/services/oneSignalService.ts`: `initializeOneSignal()` (`:58`) inits the
  SDK with `EXPO_PUBLIC_ONESIGNAL_APP_ID` (`:29`); `loginToOneSignal(userId)` (`:95`) sets the
  external-id alias + `optIn()` (registers the device for delivery, META-ORCH-1074 Sub-B).
  `requestPushPermission()` fires the OS prompt at a value moment via
  `hooks/usePushPermissionMoment.ts` (NOT on boot). Web is Platform-guarded to no-op (`:35-48`).
- Called from `AuthContext` on session resolve: `loginToOneSignal(s.user.id)` (`AuthContext.tsx:304,:412`).

### 4.2 Receiving "new support chat" on a staffer's phone
- Push fan-out: `supabase/functions/_shared/push-utils.ts` `sendPush(payload)` targets by
  `external_id = Supabase auth.users.id` (`push-utils.ts:4,:60,:113-117`) and selects the
  OneSignal application by `payload.app` (`:97`, default `"consumer"`) via `resolveAppCredentials`.
  **A support push to a staffer MUST set `app: "business"`** so it hits the business OneSignal
  app (`:100-110` — no cross-app fallback; wrong app reaches nobody).
- A new edge path (Lane A/Phase 0/E) — e.g. extend `notify-message` or a new `notify-support` —
  resolves the recipient set (all `support_operators` where `enabled AND available`), then calls
  `sendPush({ app: "business", targetUserId, type: "support_new_ticket", … })` per operator.
- **Availability gating** is the `support_operators.available` flag (Finding 3): the dispatch
  query filters `available = true`, so off-shift staffers aren't pinged. The requester always
  gets `support_message` (Finding 5). This mirrors the proposal §3.5 design.

### 4.3 Notifications settings page (business)
- `mingla-business/app/account/notifications.tsx` is a 6-master layout (Order activity, Payments
  & trust, Audience & content, Brand team, Scanner activity, Marketing). Masters expand to child
  rows, each with **Push + In-app** toggles persisting to `notification_preferences` via
  `useNotificationTypePrefs(userId)` (`notifications.tsx:53-55,:107`) — NOT only Zustand.
  Child types are `BusinessNotificationType` literals (`notifications.tsx:72-93`).
- **Where a support-staff notification pref mounts:** add a NEW master "Support console" with a
  child type (e.g. `business.support_new_ticket`) into the config arrays (`notifications.tsx:72-93`
  pattern) — but render that master ONLY when `useSupportOperator().isOperator`. The
  business-app requester's "support reply" pref (for a business user filing their OWN ticket)
  can ride the existing per-type prefs too.

---

## FINDING 5 — Consumer push for support replies (requester side)

### 5.1 Service
- `app-mobile/src/services/oneSignalService.ts`: `initializeOneSignal()` (`:33`),
  `loginToOneSignal(userId)` (`:77`, sets external-id + `optIn()` per ORCH-0407 `:66-77`),
  `requestPushPermission()` (`:108`), foreground/click listeners (`:181,:218`),
  `clearNotificationBadge()` (`:149`). External-id = auth uuid (consumer OneSignal app).
- A support reply notifies the requester via `sendPush({ app: "consumer", targetUserId: requesterId,
  type: "support_message", data: { ticketId, conversationId } })` — `app: "consumer"` (default)
  routes to the consumer OneSignal app (`push-utils.ts:97`). Deep-link data should carry the
  ticket/conversation id so the tap opens the support thread (mirror the `chat`/`messages`
  deep-link handling in `notify-message` `:485-498`).

### 5.2 Consumer notification settings screen
- **There is NO standalone consumer "notification settings" screen.** The consumer notification
  preferences live INSIDE `AccountSettings.tsx` → "Notification Settings" accordion
  (`AccountSettings.tsx:694-777`). It reads/writes the `notification_preferences` table as
  BOOLEAN COLUMNS (`push_enabled, friend_requests, link_requests, messages,
  collaboration_invites, marketing`) via `supabase.from('notification_preferences').upsert(...)`
  (`:166-204`, `updateNotifPref` `:187`).
- **Insertion for a "Support replies" toggle:** add a sub-toggle row inside the
  `notifPrefs.push_enabled && (...)` block (`AccountSettings.tsx:714-776`, e.g. after the
  "messages" toggle `:741-750`) bound to a NEW boolean column `support_replies` (proposal §6.5/E3:
  it's a boolean column, not a row type) — OR ride the existing `messages` boolean. SPEC must pick
  one; recommend a dedicated `support_replies` column so users can mute DMs without muting support.

---

## Mount points table

| Surface | Exact file:line | Insertion approach |
|---|---|---|
| Consumer "Help & Support" entry | `app-mobile/src/components/profile/AccountSettings.tsx:809-837` (between App Info `:837` & Red Zone `:839`) | New `SectionId "support"` (`:65`) + `<AccordionCard>`; fold the static mailto row (`:822-836`) into it |
| Consumer support-chat launch | `ProfilePage.tsx:590-597` (sheet mount) / new route | Row `onClose()`s settings, then navigates to a full-screen `SupportChatScreen` (do NOT nest in the sibling-root sheet — composer/keyboard) |
| Consumer support-reply push pref | `AccountSettings.tsx:714-776` (notif accordion children) | New sub-toggle → `notification_preferences.support_replies` boolean |
| Business user's own "Help & Support" | `mingla-business/app/(tabs)/account.tsx:338-354` (Settings GlassCard) | New `SettingsNavRow` → `router.push("/account/support")` + new route `app/account/support.tsx` |
| Business support-staff "Live Chats" inbox | `app/(tabs)/account.tsx` (new conditional GlassCard) + new `app/support/inbox.tsx`, `app/support/[ticketId].tsx` | Sub-page (v1) gated by `useSupportOperator()`, NOT a new tab (avoids brand-rank `MIN_RANK_FOR_TAB` gate) |
| Business support availability toggle | `app/support/inbox.tsx` header / Account support card | `Switch` → `support_operators.available` |
| Business support-staff push pref | `mingla-business/app/account/notifications.tsx:72-93` | New master "Support console" + child `business.support_new_ticket`, rendered only if `isOperator` |
| Support-staff capability hook | new `mingla-business/src/hooks/useSupportOperator.ts` | Mirror `useCurrentBrandRole.ts` but key on `user.id`, read own `support_operators` row (brand-decoupled) |
| Support push dispatch | `supabase/functions/_shared/push-utils.ts:97` (`payload.app`) | `app:"business"` to staffers (filtered by `available`), `app:"consumer"` to requester |

---

## Reusable UI components / services (do NOT reinvent)

- **Thread (list + composer):** `app-mobile/src/components/MessageInterface.tsx` — inverted
  `FlatList` (`:1548`) + `TextInput` composer (`:2016`), `conversationId` prop (`:190`),
  sends via `messagingService` (`:54`). Heavy (collab/board); wrap thin or reuse atoms.
- **Chat atoms:** `app-mobile/src/components/chat/` — `MessageBubble`, `TypingIndicator`,
  `ReplyPreviewBar`, `ReplyQuoteBlock`, `SwipeableMessage`, `MessageContextMenu`, `ChatStatusLine`.
- **Messaging service:** `app-mobile/src/services/messagingService.ts`.
- **Presence:** `useChatPresence` + `chatPresenceService` (`conversation_presence` table, §6.5/E2).
- **Realtime:** `useBroadcastReceiver` / `chat:{conversationId}` broadcast.
- **Sheets:** `BaseBottomSheet` (sibling-root nested pattern, `AccountSettings.tsx:471-510`) for
  the lightweight "create ticket" form; full-screen for the chat thread.
- **Push (consumer):** `app-mobile/src/services/oneSignalService.ts`.
- **Push (business):** `mingla-business/src/services/oneSignalService.ts` + `_shared/push-utils.ts`
  (per-app routing via `payload.app`).
- **Capability hook precedent:** `mingla-business/src/hooks/useCurrentBrandRole.ts` (React-Query,
  RLS-backed, short stale time) — template for `useSupportOperator`.

---

## Cross-lane flags

- **CF-C1 (naming):** UI may say "tickets" but schema/hooks must use `support_*` (NOT `tickets`,
  NOT `agents`) — collides with event ticketing + ARI `agent_*` (proposal §6.5/E1). Lane-C hook
  name proposed: `useSupportOperator`.
- **CF-C2 (push app routing):** any support push to a staffer MUST set `app:"business"`; to the
  requester `app:"consumer"`. No cross-app fallback (`push-utils.ts:100-110`). Lane A edge fn owns this.
- **CF-C3 (tab gate):** if a future "Support" TAB is wanted, `(tabs)/_layout.tsx:119`
  `visibleTabsForRank` + `navTabGate.ts:MIN_RANK_FOR_TAB` (strict-grep gated) must be extended to
  OR-in the brand-decoupled `support_operator` flag — they currently only understand brand rank.
- **CF-C4 (consumer notif pref):** `notification_preferences` is boolean COLUMNS (§6.5/E3) — a
  `support_replies` toggle is a new column or rides `messages`, not a new row type.
- **CF-C5 (no consumer notif screen):** consumer notif settings live inside the AccountSettings
  accordion, not a dedicated route — the support pref mounts there (`AccountSettings.tsx:714-776`).
