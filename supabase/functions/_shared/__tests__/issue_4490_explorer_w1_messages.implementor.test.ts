// #4490 Explorer W1 — venue emails and texts lead with the Mingla app once
// VENUE_APP_HANDOFF mints a claim link at send time; without one, unchanged.
//
// FAILS-ON-REVERT: drop the appUrl branch in trustedVenueVisitCta and M-1 fails;
// drop the app-link SMS branch in venueBookingEmails.ts and M-3 fails.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  trustedVenueVisitCta,
  venueAppClaimUrl,
  venueWebLinkLabel,
} from "../venueOfferVisitLink.ts";
import { renderVenueBookingMessage } from "../email/templates/venueBookingEmails.ts";
import { renderVenueMembershipMessage } from "../email/templates/venueMembershipEmails.ts";
import { renderVenueWaitlistMessage } from "../email/templates/venueWaitlistEmails.ts";
import { renderGenericBody } from "../email/genericBody.ts";

const ORIGIN = "https://host.usemingla.com";
const GROUP = "0a1b2c3d-4490-4000-8000-0000000000c1";
const VISIT = `${ORIGIN}/visit/${GROUP}#t=${"T".repeat(43)}`;
const APP = "https://usemingla.com/c/K7Q2MX0001";

const cta = (
  category: string,
  appUrl: unknown,
  payload: Record<string, unknown> = { venue_group_id: GROUP },
) =>
  trustedVenueVisitCta({
    serviceCaller: true,
    categoryKey: category,
    payload,
    visitUrl: VISIT,
    origin: ORIGIN,
    appUrl,
  });

Deno.test("M-1 a confirmed booking email leads with Open in Mingla; the web link is second", () => {
  const c = cta("venue_booking_confirmed", APP);
  assertEquals(c?.label, "Open in Mingla");
  assertEquals(c?.url, APP);
  assertEquals(c?.note, "No app? Give your name at the door.");
  assertEquals(c?.secondary?.label, "See your booking on the web");
  assertEquals(c?.secondary?.url, VISIT);
});

Deno.test("M-2 without a claim link (flag off) the email is exactly as today", () => {
  const c = cta("venue_booking_confirmed", undefined);
  assertEquals(c?.label, "See your pass");
  assertEquals(c?.secondary, undefined);
  // A non-claim URL never leads.
  assertEquals(
    cta("venue_booking_confirmed", "https://evil.example/c/K7Q2MX0001")?.label,
    "See your pass",
  );
  assertEquals(venueAppClaimUrl("https://usemingla.com/c/k7q2"), null);
  // Staff messages are unchanged.
  assertEquals(cta("venue_request_action_needed", APP), undefined);
});

Deno.test("M-1b second-link words per §6", () => {
  assertEquals(venueWebLinkLabel("venue_balance_due"), "Pay on the web");
  assertEquals(venueWebLinkLabel("venue_membership_renewal"), "Pay on the web");
  assertEquals(
    venueWebLinkLabel("venue_membership_paid"),
    "See your plan on the web",
  );
  assertEquals(
    venueWebLinkLabel("venue_waitlist_joined"),
    "See your place in line",
  );
  assertEquals(
    venueWebLinkLabel("venue_booking_cancelled"),
    "See your booking on the web",
  );
  const w = trustedVenueVisitCta({
    serviceCaller: true,
    categoryKey: "venue_waitlist_joined",
    payload: {},
    visitUrl: undefined,
    origin: ORIGIN,
    appUrl: APP,
  });
  assertEquals(w?.label, "Open in Mingla");
});

Deno.test("M-3 the confirmation text carries the app link (§6) only when there is one", () => {
  const base = {
    venue_name: "Gameland Lagos",
    offer_name: "Entry",
    visit_date: "Sat 21 Nov",
    visit_time: "17:00",
    public_reference: "GL-1",
  };
  assertEquals(
    renderVenueBookingMessage("venue_booking_confirmed", {
      ...base,
      venue_app_link_display: "usemingla.com/c/K7Q2MX0001",
    }).sms,
    "Mingla: Gameland Lagos, Sat 21 Nov 17:00. Your pass is in the Mingla app: usemingla.com/c/K7Q2MX0001",
  );
  assert(
    renderVenueBookingMessage("venue_booking_confirmed", base).sms.endsWith(
      "Your pass is in your email.",
    ),
  );
});

Deno.test("M-4 membership renewal and waitlist texts carry the link", () => {
  const r = renderVenueMembershipMessage("venue_membership_renewal", {
    venue_name: "Kora Works",
    plan_name: "Hot desk",
    period_start_date: "2026-11-23",
    venue_app_link_display: "usemingla.com/c/K7Q2MX0001",
  }).sms;
  assertEquals(
    r,
    "Mingla: your Hot desk at Kora Works renews on Mon 23 Nov. Pay here: usemingla.com/c/K7Q2MX0001",
  );
  const w = renderVenueWaitlistMessage("venue_waitlist_joined", {
    venue_name: "Gameland Lagos",
    venue_app_link_display: "usemingla.com/c/K7Q2MX0001",
  }).sms;
  assert(w.includes("usemingla.com/c/K7Q2MX0001"), w);
});

Deno.test("M-5 the email body renders the second link under the button (https only)", () => {
  const out = renderGenericBody({
    variant: "generic_notification",
    title: "You're in",
    paragraphs: ["Body"],
    cta: { label: "Open in Mingla", url: APP },
    secondaryCta: { label: "See your booking on the web", url: VISIT },
  });
  assert(
    out.html.indexOf("Open in Mingla") <
      out.html.indexOf("See your booking on the web"),
  );
  assert(
    out.text.includes(`See your booking on the web: ${ORIGIN}/visit/${GROUP}`),
  );
  const bad = renderGenericBody({
    variant: "generic_notification",
    title: "t",
    paragraphs: ["b"],
    secondaryCta: { label: "x", url: "javascript:alert(1)" },
  });
  assertEquals(bad.html.includes("javascript"), false);
});
