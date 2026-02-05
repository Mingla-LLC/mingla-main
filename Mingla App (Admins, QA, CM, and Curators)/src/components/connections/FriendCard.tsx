import React, { useState } from 'react';
import {
  MessageSquare, MoreHorizontal, Bell, BellOff,
  UserMinus, Shield, Flag, Bookmark
} from 'lucide-react';
import { Friend } from './types';
import { getInitials, getStatusColor } from './utils';

interface FriendCardProps {
  friend: Friend;
  isMuted: boolean;
  onMessage: () => void;
  onAddToBoard: () => void;
  onMute: () => void;
  onUnmute: () => void;
  onBlock: () => void;
  onReport: () => void;
  onRemove: () => void;
}

export default function FriendCard({
  friend,
  isMuted,
  onMessage,
  onAddToBoard,
  onMute,
  onUnmute,
  onBlock,
  onReport,
  onRemove
}: FriendCardProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const handleToggleDropdown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDropdownOpen(!dropdownOpen);
  };

  const handleDropdownAction = (action: () => void) => {
    action();
    setDropdownOpen(false);
  };

  return (
    <div className="p-4 glass-card rounded-2xl card-elevated relative spring-in">
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className="relative">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-white font-medium shadow-lg transition-transform duration-300 hover:scale-110">
            {getInitials(friend.name)}
          </div>
          <div className={`absolute -bottom-1 -right-1 w-4 h-4 ${getStatusColor(friend.status)} rounded-full border-2 border-white shadow-sm`}></div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-gray-900 truncate">{friend.name}</h4>
          <p className="text-sm text-gray-500">@{friend.username}</p>
          {friend.mutualFriends && (
            <p className="text-xs text-gray-400 mt-0.5">
              {friend.mutualFriends} mutual friends
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onMessage}
            className="w-9 h-9 bg-[#eb7825] text-white rounded-full flex items-center justify-center hover:bg-[#d6691f] transition-smooth hover:scale-110 shadow-md active:scale-95"
          >
            <MessageSquare className="w-4 h-4" />
          </button>

          {/* Dropdown Menu */}
          <div className="relative">
            <button
              onClick={handleToggleDropdown}
              className="w-9 h-9 glass-button rounded-full flex items-center justify-center hover:scale-110 shadow-md active:scale-95"
            >
              <MoreHorizontal className="w-4 h-4 text-gray-600" />
            </button>

            {dropdownOpen && (
              <>
                {/* Backdrop */}
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setDropdownOpen(false)}
                />

                {/* Dropdown */}
                <div className="absolute right-0 top-full mt-2 w-56 glass-card rounded-xl shadow-xl z-20 overflow-hidden spring-in">
                  <button
                    onClick={() => handleDropdownAction(onAddToBoard)}
                    className="w-full px-4 py-3 text-left text-sm text-gray-700 hover:bg-white/70 flex items-center gap-3 transition-smooth"
                  >
                    <Bookmark className="w-4 h-4 text-gray-500" />
                    <span>Add to Board</span>
                  </button>

                  <button
                    onClick={() => handleDropdownAction(isMuted ? onUnmute : onMute)}
                    className="w-full px-4 py-3 text-left text-sm text-gray-700 hover:bg-white/70 flex items-center gap-3 transition-smooth"
                  >
                    {isMuted ? (
                      <>
                        <Bell className="w-4 h-4 text-gray-500" />
                        <span>Unmute</span>
                      </>
                    ) : (
                      <>
                        <BellOff className="w-4 h-4 text-gray-500" />
                        <span>Mute</span>
                      </>
                    )}
                  </button>

                  <div className="border-t border-gray-100" />

                  <button
                    onClick={() => handleDropdownAction(onBlock)}
                    className="w-full px-4 py-3 text-left text-sm text-red-600 hover:bg-red-50/70 flex items-center gap-3 transition-smooth"
                  >
                    <Shield className="w-4 h-4" />
                    <span>Block User</span>
                  </button>

                  <button
                    onClick={() => handleDropdownAction(onReport)}
                    className="w-full px-4 py-3 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors"
                  >
                    <Flag className="w-4 h-4" />
                    <span>Report User</span>
                  </button>

                  <div className="border-t border-gray-100" />

                  <button
                    onClick={() => handleDropdownAction(onRemove)}
                    className="w-full px-4 py-3 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors"
                  >
                    <UserMinus className="w-4 h-4" />
                    <span>Remove Friend</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
