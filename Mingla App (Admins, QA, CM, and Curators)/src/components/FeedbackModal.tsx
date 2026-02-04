import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Upload, Image as ImageIcon, Send, Check, MessageSquare } from 'lucide-react';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function FeedbackModal({ isOpen, onClose }: FeedbackModalProps) {
  const [feedback, setFeedback] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setScreenshot(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    }
  };

  const handleRemoveScreenshot = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setScreenshot(null);
    setPreviewUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async () => {
    if (!feedback.trim() && !screenshot) return;

    setIsSubmitting(true);
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    setIsSubmitting(false);
    setIsSubmitted(true);

    // Reset and close after success animation
    setTimeout(() => {
      setFeedback('');
      handleRemoveScreenshot();
      setIsSubmitted(false);
      onClose();
    }, 2000);
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setFeedback('');
      handleRemoveScreenshot();
      setIsSubmitted(false);
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/20 backdrop-blur-md z-[10002]"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] sm:w-full sm:max-w-lg z-[10003]"
          >
            {/* Main card */}
            <div className="relative bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl overflow-hidden border border-[#eb7825]/20 flex flex-col max-h-[90vh]">
              {/* Animated background */}
              <motion.div
                animate={{
                  opacity: [0.05, 0.12, 0.05],
                }}
                transition={{
                  duration: 4,
                  repeat: Infinity,
                  ease: 'easeInOut'
                }}
                className="absolute inset-0 bg-gradient-to-br from-[#eb7825]/20 via-[#d6691f]/10 to-[#eb7825]/20 pointer-events-none"
              />

              {/* Header */}
              <div className="relative p-5 sm:p-6 border-b border-gray-200/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center shadow-lg">
                      <MessageSquare className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-lg sm:text-xl font-bold text-gray-900">Give Feedback</h3>
                      <p className="text-xs sm:text-sm text-gray-500">Help us improve Mingla</p>
                    </div>
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.1, rotate: 90 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={handleClose}
                    disabled={isSubmitting}
                    className="p-2 rounded-full bg-gray-100/80 backdrop-blur-sm text-gray-500 hover:text-gray-700 hover:bg-gray-200/80 transition-all duration-200 disabled:opacity-50"
                  >
                    <X className="w-5 h-5" />
                  </motion.button>
                </div>
              </div>

              {/* Content */}
              <div className="relative p-5 sm:p-6 space-y-4 flex-1 overflow-y-auto">
                {/* Feedback textarea */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Your Feedback
                  </label>
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="Tell us what you think, report a bug, or suggest a feature..."
                    disabled={isSubmitting || isSubmitted}
                    className="w-full h-32 sm:h-40 px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-[#eb7825] focus:ring-2 focus:ring-[#eb7825]/20 outline-none transition-all duration-200 resize-none text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>

                {/* Screenshot upload */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Screenshot (Optional)
                  </label>
                  
                  {!previewUrl ? (
                    <motion.button
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isSubmitting || isSubmitted}
                      className="w-full p-6 sm:p-8 rounded-xl border-2 border-dashed border-gray-300 hover:border-[#eb7825] bg-gray-50/50 hover:bg-gray-100/50 transition-all duration-200 group disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#eb7825]/10 to-[#d6691f]/10 flex items-center justify-center group-hover:from-[#eb7825]/20 group-hover:to-[#d6691f]/20 transition-all duration-200">
                          <Upload className="w-6 h-6 text-[#eb7825]" />
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-medium text-gray-700">Upload Screenshot</p>
                          <p className="text-xs text-gray-500 mt-1">PNG, JPG up to 10MB</p>
                        </div>
                      </div>
                    </motion.button>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="relative rounded-xl overflow-hidden border-2 border-gray-200 shadow-lg"
                    >
                      <img
                        src={previewUrl}
                        alt="Screenshot preview"
                        className="w-full h-48 object-cover"
                      />
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={handleRemoveScreenshot}
                        disabled={isSubmitting || isSubmitted}
                        className="absolute top-2 right-2 p-2 rounded-full bg-red-500 text-white shadow-lg hover:bg-red-600 transition-colors duration-200 disabled:opacity-50"
                      >
                        <X className="w-4 h-4" />
                      </motion.button>
                    </motion.div>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="relative p-5 sm:p-6 border-t border-gray-200/50">
                <motion.button
                  whileHover={{ scale: isSubmitting || isSubmitted ? 1 : 1.02 }}
                  whileTap={{ scale: isSubmitting || isSubmitted ? 1 : 0.98 }}
                  onClick={handleSubmit}
                  disabled={(!feedback.trim() && !screenshot) || isSubmitting || isSubmitted}
                  className="w-full py-3.5 sm:py-4 bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white rounded-xl font-bold text-base sm:text-lg shadow-xl hover:shadow-2xl transition-all duration-300 relative overflow-hidden group disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {/* Button shine effect */}
                  {!isSubmitting && !isSubmitted && (
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
                  )}
                  
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    {isSubmitting && (
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      >
                        <Upload className="w-5 h-5" />
                      </motion.div>
                    )}
                    {isSubmitted && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                      >
                        <Check className="w-5 h-5" />
                      </motion.div>
                    )}
                    {!isSubmitting && !isSubmitted && <Send className="w-5 h-5" />}
                    {isSubmitting ? 'Sending...' : isSubmitted ? 'Sent!' : 'Submit Feedback'}
                  </span>
                </motion.button>
              </div>

              {/* Bottom accent line */}
              <motion.div
                animate={{
                  opacity: [0.5, 1, 0.5],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'easeInOut'
                }}
                className="h-1 bg-gradient-to-r from-[#eb7825] via-[#d6691f] to-[#eb7825]"
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}