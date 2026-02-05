// Activity Page Utility Functions

import { 
  Coffee, TreePine, Sparkles, Dumbbell, Utensils, Eye, Heart,
  Calendar, MapPin, Clock, Star, Navigation, Users, Check,
  ThumbsUp, ThumbsDown, MessageSquare, Share2, X, ChevronRight,
  ChevronLeft, Bookmark
} from 'lucide-react';

/**
 * Converts icon string names to Lucide icon components
 */
export const getIconComponent = (iconName: any) => {
  if (typeof iconName === 'function') {
    // It's already a React component
    return iconName;
  }
  
  const iconMap: { [key: string]: any } = {
    'Coffee': Coffee,
    'TreePine': TreePine,
    'Sparkles': Sparkles,
    'Dumbbell': Dumbbell,
    'Utensils': Utensils,
    'Eye': Eye,
    'Heart': Heart,
    'Calendar': Calendar,
    'MapPin': MapPin,
    'Clock': Clock,
    'Star': Star,
    'Navigation': Navigation,
    'Users': Users,
    'Check': Check,
    'ThumbsUp': ThumbsUp,
    'ThumbsDown': ThumbsDown,
    'MessageSquare': MessageSquare,
    'Share2': Share2,
    'X': X,
    'ChevronRight': ChevronRight,
    'ChevronLeft': ChevronLeft,
    'Bookmark': Bookmark
  };
  
  return iconMap[iconName] || Heart; // Default fallback
};

/**
 * Filters boards based on search query and filter type
 */
export const filterBoards = (
  boards: any[],
  searchQuery: string,
  filter: 'all' | 'active' | 'voting' | 'locked' | 'completed'
) => {
  let filtered = [...boards];
  
  // Apply search filter
  if (searchQuery) {
    filtered = filtered.filter(board =>
      board.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      board.participants?.some((p: any) => 
        p.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    );
  }
  
  // Apply status filter
  if (filter !== 'all') {
    if (filter === 'active') {
      filtered = filtered.filter(board => 
        board.status === 'active' && !board.votingActive && !board.isLocked
      );
    } else if (filter === 'voting') {
      filtered = filtered.filter(board => board.votingActive);
    } else if (filter === 'locked') {
      filtered = filtered.filter(board => board.isLocked);
    } else if (filter === 'completed') {
      filtered = filtered.filter(board => board.status === 'completed');
    }
  }
  
  return filtered;
};

/**
 * Filters saved cards based on search query and filter type
 */
export const filterSavedCards = (
  cards: any[],
  searchQuery: string,
  filter: 'all' | 'solo' | 'collaboration'
) => {
  let filtered = [...cards];
  
  // Apply search filter
  if (searchQuery) {
    filtered = filtered.filter(card =>
      card.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      card.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      card.description.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }
  
  // Apply source filter
  if (filter !== 'all') {
    filtered = filtered.filter(card => card.source === filter);
  }
  
  return filtered;
};

/**
 * Separates and sorts saved cards into active and archived sections
 */
export const categorizeSavedCards = (cards: any[]) => {
  // Active: Most recent first (newest to oldest)
  const active = cards
    .filter(card => !card.isArchived)
    .sort((a, b) => {
      const dateA = new Date(a.savedAt || a.addedAt || 0).getTime();
      const dateB = new Date(b.savedAt || b.addedAt || 0).getTime();
      return dateB - dateA; // Descending order (newest first)
    });
  
  // Archive: Earliest first (oldest to newest)
  const archived = cards
    .filter(card => card.isArchived)
    .sort((a, b) => {
      const dateA = new Date(a.archivedAt || a.savedAt || a.addedAt || 0).getTime();
      const dateB = new Date(b.archivedAt || b.savedAt || b.addedAt || 0).getTime();
      return dateA - dateB; // Ascending order (oldest first)
    });
  
  return { active, archived };
};

/**
 * Filters calendar entries based on search query and filters
 */
export const filterCalendarEntries = (
  entries: any[],
  searchQuery: string,
  timeFilter: 'all' | 'today' | 'this-week' | 'this-month' | 'upcoming',
  typeFilter: 'all' | 'purchased' | 'scheduled'
) => {
  let filtered = [...entries];
  
  // Apply search filter
  if (searchQuery) {
    filtered = filtered.filter(entry =>
      entry.experience?.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.experience?.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.experience?.description.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }
  
  // Apply time-based filter
  if (timeFilter !== 'all') {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const endOfWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const endOfMonth = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    
    filtered = filtered.filter(entry => {
      const entryDate = entry.suggestedDates?.[0] ? new Date(entry.suggestedDates[0]) : null;
      if (!entryDate) return false;
      
      switch (timeFilter) {
        case 'today':
          return entryDate >= today && entryDate < endOfToday;
        case 'this-week':
          return entryDate >= today && entryDate < endOfWeek;
        case 'this-month':
          return entryDate >= today && entryDate < endOfMonth;
        case 'upcoming':
          return entryDate >= today;
        default:
          return true;
      }
    });
  }
  
  // Apply type filter
  if (typeFilter === 'purchased') {
    filtered = filtered.filter(entry => entry.isPurchased === true);
  } else if (typeFilter === 'scheduled') {
    filtered = filtered.filter(entry => entry.isPurchased !== true);
  }
  
  return filtered;
};

/**
 * Separates and sorts calendar entries into active and archived sections
 */
export const categorizeCalendarEntries = (entries: any[]) => {
  const now = new Date();
  
  // Active: Soonest first (closest date to today)
  const active = entries
    .filter(entry => !entry.isArchived)
    .sort((a, b) => {
      const dateA = a.suggestedDates?.[0] ? new Date(a.suggestedDates[0]).getTime() : 0;
      const dateB = b.suggestedDates?.[0] ? new Date(b.suggestedDates[0]).getTime() : 0;
      return dateA - dateB; // Ascending order (soonest first)
    });
  
  // Archive: Most recent completion first
  const archived = entries
    .filter(entry => entry.isArchived)
    .sort((a, b) => {
      const dateA = new Date(a.archivedAt || a.completedAt || 0).getTime();
      const dateB = new Date(b.archivedAt || b.completedAt || 0).getTime();
      return dateB - dateA; // Descending order (most recent first)
    });
  
  return { active, archived };
};

/**
 * Checks if user is admin of a board
 */
export const isUserAdmin = (board: any, userId: string = 'current-user-id') => {
  return board.participants?.some(
    (p: any) => p.id === userId && (p.role === 'admin' || p.isAdmin)
  );
};

/**
 * Gets unread count for a board
 */
export const getUnreadCount = (board: any) => {
  // Calculate total unread messages across all types
  const discussionUnread = board.discussionMessages?.filter((msg: any) => 
    !msg.read && msg.senderId !== 'current-user-id'
  ).length || 0;
  
  const votingUnread = board.votingUnread || 0;
  const proposalUnread = board.proposalUnread || 0;
  
  return discussionUnread + votingUnread + proposalUnread;
};

/**
 * Formats date for display
 */
export const formatDisplayDate = (date: Date | string) => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: 'numeric'
  });
};

/**
 * Formats time for display
 */
export const formatDisplayTime = (date: Date | string) => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit', 
    hour12: true 
  });
};

/**
 * Gets status badge color
 */
export const getStatusBadgeColor = (status: string) => {
  switch (status) {
    case 'active':
      return 'bg-green-100 text-green-700';
    case 'voting':
      return 'bg-blue-100 text-blue-700';
    case 'locked':
      return 'bg-orange-100 text-orange-700';
    case 'completed':
      return 'bg-gray-100 text-gray-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
};
