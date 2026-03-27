/**
 * Mock data for the interactive coach tour.
 * All IDs use 'tour-' prefix to prevent collision with real UUIDs.
 * All data satisfies the exact TypeScript interfaces used by consuming hooks.
 */
import type { QueryClient } from '@tanstack/react-query';
import type { Recommendation } from '../types/recommendation';
import type { NearbyPerson } from '../hooks/useNearbyPeople';
import type { MapSettings } from '../hooks/useMapSettings';
import type { PairingPill } from '../services/pairingService';
import { normalizeDateTime } from '../utils/cardConverters';

// ─── Tour Preferences (for hook interception, not cache seeded) ──────────────

export const TOUR_PREFERENCES = {
  profile_id: 'tour-user-self',
  mode: 'explore',
  budget_min: 0,
  budget_max: 100,
  people_count: 1,
  categories: ['Nature & Views', 'Casual Eats', 'Sip & Chill'],
  intents: ['adventurous', 'friendly'],
  travel_mode: 'walking',
  travel_constraint_type: 'time' as const,
  travel_constraint_value: 30,
  datetime_pref: new Date().toISOString(),
  date_option: 'today',
  time_slot: 'afternoon',
  exact_time: null as string | null,
  price_tiers: ['free', 'chill', 'comfy'],
  use_gps_location: true,
  custom_location: null as string | null,
};

// ─── Stop 0 — Deck Cards ────────────────────────────────────────────────────

export const TOUR_DECK_CARDS: Recommendation[] = [
  {
    id: 'tour-card-1',
    title: 'Primrose Hill Sunset Walk',
    category: 'Nature & Views',
    categoryIcon: 'tree',
    lat: 51.5394,
    lng: -0.1599,
    timeAway: '15 min',
    description: 'A scenic hilltop with panoramic views of the London skyline.',
    budget: '£0',
    rating: 4.7,
    image: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=600',
    images: ['https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=600'],
    priceRange: 'Free',
    distance: '2.1 km',
    travelTime: '15 min walk',
    experienceType: 'single',
    highlights: ['Panoramic skyline view', 'Sunset spot', 'Dog-friendly'],
    fullDescription: "One of London's best-kept secrets for sunset watching. The hill offers a 360-degree panoramic view of the city skyline.",
    address: "Primrose Hill, Regent's Park, London NW1 4NR",
    openingHours: { open_now: true, weekday_text: ['Open 24 hours'] },
    tags: ['nature', 'free', 'scenic'],
    matchScore: 92,
    reviewCount: 1847,
    website: null,
    phone: null,
    placeId: 'tour-place-1',
    priceTier: 'free',
    socialStats: { views: 340, likes: 89, saves: 45, shares: 12 },
    matchFactors: { location: 90, budget: 100, category: 95, time: 85, popularity: 88 },
    travelMode: 'walking',
    oneLiner: "London's best free sunset spot",
    tip: 'Arrive 30 minutes before sunset for the best spot on the hill.',
  },
  {
    id: 'tour-card-2',
    title: 'The Attendant, Fitzrovia',
    category: 'Sip & Chill',
    categoryIcon: 'coffee',
    lat: 51.5195,
    lng: -0.1392,
    timeAway: '8 min',
    description: 'A speciality coffee shop hidden inside a converted Victorian lavatory.',
    budget: '£8-15',
    rating: 4.5,
    image: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=600',
    images: ['https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=600'],
    priceRange: '£8-15',
    distance: '0.8 km',
    travelTime: '8 min walk',
    experienceType: 'single',
    highlights: ['Unique setting', 'Award-winning coffee', 'Brunch menu'],
    fullDescription: 'Converted from a Victorian underground lavatory, this coffee shop is one of the most unique spots in Fitzrovia.',
    address: '27A Foley St, London W1W 6DY',
    openingHours: { open_now: true, weekday_text: ['Mon-Fri: 8am-5pm'] },
    tags: ['coffee', 'brunch', 'unique'],
    matchScore: 87,
    reviewCount: 923,
    website: 'https://example.com',
    phone: null,
    placeId: 'tour-place-2',
    priceTier: 'chill',
    socialStats: { views: 210, likes: 67, saves: 34, shares: 8 },
    matchFactors: { location: 95, budget: 90, category: 85, time: 80, popularity: 82 },
    travelMode: 'walking',
    oneLiner: 'Coffee in a converted Victorian loo',
    tip: "Try the flat white with oat milk — their signature.",
  },
  {
    id: 'tour-card-3',
    title: "Dishoom, King's Cross",
    category: 'Casual Eats',
    categoryIcon: 'utensils',
    lat: 51.5352,
    lng: -0.1247,
    timeAway: '12 min',
    description: 'Bombay-inspired café serving beloved bacon naan rolls and black daal.',
    budget: '£15-30',
    rating: 4.6,
    image: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600',
    images: ['https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600'],
    priceRange: '£15-30',
    distance: '1.5 km',
    travelTime: '12 min walk',
    experienceType: 'single',
    highlights: ['Iconic bacon naan', 'No-reservation policy', 'Beautiful interiors'],
    fullDescription: 'Dishoom pays loving homage to the old Irani cafés of Bombay with its beautiful interiors and beloved menu.',
    address: '5 Stable St, London N1C 4AB',
    openingHours: { open_now: true, weekday_text: ['Mon-Sun: 8am-11pm'] },
    tags: ['indian', 'brunch', 'iconic'],
    matchScore: 94,
    reviewCount: 4521,
    website: 'https://example.com',
    phone: null,
    placeId: 'tour-place-3',
    priceTier: 'comfy',
    socialStats: { views: 890, likes: 234, saves: 156, shares: 45 },
    matchFactors: { location: 85, budget: 88, category: 92, time: 90, popularity: 95 },
    travelMode: 'walking',
    oneLiner: 'The bacon naan roll that launched a thousand queues',
    tip: "Go at 8am to skip the queue. Order the black daal — it's been cooking for 24 hours.",
  },
];

// ─── Stop 5 — Pairing Pills ─────────────────────────────────────────────────

export const TOUR_PAIRING_PILLS: PairingPill[] = [
  {
    id: 'tour-pairing-1',
    type: 'active',
    displayName: 'Sam Taylor',
    firstName: 'Sam',
    avatarUrl: null,
    initials: 'ST',
    pillState: 'active',
    statusMessage: null,
    pairedUserId: 'tour-paired-user-1',
    birthday: '1995-06-15',
    gender: 'male',
    pairingId: 'tour-pairing-id-1',
    pairRequestId: null,
    pendingInviteId: null,
    createdAt: new Date(Date.now() - 604800000).toISOString(),
  },
];

// ─── Stop 6 — Map Venues ────────────────────────────────────────────────────

const TOUR_EXTRA_VENUES: Recommendation[] = [
  {
    id: 'tour-map-venue-4',
    title: 'Sky Garden',
    category: 'Nature & Views',
    categoryIcon: 'tree',
    lat: 51.5113,
    lng: -0.0836,
    timeAway: '20 min',
    description: "London's highest public garden with free panoramic views.",
    budget: '£0',
    rating: 4.4,
    image: 'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=600',
    images: ['https://images.unsplash.com/photo-1486325212027-8081e485255e?w=600'],
    priceRange: 'Free',
    distance: '3.2 km',
    travelTime: '20 min walk',
    experienceType: 'single',
    highlights: ['Free entry', 'Panoramic views', 'Indoor garden'],
    fullDescription: 'A stunning garden space on top of 20 Fenchurch Street with 360-degree views of London.',
    address: '20 Fenchurch St, London EC3M 3BY',
    openingHours: { open_now: true, weekday_text: ['Mon-Sun: 10am-6pm'] },
    tags: ['nature', 'free', 'views'],
    matchScore: 88,
    reviewCount: 2103,
    website: 'https://example.com',
    phone: null,
    placeId: 'tour-place-4',
    priceTier: 'free',
    socialStats: { views: 450, likes: 120, saves: 78, shares: 22 },
    matchFactors: { location: 75, budget: 100, category: 90, time: 70, popularity: 85 },
    travelMode: 'walking',
    oneLiner: "London's highest free garden",
    tip: 'Book a free slot online — walk-ins only if space allows.',
  },
  {
    id: 'tour-map-venue-5',
    title: 'Borough Market',
    category: 'Casual Eats',
    categoryIcon: 'utensils',
    lat: 51.5055,
    lng: -0.091,
    timeAway: '25 min',
    description: "London's most famous food market with street food from around the world.",
    budget: '£5-20',
    rating: 4.6,
    image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600',
    images: ['https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600'],
    priceRange: '£5-20',
    distance: '3.8 km',
    travelTime: '25 min walk',
    experienceType: 'single',
    highlights: ['Street food', 'Artisan produce', 'Historic market'],
    fullDescription: 'One of the oldest and largest food markets in London, dating back to the 13th century.',
    address: '8 Southwark St, London SE1 1TL',
    openingHours: { open_now: true, weekday_text: ['Wed-Sat: 10am-5pm'] },
    tags: ['food', 'market', 'historic'],
    matchScore: 91,
    reviewCount: 5672,
    website: 'https://example.com',
    phone: null,
    placeId: 'tour-place-5',
    priceTier: 'chill',
    socialStats: { views: 780, likes: 198, saves: 134, shares: 38 },
    matchFactors: { location: 70, budget: 95, category: 88, time: 75, popularity: 92 },
    travelMode: 'walking',
    oneLiner: "London's most iconic food market",
    tip: 'Go hungry and try the raclette — you can smell it from three stalls away.',
  },
];

export const TOUR_MAP_VENUES: Recommendation[] = [...TOUR_DECK_CARDS, ...TOUR_EXTRA_VENUES];

// ─── Stop 6 — Nearby People ─────────────────────────────────────────────────

export const TOUR_NEARBY_PEOPLE: NearbyPerson[] = [
  {
    userId: 'tour-paired-user-1',
    displayName: 'Sam Taylor',
    firstName: 'Sam',
    avatarUrl: null,
    approximateLat: 51.522,
    approximateLng: -0.13,
    activityStatus: 'Looking for lunch',
    lastActiveAt: new Date(Date.now() - 300000).toISOString(),
    relationship: 'paired',
    tasteMatchPct: null,
    sharedCategories: [],
    sharedTiers: [],
    canSendFriendRequest: false,
    mapFriendRequestsRemaining: 0,
  },
  {
    userId: 'tour-friend-user-2',
    displayName: 'Jordan Lee',
    firstName: 'Jordan',
    avatarUrl: null,
    approximateLat: 51.518,
    approximateLng: -0.115,
    activityStatus: null,
    lastActiveAt: new Date(Date.now() - 900000).toISOString(),
    relationship: 'friend',
    tasteMatchPct: null,
    sharedCategories: [],
    sharedTiers: [],
    canSendFriendRequest: false,
    mapFriendRequestsRemaining: 0,
  },
  {
    userId: 'tour-stranger-user-3',
    displayName: 'Riley M.',
    firstName: 'Riley',
    avatarUrl: null,
    approximateLat: 51.525,
    approximateLng: -0.105,
    activityStatus: 'Exploring coffee shops',
    lastActiveAt: new Date(Date.now() - 60000).toISOString(),
    relationship: 'stranger',
    tasteMatchPct: 78,
    sharedCategories: ['Sip & Chill', 'Nature & Views'],
    sharedTiers: ['chill'],
    canSendFriendRequest: true,
    mapFriendRequestsRemaining: 3,
  },
];

// ─── Stop 6 — Map Settings ──────────────────────────────────────────────────

export const TOUR_MAP_SETTINGS: MapSettings = {
  visibility_level: 'everyone',
  show_saved_places: true,
  show_scheduled_places: true,
  activity_status: 'On a walking tour',
  discovery_radius_km: 15,
  time_delay_enabled: false,
  go_dark_until: null,
  activity_status_expires_at: null,
};

// ─── Stop 7 — Friends ───────────────────────────────────────────────────────

export const TOUR_FRIENDS = [
  {
    id: 'tour-friend-record-1',
    user_id: 'tour-user-self',
    friend_user_id: 'tour-friend-1',
    username: 'alexjohnson',
    display_name: 'Alex Johnson',
    first_name: 'Alex',
    last_name: 'Johnson',
    avatar_url: null,
    status: 'accepted' as const,
    created_at: new Date(Date.now() - 604800000).toISOString(),
  },
  {
    id: 'tour-friend-record-2',
    user_id: 'tour-user-self',
    friend_user_id: 'tour-friend-2',
    username: 'samtwrites',
    display_name: 'Sam Taylor',
    first_name: 'Sam',
    last_name: 'Taylor',
    avatar_url: null,
    status: 'accepted' as const,
    created_at: new Date(Date.now() - 1209600000).toISOString(),
  },
];

export const TOUR_FRIEND_REQUESTS = [
  {
    id: 'tour-fr-1',
    sender_id: 'tour-requester-1',
    receiver_id: 'tour-user-self',
    status: 'pending' as const,
    created_at: new Date(Date.now() - 3600000).toISOString(),
    type: 'incoming' as const,
    sender: {
      username: 'jordanlee',
      display_name: 'Jordan Lee',
      first_name: 'Jordan',
      last_name: 'Lee',
      avatar_url: null,
    },
  },
];

// ─── Stop 8 — Saved Cards ───────────────────────────────────────────────────

export const TOUR_SAVED_CARDS = [
  {
    id: 'tour-saved-1',
    card_id: 'tour-card-1',
    title: 'Primrose Hill Sunset Walk',
    category: 'Nature & Views',
    categoryIcon: 'tree',
    image: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=600',
    images: ['https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=600'],
    rating: 4.7,
    reviewCount: 1847,
    priceRange: 'Free',
    travelTime: '15 min walk',
    description: 'A scenic hilltop with panoramic views.',
    fullDescription: "One of London's best-kept secrets for sunset watching.",
    address: "Primrose Hill, Regent's Park, London NW1 4NR",
    highlights: ['Panoramic skyline view', 'Sunset spot'],
    matchScore: 92,
    socialStats: { views: 340, likes: 89, saves: 45, shares: 12 },
    source: 'solo',
    created_at: new Date(Date.now() - 172800000).toISOString(),
  },
  {
    id: 'tour-saved-2',
    card_id: 'tour-card-3',
    title: "Dishoom, King's Cross",
    category: 'Casual Eats',
    categoryIcon: 'utensils',
    image: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600',
    images: ['https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600'],
    rating: 4.6,
    reviewCount: 4521,
    priceRange: '£15-30',
    travelTime: '12 min walk',
    description: 'Bombay-inspired café.',
    fullDescription: 'Dishoom pays loving homage to the old Irani cafés of Bombay.',
    address: '5 Stable St, London N1C 4AB',
    highlights: ['Iconic bacon naan', 'Beautiful interiors'],
    matchScore: 94,
    socialStats: { views: 890, likes: 234, saves: 156, shares: 45 },
    source: 'solo',
    created_at: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'tour-saved-3',
    card_id: 'tour-card-2',
    title: 'The Attendant, Fitzrovia',
    category: 'Sip & Chill',
    categoryIcon: 'coffee',
    image: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=600',
    images: ['https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=600'],
    rating: 4.5,
    reviewCount: 923,
    priceRange: '£8-15',
    travelTime: '8 min walk',
    description: 'Speciality coffee in a converted Victorian lavatory.',
    fullDescription: 'Converted from a Victorian underground lavatory into a cosy coffee shop.',
    address: '27A Foley St, London W1W 6DY',
    highlights: ['Unique setting', 'Award-winning coffee'],
    matchScore: 87,
    socialStats: { views: 210, likes: 67, saves: 34, shares: 8 },
    source: 'collaboration',
    session_name: 'Weekend Plans',
    session_id: 'tour-session-1',
    created_at: new Date(Date.now() - 43200000).toISOString(),
  },
];

// ─── Stop 9 — Calendar Entries ───────────────────────────────────────────────

export const TOUR_CALENDAR_ENTRIES = [
  {
    id: 'tour-cal-1',
    user_id: 'tour-user-self',
    card_id: 'tour-card-3',
    board_card_id: null,
    source: 'solo' as const,
    card_data: {
      title: "Dishoom, King's Cross",
      category: 'Casual Eats',
      categoryIcon: 'utensils',
      image: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600',
      images: [],
      rating: 4.6,
      reviewCount: 4521,
      priceRange: '£15-30',
      description: 'Bombay-inspired café.',
      fullDescription: 'Dishoom pays loving homage to the old Irani cafés of Bombay.',
      address: '5 Stable St, London N1C 4AB',
      highlights: ['Iconic bacon naan'],
    },
    status: 'confirmed' as const,
    scheduled_at: new Date(Date.now() + 172800000).toISOString(),
    duration_minutes: 90,
    created_at: new Date(Date.now() - 86400000).toISOString(),
    updated_at: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'tour-cal-2',
    user_id: 'tour-user-self',
    card_id: 'tour-card-1',
    board_card_id: null,
    source: 'solo' as const,
    card_data: {
      title: 'Primrose Hill Sunset Walk',
      category: 'Nature & Views',
      categoryIcon: 'tree',
      image: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=600',
      images: [],
      rating: 4.7,
      reviewCount: 1847,
      priceRange: 'Free',
      description: 'A scenic hilltop.',
      fullDescription: "One of London's best-kept secrets.",
      address: "Primrose Hill, Regent's Park, London NW1 4NR",
      highlights: ['Panoramic skyline view'],
    },
    status: 'completed' as const,
    scheduled_at: new Date(Date.now() - 259200000).toISOString(),
    duration_minutes: 60,
    created_at: new Date(Date.now() - 345600000).toISOString(),
    updated_at: new Date(Date.now() - 259200000).toISOString(),
  },
];

// ─── Stop 10 — Profile Interests ─────────────────────────────────────────────

export const TOUR_PROFILE_INTERESTS = {
  intents: ['adventurous', 'friendly', 'romantic'],
  categories: ['Nature & Views', 'Casual Eats', 'Sip & Chill', 'Drink'],
};

// ─── Tour Sessions (for useSessionManagement interception) ───────────────────

export const TOUR_SESSIONS = [
  {
    id: 'tour-session-1',
    name: 'Weekend Plans',
    status: 'active',
    created_by: 'tour-user-self',
    board_id: 'tour-board-1',
    created_at: new Date(Date.now() - 86400000).toISOString(),
    updated_at: new Date(Date.now() - 3600000).toISOString(),
    participants: [
      { user_id: 'tour-user-self', has_accepted: true },
      { user_id: 'tour-friend-1', has_accepted: true },
    ],
  },
  {
    id: 'tour-session-2',
    name: 'Birthday Dinner',
    status: 'pending',
    created_by: 'tour-friend-1',
    board_id: null,
    created_at: new Date(Date.now() - 3600000).toISOString(),
    updated_at: new Date(Date.now() - 3600000).toISOString(),
    inviterProfile: {
      id: 'tour-friend-1',
      name: 'Alex Johnson',
      username: 'alexjohnson',
      avatar: null,
    },
    participants: [
      { user_id: 'tour-friend-1', has_accepted: true },
      { user_id: 'tour-user-self', has_accepted: false },
      { user_id: 'tour-friend-2', has_accepted: true },
    ],
  },
];

// ─── Collab Preferences (for tooltip display) ───────────────────────────────

export const TOUR_COLLAB_PREFS_MERGED = {
  categories: ['Nature & Views', 'Casual Eats', 'Sip & Chill', 'Drink'],
  intents: ['adventurous', 'romantic'],
  priceTiers: ['free', 'chill', 'comfy', 'fancy'],
  budgetMin: 0,
  budgetMax: 150,
  travelMode: 'transit',
  travelConstraintValue: 30,
};

// ─── Deck Cache Key Construction ─────────────────────────────────────────────
// Mirrors the exact key construction from useDeckCards.ts lines 92-109.

function buildDeckCacheKey(): readonly unknown[] {
  const prefs = TOUR_PREFERENCES;
  const roundedLat = 51.52; // London center rounded to 3 decimals
  const roundedLng = -0.13;
  return [
    'deck-cards',
    roundedLat,
    roundedLng,
    [...prefs.categories].sort().join(','),
    [...prefs.intents].sort().join(','),
    [...prefs.price_tiers].sort().join(','),
    prefs.budget_min,
    prefs.budget_max,
    prefs.travel_mode,
    prefs.travel_constraint_type,
    prefs.travel_constraint_value,
    prefs.datetime_pref ? normalizeDateTime(prefs.datetime_pref) : undefined,
    prefs.date_option ?? 'now',
    prefs.time_slot ?? '',
    prefs.exact_time ?? '',
    0, // batchSeed
  ] as const;
}

// ─── Keys that get seeded + cleaned up ───────────────────────────────────────

const TOUR_SEEDED_KEY_PREFIXES: readonly (readonly string[])[] = [
  ['deck-cards'],
  ['pairings', 'pills'],
  ['pairings', 'incoming'],
  ['map-cards-singles'],
  ['map-cards-curated'],
  ['nearby-people'],
  ['map-settings'],
  ['savedCards'],
  ['calendarEntries'],
  ['friends', 'list'],
  ['friends', 'requests'],
  ['profile-interests'],
];

// ─── Cache Seeding ───────────────────────────────────────────────────────────

export function seedTourData(queryClient: QueryClient, userId: string): void {
  const deckKey = buildDeckCacheKey();
  const locKey = '51.52.-0.13';

  // Deck cards
  queryClient.setQueryData(deckKey, {
    cards: TOUR_DECK_CARDS,
    deckMode: 'mixed',
    activePills: TOUR_PREFERENCES.categories,
    total: TOUR_DECK_CARDS.length,
    hasMore: false,
  });
  queryClient.setQueryDefaults(deckKey, { staleTime: Infinity, gcTime: Infinity });

  // Pairing pills
  const pillsKey = ['pairings', 'pills', userId] as const;
  queryClient.setQueryData(pillsKey, TOUR_PAIRING_PILLS);
  queryClient.setQueryDefaults(pillsKey, { staleTime: Infinity, gcTime: Infinity });

  // Incoming pair requests (empty)
  const incomingKey = ['pairings', 'incoming', userId] as const;
  queryClient.setQueryData(incomingKey, []);
  queryClient.setQueryDefaults(incomingKey, { staleTime: Infinity, gcTime: Infinity });

  // Map cards — singles
  const mapSinglesKey = ['map-cards-singles', locKey] as const;
  queryClient.setQueryData(mapSinglesKey, TOUR_MAP_VENUES);
  queryClient.setQueryDefaults(mapSinglesKey, { staleTime: Infinity, gcTime: Infinity });

  // Map cards — curated (empty)
  const mapCuratedKey = ['map-cards-curated', locKey] as const;
  queryClient.setQueryData(mapCuratedKey, []);
  queryClient.setQueryDefaults(mapCuratedKey, { staleTime: Infinity, gcTime: Infinity });

  // Nearby people
  const nearbyKey = ['nearby-people', '51.52', '-0.13', 15] as const;
  queryClient.setQueryData(nearbyKey, TOUR_NEARBY_PEOPLE);
  queryClient.setQueryDefaults(nearbyKey, { staleTime: Infinity, gcTime: Infinity });

  // Map settings
  const mapSettingsKey = ['map-settings', userId] as const;
  queryClient.setQueryData(mapSettingsKey, TOUR_MAP_SETTINGS);
  queryClient.setQueryDefaults(mapSettingsKey, { staleTime: Infinity, gcTime: Infinity });

  // Saved cards
  const savedKey = ['savedCards', 'list', userId] as const;
  queryClient.setQueryData(savedKey, TOUR_SAVED_CARDS);
  queryClient.setQueryDefaults(savedKey, { staleTime: Infinity, gcTime: Infinity });

  // Calendar entries
  const calKey = ['calendarEntries', userId] as const;
  queryClient.setQueryData(calKey, TOUR_CALENDAR_ENTRIES);
  queryClient.setQueryDefaults(calKey, { staleTime: Infinity, gcTime: Infinity });

  // Friends
  const friendsListKey = ['friends', 'list', userId] as const;
  queryClient.setQueryData(friendsListKey, TOUR_FRIENDS);
  queryClient.setQueryDefaults(friendsListKey, { staleTime: Infinity, gcTime: Infinity });

  const friendsReqKey = ['friends', 'requests', userId] as const;
  queryClient.setQueryData(friendsReqKey, TOUR_FRIEND_REQUESTS);
  queryClient.setQueryDefaults(friendsReqKey, { staleTime: Infinity, gcTime: Infinity });

  // Profile interests
  const interestsKey = ['profile-interests', userId] as const;
  queryClient.setQueryData(interestsKey, TOUR_PROFILE_INTERESTS);
  queryClient.setQueryDefaults(interestsKey, { staleTime: Infinity, gcTime: Infinity });
}

// ─── Cache Cleanup ───────────────────────────────────────────────────────────

export function clearTourData(queryClient: QueryClient): void {
  TOUR_SEEDED_KEY_PREFIXES.forEach((keyPrefix) => {
    // Remove data
    queryClient.removeQueries({ queryKey: keyPrefix as string[], exact: false });
    // Reset any query defaults we set
    queryClient.setQueryDefaults(keyPrefix as string[], {});
  });
}

// ─── Recovery (app kill mid-tour) ────────────────────────────────────────────

export function ensureTourDataSeeded(queryClient: QueryClient, userId: string): void {
  // Check if deck data exists — if not, re-seed everything
  const deckKey = buildDeckCacheKey();
  const existing = queryClient.getQueryData(deckKey);
  if (!existing) {
    seedTourData(queryClient, userId);
  }
}
