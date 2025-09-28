export interface User {
  id: string;
  email: string;
  display_name?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
  bio?: string;
  currency?: string;
  measurement_system?: string;
  share_location?: boolean;
  share_budget?: boolean;
  share_categories?: boolean;
  share_date_time?: boolean;
  visibility_mode?: 'public' | 'friends' | 'private';
  show_activity?: boolean;
  show_saved_experiences?: boolean;
  show_location?: boolean;
  show_preferences?: boolean;
  created_at: string;
}

// Lovable recommendation types
export interface RecommendationsRequest {
  budget: {
    min: number;
    max: number;
    perPerson: boolean;
  };
  categories: string[];
  experienceTypes?: string[];
  timeWindow: {
    kind: 'Now' | 'Tonight' | 'ThisWeekend' | 'Custom';
    start?: string | null;
    end?: string | null;
    timeOfDay?: string;
  };
  travel: {
    mode: 'WALKING' | 'DRIVING' | 'TRANSIT';
    constraint: {
      type: 'TIME' | 'DISTANCE';
      maxMinutes?: number;
      maxDistance?: number;
    };
  };
  origin: {
    lat: number;
    lng: number;
  };
  units: 'metric' | 'imperial';
}

export interface RecommendationCard {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  priceLevel: number;
  estimatedCostPerPerson: number | string;
  startTime: string;
  durationMinutes: number;
  imageUrl: string;
  address: string;
  location: {
    lat: number;
    lng: number;
  };
  route: {
    mode: 'WALKING' | 'DRIVING' | 'TRANSIT';
    etaMinutes: number;
    distanceText: string;
    mapsDeepLink: string;
  };
  source: {
    provider: 'google_places' | 'eventbrite';
    placeId?: string;
    eventId?: string;
  };
  copy: {
    oneLiner: string;
    tip: string;
  };
  actions: {
    invite: boolean;
    save: boolean;
    share: boolean;
  };
  rating?: number;
  reviewCount?: number;
  openingHours?: {
    isOpen: boolean;
    openNow: boolean;
    periods?: Array<{
      open: { day: number; time: string };
      close: { day: number; time: string };
    }>;
  };
}

export interface RecommendationsResponse {
  cards: RecommendationCard[];
  meta?: {
    totalResults: number;
    processingTimeMs: number;
    sources: {
      googlePlaces: number;
      eventbrite: number;
    };
    llmUsed: boolean;
  };
}

// Lovable session management types
export interface CollaborationSession {
  id: string;
  name: string;
  participants: Array<{
    id: string;
    name: string;
    username: string;
    avatar: string;
    hasAccepted: boolean;
  }>;
  createdAt: string;
  isActive: boolean;
  boardId?: string;
  status: 'pending' | 'active' | 'dormant';
  invitedBy: string;
  inviterProfile?: {
    id: string;
    name: string;
    username: string;
    avatar?: string;
  };
}

export interface SessionInvite {
  id: string;
  sessionId: string;
  sessionName: string;
  invitedBy: {
    id: string;
    name: string;
    username: string;
    avatar?: string;
  };
  message?: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  createdAt: string;
}

export interface SessionState {
  currentSession: CollaborationSession | null;
  availableSessions: CollaborationSession[];
  pendingInvites: SessionInvite[];
  isInSolo: boolean;
  loading: boolean;
}

// Preferences types for Lovable compatibility
export interface ActivePreferences {
  budgetRange: [number, number];
  categories: string[];
  experienceTypes: string[];
  time: string;
  travel: string;
  travelConstraint: 'time' | 'distance';
  travelTime: number;
  travelDistance: number;
  location: string;
  customLocation: string;
  custom_lat: number | null;
  custom_lng: number | null;
  groupSize: number;
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

// Enhanced Profile Features Types
export interface UserActivityHistory {
  id: string;
  user_id: string;
  activity_type: 'view' | 'like' | 'dislike' | 'save' | 'unsave' | 'share' | 'schedule' | 'unschedule' |
                'click_details' | 'swipe_left' | 'swipe_right' | 'tap' |
                'experience_saved' | 'experience_liked' | 'experience_disliked' | 
                'board_created' | 'board_shared' | 'collaboration_joined' |
                'place_visited' | 'recommendation_viewed' | 'session_created';
  activity_data: Record<string, any>;
  category?: string;
  location_context: Record<string, any>;
  created_at: string;
}

export interface UserStats {
  id: string;
  user_id: string;
  stat_type: string;
  stat_value: Record<string, any>;
  period_start: string;
  period_end: string;
  created_at: string;
  updated_at: string;
}

export interface UserVibes {
  id: string;
  user_id: string;
  category: string;
  percentage: number;
  activity_count: number;
  period_start: string;
  period_end: string;
  created_at: string;
  updated_at: string;
}

export interface SavedExperiencePrivacy {
  id: string;
  user_id: string;
  experience_id: string;
  is_public: boolean;
  visible_to_friends: boolean;
  show_in_activity: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserTimeline {
  id: string;
  user_id: string;
  event_type: 'first_experience' | 'milestone_reached' | 'category_master' | 
             'explorer_badge' | 'social_butterfly' | 'local_expert';
  event_data: Record<string, any>;
  badge_earned?: string;
  created_at: string;
}

export interface ProfileGamifiedData {
  monthlyStats: {
    totalExperiences: number;
    categoryBreakdown: Record<string, number>;
    placesVisited: number;
    collaborationsJoined: number;
  };
  vibes: UserVibes[];
  timeline: UserTimeline[];
  recentActivity: UserActivityHistory[];
  badges: string[];
  achievements: {
    totalExperiences: number;
    totalPlaces: number;
    totalCollaborations: number;
    streakDays: number;
    favoriteCategory: string;
  };
}
