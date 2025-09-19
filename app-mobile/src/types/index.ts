export interface User {
  id: string;
  email: string;
  display_name?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
  currency?: string;
  measurement_system?: string;
  share_location?: boolean;
  share_budget?: boolean;
  share_categories?: boolean;
  share_date_time?: boolean;
  created_at: string;
}

export interface Preferences {
  profile_id: string;
  mode: string;
  budget_min: number;
  budget_max: number;
  people_count: number;
  categories: string[];
  travel_mode: string;
  travel_constraint_type: string;
  travel_constraint_value: number;
  datetime_pref: string;
  created_at: string;
  updated_at: string;
}

export interface Experience {
  id: string;
  title: string;
  description?: string;
  category: string;
  category_slug: string;
  place_id?: string;
  lat?: number;
  lng?: number;
  price_min: number;
  price_max: number;
  duration_min: number;
  image_url?: string;
  opening_hours?: any;
  meta?: any;
  created_at: string;
  updated_at: string;
}

export interface Save {
  profile_id: string;
  experience_id: string;
  status: string;
  scheduled_at?: string;
  created_at: string;
}

export interface CollaborationSession {
  id: string;
  name: string;
  created_by: string;
  board_id?: string;
  status: 'pending' | 'active' | 'dormant';
  created_at: string;
  updated_at: string;
}

export interface SessionParticipant {
  id: string;
  session_id: string;
  user_id: string;
  has_accepted: boolean;
  joined_at?: string;
  created_at: string;
}

export interface Board {
  id: string;
  name: string;
  description?: string;
  created_by: string;
  session_id?: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface BoardCollaborator {
  id: string;
  board_id: string;
  user_id: string;
  role: 'owner' | 'collaborator';
  created_at: string;
}

export interface CollaborationInvite {
  id: string;
  session_id: string;
  invited_by: string;
  invited_user_id: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  message?: string;
  created_at: string;
  updated_at: string;
}
