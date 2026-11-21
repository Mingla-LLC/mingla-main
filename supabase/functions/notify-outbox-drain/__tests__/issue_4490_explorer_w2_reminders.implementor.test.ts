// #4490 Explorer W2: visit reminders and venue push links (spec 06 §3 W2 edge, §6 copy).
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { purchaseReminderDeepLink } from "../index.ts";
import { providerSafePayload } from "../../_shared/notifyV2.ts";
import { renderCategoryMessage } from "../../_shared/notifyTemplates.ts";
import {
  trustedVenueVisitCta,
  venueWebLinkLabel,
} from "../../_shared/venueOfferVisitLink.ts";

const GROUP = "44943000-0000-4000-8000-0000000000b1";
const SUB = "44943000-0000-4000-8000-0000000000b2";
const WAIT = "44943000-0000-4000-8000-0000000000b3";
const VENUE = "44943000-0000-4000-9000-0000000000a1";

Deno.test("W2-E1 a venue push opens the booking, plan or waitlist place in Purchases", () => {
  assertEquals(
    purchaseReminderDeepLink({
      category_key: "venue_visit_reminder",
      payload: { venue_group_id: GROUP, venue_id: VENUE },
    }),
    `com.mingla.app.v2://purchases/venue_booking/${GROUP}`,
  );
  assertEquals(
    purchaseReminderDeepLink({
      category_key: "venue_booking_confirmed",
      payload: { venue_group_id: GROUP },
    }),
    `com.mingla.app.v2://purchases/venue_booking/${GROUP}`,
  );
  assertEquals(
    purchaseReminderDeepLink({
      category_key: "venue_membership_renewal",
      payload: { subscription_id: SUB },
    }),
    `com.mingla.app.v2://purchases/venue_membership/${SUB}`,
  );
  assertEquals(
    purchaseReminderDeepLink({
      category_key: "venue_table_opened",
      payload: { waitlist_id: WAIT },
    }),
    `com.mingla.app.v2://purchases/venue_waitlist/${WAIT}`,
  );
});

Deno.test("W2-E2 venue links fail closed: staff messages, wrong field, non-uuid ids", () => {
  assertEquals(
    purchaseReminderDeepLink({
      category_key: "venue_request_action_needed",
      payload: { venue_group_id: GROUP },
    }),
    null,
  );
  assertEquals(
    purchaseReminderDeepLink({
      category_key: "venue_visit_reminder",
      payload: { subscription_id: SUB },
    }),
    null,
  );
  assertEquals(
    purchaseReminderDeepLink({
      category_key: "venue_membership_paid",
      payload: { subscription_id: "../../messages" },
    }),
    null,
  );
});

Deno.test("W2-E3 the reminder push carries opaque ids only", () => {
  assertEquals(
    providerSafePayload("venue_visit_reminder", {
      venue_group_id: GROUP,
      venue_id: VENUE,
      public_reference: "VB-1",
      guest_email: "a@example.test",
      venue_name: "Gameland",
    }),
    { venue_group_id: GROUP, venue_id: VENUE },
  );
});

Deno.test("W2-E4 reminder copy is exactly spec 06 §6", () => {
  const day = renderCategoryMessage("venue_visit_reminder", {
    venue_name: "Gameland",
    offer_name: "Entry",
    visit_time: "19:00",
    reminder_reason: "24h",
  });
  assertEquals(day.push.title, "Gameland tomorrow at 19:00");
  assertEquals(day.push.body, "Your pass is in Purchases.");
  const soon = renderCategoryMessage("venue_visit_reminder", {
    venue_name: "Gameland",
    offer_name: "Entry",
    visit_time: "19:00",
    reminder_reason: "2h",
  });
  assertEquals(soon.push.title, "Gameland in 2 hours");
  assertEquals(soon.push.body, "Your pass is in Purchases.");
  assert(soon.email.subject === "Gameland in 2 hours");
});

Deno.test("W2-E5 the reminder email leads with Open in Mingla and keeps the pass link", () => {
  const cta = trustedVenueVisitCta({
    serviceCaller: true,
    categoryKey: "venue_visit_reminder",
    payload: { venue_group_id: GROUP },
    visitUrl: `https://host.usemingla.com/visit/${GROUP}#t=${"A".repeat(43)}`,
    origin: "https://host.usemingla.com",
    appUrl: "https://usemingla.com/c/K7Q2MX4P9T",
  });
  assertEquals(cta?.label, "Open in Mingla");
  assertEquals(cta?.note, "No app? Give your name at the door.");
  assertEquals(cta?.secondary?.label, "See your booking on the web");
  assertEquals(
    venueWebLinkLabel("venue_visit_reminder"),
    "See your booking on the web",
  );
  const web = trustedVenueVisitCta({
    serviceCaller: true,
    categoryKey: "venue_visit_reminder",
    payload: { venue_group_id: GROUP },
    visitUrl: `https://host.usemingla.com/visit/${GROUP}#t=${"A".repeat(43)}`,
    origin: "https://host.usemingla.com",
  });
  assertEquals(web?.label, "See your pass");
});
