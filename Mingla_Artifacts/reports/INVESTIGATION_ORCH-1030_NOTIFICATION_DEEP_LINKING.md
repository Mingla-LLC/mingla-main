# INVESTIGATION — ORCH-1030 [Consumer app notification deep-linking]

**Mode:** INVESTIGATE (no fixes, no code — SPEC is the next phase)
**Date:** 2026-05-31
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1030-[notification-deep-linking]/` on branch `ORCH-1030-notification-deep-linking`
**Affected surfaces:** iOS-consumer, Android-consumer (`app-mobile/`)
**Skill:** mingla-forensics (INVESTIGATE)

---

## 0. Scope, intent, and out-of-scope (one line each)

- **Goal (locked this session):** every in-app + push notification in the CONSUMER app must open the **right screen + right container** (correct session / conversation / calendar entry / profile / event), not a generic tab or a coarse type-prefix fallback. Auto-scroll to the exact card/message within the container is explicitly **out of scope for v1**.
- **NOT in scope — business app** (`mingla-business/`): separate notification surface (its own OneSignal app id, `mingla-business://` scheme, `business.*`/`stripe.*` type prefixes filtered out of the consumer inbox per migration `20260511000003` lines 14-16). Different routing code entirely.
- **NOT in scope — buyer-web** (`mingla-business/` `/checkout`, `/e/...`, `/b/...`): anonymous web has no notification inbox and no push registration; nothing to deep-link into.
- **NOT in scope — admin-web** (`mingla-admin/`): admin does not render the consumer `notifications` feed; `notify-dispatch` is the producer, admin is not a consumer of taps.

---

## Phase 0 — Context ingested

- **Comms ledger** (`/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`): scanned all Active entries. No `BLOCK`/`WARN`/`FYI` row is addressed `to` ORCH-1030 or to `mingla-forensics` for this ORCH. COMMS-0017 (Samsung A72 reserved for ORCH-1016) noted — does not affect this source-level investigation. No ack required.
- **Prior artifacts** (read for context, not truth): `INVESTIGATION_ORCH-0788_BUYER_NOTIFICATION_DISPATCHER.md`, `IMPLEMENTATION_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md`, `SPEC_ORCH-0964_AMENDMENT_2_CONSUMER_BRAND_SCREEN_AND_DEEP_LINKS.md`, `INVESTIGATION_ORCH-0902_DEEP_COLLAB_DECK_CURRENT_STATE.md`. ORCH-0788/0975 built the dispatcher + redesigned the in-app sheet; neither closed the deep-link routing gaps this ORCH targets.
- **Migration chain for `notifications`:** grepped all migrations referencing `notifications`. The `deep_link` column + `data` JSONB + `type` index are defined by `20260511000003_b2a_v3_notifications.sql` (latest authoritative ALTER for `deep_link`; lines 39-64). There is **no DB enum/CHECK constraint on `notifications.type`** — `type` is free-text `text`. This is itself a finding (F-09).

---

## Phase 1 — Symptom

**Expected:** tapping any consumer notification (in-app row or push) lands on the exact screen + container the event happened in.
**Actual (operator report + source trace):** many notifications dead-end on a generic tab, fall back to coarse type-prefix routing, or carry no usable destination. Specifically reported and confirmed in scope: `collab_`/`session_` notifications route to Connections instead of Home.

---

## Phase 2 — Pipeline traced (both directions)

**Producer chain:** creation edge fn → `notify-dispatch` (inserts `notifications` row with `type`, `data.deepLink`, `actor_id`/`related_id`, then OneSignal push) → two consumers:
1. **In-app:** Supabase Realtime INSERT → `useNotifications` → `NotificationsSheet.tsx` (`handleCardPress` → `onNotificationTap`, lines 21/72) → `index.tsx` `handleNotificationNavigate` (lines 1017-1090).
2. **Push tap:** OneSignal `onNotificationClicked` → `index.tsx` `processNotification` (lines 413-486) + `NAV_TARGETS` map (lines 589-633).

**Shared destination layer:** `deepLinkService.ts` `parseDeepLink` (lines 27-124) → `executeDeepLink` (lines 128-173) → setState on the page switch + `setDeepLinkParams`.

**Terminal-state divergence (the core of this investigation):** `executeDeepLink` + `handleNotificationNavigate` call `setDeepLinkParams(params)`. That state **IS** forwarded to ConnectionsPage (`deepLinkParams` prop, index.tsx:2190/2447) and DiscoverScreen (2140/2412), but is **NOT** forwarded to LikesPage (render sites 2196/2465 pass only `calendarEntries`/`onShowQRCode` — `LikesPageProps` has no `deepLinkParams` field). ConnectionsPage consumes it (effect ConnectionsPage.tsx:2031-2089 opens the conversation thread when `tab==='messages'`). So **chat deep-links DO open the thread in-app**, but **calendar/review deep-links land Likes at its default tab** (the container is never opened). See corrected F-02.

**Production data truth (five-truth-layer Data leg — now resolved):** queried live `notifications` (107 rows, 12 distinct types). **`rows_with_deeplink = 0` — the top-level `deep_link` COLUMN is empty for every row.** Producers write the URL into `data.deepLink` (JSONB), not the `deep_link` column. The in-app handler reads `notification.data?.deepLink` (index.tsx:1018) so it works; the column added by migration `20260511000003` is **dead/unused for consumer notifications** (see F-15). Live consumer types present: paired_user_saved_card(44), session_member_joined(22), board_message_received(8), friend_request_accepted(6), pair_request_accepted(6), direct_message_received(5), collaboration_invite_received(5), board_card_saved(4), direct_card_message(3), pair_request_received(2), friend_request_received(1), + stripe_webhook_signature_failure(1, business/ops not consumer).

---

## Files read (manifest, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `supabase/migrations/20260511000003_b2a_v3_notifications.sql` | schema of `notifications.deep_link`/`data`/`type` |
| 2 | `app-mobile/src/services/deepLinkService.ts` (full) | parser + executor — what routes exist, what params emitted/consumed |
| 3 | `app-mobile/app/index.tsx` 1017-1090 | in-app `handleNotificationNavigate` |
| 4 | `app-mobile/app/index.tsx` 413-486, 589-673 | push `processNotification` + `NAV_TARGETS` + click/foreground listeners |
| 5 | `app-mobile/app/index.tsx` 71-117, 900-920, 2090-2410 | state decls (`pendingDeepLinkRef`, `deepLinkParams`, `pendingSessionOpen`), page render sites + props |
| 6 | `app-mobile/src/components/ConnectionsPage.tsx` 44-60 | accepted props (does it consume conversationId?) |
| 7 | `app-mobile/src/components/LikesPage.tsx` 1-28 | accepted props (does it consume entryId/tab?) |
| 8 | `app-mobile/src/components/NotificationsSheet.tsx` 21,72 | tap wiring |
| 9 | All `notify-*` / `send-*` / order/ticket/cancel/refund creators | type + deep_link + related/actor fields emitted |

---

## DESTINATION MATRIX (condensed; full evidence per row in §Findings)

Columns: **type** | **created at (file:line) — sets deep_link?** | **carries (data/related/actor)** | **CURRENT in-app dest** | **CURRENT push dest** | **CORRECT dest (right screen+container)** | **GAP**

Routing legend for "CURRENT": IA = `handleNotificationNavigate` (index.tsx 1017-1090); PUSH = `processNotification`+NAV_TARGETS.

| type | created — deep_link | carries | CURRENT in-app | CURRENT push | CORRECT (screen+container) | GAP |
|---|---|---|---|---|---|---|
| `collaboration_invite_received` | send-collaboration-invite:182 — `mingla://session/{sessionId}` (186) | data.sessionId/inviteId/inviterId; related=inviteId\|sessionId; actor=inviterId | **deepLink branch → `home` + opens session** (parser `session`→home + `openSessionId`; IA 1054-1061) | NAV_TARGETS `home` (600) → deepLink also present → parser→home+session | Home + CollabDeckSheet for sessionId | OK (deep_link works) |
| `collaboration_invite_accepted` / `_declined` | notify-invite-response:156 — `mingla://session/{sessionId}` (160) | related=inviteId; data.type=`collaboration_invite_response` | deepLink → home+session | NAV_TARGETS `home` (601-603) | Home + that session | OK |
| `board_card_matched` | notify-session-match:127 — `mingla://session/{sessionId}` (131) | data.sessionId/savedCardId/experienceId; related=savedCardId; actor | deepLink → home+session | **NO NAV_TARGETS entry for `board_card_matched`** → falls to `setCurrentPage(navigationTarget)` with undefined → but deepLink present so parser→home+session | Home + that session | OK in-app/push via deepLink; **NAV_TARGETS missing entry** (F-05 latent) |
| `session_locked` | notify-session-lock:86 — `mingla://session/{sessionId}` (99) | related=sessionId | deepLink → home+session | NAV_TARGETS `session_member_*`/`session_deleted`=home but **no `session_locked` key** → relies on deepLink | Home + that session | OK via deepLink; NAV_TARGETS gap (F-05) |
| `session_member_joined`/`_left`/`session_deleted` | **NO CREATOR FOUND** in edge fns | — | IA type-prefix `session_`→**connections (1068)** ← WRONG | PUSH NAV_TARGETS `home` (605-607) ← RIGHT | Home | **wrong-route-bug (in-app) + no-creator/orphan-type** (F-01, F-08) |
| `board_card_saved`/`_voted`/`_rsvp` | **NO CREATOR FOUND** | — | IA `board_card_`→home (1072) | PUSH NAV_TARGETS home (608-610) | Home + session | no-creator/orphan-type (F-08) |
| `board_message_received` | notify-message:178 — `mingla://chat/{conv}?type=group&sessionId=...` (149-153) | related=conversationId; actor=senderId | deepLink → parser `chat`→connections + `deepLinkParams{tab:messages,conversationId}` → ConnectionsPage effect (2031-2089) **opens the thread** ✓ | NAV_TARGETS `board_message_received`=home (615) ← contradicts deepLink (parser→connections+thread) | Connections → Messages tab → that conversation thread | **in-app OK; PUSH NAV_TARGETS→home disagrees** (F-06) |
| `board_message_mention` | notify-message:254 — `mingla://chat/{conv}?...&messageId=` (223-227) | related=messageId; actor | deepLink → connections + thread opens via effect ✓ (messageId scroll = v2) | NAV_TARGETS home (616) | that conversation thread | in-app OK; push disagrees (F-06) |
| `board_card_message` | notify-message:519 — `mingla://session/{sessionId}?card={savedCardId}` (522) | related=savedCardId; actor | deepLink → home+session (card param dead) | NAV_TARGETS `board_card_message`=home (617) | Home + session (card scroll = v2) | OK to container; card param dead (acceptable v1) |
| `direct_message_received` | notify-message:178 — `mingla://chat/{conv}?type=direct` (149) | related=conversationId; **actor=senderId** | **special-case: `direct_message_`+actor_id → `setPendingOpenDmUserId(actor)` → connections + opens DM** (IA 1047-1051) ← RIGHT | NAV_TARGETS `direct_message_received`=connections (612); deepLink parser `chat`→connections but conversationId dead → Connections tab, **DM not opened on push** | Connections → that DM thread | **in-app OK via actor_id; PUSH only lands Connections tab** (F-03) |
| `direct_card_message` | notify-message:472 — `mingla://messages/{conv}` (476) | related=messageId; actor | deepLink → parser `messages`→connections + `deepLinkParams{tab:messages,conversationId}` → ConnectionsPage effect opens thread ✓ | NAV_TARGETS **no `direct_card_message` key** → deepLink → thread (push) ✓ | that DM thread | OK in-app+push (NAV_TARGETS key cosmetic — deepLink carries it) |
| `message` (legacy, send-message-email) | legacy alias | — | type-prefix `direct_message_`? NO — bare `message` → final else → **home (1081)** | NAV_TARGETS `message`=connections (613) | that conversation | wrong/disagree (F-06) |
| `friend_request_received` / `friend_request` | send-friend-request-email:125 — `mingla://connections?tab=requests` (129) | related=requestId; actor=senderId | **special-case → connections + `pendingConnectionsPanel='friends'`** (IA 1034-1038) — opens Friends panel, **not Requests** | NAV_TARGETS connections (591,593); deepLink `connections?tab=requests` but tab param dead | Connections → Requests panel | **screen opens wrong panel** (tab=requests ignored; opens 'friends') (F-07) |
| `friend_request_accepted` / `friend_accepted` | send-friend-accepted-notification:113 — `mingla://connections?userId={accepterId}` (117) | related; actor=accepter | not in special-cases → deepLink → parser `connections` (no userId handling) → Connections tab; **`userId` param dropped** (parser passes it in params but no screen opens a profile-by-id from it) | NAV_TARGETS connections (592,594) | Connections + that friend's profile | partial — lands Connections, friend profile not opened; needs `profile/{id}` or connections `userId` consumption (F-07/F-10) |
| `pair_request_received` | notify-pair-request-visible:98 — `mingla://discover?pairRequest={id}` (102) | related=pairRequest.id; actor=sender | **special-case `pair_request_received`→connections (IA 1041-1043)** ← but deep_link says **discover** | NAV_TARGETS connections (595); deepLink→discover (parser `discover`) | the pair-request surface (discover pair UI per deep_link) | **in-app special-case overrides deep_link → connections, contradicts producer's discover target** (F-06) |
| `pair_request_accepted` / `pair_accepted` | send-pair-accepted-notification:119 — `mingla://discover` (123) | related; actor=accepter | special-case `pair_request_accepted`→connections (1041) | NAV_TARGETS connections (596) | discover (per producer) | in-app contradicts producer (F-06) |
| `paired_user_saved_card` | notify-pair-activity:130 — `mingla://discover?paired=true` (133) | related=cardId; **actor** | **special-case → connections + `viewingFriendProfileId=actor`** (IA 1022-1025) — opens friend profile, deep_link says discover | PUSH special-case (processNotification 463-474) → connections + friend profile | per producer = discover paired deck; per app = friend profile | in-app/push consistent with each other but **contradict deep_link** (F-06; product decision needed) |
| `paired_user_visited` | notify-pair-activity:167 — `mingla://discover?paired=true` (170) | related=visitId; actor | special-case (with holiday_reminder) → connections + friend profile (IA 1027-1031) | NAV_TARGETS connections (598) | friend profile or discover | F-06 |
| `holiday_reminder` | notify-holiday-reminder:136 — **NO deepLink** (only type+actor) | actor=recipientId | special-case → connections + friend profile (IA 1027-1031) | NAV_TARGETS connections (632) | friend profile (gift target) | missing-deep-link-at-creation (works via in-app special-case + actor; push lands Connections tab only) (F-04) |
| `birthday_reminder` | notify-birthday-reminder:83 — **NO deepLink** (related+actor=birthday.user_id) | related=user_id; actor=user_id | **no special-case, no deepLink → final else → home (1081)** | **NO NAV_TARGETS key → undefined target**, no deepLink → falls through | friend's profile (profile-by-id) | **missing-deep-link + no profile-by-id route + NAV_TARGETS gap** (F-04, F-10) |
| `friend_request_received` push Accept/Decline | handled in processNotification handlePushAccept/Decline (509-574) | — | n/a | action buttons accept/decline | (action, not nav) | OK |
| `calendar_reminder_tomorrow` / `_today` | notify-calendar-reminder:122/162 — `mingla://calendar/{entry.id}` (125/165) | — | deepLink → parser `calendar`→`{page:likes,params:{tab:calendar,entryId}}` → **LikesPage never receives deepLinkParams (not a prop)** → lands Likes last-used tab, entryId dropped | NAV_TARGETS `likes` (625-626) | Likes → Calendar tab → that entry | **screen-doesnt-consume-param (Likes)** (F-02) |
| `visit_feedback_prompt` | notify-calendar-reminder:234 — `mingla://review/{experienceId}` (237) | — | deepLink → parser `review`→ executor **hardcodes `setCurrentPage('likes')`** (executeDeepLink 163-165), experienceId dead | NAV_TARGETS `likes` (630) | review screen for experienceId | **parser emits `review` page but executor downgrades to likes; experienceId never consumed → no review opens** (F-02 variant) |
| `referral_credited` | notify-referral-credited:52 — `mingla://profile?tab=subscription` (55) | related; actor | deepLink → parser `profile`→profile (tab dead) | NAV_TARGETS home (628) ← contradicts deepLink (profile) | Profile → subscription | partial: in-app lands Profile (tab ignored); push says home (F-06) |
| `trial_ending` | notify-lifecycle:140 — `mingla://subscription` (143) | — | type-prefix? no; deepLink `subscription`→ paywall (executor 159-160) | NAV_TARGETS home (619); IA also special `trial_ending`→paywall (1078) | paywall | OK |
| `onboarding_incomplete` | notify-lifecycle:99 — `mingla://onboarding` (102) | — | deepLink `onboarding`→ parser returns page `onboarding` → executor default → `setCurrentPage('onboarding')` | **NO NAV_TARGETS key**; deepLink present | onboarding flow | OK via deepLink (verify 'onboarding' is a real page id — see F-11) |
| `re_engagement` (+3d/7d variants) | notify-lifecycle:183/245 — `mingla://home` or `mingla://connections` (186/236) | — | deepLink → home or connections | NAV_TARGETS `re_engagement`/`_3d`/`_7d`=home (620-622) | home/connections | OK |
| `weekly_digest` | notify-lifecycle:325 — `mingla://home` (328) | — | deepLink→home; IA also `weekly_digest`→home (1076) | NAV_TARGETS home (623) | home | OK |
| `tag_along_accepted` | accept-tag-along:359 — `mingla://session?id={collabSessionId}` (363) | related=collabSessionId | deepLink → parser `session` case expects `pathSegments[1]` (path form `session/{id}`), but this is **query form `session?id=`** → `openSessionId=undefined` → home with no session opened | **NO NAV_TARGETS key** → deepLink → home, no session | Home + that session | **producer emits query-form `session?id=` but parser only reads path-form `session/{id}`** (F-12 variant: param-shape mismatch) |
| `tag_along_match` | accept-tag-along:388 — `mingla://session?id={collabSessionId}` (392) | related=collabSessionId | same query-form mismatch → home, no session | NO NAV_TARGETS key | Home + that session | F-12 variant (param-shape mismatch) |
| `tag_along_received` | send-tag-along:196 — `mingla://discover?tab=near-you` (202) | related=newRequest.id; actor=senderId | deepLink → discover (tab param to DiscoverScreen via discoverDeepLinkParams) | NO NAV_TARGETS key → deepLink → discover | discover near-you | OK (verify DiscoverScreen consumes tab=near-you) |
| `installment_reminder` | send-installment-reminder:102 — **NO data.deepLink** (only relatedId=orderId) | related=orderId | no deepLink + no special-case → final else → **home (1081)** | NO NAV_TARGETS key + no deepLink → falls through (nothing) | order/ticket detail | **missing-deep-link-at-creation + no order-detail route** (F-04/F-12) |
| `order_canceled` / `order_refunded` / `trip_booking_canceled` / ticket confirmations | cancel-order:116 / refund-order:486 / cancel-trip-booking:627 / ticket-confirmation-dispatch — these write to the **`ticket_order_notifications` queue table, NOT the consumer `notifications` table** | n/a (separate buyer-email/push pipeline, ORCH-0785) | **NOT in the consumer in-app inbox** — these are buyer transactional email/push, dispatched by `ticket-confirmation-dispatch`; they do not create `notifications` rows and do not appear in `NotificationsSheet` | n/a | buyer order/ticket detail (their own pipeline) | **out of this ORCH's in-app inbox scope** (observation F-16) — but their push deep-links (if any) still flow through the same parser; verify separately if buyer push taps are in scope |

> **Coverage note (RESOLVED):** matrix enumerates every consumer `type` at a creation site + every `NAV_TARGETS` key. **Live-DB cross-check completed:** 107 rows / 12 distinct types in production; `deep_link` column empty on all (producers use `data.deepLink`). The order/ticket money notifications use a **separate** `ticket_order_notifications` queue (not the consumer inbox), so they are largely out of the in-app-tap scope this ORCH targets (F-16).

---

## Phase 3-5 — Findings (classified, six-field where root-cause)

### 🔴 F-01 — `session_`/`collab_` in-app fallback routes to Connections, not Home (the reported bug)
- **File+line:** `app-mobile/app/index.tsx:1068-1069`
- **Exact code:** `} else if (type.startsWith('collaboration_') || type.startsWith('session_')) {` → `setCurrentPage('connections');`
- **What it does:** for any `collaboration_*`/`session_*` notification that reaches the **type-prefix fallback** (i.e. has no `data.deepLink`), the in-app handler navigates to **Connections**.
- **What it should do:** collaboration/session activity lives on **Home** (CollabDeckSheet mounts from Home; `parseDeepLink('session/..')` correctly returns `page:'home'`, deepLinkService 58-62). The fallback must go to `home`.
- **Causal chain:** notification with no deepLink (e.g. the orphan `session_member_joined`, or any future collab type that ships without a deep_link) → `handleNotificationNavigate` deepLink branch skipped (1054) → type-prefix fallback → line 1068 → Connections → user sees Connections, never the session → "tapped a collab notification, landed on the wrong tab."
- **Disagreement proof (root-cause of the *disagreement*):** the **push** side disagrees with the in-app side. `NAV_TARGETS` maps every `collaboration_*`/`session_*` key to **`home`** (index.tsx 600-607), which is correct. So the SAME notification tapped from the system tray → Home, but tapped from the in-app sheet → Connections. The bug is **in-app-only**; `NAV_TARGETS` is right; they **disagree**.
- **Verification step:** create a notification row with `type='session_member_joined'` and `data` lacking `deepLink`; tap in-app sheet → observe Connections (bug); tap the push → observe Home (correct). Or unit-trace: assert `handleNotificationNavigate({type:'session_member_joined', data:{}})` calls `setCurrentPage('connections')` while `NAV_TARGETS['session_member_joined']==='home'`.

### 🟠 F-02 (CORRECTED) — `deepLinkParams` reaches Connections + Discover but NOT Likes → calendar/review deep-links don't open the container
- **Corrected from initial read:** `deepLinkParams` is NOT globally dead. It is forwarded to **ConnectionsPage** (`deepLinkParams={connectionsDeepLinkParams}` index.tsx:2190/2447; prop declared ConnectionsPage.tsx:350) and **DiscoverScreen** (2140/2412). ConnectionsPage **consumes** it (effect ConnectionsPage.tsx:2031-2089: when `tab==='messages'`, resolves `conversationId`/`eventId`/`claimToken` and calls `handleSelectConversation` → opens the thread). **So chat + DM + trip/order-chat deep-links DO open the right container in-app.**
- **The real gap:** **LikesPage does NOT receive `deepLinkParams`.** Render sites index.tsx:2196 + 2465 pass only `calendarEntries`, `onShowQRCode`, `userPreferences`. `LikesPageProps` (LikesPage.tsx:36-…) has **no `deepLinkParams`/`entryId`/`tab` prop** — `LikesTab` is internal `useState` (line 94) seeded from a Zustand snapshot, not from a deep-link.
- **File+line:** `index.tsx:2196`, `:2465` (`<LikesPage>` render — no `deepLinkParams`); `LikesPage.tsx:36-78` (props interface lacks it).
- **What it does:** tap `calendar_reminder_tomorrow`/`calendar_reminder_today` → parser `calendar`→`{page:'likes', params:{tab:'calendar', entryId}}` → executor `setCurrentPage('likes')` (NOTE: executor case `likes` at deepLinkService 153-157 just sets page, ignores tab too) + `setDeepLinkParams` → LikesPage mounts at its **last-used tab**, entryId dropped → **Calendar entry never opened**.
- **What it should do:** LikesPage must accept `deepLinkParams`/initial-tab + open the Calendar tab and scroll-to/select `entryId` (entry-select = v1; scroll = v2 per scope).
- **Causal chain:** calendar reminder tap → Likes default tab, not the entry.
- **Class:** screen-doesnt-consume-param (Likes only; Connections is fine).
- **Verification:** tap a `calendar_reminder_*` in-app → lands Likes at last-used tab, not Calendar+entry; confirm `<LikesPage>` render has no `deepLinkParams` prop (grep proven).

### 🔴 F-03 — DM push tap lands on Connections tab, not the thread (in-app works via actor_id, push does not)
- **File+line:** in-app `index.tsx:1047-1051` (`type.startsWith('direct_message_') && actor_id` → `setPendingOpenDmUserId(actor)` → opens thread). Push: `processNotification` 475-481 runs `executeDeepLink(parseDeepLink(deepLink))` with `deepLink=mingla://chat/{conv}?type=direct`; parser → `page:'connections', params:{conversationId}` → conversationId is dead (F-02) → Connections tab only. `processNotification` has **no `direct_message_` + actor_id special-case** (only `paired_user_saved_card` is special-cased at 463-474).
- **What it should do:** push tap must open the same DM thread the in-app tap opens.
- **Causal chain:** background DM push tap → processNotification → deepLink branch → Connections, no thread.
- **Verification:** send a DM push, tap from tray → Connections (no thread); tap the in-app row → thread opens. Asymmetry proves it.

### 🟠 F-04 — `holiday_reminder` and `birthday_reminder` created with NO deep_link
- **holiday_reminder:** `notify-holiday-reminder/index.ts:136` emits `type` + `actorId` only (no `data.deepLink`). In-app saved by special-case (1027-1031 → friend profile via actor). **Push** has NAV_TARGETS `connections` (632) → Connections tab only, friend profile not opened.
- **birthday_reminder:** `notify-birthday-reminder/index.ts:83` emits `related_id`+`actor_id` (=birthday user) but **no deepLink and no in-app special-case** → in-app final else → **home (1081)**; **no NAV_TARGETS key** → push falls through with no target. Birthday notification opens nothing useful.
- **Should:** both should deep-link to the friend's profile (requires a profile-by-id route — F-10).
- **Class:** missing-deep-link-at-creation (+ depends on F-10).

### 🟠 F-05 — `NAV_TARGETS` missing keys for several real push types
- **File+line:** `index.tsx:589-633`. Missing keys: `board_card_matched`, `session_locked`, `direct_card_message`, `birthday_reminder`, `onboarding_incomplete`, `tag_along_accepted`, `installment_reminder`, `order_canceled`, `order_refunded`, `trip_booking_canceled`, `ticket_purchase_confirmation`.
- **What it does:** for these, push tap relies entirely on `data.deepLink`. Where deepLink exists + parses, fine; where deepLink is absent (birthday) or parses to null (orders, F-12), the push tap **does nothing** (processNotification 482-485 falls to `navigationTarget` which is `undefined`).
- **Class:** contributing factor (the SPEC's own comment at 585 says "Every notification type MUST have an entry here").

### 🟠 F-06 — In-app special-cases / `NAV_TARGETS` contradict the producer's `deep_link` for several types
Concrete disagreements proven:
- `board_message_received`: producer deepLink → connections(thread); NAV_TARGETS → **home** (615).
- `board_message_mention`: deepLink → thread; NAV_TARGETS → **home** (616).
- `referral_credited`: deepLink → **profile** (55); NAV_TARGETS → **home** (628).
- `pair_request_received`: deepLink → **discover** (102); in-app special-case → **connections** (1041).
- `paired_user_*`: deepLink → **discover?paired=true**; in-app + push special-case → **connections + friend profile**.
- `message` (legacy): in-app bare-`message` → home (else, 1081); NAV_TARGETS → **connections** (613).
- **Class:** root cause of inconsistency between the three routing authorities (producer deep_link vs in-app handler vs push NAV_TARGETS). The SPEC must pick ONE source of truth per type (recommend: producer `deep_link` is canonical; in-app + push both execute it; special-cases only where deep_link can't express the target, e.g. profile-by-id).

### 🟠 F-07 — Friend-request panel mismatch
- `friend_request_received` deep_link is `connections?tab=requests` (send-friend-request-email:129) but the in-app special-case forces `pendingConnectionsPanel='friends'` (index.tsx:1036) → opens the **Friends** panel, not **Requests**. `tab=requests` param is dead (F-02). `friend_request_accepted` has no special-case → lands Connections, friend profile not opened.
- **Class:** screen-doesnt-consume-param / wrong container.

### 🟠 F-08 — Orphan types: keyed in routing but no creator found
- `session_member_joined`, `session_member_left`, `session_deleted`, `board_card_saved`, `board_card_voted`, `board_card_rsvp`, `collaboration_invite_sent` are in `NAV_TARGETS` (605-610, 604) but **no edge fn creates them** (grep of all `notify-*`/`send-*`). They may be created by DB triggers (not found in the migration grep) or be dead. `session_deleted` is also referenced by the foreground push handler (index.tsx:661).
- **Class:** no-creator/orphan-type — SPEC must confirm each is live (DB trigger?) or remove.

### 🟠 F-09 — `notifications.type` has no DB enum/constraint
- `20260511000003` adds `deep_link` + a `type` btree index but **no CHECK/enum** on `type`. There is no single registry of valid consumer types; the type set is implied across ~15 edge fns + the `NAV_TARGETS` map + the parser. This is why orphans (F-08) and missing-route types (F-05) can drift undetected.
- **Class:** hidden flaw (enables the whole class of routing drift). SPEC should consider a canonical type registry + strict-grep gate.

### 🔴 F-10 — No `profile-by-id` route and no `event`/`experience`-detail route in the parser
- **File+line:** `deepLinkService.ts:51-119` switch has `profile` (103, opens own Profile, no id) but **no `profile/{userId}`** and **no `event`/`experience` detail** case.
- **What it does:** types that point at a *person* (birthday_reminder, friend_request_accepted, paired_user_*) or an *event/experience* have no parser route to open that specific entity. The app works around person-targets with the `viewingFriendProfileId` actor_id special-cases (1022-1031) — but only for the 3 hard-coded types, and only in-app; there is no general URL form.
- **Should:** add `mingla://profile/{userId}` → ViewFriendProfileScreen by id (the screen already exists: `viewingFriendProfileId` prop on ConnectionsPage, ViewFriendProfileScreen imported index.tsx:32), and an event/experience-detail route if any notification targets one.
- **Class:** root cause for the "points at a person/event but has no destination route" gap called out in the dispatch.

### 🟠 F-12 (CORRECTED) — Parser route/param-shape gaps
- **`session?id=` query-form mismatch (live):** `accept-tag-along` emits `mingla://session?id={collabSessionId}` (lines 363, 392) but the parser `session` case reads the **path** segment `pathSegments[1]` (deepLinkService 58-62), i.e. it expects `mingla://session/{id}`. The query form yields `openSessionId=undefined` → Home opens with no session. `tag_along_accepted` + `tag_along_match` both hit this. **Class:** producer/parser param-shape mismatch (root cause for tag-along nav).
- **`orders/{id}` (no `/chat`) returns null:** parser only matches `orders/{id}/chat` (deepLinkService 79-92); a bare `orders/{id}` returns null → no-op. No CONSUMER-inbox notification currently emits this (the order/ticket money types use the separate `ticket_order_notifications` queue, F-16), so this is **latent** unless a future consumer notification points at an order detail. **Class:** hidden flaw / parser-route-missing (latent).
- **`installment_reminder`** (send-installment-reminder:102) creates a CONSUMER `notifications` row with **no `data.deepLink`** → in-app final else → home; no order-detail route exists anyway. **Class:** missing-deep-link + no order-detail route.

### 🟠 F-11 — `review` parser route is downgraded; `experienceId` never opens a review
- `visit_feedback_prompt` (notify-calendar-reminder:234) emits `mingla://review/{experienceId}`. Parser returns `{page:'review', params:{experienceId}}` (deepLinkService 98-102) but the **executor hardcodes `setCurrentPage('likes')`** for `review` (deepLinkService 163-165, with comment "review modal is triggered by usePostExperienceCheck") and drops `experienceId`. → tap lands Likes, no review opens for that experience.
- `onboarding` parser case returns `{page:'onboarding'}`; executor default `setCurrentPage('onboarding')` — confirm `'onboarding'` is a handled page id (likely fine via the onboarding gate; verify in SPEC).
- **Class:** screen-doesnt-consume-param (review).

### 🟡 F-13 (CORRECTED) — Two pre-auth deferral paths exist and both work; the gap is that OneSignal push taps use the weaker in-memory ref, not the persistent store
- **Corrected from initial read.** There are TWO deferral mechanisms, both functional:
  1. **OS `Linking` deep-links** → `handleDeepLink` (index.tsx:1643): if `!user` and not an OAuth callback, persists `{url,ts}` to AsyncStorage `mingla_deferred_deeplink` (1654-1655); a dedicated effect (852-874) replays it after `isAuthenticated && !isLoadingAuth && !showOnboardingFlow`, with a 24h staleness discard. **This path survives app-kill and onboarding — it is sound.**
  2. **OneSignal push taps** → `processNotification` (index.tsx:417-424): if `!userIdRef.current`, stashes the deepLink in the **in-memory `pendingDeepLinkRef`** (420/422), replayed by the effect at 766-794 (which DOES read it — `pendingDeepLinkRef.current` at 768/769; my earlier "0 reads" was a miscount). It works **only within the same process** — it does NOT persist to AsyncStorage, so a push tapped while logged out that triggers a cold app launch (the common case for a killed app) loses the destination, and it is gated on `user?.id` (auth) but **NOT on onboarding completion** — it could fire mid-onboarding.
- **The gap (narrower than first stated):** push-tap deferral is in-memory-only and not onboarding-gated, whereas OS-link deferral is persistent + onboarding-gated. The two should be unified onto the persistent, onboarding-gated path so a push tapped while logged out (cold launch through onboarding) lands correctly.
- **Class:** hidden flaw (push-tap deferral weaker than link deferral; inconsistent two-mechanism design).
- **Verification:** kill app, tap a push while logged out → cold launch → in-memory ref is empty on fresh process → destination lost; compare to OS-link path which replays from AsyncStorage.

### 🔵 F-15 (observation) — `notifications.deep_link` COLUMN is dead for consumer notifications
- Live DB: 0 of 107 rows have a non-null `deep_link` column value. Every producer writes the URL to `data.deepLink` (JSONB); every consumer reads `notification.data?.deepLink` (index.tsx:1018) or push `data.deepLink` (428). The `deep_link` column added by `20260511000003:43` is unused by the consumer path (it was intended for the business app per the migration comment). **Class:** observation — the SPEC's canonical-deep-link decision should standardize on `data.deepLink` (already the de-facto contract) and either populate or formally retire the column for consumer rows.

### 🔵 F-16 (observation) — Order/ticket money notifications are a SEPARATE pipeline, not the consumer inbox
- `cancel-order` (116), `refund-order` (486), `cancel-trip-booking` (627/646), and the ticket confirmation flow write to **`ticket_order_notifications`** (consumed by `ticket-confirmation-dispatch`, ORCH-0785), which sends buyer **email/push** — they do NOT insert into the consumer `notifications` table and do NOT render in `NotificationsSheet`. So order-cancel/refund/booking notifications are **out of the in-app-inbox deep-link scope** of this ORCH. If buyer **push taps** for these are in scope, their deep-link templates still flow through the same `parseDeepLink`/`processNotification` and must be verified separately (and `orders/{id}` would hit the F-12 null route). **Class:** observation / scope clarification.

### 🔵 F-14 (observation) — Two normalization quirks in the parser
- `parseDeepLink` query parser (deepLinkService 41-46) drops any pair whose value is empty (`if (key && value)`) — flags like `?paired` (no `=true`) would be lost; current producers always send `=value` so not a live bug, but brittle.
- `chat` case sets `chatType: params.type ?? 'group'` then spreads `...params` which re-overrides with the raw `type` (deepLinkService 68-78) — harmless today, noted for SPEC cleanup.

---

## Phase 4 — Five-truth-layer cross-check (key contradiction)

| Layer | Finding |
|---|---|
| **Docs** | notify-message header (108-110) documents `mingla://chat/<conv>?...` as the DM/group deep-link contract. Comment at index.tsx:585 asserts "Every notification type MUST have an entry" in NAV_TARGETS. |
| **Schema** | `notifications.deep_link` + `data` JSONB exist; **no `type` constraint** (F-09). |
| **Code** | Producers emit correct `mingla://` URLs; **consumer drops every param** because `deepLinkParams` reaches no screen (F-02), the parser lacks `profile/{id}`, `event`, and `orders/{id}` routes (F-10/F-12), and in-app fallback misroutes `session_` (F-01). |
| **Runtime** | Not exercised on device this session (source-only — see Confidence). Behavior inferred from proven static wiring + live data shape. |
| **Data** | **RESOLVED:** 107 rows / 12 distinct consumer types in prod; `deep_link` COLUMN null on all (producers use `data.deepLink` — F-15). `session_member_joined`(22) is a real, emitted orphan-routed type that has no found edge creator (F-08) — confirms it's DB-trigger-origin or legacy; either way it's live and currently in-app-misroutes to Connections (F-01). |

**Contradictions located:** (1) the `deep_link` schema column says "store the URL here" but producers + consumers use `data.deepLink` (F-15). (2) Producers emit correct `mingla://` URLs and the in-app handler routes chat/session correctly — but **(a)** the in-app type-prefix fallback sends `session_`/`collab_` to Connections (F-01), **(b)** LikesPage never receives `deepLinkParams` so calendar/review don't open the container (F-02), **(c)** push `NAV_TARGETS` contradicts several producer deep-link targets (F-06), and **(d)** the parser doesn't read query-form `session?id=` or `orders/{id}` (F-12) and downgrades `review` (F-11). The producers are mostly right; the **consumer routing layer is fragmented across 3 authorities** and has per-screen param-consumption gaps.

---

## Phase 5.5 — Outcome & journey step-back

**User's actual goal:** "I got pinged about X; tapping should take me straight to X." X = a session, a chat thread, a calendar plan, a friend, an order.

**Where reality diverges (by journey):**
1. Tap collab/session ping in-app (no deepLink, e.g. `session_member_joined`) → Connections (F-01), not the session. **This is the reported bug.**
2. Tap calendar/review ping → Likes default tab (F-02 Likes-only / F-11), not the entry/review. (Chat/DM/trip-chat DO open the thread in-app — F-02 corrected.)
3. Tap DM **push** (from tray) → opens the thread via deepLink ✓ in-app; but several push types' `NAV_TARGETS` contradict the producer deep-link (F-06).
4. Tap birthday/holiday/pair ping → friend profile in-app via actor_id special-case (works), but deep_link says `discover` (producer/app disagreement, F-06) and there is no general `profile/{id}` route (F-10); birthday has no special-case → home (F-04).
5. Tap tag-along ping → Home with no session (query-form `session?id=` not parsed, F-12).
6. Tap a push while logged out then cold-launch through onboarding → in-memory ref lost; OS-link path persists but push path doesn't (F-13 corrected).

**Does fixing only the reported node (F-01) deliver the outcome?** No. F-01 fixes the session_/collab_ fallback. The full outcome additionally requires: wiring `deepLinkParams` into **LikesPage** (F-02), the `review` executor + `profile/{id}` + query-form `session?id=` parser routes (F-11/F-10/F-12), deep_link backfill for birthday/holiday/installment (F-04), **one canonical routing authority** to reconcile producer deep-link vs in-app special-cases vs push `NAV_TARGETS` (F-06), unifying push deferral onto the persistent onboarding-gated path (F-13), and standardizing on `data.deepLink` (F-15). **The SPEC must cover all of these.**

---

## Phase 6 — Blast radius (files/functions/screens the fix will touch)

**Consumer app (in scope):**
- `app-mobile/app/index.tsx` — `handleNotificationNavigate` (1017-1090, fix F-01 fallback `session_`/`collab_`→home, F-06 reconcile, F-07 friend panel), `processNotification` + `NAV_TARGETS` (413-486, 589-633, fix F-06 reconcile, F-05 fill keys), unify push deferral onto persistent path (417-424 vs 852-874, F-13), pass `deepLinkParams`+initial-tab to `<LikesPage>` (2196/2465, F-02).
- `app-mobile/src/services/deepLinkService.ts` — add `profile/{id}` route, accept query-form `session?id=` (F-12 tag-along), fix `review` executor to open the review for `experienceId` (F-11), add `orders/{id}` if buyer-push in scope (F-12 latent); standardize on `data.deepLink` (F-15).
- `app-mobile/src/components/LikesPage.tsx` — add `deepLinkParams`/initial-tab prop; open Calendar tab + select `entryId` (F-02).
- `app-mobile/src/components/ConnectionsPage.tsx` — already consumes `deepLinkParams` for chat (2031-2089, no change needed there); add Requests-panel handling for `tab=requests` (F-07) if friend-request panel correction is wanted.
- `app-mobile/src/screens/Trip/…` / review screen + `ViewFriendProfileScreen` — invoked by-id from the new routes (F-10/F-11).
- `app-mobile/src/components/NotificationsSheet.tsx` — no change expected (tap wiring already forwards to `onNotificationNavigate`); verify only.

**Backend (in scope — deep_link backfill):**
- `supabase/functions/notify-birthday-reminder/index.ts`, `notify-holiday-reminder/index.ts` — add `data.deepLink` (`mingla://profile/{userId}`) (F-04).
- Optional canonical type registry + strict-grep gate (F-09).

**Producers to confirm/align (F-06 product decision):** `notify-pair-activity`, `notify-pair-request-visible`, `notify-referral-credited`, `notify-message` (board_message NAV_TARGETS), and `NAV_TARGETS` entries.

**Out of scope (confirmed):** business app, buyer-web, admin-web (per §0).

---

## Root-cause root-of-roots

There are **three** independent authorities deciding a notification's destination — the producer's `data.deepLink`, the in-app `handleNotificationNavigate` (special-cases + type-prefix fallback), and the push `NAV_TARGETS` map — and they **disagree** for several types (F-06). The shared param mechanism (`deepLinkParams`) reaches Connections + Discover and works there, but **not LikesPage** (F-02), and the parser lacks routes for query-form sessions, profile-by-id, and order detail (F-10/F-12) and downgrades review (F-11). The reported `session_`/`collab_`→Connections bug (F-01) is the most visible symptom; the deeper issue is the fragmented 3-authority routing layer with per-screen param gaps. **Recommended SPEC direction:** make the producer `data.deepLink` the single canonical authority, have BOTH in-app and push execute it through one shared `parseDeepLink`/`executeDeepLink`, reduce `NAV_TARGETS` to a last-resort no-deepLink fallback that AGREES with the parser, and ensure every destination screen consumes its container param.

---

## Confidence

**Overall: PROVEN on code wiring + data shape; capped at PROBABLE on runtime feel pending sim repro.**
- F-01 (the reported bug), F-02 (Likes-only), F-06, F-11, F-12, F-15 are **PROVEN** by source (six-field) + the live-DB Data leg (107 rows, deep_link column empty, session_member_joined live).
- F-03, F-04, F-05, F-07, F-08, F-10, F-16 are **PROVEN at the static/wiring + data layer** (creation file:line + parser/executor + page-prop interfaces + live type list all read).
- F-13 **downgraded to hidden flaw (PROVEN corrected)** after reading the real persistent deferral path (1643/852-874) and the actual `pendingDeepLinkRef` read at 768 — my initial "never replayed / no AsyncStorage key" was a miscount and is retracted in the corrected finding.
- **Capped:** **GAP-RUNTIME** — no on-device/sim repro this session (Prime Directive 7: source-only reasoning on described UI behavior caps the *runtime feel* at `probable`; the *code-path* findings are proven). **The SPEC/IMPLEMENT phase MUST run the live-fire repro on iOS sim + Android emulator** for the session→Connections misroute and the calendar/Likes gap before CLOSE.
- **Corrections made mid-investigation after the Data leg resolved:** initial draft over-stated F-02 (claimed deepLinkParams globally dead — it reaches Connections/Discover, only Likes is unwired), F-13 (claimed no persistent deferral — there is one), and order-notification rows (they use a separate `ticket_order_notifications` queue, F-16). All corrected above.

---

## Discoveries for orchestrator (side issues)

1. **F-09 / type registry:** `notifications.type` is unconstrained free-text; no canonical consumer-type registry. Recommend a follow-up to add a registry + strict-grep gate so routing drift (orphans, missing NAV_TARGETS) is caught in CI. Could fold into ORCH-1030 SPEC or spin a small follow-up.
2. **F-08 orphan types:** `session_member_joined/left`, `session_deleted`, `board_card_saved/voted/rsvp`, `collaboration_invite_sent` are routed but have no found creator — confirm DB-trigger origin or remove. Needs a DB-trigger grep the SPEC phase should complete.
3. **ticket-confirmation-dispatch deepLink template** (`deepLinkForOrder`, line 253) not fully resolved this pass — confirm whether it emits `mingla://orders/{id}` (→ F-12 null) or a working form.
