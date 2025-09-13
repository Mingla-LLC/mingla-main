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

export const useExperiences = (categoryFilters: string[] = []) => {
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
      if (categoryFilters.length > 0) {
        query = query.in('category_slug', categoryFilters);
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      setExperiences(data || []);
    } catch (err) {
      console.error('Error fetching experiences:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch experiences');
    } finally {
      setLoading(false);
    }
  }, [categoryFilters.join(',')]); // Use join to create stable dependency

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