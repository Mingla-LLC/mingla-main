/**
 * #4111 Wave D — Explorer enquiry model, routing and claim (implementor happy path).
 *
 *   - enquiry rows map correctly (brand, logo, preview, unread) and stay
 *     SEPARATE rows woven in by recency (never merged with the brand's chats)
 *   - the send RPC args (p_source 'explorer', context id null for 'none')
 *   - Likes → Calendar plan prefills for orders, RSVPs, reservations, stays
 *   - push `explorer.brand_enquiry_reply` → the enquiry thread route
 *   - the claim after an email sign-in runs both RPCs once, retries a failure
 *
 * Runs in the app-mobile render lane (jest.issue2774.render.cjs).
 */
const mockRpc = jest.fn();
jest.mock("../../../services/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));
const mockReportNonFatal = jest.fn();
jest.mock("../../../diagnostics/reportNonFatal", () => ({
  reportNonFatal: (...args: unknown[]) => mockReportNonFatal(...args),
}));

import {
  brandEnquirySendArgs,
  buildMyEnquiryRows,
  claimBrandContactForUser,
  sendExplorerEnquiry,
} from "../../../services/brandEnquiryService";
import {
  executeDeepLink,
  parseDeepLink,
  typeFallbackDestination,
} from "../../../services/deepLinkService";
import {
  resetBrandContactClaimSession,
  runBrandContactClaim,
} from "../../../services/brandContactClaim";
import { brandEnquiryKeys } from "../../../hooks/queryKeys";
import { brandFollowKeys } from "../../../hooks/brandFollowKeys";
import {
  isEnquiryConversation,
  mergeEnquiryConversations,
  toEnquiryConversation,
} from "../enquiryChatRows";
import {
  reservationMessageTarget,
  rsvpMessageTarget,
  stayMessageTarget,
  ticketOrderMessageTarget,
} from "../calendarPlanMessage";
import type { Conversation } from "../../../hooks/useMessages";

const USER = "41110000-0000-4000-8000-000000000001";
const BRAND = "41110000-0000-4000-8000-0000000000b1";
const ENQ = "41110000-0000-4000-8000-0000000000e1";
const CONV = "41110000-0000-4000-8000-0000000000c1";
const ENQ2 = "41110000-0000-4000-8000-0000000000e2";
const CONV2 = "41110000-0000-4000-8000-0000000000c2";

describe("#4111 enquiry chat rows", () => {
  const rows = buildMyEnquiryRows(
    USER,
    [
      {
        id: ENQ, brand_id: BRAND, conversation_id: CONV, status: "replied",
        topic_label: "Lantern Room supper · Refund or cancel",
        created_at: "2026-10-20T10:00:00Z", last_guest_at: "2026-10-20T10:00:00Z", last_brand_at: "2026-10-21T09:00:00Z",
      },
      {
        id: ENQ2, brand_id: BRAND, conversation_id: CONV2, status: "new",
        topic_label: "General question",
        created_at: "2026-10-19T10:00:00Z", last_guest_at: "2026-10-19T10:00:00Z", last_brand_at: null,
      },
    ],
    [{ id: BRAND, name: "Lantern Room", slug: "lantern-room", profile_photo_url: "https://cdn.example/logo.png" }],
    [
      { id: "m1", conversation_id: CONV, content: "Can I get a refund?", sender_kind: "guest", created_at: "2026-10-20T10:00:00Z", message_reads: [] },
      { id: "m2", conversation_id: CONV, content: "Yes — done!", sender_kind: "brand", created_at: "2026-10-21T09:00:00Z", message_reads: [] },
      { id: "m3", conversation_id: CONV, content: "card", sender_kind: "system", created_at: "2026-10-21T09:30:00Z", message_reads: [] },
      { id: "m4", conversation_id: CONV2, content: "Is it dog friendly?", sender_kind: "guest", created_at: "2026-10-19T10:00:00Z", message_reads: [] },
    ],
  );

  test("maps brand identity, last message, unread and recency", () => {
    expect(rows.map((r) => r.enquiryId)).toEqual([ENQ, ENQ2]);
    expect(rows[0]).toMatchObject({
      brandName: "Lantern Room",
      brandLogoUrl: "https://cdn.example/logo.png",
      status: "replied",
      topicLabel: "Lantern Room supper · Refund or cancel",
      unreadCount: 1,
      lastMessage: { id: "m2", body: "Yes — done!", fromBrand: true },
    });
    expect(rows[1]).toMatchObject({ unreadCount: 0, lastMessage: { id: "m4", fromBrand: false } });
  });

  test("a brand message the guest has read is not unread", () => {
    const read = buildMyEnquiryRows(
      USER,
      [{ id: ENQ, brand_id: BRAND, conversation_id: CONV, status: "replied", topic_label: null,
        created_at: "2026-10-20T10:00:00Z", last_guest_at: "2026-10-20T10:00:00Z", last_brand_at: "2026-10-21T09:00:00Z" }],
      [],
      [{ id: "m2", conversation_id: CONV, content: "Yes", sender_kind: "brand", created_at: "2026-10-21T09:00:00Z", message_reads: [{ user_id: USER }] }],
    );
    expect(read[0].unreadCount).toBe(0);
    expect(read[0].brandName).toBe("Brand");
  });

  test("rows carry the #4114 names and stay separate from the brand's other chats", () => {
    const enquiry = toEnquiryConversation(rows[0], USER);
    expect(enquiry).toMatchObject({
      id: CONV,
      isEnquiry: true,
      chatKind: "enquiry",
      linked_entity_type: "brand_enquiry",
      unread_count: 1,
      enquiry: { enquiryId: ENQ, brandName: "Lantern Room", lastMessageFromBrand: true },
    });
    expect(isEnquiryConversation(enquiry)).toBe(true);

    const eventChat = {
      id: "event-chat", created_by: "x", created_at: "2026-10-22T09:00:00Z", participants: [],
      unread_count: 0, messages: [], linked_entity_type: "event", eventBrandName: "Lantern Room",
    } as unknown as Conversation;
    const oldDm = {
      id: "dm", created_by: "x", created_at: "2026-10-01T09:00:00Z", participants: [], unread_count: 0, messages: [],
    } as unknown as Conversation;
    const invite = {
      id: "pending-invite-1", created_by: "", created_at: "2026-09-01T00:00:00Z", participants: [], unread_count: 0,
      messages: [], __pendingInvite: { inviteId: "1" },
    } as unknown as Conversation;
    const enquiries = rows.map((r) => toEnquiryConversation(r, USER));
    const merged = mergeEnquiryConversations([invite, eventChat, oldDm], enquiries, "");
    expect(merged.map((c) => c.id)).toEqual(["pending-invite-1", "event-chat", CONV, CONV2, "dm"]);
    // Same brand as the event chat, still its own row each.
    expect(merged.filter(isEnquiryConversation)).toHaveLength(2);

    expect(mergeEnquiryConversations([eventChat], enquiries, "dog").map((c) => c.id)).toEqual(["event-chat", CONV2]);
    expect(mergeEnquiryConversations([eventChat], enquiries, "lantern").filter(isEnquiryConversation)).toHaveLength(2);
  });
});

describe("#4111 send transport", () => {
  beforeEach(() => mockRpc.mockReset());

  test("Explorer always sends with p_source 'explorer'", async () => {
    mockRpc.mockResolvedValue({ data: { enquiry_id: ENQ, conversation_id: CONV }, error: null });
    const result = await sendExplorerEnquiry(BRAND, {
      entry: "offering", contextKind: "offering", contextId: "evt-1", reason: "question_before_booking",
      body: "Is there step-free access?", guest: null, hp: "", t0: 0,
    });
    expect(mockRpc).toHaveBeenCalledWith("brand_enquiry_send", {
      p_brand_id: BRAND, p_entry: "offering", p_context_kind: "offering", p_context_id: "evt-1",
      p_reason: "question_before_booking", p_body: "Is there step-free access?", p_source: "explorer",
    });
    expect(result).toEqual({ outcome: { ok: true, email: null, threadUrl: null, conversationId: CONV }, enquiryId: ENQ });
  });

  test("a topic with no context sends a null id; server codes become guest copy", async () => {
    expect(
      brandEnquirySendArgs(BRAND, {
        entry: "brand_page", contextKind: "none", contextId: null, reason: "general_question",
        body: "Hello there!", guest: null, hp: "", t0: 0,
      }).p_context_id,
    ).toBeNull();
    mockRpc.mockResolvedValue({ data: null, error: { message: "enquiry_rate_limited" } });
    const result = await sendExplorerEnquiry(BRAND, {
      entry: "brand_page", contextKind: "none", contextId: null, reason: "general_question",
      body: "Hello there!", guest: null, hp: "", t0: 0,
    });
    expect(result.outcome).toEqual({ ok: false, message: "You've sent a few messages already. Try again later." });
    expect(result.enquiryId).toBeNull();
  });
});

describe("#4111 Likes → Calendar plan prefills", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");

  test("ticket order, primary RSVP, reservation and stay open on that plan", () => {
    const order = ticketOrderMessageTarget({
      orderId: "ord-1", eventId: "evt-1", eventTitle: "Supper club", eventSlug: "supper", eventType: "event",
      brandName: "Lantern Room", brandSlug: "lantern-room", coverMediaUrl: null,
      masterDateUtc: "2026-11-08T19:00:00Z", masterDateEndUtc: "2026-11-08T23:00:00Z", timezone: "Europe/London",
      paymentStatus: "paid", ticketCount: 2, ticketCountValid: 2, tickets: [], publicBuyerUrl: null, ticketPdfPath: null,
    } as never, now);
    expect(order).toMatchObject({
      brandId: null, brandSlug: "lantern-room", brandName: "Lantern Room",
      prefill: { contextKind: "order", contextId: "ord-1", plan: { kind: "order", id: "ord-1", summary: "2 tickets", isUpcoming: true } },
    });

    const rsvp = rsvpMessageTarget({
      rsvpId: "rsvp-1", guestId: null, role: "primary", eventId: "evt-2", eventTitle: "Garden party",
      brandId: BRAND, brandName: "Lantern Room", masterDateUtc: "2026-11-01T12:00:00Z", masterDateEndUtc: null,
    } as never, now);
    expect(rsvp.prefill).toMatchObject({ contextKind: "rsvp", contextId: "rsvp-1", plan: { kind: "rsvp" } });

    const plusOne = rsvpMessageTarget({
      rsvpId: "rsvp-1", guestId: "g-1", role: "guest", eventId: "evt-2", eventTitle: "Garden party",
      brandId: BRAND, brandName: "Lantern Room", masterDateUtc: "2026-11-01T12:00:00Z", masterDateEndUtc: null,
    } as never, now);
    expect(plusOne.prefill).toMatchObject({ contextKind: "offering", contextId: "evt-2", offering: { kind: "rsvp", when: "upcoming" } });

    const reservation = reservationMessageTarget({
      id: "res-1", brand_id: BRAND, brand_name: "Lantern Room", reserved_for: "2026-10-30T19:00:00Z",
      party_size: 4, status: "confirmed",
    } as never, now);
    expect(reservation).toMatchObject({
      brandId: BRAND,
      prefill: { contextKind: "reservation", contextId: "res-1", plan: { summary: "Table for 4", canCancel: true } },
    });
    expect(
      reservationMessageTarget({ id: "res-2", brand_id: BRAND, brand_name: null, reserved_for: "2026-10-01T19:00:00Z", party_size: 2, status: "confirmed" } as never, now)
        .prefill.plan?.canCancel,
    ).toBe(false);

    const stay = stayMessageTarget({
      groupId: "stay-1", publicReference: "MNG-123", venueId: "v", venueName: "Lantern Rooms", venueSlug: "rooms",
      brandId: BRAND, brandName: "Lantern Room", brandSlug: "lantern-room",
      lines: [{ name: "Garden suite", roomCheckIn: "2026-11-02", placeStartsAt: null }],
    } as never, now);
    expect(stay.prefill).toMatchObject({ contextKind: "stay", contextId: "stay-1", plan: { title: "Garden suite", summary: "Stay · MNG-123" } });
  });
});

describe("#4111 push explorer.brand_enquiry_reply", () => {
  test("the server deep link opens the enquiry thread route", () => {
    const dest = parseDeepLink(`mingla://chat/${CONV}?type=brand_enquiry&enquiryId=${ENQ}`);
    expect(dest).toEqual({ kind: "enquiry", enquiryId: ENQ, conversationId: CONV });
    const opened: string[] = [];
    const pages: string[] = [];
    executeDeepLink(dest, {
      setCurrentPage: (p) => pages.push(p),
      openRouterPath: (path) => opened.push(path),
    });
    expect(opened).toEqual([`/enquiry/${ENQ}`]);
    expect(pages).toEqual([]);
  });

  test("the type fallback agrees with the parser; plain chat links are unchanged", () => {
    expect(typeFallbackDestination("explorer.brand_enquiry_reply", { enquiry_id: ENQ, conversation_id: CONV }))
      .toEqual({ kind: "enquiry", enquiryId: ENQ, conversationId: CONV });
    expect(parseDeepLink(`mingla://chat/${CONV}?type=group`)).toMatchObject({ kind: "conversation", conversationId: CONV });
  });
});

describe("#4111 claim after email sign-in", () => {
  beforeEach(() => {
    resetBrandContactClaimSession();
    mockRpc.mockReset();
    mockReportNonFatal.mockReset();
  });

  test("calls both claim RPCs and refreshes what they changed", async () => {
    mockRpc.mockImplementation(async (name: string) => ({
      data: name === "claim_brand_enquiries_for_user" ? 2 : 1,
      error: null,
    }));
    const invalidated: unknown[] = [];
    const result = await runBrandContactClaim(USER, "guest@example.com", {
      claim: claimBrandContactForUser,
      invalidate: (key) => invalidated.push(key),
    });
    expect(result).toEqual({ enquiries: 2, subscriptions: 1 });
    expect(mockRpc.mock.calls.map((c) => c[0]).sort()).toEqual([
      "claim_brand_enquiries_for_user",
      "claim_brand_subscriptions_for_user",
    ]);
    expect(invalidated).toEqual([brandEnquiryKeys.list(USER), brandFollowKeys.list(USER)]);

    // Once per account per session.
    await runBrandContactClaim(USER, "guest@example.com", { claim: claimBrandContactForUser, invalidate: () => undefined });
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  test("no verified email → no call; a failure is reported and retried once", async () => {
    const claim = jest.fn();
    expect(await runBrandContactClaim(USER, null, { claim, invalidate: () => undefined })).toBeNull();
    expect(claim).not.toHaveBeenCalled();

    claim.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ enquiries: 0, subscriptions: 0 });
    const result = await runBrandContactClaim(USER, "guest@example.com", {
      claim,
      invalidate: () => undefined,
      setTimer: (fn) => fn(),
    });
    expect(result).toEqual({ enquiries: 0, subscriptions: 0 });
    expect(claim).toHaveBeenCalledTimes(2);
    expect(mockReportNonFatal).toHaveBeenCalledWith("brandContactClaim", expect.any(Error), { retriesLeft: 1 });
  });
});
