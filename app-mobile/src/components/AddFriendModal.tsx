import React, { useState } from 'react';
import { Text, View, TouchableOpacity, TextInput } from 'react-native';
import { X, UserPlus, Mail, AtSign, Send, Check, AlertCircle, Clock, UserX } from 'lucide-react';

interface AddFriendModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AddFriendModal({ isOpen, onClose }: AddFriendModalProps) {
  const [activeTab, setActiveTab] = useState<'add' | 'sent'>('add');
  const [searchInput, setSearchInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<any>(null);
  const [requestSent, setRequestSent] = useState(false);
  const [error, setError] = useState('');

  // Mock sent requests data - in real app this would come from backend
  const [sentRequests, setSentRequests] = useState([
    {
      id: 'req-1',
      user: {
        id: 'user-456',
        name: 'Sarah Johnson',
        username: 'sarahj',
        email: 'sarah@example.com',
        avatar: null,
        mutualFriends: 2
      },
      sentAt: '2024-01-15T10:30:00Z',
      status: 'pending'
    },
    {
      id: 'req-2',
      user: {
        id: 'user-789',
        name: 'Mike Chen',
        username: 'mikechen',
        email: 'mike@example.com',
        avatar: null,
        mutualFriends: 5
      },
      sentAt: '2024-01-14T15:45:00Z',
      status: 'pending'
    }
  ]);

  const handleSearch = async () => {
    if (!searchInput.trim()) {
      setError('Please enter a username or email');
      return;
    }

    setIsLoading(true);
    setError('');
    setSearchResult(null);
    setRequestSent(false);

    // Simulate API call to search for user
    setTimeout(() => {
      // Mock user data - in real app this would come from backend
      if (searchInput.toLowerCase().includes('john') || searchInput.includes('@')) {
        setSearchResult({
          id: 'user-123',
          name: 'John Doe',
          username: 'johndoe',
          email: 'john@example.com',
          avatar: null,
          mutualFriends: 3,
          isAlreadyFriend: false
        });
      } else {
        setError('User not found. Please check the username or email and try again.');
      }
      setIsLoading(false);
    }, 1500);
  };

  const handleSendRequest = () => {
    setIsLoading(true);
    
    // Simulate sending friend request
    setTimeout(() => {
      setRequestSent(true);
      setIsLoading(false);
      
      // Auto close modal after success
      setTimeout(() => {
        onClose();
        // Reset state when closing
        setSearchInput('');
        setSearchResult(null);
        setRequestSent(false);
        setError('');
      }, 2000);
    }, 1000);
  };

  const handleUnsendRequest = (requestId: string) => {
    setSentRequests(prev => prev.filter(req => req.id !== requestId));
    // In real app, this would call API to cancel the friend request
    console.log('Friend request unsent:', requestId);
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return 'Just now';
    if (diffInHours < 24) return `${diffInHours}h ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays}d ago`;
    return date.toLocaleDateString();
  };

  const handleClose = () => {
    onClose();
    // Reset state when closing
    setActiveTab('add');
    setSearchInput('');
    setSearchResult(null);
    setRequestSent(false);
    setError('');
    setIsLoading(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isLoading) {
      if (!searchResult) {
        handleSearch();
      } else if (!requestSent) {
        handleSendRequest();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <View className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <View className="bg-white rounded-2xl w-full max-w-md mx-auto shadow-2xl">
        {/* Header */}
        <View className="p-6 border-b border-gray-100">
          <View className="flex items-center justify-between mb-4">
            <View className="flex items-center gap-3">
              <View className="w-10 h-10 bg-[#eb7825] rounded-xl flex items-center justify-center">
                {activeTab === 'add' ? (
                  <UserPlus className="w-5 h-5 text-white" />
                ) : (
                  <Clock className="w-5 h-5 text-white" />
                )}
              </View>
              <View>
                <Text className="font-semibold text-gray-900">
                  {activeTab === 'add' ? 'Add Friend' : 'Sent Requests'}
                </Text>
                <Text className="text-sm text-gray-600">
                  {activeTab === 'add' ? 'Send a friend request' : 'Manage pending requests'}
                </Text>
              </View>
            </View>
            <TouchableOpacity 
              onClick={handleClose}
              className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View className="flex bg-gray-100 rounded-xl p-1">
            <TouchableOpacity
              onClick={() => {
                setActiveTab('add');
                setSearchInput('');
                setSearchResult(null);
                setRequestSent(false);
                setError('');
              }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg transition-all ${
                activeTab === 'add' 
                  ? 'bg-white text-[#eb7825] shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <UserPlus className="w-4 h-4" />
              <Text className="font-medium">Add Friend</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onClick={() => setActiveTab('sent')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg transition-all relative ${
                activeTab === 'sent' 
                  ? 'bg-white text-[#eb7825] shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Clock className="w-4 h-4" />
              <Text className="font-medium">Sent</Text>
              {sentRequests.length > 0 && (
                <View className="absolute -top-1 -right-1 w-5 h-5 bg-[#eb7825] rounded-full flex items-center justify-center">
                  <Text className="text-xs text-white font-medium">{sentRequests.length}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Content */}
        <View className="p-6">
          {activeTab === 'add' ? (
            <View className="space-y-6">
              {/* Search Input */}
              <View className="space-y-2">
                <Text style={{ color: '#374151', fontWeight: '500', fontSize: 14 }}>
                  Username or Email
                </Text>
                <View className="relative">
                  <View className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center">
                    {searchInput.includes('@') ? (
                      <Mail className="w-4 h-4 text-gray-400" />
                    ) : (
                      <AtSign className="w-4 h-4 text-gray-400" />
                    )}
                  </View>
                  <TextInput
                    value={searchInput}
                    onChangeText={setSearchInput}
                    placeholder="Enter username or email..."
                    style={{
                      width: '100%',
                      paddingLeft: 40,
                      paddingRight: 16,
                      paddingVertical: 12,
                      borderWidth: 1,
                      borderColor: '#e5e7eb',
                      borderRadius: 12,
                      fontSize: 16,
                      backgroundColor: 'white'
                    }}
                    editable={!isLoading}
                  />
                </View>
                {error && (
                  <View className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <Text>{error}</Text>
                  </View>
                )}
              </View>

              {/* Search Button */}
              {!searchResult && (
                <TouchableOpacity
                  onClick={handleSearch}
                  disabled={!searchInput.trim() || isLoading}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-[#eb7825] hover:bg-[#d6691f] disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl transition-colors"
                >
                  {isLoading ? (
                    <>
                      <View className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <Text>Searching...</Text>
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" />
                      <Text>Search User</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}

              {/* Search Result */}
              {searchResult && (
                <View className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-4">
                  <View className="flex items-center gap-3">
                    <View className="w-12 h-12 bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-full flex items-center justify-center">
                      <Text className="text-white font-medium">
                        {searchResult.name.split(' ').map((n: string) => n[0]).join('')}
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text className="font-semibold text-gray-900">{searchResult.name}</Text>
                      <Text className="text-sm text-gray-600">@{searchResult.username}</Text>
                      {searchResult.mutualFriends > 0 && (
                        <Text className="text-xs text-gray-500">{searchResult.mutualFriends} mutual friends</Text>
                      )}
                    </View>
                  </View>

                  {requestSent ? (
                    <View className="flex items-center justify-center gap-2 py-3 bg-green-50 text-green-700 rounded-lg">
                      <Check className="w-4 h-4" />
                      <Text className="font-medium">Friend request sent!</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      onClick={handleSendRequest}
                      disabled={isLoading}
                      className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-[#eb7825] hover:bg-[#d6691f] disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl transition-colors"
                    >
                      {isLoading ? (
                        <>
                          <View className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <Text>Sending...</Text>
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          <Text>Send Friend Request</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Tips */}
              <View className="bg-orange-50 border border-[#eb7825]/20 rounded-xl p-4">
                <Text className="font-medium text-[#eb7825] mb-2">Tips:</Text>
                <ul className="text-sm text-gray-700 space-y-1">
                  <li>• Enter their exact username (e.g., @johndoe)</li>
                  <li>• Or use their email address</li>
                  <li>• Make sure the spelling is correct</li>
                </ul>
              </View>
            </View>
          ) : (
            <View className="space-y-4">
              {/* Sent Requests List */}
              {sentRequests.length === 0 ? (
                <View className="text-center py-12">
                  <View className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Clock className="w-8 h-8 text-gray-400" />
                  </View>
                  <Text className="font-medium text-gray-900 mb-2">No Sent Requests</Text>
                  <Text className="text-sm text-gray-600 mb-6">
                    You haven't sent any friend requests yet.
                  </Text>
                  <TouchableOpacity
                    onClick={() => setActiveTab('add')}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-[#eb7825] hover:bg-[#d6691f] text-white rounded-xl transition-colors"
                  >
                    <UserPlus className="w-4 h-4" />
                    <Text>Add Friends</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <View className="space-y-3">
                    {sentRequests.map((request) => (
                      <View
                        key={request.id}
                        className="bg-gray-50 border border-gray-200 rounded-xl p-4"
                      >
                        <View className="flex items-center gap-3">
                          <View className="w-12 h-12 bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-full flex items-center justify-center">
                            <Text className="text-white font-medium">
                              {request.user.name.split(' ').map((n: string) => n[0]).join('')}
                            </Text>
                          </View>
                          <View className="flex-1">
                            <Text className="font-semibold text-gray-900">{request.user.name}</Text>
                            <Text className="text-sm text-gray-600">@{request.user.username}</Text>
                            <View className="flex items-center gap-3 mt-1">
                              <Text className="text-xs text-gray-500">
                                Sent {formatTimeAgo(request.sentAt)}
                              </Text>
                              {request.user.mutualFriends > 0 && (
                                <>
                                  <Text className="text-xs text-gray-300">•</Text>
                                  <Text className="text-xs text-gray-500">
                                    {request.user.mutualFriends} mutual friends
                                  </Text>
                                </>
                              )}
                            </View>
                          </View>
                          <TouchableOpacity
                            onClick={() => handleUnsendRequest(request.id)}
                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            title="Unsend request"
                          >
                            <UserX className="w-4 h-4" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>

                  {/* Info */}

                </>
              )}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}