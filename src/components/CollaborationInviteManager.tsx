import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  UserPlus, 
  Check, 
  X, 
  Clock, 
  Users,
  AlertCircle
} from 'lucide-react';
import type { CollaborationSession, SessionInvite } from '@/hooks/useSessionManagement';

interface CollaborationInviteManagerProps {
  pendingInvites: SessionInvite[];
  sentSessions: CollaborationSession[];
  onAcceptInvite: (inviteId: string) => Promise<void>;
  onDeclineInvite: (inviteId: string) => Promise<void>;
  onRevokeInvite: (inviteId: string) => Promise<void>;
  loading?: boolean;
}

export const CollaborationInviteManager: React.FC<CollaborationInviteManagerProps> = ({
  pendingInvites,
  sentSessions,
  onAcceptInvite,
  onDeclineInvite,
  onRevokeInvite,
  loading = false
}) => {
  const getTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffInMinutes < 1) {
      return 'Just now';
    } else if (diffInMinutes < 60) {
      return `${diffInMinutes} min ago`;
    } else if (diffInMinutes < 1440) {
      const hours = Math.floor(diffInMinutes / 60);
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else {
      const days = Math.floor(diffInMinutes / 1440);
      return `${days} day${days > 1 ? 's' : ''} ago`;
    }
  };

  const pendingSentSessions = sentSessions.filter(session => 
    session.status === 'pending'
  );

  return (
    <div className="w-full bg-card/95 backdrop-blur-sm border border-border rounded-xl shadow-lg">
      <div className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <UserPlus className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-lg">Collaboration Manager</h3>
        </div>

        {/* Received Invites */}
        {pendingInvites.length > 0 && (
          <div className="mb-6">
            <h4 className="font-medium text-sm text-muted-foreground mb-3 uppercase tracking-wide">
              Received Invites ({pendingInvites.length})
            </h4>
            <div className="space-y-3">
              {pendingInvites.map((invite) => (
                <div key={invite.id} className="bg-primary/5 border border-primary/20 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <Avatar className="w-10 h-10">
                      <AvatarImage src={invite.invitedBy.avatar} />
                      <AvatarFallback className="bg-primary/10 text-primary font-medium">
                        {invite.invitedBy.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    
                    <div className="flex-1 space-y-2">
                      <div>
                        <p className="font-medium text-sm">{invite.invitedBy.name}</p>
                        <p className="text-xs text-muted-foreground">@{invite.invitedBy.username}</p>
                      </div>
                      
                      <div>
                        <p className="text-sm">Invited you to collaborate on:</p>
                        <Badge variant="outline" className="mt-1">
                          {invite.sessionName}
                        </Badge>
                      </div>
                      
                      {invite.message && (
                        <p className="text-xs text-muted-foreground italic p-2 bg-background/50 rounded border">
                          "{invite.message}"
                        </p>
                      )}
                      
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {getTimeAgo(invite.createdAt)}
                      </div>
                      
                      <div className="flex gap-2 pt-2">
                        <Button
                          size="sm"
                          onClick={() => onAcceptInvite(invite.id)}
                          disabled={loading}
                          className="h-8 px-3 text-xs"
                        >
                          <Check className="h-3 w-3 mr-1" />
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline" 
                          onClick={() => onDeclineInvite(invite.id)}
                          disabled={loading}
                          className="h-8 px-3 text-xs border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                        >
                          <X className="h-3 w-3 mr-1" />
                          Decline
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sent Invites */}
        {pendingSentSessions.length > 0 && (
          <div className="mb-6">
            <h4 className="font-medium text-sm text-muted-foreground mb-3 uppercase tracking-wide">
              Pending Sessions ({pendingSentSessions.length})
            </h4>
            <div className="space-y-3">
              {pendingSentSessions.map((session) => (
                <div key={session.id} className="border border-accent/20 rounded-lg p-4 bg-background/50">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-sm">{session.name}</span>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {session.status === 'pending' ? 'Waiting for responses' : 'Partially accepted'}
                      </Badge>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <div className="flex -space-x-1">
                        {session.members.slice(0, 3).map((member) => (
                          <Avatar key={member.userId} className="h-7 w-7 border-2 border-background">
                            <AvatarImage src={member.profile.avatarUrl} />
                            <AvatarFallback className="text-xs bg-muted font-medium">
                              {(member.profile.firstName?.[0] || member.profile.username?.[0] || 'U').toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                        {session.members.length > 3 && (
                          <div className="h-7 w-7 bg-muted border-2 border-background rounded-full flex items-center justify-center">
                            <span className="text-xs font-medium">
                              +{session.members.length - 3}
                            </span>
                          </div>
                        )}
                      </div>
                      <span className="text-sm text-muted-foreground font-medium">
                        {session.members.filter(m => m.role === 'owner' || m.joinedAt).length}/{session.members.length} accepted
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      Created {getTimeAgo(session.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {pendingInvites.length === 0 && pendingSentSessions.length === 0 && (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-muted/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <UserPlus className="h-8 w-8 text-muted-foreground" />
            </div>
            <h4 className="font-medium mb-2">No pending collaborations</h4>
            <p className="text-sm text-muted-foreground">
              Start a new collaboration to see invites and requests here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};