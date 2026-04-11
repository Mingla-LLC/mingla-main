# Analytics & Notification Architecture (ORCH-0390 Dispatch 2)

> Date: 2026-04-11
> Verified by: Forensic code read (every call site traced)

---

## Summary

| Category | Count |
|----------|-------|
| AppsFlyer events | **25** (24 client + 1 S2S) |
| Mixpanel tracking methods | **33** (28 track methods + 5 core methods) |
| Mixpanel methods actually called | **17** (11 are dead/never called) |
| OneSignal notification types | **29** |
| Identity lifecycle gaps | **3** (AppsFlyer no logout, Mixpanel deferred logout, no resume handlers) |
| Cross-service parity gaps | **19** (actions tracked in one service but not the other) |

---

## 1. AppsFlyer Event Map (25 events)

### Authentication & Onboarding

| # | Event Name | File:Line | When Fired | Properties |
|---|-----------|-----------|-----------|------------|
| 1 | af_login | index.tsx:322 | Returning user authenticates | af_login_method (apple/google) |
| 2 | af_complete_registration | index.tsx:324 | New user first auth (pre-onboarding) | af_registration_method, country |
| 3 | af_tutorial_completion | OnboardingFlow.tsx:278 | Onboarding completed | af_success, af_content, gender, country |
| 4 | af_start_trial | OnboardingFlow.tsx:284 | Trial started at onboarding end | af_trial_type (elite_7day), af_duration (7) |
| 5 | onboarding_step_completed | OnboardingFlow.tsx:706 | Each onboarding step/substep completed | step, step_name, substep |

### Card Interactions

| # | Event Name | File:Line | When Fired | Properties |
|---|-----------|-----------|-----------|------------|
| 6 | af_content_view | SwipeableCards.tsx:1083 | Card expanded to view details | af_content_type, af_content_id, af_price, source, rating |
| 7 | af_add_to_wishlist | SwipeableCards.tsx:1150 | Card swiped right (saved) | af_content_type, af_price, af_content_id |
| 8 | card_dismissed | SwipeableCards.tsx:1156 | Card swiped left (dismissed) | af_content_type |

### Scheduling & Calendar

| # | Event Name | File:Line | When Fired | Properties |
|---|-----------|-----------|-----------|------------|
| 9 | experience_scheduled | SavedTab.tsx:1435 | Saved card scheduled to date | af_content_type, af_date, source, af_content_id |
| 10 | experience_rescheduled | CalendarTab.tsx:424 | Calendar entry rescheduled | af_content_type, new_date, date_option |

### Sharing

| # | Event Name | File:Line | When Fired | Properties |
|---|-----------|-----------|-----------|------------|
| 11 | af_share (copy_message) | ShareModal.tsx:115 | User copies experience as message | af_content_type: 'copy_message' |
| 12 | af_share (social) | ShareModal.tsx:127 | User shares to social platform | af_content_type: platform name |
| 13 | af_share (copy_link) | ShareModal.tsx:370 | User copies shareable link | af_content_type: 'copy_link' |

### Preferences

| # | Event Name | File:Line | When Fired | Properties |
|---|-----------|-----------|-----------|------------|
| 14 | preferences_updated | PreferencesSheet.tsx:863 | Preferences saved | is_collaboration, categories_count, intents_count |

### Social & Collaboration

| # | Event Name | File:Line | When Fired | Properties |
|---|-----------|-----------|-----------|------------|
| 15 | af_invite | useFriends.ts:220 | Friend request sent | af_type: 'friend_request' |
| 16 | friend_request_accepted | FriendRequestsModal.tsx:87 | Friend request accepted | source: 'notification' |
| 17 | pair_request_sent | usePairings.ts:64 | Pair request sent | (empty) |
| 18 | pair_request_accepted | usePairings.ts:162 | Pair request accepted | (empty) |
| 19 | collaboration_session_created | CollaborationSessions.tsx:301 | New session created | invited_count |
| 20 | collaboration_invite_sent | InviteParticipantsModal.tsx:225 | Invites sent to friends | session_id, invited_count, success_count |
| 21 | session_switched | CollaborationSessions.tsx:264/476 | Mode switched (session/solo) | mode |

### Subscription & Revenue

| # | Event Name | File:Line | When Fired | Properties |
|---|-----------|-----------|-----------|------------|
| 22 | af_subscribe | useRevenueCat.ts:151 | Subscription purchased | af_revenue, af_currency, af_content_type, af_content_id, af_quantity |
| 23 | trial_expired_no_conversion | useSubscription.ts:192 | Trial expires without paying | trial_days |
| 24 | paywall_viewed | CustomPaywallScreen.tsx:111 | Paywall screen shown | trigger |

### Server-to-Server

| # | Event Name | File:Line | When Fired | Properties |
|---|-----------|-----------|-----------|------------|
| 25 | referral_completed | process-referral/index.ts:136 | Referral credited (S2S via API) | referred_user_id |

---

## 2. Mixpanel Event Map (33 methods, 17 active)

### Active Methods (called from codebase)

| # | Method | Event Name | Called From | User Action |
|---|--------|-----------|------------|-------------|
| 1 | initialize() | — | index.tsx:251 | App startup |
| 2 | trackLogin() | "Login" | index.tsx:922 | User authenticates (also calls identify + setUserProperties) |
| 3 | trackLogout() | "Logout" | AppStateManager.tsx:760 | Sign-out (also calls reset()) |
| 4 | trackScreenViewed() | "Screen Viewed" | index.tsx:915 | Navigation to any page |
| 5 | trackPreferencesReset() | "Preferences Reset" | PreferencesSheet.tsx:760 | User resets preferences |
| 6 | trackCollaborationSessionCreated() | "Collaboration Session Created" | CollaborationSessions.tsx:297 | New session created |
| 7 | trackCollaborationInvitesSent() | "Collaboration Invites Sent" | InviteParticipantsModal.tsx:219 | Invites sent |
| 8 | trackDiscoverCustomHolidayAdded() | "Discover Custom Holiday Added" | DiscoverScreen.tsx:2811 | Custom holiday created |
| 9 | trackFriendRequestAccepted() | "Friend Request Accepted" | FriendRequestsModal.tsx:83 | Accept friend request |
| 10 | trackFriendRequestDeclined() | "Friend Request Declined" | FriendRequestsModal.tsx:127 | Decline friend request |
| 11 | trackFriendRemoved() | "Friend Removed" | ConnectionsPage.tsx:1529 | Remove friend |
| 12 | trackFriendBlocked() | "Friend Blocked" | ConnectionsPage.tsx:1594 | Block user |
| 13 | trackExperienceScheduled() | "Experience Scheduled" | SavedTab.tsx:1428 | Schedule saved card |
| 14 | trackExperienceRescheduled() | "Experience Rescheduled" | CalendarTab.tsx:417 | Reschedule entry |
| 15 | trackProfilePictureUpdated() | "Profile Picture Updated" | ProfilePage.tsx:207,252 | Upload/remove photo |
| 16 | trackProfileSettingUpdated() | "Profile Setting Updated" | ProfilePage.tsx:273-274, AccountSettings.tsx:240,311 | Update profile field |
| 17 | trackCardExpanded() | "Card Expanded" | SwipeableCards.tsx:1077, SavedTab.tsx:1533, CalendarTab.tsx:1191 | Expand card details |
| 18 | trackTabViewed() | "Tab Viewed" | LikesPage.tsx:127, DiscoverScreen.tsx:3324 | Switch tab |
| 19 | trackExperienceShared() | "Experience Shared" | ShareModal.tsx:114,126,369 | Share experience |
| 20 | trackSessionSwitched() | "Session Switched" | CollaborationSessions.tsx:263,475 | Switch session/solo mode |

### Dead Methods (defined but never called — 11 total)

| # | Method | Event Name | Notes |
|---|--------|-----------|-------|
| 1 | trackLoginFailed() | "Login Failed" | Login failures not tracked |
| 2 | trackOnboardingStepViewed() | "Onboarding Step Viewed" | Onboarding tracking unused |
| 3 | trackOnboardingStepCompleted() | "Onboarding Step Completed" | Onboarding tracking unused |
| 4 | trackOnboardingStepBack() | "Onboarding Step Back" | Onboarding tracking unused |
| 5 | trackOnboardingStepSkipped() | "Onboarding Step Skipped" | Onboarding tracking unused |
| 6 | trackOnboardingCompleted() | "Onboarding Completed" | Onboarding tracking unused |
| 7 | trackPreferencesUpdated() | "Preferences Updated" | Only reset tracked, not save |
| 8 | trackDiscoverPersonAdded() | "Discover Person Added" | Person add not tracked |
| 9 | trackFriendRequestSent() | "Friend Request Sent" | Outgoing requests not tracked |
| 10 | trackAccountSettingUpdated() | "Account Setting Updated" | Account settings not tracked |

---

## 3. OneSignal Notification Type Registry (29 types)

### Social (7 types, preference: `friend_requests`)

| Type | Source | Trigger | Title | Body | Deep Link | Push | Buttons |
|------|--------|---------|-------|------|-----------|------|---------|
| friend_request_received | (inferred) | Client | "{{name}} wants to connect" | "Tap to accept or pass." | — | Yes | — |
| friend_request_accepted | send-friend-accepted-notification | Client | "{{name}} accepted your request" | "You're now connected — start planning together!" | mingla://connections?userId={{id}} | Yes | — |
| pair_request_received | notify-pair-request-visible | Client | "{{name}} wants to pair with you" | "Accept to discover experiences for each other." | mingla://discover?pairRequest={{id}} | Yes | Accept/Decline |
| pair_request_accepted | send-pair-accepted-notification | Client | "{{name}} accepted your pair request" | "You're now paired — explore together!" | mingla://discover | Yes | — |
| paired_user_saved_card | notify-pair-activity | Client | "{{name}} found something for you" | 'They saved "{{card}}" — take a look.' | mingla://discover?paired=true | Yes | — |
| paired_user_visited | notify-pair-activity | Client | "{{name}} visited a place" | "{{name}} visited {{place}}" | mingla://discover?paired=true | **No (in-app only)** | — |
| referral_credited | notify-referral-credited | pg_net trigger | "You earned a free month!" | "{{name}} joined Mingla from your invite." | mingla://profile?tab=subscription | Yes | — |

### Sessions (7 types, preference: `collaboration_invites`)

| Type | Source | Trigger | Title | Body | Deep Link | Push | Buttons |
|------|--------|---------|-------|------|-----------|------|---------|
| collaboration_invite_received | (inferred) | Client | "{{name}} invited you" | 'Join "{{session}}" and start swiping together.' | — | Yes | — |
| collaboration_invite_accepted | notify-invite-response | Client | "{{name}} is in!" | 'They joined "{{session}}." Time to plan.' | mingla://session/{{id}} | Yes | — |
| collaboration_invite_declined | notify-invite-response | Client | "{{name}} can't make it" | 'They passed on "{{session}}." Invite someone else?' | mingla://session/{{id}} | **No (in-app only)** | — |
| session_member_joined | boardNotificationService | Client | "{{name}} joined the crew" | "{{session}} just got better — start planning together!" | mingla://session/{{id}} | Yes | — |
| session_member_left | boardNotificationService | Client | "{{name}} left {{session}}" | "The session is still going — keep planning!" | mingla://session/{{id}} | Yes | — |
| board_card_saved | boardNotificationService | Client | "{{name}} saved a spot" | '"{{card}}" was added to {{session}}' | mingla://session/{{id}} | Yes | — |
| board_card_voted | boardNotificationService | Client | "{{name}} voted 👍/👎" | 'on "{{card}}" in {{session}}' | mingla://session/{{id}} | Yes | — |
| board_card_rsvp | boardNotificationService | Client | "{{name}} is in!" | 'RSVP'd to "{{card}}" in {{session}}' | mingla://session/{{id}} | Yes | — |

### Messages (4 types, preference: `messages`)

| Type | Source | Trigger | Title | Body | Deep Link | Push | DM Bypass |
|------|--------|---------|-------|------|-----------|------|-----------|
| direct_message_received | notify-message | Client | "{{senderName}}" | "{{preview}}" | mingla://messages/{{id}} | Yes | Yes |
| board_message_received | notify-message | Client | "{{sender}} in {{session}}" | "{{preview}}" | mingla://session/{{id}}?tab=chat | Yes | No |
| board_message_mention | notify-message | Client | "{{sender}} mentioned you" | 'in "{{session}}": {{preview}}' | mingla://session/{{id}}?tab=chat&messageId={{id}} | Yes | No |
| board_card_message | notify-message | Client | "{{sender}} commented on {{card}}" | "{{preview}}" | mingla://session/{{id}}?card={{cardId}} | Yes | No |

### Reminders (4 types, preference: `reminders`)

| Type | Source | Trigger | Title | Body | Deep Link |
|------|--------|---------|-------|------|-----------|
| calendar_reminder_tomorrow | notify-calendar-reminder | Cron hourly | "Tomorrow: {{name}}" | "Don't forget — {{name}} is tomorrow{{time}}." | mingla://calendar/{{id}} |
| calendar_reminder_today | notify-calendar-reminder | Cron hourly | "Today: {{name}}" | "Enjoy your experience{{time}}!" | mingla://calendar/{{id}} |
| visit_feedback_prompt | notify-calendar-reminder | Cron hourly | "How was {{name}}?" | "Leave a quick review — it helps your future recommendations." | mingla://review/{{id}} |
| holiday_reminder | notify-holiday-reminder | Cron daily 9AM | "Tomorrow is {{person}}'s {{holiday}}!" | "Don't forget to plan something special." | mingla://discover |

### Marketing (5 types, preference: `marketing`)

| Type | Source | Trigger | Title | Body | Deep Link |
|------|--------|---------|-------|------|-----------|
| onboarding_incomplete | notify-lifecycle | Cron daily | "You're almost there" | "Finish setting up and start discovering experiences." | mingla://onboarding |
| trial_ending | notify-lifecycle | Cron daily | "Your trial ends tomorrow" | "Upgrade to keep pairing and collaboration features." | mingla://subscription |
| re_engagement (3d) | notify-lifecycle | Cron daily | "New experiences near you" | "Come back and see what's new." | mingla://home |
| re_engagement_7d | notify-lifecycle | Cron daily | "Miss you on Mingla" / "{{friend}} is on Mingla" | "New experiences are waiting" / "Pair up and discover together" | mingla://home or mingla://connections |
| weekly_digest | notify-lifecycle | Cron daily | "Your week on Mingla" | "{{saves}} saves, {{visits}} visits..." | mingla://home |

### Enforcement Rules

| Rule | Detail |
|------|--------|
| Quiet hours | 10 PM – 8 AM (user timezone), blocks all except DMs with bypass |
| DM bypass | `dm_bypass_quiet_hours: true` user preference |
| Rate limit | Max 10 per type per 5-min window (global) |
| Pair activity limits | saved_card: 3/day, visited: 2/day per actor |
| Idempotency | Every notification has unique key to prevent duplicates |

---

## 4. Identity Lifecycle Map

### Scenario A: Fresh Install (No User)

| Step | Service | Call | File:Line | Type | Error Handling |
|------|---------|------|----------|------|---------------|
| 1 | Mixpanel | `initialize()` | index.tsx:251 | Fire-and-forget | Logged |
| 2 | RevenueCat | `configureRevenueCat(null)` | index.tsx:259 | Fire-and-forget | Logged |
| 3 | OneSignal | `initializeOneSignal()` | index.tsx:282 | Fire-and-forget | Retries 3x/3s |
| 4 | AppsFlyer | `initializeAppsFlyer()` | index.tsx:305 | Fire-and-forget | Logged |

All anonymous. No user ID linked.

### Scenario B: Persisted Session (Returning User)

| Step | Service | Call | File:Line | Type | Error Handling |
|------|---------|------|----------|------|---------------|
| 1-4 | All | Same init calls as Scenario A | — | — | — |
| 5 | RevenueCat | `configureRevenueCat(user.id)` | index.tsx:259 | Fire-and-forget | Logged |
| 6 | RevenueCat | `loginRevenueCat(user.id)` | index.tsx:266 | **Awaited** | console.warn |
| 7 | OneSignal | `loginToOneSignal(user.id)` | index.tsx:292 | **Awaited** | console.warn |
| 8 | AppsFlyer | `setAppsFlyerUserId(user.id)` | index.tsx:314 | Synchronous | Logged |
| 9 | AppsFlyer | `registerAppsFlyerDevice(user.id)` | index.tsx:315 | Fire-and-forget | Logged |
| 10 | AppsFlyer | `logAppsFlyerEvent('af_login')` | index.tsx:322 | Fire-and-forget | Logged |
| 11 | Mixpanel | `trackLogin({id, email, provider})` | index.tsx:922 | Synchronous | Logged |

### Scenario C: OAuth Sign-In

Same as B steps 5-11, triggered by `user?.id` dependency change in useEffects.

### Scenario D: Sign-Out

| Step | Service | Call | File:Line | Type | Error Handling |
|------|---------|------|----------|------|---------------|
| 1 | OneSignal | `logoutOneSignal()` | AppStateManager.tsx:746 | Fire-and-forget | Logged |
| 2 | RevenueCat | `logoutRevenueCat()` | AppStateManager.tsx:751 | Deferred (dynamic import) | console.warn |
| 3 | Mixpanel | `trackLogout()` + `reset()` | AppStateManager.tsx:759 | Deferred (dynamic import) | console.warn |
| 4 | AppsFlyer | **NOT CALLED** | — | — | **GAP: identity persists** |

### Scenario E: Background → Foreground

No explicit identity calls for any service. All rely on SDK auto-resume + React Query invalidation.

### Identity Gaps

| # | Gap | Impact | Severity |
|---|-----|--------|----------|
| 1 | AppsFlyer never clears identity on logout | Events attributed to wrong user if device shared | Medium |
| 2 | Mixpanel logout is deferred (dynamic import) | If app crashes during sign-out, stale identity persists | Low |
| 3 | No resume handlers for any service | After long background, services may be out-of-sync | Low |

---

## 5. Cross-Service Event Parity Matrix

### Events tracked in BOTH AppsFlyer and Mixpanel

| User Action | AppsFlyer | Mixpanel | Parity |
|------------|-----------|---------|--------|
| Login | af_login | trackLogin() | **Yes** |
| Screen navigation | — | trackScreenViewed() | **AF gap** |
| Card expanded | af_content_view | trackCardExpanded() | **Yes** |
| Card saved (swipe right) | af_add_to_wishlist | — | **MP gap** |
| Card dismissed | card_dismissed | — | **MP gap** |
| Experience shared | af_share | trackExperienceShared() | **Yes** |
| Experience scheduled | experience_scheduled | trackExperienceScheduled() | **Yes** |
| Experience rescheduled | experience_rescheduled | trackExperienceRescheduled() | **Yes** |
| Preferences saved | preferences_updated | — (dead: trackPreferencesUpdated never called) | **MP gap** |
| Preferences reset | — | trackPreferencesReset() | **AF gap** |
| Friend request sent | af_invite | — (dead: trackFriendRequestSent never called) | **MP gap** |
| Friend request accepted | friend_request_accepted | trackFriendRequestAccepted() | **Yes** |
| Friend request declined | — | trackFriendRequestDeclined() | **AF gap** |
| Friend removed | — | trackFriendRemoved() | **AF gap** |
| Friend blocked | — | trackFriendBlocked() | **AF gap** |
| Pair request sent | pair_request_sent | — | **MP gap** |
| Pair request accepted | pair_request_accepted | — | **MP gap** |
| Session created | collaboration_session_created | trackCollaborationSessionCreated() | **Yes** |
| Invites sent | collaboration_invite_sent | trackCollaborationInvitesSent() | **Yes** |
| Session switched | session_switched | trackSessionSwitched() | **Yes** |
| Subscription purchased | af_subscribe | — | **MP gap** |
| Trial expired | trial_expired_no_conversion | — | **MP gap** |
| Paywall viewed | paywall_viewed | — | **MP gap** |
| Onboarding completed | af_tutorial_completion | — (dead: trackOnboardingCompleted never called) | **MP gap** |
| Onboarding step | onboarding_step_completed | — (dead: trackOnboardingStepCompleted never called) | **MP gap** |
| Trial started | af_start_trial | — | **MP gap** |
| Profile picture updated | — | trackProfilePictureUpdated() | **AF gap** |
| Profile setting updated | — | trackProfileSettingUpdated() | **AF gap** |
| Tab viewed | — | trackTabViewed() | **AF gap** |
| Custom holiday added | — | trackDiscoverCustomHolidayAdded() | **AF gap** |
| Logout | — | trackLogout() | **AF gap** |
| Registration | af_complete_registration | trackLogin() (same event) | **Partial** |
| Referral completed (S2S) | referral_completed | — | **MP gap** |

### Gap Summary

| Direction | Count | Key Gaps |
|-----------|-------|----------|
| In AppsFlyer but NOT Mixpanel | **12** | Wishlist save, card dismiss, preferences save, pair requests, subscription, trial, paywall, onboarding steps, referral |
| In Mixpanel but NOT AppsFlyer | **9** | Screen views, preferences reset, friend decline/remove/block, profile updates, tab views, custom holiday, logout |
| Dead Mixpanel methods (defined, never called) | **11** | All onboarding tracking, preferences save, person add, friend request sent, account settings |

---

## Discrepancies & Gaps

| # | Finding | Category |
|---|---------|----------|
| 1 | 11 Mixpanel tracking methods are defined but never called (39% dead) | Dead code |
| 2 | AppsFlyer has no logout/identity-clear — device stays attributed to old user | Identity gap |
| 3 | Onboarding is tracked in AppsFlyer (5 events) but not in Mixpanel (5 dead methods exist!) | Parity gap — the methods are written, just never wired |
| 4 | Subscription events (purchase, trial, paywall) only in AppsFlyer, not Mixpanel | Revenue visibility gap |
| 5 | push_clicked column in notifications table is never populated | Notification analytics gap |
| 6 | No analytics event fires when a push notification is delivered or clicked | Cross-service gap |
| 7 | OneSignal doesn't know user subscription tier (can't target pushes by tier) | Segmentation gap |
| 8 | 3 notification types (onboarding_incomplete, trial_ending, referral_credited) are not in the type→preference map — they may bypass preference checks | Preference enforcement gap |

---

## Discoveries for Orchestrator

1. **11 dead Mixpanel methods** — the onboarding tracking code exists in the service but was never wired into OnboardingFlow.tsx. The AppsFlyer equivalent IS wired. This is a simple fix: call the existing methods from the same locations that call AppsFlyer.

2. **3 notification types bypass preference checks** — `onboarding_incomplete`, `trial_ending`, and `referral_credited` are not in the `typeToPreference` map in notify-dispatch. This means they're sent regardless of user preferences. This may be intentional (marketing/system notifications) or a gap.

3. **push_clicked never populated** — the `notifications.push_clicked` column exists but the client never updates it when a notification is tapped. This blocks notification engagement analytics.

4. **No OneSignal tier tagging** — OneSignal doesn't know if a user is free or Mingla+. This prevents targeted push campaigns (e.g., "send trial-ending only to free users" is done by query, not by OneSignal segment).
