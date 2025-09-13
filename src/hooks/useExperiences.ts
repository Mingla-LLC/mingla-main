import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getCategoryBySlug } from '@/lib/categories';

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

  useEffect(() => {
    const fetchExperiences = async () => {
      try {
        setLoading(true);
        let query = supabase
          .from('experiences')
          .select('*');

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
    };

    fetchExperiences();
  }, [categoryFilters]);

  return { experiences, loading, error };
};