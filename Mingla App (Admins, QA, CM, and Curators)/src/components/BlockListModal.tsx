import React, { useState } from 'react';
import { X, Shield, ShieldOff, UserX } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface BlockedUser {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  blockedAt: string;
}

interface BlockListModalProps {
  isOpen: boolean;
  onClose: () => void;
  blockedUsers: Set<string>;
  onUnblockUser: (userId: string) => void;
}

const mockBlockedUsers: BlockedUser[] = [
  {
    id: 'blocked-1',
    name: 'John Smith',
    username: 'johnsmith',
    avatar: undefined,
    blockedAt: '2 days ago'
  },
  {
    id: 'blocked-2',
    name: 'Sarah Williams',
    username: 'sarahw',
    avatar: undefined,
    blockedAt: '1 week ago'
  },
  {
    id: 'blocked-3',
    name: 'David Jones',
    username: 'davidjones',
    avatar: undefined,
    blockedAt: '2 weeks ago'
  }
];

export default function BlockListModal({ 
  isOpen, 
  onClose, 
  blockedUsers,
  onUnblockUser 
}: BlockListModalProps) {
  const [users, setUsers] = useState<BlockedUser[]>(mockBlockedUsers);
  const [processingUnblock, setProcessingUnblock] = useState<{[key: string]: boolean}>({});

  const handleUnblockUser = (userId: string) => {
    setProcessingUnblock(prev => ({ ...prev, [userId]: true }));
    
    // Simulate unblock action with delay
    setTimeout(() => {
      onUnblockUser(userId);
      setUsers(prev => prev.filter(user => user.id !== userId));
      setProcessingUnblock(prev => {
        const newState = { ...prev };
        delete newState[userId];
        return newState;
      });
    }, 800);
  };

  if (!isOpen) return null;

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ 
          type: "spring", 
          damping: 25, 
          stiffness: 300 
        }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white/95 backdrop-blur-xl rounded-3xl w-full max-w-md mx-auto shadow-[0_20px_60px_rgba(0,0,0,0.3)] border border-white/50 max-h-[80vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100/50">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-red-500 to-red-600 rounded-2xl flex items-center justify-center shadow-lg">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                Blocked Users
              </h2>
              <p className="text-sm text-gray-600">{users.length} {users.length === 1 ? 'user' : 'users'} blocked</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-gray-100/80 rounded-full transition-all duration-300 hover:scale-110 active:scale-95 backdrop-blur-xl"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {users.length === 0 ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-8 text-center"
            >
              <div className="w-20 h-20 bg-gradient-to-br from-gray-100 to-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <ShieldOff className="w-10 h-10 text-gray-400" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">No Blocked Users</h3>
              <p className="text-sm text-gray-600">
                You haven't blocked anyone yet. Blocked users will appear here.
              </p>
            </motion.div>
          ) : (
            <div className="p-4 space-y-3">
              <AnimatePresence mode="popLayout">
                {users.map((user) => {
                  const isProcessing = processingUnblock[user.id];
                  
                  return (
                    <motion.div
                      key={user.id}
                      layout
                      initial={{ opacity: 0, scale: 0.95, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, x: -100 }}
                      transition={{ duration: 0.3 }}
                      className={`bg-white/80 backdrop-blur-sm border rounded-2xl p-4 transition-all duration-300 shadow-sm hover:shadow-md ${
                        isProcessing ? 'border-green-300 bg-green-50/80' : 'border-gray-200'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        {/* Avatar */}
                        <motion.div 
                          className="relative flex-shrink-0"
                          whileHover={{ scale: 1.05 }}
                          transition={{ duration: 0.2 }}
                        >
                          <div className="w-14 h-14 bg-gradient-to-br from-gray-400 to-gray-500 rounded-2xl flex items-center justify-center shadow-md">
                            <span className="text-white font-semibold text-lg">
                              {user.name.split(' ').map(n => n[0]).join('')}
                            </span>
                          </div>
                          {/* Blocked indicator */}
                          <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center border-2 border-white shadow-md">
                            <UserX className="w-3 h-3 text-white" />
                          </div>
                        </motion.div>
                        
                        {/* User Info */}
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-gray-900 truncate">{user.name}</h4>
                          <p className="text-sm text-gray-600 truncate">@{user.username}</p>
                          <p className="text-xs text-gray-400 mt-0.5">Blocked {user.blockedAt}</p>
                        </div>

                        {/* Unblock Button */}
                        <div className="flex-shrink-0">
                          {isProcessing ? (
                            <motion.div 
                              initial={{ scale: 0.8 }}
                              animate={{ scale: 1 }}
                              className="flex items-center gap-2 text-green-700 bg-green-100/80 backdrop-blur-sm px-4 py-2 rounded-xl font-medium"
                            >
                              <span className="text-sm">Unblocked</span>
                            </motion.div>
                          ) : (
                            <motion.button
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => handleUnblockUser(user.id)}
                              className="px-4 py-2 bg-gradient-to-br from-[#eb7825] to-[#d6691f] hover:shadow-lg text-white rounded-xl transition-all duration-300 text-sm font-medium"
                            >
                              Unblock
                            </motion.button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Footer */}
        {users.length > 0 && (
          <div className="p-4 border-t border-gray-100/50 bg-gradient-to-b from-transparent to-gray-50/50 rounded-b-3xl">
            <p className="text-xs text-gray-500 text-center">
              Blocked users can't message you or see your activity
            </p>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
