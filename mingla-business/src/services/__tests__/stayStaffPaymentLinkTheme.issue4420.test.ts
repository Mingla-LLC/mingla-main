/**
 * issue #4420 — the Stay pay link wears the host's colours: the details the
 * edge function returns carry the brand's public theme, and the service hands
 * the page a guarded ThemeInput (or null, never a guessed colour).
 */
const mockInvoke = jest.fn();
jest.mock("../supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

import {
  brandThemeFrom,
  stayStaffPaymentLinkService,
} from "../stayStaffPaymentLinkService";

const baseDetails = {
  groupId: "g-1",
  publicReference: "STY-1",
  state: "approved_payment_required",
  version: 3,
  currencyCode: "USD",
  totalMinor: "25500",
  guestName: "Theme Guest",
  venueName: "Staff Stay",
  brandName: "Stay Brand",
  brandSlug: "stay-brand",
  expiresAt: "2028-08-01T00:00:00Z",
  paid: false,
  lines: [],
};

describe("#4420 Stay pay link brand theme", () => {
  beforeEach(() => mockInvoke.mockReset());

  test("view() returns the brand's theme as a ThemeInput", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        kind: "success",
        data: {
          ...baseDetails,
          brandTheme: {
            color: "#7c3aed",
            font: "playfair_display",
            animation: "sparkles",
            gradient: "#7c3aed,#f97316",
          },
        },
      },
      error: null,
    });
    const details = await stayStaffPaymentLinkService.view("tok");
    expect(mockInvoke).toHaveBeenCalledWith("stay-staff-payment-link", {
      body: { action: "view", token: "tok" },
    });
    expect(details.brandTheme).toEqual({
      color: "#7c3aed",
      color2: "#f97316",
      font: "playfair_display",
      animation: "sparkles",
    });
    expect(details.brandSlug).toBe("stay-brand");
    expect(details.totalMinor).toBe("25500");
  });

  test("details without a theme (or an older response) fall back to null", async () => {
    mockInvoke.mockResolvedValue({
      data: { kind: "success", data: baseDetails },
      error: null,
    });
    expect((await stayStaffPaymentLinkService.view("tok")).brandTheme).toBeNull();
    expect(
      brandThemeFrom({ color: null, font: null, animation: null, gradient: null }),
    ).toBeNull();
    expect(brandThemeFrom("not-an-object")).toBeNull();
  });

  test("invalid stored values never become a colour", () => {
    expect(
      brandThemeFrom({ color: "red; background:url(x)", font: 42, animation: "explode" }),
    ).toBeNull();
    expect(brandThemeFrom({ color: "#112233", font: "not a font!!" })).toEqual({
      color: "#112233",
    });
  });
});
