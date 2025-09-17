import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { 
  Users, 
  User, 
  Plus, 
  ChevronDown, 
  ChevronUp,
  Check,
  Clock,
  X
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { CollaborationSession } from '@/hooks/useSessionManagement';
import { CreateSessionDialog } from './CreateSessionDialog';

interface SessionSwitcherProps {
  isInSolo: boolean;
  currentSession: CollaborationSession | null;
  availableSessions: CollaborationSession[];
  onSwitchToSolo: () => void;
  onSwitchToCollaborative: (sessionId: string) => void;
  onCreateSession: (participants: string[], sessionName: string) => Promise<void>;
  onCancelSession: (sessionId: string) => Promise<void>;
  canSwitchToSolo: boolean;
  currentUserId?: string;
  isOpen?: boolean;
  onToggle?: (isOpen: boolean) => void;
}

export const SessionSwitcher = ({
  isInSolo,
  currentSession,
  availableSessions,
  onSwitchToSolo,
  onSwitchToCollaborative,
  onCreateSession,
  onCancelSession,
  canSwitchToSolo,
  currentUserId,
  isOpen,
  onToggle
}: SessionSwitcherProps) => {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Use external control if provided, otherwise use internal state
  const isExpanded = isOpen !== undefined ? isOpen : internalExpanded;
  
  const handleToggleExpanded = () => {
    const newState = !isExpanded;
    if (onToggle) {
      onToggle(newState);
    } else {
      setInternalExpanded(newState);
    }
  };

  // Filter sessions by type
  const activeSessions = availableSessions.filter(s => s.status === 'active');
  const dormantSessions = availableSessions.filter(s => s.status === 'dormant');
  const receivedInvites = availableSessions.filter(s => 
    s.status === 'pending' && s.invitedBy !== currentUserId
  );
  const sentInvites = availableSessions.filter(s => 
    s.status === 'pending' && s.invitedBy === currentUserId
  );

  console.log('Available sessions:', availableSessions);
  console.log('Current user ID:', currentUserId);
  console.log('Received invites:', receivedInvites);
  console.log('Sent invites:', sentInvites);

  return (
    <Card className="mb-4" data-session-switcher>
      <CardContent className="p-4">
        {/* Current Session Display */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            {isInSolo ? (
              <>
                <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Solo Session</p>
                  <p className="text-xs text-muted-foreground">Swiping independently</p>
                </div>
              </>
            ) : currentSession ? (
              <>
                <div className="relative">
                  <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-background" />
                </div>
                <div>
                  <p className="font-medium">{currentSession.name}</p>
                  <p className="text-xs text-muted-foreground">
                    With {currentSession.participants.length} friend{currentSession.participants.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </>
            ) : null}
            
            {isInSolo && (
              <Badge variant="outline" className="text-xs">
                Active
              </Badge>
            )}
            
            {!isInSolo && currentSession && (
              <Badge className="text-xs bg-green-500">
                Collaborative
              </Badge>
            )}
          </div>

          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleToggleExpanded}
            className="flex items-center gap-1"
          >
            Switch
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>

        {/* Show participants in current collaborative session */}
        {!isInSolo && currentSession && (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-muted-foreground">Collaborating with:</span>
            <div className="flex -space-x-2">
              {currentSession.participants.slice(0, 3).map((participant, idx) => (
                <Avatar key={participant.id} className="w-6 h-6 border-2 border-background">
                  <AvatarImage src={participant.avatar} />
                  <AvatarFallback className="text-xs">
                    {participant.name.split(' ').map(n => n[0]).join('')}
                  </AvatarFallback>
                </Avatar>
              ))}
              {currentSession.participants.length > 3 && (
                <div className="w-6 h-6 rounded-full bg-muted border-2 border-background flex items-center justify-center">
                  <span className="text-xs font-medium">+{currentSession.participants.length - 3}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Expanded Session Options */}
        {isExpanded && (
          <div className="space-y-2 mt-4 pt-4 border-t">
            {/* Solo Option */}
            <button
              onClick={() => {
                if (canSwitchToSolo) {
                  onSwitchToSolo();
                  if (onToggle) {
                    onToggle(false);
                  } else {
                    setInternalExpanded(false);
                  }
                }
              }}
              disabled={!canSwitchToSolo}
              className={cn(
                "w-full p-3 rounded-lg border text-left transition-colors",
                isInSolo 
                  ? "bg-primary/5 border-primary" 
                  : canSwitchToSolo 
                    ? "hover:bg-muted/50 border-border" 
                    : "opacity-50 cursor-not-allowed border-border"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <User className="h-4 w-4" />
                  <div>
                    <p className="font-medium text-sm">Solo Session</p>
                    <p className="text-xs text-muted-foreground">Swipe for yourself</p>
                  </div>
                </div>
                {isInSolo && <Check className="h-4 w-4 text-primary" />}
                {!canSwitchToSolo && (
                  <Badge variant="outline" className="text-xs">
                    Exit current session first
                  </Badge>
                )}
              </div>
            </button>

            {/* Active Collaborative Sessions */}
            {activeSessions.map((session) => (
              <button
                key={session.id}
                onClick={() => {
                  onSwitchToCollaborative(session.id);
                  if (onToggle) {
                    onToggle(false);
                  } else {
                    setInternalExpanded(false);
                  }
                }}
                className={cn(
                  "w-full p-3 rounded-lg border text-left transition-colors",
                  currentSession?.id === session.id
                    ? "bg-primary/5 border-primary"
                    : "hover:bg-muted/50 border-border"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Users className="h-4 w-4" />
                      <div className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{session.name}</p>
                      <div className="flex items-center gap-2">
                        <div className="flex -space-x-1">
                          {session.participants.slice(0, 2).map((participant) => (
                            <Avatar key={participant.id} className="w-4 h-4 border border-background">
                              <AvatarImage src={participant.avatar} />
                              <AvatarFallback className="text-xs">
                                {participant.name[0]}
                              </AvatarFallback>
                            </Avatar>
                          ))}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {session.participants.length} participant{session.participants.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className="text-xs bg-green-500">Active</Badge>
                    {currentSession?.id === session.id && <Check className="h-4 w-4 text-primary" />}
                  </div>
                </div>
              </button>
            ))}

            {/* Received Invitations */}
            {receivedInvites.length > 0 && (
              <>
                <div className="text-xs text-muted-foreground font-medium mt-4 mb-2">
                  Invitations Received
                </div>
                {receivedInvites.map((session) => (
                  <div
                    key={`invite-received-${session.id}`}
                    className="w-full p-3 rounded-lg border border-primary/20 bg-primary/5 text-left"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <Users className="h-4 w-4 text-primary" />
                          <div className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full animate-pulse" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">{session.name}</p>
                          <p className="text-xs text-muted-foreground">
                            From {session.inviterProfile?.name || session.inviterProfile?.username || 'Friend'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-xs px-2"
                          onClick={() => onSwitchToCollaborative(session.id)}
                        >
                          Accept
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await onCancelSession(session.id);
                            if (onToggle) {
                              onToggle(false);
                            } else {
                              setInternalExpanded(false);
                            }
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* Sent Invitations */}
            {sentInvites.length > 0 && (
              <>
                <div className="text-xs text-muted-foreground font-medium mt-4 mb-2">
                  Invitations Sent ({sentInvites.length})
                </div>
                {sentInvites.map((session) => {
                  const acceptedCount = session.participants.filter(p => p.hasAccepted).length;
                  
                  return (
                    <div
                      key={`invite-sent-${session.id}`}
                      className="w-full p-3 rounded-lg border border-dashed opacity-60 text-left cursor-default"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <Users className="h-4 w-4 text-muted-foreground" />
                            <Clock className="absolute -top-1 -right-1 w-2 h-2 text-amber-500" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{session.name}</p>
                            <div className="flex items-center gap-2">
                              <div className="flex -space-x-1">
                                {session.participants.slice(0, 2).map((participant) => (
                                  <Avatar key={participant.id} className={cn(
                                    "w-4 h-4 border border-background",
                                    participant.hasAccepted ? "" : "opacity-50"
                                  )}>
                                    <AvatarImage src={participant.avatar} />
                                    <AvatarFallback className="text-xs">
                                      {participant.name[0]}
                                    </AvatarFallback>
                                  </Avatar>
                                ))}
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {acceptedCount}/{session.participants.length} accepted
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="text-xs">
                            Waiting
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                            onClick={async (e) => {
                              e.stopPropagation();
                              await onCancelSession(session.id);
                              if (onToggle) {
                                onToggle(false);
                              } else {
                                setInternalExpanded(false);
                              }
                            }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {/* Dormant Sessions */}
            {dormantSessions.length > 0 && (
              <>
                <div className="text-xs text-muted-foreground font-medium mt-4 mb-2">
                  Dormant Sessions
                </div>
                {dormantSessions.map((session) => (
                  <div
                    key={session.id}
                    className="w-full p-3 rounded-lg border opacity-75 text-left cursor-default"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <Users className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">{session.name}</p>
                          <div className="flex items-center gap-2">
                            <div className="flex -space-x-1">
                              {session.participants.slice(0, 2).map((participant) => (
                                <Avatar key={participant.id} className="w-4 h-4 border border-background">
                                  <AvatarImage src={participant.avatar} />
                                  <AvatarFallback className="text-xs">
                                    {participant.name[0]}
                                  </AvatarFallback>
                                </Avatar>
                              ))}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {session.participants.length} participant{session.participants.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className="text-xs">
                          Dormant
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* Create New Session Option */}
            <button
              onClick={() => {
                setShowCreateDialog(true);
                if (onToggle) {
                  onToggle(false);
                } else {
                  setInternalExpanded(false);
                }
              }}
              className="w-full p-3 rounded-lg border border-dashed border-border text-left transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center gap-3">
                <Plus className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="font-medium text-sm text-muted-foreground">Create New Session</p>
                  <p className="text-xs text-muted-foreground">Start collaborating with friends</p>
                </div>
              </div>
            </button>
          </div>
        )}

        <CreateSessionDialog
          isOpen={showCreateDialog}
          onClose={() => setShowCreateDialog(false)}
          onCreateSession={onCreateSession}
        />
      </CardContent>
    </Card>
  );
};