/**
 * #3988 — the Community & Support tab contract.
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

export const COMMUNITY_SUPPORT_TAB_CONTRACT = Object.freeze({
  announcements: Object.freeze({
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
    area: COMMUNITY,
    panel: "components/community/IdeasPanel.jsx",
    rpcs: Object.freeze(["issue_3720_admin_list_posts", "issue_3720_admin_update_idea"]),
    functions: Object.freeze([]),
  }),
  questions: Object.freeze({
    area: COMMUNITY,
    panel: "components/community/QuestionsPanel.jsx",
    rpcs: Object.freeze(["issue_3720_admin_list_posts", "issue_3720_admin_question_action"]),
    functions: Object.freeze([]),
  }),
  moderation: Object.freeze({
    area: COMMUNITY,
    panel: "components/community/ModerationPanel.jsx",
    rpcs: Object.freeze(["issue_3720_admin_moderate", "issue_3720_admin_moderation_workspace"]),
    functions: Object.freeze([]),
  }),
  // #4111 — guarded by issue_4111_is_mingla_staff (active admin_users OR
  // is_support_staff), which is exactly community_can('moderate').
  "enquiry-reports": Object.freeze({
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
    area: SUPPORT,
    panel: "pages/SupportDeskPage.jsx",
    rpcs: Object.freeze([
      "issue_3720_update_internal_thread",
      "issue_3988_reassign_internal_thread",
    ]),
    functions: Object.freeze(["support-claim", "support-send", "support-set-status"]),
  }),
  product: Object.freeze({
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
    area: SUPPORT,
    panel: "components/community/FeatureGuidePanel.jsx",
    // Writing evidence and capabilities stays Admin-only (canManage).
    adminOnlyRpcs: Object.freeze(["issue_3720_record_feature_evidence", "issue_3720_save_feature_capability"]),
    rpcs: Object.freeze([
      "issue_3720_list_feature_guide",
      "issue_3720_record_feature_evidence",
      "issue_3720_save_feature_capability",
    ]),
    functions: Object.freeze([]),
  }),
  "brand-groups": Object.freeze({
    area: SUPPORT,
    panel: "components/community/BrandGroupsPanel.jsx",
    rpcs: Object.freeze([
      "issue_3720_list_brand_group_messages",
      "issue_3720_list_brand_groups",
      "issue_3720_mark_brand_group_read",
      "issue_3720_prepare_brand_group_files",
      "issue_3720_send_brand_group_message",
      "issue_3988_set_brand_group_muted",
    ]),
    functions: Object.freeze(["brand-group-files"]),
  }),
  email: Object.freeze({
    area: ADMIN,
    panel: "pages/EmailPage.jsx",
    rpcs: Object.freeze([]),
    functions: Object.freeze([]),
  }),
  blog: Object.freeze({
    area: SUPPORT,
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
  team: Object.freeze({
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

/** tab id → the access area that shows it (used by communitySupportAccess). */
export const COMMUNITY_SUPPORT_TAB_AREA = Object.freeze(
  Object.fromEntries(
    Object.entries(COMMUNITY_SUPPORT_TAB_CONTRACT).map(([tab, row]) => [tab, row.area]),
  ),
);
