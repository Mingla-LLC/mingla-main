import React from 'react';
import { Check, X, Clock, Timer, AlertCircle } from 'lucide-react';
import { InvitesTabProps } from './types';

export default function InvitesTab({
  sentInvites,
  receivedInvites,
  showInviteType,
  onShowInviteTypeChange,
  onAcceptInvite,
  onDeclineInvite,
  onCancelInvite
}: InvitesTabProps) {
  const activeInvites = showInviteType === 'received' ? receivedInvites : sentInvites;

  return (
    <div className="space-y-4">
      {/* Toggle */}
      <div className="flex gap-2 bg-gray-100 p-1 rounded-lg">
        <button
          onClick={() => onShowInviteTypeChange('received')}
          className={`flex-1 py-3 rounded-md font-medium text-sm transition-all relative text-center ${
            showInviteType === 'received'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600'
          }`}
        >
          Received
          {receivedInvites.length > 0 && (
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />
          )}
        </button>
        <button
          onClick={() => onShowInviteTypeChange('sent')}
          className={`flex-1 py-3 rounded-md font-medium text-sm transition-all relative text-center ${
            showInviteType === 'sent'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600'
          }`}
        >
          Sent
          {sentInvites.length > 0 && (
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full" />
          )}
        </button>
      </div>

      {/* Invites List */}
      {activeInvites.length > 0 ? (
        <div className="space-y-3">
          {activeInvites.map((invite) => (
            <div
              key={invite.id}
              className="p-4 border-2 border-gray-200 rounded-xl hover:border-gray-300 transition-all"
            >
              {/* Invite Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center">
                    <span className="text-white font-semibold">
                      {showInviteType === 'received' 
                        ? invite.fromUser.name[0]
                        : invite.toUser.name[0]
                      }
                    </span>
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-gray-900">{invite.sessionName}</h4>
                    <p className="text-sm text-gray-600">
                      {showInviteType === 'received' 
                        ? `From ${invite.fromUser.name}`
                        : `To ${invite.toUser.name}`
                      }
                    </p>
                  </div>
                </div>
                
                <span
                  className={`px-2 py-1 rounded-full text-xs font-medium ${
                    invite.status === 'pending'
                      ? 'bg-yellow-100 text-yellow-700'
                      : invite.status === 'accepted'
                      ? 'bg-green-100 text-green-700'
                      : invite.status === 'declined'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {invite.status}
                </span>
              </div>

              {/* Invite Info */}
              <div className="flex items-center gap-4 text-xs text-gray-600 mb-3">
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>{invite.createdAt}</span>
                </div>
                {invite.expiresAt && (
                  <div className="flex items-center gap-1 text-orange-600">
                    <Timer className="w-3 h-3" />
                    <span>Expires in {invite.expiresAt}</span>
                  </div>
                )}
              </div>

              {/* Actions */}
              {invite.status === 'pending' && (
                <div className="flex gap-2">
                  {showInviteType === 'received' ? (
                    <>
                      <button
                        onClick={() => onAcceptInvite(invite.id)}
                        className="flex-1 py-2 px-3 rounded-lg font-medium text-sm bg-green-500 text-white hover:bg-green-600 transition-colors flex items-center justify-center gap-2"
                      >
                        <Check className="w-4 h-4" />
                        Accept
                      </button>
                      <button
                        onClick={() => onDeclineInvite(invite.id)}
                        className="flex-1 py-2 px-3 rounded-lg font-medium text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors flex items-center justify-center gap-2"
                      >
                        <X className="w-4 h-4" />
                        Decline
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => onCancelInvite(invite.id)}
                      className="w-full py-2 px-3 rounded-lg font-medium text-sm bg-red-50 text-red-600 hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
                    >
                      <X className="w-4 h-4" />
                      Cancel Invitation
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        /* Empty State */
        <div className="text-center py-12 px-6">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-2">
            No {showInviteType === 'received' ? 'Received' : 'Sent'} Invites
          </h3>
          <p className="text-sm text-gray-600">
            {showInviteType === 'received'
              ? "You don't have any pending invitations"
              : "You haven't sent any invitations yet"
            }
          </p>
        </div>
      )}
    </div>
  );
}
