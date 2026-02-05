// Activity Page Type Definitions

export interface ActivityPageProps {
  onSendInvite?: (sessionId: string, users: any[]) => void;
  userPreferences?: any;
  accountPreferences?: any;
  calendarEntries?: any[];
  savedCards?: any[];
  onScheduleFromSaved?: (card: any) => void;
  onPurchaseFromSaved?: (card: any, purchaseOption: any) => void;
  onRemoveFromCalendar?: (entry: any) => void;
  onRemoveSaved?: (card: any) => void;
  onShareCard?: (card: any) => void;
  onProposeNewDate?: (entry: any) => void;
  boardsSessions?: any[];
  onUpdateBoardSession?: (board: any) => void;
  navigationData?: {
    selectedBoard?: any;
    activeTab?: 'saved' | 'calendar';
    discussionTab?: string;
  } | null;
  onNavigationComplete?: () => void;
  onPromoteToAdmin?: (boardId: string, participantId: string) => void;
  onDemoteFromAdmin?: (boardId: string, participantId: string) => void;
  onRemoveMember?: (boardId: string, participantId: string) => void;
  onLeaveBoard?: (boardId: string) => void;
  onOpenReview?: (card: any) => void;
  onSaveCardFromBoard?: (card: any) => void;
}

export type TabType = 'saved' | 'calendar';
export type BoardsFilterType = 'all' | 'active' | 'voting' | 'locked' | 'completed';
export type SavedFilterType = 'all' | 'solo' | 'collaboration';
export type CalendarTimeFilterType = 'all' | 'today' | 'this-week' | 'this-month' | 'upcoming';
export type CalendarTypeFilterType = 'all' | 'purchased' | 'scheduled';
export type BudgetFilterType = 'all' | '0-25' | '25-75' | '75-150' | '150+';

export interface BoardsTabProps {
  boardsSessions: any[];
  searchQuery: string;
  filter: BoardsFilterType;
  showFilters: boolean;
  boardNotifications: { [boardId: string]: boolean };
  onSearchChange: (query: string) => void;
  onFilterChange: (filter: BoardsFilterType) => void;
  onToggleFilters: () => void;
  onSelectBoard: (board: any) => void;
  onToggleNotifications: (boardId: string) => void;
  onManageMembers: (board: any) => void;
  onLeaveBoard: (boardId: string, boardName: string) => void;
}

export interface SavedTabProps {
  savedCards: any[];
  searchQuery: string;
  filter: SavedFilterType;
  showFilters: boolean;
  activeCollapsed: boolean;
  archivesCollapsed: boolean;
  expandedCard: string | null;
  currentImageIndex: { [cardId: string]: number };
  accountPreferences?: any;
  categoryFilter?: string[];
  budgetFilter?: BudgetFilterType;
  experienceTypeFilter?: string[];
  onSearchChange: (query: string) => void;
  onFilterChange: (filter: SavedFilterType) => void;
  onToggleFilters: () => void;
  onToggleActiveCollapsed: () => void;
  onToggleArchivesCollapsed: () => void;
  onExpandCard: (cardId: string | null) => void;
  onImageNavigation: (cardId: string, direction: 'prev' | 'next', totalImages: number) => void;
  onScheduleCard: (card: any) => void;
  onPurchaseCard: (card: any) => void;
  onRemoveCard: (card: any) => void;
  onShareCard: (card: any) => void;
  onCategoryFilterChange?: (categories: string[]) => void;
  onBudgetFilterChange?: (budget: BudgetFilterType) => void;
  onExperienceTypeFilterChange?: (types: string[]) => void;
}

export interface CalendarTabProps {
  calendarEntries: any[];
  searchQuery: string;
  timeFilter: CalendarTimeFilterType;
  typeFilter: CalendarTypeFilterType;
  showFilters: boolean;
  activeCollapsed: boolean;
  archivesCollapsed: boolean;
  accountPreferences?: any;
  categoryFilter?: string[];
  budgetFilter?: BudgetFilterType;
  experienceTypeFilter?: string[];
  onSearchChange: (query: string) => void;
  onTimeFilterChange: (filter: CalendarTimeFilterType) => void;
  onTypeFilterChange: (filter: CalendarTypeFilterType) => void;
  onToggleFilters: () => void;
  onToggleActiveCollapsed: () => void;
  onToggleArchivesCollapsed: () => void;
  onProposeNewDate: (entry: any) => void;
  onRemoveEntry: (entry: any) => void;
  onShowQRCode: (entryId: string) => void;
  onOpenReview?: (entry: any) => void;
  onCategoryFilterChange?: (categories: string[]) => void;
  onBudgetFilterChange?: (budget: BudgetFilterType) => void;
  onExperienceTypeFilterChange?: (types: string[]) => void;
}

export interface ActivityHeaderProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}