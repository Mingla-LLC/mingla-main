import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, Paperclip, Image as ImageIcon, Search, Pin, MoreVertical,
  X, Tag, Ticket, FileText, AlertCircle, Check, Hash, User,
  Calendar, Clock, ChevronDown, Filter, Archive, Circle, Shield,
  MessageCircle, Users, UserCheck
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner@2.0.3';

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: 'qa' | 'admin';
  message: string;
  timestamp: Date;
  isPinned?: boolean;
  tags?: {
    type: 'ticket' | 'experience' | 'topic';
    id?: string;
    label: string;
    color?: string;
  }[];
  attachments?: {
    name: string;
    url: string;
    type: string;
  }[];
  readBy?: string[];
}

interface Conversation {
  userId: string;
  userName: string;
  userRole: 'qa' | 'admin';
  userEmail: string;
  lastMessage?: string;
  lastMessageTime?: Date;
  unreadCount: number;
  online: boolean;
}

interface QAAdminChatProps {
  currentUserRole: 'qa' | 'admin';
  currentUserEmail: string;
  currentUserName: string;
}

export default function QAAdminChat({ 
  currentUserRole, 
  currentUserEmail, 
  currentUserName 
}: QAAdminChatProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showTagModal, setShowTagModal] = useState(false);
  const [selectedTags, setSelectedTags] = useState<any[]>([]);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const [conversationSearch, setConversationSearch] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Available tickets and experiences for tagging
  const [availableTickets, setAvailableTickets] = useState<any[]>([]);
  const [availableExperiences, setAvailableExperiences] = useState<any[]>([]);

  // Common platform topics
  const platformTopics = [
    { id: 'support', label: 'Support Issues', color: 'blue' },
    { id: 'moderation', label: 'Content Moderation', color: 'purple' },
    { id: 'policy', label: 'Policy Violation', color: 'red' },
    { id: 'technical', label: 'Technical Issue', color: 'orange' },
    { id: 'feature', label: 'Feature Request', color: 'green' },
    { id: 'urgent', label: 'Urgent', color: 'red' },
    { id: 'api-content', label: 'API Content', color: 'indigo' },
    { id: 'user-report', label: 'User Report', color: 'yellow' },
    { id: 'payment', label: 'Payment Issue', color: 'emerald' },
    { id: 'general', label: 'General Discussion', color: 'gray' }
  ];

  // Mock users - in production, fetch from user database
  const allQAManagers = [
    { email: 'sam.qa@mingla.com', name: 'Sam QA', role: 'qa' as const, online: true },
    { email: 'alex.qa@mingla.com', name: 'Alex Chen', role: 'qa' as const, online: true },
    { email: 'jordan.qa@mingla.com', name: 'Jordan Smith', role: 'qa' as const, online: false },
    { email: 'taylor.qa@mingla.com', name: 'Taylor Johnson', role: 'qa' as const, online: true },
  ];

  const allAdmins = [
    { email: 'admin@mingla.com', name: 'Admin Team', role: 'admin' as const, online: true },
    { email: 'sarah.admin@mingla.com', name: 'Sarah Admin', role: 'admin' as const, online: true },
    { email: 'mike.admin@mingla.com', name: 'Mike Admin', role: 'admin' as const, online: false },
  ];

  // Load conversations and data
  useEffect(() => {
    // Determine who to show in conversation list
    const otherUsers = currentUserRole === 'admin' ? allQAManagers : allAdmins;
    
    // Build conversation list
    const convos: Conversation[] = otherUsers.map(user => {
      const conversationKey = getConversationKey(currentUserEmail, user.email);
      const messages = JSON.parse(localStorage.getItem(conversationKey) || '[]');
      const unreadMessages = messages.filter((msg: any) => 
        msg.senderId === user.email && !msg.readBy?.includes(currentUserEmail)
      );

      return {
        userId: user.email,
        userName: user.name,
        userRole: user.role,
        userEmail: user.email,
        lastMessage: messages[messages.length - 1]?.message,
        lastMessageTime: messages[messages.length - 1] ? new Date(messages[messages.length - 1].timestamp) : undefined,
        unreadCount: unreadMessages.length,
        online: user.online,
      };
    });

    // Sort by last message time
    convos.sort((a, b) => {
      if (!a.lastMessageTime && !b.lastMessageTime) return 0;
      if (!a.lastMessageTime) return 1;
      if (!b.lastMessageTime) return -1;
      return b.lastMessageTime.getTime() - a.lastMessageTime.getTime();
    });

    setConversations(convos);

    // Auto-select first conversation if none selected
    if (!selectedConversation && convos.length > 0) {
      setSelectedConversation(convos[0]);
    }

    // Load tickets and experiences
    const tickets = JSON.parse(localStorage.getItem('supportTickets') || '[]');
    setAvailableTickets(tickets);

    const experiences = JSON.parse(localStorage.getItem('platformCards') || '[]');
    setAvailableExperiences(experiences);
  }, []);

  // Load messages when conversation changes
  useEffect(() => {
    if (selectedConversation) {
      const conversationKey = getConversationKey(currentUserEmail, selectedConversation.userEmail);
      const storedMessages = localStorage.getItem(conversationKey);
      
      if (storedMessages) {
        const parsed = JSON.parse(storedMessages);
        setChatMessages(parsed.map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp)
        })));

        // Mark messages as read
        markMessagesAsRead(conversationKey);
      } else {
        // Create welcome message for new conversation
        const welcomeMessage: ChatMessage = {
          id: '1',
          senderId: selectedConversation.userEmail,
          senderName: selectedConversation.userName,
          senderRole: selectedConversation.userRole,
          message: `Hi! I'm ${selectedConversation.userName}. Feel free to reach out about any support issues, platform questions, or urgent matters. 👋`,
          timestamp: new Date(),
          isPinned: false,
          readBy: [currentUserEmail],
        };
        setChatMessages([welcomeMessage]);
        localStorage.setItem(conversationKey, JSON.stringify([welcomeMessage]));
      }
    }
  }, [selectedConversation]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (!showSearch && !filterTag) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, showSearch, filterTag]);

  // Get conversation key for localStorage
  const getConversationKey = (user1: string, user2: string) => {
    const sorted = [user1, user2].sort();
    return `qaAdminChat_${sorted[0]}_${sorted[1]}`;
  };

  // Mark messages as read
  const markMessagesAsRead = (conversationKey: string) => {
    const messages = JSON.parse(localStorage.getItem(conversationKey) || '[]');
    const updated = messages.map((msg: any) => ({
      ...msg,
      readBy: msg.readBy?.includes(currentUserEmail) 
        ? msg.readBy 
        : [...(msg.readBy || []), currentUserEmail]
    }));
    localStorage.setItem(conversationKey, JSON.stringify(updated));

    // Update conversation unread count
    setConversations(convos => 
      convos.map(c => 
        c.userEmail === selectedConversation?.userEmail 
          ? { ...c, unreadCount: 0 }
          : c
      )
    );
  };

  // Save messages
  const saveMessages = (messages: ChatMessage[]) => {
    if (selectedConversation) {
      const conversationKey = getConversationKey(currentUserEmail, selectedConversation.userEmail);
      localStorage.setItem(conversationKey, JSON.stringify(messages));
      setChatMessages(messages);

      // Update conversation list
      setConversations(convos =>
        convos.map(c =>
          c.userEmail === selectedConversation.userEmail
            ? {
                ...c,
                lastMessage: messages[messages.length - 1]?.message,
                lastMessageTime: messages[messages.length - 1]?.timestamp,
              }
            : c
        ).sort((a, b) => {
          if (!a.lastMessageTime && !b.lastMessageTime) return 0;
          if (!a.lastMessageTime) return 1;
          if (!b.lastMessageTime) return -1;
          return b.lastMessageTime.getTime() - a.lastMessageTime.getTime();
        })
      );
    }
  };

  // Send message
  const handleSendMessage = () => {
    if (!newMessage.trim() && selectedTags.length === 0) return;
    if (!selectedConversation) return;

    const message: ChatMessage = {
      id: Date.now().toString(),
      senderId: currentUserEmail,
      senderName: currentUserName,
      senderRole: currentUserRole,
      message: newMessage,
      timestamp: new Date(),
      tags: selectedTags.length > 0 ? selectedTags : undefined,
      readBy: [currentUserEmail],
    };

    const updatedMessages = [...chatMessages, message];
    saveMessages(updatedMessages);
    setNewMessage('');
    setSelectedTags([]);
    toast.success('Message sent');

    // Simulate other user typing for demo
    if (Math.random() > 0.3) {
      setTimeout(() => {
        setIsTyping(true);
        setTimeout(() => {
          const replies = [
            'Thanks for the heads up! I\'ll look into this right away.',
            'Got it, reviewing now.',
            'Understood. I\'ll handle this.',
            'Perfect, I\'ll take care of it.',
            'On it! Will update you shortly.',
          ];
          const reply: ChatMessage = {
            id: (Date.now() + 1).toString(),
            senderId: selectedConversation.userEmail,
            senderName: selectedConversation.userName,
            senderRole: selectedConversation.userRole,
            message: replies[Math.floor(Math.random() * replies.length)],
            timestamp: new Date(),
            readBy: [selectedConversation.userEmail],
          };
          const withReply = [...updatedMessages, reply];
          saveMessages(withReply);
          setIsTyping(false);
        }, 2000);
      }, 500);
    }
  };

  // Pin/unpin message
  const togglePin = (messageId: string) => {
    const updated = chatMessages.map(msg =>
      msg.id === messageId ? { ...msg, isPinned: !msg.isPinned } : msg
    );
    saveMessages(updated);
    toast.success(updated.find(m => m.id === messageId)?.isPinned ? 'Message pinned' : 'Message unpinned');
  };

  // Add tag
  const addTag = (tag: any) => {
    if (selectedTags.some(t => t.label === tag.label)) {
      setSelectedTags(selectedTags.filter(t => t.label !== tag.label));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  // Tag helpers
  const tagTicket = (ticket: any) => {
    const tag = {
      type: 'ticket' as const,
      id: ticket.id,
      label: `Ticket #${ticket.id.slice(0, 6)}: ${ticket.subject}`,
      color: 'blue'
    };
    addTag(tag);
    setShowTagModal(false);
  };

  const tagExperience = (experience: any) => {
    const tag = {
      type: 'experience' as const,
      id: experience.id,
      label: experience.title,
      color: 'purple'
    };
    addTag(tag);
    setShowTagModal(false);
  };

  const tagTopic = (topic: any) => {
    const tag = {
      type: 'topic' as const,
      label: topic.label,
      color: topic.color
    };
    addTag(tag);
    setShowTagModal(false);
  };

  // Filter messages
  const filteredMessages = chatMessages.filter(msg => {
    if (showPinnedOnly && !msg.isPinned) return false;
    if (filterTag && !msg.tags?.some(t => t.label === filterTag)) return false;
    if (searchQuery) {
      const searchLower = searchQuery.toLowerCase();
      return (
        msg.message.toLowerCase().includes(searchLower) ||
        msg.senderName.toLowerCase().includes(searchLower) ||
        msg.tags?.some(t => t.label.toLowerCase().includes(searchLower))
      );
    }
    return true;
  });

  // Get pinned messages
  const pinnedMessages = chatMessages.filter(msg => msg.isPinned);

  // Filter conversations
  const filteredConversations = conversations.filter(conv =>
    !conversationSearch ||
    conv.userName.toLowerCase().includes(conversationSearch.toLowerCase()) ||
    conv.userEmail.toLowerCase().includes(conversationSearch.toLowerCase())
  );

  // Get tag color
  const getTagColor = (color?: string) => {
    switch (color) {
      case 'blue': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'purple': return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'red': return 'bg-red-100 text-red-700 border-red-200';
      case 'orange': return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'green': return 'bg-green-100 text-green-700 border-green-200';
      case 'indigo': return 'bg-indigo-100 text-indigo-700 border-indigo-200';
      case 'yellow': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'emerald': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  // Total unread count
  const totalUnreadCount = conversations.reduce((sum, conv) => sum + conv.unreadCount, 0);

  return (
    <div className="flex h-full bg-gray-50">
      {/* Conversation List Sidebar */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
        {/* Sidebar Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-gray-900">
                {currentUserRole === 'admin' ? 'QA Managers' : 'Admin Team'}
              </h3>
              <p className="text-xs text-gray-500">
                {conversations.length} conversation{conversations.length !== 1 ? 's' : ''}
                {totalUnreadCount > 0 && ` • ${totalUnreadCount} unread`}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                <Circle className="w-2 h-2 fill-green-500 mr-1" />
                Online
              </Badge>
            </div>
          </div>

          {/* Conversation Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search people..."
              value={conversationSearch}
              onChange={(e) => setConversationSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto">
          {filteredConversations.length === 0 ? (
            <div className="text-center py-8 px-4">
              <Users className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No conversations found</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredConversations.map((conv) => (
                <button
                  key={conv.userId}
                  onClick={() => setSelectedConversation(conv)}
                  className={`w-full p-4 text-left hover:bg-gray-50 transition-colors ${
                    selectedConversation?.userId === conv.userId 
                      ? 'bg-gradient-to-r from-[#eb7825]/10 to-[#d6691f]/10 border-l-4 border-[#eb7825]' 
                      : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    <div className="relative flex-shrink-0">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        conv.userRole === 'admin'
                          ? 'bg-gray-900 text-white'
                          : 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white'
                      }`}>
                        {conv.userName.charAt(0)}
                      </div>
                      {conv.online && (
                        <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className={`text-sm truncate ${
                          conv.unreadCount > 0 ? 'text-gray-900' : 'text-gray-700'
                        }`}>
                          {conv.userName}
                        </p>
                        {conv.lastMessageTime && (
                          <span className="text-xs text-gray-400 ml-2 flex-shrink-0">
                            {formatTime(conv.lastMessageTime)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <p className={`text-xs truncate ${
                          conv.unreadCount > 0 ? 'text-gray-900' : 'text-gray-500'
                        }`}>
                          {conv.lastMessage || 'No messages yet'}
                        </p>
                        {conv.unreadCount > 0 && (
                          <Badge className="ml-2 bg-[#eb7825] text-white text-xs px-2 py-0 min-w-[20px] h-5 flex items-center justify-center">
                            {conv.unreadCount}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      {!selectedConversation ? (
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <MessageCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-gray-900 mb-2">Select a conversation</h3>
            <p className="text-gray-500 text-sm">
              Choose someone from the list to start chatting
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          {/* Chat Header */}
          <div className="bg-white border-b border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    selectedConversation.userRole === 'admin'
                      ? 'bg-gray-900 text-white'
                      : 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white'
                  }`}>
                    {selectedConversation.userName.charAt(0)}
                  </div>
                  {selectedConversation.online && (
                    <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full" />
                  )}
                </div>
                <div>
                  <h2 className="text-gray-900 text-lg">{selectedConversation.userName}</h2>
                  <p className="text-sm text-gray-500">
                    {selectedConversation.online ? (
                      <span className="flex items-center gap-1">
                        <Circle className="w-2 h-2 fill-green-500 text-green-500" />
                        Online
                      </span>
                    ) : (
                      'Offline'
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => setShowPinnedOnly(!showPinnedOnly)}
                  variant="outline"
                  size="sm"
                  className={showPinnedOnly ? 'bg-[#eb7825]/10 border-[#eb7825] text-[#eb7825]' : ''}
                >
                  <Pin className="w-4 h-4 mr-2" />
                  Pinned ({pinnedMessages.length})
                </Button>
                <Button
                  onClick={() => setShowSearch(!showSearch)}
                  variant="outline"
                  size="sm"
                  className={showSearch ? 'bg-[#eb7825]/10 border-[#eb7825] text-[#eb7825]' : ''}
                >
                  <Search className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Search Bar */}
            <AnimatePresence>
              {showSearch && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-4"
                >
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      placeholder="Search messages, tags, or users..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Active Filters */}
            {(filterTag || showPinnedOnly || searchQuery) && (
              <div className="mt-4 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500">Active filters:</span>
                {showPinnedOnly && (
                  <Badge
                    variant="outline"
                    className="bg-[#eb7825]/10 text-[#eb7825] border-[#eb7825]/20 cursor-pointer"
                    onClick={() => setShowPinnedOnly(false)}
                  >
                    Pinned Only <X className="w-3 h-3 ml-1" />
                  </Badge>
                )}
                {filterTag && (
                  <Badge
                    variant="outline"
                    className="bg-purple-100 text-purple-700 border-purple-200 cursor-pointer"
                    onClick={() => setFilterTag(null)}
                  >
                    {filterTag} <X className="w-3 h-3 ml-1" />
                  </Badge>
                )}
                {searchQuery && (
                  <Badge
                    variant="outline"
                    className="bg-blue-100 text-blue-700 border-blue-200 cursor-pointer"
                    onClick={() => setSearchQuery('')}
                  >
                    Search: "{searchQuery}" <X className="w-3 h-3 ml-1" />
                  </Badge>
                )}
                <button
                  onClick={() => {
                    setFilterTag(null);
                    setShowPinnedOnly(false);
                    setSearchQuery('');
                  }}
                  className="text-xs text-gray-500 hover:text-gray-700 ml-2"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>

          {/* Pinned Messages Banner */}
          {pinnedMessages.length > 0 && !showPinnedOnly && (
            <div className="bg-amber-50 border-b border-amber-200 px-6 py-3">
              <div className="flex items-start gap-3">
                <Pin className="w-4 h-4 text-amber-600 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-amber-900 text-sm mb-2">Pinned Messages ({pinnedMessages.length})</p>
                  {pinnedMessages.slice(0, 2).map(msg => (
                    <div key={msg.id} className="bg-white rounded-lg p-2 mb-2 last:mb-0">
                      <p className="text-xs text-gray-600 line-clamp-1">{msg.message}</p>
                    </div>
                  ))}
                </div>
                <Button
                  onClick={() => setShowPinnedOnly(true)}
                  size="sm"
                  variant="outline"
                  className="text-amber-700 border-amber-300 hover:bg-amber-100"
                >
                  View All
                </Button>
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50">
            {filteredMessages.length === 0 ? (
              <div className="text-center py-12">
                <Search className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">
                  {searchQuery || filterTag || showPinnedOnly 
                    ? 'No messages match your filters'
                    : 'No messages yet. Start the conversation!'}
                </p>
              </div>
            ) : (
              <>
                {filteredMessages.map((msg) => {
                  const isOwnMessage = msg.senderId === currentUserEmail;
                  
                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[75%] ${isOwnMessage ? 'order-2' : 'order-1'}`}>
                        {/* Message Header */}
                        <div className={`flex items-center gap-2 mb-1 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs ${
                            msg.senderRole === 'admin'
                              ? 'bg-gray-900 text-white' 
                              : 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white'
                          }`}>
                            {msg.senderName.charAt(0)}
                          </div>
                          <span className="text-xs text-gray-600">{msg.senderName}</span>
                          <span className="text-xs text-gray-400">
                            {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {msg.isPinned && (
                            <Pin className="w-3 h-3 text-amber-600 fill-amber-600" />
                          )}
                          <button
                            onClick={() => togglePin(msg.id)}
                            className="text-gray-400 hover:text-gray-600 ml-1"
                          >
                            <MoreVertical className="w-3 h-3" />
                          </button>
                        </div>

                        {/* Message Content */}
                        <div className={`rounded-2xl px-4 py-3 ${
                          isOwnMessage
                            ? msg.senderRole === 'admin'
                              ? 'bg-gray-900 text-white'
                              : 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white'
                            : 'bg-white text-gray-900 border border-gray-200'
                        }`}>
                          <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                        </div>

                        {/* Tags */}
                        {msg.tags && msg.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {msg.tags.map((tag, idx) => (
                              <button
                                key={idx}
                                onClick={() => setFilterTag(tag.label)}
                                className={`text-xs px-2 py-1 rounded-full border ${getTagColor(tag.color)} hover:shadow-sm transition-all`}
                              >
                                {tag.type === 'ticket' && <Ticket className="w-3 h-3 inline mr-1" />}
                                {tag.type === 'experience' && <FileText className="w-3 h-3 inline mr-1" />}
                                {tag.type === 'topic' && <Hash className="w-3 h-3 inline mr-1" />}
                                {tag.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
                {isTyping && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3">
                      <div className="flex gap-1">
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </>
            )}
          </div>

          {/* Message Input */}
          <div className="bg-white border-t border-gray-200 px-6 py-4">
            {/* Selected Tags Preview */}
            {selectedTags.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {selectedTags.map((tag, idx) => (
                  <Badge
                    key={idx}
                    variant="outline"
                    className={getTagColor(tag.color)}
                  >
                    {tag.type === 'ticket' && <Ticket className="w-3 h-3 mr-1" />}
                    {tag.type === 'experience' && <FileText className="w-3 h-3 mr-1" />}
                    {tag.type === 'topic' && <Hash className="w-3 h-3 mr-1" />}
                    {tag.label}
                    <button onClick={() => setSelectedTags(selectedTags.filter((_, i) => i !== idx))}>
                      <X className="w-3 h-3 ml-1" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {/* Input Area */}
            <div className="flex gap-2">
              <Textarea
                placeholder="Type your message... (Use tags to reference tickets, experiences, or topics)"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                className="flex-1 min-h-[60px] max-h-[120px] resize-none"
              />
              <div className="flex flex-col gap-2">
                <Button
                  onClick={() => setShowTagModal(true)}
                  variant="outline"
                  size="sm"
                  title="Add tags"
                >
                  <Tag className="w-4 h-4" />
                </Button>
                <Button
                  onClick={handleSendMessage}
                  className="bg-gradient-to-r from-[#eb7825] to-[#d6691f] hover:from-[#d6691f] hover:to-[#eb7825]"
                  size="sm"
                  disabled={!newMessage.trim() && selectedTags.length === 0}
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <p className="text-xs text-gray-500 mt-2">
              💡 Use tags to link tickets, experiences, or topics • Shift+Enter for new line • Enter to send
            </p>
          </div>
        </div>
      )}

      {/* Tag Selection Modal */}
      <AnimatePresence>
        {showTagModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-50"
              onClick={() => setShowTagModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
                {/* Modal Header */}
                <div className="p-6 border-b border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-gray-900 text-lg">Add Tags to Message</h3>
                    <button
                      onClick={() => setShowTagModal(false)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <p className="text-gray-500 text-sm">
                    Tag tickets, experiences, or topics to provide context
                  </p>
                </div>

                {/* Modal Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {/* Platform Topics */}
                  <div>
                    <h4 className="text-gray-900 mb-3 flex items-center gap-2">
                      <Hash className="w-4 h-4 text-[#eb7825]" />
                      Platform Topics
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {platformTopics.map((topic) => (
                        <button
                          key={topic.id}
                          onClick={() => tagTopic(topic)}
                          className={`px-3 py-2 rounded-lg text-sm border transition-all ${
                            selectedTags.some(t => t.label === topic.label)
                              ? getTagColor(topic.color) + ' ring-2 ring-offset-2 ring-[#eb7825]'
                              : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                          }`}
                        >
                          {topic.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <Separator />

                  {/* Support Tickets */}
                  <div>
                    <h4 className="text-gray-900 mb-3 flex items-center gap-2">
                      <Ticket className="w-4 h-4 text-blue-600" />
                      Support Tickets
                    </h4>
                    {availableTickets.length === 0 ? (
                      <p className="text-gray-500 text-sm">No active tickets to tag</p>
                    ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {availableTickets.slice(0, 10).map((ticket) => (
                          <button
                            key={ticket.id}
                            onClick={() => tagTicket(ticket)}
                            className={`w-full text-left p-3 rounded-lg border transition-all ${
                              selectedTags.some(t => t.id === ticket.id)
                                ? 'bg-blue-50 border-blue-300 ring-2 ring-offset-2 ring-blue-500'
                                : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-900 truncate">{ticket.subject}</p>
                                <p className="text-xs text-gray-500">
                                  #{ticket.id.slice(0, 6)} • {ticket.status}
                                </p>
                              </div>
                              {selectedTags.some(t => t.id === ticket.id) && (
                                <Check className="w-4 h-4 text-blue-600 ml-2" />
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Experiences */}
                  <div>
                    <h4 className="text-gray-900 mb-3 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-purple-600" />
                      Experiences
                    </h4>
                    {availableExperiences.length === 0 ? (
                      <p className="text-gray-500 text-sm">No experiences to tag</p>
                    ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {availableExperiences.slice(0, 10).map((exp) => (
                          <button
                            key={exp.id}
                            onClick={() => tagExperience(exp)}
                            className={`w-full text-left p-3 rounded-lg border transition-all ${
                              selectedTags.some(t => t.id === exp.id)
                                ? 'bg-purple-50 border-purple-300 ring-2 ring-offset-2 ring-purple-500'
                                : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-900 truncate">{exp.title}</p>
                                <p className="text-xs text-gray-500">
                                  {exp.status} • {exp.createdBy}
                                </p>
                              </div>
                              {selectedTags.some(t => t.id === exp.id) && (
                                <Check className="w-4 h-4 text-purple-600 ml-2" />
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="p-6 border-t border-gray-200 bg-gray-50">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-600">
                      {selectedTags.length} tag{selectedTags.length !== 1 ? 's' : ''} selected
                    </p>
                    <Button
                      onClick={() => setShowTagModal(false)}
                      className="bg-gradient-to-r from-[#eb7825] to-[#d6691f]"
                    >
                      Done
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// Helper function to format time
function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
