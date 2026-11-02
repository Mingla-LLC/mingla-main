/**
 * Issue #3355 P1 (D-5) — the owner words for every Ari write.
 *
 * One row per write tool: `verb` is the small heading on the confirmation
 * card, `title` the card title when the proposal carries no name of its own,
 * `done` the receipt title after it saved. Generalises the #2830
 * `websiteSetupProposalCopy.ts` approach from four Website tools to all of
 * them, so no card ever falls back to a tool name.
 *
 * The Host mirrors this table in
 * `mingla-business/src/components/ari/toolProposalCopy.ts` (fallback for a
 * proposal saved before the server attached its presentation). The parity
 * test `_shared/__tests__/issue_3355_turn_hygiene.implementor.test.ts`
 * requires: every registered write tool has a row here, every row is
 * copy-gate clean, and the Host table carries the same words.
 */

export interface ToolOwnerCopy {
  verb: string;
  title: string;
  done: string;
}

function row(verb: string, title: string, done: string): ToolOwnerCopy {
  return { verb, title, done };
}

export const WRITE_TOOL_OWNER_COPY: Readonly<Record<string, ToolOwnerCopy>> =
  Object.freeze({
    // Brand
    create_brand: row("Create brand", "New brand", "Brand created"),
    update_brand: row("Update brand", "Brand update", "Brand updated"),
    delete_brand: row("Delete brand", "This brand", "Brand deleted"),
    manage_brand_hours: row(
      "Update opening hours",
      "Opening hours",
      "Opening hours saved",
    ),
    manage_brand_discovery_currency: row(
      "Update brand currency",
      "Brand currency",
      "Brand currency saved",
    ),
    update_brand_context: row(
      "Save to your brand",
      "Save your brand details",
      "Brand details saved",
    ),
    // #3355 P2 — brand-wide "not now" on one checklist item.
    defer_readiness_item: row(
      "Not now for this brand",
      "Set this aside for now",
      "Set aside for now",
    ),
    undefer_readiness_item: row(
      "Back on Ari's list",
      "Ask about this again",
      "Back on Ari's list",
    ),
    // #3355 P6 follow-up — "Tell them" posts in the brand group chat.
    // #3355 P7 — the payout country (and so the price currency) from Ari.
    set_brand_payout_country: row(
      "Set payout country",
      "Prices for this brand",
      "Payout country saved",
    ),
    tell_owner_in_brand_group: row(
      "Message the owner",
      "Tell the owner",
      "Owner told in the group chat",
    ),
    set_brand_pricing_defaults: row(
      "Update pricing defaults",
      "Pricing defaults",
      "Pricing defaults saved",
    ),
    edit_profile_avatar: row(
      "Update profile photo",
      "Profile photo",
      "Profile photo saved",
    ),
    // Events
    create_event: row("Create event", "New event", "Event draft saved"),
    update_event: row("Update event", "Event update", "Event updated"),
    publish_event: row(
      "Publish event",
      "Publish this event",
      "Event published",
    ),
    unpublish_event: row(
      "Unpublish event",
      "Take this event offline",
      "Event unpublished",
    ),
    cancel_event: row("Cancel event", "Cancel this event", "Event cancelled"),
    end_event_sales: row(
      "End ticket sales",
      "Stop selling tickets",
      "Ticket sales ended",
    ),
    duplicate_event: row("Duplicate event", "Copy this event", "Event copied"),
    patch_event_when: row(
      "Change event date",
      "New date and time",
      "Event date updated",
    ),
    set_event_cover: row("Set event cover", "Event cover", "Event cover saved"),
    set_event_guest_privacy: row(
      "Update guest privacy",
      "Guest list privacy",
      "Guest privacy saved",
    ),
    discard_event_draft: row(
      "Discard draft",
      "Discard this draft",
      "Draft discarded",
    ),
    upsert_ticket_tier: row("Update tickets", "Ticket type", "Tickets saved"),
    set_pricing_switches: row(
      "Update pricing",
      "Fees and tax",
      "Pricing saved",
    ),
    manage_event_group_chat: row(
      "Update event chat",
      "Event group chat",
      "Event chat updated",
    ),
    manage_event_door_sale: row(
      "Update door sales",
      "Door sales",
      "Door sales updated",
    ),
    manage_event_waitlist: row(
      "Update waitlist",
      "Event waitlist",
      "Waitlist updated",
    ),
    manage_event_scanners: row(
      "Update scanners",
      "Event scanners",
      "Scanners updated",
    ),
    set_refund_policy: row(
      "Set refund policy",
      "Refund policy",
      "Refund policy saved",
    ),
    // Experiences
    create_experience: row(
      "Create experience",
      "New experience",
      "Experience draft saved",
    ),
    update_experience: row(
      "Update experience",
      "Experience update",
      "Experience updated",
    ),
    publish_experience: row(
      "Publish experience",
      "Publish this experience",
      "Experience published",
    ),
    unpublish_experience: row(
      "Unpublish experience",
      "Take this experience offline",
      "Experience unpublished",
    ),
    delete_experience: row(
      "Delete experience",
      "Delete this experience",
      "Experience deleted",
    ),
    manage_experience_stops: row(
      "Update experience stops",
      "Experience stops",
      "Stops updated",
    ),
    // Trips
    create_trip: row("Create trip", "New trip", "Trip draft saved"),
    update_trip: row("Update trip", "Trip update", "Trip updated"),
    manage_trip_days: row(
      "Update trip days",
      "Trip itinerary",
      "Itinerary updated",
    ),
    manage_trip_inclusions: row(
      "Update what's included",
      "What's included",
      "Inclusions updated",
    ),
    manage_trip_tiers: row(
      "Update trip prices",
      "Trip price options",
      "Trip prices updated",
    ),
    manage_trip_traveler_intake: row(
      "Update traveller questions",
      "Traveller questions",
      "Traveller questions updated",
    ),
    publish_trip: row("Publish trip", "Publish this trip", "Trip published"),
    delete_trip: row("Delete trip", "Delete this trip", "Trip deleted"),
    cancel_trip_booking: row(
      "Cancel trip booking",
      "Cancel this booking",
      "Booking cancelled",
    ),
    // RSVPs
    create_rsvp: row("Create RSVP page", "New RSVP page", "RSVP page saved"),
    update_rsvp: row("Update RSVP page", "RSVP update", "RSVP page updated"),
    publish_rsvp: row(
      "Publish RSVP page",
      "Publish this RSVP page",
      "RSVP page published",
    ),
    update_rsvp_contribution_settings: row(
      "Update contributions",
      "Guest contributions",
      "Contributions updated",
    ),
    set_rsvp_guest_status: row("Update guest", "Guest status", "Guest updated"),
    refund_rsvp_contribution: row(
      "Refund contribution",
      "Refund this contribution",
      "Contribution refunded",
    ),
    // Stays and venues
    create_stay_reservation: row(
      "Create stay booking",
      "New stay booking",
      "Stay booking created",
    ),
    transition_stay: row(
      "Update stay booking",
      "Stay booking",
      "Stay booking updated",
    ),
    create_venue_reservation: row(
      "Create reservation",
      "New reservation",
      "Reservation created",
    ),
    transition_venue_reservation: row(
      "Update reservation",
      "Reservation",
      "Reservation updated",
    ),
    manage_stay_inventory: row(
      "Update stay availability",
      "Stay availability",
      "Stay availability updated",
    ),
    publish_stay: row("Publish stay", "Publish this stay", "Stay published"),
    manage_stay_policy_price_media: row(
      "Update stay details",
      "Stay prices and policies",
      "Stay details updated",
    ),
    create_venue_listing: row("Add venue", "New venue", "Venue submitted"),
    submit_venue_claim: row(
      "Claim venue",
      "Claim this venue",
      "Venue claim sent",
    ),
    mark_claim_feedback_fixed: row(
      "Mark feedback fixed",
      "Venue claim feedback",
      "Feedback marked fixed",
    ),
    venue_ops_action: row("Update venue", "Venue update", "Venue updated"),
    send_venue_sms: row(
      "Send text message",
      "Text message to a guest",
      "Text message sent",
    ),
    manage_venue_availability: row(
      "Update venue availability",
      "Venue availability",
      "Venue availability updated",
    ),
    manage_venue_menu: row("Update menu", "Venue menu", "Menu updated"),
    manage_venue_waitlist: row(
      "Update venue waitlist",
      "Venue waitlist",
      "Venue waitlist updated",
    ),
    manage_venue_gallery: row(
      "Update venue photos",
      "Venue photos",
      "Venue photos updated",
    ),
    // Marketing
    draft_campaign: row(
      "Draft campaign",
      "New campaign",
      "Campaign draft saved",
    ),
    update_campaign_draft: row(
      "Update campaign",
      "Campaign draft",
      "Campaign draft updated",
    ),
    delete_campaign_draft: row(
      "Delete campaign draft",
      "Delete this draft",
      "Campaign draft deleted",
    ),
    schedule_campaign: row(
      "Schedule campaign",
      "Schedule this campaign",
      "Campaign scheduled",
    ),
    send_campaign_now: row(
      "Send campaign",
      "Send this campaign now",
      "Campaign sent",
    ),
    cancel_campaign: row(
      "Cancel campaign",
      "Cancel this campaign",
      "Campaign cancelled",
    ),
    create_discount: row("Create discount", "New discount", "Discount created"),
    pause_discount: row(
      "Pause discount",
      "Pause this discount",
      "Discount paused",
    ),
    create_referral_offer: row(
      "Create referral offer",
      "New referral offer",
      "Referral offer created",
    ),
    invite_promoters: row(
      "Invite promoters",
      "Promoter invites",
      "Promoters invited",
    ),
    manage_marketing_audiences: row(
      "Update audience",
      "Marketing audience",
      "Audience updated",
    ),
    manage_marketing_templates: row(
      "Update template",
      "Marketing template",
      "Template updated",
    ),
    run_growth_tool: row("Run growth step", "Growth step", "Growth step done"),
    disconnect_partner: row(
      "Disconnect partner",
      "Disconnect this partner",
      "Partner disconnected",
    ),
    // Ads
    propose_ad_plan: row("Plan Host ad", "Host ad plan", "Ad plan saved"),
    approve_ad_plan: row("Launch Host ad", "Launch this ad", "Ad launched"),
    pause_ad_campaign: row("Pause Host ad", "Pause this ad", "Ad paused"),
    end_ad_campaign: row("End Host ad", "End this ad", "Ad ended"),
    // Orders and money
    refund_order: row("Refund order", "Refund this order", "Order refunded"),
    cancel_order: row(
      "Cancel free order",
      "Cancel this order",
      "Order cancelled",
    ),
    retry_installment: row(
      "Retry payment",
      "Retry this payment",
      "Payment retried",
    ),
    charge_installment_now: row(
      "Charge payment now",
      "Charge this payment",
      "Payment charged",
    ),
    send_installment_reminder: row(
      "Send payment reminder",
      "Payment reminder",
      "Reminder sent",
    ),
    // Team and people
    invite_brand_member: row(
      "Invite team member",
      "Team invite",
      "Invite sent",
    ),
    invite_scanner: row("Invite scanner", "Scanner invite", "Scanner invited"),
    revoke_brand_member: row(
      "Remove team member",
      "Remove from team",
      "Team member removed",
    ),
    revoke_brand_invitation: row(
      "Cancel team invite",
      "Cancel this invite",
      "Invite cancelled",
    ),
    revoke_scanner_invitation: row(
      "Cancel scanner invite",
      "Cancel this invite",
      "Scanner invite cancelled",
    ),
    manage_brand_people: row(
      "Update Brand People",
      "Brand People",
      "Brand People updated",
    ),
    export_brand_people: row(
      "Export Brand People",
      "Export your contacts",
      "Contacts exported",
    ),
    // Account, support and preferences
    manage_ari_history: row(
      "Update Ari history",
      "Ari history",
      "Ari history updated",
    ),
    manage_business_notifications: row(
      "Update notifications",
      "Notifications",
      "Notifications updated",
    ),
    manage_support_inbox: row(
      "Update support inbox",
      "Support inbox",
      "Support inbox updated",
    ),
    update_ari_prefs: row(
      "Update Ari settings",
      "Ari settings",
      "Ari settings saved",
    ),
    update_notification_prefs: row(
      "Update notification settings",
      "Notification settings",
      "Notification settings saved",
    ),
    create_support_ticket: row(
      "Contact support",
      "Message to support",
      "Support request sent",
    ),
    request_account_deletion: row(
      "Delete account",
      "Delete your account",
      "Account deletion requested",
    ),
    update_onboarding_plan: row(
      "Update your setup plan",
      "Setup plan",
      "Setup plan updated",
    ),
    save_memory_note: row(
      "Remember this",
      "Something to remember",
      "Saved to memory",
    ),
    forget_memory_note: row("Forget this", "Forget a note", "Note forgotten"),
    // Website
    save_site_plan_answers: row(
      "Save to your Website plan",
      "Save your answer",
      "Website plan saved",
    ),
    save_site_plan_design: row(
      "Save to your Website plan",
      "Save your design",
      "Website design saved",
    ),
    create_site_draft: row(
      "Build your Website",
      "Build your draft pages",
      "Draft pages built",
    ),
    propose_site_composition: row(
      "Update Website layout",
      "Website layout",
      "Layout saved as a draft",
    ),
    propose_block_variant: row(
      "Update Website section",
      "Website section",
      "Section saved as a draft",
    ),
    propose_site_tokens: row(
      "Update Website style",
      "Website style",
      "Style saved as a draft",
    ),
    propose_site_copy: row(
      "Update Website words",
      "Website words",
      "Words saved as a draft",
    ),
    propose_site_imagery: row(
      "Update Website images",
      "Website images",
      "Images saved as a draft",
    ),
    propose_site_collection_entry: row(
      "Update Website list",
      "Website list item",
      "List item saved as a draft",
    ),
    confirm_site_review: row(
      "Approve Website review",
      "Website review",
      "Review approved",
    ),
    propose_trip_guide_update: row(
      "Update trip guide",
      "Trip guide",
      "Trip guide saved as a draft",
    ),
    propose_site_content_update: row(
      "Confirm Website draft",
      "Website draft change",
      "Website draft saved",
    ),
    propose_site_settings_update: row(
      "Confirm Website settings draft",
      "Website settings",
      "Website settings saved",
    ),
    attach_approved_site_media: row(
      "Confirm Website image",
      "Website image",
      "Website image saved",
    ),
    create_site_preview: row(
      "Create private preview",
      "Private preview",
      "Private preview ready",
    ),
    publish_site: row(
      "Publish Website",
      "Publish your Website",
      "Website published",
    ),
    rollback_site: row(
      "Publish earlier Website version",
      "Earlier Website version",
      "Earlier version published",
    ),
  });

/** Owner words for a tool, or the neutral row when a tool has none. */
export function toolOwnerCopy(toolName: string): ToolOwnerCopy {
  return Object.prototype.hasOwnProperty.call(WRITE_TOOL_OWNER_COPY, toolName)
    ? WRITE_TOOL_OWNER_COPY[toolName]
    : row("Review this change", "Review this change", "Saved in Mingla");
}

/** A lowercase phrase for prose ("publish event"), or null when unknown. */
export function toolOwnerPhrase(toolName: string): string | null {
  return Object.prototype.hasOwnProperty.call(WRITE_TOOL_OWNER_COPY, toolName)
    ? WRITE_TOOL_OWNER_COPY[toolName].verb.toLowerCase()
    : null;
}
