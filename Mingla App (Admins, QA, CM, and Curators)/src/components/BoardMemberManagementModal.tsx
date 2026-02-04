import React, { useState } from 'react';
import { X, Crown, UserMinus, Shield, ShieldCheck, Users, AlertTriangle } from 'lucide-react';

interface Participant {
  id: string;
  name: string;
  status: string;
  lastActive?: string;
}

interface BoardMemberManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  board: {
    id: string;
    name: string;
    participants: Participant[];
    admins: string[];
    currentUserId: string;
    creatorId: string;
  };
  onPromoteToAdmin: (participantId: string) => void;
  onDemoteFromAdmin: (participantId: string) => void;
  onRemoveMember: (participantId: string) => void;
  onLeaveBoard: () => void;
}

export default function BoardMemberManagementModal({
  isOpen,
  onClose,
  board,
  onPromoteToAdmin,
  onDemoteFromAdmin,
  onRemoveMember,
  onLeaveBoard
}: BoardMemberManagementModalProps) {
  const [confirmAction, setConfirmAction] = useState<{
    type: 'remove' | 'leave' | 'demote';
    participantId?: string;
    participantName?: string;
  } | null>(null);

  if (!isOpen) return null;

  const isCurrentUserAdmin = board.admins.includes(board.currentUserId);
  const isCurrentUserCreator = board.creatorId === board.currentUserId;

  const handlePromoteToAdmin = (participantId: string) => {
    onPromoteToAdmin(participantId);
    setConfirmAction(null);
  };

  const handleDemoteFromAdmin = (participantId: string) => {
    if (confirmAction?.type === 'demote' && confirmAction.participantId === participantId) {
      onDemoteFromAdmin(participantId);
      setConfirmAction(null);
    } else {
      const participant = board.participants.find(p => p.id === participantId);
      setConfirmAction({
        type: 'demote',
        participantId,
        participantName: participant?.name
      });
    }
  };

  const handleRemoveMember = (participantId: string) => {
    if (confirmAction?.type === 'remove' && confirmAction.participantId === participantId) {
      onRemoveMember(participantId);
      setConfirmAction(null);
    } else {
      const participant = board.participants.find(p => p.id === participantId);
      setConfirmAction({
        type: 'remove',
        participantId,
        participantName: participant?.name
      });
    }
  };

  const handleLeaveBoard = () => {
    if (confirmAction?.type === 'leave') {
      onLeaveBoard();
      setConfirmAction(null);
      onClose();
    } else {
      setConfirmAction({ type: 'leave' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Manage Board</h2>
              <p className="text-sm text-gray-600 mt-1">{board.name}</p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4 text-gray-600" />
            </button>
          </div>
        </div>

        {/* Members List */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            {board.participants.map((participant) => {
              const isAdmin = board.admins.includes(participant.id);
              const isCreator = board.creatorId === participant.id;
              const isCurrentUser = participant.id === board.currentUserId;
              
              return (
                <div key={participant.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#eb7825] rounded-full flex items-center justify-center">
                      <span className="text-white font-semibold text-sm">
                        {participant.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">
                          {participant.name}
                          {isCurrentUser && ' (You)'}
                        </span>
                        {isCreator && (
                          <div className="flex items-center gap-1 bg-[#eb7825] text-white px-2 py-0.5 rounded-full text-xs">
                            <Crown className="w-3 h-3" />
                            Creator
                          </div>
                        )}
                        {isAdmin && !isCreator && (
                          <div className="flex items-center gap-1 bg-[#eb7825] text-white px-2 py-0.5 rounded-full text-xs">
                            <Shield className="w-3 h-3" />
                            Admin
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 capitalize">{participant.status}</p>
                    </div>
                  </div>

                  {/* Action buttons - only show if current user is admin and it's not themselves */}
                  {isCurrentUserAdmin && !isCurrentUser && (
                    <div className="flex items-center gap-2">
                      {!isAdmin && (
                        <button
                          onClick={() => handlePromoteToAdmin(participant.id)}
                          className="w-8 h-8 bg-[#eb7825]/10 hover:bg-[#eb7825]/20 text-[#eb7825] rounded-lg flex items-center justify-center transition-colors"
                          title="Promote to Admin"
                        >
                          <ShieldCheck className="w-4 h-4" />
                        </button>
                      )}
                      
                      {isAdmin && !isCreator && (
                        <button
                          onClick={() => handleDemoteFromAdmin(participant.id)}
                          className="w-8 h-8 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg flex items-center justify-center transition-colors"
                          title="Remove Admin"
                        >
                          <Shield className="w-4 h-4" />
                        </button>
                      )}
                      
                      {!isCreator && (
                        <button
                          onClick={() => handleRemoveMember(participant.id)}
                          className="w-8 h-8 bg-[#eb7825]/10 hover:bg-[#eb7825]/20 text-[#eb7825] rounded-lg flex items-center justify-center transition-colors"
                          title="Remove Member"
                        >
                          <UserMinus className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Board info */}
          <div className="mt-6 p-4 bg-[#eb7825]/10 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-[#eb7825]" />
              <span className="font-medium text-[#eb7825]">Board Info</span>
            </div>
            <div className="space-y-1 text-sm text-[#eb7825]">
              <p>Total Members: {board.participants.length}</p>
              <p>Admins: {board.admins.length}</p>
              {board.participants.length <= 2 && (
                <div className="flex items-center gap-2 mt-2 p-2 bg-amber-100 rounded-lg">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span className="text-xs text-amber-700">
                    Board will be deleted if any member leaves (minimum 2 members required)
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-6 border-t border-gray-100 flex-shrink-0">
          {confirmAction ? (
            <div className="space-y-3">
              {confirmAction.type === 'remove' && (
                <div className="p-3 bg-red-50 rounded-xl">
                  <p className="text-sm text-red-700 mb-3">
                    Remove <strong>{confirmAction.participantName}</strong> from this board?
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleRemoveMember(confirmAction.participantId!)}
                      className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-red-700 transition-colors"
                    >
                      Remove Member
                    </button>
                    <button
                      onClick={() => setConfirmAction(null)}
                      className="flex-1 bg-gray-200 text-gray-700 py-2 px-4 rounded-lg font-medium hover:bg-gray-300 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {confirmAction.type === 'demote' && (
                <div className="p-3 bg-amber-50 rounded-xl">
                  <p className="text-sm text-amber-700 mb-3">
                    Remove admin privileges from <strong>{confirmAction.participantName}</strong>?
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDemoteFromAdmin(confirmAction.participantId!)}
                      className="flex-1 bg-amber-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-amber-700 transition-colors"
                    >
                      Remove Admin
                    </button>
                    <button
                      onClick={() => setConfirmAction(null)}
                      className="flex-1 bg-gray-200 text-gray-700 py-2 px-4 rounded-lg font-medium hover:bg-gray-300 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {confirmAction.type === 'leave' && (
                <div className="p-3 bg-red-50 rounded-xl">
                  <p className="text-sm text-red-700 mb-2">
                    <strong>Leave this board?</strong>
                  </p>
                  <div className="text-xs text-red-600 mb-3 space-y-1">
                    {isCurrentUserAdmin && board.admins.length === 1 && board.participants.length > 2 && (
                      <p>• Another member will be randomly assigned as admin</p>
                    )}
                    {board.participants.length <= 2 && (
                      <p>• Board will be permanently deleted (less than 2 members remaining)</p>
                    )}
                    <p>• This action cannot be undone</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleLeaveBoard}
                      className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-red-700 transition-colors"
                    >
                      Leave Board
                    </button>
                    <button
                      onClick={() => setConfirmAction(null)}
                      className="flex-1 bg-gray-200 text-gray-700 py-2 px-4 rounded-lg font-medium hover:bg-gray-300 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={handleLeaveBoard}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 border-2 border-red-200 text-red-600 rounded-xl font-semibold hover:bg-red-50 transition-colors"
            >
              <UserMinus className="w-4 h-4" />
              Leave Board
            </button>
          )}
        </div>
      </div>
    </div>
  );
}