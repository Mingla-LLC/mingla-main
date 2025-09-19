import { describe, it, expect } from 'vitest';
import { convertPreferencesToRequest } from '@/utils/preferencesConverter';

describe('preferencesConverter', () => {
  it('converts basic preferences to recommendations request', () => {
    const preferences = {
      budgetRange: [50, 200] as [number, number],
      categories: ['sip', 'casual_eats'],
      experienceTypes: ['First Date'],
      time: 'tonight',
      travel: 'drive',
      travelConstraint: 'time' as const,
      travelTime: 20,
      travelDistance: 5,
      location: 'current',
      groupSize: 2
    };

    const result = convertPreferencesToRequest(preferences, 40.7128, -74.0060);

    expect(result).toEqual({
      budget: { min: 50, max: 200, perPerson: true },
      categories: ['sip', 'casual_eats'],
      timeWindow: {
        kind: 'Tonight',
        start: null,
        end: null,
        timeOfDay: '19:00'
      },
      travel: {
        mode: 'DRIVING',
        constraint: { type: 'TIME', maxMinutes: 20 }
      },
      origin: { lat: 40.7128, lng: -74.0060 },
      units: 'metric'
    });
  });

  it('uses custom location when specified', () => {
    const preferences = {
      budgetRange: [30, 100] as [number, number],
      categories: ['stroll'],
      time: 'now',
      travel: 'walk',
      travelConstraint: 'distance' as const,
      travelTime: 15,
      travelDistance: 2,
      location: 'custom',
      custom_lat: 35.7915,
      custom_lng: -78.7811,
      groupSize: 1
    };

    const result = convertPreferencesToRequest(preferences);

    expect(result.origin).toEqual({ lat: 35.7915, lng: -78.7811 });
    expect(result.travel.mode).toBe('WALKING');
    expect(result.travel.constraint).toEqual({ type: 'DISTANCE', maxDistance: 2 });
  });

  it('handles different time preferences', () => {
    const basePrefs = {
      budgetRange: [20, 80] as [number, number],
      categories: ['play_move'],
      time: 'this weekend',
      travel: 'public transport',
      travelConstraint: 'time' as const,
      travelTime: 30,
      travelDistance: 10,
      location: 'current',
      groupSize: 4
    };

    const result = convertPreferencesToRequest(basePrefs);

    expect(result.timeWindow.kind).toBe('ThisWeekend');
    expect(result.travel.mode).toBe('TRANSIT');
  });

  it('falls back to defaults for invalid inputs', () => {
    const preferences = {
      budgetRange: [0, 0] as [number, number],
      categories: [],
      time: 'invalid',
      travel: 'teleport',
      travelConstraint: 'time' as const,
      travelTime: 0,
      travelDistance: 0,
      location: 'nowhere',
      groupSize: 0
    };

    const result = convertPreferencesToRequest(preferences);

    expect(result.timeWindow.kind).toBe('Now');
    expect(result.travel.mode).toBe('DRIVING');
    expect(result.origin).toEqual({ lat: 35.7915, lng: -78.7811 }); // Default Cary, NC
  });
});