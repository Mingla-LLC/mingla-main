import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { 
  Users, 
  Settings, 
  Share, 
  MoreVertical, 
  Calendar,
  Edit3,
  Trash2
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BoardDetail } from '@/components/BoardDetail';
import { useBoards } from '@/hooks/useBoards';
import { toast } from '@/hooks/use-toast';

const Boards = () => {
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null);
  const [editingBoard, setEditingBoard] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  
  const { 
    boards, 
    loading, 
    deleteBoard,
    updateBoard
  } = useBoards();
  
  const selectedBoardData = boards.find(board => board.id === selectedBoard);

  const getDisplayName = (profile: { username: string; first_name?: string; last_name?: string }) => {
    if (profile.first_name && profile.last_name) {
      return `${profile.first_name} ${profile.last_name}`;
    }
    return profile.username;
  };

  const getUserInitials = (profile: { username: string; first_name?: string; last_name?: string }) => {
    const displayName = getDisplayName(profile);
    return displayName
      .split(' ')
      .map(name => name[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleTitleEdit = (boardId: string, currentTitle: string) => {
    setEditingBoard(boardId);
    setEditTitle(currentTitle);
  };

  const handleTitleSave = async (boardId: string) => {
    if (editTitle.trim() && editTitle !== boards.find(b => b.id === boardId)?.name) {
      await updateBoard(boardId, { name: editTitle.trim() });
    }
    setEditingBoard(null);
    setEditTitle('');
  };

  const handleTitleCancel = () => {
    setEditingBoard(null);
    setEditTitle('');
  };

  if (selectedBoard && selectedBoardData) {
    return (
      <BoardDetail 
        board={selectedBoardData}
        onBack={() => setSelectedBoard(null)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="px-6 pt-12 pb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold">Boards</h1>
        </div>
        <p className="text-muted-foreground">
          Organize and collaborate on your experiences
        </p>
      </div>

      {/* Boards List */}
      {!selectedBoard && (
        <div className="px-6 space-y-4">
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
              <p className="text-muted-foreground mt-4">Loading boards...</p>
            </div>
          ) : boards.length > 0 ? (
            boards.map((board) => (
              <Card 
                key={board.id} 
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => setSelectedBoard(board.id)}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        {editingBoard === board.id ? (
                          <Input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            onBlur={() => handleTitleSave(board.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleTitleSave(board.id);
                              } else if (e.key === 'Escape') {
                                handleTitleCancel();
                              }
                            }}
                            className="font-semibold text-lg border-none p-0 h-auto focus-visible:ring-0"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <h3 
                            className="font-semibold text-lg cursor-pointer hover:text-primary transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTitleEdit(board.id, board.name);
                            }}
                          >
                            {board.name}
                          </h3>
                        )}
                        {board.session_id && (
                          <Badge variant="secondary" className="text-xs">
                            <Users className="h-3 w-3 mr-1" />
                            Collaborative
                          </Badge>
                        )}
                        {board.is_public && (
                          <Badge variant="outline" className="text-xs">
                            Public
                          </Badge>
                        )}
                      </div>
                      
                      {board.description && (
                        <p className="text-muted-foreground text-sm mb-3">{board.description}</p>
                      )}
                      
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          {board.collaborators && board.collaborators.length > 0 && (
                            <div className="flex items-center gap-2">
                              <div className="flex -space-x-2">
                                {board.collaborators.slice(0, 3).map((collaborator) => (
                                  <Avatar key={collaborator.id} className="w-6 h-6 border-2 border-background">
                                    <AvatarImage src={collaborator.profile?.avatar_url} />
                                    <AvatarFallback className="text-xs">
                                      {collaborator.profile ? getUserInitials(collaborator.profile) : 'U'}
                                    </AvatarFallback>
                                  </Avatar>
                                ))}
                                {board.collaborators.length > 3 && (
                                  <div className="w-6 h-6 rounded-full bg-muted border-2 border-background flex items-center justify-center">
                                    <span className="text-xs font-medium">+{board.collaborators.length - 3}</span>
                                  </div>
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {board.collaborators.length} collaborator{board.collaborators.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            <Calendar className="h-3 w-3 mr-1" />
                            {new Date(board.updated_at).toLocaleDateString()}
                          </Badge>
                          
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={(e) => {
                                e.stopPropagation();
                                setSelectedBoard(board.id);
                              }}>
                                <Edit3 className="h-4 w-4 mr-2" />
                                Open Board
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={(e) => {
                                e.stopPropagation();
                                toast({
                                  title: "Share Board",
                                  description: "Share functionality coming soon!",
                                });
                              }}>
                                <Share className="h-4 w-4 mr-2" />
                                Share
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm('Are you sure you want to delete this board?')) {
                                    deleteBoard(board.id);
                                  }
                                }}
                                className="text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <Users className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No boards yet</h3>
              <p className="text-muted-foreground mb-4 max-w-md">
                Boards are automatically created when you start collaboration sessions with friends. Visit the Home tab to begin collaborating!
              </p>
            </div>
          )}
        </div>
      )}

      {/* Auto-linking Explanation */}
      <div className="px-6 py-6">
        <Card className="p-4 bg-gradient-cool/10 border-accent/20">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-accent/20 rounded-full flex items-center justify-center flex-shrink-0">
              <Users className="h-4 w-4 text-accent" />
            </div>
            <div>
              <h3 className="font-semibold text-sm mb-1">Collaborative Boards</h3>
              <p className="text-xs text-muted-foreground">
                When you create collaboration sessions with friends, boards are automatically 
                created once all participants join. You can also create boards manually for organizing experiences.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Boards;