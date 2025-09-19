import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { RecommendationCard } from './RecommendationCard';
import { AlertCircle, MapPin, RefreshCw, Sliders } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import type { RecommendationCard as CardType } from '@/types/recommendations';

interface RecommendationsGridProps {
  cards: CardType[];
  loading: boolean;
  onInvite?: (card: CardType) => void;
  onSave?: (card: CardType) => void;
  onShare?: (card: CardType) => void;
  onViewRoute?: (card: CardType) => void;
  selectedCard?: string | null;
  onCardSelect?: (cardId: string | null) => void;
}

export const RecommendationsGrid: React.FC<RecommendationsGridProps> = ({
  cards,
  loading,
  onInvite,
  onSave,
  onShare,
  onViewRoute,
  selectedCard,
  onCardSelect
}) => {
  const handleCardAction = (card: CardType, action: 'invite' | 'save' | 'share' | 'route') => {
    switch (action) {
      case 'invite':
        onInvite?.(card);
        break;
      case 'save':
        onSave?.(card);
        break;
      case 'share':
        onShare?.(card);
        break;
      case 'route':
        onViewRoute?.(card);
        break;
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-5 w-12 rounded-full" />
          </div>
          <Skeleton className="h-9 w-24" />
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <Skeleton className="h-48 w-full rounded-t-lg" />
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <div className="flex gap-2">
                  <Skeleton className="h-6 w-16 rounded-full" />
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
                <div className="flex gap-2 pt-2">
                  <Skeleton className="h-8 w-20" />
                  <Skeleton className="h-8 w-16" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Empty state
  if (!cards || cards.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-muted flex items-center justify-center">
            <MapPin className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-semibold mb-2">No recommendations found</h3>
          <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
            We couldn't find any experiences matching your preferences. Try adjusting your filters.
          </p>
          <Button variant="outline" onClick={() => {
            // This would trigger opening preferences
            document.dispatchEvent(new CustomEvent('open-preferences'));
          }}>
            <Sliders className="w-4 h-4 mr-2" />
            Adjust Filters
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold">Recommendations</h2>
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="bg-primary text-primary-foreground text-sm px-2 py-1 rounded-full font-medium"
          >
            {cards.length}
          </motion.div>
        </div>
        
        <Button variant="outline" size="sm" onClick={() => {
          // This would trigger opening preferences
          document.dispatchEvent(new CustomEvent('open-preferences'));
        }}>
          <Sliders className="w-4 h-4 mr-2" />
          Adjust Filters
        </Button>
      </div>

      {/* Grid */}
      <AnimatePresence mode="popLayout">
        <motion.div 
          layout
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {cards.map((card, index) => (
            <motion.div
              key={card.id}
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ 
                duration: 0.3,
                delay: index * 0.1,
                layout: { duration: 0.2 }
              }}
              className="h-full"
            >
              <RecommendationCard
                card={card}
                onInvite={() => handleCardAction(card, 'invite')}
                onSave={() => handleCardAction(card, 'save')}
                onShare={() => handleCardAction(card, 'share')}
              />
            </motion.div>
          ))}
        </motion.div>
      </AnimatePresence>

      {/* Show More Button (if more cards available) */}
      {cards.length >= 20 && (
        <div className="text-center pt-6">
          <Button variant="outline" size="lg">
            <RefreshCw className="w-4 h-4 mr-2" />
            Load More Recommendations
          </Button>
        </div>
      )}
    </div>
  );
};