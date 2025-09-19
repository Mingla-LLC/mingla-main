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
  collaborativePreferences?: Array<{
    id: string;
    categories: string[];
    budgetRange: [number, number];
    time: string;
    travel: string;
    travelTime: number;
    location: string;
  }>;
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

      // For collaborative sessions, apply intersected preferences
      if (filters.collaborativePreferences && filters.collaborativePreferences.length > 0) {
        // Find intersection of all collaborators' categories
        const allCategories = filters.collaborativePreferences.map(p => p.categories);
        const commonCategories = allCategories.reduce((common, current) => {
          if (common.length === 0) return current;
          return common.filter(cat => current.includes(cat));
        }, []);
        
        if (commonCategories.length > 0) {
          query = query.in('category_slug', commonCategories);
        }
        
        // Find most restrictive budget range (intersection)
        const budgetRanges = filters.collaborativePreferences.map(p => p.budgetRange);
        const minBudget = Math.max(...budgetRanges.map(b => b[0]));
        const maxBudget = Math.min(...budgetRanges.map(b => b[1]));
        
        if (minBudget <= maxBudget && (minBudget !== 10 || maxBudget !== 10000)) {
          query = query
            .gte('price_min', minBudget)
            .lte('price_max', maxBudget);
        }
      } else {
        // Single user preferences
        // Filter by budget range if provided and not default values
        if (filters.budgetRange && filters.budgetRange[0] !== 10 && filters.budgetRange[1] !== 10000) {
          query = query
            .gte('price_min', filters.budgetRange[0])
            .lte('price_max', filters.budgetRange[1]);
        }
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

      // Filter by opening hours and time preference
      if (filters.time && filters.time !== 'now') {
        filteredData = filteredData.filter(exp => {
          if (!exp.opening_hours) return true; // If no opening hours, assume available
          
          const now = new Date();
          let targetTime: Date;
          
          switch (filters.time) {
            case 'Tonight':
              targetTime = new Date(now);
              targetTime.setHours(18, 0, 0, 0); // 6 PM tonight
              break;
            case 'This Weekend':
              targetTime = new Date(now);
              const daysUntilSaturday = (6 - now.getDay()) % 7;
              targetTime.setDate(now.getDate() + daysUntilSaturday);
              targetTime.setHours(14, 0, 0, 0); // 2 PM Saturday
              break;
            default:
              targetTime = now;
          }
          
          // Simple opening hours check - in real app, this would be more sophisticated
          const hours = exp.opening_hours as any;
          if (hours && typeof hours === 'object') {
            const dayOfWeek = targetTime.getDay();
            const timeString = targetTime.toTimeString().slice(0, 5); // HH:MM format
            
            // Check if the venue is open at the target time
            // This is a simplified check - real implementation would parse complex opening hours
            return true; // For now, assume all venues are available
          }
          
          return true;
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
    filters.travelDistance,
    filters.location,
    filters.collaborativePreferences?.map(p => `${p.id}_${p.categories.join(',')}_${p.budgetRange.join(',')}`).join('|')
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