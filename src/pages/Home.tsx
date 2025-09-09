import React, { useState } from 'react';
import { Sliders, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TripCard } from '@/components/TripCard';
import { PreferencesSheet } from '@/components/PreferencesSheet';
import { toast } from '@/hooks/use-toast';

// Mock data for demo
const mockTrips = [
  {
    id: '1',
    title: 'Sunset Coffee at Waterfront',
    image: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085',
    cost: 25,
    duration: '1.5 hours',
    travelTime: '8 min walk',
    badges: ['Budget-Fit', 'Weather-OK', 'Verified'],
    whyItFits: 'Perfect timing for golden hour, cozy café with outdoor seating, within your budget',
    location: 'Pike Place Market',
    category: 'Coffee & Walk'
  },
  {
    id: '2', 
    title: 'Interactive Art Experience',
    image: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96',
    cost: 45,
    duration: '2 hours',
    travelTime: '12 min drive',
    badges: ['Creative', 'Weather-OK'],
    whyItFits: 'Hands-on pottery class perfect for creative dates, includes materials and refreshments',
    location: 'Capitol Hill',
    category: 'Creative Date'
  },
  {
    id: '3',
    title: 'Rooftop Brunch & Views',
    image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0',
    cost: 65,
    duration: '2.5 hours', 
    travelTime: '15 min transit',
    badges: ['Weekend Special', 'Verified'],
    whyItFits: 'Amazing city views, bottomless mimosas, perfect weekend vibes',
    location: 'Belltown',
    category: 'Brunch'
  }
];

const Home = () => {
  const [currentTripIndex, setCurrentTripIndex] = useState(0);
  const [showPreferences, setShowPreferences] = useState(false);
  const [trips, setTrips] = useState(mockTrips);

  const currentTrip = trips[currentTripIndex];

  const handleSwipeRight = () => {
    toast({
      title: "Saved!",
      description: `${currentTrip.title} added to your saved list`,
    });
    nextTrip();
  };

  const handleSwipeLeft = () => {
    toast({
      title: "Dismissed",
      description: "Looking for more options...",
    });
    nextTrip();
  };

  const nextTrip = () => {
    if (currentTripIndex < trips.length - 1) {
      setCurrentTripIndex(prev => prev + 1);
    } else {
      // Reset to first trip for demo
      setCurrentTripIndex(0);
    }
  };

  const handleExpand = () => {
    // This would open the expanded card view
    toast({
      title: "Trip Details",
      description: "Expanded view would open here",
    });
  };

  const refreshTrips = () => {
    // Shuffle trips for demo
    const shuffled = [...trips].sort(() => Math.random() - 0.5);
    setTrips(shuffled);
    setCurrentTripIndex(0);
    toast({
      title: "Fresh recommendations!",
      description: "Found new activities based on your preferences",
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-accent/10">
      {/* Header */}
      <div className="px-6 pt-12 pb-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Hey there! 👋
            </h1>
            <p className="text-muted-foreground">
              Ready for your next adventure?
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPreferences(true)}
            className="flex items-center gap-2"
          >
            <Sliders className="h-4 w-4" />
          </Button>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-6">
          <span>💰 Under $50</span>
          <span>•</span>
          <span>☀️ Weather OK</span>
          <span>•</span>
          <span>🚶‍♀️ Walking distance</span>
        </div>
      </div>

      {/* Trip Cards Stack */}
      <div className="px-6 relative">
        <div className="relative h-[500px]">
          {/* Background cards for stack effect */}
          {trips.slice(currentTripIndex + 1, currentTripIndex + 3).map((trip, index) => (
            <div
              key={trip.id}
              className="absolute inset-0"
              style={{
                transform: `translateY(${(index + 1) * 8}px) scale(${1 - (index + 1) * 0.02})`,
                zIndex: 10 - index,
                opacity: 0.7 - index * 0.2
              }}
            >
              <TripCard
                trip={trip}
                onSwipeRight={() => {}}
                onSwipeLeft={() => {}}
                onExpand={() => {}}
                className="pointer-events-none"
              />
            </div>
          ))}

          {/* Current active card */}
          {currentTrip && (
            <div className="absolute inset-0 z-20">
              <TripCard
                trip={currentTrip}
                onSwipeRight={handleSwipeRight}
                onSwipeLeft={handleSwipeLeft}
                onExpand={handleExpand}
                className="animate-bounce-in"
              />
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-center gap-4 mt-8">
          <Button
            variant="outline"
            size="lg"
            onClick={handleSwipeLeft}
            className="rounded-full h-14 w-14"
          >
            ✕
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={refreshTrips}
            className="flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            More
          </Button>
          <Button
            size="lg"
            onClick={handleSwipeRight}
            className="rounded-full h-14 w-14 bg-gradient-primary"
          >
            ♥
          </Button>
        </div>

        {/* Trip Counter */}
        <div className="text-center mt-6">
          <p className="text-sm text-muted-foreground">
            Trip {currentTripIndex + 1} of {trips.length}
          </p>
        </div>
      </div>

      {/* Preferences Sheet */}
      <PreferencesSheet 
        isOpen={showPreferences}
        onClose={() => setShowPreferences(false)}
      />
    </div>
  );
};

export default Home;