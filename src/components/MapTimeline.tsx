import React, { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MapPin, Navigation, Clock } from 'lucide-react';

interface TimelineStep {
  time: string;
  activity: string;
  location: { lat: number; lng: number };
  icon: string;
  duration: string;
}

interface MapTimelineProps {
  steps: TimelineStep[];
  userLocation?: { lat: number; lng: number };
  className?: string;
}

export const MapTimeline = ({ steps, userLocation, className }: MapTimelineProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  const animateToNext = () => {
    if (currentStep < steps.length - 1 && !isAnimating) {
      setIsAnimating(true);
      setTimeout(() => {
        setCurrentStep(prev => prev + 1);
        setIsAnimating(false);
      }, 800);
    }
  };

  const resetAnimation = () => {
    setCurrentStep(0);
    setIsAnimating(false);
  };

  // Calculate optimal meetup point (middle point between user and destination)
  const getMeetupPoint = () => {
    if (!userLocation || !steps.length) return null;
    
    const destination = steps[steps.length - 1].location;
    return {
      lat: (userLocation.lat + destination.lat) / 2,
      lng: (userLocation.lng + destination.lng) / 2,
      name: "Optimal Meetup Point"
    };
  };

  const meetupPoint = getMeetupPoint();

  return (
    <Card className={`p-4 ${className}`}>
      {/* Map Preview */}
      <div className="relative h-32 bg-gradient-to-br from-blue-50 to-green-50 rounded-lg mb-4 overflow-hidden">
        {/* Animated Route Line */}
        <svg className="absolute inset-0 w-full h-full">
          <defs>
            <linearGradient id="routeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#10B981" stopOpacity="0.8" />
            </linearGradient>
          </defs>
          
          {/* Route line with animation */}
          <polyline
            points="20,80 60,60 100,40 140,20"
            fill="none"
            stroke="url(#routeGradient)"
            strokeWidth="3"
            strokeDasharray="200"
            strokeDashoffset={isAnimating ? "0" : "200"}
            className="transition-all duration-1000 ease-in-out"
          />
        </svg>
        
        {/* Location Markers */}
        <div className="absolute inset-0 flex items-center justify-between px-4">
          {/* User Location */}
          {userLocation && (
            <div className="flex flex-col items-center">
              <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse" />
              <span className="text-xs text-blue-600 font-medium mt-1">You</span>
            </div>
          )}
          
          {/* Meetup Point */}
          {meetupPoint && (
            <div className="flex flex-col items-center">
              <div className="w-4 h-4 bg-purple-500 rounded-full border-2 border-white shadow-lg" />
              <span className="text-xs text-purple-600 font-medium mt-1">Meet</span>
            </div>
          )}
          
          {/* Destination */}
          <div className="flex flex-col items-center">
            <div className={`w-4 h-4 bg-green-500 rounded-full border-2 border-white shadow-lg ${
              currentStep === steps.length - 1 ? 'animate-bounce' : ''
            }`} />
            <span className="text-xs text-green-600 font-medium mt-1">Destination</span>
          </div>
        </div>
        
        {/* Progress Indicator */}
        <div className="absolute bottom-2 left-2 right-2">
          <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-blue-500 to-green-500 rounded-full transition-all duration-1000 ease-out"
              style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
            />
          </div>
        </div>
      </div>
      
      {/* Timeline Steps */}
      <div className="space-y-2 mb-4">
        {steps.map((step, index) => (
          <div 
            key={index} 
            className={`flex items-center gap-3 p-2 rounded-lg transition-all duration-500 ${
              index <= currentStep 
                ? 'bg-primary/10 text-primary' 
                : 'text-muted-foreground'
            }`}
          >
            <div className={`flex items-center justify-center w-6 h-6 rounded-full text-sm ${
              index < currentStep 
                ? 'bg-primary text-primary-foreground' 
                : index === currentStep
                ? 'bg-primary text-primary-foreground animate-pulse'
                : 'bg-muted'
            }`}>
              {index < currentStep ? '✓' : step.icon}
            </div>
            
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">{step.time}</span>
                <Clock className="h-3 w-3" />
                <span className="text-xs">{step.duration}</span>
              </div>
              <p className="text-sm">{step.activity}</p>
            </div>
          </div>
        ))}
      </div>
      
      {/* Animation Controls */}
      <div className="flex gap-2">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={animateToNext}
          disabled={currentStep >= steps.length - 1 || isAnimating}
          className="flex-1"
        >
          <Navigation className="h-3 w-3 mr-1" />
          {isAnimating ? 'Moving...' : 'Next Step'}
        </Button>
        
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={resetAnimation}
          disabled={currentStep === 0}
        >
          Reset
        </Button>
      </div>
      
      {/* Meetup Info */}
      {meetupPoint && (
        <div className="mt-3 p-2 bg-purple-50 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-purple-700">
            <MapPin className="h-3 w-3" />
            <span className="font-medium">Suggested meetup point</span>
          </div>
          <p className="text-xs text-purple-600 mt-1">
            Optimal location based on proximity to both you and the destination
          </p>
        </div>
      )}
    </Card>
  );
};