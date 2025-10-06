import React, { useState } from 'react';
import { Text, View, TextInput } from 'react-native';
import { 
  X, Plus, Users, Send, Check, Clock, AlertCircle, 
  ChevronRight, ChevronLeft, UserPlus, Settings, 
  MessageSquare, Calendar, Star, ArrowRight, Trash2,
  User, UserCheck, UserX, Timer, Zap
} from 'lucide-react';

interface Friend {
  id: string;
  name: string;
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
}

interface CollaborationModuleProps {
  isOpen: boolean;
  onClose: () => void;
  currentMode: 'solo' | string; // 'solo' or session name
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

const mockActiveSessions: CollaborationSession[] = [
  {
    id: 'session-1',
    name: 'Weekend Squad',
    status: 'active',
    participants: [mockFriends[0], mockFriends[1]],
    createdBy: 'me',
    createdAt: '2 days ago',
    lastActivity: '1h ago',
    hasCollabPreferences: true,
    pendingParticipants: 0,
    totalParticipants: 3,
    boardCards: 4
  },
  {
    id: 'session-2',
    name: 'Dinner Club',
    status: 'pending',
    participants: [mockFriends[3]],
    createdBy: 'me',
    createdAt: '1 day ago',
    lastActivity: '5h ago',
    hasCollabPreferences: false,
    pendingParticipants: 1,
    totalParticipants: 2,
    boardCards: 0
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
  const [createStep, setCreateStep] = useState<'details' | 'friends' | 'confirm'>('details');
  const [newSessionName, setNewSessionName] = useState('');
  const [selectedFriends, setSelectedFriends] = useState<Friend[]>(
    preSelectedFriend ? [preSelectedFriend] : []
  );
  const [showInviteType, setShowInviteType] = useState<'sent' | 'received'>('received');

  // Reset create flow when tab changes
  React.useEffect(() => {
    if (activeTab !== 'create') {
      setCreateStep('details');
      setNewSessionName('');
      if (!preSelectedFriend) {
        setSelectedFriends([]);
      }
    }
  }, [activeTab, preSelectedFriend]);

  // Auto-navigate to create tab if pre-selected friend
  React.useEffect(() => {
    if (preSelectedFriend && isOpen) {
      setActiveTab('create');
      setSelectedFriends([preSelectedFriend]);
    }
  }, [preSelectedFriend, isOpen]);

  // Update selectedFriends when preSelectedFriend changes
  React.useEffect(() => {
    if (preSelectedFriend) {
      setSelectedFriends(prev => {
        // Only update if the preSelectedFriend is not already in the selection
        const isAlreadySelected = prev.some(f => f.id === preSelectedFriend.id);
        if (!isAlreadySelected) {
          return [preSelectedFriend, ...prev.filter(f => f.id !== preSelectedFriend.id)];
        }
        return prev;
      });
    }
  }, [preSelectedFriend]);

  const handleCreateSession = () => {
    if (!newSessionName.trim() || selectedFriends.length === 0) return;
    
    const newSession = {
      id: `board-${Date.now()}`,
      name: newSessionName,
      type: 'group-hangout',
      description: `Collaborative session with ${selectedFriends.map(f => f.name).join(', ')}`,
      participants: [
        { id: 'you', name: 'You', status: 'online' },
        ...selectedFriends.map(friend => ({
          id: friend.id,
          name: friend.name,
          status: friend.status || 'offline'
        }))
      ],
      status: 'active',
      cardsCount: 0,
      createdAt: 'Just now',
      unreadMessages: 0,
      lastActivity: 'Just now',
      icon: 'Users',
      gradient: 'from-blue-500 to-indigo-500',
      creatorId: 'you',
      admins: ['you'],
      currentUserId: 'you'
    };
    
    if (onCreateSession) {
      onCreateSession(newSession);
    }
    
    // Switch to the new session
    onModeChange(newSessionName);
    
    console.log('Creating session:', newSession);
    onClose();
  };

  const handleAcceptInvite = (inviteId: string) => {
    // TODO: Implement invite acceptance
    console.log('Accepting invite:', inviteId);
  };

  const handleDeclineInvite = (inviteId: string) => {
    // TODO: Implement invite decline
    console.log('Declining invite:', inviteId);
  };

  const handleCancelInvite = (inviteId: string) => {
    // TODO: Implement invite cancellation
    console.log('Canceling invite:', inviteId);
  };

  const handleJoinSession = (sessionId: string, sessionName: string) => {
    onModeChange(sessionName);
    onClose();
  };

  const handleLeaveSession = (sessionId: string) => {
    // TODO: Implement leave session logic
    console.log('Leaving session:', sessionId);
    if (currentMode !== 'solo') {
      onModeChange('solo');
    }
  };

  const handleAddFriendToSession = (session: CollaborationSession) => {
    // Set up for adding friends to existing session
    setPreSelectedFriend(null);
    setNewSessionName(session.name + ' (Adding Friends)');
    setSelectedFriends([]);
    setCreateStep('friends');
    setActiveTab('create');
  };

  const toggleFriendSelection = (friend: Friend) => {
    setSelectedFriends(prev => {
      const isSelected = prev.some(f => f.id === friend.id);
      if (isSelected) {
        return prev.filter(f => f.id !== friend.id);
      } else {
        return [...prev, friend];
      }
    });
  };

  if (!isOpen) return null;

  const renderSessionsTab = () => {
    // Convert boards to sessions format - only active/voting/locked boards are active sessions
    const activeSessions = boardsSessions.filter(board => board.status === 'active' || board.status === 'voting' || board.status === 'locked');
    
    // Mock pending sessions for demo purposes (separate from pending boards)
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
      },
      {
        id: 'pending-mock-2',
        name: 'Hiking Adventure Club',
        type: 'outdoor-fitness',
        description: 'Setting up for weekend exploration',
        participants: [
          { id: 'morgan', name: 'Morgan Lee', status: 'accepted' },
          { id: 'you', name: 'You', status: 'pending', invitedAt: '6 hours ago' },
          { id: 'taylor', name: 'Taylor Kim', status: 'pending', invitedAt: '5 hours ago' },
          { id: 'sam', name: 'Sam Wilson', status: 'accepted' }
        ],
        status: 'pending',
        pendingInvites: 2,
        cardsCount: 1,
        createdAt: '8 hours ago',
        unreadMessages: 2,
        lastActivity: '2 hours ago',
        icon: 'Mountain',
        gradient: 'from-green-500 to-emerald-500',
        creatorId: 'morgan',
        admins: ['morgan'],
        currentUserId: 'you'
      }
    ];
    
    // Combine actual pending boards with mock pending sessions
    const actualPendingBoards = boardsSessions.filter(board => board.status === 'pending');
    const pendingSessions = [...mockPendingSessions, ...actualPendingBoards];

    return (
      <View className="space-y-6">
        {/* Current Mode */}
        <View className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-100 rounded-2xl p-4">
          <View className="flex items-center justify-between">
            <View>
              <Text className="font-semibold text-gray-900">Current Mode</Text>
              <Text className="text-sm text-gray-600">
                {currentMode === 'solo' ? 'Solo discovery mode' : `Collaborating in "${currentMode}"`}
              </Text>
            </View>
            <View className={`px-3 py-1 rounded-full text-sm font-medium ${
              currentMode === 'solo' 
                ? 'bg-blue-100 text-blue-700' 
                : 'bg-[#eb7825] text-white'
            }`}>
              {currentMode === 'solo' ? 'Solo' : 'Collaboration'}
            </View>
          </View>
          <TouchableOpacity 
            onClick={() => onModeChange('solo')}
            disabled={currentMode === 'solo'}
            className={`mt-3 w-full py-2 px-4 rounded-xl font-medium text-sm transition-all duration-200 ${
              currentMode === 'solo'
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300 shadow-sm hover:shadow-md'
            }`}
          >
            {currentMode === 'solo' ? '✓ Solo Mode Active' : 'Switch to Solo Mode →'}
          </TouchableOpacity>
        </View>

        {/* Active Sessions */}
        {activeSessions.length > 0 && (
          <View>
            <Text className="font-bold text-gray-900 mb-3 flex items-center gap-2">
              <Zap className="w-5 h-5 text-[#eb7825]" />
              Active Sessions ({activeSessions.length})
            </Text>
            <View className="space-y-3">
              {activeSessions.map((session) => (
                <View key={session.id} className="bg-white border border-gray-200 rounded-2xl p-4">
                  <View className="mb-3">
                    <View className="flex items-center justify-between mb-2">
                      <Text className="font-semibold text-gray-900">{session.name}</Text>
                      <View className={`w-3 h-3 rounded-full ${
                        session.status === 'active' ? 'bg-green-500' : session.status === 'voting' ? 'bg-yellow-500' : 'bg-gray-400'
                      }`} />
                    </View>
                    <View className="flex items-center gap-4 text-sm text-gray-600 mb-2">
                      <Text>{session.participants.length} people</Text>
                      <Text>{session.cardsCount} cards</Text>
                    </View>
                    <View className="text-[#eb7825] text-xs">
                      Active {session.lastActivity}
                    </View>
                  </View>

                  <View className="mb-4">
                    <View className="flex items-center gap-2 mb-2">
                      <Users className="w-4 h-4 text-[#eb7825]" />
                      <Text className="text-sm font-medium text-gray-700">Collaborating Users</Text>
                    </View>
                    <View className="flex flex-wrap gap-3">
                      {session.participants.slice(0, 5).map((participant, i) => {
                        const isAdmin = session.admins && session.admins.includes(participant.id);
                        const isCurrentUser = participant.id === 'you';
                        return (
                          <View key={participant.id} className="relative group">
                            <TouchableOpacity
                              onClick={() => {
                                // Handle showing name tooltip - needs state management
                                console.log('Show name for:', participant.name);
                              }}
                              className="relative w-10 h-10 bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-full flex items-center justify-center transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-[#eb7825]/50"
                            >
                              <Text className="text-white font-bold">
                                {participant.name[0]}
                              </Text>
                              {isAdmin && (
                                <View className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-400 rounded-full flex items-center justify-center">
                                  <Text className="text-xs">👑</Text>
                                </View>
                              )}
                            </TouchableOpacity>
                            
                            {/* Name tooltip - would need state to show/hide */}
                            <View className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                              {participant.name}
                              {isAdmin && ' (Admin)'}
                              {isCurrentUser && ' (You)'}
                            </View>

                            {/* Kick button for admin - only show if current user is admin and this isn't current user */}
                            {session.adminId === 'current-user' && !isCurrentUser && (
                              <TouchableOpacity
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Handle kick user - needs function outside this element
                                  console.log('Kick user:', participant.name);
                                }}
                                className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 hidden group-hover:flex"
                              >
                                <X className="w-3 h-3 text-white" />
                              </TouchableOpacity>
                            )}
                          </View>
                        );
                      })}
                      
                      {/* Current user avatar */}
                      <View className="relative group">
                        <View className="w-10 h-10 bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-full flex items-center justify-center ring-2 ring-[#eb7825]/30">
                          <Text className="text-white font-bold">Y</Text>
                          {session.admins && session.admins.includes('you') && (
                            <View className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-400 rounded-full flex items-center justify-center">
                              <Text className="text-xs">👑</Text>
                            </View>
                          )}
                        </View>
                        <View className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                          You{session.admins && session.admins.includes('you') && ' (Admin)'}
                        </View>
                      </View>

                      {session.participants.length > 4 && (
                        <View className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                          <Text className="text-gray-600 text-xs font-medium">+{session.participants.length - 4}</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  <View className="flex gap-2">
                    <TouchableOpacity 
                      onClick={() => handleJoinSession(session.id, session.name)}
                      className={`flex-1 py-2 px-4 rounded-xl font-medium text-sm transition-colors ${
                        currentMode === session.name
                          ? 'bg-[#eb7825] text-white'
                          : 'bg-orange-50 text-[#eb7825] hover:bg-orange-100'
                      }`}
                    >
                      {currentMode === session.name ? 'Current Session' : 'Join Session'}
                    </TouchableOpacity>
                    <TouchableOpacity 
                      onClick={() => {
                        if (onNavigateToBoard) {
                          onNavigateToBoard(session, 'discussion');
                        }
                      }}
                      className="px-3 py-2 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                    >
                      <MessageSquare className="w-4 h-4 text-gray-600" />
                    </TouchableOpacity>
                  </View>

                  {!session.hasCollabPreferences && (
                    <View className="mt-3 bg-yellow-50 border border-yellow-200 rounded-xl p-3">
                      <View className="flex items-center gap-2 text-yellow-700 text-sm">
                        <AlertCircle className="w-4 h-4" />
                        <Text>Set preferences for this session - separate from solo mode</Text>
                      </View>
                    </View>
                  )}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Pending Sessions */}
        {pendingSessions.length > 0 && (
          <View>
            <Text className="font-bold text-gray-900 mb-3 flex items-center gap-2">
              <Timer className="w-5 h-5 text-yellow-600" />
              Pending Sessions ({pendingSessions.length})
            </Text>
            <View className="space-y-3">
              {pendingSessions.map((session) => (
                <View key={session.id} className="bg-white border border-gray-200 rounded-2xl p-4">
                  <View className="flex items-center justify-between mb-3">
                    <View>
                      <Text className="font-semibold text-gray-900">{session.name}</Text>
                      <View className="flex items-center gap-4 text-sm text-gray-600">
                        <Text>{session.participants.length} members</Text>
                        <Text>Created {session.createdAt}</Text>
                      </View>
                    </View>
                    <View className="w-3 h-3 rounded-full bg-yellow-500" />
                  </View>

                  <View className="flex gap-2">
                    <TouchableOpacity 
                      onClick={() => handleLeaveSession(session.id)}
                      className="flex-1 border border-red-200 text-red-600 py-2 px-4 rounded-xl font-medium text-sm hover:bg-red-50 transition-colors"
                    >
                      Cancel Session
                    </TouchableOpacity>
                    <TouchableOpacity className="px-3 py-2 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
                      <Users className="w-4 h-4 text-gray-600" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Empty State */}
        {activeSessions.length === 0 && pendingSessions.length === 0 && (
          <View className="text-center py-8">
            <View className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8 text-gray-400" />
            </View>
            <Text className="font-semibold text-gray-900 mb-2">No Active Sessions</Text>
            <Text className="text-gray-600 mb-4">Start collaborating with friends to discover experiences together</Text>
            <TouchableOpacity 
              onClick={() => setActiveTab('create')}
              className="bg-[#eb7825] text-white py-2 px-6 rounded-xl font-semibold hover:bg-[#d6691f] transition-colors"
            >
              Start Collaboration
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const renderInvitesTab = () => {
    const sentInvites = mockSentInvites.filter(i => i.status === 'pending');
    const receivedInvites = mockReceivedInvites.filter(i => i.status === 'pending');

    return (
      <View className="space-y-4">
        {/* Invite Type Tabs */}
        <View className="flex bg-gray-100 rounded-xl p-1">
          <TouchableOpacity
            onClick={() => setShowInviteType('received')}
            className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-all ${
              showInviteType === 'received'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600'
            }`}
          >
            Received ({receivedInvites.length})
          </TouchableOpacity>
          <TouchableOpacity
            onClick={() => setShowInviteType('sent')}
            className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-all ${
              showInviteType === 'sent'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600'
            }`}
          >
            Sent ({sentInvites.length})
          </TouchableOpacity>
        </View>

        {/* Received Invites */}
        {showInviteType === 'received' && (
          <View className="space-y-3">
            {receivedInvites.length > 0 ? (
              receivedInvites.map((invite) => (
                <View key={invite.id} className="bg-white border border-gray-200 rounded-2xl p-4">
                  <View className="flex items-center gap-3 mb-3">
                    <View className="w-10 h-10 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center">
                      <Text className="text-white font-semibold">
                        {invite.fromUser.name[0]}
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text className="font-semibold text-gray-900">{invite.sessionName}</Text>
                      <Text className="text-sm text-gray-600">
                        Invited by {invite.fromUser.name} • {invite.createdAt}
                      </Text>
                    </View>
                    <View className="w-3 h-3 bg-blue-500 rounded-full" />
                  </View>

                  <View className="flex gap-2">
                    <TouchableOpacity 
                      onClick={() => handleAcceptInvite(invite.id)}
                      className="flex-1 bg-[#eb7825] text-white py-2 px-4 rounded-xl font-medium text-sm hover:bg-[#d6691f] transition-colors"
                    >
                      Accept
                    </TouchableOpacity>
                    <TouchableOpacity 
                      onClick={() => handleDeclineInvite(invite.id)}
                      className="flex-1 border border-gray-200 text-gray-700 py-2 px-4 rounded-xl font-medium text-sm hover:bg-gray-50 transition-colors"
                    >
                      Decline
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            ) : (
              <View className="text-center py-8">
                <View className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <UserCheck className="w-6 h-6 text-gray-400" />
                </View>
                <Text className="text-gray-600">No pending invites</Text>
              </View>
            )}
          </View>
        )}

        {/* Sent Invites */}
        {showInviteType === 'sent' && (
          <View className="space-y-3">
            {sentInvites.length > 0 ? (
              sentInvites.map((invite) => (
                <View key={invite.id} className="bg-white border border-gray-200 rounded-2xl p-4">
                  <View className="flex items-center gap-3 mb-3">
                    <View className="w-10 h-10 bg-gradient-to-br from-orange-400 to-pink-500 rounded-full flex items-center justify-center">
                      <Text className="text-white font-semibold">
                        {invite.toUser.name[0]}
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text className="font-semibold text-gray-900">{invite.sessionName}</Text>
                      <Text className="text-sm text-gray-600">
                        Sent to {invite.toUser.name} • {invite.createdAt}
                      </Text>
                    </View>
                    <View className="flex items-center gap-1 text-xs text-gray-500">
                      <Clock className="w-3 h-3" />
                      <Text>{invite.expiresAt}</Text>
                    </View>
                  </View>

                  <TouchableOpacity 
                    onClick={() => handleCancelInvite(invite.id)}
                    className="w-full border border-red-200 text-red-600 py-2 px-4 rounded-xl font-medium text-sm hover:bg-red-50 transition-colors"
                  >
                    Cancel Invite
                  </TouchableOpacity>
                </View>
              ))
            ) : (
              <View className="text-center py-8">
                <View className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <Send className="w-6 h-6 text-gray-400" />
                </View>
                <Text className="text-gray-600">No sent invites</Text>
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  const renderCreateTab = () => {
    if (createStep === 'details') {
      return (
        <View className="space-y-6">
          <View>
            <Text className="font-bold text-gray-900 mb-2">Session Details</Text>
            <Text className="text-sm text-gray-600 mb-4">
              Give your collaboration session a memorable name
            </Text>
            
            <View className="space-y-4">
              <View>
                <Text style={{ color: '#374151', fontWeight: '500', fontSize: 14, marginBottom: 8 }}>
                  Session Name
                </Text>
                <TextInput
                  value={newSessionName}
                  onChangeText={setNewSessionName}
                  placeholder="e.g., Weekend Adventure Squad"
                  style={{
                    width: '100%',
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderWidth: 1,
                    borderColor: '#e5e7eb',
                    borderRadius: 12,
                    fontSize: 16,
                    backgroundColor: 'white'
                  }}
                />
              </View>
            </View>
          </View>

          {preSelectedFriend && (
            <View className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <Text className="font-medium text-blue-900 mb-2">Pre-selected Friend</Text>
              <View className="flex items-center gap-3">
                <View className="w-8 h-8 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center">
                  <Text className="text-white text-sm font-semibold">
                    {preSelectedFriend.name[0]}
                  </Text>
                </View>
                <Text className="text-blue-800 font-medium flex-1">{preSelectedFriend.name}</Text>
                <TouchableOpacity 
                  onClick={() => {
                    setSelectedFriends(prev => prev.filter(f => f.id !== preSelectedFriend.id));
                  }}
                  className="w-6 h-6 hover:bg-blue-200 rounded-full flex items-center justify-center transition-colors"
                  title="Remove from selection"
                >
                  <X className="w-4 h-4 text-blue-700 hover:text-red-600" />
                </TouchableOpacity>
              </View>
              <Text className="text-xs text-blue-700 mt-2">You can remove this friend or add more friends in the next step</Text>
            </View>
          )}

          <TouchableOpacity
            onClick={() => setCreateStep('friends')}
            disabled={!newSessionName.trim()}
            className="w-full bg-[#eb7825] text-white py-3 px-6 rounded-xl font-semibold hover:bg-[#d6691f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Continue
          </TouchableOpacity>
        </View>
      );
    }

    if (createStep === 'friends') {
      return (
        <View className="space-y-6">
          <View className="flex items-center gap-3">
            <TouchableOpacity 
              onClick={() => setCreateStep('details')}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            </TouchableOpacity>
            <View>
              <Text className="font-bold text-gray-900">Select Friends</Text>
              <Text className="text-sm text-gray-600">
                Choose friends to invite to "{newSessionName}"
                {preSelectedFriend && " • You can modify your selection below"}
              </Text>
            </View>
          </View>

          {/* Selected Friends */}
          {selectedFriends.length > 0 && (
            <View className="bg-orange-50 border border-orange-100 rounded-xl p-4">
              <Text className="font-medium text-gray-900 mb-3">
                Selected Friends ({selectedFriends.length})
              </Text>
              <View className="flex flex-wrap gap-2">
                {selectedFriends.map((friend) => (
                  <View 
                    key={friend.id}
                    className="flex items-center gap-2 bg-white border border-orange-200 rounded-full px-3 py-1"
                  >
                    <View className="w-6 h-6 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center">
                      <Text className="text-white text-xs font-semibold">
                        {friend.name[0]}
                      </Text>
                    </View>
                    <Text className="text-sm font-medium text-gray-700">{friend.name}</Text>
                    <TouchableOpacity 
                      onClick={() => toggleFriendSelection(friend)}
                      className="w-4 h-4 hover:bg-red-100 rounded-full flex items-center justify-center"
                    >
                      <X className="w-3 h-3 text-gray-500 hover:text-red-600" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Friends List */}
          <View className="space-y-2">
            <Text className="font-medium text-gray-900">Available Friends</Text>
            {/* Use availableFriends if provided, otherwise fall back to mockFriends */}
            {(() => {
              const baseFriends = availableFriends.length > 0 ? availableFriends : mockFriends;
              const allFriends = [...baseFriends];
              
              // If there's a preSelectedFriend and it's not in the base friends, add it to the beginning
              if (preSelectedFriend && !baseFriends.some(f => f.id === preSelectedFriend.id)) {
                allFriends.unshift(preSelectedFriend);
              }
              
              return allFriends.map((friend) => {
                const isSelected = selectedFriends.some(f => f.id === friend.id);
                const isPreSelected = preSelectedFriend?.id === friend.id;
                return (
                  <TouchableOpacity
                    key={friend.id}
                    onClick={() => toggleFriendSelection(friend)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                      isSelected
                        ? 'border-[#eb7825] bg-orange-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <View className="w-10 h-10 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center">
                      <Text className="text-white font-semibold">
                        {friend.name[0]}
                      </Text>
                    </View>
                    <View className="flex-1 text-left">
                      <View className="flex items-center gap-2">
                        <Text className="font-medium text-gray-900">{friend.name}</Text>
                        {isPreSelected && (
                          <Text className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                            Pre-selected
                          </Text>
                        )}
                      </View>
                      <View className="flex items-center gap-2 text-sm text-gray-600">
                        <Text>@{(friend.username || friend.name.toLowerCase().replace(' ', ''))}</Text>
                      </View>
                    </View>
                    {isSelected && (
                      <Check className="w-5 h-5 text-[#eb7825]" />
                    )}
                  </TouchableOpacity>
                );
              });
            })()}
          </View>

          <TouchableOpacity
            onClick={() => setCreateStep('confirm')}
            disabled={selectedFriends.length === 0}
            className="w-full bg-[#eb7825] text-white py-3 px-6 rounded-xl font-semibold hover:bg-[#d6691f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Continue ({selectedFriends.length} selected)
          </TouchableOpacity>
        </View>
      );
    }

    if (createStep === 'confirm') {
      return (
        <View className="space-y-6">
          <View className="flex items-center gap-3">
            <TouchableOpacity 
              onClick={() => setCreateStep('friends')}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            </TouchableOpacity>
            <View>
              <Text className="font-bold text-gray-900">Confirm & Send</Text>
              <Text className="text-sm text-gray-600">
                Review your collaboration session details
              </Text>
            </View>
          </View>

          <View className="bg-white border border-gray-200 rounded-2xl p-6 space-y-4">
            <View>
              <Text className="font-semibold text-gray-900 mb-1">Session Name</Text>
              <Text className="text-gray-700">{newSessionName}</Text>
            </View>

            <View>
              <Text className="font-semibold text-gray-900 mb-3">
                Inviting {selectedFriends.length} friend{selectedFriends.length !== 1 ? 's' : ''}
              </Text>
              <View className="space-y-2">
                {selectedFriends.map((friend) => (
                  <View key={friend.id} className="flex items-center gap-3">
                    <View className="w-8 h-8 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center">
                      <Text className="text-white text-sm font-semibold">
                        {friend.name[0]}
                      </Text>
                    </View>
                    <Text className="font-medium text-gray-700">{friend.name}</Text>
                    <View className={`w-2 h-2 rounded-full ${
                      friend.status === 'online' ? 'bg-green-500' : 'bg-gray-400'
                    }`} />
                  </View>
                ))}
              </View>
            </View>
          </View>

          <View className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <View className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
              <View className="text-sm text-blue-800">
                <Text className="font-medium mb-1">Next Steps</Text>
                <Text>
                  Once all friends accept, you'll need to set collaboration preferences together before you can start swiping.
                </Text>
              </View>
            </View>
          </View>

          <TouchableOpacity
            onClick={handleCreateSession}
            className="w-full bg-[#eb7825] text-white py-3 px-6 rounded-xl font-semibold hover:bg-[#d6691f] transition-colors"
          >
            Send Invites
          </TouchableOpacity>
        </View>
      );
    }
  };

  return (
    <View className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
      <View className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md max-h-[90vh] overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between p-6 border-b border-gray-100">
          <View>
            <Text className="text-xl font-bold text-gray-900">Collaboration</Text>
            <Text className="text-sm text-gray-600">Discover experiences together</Text>
          </View>
          <TouchableOpacity 
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-gray-600" />
          </TouchableOpacity>
        </header>

        {/* Tabs */}
        <View className="flex bg-gray-50 p-1 mx-6 mt-4 rounded-xl">
          <TouchableOpacity
            onClick={() => setActiveTab('sessions')}
            className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-all ${
              activeTab === 'sessions'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600'
            }`}
          >
            Sessions
          </TouchableOpacity>
          <TouchableOpacity
            onClick={() => setActiveTab('invites')}
            className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-all relative ${
              activeTab === 'invites'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600'
            }`}
          >
            Invites
            {(mockReceivedInvites.length > 0 || mockSentInvites.length > 0) && (
              <View className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onClick={() => setActiveTab('create')}
            className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-all ${
              activeTab === 'create'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600'
            }`}
          >
            Create
          </TouchableOpacity>
        </View>

        {/* Content */}
        <View className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          {activeTab === 'sessions' && renderSessionsTab()}
          {activeTab === 'invites' && renderInvitesTab()}
          {activeTab === 'create' && renderCreateTab()}
        </View>
      </View>
    </View>
  );
}