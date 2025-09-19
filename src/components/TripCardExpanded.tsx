import React, { useState, useMemo } from 'react';
import { X, MapPin, Clock, DollarSign, Calendar, ExternalLink, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useGeolocation } from '@/hooks/useGeolocation';
import { formatCurrency } from '@/utils/currency';
import { PlanBCard } from './PlanBCard';
import { MapTimeline } from './MapTimeline';
import { generateWhyItFits, generatePerfectFor, generatePlanBOptions } from '@/utils/preferences';
import { generateRealTimeline } from '@/utils/timeline';

interface TripCardExpandedProps {
  trip: {
    id: string;
    title: string;
    image: string;
    cost: number;
    duration: string;
    travelTime?: string;
    badges: string[];
    whyItFits?: string;
    location: string;
    city?: string;
    category: string;
    perfectFor?: string[];
    experienceType?: string;
    // Additional fields for rich data
    lat?: number;
    lng?: number;
    latitude?: number;
    longitude?: number;
    address?: string;
  };
  preferences?: {
    budgetRange?: [number, number];
    categories?: string[];
    experienceTypes?: string[];
    time?: string;
    travel?: string;
    travelConstraint?: 'time' | 'distance';
    travelTime?: number;
    travelDistance?: number;
    location?: string;
    customLocation?: string;
    custom_lat?: number | null;
    custom_lng?: number | null;
    groupSize?: number;
    [key: string]: any;
  };
  isOpen: boolean;
  onClose: () => void;
  onAccept?: () => void;
  onAddToBoard?: () => void;
  showAcceptButton?: boolean;
}

// Timeline will be generated dynamically

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
  const { latitude, longitude } = useGeolocation();
  const [showPlanB, setShowPlanB] = useState(false);
  const [selectedPlanB, setSelectedPlanB] = useState<any>(null);

  // Generate dynamic content based on preferences and location
  const tripContext = useMemo(() => {
    if (!trip) return null;
    
    return {
      category: trip.category,
      cost: trip.cost,
      location: trip.location,
      duration: trip.duration,
      isIndoor: trip.category.toLowerCase().includes('indoor'),
      isOutdoor: trip.category.toLowerCase().includes('outdoor'),
      hasFood: trip.category.toLowerCase().includes('food') || trip.category.toLowerCase().includes('dining')
    };
  }, [trip]);

  const whyItFits = useMemo(() => {
    if (!tripContext) return '';
    return generateWhyItFits(preferences || {}, tripContext);
  }, [preferences, tripContext]);

  const perfectFor = useMemo(() => {
    if (!tripContext) return [];
    return generatePerfectFor(tripContext, preferences);
  }, [tripContext, preferences]);

  const planBOptions = useMemo(() => {
    if (!tripContext) return [];
    return generatePlanBOptions(tripContext, preferences);
  }, [tripContext, preferences]);

  const activeTrip = selectedPlanB || trip;

  // Generate real timeline based on user location and destination
  const timelineSteps = useMemo(() => {
    const tripLat = activeTrip.lat || activeTrip.latitude || trip.lat || trip.latitude;
    const tripLng = activeTrip.lng || activeTrip.longitude || trip.lng || trip.longitude;

    // If we have both user location and destination coordinates, generate real timeline
    if (latitude && longitude && tripLat && tripLng) {
      return generateRealTimeline(
        { lat: latitude, lng: longitude, name: 'Your location' },
        { lat: tripLat, lng: tripLng, name: activeTrip.title },
        activeTrip.duration,
        activeTrip.category,
        {
          time: preferences?.time,
          travel: preferences?.travel,
          specificTime: preferences?.specificTime,
          customDate: preferences?.customDate
        }
      );
    }

    // Fallback timeline with better default times
    const now = new Date();
    const startTime = new Date(now.getTime() + 30 * 60000); // 30 min from now
    const fallbackLat = tripLat || 40.7505;
    const fallbackLng = tripLng || -73.9934;
    
    return [
      { 
        time: startTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        activity: 'Arrive at venue', 
        location: { lat: fallbackLat, lng: fallbackLng }, 
        icon: '📍', 
        duration: '5 min' 
      },
      { 
        time: new Date(startTime.getTime() + 5 * 60000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        activity: `Enjoy ${trip.category.toLowerCase()}`, 
        location: { lat: fallbackLat, lng: fallbackLng }, 
        icon: '✨', 
        duration: trip.duration 
      },
      { 
        time: new Date(startTime.getTime() + 125 * 60000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        activity: 'Wrap up & photos', 
        location: { lat: fallbackLat, lng: fallbackLng }, 
        icon: '📸', 
        duration: '15 min' 
      },
    ];
  }, [latitude, longitude, trip, activeTrip, preferences]);

  // Handle Plan B selection
  const handlePlanBSelect = (planBTrip: any) => {
    setSelectedPlanB({
      ...trip,
      ...planBTrip,
      title: `${trip.title} - ${planBTrip.category}`,
      id: trip.id + '_planb'
    });
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
  
  if (!isOpen || !trip) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card w-full max-w-md max-h-[95vh] rounded-2xl overflow-hidden animate-scale-in flex flex-col">
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
            <h2 className="text-xl font-bold text-white mb-1">{trip.title}</h2>
            {trip.city && (
              <p className="text-sm text-white/80 mb-2 font-medium">{trip.city}</p>
            )}
            <div className="flex items-center gap-4 text-sm text-white/90">
              <div className="flex items-center gap-1">
                <span>{formatCurrency(trip.cost, profile?.currency || 'USD')} per person</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                <span>{trip.duration}</span>
              </div>
              {trip.travelTime && (
                <div className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  <span>{trip.travelTime}</span>
                </div>
              )}
              {(trip.lat || trip.latitude) && (trip.lng || trip.longitude) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-white/90 hover:bg-white/20"
                  onClick={(e) => {
                    e.stopPropagation();
                    const lat = trip.lat || trip.latitude;
                    const lng = trip.lng || trip.longitude;
                    window.open(`https://maps.google.com/maps?q=${lat},${lng}`, '_blank');
                  }}
                >
                  🗺️
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 space-y-4 flex-1 overflow-y-auto">
          {/* Why It Fits */}
          <div>
            <h3 className="font-semibold mb-2 text-accent">Why this fits</h3>
            <p className="text-sm text-muted-foreground">{whyItFits}</p>
          </div>

          {/* Perfect For */}
          <div>
            <h3 className="font-semibold mb-2">Perfect for</h3>
            <div className="flex flex-wrap gap-2">
              {perfectFor.map((item, index) => (
                <Badge key={index} variant="outline" className="text-xs">
                  {item}
                </Badge>
              ))}
            </div>
          </div>

          {/* Plan B Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-semibold">Plan B</h4>
                <p className="text-sm text-muted-foreground">Alternative options</p>
              </div>
              <Switch 
                checked={showPlanB} 
                onCheckedChange={setShowPlanB}
                className="data-[state=checked]:bg-primary"
              />
            </div>
            
            {showPlanB && (
              <div className="space-y-3">
                {planBOptions.map((option, index) => (
                  <PlanBCard
                    key={index}
                    trip={{
                      id: `${trip.id}_planb_${index}`,
                      title: option.location.replace(trip.location + " - ", ""),
                      image: trip.image,
                      cost: option.cost,
                      duration: option.duration,
                      location: option.location,
                      category: option.category,
                      badges: trip.badges
                    }}
                    onSelect={() => handlePlanBSelect(option)}
                    currency={profile?.currency || 'USD'}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Interactive Timeline */}
          <div>
            <h3 className="font-semibold mb-3">Trip Timeline & Route</h3>
            <MapTimeline 
              steps={timelineSteps}
              userLocation={latitude && longitude ? { lat: latitude, lng: longitude } : undefined}
              className="h-64"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-4 border-t border-border flex-shrink-0">
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