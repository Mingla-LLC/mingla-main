import { CoachMarkDefinition, MilestoneDefinition } from '../types/coachMark';

export const COACH_MARKS: Record<string, CoachMarkDefinition> = {

  // ═══════════════════════════════════════════
  // EXPLORE TAB (12 marks)
  // ═══════════════════════════════════════════

  explore_welcome: {
    id: 'explore_welcome',
    group: 'explore',
    priority: 1,
    prerequisites: [],
    trigger: { type: 'tab_first_visit', value: 'home' },
    targetElementId: 'explore-card-stack',
    spotlight: { shape: 'rounded-rect', padding: 16, borderRadius: 20 },
    tooltip: { position: 'center' },
    content: {
      title: 'Your adventure starts here',
      body: 'This is your discovery deck. Experiences tailored to your taste, refreshed every session.',
      illustration: { type: 'welcome', scene: 'explore' },
    },
    delay: 800,
  },

  explore_swipe_right: {
    id: 'explore_swipe_right',
    group: 'explore',
    priority: 2,
    prerequisites: ['explore_welcome'],
    trigger: { type: 'tab_first_visit', value: 'home' },
    targetElementId: 'explore-card-stack',
    spotlight: { shape: 'rounded-rect', padding: 8, borderRadius: 20 },
    tooltip: { position: 'below' },
    content: {
      title: 'Love it? Swipe right',
      body: 'Swipe right to save an experience to your collection.',
      illustration: { type: 'gesture', gesture: 'swipe-right' },
    },
    delay: 600,
  },

  explore_swipe_left: {
    id: 'explore_swipe_left',
    group: 'explore',
    priority: 3,
    prerequisites: ['explore_swipe_right'],
    trigger: { type: 'tab_first_visit', value: 'home' },
    targetElementId: 'explore-card-stack',
    spotlight: { shape: 'rounded-rect', padding: 8, borderRadius: 20 },
    tooltip: { position: 'below' },
    content: {
      title: 'Not your vibe? Swipe left',
      body: "Swipe left to skip. Don't worry \u2014 there's always more.",
      illustration: { type: 'gesture', gesture: 'swipe-left' },
    },
    delay: 600,
  },

  explore_tap_card: {
    id: 'explore_tap_card',
    group: 'explore',
    priority: 4,
    prerequisites: ['explore_swipe_left'],
    trigger: { type: 'tab_first_visit', value: 'home' },
    targetElementId: 'explore-card-stack',
    spotlight: { shape: 'rounded-rect', padding: 8, borderRadius: 20 },
    tooltip: { position: 'below' },
    content: {
      title: 'Curious? Tap to explore',
      body: 'Tap any card to see the full story \u2014 photos, prices, and details.',
      illustration: { type: 'gesture', gesture: 'tap' },
    },
    delay: 600,
  },

  explore_solo_mode: {
    id: 'explore_solo_mode',
    group: 'explore',
    priority: 5,
    prerequisites: ['explore_tap_card'],
    trigger: { type: 'tab_first_visit', value: 'home' },
    targetElementId: 'explore-solo-button',
    spotlight: { shape: 'rounded-rect', padding: 8, borderRadius: 12 },
    tooltip: { position: 'below' },
    content: {
      title: 'Flying solo',
      body: "You're in solo mode. Everything you save is just for you.",
      illustration: { type: 'feature', icon: 'profile' },
    },
    delay: 600,
  },

  explore_session_pills: {
    id: 'explore_session_pills',
    group: 'explore',
    priority: 6,
    prerequisites: ['explore_solo_mode'],
    trigger: { type: 'tab_first_visit', value: 'home' },
    targetElementId: 'explore-session-pills',
    spotlight: { shape: 'rounded-rect', padding: 8, borderRadius: 16 },
    tooltip: { position: 'below' },
    content: {
      title: 'Plan with your crew',
      body: 'These pills are your planning sessions. Tap one to switch contexts.',
      illustration: { type: 'feature', icon: 'people' },
    },
    delay: 600,
  },

  explore_create_session: {
    id: 'explore_create_session',
    group: 'explore',
    priority: 7,
    prerequisites: ['explore_session_pills'],
    trigger: { type: 'tab_first_visit', value: 'home' },
    targetElementId: 'explore-create-session',
    spotlight: { shape: 'circle', padding: 8 },
    tooltip: { position: 'below' },
    content: {
      title: 'Start something together',
      body: 'Tap + to create a group session and invite friends to plan.',
      illustration: { type: 'feature', icon: 'board' },
    },
    delay: 600,
  },

  explore_notifications: {
    id: 'explore_notifications',
    group: 'explore',
    priority: 8,
    prerequisites: ['explore_create_session'],
    trigger: { type: 'tab_first_visit', value: 'home' },
    targetElementId: 'explore-notifications-bell',
    spotlight: { shape: 'circle', padding: 8 },
    tooltip: { position: 'below' },
    content: {
      title: 'Stay in the loop',
      body: 'Friend requests, board invites, and activity updates land here.',
      illustration: { type: 'feature', icon: 'bell' },
    },
    delay: 600,
  },

  explore_preferences: {
    id: 'explore_preferences',
    group: 'explore',
    priority: 9,
    prerequisites: ['explore_notifications'],
    trigger: { type: 'tab_first_visit', value: 'home' },
    targetElementId: 'explore-preferences-gear',
    spotlight: { shape: 'circle', padding: 8 },
    tooltip: { position: 'below' },
    content: {
      title: 'Make it yours',
      body: 'Set your budget, categories, and travel range to fine-tune recommendations.',
      illustration: { type: 'feature', icon: 'settings' },
    },
    delay: 600,
  },

  explore_card_save: {
    id: 'explore_card_save',
    group: 'explore',
    priority: 10,
    prerequisites: [],
    trigger: { type: 'element_first_visible', value: 'expanded-card-modal' },
    targetElementId: 'expanded-card-save-button',
    spotlight: { shape: 'rounded-rect', padding: 6, borderRadius: 12 },
    tooltip: { position: 'above' },
    content: {
      title: 'Save for later',
      body: 'Tap the heart to save this experience to your collection.',
      illustration: { type: 'feature', icon: 'heart' },
    },
    delay: 500,
  },

  explore_card_share: {
    id: 'explore_card_share',
    group: 'explore',
    priority: 11,
    prerequisites: ['explore_card_save'],
    trigger: { type: 'element_first_visible', value: 'expanded-card-modal' },
    targetElementId: 'expanded-card-share-button',
    spotlight: { shape: 'rounded-rect', padding: 6, borderRadius: 12 },
    tooltip: { position: 'above' },
    content: {
      title: 'Share the love',
      body: 'Send this experience to a friend or share it anywhere.',
      illustration: { type: 'feature', icon: 'share' },
    },
    delay: 600,
  },

  explore_card_calendar: {
    id: 'explore_card_calendar',
    group: 'explore',
    priority: 12,
    prerequisites: ['explore_card_share'],
    trigger: { type: 'element_first_visible', value: 'expanded-card-modal' },
    targetElementId: 'expanded-card-calendar-button',
    spotlight: { shape: 'rounded-rect', padding: 6, borderRadius: 12 },
    tooltip: { position: 'above' },
    content: {
      title: 'Lock it in',
      body: 'Add this to your calendar and get a reminder when the day comes.',
      illustration: { type: 'feature', icon: 'calendar' },
    },
    delay: 600,
  },

  // ═══════════════════════════════════════════
  // DISCOVER TAB (8 marks)
  // ═══════════════════════════════════════════

  discover_welcome: {
    id: 'discover_welcome',
    group: 'discover',
    priority: 1,
    prerequisites: [],
    trigger: { type: 'tab_first_visit', value: 'discover' },
    targetElementId: 'discover-for-you-grid',
    spotlight: { shape: 'rounded-rect', padding: 16, borderRadius: 20 },
    tooltip: { position: 'center' },
    content: {
      title: "Discover what's out there",
      body: 'Personalized picks across 12 categories, refreshed daily just for you.',
      illustration: { type: 'welcome', scene: 'discover' },
    },
    delay: 600,
  },

  discover_for_you: {
    id: 'discover_for_you',
    group: 'discover',
    priority: 2,
    prerequisites: ['discover_welcome'],
    trigger: { type: 'tab_first_visit', value: 'discover' },
    targetElementId: 'discover-hero-card',
    spotlight: { shape: 'rounded-rect', padding: 8, borderRadius: 16 },
    tooltip: { position: 'below' },
    content: {
      title: 'Curated for you',
      body: 'Your For You grid learns what you love. The more you explore, the better it gets.',
      illustration: { type: 'feature', icon: 'compass' },
    },
    delay: 600,
  },

  discover_categories: {
    id: 'discover_categories',
    group: 'discover',
    priority: 3,
    prerequisites: ['discover_for_you'],
    trigger: { type: 'tab_first_visit', value: 'discover' },
    targetElementId: 'discover-category-grid',
    spotlight: { shape: 'rounded-rect', padding: 12, borderRadius: 16 },
    tooltip: { position: 'above' },
    content: {
      title: 'Browse by vibe',
      body: 'From fine dining to outdoor adventures \u2014 tap any category to dive in.',
      illustration: { type: 'feature', icon: 'filter' },
    },
    delay: 600,
  },

  discover_people: {
    id: 'discover_people',
    group: 'discover',
    priority: 4,
    prerequisites: ['discover_categories'],
    trigger: { type: 'tab_first_visit', value: 'discover' },
    targetElementId: 'discover-people-section',
    spotlight: { shape: 'rounded-rect', padding: 12, borderRadius: 16 },
    tooltip: { position: 'above' },
    content: {
      title: 'Your favorite people',
      body: 'Add the people you care about and discover experiences for their special days.',
      illustration: { type: 'feature', icon: 'people' },
    },
    delay: 600,
  },

  discover_add_person: {
    id: 'discover_add_person',
    group: 'discover',
    priority: 5,
    prerequisites: ['discover_people'],
    trigger: { type: 'tab_first_visit', value: 'discover' },
    targetElementId: 'discover-add-person-button',
    spotlight: { shape: 'circle', padding: 8 },
    tooltip: { position: 'below' },
    content: {
      title: 'Add someone special',
      body: "Tap here to add a loved one. We'll help you find the perfect experience for them.",
      illustration: { type: 'feature', icon: 'people' },
    },
    delay: 600,
  },

  discover_holidays: {
    id: 'discover_holidays',
    group: 'discover',
    priority: 6,
    prerequisites: ['discover_add_person'],
    trigger: { type: 'element_first_visible', value: 'person-holiday-list' },
    targetElementId: 'discover-holiday-list',
    spotlight: { shape: 'rounded-rect', padding: 8, borderRadius: 12 },
    tooltip: { position: 'above' },
    content: {
      title: 'Never miss a moment',
      body: 'See upcoming holidays and birthdays with experience ideas ready to go.',
      illustration: { type: 'feature', icon: 'gift' },
    },
    delay: 600,
  },

  discover_custom_holiday: {
    id: 'discover_custom_holiday',
    group: 'discover',
    priority: 7,
    prerequisites: ['discover_holidays'],
    trigger: { type: 'element_first_visible', value: 'person-holiday-list' },
    targetElementId: 'discover-custom-holiday-button',
    spotlight: { shape: 'rounded-rect', padding: 6, borderRadius: 12 },
    tooltip: { position: 'above' },
    content: {
      title: 'Create your own occasion',
      body: 'Anniversary? Date night? Create a custom occasion for any person.',
      illustration: { type: 'feature', icon: 'calendar' },
    },
    delay: 600,
  },

  discover_link_friend: {
    id: 'discover_link_friend',
    group: 'discover',
    priority: 8,
    prerequisites: ['discover_people'],
    trigger: { type: 'element_first_visible', value: 'person-detail-view' },
    targetElementId: 'discover-link-friend-button',
    spotlight: { shape: 'rounded-rect', padding: 6, borderRadius: 12 },
    tooltip: { position: 'above' },
    content: {
      title: 'Connect the dots',
      body: 'Link an app friend to a saved person to share experiences directly.',
      illustration: { type: 'feature', icon: 'link' },
    },
    delay: 600,
  },

  // ═══════════════════════════════════════════
  // CHATS TAB (8 marks)
  // ═══════════════════════════════════════════

  chats_welcome: {
    id: 'chats_welcome',
    group: 'chats',
    priority: 1,
    prerequisites: [],
    trigger: { type: 'tab_first_visit', value: 'connections' },
    targetElementId: 'chats-friends-list',
    spotlight: { shape: 'rounded-rect', padding: 16, borderRadius: 20 },
    tooltip: { position: 'center' },
    content: {
      title: 'Your inner circle',
      body: 'Friends, messages, and connection requests \u2014 all in one place.',
      illustration: { type: 'welcome', scene: 'chats' },
    },
    delay: 600,
  },

  chats_friends: {
    id: 'chats_friends',
    group: 'chats',
    priority: 2,
    prerequisites: ['chats_welcome'],
    trigger: { type: 'tab_first_visit', value: 'connections' },
    targetElementId: 'chats-friends-tab',
    spotlight: { shape: 'rounded-rect', padding: 6, borderRadius: 12 },
    tooltip: { position: 'below' },
    content: {
      title: 'Your connections',
      body: "Everyone you're connected with on Mingla. Tap anyone to start a conversation.",
      illustration: { type: 'feature', icon: 'people' },
    },
    delay: 600,
  },

  chats_messages: {
    id: 'chats_messages',
    group: 'chats',
    priority: 3,
    prerequisites: ['chats_friends'],
    trigger: { type: 'tab_first_visit', value: 'connections' },
    targetElementId: 'chats-messages-tab',
    spotlight: { shape: 'rounded-rect', padding: 6, borderRadius: 12 },
    tooltip: { position: 'below' },
    content: {
      title: 'Direct messages',
      body: 'Your conversations, sorted by most recent. Never miss a beat.',
      illustration: { type: 'feature', icon: 'chat' },
    },
    delay: 600,
  },

  chats_requests: {
    id: 'chats_requests',
    group: 'chats',
    priority: 4,
    prerequisites: ['chats_messages'],
    trigger: { type: 'tab_first_visit', value: 'connections' },
    targetElementId: 'chats-requests-button',
    spotlight: { shape: 'rounded-rect', padding: 6, borderRadius: 12 },
    tooltip: { position: 'below' },
    content: {
      title: 'Pending requests',
      body: 'Friend requests waiting for your response. Accept to start connecting.',
      illustration: { type: 'feature', icon: 'bell' },
    },
    delay: 600,
  },

  chats_swipe_actions: {
    id: 'chats_swipe_actions',
    group: 'chats',
    priority: 5,
    prerequisites: ['chats_requests'],
    trigger: { type: 'tab_first_visit', value: 'connections' },
    targetElementId: 'chats-first-friend-card',
    spotlight: { shape: 'rounded-rect', padding: 4, borderRadius: 12 },
    tooltip: { position: 'below' },
    content: {
      title: 'Quick actions',
      body: 'Swipe left on any friend for shortcuts \u2014 message, add to board, or share.',
      illustration: { type: 'gesture', gesture: 'swipe-card-left' },
    },
    delay: 600,
  },

  chats_long_press: {
    id: 'chats_long_press',
    group: 'chats',
    priority: 6,
    prerequisites: ['chats_swipe_actions'],
    trigger: { type: 'tab_first_visit', value: 'connections' },
    targetElementId: 'chats-first-friend-card',
    spotlight: { shape: 'rounded-rect', padding: 4, borderRadius: 12 },
    tooltip: { position: 'below' },
    content: {
      title: 'More options',
      body: 'Press and hold on a friend for additional options like block or report.',
      illustration: { type: 'gesture', gesture: 'long-press' },
    },
    delay: 600,
  },

  chats_message_send: {
    id: 'chats_message_send',
    group: 'chats',
    priority: 7,
    prerequisites: [],
    trigger: { type: 'element_first_visible', value: 'message-interface' },
    targetElementId: 'chats-message-input',
    spotlight: { shape: 'rounded-rect', padding: 8, borderRadius: 16 },
    tooltip: { position: 'above' },
    content: {
      title: 'Say something',
      body: 'Type your message and tap send. Share photos too.',
      illustration: { type: 'feature', icon: 'chat' },
    },
    delay: 800,
  },

  chats_add_to_board: {
    id: 'chats_add_to_board',
    group: 'chats',
    priority: 8,
    prerequisites: [],
    trigger: { type: 'element_first_visible', value: 'friend-swipe-actions' },
    targetElementId: 'chats-add-to-board-action',
    spotlight: { shape: 'rounded-rect', padding: 6, borderRadius: 12 },
    tooltip: { position: 'above' },
    content: {
      title: 'Bring them in',
      body: 'Add a friend to any of your planning boards with one tap.',
      illustration: { type: 'feature', icon: 'board' },
    },
    delay: 500,
  },

  // ═══════════════════════════════════════════
  // LIKES TAB (6 marks)
  // ═══════════════════════════════════════════

  likes_welcome: {
    id: 'likes_welcome',
    group: 'likes',
    priority: 1,
    prerequisites: [],
    trigger: { type: 'tab_first_visit', value: 'likes' },
    targetElementId: 'likes-saved-grid',
    spotlight: { shape: 'rounded-rect', padding: 16, borderRadius: 20 },
    tooltip: { position: 'center' },
    content: {
      title: 'Your collection',
      body: "Everything you've saved and scheduled lives here.",
      illustration: { type: 'welcome', scene: 'likes' },
    },
    delay: 600,
  },

  likes_saved: {
    id: 'likes_saved',
    group: 'likes',
    priority: 2,
    prerequisites: ['likes_welcome'],
    trigger: { type: 'tab_first_visit', value: 'likes' },
    targetElementId: 'likes-saved-tab',
    spotlight: { shape: 'rounded-rect', padding: 6, borderRadius: 12 },
    tooltip: { position: 'below' },
    content: {
      title: 'Saved experiences',
      body: 'All your saved experiences in one grid. Tap any to revisit details.',
      illustration: { type: 'feature', icon: 'heart' },
    },
    delay: 600,
  },

  likes_calendar: {
    id: 'likes_calendar',
    group: 'likes',
    priority: 3,
    prerequisites: ['likes_saved'],
    trigger: { type: 'tab_first_visit', value: 'likes' },
    targetElementId: 'likes-calendar-tab',
    spotlight: { shape: 'rounded-rect', padding: 6, borderRadius: 12 },
    tooltip: { position: 'below' },
    content: {
      title: 'Your schedule',
      body: "See what's coming up. Scheduled experiences appear on their dates.",
      illustration: { type: 'feature', icon: 'calendar' },
    },
    delay: 600,
  },

  likes_schedule: {
    id: 'likes_schedule',
    group: 'likes',
    priority: 4,
    prerequisites: ['likes_calendar'],
    trigger: { type: 'element_first_visible', value: 'saved-card-actions' },
    targetElementId: 'likes-schedule-button',
    spotlight: { shape: 'rounded-rect', padding: 6, borderRadius: 12 },
    tooltip: { position: 'above' },
    content: {
      title: 'Pick a date',
      body: 'Tap any saved experience and choose a date to lock it into your calendar.',
      illustration: { type: 'feature', icon: 'calendar' },
    },
    delay: 600,
  },

  likes_qr_code: {
    id: 'likes_qr_code',
    group: 'likes',
    priority: 5,
    prerequisites: [],
    trigger: { type: 'element_first_visible', value: 'calendar-entry-actions' },
    targetElementId: 'likes-qr-button',
    spotlight: { shape: 'rounded-rect', padding: 6, borderRadius: 12 },
    tooltip: { position: 'above' },
    content: {
      title: 'Your ticket in',
      body: 'Show this QR code at the venue for a seamless check-in experience.',
      illustration: { type: 'feature', icon: 'qr' },
    },
    delay: 500,
  },

  likes_mode_filter: {
    id: 'likes_mode_filter',
    group: 'likes',
    priority: 6,
    prerequisites: ['likes_saved'],
    trigger: { type: 'tab_first_visit', value: 'likes' },
    targetElementId: 'likes-mode-filter',
    spotlight: { shape: 'rounded-rect', padding: 6, borderRadius: 12 },
    tooltip: { position: 'below' },
    content: {
      title: 'Filter by context',
      body: 'Switch between solo saves and board-specific collections.',
      illustration: { type: 'feature', icon: 'filter' },
    },
    delay: 600,
  },

  // ═══════════════════════════════════════════
  // PROFILE TAB (8 marks)
  // ═══════════════════════════════════════════

  profile_welcome: {
    id: 'profile_welcome',
    group: 'profile',
    priority: 1,
    prerequisites: [],
    trigger: { type: 'tab_first_visit', value: 'profile' },
    targetElementId: 'profile-hero-section',
    spotlight: { shape: 'rounded-rect', padding: 16, borderRadius: 24 },
    tooltip: { position: 'center' },
    content: {
      title: 'This is you',
      body: 'Your profile, your stats, your preferences. Make it yours.',
      illustration: { type: 'welcome', scene: 'profile' },
    },
    delay: 600,
  },

  profile_photo: {
    id: 'profile_photo',
    group: 'profile',
    priority: 2,
    prerequisites: ['profile_welcome'],
    trigger: { type: 'tab_first_visit', value: 'profile' },
    targetElementId: 'profile-photo',
    spotlight: { shape: 'circle', padding: 8 },
    tooltip: { position: 'below' },
    content: {
      title: 'Show yourself',
      body: 'Tap to add or change your profile photo.',
      illustration: { type: 'feature', icon: 'profile' },
    },
    delay: 600,
  },

  profile_bio: {
    id: 'profile_bio',
    group: 'profile',
    priority: 3,
    prerequisites: ['profile_photo'],
    trigger: { type: 'tab_first_visit', value: 'profile' },
    targetElementId: 'profile-bio',
    spotlight: { shape: 'rounded-rect', padding: 8, borderRadius: 12 },
    tooltip: { position: 'below' },
    content: {
      title: 'Tell your story',
      body: "Write a short bio so friends know what you're about.",
      illustration: { type: 'feature', icon: 'chat' },
    },
    delay: 600,
  },

  profile_interests: {
    id: 'profile_interests',
    group: 'profile',
    priority: 4,
    prerequisites: ['profile_bio'],
    trigger: { type: 'tab_first_visit', value: 'profile' },
    targetElementId: 'profile-interests-section',
    spotlight: { shape: 'rounded-rect', padding: 8, borderRadius: 12 },
    tooltip: { position: 'above' },
    content: {
      title: 'What lights you up',
      body: "Edit your interests to help us recommend experiences you'll actually love.",
      illustration: { type: 'feature', icon: 'compass' },
    },
    delay: 600,
  },

  profile_stats: {
    id: 'profile_stats',
    group: 'profile',
    priority: 5,
    prerequisites: ['profile_interests'],
    trigger: { type: 'tab_first_visit', value: 'profile' },
    targetElementId: 'profile-stats-row',
    spotlight: { shape: 'rounded-rect', padding: 8, borderRadius: 16 },
    tooltip: { position: 'above' },
    content: {
      title: 'Your activity at a glance',
      body: 'Saved experiences, boards, and connections \u2014 tap any to jump there.',
      illustration: { type: 'feature', icon: 'compass' },
    },
    delay: 600,
  },

  profile_settings: {
    id: 'profile_settings',
    group: 'profile',
    priority: 6,
    prerequisites: ['profile_stats'],
    trigger: { type: 'tab_first_visit', value: 'profile' },
    targetElementId: 'profile-settings-section',
    spotlight: { shape: 'rounded-rect', padding: 8, borderRadius: 12 },
    tooltip: { position: 'above' },
    content: {
      title: 'Fine-tune everything',
      body: 'Edit your profile, manage your account, or review our policies.',
      illustration: { type: 'feature', icon: 'settings' },
    },
    delay: 600,
  },

  profile_notifications: {
    id: 'profile_notifications',
    group: 'profile',
    priority: 7,
    prerequisites: ['profile_settings'],
    trigger: { type: 'tab_first_visit', value: 'profile' },
    targetElementId: 'profile-notifications-toggle',
    spotlight: { shape: 'rounded-rect', padding: 6, borderRadius: 12 },
    tooltip: { position: 'above' },
    content: {
      title: 'Control your alerts',
      body: 'Toggle notifications on or off. Your choice, always.',
      illustration: { type: 'feature', icon: 'bell' },
    },
    delay: 600,
  },

  profile_activity_status: {
    id: 'profile_activity_status',
    group: 'profile',
    priority: 8,
    prerequisites: ['profile_notifications'],
    trigger: { type: 'tab_first_visit', value: 'profile' },
    targetElementId: 'profile-activity-toggle',
    spotlight: { shape: 'rounded-rect', padding: 6, borderRadius: 12 },
    tooltip: { position: 'above' },
    content: {
      title: 'Go stealth',
      body: 'Toggle your online status. Go invisible when you want some peace.',
      illustration: { type: 'feature', icon: 'profile' },
    },
    delay: 600,
  },

  // ═══════════════════════════════════════════
  // BOARD VIEW (8 marks)
  // ═══════════════════════════════════════════

  board_welcome: {
    id: 'board_welcome',
    group: 'board',
    priority: 1,
    prerequisites: [],
    trigger: { type: 'tab_first_visit', value: 'board-view' },
    targetElementId: 'board-deck-area',
    spotlight: { shape: 'rounded-rect', padding: 16, borderRadius: 20 },
    tooltip: { position: 'center' },
    content: {
      title: 'Welcome to the board',
      body: 'This is your shared planning space. Swipe, discuss, and decide together.',
      illustration: { type: 'welcome', scene: 'board' },
    },
    delay: 800,
  },

  board_deck: {
    id: 'board_deck',
    group: 'board',
    priority: 2,
    prerequisites: ['board_welcome'],
    trigger: { type: 'tab_first_visit', value: 'board-view' },
    targetElementId: 'board-deck-tab',
    spotlight: { shape: 'rounded-rect', padding: 6, borderRadius: 12 },
    tooltip: { position: 'below' },
    content: {
      title: 'Swipe together',
      body: "Everyone sees the same cards. Swipe right to vote yes \u2014 your votes are shared.",
      illustration: { type: 'gesture', gesture: 'swipe-right' },
    },
    delay: 600,
  },

  board_discussion: {
    id: 'board_discussion',
    group: 'board',
    priority: 3,
    prerequisites: ['board_deck'],
    trigger: { type: 'tab_first_visit', value: 'board-view' },
    targetElementId: 'board-discussion-tab',
    spotlight: { shape: 'rounded-rect', padding: 6, borderRadius: 12 },
    tooltip: { position: 'below' },
    content: {
      title: 'Talk it out',
      body: 'Chat with your group about experiences. Pin important messages.',
      illustration: { type: 'feature', icon: 'chat' },
    },
    delay: 600,
  },

  board_saved: {
    id: 'board_saved',
    group: 'board',
    priority: 4,
    prerequisites: ['board_discussion'],
    trigger: { type: 'tab_first_visit', value: 'board-view' },
    targetElementId: 'board-saved-tab',
    spotlight: { shape: 'rounded-rect', padding: 6, borderRadius: 12 },
    tooltip: { position: 'below' },
    content: {
      title: 'Group favorites',
      body: 'See what everyone in the group has saved. Great minds swipe alike.',
      illustration: { type: 'feature', icon: 'heart' },
    },
    delay: 600,
  },

  board_mention: {
    id: 'board_mention',
    group: 'board',
    priority: 5,
    prerequisites: [],
    trigger: { type: 'element_first_visible', value: 'board-discussion-input' },
    targetElementId: 'board-discussion-input',
    spotlight: { shape: 'rounded-rect', padding: 8, borderRadius: 16 },
    tooltip: { position: 'above' },
    content: {
      title: 'Get their attention',
      body: "Type @ to mention someone in the discussion. They'll get notified.",
      illustration: { type: 'feature', icon: 'mention' },
    },
    delay: 800,
  },

  board_vote: {
    id: 'board_vote',
    group: 'board',
    priority: 6,
    prerequisites: ['board_deck'],
    trigger: { type: 'element_first_visible', value: 'board-vote-indicator' },
    targetElementId: 'board-vote-indicator',
    spotlight: { shape: 'rounded-rect', padding: 8, borderRadius: 12 },
    tooltip: { position: 'above' },
    content: {
      title: 'Democracy in action',
      body: "Vote on experiences together. The group's favorites rise to the top.",
      illustration: { type: 'feature', icon: 'vote' },
    },
    delay: 600,
  },

  board_invite: {
    id: 'board_invite',
    group: 'board',
    priority: 7,
    prerequisites: ['board_welcome'],
    trigger: { type: 'tab_first_visit', value: 'board-view' },
    targetElementId: 'board-invite-button',
    spotlight: { shape: 'rounded-rect', padding: 6, borderRadius: 12 },
    tooltip: { position: 'below' },
    content: {
      title: 'The more, the merrier',
      body: 'Invite more friends to join this board and plan together.',
      illustration: { type: 'feature', icon: 'people' },
    },
    delay: 600,
  },

  board_settings: {
    id: 'board_settings',
    group: 'board',
    priority: 8,
    prerequisites: ['board_invite'],
    trigger: { type: 'tab_first_visit', value: 'board-view' },
    targetElementId: 'board-settings-button',
    spotlight: { shape: 'circle', padding: 8 },
    tooltip: { position: 'below' },
    content: {
      title: 'Board controls',
      body: "Adjust the board's name, preferences, or manage participants.",
      illustration: { type: 'feature', icon: 'settings' },
    },
    delay: 600,
  },

  // ═══════════════════════════════════════════
  // ACTION-TRIGGERED (7 marks)
  // ═══════════════════════════════════════════

  action_first_save: {
    id: 'action_first_save',
    group: 'action',
    priority: 11,
    prerequisites: [],
    trigger: { type: 'action', value: 'swipe_right' },
    targetElementId: 'tab-bar-likes',
    spotlight: { shape: 'rounded-rect', padding: 8, borderRadius: 16 },
    tooltip: { position: 'above' },
    content: {
      title: 'Nice pick!',
      body: 'Your first save! Head to the Likes tab anytime to see your collection.',
      illustration: { type: 'feature', icon: 'heart' },
    },
    delay: 500,
  },

  action_first_expand: {
    id: 'action_first_expand',
    group: 'action',
    priority: 12,
    prerequisites: [],
    trigger: { type: 'action', value: 'card_expand' },
    targetElementId: 'expanded-card-scroll',
    spotlight: { shape: 'rounded-rect', padding: 16, borderRadius: 20 },
    tooltip: { position: 'center' },
    content: {
      title: 'The full picture',
      body: 'Every experience has a story. Scroll down for photos, prices, and booking.',
      illustration: { type: 'gesture', gesture: 'pull-down' },
    },
    delay: 500,
  },

  action_first_share: {
    id: 'action_first_share',
    group: 'action',
    priority: 13,
    prerequisites: [],
    trigger: { type: 'action', value: 'share' },
    targetElementId: 'share-modal-content',
    spotlight: { shape: 'rounded-rect', padding: 12, borderRadius: 20 },
    tooltip: { position: 'center' },
    content: {
      title: 'Shared!',
      body: 'Your friend will see this in their notifications. Sharing is caring.',
      illustration: { type: 'feature', icon: 'share' },
    },
    delay: 500,
  },

  action_first_schedule: {
    id: 'action_first_schedule',
    group: 'action',
    priority: 14,
    prerequisites: [],
    trigger: { type: 'action', value: 'schedule' },
    targetElementId: 'tab-bar-likes',
    spotlight: { shape: 'rounded-rect', padding: 8, borderRadius: 16 },
    tooltip: { position: 'above' },
    content: {
      title: "It's a date!",
      body: "We'll remind you when the day comes. Check the Calendar tab to manage.",
      illustration: { type: 'feature', icon: 'calendar' },
    },
    delay: 500,
  },

  action_first_preference_change: {
    id: 'action_first_preference_change',
    group: 'action',
    priority: 15,
    prerequisites: [],
    trigger: { type: 'action', value: 'preferences_saved' },
    targetElementId: 'explore-card-stack',
    spotlight: { shape: 'rounded-rect', padding: 12, borderRadius: 20 },
    tooltip: { position: 'center' },
    content: {
      title: 'Taste updated',
      body: 'Your new preferences are live. Fresh recommendations are on the way.',
      illustration: { type: 'feature', icon: 'settings' },
    },
    delay: 800,
  },

  action_first_friend_add: {
    id: 'action_first_friend_add',
    group: 'action',
    priority: 16,
    prerequisites: [],
    trigger: { type: 'action', value: 'friend_request_sent' },
    targetElementId: 'tab-bar-chats',
    spotlight: { shape: 'rounded-rect', padding: 8, borderRadius: 16 },
    tooltip: { position: 'above' },
    content: {
      title: 'Request sent!',
      body: "They'll see your request in their Chats tab. Fingers crossed!",
      illustration: { type: 'feature', icon: 'people' },
    },
    delay: 500,
  },

  action_pull_refresh: {
    id: 'action_pull_refresh',
    group: 'action',
    priority: 17,
    prerequisites: [],
    trigger: { type: 'action', value: 'pull_refresh' },
    targetElementId: 'explore-card-stack',
    spotlight: { shape: 'rounded-rect', padding: 12, borderRadius: 20 },
    tooltip: { position: 'center' },
    content: {
      title: 'Fresh content',
      body: 'Pull down anytime to refresh and get the latest experiences.',
      illustration: { type: 'gesture', gesture: 'pull-down' },
    },
    delay: 300,
  },
};

export const COACH_MARK_IDS = Object.keys(COACH_MARKS);

// ═══════════════════════════════════════════
// MILESTONES
// ═══════════════════════════════════════════

export const MILESTONES: MilestoneDefinition[] = [
  {
    id: 'explorer',
    group: 'explore',
    title: 'Explorer',
    body: "You've mastered the discovery deck. Go find something amazing.",
    requiredIds: Object.values(COACH_MARKS)
      .filter(cm => cm.group === 'explore')
      .map(cm => cm.id),
  },
  {
    id: 'discoverer',
    group: 'discover',
    title: 'Discoverer',
    body: 'The Discover tab has no secrets from you. Browse with confidence.',
    requiredIds: Object.values(COACH_MARKS)
      .filter(cm => cm.group === 'discover')
      .map(cm => cm.id),
  },
  {
    id: 'connector',
    group: 'chats',
    title: 'Connector',
    body: "You know how to build your circle. Now go make someone's day.",
    requiredIds: Object.values(COACH_MARKS)
      .filter(cm => cm.group === 'chats')
      .map(cm => cm.id),
  },
  {
    id: 'planner',
    group: 'likes',
    title: 'Planner',
    body: "Saving and scheduling? You've got it down. Time to make plans.",
    requiredIds: Object.values(COACH_MARKS)
      .filter(cm => cm.group === 'likes')
      .map(cm => cm.id),
  },
  {
    id: 'pro',
    group: 'profile',
    title: 'You, Perfected',
    body: 'Your profile is your stage. You know every setting.',
    requiredIds: Object.values(COACH_MARKS)
      .filter(cm => cm.group === 'profile')
      .map(cm => cm.id),
  },
  {
    id: 'team-player',
    group: 'board',
    title: 'Team Player',
    body: 'Boards, votes, discussions \u2014 you collaborate like a pro.',
    requiredIds: Object.values(COACH_MARKS)
      .filter(cm => cm.group === 'board')
      .map(cm => cm.id),
  },
  {
    id: 'master',
    group: 'all',
    title: 'Mingla Master',
    body: 'You know every corner of this app. The world is yours to explore.',
    requiredIds: COACH_MARK_IDS,
  },
];
