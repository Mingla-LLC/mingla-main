import React from 'react';
import { motion } from 'motion/react';
import { X, Clock, Mail, CheckCircle } from 'lucide-react';
import { CollaborationSession } from './CollaborationSessions';

interface InviteNotificationModalProps {
  session: CollaborationSession;
  onClose: () => void;
  onAccept?: (sessionId: string) => void;
  onDecline?: (sessionId: string) => void;
}

export default function InviteNotificationModal({
  session,
  onClose,
  onAccept,
  onDecline
}: InviteNotificationModalProps) {
  const isSentInvite = session.type === 'sent-invite';
  const isReceivedInvite = session.type === 'received-invite';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white/95 backdrop-blur-2xl rounded-3xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-200/50 bg-gradient-to-r from-orange-50 to-amber-50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/60 rounded-xl backdrop-blur-xl shadow-lg">
              {isSentInvite ? (
                <Mail className="w-5 h-5 text-[#eb7825]" />
              ) : (
                <CheckCircle className="w-5 h-5 text-[#eb7825]" />
              )}
            </div>
            <div>
              <h3 className="font-bold text-gray-900">
                {isSentInvite ? 'Invite Sent' : 'Collaboration Invite'}
              </h3>
              <p className="text-xs text-gray-600">Session: {session.name}</p>
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            className="p-2 hover:bg-white/50 rounded-xl transition-colors"
          >
            <X className="w-5 h-5 text-gray-600" />
          </motion.button>
        </div>

        {/* Content */}
        <div className="p-6">
          {isSentInvite ? (
            <div className="space-y-4">
              <div className="flex items-center justify-center">
                <div className="p-4 bg-orange-50 rounded-full">
                  <Clock className="w-8 h-8 text-[#eb7825]" />
                </div>
              </div>
              <div className="text-center">
                <h4 className="font-bold text-gray-900 mb-2">Awaiting Response</h4>
                <p className="text-sm text-gray-600">
                  Your collaboration invite for <span className="font-semibold text-[#eb7825]">{session.name}</span> has been sent. 
                  You'll be notified once the recipient accepts.
                </p>
              </div>
              <div className="p-4 bg-gradient-to-r from-orange-50/50 to-amber-50/50 rounded-2xl border border-orange-200/30">
                <p className="text-xs text-gray-600 text-center">
                  <Clock className="w-3 h-3 inline mr-1" />
                  Invite sent {session.createdAt ? new Date(session.createdAt).toLocaleDateString() : 'recently'}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-center">
                <div className="p-4 bg-gradient-to-br from-[#eb7825]/10 to-[#d6691f]/10 rounded-full">
                  <CheckCircle className="w-8 h-8 text-[#eb7825]" />
                </div>
              </div>
              <div className="text-center">
                <h4 className="font-bold text-gray-900 mb-2">Collaboration Invite</h4>
                <p className="text-sm text-gray-600">
                  You've been invited to join <span className="font-semibold text-[#eb7825]">{session.name}</span>. 
                  Accept to start collaborating!
                </p>
              </div>
              <div className="flex gap-3">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    if (onAccept) onAccept(session.id);
                    onClose();
                  }}
                  className="flex-1 py-3 bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white font-semibold rounded-2xl shadow-lg shadow-[#eb7825]/30"
                >
                  Accept Invite
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    if (onDecline) onDecline(session.id);
                    onClose();
                  }}
                  className="flex-1 py-3 bg-gray-100 text-gray-700 font-semibold rounded-2xl hover:bg-gray-200 transition-all"
                >
                  Decline
                </motion.button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {isSentInvite && (
          <div className="px-6 pb-6">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onClose}
              className="w-full py-3 bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white font-semibold rounded-2xl shadow-lg shadow-[#eb7825]/30"
            >
              Got it
            </motion.button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
