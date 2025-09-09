import React, { useState } from 'react';
import { X, Users, Image } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface NewBoardDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateBoard: (boardData: {
    title: string;
    description: string;
    collaborators: string[];
    cover?: string;
  }) => void;
}

export const NewBoardDialog = ({ isOpen, onClose, onCreateBoard }: NewBoardDialogProps) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [collaboratorInput, setCollaboratorInput] = useState('');
  const [collaborators, setCollaborators] = useState<string[]>([]);
  const [coverUrl, setCoverUrl] = useState('');

  const handleAddCollaborator = () => {
    if (collaboratorInput.trim() && !collaborators.includes(collaboratorInput.trim())) {
      setCollaborators(prev => [...prev, collaboratorInput.trim()]);
      setCollaboratorInput('');
    }
  };

  const handleRemoveCollaborator = (collaborator: string) => {
    setCollaborators(prev => prev.filter(c => c !== collaborator));
  };

  const handleCreate = () => {
    if (title.trim()) {
      onCreateBoard({
        title: title.trim(),
        description: description.trim(),
        collaborators,
        cover: coverUrl.trim() || 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4'
      });
      // Reset form
      setTitle('');
      setDescription('');
      setCollaborators([]);
      setCoverUrl('');
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card w-full max-w-md rounded-xl shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-bold">Create New Board</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="p-6 space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Board Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter board title"
              className="w-full"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your board"
              className="w-full resize-none"
              rows={2}
            />
          </div>

          {/* Cover Image */}
          <div className="space-y-2">
            <Label htmlFor="cover">Cover Image URL (optional)</Label>
            <Input
              id="cover"
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              placeholder="https://example.com/image.jpg"
              className="w-full"
            />
          </div>

          {/* Collaborators */}
          <div className="space-y-2">
            <Label>Collaborators (optional)</Label>
            <div className="flex gap-2">
              <Input
                value={collaboratorInput}
                onChange={(e) => setCollaboratorInput(e.target.value)}
                placeholder="Enter username"
                className="flex-1"
                onKeyPress={(e) => e.key === 'Enter' && handleAddCollaborator()}
              />
              <Button 
                type="button" 
                variant="outline" 
                onClick={handleAddCollaborator}
                disabled={!collaboratorInput.trim()}
              >
                Add
              </Button>
            </div>
            
            {/* Added Collaborators */}
            {collaborators.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {collaborators.map((collaborator) => (
                  <div 
                    key={collaborator} 
                    className="flex items-center gap-2 bg-muted px-2 py-1 rounded-md"
                  >
                    <Avatar className="w-5 h-5">
                      <AvatarFallback className="text-xs">
                        {collaborator.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm">@{collaborator}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-4 w-4 p-0 hover:bg-destructive hover:text-destructive-foreground"
                      onClick={() => handleRemoveCollaborator(collaborator)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 p-6 border-t border-border">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button 
            onClick={handleCreate} 
            disabled={!title.trim()}
            className="flex-1 bg-gradient-primary"
          >
            Create Board
          </Button>
        </div>
      </div>
    </div>
  );
};