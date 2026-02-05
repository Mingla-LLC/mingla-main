import React, { useState } from 'react';
import { X, Star, MapPin, Clock, Heart, Bookmark, Share2, ChevronLeft, ChevronRight, Music, Users, Building2, Sparkles } from 'lucide-react';
import { Button } from './ui/button';
import { motion, AnimatePresence } from 'motion/react';
import { ImageWithFallback } from './figma/ImageWithFallback';

interface CardPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  card: any;
}

export default function CardPreviewModal({ isOpen, onClose, card }: CardPreviewModalProps) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [showFullDescription, setShowFullDescription] = useState(false);

  if (!isOpen || !card) return null;

  // Fix image handling - use actual saved field names
  const images = card.imageGallery || card.images || (card.heroImage ? [card.heroImage] : []) || (card.coverImage ? [card.coverImage] : []) || (card.image ? [card.image] : []);

  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % images.length);
  };

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] overflow-y-auto">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        />

        {/* Modal */}
        <div className="relative min-h-screen flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden"
          >
            {/* Close Button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 z-10 w-10 h-10 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center shadow-lg hover:bg-white transition-all"
            >
              <X className="w-5 h-5 text-gray-700" />
            </button>

            {/* Image Gallery */}
            <div className="relative w-full h-80 bg-gray-100">
              <ImageWithFallback
                src={images[currentImageIndex]}
                alt={card.title}
                className="w-full h-full object-cover"
              />

              {/* Image Navigation */}
              {images.length > 1 && (
                <>
                  <button
                    onClick={prevImage}
                    className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center shadow-lg hover:bg-white transition-all"
                  >
                    <ChevronLeft className="w-5 h-5 text-gray-700" />
                  </button>
                  <button
                    onClick={nextImage}
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center shadow-lg hover:bg-white transition-all"
                  >
                    <ChevronRight className="w-5 h-5 text-gray-700" />
                  </button>

                  {/* Image Indicators */}
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
                    {images.map((_, idx) => (
                      <div
                        key={idx}
                        className={`w-2 h-2 rounded-full transition-all ${
                          idx === currentImageIndex ? 'bg-white w-6' : 'bg-white/50'
                        }`}
                      />
                    ))}
                  </div>
                </>
              )}

              {/* Match Score Badge */}
              {card.matchScore && (
                <div className="absolute top-4 left-4 bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white px-3 py-1.5 rounded-full text-sm font-medium shadow-lg">
                  {card.matchScore}% Match
                </div>
              )}
            </div>

            {/* Content */}
            <div className="p-6">
              {/* Header */}
              <div className="mb-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h2 className="text-2xl font-bold text-gray-900">{card.title}</h2>
                  {card.rating && (
                    <div className="flex items-center gap-1">
                      <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />
                      <span className="font-semibold text-gray-900">{card.rating}</span>
                      <span className="text-sm text-gray-500">({card.reviewCount || 0})</span>
                    </div>
                  )}
                </div>

                {/* Business/Host Info */}
                {(card.partyType || card.businessName || card.host) && (
                  <div className="flex items-center gap-2 mb-3">
                    <Music className="w-5 h-5 text-[#eb7825]" />
                    {card.partyType && <span className="font-medium text-[#eb7825]">{card.partyType}</span>}
                    {(card.partyType && (card.businessName || card.host)) && <span className="text-gray-400">•</span>}
                    <span className="text-gray-600">Hosted by {card.businessName || card.host || 'Business'}</span>
                  </div>
                )}

                {/* Categories and Types */}
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {card.category && (
                    <span className="px-3 py-1 bg-orange-50 text-[#eb7825] rounded-full font-medium">
                      {card.category}
                    </span>
                  )}
                  {card.types && card.types.length > 0 && card.types.map((type: string, idx: number) => (
                    <span key={idx} className="px-2.5 py-0.5 bg-gray-100 text-gray-700 rounded-full text-xs">
                      {type}
                    </span>
                  ))}
                </div>
              </div>

              {/* Venue Info - Most Important */}
              {card.venueName && (
                <div className="mb-6 p-4 bg-orange-50 border border-orange-200 rounded-xl">
                  <div className="flex items-start gap-3">
                    <Building2 className="w-5 h-5 text-[#eb7825] mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900 mb-1">{card.venueName}</p>
                      {(card.venueAddress || card.venueCity) && (
                        <p className="text-sm text-gray-600 mb-2">
                          {[card.venueAddress, card.venueCity, card.venueState, card.venueZipCode, card.venueCountry]
                            .filter(Boolean)
                            .join(', ')}
                        </p>
                      )}
                      {card.venuePhone && (
                        <p className="text-xs text-gray-500">📞 {card.venuePhone}</p>
                      )}
                      {card.venueWebsite && (
                        <a href={card.venueWebsite} target="_blank" rel="noopener noreferrer" className="text-xs text-[#eb7825] hover:underline">
                          🌐 Visit Website
                        </a>
                      )}
                      {card.venueNotes && (
                        <p className="text-xs text-gray-600 mt-2 italic">{card.venueNotes}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Description */}
              {card.description && (
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 mb-2">About This Experience</h3>
                  <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {showFullDescription 
                      ? card.description
                      : (card.description.substring(0, 200) + (card.description.length > 200 ? '...' : ''))
                    }
                  </p>
                  {card.description.length > 200 && (
                    <button
                      onClick={() => setShowFullDescription(!showFullDescription)}
                      className="text-[#eb7825] text-sm font-medium mt-2 hover:underline"
                    >
                      {showFullDescription ? 'Show less' : 'Read more'}
                    </button>
                  )}
                </div>
              )}

              {/* Music Genres */}
              {card.musicGenres && card.musicGenres.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <Music className="w-4 h-4 text-[#eb7825]" />
                    Music Genres
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {card.musicGenres.map((genre: string, idx: number) => (
                      <span 
                        key={idx}
                        className="bg-blue-50 border border-blue-200 text-blue-700 px-3 py-1.5 rounded-full text-sm"
                      >
                        {genre}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Vibe Tags */}
              {card.vibeTags && card.vibeTags.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#eb7825]" />
                    Vibe
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {card.vibeTags.map((tag: string, idx: number) => (
                      <span 
                        key={idx}
                        className="bg-purple-50 border border-purple-200 text-purple-700 px-3 py-1.5 rounded-full text-sm"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Purchase Options / Packages */}
              {card.purchaseOptions && card.purchaseOptions.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 mb-3">Packages & Pricing</h3>
                  <div className="space-y-3">
                    {card.purchaseOptions.map((option: any, idx: number) => (
                      <div key={idx} className="p-4 bg-gradient-to-br from-orange-50 to-white border-2 border-orange-200 rounded-xl">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <h4 className="font-semibold text-gray-900 mb-1">{option.title}</h4>
                            {option.description && (
                              <p className="text-sm text-gray-600 mb-2">{option.description}</p>
                            )}
                            {option.groupSize && (
                              <div className="flex items-center gap-1 text-xs text-gray-500 mb-2">
                                <Users className="w-3.5 h-3.5" />
                                <span>{option.groupSize.min} - {option.groupSize.max} people</span>
                              </div>
                            )}
                          </div>
                          <div className="text-right ml-4">
                            <p className="text-2xl font-bold text-[#eb7825]">${option.price}</p>
                            {option.pricePerPerson && (
                              <p className="text-xs text-gray-500">per person</p>
                            )}
                          </div>
                        </div>
                        {option.includes && option.includes.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-orange-200/50">
                            <p className="text-xs font-medium text-gray-700 mb-2">Includes:</p>
                            <div className="grid grid-cols-1 gap-1.5">
                              {option.includes.map((item: string, itemIdx: number) => (
                                <div key={itemIdx} className="flex items-start gap-1.5">
                                  <span className="text-[#eb7825] text-xs mt-0.5">✓</span>
                                  <span className="text-xs text-gray-600">{item}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Route/Timeline for multi-stop experiences */}
              {card.isMultiStop && card.routeSteps && card.routeSteps.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 mb-3">Itinerary</h3>
                  <div className="space-y-3">
                    {card.routeSteps.map((step: any, idx: number) => (
                      <div key={idx} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className="w-8 h-8 bg-[#eb7825] text-white rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0">
                            {idx + 1}
                          </div>
                          {idx < card.routeSteps.length - 1 && (
                            <div className="w-0.5 bg-orange-200 flex-1 mt-2" />
                          )}
                        </div>
                        <div className="flex-1 pb-4">
                          <h4 className="font-medium text-gray-900 mb-1">{step.title}</h4>
                          {step.description && (
                            <p className="text-sm text-gray-600 mb-2">{step.description}</p>
                          )}
                          {step.duration && (
                            <div className="flex items-center gap-1 text-xs text-gray-500">
                              <Clock className="w-3.5 h-3.5" />
                              <span>{step.duration} minutes</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {card.duration && (
                    <div className="mt-4 p-3 bg-gray-50 rounded-lg text-center">
                      <p className="text-sm font-medium text-gray-700">
                        Total Duration: <span className="text-[#eb7825]">{card.duration}</span>
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Policies Section */}
              {(card.cancellationPolicy || card.requirements || card.accessibilityInfo || card.additionalPolicies) && (
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 mb-3">Important Information</h3>
                  <div className="space-y-3 p-4 bg-gray-50 rounded-xl">
                    {card.cancellationPolicy && (
                      <div>
                        <p className="text-xs font-semibold text-gray-700 mb-1">Cancellation Policy</p>
                        <p className="text-sm text-gray-600">{card.cancellationPolicy}</p>
                      </div>
                    )}
                    {card.requirements && (
                      <div>
                        <p className="text-xs font-semibold text-gray-700 mb-1">Requirements</p>
                        <p className="text-sm text-gray-600">{card.requirements}</p>
                      </div>
                    )}
                    {card.accessibilityInfo && (
                      <div>
                        <p className="text-xs font-semibold text-gray-700 mb-1">Accessibility</p>
                        <p className="text-sm text-gray-600">{card.accessibilityInfo}</p>
                      </div>
                    )}
                    {card.additionalPolicies && (
                      <div>
                        <p className="text-xs font-semibold text-gray-700 mb-1">Additional Policies</p>
                        <p className="text-sm text-gray-600">{card.additionalPolicies}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3">
                <Button
                  className="flex-1 bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white hover:shadow-lg rounded-xl h-12"
                >
                  Book Now
                </Button>
                <Button
                  variant="outline"
                  className="w-12 h-12 rounded-xl border-gray-200 hover:border-[#eb7825] hover:text-[#eb7825]"
                >
                  <Heart className="w-5 h-5" />
                </Button>
                <Button
                  variant="outline"
                  className="w-12 h-12 rounded-xl border-gray-200 hover:border-[#eb7825] hover:text-[#eb7825]"
                >
                  <Bookmark className="w-5 h-5" />
                </Button>
                <Button
                  variant="outline"
                  className="w-12 h-12 rounded-xl border-gray-200 hover:border-[#eb7825] hover:text-[#eb7825]"
                >
                  <Share2 className="w-5 h-5" />
                </Button>
              </div>

              {/* Preview Notice */}
              <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                <p className="text-sm text-blue-700 text-center">
                  👁️ This is how your card appears to explorers
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </AnimatePresence>
  );
}
