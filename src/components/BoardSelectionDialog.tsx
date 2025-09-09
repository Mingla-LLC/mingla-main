import React, { useState } from 'react';
import { X, Plus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface Board {
  id: string;
  title: string;
  description: string;
  tripCount: number;
  collaborators: Array<{
    id: string;
    name: string;
    avatar: string;
    initials: string;
  }>;
  cover: string;
}

interface BoardSelectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectBoard: (boardId: string) => void;
  onCreateNewBoard: () => void;
  boards: Board[];
  tripTitle: string;
}

export const BoardSelectionDialog = ({ 
  isOpen, 
  onClose, 
  onSelectBoard, 
  onCreateNewBoard,
  boards,
  tripTitle 
}: BoardSelectionDialogProps) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card w-full max-w-md rounded-xl shadow-lg max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div>
            <h2 className="text-xl font-bold">Add to Board</h2>
            <p className="text-sm text-muted-foreground mt-1">"{tripTitle}"</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {/* Create New Board Option */}
          <Card 
            className="p-4 cursor-pointer hover:shadow-md transition-all border-dashed border-2"
            onClick={() => {
              onClose();
              onCreateNewBoard();
            }}
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                <Plus className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Create New Board</h3>
                <p className="text-xs text-muted-foreground">
                  Start a new board with this experience
                </p>
              </div>
            </div>
          </Card>

          {/* Existing Boards */}
          {boards.length > 0 && (
            <>
              <div className="flex items-center gap-2">
                <div className="h-px bg-border flex-1" />
                <span className="text-xs text-muted-foreground px-2">or add to existing</span>
                <div className="h-px bg-border flex-1" />
              </div>

              {boards.map((board) => (
                <Card 
                  key={board.id}
                  className="p-4 cursor-pointer hover:shadow-md transition-all"
                  onClick={() => {
                    onSelectBoard(board.id);
                    onClose();
                  }}
                >
                  <div className="flex items-center gap-3">
                    {/* Board Cover */}
                    <div className="relative w-12 h-12 flex-shrink-0 rounded-lg overflow-hidden">
                      <img
                        src={board.cover}
                        alt={board.title}
                        className="w-full h-full object-cover"
                      />
                      <Badge 
                        variant="secondary" 
                        className="absolute bottom-0 right-0 text-xs bg-white/90 text-black scale-75 origin-bottom-right"
                      >
                        {board.tripCount}
                      </Badge>
                    </div>

                    {/* Board Info */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm truncate">{board.title}</h3>
                      <p className="text-xs text-muted-foreground truncate">
                        {board.description}
                      </p>
                      
                      {/* Collaborators */}
                      <div className="flex items-center gap-1 mt-1">
                        <div className="flex -space-x-1">
                          {board.collaborators.slice(0, 2).map((collaborator) => (
                            <Avatar key={collaborator.id} className="w-4 h-4 border border-background">
                              <AvatarImage src={collaborator.avatar} />
                              <AvatarFallback className="text-xs">
                                {collaborator.initials}
                              </AvatarFallback>
                            </Avatar>
                          ))}
                          {board.collaborators.length > 2 && (
                            <div className="w-4 h-4 bg-muted rounded-full border border-background flex items-center justify-center">
                              <span className="text-xs text-muted-foreground">
                                +{board.collaborators.length - 2}
                              </span>
                            </div>
                          )}
                        </div>
                        {board.collaborators.length > 0 && (
                          <span className="text-xs text-muted-foreground ml-1">
                            {board.collaborators.length} collaborator{board.collaborators.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </>
          )}

          {boards.length === 0 && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                No boards yet. Create your first board to get started!
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
