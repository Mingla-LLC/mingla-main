import React from 'react';
import { motion } from 'motion/react';
import { MessageCircle, FileText, X, Clock, Zap, History } from 'lucide-react';

interface SupportOptionsProps {
  onClose: () => void;
  onLiveChat: () => void;
  onSubmitTicket: () => void;
  onViewHistory?: () => void;
  chatHistoryCount?: number;
}

export default function SupportOptions({ onClose, onLiveChat, onSubmitTicket, onViewHistory, chatHistoryCount }: SupportOptionsProps) {
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
              <MessageCircle className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-white">Get Support</h3>
              <p className="text-xs text-white/90">Choose how we can help</p>
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

        {/* Options */}
        <div className="p-5 space-y-3">
          {/* Live Chat Option */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onLiveChat}
            className="w-full p-5 bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200/50 rounded-2xl text-left hover:border-green-300 transition-all shadow-lg hover:shadow-xl"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl shadow-lg">
                <MessageCircle className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-bold text-gray-900">Start Live Chat</h4>
                  <div className="flex items-center gap-1 px-2 py-0.5 bg-green-500 rounded-full">
                    <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                    <span className="text-xs font-medium text-white">Online</span>
                  </div>
                </div>
                <p className="text-sm text-gray-600 mb-2">
                  Chat with our support team in real-time for immediate assistance
                </p>
                <div className="flex items-center gap-1 text-xs text-green-700">
                  <Zap className="w-3 h-3" />
                  <span className="font-medium">Avg. response: 2 minutes</span>
                </div>
              </div>
            </div>
          </motion.button>

          {/* Submit Ticket Option */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onSubmitTicket}
            className="w-full p-5 bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200/50 rounded-2xl text-left hover:border-blue-300 transition-all shadow-lg hover:shadow-xl"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl shadow-lg">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-gray-900 mb-1">Submit a Ticket</h4>
                <p className="text-sm text-gray-600 mb-2">
                  Send a detailed support request and we'll get back to you via email
                </p>
                <div className="flex items-center gap-1 text-xs text-blue-700">
                  <Clock className="w-3 h-3" />
                  <span className="font-medium">Response within 24 hours</span>
                </div>
              </div>
            </div>
          </motion.button>

          {/* View History Option */}
          {onViewHistory && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onViewHistory}
              className="w-full p-4 bg-gradient-to-br from-gray-50 to-slate-50 border-2 border-gray-200/50 rounded-2xl text-left hover:border-gray-300 transition-all shadow-lg hover:shadow-xl"
            >
              <div className="flex items-center gap-4">
                <div className="p-2.5 bg-gradient-to-br from-gray-600 to-slate-700 rounded-2xl shadow-lg">
                  <History className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-gray-900">View Support History</h4>
                    {chatHistoryCount !== undefined && chatHistoryCount > 0 && (
                      <span className="px-2 py-0.5 bg-[#eb7825] text-white text-xs font-semibold rounded-full">
                        {chatHistoryCount}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mt-0.5">
                    View past chats and submitted tickets
                  </p>
                </div>
              </div>
            </motion.button>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5">
          <div className="p-3 bg-gray-50/50 rounded-xl border border-gray-200/50">
            <p className="text-xs text-gray-600 text-center">
              Need urgent help? Choose Live Chat for immediate support
            </p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}