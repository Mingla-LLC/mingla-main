import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Heart, Star, Navigation, ThumbsUp, ThumbsDown, Check, Eye, 
  MapPin, Clock, ChevronLeft, ChevronRight, X, Utensils, Coffee, 
  Camera, Music, Dumbbell, Palette, Landmark, Trees, ShoppingBag 
} from 'lucide-react';
import { ImageWithFallback } from '../figma/ImageWithFallback';
import exampleImage from 'figma:asset/efcc04c73f96b16b80d0555a4c74f6c1a2a9eb33.png';
import { getIconComponent } from '../swipeable-cards/utils';
import { getCategoryDisplayName } from '../utils/preferences';
import CardDetails from '../swipeable-cards/CardDetails';
import CardGallery from '../swipeable-cards/CardGallery';

interface SharedCard {
  id: string;
  title: string;
  category: string;
  categoryIcon: any;
  price: string;
  priceRange: string;
  addedBy: string;
  image: string;
  images?: string[];
  rating: number;
  reviewCount?: number;
  travelTime: string;
  description: string;
  fullDescription?: string;
  address?: string;
  duration?: string;
  highlights?: string[];
  votes: {
    yes: number;
    no: number;
    userVote?: 'yes' | 'no' | null;
  };
  rsvps: {
    responded: number;
    total: number;
    userRSVP?: 'yes' | 'no' | null;
  };
  messages: number;
  isLocked: boolean;
  lockedAt?: string;
}

interface CollaborationCardsProps {
  cards: SharedCard[];
  onVote?: (cardId: string, vote: 'yes' | 'no') => void;
  onRSVP?: (cardId: string, rsvp: 'yes' | 'no') => void;
}

export default function CollaborationCards({ cards, onVote, onRSVP }: CollaborationCardsProps) {
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [galleryIndices, setGalleryIndices] = useState<{[key: string]: number}>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -320, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 320, behavior: 'smooth' });
    }
  };

  const filterCategories = [
    { id: 'all', label: 'All', icon: Heart },
    { id: 'dining', label: 'Dining', icon: Utensils },
    { id: 'coffee', label: 'Coffee', icon: Coffee },
    { id: 'sightseeing', label: 'Sights', icon: Camera },
    { id: 'entertainment', label: 'Fun', icon: Music },
    { id: 'fitness', label: 'Fitness', icon: Dumbbell },
    { id: 'arts', label: 'Arts', icon: Palette },
    { id: 'landmarks', label: 'Landmarks', icon: Landmark },
    { id: 'nature', label: 'Nature', icon: Trees },
    { id: 'shopping', label: 'Shopping', icon: ShoppingBag },
  ];

  const getUserColor = (initials: string) => {
    const colors = [
      'from-[#eb7825] to-[#d6691f]',
      'from-blue-500 to-indigo-600',
      'from-purple-500 to-pink-600',
      'from-green-500 to-emerald-600',
      'from-amber-500 to-orange-600'
    ];
    const index = initials.charCodeAt(0) % colors.length;
    return colors[index];
  };

  const getUsernameDisplay = (addedBy: string) => {
    // If it looks like an email, extract the username part
    if (addedBy.includes('@')) {
      return addedBy.split('@')[0];
    }
    // If it's "you", return as-is
    if (addedBy === 'you') {
      return 'you';
    }
    // Otherwise return the username as-is
    return addedBy;
  };

  const handleVote = (cardId: string, vote: 'yes' | 'no') => {
    if (onVote) {
      onVote(cardId, vote);
    }
  };

  const handleRSVP = (cardId: string, rsvp: 'yes' | 'no') => {
    if (onRSVP) {
      onRSVP(cardId, rsvp);
    }
  };

  if (cards.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Heart className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No cards added yet</p>
          <p className="text-xs text-gray-400 mt-1">
            Swipe and like cards to add them here
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Horizontal Scrollable Cards */}
      <div ref={scrollContainerRef} className="flex-1 overflow-x-auto overflow-y-hidden" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        <div className="flex gap-4 px-4 py-3 h-full" style={{ minWidth: 'min-content' }}>
          {cards.map((card) => {
            const CardIcon = getIconComponent(card.categoryIcon);
            const isExpanded = expandedCard === card.id;
            const currentGalleryIndex = galleryIndices[card.id] || 0;
            
            return (
              <div 
                key={card.id} 
                className={`flex-shrink-0 h-full ${cards.length === 1 ? 'w-full' : 'w-[300px]'}`}
              >
                {/* Collapsed Card */}
                {!isExpanded && (
                  <motion.div
                    initial={{ opacity: 1 }}
                    className="h-full flex flex-col"
                  >
                    <div 
                      className="glass-card rounded-3xl overflow-hidden h-full flex flex-col card-elevated cursor-pointer"
                      onClick={() => setExpandedCard(card.id)}
                      style={{
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.1) inset'
                      }}
                    >
                      {/* Image Section - 65% height like SwipeCard */}
                      <div className="relative h-[65%] bg-gray-100 overflow-hidden">
                        <ImageWithFallback
                          src={card.image}
                          alt={card.title}
                          className="w-full h-full object-cover"
                        />
                        
                        {/* Gradient Overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                        
                        {/* Top Badges */}
                        <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2 z-10">
                          <div className="flex flex-col gap-2 slide-up">
                            {/* Rating Badge */}
                            <div className="glass-badge rounded-full flex items-center gap-1 shadow-lg hover:scale-105 transition-smooth">
                              <Star className="w-3.5 h-3.5 text-[#eb7825] fill-[#eb7825]" />
                              <span className="text-sm font-semibold text-gray-900">{card.rating}</span>
                            </div>
                          </div>
                        </div>

                        {/* Bottom Info on Image */}
                        <div className="absolute bottom-3 left-3 right-3 text-white z-10 slide-up">
                          <h3 className="text-xl font-bold mb-1 drop-shadow-lg">{card.title}</h3>
                          <div className="flex items-center gap-2 text-sm">
                            <div className="flex items-center gap-1 glass-badge-dark rounded-full shadow-md hover:scale-105 transition-smooth">
                              <Navigation className="w-3.5 h-3.5" />
                              <span>{card.travelTime}</span>
                            </div>
                            <div className="flex items-center gap-1 glass-badge-dark rounded-full shadow-md hover:scale-105 transition-smooth">
                              <Clock className="w-3.5 h-3.5" />
                              <span>{card.price}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Details Section */}
                      <div className="flex-1 p-4 flex flex-col" onClick={(e) => e.stopPropagation()}>
                        {/* Category */}
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-8 h-8 bg-gradient-to-br from-orange-100 to-orange-50 rounded-full flex items-center justify-center shadow-sm hover:scale-110 transition-smooth">
                            <CardIcon className="w-4 h-4 text-[#eb7825]" />
                          </div>
                          <span className="text-sm text-gray-600 font-medium">{getCategoryDisplayName(card.category)}</span>
                        </div>

                        {/* Description */}
                        <p className="text-sm text-gray-900 mb-3 leading-relaxed font-normal line-clamp-2">
                          {card.description}
                        </p>

                        {/* Added by */}
                        <label className="flex items-center gap-2 mb-3 text-xs text-gray-500">
                          <div className={`w-5 h-5 rounded-full bg-gradient-to-br ${getUserColor(card.addedBy[0])} flex items-center justify-center text-white text-[9px] font-bold`}>
                            {getUsernameDisplay(card.addedBy)[0].toUpperCase()}
                          </div>
                          <span className="truncate">Added by {getUsernameDisplay(card.addedBy)}</span>
                        </label>

                        {/* Voting & RSVP Section */}
                        {!card.isLocked ? (
                          <div className="mt-auto space-y-2">
                            <div className="flex gap-2">
                              <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleVote(card.id, 'yes');
                                }}
                                className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl font-medium text-xs transition-all ${
                                  card.votes.userVote === 'yes'
                                    ? 'bg-green-500 text-white shadow-md'
                                    : 'bg-green-50 text-green-700 hover:bg-green-100'
                                }`}
                              >
                                <ThumbsUp className="w-3.5 h-3.5" />
                                <span>{card.votes.yes}</span>
                              </motion.button>
                              <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleVote(card.id, 'no');
                                }}
                                className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl font-medium text-xs transition-all ${
                                  card.votes.userVote === 'no'
                                    ? 'bg-red-500 text-white shadow-md'
                                    : 'bg-red-50 text-red-700 hover:bg-red-100'
                                }`}
                              >
                                <ThumbsDown className="w-3.5 h-3.5" />
                                <span>{card.votes.no}</span>
                              </motion.button>
                            </div>
                            
                            <motion.button
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRSVP(card.id, 'yes');
                              }}
                              className={`w-full py-2 px-3 rounded-xl font-medium text-xs transition-all ${
                                card.rsvps.userRSVP === 'yes'
                                  ? 'bg-[#eb7825] text-white shadow-md'
                                  : 'bg-orange-50 text-[#eb7825] hover:bg-orange-100'
                              }`}
                            >
                              {card.rsvps.userRSVP === 'yes' ? 'RSVP\'d Yes' : 'RSVP Yes'} 
                              <span className="opacity-75"> • {card.rsvps.responded}/{card.rsvps.total}</span>
                            </motion.button>
                          </div>
                        ) : (
                          <div className="mt-auto bg-green-50 border border-green-200 rounded-xl p-2 text-center">
                            <div className="flex items-center justify-center gap-1.5 text-green-700 mb-0.5">
                              <Check className="w-3.5 h-3.5" />
                              <span className="font-medium text-xs">Added to Calendar</span>
                            </div>
                            <p className="text-[10px] text-green-600">Locked {card.lockedAt}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Expanded Card - Full Details */}
                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="h-full bg-white rounded-2xl shadow-2xl border border-gray-100 flex flex-col overflow-hidden"
                    style={{ width: '340px' }}
                  >
                    {/* Header with close button */}
                    <div className="relative p-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                      <h3 className="font-bold text-gray-900 text-sm truncate pr-2">{card.title}</h3>
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => setExpandedCard(null)}
                        className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                      >
                        <X className="w-4 h-4 text-gray-600" />
                      </motion.button>
                    </div>

                    {/* Scrollable Content */}
                    <div className="flex-1 overflow-y-auto">
                      {/* Image Gallery */}
                      <div className="relative h-56 flex-shrink-0">
                        <ImageWithFallback
                          src={card.images && card.images.length > 0 ? card.images[currentGalleryIndex] : card.image}
                          alt={card.title}
                          className="w-full h-full object-cover"
                        />
                        {card.images && card.images.length > 1 && (
                          <>
                            <button
                              onClick={() => {
                                const newIndex = currentGalleryIndex > 0 ? currentGalleryIndex - 1 : 0;
                                setGalleryIndices(prev => ({ ...prev, [card.id]: newIndex }));
                              }}
                              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center transition-all"
                            >
                              <ChevronLeft className="w-5 h-5 text-white" />
                            </button>
                            <button
                              onClick={() => {
                                const newIndex = currentGalleryIndex < card.images!.length - 1 ? currentGalleryIndex + 1 : currentGalleryIndex;
                                setGalleryIndices(prev => ({ ...prev, [card.id]: newIndex }));
                              }}
                              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center transition-all"
                            >
                              <ChevronRight className="w-5 h-5 text-white" />
                            </button>
                            {/* Gallery dots */}
                            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
                              {card.images.map((_, idx) => (
                                <button
                                  key={idx}
                                  onClick={() => setGalleryIndices(prev => ({ ...prev, [card.id]: idx }))}
                                  className={`h-1.5 rounded-full transition-all ${
                                    idx === currentGalleryIndex ? 'bg-white w-4' : 'bg-white/50 w-1.5'
                                  }`}
                                />
                              ))}
                            </div>
                          </>
                        )}
                      </div>

                      <div className="p-4 space-y-3">
                        {/* Stats */}
                        <div className="flex items-center gap-4 text-sm flex-wrap">
                          <div className="flex items-center gap-1.5 text-gray-600">
                            <Star className="w-4 h-4 fill-[#eb7825] text-[#eb7825]" />
                            <span className="font-semibold">{card.rating}</span>
                            <span className="text-gray-500">({card.reviewCount || '100+'})</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-gray-600">
                            <Navigation className="w-4 h-4 text-[#eb7825]" />
                            <span>{card.travelTime}</span>
                          </div>
                          <div className="text-[#eb7825] font-semibold text-base">{card.price}</div>
                        </div>

                        {/* Category */}
                        <div className="flex items-center gap-2">
                          <CardIcon className="w-5 h-5 text-[#eb7825]" />
                          <span className="text-gray-700 font-medium text-sm">{card.category}</span>
                        </div>

                        {/* Full Description */}
                        <div>
                          <h4 className="font-semibold text-gray-900 text-sm mb-2">About</h4>
                          <p className="text-sm text-gray-700 leading-relaxed">{card.fullDescription || card.description}</p>
                        </div>

                        {/* Address */}
                        {card.address && (
                          <div className="flex items-start gap-2">
                            <MapPin className="w-4 h-4 text-[#eb7825] mt-0.5 flex-shrink-0" />
                            <span className="text-sm text-gray-700">{card.address}</span>
                          </div>
                        )}

                        {/* Duration */}
                        {card.duration && (
                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-[#eb7825]" />
                            <span className="text-sm text-gray-700">{card.duration}</span>
                          </div>
                        )}

                        {/* Highlights */}
                        {card.highlights && card.highlights.length > 0 && (
                          <div>
                            <h4 className="font-semibold text-gray-900 text-sm mb-2">Highlights</h4>
                            <div className="flex flex-wrap gap-2">
                              {card.highlights.map((highlight, idx) => (
                                <span key={idx} className="px-2.5 py-1 bg-gray-100 text-gray-700 rounded-full text-xs">
                                  {highlight}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Added by */}
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <div className={`w-6 h-6 rounded-full bg-gradient-to-br ${getUserColor(card.addedBy[0])} flex items-center justify-center text-white text-xs font-bold`}>
                            {card.addedBy[0]}
                          </div>
                          <span>Added by <span className="font-medium text-gray-900">{card.addedBy}</span></span>
                        </div>
                      </div>
                    </div>

                    {/* Fixed bottom actions */}
                    <div className="p-4 border-t border-gray-100 bg-white flex-shrink-0">
                      {!card.isLocked ? (
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <motion.button
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => handleVote(card.id, 'yes')}
                              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl font-medium text-sm transition-all ${
                                card.votes.userVote === 'yes'
                                  ? 'bg-green-500 text-white shadow-lg shadow-green-500/30'
                                  : 'bg-green-50 text-green-700 hover:bg-green-100'
                              }`}
                            >
                              <ThumbsUp className="w-4 h-4" />
                              <span>{card.votes.yes} Yes</span>
                            </motion.button>
                            <motion.button
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => handleVote(card.id, 'no')}
                              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl font-medium text-sm transition-all ${
                                card.votes.userVote === 'no'
                                  ? 'bg-red-500 text-white shadow-lg shadow-red-500/30'
                                  : 'bg-red-50 text-red-700 hover:bg-red-100'
                              }`}
                            >
                              <ThumbsDown className="w-4 h-4" />
                              <span>{card.votes.no} No</span>
                            </motion.button>
                          </div>
                          
                          <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => handleRSVP(card.id, 'yes')}
                            className={`w-full py-2.5 px-4 rounded-xl font-medium text-sm transition-all ${
                              card.rsvps.userRSVP === 'yes'
                                ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-lg shadow-[#eb7825]/30'
                                : 'bg-orange-50 text-[#eb7825] hover:bg-orange-100'
                            }`}
                          >
                            {card.rsvps.userRSVP === 'yes' ? 'RSVP\'d Yes' : 'RSVP Yes'} 
                            <span className="opacity-75"> • {card.rsvps.responded}/{card.rsvps.total} responded</span>
                          </motion.button>
                        </div>
                      ) : (
                        <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                          <div className="flex items-center justify-center gap-2 text-green-700 mb-1">
                            <Check className="w-5 h-5" />
                            <span className="font-medium">Added to Calendar</span>
                          </div>
                          <p className="text-xs text-green-600">Locked {card.lockedAt}</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Scroll Hint */}
      <div className="px-4 pb-2 text-center" style={{ marginBottom: '2px' }}>
        <p className="text-xs text-gray-400">← Scroll to see more cards →</p>
      </div>
    </div>
  );
}