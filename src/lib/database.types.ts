export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      experiences: {
        Row: {
          id: string
          title: string
          category: string
          category_slug: string
          image_url: string | null
          price_min: number | null
          price_max: number | null
          duration_min: number | null
          lat: number | null
          lng: number | null
          place_id: string | null
          opening_hours: Json | null
          meta: Json | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          title: string
          category: string
          category_slug: string
          image_url?: string | null
          price_min?: number | null
          price_max?: number | null
          duration_min?: number | null
          lat?: number | null
          lng?: number | null
          place_id?: string | null
          opening_hours?: Json | null
          meta?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          title?: string
          category?: string
          category_slug?: string
          image_url?: string | null
          price_min?: number | null
          price_max?: number | null
          duration_min?: number | null
          lat?: number | null
          lng?: number | null
          place_id?: string | null
          opening_hours?: Json | null
          meta?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      preferences: {
        Row: {
          profile_id: string
          budget_min: number | null
          budget_max: number | null
          categories: string[] | null
          travel_mode: string | null
          travel_constraint_type: string | null
          travel_constraint_value: number | null
          people_count: number | null
          datetime_pref: string | null
          mode: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          profile_id: string
          budget_min?: number | null
          budget_max?: number | null
          categories?: string[] | null
          travel_mode?: string | null
          travel_constraint_type?: string | null
          travel_constraint_value?: number | null
          people_count?: number | null
          datetime_pref?: string | null
          mode?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          profile_id?: string
          budget_min?: number | null
          budget_max?: number | null
          categories?: string[] | null
          travel_mode?: string | null
          travel_constraint_type?: string | null
          travel_constraint_value?: number | null
          people_count?: number | null
          datetime_pref?: string | null
          mode?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          username: string
          first_name: string | null
          last_name: string | null
          currency: string | null
          measurement_system: string | null
          share_budget: boolean | null
          share_categories: boolean | null
          share_date_time: boolean | null
          share_location: boolean | null
          created_at: string
        }
        Insert: {
          id: string
          username: string
          first_name?: string | null
          last_name?: string | null
          currency?: string | null
          measurement_system?: string | null
          share_budget?: boolean | null
          share_categories?: boolean | null
          share_date_time?: boolean | null
          share_location?: boolean | null
          created_at?: string
        }
        Update: {
          id?: string
          username?: string
          first_name?: string | null
          last_name?: string | null
          currency?: string | null
          measurement_system?: string | null
          share_budget?: boolean | null
          share_categories?: boolean | null
          share_date_time?: boolean | null
          share_location?: boolean | null
          created_at?: string
        }
        Relationships: []
      }
      saves: {
        Row: {
          profile_id: string
          experience_id: string
          status: string | null
          scheduled_at: string | null
          created_at: string | null
        }
        Insert: {
          profile_id: string
          experience_id: string
          status?: string | null
          scheduled_at?: string | null
          created_at?: string | null
        }
        Update: {
          profile_id?: string
          experience_id?: string
          status?: string | null
          scheduled_at?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saves_experience_id_fkey"
            columns: ["experience_id"]
            referencedRelation: "experiences"
            referencedColumns: ["id"]
          }
        ]
      }
      calendar_events: {
        Row: {
          id: string
          profile_id: string
          experience_id: string | null
          scheduled_at: string
          status: string | null
          notes: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          profile_id: string
          experience_id?: string | null
          scheduled_at: string
          status?: string | null
          notes?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          profile_id?: string
          experience_id?: string | null
          scheduled_at?: string
          status?: string | null
          notes?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_experience_id_fkey"
            columns: ["experience_id"]
            referencedRelation: "experiences"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}