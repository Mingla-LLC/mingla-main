import React, { useState } from 'react';
import { X, MapPin, Clock, DollarSign, Calendar, ExternalLink, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useUserProfile } from '@/hooks/useUserProfile';
import { formatCurrency } from '@/utils/currency';
import { PlanBCard } from './PlanBCard';
import { MapTimeline } from './MapTimeline';

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
    perfectFor?: string[];
    experienceType?: string;
  };
  preferences?: {
    experienceTypes?: string[];
    selectedCategories?: string[];
  };
  isOpen: boolean;
  onClose: () => void;
  onAccept?: () => void;
  onAddToBoard?: () => void;
  showAcceptButton?: boolean;
}

const timelineSteps = [
  { 
    time: '6:00 PM', 
    activity: 'Meet at Pike Place Market', 
    icon: '📍', 
    duration: '5 min',
    location: { lat: 47.6097, lng: -122.3331 }
  },
  { 
    time: '6:05 PM', 
    activity: 'Walk to waterfront café', 
    icon: '🚶‍♀️', 
    duration: '8 min',
    location: { lat: 47.6062, lng: -122.3321 }
  },
  { 
    time: '6:15 PM', 
    activity: 'Coffee & sunset viewing', 
    icon: '☕', 
    duration: '1.5 hours',
    location: { lat: 47.6048, lng: -122.3400 }
  },
  { 
    time: '7:45 PM', 
    activity: 'Optional: Walk to pier', 
    icon: '🌅', 
    duration: '15 min',
    location: { lat: 47.6040, lng: -122.3420 }
  }
];

export const TripCardExpanded = ({ 
  trip, 
  preferences,
  isOpen, 
  onClose, 
  onAccept, 
  onAddToBoard,
  showAcceptButton = false 
}: TripCardExpandedProps) => {
  const { profile } = useUserProfile();
  const [showPlanB, setShowPlanB] = useState(false);

  // Generate Plan B alternative
  const planBTrip = {
    id: trip.id + '_planb',
    title: `Indoor ${trip.category} Experience`,
    image: trip.image,
    cost: trip.cost * 0.8, // Slightly cheaper
    duration: trip.duration,
    location: trip.location,
    category: trip.category,
    badges: ['Indoor', 'Weather-proof', ...trip.badges.slice(0, 2)]
  };

  // Generate "Perfect for" based on preferences
  const generatePerfectFor = () => {
    if (!preferences?.experienceTypes?.length) return trip.badges;
    
    return preferences.experienceTypes.map(type => {
      switch (type) {
        case 'First Date':
          return 'First dates';
        case 'Romantic':
          return 'Romantic moments';
        case 'Friendly':
          return 'Friend hangouts';
        case 'Solo Adventure':
          return 'Solo exploration';
        case 'Group Fun':
          return 'Group activities';
        case 'Business':
          return 'Professional meetings';
        default:
          return type;
      }
    });
  };

  // Generate contextual "Why this fits"
  const generateWhyItFits = () => {
    if (!preferences?.experienceTypes?.length && !preferences?.selectedCategories?.length) {
      return trip.whyItFits;
    }

    const experienceContext = preferences.experienceTypes?.join(', ') || '';
    const categoryContext = preferences.selectedCategories?.join(', ') || '';
    
    return `Perfect for ${experienceContext}${experienceContext && categoryContext ? ' with a focus on ' : ''}${categoryContext}. This experience matches your preferences for authentic local activities that create meaningful connections.`;
  };

  const handleAddToCalendar = () => {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 1); // Tomorrow
    startDate.setHours(18, 0); // 6 PM
    
    const endDate = new Date(startDate);
    const duration = parseInt(trip.duration.split(' ')[0]) || 120;
    endDate.setMinutes(endDate.getMinutes() + duration);
    
    const event = {
      title: trip.title,
      start: startDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
      end: endDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
      details: trip.whyItFits,
      location: trip.location
    };
    
    const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(event.title)}&dates=${event.start}/${event.end}&details=${encodeURIComponent(event.details)}&location=${encodeURIComponent(event.location)}`;
    
    window.open(calendarUrl, '_blank');
    if (onAccept) onAccept();
  };
  
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
            <p className="text-sm text-muted-foreground">{generateWhyItFits()}</p>
          </div>

          {/* Perfect For */}
          <div>
            <h3 className="font-semibold mb-2">Perfect for</h3>
            <div className="flex flex-wrap gap-2">
              {generatePerfectFor().map((item) => (
                <Badge key={item} variant="outline" className="text-xs">
                  {item}
                </Badge>
              ))}
            </div>
          </div>

          {/* Plan B Toggle */}
          <div className="space-y-3">
            <Card className="p-4 bg-muted/30">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h4 className="font-semibold text-sm">Plan B Option</h4>
                  <p className="text-xs text-muted-foreground">Indoor alternative if weather changes</p>
                </div>
                <Switch 
                  checked={showPlanB}
                  onCheckedChange={setShowPlanB}
                />
              </div>
            </Card>
            
            {showPlanB && (
              <PlanBCard 
                trip={planBTrip}
                currency={profile?.currency || 'USD'}
                onSelect={() => {
                  // Handle plan B selection
                  console.log('Selected Plan B');
                }}
              />
            )}
          </div>

          {/* Interactive Timeline */}
          <div>
            <h3 className="font-semibold mb-3">Trip Timeline & Route</h3>
            <MapTimeline 
              steps={timelineSteps}
              userLocation={{ lat: 47.6205, lng: -122.3493 }} // Example user location
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-6 border-t border-border">
          <div className="flex gap-3">
            {showAcceptButton && (
              <Button 
                className="flex-1 bg-gradient-primary"
                onClick={handleAddToCalendar}
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