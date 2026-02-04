import React, { useState, useEffect } from 'react';
import {
  FriendsTab,
  MessagesTab,
  TabNavigation,
  Friend,
  Conversation,
  Message,
  TabType,
  ConnectionsPageProps,
  MOCK_FRIENDS,
  generateInitialConversations,
  createConversationsFromFriends,
  getRandomReply,
  formatFileSize,
  markMessagesAsRead,
  getTotalUnreadCount
} from './connections';
import MessageInterface from './MessageInterface';
import AddFriendModal from './AddFriendModal';
import FriendRequestsModal from './FriendRequestsModal';
import AddToBoardModal from './AddToBoardModal';
import ReportUserModal from './ReportUserModal';
import FriendSelectionModal from './FriendSelectionModal';
import BlockListModal from './BlockListModal';

export default function ConnectionsPage({
  currentUser,
  accountPreferences,
  boardsSessions = [],
  currentMode = 'solo',
  onModeChange,
  onUpdateBoardSession,
  onCreateSession,
  onNavigateToBoard,
  friendsList = [],
  initialTab = 'friends'
}: ConnectionsPageProps) {
  // Core state
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [showQRCode, setShowQRCode] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  
  // Messaging state
  const [showFriendSelection, setShowFriendSelection] = useState(false);
  const [activeChat, setActiveChat] = useState<Friend | null>(null);
  const [showMessageInterface, setShowMessageInterface] = useState(false);
  const [conversations, setConversations] = useState<{ [friendId: string]: Message[] }>(
    generateInitialConversations()
  );
  
  // Modal state
  const [showAddFriendModal, setShowAddFriendModal] = useState(false);
  const [showFriendRequests, setShowFriendRequests] = useState(false);
  const [showBlockList, setShowBlockList] = useState(false);
  const [showAddToBoardModal, setShowAddToBoardModal] = useState(false);
  const [selectedFriendForBoard, setSelectedFriendForBoard] = useState<Friend | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [selectedUserToReport, setSelectedUserToReport] = useState<Friend | null>(null);
  
  // Friend management state
  const [mutedFriends, setMutedFriends] = useState<Set<string>>(new Set());
  const [blockedUsers, setBlockedUsers] = useState<Set<string>>(new Set());

  // Update activeTab when initialTab changes (for coach mark tour)
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Use friendsList from props, fallback to mockFriends
  const currentFriends = friendsList.length > 0 ? friendsList : MOCK_FRIENDS;

  // Create conversation objects
  const conversationsList = createConversationsFromFriends(currentFriends);

  // Get unread count
  const unreadCount = getTotalUnreadCount(conversations);

  // Tab handlers
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setShowMessageInterface(false);
    setActiveChat(null);
  };

  // QR Code handler
  const handleToggleQRCode = () => {
    setShowQRCode(!showQRCode);
  };

  // Invite link handler
  const handleCopyInviteLink = () => {
    navigator.clipboard.writeText('https://mingla.app/invite/your-unique-code');
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  // Friend action handlers
  const handleMessageFriend = (friend: Friend) => {
    setActiveChat(friend);
    setShowMessageInterface(true);
    setActiveTab('messages');
    setConversations(prev => markMessagesAsRead(prev, friend.id));
  };

  const handleAddToBoard = (friend: Friend) => {
    setSelectedFriendForBoard(friend);
    setShowAddToBoardModal(true);
  };

  const handleBlockUser = (friend: Friend) => {
    setBlockedUsers(prev => new Set([...prev, friend.id]));
  };

  const handleReportUser = (friend: Friend) => {
    setSelectedUserToReport(friend);
    setShowReportModal(true);
  };

  const handleMuteFriend = (friend: Friend) => {
    setMutedFriends(prev => new Set([...prev, friend.id]));
  };

  const handleUnmuteFriend = (friend: Friend) => {
    setMutedFriends(prev => {
      const next = new Set(prev);
      next.delete(friend.id);
      return next;
    });
  };

  const handleRemoveFriend = (friend: Friend) => {
    console.log('Remove friend:', friend.name);
    // Implement remove logic
  };

  // Conversation handlers
  const handleStartNewConversation = () => {
    setShowFriendSelection(true);
  };

  const handleSelectFriend = (friend: Friend) => {
    setActiveChat(friend);
    setShowFriendSelection(false);
    setShowMessageInterface(true);
    setActiveTab('messages');
    setConversations(prev => markMessagesAsRead(prev, friend.id));
  };

  const handleSelectConversation = (conversation: Conversation) => {
    const friend = conversation.participants[0];
    if (friend) {
      handleSelectFriend(friend);
    }
  };

  const handleBackFromMessage = () => {
    setShowMessageInterface(false);
    setActiveChat(null);
  };

  const handleSendMessage = (content: string, type: 'text' | 'image' | 'video' | 'file', file?: File) => {
    if (!activeChat) return;

    const newMessage: Message = {
      id: `msg-${Date.now()}`,
      senderId: 'me',
      senderName: 'Me',
      content,
      timestamp: new Date().toISOString(),
      type,
      isMe: true
    };

    // Handle file messages
    if (file && type !== 'text') {
      newMessage.fileName = file.name;
      newMessage.fileSize = formatFileSize(file.size);
      newMessage.fileUrl = URL.createObjectURL(file);
    }

    // Add message to conversation
    setConversations(prev => ({
      ...prev,
      [activeChat.id]: [...(prev[activeChat.id] || []), newMessage]
    }));

    // Simulate friend reply after 2-3 seconds
    setTimeout(() => {
      const replyMessage: Message = {
        id: `msg-${Date.now()}-reply`,
        senderId: activeChat.id,
        senderName: activeChat.name,
        content: getRandomReply(),
        timestamp: new Date().toISOString(),
        type: 'text',
        isMe: false,
        unread: true
      };

      setConversations(prev => ({
        ...prev,
        [activeChat.id]: [...(prev[activeChat.id] || []), replyMessage]
      }));
    }, 2000 + Math.random() * 1000);
  };

  // Report modal handler
  const handleReportSubmit = (reason: string, details: string) => {
    console.log('Report submitted:', { user: selectedUserToReport, reason, details });
    setShowReportModal(false);
    setSelectedUserToReport(null);
  };

  return (
    <>
      <div className="h-full overflow-y-auto bg-gray-50">
        <div className="max-w-2xl mx-auto">
          
          {/* Tab Navigation */}
          <TabNavigation
            activeTab={activeTab}
            onTabChange={handleTabChange}
            unreadCount={unreadCount}
          />

          {/* Tab Content */}
          <div className="pb-6">
            {/* Show message interface or tab content */}
            {showMessageInterface && activeChat ? (
              <MessageInterface
                friend={activeChat}
                messages={conversations[activeChat.id] || []}
                onBack={handleBackFromMessage}
                onSendMessage={handleSendMessage}
                availableFriends={currentFriends}
                accountPreferences={accountPreferences}
                boardsSessions={boardsSessions}
                currentMode={currentMode}
                onModeChange={onModeChange}
                onUpdateBoardSession={onUpdateBoardSession}
                onCreateSession={onCreateSession}
                onNavigateToBoard={onNavigateToBoard}
              />
            ) : (
              <>
                {/* Friends Tab */}
                {activeTab === 'friends' && (
                  <FriendsTab
                    friends={currentFriends}
                    onAddFriend={() => setShowAddFriendModal(true)}
                    onShowRequests={() => setShowFriendRequests(true)}
                    onShowBlockList={() => setShowBlockList(true)}
                    onToggleQRCode={handleToggleQRCode}
                    showQRCode={showQRCode}
                    inviteCopied={inviteCopied}
                    onCopyInviteLink={handleCopyInviteLink}
                    onMessageFriend={handleMessageFriend}
                    onAddToBoard={handleAddToBoard}
                    onBlockUser={handleBlockUser}
                    onReportUser={handleReportUser}
                    onMuteFriend={handleMuteFriend}
                    onUnmuteFriend={handleUnmuteFriend}
                    onRemoveFriend={handleRemoveFriend}
                    mutedFriends={mutedFriends}
                  />
                )}

                {/* Messages Tab */}
                {activeTab === 'messages' && (
                  <MessagesTab
                    conversations={conversationsList}
                    onSelectConversation={handleSelectConversation}
                    onStartNewConversation={handleStartNewConversation}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      <FriendSelectionModal
        isOpen={showFriendSelection}
        onClose={() => setShowFriendSelection(false)}
        friends={currentFriends}
        onSelectFriend={handleSelectFriend}
      />

      <AddFriendModal
        isOpen={showAddFriendModal}
        onClose={() => setShowAddFriendModal(false)}
      />

      <FriendRequestsModal
        isOpen={showFriendRequests}
        onClose={() => setShowFriendRequests(false)}
      />

      <BlockListModal
        isOpen={showBlockList}
        onClose={() => setShowBlockList(false)}
        blockedUsers={blockedUsers}
        onUnblockUser={(userId: string) => {
          setBlockedUsers(prev => {
            const next = new Set(prev);
            next.delete(userId);
            return next;
          });
        }}
      />

      {showAddToBoardModal && selectedFriendForBoard && (
        <AddToBoardModal
          isOpen={showAddToBoardModal}
          onClose={() => {
            setShowAddToBoardModal(false);
            setSelectedFriendForBoard(null);
          }}
          friend={selectedFriendForBoard}
          boards={boardsSessions || []}
        />
      )}

      {showReportModal && selectedUserToReport && (
        <ReportUserModal
          isOpen={showReportModal}
          onClose={() => {
            setShowReportModal(false);
            setSelectedUserToReport(null);
          }}
          user={{
            id: selectedUserToReport.id,
            name: selectedUserToReport.name,
            username: selectedUserToReport.username
          }}
          onReport={handleReportSubmit}
        />
      )}
    </>
  );
}