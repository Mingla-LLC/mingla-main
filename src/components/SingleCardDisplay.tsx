import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, X, Users, MapPin, Clock, Star, Navigation, MessageCircle, DollarSign, Expand, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { AnimatedTimeline } from '@/components/AnimatedTimeline';
import type { RecommendationCard as CardType } from '@/types/recommendations';
interface SingleCardDisplayProps {
  card: CardType;
  onLike: (card: CardType) => void;
  onDislike: (card: CardType) => void;
  onInvite: (card: CardType) => void;
  hasNext: boolean;
  cardNumber: number;
  totalCards: number;
}
export const SingleCardDisplay: React.FC<SingleCardDisplayProps> = ({
  card,
  onLike,
  onDislike,
  onInvite,
  hasNext,
  cardNumber,
  totalCards
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const handleImageLoad = () => {
    setImageLoaded(true);
  };
  const handleImageError = () => {
    setImageFailed(true);
    setImageLoaded(true);
  };
  const handleViewRoute = () => {
    window.open(card.route.mapsDeepLink, '_blank');
  };

  // Price level indicators
  const getPriceDisplay = (level: number) => {
    const symbols = ['$', '$$', '$$$', '$$$$', '$$$$$'];
    return symbols[level - 1] || '$';
  };

  // Category color mapping
  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      'stroll': 'bg-green-100 text-green-800',
      'sip': 'bg-purple-100 text-purple-800',
      'casual_eats': 'bg-orange-100 text-orange-800',
      'screen_relax': 'bg-blue-100 text-blue-800',
      'creative': 'bg-pink-100 text-pink-800',
      'play_move': 'bg-red-100 text-red-800',
      'dining': 'bg-yellow-100 text-yellow-800',
      'freestyle': 'bg-gray-100 text-gray-800'
    };
    return colors[category] || 'bg-gray-100 text-gray-800';
  };
  return <div className="max-w-sm mx-auto">
      <motion.div key={card.id} initial={{
      opacity: 0,
      scale: 0.9,
      y: 50
    }} animate={{
      opacity: 1,
      scale: 1,
      y: 0
    }} exit={{
      opacity: 0,
      scale: 0.9,
      y: -50
    }} transition={{
      duration: 0.5,
      ease: [0.4, 0, 0.2, 1]
    }} className="w-full">
        <Card className="overflow-hidden bg-white shadow-2xl border-0 rounded-3xl">
          {/* Card Counter */}
          <div className="text-center pt-4 pb-2">
            <span className="text-sm text-muted-foreground font-medium">
              {cardNumber} of {totalCards}
            </span>
          </div>

          {/* Image Section */}
          <div className="relative aspect-[4/3] mx-4 rounded-2xl overflow-hidden bg-muted">
            {!imageLoaded && !imageFailed && <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-muted via-muted/50 to-muted" />}
            
            {!imageFailed ? <img src={card.imageUrl} alt={card.title} className={`w-full h-full object-cover transition-all duration-500 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`} onLoad={handleImageLoad} onError={handleImageError} /> : <div className="w-full h-full bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center">
                <MapPin className="h-16 w-16 text-muted-foreground" />
              </div>}

            {/* Overlays */}
            <div className="absolute top-3 left-3 flex gap-2">
              <Badge className={`text-xs font-medium ${getCategoryColor(card.category)}`}>
                {card.category.replace('_', ' & ')}
              </Badge>
              
            </div>

            {/* Rating */}
            {card.rating && <div className="absolute top-3 right-3 flex items-center gap-1 bg-black/50 text-white px-2 py-1 rounded-full text-xs font-medium">
                <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                {card.rating.toFixed(1)}
              </div>}

            {/* Travel Info Overlay */}
            <div className="absolute bottom-3 right-3 bg-black/70 text-white px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1">
              <Navigation className="h-3 w-3" />
              {card.route.etaMinutes}m • {card.route.distanceText}
            </div>
          </div>

          <CardContent className="p-6 space-y-4">
            {/* Title and Subtitle */}
            <div className="space-y-2">
              <h1 className="text-2xl font-bold leading-tight">
                {card.title}
              </h1>
              <p className="text-base text-muted-foreground">
                {card.subtitle}
              </p>
            </div>

            {/* LLM Generated Copy */}
            <div className="space-y-3 bg-accent/5 p-4 rounded-xl">
              <p className="text-base text-foreground leading-relaxed">
                {card.copy.oneLiner}
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed flex items-start gap-2">
                <MessageCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{card.copy.tip}</span>
              </p>
            </div>

            {/* Expandable Details */}
            <div className="space-y-2">
              <Button variant="ghost" onClick={() => setIsExpanded(!isExpanded)} className="w-full flex items-center justify-between p-2 h-auto text-sm font-medium hover:bg-accent/20 rounded-lg">
                <span>View Details</span>
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>

              <AnimatePresence>
                {isExpanded && <motion.div initial={{
                height: 0,
                opacity: 0
              }} animate={{
                height: 'auto',
                opacity: 1
              }} exit={{
                height: 0,
                opacity: 0
              }} transition={{
                duration: 0.3,
                ease: [0.4, 0, 0.2, 1]
              }} className="overflow-hidden">
                    <div className="pt-4 space-y-4">
                      {/* Animated Timeline */}
                      <AnimatedTimeline card={card} isVisible={isExpanded} />
                      
                      <div className="bg-accent/5 rounded-xl p-4 space-y-4">
                        {/* Metadata Grid */}
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div className="flex items-center gap-2 p-2 bg-background/50 rounded-lg">
                            <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span className="text-xs">{Math.round(card.durationMinutes / 60)}h {card.durationMinutes % 60}m</span>
                          </div>
                          <div className="flex items-center gap-2 p-2 bg-background/50 rounded-lg">
                            <DollarSign className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span className="text-xs">${card.estimatedCostPerPerson}/person</span>
                          </div>
                          {card.reviewCount && <>
                              <div className="flex items-center gap-2 p-2 bg-background/50 rounded-lg">
                                <Users className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                <span className="text-xs">{card.reviewCount > 1000 ? `${(card.reviewCount / 1000).toFixed(1)}k` : card.reviewCount} reviews</span>
                              </div>
                              <div className="flex items-center gap-2 p-2 bg-background/50 rounded-lg">
                                <Star className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                <span className="text-xs">{card.rating?.toFixed(1)}/5.0</span>
                              </div>
                            </>}
                        </div>

                        {/* Address */}
                        <div className="bg-background/50 p-3 rounded-lg">
                          <div className="flex items-start gap-2 text-sm">
                            <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                            <span className="text-muted-foreground text-xs leading-relaxed">{card.address}</span>
                          </div>
                        </div>

                        {/* View Route Button */}
                        <Button onClick={handleViewRoute} variant="outline" className="w-full bg-primary/5 hover:bg-primary/10 border-primary/20 text-primary" size="sm">
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Open in Maps
                        </Button>
                      </div>
                    </div>
                  </motion.div>}
              </AnimatePresence>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              {/* Dislike Button */}
              <motion.button whileTap={{
              scale: 0.95
            }} onClick={() => onDislike(card)} className="flex-1 h-14 rounded-2xl border-2 border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:border-red-300 transition-all flex items-center justify-center font-semibold">
                <X className="h-6 w-6" />
              </motion.button>

              {/* Invite Button */}
              

              {/* Like Button */}
              <motion.button whileTap={{
              scale: 0.95
            }} onClick={() => onLike(card)} className="flex-1 h-14 rounded-2xl border-2 border-green-200 bg-green-50 text-green-600 hover:bg-green-100 hover:border-green-300 transition-all flex items-center justify-center font-semibold">
                <Heart className="h-6 w-6" />
              </motion.button>
            </div>

            {/* Next Card Hint */}
            {hasNext && <p className="text-center text-xs text-muted-foreground pt-2">
                Tap ❤️ or ✕ to see the next recommendation
              </p>}
          </CardContent>
        </Card>
      </motion.div>
    </div>;
};