import React, { useState, useRef } from 'react';
import { MapPin, Navigation, ExternalLink, Flag, Circle, MapPinned } from 'lucide-react';
import { motion, useInView } from 'motion/react';

interface TimelineStep {
  description: string;
  location?: string;
  locationName?: string;
}

interface TimelineDisplayProps {
  timeline: {
    arrivalWelcome: string | TimelineStep;
    mainActivity: string | TimelineStep;
    immersionAddon: string | TimelineStep;
    highlightMoment: string | TimelineStep;
    closingTouch: string | TimelineStep;
  };
  experienceTitle?: string;
}

const TimelineDisplay: React.FC<TimelineDisplayProps> = ({ timeline, experienceTitle }) => {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set([0]));
  const containerRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(containerRef, { once: true, margin: "-50px" });

  const timelineSteps = [
    { key: 'arrivalWelcome', number: 1, title: 'Arrival & Welcome' },
    { key: 'mainActivity', number: 2, title: 'Main Activity' },
    { key: 'immersionAddon', number: 3, title: 'Immersion Add-on' },
    { key: 'highlightMoment', number: 4, title: 'Highlight Moment' },
    { key: 'closingTouch', number: 5, title: 'Closing Touch' }
  ];

  const toggleStep = (index: number) => {
    const newExpanded = new Set(expandedSteps);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedSteps(newExpanded);
  };

  const getStepData = (step: string | TimelineStep | undefined) => {
    if (!step) {
      return { description: '', location: '', locationName: '' };
    }
    if (typeof step === 'string') {
      return { description: step, location: '', locationName: '' };
    }
    return step;
  };

  const openInMaps = (location: string) => {
    if (location.includes('maps.google') || location.includes('goo.gl')) {
      window.open(location, '_blank');
    } else {
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`, '_blank');
    }
  };

  // Open all timeline locations as multi-stop route in Google Maps
  const openAllInMaps = () => {
    // Collect all locations from timeline steps
    const locations: string[] = [];
    
    Object.values(timeline).forEach(step => {
      const stepData = getStepData(step);
      if (stepData.location) {
        locations.push(stepData.location);
      }
    });

    // Need at least 2 locations for a route
    if (locations.length < 2) {
      // If only one location, just open it
      if (locations.length === 1) {
        openInMaps(locations[0]);
      }
      return;
    }

    // First location is origin, last is destination, rest are waypoints
    const origin = encodeURIComponent(locations[0]);
    const destination = encodeURIComponent(locations[locations.length - 1]);
    
    // Middle locations are waypoints (joined by |)
    const waypoints = locations.slice(1, -1).map(loc => encodeURIComponent(loc)).join('|');
    
    // Build Google Maps directions URL with waypoints
    let mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
    
    if (waypoints) {
      mapsUrl += `&waypoints=${waypoints}`;
    }
    
    // Add travel mode (can be driving, walking, bicycling, transit)
    mapsUrl += '&travelmode=driving';
    
    window.open(mapsUrl, '_blank');
  };

  const hasAnyLocation = Object.values(timeline).some(step => {
    const stepData = getStepData(step);
    return stepData.location || stepData.locationName;
  });

  // Get icon for each step based on position
  const getStepIcon = (index: number, totalSteps: number) => {
    if (index === 0) {
      // Beginning - Flag icon
      return Flag;
    } else if (index === totalSteps - 1) {
      // End - MapPinned icon
      return MapPinned;
    } else {
      // Midpoints - Circle icon
      return Circle;
    }
  };

  return (
    <motion.div 
      ref={containerRef}
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="space-y-4"
    >
      {/* Header */}
      <div className="space-y-4 mb-6">
        <div>
          <h3 className="text-gray-900 mb-2 flex items-center gap-2">
            <MapPin className="w-5 h-5 text-[#eb7825]" />
            Experience Route
          </h3>
          <p className="text-sm text-gray-600">
            Follow these {timelineSteps.length} stops for the complete journey
          </p>
        </div>
        
        {/* Navigate All Button - Full Width */}
        {hasAnyLocation && (
          <motion.button
            onClick={openAllInMaps}
            className="w-full flex items-center justify-center gap-2.5 px-4 py-3 bg-[#eb7825] text-white rounded-xl hover:bg-[#d6691f] transition-all shadow-md hover:shadow-lg group"
            whileHover={{ scale: 1.02, y: -1 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
          >
            <Navigation className="w-4 h-4 group-hover:rotate-45 transition-transform duration-300" />
            <span className="font-medium">Navigate Full Route</span>
            <ExternalLink className="w-4 h-4 opacity-80" />
          </motion.button>
        )}
      </div>

      {/* Animated Timeline Path */}
      {/* Timeline Steps Container - Lines only span this section */}
      <div className="relative">
        {/* Vertical connecting line with animated gradient */}
        <div className="absolute left-6 top-8 bottom-8 w-0.5 bg-gradient-to-b from-[#eb7825] via-orange-300 to-[#eb7825] opacity-30" />
        
        {/* Animated progress line */}
        <motion.div 
          className="absolute left-6 top-8 bottom-8 w-0.5 bg-gradient-to-b from-[#eb7825] to-orange-400"
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 1.5, ease: "easeInOut", delay: 0.3 }}
        />

        {/* Timeline Steps */}
        <div className="space-y-3 pb-4">
          {timelineSteps.map((step, index) => {
            const stepData = getStepData(timeline[step.key as keyof typeof timeline]);
            
            if (!stepData.description) return null;

            const isExpanded = expandedSteps.has(index);
            const hasLocation = stepData.location || stepData.locationName;
            const StepIcon = getStepIcon(index, timelineSteps.length);
            const isFirst = index === 0;
            const isLast = index === timelineSteps.length - 1;

            return (
              <motion.div
                key={step.key}
                initial={{ opacity: 0, x: -20 }}
                animate={isInView ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
                transition={{ 
                  duration: 0.5, 
                  delay: 0.1 * index,
                  ease: "easeOut"
                }}
                className={`relative bg-white rounded-2xl border transition-all duration-300 ${
                  isExpanded 
                    ? 'border-[#eb7825] shadow-lg shadow-orange-100' 
                    : 'border-gray-200 hover:border-orange-200 hover:shadow-md'
                }`}
              >
                {/* Step Header - Always Visible */}
                <button
                  onClick={() => toggleStep(index)}
                  className="w-full p-4 flex items-center gap-4 text-left"
                >
                  {/* Icon with animated gradient background */}
                  <div className="flex-shrink-0 relative">
                    <motion.div 
                      className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 ${
                        isExpanded 
                          ? 'bg-gradient-to-br from-[#eb7825] to-[#d6691f]' 
                          : 'bg-gradient-to-br from-gray-100 to-gray-200'
                      }`}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <StepIcon className={`transition-all duration-300 ${
                        isExpanded ? 'w-6 h-6 text-white' : 'w-5 h-5 text-gray-600'
                      }`} />
                    </motion.div>
                    
                    {/* Pulsing ring animation for expanded state */}
                    {isExpanded && (
                      <motion.div
                        className="absolute inset-0 rounded-full border-2 border-[#eb7825]"
                        initial={{ scale: 1, opacity: 0.8 }}
                        animate={{ scale: 1.3, opacity: 0 }}
                        transition={{ 
                          duration: 1.5, 
                          repeat: Infinity,
                          repeatType: "loop"
                        }}
                      />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                        isExpanded 
                          ? 'bg-[#eb7825] text-white' 
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {isFirst ? 'Start' : isLast ? 'End' : `Stop ${step.number}`}
                      </span>
                      {hasLocation && (
                        <motion.div 
                          className="flex items-center gap-1 text-xs text-[#eb7825]"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: 0.2 + 0.1 * index }}
                        >
                          <MapPin className="w-3 h-3" />
                          <span className="hidden sm:inline">Location</span>
                        </motion.div>
                      )}
                    </div>
                    <h4 className={`text-sm transition-colors ${
                      isExpanded ? 'text-[#eb7825]' : 'text-gray-900'
                    }`}>
                      {step.title}
                    </h4>
                    {stepData.locationName && (
                      <p className="text-xs text-gray-500 mt-1 truncate">
                        {stepData.locationName}
                      </p>
                    )}
                  </div>

                  {/* Expand/Collapse indicator */}
                  <div className="flex-shrink-0">
                    <motion.div
                      animate={{ rotate: isExpanded ? 180 : 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      <svg 
                        className={`w-5 h-5 transition-colors ${
                          isExpanded ? 'text-[#eb7825]' : 'text-gray-400'
                        }`} 
                        fill="none" 
                        viewBox="0 0 24 24" 
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </motion.div>
                  </div>
                </button>

                {/* Expanded Content */}
                {isExpanded && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                    className="overflow-hidden"
                  >
                    <div className="px-6 pb-4 space-y-4">
                      {/* Description */}
                      <div className="px-4">
                        <p className="text-sm text-gray-700 leading-relaxed">
                          {stepData.description}
                        </p>
                      </div>

                      {/* Location Information with animated card */}
                      {hasLocation && (
                        <motion.div 
                          className="px-4"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.1 }}
                        >
                          <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl px-5 py-4 border border-orange-200 relative overflow-hidden">
                            {/* Animated shimmer effect */}
                            <motion.div
                              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                              initial={{ x: '-100%' }}
                              animate={{ x: '100%' }}
                              transition={{ 
                                duration: 2, 
                                repeat: Infinity,
                                repeatDelay: 3 
                              }}
                            />
                            
                            <div className="relative z-10 space-y-3">
                              {/* Location address row */}
                              <div className="flex items-center gap-4">
                                <motion.div 
                                  className="w-10 h-10 rounded-lg bg-white flex items-center justify-center flex-shrink-0 shadow-sm"
                                  whileHover={{ scale: 1.1, rotate: 5 }}
                                >
                                  <MapPin className="w-5 h-5 text-[#eb7825]" />
                                </motion.div>
                                <div className="flex-1 min-w-0">
                                  {stepData.location && (
                                    <div className="text-xs text-gray-600">
                                      {stepData.location}
                                    </div>
                                  )}
                                </div>
                              </div>
                              
                              {/* Button on its own line, full width */}
                              {stepData.location && (
                                <motion.button
                                  onClick={() => openInMaps(stepData.location!)}
                                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-[#eb7825] rounded-lg hover:bg-[#eb7825] hover:text-white transition-all text-sm shadow-sm group"
                                  whileHover={{ scale: 1.02 }}
                                  whileTap={{ scale: 0.98 }}
                                >
                                  <Navigation className="w-4 h-4 group-hover:animate-pulse" />
                                  <span>Open in Maps</span>
                                  <ExternalLink className="w-3 h-3" />
                                </motion.button>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      )}

                      {/* Journey connector - "Then..." */}
                      {index < timelineSteps.length - 1 && (
                        <motion.div 
                          className="px-4 pt-2"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.2 }}
                        >
                          <div className="flex items-center gap-2 text-xs text-gray-400">
                            <div className="flex-1 h-px bg-gradient-to-r from-gray-200 to-transparent"></div>
                            <span className="px-2 py-1 bg-gray-50 rounded-full">Then...</span>
                            <div className="flex-1 h-px bg-gradient-to-l from-gray-200 to-transparent"></div>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Completion indicator - Outside timeline container */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={isInView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
        transition={{ delay: 1, duration: 0.5 }}
        className="mt-6 p-4 bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl border border-[#eb7825] text-center"
      >
        <div className="flex items-center justify-center gap-2 text-sm text-[#d6691f]">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Estimated duration: 2-3 hours</span>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default TimelineDisplay;