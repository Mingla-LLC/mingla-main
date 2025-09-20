import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';
import type { RealtimeChannel } from '@supabase/supabase-js';

// Types for our store
interface Profile {
  id: string;
  username: string;
  first_name?: string;
  last_name?: string;
  currency?: string;
  measurement_system?: string;
  share_budget?: boolean;
  share_categories?: boolean;
  share_date_time?: boolean;
  share_location?: boolean;
}

interface Preferences {
  profile_id: string;
  categories: string[];
  budget_min: number;
  budget_max: number;
  people_count: number;
  travel_mode: string;
  travel_constraint_type: string;
  travel_constraint_value: number;
  datetime_pref: string;
  mode: string;
}

interface Save {
  profile_id: string;
  experience_id: string;
  status: string;
  scheduled_at?: string;
  created_at: string;
}

interface AppState {
  // Auth state
  user: User | null;
  session: Session | null;
  isAuthenticated: boolean;
  
  // User data
  profile: Profile | null;
  preferences: Preferences | null;
  saves: Save[];
  
  // Realtime subscriptions
  realtimeChannels: RealtimeChannel[];
  
  // Actions
  setAuth: (user: User | null, session: Session | null) => void;
  setProfile: (profile: Profile | null) => void;
  setPreferences: (preferences: Preferences | null) => void;
  setSaves: (saves: Save[]) => void;
  addSave: (save: Save) => void;
  removeSave: (experienceId: string) => void;
  updateSave: (experienceId: string, updates: Partial<Save>) => void;
  
  // Realtime management
  addRealtimeChannel: (channel: RealtimeChannel) => void;
  removeRealtimeChannel: (channel: RealtimeChannel) => void;
  clearRealtimeChannels: () => void;
  setupRealtimeSubscriptions: () => void;
  
  // Utilities
  rehydrateUserData: () => Promise<void>;
  clearUserData: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      session: null,
      isAuthenticated: false,
      profile: null,
      preferences: null,
      saves: [],
      realtimeChannels: [],

      // Auth actions
      setAuth: (user, session) => {
        set({ 
          user, 
          session, 
          isAuthenticated: !!user 
        });
        
        // Rehydrate user data when user logs in
        if (user) {
          get().rehydrateUserData();
        } else {
          get().clearUserData();
        }
      },

      // User data actions
      setProfile: (profile) => set({ profile }),
      setPreferences: (preferences) => set({ preferences }),
      setSaves: (saves) => set({ saves }),
      
      addSave: (save) => set((state) => ({
        saves: [...state.saves, save]
      })),
      
      removeSave: (experienceId) => set((state) => ({
        saves: state.saves.filter(save => save.experience_id !== experienceId)
      })),
      
      updateSave: (experienceId, updates) => set((state) => ({
        saves: state.saves.map(save => 
          save.experience_id === experienceId 
            ? { ...save, ...updates }
            : save
        )
      })),

      // Realtime management
      addRealtimeChannel: (channel) => set((state) => ({
        realtimeChannels: [...state.realtimeChannels, channel]
      })),
      
      removeRealtimeChannel: (channel) => set((state) => ({
        realtimeChannels: state.realtimeChannels.filter(c => c !== channel)
      })),
      
      clearRealtimeChannels: () => {
        const { realtimeChannels } = get();
        realtimeChannels.forEach(channel => {
          supabase.removeChannel(channel);
        });
        set({ realtimeChannels: [] });
      },

      // Data management
      rehydrateUserData: async () => {
        const { user } = get();
        if (!user) return;

        try {
          // Fetch profile
          const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

          if (profile) {
            set({ profile });
          }

          // Fetch preferences
          const { data: preferences } = await supabase
            .from('preferences')
            .select('*')
            .eq('profile_id', user.id)
            .single();

          if (preferences) {
            set({ preferences });
          }

          // Fetch saves
          const { data: saves } = await supabase
            .from('saves')
            .select('*')
            .eq('profile_id', user.id);

          if (saves) {
            set({ saves });
          }

          // Set up realtime subscriptions
          get().setupRealtimeSubscriptions();
        } catch (error) {
          console.error('Error rehydrating user data:', error);
        }
      },

      clearUserData: () => {
        get().clearRealtimeChannels();
        set({
          profile: null,
          preferences: null,
          saves: []
        });
      },

      // Setup realtime subscriptions
      setupRealtimeSubscriptions: () => {
        const { user, addRealtimeChannel } = get();
        if (!user) return;

        // Subscribe to saves changes
        const savesChannel = supabase
          .channel('saves-changes')
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'saves',
              filter: `profile_id=eq.${user.id}`
            },
            (payload) => {
              const { eventType, new: newRecord, old: oldRecord } = payload;
              
              if (eventType === 'INSERT' && newRecord) {
                get().addSave(newRecord as Save);
              } else if (eventType === 'DELETE' && oldRecord) {
                get().removeSave(oldRecord.experience_id);
              } else if (eventType === 'UPDATE' && newRecord) {
                get().updateSave(newRecord.experience_id, newRecord as Save);
              }
            }
          )
          .subscribe();

        addRealtimeChannel(savesChannel);

        // Subscribe to preferences changes
        const preferencesChannel = supabase
          .channel('preferences-changes')
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'preferences',
              filter: `profile_id=eq.${user.id}`
            },
            (payload) => {
              if (payload.new) {
                set({ preferences: payload.new as Preferences });
              }
            }
          )
          .subscribe();

        addRealtimeChannel(preferencesChannel);
      }
    }),
    {
      name: 'mingla:v1',
      storage: createJSONStorage(() => localStorage),
      // Only persist essential data, not realtime channels
      partialize: (state) => ({
        user: state.user,
        session: state.session,
        isAuthenticated: state.isAuthenticated,
        profile: state.profile,
        preferences: state.preferences,
        saves: state.saves
      })
    }
  )
);