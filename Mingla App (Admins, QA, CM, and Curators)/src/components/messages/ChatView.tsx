import React from 'react';
import { 
  ArrowLeft, Send, MoreVertical, Building2, User as UserIcon,
  Tag, DollarSign, Download, Sparkles
} from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { ScrollArea } from '../ui/scroll-area';
import { 
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger 
} from '../ui/dropdown-menu';
import { motion, AnimatePresence } from 'motion/react';
import { ChatViewProps } from './types';
import MessageBubble from './MessageBubble';
import { getOtherPartyName, getInitials } from './utils';

export default function ChatView({
  selectedCollaboration,
  messages,
  newMessage,
  isTyping,
  currentUserId,
  currentUserType,
  currentUserName,
  isMobileView,
  sharedExperiences,
  onBack,
  onSendMessage,
  onMessageChange,
  onKeyPress,
  onExportChat,
  onShowCollabDetails,
  onShowNegotiationModal,
  onShowExperienceTagMenu,
  onTagExperience,
  onAcceptNegotiation,
  onRejectNegotiation,
  textareaRef,
  scrollAreaRef
}: ChatViewProps) {
  if (!selectedCollaboration) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md px-6">
          <div className="h-20 w-20 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <Sparkles className="h-10 w-10 text-gray-400" />
          </div>
          <h3 className="text-gray-900 mb-2">Select a conversation</h3>
          <p className="text-gray-500 text-sm">
            Choose a collaboration from the list to start messaging
          </p>
        </div>
      </div>
    );
  }

  const otherPartyName = getOtherPartyName(selectedCollaboration, currentUserType);

  return (
    <div className="flex-1 flex flex-col bg-white">
      {/* Chat Header */}
      <div className="border-b border-gray-200 px-4 py-3 bg-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isMobileView && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onBack}
                className="mr-2"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            )}
            
            <Avatar className="h-10 w-10 border-2 border-[#eb7825]">
              <AvatarFallback className="bg-gradient-to-br from-[#eb7825] to-[#d6691f] text-white">
                {getInitials(otherPartyName)}
              </AvatarFallback>
            </Avatar>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-gray-900 truncate">
                  {otherPartyName}
                </h2>
                {currentUserType === 'curator' ? (
                  <Building2 className="h-4 w-4 text-gray-400 flex-shrink-0" />
                ) : (
                  <UserIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                )}
              </div>
              <p className="text-sm text-gray-600 truncate">
                {selectedCollaboration.experienceName}
              </p>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onShowCollabDetails}>
                <Building2 className="h-4 w-4 mr-2" />
                Collaboration Details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onShowNegotiationModal}>
                <DollarSign className="h-4 w-4 mr-2" />
                Propose Commission
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onExportChat}>
                <Download className="h-4 w-4 mr-2" />
                Export Chat
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Messages Area */}
      <ScrollArea className="flex-1 px-4" ref={scrollAreaRef}>
        <div className="py-4 space-y-2">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              currentUserId={currentUserId}
              currentUserType={currentUserType}
              onAcceptNegotiation={onAcceptNegotiation}
              onRejectNegotiation={onRejectNegotiation}
            />
          ))}

          {/* Typing Indicator */}
          <AnimatePresence>
            {isTyping && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex justify-start mb-4"
              >
                <div className="bg-gray-100 rounded-2xl px-4 py-3 flex items-center gap-2">
                  <div className="flex gap-1">
                    <motion.div
                      className="w-2 h-2 bg-gray-400 rounded-full"
                      animate={{ y: [0, -8, 0] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: 0 }}
                    />
                    <motion.div
                      className="w-2 h-2 bg-gray-400 rounded-full"
                      animate={{ y: [0, -8, 0] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: 0.2 }}
                    />
                    <motion.div
                      className="w-2 h-2 bg-gray-400 rounded-full"
                      animate={{ y: [0, -8, 0] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: 0.4 }}
                    />
                  </div>
                  <span className="text-sm text-gray-600">{otherPartyName} is typing...</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="border-t border-gray-200 p-4 bg-white">
        <div className="flex gap-2">
          {/* Tag Experience Button */}
          {sharedExperiences.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <Tag className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <div className="px-2 py-1.5 text-sm font-medium text-gray-700">
                  Tag an Experience
                </div>
                {sharedExperiences.map((exp) => (
                  <DropdownMenuItem
                    key={exp.id}
                    onClick={() => onTagExperience(exp)}
                  >
                    <Sparkles className="h-4 w-4 mr-2 text-[#eb7825]" />
                    {exp.title || exp.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Message Input */}
          <Textarea
            ref={textareaRef}
            value={newMessage}
            onChange={(e) => onMessageChange(e.target.value)}
            onKeyDown={onKeyPress}
            placeholder="Type your message..."
            className="flex-1 min-h-[44px] max-h-32 resize-none"
            rows={1}
          />

          {/* Send Button */}
          <Button
            onClick={onSendMessage}
            disabled={!newMessage.trim()}
            className="bg-[#eb7825] hover:bg-[#d6691f] flex-shrink-0"
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
