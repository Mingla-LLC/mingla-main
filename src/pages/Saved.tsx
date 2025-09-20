import React, { useState } from 'react';
import { Plus, MoreVertical, Calendar, MapPin, Check, X, CalendarDays, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TripCardExpanded } from '@/components/TripCardExpanded';
import { BoardSelectionDialog } from '@/components/BoardSelectionDialog';
import { NewBoardDialog } from '@/components/NewBoardDialog';
import { SavedTripCard } from '@/components/SavedTripCard';
import { useSavedExperiences } from '@/hooks/useSavedExperiences';
import { Skeleton } from '@/components/ui/skeleton';

const Saved = () => {
  const [selectedTrips, setSelectedTrips] = useState<string[]>([]);
  const [expandedTrip, setExpandedTrip] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [isBoardSelectionOpen, setIsBoardSelectionOpen] = useState(false);
  const [isNewBoardDialogOpen, setIsNewBoardDialogOpen] = useState(false);
  const [selectedTripForBoard, setSelectedTripForBoard] = useState<string | null>(null);
  const [boards, setBoards] = useState<any[]>([]); // Will be loaded from real boards

  // Use the saved experiences hook
  const { 
    savedExperiences, 
    loading, 
    error, 
    savedCount, 
    acceptedCount,
    updateExperienceStatus,
    deleteSavedExperience
  } = useSavedExperiences();

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

  const handleAcceptTrip = async (tripId: string) => {
    const today = new Date().toISOString().split('T')[0];
    await updateExperienceStatus(tripId, 'accepted', today);
  };

  const handleRevokeTrip = async (tripId: string) => {
    await updateExperienceStatus(tripId, 'saved');
  };

  const handleRemoveTrip = async (tripId: string) => {
    await deleteSavedExperience(tripId);
  };

  const expandedTripData = savedExperiences.find(trip => trip.id === expandedTrip);
  const acceptedTrips = savedExperiences.filter(trip => trip.status === 'accepted');
  const activeSavedTrips = savedExperiences.filter(trip => trip.status === 'saved');

  // Transform saved experience to trip format for compatibility
  const transformExperienceToTrip = (exp: any) => ({
    id: exp.id,
    title: exp.title,
    image: exp.image_url || '/api/placeholder/400/225',
    cost: exp.estimated_cost_per_person || 0,
    duration: `${exp.duration_minutes || 90} min`,
    travelTime: exp.eta_minutes ? `${exp.eta_minutes} min` : '15 min',
    badges: [
      exp.category?.replace('_', ' & ') || 'Experience',
      `${'$'.repeat(exp.price_level || 1)}`,
    ],
    whyItFits: exp.one_liner || 'Great local experience',
    location: exp.address || 'Address available',
    city: exp.address ? exp.address.split(',')[1]?.trim() : undefined,
    category: exp.category,
    perfectFor: [exp.tip || 'Perfect for exploring'],
    status: exp.status,
    scheduledDate: exp.scheduled_date,
    savedDate: exp.created_at ? new Date(exp.created_at).toLocaleDateString() : undefined,
    // Additional fields for expanded view
    lat: exp.location_lat,
    lng: exp.location_lng,
    latitude: exp.location_lat,
    longitude: exp.location_lng,
    address: exp.address
  });

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
          {savedCount} experiences saved • {acceptedCount} accepted
        </p>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="px-6 space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="w-12 h-12 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-8 w-16" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="px-6 py-12 text-center">
          <div className="text-destructive mb-2">Error loading saved experiences</div>
          <p className="text-muted-foreground text-sm">{error}</p>
        </div>
      )}

      {/* Calendar View */}
      {!loading && !error && viewMode === 'calendar' && (
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
                    {trip.scheduled_date && new Date(trip.scheduled_date).toLocaleDateString()}
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
      {!loading && !error && viewMode === 'list' && (
        <div className="px-6 space-y-4">
          {activeSavedTrips.map((trip) => (
            <SavedTripCard
              key={trip.id}
              trip={transformExperienceToTrip(trip)}
              onFinalize={handleAcceptTrip}
              onAddToBoard={handleAddToBoard}
              onDelete={handleRemoveTrip}
              onExpand={setExpandedTrip}
              onRevoke={handleRevokeTrip}
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && activeSavedTrips.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <Calendar className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No saved experiences yet</h3>
          <p className="text-muted-foreground mb-4">
            Start exploring and save experiences you love on the Home tab!
          </p>
        </div>
      )}

      {/* Expanded Trip Card */}
      {expandedTripData && (
        <TripCardExpanded
          trip={transformExperienceToTrip(expandedTripData)}
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
        tripTitle={savedExperiences.find(t => t.id === selectedTripForBoard)?.title || ''}
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

    </div>
  );
};

export default Saved;