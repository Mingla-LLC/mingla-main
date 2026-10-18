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
// Issue #3802 (admin shell): the menu is grouped by the job a person came to
// do, from daily work down to rarely touched settings. Every page id appears
// exactly once. Invariant I-3802-ADMIN-SHELL-ONE-FRAME
// (docs/INVARIANT_REGISTRY.md).
//
//   - Who may open what is NOT decided here: lib/access.js owns it, per page
//     id, and prepends the role Home group. Moving an item between groups
//     never changes who sees it.
//   - A group with a label can be folded in the menu; the first group has no
//     label and is always shown.
//   - `icon` is a key of ICON_MAP in components/layout/Sidebar.jsx. One icon
//     per item, no two items share one, and a name that is not registered
//     there fails src/__tests__/admin_shell_issue3802.implementor.happy.test.js
//     (there is no fallback icon).
//   - Slots held for pages the other #3802 waves add: Pipeline (after creators,
//     and after tool-leads), Company (after careers), System (after agent).
//
// History: ORCH-1008 pruned six pages and ORCH-1014 two more; ORCH-1271..1274
// added the Business console; ISSUE-862 / #3697 the ads pages; ISSUE-3534
// Refund operations (a separate page from the read-only Money ledger: it
// retries, escalates and resolves); #3802 Waves 1 and 4 the pipelines, the
// Team dashboard (owner and admin only) and My agent.

export const NAV_GROUPS = [
  {
    label: null,
    items: [
      { id: "overview",                  label: "Dashboard",          icon: "LayoutDashboard" },
      // #3720 Slice F — Support + Email fold into one Community & Support console.
      { id: "community-support",         label: "Community & Support", icon: "LifeBuoy" },
      { id: "notifications",             label: "Notifications",      icon: "Bell" },
    ],
  },
  {
    label: "Pipeline",
    items: [
      { id: "hosts",                     label: "Hosts",              icon: "Handshake" },
      { id: "creators",                  label: "Creators",           icon: "Sparkles" },
      { id: "drafts",                    label: "Drafts to send",      icon: "FileText" },
      { id: "beta-leads",                label: "Beta Leads",         icon: "Inbox" },
      { id: "tool-leads",                label: "Tool Leads",         icon: "Wrench" },
      { id: "content-calendar",          label: "Content calendar",   icon: "CalendarClock" },
      { id: "team-dashboard",            label: "Team dashboard",     icon: "BarChart3" },
    ],
  },
  {
    label: "Business",
    items: [
      { id: "business-people",           label: "People",             icon: "Users" },
      { id: "business-brands",           label: "Brands",             icon: "Building2" },
      { id: "brand-sites",               label: "Brand Sites",        icon: "Globe" },
      { id: "business-venues",           label: "Venues",             icon: "Store" },
      { id: "business-offerings",        label: "Offerings",          icon: "CalendarDays" },
      { id: "claims",                    label: "Venue claims",       icon: "ClipboardList" },
    ],
  },
  {
    label: "Money",
    items: [
      { id: "business-payments",         label: "Payments",           icon: "CreditCard" },
      { id: "business-orders",           label: "Orders",             icon: "Receipt" },
      { id: "business-money-ledger",     label: "Money ledger",       icon: "Landmark" },
      { id: "refund-operations",         label: "Refund operations",  icon: "RotateCcw" },
      { id: "subscriptions",             label: "Subscriptions",      icon: "Repeat" },
      { id: "pricing",                   label: "Pricing",            icon: "Percent" },
    ],
  },
  {
    label: "Explorer app",
    items: [
      { id: "users",                     label: "Users",              icon: "CircleUser" },
      { id: "placepool",                 label: "Place Pool",         icon: "Map" },
      { id: "launch-cities",             label: "Launch Cities",      icon: "Rocket" },
      { id: "signals",                   label: "Signal Library",     icon: "Activity" },
      { id: "deck-tuner",                label: "Deck tuner",         icon: "SlidersHorizontal" },
      { id: "place-intelligence-trial",  label: "Intelligence Trial", icon: "Microscope" },
    ],
  },
  {
    label: "Growth",
    items: [
      { id: "ad-engine",                 label: "Ads",                icon: "Megaphone" },
    ],
  },
  {
    label: "Company",
    items: [
      { id: "admin",                     label: "Team and roles",     icon: "Shield" },
      { id: "careers",                   label: "Careers",            icon: "Briefcase" },
      { id: "data-room",                 label: "Data room",          icon: "FolderLock" },
    ],
  },
  {
    label: "System",
    items: [
      { id: "stripe-mode",               label: "Stripe mode",        icon: "Wallet" },
      { id: "api-health",                label: "API health",         icon: "HeartPulse" },
      { id: "settings",                  label: "Settings",           icon: "Settings" },
      { id: "agent",                     label: "My agent",           icon: "Bot" },
      { id: "guide",                     label: "Guide",              icon: "BookOpen" },
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
