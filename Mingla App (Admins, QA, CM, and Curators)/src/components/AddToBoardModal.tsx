import React, { useState } from 'react';
import { X, Users, Clock, Calendar, AlertCircle, Check } from 'lucide-react';

interface Friend {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  status: 'online' | 'offline' | 'away';
  isOnline: boolean;
}

interface CollaborationSession {
  id: string;
  name: string;
  status: 'pending' | 'active' | 'archived';
  participants: Friend[];
  createdBy: string;
  createdAt: string;
  lastActivity: string;
  hasCollabPreferences?: boolean;
  pendingParticipants: number;
  totalParticipants: number;
  boardCards: number;
}

interface AddToBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
  friend: Friend;
  onAddToBoard: (sessionIds: string[], friend: Friend) => void;
}

// Mock collaboration sessions - this would come from app state in real implementation
const mockSessions: CollaborationSession[] = [
  {
    id: 'session-1',
    name: 'Weekend Squad',
    status: 'active',
    participants: [
      { id: '1', name: 'Sarah Chen', username: 'sarahc', status: 'online', isOnline: true },
      { id: '2', name: 'Marcus Johnson', username: 'marcusj', status: 'online', isOnline: true }
    ],
    createdBy: 'me',
    createdAt: '2 days ago',
    lastActivity: '1h ago',
    hasCollabPreferences: true,
    pendingParticipants: 0,
    totalParticipants: 3,
    boardCards: 4
  },
  {
    id: 'session-2',
    name: 'Dinner Club',
    status: 'pending',
    participants: [
      { id: '3', name: 'Jamie Park', username: 'jamiep', status: 'offline', isOnline: false }
    ],
    createdBy: 'me',
    createdAt: '1 day ago',
    lastActivity: '5h ago',
    hasCollabPreferences: false,
    pendingParticipants: 1,
    totalParticipants: 2,
    boardCards: 2
  },
  {
    id: 'session-3',
    name: 'Adventure Seekers',
    status: 'active',
    participants: [
      { id: '4', name: 'Taylor Kim', username: 'taylork', status: 'online', isOnline: true },
      { id: '5', name: 'Jordan Lee', username: 'jordanl', status: 'away', isOnline: false },
      { id: '6', name: 'Alex Rivera', username: 'alexr', status: 'online', isOnline: true }
    ],
    createdBy: 'me',
    createdAt: '3 days ago',
    lastActivity: '30m ago',
    hasCollabPreferences: true,
    pendingParticipants: 0,
    totalParticipants: 4,
    boardCards: 6
  },
  {
    id: 'session-4',
    name: 'Coffee & Culture',
    status: 'active',
    participants: [
      { id: '7', name: 'Sam Wilson', username: 'samw', status: 'online', isOnline: true }
    ],
    createdBy: 'me',
    createdAt: '1 week ago',
    lastActivity: '2h ago',
    hasCollabPreferences: true,
    pendingParticipants: 0,
    totalParticipants: 2,
    boardCards: 3
  }
];

export default function AddToBoardModal({ isOpen, onClose, friend, onAddToBoard }: AddToBoardModalProps) {
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
  const [isAdding, setIsAdding] = useState(false);

  // Reset selections when modal opens/closes
  React.useEffect(() => {
    if (!isOpen) {
      setSelectedSessions([]);
      setIsAdding(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddToBoard = async () => {
    if (selectedSessions.length === 0) return;
    
    setIsAdding(true);
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    onAddToBoard(selectedSessions, friend);
    setIsAdding(false);
    setSelectedSessions([]);
    onClose();
  };

  const handleSessionToggle = (sessionId: string) => {
    setSelectedSessions(prev => 
      prev.includes(sessionId)
        ? prev.filter(id => id !== sessionId)
        : [...prev, sessionId]
    );
  };

  const handleSelectAll = () => {
    if (selectedSessions.length === availableSessions.length) {
      setSelectedSessions([]);
    } else {
      setSelectedSessions(availableSessions.map(session => session.id));
    }
  };

  const getStatusColor = (status: CollaborationSession['status']) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'archived': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status: CollaborationSession['status']) => {
    switch (status) {
      case 'active': return <Users className="w-3 h-3" />;
      case 'pending': return <Clock className="w-3 h-3" />;
      case 'archived': return <Calendar className="w-3 h-3" />;
      default: return <AlertCircle className="w-3 h-3" />;
    }
  };

  // Filter out sessions where the friend is already a participant
  const availableSessions = mockSessions.filter(session => 
    !session.participants.some(participant => participant.id === friend.id) &&
    session.status !== 'archived'
  );

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Add to Board</h2>
            <p className="text-sm text-gray-600 mt-1">
              Add <span className="font-medium text-[#eb7825]">{friend.name}</span> to existing collaboration boards
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-96 overflow-y-auto">
          {availableSessions.length === 0 ? (
            <div className="text-center py-8">
              <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="font-medium text-gray-900 mb-2">No Available Boards</h3>
              <p className="text-sm text-gray-600">
                {friend.name} is already in all your active collaboration boards, or you don't have any boards yet.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-gray-600">
                  Select collaboration boards to add {friend.name} to:
                </p>
                <div className="flex items-center gap-2">
                  {selectedSessions.length > 0 && (
                    <span className="flex items-center gap-1 bg-orange-100 text-orange-800 px-2 py-1 rounded-full">
                      <Check className="w-3 h-3" />
                      <span className="text-xs font-medium min-w-[1rem] text-center">{selectedSessions.length}</span>
                    </span>
                  )}
                  {availableSessions.length > 1 && (
                    <button
                      onClick={handleSelectAll}
                      className="flex items-center gap-1 px-2 py-1 text-[#eb7825] hover:text-[#d6691f] hover:bg-orange-50 rounded-lg transition-all duration-200"
                      title={selectedSessions.length === availableSessions.length ? 'Deselect All' : 'Select All'}
                    >
                      {selectedSessions.length === availableSessions.length ? (
                        <X className="w-3 h-3" />
                      ) : (
                        <Check className="w-3 h-3" />
                      )}
                      <span className="text-xs font-medium">All</span>
                    </button>
                  )}
                </div>
              </div>
              
              <div className="space-y-3">
                {availableSessions.map((session) => (
                  <div
                    key={session.id}
                    className={`p-4 border-2 rounded-2xl cursor-pointer transition-all duration-200 hover:shadow-md ${
                      selectedSessions.includes(session.id)
                        ? 'border-[#eb7825] bg-orange-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => handleSessionToggle(session.id)}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-semibold text-gray-900">{session.name}</h3>
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(session.status)}`}>
                            {getStatusIcon(session.status)}
                            {session.status}
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {session.totalParticipants} members
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {session.boardCards} cards
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {session.lastActivity}
                          </span>
                        </div>
                      </div>
                      
                      <div className="flex-shrink-0 ml-3">
                        <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-colors ${
                          selectedSessions.includes(session.id)
                            ? 'bg-[#eb7825] border-[#eb7825]'
                            : 'border-gray-300 bg-white'
                        }`}>
                          {selectedSessions.includes(session.id) && (
                            <Check className="w-4 h-4 text-white" />
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {/* Participants Preview */}
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-2">
                        {session.participants.slice(0, 3).map((participant, index) => (
                          <div
                            key={participant.id}
                            className="w-6 h-6 bg-gradient-to-br from-orange-400 to-pink-500 rounded-full border-2 border-white flex items-center justify-center"
                            title={participant.name}
                          >
                            <span className="text-xs text-white font-medium">
                              {participant.name.split(' ').map(n => n[0]).join('')}
                            </span>
                          </div>
                        ))}
                        {session.participants.length > 3 && (
                          <div className="w-6 h-6 bg-gray-300 rounded-full border-2 border-white flex items-center justify-center">
                            <span className="text-xs text-gray-600 font-medium">
                              +{session.participants.length - 3}
                            </span>
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-gray-500">
                        Current members
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {availableSessions.length > 0 && (
          <div className="p-6 border-t border-gray-200 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 px-4 border border-gray-300 rounded-2xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAddToBoard}
              disabled={selectedSessions.length === 0 || isAdding}
              className="flex-1 py-3 px-4 bg-[#eb7825] text-white rounded-2xl font-medium hover:shadow-lg hover:shadow-[#eb7825]/20 hover:bg-[#d6691f] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isAdding ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Adding...
                </>
              ) : (
                selectedSessions.length === 0
                  ? 'Select Boards'
                  : selectedSessions.length === 1
                    ? 'Add to Board'
                    : `Add to ${selectedSessions.length} Boards`
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}