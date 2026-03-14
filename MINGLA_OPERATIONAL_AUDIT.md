# Mingla — Complete Operational Audit & User Journey Map

**Date:** 2026-03-14
**Scope:** Every user-facing feature, workflow, state transition, and meaningful action
**Method:** Full codebase analysis — navigation, screens, services, hooks, edge functions, database schema, realtime subscriptions, state management

---

## SECTION 1: COMPLETE FEATURE INVENTORY

### 1.1 Authentication & Identity

| # | Feature | Entry Point | Actor |
|---|---------|-------------|-------|
| 1 | Google OAuth sign-in | WelcomeScreen | Unauthenticated user |
| 2 | Apple OAuth sign-in | WelcomeScreen | Unauthenticated user |
| 3 | Session persistence (auto-login) | App launch | Returning user |
| 4 | Sign out | Profile → Sign Out | Authenticated user |
| 5 | Account deletion | Profile → Account Settings → Delete | Authenticated user |

### 1.2 Onboarding (5-Step Progressive Profile Builder)

| # | Feature | Step | Sub-step |
|---|---------|------|----------|
| 6 | Welcome animation | 1 | welcome |
| 7 | Phone number input | 1 | phone |
| 8 | OTP verification (Twilio) | 1 | otp |
| 9 | Gender identity selection | 1 | gender_identity |
| 10 | Country/birthday/language details | 1 | details |
| 11 | Value proposition showcase | 2 | value_prop |
| 12 | Intent selection (adventurous, romantic, etc.) | 2 | intents |
| 13 | GPS location capture | 3 | location |
| 14 | Manual location fallback (if GPS denied) | 4 | manual_location |
| 15 | Category preferences selection | 4 | categories |
| 16 | Budget/price tier selection | 4 | budget |
| 17 | Transport mode selection | 4 | transport |
| 18 | Travel time selection | 4 | travel_time |
| 19 | Add friends by phone | 5 | friends |
| 20 | Accept friend requests during onboarding | 5 | friends |
| 21 | Path A: Sync friends + audio recording | 5 | pathA_sync, pathA_audio |
| 22 | Path B: Add single person + audio | 5 | pathB_name → pathB_audio |
| 23 | Path C: Skip friends entirely | 5 | (skip) |
| 24 | Onboarding resume after crash | Any | useOnboardingResume |

### 1.3 Home Screen — Experience Discovery

| # | Feature | Component | Description |
|---|---------|-----------|-------------|
| 25 | Swipe cards (solo mode) | SwipeableCards | Swipe left/right to dismiss/save experiences |
| 26 | Swipe cards (collab mode) | SwipeableSessionCards | Collaborative voting on shared deck |
| 27 | Expand card for full details | ExpandedCardModal | Full experience info, weather, busyness, booking |
| 28 | Save experience | SwipeableCards | Right-swipe or save button |
| 29 | Dismiss experience | SwipeableCards | Left-swipe |
| 30 | Open preferences (solo) | Header button | Solo preference customization |
| 31 | Open preferences (collab) | Header button | Per-session preference customization |
| 32 | View notifications | Bell icon | In-app notification center |
| 33 | Switch solo/collab mode | CollaborationSessions pills | Tap pill to switch context |
| 34 | Accept collab invite from pill | CollaborationSessions | Tap pending invite pill |
| 35 | Create collaboration session | "+" button on pill bar | Session creation modal |
| 36 | Deck batching & pagination | useDeckCards | Load more cards with batchSeed |

### 1.4 Discover Screen — People & Curated Experiences

| # | Feature | Component | Description |
|---|---------|-----------|-------------|
| 37 | View saved people | DiscoverScreen | List of people you plan experiences for |
| 38 | Add new person | AddPersonModal | Name, birthday, relationship |
| 39 | Edit person details | PersonEditSheet | Modify person info |
| 40 | Delete person | PersonEditSheet | Remove saved person |
| 41 | View person's curated experiences | PersonHolidayView | AI-generated experiences for this person |
| 42 | Create custom holiday for person | CustomHolidayModal | Custom event with date and categories |
| 43 | Archive/unarchive holiday | PersonHolidayView | Toggle holiday visibility |
| 44 | Record audio description for person | OnboardingAudioRecorder | Voice note processed by AI |
| 45 | Night-out venue discovery | DiscoverScreen | Special venue recommendations |

### 1.5 Connections — Friends & Messaging

| # | Feature | Component | Description |
|---|---------|-----------|-------------|
| 46 | View conversations list | MessagesTab | All direct message threads |
| 47 | Send/receive messages | MessageInterface | Real-time chat |
| 48 | Typing indicators | useChatPresence | Shows when friend is typing |
| 49 | Unread message badges | Tab bar + conversation list | Count of unread messages |
| 50 | View friends list | FriendsTab | All connected friends |
| 51 | Add friend by phone/email/username | AddFriendView | Multiple discovery methods |
| 52 | Accept friend request | RequestsView / NotificationsModal | Accept incoming request |
| 53 | Decline friend request | RequestsView / NotificationsModal | Decline incoming request |
| 54 | Cancel sent friend request | RequestsView | Withdraw pending request |
| 55 | Remove friend | FriendsTab (swipe action) | Unfriend |
| 56 | Block user | BlockUserModal | Block prevents all interaction |
| 57 | Unblock user | BlockedUsersView | Restore interaction |
| 58 | Mute user | FriendsTab (swipe action) | Suppress notifications |
| 59 | Unmute user | FriendsTab | Restore notifications |
| 60 | Report user | ReportUserModal | Report with reason |
| 61 | View friend profile | ViewFriendProfileScreen | Full overlay of friend's profile |
| 62 | Send phone invite (SMS) | AddFriendView | Invite non-user via SMS |

### 1.6 Collaboration Sessions (Boards)

| # | Feature | Component | Description |
|---|---------|-----------|-------------|
| 63 | Create collaboration session | CreateSessionModal | Name + invite friends |
| 64 | Invite friends to session | InviteParticipantsModal | Add participants |
| 65 | Invite by phone number | CreateSessionModal | SMS invite to non-users |
| 66 | Accept session invite | InvitesTab / Pills | Join session |
| 67 | Decline session invite | InvitesTab / Pills | Reject invite |
| 68 | Switch between sessions | CollaborationSessions pills | Tap different session pill |
| 69 | Set session preferences | CollaborationPreferences | Per-session preference customization |
| 70 | Vote on session cards | SessionViewModal | Thumbs up on experiences |
| 71 | React with emoji to cards | SessionViewModal | Emoji reactions |
| 72 | Session discussion chat | BoardDiscussionTab | Real-time group chat |
| 73 | Card-specific comments | CardDiscussionModal | Comments on individual cards |
| 74 | RSVP to session cards | SessionViewModal | Confirm attendance |
| 75 | View participant presence | SessionViewModal | Who's online |
| 76 | Manage session (creator) | ManageBoardModal | Edit name, remove members |
| 77 | Delete session (creator) | ManageBoardModal | Destroy session |
| 78 | Exit session (participant) | SessionViewModal | Leave session |
| 79 | Real-time deck regeneration | useSessionDeck | Deck refreshes when any participant changes prefs |
| 80 | Board view (full screen) | BoardViewScreen | Dedicated board screen |

### 1.7 Likes/Activity — Saved Experiences & Calendar

| # | Feature | Component | Description |
|---|---------|-----------|-------------|
| 81 | View saved experiences | SavedTab | Grid of saved cards |
| 82 | Filter/sort saved experiences | SavedTab | By category, date, score |
| 83 | Remove from saved | SavedTab | Delete saved experience |
| 84 | View calendar entries | CalendarTab | Scheduled experiences |
| 85 | Schedule experience | ProposeDateTimeModal | Pick date/time |
| 86 | Reschedule experience | CalendarTab | Change date/time |
| 87 | Remove from calendar | CalendarTab | Cancel scheduled experience |
| 88 | View QR code | CalendarTab | Check-in QR for confirmed experiences |
| 89 | Share saved experience | ShareModal | Send to friend or external |

### 1.8 Profile & Settings

| # | Feature | Component | Description |
|---|---------|-----------|-------------|
| 90 | View own profile | ProfilePage | Hero, stats, interests |
| 91 | Change avatar | ProfileHeroSection | Camera, gallery, or remove |
| 92 | Edit name/username/bio | EditProfileSheet | Profile text fields |
| 93 | Edit interests/categories | EditInterestsSheet | Modify preference categories |
| 94 | Toggle notifications | ProfilePage | Enable/disable push |
| 95 | Cycle profile visibility | ProfilePage | Friends Only / Everyone / Nobody |
| 96 | Toggle activity visibility | ProfilePage | Show/hide active status |
| 97 | Replay onboarding tips | ProfilePage | Re-show tutorial |
| 98 | View account settings | AccountSettings | App info, version |
| 99 | View privacy policy | PrivacyPolicy | Legal document |
| 100 | View terms of service | TermsOfService | Legal document |

### 1.9 Expanded Card Features

| # | Feature | Component | Description |
|---|---------|-----------|-------------|
| 101 | Image gallery | ExpandedCardModal | Swipeable photos |
| 102 | Weather forecast | ExpandedCardModal | Real-time weather data |
| 103 | Busyness prediction | ExpandedCardModal | BestTime.app integration |
| 104 | Open/closed status | ExpandedCardModal | Client-side time computation |
| 105 | Match score breakdown | ExpandedCardModal | Why this was recommended |
| 106 | Companion stops | ExpandedCardModal | Nearby related venues |
| 107 | Booking/reservation link | ExpandedCardModal | In-app browser |
| 108 | Open in Maps | ExpandedCardModal | Native maps app |
| 109 | Picnic shopping list | ExpandedCardModal | Grocery items for picnic experiences |
| 110 | Add to board/session | ExpandedCardModal | Add card to collaboration |

### 1.10 Notifications & Push

| # | Feature | Component | Description |
|---|---------|-----------|-------------|
| 111 | Push notifications (foreground) | OneSignal listener | In-app notification conversion |
| 112 | Push notifications (background tap) | OneSignal click listener | Navigate to target page |
| 113 | In-app notification center | NotificationsModal | Grouped by date, action buttons |
| 114 | Mark notifications read | NotificationsModal | Individual or bulk |
| 115 | Clear all notifications | NotificationsModal | Bulk clear |

### 1.11 Monetization

| # | Feature | Component | Description |
|---|---------|-----------|-------------|
| 116 | Subscription paywall | PaywallScreen | RevenueCat integration |
| 117 | Purchase from card | ExpandedCardModal | Booking/ticketing |

### 1.12 Post-Experience

| # | Feature | Component | Description |
|---|---------|-----------|-------------|
| 118 | Post-experience review prompt | PostExperienceModal | Voice review after scheduled experience |
| 119 | Voice review recording | PostExperienceModal | Audio processed by GPT-4o-mini |

### 1.13 Share & Referral

| # | Feature | Component | Description |
|---|---------|-----------|-------------|
| 120 | Share experience externally | ShareModal | Social/messaging apps |
| 121 | Share with in-app friend | ShareModal | Direct share to friend |
| 122 | Referral rewards | process-referral edge fn | Notification on referral credit |

---

## SECTION 2: END-TO-END USER JOURNEYS

### Journey 1: First-Time User — Sign Up to First Swipe

**Actor:** New user who has never used Mingla
**Goal:** Create account, set preferences, start discovering experiences
**Preconditions:** App installed, internet connection

**Steps:**
1. User opens app → `WelcomeScreen` renders (Google + Apple sign-in buttons)
2. User taps "Sign in with Google" → Google account picker appears
3. Google returns ID token → `signInWithIdToken()` creates Supabase session
4. App checks `profile.has_completed_onboarding` → `false` → shows `OnboardingFlow`
5. **Step 1:** Welcome animation → Phone input → OTP verification (Twilio) → Gender selection → Country/Birthday/Language
6. **Step 2:** Value proposition screens → Intent selection (min 1 required)
7. **Step 3:** GPS permission request → Location capture (10s timeout) → City name resolution
8. **Step 4:** Category selection (min 1, max 10) → Budget tiers → Transport mode → Travel time
9. **Step 5:** Add friends (phone lookup, accept requests) → Choose path (sync/add/skip) → Optional audio recording
10. Launch handler fires → `has_completed_onboarding = true` → Home screen renders
11. `useDeckCards` fires with captured preferences → `discover-cards` edge function → Cards appear
12. User swipes first card → `trackInteraction()` records the action

**Data Created:** Profile row, preferences row, optional saved_people + audio clips, optional friend_requests/friends records
**End State:** User on Home screen with personalized deck of experience cards

---

### Journey 2: Returning User — App Launch to Discovery

**Actor:** Onboarded user reopening the app
**Preconditions:** `has_completed_onboarding = true`, valid Supabase session

**Steps:**
1. App loads → `useAuthSimple` checks session (8s timeout)
2. Session valid → load profile from Zustand (AsyncStorage) + refresh from DB
3. Profile loaded, onboarding complete → render main app with tab bar
4. Home screen renders → `useDeckCards` fires with current preferences
5. If cached deck batches exist in appStore → show immediately (AsyncStorage persisted)
6. If no cache or stale → fetch fresh deck from `discover-cards` edge function
7. Cards render in swipeable stack → user begins swiping

**Failure Paths:**
- Session expired → `onAuthStateChange` fires SIGNED_OUT → redirect to WelcomeScreen
- Profile deleted server-side → session check returns null user → redirect to WelcomeScreen
- Network timeout (12s global) → stale React Query cache shown with placeholderData
- GPS drift → coordinates rounded to 3 decimals (~110m) in query key to prevent cache duplication

---

### Journey 3: Experience Discovery — Swipe, Save, Expand, Schedule

**Actor:** Authenticated, onboarded user
**Goal:** Find and save interesting experiences, schedule them

**Steps:**
1. User on Home screen → swipe card right to save OR tap to expand
2. **Right swipe (save):**
   - `savesService.addSave()` → snapshot card data → insert `saved_experiences`
   - Haptic feedback fires
   - Card animates off screen
   - React Query invalidates `savedCards` key
3. **Tap to expand:**
   - `ExpandedCardModal` opens with full details
   - Sections load: weather (OpenWeatherMap), busyness (BestTime), open/closed (client-side)
   - User can: Save, Share, Add to Calendar, Open in Maps, Book
4. **Add to Calendar:**
   - `ProposeDateTimeModal` opens → user picks date/time
   - Calendar entry created in `calendar_entries` table
   - Optional: sync to device calendar via `deviceCalendarService`
5. **Share:**
   - `ShareModal` opens → pick friend or external app
   - If friend: sends in-app message with card data
   - If external: native share sheet

**Edge Cases:**
- Deck exhausted → empty state with "Refresh" CTA → new batchSeed → fresh cards
- Save duplicate → `saved_experiences` upsert handles idempotently
- Network failure during save → optimistic update shown, rolled back on error

---

### Journey 4: Collaboration Session — Create, Invite, Vote, Schedule

**Actor:** User wanting to plan with friends
**Goal:** Create shared session, collaboratively pick an experience
**Preconditions:** At least 1 friend connection

**Steps:**
1. User taps "+" on collaboration pills bar → `CreateSessionModal` opens
2. Enter session name, select friends from list, optionally add phone numbers
3. Tap "Create" → `collaboration_sessions` INSERT + `session_participants` INSERTs
4. Edge function `send-collaboration-invite` sends push notifications to invitees
5. Invitee sees orange pill on their Home screen → taps to accept
6. Accept → `session_participants.has_accepted = true` → session becomes `active` when 2+ accept
7. Creator's preferences seeded to `board_session_preferences` (from solo prefs, backfilled during onboarding)
8. Each participant can set their own preferences → `board_session_preferences` UPSERT
9. Any preference change triggers Realtime event → `generate-session-deck` regenerates shared deck
10. Shared deck appears → participants swipe cards → votes recorded in `board_votes`
11. Real-time: all participants see vote counts update live
12. Discussion tab: group chat in `board_messages` with typing indicators
13. Card comments: per-card discussion in `board_card_messages`
14. RSVP: participants confirm attendance via `board_card_rsvps`
15. Creator can advance session status: active → voting → locked → completed

**Data Created:** collaboration_sessions, session_participants, board_session_preferences, session_decks, board_votes, board_messages, board_card_rsvps, board_saved_cards
**Real-time Channels:** postgres_changes on all board_* tables + broadcast for typing/swipe events

---

### Journey 5: Friendship — Add, Accept, Message, Block

**Actor:** User wanting to connect with another user
**Goal:** Establish friendship, communicate

**Steps:**
1. User navigates to Connections → Add Friend view
2. Enters phone number or email → `search-users` edge function or `lookup-phone`
3. **If user exists:** Shows profile → "Add Friend" button
4. Tap "Add" → `friend_requests` INSERT + `send-friend-request-email` edge function (push notification)
5. Recipient sees notification → opens Connections → Requests tab
6. Tap "Accept" → `accept_friend_request_atomic` RPC:
   - Updates `friend_requests.status` to 'accepted'
   - Inserts bidirectional `friends` records
   - Returns `revealed_invite_ids` for pending collaboration invites
7. Both users now appear in each other's friends list
8. User taps friend in Messages → `getOrCreateDirectConversation()` → chat opens
9. Messages sent via `messagingService.sendMessage()` + push via `send-message-email` edge function
10. Real-time: `subscribeToConversation()` delivers messages instantly

**If user doesn't exist:** SMS invite via `send-phone-invite` → creates `pending_invites` record → when they sign up, invite auto-resolves

**Block flow:**
1. User swipes friend row → "Block" → `BlockUserModal` confirmation
2. Confirm → `blocked_users` INSERT
3. Blocked user can no longer: send messages (RLS code 42501), send friend requests, see profile
4. Blocker can unblock from Blocked Users view

---

### Journey 6: Preferences — Customize Recommendations

**Actor:** Onboarded user wanting different recommendations
**Goal:** Change what types of experiences appear

**Steps:**
1. User taps preferences button on Home screen → `PreferencesSheet` opens
2. Modify: categories, budget range, travel mode, travel time, date/time, location, intents, price tiers
3. Tap "Apply" → `preferencesService.updateUserPreferences()` (20s timeout, 1 retry)
4. `appStore.resetDeckHistory()` clears all cached deck batches
5. Next `useDeckCards` call uses new preferences → fresh deck from `discover-cards`
6. Cards refresh with new recommendations matching updated preferences

**Collaboration preferences:**
1. In active session → tap preferences → `CollaborationPreferences` sheet opens
2. Modify preferences → `board_session_preferences` UPSERT (scoped to this user + session)
3. Realtime event fires → all participants notified → `generate-session-deck` regenerates deck
4. New shared deck distributed to all participants

---

### Journey 7: Saved People — Discover Experiences for Someone

**Actor:** User who wants to find experiences for a specific person
**Goal:** Get AI-curated suggestions for someone they care about

**Steps:**
1. Navigate to Discover tab → Saved People section
2. Tap "Add Person" → `AddPersonModal` → enter name, birthday, relationship
3. Record voice description (min 10 seconds) → upload to Supabase Storage
4. `process-person-audio` edge function:
   - Transcribes audio via OpenAI Whisper
   - Extracts interests via GPT-4o-mini
   - Generates experiences via `generate-person-experiences`
   - Updates `saved_people.description`
5. Person appears in list with AI summary
6. Tap person → view curated experiences tailored to their interests
7. Create custom holiday → `CustomHolidayModal` → name, date, categories
8. Holiday-specific experiences generated

---

### Journey 8: Post-Experience Review

**Actor:** User who completed a scheduled experience
**Goal:** Leave a voice review

**Steps:**
1. After scheduled experience time passes → `usePostExperienceCheck()` detects completion
2. `PostExperienceModal` appears (locked — cannot dismiss)
3. User records voice review
4. Upload to Supabase Storage → `process-voice-review` edge function:
   - GPT-4o-mini-audio-preview processes audio
   - Extracts sentiment, themes, summary
   - Updates `place_reviews` with transcription + AI analysis
   - Recalculates `place_pool` aggregations (mingla_review_count, mingla_avg_rating, top_themes)
5. Modal dismisses → user returns to normal app

---

### Journey 9: Account Deletion

**Actor:** User wanting to permanently delete their account
**Goal:** Remove all personal data and account

**Steps:**
1. Profile → Account Settings → Delete Account
2. Two-stage confirmation modal
3. Invoke `delete-user` edge function (45s timeout):
   - Phase 1: Transfer collaboration session ownership OR delete under-populated sessions
   - Phase 2: Soft-delete messages, hard-delete from 25+ tables
   - Phase 3: Clear phone from profiles AND auth.users
   - Phase 4: Delete auth user (invalidates JWT), then delete profile
4. Client-side: `supabase.auth.signOut()` → clear AsyncStorage, React Query, Zustand
5. Redirect to WelcomeScreen

**Edge Cases:**
- 45s timeout but deletion succeeded server-side → check if session still valid → if not, assume success
- Phone number freed → prevents "already associated" error on re-signup

---

### Journey 10: Notification Navigation

**Actor:** User receiving a push notification
**Goal:** Navigate to relevant content

**Steps:**
1. **Foreground:** Push received → OneSignal listener → converted to in-app notification → stored in AsyncStorage → badge updated
2. **Background tap:** User taps notification → `NavigationTarget` extracted → navigate to target page
3. **In-app notification center:** Tap bell icon → `NotificationsModal` → grouped by date
4. Tap notification → navigate to relevant page (home, connections, likes, board-view, etc.)
5. **Actionable notifications:**
   - `friend_request` → Accept/Decline buttons
   - `collaboration_invite` → Navigate to session
   - `board_message` → Navigate to board discussion

---

## SECTION 3: FLAWS, BUGS, AND STRUCTURAL WEAKNESSES

### Category A: Critical Bugs (Data Loss / Corruption Risk)

#### A1. PostExperienceModal — Locked Modal with No Escape Hatch
**Component:** `PostExperienceModal.tsx`
**User Impact:** User is trapped in a locked modal with no way to dismiss it. If the audio recording fails, upload fails, or processing fails, the user cannot use the app.
**Root Cause:** Modal is designed as non-dismissible ("locked") to force review completion. No error recovery UI, no "skip" option, no timeout-based auto-dismiss.
**Correct Behavior:** Add a "Skip for now" button that appears after 10 seconds or on error. Queue the review for later. Never permanently lock the user out of the app.
**Severity:** CRITICAL — app becomes unusable

#### A2. Deck Batch Persistence — Schema Version Invalidation Race
**Component:** `appStore.ts` (deckBatches, deckSchemaVersion)
**User Impact:** If a Zustand schema version bump occurs (developer changes deckSchemaVersion), persisted deck batches from AsyncStorage may have stale/incompatible card shape. Cards could render with missing fields or crash.
**Root Cause:** deckBatches are persisted to AsyncStorage and restored on app launch. Schema version check exists but the migration path is "clear everything" — if the check fails silently, stale data persists.
**Correct Behavior:** Explicit migration function that validates persisted card shape before rendering. Graceful fallback to empty deck on schema mismatch rather than potential crash.
**Severity:** HIGH — crash on app launch after update

#### A3. Collaboration Session Deck — Preferences Hash Collision
**Component:** `generate-session-deck` edge function
**User Impact:** If two different preference sets produce the same hash (unlikely but possible with simple hashing), the cached deck is served even though preferences actually changed. Users see stale recommendations that don't match their new preferences.
**Root Cause:** `session_decks` cache is keyed by `preferences_hash + batch_seed`. Hash collisions would serve stale deck.
**Correct Behavior:** Include a monotonically increasing version counter alongside the hash, or use a cryptographic hash (SHA-256) to make collisions negligible.
**Severity:** MEDIUM — wrong recommendations served

#### A4. Fire-and-Forget Profile Updates During Onboarding
**Component:** `OnboardingFlow.tsx` — `handleSaveIdentity()`, `handleSavePreferences()`
**User Impact:** Identity data (gender, birthday, country, language) and preference data are saved fire-and-forget during onboarding. If the save fails silently (network blip, timeout), the user completes onboarding believing their data is saved, but the DB has incomplete data. Recommendations will use wrong defaults.
**Root Cause:** Fire-and-forget pattern intentionally chosen to avoid blocking navigation. But there's no retry queue or verification step.
**Correct Behavior:** Add a background retry queue (3 attempts with exponential backoff). On final failure, show a non-blocking toast "Some preferences couldn't be saved — tap to retry." Verify critical fields at launch handler before marking onboarding complete.
**Severity:** HIGH — permanent data loss of user preferences

#### A5. Realtime Subscription Leak on Rapid Session Switching
**Component:** `useBoardSession.ts`, `realtimeService.ts`
**User Impact:** If user rapidly switches between collaboration sessions (tapping pills fast), the 300ms debounce on subscribe combined with immediate unsubscribe creates a window where subscriptions may not be properly cleaned up. Stale event handlers fire for the wrong session.
**Root Cause:** The 300ms debounce was a HIGH-001 fix to prevent rapid re-subscribe, but it means if user switches A→B→C within 300ms, the subscribe for B may fire after C's unsubscribe logic runs.
**Correct Behavior:** Use a subscription ID/generation counter. Each subscribe call increments the counter. When the subscribe callback fires, check if the counter still matches. If not, immediately unsubscribe (the session switched again before this subscribe completed).
**Severity:** HIGH — stale realtime events corrupt current session state

---

### Category B: State Management Flaws

#### B1. Zustand currentSession Not Persisted — Cold Start Inconsistency
**Component:** `appStore.ts`
**User Impact:** `currentSession` and `isInSolo` are explicitly NOT persisted to AsyncStorage. On cold start, user always starts in "solo" mode even if they were in a collaboration session. The session pills render correctly (fetched from DB), but the deck, preferences, and UI context are all in solo mode until user taps the session pill again.
**Root Cause:** Intentional design decision ("always refetched from DB") but the refetch only determines available sessions, not which one was active.
**Correct Behavior:** Persist `lastActiveSessionId` to AsyncStorage. On cold start, if it exists, auto-switch to that session. Or at minimum, show a "You were in [Session Name] — tap to resume" banner.
**Severity:** MEDIUM — confusing UX, user loses context

#### B2. React Query staleTime: Infinity on Friends/Requests — Stale Data
**Component:** `useFriendsList`, `useFriendRequests`, `useBlockedUsers`
**User Impact:** Friends list, friend requests, and blocked users all use `staleTime: Infinity`. Data is only refreshed via mutations or Realtime events. If a Realtime event is missed (network blip, app backgrounded), the data stays stale indefinitely. User won't see new friend requests until they manually trigger a refresh or restart the app.
**Root Cause:** Optimization to prevent unnecessary refetches. But `Infinity` means "never refetch automatically."
**Correct Behavior:** Use `staleTime: 5 * 60 * 1000` (5 minutes) as a safety net. Realtime events handle the fast path, but a 5-minute refetch interval ensures eventual consistency.
**Severity:** MEDIUM — missed friend requests, stale friend list

#### B3. Saved Cards Snapshot Pattern — Stale Data at View Time
**Component:** `savesService.ts`
**User Impact:** When a user saves a card, `addSave()` snapshots the card data (title, price, image, location) at save time. If the place updates (name change, price change, closes permanently), the saved card shows stale data forever.
**Root Cause:** Intentional "historical accuracy" pattern. But places can close, prices change, photos get removed.
**Correct Behavior:** Keep the snapshot for historical reference but add a `last_verified_at` column. On view, if `last_verified_at` is older than 7 days, trigger a background refresh from `place_pool` or Google Places. Show a "Details may have changed" indicator.
**Severity:** LOW — misleading but not broken

#### B4. Offline Queue — No Conflict Resolution
**Component:** `realtimeService.ts` (offlineQueue)
**User Impact:** Actions queued offline (votes, messages, saves) are replayed on reconnect. But there's no conflict resolution. If user A votes on a card offline, and user B deletes the card while A is offline, A's queued vote will fail silently or create an orphaned vote record.
**Root Cause:** Offline queue uses simple replay with no server-side idempotency check.
**Correct Behavior:** Each queued action should have a version/timestamp. Server-side handlers should check if the target entity still exists and is in a valid state before applying. Return structured errors for stale actions that the client can surface.
**Severity:** MEDIUM — silent failures, potential orphaned data

---

### Category C: UX Flaws

#### C1. 2,500-Line App Entry Point — Monolithic Render
**Component:** `app/index.tsx`
**User Impact:** The entire app's navigation, state management, context providers, and modal rendering live in a single 2,500-line file. This doesn't directly affect users, but it makes bugs harder to find and fix, increasing the likelihood of regressions.
**Root Cause:** Organic growth without refactoring.
**Correct Behavior:** Extract into separate files: NavigationManager, ModalManager, ContextProviders, AuthGate, OnboardingGate. Each file < 300 lines.
**Severity:** LOW (user-facing) / HIGH (maintainability)

#### C2. No Deep Linking Support
**Component:** Navigation system
**User Impact:** The app uses custom state-driven navigation with no URL-based routing. Deep links from push notifications work via OneSignal's click handler setting `currentPage`, but there's no universal link handler. Users can't share a link to a specific experience, session, or profile.
**Root Cause:** Custom navigation system doesn't support URL schemes.
**Correct Behavior:** Implement Expo Linking handler that parses `mingla://experience/{id}`, `mingla://session/{id}`, `mingla://profile/{username}` and sets appropriate navigation state.
**Severity:** MEDIUM — limits sharing and re-engagement

#### C3. No Pull-to-Refresh on Home Deck
**Component:** `SwipeableCards.tsx`
**User Impact:** The main card stack has no pull-to-refresh gesture. If the deck loads stale data, the only way to refresh is: change preferences (clears deck), navigate away and back, or kill the app. The "Load More" mechanism exists via batchSeed but there's no explicit refresh.
**Root Cause:** Swipe gesture conflicts with pull-to-refresh on the same axis.
**Correct Behavior:** Add a "Refresh" button that appears when the deck is exhausted, or a shake-to-refresh gesture, or a long-press on the preferences button to force refresh.
**Severity:** LOW — workarounds exist but not discoverable

#### C4. Onboarding Audio — 10-Second Minimum with No Progress Indicator
**Component:** `OnboardingAudioRecorder`
**User Impact:** Audio recording requires a minimum of 10 seconds. If user stops at 8 seconds, they must re-record. There's no visible timer or countdown showing them the minimum requirement.
**Root Cause:** Minimum enforced programmatically but not communicated visually.
**Correct Behavior:** Show a progress ring that fills over 10 seconds, with text "Keep talking... X seconds remaining." Disable stop button until minimum reached.
**Severity:** LOW — frustrating but learnable

#### C5. Profile Visibility Cycling — No Confirmation
**Component:** `ProfilePage.tsx`
**User Impact:** Profile visibility cycles through "Friends Only → Everyone → Nobody" on tap with no confirmation. User can accidentally set visibility to "Nobody" (invisible) with a single accidental tap. They may not realize their profile is hidden.
**Root Cause:** Cycle toggle with no intermediate confirmation or undo toast.
**Correct Behavior:** Show a brief toast after change ("Profile visible to: Nobody") with a 5-second "Undo" button.
**Severity:** MEDIUM — accidental privacy change

#### C6. PostExperienceModal — Forced Voice Review UX
**Component:** `PostExperienceModal.tsx`
**User Impact:** After a scheduled experience, the app forces a locked modal for voice review. Users who don't want to record audio, are in a noisy environment, or have accessibility needs cannot bypass this. They're trapped.
**Root Cause:** Product decision to maximize review collection. But it's hostile UX.
**Correct Behavior:** Make it a persistent but dismissible prompt. "Would you like to review your experience?" with "Later" and "Never for this experience" options. Queue for later reminder if "Later" selected.
**Severity:** HIGH — accessibility concern, hostile UX

---

### Category D: Backend Integrity Flaws

#### D1. get-google-maps-key — API Key Exposed to Client
**Component:** `get-google-maps-key` edge function
**User Impact:** No direct user impact, but the Google Maps API key is returned to the client. A malicious actor could extract it from network traffic and abuse it (rack up API charges).
**Root Cause:** Client needs the key for map rendering. But the edge function has no rate limiting, no key rotation, and no referer restriction enforcement.
**Correct Behavior:** Restrict the API key with HTTP referrer restrictions (iOS bundle ID, Android package name) in Google Cloud Console. Add rate limiting to the edge function. Consider using Maps SDK key separately from Places API key.
**Severity:** HIGH — financial risk from API key abuse

#### D2. send-phone-invite Rate Limiting — Per-User Only
**Component:** `send-phone-invite` edge function
**User Impact:** Rate limit is 10 SMS invites per user per 24 hours. But there's no global rate limit or per-phone rate limit. A botnet of accounts could each send 10 invites to the same phone number, creating an SMS harassment vector.
**Root Cause:** Rate limiting implemented at user level only.
**Correct Behavior:** Add per-phone rate limit (max 3 invites to the same phone per 24h across ALL users). Add global rate limit (max 1000 SMS per hour across all users). Flag and block abuse patterns.
**Severity:** HIGH — harassment vector, Twilio cost exposure

#### D3. Orphaned Profile Cleanup — Multiple Functions Handle It
**Component:** `send-otp`, `verify-otp`, `delete-user`
**User Impact:** Three separate functions handle orphaned profile cleanup with slightly different logic. If a deletion fails midway, the next function may or may not clean up correctly depending on which table's cleanup succeeded.
**Root Cause:** Cleanup logic duplicated across functions instead of centralized.
**Correct Behavior:** Create a shared `cleanupOrphanedProfile(userId)` function in `_shared/` that all three functions call. Use a database transaction to ensure atomicity.
**Severity:** MEDIUM — potential data inconsistency

#### D4. Message Soft-Delete on Account Deletion — Ghost Messages
**Component:** `delete-user` edge function
**User Impact:** When a user deletes their account, messages are soft-deleted. But the conversations and conversation_participants records may not be cleaned up consistently. Other users in those conversations may see "deleted user" messages with no context, or worse, the conversation may error when trying to load the deleted user's profile.
**Root Cause:** Soft-delete preserves message history but doesn't handle the display edge case for the remaining participant.
**Correct Behavior:** When deleting user, update all their messages to `sender_id = null` or a sentinel "deleted-user" UUID. Update sender display to "Deleted User" in the messaging enrichment layer.
**Severity:** MEDIUM — broken UI for remaining conversation participants

#### D5. No Idempotency Keys on Critical Mutations
**Component:** Multiple edge functions and services
**User Impact:** Creating sessions, sending invites, accepting friend requests — none of these have idempotency keys. If the client retries due to network timeout (the 12s/15s/20s timeouts), duplicate records can be created.
**Root Cause:** No idempotency pattern implemented.
**Correct Behavior:** For critical mutations (session creation, invite sending, friend request acceptance): generate a client-side UUID idempotency key, pass it with the request, server checks `idempotency_keys` table before processing. If key exists, return cached response.
**Severity:** HIGH — duplicate sessions, duplicate invites, duplicate friend records

#### D6. RLS Service Role Key in Edge Functions — Overprivileged
**Component:** Multiple edge functions use `createClient(url, SERVICE_ROLE_KEY)`
**User Impact:** Edge functions that need cross-user queries (looking up another user's profile for notifications) use the service role key, which bypasses ALL RLS policies. A bug in any of these functions could expose any user's data.
**Root Cause:** Supabase design — service role key is the only way to bypass RLS for server-side operations.
**Correct Behavior:** Minimize service role usage. For each edge function, audit whether it truly needs service role or if a security definer function (RPC) would suffice with narrower permissions.
**Severity:** MEDIUM — security surface area

---

### Category E: Race Conditions & Concurrency

#### E1. Collaboration Session Creation — No Duplicate Prevention
**Component:** `CreateSessionModal` → `collaboration_sessions` INSERT
**User Impact:** User double-taps "Create" → two sessions created with same name and participants. Both sessions get invites sent.
**Root Cause:** No client-side debounce on create button, no server-side duplicate detection.
**Correct Behavior:** Client: disable button immediately on first tap + loading state. Server: UNIQUE constraint on `(creator_id, name, created_at::date)` or similar. Or idempotency key (see D5).
**Severity:** HIGH — duplicate sessions with confused participants

#### E2. Friend Request Acceptance — Concurrent Accept from Both Sides
**Component:** `accept_friend_request_atomic` RPC
**User Impact:** If User A sends friend request to User B, and simultaneously User B sends one to User A, both try to accept. The atomic RPC may create 4 friend records (2 bidirectional pairs) instead of 2.
**Root Cause:** The RPC checks for existing friend records, but two concurrent RPCs may both pass the check.
**Correct Behavior:** Use a UNIQUE constraint on `friends(LEAST(user_id, friend_user_id), GREATEST(user_id, friend_user_id))` to prevent duplicate friend pairs regardless of order.
**Severity:** MEDIUM — duplicate friend records, potential double notifications

#### E3. Session Deck Regeneration — Thundering Herd
**Component:** `generate-session-deck`, Realtime `onPreferencesChanged`
**User Impact:** When a participant changes preferences, a Realtime event fires to ALL participants. If multiple participants change preferences simultaneously (e.g., during initial setup), each change triggers a deck regeneration. Multiple regenerations race, wasting API calls and potentially producing inconsistent results.
**Root Cause:** No debounce or coalescing on deck regeneration triggers.
**Correct Behavior:** Implement server-side debounce: on preference change, set a "regeneration_requested_at" timestamp. A cron or delayed job checks after 5 seconds — if no newer request exists, regenerate. Or: client-side, use a 5-second debounce on the regeneration call.
**Severity:** MEDIUM — wasted API calls, potential cost spike

#### E4. Messaging — Read Receipt Race
**Component:** `messagingService.markAsRead()`
**User Impact:** `markAsRead()` upserts to `message_reads`. If two instances of the app (e.g., different devices) mark the same message as read simultaneously, the upsert may conflict. Not a big user impact, but wastes DB resources.
**Root Cause:** Upsert handles it correctly at the DB level, but the client doesn't know the other instance already handled it.
**Correct Behavior:** This is actually fine — upserts are idempotent. LOW priority.
**Severity:** LOW — cosmetic, no data corruption

---

### Category F: Missing Features / Incomplete Flows

#### F1. No Conversation Deletion
**Component:** `messagingService.ts`
**User Impact:** Users cannot delete conversations. Even after removing a friend, the conversation persists in the list with no way to hide or archive it.
**Root Cause:** No delete/archive mutation exists in the messaging service.
**Correct Behavior:** Add conversation archiving (soft-delete per participant). Archived conversations don't appear in the list but can be found in "Archived" section.
**Severity:** MEDIUM — clutter in conversations list

#### F2. No Message Deletion or Editing
**Component:** `messagingService.ts`
**User Impact:** Users cannot delete or edit sent messages. Typos and regrettable messages persist forever.
**Root Cause:** No update/delete mutations for messages.
**Correct Behavior:** Add "Delete for everyone" (soft-delete, shows "Message deleted" placeholder) and "Edit" (stores edit history) within a 15-minute window.
**Severity:** LOW — common feature expectation

#### F3. No Search Functionality
**Component:** Multiple screens
**User Impact:** No way to search saved experiences, conversations, or friends by keyword. Users with many saved items have to scroll through entire lists.
**Root Cause:** No search service or UI implemented.
**Correct Behavior:** Add search to: Saved tab (by title/category), Connections (by friend name), Conversations (by message content). Use Supabase full-text search.
**Severity:** MEDIUM — usability gap as data grows

#### F4. Notification Preferences — No Granularity
**Component:** `ProfilePage.tsx` — single toggle
**User Impact:** Notifications are a single on/off toggle. Users who want friend request notifications but not marketing notifications have no option. All or nothing.
**Root Cause:** Single `notification_preferences` field without per-type granularity.
**Correct Behavior:** Break into categories: Friend requests, Messages, Session invites, Board activity, Marketing. Each independently toggleable. Store in `notification_preferences` JSONB field (already exists, just needs UI).
**Severity:** MEDIUM — users may disable all notifications to avoid one type

#### F5. No Username Change Validation
**Component:** `EditProfileSheet`
**User Impact:** When editing username, there's no real-time availability check. User types a username, submits, and only then finds out it's taken (DB UNIQUE constraint error).
**Root Cause:** No debounced availability check on username input.
**Correct Behavior:** Debounce username input (500ms), check `profiles` table for existing username, show green checkmark or red "taken" indicator before submission.
**Severity:** LOW — mild frustration

---

## SECTION 4: IMPLEMENTATION-READY FIX SPECIFICATIONS

### Fix 4.1: PostExperienceModal — Add Escape Hatch

**File:** `app-mobile/src/components/PostExperienceModal.tsx`

**Changes:**
1. Add `skipCount` state (starts at 0)
2. After 10 seconds OR on any error, show "Skip for now" button
3. Skip action: dismiss modal, queue review for later via AsyncStorage key `pending_reviews`
4. On next app launch, check `pending_reviews` — show non-modal reminder card on Home screen
5. "Never for this experience" option: marks `place_reviews.status = 'skipped'`

**Validation:** Modal must always be dismissible within 15 seconds of appearing.

---

### Fix 4.2: Fire-and-Forget Retry Queue (Onboarding)

**File:** `app-mobile/src/utils/onboardingRetryQueue.ts` (NEW)

**Implementation:**
```typescript
// Queue structure in AsyncStorage: 'mingla_onboarding_retry_queue'
interface RetryItem {
  id: string
  type: 'identity' | 'preferences' | 'audio'
  payload: Record<string, unknown>
  attempts: number
  lastAttempt: string // ISO date
}

// On app launch, check queue. For each item:
// - If attempts < 3: retry with exponential backoff (1s, 4s, 16s)
// - If attempts >= 3: show toast "Some settings couldn't be saved — check your connection"
// - On success: remove from queue
```

**Integration:** Wrap `handleSaveIdentity()` and `handleSavePreferences()` in try/catch. On catch, add to retry queue instead of silently failing.

---

### Fix 4.3: Idempotency Keys for Critical Mutations

**Database Migration:**
```sql
CREATE TABLE public.idempotency_keys (
  key UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_idempotency_user ON public.idempotency_keys(user_id);
-- Auto-cleanup: entries older than 24h
```

**Client Pattern:**
```typescript
const idempotencyKey = crypto.randomUUID()
await supabase.functions.invoke('create-session', {
  body: { ...params, idempotency_key: idempotencyKey }
})
```

**Server Pattern:**
```typescript
// At top of handler:
const existing = await supabase.from('idempotency_keys')
  .select('response').eq('key', body.idempotency_key).maybeSingle()
if (existing.data) return new Response(JSON.stringify(existing.data.response), { status: 200 })
// ... process normally ...
// Before returning success:
await supabase.from('idempotency_keys').insert({
  key: body.idempotency_key, user_id: userId, operation: 'create-session', response: result
})
```

**Apply to:** create-session, send-collaboration-invite, send-friend-request, send-phone-invite, accept-friend-request

---

### Fix 4.4: Session Switching Generation Counter

**File:** `app-mobile/src/hooks/useBoardSession.ts`

**Changes:**
```typescript
const subscriptionGeneration = useRef(0)

function switchToSession(sessionId: string) {
  const gen = ++subscriptionGeneration.current
  // Immediately unsubscribe from previous
  realtimeService.unsubscribeFromBoardSession(previousSessionId)
  // Debounced subscribe
  setTimeout(() => {
    if (subscriptionGeneration.current !== gen) return // Stale — another switch happened
    realtimeService.subscribeToBoardSession(sessionId, callbacks)
  }, 300)
}
```

---

### Fix 4.5: Duplicate Session Prevention

**Client-side:** `CreateSessionModal.tsx`
```typescript
const [isCreating, setIsCreating] = useState(false)
// On create button press:
if (isCreating) return
setIsCreating(true)
try { await createSession(params) } finally { setIsCreating(false) }
```

**Server-side:** Add unique constraint or use idempotency key (Fix 4.3).

---

### Fix 4.6: SMS Rate Limiting — Per-Phone

**File:** `supabase/functions/send-phone-invite/index.ts`

**Add after existing rate limit check:**
```typescript
// Per-phone rate limit: max 3 invites to same phone per 24h from ANY user
const { count: phoneInviteCount } = await supabaseAdmin
  .from('pending_invites')
  .select('*', { count: 'exact', head: true })
  .eq('phone', phone_e164)
  .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

if (phoneInviteCount >= 3) {
  return new Response(JSON.stringify({ error: 'This phone number has received too many invites recently' }), { status: 429 })
}
```

---

### Fix 4.7: Friends staleTime — Safety Net Refetch

**File:** `app-mobile/src/hooks/useFriends.ts`

**Change:**
```typescript
// Before:
staleTime: Infinity
// After:
staleTime: 5 * 60 * 1000  // 5 minutes — Realtime handles fast path, this is safety net
```

Apply to: `useFriendsList`, `useFriendRequests`, `useBlockedUsers`

---

### Fix 4.8: Profile Visibility — Undo Toast

**File:** `app-mobile/src/components/ProfilePage.tsx`

**On visibility cycle:**
```typescript
const previousVisibility = currentVisibility
// Apply change
setVisibility(nextVisibility)
// Show toast with undo
showToast({
  message: `Profile visible to: ${nextVisibility}`,
  action: { label: 'Undo', onPress: () => setVisibility(previousVisibility) },
  duration: 5000
})
```

---

### Fix 4.9: Google Maps API Key Restriction

**Google Cloud Console (not code):**
1. Go to APIs & Services → Credentials
2. Edit the Maps API key
3. Add Application restrictions:
   - iOS: Bundle ID restriction
   - Android: Package name + SHA-1 restriction
4. Add API restrictions: only Maps SDK, Places API (New), Distance Matrix API
5. Create a SEPARATE key for client-side map rendering vs server-side Places/Distance Matrix

---

### Fix 4.10: Deck Regeneration Debounce (Thundering Herd)

**File:** `app-mobile/src/hooks/useBoardSession.ts`

**On `onPreferencesChanged` event:**
```typescript
const regenerationTimer = useRef<NodeJS.Timeout | null>(null)

function handlePreferencesChanged() {
  if (regenerationTimer.current) clearTimeout(regenerationTimer.current)
  regenerationTimer.current = setTimeout(() => {
    queryClient.invalidateQueries({ queryKey: ['session-deck', sessionId] })
  }, 5000) // Wait 5 seconds for all preference changes to settle
}
```

---

## SECTION 5: PRIORITIZED TESTING CHECKLIST

### P0 — Critical Path (Must work or app is broken)

- [ ] **AUTH-01:** Fresh Google sign-in → profile created → onboarding starts
- [ ] **AUTH-02:** Fresh Apple sign-in → profile created → onboarding starts
- [ ] **AUTH-03:** Returning user → auto-login → home screen within 8 seconds
- [ ] **AUTH-04:** Expired session → redirect to WelcomeScreen (not stuck on loading)
- [ ] **AUTH-05:** Sign out → all local state cleared → WelcomeScreen
- [ ] **ONBOARD-01:** Complete Steps 1-5 (Path C: skip friends) → Home screen with cards
- [ ] **ONBOARD-02:** Complete Steps 1-5 (Path A: sync friends + audio) → Home with cards + friends
- [ ] **ONBOARD-03:** Complete Steps 1-5 (Path B: add person + audio) → Home with cards + person
- [ ] **ONBOARD-04:** Kill app mid-onboarding (Step 3) → reopen → resume at Step 3
- [ ] **ONBOARD-05:** OTP verification — correct code → advance. Wrong code → error message.
- [ ] **ONBOARD-06:** Phone already claimed → navigate back to phone step with error
- [ ] **DECK-01:** Solo mode → cards load within 3 seconds → swipeable
- [ ] **DECK-02:** Swipe right → card saved → appears in Likes/Saved tab
- [ ] **DECK-03:** Deck exhausted → empty state with refresh CTA → fresh cards
- [ ] **DECK-04:** Change preferences → deck clears → new cards match new preferences

### P1 — Core Social Features

- [ ] **FRIEND-01:** Add friend by phone → friend request sent → appears in recipient's requests
- [ ] **FRIEND-02:** Accept friend request → bidirectional friend records created → appears in both friend lists
- [ ] **FRIEND-03:** Decline friend request → request removed → no friend record created
- [ ] **FRIEND-04:** Remove friend → both friend records deleted → removed from both lists
- [ ] **FRIEND-05:** Block user → no messages/requests possible → appears in blocked list
- [ ] **FRIEND-06:** Unblock user → interaction restored → removed from blocked list
- [ ] **MSG-01:** Send message → appears in recipient's conversation instantly (realtime)
- [ ] **MSG-02:** Typing indicator → shows when friend is typing → disappears when they stop
- [ ] **MSG-03:** Unread badge → shows correct count → clears when conversation opened
- [ ] **MSG-04:** Message to blocked user → RLS error → "Cannot send message" shown

### P2 — Collaboration Features

- [ ] **COLLAB-01:** Create session → invite sent → appears as pending pill on invitee's screen
- [ ] **COLLAB-02:** Accept invite → session becomes active → shared deck loads
- [ ] **COLLAB-03:** Decline invite → invite removed → no session participation
- [ ] **COLLAB-04:** Double-tap create → only ONE session created (debounce works)
- [ ] **COLLAB-05:** Set session preferences → deck regenerates → new cards match prefs
- [ ] **COLLAB-06:** Vote on card → vote count updates for all participants (realtime)
- [ ] **COLLAB-07:** Send message in discussion → all participants see it (realtime)
- [ ] **COLLAB-08:** Switch sessions rapidly (A→B→C) → subscriptions clean up → only C's events fire
- [ ] **COLLAB-09:** Creator advances status: active → voting → locked → completed
- [ ] **COLLAB-10:** Exit session as participant → removed from participant list

### P3 — Content Features

- [ ] **SAVE-01:** Save experience → snapshot stored → visible in Likes/Saved
- [ ] **SAVE-02:** Remove from saved → deleted → no longer in Likes/Saved
- [ ] **CAL-01:** Schedule experience → calendar entry created → visible in Calendar tab
- [ ] **CAL-02:** Reschedule → date/time updated → calendar entry reflects change
- [ ] **CAL-03:** Remove from calendar → entry deleted → no longer in Calendar
- [ ] **EXPAND-01:** Tap card → ExpandedCardModal opens → all sections load (weather, busyness, etc.)
- [ ] **EXPAND-02:** Share from expanded card → ShareModal → share to friend or external
- [ ] **EXPAND-03:** "Open in Maps" → opens native maps app with correct coordinates
- [ ] **SHARE-01:** Share to friend → friend receives message with card data

### P4 — Profile & Settings

- [ ] **PROF-01:** Change avatar (camera) → upload succeeds → new photo visible
- [ ] **PROF-02:** Change avatar (gallery) → upload succeeds → new photo visible
- [ ] **PROF-03:** Remove avatar → reverts to default → no broken image
- [ ] **PROF-04:** Edit name/username/bio → saved → visible on profile
- [ ] **PROF-05:** Username taken → error shown before submission (if fix F5 implemented)
- [ ] **PROF-06:** Toggle notifications → preference saved → push behavior changes
- [ ] **PROF-07:** Cycle visibility → correct state shown → undo works (if fix 4.8 implemented)
- [ ] **DELETE-01:** Delete account → all data removed → redirect to WelcomeScreen
- [ ] **DELETE-02:** Delete account → phone number freed → can re-signup with same phone
- [ ] **DELETE-03:** Delete account → collaboration sessions transferred/cleaned up

### P5 — Discover/People Features

- [ ] **PERSON-01:** Add person → record created → appears in Discover list
- [ ] **PERSON-02:** Record audio for person → upload + transcription + AI summary
- [ ] **PERSON-03:** View person experiences → AI-curated cards load
- [ ] **PERSON-04:** Create custom holiday → holiday-specific experiences generate
- [ ] **PERSON-05:** Delete person → record removed → no longer in Discover list

### P6 — Edge Cases & Error Handling

- [ ] **OFFLINE-01:** Go offline → cached data shown → "offline" indicator
- [ ] **OFFLINE-02:** Go offline → queue actions → go online → queued actions replay
- [ ] **TIMEOUT-01:** Edge function timeout (>12s) → error shown → retry available
- [ ] **TIMEOUT-02:** GPS timeout (>10s) during onboarding → error state shown → manual location option
- [ ] **CRASH-01:** Force-kill app on Home screen → reopen → deck restored from cache
- [ ] **CRASH-02:** Force-kill during session creation → no orphaned session in DB
- [ ] **PUSH-01:** Foreground push → in-app notification shown → tappable
- [ ] **PUSH-02:** Background push tap → navigate to correct screen
- [ ] **NOTIF-01:** Friend request notification → Accept button works → friendship created
- [ ] **NOTIF-02:** Mark all notifications read → all unread indicators clear

### P7 — Post-Experience

- [ ] **REVIEW-01:** Completed experience → PostExperienceModal appears → record + submit
- [ ] **REVIEW-02:** Skip review (if fix 4.1 implemented) → modal dismisses → reminder queued
- [ ] **REVIEW-03:** Audio upload failure → error shown → retry available → not stuck

### P8 — Monetization

- [ ] **PAY-01:** Paywall trigger → RevenueCat offerings load → purchase flow works
- [ ] **PAY-02:** Subscription active → premium features unlocked → no paywall shown

---

## APPENDIX A: Complete Data Model Summary

### Tables (29 total)

| Table | Purpose | RLS |
|-------|---------|-----|
| profiles | User profiles | Yes — own row read/write |
| preferences | User recommendation preferences | Yes — own row |
| friends | Bidirectional friendship records | Yes — own records |
| friend_requests | Pending/accepted/declined requests | Yes — sender or receiver |
| blocked_users | Block relationships | Yes — own blocks |
| pending_invites | SMS invites to non-users | Yes — own invites |
| saved_experiences | Saved/liked experience snapshots | Yes — own saves |
| saved_people | People to discover experiences for | Yes — own people |
| person_experiences | AI-generated experiences per person | Yes — own person's |
| custom_holidays | Custom holidays for saved people | Yes — own holidays |
| conversations | Direct message threads | Yes — participant |
| conversation_participants | Who's in each conversation | Yes — participant |
| messages | Chat messages | Yes — conversation participant |
| message_reads | Read receipts | Yes — reader |
| collaboration_sessions | Group collaboration sessions | Yes — participant |
| session_participants | Who's in each session | Yes — participant or invited |
| board_session_preferences | Per-participant session preferences | Yes — own prefs |
| session_decks | Cached shared decks | Yes — session participant |
| board_saved_cards | Cards saved within a session | Yes — session participant |
| board_votes | Votes on session cards | Yes — session participant |
| board_card_rsvps | RSVPs to session cards | Yes — session participant |
| board_messages | Session discussion messages | Yes — session participant |
| board_card_messages | Per-card comments | Yes — session participant |
| board_participant_presence | Online/offline status per session | Yes — participant |
| place_pool | Cached place data from Google | Yes — service role only |
| card_pool | Pre-generated card cache | Yes — service role only |
| card_pool_impressions | Tracking which cards were shown | Yes — service role only |
| place_reviews | User voice reviews of places | Yes — reviewer |
| user_interactions | Swipe/save/dismiss tracking | Yes — own interactions |
| referral_credits | Referral reward tracking | Yes — referrer |
| notification_preferences | Per-user notification settings | Yes — own prefs |

### Edge Functions (47 total)

**Auth/User:** verify-otp, send-otp, lookup-phone, delete-user, search-users
**Social:** send-phone-invite, send-collaboration-invite, notify-invite-response, send-friend-request-email, send-message-email, process-referral
**Discovery:** discover-cards, generate-experiences, generate-person-experiences, generate-session-deck, generate-curated-experiences, get-personalized-cards, get-person-hero-cards, get-holiday-cards, get-companion-stops, get-picnic-grocery, holiday-experiences, night-out-experiences
**AI:** process-person-audio, process-voice-review, ai-reason, generate-ai-summary
**External APIs:** places, weather, ticketmaster-events, events, get-google-maps-key
**Caching:** warm-cache, refresh-place-pool, backfill-place-websites, admin-place-search
**Legacy (deprecated):** discover-casual-eats through discover-wellness (11 category-specific functions)

---

## APPENDIX B: Risk-Priority Matrix

| Issue | User Impact | Likelihood | Fix Effort | Priority |
|-------|-----------|------------|------------|----------|
| A1. Locked PostExperience modal | App unusable | Medium | Low | P0 |
| A4. Fire-and-forget onboarding saves | Data loss | High | Medium | P0 |
| D1. API key exposure | Financial loss | Medium | Low | P0 |
| D2. SMS harassment vector | Abuse/cost | Medium | Low | P0 |
| D5. No idempotency keys | Duplicate data | High | Medium | P1 |
| E1. Duplicate session creation | Confusion | High | Low | P1 |
| A5. Subscription leak on rapid switch | Stale events | Medium | Medium | P1 |
| B2. Friends staleTime: Infinity | Missed requests | Medium | Low | P1 |
| C6. Forced voice review | Hostile UX | High | Low | P1 |
| A2. Deck schema version race | Crash on update | Low | Medium | P2 |
| B1. Session not persisted on cold start | Lost context | Medium | Low | P2 |
| B4. Offline queue no conflict resolution | Silent failures | Low | High | P2 |
| C2. No deep linking | Limits sharing | Medium | High | P2 |
| C5. Visibility cycling no confirm | Accidental change | Medium | Low | P2 |
| D3. Orphaned cleanup duplication | Data inconsistency | Low | Medium | P2 |
| D4. Ghost messages after deletion | Broken UI | Low | Medium | P2 |
| E2. Concurrent friend acceptance | Duplicate records | Low | Medium | P2 |
| E3. Thundering herd deck regen | Cost spike | Low | Low | P2 |
| F1. No conversation deletion | Clutter | Medium | Medium | P3 |
| F3. No search | Usability gap | Medium | High | P3 |
| F4. No notification granularity | All-or-nothing | Medium | Medium | P3 |
| B3. Saved card snapshot staleness | Misleading data | Low | Medium | P3 |
| C1. Monolithic app entry | Maintainability | N/A | High | P3 |
| C3. No pull-to-refresh on deck | Minor UX | Low | Low | P3 |
| C4. Audio recording no timer | Frustration | Low | Low | P3 |
| F2. No message editing/deletion | Feature expectation | Low | Medium | P3 |
| F5. No username availability check | Mild frustration | Low | Low | P3 |
