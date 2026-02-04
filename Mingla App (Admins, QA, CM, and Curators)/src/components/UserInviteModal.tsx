import React, { useState } from 'react';
import { X, Search, UserPlus, Check, Send } from 'lucide-react';

interface User {
  id: string;
  name: string;
  avatar?: string;
  isOnline?: boolean;
  lastSeen?: string;
}

interface UserInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionName: string;
  onInviteUsers: (users: User[]) => void;
}

const mockUsers: User[] = [
  { id: '1', name: 'Sarah Chen', isOnline: true },
  { id: '2', name: 'Alex Rivera', isOnline: true },
  { id: '3', name: 'Jamie Park', isOnline: false, lastSeen: '2 hours ago' },
  { id: '4', name: 'Morgan Lee', isOnline: true },
  { id: '5', name: 'Casey Kim', isOnline: false, lastSeen: '1 day ago' },
  { id: '6', name: 'Taylor Johnson', isOnline: false, lastSeen: '3 hours ago' },
  { id: '7', name: 'Riley Davis', isOnline: true },
  { id: '8', name: 'Jordan Smith', isOnline: false, lastSeen: '5 minutes ago' }
];

export default function UserInviteModal({ isOpen, onClose, sessionName, onInviteUsers }: UserInviteModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);

  const filteredUsers = mockUsers.filter(user => 
    user.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleUser = (user: User) => {
    setSelectedUsers(prev => 
      prev.find(u => u.id === user.id)
        ? prev.filter(u => u.id !== user.id)
        : [...prev, user]
    );
  };

  const handleInvite = () => {
    if (selectedUsers.length > 0) {
      onInviteUsers(selectedUsers);
      setSelectedUsers([]);
      setSearchQuery('');
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Invite to Session</h2>
            <p className="text-sm text-gray-600">"{sessionName}"</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search friends..."
              className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#eb7825]/20 focus:border-[#eb7825] bg-gray-50"
            />
          </div>
        </div>

        {/* Selected Users */}
        {selectedUsers.length > 0 && (
          <div className="p-4 bg-orange-50 border-b border-orange-100">
            <p className="text-sm font-medium text-orange-800 mb-2">
              Selected ({selectedUsers.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {selectedUsers.map(user => (
                <div key={user.id} className="flex items-center gap-2 bg-white rounded-full px-3 py-1 border border-orange-200">
                  <div className="w-6 h-6 bg-[#eb7825] rounded-full flex items-center justify-center">
                    <span className="text-white text-xs font-medium">{user.name[0]}</span>
                  </div>
                  <span className="text-sm font-medium text-gray-900">{user.name}</span>
                  <button 
                    onClick={() => toggleUser(user)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* User List */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-2">
            {filteredUsers.map(user => {
              const isSelected = selectedUsers.find(u => u.id === user.id);
              return (
                <button
                  key={user.id}
                  onClick={() => toggleUser(user)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 ${
                    isSelected 
                      ? 'bg-orange-50 border-2 border-[#eb7825]' 
                      : 'hover:bg-gray-50 border-2 border-transparent'
                  }`}
                >
                  <div className="relative">
                    <div className="w-10 h-10 bg-[#eb7825] rounded-full flex items-center justify-center">
                      <span className="text-white font-medium">{user.name[0]}</span>
                    </div>
                    {user.isOnline && (
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-white rounded-full" />
                    )}
                  </div>
                  
                  <div className="flex-1 text-left">
                    <h4 className="font-medium text-gray-900">{user.name}</h4>
                    <p className="text-sm text-gray-500">
                      {user.isOnline ? 'Online' : `Last seen ${user.lastSeen}`}
                    </p>
                  </div>

                  {isSelected && (
                    <Check className="w-5 h-5 text-[#eb7825]" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100">
          <button
            onClick={handleInvite}
            disabled={selectedUsers.length === 0}
            className="w-full bg-[#eb7825] text-white py-3 px-6 rounded-xl font-medium hover:bg-[#d6691f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Send className="w-4 h-4" />
            Send Invite{selectedUsers.length > 1 ? 's' : ''} ({selectedUsers.length})
          </button>
        </div>
      </div>
    </div>
  );
}