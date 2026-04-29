import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import { useAppStore } from '../store/appStore';
import type { Recommendation } from '../types/recommendation';

interface SavedCardRow {
  id: string;
  profile_id: string;
  experience_id: string;
  title: string | null;
  category: string | null;
  image_url: string | null;
  card_data: Record<string, unknown> | null;
  created_at: string;
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function toRecommendation(row: SavedCardRow): Recommendation | null {
  const cardData = (row.card_data ?? {}) as Record<string, unknown>;
  const location = cardData.location as { lat?: number; lng?: number } | undefined;
  const lat = toNumber(cardData.lat) ?? toNumber(location?.lat);
  const lng = toNumber(cardData.lng) ?? toNumber(location?.lng);

  if (lat == null || lng == null) {
    return null;
  }

  const image = (typeof cardData.image === 'string' ? cardData.image : null) ?? row.image_url ?? '';
  const images = Array.isArray(cardData.images)
    ? cardData.images.filter((item): item is string => typeof item === 'string')
    : image
      ? [image]
      : [];

  const recommendation: Recommendation = {
    id: (typeof cardData.id === 'string' && cardData.id) ? cardData.id : row.experience_id,
    title: (typeof cardData.title === 'string' && cardData.title) ? cardData.title : row.title ?? 'Saved experience',
    category: (typeof cardData.category === 'string' && cardData.category) ? cardData.category : row.category ?? 'Experience',
    categoryIcon: (typeof cardData.categoryIcon === 'string' && cardData.categoryIcon) ? cardData.categoryIcon : 'compass-outline',
    lat,
    lng,
    // ORCH-0659/0660: timeAway field deleted from Recommendation type.
    description: typeof cardData.description === 'string' ? cardData.description : '',
    budget: typeof cardData.budget === 'string' ? cardData.budget : '',
    rating: toNumber(cardData.rating) ?? 0,
    image,
    images,
    priceRange: typeof cardData.priceRange === 'string' ? cardData.priceRange : '',
    distance: typeof cardData.distance === 'string' ? cardData.distance : '',
    travelTime: typeof cardData.travelTime === 'string' ? cardData.travelTime : '',
    experienceType: typeof cardData.experienceType === 'string' ? cardData.experienceType : ((typeof cardData.category === 'string' && cardData.category) ? cardData.category : 'Experience'),
    highlights: toStringArray(cardData.highlights),
    fullDescription: typeof cardData.fullDescription === 'string'
      ? cardData.fullDescription
      : (typeof cardData.description === 'string' ? cardData.description : ''),
    address: typeof cardData.address === 'string' ? cardData.address : '',
    openingHours: (cardData.openingHours as Recommendation['openingHours']) ?? null,
    tags: toStringArray(cardData.tags),
    matchScore: toNumber(cardData.matchScore) ?? 0,
    reviewCount: toNumber(cardData.reviewCount) ?? 0,
    website: typeof cardData.website === 'string' ? cardData.website : null,
    phone: typeof cardData.phone === 'string' ? cardData.phone : null,
    placeId: typeof cardData.placeId === 'string' ? cardData.placeId : undefined,
    priceTier: typeof cardData.priceTier === 'string' ? cardData.priceTier : undefined,
    socialStats: (cardData.socialStats as Recommendation['socialStats']) ?? {
      views: 0,
      likes: 0,
      saves: 0,
      shares: 0,
    },
    matchFactors: (cardData.matchFactors as Recommendation['matchFactors']) ?? {
      location: 85,
      budget: 85,
      category: 85,
      time: 85,
      popularity: 85,
    },
    oneLiner: typeof cardData.oneLiner === 'string' ? cardData.oneLiner : null,
    tip: typeof cardData.tip === 'string' ? cardData.tip : null,
    strollData: (cardData.strollData as Recommendation['strollData']) ?? undefined,
  };

  const rawStops = cardData._rawStops ?? cardData.stops;
  if (Array.isArray(rawStops)) {
    (recommendation as Recommendation & { _rawStops?: unknown[] })._rawStops = rawStops;
  }

  return recommendation;
}

export function usePairedMapSavedCards(activePairedUserIds: string[]) {
  const queryClient = useQueryClient();
  const userId = useAppStore((state) => state.user?.id);
  const normalizedIds = useMemo(
    () => [...new Set(activePairedUserIds.filter(Boolean))].sort(),
    [activePairedUserIds],
  );

  const query = useQuery<Recommendation[]>({
    queryKey: ['map-paired-saved-cards', normalizedIds.join(',')],
    queryFn: async () => {
      if (normalizedIds.length === 0) return [];

      const { data, error } = await supabase
        .from('saved_card')
        .select('id, profile_id, experience_id, title, category, image_url, card_data, created_at')
        .in('profile_id', normalizedIds)
        .order('created_at', { ascending: false })
        .limit(40);

      if (error) {
        throw error;
      }

      const uniqueCards = new Map<string, Recommendation>();
      for (const row of (data ?? []) as SavedCardRow[]) {
        const card = toRecommendation(row);
        if (!card) continue;
        if (!uniqueCards.has(card.id)) {
          uniqueCards.set(card.id, card);
        }
      }

      return Array.from(uniqueCards.values());
    },
    enabled: normalizedIds.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!userId || normalizedIds.length === 0) return;

    const channel = supabase
      .channel(`map-paired-saved-cards-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const type = (payload.new as { type?: string } | null)?.type;
          if (type === 'paired_user_saved_card') {
            queryClient.invalidateQueries({ queryKey: ['map-paired-saved-cards'] });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [normalizedIds.length, queryClient, userId]);

  return {
    cards: query.data ?? [],
    pairedSavedCardIds: new Set((query.data ?? []).map((card) => card.id)),
    isLoading: query.isLoading,
  };
}
