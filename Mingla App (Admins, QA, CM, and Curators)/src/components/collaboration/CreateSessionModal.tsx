import React, { useState } from 'react';
import { motion } from 'motion/react';
import { X, Users, Plus } from 'lucide-react';

interface CreateSessionModalProps {
  onClose: () => void;
  onCreate: (name: string, inviteEmails?: string[]) => void;
}

export default function CreateSessionModal({ onClose, onCreate }: CreateSessionModalProps) {
  const [sessionName, setSessionName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteEmails, setInviteEmails] = useState<string[]>([]);

  const handleAddEmail = () => {
    if (inviteEmail.trim() && !inviteEmails.includes(inviteEmail.trim())) {
      setInviteEmails([...inviteEmails, inviteEmail.trim()]);
      setInviteEmail('');
    }
  };

  const handleRemoveEmail = (email: string) => {
    setInviteEmails(inviteEmails.filter(e => e !== email));
  };

  const handleCreate = () => {
    if (sessionName.trim()) {
      onCreate(sessionName.trim(), inviteEmails.length > 0 ? inviteEmails : undefined);
      onClose();
    }
  };

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
        <div className="flex items-center justify-between p-5 border-b border-gray-200/50 bg-gradient-to-r from-[#eb7825] to-[#d6691f]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl backdrop-blur-xl">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-white">New Collaboration</h3>
              <p className="text-xs text-white/90">Create a session to work together</p>
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-xl transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </motion.button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Session Name */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-2">
              Session Name *
            </label>
            <input
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="e.g., Weekend Trip Planning"
              className="w-full px-4 py-3 bg-gray-50/80 border border-gray-200/50 rounded-2xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#eb7825]/30 focus:border-[#eb7825]/50 transition-all"
            />
          </div>

          {/* Invite Collaborators */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-2">
              Invite Collaborators (Optional)
            </label>
            <div className="flex gap-2 mb-3">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddEmail()}
                placeholder="email@example.com"
                className="flex-1 px-4 py-3 bg-gray-50/80 border border-gray-200/50 rounded-2xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#eb7825]/30 focus:border-[#eb7825]/50 transition-all"
              />
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleAddEmail}
                disabled={!inviteEmail.trim()}
                className={`p-3 rounded-2xl transition-all ${
                  inviteEmail.trim()
                    ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-lg shadow-[#eb7825]/30'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                <Plus className="w-5 h-5" />
              </motion.button>
            </div>

            {/* Email List */}
            {inviteEmails.length > 0 && (
              <div className="space-y-2">
                {inviteEmails.map((email) => (
                  <motion.div
                    key={email}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="flex items-center justify-between p-3 bg-orange-50/50 rounded-xl border border-orange-200/30"
                  >
                    <span className="text-sm text-gray-700">{email}</span>
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => handleRemoveEmail(email)}
                      className="p-1 hover:bg-white/50 rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4 text-gray-500" />
                    </motion.button>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="p-3 bg-gradient-to-r from-orange-50/50 to-amber-50/50 rounded-2xl border border-orange-200/30">
            <p className="text-xs text-gray-600">
              <Users className="w-3 h-3 inline mr-1" />
              Collaborators can view and contribute to shared experiences in real-time
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onClose}
            className="flex-1 py-3 bg-gray-100 text-gray-700 font-semibold rounded-2xl hover:bg-gray-200 transition-all"
          >
            Cancel
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleCreate}
            disabled={!sessionName.trim()}
            className={`flex-1 py-3 font-semibold rounded-2xl transition-all ${
              sessionName.trim()
                ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-lg shadow-[#eb7825]/30'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            Create Session
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
