import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { CoachMarkStep, SpotlightPosition } from './types';
import { useCoachMark } from './CoachMarkProvider';

interface CoachMarkSpotlightProps {
  step: CoachMarkStep;
  onPositionUpdate?: (position: SpotlightPosition | null) => void;
}

export default function CoachMarkSpotlight({ step, onPositionUpdate }: CoachMarkSpotlightProps) {
  const { registerRef } = useCoachMark();
  const [position, setPosition] = useState<SpotlightPosition | null>(null);

  useEffect(() => {
    // If no targetRef, spotlight the entire viewport (full page highlight)
    if (!step.targetRef) {
      const padding = step.spotlightPadding || 20;
      const fullPagePosition: SpotlightPosition = {
        top: padding,
        left: padding,
        width: window.innerWidth - padding * 2,
        height: window.innerHeight - padding * 2,
        borderRadius: 16
      };
      setPosition(fullPagePosition);
      onPositionUpdate?.(fullPagePosition);
      
      // Update on window resize
      const handleResize = () => {
        const updatedPosition: SpotlightPosition = {
          top: padding,
          left: padding,
          width: window.innerWidth - padding * 2,
          height: window.innerHeight - padding * 2,
          borderRadius: 16
        };
        setPosition(updatedPosition);
        onPositionUpdate?.(updatedPosition);
      };
      
      window.addEventListener('resize', handleResize);
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }

    let attemptCount = 0;
    const maxAttempts = 30;
    let timeoutId: NodeJS.Timeout;
    let hasLoggedWarning = false;

    const updatePosition = () => {
      // Handle both single and multiple target refs
      const targetRefs = Array.isArray(step.targetRef) ? step.targetRef : [step.targetRef];
      const allTargetElements: HTMLElement[] = [];
      
      // Find all elements for all target refs
      targetRefs.forEach(targetRef => {
        const elements = document.querySelectorAll(`[data-coachmark="${targetRef}"]`);
        elements.forEach((el) => {
          const htmlEl = el as HTMLElement;
          const rect = htmlEl.getBoundingClientRect();
          const area = rect.width * rect.height;
          
          if (area > 0) {
            const style = window.getComputedStyle(htmlEl);
            if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) {
              allTargetElements.push(htmlEl);
            }
          }
        });
      });

      // Retry if elements not found yet
      if (allTargetElements.length === 0 && attemptCount < maxAttempts) {
        attemptCount++;
        timeoutId = setTimeout(updatePosition, 100);
        return;
      }

      if (allTargetElements.length === 0) {
        // Only log warning once after all retry attempts
        if (!hasLoggedWarning) {
          console.warn(`CoachMark: Target element not found for ref "${step.targetRef}"`);
          hasLoggedWarning = true;
        }
        setPosition(null);
        onPositionUpdate?.(null);
        return;
      }

      // Calculate bounding box that encompasses all target elements
      let minTop = Infinity;
      let minLeft = Infinity;
      let maxBottom = -Infinity;
      let maxRight = -Infinity;

      allTargetElements.forEach(element => {
        const rect = element.getBoundingClientRect();
        minTop = Math.min(minTop, rect.top);
        minLeft = Math.min(minLeft, rect.left);
        maxBottom = Math.max(maxBottom, rect.bottom);
        maxRight = Math.max(maxRight, rect.right);
      });

      const padding = step.spotlightPadding || 12;
      const width = maxRight - minLeft;
      const height = maxBottom - minTop;

      const newPosition: SpotlightPosition = {
        top: minTop - padding,
        left: minLeft - padding,
        width: width + padding * 2,
        height: height + padding * 2,
        borderRadius: step.spotlightShape === 'circle' 
          ? Math.max(width, height) + padding * 2 
          : 16
      };

      setPosition(newPosition);
      onPositionUpdate?.(newPosition);
    };

    updatePosition();
    
    // Update on window resize and scroll
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [step.targetRef, step.spotlightShape, step.spotlightPadding, onPositionUpdate]);

  if (!position) return null;

  return (
    <>
      {/* Main spotlight container */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ 
          duration: 0.4,
          ease: [0.16, 1, 0.3, 1]
        }}
        className="fixed z-[10000] pointer-events-none"
        style={{
          top: position.top,
          left: position.left,
          width: position.width,
          height: position.height
        }}
      >
        {/* Outer glow - more visible */}
        <motion.div
          animate={{
            scale: [1, 1.08, 1],
            opacity: [0.6, 0.8, 0.6]
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut'
          }}
          className="absolute -inset-2"
          style={{
            borderRadius: step.spotlightShape === 'circle' ? '50%' : `${position.borderRadius + 8}px`,
            background: 'radial-gradient(circle, rgba(235, 120, 37, 0.5) 0%, rgba(235, 120, 37, 0.2) 50%, transparent 70%)',
            filter: 'blur(16px)'
          }}
        />

        {/* Primary border ring - bright and clear */}
        <motion.div
          animate={{
            scale: [1, 1.03, 1],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut'
          }}
          className="absolute inset-0 rounded-[inherit]"
          style={{
            borderRadius: step.spotlightShape === 'circle' ? '50%' : `${position.borderRadius}px`,
            border: '4px solid #eb7825',
            boxShadow: '0 0 0 2px rgba(255, 255, 255, 0.8), 0 0 40px rgba(235, 120, 37, 0.8), inset 0 0 40px rgba(235, 120, 37, 0.3)'
          }}
        />

        {/* Inner bright ring for clarity */}
        <motion.div
          animate={{
            opacity: [0.5, 0.9, 0.5],
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: 0.5
          }}
          className="absolute inset-1"
          style={{
            borderRadius: step.spotlightShape === 'circle' ? '50%' : `${position.borderRadius - 4}px`,
            border: '2px solid rgba(255, 255, 255, 1)',
            boxShadow: 'inset 0 0 30px rgba(255, 255, 255, 0.5), 0 0 20px rgba(255, 255, 255, 0.6)'
          }}
        />

        {/* Corner accents for rectangle shapes */}
        {step.spotlightShape === 'rectangle' && (
          <>
            <motion.div
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.3 }}
              className="absolute -top-2 -left-2 w-6 h-6 border-t-[5px] border-l-[5px] border-white rounded-tl-xl"
              style={{
                filter: 'drop-shadow(0 0 8px rgba(255, 255, 255, 0.8))'
              }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3, duration: 0.3 }}
              className="absolute -top-2 -right-2 w-6 h-6 border-t-[5px] border-r-[5px] border-white rounded-tr-xl"
              style={{
                filter: 'drop-shadow(0 0 8px rgba(255, 255, 255, 0.8))'
              }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.4, duration: 0.3 }}
              className="absolute -bottom-2 -left-2 w-6 h-6 border-b-[5px] border-l-[5px] border-white rounded-bl-xl"
              style={{
                filter: 'drop-shadow(0 0 8px rgba(255, 255, 255, 0.8))'
              }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.5, duration: 0.3 }}
              className="absolute -bottom-2 -right-2 w-6 h-6 border-b-[5px] border-r-[5px] border-white rounded-br-xl"
              style={{
                filter: 'drop-shadow(0 0 8px rgba(255, 255, 255, 0.8))'
              }}
            />
          </>
        )}

        {/* Pulsing dot indicator at top */}
        <motion.div
          animate={{
            scale: [1, 1.4, 1],
            opacity: [0.8, 1, 0.8]
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: 'easeInOut'
          }}
          className="absolute -top-4 left-1/2 -translate-x-1/2 w-3 h-3 bg-white rounded-full"
          style={{
            boxShadow: '0 0 20px rgba(255, 255, 255, 1), 0 0 40px rgba(235, 120, 37, 0.8)'
          }}
        />
      </motion.div>
    </>
  );
}