import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  Bell, 
  Users, 
  User, 
  Settings2,
  UserPlus
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { SessionModeSwitch } from '@/components/SessionModeSwitch';
import { CollaborationInviteManager } from '@/components/CollaborationInviteManager';
import type { CollaborationSession, SessionInvite } from '@/hooks/useSessionManagement';
import { useUserRole } from '@/hooks/useUserRole';

interface HeaderControlsProps {
  currentSession: CollaborationSession | null;
  availableSessions: CollaborationSession[];
  pendingInvites: SessionInvite[];
  sentSessions: CollaborationSession[];
  isInSolo: boolean;
  loading: boolean;
  onSwitchToSolo: () => void;
  onSwitchToCollaborative: (sessionId: string) => void;
  onCreateSession: (participants: string[], sessionName: string) => Promise<void>;
  onAcceptInvite: (inviteId: string) => Promise<void>;
  onDeclineInvite: (inviteId: string) => Promise<void>;
  onRevokeInvite: (inviteId: string) => Promise<void>;
}

export const HeaderControls: React.FC<HeaderControlsProps> = ({
  currentSession,
  availableSessions,
  pendingInvites,
  sentSessions,
  isInSolo,
  loading,
  onSwitchToSolo,
  onSwitchToCollaborative,
  onCreateSession,
  onAcceptInvite,
  onDeclineInvite,
  onRevokeInvite
}) => {
  const [invitePopoverOpen, setInvitePopoverOpen] = useState(false);
  const [sessionPopoverOpen, setSessionPopoverOpen] = useState(false);
  const { isAdmin } = useUserRole();

  const totalNotifications = pendingInvites.length;
  const pendingSentSessions = sentSessions.filter(session => 
    session.status === 'pending'
  );

  return (
    <div className="flex items-center gap-2">
      {/* Collaboration Invites */}
      <Popover open={invitePopoverOpen} onOpenChange={setInvitePopoverOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="relative">
            <Bell className="h-4 w-4" />
            {totalNotifications > 0 && (
              <Badge 
                variant="destructive" 
                className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs"
              >
                {totalNotifications}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-96 p-0" align="end">
          <CollaborationInviteManager
            pendingInvites={pendingInvites}
            sentSessions={pendingSentSessions}
            onAcceptInvite={onAcceptInvite}
            onDeclineInvite={onDeclineInvite}
            onRevokeInvite={onRevokeInvite}
            loading={loading}
          />
        </PopoverContent>
      </Popover>

      {/* Session Mode Switch */}
      <Popover open={sessionPopoverOpen} onOpenChange={setSessionPopoverOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2">
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
                {currentSession.members.length}
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

      {isAdmin && (
        <Button variant="ghost" size="sm">
          <Settings2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
};