import React, { useState } from 'react';
import { Text, View, TouchableOpacity, TextInput, StyleSheet, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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

  if (!isOpen) return null;

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIcon}>
                <Ionicons 
                  name={activeTab === 'add' ? 'person-add' : 'time'} 
                  size={20} 
                  color="white" 
                />
              </View>
              <View>
                <Text style={styles.headerTitle}>
                  {activeTab === 'add' ? 'Add Friend' : 'Sent Requests'}
                </Text>
                <Text style={styles.headerSubtitle}>
                  {activeTab === 'add' ? 'Send a friend request' : 'Manage pending requests'}
                </Text>
              </View>
            </View>
            <TouchableOpacity 
              onPress={handleClose}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View style={styles.tabsContainer}>
            <TouchableOpacity
              onPress={() => {
                setActiveTab('add');
                setSearchInput('');
                setSearchResult(null);
                setRequestSent(false);
                setError('');
              }}
              style={[
                styles.tab,
                activeTab === 'add' && styles.tabActive
              ]}
            >
              <Ionicons 
                name="person-add" 
                size={16} 
                color={activeTab === 'add' ? '#eb7825' : '#6b7280'} 
              />
              <Text style={[
                styles.tabText,
                activeTab === 'add' && styles.tabTextActive
              ]}>Add Friend</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab('sent')}
              style={[
                styles.tab,
                activeTab === 'sent' && styles.tabActive,
                { position: 'relative' }
              ]}
            >
              <Ionicons 
                name="time" 
                size={16} 
                color={activeTab === 'sent' ? '#eb7825' : '#6b7280'} 
              />
              <Text style={[
                styles.tabText,
                activeTab === 'sent' && styles.tabTextActive
              ]}>Sent</Text>
              {sentRequests.length > 0 && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{sentRequests.length}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Content */}
        <ScrollView style={styles.content}>
          {activeTab === 'add' ? (
            <View style={styles.addTabContent}>
              {/* Search Input */}
              <View style={styles.searchSection}>
                <Text style={styles.searchLabel}>
                  Username or Email
                </Text>
                <View style={styles.searchInputContainer}>
                  <View style={styles.searchInputIcon}>
                    <Ionicons 
                      name={searchInput.includes('@') ? 'mail' : 'at'} 
                      size={16} 
                      color="#9ca3af" 
                    />
                  </View>
                  <TextInput
                    value={searchInput}
                    onChangeText={setSearchInput}
                    placeholder="Enter username or email..."
                    style={styles.searchInput}
                    editable={!isLoading}
                  />
                </View>
                {error && (
                  <View style={styles.errorContainer}>
                    <Ionicons name="alert-circle" size={16} color="#dc2626" />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}
              </View>

              {/* Search Button */}
              {!searchResult && (
                <TouchableOpacity
                  onPress={handleSearch}
                  disabled={!searchInput.trim() || isLoading}
                  style={[
                    styles.searchButton,
                    (!searchInput.trim() || isLoading) && styles.searchButtonDisabled
                  ]}
                >
                  {isLoading ? (
                    <>
                      <View style={styles.loadingSpinner} />
                      <Text style={styles.searchButtonText}>Searching...</Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="person-add" size={16} color="white" />
                      <Text style={styles.searchButtonText}>Search User</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}

              {/* Search Result */}
              {searchResult && (
                <View style={styles.searchResult}>
                  <View style={styles.searchResultHeader}>
                    <View style={styles.searchResultAvatar}>
                      <Text style={styles.searchResultAvatarText}>
                        {searchResult.name.split(' ').map((n: string) => n[0]).join('')}
                      </Text>
                    </View>
                    <View style={styles.searchResultInfo}>
                      <Text style={styles.searchResultName}>{searchResult.name}</Text>
                      <Text style={styles.searchResultUsername}>@{searchResult.username}</Text>
                      {searchResult.mutualFriends > 0 && (
                        <Text style={styles.searchResultMutual}>
                          {searchResult.mutualFriends} mutual friends
                        </Text>
                      )}
                    </View>
                  </View>

                  {requestSent ? (
                    <View style={styles.successMessage}>
                      <Ionicons name="checkmark" size={16} color="#059669" />
                      <Text style={styles.successText}>Friend request sent!</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={handleSendRequest}
                      disabled={isLoading}
                      style={[
                        styles.sendButton,
                        isLoading && styles.sendButtonDisabled
                      ]}
                    >
                      {isLoading ? (
                        <>
                          <View style={styles.loadingSpinner} />
                          <Text style={styles.sendButtonText}>Sending...</Text>
                        </>
                      ) : (
                        <>
                          <Ionicons name="send" size={16} color="white" />
                          <Text style={styles.sendButtonText}>Send Friend Request</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Tips */}
              <View style={styles.tipsContainer}>
                <Text style={styles.tipsTitle}>Tips:</Text>
                <View style={styles.tipsList}>
                  <Text style={styles.tipItem}>• Enter their exact username (e.g., @johndoe)</Text>
                  <Text style={styles.tipItem}>• Or use their email address</Text>
                  <Text style={styles.tipItem}>• Make sure the spelling is correct</Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.sentTabContent}>
              {/* Sent Requests List */}
              {sentRequests.length === 0 ? (
                <View style={styles.emptyState}>
                  <View style={styles.emptyStateIcon}>
                    <Ionicons name="time" size={32} color="#9ca3af" />
                  </View>
                  <Text style={styles.emptyStateTitle}>No Sent Requests</Text>
                  <Text style={styles.emptyStateText}>
                    You haven't sent any friend requests yet.
                  </Text>
                  <TouchableOpacity
                    onPress={() => setActiveTab('add')}
                    style={styles.emptyStateButton}
                  >
                    <Ionicons name="person-add" size={16} color="white" />
                    <Text style={styles.emptyStateButtonText}>Add Friends</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.sentRequestsList}>
                  {sentRequests.map((request) => (
                    <View key={request.id} style={styles.sentRequestItem}>
                      <View style={styles.sentRequestHeader}>
                        <View style={styles.sentRequestAvatar}>
                          <Text style={styles.sentRequestAvatarText}>
                            {request.user.name.split(' ').map((n: string) => n[0]).join('')}
                          </Text>
                        </View>
                        <View style={styles.sentRequestInfo}>
                          <Text style={styles.sentRequestName}>{request.user.name}</Text>
                          <Text style={styles.sentRequestUsername}>@{request.user.username}</Text>
                          <View style={styles.sentRequestMeta}>
                            <Text style={styles.sentRequestTime}>
                              Sent {formatTimeAgo(request.sentAt)}
                            </Text>
                            {request.user.mutualFriends > 0 && (
                              <>
                                <Text style={styles.sentRequestSeparator}>•</Text>
                                <Text style={styles.sentRequestMutual}>
                                  {request.user.mutualFriends} mutual friends
                                </Text>
                              </>
                            )}
                          </View>
                        </View>
                        <TouchableOpacity
                          onPress={() => handleUnsendRequest(request.id)}
                          style={styles.unsendButton}
                        >
                          <Ionicons name="person-remove" size={16} color="#6b7280" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
        </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    backgroundColor: 'white',
    borderRadius: 16,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 16,
  },
  header: {
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIcon: {
    width: 40,
    height: 40,
    backgroundColor: '#eb7825',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#6b7280',
  },
  closeButton: {
    padding: 8,
    borderRadius: 12,
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6b7280',
  },
  tabTextActive: {
    color: '#eb7825',
  },
  tabBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 20,
    height: 20,
    backgroundColor: '#eb7825',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeText: {
    fontSize: 12,
    color: 'white',
    fontWeight: '500',
  },
  content: {
    padding: 24,
  },
  addTabContent: {
    gap: 24,
  },
  searchSection: {
    gap: 8,
  },
  searchLabel: {
    color: '#374151',
    fontWeight: '500',
    fontSize: 14,
  },
  searchInputContainer: {
    position: 'relative',
  },
  searchInputIcon: {
    position: 'absolute',
    left: 12,
    top: '50%',
    transform: [{ translateY: -8 }],
    zIndex: 1,
  },
  searchInput: {
    width: '100%',
    paddingLeft: 40,
    paddingRight: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    fontSize: 16,
    backgroundColor: 'white',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  errorText: {
    fontSize: 14,
    color: '#dc2626',
  },
  searchButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#eb7825',
    borderRadius: 12,
  },
  searchButtonDisabled: {
    backgroundColor: '#d1d5db',
  },
  searchButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
  loadingSpinner: {
    width: 16,
    height: 16,
    borderWidth: 2,
    borderColor: 'white',
    borderTopColor: 'transparent',
    borderRadius: 8,
  },
  searchResult: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 16,
    gap: 16,
  },
  searchResultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  searchResultAvatar: {
    width: 48,
    height: 48,
    backgroundColor: '#eb7825',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchResultAvatarText: {
    color: 'white',
    fontWeight: '500',
    fontSize: 16,
  },
  searchResultInfo: {
    flex: 1,
  },
  searchResultName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  searchResultUsername: {
    fontSize: 14,
    color: '#6b7280',
  },
  searchResultMutual: {
    fontSize: 12,
    color: '#6b7280',
  },
  successMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    backgroundColor: '#f0fdf4',
    borderRadius: 8,
  },
  successText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#059669',
  },
  sendButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#eb7825',
    borderRadius: 12,
  },
  sendButtonDisabled: {
    backgroundColor: '#d1d5db',
  },
  sendButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
  tipsContainer: {
    backgroundColor: '#fef3e2',
    borderWidth: 1,
    borderColor: '#fed7aa',
    borderRadius: 12,
    padding: 16,
  },
  tipsTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#eb7825',
    marginBottom: 8,
  },
  tipsList: {
    gap: 4,
  },
  tipItem: {
    fontSize: 14,
    color: '#374151',
  },
  sentTabContent: {
    gap: 16,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyStateIcon: {
    width: 64,
    height: 64,
    backgroundColor: '#f3f4f6',
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 24,
    textAlign: 'center',
  },
  emptyStateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#eb7825',
    borderRadius: 12,
  },
  emptyStateButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
  },
  sentRequestsList: {
    gap: 12,
  },
  sentRequestItem: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 16,
  },
  sentRequestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sentRequestAvatar: {
    width: 48,
    height: 48,
    backgroundColor: '#eb7825',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sentRequestAvatarText: {
    color: 'white',
    fontWeight: '500',
    fontSize: 16,
  },
  sentRequestInfo: {
    flex: 1,
  },
  sentRequestName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  sentRequestUsername: {
    fontSize: 14,
    color: '#6b7280',
  },
  sentRequestMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  sentRequestTime: {
    fontSize: 12,
    color: '#6b7280',
  },
  sentRequestSeparator: {
    fontSize: 12,
    color: '#d1d5db',
  },
  sentRequestMutual: {
    fontSize: 12,
    color: '#6b7280',
  },
  unsendButton: {
    padding: 8,
    borderRadius: 8,
  },
});