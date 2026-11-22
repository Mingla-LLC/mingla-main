/**
 * #4490 Explorer W4 — the wiring that turns W2's and W7's transitional
 * placeholders into the native checkout (source pins; the sheet itself is
 * mounted in issue_4490_w4_checkout_sheet.implementor.render.test.tsx).
 *
 *   P-1  Purchases detail: "Pay to hold your date" / "Pay the rest" open the
 *        sheet straight at Pay with the server's amounts (venueBookingPayAction)
 *   P-2  Purchases focus and app start run the venue recovery check; the root
 *        layout loads it on use (no eager payment code at boot)
 *   P-3  the transitional markers W4 exits are gone (W2's three, W7's one,
 *        the W3 seam's)
 *   P-4  solo and collab parity (§5): the pane opens the sheet the same in
 *        both modes (the deck mode only rides on the analytics event)
 *
 * FAILS-ON-REVERT: put the booking-page note back and P-1 fails; drop the
 * focus check and P-2 fails; branch the checkout on `mode` and P-4 fails.
 */
import fs from "node:fs";
import path from "node:path";

declare const test: (name: string, fn: () => void) => void;
declare const expect: (v: unknown) => { toMatch(r: RegExp): void; not: { toMatch(r: RegExp): void } };

const read = (rel: string): string => fs.readFileSync(path.join(__dirname, rel), "utf8");

test("P-1 Purchases pays in the app", () => {
  const detail = read("../VenuePurchaseDetail.tsx");
  expect(detail).toMatch(/const payAction = venueBookingPayAction\(booking\)/);
  expect(detail).toMatch(/from: "purchases"/);
  expect(detail).toMatch(/<VenueOfferCheckoutSheet\s+open=\{checkout\}/);
  expect(detail).not.toMatch(/venueBookingPayNote|from your booking page/);
  const model = read("../venuePurchaseModel.ts");
  expect(model).toMatch(/export function venueBookingPayAction/);
});

test("P-2 the recovery check runs on Purchases focus and on start (lazily at the root)", () => {
  const index = read("../../../../app/purchases/index.tsx");
  expect(index).toMatch(/useFocusEffect\(/);
  expect(index).toMatch(/runVenueCheckoutRecovery\(userId/);
  const root = read("../../../../app/_layout.tsx");
  expect(root).toMatch(/<VenueCheckoutRecoveryOnStart \/>/);
  expect(root).toMatch(/require\("\.\.\/src\/payments\/useVenueCheckoutRecovery"\)/);
  expect(root).not.toMatch(/^import .*useVenueCheckoutRecovery/m);
});

test("P-3 the markers W4 exits are gone", () => {
  for (const rel of [
    "../VenuePurchaseDetail.tsx",
    "../venuePurchaseModel.ts",
    "../../../../app/purchases/index.tsx",
    "../../venueOffers/VenueCheckoutWhenLine.tsx",
    "../../venueOffers/venueOfferCheckoutSeam.ts",
  ]) {
    expect(read(rel)).not.toMatch(/\[TRANSITIONAL\]/);
  }
});

test("P-4 solo and collab open the same checkout", () => {
  const pane = read("../../venueOffers/VenueOfferPane.tsx");
  const book = pane.slice(pane.indexOf("const book = useCallback"), pane.indexOf("// The docked bar speaks"));
  expect(book).toMatch(/openVenueOfferCheckout\(/);
  expect(book).not.toMatch(/mode ===|=== "collab"|=== "solo"/);
});
