import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Users, Heart, MessageCircle, Send, MoreVertical, ArrowLeft, MapPin, Settings, Bell, BellOff, LogOut, Shield, UserPlus, Trash2, Crown } from 'lucide-react';
import { CollaborationSession } from './CollaborationSessions';
import CollaborationCards from './CollaborationCards';
import exampleImage from 'figma:asset/efcc04c73f96b16b80d0555a4c74f6c1a2a9eb33.png';
import { ImageWithFallback } from '../figma/ImageWithFallback';

interface CollaborationBoardProps {
  session: CollaborationSession;
  onClose: () => void;
}

interface Message {
  id: string;
  user: string;
  userInitials: string;
  text: string;
  timestamp: Date;
  mentions?: string[];
  cardTags?: string[];
}

interface SharedCard {
  id: string;
  title: string;
  category: string;
  categoryIcon: any;
  price: string;
  priceRange: string;
  addedBy: string;
  image: string;
  images?: string[];
  rating: number;
  reviewCount?: number;
  travelTime: string;
  description: string;
  fullDescription?: string;
  address?: string;
  duration?: string;
  highlights?: string[];
  votes: {
    yes: number;
    no: number;
    userVote?: 'yes' | 'no' | null;
  };
  rsvps: {
    responded: number;
    total: number;
    userRSVP?: 'yes' | 'no' | null;
  };
  messages: number;
  isLocked: boolean;
  lockedAt?: string;
}

export default function CollaborationBoard({ session, onClose }: CollaborationBoardProps) {
  const [activeTab, setActiveTab] = useState<'cards' | 'discussion'>('cards');
  const [message, setMessage] = useState('');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [galleryIndices, setGalleryIndices] = useState<{[key: string]: number}>({});
  
  // New state for menu actions
  const [showManageModal, setShowManageModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [notificationsMuted, setNotificationsMuted] = useState(false);
  const [isAdmin, setIsAdmin] = useState(true); // In real app, check if current user is admin
  const [boardName, setBoardName] = useState(session.name);
  const [newBoardName, setNewBoardName] = useState(session.name);
  const [inviteInput, setInviteInput] = useState('');
  const [members, setMembers] = useState([
    { id: '1', name: 'Sarah Chen', initials: 'SC', isAdmin: true, isCreator: true },
    { id: '2', name: 'Alex Rivera', initials: 'AR', isAdmin: false, isCreator: false },
    { id: '3', name: 'Jamie Park', initials: 'JP', isAdmin: false, isCreator: false },
  ]);

  // Use cards from session if available, otherwise use empty array
  const sharedCards = (session as any).cards || [];

  // Get board-specific description
  const getBoardDescription = () => {
    switch (session.name) {
      case 'Weekend Date Night':
        return 'Romantic weekend experiences for couples';
      case 'Fitness Squad Goals':
        return 'Active workouts and wellness activities';
      case 'Foodie Adventures':
        return 'Culinary experiences and restaurant discoveries';
      default:
        return 'Collaborative experience planning';
    }
  };

  const [messages, setMessages] = useState<Message[]>([
    { 
      id: '1', 
      user: 'Sarah Chen', 
      userInitials: 'SC',
      text: 'Hey everyone! What do you think about the coffee place? Should we lock it in?',
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
      cardTags: ['Sightglass Coffee']
    },
    { 
      id: '2', 
      user: 'Alex Rivera', 
      userInitials: 'AR',
      text: 'Love that spot! @Sarah Chen the vibes are perfect for our group. 😊',
      timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000),
      mentions: ['Sarah Chen']
    },
    { 
      id: '3', 
      user: 'Jamie Park', 
      userInitials: 'JP',
      text: 'Can we also discuss timing? I think 2pm works best for #Golden Gate Trail',
      timestamp: new Date(Date.now() - 45 * 60 * 1000),
      cardTags: ['Golden Gate Trail']
    }
  ]);

  const formatTimestamp = (date: Date) => {
    const now = Date.now();
    const diff = now - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  const parseMessageContent = (text: string) => {
    const parts = [];
    let lastIndex = 0;
    
    // Match @mentions and #hashtags
    const regex = /(@[\w\s]+)|#([\w\s]+)/g;
    let match;
    
    while ((match = regex.exec(text)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      }
      
      // Add the matched mention or hashtag
      if (match[0].startsWith('@')) {
        parts.push({ type: 'mention', content: match[0] });
      } else {
        parts.push({ type: 'hashtag', content: match[0] });
      }
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text
    if (lastIndex < text.length) {
      parts.push({ type: 'text', content: text.slice(lastIndex) });
    }
    
    return parts;
  };

  const handleSendMessage = () => {
    if (message.trim()) {
      const mentions = [];
      const cardTags = [];
      
      // Extract mentions and hashtags
      const mentionRegex = /@([\w\s]+)/g;
      const hashtagRegex = /#([\w\s]+)/g;
      
      let match;
      while ((match = mentionRegex.exec(message)) !== null) {
        mentions.push(match[1]);
      }
      while ((match = hashtagRegex.exec(message)) !== null) {
        cardTags.push(match[1]);
      }
      
      setMessages([
        ...messages,
        {
          id: Date.now().toString(),
          user: 'You',
          userInitials: 'Y',
          text: message.trim(),
          timestamp: new Date(),
          mentions: mentions.length > 0 ? mentions : undefined,
          cardTags: cardTags.length > 0 ? cardTags : undefined
        }
      ]);
      setMessage('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const getUserColor = (initials: string) => {
    const colors = [
      'from-[#eb7825] to-[#d6691f]',
      'from-blue-500 to-indigo-600',
      'from-purple-500 to-pink-600',
      'from-green-500 to-emerald-600',
      'from-amber-500 to-orange-600'
    ];
    const index = initials.charCodeAt(0) % colors.length;
    return colors[index];
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      style={{ paddingBottom: '80px' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 50 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 50 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white/95 backdrop-blur-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col"
        style={{ height: 'calc(100vh - 84px)' }}
      >
        {/* Header */}
        <div className="relative px-4 py-3 bg-white border-b border-gray-200/50 flex items-center gap-3">
          {/* Close Button */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
          >
            <X className="w-5 h-5 text-gray-700" />
          </motion.button>

          {/* Session Info */}
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-gray-900 text-sm mb-1 truncate">{session.name}</h3>
            
            {/* Participants Preview */}
            <div className="flex items-center gap-1.5">
              <div className="flex -space-x-1.5">
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 border-2 border-white flex items-center justify-center text-white text-[8px] font-bold">
                  SC
                </div>
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 border-2 border-white flex items-center justify-center text-white text-[8px] font-bold">
                  AR
                </div>
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 border-2 border-white flex items-center justify-center text-white text-[8px] font-bold">
                  JP
                </div>
              </div>
              <span className="text-xs text-gray-500 font-medium">
                {session.participants?.length || 3} active
              </span>
            </div>
          </div>

          {/* More Button */}
          <div className="relative flex-shrink-0">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <MoreVertical className="w-5 h-5 text-gray-700" />
            </motion.button>

            {/* More Menu Dropdown */}
            <AnimatePresence>
              {showMoreMenu && (
                <>
                  {/* Backdrop to close menu */}
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setShowMoreMenu(false)}
                  />
                  
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -10 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 400 }}
                    className="absolute top-12 right-0 w-64 bg-white/95 backdrop-blur-2xl border border-gray-200/50 rounded-2xl shadow-2xl overflow-hidden z-50"
                  >
                    <div className="p-2">
                      {/* Admin Badge - Only show if user is admin */}
                      {isAdmin && (
                        <>
                          <div className="px-3 py-2 mb-2">
                            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-gradient-to-r from-[#eb7825]/10 to-[#d6691f]/10 rounded-lg">
                              <Shield className="w-3.5 h-3.5 text-[#eb7825]" />
                              <span className="text-xs font-semibold text-[#eb7825]">Admin Privileges</span>
                            </div>
                          </div>
                          <div className="h-px bg-gray-200/50 mb-2" />
                        </>
                      )}

                      {/* Manage Board - Only for admins */}
                      {isAdmin && (
                        <motion.button
                          whileHover={{ backgroundColor: 'rgba(235, 120, 37, 0.05)' }}
                          onClick={() => {
                            setShowMoreMenu(false);
                            setShowManageModal(true);
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 hover:text-gray-900 rounded-xl transition-all text-left"
                        >
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#eb7825]/10 to-[#d6691f]/10 flex items-center justify-center">
                            <Settings className="w-4 h-4 text-[#eb7825]" />
                          </div>
                          <span className="font-medium">Manage Board</span>
                        </motion.button>
                      )}
                      
                      {/* Rename Board */}
                      <motion.button
                        whileHover={{ backgroundColor: 'rgba(235, 120, 37, 0.05)' }}
                        onClick={() => {
                          setShowMoreMenu(false);
                          setShowRenameModal(true);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 hover:text-gray-900 rounded-xl transition-all text-left"
                      >
                        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                          <MessageCircle className="w-4 h-4 text-gray-600" />
                        </div>
                        <span className="font-medium">Rename Board</span>
                      </motion.button>
                      
                      {/* Invite Participants */}
                      <motion.button
                        whileHover={{ backgroundColor: 'rgba(235, 120, 37, 0.05)' }}
                        onClick={() => {
                          setShowMoreMenu(false);
                          setShowInviteModal(true);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 hover:text-gray-900 rounded-xl transition-all text-left"
                      >
                        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                          <UserPlus className="w-4 h-4 text-gray-600" />
                        </div>
                        <span className="font-medium">Invite Participants</span>
                      </motion.button>

                      {/* Turn Off/On Notifications */}
                      <motion.button
                        whileHover={{ backgroundColor: 'rgba(235, 120, 37, 0.05)' }}
                        onClick={() => {
                          setShowMoreMenu(false);
                          setNotificationsMuted(!notificationsMuted);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 hover:text-gray-900 rounded-xl transition-all text-left"
                      >
                        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                          {notificationsMuted ? (
                            <Bell className="w-4 h-4 text-gray-600" />
                          ) : (
                            <BellOff className="w-4 h-4 text-gray-600" />
                          )}
                        </div>
                        <span className="font-medium">
                          {notificationsMuted ? 'Turn On Notifications' : 'Turn Off Notifications'}
                        </span>
                      </motion.button>

                      <div className="h-px bg-gray-200/50 my-2" />
                      
                      {/* Leave Board */}
                      <motion.button
                        whileHover={{ backgroundColor: 'rgba(239, 68, 68, 0.05)' }}
                        onClick={() => {
                          setShowMoreMenu(false);
                          onClose();
                          // Handle leave board logic
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 hover:text-red-600 rounded-xl transition-all text-left"
                      >
                        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                          <ArrowLeft className="w-4 h-4 text-gray-600" />
                        </div>
                        <span className="font-medium">Leave Board</span>
                      </motion.button>
                      
                      {/* Delete Board - Only for admins */}
                      {isAdmin && (
                        <motion.button
                          whileHover={{ backgroundColor: 'rgba(239, 68, 68, 0.05)' }}
                          onClick={() => {
                            setShowMoreMenu(false);
                            setShowDeleteConfirm(true);
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-red-600 hover:text-red-700 rounded-xl transition-all text-left"
                        >
                          <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
                            <X className="w-4 h-4 text-red-600" />
                          </div>
                          <span className="font-medium">Delete Board</span>
                        </motion.button>
                      )}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200/50 bg-white px-4">
          <button
            onClick={() => setActiveTab('cards')}
            className={`flex-1 py-3 text-sm font-medium transition-all relative ${
              activeTab === 'cards' ? 'text-[#eb7825]' : 'text-gray-500'
            }`}
          >
            Cards ({sharedCards.length})
            {activeTab === 'cards' && (
              <motion.div
                layoutId="boardTab"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#eb7825]"
              />
            )}
          </button>
          <button
            onClick={() => setActiveTab('discussion')}
            className={`flex-1 py-3 text-sm font-medium transition-all relative ${
              activeTab === 'discussion' ? 'text-[#eb7825]' : 'text-gray-500'
            }`}
          >
            Discussion ({messages.length})
            {activeTab === 'discussion' && (
              <motion.div
                layoutId="boardTab"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#eb7825]"
              />
            )}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            {activeTab === 'cards' ? (
              <motion.div
                key="cards"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="h-full"
              >
                <CollaborationCards 
                  cards={sharedCards}
                  onVote={(cardId, vote) => {
                    console.log(`Vote ${vote} on card ${cardId}`);
                    // Handle vote logic here
                  }}
                  onRSVP={(cardId, rsvp) => {
                    console.log(`RSVP ${rsvp} for card ${cardId}`);
                    // Handle RSVP logic here
                  }}
                />
              </motion.div>
            ) : (
              <motion.div
                key="discussion"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full overflow-y-auto p-4 space-y-4"
              >
                {messages.map((msg) => (
                  <div key={msg.id} className="flex gap-3">
                    <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${getUserColor(msg.userInitials)} flex items-center justify-center text-white text-sm font-bold flex-shrink-0`}>
                      {msg.userInitials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="font-semibold text-gray-900 text-sm">
                          {msg.user}
                        </span>
                        <span className="text-xs text-gray-500">
                          {formatTimestamp(msg.timestamp)}
                        </span>
                      </div>
                      <div className="text-sm text-gray-700 leading-relaxed">
                        {parseMessageContent(msg.text).map((part, index) => {
                          if (part.type === 'mention') {
                            return (
                              <span key={index} className="text-blue-600 font-medium">
                                {part.content}
                              </span>
                            );
                          } else if (part.type === 'hashtag') {
                            return (
                              <span key={index} className="text-[#eb7825] font-medium">
                                {part.content}
                              </span>
                            );
                          }
                          return <span key={index}>{part.content}</span>;
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Message Input - Only show on Discussion tab */}
        {activeTab === 'discussion' && (
          <div className="p-4 border-t border-gray-200/50 bg-white">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full resize-none text-sm text-gray-900 focus:outline-none bg-transparent"
                  rows={1}
                  placeholder="Type a message..."
                  onKeyDown={handleKeyDown}
                />
              </div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleSendMessage}
                disabled={!message.trim()}
                className={`p-3 rounded-2xl transition-all flex-shrink-0 ${
                  message.trim()
                    ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-lg shadow-[#eb7825]/30'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                <Send className="w-5 h-5" />
              </motion.button>
            </div>
          </div>
        )}
      </motion.div>

      {/* Manage Board Modal */}
      <AnimatePresence>
        {showManageModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={() => setShowManageModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <h3 className="font-bold text-gray-900">Manage Board Members</h3>
                <button onClick={() => setShowManageModal(false)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                  <X className="w-5 h-5 text-gray-600" />
                </button>
              </div>
              <div className="p-4 max-h-96 overflow-y-auto">
                {members.map((member) => (
                  <div key={member.id} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${getUserColor(member.initials)} flex items-center justify-center text-white text-sm font-bold`}>
                        {member.initials}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900 text-sm">{member.name}</span>
                          {member.isCreator && (
                            <span className="flex items-center gap-1 text-xs bg-gradient-to-r from-[#eb7825]/10 to-[#d6691f]/10 text-[#eb7825] px-2 py-0.5 rounded-full">
                              <Crown className="w-3 h-3" />
                              Creator
                            </span>
                          )}
                          {member.isAdmin && !member.isCreator && (
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                              Admin
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {!member.isCreator && (
                      <div className="flex items-center gap-2">
                        {!member.isAdmin ? (
                          <button
                            onClick={() => {
                              setMembers(members.map(m => 
                                m.id === member.id ? { ...m, isAdmin: true } : m
                              ));
                            }}
                            className="text-xs text-[#eb7825] font-medium hover:underline"
                          >
                            Make Admin
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setMembers(members.map(m => 
                                m.id === member.id ? { ...m, isAdmin: false } : m
                              ));
                            }}
                            className="text-xs text-gray-600 font-medium hover:underline"
                          >
                            Remove Admin
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setMembers(members.filter(m => m.id !== member.id));
                          }}
                          className="p-1.5 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rename Board Modal */}
      <AnimatePresence>
        {showRenameModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={() => setShowRenameModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-4 border-b border-gray-200">
                <h3 className="font-bold text-gray-900">Rename Board</h3>
              </div>
              <div className="p-4">
                <input
                  type="text"
                  value={newBoardName}
                  onChange={(e) => setNewBoardName(e.target.value)}
                  placeholder="Enter new board name"
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200/50 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#eb7825]/30 focus:border-[#eb7825]/50 transition-all"
                />
              </div>
              <div className="p-4 border-t border-gray-200 flex gap-2">
                <button
                  onClick={() => setShowRenameModal(false)}
                  className="flex-1 py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium text-sm transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setBoardName(newBoardName);
                    setShowRenameModal(false);
                  }}
                  className="flex-1 py-2.5 px-4 bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white rounded-xl font-medium text-sm shadow-lg shadow-[#eb7825]/30 transition-all"
                >
                  Rename
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Invite Participants Modal */}
      <AnimatePresence>
        {showInviteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={() => setShowInviteModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-4 border-b border-gray-200">
                <h3 className="font-bold text-gray-900">Invite Participants</h3>
                <p className="text-xs text-gray-500 mt-1">Enter username or email address</p>
              </div>
              <div className="p-4">
                <input
                  type="text"
                  value={inviteInput}
                  onChange={(e) => setInviteInput(e.target.value)}
                  placeholder="@username or email@example.com"
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200/50 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#eb7825]/30 focus:border-[#eb7825]/50 transition-all"
                />
              </div>
              <div className="p-4 border-t border-gray-200 flex gap-2">
                <button
                  onClick={() => {
                    setInviteInput('');
                    setShowInviteModal(false);
                  }}
                  className="flex-1 py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium text-sm transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    // Handle invite logic
                    console.log('Inviting:', inviteInput);
                    setInviteInput('');
                    setShowInviteModal(false);
                  }}
                  disabled={!inviteInput.trim()}
                  className={`flex-1 py-2.5 px-4 rounded-xl font-medium text-sm transition-all ${
                    inviteInput.trim()
                      ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-lg shadow-[#eb7825]/30'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Send Invite
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={() => setShowDeleteConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 text-center">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <X className="w-6 h-6 text-red-600" />
                </div>
                <h3 className="font-bold text-gray-900 text-lg mb-2">Delete Board?</h3>
                <p className="text-sm text-gray-600 mb-6">
                  Are you sure you want to delete "{session.name}"? This action cannot be undone and all members will lose access.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium text-sm transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      // Handle delete logic
                      console.log('Deleting board:', session.name);
                      setShowDeleteConfirm(false);
                      onClose();
                    }}
                    className="flex-1 py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium text-sm transition-all shadow-lg shadow-red-600/30"
                  >
                    Delete Board
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}