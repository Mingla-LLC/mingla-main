import React, { useState } from 'react';
import { X, Search, MessageSquare, Users } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';

interface Friend {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  isOnline: boolean;
  lastSeen?: string;
}

interface FriendSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFriend: (friend: Friend) => void;
  friends: Friend[];
}

export default function FriendSelectionModal({
  isOpen,
  onClose,
  onSelectFriend,
  friends
}: FriendSelectionModalProps) {
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) return null;

  const filteredFriends = friends.filter(friend =>
    friend.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    friend.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Start New Conversation</h2>
            <p className="text-sm text-gray-600">Choose a friend to message</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors"
          >
            <X className="w-4 h-4 text-gray-600" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search friends..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#eb7825] focus:border-transparent"
            />
          </div>
        </div>

        {/* Friends List */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredFriends.length === 0 ? (
            <div className="text-center py-8">
              <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">
                {searchQuery ? 'No friends found' : 'No friends available'}
              </p>
              <p className="text-sm text-gray-400 mt-1">
                {searchQuery ? 'Try a different search term' : 'Add friends to start messaging'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredFriends.map((friend) => (
                <button
                  key={friend.id}
                  onClick={() => onSelectFriend(friend)}
                  className="w-full flex items-center gap-3 p-3 bg-gray-50 rounded-xl hover:bg-[#eb7825]/10 hover:border-[#eb7825] border border-transparent transition-all duration-200 group"
                >
                  <div className="relative">
                    {friend.avatar ? (
                      <ImageWithFallback
                        src={friend.avatar}
                        alt={friend.name}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 bg-[#eb7825] rounded-full flex items-center justify-center">
                        <span className="text-white font-medium text-sm">
                          {friend.name.split(' ').map(n => n[0]).join('')}
                        </span>
                      </div>
                    )}
                    {friend.isOnline && (
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
                    )}
                  </div>
                  
                  <div className="flex-1 text-left">
                    <h4 className="font-medium text-gray-900 group-hover:text-[#eb7825] transition-colors">
                      {friend.name}
                    </h4>
                    <p className="text-sm text-gray-600">@{friend.username}</p>
                  </div>

                  <div className="w-8 h-8 bg-[#eb7825]/10 group-hover:bg-[#eb7825] rounded-lg flex items-center justify-center transition-colors">
                    <MessageSquare className="w-4 h-4 text-[#eb7825] group-hover:text-white" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <p className="text-xs text-gray-500 text-center">
            Only direct one-on-one conversations are supported
          </p>
        </div>
      </div>
    </div>
  );
}