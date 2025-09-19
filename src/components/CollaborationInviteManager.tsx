import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Users, Clock, UserPlus, X, Check } from 'lucide-react';
import type { SessionInvite, CollaborationSession } from '@/hooks/useSessionManagement';

interface CollaborationInviteManagerProps {
  pendingInvites: SessionInvite[];
  sentSessions: CollaborationSession[];
  onAcceptInvite: (inviteId: string) => void;
  onDeclineInvite: (inviteId: string) => void;
  onCancelSession: (sessionId: string) => void;
  loading?: boolean;
}

export const CollaborationInviteManager: React.FC<CollaborationInviteManagerProps> = ({
  pendingInvites,
  sentSessions,
  onAcceptInvite,
  onDeclineInvite,
  onCancelSession,
  loading = false
}) => {
  const [activeTab, setActiveTab] = useState<'received' | 'sent'>('received');

  const getTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
    const diffInDays = Math.floor(diffInHours / 24);

    if (diffInDays > 0) {
      return `${diffInDays}d ago`;
    } else if (diffInHours > 0) {
      return `${diffInHours}h ago`;
    } else {
      return 'Just now';
    }
  };

  const pendingSentSessions = sentSessions.filter(session => 
    session.status === 'pending' || session.status === 'dormant'
  );

  return (
    <Card className="w-full bg-card/50 backdrop-blur-sm border-accent/20">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg">Collaboration Invites</h3>
          <div className="flex bg-muted/50 rounded-lg p-1">
            <Button
              variant={activeTab === 'received' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('received')}
              className="text-xs px-3"
            >
              Received ({pendingInvites.length})
            </Button>
            <Button
              variant={activeTab === 'sent' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('sent')}
              className="text-xs px-3"
            >
              Sent ({pendingSentSessions.length})
            </Button>
          </div>
        </div>

        {activeTab === 'received' && (
          <div className="space-y-3">
            {pendingInvites.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No pending invites</p>
              </div>
            ) : (
              pendingInvites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-background/50 border border-accent/10"
                >
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={invite.invitedBy.avatar} />
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {invite.invitedBy.name.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm truncate">
                        {invite.invitedBy.name}
                      </span>
                      <Badge variant="secondary" className="text-xs">
                        @{invite.invitedBy.username}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-1">
                      invited you to "{invite.sessionName}"
                    </p>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {getTimeAgo(invite.createdAt)}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => onAcceptInvite(invite.sessionId)}
                      disabled={loading}
                      className="bg-primary/90 hover:bg-primary"
                    >
                      <Check className="h-3 w-3 mr-1" />
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onDeclineInvite(invite.sessionId)}
                      disabled={loading}
                    >
                      <X className="h-3 w-3 mr-1" />
                      Decline
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'sent' && (
          <div className="space-y-3">
            {pendingSentSessions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <UserPlus className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No pending sent invites</p>
              </div>
            ) : (
              pendingSentSessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-background/50 border border-accent/10"
                >
                  <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm truncate">
                        {session.name}
                      </span>
                      <Badge variant={session.status === 'pending' ? 'secondary' : 'outline'} className="text-xs">
                        {session.status === 'pending' ? 'Waiting' : 'Partial'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex -space-x-1">
                        {session.participants.slice(0, 3).map((participant) => (
                          <Avatar key={participant.id} className="h-6 w-6 border-2 border-background">
                            <AvatarImage src={participant.avatar} />
                            <AvatarFallback className="text-xs bg-muted">
                              {participant.name.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {session.participants.filter(p => p.hasAccepted).length}/{session.participants.length} accepted
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {getTimeAgo(session.createdAt)}
                    </div>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onCancelSession(session.id)}
                    disabled={loading}
                    className="hover:bg-destructive/10 hover:text-destructive"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Cancel
                  </Button>
                </div>
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};