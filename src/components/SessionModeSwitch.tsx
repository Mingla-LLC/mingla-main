import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Users, User, Crown, Plus, Check } from 'lucide-react';
import { CreateSessionDialog } from '@/components/CreateSessionDialog';
import type { CollaborationSession } from '@/hooks/useSessionManagement';

interface SessionModeSwitchProps {
  currentSession: CollaborationSession | null;
  availableSessions: CollaborationSession[];
  isInSolo: boolean;
  onSwitchToSolo: () => void;
  onSwitchToCollaborative: (sessionId: string) => void;
  onCreateSession: (participants: string[], sessionName: string) => Promise<void>;
  loading?: boolean;
}

export const SessionModeSwitch: React.FC<SessionModeSwitchProps> = ({
  currentSession,
  availableSessions,
  isInSolo,
  onSwitchToSolo,
  onSwitchToCollaborative,
  onCreateSession,
  loading = false
}) => {
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const activeSessions = availableSessions.filter(s => s.status === 'active');
  const waitingSessions = availableSessions.filter(s => s.status === 'dormant');

  return (
    <>
      <Card className="w-full bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-lg">Session Mode</h3>
            <Badge variant={isInSolo ? "secondary" : "default"} className="px-3">
              {isInSolo ? (
                <>
                  <User className="h-3 w-3 mr-1" />
                  Solo
                </>
              ) : (
                <>
                  <Users className="h-3 w-3 mr-1" />
                  Collaborative
                </>
              )}
            </Badge>
          </div>

          {/* Current Session Display */}
          {currentSession && (
            <div className="mb-4 p-3 rounded-lg bg-primary/10 border border-primary/20">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center">
                  <Crown className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">{currentSession.name}</p>
                  <p className="text-xs text-muted-foreground">Active collaboration</p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex -space-x-1">
                  {currentSession.participants.map((participant) => (
                    <Avatar key={participant.id} className="h-6 w-6 border-2 border-background">
                      <AvatarImage src={participant.avatar} />
                      <AvatarFallback className="text-xs bg-primary/20 text-primary">
                        {participant.name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onSwitchToSolo}
                  disabled={loading}
                >
                  Leave Session
                </Button>
              </div>
            </div>
          )}

          {/* Solo Mode Toggle */}
          {isInSolo && (
            <div className="mb-4 p-3 rounded-lg bg-muted/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Solo exploration mode</span>
                </div>
                <Badge variant="secondary" className="text-xs">
                  <Check className="h-3 w-3 mr-1" />
                  Active
                </Badge>
              </div>
            </div>
          )}

          {/* Available Sessions */}
          {activeSessions.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-medium mb-2">Active Collaborations</h4>
              <div className="space-y-2">
                {activeSessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-background/50 border border-accent/10 cursor-pointer hover:bg-background/80 transition-colors"
                    onClick={() => onSwitchToCollaborative(session.id)}
                  >
                    <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                      <Users className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-sm">{session.name}</p>
                      <div className="flex items-center gap-2">
                        <div className="flex -space-x-1">
                          {session.participants.slice(0, 3).map((participant) => (
                            <Avatar key={participant.id} className="h-5 w-5 border border-background">
                              <AvatarImage src={participant.avatar} />
                              <AvatarFallback className="text-xs bg-muted">
                                {participant.name.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                          ))}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {session.participants.length} collaborators
                        </span>
                      </div>
                    </div>
                    <Badge variant="default" className="text-xs">
                      Join
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Waiting Sessions */}
          {waitingSessions.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-medium mb-2">Waiting for Others</h4>
              <div className="space-y-2">
                {waitingSessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-background/30 border border-accent/5"
                  >
                    <div className="w-8 h-8 bg-muted/50 rounded-full flex items-center justify-center">
                      <Users className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-sm text-muted-foreground">{session.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {session.participants.filter(p => p.hasAccepted).length}/{session.participants.length} accepted
                      </p>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      Waiting
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Create New Session */}
          <Button
            onClick={() => setShowCreateDialog(true)}
            disabled={loading}
            className="w-full bg-primary hover:bg-primary/90"
          >
            <Plus className="h-4 w-4 mr-2" />
            Start New Collaboration
          </Button>
        </CardContent>
      </Card>

      <CreateSessionDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
      />
    </>
  );
};