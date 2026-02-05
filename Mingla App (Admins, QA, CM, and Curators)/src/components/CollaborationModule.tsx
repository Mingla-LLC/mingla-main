import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import {
  SessionsTab,
  InvitesTab,
  CreateTab,
  CollaborationModuleProps,
  Friend,
  ActiveTab,
  CreateStep,
  InviteType
} from './collaboration';
import {
  MOCK_FRIENDS,
  MOCK_SENT_INVITES,
  MOCK_RECEIVED_INVITES,
  MOCK_ACTIVE_SESSIONS
} from './collaboration/constants';
import { useCoachMark } from './CoachMark/CoachMarkProvider';
import { coachMarkSteps } from './CoachMark/coachMarkSteps';

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
  // State
  const [activeTab, setActiveTab] = useState<ActiveTab>('sessions');
  const [createStep, setCreateStep] = useState<CreateStep>('details');
  const [newSessionName, setNewSessionName] = useState('');
  const [selectedFriends, setSelectedFriends] = useState<Friend[]>(
    preSelectedFriend ? [preSelectedFriend] : []
  );
  const [showInviteType, setShowInviteType] = useState<InviteType>('received');
  
  // Coach mark integration
  const { state: coachMarkState } = useCoachMark();
  const isCoachMarkActive = coachMarkState.isActive;
  const currentStep = coachMarkSteps[coachMarkState.currentStep];
  const isOnCollabStep = currentStep?.requiresModal === 'collaboration';
  
  // Auto-switch tabs based on coach mark step
  useEffect(() => {
    if (isOnCollabStep && currentStep) {
      if (currentStep.id === 'collaboration-create') {
        setActiveTab('create');
      } else if (currentStep.id === 'collaboration-invites') {
        setActiveTab('invites');
      } else if (currentStep.id === 'collaboration-sessions') {
        setActiveTab('sessions');
      }
    }
  }, [isOnCollabStep, currentStep?.id]);

  // Reset create flow when tab changes
  useEffect(() => {
    if (activeTab !== 'create') {
      setCreateStep('details');
      setNewSessionName('');
      if (!preSelectedFriend) {
        setSelectedFriends([]);
      }
    }
  }, [activeTab, preSelectedFriend]);

  // Auto-navigate to create tab if pre-selected friend
  useEffect(() => {
    if (preSelectedFriend && isOpen) {
      setActiveTab('create');
      setSelectedFriends([preSelectedFriend]);
    }
  }, [preSelectedFriend, isOpen]);

  // Update selectedFriends when preSelectedFriend changes
  useEffect(() => {
    if (preSelectedFriend) {
      setSelectedFriends(prev => {
        const isAlreadySelected = prev.some(f => f.id === preSelectedFriend.id);
        if (!isAlreadySelected) {
          return [preSelectedFriend, ...prev.filter(f => f.id !== preSelectedFriend.id)];
        }
        return prev;
      });
    }
  }, [preSelectedFriend]);

  // Handlers
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
      createdBy: 'you',
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      status: 'pending',
      pendingParticipants: selectedFriends.length,
      totalParticipants: selectedFriends.length + 1,
      boardCards: 0
    };

    if (onCreateSession) {
      onCreateSession(newSession);
    }

    // Switch to the new session
    onModeChange(newSession.name);

    // Reset form
    setNewSessionName('');
    setSelectedFriends([]);
    setCreateStep('details');
    setActiveTab('sessions');
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

  const handleAcceptInvite = (inviteId: string) => {
    console.log('Accepting invite:', inviteId);
    // TODO: Implement invite acceptance logic
  };

  const handleDeclineInvite = (inviteId: string) => {
    console.log('Declining invite:', inviteId);
    // TODO: Implement invite decline logic
  };

  const handleCancelInvite = (inviteId: string) => {
    console.log('Canceling invite:', inviteId);
    // TODO: Implement invite cancellation logic
  };

  const handleGoBack = () => {
    if (createStep === 'friends') {
      setCreateStep('details');
    } else if (createStep === 'confirm') {
      setCreateStep('friends');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[10000] p-4 fade-in">
      <div className="glass-card rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl spring-in border border-white/30">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200/50 glass-nav rounded-t-2xl">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Collaboration Mode</h2>
            <p className="text-sm text-gray-600 mt-1">
              {activeTab === 'sessions' && 'Manage your active sessions'}
              {activeTab === 'invites' && 'View pending invitations'}
              {activeTab === 'create' && 'Create a new session'}
            </p>
          </div>
          <button
            onClick={() => {
              // Prevent closing during coach mark tour
              if (!isOnCollabStep) {
                onClose();
              }
            }}
            className="w-10 h-10 flex items-center justify-center rounded-lg glass-button transition-smooth hover:scale-110 active:scale-95 shadow-md"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 glass-badge bg-gray-50/50 p-2 border-b border-gray-200/50">
          <button
            onClick={() => !isOnCollabStep && setActiveTab('sessions')}
            data-coachmark="collab-tab-sessions"
            className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-smooth hover:scale-105 active:scale-95 ${
              activeTab === 'sessions'
                ? 'bg-white text-gray-900 shadow-md'
                : 'text-gray-600 hover:bg-white/50'
            }`}
          >
            Sessions
          </button>
          <button
            onClick={() => !isOnCollabStep && setActiveTab('invites')}
            data-coachmark="collab-tab-invites"
            className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-smooth relative hover:scale-105 active:scale-95 ${
              activeTab === 'invites'
                ? 'bg-white text-gray-900 shadow-md'
                : 'text-gray-600 hover:bg-white/50'
            }`}
          >
            Invites
            {(MOCK_RECEIVED_INVITES.length > 0 || MOCK_SENT_INVITES.length > 0) && (
              <div className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full pulse-notification shadow-sm" />
            )}
          </button>
          <button
            onClick={() => !isOnCollabStep && setActiveTab('create')}
            data-coachmark="collab-tab-create"
            className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-smooth ${
              activeTab === 'create'
                ? 'bg-white text-gray-900 shadow-md'
                : 'text-gray-600 hover:bg-white/50'
            }`}
          >
            Create
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          {activeTab === 'sessions' && (
            <SessionsTab
              currentMode={currentMode}
              sessions={MOCK_ACTIVE_SESSIONS}
              boardsSessions={boardsSessions}
              onModeChange={onModeChange}
              onNavigateToBoard={onNavigateToBoard}
            />
          )}

          {activeTab === 'invites' && (
            <InvitesTab
              sentInvites={MOCK_SENT_INVITES}
              receivedInvites={MOCK_RECEIVED_INVITES}
              showInviteType={showInviteType}
              onShowInviteTypeChange={setShowInviteType}
              onAcceptInvite={handleAcceptInvite}
              onDeclineInvite={handleDeclineInvite}
              onCancelInvite={handleCancelInvite}
            />
          )}

          {activeTab === 'create' && (
            <CreateTab
              createStep={createStep}
              newSessionName={newSessionName}
              selectedFriends={selectedFriends}
              availableFriends={availableFriends.length > 0 ? availableFriends : MOCK_FRIENDS}
              preSelectedFriend={preSelectedFriend}
              onCreateStepChange={setCreateStep}
              onSessionNameChange={setNewSessionName}
              onToggleFriend={toggleFriendSelection}
              onCreateSession={handleCreateSession}
              onGoBack={handleGoBack}
            />
          )}
        </div>
      </div>
    </div>
  );
}