import React, { useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { Conversation } from './types';
import { filterConversations } from './utils';
import ConversationCard from './ConversationCard';

interface MessagesTabProps {
  conversations: Conversation[];
  onSelectConversation: (conversation: Conversation) => void;
  onStartNewConversation: () => void;
}

export default function MessagesTab({
  conversations,
  onSelectConversation,
  onStartNewConversation
}: MessagesTabProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredConversations = filterConversations(conversations, searchQuery);

  return (
    <div className="flex-1 space-y-4 px-4 pt-6">
      {/* Header */}
      <div className="space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-colors"
          />
        </div>

        {/* Start New Conversation Button */}
        <button
          onClick={onStartNewConversation}
          className="w-full p-3 bg-[#eb7825] text-white rounded-lg hover:bg-[#d6691f] transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-5 h-5" />
          <span>Start New Conversation</span>
        </button>
      </div>

      {/* Conversations List */}
      <div className="space-y-3">
        {filteredConversations.length === 0 && searchQuery.trim() ? (
          <div className="text-center py-8 text-gray-500">
            <Search className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>No conversations found</p>
            <p className="text-sm">Try searching with different keywords</p>
          </div>
        ) : (
          filteredConversations.map((conversation, index) => (
            <ConversationCard
              key={`conversation-${conversation.id}-${index}`}
              conversation={conversation}
              onClick={() => onSelectConversation(conversation)}
            />
          ))
        )}
      </div>
    </div>
  );
}