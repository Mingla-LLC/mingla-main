import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, MapPin, Calendar, Coffee, Utensils, Camera, Heart } from 'lucide-react';
import type { RecommendationCard } from '@/types/recommendations';

interface TimelineStep {
  id: string;
  time: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  duration: number; // in minutes
}

interface AnimatedTimelineProps {
  card: RecommendationCard;
  isVisible: boolean;
}

export const AnimatedTimeline: React.FC<AnimatedTimelineProps> = ({ card, isVisible }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Generate timeline steps based on card data
  const generateTimelineSteps = (card: RecommendationCard): TimelineStep[] => {
    const startTime = card.startTime ? new Date(card.startTime) : new Date();
    const steps: TimelineStep[] = [];

    // Travel to location
    if (card.route?.etaMinutes && card.route.etaMinutes > 0) {
      const travelTime = new Date(startTime);
      travelTime.setMinutes(travelTime.getMinutes() - card.route.etaMinutes);
      
      steps.push({
        id: 'travel',
        time: travelTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        title: `Head to ${card.title}`,
        description: `${card.route.etaMinutes} min ${card.route.mode?.toLowerCase() || 'travel'}`,
        icon: <MapPin className="h-4 w-4" />,
        duration: card.route.etaMinutes
      });
    }

    // Arrival and main activity
    steps.push({
      id: 'arrival',
      time: startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      title: `Arrive at ${card.title}`,
      description: card.copy?.oneLiner || 'Start your experience',
      icon: getCategoryIcon(card.category),
      duration: Math.floor((card.durationMinutes || 90) * 0.7)
    });

    // Mid-experience highlight
    const midTime = new Date(startTime);
    midTime.setMinutes(midTime.getMinutes() + Math.floor((card.durationMinutes || 90) * 0.4));
    
    steps.push({
      id: 'highlight',
      time: midTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      title: getHighlightTitle(card.category),
      description: card.copy?.tip || 'Enjoy the best part of your experience',
      icon: <Heart className="h-4 w-4" />,
      duration: Math.floor((card.durationMinutes || 90) * 0.3)
    });

    // Experience end
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + (card.durationMinutes || 90));
    
    steps.push({
      id: 'end',
      time: endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      title: 'Experience Complete',
      description: 'Perfect time for photos and memories',
      icon: <Camera className="h-4 w-4" />,
      duration: 10
    });

    return steps;
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'sip':
        return <Coffee className="h-4 w-4" />;
      case 'dining':
      case 'casual_eats':
        return <Utensils className="h-4 w-4" />;
      case 'stroll':
        return <MapPin className="h-4 w-4" />;
      default:
        return <Calendar className="h-4 w-4" />;
    }
  };

  const getHighlightTitle = (category: string) => {
    switch (category) {
      case 'sip':
        return 'Perfect conversation moment';
      case 'dining':
        return 'Savor the main course';
      case 'casual_eats':
        return 'Try the signature dish';
      case 'stroll':
        return 'Scenic photo opportunity';
      case 'creative':
        return 'Create something beautiful';
      case 'play_move':
        return 'Peak activity time';
      default:
        return 'Experience highlight';
    }
  };

  const timelineSteps = generateTimelineSteps(card);

  // Auto-play animation when visible
  useEffect(() => {
    if (isVisible && !isPlaying) {
      setIsPlaying(true);
      setCurrentStep(0);

      const interval = setInterval(() => {
        setCurrentStep(prev => {
          if (prev < timelineSteps.length - 1) {
            return prev + 1;
          } else {
            clearInterval(interval);
            setIsPlaying(false);
            return prev;
          }
        });
      }, 2000); // Change step every 2 seconds

      return () => clearInterval(interval);
    }
  }, [isVisible, timelineSteps.length]);

  // Reset when card changes
  useEffect(() => {
    setCurrentStep(0);
    setIsPlaying(false);
  }, [card.id]);

  if (!isVisible) return null;

  return (
    <div className="w-full max-w-sm mx-auto p-4 bg-gradient-to-br from-background/50 to-accent/10 rounded-2xl backdrop-blur-sm border border-border/50">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium text-foreground/80">Your Timeline</span>
      </div>

      <div className="space-y-4">
        {timelineSteps.map((step, index) => (
          <motion.div
            key={step.id}
            initial={{ opacity: 0.3, scale: 0.95 }}
            animate={{ 
              opacity: index <= currentStep ? 1 : 0.3,
              scale: index === currentStep ? 1.02 : 0.95,
            }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className={`flex items-start gap-3 p-3 rounded-xl transition-all duration-500 ${
              index === currentStep 
                ? 'bg-primary/10 border border-primary/20 shadow-lg' 
                : 'bg-muted/30'
            }`}
          >
            {/* Timeline indicator */}
            <div className="flex flex-col items-center">
              <motion.div
                initial={{ scale: 0.8, backgroundColor: 'hsl(var(--muted))' }}
                animate={{ 
                  scale: index === currentStep ? 1.2 : 0.8,
                  backgroundColor: index <= currentStep ? 'hsl(var(--primary))' : 'hsl(var(--muted))'
                }}
                transition={{ duration: 0.3 }}
                className="flex items-center justify-center w-8 h-8 rounded-full text-white"
              >
                {step.icon}
              </motion.div>
              
              {index < timelineSteps.length - 1 && (
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ 
                    height: 24,
                    backgroundColor: index < currentStep ? 'hsl(var(--primary))' : 'hsl(var(--border))'
                  }}
                  transition={{ duration: 0.5, delay: index === currentStep ? 0.5 : 0 }}
                  className="w-0.5 mt-2 rounded-full"
                />
              )}
            </div>

            {/* Step content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <motion.span
                  initial={{ opacity: 0.7 }}
                  animate={{ opacity: index <= currentStep ? 1 : 0.7 }}
                  className="text-xs font-mono text-primary"
                >
                  {step.time}
                </motion.span>
                {index === currentStep && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-2 h-2 bg-primary rounded-full animate-pulse"
                  />
                )}
              </div>
              
              <motion.h4
                initial={{ opacity: 0.7 }}
                animate={{ opacity: index <= currentStep ? 1 : 0.7 }}
                className="text-sm font-medium text-foreground mb-1"
              >
                {step.title}
              </motion.h4>
              
              <motion.p
                initial={{ opacity: 0.5 }}
                animate={{ opacity: index <= currentStep ? 0.8 : 0.5 }}
                className="text-xs text-muted-foreground"
              >
                {step.description}
              </motion.p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Progress indicator */}
      <div className="mt-4 flex items-center gap-2">
        <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
          <motion.div
            initial={{ width: "0%" }}
            animate={{ width: `${((currentStep + 1) / timelineSteps.length) * 100}%` }}
            transition={{ duration: 0.5 }}
            className="h-full bg-gradient-to-r from-primary to-primary/80 rounded-full"
          />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {currentStep + 1}/{timelineSteps.length}
        </span>
      </div>
    </div>
  );
};