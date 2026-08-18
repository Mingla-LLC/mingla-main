/**
 * issue #2229 — SPEC #2227 §7 T-14.
 *
 * The Experience screen's ORCH-1187 stale-occurrence recovery must survive the
 * error mapper. It used to sniff the RAW TOKEN out of the toast message
 * (`msg.includes("occurrence_not_available")`), which the mapper permanently
 * breaks. This proves the branch now reads the token AND that the copy the
 * buyer sees is the mapped sentence, not the token.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const mockInvoke = jest.fn();

jest.mock("../../services/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));
jest.mock("expo-web-browser", () => ({
  openBrowserAsync: jest.fn(),
  openAuthSessionAsync: jest.fn(),
  WebBrowserResultType: { LOCKED: "locked" },
}));
jest.mock("@mingla/payments-native", () => ({
  useStripePaymentSheet: () => ({
    initPaymentSheet: jest.fn(),
    presentPaymentSheet: jest.fn(),
    isPaymentSheetSupported: true,
  }),
}));
jest.mock("@stripe/stripe-react-native", () => ({ initStripe: jest.fn() }));

import { useNativeCheckoutFlow } from "../nativeCheckoutFlow";
import {
  CHECKOUT_DATE_UNAVAILABLE_MESSAGE,
  isStaleOccurrenceToken,
} from "../checkoutErrorMessages";

const SCREEN_SOURCE = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "screens",
    "Experience",
    "ConsumerExperienceDetailScreen.tsx",
  ),
  "utf8",
);

describe("#2229 T-14 — the stale-occurrence recovery survives the mapper", () => {
  it("the flow hands the screen the token AND mapped copy", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: {
        name: "FunctionsHttpError",
        message: "Edge Function returned a non-2xx status code",
        context: {
          status: 422,
          text: async () => JSON.stringify({ error: "occurrence_not_available" }),
        },
      },
    });

    const result = await useNativeCheckoutFlow()({
      eventId: "exp-2229",
      lines: [{ ticketTypeId: "tt", quantity: 1 }],
      buyer: { name: "Ada", email: "a@b.co", phone: "+2348000000000" },
      eventDateId: "occ-gone",
    });

    expect(result.outcome).toBe("failed");
    if (result.outcome !== "failed") throw new Error("unreachable");
    // The predicate the screen branches on fires...
    expect(isStaleOccurrenceToken(result.token ?? null)).toBe(true);
    // ...and the buyer reads a sentence, not the token.
    expect(result.message).toBe(CHECKOUT_DATE_UNAVAILABLE_MESSAGE);
    expect(result.message).not.toContain("occurrence_not_available");
  });

  it("the screen branches on the token and no longer sniffs the message", () => {
    expect(SCREEN_SOURCE).toContain(
      "isStaleOccurrenceToken(result.token ?? null)",
    );
    expect(SCREEN_SOURCE).not.toMatch(
      /msg\.includes\("occurrence_not_available"\)/,
    );
    expect(SCREEN_SOURCE).not.toMatch(
      /msg\.includes\("occurrence_not_found"\)/,
    );
  });

  it("the picker re-open behaviour is preserved exactly", () => {
    const branch = SCREEN_SOURCE.slice(
      SCREEN_SOURCE.indexOf("isStaleOccurrenceToken(result.token ?? null)"),
    ).slice(0, 900);
    expect(branch).toContain("setSelectedEventDateId(null)");
    expect(branch).toContain("freshDetailQuery.refetch()");
    expect(branch).toContain("setReservePickerVisible(true)");
    expect(branch).toContain("setOccurrencePickerVisible(true)");
  });

  it("all three consumer screens still hand the mapped message to the toast", () => {
    for (const relative of [
      ["..", "..", "screens", "Event", "ConsumerEventDetailScreen.tsx"],
      ["..", "..", "screens", "Trip", "ConsumerTripDetailScreen.tsx"],
      [
        "..",
        "..",
        "screens",
        "Experience",
        "ConsumerExperienceDetailScreen.tsx",
      ],
    ]) {
      const src = readFileSync(join(__dirname, ...relative), "utf8");
      expect(src).toContain('toastManager.show(result.message, "error")');
      // F-5: the cart teardown was ruled out and must stay untouched.
      expect(src).toContain("setCartVisible(false)");
    }
  });
});
