# Messages Page Components

## Overview

The Messages Page has been refactored into a modular, maintainable component structure. This directory contains all components related to the curator-business messaging and collaboration system.

## Architecture

```
/components/messages/
├── ConversationList.tsx      # Left sidebar with collaboration list
├── ChatView.tsx              # Main chat interface
├── MessageBubble.tsx         # Individual message component
├── NegotiationModal.tsx      # Commission proposal modal
├── CollaborationDetails.tsx  # Collaboration info sheet
├── types.ts                  # TypeScript interfaces
├── utils.ts                  # Utility functions
├── index.ts                  # Public exports
└── README.md                 # This file
```

## Components

### ConversationList

**Purpose:** Displays the list of active collaborations for the current user.

**Props:**
- `collaborations`: Array of collaboration objects
- `selectedCollaboration`: Currently selected collaboration
- `unreadCounts`: Object mapping collaboration IDs to unread counts
- `searchQuery`: Search filter text
- `currentUserType`: 'curator' or 'business'
- `isMobileView`: Boolean for responsive layout
- `hideHeader`: Hide header when wrapped in PageLayout
- `onSelectCollaboration`: Callback when selecting a conversation
- `onSearchChange`: Callback for search input changes

**Features:**
- Search functionality
- Unread message badges
- Responsive mobile/desktop layout
- Empty state handling
- Avatar with initials
- Status badges

### ChatView

**Purpose:** Main chat interface for sending/receiving messages.

**Props:**
- `selectedCollaboration`: Current collaboration
- `messages`: Array of message objects
- `newMessage`: Current input text
- `isTyping`: Typing indicator state
- `currentUserId`: Current user's ID
- `currentUserType`: 'curator' or 'business'
- `currentUserName`: Current user's name
- `isMobileView`: Boolean for responsive layout
- `sharedExperiences`: Array of experiences to tag
- Various callbacks for actions

**Features:**
- Real-time message display
- Typing indicators
- Message input with send button
- Experience tagging dropdown
- Chat header with collaboration info
- Export chat functionality
- Responsive layout

### MessageBubble

**Purpose:** Renders individual messages with different types.

**Message Types:**
1. **System Messages:** Welcome and info messages
2. **Text Messages:** Regular chat messages
3. **Negotiation Messages:** Commission proposals/responses
4. **Experience Messages:** Tagged experiences

**Props:**
- `message`: Message object
- `currentUserId`: To determine sender
- `currentUserType`: For display logic
- `onAcceptNegotiation`: Accept proposal callback
- `onRejectNegotiation`: Reject proposal callback

**Features:**
- Sender-based styling (left/right alignment)
- Rich content for special message types
- Action buttons for negotiations
- Timestamps with relative formatting
- Status icons for negotiations

### NegotiationModal

**Purpose:** Modal for proposing commission rates.

**Props:**
- `isOpen`: Modal visibility
- `proposedCommission`: Commission rate input
- `proposalReason`: Optional message
- `onClose`: Close callback
- `onProposedCommissionChange`: Input change handler
- `onProposalReasonChange`: Textarea change handler
- `onSubmit`: Submit proposal callback

**Features:**
- Commission rate input (0-50%)
- Optional explanation textarea
- Validation feedback
- Tips for better proposals
- Responsive design

### CollaborationDetails

**Purpose:** Sheet displaying detailed collaboration information.

**Props:**
- `isOpen`: Sheet visibility
- `collaboration`: Collaboration object
- `sharedExperiences`: Related experiences
- `currentUserType`: For display logic
- `onClose`: Close callback

**Features:**
- Experience details
- Collaboration status
- Commission information
- Partner information
- Shared experiences list
- Collaboration ID

## Usage Example

```tsx
import MessagesPage from './components/MessagesPage';

function App() {
  return (
    <MessagesPage
      currentUserId="user123"
      currentUserType="curator"
      currentUserName="John Doe"
      hideHeader={false}
    />
  );
}
```

## Data Flow

1. **MessagesPage** (main component):
   - Loads collaborations from localStorage
   - Manages selected collaboration state
   - Handles message sending/receiving
   - Coordinates child components

2. **ConversationList**:
   - Receives filtered collaborations
   - Emits selection events
   - Displays unread counts

3. **ChatView**:
   - Displays messages for selected collaboration
   - Handles message composition
   - Manages special actions (tag, negotiate)

4. **MessageBubble**:
   - Renders individual messages
   - Handles inline actions (accept/reject)

## State Management

The main `MessagesPage` component manages:
- `collaborations`: List of user's collaborations
- `selectedCollaboration`: Currently active chat
- `messages`: Messages for selected collaboration
- `unreadCounts`: Unread message counts per collaboration
- `newMessage`: Current input text
- UI state (modals, sheets, mobile view)

## LocalStorage Integration

### Keys Used:
- `collaborations`: All collaboration records
- `experienceCards`: Experience card data
- `collaboration_chat_{id}`: Messages for each collaboration
- `negotiation_history_{businessId}`: Negotiation proposals
- `mingla_businesses`: Business records

### Data Persistence:
- Messages are saved to localStorage on send
- Read status is updated on view
- Collaborations are enriched with experience data
- Negotiation updates sync across components

## Responsive Design

### Mobile View (< 768px):
- Single-column layout
- ConversationList OR ChatView (not both)
- Back button in ChatView header
- Full-screen modals

### Desktop View (≥ 768px):
- Two-column layout
- ConversationList (fixed width) + ChatView
- Both visible simultaneously
- Side sheets for details

## Utility Functions

### `formatTime(date)`
Returns relative time string (e.g., "2m ago", "1h ago")

### `formatDate(dateStr)`
Returns relative date string (e.g., "Today", "Yesterday")

### `getInitials(name)`
Extracts and formats initials from full name

### `filterCollaborations(collaborations, query, userType)`
Filters collaborations based on search query

### `getOtherPartyName(collaboration, userType)`
Gets the name of the other party in the collaboration

### `loadCollaborationsFromStorage(userId, userType)`
Loads and enriches collaborations from localStorage

### `loadSharedExperiences(collaboration)`
Finds all experiences shared between curator and business

## Key Features

### 1. Commission Negotiation
- Propose commission rates
- Accept/reject proposals
- View negotiation history
- Status tracking (proposed/accepted/rejected)

### 2. Experience Tagging
- Tag relevant experiences in chat
- Display tagged experience details
- Quick access to shared experiences

### 3. Real-time Updates
- Typing indicators
- Auto-scroll to new messages
- Read status tracking
- Storage event listeners

### 4. Export Functionality
- Download chat history as text file
- Formatted with timestamps and sender names
- Includes all message types

### 5. Search & Filter
- Search by experience name
- Search by partner name
- Real-time filtering

## Performance Optimizations

1. **Lazy Loading:** Messages loaded only for selected collaboration
2. **Memoization:** Use React.memo for child components if needed
3. **Virtual Scrolling:** Consider for large message lists
4. **Debouncing:** Search input debouncing recommended

## Accessibility

- Semantic HTML structure
- ARIA labels on interactive elements
- Keyboard navigation support
- Focus management for modals/sheets
- Screen reader friendly message list

## Testing Recommendations

### Unit Tests:
- Message formatting utilities
- Filter functions
- Data transformation helpers

### Integration Tests:
- Message sending/receiving flow
- Negotiation acceptance/rejection
- Experience tagging
- Search functionality

### E2E Tests:
- Complete conversation flow
- Mobile responsive behavior
- Real-time updates
- Export functionality

## Future Enhancements

1. **Real-time Messaging:** WebSocket integration
2. **File Attachments:** Image/document sharing
3. **Read Receipts:** Advanced read tracking
4. **Message Reactions:** Emoji reactions
5. **Message Threading:** Reply to specific messages
6. **Push Notifications:** New message alerts
7. **Voice Messages:** Audio message support
8. **Video Calls:** Integrated video chat

## Migration Notes

### From Monolithic Component:
The original `MessagesPage.tsx` (1,945 lines) has been split into:
- Main orchestrator: ~250 lines
- Component directory: ~1,200 lines across 6 focused components
- Shared utilities: ~150 lines
- Type definitions: ~100 lines

### Benefits:
- 85% reduction in main component size
- Easier testing and maintenance
- Better code organization
- Improved reusability
- Clearer separation of concerns

## Dependencies

- React 18+
- Lucide React (icons)
- Motion/React (animations)
- Shadcn UI components:
  - Button, Input, Textarea
  - Avatar, Badge
  - Dialog, Sheet
  - DropdownMenu
  - ScrollArea
  - Separator

## Related Documentation

- [Activity Page Refactoring](../activity/README.md)
- [Collaboration System](../COLLABORATION_SYSTEM_PRODUCTION.md)
- [Commission Management](../COMMISSION_MANAGEMENT_COMPLETE.md)
