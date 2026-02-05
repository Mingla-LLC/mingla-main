import React from 'react';
import { Check, Plus, Phone } from 'lucide-react';
import { StepProps } from '../types';
import { MOCK_CONTACTS } from '../constants';

export default function InviteFriendsStep({ data, onUpdate }: StepProps) {
  const handleFriendInvite = (friend: typeof MOCK_CONTACTS[0]) => {
    const isInvited = data.invitedFriends.some(f => f.id === friend.id);
    
    if (isInvited) {
      onUpdate({
        invitedFriends: data.invitedFriends.filter(f => f.id !== friend.id)
      });
    } else {
      onUpdate({
        invitedFriends: [...data.invitedFriends, friend]
      });
    }
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="text-center space-y-1 px-4 sm:px-6">
        <h2 className="text-gray-900">Invite Friends</h2>
        <p className="text-xs text-gray-600">
          Mingla is better with friends! Invite people to join you.
        </p>
      </div>

      {/* Suggested Contacts */}
      <div className="space-y-2 px-4 sm:px-6">
        <h3 className="text-gray-900 text-xs">Suggested Contacts</h3>
        <div className="space-y-1.5 max-h-[35vh] overflow-y-auto">
          {MOCK_CONTACTS.map((contact) => {
            const isInvited = data.invitedFriends.some(f => f.id === contact.id);
            
            return (
              <div key={contact.id} className="flex items-center justify-between gap-2 p-2 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-2 min-w-0 flex-1">
                  <div className="w-8 h-8 bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-full flex items-center justify-center text-white flex-shrink-0 text-xs shadow-md">
                    {contact.name.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-gray-900 text-xs truncate">{contact.name}</p>
                    <p className="text-xs text-gray-600 truncate">{contact.email}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleFriendInvite(contact)}
                  className={`px-2.5 py-1.5 rounded-lg transition-colors flex-shrink-0 text-xs ${
                    isInvited
                      ? 'bg-green-100 text-green-700'
                      : 'bg-[#eb7825] text-white hover:bg-[#d6691f]'
                  }`}
                >
                  {isInvited ? (
                    <div className="flex items-center space-x-0.5">
                      <Check className="w-3 h-3" />
                      <span>✓</span>
                    </div>
                  ) : (
                    'Invite'
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Manual Invite Options */}
      <div className="space-y-1.5 px-4 sm:px-6">
        <button className="w-full p-2.5 border-2 border-dashed border-gray-300 rounded-lg text-center text-gray-600 hover:border-[#eb7825] hover:text-[#eb7825] hover:bg-orange-50 transition-all">
          <Plus className="w-4 h-4 mx-auto mb-1" />
          <span className="text-xs">Invite by Email</span>
        </button>
        
        <button className="w-full p-2.5 border-2 border-dashed border-gray-300 rounded-lg text-center text-gray-600 hover:border-[#eb7825] hover:text-[#eb7825] hover:bg-orange-50 transition-all">
          <Phone className="w-4 h-4 mx-auto mb-1" />
          <span className="text-xs">Invite from Contacts</span>
        </button>
      </div>

      {/* Helper Text */}
      <div className="text-center px-4 sm:px-6">
        <p className="text-xs text-gray-600">
          You can skip this step and invite friends later
        </p>
      </div>
    </div>
  );
}