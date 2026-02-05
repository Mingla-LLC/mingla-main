import { Coffee, TreePine, Utensils, Dumbbell, Eye, Palette, Heart, MapPin, Sun, Sparkles } from 'lucide-react';

interface MatchFactors {
  location: number;
  budget: number;
  category: number;
  time: number;
  popularity: number;
}

interface SocialStats {
  views: number;
  likes: number;
  saves: number;
  shares: number;
}

interface PurchaseOption {
  id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  includes: string[];
  duration?: string;
  popular?: boolean;
  savings?: string;
}

interface Recommendation {
  id: string;
  title: string;
  category: string;
  categoryIcon: React.ComponentType<{ className?: string }>;
  timeAway: string;
  description: string;
  budget: string;
  rating: number;
  image: string;
  images: string[];
  travelTime: string;
  distance: string;
  experienceType: string;
  priceRange: string;
  pricePerPerson?: number; // Average price per person for budget filtering
  highlights: string[];
  fullDescription: string;
  address: string;
  openingHours: string;
  phoneNumber?: string;
  website?: string;
  tags: string[];
  matchScore: number;
  matchFactors: MatchFactors;
  socialStats: SocialStats;
  reviewCount: number;
  purchaseOptions?: PurchaseOption[];
}

// 50 Mock Recommendations - 25 OLD (no purchase) + 25 NEW (with purchase)
export const allMockRecommendations: Recommendation[] = [
  // ============ OLD STYLE CARDS (25) - No purchase options ============
  {
    id: 'old-1',
    title: 'Dolores Park Picnic',
    category: 'stroll',
    categoryIcon: TreePine,
    timeAway: '8 min away',
    description: 'Perfect spot for outdoor relaxation and people watching',
    budget: 'Free activity within your budget',
    rating: 4.5,
    image: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx5b2dhJTIwY291cGxlcyUyMGNsYXNzJTIwbWVkaXRhdGlvbnxlbnwxfHx8fDE3NTkxNzMxMTB8MA&ixlib=rb-4.1.0&q=80&w=1080',
    images: [
      'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx5b2dhJTIwY291cGxlcyUyMGNsYXNzJTIwbWVkaXRhdGlvbnxlbnwxfHx8fDE3NTkxNzMxMTB8MA&ixlib=rb-4.1.0&q=80&w=1080',
      'https://images.unsplash.com/photo-1508797233014-6b8a1c9ded38?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwYXJrJTIwbGFrZSUyMHRyZWVzJTIwbmF0dXJlfGVufDF8fHx8MTc1OTE3MzA5Mnww&ixlib=rb-4.1.0&q=80&w=1080'
    ],
    travelTime: '8m',
    distance: '2.1 km',
    experienceType: 'soloAdventure',
    priceRange: 'Free',
    pricePerPerson: 0,
    highlights: ['City Views', 'Dog Friendly', 'Food Trucks', 'Live Music'],
    fullDescription: 'A beloved San Francisco park perfect for picnics, sports, and enjoying panoramic city views.',
    address: 'Dolores Park, San Francisco, CA 94114',
    openingHours: 'Daily 6am-10pm',
    tags: ['Park', 'Free', 'Outdoors', 'Social'],
    matchScore: 92,
    matchFactors: { location: 95, budget: 100, category: 88, time: 90, popularity: 87 },
    socialStats: { views: 1520, likes: 245, saves: 89, shares: 34 },
    reviewCount: 312
  },
  {
    id: 'old-2',
    title: 'Ferry Building Marketplace',
    category: 'freestyle',
    categoryIcon: MapPin,
    timeAway: '15 min away',
    description: 'Artisan food hall with local vendors and bay views',
    budget: 'Perfect for browsing and light snacks',
    rating: 4.3,
    image: 'https://images.unsplash.com/photo-1747503331142-27f458a1498c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxmYXJtZXJzJTIwbWFya2V0JTIwZnJlc2h8ZW58MXx8fHwxNzU5MzMwODQ1fDA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1747503331142-27f458a1498c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxmYXJtZXJzJTIwbWFya2V0JTIwZnJlc2h8ZW58MXx8fHwxNzU5MzMwODQ1fDA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '15m',
    distance: '4.5 km',
    experienceType: 'friendly',
    priceRange: '$10-30',
    pricePerPerson: 20,
    highlights: ['Local Vendors', 'Bay Views', 'Artisan Foods', 'Historic Building'],
    fullDescription: 'Historic ferry terminal turned gourmet marketplace featuring local artisans and spectacular bay views.',
    address: '1 Ferry Building, San Francisco, CA 94111',
    openingHours: 'Mon-Fri 10am-7pm, Sat 9am-8pm, Sun 11am-6pm',
    tags: ['Food', 'Market', 'Local', 'Historic'],
    matchScore: 85,
    matchFactors: { location: 88, budget: 90, category: 82, time: 85, popularity: 90 },
    socialStats: { views: 980, likes: 156, saves: 67, shares: 28 },
    reviewCount: 189
  },
  {
    id: 'old-3',
    title: 'Baker Beach Sunset',
    category: 'stroll',
    categoryIcon: TreePine,
    timeAway: '25 min away',
    description: 'Golden Gate Bridge views at sunset',
    budget: 'Free romantic sunset experience',
    rating: 4.8,
    image: 'https://images.unsplash.com/photo-1502045694088-dc8e4d0a7cf4?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxqYXBhbmVzZSUyMGdhcmRlbiUyMHBhcmslMjBwYXRofGVufDF8fHx8MTc1OTE3MzA4OXww&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1502045694088-dc8e4d0a7cf4?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxqYXBhbmVzZSUyMGdhcmRlbiUyMHBhcmslMjBwYXRofGVufDF8fHx8MTc1OTE3MzA4OXww&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '25m',
    distance: '8.2 km',
    experienceType: 'romantic',
    priceRange: 'Free',
    pricePerPerson: 0,
    highlights: ['Golden Gate Views', 'Sunset Photography', 'Beach Walk', 'Romantic Setting'],
    fullDescription: 'One of San Francisco\'s most beautiful beaches with iconic Golden Gate Bridge views.',
    address: 'Baker Beach, San Francisco, CA 94129',
    openingHours: 'Daily 24 hours',
    tags: ['Beach', 'Sunset', 'Photography', 'Free'],
    matchScore: 94,
    matchFactors: { location: 85, budget: 100, category: 95, time: 92, popularity: 98 },
    socialStats: { views: 2340, likes: 456, saves: 189, shares: 67 },
    reviewCount: 523
  },
  {
    id: 'old-4',
    title: 'Mission Dolores Park',
    category: 'freestyle',
    categoryIcon: Heart,
    timeAway: '10 min away',
    description: 'Community gathering spot with great energy',
    budget: 'Free hangout space',
    rating: 4.4,
    image: 'https://images.unsplash.com/photo-1739139106925-230659c867e0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxvdXRkb29yJTIwcGFyayUyMHdhbGtpbmclMjB0cmFpbHxlbnwxfHx8fDE3NTkxNzI1MTJ8MA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1739139106925-230659c867e0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxvdXRkb29yJTIwcGFyayUyMHdhbGtpbmclMjB0cmFpbHxlbnwxfHx8fDE3NTkxNzI1MTJ8MA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '10m',
    distance: '2.8 km',
    experienceType: 'groupFun',
    priceRange: 'Free',
    pricePerPerson: 0,
    highlights: ['Community Vibes', 'Dog Park', 'Tennis Courts', 'Playground'],
    fullDescription: 'Vibrant neighborhood park perfect for meeting locals and enjoying outdoor activities.',
    address: 'Mission Dolores Park, San Francisco, CA',
    openingHours: 'Daily 6am-10pm',
    tags: ['Community', 'Dogs', 'Sports', 'Family'],
    matchScore: 78,
    matchFactors: { location: 92, budget: 100, category: 75, time: 80, popularity: 65 },
    socialStats: { views: 1240, likes: 198, saves: 45, shares: 23 },
    reviewCount: 267
  },
  {
    id: 'old-5',
    title: 'Crissy Field Walking Path',
    category: 'stroll',
    categoryIcon: TreePine,
    timeAway: '20 min away',
    description: 'Flat waterfront walk with bridge views',
    budget: 'Free scenic walk',
    rating: 4.6,
    image: 'https://images.unsplash.com/photo-1508797233014-6b8a1c9ded38?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwYXJrJTIwbGFrZSUyMHRyZWVzJTIwbmF0dXJlfGVufDF8fHx8MTc1OTE3MzA5Mnww&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1508797233014-6b8a1c9ded38?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwYXJrJTIwbGFrZSUyMHRyZWVzJTIwbmF0dXJlfGVufDF8fHx8MTc1OTE3MzA5Mnww&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '20m',
    distance: '6.5 km',
    experienceType: 'Fitness',
    priceRange: 'Free',
    pricePerPerson: 0,
    highlights: ['Golden Gate Views', 'Flat Path', 'Dog Friendly', 'Picnic Areas'],
    fullDescription: 'Former airfield turned beautiful waterfront park with stunning Golden Gate Bridge views.',
    address: 'Crissy Field, San Francisco, CA 94129',
    openingHours: 'Daily 24 hours',
    tags: ['Walking', 'Views', 'Dogs', 'Exercise'],
    matchScore: 89,
    matchFactors: { location: 85, budget: 100, category: 90, time: 88, popularity: 82 },
    socialStats: { views: 1680, likes: 287, saves: 94, shares: 41 },
    reviewCount: 398
  },
  // Continue with 20 more OLD cards...
  {
    id: 'old-6',
    title: 'Union Square Shopping',
    category: 'freestyle',
    categoryIcon: Eye,
    timeAway: '12 min away',
    description: 'Central shopping district with people watching',
    budget: 'Window shopping or budget purchases',
    rating: 4.2,
    image: 'https://images.unsplash.com/photo-1758030306457-e54f25fe4384?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzdHJlZXQlMjBhcnQlMjBtdXJhbHxlbnwxfHx8fDE3NTkyODEzMTZ8MA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1758030306457-e54f25fe4384?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzdHJlZXQlMjBhcnQlMjBtdXJhbHxlbnwxfHx8fDE3NTkyODEzMTZ8MA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '12m',
    distance: '3.8 km',
    experienceType: 'friendly',
    priceRange: 'Free to browse',
    pricePerPerson: 0,
    highlights: ['Shopping', 'Street Performers', 'Cable Cars', 'Urban Energy'],
    fullDescription: 'Bustling downtown square perfect for shopping, dining, and experiencing city life.',
    address: 'Union Square, San Francisco, CA 94108',
    openingHours: 'Varies by store',
    tags: ['Shopping', 'Urban', 'Entertainment', 'Central'],
    matchScore: 76,
    matchFactors: { location: 90, budget: 85, category: 70, time: 75, popularity: 85 },
    socialStats: { views: 890, likes: 134, saves: 56, shares: 19 },
    reviewCount: 234
  },

  // ============ NEW STYLE CARDS WITH PURCHASE OPTIONS (25) ============
  // SIP & CHILL CATEGORY (5 cards) - PRODUCTION READY
  {
    id: 'new-1',
    title: 'Sightglass Coffee Roastery',
    category: 'sipChill',
    categoryIcon: Coffee,
    timeAway: '12 min away',
    description: 'Intimate coffee experience with artisan vibes',
    budget: 'Perfect for your $25-75 budget range',
    rating: 4.6,
    image: 'https://images.unsplash.com/photo-1642315160505-b3dff3a3c8b9?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjBzaG9wJTIwY296eSUyMGludGVyaW9yfGVufDF8fHx8MTc1OTExMDg1OHww&ixlib=rb-4.1.0&q=80&w=1080',
    images: [
      'https://images.unsplash.com/photo-1642315160505-b3dff3a3c8b9?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjBzaG9wJTIwY296eSUyMGludGVyaW9yfGVufDF8fHx8MTc1OTExMDg1OHww&ixlib=rb-4.1.0&q=80&w=1080',
      'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjBjdXAlMjBsYXR0ZSUyMGFydHxlbnwxfHx8fDE3NTkxNzMwNDJ8MA&ixlib=rb-4.1.0&q=80&w=1080'
    ],
    travelTime: '12m',
    distance: '3.2 km',
    experienceType: 'First Date',
    priceRange: '$15-40',
    pricePerPerson: 27,
    highlights: ['Single Origin Coffee', 'Local Pastries', 'Cozy Atmosphere', 'WiFi Available'],
    fullDescription: 'A specialty coffee roastery with a warm, industrial aesthetic. Watch baristas craft the perfect cup while enjoying locally sourced pastries.',
    address: '270 7th St, San Francisco, CA 94103',
    openingHours: 'Mon-Sun 7am-7pm',
    phoneNumber: '(415) 861-1313',
    tags: ['Coffee', 'Cozy', 'Local', 'Casual'],
    matchScore: 87,
    matchFactors: { location: 96, budget: 92, category: 88, time: 94, popularity: 85 },
    socialStats: { views: 923, likes: 167, saves: 45, shares: 23 },
    reviewCount: 89,
    // Sip & Chill Production Attributes
    sipChillData: {
      venueType: 'roastery',
      ambienceScore: {
        quietness: 75,
        coziness: 85,
        intimacy: 70,
        sophistication: 65,
        casualness: 80
      },
      conversationSuitability: 'excellent',
      seatingOptions: {
        hasIndoorSeating: true,
        hasOutdoorSeating: false,
        hasPrivateNooks: true,
        hasBarSeating: true,
        hasLounge: true,
        reservationRecommended: false
      },
      drinkFocus: {
        primary: ['Single-Origin Coffee', 'Espresso', 'Pour-Over'],
        specialties: ['Coffee Tasting Flight', 'Barista\'s Choice', 'Cold Brew'],
        hasFlights: true,
        hasPairings: true
      },
      foodLevel: 'small_bites',
      ambienceDetails: {
        lighting: 'soft',
        music: 'ambient',
        decor: 'Industrial-warm with exposed brick, wooden tables, and plants',
        crowdLevel: 'moderate'
      },
      weatherPreference: {
        idealForRain: true,
        idealForSunshine: false,
        seasonality: 'year-round'
      },
      experienceTypeFit: {
        firstDate: 90,
        romantic: 75,
        friendly: 85,
        soloAdventure: 80,
        business: 70
      },
      excludedIfAny: [],
      idealTimeOfDay: {
        morning: 95,
        afternoon: 80,
        evening: 60,
        lateNight: 20
      },
      typicalDuration: {
        min: 45,
        max: 120,
        average: 75
      },
      timelineSteps: [
        { step: 'Arrive', description: 'Settle in at Sightglass — best seats near the window overlooking the roasting room', duration: '5 min', icon: 'arrive' },
        { step: 'Order & Sip', description: 'Try their signature single-origin espresso or seasonal pour-over paired with a local pastry', duration: '40 min', icon: 'sip' },
        { step: 'Chill & Connect', description: 'Enjoy relaxed conversation with ambient music and the aroma of fresh-roasted beans', duration: '25 min', icon: 'chill' },
        { step: 'Wrap-Up', description: 'End your visit whenever you\'re ready—grab beans to take home or linger a bit longer', duration: '5 min', icon: 'wrapup' }
      ]
    },
    purchaseOptions: [
      {
        id: 'coffee-basic',
        title: 'Coffee & Pastry',
        description: 'Perfect for a casual coffee date',
        price: 18,
        currency: 'USD',
        includes: ['Two specialty drinks', 'Two pastries', 'Reserved seating'],
        duration: '1 hour'
      },
      {
        id: 'coffee-premium',
        title: 'Coffee Tasting Experience',
        description: 'Guided tasting with expert barista',
        price: 35,
        currency: 'USD',
        includes: ['Guided coffee tasting', 'Three drink samples', 'Two artisan pastries', 'Reserved corner table', 'Take-home coffee beans'],
        duration: '1.5 hours',
        popular: true
      },
      {
        id: 'coffee-deluxe',
        title: 'Private Coffee Experience',
        description: 'Exclusive behind-the-scenes experience',
        price: 65,
        currency: 'USD',
        includes: ['Private barista session', 'Behind-the-scenes tour', 'Custom coffee blend', 'Gourmet brunch plate', 'Private seating area', 'Coffee brewing lesson'],
        duration: '2 hours',
        savings: 'Best Value'
      }
    ]
  },
  {
    id: 'new-2',
    title: 'Blue Bottle Coffee Lab',
    category: 'sipChill',
    categoryIcon: Coffee,
    timeAway: '8 min away',
    description: 'Minimalist coffee experience with precision brewing',
    budget: 'Premium coffee experience',
    rating: 4.7,
    image: 'https://images.unsplash.com/photo-1559850719-c5042b99535c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjByb2FzdGVyeSUyMHRvdXJ8ZW58MXx8fHwxNzU5MzMxMTEzfDA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1559850719-c5042b99535c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjByb2FzdGVyeSUyMHRvdXJ8ZW58MXx8fHwxNzU5MzMxMTEzfDA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '8m',
    distance: '2.1 km',
    experienceType: 'friendly',
    priceRange: '$12-35',
    pricePerPerson: 24,
    highlights: ['Single-Origin Beans', 'Pour-Over Perfection', 'Minimalist Design', 'Local Roasting'],
    fullDescription: 'Precision coffee brewing in a beautifully designed space focused on the pure coffee experience.',
    address: '66 Mint St, San Francisco, CA 94103',
    openingHours: 'Mon-Sun 6:30am-7pm',
    phoneNumber: '(510) 653-3394',
    tags: ['Coffee', 'Minimal', 'Quality', 'Local'],
    matchScore: 91,
    matchFactors: { location: 98, budget: 88, category: 92, time: 95, popularity: 89 },
    socialStats: { views: 1456, likes: 234, saves: 78, shares: 32 },
    reviewCount: 187,
    purchaseOptions: [
      {
        id: 'blue-basic',
        title: 'Classic Pour-Over',
        description: 'Signature brewing method experience',
        price: 15,
        currency: 'USD',
        includes: ['Single-origin pour-over', 'Small pastry', 'Brewing explanation'],
        duration: '45 minutes'
      },
      {
        id: 'blue-cupping',
        title: 'Coffee Cupping Session',
        description: 'Professional coffee tasting',
        price: 28,
        currency: 'USD',
        includes: ['Guided cupping', 'Three coffee origins', 'Tasting notes', 'Coffee education'],
        duration: '1 hour',
        popular: true
      },
      {
        id: 'blue-masterclass',
        title: 'Brewing Masterclass',
        description: 'Learn professional brewing techniques',
        price: 55,
        currency: 'USD',
        includes: ['Hands-on brewing', 'Take-home beans', 'Equipment tutorial', 'Recipe cards', 'Coffee journal'],
        duration: '1.5 hours'
      }
    ]
  },
  {
    id: 'sip-wine-1',
    title: 'Velvet Wine Lounge',
    category: 'sipChill',
    categoryIcon: Coffee,
    timeAway: '15 min away',
    description: 'Elegant wine bar with curated flights and intimate ambience',
    budget: 'Upscale wine experience',
    rating: 4.8,
    image: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3aW5lJTIwYmFyJTIwY296eXxlbnwxfHx8fDE3NTkzMzExMTN8MA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3aW5lJTIwYmFyJTIwY296eXxlbnwxfHx8fDE3NTkzMzExMTN8MA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '15m',
    distance: '3.8 km',
    experienceType: 'romantic',
    priceRange: '$35-75',
    pricePerPerson: 55,
    highlights: ['Wine Flights', 'Candlelit Ambience', 'Cheese Pairings', 'Private Nooks'],
    fullDescription: 'A sophisticated wine lounge featuring curated selections from around the world, perfect for romantic evenings and meaningful conversations in an elegant setting.',
    address: '892 Valencia St, San Francisco, CA 94110',
    openingHours: 'Tue-Sun 5pm-12am',
    phoneNumber: '(415) 789-4567',
    tags: ['Wine', 'Romantic', 'Upscale', 'Intimate'],
    matchScore: 93,
    matchFactors: { location: 90, budget: 88, category: 95, time: 98, popularity: 91 },
    socialStats: { views: 1832, likes: 412, saves: 156, shares: 67 },
    reviewCount: 234,
    sipChillData: {
      venueType: 'wine_bar',
      ambienceScore: {
        quietness: 85,
        coziness: 90,
        intimacy: 95,
        sophistication: 92,
        casualness: 40
      },
      conversationSuitability: 'excellent',
      seatingOptions: {
        hasIndoorSeating: true,
        hasOutdoorSeating: false,
        hasPrivateNooks: true,
        hasBarSeating: true,
        hasLounge: true,
        reservationRecommended: true
      },
      drinkFocus: {
        primary: ['Red Wine', 'White Wine', 'Champagne'],
        specialties: ['Sommelier\'s Flight', 'Old World Collection', 'Natural Wines'],
        hasFlights: true,
        hasPairings: true
      },
      foodLevel: 'small_bites',
      ambienceDetails: {
        lighting: 'candle-lit',
        music: 'jazz',
        decor: 'Velvet seating, exposed brick, warm lighting, elegant bar',
        crowdLevel: 'intimate'
      },
      weatherPreference: {
        idealForRain: true,
        idealForSunshine: false,
        seasonality: 'year-round'
      },
      experienceTypeFit: {
        firstDate: 85,
        romantic: 98,
        friendly: 70,
        soloAdventure: 45,
        business: 60
      },
      excludedIfAny: [],
      idealTimeOfDay: {
        morning: 0,
        afternoon: 30,
        evening: 100,
        lateNight: 85
      },
      typicalDuration: {
        min: 60,
        max: 150,
        average: 90
      },
      timelineSteps: [
        { step: 'Arrive', description: 'Settle into a private nook with soft lighting and velvet seating', duration: '5 min', icon: 'arrive' },
        { step: 'Select Wine', description: 'Consult with the sommelier and choose a wine flight or bottle to share', duration: '15 min', icon: 'sip' },
        { step: 'Sip & Savor', description: 'Enjoy your wine selection with artisan cheese and charcuterie pairings', duration: '50 min', icon: 'enjoy' },
        { step: 'Chill', description: 'Relax with intimate conversation accompanied by live jazz in the background', duration: '20 min', icon: 'chill' },
        { step: 'Wrap-Up', description: 'End your evening when ready—perfect time for a nightcap or second bottle', duration: 'Flexible', icon: 'wrapup' }
      ]
    },
    purchaseOptions: [
      {
        id: 'wine-basic',
        title: 'Wine & Cheese',
        description: 'Classic pairing experience',
        price: 42,
        currency: 'USD',
        includes: ['Wine flight (3 selections)', 'Cheese & charcuterie plate', 'Reserved table'],
        duration: '1.5 hours'
      },
      {
        id: 'wine-premium',
        title: 'Sommelier\'s Selection',
        description: 'Curated tasting with expert guidance',
        price: 78,
        currency: 'USD',
        includes: ['Guided wine tasting', 'Five premium selections', 'Gourmet pairing plate', 'Private nook seating', 'Take-home wine notes'],
        duration: '2 hours',
        popular: true
      }
    ]
  },
  {
    id: 'sip-brewery-1',
    title: 'Anchor Steam Taproom',
    category: 'sipChill',
    categoryIcon: Coffee,
    timeAway: '20 min away',
    description: 'Historic brewery with craft beer flights and laid-back vibes',
    budget: 'Casual brewery experience',
    rating: 4.5,
    image: 'https://images.unsplash.com/photo-1532634922-8fe0b757fb13?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxicmV3ZXJ5JTIwdGFwcm9vbXxlbnwxfHx8fDE3NTkzMzExMTN8MA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1532634922-8fe0b757fb13?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxicmV3ZXJ5JTIwdGFwcm9vbXxlbnwxfHx8fDE3NTkzMzExMTN8MA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '20m',
    distance: '5.5 km',
    experienceType: 'friendly',
    priceRange: '$20-45',
    pricePerPerson: 32,
    highlights: ['Craft Beer Flights', 'Brewery Tours', 'Outdoor Patio', 'Local Snacks'],
    fullDescription: 'San Francisco\'s legendary brewery offering tastings of their iconic beers in a relaxed taproom setting with knowledgeable staff and brewery tours.',
    address: '1705 Mariposa St, San Francisco, CA 94107',
    openingHours: 'Mon-Sun 11am-10pm',
    phoneNumber: '(415) 863-8350',
    tags: ['Brewery', 'Craft Beer', 'Historic', 'Casual'],
    matchScore: 85,
    matchFactors: { location: 80, budget: 92, category: 88, time: 85, popularity: 82 },
    socialStats: { views: 2145, likes: 387, saves: 145, shares: 58 },
    reviewCount: 445,
    sipChillData: {
      venueType: 'brewery',
      ambienceScore: {
        quietness: 60,
        coziness: 70,
        intimacy: 55,
        sophistication: 50,
        casualness: 90
      },
      conversationSuitability: 'good',
      seatingOptions: {
        hasIndoorSeating: true,
        hasOutdoorSeating: true,
        hasPrivateNooks: false,
        hasBarSeating: true,
        hasLounge: true,
        reservationRecommended: false
      },
      drinkFocus: {
        primary: ['Craft Beer', 'IPA', 'Lager', 'Stout'],
        specialties: ['Anchor Steam Flight', 'Seasonal Brews', 'Limited Releases'],
        hasFlights: true,
        hasPairings: true
      },
      foodLevel: 'small_bites',
      ambienceDetails: {
        lighting: 'bright',
        music: 'curated_playlist',
        decor: 'Industrial brewery aesthetic with copper tanks, wooden tables, brick walls',
        crowdLevel: 'moderate'
      },
      weatherPreference: {
        idealForRain: false,
        idealForSunshine: true,
        seasonality: 'year-round'
      },
      experienceTypeFit: {
        firstDate: 65,
        romantic: 50,
        friendly: 95,
        soloAdventure: 70,
        business: 55
      },
      excludedIfAny: [],
      idealTimeOfDay: {
        morning: 0,
        afternoon: 75,
        evening: 95,
        lateNight: 70
      },
      typicalDuration: {
        min: 60,
        max: 180,
        average: 105
      },
      timelineSteps: [
        { step: 'Arrive', description: 'Check in at the historic taproom—grab seats at the bar or outdoor patio', duration: '5 min', icon: 'arrive' },
        { step: 'Order Flight', description: 'Try a beer flight featuring Anchor\'s signature brews and seasonal selections', duration: '10 min', icon: 'sip' },
        { step: 'Taste & Learn', description: 'Enjoy your beers while staff shares the history of SF\'s oldest craft brewery', duration: '45 min', icon: 'enjoy' },
        { step: 'Optional Tour', description: 'Take a quick brewery tour to see where the magic happens', duration: '20 min', icon: 'chill' },
        { step: 'Wrap-Up', description: 'Finish with your favorite pint and grab merch from the brewery shop', duration: 'Flexible', icon: 'wrapup' }
      ]
    },
    purchaseOptions: [
      {
        id: 'brewery-flight',
        title: 'Classic Tasting Flight',
        description: 'Sample Anchor\'s finest',
        price: 22,
        currency: 'USD',
        includes: ['Four beer tasting flight', 'Pretzel bites', 'Brewery history card'],
        duration: '1 hour'
      },
      {
        id: 'brewery-tour',
        title: 'Brewery Tour & Tasting',
        description: 'Behind-the-scenes experience',
        price: 35,
        currency: 'USD',
        includes: ['Guided brewery tour', 'Six beer tasting', 'Snack plate', 'Logo pint glass', 'Discount on purchases'],
        duration: '1.5 hours',
        popular: true
      }
    ]
  },
  {
    id: 'sip-teahouse-1',
    title: 'Red Blossom Tea Company',
    category: 'sipChill',
    categoryIcon: Coffee,
    timeAway: '18 min away',
    description: 'Serene tea house specializing in premium Chinese teas',
    budget: 'Tranquil tea experience',
    rating: 4.9,
    image: 'https://images.unsplash.com/photo-1594631661960-c87ba7d5b1e6?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx0ZWElMjBob3VzZSUyMHNlcmVuZXxlbnwxfHx8fDE3NTkzMzExMTN8MA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1594631661960-c87ba7d5b1e6?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx0ZWElMjBob3VzZSUyMHNlcmVuZXxlbnwxfHx8fDE3NTkzMzExMTN8MA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '18m',
    distance: '4.2 km',
    experienceType: 'soloAdventure',
    priceRange: '$18-40',
    pricePerPerson: 28,
    highlights: ['Premium Tea Selection', 'Traditional Ceremony', 'Zen Atmosphere', 'Meditation Space'],
    fullDescription: 'Experience the ancient art of tea in this tranquil Chinatown sanctuary featuring rare teas, traditional ceremonies, and a peaceful atmosphere perfect for mindful connection.',
    address: '831 Grant Ave, San Francisco, CA 94108',
    openingHours: 'Daily 10am-6pm',
    phoneNumber: '(415) 395-0868',
    tags: ['Tea', 'Zen', 'Traditional', 'Mindful'],
    matchScore: 89,
    matchFactors: { location: 88, budget: 90, category: 92, time: 89, popularity: 85 },
    socialStats: { views: 1234, likes: 289, saves: 112, shares: 45 },
    reviewCount: 178,
    sipChillData: {
      venueType: 'tea_house',
      ambienceScore: {
        quietness: 95,
        coziness: 85,
        intimacy: 80,
        sophistication: 88,
        casualness: 60
      },
      conversationSuitability: 'excellent',
      seatingOptions: {
        hasIndoorSeating: true,
        hasOutdoorSeating: false,
        hasPrivateNooks: true,
        hasBarSeating: false,
        hasLounge: true,
        reservationRecommended: true
      },
      drinkFocus: {
        primary: ['Oolong Tea', 'Pu-erh Tea', 'Green Tea', 'White Tea'],
        specialties: ['Gongfu Ceremony', 'Rare Vintage Teas', 'Seasonal Blends'],
        hasFlights: true,
        hasPairings: true
      },
      foodLevel: 'snacks',
      ambienceDetails: {
        lighting: 'soft',
        music: 'none',
        decor: 'Minimalist zen aesthetic with traditional Chinese elements, bamboo, natural materials',
        crowdLevel: 'intimate'
      },
      weatherPreference: {
        idealForRain: true,
        idealForSunshine: false,
        seasonality: 'year-round'
      },
      experienceTypeFit: {
        firstDate: 75,
        romantic: 70,
        friendly: 80,
        soloAdventure: 95,
        business: 65
      },
      excludedIfAny: [],
      idealTimeOfDay: {
        morning: 85,
        afternoon: 100,
        evening: 65,
        lateNight: 0
      },
      typicalDuration: {
        min: 45,
        max: 120,
        average: 70
      },
      timelineSteps: [
        { step: 'Arrive', description: 'Enter the serene tea house and choose a quiet corner or traditional tea table', duration: '5 min', icon: 'arrive' },
        { step: 'Select Tea', description: 'Consult with the tea specialist to choose from rare oolongs, pu-erhs, or seasonal blends', duration: '10 min', icon: 'sip' },
        { step: 'Tea Ceremony', description: 'Experience traditional gongfu tea preparation with multiple infusions', duration: '40 min', icon: 'enjoy' },
        { step: 'Mindful Sip', description: 'Savor each cup in peaceful silence or gentle conversation, noticing the evolving flavors', duration: '15 min', icon: 'chill' },
        { step: 'Wrap-Up', description: 'Leave feeling centered and calm—purchase tea leaves to recreate the experience at home', duration: 'Flexible', icon: 'wrapup' }
      ]
    },
    purchaseOptions: [
      {
        id: 'tea-basic',
        title: 'Tea Tasting',
        description: 'Sample premium teas',
        price: 20,
        currency: 'USD',
        includes: ['Three tea tasting', 'Traditional snacks', 'Tea education'],
        duration: '45 minutes'
      },
      {
        id: 'tea-ceremony',
        title: 'Gongfu Tea Ceremony',
        description: 'Traditional tea experience',
        price: 38,
        currency: 'USD',
        includes: ['Private ceremony', 'Rare tea selection', 'Multiple infusions', 'Sweet treats', 'Take-home tea sample'],
        duration: '1.5 hours',
        popular: true
      }
    ]
  },

  // SCREEN & RELAX CATEGORY (5 cards) - PRODUCTION READY
  {
    id: 'screen-indie-1',
    title: 'Roxie Theater – Indie Film Screening',
    category: 'screenRelax',
    categoryIcon: Eye,
    timeAway: '14 min away',
    description: 'Cozy indie cinema showcasing art house films and cult classics',
    budget: 'Affordable film night',
    rating: 4.7,
    image: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxpbmRpZSUyMGNpbmVtYSUyMHRoZWF0ZXJ8ZW58MXx8fHwxNzU5MzMxMTEzfDA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxpbmRpZSUyMGNpbmVtYSUyMHRoZWF0ZXJ8ZW58MXx8fHwxNzU5MzMxMTEzfDA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '14m',
    distance: '3.6 km',
    experienceType: 'friendly',
    priceRange: '$12-18',
    pricePerPerson: 15,
    highlights: ['Art House Films', 'Cozy Atmosphere', 'Film Discussion', 'Classic Snack Bar'],
    fullDescription: 'San Francisco\'s beloved independent cinema featuring carefully curated indie films, documentaries, and classic retrospectives in an intimate neighborhood setting.',
    address: '3117 16th St, San Francisco, CA 94103',
    openingHours: 'Daily 2PM-11PM',
    phoneNumber: '(415) 863-1087',
    tags: ['Indie', 'Cinema', 'Art House', 'Intimate'],
    matchScore: 88,
    matchFactors: { location: 92, budget: 95, category: 90, time: 85, popularity: 83 },
    socialStats: { views: 1567, likes: 298, saves: 134, shares: 56 },
    reviewCount: 412,
    screenRelaxData: {
      venueType: 'indie_cinema',
      entertainmentScore: {
        screenQuality: 75,
        soundQuality: 80,
        seatingComfort: 70,
        atmosphere: 90,
        varietyOffers: 85
      },
      showDetails: {
        currentShowing: 'International Film Festival Week',
        genres: ['indie', 'documentary', 'foreign', 'classic', 'art house'],
        showLength: 120,
        hasMatinee: true,
        hasEvening: true,
        hasLateNight: false
      },
      venueCharacteristics: {
        isIndoor: true,
        isOutdoor: false,
        hasReservedSeating: false,
        hasGeneralAdmission: true,
        requiresAdvanceBooking: false,
        allowsWalkIns: true
      },
      experienceTypeFit: {
        firstDate: 85,
        romantic: 70,
        friendly: 95,
        groupFun: 75,
        soloAdventure: 90,
        family: 60
      },
      amenities: {
        hasSnackBar: true,
        hasDining: false,
        hasBar: false,
        hasParking: false,
        wheelchairAccessible: true
      },
      priceStructure: {
        ticketType: 'standard',
        dynamicPricing: false,
        groupDiscounts: false
      },
      showtimeProximity: {
        morning: 0,
        afternoon: 75,
        evening: 100,
        lateNight: 60
      },
      weatherImpact: {
        indoorVenue: true,
        weatherAffectsExperience: false
      },
      socialDynamics: {
        conversationDuringShow: 'none',
        audienceInteraction: false,
        sharedExperience: 80
      },
      excludedIfAny: [],
      typicalDuration: {
        min: 120,
        max: 180,
        average: 150
      },
      timelineSteps: [
        { step: 'Arrive', description: 'Get to Roxie Theater 15 minutes early for optimal seating and snacks', duration: '15 min', icon: 'arrive' },
        { step: 'Settle In', description: 'Choose your seats and grab popcorn from the classic snack bar', duration: '10 min', icon: 'sip' },
        { step: 'Enjoy the Film', description: 'Watch tonight\'s indie screening in the intimate theater', duration: '2 hours', icon: 'enjoy' },
        { step: 'Wrap-Up', description: 'Discuss the film outside or head to a nearby café for coffee', duration: '15 min', icon: 'wrapup' }
      ]
    },
    purchaseOptions: [
      {
        id: 'roxie-single',
        title: 'Single Ticket',
        description: 'One admission to tonight\'s screening',
        price: 13,
        currency: 'USD',
        includes: ['One admission', 'Film program'],
        duration: '2.5 hours'
      },
      {
        id: 'roxie-couple',
        title: 'Date Night Package',
        description: 'Two tickets plus snacks',
        price: 32,
        currency: 'USD',
        includes: ['Two admissions', 'Large popcorn', 'Two drinks', 'Film program'],
        duration: '2.5 hours',
        popular: true
      }
    ]
  },
  {
    id: 'screen-comedy-1',
    title: 'Cobb\'s Comedy Club',
    category: 'screenRelax',
    categoryIcon: Eye,
    timeAway: '11 min away',
    description: 'Premier stand-up comedy club featuring national touring comedians',
    budget: 'Live comedy night',
    rating: 4.6,
    image: 'https://images.unsplash.com/photo-1585699324551-f6c309eedeca?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb21lZHklMjBjbHViJTIwc3RhbmR1cHxlbnwxfHx8fDE3NTkzMzExMTN8MA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1585699324551-f6c309eedeca?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb21lZHklMjBjbHViJTIwc3RhbmR1cHxlbnwxfHx8fDE3NTkzMzExMTN8MA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '11m',
    distance: '2.8 km',
    experienceType: 'friendly',
    priceRange: '$25-45',
    pricePerPerson: 35,
    highlights: ['National Headliners', 'Full Bar', 'Dinner Option', 'Laughter Guaranteed'],
    fullDescription: 'San Francisco\'s premier comedy destination hosting top touring comedians in an intimate club setting with full bar and dining.',
    address: '915 Columbus Ave, San Francisco, CA 94133',
    openingHours: 'Thu-Sun 7PM-11PM',
    phoneNumber: '(415) 928-4320',
    tags: ['Comedy', 'Stand-Up', 'Live Entertainment', 'Bar'],
    matchScore: 90,
    matchFactors: { location: 94, budget: 88, category: 92, time: 90, popularity: 88 },
    socialStats: { views: 2345, likes: 456, saves: 189, shares: 78 },
    reviewCount: 567,
    screenRelaxData: {
      venueType: 'comedy_club',
      entertainmentScore: {
        screenQuality: 0,
        soundQuality: 85,
        seatingComfort: 75,
        atmosphere: 95,
        varietyOffers: 80
      },
      showDetails: {
        currentShowing: 'Weekend Headliner Shows',
        genres: ['stand-up', 'improv', 'comedy'],
        showLength: 90,
        hasMatinee: false,
        hasEvening: true,
        hasLateNight: true
      },
      venueCharacteristics: {
        isIndoor: true,
        isOutdoor: false,
        hasReservedSeating: true,
        hasGeneralAdmission: false,
        requiresAdvanceBooking: true,
        allowsWalkIns: false
      },
      experienceTypeFit: {
        firstDate: 75,
        romantic: 60,
        friendly: 98,
        groupFun: 95,
        soloAdventure: 50,
        family: 40
      },
      amenities: {
        hasSnackBar: false,
        hasDining: true,
        hasBar: true,
        hasParking: true,
        wheelchairAccessible: true
      },
      priceStructure: {
        ticketType: 'reserved',
        dynamicPricing: true,
        groupDiscounts: true
      },
      showtimeProximity: {
        morning: 0,
        afternoon: 0,
        evening: 100,
        lateNight: 95
      },
      weatherImpact: {
        indoorVenue: true,
        weatherAffectsExperience: false
      },
      socialDynamics: {
        conversationDuringShow: 'minimal',
        audienceInteraction: true,
        sharedExperience: 95
      },
      excludedIfAny: [],
      typicalDuration: {
        min: 90,
        max: 150,
        average: 120
      },
      timelineSteps: [
        { step: 'Arrive', description: 'Check in at Cobb\'s 20 minutes before showtime for seating', duration: '20 min', icon: 'arrive' },
        { step: 'Order Drinks', description: 'Grab drinks from the bar and settle into your reserved table', duration: '10 min', icon: 'sip' },
        { step: 'Enjoy the Show', description: 'Laugh along with tonight\'s headliner and opening acts', duration: '90 min', icon: 'enjoy' },
        { step: 'Wrap-Up', description: 'Chat about your favorite jokes and head out when ready', duration: 'Flexible', icon: 'wrapup' }
      ]
    },
    purchaseOptions: [
      {
        id: 'cobb-standard',
        title: 'Standard Seating',
        description: 'General seating for the show',
        price: 28,
        currency: 'USD',
        includes: ['Show admission', 'Standard seating', 'Two-drink minimum'],
        duration: '2 hours'
      },
      {
        id: 'cobb-vip',
        title: 'VIP Front Row',
        description: 'Premium front row experience',
        price: 55,
        currency: 'USD',
        includes: ['Front row seating', 'Show admission', 'Appetizer plate', 'Two premium drinks'],
        duration: '2 hours',
        popular: true
      }
    ]
  },
  {
    id: 'screen-theater-1',
    title: 'Orpheum Theatre – Broadway Musical',
    category: 'screenRelax',
    categoryIcon: Eye,
    timeAway: '9 min away',
    description: 'Historic theater presenting Tony-award winning musicals',
    budget: 'Premium theater experience',
    rating: 4.9,
    image: 'https://images.unsplash.com/photo-1503095396549-807759245b35?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx0aGVhdGVyJTIwbXVzaWNhbCUyMHN0YWdlfGVufDF8fHx8MTc1OTMzMTExM3ww&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1503095396549-807759245b35?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx0aGVhdGVyJTIwbXVzaWNhbCUyMHN0YWdlfGVufDF8fHx8MTc1OTMzMTExM3ww&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '9m',
    distance: '2.2 km',
    experienceType: 'romantic',
    priceRange: '$75-200',
    pricePerPerson: 125,
    highlights: ['Broadway Shows', 'Historic Venue', 'World-Class Performers', 'Elegant Ambience'],
    fullDescription: 'Experience the magic of Broadway in San Francisco\'s grand 1920s theater, featuring touring productions of award-winning musicals.',
    address: '1192 Market St, San Francisco, CA 94102',
    openingHours: 'Show nights 7:30PM & 2PM matinees',
    phoneNumber: '(888) 746-1799',
    tags: ['Theater', 'Musical', 'Broadway', 'Elegant'],
    matchScore: 94,
    matchFactors: { location: 96, budget: 85, category: 98, time: 92, popularity: 95 },
    socialStats: { views: 3456, likes: 678, saves: 289, shares: 134 },
    reviewCount: 892,
    screenRelaxData: {
      venueType: 'theater',
      entertainmentScore: {
        screenQuality: 0,
        soundQuality: 98,
        seatingComfort: 90,
        atmosphere: 100,
        varietyOffers: 75
      },
      showDetails: {
        currentShowing: 'Hamilton - National Tour',
        genres: ['musical', 'broadway', 'theater'],
        showLength: 165,
        hasMatinee: true,
        hasEvening: true,
        hasLateNight: false
      },
      venueCharacteristics: {
        isIndoor: true,
        isOutdoor: false,
        hasReservedSeating: true,
        hasGeneralAdmission: false,
        requiresAdvanceBooking: true,
        allowsWalkIns: false
      },
      experienceTypeFit: {
        firstDate: 90,
        romantic: 98,
        friendly: 85,
        groupFun: 80,
        soloAdventure: 70,
        family: 95
      },
      amenities: {
        hasSnackBar: true,
        hasDining: false,
        hasBar: true,
        hasParking: true,
        wheelchairAccessible: true
      },
      priceStructure: {
        ticketType: 'premium',
        dynamicPricing: true,
        groupDiscounts: true
      },
      showtimeProximity: {
        morning: 0,
        afternoon: 80,
        evening: 100,
        lateNight: 0
      },
      weatherImpact: {
        indoorVenue: true,
        weatherAffectsExperience: false
      },
      socialDynamics: {
        conversationDuringShow: 'none',
        audienceInteraction: false,
        sharedExperience: 90
      },
      excludedIfAny: [],
      typicalDuration: {
        min: 165,
        max: 210,
        average: 180
      },
      timelineSteps: [
        { step: 'Arrive', description: 'Arrive at the historic Orpheum 30 minutes before curtain for the full experience', duration: '30 min', icon: 'arrive' },
        { step: 'Intermission', description: 'Enjoy intermission drinks and discuss the first act', duration: '15 min', icon: 'sip' },
        { step: 'The Show', description: 'Immerse yourself in a world-class Broadway musical performance', duration: '2.5 hours', icon: 'enjoy' },
        { step: 'Wrap-Up', description: 'Exit through the grand lobby and discuss the performance', duration: '15 min', icon: 'wrapup' }
      ]
    },
    purchaseOptions: [
      {
        id: 'orpheum-mezz',
        title: 'Mezzanine Seating',
        description: 'Great views from the mezzanine level',
        price: 95,
        currency: 'USD',
        includes: ['Reserved mezzanine seat', 'Playbill', 'Access to bar'],
        duration: '3 hours'
      },
      {
        id: 'orpheum-orchestra',
        title: 'Orchestra Premium',
        description: 'Best seats in the house',
        price: 175,
        currency: 'USD',
        includes: ['Premium orchestra seating', 'Playbill', 'VIP bar access', 'Commemorative program'],
        duration: '3 hours',
        popular: true
      }
    ]
  },
  {
    id: 'screen-drive-in-1',
    title: 'West Wind Drive-In – Double Feature',
    category: 'screenRelax',
    categoryIcon: Eye,
    timeAway: '35 min away',
    description: 'Classic drive-in theater with double features under the stars',
    budget: 'Nostalgic drive-in night',
    rating: 4.4,
    image: 'https://images.unsplash.com/photo-1598899134739-24c46f58b8c0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxkcml2ZSUyMGluJTIwbW92aWUlMjB0aGVhdGVyfGVufDF8fHx8MTc1OTMzMTExM3ww&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1598899134739-24c46f58b8c0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxkcml2ZSUyMGluJTIwbW92aWUlMjB0aGVhdGVyfGVufDF8fHx8MTc1OTMzMTExM3ww&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '35m',
    distance: '28.5 km',
    experienceType: 'romantic',
    priceRange: '$18-30',
    pricePerPerson: 12,
    highlights: ['Double Features', 'Outdoor Screening', 'Snack Bar', 'Retro Vibes'],
    fullDescription: 'Experience cinema under the stars at this classic drive-in theater featuring current releases in a nostalgic outdoor setting.',
    address: '1000 Carlson Blvd, Concord, CA 94518',
    openingHours: 'Fri-Sun, Gates open at dusk',
    phoneNumber: '(925) 686-5678',
    tags: ['Drive-In', 'Outdoor', 'Nostalgic', 'Double Feature'],
    matchScore: 82,
    matchFactors: { location: 70, budget: 98, category: 85, time: 88, popularity: 78 },
    socialStats: { views: 1876, likes: 345, saves: 156, shares: 67 },
    reviewCount: 289,
    screenRelaxData: {
      venueType: 'drive_in',
      entertainmentScore: {
        screenQuality: 65,
        soundQuality: 70,
        seatingComfort: 90,
        atmosphere: 95,
        varietyOffers: 80
      },
      showDetails: {
        currentShowing: 'Current Blockbusters - Double Feature',
        genres: ['action', 'comedy', 'family', 'blockbuster'],
        showLength: 240,
        hasMatinee: false,
        hasEvening: true,
        hasLateNight: true
      },
      venueCharacteristics: {
        isIndoor: false,
        isOutdoor: true,
        hasReservedSeating: false,
        hasGeneralAdmission: true,
        requiresAdvanceBooking: false,
        allowsWalkIns: true
      },
      experienceTypeFit: {
        firstDate: 88,
        romantic: 95,
        friendly: 85,
        groupFun: 90,
        soloAdventure: 40,
        family: 98
      },
      amenities: {
        hasSnackBar: true,
        hasDining: false,
        hasBar: false,
        hasParking: true,
        wheelchairAccessible: true
      },
      priceStructure: {
        ticketType: 'general_admission',
        dynamicPricing: false,
        groupDiscounts: false
      },
      showtimeProximity: {
        morning: 0,
        afternoon: 0,
        evening: 100,
        lateNight: 100
      },
      weatherImpact: {
        indoorVenue: false,
        weatherAffectsExperience: true,
        idealWeather: 'Clear skies, no rain'
      },
      socialDynamics: {
        conversationDuringShow: 'minimal',
        audienceInteraction: false,
        sharedExperience: 85
      },
      excludedIfAny: [],
      typicalDuration: {
        min: 240,
        max: 300,
        average: 270
      },
      timelineSteps: [
        { step: 'Arrive', description: 'Drive in and find your perfect spot before dusk', duration: '30 min', icon: 'arrive' },
        { step: 'Setup', description: 'Get cozy in your car with blankets, snacks, and tune to the radio frequency', duration: '15 min', icon: 'sip' },
        { step: 'Double Feature', description: 'Watch two current films under the stars with intermission', duration: '4 hours', icon: 'enjoy' },
        { step: 'Wrap-Up', description: 'Drive home reminiscing about the classic drive-in experience', duration: '35 min', icon: 'wrapup' }
      ]
    },
    purchaseOptions: [
      {
        id: 'drive-in-car',
        title: 'Per Car Admission',
        description: 'One car, unlimited passengers',
        price: 25,
        currency: 'USD',
        includes: ['Double feature screening', 'AM/FM radio frequency', 'Parking spot'],
        duration: '4.5 hours',
        popular: true
      }
    ]
  },
  {
    id: 'screen-imax-1',
    title: 'AMC Metreon IMAX',
    category: 'screenRelax',
    categoryIcon: Eye,
    timeAway: '8 min away',
    description: 'Premium IMAX theater with stunning visuals and immersive sound',
    budget: 'Premium cinema experience',
    rating: 4.5,
    image: 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxpbWF4JTIwdGhlYXRlciUyMHNjcmVlbnxlbnwxfHx8fDE3NTkzMzExMTN8MA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxpbWF4JTIwdGhlYXRlciUyMHNjcmVlbnxlbnwxfHx8fDE3NTkzMzExMTN8MA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '8m',
    distance: '2.0 km',
    experienceType: 'groupFun',
    priceRange: '$18-25',
    pricePerPerson: 22,
    highlights: ['IMAX Screen', 'Premium Sound', 'Reserved Seating', 'Latest Blockbusters'],
    fullDescription: 'Experience cinema at its finest with IMAX technology, premium reserved seating, and the latest blockbuster releases in downtown San Francisco.',
    address: '135 4th St, San Francisco, CA 94103',
    openingHours: 'Daily 10AM-12AM',
    phoneNumber: '(415) 369-6207',
    tags: ['IMAX', 'Premium', 'Blockbuster', 'Reserved Seating'],
    matchScore: 91,
    matchFactors: { location: 96, budget: 88, category: 93, time: 90, popularity: 92 },
    socialStats: { views: 2789, likes: 512, saves: 234, shares: 98 },
    reviewCount: 1245,
    screenRelaxData: {
      venueType: 'movie_theater',
      entertainmentScore: {
        screenQuality: 100,
        soundQuality: 100,
        seatingComfort: 95,
        atmosphere: 85,
        varietyOffers: 90
      },
      showDetails: {
        currentShowing: 'Latest Blockbusters in IMAX',
        genres: ['action', 'sci-fi', 'adventure', 'blockbuster', 'superhero'],
        showLength: 150,
        hasMatinee: true,
        hasEvening: true,
        hasLateNight: true
      },
      venueCharacteristics: {
        isIndoor: true,
        isOutdoor: false,
        hasReservedSeating: true,
        hasGeneralAdmission: false,
        requiresAdvanceBooking: true,
        allowsWalkIns: true
      },
      experienceTypeFit: {
        firstDate: 80,
        romantic: 70,
        friendly: 90,
        groupFun: 98,
        soloAdventure: 75,
        family: 95
      },
      amenities: {
        hasSnackBar: true,
        hasDining: true,
        hasBar: true,
        hasParking: true,
        wheelchairAccessible: true
      },
      priceStructure: {
        ticketType: 'premium',
        dynamicPricing: true,
        groupDiscounts: true
      },
      showtimeProximity: {
        morning: 60,
        afternoon: 85,
        evening: 100,
        lateNight: 95
      },
      weatherImpact: {
        indoorVenue: true,
        weatherAffectsExperience: false
      },
      socialDynamics: {
        conversationDuringShow: 'none',
        audienceInteraction: false,
        sharedExperience: 85
      },
      excludedIfAny: [],
      typicalDuration: {
        min: 150,
        max: 210,
        average: 180
      },
      timelineSteps: [
        { step: 'Arrive', description: 'Get to AMC Metreon 20 minutes before showtime', duration: '20 min', icon: 'arrive' },
        { step: 'Concessions', description: 'Grab premium snacks and find your reserved IMAX seats', duration: '10 min', icon: 'sip' },
        { step: 'The Movie', description: 'Experience the latest blockbuster in stunning IMAX quality', duration: '2.5 hours', icon: 'enjoy' },
        { step: 'Wrap-Up', description: 'Exit and discuss the film - nearby restaurants for post-movie dining', duration: '10 min', icon: 'wrapup' }
      ]
    },
    purchaseOptions: [
      {
        id: 'imax-standard',
        title: 'IMAX Standard',
        description: 'Premium IMAX experience',
        price: 22,
        currency: 'USD',
        includes: ['IMAX screening', 'Reserved seating'],
        duration: '3 hours'
      },
      {
        id: 'imax-dolby',
        title: 'Dolby Cinema',
        description: 'Ultimate premium experience',
        price: 28,
        currency: 'USD',
        includes: ['Dolby Cinema screening', 'Premium recliner seating', 'Reserved spot'],
        duration: '3 hours',
        popular: true
      }
    ]
  },

  // CREATIVE & HANDS-ON CATEGORY (5 cards)
  {
    id: 'new-3',
    title: 'Pottery Studio Workshop',
    category: 'creative',
    categoryIcon: Palette,
    timeAway: '18 min away',
    description: 'Create beautiful ceramics with expert guidance',
    budget: 'Creative experience within budget',
    rating: 4.8,
    image: 'https://images.unsplash.com/photo-1676125105332-608345abe20e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwb3R0ZXJ5JTIwY2xhc3MlMjBzdHVkaW98ZW58MXx8fHwxNzU5MzMxMTExfDA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1676125105332-608345abe20e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwb3R0ZXJ5JTIwY2xhc3MlMjBzdHVkaW98ZW58MXx8fHwxNzU5MzMxMTExfDA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '18m',
    distance: '5.2 km',
    experienceType: 'Creative',
    priceRange: '$45-85',
    pricePerPerson: 65,
    highlights: ['Wheel Throwing', 'Glazing Options', 'Take Home Pieces', 'Expert Instruction'],
    fullDescription: 'Learn the ancient art of pottery in a welcoming studio environment with professional ceramicists.',
    address: '456 Clay St, Arts District, SF',
    openingHours: 'Tue-Sun 10am-8pm',
    phoneNumber: '(415) 567-8901',
    tags: ['Pottery', 'Art', 'Handmade', 'Creative'],
    matchScore: 86,
    matchFactors: { location: 82, budget: 85, category: 95, time: 88, popularity: 80 },
    socialStats: { views: 1023, likes: 189, saves: 67, shares: 29 },
    reviewCount: 145,
    purchaseOptions: [
      {
        id: 'pottery-intro',
        title: 'Intro to Pottery',
        description: 'Perfect for beginners',
        price: 45,
        currency: 'USD',
        includes: ['2-hour class', 'Clay & tools', 'One finished piece', 'Basic glazing'],
        duration: '2 hours'
      },
      {
        id: 'pottery-wheel',
        title: 'Wheel Throwing Class',
        description: 'Learn to use the pottery wheel',
        price: 65,
        currency: 'USD',
        includes: ['3-hour session', 'Wheel instruction', 'Multiple attempts', 'Professional guidance', 'Take home 2 pieces'],
        duration: '3 hours',
        popular: true
      },
      {
        id: 'pottery-intensive',
        title: 'Full Day Pottery',
        description: 'Comprehensive pottery experience',
        price: 120,
        currency: 'USD',
        includes: ['6-hour workshop', 'Multiple techniques', '4 finished pieces', 'Lunch included', 'Advanced glazing'],
        duration: '6 hours'
      }
    ],
    creativeHandsOnData: {
      workshopType: 'pottery',
      activityScore: {
        handsOnLevel: 100,
        skillBuilding: 90,
        creativeFreedom: 85,
        socialInteraction: 70,
        takeHomeValue: 95
      },
      workshopDetails: {
        currentOffering: 'Wheel Throwing & Hand Building',
        skillLevel: 'all-levels',
        maxParticipants: 8,
        materialsIncluded: true,
        materialsProvided: ['Clay', 'Pottery wheel', 'Hand tools', 'Glazes', 'Kiln firing'],
        duration: 180,
        hasInstructor: true,
        instructorStyle: 'guided'
      },
      venueCharacteristics: {
        isIndoor: true,
        hasStudio: true,
        hasWorkstations: true,
        requiresReservation: true,
        allowsWalkIns: false,
        allowsGroups: true
      },
      experienceTypeFit: {
        firstDate: 90,
        romantic: 85,
        friendly: 95,
        groupFun: 88,
        soloAdventure: 80,
        family: 75
      },
      amenities: {
        hasRefreshments: true,
        hasSnacks: true,
        hasDrinks: true,
        hasStorage: true,
        hasParking: true,
        wheelchairAccessible: true,
        provideAprons: true
      },
      priceStructure: {
        sessionType: 'per-person',
        includesMaterials: true,
        includesTool: true,
        takeHomePiece: true,
        groupDiscounts: true
      },
      timeAlignment: {
        morning: 70,
        afternoon: 90,
        evening: 85,
        weekend: 100
      },
      weatherImpact: {
        indoorVenue: true,
        weatherAffectsExperience: false
      },
      socialDynamics: {
        conversationFriendly: true,
        encouragesCollaboration: true,
        soloFriendly: true,
        pairFriendly: true,
        groupFriendly: true
      },
      activityComfort: {
        physicalDemand: 'medium',
        messiness: 'somewhat-messy',
        concentration: 'moderate'
      },
      excludedIfAny: [],
      typicalDuration: {
        min: 120,
        max: 360,
        average: 180
      },
      timelineSteps: [
        { step: 'Arrive', description: 'Check in and get your apron, tools, and clay ready at your workstation', duration: '15 min', icon: 'arrive' },
        { step: 'Learn', description: 'Instructor demonstrates wheel throwing techniques and hand building basics', duration: '30 min', icon: 'sip' },
        { step: 'Create', description: 'Get hands-on creating your own pottery pieces with guidance', duration: '2 hours', icon: 'enjoy' },
        { step: 'Glaze & Finish', description: 'Choose glazes for your pieces and arrange pickup after kiln firing', duration: '15 min', icon: 'wrapup' }
      ]
    }
  },
  {
    id: 'creative-paint-1',
    title: 'Sip & Paint Canvas Studio',
    category: 'creative',
    categoryIcon: Palette,
    timeAway: '12 min away',
    description: 'Guided painting class with wine and creative vibes',
    budget: 'Fun creative night within budget',
    rating: 4.7,
    image: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwYWludCUyMGNsYXNzJTIwY2FudmFzfGVufDF8fHx8MTc1OTMzMTExM3ww&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwYWludCUyMGNsYXNzJTIwY2FudmFzfGVufDF8fHx8MTc1OTMzMTExM3ww&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '12m',
    distance: '3.2 km',
    experienceType: 'friendly',
    priceRange: '$35-55',
    pricePerPerson: 45,
    highlights: ['Wine & Snacks', 'All Materials Included', 'Take Home Canvas', 'No Experience Needed'],
    fullDescription: 'Unleash your inner artist in this relaxed painting class. Sip wine, follow step-by-step guidance, and take home your masterpiece!',
    address: '789 Canvas Ave, Arts District, SF',
    openingHours: 'Thu-Sun 6PM-9PM',
    phoneNumber: '(415) 234-5678',
    tags: ['Painting', 'Social', 'Wine', 'Beginner-Friendly'],
    matchScore: 92,
    matchFactors: { location: 94, budget: 90, category: 95, time: 92, popularity: 89 },
    socialStats: { views: 2345, likes: 456, saves: 189, shares: 78 },
    reviewCount: 312,
    purchaseOptions: [
      {
        id: 'paint-standard',
        title: 'Sip & Paint Session',
        description: 'Complete painting experience',
        price: 45,
        currency: 'USD',
        includes: ['2-hour class', 'Canvas & paints', 'Wine & snacks', 'Step-by-step guidance', 'Apron provided'],
        duration: '2 hours',
        popular: true
      },
      {
        id: 'paint-premium',
        title: 'Premium Paint Night',
        description: 'Enhanced experience with larger canvas',
        price: 65,
        currency: 'USD',
        includes: ['2.5-hour class', 'Large canvas', 'Premium paints', 'Wine & cheese plate', 'Private instruction', 'Professional framing option'],
        duration: '2.5 hours'
      }
    ],
    creativeHandsOnData: {
      workshopType: 'painting',
      activityScore: {
        handsOnLevel: 95,
        skillBuilding: 75,
        creativeFreedom: 90,
        socialInteraction: 95,
        takeHomeValue: 85
      },
      workshopDetails: {
        currentOffering: 'Guided Canvas Painting',
        skillLevel: 'all-levels',
        maxParticipants: 20,
        materialsIncluded: true,
        materialsProvided: ['Canvas', 'Acrylic paints', 'Brushes', 'Palette', 'Apron', 'Easel'],
        duration: 120,
        hasInstructor: true,
        instructorStyle: 'demonstration'
      },
      venueCharacteristics: {
        isIndoor: true,
        hasStudio: true,
        hasWorkstations: true,
        requiresReservation: true,
        allowsWalkIns: false,
        allowsGroups: true
      },
      experienceTypeFit: {
        firstDate: 95,
        romantic: 88,
        friendly: 100,
        groupFun: 98,
        soloAdventure: 70,
        family: 85
      },
      amenities: {
        hasRefreshments: true,
        hasSnacks: true,
        hasDrinks: true,
        hasStorage: false,
        hasParking: true,
        wheelchairAccessible: true,
        provideAprons: true
      },
      priceStructure: {
        sessionType: 'per-person',
        includesMaterials: true,
        includesTool: true,
        takeHomePiece: true,
        groupDiscounts: true
      },
      timeAlignment: {
        morning: 40,
        afternoon: 60,
        evening: 100,
        weekend: 95
      },
      weatherImpact: {
        indoorVenue: true,
        weatherAffectsExperience: false
      },
      socialDynamics: {
        conversationFriendly: true,
        encouragesCollaboration: true,
        soloFriendly: true,
        pairFriendly: true,
        groupFriendly: true
      },
      activityComfort: {
        physicalDemand: 'low',
        messiness: 'somewhat-messy',
        concentration: 'relaxed'
      },
      excludedIfAny: [],
      typicalDuration: {
        min: 120,
        max: 150,
        average: 120
      },
      timelineSteps: [
        { step: 'Arrive', description: 'Check in, grab a glass of wine, and find your easel', duration: '10 min', icon: 'arrive' },
        { step: 'Setup', description: 'Get your canvas, paints, and apron ready while mingling', duration: '10 min', icon: 'sip' },
        { step: 'Paint', description: 'Follow the instructor step-by-step to create your masterpiece', duration: '90 min', icon: 'enjoy' },
        { step: 'Finish', description: 'Final touches, take photos with your art, and take it home!', duration: '10 min', icon: 'wrapup' }
      ]
    }
  },
  {
    id: 'creative-cooking-1',
    title: 'Italian Pasta Making Class',
    category: 'creative',
    categoryIcon: Palette,
    timeAway: '16 min away',
    description: 'Learn to make fresh pasta from scratch with a master chef',
    budget: 'Delicious hands-on experience',
    rating: 4.9,
    image: 'https://images.unsplash.com/photo-1556910103-1c02745aae4d?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb29raW5nJTIwY2xhc3MlMjBwYXN0YXxlbnwxfHx8fDE3NTkzMzExMTN8MA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1556910103-1c02745aae4d?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb29raW5nJTIwY2xhc3MlMjBwYXN0YXxlbnwxfHx8fDE3NTkzMzExMTN8MA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '16m',
    distance: '4.5 km',
    experienceType: 'friendly',
    priceRange: '$65-95',
    pricePerPerson: 80,
    highlights: ['Fresh Pasta Techniques', 'Homemade Sauces', 'Eat What You Make', 'Recipe Cards'],
    fullDescription: 'Master the art of Italian pasta making in this hands-on cooking class. Learn traditional techniques and enjoy your delicious creations!',
    address: '234 Culinary Way, Mission District, SF',
    openingHours: 'Tue-Sun 11AM, 3PM, 6PM',
    phoneNumber: '(415) 345-6789',
    tags: ['Cooking', 'Italian', 'Pasta', 'Hands-On'],
    matchScore: 94,
    matchFactors: { location: 92, budget: 88, category: 98, time: 94, popularity: 95 },
    socialStats: { views: 3456, likes: 678, saves: 289, shares: 134 },
    reviewCount: 421,
    purchaseOptions: [
      {
        id: 'pasta-basics',
        title: 'Pasta Basics',
        description: 'Learn to make classic pasta shapes',
        price: 75,
        currency: 'USD',
        includes: ['2.5-hour class', 'All ingredients', 'Make 2 pasta types', 'Sauce recipes', 'Lunch/dinner included'],
        duration: '2.5 hours',
        popular: true
      },
      {
        id: 'pasta-master',
        title: 'Pasta Masterclass',
        description: 'Complete pasta-making experience',
        price: 120,
        currency: 'USD',
        includes: ['4-hour intensive', 'Multiple pasta types', 'Advanced techniques', 'Wine pairing', 'Recipe book', 'Take-home fresh pasta kit'],
        duration: '4 hours'
      }
    ],
    creativeHandsOnData: {
      workshopType: 'cooking',
      activityScore: {
        handsOnLevel: 100,
        skillBuilding: 95,
        creativeFreedom: 80,
        socialInteraction: 85,
        takeHomeValue: 90
      },
      workshopDetails: {
        currentOffering: 'Fresh Pasta & Sauces',
        skillLevel: 'all-levels',
        maxParticipants: 12,
        materialsIncluded: true,
        materialsProvided: ['All ingredients', 'Cooking tools', 'Aprons', 'Recipe cards', 'Take-home containers'],
        duration: 150,
        hasInstructor: true,
        instructorStyle: 'hands-off'
      },
      venueCharacteristics: {
        isIndoor: true,
        hasStudio: true,
        hasWorkstations: true,
        requiresReservation: true,
        allowsWalkIns: false,
        allowsGroups: true
      },
      experienceTypeFit: {
        firstDate: 92,
        romantic: 90,
        friendly: 98,
        groupFun: 95,
        soloAdventure: 75,
        family: 95
      },
      amenities: {
        hasRefreshments: true,
        hasSnacks: false,
        hasDrinks: true,
        hasStorage: true,
        hasParking: false,
        wheelchairAccessible: true,
        provideAprons: true
      },
      priceStructure: {
        sessionType: 'per-person',
        includesMaterials: true,
        includesTool: true,
        takeHomePiece: true,
        groupDiscounts: true
      },
      timeAlignment: {
        morning: 85,
        afternoon: 95,
        evening: 90,
        weekend: 100
      },
      weatherImpact: {
        indoorVenue: true,
        weatherAffectsExperience: false
      },
      socialDynamics: {
        conversationFriendly: true,
        encouragesCollaboration: true,
        soloFriendly: true,
        pairFriendly: true,
        groupFriendly: true
      },
      activityComfort: {
        physicalDemand: 'medium',
        messiness: 'somewhat-messy',
        concentration: 'moderate'
      },
      excludedIfAny: [],
      typicalDuration: {
        min: 150,
        max: 240,
        average: 180
      },
      timelineSteps: [
        { step: 'Welcome', description: 'Meet your chef instructor and fellow pasta enthusiasts', duration: '10 min', icon: 'arrive' },
        { step: 'Learn', description: 'Master the fundamentals of pasta dough and shaping techniques', duration: '30 min', icon: 'sip' },
        { step: 'Make', description: 'Hands-on pasta making - create multiple traditional shapes', duration: '90 min', icon: 'enjoy' },
        { step: 'Feast', description: 'Cook and enjoy your fresh pasta with house-made sauces', duration: '30 min', icon: 'wrapup' }
      ]
    }
  },
  {
    id: 'creative-jewelry-1',
    title: 'Silver Jewelry Workshop',
    category: 'creative',
    categoryIcon: Palette,
    timeAway: '20 min away',
    description: 'Design and craft your own silver ring or pendant',
    budget: 'Unique jewelry-making experience',
    rating: 4.6,
    image: 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxqZXdlbHJ5JTIwbWFraW5nJTIwd29ya3Nob3B8ZW58MXx8fHwxNzU5MzMxMTEzfDA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxqZXdlbHJ5JTIwbWFraW5nJTIwd29ya3Nob3B8ZW58MXx8fHwxNzU5MzMxMTEzfDA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '20m',
    distance: '5.8 km',
    experienceType: 'romantic',
    priceRange: '$75-120',
    pricePerPerson: 95,
    highlights: ['Sterling Silver', 'Custom Design', 'Professional Tools', 'Keep Your Creation'],
    fullDescription: 'Learn metalworking basics and create a unique piece of silver jewelry you will treasure forever.',
    address: '567 Jewel Lane, Design District, SF',
    openingHours: 'Wed-Sun 12PM-6PM',
    phoneNumber: '(415) 456-7890',
    tags: ['Jewelry', 'Metalworking', 'Custom', 'Unique'],
    matchScore: 88,
    matchFactors: { location: 85, budget: 82, category: 95, time: 88, popularity: 90 },
    socialStats: { views: 1876, likes: 345, saves: 156, shares: 67 },
    reviewCount: 234,
    purchaseOptions: [
      {
        id: 'jewelry-ring',
        title: 'Silver Ring Workshop',
        description: 'Create your own silver ring',
        price: 95,
        currency: 'USD',
        includes: ['2-hour workshop', 'Sterling silver materials', 'Professional tools', 'Expert guidance', 'Polishing & finishing'],
        duration: '2 hours',
        popular: true
      },
      {
        id: 'jewelry-pendant',
        title: 'Custom Pendant Class',
        description: 'Design and make a unique pendant',
        price: 110,
        currency: 'USD',
        includes: ['2.5-hour class', 'Sterling silver', 'Design consultation', 'Chain included', 'Gift box'],
        duration: '2.5 hours'
      }
    ],
    creativeHandsOnData: {
      workshopType: 'jewelry',
      activityScore: {
        handsOnLevel: 100,
        skillBuilding: 90,
        creativeFreedom: 95,
        socialInteraction: 65,
        takeHomeValue: 100
      },
      workshopDetails: {
        currentOffering: 'Silver Ring & Pendant Making',
        skillLevel: 'beginner',
        maxParticipants: 6,
        materialsIncluded: true,
        materialsProvided: ['Sterling silver', 'Professional jeweler tools', 'Safety equipment', 'Polishing materials', 'Gift box'],
        duration: 120,
        hasInstructor: true,
        instructorStyle: 'guided'
      },
      venueCharacteristics: {
        isIndoor: true,
        hasStudio: true,
        hasWorkstations: true,
        requiresReservation: true,
        allowsWalkIns: false,
        allowsGroups: false
      },
      experienceTypeFit: {
        firstDate: 95,
        romantic: 98,
        friendly: 85,
        groupFun: 70,
        soloAdventure: 88,
        family: 60
      },
      amenities: {
        hasRefreshments: true,
        hasSnacks: true,
        hasDrinks: true,
        hasStorage: false,
        hasParking: true,
        wheelchairAccessible: true,
        provideAprons: false
      },
      priceStructure: {
        sessionType: 'per-person',
        includesMaterials: true,
        includesTool: true,
        takeHomePiece: true,
        groupDiscounts: false
      },
      timeAlignment: {
        morning: 60,
        afternoon: 95,
        evening: 85,
        weekend: 100
      },
      weatherImpact: {
        indoorVenue: true,
        weatherAffectsExperience: false
      },
      socialDynamics: {
        conversationFriendly: true,
        encouragesCollaboration: false,
        soloFriendly: true,
        pairFriendly: true,
        groupFriendly: false
      },
      activityComfort: {
        physicalDemand: 'low',
        messiness: 'clean',
        concentration: 'focused'
      },
      excludedIfAny: [],
      typicalDuration: {
        min: 120,
        max: 150,
        average: 135
      },
      timelineSteps: [
        { step: 'Design', description: 'Sketch your ring or pendant design with the instructor', duration: '20 min', icon: 'arrive' },
        { step: 'Shape', description: 'Cut, shape, and form your silver using professional tools', duration: '60 min', icon: 'sip' },
        { step: 'Detail', description: 'Add textures, stamps, or engravings to personalize your piece', duration: '30 min', icon: 'enjoy' },
        { step: 'Polish', description: 'Final polishing and finishing - leave with your creation!', duration: '10 min', icon: 'wrapup' }
      ]
    }
  },
  {
    id: 'creative-candle-1',
    title: 'Artisan Candle Making',
    category: 'creative',
    categoryIcon: Palette,
    timeAway: '14 min away',
    description: 'Create custom scented candles in beautiful containers',
    budget: 'Relaxing creative session',
    rating: 4.5,
    image: 'https://images.unsplash.com/photo-1602874801006-95415c52e0ff?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjYW5kbGUlMjBtYWtpbmclMjB3b3Jrc2hvcHxlbnwxfHx8fDE3NTkzMzExMTN8MA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1602874801006-95415c52e0ff?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjYW5kbGUlMjBtYWtpbmclMjB3b3Jrc2hvcHxlbnwxfHx8fDE3NTkzMzExMTN8MA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '14m',
    distance: '3.8 km',
    experienceType: 'friendly',
    priceRange: '$40-65',
    pricePerPerson: 50,
    highlights: ['Custom Scents', 'Beautiful Containers', 'Take Home 2-3 Candles', 'Aromatherapy'],
    fullDescription: 'Blend essential oils and create your own signature scented candles in this relaxing workshop perfect for beginners.',
    address: '890 Scent Street, Craft Quarter, SF',
    openingHours: 'Fri-Sun 1PM-8PM',
    phoneNumber: '(415) 567-8901',
    tags: ['Candles', 'Aromatherapy', 'DIY', 'Relaxing'],
    matchScore: 90,
    matchFactors: { location: 92, budget: 95, category: 90, time: 88, popularity: 85 },
    socialStats: { views: 1456, likes: 267, saves: 112, shares: 45 },
    reviewCount: 189,
    purchaseOptions: [
      {
        id: 'candle-basic',
        title: 'Candle Making Basics',
        description: 'Create 2 custom candles',
        price: 50,
        currency: 'USD',
        includes: ['1.5-hour class', 'All materials', 'Scent blending', '2 candles to take home', 'Containers included'],
        duration: '1.5 hours',
        popular: true
      },
      {
        id: 'candle-advanced',
        title: 'Artisan Candle Collection',
        description: 'Create a set of luxury candles',
        price: 85,
        currency: 'USD',
        includes: ['2.5-hour workshop', 'Premium waxes', 'Essential oils', 'Create 4 candles', 'Luxury containers', 'Gift packaging'],
        duration: '2.5 hours'
      }
    ],
    creativeHandsOnData: {
      workshopType: 'candle_making',
      activityScore: {
        handsOnLevel: 90,
        skillBuilding: 70,
        creativeFreedom: 95,
        socialInteraction: 80,
        takeHomeValue: 90
      },
      workshopDetails: {
        currentOffering: 'Custom Scented Candles',
        skillLevel: 'all-levels',
        maxParticipants: 12,
        materialsIncluded: true,
        materialsProvided: ['Soy wax', 'Essential oils', 'Containers', 'Wicks', 'Dyes', 'Tools'],
        duration: 90,
        hasInstructor: true,
        instructorStyle: 'collaborative'
      },
      venueCharacteristics: {
        isIndoor: true,
        hasStudio: true,
        hasWorkstations: true,
        requiresReservation: true,
        allowsWalkIns: false,
        allowsGroups: true
      },
      experienceTypeFit: {
        firstDate: 88,
        romantic: 85,
        friendly: 95,
        groupFun: 92,
        soloAdventure: 85,
        family: 90
      },
      amenities: {
        hasRefreshments: true,
        hasSnacks: true,
        hasDrinks: true,
        hasStorage: false,
        hasParking: true,
        wheelchairAccessible: true,
        provideAprons: false
      },
      priceStructure: {
        sessionType: 'per-person',
        includesMaterials: true,
        includesTool: true,
        takeHomePiece: true,
        groupDiscounts: true
      },
      timeAlignment: {
        morning: 60,
        afternoon: 85,
        evening: 95,
        weekend: 100
      },
      weatherImpact: {
        indoorVenue: true,
        weatherAffectsExperience: false
      },
      socialDynamics: {
        conversationFriendly: true,
        encouragesCollaboration: true,
        soloFriendly: true,
        pairFriendly: true,
        groupFriendly: true
      },
      activityComfort: {
        physicalDemand: 'low',
        messiness: 'clean',
        concentration: 'relaxed'
      },
      excludedIfAny: [],
      typicalDuration: {
        min: 90,
        max: 150,
        average: 105
      },
      timelineSteps: [
        { step: 'Intro', description: 'Learn about candle making basics and scent profiles', duration: '15 min', icon: 'arrive' },
        { step: 'Blend', description: 'Create your custom scent blends with essential oils', duration: '20 min', icon: 'sip' },
        { step: 'Pour', description: 'Melt wax, add color and scent, pour into containers', duration: '40 min', icon: 'enjoy' },
        { step: 'Finish', description: 'Label your candles and package them to take home', duration: '15 min', icon: 'wrapup' }
      ]
    }
  },

  // PICNICS CATEGORY (5 cards) - PRODUCTION READY
  {
    id: 'picnic-park-1',
    title: 'Golden Gate Park Picnic',
    category: 'picnics',
    categoryIcon: Sun,
    timeAway: '18 min away',
    description: 'Scenic park picnic with Trader Joe\'s stop - perfect afternoon outdoors',
    budget: 'Affordable outdoor dining',
    rating: 4.6,
    image: 'https://images.unsplash.com/photo-1746648882869-8e0f14842637?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwaWNuaWMlMjBwYXJrJTIwYmxhbmtldHxlbnwxfHx8fDE3NjA0NjAxMTN8MA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1746648882869-8e0f14842637?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwaWNuaWMlMjBwYXJrJTIwYmxhbmtldHxlbnwxfHx8fDE3NjA0NjAxMTN8MA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '18m',
    distance: '5.2 km',
    experienceType: 'friendly',
    priceRange: '$10-25',
    pricePerPerson: 18,
    highlights: ['Scenic Views', 'Shaded Areas', 'Restrooms Nearby', 'Pet Friendly'],
    fullDescription: 'Enjoy a relaxing afternoon picnic at Golden Gate Park. Stop at Trader Joe\'s for fresh snacks, then settle into one of the park\'s beautiful meadows.',
    address: 'Golden Gate Park, San Francisco, CA',
    openingHours: 'Park open 5AM-10PM',
    phoneNumber: '(415) 831-2700',
    tags: ['Picnic', 'Park', 'Outdoor', 'Nature'],
    matchScore: 85,
    matchFactors: { location: 88, budget: 95, category: 85, time: 82, popularity: 80 },
    socialStats: { views: 2134, likes: 389, saves: 167, shares: 72 },
    reviewCount: 456,
    timeline: {
      stop1: {
        time: '2:00 PM',
        location: 'Trader Joe\'s',
        locationName: 'Trader Joe\'s - Masonic Ave',
        activity: 'Pick up snacks and drinks',
        duration: '15 min',
        description: 'Grab pre-made sandwiches, fruit, drinks, and any picnic supplies you need',
        address: '3 Masonic Ave, San Francisco, CA'
      },
      stop2: {
        time: '2:20 PM',
        location: 'Golden Gate Park',
        locationName: 'Golden Gate Park Meadow',
        activity: 'Enjoy your picnic',
        duration: '2 hours',
        description: 'Find a perfect spot in the meadow, spread out your blanket, and enjoy the afternoon',
        address: 'Golden Gate Park, San Francisco, CA'
      }
    },
    picnicsData: {
      routeStructure: {
        stop1Type: 'grocery_store',
        stop1Name: 'Trader Joe\'s - Masonic Ave',
        stop1Address: '3 Masonic Ave, San Francisco, CA',
        stop2Type: 'park',
        stop2Name: 'Golden Gate Park',
        stop2Address: 'Golden Gate Park, San Francisco, CA',
        travelBetweenStops: 5
      },
      locationScore: {
        scenicValue: 95,
        privacyLevel: 60,
        amenitiesNearby: 90,
        accessibilityScore: 95,
        safetyRating: 95
      },
      picnicDetails: {
        idealTime: 'afternoon',
        typicalDuration: 120,
        hasShade: true,
        hasTables: true,
        hasGrills: false,
        allowsAlcohol: false,
        petFriendly: true
      },
      groceryDetails: {
        storeType: 'full_grocery',
        hasReadyMade: true,
        hasPicnicSupplies: true,
        priceRange: 'moderate',
        openUntil: '9:00 PM'
      },
      weatherRequirements: {
        minTemp: 60,
        maxTemp: 85,
        idealWeather: ['sunny', 'partly_cloudy'],
        avoidWeather: ['rain', 'thunderstorm'],
        windTolerance: 'medium',
        uvSensitivity: true
      },
      experienceTypeFit: {
        firstDate: 88,
        romantic: 85,
        friendly: 95,
        groupFun: 92,
        soloAdventure: 75,
        family: 98
      },
      parkAmenities: {
        hasRestrooms: true,
        hasWaterFountain: true,
        hasParking: true,
        hasPlayground: true,
        hasTrails: true,
        wheelchairAccessible: true
      },
      priceStructure: {
        estimatedGroceryCost: 15,
        parkingCost: 0,
        totalEstimate: 15
      },
      timeAlignment: {
        morning: 85,
        afternoon: 100,
        evening: 70,
        sunset: 60
      },
      socialDynamics: {
        conversationFriendly: true,
        activityOptions: ['Frisbee', 'Reading', 'Walking', 'People watching'],
        romanticPotential: 85,
        groupCapacity: 'large'
      },
      suggestedItems: {
        essentials: ['Picnic blanket', 'Sunscreen', 'Water bottles', 'Napkins'],
        foodIdeas: ['Sandwiches', 'Fresh fruit', 'Cheese & crackers', 'Lemonade'],
        optionalExtras: ['Frisbee', 'Speaker', 'Book', 'Cards']
      },
      excludedIfAny: [],
      typicalDuration: {
        groceryStop: 15,
        travelTopark: 5,
        atPark: 120,
        total: 140
      },
      timelineSteps: [
        { step: 'Shop', locationName: 'Trader Joe\'s', description: 'Pick up your favorite picnic snacks and drinks', duration: '15 min', icon: 'arrive' },
        { step: 'Travel', locationName: 'To Golden Gate Park', description: 'Short 5-minute drive or 15-minute walk to the park', duration: '5 min', icon: 'sip' },
        { step: 'Picnic', locationName: 'Golden Gate Park', description: 'Find your perfect spot and enjoy outdoor dining', duration: '2 hours', icon: 'enjoy' },
        { step: 'Explore', locationName: 'Golden Gate Park', description: 'Optional: Walk the trails or visit nearby attractions', duration: 'Flexible', icon: 'wrapup' }
      ]
    }
  },
  {
    id: 'picnic-waterfront-1',
    title: 'Marina Waterfront Picnic',
    category: 'picnics',
    categoryIcon: Sun,
    timeAway: '14 min away',
    description: 'Lakeside picnic with bay views and Whole Foods stop',
    budget: 'Moderate waterfront experience',
    rating: 4.7,
    image: 'https://images.unsplash.com/photo-1688127346194-30b3c4bdb710?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3YXRlcmZyb250JTIwbGFrZXNpZGUlMjBwaWNuaWN8ZW58MXx8fHwxNzYwNDYwMTEyfDA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1688127346194-30b3c4bdb710?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3YXRlcmZyb250JTIwbGFrZXNpZGUlMjBwaWNuaWN8ZW58MXx8fHwxNzYwNDYwMTEyfDA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '14m',
    distance: '3.8 km',
    experienceType: 'romantic',
    priceRange: '$15-30',
    pricePerPerson: 22,
    highlights: ['Bay Views', 'Sunset Spot', 'Waterfront Path', 'Romantic Setting'],
    fullDescription: 'Perfect romantic picnic spot with stunning bay views. Stop at Whole Foods for gourmet selections, then enjoy the waterfront ambience.',
    address: 'Marina Green, San Francisco, CA',
    openingHours: 'Park open sunrise to sunset',
    phoneNumber: 'N/A',
    tags: ['Waterfront', 'Romantic', 'Sunset', 'Views'],
    matchScore: 91,
    matchFactors: { location: 94, budget: 88, category: 92, time: 95, popularity: 88 },
    socialStats: { views: 3456, likes: 678, saves: 289, shares: 134 },
    reviewCount: 567,
    timeline: {
      stop1: {
        time: '5:00 PM',
        location: 'Whole Foods',
        locationName: 'Whole Foods Market - Marina',
        activity: 'Pick up gourmet picnic items',
        duration: '20 min',
        description: 'Browse the prepared foods section and grab wine, cheese, and specialty items',
        address: '1765 California St, San Francisco, CA'
      },
      stop2: {
        time: '5:25 PM',
        location: 'Marina Green',
        locationName: 'Marina Waterfront',
        activity: 'Sunset picnic',
        duration: '2.5 hours',
        description: 'Set up your blanket along the waterfront and watch the sunset over the bay',
        address: 'Marina Blvd, San Francisco, CA'
      }
    },
    picnicsData: {
      routeStructure: {
        stop1Type: 'grocery_store',
        stop1Name: 'Whole Foods Market - Marina',
        stop1Address: '1765 California St, San Francisco, CA',
        stop2Type: 'waterfront',
        stop2Name: 'Marina Green',
        stop2Address: 'Marina Blvd, San Francisco, CA',
        travelBetweenStops: 5
      },
      locationScore: {
        scenicValue: 100,
        privacyLevel: 50,
        amenitiesNearby: 85,
        accessibilityScore: 95,
        safetyRating: 90
      },
      picnicDetails: {
        idealTime: 'sunset',
        typicalDuration: 150,
        hasShade: false,
        hasTables: false,
        hasGrills: false,
        allowsAlcohol: true,
        petFriendly: true
      },
      groceryDetails: {
        storeType: 'full_grocery',
        hasReadyMade: true,
        hasPicnicSupplies: true,
        priceRange: 'upscale',
        openUntil: '10:00 PM'
      },
      weatherRequirements: {
        minTemp: 58,
        maxTemp: 80,
        idealWeather: ['sunny', 'partly_cloudy', 'clear'],
        avoidWeather: ['rain', 'fog', 'thunderstorm'],
        windTolerance: 'low',
        uvSensitivity: true
      },
      experienceTypeFit: {
        firstDate: 95,
        romantic: 100,
        friendly: 85,
        groupFun: 75,
        soloAdventure: 70,
        family: 80
      },
      parkAmenities: {
        hasRestrooms: true,
        hasWaterFountain: true,
        hasParking: true,
        hasPlayground: false,
        hasTrails: true,
        wheelchairAccessible: true
      },
      priceStructure: {
        estimatedGroceryCost: 22,
        parkingCost: 0,
        totalEstimate: 22
      },
      timeAlignment: {
        morning: 70,
        afternoon: 85,
        evening: 95,
        sunset: 100
      },
      socialDynamics: {
        conversationFriendly: true,
        activityOptions: ['Walking', 'Watching sailboats', 'Stargazing'],
        romanticPotential: 100,
        groupCapacity: 'intimate'
      },
      suggestedItems: {
        essentials: ['Blanket', 'Wine opener', 'Glasses', 'Warm layer for evening'],
        foodIdeas: ['Cheese board', 'Charcuterie', 'Wine', 'Fresh bread', 'Chocolate'],
        optionalExtras: ['Candles', 'Bluetooth speaker', 'Camera']
      },
      excludedIfAny: [],
      typicalDuration: {
        groceryStop: 20,
        travelTopark: 5,
        atPark: 150,
        total: 175
      },
      timelineSteps: [
        { step: 'Shop', locationName: 'Whole Foods', description: 'Select gourmet picnic items and wine from the prepared foods section', duration: '20 min', icon: 'arrive' },
        { step: 'Drive', locationName: 'To Marina Green', description: 'Quick 5-minute drive to the waterfront', duration: '5 min', icon: 'sip' },
        { step: 'Picnic', locationName: 'Marina Waterfront', description: 'Set up your romantic spot with bay and Golden Gate Bridge views', duration: '2.5 hours', icon: 'enjoy' },
        { step: 'Sunset', locationName: 'Waterfront Path', description: 'Watch the sunset, then stroll along the waterfront path', duration: 'Flexible', icon: 'wrapup' }
      ]
    }
  },
  {
    id: 'picnic-botanical-1',
    title: 'Botanical Garden Picnic',
    category: 'picnics',
    categoryIcon: Sun,
    timeAway: '22 min away',
    description: 'Peaceful garden picnic surrounded by beautiful blooms',
    budget: 'Nature-filled afternoon',
    rating: 4.5,
    image: 'https://images.unsplash.com/photo-1627244605349-fd94bd1304e5?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxib3RhbmljYWwlMjBnYXJkZW4lMjBwaWNuaWN8ZW58MXx8fHwxNzYwNDYwMTEzfDA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1627244605349-fd94bd1304e5?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxib3RhbmljYWwlMjBnYXJkZW4lMjBwaWNuaWN8ZW58MXx8fHwxNzYwNDYwMTEzfDA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '22m',
    distance: '6.5 km',
    experienceType: 'friendly',
    priceRange: '$12-22',
    pricePerPerson: 17,
    highlights: ['Botanical Beauty', 'Peaceful Setting', 'Photo Opportunities', 'Shaded Areas'],
    fullDescription: 'Immerse yourself in nature at the botanical garden. Pick up light snacks from the local market, then enjoy lunch surrounded by beautiful plants and flowers.',
    address: 'San Francisco Botanical Garden, SF',
    openingHours: '7:30AM-6PM (hours vary)',
    phoneNumber: '(415) 661-1316',
    tags: ['Garden', 'Nature', 'Peaceful', 'Photography'],
    matchScore: 82,
    matchFactors: { location: 78, budget: 92, category: 85, time: 80, popularity: 75 },
    socialStats: { views: 1567, likes: 298, saves: 134, shares: 56 },
    reviewCount: 289,
    timeline: {
      stop1: {
        time: '11:00 AM',
        location: 'Local Market',
        locationName: 'Sunset Super Market',
        activity: 'Grab picnic essentials',
        duration: '15 min',
        description: 'Pick up fresh sandwiches, salads, and drinks for your garden picnic',
        address: '2425 Irving St, San Francisco, CA'
      },
      stop2: {
        time: '11:20 AM',
        location: 'Botanical Garden',
        locationName: 'SF Botanical Garden',
        activity: 'Garden picnic',
        duration: '2 hours',
        description: 'Find a scenic spot in the gardens and enjoy your meal surrounded by nature',
        address: '1199 9th Ave, San Francisco, CA'
      }
    },
    picnicsData: {
      routeStructure: {
        stop1Type: 'market',
        stop1Name: 'Sunset Super Market',
        stop1Address: '2425 Irving St, San Francisco, CA',
        stop2Type: 'botanical_garden',
        stop2Name: 'San Francisco Botanical Garden',
        stop2Address: '1199 9th Ave, San Francisco, CA',
        travelBetweenStops: 5
      },
      locationScore: {
        scenicValue: 100,
        privacyLevel: 75,
        amenitiesNearby: 80,
        accessibilityScore: 85,
        safetyRating: 95
      },
      picnicDetails: {
        idealTime: 'morning',
        typicalDuration: 120,
        hasShade: true,
        hasTables: true,
        hasGrills: false,
        allowsAlcohol: false,
        petFriendly: false
      },
      groceryDetails: {
        storeType: 'full_grocery',
        hasReadyMade: true,
        hasPicnicSupplies: false,
        priceRange: 'budget',
        openUntil: '8:00 PM'
      },
      weatherRequirements: {
        minTemp: 55,
        maxTemp: 80,
        idealWeather: ['sunny', 'partly_cloudy'],
        avoidWeather: ['rain', 'heavy_wind'],
        windTolerance: 'medium',
        uvSensitivity: false
      },
      experienceTypeFit: {
        firstDate: 85,
        romantic: 90,
        friendly: 95,
        groupFun: 80,
        soloAdventure: 90,
        family: 92
      },
      parkAmenities: {
        hasRestrooms: true,
        hasWaterFountain: true,
        hasParking: true,
        hasPlayground: false,
        hasTrails: true,
        wheelchairAccessible: true
      },
      priceStructure: {
        estimatedGroceryCost: 12,
        parkingCost: 5,
        totalEstimate: 17
      },
      timeAlignment: {
        morning: 100,
        afternoon: 95,
        evening: 60,
        sunset: 40
      },
      socialDynamics: {
        conversationFriendly: true,
        activityOptions: ['Walking', 'Photography', 'Reading', 'Bird watching'],
        romanticPotential: 90,
        groupCapacity: 'small'
      },
      suggestedItems: {
        essentials: ['Blanket or sit pad', 'Water', 'Sunscreen', 'Bug spray'],
        foodIdeas: ['Sandwiches', 'Salads', 'Fruit', 'Iced tea'],
        optionalExtras: ['Camera', 'Binoculars', 'Flower guide book']
      },
      excludedIfAny: [],
      typicalDuration: {
        groceryStop: 15,
        travelTopark: 5,
        atPark: 120,
        total: 140
      },
      timelineSteps: [
        { step: 'Shop', locationName: 'Sunset Super', description: 'Quick stop for fresh sandwiches and picnic essentials', duration: '15 min', icon: 'arrive' },
        { step: 'Enter', locationName: 'Botanical Garden', description: 'Short drive to the garden entrance', duration: '5 min', icon: 'sip' },
        { step: 'Explore & Eat', locationName: 'Garden Grounds', description: 'Wander through the gardens and find your perfect picnic spot', duration: '2 hours', icon: 'enjoy' },
        { step: 'Photography', locationName: 'Garden Paths', description: 'Capture beautiful flower photos before leaving', duration: 'Flexible', icon: 'wrapup' }
      ]
    }
  },
  {
    id: 'picnic-beach-1',
    title: 'Ocean Beach Sunset Picnic',
    category: 'picnics',
    categoryIcon: Sun,
    timeAway: '25 min away',
    description: 'Beach picnic with stunning sunset views and ocean breeze',
    budget: 'Coastal picnic adventure',
    rating: 4.8,
    image: 'https://images.unsplash.com/photo-1725577369819-cccf38e517e6?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxiZWFjaCUyMHBpY25pYyUyMHN1bnNldHxlbnwxfHx8fDE3NjA0NjAxMTN8MA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1725577369819-cccf38e517e6?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxiZWFjaCUyMHBpY25pYyUyMHN1bnNldHxlbnwxfHx8fDE3NjA0NjAxMTN8MA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '25m',
    distance: '7.8 km',
    experienceType: 'romantic',
    priceRange: '$12-20',
    pricePerPerson: 16,
    highlights: ['Sunset Views', 'Beach Walk', 'Ocean Sounds', 'Romantic Ambience'],
    fullDescription: 'Watch the sunset over the Pacific Ocean while enjoying a beachside picnic. Stop at the nearby deli for fresh food, then settle in for a magical evening.',
    address: 'Ocean Beach, San Francisco, CA',
    openingHours: 'Beach open 24 hours',
    phoneNumber: 'N/A',
    tags: ['Beach', 'Sunset', 'Romantic', 'Ocean'],
    matchScore: 87,
    matchFactors: { location: 82, budget: 95, category: 90, time: 92, popularity: 85 },
    socialStats: { views: 2789, likes: 512, saves: 234, shares: 98 },
    reviewCount: 378,
    timeline: {
      stop1: {
        time: '5:30 PM',
        location: 'Beach Deli',
        locationName: 'Sunset Deli & Market',
        activity: 'Pick up beach picnic food',
        duration: '12 min',
        description: 'Grab sandwiches, chips, and drinks perfect for the beach',
        address: '3489 Judah St, San Francisco, CA'
      },
      stop2: {
        time: '5:50 PM',
        location: 'Ocean Beach',
        locationName: 'Ocean Beach',
        activity: 'Sunset beach picnic',
        duration: '2 hours',
        description: 'Set up on the sand and watch the sun dip below the Pacific horizon',
        address: 'Ocean Beach, Great Highway, SF'
      }
    },
    picnicsData: {
      routeStructure: {
        stop1Type: 'deli',
        stop1Name: 'Sunset Deli & Market',
        stop1Address: '3489 Judah St, San Francisco, CA',
        stop2Type: 'beach',
        stop2Name: 'Ocean Beach',
        stop2Address: 'Ocean Beach, Great Highway, SF',
        travelBetweenStops: 8
      },
      locationScore: {
        scenicValue: 100,
        privacyLevel: 70,
        amenitiesNearby: 60,
        accessibilityScore: 80,
        safetyRating: 85
      },
      picnicDetails: {
        idealTime: 'sunset',
        typicalDuration: 120,
        hasShade: false,
        hasTables: false,
        hasGrills: true,
        allowsAlcohol: true,
        petFriendly: true
      },
      groceryDetails: {
        storeType: 'deli',
        hasReadyMade: true,
        hasPicnicSupplies: false,
        priceRange: 'budget',
        openUntil: '8:00 PM'
      },
      weatherRequirements: {
        minTemp: 55,
        maxTemp: 75,
        idealWeather: ['sunny', 'clear', 'partly_cloudy'],
        avoidWeather: ['rain', 'fog', 'heavy_wind'],
        windTolerance: 'high',
        uvSensitivity: true
      },
      experienceTypeFit: {
        firstDate: 92,
        romantic: 98,
        friendly: 88,
        groupFun: 85,
        soloAdventure: 75,
        family: 90
      },
      parkAmenities: {
        hasRestrooms: true,
        hasWaterFountain: false,
        hasParking: true,
        hasPlayground: false,
        hasTrails: true,
        wheelchairAccessible: false
      },
      priceStructure: {
        estimatedGroceryCost: 16,
        parkingCost: 0,
        totalEstimate: 16
      },
      timeAlignment: {
        morning: 50,
        afternoon: 70,
        evening: 95,
        sunset: 100
      },
      socialDynamics: {
        conversationFriendly: true,
        activityOptions: ['Beach walk', 'Sandcastle', 'Sunset watching', 'Wave listening'],
        romanticPotential: 98,
        groupCapacity: 'small'
      },
      suggestedItems: {
        essentials: ['Beach blanket', 'Warm layers', 'Sunscreen', 'Water'],
        foodIdeas: ['Sandwiches', 'Chips', 'Fruit', 'Beer or wine'],
        optionalExtras: ['Beach chairs', 'Speaker', 'Camera', 'Frisbee']
      },
      excludedIfAny: [],
      typicalDuration: {
        groceryStop: 12,
        travelTopark: 8,
        atPark: 120,
        total: 140
      },
      timelineSteps: [
        { step: 'Shop', locationName: 'Sunset Deli', description: 'Quick grab of beach-friendly picnic food', duration: '12 min', icon: 'arrive' },
        { step: 'Drive', locationName: 'To Ocean Beach', description: 'Short drive to the beach parking area', duration: '8 min', icon: 'sip' },
        { step: 'Setup', locationName: 'Beach', description: 'Find your spot on the sand and spread out your blanket', duration: '10 min', icon: 'enjoy' },
        { step: 'Sunset', locationName: 'Ocean Beach', description: 'Enjoy your picnic as the sun sets over the Pacific', duration: '1.5 hours', icon: 'wrapup' }
      ]
    }
  },
  {
    id: 'picnic-overlook-1',
    title: 'Twin Peaks Scenic Overlook',
    category: 'picnics',
    categoryIcon: Sun,
    timeAway: '19 min away',
    description: 'Panoramic city views from the top - perfect sunrise or sunset spot',
    budget: 'Epic viewpoint picnic',
    rating: 4.9,
    image: 'https://images.unsplash.com/photo-1650308206385-7648d1c683e2?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzY2VuaWMlMjBvdmVybG9vayUyMHZpZXdwb2ludCUyMHBpY25pY3xlbnwxfHx8fDE3NjA0NjAxMTN8MA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1650308206385-7648d1c683e2?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzY2VuaWMlMjBvdmVybG9vayUyMHZpZXdwb2ludCUyMHBpY25pY3xlbnwxfHx8fDE3NjA0NjAxMTN8MA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '19m',
    distance: '5.5 km',
    experienceType: 'romantic',
    priceRange: '$14-24',
    pricePerPerson: 19,
    highlights: ['360° Views', 'City Skyline', 'Photo Spot', 'Unforgettable Setting'],
    fullDescription: 'Experience San Francisco from above with a picnic at Twin Peaks. Stop at a nearby market for snacks, then enjoy breathtaking panoramic views of the entire city.',
    address: 'Twin Peaks Summit, San Francisco, CA',
    openingHours: '5AM-Midnight',
    phoneNumber: 'N/A',
    tags: ['Views', 'Scenic', 'Overlook', 'Instagram-worthy'],
    matchScore: 94,
    matchFactors: { location: 95, budget: 90, category: 96, time: 95, popularity: 92 },
    socialStats: { views: 4123, likes: 789, saves: 345, shares: 156 },
    reviewCount: 612,
    timeline: {
      stop1: {
        time: '6:00 PM',
        location: 'Safeway',
        locationName: 'Safeway - Market St',
        activity: 'Stock up on picnic food',
        duration: '18 min',
        description: 'Get your favorite snacks, drinks, and maybe a dessert for the view',
        address: '2020 Market St, San Francisco, CA'
      },
      stop2: {
        time: '6:25 PM',
        location: 'Twin Peaks',
        locationName: 'Twin Peaks Summit',
        activity: 'Panoramic view picnic',
        duration: '1.5 hours',
        description: 'Set up at the scenic overlook and take in the incredible 360° views of SF',
        address: '501 Twin Peaks Blvd, San Francisco, CA'
      }
    },
    picnicsData: {
      routeStructure: {
        stop1Type: 'grocery_store',
        stop1Name: 'Safeway - Market St',
        stop1Address: '2020 Market St, San Francisco, CA',
        stop2Type: 'scenic_overlook',
        stop2Name: 'Twin Peaks Summit',
        stop2Address: '501 Twin Peaks Blvd, San Francisco, CA',
        travelBetweenStops: 7
      },
      locationScore: {
        scenicValue: 100,
        privacyLevel: 40,
        amenitiesNearby: 40,
        accessibilityScore: 70,
        safetyRating: 85
      },
      picnicDetails: {
        idealTime: 'sunset',
        typicalDuration: 90,
        hasShade: false,
        hasTables: false,
        hasGrills: false,
        allowsAlcohol: true,
        petFriendly: true
      },
      groceryDetails: {
        storeType: 'full_grocery',
        hasReadyMade: true,
        hasPicnicSupplies: true,
        priceRange: 'moderate',
        openUntil: '12:00 AM'
      },
      weatherRequirements: {
        minTemp: 50,
        maxTemp: 75,
        idealWeather: ['clear', 'sunny'],
        avoidWeather: ['rain', 'fog', 'heavy_wind'],
        windTolerance: 'low',
        uvSensitivity: true
      },
      experienceTypeFit: {
        firstDate: 98,
        romantic: 100,
        friendly: 85,
        groupFun: 80,
        soloAdventure: 85,
        family: 75
      },
      parkAmenities: {
        hasRestrooms: false,
        hasWaterFountain: false,
        hasParking: true,
        hasPlayground: false,
        hasTrails: false,
        wheelchairAccessible: false
      },
      priceStructure: {
        estimatedGroceryCost: 19,
        parkingCost: 0,
        totalEstimate: 19
      },
      timeAlignment: {
        morning: 95,
        afternoon: 75,
        evening: 100,
        sunset: 100
      },
      socialDynamics: {
        conversationFriendly: true,
        activityOptions: ['Photography', 'Stargazing', 'City watching'],
        romanticPotential: 100,
        groupCapacity: 'intimate'
      },
      suggestedItems: {
        essentials: ['Warm jacket', 'Blanket', 'Flashlight', 'Water'],
        foodIdeas: ['Easy-to-eat snacks', 'Sandwiches', 'Champagne or wine', 'Dessert'],
        optionalExtras: ['Camera with tripod', 'Binoculars', 'Telescope']
      },
      excludedIfAny: [],
      typicalDuration: {
        groceryStop: 18,
        travelTopark: 7,
        atPark: 90,
        total: 115
      },
      timelineSteps: [
        { step: 'Shop', locationName: 'Safeway', description: 'Grab your picnic supplies and maybe some champagne', duration: '18 min', icon: 'arrive' },
        { step: 'Ascend', locationName: 'To Twin Peaks', description: 'Drive up the winding road to the summit', duration: '7 min', icon: 'sip' },
        { step: 'Panorama', locationName: 'Twin Peaks Summit', description: 'Take in the breathtaking 360° views while you dine', duration: '1.5 hours', icon: 'enjoy' },
        { step: 'Sunset/Stars', locationName: 'Overlook', description: 'Watch the city lights come on or stargaze', duration: 'Flexible', icon: 'wrapup' }
      ]
    }
  },

  // DINING EXPERIENCES CATEGORY (5 cards)  
  {
    id: 'new-4',
    title: 'Le Bernardin Wine Tasting',
    category: 'diningExp',
    categoryIcon: Utensils,
    timeAway: '25 min away',
    description: 'Exquisite culinary journey with wine pairings',
    budget: 'Premium experience for special occasions',
    rating: 4.9,
    image: 'https://images.unsplash.com/photo-1758648207539-b40dd1f6b50e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxyZXN0YXVyYW50JTIwZmluZSUyMGRpbmluZyUyMGF0bW9zcGhlcmV8ZW58MXx8fHwxNzU5MTcyNTE2fDA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1758648207539-b40dd1f6b50e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxyZXN0YXVyYW50JTIwZmluZSUyMGRpbmluZyUyMGF0bW9zcGhlcmV8ZW58MXx8fHwxNzU5MTcyNTE2fDA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '25m',
    distance: '7.8 km',
    experienceType: 'romantic',
    priceRange: '$150+',
    pricePerPerson: 185,
    highlights: ['Michelin 3-Star', 'Wine Sommelier', 'Seasonal Menu', 'Intimate Setting'],
    fullDescription: 'An unforgettable fine dining experience featuring the freshest seafood and expertly paired wines.',
    address: '155 West 51st Street, New York, NY 10019',
    openingHours: 'Tue-Sat 5:30pm-10:30pm',
    phoneNumber: '(212) 554-1515',
    tags: ['Fine Dining', 'Wine', 'Romantic', 'Luxury'],
    matchScore: 76,
    matchFactors: { location: 82, budget: 45, category: 91, time: 88, popularity: 97 },
    socialStats: { views: 856, likes: 142, saves: 67, shares: 28 },
    reviewCount: 64,
    purchaseOptions: [
      {
        id: 'wine-tasting',
        title: 'Wine Tasting Menu',
        description: 'Curated wine selection with appetizers',
        price: 95,
        currency: 'USD',
        includes: ['5-course wine tasting', 'Artisanal appetizers', 'Sommelier guidance', 'Reserved seating'],
        duration: '1.5 hours'
      },
      {
        id: 'chef-special',
        title: 'Chef\'s Special Experience',
        description: 'Full dining experience with wine pairings',
        price: 185,
        currency: 'USD',
        includes: ['7-course tasting menu', 'Premium wine pairings', 'Meet the chef', 'Personalized menu', 'VIP seating'],
        duration: '2.5 hours',
        popular: true
      },
      {
        id: 'private-dining',
        title: 'Private Dining Experience',
        description: 'Exclusive private table with custom menu',
        price: 350,
        currency: 'USD',
        includes: ['Private dining room', 'Custom 9-course menu', 'Exclusive wine selection', 'Personal chef', 'Dedicated sommelier', 'Complimentary cocktails'],
        duration: '3 hours',
        savings: 'Most Exclusive'
      }
    ]
  },

  // WELLNESS DATES CATEGORY (5 cards)
  {
    id: 'new-5',
    title: 'Mindful Moments Yoga Studio',
    category: 'wellness',
    categoryIcon: Dumbbell,
    timeAway: '15 min away',
    description: 'Relaxing couples yoga and meditation session',
    budget: 'Affordable wellness experience',
    rating: 4.5,
    image: 'https://images.unsplash.com/photo-1602827114685-efbb2717da9f?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3ZWxsbmVzcyUyMHNwYSUyMHlvZ2ElMjBzdHVkaW98ZW58MXx8fHwxNzU5MTcyNTIwfDA&ixlib=rb-4.1.0&q=80&w=1080',
    images: [
      'https://images.unsplash.com/photo-1602827114685-efbb2717da9f?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3ZWxsbmVzcyUyMHNwYSUyMHlvZ2ElMjBzdHVkaW98ZW58MXx8fHwxNzU5MTcyNTIwfDA&ixlib=rb-4.1.0&q=80&w=1080',
      'https://images.unsplash.com/photo-1641952150136-9e41d4836cff?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxyb29mdG9wJTIweW9nYSUyMHN1bnJpc2V8ZW58MXx8fHwxNzU5MzA0MjAzfDA&ixlib=rb-4.1.0&q=80&w=1080'
    ],
    travelTime: '15m',
    distance: '4.2 km',
    experienceType: 'Friendly',
    priceRange: '$30-60',
    pricePerPerson: 45,
    highlights: ['Couples Classes', 'Meditation Corner', 'Aromatherapy', 'Beginner Friendly'],
    fullDescription: 'Connect with your partner or friend through mindful movement and meditation in a serene environment.',
    address: '123 Zen Street, Wellness District',
    openingHours: 'Mon-Sun 6am-9pm',
    phoneNumber: '(555) 123-YOGA',
    tags: ['Yoga', 'Wellness', 'Meditation', 'Couples'],
    matchScore: 83,
    matchFactors: { location: 91, budget: 87, category: 79, time: 95, popularity: 72 },
    socialStats: { views: 654, likes: 98, saves: 31, shares: 15 },
    reviewCount: 56,
    purchaseOptions: [
      {
        id: 'yoga-drop-in',
        title: 'Drop-in Class',
        description: 'Single class for couples or friends',
        price: 25,
        currency: 'USD',
        includes: ['75-minute class', 'Mat rental', 'Welcome tea', 'Relaxation corner access'],
        duration: '1.5 hours'
      },
      {
        id: 'yoga-package',
        title: 'Wellness Package',
        description: 'Complete wellness experience',
        price: 55,
        currency: 'USD',
        includes: ['Couples yoga class', 'Meditation session', 'Aromatherapy treatment', 'Healthy refreshments', 'Wellness consultation'],
        duration: '2.5 hours',
        popular: true
      },
      {
        id: 'yoga-private',
        title: 'Private Session',
        description: 'Personalized instruction in private studio',
        price: 95,
        currency: 'USD',
        includes: ['Private studio access', 'Certified instructor', 'Customized practice', 'Meditation guidance', 'Essential oils', 'Take-home wellness guide'],
        duration: '1.5 hours'
      }
    ]
  },

  // FREESTYLE CATEGORY (5 cards)
  {
    id: 'new-6',
    title: 'Urban Exploration Tour',
    category: 'freestyle',
    categoryIcon: Eye,
    timeAway: '22 min away',
    description: 'Discover hidden gems and street art',
    budget: 'Unique city adventure',
    rating: 4.7,
    image: 'https://images.unsplash.com/photo-1758030306457-e54f25fe4384?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzdHJlZXQlMjBhcnQlMjBtdXJhbHxlbnwxfHx8fDE3NTkyODEzMTZ8MA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1758030306457-e54f25fe4384?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzdHJlZXQlMjBhcnQlMjBtdXJhbHxlbnwxfHx8fDE3NTkyODEzMTZ8MA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '22m',
    distance: '6.8 km',
    experienceType: 'Adventure',
    priceRange: '$25-45',
    pricePerPerson: 35,
    highlights: ['Street Art', 'Local Stories', 'Hidden Spots', 'Photo Opportunities'],
    fullDescription: 'Explore the city through a local\'s eyes, discovering street art, hidden alleys, and unique neighborhoods.',
    address: 'Meeting Point: 16th & Mission, SF',
    openingHours: 'Tours daily 10am, 2pm, 6pm',
    phoneNumber: '(415) 789-0123',
    tags: ['Adventure', 'Street Art', 'Local', 'Photography'],
    matchScore: 89,
    matchFactors: { location: 85, budget: 90, category: 92, time: 88, popularity: 85 },
    socialStats: { views: 1234, likes: 203, saves: 89, shares: 45 },
    reviewCount: 178,
    purchaseOptions: [
      {
        id: 'urban-basic',
        title: 'Street Art Walk',
        description: 'Guided street art discovery',
        price: 25,
        currency: 'USD',
        includes: ['2-hour guided walk', 'Street art map', 'Artist stories', 'Photo spots'],
        duration: '2 hours'
      },
      {
        id: 'urban-extended',
        title: 'Hidden Gems Tour',
        description: 'Complete neighborhood exploration',
        price: 40,
        currency: 'USD',
        includes: ['3-hour comprehensive tour', 'Local tastings', 'Secret viewpoints', 'Photography tips', 'Digital photo collection'],
        duration: '3 hours',
        popular: true
      },
      {
        id: 'urban-vip',
        title: 'Insider\'s SF Experience',
        description: 'Exclusive local access',
        price: 75,
        currency: 'USD',
        includes: ['Private guide', 'Rooftop access', 'Meet local artists', 'Exclusive venues', 'Gourmet snacks', 'Professional photos'],
        duration: '4 hours'
      }
    ]
  },

  // ============ FREESTYLE CATEGORY (5 cards) ============
  
  {
    id: 'freestyle-001',
    title: 'GlowFest - Neon Night Market',
    category: 'freestyle',
    categoryIcon: Sparkles,
    timeAway: '20 min away',
    description: 'Open-air night market with glowing art installations, live DJs, and global street food',
    budget: 'Unique festival experience',
    rating: 4.8,
    image: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=1200',
    images: ['https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=1200','https://images.unsplash.com/photo-1519167758481-83f29da8c879?w=1200'],
    travelTime: '20m',
    distance: '6.5 km',
    experienceType: 'groupFun',
    priceRange: '$15-35',
    pricePerPerson: 25,
    highlights: ['Neon light installations', 'Live DJ sets', '20+ food vendors', 'Outdoor dancing'],
    fullDescription: 'An immersive outdoor night market featuring glowing art installations, multiple live DJ performances, and diverse international street food vendors. Wander through neon-lit pathways, sample global cuisines, and dance under the stars.',
    address: 'Pier 48, San Francisco, CA 94158',
    openingHours: 'Fri-Sat 6PM-12AM (Summer Series)',
    phoneNumber: '(415) 555-3030',
    website: 'https://glowfest.com',
    tags: ['Festival', 'Night Market', 'Art', 'Food', 'Music'],
    matchScore: 92,
    matchFactors: {location: 88, budget: 90, category: 95, time: 92, popularity: 96},
    socialStats: {views: 8234, likes: 1432, saves: 892, shares: 456},
    reviewCount: 1432,
    purchaseOptions: [
      {id: 'glow-basic', title: 'General Admission', description: 'Entry to GlowFest', price: 15, currency: 'USD', includes: ['Festival entry', 'Access to all installations', 'Live music'], duration: '2-4 hours'},
      {id: 'glow-foodie', title: 'Food & Art Pass', description: 'Entry + food credits', price: 35, currency: 'USD', includes: ['Festival entry', '$20 food vendor credits', 'Art installation guide', 'Priority bar access'], duration: '2-4 hours', popular: true},
      {id: 'glow-vip', title: 'VIP Experience', description: 'Premium access', price: 55, currency: 'USD', includes: ['VIP lounge access', '$30 food/drink credits', 'Reserved seating area', 'Exclusive merchandise', 'Early entry (5PM)'], duration: '3-5 hours'}
    ]
  },

  {
    id: 'freestyle-002',
    title: 'The Secret Gallery - Immersive Pop-Up',
    category: 'freestyle',
    categoryIcon: Sparkles,
    timeAway: '25 min away',
    description: 'Hidden pop-up art gallery with interactive installations and surprise performances',
    budget: 'Mysterious art adventure',
    rating: 4.9,
    image: 'https://images.unsplash.com/photo-1569074187119-c87815b476da?w=1200',
    images: ['https://images.unsplash.com/photo-1569074187119-c87815b476da?w=1200','https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200'],
    travelTime: '25m',
    distance: '7.2 km',
    experienceType: 'firstDate',
    priceRange: '$20-30',
    pricePerPerson: 25,
    highlights: ['Secret location revealed 24h before', 'Interactive installations', 'Live performance art', 'Limited capacity'],
    fullDescription: 'A mysterious pop-up art gallery in an undisclosed warehouse location. Experience cutting-edge interactive installations, live performance art, and surprise creative moments. Location revealed to ticket holders 24 hours in advance.',
    address: 'Secret Location - Revealed 24h Before Event',
    openingHours: 'Fri-Sun 7PM-11PM (Pop-Up Series)',
    phoneNumber: '(415) 555-4040',
    website: 'https://secretgallery.art',
    tags: ['Pop-Up', 'Art', 'Interactive', 'Secret', 'Performance'],
    matchScore: 94,
    matchFactors: {location: 90, budget: 92, category: 98, time: 94, popularity: 92},
    socialStats: {views: 5892, likes: 876, saves: 623, shares: 312},
    reviewCount: 876,
    purchaseOptions: [
      {id: 'gallery-basic', title: 'Gallery Entry', description: 'Access to installations', price: 20, currency: 'USD', includes: ['Gallery access', 'All interactive installations', 'Complimentary drink'], duration: '2-3 hours'},
      {id: 'gallery-guided', title: 'Guided Experience', description: 'With artist Q&A', price: 30, currency: 'USD', includes: ['Gallery access', 'Artist-led tour', 'Performance schedule', '2 complimentary drinks', 'Take-home art print'], duration: '2.5 hours', popular: true},
      {id: 'gallery-collector', title: 'Collector Access', description: 'VIP early entry', price: 50, currency: 'USD', includes: ['Early entry (6PM)', 'Private artist meet & greet', 'Exclusive installations', 'Unlimited drinks', 'Limited edition artwork'], duration: '3 hours'}
    ]
  },

  {
    id: 'freestyle-003',
    title: 'Underground Supper Club - Chef\'s Mystery Menu',
    category: 'freestyle',
    categoryIcon: Sparkles,
    timeAway: '18 min away',
    description: 'Secret dining experience with a surprise 5-course menu in a hidden location',
    budget: 'Exclusive culinary adventure',
    rating: 4.9,
    image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200',
    images: ['https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200','https://images.unsplash.com/photo-1424847651672-bf20a4b0982b?w=1200'],
    travelTime: '18m',
    distance: '5.3 km',
    experienceType: 'romantic',
    priceRange: '$45-65',
    pricePerPerson: 55,
    highlights: ['Secret location', '5-course mystery menu', 'Limited to 20 guests', 'Wine pairings included'],
    fullDescription: 'An exclusive underground dining experience hosted by a renowned chef in a secret location. Enjoy a surprise 5-course tasting menu with wine pairings, intimate atmosphere, and culinary storytelling.',
    address: 'Secret Location - Address Sent 48h Before',
    openingHours: 'Sat 7PM seating only (Monthly Event)',
    phoneNumber: '(415) 555-5050',
    website: 'https://undergroundsupper.club',
    tags: ['Secret', 'Supper Club', 'Fine Dining', 'Mystery', 'Exclusive'],
    matchScore: 96,
    matchFactors: {location: 92, budget: 88, category: 100, time: 96, popularity: 94},
    socialStats: {views: 3892, likes: 623, saves: 498, shares: 234},
    reviewCount: 623,
    purchaseOptions: [
      {id: 'supper-standard', title: 'Standard Seating', description: '5-course menu', price: 55, currency: 'USD', includes: ['5-course tasting menu', 'Wine pairings', 'Welcome champagne', 'Chef Q&A'], duration: '3-4 hours', popular: true},
      {id: 'supper-premium', title: 'Chef\'s Table', description: 'Front row seat', price: 85, currency: 'USD', includes: ['Chef\'s table seating', 'Extended 7-course menu', 'Premium wine pairings', 'Kitchen tour', 'Recipe card'], duration: '4 hours'}
    ]
  },

  {
    id: 'freestyle-004',
    title: 'Skyline Cinema - Rooftop Movie Night',
    category: 'freestyle',
    categoryIcon: Sparkles,
    timeAway: '22 min away',
    description: 'Outdoor cinema on a downtown rooftop with craft cocktails and city views',
    budget: 'Romantic cinema experience',
    rating: 4.7,
    image: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1200',
    images: ['https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1200','https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1200'],
    travelTime: '22m',
    distance: '6.8 km',
    experienceType: 'romantic',
    priceRange: '$25-40',
    pricePerPerson: 32,
    highlights: ['Rooftop setting with skyline views', 'Craft cocktail bar', 'Blankets and cushions provided', 'Curated classic films'],
    fullDescription: 'Watch classic and indie films under the stars on a downtown rooftop. Enjoy craft cocktails, gourmet snacks, and stunning city skyline views. Cozy blankets and cushions provided for the ultimate outdoor cinema experience.',
    address: '555 Market Street Rooftop, San Francisco, CA 94105',
    openingHours: 'Thu-Sun 8PM screenings (Summer Cinema Series)',
    phoneNumber: '(415) 555-6060',
    website: 'https://skylinecinema.com',
    tags: ['Rooftop', 'Cinema', 'Cocktails', 'Romantic', 'Urban'],
    matchScore: 93,
    matchFactors: {location: 90, budget: 92, category: 96, time: 94, popularity: 93},
    socialStats: {views: 6432, likes: 1089, saves: 723, shares: 356},
    reviewCount: 1089,
    purchaseOptions: [
      {id: 'cinema-basic', title: 'General Admission', description: 'Rooftop movie access', price: 25, currency: 'USD', includes: ['Rooftop entry', 'Blanket & cushions', 'Complimentary popcorn'], duration: '3 hours'},
      {id: 'cinema-premium', title: 'Premium Viewing', description: 'Best seats + drinks', price: 40, currency: 'USD', includes: ['Reserved premium seating', 'Blanket & cushions', '2 craft cocktails', 'Gourmet snack box'], duration: '3.5 hours', popular: true},
      {id: 'cinema-vip', title: 'Couples Package', description: 'Romantic experience', price: 75, currency: 'USD', includes: ['Private loveseat area', 'Bottle of prosecco', 'Deluxe snack platter', 'Rose & chocolates'], duration: '4 hours'}
    ]
  },

  {
    id: 'freestyle-005',
    title: 'Lunar Festival - Cultural Celebration',
    category: 'freestyle',
    categoryIcon: Sparkles,
    timeAway: '15 min away',
    description: 'Annual cultural festival with traditional performances, lanterns, and authentic cuisine',
    budget: 'Cultural celebration',
    rating: 4.8,
    image: 'https://images.unsplash.com/photo-1519378058457-4c29a0a2efac?w=1200',
    images: ['https://images.unsplash.com/photo-1519378058457-4c29a0a2efac?w=1200','https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=1200'],
    travelTime: '15m',
    distance: '4.2 km',
    experienceType: 'friendly',
    priceRange: '$10-30',
    pricePerPerson: 20,
    highlights: ['Traditional dance performances', 'Lantern lighting ceremony', 'Authentic street food', 'Cultural workshops'],
    fullDescription: 'Celebrate lunar traditions with this vibrant cultural festival featuring traditional performances, lantern lighting ceremony, authentic cuisine from multiple regions, and hands-on cultural workshops. A beautiful blend of heritage and celebration.',
    address: 'Golden Gate Park Main Lawn, San Francisco, CA 94118',
    openingHours: 'Annual Event - Check website for dates',
    phoneNumber: '(415) 555-7070',
    website: 'https://lunarfestival-sf.org',
    tags: ['Festival', 'Cultural', 'Family-Friendly', 'Traditional', 'Community'],
    matchScore: 89,
    matchFactors: {location: 92, budget: 95, category: 88, time: 85, popularity: 90},
    socialStats: {views: 9876, likes: 2134, saves: 1234, shares: 567},
    reviewCount: 2134,
    purchaseOptions: [
      {id: 'festival-free', title: 'Free Entry', description: 'General admission', price: 0, currency: 'USD', includes: ['Festival entry', 'All performances', 'Cultural displays'], duration: '2-4 hours'},
      {id: 'festival-foodie', title: 'Food Pass', description: 'Entry + food credits', price: 20, currency: 'USD', includes: ['Festival entry', '$15 food vendor credits', 'VIP seating area', 'Festival tote bag'], duration: '2-4 hours', popular: true},
      {id: 'festival-vip', title: 'Cultural Immersion Pass', description: 'Full experience', price: 35, currency: 'USD', includes: ['VIP entry', '$20 food credits', 'Hands-on workshop ticket', 'Lantern kit', 'Cultural performance program'], duration: '3-5 hours'}
    ]
  }
];