import React, { useState } from 'react';
import { MapPin, Clock, DollarSign, CheckCircle, Cloud, Zap } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
}

export const TripCard = ({ trip, onSwipeRight, onSwipeLeft, onExpand, className }: TripCardProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    const touch = e.touches[0];
    setStartPos({ x: touch.clientX, y: touch.clientY });
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - startPos.x;
    const deltaY = touch.clientY - startPos.y;
    setDragOffset({ x: deltaX, y: deltaY });
  };

  const handleTouchEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    
    const threshold = 100;
    if (Math.abs(dragOffset.x) > threshold) {
      if (dragOffset.x > 0) {
        onSwipeRight();
      } else {
        onSwipeLeft();
      }
    }
    
    setDragOffset({ x: 0, y: 0 });
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
        "relative overflow-hidden cursor-pointer transition-all duration-300 shadow-card hover:shadow-elevated",
        "touch-none select-none",
        className
      )}
      style={{
        transform: `translate(${dragOffset.x}px, ${dragOffset.y}px) rotate(${dragOffset.x * 0.1}deg)`,
        opacity: Math.max(0.3, 1 - Math.abs(dragOffset.x) / 300),
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={onExpand}
    >
      {/* Image Header */}
      <div className="relative h-48 bg-gradient-warm">
        <img 
          src={trip.image} 
          alt={trip.title}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        
        {/* Badges */}
        <div className="absolute top-4 left-4 flex flex-wrap gap-2">
          {trip.badges.map((badge) => (
            <Badge 
              key={badge} 
              variant={getBadgeVariant(badge)}
              className="flex items-center gap-1 bg-card/90 backdrop-blur-sm"
            >
              {getBadgeIcon(badge)}
              <span className="text-xs">{badge}</span>
            </Badge>
          ))}
        </div>

        {/* Category */}
        <div className="absolute top-4 right-4">
          <Badge variant="outline" className="bg-card/90 backdrop-blur-sm">
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

        {/* Stats */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <DollarSign className="h-4 w-4" />
              <span>${trip.cost} per person</span>
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
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>← Swipe left to dismiss</span>
            <span>Tap to expand</span>
            <span>Swipe right to save →</span>
          </div>
        </div>
      </div>

      {/* Swipe Indicators */}
      {isDragging && (
        <>
          {dragOffset.x > 50 && (
            <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
              <div className="text-primary text-2xl font-bold">SAVE</div>
            </div>
          )}
          {dragOffset.x < -50 && (
            <div className="absolute inset-0 bg-destructive/20 flex items-center justify-center">
              <div className="text-destructive text-2xl font-bold">DISMISS</div>
            </div>
          )}
        </>
      )}
    </Card>
  );
};