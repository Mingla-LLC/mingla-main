import React, { useState } from 'react';
import { X, Star, Send } from 'lucide-react';
import { motion } from 'motion/react';

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  cardTitle: string;
  onSubmitReview: (rating: number, comment: string) => void;
  remainingReviews?: number;
  existingReview?: {
    rating: number;
    comment: string;
  } | null;
}

export default function ReviewModal({
  isOpen,
  onClose,
  cardTitle,
  onSubmitReview,
  remainingReviews = 0,
  existingReview = null
}: ReviewModalProps) {
  const [rating, setRating] = useState(existingReview?.rating || 0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [comment, setComment] = useState(existingReview?.comment || '');
  
  // Update state when existingReview changes
  React.useEffect(() => {
    if (existingReview) {
      setRating(existingReview.rating);
      setComment(existingReview.comment || '');
    } else {
      setRating(0);
      setComment('');
    }
  }, [existingReview, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (rating === 0) return; // Require at least a rating
    onSubmitReview(rating, comment);
    onClose();
  };

  const handleSkip = () => {
    // Submit with 0 rating to indicate skipped
    onSubmitReview(0, '');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-[#eb7825] to-[#d6691f] px-6 py-4 flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-white font-semibold">
                {existingReview && existingReview.rating > 0 ? 'Edit Your Review' : 'How was your experience?'}
              </h2>
              {remainingReviews > 0 && (
                <span className="px-2 py-0.5 bg-white/20 backdrop-blur-sm rounded-full text-white text-xs">
                  +{remainingReviews} more
                </span>
              )}
            </div>
            <p className="text-white/90 text-sm mt-1 line-clamp-1">{cardTitle}</p>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Star Rating */}
          <div>
            <p className="text-sm text-gray-600 mb-3 text-center">Rate your experience</p>
            <div className="flex items-center justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoveredRating(star)}
                  onMouseLeave={() => setHoveredRating(0)}
                  className="transition-transform hover:scale-110 active:scale-95"
                >
                  <Star
                    className={`w-10 h-10 transition-colors ${
                      star <= (hoveredRating || rating)
                        ? 'fill-[#eb7825] text-[#eb7825]'
                        : 'text-gray-300'
                    }`}
                  />
                </button>
              ))}
            </div>
            {rating > 0 && (
              <p className="text-center text-sm text-gray-500 mt-2">
                {rating === 1 && 'Poor'}
                {rating === 2 && 'Fair'}
                {rating === 3 && 'Good'}
                {rating === 4 && 'Very Good'}
                {rating === 5 && 'Excellent'}
              </p>
            )}
          </div>

          {/* Optional Comment */}
          <div>
            <label className="text-sm text-gray-600 mb-2 block">
              Share your thoughts (optional)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What did you like or dislike about this experience?"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#eb7825] focus:border-transparent resize-none"
              rows={4}
              maxLength={500}
            />
            <p className="text-xs text-gray-400 mt-1 text-right">{comment.length}/500</p>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            {/* Only show Skip button for new reviews, not edits */}
            {(!existingReview || existingReview.rating === 0) && (
              <button
                onClick={handleSkip}
                className="flex-1 px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 transition-colors"
              >
                Skip
              </button>
            )}
            <button
              onClick={handleSubmit}
              disabled={rating === 0}
              className={`${(!existingReview || existingReview.rating === 0) ? 'flex-1' : 'w-full'} px-6 py-3 rounded-xl font-semibold transition-all ${
                rating === 0
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white hover:shadow-lg'
              }`}
            >
              {existingReview && existingReview.rating > 0 ? 'Update' : 'Submit'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
