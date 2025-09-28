import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Alert,
  Image,
  Modal,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFriends, Friend, FriendRequest } from '../hooks/useFriends';
import { useMessages, Conversation, Message } from '../hooks/useMessages';
import { useAppStore } from '../store/appStore';
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '../services/supabase';

export default function ConnectionsScreen() {
  const [activeTab, setActiveTab] = useState<'friends' | 'messages'>('friends');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  
  // Enhanced Friends List features
  const [showAddFriendModal, setShowAddFriendModal] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [recentlyRemoved, setRecentlyRemoved] = useState<{friend: Friend, timestamp: number} | null>(null);
  const [showBlockReportModal, setShowBlockReportModal] = useState(false);
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
  
  // Enhanced Messages features
  const [showShareCardModal, setShowShareCardModal] = useState(false);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [selectedCard, setSelectedCard] = useState<any>(null);
  const [groupName, setGroupName] = useState('');
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<string[]>([]);
  
  // Smart Context Actions
  const [showFriendActionsModal, setShowFriendActionsModal] = useState(false);
  const [showInviteToBoardModal, setShowInviteToBoardModal] = useState(false);
  const [showPlanDateModal, setShowPlanDateModal] = useState(false);
  const [showShareSavedCardModal, setShowShareSavedCardModal] = useState(false);
  const [selectedFriendForActions, setSelectedFriendForActions] = useState<Friend | null>(null);
  const [savedExperiences, setSavedExperiences] = useState<any[]>([]);
  const [loadingSavedExperiences, setLoadingSavedExperiences] = useState(false);
  const [boards, setBoards] = useState<any[]>([]);
  const [loadingBoards, setLoadingBoards] = useState(false);
  
  // Undo/Redo System
  const [undoSnackbar, setUndoSnackbar] = useState<{show: boolean, message: string, action: () => void} | null>(null);
  const [recentlyDeletedFriend, setRecentlyDeletedFriend] = useState<{friend: Friend, timestamp: number} | null>(null);
  const [recentlyDeletedMessage, setRecentlyDeletedMessage] = useState<{messageId: string, timestamp: number} | null>(null);

  const { user } = useAppStore();
  
  const {
    friends,
    friendRequests,
    loading: friendsLoading,
    fetchFriends,
    loadFriendRequests,
    addFriend,
    acceptFriendRequest,
    declineFriendRequest,
    removeFriend,
  } = useFriends();

  const {
    conversations,
    currentConversation,
    loading: messagesLoading,
    fetchMessages,
    sendMessage,
    setCurrentConversation,
  } = useMessages();

  // Load data when screen is focused
  useFocusEffect(
    useCallback(() => {
      if (user?.id) {
        fetchFriends();
        loadFriendRequests();
        fetchMessages();
      }
    }, [user?.id, fetchFriends, loadFriendRequests, fetchMessages])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        fetchFriends(),
        loadFriendRequests(),
        fetchMessages(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const handleSendFriendRequest = async (friendId: string) => {
    try {
      await addFriend(friendId);
      Alert.alert('Success', 'Friend request sent!');
    } catch (error) {
      Alert.alert('Error', 'Failed to send friend request');
    }
  };

  const handleAcceptFriendRequest = async (requestId: string) => {
    try {
      await acceptFriendRequest(requestId);
      Alert.alert('Success', 'Friend request accepted!');
    } catch (error) {
      Alert.alert('Error', 'Failed to accept friend request');
    }
  };

  const handleDeclineFriendRequest = async (requestId: string) => {
    try {
      await declineFriendRequest(requestId);
      Alert.alert('Success', 'Friend request declined');
    } catch (error) {
      Alert.alert('Error', 'Failed to decline friend request');
    }
  };

  const handleRemoveFriend = async (friendId: string) => {
    const friend = friends.find(f => f.friend_user_id === friendId);
    if (!friend) return;

    Alert.alert(
      'Remove Friend',
      'Are you sure you want to remove this friend?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeFriend(friendId);
              // Set recently deleted friend for undo option
              setRecentlyDeletedFriend({ friend, timestamp: Date.now() });
              showUndoSnackbar('Friend removed', handleUndoFriendRemoval);
            } catch (error) {
              Alert.alert('Error', 'Failed to remove friend');
            }
          },
        },
      ]
    );
  };

  const handleUndoRemove = async () => {
    if (!recentlyRemoved) return;
    
    try {
      await addFriend(recentlyRemoved.friend.friend_user_id);
      setRecentlyRemoved(null);
      Alert.alert('Success', 'Friend restored!');
    } catch (error) {
      Alert.alert('Error', 'Failed to restore friend');
    }
  };

  const handleSearchUsers = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, first_name, last_name, avatar_url')
        .or(`username.ilike.%${query}%, display_name.ilike.%${query}%, first_name.ilike.%${query}%, last_name.ilike.%${query}%`)
        .neq('id', user?.id)
        .limit(10);

      if (error) throw error;
      setSearchResults(data || []);
    } catch (error) {
      console.error('Search error:', error);
      Alert.alert('Error', 'Failed to search users');
    } finally {
      setSearching(false);
    }
  };

  const handleGenerateInviteLink = async () => {
    try {
      const inviteLink = `https://mingla.app/invite/${user?.id}`;
      await Clipboard.setStringAsync(inviteLink);
      Alert.alert('Invite Link Copied', 'Share this link with friends to connect!');
    } catch (error) {
      Alert.alert('Error', 'Failed to generate invite link');
    }
  };

  const handleBlockUser = async (friendId: string) => {
    Alert.alert(
      'Block User',
      'Are you sure you want to block this user? They will be removed from your friends list.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              // Implement block functionality
              await removeFriend(friendId);
              Alert.alert('Success', 'User blocked');
            } catch (error) {
              Alert.alert('Error', 'Failed to block user');
            }
          },
        },
      ]
    );
  };

  const handleReportUser = async (friendId: string) => {
    Alert.alert(
      'Report User',
      'Why are you reporting this user?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Spam', onPress: () => submitReport(friendId, 'spam') },
        { text: 'Inappropriate Content', onPress: () => submitReport(friendId, 'inappropriate') },
        { text: 'Harassment', onPress: () => submitReport(friendId, 'harassment') },
        { text: 'Other', onPress: () => submitReport(friendId, 'other') },
      ]
    );
  };

  const submitReport = async (friendId: string, reason: string) => {
    try {
      // Implement report functionality
      Alert.alert('Report Submitted', 'Thank you for your report. We will review it.');
    } catch (error) {
      Alert.alert('Error', 'Failed to submit report');
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation) return;

    setSending(true);
    try {
      await sendMessage(selectedConversation.id, newMessage.trim(), 'text');
      setNewMessage('');
    } catch (error) {
      Alert.alert('Error', 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleShareCard = async (savedExperience: any) => {
    if (!selectedConversation) return;
    
    setSending(true);
    try {
      const cardMessage = `Check out this saved experience: ${savedExperience.title}`;
      await sendMessage(selectedConversation.id, cardMessage, 'card', {
        cardId: savedExperience.card_id,
        cardTitle: savedExperience.title,
        cardCategory: savedExperience.category,
        cardImage: savedExperience.image_url,
        cardAddress: savedExperience.address,
        cardPrice: savedExperience.estimated_cost_per_person
      });
      setShowShareCardModal(false);
      Alert.alert('Success', 'Card shared!');
    } catch (error) {
      Alert.alert('Error', 'Failed to share card');
    } finally {
      setSending(false);
    }
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || selectedGroupMembers.length === 0) {
      Alert.alert('Error', 'Please enter a group name and select members');
      return;
    }

    try {
      // Create group conversation
      const { data, error } = await supabase
        .from('conversations')
        .insert({
          created_by: user?.id,
          is_group: true,
          group_name: groupName.trim()
        })
        .select()
        .single();

      if (error) throw error;

      // Add participants
      const participants = [user?.id, ...selectedGroupMembers];
      await supabase
        .from('conversation_participants')
        .insert(
          participants.map(participantId => ({
            conversation_id: data.id,
            user_id: participantId
          }))
        );

      setShowCreateGroupModal(false);
      setGroupName('');
      setSelectedGroupMembers([]);
      Alert.alert('Success', 'Group created!');
      
      // Refresh conversations
      fetchMessages();
    } catch (error) {
      Alert.alert('Error', 'Failed to create group');
    }
  };

  const handleVoteOnBoard = async (boardId: string) => {
    if (!selectedConversation) return;
    
    setSending(true);
    try {
      const voteMessage = `Let's vote on this board! 🗳️`;
      await sendMessage(selectedConversation.id, voteMessage, 'board_link', {
        boardId: boardId,
        boardTitle: 'Activity Board',
        action: 'vote'
      });
      Alert.alert('Success', 'Board link shared!');
    } catch (error) {
      Alert.alert('Error', 'Failed to share board link');
    } finally {
      setSending(false);
    }
  };

  // Smart Context Actions
  const handleInviteToBoard = async (friendId: string, boardId: string) => {
    try {
      // Create collaboration session or invite to existing board
      const { data, error } = await supabase
        .from('collaboration_invites')
        .insert({
          board_id: boardId,
          invited_by: user?.id,
          invited_user: friendId,
          status: 'pending'
        });

      if (error) throw error;
      
      setShowInviteToBoardModal(false);
      Alert.alert('Success', 'Invitation sent!');
    } catch (error) {
      Alert.alert('Error', 'Failed to send invitation');
    }
  };

  const handlePlanDate = async (friendId: string) => {
    try {
      // Create a new conversation for planning
      const { data, error } = await supabase
        .from('conversations')
        .insert({
          created_by: user?.id,
          is_group: false
        })
        .select()
        .single();

      if (error) throw error;

      // Add both users as participants
      await supabase
        .from('conversation_participants')
        .insert([
          { conversation_id: data.id, user_id: user?.id },
          { conversation_id: data.id, user_id: friendId }
        ]);

      // Send initial planning message
      await sendMessage(data.id, "Let's plan a date together! 📅", 'text');
      
      setShowPlanDateModal(false);
      setSelectedConversation(data);
      Alert.alert('Success', 'Planning conversation started!');
    } catch (error) {
      Alert.alert('Error', 'Failed to start planning conversation');
    }
  };

  const handleShareSavedCard = async (friendId: string, savedExperienceId: string) => {
    try {
      // Find the saved experience from our already loaded data
      const savedExperience = savedExperiences.find(s => s.id === savedExperienceId);
      if (!savedExperience) throw new Error('Saved experience not found');

      // Create or get conversation with friend
      const { data: conversation } = await supabase
        .from('conversations')
        .select('id')
        .eq('is_group', false)
        .eq('created_by', user?.id)
        .single();

      if (!conversation) {
        // Create new conversation
        const { data: newConversation } = await supabase
          .from('conversations')
          .insert({
            created_by: user?.id,
            is_group: false
          })
          .select()
          .single();

        // Add participants
        await supabase
          .from('conversation_participants')
          .insert([
            { conversation_id: newConversation.id, user_id: user?.id },
            { conversation_id: newConversation.id, user_id: friendId }
          ]);

        // Share the card
        await sendMessage(newConversation.id, `Check out this saved experience: ${savedExperience.title}`, 'card', {
          cardId: savedExperience.card_id,
          cardTitle: savedExperience.title,
          cardCategory: savedExperience.category,
          cardImage: savedExperience.image_url,
          cardAddress: savedExperience.address,
          cardPrice: savedExperience.estimated_cost_per_person
        });
      } else {
        // Use existing conversation
        await sendMessage(conversation.id, `Check out this saved experience: ${savedExperience.title}`, 'card', {
          cardId: savedExperience.card_id,
          cardTitle: savedExperience.title,
          cardCategory: savedExperience.category,
          cardImage: savedExperience.image_url,
          cardAddress: savedExperience.address,
          cardPrice: savedExperience.estimated_cost_per_person
        });
      }

      setShowShareSavedCardModal(false);
      Alert.alert('Success', 'Saved card shared!');
    } catch (error) {
      Alert.alert('Error', 'Failed to share saved card');
    }
  };

  // Undo/Redo System
  const handleUndoFriendRemoval = async () => {
    if (!recentlyDeletedFriend) return;
    
    try {
      // Re-add the friend
      await addFriend(recentlyDeletedFriend.friend.friend_user_id);
      setRecentlyDeletedFriend(null);
      setUndoSnackbar(null);
      Alert.alert('Success', 'Friend re-added!');
    } catch (error) {
      Alert.alert('Error', 'Failed to re-add friend');
    }
  };

  const handleUndoMessageDeletion = async () => {
    if (!recentlyDeletedMessage) return;
    
    try {
      // Restore the message (implement based on your message system)
      // This would depend on how messages are stored and deleted
      setRecentlyDeletedMessage(null);
      setUndoSnackbar(null);
      Alert.alert('Success', 'Message restored!');
    } catch (error) {
      Alert.alert('Error', 'Failed to restore message');
    }
  };

  const showUndoSnackbar = (message: string, action: () => void) => {
    setUndoSnackbar({ show: true, message, action });
    // Auto-hide after 5 seconds
    setTimeout(() => {
      setUndoSnackbar(null);
    }, 5000);
  };

  const fetchSavedExperiences = async () => {
    if (!user?.id) return;
    
    setLoadingSavedExperiences(true);
    try {
      const { data, error } = await supabase
        .from('saved_experiences')
        .select(`
          id,
          user_id,
          card_id,
          title,
          subtitle,
          category,
          price_level,
          estimated_cost_per_person,
          start_time,
          duration_minutes,
          image_url,
          address,
          location_lat,
          location_lng,
          route_mode,
          eta_minutes,
          distance_text,
          maps_deep_link,
          source_provider,
          place_id,
          event_id,
          one_liner,
          tip,
          rating,
          review_count,
          status,
          scheduled_date,
          created_at,
          updated_at
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      setSavedExperiences(data || []);
    } catch (error) {
      console.error('Error fetching saved experiences:', error);
      Alert.alert('Error', 'Failed to load saved experiences');
    } finally {
      setLoadingSavedExperiences(false);
    }
  };

  const fetchBoards = async () => {
    if (!user?.id) return;
    
    setLoadingBoards(true);
    try {
      const { data, error } = await supabase
        .from('boards')
        .select(`
          id,
          name,
          description,
          created_by,
          session_id,
          is_public,
          created_at,
          updated_at
        `)
        .or(`created_by.eq.${user.id},is_public.eq.true`)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      setBoards(data || []);
    } catch (error) {
      console.error('Error fetching boards:', error);
      Alert.alert('Error', 'Failed to load boards');
    } finally {
      setLoadingBoards(false);
    }
  };

  const handleUnsendMessage = async (messageId: string) => {
    try {
      // Soft delete the message (mark as deleted instead of hard delete)
      const { error } = await supabase
        .from('messages')
        .update({ 
          deleted_at: new Date().toISOString(),
          content: 'This message was unsent'
        })
        .eq('id', messageId);

      if (error) throw error;

      setRecentlyDeletedMessage({ messageId, timestamp: Date.now() });
      showUndoSnackbar('Message unsent', handleUndoMessageDeletion);
      
      // Refresh messages
      fetchMessages();
    } catch (error) {
      Alert.alert('Error', 'Failed to unsend message');
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 1) {
      return 'Just now';
    } else if (diffInHours < 24) {
      return `${Math.floor(diffInHours)}h ago`;
    } else {
      return `${Math.floor(diffInHours / 24)}d ago`;
    }
  };

  const getDisplayName = (friend: Friend) => {
    if (friend.first_name && friend.last_name) {
      return `${friend.first_name} ${friend.last_name}`;
    }
    return friend.display_name || friend.username;
  };

  const getConversationName = (conversation: Conversation) => {
    const otherParticipant = conversation.participants.find(p => p.id !== user?.id);
    if (otherParticipant) {
      if (otherParticipant.first_name && otherParticipant.last_name) {
        return `${otherParticipant.first_name} ${otherParticipant.last_name}`;
      }
      return otherParticipant.display_name || otherParticipant.username;
    }
    return 'Unknown';
  };

  const filteredFriends = friends.filter(friend =>
    getDisplayName(friend).toLowerCase().includes(searchQuery.toLowerCase()) ||
    friend.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredConversations = conversations.filter(conversation =>
    getConversationName(conversation).toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredFriendRequests = friendRequests.filter(request =>
    request.sender.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (request.sender.first_name && request.sender.last_name &&
      `${request.sender.first_name} ${request.sender.last_name}`.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  if (selectedConversation) {
    return (
      <SafeAreaView style={styles.container}>
        {/* Chat Header */}
        <View style={styles.chatHeader}>
          <TouchableOpacity
            onPress={() => setSelectedConversation(null)}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <View style={styles.chatHeaderInfo}>
            <Text style={styles.chatHeaderName}>
              {getConversationName(selectedConversation)}
            </Text>
            <Text style={styles.chatHeaderStatus}>Online</Text>
          </View>
        </View>

        {/* Messages */}
        <ScrollView style={styles.messagesContainer}>
          {selectedConversation.messages.map((message) => {
            const isMyMessage = message.sender_id === user?.id;
            const messageAge = Date.now() - new Date(message.created_at).getTime();
            const canUnsend = isMyMessage && messageAge < 120000; // 2 minutes
            
            return (
              <View
                key={message.id}
                style={[
                  styles.messageBubble,
                  isMyMessage ? styles.myMessage : styles.theirMessage,
                ]}
              >
                <Text style={[
                  styles.messageText,
                  isMyMessage ? styles.myMessageText : styles.theirMessageText,
                ]}>
                  {message.content}
                </Text>
                <View style={styles.messageFooter}>
                  <Text style={styles.messageTime}>
                    {formatTime(message.created_at)}
                  </Text>
                  {canUnsend && (
                    <TouchableOpacity
                      style={styles.unsendButton}
                      onPress={() => handleUnsendMessage(message.id)}
                    >
                      <Text style={styles.unsendButtonText}>Unsend</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
        </ScrollView>

        {/* Message Input */}
        <View style={styles.messageInputContainer}>
          <View style={styles.messageInputActions}>
            <TouchableOpacity
              style={styles.messageActionButton}
              onPress={() => {
                fetchSavedExperiences();
                setShowShareCardModal(true);
              }}
            >
              <Ionicons name="card" size={20} color="#FF6B35" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.messageActionButton}
              onPress={() => handleVoteOnBoard('sample-board-id')}
            >
              <Ionicons name="checkmark-circle" size={20} color="#FF6B35" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.messageActionButton}
              onPress={() => Alert.alert('Coming Soon', 'Photo sharing feature coming soon!')}
            >
              <Ionicons name="camera" size={20} color="#FF6B35" />
            </TouchableOpacity>
          </View>
          <View style={styles.messageInputRow}>
            <TextInput
              style={styles.messageInput}
              placeholder="Type a message..."
              value={newMessage}
              onChangeText={setNewMessage}
              multiline
            />
            <TouchableOpacity
              onPress={handleSendMessage}
              disabled={!newMessage.trim() || sending}
              style={[styles.sendButton, (!newMessage.trim() || sending) && styles.sendButtonDisabled]}
            >
              <Ionicons name="send" size={20} color="white" />
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  
  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Connections</Text>
        <Text style={styles.subtitle}>Manage your friends and messages</Text>
      </View>

      {/* Tab Selector */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'friends' && styles.activeTab]}
          onPress={() => setActiveTab('friends')}
        >
          <Text style={[styles.tabText, activeTab === 'friends' && styles.activeTabText]}>
            Friends
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'messages' && styles.activeTab]}
          onPress={() => setActiveTab('messages')}
        >
          <Text style={[styles.tabText, activeTab === 'messages' && styles.activeTabText]}>
            Messages
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color="#999" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder={`Search ${activeTab}...`}
            placeholderTextColor="#999"
            value={searchQuery}
            onChangeText={(text) => {
              setSearchQuery(text);
              if (activeTab === 'friends') {
                handleSearchUsers(text);
              }
            }}
          />
        </View>
      </View>

      {/* Content */}
      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'friends' ? (
          <>
            {/* Friend Requests */}
            {filteredFriendRequests.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Friend Requests</Text>
                {filteredFriendRequests.map((request) => (
                  <View key={request.id} style={styles.friendRequestCard}>
                    <View style={styles.friendRequestInfo}>
                      {request.sender.avatar_url ? (
                        <Image
                          source={{ uri: request.sender.avatar_url }}
                          style={styles.avatar}
                        />
                      ) : (
                        <View style={styles.avatarFallback}>
                          <Text style={styles.avatarFallbackText}>
                            {request.sender.first_name && request.sender.last_name
                              ? `${request.sender.first_name[0]}${request.sender.last_name[0]}`.toUpperCase()
                              : request.sender.username[0].toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View style={styles.friendRequestDetails}>
                        <Text style={styles.friendRequestName}>
                          {request.sender.first_name && request.sender.last_name
                            ? `${request.sender.first_name} ${request.sender.last_name}`
                            : request.sender.display_name || request.sender.username}
                        </Text>
                        <Text style={styles.friendRequestUsername}>
                          @{request.sender.username}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.friendRequestActions}>
                      <TouchableOpacity
                        style={styles.acceptButton}
                        onPress={() => handleAcceptFriendRequest(request.id)}
                      >
                        <Ionicons name="checkmark" size={16} color="white" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.declineButton}
                        onPress={() => handleDeclineFriendRequest(request.id)}
                      >
                        <Ionicons name="close" size={16} color="white" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Add Friend Button */}
            <View style={styles.section}>
              <View style={styles.addFriendContainer}>
                <TouchableOpacity
                  style={styles.addFriendButton}
                  onPress={() => setShowAddFriendModal(true)}
                >
                  <Ionicons name="person-add" size={20} color="#FF6B35" />
                  <Text style={styles.addFriendText}>Add Friend</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.qrButton}
                  onPress={() => setShowQRModal(true)}
                >
                  <Ionicons name="qr-code" size={20} color="#FF6B35" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.inviteButton}
                  onPress={() => setShowInviteModal(true)}
                >
                  <Ionicons name="link" size={20} color="#FF6B35" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Recently Removed Friend (Undo) */}
            {recentlyRemoved && (
              <View style={styles.undoContainer}>
                <View style={styles.undoCard}>
                  <Ionicons name="person-remove" size={20} color="#ff4444" />
                  <Text style={styles.undoText}>
                    Removed {getDisplayName(recentlyRemoved.friend)}
                  </Text>
                  <TouchableOpacity
                    style={styles.undoButton}
                    onPress={handleUndoRemove}
                  >
                    <Text style={styles.undoButtonText}>Undo</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Search Results */}
            {searchResults.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Search Results</Text>
                {searchResults.map((user) => (
                  <View key={user.id} style={styles.searchResultCard}>
                    <View style={styles.friendInfo}>
                      {user.avatar_url ? (
                        <Image
                          source={{ uri: user.avatar_url }}
                          style={styles.avatar}
                        />
                      ) : (
                        <View style={styles.avatarFallback}>
                          <Text style={styles.avatarFallbackText}>
                            {user.first_name && user.last_name
                              ? `${user.first_name[0]}${user.last_name[0]}`.toUpperCase()
                              : user.username[0].toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View style={styles.friendDetails}>
                        <Text style={styles.friendName}>
                          {user.first_name && user.last_name
                            ? `${user.first_name} ${user.last_name}`
                            : user.display_name || user.username}
                        </Text>
                        <Text style={styles.friendUsername}>@{user.username}</Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={styles.addButton}
                      onPress={() => handleSendFriendRequest(user.id)}
                    >
                      <Ionicons name="person-add" size={16} color="white" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Friends List */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Friends</Text>
              {filteredFriends.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="people-outline" size={48} color="#ccc" />
                  <Text style={styles.emptyStateText}>
                    {searchQuery ? 'No friends found' : 'No friends yet'}
                  </Text>
                  <Text style={styles.emptyStateSubtext}>
                    {searchQuery ? 'Try a different search term' : 'Add friends to start connecting'}
                  </Text>
                </View>
              ) : (
                filteredFriends.map((friend) => (
                  <View key={friend.id} style={styles.friendCard}>
                    <View style={styles.friendInfo}>
                      {friend.avatar_url ? (
                        <Image
                          source={{ uri: friend.avatar_url }}
                          style={styles.avatar}
                        />
                      ) : (
                        <View style={styles.avatarFallback}>
                          <Text style={styles.avatarFallbackText}>
                            {friend.first_name && friend.last_name
                              ? `${friend.first_name[0]}${friend.last_name[0]}`.toUpperCase()
                              : friend.username[0].toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View style={styles.friendDetails}>
                        <Text style={styles.friendName}>{getDisplayName(friend)}</Text>
                        <Text style={styles.friendUsername}>@{friend.username}</Text>
                      </View>
                    </View>
                    <View style={styles.friendActions}>
                      <TouchableOpacity
                        style={styles.smartActionButton}
                        onPress={() => {
                          setSelectedFriendForActions(friend);
                          setShowFriendActionsModal(true);
                        }}
                      >
                        <Ionicons name="flash" size={16} color="#FF6B35" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.messageButton}
                        onPress={() => {
                          // Find or create conversation with this friend
                          const conversation = conversations.find(conv =>
                            conv.participants.some(p => p.id === friend.friend_user_id)
                          );
                          if (conversation) {
                            setSelectedConversation(conversation);
                          } else {
                            Alert.alert('Info', 'Start a conversation from the Messages tab');
                          }
                        }}
                      >
                        <Ionicons name="chatbubble-outline" size={16} color="#FF6B35" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.moreButton}
                        onPress={() => {
                          setSelectedFriend(friend);
                          setShowBlockReportModal(true);
                        }}
                      >
                        <Ionicons name="ellipsis-horizontal" size={16} color="#666" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        ) : (
          /* Messages Tab */
          <View style={styles.section}>
            <View style={styles.messagesHeader}>
              <Text style={styles.sectionTitle}>Messages</Text>
              <View style={styles.messageActions}>
                <TouchableOpacity
                  style={styles.createGroupButton}
                  onPress={() => setShowCreateGroupModal(true)}
                >
                  <Ionicons name="people" size={16} color="#FF6B35" />
                  <Text style={styles.createGroupText}>Create Group</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.shareCardButton}
                  onPress={() => setShowShareCardModal(true)}
                >
                  <Ionicons name="card" size={16} color="#FF6B35" />
                  <Text style={styles.shareCardText}>Share Card</Text>
                </TouchableOpacity>
              </View>
            </View>
            {filteredConversations.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="chatbubbles-outline" size={48} color="#ccc" />
                <Text style={styles.emptyStateText}>
                  {searchQuery ? 'No conversations found' : 'No messages yet'}
                </Text>
                <Text style={styles.emptyStateSubtext}>
                  {searchQuery ? 'Try a different search term' : 'Start a conversation with a friend'}
                </Text>
              </View>
            ) : (
              filteredConversations.map((conversation) => (
                <TouchableOpacity
                  key={conversation.id}
                  style={styles.conversationCard}
                  onPress={() => setSelectedConversation(conversation)}
                >
                  <View style={styles.conversationInfo}>
                    {conversation.participants.find(p => p.id !== user?.id)?.avatar_url ? (
                      <Image
                        source={{ uri: conversation.participants.find(p => p.id !== user?.id)?.avatar_url }}
                        style={styles.avatar}
                      />
                    ) : (
                      <View style={styles.avatarFallback}>
                        <Text style={styles.avatarFallbackText}>
                          {(() => {
                            const otherParticipant = conversation.participants.find(p => p.id !== user?.id);
                            if (otherParticipant?.first_name && otherParticipant?.last_name) {
                              return `${otherParticipant.first_name[0]}${otherParticipant.last_name[0]}`.toUpperCase();
                            }
                            return otherParticipant?.username?.[0].toUpperCase() || 'U';
                          })()}
                        </Text>
                      </View>
                    )}
                    <View style={styles.conversationDetails}>
                      <Text style={styles.conversationName}>
                        {getConversationName(conversation)}
                      </Text>
                      <Text style={styles.conversationLastMessage} numberOfLines={1}>
                        {conversation.last_message?.content || 'No messages yet'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.conversationMeta}>
                    <Text style={styles.conversationTime}>
                      {conversation.last_message ? formatTime(conversation.last_message.created_at) : ''}
                    </Text>
                    {conversation.unread_count > 0 && (
                      <View style={styles.unreadBadge}>
                        <Text style={styles.unreadCount}>
                          {conversation.unread_count > 9 ? '9+' : conversation.unread_count}
                        </Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}
      </ScrollView>

      {/* Add Friend Modal */}
      {showAddFriendModal && (
        <Modal
          visible={true}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowAddFriendModal(false)}
        >
          <TouchableOpacity 
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowAddFriendModal(false)}
          >
            <TouchableOpacity 
              style={styles.modalContent}
              activeOpacity={1}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add Friend</Text>
                <TouchableOpacity onPress={() => setShowAddFriendModal(false)}>
                  <Ionicons name="close" size={24} color="#666" />
                </TouchableOpacity>
              </View>
              <View style={styles.modalSearchContainer}>
                <Text style={styles.searchLabel}>Search for friends:</Text>
                <TextInput
                  style={styles.modalSearchInput}
                  placeholder="Search by username or email..."
                  value={searchQuery}
                  onChangeText={(text) => {
                    setSearchQuery(text);
                    handleSearchUsers(text);
                  }}
                  autoFocus={true}
                  returnKeyType="search"
                />
              </View>
              {searching && (
                <View style={styles.loadingContainer}>
                  <Text>Searching...</Text>
                </View>
              )}
              {searchResults.length > 0 && (
                <View style={styles.modalSearchResults}>
                  <Text style={styles.searchResultsTitle}>Search Results ({searchResults.length})</Text>
                  <ScrollView style={styles.modalSearchResultsList}>
                    {searchResults.map((user) => (
                      <View key={user.id} style={styles.modalSearchResultItem}>
                        <View style={styles.modalSearchResultInfo}>
                          <Text style={styles.modalSearchResultName}>
                            {user.first_name && user.last_name
                              ? `${user.first_name} ${user.last_name}`
                              : user.display_name || user.username}
                          </Text>
                          <Text style={styles.modalSearchResultUsername}>@{user.username}</Text>
                        </View>
                        <TouchableOpacity
                          style={styles.modalAddButton}
                          onPress={() => {
                            handleSendFriendRequest(user.id);
                            setShowAddFriendModal(false);
                          }}
                        >
                          <Ionicons name="person-add" size={16} color="white" />
                          <Text style={styles.modalAddButtonText}>Add</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      {/* QR Code Modal */}
      {showQRModal && (
        <Modal
          visible={true}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowQRModal(false)}
        >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>QR Code</Text>
              <TouchableOpacity onPress={() => setShowQRModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            <View style={styles.qrContainer}>
              <Text style={styles.qrText}>Scan this QR code to add you as a friend</Text>
              {/* TODO: Add actual QR code generation */}
              <View style={styles.qrPlaceholder}>
                <Ionicons name="qr-code" size={100} color="#FF6B35" />
              </View>
              <Text style={styles.qrUsername}>@{user?.username}</Text>
            </View>
          </View>
        </View>
        </Modal>
      )}

      {/* Invite Link Modal */}
      {showInviteModal && (
        <Modal
          visible={true}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowInviteModal(false)}
        >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Invite Friends</Text>
              <TouchableOpacity onPress={() => setShowInviteModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            <View style={styles.inviteContainer}>
              <Text style={styles.inviteText}>Share your invite link with friends</Text>
              <TouchableOpacity
                style={styles.copyButton}
                onPress={handleGenerateInviteLink}
              >
                <Ionicons name="copy" size={20} color="white" />
                <Text style={styles.copyButtonText}>Copy Invite Link</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </Modal>
      )}

      {/* Block/Report Modal */}
      {showBlockReportModal && (
        <Modal
          visible={true}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowBlockReportModal(false)}
        >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Friend Options</Text>
              <TouchableOpacity onPress={() => setShowBlockReportModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            {selectedFriend && (
              <View style={styles.optionsContainer}>
                <TouchableOpacity
                  style={styles.optionButton}
                  onPress={() => {
                    handleRemoveFriend(selectedFriend.friend_user_id);
                    setShowBlockReportModal(false);
                  }}
                >
                  <Ionicons name="person-remove" size={20} color="#ff4444" />
                  <Text style={styles.optionText}>Remove Friend</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.optionButton}
                  onPress={() => {
                    handleBlockUser(selectedFriend.friend_user_id);
                    setShowBlockReportModal(false);
                  }}
                >
                  <Ionicons name="ban" size={20} color="#ff4444" />
                  <Text style={styles.optionText}>Block User</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.optionButton}
                  onPress={() => {
                    handleReportUser(selectedFriend.friend_user_id);
                    setShowBlockReportModal(false);
                  }}
                >
                  <Ionicons name="flag" size={20} color="#ff4444" />
                  <Text style={styles.optionText}>Report User</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
        </Modal>
      )}

      {/* Share Card Modal */}
      {showShareCardModal && (
        <Modal
          visible={true}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowShareCardModal(false)}
        >
          <TouchableOpacity 
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowShareCardModal(false)}
          >
            <TouchableOpacity 
              style={styles.modalContent}
              activeOpacity={1}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Share Experience Card</Text>
                <TouchableOpacity onPress={() => setShowShareCardModal(false)}>
                  <Ionicons name="close" size={24} color="#666" />
                </TouchableOpacity>
              </View>
              <View style={styles.shareCardContainer}>
                <Text style={styles.shareCardText}>Choose a saved experience to share:</Text>
                <ScrollView style={styles.cardList}>
                  {loadingSavedExperiences ? (
                    <View style={styles.loadingContainer}>
                      <Text>Loading saved experiences...</Text>
                    </View>
                  ) : savedExperiences.length === 0 ? (
                    <View style={styles.emptySavedContainer}>
                      <Ionicons name="bookmark-outline" size={48} color="#ccc" />
                      <Text style={styles.emptySavedText}>No saved experiences yet</Text>
                      <Text style={styles.emptySavedSubtext}>Save some experiences to share them</Text>
                    </View>
                  ) : (
                    savedExperiences.map((savedExperience) => (
                      <TouchableOpacity
                        key={savedExperience.id}
                        style={styles.shareCardItem}
                        onPress={() => handleShareCard(savedExperience)}
                      >
                        <Image 
                          source={{ 
                            uri: savedExperience.image_url || 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e' 
                          }} 
                          style={styles.shareCardImage} 
                        />
                        <View style={styles.shareCardInfo}>
                          <Text style={styles.shareCardTitle}>{savedExperience.title}</Text>
                          <Text style={styles.shareCardCategory}>{savedExperience.category}</Text>
                          {savedExperience.estimated_cost_per_person && (
                            <Text style={styles.shareCardPrice}>
                              ~${savedExperience.estimated_cost_per_person} per person
                            </Text>
                          )}
                        </View>
                        <Ionicons name="share" size={20} color="#FF6B35" />
                      </TouchableOpacity>
                    ))
                  )}
                </ScrollView>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Create Group Modal */}
      {showCreateGroupModal && (
        <Modal
          visible={true}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowCreateGroupModal(false)}
        >
          <TouchableOpacity 
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowCreateGroupModal(false)}
          >
            <TouchableOpacity 
              style={styles.modalContent}
              activeOpacity={1}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Create Group Chat</Text>
                <TouchableOpacity onPress={() => setShowCreateGroupModal(false)}>
                  <Ionicons name="close" size={24} color="#666" />
                </TouchableOpacity>
              </View>
              <View style={styles.createGroupContainer}>
                <TextInput
                  style={styles.groupNameInput}
                  placeholder="Group name..."
                  value={groupName}
                  onChangeText={setGroupName}
                />
                <Text style={styles.selectMembersText}>Select members:</Text>
                <ScrollView style={styles.membersList}>
                  {friends.map((friend) => (
                    <TouchableOpacity
                      key={friend.id}
                      style={[
                        styles.memberItem,
                        selectedGroupMembers.includes(friend.friend_user_id) && styles.selectedMember
                      ]}
                      onPress={() => {
                        if (selectedGroupMembers.includes(friend.friend_user_id)) {
                          setSelectedGroupMembers(selectedGroupMembers.filter(id => id !== friend.friend_user_id));
                        } else {
                          setSelectedGroupMembers([...selectedGroupMembers, friend.friend_user_id]);
                        }
                      }}
                    >
                      <View style={styles.memberInfo}>
                        <Text style={styles.memberName}>{getDisplayName(friend)}</Text>
                        <Text style={styles.memberUsername}>@{friend.username}</Text>
                      </View>
                      {selectedGroupMembers.includes(friend.friend_user_id) && (
                        <Ionicons name="checkmark-circle" size={20} color="#FF6B35" />
                      )}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <TouchableOpacity
                  style={styles.createGroupSubmitButton}
                  onPress={handleCreateGroup}
                >
                  <Text style={styles.createGroupSubmitText}>Create Group</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Smart Context Actions Modal */}
      {showFriendActionsModal && selectedFriendForActions && (
        <Modal
          visible={true}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowFriendActionsModal(false)}
        >
          <TouchableOpacity 
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowFriendActionsModal(false)}
          >
            <TouchableOpacity 
              style={styles.modalContent}
              activeOpacity={1}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Smart Actions</Text>
                <TouchableOpacity onPress={() => setShowFriendActionsModal(false)}>
                  <Ionicons name="close" size={24} color="#666" />
                </TouchableOpacity>
              </View>
              <View style={styles.smartActionsContainer}>
                <Text style={styles.smartActionsSubtitle}>
                  Quick actions for {getDisplayName(selectedFriendForActions)}
                </Text>
                <View style={styles.smartActionsList}>
                  <TouchableOpacity
                    style={styles.smartActionItem}
                    onPress={() => {
                      setShowFriendActionsModal(false);
                      fetchBoards();
                      setShowInviteToBoardModal(true);
                    }}
                  >
                    <View style={styles.smartActionIcon}>
                      <Ionicons name="people" size={24} color="#FF6B35" />
                    </View>
                    <View style={styles.smartActionContent}>
                      <Text style={styles.smartActionTitle}>Invite to Board</Text>
                      <Text style={styles.smartActionDescription}>Collaborate on activity planning</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#ccc" />
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={styles.smartActionItem}
                    onPress={() => {
                      setShowFriendActionsModal(false);
                      setShowPlanDateModal(true);
                    }}
                  >
                    <View style={styles.smartActionIcon}>
                      <Ionicons name="calendar" size={24} color="#34C759" />
                    </View>
                    <View style={styles.smartActionContent}>
                      <Text style={styles.smartActionTitle}>Plan Date Together</Text>
                      <Text style={styles.smartActionDescription}>Start planning your next date</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#ccc" />
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={styles.smartActionItem}
                    onPress={() => {
                      setShowFriendActionsModal(false);
                      fetchSavedExperiences();
                      setShowShareSavedCardModal(true);
                    }}
                  >
                    <View style={styles.smartActionIcon}>
                      <Ionicons name="bookmark" size={24} color="#FF9500" />
                    </View>
                    <View style={styles.smartActionContent}>
                      <Text style={styles.smartActionTitle}>Share Saved Card</Text>
                      <Text style={styles.smartActionDescription}>Share a saved experience</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#ccc" />
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Invite to Board Modal */}
      {showInviteToBoardModal && selectedFriendForActions && (
        <Modal
          visible={true}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowInviteToBoardModal(false)}
        >
          <TouchableOpacity 
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowInviteToBoardModal(false)}
          >
            <TouchableOpacity 
              style={styles.modalContent}
              activeOpacity={1}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Invite to Board</Text>
                <TouchableOpacity onPress={() => setShowInviteToBoardModal(false)}>
                  <Ionicons name="close" size={24} color="#666" />
                </TouchableOpacity>
              </View>
              <View style={styles.inviteBoardContainer}>
                <Text style={styles.inviteBoardText}>
                  Invite {getDisplayName(selectedFriendForActions)} to collaborate on a board
                </Text>
                <ScrollView style={styles.boardsList}>
                  {loadingBoards ? (
                    <View style={styles.loadingContainer}>
                      <Text>Loading boards...</Text>
                    </View>
                  ) : boards.length === 0 ? (
                    <View style={styles.emptyBoardsContainer}>
                      <Ionicons name="grid-outline" size={48} color="#ccc" />
                      <Text style={styles.emptyBoardsText}>No boards available</Text>
                      <Text style={styles.emptyBoardsSubtext}>Create a board to invite friends to collaborate</Text>
                    </View>
                  ) : (
                    boards.map((board) => (
                      <TouchableOpacity
                        key={board.id}
                        style={styles.boardItem}
                        onPress={() => handleInviteToBoard(selectedFriendForActions.friend_user_id, board.id)}
                      >
                        <View style={styles.boardInfo}>
                          <Text style={styles.boardName}>{board.name}</Text>
                          <Text style={styles.boardDescription}>
                            {board.description || 'No description available'}
                          </Text>
                          <View style={styles.boardMeta}>
                            <Text style={styles.boardMetaText}>
                              {board.is_public ? 'Public' : 'Private'} • 
                              {new Date(board.created_at).toLocaleDateString()}
                            </Text>
                          </View>
                        </View>
                        <Ionicons name="arrow-forward" size={20} color="#FF6B35" />
                      </TouchableOpacity>
                    ))
                  )}
                </ScrollView>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Plan Date Modal */}
      {showPlanDateModal && selectedFriendForActions && (
        <Modal
          visible={true}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowPlanDateModal(false)}
        >
          <TouchableOpacity 
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowPlanDateModal(false)}
          >
            <TouchableOpacity 
              style={styles.modalContent}
              activeOpacity={1}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Plan Date Together</Text>
                <TouchableOpacity onPress={() => setShowPlanDateModal(false)}>
                  <Ionicons name="close" size={24} color="#666" />
                </TouchableOpacity>
              </View>
              <View style={styles.planDateContainer}>
                <Text style={styles.planDateText}>
                  Start planning a date with {getDisplayName(selectedFriendForActions)}
                </Text>
                <TouchableOpacity
                  style={styles.planDateButton}
                  onPress={() => handlePlanDate(selectedFriendForActions.friend_user_id)}
                >
                  <Ionicons name="calendar" size={20} color="white" />
                  <Text style={styles.planDateButtonText}>Start Planning</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Share Saved Card Modal */}
      {showShareSavedCardModal && selectedFriendForActions && (
        <Modal
          visible={true}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowShareSavedCardModal(false)}
        >
          <TouchableOpacity 
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowShareSavedCardModal(false)}
          >
            <TouchableOpacity 
              style={styles.modalContent}
              activeOpacity={1}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Share Saved Card</Text>
                <TouchableOpacity onPress={() => setShowShareSavedCardModal(false)}>
                  <Ionicons name="close" size={24} color="#666" />
                </TouchableOpacity>
              </View>
              <View style={styles.shareSavedCardContainer}>
                <Text style={styles.shareSavedCardText}>
                  Share a saved experience with {getDisplayName(selectedFriendForActions)}
                </Text>
                <ScrollView style={styles.savedCardsList}>
                  {loadingSavedExperiences ? (
                    <View style={styles.loadingContainer}>
                      <Text>Loading saved experiences...</Text>
                    </View>
                  ) : savedExperiences.length === 0 ? (
                    <View style={styles.emptySavedContainer}>
                      <Ionicons name="bookmark-outline" size={48} color="#ccc" />
                      <Text style={styles.emptySavedText}>No saved experiences yet</Text>
                      <Text style={styles.emptySavedSubtext}>Save some experiences to share them with friends</Text>
                    </View>
                  ) : (
                    savedExperiences.map((savedExperience) => {
                      return (
                        <TouchableOpacity
                          key={savedExperience.id}
                          style={styles.savedCardItem}
                          onPress={() => handleShareSavedCard(selectedFriendForActions.friend_user_id, savedExperience.id)}
                        >
                          <Image 
                            source={{ 
                              uri: savedExperience.image_url || 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e' 
                            }} 
                            style={styles.savedCardImage} 
                          />
                          <View style={styles.savedCardInfo}>
                            <Text style={styles.savedCardTitle}>{savedExperience.title}</Text>
                            <Text style={styles.savedCardCategory}>{savedExperience.category}</Text>
                            {savedExperience.estimated_cost_per_person && (
                              <Text style={styles.savedCardPrice}>
                                ~${savedExperience.estimated_cost_per_person} per person
                              </Text>
                            )}
                          </View>
                          <Ionicons name="share" size={20} color="#FF6B35" />
                        </TouchableOpacity>
                      );
                    })
                  )}
                </ScrollView>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Undo Snackbar */}
      {undoSnackbar && (
        <View style={styles.undoSnackbar}>
          <Text style={styles.undoSnackbarText}>{undoSnackbar.message}</Text>
          <TouchableOpacity
            style={styles.undoButton}
            onPress={undoSnackbar.action}
          >
            <Text style={styles.undoButtonText}>Undo</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 24,
    marginBottom: 16,
    backgroundColor: '#e9ecef',
    borderRadius: 8,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignItems: 'center',
  },
  activeTab: {
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#666',
  },
  activeTabText: {
    color: '#1a1a1a',
    fontWeight: '600',
  },
  searchContainer: {
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#1a1a1a',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 16,
  },
  friendRequestCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  friendRequestInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  friendRequestDetails: {
    marginLeft: 12,
    flex: 1,
  },
  friendRequestName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  friendRequestUsername: {
    fontSize: 14,
    color: '#666',
  },
  friendRequestActions: {
    flexDirection: 'row',
    gap: 8,
  },
  acceptButton: {
    backgroundColor: '#28a745',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  declineButton: {
    backgroundColor: '#dc3545',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  friendCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  friendInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  friendDetails: {
    marginLeft: 12,
    flex: 1,
  },
  friendName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  friendUsername: {
    fontSize: 14,
    color: '#666',
  },
  messageButton: {
    padding: 8,
  },
  conversationCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  conversationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  conversationDetails: {
    marginLeft: 12,
    flex: 1,
  },
  conversationName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  conversationLastMessage: {
    fontSize: 14,
    color: '#666',
  },
  conversationMeta: {
    alignItems: 'flex-end',
  },
  conversationTime: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
  },
  unreadBadge: {
    backgroundColor: '#FF6B35',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  unreadCount: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FF6B35',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarFallbackText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
  // Chat styles
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
  },
  backButton: {
    marginRight: 12,
  },
  chatHeaderInfo: {
    flex: 1,
  },
  chatHeaderName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  chatHeaderStatus: {
    fontSize: 14,
    color: '#28a745',
  },
  messagesContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  messageBubble: {
    maxWidth: '80%',
    marginVertical: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
  },
  myMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#FF6B35',
  },
  theirMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#e9ecef',
  },
  messageText: {
    fontSize: 16,
    marginBottom: 4,
  },
  myMessageText: {
    color: 'white',
  },
  theirMessageText: {
    color: '#1a1a1a',
  },
  messageTime: {
    fontSize: 12,
    opacity: 0.7,
  },
  messageInputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: '#e9ecef',
  },
  messageInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e9ecef',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginRight: 12,
    maxHeight: 100,
    fontSize: 16,
  },
  sendButton: {
    backgroundColor: '#FF6B35',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#ccc',
  },
  // Enhanced Friends List styles
  addFriendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  addFriendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f8ff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    flex: 1,
    marginRight: 8,
  },
  addFriendText: {
    marginLeft: 8,
    fontSize: 16,
    fontWeight: '600',
    color: '#FF6B35',
  },
  qrButton: {
    backgroundColor: '#f0f8ff',
    padding: 12,
    borderRadius: 8,
    marginRight: 8,
  },
  inviteButton: {
    backgroundColor: '#f0f8ff',
    padding: 12,
    borderRadius: 8,
  },
  undoContainer: {
    marginBottom: 16,
  },
  undoCard: {
    backgroundColor: '#fff3cd',
    borderColor: '#ffc107',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  undoText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
    color: '#856404',
  },
  undoButton: {
    backgroundColor: '#ffc107',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  undoButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  searchResultCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  addButton: {
    backgroundColor: '#FF6B35',
    padding: 8,
    borderRadius: 6,
  },
  friendActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  moreButton: {
    padding: 8,
    marginLeft: 8,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 24,
    width: '90%',
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  searchResults: {
    maxHeight: 200,
  },
  searchResultItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  searchResultName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  searchResultUsername: {
    fontSize: 14,
    color: '#666',
  },
  qrContainer: {
    alignItems: 'center',
    padding: 20,
  },
  qrText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
  },
  qrPlaceholder: {
    width: 150,
    height: 150,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  qrUsername: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FF6B35',
  },
  inviteContainer: {
    alignItems: 'center',
    padding: 20,
  },
  inviteText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
  },
  copyButton: {
    backgroundColor: '#FF6B35',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  copyButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  optionsContainer: {
    padding: 20,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  optionText: {
    marginLeft: 12,
    fontSize: 16,
    color: '#1a1a1a',
  },
  loadingContainer: {
    padding: 20,
    alignItems: 'center',
  },
  modalSearchContainer: {
    marginBottom: 20,
  },
  modalSearchInput: {
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  searchLabel: {
    marginBottom: 8,
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  modalSearchResults: {
    marginTop: 10,
  },
  searchResultsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  modalSearchResultsList: {
    maxHeight: 200,
  },
  modalSearchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  modalSearchResultInfo: {
    flex: 1,
  },
  modalSearchResultName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  modalSearchResultUsername: {
    fontSize: 14,
    color: '#666',
  },
  modalAddButton: {
    backgroundColor: '#FF6B35',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  modalAddButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 4,
  },
  // Enhanced Messages styles
  messagesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  messageActions: {
    flexDirection: 'row',
    gap: 8,
  },
  createGroupButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f8ff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  createGroupText: {
    marginLeft: 4,
    fontSize: 12,
    fontWeight: '600',
    color: '#FF6B35',
  },
  shareCardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f8ff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  shareCardText: {
    marginLeft: 4,
    fontSize: 12,
    fontWeight: '600',
    color: '#FF6B35',
  },
  messageInputActions: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#f8f9fa',
    borderTopWidth: 1,
    borderTopColor: '#e9ecef',
  },
  messageActionButton: {
    padding: 8,
    marginRight: 12,
  },
  messageInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  // Share Card Modal styles
  shareCardContainer: {
    padding: 20,
  },
  shareCardText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 16,
  },
  cardList: {
    maxHeight: 300,
  },
  shareCardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  shareCardImage: {
    width: 50,
    height: 50,
    borderRadius: 6,
    marginRight: 12,
  },
  shareCardInfo: {
    flex: 1,
  },
  shareCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  shareCardCategory: {
    fontSize: 14,
    color: '#666',
  },
  shareCardPrice: {
    fontSize: 12,
    color: '#34C759',
    fontWeight: '500',
    marginTop: 2,
  },
  // Create Group Modal styles
  createGroupContainer: {
    padding: 20,
  },
  groupNameInput: {
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
    marginBottom: 16,
  },
  selectMembersText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  membersList: {
    maxHeight: 200,
    marginBottom: 20,
  },
  memberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  selectedMember: {
    backgroundColor: '#e3f2fd',
    borderColor: '#FF6B35',
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  memberUsername: {
    fontSize: 14,
    color: '#666',
  },
  createGroupSubmitButton: {
    backgroundColor: '#FF6B35',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  createGroupSubmitText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  // Smart Context Actions styles
  smartActionButton: {
    padding: 8,
    marginRight: 8,
    backgroundColor: '#FFF3E0',
    borderRadius: 6,
  },
  smartActionsContainer: {
    padding: 20,
  },
  smartActionsSubtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 20,
  },
  smartActionsList: {
    gap: 12,
  },
  smartActionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  smartActionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#f0f8ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  smartActionContent: {
    flex: 1,
  },
  smartActionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  smartActionDescription: {
    fontSize: 14,
    color: '#666',
  },
  // Invite to Board styles
  inviteBoardContainer: {
    padding: 20,
  },
  inviteBoardText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 20,
  },
  boardsList: {
    maxHeight: 300,
  },
  boardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  boardInfo: {
    flex: 1,
  },
  boardName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  boardDescription: {
    fontSize: 14,
    color: '#666',
  },
  // Plan Date styles
  planDateContainer: {
    padding: 20,
    alignItems: 'center',
  },
  planDateText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 24,
    textAlign: 'center',
  },
  planDateButton: {
    backgroundColor: '#34C759',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  planDateButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  // Share Saved Card styles
  shareSavedCardContainer: {
    padding: 20,
  },
  shareSavedCardText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 20,
  },
  savedCardsList: {
    maxHeight: 300,
  },
  savedCardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  savedCardImage: {
    width: 50,
    height: 50,
    borderRadius: 6,
    marginRight: 12,
  },
  savedCardInfo: {
    flex: 1,
  },
  savedCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  savedCardCategory: {
    fontSize: 14,
    color: '#666',
  },
  // Undo Snackbar styles
  undoSnackbar: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    backgroundColor: '#1a1a1a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  undoSnackbarText: {
    color: 'white',
    fontSize: 14,
    flex: 1,
  },
  undoButton: {
    backgroundColor: '#FF6B35',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    marginLeft: 12,
  },
  undoButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  // Message footer and unsend styles
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  unsendButton: {
    backgroundColor: '#FF3B30',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  unsendButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  // Empty saved experiences styles
  emptySavedContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptySavedText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginTop: 12,
    marginBottom: 4,
  },
  emptySavedSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  savedCardPrice: {
    fontSize: 12,
    color: '#34C759',
    fontWeight: '500',
    marginTop: 2,
  },
  // Empty boards styles
  emptyBoardsContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyBoardsText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginTop: 12,
    marginBottom: 4,
  },
  emptyBoardsSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  boardMeta: {
    marginTop: 4,
  },
  boardMetaText: {
    fontSize: 12,
    color: '#666',
  },
});