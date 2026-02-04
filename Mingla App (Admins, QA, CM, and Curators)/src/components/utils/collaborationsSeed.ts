/**
 * Seed data for collaborations and chat messages
 * 
 * This seed data creates:
 * 1. Experience cards with businessId and curator connections
 * 2. Chat messages for each collaboration
 * 3. Test data for both curator and business perspectives
 */

export interface ChatMessage {
  id: string;
  collaborationId: string;
  senderId: string;
  senderName: string;
  senderType: 'curator' | 'business';
  message: string;
  timestamp: string;
  read: boolean;
}

export interface CollaborationCard {
  id: string;
  title: string;
  description: string;
  category: string;
  businessId: string;
  businessName: string;
  createdBy: string; // curator email or id
  curatorName: string;
  location: string;
  price: number;
  duration: string;
  images: string[];
  status: 'live';
  createdAt: string;
  commission: number;
}

// Experience cards created by curators for businesses
export const COLLABORATION_CARDS: CollaborationCard[] = [
  {
    id: 'collab-card-1',
    title: 'Jazz & Wine Evening at The Blue Note',
    description: 'Experience an intimate evening of live jazz music paired with premium wines. Enjoy performances from talented local and touring artists in our cozy venue.',
    category: 'screenRelax',
    businessId: 'business-blue-note',
    businessName: 'The Blue Note SF',
    createdBy: 'curator-002',
    curatorName: 'Maria Chen',
    location: 'SoMa, San Francisco',
    price: 75,
    duration: '3 hours',
    images: [],
    status: 'live',
    createdAt: '2025-01-15T14:00:00Z',
    commission: 10
  },
  {
    id: 'collab-card-2',
    title: 'Bay Kayaking Adventure',
    description: 'Paddle through the beautiful San Francisco Bay with experienced guides. Perfect for beginners and experienced kayakers alike. Includes all equipment and safety briefing.',
    category: 'playMove',
    businessId: 'business-bay-adventures',
    businessName: 'Bay Adventures',
    createdBy: 'curator-002',
    curatorName: 'Maria Chen',
    location: 'Marina District, San Francisco',
    price: 85,
    duration: '2.5 hours',
    images: [],
    status: 'live',
    createdAt: '2025-01-16T10:00:00Z',
    commission: 10
  },
  {
    id: 'collab-card-3',
    title: 'Farm-to-Table Brunch Experience',
    description: 'Indulge in a seasonal brunch featuring ingredients sourced from local farms. Chef-curated menu changes weekly based on what\'s fresh and in season.',
    category: 'casualEats',
    businessId: 'business-farmhouse',
    businessName: 'The Farmhouse Kitchen',
    createdBy: 'curator-001',
    curatorName: 'Alex Thompson',
    location: 'Hayes Valley, San Francisco',
    price: 55,
    duration: '2 hours',
    images: [],
    status: 'live',
    createdAt: '2025-01-17T08:00:00Z',
    commission: 10
  },
  {
    id: 'collab-card-4',
    title: 'Classic Movies Under the Stars',
    description: 'Watch timeless cinema on our rooftop with stunning city views. Blankets and popcorn included. This month: Film noir classics.',
    category: 'screenRelax',
    businessId: 'business-skyview',
    businessName: 'SkyView Cinema',
    createdBy: 'curator-002',
    curatorName: 'Maria Chen',
    location: 'Downtown SF',
    price: 40,
    duration: '3 hours',
    images: [],
    status: 'live',
    createdAt: '2025-01-18T13:00:00Z',
    commission: 10
  },
  {
    id: 'collab-card-5',
    title: 'Sunset Yoga & Meditation',
    description: 'Unwind with guided yoga and meditation as the sun sets over the Pacific. All levels welcome. Includes yoga mat, refreshments, and ocean views.',
    category: 'wellnessDates',
    businessId: 'business-zen-studio',
    businessName: 'Zen Studio by the Bay',
    createdBy: 'curator-003',
    curatorName: 'Sarah Williams',
    location: 'Ocean Beach, San Francisco',
    price: 45,
    duration: '90 minutes',
    images: [],
    status: 'live',
    createdAt: '2025-01-19T09:00:00Z',
    commission: 10
  },
  {
    id: 'collab-card-6',
    title: 'Artisan Chocolate Tasting Workshop',
    description: 'Discover the art of chocolate making with our master chocolatier. Learn about cacao origins, tasting techniques, and create your own chocolate bar to take home.',
    category: 'creativeHandsOn',
    businessId: 'business-cacao-lab',
    businessName: 'The Cacao Lab',
    createdBy: 'curator-001',
    curatorName: 'Alex Thompson',
    location: 'Mission District, San Francisco',
    price: 68,
    duration: '2 hours',
    images: [],
    status: 'live',
    createdAt: '2025-01-20T11:00:00Z',
    commission: 10
  }
];

// Chat messages for each collaboration
export const COLLABORATION_CHAT_MESSAGES: ChatMessage[] = [
  // Collaboration 1: Jazz & Wine Evening (curator-002 & business-blue-note) - ESTABLISHED PARTNERSHIP
  {
    id: 'msg-1-1',
    collaborationId: 'collab_collab-card-1',
    senderId: 'curator-002',
    senderName: 'Maria Chen',
    senderType: 'curator',
    message: 'Hi! I\'ve been thinking about creating an experience for The Blue Note. Your venue would be perfect for a jazz and wine pairing evening. Would you be interested in collaborating?',
    timestamp: '2025-01-10T14:30:00Z',
    read: true
  },
  {
    id: 'msg-1-2',
    collaborationId: 'collab_collab-card-1',
    senderId: 'business-blue-note',
    senderName: 'The Blue Note SF',
    senderType: 'business',
    message: 'Maria! Great to hear from you. We\'d love to collaborate. We already host jazz nights but haven\'t really marketed them as "experiences" before. What did you have in mind?',
    timestamp: '2025-01-10T15:45:00Z',
    read: true
  },
  {
    id: 'msg-1-3',
    collaborationId: 'collab_collab-card-1',
    senderId: 'curator-002',
    senderName: 'Maria Chen',
    senderType: 'curator',
    message: 'I was thinking about packaging it as "Jazz & Wine Evening at The Blue Note" - intimate setting, live music, curated wine selection. Price point around $75-85 per person for a 3-hour experience. What do you think?',
    timestamp: '2025-01-10T16:00:00Z',
    read: true
  },
  {
    id: 'msg-1-4',
    collaborationId: 'collab_collab-card-1',
    senderId: 'business-blue-note',
    senderName: 'The Blue Note SF',
    senderType: 'business',
    message: 'I like the concept! $75 sounds good. We can include premium wines and our small plates menu. What about your commission rate?',
    timestamp: '2025-01-10T16:20:00Z',
    read: true
  },
  {
    id: 'msg-1-5',
    collaborationId: 'collab_collab-card-1',
    senderId: 'curator-002',
    senderName: 'Maria Chen',
    senderType: 'curator',
    message: 'I typically work with 15% commission on bookings. For reference, I\'ve helped sell 200+ experiences last quarter across my portfolio. I\'d handle all marketing, photography, and customer service.',
    timestamp: '2025-01-10T16:45:00Z',
    read: true
  },
  {
    id: 'msg-1-6',
    collaborationId: 'collab_collab-card-1',
    senderId: 'business-blue-note',
    senderName: 'The Blue Note SF',
    senderType: 'business',
    message: 'Can we negotiate that down to 12%? We already have thin margins on our jazz nights. But I love your track record!',
    timestamp: '2025-01-11T10:00:00Z',
    read: true
  },
  {
    id: 'msg-1-7',
    collaborationId: 'collab_collab-card-1',
    senderId: 'curator-002',
    senderName: 'Maria Chen',
    senderType: 'curator',
    message: 'I understand! How about we meet in the middle at 13%? I\'ll also commit to promoting it heavily through my social channels and network. I have 15K followers interested in music experiences.',
    timestamp: '2025-01-11T11:30:00Z',
    read: true
  },
  {
    id: 'msg-1-8',
    collaborationId: 'collab_collab-card-1',
    senderId: 'business-blue-note',
    senderName: 'The Blue Note SF',
    senderType: 'business',
    message: 'Deal! 13% works for us. Let\'s do this! 🎵',
    timestamp: '2025-01-11T12:00:00Z',
    read: true
  },
  {
    id: 'msg-1-9',
    collaborationId: 'collab_collab-card-1',
    senderId: 'curator-002',
    senderName: 'Maria Chen',
    senderType: 'curator',
    message: 'Excellent! I\'ll create the experience card today. Can you send me some high-res photos of the venue and current artist lineup? Also, should we highlight that it\'s a rotating lineup each week?',
    timestamp: '2025-01-11T14:00:00Z',
    read: true
  },
  {
    id: 'msg-1-10',
    collaborationId: 'collab_collab-card-1',
    senderId: 'business-blue-note',
    senderName: 'The Blue Note SF',
    senderType: 'business',
    message: 'Will do! Yes, definitely mention the rotating artists. We have both local and touring musicians. This week is Sarah Vincent Trio, next week is The Bay Jazz Collective. I\'ll email you the photos within the hour.',
    timestamp: '2025-01-11T14:30:00Z',
    read: true
  },
  {
    id: 'msg-1-11',
    collaborationId: 'collab_collab-card-1',
    senderId: 'curator-002',
    senderName: 'Maria Chen',
    senderType: 'curator',
    message: '✅ Experience is LIVE! Check it out: "Jazz & Wine Evening at The Blue Note" - I highlighted the rotating artists, intimate atmosphere, and included food options. Let me know if you want any tweaks!',
    timestamp: '2025-01-15T14:30:00Z',
    read: true
  },
  {
    id: 'msg-1-12',
    collaborationId: 'collab_collab-card-1',
    senderId: 'business-blue-note',
    senderName: 'The Blue Note SF',
    senderType: 'business',
    message: 'WOW! The listing looks incredible. The photos you edited are perfect. Already seeing interest!',
    timestamp: '2025-01-15T15:45:00Z',
    read: true
  },
  {
    id: 'msg-1-13',
    collaborationId: 'collab_collab-card-1',
    senderId: 'curator-002',
    senderName: 'Maria Chen',
    senderType: 'curator',
    message: 'Perfect! I\'ve seen 15 bookings already this week. The experience is really taking off! 🎵 I\'m going to boost it on Instagram Stories tonight too.',
    timestamp: '2025-01-18T09:00:00Z',
    read: true
  },
  {
    id: 'msg-1-14',
    collaborationId: 'collab_collab-card-1',
    senderId: 'business-blue-note',
    senderName: 'The Blue Note SF',
    senderType: 'business',
    message: 'That\'s amazing! We\'re almost at capacity for Friday and Saturday. This partnership is already paying off. Thank you! 🙏',
    timestamp: '2025-01-18T10:15:00Z',
    read: true
  },
  {
    id: 'msg-1-15',
    collaborationId: 'collab_collab-card-1',
    senderId: 'curator-002',
    senderName: 'Maria Chen',
    senderType: 'curator',
    message: 'Love to hear it! Quick note: Several customers are asking about Valentine\'s Day. Should we create a special "Valentine\'s Jazz Night" experience? Maybe add roses and chocolate? Could command $95-100 price point.',
    timestamp: '2025-01-19T16:30:00Z',
    read: false
  },

  // Collaboration 2: Bay Kayaking (curator-002 & business-bay-adventures) - ACTIVE NEGOTIATIONS
  {
    id: 'msg-2-1',
    collaborationId: 'collab_collab-card-2',
    senderId: 'curator-002',
    senderName: 'Maria Chen',
    senderType: 'curator',
    message: 'Hi Bay Adventures! I\'m Maria, a curator on Mingla. I love what you\'re doing with kayaking tours. I think there\'s huge potential to package these as premium "experiences" and reach couples looking for outdoor dates. Interested in chatting?',
    timestamp: '2025-01-14T10:30:00Z',
    read: true
  },
  {
    id: 'msg-2-2',
    collaborationId: 'collab_collab-card-2',
    senderId: 'business-bay-adventures',
    senderName: 'Bay Adventures',
    senderType: 'business',
    message: 'Hey Maria! We\'re always looking to expand. Tell us more about how this works. What\'s your experience with outdoor activities?',
    timestamp: '2025-01-14T11:00:00Z',
    read: true
  },
  {
    id: 'msg-2-3',
    collaborationId: 'collab_collab-card-2',
    senderId: 'curator-002',
    senderName: 'Maria Chen',
    senderType: 'curator',
    message: 'I curate experiences across SF - music, food, and outdoor activities. For kayaking, I\'d position it as a "Bay Kayaking Adventure" focusing on the romantic/date aspect. I\'m thinking $85 per person, includes all equipment, safety briefing, and guided 2.5 hour tour.',
    timestamp: '2025-01-14T11:15:00Z',
    read: true
  },
  {
    id: 'msg-2-4',
    collaborationId: 'collab_collab-card-2',
    senderId: 'business-bay-adventures',
    senderName: 'Bay Adventures',
    senderType: 'business',
    message: 'Price sounds right. Our sunset tours are actually our most popular - especially for couples. Have you thought about those? We could go up to $120 for sunset with champagne.',
    timestamp: '2025-01-14T12:00:00Z',
    read: true
  },
  {
    id: 'msg-2-5',
    collaborationId: 'collab_collab-card-2',
    senderId: 'curator-002',
    senderName: 'Maria Chen',
    senderType: 'curator',
    message: 'LOVE the sunset + champagne idea! Let\'s start with the standard bay tour and if that performs well, we can add sunset as a premium tier. My commission is typically 15%. I\'d handle all marketing, customer communication, and manage reviews.',
    timestamp: '2025-01-14T13:30:00Z',
    read: true
  },
  {
    id: 'msg-2-6',
    collaborationId: 'collab_collab-card-2',
    senderId: 'business-bay-adventures',
    senderName: 'Bay Adventures',
    senderType: 'business',
    message: '15% feels high for us. We\'re already doing the tours - you\'d just be marketing them. Can we do 10%?',
    timestamp: '2025-01-15T09:00:00Z',
    read: true
  },
  {
    id: 'msg-2-7',
    collaborationId: 'collab_collab-card-2',
    senderId: 'curator-002',
    senderName: 'Maria Chen',
    senderType: 'curator',
    message: 'I hear you! But I\'m not just marketing - I\'m building the experience narrative, taking/editing photos, managing customer service, handling reviews, and bringing my audience. How about 12%? That\'s below my standard but I believe in this partnership.',
    timestamp: '2025-01-15T10:30:00Z',
    read: true
  },
  {
    id: 'msg-2-8',
    collaborationId: 'collab_collab-card-2',
    senderId: 'business-bay-adventures',
    senderName: 'Bay Adventures',
    senderType: 'business',
    message: '12% works! Let\'s give it a shot. When can you have the experience live?',
    timestamp: '2025-01-15T14:00:00Z',
    read: true
  },
  {
    id: 'msg-2-9',
    collaborationId: 'collab_collab-card-2',
    senderId: 'curator-002',
    senderName: 'Maria Chen',
    senderType: 'curator',
    message: '🎉 Awesome! I can have it ready tomorrow. Need to schedule a photo session - can I come by for the sunset tour this evening? I\'ll bring my camera and maybe grab some action shots.',
    timestamp: '2025-01-15T14:30:00Z',
    read: true
  },
  {
    id: 'msg-2-10',
    collaborationId: 'collab_collab-card-2',
    senderId: 'business-bay-adventures',
    senderName: 'Bay Adventures',
    senderType: 'business',
    message: 'Perfect! Come by at 5:30pm. Meet at the Marina dock. I\'ll have a couple kayaks ready for you. Bring warm layers - it gets chilly out there!',
    timestamp: '2025-01-15T15:00:00Z',
    read: true
  },
  {
    id: 'msg-2-11',
    collaborationId: 'collab_collab-card-2',
    senderId: 'curator-002',
    senderName: 'Maria Chen',
    senderType: 'curator',
    message: '✅ Just launched! "Bay Kayaking Adventure" is now live at $85. Set it for Marina District, highlighted the beginner-friendly aspect, and included all the safety info. Photos came out amazing!',
    timestamp: '2025-01-16T10:30:00Z',
    read: true
  },
  {
    id: 'msg-2-12',
    collaborationId: 'collab_collab-card-2',
    senderId: 'business-bay-adventures',
    senderName: 'Bay Adventures',
    senderType: 'business',
    message: 'Wow, the listing looks professional! You really captured the vibe. Already got 2 bookings this morning 😊',
    timestamp: '2025-01-16T11:00:00Z',
    read: true
  },
  {
    id: 'msg-2-13',
    collaborationId: 'collab_collab-card-2',
    senderId: 'curator-002',
    senderName: 'Maria Chen',
    senderType: 'curator',
    message: 'Fantastic! Let\'s talk about that sunset tour soon. I think we could position it as "Sunset Kayak + Champagne" and it would fly off the shelves. Maybe next week?',
    timestamp: '2025-01-16T11:15:00Z',
    read: true
  },
  {
    id: 'msg-2-14',
    collaborationId: 'collab_collab-card-2',
    senderId: 'business-bay-adventures',
    senderName: 'Bay Adventures',
    senderType: 'business',
    message: 'Yes! Let\'s plan for that. The weather is getting better too. Perfect timing for spring/summer bookings.',
    timestamp: '2025-01-16T12:00:00Z',
    read: false
  },

  // Collaboration 3: Farm-to-Table Brunch (curator-001 & business-farmhouse) - SUCCESSFUL LAUNCH
  {
    id: 'msg-3-1',
    collaborationId: 'collab_collab-card-3',
    senderId: 'business-farmhouse',
    senderName: 'The Farmhouse Kitchen',
    senderType: 'business',
    message: 'Hi Alex! We were referred to you by The Blue Note. They said you\'re an amazing curator and helped them get fully booked. We\'d love to work with you!',
    timestamp: '2025-01-12T08:30:00Z',
    read: true
  },
  {
    id: 'msg-3-2',
    collaborationId: 'collab_collab-card-3',
    senderId: 'curator-001',
    senderName: 'Alex Thompson',
    senderType: 'curator',
    message: 'Hey! Thanks for reaching out! I love The Farmhouse - I\'ve eaten there several times. Your farm-to-table brunch is incredible. What are you looking to achieve with Mingla?',
    timestamp: '2025-01-12T09:00:00Z',
    read: true
  },
  {
    id: 'msg-3-3',
    collaborationId: 'collab_collab-card-3',
    senderId: 'business-farmhouse',
    senderName: 'The Farmhouse Kitchen',
    senderType: 'business',
    message: 'We want to attract couples for weekend brunch dates. We\'re known locally but want to reach the younger crowd who books experiences online. Our seasonal menu is our differentiator.',
    timestamp: '2025-01-12T09:30:00Z',
    read: true
  },
  {
    id: 'msg-3-4',
    collaborationId: 'collab_collab-card-3',
    senderId: 'curator-001',
    senderName: 'Alex Thompson',
    senderType: 'curator',
    message: 'Perfect! The seasonal angle is HUGE right now. I\'d call it "Farm-to-Table Brunch Experience" and really emphasize the rotating seasonal menu and local partnerships. What\'s your current brunch price?',
    timestamp: '2025-01-12T10:00:00Z',
    read: true
  },
  {
    id: 'msg-3-5',
    collaborationId: 'collab_collab-card-3',
    senderId: 'business-farmhouse',
    senderName: 'The Farmhouse Kitchen',
    senderType: 'business',
    message: 'Brunch runs $35-45 per person depending on what they order. We were thinking of creating a fixed "experience" menu at $55 that includes a welcome drink, appetizer, entree, and dessert.',
    timestamp: '2025-01-12T10:30:00Z',
    read: true
  },
  {
    id: 'msg-3-6',
    collaborationId: 'collab_collab-card-3',
    senderId: 'curator-001',
    senderName: 'Alex Thompson',
    senderType: 'curator',
    message: '$55 is perfect for Mingla\'s audience! That\'s a great value for a full experience. I typically charge 12% commission and handle everything from photography to customer service to marketing. Sound good?',
    timestamp: '2025-01-12T11:00:00Z',
    read: true
  },
  {
    id: 'msg-3-7',
    collaborationId: 'collab_collab-card-3',
    senderId: 'business-farmhouse',
    senderName: 'The Farmhouse Kitchen',
    senderType: 'business',
    message: '12% works for us! When can we get started? Also, we partner with Green Valley Farms - definitely want to highlight that.',
    timestamp: '2025-01-12T11:30:00Z',
    read: true
  },
  {
    id: 'msg-3-8',
    collaborationId: 'collab_collab-card-3',
    senderId: 'curator-001',
    senderName: 'Alex Thompson',
    senderType: 'curator',
    message: 'Let\'s do this! Green Valley Farms is a great hook. Can I come shoot the brunch service this Sunday? I\'ll need photos of the space, food, and happy customers (with permission of course).',
    timestamp: '2025-01-12T14:00:00Z',
    read: true
  },
  {
    id: 'msg-3-9',
    collaborationId: 'collab_collab-card-3',
    senderId: 'business-farmhouse',
    senderName: 'The Farmhouse Kitchen',
    senderType: 'business',
    message: 'Sunday works! Come around 10am. I\'ll make sure our chef knows you\'re coming and we\'ll plate some beautiful dishes for you. Should we comp your brunch? 😊',
    timestamp: '2025-01-12T15:00:00Z',
    read: true
  },
  {
    id: 'msg-3-10',
    collaborationId: 'collab_collab-card-3',
    senderId: 'curator-001',
    senderName: 'Alex Thompson',
    senderType: 'curator',
    message: 'That would be amazing, thank you! I\'ll bring my good camera and lighting kit. Also, what about dietary restrictions? I know people always ask.',
    timestamp: '2025-01-12T15:30:00Z',
    read: true
  },
  {
    id: 'msg-3-11',
    collaborationId: 'collab_collab-card-3',
    senderId: 'business-farmhouse',
    senderName: 'The Farmhouse Kitchen',
    senderType: 'business',
    message: 'We accommodate everything - vegan, gluten-free, allergies. Just need 24 hours notice. That\'s actually a selling point!',
    timestamp: '2025-01-13T09:00:00Z',
    read: true
  },
  {
    id: 'msg-3-12',
    collaborationId: 'collab_collab-card-3',
    senderId: 'curator-001',
    senderName: 'Alex Thompson',
    senderType: 'curator',
    message: '✅ Experience is LIVE! "Farm-to-Table Brunch Experience" at $55. I highlighted the Green Valley Farms partnership, seasonal menu, and dietary accommodations. The photos look incredible - that avocado toast shot is magazine-worthy!',
    timestamp: '2025-01-17T08:30:00Z',
    read: true
  },
  {
    id: 'msg-3-13',
    collaborationId: 'collab_collab-card-3',
    senderId: 'business-farmhouse',
    senderName: 'The Farmhouse Kitchen',
    senderType: 'business',
    message: 'WOW!! You made our food look like art. The description is perfect too. Already got 8 bookings for this weekend! This is exactly what we needed.',
    timestamp: '2025-01-17T10:00:00Z',
    read: true
  },
  {
    id: 'msg-3-14',
    collaborationId: 'collab_collab-card-3',
    senderId: 'curator-001',
    senderName: 'Alex Thompson',
    senderType: 'curator',
    message: 'So glad! I\'m promoting it hard this week. Quick question: any availability for Mother\'s Day weekend? Getting lots of inquiries already.',
    timestamp: '2025-01-19T14:00:00Z',
    read: true
  },
  {
    id: 'msg-3-15',
    collaborationId: 'collab_collab-card-3',
    senderId: 'business-farmhouse',
    senderName: 'The Farmhouse Kitchen',
    senderType: 'business',
    message: 'Yes! Mother\'s Day is huge for us. Should we create a special Mother\'s Day experience? Maybe add a flower or small gift? Could price at $65-70?',
    timestamp: '2025-01-19T14:30:00Z',
    read: false
  },

  // Collaboration 4: Classic Movies (curator-002 & business-skyview) - NEW NEGOTIATION
  {
    id: 'msg-4-1',
    collaborationId: 'collab_collab-card-4',
    senderId: 'curator-002',
    senderName: 'Maria Chen',
    senderType: 'curator',
    message: 'Hi SkyView! I saw you have a rooftop space and thought - outdoor cinema experiences would be PERFECT for summer. The view alone would make this special. Interested in collaborating?',
    timestamp: '2025-01-17T13:30:00Z',
    read: true
  },
  {
    id: 'msg-4-2',
    collaborationId: 'collab_collab-card-4',
    senderId: 'business-skyview',
    senderName: 'SkyView Cinema',
    senderType: 'business',
    message: 'Maria! We\'ve actually been thinking about doing outdoor screenings but haven\'t had the bandwidth to market it properly. Tell me more!',
    timestamp: '2025-01-17T14:00:00Z',
    read: true
  },
  {
    id: 'msg-4-3',
    collaborationId: 'collab_collab-card-4',
    senderId: 'curator-002',
    senderName: 'Maria Chen',
    senderType: 'curator',
    message: 'I\'m thinking "Classic Movies Under the Stars" - curated film selections (maybe themes?), blankets, popcorn, and that incredible city view. Position it as a date night option. Maybe $35-45 per person?',
    timestamp: '2025-01-17T14:30:00Z',
    read: true
  },
  {
    id: 'msg-4-4',
    collaborationId: 'collab_collab-card-4',
    senderId: 'business-skyview',
    senderName: 'SkyView Cinema',
    senderType: 'business',
    message: '$40 sounds perfect. We\'d provide the projector, screen, blankets, and popcorn. We\'re doing film noir classics this month. Weather-dependent though - would need to communicate that clearly.',
    timestamp: '2025-01-17T15:00:00Z',
    read: true
  },
  {
    id: 'msg-4-5',
    collaborationId: 'collab_collab-card-4',
    senderId: 'curator-002',
    senderName: 'Maria Chen',
    senderType: 'curator',
    message: 'Film noir is brilliant for creating ambiance! And yes, definitely need weather contingency. I\'d recommend sending updates 24 hours before with rain plan. My commission is 13% and I\'d handle all bookings, customer communication, and promotion.',
    timestamp: '2025-01-17T15:30:00Z',
    read: true
  },
  {
    id: 'msg-4-6',
    collaborationId: 'collab_collab-card-4',
    senderId: 'business-skyview',
    senderName: 'SkyView Cinema',
    senderType: 'business',
    message: '13% works! We\'re excited about this. When can we launch? Also, should we offer wine/beer for an additional fee?',
    timestamp: '2025-01-17T16:00:00Z',
    read: true
  },
  {
    id: 'msg-4-7',
    collaborationId: 'collab_collab-card-4',
    senderId: 'curator-002',
    senderName: 'Maria Chen',
    senderType: 'curator',
    message: 'Yes to wine/beer! That elevates it. Could do $40 base + optional $15 drinks package? Or build it into a $55 premium experience?',
    timestamp: '2025-01-17T16:30:00Z',
    read: true
  },
  {
    id: 'msg-4-8',
    collaborationId: 'collab_collab-card-4',
    senderId: 'business-skyview',
    senderName: 'SkyView Cinema',
    senderType: 'business',
    message: 'Let\'s keep it simple - $40 base price includes blankets and popcorn. Drinks available for purchase at our rooftop bar. Sound good?',
    timestamp: '2025-01-17T17:00:00Z',
    read: true
  },
  {
    id: 'msg-4-9',
    collaborationId: 'collab_collab-card-4',
    senderId: 'curator-002',
    senderName: 'Maria Chen',
    senderType: 'curator',
    message: 'Perfect! I can shoot photos tomorrow evening if the weather is good? Want to capture that golden hour light with the city skyline.',
    timestamp: '2025-01-17T17:30:00Z',
    read: true
  },
  {
    id: 'msg-4-10',
    collaborationId: 'collab_collab-card-4',
    senderId: 'business-skyview',
    senderName: 'SkyView Cinema',
    senderType: 'business',
    message: 'Come by at 6pm tomorrow! I\'ll have everything set up. Bring a friend for the "couple shots" if you want!',
    timestamp: '2025-01-17T18:00:00Z',
    read: true
  },
  {
    id: 'msg-4-11',
    collaborationId: 'collab_collab-card-4',
    senderId: 'curator-002',
    senderName: 'Maria Chen',
    senderType: 'curator',
    message: '✅ "Classic Movies Under the Stars" is LIVE! Priced at $40, included all the weather info and rooftop bar mention. The sunset photos came out gorgeous - that city backdrop is chef\'s kiss 😘',
    timestamp: '2025-01-18T13:30:00Z',
    read: true
  },
  {
    id: 'msg-4-12',
    collaborationId: 'collab_collab-card-4',
    senderId: 'business-skyview',
    senderName: 'SkyView Cinema',
    senderType: 'business',
    message: 'The listing is beautiful! You really captured the magic. Already have bookings for next weekend. What\'s the lineup for next month? Should we theme it differently?',
    timestamp: '2025-01-18T14:30:00Z',
    read: true
  },
  {
    id: 'msg-4-13',
    collaborationId: 'collab_collab-card-4',
    senderId: 'curator-002',
    senderName: 'Maria Chen',
    senderType: 'curator',
    message: 'Love the momentum! For next month, what about "Romantic Classics" for February leading into Valentine\'s? Think Casablanca, Roman Holiday, When Harry Met Sally. Could create a separate experience or update this one?',
    timestamp: '2025-01-18T15:00:00Z',
    read: false
  },

  // Collaboration 5: Sunset Yoga (curator-003 & business-zen-studio) - COMMISSION DISCUSSION
  {
    id: 'msg-5-1',
    collaborationId: 'collab_collab-card-5',
    senderId: 'curator-003',
    senderName: 'Sarah Williams',
    senderType: 'curator',
    message: 'Hi! I\'m Sarah, a wellness experience curator on Mingla. I discovered Zen Studio and I think your sunset yoga sessions would be perfect for couples looking for a calming date experience. Would you be open to listing on our platform?',
    timestamp: '2025-01-18T09:00:00Z',
    read: true
  },
  {
    id: 'msg-5-2',
    collaborationId: 'collab_collab-card-5',
    senderId: 'business-zen-studio',
    senderName: 'Zen Studio by the Bay',
    senderType: 'business',
    message: 'Hi Sarah! We\'ve heard great things about Mingla. Our sunset sessions have been popular with locals but we\'d love to reach more people. How does the partnership work?',
    timestamp: '2025-01-18T10:30:00Z',
    read: true
  },
  {
    id: 'msg-5-3',
    collaborationId: 'collab_collab-card-5',
    senderId: 'curator-003',
    senderName: 'Sarah Williams',
    senderType: 'curator',
    message: 'Great! I\'d create a curated listing for your sunset yoga sessions - handle all the photography, write compelling copy, manage bookings and customer questions. I typically charge 14% commission on each booking. You\'d keep full control over the actual experience.',
    timestamp: '2025-01-18T11:00:00Z',
    read: true
  },
  {
    id: 'msg-5-4',
    collaborationId: 'collab_collab-card-5',
    senderId: 'business-zen-studio',
    senderName: 'Zen Studio by the Bay',
    senderType: 'business',
    message: '14% feels a bit steep for us. We\'re a small studio with tight margins. Would you consider 10%? We currently price our sessions at $35 but could go up to $40-45 for the Mingla listing.',
    timestamp: '2025-01-18T12:00:00Z',
    read: true
  },
  {
    id: 'msg-5-5',
    collaborationId: 'collab_collab-card-5',
    senderId: 'curator-003',
    senderName: 'Sarah Williams',
    senderType: 'curator',
    message: 'I understand margins are tight! If we price at $45, that gives you better margins even with 12% commission. I bring serious marketing value - 20K Instagram followers in the wellness space, professional photography, and I\'ll feature it in my monthly newsletter. How about we meet at 12%?',
    timestamp: '2025-01-18T13:30:00Z',
    read: true
  },
  {
    id: 'msg-5-6',
    collaborationId: 'collab_collab-card-5',
    senderId: 'business-zen-studio',
    senderName: 'Zen Studio by the Bay',
    senderType: 'business',
    message: 'You know what, your Instagram following sold me! 12% at $45 works. That\'s actually better revenue than our current $35. When can you come shoot the session?',
    timestamp: '2025-01-18T14:30:00Z',
    read: true
  },
  {
    id: 'msg-5-7',
    collaborationId: 'collab_collab-card-5',
    senderId: 'curator-003',
    senderName: 'Sarah Williams',
    senderType: 'curator',
    message: '🙏 Perfect! I can come tomorrow evening for the sunset session. I\'ll bring my camera and maybe a couple friends to get some authentic "couple doing yoga" shots. What time does sunset session start?',
    timestamp: '2025-01-18T15:00:00Z',
    read: true
  },
  {
    id: 'msg-5-8',
    collaborationId: 'collab_collab-card-5',
    senderId: 'business-zen-studio',
    senderName: 'Zen Studio by the Bay',
    senderType: 'business',
    message: 'Session starts at 5:30pm to catch the golden hour. Come a bit early and I\'ll give you a tour. We provide mats, but the ocean view and atmosphere are what make it special!',
    timestamp: '2025-01-18T15:30:00Z',
    read: true
  },
  {
    id: 'msg-5-9',
    collaborationId: 'collab_collab-card-5',
    senderId: 'curator-003',
    senderName: 'Sarah Williams',
    senderType: 'curator',
    message: '✅ \"Sunset Yoga & Meditation\" is NOW LIVE at $45! The photos with the ocean and sunset are absolutely stunning. I emphasized the all-levels-welcome aspect and included the refreshments. Check it out!',
    timestamp: '2025-01-19T09:00:00Z',
    read: true
  },
  {
    id: 'msg-5-10',
    collaborationId: 'collab_collab-card-5',
    senderId: 'business-zen-studio',
    senderName: 'Zen Studio by the Bay',
    senderType: 'business',
    message: 'Sarah, this is INCREDIBLE! The photos are so peaceful and inviting. Already got 6 bookings this morning! This partnership is going to be amazing 🧘‍♀️',
    timestamp: '2025-01-19T10:30:00Z',
    read: true
  },
  {
    id: 'msg-5-11',
    collaborationId: 'collab_collab-card-5',
    senderId: 'curator-003',
    senderName: 'Sarah Williams',
    senderType: 'curator',
    message: 'So happy to hear! I\'m featuring it in this week\'s newsletter. Also thinking about a \"Sunrise Yoga\" variation for early birds - same price, different vibe. Thoughts?',
    timestamp: '2025-01-19T14:00:00Z',
    read: false
  },

  // Collaboration 6: Chocolate Workshop (curator-001 & business-cacao-lab) - DETAILED NEGOTIATION
  {
    id: 'msg-6-1',
    collaborationId: 'collab_collab-card-6',
    senderId: 'business-cacao-lab',
    senderName: 'The Cacao Lab',
    senderType: 'business',
    message: 'Hi Alex! We saw your amazing work with The Farmhouse Kitchen. We run chocolate tasting workshops and would love to collaborate. Are you taking on new business partners?',
    timestamp: '2025-01-16T11:00:00Z',
    read: true
  },
  {
    id: 'msg-6-2',
    collaborationId: 'collab_collab-card-6',
    senderId: 'curator-001',
    senderName: 'Alex Thompson',
    senderType: 'curator',
    message: 'Hey! Always excited to hear from businesses in the food space. Tell me more about your workshops! What makes them special?',
    timestamp: '2025-01-16T11:30:00Z',
    read: true
  },
  {
    id: 'msg-6-3',
    collaborationId: 'collab_collab-card-6',
    senderId: 'business-cacao-lab',
    senderName: 'The Cacao Lab',
    senderType: 'business',
    message: 'We offer 2-hour hands-on workshops where couples learn about cacao origins, tasting techniques, and actually make their own chocolate bars to take home. Our master chocolatier has 15 years experience. Currently priced at $60/person.',
    timestamp: '2025-01-16T12:00:00Z',
    read: true
  },
  {
    id: 'msg-6-4',
    collaborationId: 'collab_collab-card-6',
    senderId: 'curator-001',
    senderName: 'Alex Thompson',
    senderType: 'curator',
    message: 'That sounds amazing! The "take home your creation" aspect is perfect for couples. I think we could position this at $68-75 on Mingla. The hands-on + educational combo is very appealing. My standard commission is 12%.',
    timestamp: '2025-01-16T13:00:00Z',
    read: true
  },
  {
    id: 'msg-6-5',
    collaborationId: 'collab_collab-card-6',
    senderId: 'business-cacao-lab',
    senderName: 'The Cacao Lab',
    senderType: 'business',
    message: '$68 at 12% commission works for us! We love that you want to position it as premium. The chocolatier credential and take-home aspect definitely justify the price. What\'s your process?',
    timestamp: '2025-01-16T14:00:00Z',
    read: true
  },
  {
    id: 'msg-6-6',
    collaborationId: 'collab_collab-card-6',
    senderId: 'curator-001',
    senderName: 'Alex Thompson',
    senderType: 'curator',
    message: 'Perfect! First, I\'d love to come experience the workshop myself - both to understand the flow and get authentic photos. Can I attend one this weekend? I\'ll bring my camera and my partner for the "couple" angle.',
    timestamp: '2025-01-16T15:00:00Z',
    read: true
  },
  {
    id: 'msg-6-7',
    collaborationId: 'collab_collab-card-6',
    senderId: 'business-cacao-lab',
    senderName: 'The Cacao Lab',
    senderType: 'business',
    message: 'Absolutely! We have a workshop Saturday at 2pm. Come join - on the house for you both. I\'ll make sure our chocolatier knows you\'ll be photographing. The space looks best in afternoon light anyway.',
    timestamp: '2025-01-16T16:00:00Z',
    read: true
  },
  {
    id: 'msg-6-8',
    collaborationId: 'collab_collab-card-6',
    senderId: 'curator-001',
    senderName: 'Alex Thompson',
    senderType: 'curator',
    message: 'Thank you! Quick question about the experience: What\'s the group size? Do you do private workshops for couples or is it a group setting?',
    timestamp: '2025-01-16T16:30:00Z',
    read: true
  },
  {
    id: 'msg-6-9',
    collaborationId: 'collab_collab-card-6',
    senderId: 'business-cacao-lab',
    senderName: 'The Cacao Lab',
    senderType: 'business',
    message: 'Usually 6-8 couples max to keep it intimate. We can also do private sessions for $150/couple if someone wants exclusive experience. Should we list both options?',
    timestamp: '2025-01-16T17:00:00Z',
    read: true
  },
  {
    id: 'msg-6-10',
    collaborationId: 'collab_collab-card-6',
    senderId: 'curator-001',
    senderName: 'Alex Thompson',
    senderType: 'curator',
    message: 'Let\'s start with the group workshop and if it performs well, we can add private sessions as a premium tier. The group dynamic is actually fun for most couples!',
    timestamp: '2025-01-16T17:30:00Z',
    read: true
  },
  {
    id: 'msg-6-11',
    collaborationId: 'collab_collab-card-6',
    senderId: 'business-cacao-lab',
    senderName: 'The Cacao Lab',
    senderType: 'business',
    message: 'Sounds good! See you Saturday. Wear something you don\'t mind getting a little chocolate on 😄',
    timestamp: '2025-01-16T18:00:00Z',
    read: true
  },
  {
    id: 'msg-6-12',
    collaborationId: 'collab_collab-card-6',
    senderId: 'curator-001',
    senderName: 'Alex Thompson',
    senderType: 'curator',
    message: '✅ \"Artisan Chocolate Tasting Workshop\" is LIVE! Priced at $68. The workshop was fantastic - your chocolatier is so knowledgeable! Photos of people making chocolate and the finished bars look delicious. Emphasized the hands-on learning + take-home aspect.',
    timestamp: '2025-01-20T11:00:00Z',
    read: true
  },
  {
    id: 'msg-6-13',
    collaborationId: 'collab_collab-card-6',
    senderId: 'business-cacao-lab',
    senderName: 'The Cacao Lab',
    senderType: 'business',
    message: 'Alex, this listing is perfection! The description makes it sound so special. And those action shots of couples making chocolate together are perfect for date night marketing. Already fully booked for next weekend!',
    timestamp: '2025-01-20T12:00:00Z',
    read: true
  },
  {
    id: 'msg-6-14',
    collaborationId: 'collab_collab-card-6',
    senderId: 'curator-001',
    senderName: 'Alex Thompson',
    senderType: 'curator',
    message: 'Fantastic! With Valentine\'s Day coming up, this is going to be huge. Should we create a special Valentine\'s package? Maybe add champagne and special packaging for the chocolates they make?',
    timestamp: '2025-01-20T13:00:00Z',
    read: false
  }
];

/**
 * Initialize collaboration seed data in localStorage
 * Call this function on app load to populate test data
 */
export function initializeCollaborationSeedData() {
  console.log('🌱 Starting collaboration seed data initialization...');
  console.log(`  📋 COLLABORATION_CARDS array has ${COLLABORATION_CARDS.length} cards`);
  
  // Get existing platform cards
  const existingCards = JSON.parse(localStorage.getItem('platformCards') || '[]');
  console.log(`  📦 Found ${existingCards.length} existing platform cards`);
  
  // Add collaboration cards if they don't exist
  const collaborationCardIds = COLLABORATION_CARDS.map(c => c.id);
  const existingCollabCards = existingCards.filter((c: any) => 
    collaborationCardIds.includes(c.id)
  );
  
  // Only add cards if not already present
  if (existingCollabCards.length < COLLABORATION_CARDS.length) {
    const updatedCards = [...existingCards, ...COLLABORATION_CARDS];
    localStorage.setItem('platformCards', JSON.stringify(updatedCards));
    console.log(`✅ Added ${COLLABORATION_CARDS.length} collaboration cards to platform cards`);
  } else {
    console.log(`  ℹ️  Collaboration cards already exist in platform cards`);
  }
  
  // Create collaboration objects for the MessagesPage
  const existingCollaborations = JSON.parse(localStorage.getItem('collaborations') || '[]');
  console.log(`  💬 Found ${existingCollaborations.length} existing collaborations`);
  
  let newCollabsCreated = 0;
  
  COLLABORATION_CARDS.forEach(card => {
    const collaborationId = `collab_${card.id}`;
    
    // Check if this collaboration already exists
    const exists = existingCollaborations.some((c: any) => c.id === collaborationId);
    
    if (!exists) {
      const collaboration = {
        id: collaborationId,
        experienceId: card.id,
        experienceName: card.title,
        curatorId: card.createdBy,
        curatorName: card.curatorName,
        businessId: card.businessId,
        businessName: card.businessName,
        status: 'active',
        createdAt: card.createdAt,
      };
      
      existingCollaborations.push(collaboration);
      newCollabsCreated++;
      console.log(`    ➕ Created collaboration: ${card.title}`);
    }
  });
  
  localStorage.setItem('collaborations', JSON.stringify(existingCollaborations));
  console.log(`✅ Collaborations seeded: ${newCollabsCreated} new, ${existingCollaborations.length} total`);
  
  // Log sample of collaborations for debugging
  if (existingCollaborations.length > 0) {
    console.log('  📝 Sample collaboration:', {
      id: existingCollaborations[0].id,
      experienceName: existingCollaborations[0].experienceName,
      curatorId: existingCollaborations[0].curatorId,
      businessId: existingCollaborations[0].businessId
    });
  }
  
  // Seed chat messages for each collaboration
  COLLABORATION_CARDS.forEach(card => {
    const collaborationId = `collab_${card.id}`;
    const storageKey = `collaboration_chat_${collaborationId}`;
    
    // Check if messages already exist
    const existingMessages = localStorage.getItem(storageKey);
    
    if (!existingMessages) {
      const messages = COLLABORATION_CHAT_MESSAGES.filter(
        msg => msg.collaborationId === collaborationId
      );
      
      if (messages.length > 0) {
        // Convert messages to the format expected by MessagesPage
        const formattedMessages = messages.map(msg => ({
          id: msg.id,
          senderId: msg.senderId,
          senderName: msg.senderName,
          senderType: msg.senderType,
          content: msg.message,
          timestamp: msg.timestamp,
          read: msg.read,
          type: 'text' as const,
        }));
        
        localStorage.setItem(storageKey, JSON.stringify(formattedMessages));
        console.log(`✅ Chat messages seeded for ${card.title}`);
      }
    }
  });
  
  console.log('✅ Collaboration seed data initialized');
}

/**
 * Assign seed collaborations to the current logged-in user
 * This allows users to see demo chat data
 */
export function assignCollaborationsToCurrentUser(
  userId: string, 
  userRole: 'curator' | 'business',
  userName?: string
) {
  try {
    // First, ensure collaboration data is initialized
    let allCollaborations = JSON.parse(localStorage.getItem('collaborations') || '[]');
    
    // If no collaborations exist, initialize seed data first
    if (allCollaborations.length === 0) {
      console.log('⚠️  No collaborations found, initializing seed data...');
      initializeCollaborationSeedData();
      allCollaborations = JSON.parse(localStorage.getItem('collaborations') || '[]');
    }
    
    console.log('🔄 Assigning collaborations to user:', {
      userId,
      userRole,
      userName,
      totalCollaborations: allCollaborations.length
    });
    
    // Filter to find collaborations that should be assigned to this user
    // For curators: assign collaborations where curator IDs match the seed curator IDs
    // For businesses: assign collaborations where business IDs match the seed business IDs
    
    let assignedCount = 0;
    const updatedCollaborations = allCollaborations.map((collab: any) => {
      // Create a copy to avoid mutation
      const updatedCollab = { ...collab };
      
      if (userRole === 'curator') {
        // Assign ALL curator collaborations to the current curator
        // This includes both seed IDs (curator-XXX) and previously assigned IDs (emails)
        if (collab.curatorId && (
          collab.curatorId.startsWith('curator-') || 
          collab.curatorId.includes('@') // Was previously assigned to another user
        )) {
          updatedCollab.curatorId = userId;
          if (userName) {
            updatedCollab.curatorName = userName;
          }
          assignedCount++;
          console.log(`  ✓ Assigned curator collaboration: ${collab.experienceName}`);
        }
      } else if (userRole === 'business') {
        // Assign ALL business collaborations to the current business
        // This includes both seed IDs (business-XXX) and previously assigned IDs (emails)
        if (collab.businessId && (
          collab.businessId.startsWith('business-') ||
          collab.businessId.includes('@') // Was previously assigned to another user
        )) {
          updatedCollab.businessId = userId;
          if (userName) {
            updatedCollab.businessName = userName;
          }
          assignedCount++;
          console.log(`  ✓ Assigned business collaboration: ${collab.experienceName}`);
        }
      }
      
      return updatedCollab;
    });
    
    localStorage.setItem('collaborations', JSON.stringify(updatedCollaborations));
    
    // Also update the sender IDs in chat messages
    COLLABORATION_CARDS.forEach(card => {
      const collaborationId = `collab_${card.id}`;
      const storageKey = `collaboration_chat_${collaborationId}`;
      const existingMessages = localStorage.getItem(storageKey);
      
      if (existingMessages) {
        const messages = JSON.parse(existingMessages);
        const updatedMessages = messages.map((msg: any) => {
          const updatedMsg = { ...msg };
          
          if (userRole === 'curator' && msg.senderId && msg.senderId.startsWith('curator-')) {
            updatedMsg.senderId = userId;
            if (userName) {
              updatedMsg.senderName = userName;
            }
          } else if (userRole === 'business' && msg.senderId && msg.senderId.startsWith('business-')) {
            updatedMsg.senderId = userId;
            if (userName) {
              updatedMsg.senderName = userName;
            }
          }
          
          return updatedMsg;
        });
        
        localStorage.setItem(storageKey, JSON.stringify(updatedMessages));
      }
    });
    
    console.log(`✅ Assigned ${assignedCount} seed collaborations to ${userRole}: ${userId}`);
    
    // Trigger storage event so MessagesPage can reload
    window.dispatchEvent(new Event('storage'));
    
    return true;
  } catch (error) {
    console.error('Error assigning collaborations to user:', error);
    return false;
  }
}

/**
 * Clear all collaboration seed data (useful for testing)
 */
export function clearCollaborationSeedData() {
  // Remove collaboration cards
  const existingCards = JSON.parse(localStorage.getItem('platformCards') || '[]');
  const collaborationCardIds = COLLABORATION_CARDS.map(c => c.id);
  const filteredCards = existingCards.filter((c: any) => 
    !collaborationCardIds.includes(c.id)
  );
  localStorage.setItem('platformCards', JSON.stringify(filteredCards));
  
  // Remove chat messages
  COLLABORATION_CARDS.forEach(card => {
    const collaborationId = `collab_${card.id}`;
    const storageKey = `collaboration_chat_${collaborationId}`;
    localStorage.removeItem(storageKey);
  });
  
  console.log('✅ Collaboration seed data cleared');
}
