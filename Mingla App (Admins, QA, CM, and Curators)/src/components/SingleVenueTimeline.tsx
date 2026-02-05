/**
 * Single Venue Timeline Component
 * 
 * Specialized timeline for Sip & Chill and other single-location experiences
 * Shows the flow of the experience at one venue without route/travel between stops
 */

import React from 'react';
import { Coffee, Sparkles, MessageCircle, Clock, CheckCircle } from 'lucide-react';

interface TimelineStep {
  step: string;
  description: string;
  duration: string;
  icon: string;
}

interface SingleVenueTimelineProps {
  venueName: string;
  venueAddress: string;
  totalDuration: string;
  steps: TimelineStep[];
  categoryColor?: string;
}

const iconMap: { [key: string]: any } = {
  arrive: Clock,
  sip: Coffee,
  chill: MessageCircle,
  enjoy: Sparkles,
  wrapup: CheckCircle,
  default: Sparkles
};

export default function SingleVenueTimeline({
  venueName,
  venueAddress,
  totalDuration,
  steps,
  categoryColor = '#eb7825'
}: SingleVenueTimelineProps) {
  return (
    <div className="bg-white rounded-2xl p-4 sm:p-6 border border-gray-100">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <div 
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: categoryColor }}
          />
          <h3 className="font-semibold text-gray-900">Experience Flow</h3>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">Single venue experience at {venueName}</p>
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <Clock className="w-4 h-4" />
            <span>{totalDuration}</span>
          </div>
        </div>
      </div>

      {/* Timeline Steps */}
      <div className="relative">
        {/* Vertical line */}
        <div 
          className="absolute left-4 sm:left-5 top-8 bottom-8 w-0.5 bg-gradient-to-b from-[#eb7825] via-[#eb7825]/50 to-[#eb7825]/20"
          style={{ 
            backgroundImage: `linear-gradient(to bottom, ${categoryColor}, ${categoryColor}50, ${categoryColor}20)`
          }}
        />

        {/* Steps */}
        <div className="space-y-6">
          {steps.map((step, index) => {
            const IconComponent = iconMap[step.icon.toLowerCase()] || iconMap.default;
            const isFirst = index === 0;
            const isLast = index === steps.length - 1;

            return (
              <div key={index} className="relative flex gap-4 sm:gap-6">
                {/* Icon */}
                <div className="relative z-10 flex-shrink-0">
                  <div 
                    className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-white shadow-lg"
                    style={{ backgroundColor: categoryColor }}
                  >
                    <IconComponent className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                  
                  {/* Pulse ring for first step */}
                  {isFirst && (
                    <div 
                      className="absolute inset-0 rounded-full opacity-20 pulse-ring"
                      style={{ backgroundColor: categoryColor }}
                    />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 pb-2">
                  <div className="bg-gray-50 rounded-xl p-4 hover:bg-gray-100 transition-colors">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h4 className="font-semibold text-gray-900">{step.step}</h4>
                      <span className="text-xs text-gray-500 whitespace-nowrap bg-white px-2 py-1 rounded-full">
                        {step.duration}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      {step.description}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Location Card */}
      <div className="mt-6 pt-6 border-t border-gray-100">
        <div className="flex items-start gap-3 p-4 bg-gradient-to-br from-orange-50 to-amber-50 rounded-xl">
          <div className="w-8 h-8 rounded-full bg-[#eb7825] flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-gray-900 mb-1">{venueName}</h4>
            <p className="text-sm text-gray-600 leading-relaxed">{venueAddress}</p>
            <button 
              onClick={() => {
                const encodedAddress = encodeURIComponent(venueAddress);
                window.open(`https://www.google.com/maps/search/?api=1&query=${encodedAddress}`, '_blank');
              }}
              className="mt-2 text-sm text-[#eb7825] hover:text-[#d6691f] font-medium flex items-center gap-1"
            >
              View on Google Maps
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Info Banner */}
      <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
        <p className="text-xs text-blue-900 leading-relaxed">
          💡 <span className="font-medium">Single-location experience:</span> This entire outing takes place at one venue. 
          Timing is flexible—enjoy at your own pace and leave whenever you're ready.
        </p>
      </div>
    </div>
  );
}
