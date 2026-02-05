# Activity Page Components

This directory contains the refactored Activity Page components, broken down from the original 2,368-line `ActivityPage.tsx` file into modular, maintainable components.

## 📁 Structure

```
activity/
├── ActivityHeader.tsx       # Tab navigation header (Boards, Saved, Calendar)
├── BoardsTab.tsx           # Boards/collaboration sessions list and management
├── SavedTab.tsx            # Saved experiences with active/archived sections
├── CalendarTab.tsx         # Scheduled calendar entries
├── types.ts                # TypeScript interfaces and type definitions
├── utils.ts                # Shared utility functions and helpers
├── index.ts                # Barrel exports
└── README.md              # This file
```

## 🎯 Components

### ActivityHeader
**Purpose:** Provides tab navigation between Boards, Saved, and Calendar views  
**Props:** `activeTab`, `onTabChange`  
**Features:**
- Responsive design with icons and labels
- Active tab highlighting with Mingla brand colors
- Smooth transitions between tabs

### BoardsTab
**Purpose:** Displays and manages collaboration boards/sessions  
**Props:** Boards data, search/filter state, event handlers  
**Features:**
- Search by board name or description
- Filter by status (All, Active, Voting, Locked In, Completed)
- Board statistics (members, experiences count)
- Admin-specific actions (invite members)
- Notifications toggle per board
- Leave/exit board functionality

### SavedTab
**Purpose:** Shows saved experiences from solo and collaboration sessions  
**Props:** Saved cards data, search/filter state, interaction handlers  
**Features:**
- Search by title, category, or description
- Filter by source (All, Solo, Collaboration)
- Active/Archives sections with collapsible headers
- Image carousel for multi-image cards
- Quick actions: Purchase/Schedule, Share, Remove
- Expandable card details
- Source indicators (Solo Discovery vs Collaboration)

### CalendarTab
**Purpose:** Displays scheduled and purchased calendar entries  
**Props:** Calendar entries, search/filter state, action handlers  
**Features:**
- Search by experience name or details
- Time filters (Today, This Week, This Month, Upcoming)
- Type filters (Purchased vs Scheduled)
- Active/Archives sections with collapse state
- QR code access for purchased items
- Propose new date functionality
- Review prompts for completed experiences
- Contact information display (phone, website)

## 🔧 Utilities (utils.ts)

### Helper Functions
- `getIconComponent()` - Converts icon string names to Lucide components
- `filterBoards()` - Filters boards by search query and status
- `filterSavedCards()` - Filters saved cards by search and source
- `filterCalendarEntries()` - Filters calendar entries by search, time, and type
- `categorizeSavedCards()` - Separates cards into active/archived with proper sorting
- `categorizeCalendarEntries()` - Separates entries into active/archived with proper sorting
- `isUserAdmin()` - Checks if user has admin permissions for a board
- `getUnreadCount()` - Calculates total unread messages for a board
- `formatDisplayDate()` - Formats dates for consistent display
- `formatDisplayTime()` - Formats times for consistent display
- `getStatusBadgeColor()` - Returns badge color classes for board status

## 📝 Types (types.ts)

### Main Interfaces
- `ActivityPageProps` - Props for main ActivityPage component
- `ActivityHeaderProps` - Tab navigation props
- `BoardsTabProps` - Boards management props
- `SavedTabProps` - Saved experiences props
- `CalendarTabProps` - Calendar entries props

### Type Aliases
- `TabType` - Union type for tab names
- `BoardsFilterType` - Board status filter values
- `SavedFilterType` - Saved card source filter values
- `CalendarTimeFilterType` - Calendar time filter values
- `CalendarTypeFilterType` - Calendar type filter values

## 🎨 Design Patterns

### Collapsible Sections
All tabs use persistent collapse state via localStorage:
- `savedActiveCollapsed` / `savedArchivesCollapsed`
- `calendarActiveCollapsed` / `calendarArchivesCollapsed`

### Sorting Strategy
- **Active items:** Most recent first (newest → oldest)
- **Archived items:** Earliest first (oldest → newest)
- **Calendar active:** Soonest date first (closest → furthest)
- **Calendar archived:** Most recent completion first

### Search & Filter Pattern
Each tab follows consistent pattern:
1. Search input with icon
2. Filter toggle button (highlighted when filters active)
3. Collapsible filter dropdown
4. Clear filters option

## 🔄 Integration with ActivityPage

The main `ActivityPage.tsx` component:
1. Manages all state (search queries, filters, collapse states, modals)
2. Handles navigation data from external sources
3. Persists collapse preferences to localStorage
4. Renders appropriate tab based on `activeTab` state
5. Passes event handlers down to child components

## 🚀 Usage Example

```tsx
import { ActivityHeader, BoardsTab, SavedTab, CalendarTab } from './activity';

function ActivityPage(props) {
  const [activeTab, setActiveTab] = useState('boards');
  
  return (
    <div>
      <ActivityHeader 
        activeTab={activeTab} 
        onTabChange={setActiveTab} 
      />
      
      {activeTab === 'boards' && <BoardsTab {...boardsProps} />}
      {activeTab === 'saved' && <SavedTab {...savedProps} />}
      {activeTab === 'calendar' && <CalendarTab {...calendarProps} />}
    </div>
  );
}
```

## 🎯 Benefits of Refactoring

1. **Maintainability:** Each tab is now ~300-400 lines instead of 2,368
2. **Reusability:** Components can be used independently
3. **Testability:** Isolated components are easier to test
4. **Clarity:** Clear separation of concerns
5. **Performance:** Easier to optimize individual components
6. **Collaboration:** Multiple developers can work on different tabs

## 📊 File Size Comparison

| Component | Lines | Description |
|-----------|-------|-------------|
| **Before** | | |
| ActivityPage.tsx | 2,368 | Monolithic component |
| **After** | | |
| ActivityHeader.tsx | 50 | Tab navigation |
| BoardsTab.tsx | 275 | Boards management |
| SavedTab.tsx | 390 | Saved experiences |
| CalendarTab.tsx | 410 | Calendar entries |
| types.ts | 115 | Type definitions |
| utils.ts | 320 | Utility functions |
| **Total** | 1,560 | + Main component (800) |

## 🔮 Future Enhancements

- [ ] Add unit tests for each component
- [ ] Implement virtualization for large lists
- [ ] Add animation/transitions for expand/collapse
- [ ] Extract modals to separate components
- [ ] Add accessibility improvements (ARIA labels, keyboard navigation)
- [ ] Implement skeleton loading states
- [ ] Add drag-and-drop reordering
- [ ] Export/share functionality for boards

## 🤝 Related Components

- `BoardDiscussion.tsx` - Full board view with discussion
- `SwipeableBoardCards.tsx` - Card swiper for boards
- `PurchaseModal.tsx` - Purchase flow
- `UserInviteModal.tsx` - Invite users to boards
- `PurchaseQRCode.tsx` - QR code display for purchases

---

**Last Updated:** October 23, 2025  
**Refactored From:** ActivityPage.tsx (2,368 lines)  
**Pattern:** Follows same structure as `/components/swipeable-cards/`
