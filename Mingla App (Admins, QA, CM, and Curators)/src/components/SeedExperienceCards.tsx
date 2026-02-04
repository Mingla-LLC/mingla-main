/**
 * Seed Experience Cards - Category-Specific Experiences
 * Each card follows category-specific logic and timeline structure
 */

export const SEED_EXPERIENCE_CARDS = [
  
  // ============================================
  // TAKE A STROLL (3 cards)
  // Logic: Always begins with valid stroll anchor (park, trail, waterfront) + paired food/drink stop
  // ============================================
  
  {
    id: 'stroll-001',
    title: 'Golden Gate Park Stroll + Blue Barn Brunch',
    category: 'stroll',
    categoryIcon: '🚶',
    description: 'Peaceful gardens and hidden trails ending at a charming farm-to-table café',
    fullDescription: 'Start at the Japanese Tea Garden, wander through Stow Lake\'s scenic paths, discover the hidden waterfall, and finish with fresh pastries and coffee at Blue Barn Café. Perfect for easy conversation and connection.',
    experienceType: 'firstDate',
    priceRange: '$8-18',
    budget: 'Budget-friendly outdoor escape',
    rating: 4.8,
    reviewCount: 1456,
    address: 'Golden Gate Park, San Francisco, CA 94118',
    location: 'Golden Gate Park, San Francisco, CA',
    openingHours: 'Daily 6AM-8PM',
    travelTime: '10 min drive',
    distance: '2.5 km walking route',
    highlights: ['Japanese gardens', 'Stow Lake views', 'Hidden waterfall', 'Farm-to-table café', 'Easy conversation'],
    tags: ['park', 'nature', 'coffee', 'scenic', 'walkable', 'first date'],
    matchScore: 94,
    image: 'https://images.unsplash.com/photo-1519331379826-f10be5486c6f?w=800',
    images: [
      'https://images.unsplash.com/photo-1519331379826-f10be5486c6f?w=800',
      'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800',
      'https://images.unsplash.com/photo-1495107334309-fcf20504a5ab?w=800'
    ],
    timeline: {
      arrivalWelcome: {
        description: 'Begin at the Japanese Tea Garden entrance. Admire the peaceful koi ponds and pagoda.',
        locationName: 'Japanese Tea Garden',
        location: 'Hagiwara Tea Garden Dr, San Francisco, CA 94118'
      },
      mainActivity: {
        description: 'Walk the scenic path around Stow Lake. Rent a paddle boat if you\'re feeling playful.',
        locationName: 'Stow Lake',
        location: 'Stow Lake Dr, Golden Gate Park, San Francisco, CA 94118'
      },
      immersionAddon: {
        description: 'Find the hidden Huntington Falls. It\'s a local secret - perfect photo moment.',
        locationName: 'Huntington Falls',
        location: 'Golden Gate Park, San Francisco, CA 94118'
      },
      highlightMoment: {
        description: 'Walk through the Shakespeare Garden and Botanical Gardens if time allows.',
        locationName: 'Shakespeare Garden',
        location: 'Golden Gate Park, San Francisco, CA 94118'
      },
      closingTouch: {
        description: 'End at Blue Barn Café for fresh pastries, coffee, and wholesome brunch options.',
        locationName: 'Blue Barn Café',
        location: '2105 Chestnut St, San Francisco, CA 94123'
      }
    },
    routeSteps: [
      { id: 'step-1', order: 1, name: 'Japanese Tea Garden', address: 'Hagiwara Tea Garden Dr, SF', description: 'Start your stroll at this peaceful oasis', dwellTime: 15, notes: 'Small entry fee on weekdays', isPassThrough: false },
      { id: 'step-2', order: 2, name: 'Stow Lake Path', address: 'Stow Lake Dr, SF', description: 'Scenic 30-minute walk around the lake', dwellTime: 30, notes: 'Mostly flat, easy terrain', isPassThrough: false },
      { id: 'step-3', order: 3, name: 'Huntington Falls', address: 'Golden Gate Park, SF', description: 'Hidden waterfall viewpoint', dwellTime: 10, notes: 'Great for photos', isPassThrough: false },
      { id: 'step-4', order: 4, name: 'Blue Barn Café', address: '2105 Chestnut St, SF', description: 'Farm-to-table café with excellent coffee', dwellTime: 35, notes: 'Can be busy on weekends', isPassThrough: false }
    ],
    isMultiStop: true,
    totalDistance: '2.5 km',
    transportMode: 'walking',
    weatherDependent: true,
    socialStats: {
      views: 4820,
      likes: 756,
      saves: 298,
      shares: 142
    },
    matchFactors: {
      location: 92,
      budget: 96,
      category: 94,
      time: 90,
      popularity: 89
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  {
    id: 'stroll-002',
    title: 'Lands End Coastal Trail + Cliff House Coffee',
    category: 'stroll',
    categoryIcon: '🚶',
    description: 'Dramatic cliffside views with crashing waves and historic café finale',
    fullDescription: 'Walk the rugged Lands End trail with breathtaking ocean views, explore the Sutro Baths ruins, and warm up with coffee at the iconic Cliff House overlooking the Pacific.',
    experienceType: 'romantic',
    priceRange: '$6-14',
    budget: 'Free trail with café option',
    rating: 4.9,
    reviewCount: 2134,
    address: 'Lands End Trailhead, San Francisco, CA 94121',
    location: 'Lands End, San Francisco, CA',
    openingHours: 'Daily sunrise-sunset',
    travelTime: '18 min drive',
    distance: '2.1 km coastal trail',
    highlights: ['Ocean cliffs', 'Sutro Baths ruins', 'Golden Gate views', 'Historic Cliff House', 'Photo opportunities'],
    tags: ['waterfront', 'nature', 'historic', 'scenic', 'coffee', 'romantic'],
    matchScore: 96,
    image: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800',
    images: [
      'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800',
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800',
      'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=800'
    ],
    timeline: {
      arrivalWelcome: {
        description: 'Start at the Lands End trailhead. Take in the expansive Pacific views.',
        locationName: 'Lands End Trailhead',
        location: '680 Point Lobos Ave, San Francisco, CA 94121'
      },
      mainActivity: {
        description: 'Walk the coastal trail along dramatic cliffs. Listen to waves crashing below.',
        locationName: 'Lands End Coastal Trail',
        location: 'Lands End Trail, San Francisco, CA 94121'
      },
      immersionAddon: {
        description: 'Descend to explore the hauntingly beautiful Sutro Baths ruins.',
        locationName: 'Sutro Baths Ruins',
        location: 'Point Lobos Ave, San Francisco, CA 94121'
      },
      highlightMoment: {
        description: 'Find the hidden labyrinth viewpoint overlooking the Golden Gate Bridge.',
        locationName: 'Lands End Labyrinth',
        location: 'Lands End Trail, San Francisco, CA 94121'
      },
      closingTouch: {
        description: 'Warm up at Cliff House with coffee, hot chocolate, or a full meal with ocean views.',
        locationName: 'Cliff House',
        location: '1090 Point Lobos Ave, San Francisco, CA 94121'
      }
    },
    routeSteps: [
      { id: 'step-1', order: 1, name: 'Lands End Trailhead', address: '680 Point Lobos Ave, SF', description: 'Begin your coastal adventure', dwellTime: 5, notes: 'Free parking available', isPassThrough: false },
      { id: 'step-2', order: 2, name: 'Coastal Trail', address: 'Lands End Trail, SF', description: 'Scenic ~30 minute cliffside walk', dwellTime: 30, notes: 'Can be windy, bring layers', isPassThrough: false },
      { id: 'step-3', order: 3, name: 'Sutro Baths', address: 'Point Lobos Ave, SF', description: 'Explore historic ruins', dwellTime: 15, notes: 'Watch for slippery surfaces', isPassThrough: false },
      { id: 'step-4', order: 4, name: 'Cliff House', address: '1090 Point Lobos Ave, SF', description: 'Historic café with panoramic views', dwellTime: 35, notes: 'Great for sunset visits', isPassThrough: false }
    ],
    isMultiStop: true,
    totalDistance: '2.1 km',
    transportMode: 'walking',
    weatherDependent: true,
    socialStats: {
      views: 6240,
      likes: 1034,
      saves: 445,
      shares: 212
    },
    matchFactors: {
      location: 94,
      budget: 98,
      category: 96,
      time: 88,
      popularity: 92
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  {
    id: 'stroll-003',
    title: 'Crissy Field Beach Walk + Equator Coffee',
    category: 'stroll',
    categoryIcon: '🚶',
    description: 'Flat beachside stroll with bridge views and artisan coffee stop',
    fullDescription: 'Easy walking along Crissy Field beach with unobstructed Golden Gate Bridge views, then cozy up at Equator Coffees roastery with specialty drinks and pastries.',
    experienceType: 'friendly',
    priceRange: '$7-16',
    budget: 'Free walk + affordable café',
    rating: 4.7,
    reviewCount: 1688,
    address: 'Crissy Field, San Francisco, CA 94129',
    location: 'Presidio, San Francisco, CA',
    openingHours: 'Daily 6AM-9PM',
    travelTime: '15 min drive',
    distance: '2.8 km beachfront path',
    highlights: ['Golden Gate Bridge views', 'Flat easy walk', 'Beach access', 'Dog-friendly', 'Specialty coffee'],
    tags: ['beach', 'waterfront', 'nature', 'coffee', 'easy walk', 'dog-friendly'],
    matchScore: 92,
    image: 'https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=800',
    images: [
      'https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=800',
      'https://images.unsplash.com/photo-1449034446853-66c86144b0ad?w=800',
      'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800'
    ],
    timeline: {
      arrivalWelcome: {
        description: 'Start at the Crissy Field East Beach parking area. Enjoy unobstructed bridge views.',
        locationName: 'Crissy Field East Beach',
        location: 'Crissy Field, San Francisco, CA 94129'
      },
      mainActivity: {
        description: 'Walk the flat, paved beachside path. Perfect for side-by-side conversation.',
        locationName: 'Crissy Field Promenade',
        location: 'Crissy Field Promenade, San Francisco, CA 94129'
      },
      immersionAddon: {
        description: 'Optional: Walk down to the beach. Feel the sand and watch kite surfers.',
        locationName: 'Crissy Field Beach',
        location: 'Crissy Field Beach, San Francisco, CA 94129'
      },
      highlightMoment: {
        description: 'Reach the Fort Point pier for the closest bridge views. Perfect photo spot.',
        locationName: 'Fort Point Pier',
        location: 'Fort Point, San Francisco, CA 94129'
      },
      closingTouch: {
        description: 'Warm up at Equator Coffees roastery with specialty drinks and fresh pastries.',
        locationName: 'Equator Coffees',
        location: '986 Fort Barry, Sausalito, CA 94965'
      }
    },
    routeSteps: [
      { id: 'step-1', order: 1, name: 'Crissy Field East Beach', address: 'Crissy Field, SF', description: 'Begin at this popular beach spot', dwellTime: 10, notes: 'Restrooms available', isPassThrough: false },
      { id: 'step-2', order: 2, name: 'Promenade Walk', address: 'Crissy Field Promenade, SF', description: '~30 minute flat beachside walk', dwellTime: 30, notes: 'Wheelchair accessible', isPassThrough: false },
      { id: 'step-3', order: 3, name: 'Fort Point View', address: 'Fort Point, SF', description: 'Closest bridge viewpoint', dwellTime: 10, notes: 'Often windy', isPassThrough: false },
      { id: 'step-4', order: 4, name: 'Equator Coffees', address: '986 Fort Barry, Sausalito', description: 'Roastery with specialty drinks', dwellTime: 30, notes: 'Outdoor seating available', isPassThrough: false }
    ],
    isMultiStop: true,
    totalDistance: '2.8 km',
    transportMode: 'walking',
    weatherDependent: true,
    socialStats: {
      views: 3890,
      likes: 645,
      saves: 234,
      shares: 98
    },
    matchFactors: {
      location: 90,
      budget: 94,
      category: 92,
      time: 91,
      popularity: 86
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  // ============================================
  // SIP & CHILL (3 cards)
  // Logic: Single-location venue centered on drinks and ambience
  // Timeline: Arrive → Sip → Chill → Wrap-Up (~1.5 hours)
  // ============================================

  {
    id: 'sip-001',
    title: 'The Riddler Champagne Bar',
    category: 'sipChill',
    categoryIcon: '☕',
    description: 'Elegant champagne lounge with curated bubbles and chic ambience',
    fullDescription: 'A sophisticated yet approachable champagne bar in Hayes Valley. Order by the glass or bottle, enjoy oysters and small plates, and sink into the plush velvet seating.',
    experienceType: 'romantic',
    priceRange: '$35-65',
    budget: 'Mid-range sophisticated drinks',
    rating: 4.8,
    reviewCount: 892,
    address: '528 Laguna St, San Francisco, CA 94102',
    location: 'Hayes Valley, San Francisco, CA',
    openingHours: 'Wed-Sun 4PM-11PM',
    travelTime: '8 min walk',
    distance: 'Single venue',
    highlights: ['Champagne selection', 'Oyster bar', 'Elegant ambience', 'Date-night vibe', 'Photo-worthy decor'],
    tags: ['champagne', 'wine', 'oysters', 'elegant', 'romantic', 'small plates'],
    matchScore: 94,
    image: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=800',
    images: [
      'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=800',
      'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=800',
      'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=800'
    ],
    timeline: {
      arrivalWelcome: {
        description: 'Arrive and check in at the host stand. Take in the gorgeous pink and gold decor.',
        locationName: 'The Riddler - Arrival',
        location: '528 Laguna St, San Francisco, CA 94102'
      },
      mainActivity: {
        description: 'Order a glass of champagne or a flight to sample. Browse the curated selection.',
        locationName: 'The Riddler - Bar',
        location: '528 Laguna St, San Francisco, CA 94102'
      },
      immersionAddon: {
        description: 'Add oysters or small plates. The caviar service is spectacular if you\'re celebrating.',
        locationName: 'The Riddler - Dining',
        location: '528 Laguna St, San Francisco, CA 94102'
      },
      highlightMoment: {
        description: 'Settle into the plush seating. The ambience is perfect for intimate conversation.',
        locationName: 'The Riddler - Lounge',
        location: '528 Laguna St, San Francisco, CA 94102'
      },
      closingTouch: {
        description: 'Finish your drinks and soak in the last moments before heading out into Hayes Valley.',
        locationName: 'The Riddler - Wrap-Up',
        location: '528 Laguna St, San Francisco, CA 94102'
      }
    },
    routeSteps: [
      { id: 'step-1', order: 1, name: 'Arrival & Check-In', address: '528 Laguna St, SF', description: 'Welcome to The Riddler', dwellTime: 5, notes: 'Reservations recommended', isPassThrough: false },
      { id: 'step-2', order: 2, name: 'Order Drinks', address: '528 Laguna St, SF', description: 'Choose from curated champagne list', dwellTime: 30, notes: 'Flights available', isPassThrough: false },
      { id: 'step-3', order: 3, name: 'Sip & Snack', address: '528 Laguna St, SF', description: 'Enjoy champagne with oysters or plates', dwellTime: 45, notes: 'Small plates to share', isPassThrough: false },
      { id: 'step-4', order: 4, name: 'Chill & Converse', address: '528 Laguna St, SF', description: 'Relax in the elegant lounge', dwellTime: 30, notes: 'Perfect date spot', isPassThrough: false }
    ],
    isMultiStop: false,
    totalDistance: '0 km (single venue)',
    transportMode: 'walking',
    weatherDependent: false,
    socialStats: {
      views: 5240,
      likes: 823,
      saves: 367,
      shares: 156
    },
    matchFactors: {
      location: 88,
      budget: 80,
      category: 96,
      time: 92,
      popularity: 90
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  {
    id: 'sip-002',
    title: 'Sightglass Coffee Flagship',
    category: 'sipChill',
    categoryIcon: '☕',
    description: 'Industrial-chic coffee roastery with specialty brews and workspace vibes',
    fullDescription: 'Experience coffee culture at its finest in this soaring warehouse space. Watch roasters at work, order pour-overs made to perfection, and enjoy the creative community atmosphere.',
    experienceType: 'friendly',
    priceRange: '$8-16',
    budget: 'Affordable specialty coffee',
    rating: 4.7,
    reviewCount: 1567,
    address: '270 7th St, San Francisco, CA 94103',
    location: 'SoMa, San Francisco, CA',
    openingHours: 'Daily 7AM-7PM',
    travelTime: '5 min walk',
    distance: 'Single venue',
    highlights: ['Specialty coffee', 'In-house roasting', 'Industrial design', 'Pastries', 'Community vibe'],
    tags: ['coffee', 'cafe', 'workspace', 'pastries', 'specialty', 'community'],
    matchScore: 90,
    image: 'https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=800',
    images: [
      'https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=800',
      'https://images.unsplash.com/photo-1447933601403-0c6688de566e?w=800',
      'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=800'
    ],
    timeline: {
      arrivalWelcome: {
        description: 'Enter the impressive warehouse space. Notice the roasting equipment and high ceilings.',
        locationName: 'Sightglass - Entrance',
        location: '270 7th St, San Francisco, CA 94103'
      },
      mainActivity: {
        description: 'Order at the counter. Try a pour-over for the full experience or grab an espresso.',
        locationName: 'Sightglass - Counter',
        location: '270 7th St, San Francisco, CA 94103'
      },
      immersionAddon: {
        description: 'Add a pastry or toast. The almond croissants are beloved.',
        locationName: 'Sightglass - Pastry Bar',
        location: '270 7th St, San Francisco, CA 94103'
      },
      highlightMoment: {
        description: 'Find a spot at the communal tables or cozy corner. Sip slowly and people-watch.',
        locationName: 'Sightglass - Seating',
        location: '270 7th St, San Francisco, CA 94103'
      },
      closingTouch: {
        description: 'Browse the retail area for beans to take home. Chat with baristas about recommendations.',
        locationName: 'Sightglass - Retail',
        location: '270 7th St, San Francisco, CA 94103'
      }
    },
    routeSteps: [
      { id: 'step-1', order: 1, name: 'Arrive & Explore', address: '270 7th St, SF', description: 'Take in the impressive space', dwellTime: 5, notes: 'Can be busy mornings', isPassThrough: false },
      { id: 'step-2', order: 2, name: 'Order Specialty Coffee', address: '270 7th St, SF', description: 'Choose your brew method', dwellTime: 10, notes: 'Pour-overs take ~5 min', isPassThrough: false },
      { id: 'step-3', order: 3, name: 'Sip & Chill', address: '270 7th St, SF', description: 'Relax at communal or corner tables', dwellTime: 60, notes: 'Laptop-friendly', isPassThrough: false },
      { id: 'step-4', order: 4, name: 'Wrap-Up', address: '270 7th St, SF', description: 'Browse retail beans before leaving', dwellTime: 10, notes: 'Beans make great gifts', isPassThrough: false }
    ],
    isMultiStop: false,
    totalDistance: '0 km (single venue)',
    transportMode: 'walking',
    weatherDependent: false,
    socialStats: {
      views: 4120,
      likes: 678,
      saves: 289,
      shares: 123
    },
    matchFactors: {
      location: 92,
      budget: 96,
      category: 94,
      time: 90,
      popularity: 88
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  {
    id: 'sip-003',
    title: 'The Interval at Long Now',
    category: 'sipChill',
    categoryIcon: '☕',
    description: 'Unique bar/café with rare spirits, books, and thought-provoking atmosphere',
    fullDescription: 'A one-of-a-kind space combining a bar, café, library, and museum. Sip rare cocktails or coffee surrounded by artifacts and books about long-term thinking.',
    experienceType: 'firstDate',
    priceRange: '$12-28',
    budget: 'Moderate with unique experience',
    rating: 4.6,
    reviewCount: 743,
    address: '2 Marina Blvd, San Francisco, CA 94123',
    location: 'Fort Mason, San Francisco, CA',
    openingHours: 'Wed-Sun 2PM-10PM',
    travelTime: '12 min drive',
    distance: 'Single venue',
    highlights: ['Rare spirits', 'Coffee drinks', 'Library atmosphere', 'Unique ambience', 'Conversation starter'],
    tags: ['cocktails', 'coffee', 'unique', 'cultural', 'conversation', 'museum'],
    matchScore: 93,
    image: 'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=800',
    images: [
      'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=800',
      'https://images.unsplash.com/photo-1521017432531-fbd92d768814?w=800',
      'https://images.unsplash.com/photo-1481833761820-0509d3217039?w=800'
    ],
    timeline: {
      arrivalWelcome: {
        description: 'Enter Fort Mason and find The Interval. Notice the unique decor and 10,000-year clock.',
        locationName: 'The Interval - Entrance',
        location: '2 Marina Blvd, San Francisco, CA 94123'
      },
      mainActivity: {
        description: 'Order at the bar. Choose from rare spirits, creative cocktails, or specialty coffee.',
        locationName: 'The Interval - Bar',
        location: '2 Marina Blvd, San Francisco, CA 94123'
      },
      immersionAddon: {
        description: 'Browse the curated library of books about long-term thinking and civilization.',
        locationName: 'The Interval - Library',
        location: '2 Marina Blvd, San Francisco, CA 94123'
      },
      highlightMoment: {
        description: 'Settle into a cozy nook. The unique atmosphere naturally sparks deep conversations.',
        locationName: 'The Interval - Seating',
        location: '2 Marina Blvd, San Francisco, CA 94123'
      },
      closingTouch: {
        description: 'Take a final look at the exhibits before leaving. Perhaps walk the nearby waterfront.',
        locationName: 'The Interval - Exit',
        location: '2 Marina Blvd, San Francisco, CA 94123'
      }
    },
    routeSteps: [
      { id: 'step-1', order: 1, name: 'Arrive at Fort Mason', address: '2 Marina Blvd, SF', description: 'Find The Interval inside Fort Mason', dwellTime: 5, notes: 'Unique location', isPassThrough: false },
      { id: 'step-2', order: 2, name: 'Order Drinks', address: '2 Marina Blvd, SF', description: 'Choose from rare spirits or coffee', dwellTime: 15, notes: 'Ask bartender for recommendations', isPassThrough: false },
      { id: 'step-3', order: 3, name: 'Explore & Browse', address: '2 Marina Blvd, SF', description: 'Check out library and exhibits', dwellTime: 20, notes: 'Great conversation starters', isPassThrough: false },
      { id: 'step-4', order: 4, name: 'Sip & Converse', address: '2 Marina Blvd, SF', description: 'Relax in unique atmosphere', dwellTime: 50, notes: 'Perfect for meaningful talks', isPassThrough: false }
    ],
    isMultiStop: false,
    totalDistance: '0 km (single venue)',
    transportMode: 'walking',
    weatherDependent: false,
    socialStats: {
      views: 3560,
      likes: 587,
      saves: 245,
      shares: 98
    },
    matchFactors: {
      location: 85,
      budget: 88,
      category: 95,
      time: 90,
      popularity: 84
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  // ============================================
  // CASUAL EATS (2 cards)
  // Logic: Affordable, single-location food venue
  // Timeline: Arrive → Eat → Finish (~45-60 minutes)
  // ============================================

  {
    id: 'casual-001',
    title: 'La Taqueria Mission Burritos',
    category: 'casualEats',
    categoryIcon: '🌮',
    description: 'Legendary Mission-style burritos in a no-frills neighborhood spot',
    fullDescription: 'Experience San Francisco\'s most famous burrito at this James Beard Award-winning taqueria. Order at the counter, grab a table, and enjoy perfectly grilled meat wrapped in a flour tortilla.',
    experienceType: 'friendly',
    priceRange: '$12-18',
    budget: 'Budget-friendly authentic food',
    rating: 4.8,
    reviewCount: 3456,
    address: '2889 Mission St, San Francisco, CA 94110',
    location: 'Mission District, San Francisco, CA',
    openingHours: 'Mon-Sat 11AM-9PM, Sun 11AM-8PM',
    travelTime: '8 min walk from BART',
    distance: 'Single venue',
    highlights: ['Famous burritos', 'Fresh ingredients', 'No rice option', 'Local institution', 'Quick service'],
    tags: ['mexican', 'burritos', 'affordable', 'casual', 'local favorite', 'quick'],
    matchScore: 91,
    image: 'https://images.unsplash.com/photo-1626700051175-6818013e1d4f?w=800',
    images: [
      'https://images.unsplash.com/photo-1626700051175-6818013e1d4f?w=800',
      'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=800',
      'https://images.unsplash.com/photo-1599974718874-e48e3e8d4119?w=800'
    ],
    timeline: {
      arrivalWelcome: {
        description: 'Join the line at the counter. Notice the James Beard Award on the wall.',
        locationName: 'La Taqueria - Counter',
        location: '2889 Mission St, San Francisco, CA 94110'
      },
      mainActivity: {
        description: 'Order your burrito. The carne asada and carnitas are legendary. Try it without rice.',
        locationName: 'La Taqueria - Order',
        location: '2889 Mission St, San Francisco, CA 94110'
      },
      immersionAddon: {
        description: 'Grab a table and add salsa from the bar. The red salsa has a kick.',
        locationName: 'La Taqueria - Seating',
        location: '2889 Mission St, San Francisco, CA 94110'
      },
      highlightMoment: {
        description: 'Enjoy your burrito. The simple ingredients shine through.',
        locationName: 'La Taqueria - Dining',
        location: '2889 Mission St, San Francisco, CA 94110'
      },
      closingTouch: {
        description: 'Finish up and explore the Mission District neighborhood afterward.',
        locationName: 'La Taqueria - Wrap-Up',
        location: '2889 Mission St, San Francisco, CA 94110'
      }
    },
    routeSteps: [
      { id: 'step-1', order: 1, name: 'Arrive & Queue', address: '2889 Mission St, SF', description: 'Join the line at this legendary spot', dwellTime: 10, notes: 'Can have long lines', isPassThrough: false },
      { id: 'step-2', order: 2, name: 'Order', address: '2889 Mission St, SF', description: 'Choose your burrito or tacos', dwellTime: 5, notes: 'Ask for no rice - traditional style', isPassThrough: false },
      { id: 'step-3', order: 3, name: 'Eat & Enjoy', address: '2889 Mission St, SF', description: 'Dine in the casual space', dwellTime: 30, notes: 'Don\'t forget salsa bar', isPassThrough: false },
      { id: 'step-4', order: 4, name: 'Finish', address: '2889 Mission St, SF', description: 'Wrap up and head out', dwellTime: 5, notes: 'Explore Mission murals nearby', isPassThrough: false }
    ],
    isMultiStop: false,
    totalDistance: '0 km (single venue)',
    transportMode: 'walking',
    weatherDependent: false,
    socialStats: {
      views: 6780,
      likes: 1123,
      saves: 456,
      shares: 234
    },
    matchFactors: {
      location: 94,
      budget: 98,
      category: 96,
      time: 92,
      popularity: 95
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  {
    id: 'casual-002',
    title: 'Tartine Bakery Morning Pastries',
    category: 'casualEats',
    categoryIcon: '🥐',
    description: 'World-famous bakery with morning buns, croissants, and fresh bread',
    fullDescription: 'Join the locals queuing for the city\'s best pastries. Grab a morning bun or almond croissant, order coffee, and enjoy breakfast in this beloved Mission institution.',
    experienceType: 'firstDate',
    priceRange: '$10-20',
    budget: 'Affordable bakery experience',
    rating: 4.7,
    reviewCount: 2890,
    address: '600 Guerrero St, San Francisco, CA 94110',
    location: 'Mission District, San Francisco, CA',
    openingHours: 'Mon-Sun 8AM-7PM',
    travelTime: '6 min walk',
    distance: 'Single venue',
    highlights: ['Famous morning buns', 'Fresh croissants', 'Artisan bread', 'Great coffee', 'Outdoor seating'],
    tags: ['bakery', 'pastries', 'coffee', 'breakfast', 'affordable', 'local favorite'],
    matchScore: 89,
    image: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800',
    images: [
      'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800',
      'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800',
      'https://images.unsplash.com/photo-1486427944299-d1955d23e34d?w=800'
    ],
    timeline: {
      arrivalWelcome: {
        description: 'Arrive early to beat the crowds. The line moves quickly.',
        locationName: 'Tartine - Entrance',
        location: '600 Guerrero St, San Francisco, CA 94110'
      },
      mainActivity: {
        description: 'Order at the counter. Don\'t miss the morning buns and almond croissants.',
        locationName: 'Tartine - Counter',
        location: '600 Guerrero St, San Francisco, CA 94110'
      },
      immersionAddon: {
        description: 'Add a coffee from the espresso bar. The cappuccinos are excellent.',
        locationName: 'Tartine - Coffee Bar',
        location: '600 Guerrero St, San Francisco, CA 94110'
      },
      highlightMoment: {
        description: 'Find seating inside or grab the outdoor benches. Enjoy your fresh pastries.',
        locationName: 'Tartine - Seating',
        location: '600 Guerrero St, San Francisco, CA 94110'
      },
      closingTouch: {
        description: 'Browse the bread selection for take-home loaves before leaving.',
        locationName: 'Tartine - Wrap-Up',
        location: '600 Guerrero St, San Francisco, CA 94110'
      }
    },
    routeSteps: [
      { id: 'step-1', order: 1, name: 'Arrive', address: '600 Guerrero St, SF', description: 'Join the line at famous Tartine', dwellTime: 15, notes: 'Arrive early for best selection', isPassThrough: false },
      { id: 'step-2', order: 2, name: 'Order Pastries', address: '600 Guerrero St, SF', description: 'Choose your treats', dwellTime: 5, notes: 'Morning buns sell out fast', isPassThrough: false },
      { id: 'step-3', order: 3, name: 'Eat & Enjoy', address: '600 Guerrero St, SF', description: 'Savor your breakfast', dwellTime: 35, notes: 'Limited indoor seating', isPassThrough: false },
      { id: 'step-4', order: 4, name: 'Finish', address: '600 Guerrero St, SF', description: 'Browse bread before leaving', dwellTime: 5, notes: 'Great picnic bread options', isPassThrough: false }
    ],
    isMultiStop: false,
    totalDistance: '0 km (single venue)',
    transportMode: 'walking',
    weatherDependent: false,
    socialStats: {
      views: 5240,
      likes: 876,
      saves: 345,
      shares: 167
    },
    matchFactors: {
      location: 92,
      budget: 94,
      category: 94,
      time: 90,
      popularity: 93
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  // ============================================
  // SCREEN & RELAX (2 cards)
  // Logic: Cinema/theater venues with entertainment focus
  // Timeline: Arrive → Enjoy Show → Wrap-Up (~2 hours total)
  // ============================================

  {
    id: 'screen-001',
    title: 'Alamo Drafthouse Cinema Experience',
    category: 'screenRelax',
    categoryIcon: '🎬',
    description: 'Premium movie theater with dinner service, craft drinks, and strict no-talking policy',
    fullDescription: 'Watch the latest films while servers bring gourmet food and craft cocktails to your seat. Enjoy pre-show entertainment, comfortable recliners, and a serious movie-watching atmosphere.',
    experienceType: 'romantic',
    priceRange: '$45-75',
    budget: 'Premium movie experience',
    rating: 4.7,
    reviewCount: 2134,
    address: '2550 Mission St, San Francisco, CA 94110',
    location: 'Mission District, San Francisco, CA',
    openingHours: 'Daily 2PM-12AM',
    travelTime: '10 min drive',
    distance: 'Single venue',
    highlights: ['Dinner at your seat', 'Craft cocktails', 'Premium recliners', 'No talking policy', 'Pre-show entertainment'],
    tags: ['cinema', 'dinner', 'cocktails', 'premium', 'date night', 'indoor'],
    matchScore: 92,
    image: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800',
    images: [
      'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800',
      'https://images.unsplash.com/photo-1595769816263-9b910be24d5f?w=800',
      'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=800'
    ],
    timeline: {
      arrivalWelcome: {
        description: 'Arrive 30 minutes early. Check in and head to the lobby bar for pre-movie drinks.',
        locationName: 'Alamo Drafthouse - Lobby Bar',
        location: '2550 Mission St, San Francisco, CA 94110'
      },
      mainActivity: {
        description: 'Enter the theater and find your reserved seats. Review the menu and order card.',
        locationName: 'Alamo Drafthouse - Theater',
        location: '2550 Mission St, San Francisco, CA 94110'
      },
      immersionAddon: {
        description: 'Enjoy custom pre-show content - film trivia and themed clips, never boring ads.',
        locationName: 'Alamo Drafthouse - Pre-Show',
        location: '2550 Mission St, San Francisco, CA 94110'
      },
      highlightMoment: {
        description: 'The movie begins. Servers silently deliver your food throughout the film.',
        locationName: 'Alamo Drafthouse - Feature',
        location: '2550 Mission St, San Francisco, CA 94110'
      },
      closingTouch: {
        description: 'After credits, head to the lobby lounge. Discuss the film over dessert or nightcap.',
        locationName: 'Alamo Drafthouse - Post-Movie',
        location: '2550 Mission St, San Francisco, CA 94110'
      }
    },
    routeSteps: [
      { id: 'step-1', order: 1, name: 'Arrive & Bar', address: '2550 Mission St, SF', description: 'Check in and grab pre-movie drinks', dwellTime: 20, notes: 'Arrive 30min early', isPassThrough: false },
      { id: 'step-2', order: 2, name: 'Enter Theater', address: '2550 Mission St, SF', description: 'Find seats and review menu', dwellTime: 10, notes: 'Reserved seating', isPassThrough: false },
      { id: 'step-3', order: 3, name: 'Pre-Show', address: '2550 Mission St, SF', description: 'Watch curated pre-show clips', dwellTime: 15, notes: 'Unique custom content', isPassThrough: false },
      { id: 'step-4', order: 4, name: 'Movie & Dinner', address: '2550 Mission St, SF', description: 'Enjoy film with meal service', dwellTime: 135, notes: 'Service ends 30min before end', isPassThrough: false },
      { id: 'step-5', order: 5, name: 'Post-Movie Lounge', address: '2550 Mission St, SF', description: 'Discuss film in lobby', dwellTime: 20, notes: 'Dessert available', isPassThrough: false }
    ],
    isMultiStop: false,
    totalDistance: '0 km (single venue)',
    transportMode: 'walking',
    weatherDependent: false,
    socialStats: {
      views: 7890,
      likes: 1234,
      saves: 567,
      shares: 289
    },
    matchFactors: {
      location: 88,
      budget: 82,
      category: 97,
      time: 85,
      popularity: 92
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  {
    id: 'screen-002',
    title: 'Castro Theatre Classic Film Night',
    category: 'screenRelax',
    categoryIcon: '🎬',
    description: 'Historic movie palace showing classic films with live organ performances',
    fullDescription: 'Experience cinema in a 1920s movie palace. Watch classic films on the big screen, enjoy live Wurlitzer organ performances, and soak in the ornate atmosphere.',
    experienceType: 'romantic',
    priceRange: '$12-18',
    budget: 'Affordable classic cinema',
    rating: 4.9,
    reviewCount: 3456,
    address: '429 Castro St, San Francisco, CA 94114',
    location: 'Castro District, San Francisco, CA',
    openingHours: 'Varies by showtime',
    travelTime: '5 min walk from Castro Station',
    distance: 'Single venue',
    highlights: ['Historic theater', 'Classic films', 'Live organ music', 'Art Deco design', 'Unique experience'],
    tags: ['cinema', 'historic', 'classic films', 'romantic', 'culture', 'affordable'],
    matchScore: 95,
    image: 'https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=800',
    images: [
      'https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=800',
      'https://images.unsplash.com/photo-1594908900066-3f47337549d8?w=800',
      'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?w=800'
    ],
    timeline: {
      arrivalWelcome: {
        description: 'Arrive at the stunning Castro Theatre marquee. Take photos of the iconic facade.',
        locationName: 'Castro Theatre - Exterior',
        location: '429 Castro St, San Francisco, CA 94114'
      },
      mainActivity: {
        description: 'Enter the ornate lobby. Purchase tickets and grab snacks at the concession stand.',
        locationName: 'Castro Theatre - Lobby',
        location: '429 Castro St, San Francisco, CA 94114'
      },
      immersionAddon: {
        description: 'Find your seats in the beautiful auditorium. Admire the art deco details and chandelier.',
        locationName: 'Castro Theatre - Auditorium',
        location: '429 Castro St, San Francisco, CA 94114'
      },
      highlightMoment: {
        description: 'Watch the Wurlitzer organ rise from below stage for a live pre-show performance.',
        locationName: 'Castro Theatre - Organ Show',
        location: '429 Castro St, San Francisco, CA 94114'
      },
      closingTouch: {
        description: 'Enjoy the classic film on the big screen in this historic setting.',
        locationName: 'Castro Theatre - Feature',
        location: '429 Castro St, San Francisco, CA 94114'
      }
    },
    routeSteps: [
      { id: 'step-1', order: 1, name: 'Arrive', address: '429 Castro St, SF', description: 'Admire the historic marquee', dwellTime: 5, notes: 'Great photo opportunity', isPassThrough: false },
      { id: 'step-2', order: 2, name: 'Lobby & Concessions', address: '429 Castro St, SF', description: 'Get tickets and snacks', dwellTime: 10, notes: 'Cash and card accepted', isPassThrough: false },
      { id: 'step-3', order: 3, name: 'Find Seats', address: '429 Castro St, SF', description: 'Explore the beautiful auditorium', dwellTime: 10, notes: 'No assigned seating', isPassThrough: false },
      { id: 'step-4', order: 4, name: 'Organ Performance', address: '429 Castro St, SF', description: 'Watch live Wurlitzer organ show', dwellTime: 15, notes: 'Unique pre-show tradition', isPassThrough: false },
      { id: 'step-5', order: 5, name: 'Film', address: '429 Castro St, SF', description: 'Enjoy classic movie', dwellTime: 120, notes: 'Film length varies', isPassThrough: false }
    ],
    isMultiStop: false,
    totalDistance: '0 km (single venue)',
    transportMode: 'walking',
    weatherDependent: false,
    socialStats: {
      views: 5670,
      likes: 934,
      saves: 412,
      shares: 198
    },
    matchFactors: {
      location: 92,
      budget: 96,
      category: 98,
      time: 88,
      popularity: 94
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  // ============================================
  // CREATIVE & HANDS-ON (2 cards)
  // Logic: Interactive workshop-style experiences
  // Timeline: Arrive → Create → Optional Add-On → Finish (~1.5-2 hours)
  // ============================================

  {
    id: 'creative-001',
    title: 'Heath Ceramics Hand-Building Workshop',
    category: 'creative',
    categoryIcon: '🎨',
    description: 'Learn pottery hand-building techniques in a beautiful studio setting',
    fullDescription: 'Spend two hours learning pottery basics from expert instructors. Create your own ceramic pieces using hand-building techniques. All materials provided, and your pieces will be fired and ready for pickup in 2-3 weeks.',
    experienceType: 'friendly',
    priceRange: '$85-95',
    budget: 'Mid-range creative class',
    rating: 4.8,
    reviewCount: 567,
    address: '2900 18th St, San Francisco, CA 94110',
    location: 'Mission District, San Francisco, CA',
    openingHours: 'Workshop times vary',
    travelTime: '6 min walk from BART',
    distance: 'Single venue',
    highlights: ['Pottery instruction', 'All materials included', 'Take home your creations', 'Expert teachers', 'Beautiful studio'],
    tags: ['pottery', 'workshop', 'hands-on', 'creative', 'ceramics', 'classes'],
    matchScore: 90,
    image: 'https://images.unsplash.com/photo-1493106641515-6b5631de4bb9?w=800',
    images: [
      'https://images.unsplash.com/photo-1493106641515-6b5631de4bb9?w=800',
      'https://images.unsplash.com/photo-1578589318433-39b5de440c3f?w=800',
      'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800'
    ],
    timeline: {
      arrivalWelcome: {
        description: 'Check in at the studio. Get your apron and workstation setup.',
        locationName: 'Heath Ceramics - Studio',
        location: '2900 18th St, San Francisco, CA 94110'
      },
      mainActivity: {
        description: 'Learn hand-building techniques from your instructor. Work with clay to create your pieces.',
        locationName: 'Heath Ceramics - Workshop',
        location: '2900 18th St, San Francisco, CA 94110'
      },
      immersionAddon: {
        description: 'Get individual guidance as you shape your ceramic creations.',
        locationName: 'Heath Ceramics - Creation Time',
        location: '2900 18th St, San Francisco, CA 94110'
      },
      highlightMoment: {
        description: 'Finish and refine your pieces. Learn about the firing and glazing process.',
        locationName: 'Heath Ceramics - Completion',
        location: '2900 18th St, San Francisco, CA 94110'
      },
      closingTouch: {
        description: 'Browse the Heath Ceramics showroom and factory store before leaving.',
        locationName: 'Heath Ceramics - Showroom',
        location: '2900 18th St, San Francisco, CA 94110'
      }
    },
    routeSteps: [
      { id: 'step-1', order: 1, name: 'Arrive & Check-In', address: '2900 18th St, SF', description: 'Get set up at your workstation', dwellTime: 10, notes: 'Arrive 5min early', isPassThrough: false },
      { id: 'step-2', order: 2, name: 'Learn Techniques', address: '2900 18th St, SF', description: 'Instructor demonstrates hand-building', dwellTime: 30, notes: 'All levels welcome', isPassThrough: false },
      { id: 'step-3', order: 3, name: 'Create', address: '2900 18th St, SF', description: 'Make your ceramic pieces', dwellTime: 60, notes: 'Materials provided', isPassThrough: false },
      { id: 'step-4', order: 4, name: 'Finish & Learn', address: '2900 18th St, SF', description: 'Complete pieces and learn about firing', dwellTime: 15, notes: 'Pickup in 2-3 weeks', isPassThrough: false },
      { id: 'step-5', order: 5, name: 'Browse Showroom', address: '2900 18th St, SF', description: 'Optional shopping time', dwellTime: 15, notes: 'Beautiful ceramics available', isPassThrough: false }
    ],
    isMultiStop: false,
    totalDistance: '0 km (single venue)',
    transportMode: 'walking',
    weatherDependent: false,
    socialStats: {
      views: 3890,
      likes: 645,
      saves: 298,
      shares: 134
    },
    matchFactors: {
      location: 88,
      budget: 82,
      category: 95,
      time: 90,
      popularity: 86
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  {
    id: 'creative-002',
    title: 'The Perish Trust Terrarium Workshop',
    category: 'creative',
    categoryIcon: '🎨',
    description: 'Build your own living terrarium with succulents and air plants',
    fullDescription: 'Create a miniature ecosystem in glass. Learn about plant care, composition, and terrarium maintenance while building your own beautiful creation to take home.',
    experienceType: 'firstDate',
    priceRange: '$65-75',
    budget: 'Moderate creative workshop',
    rating: 4.7,
    reviewCount: 423,
    address: '728 Divisadero St, San Francisco, CA 94117',
    location: 'NoPa, San Francisco, CA',
    openingHours: 'Workshop times vary',
    travelTime: '10 min drive',
    distance: 'Single venue',
    highlights: ['Build a terrarium', 'Learn plant care', 'Take home creation', 'All supplies included', 'Cozy shop setting'],
    tags: ['plants', 'workshop', 'hands-on', 'creative', 'terrarium', 'nature'],
    matchScore: 88,
    image: 'https://images.unsplash.com/photo-1466781783364-36c955e42a7f?w=800',
    images: [
      'https://images.unsplash.com/photo-1466781783364-36c955e42a7f?w=800',
      'https://images.unsplash.com/photo-1485955900006-10f4d324d411?w=800',
      'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=800'
    ],
    timeline: {
      arrivalWelcome: {
        description: 'Arrive at the charming plant shop. Browse the beautiful selection while you wait.',
        locationName: 'The Perish Trust - Shop',
        location: '728 Divisadero St, San Francisco, CA 94117'
      },
      mainActivity: {
        description: 'Join the workshop table. Learn about terrarium layers, drainage, and plant selection.',
        locationName: 'The Perish Trust - Workshop',
        location: '728 Divisadero St, San Francisco, CA 94117'
      },
      immersionAddon: {
        description: 'Choose your plants, stones, and decorative elements. Start layering your terrarium.',
        locationName: 'The Perish Trust - Creation',
        location: '728 Divisadero St, San Francisco, CA 94117'
      },
      highlightMoment: {
        description: 'Arrange your plants and add finishing touches. Get personalized care instructions.',
        locationName: 'The Perish Trust - Finishing',
        location: '728 Divisadero St, San Francisco, CA 94117'
      },
      closingTouch: {
        description: 'Take home your terrarium. Browse additional plants and accessories.',
        locationName: 'The Perish Trust - Wrap-Up',
        location: '728 Divisadero St, San Francisco, CA 94117'
      }
    },
    routeSteps: [
      { id: 'step-1', order: 1, name: 'Arrive & Browse', address: '728 Divisadero St, SF', description: 'Explore the plant shop', dwellTime: 10, notes: 'Beautiful space', isPassThrough: false },
      { id: 'step-2', order: 2, name: 'Workshop Intro', address: '728 Divisadero St, SF', description: 'Learn terrarium basics', dwellTime: 15, notes: 'No experience needed', isPassThrough: false },
      { id: 'step-3', order: 3, name: 'Build Terrarium', address: '728 Divisadero St, SF', description: 'Create your living ecosystem', dwellTime: 60, notes: 'All materials included', isPassThrough: false },
      { id: 'step-4', order: 4, name: 'Finishing Touches', address: '728 Divisadero St, SF', description: 'Complete and learn care tips', dwellTime: 15, notes: 'Easy to maintain', isPassThrough: false },
      { id: 'step-5', order: 5, name: 'Shop & Leave', address: '728 Divisadero St, SF', description: 'Optional plant shopping', dwellTime: 10, notes: 'Take home your creation', isPassThrough: false }
    ],
    isMultiStop: false,
    totalDistance: '0 km (single venue)',
    transportMode: 'walking',
    weatherDependent: false,
    socialStats: {
      views: 2890,
      likes: 478,
      saves: 223,
      shares: 89
    },
    matchFactors: {
      location: 86,
      budget: 84,
      category: 93,
      time: 88,
      popularity: 82
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  // ============================================
  // PICNICS (2 cards)
  // Logic: Always includes paired grocery/food stop + valid outdoor location
  // Timeline: Grocery Stop → Route → Picnic → Optional Add-On → End (~1.5-3 hours)
  // ============================================

  {
    id: 'picnic-001',
    title: 'Dolores Park Picnic with Bi-Rite Stop',
    category: 'picnics',
    categoryIcon: '🧺',
    description: 'Grab gourmet picnic supplies then enjoy SF\'s most popular park',
    fullDescription: 'Start at Bi-Rite Market for artisan sandwiches, cheese, and snacks. Walk to Dolores Park and find the perfect sunny spot. Enjoy your picnic with stunning city views.',
    experienceType: 'romantic',
    priceRange: '$25-45',
    budget: 'Mid-range gourmet picnic',
    rating: 4.8,
    reviewCount: 2134,
    address: '3639 18th St, San Francisco, CA 94110',
    location: 'Mission District, San Francisco, CA',
    openingHours: 'Market: 9AM-9PM, Park: 6AM-10PM',
    travelTime: '5 min walk between stops',
    distance: '0.5 km to park',
    highlights: ['Bi-Rite gourmet market', 'Dolores Park views', 'Sunny hillside spots', 'People-watching', 'City skyline views'],
    tags: ['picnic', 'park', 'gourmet', 'outdoor', 'sunny', 'views'],
    matchScore: 93,
    image: 'https://images.unsplash.com/photo-1506976785307-8732e854ad03?w=800',
    images: [
      'https://images.unsplash.com/photo-1506976785307-8732e854ad03?w=800',
      'https://images.unsplash.com/photo-1567696911980-2eed69a46042?w=800',
      'https://images.unsplash.com/photo-1551218808-94e220e084d2?w=800'
    ],
    timeline: {
      arrivalWelcome: {
        description: 'Start at Bi-Rite Market. Browse their famous deli counter and prepared foods.',
        locationName: 'Bi-Rite Market',
        location: '3639 18th St, San Francisco, CA 94110'
      },
      mainActivity: {
        description: 'Pick up sandwiches, cheese, wine/drinks, and snacks. Don\'t miss the ice cream next door.',
        locationName: 'Bi-Rite Shopping',
        location: '3639 18th St, San Francisco, CA 94110'
      },
      immersionAddon: {
        description: 'Walk 5 minutes to Dolores Park. Find a sunny spot on the hillside.',
        locationName: 'Walk to Dolores Park',
        location: '19th St & Dolores St, San Francisco, CA 94114'
      },
      highlightMoment: {
        description: 'Spread out your picnic. Enjoy food, drinks, and views of downtown SF skyline.',
        locationName: 'Dolores Park Picnic',
        location: 'Dolores Park, San Francisco, CA 94114'
      },
      closingTouch: {
        description: 'Relax in the sun. Optional: grab ice cream from Bi-Rite Creamery after.',
        locationName: 'Park Relaxation',
        location: 'Dolores Park, San Francisco, CA 94114'
      }
    },
    routeSteps: [
      { id: 'step-1', order: 1, name: 'Bi-Rite Market', address: '3639 18th St, SF', description: 'Shop for gourmet picnic supplies', dwellTime: 20, notes: 'Famous sandwiches & cheese', isPassThrough: false },
      { id: 'step-2', order: 2, name: 'Walk to Park', address: '19th St & Dolores St, SF', description: '5-minute walk with supplies', dwellTime: 5, notes: 'Easy flat walk', isPassThrough: true },
      { id: 'step-3', order: 3, name: 'Find Picnic Spot', address: 'Dolores Park, SF', description: 'Scope out the perfect location', dwellTime: 10, notes: 'Upper lawn has best views', isPassThrough: false },
      { id: 'step-4', order: 4, name: 'Picnic Time', address: 'Dolores Park, SF', description: 'Enjoy your gourmet spread', dwellTime: 90, notes: 'Bring blanket', isPassThrough: false },
      { id: 'step-5', order: 5, name: 'Optional Ice Cream', address: '3692 18th St, SF', description: 'Walk to Bi-Rite Creamery', dwellTime: 20, notes: 'Worth the line', isPassThrough: false }
    ],
    isMultiStop: true,
    totalDistance: '0.5 km + park grounds',
    transportMode: 'walking',
    weatherDependent: true,
    socialStats: {
      views: 6890,
      likes: 1145,
      saves: 489,
      shares: 234
    },
    matchFactors: {
      location: 94,
      budget: 86,
      category: 96,
      time: 88,
      popularity: 95
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  {
    id: 'picnic-002',
    title: 'Marina Green Waterfront Picnic',
    category: 'picnics',
    categoryIcon: '🧺',
    description: 'Trader Joe\'s provisions for a breezy bay-view picnic',
    fullDescription: 'Stock up on affordable picnic essentials at Trader Joe\'s then head to Marina Green for waterfront picnicking with Golden Gate Bridge views and sailboat watching.',
    experienceType: 'friendly',
    priceRange: '$18-32',
    budget: 'Budget-friendly waterfront picnic',
    rating: 4.6,
    reviewCount: 1456,
    address: '401 Bay St, San Francisco, CA 94133',
    location: 'Marina District, San Francisco, CA',
    openingHours: 'TJ: 8AM-9PM, Park: 24 hours',
    travelTime: '10 min walk between stops',
    distance: '0.8 km to Marina Green',
    highlights: ['Affordable provisions', 'Bay views', 'Golden Gate Bridge', 'Kite flying', 'Dog-friendly'],
    tags: ['picnic', 'waterfront', 'budget', 'outdoor', 'views', 'affordable'],
    matchScore: 89,
    image: 'https://images.unsplash.com/photo-1534430480872-3498386e7856?w=800',
    images: [
      'https://images.unsplash.com/photo-1534430480872-3498386e7856?w=800',
      'https://images.unsplash.com/photo-1551632811-561732d1e306?w=800',
      'https://images.unsplash.com/photo-1560155477-b6a8c56b4ea1?w=800'
    ],
    timeline: {
      arrivalWelcome: {
        description: 'Start at Trader Joe\'s Bay Street. Stock up on affordable picnic essentials.',
        locationName: 'Trader Joe\'s',
        location: '401 Bay St, San Francisco, CA 94133'
      },
      mainActivity: {
        description: 'Grab premade sandwiches, snacks, fruit, and drinks. TJ\'s wine selection is great.',
        locationName: 'Trader Joe\'s Shopping',
        location: '401 Bay St, San Francisco, CA 94133'
      },
      immersionAddon: {
        description: 'Walk along Bay Street to Marina Green. Enjoy the waterfront path.',
        locationName: 'Walk to Marina Green',
        location: 'Marina Blvd, San Francisco, CA 94123'
      },
      highlightMoment: {
        description: 'Set up on the grass facing the bay. Watch sailboats and the Golden Gate Bridge.',
        locationName: 'Marina Green Picnic',
        location: 'Marina Green, San Francisco, CA 94123'
      },
      closingTouch: {
        description: 'Optional: walk along the waterfront promenade after eating.',
        locationName: 'Marina Promenade',
        location: 'Marina Green Promenade, San Francisco, CA 94123'
      }
    },
    routeSteps: [
      { id: 'step-1', order: 1, name: 'Trader Joe\'s', address: '401 Bay St, SF', description: 'Shop for affordable picnic supplies', dwellTime: 15, notes: 'Great value options', isPassThrough: false },
      { id: 'step-2', order: 2, name: 'Walk to Marina', address: 'Marina Blvd, SF', description: '10-minute waterfront walk', dwellTime: 10, notes: 'Scenic path', isPassThrough: true },
      { id: 'step-3', order: 3, name: 'Find Spot', address: 'Marina Green, SF', description: 'Choose your grassy location', dwellTime: 5, notes: 'Open lawn, bay views', isPassThrough: false },
      { id: 'step-4', order: 4, name: 'Picnic & Relax', address: 'Marina Green, SF', description: 'Enjoy food with bridge views', dwellTime: 75, notes: 'Can be windy - bring layers', isPassThrough: false },
      { id: 'step-5', order: 5, name: 'Waterfront Stroll', address: 'Marina Promenade, SF', description: 'Optional walk along the bay', dwellTime: 20, notes: 'Great for digestion', isPassThrough: false }
    ],
    isMultiStop: true,
    totalDistance: '0.8 km + waterfront',
    transportMode: 'walking',
    weatherDependent: true,
    socialStats: {
      views: 4230,
      likes: 687,
      saves: 298,
      shares: 134
    },
    matchFactors: {
      location: 90,
      budget: 94,
      category: 92,
      time: 86,
      popularity: 88
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  // ============================================
  // PLAY & MOVE (2 cards)
  // Logic: Activity-based, single-location experience
  // Timeline: Arrive → Play → Rest/Celebrate → Wrap-Up (1-2.5 hours)
  // ============================================

  {
    id: 'play-001',
    title: 'Mission Bowling Club',
    category: 'playMove',
    categoryIcon: '🎳',
    description: 'Vintage bowling alley with craft cocktails and arcade games',
    fullDescription: 'Bowl a few rounds in this retro-cool bowling alley. Enjoy craft cocktails, bar snacks, and vintage arcade games between frames. Perfect for playful competition.',
    experienceType: 'friendly',
    priceRange: '$35-55',
    budget: 'Mid-range activity + drinks',
    rating: 4.7,
    reviewCount: 1678,
    address: '3176 17th St, San Francisco, CA 94110',
    location: 'Mission District, San Francisco, CA',
    openingHours: 'Mon-Thu 5PM-12AM, Fri-Sun 12PM-2AM',
    travelTime: '7 min walk from BART',
    distance: 'Single venue',
    highlights: ['Vintage bowling', 'Craft cocktails', 'Arcade games', 'Retro atmosphere', 'Bar snacks'],
    tags: ['bowling', 'games', 'cocktails', 'retro', 'fun', 'competitive'],
    matchScore: 91,
    image: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800',
    images: [
      'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800',
      'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
      'https://images.unsplash.com/photo-1519671282429-b44660ead0a7?w=800'
    ],
    timeline: {
      arrivalWelcome: {
        description: 'Check in and reserve your lane. Order drinks at the bar while you wait.',
        locationName: 'Mission Bowling - Check-In',
        location: '3176 17th St, San Francisco, CA 94110'
      },
      mainActivity: {
        description: 'Grab your bowling shoes and start playing. Keep score and enjoy friendly competition.',
        locationName: 'Mission Bowling - Lanes',
        location: '3176 17th St, San Francisco, CA 94110'
      },
      immersionAddon: {
        description: 'Between frames, try the vintage arcade games and order bar snacks.',
        locationName: 'Mission Bowling - Arcade',
        location: '3176 17th St, San Francisco, CA 94110'
      },
      highlightMoment: {
        description: 'Bowl your final frames. Celebrate strikes or laugh at gutter balls.',
        locationName: 'Mission Bowling - Final Round',
        location: '3176 17th St, San Francisco, CA 94110'
      },
      closingTouch: {
        description: 'Return shoes and grab a final drink at the bar. Recap your best moments.',
        locationName: 'Mission Bowling - Wrap-Up',
        location: '3176 17th St, San Francisco, CA 94110'
      }
    },
    routeSteps: [
      { id: 'step-1', order: 1, name: 'Arrive & Check-In', address: '3176 17th St, SF', description: 'Reserve lane and order drinks', dwellTime: 10, notes: 'Reserve ahead on weekends', isPassThrough: false },
      { id: 'step-2', order: 2, name: 'Bowl', address: '3176 17th St, SF', description: 'Play 1-2 games of bowling', dwellTime: 60, notes: 'Shoes included in price', isPassThrough: false },
      { id: 'step-3', order: 3, name: 'Arcade Break', address: '3176 17th St, SF', description: 'Play vintage arcade games', dwellTime: 20, notes: 'Bring quarters', isPassThrough: false },
      { id: 'step-4', order: 4, name: 'Final Frames', address: '3176 17th St, SF', description: 'Finish your games', dwellTime: 30, notes: 'Friendly competition', isPassThrough: false },
      { id: 'step-5', order: 5, name: 'Bar Wrap-Up', address: '3176 17th St, SF', description: 'Final drinks and recap', dwellTime: 20, notes: 'Good food menu', isPassThrough: false }
    ],
    isMultiStop: false,
    totalDistance: '0 km (single venue)',
    transportMode: 'walking',
    weatherDependent: false,
    socialStats: {
      views: 5670,
      likes: 892,
      saves: 378,
      shares: 167
    },
    matchFactors: {
      location: 92,
      budget: 84,
      category: 94,
      time: 88,
      popularity: 90
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  {
    id: 'play-002',
    title: 'City Kayak on McCovey Cove',
    category: 'playMove',
    categoryIcon: '🚣',
    description: 'Paddle around AT&T Park with waterfront views and seal sightings',
    fullDescription: 'Rent kayaks and explore McCovey Cove and the SF waterfront. Paddle past AT&T Park, watch for harbor seals, and enjoy unique city views from the water.',
    experienceType: 'romantic',
    priceRange: '$40-60',
    budget: 'Mid-range outdoor activity',
    rating: 4.8,
    reviewCount: 1234,
    address: 'Pier 40, San Francisco, CA 94107',
    location: 'South Beach, San Francisco, CA',
    openingHours: 'Daily 10AM-6PM (weather permitting)',
    travelTime: '15 min walk from BART',
    distance: 'Single venue + water route',
    highlights: ['Kayaking on the bay', 'AT&T Park views', 'Harbor seals', 'Unique perspective', 'Beginner-friendly'],
    tags: ['kayaking', 'outdoor', 'water', 'active', 'views', 'adventure'],
    matchScore: 90,
    image: 'https://images.unsplash.com/photo-1503422774157-adea3ded2897?w=800',
    images: [
      'https://images.unsplash.com/photo-1503422774157-adea3ded2897?w=800',
      'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800',
      'https://images.unsplash.com/photo-1504465039710-0f49c0a47eb7?w=800'
    ],
    timeline: {
      arrivalWelcome: {
        description: 'Check in at City Kayak. Get fitted for life jackets and receive safety briefing.',
        locationName: 'City Kayak - Check-In',
        location: 'Pier 40, San Francisco, CA 94107'
      },
      mainActivity: {
        description: 'Launch your kayaks and paddle into McCovey Cove. See AT&T Park from the water.',
        locationName: 'McCovey Cove',
        location: 'McCovey Cove, San Francisco, CA 94107'
      },
      immersionAddon: {
        description: 'Paddle along the waterfront. Look for harbor seals resting on docks.',
        locationName: 'Waterfront Paddling',
        location: 'San Francisco Bay, Embarcadero'
      },
      highlightMoment: {
        description: 'Circle back through the cove. Enjoy the unique city skyline perspective.',
        locationName: 'Bay Views',
        location: 'McCovey Cove, San Francisco Bay'
      },
      closingTouch: {
        description: 'Return to the dock. Stretch and warm up at the nearby cafés.',
        locationName: 'City Kayak - Return',
        location: 'Pier 40, San Francisco, CA 94107'
      }
    },
    routeSteps: [
      { id: 'step-1', order: 1, name: 'Check-In & Safety', address: 'Pier 40, SF', description: 'Get equipment and briefing', dwellTime: 15, notes: 'Wear layers & sunscreen', isPassThrough: false },
      { id: 'step-2', order: 2, name: 'Launch', address: 'Pier 40, SF', description: 'Start your paddle', dwellTime: 10, notes: 'Beginner-friendly', isPassThrough: false },
      { id: 'step-3', order: 3, name: 'McCovey Cove Paddle', address: 'McCovey Cove, SF', description: 'Explore the cove', dwellTime: 40, notes: 'Game days are extra fun', isPassThrough: false },
      { id: 'step-4', order: 4, name: 'Waterfront Route', address: 'Embarcadero, SF', description: 'Paddle along the bay', dwellTime: 35, notes: 'Watch for seals', isPassThrough: false },
      { id: 'step-5', order: 5, name: 'Return & Wrap-Up', address: 'Pier 40, SF', description: 'Dock and return equipment', dwellTime: 10, notes: 'Grab coffee nearby', isPassThrough: false }
    ],
    isMultiStop: false,
    totalDistance: '~3 km water route',
    transportMode: 'kayak',
    weatherDependent: true,
    socialStats: {
      views: 4560,
      likes: 734,
      saves: 312,
      shares: 145
    },
    matchFactors: {
      location: 88,
      budget: 82,
      category: 92,
      time: 86,
      popularity: 87
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  // ============================================
  // DINING EXPERIENCES (2 cards)
  // Logic: Single upscale venue with structured dining flow
  // Timeline: Arrive → Dine → Optional Moment → Finish (1.5-3 hours)
  // ============================================

  {
    id: 'dining-001',
    title: 'State Bird Provisions Dim Sum Dinner',
    category: 'diningExp',
    categoryIcon: '🍽️',
    description: 'Michelin-starred dining with creative small plates served dim sum style',
    fullDescription: 'Experience one of SF\'s most innovative restaurants. Servers circulate with creative small plates on trays - choose what appeals to you dim sum style. Make reservations well in advance.',
    experienceType: 'romantic',
    priceRange: '$75-110',
    budget: 'Special occasion dining',
    rating: 4.9,
    reviewCount: 2567,
    address: '1529 Fillmore St, San Francisco, CA 94115',
    location: 'Fillmore, San Francisco, CA',
    openingHours: 'Wed-Sun 5:30PM-10PM',
    travelTime: '8 min drive',
    distance: 'Single venue',
    highlights: ['Michelin star', 'Creative small plates', 'Dim sum service style', 'Reservations required', 'Innovative menu'],
    tags: ['fine dining', 'michelin', 'small plates', 'creative', 'special occasion', 'upscale'],
    matchScore: 95,
    image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800',
    images: [
      'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800',
      'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=800',
      'https://images.unsplash.com/photo-1544148103-0773bf10d330?w=800'
    ],
    timeline: {
      arrivalWelcome: {
        description: 'Check in for your reservation. Take in the lively, upscale-casual atmosphere.',
        locationName: 'State Bird - Arrival',
        location: '1529 Fillmore St, San Francisco, CA 94115'
      },
      mainActivity: {
        description: 'Servers circulate with trays. Choose dishes that appeal to you as they pass.',
        locationName: 'State Bird - Dim Sum Service',
        location: '1529 Fillmore St, San Francisco, CA 94115'
      },
      immersionAddon: {
        description: 'Order from the menu for dishes not on trays. The namesake state bird is a must.',
        locationName: 'State Bird - Menu Ordering',
        location: '1529 Fillmore St, San Francisco, CA 94115'
      },
      highlightMoment: {
        description: 'Continue selecting small plates. Pace yourself and savor each creative dish.',
        locationName: 'State Bird - Dining',
        location: '1529 Fillmore St, San Francisco, CA 94115'
      },
      closingTouch: {
        description: 'Finish with dessert from the cart. Reflect on your favorite dishes.',
        locationName: 'State Bird - Dessert',
        location: '1529 Fillmore St, San Francisco, CA 94115'
      }
    },
    routeSteps: [
      { id: 'step-1', order: 1, name: 'Arrive', address: '1529 Fillmore St, SF', description: 'Check in for reservation', dwellTime: 5, notes: 'Book weeks in advance', isPassThrough: false },
      { id: 'step-2', order: 2, name: 'Dim Sum Service Begins', address: '1529 Fillmore St, SF', description: 'Choose from passing trays', dwellTime: 45, notes: 'Unique service style', isPassThrough: false },
      { id: 'step-3', order: 3, name: 'Menu Orders', address: '1529 Fillmore St, SF', description: 'Order signature dishes', dwellTime: 30, notes: 'State bird is the namesake dish', isPassThrough: false },
      { id: 'step-4', order: 4, name: 'Continue Dining', address: '1529 Fillmore St, SF', description: 'Enjoy additional plates', dwellTime: 40, notes: 'Pace yourself', isPassThrough: false },
      { id: 'step-5', order: 5, name: 'Dessert & Wrap-Up', address: '1529 Fillmore St, SF', description: 'Finish with dessert', dwellTime: 20, notes: 'Dessert cart available', isPassThrough: false }
    ],
    isMultiStop: false,
    totalDistance: '0 km (single venue)',
    transportMode: 'walking',
    weatherDependent: false,
    socialStats: {
      views: 8790,
      likes: 1456,
      saves: 678,
      shares: 312
    },
    matchFactors: {
      location: 90,
      budget: 75,
      category: 98,
      time: 88,
      popularity: 96
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  {
    id: 'dining-002',
    title: 'Foreign Cinema Mediterranean Dinner',
    category: 'diningExp',
    categoryIcon: '🍽️',
    description: 'Romantic dining in a courtyard with outdoor films projected on the wall',
    fullDescription: 'Dine on Mediterranean-inspired cuisine in a beautiful heated courtyard. Classic films play silently on the wall, creating a uniquely romantic atmosphere.',
    experienceType: 'romantic',
    priceRange: '$65-95',
    budget: 'Upscale romantic dining',
    rating: 4.7,
    reviewCount: 1890,
    address: '2534 Mission St, San Francisco, CA 94110',
    location: 'Mission District, San Francisco, CA',
    openingHours: 'Tue-Sun 5:30PM-10PM',
    travelTime: '10 min drive',
    distance: 'Single venue',
    highlights: ['Outdoor courtyard', 'Film projections', 'Mediterranean menu', 'Heated patio', 'Romantic ambience'],
    tags: ['fine dining', 'romantic', 'outdoor', 'film', 'mediterranean', 'special occasion'],
    matchScore: 94,
    image: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800',
    images: [
      'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800',
      'https://images.unsplash.com/photo-1424847651672-bf20a4b0982b?w=800',
      'https://images.unsplash.com/photo-1551218808-94e220e084d2?w=800'
    ],
    timeline: {
      arrivalWelcome: {
        description: 'Arrive and check in. Be seated in the beautiful courtyard or indoor dining room.',
        locationName: 'Foreign Cinema - Arrival',
        location: '2534 Mission St, San Francisco, CA 94110'
      },
      mainActivity: {
        description: 'Order cocktails and browse the Mediterranean-inspired menu. The oysters are excellent.',
        locationName: 'Foreign Cinema - Ordering',
        location: '2534 Mission St, San Francisco, CA 94110'
      },
      immersionAddon: {
        description: 'Enjoy your appetizers and drinks as the film begins projecting on the courtyard wall.',
        locationName: 'Foreign Cinema - Appetizers',
        location: '2534 Mission St, San Francisco, CA 94110'
      },
      highlightMoment: {
        description: 'Savor your entrees. The ambience is perfect for intimate conversation.',
        locationName: 'Foreign Cinema - Entrees',
        location: '2534 Mission St, San Francisco, CA 94110'
      },
      closingTouch: {
        description: 'Finish with dessert and coffee. Enjoy the last scenes of the projected film.',
        locationName: 'Foreign Cinema - Dessert',
        location: '2534 Mission St, San Francisco, CA 94110'
      }
    },
    routeSteps: [
      { id: 'step-1', order: 1, name: 'Arrive & Seat', address: '2534 Mission St, SF', description: 'Check in and get seated', dwellTime: 10, notes: 'Request courtyard seating', isPassThrough: false },
      { id: 'step-2', order: 2, name: 'Drinks & Appetizers', address: '2534 Mission St, SF', description: 'Start with cocktails and oysters', dwellTime: 30, notes: 'Great cocktail program', isPassThrough: false },
      { id: 'step-3', order: 3, name: 'Film Begins', address: '2534 Mission St, SF', description: 'Watch as film is projected', dwellTime: 15, notes: 'Silent projection', isPassThrough: false },
      { id: 'step-4', order: 4, name: 'Entrees', address: '2534 Mission St, SF', description: 'Enjoy Mediterranean mains', dwellTime: 50, notes: 'Fresh, seasonal menu', isPassThrough: false },
      { id: 'step-5', order: 5, name: 'Dessert & Wrap-Up', address: '2534 Mission St, SF', description: 'Finish with dessert', dwellTime: 25, notes: 'Romantic atmosphere', isPassThrough: false }
    ],
    isMultiStop: false,
    totalDistance: '0 km (single venue)',
    transportMode: 'walking',
    weatherDependent: false,
    socialStats: {
      views: 6450,
      likes: 1034,
      saves: 489,
      shares: 223
    },
    matchFactors: {
      location: 92,
      budget: 80,
      category: 96,
      time: 86,
      popularity: 91
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  // ============================================
  // WELLNESS DATES (2 cards)
  // Logic: Calm, relaxation-oriented venues
  // Timeline: Arrive → Experience → Optional Add-On → Finish (1-2 hours)
  // ============================================

  {
    id: 'wellness-001',
    title: 'Kabuki Springs & Spa Day',
    category: 'wellness',
    categoryIcon: '🧘',
    description: 'Traditional Japanese communal bathing with hot pools, sauna, and steam',
    fullDescription: 'Experience traditional Japanese bathing culture. Alternate between hot and cold pools, relax in the sauna and steam room, and find zen in the quiet meditation areas.',
    experienceType: 'romantic',
    priceRange: '$35-45',
    budget: 'Mid-range wellness experience',
    rating: 4.6,
    reviewCount: 1234,
    address: '1750 Geary Blvd, San Francisco, CA 94115',
    location: 'Japantown, San Francisco, CA',
    openingHours: 'Daily 10AM-10PM',
    travelTime: '12 min drive',
    distance: 'Single venue',
    highlights: ['Japanese communal baths', 'Hot & cold pools', 'Sauna & steam', 'Meditation areas', 'Relaxation'],
    tags: ['spa', 'wellness', 'relaxation', 'japanese', 'bathing', 'peaceful'],
    matchScore: 88,
    image: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=800',
    images: [
      'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=800',
      'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=800',
      'https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?w=800'
    ],
    timeline: {
      arrivalWelcome: {
        description: 'Check in at reception. Change in the locker rooms and shower before entering.',
        locationName: 'Kabuki Springs - Check-In',
        location: '1750 Geary Blvd, San Francisco, CA 94115'
      },
      mainActivity: {
        description: 'Begin with the hot communal pool. Let your muscles relax in the warm water.',
        locationName: 'Kabuki Springs - Hot Pool',
        location: '1750 Geary Blvd, San Francisco, CA 94115'
      },
      immersionAddon: {
        description: 'Alternate between hot pool, cold plunge, sauna, and steam room. This is traditional onsen practice.',
        locationName: 'Kabuki Springs - Bathing Circuit',
        location: '1750 Geary Blvd, San Francisco, CA 94115'
      },
      highlightMoment: {
        description: 'Rest in the meditation area between bathing cycles. Enjoy the peaceful silence.',
        locationName: 'Kabuki Springs - Meditation',
        location: '1750 Geary Blvd, San Francisco, CA 94115'
      },
      closingTouch: {
        description: 'Final soak in the hot pool. Exit when fully relaxed. Optional: book massage treatment.',
        locationName: 'Kabuki Springs - Wrap-Up',
        location: '1750 Geary Blvd, San Francisco, CA 94115'
      }
    },
    routeSteps: [
      { id: 'step-1', order: 1, name: 'Check-In', address: '1750 Geary Blvd, SF', description: 'Register and change', dwellTime: 15, notes: 'Bring swimsuit (nude days vary)', isPassThrough: false },
      { id: 'step-2', order: 2, name: 'Hot Pool', address: '1750 Geary Blvd, SF', description: 'Begin with warm water soak', dwellTime: 20, notes: 'Communal experience', isPassThrough: false },
      { id: 'step-3', order: 3, name: 'Bathing Circuit', address: '1750 Geary Blvd, SF', description: 'Alternate hot/cold/sauna/steam', dwellTime: 45, notes: 'Take your time', isPassThrough: false },
      { id: 'step-4', order: 4, name: 'Meditation Rest', address: '1750 Geary Blvd, SF', description: 'Rest in quiet meditation areas', dwellTime: 20, notes: 'Silent spaces', isPassThrough: false },
      { id: 'step-5', order: 5, name: 'Final Soak', address: '1750 Geary Blvd, SF', description: 'Last hot pool before leaving', dwellTime: 15, notes: 'Leave fully relaxed', isPassThrough: false }
    ],
    isMultiStop: false,
    totalDistance: '0 km (single venue)',
    transportMode: 'walking',
    weatherDependent: false,
    socialStats: {
      views: 4230,
      likes: 678,
      saves: 312,
      shares: 145
    },
    matchFactors: {
      location: 86,
      budget: 88,
      category: 92,
      time: 90,
      popularity: 84
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  {
    id: 'wellness-002',
    title: 'Yoga to the People Community Class',
    category: 'wellness',
    categoryIcon: '🧘',
    description: 'Donation-based yoga in a welcoming community studio',
    fullDescription: 'Join a donation-based yoga class open to all levels. Practice in a non-judgmental space, find your flow, and leave feeling centered and connected.',
    experienceType: 'friendly',
    priceRange: '$10-20',
    budget: 'Donation-based wellness',
    rating: 4.5,
    reviewCount: 876,
    address: '286 Divisadero St, San Francisco, CA 94117',
    location: 'Lower Haight, San Francisco, CA',
    openingHours: 'Daily 7AM-9PM (class schedule varies)',
    travelTime: '8 min walk',
    distance: 'Single venue',
    highlights: ['Donation-based', 'All levels welcome', 'Community atmosphere', 'Multiple class styles', 'No pressure'],
    tags: ['yoga', 'wellness', 'community', 'affordable', 'fitness', 'mindfulness'],
    matchScore: 85,
    image: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800',
    images: [
      'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800',
      'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800',
      'https://images.unsplash.com/photo-1545205597-3d9d02c29597?w=800'
    ],
    timeline: {
      arrivalWelcome: {
        description: 'Arrive 10 minutes early. Sign in and set up your mat in the studio.',
        locationName: 'Yoga to the People - Arrival',
        location: '286 Divisadero St, San Francisco, CA 94117'
      },
      mainActivity: {
        description: 'Class begins. Follow the instructor through poses, breathing, and flow sequences.',
        locationName: 'Yoga to the People - Practice',
        location: '286 Divisadero St, San Francisco, CA 94117'
      },
      immersionAddon: {
        description: 'Focus on your breath and movement. The community energy is supportive and non-competitive.',
        locationName: 'Yoga to the People - Flow',
        location: '286 Divisadero St, San Francisco, CA 94117'
      },
      highlightMoment: {
        description: 'End with savasana - final relaxation pose. Let your body integrate the practice.',
        locationName: 'Yoga to the People - Savasana',
        location: '286 Divisadero St, San Francisco, CA 94117'
      },
      closingTouch: {
        description: 'Roll up your mat. Optional: grab tea or healthy food nearby on Divisadero.',
        locationName: 'Yoga to the People - Wrap-Up',
        location: '286 Divisadero St, San Francisco, CA 94117'
      }
    },
    routeSteps: [
      { id: 'step-1', order: 1, name: 'Arrive Early', address: '286 Divisadero St, SF', description: 'Check in and set up mat', dwellTime: 10, notes: 'Bring your own mat or rent', isPassThrough: false },
      { id: 'step-2', order: 2, name: 'Class Begins', address: '286 Divisadero St, SF', description: 'Start with warm-up', dwellTime: 15, notes: 'All levels welcome', isPassThrough: false },
      { id: 'step-3', order: 3, name: 'Flow Practice', address: '286 Divisadero St, SF', description: 'Move through sequences', dwellTime: 55, notes: 'Modify as needed', isPassThrough: false },
      { id: 'step-4', order: 4, name: 'Savasana', address: '286 Divisadero St, SF', description: 'Final relaxation', dwellTime: 10, notes: 'Rest and integrate', isPassThrough: false },
      { id: 'step-5', order: 5, name: 'Wrap-Up', address: '286 Divisadero St, SF', description: 'Roll up mat and leave donation', dwellTime: 5, notes: 'Donation-based', isPassThrough: false }
    ],
    isMultiStop: false,
    totalDistance: '0 km (single venue)',
    transportMode: 'walking',
    weatherDependent: false,
    socialStats: {
      views: 3120,
      likes: 512,
      saves: 223,
      shares: 89
    },
    matchFactors: {
      location: 88,
      budget: 96,
      category: 90,
      time: 86,
      popularity: 82
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  // ============================================
  // FREESTYLE (2 cards)
  // Logic: Unique, time-sensitive, or spontaneous events
  // Timeline: Arrive → Explore → Optional Add-On → Wrap-Up (2-4 hours typical)
  // ============================================

  {
    id: 'freestyle-001',
    title: 'Treasure Island Flea Market & Food Trucks',
    category: 'freestyle',
    categoryIcon: '🎪',
    description: 'Monthly outdoor market with vintage finds, local art, and bay views',
    fullDescription: 'Explore this monthly pop-up flea market on Treasure Island. Browse vintage goods and local art, grab food from trucks, and enjoy stunning SF skyline views.',
    experienceType: 'friendly',
    priceRange: '$20-40',
    budget: 'Variable shopping + food',
    rating: 4.7,
    reviewCount: 1567,
    address: 'Treasure Island, San Francisco, CA 94130',
    location: 'Treasure Island, San Francisco, CA',
    openingHours: 'Last weekend of month, 10AM-4PM',
    travelTime: '15 min drive',
    distance: 'Outdoor market grounds',
    highlights: ['Vintage shopping', 'Local artisans', 'Food trucks', 'Bay views', 'Monthly event'],
    tags: ['flea market', 'vintage', 'shopping', 'food trucks', 'outdoor', 'unique'],
    matchScore: 89,
    image: 'https://images.unsplash.com/photo-1533900298318-6b8da08a523e?w=800',
    images: [
      'https://images.unsplash.com/photo-1533900298318-6b8da08a523e?w=800',
      'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?w=800',
      'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=800'
    ],
    timeline: {
      arrivalWelcome: {
        description: 'Drive to Treasure Island and park. Enter the flea market grounds.',
        locationName: 'Treasure Island Flea - Entrance',
        location: 'Treasure Island, San Francisco, CA 94130'
      },
      mainActivity: {
        description: 'Browse vendor stalls. Find vintage clothing, furniture, records, and local art.',
        locationName: 'Treasure Island Flea - Vendors',
        location: 'Treasure Island, San Francisco, CA 94130'
      },
      immersionAddon: {
        description: 'Stop at food trucks for lunch. Options range from tacos to BBQ to desserts.',
        locationName: 'Treasure Island Flea - Food Trucks',
        location: 'Treasure Island, San Francisco, CA 94130'
      },
      highlightMoment: {
        description: 'Take a break at the bay-view seating. Enjoy stunning SF skyline and bridge views.',
        locationName: 'Treasure Island Flea - Bay Views',
        location: 'Treasure Island, San Francisco, CA 94130'
      },
      closingTouch: {
        description: 'Final vendor rounds. Hunt for last-minute treasures before the market closes.',
        locationName: 'Treasure Island Flea - Final Browse',
        location: 'Treasure Island, San Francisco, CA 94130'
      }
    },
    routeSteps: [
      { id: 'step-1', order: 1, name: 'Arrive & Park', address: 'Treasure Island, SF', description: 'Drive to the island and park', dwellTime: 10, notes: 'Free admission', isPassThrough: false },
      { id: 'step-2', order: 2, name: 'Browse Vendors', address: 'Treasure Island, SF', description: 'Shop vintage and local goods', dwellTime: 90, notes: 'Bring cash', isPassThrough: false },
      { id: 'step-3', order: 3, name: 'Food Truck Lunch', address: 'Treasure Island, SF', description: 'Grab food from trucks', dwellTime: 30, notes: 'Variety of cuisines', isPassThrough: false },
      { id: 'step-4', order: 4, name: 'Bay Views', address: 'Treasure Island, SF', description: 'Enjoy skyline views', dwellTime: 20, notes: 'Great photo spot', isPassThrough: false },
      { id: 'step-5', order: 5, name: 'Final Shopping', address: 'Treasure Island, SF', description: 'Last minute treasure hunting', dwellTime: 30, notes: 'Monthly event only', isPassThrough: false }
    ],
    isMultiStop: false,
    totalDistance: '~1 km market grounds',
    transportMode: 'walking',
    weatherDependent: true,
    socialStats: {
      views: 5670,
      likes: 892,
      saves: 398,
      shares: 178
    },
    matchFactors: {
      location: 82,
      budget: 86,
      category: 94,
      time: 88,
      popularity: 90
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  {
    id: 'freestyle-002',
    title: 'Off the Grid Friday Night Food Truck Party',
    category: 'freestyle',
    categoryIcon: '🎪',
    description: 'Weekly food truck gathering with live music and bay views at Fort Mason',
    fullDescription: 'Join the weekly Friday night food truck event. Choose from 30+ food trucks, enjoy live music, and watch the sunset over the bay with locals.',
    experienceType: 'friendly',
    priceRange: '$15-28',
    budget: 'Affordable food truck dining',
    rating: 4.6,
    reviewCount: 2345,
    address: 'Fort Mason Center, San Francisco, CA 94123',
    location: 'Marina, San Francisco, CA',
    openingHours: 'Fridays 5PM-10PM (seasonal)',
    travelTime: '12 min drive',
    distance: 'Outdoor event space',
    highlights: ['30+ food trucks', 'Live music', 'Sunset views', 'Community atmosphere', 'Weekly event'],
    tags: ['food trucks', 'music', 'outdoor', 'community', 'affordable', 'sunset'],
    matchScore: 91,
    image: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800',
    images: [
      'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800',
      'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800',
      'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800'
    ],
    timeline: {
      arrivalWelcome: {
        description: 'Arrive at Fort Mason as trucks are setting up. The energy builds as more people arrive.',
        locationName: 'Off the Grid - Arrival',
        location: 'Fort Mason Center, San Francisco, CA 94123'
      },
      mainActivity: {
        description: 'Browse the 30+ food trucks. Options include BBQ, Asian fusion, tacos, desserts, and more.',
        locationName: 'Off the Grid - Food Trucks',
        location: 'Fort Mason Center, San Francisco, CA 94123'
      },
      immersionAddon: {
        description: 'Order from multiple trucks and share. Grab drinks from the bar area.',
        locationName: 'Off the Grid - Ordering',
        location: 'Fort Mason Center, San Francisco, CA 94123'
      },
      highlightMoment: {
        description: 'Find seating with bay views. Enjoy live music as the sun sets over the water.',
        locationName: 'Off the Grid - Dining & Music',
        location: 'Fort Mason Center, San Francisco, CA 94123'
      },
      closingTouch: {
        description: 'Stay for dessert trucks. Soak in the last of the sunset and community vibes.',
        locationName: 'Off the Grid - Dessert',
        location: 'Fort Mason Center, San Francisco, CA 94123'
      }
    },
    routeSteps: [
      { id: 'step-1', order: 1, name: 'Arrive', address: 'Fort Mason Center, SF', description: 'Enter the event space', dwellTime: 10, notes: 'Free entry', isPassThrough: false },
      { id: 'step-2', order: 2, name: 'Browse Trucks', address: 'Fort Mason Center, SF', description: 'Survey 30+ food options', dwellTime: 20, notes: 'Long lines for popular trucks', isPassThrough: false },
      { id: 'step-3', order: 3, name: 'Order Food', address: 'Fort Mason Center, SF', description: 'Get food from multiple trucks', dwellTime: 30, notes: 'Cash and card accepted', isPassThrough: false },
      { id: 'step-4', order: 4, name: 'Eat & Enjoy Music', address: 'Fort Mason Center, SF', description: 'Dine with sunset and live music', dwellTime: 60, notes: 'Bring blanket or chairs', isPassThrough: false },
      { id: 'step-5', order: 5, name: 'Dessert & Wrap-Up', address: 'Fort Mason Center, SF', description: 'Finish with dessert truck', dwellTime: 20, notes: 'Weekly Friday tradition', isPassThrough: false }
    ],
    isMultiStop: false,
    totalDistance: '~0.5 km event space',
    transportMode: 'walking',
    weatherDependent: true,
    socialStats: {
      views: 7890,
      likes: 1234,
      saves: 534,
      shares: 267
    },
    matchFactors: {
      location: 90,
      budget: 92,
      category: 94,
      time: 88,
      popularity: 94
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  // ============================================
  // NIGHTLIFE / PARTIES (8 cards)
  // Logic: Party/club experiences with various music genres
  // ============================================

  {
    id: 'nightlife-001',
    title: 'The Midway: Electronic Music Night',
    category: 'nightlife',
    categories: ['nightlife', 'entertainment'],
    categoryIcon: '🌙',
    description: 'Underground electronic music venue with world-class DJs and immersive visuals',
    fullDescription: 'Dance the night away at The Midway, SF\'s premier electronic music venue. Features rotating resident DJs, state-of-the-art sound system, LED installations, and multiple dance floors.',
    experienceType: 'group',
    priceRange: '$20-40',
    budget: 'Cover charge plus drinks',
    rating: 4.7,
    reviewCount: 2341,
    address: '900 Marin St, San Francisco, CA 94124',
    location: 'The Midway, SF',
    openingHours: 'Fri-Sat 10PM-4AM',
    travelTime: '15 min drive',
    distance: '8 km',
    highlights: ['Live DJs', 'Dance floors', 'Light shows', 'Outdoor patio', 'Full bar'],
    tags: ['nightlife', 'electronic', 'dance', 'club', 'late night'],
    matchScore: 92,
    image: 'https://images.unsplash.com/photo-1571266028243-d220c6cd3870?w=800',
    images: [
      'https://images.unsplash.com/photo-1571266028243-d220c6cd3870?w=800',
      'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800',
      'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800'
    ],
    partyGenre: 'electronic',
    partyDate: new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    venue: 'The Midway',
    attendees: 450,
    socialStats: {
      views: 8920,
      likes: 1456,
      saves: 723,
      shares: 389
    },
    matchFactors: {
      location: 88,
      budget: 84,
      category: 94,
      time: 92,
      popularity: 91
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  {
    id: 'nightlife-002',
    title: '1015 Folsom: Hip-Hop Saturday',
    category: 'nightlife',
    categories: ['nightlife', 'entertainment'],
    categoryIcon: '🌙',
    description: 'Premier hip-hop club with top 40 hits and VIP bottle service',
    fullDescription: 'Experience the energy of 1015 Folsom\'s legendary hip-hop nights. Three levels of music, premium sound system, VIP booths, and the city\'s best hip-hop DJs spinning all night.',
    experienceType: 'group',
    priceRange: '$25-50',
    budget: 'Cover and drinks',
    rating: 4.6,
    reviewCount: 1876,
    address: '1015 Folsom St, San Francisco, CA 94103',
    location: '1015 Folsom, SOMA',
    openingHours: 'Sat 10PM-4AM',
    travelTime: '8 min drive',
    distance: '4 km',
    highlights: ['3 floors', 'Hip-hop DJs', 'VIP booths', 'Bottle service', 'Late night'],
    tags: ['nightlife', 'hip-hop', 'dance', 'club', 'VIP'],
    matchScore: 89,
    image: 'https://images.unsplash.com/photo-1566737236500-c8ac43014a67?w=800',
    images: [
      'https://images.unsplash.com/photo-1566737236500-c8ac43014a67?w=800',
      'https://images.unsplash.com/photo-1574391884720-bbc3740c59d1?w=800'
    ],
    partyGenre: 'hip-hop',
    partyDate: new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    venue: '1015 Folsom',
    attendees: 650,
    socialStats: {
      views: 9340,
      likes: 1623,
      saves: 834,
      shares: 412
    },
    matchFactors: {
      location: 92,
      budget: 82,
      category: 96,
      time: 94,
      popularity: 93
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  {
    id: 'nightlife-003',
    title: 'Audio: Techno Thursdays',
    category: 'nightlife',
    categories: ['nightlife', 'entertainment'],
    categoryIcon: '🌙',
    description: 'Underground techno haven with world-renowned DJs',
    fullDescription: 'Dive deep into techno at Audio. This intimate club hosts international techno DJs, features a Funktion-One sound system, and attracts true electronic music enthusiasts.',
    experienceType: 'solo',
    priceRange: '$15-30',
    budget: 'Affordable cover',
    rating: 4.8,
    reviewCount: 1567,
    address: '316 11th St, San Francisco, CA 94103',
    location: 'Audio SF, SOMA',
    openingHours: 'Thu-Sat 10PM-4AM',
    travelTime: '10 min drive',
    distance: '5 km',
    highlights: ['Techno music', 'International DJs', 'Premium sound', 'Intimate venue', 'Late night'],
    tags: ['nightlife', 'techno', 'electronic', 'underground', 'dance'],
    matchScore: 91,
    image: 'https://images.unsplash.com/photo-1598387993281-cecf8b71a8f8?w=800',
    images: [
      'https://images.unsplash.com/photo-1598387993281-cecf8b71a8f8?w=800',
      'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800'
    ],
    partyGenre: 'techno',
    partyDate: new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    venue: 'Audio SF',
    attendees: 320,
    socialStats: {
      views: 6780,
      likes: 1234,
      saves: 589,
      shares: 267
    },
    matchFactors: {
      location: 90,
      budget: 92,
      category: 94,
      time: 88,
      popularity: 87
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  {
    id: 'nightlife-004',
    title: 'Azúcar Lounge: Latin Night',
    category: 'nightlife',
    categories: ['nightlife', 'entertainment'],
    categoryIcon: '🌙',
    description: 'Salsa, bachata, and reggaeton with live bands and dance lessons',
    fullDescription: 'Heat up your night at Azúcar with authentic Latin music. Free salsa lessons at 9PM, live bands, resident DJs spinning reggaeton and bachata, plus a welcoming dance community.',
    experienceType: 'friendly',
    priceRange: '$10-25',
    budget: 'Great value',
    rating: 4.7,
    reviewCount: 1892,
    address: '299 9th St, San Francisco, CA 94103',
    location: 'Azúcar Lounge, SOMA',
    openingHours: 'Fri-Sat 9PM-2AM',
    travelTime: '12 min drive',
    distance: '6 km',
    highlights: ['Live bands', 'Free lessons', 'Salsa dancing', 'Reggaeton', 'Friendly crowd'],
    tags: ['nightlife', 'latin', 'salsa', 'dance', 'live music'],
    matchScore: 93,
    image: 'https://images.unsplash.com/photo-1566140967404-b8b3932483f5?w=800',
    images: [
      'https://images.unsplash.com/photo-1566140967404-b8b3932483f5?w=800',
      'https://images.unsplash.com/photo-1504609773096-104ff2c73ba4?w=800'
    ],
    partyGenre: 'latin',
    partyDate: new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    venue: 'Azúcar Lounge',
    attendees: 280,
    socialStats: {
      views: 7456,
      likes: 1345,
      saves: 678,
      shares: 334
    },
    matchFactors: {
      location: 91,
      budget: 94,
      category: 92,
      time: 90,
      popularity: 89
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  {
    id: 'nightlife-005',
    title: 'Temple: House Music Fridays',
    category: 'nightlife',
    categories: ['nightlife', 'entertainment'],
    categoryIcon: '🌙',
    description: 'Two-floor house music temple with resident DJs and bottle service',
    fullDescription: 'Temple brings Chicago-style house music to SF. Two dance floors, resident DJs, bottle service, and a crowd that knows how to move. Premium sound and lighting throughout.',
    experienceType: 'group',
    priceRange: '$20-45',
    budget: 'Mid-range nightlife',
    rating: 4.5,
    reviewCount: 2103,
    address: '540 Howard St, San Francisco, CA 94105',
    location: 'Temple SF, SOMA',
    openingHours: 'Fri-Sat 10PM-4AM',
    travelTime: '7 min drive',
    distance: '3.5 km',
    highlights: ['House music', '2 dance floors', 'Bottle service', 'Premium sound', 'Late night'],
    tags: ['nightlife', 'house', 'dance', 'club', 'bottle service'],
    matchScore: 88,
    image: 'https://images.unsplash.com/photo-1571266028243-d220c6cd3870?w=800',
    images: [
      'https://images.unsplash.com/photo-1571266028243-d220c6cd3870?w=800',
      'https://images.unsplash.com/photo-1543007631-283050bb3e8c?w=800'
    ],
    partyGenre: 'house',
    partyDate: new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    venue: 'Temple SF',
    attendees: 550,
    socialStats: {
      views: 8234,
      likes: 1456,
      saves: 712,
      shares: 356
    },
    matchFactors: {
      location: 93,
      budget: 85,
      category: 94,
      time: 92,
      popularity: 90
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  {
    id: 'nightlife-006',
    title: 'Great Northern: Rock & Indie Night',
    category: 'nightlife',
    categories: ['nightlife', 'entertainment'],
    categoryIcon: '🌙',
    description: 'Live rock bands and indie DJs in a massive warehouse venue',
    fullDescription: 'Rock out at Great Northern, SF\'s premier live music and dance venue. Features touring bands, local acts, indie/rock DJs, multiple bars, and a huge dance floor.',
    experienceType: 'friendly',
    priceRange: '$15-35',
    budget: 'Affordable live music',
    rating: 4.6,
    reviewCount: 1678,
    address: '119 Utah St, San Francisco, CA 94103',
    location: 'Great Northern, Potrero',
    openingHours: 'Thu-Sat 9PM-2AM',
    travelTime: '14 min drive',
    distance: '7 km',
    highlights: ['Live bands', 'Rock music', 'Indie DJs', 'Large venue', 'Multiple bars'],
    tags: ['nightlife', 'rock', 'live music', 'indie', 'concert'],
    matchScore: 87,
    image: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=800',
    images: [
      'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=800',
      'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800'
    ],
    partyGenre: 'rock',
    partyDate: new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    venue: 'Great Northern',
    attendees: 480,
    socialStats: {
      views: 7123,
      likes: 1289,
      saves: 623,
      shares: 298
    },
    matchFactors: {
      location: 86,
      budget: 90,
      category: 92,
      time: 88,
      popularity: 89
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  {
    id: 'nightlife-007',
    title: 'Slate Bar: Reggae Sundays',
    category: 'nightlife',
    categories: ['nightlife', 'entertainment'],
    categoryIcon: '🌙',
    description: 'Chill reggae vibes with DJs spinning roots, dancehall, and dub',
    fullDescription: 'Wind down your weekend at Slate Bar\'s legendary Reggae Sundays. Resident DJs spin classic roots, modern dancehall, and deep dub. Relaxed atmosphere, tropical cocktails, outdoor patio.',
    experienceType: 'friendly',
    priceRange: '$8-20',
    budget: 'Budget-friendly vibes',
    rating: 4.7,
    reviewCount: 1456,
    address: '2925 16th St, San Francisco, CA 94103',
    location: 'Slate Bar, Mission',
    openingHours: 'Sun 8PM-1AM',
    travelTime: '11 min drive',
    distance: '5.5 km',
    highlights: ['Reggae music', 'Outdoor patio', 'Tropical drinks', 'Chill vibes', 'Sundays'],
    tags: ['nightlife', 'reggae', 'dancehall', 'relaxed', 'sunday'],
    matchScore: 90,
    image: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800',
    images: [
      'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800',
      'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800'
    ],
    partyGenre: 'reggae',
    partyDate: new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    venue: 'Slate Bar',
    attendees: 180,
    socialStats: {
      views: 5890,
      likes: 987,
      saves: 456,
      shares: 234
    },
    matchFactors: {
      location: 89,
      budget: 96,
      category: 90,
      time: 85,
      popularity: 86
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  },

  {
    id: 'nightlife-008',
    title: 'Bissap Baobab: Afrobeats Night',
    category: 'nightlife',
    categories: ['nightlife', 'entertainment'],
    categoryIcon: '🌙',
    description: 'Authentic Afrobeats, amapiano, and West African cuisine',
    fullDescription: 'Celebrate African culture at Bissap Baobab. DJs spin the latest Afrobeats, amapiano, and Afro-fusion tracks. Enjoy Senegalese cuisine, colorful decor, and an energetic dance floor.',
    experienceType: 'group',
    priceRange: '$12-28',
    budget: 'Great value with food',
    rating: 4.8,
    reviewCount: 1734,
    address: '3372 19th St, San Francisco, CA 94110',
    location: 'Bissap Baobab, Mission',
    openingHours: 'Fri-Sat 9PM-2AM',
    travelTime: '13 min drive',
    distance: '6.5 km',
    highlights: ['Afrobeats music', 'Live DJs', 'West African food', 'Cultural vibes', 'Dance floor'],
    tags: ['nightlife', 'afrobeats', 'african', 'dance', 'cuisine'],
    matchScore: 94,
    image: 'https://images.unsplash.com/photo-1598387993281-cecf8b71a8f8?w=800',
    images: [
      'https://images.unsplash.com/photo-1598387993281-cecf8b71a8f8?w=800',
      'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800'
    ],
    partyGenre: 'afrobeats',
    partyDate: new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    venue: 'Bissap Baobab',
    attendees: 220,
    socialStats: {
      views: 8456,
      likes: 1567,
      saves: 789,
      shares: 423
    },
    matchFactors: {
      location: 88,
      budget: 93,
      category: 96,
      time: 91,
      popularity: 92
    },
    status: 'live',
    createdBy: 'platform',
    createdAt: '2025-11-07T10:00:00Z',
    updatedAt: '2025-11-07T10:00:00Z'
  }

];

export default SEED_EXPERIENCE_CARDS;
