# Connections Components

## Overview

The Connections module manages friend relationships and direct messaging in Mingla. It has been refactored from a monolithic **1,110-line** file into a clean, modular component structure with **71% reduction** in the main component size.

## Architecture

```
/components/connections/
├── FriendsTab.tsx           # Friends list view
├── MessagesTab.tsx          # Conversations list
├── FriendCard.tsx           # Individual friend card
├── ConversationCard.tsx     # Conversation preview
├── TabNavigation.tsx        # Tab switcher
├── types.ts                 # TypeScript interfaces
├── utils.ts                 # Utility functions
├── constants.ts             # Mock data & config
├── index.ts                 # Public exports
└── README.md                # This file
```

## Components

### ConnectionsPage (Main - 321 lines)
**Purpose:** Main orchestrator for connections and messaging

**Responsibilities:**
- Tab navigation (Friends/Messages)
- State management
- Modal coordination
- Message handling
- Friend actions

**Key Features:**
- Two-tab interface
- Real-time messaging
- Friend management
- QR code sharing
- Invite link generation

---

### FriendsTab (177 lines)
**Purpose:** Display and manage friends list

**Features:**
- Friends search
- Quick actions (Add friend, QR code, Invite link)
- QR code display
- Expandable friends list
- Empty state handling

**Actions:**
- Add friend
- Show friend requests
- Generate QR code
- Copy invite link
- Message friend
- Add friend to board
- Mute/unmute friend
- Block user
- Report user
- Remove friend

---

### MessagesTab (72 lines)
**Purpose:** Display conversations list

**Features:**
- Conversation search
- Start new conversation button
- Unread count badges
- Empty state handling
- Recent message preview

---

### FriendCard (135 lines)
**Purpose:** Individual friend card with actions

**Features:**
- Avatar with status indicator
- Name and username display
- Mutual friends count
- Message button
- Dropdown menu with actions:
  - Add to Board
  - Mute/Unmute
  - Block User
  - Report User
  - Remove Friend

**Status Indicators:**
- 🟢 Online (green)
- 🟡 Away (yellow)
- ⚫ Offline (gray)

---

### ConversationCard (49 lines)
**Purpose:** Preview conversation in list

**Features:**
- Avatar with online status
- Conversation name
- Last message preview (60 chars)
- Timestamp
- Unread count badge
- Click to open conversation

---

### TabNavigation (43 lines)
**Purpose:** Switch between Friends and Messages tabs

**Features:**
- Two tabs (Friends, Messages)
- Active state styling
- Unread messages badge
- Smooth transitions

---

## Data Flow

```
ConnectionsPage
    ↓
State Management:
├─→ Active Tab (friends | messages)
├─→ Friends List (from props or mock)
├─→ Conversations (message history)
├─→ Active Chat (currently viewing)
├─→ Muted Friends (Set<string>)
└─→ Modal States
    ↓
Tab Content:
├─→ FriendsTab
│   ├─→ Search friends
│   ├─→ Quick actions
│   ├─→ QR code display
│   └─→ FriendCard (for each friend)
│       └─→ Dropdown actions
│
└─→ MessagesTab
    ├─→ Search conversations
    ├─→ Start new button
    └─→ ConversationCard (for each)
        └─→ Click → MessageInterface
    ↓
Message Flow:
├─→ Select Friend → Open MessageInterface
├─→ Send Message → Add to conversations
├─→ Simulate Reply (2-3s delay)
└─→ Back → Return to tab view
    ↓
Modals:
├─→ FriendSelectionModal (start new chat)
├─→ AddFriendModal (add friend)
├─→ FriendRequestsModal (pending requests)
├─→ AddToBoardModal (add friend to board)
└─→ ReportUserModal (report user)
```

## Usage

```typescript
import ConnectionsPage from './components/ConnectionsPage';

function App() {
  return (
    <ConnectionsPage
      currentUser={user}
      friendsList={friends}
      boardsSessions={boards}
      accountPreferences={preferences}
      currentMode="solo"
      onModeChange={handleModeChange}
      onUpdateBoardSession={handleUpdateSession}
      onCreateSession={handleCreateSession}
      onNavigateToBoard={handleNavigateToBoard}
    />
  );
}
```

## Key Features

### 1. Friends Management
- **Search:** Filter friends by name/username
- **Add Friend:** Multiple methods (username, QR, invite link)
- **View Requests:** See pending friend requests
- **Quick Actions:** Message, add to board, manage

### 2. Messaging
- **Direct Messaging:** 1-on-1 conversations
- **Group Chats:** Support for group conversations
- **Real-time Updates:** Simulated friend replies
- **Unread Tracking:** Badge counts on tab and cards
- **Message Types:** Text, image, video, file support

### 3. Friend Actions
- **Message:** Direct message a friend
- **Add to Board:** Invite friend to collaborative board
- **Mute/Unmute:** Control notifications
- **Block:** Block user
- **Report:** Report inappropriate behavior
- **Remove:** Unfriend user

### 4. QR Code Sharing
- **Generate QR:** Display personal QR code
- **Scan to Connect:** Friends scan to add
- **Toggle Display:** Show/hide QR code

### 5. Invite System
- **Copy Link:** One-click invite link copy
- **Share:** Send invite to friends
- **Feedback:** Visual confirmation when copied

## Friend Card Actions

### Dropdown Menu Structure
```
┌─────────────────────┐
│ Add to Board       │
│ Mute / Unmute      │
├─────────────────────┤ (divider)
│ Block User        🚫│
│ Report User       🚩│
├─────────────────────┤ (divider)
│ Remove Friend     ❌│
└─────────────────────┘
```

### Action Behaviors

**Add to Board:**
- Opens AddToBoardModal
- Shows available boards
- Invites friend to selected board

**Mute/Unmute:**
- Toggles notification state
- Updates mutedFriends Set
- Visual feedback in UI

**Block User:**
- Prevents future interaction
- Hides from friends list
- Cannot message

**Report User:**
- Opens ReportUserModal
- Select reason
- Add details
- Submit to moderation

**Remove Friend:**
- Removes from friends list
- Cannot see each other's content
- Can re-add later

## Messaging Features

### Message Types

```typescript
type: 'text' | 'image' | 'video' | 'file'
```

**Text Messages:**
- Plain text content
- Emoji support
- URL detection

**File Messages:**
- File name display
- File size display
- Download support
- Thumbnail preview (images/videos)

### Auto-Reply Simulation

When you send a message, the system simulates a friend reply:
- Random delay: 2-3 seconds
- Random reply from preset messages
- Marks as unread initially
- Updates conversation preview

### Unread Tracking

**Message Level:**
```typescript
{
  unread: boolean; // Only for messages from friends
}
```

**Conversation Level:**
```typescript
unreadCount: number; // Total unread in conversation
```

**Global Level:**
```typescript
getTotalUnreadCount(conversations); // All unread messages
```

## State Management

### Core State
```typescript
{
  activeTab: 'friends' | 'messages',
  showQRCode: boolean,
  inviteCopied: boolean,
  showMessageInterface: boolean,
  activeChat: Friend | null,
  conversations: { [friendId: string]: Message[] },
  mutedFriends: Set<string>
}
```

### Modal State
```typescript
{
  showAddFriendModal: boolean,
  showFriendRequests: boolean,
  showAddToBoardModal: boolean,
  selectedFriendForBoard: Friend | null,
  showReportModal: boolean,
  selectedUserToReport: Friend | null
}
```

## Utilities

### formatFileSize(bytes: number)
Convert bytes to human-readable format (KB, MB, GB)

### getRandomReply()
Get random auto-reply message

### createConversationsFromFriends(friends: Friend[])
Generate conversation objects from friends list

### filterFriends(friends: Friend[], query: string)
Filter friends by search query

### filterConversations(conversations: Conversation[], query: string)
Filter conversations by search query

### getTotalUnreadCount(conversations)
Count total unread messages across all conversations

### markMessagesAsRead(conversations, friendId)
Mark all messages from a friend as read

### getInitials(name: string)
Generate initials from name (max 2 characters)

### getStatusColor(status)
Get color class for online status indicator

## Mock Data

### MOCK_FRIENDS (5 friends)
- Arifat Ola-dauda (@Ari99) - Online
- Sethozia Testing (@Sethozia) - Away
- Marcus Chen (@MarcusC) - Online
- Sarah Williams (@SarahW) - Offline
- David Rodriguez (@DavidR) - Online

### MOCK_FRIEND_REQUESTS (3 requests)
- Alex Johnson (@AlexJ) - 2 days ago
- Emily Davis (@EmilyD) - 1 week ago
- James Wilson (@JamesW) - 3 days ago

### AUTO_REPLY_MESSAGES
8 preset replies for simulation:
- "That sounds great! 👍"
- "Thanks for sharing that!"
- "Interesting! Tell me more."
- ... etc

### Initial Conversations
Pre-populated message history for first 3 friends with realistic timestamps and content.

## Integration Points

### With MessageInterface
```typescript
<MessageInterface
  friend={activeChat}
  messages={conversations[activeChat.id]}
  onBack={handleBackFromMessage}
  onSendMessage={handleSendMessage}
  // ... board integration props
/>
```

### With Board System
```typescript
<AddToBoardModal
  friend={selectedFriend}
  boards={boardsSessions}
/>
```

### With Moderation System
```typescript
<ReportUserModal
  user={selectedUser}
  onReport={(reason, details) => {
    // Submit to moderation queue
  }}
/>
```

## Responsive Design

### Mobile (< 640px)
- Stacked layout
- Full-width cards
- Bottom sheet modals
- Touch-optimized buttons

### Tablet (640px - 1024px)
- Centered content (max-w-2xl)
- Comfortable spacing
- Hover states

### Desktop (> 1024px)
- Fixed-width container
- Enhanced hover effects
- Keyboard shortcuts support

## Performance Optimizations

### 1. Lazy Rendering
```typescript
const displayedFriends = friendsListExpanded 
  ? filteredFriends 
  : filteredFriends.slice(0, 3);
```

### 2. Efficient Search
```typescript
// Only filter when search query changes
const filteredFriends = filterFriends(friends, searchQuery);
```

### 3. Set for Muted Friends
```typescript
// O(1) lookup instead of O(n)
const mutedFriends = new Set<string>();
```

### 4. Conversation Indexing
```typescript
// Hash map for O(1) message lookup
conversations: { [friendId: string]: Message[] }
```

## Testing Recommendations

### Unit Tests

```typescript
// FriendCard.test.tsx
test('displays friend info correctly', () => {
  render(<FriendCard friend={mockFriend} />);
  expect(screen.getByText(mockFriend.name)).toBeInTheDocument();
  expect(screen.getByText(`@${mockFriend.username}`)).toBeInTheDocument();
});

test('shows online status indicator', () => {
  const onlineFriend = { ...mockFriend, isOnline: true };
  render(<FriendCard friend={onlineFriend} />);
  expect(screen.getByTestId('status-indicator')).toHaveClass('bg-green-500');
});

// MessagesTab.test.tsx
test('filters conversations by search', () => {
  const { rerender } = render(<MessagesTab conversations={mockConversations} />);
  
  const searchInput = screen.getByPlaceholderText(/search conversations/i);
  fireEvent.change(searchInput, { target: { value: 'Museum' } });
  
  expect(screen.getAllByRole('button')).toHaveLength(1);
});
```

### Integration Tests

```typescript
test('complete friend messaging flow', async () => {
  render(<ConnectionsPage friendsList={mockFriends} />);
  
  // Click message button on friend card
  fireEvent.click(screen.getAllByLabelText(/message/i)[0]);
  
  // Should switch to messages tab
  expect(screen.getByText(/messages/i)).toHaveClass('bg-[#eb7825]');
  
  // Should show MessageInterface
  expect(screen.getByTestId('message-interface')).toBeInTheDocument();
  
  // Send a message
  const input = screen.getByPlaceholderText(/type a message/i);
  fireEvent.change(input, { target: { value: 'Hello!' } });
  fireEvent.click(screen.getByRole('button', { name: /send/i }));
  
  // Message should appear
  expect(screen.getByText('Hello!')).toBeInTheDocument();
  
  // Auto-reply should appear after delay
  await waitFor(() => {
    expect(screen.getAllByRole('article')).toHaveLength(2);
  }, { timeout: 3500 });
});
```

## Accessibility

### Keyboard Navigation
- Tab through friends/conversations
- Enter to select
- Escape to close modals
- Arrow keys in dropdowns

### Screen Reader Support
- ARIA labels on buttons
- Role attributes on interactive elements
- Live regions for notifications
- Semantic HTML structure

### Focus Management
- Modal focus trap
- Return focus on close
- Skip links for navigation
- Visible focus indicators

## Future Enhancements

### Phase 1 (Short-term)
- [ ] Voice messages
- [ ] Message reactions
- [ ] Typing indicators
- [ ] Read receipts
- [ ] Online status toggle

### Phase 2 (Medium-term)
- [ ] Video calls
- [ ] Voice calls
- [ ] Screen sharing
- [ ] Message search
- [ ] Pin conversations

### Phase 3 (Long-term)
- [ ] End-to-end encryption
- [ ] Message scheduling
- [ ] Auto-reply bots
- [ ] Custom themes
- [ ] Message translation

## Dependencies

- React 18+
- Lucide React (icons)
- MessageInterface component
- Modal components
- ImageWithFallback component

## Related Documentation

- [Activity Refactoring](../activity/REFACTORING_COMPLETE.md)
- [Messages Refactoring](../messages/REFACTORING_COMPLETE.md)
- [Onboarding Refactoring](../onboarding/REFACTORING_COMPLETE.md)
- [Collaboration Refactoring](../collaboration/REFACTORING_COMPLETE.md)
- [Swipeable Cards Refactoring](../swipeable-cards/REFACTORING_COMPLETE.md)
- [MessageInterface Component](../MessageInterface.tsx)
