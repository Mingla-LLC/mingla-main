// #4273 — the composer's words and holds around SMS that cannot be priced:
// a number whose country Mingla can't text is skipped with its own reason;
// a method whose preview failed holds Send, offers a refresh and never makes
// the total read "Free"; the fallback sentence follows what is ticked now.
//
// MINGLA-INVARIANT: I-4273-SEND-WAITS-FOR-EVERY-PRICED-METHOD | issue #4273 | The Blast review holds Send while any ticked method has no priced preview, and its total cost never reads Free while SMS is ticked and unpriced.
jest.mock("../../../services/marketing/marketingCampaignService", () => ({
  createDraft: jest.fn(),
  deleteDraft: jest.fn(),
  updateDraft: jest.fn(),
  DraftChangedElsewhereError: class extends Error {},
  MarketingBookSendError: class MarketingBookSendError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
}));
jest.mock("../../../services/marketing/marketingBookSendService", () => ({
  confirmMarketingBook: jest.fn(),
  listGroupDrafts: jest.fn(),
  previewMarketingBook: jest.fn(),
  previewMarketingCampaignGroup: jest.fn(),
}));

import {
  blastFallbackSentence,
  reviewSendHold,
  reviewTotalCostLabel,
  smsCostLabel,
} from "../blastSendModel";
import {
  bookPricingErrorCopy,
  unpricedSmsLine,
} from "../../../services/marketing/campaignSendCopy";
import { siblingErrorMessage } from "../../../services/marketing/campaignChannelGroupService";

describe("#4273 a number Mingla can't text yet is skipped with its own reason", () => {
  it("says how many, and why, in plain words", () => {
    expect(unpricedSmsLine(1)).toBe("1 person can't be texted: Mingla can't text their country yet.");
    expect(unpricedSmsLine(3)).toBe("3 people can't be texted: Mingla can't text their country yet.");
  });
  it("says nothing when nobody was skipped for it, or the server predates the count", () => {
    expect(unpricedSmsLine(0)).toBeNull();
    expect(unpricedSmsLine(undefined)).toBeNull();
    expect(unpricedSmsLine(null)).toBeNull();
  });
  it("every text skipped is nothing to pay for, not an unknown cost", () => {
    expect(smsCostLabel({ costKind: "provider_estimate", estimatedCostMinor: 0, currency: null }, "row"))
      .toBe("No texts to pay for");
    expect(smsCostLabel({ costKind: "provider_estimate", estimatedCostMinor: null, currency: null }, "row"))
      .toBe("Cost unavailable");
  });
});

describe("#4273 P2-a a method sent alongside reads a price failure like the lead", () => {
  it.each([
    ["BOOK_BLAST_RATE_BOOK_EXPIRED"],
    ["BOOK_BLAST_RATE_BOOK_UNAVAILABLE"],
    ["BOOK_BLAST_COST_UNAVAILABLE"],
  ])("%s", (code) => {
    const lead = bookPricingErrorCopy(code);
    expect(lead).not.toBeNull();
    const sibling = siblingErrorMessage("sms", new Error(code));
    expect(sibling).toContain(lead as string);
    expect(sibling).not.toBe("SMS preview is unavailable. Refresh before sending.");
  });
  it("the rate card line no longer blames a destination", () => {
    expect(bookPricingErrorCopy("BOOK_BLAST_RATE_BOOK_UNAVAILABLE")).not.toMatch(/destination/);
  });
  it("is not repeated: 'SMS pricing …' is not prefixed again", () => {
    expect(siblingErrorMessage("sms", new Error("BOOK_BLAST_RATE_BOOK_EXPIRED")))
      .toBe("SMS pricing needs a fresh provider rate card before this campaign can be sent.");
  });
});

describe("#4273 P2-a Send waits for a priced preview of every ticked method", () => {
  it("holds Send while a method's preview failed", () => {
    expect(reviewSendHold([
      { channel: "sms", priced: false, pending: false },
      { channel: "push", priced: true, pending: false },
    ])).toBe("SMS has no preview yet. Refresh the preview before sending.");
  });
  it("holds Send while a method is still being priced", () => {
    expect(reviewSendHold([{ channel: "sms", priced: false, pending: true }]))
      .toBe("Checking reach and cost for every method…");
  });
  it("names every waiting method", () => {
    expect(reviewSendHold([
      { channel: "sms", priced: false, pending: false },
      { channel: "push", priced: false, pending: false },
    ])).toBe("SMS and Push have no preview yet. Refresh the preview before sending.");
  });
  it("lets Send go when every method is priced", () => {
    expect(reviewSendHold([{ channel: "sms", priced: true, pending: false }])).toBeNull();
    expect(reviewSendHold([])).toBeNull();
  });
  it("the total never says Free while SMS is ticked and unpriced", () => {
    const emailAndPushOnly = { costKind: "not_metered" as const, estimatedCostMinor: null, currency: null };
    expect(reviewTotalCostLabel(emailAndPushOnly, true, false)).toBe("Cost unavailable");
    expect(reviewTotalCostLabel(emailAndPushOnly, false, false)).toBe("Free");
    expect(reviewTotalCostLabel(
      { costKind: "provider_estimate", estimatedCostMinor: 158, currency: "USD" },
      true,
      true,
    )).toBe("USD 1.58 estimated provider cost");
  });
});

describe("#4273 P3-d the fallback sentence follows what is ticked now", () => {
  const before = ["email", "sms", "push"] as const;
  const after = ["email", "sms"] as const;
  it("right after Push drops, it names Email and SMS", () => {
    expect(blastFallbackSentence(before, after, ["brand_buyers"]))
      .toBe("Push can't reach a buyer list, so this will go by Email and SMS only.");
  });
  it("after Email is unticked, it says SMS only", () => {
    expect(blastFallbackSentence(before, after, ["brand_buyers"], ["sms"]))
      .toBe("Push can't reach a buyer list, so this will go by SMS only.");
  });
  it("goes away when nothing is ticked, or the dropped method is back", () => {
    expect(blastFallbackSentence(before, after, ["brand_buyers"], [])).toBeNull();
    expect(blastFallbackSentence(before, after, ["brand_buyers"], ["email", "push"])).toBeNull();
  });
});

describe("#4273 P2-c the phone preview sheet's tabs are readable on its light header", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path") as typeof import("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { colors } = require("../../../constants/designSystem") as typeof import("../../../constants/designSystem");
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex: string): number => {
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  };
  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const root = path.join(__dirname, "..", "..", "..", "..");
  const tabs = readFileSync(path.join(root, "src/components/marketing/ComposerPreviewTabs.tsx"), "utf8");
  const compose = readFileSync(path.join(root, "app/(tabs)/marketing/campaigns/compose.tsx"), "utf8");

  it("the inactive label token clears 4.5:1 on the sheet (#F5F5F7) and its tab (#FFFFFF)", () => {
    expect(contrast(colors.text.secondary, "#F5F5F7")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.text.secondary, colors.background.primary)).toBeGreaterThanOrEqual(4.5);
  });
  it("the light surface uses those tokens, and the phone sheet asks for it", () => {
    expect(tabs).toMatch(/tabLabelOnLight:\s*\{\s*color:\s*colors\.text\.secondary\s*\}/);
    expect(tabs).toMatch(/tabLabelActiveOnLight:\s*\{\s*color:\s*colors\.text\.primary\s*\}/);
    const sheet = compose.slice(compose.indexOf("styles.previewModal"));
    expect(sheet.slice(0, sheet.indexOf("</Modal>"))).toMatch(/<ComposerPreviewTabs[\s\S]*?surface="light"/);
  });
});
