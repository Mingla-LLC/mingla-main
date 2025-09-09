import React, { useState } from 'react';
import { Plus, Users, MessageCircle, ThumbsUp, MoreVertical } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const boards = [
  {
    id: '1',
    title: 'Weekend Adventures',
    description: 'Fun activities for Saturday & Sunday',
    tripCount: 5,
    collaborators: [
      { id: '1', name: 'Sarah', avatar: 'https://images.unsplash.com/photo-1494790108755-2616b79444d7', initials: 'S' },
      { id: '2', name: 'Mike', avatar: '', initials: 'M' },
    ],
    autoLinked: ['Sarah'],
    lastActivity: '2 hours ago',
    comments: 3,
    votes: 8,
    cover: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4'
  },
  {
    id: '2',
    title: 'Date Night Ideas',
    description: 'Romantic spots around the city',
    tripCount: 3,
    collaborators: [
      { id: '3', name: 'Alex', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d', initials: 'A' },
    ],
    autoLinked: [],
    lastActivity: '1 day ago',
    comments: 1,
    votes: 5,
    cover: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0'
  },
  {
    id: '3',
    title: 'Team Building',
    description: 'Corporate retreat activities',
    tripCount: 7,
    collaborators: [
      { id: '4', name: 'Emma', avatar: '', initials: 'E' },
      { id: '5', name: 'John', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e', initials: 'J' },
      { id: '6', name: 'Lisa', avatar: '', initials: 'L' },
    ],
    autoLinked: ['Emma', 'John'],
    lastActivity: '3 days ago',
    comments: 12,
    votes: 15,
    cover: 'https://images.unsplash.com/photo-1513475382585-d06e58bcb0e0'
  }
];

const Boards = () => {
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="px-6 pt-12 pb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold">Boards</h1>
          <Button size="sm" className="bg-gradient-primary">
            <Plus className="h-4 w-4 mr-1" />
            New Board
          </Button>
        </div>
        <p className="text-muted-foreground">
          Organize and collaborate on your experiences
        </p>
      </div>

      {/* Boards List */}
      <div className="px-6 space-y-4">
        {boards.map((board) => (
          <Card 
            key={board.id} 
            className="overflow-hidden cursor-pointer hover:shadow-elevated transition-all"
            onClick={() => setSelectedBoard(board.id)}
          >
            <div className="flex">
              {/* Cover Image */}
              <div className="relative w-20 h-20 flex-shrink-0">
                <img
                  src={board.cover}
                  alt={board.title}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute bottom-1 left-1">
                  <Badge variant="secondary" className="text-xs bg-white/90 text-black">
                    {board.tripCount}
                  </Badge>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold text-sm mb-1">{board.title}</h3>
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {board.description}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </div>

                {/* Collaborators */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex -space-x-2">
                      {board.collaborators.slice(0, 3).map((collaborator) => (
                        <Avatar key={collaborator.id} className="w-6 h-6 border-2 border-background">
                          <AvatarImage src={collaborator.avatar} />
                          <AvatarFallback className="text-xs">
                            {collaborator.initials}
                          </AvatarFallback>
                        </Avatar>
                      ))}
                      {board.collaborators.length > 3 && (
                        <div className="w-6 h-6 bg-muted rounded-full border-2 border-background flex items-center justify-center">
                          <span className="text-xs text-muted-foreground">
                            +{board.collaborators.length - 3}
                          </span>
                        </div>
                      )}
                    </div>
                    
                    {board.autoLinked.length > 0 && (
                      <Badge variant="outline" className="text-xs">
                        Auto-linked: {board.autoLinked.join(', ')}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Activity Stats */}
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-border">
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" />
                      <span>{board.comments}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <ThumbsUp className="h-3 w-3" />
                      <span>{board.votes}</span>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {board.lastActivity}
                  </span>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Auto-linking Explanation */}
      <div className="px-6 py-6">
        <Card className="p-4 bg-gradient-cool/10 border-accent/20">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-accent/20 rounded-full flex items-center justify-center flex-shrink-0">
              <Users className="h-4 w-4 text-accent" />
            </div>
            <div>
              <h3 className="font-semibold text-sm mb-1">Auto-Collaborator Linking</h3>
              <p className="text-xs text-muted-foreground">
                When you use someone's preferences to generate trip cards, they're automatically 
                added to boards you create for those trips. Perfect for group planning!
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Empty State */}
      {boards.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <Users className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No boards yet</h3>
          <p className="text-muted-foreground mb-4">
            Create boards to organize and collaborate on experiences
          </p>
          <Button className="bg-gradient-primary">
            <Plus className="h-4 w-4 mr-2" />
            Create Your First Board
          </Button>
        </div>
      )}
    </div>
  );
};

export default Boards;