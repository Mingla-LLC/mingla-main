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
  "user_card_impressions",
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
];

export const STAT_CARDS = [
  { label: "Total Users", table: "profiles", icon: "Users" },
  { label: "Experiences", table: "experiences", icon: "Sparkles" },
  { label: "Card Pool", table: "card_pool", icon: "Layers" },
  { label: "Sessions", table: "collaboration_sessions", icon: "Handshake" },
  { label: "Boards", table: "boards", icon: "LayoutDashboard" },
  { label: "Reviews", table: "place_reviews", icon: "Star" },
  { label: "Feedback", table: "app_feedback", icon: "MessageSquare" },
  { label: "User Reports", table: "user_reports", icon: "Flag" },
];

export const SEED_SCRIPTS = [
  {
    label: "Seed Demo Profiles",
    description: "Insert 5 test user profiles",
    icon: "UserPlus",
    sql: `INSERT INTO profiles (id, email, display_name, username, first_name, last_name, has_completed_onboarding, active, created_at)
VALUES
  (gen_random_uuid(), 'demo1@mingla.app', 'Alex Demo', 'alexdemo', 'Alex', 'Demo', true, true, now()),
  (gen_random_uuid(), 'demo2@mingla.app', 'Jamie Test', 'jamietest', 'Jamie', 'Test', true, true, now()),
  (gen_random_uuid(), 'demo3@mingla.app', 'Sam Dev', 'samdev', 'Sam', 'Dev', false, true, now()),
  (gen_random_uuid(), 'demo4@mingla.app', 'Taylor QA', 'taylorqa', 'Taylor', 'QA', true, true, now()),
  (gen_random_uuid(), 'demo5@mingla.app', 'Jordan Seed', 'jordanseed', 'Jordan', 'Seed', false, true, now());`,
  },
  {
    label: "Clear Expired Caches",
    description: "Delete expired Google Places & Ticketmaster cache rows",
    icon: "Trash2",
    sql: `DELETE FROM google_places_cache WHERE expires_at < now();
DELETE FROM ticketmaster_events_cache WHERE expires_at < now();
DELETE FROM discover_daily_cache WHERE expires_at < now();`,
  },
  {
    label: "Reset Inactive Sessions",
    description: "Mark old collaboration sessions as inactive",
    icon: "RefreshCw",
    sql: `UPDATE collaboration_sessions SET is_active = false WHERE last_activity_at < now() - interval '7 days' AND is_active = true;`,
  },
  {
    label: "Clear Demo Data",
    description: "Remove all profiles with @mingla.app email",
    icon: "Eraser",
    sql: `DELETE FROM profiles WHERE email LIKE '%@mingla.app';`,
  },
];

export const NAV_ITEMS = [
  { id: "overview", label: "Dashboard", icon: "LayoutDashboard" },
  { id: "analytics", label: "Analytics", icon: "BarChart3" },
  { id: "users", label: "Users", icon: "Users" },
  { id: "subscriptions", label: "Subscriptions", icon: "CreditCard" },
  { id: "content", label: "Content", icon: "Layers" },
  { id: "tables", label: "Tables", icon: "Database" },
  { id: "seed", label: "Seed & Scripts", icon: "Terminal" },
  { id: "placepool", label: "Place Pool", icon: "Globe" },
  { id: "photopool", label: "Photo & Pool", icon: "Camera" },
  { id: "feedback", label: "Beta Feedback", icon: "Mic" },
  { id: "reports", label: "Reports", icon: "Flag" },
  { id: "email", label: "Email", icon: "Mail" },
  { id: "admin", label: "Admin Users", icon: "Shield" },
  { id: "settings", label: "Settings", icon: "Settings" },
];

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
    tables: ["experiences", "card_pool", "place_pool", "user_card_impressions"],
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
    label: "Caches",
    tables: ["discover_daily_cache", "google_places_cache", "ticketmaster_events_cache", "admin_backfill_log", "admin_config"],
  },
];
