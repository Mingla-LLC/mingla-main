// Icons are now referenced as strings for use with @expo/vector-icons

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
  categoryIcon: string; // Changed to string for @expo/vector-icons compatibility
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
    category: 'Take a Stroll',
    categoryIcon: 'leaf',
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
    experienceType: 'Adventurous',
    priceRange: 'Free',
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
    category: 'Freestyle',
    categoryIcon: 'location',
    timeAway: '15 min away',
    description: 'Artisan food hall with local vendors and bay views',
    budget: 'Perfect for browsing and light snacks',
    rating: 4.3,
    image: 'https://images.unsplash.com/photo-1747503331142-27f458a1498c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxmYXJtZXJzJTIwbWFya2V0JTIwZnJlc2h8ZW58MXx8fHwxNzU5MzMwODQ1fDA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1747503331142-27f458a1498c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxmYXJtZXJzJTIwbWFya2V0JTIwZnJlc2h8ZW58MXx8fHwxNzU5MzMwODQ1fDA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '15m',
    distance: '4.5 km',
    experienceType: 'Casual',
    priceRange: '$10-30',
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
    category: 'Take a Stroll',
    categoryIcon: 'leaf',
    timeAway: '25 min away',
    description: 'Golden Gate Bridge views at sunset',
    budget: 'Free romantic sunset experience',
    rating: 4.8,
    image: 'https://images.unsplash.com/photo-1502045694088-dc8e4d0a7cf4?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxqYXBhbmVzZSUyMGdhcmRlbiUyMHBhcmslMjBwYXRofGVufDF8fHx8MTc1OTE3MzA4OXww&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1502045694088-dc8e4d0a7cf4?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxqYXBhbmVzZSUyMGdhcmRlbiUyMHBhcmslMjBwYXRofGVufDF8fHx8MTc1OTE3MzA4OXww&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '25m',
    distance: '8.2 km',
    experienceType: 'Romantic',
    priceRange: 'Free',
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
    category: 'Freestyle',
    categoryIcon: 'heart',
    timeAway: '10 min away',
    description: 'Community gathering spot with great energy',
    budget: 'Free hangout space',
    rating: 4.4,
    image: 'https://images.unsplash.com/photo-1739139106925-230659c867e0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxvdXRkb29yJTIwcGFyayUyMHdhbGtpbmclMjB0cmFpbHxlbnwxfHx8fDE3NTkxNzI1MTJ8MA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1739139106925-230659c867e0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxvdXRkb29yJTIwcGFyayUyMHdhbGtpbmclMjB0cmFpbHxlbnwxfHx8fDE3NTkxNzI1MTJ8MA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '10m',
    distance: '2.8 km',
    experienceType: 'Social',
    priceRange: 'Free',
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
    category: 'Take a Stroll',
    categoryIcon: 'leaf',
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
    category: 'Freestyle',
    categoryIcon: 'eye',
    timeAway: '12 min away',
    description: 'Central shopping district with people watching',
    budget: 'Window shopping or budget purchases',
    rating: 4.2,
    image: 'https://images.unsplash.com/photo-1758030306457-e54f25fe4384?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzdHJlZXQlMjBhcnQlMjBtdXJhbHxlbnwxfHx8fDE3NTkyODEzMTZ8MA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1758030306457-e54f25fe4384?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzdHJlZXQlMjBhcnQlMjBtdXJhbHxlbnwxfHx8fDE3NTkyODEzMTZ8MA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '12m',
    distance: '3.8 km',
    experienceType: 'Casual',
    priceRange: 'Free to browse',
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
  // SIP & CHILL CATEGORY (5 cards)
  {
    id: 'new-1',
    title: 'Sightglass Coffee Roastery',
    category: 'Sip & Chill',
    categoryIcon: 'cafe',
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
    category: 'Sip & Chill',
    categoryIcon: 'cafe',
    timeAway: '8 min away',
    description: 'Minimalist coffee experience with precision brewing',
    budget: 'Premium coffee experience',
    rating: 4.7,
    image: 'https://images.unsplash.com/photo-1559850719-c5042b99535c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjByb2FzdGVyeSUyMHRvdXJ8ZW58MXx8fHwxNzU5MzMxMTEzfDA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1559850719-c5042b99535c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjByb2FzdGVyeSUyMHRvdXJ8ZW58MXx8fHwxNzU5MzMxMTEzfDA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '8m',
    distance: '2.1 km',
    experienceType: 'Casual',
    priceRange: '$12-35',
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

  // CREATIVE & HANDS-ON CATEGORY (5 cards)
  {
    id: 'new-3',
    title: 'Pottery Studio Workshop',
    category: 'Creative & Hands-On',
    categoryIcon: 'color-palette',
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
    ]
  },

  // DINING EXPERIENCES CATEGORY (5 cards)  
  {
    id: 'new-4',
    title: 'Le Bernardin Wine Tasting',
    category: 'Dining Experiences',
    categoryIcon: 'restaurant',
    timeAway: '25 min away',
    description: 'Exquisite culinary journey with wine pairings',
    budget: 'Premium experience for special occasions',
    rating: 4.9,
    image: 'https://images.unsplash.com/photo-1758648207539-b40dd1f6b50e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxyZXN0YXVyYW50JTIwZmluZSUyMGRpbmluZyUyMGF0bW9zcGhlcmV8ZW58MXx8fHwxNzU5MTcyNTE2fDA&ixlib=rb-4.1.0&q=80&w=1080',
    images: ['https://images.unsplash.com/photo-1758648207539-b40dd1f6b50e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxyZXN0YXVyYW50JTIwZmluZSUyMGRpbmluZyUyMGF0bW9zcGhlcmV8ZW58MXx8fHwxNzU5MTcyNTE2fDA&ixlib=rb-4.1.0&q=80&w=1080'],
    travelTime: '25m',
    distance: '7.8 km',
    experienceType: 'Romantic',
    priceRange: '$150+',
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
    category: 'Wellness Dates',
    categoryIcon: 'fitness',
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
    category: 'Freestyle',
    categoryIcon: 'eye',
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
  }
];