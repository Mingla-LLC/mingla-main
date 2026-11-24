/**
 * #4596 — event audience copy (spec §6 with A2): guests, buyers or people by
 * what the event holds; pending duplicate checks; the zero caption under a
 * disabled Send blast; the composer's zero hold; failure reasons in words.
 */
import {
  COMBINED_ZERO_REACH_COPY,
  canPickEventAudience,
  campaignFailureCopy,
  eventAudienceCount,
  eventAudienceShape,
  eventCardLabel,
  eventHeaderCounts,
  eventRowMeaning,
  eventRowMeta,
  eventRowName,
  eventZeroReachCaption,
  pendingReviewNote,
} from "../../../features/marketing/blastSendModel";

describe("#4596 which noun an event audience uses", () => {
  it("an RSVP event is guests, a paid event buyers, both people", () => {
    expect(eventAudienceShape({ eventType: "rsvp", buyerCount: 0, guestCount: 34 })).toBe("guests");
    expect(eventAudienceShape({ eventType: "rsvp", buyerCount: 0, guestCount: 0 })).toBe("guests");
    expect(eventAudienceShape({ eventType: "event", buyerCount: 47, guestCount: 0 })).toBe("buyers");
    expect(eventAudienceShape({ eventType: "event", buyerCount: 3, guestCount: 2 })).toBe("people");
  });
  it("labels, headers and picker rows follow the noun", () => {
    expect(eventCardLabel("guests")).toBe("GUESTS");
    expect(eventCardLabel("buyers")).toBe("BUYERS");
    expect(eventCardLabel("people")).toBe("PEOPLE");
    expect(eventHeaderCounts("guests", 34, 31)).toBe("34 guests · 31 reachable");
    expect(eventHeaderCounts("buyers", 1, 1)).toBe("1 buyer · 1 reachable");
    expect(eventHeaderCounts("people", 1, 0)).toBe("1 person · 0 reachable");
    expect(eventAudienceCount("people", 58)).toBe("58 people");
    expect(eventRowName("guests", "Friday Rooftop Social")).toBe("Guests of Friday Rooftop Social");
    expect(eventRowName("buyers", "Lagos Jazz Night")).toBe("Buyers of Lagos Jazz Night");
    expect(eventRowName("people", "Summer Launch Party")).toBe("People at Summer Launch Party");
    expect(eventRowMeta("guests", 34)).toBe("34 guests · Event guests");
    expect(eventRowMeta("buyers", 47)).toBe("47 buyers · Event buyers");
    expect(eventRowMeta("people", 58)).toBe("58 people · Event buyers and guests");
    expect(eventRowMeaning("guests")).toBe("Automatic guest group");
  });
});

describe("#4596 zero and pending copy", () => {
  it("the caption under a disabled button says who is left out", () => {
    expect(eventZeroReachCaption("guests")).toBe(
      "No one here can get email yet. Guests who opted out or have no email are left out.",
    );
  });
  it("pending duplicate checks are named, singular and plural; none says nothing", () => {
    expect(pendingReviewNote(0)).toBeNull();
    expect(pendingReviewNote(1)).toBe(
      "1 guest waiting on a duplicate check in your Book won't get this until you review them.",
    );
    expect(pendingReviewNote(2)).toBe(
      "2 guests waiting on a duplicate check in your Book won't get this until you review them.",
    );
  });
  it("the composer's zero hold", () => {
    expect(COMBINED_ZERO_REACH_COPY).toBe(
      "No one in this audience can receive this. Pick another audience or method.",
    );
  });
});

describe("#4596 fix pass 2 who may pick an event audience", () => {
  it("mirrors the server: event_manager (40) and up", () => {
    expect(canPickEventAudience(20)).toBe(false); // marketing_manager
    expect(canPickEventAudience(30)).toBe(false); // finance_manager
    expect(canPickEventAudience(40)).toBe(true); // event_manager
    expect(canPickEventAudience(60)).toBe(true); // brand_owner
  });
});

describe("#4596 fix pass 2 only a send that reached nobody says so", () => {
  it("no_recipients says no one could receive it", () => {
    expect(campaignFailureCopy("no_recipients")).toBe("Not sent: no one in this audience could receive it.");
  });
  it("provider failures keep the usual Failed {date} wording (no reason line)", () => {
    expect(campaignFailureCopy("all_sends_failed")).toBeNull();
  });
});

describe("#4596 failure reasons in words", () => {
  it("maps every reason, never shows a bare code", () => {
    expect(campaignFailureCopy("no_recipients")).toBe("Not sent: no one in this audience could receive it.");
    expect(campaignFailureCopy("form_closed")).toBe("Not sent: form closed");
    expect(campaignFailureCopy("audience_load")).toBe("Not sent: something went wrong (audience_load).");
    expect(campaignFailureCopy(null)).toBeNull();
    expect(campaignFailureCopy(undefined)).toBeNull();
    expect(campaignFailureCopy("")).toBeNull();
  });
});
