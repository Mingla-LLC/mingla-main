import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const control = await Deno.readTextFile(
  new URL("../sourceRefundControlPlane.ts", import.meta.url),
);

Deno.test("#1930 source refunds exhaustively preserve all five source owners", () => {
  for (
    const sourceType of [
      "venue_reservation",
      "rsvp_contribution",
      "stay_reservation",
      "venue_menu_order",
      "ticket_checkout_session",
    ]
  ) {
    assertStringIncludes(control, `case "${sourceType}"`);
  }
  assertStringIncludes(
    control,
    'throw new Error("source_refund_unknown_source_type")',
  );
  assertStringIncludes(control, '.from("venue_orders")');
  assertStringIncludes(control, 'sourceLabel = "Venue order"');
  assertStringIncludes(control, '.from("ticket_checkout_sessions")');
  assertStringIncludes(control, 'sourceLabel = "Event ticket payment"');
  assert(
    control.indexOf('case "ticket_checkout_session"') <
      control.indexOf('.from("ticket_checkout_sessions")'),
  );
  assert(
    control.indexOf('case "rsvp_contribution"') <
      control.indexOf('.from("event_rsvp_contributions")'),
  );
});

Deno.test("#1930 ticket refunds cannot fall through a catch-all RSVP branch", () => {
  assert(
    !control.includes(
      '} else {\n      const { data } = await client.from("event_rsvp_contributions")',
    ),
  );
  assertStringIncludes(
    control,
    '.select("buyer_user_id,buyer_email,buyer_phone_e164")',
  );
});
