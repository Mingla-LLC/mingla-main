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
// ORCH-1008: flat single-group sidebar. Six pages deleted (Seed,
//   ContentModeration, Analytics, Reports, BetaFeedback, TableBrowser).
//   Settings + Users promoted out of System dropdown to top-level rail.
//   Invariant I-PROPOSED-ADMIN-SHELL-FLAT-NAVIGATION (PROPOSED) — single
//   group with label:null + no collapsible:true. See SPEC §3 Phase 1 + §5.
// ORCH-1014: photo-labeling + photo-scorer deleted (DEC-099 Cut 1 cleanup);
//   NAV is now 10 items.

export const NAV_GROUPS = [
  {
    label: null,
    items: [
      { id: "overview",                  label: "Dashboard",          icon: "LayoutDashboard" },
      { id: "subscriptions",             label: "Subscriptions",      icon: "CreditCard" },
      { id: "admin",                     label: "Admin Users",        icon: "Shield" },
      { id: "placepool",                 label: "Place Pool",         icon: "Globe" },
      // ORCH-1027: operator switch to declare cities live for consumer onboarding
      // (the ORCH-1028 location gate). Sits next to Place Pool — the consumer-facing
      // counterpart to the seeding/place tooling.
      { id: "launch-cities",             label: "Launch Cities",      icon: "Rocket" },
      { id: "signals",                   label: "Signal Library",     icon: "Activity" },
      // ORCH-1066: deck score tuner — search a live venue → set/pin its 16
      // category scores + preview its deck card + read its rank. Serving/ranking
      // tool, sits next to Signal Library + Intelligence Trial.
      { id: "deck-tuner",                label: "Deck tuner",         icon: "SlidersHorizontal" },
      { id: "place-intelligence-trial",  label: "Intelligence Trial", icon: "Microscope" },
      { id: "email",                     label: "Email",              icon: "Mail" },
      // ORCH-1045: read-only list of "Get Beta Access" leads from the organiser
      // marketing site. Operator growth tooling — sits next to Email.
      { id: "beta-leads",                label: "Beta Leads",         icon: "Inbox" },
      // ISSUE-1354: all free-tool submissions (tool_leads) + report detail. The
      // Wrench icon MUST be registered in Sidebar.jsx ICON_MAP or the nav item
      // silently falls back to LayoutDashboard (the documented ICON_MAP footgun).
      { id: "tool-leads",                label: "Tool Leads",         icon: "Wrench" },
      // META-ORCH-1222: careers applications + role manager. The Briefcase icon
      // MUST be registered in Sidebar.jsx ICON_MAP or the nav item silently
      // falls back to LayoutDashboard.
      { id: "careers",                   label: "Careers",            icon: "Briefcase" },
      // ORCH-1006: Mingla take-rate admin screen (global default + per-brand override).
      { id: "pricing",                   label: "Pricing",            icon: "Percent" },
      { id: "claims",                    label: "Venue claims",       icon: "ClipboardList" },
      // META-ORCH-1104 Phase 2 — admin support desk (tickets + agents). The
      // LifeBuoy icon MUST be registered in Sidebar.jsx ICON_MAP or the nav
      // item silently falls back to LayoutDashboard (Lane B finding).
      { id: "support",                   label: "Support",            icon: "LifeBuoy" },
      { id: "users",                     label: "Users",              icon: "Users" },
      // ORCH-1056: unified Stripe mode dashboard — verifies the three Stripe
      // signals (Supabase backend / web client pk / Vercel env) agree.
      { id: "stripe-mode",               label: "Stripe mode",        icon: "Wallet" },
      // ORCH-1201: API-health hub — live status of every external service Mingla
      // depends on (3-layer probe + email alerts). Ops tooling, sits with
      // stripe-mode/settings. The Activity icon is already in Sidebar ICON_MAP.
      { id: "api-health",                label: "API health",         icon: "Activity" },
      { id: "settings",                  label: "Settings",           icon: "Settings" },
    ],
  },
  // ORCH-1271: "Business" nav group — the META-ORCH-1237 admin full-visibility
  // console lives here. ORCH-1272 replaces the foundation scaffolding placeholder
  // with the first two real domain pages (People + Brands). Offerings / Venues
  // arrive in 1273; money arrives in 1274 as sibling entries.
  // ORCH-1273: Offerings (CalendarDays) + Venues (Store) — both icons MUST be
  // registered in Sidebar.jsx ICON_MAP or the item silently falls back to
  // LayoutDashboard.
  // ORCH-1274 [Admin Money console — READ-ONLY]: appends Payments / Orders /
  //   Money ledger. `CreditCard` is already in Sidebar.jsx ICON_MAP; `Receipt`
  //   and `Landmark` MUST be registered there too or they silently fall back to
  //   LayoutDashboard (the documented Careers/Support ICON_MAP footgun).
  {
    label: "Business",
    items: [
      { id: "business-people",           label: "People",             icon: "Users" },
      { id: "business-brands",           label: "Brands",             icon: "Building2" },
      { id: "brand-sites",               label: "Brand Sites",        icon: "Globe" },
      { id: "business-offerings",        label: "Offerings",          icon: "CalendarDays" },
      { id: "business-venues",           label: "Venues",             icon: "Store" },
      { id: "business-payments",         label: "Payments",           icon: "CreditCard" },
      { id: "business-orders",           label: "Orders",             icon: "Receipt" },
      { id: "business-money-ledger",     label: "Money ledger",       icon: "Landmark" },
    ],
  },
  // ISSUE-862 WP1: "Growth" nav group — the Full Rooms Ad Engine (5-channel,
  // Meta first). The Megaphone icon MUST be registered in Sidebar.jsx ICON_MAP
  // or the nav item silently falls back to LayoutDashboard (documented footgun).
  {
    label: "Growth",
    items: [
      { id: "ad-engine",                 label: "Ad Engine",          icon: "Megaphone" },
      // ISSUE-864 WP4 — the builder wizard + the campaign surface (launch/
      // pause/review live on Campaigns, never in the builder). Rocket +
      // ClipboardList are already registered in Sidebar.jsx ICON_MAP.
      { id: "campaign-builder",          label: "Campaign Builder",   icon: "Rocket" },
      { id: "campaigns",                 label: "Campaigns",          icon: "ClipboardList" },
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
