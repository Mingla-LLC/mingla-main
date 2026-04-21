/**
 * Only these emails can access the admin dashboard.
 * Add new admins here. Everything else is rejected at the login screen.
 */
export const ALLOWED_ADMIN_EMAILS = [
  "seth@usemingla.com",
];

export const TABLES = [
  "profiles",
  "experiences",
  "card_pool",
  "place_pool",
  "collaboration_sessions",
  "session_participants",
  "boards",
  "board_cards",
  "board_votes",
  "board_messages",
  "board_card_messages",
  "board_card_rsvps",
  "saved_experiences",
  "saved_card",
  "saved_people",
  "friends",
  "friend_requests",
  "friend_links",
  "messages",
  "conversations",
  "conversation_participants",
  "user_interactions",
  "user_sessions",
  "user_activity",
  "user_location_history",
  "user_preference_learning",
  "calendar_entries",
  "place_reviews",
  "experience_feedback",
  "app_feedback",
  "user_reports",
  "blocked_users",
  "scheduled_activities",
  "preferences",
  "notification_preferences",
  "admin_email_log",
  "activity_history",
  "discover_daily_cache",
  "google_places_cache",
  "ticketmaster_events_cache",
  "admin_subscription_overrides",
  "admin_backfill_log",
  "admin_config",
  "admin_audit_log",
  "email_templates",
];

export const STAT_CARDS = [
  { label: "Users", table: "profiles", icon: "Users" },
  { label: "Experiences", table: "experiences", icon: "Sparkles" },
  { label: "Cards", table: "card_pool", icon: "Layers" },
  { label: "Collab Sessions", table: "collaboration_sessions", icon: "Handshake" },
  { label: "Boards", table: "boards", icon: "LayoutDashboard" },
  { label: "Reviews", table: "place_reviews", icon: "Star" },
  { label: "Feedback", table: "app_feedback", icon: "MessageSquare" },
  { label: "Reports", table: "user_reports", icon: "Flag" },
];

export const SEED_SCRIPTS = [
  {
    label: "Seed Demo Profiles",
    description: "Insert 5 test user profiles",
    icon: "UserPlus",
    rpc: "admin_seed_demo_profiles",
  },
  {
    label: "Clear Expired Caches",
    description: "Delete expired cache rows",
    icon: "Trash2",
    rpc: "admin_clear_expired_caches",
  },
  {
    label: "Reset Inactive Sessions",
    description: "Mark old collaboration sessions as inactive",
    icon: "RefreshCw",
    rpc: "admin_reset_inactive_sessions",
  },
  {
    label: "Clear Demo Data",
    description: "Remove all profiles with @mingla.app email",
    icon: "Eraser",
    rpc: "admin_clear_demo_data",
  },
];

// ─── Grouped Sidebar Navigation ──────────────────────────────────────────────

export const NAV_GROUPS = [
  {
    label: null,
    items: [
      { id: "overview", label: "Dashboard", icon: "LayoutDashboard" },
    ],
  },
  {
    label: "People",
    items: [
      { id: "users", label: "Users", icon: "Users" },
      { id: "subscriptions", label: "Subscriptions", icon: "CreditCard" },
      { id: "admin", label: "Admin Users", icon: "Shield" },
    ],
  },
  {
    label: "Content",
    items: [
      { id: "content", label: "Moderation", icon: "Layers" },
      { id: "placepool", label: "Place Pool", icon: "Globe" },
      { id: "cardpool", label: "Card Pool", icon: "Layers" },
    ],
  },
  {
    label: "Operations",
    items: [
      { id: "reports", label: "Reports", icon: "Flag" },
      { id: "feedback", label: "Feedback", icon: "Mic" },
      { id: "email", label: "Email", icon: "Mail" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { id: "analytics", label: "Analytics", icon: "BarChart3" },
      { id: "ai-validation", label: "AI Validation", icon: "Brain" },
      { id: "signals", label: "Signal Library", icon: "Activity" }, // ORCH-0588 Slice 1
    ],
  },
  {
    label: "Launch Tools",
    items: [
      { id: "seed", label: "Database Tools", icon: "Terminal" },
    ],
  },
  {
    label: "System",
    collapsible: true,
    items: [
      { id: "settings", label: "Settings", icon: "Settings" },
      { id: "tables", label: "Table Browser", icon: "Database" },
    ],
  },
];

// Backward-compatible flat list (used by AppShell.currentTitle)
export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export const STATUS_COLORS = {
  pending: "warning",
  reviewed: "info",
  resolved: "success",
  dismissed: "default",
};

export const TABLE_CATEGORIES = [
  {
    label: "Users & Profiles",
    tables: ["profiles", "preferences", "notification_preferences", "saved_experiences", "saved_card", "saved_people"],
  },
  {
    label: "Experiences & Cards",
    tables: ["experiences", "card_pool", "place_pool"],
  },
  {
    label: "Social & Messaging",
    tables: ["friends", "friend_requests", "friend_links", "messages", "conversations", "conversation_participants", "blocked_users"],
  },
  {
    label: "Collaboration & Boards",
    tables: ["collaboration_sessions", "session_participants", "boards", "board_cards", "board_votes", "board_messages", "board_card_messages", "board_card_rsvps"],
  },
  {
    label: "Calendar & Reviews",
    tables: ["calendar_entries", "place_reviews", "experience_feedback", "scheduled_activities"],
  },
  {
    label: "Analytics & Safety",
    tables: ["user_interactions", "user_sessions", "user_activity", "user_location_history", "user_preference_learning", "user_reports", "app_feedback", "activity_history", "admin_email_log"],
  },
  {
    label: "Caches & Admin",
    tables: ["discover_daily_cache", "google_places_cache", "ticketmaster_events_cache", "admin_backfill_log", "admin_config", "admin_audit_log", "email_templates"],
  },
];
