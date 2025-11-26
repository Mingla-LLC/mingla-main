import React, { useState } from 'react';
import { Text, View, TouchableOpacity, StyleSheet, ScrollView, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SessionsTab from './collaboration/SessionsTab';
import InvitesTab from './collaboration/InvitesTab';
import CreateTab from './collaboration/CreateTab';

interface Friend {
  id: string;
  name: string;
  username?: string;
  avatar?: string;
  status: 'online' | 'offline';
  lastActive?: string;
}

interface CollaborationInvite {
  id: string;
  sessionName: string;
  fromUser: Friend;
  toUser: Friend;
  status: 'pending' | 'accepted' | 'declined' | 'canceled';
  createdAt: string;
  expiresAt?: string;
}

interface CollaborationSession {
  id: string;
  name: string;
  status: 'pending' | 'active' | 'archived';
  participants: Friend[];
  createdBy: string;
  createdAt: string;
  lastActivity: string;
  hasCollabPreferences?: boolean;
  pendingParticipants: number;
  totalParticipants: number;
  boardCards: number;
  admins?: string[];
}

interface CollaborationModuleProps {
  isOpen: boolean;
  onClose: () => void;
  currentMode: 'solo' | string;
  onModeChange: (mode: 'solo' | string) => void;
  preSelectedFriend?: Friend | null;
  boardsSessions?: any[];
  onUpdateBoardSession?: (updatedBoard: any) => void;
  onCreateSession?: (newSession: any) => void;
  onNavigateToBoard?: (board: any, discussionTab?: string) => void;
  availableFriends?: Friend[];
}

// Mock data
const mockFriends: Friend[] = [
  { id: '1', name: 'Sarah Chen', status: 'online' },
  { id: '2', name: 'Marcus Johnson', status: 'online' },
  { id: '3', name: 'Alex Rivera', status: 'offline', lastActive: '2h ago' },
  { id: '4', name: 'Jamie Park', status: 'online' },
  { id: '5', name: 'Taylor Kim', status: 'offline', lastActive: '1d ago' },
  { id: '6', name: 'Jordan Lee', status: 'online' }
];

const mockSentInvites: CollaborationInvite[] = [
  {
    id: 'sent-1',
    sessionName: 'Weekend Fun Squad',
    fromUser: { id: 'me', name: 'You', status: 'online' },
    toUser: mockFriends[0],
    status: 'pending',
    createdAt: '2h ago',
    expiresAt: '22h'
  },
  {
    id: 'sent-2',
    sessionName: 'Coffee Hunters',
    fromUser: { id: 'me', name: 'You', status: 'online' },
    toUser: mockFriends[2],
    status: 'pending',
    createdAt: '1d ago',
    expiresAt: '12h'
  }
];

const mockReceivedInvites: CollaborationInvite[] = [
  {
    id: 'recv-1',
    sessionName: 'Date Night Planning',
    fromUser: mockFriends[1],
    toUser: { id: 'me', name: 'You', status: 'online' },
    status: 'pending',
    createdAt: '30m ago'
  },
  {
    id: 'recv-2',
    sessionName: 'Adventure Squad',
    fromUser: mockFriends[3],
    toUser: { id: 'me', name: 'You', status: 'online' },
    status: 'pending',
    createdAt: '4h ago'
  }
];

export default function CollaborationModule({ 
  isOpen, 
  onClose, 
  currentMode, 
  onModeChange,
  preSelectedFriend,
  boardsSessions = [],
  onUpdateBoardSession,
  onCreateSession,
  onNavigateToBoard,
  availableFriends = []
}: CollaborationModuleProps) {
  const [activeTab, setActiveTab] = useState<'sessions' | 'invites' | 'create'>('sessions');

  // Reset create flow when tab changes
  React.useEffect(() => {
    if (activeTab !== 'create') {
      // Reset create flow state if needed
    }
  }, [activeTab]);

  // Auto-navigate to create tab if pre-selected friend
  React.useEffect(() => {
    if (preSelectedFriend && isOpen) {
      setActiveTab('create');
    }
  }, [preSelectedFriend, isOpen]);

  const handleAcceptInvite = (inviteId: string) => {
  };

  const handleDeclineInvite = (inviteId: string) => {
  };

  const handleCancelInvite = (inviteId: string) => {
  };

  const handleJoinSession = (sessionId: string, sessionName: string) => {
    onModeChange(sessionName);
    onClose();
  };

  const handleLeaveSession = (sessionId: string) => {
    if (currentMode !== 'solo') {
      onModeChange('solo');
    }
  };

  const handleCreateSession = (sessionData: any) => {
    if (onCreateSession) {
      onCreateSession(sessionData);
    }
    
    // Switch to the new session
    onModeChange(sessionData.name);
    onClose();
  };

  const handleStartCollaboration = () => {
    setActiveTab('create');
  };

  // Process sessions data
  const activeSessions = boardsSessions.filter(board => 
    board.status === 'active' || board.status === 'voting' || board.status === 'locked'
  );
  
  // Debug logging
  
  const mockPendingSessions = [
    {
      id: 'pending-mock-1',
      name: 'Wine & Paint Night',
      type: 'creative-date',
      description: 'Waiting for friends to accept invites',
      participants: [
        { id: 'you', name: 'You', status: 'accepted' },
        { id: 'alex', name: 'Alex Rivera', status: 'pending', invitedAt: '2 hours ago' },
        { id: 'jamie', name: 'Jamie Park', status: 'pending', invitedAt: '1 hour ago' }
      ],
      status: 'pending',
      pendingInvites: 2,
      cardsCount: 0,
      createdAt: '3 hours ago',
      unreadMessages: 0,
      lastActivity: '3 hours ago',
      icon: 'Palette',
      gradient: 'from-purple-500 to-pink-500',
      creatorId: 'you',
      admins: ['you'],
      currentUserId: 'you'
    }
  ];
  
  const actualPendingBoards = boardsSessions.filter(board => board.status === 'pending');
  const pendingSessions = [...mockPendingSessions, ...actualPendingBoards];

  const styles = StyleSheet.create({
    modalContainer: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: 'white',
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      width: '100%',
      maxHeight: '95%',
      minHeight: '90%',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 24,
      borderBottomWidth: 1,
      borderBottomColor: '#f3f4f6',
    },
    headerTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      color: '#111827',
    },
    headerSubtitle: {
      fontSize: 14,
      color: '#6b7280',
      marginTop: 2,
    },
    closeButton: {
      padding: 8,
      borderRadius: 20,
    },
    tabsContainer: {
      flexDirection: 'row',
      backgroundColor: '#f9fafb',
      padding: 4,
      marginHorizontal: 24,
      marginTop: 16,
      borderRadius: 12,
    },
    tab: {
      flex: 1,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
      alignItems: 'center',
      position: 'relative',
    },
    tabActive: {
      backgroundColor: 'white',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 2,
    },
    tabText: {
      fontSize: 14,
      fontWeight: '500',
      color: '#6b7280',
    },
    tabTextActive: {
      color: '#111827',
    },
    notificationDot: {
      position: 'absolute',
      top: -2,
      right: -2,
      width: 8,
      height: 8,
      backgroundColor: '#ef4444',
      borderRadius: 4,
    },
    content: {
      flex: 1,
      padding: 24,
    },
  });

  if (!isOpen) return null;

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>Collaboration</Text>
              <Text style={styles.headerSubtitle}>Discover experiences together</Text>
            </View>
            <TouchableOpacity 
              onPress={onClose}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View style={styles.tabsContainer}>
            <TouchableOpacity
              onPress={() => setActiveTab('sessions')}
              style={[
                styles.tab,
                activeTab === 'sessions' && styles.tabActive
              ]}
            >
              <Text style={[
                styles.tabText,
                activeTab === 'sessions' && styles.tabTextActive
              ]}>
                Sessions
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab('invites')}
              style={[
                styles.tab,
                activeTab === 'invites' && styles.tabActive
              ]}
            >
              <Text style={[
                styles.tabText,
                activeTab === 'invites' && styles.tabTextActive
              ]}>
                Invites
              </Text>
              {(mockReceivedInvites.length > 0 || mockSentInvites.length > 0) && (
                <View style={styles.notificationDot} />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab('create')}
              style={[
                styles.tab,
                activeTab === 'create' && styles.tabActive
              ]}
            >
              <Text style={[
                styles.tabText,
                activeTab === 'create' && styles.tabTextActive
              ]}>
                Create
              </Text>
            </TouchableOpacity>
          </View>

          {/* Content */}
          <ScrollView 
            style={styles.content}
            showsVerticalScrollIndicator={true}
            bounces={true}
          >
            {activeTab === 'sessions' && (
              <SessionsTab
                currentMode={currentMode}
                onModeChange={onModeChange}
                onJoinSession={handleJoinSession}
                onLeaveSession={handleLeaveSession}
                onNavigateToBoard={onNavigateToBoard}
                onStartCollaboration={handleStartCollaboration}
                activeSessions={activeSessions}
                pendingSessions={pendingSessions}
              />
            )}
            {activeTab === 'invites' && (
              <InvitesTab
                sentInvites={mockSentInvites}
                receivedInvites={mockReceivedInvites}
                onAcceptInvite={handleAcceptInvite}
                onDeclineInvite={handleDeclineInvite}
                onCancelInvite={handleCancelInvite}
              />
            )}
            {activeTab === 'create' && (
              <CreateTab
                preSelectedFriend={preSelectedFriend}
                availableFriends={availableFriends}
                onCreateSession={handleCreateSession}
              />
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
