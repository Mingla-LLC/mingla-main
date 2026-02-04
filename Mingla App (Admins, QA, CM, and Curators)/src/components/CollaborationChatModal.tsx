import React, { useState, useEffect, useRef } from 'react';
import { X, Send, MessageCircle, Image as ImageIcon, Paperclip, MoreVertical, Phone, Video } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

interface Message {
  id: string;
  senderId: string;
  senderName: string;
  senderType: 'curator' | 'business';
  senderAvatar?: string;
  content: string;
  timestamp: Date;
  read: boolean;
  type?: 'text' | 'image' | 'file';
  attachmentUrl?: string;
}

interface CollaborationChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  collaborationId: string;
  currentUserId: string;
  currentUserType: 'curator' | 'business';
  currentUserName: string;
  otherPartyName: string;
  otherPartyAvatar?: string;
  experienceTitle?: string;
}

const CollaborationChatModal: React.FC<CollaborationChatModalProps> = ({
  isOpen,
  onClose,
  collaborationId,
  currentUserId,
  currentUserType,
  currentUserName,
  otherPartyName,
  otherPartyAvatar,
  experienceTitle,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load messages for this collaboration
  useEffect(() => {
    if (isOpen) {
      loadMessages();
      // Mark all messages as read when opening chat
      markMessagesAsRead();
    }
  }, [isOpen, collaborationId]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  const loadMessages = () => {
    // Load messages from localStorage or backend
    const storageKey = `collaboration_chat_${collaborationId}`;
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
        content: `Welcome to your collaboration chat! Use this space to discuss details about "${experienceTitle || 'this experience'}", negotiate terms, share ideas, and coordinate logistics.`,
        timestamp: new Date(),
        read: true,
        type: 'text',
      };
      setMessages([welcomeMessage]);
      saveMessages([welcomeMessage]);
    }
  };

  const saveMessages = (msgs: Message[]) => {
    const storageKey = `collaboration_chat_${collaborationId}`;
    localStorage.setItem(storageKey, JSON.stringify(msgs));
  };

  const markMessagesAsRead = () => {
    setMessages(prev => {
      const updated = prev.map(m => 
        m.senderId !== currentUserId ? { ...m, read: true } : m
      );
      saveMessages(updated);
      return updated;
    });
  };

  const handleSendMessage = () => {
    if (!newMessage.trim()) return;

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

    // Simulate other party typing and responding (for demo purposes)
    simulateTypingIndicator();

    // Focus back on textarea
    textareaRef.current?.focus();
  };

  const simulateTypingIndicator = () => {
    // Simulate the other party seeing the message and potentially typing
    setTimeout(() => {
      setIsTyping(true);
      setTimeout(() => {
        setIsTyping(false);
      }, 2000);
    }, 1000);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-[#eb7825]/5 to-[#d6691f]/5">
          <div className="flex items-center gap-3 flex-1">
            <Avatar className="h-10 w-10 border-2 border-[#eb7825]">
              <AvatarImage src={otherPartyAvatar} />
              <AvatarFallback className="bg-[#eb7825] text-white">
                {getInitials(otherPartyName)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <h2 className="text-gray-900">{otherPartyName}</h2>
              <p className="text-gray-500 text-sm">
                {experienceTitle && `About: ${experienceTitle}`}
              </p>
            </div>
            <Badge variant="outline" className="border-[#eb7825] text-[#eb7825]">
              Collaboration
            </Badge>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-600 hover:text-[#eb7825] hover:bg-[#eb7825]/10"
              title="Voice call (Coming soon)"
            >
              <Phone className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-600 hover:text-[#eb7825] hover:bg-[#eb7825]/10"
              title="Video call (Coming soon)"
            >
              <Video className="h-5 w-5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-gray-600 hover:text-[#eb7825] hover:bg-[#eb7825]/10"
                >
                  <MoreVertical className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>View Collaboration Details</DropdownMenuItem>
                <DropdownMenuItem>View Experience</DropdownMenuItem>
                <DropdownMenuItem>Export Chat</DropdownMenuItem>
                <DropdownMenuItem className="text-red-600">Report Issue</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-gray-600 hover:text-gray-900 hover:bg-gray-100"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Messages Area */}
        <ScrollArea className="flex-1 px-6 py-4" ref={scrollAreaRef}>
          <div className="space-y-4">
            {messages.map((message, index) => {
              const isOwnMessage = message.senderId === currentUserId;
              const isSystem = message.senderId === 'system';
              const showAvatar = !isOwnMessage && !isSystem && (index === 0 || messages[index - 1].senderId !== message.senderId);

              if (isSystem) {
                return (
                  <div key={message.id} className="flex justify-center">
                    <div className="bg-gray-100 rounded-lg px-4 py-2 max-w-2xl text-center">
                      <p className="text-gray-600 text-sm">{message.content}</p>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={message.id}
                  className={`flex gap-3 ${isOwnMessage ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  {showAvatar && !isOwnMessage && (
                    <Avatar className="h-8 w-8 flex-shrink-0">
                      <AvatarImage src={otherPartyAvatar} />
                      <AvatarFallback className="bg-gray-300 text-gray-700 text-xs">
                        {getInitials(message.senderName)}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  {!showAvatar && !isOwnMessage && <div className="w-8 flex-shrink-0" />}
                  
                  <div className={`flex flex-col max-w-[70%] ${isOwnMessage ? 'items-end' : 'items-start'}`}>
                    {showAvatar && !isOwnMessage && (
                      <span className="text-xs text-gray-500 mb-1 px-1">
                        {message.senderName}
                      </span>
                    )}
                    <div
                      className={`rounded-2xl px-4 py-2.5 ${
                        isOwnMessage
                          ? 'bg-gradient-to-br from-[#eb7825] to-[#d6691f] text-white'
                          : 'bg-gray-100 text-gray-900'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{message.content}</p>
                    </div>
                    <div className={`flex items-center gap-2 mt-1 px-1 ${isOwnMessage ? 'flex-row-reverse' : 'flex-row'}`}>
                      <span className="text-xs text-gray-400">
                        {formatTime(message.timestamp)}
                      </span>
                      {isOwnMessage && (
                        <span className="text-xs text-gray-400">
                          {message.read ? '✓✓' : '✓'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Typing Indicator */}
            {isTyping && (
              <div className="flex gap-3">
                <Avatar className="h-8 w-8 flex-shrink-0">
                  <AvatarImage src={otherPartyAvatar} />
                  <AvatarFallback className="bg-gray-300 text-gray-700 text-xs">
                    {getInitials(otherPartyName)}
                  </AvatarFallback>
                </Avatar>
                <div className="bg-gray-100 rounded-2xl px-4 py-3 flex items-center gap-1">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="flex gap-3 items-end">
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="text-gray-500 hover:text-[#eb7825] hover:bg-[#eb7825]/10"
                title="Attach image (Coming soon)"
              >
                <ImageIcon className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-gray-500 hover:text-[#eb7825] hover:bg-[#eb7825]/10"
                title="Attach file (Coming soon)"
              >
                <Paperclip className="h-5 w-5" />
              </Button>
            </div>
            
            <div className="flex-1 relative">
              <Textarea
                ref={textareaRef}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type your message..."
                className="min-h-[44px] max-h-32 resize-none pr-12 border-gray-300 focus:border-[#eb7825] focus:ring-[#eb7825]"
                rows={1}
              />
            </div>

            <Button
              onClick={handleSendMessage}
              disabled={!newMessage.trim()}
              className="bg-gradient-to-r from-[#eb7825] to-[#d6691f] hover:from-[#d6691f] hover:to-[#eb7825] text-white h-11 px-6 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="h-5 w-5" />
            </Button>
          </div>
          <p className="text-xs text-gray-500 mt-2 text-center">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
};

export default CollaborationChatModal;
