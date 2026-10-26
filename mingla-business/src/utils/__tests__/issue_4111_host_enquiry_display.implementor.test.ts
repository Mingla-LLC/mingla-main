/**
 * #4111 Wave C — the Host app's customer-enquiry display rules.
 *
 * Status pills, row subtitle, the speech-bubble badge (Brand-group unread +
 * enquiries waiting, never one enquiry twice), Home To-do rows, the context
 * card's Open route and the contact line (phone only when OK to call).
 */

import { describe, expect, test } from "@jest/globals";

import type { BrandEnquirySummary } from "../../services/brandEnquiriesService";
import {
  brandEnquiryAge,
  brandEnquiryChannel,
  brandEnquiryContactLine,
  brandEnquiryContextOpen,
  brandEnquiryInitials,
  brandEnquiryRowSubtitle,
  brandEnquirySectionTitle,
  brandEnquiryStatusPill,
  brandEnquiryThreadSubtitle,
  brandEnquiryTodos,
  messagesBadgeCount,
} from "../brandEnquiryDisplay";
import { buildBusinessTodos } from "../businessTodos";

const ID = (n: number): string => `4111c000-0000-4000-b800-${String(n).padStart(12, "0")}`;

function summary(overrides: Partial<BrandEnquirySummary> = {}): BrandEnquirySummary {
  return {
    id: ID(1),
    conversation_id: ID(2),
    brand_id: ID(3),
    brand_name: "Lantern Room",
    brand_slug: "lantern-room",
    brand_photo_url: null,
    status: "new",
    source: "web",
    channel_label: "Web",
    guest_name: "Ada Obi",
    topic_label: "Private hire or big group",
    reason: "private_hire",
    context_kind: "none",
    context_id: null,
    spam_flag: false,
    email_confirmed: true,
    created_at: "2026-10-25T08:00:00.000Z",
    last_guest_at: "2026-10-25T08:00:00.000Z",
    last_brand_at: null,
    last_message_preview: "Hi!",
    ...overrides,
  };
}

describe("status pills", () => {
  test("each status reads the way the design names it", () => {
    expect(brandEnquiryStatusPill("new")).toEqual({ label: "New", tone: "new" });
    expect(brandEnquiryStatusPill("waiting")).toEqual({ label: "Waiting on you", tone: "waiting" });
    expect(brandEnquiryStatusPill("replied")).toEqual({ label: "Replied", tone: "replied" });
    expect(brandEnquiryStatusPill("resolved")).toEqual({ label: "Resolved", tone: "resolved" });
  });
});

describe("list rows", () => {
  test("initials, subtitle and channel", () => {
    expect(brandEnquiryInitials("Ada Obi")).toBe("AO");
    expect(brandEnquiryInitials("  tunde  ")).toBe("T");
    expect(brandEnquiryInitials("Mary Jane Watson")).toBe("MW");
    expect(brandEnquiryInitials("")).toBe("?");
    expect(brandEnquiryRowSubtitle(summary())).toBe("Lantern Room · Private hire or big group · Web");
    expect(brandEnquiryRowSubtitle(summary({ source: "explorer", channel_label: "App" }))).toBe(
      "Lantern Room · Private hire or big group · App",
    );
    expect(brandEnquiryChannel("site", null)).toBe("Website");
    expect(brandEnquiryChannel("explorer", "garbage")).toBe("App");
  });

  test("section title counts what is waiting", () => {
    expect(brandEnquirySectionTitle({ needs_reply: 2 })).toBe("Customer enquiries · 2 waiting");
    expect(brandEnquirySectionTitle({ needs_reply: 0 })).toBe("Customer enquiries");
  });
});

describe("speech-bubble badge", () => {
  test("Brand-group unread plus enquiries waiting on the team", () => {
    expect(messagesBadgeCount(3, { needs_reply: 2 })).toBe(5);
    expect(messagesBadgeCount(0, { needs_reply: 1 })).toBe(1);
    expect(messagesBadgeCount(4, null)).toBe(4);
    expect(messagesBadgeCount(4, undefined)).toBe(4);
    expect(messagesBadgeCount(Number.NaN, { needs_reply: Number.NaN })).toBe(0);
    expect(messagesBadgeCount(-2, { needs_reply: -1 })).toBe(0);
  });
});

describe("Home To-do rows", () => {
  const now = new Date("2026-10-25T10:00:00.000Z");

  test("one row per enquiry waiting on the team, oldest first, never replied/resolved/spam", () => {
    const rows = brandEnquiryTodos(
      [
        summary({ id: ID(10), guest_name: "Ada Obi", last_guest_at: "2026-10-25T08:00:00.000Z" }),
        summary({ id: ID(11), guest_name: "Tunde K", status: "waiting", topic_label: "Your reservation", last_guest_at: "2026-10-24T09:00:00.000Z" }),
        summary({ id: ID(12), guest_name: "Sam L", status: "replied" }),
        summary({ id: ID(13), guest_name: "Rae", status: "resolved" }),
        summary({ id: ID(14), guest_name: "Spammy", spam_flag: true }),
      ],
      now,
    );
    expect(rows).toEqual([
      {
        id: `brand_enquiry_${ID(11)}`,
        label: "Reply to Tunde K",
        sublabel: "Customer enquiry · Your reservation · 1d",
        route: `/messages/enquiry/${ID(11)}`,
      },
      {
        id: `brand_enquiry_${ID(10)}`,
        label: "Reply to Ada Obi",
        sublabel: "Customer enquiry · Private hire or big group · 2h",
        route: `/messages/enquiry/${ID(10)}`,
      },
    ]);
  });

  test("ages", () => {
    expect(brandEnquiryAge("2026-10-25T09:59:40.000Z", now)).toBe("now");
    expect(brandEnquiryAge("2026-10-25T09:55:00.000Z", now)).toBe("5m");
    expect(brandEnquiryAge("2026-10-11T10:00:00.000Z", now)).toBe("2w");
    expect(brandEnquiryAge("not a date", now)).toBe("");
  });

  test("the To-do list puts enquiries right after invites", () => {
    const todos = buildBusinessTodos({
      pendingInvites: [{ id: "inv-1", brandName: "Ctrl" }],
      enquiryTodos: brandEnquiryTodos([summary({ id: ID(20) })], now),
      hasNoBrands: false,
      hasBrandsButNoSelection: false,
      brandResolving: true,
      hasBrand: false,
      pipelineFetched: false,
      pipelineStatus: null,
      pipelineRoute: "",
      venueDraftInProgress: false,
      counts: { total: 0, live: 0, draft: 0 },
      stripeActive: false,
      payoutReady: false,
      hasDraftPaidOffering: false,
      stripeRoute: "",
      draftRoute: null,
      venueClaimPending: false,
      venueListingRoute: "",
      venueClaimOpenFeedbackCount: 0,
      venueFeedbackRoute: "",
    } as Parameters<typeof buildBusinessTodos>[0]);
    expect(todos.map((todo) => todo.id)).toEqual(["pending_invite_inv-1", `brand_enquiry_${ID(20)}`]);
    expect(todos[1]).toMatchObject({
      label: "Reply to Ada Obi",
      action: { kind: "route", route: `/messages/enquiry/${ID(20)}` },
    });
  });
});

describe("thread header, context card and contact line", () => {
  test("header subtitle", () => {
    expect(brandEnquiryThreadSubtitle({ brandName: "Lantern Room", source: "web", channelLabel: "Web", emailConfirmed: true })).toBe(
      "Lantern Room · Web · Email confirmed",
    );
    expect(brandEnquiryThreadSubtitle({ brandName: "Ctrl", source: "explorer", channelLabel: "App", emailConfirmed: false })).toBe(
      "Ctrl · App · Email not confirmed yet",
    );
  });

  test("Open goes to the existing Host route for each context", () => {
    expect(brandEnquiryContextOpen({ kind: "order", id: ID(30), event_id: ID(31) })).toEqual({
      label: "Open order",
      route: `/event/${ID(31)}/orders/${ID(30)}`,
    });
    expect(brandEnquiryContextOpen({ kind: "rsvp", id: ID(32), event_id: ID(31) })).toEqual({
      label: "Open booking",
      route: `/event/${ID(31)}/guests`,
    });
    expect(brandEnquiryContextOpen({ kind: "reservation", id: ID(33), venue_id: ID(34) })).toEqual({
      label: "Open reservations",
      route: `/venue/${ID(34)}?module=reservations`,
    });
    expect(brandEnquiryContextOpen({ kind: "venue_order", id: ID(35), venue_id: ID(34) })).toEqual({
      label: "Open order",
      route: `/venue/${ID(34)}?module=orders`,
    });
    expect(brandEnquiryContextOpen({ kind: "offering", id: ID(36), offering_kind: "event" })).toEqual({
      label: "Open offering",
      route: `/event/${ID(36)}`,
    });
    expect(brandEnquiryContextOpen({ kind: "offering", id: ID(37), offering_kind: "stay" })).toBeNull();
    expect(brandEnquiryContextOpen({ kind: "none" })).toBeNull();
    expect(brandEnquiryContextOpen(null)).toBeNull();
    // A malformed id never builds a route.
    expect(brandEnquiryContextOpen({ kind: "order", id: "../../admin", event_id: ID(31) })).toBeNull();
  });

  test("the phone shows only when the guest said it is OK to call", () => {
    expect(brandEnquiryContactLine({ email: "ada@example.com", phone: "+12015550147", ok_to_call: true })).toBe(
      "ada@example.com · +12015550147 · OK to call",
    );
    expect(brandEnquiryContactLine({ email: "ada@example.com", phone: "+12015550147", ok_to_call: false })).toBe(
      "ada@example.com",
    );
    expect(brandEnquiryContactLine({ email: "ada@example.com", phone: null, ok_to_call: true })).toBe("ada@example.com");
  });
});
