import React, { useState } from 'react';
import BoardDiscussion from './BoardDiscussion';
import UserInviteModal from './UserInviteModal';
import PurchaseModal from './PurchaseModal';
import PurchaseQRCode from './PurchaseQRCode';
import { 
  ActivityHeader,
  SavedTab,
  CalendarTab,
  ActivityPageProps,
  TabType
} from './activity';

export default function ActivityPage({ 
  onSendInvite, 
  userPreferences, 
  accountPreferences, 
  calendarEntries = [], 
  savedCards = [], 
  onScheduleFromSaved,
  onPurchaseFromSaved,
  onRemoveFromCalendar,
  onRemoveSaved,
  onShareCard,
  onProposeNewDate,
  boardsSessions = [],
  onUpdateBoardSession,
  navigationData,
  onNavigationComplete,
  onPromoteToAdmin,
  onDemoteFromAdmin,
  onRemoveMember,
  onLeaveBoard,
  onOpenReview,
  onSaveCardFromBoard
}: ActivityPageProps) {
  const [activeTab, setActiveTab] = useState<TabType>('saved');
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null);
  const [showBoardDetails, setShowBoardDetails] = useState(false);
  const [activeDiscussionTab, setActiveDiscussionTab] = useState<'cards' | 'discussion'>('discussion');
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState<{[cardId: string]: number}>({});
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteSessionData, setInviteSessionData] = useState<{id: string; name: string} | null>(null);
  const [boardNotifications, setBoardNotifications] = useState<{[boardId: string]: boolean}>({});
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [purchaseModalCard, setPurchaseModalCard] = useState<any>(null);
  const [showQRCode, setShowQRCode] = useState<string | null>(null);
  
  // Search and filter state
  const [savedSearchQuery, setSavedSearchQuery] = useState('');
  const [savedFilter, setSavedFilter] = useState<'all' | 'solo' | 'collaboration'>('all');
  const [showSavedFilters, setShowSavedFilters] = useState(false);
  const [savedCategoryFilter, setSavedCategoryFilter] = useState<string[]>([]);
  const [savedBudgetFilter, setSavedBudgetFilter] = useState<'all' | '0-25' | '25-75' | '75-150' | '150+'>('all');
  const [savedExperienceTypeFilter, setSavedExperienceTypeFilter] = useState<string[]>([]);
  const [calendarSearchQuery, setCalendarSearchQuery] = useState('');
  const [calendarTimeFilter, setCalendarTimeFilter] = useState<'all' | 'today' | 'this-week' | 'this-month' | 'upcoming'>('all');
  const [calendarTypeFilter, setCalendarTypeFilter] = useState<'all' | 'purchased' | 'scheduled'>('all');
  const [showCalendarFilters, setShowCalendarFilters] = useState(false);
  const [calendarCategoryFilter, setCalendarCategoryFilter] = useState<string[]>([]);
  const [calendarBudgetFilter, setCalendarBudgetFilter] = useState<'all' | '0-25' | '25-75' | '75-150' | '150+'>('all');
  const [calendarExperienceTypeFilter, setCalendarExperienceTypeFilter] = useState<string[]>([]);
  
  // Collapse state for Active/Archives sections (persisted)
  const [savedActiveCollapsed, setSavedActiveCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem('mingla_saved_active_collapsed');
      return stored ? JSON.parse(stored) : false;
    } catch {
      return false;
    }
  });
  const [savedArchivesCollapsed, setSavedArchivesCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem('mingla_saved_archives_collapsed');
      return stored ? JSON.parse(stored) : true; // Archives collapsed by default
    } catch {
      return true;
    }
  });
  const [calendarActiveCollapsed, setCalendarActiveCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem('mingla_calendar_active_collapsed');
      return stored ? JSON.parse(stored) : false;
    } catch {
      return false;
    }
  });
  const [calendarArchivesCollapsed, setCalendarArchivesCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem('mingla_calendar_archives_collapsed');
      return stored ? JSON.parse(stored) : true; // Archives collapsed by default
    } catch {
      return true;
    }
  });
  
  // Persist collapse state
  React.useEffect(() => {
    try {
      localStorage.setItem('mingla_saved_active_collapsed', JSON.stringify(savedActiveCollapsed));
    } catch {}
  }, [savedActiveCollapsed]);
  
  React.useEffect(() => {
    try {
      localStorage.setItem('mingla_saved_archives_collapsed', JSON.stringify(savedArchivesCollapsed));
    } catch {}
  }, [savedArchivesCollapsed]);
  
  React.useEffect(() => {
    try {
      localStorage.setItem('mingla_calendar_active_collapsed', JSON.stringify(calendarActiveCollapsed));
    } catch {}
  }, [calendarActiveCollapsed]);
  
  React.useEffect(() => {
    try {
      localStorage.setItem('mingla_calendar_archives_collapsed', JSON.stringify(calendarArchivesCollapsed));
    } catch {}
  }, [calendarArchivesCollapsed]);

  // Handle navigation from external sources (e.g., CollaborationModule)
  React.useEffect(() => {
    if (navigationData) {
      if (navigationData.activeTab) {
        setActiveTab(navigationData.activeTab);
      }
      if (navigationData.selectedBoard) {
        setSelectedBoard(navigationData.selectedBoard.id);
        setShowBoardDetails(true);
        if (navigationData.discussionTab) {
          setActiveDiscussionTab(navigationData.discussionTab as 'cards' | 'discussion');
        }
      }
      
      // Notify parent that navigation is complete
      if (onNavigationComplete) {
        setTimeout(() => {
          onNavigationComplete();
        }, 100);
      }
    }
  }, [navigationData, onNavigationComplete]);

  // Handlers
  const handleInviteToSession = (sessionId: string, sessionName: string) => {
    setInviteSessionData({ id: sessionId, name: sessionName });
    setShowInviteModal(true);
  };

  const handleSendInvites = (users: any[]) => {
    if (inviteSessionData && onSendInvite) {
      onSendInvite(inviteSessionData.id, users);
    }
    setShowInviteModal(false);
    setInviteSessionData(null);
  };

  const handleImageNavigation = (cardId: string, direction: 'prev' | 'next', totalImages: number) => {
    setCurrentImageIndex(prev => ({
      ...prev,
      [cardId]: direction === 'next'
        ? ((prev[cardId] || 0) + 1) % totalImages
        : ((prev[cardId] || 0) - 1 + totalImages) % totalImages
    }));
  };

  const handleOpenPurchase = (card: any) => {
    setPurchaseModalCard(card);
    setShowPurchaseModal(true);
  };

  const handlePurchaseComplete = (experienceData: any, purchaseOption: any) => {
    setShowPurchaseModal(false);
    setPurchaseModalCard(null);
    
    if (onPurchaseFromSaved) {
      onPurchaseFromSaved(experienceData, purchaseOption);
    }
  };

  const handleToggleBoardNotifications = (boardId: string) => {
    setBoardNotifications(prev => ({
      ...prev,
      [boardId]: !prev[boardId]
    }));
  };

  const handleSelectBoard = (board: any) => {
    setSelectedBoard(board.id);
    setShowBoardDetails(true);
  };

  const handleLeaveBoard = (boardId: string, boardName: string) => {
    // Call parent handler if provided
    if (onLeaveBoard) {
      onLeaveBoard(boardId);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="max-w-7xl mx-auto">
        
        {/* Tab Navigation */}
        {!showBoardDetails && (
          <ActivityHeader activeTab={activeTab} onTabChange={setActiveTab} />
        )}

        {/* Content */}
        <div className="pb-6">
          {showBoardDetails && selectedBoard ? (
            (() => {
              const board = boardsSessions.find(b => b.id === selectedBoard);
              return board ? (
                <BoardDiscussion 
                  board={board}
                  onBack={() => {
                    setShowBoardDetails(false);
                    setSelectedBoard(null);
                  }}
                  activeTab={activeDiscussionTab}
                  onTabChange={setActiveDiscussionTab}
                  onPromoteToAdmin={onPromoteToAdmin}
                  onDemoteFromAdmin={onDemoteFromAdmin}
                  onRemoveMember={onRemoveMember}
                  onLeaveBoard={onLeaveBoard}
                  onSaveCardFromBoard={onSaveCardFromBoard}
                />
              ) : null;
            })()
          ) : (
            <>
              {activeTab === 'saved' && (
                <SavedTab
                  savedCards={savedCards}
                  searchQuery={savedSearchQuery}
                  filter={savedFilter}
                  showFilters={showSavedFilters}
                  activeCollapsed={savedActiveCollapsed}
                  archivesCollapsed={savedArchivesCollapsed}
                  expandedCard={expandedCard}
                  currentImageIndex={currentImageIndex}
                  accountPreferences={accountPreferences}
                  onSearchChange={setSavedSearchQuery}
                  onFilterChange={setSavedFilter}
                  onToggleFilters={() => setShowSavedFilters(!showSavedFilters)}
                  onToggleActiveCollapsed={() => setSavedActiveCollapsed(!savedActiveCollapsed)}
                  onToggleArchivesCollapsed={() => setSavedArchivesCollapsed(!savedArchivesCollapsed)}
                  onExpandCard={setExpandedCard}
                  onImageNavigation={handleImageNavigation}
                  onScheduleCard={(card) => onScheduleFromSaved?.(card)}
                  onPurchaseCard={handleOpenPurchase}
                  onRemoveCard={(card) => onRemoveSaved?.(card)}
                  onShareCard={(card) => onShareCard?.(card)}
                  onCategoryFilterChange={setSavedCategoryFilter}
                  onBudgetFilterChange={setSavedBudgetFilter}
                  onExperienceTypeFilterChange={setSavedExperienceTypeFilter}
                  categoryFilter={savedCategoryFilter}
                  budgetFilter={savedBudgetFilter}
                  experienceTypeFilter={savedExperienceTypeFilter}
                />
              )}
              {activeTab === 'calendar' && (
                <CalendarTab
                  calendarEntries={calendarEntries}
                  searchQuery={calendarSearchQuery}
                  timeFilter={calendarTimeFilter}
                  typeFilter={calendarTypeFilter}
                  showFilters={showCalendarFilters}
                  activeCollapsed={calendarActiveCollapsed}
                  archivesCollapsed={calendarArchivesCollapsed}
                  accountPreferences={accountPreferences}
                  onSearchChange={setCalendarSearchQuery}
                  onTimeFilterChange={setCalendarTimeFilter}
                  onTypeFilterChange={setCalendarTypeFilter}
                  onToggleFilters={() => setShowCalendarFilters(!showCalendarFilters)}
                  onToggleActiveCollapsed={() => setCalendarActiveCollapsed(!calendarActiveCollapsed)}
                  onToggleArchivesCollapsed={() => setCalendarArchivesCollapsed(!calendarArchivesCollapsed)}
                  onProposeNewDate={(entry) => onProposeNewDate?.(entry)}
                  onRemoveEntry={(entry) => onRemoveFromCalendar?.(entry)}
                  onShowQRCode={setShowQRCode}
                  onOpenReview={onOpenReview}
                  onCategoryFilterChange={setCalendarCategoryFilter}
                  onBudgetFilterChange={setCalendarBudgetFilter}
                  onExperienceTypeFilterChange={setCalendarExperienceTypeFilter}
                  categoryFilter={calendarCategoryFilter}
                  budgetFilter={calendarBudgetFilter}
                  experienceTypeFilter={calendarExperienceTypeFilter}
                />
              )}
            </>
          )}
        </div>

        {/* User Invite Modal */}
        <UserInviteModal
          isOpen={showInviteModal}
          onClose={() => {
            setShowInviteModal(false);
            setInviteSessionData(null);
          }}
          onSendInvites={handleSendInvites}
          sessionName={inviteSessionData?.name || ''}
        />

        {/* Purchase Modal */}
        {showPurchaseModal && purchaseModalCard && (
          <PurchaseModal 
            isOpen={showPurchaseModal}
            onClose={() => {
              setShowPurchaseModal(false);
              setPurchaseModalCard(null);
            }}
            recommendation={purchaseModalCard}
            accountPreferences={accountPreferences}
            onPurchaseComplete={handlePurchaseComplete}
          />
        )}

        {/* QR Code Modal */}
        {showQRCode && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 pb-24">
            <div className="bg-white rounded-2xl max-w-sm w-full max-h-[90vh] overflow-hidden flex flex-col">
              <div className="p-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
                <h2 className="text-lg font-semibold text-gray-900">Your QR Code</h2>
                <button
                  onClick={() => setShowQRCode(null)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <span className="text-gray-600 text-xl">×</span>
                </button>
              </div>
              
              <div className="p-4 overflow-y-auto flex-1">
                {(() => {
                  const entry = calendarEntries.find((e: any) => e.id === showQRCode);
                  return entry ? (
                    <PurchaseQRCode 
                      entry={entry}
                      accountPreferences={accountPreferences}
                    />
                  ) : null;
                })()}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}