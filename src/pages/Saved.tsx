import React, { useState } from 'react';
import { Plus, MoreVertical, Calendar, MapPin, Check, X, CalendarDays, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TripCardExpanded } from '@/components/TripCardExpanded';
import { BoardSelectionDialog } from '@/components/BoardSelectionDialog';
import { NewBoardDialog } from '@/components/NewBoardDialog';
import { SavedTripCard } from '@/components/SavedTripCard';

// Mock data removed - will be replaced with real user saves from Supabase

const Saved = () => {
  const [selectedTrips, setSelectedTrips] = useState<string[]>([]);
  const [expandedTrip, setExpandedTrip] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [trips, setTrips] = useState<any[]>([]); // Will be loaded from real user saves
  const [isBoardSelectionOpen, setIsBoardSelectionOpen] = useState(false);
  const [isNewBoardDialogOpen, setIsNewBoardDialogOpen] = useState(false);
  const [selectedTripForBoard, setSelectedTripForBoard] = useState<string | null>(null);
  const [boards, setBoards] = useState<any[]>([]); // Will be loaded from real boards

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
            <SavedTripCard
              key={trip.id}
              trip={trip}
              onFinalize={handleAcceptTrip}
              onAddToBoard={handleAddToBoard}
              onDelete={handleRemoveTrip}
              onExpand={setExpandedTrip}
              onRevoke={handleRevokeTrip}
            />
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
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
          <Calendar className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">No saved experiences yet</h3>
        <p className="text-muted-foreground mb-4">
          Start exploring and save experiences you love on the Home tab!
        </p>
      </div>

    </div>
  );
};

export default Saved;