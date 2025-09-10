import React, { useState } from 'react';
import { Plus, MoreVertical, Calendar, MapPin, Check, X, CalendarDays, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TripCardExpanded } from '@/components/TripCardExpanded';
import { BoardSelectionDialog } from '@/components/BoardSelectionDialog';
import { NewBoardDialog } from '@/components/NewBoardDialog';

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
  const [isBoardSelectionOpen, setIsBoardSelectionOpen] = useState(false);
  const [isNewBoardDialogOpen, setIsNewBoardDialogOpen] = useState(false);
  const [selectedTripForBoard, setSelectedTripForBoard] = useState<string | null>(null);
  const [boards, setBoards] = useState([
    {
      id: '1',
      title: 'Weekend Adventures',
      description: 'Fun activities for Saturday & Sunday',
      tripCount: 5,
      collaborators: [
        { id: '1', name: 'Sarah', avatar: 'https://images.unsplash.com/photo-1494790108755-2616b79444d7', initials: 'S' },
        { id: '2', name: 'Mike', avatar: '', initials: 'M' },
      ],
      cover: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4'
    },
    {
      id: '2',
      title: 'Date Night Ideas',
      description: 'Romantic spots around the city',
      tripCount: 3,
      collaborators: [
        { id: '3', name: 'Alex', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d', initials: 'A' },
      ],
      cover: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0'
    }
  ]);

  const handleAddToBoard = (tripId: string) => {
    setSelectedTripForBoard(tripId);
    setIsBoardSelectionOpen(true);
  };

  const handleCreateNewBoard = (boardData: {
    title: string;
    description: string;
    collaborators: string[];
    cover?: string;
  }) => {
    const newBoard = {
      id: Date.now().toString(),
      title: boardData.title,
      description: boardData.description,
      tripCount: selectedTripForBoard ? 1 : 0,
      collaborators: boardData.collaborators.map((username, index) => ({
        id: `collab-${Date.now()}-${index}`,
        name: username,
        avatar: '',
        initials: username.charAt(0).toUpperCase()
      })),
      cover: boardData.cover || 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4'
    };
    setBoards(prev => [newBoard, ...prev]);
    
    if (selectedTripForBoard) {
      console.log(`Added trip ${selectedTripForBoard} to new board ${newBoard.title}`);
    }
  };

  const handleSelectBoard = (boardId: string) => {
    if (selectedTripForBoard) {
      console.log(`Added trip ${selectedTripForBoard} to board ${boardId}`);
      setBoards(prev => prev.map(board => 
        board.id === boardId 
          ? { ...board, tripCount: board.tripCount + 1 }
          : board
      ));
    }
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

  const handleRevokeTrip = (tripId: string) => {
    setTrips(prev => prev.map(trip => 
      trip.id === tripId 
        ? { ...trip, status: 'saved', scheduledDate: null }
        : trip
    ));
  };

  const handleRemoveTrip = (tripId: string) => {
    setTrips(prev => prev.filter(trip => trip.id !== tripId));
  };

  const expandedTripData = trips.find(trip => trip.id === expandedTrip);
  const acceptedTrips = trips.filter(trip => trip.status === 'accepted');
  const activeSavedTrips = trips.filter(trip => trip.status === 'saved');

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="px-6 pt-12 pb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold">Saved</h1>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setViewMode(viewMode === 'list' ? 'calendar' : 'list')}
          >
            {viewMode === 'list' ? <CalendarDays className="h-4 w-4" /> : <MoreVertical className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-muted-foreground">
          {activeSavedTrips.length} experiences saved • {acceptedTrips.length} accepted
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
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setExpandedTrip(trip.id)}
                  >
                    View
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => handleRevokeTrip(trip.id)}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Revoke
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <div className="px-6 space-y-4">
          {activeSavedTrips.map((trip) => (
            <Card 
              key={trip.id} 
              className="overflow-hidden cursor-pointer hover:shadow-lg transition-all duration-200 border border-border/50"
              onClick={() => setExpandedTrip(trip.id)}
            >
              <div className="flex">
                {/* Image */}
                <div className="relative w-20 h-20 flex-shrink-0">
                  <img
                    src={trip.image}
                    alt={trip.title}
                    className="w-full h-full object-cover rounded-l-lg"
                  />
                  {trip.status === 'accepted' && (
                    <div className="absolute inset-0 bg-primary/20 flex items-center justify-center rounded-l-lg">
                      <div className="w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                        <Check className="h-3 w-3 text-primary-foreground" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 p-3">
                  <div className="flex items-start justify-between mb-1">
                    <h3 className="font-semibold text-sm leading-tight line-clamp-1">{trip.title}</h3>
                  </div>

                  {trip.status === 'accepted' && (
                    <Badge variant="default" className="text-xs mb-2 bg-primary/10 text-primary border-0">
                      Finalized
                    </Badge>
                  )}

                  <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
                    <span className="font-medium">${trip.cost}</span>
                    <span>{trip.duration}</span>
                  </div>

                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      <span className="truncate">{trip.location}</span>
                    </div>
                    <Badge variant="outline" className="text-xs border-border/50">
                      {trip.category}
                    </Badge>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {new Date(trip.savedDate).toLocaleDateString()}
                    </span>
                    <div className="flex gap-1">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-xs h-6 px-2 hover:bg-muted"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddToBoard(trip.id);
                        }}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                      
                      {trip.status === 'saved' ? (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-xs h-6 px-2 hover:bg-primary/10 hover:text-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAcceptTrip(trip.id);
                          }}
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                      ) : (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-xs h-6 px-2 hover:bg-destructive/10 hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRevokeTrip(trip.id);
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                      
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-xs h-6 px-2 hover:bg-destructive/10 hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveTrip(trip.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
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

      {/* Board Selection Dialog */}
      <BoardSelectionDialog
        isOpen={isBoardSelectionOpen}
        onClose={() => {
          setIsBoardSelectionOpen(false);
          setSelectedTripForBoard(null);
        }}
        onSelectBoard={handleSelectBoard}
        onCreateNewBoard={() => {
          setIsBoardSelectionOpen(false);
          setIsNewBoardDialogOpen(true);
        }}
        boards={boards}
        tripTitle={trips.find(t => t.id === selectedTripForBoard)?.title || ''}
      />

      {/* New Board Dialog */}
      <NewBoardDialog
        isOpen={isNewBoardDialogOpen}
        onClose={() => {
          setIsNewBoardDialogOpen(false);
          setSelectedTripForBoard(null);
        }}
        onCreateBoard={handleCreateNewBoard}
      />

      {/* Empty State */}
      {activeSavedTrips.length === 0 && acceptedTrips.length === 0 && (
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