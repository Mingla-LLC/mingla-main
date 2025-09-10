import React, { useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { UserPlus, Clock, Check, X } from 'lucide-react';

interface CollaborationRequest {
  id: string;
  from: {
    id: string;
    name: string;
    avatar: string;
    username: string;
  };
  tripTitle: string;
  timestamp: string;
  status: 'pending' | 'accepted' | 'declined';
}

interface CollaborationRequestDialogProps {
  isOpen: boolean;
  onClose: () => void;
  requests: CollaborationRequest[];
  onAcceptRequest: (requestId: string) => void;
  onDeclineRequest: (requestId: string) => void;
}

export const CollaborationRequestDialog = ({
  isOpen,
  onClose,
  requests,
  onAcceptRequest,
  onDeclineRequest
}: CollaborationRequestDialogProps) => {
  const pendingRequests = requests.filter(req => req.status === 'pending');

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Collaboration Requests
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {pendingRequests.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto mb-4 bg-muted rounded-full flex items-center justify-center">
                <UserPlus className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">No pending collaboration requests</p>
            </div>
          ) : (
            pendingRequests.map((request) => (
              <div key={request.id} className="flex items-start gap-3 p-4 border border-border rounded-lg">
                <Avatar className="w-10 h-10">
                  <AvatarImage src={request.from.avatar} />
                  <AvatarFallback>
                    {request.from.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 space-y-2">
                  <div>
                    <p className="text-sm font-medium">{request.from.name}</p>
                    <p className="text-xs text-muted-foreground">@{request.from.username}</p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm text-foreground">
                      Wants to collaborate on trip planning
                    </p>
                    <Badge variant="outline" className="text-xs">
                      {request.tripTitle}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {request.timestamp}
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button
                      size="sm"
                      onClick={() => onAcceptRequest(request.id)}
                      className="h-7 text-xs bg-green-50 hover:bg-green-100 text-green-600 border border-green-200"
                    >
                      <Check className="h-3 w-3 mr-1" />
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onDeclineRequest(request.id)}
                      className="h-7 text-xs bg-red-50 hover:bg-red-100 text-red-600 border border-red-200"
                    >
                      <X className="h-3 w-3 mr-1" />
                      Decline
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};