/**
 * Only these emails can access the admin dashboard.
 * Add new admins here. Everything else is rejected at the login screen.
 */
export const ALLOWED_ADMIN_EMAILS = [
  "seth@usemingla.com",
];

// ORCH-0640 ch08: TABLES allow-list scrubbed.
//   Removed: card_pool, card_pool_stops, saves, experiences, saved_experiences,
//            ai_validation_jobs, ai_validation_results, ai_validation_batches.
//   Renamed: ai_validation_jobs → rules_runs, ai_validation_results → rules_run_results.
//   Added:   engagement_metrics, curated_teaser_cache, rules_runs, rules_run_results,
//            place_scores, signal_definitions, signal_definition_versions.
export const TABLES = [
  "profiles",
  "place_pool",
  "place_scores",
  "signal_definitions",
  "signal_definition_versions",
  "engagement_metrics",
  "curated_teaser_cache",
  "rules_runs",
  "rules_run_results",
  "rule_sets",
  "rule_set_versions",
  "rule_entries",
  "rules_versions",
  "saved_card",
  "saved_people",
  "collaboration_sessions",
  "session_participants",
  "boards",
  "board_cards",
  "board_votes",
  "board_messages",
  "board_card_messages",
  "board_card_rsvps",
  "board_saved_cards",
  "board_user_swipe_states",
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

// ORCH-0640 ch08: STAT_CARDS stripped of "Cards" (card_pool archived).
// Added "Signal Scores" + "Engagement 7d" (new place-level metrics).
export const STAT_CARDS = [
  { label: "Users", table: "profiles", icon: "Users" },
  { label: "Places", table: "place_pool", icon: "Globe" },
  { label: "Signal Scores", table: "place_scores", icon: "Activity" },
  { label: "Engagement (7d)", table: "engagement_metrics", icon: "TrendingUp" },
  { label: "Collab Sessions", table: "collaboration_sessions", icon: "Handshake" },
  { label: "Boards", table: "boards", icon: "LayoutDashboard" },
  { label: "Reviews", table: "place_reviews", icon: "Star" },
  { label: "Feedback", table: "app_feedback", icon: "MessageSquare" },
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
// ORCH-0640 ch08: reorganised around the 3-gate architecture (DEC-044).
//   Deleted entries: Card Pool, AI Validation (both pages DROPPED).
//   New group: Supply (place_pool supply chain — intake + photo backfill).
//   New group: Quality Gates (signal library — G1/G2/G3 authoring).
//   Content group: kept Moderation + Place Pool only.

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
    label: "Supply",
    items: [
      { id: "seed", label: "Seed / Refresh", icon: "Terminal" },
      { id: "placepool", label: "Place Pool", icon: "Globe" },
    ],
  },
  {
    label: "Quality Gates",
    items: [
      { id: "signals", label: "Signal Library", icon: "Activity" },
      { id: "photo-labeling", label: "Photo Labeling", icon: "Camera" },
      { id: "photo-scorer", label: "Photo Scorer", icon: "Sparkles" },
    ],
  },
  {
    label: "Content",
    items: [
      { id: "content", label: "Moderation", icon: "Layers" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { id: "analytics", label: "Analytics", icon: "BarChart3" },
      { id: "reports", label: "Reports", icon: "Flag" },
      { id: "feedback", label: "Feedback", icon: "Mic" },
    ],
  },
  {
    label: "Operations",
    items: [
      { id: "email", label: "Email", icon: "Mail" },
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

// ORCH-0640 ch08: TABLE_CATEGORIES rescoped.
export const TABLE_CATEGORIES = [
  {
    label: "Users & Profiles",
    tables: ["profiles", "preferences", "notification_preferences", "saved_card", "saved_people"],
  },
  {
    label: "Places & Serving",
    tables: ["place_pool", "place_scores", "signal_definitions", "signal_definition_versions", "curated_teaser_cache"],
  },
  {
    label: "Engagement",
    tables: ["engagement_metrics", "user_interactions", "user_sessions", "user_activity", "place_reviews"],
  },
  {
    label: "Rules Engine",
    tables: ["rule_sets", "rule_set_versions", "rule_entries", "rules_versions", "rules_runs", "rules_run_results"],
  },
  {
    label: "Social & Messaging",
    tables: ["friends", "friend_requests", "friend_links", "messages", "conversations", "conversation_participants", "blocked_users"],
  },
  {
    label: "Collaboration & Boards",
    tables: ["collaboration_sessions", "session_participants", "boards", "board_cards", "board_votes", "board_messages", "board_card_messages", "board_card_rsvps", "board_saved_cards", "board_user_swipe_states"],
  },
  {
    label: "Calendar & Safety",
    tables: ["calendar_entries", "experience_feedback", "scheduled_activities", "user_reports", "app_feedback", "activity_history", "admin_email_log"],
  },
  {
    label: "Caches & Admin",
    tables: ["discover_daily_cache", "google_places_cache", "ticketmaster_events_cache", "admin_backfill_log", "admin_config", "admin_audit_log", "email_templates"],
  },
];
