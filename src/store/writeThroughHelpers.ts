import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from './appStore';
import { toast } from '@/hooks/use-toast';

interface WriteOperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// Generic write-through helper
async function writeThrough<T>(
  optimisticUpdate: () => void,
  rollback: () => void,
  supabaseOperation: () => Promise<{ data?: T; error?: any }>
): Promise<WriteOperationResult<T>> {
  try {
    // 1. Optimistically update the store
    optimisticUpdate();

    // 2. Write to Supabase
    const { data, error } = await supabaseOperation();

    if (error) {
      // 3. Roll back on failure
      rollback();
      console.error('Supabase operation failed:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (error) {
    // Roll back on any error
    rollback();
    console.error('Write-through operation failed:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

// Specific write-through operations
export const writeThroughHelpers = {
  // Like/Save an experience
  async likeExperience(experienceId: string): Promise<WriteOperationResult> {
    const { user, saves, addSave, removeSave } = useAppStore.getState();
    
    if (!user) {
      return { success: false, error: 'User not authenticated' };
    }

    const existingSave = saves.find(save => save.experience_id === experienceId);
    const newSave = {
      profile_id: user.id,
      experience_id: experienceId,
      status: 'liked',
      created_at: new Date().toISOString()
    };

    return writeThrough(
      () => {
        if (existingSave) {
          removeSave(experienceId);
        } else {
          addSave(newSave);
        }
      },
      () => {
        if (existingSave) {
          addSave(existingSave);
        } else {
          removeSave(experienceId);
        }
      },
      async () => {
        if (existingSave) {
          return await supabase
            .from('saves')
            .delete()
            .eq('profile_id', user.id)
            .eq('experience_id', experienceId);
        } else {
          return await supabase
            .from('saves')
            .insert(newSave);
        }
      }
    );
  },

  // Schedule an experience
  async scheduleExperience(experienceId: string, scheduledAt: string): Promise<WriteOperationResult> {
    const { user, saves, updateSave } = useAppStore.getState();
    
    if (!user) {
      return { success: false, error: 'User not authenticated' };
    }

    const existingSave = saves.find(save => save.experience_id === experienceId);
    const oldScheduledAt = existingSave?.scheduled_at;

    return writeThrough(
      () => {
        if (existingSave) {
          updateSave(experienceId, { scheduled_at: scheduledAt, status: 'scheduled' });
        }
      },
      () => {
        if (existingSave && oldScheduledAt !== undefined) {
          updateSave(experienceId, { scheduled_at: oldScheduledAt, status: 'liked' });
        }
      },
      async () => {
        if (existingSave) {
          return await supabase
            .from('saves')
            .update({ scheduled_at: scheduledAt, status: 'scheduled' })
            .eq('profile_id', user.id)
            .eq('experience_id', experienceId);
        } else {
          // Create new save with schedule
          return await supabase
            .from('saves')
            .insert({
              profile_id: user.id,
              experience_id: experienceId,
              status: 'scheduled',
              scheduled_at: scheduledAt,
              created_at: new Date().toISOString()
            });
        }
      }
    );
  },

  // Update user preferences
  async updatePreferences(updates: Partial<{
    categories: string[];
    budget_min: number;
    budget_max: number;
    people_count: number;
    travel_mode: string;
    travel_constraint_type: string;
    travel_constraint_value: number;
    datetime_pref: string;
    mode: string;
  }>): Promise<WriteOperationResult> {
    const { user, preferences, setPreferences } = useAppStore.getState();
    
    if (!user) {
      return { success: false, error: 'User not authenticated' };
    }

    const oldPreferences = preferences;
    const newPreferences = preferences ? { ...preferences, ...updates } : null;

    return writeThrough(
      () => {
        if (newPreferences) {
          setPreferences(newPreferences);
        }
      },
      () => {
        setPreferences(oldPreferences);
      },
      async () => {
        if (preferences) {
          // Update existing preferences
          return await supabase
            .from('preferences')
            .update(updates)
            .eq('profile_id', user.id);
        } else {
          // Create new preferences
          return await supabase
            .from('preferences')
            .insert({
              profile_id: user.id,
              ...updates
            });
        }
      }
    );
  },

  // Update user profile
  async updateProfile(updates: Partial<{
    username: string;
    first_name: string;
    last_name: string;
    currency: string;
    measurement_system: string;
    share_budget: boolean;
    share_categories: boolean;
    share_date_time: boolean;
    share_location: boolean;
  }>): Promise<WriteOperationResult> {
    const { user, profile, setProfile } = useAppStore.getState();
    
    if (!user) {
      return { success: false, error: 'User not authenticated' };
    }

    const oldProfile = profile;
    const newProfile = profile ? { ...profile, ...updates } : null;

    return writeThrough(
      () => {
        if (newProfile) {
          setProfile(newProfile);
        }
      },
      () => {
        setProfile(oldProfile);
      },
      async () => {
        return await supabase
          .from('profiles')
          .update(updates)
          .eq('id', user.id);
      }
    );
  }
};

// Utility function to show toast notifications for write operations
export function handleWriteResult<T>(
  result: WriteOperationResult<T>,
  successMessage: string,
  errorMessage?: string
) {
  if (result.success) {
    toast({
      title: "Success",
      description: successMessage
    });
  } else {
    toast({
      title: "Error",
      description: errorMessage || result.error || "Operation failed",
      variant: "destructive"
    });
  }
  
  return result;
}