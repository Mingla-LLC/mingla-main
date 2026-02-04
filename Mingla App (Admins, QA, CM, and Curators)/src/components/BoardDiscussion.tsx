import React, { useState, useRef, useEffect } from 'react';
import { Send, MessageCircle, AtSign, Hash, MoreHorizontal, Reply, Heart, ArrowLeft, Coffee, TreePine, Utensils, Sparkles, Dumbbell, LogOut, Bell, BellOff, Users } from 'lucide-react';
import SwipeableBoardCards from './SwipeableBoardCards';
import BoardMemberManagementModal from './BoardMemberManagementModal';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from './ui/dropdown-menu';

interface Message {
  id: string;
  user: {
    id: string;
    name: string;
    avatar?: string;
  };
  content: string;
  timestamp: string;
  mentions?: string[];
  cardTags?: string[];
  replies?: Message[];
  likes?: number;
  isLiked?: boolean;
}

interface Board {
  id: string;
  name: string;
  type: 'date-night' | 'group-hangout' | 'adventure' | 'wellness' | 'food-tour' | 'cultural';
  description: string;
  participants: string[];
  status: 'active' | 'voting' | 'locked' | 'completed';
  voteDeadline?: string;
  finalizedDate?: string;
  cardsCount: number;
  createdAt: string;
  unreadMessages: number;
  lastActivity: string;
  icon: any;
  gradient: string;
}

interface BoardDiscussionProps {
  board: Board & {
    participants: Array<{
      id: string;
      name: string;
      status: string;
      lastActive?: string;
    }>;
    admins: string[];
    currentUserId: string;
    creatorId: string;
  };
  onBack: () => void;
  onExitBoard?: (boardId: string, boardName: string) => void;
  activeTab?: 'cards' | 'discussion';
  onTabChange?: (tab: 'cards' | 'discussion') => void;
  onPromoteToAdmin?: (boardId: string, participantId: string) => void;
  onDemoteFromAdmin?: (boardId: string, participantId: string) => void;
  onRemoveMember?: (boardId: string, participantId: string) => void;
  onLeaveBoard?: (boardId: string) => void;
  onSaveCardFromBoard?: (card: any) => void;
}

const mockMessages: Message[] = [
  {
    id: '1',
    user: { id: '1', name: 'Sarah Chen' },
    content: 'Hey everyone! What do you think about the coffee place? Should we lock it in?',
    timestamp: '2 hours ago',
    cardTags: ['Sightglass Coffee'],
    likes: 2,
    isLiked: false
  },
  {
    id: '2',
    user: { id: '2', name: 'Alex Rivera' },
    content: 'I love that spot! @Sarah Chen the vibes are perfect for our group. ☕',
    timestamp: '1 hour ago',
    mentions: ['Sarah Chen'],
    likes: 3,
    isLiked: true
  },
  {
    id: '3',
    user: { id: '3', name: 'Jamie Park' },
    content: 'Can we also discuss timing? I think 2pm works best for #Golden Gate Trail',
    timestamp: '45 minutes ago',
    cardTags: ['Golden Gate Trail'],
    likes: 1,
    isLiked: false
  }
];

// No mock board cards - all cards come from board.cards prop

export default function BoardDiscussion({ 
  board, 
  onBack, 
  onExitBoard, 
  activeTab: propActiveTab, 
  onTabChange,
  onPromoteToAdmin,
  onDemoteFromAdmin,
  onRemoveMember,
  onLeaveBoard,
  onSaveCardFromBoard
}: BoardDiscussionProps) {
  const [messages] = useState<Message[]>(mockMessages);
  const [newMessage, setNewMessage] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [showCardTags, setShowCardTags] = useState(false);
  const [activeView, setActiveView] = useState<'cards' | 'discussion'>(propActiveTab || 'cards');
  const [boardNotifications, setBoardNotifications] = useState(true);
  const [showMemberManagement, setShowMemberManagement] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when switching to discussion view
  useEffect(() => {
    if (activeView === 'discussion' && inputRef.current) {
      // Small delay to ensure the view has rendered
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [activeView]);

  // Use board participants as they are already in proper format
  const participants = board.participants;

  // Get actual board cards from board prop (or empty array)
  const boardCards = (board as any).cards || [];
  
  // Ensure cards have proper vote/RSVP structure
  const cardsWithMetadata = boardCards.map((card: any) => ({
    ...card,
    votes: card.votes || { yes: 0, no: 0, userVote: null },
    rsvps: card.rsvps || { responded: 0, total: participants.length, userRSVP: null },
    messages: card.messages || 0,
    isLocked: card.isLocked || false
  }));

  // Convert board cards for compatibility with CardTag system
  const cards = cardsWithMetadata.map((card: any) => ({
    id: card.id,
    title: card.title
  }));

  const handleSendMessage = () => {
    if (newMessage.trim()) {
      // Handle sending message
      console.log('Sending message:', newMessage);
      setNewMessage('');
    }
  };

  const handleInputChange = (value: string) => {
    setNewMessage(value);
    
    // Check for mentions (@)
    if (value.endsWith('@')) {
      setShowMentions(true);
      setShowCardTags(false);
    }
    // Check for card tags (#)
    else if (value.endsWith('#')) {
      setShowCardTags(true);
      setShowMentions(false);
    } else {
      setShowMentions(false);
      setShowCardTags(false);
    }
  };

  const insertMention = (user: any) => {
    setNewMessage(prev => prev.slice(0, -1) + `@${user.name} `);
    setShowMentions(false);
  };

  const insertCardTag = (card: any) => {
    setNewMessage(prev => prev.slice(0, -1) + `#${card.title} `);
    setShowCardTags(false);
  };

  const handleVote = (cardId: string, vote: 'yes' | 'no') => {
    console.log(`Voting ${vote} on card ${cardId} in board ${board.id}`);
    // Update vote logic would go here
  };

  const handleRSVP = (cardId: string, rsvp: 'yes' | 'no') => {
    console.log(`RSVP ${rsvp} for card ${cardId} in board ${board.id}`);
    // Update RSVP logic would go here
  };

  const handleToggleNotifications = () => {
    setBoardNotifications(!boardNotifications);
    console.log(`Board ${board.id} notifications ${!boardNotifications ? 'enabled' : 'disabled'}`);
  };

  const handleExitBoard = () => {
    if (onExitBoard) {
      onExitBoard(board.id, board.name);
    }
  };

  const handlePromoteMember = (participantId: string) => {
    if (onPromoteToAdmin) {
      onPromoteToAdmin(board.id, participantId);
    }
  };

  const handleDemoteMember = (participantId: string) => {
    if (onDemoteFromAdmin) {
      onDemoteFromAdmin(board.id, participantId);
    }
  };

  const handleRemoveBoardMember = (participantId: string) => {
    if (onRemoveMember) {
      onRemoveMember(board.id, participantId);
    }
  };

  const handleLeaveBoardAction = () => {
    if (onLeaveBoard) {
      onLeaveBoard(board.id);
    }
  };

  // Map icon names to components
  const iconMap: {[key: string]: any} = {
    'Heart': Heart,
    'Dumbbell': Dumbbell,
    'Utensils': Utensils,
    'Coffee': Coffee,
    'Palette': Sparkles, // Using Sparkles as placeholder for Palette
    'Trophy': Dumbbell, // Using Dumbbell as placeholder for Trophy
  };
  
  const BoardIcon = iconMap[board.icon] || Heart;

  return (
    <div className="h-full bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-4 flex-shrink-0">
        <div className="flex items-center gap-3 mb-3 pt-8">
          <button
            onClick={onBack}
            className="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-gray-600" />
          </button>
          

          
          <div className="flex-1">
            <h1 className="font-bold text-gray-900">{board.name}</h1>
            <p className="text-sm text-gray-600">{board.description}</p>
          </div>

          {/* Board Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="w-8 h-8 border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-all duration-200 flex items-center justify-center"
                title="Board options"
              >
                <MoreHorizontal className="w-4 h-4 text-gray-600" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onClick={handleToggleNotifications}
                className="flex items-center gap-2"
              >
                {boardNotifications ? (
                  <>
                    <BellOff className="w-4 h-4" />
                    Turn off notifications
                  </>
                ) : (
                  <>
                    <Bell className="w-4 h-4" />
                    Turn on notifications
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => {
                  setShowMemberManagement(true);
                }}
                className="flex items-center gap-2"
              >
                <Users className="w-4 h-4" />
                Manage Members
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleExitBoard}
                className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <LogOut className="w-4 h-4" />
                Exit board
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Tab Navigation */}
        <div className="flex bg-gray-100 rounded-xl p-1">
          <button
            onClick={() => {
              setActiveView('cards');
              onTabChange?.('cards');
            }}
            className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-all ${
              activeView === 'cards'
                ? 'bg-white text-[#eb7825] shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Cards ({cardsWithMetadata.length})
          </button>
          <button
            onClick={() => {
              setActiveView('discussion');
              onTabChange?.('discussion');
            }}
            className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-all ${
              activeView === 'discussion'
                ? 'bg-white text-[#eb7825] shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Discussion ({messages.length})
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeView === 'cards' ? (
          <div className="h-full p-4 overflow-y-auto">
            <SwipeableBoardCards
              cards={cardsWithMetadata}
              onVote={handleVote}
              onRSVP={handleRSVP}
              onSaveCard={onSaveCardFromBoard}
            />
          </div>
        ) : (
          <div className="h-full flex flex-col">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto bg-white">
              {messages.length > 0 ? (
                <div className="space-y-4 p-4">
                  {messages.map((message) => (
                    <div key={message.id} className="group">
                      <div className="flex gap-3">
                        <div className="w-8 h-8 bg-[#eb7825] rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
                          {message.user.name[0]}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-gray-900 text-sm">{message.user.name}</span>
                            <span className="text-xs text-gray-500">{message.timestamp}</span>
                          </div>
                          
                          <div className="text-sm text-gray-800 mb-2">
                            {message.content.split(/(@\w+\s*\w*|#[\w\s]+)/g).map((part, index) => {
                              if (part.startsWith('@')) {
                                return (
                                  <span key={index} className="text-[#eb7825] font-medium">
                                    {part}
                                  </span>
                                );
                              } else if (part.startsWith('#')) {
                                return (
                                  <span key={index} className="text-blue-600 font-medium">
                                    {part}
                                  </span>
                                );
                              }
                              return part;
                            })}
                          </div>

                          {/* Tags */}
                          {(message.mentions || message.cardTags) && (
                            <div className="flex flex-wrap gap-1 mb-2">
                              {message.mentions?.map(mention => (
                                <span key={mention} className="inline-flex items-center gap-1 bg-orange-50 text-[#eb7825] px-2 py-0.5 rounded-full text-xs">
                                  <AtSign className="w-3 h-3" />
                                  {mention}
                                </span>
                              ))}
                              {message.cardTags?.map(tag => (
                                <span key={tag} className="inline-flex items-center gap-1 bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full text-xs">
                                  <Hash className="w-3 h-3" />
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Actions */}
                          <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-500 transition-colors">
                              <Heart className={`w-3 h-3 ${message.isLiked ? 'fill-red-500 text-red-500' : ''}`} />
                              {message.likes}
                            </button>
                            <button className="text-xs text-gray-500 hover:text-gray-700 transition-colors">
                              <Reply className="w-3 h-3" />
                            </button>
                            <button className="text-xs text-gray-500 hover:text-gray-700 transition-colors">
                              <MoreHorizontal className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <MessageCircle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  <p className="text-sm">No messages yet. Start the conversation!</p>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="relative p-4 border-t border-gray-100 bg-white flex-shrink-0 z-10" style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}>
              {/* Suggestions */}
              {showMentions && (
                <div className="absolute bottom-full left-4 right-4 mb-2 bg-white border border-gray-200 rounded-xl shadow-lg max-h-32 overflow-y-auto z-10">
                  {participants.map(user => (
                    <button
                      key={user.id}
                      onClick={() => insertMention(user)}
                      className="w-full flex items-center gap-2 p-2 hover:bg-gray-50 text-left"
                    >
                      <div className="w-6 h-6 bg-[#eb7825] rounded-full flex items-center justify-center text-white text-xs">
                        {user.name[0]}
                      </div>
                      <span className="text-sm">{user.name}</span>
                    </button>
                  ))}
                </div>
              )}

              {showCardTags && cards.length > 0 && (
                <div className="absolute bottom-full left-4 right-4 mb-2 bg-white border border-gray-200 rounded-xl shadow-lg max-h-32 overflow-y-auto z-10">
                  {cards.map(card => (
                    <button
                      key={card.id}
                      onClick={() => insertCardTag(card)}
                      className="w-full flex items-center gap-2 p-2 hover:bg-gray-50 text-left"
                    >
                      <Hash className="w-4 h-4 text-blue-600" />
                      <span className="text-sm">{card.title}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex gap-2 items-end">
                <div 
                  className="flex-1"
                  onClick={() => inputRef.current?.focus()}
                >
                  <input
                    ref={inputRef}
                    type="text"
                    value={newMessage}
                    onChange={(e) => handleInputChange(e.target.value)}
                    placeholder="Type @ to mention someone or # to tag a card..."
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#eb7825]/20 focus:border-[#eb7825] bg-white outline-none transition-all touch-manipulation"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    autoComplete="off"
                    spellCheck="false"
                    autoFocus={false}
                    inputMode="text"
                    enterKeyHint="send"
                  />
                </div>
                <button
                  onClick={handleSendMessage}
                  disabled={!newMessage.trim()}
                  className="px-4 py-3 bg-[#eb7825] text-white rounded-xl hover:bg-[#d6691f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
              
              <p className="text-xs text-gray-500 mt-2">
                Use @ to mention participants • Use # to reference cards
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Board Member Management Modal */}
      <BoardMemberManagementModal
        isOpen={showMemberManagement}
        onClose={() => setShowMemberManagement(false)}
        board={board}
        onPromoteToAdmin={handlePromoteMember}
        onDemoteFromAdmin={handleDemoteMember}
        onRemoveMember={handleRemoveBoardMember}
        onLeaveBoard={handleLeaveBoardAction}
      />
    </div>
  );
}