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
  // UI props
  showNotifications: boolean;
  onToggleNotifications: () => void;
  onShowPreferences: () => void;
  
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
  showNotifications,
  onToggleNotifications,
  onShowPreferences,
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

  return (
    <div className="flex items-center gap-3">
      {/* Notifications Bell */}
      <Popover open={invitePopoverOpen} onOpenChange={setInvitePopoverOpen}>
        <PopoverTrigger asChild>
          <Button 
            variant="outline" 
            size="lg" 
            className="h-12 w-12 rounded-2xl border-2 border-primary/20 hover:border-primary/40 hover:bg-primary/5 transition-all duration-200 relative"
          >
            <Bell className="h-5 w-5" />
            {totalNotifications > 0 && (
              <Badge 
                variant="destructive" 
                className="absolute -top-1 -right-1 h-4 w-4 rounded-full p-0 flex items-center justify-center text-xs"
              >
                {totalNotifications}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[420px] p-0" align="end">
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
            size="lg" 
            className="h-12 px-4 rounded-2xl border-2 border-primary/20 hover:border-primary/40 hover:bg-primary/5 transition-all duration-200 flex items-center gap-2"
          >
            {isInSolo ? (
              <>
                <User className="h-5 w-5" />
                <span className="font-semibold">Solo</span>
              </>
            ) : (
              <>
                <Users className="h-5 w-5" />
                <span className="font-semibold">Team</span>
              </>
            )}
            {currentSession && (
              <Badge variant="secondary" className="ml-1 px-1.5 text-xs">
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
          size="lg" 
          className="h-12 w-12 rounded-2xl bg-orange-500/10 hover:bg-orange-500/20 border-2 border-orange-500/20 text-orange-600 transition-all duration-200"
          onClick={() => window.open('/admin', '_blank')}
        >
          <Shield className="h-5 w-5" />
        </Button>
      )}

      {/* Create Session Button */}
      <Button 
        variant="outline" 
        size="lg" 
        className="h-12 w-12 rounded-2xl border-2 border-primary/20 hover:border-primary/40 bg-primary/5 hover:bg-primary/10 text-primary transition-all duration-200"
        onClick={() => setSessionPopoverOpen(true)}
      >
        <Plus className="h-5 w-5" />
      </Button>
    </div>
  );
};