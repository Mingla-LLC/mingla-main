import React from 'react';
import { Heart, Bookmark, MapPin, Star, Navigation, Clock, Users, ShieldCheck, Building2, Share2 } from 'lucide-react';
import { Recommendation } from './types';
import { getIconComponent } from './utils';
import { ImageWithFallback } from '../figma/ImageWithFallback';
import { getCategoryDisplayName } from '../utils/preferences';

interface SwipeCardProps {
  recommendation: Recommendation;
  isTopCard: boolean;
  dragOffset: { x: number; y: number };
  isDragging: boolean;
  swipeDirection: 'left' | 'right' | null;
  containerRef?: React.RefObject<HTMLDivElement>;
  onTouchStart?: (e: React.TouchEvent) => void;
  onTouchMove?: (e: React.TouchEvent) => void;
  onTouchEnd?: (e: React.TouchEvent) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onMouseMove?: (e: React.MouseMove) => void;
  onMouseUp?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  onCardClick?: () => void;
  onShare?: () => void;
}

export default function SwipeCard({
  recommendation,
  isTopCard,
  dragOffset,
  isDragging,
  swipeDirection,
  containerRef,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onMouseLeave,
  onCardClick,
  onShare
}: SwipeCardProps) {
  const RecCategoryIcon = getIconComponent(recommendation.categoryIcon);

  return (
    <div 
      ref={isTopCard ? containerRef : null}
      className={`absolute inset-0 ${isTopCard ? 'z-20' : 'z-10 hidden'}`}
      style={{
        transform: isTopCard 
          ? `translateX(${dragOffset.x}px) rotate(${dragOffset.x * 0.08}deg) scale(${1 - Math.abs(dragOffset.x) * 0.00008})`
          : `scale(0.95) translateY(8px)`,
        transition: isTopCard && !isDragging ? 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)' : 'none',
        opacity: isTopCard ? Math.max(0.3, 1 - Math.abs(dragOffset.x) * 0.0005) : 0.85,
        touchAction: isTopCard ? 'pan-y' : 'auto',
        filter: isTopCard ? 'drop-shadow(0 20px 40px rgba(0,0,0,0.15))' : 'drop-shadow(0 10px 20px rgba(0,0,0,0.1))'
      }}
      onTouchStart={isTopCard ? onTouchStart : undefined}
      onTouchMove={isTopCard ? onTouchMove : undefined}
      onTouchEnd={isTopCard ? onTouchEnd : undefined}
      onMouseDown={isTopCard ? onMouseDown : undefined}
      onMouseMove={isTopCard ? onMouseMove : undefined}
      onMouseUp={isTopCard ? onMouseUp : undefined}
      onMouseLeave={isTopCard ? onMouseLeave : undefined}
      data-coachmark={isTopCard ? "swipe-card" : undefined}
    >
      {/* Swipe Direction Indicators */}
      {isTopCard && swipeDirection && (
        <div className={`absolute inset-0 z-30 flex items-center justify-center pointer-events-none`}>
          <div className={`
            px-8 py-4 rounded-3xl border-4 font-bold text-2xl transform rotate-12 spring-in
            ${swipeDirection === 'right' 
              ? 'border-[#eb7825] text-[#eb7825] glass-card shadow-2xl' 
              : 'border-gray-500 text-gray-500 glass-card shadow-2xl'
            }
          `} style={{
            backdropFilter: 'blur(20px)',
            boxShadow: swipeDirection === 'right' 
              ? '0 10px 40px rgba(235, 120, 37, 0.3)' 
              : '0 10px 40px rgba(0, 0, 0, 0.2)'
          }}>
            {swipeDirection === 'right' ? 'LIKE' : 'PASS'}
          </div>
        </div>
      )}

      {/* Card Content */}
      <div
        onClick={isTopCard ? onCardClick : undefined}
        className={`
          glass-card rounded-3xl overflow-hidden h-full flex flex-col
          ${isTopCard ? 'cursor-pointer card-elevated' : 'pointer-events-none'}
        `}
        style={{
          boxShadow: isTopCard 
            ? '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.1) inset'
            : '0 10px 30px -10px rgba(0, 0, 0, 0.15)'
        }}
      >
        {/* Image Section */}
        <div className="relative h-[65%] bg-gray-100 overflow-hidden">
          <ImageWithFallback
            src={recommendation.image}
            alt={recommendation.title}
            className="w-full h-full object-cover"
          />
          
          {/* Gradient Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
          
          {/* Top Actions */}
          <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2 z-10">
            <div className="flex flex-col gap-2 slide-up">
              {/* Match Score Badge */}
              <div className="glass-badge rounded-full flex items-center gap-1 shadow-lg hover:scale-105 transition-smooth">
                <Star className="w-3.5 h-3.5 text-[#eb7825] fill-[#eb7825]" />
                <span className="text-sm font-semibold text-gray-900">{recommendation.matchScore}% Match</span>
              </div>

              {/* Creator Badge */}
              {recommendation.creator && (
                <div className="glass-badge rounded-full flex items-center gap-1 shadow-lg hover:scale-105 transition-smooth">
                  {recommendation.creator.type === 'curator' && (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                      <span className="text-xs font-medium text-blue-600">
                        {recommendation.creator.name ? `By ${recommendation.creator.name}` : 'Curated'}
                      </span>
                    </>
                  )}
                  {recommendation.creator.type === 'business' && (
                    <>
                      <Building2 className="w-3.5 h-3.5 text-purple-600" />
                      <span className="text-xs font-medium text-purple-600">
                        {recommendation.creator.businessName || 'Business'}
                      </span>
                    </>
                  )}
                  {recommendation.creator.type === 'platform' && (
                    <>
                      <Star className="w-3.5 h-3.5 text-[#eb7825]" />
                      <span className="text-xs font-medium text-[#eb7825]">Mingla</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Bottom Info on Image */}
          <div className="absolute bottom-3 left-3 right-3 text-white z-10 slide-up">
            <h3 className="text-xl font-bold mb-1 drop-shadow-lg">{recommendation.title}</h3>
            <div className="flex items-center gap-2 text-sm">
              <div className="flex items-center gap-1 glass-badge-dark rounded-full shadow-md hover:scale-105 transition-smooth">
                <MapPin className="w-3.5 h-3.5" />
                <span>{recommendation.distance}</span>
              </div>
              <div className="flex items-center gap-1 glass-badge-dark rounded-full shadow-md hover:scale-105 transition-smooth">
                <Clock className="w-3.5 h-3.5" />
                <span>{recommendation.travelTime}</span>
              </div>
              <div className="flex items-center gap-1 glass-badge-dark rounded-full shadow-md hover:scale-105 transition-smooth">
                <Star className="w-3.5 h-3.5 fill-white" />
                <span>{recommendation.rating}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Details Section */}
        <div className="flex-1 p-4 flex flex-col">
          {/* Category */}
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-gradient-to-br from-orange-100 to-orange-50 rounded-full flex items-center justify-center shadow-sm hover:scale-110 transition-smooth">
              <RecCategoryIcon className="w-4 h-4 text-[#eb7825]" />
            </div>
            <span className="text-sm text-gray-600 font-medium">{getCategoryDisplayName(recommendation.category)}</span>
          </div>

          {/* Description */}
          <p className="text-sm text-gray-900 mb-3 leading-relaxed font-normal">
            {recommendation.description}
          </p>

          {/* Share Button */}
          {onShare && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onShare();
              }}
              className="mt-auto w-full flex items-center justify-center gap-2 px-4 py-2.5 glass-button text-gray-700 rounded-xl transition-smooth hover:scale-105 active:scale-95 shadow-md"
            >
              <Share2 className="w-4 h-4" />
              <span className="font-medium">Share</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}