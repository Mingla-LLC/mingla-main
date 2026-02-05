import React from 'react';
import { ChevronLeft, ChevronRight, X, Check, Send } from 'lucide-react';
import { CreateTabProps } from './types';
import { MOCK_FRIENDS } from './constants';

export default function CreateTab({
  createStep,
  newSessionName,
  selectedFriends,
  availableFriends,
  preSelectedFriend,
  onCreateStepChange,
  onSessionNameChange,
  onToggleFriend,
  onCreateSession,
  onGoBack
}: CreateTabProps) {
  // Step 1: Session Details
  if (createStep === 'details') {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="font-bold text-gray-900 mb-1">Create New Session</h3>
          <p className="text-sm text-gray-600">
            Name your collaboration session
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Session Name
          </label>
          <input
            type="text"
            value={newSessionName}
            onChange={(e) => onSessionNameChange(e.target.value)}
            placeholder="e.g., Weekend Plans, Date Night Ideas..."
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-[#eb7825] focus:outline-none transition-colors"
            autoFocus
          />
          <p className="mt-2 text-xs text-gray-500">
            This will be visible to all participants
          </p>
        </div>

        <button
          onClick={() => onCreateStepChange('friends')}
          disabled={!newSessionName.trim()}
          className="w-full bg-[#eb7825] text-white py-3 px-6 rounded-xl font-semibold hover:bg-[#d6691f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          Continue
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    );
  }

  // Step 2: Select Friends
  if (createStep === 'friends') {
    const allFriends = [...(availableFriends.length > 0 ? availableFriends : MOCK_FRIENDS)];
    
    // Add preSelectedFriend if not in the list
    if (preSelectedFriend && !allFriends.some(f => f.id === preSelectedFriend.id)) {
      allFriends.unshift(preSelectedFriend);
    }

    return (
      <div className="space-y-6">
        {/* Header with Back Button */}
        <div className="flex items-start gap-3">
          <button
            onClick={onGoBack}
            className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h3 className="font-bold text-gray-900">Select Friends</h3>
            <p className="text-sm text-gray-600">
              Choose friends to invite to "{newSessionName}"
              {preSelectedFriend && " • You can modify your selection below"}
            </p>
          </div>
        </div>

        {/* Selected Friends */}
        {selectedFriends.length > 0 && (
          <div className="bg-orange-50 border border-orange-100 rounded-xl p-4">
            <h4 className="font-medium text-gray-900 mb-3">
              Selected Friends ({selectedFriends.length})
            </h4>
            <div className="flex flex-wrap gap-2">
              {selectedFriends.map((friend) => (
                <div 
                  key={friend.id}
                  className="flex items-center gap-2 bg-white border border-orange-200 rounded-full px-3 py-1"
                >
                  <div className="w-6 h-6 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-xs font-semibold">
                      {friend.name[0]}
                    </span>
                  </div>
                  <span className="text-sm font-medium text-gray-700">{friend.name}</span>
                  <button 
                    onClick={() => onToggleFriend(friend)}
                    className="w-4 h-4 hover:bg-red-100 rounded-full flex items-center justify-center"
                  >
                    <X className="w-3 h-3 text-gray-500 hover:text-red-600" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Friends List */}
        <div className="space-y-2">
          <h4 className="font-medium text-gray-900">Available Friends</h4>
          {allFriends.map((friend) => {
            const isSelected = selectedFriends.some(f => f.id === friend.id);
            const isPreSelected = preSelectedFriend?.id === friend.id;
            
            return (
              <button
                key={friend.id}
                onClick={() => onToggleFriend(friend)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                  isSelected
                    ? 'border-[#eb7825] bg-orange-50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center">
                  <span className="text-white font-semibold">
                    {friend.name[0]}
                  </span>
                </div>
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900">{friend.name}</p>
                    {isPreSelected && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                        Pre-selected
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span>@{(friend.username || friend.name.toLowerCase().replace(' ', ''))}</span>
                  </div>
                </div>
                {isSelected && (
                  <Check className="w-5 h-5 text-[#eb7825]" />
                )}
              </button>
            );
          })}
        </div>

        {/* Continue Button */}
        <button
          onClick={() => onCreateStepChange('confirm')}
          disabled={selectedFriends.length === 0}
          className="w-full bg-[#eb7825] text-white py-3 px-6 rounded-xl font-semibold hover:bg-[#d6691f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue ({selectedFriends.length} selected)
        </button>
      </div>
    );
  }

  // Step 3: Confirm
  if (createStep === 'confirm') {
    return (
      <div className="space-y-6">
        {/* Header with Back Button */}
        <div className="flex items-start gap-3">
          <button
            onClick={onGoBack}
            className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h3 className="font-bold text-gray-900">Confirm Session</h3>
            <p className="text-sm text-gray-600">
              Review your session details before creating
            </p>
          </div>
        </div>

        {/* Session Summary */}
        <div className="bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-xl p-6 text-white">
          <h4 className="text-2xl font-bold mb-2">{newSessionName}</h4>
          <p className="text-white/80 text-sm">
            Collaboration session with {selectedFriends.length} {selectedFriends.length === 1 ? 'friend' : 'friends'}
          </p>
        </div>

        {/* Participants */}
        <div className="space-y-3">
          <h4 className="font-medium text-gray-900">Participants ({selectedFriends.length + 1})</h4>
          
          {/* You */}
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
            <div className="w-10 h-10 bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-full flex items-center justify-center">
              <span className="text-white font-semibold">You</span>
            </div>
            <div className="flex-1">
              <p className="font-medium text-gray-900">You</p>
              <p className="text-sm text-gray-600">Session creator</p>
            </div>
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
              Creator
            </span>
          </div>

          {/* Selected Friends */}
          {selectedFriends.map((friend) => (
            <div key={friend.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center">
                <span className="text-white font-semibold">
                  {friend.name[0]}
                </span>
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900">{friend.name}</p>
                <p className="text-sm text-gray-600">@{(friend.username || friend.name.toLowerCase().replace(' ', ''))}</p>
              </div>
              <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full">
                Pending
              </span>
            </div>
          ))}
        </div>

        {/* Create Button */}
        <button
          onClick={onCreateSession}
          className="w-full bg-[#eb7825] text-white py-3 px-6 rounded-xl font-semibold hover:bg-[#d6691f] transition-colors flex items-center justify-center gap-2"
        >
          <Send className="w-5 h-5" />
          Create Session & Send Invites
        </button>

        <p className="text-xs text-center text-gray-500">
          Invitations will be sent to all selected friends
        </p>
      </div>
    );
  }

  return null;
}
