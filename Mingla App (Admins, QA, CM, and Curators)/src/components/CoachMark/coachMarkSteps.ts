import { CoachMarkStep } from './types';

export const COACH_MARK_VERSION = 'v2';
export const COACH_MARK_STORAGE_KEY = 'mingla_coachmark_v2';

export const coachMarkSteps: CoachMarkStep[] = [
  {
    id: 'preferences',
    title: 'Personalize Your Experience',
    description: 'Tap here to set your vibe, budget, location radius, and favorite categories. Your feed adapts instantly to show exactly what you love.',
    icon: '🎯',
    targetRef: 'preferences-button',
    position: 'bottom',
    spotlightShape: 'circle',
    spotlightPadding: 16,
    page: 'home'
  },
  {
    id: 'collaboration-sessions',
    title: 'Solo & Collaboration Modes',
    description: 'Switch between Solo and Collaboration modes here! Each mode can have its own preferences (from step 1). Solo shows experiences tailored just for you, while collaboration sessions adapt to group preferences.',
    icon: '👥',
    targetRef: 'collaboration-sessions',
    position: 'bottom',
    spotlightShape: 'rectangle',
    spotlightPadding: 12,
    page: 'home'
  },
  {
    id: 'solo-button',
    title: 'Solo Mode',
    description: 'Tap "Solo" to browse experiences on your own. Your personal preferences will guide what you see.',
    icon: '🙋',
    targetRef: 'solo-button',
    position: 'bottom',
    spotlightShape: 'rectangle',
    spotlightPadding: 8,
    page: 'home'
  },
  {
    id: 'create-session-button',
    title: 'Create Collaboration Session',
    description: 'Tap the + button to create a new collaboration session and invite friends to swipe experiences together!',
    icon: '✨',
    targetRef: 'create-session-button',
    position: 'bottom',
    spotlightShape: 'circle',
    spotlightPadding: 12,
    page: 'home'
  },
  {
    id: 'swipe-cards',
    title: 'Discover Local Experiences',
    description: 'Swipe right to save experiences you love, left to pass. Tap any card to see full details, photos, and booking options.',
    icon: '✨',
    targetRef: 'swipe-card',
    position: 'top',
    spotlightShape: 'rectangle',
    spotlightPadding: 20,
    page: 'home'
  },
  {
    id: 'discover-for-you',
    title: 'Personalized Feed',
    description: 'Your curated feed shows experiences tailored to your preferences. Explore local activities, events, and parties just for you.',
    icon: '🎯',
    targetRef: 'discover-for-you-tab',
    position: 'center',
    spotlightShape: 'rectangle',
    spotlightPadding: 12,
    page: 'discover'
  },
  {
    id: 'add-person',
    title: 'Plan for Friends & Family',
    description: 'Add people to get personalized experience recommendations for them! Perfect for planning birthdays, date nights, or special occasions.',
    icon: '👥',
    targetRef: 'add-person-button',
    position: 'center',
    spotlightShape: 'circle',
    spotlightPadding: 16,
    page: 'discover'
  },
  {
    id: 'night-out',
    title: 'Night-Out Experiences',
    description: 'Discover parties, events, and nightlife! From rooftop soirées to live music, find the perfect way to make your night unforgettable.',
    icon: '🎉',
    targetRef: 'night-out-tab',
    position: 'center',
    spotlightShape: 'rectangle',
    spotlightPadding: 12,
    page: 'discover'
  },
  {
    id: 'friends',
    title: 'Your Social Circle',
    description: 'Connect with friends, send collaboration invites, and build your network. See who\'s online and what experiences they\'re exploring.',
    icon: '👥',
    targetRef: 'friends-tab',
    position: 'center',
    spotlightShape: 'rectangle',
    spotlightPadding: 12,
    page: 'connections'
  },
  {
    id: 'messages',
    title: 'Direct Messaging',
    description: 'Chat with friends about experiences, share recommendations, and coordinate plans. Keep all your conversations in one place.',
    icon: '💬',
    targetRef: 'messages-tab',
    position: 'center',
    spotlightShape: 'rectangle',
    spotlightPadding: 12,
    page: 'connections',
    requiresTabSwitch: 'messages'
  },
  {
    id: 'saved-tab',
    title: 'Your Saved Experiences',
    description: 'All experiences you\'ve liked are saved here. Browse your collection, schedule them, or purchase tickets when you\'re ready.',
    icon: '💾',
    targetRef: 'saved-tab',
    position: 'center',
    spotlightShape: 'rectangle',
    spotlightPadding: 12,
    page: 'activity',
    requiresTabSwitch: 'saved'
  },
  {
    id: 'calendar-tab',
    title: 'Your Calendar',
    description: 'Track all your scheduled and purchased experiences in one place. Get QR codes for entry, propose new dates, and manage your upcoming adventures.',
    icon: '📅',
    targetRef: 'calendar-tab',
    position: 'center',
    spotlightShape: 'rectangle',
    spotlightPadding: 12,
    page: 'activity',
    requiresTabSwitch: 'calendar'
  },
  {
    id: 'profile-overview',
    title: 'Your Profile Hub',
    description: 'View your stats, manage settings, track your vibes, and customize your Mingla experience. This is your personal dashboard for everything Mingla!',
    icon: '👤',
    targetRef: 'profile-page-content',
    position: 'center',
    spotlightShape: 'rectangle',
    spotlightPadding: 16,
    page: 'profile',
    isLastStep: true
  }
];