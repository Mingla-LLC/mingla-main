/**
 * Wellness Dates Data Module
 * 
 * Purpose: Provides production-ready wellness venue data for the Wellness Dates category
 * 
 * Category Definition:
 * - Calm, restorative experiences for relaxation and rejuvenation
 * - Single-venue experiences (no multi-stop routes)
 * - Focus on mindfulness, physical restoration, emotional balance
 * - Price range: $40-$150 per person
 * - Duration: 1-2 hours typical
 * 
 * Venue Types:
 * - Yoga studios (studio, rooftop, outdoor)
 * - Spa services & massage therapy
 * - Sound baths & meditation sessions
 * - Float tanks & hydrotherapy
 * - Wellness retreats & day passes
 * - Breathwork workshops
 * 
 * Data Structure:
 * Each venue includes comprehensive wellnessData with:
 * - Wellness type & intensity level
 * - Solo-friendly indicators
 * - Atmosphere markers (calm, professional, quiet)
 * - 3-4 step timeline
 * - Match weights for personalized recommendations
 */

export interface WellnessTimelineStep {
  step: number;
  title: string;
  description: string;
  duration: string;
  icon: string;
}

export interface WellnessData {
  wellnessType: 'yoga' | 'spa' | 'massage' | 'meditation' | 'sound-bath' | 'float-tank' | 'hydrotherapy' | 'breathwork' | 'wellness-retreat';
  intensityLevel: 'restorative' | 'gentle' | 'moderate' | 'active';
  soloFriendly: boolean;
  couplesFriendly: boolean;
  groupFriendly: boolean;
  atmosphereMarkers: string[];
  professionalLevel: 'certified' | 'expert' | 'master';
  timeline: WellnessTimelineStep[];
  matchWeights: {
    soloAdventure: number;
    romantic: number;
    friendly: number;
    restorative: number;
    mindfulness: number;
  };
}

export interface WellnessVenueCard {
  id: string;
  title: string;
  category: 'wellness';
  description: string;
  wellnessType: string;
  intensityLevel: string;
  rating: number;
  reviewCount: number;
  priceRange: string;
  pricePerPerson: number;
  address: string;
  atmosphereMarkers: string[];
  highlights: string[];
  fullDescription: string;
  soloFriendly: boolean;
  couplesFriendly: boolean;
  groupFriendly: boolean;
  openingHours: string;
  phoneNumber: string;
  website: string;
  wellnessData: WellnessData;
}

/**
 * Production-ready Wellness Dates venue data
 * 5 diverse wellness venues covering different modalities
 */
export const wellnessVenues: WellnessVenueCard[] = [
  {
    id: 'wellness-001',
    title: 'Serenity Yoga Collective',
    category: 'wellness',
    description: 'Tranquil yoga studio with rooftop classes and meditation sessions',
    wellnessType: 'Yoga & Meditation',
    intensityLevel: 'Gentle to Moderate',
    rating: 4.8,
    reviewCount: 456,
    priceRange: '$25-45',
    pricePerPerson: 35,
    address: '1245 Valencia Street, San Francisco, CA 94110',
    atmosphereMarkers: ['Peaceful', 'Welcoming', 'Mindful', 'Clean', 'Natural light'],
    highlights: ['Rooftop sessions', 'All levels welcome', 'Meditation classes', 'Community atmosphere'],
    fullDescription: 'Find your center at our peaceful yoga collective featuring daily classes from gentle restorative to moderate vinyasa flow. Our rooftop space offers stunning city views for outdoor sessions.',
    soloFriendly: true,
    couplesFriendly: true,
    groupFriendly: true,
    openingHours: 'Mon-Sun 6AM-9PM',
    phoneNumber: '(415) 555-9876',
    website: 'https://serenityyogasf.com',
    wellnessData: {
      wellnessType: 'yoga',
      intensityLevel: 'gentle',
      soloFriendly: true,
      couplesFriendly: true,
      groupFriendly: true,
      atmosphereMarkers: ['peaceful', 'welcoming', 'mindful', 'clean', 'natural-light'],
      professionalLevel: 'certified',
      timeline: [
        {
          step: 1,
          title: 'Arrive Early',
          description: 'Arrive 10 minutes before class. Change and settle into the studio space.',
          duration: '10 min',
          icon: '🧘'
        },
        {
          step: 2,
          title: 'Yoga Practice',
          description: 'Flow through a 60-minute session guided by certified instructors. Focus on breath and movement.',
          duration: '60 min',
          icon: '🌸'
        },
        {
          step: 3,
          title: 'Meditation & Savasana',
          description: 'Conclude with guided meditation and final relaxation. Let your body integrate the practice.',
          duration: '10-15 min',
          icon: '🕉️'
        },
        {
          step: 4,
          title: 'Tea & Reflection',
          description: 'Optional: Enjoy complimentary herbal tea in the lounge. Connect with the community.',
          duration: '10-15 min',
          icon: '🍵'
        }
      ],
      matchWeights: {
        soloAdventure: 0.95,
        romantic: 0.7,
        friendly: 0.9,
        restorative: 0.85,
        mindfulness: 0.95
      }
    }
  },

  {
    id: 'wellness-002',
    title: 'Haven Spa & Wellness',
    category: 'wellness',
    description: 'Luxury spa offering massage therapy, facials, and hydrotherapy',
    wellnessType: 'Spa & Massage',
    intensityLevel: 'Restorative',
    rating: 4.9,
    reviewCount: 628,
    priceRange: '$95-150',
    pricePerPerson: 125,
    address: '890 Market Street, San Francisco, CA 94102',
    atmosphereMarkers: ['Luxurious', 'Tranquil', 'Professional', 'Aromatherapy', 'Quiet'],
    highlights: ['Couples massage', 'Hydrotherapy circuit', 'Organic products', 'Expert therapists'],
    fullDescription: 'Escape to our sanctuary of wellness featuring expert massage therapists, luxury facials, and a full hydrotherapy circuit. Each treatment is customized to your needs.',
    soloFriendly: true,
    couplesFriendly: true,
    groupFriendly: false,
    openingHours: 'Mon-Sun 9AM-9PM',
    phoneNumber: '(415) 555-7654',
    website: 'https://havenspasf.com',
    wellnessData: {
      wellnessType: 'spa',
      intensityLevel: 'restorative',
      soloFriendly: true,
      couplesFriendly: true,
      groupFriendly: false,
      atmosphereMarkers: ['luxurious', 'tranquil', 'professional', 'aromatherapy', 'quiet'],
      professionalLevel: 'expert',
      timeline: [
        {
          step: 1,
          title: 'Check-In & Consultation',
          description: 'Arrive 15 minutes early. Complete intake form and discuss treatment preferences with your therapist.',
          duration: '15 min',
          icon: '📋'
        },
        {
          step: 2,
          title: 'Hydrotherapy Circuit',
          description: 'Optional: Begin with our hydrotherapy circuit - sauna, steam room, and cold plunge to prepare your body.',
          duration: '20-30 min',
          icon: '💧'
        },
        {
          step: 3,
          title: 'Massage Treatment',
          description: 'Enjoy your customized 60 or 90-minute massage. Deep tissue, Swedish, or hot stone available.',
          duration: '60-90 min',
          icon: '💆'
        },
        {
          step: 4,
          title: 'Relaxation Lounge',
          description: 'Extend your experience in our quiet lounge. Sip herbal tea and let the benefits settle in.',
          duration: '15-20 min',
          icon: '🌿'
        }
      ],
      matchWeights: {
        soloAdventure: 0.9,
        romantic: 1.0,
        friendly: 0.6,
        restorative: 1.0,
        mindfulness: 0.8
      }
    }
  },

  {
    id: 'wellness-003',
    title: 'Sound Temple SF',
    category: 'wellness',
    description: 'Immersive sound bath experiences and guided meditation sessions',
    wellnessType: 'Sound Bath & Meditation',
    intensityLevel: 'Restorative',
    rating: 4.7,
    reviewCount: 342,
    priceRange: '$40-65',
    pricePerPerson: 55,
    address: '567 Divisadero Street, San Francisco, CA 94117',
    atmosphereMarkers: ['Sacred', 'Immersive', 'Calming', 'Intentional', 'Healing'],
    highlights: ['Crystal singing bowls', 'Guided meditation', 'Small groups', 'Comfortable mats'],
    fullDescription: 'Journey into deep relaxation with our immersive sound bath experiences. Crystal bowls, gongs, and chimes create healing vibrations that quiet the mind and restore balance.',
    soloFriendly: true,
    couplesFriendly: true,
    groupFriendly: true,
    openingHours: 'Wed-Sun 6PM-9PM (sessions at 6:30PM & 8PM)',
    phoneNumber: '(415) 555-3210',
    website: 'https://soundtemplesf.com',
    wellnessData: {
      wellnessType: 'sound-bath',
      intensityLevel: 'restorative',
      soloFriendly: true,
      couplesFriendly: true,
      groupFriendly: true,
      atmosphereMarkers: ['sacred', 'immersive', 'calming', 'intentional', 'healing'],
      professionalLevel: 'master',
      timeline: [
        {
          step: 1,
          title: 'Arrival & Setup',
          description: 'Arrive 10 minutes early. Choose your spot and get comfortable with mats, bolsters, and blankets.',
          duration: '10 min',
          icon: '🎵'
        },
        {
          step: 2,
          title: 'Opening Meditation',
          description: 'Begin with breath work and gentle guided meditation to prepare for the sound journey.',
          duration: '10 min',
          icon: '🧘'
        },
        {
          step: 3,
          title: 'Sound Bath Immersion',
          description: 'Lie back and surrender to the healing vibrations. Crystal bowls and gongs create waves of sound.',
          duration: '45-60 min',
          icon: '🔔'
        },
        {
          step: 4,
          title: 'Integration & Sharing',
          description: 'Slowly return to the present. Optional circle for sharing insights and experiences.',
          duration: '10-15 min',
          icon: '✨'
        }
      ],
      matchWeights: {
        soloAdventure: 0.9,
        romantic: 0.75,
        friendly: 0.85,
        restorative: 1.0,
        mindfulness: 1.0
      }
    }
  },

  {
    id: 'wellness-004',
    title: 'Float Lab Sensory Spa',
    category: 'wellness',
    description: 'Private float tank sessions for deep relaxation and sensory deprivation',
    wellnessType: 'Float Tank Therapy',
    intensityLevel: 'Restorative',
    rating: 4.6,
    reviewCount: 289,
    priceRange: '$65-95',
    pricePerPerson: 80,
    address: '1523 Howard Street, San Francisco, CA 94103',
    atmosphereMarkers: ['Private', 'Innovative', 'Clean', 'Relaxing', 'Unique'],
    highlights: ['Private float pods', 'Epsom salt therapy', 'Sensory deprivation', 'First-timer friendly'],
    fullDescription: 'Experience weightless relaxation in your private float pod filled with 1,000 pounds of Epsom salt. Perfect for meditation, recovery, and deep mental clarity.',
    soloFriendly: true,
    couplesFriendly: false,
    groupFriendly: false,
    openingHours: 'Mon-Sun 8AM-10PM (by appointment)',
    phoneNumber: '(415) 555-4567',
    website: 'https://floatlabsf.com',
    wellnessData: {
      wellnessType: 'float-tank',
      intensityLevel: 'restorative',
      soloFriendly: true,
      couplesFriendly: false,
      groupFriendly: false,
      atmosphereMarkers: ['private', 'innovative', 'clean', 'relaxing', 'unique'],
      professionalLevel: 'expert',
      timeline: [
        {
          step: 1,
          title: 'Orientation & Shower',
          description: 'First-timers receive orientation. Shower to remove oils and lotions before floating.',
          duration: '10 min',
          icon: '🚿'
        },
        {
          step: 2,
          title: 'Enter Float Pod',
          description: 'Step into your private pod. Adjust lighting and music, then lie back and float effortlessly.',
          duration: '5 min',
          icon: '🌊'
        },
        {
          step: 3,
          title: 'Float Session',
          description: 'Drift in 60 or 90 minutes of weightless sensory deprivation. Deep meditation and mental clarity.',
          duration: '60-90 min',
          icon: '☁️'
        },
        {
          step: 4,
          title: 'Rinse & Recovery',
          description: 'Shower off salt water. Enjoy tea in the relaxation lounge while you transition back.',
          duration: '15-20 min',
          icon: '🍵'
        }
      ],
      matchWeights: {
        soloAdventure: 1.0,
        romantic: 0.3,
        friendly: 0.2,
        restorative: 1.0,
        mindfulness: 0.95
      }
    }
  },

  {
    id: 'wellness-005',
    title: 'Breathwork & Movement Studio',
    category: 'wellness',
    description: 'Dynamic breathwork workshops and conscious movement classes',
    wellnessType: 'Breathwork & Somatic',
    intensityLevel: 'Active',
    rating: 4.7,
    reviewCount: 234,
    priceRange: '$35-55',
    pricePerPerson: 45,
    address: '2134 Folsom Street, San Francisco, CA 94110',
    atmosphereMarkers: ['Energetic', 'Supportive', 'Transformative', 'Community', 'Safe'],
    highlights: ['Holotropic breathwork', 'Somatic movement', 'Expert facilitators', 'Small groups'],
    fullDescription: 'Release stress and unlock vitality through powerful breathwork techniques and conscious movement. Our expert facilitators create a safe container for transformation and healing.',
    soloFriendly: true,
    couplesFriendly: true,
    groupFriendly: true,
    openingHours: 'Thu-Sun 5:30PM-8:30PM',
    phoneNumber: '(415) 555-8901',
    website: 'https://breathworksf.com',
    wellnessData: {
      wellnessType: 'breathwork',
      intensityLevel: 'active',
      soloFriendly: true,
      couplesFriendly: true,
      groupFriendly: true,
      atmosphereMarkers: ['energetic', 'supportive', 'transformative', 'community', 'safe'],
      professionalLevel: 'expert',
      timeline: [
        {
          step: 1,
          title: 'Circle Opening',
          description: 'Join the group circle. Set intentions and learn the breathwork technique you\'ll be practicing.',
          duration: '15 min',
          icon: '🫁'
        },
        {
          step: 2,
          title: 'Breathwork Journey',
          description: 'Lie down and begin the guided breathing pattern. Music and facilitation support your experience.',
          duration: '40-50 min',
          icon: '🌬️'
        },
        {
          step: 3,
          title: 'Integration Movement',
          description: 'Gentle somatic movement helps integrate the breathwork experience into your body.',
          duration: '15-20 min',
          icon: '🌀'
        },
        {
          step: 4,
          title: 'Sharing Circle',
          description: 'Optional sharing of experiences and insights. Connect with others on the journey.',
          duration: '10-15 min',
          icon: '💬'
        }
      ],
      matchWeights: {
        soloAdventure: 0.85,
        romantic: 0.65,
        friendly: 0.9,
        restorative: 0.7,
        mindfulness: 0.9
      }
    }
  }
];

/**
 * Calculate match score for Wellness Dates based on user preferences
 * 
 * Match Formula:
 * Match = 0.4(ExperienceTypeFit) + 0.25(AmbienceScore) + 0.15(BudgetFit) + 0.1(TravelProximity) + 0.1(TimeAlignment)
 * 
 * Minimum threshold: 0.65 (65%)
 * 
 * @param venue - The wellness venue to score
 * @param userPreferences - User's preferences from PreferencesSheet
 * @returns Match score between 0 and 1
 */
export function calculateWellnessMatch(
  venue: WellnessVenueCard,
  userPreferences: any
): number {
  let totalScore = 0;

  // 1. Experience Type Fit (40%)
  const experienceTypes = userPreferences?.experienceTypes || [];
  let experienceScore = 0;
  
  if (experienceTypes.includes('Solo Adventure') || experienceTypes.includes('soloAdventure')) {
    experienceScore = Math.max(experienceScore, venue.wellnessData.matchWeights.soloAdventure);
  }
  if (experienceTypes.includes('Romantic') || experienceTypes.includes('romantic')) {
    experienceScore = Math.max(experienceScore, venue.wellnessData.matchWeights.romantic);
  }
  if (experienceTypes.includes('First Date') || experienceTypes.includes('firstDate')) {
    // First dates are slightly less romantic/more friendly for wellness
    experienceScore = Math.max(experienceScore, venue.wellnessData.matchWeights.romantic * 0.8);
  }
  if (experienceTypes.includes('Friendly') || experienceTypes.includes('friendly')) {
    experienceScore = Math.max(experienceScore, venue.wellnessData.matchWeights.friendly);
  }
  if (experienceTypes.includes('Group Fun') || experienceTypes.includes('groupFun')) {
    experienceScore = Math.max(experienceScore, venue.wellnessData.matchWeights.friendly * 0.9);
  }
  
  // Default to restorative/mindfulness if no specific match
  if (experienceScore === 0) {
    experienceScore = (venue.wellnessData.matchWeights.restorative + venue.wellnessData.matchWeights.mindfulness) / 2;
  }
  
  totalScore += experienceScore * 0.4;

  // 2. Ambience Score (25%)
  // Check if user preferences align with wellness atmosphere
  let ambienceScore = 0.7; // Base score
  
  const userVibes = userPreferences?.categories || [];
  const venueAtmosphere = venue.atmosphereMarkers.map(m => m.toLowerCase());
  
  // Boost if user likes wellness experiences
  if (userVibes.includes('wellness') || userVibes.includes('Wellness Dates')) {
    ambienceScore += 0.2;
  }
  
  // Check for specific atmosphere preferences
  if (venueAtmosphere.includes('peaceful') || venueAtmosphere.includes('calm')) {
    ambienceScore += 0.05;
  }
  if (venueAtmosphere.includes('professional') || venueAtmosphere.includes('expert')) {
    ambienceScore += 0.05;
  }
  
  totalScore += Math.min(ambienceScore, 1.0) * 0.25;

  // 3. Budget Fit (15%)
  let budgetScore = 0.8; // Default good fit
  
  if (userPreferences?.budgetMin && userPreferences?.budgetMax) {
    const userMin = Number(userPreferences.budgetMin);
    const userMax = Number(userPreferences.budgetMax);
    const venuePrice = venue.pricePerPerson;
    
    if (venuePrice >= userMin && venuePrice <= userMax) {
      budgetScore = 1.0; // Perfect fit
    } else if (venuePrice < userMin) {
      budgetScore = 0.85; // Under budget (still good for wellness)
    } else if (venuePrice > userMax) {
      const overBudget = (venuePrice - userMax) / userMax;
      budgetScore = Math.max(0.5, 1.0 - overBudget); // Penalty for over budget
    }
  }
  
  totalScore += budgetScore * 0.15;

  // 4. Travel Proximity (10%)
  // Use rating as proxy for proximity (higher rated venues worth traveling for)
  const travelScore = venue.rating / 5.0;
  totalScore += travelScore * 0.1;

  // 5. Time Alignment (10%)
  // Wellness activities work well at different times
  let timeScore = 0.8; // Base score
  
  const timeOfDay = userPreferences?.timeOfDay?.toLowerCase() || '';
  
  // Yoga and meditation better in morning/afternoon
  if (venue.wellnessType === 'Yoga & Meditation') {
    if (timeOfDay.includes('morning') || timeOfDay.includes('afternoon')) {
      timeScore = 1.0;
    }
  }
  
  // Spa and massage work anytime
  if (venue.wellnessType === 'Spa & Massage') {
    timeScore = 0.95;
  }
  
  // Sound baths and breathwork better in evening
  if (venue.wellnessType === 'Sound Bath & Meditation' || venue.wellnessType === 'Breathwork & Somatic') {
    if (timeOfDay.includes('evening') || timeOfDay.includes('night')) {
      timeScore = 1.0;
    }
  }
  
  totalScore += timeScore * 0.1;

  return Math.min(totalScore, 1.0);
}

/**
 * Get all wellness venues with match scores
 */
export function getWellnessVenuesWithScores(userPreferences: any) {
  return wellnessVenues.map(venue => ({
    ...venue,
    matchScore: Math.round(calculateWellnessMatch(venue, userPreferences) * 100)
  })).filter(venue => venue.matchScore >= 65) // Minimum 65% match
    .sort((a, b) => b.matchScore - a.matchScore);
}
