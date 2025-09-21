import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { Experience } from '../types';

export interface ExperienceFilters {
  categories?: string[];
  budgetMin?: number;
  budgetMax?: number;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  openAtIso?: string;
}

export const useExperiences = (filters?: ExperienceFilters) => {
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchExperiences = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('experiences')
        .select('*')
        .order('created_at', { ascending: false });

      // Apply filters
      if (filters?.categories && filters.categories.length > 0) {
        query = query.in('category_slug', filters.categories);
      }

      if (filters?.budgetMin !== undefined) {
        query = query.gte('price_min', filters.budgetMin);
      }

      if (filters?.budgetMax !== undefined) {
        query = query.lte('price_max', filters.budgetMax);
      }

      const { data, error } = await query;

      if (error) throw error;

      setExperiences(data || []);
    } catch (err: any) {
      setError(err.message);
      console.error('Error fetching experiences:', err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const fetchNearbyPlaces = useCallback(async (lat: number, lng: number, categorySlug?: string) => {
    setLoading(true);
    setError(null);

    try {
      // Add timeout to prevent hanging requests
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch('https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/places', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxbm9hanFlcnFobnZ1bG1ueXZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc1MDUyNzIsImV4cCI6MjA3MzA4MTI3Mn0.p4yi9yD2RWfJ2HN4DD-dgrvXnyzhJi3g2YCouSK-hbo`,
        },
        body: JSON.stringify({
          lat,
          lng,
          radiusMeters: 5000,
          category_slug: categorySlug || 'stroll',
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn('Places API not available, falling back to database experiences');
        // Fallback to database experiences instead of throwing error
        await fetchExperiences();
        return;
      }

      const result = await response.json();
      
      // Handle both array response and object with results property
      const places = Array.isArray(result) ? result : (result.results || []);
      
      if (places.length > 0) {
        // Convert places to experiences format
        const newExperiences: Experience[] = places.map((place: any) => ({
          id: place.id,
          title: place.title,
          category: place.category,
          category_slug: place.category_slug,
          place_id: place.place_id,
          lat: place.lat,
          lng: place.lng,
          price_min: place.price_min || 0,
          price_max: place.price_max || 0,
          duration_min: place.duration_min || 60,
          image_url: place.image_url,
          opening_hours: place.opening_hours,
          meta: place.meta || {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));

        setExperiences(prev => [...prev, ...newExperiences]);
      } else {
        console.log('No nearby places found, falling back to database experiences');
        await fetchExperiences();
      }
    } catch (err: any) {
      console.warn('Error fetching nearby places, falling back to database experiences:', err.message);
      // Instead of setting error, fallback to database experiences
      try {
        await fetchExperiences();
      } catch (fallbackErr) {
        console.error('Fallback also failed:', fallbackErr);
        setError('Unable to load experiences');
      }
    } finally {
      setLoading(false);
    }
  }, [fetchExperiences]);

  const saveExperience = useCallback(async (experienceId: string, status: string = 'liked') => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { error } = await supabase
        .from('saves')
        .upsert({
          profile_id: user.id,
          experience_id: experienceId,
          status,
        });

      if (error) throw error;
      return { error: null };
    } catch (err: any) {
      return { error: err };
    }
  }, []);

  const unsaveExperience = useCallback(async (experienceId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { error } = await supabase
        .from('saves')
        .delete()
        .eq('profile_id', user.id)
        .eq('experience_id', experienceId);

      if (error) throw error;
      return { error: null };
    } catch (err: any) {
      return { error: err };
    }
  }, []);

  const getSavedExperiences = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('saves')
        .select(`
          *,
          experiences (*)
        `)
        .eq('profile_id', user.id);

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (err: any) {
      return { data: [], error: err };
    }
  }, []);

  useEffect(() => {
    fetchExperiences();
  }, [fetchExperiences]);

  return {
    experiences,
    loading,
    error,
    fetchExperiences,
    fetchNearbyPlaces,
    saveExperience,
    unsaveExperience,
    getSavedExperiences,
  };
};
