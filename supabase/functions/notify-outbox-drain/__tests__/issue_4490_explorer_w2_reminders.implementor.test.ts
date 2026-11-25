// #4490 Explorer W2: visit reminders and venue push links (spec 06 §3 W2 edge, §6 copy).
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { purchaseReminderDeepLink } from "../index.ts";
import { providerSafePayload } from "../../_shared/notifyV2.ts";
import { renderCategoryMessage } from "../../_shared/notifyTemplates.ts";
import {
  trustedVenueMemberPayUrl,
  trustedVenueVisitCta,
  venueWebLinkLabel,
} from "../../_shared/venueOfferVisitLink.ts";
import {
  renderVenueMembershipMessage,
  venueMembershipRenewalSms,
} from "../../_shared/email/templates/venueMembershipEmails.ts";
import { dispatchV2, type MinimalClient } from "../../_shared/notifyV2.ts";
import { __pinNgClockInsideWindow } from "../../_shared/ngSmsEmbargo.ts";

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

// ---------------------------------------------------------------------------
// W2 fix 1 (W2-N6): the renewal push and text say exactly spec 06 §6, and the
// text carries the web pay link built at send time (W2 item 6).
// ---------------------------------------------------------------------------
const ORIGIN = "https://host.usemingla.com";
const MEMBER_URL = `${ORIGIN}/visit/plan/${SUB}#t=${"B".repeat(43)}`;
const RENEWAL = {
  subscription_id: SUB,
  venue_name: "Kora Works",
  plan_name: "Hot desk",
  amount_cents: 2500000,
  total_cents: 2500000,
  currency: "NGN",
  period_start_date: "2026-11-23",
  step: "renewal",
};

Deno.test("W2-E6 the renewal push is the §6 copy", () => {
  const m = renderVenueMembershipMessage("venue_membership_renewal", RENEWAL);
  assertEquals(m.push.title, "Your Hot desk renews on Mon 23 Nov");
  assertEquals(m.push.body, "Pay ₦25,000 to keep it. Tap to see your pass.");
});

Deno.test("W2-E7 the renewal text carries the web pay link (app link first when the handoff gave one)", () => {
  assertEquals(
    venueMembershipRenewalSms("venue_membership_renewal", RENEWAL, MEMBER_URL),
    `Mingla: your Hot desk at Kora Works renews on Mon 23 Nov. Pay here: ${MEMBER_URL}`,
  );
  assertEquals(
    venueMembershipRenewalSms("venue_membership_renewal", {
      ...RENEWAL,
      venue_app_link_display: "usemingla.com/c/K7Q2MX0001",
    }, MEMBER_URL),
    "Mingla: your Hot desk at Kora Works renews on Mon 23 Nov. Pay here: usemingla.com/c/K7Q2MX0001",
  );
  // Not a renewal-on-a-date text, or no link at all: the template's own text.
  for (const step of ["approval", "due", "reminder", "restart"]) {
    assertEquals(
      venueMembershipRenewalSms("venue_membership_renewal", {
        ...RENEWAL,
        step,
      }, MEMBER_URL),
      null,
    );
  }
  assertEquals(
    venueMembershipRenewalSms("venue_membership_lapsed", RENEWAL, MEMBER_URL),
    null,
  );
  assertEquals(
    venueMembershipRenewalSms("venue_membership_renewal", RENEWAL, null),
    null,
  );
});

Deno.test("W2-E8 only the same member's link from the service role becomes the text's pay link", () => {
  const base = {
    serviceCaller: true,
    categoryKey: "venue_membership_renewal",
    payload: { subscription_id: SUB },
    visitUrl: MEMBER_URL,
    origin: ORIGIN,
  };
  assertEquals(trustedVenueMemberPayUrl(base), MEMBER_URL);
  assertEquals(
    trustedVenueMemberPayUrl({ ...base, serviceCaller: false }),
    undefined,
  );
  assertEquals(
    trustedVenueMemberPayUrl({ ...base, categoryKey: "venue_membership_paid" }),
    undefined,
  );
  assertEquals(
    trustedVenueMemberPayUrl({ ...base, payload: { subscription_id: GROUP } }),
    undefined,
  );
  assertEquals(
    trustedVenueMemberPayUrl({ ...base, origin: "https://evil.example" }),
    undefined,
  );
  assertEquals(
    trustedVenueMemberPayUrl({ ...base, visitUrl: `${MEMBER_URL}&x=1` }),
    undefined,
  );
});

Deno.test("W2-E9 dispatch sends the renewal text with the pay link and stores it nowhere", async () => {
  __pinNgClockInsideWindow();
  const owned = [
    "MINGLA_DELIVERY_FLAGS_JSON",
    "TERMII_API_KEY",
    "TERMII_BASE_URL",
    "TERMII_SENDER_ID",
  ];
  const snap = Object.fromEntries(owned.map((k) => [k, Deno.env.get(k)]));
  const realFetch = globalThis.fetch;
  const bodies: string[] = [];
  const stored: string[] = [];
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    bodies.push(
      `${String(input)} ${typeof init?.body === "string" ? init.body : ""}`,
    );
    return Promise.resolve(
      new Response(JSON.stringify({ code: "ok", message_id: "tm_w2" }), {
        status: 200,
      }),
    );
  }) as unknown as typeof fetch;
  try {
    Deno.env.set(
      "MINGLA_DELIVERY_FLAGS_JSON",
      JSON.stringify({
        schema_version: 1,
        marketing_send_live_enabled: false,
        sms_live_enabled: { ng: true, us: true },
      }),
    );
    Deno.env.set("TERMII_API_KEY", "tk_w2");
    Deno.env.set("TERMII_BASE_URL", "https://v3.api.termii.com");
    Deno.env.set("TERMII_SENDER_ID", "Mingla");
    const client = {
      // deno-lint-ignore no-explicit-any
      from(table: string): any {
        if (table === "notification_categories") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      key: "venue_membership_renewal",
                      is_transactional: true,
                      urgency: "normal",
                      default_channels: ["inapp", "sms"],
                      active: true,
                    },
                    error: null,
                  }),
              }),
            }),
          };
        }
        return {
          insert: (row: unknown) => {
            stored.push(JSON.stringify(row));
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({ data: { id: "notif-w2" }, error: null }),
              }),
              then: (f: (v: unknown) => unknown) =>
                Promise.resolve({ data: null, error: null }).then(f),
            };
          },
          update: (row: unknown) => {
            stored.push(JSON.stringify(row));
            const chain = {
              eq: () => chain,
              then: (f: (v: unknown) => unknown) =>
                Promise.resolve({ data: null, error: null }).then(f),
            };
            return chain;
          },
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        };
      },
      rpc: (fn: string) =>
        Promise.resolve({ data: fn === "can_send" ? true : null, error: null }),
    } as unknown as MinimalClient;
    // A member with no account (contact only) and a signed-in member.
    for (const user_id of [null, "44943000-0000-4000-8000-0000000000c1"]) {
      bodies.length = 0;
      stored.length = 0;
      const res = await dispatchV2(client, {
        user_id,
        contact: "+2348012345678",
        category_key: "venue_membership_renewal",
        payload: RENEWAL,
        idempotency_key: `w2-e9-renewal-${user_id ?? "guest"}`,
        venue_sms_pay_url: MEMBER_URL,
      });
      assertEquals(res.success, true, JSON.stringify(res));
      const sms = bodies.filter((b) => b.includes("termii"));
      assertEquals(sms.length, 1, `${user_id}: ${JSON.stringify(bodies)}`);
      assert(sms[0].includes(`Pay here: ${MEMBER_URL}`), sms[0]);
      assert(
        sms[0].includes(
          "Mingla: your Hot desk at Kora Works renews on Mon 23 Nov.",
        ),
        sms[0],
      );
      assert(stored.length > 0, "the inbox or delivery ledger was written");
      assert(stored.every((row) => !row.includes("#t=")), stored.join("\n"));
    }
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(snap)) {
      v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
    }
  }
});
