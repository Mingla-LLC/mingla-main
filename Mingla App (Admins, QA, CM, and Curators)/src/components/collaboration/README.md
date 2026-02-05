# Collaboration Module Components

## Overview

The Collaboration Module has been refactored from a monolithic **1,038-line** file into a clean, modular component structure with **88% reduction** in the main component size.

## Architecture

```
/components/collaboration/
├── SessionsTab.tsx       # Active sessions view
├── InvitesTab.tsx        # Invitations management
├── CreateTab.tsx         # New session creation
├── types.ts              # TypeScript interfaces
├── constants.ts          # Mock data & defaults
├── index.ts              # Public exports
└── README.md             # This file
```

## Components

### CollaborationModule (Main - 194 lines)
**Purpose:** Main orchestrator for collaboration features

**Responsibilities:**
- State management (tabs, create flow, selections)
- Session creation logic
- Invite handling
- Friend selection
- Tab coordination

**Key Features:**
- Auto-navigate to create tab with pre-selected friend
- Session lifecycle management
- Responsive modal design

---

### SessionsTab (185 lines)
**Purpose:** View and manage active collaboration sessions

**Features:**
- Solo explorer mode
- Active sessions list
- Session status badges (active/pending/archived)
- Participant avatars
- Session actions (switch, chat, settings)
- Empty state handling

**Session Card Displays:**
- Session name and status
- Participant count
- Board cards count
- Last activity time
- Pending participants
- Quick actions

---

### InvitesTab (154 lines)
**Purpose:** Manage sent and received invitations

**Features:**
- Toggle between sent/received invites
- Accept/decline received invites
- Cancel sent invites
- Invite status badges
- Expiration timers
- Empty states for both views

**Invite Card Displays:**
- Session name
- From/to user
- Status (pending/accepted/declined/canceled)
- Time created
- Expiration countdown
- Action buttons

---

### CreateTab (233 lines)
**Purpose:** 3-step wizard for creating new sessions

**Step 1 - Details:**
- Session name input
- Validation
- Continue to friend selection

**Step 2 - Friends:**
- Available friends list
- Multi-select friends
- Selected friends preview
- Pre-selected friend handling
- Continue to confirmation

**Step 3 - Confirm:**
- Session summary
- All participants list
- Creator badge
- Send invites button

**Features:**
- Back navigation between steps
- Selection persistence
- Pre-selected friend support
- Validation at each step

---

## Data Flow

```
CollaborationModule
    ↓
[State: activeTab, createStep, selectedFriends]
    ↓
Tab Selection
    ↓
├─→ SessionsTab
│       ↓
│   Display sessions
│   Switch mode
│   Navigate to board
│
├─→ InvitesTab
│       ↓
│   Toggle sent/received
│   Accept/decline/cancel
│
└─→ CreateTab
        ↓
    Step 1: Session name
        ↓
    Step 2: Select friends
        ↓
    Step 3: Confirm & create
        ↓
    handleCreateSession()
        ↓
    onCreateSession callback
```

## Usage

```typescript
import CollaborationModule from './components/CollaborationModule';

function App() {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState('solo');

  return (
    <CollaborationModule
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      currentMode={mode}
      onModeChange={setMode}
      preSelectedFriend={null}
      boardsSessions={[]}
      onCreateSession={(session) => console.log('Created:', session)}
      onNavigateToBoard={(board) => console.log('Navigate:', board)}
      availableFriends={[]}
    />
  );
}
```

## Type Definitions

### Friend
```typescript
{
  id: string;
  name: string;
  username?: string;
  avatar?: string;
  status: 'online' | 'offline';
  lastActive?: string;
}
```

### CollaborationSession
```typescript
{
  id: string;
  name: string;
  status: 'pending' | 'active' | 'archived';
  participants: Friend[];
  createdBy: string;
  createdAt: string;
  lastActivity: string;
  hasCollabPreferences?: boolean;
  pendingParticipants: number;
  totalParticipants: number;
  boardCards: number;
}
```

### CollaborationInvite
```typescript
{
  id: string;
  sessionName: string;
  fromUser: Friend;
  toUser: Friend;
  status: 'pending' | 'accepted' | 'declined' | 'canceled';
  createdAt: string;
  expiresAt?: string;
}
```

## Key Features

### 1. Session Management
- Solo mode option
- Active session switching
- Session status tracking
- Participant management
- Board integration

### 2. Invitation System
- Send invitations to friends
- Accept/decline received invites
- Cancel sent invites
- Expiration tracking
- Status updates

### 3. Session Creation
- 3-step wizard flow
- Friend multi-select
- Pre-selection support
- Session validation
- Real-time preview

### 4. Friend Integration
- Available friends list
- Online/offline status
- Pre-selected friend handling
- Selection persistence

### 5. Board Integration
- Navigate to board discussion
- Session-board linking
- Card count display
- Activity tracking

## Benefits

- **88% smaller main file** (1,038 → 194 lines)
- **3 focused tab components**
- **Easy to test** each tab independently
- **Reusable** components
- **Maintainable** clear structure
- **Scalable** add features easily

## Pre-Selected Friend Flow

When a friend is pre-selected (e.g., from Connections page):

1. Module opens automatically
2. Navigate to Create tab
3. Friend is pre-selected in list
4. User can add more friends
5. Proceed through creation flow

```typescript
<CollaborationModule
  isOpen={true}
  preSelectedFriend={{
    id: '1',
    name: 'Sarah Chen',
    status: 'online'
  }}
  // ... other props
/>
```

## Customization

### Adding Session Types
Edit `/collaboration/constants.ts`:
```typescript
export const SESSION_TYPES = [
  { id: 'date-night', label: 'Date Night' },
  { id: 'group-hangout', label: 'Group Hangout' },
  // Add more types
];
```

### Modifying Invite Logic
Edit handlers in `CollaborationModule.tsx`:
```typescript
const handleAcceptInvite = (inviteId: string) => {
  // Custom acceptance logic
  // Update backend
  // Update UI state
};
```

## Integration Points

### With Boards System
- `boardsSessions` prop provides real boards
- `onNavigateToBoard` callback for navigation
- Session-board linking

### With Friends System
- `availableFriends` prop for real friends
- Online/offline status display
- Friend selection integration

### With Preferences
- `hasCollabPreferences` flag
- Collaborative filtering
- Shared preferences

## Testing Recommendations

### Unit Tests
```typescript
// SessionsTab.test.tsx
test('displays solo mode option', () => {
  render(<SessionsTab sessions={[]} currentMode="solo" />);
  expect(screen.getByText('Solo Explorer')).toBeInTheDocument();
});

// InvitesTab.test.tsx
test('toggles between sent and received', () => {
  const { getByText } = render(<InvitesTab {...props} />);
  fireEvent.click(getByText('Sent'));
  expect(props.onShowInviteTypeChange).toHaveBeenCalledWith('sent');
});

// CreateTab.test.tsx
test('validates session name', () => {
  render(<CreateTab {...props} newSessionName="" />);
  expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
});
```

### Integration Tests
```typescript
test('complete session creation flow', async () => {
  render(<CollaborationModule {...props} />);
  
  // Navigate to create tab
  fireEvent.click(screen.getByText('Create'));
  
  // Enter session name
  fireEvent.change(screen.getByPlaceholderText(/session name/i), {
    target: { value: 'Test Session' }
  });
  fireEvent.click(screen.getByText('Continue'));
  
  // Select friends
  fireEvent.click(screen.getByText('Sarah Chen'));
  fireEvent.click(screen.getByText(/continue.*1 selected/i));
  
  // Confirm and create
  fireEvent.click(screen.getByText(/create session/i));
  
  await waitFor(() => {
    expect(props.onCreateSession).toHaveBeenCalled();
  });
});
```

## Future Enhancements

### Phase 1 (Short-term)
- [ ] Real-time status updates
- [ ] Invite notifications
- [ ] Session chat preview
- [ ] Participant permissions
- [ ] Session search/filter

### Phase 2 (Medium-term)
- [ ] Video call integration
- [ ] Screen sharing
- [ ] Collaborative editing
- [ ] Session analytics
- [ ] Activity feed

### Phase 3 (Long-term)
- [ ] AI-powered matching
- [ ] Smart recommendations
- [ ] Cross-platform sync
- [ ] Advanced permissions
- [ ] Session templates

## Dependencies

- React 18+
- Lucide React (icons)

## Related Documentation

- [Activity Refactoring](../activity/REFACTORING_COMPLETE.md)
- [Messages Refactoring](../messages/REFACTORING_COMPLETE.md)
- [Onboarding Refactoring](../onboarding/REFACTORING_COMPLETE.md)
- [Connections System](../CONNECTIONS_SYSTEM_PRODUCTION.md)
- [Collaboration Quick Start](../COLLABORATION_QUICK_START.md)
