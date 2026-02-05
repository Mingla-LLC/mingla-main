import React from 'react';
import { 
  Users, MessageSquare, Calendar, Settings, 
  ArrowRight, User, UserCheck, Clock, Zap 
} from 'lucide-react';
import { SessionsTabProps } from './types';

export default function SessionsTab({
  currentMode,
  sessions,
  boardsSessions,
  onModeChange,
  onNavigateToBoard
}: SessionsTabProps) {
  // Use real boards if available, otherwise fall back to mock sessions
  const displaySessions = boardsSessions.length > 0 ? boardsSessions : sessions;

  return (
    <div className="space-y-4">
      {/* Solo Mode Card */}
      <div
        className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${
          currentMode === 'solo'
            ? 'border-[#eb7825] bg-orange-50'
            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
        }`}
        onClick={() => onModeChange('solo')}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center">
              <User className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Solo Explorer</h3>
              <p className="text-sm text-gray-600">Browse experiences just for you</p>
            </div>
          </div>
          {currentMode === 'solo' && (
            <div className="w-6 h-6 bg-[#eb7825] rounded-full flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* Existing Sessions */}
      {displaySessions.length > 0 ? (
        <div className="space-y-3">
          <h3 className="font-semibold text-gray-900">Active Sessions</h3>
          {displaySessions.map((session) => {
            const isActive = currentMode === session.id || currentMode === session.name;
            
            return (
              <div
                key={session.id}
                className={`p-4 rounded-xl border-2 transition-all ${
                  isActive
                    ? 'border-[#eb7825] bg-orange-50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                {/* Session Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold text-gray-900">{session.name}</h4>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          session.status === 'active'
                            ? 'bg-green-100 text-green-700'
                            : session.status === 'pending'
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {session.status}
                      </span>
                    </div>
                    
                    {/* Session Info */}
                    <div className="flex flex-wrap gap-3 text-sm text-gray-600 mb-2">
                      <div className="flex items-center gap-1">
                        <Users className="w-4 h-4" />
                        <span>{session.totalParticipants} members</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        <span>{session.boardCards || 0} cards</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        <span>{session.lastActivity}</span>
                      </div>
                    </div>

                    {/* Participants Avatars */}
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-2">
                        {session.participants?.slice(0, 3).map((participant, idx) => (
                          <div
                            key={participant.id || idx}
                            className="w-8 h-8 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center border-2 border-white"
                          >
                            <span className="text-white text-xs font-semibold">
                              {participant.name[0]}
                            </span>
                          </div>
                        ))}
                        {session.totalParticipants > 3 && (
                          <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center border-2 border-white text-xs font-medium text-gray-600">
                            +{session.totalParticipants - 3}
                          </div>
                        )}
                      </div>
                      {session.pendingParticipants > 0 && (
                        <span className="text-xs text-yellow-600 font-medium">
                          {session.pendingParticipants} pending
                        </span>
                      )}
                    </div>
                  </div>

                  {isActive && (
                    <div className="w-6 h-6 bg-[#eb7825] rounded-full flex items-center justify-center flex-shrink-0">
                      <UserCheck className="w-4 h-4 text-white" />
                    </div>
                  )}
                </div>

                {/* Session Actions */}
                <div className="flex gap-2 pt-3 border-t border-gray-200">
                  <button
                    onClick={() => onModeChange(session.id || session.name)}
                    className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-all flex items-center justify-center gap-2 ${
                      isActive
                        ? 'bg-[#eb7825] text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    <Zap className="w-4 h-4" />
                    {isActive ? 'Active' : 'Switch to this session'}
                  </button>
                  
                  {onNavigateToBoard && (
                    <button
                      onClick={() => onNavigateToBoard(session, 'discussion')}
                      className="py-2 px-3 rounded-lg font-medium text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all flex items-center gap-2"
                    >
                      <MessageSquare className="w-4 h-4" />
                      <span className="hidden sm:inline">Chat</span>
                    </button>
                  )}
                  
                  <button
                    className="py-2 px-3 rounded-lg font-medium text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Empty State */
        <div className="text-center py-12 px-6">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Users className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-2">No Active Sessions</h3>
          <p className="text-sm text-gray-600 mb-4">
            Create a new session to start collaborating with friends
          </p>
        </div>
      )}
    </div>
  );
}
