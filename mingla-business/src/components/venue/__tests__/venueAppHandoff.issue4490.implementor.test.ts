/**
 * #4490 Explorer W1 — buyer web handoff: the claim card, the "pass lives in
 * the app" block and the app payment return page.
 *
 * FAILS-ON-REVERT: remove the passInApp branch in VisitBooking.tsx or
 * VisitMembership.tsx and H-3 fails; drop parseVenueHandoff's URL check and
 * H-1b fails.
 */
import * as fs from "fs";
import * as path from "path";

jest.mock("../offers/EntryUi", () => ({ entryStyles: { card: {} } }));
jest.mock("../../offering/LazyPublicParts", () => ({ BuyerClaimCard: () => null }));
jest.mock("../../../services/claimLinkService", () => ({ mintClaimLinkHandoff: jest.fn() }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Button", () => ({ Button: () => null }));
jest.mock("../../../services/venueOfferGuestService", () => ({ VenueOfferGuestError: class extends Error {}, venueOfferGuestService: {} }));
jest.mock("@mingla/offering-rendering/themeAccentStyle", () => ({ themeBoldFace: () => ({}) }));

import { parseVenueHandoff, phoneLastFour, VENUE_PASS_IN_APP_COPY } from "../offers/VenueAppHandoff";
import { APP_PAYMENT_RETURN_COPY, appPurchaseLink } from "../paid/AppPaymentReturn";

const read = (rel: string): string => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

describe("#4490 W1 parseVenueHandoff", () => {
  test("H-1a reads the claim link and the switch", () => {
    expect(
      parseVenueHandoff({ passInApp: true, claim: { shortUrl: "https://usemingla.com/c/K7Q2MX0001", code: "K7Q2MX0001" } }),
    ).toEqual({ shortUrl: "https://usemingla.com/c/K7Q2MX0001", code: "K7Q2MX0001", passInApp: true, texted: false, textsLeft: null });
  });
  test("H-1b anything that is not a Mingla claim link is no link (the card hides)", () => {
    expect(parseVenueHandoff({ claim: { shortUrl: "https://evil.example/c/K7Q2MX0001", code: "K7Q2MX0001" } }).shortUrl).toBeNull();
    expect(parseVenueHandoff({ claim: { shortUrl: null, code: null } })).toEqual({ shortUrl: null, code: null, passInApp: false, texted: false, textsLeft: null });
    expect(parseVenueHandoff(null)).toEqual({ shortUrl: null, code: null, passInApp: false, texted: false, textsLeft: null });
    expect(parseVenueHandoff({ passInApp: "true" }).passInApp).toBe(false);
  });
  test("H-1c phone last four", () => {
    expect(phoneLastFour("+234 803 000 4821")).toBe("4821");
    expect(phoneLastFour(null)).toBeNull();
    expect(phoneLastFour("12")).toBeNull();
  });
  test("H-2 the block copy is the spec's words", () => {
    expect(VENUE_PASS_IN_APP_COPY.title).toBe("Your pass lives in the Mingla app.");
    expect(VENUE_PASS_IN_APP_COPY.body).toBe("Open it there to get in. No app? Give your name at the door.");
  });
});

describe("#4490 W1 pages", () => {
  test("H-3 the booking and plan pages swap the QR for the block only when the switch is on and no QR came", () => {
    const booking = read("offers/VisitBooking.tsx");
    expect(booking).toMatch(/handoff\.passInApp && !pass\?\.qrPayload \? \(\s*<VenuePassInAppBlock/);
    expect(booking).toMatch(/<VenueClaimCard\s+handoff=\{handoff\}\s+kind="pass"/);
    const member = read("offers/VisitMembership.tsx");
    // TEST-MOD-APPROVED #4490: the plan page now also hides the block for a requested or declined member (no pass exists to move to the app).
    expect(member).toMatch(/\) : handoff\.passInApp && member\.status !== "requested" && member\.status !== "declined" \? \(\s*<VenuePassInAppBlock/);
    expect(member).toMatch(/setHandoff\(parseVenueHandoff\(raw\)\)/);
  });
});

describe("#4490 W1 app payment return", () => {
  test("H-4 the button opens the purchase in the app; a bad id shows no button", () => {
    const id = "0a1b2c3d-4490-4000-8000-0000000000c1";
    expect(appPurchaseLink("visit", id)).toBe(`com.mingla.app.v2://purchases/venue_booking/${id}`);
    expect(appPurchaseLink("plan", id.toUpperCase())).toBe(`com.mingla.app.v2://purchases/venue_membership/${id}`);
    expect(appPurchaseLink("visit", "not-a-uuid")).toBeNull();
    expect(appPurchaseLink("visit", null)).toBeNull();
    expect(APP_PAYMENT_RETURN_COPY).toEqual({
      title: "Payment received",
      visit: "Go back to the Mingla app to see your booking.",
      plan: "Go back to the Mingla app to see your plan.",
      button: "Open Mingla",
    });
  });
  test("H-5 /paid/ is a public route and not an ad-pixel page", () => {
    const gates = fs.readFileSync(path.join(__dirname, "../../../utils/coldLoadAuthGates.ts"), "utf8");
    expect(gates.match(/"\/paid\/"/g)?.length).toBe(2);
  });
});

describe("#4490 W1 text me the link and the waitlist card", () => {
  test("H-6 plain-words errors, never a raw code", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { textLinkErrorCopy, TEXT_LINK_COPY } = require("../offers/VenueAppHandoff");
    expect(textLinkErrorCopy("claim_text_limit")).toBe("We've already texted this link 3 times. Use the link in your email.");
    expect(textLinkErrorCopy("claim_text_no_phone")).toBe("There's no phone number on this booking. Use the link in your email.");
    expect(textLinkErrorCopy("offer_request_failed")).toBe("We couldn't send the text. Try again.");
    expect(textLinkErrorCopy("claim_text_not_confirmed")).toBe("This booking isn't confirmed yet, so there's no pass to send.");
    expect(TEXT_LINK_COPY.sent("4821")).toBe("Sent to •••4821.");
  });
  test("H-7 the waitlist page shows the claim card for an open place", () => {
    const page = read("offers/VisitWaitlist.tsx");
    expect(page).toMatch(/<VenueClaimCard\s+handoff=\{parseVenueHandoff\(\{ claim: entry\.claim \}\)\}\s+kind="booking"/);
    expect(read("offers/VisitBooking.tsx")).toMatch(/textLink=\{\{ groupId, token: token \?\? null \}\}/);
  });
});

describe("#4490 W1 /stay", () => {
  test("H-8 the signed-in stay page shows the claim card from its own read", () => {
    const page = fs.readFileSync(path.join(__dirname, "../../../../app/stay/[groupId].tsx"), "utf8");
    expect(page).toMatch(/<VenueClaimCard\s+handoff=\{parseVenueHandoff\(query\.data\)\}\s+kind="booking"/);
  });
});

describe("#4490 W1 N155 'we also texted'", () => {
  test("H-9 the card says a text was sent only when the server saw one queued", () => {
    const claim = { shortUrl: "https://usemingla.com/c/K7Q2MX0001", code: "K7Q2MX0001" };
    expect(parseVenueHandoff({ claim }).texted).toBe(false);
    expect(parseVenueHandoff({ claim: { ...claim, texted: true } }).texted).toBe(true);
    expect(parseVenueHandoff({ claim: { shortUrl: null, code: null, texted: true } }).texted).toBe(false);
    expect(read("offers/VenueAppHandoff.tsx")).toMatch(/textSent=\{last4 !== null && handoff\.texted\}/);
  });
});

describe("#4490 W1 N159 the text cap survives a reload", () => {
  test("H-10 textsLeft comes from the server and is clamped; 0 starts capped", () => {
    const claim = { shortUrl: "https://usemingla.com/c/K7Q2MX0001", code: "K7Q2MX0001" };
    expect(parseVenueHandoff({ claim: { ...claim, textsLeft: 0 } }).textsLeft).toBe(0);
    expect(parseVenueHandoff({ claim: { ...claim, textsLeft: 9 } }).textsLeft).toBe(3);
    expect(parseVenueHandoff({ claim }).textsLeft).toBeNull();
    expect(read("offers/VenueAppHandoff.tsx")).toMatch(/textsLeft === 0 \? \{ phase: "error", line: TEXT_LINK_COPY\.limit \}/);
  });
});
