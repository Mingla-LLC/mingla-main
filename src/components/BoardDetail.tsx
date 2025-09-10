import React, { useState } from 'react';
import { ArrowLeft, MessageCircle, ThumbsUp, Send, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { TripCard } from '@/components/TripCard';
import { TripCardExpanded } from '@/components/TripCardExpanded';

interface BoardDetailProps {
  board: {
    id: string;
    title: string;
    description: string;
    collaborators: Array<{
      id: string;
      name: string;
      avatar: string;
      initials: string;
    }>;
  };
  onBack: () => void;
}

const mockTrips = [
  {
    id: '1',
    title: 'Sunset Coffee at Waterfront',
    image: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085',
    cost: 25,
    duration: '1.5 hours',
    travelTime: '8 min walk',
    badges: ['Budget-Fit', 'Weather-OK', 'Verified'],
    whyItFits: 'Perfect timing for golden hour, cozy café with outdoor seating, within your budget',
    location: 'Pike Place Market',
    category: 'Coffee & Walk',
    votes: { for: 2, against: 0 },
    userVote: null, // null, 'for', 'against'
    finalized: false,
    finalizedBy: [], // user IDs who have clicked finalize
    revokeRequests: [], // user IDs who requested to revoke
    revokeRequestedBy: null
  },
  {
    id: '2',
    title: 'Interactive Art Experience',
    image: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96',
    cost: 45,
    duration: '2 hours',
    travelTime: '12 min drive',
    badges: ['Creative', 'Weather-OK'],
    whyItFits: 'Hands-on pottery class perfect for creative dates, includes materials and refreshments',
    location: 'Capitol Hill',
    category: 'Creative Date',
    votes: { for: 1, against: 1 },
    userVote: 'for',
    finalized: true,
    finalizedBy: ['user1', 'user2', 'user3'], // All collaborators have finalized
    revokeRequests: [],
    revokeRequestedBy: null
  }
];

const discussions = [
  {
    id: '1',
    user: { name: 'Sarah', avatar: 'https://images.unsplash.com/photo-1494790108755-2616b79444d7', initials: 'S' },
    message: 'Love the coffee spot! Perfect for our group size.',
    timestamp: '2 hours ago',
    votes: 5,
    hasVoted: false
  },
  {
    id: '2',
    user: { name: 'Mike', avatar: '', initials: 'M' },
    message: 'The art experience looks amazing but might be over budget for some?',
    timestamp: '1 hour ago',
    votes: 2,
    hasVoted: true
  },
  {
    id: '3',
    user: { name: 'You', avatar: '', initials: 'Y' },
    message: 'What about Saturday around 3 PM for the coffee date?',
    timestamp: '30 min ago',
    votes: 3,
    hasVoted: false
  }
];

export const BoardDetail = ({ board, onBack }: BoardDetailProps) => {
  const [selectedTrip, setSelectedTrip] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [discussionList, setDiscussionList] = useState(discussions);
  const [trips, setTrips] = useState(mockTrips);
  const [userFinalized, setUserFinalized] = useState<string[]>([]);
  
  // Add dummy users for tagging demo
  const allCollaborators = [
    ...board.collaborators,
    { id: 'dummy1', name: 'Emma Wilson', avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80', initials: 'EW' },
    { id: 'dummy2', name: 'James Rodriguez', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e', initials: 'JR' },
    { id: 'dummy3', name: 'Priya Patel', avatar: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04', initials: 'PP' }
  ];

  const selectedTripData = trips.find(trip => trip.id === selectedTrip);

  const handleSendMessage = () => {
    if (newMessage.trim()) {
      const newDiscussion = {
        id: Date.now().toString(),
        user: { name: 'You', avatar: '', initials: 'Y' },
        message: newMessage,
        timestamp: 'Just now',
        votes: 0,
        hasVoted: false
      };
      setDiscussionList(prev => [...prev, newDiscussion]);
      setNewMessage('');
    }
  };

  const handleVote = (discussionId: string) => {
    setDiscussionList(prev => prev.map(discussion => 
      discussion.id === discussionId 
        ? { 
            ...discussion, 
            votes: discussion.hasVoted ? discussion.votes - 1 : discussion.votes + 1,
            hasVoted: !discussion.hasVoted 
          }
        : discussion
    ));
  };

  const handleTripVote = (tripId: string, voteType: 'for' | 'against') => {
    setTrips(prev => prev.map(trip => {
      if (trip.id === tripId && !trip.finalized) {
        const currentVote = trip.userVote;
        let newVotes = { ...trip.votes };
        
        // Remove previous vote
        if (currentVote === 'for') newVotes.for--;
        if (currentVote === 'against') newVotes.against--;
        
        // Add new vote if different from current
        const newUserVote = currentVote === voteType ? null : voteType;
        if (newUserVote === 'for') newVotes.for++;
        if (newUserVote === 'against') newVotes.against++;
        
        return {
          ...trip,
          votes: newVotes,
          userVote: newUserVote
        };
      }
      return trip;
    }));
  };

  const handleFinalize = (tripId: string) => {
    const trip = trips.find(t => t.id === tripId);
    if (!trip) return;

    const currentUserId = 'currentUser'; // In real app, get from auth
    const totalCollaborators = board.collaborators.length + 1; // +1 for board creator

    setTrips(prev => prev.map(t => {
      if (t.id === tripId) {
        const newFinalizedBy = t.finalizedBy.includes(currentUserId) 
          ? t.finalizedBy 
          : [...t.finalizedBy, currentUserId];
        
        // Check if all collaborators have finalized
        const allFinalized = newFinalizedBy.length >= totalCollaborators;
        
        return {
          ...t,
          finalizedBy: newFinalizedBy,
          finalized: allFinalized
        };
      }
      return t;
    }));
  };

  const handleRevokeRequest = (tripId: string) => {
    const currentUserId = 'currentUser';
    const totalCollaborators = board.collaborators.length + 1;

    setTrips(prev => prev.map(t => {
      if (t.id === tripId && t.finalized) {
        const hasRequested = t.revokeRequests.includes(currentUserId);
        const newRevokeRequests = hasRequested 
          ? t.revokeRequests.filter(id => id !== currentUserId)
          : [...t.revokeRequests, currentUserId];
        
        // If all collaborators agree to revoke, reset to voting
        const allAgreeToRevoke = newRevokeRequests.length >= totalCollaborators;
        
        if (allAgreeToRevoke) {
          return {
            ...t,
            finalized: false,
            finalizedBy: [],
            revokeRequests: [],
            revokeRequestedBy: null
          };
        }
        
        return {
          ...t,
          revokeRequests: newRevokeRequests,
          revokeRequestedBy: newRevokeRequests.length > 0 ? newRevokeRequests[0] : null
        };
      }
      return t;
    }));
  };

  const canChangeVote = (tripId: string) => {
    const trip = trips.find(t => t.id === tripId);
    return trip && !trip.finalized;
  };

  const getUserFinalizedStatus = (tripId: string) => {
    const trip = trips.find(t => t.id === tripId);
    return trip?.finalizedBy.includes('currentUser') || false;
  };

  const getUserRevokeStatus = (tripId: string) => {
    const trip = trips.find(t => t.id === tripId);
    return trip?.revokeRequests.includes('currentUser') || false;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="px-6 pt-12 pb-6 border-b border-border">
        <div className="flex items-center gap-4 mb-4">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold">{board.title}</h1>
            <p className="text-sm text-muted-foreground">{board.description}</p>
          </div>
        </div>

        {/* Collaborators */}
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
            {board.collaborators.map((collaborator) => (
              <Avatar key={collaborator.id} className="w-8 h-8 border-2 border-background">
                <AvatarImage src={collaborator.avatar} />
                <AvatarFallback className="text-xs">
                  {collaborator.initials}
                </AvatarFallback>
              </Avatar>
            ))}
          </div>
          <span className="text-sm text-muted-foreground">
            {board.collaborators.length} collaborators
          </span>
        </div>
      </div>

      {/* Trip Cards with Polling */}
      <div className="px-6 py-6">
        <h2 className="text-lg font-semibold mb-4">Trip Options - Vote to Finalize</h2>
        <div className="space-y-4">
          {trips.map((trip) => (
            <div key={trip.id} className="relative">
              <Card className="p-0 overflow-hidden">
                <TripCard
                  trip={trip}
                  onSwipeRight={() => {}}
                  onSwipeLeft={() => {}}
                  onExpand={() => setSelectedTrip(trip.id)}
                  className="cursor-pointer hover:shadow-elevated transition-all border-0"
                />
                
                {/* Voting Section */}
                <div className="p-4 border-t border-border bg-muted/30">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-4">
                      <Badge 
                        variant={trip.votes.for > trip.votes.against ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {trip.votes.for} 👍 {trip.votes.against} 👎
                      </Badge>
                      {trip.finalized && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-primary/20 to-primary/10 rounded-full border border-primary/20">
                          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                          <span className="text-xs font-medium text-primary">Confirmed & Calendared</span>
                        </div>
                      )}
                      {trip.revokeRequestedBy && (
                        <Badge variant="outline" className="text-xs bg-orange-100 text-orange-700">
                          🔄 Revoke Requested ({trip.revokeRequests.length}/{board.collaborators.length + 1})
                        </Badge>
                      )}
                      {!trip.finalized && trip.finalizedBy.length > 0 && (
                        <Badge variant="outline" className="text-xs">
                          Finalizing... ({trip.finalizedBy.length}/{board.collaborators.length + 1})
                        </Badge>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {!trip.finalized && (
                        <>
                          <Button
                            variant={trip.userVote === 'for' ? "default" : "outline"}
                            size="sm"
                            onClick={() => handleTripVote(trip.id, 'for')}
                            disabled={!canChangeVote(trip.id)}
                            className="h-7 px-2"
                          >
                            👍
                          </Button>
                          <Button
                            variant={trip.userVote === 'against' ? "default" : "outline"}
                            size="sm"
                            onClick={() => handleTripVote(trip.id, 'against')}
                            disabled={!canChangeVote(trip.id)}
                            className="h-7 px-2"
                          >
                            👎
                          </Button>
                          <Button
                            variant={getUserFinalizedStatus(trip.id) ? "default" : "outline"}
                            size="sm"
                            onClick={() => handleFinalize(trip.id)}
                            className="h-7 text-xs"
                          >
                            {getUserFinalizedStatus(trip.id) ? '✅ Finalized' : 'Finalize'}
                          </Button>
                        </>
                      )}
                      
                      {trip.finalized && (
                        <Button
                          variant={getUserRevokeStatus(trip.id) ? "default" : "outline"}
                          size="sm"
                          onClick={() => handleRevokeRequest(trip.id)}
                          className="h-7 text-xs"
                        >
                          {getUserRevokeStatus(trip.id) ? '🔄 Revoke Requested' : '🔄 Request Revoke'}
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  {trip.finalized && !trip.revokeRequestedBy && (
                    <p className="text-xs text-muted-foreground">
                      This experience has been added to everyone's calendar
                    </p>
                  )}
                  
                  {trip.revokeRequestedBy && (
                    <p className="text-xs text-orange-600">
                      Revoke requested - {trip.revokeRequests.length} of {board.collaborators.length + 1} collaborators agree
                    </p>
                  )}
                </div>
              </Card>
            </div>
          ))}
        </div>
      </div>

      {/* Discussion Thread */}
      <div className="px-6 pb-6">
        <h2 className="text-lg font-semibold mb-4">Discussion</h2>
        
        <div className="space-y-4 mb-6">
          {discussionList.map((discussion) => (
            <Card key={discussion.id} className="p-4">
              <div className="flex items-start gap-3">
                <Avatar className="w-8 h-8">
                  <AvatarImage src={discussion.user.avatar} />
                  <AvatarFallback className="text-xs">
                    {discussion.user.initials}
                  </AvatarFallback>
                </Avatar>
                
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">{discussion.user.name}</span>
                    <span className="text-xs text-muted-foreground">{discussion.timestamp}</span>
                  </div>
                  <p className="text-sm text-foreground mb-3">{discussion.message}</p>
                  
                  <div className="flex items-center justify-between">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleVote(discussion.id)}
                      className={`h-7 gap-1 ${discussion.hasVoted ? 'text-primary' : 'text-muted-foreground'}`}
                    >
                      <ThumbsUp className="h-3 w-3" />
                      <span className="text-xs">{discussion.votes}</span>
                    </Button>
                    <Button variant="ghost" size="sm">
                      <MoreVertical className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Message Input */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Input
              placeholder="Add to discussion... Use @ to tag people"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              className="pr-8"
            />
            {newMessage.includes('@') && (
              <div className="absolute bottom-full left-0 right-0 bg-card border border-border rounded-md mb-1 z-[60] shadow-lg max-h-40 overflow-y-auto">
                {allCollaborators.filter(c => {
                  const searchTerm = newMessage.split('@').pop()?.toLowerCase() || '';
                  return c.name.toLowerCase().includes(searchTerm) && searchTerm.length > 0;
                }).slice(0, 5).map((collaborator) => (
                  <button
                    key={collaborator.id}
                    className="w-full text-left px-3 py-2 hover:bg-muted flex items-center gap-2 text-sm first:rounded-t-md last:rounded-b-md transition-colors"
                    onClick={(e) => {
                      e.preventDefault();
                      const parts = newMessage.split('@');
                      const beforeAt = parts.slice(0, -1).join('@');
                      const afterCurrentTag = parts[parts.length - 1].split(' ').slice(1).join(' ');
                      const newText = `${beforeAt}@${collaborator.name} ${afterCurrentTag}`.trim() + ' ';
                      setNewMessage(newText);
                    }}
                  >
                    <Avatar className="w-6 h-6">
                      <AvatarImage src={collaborator.avatar} />
                      <AvatarFallback className="text-xs">
                        {collaborator.initials}
                      </AvatarFallback>
                    </Avatar>
                    <span>{collaborator.name}</span>
                  </button>
                ))}
                {allCollaborators.filter(c => {
                  const searchTerm = newMessage.split('@').pop()?.toLowerCase() || '';
                  return c.name.toLowerCase().includes(searchTerm) && searchTerm.length > 0;
                }).length === 0 && newMessage.split('@').pop()?.length > 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    No users found
                  </div>
                )}
              </div>
            )}
          </div>
          <Button onClick={handleSendMessage} disabled={!newMessage.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Expanded Trip Card */}
      {selectedTripData && (
        <TripCardExpanded
          trip={selectedTripData}
          isOpen={!!selectedTrip}
          onClose={() => setSelectedTrip(null)}
          onAddToBoard={() => {
            setSelectedTrip(null);
            // Handle add to board logic
          }}
        />
      )}
    </div>
  );
};