import React, { useState } from 'react';
import { Plus, MoreVertical, Calendar, MapPin, Check, X, CalendarDays } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TripCardExpanded } from '@/components/TripCardExpanded';

const savedTrips = [
  {
    id: '1',
    title: 'Sunset Coffee at Waterfront',
    image: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085',
    cost: 25,
    duration: '1.5 hours',
    travelTime: '8 min walk',
    badges: ['Budget-Fit', 'Weather-OK', 'Verified'],
    whyItFits: 'Perfect timing for golden hour, cozy café with outdoor seating, within your budget',
    savedDate: '2024-01-15',
    location: 'Pike Place Market',
    category: 'Coffee & Walk',
    status: 'saved', // 'saved', 'accepted', 'declined'
    scheduledDate: null
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
    savedDate: '2024-01-14',
    location: 'Capitol Hill',
    category: 'Creative Date',
    status: 'accepted',
    scheduledDate: '2024-01-20'
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
    savedDate: '2024-01-13', 
    location: 'Belltown',
    category: 'Brunch',
    status: 'saved',
    scheduledDate: null
  }
];

const Saved = () => {
  const [selectedTrips, setSelectedTrips] = useState<string[]>([]);
  const [expandedTrip, setExpandedTrip] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [trips, setTrips] = useState(savedTrips);

  const handleAddToBoard = (tripId: string) => {
    // This would open board selection modal
    console.log('Add to board:', tripId);
  };

  const toggleSelection = (tripId: string) => {
    setSelectedTrips(prev => 
      prev.includes(tripId) 
        ? prev.filter(id => id !== tripId)
        : [...prev, tripId]
    );
  };

  const handleAcceptTrip = (tripId: string) => {
    setTrips(prev => prev.map(trip => 
      trip.id === tripId 
        ? { ...trip, status: 'accepted', scheduledDate: new Date().toISOString().split('T')[0] }
        : trip
    ));
  };

  const handleUnsaveTrip = (tripId: string) => {
    setTrips(prev => prev.filter(trip => trip.id !== tripId));
  };

  const expandedTripData = trips.find(trip => trip.id === expandedTrip);
  const acceptedTrips = trips.filter(trip => trip.status === 'accepted');

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="px-6 pt-12 pb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Saved</h1>
            <Button 
              variant="outline"
              size="sm" 
              onClick={() => console.log('Create board')}
            >
              <Plus className="h-4 w-4 mr-1" />
              Create Board
              {selectedTrips.length > 0 && ` (${selectedTrips.length})`}
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setViewMode(viewMode === 'list' ? 'calendar' : 'list')}
          >
            {viewMode === 'list' ? <CalendarDays className="h-4 w-4" /> : <MoreVertical className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-muted-foreground">
          {trips.length} experiences saved • {acceptedTrips.length} accepted
        </p>
      </div>

      {/* Calendar View */}
      {viewMode === 'calendar' && (
        <div className="px-6 space-y-4">
          <h2 className="text-lg font-semibold">Accepted Experiences</h2>
          {acceptedTrips.map((trip) => (
            <Card key={trip.id} className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Calendar className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-sm">{trip.title}</h3>
                  <p className="text-xs text-muted-foreground">
                    {trip.scheduledDate && new Date(trip.scheduledDate).toLocaleDateString()}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setExpandedTrip(trip.id)}>
                  View
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <div className="px-6 space-y-4">
          {trips.map((trip) => (
            <Card 
              key={trip.id} 
              className="overflow-hidden cursor-pointer hover:shadow-elevated transition-all"
              onClick={() => setExpandedTrip(trip.id)}
            >
              <div className="flex">
                {/* Image */}
                <div className="relative w-24 h-24 flex-shrink-0">
                  <img
                    src={trip.image}
                    alt={trip.title}
                    className="w-full h-full object-cover"
                  />
                  {trip.status === 'accepted' && (
                    <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                      <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                        <Check className="h-4 w-4 text-primary-foreground" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 p-4">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-sm line-clamp-1">{trip.title}</h3>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddToBoard(trip.id);
                      }}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </div>

                  {trip.status === 'accepted' && (
                    <Badge variant="default" className="text-xs mb-2 bg-primary/10 text-primary">
                      Scheduled for {trip.scheduledDate && new Date(trip.scheduledDate).toLocaleDateString()}
                    </Badge>
                  )}

                  <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
                    <span>${trip.cost} per person</span>
                    <span>{trip.duration}</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      <span>{trip.location}</span>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {trip.category}
                    </Badge>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-muted-foreground">
                      Saved {new Date(trip.savedDate).toLocaleDateString()}
                    </span>
                    <div className="flex gap-1">
                      {trip.status === 'saved' && (
                        <>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="text-xs h-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAcceptTrip(trip.id);
                            }}
                          >
                            <Check className="h-3 w-3 mr-1" />
                            Accept
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="text-xs h-7 bg-primary/10 text-primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              // Finalize trip - add to calendar and collaborators' calendars
                              setTrips(prev => prev.map(t => 
                                t.id === trip.id 
                                  ? { ...t, status: 'finalized', scheduledDate: new Date().toISOString().split('T')[0] }
                                  : t
                              ));
                            }}
                          >
                            ✅ Finalize
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="text-xs h-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUnsaveTrip(trip.id);
                            }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                      {trip.status === 'accepted' && (
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="text-xs h-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddToBoard(trip.id);
                          }}
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Add to Board
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Expanded Trip Card */}
      {expandedTripData && (
        <TripCardExpanded
          trip={expandedTripData}
          isOpen={!!expandedTrip}
          onClose={() => setExpandedTrip(null)}
          onAccept={() => {
            handleAcceptTrip(expandedTripData.id);
            setExpandedTrip(null);
          }}
          onAddToBoard={() => {
            setExpandedTrip(null);
            handleAddToBoard(expandedTripData.id);
          }}
          showAcceptButton={expandedTripData.status === 'saved'}
        />
      )}

      {/* Empty State */}
      {trips.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <Calendar className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No saved experiences yet</h3>
          <p className="text-muted-foreground mb-4">
            Start swiping right on experiences you love!
          </p>
          <Button className="bg-gradient-primary">
            Discover Experiences
          </Button>
        </div>
      )}

    </div>
  );
};

export default Saved;