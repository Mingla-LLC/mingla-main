import React, { useState } from 'react';
import { Text, View, TouchableOpacity, TextInput } from 'react-native';
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
    <View className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <View className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col">
        {/* Header */}
        <View className="flex items-center justify-between p-6 border-b border-gray-100">
          <View>
            <Text className="text-xl font-semibold text-gray-900">Start New Conversation</Text>
            <Text className="text-sm text-gray-600">Choose a friend to message</Text>
          </View>
          <TouchableOpacity
            onClick={onClose}
            className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors"
          >
            <X className="w-4 h-4 text-gray-600" />
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View className="p-4 border-b border-gray-100">
          <View className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <TextInput
              placeholder="Search friends..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={{
                width: '100%',
                paddingLeft: 40,
                paddingRight: 16,
                paddingVertical: 8,
                backgroundColor: '#f9fafb',
                borderWidth: 1,
                borderColor: '#e5e7eb',
                borderRadius: 8,
                fontSize: 16
              }}
            />
          </View>
        </View>

        {/* Friends List */}
        <View className="flex-1 overflow-y-auto p-4">
          {filteredFriends.length === 0 ? (
            <View className="text-center py-8">
              <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <Text className="text-gray-500">
                {searchQuery ? 'No friends found' : 'No friends available'}
              </Text>
              <Text className="text-sm text-gray-400 mt-1">
                {searchQuery ? 'Try a different search term' : 'Add friends to start messaging'}
              </Text>
            </View>
          ) : (
            <View className="space-y-2">
              {filteredFriends.map((friend) => (
                <TouchableOpacity
                  key={friend.id}
                  onClick={() => onSelectFriend(friend)}
                  className="w-full flex items-center gap-3 p-3 bg-gray-50 rounded-xl hover:bg-[#eb7825]/10 hover:border-[#eb7825] border border-transparent transition-all duration-200 group"
                >
                  <View className="relative">
                    {friend.avatar ? (
                      <ImageWithFallback
                        src={friend.avatar}
                        alt={friend.name}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : (
                      <View className="w-10 h-10 bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-full flex items-center justify-center">
                        <Text className="text-white font-medium text-sm">
                          {friend.name.split(' ').map(n => n[0]).join('')}
                        </Text>
                      </View>
                    )}
                    {friend.isOnline && (
                      <View className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
                    )}
                  </View>
                  
                  <View className="flex-1 text-left">
                    <Text className="font-medium text-gray-900 group-hover:text-[#eb7825] transition-colors">
                      {friend.name}
                    </Text>
                    <Text className="text-sm text-gray-600">@{friend.username}</Text>
                  </View>

                  <View className="w-8 h-8 bg-[#eb7825]/10 group-hover:bg-[#eb7825] rounded-lg flex items-center justify-center transition-colors">
                    <MessageSquare className="w-4 h-4 text-[#eb7825] group-hover:text-white" />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Footer */}
        <View className="p-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <Text className="text-xs text-gray-500 text-center">
            Only direct one-on-one conversations are supported
          </Text>
        </View>
      </View>
    </View>
  );
}