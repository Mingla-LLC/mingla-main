import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { UserPlus, Check, X, Clock } from 'lucide-react';
import { SessionInvite } from '@/hooks/useSessionManagement';

interface SessionInviteNotificationsProps {
  invites: SessionInvite[];
  onAccept: (inviteId: string) => void;
  onDecline: (inviteId: string) => void;
  loading?: boolean;
}

export const SessionInviteNotifications = ({
  invites,
  onAccept,
  onDecline,
  loading = false
}: SessionInviteNotificationsProps) => {
  if (invites.length === 0) {
    return null;
  }

  return (
    <Card className="mb-4 border-primary/20 bg-primary/5">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <UserPlus className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-primary">Collaboration Invites</h3>
          <Badge variant="secondary" className="ml-auto">
            {invites.length}
          </Badge>
        </div>

        <div className="space-y-3">
          {invites.map((invite) => (
            <div key={invite.id} className="flex items-start gap-3 p-3 bg-background rounded-lg border">
              <Avatar className="w-10 h-10">
                <AvatarImage src={invite.invitedBy.avatar} />
                <AvatarFallback>
                  {invite.invitedBy.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              <div className="flex-1 space-y-2">
                <div>
                  <p className="text-sm font-medium">{invite.invitedBy.name}</p>
                  <p className="text-xs text-muted-foreground">@{invite.invitedBy.username}</p>
                </div>

                <div className="space-y-1">
                  <p className="text-sm text-foreground">
                    Invited you to collaborate on:
                  </p>
                  <Badge variant="outline" className="text-xs">
                    {invite.sessionName}
                  </Badge>
                  {invite.message && (
                    <p className="text-xs text-muted-foreground italic">
                      "{invite.message}"
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {new Date(invite.createdAt).toLocaleDateString()} at{' '}
                  {new Date(invite.createdAt).toLocaleTimeString()}
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    size="sm"
                    onClick={() => onAccept(invite.id)}
                    disabled={loading}
                    className="h-7 text-xs"
                  >
                    <Check className="h-3 w-3 mr-1" />
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onDecline(invite.id)}
                    disabled={loading}
                    className="h-7 text-xs"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Decline
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};