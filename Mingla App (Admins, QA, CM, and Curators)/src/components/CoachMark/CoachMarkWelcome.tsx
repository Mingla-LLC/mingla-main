import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Sparkles, MessageSquare, X } from 'lucide-react';
import FeedbackModal from '../FeedbackModal';

interface CoachMarkWelcomeProps {
  onStart: () => void;
  onFeedback?: () => void;
  onClose?: () => void;
}

export default function CoachMarkWelcome({ onStart, onFeedback, onClose }: CoachMarkWelcomeProps) {
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);

  const handleFeedback = () => {
    if (onFeedback) {
      onFeedback();
    } else {
      setShowFeedbackModal(true);
    }
  };

  const handleClose = () => {
    if (onClose) {
      onClose();
    }
  };

  return (
    <>
      <FeedbackModal isOpen={showFeedbackModal} onClose={() => setShowFeedbackModal(false)} />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
        className="fixed inset-0 z-[10001] flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.9, y: 20 }}
          transition={{ 
            duration: 0.6,
            ease: [0.16, 1, 0.3, 1]
          }}
          className="relative w-full max-w-md"
        >
          {/* Gradient border wrapper */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#eb7825] via-[#d6691f] to-[#eb7825] rounded-3xl blur-sm" />
          
          {/* Main card */}
          <div className="relative bg-white/98 backdrop-blur-xl rounded-3xl shadow-2xl overflow-hidden border border-white/20">
            {/* Animated background gradient */}
            <motion.div
              animate={{
                opacity: [0.05, 0.12, 0.05],
                scale: [1, 1.05, 1],
              }}
              transition={{
                duration: 4,
                repeat: Infinity,
                ease: 'easeInOut'
              }}
              className="absolute inset-0 bg-gradient-to-br from-[#eb7825]/20 via-[#d6691f]/10 to-[#eb7825]/20"
            />

            {/* Floating orbs */}
            <motion.div
              animate={{
                x: [0, 20, 0],
                y: [0, -15, 0],
                opacity: [0.2, 0.4, 0.2]
              }}
              transition={{
                duration: 5,
                repeat: Infinity,
                ease: 'easeInOut'
              }}
              className="absolute top-16 right-16 w-24 h-24 bg-gradient-to-br from-[#eb7825]/30 to-[#d6691f]/30 rounded-full blur-2xl"
            />
            <motion.div
              animate={{
                x: [0, -20, 0],
                y: [0, 15, 0],
                opacity: [0.2, 0.4, 0.2]
              }}
              transition={{
                duration: 6,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: 1
              }}
              className="absolute bottom-16 left-16 w-32 h-32 bg-gradient-to-br from-[#d6691f]/30 to-[#eb7825]/30 rounded-full blur-2xl"
            />

            {/* Content */}
            <div className="relative px-8 sm:px-10 py-16 sm:py-20 space-y-4">
              {/* Close button */}
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.9 }}
                onClick={handleClose}
                className="absolute top-3 right-5 z-10 p-2.5 rounded-full bg-gray-100/80 backdrop-blur-sm text-gray-500 hover:text-gray-700 hover:bg-gray-200/80 transition-all duration-200"
              >
                <X className="w-5 h-5" />
              </motion.button>

              {/* Two Action Buttons */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.5 }}
                className="space-y-3"
              >
                {/* Start Tour Button */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onStart}
                  className="w-full py-3.5 sm:py-4 bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white rounded-2xl font-bold text-base sm:text-lg shadow-xl hover:shadow-2xl transition-all duration-300 relative overflow-hidden group"
                >
                  {/* Button shine effect */}
                  <motion.div
                    animate={{
                      x: ['-100%', '200%']
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      repeatDelay: 1,
                      ease: 'easeInOut'
                    }}
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                  />
                  
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    <Sparkles className="w-4 h-4 sm:w-5 sm:h-5" />
                    Start Tour
                  </span>
                </motion.button>

                {/* Give Feedback Button */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleFeedback}
                  className="w-full py-3.5 sm:py-4 bg-white/80 backdrop-blur-sm border-2 border-gray-200 text-gray-700 rounded-2xl font-semibold text-base sm:text-lg shadow-lg hover:shadow-xl hover:border-[#eb7825]/30 hover:bg-white transition-all duration-300 relative overflow-hidden group"
                >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5 text-[#eb7825]" />
                    Give Feedback
                  </span>
                </motion.button>
              </motion.div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </>
  );
}