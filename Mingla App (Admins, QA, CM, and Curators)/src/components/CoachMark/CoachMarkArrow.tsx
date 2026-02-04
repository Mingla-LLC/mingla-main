import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';

interface CoachMarkArrowProps {
  targetRef: string;
  tooltipRef: React.RefObject<HTMLDivElement>;
}

interface ArrowPath {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  angle: number;
}

export default function CoachMarkArrow({ targetRef, tooltipRef }: CoachMarkArrowProps) {
  const [arrowPath, setArrowPath] = useState<ArrowPath | null>(null);

  useEffect(() => {
    let attemptCount = 0;
    const maxAttempts = 30;
    let timeoutId: NodeJS.Timeout;

    const updateArrow = () => {
      // Find all elements with the target ref
      const allTargetElements = document.querySelectorAll(`[data-coachmark="${targetRef}"]`);
      const tooltipElement = tooltipRef.current;

      // Find the VISIBLE target element
      let targetElement: HTMLElement | null = null;
      let maxArea = 0;

      for (let i = 0; i < allTargetElements.length; i++) {
        const el = allTargetElements[i] as HTMLElement;
        const rect = el.getBoundingClientRect();
        const area = rect.width * rect.height;
        
        // Element must have dimensions to be considered visible
        if (area > 0) {
          // Also check computed style to make sure it's not hidden
          const style = window.getComputedStyle(el);
          if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) {
            // Select the element with the largest visible area (to prefer the actually rendered one)
            if (area > maxArea) {
              maxArea = area;
              targetElement = el;
            }
          }
        }
      }

      // Retry if elements not found yet
      if ((!targetElement || !tooltipElement) && attemptCount < maxAttempts) {
        attemptCount++;
        timeoutId = setTimeout(updateArrow, 100);
        return;
      }

      if (!targetElement || !tooltipElement) {
        return;
      }

      const targetRect = targetElement.getBoundingClientRect();
      const tooltipRect = tooltipElement.getBoundingClientRect();

      // Skip if elements have no dimensions yet
      if (targetRect.width === 0 || tooltipRect.width === 0) {
        attemptCount++;
        if (attemptCount < maxAttempts) {
          timeoutId = setTimeout(updateArrow, 100);
        }
        return;
      }

      // Calculate centers
      const targetCenterX = targetRect.left + targetRect.width / 2;
      const targetCenterY = targetRect.top + targetRect.height / 2;
      const tooltipCenterX = tooltipRect.left + tooltipRect.width / 2;
      const tooltipCenterY = tooltipRect.top + tooltipRect.height / 2;

      // Calculate direction vector
      const dx = targetCenterX - tooltipCenterX;
      const dy = targetCenterY - tooltipCenterY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance === 0) return; // Target and tooltip are at the same position

      // Normalize direction
      const dirX = dx / distance;
      const dirY = dy / distance;

      // Calculate angle
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);

      // Start point: edge of tooltip closest to target
      // Use the actual rounded rectangle edge (accounting for border-radius)
      const tooltipRadius = Math.min(tooltipRect.width, tooltipRect.height) / 2 * 0.95;
      const startX = tooltipCenterX + dirX * tooltipRadius;
      const startY = tooltipCenterY + dirY * tooltipRadius;

      // End point: near the target (stop before reaching it to account for spotlight)
      const targetPadding = Math.max(targetRect.width, targetRect.height) / 2 + 20;
      const endX = targetCenterX - dirX * targetPadding;
      const endY = targetCenterY - dirY * targetPadding;

      setArrowPath({
        x1: startX,
        y1: startY,
        x2: endX,
        y2: endY,
        angle
      });
    };

    // Initial update with retry logic
    updateArrow();

    // Update on resize/scroll with debouncing
    let resizeTimeout: NodeJS.Timeout;
    const debouncedUpdate = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(updateArrow, 50);
    };

    window.addEventListener('resize', debouncedUpdate);
    window.addEventListener('scroll', debouncedUpdate, true);

    return () => {
      window.removeEventListener('resize', debouncedUpdate);
      window.removeEventListener('scroll', debouncedUpdate, true);
      if (timeoutId) clearTimeout(timeoutId);
      if (resizeTimeout) clearTimeout(resizeTimeout);
    };
  }, [targetRef, tooltipRef]);

  if (!arrowPath) return null;

  return (
    <svg
      className="fixed inset-0 w-full h-full z-[10000] pointer-events-none"
      style={{ zIndex: 10000 }}
    >
      <defs>
        <marker
          id="arrowhead"
          markerWidth="10"
          markerHeight="10"
          refX="9"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path
            d="M0,0 L0,6 L9,3 z"
            fill="#eb7825"
          />
        </marker>
      </defs>
      
      <motion.line
        x1={arrowPath.x1}
        y1={arrowPath.y1}
        x2={arrowPath.x2}
        y2={arrowPath.y2}
        stroke="#eb7825"
        strokeWidth="3"
        strokeDasharray="6,4"
        markerEnd="url(#arrowhead)"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      />
    </svg>
  );
}
