pes of saved cards:**

**Board Saved Cards:**
- Cards saved from a board session
- Have a board badge: small indicator showing which board it came from
- Badge shows board icon + session name
- Example badge: "🎯 Saturday Night Plans"

**Personal Saved Cards:**
- Cards saved while in Solo Mode
- No board badge
- Just personal reference

**Navigation:**
- From personal Saved tab, tap a board-saved card
- See which board it came from
- "Saved from: Saturday Night Plans"
- Button: "View Board" → takes you to that board session
- Can see votes, RSVPs, discussion for that card

**Why this matters:**
- User can be in multiple boards
- Can see all their saved cards in one place
- Can navigate back to boards to check status
- Board context is preserved

---

### 12. Notifications

**When users get notified:**

**Invite notifications:**
- "Alex invited you to join 'Saturday Night Plans'"
- Tap to view invite details and accept/decline

**Activity notifications:**
- "Sarah saved a new card to Saturday Night Plans"
- "Mike voted on [Card Name]"
- "Emma is attending [Card Name]"
- "3 new messages in Saturday Night Plans"

**Mention notifications:**
- "Alex mentioned you in Saturday Night Plans"
- Direct link to that message

**RSVP reminders:**
- "4/5 people have RSVP'd to [Card Name] - add your response"
- Sent 24 hours before event (if date/time is set)

**Notification behavior:**
- Push notifications when app is closed
- In-app toast notifications when app is open
- Badge count on Board Mode toggle
- Red dot on Discussion tab when unread messages

---

### 13. Session Management

**Viewing all sessions:**
- List of all boards user is part of
- Shows: session name, participant count, unread count
- Recent activity preview: "Sarah saved a card 2h ago"

**Session settings (Admin only):**
- Change session name
- Change session type
- Remove participants
- Delete session (all data deleted)
- Transfer admin to another participant

**Leaving a session:**
- Any participant can leave
- If admin leaves and others remain, admin transfers to next person
- If last person leaves, session auto-deletes after 7 days

**Session states:**
- **Active** - People are swiping, voting, chatting
- **Inactive** - No activity in 7+ days (shown with gray indicator)
- **Archived** - Manually archived but data preserved
- **Deleted** - Removed completely

---

### 14. Real-Time Synchronization Rules

**Everything that syncs in real-time:**
- Card swipes (someone saves a card → appears in everyone's Saved)
- Votes (someone votes → count updates for everyone)
- RSVPs (someone RSVPs → count updates for everyone)
- Messages (someone sends message → appears for everyone)
- Presence (someone joins/leaves → status updates)
- Typing indicators (someone types → shows for everyone)
- Participants (someone joins → appears in participant list)

**How real-time works:**
- WebSocket connection to server
- When user performs action:
  1. Update local UI immediately (optimistic)
  2. Send action to server via WebSocket
  3. Server broadcasts to all participants in that session
  4. Participants receive update and refresh their UI
  5. If optimistic update conflicts, server version wins

**Handling conflicts:**
- If two users vote at same time: both votes count
- If two users save same card at same time: both saves recorded, card shown once
- If network fails: action queues, retries when connection restored

---

### 15. Offline Behavior

**What works offline:**
- View previously loaded cards
- View saved cards
- View chat history (already loaded messages)
- Can attempt actions (they queue)

**What doesn't work offline:**
- New cards won't load
- Can't send real-time updates
- Won't see others' actions in real-time
- Can't join new sessions

**Going back online:**
- Queued actions sync automatically
- Receive all missed updates
- Real-time sync resumes
- User sees: "Syncing X actions..."

**Offline indicator:**
- Small banner at top: "You're offline. Changes will sync when connected."
- Actions show pending state (e.g., "Message sending...")

---

### 16. Key User Flows

**Flow 1: Create and populate a board**
1. User in Solo Mode clicks "Create Board"
2. Selects "Group Hangout"
3. Names it "Saturday Night Plans"
4. Invites 4 friends from friends list
5. Sets preferences: Budget $25-75, Categories: Dining + Sip & Chill, Time: Saturday 7pm
6. Board created, user switches to Board Mode
7. Cards generate based on preferences
8. User swipes through, saves 3 cards
9. Friends receive invites, join board
10. Everyone sees the 3 saved cards

**Flow 2: Group decision making**
1. Board has 8 saved cards
2. Participant A votes 👍 on 3 cards, 👎 on 2
3. Participant B votes 👍 on 2 cards (same ones as A voted up)
4. Participant C RSVPs "Count Me In" on the card with most votes
5. Participants see card with 3 👍 votes and 1 RSVP
6. Participant D comments: "This one looks great!"
7. Group consensus forms around that card
8. They book it outside the app, mark as "Booked" (optional future feature)

**Flow 3: Multi-board management**
1. User is in 3 boards: "Saturday Plans", "Date Night", "Work Event"
2. In personal Saved tab, sees cards from all 3 boards
3. Each card has board badge showing origin
4. Taps a card from "Date Night" board
5. Sees it has 2 votes from partner
6. Taps "View Board" → navigates to Date Night board
7. Sees all other saved cards in that board
8. Votes and RSVPs on cards
9. Returns to Saved tab to see cards from other boards

---

## Critical Feature Behaviors

### Real-Time is Non-Negotiable
Every action by any participant must immediately appear for all other participants. No refresh buttons. No "Pull to refresh." It just works.

### Optimistic Updates
When a user performs an action (vote, RSVP, save card, send message), their UI updates IMMEDIATELY. Don't wait for server confirmation. If server rejects, rollback quietly.

### Same Cards, Different Stacks
All participants see the same pool of cards, but each has their own stack. When I swipe, it only affects MY stack. This prevents one person from swiping through everything before others see them.

### Saved is Shared
The Saved tab is the ONE shared view. Everything in Saved is visible to all participants. This is where group decision-making happens.

### Voting is Optional
Users don't HAVE to vote. Some might just swipe and save. Others might vote on everything. Both are valid. Don't force voting.

### RSVPs are Commitments
RSVP is more serious than voting. "Count Me In" means "I'm actually attending this." Use this to gauge real commitment.

### Discussion is Context
Main discussion is for general chat. Card discussions keep conversation organized. Both are important.

### Presence Matters
Seeing who's online makes the experience feel alive. If everyone's offline, it feels dead. Presence indicators are critical.

### Invites are Flexible
Different situations need different invite methods. In-person? QR code. Remote? Share link. Both must work flawlessly.

### Sessions Persist
A board session isn't temporary. It stays until explicitly deleted. Users can come back days later and everything is still there.

---

## Edge Cases to Handle

**Empty states:**
- No cards in stack: "No more cards right now. Check back later or adjust preferences."
- No saved cards yet: "Start swiping! Saved cards will appear here."
- No messages yet: "Start the conversation!"
- No votes on card: "Be the first to vote!"

**Single participant:**
- Can create board alone
- Can swipe and save cards
- Votes and RSVPs work but feel less meaningful
- Encourage inviting friends

**Participant leaves:**
- Their saves remain
- Their votes remain
- Their RSVPs remain
- They disappear from participant list
- If they were admin, admin transfers

**Session gets deleted:**
- All participants notified
- Board disappears from their list
- Saved cards from that board remain in personal Saved, but board badge shows "Deleted Board"

**Network interruption:**
- Show offline indicator
- Queue actions
- Disable real-time features
- Resume when connection restored

**Conflicting votes:**
- User can only vote once per card (up OR down)
- Changing vote replaces previous vote
- Un-voting removes vote entirely

**Too many participants:**
- Suggest max 15 participants per board (UX gets crowded)
- Show warning if inviting 10+ people

---

## Success Criteria

The collaboration feature is working correctly when:

✅ Multiple users can create and join sessions seamlessly
✅ All participants see saved cards instantly when someone swipes right
✅ Votes update in real-time for all participants
✅ RSVPs update in real-time for all participants
✅ Messages deliver instantly with no lag
✅ Presence indicators accurately show who's online
✅ Saved cards from boards appear in personal Saved tab with board badges
✅ Users can navigate from Saved tab back to boards
✅ All four invite methods work (friends list, link, QR, code)
✅ Offline actions queue and sync when back online
✅ No crashes with 10+ participants active simultaneously
✅ Card swiping feels smooth and responsive (60fps)
✅ Users can participate in multiple boards without confusion
✅ Board discussion and card discussions both work independently

---

## Implementation Notes

**State Management:**
Use Redux to manage all collaboration state. WebSocket events dispatch Redux actions. Components read from Redux and dispatch actions.

**WebSocket Events:**
Every user action emits a WebSocket event. Server broadcasts to all participants. Participants receive and update their Redux store.

**Optimistic Updates:**
Always update local state immediately. Send to server. If server rejects, rollback. Users should never wait.

**Card Generation:**
Cards are generated server-side based on session preferences. All participants receive the same card IDs. Each participant's swipe state is tracked individually.

**Persistence:**
All session data persists in database. On app restart, fetch user's sessions and restore state. No data loss.

**Performance:**
Lazy load cards (don't load all 50 at once). Virtualize message lists. Throttle typing indicators. Debounce vote/RSVP updates.

**Testing:**
Must test with multiple real devices simultaneously. Automated tests can't fully validate real-time sync. Have 3+ people use feature together.

---

This is the collaboration feature. Implement it exactly as described. Real-time sync is critical. User experience must feel magical - when one person does something, everyone else sees it instantly.
