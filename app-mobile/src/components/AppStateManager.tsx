import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
    cardsCount: 3,
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
    cardsCount: 4,
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
    cardsCount: 6,
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

// Safe AsyncStorage operations
const safeAsyncStorageGet = async (key: string, defaultValue: any) => {
  try {
    const stored = await AsyncStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch (error) {
    console.error(`Error loading ${key}:`, error);
    return defaultValue;
  }
};

const safeAsyncStorageSet = async (key: string, value: any) => {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
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
  const [currentPage, setCurrentPage] = useState<'home' | 'connections' | 'activity' | 'profile' | 'profile-settings' | 'account-settings' | 'privacy-policy' | 'terms-of-service'>('home');
  const [showPreferences, setShowPreferences] = useState(false);
  const [showCollaboration, setShowCollaboration] = useState(false);
  const [showCollabPreferences, setShowCollabPreferences] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareData, setShareData] = useState<any>(null);
  const [currentMode, setCurrentMode] = useState<'solo' | string>('solo');
  const [preSelectedFriend, setPreSelectedFriend] = useState<any>(null);
  const [activeSessionData, setActiveSessionData] = useState<any>(null);
  
  // Data state with lazy initialization
  const [userPreferences, setUserPreferences] = useState<any>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [collaborationPreferences, setCollaborationPreferences] = useState<{[sessionId: string]: any}>({});
  
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  const [activityNavigation, setActivityNavigation] = useState<{
    selectedBoard?: any;
    activeTab?: 'saved' | 'boards' | 'calendar';
    discussionTab?: string;
  } | null>(null);
  
  const [userIdentity, setUserIdentity] = useState({
    firstName: 'Jordan',
    lastName: 'Smith',
    username: 'jordansmith',
    profileImage: null
  });

  const [accountPreferences, setAccountPreferences] = useState({
    currency: 'USD',
    measurementSystem: 'Imperial'
  });

  // Large data arrays with lazy initialization
  const [calendarEntries, setCalendarEntries] = useState([]);
  const [savedCards, setSavedCards] = useState([]);
  const [removedCardIds, setRemovedCardIds] = useState([]);
  const [friendsList, setFriendsList] = useState(DEFAULT_FRIENDS);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [boardsSessions, setBoardsSessions] = useState(DEFAULT_BOARDS_SESSIONS);

  const [profileStats, setProfileStats] = useState({
    savedExperiences: 0,
    boardsCount: 3,
    connectionsCount: 5,
    placesVisited: 0
  });



  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false); // Will be updated from AsyncStorage in useEffect
  const [userRole, setUserRole] = useState('explorer'); // Will be updated from AsyncStorage in useEffect
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  // Load authentication and onboarding data on component mount
  useEffect(() => {
    const loadAuthData = async () => {
      try {
        const authStored = await AsyncStorage.getItem('mingla_is_authenticated');
        const roleStored = await AsyncStorage.getItem('mingla_user_role');
        const onboardingStored = await AsyncStorage.getItem('mingla_onboarding_completed');
        const dataStored = await AsyncStorage.getItem('mingla_onboarding_data');
        
        if (authStored === 'true') {
          setIsAuthenticated(true);
          if (roleStored) {
            setUserRole(roleStored);
          }
          
          if (onboardingStored === 'true') {
            setHasCompletedOnboarding(true);
            if (dataStored) {
              setOnboardingData(JSON.parse(dataStored));
            }
          }
        } else {
          // User is not authenticated, show SignInPage
          setIsAuthenticated(false);
          setUserRole('explorer');
          setHasCompletedOnboarding(false);
          setOnboardingData(null);
        }
      } catch (error) {
        console.error('Error loading auth/onboarding data:', error);
        setIsAuthenticated(false);
        setUserRole('explorer');
        setHasCompletedOnboarding(false);
        setOnboardingData(null);
      } finally {
        setIsLoadingAuth(false);
        setIsLoadingOnboarding(false);
      }
    };
    
    loadAuthData();
  }, []);

  // Load other data from AsyncStorage
  useEffect(() => {
    const loadStoredData = async () => {
      try {
        const [
          notificationsEnabledData,
          userIdentityData,
          accountPreferencesData,
          calendarEntriesData,
          savedCardsData,
          removedCardIdsData,
          friendsListData,
          blockedUsersData,
          boardsSessionsData
        ] = await Promise.all([
          safeAsyncStorageGet('mingla_notifications_enabled', true),
          safeAsyncStorageGet('mingla_user_identity', {
            firstName: 'Jordan',
            lastName: 'Smith',
            username: 'jordansmith',
            profileImage: null
          }),
          safeAsyncStorageGet('mingla_account_preferences', {
            currency: 'USD',
            measurementSystem: 'Imperial'
          }),
          safeAsyncStorageGet('mingla_calendar_entries', []),
          safeAsyncStorageGet('mingla_saved_cards', []),
          safeAsyncStorageGet('mingla_removed_cards', []),
          safeAsyncStorageGet('mingla_friends_list', DEFAULT_FRIENDS),
          safeAsyncStorageGet('mingla_blocked_users', []),
          safeAsyncStorageGet('mingla_boards_sessions', DEFAULT_BOARDS_SESSIONS)
        ]);

        setNotificationsEnabled(notificationsEnabledData);
        setUserIdentity(userIdentityData);
        setAccountPreferences(accountPreferencesData);
        setCalendarEntries(calendarEntriesData);
        setSavedCards(savedCardsData);
        setRemovedCardIds(removedCardIdsData);
        setFriendsList(friendsListData);
        setBlockedUsers(blockedUsersData);
        setBoardsSessions(boardsSessionsData);

        // Update profile stats based on loaded data
        setProfileStats({
          savedExperiences: savedCardsData.length,
          boardsCount: boardsSessionsData.length,
          connectionsCount: friendsListData.length,
          placesVisited: 0
        });
      } catch (error) {
        console.error('Error loading stored data:', error);
      }
    };

    loadStoredData();
  }, []);

  // Utility functions
  const updateBoardsSessions = (updatedBoards: any[]) => {
    setBoardsSessions(updatedBoards);
    safeAsyncStorageSet('mingla_boards_sessions', updatedBoards);
    setProfileStats(prev => ({
      ...prev,
      boardsCount: updatedBoards.length
    }));
  };

  const handleUserIdentityUpdate = (updatedIdentity: any) => {
    setUserIdentity(updatedIdentity);
    safeAsyncStorageSet('mingla_user_identity', updatedIdentity);
  };

  const handleAccountPreferencesUpdate = (updatedPreferences: any) => {
    setAccountPreferences(updatedPreferences);
    safeAsyncStorageSet('mingla_account_preferences', updatedPreferences);
  };

  // Authentication handlers
  const handleSignIn = (credentials: { email: string; password: string }, role: 'explorer' | 'curator') => {
    // In a real app, this would validate credentials with a server
    console.log('Sign in:', { email: credentials.email, role });
    
    setIsAuthenticated(true);
    setUserRole(role);
    safeAsyncStorageSet('mingla_is_authenticated', true);
    safeAsyncStorageSet('mingla_user_role', role);
    
    // Existing users who sign in should go directly to home page
    // Check if they have completed onboarding before
    const checkExistingOnboarding = async () => {
      try {
        const onboardingStored = await AsyncStorage.getItem('mingla_onboarding_completed');
        const dataStored = await AsyncStorage.getItem('mingla_onboarding_data');
        
        if (onboardingStored === 'true') {
          // User has completed onboarding before, go directly to home
          setHasCompletedOnboarding(true);
          if (dataStored) {
            setOnboardingData(JSON.parse(dataStored));
          }
        } else {
          // First time user, they need to complete onboarding
          setHasCompletedOnboarding(false);
          setOnboardingData(null);
        }
      } catch (error) {
        console.error('Error checking onboarding status:', error);
        // Default to requiring onboarding for safety
        setHasCompletedOnboarding(false);
        setOnboardingData(null);
      }
    };
    
    checkExistingOnboarding();
    
    // Set user identity based on email
    const [firstName] = credentials.email.split('@')[0].split('.');
    const updatedIdentity = {
      firstName: firstName.charAt(0).toUpperCase() + firstName.slice(1) || 'User',
      lastName: role === 'curator' ? 'Curator' : 'Explorer',
      username: credentials.email.split('@')[0],
      profileImage: null,
      role: role
    };
    setUserIdentity(updatedIdentity);
    safeAsyncStorageSet('mingla_user_identity', updatedIdentity);
  };

  const handleSignUp = (userData: { email: string; password: string; name: string; organization?: string }, role: 'explorer' | 'curator') => {
    // In a real app, this would create account on server
    console.log('Sign up:', { ...userData, role });
    
    setIsAuthenticated(true);
    setUserRole(role);
    safeAsyncStorageSet('mingla_is_authenticated', true);
    safeAsyncStorageSet('mingla_user_role', role);
    
    // New users should go through onboarding (especially explorers)
    setHasCompletedOnboarding(false);
    setOnboardingData(null);
    safeAsyncStorageSet('mingla_onboarding_completed', 'false');
    AsyncStorage.removeItem('mingla_onboarding_data');
    
    // Set user identity from sign up data
    const [firstName, ...lastNameParts] = userData.name.split(' ');
    const updatedIdentity = {
      firstName: firstName || 'User',
      lastName: lastNameParts.join(' ') || (role === 'curator' ? 'Curator' : 'Explorer'),
      username: userData.email.split('@')[0],
      profileImage: null,
      role: role,
      organization: userData.organization
    };
    setUserIdentity(updatedIdentity);
    safeAsyncStorageSet('mingla_user_identity', updatedIdentity);
  };

  const handleSignOut = () => {
    setIsAuthenticated(false);
    setUserRole('explorer');
    setHasCompletedOnboarding(false);
    setOnboardingData(null);
    
    // Clear all stored data
    AsyncStorage.clear();
    
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
    
    // Utilities
    updateBoardsSessions,
    handleUserIdentityUpdate,
    handleAccountPreferencesUpdate,
    safeAsyncStorageSet,
    
    // Authentication Handlers
    handleSignIn,
    handleSignUp,
    handleSignOut
  };
}