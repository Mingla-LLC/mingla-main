import {
  createDiscountBlastDraft,
  discountBlastCopy,
} from "../discountBlastService";

const mockFetchDiscount = jest.fn();
const mockEnsureAudience = jest.fn();
const mockCreateDraft = jest.fn();
const mockCaptureEvent = jest.fn();
const mockMaybeSingle = jest.fn();

jest.mock("../discountService", () => ({
  fetchBrandDiscountById: (...args: unknown[]) => mockFetchDiscount(...args),
}));
jest.mock("../marketing/marketingCampaignService", () => ({
  createDraft: (...args: unknown[]) => mockCreateDraft(...args),
  ensureBrandBuyersAudience: (...args: unknown[]) =>
    mockEnsureAudience(...args),
}));
jest.mock("../../analytics/discountAnalytics", () => ({
  captureDiscountEvent: (...args: unknown[]) => mockCaptureEvent(...args),
}));
jest.mock("../supabase", () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ maybeSingle: mockMaybeSingle })),
      })),
    })),
  },
}));

describe("#3872 discount Blast hand-off", () => {
  test("builds useful code, percentage, and public-link copy", () => {
    expect(
      discountBlastCopy(
        {
          code: "SAVE20",
          currency: "GBP",
          kind: "code",
          name: "Twenty off",
          valueBps: 2000,
          valueMinor: null,
          valueType: "percent",
        },
        "https://usemingla.com/b/host",
      ),
    ).toBe("Use code SAVE20 for 20% off — https://usemingla.com/b/host");
  });

  test("uses the discount name for automatic sale-price copy", () => {
    expect(
      discountBlastCopy(
        {
          code: null,
          currency: "USD",
          kind: "sale_price",
          name: "Weekend price",
          valueBps: null,
          valueMinor: 2500,
          valueType: "set_price",
        },
        "https://usemingla.com/b/host",
      ),
    ).toBe("Weekend price: $25.00 sale price — https://usemingla.com/b/host");
  });

  test("creates an editable draft for the brand's buyers and leaves sending to the composer", async () => {
    mockFetchDiscount.mockResolvedValueOnce({
      code: "SAVE20",
      currency: "GBP",
      kind: "code",
      name: "Twenty off",
      valueBps: 2000,
      valueMinor: null,
      valueType: "percent",
    });
    mockMaybeSingle.mockResolvedValueOnce({
      data: { slug: "host" },
      error: null,
    });
    mockEnsureAudience.mockResolvedValueOnce("audience-id");
    mockCreateDraft.mockResolvedValueOnce({ id: "draft-id" });

    await expect(
      createDiscountBlastDraft({
        accountId: "account-id",
        brandId: "brand-id",
        discountId: "discount-id",
      }),
    ).resolves.toBe("draft-id");
    expect(mockEnsureAudience).toHaveBeenCalledWith({
      account_id: "account-id",
      brand_id: "brand-id",
    });
    expect(mockCreateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: "account-id",
        brand_id: "brand-id",
        audience_id: "audience-id",
        channel_payload: expect.objectContaining({
          kind: "email",
          subject: "Twenty off",
          body_text:
            "Use code SAVE20 for 20% off — https://usemingla.com/b/host",
        }),
      }),
    );
    expect(mockCaptureEvent).toHaveBeenCalledWith("discount_blast_started", {
      kind: "code",
    });
  });
});
