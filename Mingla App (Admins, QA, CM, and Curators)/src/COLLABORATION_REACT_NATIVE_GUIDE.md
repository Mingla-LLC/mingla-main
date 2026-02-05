# Mingla Collaboration Feature - React Native Implementation Guide

## Table of Contents
1. [Overview](#overview)
2. [Architecture & Data Flow](#architecture--data-flow)
3. [Core Features](#core-features)
4. [Technical Implementation](#technical-implementation)
5. [Real-Time Synchronization](#real-time-synchronization)
6. [UI/UX Components](#uiux-components)
7. [State Management](#state-management)
8. [API Integration](#api-integration)
9. [Platform-Specific Considerations](#platform-specific-considerations)
10. [Testing Strategy](#testing-strategy)

---

## Overview

### What is the Collaboration Feature?

The Mingla collaboration system allows users to discover and plan experiences together through **collaborative sessions** (called "boards"). It transforms the solo experience discovery into a group planning tool where friends can:

- **Create collaborative sessions** with friends
- **Discover experiences together** using shared preferences
- **Vote on experiences** (thumbs up/down voting)
- **RSVP to finalize plans** (I'm In / Can't Make It)
- **Discuss cards in real-time** via chat
- **Lock in final decisions** when the group agrees
- **Save cards from boards** to personal collection

### Key Concepts

**Mode Switching:**
- **Solo Mode**: Individual experience discovery using personal preferences
- **Board Mode**: Group discovery using collaborative session preferences
- Users can seamlessly switch between modes

**Sessions vs Boards:**
- Terms used interchangeably in the codebase
- Both refer to collaborative planning groups
- Each session has participants, cards, voting, chat, and preferences

---

## Architecture & Data Flow

### High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        MOBILE APP                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  Solo Mode   │    │ Board Mode   │    │ Connections  │      │
│  │  Discovery   │◄──►│  Discovery   │◄──►│   & Invites  │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                    │                    │              │
│         └────────────────────┴────────────────────┘              │
│                             │                                    │
│                    ┌────────▼─────────┐                          │
│                    │  State Manager   │                          │
│                    │  (Redux/Context) │                          │
│                    └────────┬─────────┘                          │
│                             │                                    │
└─────────────────────────────┼────────────────────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │   API Layer        │
                    │   (REST/GraphQL)   │
                    └─────────┬──────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
┌───────▼────────┐  ┌─────────▼──────┐  ┌─────────▼─────────┐
│  Real-Time WS  │  │  Database API  │  │  Notifications    │
│  (Socket.io)   │  │  (Supabase)    │  │  (Push/In-app)    │
└────────────────┘  └────────────────┘  └───────────────────┘
```

### Complete User Flow

```
1. USER CREATES SESSION
   ├─► Opens CollaborationModule
   ├─► Enters session name
   ├─► Selects friends to invite
   ├─► Creates session
   └─► System sends invitations

2. FRIENDS RECEIVE INVITES
   ├─► Push notification
   ├─► In-app notification
   ├─► Appears in Invites tab
   └─► Can accept/decline

3. SESSION BECOMES ACTIVE
   ├─► All accepted members join
   ├─► Shared preferences set
   ├─► Card discovery begins
   └─► Real-time sync established

4. COLLABORATIVE DISCOVERY
   ├─► Members swipe cards
   ├─► Cards saved to board
   ├─► Voting occurs
   ├─► RSVP tracking
   └─► Chat discussion

5. DECISION & LOCK-IN
   ├─► Admin locks card
   ├─► Added to all members' calendars
   ├─► Session marked completed
   └─► Purchase flow (optional)
```

---

## Core Features

### 1. Session Management

#### Creating a Session

**3-Step Wizard Flow:**

**Step 1: Details**
```typescript
interface SessionDetails {
  name: string;              // Required: "Weekend Brunch Squad"
  description?: string;      // Optional: Additional context
  type: SessionType;         // date-night | group-hangout | adventure
}
```

**Step 2: Friend Selection**
```typescript
interface FriendSelection {
  selectedFriends: Friend[];      // Array of selected friends
  availableFriends: Friend[];     // All friends (online status shown)
  preSelectedFriend?: Friend;     // Optional pre-selection from deep link
}
```

**Step 3: Confirmation**
```typescript
interface SessionConfirmation {
  sessionName: string;
  participants: Friend[];
  totalCount: number;
  creatorBadge: boolean;     // Show "You (Creator)" badge
}
```

**Complete Session Object:**
```typescript
interface CollaborationSession {
  id: string;                          // "board-1234567890"
  name: string;                        // "Weekend Adventure Squad"
  type: SessionType;                   // Icon/theme identifier
  description: string;                 // Brief description
  status: SessionStatus;               // pending | active | voting | locked | completed
  
  // Participants
  participants: Participant[];         // All members
  admins: string[];                    // Admin user IDs
  creatorId: string;                   // Original creator
  currentUserId: string;               // Current logged-in user
  pendingParticipants: number;         // Haven't accepted yet
  totalParticipants: number;           // Total invited
  
  // Content
  cards: BoardCard[];                  // Experience cards
  cardsCount: number;                  // Quick count
  
  // Preferences (set collaboratively)
  hasCollabPreferences: boolean;       // Has preferences been set?
  preferences?: CollaborationPreferences;
  
  // Metadata
  createdAt: string;                   // ISO timestamp
  lastActivity: string;                // Last message/action
  unreadMessages: number;              // For badge count
  voteDeadline?: string;               // Optional voting deadline
  finalizedDate?: string;              // When locked
  
  // UI
  icon: ComponentType;                 // Icon component
  gradient: string;                    // Tailwind gradient classes
}
```

#### Invitation System

**Invitation Flow:**
```typescript
// 1. Creator sends invites
const sendInvitation = async (sessionId: string, userId: string) => {
  const invite: CollaborationInvite = {
    id: generateId(),
    sessionId: sessionId,
    sessionName: session.name,
    fromUser: currentUser,
    toUser: targetUser,
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: addHours(new Date(), 48).toISOString()  // 48h expiry
  };
  
  // Save to database
  await api.createInvite(invite);
  
  // Send push notification
  await pushNotification.send(userId, {
    title: `${currentUser.name} invited you!`,
    body: `Join "${session.name}" collaboration`,
    data: { inviteId: invite.id, sessionId: session.id }
  });
  
  // Send in-app notification
  await inAppNotification.send(userId, invite);
};

// 2. Recipient accepts
const acceptInvitation = async (inviteId: string) => {
  // Update invite status
  await api.updateInvite(inviteId, { status: 'accepted' });
  
  // Add user to session
  const session = await api.getSession(invite.sessionId);
  session.participants.push(currentUser);
  session.pendingParticipants--;
  await api.updateSession(session);
  
  // Notify session members
  await notifySessionMembers(session, `${currentUser.name} joined the session!`);
  
  // Switch user to board mode
  switchMode(session.id);
};
```

**Invitation UI States:**
```typescript
type InviteStatus = 
  | 'pending'    // Awaiting response
  | 'accepted'   // Invite accepted
  | 'declined'   // Invite declined
  | 'canceled'   // Creator canceled
  | 'expired';   // Past expiry time
```

### 2. Collaborative Preferences

**Shared Preference Setting:**

Unlike solo mode (individual preferences), collaboration mode allows the group to set **shared preferences** together.

```typescript
interface CollaborationPreferences {
  // Experience Types (multi-select)
  experienceTypes: string[];        // ['firstDate', 'romantic', 'friendly']
  
  // Budget (group consensus)
  budget: {
    min: number;                    // $25
    max: number;                    // $150
    currency: string;               // 'USD'
  };
  
  // Categories (multi-select)
  categories: string[];             // ['sipChill', 'diningExp', 'wellness']
  
  // Date & Time
  dateOption: DateOption;           // 'now' | 'today' | 'weekend' | 'pick'
  selectedDate?: string;            // ISO date if 'pick'
  timeSlots: string[];              // ['brunch', 'dinner']
  
  // Location
  location: {
    type: 'gps' | 'search';
    address?: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  
  // Travel
  travelMode: TravelMode;           // 'walking' | 'biking' | 'transit' | 'driving'
  travelConstraints: {
    type: 'time' | 'distance';
    maxMinutes?: number;            // 30
    maxDistance?: number;           // 10 km
  };
}
```

**Preference UI:**
```typescript
// Exact same UI as PreferencesSheet (solo mode)
// Same icons, GPS support, Google Places integration
// Only difference: saved to session.preferences instead of user.preferences
```

### 3. Board Cards & Voting

#### Board Card Structure

**Enhanced Card with Voting/RSVP:**
```typescript
interface BoardCard {
  // Base card data (same as solo cards)
  id: string;
  title: string;
  category: string;
  categoryIcon: ComponentType;
  image: string;
  images: string[];
  rating: number;
  reviewCount: number;
  travelTime: string;
  priceRange: string;
  description: string;
  fullDescription: string;
  address: string;
  highlights: string[];
  matchScore: number;
  matchFactors: {
    location: number;
    budget: number;
    category: number;
    time: number;
    popularity: number;
  };
  
  // Board-specific data
  votes: {
    yes: number;                    // Total thumbs up
    no: number;                     // Total thumbs down
    userVote: 'yes' | 'no' | null;  // Current user's vote
    voters: {                       // Track who voted what
      [userId: string]: 'yes' | 'no';
    };
  };
  
  rsvps: {
    responded: number;              // How many RSVP'd
    total: number;                  // Total participants
    userRSVP: 'yes' | 'no' | null;  // Current user's RSVP
    attendees: string[];            // User IDs attending
  };
  
  messages: number;                 // Chat message count
  isLocked: boolean;                // Finalized by admin?
  lockedAt?: string;                // Lock timestamp
  lockedBy?: string;                // Admin who locked
  
  // Metadata
  addedBy: string;                  // Who added to board
  addedAt: string;                  // When added
  source: 'collaboration';          // Always collaboration for board cards
}
```

#### Voting System

**Vote Flow:**
```typescript
const handleVote = async (cardId: string, vote: 'yes' | 'no') => {
  const card = board.cards.find(c => c.id === cardId);
  
  // Update vote counts
  if (card.votes.userVote === vote) {
    // Toggle off (remove vote)
    card.votes[vote]--;
    card.votes.userVote = null;
    delete card.votes.voters[currentUserId];
  } else {
    // Remove previous vote if exists
    if (card.votes.userVote) {
      card.votes[card.votes.userVote]--;
    }
    
    // Add new vote
    card.votes[vote]++;
    card.votes.userVote = vote;
    card.votes.voters[currentUserId] = vote;
  }
  
  // Sync to database
  await api.updateBoardCard(boardId, cardId, { votes: card.votes });
  
  // Broadcast to other users
  socket.emit('card:voted', {
    boardId,
    cardId,
    userId: currentUserId,
    vote: card.votes.userVote
  });
  
  // Update local state
  updateBoardCard(cardId, card);
};
```

**Vote UI States:**
```typescript
// Thumbs Up Button
<button
  className={
    card.votes.userVote === 'yes'
      ? 'bg-green-500 text-white'         // Voted yes
      : 'bg-green-50 text-green-700'      // Not voted
  }
>
  <ThumbsUp /> {card.votes.yes}
</button>

// Thumbs Down Button
<button
  className={
    card.votes.userVote === 'no'
      ? 'bg-red-500 text-white'           // Voted no
      : 'bg-red-50 text-red-700'          // Not voted
  }
>
  <ThumbsDown /> {card.votes.no}
</button>
```

#### RSVP System

**RSVP Flow:**
```typescript
const handleRSVP = async (cardId: string, rsvp: 'yes' | 'no') => {
  const card = board.cards.find(c => c.id === cardId);
  
  // Update RSVP
  if (card.rsvps.userRSVP === rsvp) {
    // Toggle off
    card.rsvps.responded--;
    card.rsvps.userRSVP = null;
    card.rsvps.attendees = card.rsvps.attendees.filter(id => id !== currentUserId);
  } else {
    // Update previous RSVP if exists
    if (!card.rsvps.userRSVP) {
      card.rsvps.responded++;
    }
    
    card.rsvps.userRSVP = rsvp;
    
    if (rsvp === 'yes') {
      card.rsvps.attendees.push(currentUserId);
    } else {
      card.rsvps.attendees = card.rsvps.attendees.filter(id => id !== currentUserId);
    }
  }
  
  // Sync to database
  await api.updateBoardCard(boardId, cardId, { rsvps: card.rsvps });
  
  // Broadcast to other users
  socket.emit('card:rsvp', {
    boardId,
    cardId,
    userId: currentUserId,
    rsvp: card.rsvps.userRSVP
  });
  
  // Update local state
  updateBoardCard(cardId, card);
};
```

**RSVP Progress:**
```typescript
// Show RSVP progress
const rsvpProgress = `${card.rsvps.responded} / ${card.rsvps.total} RSVP'd`;
```

#### Card Locking (Finalization)

**Lock Flow (Admin Only):**
```typescript
const lockCard = async (cardId: string) => {
  // Check admin permission
  if (!board.admins.includes(currentUserId)) {
    throw new Error('Only admins can lock cards');
  }
  
  const card = board.cards.find(c => c.id === cardId);
  
  // Lock the card
  card.isLocked = true;
  card.lockedAt = new Date().toISOString();
  card.lockedBy = currentUserId;
  
  // Add to all participants' calendars
  for (const participant of board.participants) {
    await addToUserCalendar(participant.id, {
      experience: card,
      sessionName: board.name,
      sessionType: board.type,
      isLocked: true,
      lockedAt: card.lockedAt
    });
  }
  
  // Update board
  await api.updateBoardCard(boardId, cardId, card);
  
  // Notify all members
  await notifySessionMembers(board, 
    `${currentUser.name} locked in "${card.title}"! Check your calendar.`
  );
  
  // Broadcast
  socket.emit('card:locked', { boardId, cardId, card });
};
```

**Locked Card UI:**
```typescript
// Locked badge
{card.isLocked && (
  <div className="bg-green-500 text-white px-3 py-1 rounded-full">
    <Lock className="w-4 h-4" />
    <span>Locked</span>
  </div>
)}

// Locked card actions disabled
{!card.isLocked ? (
  // Show voting/RSVP buttons
) : (
  // Show "Added to Calendar" message
  <div className="bg-green-50 border border-green-200 rounded-xl p-3">
    <Check className="w-4 h-4 text-green-700" />
    <span>Added to Calendar</span>
    <p className="text-xs">Locked {formatDate(card.lockedAt)}</p>
  </div>
)}
```

### 4. Swipe-to-Save Functionality

**Swipe Gestures:**

The React Native implementation uses `react-native-gesture-handler` for swipe detection.

```typescript
import { 
  GestureHandlerRootView,
  PanGestureHandler,
  PanGestureHandlerGestureEvent
} from 'react-native-gesture-handler';
import Animated, {
  useAnimatedGestureHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  runOnJS
} from 'react-native-reanimated';

const SWIPE_THRESHOLD = 100;      // Regular swipe
const SAVE_THRESHOLD = 150;       // Strong swipe right to save

const SwipeableCard = ({ card, onSave, onNavigate }) => {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  
  const gestureHandler = useAnimatedGestureHandler<PanGestureHandlerGestureEvent>({
    onStart: (_, ctx) => {
      ctx.startX = translateX.value;
    },
    onActive: (event, ctx) => {
      // Only allow horizontal swiping
      if (Math.abs(event.translationX) > Math.abs(event.translationY)) {
        translateX.value = ctx.startX + event.translationX;
      }
    },
    onEnd: (event) => {
      const threshold = event.velocityX > 0 ? SAVE_THRESHOLD : SWIPE_THRESHOLD;
      
      if (translateX.value > SAVE_THRESHOLD) {
        // Strong swipe right → Save to board AND personal saved
        runOnJS(onSave)(card);
        translateX.value = withSpring(0);
      } else if (translateX.value > SWIPE_THRESHOLD) {
        // Regular swipe right → Previous card
        runOnJS(onNavigate)('previous');
        translateX.value = withSpring(0);
      } else if (translateX.value < -SWIPE_THRESHOLD) {
        // Swipe left → Next card
        runOnJS(onNavigate)('next');
        translateX.value = withSpring(0);
      } else {
        // Snap back
        translateX.value = withSpring(0);
      }
    }
  });
  
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value }
    ]
  }));
  
  return (
    <PanGestureHandler onGestureEvent={gestureHandler}>
      <Animated.View style={animatedStyle}>
        <CardContent card={card} />
      </Animated.View>
    </PanGestureHandler>
  );
};
```

**Save to Both Locations:**
```typescript
const handleSaveCard = async (card: BoardCard) => {
  // 1. Add to board (if in board mode)
  if (currentMode !== 'solo') {
    const boardCard = {
      ...card,
      addedBy: currentUserId,
      addedAt: new Date().toISOString(),
      votes: { yes: 1, no: 0, userVote: 'yes', voters: { [currentUserId]: 'yes' } },
      rsvps: { responded: 0, total: board.participants.length, userRSVP: null, attendees: [] },
      messages: 0,
      isLocked: false,
      source: 'collaboration'
    };
    
    await api.addCardToBoard(boardId, boardCard);
    socket.emit('card:added', { boardId, card: boardCard });
  }
  
  // 2. ALSO add to personal saved (dual-save feature)
  const savedCard = {
    ...card,
    savedAt: new Date().toISOString(),
    sessionType: currentMode === 'solo' ? 'solo' : boardId,
    source: currentMode === 'solo' ? 'solo' : 'collaboration'
  };
  
  await api.addToSaved(currentUserId, savedCard);
  
  // 3. Show success toast
  Toast.show({
    type: 'success',
    text1: '💖 Saved!',
    text2: currentMode === 'solo' 
      ? 'Added to your favorites'
      : 'Added to board and your favorites',
    visibilityTime: 2000
  });
  
  // 4. Update stats
  updateUserStats({ experiencesSaved: +1 });
};
```

### 5. Board Discussion & Chat

**Chat System:**

Each board has a dedicated chat where members can discuss cards.

```typescript
interface BoardMessage {
  id: string;
  boardId: string;
  user: {
    id: string;
    name: string;
    avatar?: string;
  };
  content: string;
  timestamp: string;
  
  // Rich features
  mentions?: string[];          // @username mentions
  cardTags?: string[];          // #CardName tags
  replyTo?: string;             // Message ID if reply
  reactions?: {                 // Message reactions
    [emoji: string]: string[];  // User IDs who reacted
  };
  
  // Metadata
  isEdited: boolean;
  editedAt?: string;
  isDeleted: boolean;
}
```

**Chat UI Component:**
```typescript
const BoardDiscussion = ({ board, activeTab }) => {
  const [messages, setMessages] = useState<BoardMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [showCardTags, setShowCardTags] = useState(false);
  
  // Real-time message listener
  useEffect(() => {
    const socket = getSocket();
    
    socket.on('message:new', (message: BoardMessage) => {
      if (message.boardId === board.id) {
        setMessages(prev => [...prev, message]);
      }
    });
    
    return () => socket.off('message:new');
  }, [board.id]);
  
  const sendMessage = async () => {
    const message: BoardMessage = {
      id: generateId(),
      boardId: board.id,
      user: currentUser,
      content: newMessage,
      timestamp: new Date().toISOString(),
      mentions: extractMentions(newMessage),
      cardTags: extractCardTags(newMessage),
      isEdited: false,
      isDeleted: false
    };
    
    // Save to database
    await api.createMessage(message);
    
    // Broadcast to other users
    socket.emit('message:send', message);
    
    // Update unread counts for other users
    updateUnreadCounts(board.participants, currentUserId);
    
    // Clear input
    setNewMessage('');
  };
  
  return (
    <View>
      {/* Tab switcher */}
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
      
      {activeTab === 'cards' ? (
        <SwipeableBoardCards 
          cards={board.cards}
          onVote={handleVote}
          onRSVP={handleRSVP}
          onSaveCard={handleSaveCard}
        />
      ) : (
        <>
          {/* Messages list */}
          <FlatList
            data={messages}
            renderItem={({ item }) => <MessageBubble message={item} />}
            keyExtractor={m => m.id}
          />
          
          {/* Input */}
          <View>
            <TextInput
              value={newMessage}
              onChangeText={setNewMessage}
              placeholder="Type a message..."
              onKeyPress={handleKeyPress}
            />
            <Button onPress={sendMessage} title="Send" />
          </View>
        </>
      )}
    </View>
  );
};
```

**Mention & Tag System:**
```typescript
// Detect @ mentions
const extractMentions = (text: string): string[] => {
  const regex = /@(\w+)/g;
  const matches = text.match(regex);
  return matches ? matches.map(m => m.substring(1)) : [];
};

// Detect # card tags
const extractCardTags = (text: string): string[] => {
  const regex = /#([^#\s]+)/g;
  const matches = text.match(regex);
  return matches ? matches.map(m => m.substring(1)) : [];
};

// Autocomplete for mentions
const MentionAutocomplete = ({ participants, onSelect }) => (
  <FlatList
    data={participants}
    renderItem={({ item }) => (
      <TouchableOpacity onPress={() => onSelect(item)}>
        <Text>@{item.name}</Text>
      </TouchableOpacity>
    )}
  />
);
```

### 6. Member Management & Permissions

**User Roles:**
```typescript
type UserRole = 'creator' | 'admin' | 'member';

const getUserRole = (board: CollaborationSession, userId: string): UserRole => {
  if (board.creatorId === userId) return 'creator';
  if (board.admins.includes(userId)) return 'admin';
  return 'member';
};
```

**Permission Matrix:**

| Action | Creator | Admin | Member |
|--------|---------|-------|--------|
| Add cards | ✅ | ✅ | ✅ |
| Vote on cards | ✅ | ✅ | ✅ |
| RSVP | ✅ | ✅ | ✅ |
| Send messages | ✅ | ✅ | ✅ |
| **Lock cards** | ✅ | ✅ | ❌ |
| **Invite members** | ✅ | ✅ | ❌ |
| **Remove members** | ✅ | ✅ | ❌ |
| **Promote to admin** | ✅ | ❌ | ❌ |
| **Demote admin** | ✅ | ❌ | ❌ |
| **Delete session** | ✅ | ❌ | ❌ |
| Leave session | ✅ (with conditions) | ✅ | ✅ |

**Member Management UI:**
```typescript
const MemberManagementModal = ({ board, onClose }) => {
  const currentUserRole = getUserRole(board, currentUserId);
  
  return (
    <Modal visible onRequestClose={onClose}>
      <Text>{board.name} Members</Text>
      
      <FlatList
        data={board.participants}
        renderItem={({ item: participant }) => (
          <View>
            <Avatar source={participant.avatar} />
            <Text>{participant.name}</Text>
            
            {/* Role badge */}
            {board.creatorId === participant.id && <Badge text="Creator" />}
            {board.admins.includes(participant.id) && <Badge text="Admin" />}
            
            {/* Actions (only for admins/creator) */}
            {currentUserRole !== 'member' && (
              <Menu>
                {currentUserRole === 'creator' && (
                  <>
                    {!board.admins.includes(participant.id) ? (
                      <MenuItem onPress={() => promoteToAdmin(participant.id)}>
                        Promote to Admin
                      </MenuItem>
                    ) : (
                      <MenuItem onPress={() => demoteFromAdmin(participant.id)}>
                        Remove Admin
                      </MenuItem>
                    )}
                  </>
                )}
                
                {participant.id !== currentUserId && (
                  <MenuItem 
                    onPress={() => removeMember(participant.id)}
                    destructive
                  >
                    Remove from Board
                  </MenuItem>
                )}
              </Menu>
            )}
          </View>
        )}
      />
    </Modal>
  );
};
```

---

## Technical Implementation

### State Management (Redux/Context)

**Redux Store Structure:**
```typescript
interface RootState {
  auth: {
    user: User | null;
    isAuthenticated: boolean;
  };
  
  collaboration: {
    sessions: CollaborationSession[];
    activeSessionId: string | null;
    invites: {
      sent: CollaborationInvite[];
      received: CollaborationInvite[];
    };
  };
  
  boards: {
    [boardId: string]: {
      cards: BoardCard[];
      messages: BoardMessage[];
      participants: Participant[];
      unreadCount: number;
    };
  };
  
  discovery: {
    mode: 'solo' | string;           // 'solo' or board ID
    preferences: any;
    cards: Card[];
    removedCardIds: string[];
  };
  
  saved: {
    cards: SavedCard[];
  };
  
  calendar: {
    entries: CalendarEntry[];
  };
  
  friends: {
    list: Friend[];
    requests: FriendRequest[];
  };
}
```

**Redux Actions:**
```typescript
// Session actions
const createSession = (session: CollaborationSession) => ({
  type: 'collaboration/createSession',
  payload: session
});

const updateSession = (sessionId: string, updates: Partial<CollaborationSession>) => ({
  type: 'collaboration/updateSession',
  payload: { sessionId, updates }
});

const switchMode = (mode: 'solo' | string) => ({
  type: 'discovery/switchMode',
  payload: mode
});

// Board actions
const addCardToBoard = (boardId: string, card: BoardCard) => ({
  type: 'boards/addCard',
  payload: { boardId, card }
});

const voteOnCard = (boardId: string, cardId: string, vote: 'yes' | 'no') => ({
  type: 'boards/voteCard',
  payload: { boardId, cardId, vote }
});

const lockCard = (boardId: string, cardId: string) => ({
  type: 'boards/lockCard',
  payload: { boardId, cardId }
});

// Message actions
const sendMessage = (boardId: string, message: BoardMessage) => ({
  type: 'boards/sendMessage',
  payload: { boardId, message }
});
```

**Redux Thunks (Async Actions):**
```typescript
export const createSessionAsync = (sessionData: CreateSessionData) => {
  return async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      // Create session in database
      const session = await api.createSession(sessionData);
      
      // Send invitations
      for (const friendId of sessionData.friendIds) {
        await dispatch(sendInvitationAsync(session.id, friendId));
      }
      
      // Add to local state
      dispatch(createSession(session));
      
      // Switch to board mode
      dispatch(switchMode(session.id));
      
      // Navigate to board
      navigation.navigate('BoardDiscussion', { boardId: session.id });
      
      return session;
    } catch (error) {
      console.error('Failed to create session:', error);
      throw error;
    }
  };
};

export const voteOnCardAsync = (boardId: string, cardId: string, vote: 'yes' | 'no') => {
  return async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      // Optimistic update
      dispatch(voteOnCard(boardId, cardId, vote));
      
      // Update database
      await api.updateCardVote(boardId, cardId, vote);
      
      // Broadcast to other users
      socket.emit('card:voted', { boardId, cardId, vote });
    } catch (error) {
      // Revert on error
      console.error('Failed to vote:', error);
      // Implement revert logic
    }
  };
};
```

### API Integration

**REST API Endpoints:**
```typescript
// Base URL
const API_BASE = 'https://api.mingla.com/v1';

// Sessions
GET    /sessions                     // List user's sessions
POST   /sessions                     // Create new session
GET    /sessions/:id                 // Get session details
PATCH  /sessions/:id                 // Update session
DELETE /sessions/:id                 // Delete session

// Invitations
GET    /invitations                  // List user's invitations
POST   /invitations                  // Send invitation
PATCH  /invitations/:id/accept       // Accept invitation
PATCH  /invitations/:id/decline      // Decline invitation
DELETE /invitations/:id              // Cancel invitation

// Board Cards
GET    /sessions/:id/cards           // List board cards
POST   /sessions/:id/cards           // Add card to board
PATCH  /sessions/:id/cards/:cardId   // Update card (vote/RSVP/lock)
DELETE /sessions/:id/cards/:cardId   // Remove card from board

// Messages
GET    /sessions/:id/messages        // List board messages
POST   /sessions/:id/messages        // Send message
PATCH  /sessions/:id/messages/:msgId // Edit message
DELETE /sessions/:id/messages/:msgId // Delete message

// Members
GET    /sessions/:id/members         // List members
POST   /sessions/:id/members         // Add member
DELETE /sessions/:id/members/:userId // Remove member
PATCH  /sessions/:id/members/:userId/promote   // Promote to admin
PATCH  /sessions/:id/members/:userId/demote    // Demote from admin
```

**API Client Implementation:**
```typescript
import axios from 'axios';

class MinglaAPI {
  private client;
  
  constructor(baseURL: string) {
    this.client = axios.create({
      baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    // Add auth interceptor
    this.client.interceptors.request.use(async (config) => {
      const token = await getAuthToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });
  }
  
  // Sessions
  async getSessions(): Promise<CollaborationSession[]> {
    const { data } = await this.client.get('/sessions');
    return data;
  }
  
  async createSession(session: CreateSessionData): Promise<CollaborationSession> {
    const { data } = await this.client.post('/sessions', session);
    return data;
  }
  
  async updateSession(id: string, updates: Partial<CollaborationSession>): Promise<CollaborationSession> {
    const { data } = await this.client.patch(`/sessions/${id}`, updates);
    return data;
  }
  
  // Board Cards
  async getBoardCards(sessionId: string): Promise<BoardCard[]> {
    const { data } = await this.client.get(`/sessions/${sessionId}/cards`);
    return data;
  }
  
  async addCardToBoard(sessionId: string, card: BoardCard): Promise<BoardCard> {
    const { data } = await this.client.post(`/sessions/${sessionId}/cards`, card);
    return data;
  }
  
  async updateCardVote(sessionId: string, cardId: string, vote: 'yes' | 'no'): Promise<void> {
    await this.client.patch(`/sessions/${sessionId}/cards/${cardId}`, {
      action: 'vote',
      vote
    });
  }
  
  async lockCard(sessionId: string, cardId: string): Promise<void> {
    await this.client.patch(`/sessions/${sessionId}/cards/${cardId}`, {
      action: 'lock'
    });
  }
  
  // Messages
  async getMessages(sessionId: string, limit = 50, offset = 0): Promise<BoardMessage[]> {
    const { data } = await this.client.get(`/sessions/${sessionId}/messages`, {
      params: { limit, offset }
    });
    return data;
  }
  
  async sendMessage(sessionId: string, message: Omit<BoardMessage, 'id' | 'timestamp'>): Promise<BoardMessage> {
    const { data } = await this.client.post(`/sessions/${sessionId}/messages`, message);
    return data;
  }
}

export const api = new MinglaAPI(API_BASE);
```

---

## Real-Time Synchronization

### WebSocket Implementation (Socket.io)

**Socket Connection:**
```typescript
import io, { Socket } from 'socket.io-client';

class RealtimeService {
  private socket: Socket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  
  connect(userId: string) {
    this.socket = io('wss://realtime.mingla.com', {
      auth: { userId },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: this.maxReconnectAttempts
    });
    
    this.setupListeners();
  }
  
  private setupListeners() {
    if (!this.socket) return;
    
    // Connection events
    this.socket.on('connect', () => {
      console.log('Socket connected');
      this.reconnectAttempts = 0;
    });
    
    this.socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
    });
    
    this.socket.on('reconnect_attempt', (attemptNumber) => {
      this.reconnectAttempts = attemptNumber;
    });
    
    // Collaboration events
    this.socket.on('session:updated', (data) => {
      store.dispatch(updateSession(data.sessionId, data.updates));
    });
    
    this.socket.on('card:added', (data) => {
      store.dispatch(addCardToBoard(data.boardId, data.card));
      // Show notification
      showNotification({
        title: 'New Card Added',
        body: `${data.userName} added "${data.card.title}"`,
        data: { boardId: data.boardId }
      });
    });
    
    this.socket.on('card:voted', (data) => {
      store.dispatch(updateCardVote(data.boardId, data.cardId, data.vote));
    });
    
    this.socket.on('card:rsvp', (data) => {
      store.dispatch(updateCardRSVP(data.boardId, data.cardId, data.rsvp));
    });
    
    this.socket.on('card:locked', (data) => {
      store.dispatch(lockCard(data.boardId, data.cardId));
      // Show notification
      showNotification({
        title: 'Card Locked!',
        body: `"${data.card.title}" has been finalized`,
        data: { boardId: data.boardId, cardId: data.cardId }
      });
    });
    
    this.socket.on('message:new', (data) => {
      store.dispatch(addMessage(data.boardId, data.message));
      // Increment unread count if not in chat
      const state = store.getState();
      if (state.navigation.currentScreen !== 'BoardDiscussion') {
        store.dispatch(incrementUnread(data.boardId));
      }
    });
    
    this.socket.on('member:joined', (data) => {
      store.dispatch(addMember(data.sessionId, data.member));
      showNotification({
        title: 'New Member',
        body: `${data.member.name} joined ${data.sessionName}`,
        data: { sessionId: data.sessionId }
      });
    });
    
    this.socket.on('member:left', (data) => {
      store.dispatch(removeMember(data.sessionId, data.memberId));
    });
  }
  
  // Join a specific session room
  joinSession(sessionId: string) {
    this.socket?.emit('session:join', { sessionId });
  }
  
  // Leave a session room
  leaveSession(sessionId: string) {
    this.socket?.emit('session:leave', { sessionId });
  }
  
  // Emit events
  emitCardVoted(boardId: string, cardId: string, vote: 'yes' | 'no') {
    this.socket?.emit('card:voted', { boardId, cardId, vote });
  }
  
  emitMessage(boardId: string, message: BoardMessage) {
    this.socket?.emit('message:send', { boardId, message });
  }
  
  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }
}

export const realtimeService = new RealtimeService();
```

**Session Room Management:**
```typescript
// When user opens a board
useEffect(() => {
  if (boardId) {
    realtimeService.joinSession(boardId);
    
    return () => {
      realtimeService.leaveSession(boardId);
    };
  }
}, [boardId]);
```

### Conflict Resolution

**Optimistic Updates with Rollback:**
```typescript
const optimisticVote = async (boardId: string, cardId: string, vote: 'yes' | 'no') => {
  // 1. Save current state for rollback
  const currentState = store.getState().boards[boardId].cards.find(c => c.id === cardId);
  
  try {
    // 2. Optimistic update (immediate UI feedback)
    dispatch(voteOnCard(boardId, cardId, vote));
    
    // 3. Send to server
    await api.updateCardVote(boardId, cardId, vote);
    
    // 4. Broadcast to other clients
    realtimeService.emitCardVoted(boardId, cardId, vote);
  } catch (error) {
    // 5. Rollback on error
    dispatch(setCard(boardId, cardId, currentState));
    
    // 6. Show error
    Toast.show({
      type: 'error',
      text1: 'Failed to vote',
      text2: 'Please try again'
    });
  }
};
```

**Last-Write-Wins (LWW) Strategy:**
```typescript
// Each update includes a timestamp
interface Update {
  data: any;
  timestamp: number;
  userId: string;
}

const mergeUpdates = (local: Update, remote: Update) => {
  // Remote update is newer
  if (remote.timestamp > local.timestamp) {
    return remote.data;
  }
  // Local update is newer or same time (current user wins ties)
  return local.data;
};
```

---

## UI/UX Components

### React Native Components

**CollaborationModule (Modal):**
```typescript
import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, FlatList } from 'react-native';
import { TabView, TabBar } from 'react-native-tab-view';

const CollaborationModule = ({ 
  visible, 
  onClose, 
  currentMode, 
  onModeChange,
  sessions,
  invites,
  friends,
  onCreateSession 
}) => {
  const [index, setIndex] = useState(0);
  const [routes] = useState([
    { key: 'sessions', title: 'Sessions' },
    { key: 'invites', title: 'Invites' },
    { key: 'create', title: 'Create' }
  ]);
  
  const renderScene = ({ route }) => {
    switch (route.key) {
      case 'sessions':
        return <SessionsTab sessions={sessions} currentMode={currentMode} onModeChange={onModeChange} />;
      case 'invites':
        return <InvitesTab invites={invites} />;
      case 'create':
        return <CreateTab friends={friends} onCreateSession={onCreateSession} />;
      default:
        return null;
    }
  };
  
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1 }}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Collaboration</Text>
          <TouchableOpacity onPress={onClose}>
            <Text>✕</Text>
          </TouchableOpacity>
        </View>
        
        {/* Tab View */}
        <TabView
          navigationState={{ index, routes }}
          renderScene={renderScene}
          onIndexChange={setIndex}
          renderTabBar={props => (
            <TabBar
              {...props}
              indicatorStyle={{ backgroundColor: '#eb7825' }}
              style={{ backgroundColor: 'white' }}
              labelStyle={{ color: '#000' }}
            />
          )}
        />
      </View>
    </Modal>
  );
};
```

**SwipeableBoardCards:**
```typescript
import React, { useRef } from 'react';
import { View, Text, Image, Animated, Dimensions } from 'react-native';
import { PanGestureHandler } from 'react-native-gesture-handler';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - 32;

const SwipeableBoardCards = ({ cards, onVote, onRSVP, onSaveCard }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const translateX = useSharedValue(0);
  
  const currentCard = cards[currentIndex];
  
  if (!currentCard) {
    return <EmptyState message="No cards in this session yet" />;
  }
  
  return (
    <View style={styles.container}>
      {/* Header with navigation */}
      <View style={styles.header}>
        <Text style={styles.title}>Session Cards</Text>
        <Text style={styles.counter}>{currentIndex + 1} of {cards.length}</Text>
      </View>
      
      {/* Card Container */}
      <PanGestureHandler onGestureEvent={gestureHandler}>
        <Animated.View style={[styles.card, animatedStyle]}>
          {/* Hero Image */}
          <Image source={{ uri: currentCard.image }} style={styles.image} />
          
          {/* Overlay Content */}
          <View style={styles.overlay}>
            <Text style={styles.cardTitle}>{currentCard.title}</Text>
            <Text style={styles.category}>{currentCard.category}</Text>
          </View>
          
          {/* Voting Section */}
          {!currentCard.isLocked && (
            <View style={styles.voting}>
              <TouchableOpacity
                style={[
                  styles.voteButton,
                  currentCard.votes.userVote === 'yes' && styles.votedYes
                ]}
                onPress={() => onVote(currentCard.id, 'yes')}
              >
                <ThumbsUpIcon />
                <Text>{currentCard.votes.yes}</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[
                  styles.voteButton,
                  currentCard.votes.userVote === 'no' && styles.votedNo
                ]}
                onPress={() => onVote(currentCard.id, 'no')}
              >
                <ThumbsDownIcon />
                <Text>{currentCard.votes.no}</Text>
              </TouchableOpacity>
            </View>
          )}
          
          {/* RSVP Button */}
          {!currentCard.isLocked && (
            <TouchableOpacity
              style={[
                styles.rsvpButton,
                currentCard.rsvps.userRSVP === 'yes' && styles.rsvpActive
              ]}
              onPress={() => onRSVP(currentCard.id, 'yes')}
            >
              <Text>
                {currentCard.rsvps.userRSVP === 'yes' ? "RSVP'd Yes" : 'RSVP Yes'}
              </Text>
            </TouchableOpacity>
          )}
          
          {/* Locked State */}
          {currentCard.isLocked && (
            <View style={styles.locked}>
              <LockIcon />
              <Text>Added to Calendar</Text>
              <Text style={styles.lockedTime}>Locked {currentCard.lockedAt}</Text>
            </View>
          )}
        </Animated.View>
      </PanGestureHandler>
    </View>
  );
};
```

**BoardDiscussion:**
```typescript
const BoardDiscussion = ({ board, onBack }) => {
  const [activeTab, setActiveTab] = useState<'cards' | 'discussion'>('cards');
  const [messages, setMessages] = useState<BoardMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  
  return (
    <SafeAreaView style={{ flex: 1 }}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <ArrowLeftIcon />
        </TouchableOpacity>
        <Text style={styles.boardName}>{board.name}</Text>
        <TouchableOpacity onPress={() => setShowMemberManagement(true)}>
          <UsersIcon />
        </TouchableOpacity>
      </View>
      
      {/* Tab Switcher */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'cards' && styles.activeTab]}
          onPress={() => setActiveTab('cards')}
        >
          <Text>Cards ({board.cardsCount})</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'discussion' && styles.activeTab]}
          onPress={() => setActiveTab('discussion')}
        >
          <Text>Discussion</Text>
          {board.unreadMessages > 0 && (
            <View style={styles.badge}>
              <Text>{board.unreadMessages}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
      
      {/* Content */}
      {activeTab === 'cards' ? (
        <SwipeableBoardCards
          cards={board.cards}
          onVote={handleVote}
          onRSVP={handleRSVP}
          onSaveCard={handleSaveCard}
        />
      ) : (
        <View style={{ flex: 1 }}>
          {/* Messages */}
          <FlatList
            data={messages}
            renderItem={({ item }) => <MessageBubble message={item} />}
            keyExtractor={m => m.id}
            inverted
          />
          
          {/* Input */}
          <KeyboardAvoidingView behavior="padding">
            <View style={styles.inputContainer}>
              <TextInput
                value={newMessage}
                onChangeText={setNewMessage}
                placeholder="Type a message..."
                style={styles.input}
              />
              <TouchableOpacity onPress={handleSendMessage}>
                <SendIcon />
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      )}
    </SafeAreaView>
  );
};
```

### Animations & Transitions

**Card Swipe Animation:**
```typescript
const SWIPE_THRESHOLD = 100;
const SAVE_THRESHOLD = 150;

const gestureHandler = useAnimatedGestureHandler({
  onStart: (_, ctx) => {
    ctx.startX = translateX.value;
  },
  onActive: (event, ctx) => {
    if (Math.abs(event.translationX) > Math.abs(event.translationY)) {
      translateX.value = ctx.startX + event.translationX;
      
      // Show visual feedback for save threshold
      if (event.translationX > SAVE_THRESHOLD) {
        runOnJS(setShowSaveIndicator)(true);
      } else {
        runOnJS(setShowSaveIndicator)(false);
      }
    }
  },
  onEnd: (event) => {
    if (translateX.value > SAVE_THRESHOLD) {
      // Save card
      runOnJS(onSaveCard)(currentCard);
      runOnJS(showSaveToast)();
      translateX.value = withSpring(0);
    } else if (translateX.value > SWIPE_THRESHOLD) {
      // Previous card
      runOnJS(navigateToPrevious)();
      translateX.value = withSpring(0);
    } else if (translateX.value < -SWIPE_THRESHOLD) {
      // Next card
      runOnJS(navigateToNext)();
      translateX.value = withSpring(0);
    } else {
      // Snap back
      translateX.value = withSpring(0);
    }
  }
});

const animatedStyle = useAnimatedStyle(() => ({
  transform: [{ translateX: translateX.value }]
}));
```

**Vote Button Animation:**
```typescript
const VoteButton = ({ active, onPress, count, type }) => {
  const scale = useSharedValue(1);
  
  const handlePress = () => {
    // Bounce animation
    scale.value = withSequence(
      withSpring(1.2, { damping: 2 }),
      withSpring(1)
    );
    onPress();
  };
  
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }]
  }));
  
  return (
    <TouchableOpacity onPress={handlePress}>
      <Animated.View style={[styles.voteButton, animatedStyle, active && styles.active]}>
        {type === 'yes' ? <ThumbsUp /> : <ThumbsDown />}
        <Text>{count}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
};
```

---

## Platform-Specific Considerations

### iOS

**Calendar Integration:**
```typescript
import * as Calendar from 'expo-calendar';

const addToCalendar = async (experience: Experience, sessionName: string) => {
  // Request permission
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('Permission Denied', 'Calendar access is required');
    return;
  }
  
  // Get default calendar
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const defaultCalendar = calendars.find(cal => cal.allowsModifications) || calendars[0];
  
  // Create event
  const eventId = await Calendar.createEventAsync(defaultCalendar.id, {
    title: `${sessionName}: ${experience.title}`,
    startDate: experience.suggestedDate || new Date(),
    endDate: addHours(experience.suggestedDate || new Date(), 2),
    location: experience.address,
    notes: `Planned via Mingla\n\n${experience.description}`,
    alarms: [
      { relativeOffset: -60 },  // 1 hour before
      { relativeOffset: -1440 } // 1 day before
    ]
  });
  
  return eventId;
};
```

**Push Notifications (APNs):**
```typescript
import * as Notifications from 'expo-notifications';

const registerForPushNotifications = async () => {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  
  if (finalStatus !== 'granted') {
    return;
  }
  
  const token = (await Notifications.getExpoPushTokenAsync()).data;
  
  // Send token to backend
  await api.registerPushToken(token, 'ios');
};

// Handle notification tap
Notifications.addNotificationResponseReceivedListener(response => {
  const data = response.notification.request.content.data;
  
  if (data.type === 'collaboration:invite') {
    navigation.navigate('CollaborationModule', {
      tab: 'invites',
      inviteId: data.inviteId
    });
  } else if (data.type === 'board:card_added') {
    navigation.navigate('BoardDiscussion', {
      boardId: data.boardId,
      tab: 'cards'
    });
  }
});
```

### Android

**Notification Channels:**
```typescript
import * as Notifications from 'expo-notifications';

const createNotificationChannels = async () => {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('collaboration-invites', {
      name: 'Collaboration Invites',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'invite.wav',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#eb7825'
    });
    
    await Notifications.setNotificationChannelAsync('board-updates', {
      name: 'Board Updates',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'notification.wav'
    });
    
    await Notifications.setNotificationChannelAsync('board-messages', {
      name: 'Board Messages',
      importance: Notifications.AndroidImportance.DEFAULT,
      showBadge: true
    });
  }
};
```

**Deep Linking:**
```typescript
import * as Linking from 'expo-linking';

const prefix = Linking.createURL('/');

const linking = {
  prefixes: [prefix, 'mingla://', 'https://mingla.com'],
  config: {
    screens: {
      CollaborationModule: {
        path: 'collaboration/:action',
        parse: {
          action: (action) => action
        }
      },
      BoardDiscussion: {
        path: 'board/:boardId',
        parse: {
          boardId: (boardId) => boardId
        }
      },
      InviteAccept: {
        path: 'invite/:inviteId',
        parse: {
          inviteId: (inviteId) => inviteId
        }
      }
    }
  }
};

// Usage:
// mingla://collaboration/create
// mingla://board/board-123456
// mingla://invite/inv-789012
```

---

## Testing Strategy

### Unit Tests

```typescript
import { renderHook, act } from '@testing-library/react-hooks';
import { Provider } from 'react-redux';
import { createStore } from './store';

describe('Collaboration Hooks', () => {
  test('useCollaborationSession returns correct session', () => {
    const store = createStore();
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
    
    const { result } = renderHook(() => useCollaborationSession('board-123'), { wrapper });
    
    expect(result.current.session).toBeDefined();
    expect(result.current.session.id).toBe('board-123');
  });
  
  test('useVoteCard updates vote counts', async () => {
    const store = createStore();
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
    
    const { result } = renderHook(() => useVoteCard(), { wrapper });
    
    await act(async () => {
      await result.current.voteOnCard('board-123', 'card-456', 'yes');
    });
    
    const state = store.getState();
    const card = state.boards['board-123'].cards.find(c => c.id === 'card-456');
    expect(card.votes.yes).toBe(1);
    expect(card.votes.userVote).toBe('yes');
  });
});
```

### Integration Tests

```typescript
import { render, fireEvent, waitFor } from '@testing-library/react-native';

describe('BoardDiscussion Integration', () => {
  test('complete voting and RSVP flow', async () => {
    const { getByText, getByTestId } = render(
      <BoardDiscussion board={mockBoard} />
    );
    
    // Switch to cards tab
    fireEvent.press(getByText('Cards'));
    
    // Vote yes on card
    const thumbsUpButton = getByTestId('vote-yes-card-123');
    fireEvent.press(thumbsUpButton);
    
    await waitFor(() => {
      expect(getByText('1')).toBeTruthy(); // Vote count updated
    });
    
    // RSVP yes
    const rsvpButton = getByTestId('rsvp-yes-card-123');
    fireEvent.press(rsvpButton);
    
    await waitFor(() => {
      expect(getByText("RSVP'd Yes")).toBeTruthy();
    });
  });
  
  test('send message in discussion', async () => {
    const { getByText, getByPlaceholderText } = render(
      <BoardDiscussion board={mockBoard} />
    );
    
    // Switch to discussion tab
    fireEvent.press(getByText('Discussion'));
    
    // Type message
    const input = getByPlaceholderText('Type a message...');
    fireEvent.changeText(input, 'Great choice!');
    
    // Send message
    fireEvent.press(getByTestId('send-button'));
    
    await waitFor(() => {
      expect(getByText('Great choice!')).toBeTruthy();
    });
  });
});
```

### E2E Tests (Detox)

```typescript
describe('Collaboration Flow', () => {
  beforeAll(async () => {
    await device.launchApp();
  });
  
  it('should create collaboration session', async () => {
    // Open collaboration module
    await element(by.id('collaborate-button')).tap();
    
    // Navigate to create tab
    await element(by.text('Create')).tap();
    
    // Enter session name
    await element(by.id('session-name-input')).typeText('Weekend Brunch');
    await element(by.id('continue-button')).tap();
    
    // Select friends
    await element(by.id('friend-sarah')).tap();
    await element(by.id('friend-alex')).tap();
    await element(by.id('continue-button')).tap();
    
    // Confirm and create
    await element(by.id('create-session-button')).tap();
    
    // Verify session created
    await expect(element(by.text('Weekend Brunch'))).toBeVisible();
  });
  
  it('should vote on card and RSVP', async () => {
    // Open board
    await element(by.id('board-weekend-brunch')).tap();
    
    // Ensure on cards tab
    await element(by.text('Cards')).tap();
    
    // Vote yes
    await element(by.id('vote-yes')).tap();
    await expect(element(by.text('1'))).toBeVisible();
    
    // RSVP yes
    await element(by.id('rsvp-yes')).tap();
    await expect(element(by.text("RSVP'd Yes"))).toBeVisible();
  });
});
```

---

## Summary

The Mingla collaboration feature is a **comprehensive group planning system** that transforms solo experience discovery into a collaborative process. Here are the key takeaways for React Native developers:

### Core Components to Build:
1. **CollaborationModule** - Modal with Sessions/Invites/Create tabs
2. **SwipeableBoardCards** - Gesture-enabled card browser with voting/RSVP
3. **BoardDiscussion** - Dual-tab view (Cards + Discussion chat)
4. **MemberManagement** - Participant list with role-based permissions
5. **CollaborationPreferences** - Shared preference setter (GPS, categories, budget)

### Critical Features:
- **Real-time sync** via WebSocket (Socket.io)
- **Optimistic updates** with rollback for offline support
- **Dual-save functionality** (board + personal saved)
- **Role-based permissions** (Creator/Admin/Member)
- **Push notifications** for invites, votes, messages
- **Calendar integration** for locked-in experiences

### State Management:
- Redux store with collaboration, boards, discovery slices
- Real-time listeners updating state automatically
- Persistent storage with AsyncStorage
- Offline queue for actions when disconnected

### Technical Stack Recommendations:
- **Gestures**: react-native-gesture-handler + react-native-reanimated
- **Navigation**: React Navigation with deep linking
- **Real-time**: Socket.io client
- **HTTP**: Axios with interceptors
- **State**: Redux Toolkit with RTK Query
- **Notifications**: Expo Notifications
- **Calendar**: Expo Calendar
- **UI**: React Native Elements or NativeBase

This system enables groups to discover, vote, discuss, and finalize experiences together in real-time with a seamless mobile experience.
