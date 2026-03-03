/**
 * Utility to convert curated experience stops into timeline format
 * for rendering with TimelineSection component animations
 */

import type { CuratedStop } from '../types/curatedExperience';

export interface TimelineStep {
  step: number;
  type: 'start' | 'activity' | 'transport' | 'end';
  title: string;
  description: string;
  duration: number;
  location: {
    name: string;
    address: string;
    lat?: number;
    lng?: number;
  };
}

/**
 * Convert an array of CuratedStop objects to TimelineStep objects
 * that TimelineSection component expects
 */
export function curatedStopsToTimeline(stops: CuratedStop[]): TimelineStep[] {
  if (!stops || stops.length === 0) return [];

  const timeline: TimelineStep[] = [];

  // Process each stop
  stops.forEach((stop, index) => {
    const isFirst = index === 0;
    const stepNumber = index + 1;

    // Create main activity step
    timeline.push({
      step: stepNumber,
      type: isFirst ? 'start' : 'activity',
      title: `${stop.stopLabel}: ${stop.placeName}`,
      description:
        stop.aiDescription ||
        `Explore ${stop.placeName}, a ${stop.placeType.replace(/_/g, ' ')}. ${
          stop.rating ? `Rated ${stop.rating}/5.` : ''
        }`,
      duration: stop.estimatedDurationMinutes || 45,
      location: {
        name: stop.placeName,
        address: stop.address,
        lat: stop.lat,
        lng: stop.lng,
      },
    });

    // Add travel step between stops (except after the last stop)
    if (index < stops.length - 1) {
      const nextStop = stops[index + 1];
      const travelTime = nextStop.travelTimeFromPreviousStopMin || 15;

      timeline.push({
        step: stepNumber + 0.5, // Decimal step for travel segments
        type: 'transport',
        title: `Travel to ${nextStop.placeName}`,
        description: `Travel from ${stop.placeName} to ${nextStop.placeName} (${travelTime} min by ${
          nextStop.travelModeFromPreviousStop || 'walking'
        })`,
        duration: travelTime,
        location: {
          name: `Travel from ${stop.placeName}`,
          address: nextStop.address,
          lat: nextStop.lat,
          lng: nextStop.lng,
        },
      });
    }

    // Mark last stop as 'end'
    if (index === stops.length - 1) {
      timeline[timeline.length - 1].type = 'end';
    }
  });

  return timeline;
}

/**
 * Format a timeline step for display
 */
export function formatTimelineStep(step: TimelineStep): {
  label: string;
  title: string;
  description: string;
  duration: string;
} {
  const durationLabel =
    step.duration < 60
      ? `${Math.round(step.duration)}m`
      : `${Math.floor(step.duration / 60)}h ${Math.round(step.duration % 60)}m`;

  return {
    label: getStepLabel(step.step, step.type),
    title: step.title,
    description: step.description,
    duration: durationLabel,
  };
}

function getStepLabel(
  step: number,
  type: 'start' | 'activity' | 'transport' | 'end'
): string {
  if (type === 'start') return 'Start';
  if (type === 'transport') return 'Travel';
  if (type === 'end') return 'End';
  return `Stop ${Math.floor(step)}`;
}
