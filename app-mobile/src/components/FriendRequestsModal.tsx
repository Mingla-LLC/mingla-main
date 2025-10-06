import React, { useState } from 'react';
import { Text, View, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <View style={styles.headerIcon}>
              <Ionicons name="people" size={20} color="white" />
            </View>
            <View>
              <Text style={styles.headerTitle}>Friend Requests</Text>
              <Text style={styles.headerSubtitle}>{requests.length} pending requests</Text>
            </View>
          </View>
          <TouchableOpacity 
            onPress={onClose}
            style={styles.closeButton}
          >
            <Ionicons name="close" size={20} color="#6b7280" />
          </TouchableOpacity>
        </View>

        {/* Content */}
        <ScrollView style={styles.content}>
          {requests.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyStateIcon}>
                <Ionicons name="people" size={32} color="#9ca3af" />
              </View>
              <Text style={styles.emptyStateTitle}>No Friend Requests</Text>
              <Text style={styles.emptyStateText}>
                You're all caught up! New friend requests will appear here.
              </Text>
            </View>
          ) : (
            <View style={styles.requestsList}>
              {requests.map((request) => {
                const status = processedRequests[request.id];
                
                return (
                  <View 
                    key={request.id}
                    style={[
                      styles.requestItem,
                      status === 'accepted' && styles.requestItemAccepted,
                      status === 'declined' && styles.requestItemDeclined
                    ]}
                  >
                    <View style={styles.requestContent}>
                      {/* Avatar */}
                      <View style={styles.avatarContainer}>
                        <View style={styles.avatar}>
                          <Text style={styles.avatarText}>
                            {request.name.split(' ').map(n => n[0]).join('')}
                          </Text>
                        </View>
                      </View>
                      
                      {/* User Info */}
                      <View style={styles.userInfo}>
                        <Text style={styles.userName}>{request.name}</Text>
                        <Text style={styles.userUsername}>@{request.username}</Text>
                        {request.mutualFriends > 0 && (
                          <Text style={styles.mutualFriends}>{request.mutualFriends} mutual friends</Text>
                        )}
                        <Text style={styles.requestTime}>{request.requestedAt}</Text>
                      </View>

                      {/* Action Buttons */}
                      <View style={styles.actionButtons}>
                        {status === 'accepted' ? (
                          <View style={styles.statusAccepted}>
                            <Ionicons name="checkmark" size={16} color="#059669" />
                            <Text style={styles.statusText}>Accepted</Text>
                          </View>
                        ) : status === 'declined' ? (
                          <View style={styles.statusDeclined}>
                            <Ionicons name="close" size={16} color="#dc2626" />
                            <Text style={styles.statusText}>Declined</Text>
                          </View>
                        ) : (
                          <>
                            <TouchableOpacity
                              onPress={() => handleDeclineRequest(request.id)}
                              style={styles.declineButton}
                            >
                              <Ionicons name="person-remove" size={16} color="#6b7280" />
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => handleAcceptRequest(request.id)}
                              style={styles.acceptButton}
                            >
                              <Ionicons name="person-add" size={16} color="white" />
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
        </ScrollView>

        {/* Footer */}
        {requests.length > 0 && (
          <View style={styles.footer}>
            {/* Footer content can be added here if needed */}
          </View>
        )}
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
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  headerContent: {
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
  content: {
    flex: 1,
  },
  emptyState: {
    padding: 32,
    alignItems: 'center',
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
    textAlign: 'center',
  },
  requestsList: {
    padding: 16,
    gap: 12,
  },
  requestItem: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 16,
  },
  requestItemAccepted: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  requestItemDeclined: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  requestContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarContainer: {
    flexShrink: 0,
  },
  avatar: {
    width: 48,
    height: 48,
    backgroundColor: '#eb7825',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: 'white',
    fontWeight: '500',
    fontSize: 16,
  },
  userInfo: {
    flex: 1,
    minWidth: 0,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  userUsername: {
    fontSize: 14,
    color: '#6b7280',
  },
  mutualFriends: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  requestTime: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  statusAccepted: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#dcfce7',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  statusDeclined: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fee2e2',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#059669',
  },
  declineButton: {
    padding: 8,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptButton: {
    padding: 8,
    backgroundColor: '#eb7825',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    backgroundColor: '#f9fafb',
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
});