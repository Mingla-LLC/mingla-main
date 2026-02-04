import React, { useState, useRef } from 'react';
import { 
  ChevronLeft, ChevronRight, X, Star, Navigation, MapPin, 
  ThumbsUp, ThumbsDown, Check, Eye, Bookmark, Heart, 
  Share2, ExternalLink, Sparkles, Lock, MessageSquare,
  Coffee, Palette, TreePine, Utensils, Dumbbell
} from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';

// Helper to convert string icon names to components
const getIconComponent = (categoryIcon: any) => {
  const iconMap: { [key: string]: any } = {
    Coffee,
    Palette,
    TreePine,
    Utensils,
    Dumbbell,
    Eye,
    Heart,
    Sparkles
  };
  
  // If it's already a component, return it
  if (typeof categoryIcon === 'function') {
    return categoryIcon;
  }
  
  // If it's a string, look it up in the map
  if (typeof categoryIcon === 'string') {
    return iconMap[categoryIcon] || Heart;
  }
  
  return Heart;
};

interface BoardCard {
  id: string;
  title: string;
  category: string;
  categoryIcon: any;
  image: string;
  images?: string[];
  rating: number;
  reviewCount?: number;
  travelTime: string;
  priceRange: string;
  description: string;
  fullDescription?: string;
  address?: string;
  highlights?: string[];
  matchScore?: number;
  matchFactors?: {
    location: number;
    budget: number;
    category: number;
  };
  socialStats?: {
    views: number;
    likes: number;
    saves: number;
  };
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

interface SwipeableBoardCardsProps {
  cards: BoardCard[];
  onVote: (cardId: string, vote: 'yes' | 'no') => void;
  onRSVP: (cardId: string, rsvp: 'yes' | 'no') => void;
  onSaveCard?: (card: BoardCard) => void;
}

export default function SwipeableBoardCards({ cards, onVote, onRSVP, onSaveCard }: SwipeableBoardCardsProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [galleryIndices, setGalleryIndices] = useState<{[key: string]: number}>({});
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  if (cards.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <div className="w-16 h-16 bg-gray-100 rounded-2xl mx-auto mb-3 flex items-center justify-center">
          <Eye className="w-8 h-8 text-gray-300" />
        </div>
        <p className="text-sm">No cards in this session yet</p>
      </div>
    );
  }

  const currentCard = cards[currentIndex];

  // Touch and drag handlers
  const handleStart = (clientX: number, clientY: number) => {
    setIsDragging(true);
    setStartPos({ x: clientX, y: clientY });
  };

  const handleMove = (clientX: number, clientY: number) => {
    if (!isDragging) return;
    
    const deltaX = clientX - startPos.x;
    const deltaY = clientY - startPos.y;
    
    // Only allow horizontal swiping for cards
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      setDragOffset({ x: deltaX, y: 0 });
    }
  };

  const handleEnd = () => {
    if (!isDragging) return;
    
    const threshold = 100;
    const saveThreshold = 150; // Stronger swipe right to save
    
    // Check for strong swipe right to save (regardless of current position)
    if (dragOffset.x > saveThreshold && onSaveCard) {
      onSaveCard(currentCard);
      // Visual feedback - you could add a toast notification here
    } else if (dragOffset.x > threshold && currentIndex > 0) {
      // Regular swipe right - previous card
      setCurrentIndex(currentIndex - 1);
    } else if (dragOffset.x < -threshold && currentIndex < cards.length - 1) {
      // Swipe left - next card
      setCurrentIndex(currentIndex + 1);
    }
    
    setDragOffset({ x: 0, y: 0 });
    setIsDragging(false);
  };

  // Touch events
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    handleStart(touch.clientX, touch.clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    handleMove(touch.clientX, touch.clientY);
  };

  // Mouse events
  const handleMouseDown = (e: React.MouseEvent) => {
    handleStart(e.clientX, e.clientY);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    handleMove(e.clientX, e.clientY);
  };

  const navigateCard = (direction: 'prev' | 'next') => {
    if (direction === 'prev' && currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    } else if (direction === 'next' && currentIndex < cards.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const toggleExpanded = (cardId: string) => {
    setExpandedCard(expandedCard === cardId ? null : cardId);
    // Initialize gallery index for this card if it doesn't exist
    if (!galleryIndices[cardId]) {
      setGalleryIndices(prev => ({ ...prev, [cardId]: 0 }));
    }
  };

  const navigateGallery = (direction: 'prev' | 'next', card: BoardCard) => {
    const currentGalleryIndex = galleryIndices[card.id] || 0;
    
    if (direction === 'prev' && currentGalleryIndex > 0) {
      setGalleryIndices(prev => ({ ...prev, [card.id]: currentGalleryIndex - 1 }));
    } else if (direction === 'next' && card.images && currentGalleryIndex < card.images.length - 1) {
      setGalleryIndices(prev => ({ ...prev, [card.id]: currentGalleryIndex + 1 }));
    }
  };

  const setGalleryIndex = (cardId: string, index: number) => {
    setGalleryIndices(prev => ({ ...prev, [cardId]: index }));
  };

  const formatNumber = (num: number) => {
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'k';
    }
    return num.toString();
  };

  const CardIcon = getIconComponent(currentCard.categoryIcon);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Session Cards</h3>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">
            {currentIndex + 1} of {cards.length}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => navigateCard('prev')}
              disabled={currentIndex === 0}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                currentIndex === 0 
                  ? 'bg-gray-100 text-gray-400' 
                  : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => navigateCard('next')}
              disabled={currentIndex === cards.length - 1}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                currentIndex === cards.length - 1 
                  ? 'bg-gray-100 text-gray-400' 
                  : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
              }`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Card Container */}
      <div className="relative w-full h-[480px]">
        <div 
          ref={containerRef}
          className="relative w-full h-full overflow-hidden rounded-3xl"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleEnd}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleEnd}
          onMouseLeave={handleEnd}
        >
          <div 
            className="flex h-full transition-transform duration-300 ease-out"
            style={{
              transform: `translateX(calc(-${currentIndex * 100}% + ${dragOffset.x}px))`,
            }}
          >
            {cards.map((card, index) => {
              // Safely get the category icon - use Heart as fallback if undefined
              const RecCategoryIcon = getIconComponent(card.categoryIcon) || Heart;
              const isExpanded = expandedCard === card.id;
              
              return (
                <div key={card.id} className="w-full h-full flex-shrink-0">
                  {/* Main Card */}
                  <div className={`w-full h-full transition-all duration-500 ease-out ${
                    isExpanded ? 'opacity-0 scale-95' : 'opacity-100'
                  }`}>
                    <div className="w-full h-full bg-white rounded-3xl shadow-xl border border-gray-100 flex flex-col overflow-hidden">
                      
                      {/* Hero Image */}
                      <div className="relative flex-1 overflow-hidden">
                        <ImageWithFallback
                          src={card.image}
                          alt={card.title}
                          className="w-full h-full object-cover"
                        />
                        
                        {/* Gradient overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                        
                        {/* Status Badge */}
                        <div className={`absolute top-4 left-4 px-3 py-1 rounded-full text-white ${
                          card.isLocked ? 'bg-green-500' : 'bg-[#eb7825]'
                        }`}>
                          <span className="font-bold text-sm">
                            {card.isLocked ? 'Locked' : `${card.matchScore || 85}% Match`}
                          </span>
                        </div>

                        {/* Gallery indicator */}
                        {card.images && card.images.length > 1 && (
                          <div className="absolute top-4 right-4 bg-black/50 backdrop-blur-sm text-white px-2 py-1 rounded-full text-xs">
                            1/{card.images.length}
                          </div>
                        )}
                        
                        {/* Bottom overlay info */}
                        <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
                          <div className="flex items-end justify-between">
                            <div className="flex-1">
                              <h2 className="font-bold text-xl mb-1">{card.title}</h2>
                              <div className="flex items-center gap-2 mb-2">
                                <RecCategoryIcon className="w-4 h-4" />
                                <span className="text-sm opacity-90">{card.category}</span>
                              </div>
                            </div>
                            
                            <button
                              onClick={() => toggleExpanded(card.id)}
                              className="bg-white/20 backdrop-blur-sm border border-white/30 text-white px-3 py-2 rounded-full hover:bg-white/30 transition-all duration-200"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Compact Info Section */}
                      <div className="p-4 space-y-3 flex-shrink-0">
                        {/* Quick stats row */}
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-1 text-gray-600">
                            <Star className="w-4 h-4 fill-[#eb7825] text-[#eb7825]" />
                            <span className="font-semibold">{card.rating}</span>
                            <span>({card.reviewCount || '100+'})</span>
                          </div>
                          <div className="flex items-center gap-1 text-gray-600">
                            <Navigation className="w-4 h-4 text-[#eb7825]" />
                            <span>{card.travelTime}</span>
                          </div>
                          <div className="flex items-center gap-1 text-gray-600">
                            <span className="text-[#eb7825] font-semibold">{card.priceRange}</span>
                          </div>
                        </div>
                        
                        {/* Description */}
                        <p className="text-gray-700 text-sm leading-relaxed line-clamp-2">{card.description}</p>
                        
                        {/* Voting Section */}
                        {!card.isLocked ? (
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <button
                                onClick={() => onVote(card.id, 'yes')}
                                className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl font-medium transition-all ${
                                  card.votes.userVote === 'yes'
                                    ? 'bg-green-500 text-white'
                                    : 'bg-green-50 text-green-700 hover:bg-green-100'
                                }`}
                              >
                                <ThumbsUp className="w-4 h-4" />
                                <span className="text-sm">{card.votes.yes}</span>
                              </button>
                              <button
                                onClick={() => onVote(card.id, 'no')}
                                className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl font-medium transition-all ${
                                  card.votes.userVote === 'no'
                                    ? 'bg-red-500 text-white'
                                    : 'bg-red-50 text-red-700 hover:bg-red-100'
                                }`}
                              >
                                <ThumbsDown className="w-4 h-4" />
                                <span className="text-sm">{card.votes.no}</span>
                              </button>
                            </div>
                            
                            <button
                              onClick={() => onRSVP(card.id, 'yes')}
                              className={`w-full py-2 px-3 rounded-xl font-medium text-sm transition-all ${
                                card.rsvps.userRSVP === 'yes'
                                  ? 'bg-[#eb7825] text-white'
                                  : 'bg-orange-50 text-[#eb7825] hover:bg-orange-100'
                              }`}
                            >
                              {card.rsvps.userRSVP === 'yes' ? 'RSVP\'d Yes' : 'RSVP Yes'}
                            </button>
                          </div>
                        ) : (
                          <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                            <div className="flex items-center justify-center gap-2 text-green-700 mb-1">
                              <Check className="w-4 h-4" />
                              <span className="font-medium text-sm">Added to Calendar</span>
                            </div>
                            <p className="text-xs text-green-600">Locked {card.lockedAt}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Card - Full Details */}
                  {isExpanded && (
                    <div className="absolute inset-0 z-50">
                      <div className="w-full h-full bg-white rounded-3xl shadow-2xl border border-gray-100 flex flex-col overflow-hidden">
                        
                        {/* Header with close button */}
                        <div className="relative p-4 border-b border-gray-100 flex-shrink-0">
                          <button
                            onClick={() => toggleExpanded(card.id)}
                            className="absolute left-4 top-4 w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
                          >
                            <X className="w-4 h-4 text-gray-600" />
                          </button>
                          
                          <div className="text-center">
                            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-white ${
                              card.isLocked ? 'bg-green-500' : 'bg-[#eb7825]'
                            }`}>
                              {card.isLocked ? <Lock className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                              <span className="font-bold text-sm">
                                {card.isLocked ? 'Locked In' : `${card.matchScore || 85}% Match`}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Scrollable content */}
                        <div className="flex-1 overflow-y-auto">
                          {/* Image gallery */}
                          <div className="relative h-64">
                            {card.images && card.images.length > 1 ? (
                              <>
                                <ImageWithFallback
                                  src={card.images[galleryIndices[card.id] || 0]}
                                  alt={card.title}
                                  className="w-full h-full object-cover"
                                />
                                
                                <button
                                  onClick={() => navigateGallery('prev', card)}
                                  disabled={(galleryIndices[card.id] || 0) === 0}
                                  className={`absolute left-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center transition-all ${
                                    (galleryIndices[card.id] || 0) === 0 ? 'opacity-50' : 'hover:bg-white hover:scale-110'
                                  }`}
                                >
                                  <ChevronLeft className="w-4 h-4 text-gray-700" />
                                </button>
                                
                                <button
                                  onClick={() => navigateGallery('next', card)}
                                  disabled={(galleryIndices[card.id] || 0) === card.images.length - 1}
                                  className={`absolute right-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center transition-all ${
                                    (galleryIndices[card.id] || 0) === card.images.length - 1 ? 'opacity-50' : 'hover:bg-white hover:scale-110'
                                  }`}
                                >
                                  <ChevronRight className="w-4 h-4 text-gray-700" />
                                </button>
                                
                                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1">
                                  {card.images.map((_, i) => (
                                    <button
                                      key={i}
                                      onClick={() => setGalleryIndex(card.id, i)}
                                      className={`h-1.5 rounded-full transition-all ${
                                        i === (galleryIndices[card.id] || 0) 
                                          ? 'bg-[#eb7825] w-6' 
                                          : 'bg-white/60 w-1.5'
                                      }`}
                                    />
                                  ))}
                                </div>

                                <div className="absolute bottom-4 right-4 bg-white/90 px-2 py-1 rounded-full text-xs font-medium">
                                  {(galleryIndices[card.id] || 0) + 1} / {card.images.length}
                                </div>
                              </>
                            ) : (
                              <ImageWithFallback
                                src={card.image}
                                alt={card.title}
                                className="w-full h-full object-cover"
                              />
                            )}
                          </div>

                          {/* Detailed content */}
                          <div className="p-4 space-y-4">
                            
                            {/* Title and category */}
                            <div>
                              <h2 className="font-bold text-2xl text-gray-900 mb-2">{card.title}</h2>
                              <div className="inline-flex items-center gap-2 bg-orange-50 border border-orange-200 px-3 py-1 rounded-full mb-3">
                                <RecCategoryIcon className="w-4 h-4 text-[#eb7825]" />
                                <span className="text-sm font-semibold text-[#eb7825]">{card.category}</span>
                              </div>
                              <p className="text-gray-700 leading-relaxed">{card.fullDescription || card.description}</p>
                            </div>

                            {/* Match breakdown (if available) */}
                            {card.matchFactors && (
                              <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
                                <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                                  <Sparkles className="w-4 h-4 text-[#eb7825]" />
                                  Why It's Perfect
                                </h4>
                                <div className="space-y-2">
                                  {Object.entries(card.matchFactors).slice(0, 3).map(([key, value]) => {
                                    const labels = {
                                      location: 'Location',
                                      budget: 'Budget', 
                                      category: 'Category'
                                    };
                                    return (
                                      <div key={key} className="flex items-center justify-between bg-white/50 rounded-lg p-2">
                                        <span className="font-medium text-gray-900">{labels[key as keyof typeof labels]}</span>
                                        <span className="font-bold text-[#eb7825]">{value}%</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Stats grid */}
                            <div className="grid grid-cols-2 gap-3">
                              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                                <div className="flex items-center gap-2 mb-1">
                                  <Star className="w-4 h-4 text-[#eb7825]" />
                                  <span className="font-bold text-gray-900">{card.rating}</span>
                                </div>
                                <span className="text-sm text-gray-600">{card.reviewCount || '100+'} reviews</span>
                              </div>
                              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                                <div className="flex items-center gap-2 mb-1">
                                  <Navigation className="w-4 h-4 text-[#eb7825]" />
                                  <span className="font-bold text-gray-900">{card.travelTime}</span>
                                </div>
                                <span className="text-sm text-gray-600">{card.priceRange}</span>
                              </div>
                            </div>

                            {/* Location */}
                            {card.address && (
                              <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl">
                                <MapPin className="w-4 h-4 text-[#eb7825] flex-shrink-0" />
                                <span className="text-gray-900">{card.address}</span>
                              </div>
                            )}

                            {/* Highlights */}
                            {card.highlights && card.highlights.length > 0 && (
                              <div>
                                <h4 className="font-bold text-gray-900 mb-2">What Makes It Special</h4>
                                <div className="flex flex-wrap gap-2">
                                  {card.highlights.map((highlight, i) => (
                                    <span key={i} className="px-3 py-1 bg-orange-50 text-[#eb7825] rounded-full text-sm font-medium border border-orange-200">
                                      {highlight}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Voting Status */}
                            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                              <h4 className="font-bold text-gray-900 mb-3">Group Decision</h4>
                              <div className="grid grid-cols-3 gap-3 text-center">
                                <div>
                                  <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center mx-auto mb-1">
                                    <ThumbsUp className="w-4 h-4 text-green-600" />
                                  </div>
                                  <div className="font-bold text-gray-900">{card.votes.yes}</div>
                                  <div className="text-xs text-gray-500">Yes</div>
                                </div>
                                <div>
                                  <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center mx-auto mb-1">
                                    <ThumbsDown className="w-4 h-4 text-red-600" />
                                  </div>
                                  <div className="font-bold text-gray-900">{card.votes.no}</div>
                                  <div className="text-xs text-gray-500">No</div>
                                </div>
                                <div>
                                  <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-1">
                                    <MessageSquare className="w-4 h-4 text-blue-600" />
                                  </div>
                                  <div className="font-bold text-gray-900">{card.messages}</div>
                                  <div className="text-xs text-gray-500">Messages</div>
                                </div>
                              </div>
                              <div className="text-center mt-3 text-sm text-gray-600">
                                {card.rsvps.responded}/{card.rsvps.total} responses
                              </div>
                            </div>

                            {/* Social stats (if available) */}
                            {card.socialStats && (
                              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                                <h4 className="font-bold text-gray-900 mb-3">Community Love</h4>
                                <div className="grid grid-cols-3 gap-4 text-center">
                                  <div>
                                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-1">
                                      <Eye className="w-4 h-4 text-blue-600" />
                                    </div>
                                    <div className="font-bold text-gray-900 text-sm">{formatNumber(card.socialStats.views)}</div>
                                    <div className="text-xs text-gray-500">Views</div>
                                  </div>
                                  <div>
                                    <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center mx-auto mb-1">
                                      <Heart className="w-4 h-4 text-red-600" />
                                    </div>
                                    <div className="font-bold text-gray-900 text-sm">{formatNumber(card.socialStats.likes)}</div>
                                    <div className="text-xs text-gray-500">Likes</div>
                                  </div>
                                  <div>
                                    <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center mx-auto mb-1">
                                      <Bookmark className="w-4 h-4 text-green-600" />
                                    </div>
                                    <div className="font-bold text-gray-900 text-sm">{formatNumber(card.socialStats.saves)}</div>
                                    <div className="text-xs text-gray-500">Saves</div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Fixed bottom actions */}
                        <div className="p-4 border-t border-gray-100 flex-shrink-0">
                          {!card.isLocked ? (
                            <div className="space-y-3">
                              <div className="flex gap-2">
                                <button
                                  onClick={() => onVote(card.id, 'yes')}
                                  className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium transition-all ${
                                    card.votes.userVote === 'yes'
                                      ? 'bg-green-500 text-white'
                                      : 'bg-green-50 text-green-700 hover:bg-green-100'
                                  }`}
                                >
                                  <ThumbsUp className="w-4 h-4" />
                                  Vote Yes
                                </button>
                                <button
                                  onClick={() => onVote(card.id, 'no')}
                                  className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium transition-all ${
                                    card.votes.userVote === 'no'
                                      ? 'bg-red-500 text-white'
                                      : 'bg-red-50 text-red-700 hover:bg-red-100'
                                  }`}
                                >
                                  <ThumbsDown className="w-4 h-4" />
                                  Vote No
                                </button>
                              </div>
                              <button
                                onClick={() => onRSVP(card.id, 'yes')}
                                className={`w-full py-3 px-4 rounded-xl font-medium transition-all ${
                                  card.rsvps.userRSVP === 'yes'
                                    ? 'bg-[#eb7825] text-white'
                                    : 'bg-orange-50 text-[#eb7825] hover:bg-orange-100'
                                }`}
                              >
                                {card.rsvps.userRSVP === 'yes' ? 'RSVP\'d Yes' : 'RSVP Yes'}
                              </button>
                            </div>
                          ) : (
                            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                              <div className="flex items-center justify-center gap-2 text-green-700 mb-2">
                                <Check className="w-5 h-5" />
                                <span className="font-semibold">Added to Calendar</span>
                              </div>
                              <p className="text-sm text-green-600">This activity has been locked and scheduled</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Swipe Indicators */}
      <div className="flex items-center justify-center gap-1.5">
        {cards.map((_, index) => (
          <button
            key={index}
            onClick={() => setCurrentIndex(index)}
            className={`h-1.5 rounded-full transition-all duration-200 ${
              index === currentIndex 
                ? 'bg-[#eb7825] w-6' 
                : 'bg-gray-300 hover:bg-gray-400 w-1.5'
            }`}
          />
        ))}
      </div>
    </div>
  );
}