import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  genericBuyerLinkRequest,
  resolveGenericBuyerMessageLink,
  resolveReservationConfirmationDispatch,
} from "../../notify-outbox-drain/index.ts";
import { renderCategoryMessage } from "../notifyTemplates.ts";

const LINK = "usemingla.com/c/8KQ2ABCD7Z";

Deno.test("#4063 event reminders use local time, the governed link and contract SMS", () => {
  const rendered = renderCategoryMessage("buyer_event_reminder", {
    order_id: "00000000-0000-4000-8000-000000004063",
    event_title: "Jazz Night",
    kind: "event",
    reserved_for: "2030-10-25T23:30:00.000Z",
    timezone: "America/New_York",
    lead_bucket: "2h",
    claimed: false,
    message_link_display: LINK,
  });

  assertStringIncludes(rendered.sms, "Jazz Night starts");
  assertStringIncludes(rendered.sms, "7:30 PM");
  assertStringIncludes(
    rendered.sms,
    `Get your ticket using this number: ${LINK}`,
  );
  assertEquals(rendered.sms.startsWith("Mingla: "), true);
  assertEquals(rendered.sms.includes("GMT"), false);
  assertEquals(rendered.sms.includes("UTC"), false);
  assertEquals(rendered.push.body, "Tap for your ticket.");
});

Deno.test("#4063 venue confirmations choose host copy and claimed booking tail", () => {
  const rendered = renderCategoryMessage("buyer_reservation_confirmed", {
    reservation_id: "00000000-0000-4000-8000-000000004063",
    venue_name: "The Waterside",
    reserved_for: "2030-10-25T23:30:00.000Z",
    timezone: "America/New_York",
    party_size: 4,
    created_via: "operator",
    message_link_display: LINK,
    message_link_claimed: true,
  });

  assertEquals(
    rendered.sms,
    `Mingla: The Waterside booked your table: Fri 25 Oct 2030 7:30 PM, 4 people. Your booking: ${LINK}`,
  );
  assertEquals(rendered.push.title, "Booked: The Waterside");
  assertStringIncludes(rendered.email.subject, "7:30 PM");
});

Deno.test("#4063 food receipts use the dedicated SMS contract and claimed tail", () => {
  const unclaimed = renderCategoryMessage("buyer_venue_order_receipt", {
    venue_name: "Kitchen",
    message_link_display: LINK,
    message_link_claimed: false,
  });
  assertEquals(
    unclaimed.sms,
    `Mingla: Thanks for ordering at Kitchen. Your receipt is in the Mingla app. Get it using this number: ${LINK}`,
  );

  const claimed = renderCategoryMessage("buyer_venue_order_receipt", {
    venue_name: "Kitchen",
    message_link_display: LINK,
    message_link_claimed: true,
  });
  assertEquals(
    claimed.sms,
    `Mingla: Thanks for ordering at Kitchen. Your receipt is in the Mingla app. Your receipt: ${LINK}`,
  );
});

Deno.test("#4063 door receipts use the governed order link and S15 copy", () => {
  const rendered = renderCategoryMessage("buyer_door_receipt", {
    event_title: "Friday Social",
    message_link_display: LINK,
  });
  assertEquals(
    rendered.sms,
    `Mingla: Thanks for coming to Friday Social. Your receipt is in the Mingla app. Get it using this number: ${LINK}`,
  );
});

Deno.test("#4063 sent tickets use the recipient claim link without QR data", () => {
  const rendered = renderCategoryMessage("buyer_ticket_sent", {
    sender: "Seth",
    event_title: "Friday Social",
    event_start_at: "2030-10-25T23:30:00.000Z",
    timezone: "America/New_York",
    ticket_id: "ticket-4063",
    message_link_display: LINK,
  });

  assertEquals(
    rendered.sms,
    `Mingla: Seth sent you a ticket for Friday Social, Fri 25 Oct 2030 7:30 PM. Get it using this number: ${LINK}`,
  );
  assertEquals(rendered.push.title, "Seth sent you a ticket");
  assertStringIncludes(rendered.email.subject, "Friday Social");
  assertEquals(JSON.stringify(rendered).includes("qr"), false);
});

Deno.test("#4063 queued legacy rows keep their previous renderer byte-for-byte", () => {
  const rendered = renderCategoryMessage("buyer_reservation_confirmed", {
    brand_name: "Lantern & Vine",
    date: "Jun 20",
    time: "7:30 PM",
    party_size: 4,
  });
  assertEquals(
    rendered.sms,
    "Lantern & Vine: Table for 4 confirmed Jun 20 7:30 PM.",
  );
  assertEquals(
    rendered.email.subject,
    "Your Lantern & Vine reservation is confirmed",
  );
});

Deno.test("#4063 generic drain maps only supported buyer rows to claim kinds", () => {
  assertEquals(
    genericBuyerLinkRequest({
      category_key: "buyer_event_reminder",
      payload: { order_id: "order-1", timezone: "America/New_York" },
    }),
    { kind: "order", sourceId: "order-1" },
  );
  assertEquals(
    genericBuyerLinkRequest({
      category_key: "buyer_reservation_changed",
      payload: {
        reservation_id: "reservation-1",
        timezone: "America/New_York",
      },
    }),
    { kind: "reservation", sourceId: "reservation-1" },
  );
  assertEquals(
    genericBuyerLinkRequest({
      category_key: "business.community_reply",
      payload: { order_id: "order-1" },
    }),
    null,
  );
  assertEquals(
    genericBuyerLinkRequest({
      category_key: "buyer_door_receipt",
      payload: { order_id: "door-order-1" },
    }),
    { kind: "order", sourceId: "door-order-1" },
  );
  assertEquals(
    genericBuyerLinkRequest({
      category_key: "buyer_ticket_sent",
      payload: { ticket_id: "ticket-4063" },
    }),
    { kind: "ticket", sourceId: "ticket-4063" },
  );
  assertEquals(
    genericBuyerLinkRequest({
      category_key: "buyer_event_reminder",
      payload: { order_id: "legacy-order" },
    }),
    null,
  );
});

Deno.test("#4063 generic drain mints one governed link immediately before dispatch", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const payload = await resolveGenericBuyerMessageLink({
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve({
        data: { code: "8kq2abcd7z", claimed: true },
        error: null,
      });
    },
  }, {
    category_key: "buyer_venue_order_receipt",
    payload: { venue_order_id: "venue-order-1" },
  });

  assertEquals(calls, [{
    name: "mint_claim_link",
    args: {
      p_subject_kind: "venue_order",
      p_subject_id: "venue-order-1",
    },
  }]);
  assertEquals(payload, {
    message_link_url: "https://usemingla.com/c/8KQ2ABCD7Z",
    message_link_display: LINK,
    message_link_claimed: true,
    message_link_fallback: false,
  });
});

Deno.test("#4063 dedicated reservation SMS rows are never swapped to email", async () => {
  let touchedAdmin = false;
  const result = await resolveReservationConfirmationDispatch({
    from() {
      touchedAdmin = true;
      throw new Error("admin lookup must not run for an SMS row");
    },
  }, {
    category_key: "buyer_reservation_confirmed",
    contact: "+447700900123",
    idempotency_key: "buyer_reservation_confirmed:reservation-1:sms",
    payload: {
      channel_hint: "sms",
      guest_email: "guest@example.test",
      reservation_id: "reservation-1",
    },
  });

  assertEquals(result, { contact: "+447700900123", manageUrl: null });
  assertEquals(touchedAdmin, false);
});
