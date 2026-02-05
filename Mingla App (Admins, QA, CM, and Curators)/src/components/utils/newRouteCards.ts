/**
 * New Route-Based Experience Cards
 * 
 * Purpose: 4 production-ready multi-stop experience cards with animated routes
 * Categories: Take a Stroll, Sip and Chill, Screen and Relax, Dining Experiences
 * 
 * Structure follows the new card system with:
 * - routeSteps array for multi-location experiences
 * - Animated timeline display
 * - Google Maps integration
 * - Proper match weights for personalization
 */

export interface RouteStep {
  id: string;
  order: number;
  name: string;
  address: string;
  description: string;
  dwellTime: number;
  notes: string;
  isPassThrough: boolean;
}

export interface NewRouteCard {
  id: string;
  title: string;
  category: string;
  categoryLabel: string;
  description: string;
  fullDescription: string;
  venue: string;
  location: string;
  rating: number;
  reviewCount: number;
  priceRange: string;
  pricePerPerson: number;
  duration: string;
  images: string[];
  highlights: string[];
  tags: string[];
  atmosphereMarkers: string[];
  
  // Route & Timeline
  routeSteps: RouteStep[];
  isMultiStop: boolean;
  totalDistance: string;
  transportMode: string;
  
  // Timeline for display
  timeline: {
    arrivalWelcome: {
      description: string;
      location: string;
      locationName: string;
    };
    mainActivity: {
      description: string;
      location: string;
      locationName: string;
    };
    immersionAddon: {
      description: string;
      location: string;
      locationName: string;
    };
    highlightMoment: {
      description: string;
      location: string;
      locationName: string;
    };
    closingTouch: {
      description: string;
      location: string;
      locationName: string;
    };
  };
  
  // Match weights
  matchWeights: {
    soloAdventure: number;
    firstDate: number;
    romantic: number;
    friendly: number;
    groupFun: number;
    business: number;
  };
  
  // Status
  status: 'live';
  createdBy: string;
  createdByRole: 'platform';
  weatherDependent?: boolean;
  bestTimeOfDay: string[];
}

export const newRouteCards: NewRouteCard[] = [
  // 1. TAKE A STROLL - Presidio Trails + Warming Hut
  {
    id: 'route-stroll-001',
    title: 'Presidio Coastal Trail + Warming Hut Café',
    category: 'stroll',
    categoryLabel: 'Take a Stroll',
    description: 'Breathtaking Golden Gate Bridge views along coastal cliffs with cozy café finish',
    fullDescription: 'Experience one of San Francisco\'s most stunning walks. Start at Baker Beach, follow the dramatic coastal trail with panoramic Golden Gate Bridge views, explore historic batteries and overlooks, then warm up at the iconic Warming Hut with hot drinks and bay views. Perfect for conversation and connection.',
    venue: 'Presidio Coastal Trail',
    location: 'Presidio of San Francisco, CA',
    rating: 4.9,
    reviewCount: 1856,
    priceRange: '$5-12',
    pricePerPerson: 8,
    duration: '1.5-2 hours',
    images: [
      'https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=800',
      'https://images.unsplash.com/photo-1449034446853-66c86144b0ad?w=800',
      'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800'
    ],
    highlights: [
      'Golden Gate Bridge views',
      'Coastal cliffs & beaches',
      'Historic military sites',
      'Warming Hut café',
      'Perfect for conversation'
    ],
    tags: ['scenic', 'waterfront', 'nature', 'coffee', 'iconic views', 'photo-worthy', 'easy walk'],
    atmosphereMarkers: ['Scenic', 'Peaceful', 'Iconic', 'Nature', 'Conversation-friendly'],
    
    // Route Steps
    routeSteps: [
      {
        id: 'step-1',
        order: 1,
        name: 'Baker Beach Parking',
        address: 'Baker Beach, San Francisco, CA 94129',
        description: 'Start your journey at Baker Beach with stunning views of the Golden Gate Bridge. Take a moment to appreciate the beach and surrounding cliffs.',
        dwellTime: 10,
        notes: 'Free parking available. Can get crowded on weekends.',
        isPassThrough: false
      },
      {
        id: 'step-2',
        order: 2,
        name: 'Coastal Trail',
        address: 'Presidio Coastal Trail, San Francisco, CA 94129',
        description: 'Walk the scenic coastal trail with breathtaking ocean views and dramatic cliffs. Pass by historic Battery Crosby with incredible bridge perspectives.',
        dwellTime: 35,
        notes: 'Easy, mostly flat trail. Great for all fitness levels.',
        isPassThrough: false
      },
      {
        id: 'step-3',
        order: 3,
        name: 'Fort Point Overlook',
        address: 'Fort Point, San Francisco, CA 94129',
        description: 'Stop at the Fort Point overlook for the most dramatic Golden Gate Bridge views. Perfect photo opportunity directly beneath the bridge.',
        dwellTime: 15,
        notes: 'Can be windy - bring a light jacket.',
        isPassThrough: false
      },
      {
        id: 'step-4',
        order: 4,
        name: 'Warming Hut Café',
        address: '983 Marine Dr, San Francisco, CA 94129',
        description: 'End at the charming Warming Hut. Grab hot coffee, pastries, or sandwiches. Enjoy bay views from the outdoor seating or cozy interior.',
        dwellTime: 30,
        notes: 'Cash and card accepted. Great bookstore section too.',
        isPassThrough: false
      }
    ],
    isMultiStop: true,
    totalDistance: '2.8 km',
    transportMode: 'walking',
    
    timeline: {
      arrivalWelcome: {
        description: 'Begin at Baker Beach parking area. Take in the expansive beach views and Golden Gate Bridge in the distance. Use restrooms here if needed.',
        location: 'Baker Beach, San Francisco, CA 94129',
        locationName: 'Baker Beach'
      },
      mainActivity: {
        description: 'Follow the coastal trail north. Walk along dramatic cliffs with waves crashing below. The trail is wide and easy, perfect for side-by-side conversation.',
        location: 'Presidio Coastal Trail, San Francisco, CA 94129',
        locationName: 'Coastal Trail'
      },
      immersionAddon: {
        description: 'Explore Battery Crosby, a historic military installation. Climb up for elevated bridge views. Take photos from multiple angles as you walk.',
        location: 'Battery Crosby, Presidio, San Francisco, CA',
        locationName: 'Battery Crosby'
      },
      highlightMoment: {
        description: 'Reach Fort Point overlook - the highlight of the walk. Stand directly beneath the Golden Gate Bridge with crashing waves below. Capture unforgettable photos.',
        location: 'Fort Point, San Francisco, CA 94129',
        locationName: 'Fort Point Overlook'
      },
      closingTouch: {
        description: 'Arrive at Warming Hut, a beloved local spot. Order hot drinks and snacks. Sit by the windows overlooking Crissy Field and the bay. Browse the bookstore before leaving.',
        location: '983 Marine Dr, San Francisco, CA 94129',
        locationName: 'Warming Hut Café'
      }
    },
    
    matchWeights: {
      soloAdventure: 0.85,
      firstDate: 0.95,
      romantic: 0.9,
      friendly: 0.95,
      groupFun: 0.7,
      business: 0.3
    },
    
    status: 'live',
    createdBy: 'platform',
    createdByRole: 'platform',
    weatherDependent: true,
    bestTimeOfDay: ['morning', 'afternoon']
  },

  // 2. SIP & CHILL - North Beach Wine & Coffee Crawl
  {
    id: 'route-sip-001',
    title: 'North Beach Wine & Coffee Crawl',
    category: 'sip-chill',
    categoryLabel: 'Sip & Chill',
    description: 'Italian neighborhood sipping tour from espresso to aperitivo through historic North Beach',
    fullDescription: 'Experience San Francisco\'s Little Italy through its best drinks. Start with authentic Italian espresso, sample wine at a neighborhood enoteca, enjoy aperitivo at a classic bar, and finish with cocktails at a speakeasy. Between stops, stroll past historic sites, charming alleyways, and vibrant Washington Square Park.',
    venue: 'North Beach',
    location: 'North Beach, San Francisco, CA',
    rating: 4.8,
    reviewCount: 1243,
    priceRange: '$25-45',
    pricePerPerson: 35,
    duration: '2.5-3 hours',
    images: [
      'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=800',
      'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=800',
      'https://images.unsplash.com/photo-1551024601-bec78aea704b?w=800'
    ],
    highlights: [
      'Italian espresso culture',
      'Wine tasting',
      'Aperitivo tradition',
      'Historic neighborhood',
      'Hidden speakeasy'
    ],
    tags: ['wine', 'coffee', 'cocktails', 'italian', 'neighborhood tour', 'culture', 'walkable'],
    atmosphereMarkers: ['Vibrant', 'Cultural', 'Social', 'Historic', 'Lively'],
    
    routeSteps: [
      {
        id: 'step-1',
        order: 1,
        name: 'Caffe Trieste',
        address: '601 Vallejo St, San Francisco, CA 94133',
        description: 'Start at legendary Caffe Trieste, San Francisco\'s first espresso house since 1956. Order a traditional Italian espresso or cappuccino. Soak in the bohemian atmosphere.',
        dwellTime: 20,
        notes: 'Cash only. Limited seating, but worth it.',
        isPassThrough: false
      },
      {
        id: 'step-2',
        order: 2,
        name: 'Washington Square Park',
        address: 'Washington Square, San Francisco, CA 94133',
        description: 'Stroll through charming Washington Square Park. Admire Saints Peter and Paul Church. This is North Beach\'s community living room.',
        dwellTime: 10,
        notes: 'Great spot to sit on grass if nice weather.',
        isPassThrough: true
      },
      {
        id: 'step-3',
        order: 3,
        name: 'Gino & Carlo',
        address: '548 Green St, San Francisco, CA 94133',
        description: 'Visit this historic dive bar for a mid-afternoon drink. Try a Negroni or local beer. Chat with friendly bartenders who know the neighborhood\'s stories.',
        dwellTime: 25,
        notes: 'Cash preferred. Authentic dive bar vibe.',
        isPassThrough: false
      },
      {
        id: 'step-4',
        order: 4,
        name: 'Columbus Avenue Stroll',
        address: 'Columbus Ave, San Francisco, CA 94133',
        description: 'Walk down historic Columbus Avenue past City Lights Bookstore, Italian delis, and vintage neon signs. Feel the neighborhood\'s Beat Generation history.',
        dwellTime: 15,
        notes: 'Stop for photos at City Lights if desired.',
        isPassThrough: true
      },
      {
        id: 'step-5',
        order: 5,
        name: '15 Romolo',
        address: '15 Romolo Pl, San Francisco, CA 94133',
        description: 'Finish at this hidden speakeasy up a charming alley. Order craft cocktails in the intimate upstairs space. Toast your North Beach adventure.',
        dwellTime: 40,
        notes: 'Can get busy evenings - arrive before 6pm.',
        isPassThrough: false
      }
    ],
    isMultiStop: true,
    totalDistance: '1.2 km',
    transportMode: 'walking',
    
    timeline: {
      arrivalWelcome: {
        description: 'Begin at iconic Caffe Trieste. Order your espresso at the bar Italian-style. Notice the vintage espresso machine and photos of Frank Sinatra on the walls.',
        location: '601 Vallejo St, San Francisco, CA 94133',
        locationName: 'Caffe Trieste'
      },
      mainActivity: {
        description: 'Cross to Washington Square Park. Watch locals doing tai chi, playing with dogs, and relaxing. The church spires create a European atmosphere.',
        location: 'Washington Square, San Francisco, CA 94133',
        locationName: 'Washington Square Park'
      },
      immersionAddon: {
        description: 'Step into Gino & Carlo, a neighborhood institution since 1942. Order at the bar and grab a seat. Strike up conversations with regulars.',
        location: '548 Green St, San Francisco, CA 94133',
        locationName: 'Gino & Carlo Bar'
      },
      highlightMoment: {
        description: 'Wander Columbus Avenue, the heart of North Beach. Pass City Lights Bookstore and vintage Italian businesses. Stop for gelato if desired.',
        location: 'Columbus Ave, San Francisco, CA 94133',
        locationName: 'Columbus Avenue'
      },
      closingTouch: {
        description: 'Discover 15 Romolo hidden up a quaint alley. Climb the stairs to the intimate cocktail lounge. Order expertly crafted drinks and savor the secret hideaway vibe.',
        location: '15 Romolo Pl, San Francisco, CA 94133',
        locationName: '15 Romolo Speakeasy'
      }
    },
    
    matchWeights: {
      soloAdventure: 0.7,
      firstDate: 0.85,
      romantic: 0.8,
      friendly: 0.95,
      groupFun: 0.9,
      business: 0.6
    },
    
    status: 'live',
    createdBy: 'platform',
    createdByRole: 'platform',
    weatherDependent: false,
    bestTimeOfDay: ['afternoon', 'evening']
  },

  // 3. SCREEN & RELAX - Alamo Drafthouse Cinema Experience
  {
    id: 'route-screen-001',
    title: 'Alamo Drafthouse Dinner & Movie Night',
    category: 'screen-relax',
    categoryLabel: 'Screen & Relax',
    description: 'Full cinema experience with craft food, drinks, and premium movie viewing',
    fullDescription: 'Enjoy the ultimate movie night at Alamo Drafthouse, where cinema meets culinary excellence. Start with pre-show drinks at their stylish bar, order gourmet dinner and craft cocktails served to your seat during the movie, and finish with dessert and discussion at their lounge. No talking or texting allowed - they take movies seriously here.',
    venue: 'Alamo Drafthouse Cinema',
    location: 'Mission District, San Francisco, CA',
    rating: 4.7,
    reviewCount: 2341,
    priceRange: '$45-75',
    pricePerPerson: 60,
    duration: '3-3.5 hours',
    images: [
      'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800',
      'https://images.unsplash.com/photo-1595769816263-9b910be24d5f?w=800',
      'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=800'
    ],
    highlights: [
      'Dinner & drinks at your seat',
      'No talking/texting policy',
      'Craft cocktails & beer',
      'Premium recliners',
      'Pre-show entertainment'
    ],
    tags: ['cinema', 'dinner', 'cocktails', 'premium', 'entertainment', 'indoor', 'date night'],
    atmosphereMarkers: ['Fun', 'Premium', 'Entertaining', 'Comfortable', 'Cinematic'],
    
    routeSteps: [
      {
        id: 'step-1',
        order: 1,
        name: 'Alamo Drafthouse Bar',
        address: '2550 Mission St, San Francisco, CA 94110',
        description: 'Arrive 30 minutes early and start at the stylish lobby bar. Order craft cocktails or local beers while browsing the cinema\'s menu.',
        dwellTime: 20,
        notes: 'Popular spot - arrive early for good bar seats.',
        isPassThrough: false
      },
      {
        id: 'step-2',
        order: 2,
        name: 'Theater Seating',
        address: 'Alamo Drafthouse Cinema, 2550 Mission St, SF',
        description: 'Head to your reserved seats 10 minutes before showtime. Get comfortable in the premium recliners and place your food order using the table card.',
        dwellTime: 5,
        notes: 'Reserved seating - pick your seats online.',
        isPassThrough: false
      },
      {
        id: 'step-3',
        order: 3,
        name: 'Pre-Show Entertainment',
        address: 'Alamo Drafthouse Cinema Theater',
        description: 'Enjoy curated pre-show clips and trivia related to your movie. Sip your drinks as anticipation builds. No commercials, just film-related content.',
        dwellTime: 15,
        notes: 'Unique to Alamo - custom content for each film.',
        isPassThrough: false
      },
      {
        id: 'step-4',
        order: 4,
        name: 'Movie & Dining Experience',
        address: 'Alamo Drafthouse Cinema Theater',
        description: 'Watch the film while servers silently deliver your meals. Enjoy burgers, pizzas, salads, and desserts. Order more drinks throughout the movie using cards.',
        dwellTime: 135,
        notes: 'Service ends 30 min before film ends.',
        isPassThrough: false
      },
      {
        id: 'step-5',
        order: 5,
        name: 'Post-Movie Lounge Discussion',
        address: 'Alamo Drafthouse Lobby',
        description: 'After the credits, head to the lobby lounge area. Discuss the film over final drinks or dessert. Browse movie merchandise and books.',
        dwellTime: 25,
        notes: 'Great for processing the film with friends.',
        isPassThrough: false
      }
    ],
    isMultiStop: false,
    totalDistance: '0 km (single venue)',
    transportMode: 'walking',
    
    timeline: {
      arrivalWelcome: {
        description: 'Enter the vibrant Alamo Drafthouse lobby. Check in at the box office and head straight to the bar. Order a craft cocktail or local draft beer.',
        location: '2550 Mission St, San Francisco, CA 94110',
        locationName: 'Alamo Bar & Lobby'
      },
      mainActivity: {
        description: 'Find your reserved seats in the theater. Notice the spacious reclining seats and personal dining tables. Write your food order on the card provided.',
        location: 'Alamo Drafthouse Cinema, Theater',
        locationName: 'Premium Theater Seating'
      },
      immersionAddon: {
        description: 'Watch the custom pre-show content - never boring commercials, always film-related clips and trivia. Servers begin bringing your appetizers and drinks.',
        location: 'Alamo Drafthouse Cinema Theater',
        locationName: 'Pre-Show Entertainment'
      },
      highlightMoment: {
        description: 'The lights dim and the movie begins. Servers silently deliver your entrees and refills throughout the film. Enjoy the perfect pairing of cinema and cuisine.',
        location: 'Alamo Drafthouse Cinema Theater',
        locationName: 'Movie & Dinner Service'
      },
      closingTouch: {
        description: 'As credits roll, head to the lobby. Order dessert or a nightcap at the bar. Discuss favorite scenes and plot twists in the comfortable lounge area.',
        location: 'Alamo Drafthouse Lobby',
        locationName: 'Post-Movie Lounge'
      }
    },
    
    matchWeights: {
      soloAdventure: 0.6,
      firstDate: 0.9,
      romantic: 0.85,
      friendly: 0.95,
      groupFun: 0.9,
      business: 0.3
    },
    
    status: 'live',
    createdBy: 'platform',
    createdByRole: 'platform',
    weatherDependent: false,
    bestTimeOfDay: ['evening', 'late-night']
  },

  // 4. DINING EXPERIENCES - Progressive Dinner in Hayes Valley
  {
    id: 'route-dining-001',
    title: 'Hayes Valley Progressive Dinner',
    category: 'dining',
    categoryLabel: 'Dining Experiences',
    description: 'Four-course culinary journey through one of SF\'s most charming neighborhoods',
    fullDescription: 'Experience multiple cuisines in one unforgettable evening. Start with craft cocktails and oysters at a stylish bar, enjoy Thai small plates at a neighborhood favorite, savor Italian pasta at a cozy trattoria, and finish with artisanal ice cream while strolling the tree-lined streets. Each venue is within a 3-minute walk, making this the perfect slow-paced culinary adventure.',
    venue: 'Hayes Valley',
    location: 'Hayes Valley, San Francisco, CA',
    rating: 4.9,
    reviewCount: 892,
    priceRange: '$75-110',
    pricePerPerson: 95,
    duration: '3-3.5 hours',
    images: [
      'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800',
      'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800',
      'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800'
    ],
    highlights: [
      'Four distinct venues',
      'Craft cocktails & oysters',
      'Thai & Italian cuisine',
      'Artisan ice cream',
      'Walkable neighborhood charm'
    ],
    tags: ['fine dining', 'progressive dinner', 'cocktails', 'walkable', 'romantic', 'foodie', 'special occasion'],
    atmosphereMarkers: ['Sophisticated', 'Romantic', 'Culinary', 'Intimate', 'Memorable'],
    
    routeSteps: [
      {
        id: 'step-1',
        order: 1,
        name: 'Riddler',
        address: '528 Laguna St, San Francisco, CA 94102',
        description: 'Begin at this chic champagne bar. Order a glass of bubbly and fresh oysters. The sophisticated atmosphere sets the tone for the evening.',
        dwellTime: 35,
        notes: 'Reservations recommended. Great champagne selection.',
        isPassThrough: false
      },
      {
        id: 'step-2',
        order: 2,
        name: 'Stroll Through Hayes Valley',
        address: 'Hayes St, San Francisco, CA 94102',
        description: 'Walk the charming Hayes Street corridor. Admire boutiques, art galleries, and the unique Patricia\'s Green park with its changing art installations.',
        dwellTime: 8,
        notes: 'Great for window shopping and people watching.',
        isPassThrough: true
      },
      {
        id: 'step-3',
        order: 3,
        name: 'Nari',
        address: '1625 Post St, San Francisco, CA 94115',
        description: 'Enjoy elevated Thai cuisine by James Beard-nominated Chef Pim. Share 2-3 small plates. The flavors are bold yet refined.',
        dwellTime: 45,
        notes: 'Small plates meant for sharing. Order a Thai beer.',
        isPassThrough: false
      },
      {
        id: 'step-4',
        order: 4,
        name: 'Patricia\'s Green Park',
        address: 'Octavia Blvd & Hayes St, San Francisco, CA 94102',
        description: 'Pause at this unique urban park. Sit on benches, admire public art installations, and enjoy the neighborhood vibe before your main course.',
        dwellTime: 10,
        notes: 'Beautiful at sunset. Often has food trucks.',
        isPassThrough: true
      },
      {
        id: 'step-5',
        order: 5,
        name: 'Che Fico',
        address: '838 Divisadero St, San Francisco, CA 94117',
        description: 'Settle in for handmade pasta at this beloved Italian spot. Order a signature pasta dish and share a Caesar salad. The wood-fired pizzas are also excellent.',
        dwellTime: 55,
        notes: 'Reserve ahead. Popular spot. Great wine list.',
        isPassThrough: false
      },
      {
        id: 'step-6',
        order: 6,
        name: 'Salt & Straw',
        address: '432 Octavia St, San Francisco, CA 94102',
        description: 'End with artisan ice cream featuring creative flavors like honey lavender or pear & blue cheese. Stroll the neighborhood while enjoying your cones.',
        dwellTime: 20,
        notes: 'Lines can be long but move quickly.',
        isPassThrough: false
      }
    ],
    isMultiStop: true,
    totalDistance: '1.5 km',
    transportMode: 'walking',
    
    timeline: {
      arrivalWelcome: {
        description: 'Arrive at The Riddler and check in for your reservation. Order a glass of champagne and half dozen oysters. Toast to the evening ahead in the elegant space.',
        location: '528 Laguna St, San Francisco, CA 94102',
        locationName: 'The Riddler'
      },
      mainActivity: {
        description: 'Walk to Nari through charming Hayes Valley streets. Order 2-3 Thai small plates to share - the larb, papaya salad, and any curry are excellent. Pace yourselves for more courses.',
        location: '1625 Post St, San Francisco, CA 94115',
        locationName: 'Nari'
      },
      immersionAddon: {
        description: 'Stroll through Patricia\'s Green park. Admire the rotating art installations and the neighborhood\'s transformation from highway to urban oasis. Take photos with interesting sculptures.',
        location: 'Octavia Blvd & Hayes St, San Francisco, CA 94102',
        locationName: 'Patricia\'s Green'
      },
      highlightMoment: {
        description: 'Arrive at Che Fico for the dinner highlight. Order handmade pasta - the cacio e pepe or uni spaghetti are favorites. Share a Caesar salad. Pair with Italian wine.',
        location: '838 Divisadero St, San Francisco, CA 94117',
        locationName: 'Che Fico'
      },
      closingTouch: {
        description: 'Walk to Salt & Straw for the sweet finale. Sample creative flavors before choosing. Enjoy your ice cream while strolling back through Hayes Valley, reminiscing about the meal.',
        location: '432 Octavia St, San Francisco, CA 94102',
        locationName: 'Salt & Straw'
      }
    },
    
    matchWeights: {
      soloAdventure: 0.5,
      firstDate: 0.95,
      romantic: 0.95,
      friendly: 0.85,
      groupFun: 0.8,
      business: 0.7
    },
    
    status: 'live',
    createdBy: 'platform',
    createdByRole: 'platform',
    weatherDependent: false,
    bestTimeOfDay: ['evening']
  }
];

/**
 * Helper function to integrate these cards into the platform
 * Add to SwipeableCardsData.ts or similar seed file
 */
export const getNewRouteCards = () => {
  return newRouteCards.map(card => ({
    ...card,
    // Ensure compatibility with existing card display system
    isFeatured: false,
    views: Math.floor(Math.random() * 5000) + 1000,
    likes: Math.floor(Math.random() * 500) + 100,
    saves: Math.floor(Math.random() * 300) + 50,
    purchaseCount: Math.floor(Math.random() * 150) + 20,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));
};
