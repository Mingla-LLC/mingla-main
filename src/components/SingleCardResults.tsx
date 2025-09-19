import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronUp, ThumbsUp, ThumbsDown, MapPin, Heart, Share2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/api/client";
import { toast } from "@/hooks/use-toast";
import type { RecommendationCard, RecommendationsRequest } from "@/types/recommendations";
import { supabase } from "@/integrations/supabase/client";

interface SingleCardResultsProps {
  preferences: RecommendationsRequest;
  onInvite?: (card: RecommendationCard) => void;
  onSave?: (card: RecommendationCard) => void;
}

export default function SingleCardResults({ preferences, onInvite, onSave }: SingleCardResultsProps) {
  const [queue, setQueue] = useState<RecommendationCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [isSliding, setIsSliding] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);
  const loadingRef = useRef(false);
  const prefsHashRef = useRef<string>('');

  // Generate preferences hash for learning
  const prefsHash = useMemo(() => {
    return btoa(JSON.stringify(preferences)).slice(0, 16);
  }, [preferences]);

  useEffect(() => {
    prefsHashRef.current = prefsHash;
  }, [prefsHash]);

  const fetchMore = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    
    try {
      console.log('🔄 Fetching more recommendations, cursor:', cursor);
      const response = await supabase.functions.invoke('recommendations', {
        body: {
          ...preferences,
          cursor,
          limit: 25
        }
      });

      if (response.error) throw response.error;
      
      const { cards, meta } = response.data;
      console.log('📦 Received cards:', cards?.length, 'Next cursor:', meta?.cursorNext);
      
      setQueue(q => q.concat(cards || []));
      setCursor(meta?.cursorNext ?? null);
    } catch (error) {
      console.error('❌ Error fetching recommendations:', error);
      toast({
        title: "Error loading recommendations",
        description: "Please try again later",
        variant: "destructive"
      });
    } finally {
      loadingRef.current = false;
    }
  };

  // Initial load and refresh on preferences change
  useEffect(() => {
    console.log('🎯 Preferences changed, resetting queue');
    setQueue([]);
    setCursor(null);
    setExpanded(false);
    fetchMore();
  }, [JSON.stringify(preferences)]);

  const current = queue[0];

  const sendFeedback = async (decision: "like" | "dislike") => {
    const card = queue[0];
    if (!card || isSliding) return;

    console.log('👍👎 Sending feedback:', decision, 'for card:', card.id);
    
    // Set slide animation
    setIsSliding(true);
    setSlideDirection(decision === 'like' ? 'right' : 'left');
    setExpanded(false);

    // Optimistically advance queue
    setTimeout(() => {
      setQueue(q => q.slice(1));
      setIsSliding(false);
      setSlideDirection(null);
      
      // Backfill if running low
      if (queue.length < 5 && cursor) {
        fetchMore();
      }
    }, 300);

    try {
      const response = await supabase.functions.invoke('recommendations/feedback', {
        body: {
          cardId: card.id,
          decision,
          prefsHash: prefsHashRef.current,
          rank: queue.length - queue.indexOf(card) + 1
        },
        headers: {
          'Idempotency-Key': crypto.randomUUID()
        }
      });

      if (response.error) {
        console.error('❌ Feedback error:', response.error);
      } else {
        console.log('✅ Feedback processed:', response.data);
      }
    } catch (error) {
      console.error('❌ Failed to send feedback:', error);
      // Optional: re-queue card on failure
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!current || isSliding) return;
    
    switch (e.key.toLowerCase()) {
      case 'l':
      case 'arrowright':
        e.preventDefault();
        sendFeedback('like');
        break;
      case 'd':
      case 'arrowleft':
        e.preventDefault();
        sendFeedback('dislike');
        break;
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [current, isSliding]);

  const getPriceDisplay = (level: number) => {
    return '💰'.repeat(Math.max(1, Math.min(level || 1, 5)));
  };

  // Empty state
  if (!current && !loadingRef.current) {
    return (
      <div className="mx-auto max-w-xl text-center py-16">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-muted flex items-center justify-center">
          <MapPin className="w-8 h-8 text-muted-foreground" />
        </div>
        <h3 className="text-xl font-semibold mb-2">You're all caught up</h3>
        <p className="text-muted-foreground mb-4">
          Adjust preferences above to see more ideas.
        </p>
        <Button variant="outline" onClick={() => {
          document.dispatchEvent(new CustomEvent('open-preferences'));
        }}>
          Adjust Preferences
        </Button>
      </div>
    );
  }

  // Loading state
  if (!current) {
    return (
      <div className="mx-auto max-w-xl px-4">
        <Card className="animate-pulse">
          <div className="aspect-video bg-muted rounded-t-lg" />
          <CardContent className="p-6 space-y-4">
            <div className="h-6 bg-muted rounded w-3/4" />
            <div className="h-4 bg-muted rounded w-1/2" />
            <div className="flex gap-2">
              <div className="h-6 bg-muted rounded w-16" />
              <div className="h-6 bg-muted rounded w-20" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4">
      <AnimatePresence mode="popLayout">
        <motion.div
          key={current.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ 
            opacity: 1, 
            y: 0,
            x: isSliding ? (slideDirection === 'right' ? '100%' : '-100%') : 0
          }}
          exit={{ 
            opacity: 0, 
            x: slideDirection === 'right' ? '100%' : '-100%',
            transition: { duration: 0.3 }
          }}
          transition={{ duration: 0.3 }}
          className="rounded-2xl shadow-lg overflow-hidden bg-card border"
        >
          {/* Image */}
          {current.imageUrl && (
            <div className="relative aspect-video overflow-hidden">
              <img 
                src={current.imageUrl} 
                alt={current.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute top-4 right-4">
                <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm">
                  {current.category}
                </Badge>
              </div>
            </div>
          )}

          <CardContent className="p-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex-1">
                <h3 className="text-xl font-semibold leading-tight mb-1">
                  {current.title}
                </h3>
                <p className="text-muted-foreground text-sm">
                  {current.subtitle}
                </p>
              </div>
              
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(!expanded)}
                className="shrink-0"
                aria-expanded={expanded}
              >
                {expanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </div>

            {/* Quick info */}
            <div className="flex flex-wrap gap-2 mb-4">
              <Badge variant="outline">
                {getPriceDisplay(current.priceLevel)} ${current.estimatedCostPerPerson}
              </Badge>
              <Badge variant="outline">
                🚗 {current.route.etaMinutes} min
              </Badge>
              {current.rating && (
                <Badge variant="outline">
                  ⭐ {current.rating}
                </Badge>
              )}
            </div>

            {/* Expandable details */}
            <AnimatePresence>
              {expanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="mb-6 space-y-4"
                >
                  {/* Copy */}
                  <div className="space-y-2">
                    <p className="text-sm leading-relaxed">
                      {current.copy.oneLiner}
                    </p>
                    {current.copy.tip && (
                      <p className="text-xs text-muted-foreground italic">
                        💡 {current.copy.tip}
                      </p>
                    )}
                  </div>

                  {/* Address */}
                  <p className="text-sm text-muted-foreground">
                    📍 {current.address}
                  </p>

                  {/* Hours if available */}
                  {current.openingHours && (
                    <div className="text-sm">
                      <span className={`inline-block px-2 py-1 rounded-full text-xs ${
                        current.openingHours.openNow 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {current.openingHours.openNow ? '🟢 Open now' : '🔴 Closed'}
                      </span>
                    </div>
                  )}

                  {/* Route link */}
                  <Button asChild size="sm" variant="outline" className="w-full">
                    <a 
                      href={current.route.mapsDeepLink} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-2"
                    >
                      <MapPin className="h-4 w-4" />
                      View Route ({current.route.etaMinutes} min)
                    </a>
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Action buttons */}
            <div className="flex items-center justify-between gap-3">
              {/* Secondary actions */}
              <div className="flex gap-2">
                {current.actions.invite && onInvite && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onInvite(current)}
                  >
                    <Users className="h-4 w-4 mr-1" />
                    Invite
                  </Button>
                )}
                
                {current.actions.save && onSave && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSave(current)}
                  >
                    <Heart className="h-4 w-4" />
                  </Button>
                )}
                
                {current.actions.share && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.share?.({
                        title: current.title,
                        text: current.copy.oneLiner,
                        url: current.route.mapsDeepLink
                      });
                    }}
                  >
                    <Share2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {/* Primary actions */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => sendFeedback('dislike')}
                  disabled={isSliding}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  <ThumbsDown className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  onClick={() => sendFeedback('like')}
                  disabled={isSliding}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  <ThumbsUp className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </motion.div>
      </AnimatePresence>

      {/* Helper text */}
      <p className="text-center text-xs text-muted-foreground mt-4">
        Use keyboard: L (like), D (dislike), or ← → arrows
      </p>
    </div>
  );
}