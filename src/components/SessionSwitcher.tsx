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
  Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { CollaborationSession } from '@/hooks/useSessionManagement';

interface SessionSwitcherProps {
  isInSolo: boolean;
  currentSession: CollaborationSession | null;
  availableSessions: CollaborationSession[];
  onSwitchToSolo: () => void;
  onSwitchToCollaborative: (sessionId: string) => void;
  canSwitchToSolo: boolean;
}

export const SessionSwitcher = ({
  isInSolo,
  currentSession,
  availableSessions,
  onSwitchToSolo,
  onSwitchToCollaborative,
  canSwitchToSolo
}: SessionSwitcherProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const activeSessionsCount = availableSessions.filter(s => s.isActive).length;
  const inactiveSessionsCount = availableSessions.filter(s => !s.isActive).length;

  return (
    <Card className="mb-4">
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
            onClick={() => setIsExpanded(!isExpanded)}
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
                  setIsExpanded(false);
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
            {availableSessions.filter(s => s.isActive).map((session) => (
              <button
                key={session.id}
                onClick={() => {
                  onSwitchToCollaborative(session.id);
                  setIsExpanded(false);
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

            {/* Inactive/Past Sessions */}
            {availableSessions.filter(s => !s.isActive).length > 0 && (
              <>
                <div className="text-xs text-muted-foreground font-medium mt-4 mb-2">
                  Past Sessions
                </div>
                {availableSessions.filter(s => !s.isActive).map((session) => (
                  <button
                    key={session.id}
                    onClick={() => {
                      onSwitchToCollaborative(session.id);
                      setIsExpanded(false);
                    }}
                    className="w-full p-3 rounded-lg border text-left transition-colors hover:bg-muted/50 border-border opacity-75"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <Clock className="absolute -top-1 -right-1 w-2 h-2" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">{session.name}</p>
                          <span className="text-xs text-muted-foreground">
                            {session.participants.length} participant{session.participants.length !== 1 ? 's' : ''} • Inactive
                          </span>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        Rejoin
                      </Badge>
                    </div>
                  </button>
                ))}
              </>
            )}

            {/* Create New Session Option */}
            <button
              onClick={() => {
                // This would open a dialog to create new session
                console.log('Create new collaboration session');
                setIsExpanded(false);
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
      </CardContent>
    </Card>
  );
};