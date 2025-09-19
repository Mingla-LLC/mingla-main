import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { 
  MapPin, 
  Clock, 
  Star, 
  Users, 
  Bookmark, 
  Share2, 
  Navigation,
  Heart,
  MessageCircle
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import type { RecommendationCard as CardType } from '@/types/recommendations';

interface RecommendationCardProps {
  card: CardType;
  onInvite?: (card: CardType) => void;
  onSave?: (card: CardType) => void;
  onShare?: (card: CardType) => void;
  index?: number;
}

export const RecommendationCard: React.FC<RecommendationCardProps> = ({
  card,
  onInvite,
  onSave,
  onShare,
  index = 0
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

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

  const handleInvite = () => {
    if (onInvite) {
      onInvite(card);
    } else {
      toast({
        title: "Invite sent!",
        description: `Invited friends to ${card.title}`,
      });
    }
  };

  const handleSave = () => {
    setIsSaved(!isSaved);
    if (onSave) {
      onSave(card);
    } else {
      toast({
        title: isSaved ? "Removed from saved" : "Saved!",
        description: isSaved ? `Removed ${card.title}` : `Saved ${card.title} for later`,
      });
    }
  };

  const handleShare = () => {
    if (navigator.share && navigator.canShare?.({ title: card.title, url: card.route.mapsDeepLink })) {
      navigator.share({
        title: card.title,
        text: card.copy.oneLiner,
        url: card.route.mapsDeepLink,
      });
    } else {
      navigator.clipboard.writeText(`${card.title} - ${card.route.mapsDeepLink}`);
      toast({
        title: "Link copied!",
        description: "Shared link copied to clipboard",
      });
    }
    if (onShare) onShare(card);
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

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ 
        duration: 0.4, 
        delay: index * 0.1,
        ease: [0.4, 0, 0.2, 1]
      }}
      whileHover={{ 
        y: -4,
        transition: { duration: 0.2 }
      }}
      className="group"
      data-testid="recommendation-card"
    >
      <Card className="overflow-hidden bg-white shadow-md hover:shadow-xl transition-all duration-300 border-0 rounded-2xl">
        {/* Image Section */}
        <div className="relative aspect-video overflow-hidden bg-muted">
          {!imageLoaded && !imageFailed && (
            <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-muted via-muted/50 to-muted" />
          )}
          
          {!imageFailed ? (
            <img
              src={card.imageUrl}
              alt={card.title}
              className={`w-full h-full object-cover transition-all duration-500 group-hover:scale-105 ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              }`}
              onLoad={handleImageLoad}
              onError={handleImageError}
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center">
              <MapPin className="h-12 w-12 text-muted-foreground" />
            </div>
          )}

          {/* Overlays */}
          <div className="absolute top-3 left-3 flex gap-2">
            <Badge className={`text-xs font-medium ${getCategoryColor(card.category)}`} data-testid="category-badge">
              {card.category.replace('_', ' & ')}
            </Badge>
            <Badge variant="secondary" className="text-xs font-medium bg-black/50 text-white">
              {getPriceDisplay(card.priceLevel)}
            </Badge>
          </div>

          {/* Rating */}
          {card.rating && (
            <div className="absolute top-3 right-3 flex items-center gap-1 bg-black/50 text-white px-2 py-1 rounded-full text-xs font-medium">
              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
              {card.rating.toFixed(1)}
            </div>
          )}

          {/* Travel Info Overlay */}
          <div className="absolute bottom-3 right-3 bg-black/70 text-white px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1" data-testid="travel-info">
            <Navigation className="h-3 w-3" />
            {card.route.etaMinutes}m • {card.route.distanceText}
          </div>
        </div>

        <CardContent className="p-4 space-y-3">
          {/* Title and Subtitle */}
          <div className="space-y-1">
            <h3 className="font-semibold text-lg leading-tight line-clamp-2 group-hover:text-primary transition-colors">
              {card.title}
            </h3>
            <p className="text-sm text-muted-foreground line-clamp-1">
              {card.subtitle}
            </p>
          </div>

          {/* LLM Generated Copy */}
          <div className="space-y-2">
            <p className="text-sm text-foreground leading-relaxed">
              {card.copy.oneLiner}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed flex items-start gap-1">
              <MessageCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
              <span>{card.copy.tip}</span>
            </p>
          </div>

          {/* Metadata */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {Math.round(card.durationMinutes / 60)}h {card.durationMinutes % 60}m
            </div>
            {card.reviewCount && (
              <div className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {card.reviewCount > 1000 ? `${(card.reviewCount / 1000).toFixed(1)}k` : card.reviewCount} reviews
              </div>
            )}
            <div className="font-medium text-foreground">
              ${card.estimatedCostPerPerson}/person
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button
              onClick={handleViewRoute}
              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
              size="sm"
            >
              <Navigation className="h-4 w-4 mr-2" />
              View Route
            </Button>
            
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleInvite}
              className="p-2 rounded-lg border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors"
              data-testid="invite-button"
            >
              <Users className="h-4 w-4" />
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleSave}
              className={`p-2 rounded-lg border transition-all ${
                isSaved 
                  ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100' 
                  : 'border-input bg-background hover:bg-accent hover:text-accent-foreground'
              }`}
              data-testid="save-button"
            >
              {isSaved ? <Heart className="h-4 w-4 fill-current" /> : <Bookmark className="h-4 w-4" />}
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleShare}
              className="p-2 rounded-lg border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <Share2 className="h-4 w-4" />
            </motion.button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};