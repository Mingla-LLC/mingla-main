import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

describe("Issue #1390 Stay guest surface contracts", () => {
  test("canonical venue routes branch Stay without inventing a Hotel route", () => {
    const buyerRoute = read("mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx");
    const consumerRoute = read(
      "app-mobile/src/screens/ConsumerPublicVenueScreen.tsx",
    );
    expect(buyerRoute).toContain('venue?.venueCategory === "stay"');
    // [TEST-MOD-APPROVED #1558] — was `venue.venueCategory === "stay"`. The
    // consumer screen no longer compares the raw category anywhere: it resolves
    // the ONE total category profile and branches on `profile.bookingBody`, so
    // `play`, `creative_and_arts` and a NULL category stop silently inheriting
    // the restaurant's screen. Same invariant — the Stay branch is still driven
    // by `venueCategory` off the same view, with no invented Hotel route —
    // asserted at the seam where it now lives.
    expect(consumerRoute).toContain(
      "venueCategoryProfile(venue?.venueCategory",
    );
    expect(consumerRoute).toContain('profile.bookingBody === "stay"');
    expect(consumerRoute).not.toContain('const isStay = venue.venueCategory');
    expect(
      fs.existsSync(path.join(ROOT, "mingla-business/app/hotel")),
    ).toBe(false);
    expect(fs.existsSync(path.join(ROOT, "app-mobile/app/hotel"))).toBe(false);
  });

  test("Stay pages do not call restaurant menu, price-range, or table-reserve reads", () => {
    const buyerRoute = read("mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx");
    const consumerService = read(
      "app-mobile/src/services/publicVenueService.ts",
    );
    expect(buyerRoute).toMatch(
      /usePublicMenus\([\s\S]*?venue\.venueCategory !== "stay"/,
    );
    expect(buyerRoute).toMatch(
      /venue\?\.venueCategory === "stay" \? null : venue\?\.placePoolId/,
    );
    expect(consumerService).toMatch(
      /row\.venue_category === "stay"[\s\S]*?Promise\.resolve\(\{ data: \[\], error: null \}\)/,
    );
    expect(consumerService).toContain(
      'row.place_pool_id === null || row.venue_category === "stay"',
    );
  });

  test("web uses connected-account Payment Element while native uses wallet-complete PaymentSheet", () => {
    const webPayment = read(
      "mingla-business/src/components/stay/StayStripePayment.web.tsx",
    );
    expect(webPayment).toContain("@stripe/stripe-js");
    expect(webPayment).toContain('elements.create("payment")');
    expect(webPayment).toContain("stripeAccount: session.stripeAccountId");
    expect(webPayment).not.toContain("@stripe/react-stripe-js");
    expect(webPayment).not.toContain("@stripe/stripe-react-native");

    for (
      const file of [
        "app-mobile/src/components/stay/ConsumerStayGuestExperience.tsx",
        "app-mobile/app/stay/[groupId].tsx",
      ]
    ) {
      const nativePayment = read(file);
      expect((nativePayment.match(/initPaymentSheet\(/g) ?? [])).toHaveLength(1);
      expect(nativePayment).toContain("stripeAccountId: payment.stripeAccountId");
      expect(nativePayment).toContain("applePay:");
      expect(nativePayment).toContain("cartItems:");
      expect(nativePayment).toContain("googlePay:");
      expect(nativePayment).toContain("currencyCode: payment.currencyCode");
    }
  });

  test("Stay booking and Payment Element remain off the shared buyer-web boot path", () => {
    const venuePage = read(
      "mingla-business/src/components/venue/PublicVenuePage.tsx",
    );
    const buyerStay = read(
      "mingla-business/src/components/stay/BuyerStayGuestExperience.tsx",
    );
    const renderingBarrel = read("packages/brand-rendering/index.ts");
    expect(venuePage).toContain("React.lazy(() =>");
    expect(venuePage).toContain(
      'import("../stay/BuyerStayGuestExperience")',
    );
    expect(venuePage).not.toContain(
      'import { BuyerStayGuestExperience } from "../stay/BuyerStayGuestExperience"',
    );
    expect(renderingBarrel).not.toContain(
      'from "./StayGuestBooking"',
    );
    expect(renderingBarrel).not.toContain(
      'from "./StayReservationDetail"',
    );
    expect(renderingBarrel).not.toContain('from "./stayGuest"');
    expect(buyerStay).toContain("React.lazy(() =>");
    expect(buyerStay).toContain('import("./StayStripePayment")');
    expect(buyerStay).not.toContain(
      'import { StayStripePayment } from "./StayStripePayment"',
    );
  });

  test("reservation management exposes lifecycle, receipt, refunds, and accessible actions", () => {
    const detail = read(
      "packages/brand-rendering/StayReservationDetail.tsx",
    );
    expect(detail).toContain("Reservation receipt");
    expect(detail).toContain("Refund in progress");
    expect(detail).toContain("stay_refund_succeeded");
    expect(detail).toContain(
      'accessibilityRole={lineCanCancel ? "checkbox" : undefined}',
    );
    expect(detail).toContain("Preview cancellation");
    expect(detail).toContain("Confirm cancellation");
    const calendar = read(
      "app-mobile/src/components/activity/CalendarTab.tsx",
    );
    const calendarRow = read(
      "app-mobile/src/components/activity/StayCalendarRow.tsx",
    );
    expect(calendar).toContain("useMyStayReservations");
    expect(calendar).toContain('kind: "stay"');
    expect(calendar).toContain("<StayCalendarRow");
    expect(calendarRow).toContain("`/stay/${group.groupId}`");
  });

  test("Stay analytics contain no guest contact fields", () => {
    const sources = [
      read("mingla-business/src/components/stay/BuyerStayGuestExperience.tsx"),
      read("mingla-business/app/stay/[groupId].tsx"),
      read("app-mobile/src/components/stay/ConsumerStayGuestExperience.tsx"),
      read("app-mobile/app/stay/[groupId].tsx"),
    ].join("\n");
    for (
      const event of [
        "stay_quote_succeeded",
        "stay_request_submitted",
        "stay_payment_started",
        "stay_payment_completed",
        "stay_payment_failed",
        "stay_group_viewed",
        "stay_cancellation_previewed",
        "stay_cancellation_completed",
        "stay_cancellation_failed",
      ]
    ) {
      expect(sources).toContain(event);
    }
    expect(sources).not.toMatch(
      /postHogService\.capture\([\s\S]{0,300}(guest_email|guest_phone)/,
    );
  });
});
