import React from 'react';
import { X, MapPin, Clock, DollarSign, Calendar, ExternalLink, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useUserProfile } from '@/hooks/useUserProfile';
import { formatCurrency } from '@/utils/currency';

interface TripCardExpandedProps {
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
  };
  isOpen: boolean;
  onClose: () => void;
  onAccept?: () => void;
  onAddToBoard?: () => void;
  showAcceptButton?: boolean;
}

const timeline = [
  { time: '6:00 PM', activity: 'Meet at Pike Place Market', icon: '📍', duration: '5 min' },
  { time: '6:05 PM', activity: 'Walk to waterfront café', icon: '🚶‍♀️', duration: '8 min' },
  { time: '6:15 PM', activity: 'Coffee & sunset viewing', icon: '☕', duration: '1.5 hours' },
  { time: '7:45 PM', activity: 'Optional: Walk to pier', icon: '🌅', duration: '15 min' }
];

export const TripCardExpanded = ({ 
  trip, 
  isOpen, 
  onClose, 
  onAccept, 
  onAddToBoard,
  showAcceptButton = false 
}: TripCardExpandedProps) => {
  const { profile } = useUserProfile();
  
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card w-full max-w-md max-h-[90vh] rounded-2xl overflow-hidden animate-scale-in">
        {/* Header Image */}
        <div className="relative h-64">
          <img 
            src={trip.image} 
            alt={trip.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          
          {/* Close Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="absolute top-4 right-4 bg-black/50 hover:bg-black/70 text-white"
          >
            <X className="h-4 w-4" />
          </Button>

          {/* Category Badge */}
          <div className="absolute top-4 left-4">
            <Badge variant="secondary" className="bg-white/90 text-black">
              {trip.category}
            </Badge>
          </div>

          {/* Title and Basic Info */}
          <div className="absolute bottom-4 left-4 right-4">
            <h2 className="text-xl font-bold text-white mb-2">{trip.title}</h2>
            <div className="flex items-center gap-4 text-sm text-white/90">
              <div className="flex items-center gap-1">
                <DollarSign className="h-4 w-4" />
                <span>{formatCurrency(trip.cost, profile?.currency || 'USD')} per person</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                <span>{trip.duration}</span>
              </div>
              <div className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                <span>{trip.travelTime}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6 max-h-[50vh] overflow-y-auto">
          {/* Why It Fits */}
          <div>
            <h3 className="font-semibold mb-2 text-accent">Why this fits</h3>
            <p className="text-sm text-muted-foreground">{trip.whyItFits}</p>
          </div>

          {/* Badges */}
          <div>
            <h3 className="font-semibold mb-2">Perfect for</h3>
            <div className="flex flex-wrap gap-2">
              {trip.badges.map((badge) => (
                <Badge key={badge} variant="outline" className="text-xs">
                  {badge}
                </Badge>
              ))}
            </div>
          </div>

          {/* Plan B Toggle */}
          <Card className="p-4 bg-muted/30">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h4 className="font-semibold text-sm">Plan B Option</h4>
                <p className="text-xs text-muted-foreground">Indoor alternative if weather changes</p>
              </div>
              <Switch />
            </div>
          </Card>

          {/* Timeline */}
          <div>
            <h3 className="font-semibold mb-3">Trip Timeline</h3>
            <div className="space-y-3">
              {timeline.map((step, index) => (
                <div key={index} className="flex items-start gap-3">
                  <div className="flex items-center justify-center w-8 h-8 bg-primary/10 rounded-full flex-shrink-0">
                    <span className="text-sm">{step.icon}</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{step.time}</span>
                      <span className="text-xs text-muted-foreground">{step.duration}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{step.activity}</p>
                  </div>
                  {index < timeline.length - 1 && (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Map Preview */}
          <Card className="p-4 bg-gradient-cool/10">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-semibold text-sm mb-1">Route Preview</h4>
                <p className="text-xs text-muted-foreground">
                  📍 Start → ☕ Café → 🌅 Waterfront
                </p>
              </div>
              <Button variant="outline" size="sm">
                <ExternalLink className="h-3 w-3 mr-1" />
                Maps
              </Button>
            </div>
          </Card>
        </div>

        {/* Action Buttons */}
        <div className="p-6 border-t border-border">
          <div className="flex gap-3">
            {showAcceptButton && onAccept && (
              <Button 
                className="flex-1 bg-gradient-primary"
                onClick={onAccept}
              >
                <Calendar className="h-4 w-4 mr-2" />
                Accept & Add to Calendar
              </Button>
            )}
            {onAddToBoard && (
              <Button 
                variant="outline" 
                className={showAcceptButton ? "" : "flex-1"}
                onClick={onAddToBoard}
              >
                Add to Board
              </Button>
            )}
            <Button variant="outline" size="sm">
              <ExternalLink className="h-4 w-4 mr-1" />
              Book Now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};