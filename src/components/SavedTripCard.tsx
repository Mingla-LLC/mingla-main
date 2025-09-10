import React from 'react';
import { Check, Plus, Trash2, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TripCard } from '@/components/TripCard';

interface SavedTripCardProps {
  trip: {
    id: string;
    title: string;
    image: string;
    cost: number;
    duration: string;
    travelTime: string;
    badges: string[];
    whyItFits: string;
    location: string;
    category: string;
    status: string;
    scheduledDate?: string | null;
    savedDate?: string;
  };
  onFinalize: (tripId: string) => void;
  onAddToBoard: (tripId: string) => void;
  onDelete: (tripId: string) => void;
  onExpand: (tripId: string) => void;
  onRevoke?: (tripId: string) => void;
}

export const SavedTripCard = ({ 
  trip, 
  onFinalize, 
  onAddToBoard, 
  onDelete, 
  onExpand, 
  onRevoke 
}: SavedTripCardProps) => {
  return (
    <div className="relative">
      <Card className="p-0 overflow-hidden">
        <TripCard
          trip={trip}
          onSwipeRight={() => {}}
          onSwipeLeft={() => {}}
          onExpand={() => onExpand(trip.id)}
          className="cursor-pointer hover:shadow-elevated transition-all border-0"
          disableSwipe={true}
        />
        
        {/* Action Section */}
        <div className="p-4 border-t border-border bg-muted/30">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {trip.status === 'accepted' && (
                <Badge 
                  variant="default"
                  className="bg-primary/10 text-primary border-primary/20"
                >
                  <Calendar className="h-3 w-3 mr-1" />
                  Finalized
                </Badge>
              )}
              {trip.status === 'saved' && (
                <Badge 
                  variant="outline"
                  className="text-muted-foreground border-border/50"
                >
                  Saved Experience
                </Badge>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Add to Board Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAddToBoard(trip.id)}
              className="h-7 text-xs px-3 bg-primary/5 hover:bg-primary/10 text-foreground border-border hover:border-primary/30 hover:text-primary"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add to Board
            </Button>
            
            {/* Finalize / Revoke Button */}
            {trip.status === 'saved' ? (
              <Button
                variant="default"
                size="sm"
                onClick={() => onFinalize(trip.id)}
                className="h-7 text-xs px-3 bg-primary/10 hover:bg-primary/20 text-primary border-primary/20"
              >
                <Check className="h-3 w-3 mr-1" />
                Finalize
              </Button>
            ) : (
              onRevoke && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRevoke(trip.id)}
                  className="h-7 text-xs px-3 hover:bg-destructive/10 hover:text-destructive border-border/50"
                >
                  Revoke
                </Button>
              )
            )}
            
            {/* Delete Button */}
            <Button
              variant="outline" 
              size="sm"
              onClick={() => onDelete(trip.id)}
              className="h-7 text-xs px-3 hover:bg-destructive/10 hover:text-destructive border-border/50 ml-auto"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Delete
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};