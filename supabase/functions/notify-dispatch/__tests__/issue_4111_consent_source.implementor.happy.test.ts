// #4111 — the automatic transactional consent row notify-dispatch writes is
// labelled by the category's provenance. The subscribe confirmation text is
// 'brand_subscribe'; every other category keeps 'reservation' byte for byte.
// FAILS-ON-REVERT: restoring the hard-coded `source: "reservation"` in
// notify-dispatch fails the wiring check; changing the helper's default
// fails the byte-for-byte check.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { transactionalConsentSourceForCategory } from "../../_shared/issue4111EnquiryNotifications.ts";

const EXISTING_CATEGORIES = [
  "admin.product_signal_assigned", "admin.product_signal_new", "admin.product_signal_progress",
  "admin.support_assigned", "admin.support_overdue", "admin.support_staff_ticket", "admin.team_mention",
  "attendance_claim_available", "business.brand_group_message", "business.community_announcement",
  "business.community_reply", "business.community_roadmap_updated", "business.rsvp_contribution_received",
  "business.support_new_ticket", "business.support_ticket_reply", "business.venue_order_placed",
  "business.venue_order_unacknowledged", "buyer_contribution_receipt", "buyer_event_reminder",
  "buyer_event_updated", "buyer_order_cancelled", "buyer_purchase_confirmation", "buyer_refund_issued",
  "buyer_reservation_cancelled", "buyer_reservation_changed", "buyer_reservation_confirmed",
  "buyer_reservation_reminder", "collaboration_invites", "community_announcement",
  "discover_city_plans_live", "friend_requests", "legacy_quiet_hours_push", "marketing", "marketing_blast",
  "messages", "offering_invitation", "payout_paid", "reminders", "rsvp_acknowledgement", "rsvp_approved",
  "rsvp_denied", "rsvp_event_updated", "rsvp_pass", "rsvp_removed", "rsvp_waitlist_promoted",
  "stay_payment_required", "stay_reconciliation_attention", "stay_refund_state",
  "stay_request_action_needed", "stay_request_declined", "stay_request_received",
  "stay_reservation_cancelled", "stay_reservation_confirmed", "stay_reservation_reminder",
  "waitlist_spot_open", "business.brand_enquiry_new", "business.brand_enquiry_message",
  "business.brand_enquiry_nudge", "explorer.brand_enquiry_reply", "",
];

Deno.test("#4111 every other category keeps the 'reservation' consent label byte for byte", () => {
  for (const category of EXISTING_CATEGORIES) {
    assertEquals(transactionalConsentSourceForCategory(category), "reservation", category);
  }
});

Deno.test("#4111 the subscribe confirmation text is labelled 'brand_subscribe'", () => {
  assertEquals(transactionalConsentSourceForCategory("web.brand_subscribe_confirm"), "brand_subscribe");
});

Deno.test("#4111 notify-dispatch writes the consent source from the category, not a literal", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const insert = source.slice(source.indexOf('from("consent_records").insert('));
  const block = insert.slice(0, insert.indexOf("});"));
  assert(block.includes("source: transactionalConsentSourceForCategory(v2Input.category_key)"), block);
  assert(!block.includes('source: "reservation"'), "hard-coded reservation label came back");
});
