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
    <div className="w-full bg-card/95 backdrop-blur-sm border border-border rounded-xl shadow-lg">
      <div className="p-6">
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
          <div className="space-y-4">
            {pendingInvites.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="text-base font-medium mb-1">No pending invites</p>
                <p className="text-sm">When someone invites you to a session, it will appear here</p>
              </div>
            ) : (
              pendingInvites.map((invite) => (
                <Card
                  key={invite.id}
                  className="p-4 bg-gradient-to-r from-background/80 to-muted/20 border border-border/50 hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <Avatar className="h-12 w-12 border-2 border-primary/20">
                      <AvatarImage src={invite.invitedBy.avatar} />
                      <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                        {invite.invitedBy.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    
                    <div className="flex-1 space-y-2">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">
                            {invite.invitedBy.name}
                          </span>
                          <Badge variant="secondary" className="text-xs px-2 py-0.5">
                            @{invite.invitedBy.username}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          invited you to join <span className="font-medium text-foreground">"{invite.sessionName}"</span>
                        </p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {getTimeAgo(invite.createdAt)}
                        </div>
                      </div>

                      {/* Action buttons moved to bottom for better mobile UX */}
                      <div className="flex gap-3 pt-2">
                        <Button
                          size="default"
                          onClick={() => onAcceptInvite(invite.id)}
                          disabled={loading}
                          className="flex-1 bg-primary hover:bg-primary/90 font-medium"
                        >
                          <Check className="h-4 w-4 mr-2" />
                          Accept
                        </Button>
                        <Button
                          size="default"
                          variant="outline"
                          onClick={() => onDeclineInvite(invite.id)}
                          disabled={loading}
                          className="flex-1 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
                        >
                          <X className="h-4 w-4 mr-2" />
                          Decline
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        )}

        {activeTab === 'sent' && (
          <div className="space-y-4">
            {pendingSentSessions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <UserPlus className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="text-base font-medium mb-1">No sent invites</p>
                <p className="text-sm">Sessions you create will appear here</p>
              </div>
            ) : (
              pendingSentSessions.map((session) => (
                <Card
                  key={session.id}
                  className="p-4 bg-gradient-to-r from-background/80 to-muted/20 border border-border/50"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center border-2 border-primary/20">
                      <Users className="h-6 w-6 text-primary" />
                    </div>
                    
                    <div className="flex-1 space-y-2">
                      <div className="flex items-start justify-between">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground">
                              {session.name}
                            </span>
                            <Badge 
                              variant={session.status === 'pending' ? 'secondary' : 'outline'} 
                              className="text-xs px-2 py-0.5"
                            >
                              {session.status === 'pending' ? 'Waiting for responses' : 'Partially accepted'}
                            </Badge>
                          </div>
                          
                          <div className="flex items-center gap-3">
                            <div className="flex -space-x-1">
                              {session.participants.slice(0, 3).map((participant) => (
                                <Avatar key={participant.id} className="h-7 w-7 border-2 border-background">
                                  <AvatarImage src={participant.avatar} />
                                  <AvatarFallback className="text-xs bg-muted font-medium">
                                    {participant.name.charAt(0).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                              ))}
                              {session.participants.length > 3 && (
                                <div className="h-7 w-7 bg-muted border-2 border-background rounded-full flex items-center justify-center">
                                  <span className="text-xs font-medium">
                                    +{session.participants.length - 3}
                                  </span>
                                </div>
                              )}
                            </div>
                            <span className="text-sm text-muted-foreground font-medium">
                              {session.participants.filter(p => p.hasAccepted).length}/{session.participants.length} accepted
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            Created {getTimeAgo(session.createdAt)}
                          </div>
                        </div>

                        <Button
                          size="default"
                          variant="outline"
                          onClick={() => onCancelSession(session.id)}
                          disabled={loading}
                          className="hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
                        >
                          <X className="h-4 w-4 mr-2" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};