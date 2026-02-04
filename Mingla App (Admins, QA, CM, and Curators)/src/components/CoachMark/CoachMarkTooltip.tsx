import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CoachMarkStep, SpotlightPosition } from './types';
import { useCoachMark } from './CoachMarkProvider';
import CoachMarkProgress from './CoachMarkProgress';
import { ArrowRight, ArrowLeft, X, Sparkles } from 'lucide-react';

interface CoachMarkTooltipProps {
  step: CoachMarkStep;
  currentStep: number;
  totalSteps: number;
  spotlightPosition: SpotlightPosition | null;
}

export default function CoachMarkTooltip({ step, currentStep, totalSteps, spotlightPosition }: CoachMarkTooltipProps) {
  const { nextStep, previousStep, skipTour, finishTour } = useCoachMark();
  const tooltipRef = useRef<HTMLDivElement>(null);
  const isLastStep = currentStep === totalSteps - 1;
  const isFirstStep = currentStep === 0;
  const [positioning, setPositioning] = useState<'bottom' | 'top' | 'center'>('bottom');
  const [tooltipHeight, setTooltipHeight] = useState(0);

  // Measure tooltip height
  useEffect(() => {
    if (tooltipRef.current) {
      setTooltipHeight(tooltipRef.current.offsetHeight);
    }
  }, [step]);

  // Smart positioning: ensure tooltip never overlaps with spotlighted area
  useEffect(() => {
    if (!spotlightPosition) {
      setPositioning('bottom');
      return;
    }

    // If step explicitly specifies center position, use it
    if (step.position === 'center') {
      setPositioning('center');
      return;
    }

    const viewportHeight = window.innerHeight;
    const spotlightTop = spotlightPosition.top;
    const spotlightBottom = spotlightPosition.top + spotlightPosition.height;
    const padding = 80; // Extra padding to ensure clear visibility
    
    // Calculate available space above and below spotlight
    const spaceAbove = spotlightTop;
    const spaceBelow = viewportHeight - spotlightBottom;
    
    // Estimate tooltip height (if not measured yet, use reasonable estimate)
    const estimatedTooltipHeight = tooltipHeight || 350;
    
    // Check if tooltip would fit below without overlapping
    const fitsBelow = spaceBelow > estimatedTooltipHeight + padding;
    
    // Check if tooltip would fit above without overlapping
    const fitsAbove = spaceAbove > estimatedTooltipHeight + padding;
    
    // Prioritize bottom placement, but switch to top if:
    // 1. Spotlight is in upper portion AND there's enough space below
    // 2. OR there's more space below than above
    if (spotlightBottom < viewportHeight / 2 && fitsBelow) {
      setPositioning('bottom');
    } else if (fitsAbove) {
      setPositioning('top');
    } else {
      // Default to position with more space
      setPositioning(spaceBelow > spaceAbove ? 'bottom' : 'top');
    }
  }, [spotlightPosition, tooltipHeight, step.position]);

  const handleAction = () => {
    if (isLastStep) {
      finishTour();
    } else {
      nextStep();
    }
  };

  // Calculate vertical positioning
  const getPositionClasses = () => {
    if (positioning === 'center') {
      return 'top-1/2 -translate-y-1/2';
    }
    if (positioning === 'top') {
      return 'top-0 pt-4 sm:pt-6';
    }
    return 'bottom-0 pb-4 sm:pb-6';
  };

  const getMotionProps = () => {
    if (positioning === 'center') {
      return {
        initial: { opacity: 0, scale: 0.9 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.9 }
      };
    }
    if (positioning === 'top') {
      return {
        initial: { opacity: 0, y: -100 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -100 }
      };
    }
    return {
      initial: { opacity: 0, y: 100 },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: 100 }
    };
  };

  return (
    <motion.div
      ref={tooltipRef}
      {...getMotionProps()}
      transition={{ 
        duration: 0.5,
        ease: [0.16, 1, 0.3, 1]
      }}
      className={`fixed left-0 right-0 z-[10001] px-4 ${getPositionClasses()}`}
    >
      {/* Glass morphism card with gradient border */}
      <div className="relative mx-auto max-w-lg">
        {/* Gradient border wrapper */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#eb7825] via-[#d6691f] to-[#eb7825] rounded-3xl opacity-100 blur-sm" />
        
        {/* Main card */}
        <div className="relative bg-white/98 backdrop-blur-xl rounded-3xl shadow-2xl overflow-hidden border border-white/20">
          {/* Animated gradient background */}
          <motion.div
            animate={{
              opacity: [0.1, 0.15, 0.1],
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: 'easeInOut'
            }}
            className="absolute inset-0 bg-gradient-to-br from-[#eb7825]/10 via-transparent to-[#d6691f]/10"
          />

          {/* Content */}
          <div className="relative p-5 sm:p-6 space-y-4">
            {/* Close button */}
            <motion.button
              whileHover={{ scale: 1.1, rotate: 90 }}
              whileTap={{ scale: 0.9 }}
              onClick={skipTour}
              className="absolute top-3 right-3 p-2 rounded-full bg-gray-100/80 backdrop-blur-sm text-gray-500 hover:text-gray-700 hover:bg-gray-200/80 transition-all duration-200 shadow-sm z-10"
              aria-label="Close tour"
            >
              <X className="w-4 h-4" />
            </motion.button>

            {/* Icon with animation */}
            <motion.div 
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ 
                type: 'spring',
                stiffness: 200,
                damping: 15,
                delay: 0.1
              }}
              className="inline-flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-[#eb7825] to-[#d6691f] shadow-lg"
            >
              <span className="text-2xl sm:text-3xl">{step.icon}</span>
            </motion.div>

            {/* Title and Description */}
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="space-y-2 pr-8"
            >
              <h3 className="text-lg sm:text-xl font-bold text-gray-900 leading-tight">
                {step.title}
              </h3>
              <p className="text-gray-600 text-sm sm:text-[15px] leading-relaxed">
                {step.description}
              </p>
            </motion.div>

            {/* Progress indicator */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3, duration: 0.4 }}
              className="py-2"
            >
              <CoachMarkProgress current={currentStep} total={totalSteps} />
            </motion.div>

            {/* Step counter */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.35, duration: 0.4 }}
              className="flex items-center justify-center gap-2 text-xs sm:text-sm text-gray-500"
            >
              <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#eb7825]" />
              <span className="font-medium">
                Step {currentStep + 1} of {totalSteps}
              </span>
            </motion.div>

            {/* Divider */}
            <div className="h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent" />

            {/* Action buttons */}
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.4 }}
              className="flex items-center justify-between gap-2 pt-1"
            >
              {/* Previous Button */}
              <motion.button
                whileHover={{ scale: isFirstStep ? 1 : 1.05 }}
                whileTap={{ scale: isFirstStep ? 1 : 0.95 }}
                onClick={previousStep}
                disabled={isFirstStep}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  isFirstStep
                    ? 'text-gray-300 cursor-not-allowed opacity-40'
                    : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100/80'
                }`}
              >
                {!isFirstStep && (
                  <motion.div
                    animate={{ x: [0, -3, 0] }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      ease: 'easeInOut'
                    }}
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </motion.div>
                )}
                <span>Previous</span>
              </motion.button>

              {/* Skip Button */}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={skipTour}
                className="text-gray-600 hover:text-gray-800 transition-colors text-sm font-medium px-3 py-2 rounded-lg hover:bg-gray-100/80"
              >
                Skip
              </motion.button>
              
              {/* Next Button */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleAction}
                className="flex items-center gap-2 bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-200 relative overflow-hidden group text-sm sm:text-base"
              >
                {/* Button shine effect */}
                <motion.div
                  animate={{
                    x: ['-100%', '200%']
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    repeatDelay: 1,
                    ease: 'easeInOut'
                  }}
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                />
                
                <span className="relative z-10">
                  {isLastStep ? 'Finish' : 'Next'}
                </span>
                {!isLastStep && (
                  <motion.div
                    animate={{ x: [0, 4, 0] }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      ease: 'easeInOut'
                    }}
                  >
                    <ArrowRight className="w-4 h-4 relative z-10" />
                  </motion.div>
                )}
              </motion.button>
            </motion.div>
          </div>

          {/* Bottom accent line */}
          <motion.div
            animate={{
              opacity: [0.5, 1, 0.5],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut'
            }}
            className="h-1 bg-gradient-to-r from-[#eb7825] via-[#d6691f] to-[#eb7825]"
          />
        </div>
      </div>
    </motion.div>
  );
}