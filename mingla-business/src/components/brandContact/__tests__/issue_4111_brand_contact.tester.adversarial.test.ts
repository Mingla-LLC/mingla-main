/**
 * #4111 — independent tester adversarial proof for the brand-contact rules the
 * buyer web, Explorer and the Host app share. Pure functions only; the
 * implementor suites cover the happy paths, this one attacks the edges:
 *
 *   A-1  signed-out never sees "Your plans", even if plans leak into the input
 *   A-2  Soft-Life shapes (no offerings, only stale / undated / duplicate rows,
 *        blank brand name) collapse to exactly "Something else"
 *   A-3  the 90-day past window boundary, to the millisecond
 *   A-4  every reason key the sheet can send is one the SERVER knows
 *        (issue_4111_reason_label in 20271221014111) — a key the server does
 *        not know would bounce a real guest's message with "invalid_reason"
 *   A-5  signed-out picks only ever carry contexts an anonymous sender may attach
 *   A-6  Host badge + To-do: hostile counts, spam, resolved, oldest first
 *   A-7  Host contact line never shows a phone without "OK to call"
 *   A-8  Host "Open …" routes never accept a non-uuid id (no route injection)
 *
 * FAILS-ON-REVERT: dropping `input.signedIn &&` from the plans group fails A-1;
 * removing the spam check from brandEnquiryNeedsReply fails A-6; showing the
 * phone without ok_to_call fails A-7; dropping the UUID guard fails A-8.
 */
import { beforeAll, describe, expect, test } from "@jest/globals";
import { readFile } from "fs/promises";
import * as path from "path";

import {
  ANON_CONTEXT_KINDS,
  allEnquiryPicks,
  buildEnquiryTopicGroups,
  reasonsForShape,
  sendReasonFor,
  type EnquiryOffering,
  type EnquiryPickShape,
  type EnquiryPlan,
} from "@mingla/brand-rendering/enquiry/enquiryTopics";
import {
  brandEnquiryContactLine,
  brandEnquiryContextOpen,
  brandEnquiryTodos,
  messagesBadgeCount,
} from "../../../utils/brandEnquiryDisplay";
import type { BrandEnquirySummary } from "../../../services/brandEnquiriesService";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const plan = (over: Partial<EnquiryPlan> = {}): EnquiryPlan => ({
  kind: "order",
  id: "11111111-1111-4111-8111-111111111111",
  title: "Rooftop Supper",
  startsAt: new Date(NOW + 3 * DAY).toISOString(),
  summary: "2 tickets",
  isUpcoming: true,
  canCancel: false,
  canCancelUrl: null,
  canRequestRefund: false,
  ...over,
});

const offering = (over: Partial<EnquiryOffering> = {}): EnquiryOffering => ({
  id: "22222222-2222-4222-8222-222222222222",
  title: "Night Market",
  kind: "event",
  startsAt: new Date(NOW + 5 * DAY).toISOString(),
  endsAt: null,
  when: "upcoming",
  ...over,
});

const groupKeys = (groups: ReturnType<typeof buildEnquiryTopicGroups>): string[] => groups.map((g) => g.key);

describe("A-1 signed-out never sees plans", () => {
  test("plans passed for a signed-out visitor are ignored", () => {
    const groups = buildEnquiryTopicGroups({
      brandName: "Lantern Room",
      signedIn: false,
      plans: [plan(), plan({ id: "33333333-3333-4333-8333-333333333333", kind: "reservation" })],
      nowMs: NOW,
    });
    expect(groupKeys(groups)).not.toContain("plans");
    expect(allEnquiryPicks(groups).some((p) => p.plan !== undefined)).toBe(false);
  });
});

describe("A-2 Soft-Life shapes collapse to exactly 'Something else'", () => {
  const softLife = [
    { name: "no data at all", input: {} },
    { name: "empty arrays, signed in", input: { signedIn: true, plans: [], offerings: [], venue: null } },
    {
      name: "only offerings older than 90 days",
      input: {
        offerings: [
          offering({ when: "past", startsAt: new Date(NOW - 200 * DAY).toISOString() }),
          offering({ id: "44444444-4444-4444-8444-444444444444", when: "past", startsAt: new Date(NOW - 91 * DAY).toISOString() }),
        ],
      },
    },
  ];
  for (const { name, input } of softLife) {
    test(name, () => {
      const groups = buildEnquiryTopicGroups({ brandName: "Soft Life", signedIn: false, nowMs: NOW, ...input });
      expect(groupKeys(groups)).toEqual(["something_else"]);
      expect(groups[0].picks.map((p) => p.directReason)).toEqual(["general_question", "work_with", "other"]);
    });
  }
  test("a blank brand name never prints 'Work with ' with nothing after it", () => {
    const groups = buildEnquiryTopicGroups({ brandName: "   ", signedIn: false, nowMs: NOW });
    const workWith = allEnquiryPicks(groups).find((p) => p.directReason === "work_with");
    expect(workWith?.title).toBe("Work with this brand");
  });
  test("the same offering in Happening now and Upcoming is listed once", () => {
    const groups = buildEnquiryTopicGroups({
      brandName: "Lantern",
      signedIn: false,
      nowMs: NOW,
      offerings: [offering({ when: "happening_now" }), offering({ when: "upcoming" })],
    });
    expect(allEnquiryPicks(groups).filter((p) => p.contextId === offering().id)).toHaveLength(1);
  });
});

describe("A-3 the 90-day Past window", () => {
  const at = (msAgo: number) =>
    buildEnquiryTopicGroups({
      brandName: "Lantern",
      signedIn: false,
      nowMs: NOW,
      offerings: [offering({ when: "past", startsAt: new Date(NOW - msAgo).toISOString() })],
    });
  test("exactly 90 days ago is still Past; one millisecond older is not", () => {
    expect(groupKeys(at(90 * DAY))).toContain("past");
    expect(groupKeys(at(90 * DAY + 1))).not.toContain("past");
  });
  test("the end time, not the start, decides", () => {
    const groups = buildEnquiryTopicGroups({
      brandName: "Lantern",
      signedIn: false,
      nowMs: NOW,
      offerings: [offering({
        when: "past",
        startsAt: new Date(NOW - 120 * DAY).toISOString(),
        endsAt: new Date(NOW - 10 * DAY).toISOString(),
      })],
    });
    expect(groupKeys(groups)).toContain("past");
  });
});

describe("A-4 every reason the sheet can send is known to the server", () => {
  // The server's reason catalog, parsed from the migration that defines it.
  const serverKeys = new Set<string>();
  beforeAll(async () => {
    const sql = await readFile(
      path.resolve(__dirname, "../../../../../supabase/migrations/20271221014111_issue_4111_brand_enquiry_rpcs.sql"),
      "utf8",
    );
    const catalog = sql.slice(sql.indexOf("FUNCTION public.issue_4111_reason_label"), sql.indexOf("REVOKE ALL ON FUNCTION public.issue_4111_reason_label"));
    for (const m of catalog.matchAll(/WHEN '([a-z_]+)' THEN/g)) serverKeys.add(m[1]);
  });
  const shapes: EnquiryPickShape[] = [
    "ticket_order", "booking", "food_order", "rsvp", "upcoming_offering", "past_offering", "trip", "table", "direct",
  ];
  test("the server catalog was found", () => {
    expect(serverKeys.size).toBeGreaterThan(20);
  });
  test("every step-2 reason of every shape", () => {
    for (const shape of shapes) {
      for (const reason of reasonsForShape(shape)) {
        expect([shape, serverKeys.has(reason.key)]).toEqual([shape, true]);
      }
    }
  });
  test("every direct topic of a full sheet", () => {
    const groups = buildEnquiryTopicGroups({
      brandName: "Lantern",
      signedIn: true,
      nowMs: NOW,
      plans: [plan(), plan({ kind: "venue_order", id: "55555555-5555-4555-8555-555555555555" })],
      offerings: [offering(), offering({ id: "66666666-6666-4666-8666-666666666666", when: "past", startsAt: new Date(NOW - DAY).toISOString() })],
      venue: { id: "77777777-7777-4777-8777-777777777777", name: "Room", orderingEnabled: true, reservationsOnline: true },
    });
    for (const pick of allEnquiryPicks(groups)) {
      const direct = sendReasonFor(pick, null);
      if (direct !== null) expect([pick.key, serverKeys.has(direct)]).toEqual([pick.key, true]);
    }
  });
});

describe("A-5 a signed-out sheet only offers contexts an anonymous sender may attach", () => {
  test("no pick a signed-out visitor sees carries a booking context", () => {
    const groups = buildEnquiryTopicGroups({
      brandName: "Lantern",
      signedIn: false,
      nowMs: NOW,
      plans: [plan()],
      offerings: [offering(), offering({ id: "88888888-8888-4888-8888-888888888888", when: "past", startsAt: new Date(NOW - DAY).toISOString() })],
      venue: { id: "77777777-7777-4777-8777-777777777777", name: "Room", orderingEnabled: true, reservationsOnline: false },
    });
    for (const pick of allEnquiryPicks(groups)) {
      expect([pick.key, ANON_CONTEXT_KINDS.includes(pick.contextKind)]).toEqual([pick.key, true]);
    }
  });
});

const summary = (over: Partial<BrandEnquirySummary> = {}): BrandEnquirySummary => ({
  id: "99999999-9999-4999-8999-999999999999",
  conversation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  brand_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  brand_name: "Lantern",
  brand_slug: "lantern",
  brand_photo_url: null,
  status: "waiting",
  source: "web",
  channel_label: "Web",
  guest_name: "Ada Obi",
  topic_label: "Refund",
  reason: "refund",
  context_kind: "none",
  context_id: null,
  spam_flag: false,
  email_confirmed: false,
  created_at: "2026-10-20T10:00:00Z",
  last_guest_at: "2026-10-25T10:00:00Z",
  last_brand_at: null,
  last_message_preview: "Hello",
  ...over,
} as BrandEnquirySummary);

describe("A-6 Host badge and To-do", () => {
  test("hostile counts never inflate or poison the badge", () => {
    expect(messagesBadgeCount(Number.NaN, { needs_reply: Number.NaN })).toBe(0);
    expect(messagesBadgeCount(-3, { needs_reply: -1 })).toBe(0);
    expect(messagesBadgeCount(2.9, { needs_reply: 1.5 })).toBe(3);
    expect(messagesBadgeCount(Number.POSITIVE_INFINITY, null)).toBe(0);
    expect(messagesBadgeCount(1, undefined)).toBe(1);
  });
  test("only new|waiting, never possible spam, oldest first, one row each", () => {
    const todos = brandEnquiryTodos([
      summary({ id: "c1000000-0000-4000-8000-000000000001", status: "waiting", last_guest_at: "2026-10-25T10:00:00Z", guest_name: "Newer" }),
      summary({ id: "c1000000-0000-4000-8000-000000000002", status: "new", last_guest_at: "2026-10-24T10:00:00Z", guest_name: "Older" }),
      summary({ id: "c1000000-0000-4000-8000-000000000003", status: "waiting", spam_flag: true, guest_name: "Spammer" }),
      summary({ id: "c1000000-0000-4000-8000-000000000004", status: "replied", guest_name: "Replied" }),
      summary({ id: "c1000000-0000-4000-8000-000000000005", status: "resolved", guest_name: "Done" }),
    ], new Date("2026-10-26T10:00:00Z"));
    expect(todos.map((t) => t.label)).toEqual(["Reply to Older", "Reply to Newer"]);
    expect(todos[0].sublabel).toBe("Customer enquiry · Refund · 2d");
    expect(todos.every((t) => /^\/messages\/enquiry\/[0-9a-f-]{36}$/.test(t.route))).toBe(true);
    expect(new Set(todos.map((t) => t.id)).size).toBe(todos.length);
  });
});

describe("A-7 the guest's phone shows only with OK to call", () => {
  test.each([
    [{ email: "a@b.co", phone: "+14155550100", ok_to_call: false }, "a@b.co"],
    [{ email: "a@b.co", phone: "+14155550100" }, "a@b.co"],
    [{ email: "a@b.co", phone: "   ", ok_to_call: true }, "a@b.co"],
    [{ email: "a@b.co", phone: null, ok_to_call: true }, "a@b.co"],
    [{ email: "a@b.co", phone: "+14155550100", ok_to_call: true }, "a@b.co · +14155550100 · OK to call"],
  ])("%j", (guest, expected) => {
    expect(brandEnquiryContactLine(guest)).toBe(expected);
  });
});

describe("A-8 Host 'Open …' routes never take a non-uuid id", () => {
  const hostile = ["../../admin", "x/../../settings", "", "11111111-1111-4111-8111-111111111111/../../x", "javascript:alert(1)"];
  test.each(hostile)("%s", (bad) => {
    for (const kind of ["order", "rsvp", "reservation", "stay", "venue_order", "offering", "venue"] as const) {
      const open = brandEnquiryContextOpen({
        kind,
        id: bad,
        event_id: bad,
        venue_id: bad,
        offering_kind: "event",
      } as Parameters<typeof brandEnquiryContextOpen>[0]);
      expect([kind, open]).toEqual([kind, null]);
    }
  });
});
