import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { 
  UserPlus, 
  MessageCircle, 
  Users, 
  Search, 
  Check, 
  X,
  MoreVertical
} from 'lucide-react';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { useFriends } from '@/hooks/useFriends';
import { useMessages } from '@/hooks/useMessages';
import { useSessionManagement } from '@/hooks/useSessionManagement';
import { toast } from '@/hooks/use-toast';
import { UserSearch } from '@/components/UserSearch';
import { useUsers, type PublicUser } from '@/hooks/useUsers';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { CreateSessionDialog } from '@/components/CreateSessionDialog';

export const Friends = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();
  const { user } = useAppStore();

  const {
    friends,
    friendRequests,
    loading,
    loadFriends,
    loadFriendRequests,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    removeFriend,
    cancelFriendRequest,
  } = useFriends();

  const { createConversation } = useMessages();
  const { createCollaborativeSession } = useSessionManagement();
  const { getDisplayName: getUserDisplayName, getUserInitials: getUserUserInitials } = useUsers();

  // Load friends and requests on component mount
  useEffect(() => {
    loadFriends();
    loadFriendRequests();
  }, [loadFriends, loadFriendRequests]);

  const filteredFriends = friends.filter(friend =>
    `${friend.first_name} ${friend.last_name}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
    friend.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getDisplayName = (friend: { username: string; first_name?: string; last_name?: string }) => {
    if (friend.first_name && friend.last_name) {
      return `${friend.first_name} ${friend.last_name}`;
    } else if (friend.first_name) {
      return friend.first_name;
    } else if (friend.last_name) {
      return friend.last_name;
    }
    return friend.username;
  };

  const getUserInitials = (friend: { username: string; first_name?: string; last_name?: string }) => {
    const displayName = getDisplayName(friend);
    return displayName
      .split(' ')
      .map(name => name[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleSelectUser = async (user: PublicUser) => {
    const success = await sendFriendRequest(user.username);
    if (success) {
      toast({
        title: "Friend request sent",
        description: `Friend request sent to ${getUserDisplayName(user)}`,
      });
    }
  };

  const handleMessageFriend = async (friendUserId: string) => {
    try {
      const conversationId = await createConversation(friendUserId);
      if (conversationId) {
        // Navigate to inbox tab with conversation selected
        navigate('/connections?tab=inbox');
        // Small delay to ensure navigation completes before showing toast
        setTimeout(() => {
          toast({
            title: "Conversation started",
            description: "Opening your conversation in the Inbox tab",
          });
        }, 100);
      } else {
        toast({
          title: "Error",
          description: "Failed to create conversation. Please try again.",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Error creating conversation:', error);
      toast({
        title: "Error",
        description: "Failed to start conversation. Please try again.",
        variant: "destructive"
      });
    }
  };

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedFriendForCollab, setSelectedFriendForCollab] = useState<string | null>(null);

  const handleCreateCollaboration = async (participants: string[], sessionName: string) => {
    await createCollaborativeSession(participants, sessionName);
    setShowCreateDialog(false);
    setSelectedFriendForCollab(null);
  };

  const openCollaborationDialog = async (friendUserId: string) => {
    try {
      // Get friend's profile first
      const { data: friendProfile } = await supabase
        .from('profiles')
        .select('username, first_name, last_name')
        .eq('id', friendUserId)
        .single();

      const friendName = friendProfile 
        ? (friendProfile.first_name && friendProfile.last_name 
           ? `${friendProfile.first_name} ${friendProfile.last_name}`
           : friendProfile.username)
        : 'Friend';

      const friendUsername = friendProfile?.username || 'unknown';

      setSelectedFriendForCollab(friendUsername);
      setShowCreateDialog(true);
    } catch (error) {
      console.error('Error loading friend profile:', error);
      toast({
        title: "Error",
        description: "Failed to load friend information. Please try again.",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Friend Requests */}
      {friendRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Friend Requests ({friendRequests.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {friendRequests.map(request => (
              <div key={request.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <Avatar>
                    {request.sender.avatar_url && (
                      <AvatarImage src={request.sender.avatar_url} alt={getDisplayName(request.sender)} />
                    )}
                    <AvatarFallback>
                      {getUserInitials(request.sender)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">{getDisplayName(request.sender)}</p>
                    <p className="text-sm text-muted-foreground">@{request.sender.username}</p>
                    <p className="text-xs text-muted-foreground">
                      {request.type === 'incoming' ? 'Wants to be friends' : 'Request sent'} • {new Date(request.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {request.type === 'incoming' ? (
                    <>
                      <Button 
                        size="sm" 
                        onClick={() => acceptFriendRequest(request.id)}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => declineFriendRequest(request.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => cancelFriendRequest(request.id)}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Add Friend */}
      <Card>
        <CardHeader>
          <CardTitle>Add Friend</CardTitle>
        </CardHeader>
        <CardContent>
          <UserSearch onSelectUser={handleSelectUser} />
        </CardContent>
      </Card>

      {/* Friends List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Friends ({friends.length})</span>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search friends..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 w-64"
              />
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                <p className="text-muted-foreground mt-4">Loading friends...</p>
              </div>
            ) : filteredFriends.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                {searchQuery ? 'No friends found' : 'No friends yet. Add some friends!'}
              </p>
            ) : (
              filteredFriends.map(friend => (
                <div key={friend.id} className="flex items-center justify-between p-3 hover:bg-muted/50 rounded-lg transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Avatar>
                        {friend.avatar_url && (
                          <AvatarImage src={friend.avatar_url} alt={getDisplayName(friend)} />
                        )}
                        <AvatarFallback>
                          {getUserInitials(friend)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-background bg-green-500" />
                    </div>
                    <div>
                      <p className="font-medium">{getDisplayName(friend)}</p>
                      <p className="text-sm text-muted-foreground">@{friend.username}</p>
                      <Badge variant="outline" className="text-xs">
                        {friend.status}
                      </Badge>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => handleMessageFriend(friend.friend_user_id)}
                    >
                      <MessageCircle className="h-4 w-4" />
                    </Button>
                    
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openCollaborationDialog(friend.friend_user_id)}>
                          <Users className="h-4 w-4 mr-2" />
                          Send Collaboration Invite
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          className="text-destructive"
                          onClick={() => removeFriend(friend.friend_user_id)}
                        >
                          Remove Friend
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Create Collaboration Dialog */}
      <CreateSessionDialog
        isOpen={showCreateDialog}
        onClose={() => {
          setShowCreateDialog(false);
          setSelectedFriendForCollab(null);
        }}
        prefilledParticipants={selectedFriendForCollab ? [selectedFriendForCollab] : []}
        prefilledSessionName={selectedFriendForCollab ? `Collaboration with ${selectedFriendForCollab}` : ''}
      />
    </div>
  );
};