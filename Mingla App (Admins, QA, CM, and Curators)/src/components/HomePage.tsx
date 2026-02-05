import React, { useState, useRef } from 'react';
import { 
  Bell, Plus, Home, Users, Calendar, User, 
  Star, Navigation, Clock, ChevronDown, SlidersHorizontal
} from 'lucide-react';
import PreferencesSheet from './PreferencesSheet';
import SwipeableCards from './SwipeableCards';
import MinglaLogo from './MinglaLogo';
import NotificationsDropdown from './NotificationsDropdown';

// Moved to SwipeableCards component

interface HomePageProps {
  onOpenPreferences: () => void;
  onOpenCollaboration: (friend?: any) => void;
  onOpenCollabPreferences?: () => void;
  currentMode: 'solo' | string;
  userPreferences?: any;
  accountPreferences?: {
    currency: string;
    measurementSystem: 'Metric' | 'Imperial';
  };
  onAddToCalendar: (experienceData: any) => void;
  savedCards?: any[];
  onSaveCard?: (card: any) => void;
  onShareCard?: (card: any) => void;
  onPurchaseComplete?: (experienceData: any, purchaseOption: any) => void;
  removedCardIds?: string[];
  generateNewMockCard?: () => any;
  onboardingData?: any;
  curatorCards?: any[];
  boardsSessions?: any[];
  onModeChange?: (mode: 'solo' | string) => void;
}

export default function HomePage({ onOpenPreferences, onOpenCollaboration, onOpenCollabPreferences, currentMode, userPreferences, accountPreferences, onAddToCalendar, savedCards, onSaveCard, onShareCard, onPurchaseComplete, removedCardIds, generateNewMockCard, onboardingData, curatorCards, boardsSessions, onModeChange }: HomePageProps) {
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  
  // Get the current board name for display
  const getBoardDisplayName = () => {
    if (currentMode === 'solo') return null;
    
    // Find the board by id or name
    const currentBoard = boardsSessions?.find(
      (board: any) => board.id === currentMode || board.name === currentMode
    );
    
    return currentBoard?.name || currentMode;
  };
  
  const boardDisplayName = getBoardDisplayName();

  return (
    <div className="h-full bg-gray-50 flex flex-col overflow-hidden">
      {/* Top Navigation - Fixed */}
      <header className="glass-nav border-b border-gray-200/50 px-3 sm:px-6 pt-3 sm:pt-6 pb-2 sm:pb-4 flex items-center justify-between flex-shrink-0 shadow-lg slide-down">
        <div className="flex items-center gap-1 sm:gap-2">
          <button 
            onClick={currentMode === 'solo' ? onOpenPreferences : onOpenCollabPreferences}
            className="preferences-button p-2 sm:p-3 glass-button rounded-xl transition-smooth hover:scale-110 active:scale-95 shadow-md group"
            title={currentMode === 'solo' ? "Solo Preferences" : "Collaboration Preferences"}
            data-coachmark="preferences-button"
          >
            <SlidersHorizontal className={`w-4 h-4 sm:w-5 sm:h-5 transition-smooth group-hover:rotate-90 ${currentMode === 'solo' ? 'text-gray-700' : 'text-[#eb7825]'}`} />
          </button>

        </div>
        
        <div className="flex items-center justify-center w-fit mx-auto logo-pulse">
          <MinglaLogo
            className="h-10 sm:h-48 md:h-72 w-auto"
          />
        </div>
        
        <div className="flex items-center gap-2 sm:gap-3 relative">
          <button 
            onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
            className="notifications-button p-2 sm:p-3 glass-button rounded-xl transition-smooth hover:scale-110 active:scale-95 shadow-md group relative"
            title="Notifications"
            data-coachmark="notifications-button"
            ref={notificationButtonRef}
          >
            <Bell className="w-4 h-4 sm:w-5 sm:h-5 text-gray-700 transition-smooth group-hover:rotate-12" />
            {/* Notification indicator for friend requests, mentions, etc. */}
            <div className="absolute -top-0.5 sm:-top-1 -right-0.5 sm:-right-1 w-2 h-2 sm:w-3 sm:h-3 bg-gradient-to-r from-[#FF7043] to-[#FF5722] rounded-full pulse-notification shadow-md"></div>
          </button>
          
          {/* Notifications Dropdown */}
          <NotificationsDropdown
            isOpen={isNotificationsOpen}
            onClose={() => setIsNotificationsOpen(false)}
            buttonRef={notificationButtonRef}
          />
        </div>
      </header>

      {/* Main Content - Centered middle section */}
      <main className="swipeable-cards-container flex-1 flex flex-col justify-center items-center overflow-hidden" data-coachmark="swipeable-cards-container">
        <SwipeableCards 
          userPreferences={userPreferences} 
          accountPreferences={accountPreferences}
          currentMode={currentMode}
          onAddToCalendar={onAddToCalendar}
          onCardLike={onSaveCard}
          onShareCard={onShareCard}
          onPurchaseComplete={onPurchaseComplete}
          removedCardIds={removedCardIds}
          generateNewMockCard={generateNewMockCard}
          onboardingData={onboardingData}
          curatorCards={curatorCards}
          onModeChange={onModeChange}
          boardsSessions={boardsSessions}
        />
      </main>
    </div>
  );
}