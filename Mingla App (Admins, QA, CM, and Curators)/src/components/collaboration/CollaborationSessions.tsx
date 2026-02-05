import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, ChevronLeft, ChevronRight, X, Check, UserX } from 'lucide-react';
import { createPortal } from 'react-dom';

export interface CollaborationSession {
  id: string;
  name: string;
  initials: string;
  type: 'active' | 'sent-invite' | 'received-invite';
  participants?: number;
  createdAt?: Date;
}

interface CollaborationSessionsProps {
  sessions: CollaborationSession[];
  selectedSessionId: string | null;
  onSessionSelect: (sessionId: string | null) => void;
  onCreateSession: () => void;
  onInviteClick: (session: CollaborationSession) => void;
  onAcceptInvite?: (sessionId: string) => void;
  onDeclineInvite?: (sessionId: string) => void;
  onCancelInvite?: (sessionId: string) => void;
}

export default function CollaborationSessions({
  sessions,
  selectedSessionId,
  onSessionSelect,
  onCreateSession,
  onInviteClick,
  onAcceptInvite,
  onDeclineInvite,
  onCancelInvite
}: CollaborationSessionsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  const [inviteModalSession, setInviteModalSession] = useState<CollaborationSession | null>(null);

  const hasActiveSessions = sessions.some(s => s.type === 'active');
  
  // Sort sessions: active sessions first, then invites
  const sortedSessions = [...sessions].sort((a, b) => {
    const inviteTypes = ['sent-invite', 'received-invite'];
    const aIsInvite = inviteTypes.includes(a.type);
    const bIsInvite = inviteTypes.includes(b.type);
    
    if (!aIsInvite && bIsInvite) return -1;
    if (aIsInvite && !bIsInvite) return 1;
    return 0;
  });

  const checkScroll = () => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setShowLeftArrow(scrollLeft > 0);
      setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10);
    }
  };

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 200;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  React.useEffect(() => {
    checkScroll();
    const scrollElement = scrollRef.current;
    if (scrollElement) {
      scrollElement.addEventListener('scroll', checkScroll);
      window.addEventListener('resize', checkScroll);
      return () => {
        scrollElement.removeEventListener('scroll', checkScroll);
        window.removeEventListener('resize', checkScroll);
      };
    }
  }, [sessions]);

  const handlePillClick = (session: CollaborationSession) => {
    if (session.type === 'sent-invite' || session.type === 'received-invite') {
      setInviteModalSession(session);
    } else {
      onSessionSelect(session.id);
    }
  };

  return (
    <div className="relative flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-orange-50/80 via-white/90 to-orange-50/80 backdrop-blur-xl rounded-full border border-white/50 shadow-[0_4px_20px_rgba(235,120,37,0.12)] w-full">
      {/* Left Scroll Arrow */}
      <AnimatePresence>
        {showLeftArrow && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => scroll('left')}
            className="absolute left-1 z-10 p-1 bg-white/90 backdrop-blur-sm rounded-full shadow-lg hover:bg-white transition-all"
          >
            <ChevronLeft className="w-3 h-3 text-gray-600" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Scrollable Container */}
      <div
        ref={scrollRef}
        className="flex items-center gap-2 overflow-x-auto scrollbar-hide flex-1"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        data-coachmark="collaboration-sessions"
      >
        {/* Solo Button (when there are active sessions) */}
        {hasActiveSessions && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onSessionSelect(null)}
            className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
              selectedSessionId === null
                ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-lg shadow-[#eb7825]/30'
                : 'bg-white/80 text-gray-700 hover:bg-white border border-gray-200/50'
            }`}
            data-coachmark="solo-button"
          >
            Solo
          </motion.button>
        )}

        {/* Plus Button */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onCreateSession}
          className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center shadow-lg shadow-[#eb7825]/30 hover:shadow-xl transition-all"
          data-coachmark="create-session-button"
        >
          <Plus className="w-4 h-4 text-white" />
        </motion.button>

        {/* Session Pills */}
        {sortedSessions.map((session) => {
          const isInvite = session.type === 'sent-invite' || session.type === 'received-invite';
          const isSelected = session.id === selectedSessionId && !isInvite;

          return (
            <motion.button
              key={session.id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              whileHover={{ scale: isInvite ? 1.02 : 1.05 }}
              whileTap={{ scale: isInvite ? 0.98 : 0.95 }}
              onClick={() => handlePillClick(session)}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                isInvite
                  ? 'bg-gray-100/80 text-gray-400 border border-gray-200/60 cursor-pointer hover:bg-gray-200/80'
                  : isSelected
                  ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-lg shadow-[#eb7825]/30'
                  : 'bg-white/80 text-gray-700 hover:bg-white border border-gray-200/50'
              }`}
              data-coachmark={session.type === 'active' ? 'session-pill' : 'invite-pill'}
            >
              {session.initials}
            </motion.button>
          );
        })}
      </div>

      {/* Right Scroll Arrow */}
      <AnimatePresence>
        {showRightArrow && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => scroll('right')}
            className="absolute right-1 z-10 p-1 bg-white/90 backdrop-blur-sm rounded-full shadow-lg hover:bg-white transition-all"
          >
            <ChevronRight className="w-3 h-3 text-gray-600" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Invite Action Modal */}
      {inviteModalSession && typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed top-0 left-0 right-0 bottom-0 z-[9999] bg-black/50 backdrop-blur-sm"
            style={{ 
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '1rem'
            }}
            onClick={() => setInviteModalSession(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden"
              style={{ maxWidth: '400px', width: '100%' }}
            >
              {/* Header */}
              <div className="p-6 border-b border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xl font-semibold text-gray-900">
                    {inviteModalSession.type === 'sent-invite' ? 'Sent Invite' : 'Received Invite'}
                  </h3>
                  <button
                    onClick={() => setInviteModalSession(null)}
                    className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                  >
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
                <p className="text-gray-600">
                  {inviteModalSession.type === 'sent-invite' 
                    ? `You sent an invite to ${inviteModalSession.name}` 
                    : `${inviteModalSession.name} invited you to collaborate`}
                </p>
              </div>

              {/* Actions */}
              <div className="p-6">
                {inviteModalSession.type === 'received-invite' ? (
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        if (onAcceptInvite) {
                          onAcceptInvite(inviteModalSession.id);
                        }
                        setInviteModalSession(null);
                      }}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white rounded-xl font-semibold hover:shadow-lg hover:shadow-[#eb7825]/30 transition-all"
                    >
                      <Check className="w-5 h-5" />
                      Accept
                    </button>
                    <button
                      onClick={() => {
                        if (onDeclineInvite) {
                          onDeclineInvite(inviteModalSession.id);
                        }
                        setInviteModalSession(null);
                      }}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition-colors"
                    >
                      <UserX className="w-5 h-5" />
                      Decline
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <button
                      onClick={() => {
                        if (onCancelInvite) {
                          onCancelInvite(inviteModalSession.id);
                        }
                        setInviteModalSession(null);
                      }}
                      className="flex items-center justify-center gap-2 px-4 py-3 bg-red-500 text-white rounded-xl font-semibold hover:bg-red-600 transition-colors"
                    >
                      <UserX className="w-5 h-5" />
                      Cancel Invite
                    </button>
                    <button
                      onClick={() => setInviteModalSession(null)}
                      className="px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition-colors"
                    >
                      Close
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}