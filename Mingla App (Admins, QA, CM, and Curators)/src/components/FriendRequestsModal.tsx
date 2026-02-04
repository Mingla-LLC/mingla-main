import React, { useState } from 'react';
import { X, UserCheck, UserX, Check, Users, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface FriendRequest {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  mutualFriends: number;
  requestedAt: string;
}

interface FriendRequestsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const mockFriendRequests: FriendRequest[] = [
  {
    id: 'req-1',
    name: 'Alex Johnson',
    username: 'alexjohnson',
    avatar: undefined,
    mutualFriends: 7,
    requestedAt: '2 hours ago'
  },
  {
    id: 'req-2', 
    name: 'Emily Chen',
    username: 'emilychen',
    avatar: undefined,
    mutualFriends: 3,
    requestedAt: '1 day ago'
  },
  {
    id: 'req-3',
    name: 'Michael Brown',
    username: 'mikebrown', 
    avatar: undefined,
    mutualFriends: 5,
    requestedAt: '3 days ago'
  }
];

const mockSentRequests: FriendRequest[] = [
  {
    id: 'sent-1',
    name: 'Jessica Parker',
    username: 'jessicap',
    avatar: undefined,
    mutualFriends: 12,
    requestedAt: '5 hours ago'
  },
  {
    id: 'sent-2',
    name: 'Ryan Martinez',
    username: 'ryanm',
    avatar: undefined,
    mutualFriends: 2,
    requestedAt: '2 days ago'
  }
];

export default function FriendRequestsModal({ isOpen, onClose }: FriendRequestsModalProps) {
  const [activeTab, setActiveTab] = useState<'received' | 'sent'>('received');
  const [requests, setRequests] = useState<FriendRequest[]>(mockFriendRequests);
  const [sentRequests, setSentRequests] = useState<FriendRequest[]>(mockSentRequests);
  const [processedRequests, setProcessedRequests] = useState<{[key: string]: 'accepted' | 'declined'}>({});
  const [cancelledRequests, setCancelledRequests] = useState<Set<string>>(new Set());

  const handleAcceptRequest = (requestId: string) => {
    setProcessedRequests(prev => ({ ...prev, [requestId]: 'accepted' }));
    
    // Remove from requests after animation
    setTimeout(() => {
      setRequests(prev => prev.filter(req => req.id !== requestId));
      setProcessedRequests(prev => {
        const newState = { ...prev };
        delete newState[requestId];
        return newState;
      });
    }, 1500);
  };

  const handleDeclineRequest = (requestId: string) => {
    setProcessedRequests(prev => ({ ...prev, [requestId]: 'declined' }));
    
    // Remove from requests after animation
    setTimeout(() => {
      setRequests(prev => prev.filter(req => req.id !== requestId));
      setProcessedRequests(prev => {
        const newState = { ...prev };
        delete newState[requestId];
        return newState;
      });
    }, 1500);
  };

  const handleCancelSentRequest = (requestId: string) => {
    setCancelledRequests(prev => new Set([...prev, requestId]));
    
    // Remove from sent requests after animation
    setTimeout(() => {
      setSentRequests(prev => prev.filter(req => req.id !== requestId));
      setCancelledRequests(prev => {
        const newState = new Set(prev);
        newState.delete(requestId);
        return newState;
      });
    }, 1500);
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
        <div className="p-6 border-b border-gray-100/50">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-2xl flex items-center justify-center shadow-lg">
                <UserCheck className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold bg-gradient-to-r from-[#eb7825] to-[#d6691f] bg-clip-text text-transparent">
                  Friend Requests
                </h2>
                <p className="text-sm text-gray-600">
                  {activeTab === 'received' ? requests.length : sentRequests.length} {activeTab === 'received' ? 'pending' : 'sent'} {(activeTab === 'received' ? requests.length : sentRequests.length) === 1 ? 'request' : 'requests'}
                </p>
              </div>
            </div>
            <button 
              onClick={onClose}
              className="p-2 hover:bg-gray-100/80 rounded-full transition-all duration-300 hover:scale-110 active:scale-95 backdrop-blur-xl"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 p-1 bg-gray-100/80 backdrop-blur-sm rounded-xl">
            <button
              onClick={() => setActiveTab('received')}
              className={`flex-1 py-2.5 rounded-lg font-medium transition-all duration-300 ${
                activeTab === 'received'
                  ? 'bg-white shadow-sm text-gray-900'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Received ({requests.length})
            </button>
            <button
              onClick={() => setActiveTab('sent')}
              className={`flex-1 py-2.5 rounded-lg font-medium transition-all duration-300 ${
                activeTab === 'sent'
                  ? 'bg-white shadow-sm text-gray-900'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Sent ({sentRequests.length})
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'received' ? (
            requests.length === 0 ? (
              <motion.div 
                key="received-empty"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-8 text-center"
              >
                <div className="w-20 h-20 bg-gradient-to-br from-orange-50 to-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Users className="w-10 h-10 text-[#eb7825]" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">No Friend Requests</h3>
                <p className="text-sm text-gray-600">
                  You're all caught up! New friend requests will appear here.
                </p>
              </motion.div>
            ) : (
              <div className="p-4 space-y-3">
                <AnimatePresence mode="popLayout">
                  {requests.map((request) => {
                    const status = processedRequests[request.id];
                    
                    return (
                      <motion.div
                        key={request.id}
                        layout
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, x: status === 'accepted' ? 100 : -100 }}
                        transition={{ duration: 0.3 }}
                        className={`bg-white/80 backdrop-blur-sm border rounded-2xl p-4 transition-all duration-300 shadow-sm hover:shadow-md ${
                          status === 'accepted' ? 'border-green-300 bg-green-50/80' : 
                          status === 'declined' ? 'border-red-300 bg-red-50/80' : 
                          'border-gray-200'
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          {/* Avatar */}
                          <motion.div 
                            className="relative flex-shrink-0"
                            whileHover={{ scale: 1.05 }}
                            transition={{ duration: 0.2 }}
                          >
                            <div className="w-14 h-14 bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-2xl flex items-center justify-center shadow-md">
                              <span className="text-white font-semibold text-lg">
                                {request.name.split(' ').map(n => n[0]).join('')}
                              </span>
                            </div>
                          </motion.div>
                          
                          {/* User Info */}
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-gray-900 truncate">{request.name}</h4>
                            <p className="text-sm text-gray-600 truncate">@{request.username}</p>
                            {request.mutualFriends > 0 && (
                              <p className="text-xs text-gray-500 mt-0.5">{request.mutualFriends} mutual friends</p>
                            )}
                            <p className="text-xs text-gray-400 mt-0.5">{request.requestedAt}</p>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {status === 'accepted' ? (
                              <motion.div 
                                initial={{ scale: 0.8 }}
                                animate={{ scale: 1 }}
                                className="flex items-center gap-2 text-green-700 bg-green-100/80 backdrop-blur-sm px-3 py-2 rounded-xl font-medium"
                              >
                                <Check className="w-4 h-4" />
                                <span className="text-sm">Accepted</span>
                              </motion.div>
                            ) : status === 'declined' ? (
                              <motion.div 
                                initial={{ scale: 0.8 }}
                                animate={{ scale: 1 }}
                                className="flex items-center gap-2 text-red-700 bg-red-100/80 backdrop-blur-sm px-3 py-2 rounded-xl font-medium"
                              >
                                <X className="w-4 h-4" />
                                <span className="text-sm">Declined</span>
                              </motion.div>
                            ) : (
                              <>
                                <motion.button
                                  whileHover={{ scale: 1.05 }}
                                  whileTap={{ scale: 0.95 }}
                                  onClick={() => handleDeclineRequest(request.id)}
                                  className="p-2.5 bg-gray-100/80 backdrop-blur-sm hover:bg-red-100 hover:text-red-600 rounded-xl transition-all duration-300"
                                  title="Decline"
                                >
                                  <UserX className="w-5 h-5" />
                                </motion.button>
                                <motion.button
                                  whileHover={{ scale: 1.05 }}
                                  whileTap={{ scale: 0.95 }}
                                  onClick={() => handleAcceptRequest(request.id)}
                                  className="p-2.5 bg-gradient-to-br from-[#eb7825] to-[#d6691f] hover:shadow-lg text-white rounded-xl transition-all duration-300"
                                  title="Accept"
                                >
                                  <UserCheck className="w-5 h-5" />
                                </motion.button>
                              </>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )
          ) : (
            // Sent Requests Tab
            sentRequests.length === 0 ? (
              <motion.div 
                key="sent-empty"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-8 text-center"
              >
                <div className="w-20 h-20 bg-gradient-to-br from-orange-50 to-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Clock className="w-10 h-10 text-[#eb7825]" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">No Sent Requests</h3>
                <p className="text-sm text-gray-600">
                  You haven't sent any friend requests yet.
                </p>
              </motion.div>
            ) : (
              <div className="p-4 space-y-3">
                <AnimatePresence mode="popLayout">
                  {sentRequests.map((request) => {
                    const isCancelled = cancelledRequests.has(request.id);
                    
                    return (
                      <motion.div
                        key={request.id}
                        layout
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, x: -100 }}
                        transition={{ duration: 0.3 }}
                        className={`bg-white/80 backdrop-blur-sm border rounded-2xl p-4 transition-all duration-300 shadow-sm hover:shadow-md ${
                          isCancelled ? 'border-gray-300 bg-gray-50/80' : 'border-gray-200'
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          {/* Avatar */}
                          <motion.div 
                            className="relative flex-shrink-0"
                            whileHover={{ scale: 1.05 }}
                            transition={{ duration: 0.2 }}
                          >
                            <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-md">
                              <span className="text-white font-semibold text-lg">
                                {request.name.split(' ').map(n => n[0]).join('')}
                              </span>
                            </div>
                            {/* Pending indicator */}
                            <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-orange-500 rounded-full flex items-center justify-center border-2 border-white shadow-md">
                              <Clock className="w-3 h-3 text-white" />
                            </div>
                          </motion.div>
                          
                          {/* User Info */}
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-gray-900 truncate">{request.name}</h4>
                            <p className="text-sm text-gray-600 truncate">@{request.username}</p>
                            {request.mutualFriends > 0 && (
                              <p className="text-xs text-gray-500 mt-0.5">{request.mutualFriends} mutual friends</p>
                            )}
                            <p className="text-xs text-gray-400 mt-0.5">Sent {request.requestedAt}</p>
                          </div>

                          {/* Cancel Button */}
                          <div className="flex-shrink-0">
                            {isCancelled ? (
                              <motion.div 
                                initial={{ scale: 0.8 }}
                                animate={{ scale: 1 }}
                                className="flex items-center gap-2 text-gray-700 bg-gray-100/80 backdrop-blur-sm px-3 py-2 rounded-xl font-medium"
                              >
                                <X className="w-4 h-4" />
                                <span className="text-sm">Cancelled</span>
                              </motion.div>
                            ) : (
                              <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => handleCancelSentRequest(request.id)}
                                className="px-4 py-2 bg-gray-100/80 backdrop-blur-sm hover:bg-red-100 hover:text-red-600 rounded-xl transition-all duration-300 text-sm font-medium"
                              >
                                Cancel
                              </motion.button>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )
          )}
        </div>

        {/* Footer */}
        {((activeTab === 'received' && requests.length > 0) || (activeTab === 'sent' && sentRequests.length > 0)) && (
          <div className="p-4 border-t border-gray-100/50 bg-gradient-to-b from-transparent to-gray-50/50 rounded-b-3xl">
            <p className="text-xs text-gray-500 text-center">
              {activeTab === 'received' 
                ? 'Accept or decline friend requests to manage your connections' 
                : 'Your sent requests are pending approval'}
            </p>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}