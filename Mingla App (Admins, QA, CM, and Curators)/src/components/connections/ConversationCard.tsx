import React from 'react';
import { Conversation } from './types';
import { getInitials } from './utils';

interface ConversationCardProps {
  conversation: Conversation;
  onClick: () => void;
}

export default function ConversationCard({ conversation, onClick }: ConversationCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full p-4 bg-white border border-gray-200 rounded-2xl hover:shadow-md transition-all duration-200 text-left"
    >
      <div className="flex items-start gap-3">
        <div className="relative flex-shrink-0">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-white font-medium">
            {getInitials(conversation.name)}
          </div>
          {conversation.isOnline && (
            <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white"></div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-gray-900 truncate">{conversation.name}</h4>
              <p className="text-sm text-gray-500 truncate mt-1 max-w-[200px]">
                {conversation.lastMessage.content.length > 60
                  ? conversation.lastMessage.content.substring(0, 60) + '...'
                  : conversation.lastMessage.content}
              </p>
            </div>

            <div className="flex flex-col items-end gap-1 ml-2">
              <span className="text-xs text-gray-400 whitespace-nowrap">
                {conversation.lastMessage.timestamp}
              </span>
              {conversation.unreadCount > 0 && (
                <div className="min-w-[20px] h-5 px-1.5 bg-[#eb7825] text-white text-xs rounded-full flex items-center justify-center">
                  {conversation.unreadCount}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}
