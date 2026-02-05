import { useState, useEffect } from 'react';
import { PLATFORM_CARDS_SEED } from './utils/platformCards';
import { BUSINESSES_SEED } from './utils/businessesSeed';
import { initializeCollaborationSeedData, assignCollaborationsToCurrentUser } from './utils/collaborationsSeed';

// Default data constants moved to separate module to prevent re-creation
const DEFAULT_FRIENDS = [
  {
    id: '1',
    name: 'Arifat Ola-dauda',
    username: 'Ari99',
    status: 'online',
    isOnline: true,
    mutualFriends: 12
  },
  {
    id: '2',
    name: 'Sethozia Testing',
    username: 'Sethozia',
    status: 'away',
    isOnline: false,
    lastSeen: '2 hours ago',
    mutualFriends: 8
  },
  {
    id: '3',
    name: 'Marcus Chen',
    username: 'MarcusC',
    status: 'online',
    isOnline: true,
    mutualFriends: 15
  },
  {
    id: '4',
    name: 'Sarah Williams',
    username: 'SarahW',
    status: 'offline',
    isOnline: false,
    lastSeen: '1 day ago',
    mutualFriends: 6
  },
  {
    id: '5',
    name: 'David Rodriguez',
    username: 'DavidR',
    status: 'online',
    isOnline: true,
    mutualFriends: 9
  }
];

const DEFAULT_BOARDS_SESSIONS = [
  {
    id: 'board1',
    name: 'Weekend Date Night',
    type: 'date-night',
    description: 'Romantic weekend experiences for couples',
    participants: [
      { id: 'you', name: 'You', status: 'online' },
      { id: 'sarah', name: 'Sarah', status: 'online' }
    ],
    status: 'voting',
    voteDeadline: 'Tomorrow',
    cardsCount: 0,
    cards: [], // Initialize empty cards array
    createdAt: '2 days ago',
    unreadMessages: 3,
    lastActivity: '2 hours ago',
    icon: 'Heart',
    gradient: 'from-pink-500 to-rose-500',
    creatorId: 'you',
    admins: ['you'],
    currentUserId: 'you'
  },
  {
    id: 'board2',
    name: 'Fitness Squad Goals',
    type: 'wellness',
    description: 'Weekly workout adventures with the crew',
    participants: [
      { id: 'you', name: 'You', status: 'online' },
      { id: 'alex', name: 'Alex', status: 'online' },
      { id: 'jamie', name: 'Jamie', status: 'offline', lastActive: '1h ago' },
      { id: 'casey', name: 'Casey', status: 'online' }
    ],
    status: 'active',
    cardsCount: 0,
    cards: [], // Initialize empty cards array
    createdAt: '1 week ago',
    unreadMessages: 1,
    lastActivity: '30 minutes ago',
    icon: 'Dumbbell',
    gradient: 'from-green-500 to-emerald-500',
    creatorId: 'alex',
    admins: ['alex', 'you'],
    currentUserId: 'you'
  },
  {
    id: 'board3',
    name: 'Foodie Adventures',
    type: 'food-tour',
    description: 'Discovering the best eats in the city',
    participants: [
      { id: 'you', name: 'You', status: 'online' },
      { id: 'morgan', name: 'Morgan', status: 'online' },
      { id: 'riley', name: 'Riley', status: 'offline', lastActive: '2h ago' }
    ],
    status: 'locked',
    finalizedDate: 'This Saturday',
    cardsCount: 0,
    cards: [], // Initialize empty cards array
    createdAt: '3 days ago',
    unreadMessages: 0,
    lastActivity: '1 day ago',
    icon: 'Utensils',
    gradient: 'from-orange-500 to-red-500',
    creatorId: 'you',
    admins: ['you'],
    currentUserId: 'you'
  }
];

// Demo cards for "Propose New Date" feature - Active saved card
const DEMO_SAVED_CARD_ACTIVE = {
  id: 'demo-saved-active-1',
  title: 'Golden Gate Park Picnic & Bike Tour',
  category: 'picnics',
  categoryId: 'picnics',
  categoryIcon: 'Coffee',
  description: 'Enjoy a scenic bike tour through Golden Gate Park followed by a gourmet picnic',
  image: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800',
  images: ['https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800'],
  rating: 4.7,
  reviewCount: 289,
  priceRange: '$45-65',
  travelTime: '12 min',
  distance: '3.1 km',
  experienceType: 'outdoor',
  highlights: ['Bike rental included', 'Gourmet picnic basket', 'Scenic routes', 'Photo spots'],
  fullDescription: 'Experience the beauty of Golden Gate Park on a guided bike tour, stopping at the most Instagram-worthy locations. End with a curated picnic featuring local artisan foods.',
  address: 'Golden Gate Park, 501 Stanyan St',
  openingHours: 'Daily 9AM-6PM',
  tags: ['Outdoor', 'Active', 'Romantic', 'Photo-worthy'],
  matchScore: 88,
  budget: 'Perfect for your budget',
  savedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  dateAdded: '2 days ago',
  sessionType: 'solo',
  source: 'solo',
  requiresReservation: true,
  isArchived: false,
  socialStats: {
    views: 3420,
    likes: 456,
    saves: 189,
    shares: 67
  }
};

// Archived saved card - had a scheduled date that passed
const DEMO_SAVED_CARD_ARCHIVED = (() => {
  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 7);
  pastDate.setHours(11, 0, 0, 0); // 11:00 AM
  
  return {
    id: 'demo-saved-archived-1',
    title: 'Sunset Kayaking Adventure',
    category: 'playMove',
    categoryId: 'playMove',
    categoryIcon: 'Dumbbell',
    description: 'Paddle through calm waters as the sun sets over the bay',
    image: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800',
    images: ['https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800'],
    rating: 4.6,
    reviewCount: 198,
    priceRange: '$35-55',
    travelTime: '25 min',
    distance: '7.8 km',
    experienceType: 'outdoor',
    highlights: ['Equipment provided', 'Beginner friendly', 'Stunning views', 'Safety instruction'],
    fullDescription: 'Experience the magic of San Francisco Bay from the water on this guided sunset kayaking tour. Perfect for beginners, with all equipment and instruction provided.',
    address: 'Bay Kayak Center, Pier 40',
    openingHours: 'Tours: 5PM-8PM (seasonal)',
    tags: ['Adventure', 'Active', 'Nature', 'Sunset'],
    matchScore: 82,
    budget: 'Budget-friendly',
    savedAt: new Date(Date.now() - 86400000 * 14).toISOString(),
    dateAdded: '2 weeks ago',
    sessionType: 'solo',
    source: 'solo',
    requiresReservation: true,
    isArchived: true,
    archivedAt: pastDate.toISOString(),
    dateTimePreferences: {
      scheduledDate: pastDate.toISOString(),
      scheduledTime: '11:00',
      displayText: pastDate.toLocaleString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })
    },
    socialStats: {
      views: 2156,
      likes: 312,
      saves: 142,
      shares: 54
    }
  };
})();

// Active calendar entry - upcoming event
const DEMO_CALENDAR_ENTRY_ACTIVE = (() => {
  // Calculate next Saturday at 7:00 PM
  const now = new Date();
  const daysUntilSaturday = (6 - now.getDay() + 7) % 7 || 7;
  const nextSaturday = new Date(now);
  nextSaturday.setDate(now.getDate() + daysUntilSaturday);
  nextSaturday.setHours(19, 0, 0, 0); // 7:00 PM

  return {
    id: 'demo-calendar-active-1',
    experience: {
      id: 'demo-exp-jazz-night',
      title: 'Jazz & Wine Evening at SFJAZZ Center',
      category: 'screenRelax',
      categoryId: 'screenRelax',
      categoryIcon: 'Sparkles',
      description: 'Live jazz performance with wine tasting in an intimate venue',
      image: 'https://images.unsplash.com/photo-1415201364774-f6f0bb35f28f?w=800',
      images: ['https://images.unsplash.com/photo-1415201364774-f6f0bb35f28f?w=800'],
      rating: 4.9,
      reviewCount: 567,
      priceRange: '$75-120',
      travelTime: '15 min',
      distance: '4.8 km',
      experienceType: 'evening',
      highlights: ['Live jazz performance', 'Wine tasting', 'Intimate setting', 'VIP lounge access'],
      fullDescription: 'Immerse yourself in the smooth sounds of jazz while sampling premium California wines. This exclusive evening features award-winning musicians in San Francisco\'s premier jazz venue.',
      address: 'SFJAZZ Center, 201 Franklin St',
      openingHours: 'Shows: 7PM & 9PM',
      tags: ['Music', 'Nightlife', 'Sophisticated', 'Date Night'],
      matchScore: 94,
      budget: 'Premium experience',
      requiresReservation: true,
      socialStats: {
        views: 5234,
        likes: 892,
        saves: 445,
        shares: 123
      }
    },
    dateTimePreferences: {
      scheduledDate: nextSaturday.toISOString(),
      scheduledTime: '19:00',
      displayText: nextSaturday.toLocaleString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })
    },
    sessionType: 'solo',
    sessionName: 'Solo Session',
    addedAt: new Date(Date.now() - 86400000 * 3).toISOString(), // 3 days ago
    status: 'locked-in',
    suggestedDates: [nextSaturday.toISOString()],
    isLiked: true,
    isPurchased: false,
    isArchived: false
  };
})();

// Archived calendar entry - past event
const DEMO_CALENDAR_ENTRY_ARCHIVED = (() => {
  // Calculate a date 5 days ago at 2:00 PM
  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 5);
  pastDate.setHours(14, 0, 0, 0); // 2:00 PM

  return {
    id: 'demo-calendar-archived-1',
    experience: {
      id: 'demo-exp-pottery-workshop',
      title: 'Artisan Pottery Making Workshop',
      category: 'creative',
      categoryId: 'creative',
      categoryIcon: 'Sparkles',
      description: 'Learn pottery from a master ceramicist in a hands-on workshop',
      image: 'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=800',
      images: ['https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=800'],
      rating: 4.8,
      reviewCount: 342,
      priceRange: '$55-85',
      travelTime: '18 min',
      distance: '5.2 km',
      experienceType: 'creative',
      highlights: ['Hands-on learning', 'All materials included', 'Take home your creation', 'Expert instruction'],
      fullDescription: 'Create your own ceramic masterpiece under the guidance of an experienced ceramicist. This immersive workshop covers hand-building techniques and wheel throwing basics.',
      address: 'The Clay Studio, 789 Valencia St',
      openingHours: 'Workshops: Weekends 10AM-5PM',
      tags: ['Creative', 'Hands-on', 'Relaxing', 'Artistic'],
      matchScore: 87,
      budget: 'Great value',
      requiresReservation: true,
      socialStats: {
        views: 2987,
        likes: 543,
        saves: 276,
        shares: 89
      }
    },
    dateTimePreferences: {
      scheduledDate: pastDate.toISOString(),
      scheduledTime: '14:00',
      displayText: pastDate.toLocaleString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })
    },
    sessionType: 'solo',
    sessionName: 'Solo Session',
    addedAt: new Date(Date.now() - 86400000 * 10).toISOString(), // 10 days ago
    status: 'locked-in',
    suggestedDates: [pastDate.toISOString()],
    isLiked: true,
    isPurchased: false,
    isArchived: true,
    archivedAt: pastDate.toISOString(),
    userReview: {
      rating: 5,
      comment: 'Amazing experience! The instructor was so patient and helpful. Made a beautiful bowl!',
      reviewedAt: new Date(Date.now() - 86400000 * 4).toISOString(),
      userId: 'jordansmith'
    }
  };
})();

// Safe localStorage operations
const safeLocalStorageGet = (key: string, defaultValue: any) => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch (error) {
    console.error(`Error loading ${key}:`, error);
    return defaultValue;
  }
};

const safeLocalStorageSet = (key: string, value: any) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Error saving ${key}:`, error);
  }
};

export function useAppState() {
  // Onboarding state
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [onboardingData, setOnboardingData] = useState(null);
  const [isLoadingOnboarding, setIsLoadingOnboarding] = useState(true);

  // UI state
  const [currentPage, setCurrentPage] = useState<'home' | 'discover' | 'connections' | 'messages' | 'activity' | 'profile' | 'profile-settings' | 'account-settings' | 'privacy-policy' | 'terms-of-service' | 'business-dashboard'>('home');
  const [showPreferences, setShowPreferences] = useState(false);
  const [showCollaboration, setShowCollaboration] = useState(false);
  const [showCollabPreferences, setShowCollabPreferences] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareData, setShareData] = useState<any>(null);
  const [currentMode, setCurrentMode] = useState<'solo' | string>('solo');
  const [preSelectedFriend, setPreSelectedFriend] = useState<any>(null);
  const [activeSessionData, setActiveSessionData] = useState<any>(null);
  
  // Data state with lazy initialization
  const [userPreferences, setUserPreferences] = useState<any>(() => {
    // Try to load from localStorage first
    try {
      const stored = localStorage.getItem('mingla_user_preferences');
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      console.error('Error loading user preferences:', error);
      return null;
    }
  });
  const [notifications, setNotifications] = useState<any[]>([]);
  const [collaborationPreferences, setCollaborationPreferences] = useState<{[sessionId: string]: any}>({});
  
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => 
    safeLocalStorageGet('mingla_notifications_enabled', true)
  );

  const [activityNavigation, setActivityNavigation] = useState<{
    selectedBoard?: any;
    activeTab?: 'saved' | 'boards' | 'calendar';
    discussionTab?: string;
  } | null>(null);
  
  const [userIdentity, setUserIdentity] = useState(() => 
    safeLocalStorageGet('mingla_user_identity', {
      firstName: 'Jordan',
      lastName: 'Smith',
      username: 'jordansmith',
      profileImage: null
    })
  );

  const [accountPreferences, setAccountPreferences] = useState(() => 
    safeLocalStorageGet('mingla_account_preferences', {
      currency: 'USD',
      measurementSystem: 'Imperial'
    })
  );

  // Large data arrays with lazy initialization
  const [calendarEntries, setCalendarEntries] = useState(() => {
    const stored = safeLocalStorageGet('mingla_calendar_entries', []);
    // Add demo cards if not already present
    const demoIds = ['demo-calendar-active-1', 'demo-calendar-archived-1'];
    const needsDemos = !demoIds.every(id => stored.find((e: any) => e.id === id));
    
    if (stored.length === 0 || needsDemos) {
      return [DEMO_CALENDAR_ENTRY_ACTIVE, DEMO_CALENDAR_ENTRY_ARCHIVED, ...stored.filter((e: any) => !demoIds.includes(e.id))];
    }
    return stored;
  });

  const [savedCards, setSavedCards] = useState(() => {
    const stored = safeLocalStorageGet('mingla_saved_cards', []);
    // Add demo cards if not already present
    const demoIds = ['demo-saved-active-1', 'demo-saved-archived-1'];
    const needsDemos = !demoIds.every(id => stored.find((c: any) => c.id === id));
    
    if (stored.length === 0 || needsDemos) {
      return [DEMO_SAVED_CARD_ACTIVE, DEMO_SAVED_CARD_ARCHIVED, ...stored.filter((c: any) => !demoIds.includes(c.id))];
    }
    return stored;
  });

  const [removedCardIds, setRemovedCardIds] = useState(() => 
    safeLocalStorageGet('mingla_removed_cards', [])
  );

  const [friendsList, setFriendsList] = useState(() => 
    safeLocalStorageGet('mingla_friends_list', DEFAULT_FRIENDS)
  );

  const [blockedUsers, setBlockedUsers] = useState(() => 
    safeLocalStorageGet('mingla_blocked_users', [])
  );

  const [boardsSessions, setBoardsSessions] = useState(() => 
    safeLocalStorageGet('mingla_boards_sessions', DEFAULT_BOARDS_SESSIONS)
  );

  const [profileStats, setProfileStats] = useState(() => {
    try {
      const savedCount = safeLocalStorageGet('mingla_saved_cards', []).length;
      const boardsCount = safeLocalStorageGet('mingla_boards_sessions', DEFAULT_BOARDS_SESSIONS).length;
      const friendsCount = safeLocalStorageGet('mingla_friends_list', DEFAULT_FRIENDS).length;
      return {
        savedExperiences: savedCount,
        boardsCount: boardsCount,
        connectionsCount: friendsCount,
        placesVisited: 0
      };
    } catch (error) {
      console.error('Error loading profile stats:', error);
      return {
        savedExperiences: 0,
        boardsCount: 3,
        connectionsCount: 5,
        placesVisited: 0
      };
    }
  });

  // Platform cards state - centralized card storage for all user roles
  // All live cards shown to explorers come from this store
  const [platformCards, setPlatformCards] = useState(() => {
    const stored = safeLocalStorageGet('mingla_platform_cards', null);
    if (stored && stored.length > 0) {
      return stored;
    }
    // Initialize with seed data on first load
    return PLATFORM_CARDS_SEED;
  });
  
  // Legacy: Keep curatorCards for backwards compatibility, but it now references platformCards
  const curatorCards = platformCards;
  const setCuratorCards = setPlatformCards;

  // Business state - stores all businesses onboarded by curators
  const [businesses, setBusinesses] = useState(() => {
    const stored = safeLocalStorageGet('mingla_businesses', null);
    if (stored && stored.length > 0) {
      return stored;
    }
    // Initialize with seed data on first load
    return BUSINESSES_SEED;
  });

  // Active business for proxy mode (when curator is managing a business)
  const [activeBusinessProxy, setActiveBusinessProxy] = useState<any>(null);

  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(() => 
    safeLocalStorageGet('mingla_is_authenticated', false)
  );
  const [userRole, setUserRole] = useState(() => 
    safeLocalStorageGet('mingla_user_role', 'explorer') // 'explorer' or 'business'
  );
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  // Load authentication and onboarding data on component mount
  useEffect(() => {
    // ALWAYS start fresh - clear authentication on page load/reload
    // This ensures users always land on sign-in page
    try {
      // Clear all authentication-related localStorage
      localStorage.removeItem('mingla_is_authenticated');
      localStorage.removeItem('mingla_user_role');
      localStorage.removeItem('mingla_onboarding_completed');
      localStorage.removeItem('mingla_onboarding_data');
      
      // Set to clean unauthenticated state
      setIsAuthenticated(false);
      setUserRole('explorer');
      setHasCompletedOnboarding(false);
      setOnboardingData(null);
      
      console.log('App loaded - authentication cleared, showing sign-in page');
    } catch (error) {
      console.error('Error clearing auth data:', error);
      // On error, reset to safe defaults (sign-in page)
      setIsAuthenticated(false);
      setUserRole('explorer');
      setHasCompletedOnboarding(false);
      setOnboardingData(null);
    } finally {
      setIsLoadingAuth(false);
      setIsLoadingOnboarding(false);
    }
  }, []);

  // Initialize collaboration seed data
  useEffect(() => {
    // Only run once on mount
    const hasInitializedCollab = sessionStorage.getItem('collab_seed_initialized');
    if (!hasInitializedCollab) {
      try {
        initializeCollaborationSeedData();
        sessionStorage.setItem('collab_seed_initialized', 'true');
      } catch (error) {
        console.error('Error initializing collaboration seed data:', error);
      }
    }
  }, []);

  // Utility functions
  const updateBoardsSessions = (updatedBoards: any[]) => {
    setBoardsSessions(updatedBoards);
    safeLocalStorageSet('mingla_boards_sessions', updatedBoards);
    setProfileStats(prev => ({
      ...prev,
      boardsCount: updatedBoards.length
    }));
  };

  const handleUserIdentityUpdate = (updatedIdentity: any) => {
    setUserIdentity(updatedIdentity);
    safeLocalStorageSet('mingla_user_identity', updatedIdentity);
  };

  const handleAccountPreferencesUpdate = (updatedPreferences: any) => {
    setAccountPreferences(updatedPreferences);
    safeLocalStorageSet('mingla_account_preferences', updatedPreferences);
  };

  const updateCuratorCards = (updatedCards: any[]) => {
    setPlatformCards(updatedCards);
    safeLocalStorageSet('mingla_platform_cards', updatedCards);
  };
  
  const updatePlatformCards = (updatedCards: any[]) => {
    setPlatformCards(updatedCards);
    safeLocalStorageSet('mingla_platform_cards', updatedCards);
  };
  
  // Add a new card to the platform
  const addPlatformCard = (cardData: any) => {
    const newCard = {
      ...cardData,
      id: cardData.id || `card-${Date.now()}`,
      createdAt: cardData.createdAt || new Date().toISOString(),
      lastEdited: new Date().toISOString(),
      status: cardData.status || 'draft',
      views: 0,
      likes: 0,
      saves: 0,
      shares: 0,
      totalSales: 0
    };
    const updatedCards = [...platformCards, newCard];
    updatePlatformCards(updatedCards);
    return newCard;
  };
  
  // Update an existing card
  const updatePlatformCard = (cardId: string, updates: any) => {
    const updatedCards = platformCards.map((card: any) =>
      card.id === cardId
        ? { ...card, ...updates, lastEdited: new Date().toISOString() }
        : card
    );
    updatePlatformCards(updatedCards);
  };
  
  // Delete a card
  const deletePlatformCard = (cardId: string) => {
    const updatedCards = platformCards.filter((card: any) => card.id !== cardId);
    updatePlatformCards(updatedCards);
  };

  const updateBusinesses = (updatedBusinesses: any[]) => {
    setBusinesses(updatedBusinesses);
    safeLocalStorageSet('mingla_businesses', updatedBusinesses);
  };

  const addBusiness = (businessData: any) => {
    const updatedBusinesses = [...businesses, businessData];
    updateBusinesses(updatedBusinesses);
  };

  const updateBusiness = (businessId: string, updatedData: any) => {
    const updatedBusinesses = businesses.map((b: any) =>
      b.id === businessId ? { ...b, ...updatedData } : b
    );
    updateBusinesses(updatedBusinesses);
  };

  const deleteBusiness = (businessId: string) => {
    const updatedBusinesses = businesses.filter((b: any) => b.id !== businessId);
    updateBusinesses(updatedBusinesses);
  };

  // Authentication handlers
  const handleSignIn = (credentials: { email: string; password: string }, role: 'explorer' | 'curator' | 'business' | 'qa-manager' | 'admin') => {
    // In a real app, this would validate credentials with a server
    console.log('Sign in:', { email: credentials.email, role });
    
    setIsAuthenticated(true);
    setUserRole(role);
    safeLocalStorageSet('mingla_is_authenticated', true);
    safeLocalStorageSet('mingla_user_role', role);
    
    // Sign in always skips onboarding (existing users)
    setHasCompletedOnboarding(true);
    safeLocalStorageSet('mingla_onboarding_completed', 'true');
    
    // Set user identity based on email
    const [firstName] = credentials.email.split('@')[0].split('.');
    const getRoleLabel = (r: string) => {
      switch(r) {
        case 'explorer': return 'Explorer';
        case 'curator': return 'Curator';
        case 'business': return 'Business';
        case 'qa-manager': return 'QA';
        case 'admin': return 'Admin';
        default: return 'User';
      }
    };
    
    const updatedIdentity = {
      firstName: firstName.charAt(0).toUpperCase() + firstName.slice(1) || 'User',
      lastName: getRoleLabel(role),
      username: credentials.email.split('@')[0],
      profileImage: null,
      role: role,
      email: credentials.email,
      id: credentials.email
    };
    setUserIdentity(updatedIdentity);
    safeLocalStorageSet('mingla_user_identity', updatedIdentity);
    
    // Assign collaboration seed data to this user if they're a curator or business
    if (role === 'curator' || role === 'business') {
      try {
        assignCollaborationsToCurrentUser(
          credentials.email,
          role,
          `${updatedIdentity.firstName} ${updatedIdentity.lastName}`
        );
      } catch (error) {
        console.error('Error assigning collaborations to user:', error);
      }
    }
  };

  const handleSignUp = (userData: { email: string; password: string; name: string; organization?: string }, role: 'explorer' | 'curator' | 'business' | 'qa-manager' | 'admin') => {
    // In a real app, this would create account on server
    console.log('Sign up:', { ...userData, role });
    
    setIsAuthenticated(true);
    setUserRole(role);
    safeLocalStorageSet('mingla_is_authenticated', true);
    safeLocalStorageSet('mingla_user_role', role);
    
    // Internal roles (QA Manager, Admin) skip onboarding, regular users go through onboarding
    // Business users, explorers, and curators all go through their respective onboarding flows
    if (['content-manager', 'qa-manager', 'admin'].includes(role)) {
      setHasCompletedOnboarding(true);
      safeLocalStorageSet('mingla_onboarding_completed', 'true');
    } else {
      // New users should go through onboarding (explorers, curators, and business users)
      setHasCompletedOnboarding(false);
      setOnboardingData(null);
      safeLocalStorageSet('mingla_onboarding_completed', 'false');
      localStorage.removeItem('mingla_onboarding_data');
    }
    
    // Set user identity from sign up data
    const [firstName, ...lastNameParts] = userData.name.split(' ');
    const updatedIdentity = {
      firstName: firstName || 'User',
      lastName: lastNameParts.join(' ') || (role === 'curator' ? 'Curator' : 'Explorer'),
      username: userData.email.split('@')[0],
      profileImage: null,
      role: role,
      organization: userData.organization,
      email: userData.email,
      id: userData.email
    };
    setUserIdentity(updatedIdentity);
    safeLocalStorageSet('mingla_user_identity', updatedIdentity);
    
    // Assign collaboration seed data to this user if they're a curator or business
    if (role === 'curator' || role === 'business') {
      try {
        assignCollaborationsToCurrentUser(
          userData.email,
          role,
          `${updatedIdentity.firstName} ${updatedIdentity.lastName}`
        );
      } catch (error) {
        console.error('Error assigning collaborations to user:', error);
      }
    }
  };

  const handleSignOut = () => {
    setIsAuthenticated(false);
    setUserRole('explorer');
    setHasCompletedOnboarding(false);
    setOnboardingData(null);
    
    // Reset to homepage
    setCurrentPage('home');
    
    // Preserve coach mark completion status before clearing
    const coachMarkCompleted = localStorage.getItem('mingla_coachmark_v2');
    
    // Clear all stored data
    localStorage.clear();
    
    // Restore coach mark completion so returning users don't see the tour again
    if (coachMarkCompleted === 'completed') {
      localStorage.setItem('mingla_coachmark_v2', 'completed');
    }
    
    console.log('User signed out and all data cleared');
  };

  return {
    // Authentication State
    isAuthenticated,
    setIsAuthenticated,
    userRole,
    setUserRole,
    isLoadingAuth,
    setIsLoadingAuth,
    
    // Onboarding State
    hasCompletedOnboarding,
    setHasCompletedOnboarding,
    onboardingData,
    setOnboardingData,
    isLoadingOnboarding,
    setIsLoadingOnboarding,
    currentPage,
    setCurrentPage,
    showPreferences,
    setShowPreferences,
    showCollaboration,
    setShowCollaboration,
    showCollabPreferences,
    setShowCollabPreferences,
    showShareModal,
    setShowShareModal,
    shareData,
    setShareData,
    currentMode,
    setCurrentMode,
    preSelectedFriend,
    setPreSelectedFriend,
    activeSessionData,
    setActiveSessionData,
    userPreferences,
    setUserPreferences,
    notifications,
    setNotifications,
    collaborationPreferences,
    setCollaborationPreferences,
    notificationsEnabled,
    setNotificationsEnabled,
    activityNavigation,
    setActivityNavigation,
    userIdentity,
    setUserIdentity,
    accountPreferences,
    setAccountPreferences,
    calendarEntries,
    setCalendarEntries,
    savedCards,
    setSavedCards,
    removedCardIds,
    setRemovedCardIds,
    friendsList,
    setFriendsList,
    blockedUsers,
    setBlockedUsers,
    boardsSessions,
    setBoardsSessions,
    profileStats,
    setProfileStats,
    curatorCards,
    setCuratorCards,
    platformCards,
    setPlatformCards,
    businesses,
    setBusinesses,
    activeBusinessProxy,
    setActiveBusinessProxy,
    
    // Utilities
    updateBoardsSessions,
    handleUserIdentityUpdate,
    handleAccountPreferencesUpdate,
    updateCuratorCards,
    updatePlatformCards,
    addPlatformCard,
    updatePlatformCard,
    deletePlatformCard,
    updateBusinesses,
    addBusiness,
    updateBusiness,
    deleteBusiness,
    safeLocalStorageSet,
    
    // Authentication Handlers
    handleSignIn,
    handleSignUp,
    handleSignOut
  };
}