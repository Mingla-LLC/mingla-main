import React from 'react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { X, Users } from 'lucide-react';
import { SessionInvite } from '@/hooks/useSessionManagement';

interface NotificationBarProps {
  invites: SessionInvite[];
  onOpenSwitcher: () => void;
  onDismiss: () => void;
}

export const NotificationBar = ({ invites, onOpenSwitcher, onDismiss }: NotificationBarProps) => {
  if (invites.length === 0) return null;

  const firstInvite = invites[0];
  const otherCount = invites.length - 1;

  return (
    <div className="bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20 rounded-lg p-3 mx-6 mb-4 animate-in slide-in-from-top-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1">
          <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center">
            <Users className="h-4 w-4 text-primary" />
          </div>
          
          <div className="flex items-center gap-2 flex-1">
            <Avatar className="w-6 h-6">
              <AvatarImage src={firstInvite.invitedBy.avatar} />
              <AvatarFallback className="text-xs">
                {firstInvite.invitedBy.name[0].toUpperCase()}
              </AvatarFallback>
            </Avatar>
            
            <div className="text-sm">
              <span className="font-medium">{firstInvite.invitedBy.name}</span>
              <span className="text-muted-foreground"> invited you to collaborate</span>
              {otherCount > 0 && (
                <span className="text-muted-foreground"> (+{otherCount} more)</span>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button 
            size="sm" 
            onClick={(e) => {
              e.preventDefault();
              onOpenSwitcher();
            }}
          >
            View Invites
          </Button>
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};