import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle } from 'lucide-react';
import {
  ConversationList,
  ChatView,
  NegotiationModal,
  CollaborationDetails,
  Message,
  Collaboration,
  MessagesPageProps
} from './messages';
import {
  loadCollaborationsFromStorage,
  loadSharedExperiences
} from './messages/utils';

export default function MessagesPage({
  currentUserId,
  currentUserType,
  currentUserName,
  hideHeader = false
}: MessagesPageProps) {
  // Core State
  const [collaborations, setCollaborations] = useState<Collaboration[]>([]);
  const [selectedCollaboration, setSelectedCollaboration] = useState<Collaboration | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  
  // UI State
  const [searchQuery, setSearchQuery] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);
  
  // Modal/Sheet State
  const [showCollabDetails, setShowCollabDetails] = useState(false);
  const [showNegotiationModal, setShowNegotiationModal] = useState(false);
  const [proposedCommission, setProposedCommission] = useState('');
  const [proposalReason, setProposalReason] = useState('');
  
  // Shared Data
  const [sharedExperiences, setSharedExperiences] = useState<any[]>([]);
  
  // Refs
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Detect mobile view
  useEffect(() => {
    const checkMobileView = () => {
      setIsMobileView(window.innerWidth < 768);
    };
    checkMobileView();
    window.addEventListener('resize', checkMobileView);
    return () => window.removeEventListener('resize', checkMobileView);
  }, []);

  // Load collaborations
  useEffect(() => {
    loadCollaborations();
    loadUnreadCounts();
    
    const handleStorageChange = () => {
      loadCollaborations();
      loadUnreadCounts();
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [currentUserId, currentUserType]);

  // Load messages when collaboration selected
  useEffect(() => {
    if (selectedCollaboration) {
      loadMessages();
      markMessagesAsRead();
      setSharedExperiences(loadSharedExperiences(selectedCollaboration));
    }
  }, [selectedCollaboration]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  // Load collaborations from storage
  const loadCollaborations = () => {
    const enrichedCollaborations = loadCollaborationsFromStorage(currentUserId, currentUserType);
    setCollaborations(enrichedCollaborations);
  };

  // Load unread counts
  const loadUnreadCounts = () => {
    const counts: Record<string, number> = {};
    
    collaborations.forEach(collab => {
      const storageKey = `collaboration_chat_${collab.id}`;
      const storedMessages = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const unread = storedMessages.filter((m: any) => 
        m.senderId !== currentUserId && !m.read
      ).length;
      counts[collab.id] = unread;
    });

    setUnreadCounts(counts);
  };

  // Load messages for selected collaboration
  const loadMessages = () => {
    if (!selectedCollaboration) return;

    const storageKey = `collaboration_chat_${selectedCollaboration.id}`;
    const stored = localStorage.getItem(storageKey);
    
    if (stored) {
      const parsed = JSON.parse(stored);
      setMessages(parsed.map((m: any) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      })));
    } else {
      // Initialize with welcome message
      const welcomeMessage: Message = {
        id: `welcome_${Date.now()}`,
        senderId: 'system',
        senderName: 'Mingla',
        senderType: currentUserType,
        content: `Welcome to your collaboration chat! Use this space to discuss details about "${selectedCollaboration.experienceName}", negotiate terms, share ideas, and coordinate logistics.`,
        timestamp: new Date(),
        read: true,
        type: 'text',
      };

      const initialMessages = [welcomeMessage];

      // Add negotiation summary if commission is set
      if (selectedCollaboration.commission) {
        const negotiationMessage: Message = {
          id: `negotiation_${Date.now()}`,
          senderId: 'system',
          senderName: 'Mingla',
          senderType: currentUserType,
          content: 'Negotiation Summary',
          timestamp: new Date(new Date().getTime() + 1000),
          read: true,
          type: 'negotiation',
          metadata: {
            finalCommission: selectedCollaboration.commission,
            status: 'accepted',
          },
        };
        initialMessages.push(negotiationMessage);
      }

      setMessages(initialMessages);
      saveMessages(initialMessages);
    }
  };

  // Save messages to storage
  const saveMessages = (msgs: Message[]) => {
    if (!selectedCollaboration) return;
    const storageKey = `collaboration_chat_${selectedCollaboration.id}`;
    localStorage.setItem(storageKey, JSON.stringify(msgs));
  };

  // Mark messages as read
  const markMessagesAsRead = () => {
    if (!selectedCollaboration) return;
    
    setMessages(prev => {
      const updated = prev.map(m => 
        m.senderId !== currentUserId ? { ...m, read: true } : m
      );
      saveMessages(updated);
      return updated;
    });
    
    loadUnreadCounts();
  };

  // Send message handler
  const handleSendMessage = () => {
    if (!newMessage.trim() || !selectedCollaboration) return;

    const message: Message = {
      id: `msg_${Date.now()}`,
      senderId: currentUserId,
      senderName: currentUserName,
      senderType: currentUserType,
      content: newMessage.trim(),
      timestamp: new Date(),
      read: false,
      type: 'text',
    };

    const updatedMessages = [...messages, message];
    setMessages(updatedMessages);
    saveMessages(updatedMessages);
    setNewMessage('');

    // Simulate typing indicator
    setTimeout(() => {
      setIsTyping(true);
      setTimeout(() => setIsTyping(false), 2000);
    }, 1000);

    textareaRef.current?.focus();
  };

  // Key press handler
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Export chat
  const handleExportChat = () => {
    if (!selectedCollaboration) return;

    const chatText = messages.map(m => {
      const time = m.timestamp.toLocaleString();
      if (m.senderId === 'system') {
        return `[${time}] System: ${m.content}`;
      }
      return `[${time}] ${m.senderName}: ${m.content}`;
    }).join('\n\n');

    const blob = new Blob([chatText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mingla-chat-${selectedCollaboration.experienceName.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Tag experience in chat
  const handleTagExperience = (experience: any) => {
    if (!selectedCollaboration) return;

    const experienceMessage: Message = {
      id: `experience_${Date.now()}`,
      senderId: currentUserId,
      senderName: currentUserName,
      senderType: currentUserType,
      content: 'Tagged Experience',
      timestamp: new Date(),
      read: false,
      type: 'experience',
      metadata: {
        experienceId: experience.id,
        experienceName: experience.title || experience.name,
        experiencePrice: experience.price,
        experienceLocation: experience.location,
      },
    };

    const updatedMessages = [...messages, experienceMessage];
    setMessages(updatedMessages);
    saveMessages(updatedMessages);
    textareaRef.current?.focus();
  };

  // Propose commission
  const handleProposeCommission = () => {
    if (!selectedCollaboration || !proposedCommission) return;

    const rate = parseFloat(proposedCommission);
    if (isNaN(rate) || rate < 0 || rate > 50) {
      alert('Please enter a valid commission rate between 0% and 50%');
      return;
    }

    const negotiationMessage: Message = {
      id: `negotiation_proposal_${Date.now()}`,
      senderId: currentUserId,
      senderName: currentUserName,
      senderType: currentUserType,
      content: proposalReason || `Proposing ${rate}% commission rate`,
      timestamp: new Date(),
      read: false,
      type: 'negotiation',
      metadata: {
        proposedCommission: rate,
        status: 'proposed',
      },
    };

    const updatedMessages = [...messages, negotiationMessage];
    setMessages(updatedMessages);
    saveMessages(updatedMessages);

    // Save to negotiation history
    const storageKey = `negotiation_history_${selectedCollaboration.businessId}`;
    const existingHistory = JSON.parse(localStorage.getItem(storageKey) || '[]');
    
    const businessNegotiationMessage = {
      id: Date.now().toString(),
      from: currentUserType,
      fromName: currentUserName,
      message: proposalReason || `I propose a ${rate}% commission rate.`,
      proposedRate: rate,
      timestamp: new Date().toISOString(),
      status: 'pending',
    };
    
    const updatedHistory = [...existingHistory, businessNegotiationMessage];
    localStorage.setItem(storageKey, JSON.stringify(updatedHistory));

    setShowNegotiationModal(false);
    setProposedCommission('');
    setProposalReason('');
    textareaRef.current?.focus();
  };

  // Accept negotiation
  const handleAcceptNegotiation = (messageId: string, commission: number) => {
    const messageIndex = messages.findIndex(m => m.id === messageId);
    if (messageIndex === -1 || !selectedCollaboration) return;

    const updatedMessages = [...messages];
    updatedMessages[messageIndex] = {
      ...updatedMessages[messageIndex],
      metadata: {
        ...updatedMessages[messageIndex].metadata,
        status: 'accepted',
        finalCommission: commission,
      },
    };

    const acceptanceMessage: Message = {
      id: `negotiation_accept_${Date.now()}`,
      senderId: currentUserId,
      senderName: currentUserName,
      senderType: currentUserType,
      content: `Accepted ${commission}% commission rate`,
      timestamp: new Date(),
      read: false,
      type: 'negotiation',
      metadata: {
        finalCommission: commission,
        status: 'accepted',
      },
    };

    updatedMessages.push(acceptanceMessage);
    setMessages(updatedMessages);
    saveMessages(updatedMessages);

    // Update storage records
    updateCommissionInStorage(commission);
  };

  // Reject negotiation
  const handleRejectNegotiation = (messageId: string) => {
    const messageIndex = messages.findIndex(m => m.id === messageId);
    if (messageIndex === -1 || !selectedCollaboration) return;

    const updatedMessages = [...messages];
    updatedMessages[messageIndex] = {
      ...updatedMessages[messageIndex],
      metadata: {
        ...updatedMessages[messageIndex].metadata,
        status: 'rejected',
      },
    };

    const rejectionMessage: Message = {
      id: `negotiation_reject_${Date.now()}`,
      senderId: currentUserId,
      senderName: currentUserName,
      senderType: currentUserType,
      content: 'Declined the commission proposal',
      timestamp: new Date(),
      read: false,
      type: 'negotiation',
      metadata: {
        status: 'rejected',
      },
    };

    updatedMessages.push(rejectionMessage);
    setMessages(updatedMessages);
    saveMessages(updatedMessages);

    // Update negotiation history
    const storageKey = `negotiation_history_${selectedCollaboration.businessId}`;
    const existingHistory = JSON.parse(localStorage.getItem(storageKey) || '[]');
    const updatedHistory = existingHistory.map((msg: any) =>
      msg.id === messageId ? { ...msg, status: 'declined' } : msg
    );
    localStorage.setItem(storageKey, JSON.stringify(updatedHistory));
  };

  // Update commission in storage
  const updateCommissionInStorage = (commission: number) => {
    if (!selectedCollaboration) return;

    // Update collaboration
    const allCollaborations = JSON.parse(localStorage.getItem('collaborations') || '[]');
    const collabIndex = allCollaborations.findIndex((c: any) => c.id === selectedCollaboration.id);
    if (collabIndex !== -1) {
      allCollaborations[collabIndex].commission = commission;
      localStorage.setItem('collaborations', JSON.stringify(allCollaborations));
      
      // Update experience card
      const experienceCards = JSON.parse(localStorage.getItem('experienceCards') || '[]');
      const expIndex = experienceCards.findIndex((e: any) => e.id === selectedCollaboration.experienceId);
      if (expIndex !== -1) {
        experienceCards[expIndex].commission = commission;
        localStorage.setItem('experienceCards', JSON.stringify(experienceCards));
      }

      // Update business record
      const businesses = JSON.parse(localStorage.getItem('mingla_businesses') || '[]');
      const businessIndex = businesses.findIndex((b: any) => b.id === selectedCollaboration.businessId);
      if (businessIndex !== -1) {
        businesses[businessIndex].curatorCommission = commission;
        businesses[businessIndex].commissionStatus = 'approved';
        localStorage.setItem('mingla_businesses', JSON.stringify(businesses));
      }
      
      loadCollaborations();
    }
  };

  // Desktop/Mobile layout logic
  const showChatList = !isMobileView || !selectedCollaboration;
  const showChatView = !isMobileView || selectedCollaboration;

  return (
    <div className={`flex flex-col ${hideHeader ? 'h-full bg-white' : 'h-screen bg-gray-50'}`}>
      {/* Desktop Header */}
      {!isMobileView && !hideHeader && (
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center">
              <MessageCircle className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-gray-900">Messages</h1>
              <p className="text-gray-500 text-sm">
                {collaborations.length} active conversation{collaborations.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Conversation List */}
        {showChatList && (
          <ConversationList
            collaborations={collaborations}
            selectedCollaboration={selectedCollaboration}
            unreadCounts={unreadCounts}
            searchQuery={searchQuery}
            currentUserType={currentUserType}
            isMobileView={isMobileView}
            hideHeader={hideHeader}
            onSelectCollaboration={setSelectedCollaboration}
            onSearchChange={setSearchQuery}
          />
        )}

        {/* Chat View */}
        {showChatView && (
          <ChatView
            selectedCollaboration={selectedCollaboration}
            messages={messages}
            newMessage={newMessage}
            isTyping={isTyping}
            currentUserId={currentUserId}
            currentUserType={currentUserType}
            currentUserName={currentUserName}
            isMobileView={isMobileView}
            sharedExperiences={sharedExperiences}
            onBack={() => setSelectedCollaboration(null)}
            onSendMessage={handleSendMessage}
            onMessageChange={setNewMessage}
            onKeyPress={handleKeyPress}
            onExportChat={handleExportChat}
            onShowCollabDetails={() => setShowCollabDetails(true)}
            onShowNegotiationModal={() => setShowNegotiationModal(true)}
            onShowExperienceTagMenu={() => {}}
            onTagExperience={handleTagExperience}
            onAcceptNegotiation={handleAcceptNegotiation}
            onRejectNegotiation={handleRejectNegotiation}
            textareaRef={textareaRef}
            scrollAreaRef={scrollAreaRef}
          />
        )}
      </div>

      {/* Negotiation Modal */}
      <NegotiationModal
        isOpen={showNegotiationModal}
        proposedCommission={proposedCommission}
        proposalReason={proposalReason}
        onClose={() => setShowNegotiationModal(false)}
        onProposedCommissionChange={setProposedCommission}
        onProposalReasonChange={setProposalReason}
        onSubmit={handleProposeCommission}
      />

      {/* Collaboration Details Sheet */}
      <CollaborationDetails
        isOpen={showCollabDetails}
        collaboration={selectedCollaboration}
        sharedExperiences={sharedExperiences}
        currentUserType={currentUserType}
        onClose={() => setShowCollabDetails(false)}
      />
    </div>
  );
}
