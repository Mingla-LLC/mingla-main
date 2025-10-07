import React, { useState } from 'react';
import { Text, View, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BoardsTab from './activity/BoardsTab';
import SavedTab from './activity/SavedTab';
import CalendarTab from './activity/CalendarTab';
import BoardDiscussion from './BoardDiscussion';
import UserInviteModal from './UserInviteModal';
import PurchaseModal from './PurchaseModal';
import PurchaseQRCode from './PurchaseQRCode';

interface Board {
  id: string;
  name: string;
  type: 'date-night' | 'group-hangout' | 'adventure' | 'wellness' | 'food-tour' | 'cultural';
  description: string;
  participants: Array<{
    id: string;
    name: string;
    status: string;
    lastActive?: string;
  }>;
  status: 'active' | 'voting' | 'locked' | 'completed';
  voteDeadline?: string;
  finalizedDate?: string;
  cardsCount: number;
  createdAt: string;
  unreadMessages: number;
  lastActivity: string;
  icon: any;
  gradient: string;
  creatorId: string;
  admins: string[];
  currentUserId: string;
}

interface ActivityPageProps {
  onSendInvite?: (sessionId: string, users: any[]) => void;
  userPreferences?: any;
  accountPreferences?: {
    currency: string;
    measurementSystem: 'Metric' | 'Imperial';
  };
  calendarEntries?: any[];
  savedCards?: any[];
  onScheduleFromSaved?: (savedCard: any) => void;
  onPurchaseFromSaved?: (card: any, purchaseOption: any) => void;
  onRemoveFromCalendar?: (entry: any) => void;
  onRemoveSaved?: (card: any) => void;
  onShareCard?: (card: any) => void;
  boardsSessions?: any[];
  onUpdateBoardSession?: (board: any) => void;
  navigationData?: {
    selectedBoard?: any;
    activeTab?: 'saved' | 'boards' | 'calendar';
    discussionTab?: string;
  } | null;
  onNavigationComplete?: () => void;
  onPromoteToAdmin?: (boardId: string, participantId: string) => void;
  onDemoteFromAdmin?: (boardId: string, participantId: string) => void;
  onRemoveMember?: (boardId: string, participantId: string) => void;
  onLeaveBoard?: (boardId: string) => void;
}

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
  boardsSessions = [],
  onUpdateBoardSession,
  navigationData,
  onNavigationComplete,
  onPromoteToAdmin,
  onDemoteFromAdmin,
  onRemoveMember,
  onLeaveBoard
}: ActivityPageProps) {
  const [activeTab, setActiveTab] = useState<'boards' | 'saved' | 'calendar'>('boards');
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null);
  const [showBoardDetails, setShowBoardDetails] = useState(false);
  const [activeDiscussionTab, setActiveDiscussionTab] = useState<'cards' | 'discussion'>('discussion');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteSessionData, setInviteSessionData] = useState<{id: string; name: string} | null>(null);
  const [boardNotifications, setBoardNotifications] = useState<{[boardId: string]: boolean}>({});
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [purchaseModalCard, setPurchaseModalCard] = useState<any>(null);
  const [showQRCode, setShowQRCode] = useState<string | null>(null);

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
          setActiveDiscussionTab(navigationData.discussionTab);
        }
      }
      // Clear navigation data after processing
      if (onNavigationComplete) {
        onNavigationComplete();
      }
    }
  }, [navigationData, onNavigationComplete]);

  const handleVote = (cardId: string, vote: 'yes' | 'no') => {
    console.log(`Voted ${vote} on card ${cardId}`);
  };

  const handleRSVP = (cardId: string, rsvp: 'yes' | 'no') => {
    if (rsvp === 'yes') {
      const card = savedCards.find(c => c.id === cardId);
      if (card && onScheduleFromSaved) {
        onScheduleFromSaved(card);
      }
    }
    console.log(`RSVP ${rsvp} for card ${cardId}`);
  };

  const handleRemoveSaved = (cardId: string) => {
    console.log(`Removed card ${cardId} from saved`);
  };

  const handleSendToFriend = (cardId: string) => {
    console.log(`Sending card ${cardId} to friend`);
  };

  const handleInviteToSession = (boardId: string, boardName: string) => {
    setInviteSessionData({ id: boardId, name: boardName });
    setShowInviteModal(true);
  };

  const handleSendInvites = (users: any[]) => {
    if (inviteSessionData && onSendInvite) {
      onSendInvite(inviteSessionData.id, users);
    }
    setShowInviteModal(false);
    setInviteSessionData(null);
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

  const handleLeaveBoard = (boardId: string, boardName: string) => {
    console.log(`Leaving board: ${boardName}`);
  };

  const handleToggleBoardNotifications = (boardId: string) => {
    setBoardNotifications(prev => {
      const newEnabled = !prev[boardId];
      console.log(`Board ${boardId} notifications ${newEnabled ? 'enabled' : 'disabled'}`);
      return {
        ...prev,
        [boardId]: newEnabled
      };
    });
  };

  const handleExitBoard = (boardId: string, boardName: string) => {
    console.log(`Exiting board: ${boardName}`);
  };

  const isUserAdmin = (board: Board): boolean => {
    return board.admins.includes(board.currentUserId);
  };

  const handleOpenBoard = (boardId: string) => {
    setSelectedBoard(boardId);
    setShowBoardDetails(true);
  };

  const handleAddToCalendar = (entry: any) => {
    console.log('Adding to calendar:', entry);
  };

  const handleShowQRCode = (entryId: string) => {
    setShowQRCode(entryId);
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: 'white',
    },
    header: {
      backgroundColor: 'white',
      borderBottomWidth: 1,
      borderBottomColor: '#f3f4f6',
      paddingHorizontal: 24,
      paddingTop: 24,
      paddingBottom: 16,
    },
    headerTitle: {
      fontSize: 20,
      fontWeight: '600',
      color: '#111827',
      marginBottom: 24,
    },
    tabContainer: {
      flexDirection: 'row',
      backgroundColor: '#f3f4f6',
      borderRadius: 12,
      padding: 4,
    },
    tab: {
      flex: 1,
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 8,
      alignItems: 'center',
    },
    tabActive: {
      backgroundColor: 'white',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 1,
    },
    tabText: {
      fontSize: 14,
      fontWeight: '500',
    },
    tabTextActive: {
      color: '#111827',
    },
    tabTextInactive: {
      color: '#6b7280',
    },
    content: {
      flex: 1,
      overflow: 'hidden',
    },
    contentContainer: {
      paddingHorizontal: 24,
      paddingVertical: 24,
    },
    modalOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 50,
      paddingHorizontal: 16,
      paddingBottom: 96,
    },
    qrModal: {
      backgroundColor: 'white',
      borderRadius: 12,
      maxWidth: 400,
      width: '100%',
      maxHeight: '100%',
      overflow: 'hidden',
    },
    qrModalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: '#e5e7eb',
    },
    qrModalTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: '#111827',
    },
    qrModalCloseButton: {
      padding: 8,
      borderRadius: 8,
    },
    qrModalContent: {
      padding: 16,
      flex: 1,
    },
  });

  // Filter to only show active boards (not pending sessions)
  const activeBoards = boardsSessions.filter(board => 
    board.status === 'active' || board.status === 'voting' || board.status === 'locked'
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      {!selectedBoard && (
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Activity</Text>
          
          {/* Tab Navigation */}
          <View style={styles.tabContainer}>
            <TouchableOpacity
              onPress={() => setActiveTab('boards')}
              style={[
                styles.tab,
                activeTab === 'boards' && styles.tabActive
              ]}
            >
              <Text style={[
                styles.tabText,
                activeTab === 'boards' ? styles.tabTextActive : styles.tabTextInactive
              ]}>
                Boards
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab('saved')}
              style={[
                styles.tab,
                activeTab === 'saved' && styles.tabActive
              ]}
            >
              <Text style={[
                styles.tabText,
                activeTab === 'saved' ? styles.tabTextActive : styles.tabTextInactive
              ]}>
                Saved
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab('calendar')}
              style={[
                styles.tab,
                activeTab === 'calendar' && styles.tabActive
              ]}
            >
              <Text style={[
                styles.tabText,
                activeTab === 'calendar' ? styles.tabTextActive : styles.tabTextInactive
              ]}>
                Locked In
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Content */}
      <View style={styles.content}>
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
              />
            ) : null;
          })()
        ) : (
          <ScrollView style={styles.contentContainer}>
            {activeTab === 'boards' && (
              <BoardsTab
                boards={activeBoards}
                onOpenBoard={handleOpenBoard}
                onInviteToSession={handleInviteToSession}
                onToggleNotifications={handleToggleBoardNotifications}
                onExitBoard={handleExitBoard}
                onLeaveBoard={handleLeaveBoard}
                boardNotifications={boardNotifications}
                isUserAdmin={isUserAdmin}
              />
            )}
            {activeTab === 'saved' && (
              <SavedTab
                savedCards={savedCards}
                onScheduleFromSaved={onScheduleFromSaved || (() => {})}
                onPurchaseFromSaved={handleOpenPurchase}
                onShareCard={onShareCard || (() => {})}
                onRemoveSaved={onRemoveSaved || (() => {})}
                userPreferences={userPreferences}
              />
            )}
            {activeTab === 'calendar' && (
              <CalendarTab
                calendarEntries={calendarEntries}
                onRemoveFromCalendar={onRemoveFromCalendar || (() => {})}
                onShareCard={onShareCard || (() => {})}
                onAddToCalendar={handleAddToCalendar}
                onShowQRCode={handleShowQRCode}
                userPreferences={userPreferences}
                accountPreferences={accountPreferences}
              />
            )}
          </ScrollView>
        )}
      </View>

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
        <View style={styles.modalOverlay}>
          <View style={styles.qrModal}>
            <View style={styles.qrModalHeader}>
              <Text style={styles.qrModalTitle}>Purchase QR Code</Text>
              <TouchableOpacity
                onPress={() => setShowQRCode(null)}
                style={styles.qrModalCloseButton}
              >
                <Ionicons name="close" size={20} color="#6b7280" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.qrModalContent}>
              {(() => {
                const entry = calendarEntries.find((e: any) => e.id === showQRCode);
                return entry ? (
                  <PurchaseQRCode 
                    entry={entry}
                    accountPreferences={accountPreferences}
                  />
                ) : null;
              })()}
            </View>
          </View>
        </View>
      )}
    </View>
  );
}