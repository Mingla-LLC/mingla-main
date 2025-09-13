import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Experience {
  id: string;
  title: string;
  category: string;
  category_slug: string;
  place_id: string | null;
  lat: number | null;
  lng: number | null;
  price_min: number | null;
  price_max: number | null;
  duration_min: number | null;
  image_url: string | null;
  opening_hours: any;
  meta: any;
}

export interface ExperienceFilters {
  categories?: string[];
  budgetRange?: [number, number];
  groupSize?: number;
  time?: string;
  travel?: string;
  travelTime?: number;
  travelDistance?: number;
  location?: string;
}

export const useExperiences = (filters: ExperienceFilters = {}) => {
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchExperiences = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      let query = supabase
        .from('experiences')
        .select('*')
        .order('created_at', { ascending: false });

      // Filter by category slugs if provided
      if (filters.categories && filters.categories.length > 0) {
        query = query.in('category_slug', filters.categories);
      }

      // Filter by budget range if provided
      if (filters.budgetRange && filters.budgetRange[0] !== 10 && filters.budgetRange[1] !== 10000) {
        query = query
          .gte('price_min', filters.budgetRange[0])
          .lte('price_max', filters.budgetRange[1]);
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      // Apply client-side filters for complex logic
      let filteredData = data || [];

      // Filter by group size (check if experience supports the group size)
      if (filters.groupSize && filters.groupSize > 1) {
        filteredData = filteredData.filter(exp => {
          // Assume experiences can accommodate groups unless specified otherwise
          const maxCapacity = (exp.meta as any)?.max_capacity || 20; // Default max capacity
          return filters.groupSize! <= maxCapacity;
        });
      }

      // Filter by time preference (simplified logic)
      if (filters.time && filters.time !== 'now') {
        filteredData = filteredData.filter(exp => {
          // Simple logic - in real app, this would be more sophisticated
          // based on opening hours and availability
          return true; // For now, show all experiences regardless of time
        });
      }

      // Filter by travel constraints (simplified logic)
      if (filters.travelTime && filters.travelTime !== 15) {
        filteredData = filteredData.filter(exp => {
          // Simple logic - assume all experiences within reasonable travel time
          // In real app, this would calculate actual travel time based on location
          return true; // For now, show all experiences
        });
      }

      setExperiences(filteredData);
    } catch (err) {
      console.error('Error fetching experiences:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch experiences');
    } finally {
      setLoading(false);
    }
  }, [
    filters.categories?.join(','),
    filters.budgetRange?.join(','),
    filters.groupSize,
    filters.time,
    filters.travel,
    filters.travelTime,
    filters.location
  ]);

  useEffect(() => {
    let isMounted = true;
    
    // Add small delay to prevent rapid re-fetches and improve stability
    const timeoutId = setTimeout(() => {
      if (isMounted) {
        fetchExperiences();
      }
    }, 50);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [fetchExperiences]);

  return { experiences, loading, error };
};