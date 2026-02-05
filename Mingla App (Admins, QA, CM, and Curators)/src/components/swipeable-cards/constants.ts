// SwipeableCards Constants & Mock Data

import { Coffee } from 'lucide-react';
import { Recommendation } from './types';

export const MOCK_RECOMMENDATIONS: Recommendation[] = [
  {
    id: '1',
    title: 'Sightglass Coffee Roastery',
    category: 'sipChill',
    categoryIcon: Coffee,
    timeAway: '12 min away',
    description: 'Intimate coffee experience with artisan vibes',
    budget: 'Perfect for your $25-75 budget range',
    rating: 4.6,
    image: 'https://images.unsplash.com/photo-1642315160505-b3dff3a3c8b9?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjBzaG9wJTIwY296eSUyMGludGVyaW9yfGVufDF8fHx8MTc1OTExMDg1OHww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
    images: [
      'https://images.unsplash.com/photo-1642315160505-b3dff3a3c8b9?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjBzaG9wJTIwY296eSUyMGludGVyaW9yfGVufDF8fHx8MTc1OTExMDg1OHww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
      'https://images.unsplash.com/photo-1719581228581-35014cbd9b74?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjBzaG9wJTIwaW50ZXJpb3IlMjBjb3p5JTIwc2VhdGluZ3xlbnwxfHx8fDE3NTkxNzMwMzZ8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
      'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjBjdXAlMjBsYXR0ZSUyMGFydHxlbnwxfHx8fDE3NTkxNzMwNDJ8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
      'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjBzaG9wJTIwaW50ZXJpb3IlMjBiYXJpc3RhfGVufDF8fHx8MTc1OTE3MzA0Mnww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral'
    ],
    travelTime: '12m',
    distance: '3.2 km',
    experienceType: 'firstDate',
    priceRange: '$15-40',
    pricePerPerson: 25,
    highlights: ['Specialty Coffee', 'Artisan Roasting', 'Cozy Atmosphere'],
    fullDescription: 'Experience expertly crafted coffee in a warm, industrial-chic space. Watch skilled baristas at work while enjoying single-origin beans roasted on-site.',
    address: '270 7th St, San Francisco, CA 94103',
    openingHours: 'Mon-Fri 7AM-7PM, Sat-Sun 8AM-6PM',
    phoneNumber: '+1 (415) 861-1313',
    website: 'https://sightglasscoffee.com',
    tags: ['coffee', 'artisan', 'specialty', 'date spot'],
    matchScore: 92,
    matchFactors: {
      location: 95,
      budget: 88,
      category: 92,
      time: 90,
      popularity: 93
    },
    socialStats: {
      views: 15420,
      likes: 1834,
      saves: 892,
      shares: 156
    },
    reviewCount: 2847
  }
];

// Intent mapping for card matching
export const INTENT_TYPE_MAP: { [key: string]: string[] } = {
  'Solo adventure': ['soloAdventure', 'firstDate'],
  'First Date': ['firstDate', 'romantic'],
  'Romantic': ['romantic', 'firstDate'],
  'Friendly': ['friendly', 'groupFun'],
  'Group fun': ['groupFun', 'friendly'],
  'Business': ['business']
};

// Card filtering thresholds
export const CARD_GENERATION_BATCH_SIZE = 10;
export const DEFAULT_MAX_BUDGET = 10000;
export const SWIPE_THRESHOLD = 100; // pixels
export const SWIPE_VELOCITY_THRESHOLD = 0.5;
