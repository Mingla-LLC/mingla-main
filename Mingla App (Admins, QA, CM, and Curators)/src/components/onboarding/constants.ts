// Onboarding Flow Constants

import {
  Globe, Heart, Users, Coffee, Eye, Utensils, Dumbbell,
  Sparkles, TreePine, Music, CloudSun, Star, PersonStanding,
  Bike, Bus, Car
} from 'lucide-react';
import { Intent, Vibe, TravelModeOption, Friend } from './types';

export const TOTAL_STEPS = 10;

export const INTENT_OPTIONS: Intent[] = [
  {
    id: 'solo-adventure',
    title: 'Solo Adventure',
    icon: Globe,
    emoji: '🌍',
    description: 'Explore new things on your own',
    // All categories allowed
  },
  {
    id: 'first-dates',
    title: 'Plan First Dates',
    icon: Heart,
    emoji: '💕',
    description: 'Great first impression experiences',
    allowedCategories: ['take-a-stroll', 'sip-and-chill', 'picnics', 'screen-and-relax', 'creative-hands-on', 'play-and-move', 'dining-experiences']
  },
  {
    id: 'romantic',
    title: 'Find Romantic Activities',
    icon: Heart,
    emoji: '💘',
    description: 'Intimate and romantic experiences',
    allowedCategories: ['sip-and-chill', 'picnics', 'dining-experiences', 'wellness-dates']
  },
  {
    id: 'friendly',
    title: 'Find Friendly Activities',
    icon: Users,
    emoji: '👥',
    description: 'Fun activities with friends',
    // All categories allowed
  },
  {
    id: 'group-fun',
    title: 'Find Activities for Groups',
    icon: Users,
    emoji: '🎉',
    description: 'Group activities and celebrations',
    allowedCategories: ['play-and-move', 'creative-hands-on', 'casual-eats', 'screen-and-relax', 'freestyle']
  },
  {
    id: 'business',
    title: 'Business/Work Meetings',
    icon: Coffee,
    emoji: '💼',
    description: 'Professional meeting spaces',
    allowedCategories: ['take-a-stroll', 'sip-and-chill', 'dining-experiences']
  }
];

export const VIBE_CATEGORIES: Vibe[] = [
  {
    id: 'take-a-stroll',
    name: 'Take a Stroll',
    icon: Eye,
    emoji: '🚶',
    description: 'Parks, trails, waterfronts, nearby cafés'
  },
  {
    id: 'sip-and-chill',
    name: 'Sip & Chill',
    icon: Coffee,
    emoji: '☕',
    description: 'Bars, cafés, wine bars, lounges'
  },
  {
    id: 'casual-eats',
    name: 'Casual Eats',
    icon: Utensils,
    emoji: '🍕',
    description: 'Casual restaurants, diners, food trucks'
  },
  {
    id: 'screen-and-relax',
    name: 'Screen & Relax',
    icon: Music,
    emoji: '🎬',
    description: 'Movies, theaters, comedy shows'
  },
  {
    id: 'creative-hands-on',
    name: 'Creative & Hands-On',
    icon: Sparkles,
    emoji: '🎨',
    description: 'Classes, workshops, arts & crafts'
  },
  {
    id: 'picnics',
    name: 'Picnics',
    icon: CloudSun,
    emoji: '🧺',
    description: 'Outdoor dining, scenic spots, park setups'
  },
  {
    id: 'play-and-move',
    name: 'Play & Move',
    icon: Dumbbell,
    emoji: '⚽',
    description: 'Bowling, mini golf, sports, kayaking'
  },
  {
    id: 'dining-experiences',
    name: 'Dining Experiences',
    icon: Utensils,
    emoji: '🍽️',
    description: 'Upscale or chef-led restaurants'
  },
  {
    id: 'wellness-dates',
    name: 'Wellness Dates',
    icon: TreePine,
    emoji: '🧘',
    description: 'Yoga, spas, sound baths, healthy dining'
  },
  {
    id: 'freestyle',
    name: 'Freestyle',
    icon: Star,
    emoji: '✨',
    description: 'Pop-ups, festivals, unique or quirky events'
  }
];

export const TRAVEL_MODE_OPTIONS: TravelModeOption[] = [
  {
    id: 'walking',
    label: 'Walking',
    icon: PersonStanding,
    speed: '~5 km/h',
    description: 'Best for nearby spots',
    color: 'from-green-500 to-emerald-600'
  },
  {
    id: 'biking',
    label: 'Biking',
    icon: Bike,
    speed: '~15 km/h',
    description: 'Faster than walking',
    color: 'from-blue-500 to-cyan-600'
  },
  {
    id: 'transit',
    label: 'Public Transit',
    icon: Bus,
    speed: '~20 km/h avg',
    description: 'Includes wait time',
    color: 'from-purple-500 to-indigo-600'
  },
  {
    id: 'driving',
    label: 'Driving',
    icon: Car,
    speed: '~30 km/h city',
    description: 'Fastest option',
    color: 'from-orange-500 to-red-600'
  }
];

export const MOCK_CONTACTS: Friend[] = [
  {
    id: '1',
    name: 'Alex Rivera',
    email: 'alex.rivera@email.com',
    phone: '(555) 123-4567',
    avatar: null
  },
  {
    id: '2',
    name: 'Taylor Kim',
    email: 'taylor.kim@email.com',
    phone: '(555) 234-5678',
    avatar: null
  },
  {
    id: '3',
    name: 'Morgan Chen',
    email: 'morgan.chen@email.com',
    phone: '(555) 345-6789',
    avatar: null
  },
  {
    id: '4',
    name: 'Casey Davis',
    email: 'casey.davis@email.com',
    phone: '(555) 456-7890',
    avatar: null
  }
];

export const DEFAULT_ONBOARDING_DATA = {
  userProfile: {
    firstName: '',
    lastName: '',
    email: '',
    profilePhoto: null
  },
  intents: [],
  vibes: [],
  location: '',
  locationDetails: null,
  travelMode: 'walking' as const,
  budgetMin: '' as number | '',
  budgetMax: '' as number | '',
  budgetPreset: '',
  constraintType: 'time' as const,
  timeConstraint: '' as number | '',
  distanceConstraint: '' as number | '',
  datePreference: '' as const,
  timeSlot: '' as const,
  customDate: '',
  exactTime: '',
  invitedFriends: []
};