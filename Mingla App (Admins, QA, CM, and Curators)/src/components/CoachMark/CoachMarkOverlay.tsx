import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useCoachMark } from './CoachMarkProvider';
import { coachMarkSteps } from './coachMarkSteps';
import CoachMarkSpotlight from './CoachMarkSpotlight';
import CoachMarkTooltip from './CoachMarkTooltip';
import CoachMarkWelcome from './CoachMarkWelcome';
import { SpotlightPosition } from './types';

export default function CoachMarkOverlay() {
  const { state, skipTour, beginTour } = useCoachMark();
  const [showWelcome, setShowWelcome] = useState(true);
  const [spotlightPosition, setSpotlightPosition] = useState<SpotlightPosition | null>(null);

  // Show welcome screen only on first activation
  useEffect(() => {
    if (state.isActive && state.currentStep === 0) {
      setShowWelcome(true);
    }
  }, [state.isActive]);

  const handleStartTour = () => {
    setShowWelcome(false);
    // Navigate to the first step's page
    beginTour();
  };

  if (!state.isActive) {
    return null;
  }

  const currentStep = coachMarkSteps[state.currentStep];

  return (
    <AnimatePresence mode="wait">
      {state.isActive && (
        <>
          {/* SVG Mask Backdrop with cutout for spotlight */}
          {!showWelcome && spotlightPosition && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="fixed inset-0 z-[9999] pointer-events-none"
            >
              <svg className="w-full h-full">
                <defs>
                  <mask id="spotlight-mask">
                    {/* White rectangle covers entire screen */}
                    <rect x="0" y="0" width="100%" height="100%" fill="white" />
                    
                    {/* Black shape creates the cutout (transparent area) */}
                    {currentStep.spotlightShape === 'circle' ? (
                      <motion.ellipse
                        initial={{ r: 0 }}
                        animate={{
                          cx: spotlightPosition.left + spotlightPosition.width / 2,
                          cy: spotlightPosition.top + spotlightPosition.height / 2,
                          rx: spotlightPosition.width / 2,
                          ry: spotlightPosition.height / 2
                        }}
                        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                        fill="black"
                      />
                    ) : (
                      <motion.rect
                        initial={{ width: 0, height: 0 }}
                        animate={{
                          x: spotlightPosition.left,
                          y: spotlightPosition.top,
                          width: spotlightPosition.width,
                          height: spotlightPosition.height,
                          rx: spotlightPosition.borderRadius
                        }}
                        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                        fill="black"
                      />
                    )}
                  </mask>
                  
                  {/* Gradient for depth */}
                  <radialGradient id="spotlight-gradient">
                    <stop offset="0%" stopColor="rgba(0, 0, 0, 0.5)" />
                    <stop offset="100%" stopColor="rgba(0, 0, 0, 0.45)" />
                  </radialGradient>
                </defs>
                
                {/* Apply mask to dark overlay */}
                <rect
                  x="0"
                  y="0"
                  width="100%"
                  height="100%"
                  fill="url(#spotlight-gradient)"
                  mask="url(#spotlight-mask)"
                />
              </svg>
              
              {/* Subtle gradient overlay */}
              <motion.div
                animate={{
                  opacity: [0.15, 0.25, 0.15]
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: 'easeInOut'
                }}
                className="absolute inset-0 bg-gradient-to-br from-[#eb7825]/10 via-transparent to-[#d6691f]/10 pointer-events-none"
              />
            </motion.div>
          )}

          {/* Fallback backdrop for welcome screen */}
          {showWelcome && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="fixed inset-0 z-[9999] bg-black/80"
            >
              <motion.div
                animate={{
                  opacity: [0.2, 0.35, 0.2]
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: 'easeInOut'
                }}
                className="absolute inset-0 bg-gradient-to-br from-[#eb7825]/15 via-transparent to-[#d6691f]/15"
              />
            </motion.div>
          )}

          {/* Welcome Screen or Tour Content */}
          <AnimatePresence mode="wait">
            {showWelcome ? (
              <CoachMarkWelcome key="welcome" onStart={handleStartTour} onClose={skipTour} />
            ) : (
              <React.Fragment key="tour">
                {/* Spotlight - updates position for backdrop */}
                <CoachMarkSpotlight 
                  step={coachMarkSteps[state.currentStep]} 
                  onPositionUpdate={setSpotlightPosition}
                />

                {/* Tooltip with smart positioning */}
                <CoachMarkTooltip 
                  step={coachMarkSteps[state.currentStep]} 
                  currentStep={state.currentStep}
                  totalSteps={coachMarkSteps.length}
                  spotlightPosition={spotlightPosition}
                />
              </React.Fragment>
            )}
          </AnimatePresence>
        </>
      )}
    </AnimatePresence>
  );
}