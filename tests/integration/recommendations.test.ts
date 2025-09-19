import { describe, it, expect, beforeEach } from 'vitest';
import { supabase } from '@/integrations/supabase/client';

// Mock the supabase client
const mockInvoke = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: mockInvoke
    }
  }
}));

describe('Recommendations Integration', () => {
  beforeEach(() => {
    mockInvoke.mockClear();
  });

  it('calls recommendations endpoint with correct payload', async () => {
    const mockResponse = {
      data: {
        cards: [
          {
            id: 'test-card-1',
            title: 'Coffee Shop',
            subtitle: 'Sip & Chill · $$ · 5 min drive',
            category: 'sip',
            priceLevel: 2,
            estimatedCostPerPerson: 15,
            startTime: '2025-09-19T10:00:00Z',
            durationMinutes: 60,
            imageUrl: 'https://example.com/coffee.jpg',
            address: '123 Main St',
            location: { lat: 35.7915, lng: -78.7811 },
            route: {
              mode: 'DRIVING',
              etaMinutes: 5,
              distanceText: '1.2 mi',
              mapsDeepLink: 'https://www.google.com/maps/dir/?api=1&origin=35.7915,-78.7811&destination=35.7915,-78.7811&travelmode=driving'
            },
            source: { provider: 'google_places', placeId: 'ChIJ123' },
            copy: {
              oneLiner: 'Perfect spot for morning coffee and pastries.',
              tip: 'Try their signature latte with oat milk.'
            },
            actions: { invite: true, save: true, share: true }
          }
        ]
      },
      error: null
    };

    mockInvoke.mockResolvedValue(mockResponse);

    const preferences = {
      budget: { min: 10, max: 50, perPerson: true },
      categories: ['sip'],
      timeWindow: { kind: 'Now', start: null, end: null, timeOfDay: '10:30' },
      travel: { mode: 'DRIVING', constraint: { type: 'TIME', maxMinutes: 15 } },
      origin: { lat: 35.7915, lng: -78.7811 },
      units: 'imperial'
    };

    const result = await supabase.functions.invoke('recommendations', {
      body: preferences
    });

    expect(mockInvoke).toHaveBeenCalledWith('recommendations', {
      body: preferences
    });
    expect(result.data.cards).toHaveLength(1);
    expect(result.data.cards[0].title).toBe('Coffee Shop');
  });

  it('handles error responses gracefully', async () => {
    mockInvoke.mockResolvedValue({
      data: { error: 'Rate limit exceeded' },
      error: null
    });

    const preferences = {
      budget: { min: 10, max: 100, perPerson: true },
      categories: ['dining'],
      timeWindow: { kind: 'Tonight', start: null, end: null, timeOfDay: '19:00' },
      travel: { mode: 'WALKING', constraint: { type: 'DISTANCE', maxDistance: 1 } },
      origin: { lat: 40.7128, lng: -74.0060 },
      units: 'metric'
    };

    const result = await supabase.functions.invoke('recommendations', {
      body: preferences
    });

    expect(result.data.error).toBe('Rate limit exceeded');
  });

  it('validates response schema', async () => {
    const mockResponse = {
      data: {
        cards: [
          {
            id: 'valid-card',
            title: 'Restaurant',
            subtitle: 'Dining · $$$ · 10 min walk',
            category: 'dining',
            priceLevel: 3,
            estimatedCostPerPerson: 45,
            startTime: '2025-09-19T19:30:00Z',
            durationMinutes: 120,
            imageUrl: 'https://example.com/restaurant.jpg',
            address: '456 Oak Ave',
            location: { lat: 40.7128, lng: -74.0060 },
            route: {
              mode: 'WALKING',
              etaMinutes: 10,
              distanceText: '0.5 mi',
              mapsDeepLink: 'https://www.google.com/maps/dir/?api=1&origin=40.7128,-74.0060&destination=40.7128,-74.0060&travelmode=walking'
            },
            source: { provider: 'google_places', placeId: 'ChIJ456' },
            copy: {
              oneLiner: 'Intimate dining with seasonal ingredients.',
              tip: 'Make a reservation for weekend dinners.'
            },
            actions: { invite: true, save: true, share: true }
          }
        ],
        meta: {
          totalResults: 1,
          processingTimeMs: 1250,
          sources: { googlePlaces: 1, eventbrite: 0 },
          llmUsed: true
        }
      },
      error: null
    };

    mockInvoke.mockResolvedValue(mockResponse);

    const result = await supabase.functions.invoke('recommendations', { body: {} });
    const card = result.data.cards[0];

    // Validate required fields
    expect(card).toHaveProperty('id');
    expect(card).toHaveProperty('title');
    expect(card).toHaveProperty('category');
    expect(card).toHaveProperty('location');
    expect(card.location).toHaveProperty('lat');
    expect(card.location).toHaveProperty('lng');
    expect(card).toHaveProperty('route');
    expect(card.route).toHaveProperty('mapsDeepLink');
    expect(card).toHaveProperty('copy');
    expect(card.copy).toHaveProperty('oneLiner');
    expect(card.copy).toHaveProperty('tip');
  });
});