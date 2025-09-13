import React, { useState, useEffect } from 'react';
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
import { useUsers } from '@/hooks/useUsers';
import { toast } from '@/hooks/use-toast';

interface Friend {
  id: string;
  username: string;
  name: string;
  avatar: string;
  status: 'online' | 'offline' | 'away';
  isOnline?: boolean;
}

interface FriendRequest {
  id: string;
  from: Friend;
  timestamp: string;
  status: 'pending' | 'accepted' | 'declined';
}

export const Friends = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [newFriendUsername, setNewFriendUsername] = useState('');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const { getAllUsers, getUserByUsername, getDisplayName, getUserInitials } = useUsers();

  // Load friends on component mount
  useEffect(() => {
    loadFriends();
  }, []);

  const loadFriends = async () => {
    setLoading(true);
    try {
      // Get all users to simulate friends list
      const users = await getAllUsers();
      const formattedFriends: Friend[] = users.slice(0, 8).map((user, index) => ({
        id: user.id,
        username: user.username,
        name: getDisplayName(user),
        avatar: user.avatar_url || `https://images.unsplash.com/photo-${1438761681033 + index * 1000}-6461ffad8d80`,
        status: ['online', 'away', 'offline'][index % 3] as 'online' | 'away' | 'offline'
      }));
      setFriends(formattedFriends);

      // Mock friend requests - in real app this would come from database
      setFriendRequests([]);
    } catch (error) {
      console.error('Error loading friends:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredFriends = friends.filter(friend =>
    friend.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    friend.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-green-500';
      case 'away': return 'bg-yellow-500';
      default: return 'bg-gray-400';
    }
  };

  const sendFriendRequest = async () => {
    if (!newFriendUsername.trim()) return;
    
    try {
      const user = await getUserByUsername(newFriendUsername.trim());
      if (!user) {
        toast({
          title: "User not found",
          description: "No user found with that username",
          variant: "destructive"
        });
        return;
      }

      // Check if already friends
      const isAlreadyFriend = friends.some(f => f.username === user.username);
      if (isAlreadyFriend) {
        toast({
          title: "Already friends",
          description: "You are already friends with this user",
          variant: "destructive"
        });
        return;
      }

      toast({
        title: "Friend request sent!",
        description: `Friend request sent to @${user.username}`,
      });
      
      setNewFriendUsername('');
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to send friend request",
        variant: "destructive"
      });
    }
  };

  const handleFriendRequest = (requestId: string, action: 'accept' | 'decline') => {
    setFriendRequests(prev => 
      prev.map(req => 
        req.id === requestId 
          ? { ...req, status: action === 'accept' ? 'accepted' : 'declined' }
          : req
      )
    );
  };

  const createCollaborationBoard = (friend: Friend) => {
    console.log(`Creating collaboration board with ${friend.name}`);
    // This would navigate to a new collaboration board
  };

  return (
    <div className="space-y-6">
      {/* Friend Requests */}
      {friendRequests.filter(req => req.status === 'pending').length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Friend Requests
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {friendRequests
              .filter(req => req.status === 'pending')
              .map(request => (
                <div key={request.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarImage src={request.from.avatar} />
                      <AvatarFallback>
                        {request.from.name.split(' ').map(n => n[0]).join('')}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{request.from.name}</p>
                      <p className="text-sm text-muted-foreground">@{request.from.username}</p>
                      <p className="text-xs text-muted-foreground">{request.timestamp}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      onClick={() => handleFriendRequest(request.id, 'accept')}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => handleFriendRequest(request.id, 'decline')}
                    >
                      <X className="h-4 w-4" />
                    </Button>
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
          <div className="flex gap-2">
            <Input
              placeholder="Enter username"
              value={newFriendUsername}
              onChange={(e) => setNewFriendUsername(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendFriendRequest()}
            />
            <Button onClick={sendFriendRequest}>
              <UserPlus className="h-4 w-4" />
            </Button>
          </div>
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
                {searchQuery ? 'No friends found' : 'No friends yet. Search for users to add them!'}
              </p>
            ) : (
              filteredFriends.map(friend => (
                <div key={friend.id} className="flex items-center justify-between p-3 hover:bg-muted/50 rounded-lg transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Avatar>
                        <AvatarImage src={friend.avatar} />
                        <AvatarFallback>
                          {friend.name.split(' ').map(n => n[0]).join('')}
                        </AvatarFallback>
                      </Avatar>
                      <div 
                        className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-background ${getStatusColor(friend.status)}`}
                      />
                    </div>
                    <div>
                      <p className="font-medium">{friend.name}</p>
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
                      onClick={() => console.log(`Message ${friend.name}`)}
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
                        <DropdownMenuItem onClick={() => createCollaborationBoard(friend)}>
                          <Users className="h-4 w-4 mr-2" />
                          Create Collaboration Board
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive">
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
    </div>
  );
};