import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Bell, Users, User, Plus, Shield } from 'lucide-react';
import { CollaborationInviteManager } from './CollaborationInviteManager';
import { SessionModeSwitch } from './SessionModeSwitch';
import { useUserRole } from '@/hooks/useUserRole';
import type { SessionInvite, CollaborationSession } from '@/hooks/useSessionManagement';

interface HeaderControlsProps {
  // Session props
  currentSession: CollaborationSession | null;
  availableSessions: CollaborationSession[];
  isInSolo: boolean;
  onSwitchToSolo: () => void;
  onSwitchToCollaborative: (sessionId: string) => void;
  onCreateSession: (participants: string[], sessionName: string) => Promise<void>;
  
  // Invite props
  pendingInvites: SessionInvite[];
  sentSessions: CollaborationSession[];
  onAcceptInvite: (inviteId: string) => void;
  onDeclineInvite: (inviteId: string) => void;
  onCancelSession: (sessionId: string) => void;
  
  loading?: boolean;
}

export const HeaderControls: React.FC<HeaderControlsProps> = ({
  currentSession,
  availableSessions,
  isInSolo,
  onSwitchToSolo,
  onSwitchToCollaborative,
  onCreateSession,
  pendingInvites,
  sentSessions,
  onAcceptInvite,
  onDeclineInvite,
  onCancelSession,
  loading = false
}) => {
  const [invitePopoverOpen, setInvitePopoverOpen] = useState(false);
  const [sessionPopoverOpen, setSessionPopoverOpen] = useState(false);
  const { isAdmin } = useUserRole();

  const totalNotifications = pendingInvites.length;
  const pendingSentSessions = sentSessions.filter(session => 
    session.status === 'pending' || session.status === 'dormant'
  );

  return (
    <div className="flex items-center gap-2">
      {/* Collaboration Invites */}
      <Popover open={invitePopoverOpen} onOpenChange={setInvitePopoverOpen}>
        <PopoverTrigger asChild>
          <Button 
            variant="outline" 
            size="sm" 
            className="relative bg-background/80 backdrop-blur-sm"
          >
            <Bell className="h-4 w-4" />
            {totalNotifications > 0 && (
              <Badge 
                variant="destructive" 
                className="absolute -top-2 -right-2 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs"
              >
                {totalNotifications}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-96 p-0" align="end">
          <CollaborationInviteManager
            pendingInvites={pendingInvites}
            sentSessions={sentSessions}
            onAcceptInvite={onAcceptInvite}
            onDeclineInvite={onDeclineInvite}
            onCancelSession={onCancelSession}
            loading={loading}
          />
        </PopoverContent>
      </Popover>

      {/* Session Mode */}
      <Popover open={sessionPopoverOpen} onOpenChange={setSessionPopoverOpen}>
        <PopoverTrigger asChild>
          <Button 
            variant="outline" 
            size="sm" 
            className="bg-background/80 backdrop-blur-sm"
          >
            {isInSolo ? (
              <>
                <User className="h-4 w-4 mr-1" />
                Solo
              </>
            ) : (
              <>
                <Users className="h-4 w-4 mr-1" />
                Team
              </>
            )}
            {currentSession && (
              <Badge variant="secondary" className="ml-2 px-1 text-xs">
                {currentSession.participants.length}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="end">
          <SessionModeSwitch
            currentSession={currentSession}
            availableSessions={availableSessions}
            isInSolo={isInSolo}
            onSwitchToSolo={onSwitchToSolo}
            onSwitchToCollaborative={onSwitchToCollaborative}
            onCreateSession={onCreateSession}
            loading={loading}
          />
        </PopoverContent>
      </Popover>
      
      {/* Admin Panel Access */}
      {isAdmin && (
        <Button 
          variant="outline" 
          size="sm" 
          className="bg-orange-500/10 hover:bg-orange-500/20 border-orange-500/20 text-orange-600"
          onClick={() => window.open('/admin', '_blank')}
        >
          <Shield className="h-4 w-4" />
        </Button>
      )}

      {/* Quick create session */}
      <Button 
        variant="outline" 
        size="sm" 
        className="bg-primary/10 hover:bg-primary/20 border-primary/20"
        onClick={() => setSessionPopoverOpen(true)}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
};