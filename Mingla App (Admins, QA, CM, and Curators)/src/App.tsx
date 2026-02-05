/**
 * Mingla - Multi-User Platform Application
 * 
 * User Roles:
 * - Explorer: General users who discover and plan experiences
 * - Business: Business owners who view/manage their experiences and track revenue
 */

import React from 'react';
import { Home, Users, Heart, User, MessageCircle, Compass } from 'lucide-react';
import { formatCurrency } from './components/utils/formatters';
import { useAppState } from './components/AppStateManager';
import { useAppHandlers } from './components/AppHandlers';
import HomePage from './components/HomePage';
import DiscoverPage from './components/DiscoverPage';
import ConnectionsPage from './components/ConnectionsPage';
import MessagesPage from './components/MessagesPage';
import ActivityPage from './components/ActivityPage';
import ProfilePage from './components/ProfilePage';
import ProfileSettings from './components/ProfileSettings';
import AccountSettings from './components/AccountSettings';
import PreferencesSheet from './components/PreferencesSheet';
import CollaborationModule from './components/CollaborationModule';
import CollaborationPreferences from './components/CollaborationPreferences';
import NotificationSystem from './components/NotificationSystem';
import ShareModal from './components/ShareModal';
import PrivacyPolicy from './components/PrivacyPolicy';
import TermsOfService from './components/TermsOfService';
import OnboardingFlow from './components/OnboardingFlow';
import BusinessOnboardingFlow from './components/BusinessOnboardingFlow';
import SignInPage from './components/SignInPage';
import ErrorBoundary from './components/ErrorBoundary';
import BusinessDashboard from './components/BusinessDashboard';
import ProposeDateModal from './components/ProposeDateModal';
import ReviewModal from './components/ReviewModal';
import { getCardsToArchive } from './components/utils/dateUtils';
import CoachMarkProvider from './components/CoachMark/CoachMarkProvider';
import CoachMarkOverlay from './components/CoachMark/CoachMarkOverlay';
import CoachMarkTrigger from './components/CoachMark/CoachMarkTrigger';
import { toast } from 'sonner@2.0.3';
import { Toaster } from './components/ui/sonner';


export default function App() {
  // Propose date modal state
  const [showProposeDateModal, setShowProposeDateModal] = React.useState(false);
  const [proposeDateCardData, setProposeDateCardData] = React.useState<any>(null);
  
  // Review modal state with queue
  const [showReviewModal, setShowReviewModal] = React.useState(false);
  const [reviewCardData, setReviewCardData] = React.useState<any>(null);
  const [reviewQueue, setReviewQueue] = React.useState<any[]>([]);
  
  // Connections tab state for coach mark tour
  const [connectionsTab, setConnectionsTab] = React.useState<'friends' | 'messages'>('friends');
  
  // Make duplicate cleaner available globally
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).clearDuplicateExperiences = () => {
        const cards = JSON.parse(localStorage.getItem('platformCards') || '[]');
        const uniqueCards = [];
        const seenIds = new Set();
        
        for (const card of cards) {
          if (!seenIds.has(card.id)) {
            seenIds.add(card.id);
            uniqueCards.push(card);
          } else {
            console.log('Removing duplicate card:', card.id, card.title);
          }
        }
        
        console.log(`Removed ${cards.length - uniqueCards.length} duplicate experiences`);
        console.log(`${uniqueCards.length} unique experiences remain`);
        
        localStorage.setItem('platformCards', JSON.stringify(uniqueCards));
        window.dispatchEvent(new Event('storage'));
        
        return {
          originalCount: cards.length,
          uniqueCount: uniqueCards.length,
          duplicatesRemoved: cards.length - uniqueCards.length
        };
      };
    }
  }, []);
  
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
    updateBoardsSessions,
    updateCuratorCards,
    safeLocalStorageSet
  } = state;

  const handleSaveCard = (cardData: any) => {
    try {
      // Check if in collaboration mode (currentMode is not 'solo')
      const isCollaborationMode = currentMode !== 'solo';
      
      if (isCollaborationMode) {
        // Find the current board
        const currentBoard = boardsSessions.find((board: any) => board.id === currentMode || board.name === currentMode);
        
        if (currentBoard) {
          // Check if card already exists in this board
          const existingBoardCard = currentBoard.cards?.find((card: any) => card.id === cardData.id);
          
          if (existingBoardCard) {
            const notification = {
              id: `already-in-board-${Date.now()}`,
              type: 'success' as const,
              title: '💖 Already Added!',
              message: `${cardData.title} is already in ${currentBoard.name}`,
              autoHide: true,
              duration: 2000
            };
            setNotifications(prev => [...prev, notification]);
            
            const updatedRemovedIds = [...removedCardIds, cardData.id];
            setRemovedCardIds(updatedRemovedIds);
            safeLocalStorageSet('mingla_removed_cards', updatedRemovedIds);
            return;
          }
          
          // Add card to board with metadata
          const boardCard = {
            ...cardData,
            addedBy: userIdentity?.id || 'you',
            addedAt: new Date().toISOString(),
            votes: {
              yes: 1, // User who adds it automatically votes yes
              no: 0,
              userVote: 'yes'
            },
            rsvps: {
              responded: 0,
              total: currentBoard.participants?.length || 0,
              userRSVP: null
            },
            messages: 0,
            isLocked: false,
            source: 'collaboration'
          };
          
          // Update board with new card
          const updatedBoard = {
            ...currentBoard,
            cards: [...(currentBoard.cards || []), boardCard],
            cardsCount: (currentBoard.cards?.length || 0) + 1,
            lastActivity: new Date().toISOString()
          };
          
          // Update all boards
          const updatedBoards = boardsSessions.map((board: any) =>
            (board.id === currentMode || board.name === currentMode) ? updatedBoard : board
          );
          
          updateBoardsSessions(updatedBoards);
          
          const updatedRemovedIds = [...removedCardIds, cardData.id];
          setRemovedCardIds(updatedRemovedIds);
          safeLocalStorageSet('mingla_removed_cards', updatedRemovedIds);
          
          const notification = {
            id: `card-added-to-board-${Date.now()}`,
            type: 'success' as const,
            title: '🎉 Added to Board!',
            message: `${cardData.title} has been added to ${currentBoard.name}`,
            autoHide: true,
            duration: 3000
          };
          setNotifications(prev => [...prev, notification]);
          
          console.log('Card added to board:', currentBoard.name, boardCard);
          return;
        }
      }
      
      // Solo mode - save to savedCards
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
        safeLocalStorageSet('mingla_removed_cards', updatedRemovedIds);
        return;
      }

      const savedCard = {
        ...cardData,
        savedAt: new Date().toISOString(),
        sessionType: currentMode,
        source: 'solo'
      };
      
      const updatedSavedCards = [...savedCards, savedCard];
      setSavedCards(updatedSavedCards);
      safeLocalStorageSet('mingla_saved_cards', updatedSavedCards);

      const updatedRemovedIds = [...removedCardIds, cardData.id];
      setRemovedCardIds(updatedRemovedIds);
      safeLocalStorageSet('mingla_removed_cards', updatedRemovedIds);

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
    
    // Check if we have actual date/time from preferences, otherwise use general preferences
    const dateTimePrefs = userPreferences?.actualDateTime ? {
      scheduledDate: userPreferences.actualDateTime.scheduledDate,
      scheduledTime: userPreferences.actualDateTime.scheduledTime,
      displayText: userPreferences.actualDateTime.displayText
    } : userPreferences ? {
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
      safeLocalStorageSet('mingla_saved_cards', updatedSavedCards);
    }

    const updatedRemovedIds = [...removedCardIds, cleanExperienceData.id];
    setRemovedCardIds(updatedRemovedIds);
    safeLocalStorageSet('mingla_removed_cards', updatedRemovedIds);

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
    
    safeLocalStorageSet('mingla_calendar_entries', updatedEntries);

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
    safeLocalStorageSet('mingla_saved_cards', updatedSavedCards);

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
    safeLocalStorageSet('mingla_calendar_entries', updatedEntries);

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

  const handlePurchaseComplete = (experienceData: any, purchaseOption: any) => {
    // Import purchase handler
    import('./components/utils/purchaseHandler').then(({ createPurchase, savePurchase }) => {
      const currentUser = userIdentity || JSON.parse(localStorage.getItem('currentUser') || '{}');
      
      // Create purchase record with business tracking
      const purchase = createPurchase(experienceData, purchaseOption, currentUser);
      
      // Save purchase to localStorage
      savePurchase(purchase);
      
      console.log('Purchase created with business tracking:', purchase);
    });

    // Add to calendar with purchase flag
    const experienceWithPurchase = {
      ...experienceData,
      purchaseOption: {
        ...purchaseOption,
        qrCode: `MGP-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`.toUpperCase(),
        purchasedAt: new Date().toISOString()
      },
      _directSchedule: true
    };

    handleAddToCalendar(experienceWithPurchase);
  };

  const handlePurchaseFromSaved = (savedCardData: any, purchaseOption: any) => {
    // Import purchase handler
    import('./components/utils/purchaseHandler').then(({ createPurchase, savePurchase }) => {
      const currentUser = userIdentity || JSON.parse(localStorage.getItem('currentUser') || '{}');
      
      // Create purchase record with business tracking
      const purchase = createPurchase(savedCardData, purchaseOption, currentUser);
      
      // Save purchase to localStorage
      savePurchase(purchase);
      
      console.log('Purchase created from saved card with business tracking:', purchase);
    });

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
    safeLocalStorageSet('mingla_saved_cards', updatedSavedCards);

    const qrCode = `MGP-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`.toUpperCase();

    const calendarEntry = {
      id: `calendar-${Date.now()}`,
      experience: savedCardData,
      purchaseOption: {
        ...purchaseOption,
        qrCode,
        purchasedAt: new Date().toISOString()
      },
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
    safeLocalStorageSet('mingla_calendar_entries', updatedEntries);

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
    safeLocalStorageSet('mingla_calendar_entries', updatedCalendarEntries);

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
      safeLocalStorageSet('mingla_saved_cards', updatedSavedCards);

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
    safeLocalStorageSet('mingla_saved_cards', updatedSavedCards);

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

  const handleProposeNewDate = (calendarEntry: any) => {
    setProposeDateCardData(calendarEntry);
    setShowProposeDateModal(true);
  };

  const handleProposeDateAccepted = (newDateTimePreferences: any) => {
    if (!proposeDateCardData) return;

    // Create a duplicate calendar entry with new date/time preferences
    const duplicateEntry = {
      ...proposeDateCardData,
      id: `calendar-${Date.now()}`, // New unique ID
      dateTimePreferences: newDateTimePreferences,
      addedAt: new Date().toISOString(),
      status: 'locked-in',
      suggestedDates: handlers.generateSuggestedDates(newDateTimePreferences),
      isDuplicate: true,
      originalEntryId: proposeDateCardData.id
    };

    const updatedEntries = [...calendarEntries, duplicateEntry];
    setCalendarEntries(updatedEntries);
    safeLocalStorageSet('mingla_calendar_entries', updatedEntries);

    // Add to device calendar
    (async () => {
      try {
        const { addToCalendar, createCalendarEventFromEntry } = await import('./components/utils/calendar');
        const calendarEvent = createCalendarEventFromEntry(duplicateEntry);
        
        // Add note about new date
        if (newDateTimePreferences.displayText) {
          calendarEvent.description = [
            calendarEvent.description,
            '',
            `📅 Rescheduled To:`,
            `• ${newDateTimePreferences.displayText}`
          ].join('\n');
        }
        
        addToCalendar(calendarEvent);
        console.log('Rescheduled event added to device calendar:', calendarEvent);
      } catch (error) {
        console.error('Failed to add rescheduled event to device calendar:', error);
      }
    })();

    const notification = {
      id: `propose-date-${Date.now()}`,
      type: 'success' as const,
      title: '🎉 New Date Created!',
      message: newDateTimePreferences.displayText 
        ? `${proposeDateCardData.experience.title} has been scheduled for ${newDateTimePreferences.displayText}`
        : `${proposeDateCardData.experience.title} has been rescheduled`,
      autoHide: true,
      duration: 4000
    };
    setNotifications(prev => [...prev, notification]);

    setShowProposeDateModal(false);
    setProposeDateCardData(null);

    console.log('New date proposed and accepted:', duplicateEntry);
  };

  const handleSubmitReview = (cardId: string, rating: number, comment: string) => {
    // Update the card with review data (only visible to admins and QA managers)
    const review = {
      rating,
      comment,
      reviewedAt: new Date().toISOString(),
      userId: userIdentity.username
    };

    // Update calendar entries
    const updatedCalendarEntries = calendarEntries.map((entry: any) => {
      if (entry.id === cardId) {
        return {
          ...entry,
          userReview: review
        };
      }
      return entry;
    });
    setCalendarEntries(updatedCalendarEntries);
    safeLocalStorageSet('mingla_calendar_entries', updatedCalendarEntries);

    // Update saved cards
    const updatedSavedCards = savedCards.map((card: any) => {
      if (card.id === cardId) {
        return {
          ...card,
          userReview: review
        };
      }
      return card;
    });
    setSavedCards(updatedSavedCards);
    safeLocalStorageSet('mingla_saved_cards', updatedSavedCards);

    if (rating > 0) {
      const notification = {
        id: `review-submitted-${Date.now()}`,
        type: 'success' as const,
        title: '⭐ Thank You!',
        message: `Your ${rating}-star review helps improve recommendations`,
        autoHide: true,
        duration: 3000
      };
      setNotifications(prev => [...prev, notification]);
    }

    console.log('Review submitted:', { cardId, rating, comment });

    // Check if there are more cards in the review queue
    if (reviewQueue.length > 0) {
      const [nextCard, ...remainingQueue] = reviewQueue;
      setReviewQueue(remainingQueue);
      setReviewCardData(nextCard);
      setShowReviewModal(true);
    }
  };

  const handleOpenReview = (cardData: any) => {
    // Open review modal for manual review
    setReviewCardData(cardData);
    setShowReviewModal(true);
  };

  // Auto-archive elapsed dates and prompt for review
  React.useEffect(() => {
    const checkAndArchiveCards = () => {
      const cardsNeedingReview: any[] = [];
      
      // Check calendar entries
      const calendarToArchive = getCardsToArchive(calendarEntries);
      
      if (calendarToArchive.length > 0) {
        const updatedEntries = calendarEntries.map((entry: any) => {
          const shouldArchive = calendarToArchive.find(e => e.id === entry.id);
          if (shouldArchive && !entry.isArchived) {
            // Add to review queue if not already reviewed
            if (!entry.userReview) {
              cardsNeedingReview.push(entry);
            }
            
            return {
              ...entry,
              isArchived: true,
              archivedAt: new Date().toISOString()
            };
          }
          return entry;
        });
        
        setCalendarEntries(updatedEntries);
        safeLocalStorageSet('mingla_calendar_entries', updatedEntries);
      }

      // Check saved cards with dates
      const savedToArchive = getCardsToArchive(
        savedCards.filter((card: any) => card.dateTimePreferences?.scheduledDate)
      );
      
      if (savedToArchive.length > 0) {
        const updatedSaved = savedCards.map((card: any) => {
          const shouldArchive = savedToArchive.find(c => c.id === card.id);
          if (shouldArchive && !card.isArchived) {
            // Add to review queue if not already reviewed
            if (!card.userReview) {
              cardsNeedingReview.push(card);
            }
            
            return {
              ...card,
              isArchived: true,
              archivedAt: new Date().toISOString()
            };
          }
          return card;
        });
        
        setSavedCards(updatedSaved);
        safeLocalStorageSet('mingla_saved_cards', updatedSaved);
      }

      // If there are cards needing review and no modal is currently showing
      if (cardsNeedingReview.length > 0 && !showReviewModal) {
        const [firstCard, ...remainingCards] = cardsNeedingReview;
        setReviewCardData(firstCard);
        setShowReviewModal(true);
        if (remainingCards.length > 0) {
          setReviewQueue(remainingCards);
        }
      }
    };

    // Check every minute
    const interval = setInterval(checkAndArchiveCards, 60000);
    
    // Also check on mount
    checkAndArchiveCards();
    
    return () => clearInterval(interval);
  }, [calendarEntries, savedCards]);

  const handleOnboardingComplete = (completedOnboardingData: any) => {
    setHasCompletedOnboarding(true);
    safeLocalStorageSet('mingla_onboarding_completed', 'true');
    
    setOnboardingData(completedOnboardingData);
    safeLocalStorageSet('mingla_onboarding_data', completedOnboardingData);
    
    if (completedOnboardingData.userProfile) {
      const updatedIdentity = {
        firstName: completedOnboardingData.userProfile.firstName || 'Jordan',
        lastName: completedOnboardingData.userProfile.lastName || 'Smith',
        username: completedOnboardingData.userProfile.email?.split('@')[0] || 'jordansmith',
        profileImage: completedOnboardingData.userProfile.profilePhoto || null
      };
      setUserIdentity(updatedIdentity);
      safeLocalStorageSet('mingla_user_identity', updatedIdentity);
    }
    
    const hasGroupIntent = completedOnboardingData.intents?.some((intent: any) => intent.id === 'group-fun');
    const hasSoloIntent = completedOnboardingData.intents?.some((intent: any) => intent.id === 'solo-adventure');
    
    // Create simple initial preferences - NO FILTERING, just storing for reference
    const initialPreferences = {
      // Categories - stored but NOT used for filtering (empty array = show all cards like test account)
      categories: [],
      
      // Experience Types - from intents (for reference only, not strict filtering)
      experienceTypes: completedOnboardingData.intents?.map((intent: any) => intent.title) || ['Solo adventure'],
      
      // Location (stored but not used for strict filtering)
      location: completedOnboardingData.location || 'San Francisco, CA',
      locationCoords: completedOnboardingData.locationDetails?.coordinates || null,
      
      // Budget - stored but not used for strict filtering
      budgetMin: '',
      budgetMax: '',
      budgetPreset: '',
      
      // Date preferences - stored for display only
      dateOption: completedOnboardingData.datePreference || 'weekend',
      selectedDate: completedOnboardingData.customDate || '',
      
      // Time preferences - stored for display only
      timeOfDay: completedOnboardingData.timeSlot || 'Afternoon',
      exactTime: completedOnboardingData.exactTime || '',
      selectedTimeSlot: completedOnboardingData.timeSlot || '',
      
      // Travel mode - stored but not used for strict filtering
      travelMode: completedOnboardingData.travelMode || 'walking',
      
      // Travel constraints - stored but not used for strict filtering
      constraintType: 'time',
      timeConstraint: '',
      distanceConstraint: '',
      
      // Group size (derived from intent)
      groupSize: hasGroupIntent ? 'Large group (5+)' : 
                  hasSoloIntent ? 'Solo' : 'Small group (2-4)',
      
      // Defaults
      accessibility: 'No specific needs',
      transportation: 'Walking distance',
      duration: '2-3 hours',
      weatherPreference: 'Any weather',
      
      // Planning timeframe for display
      planningTimeframe: completedOnboardingData.datePreference === 'now' ? 'Today' : 
                         completedOnboardingData.datePreference === 'today' ? 'Today' :
                         completedOnboardingData.datePreference === 'weekend' ? 'This weekend' : 
                         'This week',
      dayOfWeek: completedOnboardingData.datePreference === 'weekend' ? 'Weekend' : 'Weekday',
      
      // Actual date/time (null until user schedules specific time)
      actualDateTime: null
    };
    
    setUserPreferences(initialPreferences);
    safeLocalStorageSet('mingla_user_preferences', initialPreferences);
    
    // Reset removed cards to allow fresh card generation with new preferences
    setRemovedCardIds([]);
    safeLocalStorageSet('mingla_removed_cards', []);
    
    // Navigate to home page after onboarding
    setCurrentPage('home');
    
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
      safeLocalStorageSet('mingla_friends_list', updatedFriends);
      
      setProfileStats(prev => ({
        ...prev,
        connectionsCount: updatedFriends.length
      }));
    }

    console.log('Onboarding completed - navigating to home page (showing all cards):', completedOnboardingData);
  };

  const handleAppSignOut = () => {
    stateHandleSignOut();
  };

  const handleDeleteAccount = () => {
    // Similar to sign out but more complete
    stateHandleSignOut();
    console.log('Account deleted - all user data removed');
  };

  // Mock card generator - optimized with useCallback
  const generateNewMockCard = React.useCallback(() => {
    const cardTemplates = [
      {
        title: 'Artisan Chocolate Workshop',
        category: 'creative',
        categoryIcon: 'Sparkles',
        description: 'Hands-on chocolate making with local artisans',
        budget: 'Perfect for your $50-100 budget range',
        rating: 4.8,
        reviewCount: 342,
        priceRange: '$75-95',
        pricePerPerson: 85,
        travelTime: '18 min',
        distance: '4.2 km',
        experienceType: 'friendly',
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
  }, []);



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
            boardsSessions={boardsSessions}
            onAddToCalendar={handleAddToCalendar}
            savedCards={savedCards}
            onSaveCard={handleSaveCard}
            onShareCard={handlers.handleShareCard}
            onModeChange={handlers.handleModeChange}
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
              
              handlePurchaseComplete(enhancedPurchaseData, purchaseOption);
              
              console.log('Purchase completed with preferences and business tracking:', {
                experience: experienceData.title,
                option: purchaseOption.title,
                price: formatCurrency(purchaseOption.price, accountPreferences.currency),
                preferences: userPreferences,
                session: currentMode,
                businessId: experienceData.businessId,
                businessName: experienceData.businessName
              });
            }}
            removedCardIds={removedCardIds}
            generateNewMockCard={generateNewMockCard}
            onboardingData={onboardingData}
            curatorCards={curatorCards}
          />
        );
      case 'discover':
        return (
          <DiscoverPage
            userPreferences={userPreferences}
            onboardingData={onboardingData}
            onCardClick={(card) => {
              // Save the card so user can interact with it
              handleSaveCard(card);
              // Navigate to activity page to view saved cards
              setCurrentPage('activity');
            }}
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
            initialTab={connectionsTab}
          />
        );
      case 'messages':
        return (
          <MessagesPage
            currentUserId={userIdentity?.id || userIdentity?.email || 'anonymous'}
            currentUserType={userRole === 'business' ? 'business' : 'explorer'}
            currentUserName={`${userIdentity?.firstName || ''} ${userIdentity?.lastName || ''}`.trim() || userIdentity?.email || 'User'}
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
            onProposeNewDate={handleProposeNewDate}
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
            onOpenReview={handleOpenReview}
            onSaveCardFromBoard={handleSaveCard}
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
            onNavigateToBusinessDashboard={() => setCurrentPage('business-dashboard')}
            userRole={userRole}
            savedExperiences={profileStats.savedExperiences}
            boardsCount={profileStats.boardsCount}
            connectionsCount={profileStats.connectionsCount}
            placesVisited={profileStats.placesVisited}
            notificationsEnabled={notificationsEnabled}
            onNotificationsToggle={handlers.handleNotificationsToggle}
            userIdentity={userIdentity}
            blockedUsers={blockedUsers}
            onUnblockUser={handlers.handleUnblockUser}
            savedCards={savedCards}
            calendarEntries={calendarEntries}
            accountPreferences={accountPreferences}
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
      case 'business-dashboard':
        // Find the business for this user
        const userBusiness = state.businesses.find((b: any) => 
          b.contactEmail === `${userIdentity.username}@mingla.com` || b.id === userIdentity.username
        );
        
        return (
          <BusinessDashboard
            business={userBusiness || { 
              id: userIdentity.username,
              name: `${userIdentity.firstName} ${userIdentity.lastName}`,
              description: 'Your business',
              curatorId: 'unknown',
              type: 'venue',
              contactEmail: `${userIdentity.username}@mingla.com`,
              createdAt: new Date().toISOString(),
              status: 'active',
              commission: 10
            }}
            onUpdateBusiness={(business) => {
              if (state.updateBusiness) {
                state.updateBusiness(business.id, business);
              }
            }}
            allExperiences={curatorCards}
            onCreateExperience={() => {
              console.log('Create experience for business');
            }}
            accountPreferences={accountPreferences}
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
      <div className="h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 bg-[#eb7825] rounded-full flex items-center justify-center mx-auto">
            <span className="text-white text-2xl">✨</span>
          </div>
          <p className="text-gray-600">Loading Mingla...</p>
        </div>
      </div>
    );
  }

  // Show sign in page if user is not authenticated
  // This is the default entry point for all users
  if (!isAuthenticated) {
    // Detect user role from email for test accounts
    const detectRoleFromEmail = (email: string): 'explorer' | 'curator' | 'business' | 'qa-manager' | 'admin' => {
      if (email.includes('business')) return 'business';
      if (email.includes('curator')) return 'curator';
      if (email.includes('qa')) return 'qa-manager';
      if (email.includes('admin')) return 'admin';
      return 'explorer';
    };

    return (
      <ErrorBoundary>
        <SignInPage
          onSignInRegular={(credentials) => {
            const role = detectRoleFromEmail(credentials.email);
            handleSignIn(credentials, role);
          }}
          onSignUpRegular={(userData) => {
            const role = detectRoleFromEmail(userData.email);
            handleSignUp(userData, role);
          }}
          onSignInCurator={(credentials) => handleSignIn(credentials, 'curator')}
          onSignUpCurator={(userData) => handleSignUp(userData, 'curator')}
        />
      </ErrorBoundary>
    );
  }

  // Show onboarding flow ONLY if user IS authenticated AND hasn't completed it
  if (isAuthenticated && !hasCompletedOnboarding) {
    if (userRole === 'business') {
      return (
        <ErrorBoundary>
          <BusinessOnboardingFlow 
            onComplete={handleOnboardingComplete}
            onBackToSignIn={handleAppSignOut}
          />
        </ErrorBoundary>
      );
    }
    
    return (
      <ErrorBoundary>
        <OnboardingFlow 
          onComplete={handleOnboardingComplete}
          onBackToSignIn={handleAppSignOut}
        />
      </ErrorBoundary>
    );
  }

  // Route to appropriate dashboard based on user role
  // Business users get their own dashboard
  if (userRole === 'business') {
    // Find the business for this user
    const userBusiness = state.businesses.find((b: any) => 
      b.contactEmail === `${userIdentity.username}@mingla.com` || b.id === userIdentity.username
    );
    
    return (
      <ErrorBoundary>
        <BusinessDashboard
          onSignOut={handleAppSignOut}
          businessData={{
            name: `${userIdentity.firstName} ${userIdentity.lastName}`,
            organization: (userIdentity as any).organization,
            email: `${userIdentity.username}@mingla.com`
          }}
          businessCards={curatorCards}
          onUpdateBusinessCards={updateCuratorCards}
          accountPreferences={accountPreferences}
          business={userBusiness || { 
            id: userIdentity.username,
            name: `${userIdentity.firstName} ${userIdentity.lastName}`,
            description: 'Your business',
            type: 'venue',
            contactEmail: `${userIdentity.username}@mingla.com`,
            createdAt: new Date().toISOString(),
            status: 'active'
          }}
          allExperiences={curatorCards}
        />
      </ErrorBoundary>
    );
  }

  // Default: Explorer experience (full app with navigation)
  return (
    <ErrorBoundary>
      <CoachMarkProvider 
        autoStart={hasCompletedOnboarding && !isLoadingOnboarding}
        onComplete={() => {
          toast.success("You're all set! 🎉", {
            description: "Start exploring amazing experiences"
          });
        }}
        onNavigate={(page: string) => {
          setCurrentPage(page as any);
        }}
        onOpenModal={(modalType) => {
          if (modalType === 'collaboration') {
            setShowCollaboration(true);
          } else if (modalType === 'preferences') {
            setShowPreferences(true);
          }
        }}
        onCloseModal={(modalType) => {
          if (modalType === 'collaboration') {
            setShowCollaboration(false);
          } else if (modalType === 'preferences') {
            setShowPreferences(false);
          }
        }}
        onSwitchTab={(tab: string) => {
          if (tab === 'messages') {
            setConnectionsTab('messages');
          } else if (tab === 'boards' || tab === 'saved' || tab === 'calendar') {
            // Handle activity page tabs
            setActivityNavigation({
              activeTab: tab as 'boards' | 'saved' | 'calendar'
            });
          }
        }}
      >
        <CoachMarkOverlay />
        <div className="h-screen bg-gray-50 flex">
        {/* Desktop Sidebar - Hidden on mobile */}
        <nav className="hidden md:flex md:flex-col w-64 bg-white border-r border-gray-200 flex-shrink-0">
          {/* Logo/Brand */}
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center">
                <span className="text-white text-xl">✨</span>
              </div>
              <div>
                <h1 className="text-gray-900">Mingla</h1>
                <p className="text-gray-500 text-xs">Discover & Connect</p>
              </div>
            </div>
          </div>

          {/* Navigation Items */}
          <div className="flex-1 py-6 px-3 space-y-1">
            <button
              onClick={() => setCurrentPage('home')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                currentPage === 'home'
                  ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-md'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Home className="w-5 h-5" />
              <span>Explore</span>
            </button>
            
            <button
              onClick={() => setCurrentPage('discover')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                currentPage === 'discover'
                  ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-md'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Compass className="w-5 h-5" />
              <span>Discover</span>
            </button>
            
            <button
              onClick={() => setCurrentPage('connections')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                currentPage === 'connections'
                  ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-md'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              data-coachmark="nav-connections"
            >
              <Users className="w-5 h-5" />
              <span>Connections</span>
            </button>

            <button
              onClick={() => setCurrentPage('messages')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                currentPage === 'messages'
                  ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-md'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <MessageCircle className="w-5 h-5" />
              <span>Messages</span>
            </button>
            
            <button
              onClick={() => setCurrentPage('activity')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                currentPage === 'activity'
                  ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-md'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              data-coachmark="nav-activity"
            >
              <Heart className="w-5 h-5" />
              <span>Likes</span>
            </button>
            
            <button
              onClick={() => setCurrentPage('profile')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                (currentPage === 'profile' || currentPage === 'business-dashboard' || currentPage === 'profile-settings' || currentPage === 'account-settings' || currentPage === 'privacy-policy' || currentPage === 'terms-of-service')
                  ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-md'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <User className="w-5 h-5" />
              <span>Profile</span>
            </button>
          </div>

          {/* User Info at Bottom */}
          <div className="p-4 border-t border-gray-200">
            <div className="flex items-center gap-3 px-2">
              <div className="h-10 w-10 rounded-full bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center text-white">
                {userIdentity?.firstName?.[0] || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-gray-900 text-sm truncate">
                  {userIdentity?.firstName} {userIdentity?.lastName}
                </p>
                <p className="text-gray-500 text-xs truncate">Explorer</p>
              </div>
            </div>
          </div>
        </nav>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Main Content - with padding for mobile bottom nav */}
          <div className="flex-1 overflow-hidden md:pb-0 pb-20">
            {renderCurrentPage()}
          </div>
        </div>

        {/* Mobile Bottom Navigation - Visible only on mobile */}
        <nav className="md:hidden bottom-navigation fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-2 py-2 z-50">
          <div className="flex items-center justify-around">
            <button 
              onClick={() => setCurrentPage('home')}
              className="flex flex-col items-center gap-1 py-2 px-3"
            >
              <Home className={`w-5 h-5 ${currentPage === 'home' ? 'text-[#eb7825]' : 'text-gray-400'}`} />
              <span className={`text-[10px] ${currentPage === 'home' ? 'text-[#eb7825] font-medium' : 'text-gray-400'}`}>Explore</span>
            </button>
            <button 
              onClick={() => setCurrentPage('discover')}
              className="flex flex-col items-center gap-1 py-2 px-3"
            >
              <Compass className={`w-5 h-5 ${currentPage === 'discover' ? 'text-[#eb7825]' : 'text-gray-400'}`} />
              <span className={`text-[10px] ${currentPage === 'discover' ? 'text-[#eb7825] font-medium' : 'text-gray-400'}`}>Discover</span>
            </button>
            <button 
              onClick={() => setCurrentPage('connections')}
              className="flex flex-col items-center gap-1 py-2 px-3"
              data-coachmark="nav-connections"
            >
              <Users className={`w-5 h-5 ${currentPage === 'connections' ? 'text-[#eb7825]' : 'text-gray-400'}`} />
              <span className={`text-[10px] ${currentPage === 'connections' ? 'text-[#eb7825] font-medium' : 'text-gray-400'}`}>Connect</span>
            </button>
            <button 
              onClick={() => setCurrentPage('activity')}
              className="flex flex-col items-center gap-1 py-2 px-3"
              data-coachmark="nav-activity"
            >
              <Heart className={`w-5 h-5 ${currentPage === 'activity' ? 'text-[#eb7825]' : 'text-gray-400'}`} />
              <span className={`text-[10px] ${currentPage === 'activity' ? 'text-[#eb7825] font-medium' : 'text-gray-400'}`}>Likes</span>
            </button>
            <button 
              onClick={() => setCurrentPage('profile')}
              className="flex flex-col items-center gap-1 py-2 px-3"
              data-coachmark="nav-profile"
            >
              <User className={`w-5 h-5 ${(currentPage === 'profile' || currentPage === 'business-dashboard' || currentPage === 'profile-settings' || currentPage === 'account-settings' || currentPage === 'privacy-policy' || currentPage === 'terms-of-service') ? 'text-[#eb7825]' : 'text-gray-400'}`} />
              <span className={`text-[10px] ${(currentPage === 'profile' || currentPage === 'business-dashboard' || currentPage === 'profile-settings' || currentPage === 'account-settings' || currentPage === 'privacy-policy' || currentPage === 'terms-of-service') ? 'text-[#eb7825] font-medium' : 'text-gray-400'}`}>Profile</span>
            </button>
          </div>
        </nav>

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

        {/* Propose Date Modal */}
        {showProposeDateModal && proposeDateCardData && (
          <ProposeDateModal
            isOpen={showProposeDateModal}
            onClose={() => {
              setShowProposeDateModal(false);
              setProposeDateCardData(null);
            }}
            cardData={proposeDateCardData}
            currentDateTimePreferences={proposeDateCardData.dateTimePreferences || {
              timeOfDay: userPreferences?.timeOfDay || 'Afternoon',
              dayOfWeek: userPreferences?.dayOfWeek || 'Weekend',
              planningTimeframe: userPreferences?.planningTimeframe || 'This month'
            }}
            onProposeDateAccepted={handleProposeDateAccepted}
            accountPreferences={accountPreferences}
          />
        )}

        {/* Review Modal */}
        {showReviewModal && reviewCardData && (
          <ReviewModal
            isOpen={showReviewModal}
            onClose={() => {
              // Check if there are more cards in the queue when modal is closed
              if (reviewQueue.length > 0) {
                const [nextCard, ...remainingQueue] = reviewQueue;
                setReviewQueue(remainingQueue);
                setReviewCardData(nextCard);
                setShowReviewModal(true);
              } else {
                setShowReviewModal(false);
                setReviewCardData(null);
              }
            }}
            cardTitle={reviewCardData.experience?.title || reviewCardData.title || 'Experience'}
            onSubmitReview={(rating, comment) => {
              handleSubmitReview(reviewCardData.id, rating, comment);
              setShowReviewModal(false);
              setReviewCardData(null);
            }}
            remainingReviews={reviewQueue.length}
            existingReview={reviewCardData.userReview && reviewCardData.userReview.rating > 0 ? {
              rating: reviewCardData.userReview.rating,
              comment: reviewCardData.userReview.comment || ''
            } : null}
          />
        )}

        {/* Notification System */}
        <NotificationSystem
          notifications={notifications}
          onDismiss={handlers.handleDismissNotification}
        />

        {/* Toast Notifications */}
        <Toaster />

        {/* Coach Mark Manual Trigger (for testing/re-showing tour) */}
        <CoachMarkTrigger />
      </div>
      </CoachMarkProvider>
    </ErrorBoundary>
  );
}