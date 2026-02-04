import React from 'react';
import { motion } from 'motion/react';
import {
  X, Star, Navigation, Sparkles, Calendar, Share2, ExternalLink,
  Sun, Cloud, Cloudy, CloudDrizzle, CloudRain, CloudSnow, Wind, Thermometer,
  Car, TrendingUp, TrendingDown, AlertTriangle, Activity, Users
} from 'lucide-react';
import { Recommendation } from './types';
import { getIconComponent, openAllInMaps } from './utils';
import { formatCurrency, getExperienceTypeLabel } from '../utils/formatters';
import { getCategoryDisplayName } from '../utils/preferences';
import CardGallery from './CardGallery';
import SwipeIndicator from './SwipeIndicator';
import TimelineDisplay from '../TimelineDisplay';
import SingleVenueTimeline from '../SingleVenueTimeline';

interface CardDetailsProps {
  recommendation: Recommendation;
  galleryIndex: number;
  onClose: () => void;
  onNavigateGallery: (direction: 'prev' | 'next') => void;
  onSetGalleryIndex: (index: number) => void;
  onSchedule: () => void;
  onBuyNow: () => void;
  onShare: () => void;
  userPreferences?: any;
  swipeDirection: 'left' | 'right' | null;
  isDragging: boolean;
  dragOffset: { x: number; y: number };
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: (e: React.MouseEvent) => void;
  onMouseLeave: (e: React.MouseEvent) => void;
  hideMatchScore?: boolean;
}

// Helper function to format numbers with K/M suffix
const formatNumber = (num: number): string => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
};

// Helper function to format price range
const formatPriceRange = (priceRange: string): string => {
  return priceRange;
};

export default function CardDetails({
  recommendation,
  galleryIndex,
  onClose,
  onNavigateGallery,
  onSetGalleryIndex,
  onSchedule,
  onBuyNow,
  onShare,
  userPreferences,
  swipeDirection,
  isDragging,
  dragOffset,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onMouseLeave,
  hideMatchScore
}: CardDetailsProps) {
  const CategoryIcon = getIconComponent(recommendation.categoryIcon);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 flex items-center justify-center p-4">
      <div 
        className="absolute top-4 left-4 right-4 bottom-24 bg-white rounded-3xl shadow-2xl border border-gray-100 flex flex-col overflow-hidden"
        style={{
          transform: `translateX(${dragOffset.x}px) rotate(${dragOffset.x * 0.05}deg)`,
          transition: !isDragging ? 'transform 0.3s ease-out' : 'none',
          opacity: 1 - Math.abs(dragOffset.x) * 0.0005
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
      >
        {/* Swipe Direction Indicators */}
        {swipeDirection && <SwipeIndicator direction={swipeDirection} />}

        {/* Header with close button */}
        <div className="relative p-4 border-b border-gray-100 flex-shrink-0">
          <button
            onClick={onClose}
            className="absolute left-4 top-4 w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4 text-gray-600" />
          </button>
          
          <div className="text-center">
            {!hideMatchScore && (
              <div className="inline-flex items-center gap-2 bg-[#eb7825] text-white px-3 py-1 rounded-full">
                <Sparkles className="w-4 h-4" />
                <span className="font-bold text-sm">{recommendation.matchScore}% Match</span>
              </div>
            )}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Image gallery */}
          <CardGallery
            images={recommendation.images.length > 0 ? recommendation.images : [recommendation.image]}
            currentIndex={galleryIndex}
            title={recommendation.title}
            onPrevious={() => onNavigateGallery('prev')}
            onNext={() => onNavigateGallery('next')}
            className="h-64"
          />

          {/* Detailed content */}
          <div className="p-4 space-y-4">
            {/* Title and category */}
            <div>
              <h2 className="font-bold text-2xl text-gray-900 mb-2">{recommendation.title}</h2>
              <div className="flex items-center gap-2 mb-3">
                <CategoryIcon className="w-5 h-5 text-[#eb7825]" />
                <span className="font-medium text-[#eb7825]">{getCategoryDisplayName(recommendation.category)}</span>
                <span className="text-gray-400">•</span>
                <span className="text-gray-600">{getExperienceTypeLabel(recommendation.experienceType)}</span>
              </div>
            </div>

            {/* Stats row */}
            <div className="flex items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 fill-[#eb7825] text-[#eb7825] flex-shrink-0" />
                <span className="text-gray-900">{recommendation.rating}</span>
              </div>
              
              <div className="w-px h-4 bg-gray-300 flex-shrink-0"></div>
              
              <div className="flex items-center gap-2 text-gray-600">
                <Navigation className="w-4 h-4 text-[#eb7825] flex-shrink-0" />
                <span>{recommendation.travelTime.split(' from ')[0].trim()}</span>
              </div>
              
              <div className="w-px h-4 bg-gray-300 flex-shrink-0"></div>
              
              <div className="flex items-center gap-2">
                <span className="text-[#eb7825]">{formatPriceRange(recommendation.priceRange).replace(/^([$€£¥₹])(\d+)(\.\\d+)?-\1(\d+)(\.\d+)?$/, '$1$2-$4')}</span>
              </div>
            </div>

            {/* Full description */}
            <div className="space-y-3">
              <p className="text-gray-700 leading-relaxed">
                {recommendation.fullDescription || recommendation.description}
              </p>
              <p className="bg-[#eb7825] text-white leading-relaxed p-4 rounded-lg text-sm">
                <strong>Match Reason:</strong> Suggested because it matches your preference for {userPreferences?.experienceType?.toLowerCase() || 'solo adventure'} experiences, fits within your {userPreferences?.budget || '$50-100'} budget range, and scheduled for your preferred {userPreferences?.timeOfDay?.toLowerCase() || 'afternoon'} time.
              </p>
            </div>

            {/* Weather Analysis Section */}
            {(() => {
              const weatherConditions = [
                { id: 'sunny', label: 'Sunny', icon: Sun, temp: 75, recommendation: 'Perfect outdoor weather for this activity!', color: 'bg-orange-50 border-[#eb7825]/30', textColor: 'text-[#d6691f]', iconColor: 'text-[#eb7825]' },
                { id: 'partly-cloudy', label: 'Partly Cloudy', icon: Cloud, temp: 68, recommendation: 'Great conditions - comfortable and pleasant!', color: 'bg-orange-50/50 border-[#eb7825]/20', textColor: 'text-[#d6691f]', iconColor: 'text-[#eb7825]' },
                { id: 'cloudy', label: 'Cloudy', icon: Cloudy, temp: 65, recommendation: 'Good weather for indoor or covered activities.', color: 'bg-gray-50 border-gray-300', textColor: 'text-gray-800', iconColor: 'text-gray-600' },
                { id: 'light-rain', label: 'Light Rain', icon: CloudDrizzle, temp: 62, recommendation: 'Consider rescheduling or choose indoor option.', color: 'bg-[#d6691f]/10 border-[#d6691f]/30', textColor: 'text-[#d6691f]', iconColor: 'text-[#d6691f]' },
                { id: 'rainy', label: 'Rainy', icon: CloudRain, temp: 58, recommendation: 'Indoor alternative recommended due to weather.', color: 'bg-[#d6691f]/20 border-[#d6691f]', textColor: 'text-[#d6691f]', iconColor: 'text-gray-700' }
              ];
              
              const isOutdoorCategory = ['stroll', 'picnics', 'playMove'].includes((recommendation as any).categoryId || '');
              const weatherIndex = isOutdoorCategory 
                ? Math.floor(Math.random() * weatherConditions.length)
                : Math.floor(Math.random() * 3);
              
              const weather = weatherConditions[weatherIndex];
              const WeatherIcon = weather.icon;
              
              return (
                <div className={`${weather.color} border-2 rounded-xl p-4 space-y-3`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="bg-white rounded-full p-2 shadow-sm">
                        <WeatherIcon className={`w-5 h-5 sm:w-6 sm:h-6 ${weather.iconColor}`} />
                      </div>
                      <div>
                        <h4 className={`font-semibold text-sm sm:text-base ${weather.textColor}`}>Weather Forecast</h4>
                        <p className="text-xs sm:text-sm text-gray-600">{weather.label}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 bg-white rounded-full px-3 py-1.5 shadow-sm">
                      <Thermometer className="w-4 h-4 text-gray-600" />
                      <span className="font-semibold text-sm sm:text-base text-gray-800">{weather.temp}°F</span>
                    </div>
                  </div>
                  
                  <div className={`${weather.color} border border-current/20 rounded-lg p-3`}>
                    <p className={`text-xs sm:text-sm leading-relaxed ${weather.textColor}`}>
                      <span className="font-semibold">Recommendation:</span> {weather.recommendation}
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* Traffic & Busy Level - Mock data generation */}
            {(() => {
              const trafficLevels = [
                { id: 'clear', label: 'Clear Roads', icon: Car, time: '12 min', delay: 'No delays', recommendation: 'Excellent driving conditions - smooth journey ahead!', color: 'bg-orange-50 border-[#eb7825]/30', textColor: 'text-[#d6691f]', iconColor: 'text-[#eb7825]', barColor: 'bg-[#eb7825]/50' },
                { id: 'light', label: 'Light Traffic', icon: Car, time: '14 min', delay: '+2 min delay', recommendation: 'Good conditions - plan for slight delays.', color: 'bg-orange-50/70 border-[#eb7825]/30', textColor: 'text-[#d6691f]', iconColor: 'text-[#eb7825]', barColor: 'bg-[#eb7825]/80' },
                { id: 'moderate', label: 'Moderate Traffic', icon: Car, time: '18 min', delay: '+6 min delay', recommendation: 'Expect moderate delays - leave early.', color: 'bg-[#eb7825]/10 border-[#eb7825]/40', textColor: 'text-[#d6691f]', iconColor: 'text-[#eb7825]', barColor: 'bg-[#eb7825]' },
                { id: 'heavy', label: 'Heavy Traffic', icon: AlertTriangle, time: '28 min', delay: '+16 min delay', recommendation: 'Significant delays expected - consider alternatives.', color: 'bg-[#d6691f]/10 border-[#d6691f]/50', textColor: 'text-[#d6691f]', iconColor: 'text-[#d6691f]', barColor: 'bg-[#d6691f]' },
                { id: 'severe', label: 'Severe Congestion', icon: AlertTriangle, time: '35+ min', delay: '+23 min delay', recommendation: 'Major delays - reschedule or use public transit.', color: 'bg-[#d6691f]/20 border-[#d6691f]', textColor: 'text-[#d6691f]', iconColor: 'text-[#d6691f]', barColor: 'bg-[#d6691f]' }
              ];
              
              const crowdLevels = [
                { id: 'quiet', label: 'Quiet', icon: Users, description: 'Few visitors expected', recommendation: 'Great time to visit - enjoy a peaceful experience!', occupancy: '10-20%', color: 'bg-orange-50 border-[#eb7825]/30', textColor: 'text-[#d6691f]', iconColor: 'text-[#eb7825]', barWidth: '20%' },
                { id: 'comfortable', label: 'Comfortable', icon: Users, description: 'Light crowd', recommendation: 'Good time to visit - comfortable atmosphere.', occupancy: '30-45%', color: 'bg-orange-50/70 border-[#eb7825]/30', textColor: 'text-[#d6691f]', iconColor: 'text-[#eb7825]', barWidth: '40%' },
                { id: 'moderate', label: 'Moderately Busy', icon: Users, description: 'Regular crowd', recommendation: 'Typical busy level - expect some wait times.', occupancy: '50-65%', color: 'bg-[#eb7825]/10 border-[#eb7825]/40', textColor: 'text-[#d6691f]', iconColor: 'text-[#eb7825]', barWidth: '60%' },
                { id: 'busy', label: 'Busy', icon: Activity, description: 'High crowd levels', recommendation: 'Expect crowds and longer wait times.', occupancy: '70-85%', color: 'bg-[#d6691f]/10 border-[#d6691f]/50', textColor: 'text-[#d6691f]', iconColor: 'text-[#d6691f]', barWidth: '80%' },
                { id: 'very-busy', label: 'Very Busy', icon: Activity, description: 'Peak capacity', recommendation: 'Very crowded - consider visiting at a different time.', occupancy: '85-100%', color: 'bg-[#d6691f]/20 border-[#d6691f]', textColor: 'text-[#d6691f]', iconColor: 'text-[#d6691f]', barWidth: '95%' }
              ];

              const trafficIndex = Math.floor(Math.random() * 3); // Favor good traffic
              const crowdIndex = Math.floor(Math.random() * crowdLevels.length);
              
              const traffic = trafficLevels[trafficIndex];
              const crowd = crowdLevels[crowdIndex];
              const TrafficIcon = traffic.icon;
              const CrowdIcon = crowd.icon;

              return (
                <>
                  {/* Traffic Conditions */}
                  <div className={`${traffic.color} border-2 rounded-xl p-4 space-y-3`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="bg-white rounded-full p-2 shadow-sm">
                          <TrafficIcon className={`w-5 h-5 sm:w-6 sm:h-6 ${traffic.iconColor}`} />
                        </div>
                        <div>
                          <h4 className={`font-semibold text-sm sm:text-base ${traffic.textColor}`}>Traffic Conditions</h4>
                          <p className="text-xs sm:text-sm text-gray-600">{traffic.label}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-semibold text-sm sm:text-base ${traffic.textColor}`}>{traffic.time}</div>
                        <div className="text-xs text-gray-600">{traffic.delay}</div>
                      </div>
                    </div>
                    
                    <div className={`${traffic.color} border border-current/20 rounded-lg p-3`}>
                      <p className={`text-xs sm:text-sm leading-relaxed ${traffic.textColor}`}>
                        <span className="font-semibold">Recommendation:</span> {traffic.recommendation}
                      </p>
                    </div>
                  </div>

                  {/* Busy Level */}
                  <div className={`${crowd.color} border-2 rounded-xl p-4 space-y-3`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="bg-white rounded-full p-2 shadow-sm">
                          <CrowdIcon className={`w-5 h-5 sm:w-6 sm:h-6 ${crowd.iconColor}`} />
                        </div>
                        <div>
                          <h4 className={`font-semibold text-sm sm:text-base ${crowd.textColor}`}>Busy Level</h4>
                          <p className="text-xs sm:text-sm text-gray-600">{crowd.label}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-semibold text-sm sm:text-base ${crowd.textColor}`}>{crowd.occupancy}</div>
                        <div className="text-xs text-gray-600">occupancy</div>
                      </div>
                    </div>
                    
                    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-500`}
                        style={{ width: crowd.barWidth, backgroundColor: crowd.iconColor === 'text-[#eb7825]' ? '#eb7825' : '#d6691f' }}
                      />
                    </div>
                    
                    <div className={`${crowd.color} border border-current/20 rounded-lg p-3`}>
                      <p className={`text-xs sm:text-sm leading-relaxed ${crowd.textColor}`}>
                        <span className="font-semibold">Recommendation:</span> {crowd.recommendation}
                      </p>
                    </div>
                  </div>
                </>
              );
            })()}

            {/* Timeline Section - Conditional rendering based on experience type */}
            {/* Sip & Chill: Single-venue timeline */}
            {recommendation.sipChillData && recommendation.sipChillData.timelineSteps && recommendation.sipChillData.timelineSteps.length > 0 && (
              <div className="space-y-4">
                <SingleVenueTimeline
                  venueName={recommendation.title}
                  venueAddress={recommendation.address}
                  totalDuration={`~${Math.round(recommendation.sipChillData.typicalDuration.average / 60 * 10) / 10} hours`}
                  steps={recommendation.sipChillData.timelineSteps}
                  categoryColor="#eb7825"
                />
              </div>
            )}
            
            {/* Screen & Relax: Single-venue timeline */}
            {recommendation.screenRelaxData && recommendation.screenRelaxData.timelineSteps && recommendation.screenRelaxData.timelineSteps.length > 0 && (
              <div className="space-y-4">
                <SingleVenueTimeline
                  venueName={recommendation.title}
                  venueAddress={recommendation.address}
                  totalDuration={`~${Math.round(recommendation.screenRelaxData.typicalDuration.average / 60 * 10) / 10} hours`}
                  steps={recommendation.screenRelaxData.timelineSteps}
                  categoryColor="#eb7825"
                />
              </div>
            )}

            {/* Casual Eats, Dining Experiences, Play & Move, Creative & Hands-On, Wellness Dates, Freestyle, Picnics, Take a Stroll: Multi-venue timeline */}
            {recommendation.timeline && Object.keys(recommendation.timeline).length > 0 && (
              <div className="space-y-4">
                <TimelineDisplay 
                  timeline={recommendation.timeline} 
                  experienceTitle={recommendation.title}
                />
              </div>
            )}

            {/* Social proof */}
            <div className="flex items-center justify-around py-5 bg-white border border-orange-100/50 rounded-xl text-center shadow-sm">
              <div className="flex flex-col items-center gap-1">
                <div className="text-[#eb7825]">{formatNumber(recommendation.socialStats.views)}</div>
                <div className="text-xs text-gray-500">Views</div>
              </div>
              <div className="w-px h-10 bg-orange-200/30"></div>
              <div className="flex flex-col items-center gap-1">
                <div className="text-[#eb7825]">{formatNumber(recommendation.socialStats.saves)}</div>
                <div className="text-xs text-gray-500">Saves</div>
              </div>
              <div className="w-px h-10 bg-orange-200/30"></div>
              <div className="flex flex-col items-center gap-1">
                <div className="text-[#eb7825]">{formatNumber(recommendation.socialStats.shares)}</div>
                <div className="text-xs text-gray-500">Shares</div>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="p-4 pt-0 space-y-3">
            <div className="flex gap-3">
              {/* Conditional Buy Now/Schedule button based on purchaseOptions */}
              {recommendation.purchaseOptions && recommendation.purchaseOptions.length > 0 ? (
                <button 
                  onClick={onBuyNow}
                  className="flex-1 bg-[#eb7825] text-white py-4 px-6 rounded-xl font-semibold hover:bg-[#d6691f] transition-colors flex items-center justify-center gap-2"
                >
                  <Calendar className="w-5 h-5" />
                  Buy Now
                </button>
              ) : (
                <button 
                  onClick={onSchedule}
                  className="flex-1 bg-[#eb7825] text-white py-4 px-6 rounded-xl font-semibold hover:bg-[#d6691f] transition-colors flex items-center justify-center gap-2"
                >
                  <Calendar className="w-5 h-5" />
                  Schedule
                </button>
              )}

              <button 
                onClick={onShare}
                className="w-12 h-12 border-2 border-gray-200 hover:border-[#eb7825] hover:bg-orange-50 rounded-xl transition-all duration-200 flex items-center justify-center group self-center"
              >
                <Share2 className="w-5 h-5 text-gray-600 group-hover:text-[#eb7825] transition-all" />
              </button>
            </div>
            
            <motion.button 
              onClick={() => openAllInMaps(recommendation.timeline)}
              className="w-full flex items-center justify-center gap-2.5 px-4 py-3 bg-[#eb7825] text-white rounded-xl hover:bg-[#d6691f] transition-all shadow-md hover:shadow-lg group"
              whileHover={{ scale: 1.02, y: -1 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <Navigation className="w-4 h-4 group-hover:rotate-45 transition-transform duration-300" />
              <span className="font-medium">Navigate Full Route</span>
              <ExternalLink className="w-4 h-4 opacity-80" />
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}