import React, { useState } from 'react';
import { Text, View, TouchableOpacity } from 'react-native';
import { X, UserCheck, UserX, Check, Users } from 'lucide-react';

interface FriendRequest {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  mutualFriends: number;
  requestedAt: string;
}

interface FriendRequestsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const mockFriendRequests: FriendRequest[] = [
  {
    id: 'req-1',
    name: 'Alex Johnson',
    username: 'alexjohnson',
    avatar: undefined,
    mutualFriends: 7,
    requestedAt: '2 hours ago'
  },
  {
    id: 'req-2', 
    name: 'Emily Chen',
    username: 'emilychen',
    avatar: undefined,
    mutualFriends: 3,
    requestedAt: '1 day ago'
  },
  {
    id: 'req-3',
    name: 'Michael Brown',
    username: 'mikebrown', 
    avatar: undefined,
    mutualFriends: 5,
    requestedAt: '3 days ago'
  }
];

export default function FriendRequestsModal({ isOpen, onClose }: FriendRequestsModalProps) {
  const [requests, setRequests] = useState<FriendRequest[]>(mockFriendRequests);
  const [processedRequests, setProcessedRequests] = useState<{[key: string]: 'accepted' | 'declined'}>({});

  const handleAcceptRequest = (requestId: string) => {
    setProcessedRequests(prev => ({ ...prev, [requestId]: 'accepted' }));
    
    // Remove from requests after animation
    setTimeout(() => {
      setRequests(prev => prev.filter(req => req.id !== requestId));
      setProcessedRequests(prev => {
        const newState = { ...prev };
        delete newState[requestId];
        return newState;
      });
    }, 1500);
  };

  const handleDeclineRequest = (requestId: string) => {
    setProcessedRequests(prev => ({ ...prev, [requestId]: 'declined' }));
    
    // Remove from requests after animation
    setTimeout(() => {
      setRequests(prev => prev.filter(req => req.id !== requestId));
      setProcessedRequests(prev => {
        const newState = { ...prev };
        delete newState[requestId];
        return newState;
      });
    }, 1500);
  };

  if (!isOpen) return null;

  return (
    <View className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <View className="bg-white rounded-2xl w-full max-w-md mx-auto shadow-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <View className="flex items-center justify-between p-6 border-b border-gray-100">
          <View className="flex items-center gap-3">
            <View className="w-10 h-10 bg-[#eb7825] rounded-xl flex items-center justify-center">
              <UserCheck className="w-5 h-5 text-white" />
            </View>
            <View>
              <Text className="font-semibold text-gray-900">Friend Requests</Text>
              <Text className="text-sm text-gray-600">{requests.length} pending requests</Text>
            </View>
          </View>
          <TouchableOpacity 
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </TouchableOpacity>
        </View>

        {/* Content */}
        <View className="flex-1 overflow-y-auto">
          {requests.length === 0 ? (
            <View className="p-8 text-center">
              <View className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="w-8 h-8 text-gray-400" />
              </View>
              <Text className="font-medium text-gray-900 mb-2">No Friend Requests</Text>
              <Text className="text-sm text-gray-600">
                You're all caught up! New friend requests will appear here.
              </Text>
            </View>
          ) : (
            <View className="p-4 space-y-3">
              {requests.map((request) => {
                const status = processedRequests[request.id];
                
                return (
                  <View 
                    key={request.id}
                    className={`bg-gray-50 border border-gray-200 rounded-xl p-4 transition-all duration-300 ${
                      status === 'accepted' ? 'bg-green-50 border-green-200' : 
                      status === 'declined' ? 'bg-red-50 border-red-200' : ''
                    }`}
                  >
                    <View className="flex items-center gap-4">
                      {/* Avatar */}
                      <View className="relative flex-shrink-0">
                        <View className="w-12 h-12 bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-full flex items-center justify-center">
                          <Text className="text-white font-medium">
                            {request.name.split(' ').map(n => n[0]).join('')}
                          </Text>
                        </View>
                      </View>
                      
                      {/* User Info */}
                      <View className="flex-1 min-w-0">
                        <Text className="font-semibold text-gray-900 truncate">{request.name}</Text>
                        <Text className="text-sm text-gray-600 truncate">@{request.username}</Text>
                        {request.mutualFriends > 0 && (
                          <Text className="text-xs text-gray-500">{request.mutualFriends} mutual friends</Text>
                        )}
                        <Text className="text-xs text-gray-400">{request.requestedAt}</Text>
                      </View>

                      {/* Action Buttons */}
                      <View className="flex items-center gap-2 flex-shrink-0">
                        {status === 'accepted' ? (
                          <View className="flex items-center gap-2 text-green-700 bg-green-100 px-3 py-2 rounded-lg">
                            <Check className="w-4 h-4" />
                            <Text className="text-sm font-medium">Accepted</Text>
                          </View>
                        ) : status === 'declined' ? (
                          <View className="flex items-center gap-2 text-red-700 bg-red-100 px-3 py-2 rounded-lg">
                            <X className="w-4 h-4" />
                            <Text className="text-sm font-medium">Declined</Text>
                          </View>
                        ) : (
                          <>
                            <TouchableOpacity
                              onClick={() => handleDeclineRequest(request.id)}
                              className="p-2 bg-gray-200 hover:bg-red-100 hover:text-red-600 rounded-lg transition-colors"
                              title="Decline"
                            >
                              <UserX className="w-4 h-4" />
                            </TouchableOpacity>
                            <TouchableOpacity
                              onClick={() => handleAcceptRequest(request.id)}
                              className="p-2 bg-[#eb7825] hover:bg-[#d6691f] text-white rounded-lg transition-colors"
                              title="Accept"
                            >
                              <UserCheck className="w-4 h-4" />
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Footer */}
        {requests.length > 0 && (
          <View className="p-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">

          </View>
        )}
      </View>
    </View>
  );
}