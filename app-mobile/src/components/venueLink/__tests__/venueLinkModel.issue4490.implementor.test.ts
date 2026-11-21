/**
 * #4490 Explorer W1 — venue web links caught by the app: no dead ends.
 * FAILS-ON-REVERT: drop the paid_no_link branch and L-3 fails.
 */
// Jest globals, typed locally (app-mobile has no /jest in its tsconfig).
interface W1Matchers { toBe(v: unknown): void; toEqual(v: unknown): void; toBeNull(): void }
declare const describe: (name: string, body: () => void) => void;
declare const test: (name: string, body: () => void) => void;
declare const expect: ((v: unknown) => W1Matchers) & { arrayContaining(v: unknown[]): unknown };
declare const jest: { mock(path: string, factory: () => unknown): void; fn(): () => unknown };
import { decideVenueLink, purchasesPathFor, tokenFromFragment, VENUE_LINK_COPY } from "../venueLinkModel";

const ID = "0a1b2c3d-4490-4000-8000-0000000000c1";
const WEB = `https://host.usemingla.com/visit/${ID}`;
const T = "A".repeat(43);

describe("#4490 W1 venue links in the app", () => {
  test("L-1 owned opens Purchases; /o always opens the order", () => {
    // [TEST-MOD-APPROVED #4490] Explorer W2 (N157 closed): owned links open the detail.
    expect(decideVenueLink({ kind: "visit", id: ID, webUrl: WEB, owned: true, token: null, paidReturn: false })).toEqual({ kind: "purchases", path: `/purchases/venue_booking/${ID}` });
    expect(decideVenueLink({ kind: "order", id: ID, webUrl: WEB, owned: false, token: null, paidReturn: false })).toEqual({ kind: "purchases", path: `/purchases/order/${ID}` });
    expect(purchasesPathFor("waitlist", ID)).toBe(`/purchases/venue_waitlist/${ID}`);
  });
  test("L-2 a token link reads the booking (token from the fragment only)", () => {
    expect(tokenFromFragment(`#t=${T}`)).toBe(T);
    expect(tokenFromFragment("#t=short")).toBeNull();
    expect(decideVenueLink({ kind: "visit", id: ID, webUrl: WEB, owned: false, token: T, paidReturn: false })).toEqual({ kind: "read_with_token" });
  });
  test("L-3 a web payment return with nothing to read shows Payment received", () => {
    expect(decideVenueLink({ kind: "visit", id: ID, webUrl: WEB, owned: false, token: null, paidReturn: true })).toEqual({ kind: "paid_no_link" });
    expect(VENUE_LINK_COPY.paidBody).toBe("We've emailed your booking. Open the link in that email to see it here.");
    expect(VENUE_LINK_COPY.paidButton).toBe("Go to Purchases");
  });
  test("L-4 a malformed id or an unserved path opens the web page in-app", () => {
    expect(decideVenueLink({ kind: "visit", id: "nope", webUrl: WEB, owned: false, token: null, paidReturn: true })).toEqual({ kind: "web", url: WEB });
    expect(decideVenueLink({ kind: "reserve_manage", id: null, webUrl: WEB, owned: false, token: null, paidReturn: false }).kind).toBe("web");
    expect(decideVenueLink({ kind: "visit", id: ID, webUrl: WEB, owned: false, token: null, paidReturn: false }).kind).toBe("web");
  });
  test("L-5 the under-another-email line", () => {
    expect(VENUE_LINK_COPY.underOther("t•••@gmail.com")).toBe("This booking is under t•••@gmail.com. Sign in with that email to keep it in Purchases.");
  });
});
