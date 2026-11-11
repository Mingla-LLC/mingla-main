/**
 * #3988 — the Community & Support tab contract. #4383: the screen and tab
 * contract — every row names the `page` that shows it: "support" or
 * "community" for a tab of those pages, or the row's own page id for a
 * Communications screen (Email, Blog, Links page, Announcements, Roadmap,
 * Overview, Push).
 *
 * #4130 Wave 6: the tabs now sit on two pages, Support and Community
 * (lib/supportCommunityTabs.js); every row keeps its area. The Overview tab
 * was retired (its ticket count disagreed with the inbox).
 *
 * One row per tab: the access area that shows it, the panel file that renders
 * it, and every server RPC / Edge Function that panel reaches (directly or
 * through the service functions it imports). The server computes each area
 * from the same predicate those RPCs use as their guard
 * (issue_3988_capabilities → admin_team_my_operational_areas), so a tab that
 * is shown always loads. The regression suite reads this file and fails when
 * a tab or an RPC is added without updating it.
 *
 * Pure module: no imports, so the Deno suite can load it directly.
 */

const ADMIN = "admin_console";
const COMMUNITY = "community_support_community";
const SUPPORT = "community_support_support";
// #4255: every active teammate (server: admin_team_role_areas, and
// issue_4137_blog_can_write via admin_team_my_operational_areas).
const EMAIL_DRAFTS = "email_drafts";
const BLOG = "blog";

export const COMMUNITY_SUPPORT_TAB_CONTRACT = Object.freeze({
  announcements: Object.freeze({
    page: "announcements",
    area: ADMIN,
    panel: "components/community/AnnouncementsPanel.jsx",
    rpcs: Object.freeze([
      "community_archive_announcement",
      "community_publish_announcement",
      "community_upsert_announcement",
      "issue_3720_admin_announcement_deliveries",
      "issue_3720_admin_list_roadmap_cards",
      "issue_3720_admin_retry_announcement",
      "issue_3720_admin_upsert_announcement",
    ]),
    functions: Object.freeze([]),
  }),
  roadmap: Object.freeze({
    page: "roadmap",
    area: ADMIN,
    panel: "components/community/RoadmapPanel.jsx",
    rpcs: Object.freeze([
      "community_get_roadmap_notification_status",
      "community_notify_roadmap_change",
      "community_reorder_roadmap",
      "community_roadmap_notification_preview",
      "community_upsert_roadmap_card",
      "issue_3720_admin_list_roadmap_cards",
    ]),
    functions: Object.freeze([]),
  }),
  ideas: Object.freeze({
    page: "community",
    area: COMMUNITY,
    panel: "components/community/IdeasPanel.jsx",
    rpcs: Object.freeze(["issue_3720_admin_list_posts", "issue_3720_admin_update_idea"]),
    functions: Object.freeze([]),
  }),
  questions: Object.freeze({
    page: "community",
    area: COMMUNITY,
    panel: "components/community/QuestionsPanel.jsx",
    rpcs: Object.freeze(["issue_3720_admin_list_posts", "issue_3720_admin_question_action"]),
    functions: Object.freeze([]),
  }),
  moderation: Object.freeze({
    page: "community",
    area: COMMUNITY,
    panel: "components/community/ModerationPanel.jsx",
    rpcs: Object.freeze(["issue_3720_admin_moderate", "issue_3720_admin_moderation_workspace"]),
    functions: Object.freeze([]),
  }),
  // #4111 — guarded by issue_4111_is_mingla_staff (active admin_users OR
  // is_support_staff), which is exactly community_can('moderate').
  "enquiry-reports": Object.freeze({
    page: "community",
    area: COMMUNITY,
    panel: "components/community/ReportedEnquiriesPanel.jsx",
    rpcs: Object.freeze([
      "admin_enquiry_block_everywhere",
      "admin_enquiry_dismiss_report",
      "admin_list_reported_enquiries",
    ]),
    functions: Object.freeze([]),
  }),
  support: Object.freeze({
    page: "support",
    area: SUPPORT,
    panel: "pages/SupportDeskPage.jsx",
    rpcs: Object.freeze([
      "issue_3720_update_internal_thread",
      "issue_3988_reassign_internal_thread",
    ]),
    functions: Object.freeze(["support-claim", "support-send", "support-set-status"]),
  }),
  product: Object.freeze({
    page: "community",
    area: ADMIN,
    panel: "components/community/ProductInboxPanel.jsx",
    rpcs: Object.freeze([
      "issue_3720_approve_product_customer_draft",
      "issue_3720_queue_product_avengers_command",
      "issue_3720_record_product_avengers_candidate",
      "issue_3720_save_product_avengers_review",
      "issue_3720_save_product_roadmap_wording",
      "issue_3720_set_product_avengers_no_fit",
      "issue_3720_verify_product_release",
    ]),
    functions: Object.freeze(["product-avengers-sync"]),
  }),
  "feature-guide": Object.freeze({
    page: "community",
    area: SUPPORT,
    panel: "components/community/FeatureGuidePanel.jsx",
    // Writing evidence and capabilities stays Admin-only (canManage).
    adminOnlyRpcs: Object.freeze(["issue_3720_record_feature_evidence", "issue_3720_save_feature_capability"]),
    rpcs: Object.freeze([
      "issue_3720_list_feature_guide",
      "issue_3720_record_feature_evidence",
      "issue_3720_save_feature_capability",
      "issue_4179_feature_guide_freshness",
    ]),
    functions: Object.freeze([]),
  }),
  "brand-groups": Object.freeze({
    page: "community",
    area: SUPPORT,
    panel: "components/community/BrandGroupsPanel.jsx",
    // #4270 W7: the staff inbox (who waits, the brand team) and #4304's
    // Seen by. Host card, plan and Calendar reads stay in the rail and the
    // side panel (Hosts and Creators access), not in this tab's own calls.
    rpcs: Object.freeze([
      "issue_3720_list_brand_group_messages",
      "issue_3720_list_brand_groups",
      "issue_3720_mark_brand_group_read",
      "issue_3720_prepare_brand_group_files",
      "issue_3720_send_brand_group_message",
      "issue_3988_set_brand_group_muted",
      "issue_4270_brand_group_inbox",
      "issue_4270_brand_group_people",
      "issue_4304_list_brand_group_read_state",
    ]),
    functions: Object.freeze(["brand-group-files"]),
  }),
  email: Object.freeze({
    page: "email",
    area: EMAIL_DRAFTS,
    panel: "pages/EmailPage.jsx",
    // The panel reaches admin-send-email through its own fetch helper and the
    // shared drafts through components/email (lib/emailDrafts.js); both let
    // any active teammate in (#4255 D5).
    rpcs: Object.freeze([]),
    functions: Object.freeze([]),
  }),
  blog: Object.freeze({
    page: "blog",
    area: BLOG,
    panel: "components/blog/BlogPanel.jsx",
    rpcs: Object.freeze([
      "issue_4137_blog_create_post",
      "issue_4137_blog_create_preview_token",
      "issue_4137_blog_delete_media",
      "issue_4137_blog_delete_post",
      "issue_4137_blog_featured_now",
      "issue_4137_blog_get_post",
      "issue_4137_blog_list_media",
      "issue_4137_blog_list_posts",
      "issue_4137_blog_my_permissions",
      "issue_4137_blog_publish",
      "issue_4137_blog_register_media",
      "issue_4137_blog_request_changes",
      "issue_4137_blog_save_draft",
      "issue_4137_blog_search_link_targets",
      "issue_4137_blog_set_featured",
      "issue_4137_blog_submit_for_review",
      "issue_4137_blog_unpublish",
      "issue_4137_blog_update_media",
    ]),
    functions: Object.freeze(["admin-blog"]),
  }),
  // #4318 — Links page strips. Its admin_links_* RPCs guard on
  // is_support_staff (the Support area's own predicate), so the tab follows
  // the Support area; the blog picker reuses the Blog tab's post reader,
  // which every active teammate may call.
  links: Object.freeze({
    page: "links",
    area: SUPPORT,
    panel: "components/links/LinksPagePanel.jsx",
    rpcs: Object.freeze([
      "admin_links_strip_delete",
      "admin_links_strip_save",
      "admin_links_strips_list",
      "admin_links_strips_reorder",
      "issue_4137_blog_list_posts",
    ]),
    // refreshLinksPage: admin-blog "revalidate_links" after each saved change.
    functions: Object.freeze(["admin-blog"]),
  }),
  // #4383 — the Communications Overview screen. Its area is only the default
  // (admin_console); lib/access.js opens it to whoever can open any of its
  // screens and the server lists only the kinds that person may see.
  communications: Object.freeze({
    page: "communications",
    area: ADMIN,
    panel: "pages/communications/CommunicationsOverviewPage.jsx",
    rpcs: Object.freeze([]),
    functions: Object.freeze([]),
  }),
  team: Object.freeze({
    page: "support",
    area: ADMIN,
    panel: "components/community/TeamRolesPanel.jsx",
    rpcs: Object.freeze([
      "issue_3988_admin_people",
      "issue_3988_remove_orphan_staff",
      "issue_3988_set_permissions",
    ]),
    functions: Object.freeze(["admin-team-invite"]),
  }),
});

/** #4383: the rows that are a tab of the Support or Community page. */
export const SUPPORT_COMMUNITY_TAB_ROWS = Object.freeze(
  Object.keys(COMMUNITY_SUPPORT_TAB_CONTRACT).filter((id) =>
    ["support", "community"].includes(COMMUNITY_SUPPORT_TAB_CONTRACT[id].page)),
);

/** #4383: the rows that are a Communications screen of their own. */
export const COMMUNICATIONS_SCREEN_ROWS = Object.freeze(
  Object.keys(COMMUNITY_SUPPORT_TAB_CONTRACT).filter((id) =>
    !["support", "community"].includes(COMMUNITY_SUPPORT_TAB_CONTRACT[id].page)),
);

/** tab id → the access area that shows it (used by communitySupportAccess). */
export const COMMUNITY_SUPPORT_TAB_AREA = Object.freeze(
  Object.fromEntries(
    Object.entries(COMMUNITY_SUPPORT_TAB_CONTRACT).map(([tab, row]) => [tab, row.area]),
  ),
);
