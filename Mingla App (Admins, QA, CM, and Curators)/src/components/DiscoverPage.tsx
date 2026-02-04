import React, { useState, useMemo, useRef } from 'react';
import {
  MapPin,
  Compass,
  Music,
  Plane,
  Eye,
  Coffee,
  Utensils,
  Monitor,
  Palette,
  Gamepad2,
  Dumbbell,
  CloudSun,
  TreePine,
  Sparkles,
  Star,
  Navigation,
  Clock,
  ChevronRight,
  ChevronLeft,
  Calendar,
  Users,
  Shirt,
  DollarSign,
  X,
  Share2,
  Heart,
  Ticket,
  PartyPopper,
  Wine,
  Mic2,
  Building2,
  ChevronDown,
  Filter,
  Wand2,
  Send,
  RefreshCw,
  MapPinned,
  Hotel,
  Utensils as Restaurant,
  Camera,
  ShieldCheck,
  Globe2,
  Palmtree,
  UserPlus,
  Plus
} from 'lucide-react';
import { Card } from './ui/card';
import { motion } from 'motion/react';
import SEED_EXPERIENCE_CARDS from './SeedExperienceCards';
import { CardDetails } from './swipeable-cards';
import { getIconComponent } from './swipeable-cards/utils';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { getCategoryDisplayName } from './utils/preferences';
import { curatedTrips, generateAITrips } from './trips-data';
import CustomExperienceForm from './CustomExperienceForm';
import AddCustomHolidayModal from './AddCustomHolidayModal';

interface DiscoverPageProps {
  onCardClick?: (card: any) => void;
  userPreferences?: any;
  onAddToCalendar?: (experienceData: any) => void;
  onShareCard?: (card: any) => void;
  onboardingData?: any;
}

interface Person {
  id: string;
  name: string;
  initials: string;
  birthday: string; // YYYY-MM-DD format
  gender: 'male' | 'female' | 'other';
}

type TabType = 'for-you' | 'night-out';

// Category suggestions for personalized experiences
const categorySuggestions: { [key: string]: string[] } = {
  stroll: [
    'Walk a "History of Us" route (first date spot)',
    'Visit a botanical garden',
    'Explore a Christmas tree trail during the holidays',
    'Scenic waterfront walk at sunset',
    'Historic neighborhood tour'
  ],
  sipChill: [
    'Rooftop sunset drinks',
    'A "flight" at a local craft brewery',
    'Cozy cat café for a quirky low-pressure afternoon',
    'Wine tasting at a local vineyard',
    'Jazz lounge evening'
  ],
  casualEats: [
    'Retro diner breakfast-for-dinner',
    'Food truck park hopping',
    'A "taco tour" where you rate three different spots',
    'Dim sum brunch adventure',
    'Local farmers market food crawl'
  ],
  screenRelax: [
    'Rent a private theater room',
    'Attend an "outdoor movie in the park"',
    'Comedy club for a "laughter is the best medicine" vibe',
    'Drive-in movie double feature',
    'Film festival screening'
  ],
  creative: [
    'Pottery throwing (the "Ghost" moment)',
    'A "paint your partner" night',
    'DIY flower-arranging workshop',
    'Cooking class together',
    'Photography walk and edit session'
  ],
  picnics: [
    '"Breakfast in Bed" picnic with croissants',
    'Sunset "grazing board" at a local waterfront',
    'Stargazing setup with blankets',
    'Beach sunrise picnic',
    'Park concert with picnic basket'
  ],
  playMove: [
    'Retro arcade battle',
    '"Glow-in-the-dark" mini golf',
    'Peaceful morning kayak/canoe session',
    'Rock climbing at an indoor gym',
    'Bike ride through scenic trails'
  ],
  diningExp: [
    'A 3-course "progressive dinner" (appetizers, mains, dessert at 3 different places)',
    "Chef's Table tasting menu",
    'Omakase sushi experience',
    'Fondue restaurant date',
    'Rooftop fine dining with city views'
  ],
  wellness: [
    'Side-by-side sound baths',
    'A "Halotherapy" salt cave session',
    'Sunset outdoor yoga class',
    'Couples massage and spa day',
    'Forest bathing meditation walk'
  ],
  freestyle: [
    'Seasonal pop-up bars (e.g., a "Speakeasy" or Christmas-themed bar)',
    'Local cultural festivals',
    'Haunted city ghost tour',
    'Escape room challenge',
    'Live music at an underground venue'
  ]
};

// Major 2026 holidays
const major2026Holidays = [
  { date: '2026-01-01', name: "New Year's Day", description: 'The "Fresh Start" date', category: 'wellness', forGender: 'all' },
  { date: '2026-02-14', name: "Valentine's Day", description: 'The biggest high-pressure day', category: 'diningExp', forGender: 'all' },
  { date: '2026-03-08', name: "International Women's Day", description: 'Celebrate the women in your life', category: 'diningExp', forGender: 'female' },
  { date: '2026-03-20', name: 'First Day of Spring', description: 'Great for "Take a Stroll" dates', category: 'stroll', forGender: 'all' },
  { date: '2026-05-10', name: "Mother's Day", description: 'Crucial if they have kids or to remind about partner\'s mom', category: 'casualEats', forGender: 'all' },
  { date: '2026-06-19', name: 'Juneteenth / Start of Summer', description: 'Summer celebration', category: 'freestyle', forGender: 'all' },
  { date: '2026-09-21', name: 'International Day of Peace', description: 'A "Relationship Reset" day', category: 'picnics', forGender: 'all' },
  { date: '2026-10-17', name: 'Sweetest Day', description: 'A popular "second Valentine\'s"', category: 'sipChill', forGender: 'all' },
  { date: '2026-10-31', name: 'Halloween', description: 'Perfect for "Freestyle" or horror movies', category: 'screenRelax', forGender: 'all' },
  { date: '2026-11-19', name: "International Men's Day", description: 'Celebrate the men in your life', category: 'playMove', forGender: 'male' },
  { date: '2026-11-26', name: 'Thanksgiving', description: 'Focus on "Gratitude"', category: 'playMove', forGender: 'all' },
  { date: '2026-12-24', name: 'Christmas Eve', description: 'High gift-giving expectation', category: 'creative', forGender: 'all' },
  { date: '2026-12-25', name: 'Christmas Day', description: 'Holiday celebration', category: 'freestyle', forGender: 'all' },
  { date: '2026-12-31', name: "New Year's Eve", description: 'The "Big Night Out"', category: 'diningExp', forGender: 'all' }
];

// Category definitions from PreferencesSheet
const categories = [
  { id: 'stroll', label: 'Take a Stroll', icon: Eye, description: 'Parks, trails, waterfronts' },
  { id: 'sipChill', label: 'Sip & Chill', icon: Coffee, description: 'Bars, cafés, wine bars, lounges' },
  { id: 'casualEats', label: 'Casual Eats', icon: Utensils, description: 'Casual restaurants, diners, food trucks' },
  { id: 'screenRelax', label: 'Screen & Relax', icon: Monitor, description: 'Movies, theaters, comedy shows' },
  { id: 'creative', label: 'Creative & Hands-On', icon: Palette, description: 'Classes, workshops, arts & crafts' },
  { id: 'picnics', label: 'Picnics', icon: CloudSun, description: 'Outdoor dining, scenic spots, park setups' },
  { id: 'playMove', label: 'Play & Move', icon: Dumbbell, description: 'Bowling, mini golf, sports, kayaking' },
  { id: 'diningExp', label: 'Dining Experiences', icon: Utensils, description: 'Upscale or chef-led restaurants' },
  { id: 'wellness', label: 'Wellness Dates', icon: TreePine, description: 'Yoga, spas, sound baths, healthy dining' },
  { id: 'freestyle', label: 'Freestyle', icon: Sparkles, description: 'Pop-ups, festivals, unique or quirky events' }
];

// Mock party data
const partyData = [
  {
    id: 'party-001',
    title: 'Rooftop Summer Soirée',
    type: 'Rooftop Party',
    host: 'Luna Events',
    date: 'Sat, Jan 18',
    time: '8:00 PM - 2:00 AM',
    attendees: 87,
    maxCapacity: 150,
    price: 25,
    priceRange: '$25',
    venue: 'Sky Lounge SF',
    address: '555 Mission St, San Francisco, CA 94105',
    distance: '1.2 km',
    travelTime: '15 min',
    description: 'Join us for an unforgettable evening under the stars with live DJ, craft cocktails, and stunning city views.',
    fullDescription: 'Experience the ultimate rooftop party featuring a renowned DJ set, premium open bar, and gourmet small bites. Network with San Francisco\'s creative professionals while enjoying panoramic views of the city skyline.',
    image: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800',
    images: [
      'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800',
      'https://images.unsplash.com/photo-1566737236500-c8ac43014a67?w=800',
      'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800'
    ],
    dressCode: 'Smart Casual',
    vibe: ['Upbeat', 'Social', 'Trendy'],
    includes: ['Open Bar (2 hrs)', 'DJ Entertainment', 'Small Bites', 'Rooftop Access'],
    ageGroup: '25-35',
    musicGenre: 'House / Electronic',
    matchScore: 92,
    rating: 4.7,
    reviewCount: 234
  },
  {
    id: 'party-002',
    title: 'Underground Jazz & Wine Night',
    type: 'Jazz Night',
    host: 'The Blue Note Collective',
    date: 'Fri, Jan 17',
    time: '7:00 PM - 11:00 PM',
    attendees: 42,
    maxCapacity: 80,
    price: 35,
    priceRange: '$35',
    venue: 'The Cellar Jazz Club',
    address: '685 Sutter St, San Francisco, CA 94102',
    distance: '2.8 km',
    travelTime: '20 min',
    description: 'Intimate jazz performance in a vintage speakeasy setting with curated wine pairings.',
    fullDescription: 'Step into the golden age of jazz at this exclusive underground venue. Enjoy live performances from Bay Area\'s finest jazz musicians while savoring hand-selected wines from Napa Valley.',
    image: 'https://images.unsplash.com/photo-1511192336575-5a79af67a629?w=800',
    images: [
      'https://images.unsplash.com/photo-1511192336575-5a79af67a629?w=800',
      'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800',
      'https://images.unsplash.com/photo-1486134736740-d0c3eac1a675?w=800'
    ],
    dressCode: 'Business Casual',
    vibe: ['Intimate', 'Classy', 'Relaxed'],
    includes: ['Live Jazz Band', 'Wine Tasting (3 wines)', 'Cheese Board', 'Reserved Seating'],
    ageGroup: '30-50',
    musicGenre: 'Jazz / Blues',
    matchScore: 88,
    rating: 4.9,
    reviewCount: 189
  },
  {
    id: 'party-003',
    title: '90s Throwback Dance Party',
    type: 'Themed Party',
    host: 'Nostalgia Nights',
    date: 'Sat, Jan 18',
    time: '9:00 PM - 3:00 AM',
    attendees: 156,
    maxCapacity: 200,
    price: 20,
    priceRange: '$20',
    venue: 'The Midway',
    address: '900 Marin St, San Francisco, CA 94124',
    distance: '4.5 km',
    travelTime: '25 min',
    description: 'Bring back the 90s with classic hits, retro vibes, and neon everything!',
    fullDescription: 'Travel back in time to the best decade ever! DJ spinning all your favorite 90s jams from pop to hip-hop. Dress in your best 90s outfit for a chance to win prizes. Full bar and themed cocktails available.',
    image: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800',
    images: [
      'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800',
      'https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?w=800',
      'https://images.unsplash.com/photo-1574391884720-bbc3740c59d1?w=800'
    ],
    dressCode: '90s Themed (Optional)',
    vibe: ['Energetic', 'Fun', 'Nostalgic'],
    includes: ['90s Music All Night', 'Photo Booth', 'Costume Contest', 'Themed Drinks'],
    ageGroup: '21-40',
    musicGenre: 'Hip-Hop / R&B',
    matchScore: 95,
    rating: 4.6,
    reviewCount: 412
  },
  {
    id: 'party-004',
    title: 'Cocktail Mixology Workshop',
    type: 'Interactive Event',
    host: 'SF Mixology Academy',
    date: 'Thu, Jan 16',
    time: '6:30 PM - 9:00 PM',
    attendees: 24,
    maxCapacity: 30,
    price: 65,
    priceRange: '$65',
    venue: 'Artisan Spirits Lounge',
    address: '1529 Fillmore St, San Francisco, CA 94115',
    distance: '3.2 km',
    travelTime: '18 min',
    description: 'Learn to craft signature cocktails from expert mixologists in an upscale lounge setting.',
    fullDescription: 'Master the art of mixology in this hands-on workshop. Create 4 classic cocktails while learning techniques from professional bartenders. All ingredients and tools provided, plus light appetizers.',
    image: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=800',
    images: [
      'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=800',
      'https://images.unsplash.com/photo-1560508381-54a97c4eac90?w=800',
      'https://images.unsplash.com/photo-1551024506-0bccd828d307?w=800'
    ],
    dressCode: 'Casual',
    vibe: ['Educational', 'Social', 'Sophisticated'],
    includes: ['Expert Instruction', '4 Cocktails', 'Recipe Cards', 'Light Appetizers'],
    ageGroup: '25-45',
    musicGenre: 'Lounge / Ambient',
    matchScore: 85,
    rating: 4.8,
    reviewCount: 156
  },
  {
    id: 'party-005',
    title: 'Warehouse Rave: Techno Edition',
    type: 'Rave',
    host: 'Underground Collective',
    date: 'Sat, Jan 25',
    time: '10:00 PM - 6:00 AM',
    attendees: 312,
    maxCapacity: 500,
    price: 40,
    priceRange: '$40',
    venue: 'Secret Location (TBA)',
    address: 'Location revealed 24hrs before',
    distance: '~5 km',
    travelTime: '30 min',
    description: 'Epic all-night techno experience featuring international DJs and immersive visuals.',
    fullDescription: 'The most anticipated underground event of the month. Multiple rooms, world-class sound system, stunning light shows, and international DJ lineup. This is not just a party - it\'s an experience.',
    image: 'https://images.unsplash.com/photo-1571266028243-d220c6b2e499?w=800',
    images: [
      'https://images.unsplash.com/photo-1571266028243-d220c6b2e499?w=800',
      'https://images.unsplash.com/photo-1566737236500-c8ac43014a67?w=800',
      'https://images.unsplash.com/photo-1563841930606-67e2bce48b78?w=800'
    ],
    dressCode: 'Rave Wear',
    vibe: ['High Energy', 'Immersive', 'Underground'],
    includes: ['Multiple DJ Sets', 'Visual Production', 'Multiple Rooms', 'Full Bar'],
    ageGroup: '21-35',
    musicGenre: 'Techno / Electronic',
    matchScore: 90,
    rating: 4.5,
    reviewCount: 567
  },
  {
    id: 'party-006',
    title: 'Wine & Paint Social',
    type: 'Creative Social',
    host: 'Brush & Sip Studios',
    date: 'Wed, Jan 22',
    time: '7:00 PM - 9:30 PM',
    attendees: 32,
    maxCapacity: 40,
    price: 45,
    priceRange: '$45',
    venue: 'Canvas & Cork',
    address: '1890 Bryant St, San Francisco, CA 94110',
    distance: '2.1 km',
    travelTime: '12 min',
    description: 'Unleash your creativity while enjoying wine and meeting new people in a relaxed studio setting.',
    fullDescription: 'No experience needed! Professional artist guides you through creating your own masterpiece. All materials included, plus 2 glasses of wine and light snacks. Take home your artwork!',
    image: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=800',
    images: [
      'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=800',
      'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=800',
      'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800'
    ],
    dressCode: 'Casual (wear paint-friendly clothes)',
    vibe: ['Creative', 'Relaxed', 'Social'],
    includes: ['Art Instruction', 'All Materials', '2 Glasses Wine', 'Light Snacks'],
    ageGroup: '25-50',
    musicGenre: 'Acoustic / Indie',
    matchScore: 82,
    rating: 4.7,
    reviewCount: 278
  },
  {
    id: 'party-007',
    title: 'Afrobeats Night: Lagos to SF',
    type: 'Cultural Dance Party',
    host: 'Afro Vibes Collective',
    date: 'Fri, Jan 24',
    time: '9:00 PM - 3:00 AM',
    attendees: 198,
    maxCapacity: 250,
    price: 30,
    priceRange: '$30',
    venue: 'The Grand Nightclub',
    address: '520 4th St, San Francisco, CA 94107',
    distance: '1.8 km',
    travelTime: '10 min',
    description: 'Celebrate African culture with the hottest Afrobeats hits, authentic cuisine, and vibrant energy!',
    fullDescription: 'The Bay Area\'s premier Afrobeats party featuring top DJs spinning hits from Burna Boy, Wizkid, Davido, and more. Enjoy authentic African cuisine, cultural performances, and an electric atmosphere. Dress to impress in your best African-inspired attire!',
    image: 'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800',
    images: [
      'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800',
      'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800',
      'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800'
    ],
    dressCode: 'Afrocentric / Stylish',
    vibe: ['Energetic', 'Cultural', 'Vibrant'],
    includes: ['Afrobeats DJs', 'African Cuisine', 'Cultural Performances', 'Full Bar'],
    ageGroup: '21-45',
    musicGenre: 'Afrobeats',
    matchScore: 96,
    rating: 4.9,
    reviewCount: 523
  },
  {
    id: 'party-008',
    title: 'Latin Nights: Salsa & Bachata',
    type: 'Dance Party',
    host: 'Ritmo Latino',
    date: 'Sat, Jan 19',
    time: '8:00 PM - 1:00 AM',
    attendees: 145,
    maxCapacity: 180,
    price: 25,
    priceRange: '$25',
    venue: 'El Barrio Lounge',
    address: '1234 Valencia St, San Francisco, CA 94110',
    distance: '3.5 km',
    travelTime: '22 min',
    description: 'Dance the night away to the best Latin rhythms with free dance lessons included!',
    fullDescription: 'Join us for an authentic Latin experience with live salsa and bachata music. Start with a beginner-friendly dance lesson at 8 PM, then dance all night. Latin cocktails and tapas available.',
    image: 'https://images.unsplash.com/photo-1504609813442-a8924e83f76e?w=800',
    images: [
      'https://images.unsplash.com/photo-1504609813442-a8924e83f76e?w=800',
      'https://images.unsplash.com/photo-1545128485-c400e7702796?w=800',
      'https://images.unsplash.com/photo-1534329539061-64caeb388c42?w=800'
    ],
    dressCode: 'Dance Attire',
    vibe: ['Passionate', 'Social', 'Lively'],
    includes: ['Free Dance Lesson', 'Live Band', 'Latin Cocktails', 'Tapas Menu'],
    ageGroup: '25-50',
    musicGenre: 'Latin / Salsa',
    matchScore: 89,
    rating: 4.8,
    reviewCount: 367
  },
  {
    id: 'party-009',
    title: 'K-Pop Dance Night',
    type: 'Themed Party',
    host: 'Seoul Vibes SF',
    date: 'Thu, Jan 23',
    time: '8:00 PM - 12:00 AM',
    attendees: 67,
    maxCapacity: 100,
    price: 20,
    priceRange: '$20',
    venue: 'Asia SF',
    address: '201 9th St, San Francisco, CA 94103',
    distance: '2.3 km',
    travelTime: '15 min',
    description: 'K-Pop hits all night long with BTS, BLACKPINK, Stray Kids, and your favorite Korean artists!',
    fullDescription: 'Calling all K-Pop stans! Dance to the latest K-Pop hits, enjoy Korean snacks and drinks, and participate in random dance play. Come dressed as your bias for special prizes!',
    image: 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=800',
    images: [
      'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=800',
      'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800',
      'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800'
    ],
    dressCode: 'Casual / K-Fashion',
    vibe: ['Fun', 'Trendy', 'Fan Culture'],
    includes: ['K-Pop Music', 'Korean Snacks', 'Random Dance Play', 'Costume Contest'],
    ageGroup: '18-30',
    musicGenre: 'K-Pop',
    matchScore: 91,
    rating: 4.7,
    reviewCount: 215
  },
  {
    id: 'party-010',
    title: 'Reggae Sunset Session',
    type: 'Outdoor Party',
    host: 'Island Vibes Collective',
    date: 'Sun, Jan 20',
    time: '4:00 PM - 10:00 PM',
    attendees: 89,
    maxCapacity: 120,
    price: 35,
    priceRange: '$35',
    venue: 'Pier 70 Rooftop',
    address: 'Pier 70, San Francisco, CA 94158',
    distance: '4.2 km',
    travelTime: '28 min',
    description: 'Sunset vibes with classic reggae, Caribbean food, and ocean breeze.',
    fullDescription: 'Unwind with smooth reggae rhythms as the sun sets over the bay. Featuring live reggae band, Caribbean BBQ, tropical cocktails, and good vibes only. BYOB friendly.',
    image: 'https://images.unsplash.com/photo-1506157786151-b8491531f063?w=800',
    images: [
      'https://images.unsplash.com/photo-1506157786151-b8491531f063?w=800',
      'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800',
      'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=800'
    ],
    dressCode: 'Island Casual',
    vibe: ['Chill', 'Positive', 'Laid-back'],
    includes: ['Live Reggae Band', 'Caribbean BBQ', 'Tropical Cocktails', 'Sunset Views'],
    ageGroup: '25-55',
    musicGenre: 'Reggae',
    matchScore: 87,
    rating: 4.8,
    reviewCount: 198
  }
];

// Music genres for filtering
const musicGenres = [
  'All Genres',
  'Afrobeats',
  'Hip-Hop / R&B',
  'House / Electronic',
  'Techno / Electronic',
  'Jazz / Blues',
  'Latin / Salsa',
  'Reggae',
  'K-Pop',
  'Lounge / Ambient',
  'Acoustic / Indie'
];

// Trip vibe options
const tripVibeOptions = [
  'Cultural',
  'Adventurous',
  'Relaxing',
  'Luxurious',
  'Beachside',
  'Urban',
  'Nature',
  'Spiritual',
  'Foodie',
  'Nightlife',
  'Historical',
  'Romantic'
];

// Experience card component for horizontal scroll
const ExperienceCard = ({ 
  experience, 
  onClick,
  className = ""
}: { 
  experience: any; 
  onClick: () => void; 
  className?: string;
}) => {
  const CategoryIcon = getIconComponent(experience.categoryIcon);

  return (
    <motion.div
      className={`flex-shrink-0 w-[calc(100vw-48px)] max-w-md cursor-pointer ${className}`}
      onClick={onClick}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01, y: -2 }}
      whileTap={{ scale: 0.99 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
    >
      <div className="glass-card rounded-3xl card-elevated overflow-hidden h-full flex flex-col shadow-2xl">
        {/* Image */}
        <div className="relative h-[65%] bg-gray-100 overflow-hidden">
          <ImageWithFallback
            src={experience.image}
            alt={experience.title}
            className="w-full h-full object-cover"
          />
          
          {/* Gradient Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />
          
          {/* Match Score Badge */}
          <div className="absolute top-4 left-4 z-10">
            <div className="glass-badge rounded-full flex items-center gap-1.5 shadow-xl hover:scale-105 transition-smooth px-3 py-1.5">
              <Star className="w-4 h-4 text-[#eb7825] fill-[#eb7825]" />
              <span className="text-sm font-bold text-gray-900">{experience.matchScore}% Match</span>
            </div>
          </div>

          {/* Bottom Info on Image */}
          <div className="absolute bottom-4 left-4 right-4 text-white z-10">
            <h3 className="text-2xl font-bold mb-3 drop-shadow-lg leading-tight">{experience.title}</h3>
            <div className="flex items-center gap-2 text-sm flex-nowrap">
              <div className="flex items-center gap-1 glass-badge-dark rounded-full px-2.5 py-1.5 whitespace-nowrap">
                <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="font-medium text-xs">{experience.distance}</span>
              </div>
              <div className="flex items-center gap-1 glass-badge-dark rounded-full px-2.5 py-1.5 whitespace-nowrap">
                <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="font-medium text-xs">{experience.travelTime}</span>
              </div>
              <div className="flex items-center gap-1 glass-badge-dark rounded-full px-2.5 py-1.5 whitespace-nowrap">
                <Star className="w-3.5 h-3.5 fill-white flex-shrink-0" />
                <span className="font-medium text-xs">{experience.rating}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="p-5 h-[35%] flex flex-col justify-between">
          {/* Category & Description */}
          <div className="flex-1 flex flex-col gap-2.5">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-gradient-to-br from-orange-100 to-orange-50 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0">
                <CategoryIcon className="w-4.5 h-4.5 text-[#eb7825]" />
              </div>
              <span className="text-sm text-gray-700 font-semibold">{getCategoryDisplayName(experience.category)}</span>
            </div>
            
            <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed">
              {experience.description}
            </p>
          </div>

          {/* Price */}
          <div className="flex items-center justify-between pt-3 border-t border-gray-100 mt-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs text-gray-500">From</span>
              <span className="text-xl font-bold text-[#eb7825]">{experience.priceRange}</span>
            </div>
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center shadow-lg hover:shadow-xl transition-smooth hover:scale-105">
              <ChevronRight className="w-5 h-5 text-white" />
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

// Compact card component for two-column feed
const CompactExperienceCard = ({ 
  experience, 
  onClick 
}: { 
  experience: any; 
  onClick: () => void; 
}) => {
  const CategoryIcon = getIconComponent(experience.categoryIcon);

  return (
    <motion.div
      onClick={onClick}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className="cursor-pointer"
    >
      <div className="glass-card rounded-2xl card-elevated overflow-hidden shadow-lg">
        {/* Image */}
        <div className="relative h-40 bg-gray-100 overflow-hidden">
          <ImageWithFallback
            src={experience.image}
            alt={experience.title}
            className="w-full h-full object-cover"
          />
          
          {/* Gradient Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />

          {/* Category Icon */}
          <div className="absolute bottom-2 left-2 z-10">
            <div className="w-7 h-7 bg-white/90 backdrop-blur-sm rounded-lg flex items-center justify-center shadow-md">
              <CategoryIcon className="w-4 h-4 text-[#eb7825]" />
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="p-3">
          <h3 className="font-bold text-gray-900 text-sm mb-1 line-clamp-1">{experience.title}</h3>
          
          <div className="text-xs text-gray-600 mb-2">
            {getCategoryDisplayName(experience.category)}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-[#eb7825]">{experience.priceRange}</span>
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center shadow-md">
              <ChevronRight className="w-3.5 h-3.5 text-white" />
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

// Hero card component for For You page
const HeroExperienceCard = ({ 
  experience, 
  onClick 
}: { 
  experience: any; 
  onClick: () => void; 
}) => {
  const CategoryIcon = getIconComponent(experience.categoryIcon);

  return (
    <motion.div
      onClick={onClick}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className="cursor-pointer"
    >
      <div className="glass-card rounded-3xl card-elevated overflow-hidden shadow-2xl">
        {/* Image */}
        <div className="relative h-80 bg-gray-100 overflow-hidden">
          <ImageWithFallback
            src={experience.image}
            alt={experience.title}
            className="w-full h-full object-cover"
          />
          
          {/* Gradient Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
          
          {/* Featured Badge */}
          <div className="absolute top-4 right-4 z-10">
            <div className="bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white rounded-full px-4 py-2 shadow-xl">
              <span className="text-sm font-bold">Featured</span>
            </div>
          </div>

          {/* Bottom Info on Image */}
          <div className="absolute bottom-4 left-4 right-4 text-white z-10">
            <div className="flex items-center gap-3 text-sm">
              <div className="flex items-center gap-1.5 glass-badge-dark rounded-full px-3 py-2">
                <MapPin className="w-4 h-4" />
                <span className="font-medium">{experience.distance}</span>
              </div>
              <div className="flex items-center gap-1.5 glass-badge-dark rounded-full px-3 py-2">
                <Clock className="w-4 h-4" />
                <span className="font-medium">{experience.travelTime}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="p-6">
          <div className="space-y-4">
            {/* Name */}
            <h3 className="text-2xl font-bold text-gray-900">{experience.title}</h3>
            
            {/* Category */}
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 bg-gradient-to-br from-orange-100 to-orange-50 rounded-xl flex items-center justify-center shadow-sm">
                <CategoryIcon className="w-5 h-5 text-[#eb7825]" />
              </div>
              <span className="text-sm text-gray-700 font-semibold">{getCategoryDisplayName(experience.category)}</span>
            </div>
            
            {/* Description */}
            <p className="text-sm text-gray-600 leading-relaxed line-clamp-2">
              {experience.description}
            </p>
            
            {/* Price and Review */}
            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-[#eb7825]">{experience.priceRange}</span>
              </div>
              <div className="flex items-center gap-1.5 bg-gray-50 rounded-full px-3 py-1.5">
                <Star className="w-4 h-4 fill-[#eb7825] text-[#eb7825]" />
                <span className="text-sm font-semibold text-gray-900">{experience.rating}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

// Trip card component
const TripCard = ({ 
  trip, 
  onClick 
}: { 
  trip: any; 
  onClick: () => void; 
}) => {
  return (
    <motion.div
      className="flex-shrink-0 w-80 cursor-pointer"
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="bg-white rounded-2xl shadow-md overflow-hidden h-full flex flex-col border border-gray-100">
        {/* Image */}
        <div className="relative h-56 bg-gray-100 overflow-hidden">
          <ImageWithFallback
            src={trip.image}
            alt={trip.title}
            className="w-full h-full object-cover"
          />
          
          {/* Gradient Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
          
          {/* Top badges */}
          <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2">
            <div className="bg-white/90 backdrop-blur-sm px-2.5 py-1 rounded-full flex items-center gap-1 shadow-md">
              <Star className="w-3.5 h-3.5 text-[#eb7825] fill-[#eb7825]" />
              <span className="text-sm font-semibold text-gray-900">{trip.matchScore}% Match</span>
            </div>
            {trip.isAIGenerated && (
              <div className="bg-purple-500 text-white px-2.5 py-1 rounded-full shadow-md flex items-center gap-1">
                <Wand2 className="w-3.5 h-3.5" />
                <span className="text-sm font-semibold">AI</span>
              </div>
            )}
          </div>

          {/* Bottom Info on Image */}
          <div className="absolute bottom-3 left-3 right-3 text-white">
            <h3 className="text-xl font-bold mb-2 drop-shadow-lg">{trip.title}</h3>
            <div className="flex items-center gap-2 text-sm">
              <div className="flex items-center gap-1">
                <MapPinned className="w-4 h-4" />
                <span>{trip.destination}</span>
              </div>
              <span>•</span>
              <div className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                <span>{trip.duration}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="p-4 flex-1 flex flex-col">
          {/* Description */}
          <p className="text-sm text-gray-700 line-clamp-2 mb-3">
            {trip.description}
          </p>

          {/* Vibe tags */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {trip.vibe.slice(0, 3).map((tag: string, index: number) => (
              <span 
                key={index}
                className="text-xs bg-orange-50 text-[#eb7825] px-2 py-1 rounded-full border border-orange-200"
              >
                {tag}
              </span>
            ))}
          </div>

          {/* Footer */}
          <div className="mt-auto pt-3 border-t border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="text-lg font-bold text-gray-900">{trip.priceRange}</div>
              <div className="text-xs text-gray-500">per person</div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400" />
          </div>
        </div>
      </div>
    </motion.div>
  );
};

// Party card component for grid layout
const PartyCard = ({ 
  party, 
  onClick 
}: { 
  party: any; 
  onClick: () => void; 
}) => {
  const attendancePercentage = (party.attendees / party.maxCapacity) * 100;

  return (
    <motion.div
      className="cursor-pointer"
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="bg-white rounded-2xl shadow-md overflow-hidden h-full flex flex-col border border-gray-100">
        {/* Image */}
        <div className="relative h-56 bg-gray-100 overflow-hidden">
          <ImageWithFallback
            src={party.image}
            alt={party.title}
            className="w-full h-full object-cover"
          />
          
          {/* Gradient Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
          
          {/* Top badges */}
          <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2">
            <div className="bg-white/90 backdrop-blur-sm px-2.5 py-1 rounded-full flex items-center gap-1 shadow-md">
              <Star className="w-3.5 h-3.5 text-[#eb7825] fill-[#eb7825]" />
              <span className="text-sm font-semibold text-gray-900">{party.matchScore}% Match</span>
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="p-4 flex-1 flex flex-col">
          {/* Type and Host */}
          <div className="flex items-center gap-2 mb-2">
            <Music className="w-4 h-4 text-[#eb7825]" />
            <span className="text-sm font-medium text-gray-900">{party.type}</span>
            <span className="text-gray-400">•</span>
            <span className="text-sm text-gray-600">by {party.host}</span>
          </div>

          {/* Vibe tags */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {party.vibe.slice(0, 3).map((tag: string, index: number) => (
              <span 
                key={index}
                className="text-xs bg-orange-50 text-[#eb7825] px-2 py-1 rounded-full border border-orange-200"
              >
                {tag}
              </span>
            ))}
          </div>

          {/* Footer */}
          <div className="mt-auto pt-3 border-t border-gray-100 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-1 text-gray-600">
                <Calendar className="w-4 h-4 text-[#eb7825]" />
                <span>{party.date}</span>
              </div>
              <div className="flex items-center gap-1 text-gray-600">
                <Clock className="w-4 h-4 text-[#eb7825]" />
                <span>{party.time}</span>
              </div>
            </div>
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-1 text-gray-600">
                <Users className="w-4 h-4 text-[#eb7825]" />
                <span className="font-medium">{party.attendees} going</span>
              </div>
              <div className="flex items-center gap-1">
                {party.price === 0 ? (
                  <span className="font-semibold text-[#eb7825]">Free</span>
                ) : (
                  <>
                    <DollarSign className="w-4 h-4 text-[#eb7825]" />
                    <span className="font-semibold text-gray-900">{party.price}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

// Party Details Modal Component
const PartyDetails = ({
  party,
  galleryIndex,
  onClose,
  onNavigateGallery,
  onRSVP,
  onShare
}: {
  party: any;
  galleryIndex: number;
  onClose: () => void;
  onNavigateGallery: (direction: 'prev' | 'next') => void;
  onRSVP: () => void;
  onShare: () => void;
}) => {
  const attendancePercentage = (party.attendees / party.maxCapacity) * 100;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 flex items-center justify-center p-4">
      <motion.div 
        className="absolute top-4 left-4 right-4 bottom-24 bg-white rounded-3xl shadow-2xl border border-gray-100 flex flex-col overflow-hidden"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
      >
        {/* Header with close button */}
        <div className="relative p-4 border-b border-gray-100 flex-shrink-0">
          <button
            onClick={onClose}
            className="absolute left-4 top-4 w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors z-10"
          >
            <X className="w-4 h-4 text-gray-600" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Image gallery */}
          <div className="relative h-80 bg-gray-900">
            <ImageWithFallback
              src={party.images[galleryIndex]}
              alt={party.title}
              className="w-full h-full object-cover"
            />
            
            {/* Gallery navigation */}
            {party.images.length > 1 && (
              <>
                <button
                  onClick={() => onNavigateGallery('prev')}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 hover:bg-white rounded-full flex items-center justify-center shadow-lg transition-colors"
                >
                  <ChevronRight className="w-5 h-5 rotate-180" />
                </button>
                <button
                  onClick={() => onNavigateGallery('next')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 hover:bg-white rounded-full flex items-center justify-center shadow-lg transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {party.images.map((_: any, idx: number) => (
                    <div
                      key={idx}
                      className={`w-2 h-2 rounded-full transition-all ${
                        idx === galleryIndex ? 'bg-white w-6' : 'bg-white/50'
                      }`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Detailed content */}
          <div className="p-4 space-y-4">
            {/* Title and type */}
            <div>
              <h2 className="font-bold text-2xl text-gray-900 mb-2">{party.title}</h2>
              <div className="flex items-center gap-2 mb-3">
                <Music className="w-5 h-5 text-[#eb7825]" />
                <span className="font-medium text-[#eb7825]">{party.type}</span>
                <span className="text-gray-400">•</span>
                <span className="text-gray-600">Hosted by {party.host}</span>
              </div>
            </div>

            {/* Key info cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Calendar className="w-4 h-4 text-[#eb7825]" />
                  <span className="text-xs font-medium text-gray-600">Date & Time</span>
                </div>
                <p className="text-sm font-semibold text-gray-900">{party.date}</p>
                <p className="text-xs text-gray-600">{party.time}</p>
              </div>
              
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-4 h-4 text-[#eb7825]" />
                  <span className="text-xs font-medium text-gray-600">Entry Fee</span>
                </div>
                <p className="text-lg font-bold text-gray-900">${party.price}</p>
                <p className="text-xs text-gray-600">per person</p>
              </div>
              
            </div>

            {/* Attendance */}
            <div className="bg-white border-2 border-orange-200 rounded-xl p-4">
              <div className="flex items-center justify-center gap-2">
                <Users className="w-5 h-5 text-[#eb7825]" />
                <span className="text-lg font-semibold text-gray-900">{party.attendees} going</span>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <h3 className="font-semibold text-gray-900">About This Event</h3>
              <p className="text-gray-700 leading-relaxed">
                {party.fullDescription}
              </p>
            </div>

            {/* Vibe */}
            <div className="space-y-2">
              <h3 className="font-semibold text-gray-900">Vibe</h3>
              <div className="flex flex-wrap gap-2">
                {party.vibe.map((tag: string, idx: number) => (
                  <span 
                    key={idx}
                    className="bg-orange-50 text-[#eb7825] px-3 py-1.5 rounded-full border border-orange-200 text-sm"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Additional info */}
            <div className="grid grid-cols-1 gap-4 p-4 bg-gray-50 rounded-xl">
              <div>
                <p className="text-xs text-gray-600 mb-1">Music Genre</p>
                <p className="text-sm font-medium text-gray-900">{party.musicGenre}</p>
              </div>
            </div>

            {/* Venue Address */}
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <Building2 className="w-5 h-5 text-[#eb7825] mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold text-gray-900 mb-1">{party.venue}</p>
                  <p className="text-sm text-gray-600 mb-2">{party.address}</p>
                  <button className="text-sm text-[#eb7825] font-medium hover:underline flex items-center gap-1">
                    <Navigation className="w-4 h-4" />
                    Get Directions
                  </button>
                </div>
              </div>
            </div>

          </div>

          {/* Action buttons */}
          <div className="p-4 pt-0 space-y-3">
            <div className="flex gap-3">
              <button 
                onClick={onRSVP}
                className="flex-1 bg-[#eb7825] text-white py-4 px-6 rounded-xl font-semibold hover:bg-[#d6691f] transition-colors flex items-center justify-center gap-2"
              >
                <Ticket className="w-5 h-5" />
                Get Tickets - ${party.price}
              </button>

              <button 
                onClick={onShare}
                className="w-12 h-12 border-2 border-gray-200 hover:border-[#eb7825] hover:bg-orange-50 rounded-xl transition-all duration-200 flex items-center justify-center group self-center"
              >
                <Share2 className="w-5 h-5 text-gray-600 group-hover:text-[#eb7825] transition-all" />
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default function DiscoverPage({ 
  onCardClick, 
  userPreferences,
  onAddToCalendar,
  onShareCard,
  onboardingData
}: DiscoverPageProps) {
  const [activeTab, setActiveTab] = useState<TabType>('for-you');
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [galleryIndices, setGalleryIndices] = useState<{ [key: string]: number }>({});
  const [selectedGenre, setSelectedGenre] = useState<string>('All Genres');
  const [isGenreDropdownOpen, setIsGenreDropdownOpen] = useState(false);
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [expandedHoliday, setExpandedHoliday] = useState<string | null>(null);
  const scrollRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  
  // People filter state
  const [people, setPeople] = useState<Person[]>(() => {
    const saved = localStorage.getItem('mingla_saved_people');
    return saved ? JSON.parse(saved) : [];
  });
  const [selectedPersonId, setSelectedPersonId] = useState<string>('for-you');
  const [showAddPersonModal, setShowAddPersonModal] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonBirthday, setNewPersonBirthday] = useState('');
  const [newPersonGender, setNewPersonGender] = useState<'male' | 'female' | 'other'>('other');
  
  // Custom holidays state
  const [customHolidays, setCustomHolidays] = useState<any[]>(() => {
    const saved = localStorage.getItem('mingla_custom_holidays');
    return saved ? JSON.parse(saved) : [];
  });
  const [showAddHolidayModal, setShowAddHolidayModal] = useState(false);
  
  // Filter states
  const [selectedDate, setSelectedDate] = useState<string>('Any Date');
  const [selectedPrice, setSelectedPrice] = useState<string>('Any Price');
  
  // Custom Experience state
  const [experienceType, setExperienceType] = useState<string>('');
  const [experiencePrompt, setExperiencePrompt] = useState('');
  const [experienceVibes, setExperienceVibes] = useState<string[]>([]);
  const [experienceBudget, setExperienceBudget] = useState<number | ''>('');
  const [experienceDuration, setExperienceDuration] = useState<string>('');
  const [generatedExperiences, setGeneratedExperiences] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showExperiencePlanner, setShowExperiencePlanner] = useState(true);

  // Refs for scrollable containers
  const scrollContainerRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  // Save people to localStorage whenever it changes
  React.useEffect(() => {
    localStorage.setItem('mingla_saved_people', JSON.stringify(people));
  }, [people]);

  // Save custom holidays to localStorage whenever it changes
  React.useEffect(() => {
    localStorage.setItem('mingla_custom_holidays', JSON.stringify(customHolidays));
  }, [customHolidays]);

  const handleAddCustomHoliday = (holiday: any) => {
    setCustomHolidays([...customHolidays, holiday]);
  };

  const getInitials = (name: string): string => {
    const parts = name.trim().split(' ');
    if (parts.length === 1) {
      return parts[0].substring(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const handleAddPerson = () => {
    if (newPersonName.trim() && newPersonBirthday) {
      const newPerson: Person = {
        id: `person-${Date.now()}`,
        name: newPersonName.trim(),
        initials: getInitials(newPersonName.trim()),
        birthday: newPersonBirthday,
        gender: newPersonGender
      };
      setPeople([...people, newPerson]);
      setNewPersonName('');
      setNewPersonBirthday('');
      setNewPersonGender('other');
      setShowAddPersonModal(false);
    }
  };

  const handleRemovePerson = (personId: string) => {
    setPeople(people.filter(p => p.id !== personId));
    if (selectedPersonId === personId) {
      setSelectedPersonId('for-you');
    }
  };

  // Get upcoming holidays (next 90 days) based on person's gender
  const getUpcomingHolidays = (gender: 'male' | 'female' | 'other') => {
    const today = new Date('2026-02-01'); // Current date in the app

    // Combine major holidays with custom holidays
    const allHolidays = [
      ...major2026Holidays,
      ...customHolidays.map(custom => ({
        date: custom.date,
        name: custom.name,
        description: custom.description,
        category: custom.category,
        forGender: 'all' as const, // Custom holidays are for everyone
        isCustom: true
      }))
    ];

    return allHolidays
      .filter(holiday => {
        // Include holidays that are for all genders, or match the person's gender
        // If gender is 'other', include both male and female specific holidays
        if (holiday.forGender === 'all') return true;
        if (gender === 'other') return true; // Show all holidays for 'other' gender
        return holiday.forGender === gender;
      })
      .map(holiday => ({
        ...holiday,
        dateObj: new Date(holiday.date)
      }))
      .filter(holiday => holiday.dateObj >= today)
      .sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime()); // Show all upcoming holidays
  };

  // Calculate days until a date
  const daysUntil = (dateString: string) => {
    const today = new Date('2026-02-01');
    const target = new Date(dateString);
    const diffTime = target.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  // Get birthday info for a person
  const getBirthdayInfo = (person: Person) => {
    const today = new Date('2026-02-01');
    const birthday = new Date(person.birthday);
    const thisYearBirthday = new Date(today.getFullYear(), birthday.getMonth(), birthday.getDate());
    
    if (thisYearBirthday < today) {
      thisYearBirthday.setFullYear(today.getFullYear() + 1);
    }

    const days = daysUntil(thisYearBirthday.toISOString().split('T')[0]);
    const age = thisYearBirthday.getFullYear() - birthday.getFullYear();

    return { days, age, date: thisYearBirthday };
  };

  // Scroll handler for navigation arrows
  const handleScroll = (categoryId: string, direction: 'left' | 'right') => {
    const container = scrollContainerRefs.current[categoryId];
    if (!container) return;

    const scrollAmount = 300; // Scroll by 300px
    const targetScroll = direction === 'left' 
      ? container.scrollLeft - scrollAmount 
      : container.scrollLeft + scrollAmount;

    container.scrollTo({
      left: targetScroll,
      behavior: 'smooth'
    });
  };

  // Convert seed cards to recommendations format
  const allExperiences = useMemo(() => {
    return SEED_EXPERIENCE_CARDS.map(seed => ({
      ...seed,
      categoryIcon: getIconComponent(seed.categoryIcon),
      timeAway: seed.travelTime,
      budget: seed.budget || 'See pricing details'
    }));
  }, []);

  // Group experiences by category
  const experiencesByCategory = useMemo(() => {
    const grouped: { [key: string]: any[] } = {};
    
    categories.forEach(category => {
      // Normalize category ID for matching
      const normalizedCategoryId = category.id.toLowerCase().replace(/[^a-z]/g, '');
      
      grouped[category.id] = allExperiences.filter(exp => {
        const normalizedExpCategory = exp.category.toLowerCase().replace(/[^a-z]/g, '');
        return normalizedExpCategory === normalizedCategoryId;
      });
    });

    return grouped;
  }, [allExperiences]);

  // Filter categories to only show those with experiences
  const categoriesWithExperiences = useMemo(() => {
    return categories.filter(category => 
      experiencesByCategory[category.id] && experiencesByCategory[category.id].length > 0
    );
  }, [experiencesByCategory]);

  // Mixed experiences for Near You tab - combining all categories
  const mixedNearYouExperiences = useMemo(() => {
    // Shuffle all experiences to create a mixed array
    const shuffled = [...allExperiences].sort(() => Math.random() - 0.5);
    return shuffled;
  }, [allExperiences]);

  // Hero card and feed for For You page
  const forYouHeroCard = useMemo(() => {
    return allExperiences[0]; // First card as hero
  }, [allExperiences]);

  const forYouFeedCards = useMemo(() => {
    // Get one card from each category for the feed
    const feedCards: any[] = [];
    categories.forEach(category => {
      const categoryCards = experiencesByCategory[category.id];
      if (categoryCards && categoryCards.length > 0) {
        feedCards.push(categoryCards[0]);
      }
    });
    return feedCards;
  }, [experiencesByCategory]);

  // Filter parties by music genre and other filters
  const filteredParties = useMemo(() => {
    let filtered = [...partyData];
    
    // Genre filter
    if (selectedGenre !== 'All Genres') {
      filtered = filtered.filter(party => party.musicGenre === selectedGenre);
    }
    
    // Date filter
    if (selectedDate !== 'Any Date') {
      filtered = filtered.filter(party => party.date === selectedDate);
    }
    
    // Price filter
    if (selectedPrice !== 'Any Price') {
      filtered = filtered.filter(party => {
        const price = parseInt(party.price.replace(/[^0-9]/g, ''));
        if (selectedPrice === 'Free') return price === 0;
        if (selectedPrice === 'Under $25') return price < 25;
        if (selectedPrice === '$25-$50') return price >= 25 && price <= 50;
        if (selectedPrice === '$50-$100') return price > 50 && price <= 100;
        if (selectedPrice === 'Over $100') return price > 100;
        return true;
      });
    }
    
    return filtered;
  }, [selectedGenre, selectedDate, selectedPrice]);

  const handleCardClick = (experience: any) => {
    setExpandedCard(experience.id);
    // Don't trigger onCardClick when expanding - only expand the card
  };

  const navigateGallery = (direction: 'prev' | 'next', rec: any) => {
    const currentIndex = galleryIndices[rec.id] || 0;
    const newIndex = direction === 'next'
      ? (currentIndex + 1) % rec.images.length
      : (currentIndex - 1 + rec.images.length) % rec.images.length;
    
    setGalleryIndices(prev => ({ ...prev, [rec.id]: newIndex }));
  };

  const setGalleryIndex = (recId: string, index: number) => {
    setGalleryIndices(prev => ({ ...prev, [recId]: index }));
  };

  const handleSchedule = (experience: any) => {
    if (onAddToCalendar) {
      const scheduleData = { ...experience, _directSchedule: true };
      onAddToCalendar(scheduleData);
    }
    setExpandedCard(null);
  };

  const handleShare = (experience: any) => {
    if (onShareCard) {
      onShareCard(experience);
    }
    setExpandedCard(null);
  };

  // Custom Experience handlers
  const toggleExperienceVibe = (vibe: string) => {
    setExperienceVibes(prev => 
      prev.includes(vibe) 
        ? prev.filter(v => v !== vibe)
        : [...prev, vibe]
    );
  };

  const handleGenerateExperience = () => {
    if (!experiencePrompt.trim()) return;
    
    setIsGenerating(true);
    
    // Simulate AI generation delay
    setTimeout(() => {
      const generated = generateAITrips(
        experiencePrompt,
        experienceVibes,
        typeof experienceBudget === 'number' ? experienceBudget : undefined,
        experienceDuration
      );
      setGeneratedExperiences(generated);
      setIsGenerating(false);
      setShowExperiencePlanner(false); // Hide planner after generating
    }, 1500);
  };

  const handlePlanAnotherExperience = () => {
    setShowExperiencePlanner(true);
    setGeneratedExperiences([]);
    setExperienceType('');
    setExperiencePrompt('');
    setExperienceVibes([]);
    setExperienceBudget('');
    setExperienceDuration('');
  };

  const handleSaveTrip = (trip: any) => {
    // This will save to the Activities page saved tab
    console.log('Saving trip:', trip);
    // TODO: Implement actual save to activities
    alert('Trip saved! Find it in your Activities > Saved tab');
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="max-w-7xl mx-auto">
        
        {/* Tab Navigation */}
        <div className="sticky top-0 z-20 glass-nav shadow-sm">
          <div className="flex items-center">
            <button
              onClick={() => setActiveTab('for-you')}
              data-coachmark="discover-for-you-tab"
              className={`flex-1 py-4 px-4 text-center font-medium transition-smooth relative ${
                activeTab === 'for-you'
                  ? 'text-[#eb7825]'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <MapPin className="w-5 h-5 mx-auto mb-1 transition-transform duration-300 hover:scale-110" />
              <span className="text-sm">For You</span>
              {activeTab === 'for-you' && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#eb7825]"
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              )}
            </button>
            <button
              onClick={() => setActiveTab('night-out')}
              data-coachmark="night-out-tab"
              className={`flex-1 py-4 px-4 text-center font-medium transition-smooth relative ${
                activeTab === 'night-out'
                  ? 'text-[#eb7825]'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Music className="w-5 h-5 mx-auto mb-1 transition-transform duration-300 hover:scale-110" />
              <span className="text-sm">Night-Out</span>
              {activeTab === 'night-out' && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#eb7825]"
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              )}
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="pb-6">
          {activeTab === 'for-you' && (
            <motion.div 
              className="pt-4 pb-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
            >
              {/* People Filter Section */}
              <div className="px-4 pb-4 border-b border-gray-200/50">
                <div className="flex items-center gap-3 overflow-x-auto scrollbar-hide py-2 px-3 bg-gradient-to-r from-orange-50/40 via-white/60 to-orange-50/40 backdrop-blur-sm rounded-2xl border border-white/50 shadow-[0_2px_16px_rgba(235,120,37,0.08)]">
                  {/* For You Pill */}
                  <button
                    onClick={() => setSelectedPersonId('for-you')}
                    className={`flex-shrink-0 transition-all duration-300 backdrop-blur-xl ${
                      selectedPersonId === 'for-you'
                        ? 'bg-gradient-to-br from-[#eb7825] to-[#d6691f] text-white shadow-[0_8px_32px_rgba(235,120,37,0.3)]'
                        : 'bg-white/80 text-gray-700 hover:bg-white/90 shadow-[0_4px_16px_rgba(0,0,0,0.06)]'
                    } px-5 py-2.5 rounded-full font-semibold text-sm border border-white/20 hover:scale-105 active:scale-95`}
                  >
                    For You
                  </button>

                  {/* People Pills */}
                  {people.map((person) => (
                    <div key={person.id} className="relative flex-shrink-0 group">
                      <button
                        onClick={() => setSelectedPersonId(person.id)}
                        className={`transition-all duration-300 backdrop-blur-xl ${
                          selectedPersonId === person.id
                            ? 'bg-gradient-to-br from-[#eb7825] to-[#d6691f] text-white shadow-[0_8px_32px_rgba(235,120,37,0.3)]'
                            : 'bg-white/80 text-gray-700 hover:bg-white/90 shadow-[0_4px_16px_rgba(0,0,0,0.06)]'
                        } w-11 h-11 rounded-full font-bold text-sm border border-white/20 flex items-center justify-center hover:scale-105 active:scale-95`}
                        title={person.name}
                      >
                        {person.initials}
                      </button>
                      {/* Remove button on hover */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemovePerson(person.id);
                        }}
                        className="absolute top-0 right-0 w-5 h-5 bg-gradient-to-br from-red-500 to-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center shadow-lg hover:scale-110 active:scale-95 backdrop-blur-xl border border-white/30"
                        style={{ transform: 'translate(25%, -25%)' }}
                      >
                        <X className="w-3 h-3" strokeWidth={2.5} />
                      </button>
                    </div>
                  ))}

                  {/* Add Person Button */}
                  <button
                    onClick={() => setShowAddPersonModal(true)}
                    data-coachmark="add-person-button"
                    className="flex-shrink-0 backdrop-blur-xl bg-white/80 hover:bg-white/90 text-[#eb7825] w-11 h-11 rounded-full font-semibold text-sm border-2 border-dashed border-[#eb7825]/40 flex items-center justify-center transition-all duration-300 hover:scale-105 active:scale-95 shadow-[0_4px_16px_rgba(0,0,0,0.06)] hover:border-[#eb7825]/60"
                    title="Add person"
                  >
                    <UserPlus className="w-4.5 h-4.5" strokeWidth={2.5} />
                  </button>
                </div>

                {/* Selected Person Label */}
                {selectedPersonId !== 'for-you' && (
                  <div className="mt-2 text-center">
                    <p className="text-xs text-gray-500">
                      Showing recommendations for{' '}
                      <span className="font-semibold text-[#eb7825]">
                        {people.find(p => p.id === selectedPersonId)?.name}
                      </span>
                    </p>
                  </div>
                )}
              </div>

              <div className="px-4">
              {selectedPersonId !== 'for-you' ? (
                // Personalized view for selected person
                (() => {
                  const selectedPerson = people.find(p => p.id === selectedPersonId);
                  if (!selectedPerson) return null;

                  const birthdayInfo = getBirthdayInfo(selectedPerson);
                  const upcomingHolidays = getUpcomingHolidays(selectedPerson.gender);

                  return (
                    <div className="space-y-6">
                      {/* Birthday Card */}
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="glass-card bg-gradient-to-br from-[#eb7825] to-[#d6691f] p-6 rounded-2xl shadow-lg text-white"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-2xl font-bold mb-1">{selectedPerson.name}'s Birthday</h3>
                            <p className="text-white/90">
                              {birthdayInfo.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} · Turning {birthdayInfo.age}
                            </p>
                          </div>
                          <div className="text-right">
                            <div className="text-4xl font-bold">{birthdayInfo.days}</div>
                            <div className="text-sm text-white/90">days away</div>
                          </div>
                        </div>
                      </motion.div>

                      {/* Upcoming Holidays */}
                      {upcomingHolidays.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-lg font-bold text-gray-900">Upcoming Holidays</h3>
                            <motion.button
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => setShowAddHolidayModal(true)}
                              className="p-2 rounded-full bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-md hover:shadow-lg transition-all duration-200"
                              title="Add custom day"
                            >
                              <Plus className="w-4 h-4" />
                            </motion.button>
                          </div>
                          <div className="space-y-3">
                            {upcomingHolidays.map((holiday, index) => {
                              // Get cards that match this holiday's category
                              const matchingCards = SEED_EXPERIENCE_CARDS.filter(
                                card => card.category === holiday.category
                              ).slice(0, 5); // Limit to 5 cards per holiday
                              
                              const isExpanded = expandedHoliday === holiday.date;
                              
                              const scrollLeft = () => {
                                const container = scrollRefs.current[holiday.date];
                                if (container) {
                                  container.scrollBy({ left: -220, behavior: 'smooth' });
                                }
                              };
                              
                              const scrollRight = () => {
                                const container = scrollRefs.current[holiday.date];
                                if (container) {
                                  container.scrollBy({ left: 220, behavior: 'smooth' });
                                }
                              };

                              return (
                                <motion.div
                                  key={holiday.date}
                                  initial={{ opacity: 0, x: -20 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: index * 0.1 }}
                                  className="glass-card bg-white rounded-xl overflow-hidden"
                                >
                                  <div 
                                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                                    onClick={() => setExpandedHoliday(isExpanded ? null : holiday.date)}
                                  >
                                    <div className="flex-1 pr-4">
                                      <h4 className="font-bold text-gray-900">{holiday.name}</h4>
                                      <p className="text-sm text-gray-600">{holiday.description}</p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                      <div className="text-right">
                                        <div className="text-2xl font-bold text-[#eb7825]">
                                          {daysUntil(holiday.date)}
                                        </div>
                                        <div className="text-xs text-gray-500">days</div>
                                      </div>
                                      <ChevronDown 
                                        className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                      />
                                    </div>
                                  </div>

                                  {/* Collapsible horizontally scrollable cards */}
                                  {isExpanded && matchingCards.length > 0 && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: 'auto', opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={{ duration: 0.3 }}
                                      className="border-t border-gray-100"
                                    >
                                      <div className="relative p-4 pt-3">
                                        {/* Left Arrow */}
                                        <button
                                          onClick={scrollLeft}
                                          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 bg-white shadow-lg rounded-full flex items-center justify-center hover:bg-gray-50 transition-colors"
                                          aria-label="Scroll left"
                                        >
                                          <ChevronLeft className="w-5 h-5 text-gray-600" />
                                        </button>

                                        {/* Scrollable Container */}
                                        <div 
                                          ref={(el) => { scrollRefs.current[holiday.date] = el; }}
                                          className="overflow-x-auto hide-scrollbar scroll-smooth"
                                          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                                        >
                                          <div className="flex gap-3 px-10">
                                            {matchingCards.map((card) => (
                                              <div
                                                key={card.id}
                                                className="flex-shrink-0 w-[200px] bg-white rounded-lg overflow-hidden shadow-sm border border-gray-100 hover:shadow-md transition-shadow cursor-pointer"
                                                onClick={() => {
                                                  handleCardClick(card);
                                                }}
                                              >
                                                <div className="relative h-28 bg-gradient-to-br from-gray-100 to-gray-200">
                                                  {card.image ? (
                                                    <ImageWithFallback
                                                      src={card.image}
                                                      alt={card.title}
                                                      className="w-full h-full object-cover"
                                                    />
                                                  ) : (
                                                    <div className="w-full h-full flex items-center justify-center">
                                                      {card.category && (() => {
                                                        const IconComponent = getIconComponent(card.category);
                                                        return IconComponent ? (
                                                          <IconComponent className="w-8 h-8 text-gray-400" />
                                                        ) : null;
                                                      })()}
                                                    </div>
                                                  )}
                                                </div>
                                                <div className="p-3">
                                                  <h5 className="font-semibold text-sm text-gray-900 line-clamp-1 mb-1">
                                                    {card.title}
                                                  </h5>
                                                  <p className="text-xs text-gray-600 line-clamp-2 mb-2">
                                                    {card.description}
                                                  </p>
                                                  <div className="flex items-center justify-between">
                                                    <div className="text-sm font-bold text-[#eb7825]">
                                                      {card.priceRange || `$${card.price}`}
                                                    </div>
                                                    {card.rating && (
                                                      <div className="flex items-center gap-1">
                                                        <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                                                        <span className="text-xs text-gray-600">{card.rating}</span>
                                                      </div>
                                                    )}
                                                  </div>
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        </div>

                                        {/* Right Arrow */}
                                        <button
                                          onClick={scrollRight}
                                          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 bg-white shadow-lg rounded-full flex items-center justify-center hover:bg-gray-50 transition-colors"
                                          aria-label="Scroll right"
                                        >
                                          <ChevronRight className="w-5 h-5 text-gray-600" />
                                        </button>
                                      </div>
                                    </motion.div>
                                  )}
                                </motion.div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : forYouHeroCard && forYouFeedCards.length > 0 ? (
                <div className="space-y-6">
                  {/* Hero Card */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, type: "spring", stiffness: 200, damping: 20 }}
                  >
                    <HeroExperienceCard
                      experience={forYouHeroCard}
                      onClick={() => handleCardClick(forYouHeroCard)}
                    />
                  </motion.div>

                  {/* Two Column Feed */}
                  <motion.div 
                    className="grid grid-cols-2 gap-4"
                    initial="hidden"
                    animate="visible"
                    variants={{
                      hidden: { opacity: 0 },
                      visible: {
                        opacity: 1,
                        transition: {
                          staggerChildren: 0.08,
                          delayChildren: 0.3
                        }
                      }
                    }}
                  >
                    {forYouFeedCards.map((experience, index) => (
                      <motion.div
                        key={experience.id}
                        variants={{
                          hidden: { opacity: 0, y: 20 },
                          visible: { 
                            opacity: 1, 
                            y: 0,
                            transition: {
                              type: "spring",
                              stiffness: 300,
                              damping: 24
                            }
                          }
                        }}
                      >
                        <CompactExperienceCard
                          experience={experience}
                          onClick={() => handleCardClick(experience)}
                        />
                      </motion.div>
                    ))}
                  </motion.div>
                </div>
              ) : (
                <div className="pt-12">
                  <Card className="p-12 text-center glass-card">
                    <Compass className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-gray-900 mb-2">
                      No experiences found
                    </h3>
                    <p className="text-gray-500">
                      Check back soon for new experiences near you
                    </p>
                  </Card>
                </div>
              )}
              </div>
            </motion.div>
          )}

          {activeTab === 'night-out' && (
            <div className="p-4 pt-6">
              {/* Filter Dropdown */}
              <div className="mb-6 relative">
                <button
                  onClick={() => setIsFilterPanelOpen(true)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-white border-2 border-gray-200 rounded-xl hover:border-[#eb7825] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Filter className="w-5 h-5 text-[#eb7825]" />
                    <span className="font-medium text-gray-900">
                      Filters
                      {(selectedGenre !== 'All Genres' || selectedDate !== 'Any Date' || selectedPrice !== 'Any Price') && (
                        <span className="ml-2 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-[#eb7825] rounded-full">
                          {[selectedGenre !== 'All Genres', selectedDate !== 'Any Date', selectedPrice !== 'Any Price'].filter(Boolean).length}
                        </span>
                      )}
                    </span>
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-600" />
                </button>
              </div>

              {/* Party Cards */}
              <div className="space-y-4">
                {filteredParties.length > 0 ? (
                  filteredParties.map(party => (
                    <PartyCard
                      key={party.id}
                      party={party}
                      onClick={() => setExpandedCard(party.id)}
                    />
                  ))
                ) : (
                  <Card className="p-12 text-center">
                    <Music className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-gray-900 mb-2">
                      No parties found
                    </h3>
                    <p className="text-gray-500 mb-4">
                      No parties match the selected genre
                    </p>
                    <button
                      onClick={() => setSelectedGenre('All Genres')}
                      className="px-4 py-2 bg-[#eb7825] text-white rounded-xl font-medium hover:bg-[#d6691f] transition-colors"
                    >
                      Show All Parties
                    </button>
                  </Card>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Expanded Card Details Modal */}
      {expandedCard && (() => {
        // Check trips first
        const expandedTrip = curatedTrips.find(trip => trip.id === expandedCard);
        if (expandedTrip) {
        
        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 flex items-center justify-center p-4">
            <motion.div 
              className="absolute top-4 left-4 right-4 bottom-24 bg-white rounded-3xl shadow-2xl border border-gray-100 flex flex-col overflow-hidden"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              {/* Header */}
              <div className="relative p-4 border-b border-gray-100 flex-shrink-0">
                <button
                  onClick={() => setExpandedCard(null)}
                  className="absolute left-4 top-4 w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors z-10"
                >
                  <X className="w-4 h-4 text-gray-600" />
                </button>
                
                <div className="text-center">
                  <div className="inline-flex items-center gap-2 bg-[#eb7825] text-white px-3 py-1 rounded-full">
                    <Plane className="w-4 h-4" />
                    <span className="font-bold text-sm">{expandedTrip.matchScore}% Match</span>
                  </div>
                </div>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto">
                {/* Image gallery */}
                <div className="relative h-80 bg-gray-900">
                  <ImageWithFallback
                    src={expandedTrip.images[galleryIndices[expandedTrip.id] || 0]}
                    alt={expandedTrip.title}
                    className="w-full h-full object-cover"
                  />
                  
                  {/* Gallery navigation */}
                  {expandedTrip.images.length > 1 && (
                    <>
                      <button
                        onClick={() => navigateGallery('prev', expandedTrip)}
                        className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 hover:bg-white rounded-full flex items-center justify-center shadow-lg transition-colors"
                      >
                        <ChevronRight className="w-5 h-5 rotate-180" />
                      </button>
                      <button
                        onClick={() => navigateGallery('next', expandedTrip)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 hover:bg-white rounded-full flex items-center justify-center shadow-lg transition-colors"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                        {expandedTrip.images.map((_: any, idx: number) => (
                          <div
                            key={idx}
                            className={`w-2 h-2 rounded-full transition-all ${
                              idx === (galleryIndices[expandedTrip.id] || 0) ? 'bg-white w-6' : 'bg-white/50'
                            }`}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Trip details */}
                <div className="p-4 space-y-4">
                  {/* Title and destination */}
                  <div>
                    <h2 className="font-bold text-2xl text-gray-900 mb-2">{expandedTrip.title}</h2>
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <div className="flex items-center gap-1 text-gray-600">
                        <MapPinned className="w-5 h-5 text-[#eb7825]" />
                        <span className="font-medium">{expandedTrip.destination}</span>
                      </div>
                      <span className="text-gray-400">•</span>
                      <div className="flex items-center gap-1 text-gray-600">
                        <Clock className="w-5 h-5 text-[#eb7825]" />
                        <span>{expandedTrip.duration}</span>
                      </div>
                      {expandedTrip.isAIGenerated && (
                        <>
                          <span className="text-gray-400">•</span>
                          <div className="flex items-center gap-1 px-2 py-1 bg-purple-100 rounded-full">
                            <Wand2 className="w-4 h-4 text-purple-600" />
                            <span className="text-xs font-medium text-purple-600">AI Generated</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Key info cards */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <DollarSign className="w-4 h-4 text-[#eb7825]" />
                        <span className="text-xs font-medium text-gray-600">Total Price</span>
                      </div>
                      <p className="text-lg font-bold text-gray-900">{expandedTrip.priceRange}</p>
                      <p className="text-xs text-gray-600">per person</p>
                    </div>
                    
                    <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Users className="w-4 h-4 text-[#eb7825]" />
                        <span className="text-xs font-medium text-gray-600">Group Size</span>
                      </div>
                      <p className="text-sm font-semibold text-gray-900">{expandedTrip.groupSize}</p>
                      <p className="text-xs text-gray-600">travelers</p>
                    </div>
                    
                    <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Calendar className="w-4 h-4 text-[#eb7825]" />
                        <span className="text-xs font-medium text-gray-600">Best Time</span>
                      </div>
                      <p className="text-sm font-semibold text-gray-900">{expandedTrip.bestTime}</p>
                    </div>
                    
                    <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Star className="w-4 h-4 text-[#eb7825]" />
                        <span className="text-xs font-medium text-gray-600">Rating</span>
                      </div>
                      <p className="text-lg font-bold text-gray-900">{expandedTrip.rating}</p>
                      <p className="text-xs text-gray-600">({expandedTrip.reviewCount} reviews)</p>
                    </div>
                  </div>

                  {/* Description */}
                  <div className="space-y-2">
                    <h3 className="font-semibold text-gray-900">About This Trip</h3>
                    <p className="text-gray-700 leading-relaxed">
                      {expandedTrip.fullDescription}
                    </p>
                  </div>

                  {/* Vibe */}
                  <div className="space-y-2">
                    <h3 className="font-semibold text-gray-900">Vibe</h3>
                    <div className="flex flex-wrap gap-2">
                      {expandedTrip.vibe.map((tag: string, idx: number) => (
                        <span 
                          key={idx}
                          className="bg-orange-50 text-[#eb7825] px-3 py-1.5 rounded-full border border-orange-200 text-sm"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* What's Included */}
                  <div className="space-y-2">
                    <h3 className="font-semibold text-gray-900">What's Included</h3>
                    <div className="space-y-2">
                      {expandedTrip.includes.map((item: string, idx: number) => (
                        <div key={idx} className="flex items-center gap-2">
                          <div className="w-5 h-5 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0">
                            <Sparkles className="w-3 h-3 text-[#eb7825]" />
                          </div>
                          <span className="text-sm text-gray-700">{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Highlights */}
                  <div className="space-y-2">
                    <h3 className="font-semibold text-gray-900">Trip Highlights</h3>
                    <div className="relative space-y-2">
                      {/* Vertical connecting line */}
                      <div className="absolute left-2.5 top-2 bottom-2 w-0.5 bg-gradient-to-b from-[#eb7825] via-orange-300 to-[#eb7825] opacity-30" />
                      
                      {expandedTrip.highlights.map((highlight: string, idx: number) => (
                        <motion.div 
                          key={idx} 
                          className="relative flex items-center gap-2"
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ 
                            duration: 0.5, 
                            delay: 0.1 * idx,
                            ease: "easeOut"
                          }}
                        >
                          <motion.div 
                            className="w-5 h-5 bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-full flex items-center justify-center flex-shrink-0 relative z-10"
                            initial={{ scale: 0.8 }}
                            animate={{ scale: 1 }}
                            transition={{ delay: 0.1 * idx + 0.2, duration: 0.3 }}
                          >
                            <Camera className="w-3 h-3 text-white" />
                          </motion.div>
                          <span className="text-sm text-gray-700">{highlight}</span>
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  {/* Curator info */}
                  <div className="bg-gradient-to-r from-orange-50 to-orange-100 border border-orange-200 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-[#eb7825] rounded-full flex items-center justify-center flex-shrink-0">
                        {expandedTrip.isAIGenerated ? (
                          <Wand2 className="w-5 h-5 text-white" />
                        ) : (
                          <ShieldCheck className="w-5 h-5 text-white" />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-gray-900 mb-1">
                          {expandedTrip.isAIGenerated ? 'AI-Curated Trip' : 'Curated by ' + expandedTrip.curator}
                        </p>
                        <p className="text-sm text-gray-600">
                          {expandedTrip.isAIGenerated 
                            ? 'This trip was generated based on your preferences using advanced AI technology.'
                            : 'Handpicked and verified by travel experts at Mingla.'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="p-4 pt-0 space-y-3">
                  <div className="flex gap-3">
                    {expandedTrip.isAIGenerated ? (
                      <button 
                        onClick={() => {
                          handleSaveTrip(expandedTrip);
                          setExpandedCard(null);
                        }}
                        className="flex-1 bg-[#eb7825] text-white py-4 px-6 rounded-xl font-semibold hover:bg-[#d6691f] transition-colors flex items-center justify-center gap-2"
                      >
                        <Heart className="w-5 h-5" />
                        Save Trip
                      </button>
                    ) : (
                      <button 
                        onClick={() => setExpandedCard(null)}
                        className="flex-1 bg-[#eb7825] text-white py-4 px-6 rounded-xl font-semibold hover:bg-[#d6691f] transition-colors flex items-center justify-center gap-2"
                      >
                        <Plane className="w-5 h-5" />
                        Book Trip - {expandedTrip.priceRange}
                      </button>
                    )}

                    <button 
                      onClick={() => handleShare(expandedTrip)}
                      className="w-12 h-12 border-2 border-gray-200 hover:border-[#eb7825] hover:bg-orange-50 rounded-xl transition-all duration-200 flex items-center justify-center group self-center"
                    >
                      <Share2 className="w-5 h-5 text-gray-600 group-hover:text-[#eb7825] transition-all" />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        );
        }
        
        // Check parties
        const expandedParty = partyData.find(party => party.id === expandedCard);
        if (expandedParty) {
          return (
            <PartyDetails
              party={expandedParty}
              galleryIndex={galleryIndices[expandedParty.id] || 0}
              onClose={() => setExpandedCard(null)}
              onNavigateGallery={(direction) => navigateGallery(direction, expandedParty)}
              onRSVP={() => {
                // Handle RSVP if needed
                setExpandedCard(null);
              }}
              onShare={() => handleShare(expandedParty)}
            />
          );
        }
        
        // Check experiences
        const expandedRec = allExperiences.find(rec => rec.id === expandedCard);
        if (expandedRec) {
          return (
            <CardDetails
              recommendation={expandedRec}
              galleryIndex={galleryIndices[expandedRec.id] || 0}
              onClose={() => setExpandedCard(null)}
              onNavigateGallery={(direction) => navigateGallery(direction, expandedRec)}
              onSetGalleryIndex={(index) => setGalleryIndex(expandedRec.id, index)}
              onSchedule={() => handleSchedule(expandedRec)}
              onBuyNow={() => {
                // Handle purchase if needed
                setExpandedCard(null);
              }}
              onShare={() => handleShare(expandedRec)}
              userPreferences={userPreferences}
              swipeDirection={null}
              isDragging={false}
              dragOffset={{ x: 0, y: 0 }}
              onTouchStart={() => {}}
              onTouchMove={() => {}}
              onTouchEnd={() => {}}
              onMouseDown={() => {}}
              onMouseMove={() => {}}
              onMouseUp={() => {}}
              onMouseLeave={() => {}}
              hideMatchScore={activeTab === 'for-you'}
            />
          );
        }
        
        return null;
      })()}

      {/* Filter Panel Modal */}
      {isFilterPanelOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end justify-center">
          <motion.div 
            className="w-full max-w-2xl bg-white rounded-t-3xl shadow-2xl max-h-[85vh] flex flex-col"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            {/* Header */}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <h2 className="text-xl font-bold text-gray-900">Filters</h2>
              <button
                onClick={() => setIsFilterPanelOpen(false)}
                className="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4 text-gray-600" />
              </button>
            </div>

            {/* Filter Content - Scrollable */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {/* Date Filter */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-[#eb7825]" />
                  Date
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {['Any Date', 'Today', 'Tomorrow', 'This Weekend', 'Next Week', 'This Month'].map((date) => (
                    <button
                      key={date}
                      onClick={() => setSelectedDate(date)}
                      className={`px-4 py-3 rounded-xl font-medium transition-all ${
                        selectedDate === date
                          ? 'bg-[#eb7825] text-white shadow-md'
                          : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {date}
                    </button>
                  ))}
                </div>
              </div>

              {/* Price Filter */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-[#eb7825]" />
                  Price Range
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {['Any Price', 'Free', 'Under $25', '$25-$50', '$50-$100', 'Over $100'].map((price) => (
                    <button
                      key={price}
                      onClick={() => setSelectedPrice(price)}
                      className={`px-4 py-3 rounded-xl font-medium transition-all ${
                        selectedPrice === price
                          ? 'bg-[#eb7825] text-white shadow-md'
                          : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {price}
                    </button>
                  ))}
                </div>
              </div>

              {/* Genre Filter */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Music className="w-5 h-5 text-[#eb7825]" />
                  Music Genre
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {musicGenres.map((genre) => (
                    <button
                      key={genre}
                      onClick={() => setSelectedGenre(genre)}
                      className={`px-4 py-3 rounded-xl font-medium transition-all ${
                        selectedGenre === genre
                          ? 'bg-[#eb7825] text-white shadow-md'
                          : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {genre}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="p-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
              <button
                onClick={() => {
                  setSelectedDate('Any Date');
                  setSelectedPrice('Any Price');
                  setSelectedGenre('All Genres');
                }}
                className="flex-1 px-4 py-3 rounded-xl font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                Clear All
              </button>
              <button
                onClick={() => setIsFilterPanelOpen(false)}
                className="flex-1 px-4 py-3 rounded-xl font-semibold text-white bg-[#eb7825] hover:bg-[#d6691f] transition-colors"
              >
                Apply Filters
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Add Custom Holiday Modal */}
      <AddCustomHolidayModal
        isOpen={showAddHolidayModal}
        onClose={() => setShowAddHolidayModal(false)}
        onAdd={handleAddCustomHoliday}
      />

      {/* Add Person Modal */}
      {showAddPersonModal && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4"
          onClick={() => {
            setShowAddPersonModal(false);
            setNewPersonName('');
            setNewPersonBirthday('');
            setNewPersonGender('other');
          }}
        >
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ 
              type: "spring", 
              damping: 25, 
              stiffness: 300 
            }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white/95 backdrop-blur-xl rounded-3xl p-8 max-w-md w-full shadow-[0_20px_60px_rgba(0,0,0,0.3)] border border-white/50"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-2xl font-bold bg-gradient-to-r from-[#eb7825] to-[#d6691f] bg-clip-text text-transparent">
                  Add Person
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  Never miss a special day
                </p>
              </div>
              <button
                onClick={() => {
                  setShowAddPersonModal(false);
                  setNewPersonName('');
                  setNewPersonBirthday('');
                  setNewPersonGender('other');
                }}
                className="p-2 hover:bg-gray-100/80 rounded-full transition-all duration-300 hover:scale-110 active:scale-95 backdrop-blur-xl"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-6 leading-relaxed">
              Add a partner, friend, or family member to get personalized recommendations.
            </p>

            <div className="space-y-5">
              {/* Name Input */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2.5">
                  Name
                </label>
                <input
                  type="text"
                  value={newPersonName}
                  onChange={(e) => setNewPersonName(e.target.value)}
                  placeholder="Enter their name"
                  className="w-full px-4 py-3.5 bg-white/80 backdrop-blur-sm border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#eb7825]/50 focus:border-[#eb7825] transition-all duration-300 placeholder:text-gray-400"
                  autoFocus
                />
              </div>

              {/* Birthday Input */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2.5">
                  Birthday
                </label>
                <input
                  type="date"
                  value={newPersonBirthday}
                  onChange={(e) => setNewPersonBirthday(e.target.value)}
                  className="w-full px-4 py-3.5 bg-white/80 backdrop-blur-sm border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#eb7825]/50 focus:border-[#eb7825] transition-all duration-300"
                />
              </div>

              {/* Gender Selection */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2.5">
                  Gender
                </label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setNewPersonGender('male')}
                    className={`flex-1 py-3 px-4 rounded-2xl font-semibold transition-all duration-300 ${
                      newPersonGender === 'male'
                        ? 'bg-gradient-to-br from-[#eb7825] to-[#d6691f] text-white shadow-[0_8px_24px_rgba(235,120,37,0.3)] scale-105'
                        : 'bg-gray-100/80 text-gray-700 hover:bg-gray-200/80 hover:scale-105 active:scale-95'
                    }`}
                  >
                    Male
                  </button>
                  <button
                    onClick={() => setNewPersonGender('female')}
                    className={`flex-1 py-3 px-4 rounded-2xl font-semibold transition-all duration-300 ${
                      newPersonGender === 'female'
                        ? 'bg-gradient-to-br from-[#eb7825] to-[#d6691f] text-white shadow-[0_8px_24px_rgba(235,120,37,0.3)] scale-105'
                        : 'bg-gray-100/80 text-gray-700 hover:bg-gray-200/80 hover:scale-105 active:scale-95'
                    }`}
                  >
                    Female
                  </button>
                  <button
                    onClick={() => setNewPersonGender('other')}
                    className={`flex-1 py-3 px-4 rounded-2xl font-semibold transition-all duration-300 ${
                      newPersonGender === 'other'
                        ? 'bg-gradient-to-br from-[#eb7825] to-[#d6691f] text-white shadow-[0_8px_24px_rgba(235,120,37,0.3)] scale-105'
                        : 'bg-gray-100/80 text-gray-700 hover:bg-gray-200/80 hover:scale-105 active:scale-95'
                    }`}
                  >
                    Other
                  </button>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 mt-8">
              <button
                onClick={() => {
                  setShowAddPersonModal(false);
                  setNewPersonName('');
                  setNewPersonBirthday('');
                  setNewPersonGender('other');
                }}
                className="flex-1 px-6 py-3.5 bg-gray-100/80 backdrop-blur-sm text-gray-700 rounded-2xl font-semibold hover:bg-gray-200/80 transition-all duration-300 hover:scale-105 active:scale-95"
              >
                Cancel
              </button>
              <button
                onClick={handleAddPerson}
                disabled={!newPersonName.trim() || !newPersonBirthday}
                className="flex-1 px-6 py-3.5 bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white rounded-2xl font-semibold hover:shadow-[0_8px_32px_rgba(235,120,37,0.4)] transition-all duration-300 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-none"
              >
                Add Person
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}

      <style>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}