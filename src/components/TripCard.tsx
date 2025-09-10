import React, { useState } from 'react';
import { MapPin, Clock, DollarSign, CheckCircle, Cloud, Zap } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useUserProfile } from '@/hooks/useUserProfile';
import { formatCurrency } from '@/utils/currency';

interface TripCardProps {
  trip: {
    id: string;
    title: string;
    image: string;
    cost: number;
    duration: string;
    travelTime: string;
    badges: string[];
    whyItFits: string;
    location: string;
    category: string;
  };
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
  onExpand: () => void;
  className?: string;
  disableSwipe?: boolean;
}

export const TripCard = ({ trip, onSwipeRight, onSwipeLeft, onExpand, className, disableSwipe = false }: TripCardProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [isAnimating, setIsAnimating] = useState(false);
  const { profile } = useUserProfile();

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isAnimating || disableSwipe) return;
    setIsDragging(true);
    const touch = e.touches[0];
    setStartPos({ x: touch.clientX, y: touch.clientY });
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || isAnimating) return;
    e.preventDefault();
    const touch = e.touches[0];
    const deltaX = touch.clientX - startPos.x;
    const deltaY = touch.clientY - startPos.y;
    
    // Add some resistance for vertical movement
    const resistanceY = Math.abs(deltaY) > 50 ? deltaY * 0.3 : deltaY;
    
    setDragOffset({ x: deltaX, y: resistanceY });
  };

  const handleTouchEnd = () => {
    if (!isDragging || isAnimating) return;
    setIsDragging(false);
    
    const threshold = 80;
    const velocity = Math.abs(dragOffset.x);
    
    if (Math.abs(dragOffset.x) > threshold || velocity > 50) {
      setIsAnimating(true);
      if (dragOffset.x > 0) {
        // Trigger swipe right animation
        setTimeout(() => {
          onSwipeRight();
          setIsAnimating(false);
        }, 300);
      } else {
        // Trigger swipe left animation  
        setTimeout(() => {
          onSwipeLeft();
          setIsAnimating(false);
        }, 300);
      }
    } else {
      // Snap back smoothly
      setDragOffset({ x: 0, y: 0 });
    }
  };

  // Mouse events for desktop
  const handleMouseDown = (e: React.MouseEvent) => {
    if (isAnimating || disableSwipe) return;
    setIsDragging(true);
    setStartPos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || isAnimating) return;
    const deltaX = e.clientX - startPos.x;
    const deltaY = e.clientY - startPos.y;
    const resistanceY = Math.abs(deltaY) > 50 ? deltaY * 0.3 : deltaY;
    setDragOffset({ x: deltaX, y: resistanceY });
  };

  const handleMouseUp = () => {
    if (!isDragging || isAnimating) return;
    handleTouchEnd();
  };

  const getBadgeIcon = (badge: string) => {
    switch (badge.toLowerCase()) {
      case 'budget-fit':
        return <DollarSign className="h-3 w-3" />;
      case 'weather-ok':
        return <Cloud className="h-3 w-3" />;
      case 'verified':
        return <CheckCircle className="h-3 w-3" />;
      default:
        return <Zap className="h-3 w-3" />;
    }
  };

  const getBadgeVariant = (badge: string) => {
    switch (badge.toLowerCase()) {
      case 'budget-fit':
        return 'default';
      case 'weather-ok':
        return 'secondary';
      case 'verified':
        return 'outline';
      default:
        return 'default';
    }
  };

  return (
    <Card
      className={cn(
        "relative overflow-hidden cursor-pointer shadow-card hover:shadow-elevated",
        "touch-none select-none",
        isDragging ? "card-swipe" : "card-swipe-smooth",
        isAnimating && dragOffset.x > 0 && "animate-swipe-right",
        isAnimating && dragOffset.x < 0 && "animate-swipe-left",
        className
      )}
      style={{
        transform: !isAnimating ? `translate(${dragOffset.x}px, ${dragOffset.y}px) rotate(${dragOffset.x * 0.05}deg)` : undefined,
        opacity: !isAnimating ? Math.max(0.4, 1 - Math.abs(dragOffset.x) / 400) : undefined,
      }}
      onTouchStart={disableSwipe ? undefined : handleTouchStart}
      onTouchMove={disableSwipe ? undefined : handleTouchMove}
      onTouchEnd={disableSwipe ? undefined : handleTouchEnd}
      onMouseDown={disableSwipe ? undefined : handleMouseDown}
      onMouseMove={disableSwipe ? undefined : handleMouseMove}
      onMouseUp={disableSwipe ? undefined : handleMouseUp}
      onMouseLeave={disableSwipe ? undefined : handleMouseUp}
      onClick={(e) => {
        if (!isDragging && Math.abs(dragOffset.x) < 10) {
          onExpand();
        }
      }}
    >
      {/* Image Header */}
      <div className="relative h-48 bg-gradient-warm">
        <img 
          src={trip.image} 
          alt={trip.title}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        
        {/* Category - moved to bottom corner for better readability */}
        <div className="absolute bottom-4 right-4">
          <Badge variant="outline" className="bg-card/90 backdrop-blur-sm text-xs">
            {trip.category}
          </Badge>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        <h3 className="text-xl font-bold mb-2 text-foreground">{trip.title}</h3>
        
        <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
          {trip.whyItFits}
        </p>

        {/* Badges - moved here for better readability */}
        <div className="flex flex-wrap gap-1 mb-3">
          {trip.badges.map((badge) => (
            <Badge 
              key={badge} 
              variant={getBadgeVariant(badge)}
              className="flex items-center gap-1 text-xs"
            >
              {getBadgeIcon(badge)}
              <span>{badge}</span>
            </Badge>
          ))}
        </div>

        {/* Stats */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <DollarSign className="h-4 w-4" />
              <span>{formatCurrency(trip.cost, profile?.currency)} per person</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              <span>{trip.duration}</span>
            </div>
          </div>
        </div>

        {/* Location & Travel */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4" />
            <span>{trip.location}</span>
          </div>
          <span className="text-sm font-medium text-primary">{trip.travelTime}</span>
        </div>

        {/* Swipe Hint */}
        {!disableSwipe && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>← Swipe left to dismiss</span>
              <span>Tap to expand</span>
              <span>Swipe right to save →</span>
            </div>
          </div>
        )}
        {disableSwipe && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="text-center text-xs text-muted-foreground">
              <span>Tap to expand</span>
            </div>
          </div>
        )}
      </div>

      {/* Swipe Indicators */}
      {isDragging && !isAnimating && (
        <>
          {dragOffset.x > 60 && (
            <div className="absolute inset-0 bg-primary/20 backdrop-blur-sm flex items-center justify-center transition-all duration-200">
              <div className="text-primary text-3xl font-bold animate-pulse">SAVE</div>
            </div>
          )}
          {dragOffset.x < -60 && (
            <div className="absolute inset-0 bg-destructive/20 backdrop-blur-sm flex items-center justify-center transition-all duration-200">
              <div className="text-destructive text-3xl font-bold animate-pulse">DISMISS</div>
            </div>
          )}
        </>
      )}
    </Card>
  );
};