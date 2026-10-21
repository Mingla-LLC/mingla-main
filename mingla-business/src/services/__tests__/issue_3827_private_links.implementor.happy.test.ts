import { readFileSync } from "node:fs";
import { join } from "node:path";

const invoke = jest.fn();

jest.mock("../supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
jest.mock("../../analytics/webAnalytics", () => ({
  getStoredClickAttribution: () => ({ clickId: null }),
  getStoredAdMatchData: () => ({
    fbp: null,
    fbc: null,
    scid: null,
    clientUserAgent: null,
  }),
}));

import {
  createCheckoutAttemptTracker,
  checkoutClientAttemptFingerprint,
  type CheckoutClientAttemptInput,
} from "@mingla/offering-rendering/ticketCheckoutContract";
import { privateTicketFromLink } from "../../hooks/useTicketLinkUnlock";
import {
  isSelfAuthenticatedExemptRoute,
  shouldRedirectToSignInFromRoute,
} from "../../utils/coldLoadAuthGates";
import { createTicketCheckout } from "../ticketCheckoutService";
import { ticketLinkErrorCopy } from "../ticketLinksService";

const EVENT = "11111111-1111-4111-8111-111111111111";
const TIER = "22222222-2222-4222-8222-222222222222";
const ATTEMPT = "33333333-3333-4333-8333-333333333333";
const TOKEN_A = "a".repeat(22);
const TOKEN_B = "b".repeat(22);

const fingerprintInput = (ticketLinkToken: string | null): CheckoutClientAttemptInput => ({
  eventId: EVENT,
  purchaseTermsAccepted: true,
  buyer: {
    name: "Buyer",
    email: "buyer@example.test",
    phone: "+12025550111",
    marketingOptIn: false,
  },
  providerInput: { surface: "web" },
  ticketLinkToken,
  lines: [{ ticketTypeId: TIER, quantity: 1, paymentPlanChoice: "full" }],
  eventDateId: null,
  eventDateIds: [],
  intakeFormData: [],
});

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({
    data: { kind: "free_completed", orderId: "order", tickets: [] },
    error: null,
  });
});

test("#3827 /g is bearer-authorized, segment-safe, and a link change rotates checkout identity", () => {
  expect(isSelfAuthenticatedExemptRoute(`/g/${TOKEN_A}`)).toBe(true);
  expect(isSelfAuthenticatedExemptRoute("/gift-card")).toBe(false);
  expect(shouldRedirectToSignInFromRoute({
    isWeb: true,
    loading: false,
    hasUser: false,
    hasStoredWebSession: false,
    pathname: `/g/${TOKEN_A}`,
  })).toBe(false);
  expect(checkoutClientAttemptFingerprint(fingerprintInput(TOKEN_A)))
    .not.toBe(checkoutClientAttemptFingerprint(fingerprintInput(TOKEN_B)));

  const minted = [ATTEMPT, "44444444-4444-4444-8444-444444444444"];
  const tracker = createCheckoutAttemptTracker(() => minted.shift()!);
  expect(tracker.idFor(fingerprintInput(TOKEN_A))).toBe(ATTEMPT);
  expect(tracker.idFor(fingerprintInput(TOKEN_A))).toBe(ATTEMPT);
  expect(tracker.idFor(fingerprintInput(TOKEN_B))).toBe("44444444-4444-4444-8444-444444444444");
});

test("#3827 a resolved paid private tier becomes the only checkout ticket", () => {
  const ticket = privateTicketFromLink({
    state: "active",
    kind: "private_ticket",
    eventId: EVENT,
    tier: {
      id: TIER,
      name: "Hidden release",
      priceCents: 2400,
      allInCents: 2600,
      currency: "USD",
      remaining: 7,
      minPurchaseQty: 1,
      maxPurchaseQty: 4,
    },
  }, EVENT);
  expect(ticket).toMatchObject({
    id: TIER,
    name: "Hidden release",
    priceGbp: 24,
    priceAllInGbp: 26,
    capacity: 7,
    visibility: "public",
    passwordProtected: false,
  });
  expect(privateTicketFromLink({ state: "revoked" }, EVENT)).toBeNull();
  expect(privateTicketFromLink({ state: "active", kind: "private_ticket", eventId: "other" }, EVENT)).toBeNull();
});

test("#3827 checkout transport carries the bearer proof only when supplied", async () => {
  const input = {
    eventId: EVENT,
    buyer: {
      name: "Buyer",
      email: "buyer@example.test",
      phone: "+12025550111",
      marketingOptIn: false,
      termsAccepted: true,
    },
    lines: [{
      ticketTypeId: TIER,
      ticketName: "Hidden release",
      quantity: 1,
      unitPrice: 24,
      currency: "USD",
      isFree: false,
    }],
    surface: "web" as const,
  };
  await createTicketCheckout({ ...input, ticketLinkToken: TOKEN_A });
  expect(invoke.mock.calls[0][1].body.ticketLinkToken).toBe(TOKEN_A);
  invoke.mockClear();
  await createTicketCheckout(input);
  expect(invoke.mock.calls[0][1].body).not.toHaveProperty("ticketLinkToken");
});

test("#3827 user-facing errors cover date choice and bearer failure without database text", () => {
  expect(ticketLinkErrorCopy("event_date_choice_required")).toContain("Choose an event date");
  expect(ticketLinkErrorCopy("link_revoked")).toBe("This link was revoked.");
  expect(ticketLinkErrorCopy("unmapped database detail")).toBe("Something went wrong. Try again.");
});

test("#3827 the buyer route stays lazy and the checkout edge hashes before the wrapper RPC", () => {
  const root = join(__dirname, "..", "..", "..");
  const route = readFileSync(join(root, "app/g/[token].tsx"), "utf8");
  const edge = readFileSync(join(root, "../supabase/functions/ticket-checkout-create/index.ts"), "utf8");
  expect(route).toContain("React.lazy");
  expect(route).toContain('import("../../src/components/ticketLinks/TicketLinkLanding")');
  const hashCall = edge.lastIndexOf("hashTicketLinkToken(");
  const wrapperCall = edge.indexOf('"biz_ticket_link_checkout_create_session"');
  expect(hashCall).toBeGreaterThan(0);
  expect(wrapperCall).toBeGreaterThan(hashCall);
  expect(edge).not.toContain("p_ticket_link_token");
});
