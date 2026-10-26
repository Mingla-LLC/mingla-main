import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { providerSafePayload } from "../notifyV2.ts";

const SAFE_BY_CATEGORY: Record<string, string[]> = {
  buyer_reservation_confirmed: ["reservation_id", "event_id", "venue_id"],
  buyer_reservation_changed: ["reservation_id", "event_id", "venue_id"],
  buyer_reservation_cancelled: [
    "reservation_id",
    "event_id",
    "venue_id",
    "refund_record_id",
  ],
  buyer_reservation_reminder: ["reservation_id", "event_id", "venue_id"],
  buyer_event_reminder: ["order_id", "event_id", "event_date_id"],
  buyer_purchase_confirmation: ["order_id", "event_id", "event_date_id"],
  buyer_refund_issued: [
    "order_id",
    "event_id",
    "reservation_id",
    "refund_record_id",
  ],
  buyer_order_cancelled: ["order_id", "event_id", "refund_record_id"],
  buyer_contribution_receipt: ["contribution_id", "event_id"],
  buyer_event_updated: ["order_id", "event_id", "event_date_id"],
  buyer_venue_order_receipt: ["venue_order_id", "venue_id"],
  buyer_door_receipt: ["order_id", "event_id"],
  rsvp_acknowledgement: ["rsvp_id", "event_id", "guest_id"],
  rsvp_pass: ["rsvp_id", "event_id", "guest_id"],
  rsvp_event_updated: ["rsvp_id", "event_id", "guest_id"],
  rsvp_waitlist_promoted: ["rsvp_id", "event_id", "guest_id"],
  rsvp_approved: ["rsvp_id", "event_id", "guest_id"],
  rsvp_denied: ["rsvp_id", "event_id", "guest_id"],
  rsvp_removed: ["rsvp_id", "event_id", "guest_id"],
  stay_request_received: ["stay_group_id", "venue_id"],
  stay_request_action_needed: ["stay_group_id", "venue_id"],
  stay_payment_required: ["stay_group_id", "venue_id"],
  stay_request_declined: ["stay_group_id", "venue_id"],
  stay_reservation_confirmed: ["stay_group_id", "venue_id"],
  stay_reservation_cancelled: [
    "stay_group_id",
    "venue_id",
    "refund_record_id",
  ],
  stay_refund_state: [
    "stay_group_id",
    "venue_id",
    "refund_record_id",
  ],
  stay_reconciliation_attention: ["stay_group_id", "venue_id"],
  stay_reservation_reminder: ["stay_group_id", "venue_id"],
};

const PII = {
  buyer_name: "Ada Buyer",
  buyer_email: "buyer@example.com",
  buyer_phone: "+15551234567",
  buyer_phone_e164: "+15551234567",
  guest_name: "Grace Guest",
  guest_email: "guest@example.com",
  guest_phone: "+2348012345678",
  recipient: "recipient@example.com",
  recipientEmail: "recipient@example.com",
  recipientName: "Recipient Name",
  recipientPhone: "+15557654321",
  message_link_url: "https://secret.example/claim/token",
  message_link_display: "usemingla.com/c/secret",
  claim_token: "secret-token",
  body: "private rendered copy",
  title: "private rendered title",
};

Deno.test("#4063 buyer, RSVP, and Stay push payloads expose only reviewed opaque IDs", () => {
  for (const [category, safeKeys] of Object.entries(SAFE_BY_CATEGORY)) {
    const payload = Object.fromEntries([
      ...Object.keys(PII).map((key) => [key, `leak:${key}`]),
      ...safeKeys.map((key) => [key, `${category}:${key}`]),
    ]);
    const safe = providerSafePayload(category, payload);
    assertEquals(Object.keys(safe).sort(), [...safeKeys].sort(), category);
    assertFalse(
      Object.values(safe).some((value) =>
        typeof value === "string" && value.startsWith("leak:")
      ),
      `${category} leaked a rendering/contact value`,
    );
  }
});

Deno.test("#4063 unknown consumer categories fail closed at the push provider boundary", () => {
  for (
    const category of [
      "buyer_future_private_notice",
      "rsvp_future_private_notice",
      "stay_future_private_notice",
    ]
  ) {
    assertEquals(
      providerSafePayload(category, { ...PII, order_id: "opaque" }),
      {},
    );
  }
});

Deno.test("#4063 unrelated legacy categories keep their established payload contract", () => {
  const payload = { conversationId: "conversation-1", sender: "Ada" };
  assertEquals(providerSafePayload("messages", payload), payload);
});
