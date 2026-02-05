# Cursor AI: Implement Mingla Collaboration Feature End-to-End

## Project Context

You are implementing the **complete collaboration system** for Mingla, a mobile app (React Native) that helps users discover and plan experiences. The collaboration feature allows users to create shared planning sessions where they can swipe through experience cards together, vote on options, RSVP to events, and collectively decide what to do.

## Brand Identity

- **Primary Color**: #eb7825 (orange)
- **Secondary Color**: #d6691f (darker orange)
- **Accent Colors**: White, Black
- **Design Philosophy**: Modern, clean, compact white containers with consistent spacing
- **Logo Size**: 80px/96px (2x bigger than before), left-aligned across all dashboards

---

## Complete Feature Scope

### What You're Building

A **comprehensive collaboration system** with these components:

1. **Board/Session Creation & Management**
   - Create collaboration sessions (solo → board mode switch)
   - Invite friends to sessions via multiple methods
   - Manage session participants (admins, members, pending invites)
   - Session types: Group Hangout, Date Night, Squad Outing, Business Meeting

2. **Swipeable Cards in Sessions**
   - Stack of experience cards generated from preferences
   - Swipe right to save (to board + personal saved tab)
   - Swipe left to pass
   - Real-time sync across all participants
   - Each user sees same cards but can swipe independently

3. **Voting System**
   - Thumbs up/down voting on saved cards
   - Vote counts displayed on each card
   - Real-time vote updates
   - Visual voter list (who voted yes/no)

4. **RSVP System**
   - "Count Me In" / "Can't Make It" buttons
   - RSVP count tracking (e.g., "3/5 attending")
   - Visual RSVP status per participant
   - RSVP notifications

5. **Board Discussion (Chat)**
   - Real-time messaging within each session
   - @mention participants
   - Message reactions
   - Card-specific discussions
   - Activity feed integration

6. **Real-Time Synchronization**
   - WebSocket connections for live updates
   - Optimistic UI updates
   - Conflict resolution
   - Presence indicators (who's online)
   - Typing indicators

7. **Saved Tab Integration**
   - Cards saved from board appear in personal Saved tab
   - Board indicator badge on saved cards
   - Can view which board a card came from
   - Can navigate back to board from saved card

8. **Notifications**
   - Session invites
   - New cards added
   - Votes cast
   - RSVPs updated
   - Messages sent
   - Session status changes

---

## Documentation Reference

You have access to these comprehensive guides (READ ALL OF THEM):

### Core Collaboration Documentation
1. **`/COLLABORATION_SYSTEM_COMPLETE_GUIDE.md`**
   - Overall system architecture
   - Component breakdown
   - State management patterns
   - Core workflows

2. **`/COLLABORATION_REACT_NATIVE_GUIDE.md`**
   - Complete React Native implementation
   - 1000+ lines of technical details
   - Code structure and file organization
   - WebSocket integration
   - Swipe gestures implementation
   - Real-time sync patterns

### Supporting Documentation
3. **`/CONNECTIONS_FRIENDS_REACT_NATIVE_GUIDE.md`**
   - Friends system integration
   - How to invite friends to boards
   - Friend request system
   - Direct messaging integration

4. **`/CARD_GENERATION_MATCHING_STRICTNESS_GUIDE.md`**
   - How cards are generated for sessions
   - Preference-based filtering
   - Match scoring algorithms
   - Quality validation

5. **`/CARD_GENERATION_REACT_NATIVE_IMPLEMENTATION.md`**
   - React Native card generation implementation
   - Google Maps integration
   - OpenAI enhancement
   - Preferences sheet

6. **`/CARD_GENERATION_AI_INTEGRATION_GUIDE.md`**
   - OpenAI & Google Places integration
   - Strict guidelines for card quality
   - Query construction
   - Validation rules

---

## Technical Stack (React Native)

### Required Dependencies
```json
{
  "dependencies": {
    "react-native": "0.73.x",
    "react": "18.2.0",
    "@reduxjs/toolkit": "^2.0.1",
    "react-redux": "^9.0.4",
    "react-native-reanimated": "^3.6.0",
    "react-native-gesture-handler": "^2.14.0",
    "socket.io-client": "^4.6.1",
    "expo-location": "^16.5.1",
    "react-native-mmkv": "^2.11.0",
    "axios": "^1.6.5",
    "date-fns": "^3.0.6",
    "uuid": "^9.0.1"
  }
}
```

### State Management
- **Redux Toolkit** for global state
- **Slices**: collaborationSlice, cardsSlice, votesSlice, rsvpsSlice, messagesSlice
- **Async Thunks** for API calls
- **WebSocket Middleware** for real-time updates

### Real-Time Communication
- **Socket.io** for WebSocket connections
- **Event-based architecture** for live updates
- **Optimistic updates** for instant UI feedback
- **Reconnection logic** for network resilience

---

## Implementation Order (Critical - Follow This Sequence)

### Phase 1: Foundation & Data Models (Week 1)

**Step 1.1: Create Type Definitions**

File: `/src/types/collaboration.ts`

Define ALL TypeScript interfaces:
- `CollaborationSession`
- `SessionParticipant`
- `SessionInvite`
- `BoardCard`
- `CardVote`
- `CardRSVP`
- `BoardMessage`
- `SessionType`

Reference: See `COLLABORATION_REACT_NATIVE_GUIDE.md` Section 3 "Data Models"

**Step 1.2: Redux Store Setup**

Files:
- `/src/redux/store.ts` - Configure store with all slices
- `/src/redux/slices/collaborationSlice.ts` - Sessions state
- `/src/redux/slices/boardCardsSlice.ts` - Cards within sessions
- `/src/redux/slices/votesSlice.ts` - Voting state
- `/src/redux/slices/rsvpsSlice.ts` - RSVP state
- `/src/redux/slices/messagesSlice.ts` - Chat messages

Reference: `COLLABORATION_REACT_NATIVE_GUIDE.md` Section 4 "Redux State Management"

**Step 1.3: WebSocket Service**

File: `/src/services/websocketService.ts`

Implement:
- Connection management
- Event emitters
- Event listeners
- Reconnection logic
- Error handling

Reference: `COLLABORATION_REACT_NATIVE_GUIDE.md` Section 5 "WebSocket Integration"

---

### Phase 2: Session Creation & Management (Week 2)

**Step 2.1: Mode Toggle Component**

File: `/src/components/collaboration/ModeToggle.tsx`

Features:
- Solo / Board mode switch
- Animated transition
- Shows active session name when in board mode
- Quick access to switch between sessions

**Step 2.2: Create Session Flow**

Files:
- `/src/screens/CreateSessionScreen.tsx`
- `/src/components/collaboration/SessionTypeSelector.tsx`
- `/src/components/collaboration/InviteFriendsSelector.tsx`

Workflow:
1. User clicks "Create Board Session"
2. Select session type (Group Hangout, Date Night, etc.)
3. Enter session name
4. Select friends to invite
5. Set initial preferences
6. Create session → Switch to board mode

Reference: `COLLABORATION_REACT_NATIVE_GUIDE.md` Section 6.1 "Creating Sessions"

**Step 2.3: Session Management**

Files:
- `/src/components/collaboration/SessionHeader.tsx`
- `/src/components/collaboration/ParticipantsList.tsx`
- `/src/components/collaboration/SessionSettings.tsx`

Features:
- View all participants
- See who's online (presence)
- Add more friends
- Leave session
- Delete session (admin only)
- Change session name/settings

---

### Phase 3: Swipeable Cards System (Week 3)

**Step 3.1: Card Stack Component**

File: `/src/components/collaboration/SwipeableCardStack.tsx`

Using: `react-native-gesture-handler` + `react-native-reanimated`

Features:
- Stack of cards (top card visible)
- Swipe gestures (left = pass, right = save)
- Smooth animations
- Card overlays (match score, info)
- Empty state when no more cards

Reference: `COLLABORATION_REACT_NATIVE_GUIDE.md` Section 7 "Swipeable Cards"

**Step 3.2: Individual Card Component**

File: `/src/components/collaboration/BoardCard.tsx`

Features:
- Experience card display
- Image carousel
- Match score badge
- Quick stats (rating, price, distance)
- Expand for full details
- Action buttons (save, pass, expand)

**Step 3.3: Swipe Actions & Real-Time Sync**

Implement:
- Swipe right → Save to board + personal saved
- Swipe left → Pass (card removed for this user only)
- Broadcast swipe action to other participants
- Update card pool in real-time
- Optimistic UI updates

Reference: `COLLABORATION_REACT_NATIVE_GUIDE.md` Section 7.3 "Swipe Gestures"

**Step 3.4: Card Generation Integration**

Connect to card generation system:
- Use preferences from session settings
- Generate cards via API
- Filter based on session type
- Load more cards as stack depletes
- Cache cards for offline access

Reference: `CARD_GENERATION_REACT_NATIVE_IMPLEMENTATION.md`

---

### Phase 4: Voting System (Week 4)

**Step 4.1: Vote Buttons Component**

File: `/src/components/collaboration/VoteButtons.tsx`

Features:
- Thumbs up button
- Thumbs down button
- Vote count display
- Animated vote response
- Disabled state if not RSVP'd

**Step 4.2: Vote State Management**

Implement:
- Cast vote (up/down/remove)
- Track who voted what
- Update vote counts in real-time
- Broadcast votes to all participants
- Optimistic updates

Reference: `COLLABORATION_REACT_NATIVE_GUIDE.md` Section 8 "Voting System"

**Step 4.3: Voter List Modal**

File: `/src/components/collaboration/VoterListModal.tsx`

Features:
- List of participants who voted
- Separate sections (Yes votes, No votes, Not voted)
- Avatar display
- Tap to view profile

---

### Phase 5: RSVP System (Week 4)

**Step 5.1: RSVP Buttons Component**

File: `/src/components/collaboration/RSVPButtons.tsx`

Features:
- "Count Me In" button
- "Can't Make It" button
- RSVP count display (e.g., "3/5")
- Participant avatars (who's attending)

**Step 5.2: RSVP State Management**

Implement:
- Toggle RSVP status
- Track all RSVPs per card
- Calculate RSVP percentage
- Broadcast RSVP changes
- Notifications on RSVP updates

Reference: `COLLABORATION_REACT_NATIVE_GUIDE.md` Section 9 "RSVP System"

**Step 5.3: Attendee List Modal**

File: `/src/components/collaboration/AttendeeListModal.tsx`

Features:
- Who's attending
- Who declined
- Who hasn't responded
- Send reminders

---

### Phase 6: Board Discussion (Week 5)

**Step 6.1: Chat Interface**

File: `/src/components/collaboration/BoardDiscussion.tsx`

Features:
- Message list (FlatList with inverted)
- Message input field
- Send button
- Real-time message updates
- Typing indicators

Reference: `COLLABORATION_REACT_NATIVE_GUIDE.md` Section 10 "Board Discussion"

**Step 6.2: Message Components**

Files:
- `/src/components/collaboration/MessageBubble.tsx`
- `/src/components/collaboration/MessageInput.tsx`
- `/src/components/collaboration/TypingIndicator.tsx`

**Step 6.3: @Mentions System**

Implement:
- Detect @ symbol in input
- Show participant autocomplete
- Insert username
- Highlight mentions in messages
- Notify mentioned users

**Step 6.4: Card-Specific Discussions**

File: `/src/components/collaboration/CardDiscussion.tsx`

Features:
- Discussion thread per card
- Message count badge on card
- Tap to view discussion
- Full-screen modal for card discussion

---

### Phase 7: Saved Tab Integration (Week 5)

**Step 7.1: Update Saved Tab**

File: `/src/screens/SavedTab.tsx` (modify existing)

Add:
- Board indicator badge on saved cards
- "From [Board Name]" label
- Tap to navigate back to board
- Filter: Show all saved vs board-only

**Step 7.2: Save Card Flow**

Implement:
- Swipe right in session → Save to board
- Simultaneously save to personal saved tab
- Add board metadata to saved card
- Show success toast: "Saved to board + your saved!"

Reference: `COLLABORATION_REACT_NATIVE_GUIDE.md` Section 11 "Saved Tab Integration"

**Step 7.3: Board Badge Component**

File: `/src/components/collaboration/BoardBadge.tsx`

Features:
- Small badge on saved cards
- Shows board icon + name
- Tap to jump to board
- Color-coded by board

---

### Phase 8: Notifications (Week 6)

**Step 8.1: Push Notifications Setup**

File: `/src/services/notificationService.ts`

Using: Expo Notifications or React Native Push Notification

Implement:
- Request permissions
- Register device token
- Handle incoming notifications
- Deep linking to sessions/cards

**Step 8.2: Notification Types**

Implement handlers for:
- Session invite received
- Friend joined session
- New card added to board
- Vote cast on your suggestion
- RSVP updated
- Message in board discussion
- @Mention in message

Reference: `COLLABORATION_REACT_NATIVE_GUIDE.md` Section 12 "Notifications"

**Step 8.3: In-App Notifications**

File: `/src/components/collaboration/InAppNotification.tsx`

Features:
- Toast-style notifications
- Appear at top of screen
- Auto-dismiss after 3 seconds
- Tap to navigate to source

---

### Phase 9: Invites & Friend Integration (Week 6)

**Step 9.1: Invite Methods**

Implement multiple invite methods:
1. Select from friends list
2. Share invite link
3. QR code for in-person
4. Copy invite code

Reference: `CONNECTIONS_FRIENDS_REACT_NATIVE_GUIDE.md` Section 5 "Integration with Collaboration"

**Step 9.2: Invite Components**

Files:
- `/src/components/collaboration/InviteFriendsModal.tsx`
- `/src/components/collaboration/InviteLinkGenerator.tsx`
- `/src/components/collaboration/InviteQRCode.tsx`

**Step 9.3: Accept/Decline Invites**

File: `/src/screens/SessionInviteScreen.tsx`

Features:
- View session details before joining
- See who's already in session
- Accept → Join session
- Decline → Dismiss invite
- Notification when invite received

**Step 9.4: Pending Invites List**

File: `/src/components/collaboration/PendingInvitesList.tsx`

Features:
- List all pending invites
- Badge count on tab
- Accept/decline from list
- Expire old invites (7 days)

---

### Phase 10: Polish & Edge Cases (Week 7)

**Step 10.1: Loading States**

Add loading indicators for:
- Creating session
- Loading cards
- Sending invites
- Casting votes
- Sending messages

**Step 10.2: Error Handling**

Implement graceful errors for:
- Network failures
- WebSocket disconnection
- API errors
- Permission denials
- Invalid session access

**Step 10.3: Empty States**

Design empty states for:
- No sessions yet
- No cards in session
- No messages yet
- No votes cast
- No friends to invite

**Step 10.4: Animations**

Polish animations:
- Card swipe animations (smooth, natural)
- Vote button tap animation
- RSVP button tap animation
- Message send animation
- Participant join animation
- Card stack refresh animation

**Step 10.5: Offline Support**

Implement:
- Cache session data
- Queue actions while offline
- Sync when reconnected
- Show offline indicator
- Disable real-time features gracefully

Reference: `COLLABORATION_REACT_NATIVE_GUIDE.md` Section 15 "Offline Support"

---

### Phase 11: Testing (Week 8)

**Step 11.1: Unit Tests**

Test files for:
- Redux slices (actions, reducers)
- WebSocket service
- Card generation logic
- Vote/RSVP calculations
- Message parsing (@mentions)

**Step 11.2: Integration Tests**

Test scenarios:
- Complete session creation flow
- Multi-user voting sync
- Real-time message delivery
- Card swipe and save flow
- Invite and join flow

**Step 11.3: E2E Tests**

Using Detox, test:
- Create session → Invite friend → Friend joins → Both swipe cards
- Vote on cards → RSVP → Discussion
- Leave session → Rejoin
- Network interruption → Reconnection

Reference: `COLLABORATION_REACT_NATIVE_GUIDE.md` Section 16 "Testing"

---

## Critical Implementation Rules

### Rule 1: Follow Documentation Exactly

Every feature is documented in detail in the provided guides. DO NOT invent your own approach. Reference the specific sections mentioned above.

### Rule 2: Real-Time First

This is a real-time collaborative feature. Every action must:
1. Update local state immediately (optimistic)
2. Broadcast to server via WebSocket
3. Server broadcasts to all participants
4. Other participants receive and update their UI

### Rule 3: State Consistency

Ensure state consistency across devices:
- Use Redux as single source of truth
- WebSocket events update Redux
- Components read from Redux only
- No direct state manipulation in components

### Rule 4: Mobile-First UX

Design for mobile:
- Thumb-friendly buttons (bottom of screen)
- Swipe gestures over tap buttons
- Bottom sheets instead of modals
- Native animations (Reanimated)
- Haptic feedback on interactions

### Rule 5: Performance Matters

Optimize for performance:
- Lazy load cards (don't load all at once)
- Virtualize message lists (FlatList)
- Memoize expensive components (React.memo)
- Debounce typing indicators
- Cache API responses

### Rule 6: Offline Resilience

Handle offline gracefully:
- Cache session data locally (MMKV)
- Show offline indicator
- Queue actions when offline
- Sync when reconnected
- Don't lose user actions

### Rule 7: Error Recovery

Recover from errors:
- WebSocket disconnection → Auto-reconnect
- API failure → Retry with exponential backoff
- Invalid data → Show error, don't crash
- Permission denied → Prompt user

### Rule 8: Accessibility

Make it accessible:
- Screen reader labels
- Color contrast (WCAG AA)
- Font scaling support
- Haptic feedback for blind users
- Keyboard navigation where applicable

---

## File Structure (Create All These)

```
/src
├── /screens
│   ├── CollaborationHomeScreen.tsx        # Main board view
│   ├── CreateSessionScreen.tsx            # Create new session
│   ├── SessionInviteScreen.tsx            # Accept/decline invites
│   ├── BoardDiscussionScreen.tsx          # Full chat view
│   └── SessionSettingsScreen.tsx          # Manage session
│
├── /components
│   ├── /collaboration
│   │   ├── ModeToggle.tsx                 # Solo/Board switch
│   │   ├── SessionCard.tsx                # Session preview card
│   │   ├── SessionTypeSelector.tsx        # Choose session type
│   │   ├── SessionHeader.tsx              # Session name, participants
│   │   ├── ParticipantsList.tsx           # Who's in session
│   │   ├── InviteFriendsModal.tsx         # Invite friends
│   │   ├── InviteLinkGenerator.tsx        # Generate invite link
│   │   ├── InviteQRCode.tsx               # QR code for invite
│   │   ├── SwipeableCardStack.tsx         # Main card stack
│   │   ├── BoardCard.tsx                  # Individual card
│   │   ├── VoteButtons.tsx                # Thumbs up/down
│   │   ├── VoterListModal.tsx             # Who voted
│   │   ├── RSVPButtons.tsx                # RSVP controls
│   │   ├── AttendeeListModal.tsx          # Who's attending
│   │   ├── BoardDiscussion.tsx            # Chat interface
│   │   ├── MessageBubble.tsx              # Individual message
│   │   ├── MessageInput.tsx               # Message composer
│   │   ├── TypingIndicator.tsx            # "X is typing..."
│   │   ├── MentionAutocomplete.tsx        # @mention picker
│   │   ├── CardDiscussion.tsx             # Card-specific chat
│   │   ├── BoardBadge.tsx                 # Badge on saved cards
│   │   ├── SessionSettings.tsx            # Session configuration
│   │   ├── PendingInvitesList.tsx         # Invites list
│   │   └── InAppNotification.tsx          # Toast notifications
│   │
│   └── /common
│       ├── PresenceIndicator.tsx          # Online status dot
│       └── EmptyState.tsx                 # Empty state views
│
├── /redux
│   ├── store.ts                           # Redux store config
│   ├── /slices
│   │   ├── collaborationSlice.ts          # Sessions state
│   │   ├── boardCardsSlice.ts             # Cards in sessions
│   │   ├── votesSlice.ts                  # Voting state
│   │   ├── rsvpsSlice.ts                  # RSVP state
│   │   └── messagesSlice.ts               # Chat messages
│   │
│   └── /middleware
│       └── websocketMiddleware.ts         # WebSocket sync
│
├── /services
│   ├── collaborationService.ts            # API calls
│   ├── websocketService.ts                # WebSocket connection
│   └── notificationService.ts             # Push notifications
│
├── /hooks
│   ├── useCollaboration.ts                # Session hook
│   ├── useWebSocket.ts                    # WebSocket hook
│   ├── useVoting.ts                       # Voting hook
│   └── useRSVP.ts                         # RSVP hook
│
├── /utils
│   ├── sessionHelpers.ts                  # Session utilities
│   ├── voteCalculations.ts                # Vote/RSVP math
│   └── messageParser.ts                   # Parse @mentions
│
└── /types
    └── collaboration.ts                   # All TypeScript types
```

---

## API Endpoints (Backend Must Implement)

### Sessions
- `POST /api/collaboration/sessions` - Create session
- `GET /api/collaboration/sessions` - List user's sessions
- `GET /api/collaboration/sessions/:id` - Get session details
- `PATCH /api/collaboration/sessions/:id` - Update session
- `DELETE /api/collaboration/sessions/:id` - Delete session
- `POST /api/collaboration/sessions/:id/join` - Join session
- `POST /api/collaboration/sessions/:id/leave` - Leave session

### Invites
- `POST /api/collaboration/invites` - Send invite
- `GET /api/collaboration/invites/pending` - Get user's invites
- `POST /api/collaboration/invites/:id/accept` - Accept invite
- `POST /api/collaboration/invites/:id/decline` - Decline invite

### Cards
- `GET /api/collaboration/sessions/:id/cards` - Get session cards
- `POST /api/collaboration/sessions/:id/cards` - Add card to session
- `DELETE /api/collaboration/sessions/:id/cards/:cardId` - Remove card

### Votes
- `POST /api/collaboration/cards/:cardId/vote` - Cast vote
- `GET /api/collaboration/cards/:cardId/votes` - Get votes

### RSVPs
- `POST /api/collaboration/cards/:cardId/rsvp` - Set RSVP
- `GET /api/collaboration/cards/:cardId/rsvps` - Get RSVPs

### Messages
- `GET /api/collaboration/sessions/:id/messages` - Get messages
- `POST /api/collaboration/sessions/:id/messages` - Send message
- `GET /api/collaboration/cards/:cardId/messages` - Get card messages

---

## WebSocket Events (Real-Time)

### Emit (Client → Server)
- `session:join` - Join session room
- `session:leave` - Leave session room
- `card:swipe` - User swiped card
- `vote:cast` - User voted
- `rsvp:update` - User updated RSVP
- `message:send` - User sent message
- `typing:start` - User started typing
- `typing:stop` - User stopped typing

### Listen (Server → Client)
- `session:updated` - Session data changed
- `participant:joined` - New participant joined
- `participant:left` - Participant left
- `card:added` - New card added to session
- `card:removed` - Card removed from session
- `vote:updated` - Vote cast on card
- `rsvp:updated` - RSVP updated on card
- `message:new` - New message in chat
- `typing:user` - User is typing
- `presence:updated` - User online/offline status

---

## Testing Checklist

Before marking feature complete, verify:

### ✅ Functionality
- [ ] Can create session
- [ ] Can invite friends (multiple methods)
- [ ] Friends receive invites
- [ ] Can accept/decline invites
- [ ] Cards load in session
- [ ] Swipe right saves card
- [ ] Swipe left removes card
- [ ] Votes update in real-time
- [ ] RSVPs update in real-time
- [ ] Messages send and receive
- [ ] @mentions work
- [ ] Saved cards show board badge
- [ ] Can navigate from saved card to board
- [ ] Notifications send correctly
- [ ] Can leave session
- [ ] Can delete session (admin)

### ✅ Real-Time Sync
- [ ] Multiple users see same cards
- [ ] Swipes sync across devices
- [ ] Votes sync instantly
- [ ] RSVPs sync instantly
- [ ] Messages appear immediately
- [ ] Typing indicators work
- [ ] Presence indicators accurate
- [ ] Reconnection after disconnect

### ✅ Performance
- [ ] Cards load in <2 seconds
- [ ] Swipe animations are smooth (60fps)
- [ ] No lag when multiple users active
- [ ] Messages load quickly
- [ ] App doesn't crash with 10+ participants
- [ ] Memory usage acceptable (<200MB)

### ✅ Edge Cases
- [ ] Works offline (queues actions)
- [ ] Syncs when back online
- [ ] Handles invite to full session
- [ ] Handles deleted session gracefully
- [ ] Handles removed participant
- [ ] Handles expired invite
- [ ] Shows error if permission denied

### ✅ UX Polish
- [ ] Loading states everywhere
- [ ] Empty states look good
- [ ] Error messages are helpful
- [ ] Success confirmations shown
- [ ] Animations feel natural
- [ ] Haptic feedback on interactions
- [ ] Smooth transitions between screens

---

## Success Criteria

The collaboration feature is complete when:

1. **Two users can:**
   - Create a session together
   - Swipe through cards simultaneously
   - Vote on saved cards
   - RSVP to experiences
   - Chat in real-time
   - See each other's actions instantly

2. **All documentation guidelines are followed:**
   - Real-time sync works as specified
   - State management matches architecture
   - WebSocket events are implemented correctly
   - UI/UX matches design patterns

3. **All tests pass:**
   - Unit tests (85%+ coverage)
   - Integration tests (key flows)
   - E2E tests (critical paths)

4. **Performance is acceptable:**
   - <2s card load time
   - 60fps animations
   - <200MB memory usage
   - Handles 10+ concurrent users

5. **Code quality is high:**
   - TypeScript types for everything
   - No `any` types
   - Consistent code style
   - Meaningful component/function names
   - Commented complex logic

---

## Implementation Prompt for Cursor AI

**START HERE:**

Read these files in order:
1. `/COLLABORATION_REACT_NATIVE_GUIDE.md` - Main implementation guide
2. `/COLLABORATION_SYSTEM_COMPLETE_GUIDE.md` - System architecture
3. `/CONNECTIONS_FRIENDS_REACT_NATIVE_GUIDE.md` - Friend integration
4. `/CARD_GENERATION_REACT_NATIVE_IMPLEMENTATION.md` - Card generation

Then implement the collaboration feature following these steps:

**Phase 1:** Create all TypeScript types in `/src/types/collaboration.ts` based on Section 3 of the React Native guide.

**Phase 2:** Set up Redux store with all slices (collaborationSlice, boardCardsSlice, votesSlice, rsvpsSlice, messagesSlice) based on Section 4.

**Phase 3:** Implement WebSocket service in `/src/services/websocketService.ts` based on Section 5. Include connection management, event emitters, listeners, and reconnection logic.

**Phase 4:** Build session creation flow: CreateSessionScreen → SessionTypeSelector → InviteFriendsSelector → Create and switch to board mode.

**Phase 5:** Implement swipeable card stack using react-native-gesture-handler and react-native-reanimated. Follow Section 7 exactly for gesture handling and animations.

**Phase 6:** Add voting system with VoteButtons component, vote state management, and real-time broadcast. Follow Section 8.

**Phase 7:** Add RSVP system with RSVPButtons component, RSVP state management, and attendee tracking. Follow Section 9.

**Phase 8:** Implement board discussion with chat interface, message components, @mentions, and typing indicators. Follow Section 10.

**Phase 9:** Integrate with Saved tab - add board badges to saved cards and enable navigation back to boards. Follow Section 11.

**Phase 10:** Implement all notification types (invites, votes, RSVPs, messages) with deep linking. Follow Section 12.

**Phase 11:** Polish with loading states, error handling, empty states, animations, and offline support.

**Phase 12:** Write comprehensive tests for all features.

**CRITICAL RULES:**
- Follow the documentation guides EXACTLY - don't improvise
- Implement real-time sync for EVERY user action
- Use Redux as single source of truth
- Implement optimistic UI updates for instant feedback
- Handle offline scenarios gracefully
- Test with multiple concurrent users
- Ensure 60fps animations on card swipes
- Add loading states everywhere
- Make error messages helpful
- Use TypeScript strictly (no `any` types)

**Start with Phase 1 and work through sequentially. Reference the specific documentation sections mentioned for each phase. Ask questions if anything is unclear.**

---

## Questions to Ask If Stuck

1. **"Which documentation section covers [specific feature]?"**
   - I'll point you to the exact section

2. **"How should [component] communicate with [other component]?"**
   - Answer: Via Redux. Components don't communicate directly.

3. **"What happens when user does [action] while offline?"**
   - Answer: Queue action, sync when reconnected. See Section 15.

4. **"How do I handle [specific WebSocket event]?"**
   - Answer: Dispatch Redux action from WebSocket listener. See Section 5.

5. **"What's the priority between [feature A] and [feature B]?"**
   - Answer: Follow the phase order above. Don't skip phases.

---

## Final Notes

This is a **comprehensive, production-ready feature**. Take your time with each phase. Don't rush. Quality over speed.

The documentation is your source of truth. Everything you need to know is documented. Reference the guides constantly.

When in doubt, ask for clarification. Better to ask than to implement incorrectly.

Good luck! 🚀

---

**NOW BEGIN IMPLEMENTATION.**

Start by reading `/COLLABORATION_REACT_NATIVE_GUIDE.md` completely, then proceed with Phase 1.
