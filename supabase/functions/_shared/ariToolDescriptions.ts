// Issue #3355 Wave B (B3) — generated tool descriptions.
//
// The system prompt is principles only. What the model knows about a tool
// comes from that tool's declaration, generated here from:
//   * the tool's own description and its one-line capability text;
//   * the tool-specific rules moved verbatim out of the prompt
//     (ARI_TOOL_RULES in agentSystemPrompt.ts);
//   * its JSON schema (required arguments, choices, read or write);
//   * its Feature Guide entry (TOOL_CAPABILITY_KEYS), so Ari can look the
//     host-facing steps up with search_mingla_guide.
// Tool selection and ranking (agentToolsets.ts) still read the registry's
// short descriptions; only what is sent to the model is generated.

import { ARI_TOOL_RULES, ariCapabilityLine } from "./agentSystemPrompt.ts";

/**
 * The Feature Guide entry (public.product_capabilities.capability_key) each
 * tool's host-facing feature lives under. A static map; the Wave B test
 * checks every key against the checked-in guide seeds.
 */
export const TOOL_CAPABILITY_KEYS: Readonly<Record<string, string>> = Object
  .freeze({
    create_brand: "brand-create",
    update_brand: "brand-profile",
    delete_brand: "brand-profile",
    list_brand_audit_log: "brand-audit-log",
    manage_brand_discovery_currency: "money-currencies",
    set_brand_payout_country: "money-currencies",
    create_event: "events-create",
    update_event: "events-edit-live",
    patch_event_when: "events-edit-live",
    publish_event: "events-create",
    unpublish_event: "events-visibility",
    cancel_event: "events-cancel-refund-all",
    set_event_cover: "events-cover-media",
    set_event_guest_privacy: "events-guest-list",
    upsert_ticket_tier: "events-ticket-types",
    set_pricing_switches: "events-fees-and-tax",
    set_brand_pricing_defaults: "brand-pricing-defaults",
    manage_event_door_sale: "events-door-sales",
    manage_event_group_chat: "events-group-chat",
    manage_event_waitlist: "events-tier-waitlist",
    manage_event_scanners: "events-scanner-team",
    invite_scanner: "events-scanner-team",
    revoke_scanner_invitation: "events-scanner-team",
    list_event_orders: "events-orders-refunds",
    get_event_order_reconciliation: "events-reconciliation",
    list_guest_roster: "events-guest-list",
    refund_order: "events-orders-refunds",
    cancel_order: "events-orders-refunds",
    get_order_refund_preview: "events-orders-refunds",
    set_refund_policy: "offerings-refund-policy",
    get_buyer_notice_status: "events-update-email",
    list_discounts: "events-discount-codes",
    create_discount: "events-discount-codes",
    pause_discount: "events-discount-codes",
    resume_discount: "events-discount-codes",
    end_discount: "events-discount-codes",
    create_experience: "experiences-create",
    update_experience: "experiences-create",
    manage_experience_stops: "experiences-create",
    publish_experience: "experiences-create",
    unpublish_experience: "experiences-create",
    delete_experience: "experiences-create",
    create_trip: "trips-create",
    update_trip: "trips-create",
    manage_trip_days: "trips-create",
    manage_trip_inclusions: "trips-create",
    manage_trip_tiers: "trips-create",
    manage_trip_traveler_intake: "trips-intake-forms",
    publish_trip: "trips-create",
    delete_trip: "trips-create",
    cancel_trip_booking: "trips-cancel-booking",
    list_trip_installments: "trips-installments",
    retry_installment: "trips-installments",
    charge_installment_now: "trips-installments",
    send_installment_reminder: "trips-installments",
    create_rsvp: "rsvp-create",
    update_rsvp: "rsvp-create",
    publish_rsvp: "rsvp-create",
    set_rsvp_guest_status: "rsvp-approvals",
    update_rsvp_contribution_settings: "rsvp-chip-in",
    refund_rsvp_contribution: "rsvp-chip-in",
    manage_stay_inventory: "stays-hosting",
    publish_stay: "stays-hosting",
    manage_stay_policy_price_media: "stays-hosting",
    quote_stay: "stays-hosting",
    create_stay_reservation: "stays-hosting",
    transition_stay: "stays-hosting",
    create_venue_listing: "venues-claim-or-add",
    submit_venue_claim: "venues-claim-or-add",
    mark_claim_feedback_fixed: "venues-claim-or-add",
    list_venue_listings: "venues-claim-or-add",
    get_venue_listing_status: "venues-go-live-readiness",
    list_venue_claim_feedback: "venues-claim-or-add",
    manage_venue_menu: "venues-menu",
    venue_ops_action: "venues-qr-ordering",
    manage_venue_availability: "venues-reservations",
    create_venue_reservation: "venues-reservations",
    transition_venue_reservation: "venues-reservations",
    get_reservation_metrics: "venues-insights",
    manage_venue_waitlist: "venues-waitlist-text",
    send_venue_sms: "venues-waitlist-text",
    draft_campaign: "marketing-campaigns",
    update_campaign_draft: "marketing-campaigns",
    delete_campaign_draft: "marketing-campaigns",
    schedule_campaign: "marketing-campaigns",
    send_campaign_now: "marketing-campaigns",
    cancel_campaign: "marketing-campaigns",
    get_campaign_report: "marketing-campaigns",
    get_campaign_draft: "marketing-campaigns",
    manage_marketing_templates: "marketing-templates",
    manage_marketing_audiences: "marketing-people",
    manage_brand_people: "marketing-people",
    export_brand_people: "marketing-people",
    list_ad_audiences: "marketing-host-ads",
    propose_ad_plan: "marketing-host-ads",
    approve_ad_plan: "marketing-host-ads",
    pause_ad_campaign: "marketing-host-ads",
    end_ad_campaign: "marketing-host-ads",
    get_ad_campaign_report: "marketing-host-ads",
    get_brand_analytics: "marketing-analytics",
    get_listing_conversion: "marketing-analytics",
    list_referral_offers: "programs-creators",
    create_referral_offer: "programs-creators",
    invite_promoters: "programs-creators",
    draft_gig_script: "programs-creators",
    get_payout_status: "payouts-stripe",
    get_tax_status: "payouts-tax-registrations",
    get_brand_balances_reports: "payouts-balances-reports",
    get_partner_status: "payouts-partner-program",
    disconnect_partner: "payouts-partner-program",
    list_partner_brand_links: "payouts-partner-program",
    list_partner_splits: "payouts-partner-program",
    invite_brand_member: "brand-team-roles",
    revoke_brand_member: "brand-team-roles",
    revoke_brand_invitation: "brand-team-roles",
    list_brand_team: "brand-team-roles",
    tell_owner_in_brand_group: "official-brand-groups",
    update_notification_prefs: "account-notification-settings",
    manage_business_notifications: "account-notification-settings",
    edit_profile_avatar: "account-settings",
    request_account_deletion: "account-delete",
    create_support_ticket: "help-support",
    manage_support_inbox: "help-support",
    get_brand_site: "sites-brand-website",
    get_site_plan: "sites-brand-website",
    create_site_draft: "sites-brand-website",
    publish_site: "sites-brand-website",
    search_mingla_guide: "ari-host-assistant",
    search_capabilities: "ari-host-assistant",
    get_brand_readiness: "ari-host-assistant",
    open_handoff: "ari-host-assistant",
  });

interface DeclarableTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface SchemaProperty {
  type?: unknown;
  enum?: unknown;
}

const MAX_ENUM = 8;
const MAX_ARGS = 14;

/** "Required: brand_id, title. Choices: action = list | get | add." */
export function describeAriToolSchema(
  parameters: Record<string, unknown>,
): string {
  const properties = parameters?.properties &&
      typeof parameters.properties === "object"
    ? parameters.properties as Record<string, SchemaProperty>
    : {};
  const required = Array.isArray(parameters?.required)
    ? (parameters.required as unknown[]).filter((item): item is string =>
      typeof item === "string"
    )
    : [];
  const parts: string[] = [];
  if (required.length > 0) parts.push(`Required: ${required.join(", ")}.`);
  const optional = Object.keys(properties).filter((key) =>
    !required.includes(key)
  ).slice(0, MAX_ARGS);
  if (optional.length > 0) parts.push(`Optional: ${optional.join(", ")}.`);
  const choices = Object.entries(properties).flatMap(([key, value]) =>
    Array.isArray(value?.enum) && value.enum.length > 0 &&
      value.enum.length <= MAX_ENUM
      ? [`${key} = ${value.enum.map(String).join(" | ")}`]
      : []
  );
  if (choices.length > 0) parts.push(`Choices: ${choices.join("; ")}.`);
  return parts.join(" ");
}

/** The description the model reads for one tool. */
export function describeAriTool(tool: DeclarableTool): string {
  const parts = [tool.description.trim()];
  const line = ariCapabilityLine(tool.name);
  if (line && !tool.description.includes(line)) parts.push(`(${line}.)`);
  for (const rule of ARI_TOOL_RULES[tool.name] ?? []) parts.push(rule);
  const schema = describeAriToolSchema(tool.parameters);
  if (schema) parts.push(schema);
  const key = TOOL_CAPABILITY_KEYS[tool.name];
  if (key) parts.push(`Feature Guide: ${key}.`);
  return parts.join(" ");
}

/** Gemini declarations for the tools offered this turn. */
export function ariToolDeclarations(
  tools: readonly DeclarableTool[],
): DeclarableTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: describeAriTool(tool),
    parameters: tool.parameters,
  }));
}
