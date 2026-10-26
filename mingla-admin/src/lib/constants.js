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
//   - A group with a label can be folded in the menu. Since #4130 every menu
//     group is named; only the role Home group (lib/access.js) has no label.
//   - `icon` is a key of ICON_MAP in components/layout/Sidebar.jsx. One icon
//     per item, no two items share one, and a name that is not registered
//     there fails src/__tests__/admin_shell_issue3802.implementor.happy.test.js
//     (there is no fallback icon).
//   - #4130: a page that replaced older ones holds them as tabs until its
//     wave rebuilds it (lib/adminRoutes.js PAGE_HUB_TABS, pages/shellHubs.jsx).
//
// History: ORCH-1008 pruned six pages and ORCH-1014 two more; ORCH-1271..1274
// added the Business console; ISSUE-862 / #3697 the ads pages; ISSUE-3534
// Refund operations (a separate page from the read-only Money ledger: it
// retries, escalates and resolves); #3802 Waves 1 and 4 the pipelines, the
// Team dashboard (owner and admin only) and My agent; #3980 the Work board
// and Agent log, with Drafts to send relabelled To review and Content
// calendar relabelled Calendar (page ids unchanged); the #3980 synced program
// relabelled To review Needs you and Work board Work, and folded the Agent log
// into Work as a tab. #4130 Wave 0 cut the menu from 40 entries to 26 pages
// in nine groups (Home first); the retired ids redirect to the page that now
// holds them (lib/adminRoutes.js), My agent and Guide moved to the header.

export const NAV_GROUPS = [
  {
    label: "Home",
    items: [
      { id: "overview",                  label: "Dashboard",          icon: "LayoutDashboard" },
      // #4130: the Work entry carries the count of your own cards waiting on
      // you (Needs you was retired into Work's first column).
      { id: "work-board",                label: "Work",               icon: "SquareKanban" },
      { id: "notifications",             label: "Notifications",      icon: "Bell" },
    ],
  },
  {
    label: "Outreach",
    items: [
      { id: "outreach",                  label: "Hosts and creators", icon: "Handshake" },
      { id: "inbound",                   label: "Inbound leads",      icon: "Inbox" },
      { id: "content-calendar",          label: "Calendar",           icon: "CalendarClock" },
      { id: "team-dashboard",            label: "Team dashboard",     icon: "BarChart3" },
    ],
  },
  {
    label: "Support",
    items: [
      // #4130: both open the Community & Support console until Wave 6 splits it
      // (lib/adminRoutes.js RETIRED_PAGE_REDIRECTS).
      { id: "support",                   label: "Support",            icon: "LifeBuoy" },
      { id: "community",                 label: "Community",          icon: "MessagesSquare" },
    ],
  },
  {
    label: "Business",
    items: [
      { id: "people",                    label: "People",             icon: "Users" },
      { id: "brands",                    label: "Brands",             icon: "Building2" },
      { id: "business-offerings",        label: "Offerings",          icon: "CalendarDays" },
    ],
  },
  {
    label: "Money",
    items: [
      { id: "mingla-money",              label: "Mingla money",       icon: "Wallet" },
      { id: "business-payments",         label: "Payments",           icon: "CreditCard" },
      { id: "business-orders",           label: "Orders",             icon: "Receipt" },
      { id: "business-money-ledger",     label: "Money ledger",       icon: "Landmark" },
      { id: "refund-operations",         label: "Refund operations",  icon: "RotateCcw" },
      { id: "subscriptions",             label: "Subscriptions",      icon: "Repeat" },
      { id: "pricing",                   label: "Pricing and limits", icon: "Percent" },
    ],
  },
  {
    label: "Explorer app",
    items: [
      { id: "placepool",                 label: "Place pool",         icon: "Map" },
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
      { id: "data-room",                 label: "Data room",          icon: "FolderLock" },
    ],
  },
  {
    label: "System",
    items: [
      { id: "platform-health",           label: "Platform health",    icon: "HeartPulse" },
      { id: "feature-flags",             label: "Feature flags",      icon: "Flag" },
      { id: "settings",                  label: "Settings",           icon: "Settings" },
    ],
  },
];

// #4130: pages that are not in the menu but have a place in the header (My
// agent in the profile menu, Guide behind the ? help button). They keep
// their routes and their titles, and search still finds them.
export const HEADER_PAGE_ITEMS = [
  { id: "agent", label: "My agent" },
  { id: "guide", label: "Guide" },
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
