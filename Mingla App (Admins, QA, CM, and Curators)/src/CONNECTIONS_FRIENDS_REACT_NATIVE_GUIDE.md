# Mingla Connections & Friends System - Complete React Native Implementation Guide

## Table of Contents
1. [Overview](#overview)
2. [Architecture & Components](#architecture--components)
3. [Friend System](#friend-system)
4. [Friend Request System](#friend-request-system)
5. [Add Friend Methods](#add-friend-methods)
6. [Integration with Collaboration](#integration-with-collaboration)
7. [Integration with Board Cards](#integration-with-board-cards)
8. [Direct Messaging](#direct-messaging)
9. [Complete React Native Implementation](#complete-react-native-implementation)
10. [Backend API Structure](#backend-api-structure)
11. [Real-Time Features](#real-time-features)
12. [Security & Privacy](#security--privacy)

---

## Overview

### What is the Connections System?

The Connections system is Mingla's **social network foundation** that manages:
- **Friendships**: Bi-directional friend relationships
- **Friend Requests**: Sending, accepting, declining invitations
- **Direct Messaging**: 1-on-1 and group chat
- **Collaboration Integration**: Inviting friends to sessions/boards
- **Social Discovery**: Finding friends via username, email, QR code

### Key Features

```
┌─────────────────────────────────────────────────────────┐
│                  CONNECTIONS PAGE                        │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────────┐     ┌──────────────────┐          │
│  │   Friends Tab     │     │   Messages Tab    │          │
│  ├──────────────────┤     ├──────────────────┤          │
│  │ • Friends List   │     │ • Conversations  │          │
│  │ • Search         │     │ • Unread Badges  │          │
│  │ • Add Friend     │     │ • Start New Chat │          │
│  │ • QR Code        │     │ • Message Preview│          │
│  │ • Friend Actions │     │ • Search         │          │
│  └──────────────────┘     └──────────────────┘          │
│                                                           │
│  Actions:                                                 │
│  ✓ Message Friend      ✓ View Friend Requests            │
│  ✓ Add to Board        ✓ Generate QR Code                │
│  ✓ Mute/Unmute         ✓ Copy Invite Link                │
│  ✓ Block User          ✓ Report User                     │
│  ✓ Remove Friend       ✓ Search Friends                  │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

---

## Architecture & Components

### Component Hierarchy

```
ConnectionsPage (Main Container)
├── TabNavigation (Friends/Messages Switcher)
│
├── FriendsTab
│   ├── Search Input
│   ├── Quick Actions Bar
│   │   ├── Add Friend Button
│   │   ├── Friend Requests Button (with badge)
│   │   ├── QR Code Button
│   │   └── Invite Link Button
│   ├── QR Code Display (conditional)
│   └── Friends List
│       └── FriendCard (for each friend)
│           ├── Avatar + Status Indicator
│           ├── Name + Username
│           ├── Mutual Friends Count
│           ├── Message Button
│           └── Actions Dropdown Menu
│
├── MessagesTab
│   ├── Search Input
│   ├── Start New Conversation Button
│   └── Conversations List
│       └── ConversationCard (for each conversation)
│           ├── Avatar + Online Status
│           ├── Name
│           ├── Last Message Preview
│           ├── Timestamp
│           └── Unread Badge
│
├── MessageInterface (Full-screen when chatting)
│   ├── Header (Back, Name, Actions)
│   ├── Messages List
│   ├── Message Input
│   └── Send Button
│
└── Modals
    ├── AddFriendModal (Username/Email search)
    ├── FriendRequestsModal (Pending requests)
    ├── AddToBoardModal (Select board to invite friend)
    ├── FriendSelectionModal (Start new conversation)
    └── ReportUserModal (Report inappropriate behavior)
```

### Data Models

**Friend Object:**
```typescript
interface Friend {
  id: string;                          // Unique user ID
  name: string;                        // Display name
  username: string;                    // Unique username (for @mentions)
  email?: string;                      // Email (private, for search only)
  avatar?: string;                     // Profile picture URL
  status: 'online' | 'offline' | 'away'; // Current status
  isOnline: boolean;                   // Quick online check
  lastSeen?: string;                   // Last activity timestamp
  mutualFriends?: number;              // Count of mutual friends
  
  // Metadata
  friendsSince?: string;               // When friendship started
  isPremium?: boolean;                 // Premium user badge
  bio?: string;                        // Profile bio
}
```

**FriendRequest Object:**
```typescript
interface FriendRequest {
  id: string;                          // Request ID
  fromUserId: string;                  // Who sent the request
  toUserId: string;                    // Who receives the request
  status: FriendRequestStatus;         // pending | accepted | declined | canceled
  
  // User data (embedded for quick display)
  fromUser: {
    id: string;
    name: string;
    username: string;
    avatar?: string;
    mutualFriends: number;
  };
  
  toUser: {
    id: string;
    name: string;
    username: string;
  };
  
  // Metadata
  createdAt: string;                   // When request was sent
  expiresAt?: string;                  // Optional expiration (e.g., 30 days)
  respondedAt?: string;                // When accepted/declined
  message?: string;                    // Optional message with request
}

type FriendRequestStatus = 
  | 'pending'      // Awaiting response
  | 'accepted'     // Request accepted
  | 'declined'     // Request declined
  | 'canceled'     // Sender canceled
  | 'expired';     // Past expiration date
```

**Message Object:**
```typescript
interface Message {
  id: string;
  conversationId: string;              // Parent conversation
  senderId: string;                    // Who sent it
  senderName: string;                  // Display name
  content: string;                     // Message text
  timestamp: string;                   // ISO timestamp
  type: MessageType;                   // text | image | video | file
  
  // Media attachments
  fileUrl?: string;                    // File/image/video URL
  fileName?: string;                   // Original filename
  fileSize?: string;                   // Human-readable size
  thumbnailUrl?: string;               // Thumbnail for media
  
  // Metadata
  isMe: boolean;                       // Is current user the sender?
  unread?: boolean;                    // Unread by recipient?
  isEdited?: boolean;                  // Was edited after sending?
  editedAt?: string;                   // When edited
  isDeleted?: boolean;                 // Soft delete flag
  replyTo?: string;                    // Message ID if replying
  
  // Reactions (emoji reactions)
  reactions?: {
    [emoji: string]: string[];         // User IDs who reacted
  };
}

type MessageType = 'text' | 'image' | 'video' | 'file';
```

**Conversation Object:**
```typescript
interface Conversation {
  id: string;
  name: string;                        // Conversation name
  type: 'direct' | 'group';            // Direct (1-on-1) or group
  participants: Friend[];              // All participants
  
  // Latest message preview
  lastMessage: Message;                // Most recent message
  unreadCount: number;                 // Unread message count
  
  // UI helpers
  avatar?: string;                     // Group avatar or friend avatar
  isOnline?: boolean;                  // Online status (for direct chats)
  
  // Metadata
  createdAt: string;                   // When conversation started
  updatedAt: string;                   // Last message timestamp
  mutedUntil?: string;                 // Mute notifications until
  isPinned?: boolean;                  // Pin to top of list
}
```

---

## Friend System

### Friendship Lifecycle

```
┌────────────────────────────────────────────────────────┐
│                   FRIENDSHIP FLOW                       │
└────────────────────────────────────────────────────────┘

1. DISCOVERY
   ├─► Search by username: "@johndoe"
   ├─► Search by email: "john@example.com"
   ├─► Scan QR code
   └─► Accept invite link

2. SEND REQUEST
   ├─► Click "Add Friend" button
   ├─► Enter username or email
   ├─► Search for user
   ├─► View user profile preview
   └─► Send friend request

3. PENDING STATE
   ├─► Request appears in sender's "Sent Requests"
   ├─► Request appears in recipient's "Friend Requests"
   ├─► Push notification sent to recipient
   └─► Email notification (optional)

4. ACCEPTANCE
   ├─► Recipient accepts request
   ├─► Both users added to each other's friends list
   ├─► Direct message conversation created
   ├─► Push notification sent to sender
   └─► Both can now collaborate

5. FRIENDSHIP ACTIVE
   ├─► View each other's profile
   ├─► Send direct messages
   ├─► Invite to collaboration sessions
   ├─► Add to boards
   ├─► See online status
   └─► View shared experiences

6. FRIENDSHIP MANAGEMENT
   ├─► Mute notifications
   ├─► Block user
   ├─► Report user
   └─► Remove friend (unfriend)
```

### Friend List Management

**Friend List State:**
```typescript
// Redux state
interface FriendsState {
  // All friends
  friends: Friend[];
  
  // Pending requests
  sentRequests: FriendRequest[];       // Sent by current user
  receivedRequests: FriendRequest[];   // Received by current user
  
  // Blocked users
  blockedUsers: string[];              // User IDs
  
  // Muted friends
  mutedFriends: {
    [userId: string]: string;          // userId: mutedUntil timestamp
  };
  
  // Loading states
  isLoadingFriends: boolean;
  isLoadingRequests: boolean;
  
  // Error handling
  error: string | null;
}
```

**Core Friend Operations:**

```typescript
// 1. Load friends list
const loadFriends = async (): Promise<Friend[]> => {
  try {
    const response = await api.get('/friends');
    return response.data;
  } catch (error) {
    console.error('Failed to load friends:', error);
    throw error;
  }
};

// 2. Search friends (local)
const searchFriends = (friends: Friend[], query: string): Friend[] => {
  const lowerQuery = query.toLowerCase().trim();
  
  if (!lowerQuery) return friends;
  
  return friends.filter(friend => 
    friend.name.toLowerCase().includes(lowerQuery) ||
    friend.username.toLowerCase().includes(lowerQuery)
  );
};

// 3. Get online friends
const getOnlineFriends = (friends: Friend[]): Friend[] => {
  return friends.filter(friend => friend.status === 'online');
};

// 4. Get mutual friends count
const getMutualFriendsCount = async (userId: string, friendId: string): Promise<number> => {
  const response = await api.get(`/users/${userId}/mutual-friends/${friendId}`);
  return response.data.count;
};

// 5. Sort friends
const sortFriends = (friends: Friend[], sortBy: 'name' | 'recent' | 'online'): Friend[] => {
  switch (sortBy) {
    case 'name':
      return [...friends].sort((a, b) => a.name.localeCompare(b.name));
    
    case 'recent':
      return [...friends].sort((a, b) => {
        const aTime = new Date(a.lastSeen || 0).getTime();
        const bTime = new Date(b.lastSeen || 0).getTime();
        return bTime - aTime;
      });
    
    case 'online':
      return [...friends].sort((a, b) => {
        if (a.isOnline && !b.isOnline) return -1;
        if (!a.isOnline && b.isOnline) return 1;
        return a.name.localeCompare(b.name);
      });
    
    default:
      return friends;
  }
};
```

### Friend Actions

**Message Friend:**
```typescript
const handleMessageFriend = (friend: Friend) => {
  // 1. Find or create conversation
  const conversation = conversations[friend.id] || {
    id: `conv-${Date.now()}`,
    name: friend.name,
    type: 'direct',
    participants: [friend],
    lastMessage: null,
    unreadCount: 0,
    avatar: friend.avatar,
    isOnline: friend.isOnline,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  // 2. Mark messages as read
  dispatch(markMessagesAsRead(friend.id));
  
  // 3. Navigate to message interface
  navigation.navigate('MessageInterface', {
    friendId: friend.id,
    conversationId: conversation.id
  });
  
  // 4. Switch to messages tab
  dispatch(setActiveTab('messages'));
};
```

**Add to Board:**
```typescript
const handleAddToBoard = async (friend: Friend, boardId: string) => {
  try {
    // 1. Create collaboration invite
    const invite: CollaborationInvite = {
      id: generateId(),
      sessionId: boardId,
      sessionName: board.name,
      fromUser: currentUser,
      toUser: friend,
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: addDays(new Date(), 7).toISOString()
    };
    
    // 2. Save invite to database
    await api.post('/collaboration/invites', invite);
    
    // 3. Send push notification
    await pushNotification.send(friend.id, {
      title: `${currentUser.name} invited you to a board!`,
      body: `Join "${board.name}" to plan together`,
      data: {
        type: 'board:invite',
        inviteId: invite.id,
        boardId: board.id
      }
    });
    
    // 4. Update UI
    Toast.show({
      type: 'success',
      text1: 'Invite Sent!',
      text2: `${friend.name} will receive your invitation`
    });
    
  } catch (error) {
    console.error('Failed to add friend to board:', error);
    Toast.show({
      type: 'error',
      text1: 'Failed to send invite',
      text2: 'Please try again'
    });
  }
};
```

**Mute/Unmute Friend:**
```typescript
const handleMuteFriend = async (friend: Friend, duration: 'hour' | 'day' | 'week' | 'forever') => {
  const mutedUntil = duration === 'forever' 
    ? null 
    : addTime(new Date(), duration).toISOString();
  
  try {
    // Update database
    await api.patch(`/friends/${friend.id}/mute`, { mutedUntil });
    
    // Update local state
    dispatch(muteFriend({
      userId: friend.id,
      mutedUntil
    }));
    
    Toast.show({
      type: 'success',
      text1: 'Friend Muted',
      text2: `You won't receive notifications from ${friend.name}`
    });
  } catch (error) {
    console.error('Failed to mute friend:', error);
  }
};

const handleUnmuteFriend = async (friend: Friend) => {
  try {
    await api.delete(`/friends/${friend.id}/mute`);
    dispatch(unmuteFriend(friend.id));
    
    Toast.show({
      type: 'success',
      text1: 'Friend Unmuted',
      text2: `Notifications from ${friend.name} are now enabled`
    });
  } catch (error) {
    console.error('Failed to unmute friend:', error);
  }
};
```

**Remove Friend:**
```typescript
const handleRemoveFriend = async (friend: Friend) => {
  // 1. Show confirmation dialog
  Alert.alert(
    'Remove Friend',
    `Are you sure you want to remove ${friend.name} from your friends?`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            // 2. Remove friendship from database
            await api.delete(`/friends/${friend.id}`);
            
            // 3. Remove from local state
            dispatch(removeFriend(friend.id));
            
            // 4. Remove from all boards
            for (const board of boardsSessions) {
              if (board.participants.some(p => p.id === friend.id)) {
                await api.delete(`/boards/${board.id}/members/${friend.id}`);
                dispatch(removeBoardMember({ boardId: board.id, userId: friend.id }));
              }
            }
            
            // 5. Archive conversation
            dispatch(archiveConversation(friend.id));
            
            Toast.show({
              type: 'success',
              text1: 'Friend Removed',
              text2: `${friend.name} has been removed from your friends`
            });
          } catch (error) {
            console.error('Failed to remove friend:', error);
            Toast.show({
              type: 'error',
              text1: 'Failed to remove friend',
              text2: 'Please try again'
            });
          }
        }
      }
    ]
  );
};
```

**Block User:**
```typescript
const handleBlockUser = async (friend: Friend) => {
  Alert.alert(
    'Block User',
    `Are you sure you want to block ${friend.name}? They won't be able to message you or see your profile.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: async () => {
          try {
            // 1. Add to blocked users
            await api.post('/users/blocked', { userId: friend.id });
            
            // 2. Remove friendship
            await api.delete(`/friends/${friend.id}`);
            
            // 3. Remove from boards
            for (const board of boardsSessions) {
              if (board.participants.some(p => p.id === friend.id)) {
                await api.delete(`/boards/${board.id}/members/${friend.id}`);
              }
            }
            
            // 4. Update local state
            dispatch(blockUser(friend.id));
            dispatch(removeFriend(friend.id));
            
            Toast.show({
              type: 'success',
              text1: 'User Blocked',
              text2: `${friend.name} has been blocked`
            });
          } catch (error) {
            console.error('Failed to block user:', error);
          }
        }
      }
    ]
  );
};
```

**Report User:**
```typescript
const handleReportUser = async (friend: Friend, reason: string, details: string) => {
  try {
    // 1. Submit report to moderation queue
    await api.post('/moderation/reports', {
      reportedUserId: friend.id,
      reportedByUserId: currentUser.id,
      reason,
      details,
      timestamp: new Date().toISOString()
    });
    
    // 2. Optionally block user
    Alert.alert(
      'Report Submitted',
      'Would you also like to block this user?',
      [
        {
          text: 'No',
          onPress: () => {
            Toast.show({
              type: 'success',
              text1: 'Report Submitted',
              text2: 'Our team will review your report'
            });
          }
        },
        {
          text: 'Yes, Block',
          style: 'destructive',
          onPress: () => handleBlockUser(friend)
        }
      ]
    );
  } catch (error) {
    console.error('Failed to report user:', error);
    Toast.show({
      type: 'error',
      text1: 'Failed to submit report',
      text2: 'Please try again'
    });
  }
};
```

---

## Friend Request System

### Request Flow

```
┌─────────────────────────────────────────────────────────┐
│              FRIEND REQUEST LIFECYCLE                    │
└─────────────────────────────────────────────────────────┘

USER A (Sender)                    USER B (Recipient)
     │                                    │
     ├─► Search for user                 │
     ├─► View profile preview            │
     ├─► Send friend request ────────────┼─► Receive push notification
     │                                    ├─► See in "Friend Requests" tab
     ├─► Request in "Sent Requests"      │
     │                                    │
     │   ┌─────────────────────────────┐ │
     │   │  PENDING STATE              │ │
     │   │  • Can cancel request       │ │
     │   │  • Shows "Request Sent"     │ │
     │   └─────────────────────────────┘ │
     │                                    │
     │                                    ├─► Accept/Decline decision
     │                                    │
     │   ┌─────── IF ACCEPTED ─────────┐ │
     │   │                             │ │
     ├───┼─ Receive notification       │ │
     │   │  "John accepted your        │ │
     │   │   friend request!"          │ │
     │   │                             │ │
     ├───┼─ Added to friends list ─────┼─┤
     │   │                             │ │
     ├───┼─ Conversation created ──────┼─┤
     │   │                             │ │
     ├───┼─ Can now collaborate ───────┼─┤
     │   │                             │ │
     │   └─────────────────────────────┘ │
     │                                    │
     │   ┌─────── IF DECLINED ─────────┐ │
     │   │                             │ │
     ├───┼─ Receive notification       │ │
     │   │  (optional, based on        │ │
     │   │   privacy settings)         │ │
     │   │                             │ │
     │   └─────────────────────────────┘ │
     │                                    │
```

### Sending Friend Requests

**Search for User:**
```typescript
const searchUserByUsernameOrEmail = async (query: string): Promise<SearchResult | null> => {
  try {
    // Clean input
    const cleanQuery = query.trim().toLowerCase();
    
    // Determine if email or username
    const isEmail = cleanQuery.includes('@');
    const searchParam = isEmail ? 'email' : 'username';
    
    // Search API
    const response = await api.get('/users/search', {
      params: { [searchParam]: cleanQuery }
    });
    
    if (!response.data.user) {
      return null;
    }
    
    const user = response.data.user;
    
    // Check relationship status
    const relationshipStatus = await checkRelationship(user.id);
    
    return {
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        avatar: user.avatar,
        mutualFriends: response.data.mutualFriendsCount || 0,
        isPremium: user.isPremium,
        bio: user.bio
      },
      relationship: relationshipStatus // 'none' | 'friend' | 'pending_sent' | 'pending_received' | 'blocked'
    };
  } catch (error) {
    console.error('User search failed:', error);
    throw error;
  }
};

const checkRelationship = async (userId: string): Promise<RelationshipStatus> => {
  try {
    const response = await api.get(`/users/${userId}/relationship`);
    return response.data.status;
  } catch (error) {
    return 'none';
  }
};

type RelationshipStatus = 
  | 'none'              // No relationship
  | 'friend'            // Already friends
  | 'pending_sent'      // Request sent by current user
  | 'pending_received'  // Request received from this user
  | 'blocked';          // User is blocked
```

**Send Request:**
```typescript
const sendFriendRequest = async (targetUserId: string, message?: string): Promise<FriendRequest> => {
  try {
    // 1. Create request object
    const request: FriendRequest = {
      id: generateId(),
      fromUserId: currentUser.id,
      toUserId: targetUserId,
      status: 'pending',
      fromUser: {
        id: currentUser.id,
        name: currentUser.name,
        username: currentUser.username,
        avatar: currentUser.avatar,
        mutualFriends: 0 // Will be calculated by backend
      },
      toUser: {
        id: targetUserId,
        name: '', // Will be filled by backend
        username: ''
      },
      createdAt: new Date().toISOString(),
      expiresAt: addDays(new Date(), 30).toISOString(), // 30 days to respond
      message
    };
    
    // 2. Save to database
    const response = await api.post('/friend-requests', request);
    
    // 3. Add to local state
    dispatch(addSentRequest(response.data));
    
    // 4. Send push notification
    await pushNotification.send(targetUserId, {
      title: 'New Friend Request',
      body: `${currentUser.name} wants to be your friend`,
      data: {
        type: 'friend:request',
        requestId: response.data.id,
        fromUserId: currentUser.id
      }
    });
    
    // 5. Success feedback
    Toast.show({
      type: 'success',
      text1: 'Friend Request Sent!',
      text2: 'They will be notified'
    });
    
    return response.data;
  } catch (error) {
    console.error('Failed to send friend request:', error);
    throw error;
  }
};
```

**Cancel Sent Request:**
```typescript
const cancelFriendRequest = async (requestId: string) => {
  try {
    // 1. Update request status
    await api.patch(`/friend-requests/${requestId}`, {
      status: 'canceled'
    });
    
    // 2. Remove from local state
    dispatch(removeSentRequest(requestId));
    
    // 3. Notify recipient (optional)
    // This removes the request from their "Friend Requests" list
    
    Toast.show({
      type: 'info',
      text1: 'Request Canceled',
      text2: 'Friend request has been canceled'
    });
  } catch (error) {
    console.error('Failed to cancel request:', error);
  }
};
```

### Receiving & Responding to Requests

**Load Received Requests:**
```typescript
const loadReceivedRequests = async (): Promise<FriendRequest[]> => {
  try {
    const response = await api.get('/friend-requests/received');
    return response.data;
  } catch (error) {
    console.error('Failed to load received requests:', error);
    return [];
  }
};
```

**Accept Request:**
```typescript
const acceptFriendRequest = async (requestId: string, request: FriendRequest) => {
  try {
    // 1. Update request status
    await api.patch(`/friend-requests/${requestId}/accept`);
    
    // 2. Create bi-directional friendship
    const friendship = await api.post('/friendships', {
      userId1: request.fromUserId,
      userId2: currentUser.id,
      createdAt: new Date().toISOString()
    });
    
    // 3. Add to friends list (both users)
    const newFriend: Friend = {
      id: request.fromUser.id,
      name: request.fromUser.name,
      username: request.fromUser.username,
      avatar: request.fromUser.avatar,
      status: 'offline', // Will be updated by real-time presence
      isOnline: false,
      mutualFriends: request.fromUser.mutualFriends,
      friendsSince: new Date().toISOString()
    };
    
    dispatch(addFriend(newFriend));
    
    // 4. Create conversation
    const conversation: Conversation = {
      id: generateId(),
      name: newFriend.name,
      type: 'direct',
      participants: [newFriend],
      lastMessage: null as any, // No messages yet
      unreadCount: 0,
      avatar: newFriend.avatar,
      isOnline: newFriend.isOnline,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    dispatch(createConversation(conversation));
    
    // 5. Remove from received requests
    dispatch(removeReceivedRequest(requestId));
    
    // 6. Send notification to requester
    await pushNotification.send(request.fromUserId, {
      title: 'Friend Request Accepted!',
      body: `${currentUser.name} accepted your friend request`,
      data: {
        type: 'friend:accepted',
        userId: currentUser.id
      }
    });
    
    // 7. Success feedback
    Toast.show({
      type: 'success',
      text1: 'Friend Added!',
      text2: `You and ${newFriend.name} are now friends`
    });
    
  } catch (error) {
    console.error('Failed to accept friend request:', error);
    Toast.show({
      type: 'error',
      text1: 'Failed to accept request',
      text2: 'Please try again'
    });
  }
};
```

**Decline Request:**
```typescript
const declineFriendRequest = async (requestId: string, request: FriendRequest) => {
  try {
    // 1. Update request status
    await api.patch(`/friend-requests/${requestId}/decline`);
    
    // 2. Remove from received requests
    dispatch(removeReceivedRequest(requestId));
    
    // 3. Optional: Send notification to requester
    // (Based on user privacy settings)
    const shouldNotify = await getPrivacySetting('notifyOnRequestDecline');
    
    if (shouldNotify) {
      await pushNotification.send(request.fromUserId, {
        title: 'Friend Request Declined',
        body: `${currentUser.name} declined your friend request`,
        data: {
          type: 'friend:declined',
          userId: currentUser.id
        }
      });
    }
    
    Toast.show({
      type: 'info',
      text1: 'Request Declined',
      text2: 'Friend request has been declined'
    });
  } catch (error) {
    console.error('Failed to decline request:', error);
  }
};
```

---

## Add Friend Methods

### Method 1: Username Search

**UI Flow:**
```
1. User opens "Add Friend" modal
2. Enters username (with @ symbol optional)
3. Clicks "Search"
4. System searches database
5. Shows user preview with:
   - Name
   - Username
   - Avatar
   - Mutual friends count
   - Bio (optional)
6. User clicks "Send Friend Request"
7. Request sent
```

**Implementation:**
```typescript
const AddFriendByUsername = () => {
  const [username, setUsername] = useState('');
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const handleSearch = async () => {
    setIsLoading(true);
    setError('');
    setSearchResult(null);
    
    try {
      // Clean username (remove @ if present)
      const cleanUsername = username.replace('@', '').trim();
      
      if (!cleanUsername) {
        setError('Please enter a username');
        return;
      }
      
      // Search for user
      const result = await searchUserByUsernameOrEmail(cleanUsername);
      
      if (!result) {
        setError('User not found. Check the username and try again.');
        return;
      }
      
      // Check if already friends or request pending
      if (result.relationship === 'friend') {
        setError('You are already friends with this user');
        return;
      }
      
      if (result.relationship === 'pending_sent') {
        setError('Friend request already sent');
        return;
      }
      
      if (result.relationship === 'pending_received') {
        setError('This user has sent you a friend request. Check your requests!');
        return;
      }
      
      if (result.relationship === 'blocked') {
        setError('Unable to send friend request');
        return;
      }
      
      setSearchResult(result);
    } catch (err) {
      setError('Search failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleSendRequest = async () => {
    if (!searchResult) return;
    
    try {
      setIsLoading(true);
      await sendFriendRequest(searchResult.user.id);
      
      // Close modal after success
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err) {
      setError('Failed to send request');
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <Modal visible={visible} onRequestClose={onClose}>
      <View style={styles.container}>
        <Text style={styles.title}>Add Friend by Username</Text>
        
        {/* Search Input */}
        <TextInput
          value={username}
          onChangeText={setUsername}
          placeholder="Enter username (e.g., @johndoe)"
          autoCapitalize="none"
          style={styles.input}
        />
        
        {/* Error Message */}
        {error && (
          <View style={styles.errorContainer}>
            <AlertCircle />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
        
        {/* Search Button */}
        {!searchResult && (
          <Button
            title={isLoading ? 'Searching...' : 'Search'}
            onPress={handleSearch}
            disabled={isLoading || !username.trim()}
          />
        )}
        
        {/* Search Result */}
        {searchResult && (
          <View style={styles.resultContainer}>
            <Image source={{ uri: searchResult.user.avatar }} style={styles.avatar} />
            <Text style={styles.name}>{searchResult.user.name}</Text>
            <Text style={styles.username}>@{searchResult.user.username}</Text>
            
            {searchResult.user.mutualFriends > 0 && (
              <Text style={styles.mutualFriends}>
                {searchResult.user.mutualFriends} mutual friends
              </Text>
            )}
            
            {searchResult.user.bio && (
              <Text style={styles.bio}>{searchResult.user.bio}</Text>
            )}
            
            <Button
              title={isLoading ? 'Sending...' : 'Send Friend Request'}
              onPress={handleSendRequest}
              disabled={isLoading}
            />
          </View>
        )}
      </View>
    </Modal>
  );
};
```

### Method 2: Email Search

**Implementation:**
```typescript
const AddFriendByEmail = () => {
  const [email, setEmail] = useState('');
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };
  
  const handleSearch = async () => {
    setIsLoading(true);
    setError('');
    setSearchResult(null);
    
    try {
      if (!validateEmail(email)) {
        setError('Please enter a valid email address');
        return;
      }
      
      const result = await searchUserByUsernameOrEmail(email);
      
      if (!result) {
        setError('No user found with this email address');
        return;
      }
      
      // Same relationship checks as username search
      if (result.relationship === 'friend') {
        setError('You are already friends with this user');
        return;
      }
      
      if (result.relationship === 'pending_sent') {
        setError('Friend request already sent');
        return;
      }
      
      setSearchResult(result);
    } catch (err) {
      setError('Search failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };
  
  // Rest similar to username search...
};
```

### Method 3: QR Code

**Generate QR Code:**
```typescript
import QRCode from 'react-native-qrcode-svg';

const GenerateQRCode = () => {
  // Create unique QR code data
  const qrData = JSON.stringify({
    type: 'mingla:friend',
    userId: currentUser.id,
    username: currentUser.username,
    timestamp: Date.now()
  });
  
  return (
    <View style={styles.qrContainer}>
      <Text style={styles.title}>My QR Code</Text>
      <Text style={styles.subtitle}>Let friends scan this to add you</Text>
      
      <View style={styles.qrWrapper}>
        <QRCode
          value={qrData}
          size={200}
          logo={require('./assets/mingla-logo.png')}
          logoSize={40}
          backgroundColor="white"
          color="#eb7825"
        />
      </View>
      
      <Text style={styles.username}>@{currentUser.username}</Text>
      
      <View style={styles.actions}>
        <Button title="Share QR Code" onPress={handleShareQRCode} />
        <Button title="Save to Photos" onPress={handleSaveQRCode} />
      </View>
    </View>
  );
};

const handleShareQRCode = async () => {
  try {
    await Share.share({
      message: `Add me on Mingla! Scan my QR code or search: @${currentUser.username}`,
      url: qrCodeImageUri
    });
  } catch (error) {
    console.error('Failed to share QR code:', error);
  }
};

const handleSaveQRCode = async () => {
  try {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to save QR code');
      return;
    }
    
    await MediaLibrary.saveToLibraryAsync(qrCodeImageUri);
    
    Toast.show({
      type: 'success',
      text1: 'QR Code Saved',
      text2: 'Saved to your photos'
    });
  } catch (error) {
    console.error('Failed to save QR code:', error);
  }
};
```

**Scan QR Code:**
```typescript
import { BarCodeScanner } from 'expo-barcode-scanner';

const ScanQRCode = () => {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  
  useEffect(() => {
    (async () => {
      const { status } = await BarCodeScanner.requestPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);
  
  const handleBarCodeScanned = async ({ type, data }: BarCodeEvent) => {
    setScanned(true);
    
    try {
      // Parse QR code data
      const qrData = JSON.parse(data);
      
      if (qrData.type !== 'mingla:friend') {
        Alert.alert('Invalid QR Code', 'This is not a valid Mingla friend QR code');
        return;
      }
      
      // Check if scanning own QR code
      if (qrData.userId === currentUser.id) {
        Alert.alert('That\'s You!', 'You can\'t add yourself as a friend');
        setScanned(false);
        return;
      }
      
      // Load user data
      const user = await api.get(`/users/${qrData.userId}`);
      
      // Check relationship
      const relationship = await checkRelationship(qrData.userId);
      
      if (relationship === 'friend') {
        Alert.alert('Already Friends', `You are already friends with ${user.data.name}`);
        setScanned(false);
        return;
      }
      
      if (relationship === 'pending_sent') {
        Alert.alert('Request Pending', 'Friend request already sent');
        setScanned(false);
        return;
      }
      
      // Show confirmation
      Alert.alert(
        'Add Friend',
        `Send friend request to ${user.data.name} (@${user.data.username})?`,
        [
          {
            text: 'Cancel',
            onPress: () => setScanned(false),
            style: 'cancel'
          },
          {
            text: 'Send Request',
            onPress: async () => {
              await sendFriendRequest(qrData.userId);
              navigation.goBack();
            }
          }
        ]
      );
      
    } catch (error) {
      console.error('Failed to process QR code:', error);
      Alert.alert('Error', 'Failed to process QR code');
      setScanned(false);
    }
  };
  
  if (hasPermission === null) {
    return <Text>Requesting camera permission...</Text>;
  }
  
  if (hasPermission === false) {
    return <Text>No access to camera</Text>;
  }
  
  return (
    <View style={styles.container}>
      <BarCodeScanner
        onBarCodeScanned={scanned ? undefined : handleBarCodeScanned}
        style={StyleSheet.absoluteFillObject}
      />
      
      <View style={styles.overlay}>
        <Text style={styles.instructions}>
          Point camera at friend's QR code
        </Text>
        
        {scanned && (
          <Button title="Scan Again" onPress={() => setScanned(false)} />
        )}
      </View>
    </View>
  );
};
```

### Method 4: Invite Link

**Generate Invite Link:**
```typescript
const generateInviteLink = (userId: string, username: string): string => {
  // Create unique invite token
  const token = generateInviteToken(userId);
  
  // Store token in database with expiration
  api.post('/invite-links', {
    token,
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: addDays(new Date(), 7).toISOString()
  });
  
  // Return shareable link
  return `https://mingla.app/add-friend/${token}`;
};

const handleCopyInviteLink = async () => {
  const inviteLink = generateInviteLink(currentUser.id, currentUser.username);
  
  await Clipboard.setStringAsync(inviteLink);
  
  Toast.show({
    type: 'success',
    text1: 'Link Copied!',
    text2: 'Share this link with friends to connect'
  });
  
  // Track analytics
  analytics.track('invite_link_copied');
};

const handleShareInviteLink = async () => {
  const inviteLink = generateInviteLink(currentUser.id, currentUser.username);
  
  try {
    await Share.share({
      message: `Add me on Mingla! ${inviteLink}`,
      url: inviteLink,
      title: 'Connect on Mingla'
    });
    
    // Track analytics
    analytics.track('invite_link_shared');
  } catch (error) {
    console.error('Failed to share invite link:', error);
  }
};
```

**Handle Invite Link (Deep Linking):**
```typescript
// In App.tsx or navigation setup
import * as Linking from 'expo-linking';

const linking = {
  prefixes: ['mingla://', 'https://mingla.app'],
  config: {
    screens: {
      AddFriendFromLink: 'add-friend/:token'
    }
  }
};

// AddFriendFromLink Screen
const AddFriendFromLink = ({ route }) => {
  const { token } = route.params;
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  
  useEffect(() => {
    loadUserFromToken();
  }, [token]);
  
  const loadUserFromToken = async () => {
    try {
      // Validate and decode token
      const response = await api.get(`/invite-links/${token}`);
      
      if (response.data.expired) {
        setError('This invite link has expired');
        return;
      }
      
      // Check if trying to add self
      if (response.data.userId === currentUser.id) {
        setError('You can\'t add yourself as a friend');
        return;
      }
      
      // Check existing relationship
      const relationship = await checkRelationship(response.data.userId);
      
      if (relationship === 'friend') {
        setError(`You are already friends with ${response.data.user.name}`);
        return;
      }
      
      if (relationship === 'pending_sent') {
        setError('Friend request already sent');
        return;
      }
      
      setUser(response.data.user);
    } catch (err) {
      setError('Invalid or expired invite link');
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleSendRequest = async () => {
    if (!user) return;
    
    try {
      await sendFriendRequest(user.id);
      navigation.navigate('Connections', { tab: 'friends' });
    } catch (err) {
      Alert.alert('Error', 'Failed to send friend request');
    }
  };
  
  if (isLoading) {
    return <LoadingScreen />;
  }
  
  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <Button title="Go to Connections" onPress={() => navigation.navigate('Connections')} />
      </View>
    );
  }
  
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Add Friend</Text>
      
      <Image source={{ uri: user.avatar }} style={styles.avatar} />
      <Text style={styles.name}>{user.name}</Text>
      <Text style={styles.username}>@{user.username}</Text>
      
      {user.bio && <Text style={styles.bio}>{user.bio}</Text>}
      
      <Button
        title="Send Friend Request"
        onPress={handleSendRequest}
      />
    </View>
  );
};
```

---

## Integration with Collaboration

### Adding Friends to Collaboration Sessions

**When Creating a Session:**
```typescript
const CreateCollaborationSession = () => {
  const [sessionName, setSessionName] = useState('');
  const [selectedFriends, setSelectedFriends] = useState<Friend[]>([]);
  const [step, setStep] = useState<'name' | 'friends' | 'confirm'>('name');
  
  const handleCreateSession = async () => {
    try {
      // 1. Create session
      const session: CollaborationSession = {
        id: generateId(),
        name: sessionName,
        type: 'group-hangout',
        description: `Planning session with ${selectedFriends.map(f => f.name).join(', ')}`,
        status: 'pending',
        participants: [
          {
            id: currentUser.id,
            name: currentUser.name,
            status: 'online'
          },
          ...selectedFriends.map(friend => ({
            id: friend.id,
            name: friend.name,
            status: friend.status
          }))
        ],
        admins: [currentUser.id], // Creator is admin
        creatorId: currentUser.id,
        currentUserId: currentUser.id,
        pendingParticipants: selectedFriends.length,
        totalParticipants: selectedFriends.length + 1,
        cards: [],
        cardsCount: 0,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        unreadMessages: 0
      };
      
      // 2. Save session to database
      await api.post('/collaboration/sessions', session);
      
      // 3. Send invitations to all friends
      for (const friend of selectedFriends) {
        await sendCollaborationInvite(session.id, friend.id);
      }
      
      // 4. Add to local state
      dispatch(addCollaborationSession(session));
      
      // 5. Switch to board mode
      dispatch(switchMode(session.id));
      
      // 6. Navigate to board
      navigation.navigate('BoardDiscussion', { boardId: session.id });
      
      Toast.show({
        type: 'success',
        text1: 'Session Created!',
        text2: `Invites sent to ${selectedFriends.length} friends`
      });
      
    } catch (error) {
      console.error('Failed to create session:', error);
      Toast.show({
        type: 'error',
        text1: 'Failed to create session',
        text2: 'Please try again'
      });
    }
  };
  
  return (
    <View>
      {step === 'name' && (
        <View>
          <TextInput
            value={sessionName}
            onChangeText={setSessionName}
            placeholder="Enter session name"
          />
          <Button
            title="Continue"
            onPress={() => setStep('friends')}
            disabled={!sessionName.trim()}
          />
        </View>
      )}
      
      {step === 'friends' && (
        <View>
          <Text style={styles.title}>Select Friends</Text>
          
          <FlatList
            data={friends}
            renderItem={({ item: friend }) => (
              <TouchableOpacity
                onPress={() => {
                  if (selectedFriends.some(f => f.id === friend.id)) {
                    setSelectedFriends(prev => prev.filter(f => f.id !== friend.id));
                  } else {
                    setSelectedFriends(prev => [...prev, friend]);
                  }
                }}
                style={[
                  styles.friendItem,
                  selectedFriends.some(f => f.id === friend.id) && styles.friendItemSelected
                ]}
              >
                <Image source={{ uri: friend.avatar }} style={styles.avatar} />
                <Text>{friend.name}</Text>
                {selectedFriends.some(f => f.id === friend.id) && <CheckIcon />}
              </TouchableOpacity>
            )}
          />
          
          <Button
            title={`Continue (${selectedFriends.length} selected)`}
            onPress={() => setStep('confirm')}
            disabled={selectedFriends.length === 0}
          />
        </View>
      )}
      
      {step === 'confirm' && (
        <View>
          <Text style={styles.title}>Confirm Session</Text>
          <Text style={styles.sessionName}>{sessionName}</Text>
          
          <Text style={styles.subtitle}>Participants ({selectedFriends.length + 1})</Text>
          <Text style={styles.participant}>You (Creator)</Text>
          {selectedFriends.map(friend => (
            <Text key={friend.id} style={styles.participant}>{friend.name}</Text>
          ))}
          
          <Button
            title="Create Session"
            onPress={handleCreateSession}
          />
        </View>
      )}
    </View>
  );
};
```

**Adding Friend to Existing Session:**
```typescript
const AddFriendToBoard = ({ board, friend }: { board: CollaborationSession; friend: Friend }) => {
  const handleAddFriend = async () => {
    try {
      // 1. Check if friend is already in board
      if (board.participants.some(p => p.id === friend.id)) {
        Alert.alert('Already in Board', `${friend.name} is already in this session`);
        return;
      }
      
      // 2. Send invite
      await sendCollaborationInvite(board.id, friend.id);
      
      // 3. Update board participants (pending)
      const updatedBoard = {
        ...board,
        pendingParticipants: board.pendingParticipants + 1,
        totalParticipants: board.totalParticipants + 1
      };
      
      dispatch(updateCollaborationSession(updatedBoard));
      
      Toast.show({
        type: 'success',
        text1: 'Invite Sent!',
        text2: `${friend.name} will receive your invitation`
      });
      
    } catch (error) {
      console.error('Failed to add friend to board:', error);
      Toast.show({
        type: 'error',
        text1: 'Failed to send invite',
        text2: 'Please try again'
      });
    }
  };
  
  return (
    <View>
      <Text>Add {friend.name} to {board.name}?</Text>
      <Button title="Send Invite" onPress={handleAddFriend} />
    </View>
  );
};
```

### Friend Presence in Collaboration

**Show Online Friends in Session:**
```typescript
const BoardParticipants = ({ board }: { board: CollaborationSession }) => {
  const onlineParticipants = board.participants.filter(p => p.status === 'online');
  const offlineParticipants = board.participants.filter(p => p.status !== 'online');
  
  return (
    <View>
      <Text style={styles.sectionTitle}>
        Online ({onlineParticipants.length})
      </Text>
      
      {onlineParticipants.map(participant => (
        <View key={participant.id} style={styles.participantRow}>
          <View style={styles.avatarContainer}>
            <Image source={{ uri: participant.avatar }} style={styles.avatar} />
            <View style={[styles.statusIndicator, styles.online]} />
          </View>
          <Text style={styles.participantName}>{participant.name}</Text>
          {board.admins.includes(participant.id) && (
            <Badge text="Admin" color="#eb7825" />
          )}
        </View>
      ))}
      
      {offlineParticipants.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>
            Offline ({offlineParticipants.length})
          </Text>
          
          {offlineParticipants.map(participant => (
            <View key={participant.id} style={styles.participantRow}>
              <Image source={{ uri: participant.avatar }} style={styles.avatar} />
              <Text style={styles.participantName}>{participant.name}</Text>
              <Text style={styles.lastSeen}>
                {formatLastSeen(participant.lastSeen)}
              </Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
};
```

---

## Integration with Board Cards

### Tagging Friends in Card Discussions

**@Mention System:**
```typescript
const CardDiscussionInput = ({ board, card }: { board: CollaborationSession; card: BoardCard }) => {
  const [message, setMessage] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionResults, setMentionResults] = useState<Friend[]>([]);
  
  const handleMessageChange = (text: string) => {
    setMessage(text);
    
    // Detect @ mentions
    const atIndex = text.lastIndexOf('@');
    if (atIndex !== -1) {
      const query = text.substring(atIndex + 1);
      
      // Check if still typing mention (no space after @)
      if (!query.includes(' ')) {
        setMentionQuery(query);
        setShowMentions(true);
        
        // Filter participants by query
        const results = board.participants.filter(p =>
          p.name.toLowerCase().includes(query.toLowerCase()) ||
          p.username.toLowerCase().includes(query.toLowerCase())
        );
        
        setMentionResults(results);
      } else {
        setShowMentions(false);
      }
    } else {
      setShowMentions(false);
    }
  };
  
  const handleSelectMention = (participant: Participant) => {
    // Replace the @query with @username
    const atIndex = message.lastIndexOf('@');
    const newMessage = message.substring(0, atIndex) + `@${participant.username} `;
    
    setMessage(newMessage);
    setShowMentions(false);
  };
  
  const extractMentions = (text: string): string[] => {
    const mentionRegex = /@(\w+)/g;
    const matches = text.match(mentionRegex);
    return matches ? matches.map(m => m.substring(1)) : [];
  };
  
  const handleSendMessage = async () => {
    if (!message.trim()) return;
    
    const mentions = extractMentions(message);
    
    const newMessage: BoardMessage = {
      id: generateId(),
      boardId: board.id,
      cardId: card.id,
      user: currentUser,
      content: message,
      timestamp: new Date().toISOString(),
      mentions,
      isEdited: false,
      isDeleted: false
    };
    
    // Send message
    await api.post(`/boards/${board.id}/cards/${card.id}/messages`, newMessage);
    
    // Broadcast to real-time listeners
    socket.emit('card:message', newMessage);
    
    // Send notifications to mentioned users
    for (const mention of mentions) {
      const participant = board.participants.find(p => p.username === mention);
      if (participant && participant.id !== currentUser.id) {
        await pushNotification.send(participant.id, {
          title: `${currentUser.name} mentioned you`,
          body: message,
          data: {
            type: 'board:mention',
            boardId: board.id,
            cardId: card.id,
            messageId: newMessage.id
          }
        });
      }
    }
    
    setMessage('');
  };
  
  return (
    <View>
      <TextInput
        value={message}
        onChangeText={handleMessageChange}
        placeholder="Type a message..."
        multiline
        style={styles.input}
      />
      
      {showMentions && mentionResults.length > 0 && (
        <View style={styles.mentionsDropdown}>
          {mentionResults.map(participant => (
            <TouchableOpacity
              key={participant.id}
              onPress={() => handleSelectMention(participant)}
              style={styles.mentionItem}
            >
              <Image source={{ uri: participant.avatar }} style={styles.mentionAvatar} />
              <View>
                <Text style={styles.mentionName}>{participant.name}</Text>
                <Text style={styles.mentionUsername}>@{participant.username}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
      
      <Button title="Send" onPress={handleSendMessage} disabled={!message.trim()} />
    </View>
  );
};
```

### Showing Friend Activity on Cards

**Who Voted/RSVP'd:**
```typescript
const CardVotingDisplay = ({ board, card }: { board: CollaborationSession; card: BoardCard }) => {
  // Get friends who voted yes
  const yesVoters = Object.entries(card.votes.voters)
    .filter(([userId, vote]) => vote === 'yes')
    .map(([userId]) => board.participants.find(p => p.id === userId))
    .filter(Boolean);
  
  // Get friends who voted no
  const noVoters = Object.entries(card.votes.voters)
    .filter(([userId, vote]) => vote === 'no')
    .map(([userId]) => board.participants.find(p => p.id === userId))
    .filter(Boolean);
  
  // Get friends who RSVP'd yes
  const attendees = card.rsvps.attendees
    .map(userId => board.participants.find(p => p.id === userId))
    .filter(Boolean);
  
  return (
    <View style={styles.container}>
      {/* Voting Breakdown */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Voting</Text>
        
        <View style={styles.voteRow}>
          <ThumbsUp color="green" />
          <Text style={styles.voteCount}>{card.votes.yes}</Text>
          <View style={styles.voters}>
            {yesVoters.slice(0, 3).map(voter => (
              <Image
                key={voter.id}
                source={{ uri: voter.avatar }}
                style={styles.voterAvatar}
              />
            ))}
            {yesVoters.length > 3 && (
              <Text style={styles.moreVoters}>+{yesVoters.length - 3}</Text>
            )}
          </View>
        </View>
        
        <View style={styles.voteRow}>
          <ThumbsDown color="red" />
          <Text style={styles.voteCount}>{card.votes.no}</Text>
          <View style={styles.voters}>
            {noVoters.slice(0, 3).map(voter => (
              <Image
                key={voter.id}
                source={{ uri: voter.avatar }}
                style={styles.voterAvatar}
              />
            ))}
            {noVoters.length > 3 && (
              <Text style={styles.moreVoters}>+{noVoters.length - 3}</Text>
            )}
          </View>
        </View>
      </View>
      
      {/* RSVP Breakdown */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Attending ({card.rsvps.responded}/{card.rsvps.total})
        </Text>
        
        <View style={styles.attendeesList}>
          {attendees.map(attendee => (
            <View key={attendee.id} style={styles.attendeeRow}>
              <Image source={{ uri: attendee.avatar }} style={styles.attendeeAvatar} />
              <Text style={styles.attendeeName}>{attendee.name}</Text>
              <CheckCircle color="green" />
            </View>
          ))}
        </View>
      </View>
      
      {/* Who hasn't responded */}
      {card.rsvps.responded < card.rsvps.total && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Awaiting Response</Text>
          {board.participants
            .filter(p => !card.rsvps.attendees.includes(p.id))
            .map(participant => (
              <View key={participant.id} style={styles.pendingRow}>
                <Image source={{ uri: participant.avatar }} style={styles.avatar} />
                <Text style={styles.participantName}>{participant.name}</Text>
                <Clock size={16} color="gray" />
              </View>
            ))}
        </View>
      )}
    </View>
  );
};
```

---

## Direct Messaging

### Message Types

**Text Message:**
```typescript
const sendTextMessage = async (conversationId: string, content: string) => {
  const message: Message = {
    id: generateId(),
    conversationId,
    senderId: currentUser.id,
    senderName: currentUser.name,
    content,
    timestamp: new Date().toISOString(),
    type: 'text',
    isMe: true,
    unread: true
  };
  
  // Save to database
  await api.post(`/conversations/${conversationId}/messages`, message);
  
  // Add to local state
  dispatch(addMessage(message));
  
  // Broadcast via WebSocket
  socket.emit('message:send', message);
  
  // Send push notification
  const conversation = conversations[conversationId];
  const recipient = conversation.participants.find(p => p.id !== currentUser.id);
  
  if (recipient) {
    await pushNotification.send(recipient.id, {
      title: currentUser.name,
      body: content,
      data: {
        type: 'message:new',
        conversationId,
        messageId: message.id
      }
    });
  }
  
  return message;
};
```

**Image Message:**
```typescript
import * as ImagePicker from 'expo-image-picker';
import { uploadFile } from './storage';

const sendImageMessage = async (conversationId: string) => {
  try {
    // 1. Pick image
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
      base64: false
    });
    
    if (result.canceled) return;
    
    const image = result.assets[0];
    
    // 2. Show uploading state
    const tempMessage: Message = {
      id: 'temp-' + Date.now(),
      conversationId,
      senderId: currentUser.id,
      senderName: currentUser.name,
      content: '',
      timestamp: new Date().toISOString(),
      type: 'image',
      fileUrl: image.uri, // Local URI temporarily
      isMe: true,
      unread: true,
      isUploading: true
    };
    
    dispatch(addMessage(tempMessage));
    
    // 3. Upload to cloud storage
    const uploadedUrl = await uploadFile(image.uri, `messages/${conversationId}/${Date.now()}.jpg`);
    
    // 4. Create actual message
    const message: Message = {
      ...tempMessage,
      id: generateId(),
      fileUrl: uploadedUrl,
      fileName: image.fileName || 'image.jpg',
      fileSize: formatFileSize(image.fileSize || 0),
      isUploading: false
    };
    
    // 5. Save to database
    await api.post(`/conversations/${conversationId}/messages`, message);
    
    // 6. Replace temp message
    dispatch(replaceMessage({ tempId: tempMessage.id, message }));
    
    // 7. Broadcast
    socket.emit('message:send', message);
    
    // 8. Send notification
    await sendMessageNotification(conversationId, 'Sent an image');
    
    return message;
  } catch (error) {
    console.error('Failed to send image:', error);
    Toast.show({
      type: 'error',
      text1: 'Failed to send image',
      text2: 'Please try again'
    });
  }
};
```

### Conversation Management

**Create Conversation:**
```typescript
const createConversation = async (friendId: string): Promise<Conversation> => {
  try {
    // Check if conversation already exists
    const existing = await api.get(`/conversations/with/${friendId}`);
    if (existing.data) {
      return existing.data;
    }
    
    // Get friend data
    const friend = friends.find(f => f.id === friendId);
    if (!friend) throw new Error('Friend not found');
    
    // Create new conversation
    const conversation: Conversation = {
      id: generateId(),
      name: friend.name,
      type: 'direct',
      participants: [friend],
      lastMessage: null as any,
      unreadCount: 0,
      avatar: friend.avatar,
      isOnline: friend.isOnline,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    // Save to database
    await api.post('/conversations', conversation);
    
    // Add to local state
    dispatch(addConversation(conversation));
    
    return conversation;
  } catch (error) {
    console.error('Failed to create conversation:', error);
    throw error;
  }
};
```

**Mark Messages as Read:**
```typescript
const markConversationAsRead = async (conversationId: string) => {
  try {
    // Update database
    await api.patch(`/conversations/${conversationId}/read`);
    
    // Update local state
    dispatch(markMessagesAsRead(conversationId));
    
    // Notify sender (read receipts)
    socket.emit('messages:read', { conversationId, userId: currentUser.id });
  } catch (error) {
    console.error('Failed to mark as read:', error);
  }
};
```

---

## Complete React Native Implementation

### File Structure

```
/src
├── /screens
│   ├── ConnectionsScreen.tsx          # Main connections page
│   ├── AddFriendScreen.tsx            # Add friend modal screens
│   ├── FriendRequestsScreen.tsx       # Pending requests
│   ├── MessageScreen.tsx              # Direct messaging
│   ├── QRCodeScannerScreen.tsx        # Scan QR codes
│   └── AddFriendFromLinkScreen.tsx    # Deep link handler
│
├── /components
│   ├── /connections
│   │   ├── FriendsList.tsx            # Friends list component
│   │   ├── FriendCard.tsx             # Individual friend card
│   │   ├── ConversationsList.tsx      # Conversations list
│   │   ├── ConversationCard.tsx       # Individual conversation
│   │   ├── TabNavigation.tsx          # Friends/Messages tabs
│   │   └── QRCodeDisplay.tsx          # Show personal QR code
│   │
│   ├── /messages
│   │   ├── MessageBubble.tsx          # Individual message
│   │   ├── MessageInput.tsx           # Message input field
│   │   ├── MentionPicker.tsx          # @mention autocomplete
│   │   └── ImagePreview.tsx           # Image message preview
│   │
│   └── /modals
│       ├── AddFriendModal.tsx         # Add friend search
│       ├── FriendRequestModal.tsx     # Accept/decline requests
│       ├── AddToBoardModal.tsx        # Add friend to board
│       └── ReportUserModal.tsx        # Report user
│
├── /redux
│   ├── /slices
│   │   ├── friendsSlice.ts            # Friends state
│   │   ├── friendRequestsSlice.ts     # Friend requests state
│   │   ├── conversationsSlice.ts      # Conversations state
│   │   └── messagesSlice.ts           # Messages state
│   │
│   └── store.ts                       # Redux store
│
├── /services
│   ├── friendsService.ts              # Friends API calls
│   ├── messagesService.ts             # Messages API calls
│   ├── notificationService.ts         # Push notifications
│   └── realtimeService.ts             # WebSocket connection
│
├── /hooks
│   ├── useFriends.ts                  # Friends hook
│   ├── useMessages.ts                 # Messages hook
│   ├── useFriendRequests.ts           # Friend requests hook
│   └── useConversation.ts             # Conversation hook
│
├── /utils
│   ├── qrCode.ts                      # QR code generation
│   ├── deepLinking.ts                 # Deep link handling
│   └── fileUpload.ts                  # File upload utilities
│
└── /types
    ├── friend.ts                      # Friend types
    ├── message.ts                     # Message types
    └── conversation.ts                # Conversation types
```

### Redux Setup

**Store Configuration:**
```typescript
// store.ts
import { configureStore } from '@reduxjs/toolkit';
import friendsReducer from './slices/friendsSlice';
import friendRequestsReducer from './slices/friendRequestsSlice';
import conversationsReducer from './slices/conversationsSlice';
import messagesReducer from './slices/messagesSlice';

export const store = configureStore({
  reducer: {
    friends: friendsReducer,
    friendRequests: friendRequestsReducer,
    conversations: conversationsReducer,
    messages: messagesReducer
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['messages/addMessage'],
        ignoredPaths: ['messages.byConversation']
      }
    })
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
```

**Friends Slice:**
```typescript
// slices/friendsSlice.ts
import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { Friend } from '../types';
import { friendsService } from '../services/friendsService';

interface FriendsState {
  friends: Friend[];
  isLoading: boolean;
  error: string | null;
  mutedFriends: { [userId: string]: string }; // userId: mutedUntil
  blockedUsers: string[];
}

const initialState: FriendsState = {
  friends: [],
  isLoading: false,
  error: null,
  mutedFriends: {},
  blockedUsers: []
};

// Async thunks
export const loadFriends = createAsyncThunk(
  'friends/load',
  async () => {
    const response = await friendsService.getFriends();
    return response;
  }
);

export const removeFriend = createAsyncThunk(
  'friends/remove',
  async (friendId: string) => {
    await friendsService.removeFriend(friendId);
    return friendId;
  }
);

export const muteFriend = createAsyncThunk(
  'friends/mute',
  async ({ userId, mutedUntil }: { userId: string; mutedUntil: string | null }) => {
    await friendsService.muteFriend(userId, mutedUntil);
    return { userId, mutedUntil };
  }
);

export const blockUser = createAsyncThunk(
  'friends/block',
  async (userId: string) => {
    await friendsService.blockUser(userId);
    return userId;
  }
);

// Slice
const friendsSlice = createSlice({
  name: 'friends',
  initialState,
  reducers: {
    addFriend: (state, action: PayloadAction<Friend>) => {
      state.friends.push(action.payload);
    },
    updateFriendStatus: (state, action: PayloadAction<{ userId: string; status: 'online' | 'offline' | 'away' }>) => {
      const friend = state.friends.find(f => f.id === action.payload.userId);
      if (friend) {
        friend.status = action.payload.status;
        friend.isOnline = action.payload.status === 'online';
      }
    },
    unmuteFriend: (state, action: PayloadAction<string>) => {
      delete state.mutedFriends[action.payload];
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadFriends.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(loadFriends.fulfilled, (state, action) => {
        state.isLoading = false;
        state.friends = action.payload;
      })
      .addCase(loadFriends.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to load friends';
      })
      .addCase(removeFriend.fulfilled, (state, action) => {
        state.friends = state.friends.filter(f => f.id !== action.payload);
      })
      .addCase(muteFriend.fulfilled, (state, action) => {
        if (action.payload.mutedUntil) {
          state.mutedFriends[action.payload.userId] = action.payload.mutedUntil;
        }
      })
      .addCase(blockUser.fulfilled, (state, action) => {
        state.blockedUsers.push(action.payload);
        state.friends = state.friends.filter(f => f.id !== action.payload);
      });
  }
});

export const { addFriend, updateFriendStatus, unmuteFriend } = friendsSlice.actions;
export default friendsSlice.reducer;
```

**Friend Requests Slice:**
```typescript
// slices/friendRequestsSlice.ts
import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { FriendRequest } from '../types';
import { friendsService } from '../services/friendsService';

interface FriendRequestsState {
  sent: FriendRequest[];
  received: FriendRequest[];
  isLoading: boolean;
  error: string | null;
}

const initialState: FriendRequestsState = {
  sent: [],
  received: [],
  isLoading: false,
  error: null
};

export const loadFriendRequests = createAsyncThunk(
  'friendRequests/load',
  async () => {
    const [sent, received] = await Promise.all([
      friendsService.getSentRequests(),
      friendsService.getReceivedRequests()
    ]);
    return { sent, received };
  }
);

export const sendFriendRequest = createAsyncThunk(
  'friendRequests/send',
  async ({ userId, message }: { userId: string; message?: string }) => {
    const request = await friendsService.sendFriendRequest(userId, message);
    return request;
  }
);

export const acceptFriendRequest = createAsyncThunk(
  'friendRequests/accept',
  async (requestId: string) => {
    const friend = await friendsService.acceptFriendRequest(requestId);
    return { requestId, friend };
  }
);

export const declineFriendRequest = createAsyncThunk(
  'friendRequests/decline',
  async (requestId: string) => {
    await friendsService.declineFriendRequest(requestId);
    return requestId;
  }
);

export const cancelFriendRequest = createAsyncThunk(
  'friendRequests/cancel',
  async (requestId: string) => {
    await friendsService.cancelFriendRequest(requestId);
    return requestId;
  }
);

const friendRequestsSlice = createSlice({
  name: 'friendRequests',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(loadFriendRequests.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(loadFriendRequests.fulfilled, (state, action) => {
        state.isLoading = false;
        state.sent = action.payload.sent;
        state.received = action.payload.received;
      })
      .addCase(loadFriendRequests.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to load requests';
      })
      .addCase(sendFriendRequest.fulfilled, (state, action) => {
        state.sent.push(action.payload);
      })
      .addCase(acceptFriendRequest.fulfilled, (state, action) => {
        state.received = state.received.filter(r => r.id !== action.payload.requestId);
      })
      .addCase(declineFriendRequest.fulfilled, (state, action) => {
        state.received = state.received.filter(r => r.id !== action.payload);
      })
      .addCase(cancelFriendRequest.fulfilled, (state, action) => {
        state.sent = state.sent.filter(r => r.id !== action.payload);
      });
  }
});

export default friendRequestsSlice.reducer;
```

### Main Connections Screen

```typescript
// screens/ConnectionsScreen.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigation } from '@react-navigation/native';
import { loadFriends } from '../redux/slices/friendsSlice';
import { loadFriendRequests } from '../redux/slices/friendRequestsSlice';
import { FriendCard } from '../components/connections/FriendCard';
import { ConversationCard } from '../components/connections/ConversationCard';
import { TabNavigation } from '../components/connections/TabNavigation';

export const ConnectionsScreen = () => {
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const [activeTab, setActiveTab] = useState<'friends' | 'messages'>('friends');
  const [searchQuery, setSearchQuery] = useState('');
  const [showQRCode, setShowQRCode] = useState(false);
  
  const { friends, isLoading } = useSelector((state: RootState) => state.friends);
  const { received: receivedRequests } = useSelector((state: RootState) => state.friendRequests);
  const conversations = useSelector((state: RootState) => state.conversations.list);
  
  useEffect(() => {
    dispatch(loadFriends());
    dispatch(loadFriendRequests());
  }, [dispatch]);
  
  const filteredFriends = friends.filter(friend =>
    friend.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    friend.username.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  const filteredConversations = conversations.filter(conv =>
    conv.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  const handleMessageFriend = (friend: Friend) => {
    navigation.navigate('Message', { friendId: friend.id });
  };
  
  const handleAddToBoard = (friend: Friend) => {
    navigation.navigate('AddToBoard', { friendId: friend.id });
  };
  
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Connections</Text>
      </View>
      
      {/* Tab Navigation */}
      <TabNavigation
        activeTab={activeTab}
        onTabChange={setActiveTab}
        unreadCount={conversations.reduce((sum, c) => sum + c.unreadCount, 0)}
      />
      
      {/* Search Bar */}
      <TextInput
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder={activeTab === 'friends' ? 'Search friends...' : 'Search conversations...'}
        style={styles.searchInput}
      />
      
      {/* Content */}
      {activeTab === 'friends' ? (
        <View style={styles.tabContent}>
          {/* Quick Actions */}
          <View style={styles.quickActions}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => navigation.navigate('AddFriend')}
            >
              <UserPlus />
              <Text>Add Friend</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.actionButton, receivedRequests.length > 0 && styles.actionButtonHighlight]}
              onPress={() => navigation.navigate('FriendRequests')}
            >
              <UserCheck />
              <Text>Requests</Text>
              {receivedRequests.length > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{receivedRequests.length}</Text>
                </View>
              )}
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => setShowQRCode(!showQRCode)}
            >
              <QrCode />
              <Text>QR Code</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleCopyInviteLink}
            >
              <Link />
              <Text>Invite</Text>
            </TouchableOpacity>
          </View>
          
          {/* QR Code Display */}
          {showQRCode && <QRCodeDisplay />}
          
          {/* Friends List */}
          <FlatList
            data={filteredFriends}
            renderItem={({ item: friend }) => (
              <FriendCard
                friend={friend}
                onMessage={handleMessageFriend}
                onAddToBoard={handleAddToBoard}
              />
            )}
            keyExtractor={friend => friend.id}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Users size={48} color="gray" />
                <Text style={styles.emptyText}>No friends yet</Text>
                <Text style={styles.emptySubtext}>Add friends to get started</Text>
              </View>
            }
          />
        </View>
      ) : (
        <View style={styles.tabContent}>
          {/* Start New Conversation */}
          <TouchableOpacity
            style={styles.startNewButton}
            onPress={() => navigation.navigate('SelectFriend')}
          >
            <MessageCircle />
            <Text>Start New Conversation</Text>
          </TouchableOpacity>
          
          {/* Conversations List */}
          <FlatList
            data={filteredConversations}
            renderItem={({ item: conversation }) => (
              <ConversationCard
                conversation={conversation}
                onPress={() => navigation.navigate('Message', { conversationId: conversation.id })}
              />
            )}
            keyExtractor={conv => conv.id}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <MessageCircle size={48} color="gray" />
                <Text style={styles.emptyText}>No conversations yet</Text>
                <Text style={styles.emptySubtext}>Message a friend to start</Text>
              </View>
            }
          />
        </View>
      )}
    </View>
  );
};
```

---

## Backend API Structure

### API Endpoints

```
BASE_URL: https://api.mingla.com/v1

┌────────────────────────────────────────────────────────┐
│                   FRIENDS API                          │
└────────────────────────────────────────────────────────┘

GET    /friends                          # List user's friends
GET    /friends/:id                      # Get friend details
DELETE /friends/:id                      # Remove friend
PATCH  /friends/:id/mute                 # Mute friend notifications
DELETE /friends/:id/mute                 # Unmute friend
GET    /friends/:friendId/mutual         # Get mutual friends

POST   /friends/search                   # Search users
  Body: { query: string, type: 'username' | 'email' }

GET    /users/:userId/relationship       # Check relationship status
GET    /users/:userId/mutual-friends/:friendId  # Mutual friends count

┌────────────────────────────────────────────────────────┐
│                FRIEND REQUESTS API                      │
└────────────────────────────────────────────────────────┘

GET    /friend-requests/sent             # Get sent requests
GET    /friend-requests/received         # Get received requests
POST   /friend-requests                  # Send friend request
  Body: { toUserId: string, message?: string }

PATCH  /friend-requests/:id/accept       # Accept request
PATCH  /friend-requests/:id/decline      # Decline request
PATCH  /friend-requests/:id              # Cancel/update request
  Body: { status: 'canceled' }

┌────────────────────────────────────────────────────────┐
│                  CONVERSATIONS API                      │
└────────────────────────────────────────────────────────┘

GET    /conversations                    # List user's conversations
GET    /conversations/:id                # Get conversation details
POST   /conversations                    # Create conversation
GET    /conversations/with/:userId       # Get/create conversation with user
PATCH  /conversations/:id/read           # Mark as read
PATCH  /conversations/:id/pin            # Pin/unpin conversation
DELETE /conversations/:id                # Archive conversation

┌────────────────────────────────────────────────────────┐
│                    MESSAGES API                         │
└────────────────────────────────────────────────────────┘

GET    /conversations/:id/messages       # Get messages (with pagination)
  Query: { limit: 50, offset: 0, before?: timestamp }

POST   /conversations/:id/messages       # Send message
  Body: {
    content: string,
    type: 'text' | 'image' | 'video' | 'file',
    fileUrl?: string,
    replyTo?: string
  }

PATCH  /conversations/:id/messages/:msgId  # Edit message
DELETE /conversations/:id/messages/:msgId  # Delete message
POST   /conversations/:id/messages/:msgId/reaction  # Add reaction

┌────────────────────────────────────────────────────────┐
│                     INVITE API                          │
└────────────────────────────────────────────────────────┘

POST   /invite-links                     # Generate invite link
  Body: { userId: string }

GET    /invite-links/:token              # Validate invite token

┌────────────────────────────────────────────────────────┐
│                   MODERATION API                        │
└────────────────────────────────────────────────────────┘

POST   /users/blocked                    # Block user
DELETE /users/blocked/:userId            # Unblock user
GET    /users/blocked                    # List blocked users

POST   /moderation/reports               # Report user
  Body: {
    reportedUserId: string,
    reason: string,
    details: string
  }
```

---

## Real-Time Features

### WebSocket Events

```typescript
// Connection Events
socket.on('connect', () => {
  console.log('Connected to server');
  socket.emit('user:online', { userId: currentUser.id });
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
});

// Presence Events
socket.on('user:status', ({ userId, status }: { userId: string; status: 'online' | 'offline' | 'away' }) => {
  dispatch(updateFriendStatus({ userId, status }));
});

// Friend Request Events
socket.on('friend:request_received', (request: FriendRequest) => {
  dispatch(addReceivedRequest(request));
  
  // Show local notification
  LocalNotification.show({
    title: 'New Friend Request',
    body: `${request.fromUser.name} wants to be your friend`,
    data: { requestId: request.id }
  });
});

socket.on('friend:request_accepted', ({ requestId, friend }: { requestId: string; friend: Friend }) => {
  dispatch(removeSentRequest(requestId));
  dispatch(addFriend(friend));
  
  // Show notification
  Toast.show({
    type: 'success',
    text1: 'Friend Request Accepted!',
    text2: `You and ${friend.name} are now friends`
  });
});

socket.on('friend:request_declined', ({ requestId }: { requestId: string }) => {
  dispatch(removeSentRequest(requestId));
});

// Message Events
socket.on('message:new', (message: Message) => {
  dispatch(addMessage(message));
  
  // Update conversation
  dispatch(updateConversationLastMessage({
    conversationId: message.conversationId,
    message
  }));
  
  // Show notification if not in chat
  const currentScreen = navigation.getCurrentRoute()?.name;
  if (currentScreen !== 'Message') {
    LocalNotification.show({
      title: message.senderName,
      body: message.type === 'text' ? message.content : 'Sent an image',
      data: {
        conversationId: message.conversationId,
        messageId: message.id
      }
    });
  }
});

socket.on('message:read', ({ conversationId, userId }: { conversationId: string; userId: string }) => {
  dispatch(markMessagesAsReadByUser({ conversationId, userId }));
});

socket.on('user:typing', ({ conversationId, userId }: { conversationId: string; userId: string }) => {
  dispatch(setUserTyping({ conversationId, userId, isTyping: true }));
  
  // Clear after 3 seconds
  setTimeout(() => {
    dispatch(setUserTyping({ conversationId, userId, isTyping: false }));
  }, 3000);
});
```

---

## Security & Privacy

### Friend Privacy Settings

```typescript
interface PrivacySettings {
  // Who can send friend requests
  friendRequestsFrom: 'everyone' | 'friends-of-friends' | 'none';
  
  // Who can see online status
  onlineStatusVisibleTo: 'everyone' | 'friends' | 'none';
  
  // Who can see mutual friends
  mutualFriendsVisibleTo: 'everyone' | 'friends' | 'none';
  
  // Profile visibility
  profileVisibleTo: 'everyone' | 'friends' | 'none';
  
  // Who can add to boards
  canAddToBoardsFrom: 'everyone' | 'friends' | 'admins-only';
  
  // Notifications
  notifyOnRequestDecline: boolean;
  notifyOnFriendOnline: boolean;
  notifyOnMessage: boolean;
  notifyOnBoardInvite: boolean;
}
```

### Data Encryption

```typescript
// Encrypt sensitive data before sending
import CryptoJS from 'crypto-js';

const encryptMessage = (content: string, secretKey: string): string => {
  return CryptoJS.AES.encrypt(content, secretKey).toString();
};

const decryptMessage = (encryptedContent: string, secretKey: string): string => {
  const bytes = CryptoJS.AES.decrypt(encryptedContent, secretKey);
  return bytes.toString(CryptoJS.enc.Utf8);
};

// Use for end-to-end encrypted messages
const sendEncryptedMessage = async (conversationId: string, content: string) => {
  const conversation = conversations[conversationId];
  const recipientPublicKey = conversation.participants[0].publicKey;
  
  // Encrypt with recipient's public key
  const encryptedContent = encryptMessage(content, recipientPublicKey);
  
  const message: Message = {
    id: generateId(),
    conversationId,
    senderId: currentUser.id,
    senderName: currentUser.name,
    content: encryptedContent,
    timestamp: new Date().toISOString(),
    type: 'text',
    isMe: true,
    unread: true,
    isEncrypted: true
  };
  
  await api.post(`/conversations/${conversationId}/messages`, message);
  socket.emit('message:send', message);
};
```

---

## Summary

The Mingla Connections & Friends system provides a **complete social networking foundation** for the platform. Here's what React Native developers need to implement:

### Core Features:
1. **Friends List Management** - View, search, sort friends
2. **Friend Requests** - Send, receive, accept, decline
3. **Multiple Add Methods** - Username, email, QR code, invite link
4. **Direct Messaging** - Text, images, files
5. **Collaboration Integration** - Invite friends to boards
6. **Real-Time Presence** - Online/offline status
7. **Privacy Controls** - Mute, block, report

### Technical Stack:
- **State Management**: Redux Toolkit
- **Navigation**: React Navigation with deep linking
- **Real-Time**: Socket.io for presence and messaging
- **QR Codes**: react-native-qrcode-svg + expo-barcode-scanner
- **Media**: expo-image-picker for images
- **Push Notifications**: Expo Notifications
- **Storage**: AsyncStorage for offline data

### Integration Points:
- **With Collaboration**: Friends → Board invites → Sessions
- **With Board Cards**: @mentions, voting visibility, RSVP tracking
- **With Messages**: Direct chat → Board discussions

This creates a seamless social experience where friends can discover, plan, and collaborate on experiences together!