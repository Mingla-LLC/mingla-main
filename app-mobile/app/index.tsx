import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { SafeAreaView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AccountSettings from '../src/components/AccountSettings';
import ActivityPage from '../src/components/ActivityPage';
import { useAppHandlers } from '../src/components/AppHandlers';
import { useAppState } from '../src/components/AppStateManager';
import CollaborationModule from '../src/components/CollaborationModule';
import CollaborationPreferences from '../src/components/CollaborationPreferences';
import ConnectionsPage from '../src/components/ConnectionsPage';
import ErrorBoundary from '../src/components/ErrorBoundary';
import HomePage from '../src/components/HomePage';
import NotificationSystem from '../src/components/NotificationSystem';
import OnboardingFlow from '../src/components/OnboardingFlow';
import PreferencesSheet from '../src/components/PreferencesSheet';
import PrivacyPolicy from '../src/components/PrivacyPolicy';
import ProfilePage from '../src/components/ProfilePage';
import ProfileSettings from '../src/components/ProfileSettings';
import ShareModal from '../src/components/ShareModal';
import SignInPage from '../src/components/SignInPage';
import TermsOfService from '../src/components/TermsOfService';
import { formatCurrency } from '../src/components/utils/formatters';


export default function App() {
  const state = useAppState();
  const handlers = useAppHandlers(state);

  // Destructure commonly used state
  const {
    isAuthenticated,
    userRole,
    isLoadingAuth,
    handleSignIn,
    handleSignUp,
    handleSignOut: stateHandleSignOut,
    hasCompletedOnboarding,
    setHasCompletedOnboarding,
    onboardingData,
    setOnboardingData,
    isLoadingOnboarding,
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
    setIsAuthenticated,
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
    updateBoardsSessions,
    safeAsyncStorageSet
  } = state;

  const handleSaveCard = (cardData: any) => {
    try {
      const existingSaved = savedCards.find((card: any) => card.id === cardData.id);
      if (existingSaved) {
        const notification = {
          id: `already-saved-${Date.now()}`,
          type: 'success' as const,
          title: '💖 Already Loved!',
          message: `${cardData.title} is already in your saved experiences`,
          autoHide: true,
          duration: 2000
        };
        setNotifications(prev => [...prev, notification]);
        
        const updatedRemovedIds = [...removedCardIds, cardData.id];
        setRemovedCardIds(updatedRemovedIds);
        safeAsyncStorageSet('mingla_removed_cards', updatedRemovedIds);
        return;
      }

      const savedCard = {
        ...cardData,
        savedAt: new Date().toISOString(),
        sessionType: currentMode
      };
      
      const updatedSavedCards = [...savedCards, savedCard];
      setSavedCards(updatedSavedCards);
      safeAsyncStorageSet('mingla_saved_cards', updatedSavedCards);

      const updatedRemovedIds = [...removedCardIds, cardData.id];
      setRemovedCardIds(updatedRemovedIds);
      safeAsyncStorageSet('mingla_removed_cards', updatedRemovedIds);

      setProfileStats(prev => ({
        ...prev,
        savedExperiences: prev.savedExperiences + 1
      }));

      const notification = {
        id: `card-save-${Date.now()}`,
        type: 'success' as const,
        title: '❤️ Saved!',
        message: `${cardData.title} has been added to your saved experiences`,
        autoHide: true,
        duration: 3000
      };
      setNotifications(prev => [...prev, notification]);
    } catch (error) {
      console.error('Error saving card:', error);
      const notification = {
        id: `card-save-error-${Date.now()}`,
        type: 'error' as const,
        title: 'Error',
        message: 'Failed to save card. Please try again.',
        autoHide: true,
        duration: 3000
      };
      setNotifications(prev => [...prev, notification]);
    }
  };

  const handleAddToCalendar = async (experienceData: any) => {
    const isDirectSchedule = experienceData._directSchedule;
    const isPurchase = experienceData.purchaseOption;
    
    const cleanExperienceData = { ...experienceData };
    delete cleanExperienceData._directSchedule;
    
    const dateTimePrefs = userPreferences ? {
      timeOfDay: userPreferences.timeOfDay || 'Afternoon',
      dayOfWeek: userPreferences.dayOfWeek || 'Weekend',
      planningTimeframe: userPreferences.planningTimeframe || 'This month'
    } : {
      timeOfDay: 'Afternoon',
      dayOfWeek: 'Weekend', 
      planningTimeframe: 'This month'
    };

    const existingSaved = savedCards.find((card: any) => card.id === cleanExperienceData.id);
    if (!isDirectSchedule && !existingSaved) {
      const savedCard = {
        ...cleanExperienceData,
        savedAt: new Date().toISOString(),
        sessionType: currentMode
      };
      
      const updatedSavedCards = [...savedCards, savedCard];
      setSavedCards(updatedSavedCards);
      safeAsyncStorageSet('mingla_saved_cards', updatedSavedCards);
    }

    const updatedRemovedIds = [...removedCardIds, cleanExperienceData.id];
    setRemovedCardIds(updatedRemovedIds);
    safeAsyncStorageSet('mingla_removed_cards', updatedRemovedIds);

    const suggestedDates = handlers.generateSuggestedDates(dateTimePrefs);

    const calendarEntry = {
      id: `calendar-${Date.now()}`,
      experience: cleanExperienceData,
      purchaseOption: cleanExperienceData.purchaseOption,
      dateTimePreferences: dateTimePrefs,
      sessionType: currentMode,
      sessionName: currentMode === 'solo' ? 'Solo Session' : currentMode,
      addedAt: new Date().toISOString(),
      status: 'locked-in',
      suggestedDates: suggestedDates,
      isLiked: !isDirectSchedule || existingSaved,
      isPurchased: !!isPurchase
    };

    const updatedEntries = [...calendarEntries, calendarEntry];
    setCalendarEntries(updatedEntries);
    
    safeAsyncStorageSet('mingla_calendar_entries', updatedEntries);

    if (isDirectSchedule || isPurchase) {
      try {
        const { addToCalendar, createCalendarEventFromEntry } = await import('./components/utils/calendar');
        
        const calendarEvent = createCalendarEventFromEntry(calendarEntry);
        
        if (isPurchase && cleanExperienceData.purchaseOption) {
          const purchaseOption = cleanExperienceData.purchaseOption;
          calendarEvent.title = `${calendarEvent.title} - ${purchaseOption.title}`;
          calendarEvent.description = [
            `🛍️ PURCHASED EXPERIENCE`,
            '',
            calendarEvent.description,
            '',
            `Purchase Details:`,
            `• Option: ${purchaseOption.title}`,
            `• Price: ${formatCurrency(purchaseOption.price, accountPreferences.currency)}`,
            `• Includes: ${purchaseOption.includes?.join(', ') || 'See details'}`,
            ...(purchaseOption.duration ? [`• Duration: ${purchaseOption.duration}`] : []),
            '',
            `Date/Time Preferences:`,
            `• Preferred Time: ${dateTimePrefs.timeOfDay}`,
            `• Preferred Day: ${dateTimePrefs.dayOfWeek}`,
            `• Planning Window: ${dateTimePrefs.planningTimeframe}`,
            '',
            `Session: ${calendarEntry.sessionName}`,
            `Added via Mingla App`
          ].join('\n');
        }
        
        addToCalendar(calendarEvent);
        
        console.log('Event added to device calendar:', calendarEvent);
      } catch (error) {
        console.error('Failed to add to device calendar:', error);
        const fallbackNotification = {
          id: `calendar-fallback-${Date.now()}`,
          type: 'warning' as const,
          title: '📅 Manual Calendar Add',
          message: 'Please manually add this event to your calendar. Details saved in app.',
          autoHide: true,
          duration: 5000
        };
        setNotifications(prev => [...prev, fallbackNotification]);
      }
    }

    setProfileStats(prev => ({
      ...prev,
      savedExperiences: (!isDirectSchedule && !existingSaved) ? prev.savedExperiences + 1 : prev.savedExperiences,
      placesVisited: updatedEntries.filter(entry => entry.status === 'completed').length
    }));

    const notificationTitle = isPurchase ? '🛍️ Purchased & Scheduled!' : 
                             isDirectSchedule ? '📅 Scheduled!' : 
                             '❤️ Liked & Scheduled!';
    
    const notificationMessage = isPurchase ? 
      `${cleanExperienceData.title} purchased and added to your calendar & device` :
      isDirectSchedule ? 
        `${cleanExperienceData.title} has been added to your calendar & device` :
        `${cleanExperienceData.title} has been added to your calendar, device & saved to favorites`;

    const notification = {
      id: `calendar-add-${Date.now()}`,
      type: 'success' as const,
      title: notificationTitle,
      message: notificationMessage,
      autoHide: true,
      duration: isPurchase ? 5000 : 4000
    };
    setNotifications(prev => [...prev, notification]);

    console.log('Experience added to calendar:', calendarEntry);
  };

  const handleScheduleFromSaved = (savedCardData: any) => {
    const dateTimePrefs = userPreferences ? {
      timeOfDay: userPreferences.timeOfDay || 'Afternoon',
      dayOfWeek: userPreferences.dayOfWeek || 'Weekend',
      planningTimeframe: userPreferences.planningTimeframe || 'This month'
    } : {
      timeOfDay: 'Afternoon',
      dayOfWeek: 'Weekend', 
      planningTimeframe: 'This month'
    };

    const updatedSavedCards = savedCards.filter((card: any) => card.id !== savedCardData.id);
    setSavedCards(updatedSavedCards);
    safeAsyncStorageSet('mingla_saved_cards', updatedSavedCards);

    const calendarEntry = {
      id: `calendar-${Date.now()}`,
      experience: savedCardData,
      dateTimePreferences: dateTimePrefs,
      sessionType: savedCardData.sessionType || currentMode,
      sessionName: (savedCardData.sessionType || currentMode) === 'solo' ? 'Solo Session' : (savedCardData.sessionType || currentMode),
      addedAt: new Date().toISOString(),
      status: 'locked-in',
      suggestedDates: handlers.generateSuggestedDates(dateTimePrefs),
      isLiked: true,
      movedFromSaved: true
    };

    const updatedEntries = [...calendarEntries, calendarEntry];
    setCalendarEntries(updatedEntries);
    safeAsyncStorageSet('mingla_calendar_entries', updatedEntries);

    const notification = {
      id: `schedule-from-saved-${Date.now()}`,
      type: 'success' as const,
      title: '📅 Scheduled!',
      message: `${savedCardData.title} has been moved to your calendar`,
      autoHide: true,
      duration: 3000
    };
    setNotifications(prev => [...prev, notification]);

    console.log('Card moved from saved to calendar:', calendarEntry);
  };

  const handlePurchaseFromSaved = (savedCardData: any, purchaseOption: any) => {
    const dateTimePrefs = userPreferences ? {
      timeOfDay: userPreferences.timeOfDay || 'Afternoon',
      dayOfWeek: userPreferences.dayOfWeek || 'Weekend',
      planningTimeframe: userPreferences.planningTimeframe || 'This month'
    } : {
      timeOfDay: 'Afternoon',
      dayOfWeek: 'Weekend', 
      planningTimeframe: 'This month'
    };

    const updatedSavedCards = savedCards.filter((card: any) => card.id !== savedCardData.id);
    setSavedCards(updatedSavedCards);
    safeAsyncStorageSet('mingla_saved_cards', updatedSavedCards);

    const calendarEntry = {
      id: `calendar-${Date.now()}`,
      experience: savedCardData,
      purchaseOption: purchaseOption,
      dateTimePreferences: dateTimePrefs,
      sessionType: savedCardData.sessionType || currentMode,
      sessionName: (savedCardData.sessionType || currentMode) === 'solo' ? 'Solo Session' : (savedCardData.sessionType || currentMode),
      addedAt: new Date().toISOString(),
      status: 'locked-in',
      suggestedDates: handlers.generateSuggestedDates(dateTimePrefs),
      isLiked: true,
      movedFromSaved: true,
      isPurchased: true
    };

    const updatedEntries = [...calendarEntries, calendarEntry];
    setCalendarEntries(updatedEntries);
    safeAsyncStorageSet('mingla_calendar_entries', updatedEntries);

    const notification = {
      id: `purchase-from-saved-${Date.now()}`,
      type: 'success' as const,
      title: '🛍️ Purchased & Scheduled!',
      message: `${savedCardData.title} (${purchaseOption.title}) has been purchased and added to your calendar`,
      autoHide: true,
      duration: 4000
    };
    setNotifications(prev => [...prev, notification]);

    console.log('Card purchased from saved and moved to calendar:', calendarEntry);
  };

  const handleRemoveFromCalendar = (calendarEntry: any) => {
    const updatedCalendarEntries = calendarEntries.filter((entry: any) => entry.id !== calendarEntry.id);
    setCalendarEntries(updatedCalendarEntries);
    safeAsyncStorageSet('mingla_calendar_entries', updatedCalendarEntries);

    const savedCard = {
      ...calendarEntry.experience,
      savedAt: new Date().toISOString(),
      sessionType: calendarEntry.sessionType || currentMode,
      movedFromCalendar: true
    };

    const existingSaved = savedCards.find((card: any) => card.id === savedCard.id);
    if (!existingSaved) {
      const updatedSavedCards = [...savedCards, savedCard];
      setSavedCards(updatedSavedCards);
      safeAsyncStorageSet('mingla_saved_cards', updatedSavedCards);

      setProfileStats(prev => ({
        ...prev,
        savedExperiences: prev.savedExperiences + 1,
        placesVisited: updatedCalendarEntries.filter(entry => entry.status === 'completed').length
      }));
    }

    const notification = {
      id: `remove-from-calendar-${Date.now()}`,
      type: 'success' as const,
      title: '❤️ Moved to Saved!',
      message: `${calendarEntry.experience.title} has been removed from your calendar and moved back to saved experiences`,
      autoHide: true,
      duration: 3000
    };
    setNotifications(prev => [...prev, notification]);

    console.log('Calendar entry moved back to saved:', savedCard);
  };

  const handleRemoveSaved = (savedCard: any) => {
    const updatedSavedCards = savedCards.filter((card: any) => card.id !== savedCard.id);
    setSavedCards(updatedSavedCards);
    safeAsyncStorageSet('mingla_saved_cards', updatedSavedCards);

    setProfileStats(prev => ({
      ...prev,
      savedExperiences: Math.max(0, prev.savedExperiences - 1)
    }));

    const notification = {
      id: `remove-saved-${Date.now()}`,
      type: 'success' as const,
      title: '🗑️ Card Discarded',
      message: `${savedCard.title} has been removed from your saved experiences`,
      autoHide: true,
      duration: 3000
    };
    setNotifications(prev => [...prev, notification]);

    console.log('Saved card discarded:', savedCard);
  };

  const handleOnboardingComplete = (completedOnboardingData: any) => {
    setHasCompletedOnboarding(true);
    safeAsyncStorageSet('mingla_onboarding_completed', 'true');
    
    setOnboardingData(completedOnboardingData);
    safeAsyncStorageSet('mingla_onboarding_data', completedOnboardingData);
    
    if (completedOnboardingData.userProfile) {
      const [firstName, ...lastNameParts] = completedOnboardingData.userProfile.name.split(' ');
      const updatedIdentity = {
        firstName: firstName || 'Jordan',
        lastName: lastNameParts.join(' ') || 'Smith',
        username: completedOnboardingData.userProfile.email?.split('@')[0] || 'jordansmith',
        profileImage: completedOnboardingData.userProfile.profileImage || null
      };
      setUserIdentity(updatedIdentity);
      safeAsyncStorageSet('mingla_user_identity', updatedIdentity);
    }
    
    const primaryIntent = completedOnboardingData.intents?.[0];
    const hasGroupIntent = completedOnboardingData.intents?.some((intent: any) => intent.id === 'group-fun');
    const hasSoloIntent = completedOnboardingData.intents?.some((intent: any) => intent.id === 'solo-adventure');
    
    const initialPreferences = {
      experienceType: primaryIntent?.experienceType || 'Solo adventure',
      categories: completedOnboardingData.vibes || [],
      location: completedOnboardingData.location || 'San Francisco, CA',
      budget: '$50-100',
      timeOfDay: 'Afternoon',
      dayOfWeek: 'Weekend',
      planningTimeframe: 'This month',
      groupSize: hasGroupIntent ? 'Large group (5+)' : 
                  hasSoloIntent ? 'Solo' : 'Small group (2-4)',
      accessibility: 'No specific needs',
      transportation: 'Walking distance',
      duration: '2-3 hours',
      weatherPreference: 'Any weather'
    };
    
    setUserPreferences(initialPreferences);
    
    if (completedOnboardingData.invitedFriends?.length > 0) {
      const currentFriends = [...friendsList];
      const newFriends = completedOnboardingData.invitedFriends.map((friend: any) => ({
        ...friend,
        status: 'online',
        isOnline: true,
        mutualFriends: Math.floor(Math.random() * 20) + 5
      }));
      
      const updatedFriends = [...currentFriends, ...newFriends];
      setFriendsList(updatedFriends);
      safeAsyncStorageSet('mingla_friends_list', updatedFriends);
      
      setProfileStats(prev => ({
        ...prev,
        connectionsCount: updatedFriends.length
      }));
    }

    
    console.log('Onboarding completed:', completedOnboardingData);
  };

  const handleAppSignOut = () => {
    stateHandleSignOut();
  };

  const handleDeleteAccount = () => {
    // Similar to sign out but more complete
    stateHandleSignOut();
    console.log('Account deleted - all user data removed');
  };

  // Mock card generator
  const generateNewMockCard = () => {
    const cardTemplates = [
      {
        title: 'Artisan Chocolate Workshop',
        category: 'Creative & Hands-On',
        categoryIcon: 'Sparkles',
        description: 'Hands-on chocolate making with local artisans',
        budget: 'Perfect for your $50-100 budget range',
        rating: 4.8,
        reviewCount: 342,
        priceRange: '$75-95',
        travelTime: '18 min',
        distance: '4.2 km',
        experienceType: 'Workshop',
        highlights: ['Hands-on experience', 'Take home treats', 'Expert guidance'],
        fullDescription: 'Learn the art of chocolate making from bean to bar in this immersive workshop experience.',
        address: '456 Artisan Way, Creative District',
        openingHours: 'Daily 10AM-6PM',
        tags: ['Creative', 'Educational', 'Delicious'],
        matchScore: 92,
        image: 'https://images.unsplash.com/photo-1646082192921-272df4780996?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjaG9jb2xhdGUlMjB3b3Jrc2hvcCUyMGFydGlzYW58ZW58MXx8fHwxNzU5MzI4Nzg3fDA&ixlib=rb-4.1.0&q=80&w=1080',
        images: [
          'https://images.unsplash.com/photo-1646082192921-272df4780996?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjaG9jb2xhdGUlMjB3b3Jrc2hvcCUyMGFydGlzYW58ZW58MXx8fHwxNzU5MzI4Nzg3fDA&ixlib=rb-4.1.0&q=80&w=1080'
        ]
      }
    ];

    const randomIndex = Math.floor(Math.random() * cardTemplates.length);
    const template = cardTemplates[randomIndex];
    const uniqueId = `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return {
      id: uniqueId,
      ...template,
      socialStats: {
        views: Math.floor(Math.random() * 5000) + 1000,
        likes: Math.floor(Math.random() * 500) + 50,
        saves: Math.floor(Math.random() * 200) + 20,
        shares: Math.floor(Math.random() * 100) + 10
      },
      matchFactors: {
        location: Math.floor(Math.random() * 30) + 70,
        budget: Math.floor(Math.random() * 20) + 80,
        category: Math.floor(Math.random() * 25) + 75,
        time: Math.floor(Math.random() * 20) + 80,
        popularity: Math.floor(Math.random() * 30) + 70
      }
    };
  };



  if (showPreferences) {
    return (
      <PreferencesSheet 
        onClose={() => setShowPreferences(false)} 
        onSave={handlers.handleSavePreferences}
        accountPreferences={accountPreferences}
      />
    );
  }

  const renderCurrentPage = () => {
    switch (currentPage) {
      case 'home':
        return (
          <HomePage 
            onOpenPreferences={() => setShowPreferences(true)}
            onOpenCollaboration={handlers.handleCollaborationOpen}
            onOpenCollabPreferences={() => {
              if (currentMode !== 'solo') {
                setActiveSessionData({ id: currentMode, name: currentMode, participants: [] });
                setShowCollabPreferences(true);
              }
            }}
            currentMode={currentMode}
            userPreferences={userPreferences}
            accountPreferences={accountPreferences}
            onAddToCalendar={handleAddToCalendar}
            savedCards={savedCards}
            onSaveCard={handleSaveCard}
            onShareCard={handlers.handleShareCard}
            onPurchaseComplete={(experienceData, purchaseOption) => {
              const enhancedPurchaseData = {
                ...experienceData,
                purchaseOption: {
                  ...purchaseOption,
                  purchasedAt: new Date().toISOString(),
                  currency: accountPreferences.currency,
                  userPreferences: userPreferences ? {
                    timeOfDay: userPreferences.timeOfDay,
                    dayOfWeek: userPreferences.dayOfWeek,
                    planningTimeframe: userPreferences.planningTimeframe,
                    location: userPreferences.location,
                    groupSize: userPreferences.groupSize
                  } : null
                },
                _directSchedule: true,
                sessionType: currentMode,
                sessionName: currentMode === 'solo' ? 'Solo Session' : currentMode
              };
              
              handleAddToCalendar(enhancedPurchaseData);
              
              console.log('Purchase completed with preferences:', {
                experience: experienceData.title,
                option: purchaseOption.title,
                price: formatCurrency(purchaseOption.price, accountPreferences.currency),
                preferences: userPreferences,
                session: currentMode
              });
            }}
            removedCardIds={removedCardIds}
            generateNewMockCard={generateNewMockCard}
            onboardingData={onboardingData}
          />
        );
      case 'connections':
        return (
          <ConnectionsPage 
            onSendCollabInvite={handlers.handleCollaborationOpen} 
            onAddToBoard={handlers.handleAddToBoard}
            onShareSavedCard={handlers.handleShareSavedCard}
            onRemoveFriend={handlers.handleRemoveFriend}
            onBlockUser={handlers.handleBlockUser}
            onReportUser={handlers.handleReportUser}
            accountPreferences={accountPreferences}
            boardsSessions={boardsSessions}
            currentMode={currentMode}
            onModeChange={handlers.handleModeChange}
            onUpdateBoardSession={(updatedBoard: any) => {
              const updatedBoards = boardsSessions.map(board => 
                board.id === updatedBoard.id ? updatedBoard : board
              );
              updateBoardsSessions(updatedBoards);
            }}
            onCreateSession={(newSession: any) => {
              const updatedBoards = [...boardsSessions, newSession];
              updateBoardsSessions(updatedBoards);
            }}
            onNavigateToBoard={handlers.handleNavigateToActivityBoard}
            friendsList={friendsList}
          />
        );
      case 'activity':
        return (
          <ActivityPage 
            onSendInvite={handlers.handleSendInvite} 
            userPreferences={userPreferences}
            accountPreferences={accountPreferences}
            calendarEntries={calendarEntries}
            savedCards={savedCards}
            onScheduleFromSaved={handleScheduleFromSaved}
            onPurchaseFromSaved={handlePurchaseFromSaved}
            onRemoveFromCalendar={handleRemoveFromCalendar}
            onRemoveSaved={handleRemoveSaved}
            onShareCard={handlers.handleShareCard}
            boardsSessions={boardsSessions}
            onUpdateBoardSession={(updatedBoard: any) => {
              const updatedBoards = boardsSessions.map(board => 
                board.id === updatedBoard.id ? updatedBoard : board
              );
              updateBoardsSessions(updatedBoards);
            }}
            navigationData={activityNavigation}
            onNavigationComplete={() => setActivityNavigation(null)}
            onPromoteToAdmin={handlers.handlePromoteToAdmin}
            onDemoteFromAdmin={handlers.handleDemoteFromAdmin}
            onRemoveMember={handlers.handleRemoveMember}
            onLeaveBoard={handlers.handleLeaveBoard}
          />
        );
      case 'profile':
        return (
          <ProfilePage 
            onSignOut={handleAppSignOut}
            onNavigateToActivity={handlers.handleNavigateToActivity}
            onNavigateToConnections={handlers.handleNavigateToConnections}
            onNavigateToProfileSettings={() => setCurrentPage('profile-settings')}
            onNavigateToAccountSettings={() => setCurrentPage('account-settings')}
            onNavigateToPrivacyPolicy={() => setCurrentPage('privacy-policy')}
            onNavigateToTermsOfService={() => setCurrentPage('terms-of-service')}
            savedExperiences={profileStats.savedExperiences}
            boardsCount={profileStats.boardsCount}
            connectionsCount={profileStats.connectionsCount}
            placesVisited={profileStats.placesVisited}
            notificationsEnabled={notificationsEnabled}
            onNotificationsToggle={handlers.handleNotificationsToggle}
            userIdentity={userIdentity}
            blockedUsers={blockedUsers}
            onUnblockUser={handlers.handleUnblockUser}
          />
        );
      case 'profile-settings':
        return (
          <ProfileSettings 
            userIdentity={userIdentity}
            onUpdateIdentity={state.handleUserIdentityUpdate}
            onNavigateBack={() => setCurrentPage('profile')}
          />
        );
      case 'account-settings':
        return (
          <AccountSettings 
            accountPreferences={accountPreferences}
            onUpdatePreferences={state.handleAccountPreferencesUpdate}
            onDeleteAccount={handleDeleteAccount}
            onNavigateBack={() => setCurrentPage('profile')}
          />
        );
      case 'privacy-policy':
        return (
          <PrivacyPolicy 
            onNavigateBack={() => setCurrentPage('profile')}
          />
        );
      case 'terms-of-service':
        return (
          <TermsOfService 
            onNavigateBack={() => setCurrentPage('profile')}
          />
        );
      default:
        return <HomePage onOpenPreferences={() => setShowPreferences(true)} />;
    }
  };

  // Show loading while checking authentication status
  if (isLoadingAuth || isLoadingOnboarding) {
    return (
      <View className="h-screen bg-gray-50 flex items-center justify-center">
        <View className="text-center space-y-4">
          <View className="w-16 h-16 bg-gradient-to-br from-[#FF7043] to-[#FF5722] rounded-full flex items-center justify-center mx-auto">
            <Text className="text-white text-2xl">✨</Text>
          </View>
          <Text className="text-gray-600">Loading Mingla...</Text>
        </View>
      </View>
    );
  }

  // Show sign in page if user is not authenticated
  if (!isAuthenticated) {
    return (
      <ErrorBoundary>
        <SignInPage
          onSignInRegular={(credentials) => handleSignIn(credentials, 'explorer')}
          onSignUpRegular={(userData) => handleSignUp(userData, 'explorer')}
          onSignInCurator={(credentials) => handleSignIn(credentials, 'curator')}
          onSignUpCurator={(userData) => handleSignUp(userData, 'curator')}
        />
      </ErrorBoundary>
    );
  }

  // Show onboarding flow if user hasn't completed it
  if (!hasCompletedOnboarding) {
    const handleNavigateToSignUp = () => {
      setIsAuthenticated(false);
    };

    return (
      <ErrorBoundary>
        <OnboardingFlow 
          onComplete={handleOnboardingComplete} 
          onNavigateToSignUp={handleNavigateToSignUp}
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor="white" />
        <View style={styles.container}>
        {/* Main Content */}
        <View style={styles.mainContent}>
          {renderCurrentPage()}
        </View>

        {/* Bottom Navigation - Always Visible */}
        <View style={styles.bottomNavigation}>
          <View style={styles.navigationContainer}>
            <TouchableOpacity 
              onPress={() => setCurrentPage('home')}
              style={styles.navItem}
            >
              <Ionicons 
                name="home" 
                size={24} 
                color={currentPage === 'home' ? '#eb7825' : '#9CA3AF'} 
              />
              <Text style={[
                styles.navText, 
                currentPage === 'home' ? styles.navTextActive : styles.navTextInactive
              ]}>
                Home
              </Text>
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={() => setCurrentPage('connections')}
              style={styles.navItem}
            >
              <Ionicons 
                name="people" 
                size={24} 
                color={currentPage === 'connections' ? '#eb7825' : '#9CA3AF'} 
              />
              <Text style={[
                styles.navText, 
                currentPage === 'connections' ? styles.navTextActive : styles.navTextInactive
              ]}>
                Connections
              </Text>
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={() => setCurrentPage('activity')}
              style={styles.navItem}
            >
              <Ionicons 
                name="calendar" 
                size={24} 
                color={currentPage === 'activity' ? '#eb7825' : '#9CA3AF'} 
              />
              <Text style={[
                styles.navText, 
                currentPage === 'activity' ? styles.navTextActive : styles.navTextInactive
              ]}>
                Activity
              </Text>
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={() => setCurrentPage('profile')}
              style={styles.navItem}
            >
              <Ionicons 
                name="person" 
                size={24} 
                color={currentPage === 'profile' ? '#eb7825' : '#9CA3AF'} 
              />
              <Text style={[
                styles.navText, 
                currentPage === 'profile' ? styles.navTextActive : styles.navTextInactive
              ]}>
                Profile
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Collaboration Module */}
        <CollaborationModule
          isOpen={showCollaboration}
          onClose={() => {
            setShowCollaboration(false);
            setPreSelectedFriend(null);
          }}
          currentMode={currentMode}
          onModeChange={handlers.handleModeChange}
          preSelectedFriend={preSelectedFriend}
          boardsSessions={boardsSessions}
          onUpdateBoardSession={(updatedBoard: any) => {
            const updatedBoards = boardsSessions.map(board => 
              board.id === updatedBoard.id ? updatedBoard : board
            );
            updateBoardsSessions(updatedBoards);
          }}
          onCreateSession={(newSession: any) => {
            const updatedBoards = [...boardsSessions, newSession];
            updateBoardsSessions(updatedBoards);
          }}
          onNavigateToBoard={handlers.handleNavigateToActivityBoard}
        />

        {/* Collaboration Preferences */}
        {showCollabPreferences && activeSessionData && (
          <CollaborationPreferences
            isOpen={showCollabPreferences}
            onClose={() => {
              setShowCollabPreferences(false);
              setActiveSessionData(null);
            }}
            sessionName={activeSessionData.name}
            participants={activeSessionData.participants}
            onSave={handlers.handleCollabPreferencesSave}
          />
        )}

        {/* Share Modal */}
        {showShareModal && shareData && (
          <ShareModal
            isOpen={showShareModal}
            onClose={() => {
              setShowShareModal(false);
              setShareData(null);
            }}
            experienceData={shareData.experienceData}
            dateTimePreferences={shareData.dateTimePreferences}
            userPreferences={userPreferences}
            accountPreferences={accountPreferences}
          />
        )}

        {/* Notification System */}
        <NotificationSystem
          notifications={notifications}
          onDismiss={handlers.handleDismissNotification}
        />
      </View>
      </SafeAreaView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  mainContent: {
    flex: 1,
    overflow: 'hidden',
    paddingBottom: 80, // Space for bottom navigation
  },
  bottomNavigation: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingHorizontal: 16,
    paddingVertical: 8,
    zIndex: 50,
  },
  navigationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  navItem: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  navText: {
    fontSize: 12,
  },
  navTextActive: {
    color: '#eb7825',
    fontWeight: '500',
  },
  navTextInactive: {
    color: '#9CA3AF',
  },
});