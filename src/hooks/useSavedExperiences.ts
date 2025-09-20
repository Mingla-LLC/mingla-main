import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import type { RecommendationCard } from '@/types/recommendations';

interface SavedExperience {
  id: string;
  card_id: string;
  title: string;
  subtitle?: string;
  category: string;
  price_level: number;
  estimated_cost_per_person?: number;
  start_time?: string;
  duration_minutes?: number;
  image_url?: string;
  address?: string;
  location_lat?: number;
  location_lng?: number;
  route_mode?: string;
  eta_minutes?: number;
  distance_text?: string;
  maps_deep_link?: string;
  source_provider?: string;
  place_id?: string;
  event_id?: string;
  one_liner?: string;
  tip?: string;
  rating?: number;
  review_count?: number;
  status: 'saved' | 'accepted';
  scheduled_date?: string;
  created_at: string;
  updated_at: string;
}

export const useSavedExperiences = () => {
  const [savedExperiences, setSavedExperiences] = useState<SavedExperience[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load saved experiences
  const loadSavedExperiences = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('saved_experiences')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchError) {
        throw fetchError;
      }

      setSavedExperiences(data?.map(item => ({
        ...item,
        status: item.status as 'saved' | 'accepted'
      })) || []);
    } catch (err) {
      console.error('Error loading saved experiences:', err);
      setError(err instanceof Error ? err.message : 'Failed to load saved experiences');
    } finally {
      setLoading(false);
    }
  };

  // Save a new experience
  const saveExperience = async (card: RecommendationCard): Promise<boolean> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({
          title: "Authentication required",
          description: "Please log in to save experiences",
          variant: "destructive"
        });
        return false;
      }

      // Check if already saved
      const { data: existing } = await supabase
        .from('saved_experiences')
        .select('id')
        .eq('card_id', card.id)
        .eq('user_id', user.id)
        .single();

      if (existing) {
        toast({
          title: "Already saved",
          description: `${card.title} is already in your saved experiences`,
          variant: "default"
        });
        return false;
      }

      const saveData = {
        user_id: user.id,
        card_id: card.id,
        title: card.title,
        subtitle: card.subtitle,
        category: card.category,
        price_level: card.priceLevel,
        estimated_cost_per_person: card.estimatedCostPerPerson,
        start_time: card.startTime,
        duration_minutes: card.durationMinutes,
        image_url: card.imageUrl,
        address: card.address,
        location_lat: card.location?.lat,
        location_lng: card.location?.lng,
        route_mode: card.route?.mode,
        eta_minutes: card.route?.etaMinutes,
        distance_text: card.route?.distanceText,
        maps_deep_link: card.route?.mapsDeepLink,
        source_provider: card.source?.provider,
        place_id: card.source?.placeId,
        event_id: card.source?.eventId,
        one_liner: card.copy?.oneLiner,
        tip: card.copy?.tip,
        rating: card.rating,
        review_count: card.reviewCount
      };

      const { error: insertError } = await supabase
        .from('saved_experiences')
        .insert([saveData]);

      if (insertError) {
        throw insertError;
      }

      toast({
        title: "Saved!",
        description: `${card.title} has been saved to your collection`
      });

      // Refresh the list
      await loadSavedExperiences();
      return true;
    } catch (err) {
      console.error('Error saving experience:', err);
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : 'Failed to save experience',
        variant: "destructive"
      });
      return false;
    }
  };

  // Update experience status
  const updateExperienceStatus = async (id: string, status: 'saved' | 'accepted', scheduledDate?: string): Promise<boolean> => {
    try {
      const updateData: any = { status };
      if (scheduledDate) {
        updateData.scheduled_date = scheduledDate;
      }

      const { error: updateError } = await supabase
        .from('saved_experiences')
        .update(updateData)
        .eq('id', id);

      if (updateError) {
        throw updateError;
      }

      toast({
        title: status === 'accepted' ? "Experience accepted!" : "Status updated",
        description: `Experience has been ${status === 'accepted' ? 'accepted and scheduled' : 'updated'}`
      });

      // Refresh the list
      await loadSavedExperiences();
      return true;
    } catch (err) {
      console.error('Error updating experience status:', err);
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : 'Failed to update experience',
        variant: "destructive"
      });
      return false;
    }
  };

  // Delete saved experience
  const deleteSavedExperience = async (id: string): Promise<boolean> => {
    try {
      const { error: deleteError } = await supabase
        .from('saved_experiences')
        .delete()
        .eq('id', id);

      if (deleteError) {
        throw deleteError;
      }

      toast({
        title: "Removed",
        description: "Experience has been removed from your saved collection"
      });

      // Refresh the list
      await loadSavedExperiences();
      return true;
    } catch (err) {
      console.error('Error deleting saved experience:', err);
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : 'Failed to remove experience',
        variant: "destructive"
      });
      return false;
    }
  };

  // Load data on mount
  useEffect(() => {
    loadSavedExperiences();
  }, []);

  const savedCount = savedExperiences.filter(exp => exp.status === 'saved').length;
  const acceptedCount = savedExperiences.filter(exp => exp.status === 'accepted').length;

  return {
    savedExperiences,
    loading,
    error,
    savedCount,
    acceptedCount,
    saveExperience,
    updateExperienceStatus,
    deleteSavedExperience,
    refreshSavedExperiences: loadSavedExperiences
  };
};