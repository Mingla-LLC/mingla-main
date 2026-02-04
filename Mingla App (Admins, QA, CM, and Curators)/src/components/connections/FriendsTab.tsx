import React, { useState } from 'react';
import {
  Search, UserPlus, QrCode, Link, MessageSquare,
  Copy, Check, MoreHorizontal, Bell, BellOff,
  UserMinus, Shield, Flag, Bookmark, ChevronDown, ChevronUp, UserCheck
} from 'lucide-react';
import { Friend } from './types';
import { filterFriends, getInitials, getStatusColor } from './utils';
import FriendCard from './FriendCard';

interface FriendsTabProps {
  friends: Friend[];
  onAddFriend: () => void;
  onShowRequests: () => void;
  onShowBlockList: () => void;
  onToggleQRCode: () => void;
  showQRCode: boolean;
  inviteCopied: boolean;
  onCopyInviteLink: () => void;
  onMessageFriend: (friend: Friend) => void;
  onAddToBoard: (friend: Friend) => void;
  onBlockUser: (friend: Friend) => void;
  onReportUser: (friend: Friend) => void;
  onMuteFriend: (friend: Friend) => void;
  onUnmuteFriend: (friend: Friend) => void;
  onRemoveFriend: (friend: Friend) => void;
  mutedFriends?: Set<string>;
}

export default function FriendsTab({
  friends,
  onAddFriend,
  onShowRequests,
  onShowBlockList,
  onToggleQRCode,
  showQRCode,
  inviteCopied,
  onCopyInviteLink,
  onMessageFriend,
  onAddToBoard,
  onBlockUser,
  onReportUser,
  onMuteFriend,
  onUnmuteFriend,
  onRemoveFriend,
  mutedFriends = new Set()
}: FriendsTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [friendsListExpanded, setFriendsListExpanded] = useState(true);

  const filteredFriends = filterFriends(friends, searchQuery);
  const displayedFriends = friendsListExpanded ? filteredFriends : filteredFriends.slice(0, 3);

  return (
    <div className="space-y-4 px-4 pt-6">
      {/* Action Buttons */}
      <div className="flex gap-1">
        <button
          onClick={onAddFriend}
          className="px-2 py-1 glass-card rounded-full card-elevated flex items-center gap-1 group spring-in flex-shrink-0"
        >
          <div className="w-5 h-5 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center group-hover:scale-110 transition-smooth shadow-md flex-shrink-0">
            <UserPlus className="w-3 h-3 text-white" />
          </div>
          <span className="text-[11px] font-medium text-gray-700 whitespace-nowrap">Add</span>
        </button>

        <button
          onClick={onShowRequests}
          className="px-2 py-1 bg-white border border-gray-200 rounded-full hover:shadow-md transition-all duration-200 flex items-center gap-1 group flex-shrink-0"
        >
          <div className="w-5 h-5 bg-gradient-to-br from-orange-500 to-orange-600 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform flex-shrink-0">
            <UserCheck className="w-3 h-3 text-white" />
          </div>
          <span className="text-[11px] font-medium text-gray-700 whitespace-nowrap">Requests</span>
        </button>

        <button
          onClick={onShowBlockList}
          className="px-2 py-1 bg-white border border-gray-200 rounded-full hover:shadow-md transition-all duration-200 flex items-center gap-1 group flex-shrink-0"
        >
          <div className="w-5 h-5 bg-gradient-to-br from-red-500 to-red-600 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform flex-shrink-0">
            <Shield className="w-3 h-3 text-white" />
          </div>
          <span className="text-[11px] font-medium text-gray-700 whitespace-nowrap">Blocked</span>
        </button>

        <button
          onClick={onCopyInviteLink}
          className="px-2 py-1 bg-white border border-gray-200 rounded-full hover:shadow-md transition-all duration-200 flex items-center gap-1 group flex-shrink-0"
        >
          <div className="w-5 h-5 bg-gradient-to-br from-green-500 to-green-600 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform flex-shrink-0">
            {inviteCopied ? <Check className="w-3 h-3 text-white" /> : <Link className="w-3 h-3 text-white" />}
          </div>
          <span className="text-[11px] font-medium text-gray-700 whitespace-nowrap">{inviteCopied ? 'Copied!' : 'Invite'}</span>
        </button>
      </div>

      {/* Search Bar */}
      <div className="relative slide-up">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          placeholder="Search friends..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-12 pr-4 py-3 glass-input rounded-2xl focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-smooth"
        />
      </div>

      {/* QR Code Display */}
      {showQRCode && (
        <div className="p-6 bg-white border border-gray-200 rounded-2xl text-center">
          <div className="w-48 h-48 mx-auto bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
            <div className="text-6xl">📱</div>
          </div>
          <h3 className="font-semibold text-gray-900 mb-2">Scan to Connect</h3>
          <p className="text-sm text-gray-600">
            Have your friends scan this QR code to add you
          </p>
        </div>
      )}

      {/* Friends List */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">
            {friends.length} {friends.length === 1 ? 'Friend' : 'Friends'}
          </h3>
          {filteredFriends.length > 3 && (
            <button
              onClick={() => setFriendsListExpanded(!friendsListExpanded)}
              className="text-sm text-[#eb7825] hover:text-[#d6691f] flex items-center gap-1"
            >
              {friendsListExpanded ? (
                <>
                  Show Less <ChevronUp className="w-4 h-4" />
                </>
              ) : (
                <>
                  Show All ({filteredFriends.length}) <ChevronDown className="w-4 h-4" />
                </>
              )}
            </button>
          )}
        </div>

        <div className="space-y-3">
          {filteredFriends.length === 0 && searchQuery.trim() ? (
            <div className="text-center py-8 text-gray-500">
              <Search className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No friends found</p>
              <p className="text-sm">Try searching with different keywords</p>
            </div>
          ) : (
            displayedFriends.map((friend) => (
              <FriendCard
                key={friend.id}
                friend={friend}
                isMuted={mutedFriends.has(friend.id)}
                onMessage={() => onMessageFriend(friend)}
                onAddToBoard={() => onAddToBoard(friend)}
                onMute={() => onMuteFriend(friend)}
                onUnmute={() => onUnmuteFriend(friend)}
                onBlock={() => onBlockUser(friend)}
                onReport={() => onReportUser(friend)}
                onRemove={() => onRemoveFriend(friend)}
              />
            ))
          )}

          {!friendsListExpanded && filteredFriends.length > 3 && (
            <button
              onClick={() => setFriendsListExpanded(true)}
              className="w-full py-3 text-center text-sm text-gray-500 hover:text-gray-700 border border-dashed border-gray-300 rounded-2xl hover:border-gray-400 transition-colors"
            >
              Show {filteredFriends.length - 3} more friends
            </button>
          )}
        </div>
      </div>
    </div>
  );
}