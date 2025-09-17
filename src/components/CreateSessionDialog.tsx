import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { X, Users, Send, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useUsers } from '@/hooks/useUsers';
import { supabase } from '@/integrations/supabase/client';

interface CreateSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  prefilledParticipants?: string[];
  prefilledSessionName?: string;
}

export const CreateSessionDialog = ({
  isOpen,
  onClose,
  prefilledParticipants = [],
  prefilledSessionName = ''
}: CreateSessionDialogProps) => {
  const [sessionName, setSessionName] = useState('');
  const [inviteInput, setInviteInput] = useState('');
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<Array<{
    id: string;
    username: string;
    name: string;
    avatar?: string;
    type: 'user';
  }>>([]);
  const [searchResults, setSearchResults] = useState<Array<{
    id: string;
    username: string;
    name: string;
    avatar?: string;
    type: 'user';
  }>>([]);

  const { getAllUsers, searchUsers, getDisplayName } = useUsers();

  // Load available users and prefill data on mount
  useEffect(() => {
    if (isOpen) {
      loadAvailableUsers();
      if (prefilledParticipants.length > 0) {
        setSelectedParticipants(prefilledParticipants);
      }
      if (prefilledSessionName) {
        setSessionName(prefilledSessionName);
      }
    }
  }, [isOpen, prefilledParticipants, prefilledSessionName]);

  // Search users when input changes
  useEffect(() => {
    if (inviteInput.trim()) {
      searchForUsers();
    } else {
      setSearchResults([]);
    }
  }, [inviteInput]);

  const loadAvailableUsers = async () => {
    const users = await getAllUsers();
    const formattedUsers = users.map(user => ({
      id: user.id,
      username: user.username,
      name: getDisplayName(user),
      avatar: user.avatar_url,
      type: 'user' as const
    }));
    setAvailableUsers(formattedUsers);
  };

  const searchForUsers = async () => {
    const users = await searchUsers(inviteInput);
    const formattedUsers = users.map(user => ({
      id: user.id,
      username: user.username,
      name: getDisplayName(user),
      avatar: user.avatar_url,
      type: 'user' as const
    }));
    setSearchResults(formattedUsers);
  };

  const allSuggestions = inviteInput.trim() ? searchResults : availableUsers;

  const handleAddParticipant = (username: string) => {
    if (!selectedParticipants.includes(username)) {
      setSelectedParticipants([...selectedParticipants, username]);
      setInviteInput('');
    }
  };

  const handleRemoveParticipant = (username: string) => {
    setSelectedParticipants(selectedParticipants.filter(p => p !== username));
  };

  const createSession = async () => {
    if (!sessionName.trim()) {
      toast.error('Name required');
      return;
    }
    
    if (selectedParticipants.length === 0) {
      toast.error('Add at least one participant');
      return;
    }
    
    setIsCreating(true);
    console.log('=== CREATING SESSION DIRECTLY ===');
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Not authenticated');
      }
      
      console.log('Creating session for user:', user.id);
      
      // Create the session
      const { data: sessionData, error: sessionError } = await supabase
        .from('collaboration_sessions')
        .insert({
          name: sessionName.trim(),
          created_by: user.id,
          status: 'pending',
        })
        .select()
        .single();

      if (sessionError) {
        console.error('Session creation error:', sessionError);
        throw new Error(sessionError.message);
      }
      
      console.log('Session created:', sessionData);

      // Add creator as participant
      const { error: creatorError } = await supabase
        .from('session_participants')
        .insert({
          session_id: sessionData.id,
          user_id: user.id,
          has_accepted: true,
          joined_at: new Date().toISOString()
        });

      if (creatorError) {
        console.error('Creator participant error:', creatorError);
        throw new Error('Failed to add creator');
      }

      // Process each participant
      for (const username of selectedParticipants) {
        console.log('Processing participant:', username);
        
        const { data: userData, error: userError } = await supabase
          .from('profiles')
          .select('id')
          .eq('username', username)
          .single();

        if (userError || !userData) {
          console.error('User lookup failed:', userError);
          throw new Error(`User "${username}" not found`);
        }

        if (userData.id === user.id) {
          console.log('Skipping self-invite');
          continue;
        }

        // Add as participant
        const { error: participantError } = await supabase
          .from('session_participants')
          .insert({
            session_id: sessionData.id,
            user_id: userData.id,
            has_accepted: false,
          });

        if (participantError) {
          console.error('Participant error:', participantError);
          throw new Error(`Failed to add ${username}`);
        }

        // Create invitation
        const { error: inviteError } = await supabase
          .from('collaboration_invites')
          .insert({
            session_id: sessionData.id,
            invited_user_id: userData.id,
            invited_by: user.id,
            status: 'pending',
            message: `${user.email} invited you to "${sessionName.trim()}"`
          });

        if (inviteError) {
          console.error('Invite error:', inviteError);
          throw new Error(`Failed to invite ${username}`);
        }
      }

      console.log('Session creation complete!');
      toast.success(`Invites sent for "${sessionName.trim()}"!`);
      
      // Reset and close
      setSessionName('');
      setSelectedParticipants([]);
      setInviteInput('');
      onClose();
      
      // Trigger a page reload to refresh all data
      setTimeout(() => window.location.reload(), 1000);
      
    } catch (error) {
      console.error('Session creation failed:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create session');
    } finally {
      setIsCreating(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inviteInput.trim()) {
      handleAddParticipant(inviteInput.trim());
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Create Collaboration Session
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Session Name */}
          <div className="space-y-2">
            <Label htmlFor="session-name">Session Name</Label>
            <Input
              id="session-name"
              placeholder="e.g., Weekend Plans with Friends"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
            />
          </div>

          {/* Selected Participants */}
          {selectedParticipants.length > 0 && (
            <div className="space-y-2">
              <Label>Selected Participants ({selectedParticipants.length})</Label>
              <div className="flex flex-wrap gap-2">
                {selectedParticipants.map((username) => {
                  const user = [...availableUsers, ...searchResults].find(s => s.username === username);
                  return (
                    <Badge key={username} variant="secondary" className="flex items-center gap-1">
                      <Avatar className="w-4 h-4">
                        <AvatarImage src={user?.avatar} />
                        <AvatarFallback className="text-xs">
                          {user ? user.name[0].toUpperCase() : username[0].toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-xs">@{username}</span>
                      <button
                        onClick={() => handleRemoveParticipant(username)}
                        className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add Participants */}
          <div className="space-y-2">
            <Label htmlFor="invite-input">Add Participants</Label>
            <div className="relative">
              <Input
                id="invite-input"
                placeholder="Enter username or email"
                value={inviteInput}
                onChange={(e) => setInviteInput(e.target.value)}
                onKeyPress={handleKeyPress}
              />
              {inviteInput && (
                <Button
                  size="sm"
                  className="absolute right-1 top-1 h-7"
                  onClick={() => handleAddParticipant(inviteInput.trim())}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              )}
            </div>

            {/* Suggestions */}
            {allSuggestions.length > 0 && (
              <div className="border rounded-lg max-h-40 overflow-y-auto">
                {allSuggestions.slice(0, 5).map((suggestion) => (
                  <button
                    key={suggestion.username}
                    onClick={() => handleAddParticipant(suggestion.username)}
                    className="w-full p-2 text-left hover:bg-muted flex items-center gap-2"
                    disabled={selectedParticipants.includes(suggestion.username)}
                  >
                    <Avatar className="w-6 h-6">
                      <AvatarImage src={suggestion.avatar} />
                      <AvatarFallback className="text-xs">
                        {suggestion.name[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{suggestion.name}</p>
                      <p className="text-xs text-muted-foreground">@{suggestion.username}</p>
                    </div>
                    <Badge variant="outline" className="ml-auto text-xs">
                      User
                    </Badge>
                  </button>
                ))}
              </div>
            )}

            {/* Quick suggestions */}
            {!inviteInput && availableUsers.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Quick add:</p>
                <div className="flex flex-wrap gap-2">
                  {availableUsers.slice(0, 4).map((suggestion) => (
                    <button
                      key={suggestion.username}
                      onClick={() => handleAddParticipant(suggestion.username)}
                      className="flex items-center gap-1 p-1 px-2 rounded-md border hover:bg-muted text-xs"
                      disabled={selectedParticipants.includes(suggestion.username)}
                    >
                      <Avatar className="w-4 h-4">
                        <AvatarImage src={suggestion.avatar} />
                        <AvatarFallback className="text-xs">
                          {suggestion.name[0].toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      @{suggestion.username}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button 
              type="button"
              onClick={createSession}
              disabled={isCreating || !sessionName.trim() || selectedParticipants.length === 0}
              className="flex-1"
            >
              {isCreating ? (
                "Creating..."
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Create Session
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};