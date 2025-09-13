import React, { useState } from 'react';
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

  // Mock data
  const [friends] = useState<Friend[]>([
    {
      id: '1',
      username: 'emmawilson',
      name: 'Emma Wilson',
      avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80',
      status: 'online'
    },
    {
      id: '2', 
      username: 'jamesrodriguez',
      name: 'James Rodriguez',
      avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e',
      status: 'away'
    },
    {
      id: '3',
      username: 'priyapatel',
      name: 'Priya Patel',
      avatar: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04',
      status: 'offline'
    }
  ]);

  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([
    {
      id: '1',
      from: {
        id: '4',
        username: 'alexchen',
        name: 'Alex Chen',
        avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d',
        status: 'online'
      },
      timestamp: '2 hours ago',
      status: 'pending'
    }
  ]);

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

  const sendFriendRequest = () => {
    if (!newFriendUsername.trim()) return;
    
    // Mock sending friend request
    console.log(`Sending friend request to: ${newFriendUsername}`);
    setNewFriendUsername('');
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
            {filteredFriends.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                {searchQuery ? 'No friends found' : 'No friends yet'}
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