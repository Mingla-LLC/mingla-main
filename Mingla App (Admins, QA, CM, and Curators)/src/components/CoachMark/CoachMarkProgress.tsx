import React from 'react';
import { motion } from 'motion/react';

interface CoachMarkProgressProps {
  current: number;
  total: number;
}

export default function CoachMarkProgress({ current, total }: CoachMarkProgressProps) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: total }).map((_, index) => {
        const isActive = index === current;
        const isPast = index < current;
        
        return (
          <motion.div
            key={index}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ 
              scale: isActive ? 1 : 0.85,
              opacity: 1,
              width: isActive ? '32px' : '8px'
            }}
            transition={{ 
              duration: 0.4,
              ease: [0.16, 1, 0.3, 1]
            }}
            className="relative h-2 rounded-full overflow-hidden"
          >
            {/* Background */}
            <div className="absolute inset-0 bg-gray-200/80 rounded-full" />
            
            {/* Active/Past fill */}
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ 
                scaleX: isActive || isPast ? 1 : 0,
              }}
              transition={{ 
                duration: 0.5,
                ease: [0.16, 1, 0.3, 1]
              }}
              className={`absolute inset-0 rounded-full origin-left ${
                isActive 
                  ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f]' 
                  : 'bg-[#eb7825]'
              }`}
            />
            
            {/* Shimmer effect for active */}
            {isActive && (
              <motion.div
                animate={{
                  x: ['-100%', '200%']
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  repeatDelay: 0.5
                }}
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent"
              />
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
